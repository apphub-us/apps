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

/**
 * NEC 2020 240.4(D) — Small Conductors.
 *
 * "Unless specifically permitted in 240.4(E) or 240.4(G), the overcurrent
 * protection shall not exceed that required by (D)(1) through (D)(7) AFTER any
 * correction factors for ambient temperature and number of conductors have
 * been applied."
 *
 * This limits the OVERCURRENT DEVICE, not the conductor's ampacity. #12 THHN
 * really is 30 A in Table 310.16; the rule caps the breaker at 20 A.
 *
 * Material-specific — aluminium and copper-clad aluminium are lower than copper
 * at the same size. NYC: NYCEC 2025 does not amend Article 240.
 */
const SMALL_CONDUCTOR_OCPD_LIMIT = {
  cu: { '18': 7, '16': 10, '14': 15, '12': 20, '10': 30 },
  al: { '12': 15, '10': 25 },
};

/**
 * Maximum overcurrent device permitted by 240.4(D) for a conductor size.
 * @returns {number|null} null when the size is outside the small-conductor rule
 */
function smallConductorOcpdLimit(size, material) {
  const table = material === 'al' ? SMALL_CONDUCTOR_OCPD_LIMIT.al : SMALL_CONDUCTOR_OCPD_LIMIT.cu;
  const limit = table[size];
  return limit === undefined ? null : limit;
}

/** Back-compat alias for the copper table. Prefer smallConductorOcpdLimit(). */
const SMALL_CONDUCTOR_MAX = SMALL_CONDUCTOR_OCPD_LIMIT.cu;

/**
 * NEC 2020 Table 310.15(B)(1) band upper bounds, °F. Ascending.
 * The correct lookup is "first band whose bound >= ambient", never nearest.
 */
const TEMP_BANDS = [50, 59, 68, 77, 86, 95, 104, 113, 122, 131, 140, 149, 158, 167, 176, 185];

/** Highest ambient the table covers at all. */
const MAX_TABLE_AMBIENT_F = 185;

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

/** Conductor temperature rating implied by the insulation, °C. */
function insulationRatingC(insulType) {
  if (insulType === 'tw') return 60;
  if (insulType === 'thw') return 75;
  return 90;
}

/**
 * Ambient temperature correction factor, NEC Table 310.15(B)(1).
 *
 * Returns a structured outcome rather than a bare number, because three
 * different things can happen and they are NOT interchangeable:
 *
 *   ok: true                          a table factor applies
 *   AMBIENT_ABOVE_TABLE               ambient exceeds 185°F — past the end of
 *                                     the table for every conductor rating
 *   TABLE_FACTOR_UNAVAILABLE_FOR_RATING
 *                                     the band exists but the table prints "—"
 *                                     for this conductor rating, e.g. a 60°C
 *                                     conductor at 140°F.
 *
 * The second condition reports ONLY what the table says. NEC 2020 310.15(B)
 * permits correction by the table OR by the equation given in that section, so
 * a dash does not by itself make the installation non-compliant: within a band
 * the equation can still yield a usable factor (a 60°C conductor at 133°F
 * computes to ~0.36 where the table prints "—", because the table publishes the
 * worst case of each 5°C band). This module does not implement the equation
 * method, so it says what the table does and stops there.
 *
 * @param {number} ambientF
 * @param {string} insulType 'tw' | 'thw' | 'thhn' | 'xhhw'
 * @returns {{ok:boolean, factor?:number, band?:string, reason?:string, conductorRatingC?:number}}
 */
function lookupTempCorrection(ambientF, insulType) {
  if (!Number.isFinite(ambientF)) {
    return { ok: false, reason: 'INVALID_AMBIENT' };
  }
  const key = insulationFactorKey(insulType);
  const ratingC = insulationRatingC(insulType);

  for (const bound of TEMP_BANDS) {
    if (ambientF <= bound) {
      const row = AMP_TEMP_LOOKUP[bound];
      if (!row) return { ok: false, reason: 'BAND_MISSING_FROM_TABLE' };
      const factor = row[key];
      if (factor === null || factor === undefined) {
        return {
          ok: false,
          reason: 'TABLE_FACTOR_UNAVAILABLE_FOR_RATING',
          band: row.band,
          conductorRatingC: ratingC,
        };
      }
      return { ok: true, factor, band: row.band, conductorRatingC: ratingC };
    }
  }
  return { ok: false, reason: 'AMBIENT_ABOVE_TABLE', maxTableAmbientF: MAX_TABLE_AMBIENT_F };
}

/**
 * Convenience wrapper returning just the number, or null when no factor
 * applies for any reason. Prefer lookupTempCorrection() where the caller
 * needs to tell the two failure modes apart.
 */
function tempCorrectionFactor(ambientF, insulType) {
  const r = lookupTempCorrection(ambientF, insulType);
  return r.ok ? r.factor : null;
}

/**
 * NEC 2020 310.15(B)(2) "Rooftop" — structured rule metadata.
 *
 * Provenance
 *   NEC 2020 §310.15(B)(2). Renumbered from 2017 §310.15(B)(3)(c); the tiered
 *   adder Table 310.15(B)(3)(c) of the 2014 NEC was deleted in 2017 and the
 *   single 33°C (60°F) adder retained.
 *   NYC: NYCEC 2025 adopts the 2020 NEC. Its amendment list (§ 28-1101.3)
 *   touches Article 310 only at Tables 310.16, 310.17 and 310.20 (deleting
 *   Type XHWN from the 90°C columns). 310.15(B)(2) is NOT amended, so the
 *   national rule applies unchanged in New York City.
 *   Forward note: the 2023 NEC lowers the threshold to 3/4 in. NYC is on the
 *   2020 NEC, so 7/8 in. is correct here until NYC adopts a later edition.
 */
const ROOFTOP_RULE = {
  code: 'NEC 2020 310.15(B)(2)',
  adderF: 60,              // 33°C
  minClearanceInches: 0.875, // 7/8 in. (23 mm)
  exceptInsulation: ['xhhw'], // Type XHHW-2
  nycAmended: false,
};

/**
 * Decide whether the rooftop temperature adder applies.
 *
 * All four conditions must hold: on or above a roof, exposed to direct
 * sunlight, clearance below the minimum, and a conductor type not excepted.
 * The reason code is returned either way so the UI can explain itself.
 *
 * @param {object} [rooftop]
 * @param {boolean} [rooftop.onOrAboveRoof]
 * @param {boolean} [rooftop.directSunlight]
 * @param {number}  [rooftop.clearanceInches] roof surface to bottom of raceway
 * @param {string} insulation
 * @returns {{applied:boolean, adderF:number, reason:string}}
 */
function evaluateRooftopAdjustment(rooftop, insulation) {
  if (!rooftop || !rooftop.onOrAboveRoof) {
    return { applied: false, adderF: 0, reason: 'NOT_ON_ROOF' };
  }
  if (!rooftop.directSunlight) {
    return { applied: false, adderF: 0, reason: 'NO_DIRECT_SUNLIGHT' };
  }
  const clearance = Number(rooftop.clearanceInches);
  if (!Number.isFinite(clearance)) {
    return { applied: false, adderF: 0, reason: 'CLEARANCE_UNKNOWN' };
  }
  if (clearance >= ROOFTOP_RULE.minClearanceInches) {
    // "less than 7/8 in." — exactly 7/8 is compliant clearance.
    return { applied: false, adderF: 0, reason: 'CLEARANCE_AT_OR_ABOVE_MINIMUM' };
  }
  if (ROOFTOP_RULE.exceptInsulation.indexOf(insulation) !== -1) {
    return { applied: false, adderF: 0, reason: 'XHHW2_EXCEPTION' };
  }
  return { applied: true, adderF: ROOFTOP_RULE.adderF, reason: 'APPLIED' };
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
    terminalRatingC = 75,
    /**
     * Rooftop conditions per NEC 310.15(B)(2). The adder is DERIVED from these,
     * never passed in — there is exactly one implementation of the rule.
     * Omit entirely for a non-rooftop installation.
     */
    rooftop = null,
  } = input || {};

  const table = material === 'al' ? AMP_AL : AMP_CU;
  const row = table[size];
  if (!row) {
    return { ok: false, reason: 'SIZE_NOT_IN_TABLE', size, material };
  }

  const baseAmpacity = row[insulationColumn(insulation)];
  const roof = evaluateRooftopAdjustment(rooftop, insulation);
  const effectiveAmbientF = ambientF + roof.adderF;
  const temp = lookupTempCorrection(effectiveAmbientF, insulation);

  if (!temp.ok) {
    return {
      ok: false,
      reason: temp.reason,
      // Context for callers rendering per-size rows: the size exists and has
      // a table value even though no correction factor is published for it.
      baseAmpacity,
      terminalLimit: terminalRatingC === 60 ? row.t60 : row.t75,
      conductorRatingC: temp.conductorRatingC,
      temperatureBand: temp.band,
      ambientF,
      rooftopAdjustmentApplied: roof.applied,
      rooftopAdderF: roof.adderF,
      rooftopAdjustmentReason: roof.reason,
      rooftopRule: ROOFTOP_RULE.code,
      effectiveAmbientF,
      note: temp.reason === 'AMBIENT_ABOVE_TABLE'
        ? 'Above ' + MAX_TABLE_AMBIENT_F + '°F, NEC Table 310.15(B)(1) publishes no factor for any conductor rating.'
        : 'No correction factor is provided in Table 310.15(B)(1) for a '
          + temp.conductorRatingC + '°C conductor at the calculated ambient temperature ('
          + temp.band + '). NEC 310.15(B) also permits correction by equation; this tool '
          + 'reports the table only.',
    };
  }

  const correction = temp.factor;
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
    temperatureBand: temp.band,
    conductorRatingC: temp.conductorRatingC,
    adjustmentFactor,
    ambientF,
    rooftopAdjustmentApplied: roof.applied,
    rooftopAdderF: roof.adderF,
    rooftopAdjustmentReason: roof.reason,
    rooftopRule: ROOFTOP_RULE.code,
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
  const { allowNextSizeUp = true, material = 'cu' } = opts;

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

  // NEC 240.4(D) overrides everything above for small conductors. It is NOT
  // qualified by 240.4(B), so the next-size-up rule cannot lift this cap.
  const smallCap = smallConductorOcpdLimit(size, material);
  let cappedBySmallConductorRule = false;
  if (smallCap !== null && rating !== null && rating > smallCap) {
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
  lookupTempCorrection,
  TEMP_BANDS,
  MAX_TABLE_AMBIENT_F,
  maxOvercurrentDevice,
  smallConductorOcpdLimit,
  SMALL_CONDUCTOR_OCPD_LIMIT,
  evaluateRooftopAdjustment,
  ROOFTOP_RULE,
  insulationColumn,
  STANDARD_OCPD,
  SMALL_CONDUCTOR_MAX,
};
