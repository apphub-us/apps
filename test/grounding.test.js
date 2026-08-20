'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { egcSize, egcUpsized, gecSize, gecWithElectrodeCap } = require('../src/calc/grounding');

describe('EGC — NEC Table 250.122', () => {
  test('60 A device: #10 Cu, #8 Al', () => {
    assert.strictEqual(egcSize(60, 'cu'), '10');
    assert.strictEqual(egcSize(60, 'al'), '8');
  });
  test('100 A device: #8 Cu, #6 Al', () => {
    assert.strictEqual(egcSize(100, 'cu'), '8');
    assert.strictEqual(egcSize(100, 'al'), '6');
  });
  test('200 A device: #6 Cu', () => {
    assert.strictEqual(egcSize(200, 'cu'), '6');
  });
  test('a rating between rows takes the next row up, never down', () => {
    assert.strictEqual(egcSize(90, 'cu'), '8');  // 61-100 band
    assert.strictEqual(egcSize(61, 'cu'), '8');
  });
  test('1000 A device: 2/0 Cu', () => {
    assert.strictEqual(egcSize(1000, 'cu'), '2/0');
  });
});

describe('EGC proportional upsize — NEC 250.122(B)', () => {
  test('upsizing 4/0 to 300 kcmil on a 200 A feeder raises the EGC from #6 to #4', () => {
    const r = egcUpsized(200, '4/0', '300');
    assert.strictEqual(r.baseSize, '6');
    assert.strictEqual(r.upsizeApplied, true);
    assert.ok(Math.abs(r.ratio - 1.418) < 0.001);
    assert.strictEqual(r.finalSize, '4');
  });
  test('no upsize when the installed conductor equals the required one', () => {
    const r = egcUpsized(200, '3/0', '3/0');
    assert.strictEqual(r.upsizeApplied, false);
    assert.strictEqual(r.finalSize, '6');
  });
  test('the ratio is by circular mils, not by AWG step count', () => {
    const r = egcUpsized(100, '8', '4');
    assert.ok(Math.abs(r.ratio - (41740 / 16510)) < 0.001);
  });
});

describe('GEC — NEC Table 250.66', () => {
  test('#2 Cu service: #8 Cu GEC', () => {
    assert.strictEqual(gecSize('2', 'cu').copper, '8');
  });
  test('3/0 Cu service: #4 Cu GEC', () => {
    assert.strictEqual(gecSize('3/0', 'cu').copper, '4');
  });
  test('600 kcmil sits on the boundary and stays at 1/0', () => {
    assert.strictEqual(gecSize('600', 'cu').copper, '1/0');
  });
  test('750 kcmil crosses into the next band: 2/0', () => {
    assert.strictEqual(gecSize('750', 'cu').copper, '2/0');
  });
  test('250.66(A): to a rod the GEC need not exceed #6', () => {
    const r = gecWithElectrodeCap('3/0', 'cu', 'rod');
    assert.strictEqual(r.capApplied, true);
    assert.strictEqual(r.finalCopper, '6');
  });
  test('250.66(B): to a concrete-encased electrode the cap is #4', () => {
    const r = gecWithElectrodeCap('500', 'cu', 'ufer');
    assert.strictEqual(r.finalCopper, '4');
  });
  test('the cap is not applied when the table already asks for less', () => {
    const r = gecWithElectrodeCap('2', 'cu', 'rod'); // table says #8, cap is #6
    assert.strictEqual(r.capApplied, false);
    assert.strictEqual(r.finalCopper, '8');
  });
});
