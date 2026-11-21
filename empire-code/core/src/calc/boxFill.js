'use strict';
/**
 * Box fill — NEC 2020 §314.16(A) and (B). Pure functions. Contract v2.
 *
 * The single calculation entry point. It answers ONE bounded question: does
 * the modeled fill fit the modeled volume? It is not an approval of an
 * installation, of device depth/compatibility, or of a box material's
 * legality. Everything electrical about Box Fill lives here; the UI only
 * parses, calls once, and renders. See docs/box-fill-contract.md.
 *
 * Bounded non-EGC model (unchanged from v1): one governing size
 * (`largestWireSize`) prices every non-EGC allowance — each counted
 * conductor (B)(1), each device yoke ×2 (B)(4), one clamp allowance (B)(2),
 * each support fitting (B)(3). Mixed sizes, 4 AWG+, conduit bodies and
 * partitioned boxes are unsupported here.
 *
 * EGC / bonding-jumper model (v2, NEC 2020 314.16(B)(5)):
 *   n = entering EGCs + entering bonding jumpers (explicitly known)
 *   v = Table 314.16(B) allowance for the largest of them
 *   factor = 0 if n == 0, else 1 + max(0, n - 4) / 4
 *   egcVolume = factor * v
 * A conductor wholly inside the box is never entered. No exception or
 * later-edition rule is applied silently.
 */
const { BF_VOL, BF_BOXES } = require('./tables');

const CONTRACT = 2;
const RULE_BASIS = 'NEC2020';
/** Guard against absurd magnitudes: a count or volume beyond this is data error, not a box. */
const MAX_COUNT = 100000;
const MAX_VOLUME = 100000;

const own = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const fail = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});

function checkCount(name, value, required) {
  if (value === undefined) return required ? fail(name === 'egcCount' ? 'EGC_COUNT_REQUIRED' : 'INVALID_COUNT', { field: name }) : null;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return fail('INVALID_COUNT', { field: name, value });
  }
  if (value < 0) return fail('NEGATIVE_COUNT', { field: name, value });
  if (value > MAX_COUNT) return fail('INVALID_COUNT', { field: name, value, limit: MAX_COUNT });
  return null;
}

/**
 * @param {object} input  see the contract document for every field
 * @returns {object} `{ ok:true, ...totals, egc:{...} }` or `{ ok:false, reason, ... }`
 */
function calculateBoxFill(input) {
  if (!input || typeof input !== 'object') return fail('INVALID_INPUT');

  // ── contract / rule basis ──────────────────────────────────────────────
  const contract = input.contract === undefined ? 1 : input.contract;
  if (contract !== 1 && contract !== CONTRACT) return fail('UNSUPPORTED_CONTRACT', { contract: input.contract });
  if (input.ruleBasis !== undefined && input.ruleBasis !== RULE_BASIS) return fail('UNSUPPORTED_RULE_BASIS', { ruleBasis: input.ruleBasis });

  // ── tables (own-property lookups only) ─────────────────────────────────
  const { boxKey, largestWireSize } = input;
  if (!own(BF_BOXES, boxKey)) return fail('BOX_NOT_IN_TABLE', { boxKey });
  if (!own(BF_VOL, largestWireSize)) return fail('WIRE_NOT_IN_TABLE', { largestWireSize });
  const box = BF_BOXES[boxKey];
  const volPerWire = BF_VOL[largestWireSize];

  // ── counts and booleans ────────────────────────────────────────────────
  const numConductors = input.numConductors === undefined ? 0 : input.numConductors;
  const numDevices = input.numDevices === undefined ? 0 : input.numDevices;
  const numSupportFittings = input.numSupportFittings === undefined ? 0 : input.numSupportFittings;
  for (const [name, value] of [['numConductors', numConductors], ['numDevices', numDevices], ['numSupportFittings', numSupportFittings]]) {
    const e = checkCount(name, value, false); if (e) return e;
  }
  const hasClamps = input.hasClamps === undefined ? false : input.hasClamps;
  if (typeof hasClamps !== 'boolean') return fail('INVALID_BOOLEAN', { field: 'hasClamps', value: input.hasClamps });
  const extensionVolume = input.extensionVolume === undefined ? 0 : input.extensionVolume;
  if (typeof extensionVolume !== 'number' || !Number.isFinite(extensionVolume) || extensionVolume < 0 || extensionVolume > MAX_VOLUME) {
    return fail('INVALID_EXTENSION', { extensionVolume: input.extensionVolume });
  }

  // ── EGC: explicit in v2; legacy boolean only through the compatibility path ──
  let egcCount; let egcSize = null; let legacyCompatibility = null;
  const hasLegacyFlag = input.hasEgc !== undefined;
  const hasNewFields = input.egcCount !== undefined || input.egcSize !== undefined;
  if (contract === CONTRACT) {
    const e = checkCount('egcCount', input.egcCount, true); if (e) return e;
    egcCount = input.egcCount;
    if (hasLegacyFlag) {
      if (typeof input.hasEgc !== 'boolean') return fail('INVALID_BOOLEAN', { field: 'hasEgc', value: input.hasEgc });
      if (input.hasEgc !== (egcCount > 0)) return fail('CONTRADICTORY_INPUT', { field: 'hasEgc', hasEgc: input.hasEgc, egcCount });
    }
  } else {
    if (hasNewFields) return fail('CONTRADICTORY_INPUT', { field: 'egcCount', detail: 'legacy input carries contract-2 EGC fields' });
    if (!hasLegacyFlag) return fail('EGC_DETAILS_REQUIRED', { requiresReview: true, detail: 'legacy input has no grounding information; missing is not zero' });
    if (typeof input.hasEgc !== 'boolean') return fail('INVALID_BOOLEAN', { field: 'hasEgc', value: input.hasEgc });
    if (input.hasEgc) return fail('EGC_DETAILS_REQUIRED', { requiresReview: true, detail: 'legacy hasEgc:true cannot state the entering count or size' });
    egcCount = 0;
    legacyCompatibility = 'HAS_EGC_FALSE_AS_ZERO';
  }
  let egcAllowance = 0;
  if (egcCount > 0) {
    if (input.egcSize === undefined || input.egcSize === null || input.egcSize === '') return fail('EGC_SIZE_REQUIRED', { egcCount });
    if (!own(BF_VOL, input.egcSize)) return fail('WIRE_NOT_IN_TABLE', { egcSize: input.egcSize });
    egcSize = input.egcSize;
    egcAllowance = BF_VOL[egcSize];
    if (egcAllowance > volPerWire) {
      // The bounded model prices clamps/devices/fittings with the governing
      // size. An entering EGC larger than that bound would silently undercount
      // those allowances, so it is an inconsistency to correct — not a case to guess.
      return fail('EGC_LARGER_THAN_GOVERNING', { egcSize, largestWireSize, detail: 'set largestWireSize to at least the largest entering EGC/bonding jumper' });
    }
  }
  const egcFactor = egcCount === 0 ? 0 : 1 + Math.max(0, egcCount - 4) / 4;
  const egcVolume = egcFactor * egcAllowance;

  // ── arithmetic, unrounded ──────────────────────────────────────────────
  const conductorVolume = numConductors * volPerWire;
  const deviceVolume = numDevices * 2 * volPerWire;
  const clampVolume = (hasClamps ? 1 : 0) * volPerWire;
  const fittingVolume = numSupportFittings * volPerWire;
  const nonConductor = deviceVolume + clampVolume + egcVolume + fittingVolume;
  const requiredVolume = conductorVolume + nonConductor;
  const availableVolume = box.vol + extensionVolume;
  const remainingRaw = availableVolume - requiredVolume;
  for (const v of [requiredVolume, availableVolume, remainingRaw]) if (!Number.isFinite(v)) return fail('NON_FINITE');

  const result = {
    ok: true,
    contract: CONTRACT,
    ruleBasis: RULE_BASIS,
    boxVolume: round2(availableVolume),
    volPerWire,
    conductorVolume: round2(conductorVolume),
    deviceVolume: round2(deviceVolume),
    clampVolume: round2(clampVolume),
    egcVolume: round2(egcVolume),
    fittingVolume: round2(fittingVolume),
    usedVolume: round2(requiredVolume),
    remaining: round2(remainingRaw),
    fillPercent: availableVolume > 0 ? round1((requiredVolume / availableVolume) * 100) : 0,
    maxConductors: Math.max(0, Math.floor((availableVolume - nonConductor) / volPerWire)),
    fits: requiredVolume <= availableVolume,          // unrounded, always
    requiredVolume,
    availableVolume,
    remainingRaw,
    // OVER, yet the two-decimal display values would read as fitting: the
    // renderer must show more digits. Decided HERE so no DOM code compares volumes.
    roundingAmbiguous: requiredVolume > availableVolume && round2(requiredVolume) <= round2(availableVolume),
    deviceAllowance: 2 * volPerWire,                  // per yoke, (B)(4)
    clampAllowance: volPerWire,                       // single allowance, (B)(2)
    egc: { count: egcCount, size: egcSize, allowance: egcAllowance, factor: egcFactor, volume: egcVolume },
    display: displayContract(requiredVolume, availableVolume, remainingRaw),
  };
  if (legacyCompatibility) result.legacyCompatibility = legacyCompatibility;
  return result;
}
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * DISPLAY-PRECISION CONTRACT (EC-CALC-1 R1). Presentation only — it never
 * touches the verdict. All three boundary values are rendered from the RAW
 * fields with ONE shared number of decimals, chosen deterministically as the
 * smallest d (2..12) at which required and available print differently AND
 * the printed remaining is non-zero. So a positive excess can never appear
 * as "-0.00", and Total Volume can never read larger than Volume Required
 * while the verdict is OVER. Exact equality prints at 2 decimals.
 */
function displayContract(required, available, remaining) {
  let decimals = 2;
  if (remaining !== 0) {
    const exact = (x, d) => Math.abs(Number(x.toFixed(d)) - x) < 1e-9;   // prints the raw value (float noise aside)
    let found = false;
    for (let d = 2; d <= 6 && !found; d++) {          // prefer the precision that shows both values exactly
      if (exact(required, d) && exact(available, d) && Number(remaining.toFixed(d)) !== 0) { decimals = d; found = true; }
    }
    for (let d = 2; d <= 12 && !found; d++) {         // otherwise the smallest distinguishing precision
      decimals = d;
      if (required.toFixed(d) !== available.toFixed(d) && Number(remaining.toFixed(d)) !== 0) found = true;
    }
  }
  return {
    decimals,
    required: required.toFixed(decimals),
    available: available.toFixed(decimals),
    remaining: remaining.toFixed(decimals),
  };
}
module.exports = { calculateBoxFill, CONTRACT, RULE_BASIS };
