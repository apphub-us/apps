'use strict';
/**
 * Standalone Voltage Drop migration parity harness.
 *
 * `legacyDecision()` is the electrical decision logic of the PRE-MIGRATION
 * production `vdUpdateCalc()` + `vdCalcDrop()` (mobile.html), transcribed
 * verbatim minus DOM: VD = (mult x K x I x L_oneWay) / CM with mult 2 (1ph) /
 * 1.732 (3ph), the minimum-circular-mil inversion against the target, the
 * joint VD + 75C-ampacity recommendation scan, and the per-size comparison
 * rows (drop, percent, voltage at load, ampacity check, target check).
 *
 * PURPOSE: migration guard only — proves the shared engine reproduces every
 * shipped decision across the full supported domain before production is
 * switched. NOT engineering proof; the formula is independently pinned in
 * voltageDrop.test.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { VD_CM, VD_K, AMP_CU, AMP_AL } = require('../src/calc/tables');
const { analyzeVoltageDrop, ASCENDING_SIZES } = require('../src/calc/voltageDrop');

/** Legacy hand 75C tables, byte-for-byte as shipped (note: no '14' Al). */
const VD_AMP_CU = { '14': 20, '12': 25, '10': 35, '8': 50, '6': 65, '4': 85,
  '3': 100, '2': 115, '1': 130, '1/0': 150, '2/0': 175, '3/0': 200, '4/0': 230,
  '250': 255, '300': 285, '350': 310, '400': 335, '500': 380, '600': 420,
  '700': 460, '750': 475 };
const VD_AMP_AL = { '12': 20, '10': 30, '8': 40, '6': 50, '4': 65, '3': 75,
  '2': 90, '1': 100, '1/0': 120, '2/0': 135, '3/0': 155, '4/0': 180,
  '250': 205, '300': 230, '350': 250, '400': 270, '500': 310, '600': 340,
  '700': 375, '750': 385 };

/** The pre-migration decision, DOM stripped. Do not "improve" it. */
function legacyDecision(input) {
  const { amps, feet, voltage, mat } = input;
  const phase = String(input.phase);
  const maxPct = input.maxPct;
  const K = VD_K[mat];
  const multiplier = phase === '3' ? 1.732 : 2;
  const maxVDrop = voltage * (maxPct / 100);
  const ampTable = mat === 'cu' ? VD_AMP_CU : VD_AMP_AL;
  const minCM = (multiplier * K * amps * feet) / maxVDrop;

  let minSize = null;
  const rows = [];
  for (const size of ASCENDING_SIZES) {
    const cm = VD_CM[size];
    const vDrop = (multiplier * K * amps * feet) / cm;
    const pct = (vDrop / voltage) * 100;
    const wireAmp = ampTable[size] || 0;
    const ampOK = wireAmp >= amps;
    if (minSize === null && cm >= minCM && ampOK) minSize = size;
    rows.push({ size, vDrop, pct, vAtLoad: voltage - vDrop, wireAmp, ampOK,
      passes: pct <= maxPct });
  }
  return { minCM, minSize, rows };
}

function engineDecision(input) {
  return analyzeVoltageDrop({
    amps: input.amps, feet: input.feet, voltage: input.voltage,
    phase: Number(input.phase), material: input.mat, maxPercent: input.maxPct,
  });
}

function compareCase(input, label) {
  const legacy = legacyDecision(input);
  const eng = engineDecision(input);
  assert.strictEqual(eng.ok, true, label + ': engine rejected: ' + eng.reason);
  assert.strictEqual(eng.recommendedSize, legacy.minSize, label + ' recommendedSize');
  assert.strictEqual(eng.minCircularMils, Math.ceil(legacy.minCM),
    label + ' minCircularMils');
  assert.strictEqual(eng.rows.length, legacy.rows.length, label);
  for (let i = 0; i < legacy.rows.length; i++) {
    const l = legacy.rows[i];
    const e = eng.rows[i];
    const rl = label + ' ' + l.size;
    assert.strictEqual(e.size, l.size, rl);
    // rows carry EXACT values, so display strings round once, like legacy:
    // the comparison is strict equality, not an epsilon
    assert.strictEqual(e.voltageDrop, l.vDrop, rl + ' vDrop');
    assert.strictEqual(e.percentDrop, l.pct, rl + ' pct');
    assert.strictEqual(e.voltageAtLoad, l.vAtLoad, rl + ' vAtLoad');
    assert.strictEqual(e.ampacity75C, l.wireAmp, rl + ' ampacity75C');
    assert.strictEqual(e.ampacityOK, l.ampOK, rl + ' ampacityOK');
    assert.strictEqual(e.passesVdTarget, l.passes, rl + ' passesVdTarget');
    assert.strictEqual(e.isRecommended, legacy.minSize === l.size, rl);
  }
}

describe('Standalone Voltage Drop migration parity — legacy decision vs shared engine', () => {
  const VOLTAGES = [120, 208, 240, 277, 480];   // every UI option
  const TARGETS = [2, 3, 5];                     // every UI option
  const AMPS = [1, 15, 42.5, 100, 347, 1200, 2000];
  const FEET = [1, 25, 150, 732, 5000];

  test('the full option cross agrees: material x phase x voltage x target x amps x feet', () => {
    let cases = 0;
    for (const mat of ['cu', 'al']) {
      for (const phase of ['1', '3']) {
        for (const voltage of VOLTAGES) {
          for (const maxPct of TARGETS) {
            for (const amps of AMPS) {
              for (const feet of FEET) {
                compareCase({ mat, phase, voltage, maxPct, amps, feet },
                  `${mat}/${phase}ph/${voltage}V/${maxPct}%/${amps}A/${feet}ft`);
                cases++;
              }
            }
          }
        }
      }
    }
    assert.strictEqual(cases, 2 * 2 * 5 * 3 * 7 * 5);
  });

  test('seeded random sweep across all axes agrees', () => {
    let seed = 0x0D120;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    for (let i = 0; i < 400; i++) {
      const input = {
        mat: pick(['cu', 'al']),
        phase: pick(['1', '3']),
        voltage: pick(VOLTAGES),
        maxPct: pick(TARGETS),
        amps: Math.round((0.5 + rnd() * 1999.5) * 10) / 10,
        feet: Math.round((1 + rnd() * 4999) * 10) / 10,
      };
      compareCase(input, 'random#' + i + ' ' + JSON.stringify(input));
    }
  });
});
