'use strict';
// PRIVATE-PILOT-5 — form / engine / registry parity of the two shipped pages (core/mobile.html and the hosted
// candidate/browser/workspace/mobile.html). Local files only; nothing is fetched, stored or built here.
//
// What runs is the SHIPPED code: the Wireway template, wwCalc / wwReset / wwRenderTable, the Wire Sizer markup and wsCalc
// are cut verbatim out of each page and executed on a stub DOM against the engine bundled in that same page (the pattern of
// core/test/helpers/batteryRuntimeDom.js and tests/stage5-form-bridge.test.cjs). The engine is observed, never replaced,
// except in the two guards that deliberately feed the renderer a synthetic engine answer.
//
// G-01  Wireway Fill: the form result is the shared engine's result (EC.conduitFill.calculateWirewayFill — the function the
//       conversation tool wireway_fill runs); no page-local formula, table lookup or fallback value takes part.
// WS    Wire Sizer: an answer left in the hidden "Feeds a Dwelling Unit?" control does not reach a branch-circuit request.
// PAGE  The two pages are the same document apart from the generated engine block and the documented host wiring.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const DOM = require('../core/test/helpers/batteryRuntimeDom.js');
const B = require('../candidate/browser/workspace/assistant-bridge.js');
const REG = require('../core/src/calc/conversationTools.js');
const SRC_FILL = require('../core/src/calc/conduitFill.js');
const SRC_TABLES = require('../core/src/calc/tables.js');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const CORE = read('core/mobile.html'), HOSTED = read('candidate/browser/workspace/mobile.html');
const PAGES = [['core/mobile.html', CORE], ['candidate/browser/workspace/mobile.html', HOSTED]];
const json = (x) => JSON.parse(JSON.stringify(x));
const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
const handOf = (html) => html.slice(html.indexOf(DOM.END));
const registryOf = (EC) => EC.conversationTools || REG;   // the bundled registry once Root has regenerated the block; the same source otherwise
// One boot of each page's bundled engine for the whole file: the modules are pure and no test writes into them (the form
// functions get an observing copy, see wirewayPage / wirePage).
const ENGINES = new Map();
const engineOf = (html) => { if (!ENGINES.has(html)) ENGINES.set(html, DOM.bootEngine(html)); return ENGINES.get(html); };

function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'function not found in the shipped page: ' + name);
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; } else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unterminated function: ' + name);
}
function node(init) {
  const set = new Set();
  return Object.assign({ value: '', textContent: '', innerHTML: '', style: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; },
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)) } }, init || {});
}
// Like a real <select>: a value that is not one of its options does not stick (the control reads ''). addOption() stands for
// an option the page offers; it is how a test puts an otherwise impossible value in front of the form's own reader.
function select(values, selected) {
  const list = values.slice(); let cur = selected;
  const n = node({ options: list.map((v) => ({ value: v })) });
  Object.defineProperty(n, 'value', { enumerable: true, configurable: true, get: () => cur, set: (v) => { cur = list.includes(String(v)) ? String(v) : ''; } });
  n.addOption = (v) => { if (!list.includes(v)) { list.push(v); n.options.push({ value: v }); } };
  n.optionValues = () => list.slice();
  return n;
}
function controlsOf(markup) {
  const els = {};
  for (const m of markup.matchAll(/<input\b[^>]*>/g)) { const id = attr(m[0], 'id'); if (id) els[id] = node({ value: attr(m[0], 'value') || '' }); }
  for (const m of markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const id = attr('<x' + m[1] + '>', 'id'); if (!id) continue;
    const opts = [...m[2].matchAll(/<option\b([^>]*)>([^<]*)/g)].map((o) => { const v = attr('<x' + o[1] + '>', 'value'); return { value: v === null ? o[2].trim() : v, selected: /\sselected\b/.test(o[1]) }; });
    els[id] = select(opts.map((o) => o.value), (opts.find((o) => o.selected) || opts[0]).value);
  }
  return els;
}
function makeDoc(els) {
  const listeners = {};
  return { readyState: 'complete', getElementById: (id) => (Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null), querySelectorAll: () => [],
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }, fire: (type) => (listeners[type] || []).forEach((fn) => fn({ type })) };
}
const build = (doc, globals, EC) => B.createBridge({ document: doc, registry: () => registryOf(EC), ec: () => EC, page: (n) => globals[n], host: () => null, bootId: 'parity' });

// ── the shipped Wireway Fill form ───────────────────────────────────────────────────────────────────────────────────────
const WW_IDS = ['wwWidth', 'wwHeight', 'wwWireSize', 'wwWireType', 'wwNumWires'];
const WW_LABELS = ['Status', 'Fill Used', 'Max 20% Fill', 'Used Area', 'Wireway Area', 'Max Conductors'];
const RESET = { wwWidth: '4', wwHeight: '4', wwWireSize: '12', wwWireType: 'thhn', wwNumWires: '6' };   // what the page's own wwReset() selects
const AT_LIMIT = { wwWidth: '2', wwHeight: '2', wwWireSize: '6', wwWireType: 'thhn', wwNumWires: '15' };   // 15 x 0.0507 = 0.7605 of 0.8 in² allowed
function wirewayPage(html, opts) {
  const o = opts || {}; const EC = engineOf(html); const hand = handOf(html);
  assert.ok(EC && EC.conduitFill && typeof EC.conduitFill.calculateWirewayFill === 'function', 'the bundled engine of this page has no calculateWirewayFill');
  const template = hand.slice(hand.indexOf("FILL_CONTENT['wireway'] = (function() {"), hand.indexOf('function wwRenderTable('));
  const els = controlsOf(template);
  for (const id of WW_IDS) assert.ok(els[id] && els[id].options, 'control in the shipped Wireway template: ' + id);
  for (const id of ['wwResultGrid', 'wwResultBox', 'wwRefTableBody', 'mode-conduit']) els[id] = node();
  els['panel-conduit'] = node(); els['panel-conduit'].classList.add('active'); els['mode-wireway'] = node(); els['mode-wireway'].classList.add('active');
  for (const id of o.without || []) delete els[id];
  const doc = makeDoc(els); const calls = []; const state = { poison: null };
  const real = EC.conduitFill.calculateWirewayFill;
  const seen = Object.assign({}, EC, { conduitFill: Object.assign({}, EC.conduitFill, { calculateWirewayFill: (input) => { const out = state.poison ? state.poison(input) : real(input); calls.push({ input, out }); return out; } }) });
  const start = hand.indexOf('var WW_AREAS = {'); assert.ok(start >= 0, 'display table of the reference grid');
  const source = hand.slice(start, hand.indexOf('};', start) + 2) + '\n' + ['wwRenderTable', 'wwCalc', 'wwReset'].map((n) => fnBody(hand, n)).join('\n')
    + '\nreturn { wwRenderTable: wwRenderTable, wwCalc: wwCalc, wwReset: wwReset, WW_AREAS: WW_AREAS };';
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'EC', source)(doc, 'ec' in o ? o.ec : seen);
  const p = { EC, els, doc, calls, api, template, state, bridge: build(doc, { wwCalc: api.wwCalc }, EC) };
  p.set = (values) => { for (const id of Object.keys(values)) els[id].value = values[id]; api.wwCalc(); return p; };
  p.user = (id, value) => { els[id].value = value; api.wwCalc(); doc.fire('change'); return p; };   // what onchange="wwCalc()" + a real event do
  p.force = (id, value) => { if (value !== '') els[id].addOption(value); els[id].value = value; api.wwCalc(); doc.fire('change'); return p; };
  p.values = () => WW_IDS.map((id) => (els[id] ? els[id].value : '(absent)')).join('|');
  p.grid = () => els.wwResultGrid.innerHTML;
  p.shown = () => { const out = {}; for (const m of p.grid().matchAll(/<div class="result-item-label">([^<]*)<\/div><div class="result-item-value[^"]*"[^>]*>([^<]*)<\/div>/g)) out[m[1]] = m[2]; return out; };
  p.last = () => calls[calls.length - 1];
  return p;
}
const requestOf = (v) => ({ width: Number(v.wwWidth), height: Number(v.wwHeight), wireType: v.wwWireType, wireSize: v.wwWireSize, numConductors: Number(v.wwNumWires) });
/** The grid shows exactly the engine answer `out` for `input`: every figure is an engine member at display precision, the verdict is out.fits. */
function assertRendered(p, out, input, what) {
  const s = p.shown();
  assert.deepEqual(Object.keys(s), WW_LABELS, what + ': result rows');
  assert.equal(s.Status, out.fits ? '✓ PASS' : '✗ OVER FILL', what + ': verdict');
  assert.equal(s['Fill Used'], out.fillPercentUsed.toFixed(1) + '%', what + ': fill percent');
  assert.equal(s['Max 20% Fill'], out.allowedArea.toFixed(3) + ' in²', what + ': allowed area');
  assert.equal(s['Used Area'], out.usedArea.toFixed(3) + ' in²', what + ': used area');
  assert.equal(s['Wireway Area'], out.interiorArea.toFixed(2) + ' in² (' + input.width + '"×' + input.height + '")', what + ': interior area');
  assert.equal(s['Max Conductors'], out.maxConductors + ' max @ 20%', what + ': max conductors');
  assert.equal(p.els.wwResultBox.classList.contains('ready'), out.fits === true, what + ': pass styling');
  assert.equal(p.els.wwResultBox.classList.contains('fail'), out.fits === false, what + ': over-fill styling');
  assert.ok(!p.grid().includes('wwError'), what + ': no refusal next to a result');
}
/** Nothing of an earlier result is left: no figure, no verdict, no pass / fail styling — only an explanation, tied to the named controls. */
function assertRefused(p, what, badIds) {
  const g = p.grid(); const s = p.shown();
  assert.ok(g.includes('id="wwError"') && g.includes('role="alert"'), what + ': no explanation shown: ' + g);
  assert.ok(!/PASS|OVER FILL|max @ 20%|in²|\d%/.test(g), what + ': an earlier result survived: ' + g);
  assert.deepEqual(Object.keys(s), ['Cannot calculate'], what + ': only the refusal is shown');
  assert.ok(s['Cannot calculate'].length > 15, what + ': the message says what to correct');
  assert.ok(!/NaN|Infinity|undefined|null/.test(s['Cannot calculate']), what + ': a raw value leaked into the message');
  assert.ok(!p.els.wwResultBox.classList.contains('ready') && !p.els.wwResultBox.classList.contains('fail'), what + ': pass / fail styling survived');
  if (badIds) for (const id of WW_IDS) if (p.els[id]) assert.deepEqual(p.els[id].attrs, badIds.includes(id) ? { 'aria-invalid': 'true', 'aria-errormessage': 'wwError' } : {}, what + ': marking of ' + id);
}

// ── the shipped Wire Sizer form ─────────────────────────────────────────────────────────────────────────────────────────
function wirePage(html) {
  const EC = engineOf(html); const hand = handOf(html);
  const els = controlsOf(html.slice(html.indexOf('<div class="panel" id="panel-wiresizer">'), html.indexOf('<!-- ══ MORE PANEL ══ -->')));
  for (const id of ['wsLoad', 'wsContinuous', 'wsCircuitType', 'wsDwelling', 'wsFeet', 'wsVoltage']) assert.ok(els[id], 'control in the shipped Wire Sizer: ' + id);
  for (const id of ['wsDwellingWrap', 'wsMaxVDNote', 'wsResult']) els[id] = node();
  els.wsDwellingWrap.style.display = 'none';   // as in the static markup
  els['panel-wiresizer'] = node(); els['panel-wiresizer'].classList.add('active');
  const doc = makeDoc(els); const calls = [];
  const seen = Object.assign({}, EC, { wireSizing: Object.assign({}, EC.wireSizing, { selectConductor: (input) => { const out = EC.wireSizing.selectConductor(input); calls.push({ input, out }); return out; } }) });
  // eslint-disable-next-line no-new-func
  const wsCalc = new Function('document', 'EC', 'window', 'AMP_TYPICAL_CU', 'AMP_TYPICAL_AL', fnBody(hand, 'wsCalc') + '\nreturn wsCalc;')(doc, seen, {}, {}, {});
  const p = { EC, els, doc, calls, bridge: build(doc, { wsCalc }, EC) };
  p.user = (id, value) => { els[id].value = value; wsCalc(); doc.fire(els[id].options ? 'change' : 'input'); return p; };
  p.fill = () => { p.user('wsLoad', '20'); p.user('wsContinuous', '16'); p.user('wsFeet', '100'); p.user('wsVoltage', '120'); return p; };
  p.last = () => calls[calls.length - 1];
  p.shown = () => els.wsResult.innerHTML;
  return p;
}
const WS_COMMON = { load: 20, continuousLoad: 16, feet: 100, voltage: 120, phase: 1, material: 'cu', insulation: 'thhn', ambientF: 86, adjustmentFactor: 1, maxVoltDropPercent: 5,
  terminalRatingC: 75, assemblyRatedFor100PercentContinuousOperation: false, jurisdiction: 'NYC' };
const wsRequest = (circuitType, feedsDwellingUnit) => Object.assign({}, WS_COMMON, { circuitType, feedsDwellingUnit });

// ── PAGE: one document, two hosts ───────────────────────────────────────────────────────────────────────────────────────
const FONT_LINKS = ['<link rel="preconnect" href="https://fonts.googleapis.com">', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@400;600&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">'];
const HOST_STYLESHEET = '<link rel="stylesheet" href="/workspace/host-core.css"></head>';
const HOST_TAIL = ['</html>', '', '<script src="/workspace/handoff.js"></script>', '<script src="/workspace/material-edit.js"></script>', '<script src="/workspace/host-core.js"></script>', '<script src="/workspace/assistant-bridge.js"></script>'];
const withoutEngine = (html) => { const s = html.indexOf(DOM.START), e = html.indexOf(DOM.END); assert.ok(s >= 0 && e > s, 'engine markers'); return html.slice(0, s) + '[EC-CALC generated block]' + html.slice(e + DOM.END.length); };

test('PAGE: outside the generated block the hosted page is core/mobile.html plus exactly the known host wiring; the bridge is the fourth and last host script and only there', () => {
  const lines = withoutEngine(CORE).trimEnd().split('\n');
  for (const link of FONT_LINKS) { const i = lines.indexOf(link); assert.ok(i >= 0, 'core font link: ' + link); lines[i] = ''; }
  const head = lines.indexOf('</head>'); assert.ok(head >= 0); lines[head] = HOST_STYLESHEET;
  const sw = lines.findIndex((l) => l.includes("navigator.serviceWorker.register('sw.js')")); assert.ok(sw >= 0); lines[sw] = lines[sw].replace("register('sw.js')", "register('/sw.js')");
  assert.equal(lines[lines.length - 1], '</html>'); lines.splice(lines.length - 1, 1, ...HOST_TAIL);
  const hosted = withoutEngine(HOSTED).trimEnd().split('\n'); let i = 0;
  while (i < lines.length && i < hosted.length && lines[i] === hosted[i]) i++;
  assert.ok(i === lines.length && i === hosted.length, 'first difference at line ' + (i + 1) + ' (generated block counted as one line):\n expected ' + JSON.stringify((lines[i] || '').slice(0, 160)) + '\n hosted   ' + JSON.stringify((hosted[i] || '').slice(0, 160)));
  assert.deepEqual(HOSTED.trimEnd().split('\n').slice(-HOST_TAIL.length), HOST_TAIL, 'handoff, material-edit, host-core keep their order; the bridge follows host-core');
  for (const tag of HOST_TAIL.slice(2)) { assert.equal(HOSTED.split(tag).length - 1, 1, 'hosted, exactly once: ' + tag); assert.ok(!CORE.includes(tag), 'never in the standalone core page: ' + tag); }
  assert.ok(!CORE.includes('assistant-bridge'), 'the standalone core page has no bridge script');
});

test('PAGE: the calculator functions this stage touched are byte-identical in both pages', () => {
  const core = handOf(CORE), hosted = handOf(HOSTED);
  for (const name of ['wwCalc', 'wwReset', 'wwRenderTable', 'fillCalcMode', 'favGetValues', 'favSetValues', 'wsCalc', 'wsReset']) assert.ok(fnBody(hosted, name) === fnBody(core, name), 'the two pages differ in ' + name);
  const template = (hand) => hand.slice(hand.indexOf("FILL_CONTENT['wireway'] = (function() {"), hand.indexOf('function wwRenderTable('));
  assert.ok(template(core).length > 1000 && template(hosted) === template(core), 'the Wireway template differs');
});

for (const [label, html] of PAGES) {
  const hand = handOf(html);

  // ── G-01 source shape ─────────────────────────────────────────────────────────────────────────────────────────────────
  test(label + ' — G-01 source: wwCalc holds one engine call and no formula, table, parser fallback or default; the display table has one reader', () => {
    const body = fnBody(hand, 'wwCalc');
    assert.equal(body.split('EC.conduitFill.calculateWirewayFill(').length - 1, 1, 'exactly one engine call');
    for (const [re, what] of [[/WW_AREAS/, 'the page-local area table'], [/0\.0133/, 'the #12 fallback area'], [/parseInt|parseFloat/, 'a lenient parser'], [/Math\.(floor|ceil|round)/, 'local rounding of a quantity'],
      [/\b0\.2\d*\b/, 'a local 20% factor'], [/\|\|\s*[\d.]/, 'a numeric fallback'], [/usedArea\s*<=|<=\s*\w*(allowed|maxFill)/i, 'a local pass / fail comparison']]) assert.ok(!re.test(body), 'wwCalc still contains ' + what);
    for (const member of ['r.interiorArea', 'r.allowedArea', 'r.usedArea', 'r.fillPercentUsed', 'r.maxConductors', 'r.fits']) assert.ok(body.includes(member), 'rendered from the engine member ' + member);
    const grid = fnBody(hand, 'wwRenderTable');
    assert.ok(grid.includes('EC.conduitFill.calculateWirewayFill(') && !/Math\.floor|\b0\.2\d*\b/.test(grid), 'the reference grid takes its max-conductor cells from the engine');
    // The display copy stays (core/test/shippedApp.test.js pins it to the engine table); its only reader is the grid's Area column.
    assert.equal(hand.split('WW_AREAS[').length - 1, 0); assert.equal(hand.split('WW_AREAS.').length - 1, 1); assert.ok(grid.includes('var areas = WW_AREAS.thhn;'));
  });

  // ── G-01 behaviour ────────────────────────────────────────────────────────────────────────────────────────────────────
  test(label + ' — Wireway ordinary case: one engine call with the exact form values; the grid, the source module and the registry tool all show that one answer', () => {
    const p = wirewayPage(html);
    assert.deepEqual(WW_IDS.map((id) => p.els[id].optionValues().length), [7, 7, 17, 3, 16], 'the option lists of the shipped template');
    assert.equal(p.calls.length, 0);
    p.set(RESET);
    assert.equal(p.calls.length, 1, 'exactly one engine call per calculation');
    const { input, out } = p.last();
    assert.deepEqual(input, { width: 4, height: 4, wireType: 'thhn', wireSize: '12', numConductors: 6 });
    assert.deepEqual(json(out), json(SRC_FILL.calculateWirewayFill(input)), 'the bundled engine answers as core/src/calc/conduitFill.js does');
    assertRendered(p, out, input, 'defaults');
    assert.deepEqual(p.shown(), { Status: '✓ PASS', 'Fill Used': '0.5%', 'Max 20% Fill': '3.200 in²', 'Used Area': '0.080 in²', 'Wireway Area': '16.00 in² (4"×4")', 'Max Conductors': '240 max @ 20%' });
    const run = registryOf(p.EC).run('wireway_fill', input, { origin: 'current_form' });
    assert.equal(run.ok, true); assert.equal(run.result.status, 'complete'); assert.equal(run.result.engine.fn, 'calculateWirewayFill'); assert.equal(run.result.engine.called, true);
    assert.deepEqual(json(run.result.engine.args), [input], 'the registry tool sends the engine the very request the form sent');
    assert.deepEqual(json(run.result.coreResult), json(out), 'the registry result is the form result, member for member');
  });

  test(label + ' — Wireway over-fill and alternate insulation: the verdict and every figure follow the engine, also where the insulation alone decides', () => {
    const p = wirewayPage(html);
    p.set({ wwWidth: '2', wwHeight: '2', wwWireSize: '500', wwWireType: 'thhn', wwNumWires: '2' });
    let c = p.last();
    assert.deepEqual(c.input, { width: 2, height: 2, wireType: 'thhn', wireSize: '500', numConductors: 2 }); assert.equal(c.out.fits, false);
    assertRendered(p, c.out, c.input, 'two 500 kcmil in 2x2');
    assert.equal(p.shown().Status, '✗ OVER FILL'); assert.equal(p.shown()['Max Conductors'], '1 max @ 20%'); assert.equal(p.shown()['Max 20% Fill'], '0.800 in²'); assert.equal(p.shown()['Used Area'], '1.415 in²');
    p.user('wwNumWires', '1'); c = p.last(); assert.equal(c.out.fits, true); assertRendered(p, c.out, c.input, 'one 500 kcmil in 2x2'); assert.equal(p.shown().Status, '✓ PASS');
    // 20 x #8 in 2x2 (0.8 in² allowed): THHN / XHHW-2 0.0366 -> 0.732 fits (max 21); THW 0.0437 -> 0.874 does not (max 18).
    const verdicts = {};
    for (const type of ['thhn', 'thw', 'xhhw']) {
      const n = p.calls.length;
      p.set({ wwWidth: '2', wwHeight: '2', wwWireSize: '8', wwWireType: type, wwNumWires: '20' }); c = p.last();
      assert.equal(p.calls.length, n + 1); assert.deepEqual(c.input, { width: 2, height: 2, wireType: type, wireSize: '8', numConductors: 20 }, 'the selected insulation is what the engine receives');
      assert.deepEqual(json(c.out), json(SRC_FILL.calculateWirewayFill(c.input))); assertRendered(p, c.out, c.input, type);
      assert.deepEqual(json(registryOf(p.EC).run('wireway_fill', c.input, { origin: 'current_form' }).result.coreResult), json(c.out), type + ': registry parity');
      verdicts[type] = p.shown().Status + ' / ' + p.shown()['Max Conductors'];
    }
    assert.deepEqual(verdicts, { thhn: '✓ PASS / 21 max @ 20%', thw: '✗ OVER FILL / 18 max @ 20%', xhhw: '✓ PASS / 21 max @ 20%' });
  });

  test(label + ' — Wireway threshold: the verdict flips exactly where the engine\'s does, and a synthetic engine answer proves the page compares nothing itself', () => {
    const p = wirewayPage(html);
    p.set(AT_LIMIT); let c = p.last();
    assert.equal(c.out.maxConductors, 15); assert.equal(c.out.fits, true); assertRendered(p, c.out, c.input, '15 of max 15'); assert.equal(p.shown().Status, '✓ PASS');
    for (const count of p.els.wwNumWires.optionValues()) {
      p.user('wwNumWires', count); c = p.last();
      assert.equal(c.input.numConductors, Number(count)); assertRendered(p, c.out, c.input, count + ' x #6 in 2x2');
      assert.equal(p.shown().Status === '✓ PASS', Number(count) <= 15, count + ' conductors against the engine maximum of 15');
    }
    // Used == allowed with fits:false, and used > allowed with fits:true: only a page that renders the engine verdict shows these.
    p.state.poison = () => ({ ok: true, interiorArea: 16, allowedArea: 3.2, usedArea: 3.2, fillPercentUsed: 20, maxConductors: 7, fits: false });
    p.set(RESET);
    assert.deepEqual(p.shown(), { Status: '✗ OVER FILL', 'Fill Used': '20.0%', 'Max 20% Fill': '3.200 in²', 'Used Area': '3.200 in²', 'Wireway Area': '16.00 in² (4"×4")', 'Max Conductors': '7 max @ 20%' });
    assert.ok(p.els.wwResultBox.classList.contains('fail') && !p.els.wwResultBox.classList.contains('ready'));
    p.state.poison = () => ({ ok: true, interiorArea: 1.25, allowedArea: 0.25, usedArea: 9.75, fillPercentUsed: 780, maxConductors: 3, fits: true });
    p.set(RESET);
    assert.deepEqual(p.shown(), { Status: '✓ PASS', 'Fill Used': '780.0%', 'Max 20% Fill': '0.250 in²', 'Used Area': '9.750 in²', 'Wireway Area': '1.25 in² (4"×4")', 'Max Conductors': '3 max @ 20%' });
    assert.ok(p.els.wwResultBox.classList.contains('ready') && !p.els.wwResultBox.classList.contains('fail'));
    p.state.poison = null; p.set(RESET); assertRendered(p, p.last().out, p.last().input, 'real engine again');
  });

  test(label + ' — Wireway: for EVERY combination the form offers, one engine call carries the exact values and the grid shows that answer', () => {
    const p = wirewayPage(html); const opt = (id) => p.els[id].optionValues(); let n = 0;
    for (const w of opt('wwWidth')) for (const h of opt('wwHeight')) for (const type of opt('wwWireType')) for (const size of opt('wwWireSize')) for (const count of opt('wwNumWires')) {
      const v = { wwWidth: w, wwHeight: h, wwWireSize: size, wwWireType: type, wwNumWires: count }; const what = w + 'x' + h + ' ' + type + ' ' + size + ' x' + count;
      p.calls.length = 0; p.set(v);
      assert.equal(p.calls.length, 1, what); const c = p.calls[0];
      assert.deepEqual(c.input, requestOf(v), what + ': request'); assert.equal(c.out.ok, true, what + ': every listed option is known to the engine');
      assert.deepEqual(c.out, SRC_FILL.calculateWirewayFill(c.input), what + ': source module');
      assertRendered(p, c.out, c.input, what); n++;
    }
    assert.equal(n, 7 * 7 * 3 * 17 * 16);
  });

  test(label + ' — Wireway: an empty, non-finite, non-positive, fractional, malformed or out-of-range value removes the earlier result, calls no engine and substitutes nothing', () => {
    const CASES = [['wwWidth', ''], ['wwHeight', ''], ['wwWireSize', ''], ['wwWireType', ''], ['wwNumWires', ''],
      ['wwWidth', 'Infinity'], ['wwWidth', 'NaN'], ['wwHeight', '1e999'], ['wwHeight', '-Infinity'], ['wwNumWires', 'Infinity'], ['wwNumWires', 'NaN'],
      ['wwWidth', '0'], ['wwWidth', '-4'], ['wwHeight', '0'], ['wwHeight', '0.0'], ['wwNumWires', '0'], ['wwNumWires', '-1'],
      ['wwNumWires', '2.5'], ['wwNumWires', '6.0'], ['wwNumWires', '1e2'],
      ['wwWidth', 'abc'], ['wwWidth', '4in'], ['wwWidth', ' 4 '], ['wwHeight', '4,5'], ['wwHeight', '2.5.1'], ['wwNumWires', 'six'],
      ['wwWidth', '1001'], ['wwHeight', '1000.5'], ['wwNumWires', '100001'], ['wwNumWires', '99999999999999999999999']];
    for (const [id, value] of CASES) {
      const what = id + '=' + JSON.stringify(value); const p = wirewayPage(html).set(AT_LIMIT);
      assert.equal(p.shown().Status, '✓ PASS', 'precondition: a visible valid result');
      const n = p.calls.length; const others = WW_IDS.filter((x) => x !== id).map((x) => p.els[x].value).join('|');
      p.force(id, value);
      assert.equal(p.calls.length, n, what + ': refused before any engine call (no value was substituted to make one)');
      assertRefused(p, what, [id]);
      assert.equal(p.els[id].value, value, what + ': the control is not rewritten'); assert.equal(WW_IDS.filter((x) => x !== id).map((x) => p.els[x].value).join('|'), others, what + ': other controls untouched');
      if (/[a-z]{3}/i.test(value)) assert.ok(!p.grid().includes(value), what + ': the raw value is not written into the page');
      p.user(id, AT_LIMIT[id]);
      assert.equal(p.calls.length, n + 1, what + ': calculates again once corrected'); assertRendered(p, p.last().out, p.last().input, what + ' corrected'); assert.equal(p.shown().Status, '✓ PASS');
      for (const x of WW_IDS) assert.deepEqual(p.els[x].attrs, {}, what + ': marking cleared on ' + x);
    }
  });

  test(label + ' — Wireway: an unknown wire type or size reaches the engine as it is, is refused there, and nothing is shown in place of a result', () => {
    for (const [id, value] of [['wwWireType', 'tw'], ['wwWireType', 'bogus'], ['wwWireSize', '600'], ['wwWireSize', '16'], ['wwWireSize', 'unknownsize']]) {
      const what = id + '=' + value; const p = wirewayPage(html).set(AT_LIMIT); const n = p.calls.length;
      p.force(id, value);
      assert.equal(p.calls.length, n + 1, what + ': decided by the engine table, not by a page table'); const c = p.last();
      assert.deepEqual(c.input, requestOf(Object.assign({}, AT_LIMIT, { [id]: value })), what + ': the unknown value is sent unchanged — no THHN or #12 stand-in');
      assert.equal(c.out.ok, false); assert.equal(c.out.reason, 'WIRE_NOT_IN_TABLE'); assert.deepEqual(json(c.out), json(SRC_FILL.calculateWirewayFill(c.input)));
      assertRefused(p, what, ['wwWireType', 'wwWireSize']);
      assert.match(p.shown()['Cannot calculate'], /not in the wireway conductor table/); assert.ok(value.length < 5 || !p.grid().includes(value), what + ': the raw value is not written into the page');
      const field = id === 'wwWireType' ? 'wireType' : 'wireSize';
      assert.equal(registryOf(p.EC).validatePatch('wireway_fill', { set: { [field]: value } }, { origin: 'current_form' }).ok, false, what + ': the registry refuses the same value');
      p.user(id, AT_LIMIT[id]); assertRendered(p, p.last().out, p.last().input, what + ' corrected');
    }
  });

  test(label + ' — Wireway: the form accepts a number exactly where the registry field does (same bounds, no second rule)', () => {
    for (const [id, field, values] of [['wwWidth', 'width', ['0.5', '1000', '1000.5', '1001', '0']], ['wwHeight', 'height', ['0.25', '1000', '1001', '0']], ['wwNumWires', 'numConductors', ['1', '7', '100000', '100001', '0']]]) {
      for (const v of values) {
        const p = wirewayPage(html).set(AT_LIMIT); const n = p.calls.length; p.force(id, v);
        const accepted = p.calls.length === n + 1 && !p.grid().includes('wwError');
        assert.equal(accepted, registryOf(p.EC).validatePatch('wireway_fill', { set: { [field]: Number(v) } }, { origin: 'current_form' }).ok, id + '=' + v);
        if (accepted) assertRendered(p, p.last().out, p.last().input, id + '=' + v); else assertRefused(p, id + '=' + v, [id]);
      }
    }
  });

  test(label + ' — Wireway: a missing control, a missing or failing engine and an incomplete engine answer are explained, never rendered as a result and never thrown', () => {
    for (const id of WW_IDS) {
      const p = wirewayPage(html, { without: [id] }); p.els.wwResultGrid.innerHTML = '<div class="result-item-value">✓ PASS 12.3%</div>';
      p.api.wwCalc(); assert.equal(p.calls.length, 0, id + ' absent: no engine call'); assertRefused(p, id + ' absent', []);
    }
    const noGrid = wirewayPage(html, { without: ['wwResultGrid'] }); assert.doesNotThrow(() => noGrid.api.wwCalc()); assert.equal(noGrid.calls.length, 0, 'not on screen: nothing is calculated');
    for (const ec of [undefined, null, {}, { conduitFill: {} }, { conduitFill: { calculateWirewayFill: 'no' } }]) {
      const p = wirewayPage(html, { ec }); p.els.wwResultGrid.innerHTML = '<div class="result-item-value">✓ PASS 12.3%</div>';
      assert.doesNotThrow(() => p.set(RESET)); assertRefused(p, 'engine ' + JSON.stringify(ec), []);
    }
    const good = { ok: true, interiorArea: 16, allowedArea: 3.2, usedArea: 0.0798, fillPercentUsed: 0.5, maxConductors: 240, fits: true };
    const ANSWERS = [null, undefined, {}, { ok: false }, { ok: 'true' }, Object.assign({}, good, { usedArea: NaN }), Object.assign({}, good, { fillPercentUsed: Infinity }), Object.assign({}, good, { maxConductors: '240' }),
      Object.assign({}, good, { interiorArea: undefined }), Object.assign({}, good, { allowedArea: null }), Object.assign({}, good, { fits: 'yes' }), Object.assign({}, good, { fits: undefined }), { ok: false, reason: 'INVALID_DIMENSIONS' }];
    for (const answer of ANSWERS) {
      const p = wirewayPage(html).set(AT_LIMIT); assert.equal(p.shown().Status, '✓ PASS');
      p.state.poison = () => answer; p.set(RESET);
      assertRefused(p, 'engine answer ' + JSON.stringify(answer), answer && answer.reason === 'INVALID_DIMENSIONS' ? ['wwWidth', 'wwHeight'] : []);
    }
    const p = wirewayPage(html).set(AT_LIMIT); p.state.poison = () => ({ ok: false, reason: 'SYNTH_<b onclick=x>REASON</b>' }); p.set(RESET);
    assertRefused(p, 'unlisted engine reason', []); assert.ok(p.grid().includes('(SYNTH_REASON)') && !p.grid().includes('<b') && !p.grid().includes('onclick'), 'an engine reason is shown as a bare code, never as markup');
  });

  test(label + ' — Wireway Reset and the reference grid: Reset restores the five defaults and their engine result; every max-conductor cell is the engine\'s', () => {
    const p = wirewayPage(html).set(AT_LIMIT); p.force('wwNumWires', '2.5'); assertRefused(p, 'before Reset', ['wwNumWires']);
    p.api.wwReset();
    assert.equal(p.values(), '4|4|12|thhn|6'); assertRendered(p, p.last().out, p.last().input, 'after Reset'); assert.equal(p.shown()['Max Conductors'], '240 max @ 20%');
    for (const id of WW_IDS) assert.deepEqual(p.els[id].attrs, {}, 'Reset clears the marking of ' + id);
    assert.deepEqual(p.api.WW_AREAS, SRC_TABLES.WW_AREAS, 'the display copy equals the engine table');
    for (const head of ['2\\"×2\\"', '4\\"×4\\"', '6\\"×6\\"', '8\\"×8\\"', '12\\"×12\\"']) assert.ok(p.template.includes('<th>' + head + '</th>'), 'grid column ' + head);
    p.calls.length = 0; p.api.wwRenderTable();
    const rows = [...p.els.wwRefTableBody.innerHTML.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((cell) => cell[1]));
    assert.equal(rows.length, 16); assert.equal(p.calls.length, 16 * 5, 'one engine call per max-conductor cell'); assert.ok(p.calls.every((c) => c.input.wireType === 'thhn' && c.out.ok === true));
    for (const row of rows) {
      assert.equal(row.length, 7); const size = row[0].replace(/ (AWG|kcmil)$/, '');
      assert.equal(row[1], SRC_TABLES.WW_AREAS.thhn[size].toFixed(4), size + ': area column');
      [2, 4, 6, 8, 12].forEach((side, k) => { const max = SRC_FILL.calculateWirewayFill({ width: side, height: side, wireType: 'thhn', wireSize: size, numConductors: 1 }).maxConductors; assert.equal(row[2 + k], String(max || '—'), size + ' in ' + side + 'x' + side); });
    }
    assert.equal(rows.find((r) => r[0] === '12 AWG')[3], '240'); assert.equal(rows.find((r) => r[0] === '500 kcmil')[2], '1');
  });

  test(label + ' — Wireway through the form bridge: a refused correction leaves the form and its result alone; an accepted one changes one control and the form result equals the registry result', () => {
    const START = { wwWidth: '2', wwHeight: '2', wwWireSize: '8', wwWireType: 'thhn', wwNumWires: '20' };
    const p = wirewayPage(html).set(START); const reg = registryOf(p.EC);
    const cap = p.bridge.capture('wireway_fill');
    assert.equal(cap.status, 'captured', JSON.stringify(cap.reason || cap.reasons || null)); assert.deepEqual(json(cap.formInput), requestOf(START));
    assert.deepEqual(json(reg.run('wireway_fill', cap.formInput, { origin: 'current_form' }).result.coreResult), json(p.last().out), 'captured form input -> registry result == the result the form shows');
    const n = p.calls.length; const before = p.grid();
    for (const [patch, status] of [[{ set: { numConductors: 2.5 } }, 'invalid_patch'], [{ set: { numConductors: 0 } }, 'invalid_patch'], [{ set: { wireType: 'tw' } }, 'invalid_patch'], [{ set: { width: 0 } }, 'invalid_patch'],
      [{ set: { wireSize: '600' } }, 'invalid_patch'], [{ set: { numConductors: 11 } }, 'unrepresentable'], [{ set: { width: 5 } }, 'unrepresentable']]) {
      const res = p.bridge.apply({ toolId: 'wireway_fill', expectedGeneration: cap.generation, patch });
      assert.equal(res.ok, false, JSON.stringify(patch)); assert.equal(res.status, status, JSON.stringify(patch)); assert.equal(res.applied, false);
      assert.equal(p.values(), '2|2|8|thhn|20', 'form untouched: ' + JSON.stringify(patch)); assert.equal(p.calls.length, n, 'no calculation: ' + JSON.stringify(patch)); assert.equal(p.grid(), before);
    }
    const res = p.bridge.apply({ toolId: 'wireway_fill', expectedGeneration: cap.generation, patch: { set: { wireType: 'thw' }, clear: [] } });
    assert.equal(res.status, 'applied', JSON.stringify(res.reason || res.fields || null)); assert.deepEqual(res.changedFields, ['wireType']);
    assert.deepEqual(res.written, [{ controlId: 'wwWireType', field: 'wireType', from: 'thhn', to: 'thw' }]); assert.deepEqual(res.rendered, ['wwCalc']);
    assert.equal(p.values(), '2|2|8|thw|20', 'every other control is untouched'); assert.equal(p.calls.length, n + 1, 'the form\'s own calculator ran once');
    const c = p.last(); assert.deepEqual(c.input, { width: 2, height: 2, wireType: 'thw', wireSize: '8', numConductors: 20 }); assertRendered(p, c.out, c.input, 'after the correction'); assert.equal(p.shown().Status, '✗ OVER FILL');
    assert.deepEqual(json(res.formInput), c.input);
    assert.deepEqual(json(reg.run('wireway_fill', res.formInput, { origin: 'current_form' }).result.coreResult), json(c.out), 'registry and form agree after the correction');
  });

  // ── WS: stale hidden dwelling answer ──────────────────────────────────────────────────────────────────────────────────
  test(label + ' — Wire Sizer: a dwelling answer given for a feeder does not reach a later branch-circuit request, result or registry warnings, and comes back unchanged with the feeder', () => {
    const never = wirePage(html).fill(); const reg = registryOf(never.EC);   // a branch circuit whose dwelling question was never touched
    const base = never.last();
    assert.deepEqual(base.input, wsRequest('BRANCH_CIRCUIT', null)); assert.equal(base.out.ok, true);
    const baseCap = never.bridge.capture('wire_sizing'); assert.equal(baseCap.status, 'captured'); const baseRun = reg.run('wire_sizing', baseCap.formInput, { origin: 'current_form' });

    const p = wirePage(html).fill();
    p.user('wsCircuitType', 'FEEDER');
    assert.equal(p.els.wsDwellingWrap.style.display, '', 'the question is shown for a feeder');
    assert.deepEqual(p.last().input, wsRequest('FEEDER', null), 'an unanswered feeder question stays the explicit "not stated"');
    assert.equal(p.last().out.feedsDwellingUnitStated, false); assert.equal(p.last().out.nycDwellingFeederMinimumApplies, false); assert.match(p.last().out.note, /was NOT applied/, 'the existing feeder qualification note is kept');
    assert.equal(p.bridge.capture('wire_sizing').status, 'needs_input', 'the registry still asks the feeder question');
    p.user('wsDwelling', 'yes');
    const feeder = p.last(); const feederShown = p.shown();
    assert.deepEqual(feeder.input, wsRequest('FEEDER', true)); assert.equal(feeder.out.ok, true); assert.equal(feeder.out.feedsDwellingUnitStated, true); assert.equal(feeder.out.nycDwellingFeederMinimumApplies, true);

    p.user('wsCircuitType', 'BRANCH_CIRCUIT');
    assert.equal(p.els.wsDwelling.value, 'yes', 'the stored answer is not erased'); assert.equal(p.els.wsDwellingWrap.style.display, 'none', 'the question is hidden again');
    const branch = p.last();
    assert.deepEqual(branch.input, base.input, 'the branch request is the one of a form whose dwelling question was never touched');
    assert.equal(branch.input.feedsDwellingUnit, null); assert.deepEqual(json(branch.out), json(base.out), 'same engine result, member for member'); assert.equal(p.shown(), never.shown(), 'same rendered result');
    const cap = p.bridge.capture('wire_sizing');
    assert.equal(cap.status, 'captured'); assert.ok(!('feedsDwellingUnit' in cap.formInput), 'the registry input omits the inapplicable field'); assert.deepEqual(json(cap.formInput), json(baseCap.formInput));
    const run = reg.run('wire_sizing', cap.formInput, { origin: 'current_form' });
    assert.equal(run.result.engine.args[0].feedsDwellingUnit, null, 'registry and form send the engine the same "not stated"');
    assert.deepEqual(json(run.result.coreResult), json(branch.out), 'registry result == form result'); assert.deepEqual(json(run.result.warnings), json(baseRun.result.warnings), 'same warnings'); assert.equal(run.draft.fingerprint, baseRun.draft.fingerprint);

    p.user('wsCircuitType', 'FEEDER');
    assert.equal(p.els.wsDwelling.value, 'yes', 'the chosen answer is retained'); assert.equal(p.els.wsDwellingWrap.style.display, '');
    assert.deepEqual(p.last().input, wsRequest('FEEDER', true)); assert.deepEqual(json(p.last().out), json(feeder.out)); assert.equal(p.shown(), feederShown);
    const feederCap = p.bridge.capture('wire_sizing'); assert.equal(feederCap.status, 'captured'); assert.equal(feederCap.formInput.feedsDwellingUnit, true);
    assert.deepEqual(json(reg.run('wire_sizing', feederCap.formInput, { origin: 'current_form' }).result.coreResult), json(p.last().out), 'feeder: registry result == form result');

    p.user('wsDwelling', 'no');
    assert.deepEqual(p.last().input, wsRequest('FEEDER', false)); assert.equal(p.last().out.feedsDwellingUnitStated, true); assert.equal(p.last().out.nycDwellingFeederMinimumApplies, false);
    p.user('wsCircuitType', 'BRANCH_CIRCUIT');
    assert.equal(p.els.wsDwelling.value, 'no'); assert.deepEqual(p.last().input, base.input); assert.deepEqual(json(p.last().out), json(base.out)); assert.equal(p.shown(), never.shown());
    p.user('wsCircuitType', 'FEEDER');
    assert.equal(p.els.wsDwelling.value, 'no'); assert.deepEqual(p.last().input, wsRequest('FEEDER', false));
  });
}
