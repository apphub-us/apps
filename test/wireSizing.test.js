'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { selectConductor } = require('../src/calc/wireSizing');

describe('Conductor selection — ampacity + OCPD + voltage drop', () => {
  test('P0-2: a 20 A load must not return #14 — NEC 240.4(D) caps it at 15 A', () => {
    // The shipped Wire Sizer omits 240.4(D) entirely. #14 THHN limited to the
    // 75C column is 20 A, so an ampacity-only check accepts it. Code does not.
    const r = selectConductor({ load: 20 });
    assert.notStrictEqual(r.recommendedSize, '14');
    assert.strictEqual(r.recommendedSize, '12');
  });

  test('#14 is still valid for a 15 A load', () => {
    assert.strictEqual(selectConductor({ load: 15 }).recommendedSize, '14');
  });

  test('P0-3: continuous load is sized at 125% — NEC 210.19(A)(1)', () => {
    // The shipped Wire Sizer has no continuous-load input at all.
    const cont = selectConductor({ load: 100, continuousLoad: 100 });
    const non = selectConductor({ load: 100 });
    assert.strictEqual(cont.requiredAmpacity, 125);
    assert.strictEqual(non.requiredAmpacity, 100);
    assert.notStrictEqual(cont.recommendedSize, non.recommendedSize);
  });

  test('mixed continuous and noncontinuous: 60 + 1.25 x 40 = 110 A', () => {
    const r = selectConductor({ load: 100, continuousLoad: 40 });
    assert.strictEqual(r.requiredAmpacity, 110);
  });

  test('a long run is driven by voltage drop, not ampacity', () => {
    const short = selectConductor({ load: 100, feet: 50, voltage: 208, maxVoltDropPercent: 5 });
    const long = selectConductor({ load: 100, feet: 400, voltage: 208, maxVoltDropPercent: 5 });
    assert.notStrictEqual(short.recommendedSize, long.recommendedSize);
    assert.ok(long.recommended.voltDropPercent <= 5);
  });

  test('omitting distance skips the voltage-drop check entirely', () => {
    const r = selectConductor({ load: 100 });
    assert.strictEqual(r.recommended.voltDropPercent, null);
    assert.strictEqual(r.recommended.vdOK, true);
  });

  test('CCC adjustment reduces ampacity and forces a larger conductor', () => {
    const plain = selectConductor({ load: 100 });
    const bundled = selectConductor({ load: 100, adjustmentFactor: 0.5 });
    assert.ok(bundled.recommended.finalAmpacity >= 100);
    assert.notStrictEqual(plain.recommendedSize, bundled.recommendedSize);
  });

  test('aluminium never returns #14 — not a listed size', () => {
    const r = selectConductor({ load: 20, material: 'al' });
    assert.notStrictEqual(r.recommendedSize, '14');
  });

  test('every returned conductor satisfies all three checks simultaneously', () => {
    const r = selectConductor({ load: 150, continuousLoad: 150, feet: 200, voltage: 208 });
    const w = r.recommended;
    assert.strictEqual(w.ampacityOK, true);
    assert.strictEqual(w.ocpdOK, true);
    assert.strictEqual(w.vdOK, true);
  });

  test('invalid inputs fail cleanly', () => {
    assert.strictEqual(selectConductor({ load: 0 }).reason, 'INVALID_LOAD');
    assert.strictEqual(selectConductor({ load: 50, continuousLoad: 80 }).reason, 'INVALID_CONTINUOUS_LOAD');
  });
});
