'use strict';
/**
 * Box Fill migration parity harness.
 *
 * `legacyDecision()` is the electrical decision logic of the PRE-MIGRATION
 * production `bfUpdateCalc()` (mobile.html), transcribed verbatim minus DOM:
 * conductor / device(2x) / clamp(1x) / EGC(1x) allowances from the single
 * governing wire size, extension volume added to the box, summation,
 * remaining, fill percent, max-conductor headroom and the fits comparison.
 *
 * PURPOSE: a migration guard only — it proves the shared engine reproduces
 * the shipped decisions across the full supported input space, so switching
 * production onto the engine cannot silently change results. It is NOT proof
 * the legacy behaviour is code-correct; the NEC 314.16 rules are hard-tested
 * independently in boxFill.test.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { BF_VOL, BF_BOXES } = require('../src/calc/tables');
const { calculateBoxFill } = require('../src/calc/boxFill');

/** The pre-migration bfUpdateCalc decision, DOM stripped. Do not "improve". */
function legacyDecision(input) {
  const box = BF_BOXES[input.boxKey];
  const volPerWire = BF_VOL[input.wireSize];
  if (!box || !volPerWire) return null;   // legacy silently did nothing
  const numCond = input.numCond || 0;
  const numDev = input.numDev || 0;
  const hasClamps = input.hasClamps ? 1 : 0;
  const hasEgc = input.hasEgc ? 1 : 0;
  const extVol = input.extVol || 0;

  const condVol = numCond * volPerWire;
  const devVol = numDev * 2 * volPerWire;
  const clampVol = hasClamps * volPerWire;
  const egcVol = hasEgc * volPerWire;
  const totalUsed = condVol + devVol + clampVol + egcVol;
  const boxVol = box.vol + extVol;
  const remaining = boxVol - totalUsed;
  const pct = (totalUsed / boxVol) * 100;
  const fits = totalUsed <= boxVol;
  let maxCond = Math.floor((boxVol - devVol - clampVol - egcVol) / volPerWire);
  if (maxCond < 0) maxCond = 0;
  return { condVol, devVol, clampVol, egcVol, totalUsed, boxVol, remaining, pct, fits, maxCond };
}

function engineDecision(input) {
  return calculateBoxFill({
    boxKey: input.boxKey,
    largestWireSize: input.wireSize,
    numConductors: input.numCond || 0,
    numDevices: input.numDev || 0,
    hasClamps: !!input.hasClamps,
    hasEgc: !!input.hasEgc,
    extensionVolume: input.extVol || 0,
  });
}

const near = (a, b, eps, label) => assert.ok(Math.abs(a - b) <= eps,
  `${label}: legacy ${a} vs engine ${b}`);

function compareCase(input, label) {
  const legacy = legacyDecision(input);
  const eng = engineDecision(input);
  assert.ok(legacy, label + ': parity case must be in the valid domain');
  assert.strictEqual(eng.ok, true, label + ': engine rejected: ' + eng.reason);
  assert.strictEqual(eng.fits, legacy.fits, label + ' fits');
  assert.strictEqual(eng.maxConductors, legacy.maxCond, label + ' maxConductors');
  // engine rounds to 2 dp for display; legacy carried raw floats
  near(legacy.condVol, eng.conductorVolume, 0.005, label + ' conductorVolume');
  near(legacy.devVol, eng.deviceVolume, 0.005, label + ' deviceVolume');
  near(legacy.clampVol, eng.clampVolume, 0.005, label + ' clampVolume');
  near(legacy.egcVol, eng.egcVolume, 0.005, label + ' egcVolume');
  near(legacy.totalUsed, eng.usedVolume, 0.005, label + ' usedVolume');
  near(legacy.boxVol, eng.boxVolume, 0.005, label + ' boxVolume');
  near(legacy.remaining, eng.remaining, 0.005, label + ' remaining');
  near(legacy.pct, eng.fillPercent, 0.051, label + ' fillPercent');
}

describe('Box Fill migration parity — legacy production decision vs shared engine', () => {
  const WIRES = Object.keys(BF_VOL);          // 14, 12, 10, 8, 6
  const BOXES = Object.keys(BF_BOXES);        // all 27 supported boxes
  // The extension select offers fixed volumes; 0 plus a representative add.
  const EXTS = [0, 6.5, 21.0];

  test('every box x every wire size at a representative loadout agrees', () => {
    for (const boxKey of BOXES) {
      for (const wireSize of WIRES) {
        compareCase({ boxKey, wireSize, numCond: 4, numDev: 1,
          hasClamps: true, hasEgc: true }, `${boxKey}/${wireSize}`);
      }
    }
  });

  test('full option cross on three representative boxes agrees', () => {
    for (const boxKey of ['sq_4x1_5', 'dev_3x2x2', 'pl_dg_34']) {
      for (const wireSize of WIRES) {
        for (const numCond of [0, 1, 3, 8, 30]) {
          for (const numDev of [0, 1, 2, 10]) {
            for (const hasClamps of [false, true]) {
              for (const hasEgc of [false, true]) {
                compareCase({ boxKey, wireSize, numCond, numDev, hasClamps, hasEgc },
                  `${boxKey}/${wireSize}/c${numCond}/d${numDev}/${hasClamps}/${hasEgc}`);
              }
            }
          }
        }
      }
    }
  });

  test('extension volumes agree, including fill percent against the larger box', () => {
    for (const extVol of EXTS) {
      compareCase({ boxKey: 'sq_4x1_25', wireSize: '12', numCond: 8, numDev: 1,
        hasClamps: true, hasEgc: true, extVol }, `ext${extVol}`);
    }
  });

  test('below / exactly at / above required fill agree', () => {
    // dev_3x2x2 is exactly 10.0 in3; five #14 (2.00 each) land exactly on it.
    for (const numCond of [4, 5, 6]) {
      compareCase({ boxKey: 'dev_3x2x2', wireSize: '14', numCond },
        `exact-fill/${numCond}`);
    }
  });

  test('seeded random sweep across the supported space agrees', () => {
    let seed = 0xB0F17;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    for (let i = 0; i < 400; i++) {
      const input = {
        boxKey: pick(BOXES),
        wireSize: pick(WIRES),
        numCond: Math.floor(rnd() * 31),
        numDev: Math.floor(rnd() * 11),
        hasClamps: rnd() < 0.5,
        hasEgc: rnd() < 0.5,
        extVol: pick(EXTS),
      };
      compareCase(input, 'random#' + i + ' ' + JSON.stringify(input));
    }
  });
});
