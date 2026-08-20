'use strict';
/**
 * Ampacity — NEC 310.15, Table 310.16, Table 310.15(B)(1), 110.14(C), 240.4
 *
 * Pure functions. No DOM, no network, no globals.
 *
 * PORTING NOTE
 * ------------
 * These are faithful ports of the logic currently shipping in mobile.html,
 * EXCEPT where a divergence is marked `DIVERGENCE:` with evidence. Behaviour
 * that the audit flagged as suspect is preserved here and covered by a `todo`
 * test so the finding stays visible without blocking CI.
 */

const { AMP_CU, AMP_AL, AMP_TEMP_LOOKUP } = require('./tables');

/** NEC 240.6(A) standard overcurrent device ratings. */
const STANDARD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110,
  125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600];

/** NEC 240.4(D) — small conductor overcurrent limits (copper). */
const SMALL_CONDUCTOR_MAX = { '14': 15, '12': 20, '10': 30 };

/**
 * NEC Table 310.15(B)(1) is a RANGE table in °F:
 *   70-77, 78-86, 87-95, 96-104, 105-113, 114-122, 123-131, 132-140
 * The correct lookup is "first band whose upper bound >= ambient", NOT nearest.
 */
const TEMP_BANDS = [50, 60, 70, 77, 86, 95, 104, 113, 122, 131, 140];

function insulationColumn(insulType) {
  if (insulType === 'tw') return 't60';
  if (insulType === 'thw') return 't75';
  return 't90'; // thhn, thwn-2, xhhw-2
}

function insulationFactorKey(insulType) {
  if (insulType === 'tw') return 'f60';
  if (insulType === 'thw') return 'f75';
  return 'f90';
}

/**
 * Ambient temperature correction factor.
 *
 * DIVERGENCE (P0-1) from mobile.html: the shipped app picks the NEAREST band,
 * which rounds an ambient of 88°F down to the 86°F row (factor 1.00) when NEC
 * places 88°F in the 87-95°F band (factor 0.96 at 90°C). Nearest-match
 * OVERSTATES ampacity. This implementation uses band containment.
 * Evidence: NEC Table 310.15(B)(1)(b), ranges as listed above.
 *
 * @param {number} ambientF ambient temperature, °F
 * @param {string} insulType 'tw' | 'thw' | 'thhn' | 'xhhw'
 * @returns {number|null} correction factor, or null if above the table
 */
function tempCorrectionFactor(ambientF, insulType) {
  if (!Number.isFinite(ambientF)) return null;
  const key = insulationFactorKey(insulType);
  for (const band of TEMP_BANDS) {
    if (ambientF <= band) {
      const row = AMP_TEMP_LOOKUP[band];
      return row ? row[key] : null;
    }
  }
  // Above 140°F the table does not extend — conductor not permitted.
  return null;
}

/**
 * Faithful port of the shipped nearest-band lookup. Kept ONLY so tests can
 * demonstrate the divergence. Do not use in production paths.
 */
function tempCorrectionFactorLegacy(ambientF, insulType) {
  let closest = TEMP_BANDS[0];
  for (const band of TEMP_BANDS) {
    if (Math.abs(band - ambientF) < Math.abs(closest - ambientF)) closest = band;
  }
  const row = AMP_TEMP_LOOKUP[closest];
  if (!row) return 1.0;
  return row[insulationFactorKey(insulType)];
}

/**
 * Full ampacity calculation for one conductor size.
 *
 * @param {object} input
 * @param {string} input.size            e.g. '12', '3/0', '250'
 * @param {string} [input.material]      'cu' | 'al'            (default 'cu')
 * @param {string} [input.insulation]    'tw'|'thw'|'thhn'|'xhhw' (default 'thhn')
 * @param {number} [input.ambientF]      ambient °F             (default 86)
 * @param {number} [input.adjustmentFactor] NEC Table 310.15(C)(1) CCC factor (default 1.0)
 * @param {number} [input.rooftopAdderF] °F added to ambient    (default 0)
 * @param {number} [input.terminalRatingC] 60 or 75             (default 75)
 * @returns {object} structured result
 */
function calculateAmpacity(input) {
  const {
    size,
    material = 'cu',
    insulation = 'thhn',
    ambientF = 86,
    adjustmentFactor = 1.0,
    rooftopAdderF = 0,
    terminalRatingC = 75,
    /**
     * COMPATIBILITY SHIM — remove once P0-1 is approved.
     *
     * 'band'    NEC-correct: the first band whose upper bound >= ambient.
     * 'nearest' Reproduces the numerically-closest lookup shipping in
     *           mobile.html, which returns 1.00 at 88 °F where the code
     *           requires 0.96.
     *
     * Default is the correct behaviour. The production adapter opts INTO
     * 'nearest' explicitly, so the divergence is one visible argument rather
     * than a silent difference, and fixing P0-1 is a one-line change there.
     */
    tempLookupMode = 'band',
  } = input || {};

  const table = material === 'al' ? AMP_AL : AMP_CU;
  const row = table[size];
  if (!row) {
    return { ok: false, reason: 'SIZE_NOT_IN_TABLE', size, material };
  }

  const baseAmpacity = row[insulationColumn(insulation)];
  const effectiveAmbientF = ambientF + rooftopAdderF;
  const correction = tempLookupMode === 'nearest'
    ? tempCorrectionFactorLegacy(effectiveAmbientF, insulation)
    : tempCorrectionFactor(effectiveAmbientF, insulation);

  if (correction === null) {
    return {
      ok: false,
      reason: 'AMBIENT_ABOVE_TABLE',
      effectiveAmbientF,
      note: 'NEC Table 310.15(B)(1) does not extend above 140°F.',
    };
  }

  const afterCorrection = baseAmpacity * correction;
  const afterAdjustment = afterCorrection * adjustmentFactor;

  // NEC 110.14(C) termination limit. See audit P1-3: which column applies is
  // equipment-dependent, not conductor-dependent.
  const terminalLimit = terminalRatingC === 60 ? row.t60 : row.t75;
  const finalAmpacity = Math.min(afterAdjustment, terminalLimit);

  return {
    ok: true,
    size,
    material,
    insulation,
    baseAmpacity,
    correctionFactor: correction,
    adjustmentFactor,
    effectiveAmbientF,
    afterCorrection: round2(afterCorrection),
    afterAdjustment: round2(afterAdjustment),
    terminalLimit,
    terminalLimitGoverns: terminalLimit < afterAdjustment,
    finalAmpacity: round2(finalAmpacity),
    /**
     * Unrounded value. round2() above is for display; flooring it can differ
     * from flooring the raw product by 1 A because IEEE-754 makes
     * 100 * 0.58 = 57.999999999999993. Callers reproducing pre-migration
     * behaviour must floor THIS field. Tracked as P1-9.
     */
    finalAmpacityRaw: finalAmpacity,
    tempLookupMode,
    derated: correction < 1.0 || adjustmentFactor < 1.0,
  };
}

/**
 * Maximum overcurrent device for a conductor, per NEC 240.4.
 *
 * @param {number} ampacity   conductor ampacity after all correction/adjustment
 * @param {string} size       conductor size (for the 240.4(D) small-conductor rule)
 * @param {object} [opts]
 * @param {boolean} [opts.allowNextSizeUp] apply 240.4(B) (default true)
 * @returns {object}
 */
function maxOvercurrentDevice(ampacity, size, opts = {}) {
  const { allowNextSizeUp = true } = opts;

  let rating;
  const exact = STANDARD_OCPD.includes(ampacity);

  if (exact) {
    rating = ampacity;
  } else if (allowNextSizeUp && ampacity < 800) {
    // NEC 240.4(B): next standard size up is permitted when the conductor
    // ampacity does not correspond to a standard rating and the circuit is
    // not a multi-outlet receptacle branch circuit.
    rating = STANDARD_OCPD.find((b) => b >= ampacity) ?? null;
  } else {
    // NEC 240.4(C) / >800 A: next standard size DOWN.
    rating = [...STANDARD_OCPD].reverse().find((b) => b <= ampacity) ?? null;
  }

  // NEC 240.4(D) overrides everything above for small conductors.
  const smallCap = SMALL_CONDUCTOR_MAX[size];
  let cappedBySmallConductorRule = false;
  if (smallCap !== undefined && rating !== null && rating > smallCap) {
    rating = smallCap;
    cappedBySmallConductorRule = true;
  }

  return { rating, cappedBySmallConductorRule, exactMatch: exact };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  calculateAmpacity,
  tempCorrectionFactor,
  tempCorrectionFactorLegacy,
  maxOvercurrentDevice,
  insulationColumn,
  STANDARD_OCPD,
  SMALL_CONDUCTOR_MAX,
};
