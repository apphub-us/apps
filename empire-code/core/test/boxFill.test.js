'use strict';
/**
 * Box Fill engine — contract v2 (EC-CALC-1).
 *
 * REPLACES the pre-task boxFill.test.js. The replaced file encoded three
 * things this milestone corrected, so it was retired rather than kept green
 * by weakening: (1) `hasEgc:true` as one allowance regardless of count
 * (pre-2020 rule), (2) 25.5 / 42.0 / 60.0 / 15.5 / 21.5 / 30.3 capacities for
 * boxes whose NEC 2020 Table 314.16(A) volumes are 21.0 / 29.5 / 42.0 / 12.5 /
 * 15.5 / 21.5, and (3) legacy input with no grounding information treated as
 * zero. Literal audit fixtures live in boxFillContract.test.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { calculateBoxFill } = require('../src/calc/boxFill');

const v2 = (o) => calculateBoxFill(Object.assign({ contract: 2 }, o));
const OK = { boxKey: 'sq_4x2_125', largestWireSize: '12', numConductors: 3, egcCount: 0 };

describe('structure and validation', () => {
  test('ok result carries totals, unrounded comparison fields and the egc breakdown', () => {
    const r = v2({ ...OK, numDevices: 1, hasClamps: true, egcCount: 2, egcSize: '12' });
    assert.strictEqual(r.ok, true);
    for (const k of ['boxVolume', 'volPerWire', 'conductorVolume', 'deviceVolume', 'clampVolume', 'egcVolume', 'fittingVolume', 'usedVolume', 'remaining', 'fillPercent', 'maxConductors', 'fits', 'requiredVolume', 'availableVolume', 'remainingRaw', 'egc']) assert.ok(k in r, k);
    // 3x2.25 + 2x2.25 + 2.25 + 1x2.25 = 15.75 of 30.3
    assert.strictEqual(r.requiredVolume, 15.75); assert.strictEqual(r.fits, true); assert.strictEqual(r.maxConductors, 9);
  });
  test('unknown contract or rule basis is rejected, never silently defaulted', () => {
    assert.strictEqual(calculateBoxFill({ ...OK, contract: 3 }).reason, 'UNSUPPORTED_CONTRACT');
    assert.strictEqual(calculateBoxFill({ ...OK, contract: '2' }).reason, 'UNSUPPORTED_CONTRACT');
    assert.strictEqual(v2({ ...OK, ruleBasis: 'NEC2023' }).reason, 'UNSUPPORTED_RULE_BASIS');
    assert.strictEqual(v2({ ...OK, ruleBasis: 'NEC2020' }).ok, true);
  });
  test('table lookups are own-property only', () => {
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      assert.strictEqual(v2({ ...OK, boxKey: k }).reason, 'BOX_NOT_IN_TABLE', k);
      assert.strictEqual(v2({ ...OK, largestWireSize: k }).reason, 'WIRE_NOT_IN_TABLE', k);
    }
    assert.strictEqual(v2({ ...OK, boxKey: 12 }).reason, 'BOX_NOT_IN_TABLE');
  });
  test('counts: fractions, NaN, Infinity, strings, negatives and absurd magnitudes are structured failures', () => {
    for (const f of ['numConductors', 'numDevices', 'numSupportFittings']) {
      assert.strictEqual(v2({ ...OK, [f]: 1.5 }).reason, 'INVALID_COUNT', f);
      assert.strictEqual(v2({ ...OK, [f]: NaN }).reason, 'INVALID_COUNT');
      assert.strictEqual(v2({ ...OK, [f]: Infinity }).reason, 'INVALID_COUNT');
      assert.strictEqual(v2({ ...OK, [f]: '3' }).reason, 'INVALID_COUNT');
      assert.strictEqual(v2({ ...OK, [f]: -1 }).reason, 'NEGATIVE_COUNT');
      assert.strictEqual(v2({ ...OK, [f]: 1e9 }).reason, 'INVALID_COUNT');
    }
  });
  test('booleans are strict: the string "false" is not data', () => {
    assert.strictEqual(v2({ ...OK, hasClamps: 'false' }).reason, 'INVALID_BOOLEAN');
    assert.strictEqual(v2({ ...OK, hasClamps: 1 }).reason, 'INVALID_BOOLEAN');
    assert.strictEqual(v2({ ...OK, hasEgc: 'false' }).reason, 'INVALID_BOOLEAN');
  });
  test('extension volume: finite, non-negative, bounded; arbitrary valid decimals kept exactly', () => {
    for (const bad of [-0.1, NaN, Infinity, '3', 1e9]) assert.strictEqual(v2({ ...OK, extensionVolume: bad }).reason, 'INVALID_EXTENSION', String(bad));
    assert.strictEqual(v2({ ...OK, extensionVolume: 3.3125 }).availableVolume, 30.3 + 3.3125);
    assert.strictEqual(v2({ ...OK, extensionVolume: 0 }).availableVolume, 30.3);
  });
  test('non-object input', () => {
    for (const bad of [undefined, null, 'x', 4]) assert.strictEqual(calculateBoxFill(bad).reason, 'INVALID_INPUT');
  });
});

describe('legacy compatibility path (no contract / contract 1)', () => {
  const L = { boxKey: 'sq_4x2_125', largestWireSize: '12', numConductors: 3 };
  test('explicit hasEgc:false maps to a known zero through the identified path', () => {
    const r = calculateBoxFill({ ...L, hasEgc: false });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.legacyCompatibility, 'HAS_EGC_FALSE_AS_ZERO'); assert.strictEqual(r.egc.count, 0);
    assert.strictEqual(calculateBoxFill({ ...L, contract: 1, hasEgc: false }).ok, true);
  });
  test('hasEgc:true alone -> EGC_DETAILS_REQUIRED, requiresReview, no fits field', () => {
    const r = calculateBoxFill({ ...L, hasEgc: true });
    assert.deepStrictEqual([r.ok, r.reason, r.requiresReview], [false, 'EGC_DETAILS_REQUIRED', true]); assert.ok(!('fits' in r));
  });
  test('missing grounding information is not proof of zero', () => {
    const r = calculateBoxFill({ ...L });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'EGC_DETAILS_REQUIRED');
  });
  test('legacy input carrying new EGC fields is contradictory; v2 boolean disagreeing with the count is contradictory', () => {
    assert.strictEqual(calculateBoxFill({ ...L, hasEgc: false, egcCount: 2, egcSize: '12' }).reason, 'CONTRADICTORY_INPUT');
    assert.strictEqual(calculateBoxFill({ ...L, hasEgc: false, egcCount: 0 }).reason, 'CONTRADICTORY_INPUT');
    assert.strictEqual(v2({ ...OK, hasEgc: true, egcCount: 0 }).reason, 'CONTRADICTORY_INPUT');
    assert.strictEqual(v2({ ...OK, hasEgc: false, egcCount: 3, egcSize: '12' }).reason, 'CONTRADICTORY_INPUT');
    assert.strictEqual(v2({ ...OK, hasEgc: true, egcCount: 3, egcSize: '12' }).ok, true, 'an agreeing boolean is ignored');
    assert.strictEqual(v2({ ...OK, hasEgc: false, egcCount: 0 }).ok, true);
  });
});

describe('arithmetic under the bounded model', () => {
  test('device x2, clamp x1, support fitting x1, all at the governing size', () => {
    const r = v2({ ...OK, numConductors: 4, numDevices: 2, hasClamps: true, numSupportFittings: 1, egcCount: 0 });
    // 4x2.25 + 4x2.25 + 2.25 + 2.25 = 22.5
    assert.strictEqual(r.requiredVolume, 22.5); assert.strictEqual(r.deviceVolume, 9); assert.strictEqual(r.clampVolume, 2.25); assert.strictEqual(r.fittingVolume, 2.25);
  });
  test('maxConductors ties to the governing size after every deduction including the EGC volume', () => {
    const r = v2({ boxKey: 'sq_4x2_125', largestWireSize: '12', numConductors: 0, numDevices: 1, hasClamps: true, egcCount: 6, egcSize: '12' });
    // (30.3 - 4.5 - 2.25 - 1.5x2.25) / 2.25 = 8.9 -> 8
    assert.strictEqual(r.maxConductors, 8);
  });
  test('exact fill is FITS; one quarter allowance more is OVER', () => {
    const a = v2({ boxKey: 'sq_4x2_125', largestWireSize: '14', numConductors: 14, egcCount: 4, egcSize: '14' });
    const b = v2({ boxKey: 'sq_4x2_125', largestWireSize: '14', numConductors: 14, egcCount: 5, egcSize: '14' });
    assert.strictEqual(a.remainingRaw, 30.3 - 30.0); assert.strictEqual(a.fits, true);
    assert.strictEqual(b.fits, false); assert.strictEqual(b.requiredVolume - a.requiredVolume, 0.5);
  });
  test('zero of everything is a valid zero-volume check, not an error and not a success in disguise', () => {
    const r = v2({ ...OK, numConductors: 0, egcCount: 0 });
    assert.strictEqual(r.requiredVolume, 0); assert.strictEqual(r.fits, true); assert.strictEqual(r.fillPercent, 0);
  });
});
