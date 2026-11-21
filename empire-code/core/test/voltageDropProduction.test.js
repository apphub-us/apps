'use strict';
/**
 * Production-path tests for the shipped standalone Voltage Drop panel.
 *
 * The panel is not reachable from Home, but it ships in mobile.html — these
 * execute the REAL `vdUpdateCalc()` directly against a stub DOM and read the
 * result grid and comparison table. Decisive guards as in every migration:
 * a poisoned engine result must be rendered verbatim in BOTH the grid and
 * the table, and one Calculate must make exactly one shared-engine call.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'mobile.html');
const skipAll = fs.existsSync(APP) ? false : 'mobile.html not found in the repository root';
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

const FIELDS = ['vdAmps', 'vdFeet', 'vdVoltage', 'vdPhase', 'vdMaterial',
  'vdMaxPct', 'vdResultGrid', 'vdTableTitle', 'vdCompTable', 'vdResultBox'];

const DEFAULTS = {
  vdAmps: '100', vdFeet: '150', vdVoltage: '208', vdPhase: '1',
  vdMaterial: 'cu', vdMaxPct: '5',
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

  const deps = fnBody('vdLabel');
  const api = {};
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'EC', 'exports',
    deps + fnBody('vdUpdateCalc') + ';exports.vdUpdateCalc=vdUpdateCalc;')(
    doc, win, win.EC, api);
  return { els, api, EC: win.EC, win };
}

function run(inputs) {
  Object.entries({ ...DEFAULTS, ...inputs }).forEach(([k, v]) => { harness.els[k].value = v; });
  harness.els.vdResultGrid.innerHTML = '';
  harness.els.vdCompTable.innerHTML = '';
  harness.els.vdTableTitle.textContent = '';
  harness.api.vdUpdateCalc();
  return {
    grid: harness.els.vdResultGrid.innerHTML,
    table: harness.els.vdCompTable.innerHTML,
    title: harness.els.vdTableTitle.textContent,
  };
}

describe('Production standalone Voltage Drop — full migration to the shared engine', { skip: skipAll }, () => {
  before(() => { harness = buildHarness(); });

  test('BEHAVIORAL GUARD: grid and table render the engine result, not a local formula', () => {
    const real = harness.EC.voltageDrop.analyzeVoltageDrop;
    try {
      harness.EC.voltageDrop.analyzeVoltageDrop = () => ({
        ok: true, material: 'cu', K: 12.9, phase: 1, multiplier: 2,
        amps: 100, feet: 150, voltage: 208, maxPercent: 5,
        maxVoltageDrop: 10.4, minCircularMils: 987654,
        recommendedSize: '600',
        recommended: { size: '600', circularMils: 600000, voltageDrop: 77.77,
          percentDrop: 88.88, voltageAtLoad: 130.23, ampacity75C: 420,
          ampacityOK: true, passesVdTarget: true, meetsBoth: true,
          isRecommended: true },
        rows: [
          { size: '600', circularMils: 600000, voltageDrop: 77.77,
            percentDrop: 88.88, voltageAtLoad: 130.23, ampacity75C: 420,
            ampacityOK: true, passesVdTarget: true, meetsBoth: true,
            isRecommended: true },
          { size: '14', circularMils: 4110, voltageDrop: 941.61,
            percentDrop: 452.7, voltageAtLoad: -733.61, ampacity75C: 20,
            ampacityOK: false, passesVdTarget: false, meetsBoth: false,
            isRecommended: false },
        ],
      });
      const out = run({});
      for (const marker of ['600 kcmil', '77.77V (88.88%)', '130.2V',
        '987,654 CM']) {
        assert.ok(out.grid.includes(marker),
          'poisoned grid field missing: ' + marker
          + ' — a local voltage-drop formula is deciding instead of the engine');
      }
      for (const marker of ['\u2605 600 kcmil \u2190 RECOMMENDED', '941.61V',
        '452.70%', '-733.6V', '\u2717 AMPACITY']) {
        assert.ok(out.table.includes(marker),
          'poisoned table field missing: ' + marker);
      }
    } finally {
      harness.EC.voltageDrop.analyzeVoltageDrop = real;
    }
  });

  test('BEHAVIORAL GUARD: one Calculate makes exactly ONE shared decision call', () => {
    const real = harness.EC.voltageDrop.analyzeVoltageDrop;
    let calls = 0;
    try {
      harness.EC.voltageDrop.analyzeVoltageDrop = (req) => { calls++; return real(req); };
      run({});
      assert.strictEqual(calls, 1,
        'the grid, recommendation and all 21 comparison rows must be one call');
    } finally {
      harness.EC.voltageDrop.analyzeVoltageDrop = real;
    }
  });

  test('the engine request carries every UI field faithfully', () => {
    const real = harness.EC.voltageDrop.analyzeVoltageDrop;
    let seen = null;
    try {
      harness.EC.voltageDrop.analyzeVoltageDrop = (req) => { seen = req; return real(req); };
      run({ vdAmps: '42.5', vdFeet: '732', vdVoltage: '480', vdPhase: '3',
        vdMaterial: 'al', vdMaxPct: '2' });
    } finally {
      harness.EC.voltageDrop.analyzeVoltageDrop = real;
    }
    assert.deepStrictEqual(seen, {
      amps: 42.5, feet: 732, voltage: 480, phase: 3, material: 'al',
      maxPercent: 2,
    });
  });

  test('representative copper single-phase case renders engine figures end to end', () => {
    // 100 A, 150 ft one-way, 208 V, 5%: minCM = 2x12.9x100x150/10.4 = 37212;
    // #4 (41,740 CM) is the first size meeting CM and 75C ampacity (85 < 100
    // fails; #3 100 >= 100 passes) -> recommended #3; drop = 387000/52620 =
    // 7.35V (3.54%), at-load 200.65 -> "200.6V" or "200.7V" per rounding.
    const out = run({});
    assert.ok(out.grid.includes('#3 AWG'), 'joint VD+ampacity pick is #3');
    assert.ok(out.grid.includes('7.35V (3.54%)'));
    assert.ok(out.grid.includes('37,212 CM'));
    assert.ok(out.grid.includes('150 ft (300 ft total)'),
      'one-way distance semantics: total shown as feet x 2');
    assert.ok(out.table.includes('\u2605 #3 AWG \u2190 RECOMMENDED'));
    assert.ok(out.title.includes('Copper'));
  });

  test('aluminum three-phase case renders the Al engine figures', () => {
    // 42.5 A, 732 ft, 480 V, 3ph Al, 2%: engine decides; spot-check a row
    // value: #4/0 drop = 1.732x21.2x42.5x732/211600 = 5.398V.
    const out = run({ vdAmps: '42.5', vdFeet: '732', vdVoltage: '480',
      vdPhase: '3', vdMaterial: 'al', vdMaxPct: '2' });
    assert.ok(out.table.includes('5.40V'), '4/0 Al 3ph row from the engine');
    assert.ok(out.title.includes('Aluminum'));
  });

  test('short-distance low-drop and long-distance high-drop both flow through', () => {
    const short = run({ vdAmps: '15', vdFeet: '10', vdVoltage: '120', vdMaxPct: '3' });
    assert.ok(short.grid.includes('#14 AWG'), 'smallest size wins short runs');
    const long = run({ vdAmps: '2000', vdFeet: '5000', vdVoltage: '120', vdMaxPct: '2' });
    assert.ok(long.grid.includes('NONE \u2014 run parallel'),
      'no single conductor: the legacy NONE label renders from a null recommendation');
    assert.ok(long.grid.includes('\u2014'), 'drop/at-load dashes');
  });

  test('exact-target boundary: a size exactly at the limit passes in the table', () => {
    // 10 A, 411 ft, 240 V, cu 1ph: #14 drop = 2x12.9x10x411/4110 = 25.8V =
    // 10.75%. With a 5% UI target #14 fails; the engine boundary itself is
    // pinned in voltageDrop.test.js — here assert the shipped ✗/✓ split
    // renders from engine booleans on a mid-table boundary: at 5%, minCM =
    // 2x12.9x10x411/12 = 8836.5 -> #10 (10380) passes, #12 (6530) fails.
    const out = run({ vdAmps: '10', vdFeet: '411', vdVoltage: '240', vdMaxPct: '5' });
    assert.ok(out.grid.includes('8,837 CM'), 'ceil of 8836.5');
    assert.ok(out.grid.includes('#10 AWG'));
    const rows = out.table.split('<tr');
    const r12 = rows.find((r) => r.includes('#12 AWG'));
    const r10 = rows.find((r) => r.includes('#10 AWG'));
    assert.ok(r12.includes('\u2717 VD OVER'));
    assert.ok(r10.includes('\u2713 OK'));
  });

  test('invalid input keeps the legacy quiet behavior (no render, no throw)', () => {
    harness.els.vdResultGrid.innerHTML = 'UNTOUCHED';
    Object.entries({ ...DEFAULTS, vdAmps: '0' }).forEach(([k, v]) => {
      harness.els[k].value = v;
    });
    harness.api.vdUpdateCalc();
    assert.strictEqual(harness.els.vdResultGrid.innerHTML, 'UNTOUCHED');
  });

  test('the fill-calc highlight is display-only and never changes the recommendation', () => {
    try {
      harness.win.vdHighlightSize = '1/0';
      const out = run({});
      assert.ok(out.table.includes('\u2192 1/0 AWG \u2190 FROM FILL CALC'));
      assert.ok(out.table.includes('\u2605 #3 AWG \u2190 RECOMMENDED'),
        'highlight must not displace the engine recommendation');
    } finally {
      delete harness.win.vdHighlightSize;
    }
  });

  test('structural: the standalone handler owns no formula, tables, or comparisons', () => {
    const s = html.indexOf('function vdLabel');
    const body = html.slice(s, html.indexOf('vdUpdateCalc();', s));
    for (const banned of ['VD_K', 'VD_CM', 'VD_SIZES', 'VD_AMP_CU', 'VD_AMP_AL',
      '1.732', '12.9', '21.2', '* amps * feet', '/ cm', 'minCM', 'wireAmp',
      '<= maxPct', '>= amps', 'vdCalcDrop']) {
      assert.ok(!body.includes(banned),
        'electrical logic is back in the standalone VD handler: ' + banned);
    }
    assert.ok(body.includes('EC.voltageDrop.analyzeVoltageDrop'));
    const hand = html.slice(html.indexOf('<!-- EC-CALC:END -->'));
    assert.ok(!/var VD_CM = \{/.test(hand),
      'a hand copy of the circular-mil table is back in mobile.html');
    assert.ok(!/var VD_K = \{/.test(hand),
      'a hand copy of the K constants is back in mobile.html');
    assert.ok(!/var VD_AMP_CU/.test(hand),
      'a hand copy of the 75C ampacity column is back in mobile.html');
    assert.ok(!/function vdCalcDrop/.test(hand),
      'the duplicated drop formula is back in mobile.html');
  });
});
