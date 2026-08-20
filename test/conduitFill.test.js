'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { calculateConduitFill, calculateConduitFillMixed, calculateWirewayFill, fillPercent } =
  require('../src/calc/conduitFill');

describe('Conduit fill — NEC Chapter 9 Table 1 fill percentages', () => {
  test('1 conductor is 53%, 2 is 31%, 3+ is 40%', () => {
    assert.strictEqual(fillPercent(1), 53);
    assert.strictEqual(fillPercent(2), 31);
    assert.strictEqual(fillPercent(3), 40);
    assert.strictEqual(fillPercent(25), 40);
  });

  test('3/4in EMT holds 16 #12 THHN at 40% fill', () => {
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '0.75', wireType: 'thhn', wireSize: '12', numConductors: 3,
    });
    assert.strictEqual(r.maxConductors, 16);
    assert.strictEqual(r.fits, true);
  });

  test('1/2in EMT holds 9 #12 THHN', () => {
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '0.5', wireType: 'thhn', wireSize: '12', numConductors: 3,
    });
    assert.strictEqual(r.maxConductors, 9);
  });

  test('over-fill is reported, not silently accepted', () => {
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '0.5', wireType: 'thhn', wireSize: '12', numConductors: 20,
    });
    assert.strictEqual(r.fits, false);
    assert.ok(r.usedArea > r.allowedArea);
  });

  test('a single conductor gets the 53% allowance, not 40%', () => {
    const one = calculateConduitFill({
      conduitType: 'emt', conduitSize: '0.5', wireType: 'thhn', wireSize: '12', numConductors: 1,
    });
    assert.strictEqual(one.fillRulePercent, 53);
    assert.ok(one.allowedArea > 0);
  });

  test('invalid conductor count returns a structured failure', () => {
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '0.5', wireType: 'thhn', wireSize: '12', numConductors: 0,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'INVALID_CONDUCTOR_COUNT');
  });

  test('unknown conduit or wire returns a structured failure', () => {
    assert.strictEqual(calculateConduitFill({
      conduitType: 'nope', conduitSize: '0.5', wireType: 'thhn', wireSize: '12', numConductors: 3,
    }).reason, 'CONDUIT_NOT_IN_TABLE');
    assert.strictEqual(calculateConduitFill({
      conduitType: 'emt', conduitSize: '0.5', wireType: 'thhn', wireSize: '99', numConductors: 3,
    }).reason, 'WIRE_NOT_IN_TABLE');
  });

  test('P1-1: Chapter 9 Note 7 rounds up when the decimal is 0.8 or larger', () => {
    // mobile.html always floors, which under-reports capacity by one conductor
    // in the Note 7 window. Verified against Chapter 9, Note 7.
    let sawNote7 = false;
    for (const size of ['0.5', '0.75', '1', '1.25', '1.5', '2']) {
      for (const wire of ['14', '12', '10', '8', '6']) {
        const r = calculateConduitFill({
          conduitType: 'emt', conduitSize: size, wireType: 'thhn', wireSize: wire, numConductors: 3,
        });
        if (r.ok && r.note7Applied) {
          sawNote7 = true;
          assert.strictEqual(r.maxConductors, Math.ceil(r.maxConductorsRaw));
        }
      }
    }
    assert.ok(sawNote7, 'expected at least one Note 7 case in the EMT range');
  });
});

describe('Conduit fill — mixed conductor sizes (NEC Ch.9 Note 6)', () => {
  test('P1-2: a real 3x#12 + 1x#10 EGC run is computed by total area', () => {
    // mobile.html cannot express this at all — it assumes uniform conductors.
    const r = calculateConduitFillMixed({
      conduitType: 'emt', conduitSize: '0.75',
      conductors: [
        { wireType: 'thhn', wireSize: '12', qty: 3 },
        { wireType: 'thhn', wireSize: '10', qty: 1 },
      ],
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.totalConductors, 4);
    assert.strictEqual(r.fillRulePercent, 40);
    assert.strictEqual(r.fits, true);
  });

  test('mixed fill uses the total conductor count for the fill percentage', () => {
    const r = calculateConduitFillMixed({
      conduitType: 'emt', conduitSize: '1',
      conductors: [{ wireType: 'thhn', wireSize: '12', qty: 1 },
                   { wireType: 'thhn', wireSize: '10', qty: 1 }],
    });
    assert.strictEqual(r.totalConductors, 2);
    assert.strictEqual(r.fillRulePercent, 31); // two conductors, not 40%
  });
});

describe('Wireway fill — NEC 376.22(A)', () => {
  test('4x4 wireway allows 20% of 16 sq in = 3.2 sq in', () => {
    const r = calculateWirewayFill({
      width: 4, height: 4, wireType: 'thhn', wireSize: '12', numConductors: 10,
    });
    assert.strictEqual(r.interiorArea, 16);
    assert.strictEqual(r.allowedArea, 3.2);
    assert.strictEqual(r.fits, true);
  });

  test('wireway over-fill is detected', () => {
    const r = calculateWirewayFill({
      width: 2, height: 2, wireType: 'thhn', wireSize: '4/0', numConductors: 20,
    });
    assert.strictEqual(r.fits, false);
  });
});
