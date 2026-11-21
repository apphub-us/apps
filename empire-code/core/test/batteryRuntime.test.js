'use strict';
/**
 * CONVERTER-WH-1 — battery / power-station runtime.
 *   1. the pure module: required values, invariants, validation, bounds, wording
 *   2. the engine injected into mobile.html is that module (parity)
 *   3. the shipped Converter tab (helpers/batteryRuntimeDom.js, real adapter on a stub DOM)
 * Expected values are stated from the physics (Wh = W × h), not recomputed with the module's own code.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../src/calc/batteryRuntime');
const dom = require('./helpers/batteryRuntimeDom');

const APP = path.join(__dirname, '..', 'mobile.html');
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), (label || '') + ' expected ' + expected + ', got ' + actual);
const run = (capacityWh, consumptionMode, consumption, chargePercent, usablePercent) => B.calculateBatteryRuntime({ capacityWh, consumptionMode, consumption, chargePercent, usablePercent });
const ok = (...a) => { const r = run(...a); assert.strictEqual(r.ok, true, JSON.stringify(r.errors)); assert.deepStrictEqual(r.errors, []); return r.data; };
const refused = (args, field, code) => {
  const r = run(...args);
  assert.strictEqual(r.ok, false, 'accepted: ' + JSON.stringify(args)); assert.strictEqual(r.data, null);
  const e = r.errors.find((x) => x.field === field);
  assert.ok(e, 'no error for ' + field + ' in ' + JSON.stringify(r.errors)); assert.strictEqual(e.code, code, JSON.stringify(args));
  for (const x of r.errors) assert.ok(x.message.length > 10 && !/NaN|Infinity|undefined|null/.test(x.message), x.message);
  return r;
};

describe('batteryRuntime — required cases', () => {
  test('1000 Wh at 100 W: 10 h with 100% usable, 8.5 h with 85%', () => {
    const full = ok('1000', 'w', '100', '100', '100'); near(full.availableWh, 1000); near(full.averageW, 100); near(full.hours, 10); assert.strictEqual(full.text.duration, 'Około 10 h 0 min');
    const d = ok('1000', 'w', '100', '100', '85'); near(d.availableWh, 850); near(d.hours, 8.5); assert.strictEqual(d.text.duration, 'Około 8 h 30 min');
  });
  test('1 kWh/day and 365 kWh/year are the same 41.666… W and 20.4 h (20 h 24 min) at 85%', () => {
    const day = ok('1000', 'kwh_day', '1', '100', '85'); const year = ok('1000', 'kwh_year', '365', '100', '85');
    for (const d of [day, year]) { near(d.averageW, 125 / 3); near(d.hours, 20.4); near(d.availableWh, 850); assert.strictEqual(d.text.duration, 'Około 20 h 24 min'); assert.strictEqual(d.text.averageW, '41,67 W'); }
    near(day.hours, year.hours);
    assert.strictEqual(day.text.averageBasis, '1 kWh/dobę × 1000 ÷ 24 h'); assert.strictEqual(year.text.averageBasis, '365 kWh/rok × 1000 ÷ 8760 h');
  });
  test('50% charge halves it to 10.2 h; 0% charge is a valid 0 h', () => {
    near(ok('1000', 'kwh_day', '1', '50', '85').hours, 10.2);
    const empty = ok('1000', 'kwh_day', '1', '0', '85');
    assert.strictEqual(empty.hours, 0); assert.strictEqual(empty.availableWh, 0); assert.strictEqual(empty.duration.kind, 'zero'); assert.strictEqual(empty.text.duration, '0 h — bateria rozładowana');
  });
  test('"1,2" kWh/day equals "1.2": 50 W and 17 h', () => {
    const comma = ok('1000', 'kwh_day', '1,2', '100', '85'); const dot = ok('1000', 'kwh_day', '1.2', '100', '85');
    assert.deepStrictEqual(comma, dot); near(comma.averageW, 50); near(comma.hours, 17); assert.strictEqual(comma.text.duration, 'Około 17 h 0 min');
  });
  test('the example is the documented illustrative case and the defaults leave capacity and consumption blank', () => {
    assert.deepStrictEqual({ ...B.EXAMPLE_FRIDGE }, { capacityWh: '1000', consumptionMode: 'kwh_year', consumption: '365', chargePercent: '100', usablePercent: '85' });
    assert.strictEqual(B.calculateBatteryRuntime(B.EXAMPLE_FRIDGE).data.text.duration, 'Około 20 h 24 min');
    assert.deepStrictEqual({ ...B.DEFAULTS }, { capacityWh: '', consumptionMode: 'w', consumption: '', chargePercent: '100', usablePercent: '85' });
    assert.strictEqual(B.calculateBatteryRuntime(B.DEFAULTS).ok, false);
    near(B.calculateBatteryRuntime({ capacityWh: 1000, consumptionMode: 'w', consumption: 100 }).data.hours, 8.5, 'omitted percents use the visible defaults 100 / 85');
  });
});

describe('batteryRuntime — invariants (independent of the implementation)', () => {
  test('energy is conserved, the three consumption units agree, and losses are applied exactly once', () => {
    let checked = 0;
    for (const cap of [0.5, 99, 256, 1000, 2048.5, 50000]) for (const w of [0.2, 5, 41.7, 100, 1800]) for (const charge of [0, 1, 37.5, 100]) for (const usable of [0.5, 85, 90, 100]) {
      const a = ok(cap, 'w', w, charge, usable);
      near(a.hours * a.averageW, cap * charge * usable / 10000, 'W × h = Wh');
      near(a.availableWh, cap * charge * usable / 10000);
      const day = ok(cap, 'kwh_day', w * 24 / 1000, charge, usable); const year = ok(cap, 'kwh_year', w * 8760 / 1000, charge, usable);
      near(day.hours, a.hours, 'kWh/day'); near(year.hours, a.hours, 'kWh/year'); near(day.averageW, w); near(year.averageW, w);
      for (const d of [a, day, year]) {
        for (const k of ['capacityWh', 'chargePercent', 'usablePercent', 'consumption', 'availableWh', 'averageW', 'hours']) assert.ok(Number.isFinite(d[k]) && d[k] >= 0, k);
        assert.ok(!/NaN|Infinity|undefined|null/.test(JSON.stringify(d.text)), JSON.stringify(d.text));
      }
      checked++;
    }
    assert.ok(checked >= 400);
    near(ok('1000', 'w', '100', '100', '85').hours * 2, ok('2000', 'w', '100', '100', '85').hours, 'linear in capacity');
    near(ok('1000', 'w', '100', '100', '85').hours / 2, ok('1000', 'w', '200', '100', '85').hours, 'inverse in load');
  });
  test('durations: under a minute is never "0 h"; minutes below 48 h; days and hours from 48 h', () => {
    const cases = [[0, 'zero', '0 h'], [1e-9, 'under_minute', 'Mniej niż 1 min'], [0.99 / 60, 'under_minute', 'Mniej niż 1 min'], [0.05, 'hours_minutes', 'Około 3 min'], [0.5, 'hours_minutes', 'Około 30 min'],
      [1, 'hours_minutes', 'Około 1 h 0 min'], [20.4, 'hours_minutes', 'Około 20 h 24 min'], [47.5, 'hours_minutes', 'Około 47 h 30 min'], [48, 'days_hours', 'Około 2 dni 0 h'], [77.4, 'days_hours', 'Około 3 dni 5 h'], [876000, 'days_hours', 'Około 36500 dni 0 h']];
    for (const [h, kind, text] of cases) { const d = B.describeDuration(h); assert.strictEqual(d.kind, kind, String(h)); assert.strictEqual(d.text, text, String(h)); assert.ok(d.minutes < 60 && d.hours >= 0); }
    for (const bad of [-1, NaN, Infinity, '5', null, undefined]) assert.strictEqual(B.describeDuration(bad), null);
    assert.strictEqual(ok('1', 'w', '1000', '100', '85').text.duration, 'Mniej niż 1 min');
  });
  test('number display uses a decimal comma and never an exponent', () => {
    for (const [v, s] of [[0, '0'], [850, '850'], [125 / 3, '41,67'], [1.2, '1,2'], [0.0125, '0,013'], [0.0004, '< 0,001'], [10000000, '10000000'], [99.999, '100']]) assert.strictEqual(B.formatNumber(v), s);
    for (const bad of [NaN, Infinity, -Infinity, '1', null, undefined]) assert.strictEqual(B.formatNumber(bad), '');
  });
});

describe('batteryRuntime — validation and bounds', () => {
  test('strict whole-value parsing: decimal comma or dot only, no trailing text, no exponent, no grouping', () => {
    for (const [raw, value] of [['1000', 1000], [' 1000 ', 1000], ['1.2', 1.2], ['1,2', 1.2], ['.5', 0.5], [',5', 0.5], ['007', 7], ['-3', -3], [42, 42], ['-0', 0]]) { const p = B.parseDecimal(raw); assert.strictEqual(p.ok, true, String(raw)); assert.ok(Object.is(p.value, value), raw + ' -> ' + p.value); }
    for (const raw of ['', '   ', '\t\n', null, undefined]) assert.deepStrictEqual(B.parseDecimal(raw), { ok: false, code: 'REQUIRED' });
    for (const raw of ['abc', '12abc', '12 W', '1.', '1,', '.', ',', '-', '+5', '1e3', '1E3', '0x10', '1 000', '1.000,5', '1,2,3', '1..2', '--1', 'Infinity', '-Infinity', 'NaN', '１２', NaN, Infinity, -Infinity, true, {}, [], ['1']]) assert.deepStrictEqual(B.parseDecimal(raw), { ok: false, code: 'INVALID_NUMBER' }, String(raw));
    assert.deepStrictEqual(B.parseDecimal('9'.repeat(400)), { ok: false, code: 'OUT_OF_RANGE' });
  });
  test('blank, whitespace, negative, zero, non-finite and partial values are refused with the field named', () => {
    for (const v of ['', '  ', null]) { refused([v, 'w', '100', '100', '85'], 'capacityWh', 'REQUIRED'); refused(['1000', 'w', v, '100', '85'], 'consumption', 'REQUIRED'); refused(['1000', 'w', '100', v, '85'], 'chargePercent', 'REQUIRED'); refused(['1000', 'w', '100', '100', v], 'usablePercent', 'REQUIRED'); }
    for (const v of ['0', '-1', '-0,5', 0, -5]) { refused([v, 'w', '100', '100', '85'], 'capacityWh', 'NOT_POSITIVE'); for (const m of B.MODES) refused(['1000', m, v, '100', '85'], 'consumption', 'NOT_POSITIVE'); }
    for (const v of ['Infinity', 'NaN', '12x', '1e3', '1.', NaN, Infinity, {}]) for (const i of [0, 2, 3, 4]) { const a = ['1000', 'w', '100', '100', '85']; a[i] = v; refused(a, ['capacityWh', '', 'consumption', 'chargePercent', 'usablePercent'][i], 'INVALID_NUMBER'); }
    assert.deepStrictEqual(B.calculateBatteryRuntime({ capacityWh: 'x', consumptionMode: 'w', consumption: 'x', chargePercent: 'x', usablePercent: 'x' }).errors.map((e) => e.message),
      ['Pojemność: wpisz samą liczbę, np. 1000 albo 1,2.', 'Zużycie: wpisz samą liczbę, np. 1000 albo 1,2.', 'Naładowanie: wpisz samą liczbę, np. 85.', 'Energia użyteczna: wpisz samą liczbę, np. 85.'], 'percent fields get a valid percent example');
    assert.strictEqual(B.calculateBatteryRuntime(B.DEFAULTS).errors.map((e) => e.field + ':' + e.code).join(), 'capacityWh:REQUIRED,consumption:REQUIRED');
    for (const junk of [undefined, null, 'x', 5, []]) assert.strictEqual(B.calculateBatteryRuntime(junk).ok, false);
  });
  test('unknown consumption mode is refused, never guessed', () => {
    for (const m of ['', 'W', 'kwh', 'kWh/day', 'kwh_month', 'mah', null, undefined, 1, {}]) { const r = refused(['1000', m, '100', '100', '85'], 'consumptionMode', 'INVALID_MODE'); assert.strictEqual(r.errors.length, 1); }
  });
  test('percent bounds: charge 0..100 inclusive; usable above 0 up to 100', () => {
    for (const c of ['0', '0,5', '100', 100]) ok('1000', 'w', '100', c, '85');
    for (const c of ['-0,1', '100,1', '101', '1000', -1]) refused(['1000', 'w', '100', c, '85'], 'chargePercent', 'OUT_OF_RANGE');
    for (const u of ['0,1', '85', '100']) ok('1000', 'w', '100', '100', u);
    for (const u of ['0', '-1', '100,01', '850']) refused(['1000', 'w', '100', '100', u], 'usablePercent', 'OUT_OF_RANGE');
  });
  test('practical bounds and overflow are rejected instead of producing huge or non-finite output', () => {
    ok('10000000', 'w', '1000000', '100', '100'); ok('1000', 'kwh_day', '24000', '100', '85'); ok('1000', 'kwh_year', '8760000', '100', '85');
    refused(['10000001', 'w', '100', '100', '85'], 'capacityWh', 'OUT_OF_RANGE'); refused(['9'.repeat(400), 'w', '100', '100', '85'], 'capacityWh', 'OUT_OF_RANGE');
    refused(['1000', 'w', '1000001', '100', '85'], 'consumption', 'OUT_OF_RANGE'); refused(['1000', 'kwh_day', '24001', '100', '85'], 'consumption', 'OUT_OF_RANGE'); refused(['1000', 'kwh_year', '8760001', '100', '85'], 'consumption', 'OUT_OF_RANGE');
    refused(['1000', 'kwh_year', 5e-324, '100', '85'], 'consumption', 'OUT_OF_RANGE');
    refused(['1000', 'w', '0,0000001', '100', '85'], 'consumption', 'RUNTIME_OUT_OF_RANGE'); refused([10000000, 'w', Number.MIN_VALUE, 100, 100], 'consumption', 'RESULT_NOT_FINITE'); // the division overflows to Infinity
    near(ok('876000', 'w', '1', '100', '100').hours, 876000, 'the 100-year bound itself is accepted');
  });
  test('the module is pure: no require, DOM, storage, network, clock or randomness', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'calc', 'batteryRuntime.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/require\(|document|window|localStorage|indexedDB|fetch|XMLHttpRequest|Date|Math\.random|process\./.test(src));
    const input = Object.freeze({ capacityWh: '1000', consumptionMode: 'kwh_day', consumption: '1', chargePercent: '100', usablePercent: '85' });
    assert.deepStrictEqual(B.calculateBatteryRuntime(input), B.calculateBatteryRuntime(input), 'deterministic, input untouched');
  });
});

describe('batteryRuntime — the engine injected into mobile.html is this module', { skip: fs.existsSync(APP) ? false : 'mobile.html not found' }, () => {
  test('PRODUCTION PARITY: constants and results match the source for valid, boundary and invalid input', () => {
    const EC = dom.bootEngine(fs.readFileSync(APP, 'utf8'));
    assert.ok(EC.batteryRuntime, 'EC.batteryRuntime missing — run `npm run build` in core/');
    for (const k of ['MODES', 'MODE_UNITS', 'DEFAULTS', 'EXAMPLE_FRIDGE', 'LIMITS']) assert.deepStrictEqual(EC.batteryRuntime[k], B[k], k);
    let compared = 0;
    for (const capacityWh of ['', '0', '1', '1000', '512,5', '10000001', 'x', 1000]) for (const consumptionMode of ['w', 'kwh_day', 'kwh_year', 'bad']) for (const consumption of ['', '0', '0,001', '1,2', '1.2', '100', '365', '9999999', '1e3']) for (const chargePercent of ['0', '50', '100', '101', '']) for (const usablePercent of ['85', '100', '0', undefined]) {
      const input = { capacityWh, consumptionMode, consumption, chargePercent, usablePercent };
      assert.deepStrictEqual(EC.batteryRuntime.calculateBatteryRuntime(input), B.calculateBatteryRuntime(input), JSON.stringify(input)); compared++;
    }
    assert.ok(compared > 5000, 'broad sweep, compared ' + compared);
  });
});

dom.defineUiSuite('core/mobile.html', APP);
