'use strict';
/**
 * Voltage drop — VD = (multiplier x K x I x L) / CM
 * NEC 210.19(A) / 215.2(A) informational notes (base NEC, not enforceable).
 * NYCEC 210.19(A) / 215.2(A)(1): 5% total, service point to farthest outlet,
 * feeder + branch combined — MANDATORY in NYC.
 */
const { VD_CM, VD_K, AMP_CU, AMP_AL } = require('./tables');

const PHASE_MULTIPLIER = { 1: 2, 3: 1.732 }; // 1.732 is trade-standard for sqrt(3)

/**
 * Ascending conductor order. VD_CM is keyed in source order, NOT by size, so
 * iterating Object.keys() returns an oversized conductor. This list is the
 * single source of search order.
 */
const ASCENDING_SIZES = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0',
  '2/0', '3/0', '4/0', '250', '300', '350', '400', '500', '600', '700', '750'];

function calculateVoltageDrop(input) {
  const { amps, feet, voltage, phase = 1, material = 'cu', size } = input || {};
  const cm = VD_CM[size];
  const K = VD_K[material];
  if (!cm) return { ok: false, reason: 'SIZE_NOT_IN_TABLE', size };
  if (K === undefined) return { ok: false, reason: 'UNKNOWN_MATERIAL', material };
  if (!(amps > 0)) return { ok: false, reason: 'INVALID_AMPS', amps };
  if (!(feet > 0)) return { ok: false, reason: 'INVALID_DISTANCE', feet };
  if (!(voltage > 0)) return { ok: false, reason: 'INVALID_VOLTAGE', voltage };

  const mult = PHASE_MULTIPLIER[Number(phase)];
  if (!mult) return { ok: false, reason: 'INVALID_PHASE', phase };

  const drop = (mult * K * amps * feet) / cm;
  return {
    ok: true,
    multiplier: mult, K, circularMils: cm,
    voltageDrop: round3(drop),
    percentDrop: round3((drop / voltage) * 100),
    voltageAtLoad: round2(voltage - drop),
    // Exact values for consumers that format for display themselves: a
    // renderer must round ONCE from the raw number (round3 then toFixed can
    // move the last display digit — e.g. 7.35461 -> 7.355 -> "7.36" where
    // single rounding gives "7.35").
    voltageDropExact: drop,
    percentDropExact: (drop / voltage) * 100,
    voltageAtLoadExact: voltage - drop,
  };
}

/** Smallest conductor meeting a voltage-drop limit. */
function minSizeForVoltageDrop(input) {
  const { amps, feet, voltage, phase = 1, material = 'cu', maxPercent = 5, sizes } = input || {};
  const list = sizes || ASCENDING_SIZES;
  for (const size of list) {
    const r = calculateVoltageDrop({ amps, feet, voltage, phase, material, size });
    if (r.ok && r.percentDrop <= maxPercent) return { ok: true, size, ...r };
  }
  return { ok: false, reason: 'NO_SIZE_MEETS_LIMIT', maxPercent };
}
/**
 * The standalone Voltage Drop panel's full decision: a joint VD + 75C-column
 * ampacity recommendation plus a per-size comparison row set. Owns everything
 * the panel decides — the minimum-circular-mil inversion, per-size drop /
 * percent / voltage-at-load (via calculateVoltageDrop, the ONE formula
 * implementation), the 75C ampacity check from the shared AMP tables (never a
 * second copy), the pass/fail against the target, and the recommendation.
 *
 * Selection and pass/fail use RAW (unrounded) arithmetic, exactly like the
 * legacy panel: percent <= target is algebraically cm >= minCircularMils, so
 * one inversion serves both and no rounded display value ever decides
 * anything.
 */
function analyzeVoltageDrop(input) {
  const {
    amps, feet, voltage, phase = 1, material = 'cu', maxPercent,
  } = input || {};
  const K = VD_K[material];
  if (K === undefined) return { ok: false, reason: 'UNKNOWN_MATERIAL', material };
  const mult = PHASE_MULTIPLIER[Number(phase)];
  if (!mult) return { ok: false, reason: 'INVALID_PHASE', phase };
  if (typeof amps !== 'number' || !Number.isFinite(amps) || amps <= 0) {
    return { ok: false, reason: 'INVALID_AMPS', amps };
  }
  if (typeof feet !== 'number' || !Number.isFinite(feet) || feet <= 0) {
    return { ok: false, reason: 'INVALID_DISTANCE', feet };
  }
  if (typeof voltage !== 'number' || !Number.isFinite(voltage) || voltage <= 0) {
    return { ok: false, reason: 'INVALID_VOLTAGE', voltage };
  }
  if (typeof maxPercent !== 'number' || !Number.isFinite(maxPercent) || maxPercent <= 0) {
    return { ok: false, reason: 'INVALID_TARGET', maxPercent };
  }

  const ampTable = material === 'cu' ? AMP_CU : AMP_AL;
  const maxVoltageDrop = voltage * (maxPercent / 100);
  // The one algebraic inversion of the drop formula: the smallest circular-mil
  // area whose raw drop meets the target.
  const minCM = (mult * K * amps * feet) / maxVoltageDrop;

  let recommendedSize = null;
  const rows = ASCENDING_SIZES.map((size) => {
    const cm = VD_CM[size];
    const r = calculateVoltageDrop({ amps, feet, voltage, phase, material, size });
    const ampacity75C = ampTable[size] ? ampTable[size].t75 : 0;
    const ampacityOK = ampacity75C >= amps;
    const passesVdTarget = cm >= minCM;         // raw algebra, never rounded %
    const meetsBoth = passesVdTarget && ampacityOK;
    if (recommendedSize === null && meetsBoth) recommendedSize = size;
    return {
      size,
      circularMils: cm,
      // exact values: display rounding is the renderer's single-step job
      voltageDrop: r.voltageDropExact,
      percentDrop: r.percentDropExact,
      voltageAtLoad: r.voltageAtLoadExact,
      ampacity75C,
      ampacityOK,
      passesVdTarget,
      meetsBoth,
    };
  });
  rows.forEach((row) => { row.isRecommended = row.size === recommendedSize; });

  return {
    ok: true,
    material, K,
    phase: Number(phase), multiplier: mult,
    amps, feet, voltage, maxPercent,
    maxVoltageDrop: round3(maxVoltageDrop),
    minCircularMils: Math.ceil(minCM),
    recommendedSize,
    recommended: recommendedSize === null ? null
      : rows.find((row) => row.size === recommendedSize),
    rows,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
module.exports = {
  calculateVoltageDrop, minSizeForVoltageDrop, analyzeVoltageDrop,
  PHASE_MULTIPLIER, ASCENDING_SIZES,
};
