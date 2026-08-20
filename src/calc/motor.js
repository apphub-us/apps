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

  const flc = tableFLC(hp, volts, phase);
  if (flc === null) return { ok: false, reason: 'NOT_IN_TABLE', hp, volts, phase };

  const minConductorAmpacity = flc * 1.25;              // 430.22
  const table = material === 'al' ? AMP_AL : AMP_CU;
  const order = ['14','12','10','8','6','4','3','2','1','1/0','2/0','3/0','4/0',
                 '250','300','350','400','500','600','700','750'];
  let conductorSize = null;
  for (const s of order) {
    if (table[s] && table[s].t75 >= minConductorAmpacity) { conductorSize = s; break; }
  }

  const pct = MT_PCT[motorType] && MT_PCT[motorType][ocpdType];
  if (pct === undefined) return { ok: false, reason: 'UNKNOWN_DEVICE', motorType, ocpdType };
  const maxProtection = flc * pct / 100;                // 430.52 Table
  const standardProtection = nextStandard(maxProtection); // 430.52(C)(1) Ex.1
  const disconnect = nextStandard(flc * 1.15);          // 430.110

  const overload = nameplateFLA > 0
    ? round2(nameplateFLA * serviceFactorMultiplier)    // 430.32 — NAMEPLATE
    : null;

  return {
    ok: true,
    tableFLC: flc,
    tableRef: phase === 1 ? 'NEC Table 430.248' : 'NEC Table 430.250',
    minConductorAmpacity: round2(minConductorAmpacity),
    conductorSize,
    protectionPercent: pct,
    maxProtection: round2(maxProtection),
    standardProtection,
    disconnectRating: disconnect,
    overloadMax: overload,
    overloadBasis: 'nameplate',
    nameplateDiffersFromTable: nameplateFLA > 0 && Math.abs(nameplateFLA - flc) > 0.05,
  };
}
const round2 = (n) => Math.round(n * 100) / 100;
module.exports = { calculateMotorCircuit, tableFLC, nextStandard };
