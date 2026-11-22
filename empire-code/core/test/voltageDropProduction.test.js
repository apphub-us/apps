'use strict';
/**
 * Production-path tests for the shipped standalone (legacy) Voltage Drop panel.
 *
 * The panel is not reachable from Home, but it ships in mobile.html — these execute the REAL `vdUpdateCalc()`
 * against a stub DOM and read the result grid and comparison table.
 *
 * EC-AUDIT-FIX-1 stage 3 / EC-12: the panel is a VOLTAGE-DROP ANALYSIS ONLY. The earlier expectations of this file
 * (a "RECOMMENDED" conductor, a green "OK", an ampacity verdict, and old figures kept on invalid input) described
 * the behaviour the audit reported and were replaced. Kept: the engine-is-the-only-decider guards, one engine call
 * per calculation, the faithful request, and the figures rendered from the engine.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'mobile.html');
const HOSTED = path.join(__dirname, '..', '..', 'candidate', 'browser', 'workspace', 'mobile.html');
const skipAll = fs.existsSync(APP) ? false : 'mobile.html not found in the repository root';
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

const FIELDS = ['vdAmps', 'vdFeet', 'vdVoltage', 'vdPhase', 'vdMaterial',
  'vdMaxPct', 'vdResultGrid', 'vdTableTitle', 'vdCompTable', 'vdResultBox'];
const DEFAULTS = { vdAmps: '100', vdFeet: '150', vdVoltage: '208', vdPhase: '1', vdMaterial: 'cu', vdMaxPct: '5' };
const AUDIT = { vdAmps: '20', vdFeet: '10', vdVoltage: '120', vdPhase: '1', vdMaterial: 'cu', vdMaxPct: '3' };
const FIRST = ' ← smallest meeting VD limit';
// Case-sensitive on purpose: the scope note legitimately says "Ampacity … not checked here"; the old verdict was "✗ AMPACITY".
const CLAIMS = /RECOMMENDED|★|✓|✗|AMPACITY|result-ok|--success|Min Wire Size|[Aa]pproved/;

let harness = null;

function fnBody(source, name) {
  const i = source.indexOf('function ' + name);
  let depth = 0; let started = false;
  for (let j = i; j < source.length; j++) {
    if (source[j] === '{') { depth++; started = true; } else if (source[j] === '}') {
      depth--;
      if (started && depth === 0) return source.slice(i, j + 1);
    }
  }
  return '';
}

function buildHarness() {
  const els = {};
  FIELDS.forEach((id) => { els[id] = { value: '', innerHTML: '', textContent: '', style: {} }; });
  const doc = { getElementById: (id) => els[id] || null };
  const win = {};
  const s = html.indexOf('<!-- EC-CALC:START');
  const e = html.indexOf('<!-- EC-CALC:END -->');
  let block = html.slice(s, e);
  block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  // eslint-disable-next-line no-new-func
  new Function('window', block)(win);
  const api = {};
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'EC', 'exports',
    fnBody(html, 'vdLabel') + fnBody(html, 'vdUpdateCalc') + ';exports.vdUpdateCalc=vdUpdateCalc;')(doc, win, win.EC, api);
  return { els, api, EC: win.EC, win };
}

const shown = () => ({ grid: harness.els.vdResultGrid.innerHTML, table: harness.els.vdCompTable.innerHTML, title: harness.els.vdTableTitle.textContent });
/** Set the form and calculate WITHOUT clearing the output first, as the page does on every keystroke. */
function calc(inputs) {
  Object.entries({ ...DEFAULTS, ...inputs }).forEach(([k, v]) => { harness.els[k].value = v; });
  harness.api.vdUpdateCalc();
  return shown();
}
function run(inputs) {
  harness.els.vdResultGrid.innerHTML = ''; harness.els.vdCompTable.innerHTML = ''; harness.els.vdTableTitle.textContent = '';
  return calc(inputs);
}

describe('Production standalone Voltage Drop — shared engine, voltage-drop criterion only (EC-12)', { skip: skipAll }, () => {
  before(() => { harness = buildHarness(); });

  test('BEHAVIORAL GUARD: grid and table render the engine result, not a local formula', () => {
    const real = harness.EC.voltageDrop.analyzeVoltageDrop;
    try {
      harness.EC.voltageDrop.analyzeVoltageDrop = () => ({
        ok: true, material: 'cu', K: 12.9, phase: 1, multiplier: 2,
        amps: 100, feet: 150, voltage: 208, maxPercent: 5,
        maxVoltageDrop: 10.4, minCircularMils: 987654,
        recommendedSize: '14',
        recommended: { size: '14', circularMils: 4110, voltageDrop: 1.11, percentDrop: 2.22, voltageAtLoad: 3.33, ampacity75C: 20, ampacityOK: true, passesVdTarget: false, meetsBoth: true, isRecommended: true },
        rows: [
          { size: '14', circularMils: 4110, voltageDrop: 941.61, percentDrop: 452.7, voltageAtLoad: -733.61, ampacity75C: 20, ampacityOK: true, passesVdTarget: false, meetsBoth: true, isRecommended: true },
          { size: '600', circularMils: 600000, voltageDrop: 77.77, percentDrop: 88.88, voltageAtLoad: 130.23, ampacity75C: 420, ampacityOK: false, passesVdTarget: true, meetsBoth: false, isRecommended: false },
        ],
      });
      const out = run({});
      for (const marker of ['600 kcmil', '77.77V (88.88%)', '130.2V', '987,654 CM']) {
        assert.ok(out.grid.includes(marker), 'poisoned grid field missing: ' + marker + ' — a local voltage-drop formula is deciding instead of the engine');
      }
      for (const marker of ['600 kcmil' + FIRST, '941.61V', '452.70%', '-733.6V', 'VD over limit', 'VD within limit']) {
        assert.ok(out.table.includes(marker), 'poisoned table field missing: ' + marker);
      }
      // EC-12: the engine's joint "recommended" / ampacity fields are NOT what the panel shows — only its drop-limit flag is
      assert.ok(!out.grid.includes('#14 AWG'), 'the joint recommendation must not be rendered as the answer');
      assert.ok(!out.grid.includes('1.11V'));
      assert.ok(!CLAIMS.test(out.grid + out.table + out.title));
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
      assert.strictEqual(calls, 1, 'the grid and all 21 comparison rows must be one call');
    } finally {
      harness.EC.voltageDrop.analyzeVoltageDrop = real;
    }
  });

  test('the engine request carries every UI field faithfully', () => {
    const real = harness.EC.voltageDrop.analyzeVoltageDrop;
    let seen = null;
    try {
      harness.EC.voltageDrop.analyzeVoltageDrop = (req) => { seen = req; return real(req); };
      run({ vdAmps: '42.5', vdFeet: '732', vdVoltage: '480', vdPhase: '3', vdMaterial: 'al', vdMaxPct: '2' });
    } finally {
      harness.EC.voltageDrop.analyzeVoltageDrop = real;
    }
    assert.deepStrictEqual(seen, { amps: 42.5, feet: 732, voltage: 480, phase: 3, material: 'al', maxPercent: 2 });
  });

  test('representative copper single-phase case renders engine figures end to end (voltage drop only)', () => {
    // 100 A, 150 ft one-way, 208 V, 5%: the smallest circular-mil area meeting the limit is 37,212 CM, so #4
    // (41,740 CM) is the first size inside the DROP limit: 387000 / 41740 = 9.27 V = 4.46 %. Whether #4 can carry
    // 100 A is not this panel's question (it used to answer "#3" by mixing in a 75 C ampacity column).
    const out = run({});
    assert.ok(out.grid.includes('Smallest size meeting the VD limit'));
    assert.ok(out.grid.includes('#4 AWG'));
    assert.ok(out.grid.includes('9.27V (4.46%)'));
    assert.ok(out.grid.includes('37,212 CM'));
    assert.ok(out.grid.includes('150 ft (300 ft total)'), 'one-way distance semantics: total shown as feet x 2');
    assert.ok(out.grid.includes('>5%<'), 'the limit the analysis was run against is shown');
    assert.ok(out.table.includes('#4 AWG' + FIRST));
    assert.ok(out.title.includes('Copper') && out.title.startsWith('VOLTAGE DROP BY WIRE SIZE'));
  });

  test('aluminum three-phase case renders the Al engine figures', () => {
    // 42.5 A, 732 ft, 480 V, 3ph Al, 2%: spot-check a row value: #4/0 drop = 1.732x21.2x42.5x732/211600 = 5.398V.
    const out = run({ vdAmps: '42.5', vdFeet: '732', vdVoltage: '480', vdPhase: '3', vdMaterial: 'al', vdMaxPct: '2' });
    assert.ok(out.table.includes('5.40V'), '4/0 Al 3ph row from the engine');
    assert.ok(out.title.includes('Aluminum'));
  });

  test('short-distance low-drop and long-distance high-drop both flow through', () => {
    const short = run({ vdAmps: '15', vdFeet: '10', vdVoltage: '120', vdMaxPct: '3' });
    assert.ok(short.grid.includes('#14 AWG'), 'the smallest size is inside the drop limit on a short run');
    const long = run({ vdAmps: '2000', vdFeet: '5000', vdVoltage: '120', vdMaxPct: '2' });
    assert.ok(long.grid.includes('NONE in this table'), 'no size in the table meets the limit');
    assert.ok(long.grid.includes('—'), 'drop/at-load dashes');
    assert.ok(!long.table.includes(FIRST) && !long.table.includes('VD within limit'));
  });

  test('exact-target boundary: the within / over split renders from the engine flag', () => {
    // 10 A, 411 ft, 240 V, cu 1ph at 5%: minimum area 8836.5 CM -> #10 (10380) is within, #12 (6530) is over.
    const out = run({ vdAmps: '10', vdFeet: '411', vdVoltage: '240', vdMaxPct: '5' });
    assert.ok(out.grid.includes('8,837 CM'), 'ceil of 8836.5');
    assert.ok(out.grid.includes('#10 AWG'));
    const rows = out.table.split('<tr');
    const r12 = rows.find((r) => r.includes('#12 AWG'));
    const r10 = rows.find((r) => r.includes('#10 AWG'));
    assert.ok(r12.includes('VD over limit') && !r12.includes('VD within limit'));
    assert.ok(r10.includes('VD within limit') && r10.includes(FIRST));
  });

  test('EC-12: the audit case (20 A, 10 ft, 120 V, 1-phase, Cu, 3 %) makes no complete-sizing claim', () => {
    const out = run(AUDIT);
    const all = out.grid + out.table + out.title;
    // #14 appears only as the answer to the voltage-drop question…
    assert.ok(out.grid.includes('Smallest size meeting the VD limit') && out.grid.includes('#14 AWG'));
    assert.ok(out.table.includes('#14 AWG' + FIRST));
    // …with no recommendation, approval mark, green styling or ampacity verdict anywhere
    assert.ok(!CLAIMS.test(all), 'a sizing claim is back: ' + (all.match(CLAIMS) || [''])[0]);
    assert.ok(!/\bOK\b/.test(all));
    // …and the scope is stated next to the result, with the route to the complete selection
    assert.ok(out.grid.includes('id="vdScopeNote"'));
    assert.ok(out.grid.includes('Voltage-drop criterion only') && out.grid.includes('not a conductor selection'));
    assert.ok(out.grid.includes('Ampacity, overcurrent protection, terminal ratings and code minimum sizes are not checked here'));
    assert.ok(out.grid.includes('onclick="openTool(\'wiresizer\')"') && out.grid.includes('Open Wire Sizer for a complete conductor selection'));
    // it does not state that #14 is, or is not, permitted
    assert.ok(!/not permitted|illegal|too small|violat/i.test(all));
  });

  test('EC-12: valid -> blank / zero / invalid input removes every earlier figure, row and heading', () => {
    for (const [field, bad] of [['vdAmps', ''], ['vdAmps', '0'], ['vdAmps', '-5'], ['vdAmps', 'abc'], ['vdFeet', ''], ['vdFeet', '0'], ['vdFeet', '-1']]) {
      const valid = calc(AUDIT);
      assert.ok(valid.grid.includes('#14 AWG') && valid.title.includes('20A') && valid.title.includes('10ft') && valid.table.includes('<tr'), 'precondition: a rendered 20 A / 10 ft result');
      const out = calc({ ...AUDIT, [field]: bad });
      const label = field + '=' + JSON.stringify(bad);
      assert.strictEqual(out.table, '', label + ': all comparison rows removed');
      assert.strictEqual(out.title, 'VOLTAGE DROP BY WIRE SIZE', label + ': the heading no longer names the old load and distance');
      assert.ok(!/#14|AWG|kcmil|20A|10 ft|\d+\.\d\dV|\d CM/.test(out.grid), label + ': an old figure is still shown: ' + out.grid);
      assert.ok(out.grid.includes('id="vdNoResult"') && out.grid.includes('role="status"') && out.grid.includes('Earlier figures were cleared'), label);
      assert.ok(out.grid.includes('id="vdScopeNote"'), label + ': the scope note stays');
    }
    // and a valid input afterwards renders again
    assert.ok(calc(AUDIT).grid.includes('#14 AWG'));
  });

  test('the fill-calc highlight is display-only and never changes the analysis', () => {
    try {
      harness.win.vdHighlightSize = '1/0';
      const out = run({});
      assert.ok(out.table.includes('→ 1/0 AWG ← FROM FILL CALC'));
      assert.ok(out.table.includes('#4 AWG' + FIRST), 'the highlight must not displace the engine result');
    } finally {
      delete harness.win.vdHighlightSize;
    }
  });

  test('structural: the standalone handler owns no formula, tables, comparisons or approval styling', () => {
    const s = html.indexOf('function vdLabel');
    const body = html.slice(s, html.indexOf('vdUpdateCalc();', s));
    for (const banned of ['VD_K', 'VD_CM', 'VD_SIZES', 'VD_AMP_CU', 'VD_AMP_AL',
      '1.732', '12.9', '21.2', '* amps * feet', '/ cm', 'minCM', 'wireAmp',
      '<= maxPct', '>= amps', 'vdCalcDrop', 'RECOMMENDED', 'result-ok', '--success', 'isRecommended', 'r.recommended', 'opacity:0.4']) {
      assert.ok(!body.includes(banned), 'electrical logic or an approval claim is back in the standalone VD handler: ' + banned);
    }
    assert.ok(body.includes('EC.voltageDrop.analyzeVoltageDrop'));
    const hand = html.slice(html.indexOf('<!-- EC-CALC:END -->'));
    assert.ok(!/var VD_CM = \{/.test(hand), 'a hand copy of the circular-mil table is back in mobile.html');
    assert.ok(!/var VD_K = \{/.test(hand), 'a hand copy of the K constants is back in mobile.html');
    assert.ok(!/var VD_AMP_CU/.test(hand), 'a hand copy of the 75C ampacity column is back in mobile.html');
    assert.ok(!/function vdCalcDrop/.test(hand), 'the duplicated drop formula is back in mobile.html');
  });

  test('EC-12: the static panel states its scope, stays out of the Tools registry, and the hosted copy runs the same handler', () => {
    const panel = html.slice(html.indexOf('<div class="panel" id="panel-vdrop">'), html.indexOf('<div class="panel" id="panel-boxfill">'));
    assert.ok(panel.includes('VOLTAGE DROP ANALYSIS — VOLTAGE-DROP CRITERION ONLY'));
    assert.ok(!/RECOMMENDED|>Status</.test(panel));
    const groups = (html.match(/var TOOL_GROUPS = \[[\s\S]*?\n\];/) || [''])[0];
    const tools = (html.match(/var TOOLS = \{[\s\S]*?\n\};/) || [''])[0];
    assert.ok(groups.length > 0 && tools.length > 0, 'the Tools registry was found');
    assert.ok(!groups.includes('vdrop') && !tools.includes('vdrop'), 'the legacy panel must not be exposed as a tool');
    assert.ok(!html.includes("openTool('vdrop')") && !html.includes('id="mnav-vdrop"'));
    assert.ok(/wiresizer:\s*\{/.test(tools), 'the routed-to Wire Sizer is a registered tool');
    const hosted = fs.readFileSync(HOSTED, 'utf8');
    assert.strictEqual(fnBody(hosted, 'vdUpdateCalc'), fnBody(html, 'vdUpdateCalc'));
    assert.strictEqual(hosted.slice(hosted.indexOf('<div class="panel" id="panel-vdrop">'), hosted.indexOf('<div class="panel" id="panel-boxfill">')), panel);
  });
});
