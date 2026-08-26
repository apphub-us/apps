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

describe('Motor migration — boundary and structured-result contracts', () => {
  const { calculateMotorCircuit } = require('../src/calc/motor');
  const { MT_FLC_1PH, MT_FLC_3PH, MT_V_1PH, MT_V_3PH, MT_STD } = require('../src/calc/tables');

  test('smallest and largest supported motors resolve deterministically', () => {
    const smallest = calculateMotorCircuit({ hp: '1/6', volts: 115, phase: 1 });
    assert.strictEqual(smallest.ok, true);
    assert.strictEqual(smallest.tableFLC, 4.4);
    assert.strictEqual(smallest.conductorSize, '14');
    const hps3 = Object.keys(MT_FLC_3PH);
    const largest = calculateMotorCircuit({
      hp: hps3[hps3.length - 1], volts: 460, phase: 3,
    });
    assert.strictEqual(largest.ok, true);
    assert.ok(largest.disconnectRating !== null,
      'the standard list must cover 115% of the largest table FLC');
    assert.ok(largest.standardProtection === null || largest.standardProtection <= 6000);
  });

  test('every listed table cell is reachable; every gap fails structurally', () => {
    for (const [phase, table, vList] of [[1, MT_FLC_1PH, MT_V_1PH],
      [3, MT_FLC_3PH, MT_V_3PH]]) {
      for (const hp of Object.keys(table)) {
        vList.forEach((volts, i) => {
          const cell = table[hp][i];
          const r = calculateMotorCircuit({ hp, volts, phase });
          if (cell === null || cell === undefined) {
            assert.strictEqual(r.ok, false, `${phase}ph ${hp}HP ${volts}V`);
            assert.strictEqual(r.reason, 'NOT_IN_TABLE');
          } else {
            assert.strictEqual(r.ok, true, `${phase}ph ${hp}HP ${volts}V`);
            assert.strictEqual(r.tableFLC, cell);
            assert.ok(Number.isFinite(r.minConductorAmpacity));
            assert.ok(Number.isFinite(r.maxProtection));
          }
        });
      }
    }
  });

  test('table-vs-nameplate: wire and breaker never borrow the nameplate figure', () => {
    // 10 HP 208 V 3ph, nameplate deliberately far from the table 30.8 A.
    const r = calculateMotorCircuit({ hp: '10', volts: 208, phase: 3,
      nameplateFLA: 20, serviceFactorMultiplier: 1.25 });
    assert.strictEqual(r.tableFLC, 30.8);
    assert.strictEqual(r.minConductorAmpacity, 38.5, '430.22 uses the TABLE');
    assert.strictEqual(r.maxProtection, 77, '430.52 uses the TABLE');
    assert.strictEqual(r.overloadMax, 25, '430.32 uses the NAMEPLATE: 20 x 1.25');
    assert.strictEqual(r.overloadBasis, 'nameplate');
    assert.strictEqual(r.nameplateDiffersFromTable, true);
    const same = calculateMotorCircuit({ hp: '10', volts: 208, phase: 3,
      nameplateFLA: 30.8 });
    assert.strictEqual(same.nameplateDiffersFromTable, false);
  });

  test('OCPD exactly at a standard rating does not skip to the next size', () => {
    // wound-rotor at 150%: find/craft a case landing exactly on a standard.
    // 1ph 2 HP @ 115 V: FLC 24 → 150% = 36... between; use designB dual 175%:
    // FLC 40 x 175% = 70 — exactly the 70 A standard.
    const r = calculateMotorCircuit({ hp: '3', volts: 115, phase: 1,
      motorType: 'designB', ocpdType: 'dual' });
    assert.strictEqual(r.tableFLC, 34);
    assert.strictEqual(r.maxProtection, 59.5);
    assert.strictEqual(r.standardProtection, 60, 'between standards rounds UP');
    const exact = calculateMotorCircuit({ hp: '1.5', volts: 115, phase: 1,
      motorType: 'wound', ocpdType: 'inverse' });
    assert.strictEqual(exact.tableFLC, 20);
    assert.strictEqual(exact.maxProtection, 30, '150% of 20 lands exactly on 30');
    assert.strictEqual(exact.standardProtection, 30,
      'exactly-at-standard selects that standard, never the next one up');
    assert.ok(MT_STD.includes(30));
  });

  test('conductor requirement exactly at a 75C column value takes that size', () => {
    // Need 430.22 result exactly equal to a t75 value: FLC 40 x 1.25 = 50 =
    // #8 Cu t75. 1ph 3 HP @ 115 V is 34 A... use 3ph 10 HP @ 230 V: 28 x 1.25
    // = 35 = #10 Cu t75 exactly.
    const r = calculateMotorCircuit({ hp: '10', volts: 230, phase: 3 });
    assert.strictEqual(r.tableFLC, 28);
    assert.strictEqual(r.minConductorAmpacity, 35);
    assert.strictEqual(r.conductorSize, '10', 'exactly-at-ampacity is accepted');
    // one table row up in current: the next size must be selected
    const over = calculateMotorCircuit({ hp: '10', volts: 208, phase: 3 });
    assert.strictEqual(over.minConductorAmpacity, 38.5);
    assert.strictEqual(over.conductorSize, '8');
  });

  test('aluminum conductor scan is supported by the engine contract', () => {
    const r = calculateMotorCircuit({ hp: '10', volts: 208, phase: 3, material: 'al' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.conductorSize, '8', 'Al #8 t75 is 40 >= 38.5');
  });

  test('invalid inputs fail with structured reasons, never a silent 3-phase fallthrough', () => {
    assert.strictEqual(calculateMotorCircuit({ hp: '10', volts: 208, phase: 2 })
      .reason, 'INVALID_PHASE');
    assert.strictEqual(calculateMotorCircuit({ hp: '10', volts: 208, phase: NaN })
      .reason, 'INVALID_PHASE');
    assert.strictEqual(calculateMotorCircuit({ hp: '10', volts: 208 })
      .reason, 'INVALID_PHASE', 'missing phase must not default to a table');
    assert.strictEqual(calculateMotorCircuit({ hp: '10', volts: 999, phase: 3 })
      .reason, 'NOT_IN_TABLE');
    assert.strictEqual(calculateMotorCircuit({ hp: '9999', volts: 208, phase: 3 })
      .reason, 'NOT_IN_TABLE');
    assert.strictEqual(calculateMotorCircuit({ hp: '10', volts: 208, phase: 3,
      material: 'brass' }).reason, 'INVALID_MATERIAL');
    assert.strictEqual(calculateMotorCircuit({ hp: '10', volts: 208, phase: 3,
      motorType: 'designB', ocpdType: 'plasma' }).reason, 'UNKNOWN_DEVICE');
    for (const sf of [0, -1, NaN, Infinity, '1.25']) {
      assert.strictEqual(calculateMotorCircuit({ hp: '10', volts: 208, phase: 3,
        serviceFactorMultiplier: sf }).reason, 'INVALID_SERVICE_FACTOR', String(sf));
    }
  });

  test('zero, negative and NaN nameplate mean "no overload figure", never NaN math', () => {
    for (const np of [0, -4, NaN, null, undefined]) {
      const r = calculateMotorCircuit({ hp: '10', volts: 208, phase: 3,
        nameplateFLA: np });
      assert.strictEqual(r.ok, true, String(np));
      assert.strictEqual(r.overloadMax, null, String(np));
      assert.strictEqual(r.nameplateProvided, false, String(np));
      assert.strictEqual(r.nameplateDiffersFromTable, false, String(np));
    }
  });

  test('the structured result carries no HTML and no NaN anywhere', () => {
    const r = calculateMotorCircuit({ hp: '10', volts: 208, phase: 3,
      nameplateFLA: 28.5 });
    assert.ok(!JSON.stringify(r).includes('<'));
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), k);
    }
  });
});
