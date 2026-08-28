'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { calculateVoltageDrop, minSizeForVoltageDrop } = require('../src/calc/voltageDrop');

describe('Voltage drop — VD = (mult x K x I x L) / CM', () => {
  test('single phase uses a multiplier of 2 (out and back)', () => {
    const r = calculateVoltageDrop({ amps: 100, feet: 150, voltage: 208, phase: 1, size: '2' });
    assert.strictEqual(r.multiplier, 2);
    assert.strictEqual(r.K, 12.9);
  });

  test('three phase uses 1.732', () => {
    const r = calculateVoltageDrop({ amps: 100, feet: 150, voltage: 208, phase: 3, size: '2' });
    assert.strictEqual(r.multiplier, 1.732);
  });

  test('hand-checked: 100 A, 150 ft, #2 Cu, 1ph = 5.83 V', () => {
    const r = calculateVoltageDrop({ amps: 100, feet: 150, voltage: 208, phase: 1, size: '2' });
    // 2 x 12.9 x 100 x 150 / 66360 = 5.832
    assert.ok(Math.abs(r.voltageDrop - 5.832) < 0.01, `got ${r.voltageDrop}`);
    assert.ok(Math.abs(r.percentDrop - 2.80) < 0.01, `got ${r.percentDrop}`);
  });

  test('aluminium K is 21.2 and drops more than copper for the same run', () => {
    const cu = calculateVoltageDrop({ amps: 100, feet: 150, voltage: 208, size: '2', material: 'cu' });
    const al = calculateVoltageDrop({ amps: 100, feet: 150, voltage: 208, size: '2', material: 'al' });
    assert.strictEqual(al.K, 21.2);
    assert.ok(al.voltageDrop > cu.voltageDrop);
  });

  test('drop scales linearly with distance', () => {
    const a = calculateVoltageDrop({ amps: 50, feet: 100, voltage: 240, size: '6' });
    const b = calculateVoltageDrop({ amps: 50, feet: 200, voltage: 240, size: '6' });
    assert.ok(Math.abs(b.voltageDrop - 2 * a.voltageDrop) < 0.001);
  });

  test('voltage at load equals source minus drop', () => {
    const r = calculateVoltageDrop({ amps: 100, feet: 150, voltage: 208, size: '2' });
    assert.ok(Math.abs(r.voltageAtLoad - (208 - r.voltageDrop)) < 0.01);
  });

  test('invalid inputs return structured failures rather than NaN', () => {
    assert.strictEqual(calculateVoltageDrop({ amps: 0, feet: 100, voltage: 208, size: '2' }).reason, 'INVALID_AMPS');
    assert.strictEqual(calculateVoltageDrop({ amps: 10, feet: -5, voltage: 208, size: '2' }).reason, 'INVALID_DISTANCE');
    assert.strictEqual(calculateVoltageDrop({ amps: 10, feet: 100, voltage: 0, size: '2' }).reason, 'INVALID_VOLTAGE');
    assert.strictEqual(calculateVoltageDrop({ amps: 10, feet: 100, voltage: 208, size: 'zz' }).reason, 'SIZE_NOT_IN_TABLE');
    assert.strictEqual(calculateVoltageDrop({ amps: 10, feet: 100, voltage: 208, size: '2', phase: 2 }).reason, 'INVALID_PHASE');
  });

  test('NYCEC 5% total: minimum size for a long 200 A run at 208 V', () => {
    const r = minSizeForVoltageDrop({ amps: 200, feet: 300, voltage: 208, phase: 1, maxPercent: 5 });
    assert.strictEqual(r.ok, true);
    assert.ok(r.percentDrop <= 5);
  });

  test('a 3% target requires a larger conductor than 5% on the same run', () => {
    const at5 = minSizeForVoltageDrop({ amps: 200, feet: 300, voltage: 208, maxPercent: 5 });
    const at3 = minSizeForVoltageDrop({ amps: 200, feet: 300, voltage: 208, maxPercent: 3 });
    assert.ok(at3.circularMils > at5.circularMils);
  });
});

describe('Standalone VD migration — boundary and structured-result contracts', () => {
  const { analyzeVoltageDrop, calculateVoltageDrop } = require('../src/calc/voltageDrop');

  const base = { amps: 100, feet: 150, voltage: 208, phase: 1, material: 'cu',
    maxPercent: 5 };

  test('NUMERICAL PIN single-phase: 100 A, 150 ft one-way, 208 V, Cu #3/0', () => {
    // VD = 2 x 12.9 x 100 x 150 / 167,800 = 387,000 / 167,800 = 2.30631... V
    // %  = 2.30631 / 208 x 100 = 1.10880...%   at-load = 205.69369 V
    const r = calculateVoltageDrop({ ...base, size: '3/0' });
    assert.strictEqual(r.multiplier, 2);
    assert.strictEqual(r.K, 12.9);
    assert.strictEqual(r.voltageDrop, 2.306);
    assert.strictEqual(r.percentDrop, 1.109);
    assert.strictEqual(r.voltageAtLoad, 205.69);
    assert.ok(Math.abs(r.voltageDropExact - 387000 / 167800) < 1e-12);
  });

  test('NUMERICAL PIN three-phase: same circuit, multiplier 1.732', () => {
    // VD = 1.732 x 12.9 x 100 x 150 / 167,800 = 335,142 / 167,800 = 1.99727 V
    const r = calculateVoltageDrop({ ...base, phase: 3, size: '3/0' });
    assert.strictEqual(r.multiplier, 1.732);
    assert.strictEqual(r.voltageDrop, 1.997);
    assert.strictEqual(r.percentDrop, 0.96);
    assert.strictEqual(r.voltageAtLoad, 206);
  });

  test('NUMERICAL PIN Cu vs Al: same circuit, K alone moves the result', () => {
    const cu = analyzeVoltageDrop(base);
    const al = analyzeVoltageDrop({ ...base, material: 'al' });
    assert.strictEqual(cu.K, 12.9);
    assert.strictEqual(al.K, 21.2);
    const cu30 = cu.rows.find((r) => r.size === '3/0');
    const al30 = al.rows.find((r) => r.size === '3/0');
    assert.ok(Math.abs(al30.voltageDrop / cu30.voltageDrop - 21.2 / 12.9) < 1e-9,
      'Al/Cu drop ratio must be exactly K_al/K_cu');
    assert.notStrictEqual(cu.recommendedSize, null);
  });

  test('ONE-WAY DISTANCE SEMANTICS: feet is one-way; doubling feet doubles the drop', () => {
    // The formula multiplier (2 for 1ph) already accounts for the return
    // path, so the feet input is ONE-WAY conductor length. Pinned so a
    // future edit cannot silently double or halve results.
    const oneWay = calculateVoltageDrop({ ...base, size: '1/0' });
    const doubled = calculateVoltageDrop({ ...base, feet: 300, size: '1/0' });
    assert.ok(Math.abs(doubled.voltageDropExact - 2 * oneWay.voltageDropExact) < 1e-12);
    const r = analyzeVoltageDrop(base);
    assert.strictEqual(r.feet, 150, 'the request echoes one-way feet unchanged');
    assert.strictEqual(r.multiplier, 2);
  });

  test('joint recommendation: ampacity can push past the VD-passing size', () => {
    // 100 A / 150 ft / 208 V / 5% Cu: minCM 37,212 -> #4 (41,740) passes VD,
    // but #4 Cu 75C is 85 A < 100 A -> the pick must be #3 (100 A).
    const r = analyzeVoltageDrop(base);
    assert.strictEqual(r.minCircularMils, 37212);
    const four = r.rows.find((x) => x.size === '4');
    assert.strictEqual(four.passesVdTarget, true);
    assert.strictEqual(four.ampacityOK, false);
    assert.strictEqual(four.meetsBoth, false);
    assert.strictEqual(r.recommendedSize, '3');
    assert.strictEqual(r.recommended.ampacity75C, 100);
  });

  test('EXACT TARGET boundary: raw arithmetic, exactly-at passes, just-over fails', () => {
    // 10 A x 411 ft x Cu 1ph on #14 (4,110 CM): drop = 25.8 V exactly.
    // At 240 V that is 10.75%. Target 10.75 -> minCM = 4110.0 -> #14 passes.
    const at = analyzeVoltageDrop({ amps: 10, feet: 411, voltage: 240,
      phase: 1, material: 'cu', maxPercent: 10.75 });
    const row14 = at.rows.find((r) => r.size === '14');
    assert.strictEqual(row14.passesVdTarget, true, 'exactly at target passes');
    assert.strictEqual(at.recommendedSize, '14',
      '#14 Cu 75C is 20 A >= 10 A, so it is also the joint pick');
    const over = analyzeVoltageDrop({ amps: 10, feet: 411, voltage: 240,
      phase: 1, material: 'cu', maxPercent: 10.749 });
    assert.strictEqual(over.rows.find((r) => r.size === '14').passesVdTarget,
      false, 'just over target fails');
  });

  test('drop exceeding source voltage returns the mathematical result with no clamp', () => {
    // Legacy displayed negative voltage-at-load; the engine preserves the
    // mathematics and the diagnostic is the value itself.
    const r = analyzeVoltageDrop({ amps: 2000, feet: 5000, voltage: 120,
      phase: 1, material: 'cu', maxPercent: 2 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.recommendedSize, null, 'nothing meets the limit');
    assert.strictEqual(r.recommended, null);
    const r14 = r.rows.find((x) => x.size === '14');
    assert.ok(r14.voltageAtLoad < 0, 'no silent clamp to zero');
    assert.ok(Number.isFinite(r14.voltageAtLoad));
  });

  test('extreme but valid inputs stay finite across the smallest and largest sizes', () => {
    for (const [amps, feet] of [[1, 1], [2000, 5000], [0.1, 5000]]) {
      const r = analyzeVoltageDrop({ amps, feet, voltage: 480, phase: 3,
        material: 'al', maxPercent: 3 });
      assert.strictEqual(r.ok, true);
      for (const row of r.rows) {
        assert.ok(Number.isFinite(row.voltageDrop), row.size);
        assert.ok(Number.isFinite(row.percentDrop), row.size);
      }
      assert.strictEqual(r.rows[0].size, '14');
      assert.strictEqual(r.rows[r.rows.length - 1].size, '750');
    }
  });

  test('invalid inputs fail with structured reasons — no fallback, no NaN', () => {
    assert.strictEqual(analyzeVoltageDrop({ ...base, material: 'steel' })
      .reason, 'UNKNOWN_MATERIAL', 'no silent aluminum fallback');
    for (const phase of [2, 0, NaN, '3x']) {
      assert.strictEqual(analyzeVoltageDrop({ ...base, phase })
        .reason, 'INVALID_PHASE', String(phase));
    }
    for (const amps of [0, -5, NaN, Infinity, '100']) {
      assert.strictEqual(analyzeVoltageDrop({ ...base, amps })
        .reason, 'INVALID_AMPS', String(amps));
    }
    for (const feet of [0, -1, NaN, Infinity]) {
      assert.strictEqual(analyzeVoltageDrop({ ...base, feet })
        .reason, 'INVALID_DISTANCE', String(feet));
    }
    for (const voltage of [0, -120, NaN]) {
      assert.strictEqual(analyzeVoltageDrop({ ...base, voltage })
        .reason, 'INVALID_VOLTAGE', String(voltage));
    }
    for (const maxPercent of [0, -3, NaN, '5']) {
      assert.strictEqual(analyzeVoltageDrop({ ...base, maxPercent })
        .reason, 'INVALID_TARGET', String(maxPercent));
    }
    // empty request: material/phase have defaults, so the first missing
    // required field decides — amps
    assert.strictEqual(analyzeVoltageDrop({}).reason, 'INVALID_AMPS');
    assert.strictEqual(analyzeVoltageDrop(null).ok, false);
    assert.strictEqual(calculateVoltageDrop({ ...base, size: '9/0' })
      .reason, 'SIZE_NOT_IN_TABLE');
  });

  test('the structured result carries no HTML and no NaN anywhere', () => {
    const r = analyzeVoltageDrop(base);
    assert.ok(!JSON.stringify(r).includes('<'));
    const walk = (o) => Object.values(o).forEach((v) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v));
      else if (v && typeof v === 'object') walk(v);
    });
    walk(r);
  });
});
