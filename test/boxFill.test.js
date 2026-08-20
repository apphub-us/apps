'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { calculateBoxFill } = require('../src/calc/boxFill');

describe('Box fill — NEC 314.16(B)', () => {
  test('conductor allowance is volume per conductor x count', () => {
    const r = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 4 });
    assert.strictEqual(r.volPerWire, 2.25);
    assert.strictEqual(r.conductorVolume, 9);
  });

  test('314.16(B)(4): each device yoke counts as TWO conductor volumes', () => {
    const r = calculateBoxFill({
      boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 0, numDevices: 1,
    });
    assert.strictEqual(r.deviceVolume, 4.5);
  });

  test('314.16(B)(2): all clamps together count as ONE allowance', () => {
    const r = calculateBoxFill({
      boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 0, hasClamps: true,
    });
    assert.strictEqual(r.clampVolume, 2.25);
  });

  test('314.16(B)(5): all EGCs together count as ONE allowance', () => {
    const r = calculateBoxFill({
      boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 0, hasEgc: true,
    });
    assert.strictEqual(r.egcVolume, 2.25);
  });

  test('worked example: 4in square 1-1/2, six #12, one device, clamps, EGC', () => {
    const r = calculateBoxFill({
      boxKey: 'sq_4x1_5', largestWireSize: '12',
      numConductors: 6, numDevices: 1, hasClamps: true, hasEgc: true,
    });
    // 6x2.25 + 2x2.25 + 2.25 + 2.25 = 22.5 of 25.5 available
    assert.strictEqual(r.usedVolume, 22.5);
    assert.strictEqual(r.boxVolume, 25.5);
    assert.strictEqual(r.fits, true);
    assert.strictEqual(r.remaining, 3);
  });

  test('over-fill is reported', () => {
    const r = calculateBoxFill({
      boxKey: 'dev_3x2x1_5', largestWireSize: '12', numConductors: 8, numDevices: 1,
    });
    assert.strictEqual(r.fits, false);
    assert.ok(r.remaining < 0);
  });

  test('extension ring adds to available volume — 314.16(A)', () => {
    // 12 x 2.25 = 27 in3, over the 25.5 in3 box but inside 41 in3 with the ring
    const base = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 12 });
    const ext = calculateBoxFill({
      boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 12, extensionVolume: 15.5,
    });
    assert.strictEqual(base.fits, false);
    assert.strictEqual(ext.fits, true);
    assert.strictEqual(ext.boxVolume, 41);
  });

  test('P2-4: 314.16(B)(3) support fittings are supported here but absent from the app UI', () => {
    const r = calculateBoxFill({
      boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 0, numSupportFittings: 1,
    });
    assert.strictEqual(r.fittingVolume, 2.25);
  });

  test('maxConductors accounts for device/clamp/EGC deductions first', () => {
    const r = calculateBoxFill({
      boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 0,
      numDevices: 1, hasClamps: true, hasEgc: true,
    });
    // (25.5 - 4.5 - 2.25 - 2.25) / 2.25 = 7.33 -> 7
    assert.strictEqual(r.maxConductors, 7);
  });

  test('unknown box or wire returns a structured failure', () => {
    assert.strictEqual(calculateBoxFill({ boxKey: 'nope', largestWireSize: '12' }).reason, 'BOX_NOT_IN_TABLE');
    assert.strictEqual(calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '99' }).reason, 'WIRE_NOT_IN_TABLE');
  });
});
