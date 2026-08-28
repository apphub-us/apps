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

describe('Box Fill migration — boundary and structured-result contracts', () => {
  const { calculateBoxFill } = require('../src/calc/boxFill');
  const { BF_VOL, BF_BOXES } = require('../src/calc/tables');

  test('EXACT-FILL SEMANTICS: used === available is a deterministic PASS', () => {
    // 314.16 requires the box volume to be "not less than" the fill: equal
    // complies. Values are exact quarters in binary, so `<=` needs no
    // tolerance — pinned here so floating point can never blur the boundary.
    const r = calculateBoxFill({ boxKey: 'dev_3x2x2', largestWireSize: '14',
      numConductors: 5 });
    assert.strictEqual(r.usedVolume, 10);
    assert.strictEqual(r.boxVolume, 10);
    assert.strictEqual(r.remaining, 0);
    assert.strictEqual(r.fits, true);
    assert.strictEqual(r.fillPercent, 100);
    const over = calculateBoxFill({ boxKey: 'dev_3x2x2', largestWireSize: '14',
      numConductors: 6 });
    assert.strictEqual(over.fits, false);
    assert.strictEqual(over.remaining, -2);
  });

  test('zero and one conductor are deterministic', () => {
    const zero = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '12' });
    assert.strictEqual(zero.usedVolume, 0);
    assert.strictEqual(zero.fits, true);
    assert.strictEqual(zero.fillPercent, 0);
    const one = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '12',
      numConductors: 1 });
    assert.strictEqual(one.usedVolume, 2.25);
  });

  test('every supported wire size computes its exact 314.16(B) volume', () => {
    for (const [size, vol] of Object.entries(BF_VOL)) {
      const r = calculateBoxFill({ boxKey: 'sq_4_11_16x2_125',
        largestWireSize: size, numConductors: 3, numDevices: 1, hasClamps: true,
        hasEgc: true });
      assert.strictEqual(r.volPerWire, vol, size);
      assert.strictEqual(r.usedVolume, Math.round(vol * 7 * 100) / 100,
        size + ': 3 + 2(device) + 1 + 1 = 7 allowances');
    }
  });

  test('every supported box key resolves and totals against its table volume', () => {
    for (const [key, box] of Object.entries(BF_BOXES)) {
      const r = calculateBoxFill({ boxKey: key, largestWireSize: '14',
        numConductors: 2 });
      assert.strictEqual(r.ok, true, key);
      assert.strictEqual(r.boxVolume, box.vol, key);
    }
  });

  test('the breakdown always sums to the total', () => {
    const r = calculateBoxFill({ boxKey: 'pl_dg_34', largestWireSize: '8',
      numConductors: 5, numDevices: 2, hasClamps: true, hasEgc: true,
      numSupportFittings: 1 });
    const sum = r.conductorVolume + r.deviceVolume + r.clampVolume
      + r.egcVolume + r.fittingVolume;
    assert.ok(Math.abs(sum - r.usedVolume) < 1e-9);
    assert.ok(Math.abs((r.boxVolume - r.usedVolume) - r.remaining) < 1e-9);
  });

  test('governing-size boundaries: the single largest size drives every allowance', () => {
    // The app models ONE governing size (mixed sizes are not a production
    // capability); moving it must move conductor, device, clamp and EGC
    // allowances together.
    const small = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '14',
      numConductors: 4, numDevices: 1, hasClamps: true, hasEgc: true });
    const large = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '6',
      numConductors: 4, numDevices: 1, hasClamps: true, hasEgc: true });
    assert.strictEqual(small.usedVolume, 16);   // 8 allowances x 2.00
    assert.strictEqual(large.usedVolume, 40);   // 8 allowances x 5.00
    assert.strictEqual(small.fits, true);
    assert.strictEqual(large.fits, false);
  });

  test('invalid inputs fail with structured reasons — never NaN, never a loop', () => {
    assert.strictEqual(calculateBoxFill({ boxKey: 'nope', largestWireSize: '12' })
      .reason, 'BOX_NOT_IN_TABLE');
    assert.strictEqual(calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '4' })
      .reason, 'WIRE_NOT_IN_TABLE');
    assert.strictEqual(calculateBoxFill({}).reason, 'BOX_NOT_IN_TABLE');
    for (const bad of [-1, 1.5, NaN, Infinity, '3']) {
      const r = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '12',
        numConductors: bad });
      assert.strictEqual(r.ok, false, String(bad));
      assert.ok(r.reason === 'NEGATIVE_COUNT' || r.reason === 'INVALID_COUNT',
        String(bad) + ' → ' + r.reason);
    }
    assert.strictEqual(calculateBoxFill({ boxKey: 'sq_4x1_5',
      largestWireSize: '12', numDevices: -2 }).reason, 'NEGATIVE_COUNT');
    assert.strictEqual(calculateBoxFill({ boxKey: 'sq_4x1_5',
      largestWireSize: '12', numSupportFittings: 2.5 }).reason, 'INVALID_COUNT');
    for (const bad of [-1, NaN, Infinity, '6.5']) {
      const r = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '12',
        extensionVolume: bad });
      assert.strictEqual(r.reason, 'INVALID_EXTENSION', String(bad));
    }
  });

  test('pathological but valid counts terminate with finite arithmetic', () => {
    const r = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '6',
      numConductors: 1e6, numDevices: 1e6 });
    assert.strictEqual(r.ok, true);
    assert.ok(Number.isFinite(r.usedVolume) && r.fits === false);
  });

  test('no HTML anywhere in the structured result', () => {
    const r = calculateBoxFill({ boxKey: 'sq_4x1_5', largestWireSize: '12',
      numConductors: 6, numDevices: 1, hasClamps: true, hasEgc: true });
    assert.ok(!JSON.stringify(r).includes('<'));
  });
});
