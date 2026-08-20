'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { calculateMotorCircuit, tableFLC, nextStandard } = require('../src/calc/motor');

describe('Motors — NEC Article 430', () => {
  test('Table 430.250: 25 HP at 460 V three phase is 34 A', () => {
    assert.strictEqual(tableFLC('25', 460, 3), 34);
  });

  test('Table 430.250: 25 HP at 230 V three phase is 68 A', () => {
    assert.strictEqual(tableFLC('25', 230, 3), 68);
  });

  test('Table 430.248: 1 HP at 115 V single phase is 16 A', () => {
    assert.strictEqual(tableFLC('1', 115, 1), 16);
  });

  test('430.22: conductors at 125% of TABLE FLC', () => {
    const r = calculateMotorCircuit({ hp: '25', volts: 460, phase: 3 });
    assert.strictEqual(r.minConductorAmpacity, 42.5);
    assert.strictEqual(r.conductorSize, '8'); // #8 Cu = 50 A at 75C
  });

  test('430.52: dual-element fuse at 175% of 34 A rounds to 60 A', () => {
    const r = calculateMotorCircuit({ hp: '25', volts: 460, phase: 3, ocpdType: 'dual' });
    assert.strictEqual(r.protectionPercent, 175);
    assert.strictEqual(r.maxProtection, 59.5);
    assert.strictEqual(r.standardProtection, 60);
  });

  test('430.52: inverse time breaker at 250% of 34 A rounds to 90 A', () => {
    const r = calculateMotorCircuit({ hp: '25', volts: 460, phase: 3, ocpdType: 'inverse' });
    assert.strictEqual(r.standardProtection, 90);
  });

  test('430.52: non-time-delay fuse at 300% of 68 A rounds to 225 A', () => {
    const r = calculateMotorCircuit({ hp: '25', volts: 230, phase: 3, ocpdType: 'nontd' });
    assert.strictEqual(r.maxProtection, 204);
    assert.strictEqual(r.standardProtection, 225);
  });

  test('Design B energy-efficient gets 1100% for an instantaneous trip, others 800%', () => {
    const b = calculateMotorCircuit({ hp: '25', volts: 460, phase: 3, motorType: 'designB', ocpdType: 'inst' });
    const o = calculateMotorCircuit({ hp: '25', volts: 460, phase: 3, motorType: 'other', ocpdType: 'inst' });
    assert.strictEqual(b.protectionPercent, 1100);
    assert.strictEqual(o.protectionPercent, 800);
  });

  test('430.32: overload comes from the NAMEPLATE, not the table', () => {
    const r = calculateMotorCircuit({
      hp: '25', volts: 460, phase: 3, nameplateFLA: 31, serviceFactorMultiplier: 1.25,
    });
    assert.strictEqual(r.overloadMax, 38.75); // 31 x 1.25, NOT 34 x 1.25
    assert.strictEqual(r.overloadBasis, 'nameplate');
    assert.strictEqual(r.nameplateDiffersFromTable, true);
  });

  test('conductors and overload use different sources — the classic 430 trap', () => {
    const r = calculateMotorCircuit({ hp: '25', volts: 460, phase: 3, nameplateFLA: 31 });
    assert.strictEqual(r.tableFLC, 34);       // sizes the wire and the breaker
    assert.strictEqual(r.overloadMax, 38.75); // sizes the overload
    assert.notStrictEqual(r.tableFLC * 1.25, r.overloadMax);
  });

  test('430.110: disconnect at least 115% of FLC', () => {
    const r = calculateMotorCircuit({ hp: '25', volts: 460, phase: 3 });
    assert.strictEqual(r.disconnectRating, 40); // 34 x 1.15 = 39.1 -> 40
  });

  test('an HP/voltage combination absent from the table fails cleanly', () => {
    const r = calculateMotorCircuit({ hp: '3', volts: 115, phase: 3 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'NOT_IN_TABLE');
  });

  test('240.6(A) next standard rating', () => {
    assert.strictEqual(nextStandard(59.5), 60);
    assert.strictEqual(nextStandard(60), 60);
    assert.strictEqual(nextStandard(204), 225);
  });
});
