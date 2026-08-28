'use strict';
/**
 * Production-path tests for the shipped Motor calculator.
 *
 * These execute the REAL `mtCalc()` from mobile.html against a stub DOM and
 * read what it renders. The decisive guards follow the Wire Sizer / Box Fill
 * lesson: a poisoned engine result must be rendered verbatim, and one
 * Calculate action must make exactly one shared-engine decision call.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'mobile.html');
const skipAll = fs.existsSync(APP) ? false : 'mobile.html not found in the repository root';
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

const FIELDS = ['mt-phase', 'mt-volts', 'mt-hp', 'mt-type', 'mt-ocpd',
  'mt-nameplate', 'mt-sf', 'mt-result', 'mt-note'];

const DEFAULTS = {
  'mt-phase': '3', 'mt-volts': '208', 'mt-hp': '10', 'mt-type': 'designB',
  'mt-ocpd': 'inverse', 'mt-nameplate': '', 'mt-sf': '1.25',
};

let harness = null;

function buildHarness() {
  function fnBody(name) {
    const i = html.indexOf('function ' + name);
    let depth = 0; let started = false;
    for (let j = i; j < html.length; j++) {
      if (html[j] === '{') { depth++; started = true; } else if (html[j] === '}') {
        depth--;
        if (started && depth === 0) return html.slice(i, j + 1);
      }
    }
    return '';
  }
  function varBlock(name) {
    const i = html.indexOf('var ' + name);
    let depth = 0; const st = html.indexOf('{', i);
    for (let j = st; j < html.length; j++) {
      if (html[j] === '{') depth++;
      else if (html[j] === '}') {
        depth--;
        if (depth === 0) return html.slice(i, html.indexOf(';', j) + 1);
      }
    }
    return '';
  }
  const els = {};
  FIELDS.forEach((id) => {
    els[id] = { value: '', innerHTML: '', textContent: '', style: {} };
  });
  const doc = { getElementById: (id) => els[id] || null };
  const win = {};
  const s = html.indexOf('<!-- EC-CALC:START');
  const e = html.indexOf('<!-- EC-CALC:END -->');
  let block = html.slice(s, e);
  block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  // eslint-disable-next-line no-new-func
  new Function('window', block)(win);

  const deps = varBlock('MT_OCPD_LABEL') + fnBody('mtRow');
  const api = {};
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'EC', 'exports',
    deps + fnBody('mtCalc') + ';exports.mtCalc=mtCalc;')(doc, win, win.EC, api);
  return { els, api, EC: win.EC };
}

function run(inputs) {
  Object.entries({ ...DEFAULTS, ...inputs }).forEach(([k, v]) => { harness.els[k].value = v; });
  harness.els['mt-result'].innerHTML = '';
  harness.els['mt-note'].innerHTML = '';
  harness.els['mt-note'].textContent = '';
  harness.api.mtCalc();
  return harness.els['mt-result'].innerHTML;
}

describe('Production Motor — full migration to the shared engine', { skip: skipAll }, () => {
  before(() => { harness = buildHarness(); });

  test('BEHAVIORAL GUARD: the rendered result comes from the engine, not local formulas', () => {
    const real = harness.EC.motor.calculateMotorCircuit;
    try {
      harness.EC.motor.calculateMotorCircuit = () => ({
        ok: true, tableFLC: 777, tableRef: 'SYNTHETIC TABLE 9.99',
        minConductorAmpacity: 971.25, conductorSize: '600',
        protectionPercent: 999, maxProtection: 7761.1, standardProtection: 6000,
        disconnectRating: 894, overloadMax: 123.9, overloadBasis: 'nameplate',
        overloadPercentApplied: 125, serviceFactorMultiplier: 1.25,
        nameplateProvided: true, nameplateDiffersFromTable: true,
      });
      const out = run({ 'mt-nameplate': '99.1' });
      for (const marker of ['777 A', 'SYNTHETIC TABLE 9.99', '971.3 A',
        '600 kcmil', '999% of FLC', '7761.1 A', '6000 A', '894 A min',
        '123.9 A max']) {
        assert.ok(out.includes(marker),
          'poisoned field missing from render: ' + marker
          + ' — a local Motor calculation is deciding instead of the engine');
      }
    } finally {
      harness.EC.motor.calculateMotorCircuit = real;
    }
  });

  test('BEHAVIORAL GUARD: one calculation makes exactly ONE shared decision call', () => {
    const real = harness.EC.motor.calculateMotorCircuit;
    let calls = 0;
    try {
      harness.EC.motor.calculateMotorCircuit = (req) => { calls++; return real(req); };
      run({});
      assert.strictEqual(calls, 1);
    } finally {
      harness.EC.motor.calculateMotorCircuit = real;
    }
  });

  test('the engine request carries every UI field faithfully', () => {
    const real = harness.EC.motor.calculateMotorCircuit;
    let seen = null;
    try {
      harness.EC.motor.calculateMotorCircuit = (req) => { seen = req; return real(req); };
      run({ 'mt-phase': '1', 'mt-volts': '230', 'mt-hp': '2', 'mt-type': 'wound',
        'mt-ocpd': 'dual', 'mt-nameplate': '11.4', 'mt-sf': '1.15' });
    } finally {
      harness.EC.motor.calculateMotorCircuit = real;
    }
    assert.deepStrictEqual(seen, {
      hp: '2', volts: '230', phase: 1, motorType: 'wound', ocpdType: 'dual',
      nameplateFLA: 11.4, serviceFactorMultiplier: 1.15,
    });
  });

  test('representative three-phase case renders engine figures end to end', () => {
    // 10 HP, 208 V, 3ph: FLC 30.8 — 430.22 gives 38.5 A → #8 Cu (t75 = 50);
    // inverse-time 250% → 77 A → next standard 80 A; disconnect 115% → 40 A.
    const out = run({});
    assert.ok(out.includes('30.8 A'));
    assert.ok(out.includes('Table 430.250'));
    assert.ok(out.includes('38.5 A'));
    assert.ok(out.includes('#8 AWG'));
    assert.ok(out.includes('77.0 A'));
    assert.ok(out.includes('80 A'));
    assert.ok(out.includes('40 A min'));
  });

  test('representative single-phase low-HP case renders engine figures', () => {
    // 1/2 HP, 115 V, 1ph: FLC 9.8 → 12.25 A → #14 Cu; 250% → 24.5 → 25 A std.
    const out = run({ 'mt-phase': '1', 'mt-volts': '115', 'mt-hp': '1/2' });
    assert.ok(out.includes('9.8 A'));
    assert.ok(out.includes('Table 430.248'));
    assert.ok(out.includes('12.3 A'));
    assert.ok(out.includes('#14 AWG'));
    assert.ok(out.includes('25 A'));
  });

  test('overload row uses the NAMEPLATE basis while wire/breaker keep the table basis', () => {
    const out = run({ 'mt-nameplate': '28.5', 'mt-sf': '1.25' });
    assert.ok(out.includes('35.6 A max'), '28.5 x 1.25 from the nameplate');
    assert.ok(out.includes('30.8 A'), 'table FLC still drives the wire/breaker rows');
    assert.ok(out.includes('NAMEPLATE 28.5 A'));
    assert.ok(harness.els['mt-note'].innerHTML.includes('nameplate reads 28.5'),
      'the differs-from-table tip comes from the engine flag');
  });

  test('missing nameplate keeps the prompt row (no overload figure invented)', () => {
    const out = run({ 'mt-nameplate': '' });
    assert.ok(out.includes('enter nameplate FLA'));
  });

  test('an unlisted combination renders the legacy not-listed row', () => {
    // 1ph table has no 460 V column; force the value past the select.
    const out = run({ 'mt-phase': '1', 'mt-volts': '460', 'mt-hp': '2' });
    assert.ok(out.includes('Not listed'));
    assert.ok(harness.els['mt-note'].textContent.includes('no table entry'));
  });

  test('structural: mtCalc owns no tables, multipliers, or size selection', () => {
    const s = html.indexOf('function mtCalc');
    const body = html.slice(s, html.indexOf('function mtReset', s));
    for (const banned of ['MT_FLC', 'MT_V_1PH', 'MT_V_3PH', 'MT_PCT', 'MT_STD',
      'mtNextStd', '* 1.25', '* 1.15', 'pct / 100', 't75', "'14'",
      'indexOf(volts)']) {
      assert.ok(!body.includes(banned),
        'electrical logic is back in mtCalc: ' + banned);
    }
    assert.ok(body.includes('EC.motor.calculateMotorCircuit'));
    const hand = html.slice(html.indexOf('<!-- EC-CALC:END -->'));
    assert.ok(!/var MT_FLC_1PH = \{/.test(hand),
      'a hand copy of Table 430.248 is back in mobile.html');
    assert.ok(!/var MT_PCT = \{/.test(hand),
      'a hand copy of the 430.52 percentage table is back in mobile.html');
    assert.ok(!/var MT_STD = \[/.test(hand),
      'a hand copy of the standard-device list is back in mobile.html');
    assert.ok(!/function mtNextStd/.test(hand),
      'the duplicated next-standard selector is back in mobile.html');
    assert.ok(/var MT_FLC_1PH = EC\.tables\.MT_FLC_1PH/.test(hand),
      'the select-population tables must alias the shared tables');
  });
});
