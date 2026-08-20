'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  calculateAmpacity, tempCorrectionFactor, tempCorrectionFactorLegacy, maxOvercurrentDevice,
} = require('../src/calc/ampacity');

describe('Ampacity — NEC 310.16 base values', () => {
  test('#12 Cu THHN base is 30 A at 90C', () => {
    const r = calculateAmpacity({ size: '12', insulation: 'thhn' });
    assert.strictEqual(r.baseAmpacity, 30);
  });

  test('#12 Cu terminates at 25 A — 75C column governs (110.14(C))', () => {
    const r = calculateAmpacity({ size: '12', insulation: 'thhn' });
    assert.strictEqual(r.finalAmpacity, 25);
    assert.strictEqual(r.terminalLimitGoverns, true);
  });

  test('3/0 Cu THHN: 225 A at 90C, limited to 200 A at the terminal', () => {
    const r = calculateAmpacity({ size: '3/0', insulation: 'thhn' });
    assert.strictEqual(r.baseAmpacity, 225);
    assert.strictEqual(r.finalAmpacity, 200);
  });

  test('4/0 Al THHN is 205 A at 90C, 180 A at 75C', () => {
    // 260 A is 4/0 COPPER; aluminium of the same size is 205 A at 90C.
    const r = calculateAmpacity({ size: '4/0', material: 'al', insulation: 'thhn' });
    assert.strictEqual(r.baseAmpacity, 205);
    assert.strictEqual(r.finalAmpacity, 180);
  });

  test('unknown size returns a structured failure, never throws', () => {
    const r = calculateAmpacity({ size: '999' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'SIZE_NOT_IN_TABLE');
  });
});

describe('Temperature correction — NEC Table 310.15(B)(1)', () => {
  test('86F is the base: factor is exactly 1.00', () => {
    assert.strictEqual(tempCorrectionFactor(86, 'thhn'), 1.00);
  });

  test('95F at 90C is 0.96', () => {
    assert.strictEqual(tempCorrectionFactor(95, 'thhn'), 0.96);
  });

  test('110F falls in the 105-113F band: 0.87 at 90C', () => {
    assert.strictEqual(tempCorrectionFactor(110, 'thhn'), 0.87);
  });

  test('above 140F the table does not extend — returns null, not a clamped value', () => {
    assert.strictEqual(tempCorrectionFactor(155, 'thhn'), null);
    const r = calculateAmpacity({ size: '12', ambientF: 155 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'AMBIENT_ABOVE_TABLE');
  });

  test('P0-1 REGRESSION GUARD: 88F must use the 87-95F band (0.96), not nearest-match', () => {
    // The shipped mobile.html picks the NEAREST band, returning 1.00 here and
    // overstating ampacity by 4%. Band containment is the code-correct lookup.
    assert.strictEqual(tempCorrectionFactor(88, 'thhn'), 0.96);
    assert.strictEqual(tempCorrectionFactorLegacy(88, 'thhn'), 1.00); // documents the bug
  });

  test('derating stacks: correction x adjustment, then terminal limit', () => {
    const r = calculateAmpacity({
      size: '3/0', insulation: 'thhn', ambientF: 104, adjustmentFactor: 0.80,
    });
    assert.strictEqual(r.correctionFactor, 0.91);
    assert.strictEqual(r.afterAdjustment, round2(225 * 0.91 * 0.80)); // 163.8
    assert.strictEqual(r.finalAmpacity, r.afterAdjustment); // below the 200 A terminal
  });
});

describe('Overcurrent device — NEC 240.4', () => {
  test('240.4(B): non-standard ampacity may round up to the next standard size', () => {
    assert.strictEqual(maxOvercurrentDevice(83, '3').rating, 90);
  });

  test('exact standard ampacity is used as-is', () => {
    assert.strictEqual(maxOvercurrentDevice(100, '3').rating, 100);
  });

  test('240.4(D): #14 Cu is capped at 15 A regardless of ampacity', () => {
    const r = maxOvercurrentDevice(25, '14');
    assert.strictEqual(r.rating, 15);
    assert.strictEqual(r.cappedBySmallConductorRule, true);
  });

  test('240.4(D): #12 capped at 20 A, #10 capped at 30 A', () => {
    assert.strictEqual(maxOvercurrentDevice(30, '12').rating, 20);
    assert.strictEqual(maxOvercurrentDevice(40, '10').rating, 30);
  });

  test('large conductors are not subject to the small-conductor cap', () => {
    const r = maxOvercurrentDevice(200, '3/0');
    assert.strictEqual(r.rating, 200);
    assert.strictEqual(r.cappedBySmallConductorRule, false);
  });
});

describe('Rooftop adder — NEC 310.15(B)(2)', () => {
  test('P0-4: the adder is 60F (33C); 86F ambient becomes 146F and exceeds the table', () => {
    // mobile.html offers "+33F", confusing the Celsius figure for Fahrenheit.
    // The correct adder is 33C = 60F, applied only when the raceway is less
    // than 3/4 in. above the roof (2020 NEC; 7/8 in. in 2017).
    const r = calculateAmpacity({ size: '12', ambientF: 86, rooftopAdderF: 60 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'AMBIENT_ABOVE_TABLE');
  });

  test('with the correct 60F adder a 70F ambient becomes 130F and derates hard', () => {
    const r = calculateAmpacity({ size: '3/0', insulation: 'thhn', ambientF: 70, rooftopAdderF: 60 });
    assert.strictEqual(r.effectiveAmbientF, 130);
    assert.strictEqual(r.correctionFactor, 0.76); // 123-131F band
  });
});

const round2 = (n) => Math.round(n * 100) / 100;
