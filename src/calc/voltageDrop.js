'use strict';
/**
 * Voltage drop — VD = (multiplier x K x I x L) / CM
 * NEC 210.19(A) / 215.2(A) informational notes (base NEC, not enforceable).
 * NYCEC 210.19(A) / 215.2(A)(1): 5% total, service point to farthest outlet,
 * feeder + branch combined — MANDATORY in NYC.
 */
const { VD_CM, VD_K } = require('./tables');

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
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
module.exports = { calculateVoltageDrop, minSizeForVoltageDrop, PHASE_MULTIPLIER, ASCENDING_SIZES };
