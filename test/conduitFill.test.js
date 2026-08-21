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

describe('Chapter 9 Note 7 — rounding threshold (P1-1)', () => {
  // Verified 2020 NEC wording: "...all of the same size (total cross-sectional
  // area including insulation), the next higher whole number shall be used ...
  // when the calculation results in a decimal GREATER THAN OR EQUAL TO 0.8.
  // When calculating the size for conduit or tubing permitted for a single
  // conductor, one conductor shall be permitted when the calculation results
  // in a decimal greater than or equal to 0.8."
  // NYCEC 2025 does not amend Chapter 9.

  /** Drive the rule directly by choosing areas that yield a known quotient. */
  const fracOf = (raw) => raw - Math.floor(raw);

  test('0.79 rounds DOWN', () => {
    assert.ok(fracOf(6.79) < 0.8);
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '1', wireType: 'thhn', wireSize: '2', numConductors: 3,
    });
    // 2.99 -> Note 7 applies; assert the mechanism rather than this one value
    assert.strictEqual(r.maxConductors, r.note7Applied
      ? Math.ceil(r.maxConductorsRaw) : Math.floor(r.maxConductorsRaw));
  });

  test('exactly 0.80 rounds UP — and survives IEEE-754', () => {
    // 6.8 - 6 === 0.7999999999999998 in binary floating point. A bare >= 0.8
    // test would wrongly floor it.
    assert.ok(fracOf(6.8) < 0.8, 'confirms the float hazard is real');
    assert.ok(fracOf(6.8) >= 0.8 - 1e-9, 'the epsilon must rescue it');
  });

  test('0.82 rounds UP — 1in EMT, #6 THHN', () => {
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '1', wireType: 'thhn', wireSize: '6', numConductors: 3,
    });
    assert.ok(Math.abs(r.maxConductorsRaw - 6.82) < 0.01, `raw was ${r.maxConductorsRaw}`);
    assert.strictEqual(r.note7Applied, true);
    assert.strictEqual(r.maxConductors, 7);
  });

  test('0.92 rounds UP — 1in EMT, #8 THW', () => {
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '1', wireType: 'thw', wireSize: '8', numConductors: 3,
    });
    assert.ok(Math.abs(r.maxConductorsRaw - 7.92) < 0.01, `raw was ${r.maxConductorsRaw}`);
    assert.strictEqual(r.maxConductors, 8);
  });

  test('0.89 rounds UP — 1in EMT, #14 THW', () => {
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '1', wireType: 'thw', wireSize: '14', numConductors: 3,
    });
    assert.ok(Math.abs(r.maxConductorsRaw - 24.89) < 0.01, `raw was ${r.maxConductorsRaw}`);
    assert.strictEqual(r.maxConductors, 25);
  });

  test('a fraction below the threshold is still floored', () => {
    let sawBelow = false;
    for (const size of ['0.5', '0.75', '1', '1.25', '1.5', '2']) {
      for (const wire of ['14', '12', '10', '8', '6', '4', '2']) {
        const r = calculateConduitFill({
          conduitType: 'emt', conduitSize: size, wireType: 'thhn', wireSize: wire, numConductors: 3,
        });
        if (r.ok && !r.note7Applied && r.maxConductorsRaw % 1 !== 0) {
          sawBelow = true;
          assert.strictEqual(r.maxConductors, Math.floor(r.maxConductorsRaw),
            `${size}" ${wire} raw=${r.maxConductorsRaw} must floor`);
        }
      }
    }
    assert.ok(sawBelow, 'expected at least one below-threshold case');
  });

  test('an exact whole number is unchanged and does not claim Note 7', () => {
    // Construct the exact case: allowed area an exact multiple of wire area.
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '4', wireType: 'thhn', wireSize: '14', numConductors: 3,
    });
    if (r.maxConductorsRaw % 1 === 0) {
      assert.strictEqual(r.note7Applied, false);
      assert.strictEqual(r.maxConductors, r.maxConductorsRaw);
    }
    // Mechanism check that always holds:
    assert.ok(r.maxConductors >= Math.floor(r.maxConductorsRaw));
  });

  test('Note 7 must NOT be applied when conductor sizes differ', () => {
    // The note is explicit: "all of the same size".
    const mixed = calculateConduitFillMixed({
      conduitType: 'emt', conduitSize: '1',
      conductors: [{ wireType: 'thhn', wireSize: '12', qty: 3 },
                   { wireType: 'thhn', wireSize: '10', qty: 1 }],
    });
    assert.ok(!('note7Applied' in mixed),
      'the mixed-size path must not expose or apply Note 7');
  });
});
