'use strict';
/**
 * Motors — NEC Article 430.
 * 430.6(A)(1)  conductors + branch protection use TABLE FLC, not nameplate
 * 430.22       conductors at 125% of table FLC
 * 430.32       overload from NAMEPLATE FLA
 * 430.52       branch-circuit short-circuit / ground-fault protection
 * 430.110      disconnect at least 115% of FLC
 */
const { MT_FLC_1PH, MT_V_1PH, MT_FLC_3PH, MT_V_3PH, MT_PCT, MT_STD, AMP_CU, AMP_AL } = require('./tables');
const { SIZE_ORDER } = require('./wireSizing');

function nextStandard(x) {
  for (const s of MT_STD) if (s >= x) return s;
  return null;
}

function tableFLC(hp, volts, phase) {
  const table = phase === 1 ? MT_FLC_1PH : MT_FLC_3PH;
  const volt = phase === 1 ? MT_V_1PH : MT_V_3PH;
  const row = table[String(hp)];
  if (!row) return null;
  const i = volt.indexOf(String(volts));
  if (i < 0) return null;
  const v = row[i];
  return (v === null || v === undefined) ? null : v;
}

/**
 * @param {object} input
 * @param {string|number} input.hp
 * @param {number} input.volts
 * @param {number} input.phase           1 | 3
 * @param {string} [input.motorType]     'designB'|'other'|'wound'|'dc'
 * @param {string} [input.ocpdType]      'inverse'|'dual'|'nontd'|'inst'
 * @param {number} [input.nameplateFLA]  required for the overload figure
 * @param {number} [input.serviceFactorMultiplier] 1.25 (SF>=1.15 or rise<=40C) else 1.15
 * @param {string} [input.material]
 */
function calculateMotorCircuit(input) {
  const {
    hp, volts, phase, motorType = 'designB', ocpdType = 'inverse',
    nameplateFLA = null, serviceFactorMultiplier = 1.25, material = 'cu',
  } = input || {};

  const ph = Number(phase);
  if (ph !== 1 && ph !== 3) {
    // The old ternary treated ANYTHING non-1 as three-phase; a malformed
    // phase silently landed in Table 430.250. Structured rejection instead.
    return { ok: false, reason: 'INVALID_PHASE', phase };
  }
  if (material !== 'cu' && material !== 'al') {
    return { ok: false, reason: 'INVALID_MATERIAL', material };
  }
  if (typeof serviceFactorMultiplier !== 'number'
    || !Number.isFinite(serviceFactorMultiplier) || serviceFactorMultiplier <= 0) {
    return { ok: false, reason: 'INVALID_SERVICE_FACTOR', serviceFactorMultiplier };
  }

  const flc = tableFLC(hp, volts, ph);
  if (flc === null) return { ok: false, reason: 'NOT_IN_TABLE', hp, volts, phase: ph };

  const minConductorAmpacity = flc * 1.25;              // 430.22
  // Deliberately a simple 75C-column pick, matching the tool's stated output
  // ("Copper at 75C, before any derating"): the motor calculator gives the
  // Article 430 sizing baseline; derating and terminal machinery live in the
  // Ampacity and Wire Sizer tools. Conductor ordering is the ONE shared
  // SIZE_ORDER — never a second local list.
  const table = material === 'al' ? AMP_AL : AMP_CU;
  let conductorSize = null;
  for (const s of SIZE_ORDER) {
    if (table[s] && table[s].t75 >= minConductorAmpacity) { conductorSize = s; break; }
  }

  const pct = MT_PCT[motorType] && MT_PCT[motorType][ocpdType];
  if (pct === undefined) return { ok: false, reason: 'UNKNOWN_DEVICE', motorType, ocpdType };
  const maxProtection = flc * pct / 100;                // 430.52 Table
  const standardProtection = nextStandard(maxProtection); // 430.52(C)(1) Ex.1
  const disconnect = nextStandard(flc * 1.15);          // 430.110

  const nameplateProvided = typeof nameplateFLA === 'number'
    && Number.isFinite(nameplateFLA) && nameplateFLA > 0;
  const overload = nameplateProvided
    ? round2(nameplateFLA * serviceFactorMultiplier)    // 430.32 — NAMEPLATE
    : null;

  return {
    ok: true,
    tableFLC: flc,
    tableRef: ph === 1 ? 'NEC Table 430.248' : 'NEC Table 430.250',
    minConductorAmpacity: round2(minConductorAmpacity),
    conductorSize,
    protectionPercent: pct,
    maxProtection: round2(maxProtection),
    standardProtection,
    disconnectRating: disconnect,
    overloadMax: overload,
    overloadBasis: 'nameplate',
    overloadPercentApplied: Math.round(serviceFactorMultiplier * 100),
    serviceFactorMultiplier,
    nameplateProvided,
    nameplateDiffersFromTable: nameplateProvided && Math.abs(nameplateFLA - flc) > 0.05,
  };
}
const round2 = (n) => Math.round(n * 100) / 100;
module.exports = { calculateMotorCircuit, tableFLC, nextStandard };
