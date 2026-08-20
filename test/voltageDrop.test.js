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
