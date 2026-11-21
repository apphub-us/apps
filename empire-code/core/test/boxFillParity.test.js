'use strict';
/**
 * Bounded legacy-equivalence checks for Box Fill (EC-CALC-1).
 *
 * NOT NORMATIVE EVIDENCE. Reproducing the old arithmetic proves only that the
 * refactor did not change what was already equivalent; it says nothing about
 * whether the NEC rule or the capacity table is right. Those are established
 * by docs/box-fill-contract.md and boxFillContract.test.js.
 *
 * REPLACED from the pre-task file (documented): the old parity swept every
 * box with `hasEgc: true` as one allowance regardless of count (the pre-2020
 * rule) and compared against BF_BOXES values that were wrong. Neither is an
 * equivalence the v2 contract preserves, so they are not carried forward.
 *
 * Retained, bounded equivalences:
 *   (a) legacy `hasEgc:false` (explicit) == v2 `egcCount:0` — identical totals,
 *       differing only in the compatibility marker;
 *   (b) old single-allowance EGC arithmetic == v2 for 1..4 entering EGCs of
 *       the governing size, where NEC 2020 also gives exactly one allowance;
 *   (c) non-EGC arithmetic (conductors, devices x2, clamp, fittings, added
 *       volume) unchanged — computed with an independent one-line formula.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { calculateBoxFill } = require('../src/calc/boxFill');
const { BF_VOL, BF_BOXES } = require('../src/calc/tables');   // inputs to iterate, never the expected-values oracle

const SIZES = ['14', '12', '10', '8', '6'];
const BOXES = Object.keys(BF_BOXES);
/** Old-style arithmetic, written independently: one allowance per non-EGC item, EGC as ONE allowance. */
function oldFormula(vol, v, n, dev, clamp, fit, egcOne, ext) {
  return { required: n * v + dev * 2 * v + (clamp ? v : 0) + fit * v + (egcOne ? v : 0), available: vol + ext };
}

describe('(a) explicit legacy hasEgc:false is exactly v2 egcCount:0', () => {
  test('every box x every size x a few counts', () => {
    let n = 0;
    for (const boxKey of BOXES) for (const size of SIZES) for (const numConductors of [0, 3, 9]) {
      const legacy = calculateBoxFill({ boxKey, largestWireSize: size, numConductors, numDevices: 1, hasClamps: true, hasEgc: false, extensionVolume: 1.25 });
      const v2 = calculateBoxFill({ contract: 2, boxKey, largestWireSize: size, numConductors, numDevices: 1, hasClamps: true, egcCount: 0, extensionVolume: 1.25 });
      assert.strictEqual(legacy.ok, true); assert.strictEqual(v2.ok, true);
      const strip = (r) => { const c = { ...r }; delete c.legacyCompatibility; return c; };
      assert.deepStrictEqual(strip(legacy), strip(v2), `${boxKey}/${size}/${numConductors}`);
      assert.strictEqual(legacy.legacyCompatibility, 'HAS_EGC_FALSE_AS_ZERO'); assert.strictEqual(v2.legacyCompatibility, undefined);
      n++;
    }
    assert.ok(n >= 400);
  });
});

describe('(b) 1..4 entering EGCs of the governing size equal the old single allowance', () => {
  for (const count of [1, 2, 3, 4]) {
    test(`egcCount ${count}: old one-allowance arithmetic == v2 (both are one allowance under NEC 2020)`, () => {
      for (const boxKey of BOXES) for (const size of SIZES) {
        const v = BF_VOL[size];
        const r = calculateBoxFill({ contract: 2, boxKey, largestWireSize: size, numConductors: 2, numDevices: 1, hasClamps: false, egcCount: count, egcSize: size });
        const old = oldFormula(BF_BOXES[boxKey].vol, v, 2, 1, false, 0, true, 0);
        assert.strictEqual(r.requiredVolume, old.required, `${boxKey}/${size}/${count}`);
        assert.strictEqual(r.fits, old.required <= old.available);
      }
    });
  }
  test('and 5 entering EGCs is deliberately NOT equivalent to the old rule (one quarter allowance more)', () => {
    const r = calculateBoxFill({ contract: 2, boxKey: 'sq_4x2_125', largestWireSize: '12', numConductors: 2, egcCount: 5, egcSize: '12' });
    const old = oldFormula(30.3, 2.25, 2, 0, false, 0, true, 0);
    assert.strictEqual(r.requiredVolume - old.required, 2.25 / 4);
  });
});

describe('(c) non-EGC arithmetic is unchanged by the contract change', () => {
  test('independent formula matches for a grid of counts, clamps, fittings and added volume', () => {
    for (const size of SIZES) for (const numDevices of [0, 1, 2]) for (const hasClamps of [false, true]) for (const fittings of [0, 1]) for (const ext of [0, 2.5, 3.31]) {
      const v = BF_VOL[size];
      const r = calculateBoxFill({ contract: 2, boxKey: 'sq_4_11_16x2_125', largestWireSize: size, numConductors: 5, numDevices, hasClamps, numSupportFittings: fittings, egcCount: 0, extensionVolume: ext });
      const old = oldFormula(42.0, v, 5, numDevices, hasClamps, fittings, false, ext);
      assert.strictEqual(r.requiredVolume, old.required); assert.strictEqual(r.availableVolume, old.available);
    }
  });
});
