'use strict';
// STAGE5 form bridge — candidate/browser/workspace/assistant-bridge.js (docs/conversation-form-bridge.md).
// Local files only. Every test builds the bridge through its exported factory (no browser, no network).
// Where feasible the form side is the SHIPPED page: control markup, wsCalc, the Wh / Runtime adapter, the Pull Box request
// builder and the whole Load Calc script block are taken verbatim from candidate/browser/workspace/mobile.html.
//   - Wire Sizer / Wh Runtime / Pull Box run on the engine bundled in that same file (as before).
//   - Load Calc / Service Sizing / Wireway run on the calculator SOURCE modules under the ids core/tools/build-calc.js gives
//     them, so a stale generated bundle can neither hide nor fake anything there. The test "shipped bundle" says when the
//     page has to be rebuilt; the test "prerequisite: … wwCalc" says when the page still holds the old wireway formula.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const BRIDGE_FILE = path.join(ROOT, 'candidate/browser/workspace/assistant-bridge.js');
const REG_FILE = path.join(ROOT, 'core/src/calc/conversationTools.js');
const B = require(BRIDGE_FILE);
const REG = require('../core/src/calc/conversationTools.js');
const DOM = require('../core/test/helpers/batteryRuntimeDom.js');
const LCDOM = require('../core/test/helpers/loadCalcDom.js');   // only its stub DOM / storage (makeDocument, makeStorage)
const BUILD = require('../core/tools/build-calc.js');           // only its MODULES list and pure buildBlock(); nothing is written
const SV = require('../core/src/calc/loadCalcStateV2.js');
const SIZING = require('../core/src/calc/loadCalcServiceSizing.js');
const FACADE = require('../core/src/calc/loadCalcFacade.js');
const CF = require('../core/src/calc/conduitFill.js');
const Job = require('../core/src/jobs/jobCard.js');
const HTML = fs.readFileSync(path.join(ROOT, 'candidate/browser/workspace/mobile.html'), 'utf8');
const HAND = HTML.slice(HTML.indexOf(DOM.END));
const json = (x) => JSON.parse(JSON.stringify(x));
const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };

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
// Like a real <select>: a value that is not one of its options does not stick.
function select(values, selected) {
  const n = node({ options: values.map((v) => ({ value: v })) }); let cur = selected;
  Object.defineProperty(n, 'value', { enumerable: true, configurable: true, get: () => cur, set: (v) => { cur = values.includes(String(v)) ? String(v) : ''; } });
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
function makeDoc(els, tabs) {
  const listeners = {};
  return { readyState: 'complete', getElementById: (id) => (Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null),
    querySelectorAll: (sel) => (sel === '#cvToolTabs .conduit-tab' ? (tabs || []) : []),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    fire: (type) => (listeners[type] || []).forEach((fn) => fn({ type })) };
}
const active = (els, id, cls) => { els[id] = els[id] || node(); els[id].classList.add(cls || 'active'); return els[id]; };
// mod: another evaluation of the bridge file (the cross-realm test evaluates it inside a second realm).
const build = (doc, globals, EC, extra, mod) => (mod || B).createBridge(Object.assign({ document: doc, registry: () => (EC && EC.conversationTools) || REG, ec: () => EC, page: (n) => globals[n], host: () => null, bootId: 'test' }, extra || {}));

// ── the shipped Wire Sizer: real markup, real wsCalc, real bundled engine (observed, not replaced) ──────────────────────
const WS_PANEL = HTML.slice(HTML.indexOf('<div class="panel" id="panel-wiresizer">'), HTML.indexOf('<!-- ══ MORE PANEL ══ -->'));
function wirePage(extra, mod) {
  const EC = DOM.bootEngine(HTML); const els = controlsOf(WS_PANEL); const calls = [];
  for (const id of ['wsDwellingWrap', 'wsMaxVDNote', 'wsResult', 'panel-home']) els[id] = node();
  active(els, 'panel-wiresizer');
  const doc = makeDoc(els);
  const seen = Object.assign({}, EC, { wireSizing: Object.assign({}, EC.wireSizing, { selectConductor: (input) => { const out = EC.wireSizing.selectConductor(input); calls.push({ input, out }); return out; } }) });
  // eslint-disable-next-line no-new-func
  const wsCalc = new Function('document', 'EC', 'window', 'AMP_TYPICAL_CU', 'AMP_TYPICAL_AL', fnBody(HAND, 'wsCalc') + '\nreturn wsCalc;')(doc, seen, {}, {}, {});
  const globals = { wsCalc };
  const p = { EC, els, doc, calls, globals, bridge: build(doc, globals, EC, extra, mod) };
  p.user = (id, value) => { els[id].value = value; wsCalc(); doc.fire(els[id].options ? 'change' : 'input'); };   // what the control's own handler + a real event do
  p.values = () => Object.keys(els).filter((id) => /^ws[A-Z]/.test(id) && !['wsResult', 'wsMaxVDNote', 'wsDwellingWrap'].includes(id)).map((id) => id + '=' + els[id].value).join('|');
  p.fill = () => { p.user('wsLoad', '20'); p.user('wsContinuous', '16'); p.user('wsFeet', '100'); p.user('wsVoltage', '120'); return p; };
  p.run = (formInput) => ((EC.conversationTools || REG).run('wire_sizing', formInput, { origin: 'current_form' }));
  return p;
}
const FILLED = { noncontinuousLoadA: 4, continuousLoadA: 16, material: 'cu', insulation: 'thhn', ambientF: 86, adjustmentFactor: 1, terminalRatingC: 75, circuitType: 'BRANCH_CIRCUIT',
  jurisdiction: 'NYC', feet: 100, voltage: 120, phase: 1, maxVoltDropPercent: 5, assemblyRatedFor100PercentContinuousOperation: false };
const field = (cap, name) => cap.fields.find((f) => f.field === name);
/** true when the value x is a leaf somewhere in v (no member name of a form object is assumed by the tests that use it) */
const hasLeaf = (v, x) => (v !== null && typeof v === 'object' ? Object.keys(v).some((k) => hasLeaf(v[k], x)) : v === x);

test('source: no dynamic code, network, storage, message channel, markup write, job write or adoption helper', () => {
  const src = fs.readFileSync(BRIDGE_FILE, 'utf8');
  assert.ok(!/\beval\s*\(|new Function|import\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|postMessage|localStorage|sessionStorage|indexedDB|innerHTML|adoptPlanned|https?:\/\//.test(src));
  assert.ok(!/\.(create|commit|commitEdit|prepare|prepareEdit|show|materials?)\s*\(/.test(src), 'only the read-only hasDraft() of the host bridge may be called');
  assert.ok(!B.PAGE_NAMES.some((n) => /adopt|save|delete|write|store|restore/i.test(n)));
  // Load Calc is read, never driven: no evaluation, analysis, preliminary run, adoption, publish or transaction entry is named.
  assert.ok(!/evaluateV2|evaluatePreliminaryV2|analyzePrototype|analyzePreliminaryPrototype|lcPreRun|lcPreAdopt|lcPreSetMode|lcUpdate|lcCalculate|lcSvcAssess|lcSvcSetDesign|lcPublish|lcTxn/.test(src));
  assert.deepEqual(B.PAGE_NAMES.filter((n) => /^lc|^LC_/.test(n)).sort(), ['LC_JOB', 'LC_PRE', 'lcCalcFresh', 'lcDraft', 'lcExportState', 'lcIs82', 'lcSvcDesignObject'], 'the Load Calc names the bridge may look up: readers and state only');
  assert.ok(!src.includes('FORM_RESULT_FROM_PAGE_LOCAL_FORMULA') && !src.includes('STAGE4_UI_API_UNAVAILABLE'), 'the two retired codes are gone from the bridge');
  const doc = fs.readFileSync(path.join(ROOT, 'docs/conversation-form-bridge.md'), 'utf8');
  assert.ok(!doc.includes('FORM_RESULT_FROM_PAGE_LOCAL_FORMULA') && !doc.includes('STAGE4_UI_API_UNAVAILABLE'), '…and from its contract');
  assert.ok(doc.includes('iframeWindow.JSON.parse(JSON.stringify({ toolId:') && doc.includes('patch: args }))'), 'the documented caller clones the WHOLE apply request into the iframe realm');
});

test('mapping: all 15 registry calculators and the 3 navigation-only tools are described; ids, functions and form constants exist in the shipped page', () => {
  const d = B.describe();
  assert.deepEqual(d.tools.filter((t) => t.kind === 'calculator').map((t) => t.toolId).sort(), REG.TOOL_IDS.slice().sort());
  assert.deepEqual(d.tools.filter((t) => t.kind === 'navigation_only').map((t) => t.toolId).sort(), REG.NAVIGATION_ONLY.map((n) => n.id).sort());
  const catalogue = HAND.slice(HAND.indexOf('var TOOLS = {'), HAND.indexOf('function openTool('));
  for (const t of d.tools) if (t.appTool) assert.match(catalogue, new RegExp('\\n\\s*' + t.appTool + ':\\s*\\{'), 'app catalogue entry: ' + t.appTool);
  assert.ok(!/\n\s*vdrop:\s*\{/.test(catalogue), 'the legacy voltage-drop panel is not an app tool');
  for (const id of ['voltage_drop', 'conduit_fill_mixed']) { const t = d.tools.find((x) => x.toolId === id); assert.equal(t.appTool, null); assert.equal(t.navigable, false); assert.equal(t.apply, 'refused'); }
  for (const id of ['wsLoad', 'wsContinuous', 'wsDwelling', 'wsMaterial', 'wsInsul', 'wsTemp', 'wsBundle', 'wsCircuitType', 'wsFeet', 'wsVoltage', 'wsPhase', 'wsMaxVD', 'wsHundredPct',
    'ampWireSize', 'ampMaterial', 'ampInsul', 'ampTemp', 'ampBundle', 'ampRoof', 'ampRoofSun', 'ampRoofClearance', 'cfConduitType', 'cfConduitSize', 'cfWireType', 'cfWireSize', 'cfNumWires',
    'wwWidth', 'wwHeight', 'wwWireType', 'wwWireSize', 'wwNumWires', 'bfBoxType', 'bfAccessory', 'bfExtension', 'bfWireSize', 'bfConductors', 'bfDevices', 'bfClamps', 'bfEgcCount', 'bfEgcSize',
    'mt-phase', 'mt-volts', 'mt-hp', 'mt-type', 'mt-ocpd', 'mt-nameplate', 'mt-sf', 'gnd-ocpd', 'gnd-egc-mat', 'gnd-req', 'gnd-inst', 'gnd-svc', 'gnd-svc-mat', 'gnd-electrode', 'gnd-ring',
    'bt-capacity', 'bt-mode', 'bt-consumption', 'bt-charge', 'bt-usable', 'cvTabBattery', 'cvToolTabs', 'pbv2-3d-prototype', 'mode-conduit', 'mode-wireway']) assert.ok(HTML.includes('id="' + id + '"'), 'control id in the page: ' + id);
  for (const fn of ['openTool', 'cvTool', 'cfRenderTable', 'wsCalc', 'ampRoofChanged', 'ampUpdateCalc', 'cfUpdateCalc', 'wwCalc', 'bfUpdateCalc', 'bfReadAccessory', 'mtCalc', 'mtPhaseChanged', 'gndCalc',
    'btRead', 'btCalc', 'btSyncUnit', 'pbv23dEngineRequest', 'lcDraft', 'lcExportState', 'lcSvcDesignObject', 'lcIs82', 'lcCalcFresh']) assert.ok(HAND.includes('function ' + fn + '('), 'page function: ' + fn);
  for (const v of ['currentMoreTab', 'selectedGroundingTopic', 'currentCfConduit', 'PBV23D', 'pbv23dMode', 'pbv23dTargetMode', 'LC_PRE', 'LC_JOB']) assert.match(HAND, new RegExp('\\nvar ' + v + '\\b'), 'page variable: ' + v);
  // Every tool with a form is captured from that form; the two preliminary tools additionally name the page's workflow mode.
  for (const t of d.tools.filter((x) => x.kind === 'calculator' && x.appTool)) assert.equal(t.capture, 'form', t.toolId);
  assert.deepEqual(d.tools.filter((t) => t.workflowMode !== null).map((t) => [t.toolId, t.workflowMode]), [['load_calc_preliminary', 'new_design'], ['service_sizing_preliminary', 'new_design']]);
  assert.match(HAND, /\nvar LC_PRE = \{ mode: 'existing',/, 'the workflow mode the bridge reads: LC_PRE.mode, default existing');
  assert.ok(fnBody(HAND, 'lcPreSetMode').includes("value === 'new_design' ? 'new_design' : 'existing'"), 'the two mode values');
  // The bridge's request / design readers are the ones the form's own actions use (current draft -> canonical projection; current design object).
  for (const fn of ['lcUpdate', 'lcPreRun']) assert.ok(fnBody(HAND, fn).includes('loadCalcStateV2.toRequestV2(lcDraft())'), fn + ' projects the live draft');
  assert.ok(fnBody(HAND, 'lcPreRun').includes('lcSvcDesignObject()') && fnBody(HAND, 'lcSvcAnalyze').includes('lcSvcDesignObject()'));
  // Job head: the page keeps the store's { head, revision } pair; the head members are the job model's.
  assert.ok(HAND.includes('LC_JOB.current = result.job;') && HAND.includes('LC_JOB.current.head.jobId'));
  const model = fs.readFileSync(path.join(ROOT, 'core/src/jobs/jobCard.js'), 'utf8');
  assert.ok(model.includes("['kind', 'recordVersion', 'jobId', 'currentRevisionId', 'revisionNumber']"), 'head members in the job model');
  assert.ok(fs.readFileSync(path.join(ROOT, 'core/src/jobs/jobCardStore.js'), 'utf8').includes('currentRevisionId: revision.revisionId, revisionNumber: revision.revisionNumber'), 'the store derives the head from the saved revision');
  assert.ok(fs.readFileSync(path.join(ROOT, 'candidate/browser/workspace/host-core.js'), 'utf8').includes('const hasDraft=()=>!!(LC_JOB.editor||'), 'hasDraft() of the host bridge starts with the job-card editor');
  // Values the bridge reports as form constants / form-derived are exactly what the shipped readers send.
  const ws = fnBody(HAND, 'wsCalc'); assert.ok(ws.includes('terminalRatingC: 75') && ws.includes("jurisdiction: 'NYC'"));
  assert.ok(fnBody(HAND, 'ampUpdateCalc').includes("terminalRatingC: insulType === 'tw' ? 60 : 75"));
  const mt = fnBody(HAND, 'mtCalc'); assert.ok(!/material\s*:/.test(mt) && mt.includes('Copper at 75'));
});

test('readiness: missing registry, wrong contract revision, loading DOM, no event source or a missing page reader fail closed', () => {
  for (const [registry, reason] of [[null, 'REGISTRY_MISSING'], [Object.assign({}, REG, { CONTRACT_REVISION: 2 }), 'REGISTRY_REVISION_UNSUPPORTED'], [{ CONTRACT_REVISION: 1, TOOL_IDS: REG.TOOL_IDS }, 'REGISTRY_INCOMPLETE']]) {
    const p = wirePage({ registry: () => registry }).fill();
    const s = p.bridge.getState(); assert.equal(s.ok, false); assert.equal(s.status, 'not_ready'); assert.ok(s.reasons.includes(reason)); assert.equal(s.generation, null);
    for (const r of [p.bridge.capture('wire_sizing'), p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: 'gtest.1', patch: { set: { voltage: 240 } } }), p.bridge.navigate('wire_sizing')]) { assert.equal(r.ok, false); assert.equal(r.status, 'not_ready'); assert.equal(r.formInput, null); }
    assert.equal(p.els.wsVoltage.value, '120');
  }
  const loading = wirePage().fill(); loading.doc.readyState = 'loading';
  assert.deepEqual(loading.bridge.getState().reasons, ['DOM_NOT_READY']); assert.equal(loading.bridge.capture('wire_sizing').formInput, null);
  const deaf = build({ readyState: 'complete', getElementById: () => null }, {}, null);
  assert.ok(deaf.getState().reasons.includes('NO_EVENT_SOURCE'));
  const p = wirePage().fill(); delete p.globals.wsCalc;
  const cap = p.bridge.capture('wire_sizing');
  assert.equal(cap.status, 'not_ready'); assert.equal(cap.reason, 'PAGE_FUNCTION_MISSING'); assert.equal(cap.formInput, null);
});

test('capture reads only what the form holds: empty controls are "not stated", never the form reader\'s fallback', () => {
  const p = wirePage();
  const cap = p.bridge.capture();   // no id: the active tool
  assert.equal(cap.toolId, 'wire_sizing'); assert.equal(cap.status, 'needs_input'); assert.equal(cap.capture, 'incomplete'); assert.equal(cap.ok, true);
  for (const f of ['noncontinuousLoadA', 'continuousLoadA', 'feet']) { assert.ok(!(f in cap.formInput), f + ' must not be invented'); assert.ok(cap.needsInput.some((n) => n.field === f), f + ' is asked for'); }
  assert.equal(cap.formInput.voltage, 208, 'a visible select default is an explicit form value');
  assert.equal(field(cap, 'terminalRatingC').source, 'form_constant'); assert.equal(field(cap, 'jurisdiction').source, 'form_constant');
  assert.equal(p.calls.length, 0, 'capture never runs the calculator'); assert.equal(p.els.wsLoad.value, '');
  p.user('wsLoad', '20');   // the form itself now calculates with a continuous portion of 0 A — the bridge does not import that 0
  assert.equal(p.calls[p.calls.length - 1].input.continuousLoad, 0);
  const one = p.bridge.capture('wire_sizing');
  assert.equal(field(one, 'continuousLoadA').reason, 'EMPTY_CONTROL'); assert.equal(field(one, 'noncontinuousLoadA').reason, 'DEPENDS_ON_UNSTATED_CONTROL');
  assert.ok(!('continuousLoadA' in one.formInput) && !('noncontinuousLoadA' in one.formInput) && !('feet' in one.formInput));
  assert.equal(p.run(one.formInput).result.status, 'needs_input');
});

test('full capture equals the form\'s own engine request: the registry run and the form calculation agree exactly', () => {
  const p = wirePage().fill();
  const cap = p.bridge.capture('wire_sizing');
  assert.equal(cap.status, 'captured'); assert.equal(cap.capture, 'full'); assert.deepEqual(json(cap.formInput), FILLED); assert.deepEqual(cap.needsInput, []);
  assert.equal(field(cap, 'noncontinuousLoadA').source, 'form_derived');
  const run = p.run(cap.formInput); const shown = p.calls[p.calls.length - 1];
  assert.equal(run.ok, true); assert.equal(run.result.engine.called, true);
  assert.deepEqual(json(run.result.coreResult), json(shown.out), 'same engine answer as the one the form rendered');
  assert.equal(run.draft.fingerprint, cap.fingerprint);
});

test('apply: a valid correction changes only the requested control, runs the form\'s own calculator and advances the generation', () => {
  const p = wirePage().fill(); const cap = p.bridge.capture('wire_sizing'); const n = p.calls.length; const before = p.values();
  const res = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: cap.generation, patch: { set: { voltage: 240 }, clear: [] } });
  assert.equal(res.ok, true); assert.equal(res.status, 'applied'); assert.deepEqual(res.changedFields, ['voltage']);
  assert.deepEqual(res.written, [{ controlId: 'wsVoltage', field: 'voltage', from: '120', to: '240' }]); assert.deepEqual(res.rendered, ['wsCalc']);
  assert.equal(p.values(), before.replace('wsVoltage=120', 'wsVoltage=240'), 'every other control is untouched');
  assert.equal(p.calls.length, n + 1); assert.equal(p.calls[n].input.voltage, 240);
  assert.deepEqual(json(res.formInput), Object.assign({}, FILLED, { voltage: 240 }));
  assert.deepEqual(json(p.run(res.formInput).result.coreResult), json(p.calls[n].out), 'registry and form agree after the correction');
  assert.notEqual(res.generation, cap.generation); assert.equal(res.previousGeneration, cap.generation);
  const late = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: cap.generation, patch: { set: { voltage: 120 } } });
  assert.equal(late.status, 'stale'); assert.equal(late.reason, 'GENERATION_CHANGED'); assert.equal(p.els.wsVoltage.value, '240');
  // A number is written as the option the form already has (0.8 -> "0.80"); the load pair maps to total + continuous portion.
  const next = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: res.generation, patch: { set: { adjustmentFactor: 0.8, continuousLoadA: 10, noncontinuousLoadA: 15 } } });
  assert.equal(next.status, 'applied'); assert.equal(p.els.wsBundle.value, '0.80'); assert.equal(p.els.wsLoad.value, '25'); assert.equal(p.els.wsContinuous.value, '10');
  const same = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: next.generation, patch: { set: { voltage: 240 } } });
  assert.equal(same.status, 'no_change'); assert.equal(same.generation, next.generation);
});

test('apply: an invalid or unrepresentable patch is refused whole — no control, no render, no generation change', () => {
  const p = wirePage().fill(); const cap = p.bridge.capture('wire_sizing'); const n = p.calls.length; const before = p.values();
  const cases = [
    [{ set: { voltage: 240, material: 'gold' } }, 'invalid_patch', null], [{ set: { voltage: 240, bogus: 1 } }, 'invalid_patch', null], [{ set: { voltage: '240' } }, 'invalid_patch', null],
    [{ set: { voltage: 240 }, clear: ['voltage'] }, 'invalid_patch', null], [{ set: { material: 'al', voltage: 230 } }, 'unrepresentable', ['voltage', 'VALUE_NOT_AN_OPTION']],
    [{ set: { feet: 50, terminalRatingC: 60 } }, 'unrepresentable', ['terminalRatingC', 'FORM_FIXES_THIS_VALUE']], [{ set: { feet: 50, jurisdiction: 'NEC' } }, 'unrepresentable', ['jurisdiction', 'FORM_FIXES_THIS_VALUE']],
    [{ set: { feet: 50, proposedOcpd: 30 } }, 'unrepresentable', ['proposedOcpd', 'NO_FORM_CONTROL']], [{ set: { feedsDwellingUnit: true } }, 'unrepresentable', ['feedsDwellingUnit', 'FORM_CANNOT_HOLD_VALUE']],
    [{ set: { phase: 3 }, clear: ['maxVoltDropPercent'] }, 'unrepresentable', ['maxVoltDropPercent', 'CANNOT_CLEAR_SELECT']],
  ];
  for (const [patch, status, expected] of cases) {
    const res = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: cap.generation, patch });
    assert.equal(res.ok, false, JSON.stringify(patch)); assert.equal(res.status, status, JSON.stringify(patch)); assert.equal(res.applied, false); assert.deepEqual(res.written, []);
    if (expected) assert.ok(res.fields.some((f) => f.field === expected[0] && f.reason === expected[1]), JSON.stringify(res.fields));
    assert.equal(p.values(), before, 'form untouched: ' + JSON.stringify(patch)); assert.equal(p.calls.length, n); assert.equal(res.generation, cap.generation);
  }
  for (const bad of [null, 'x', { toolId: 'wire_sizing', expectedGeneration: cap.generation, patch: { set: { voltage: 240 } }, run: 'wsReset' }]) assert.equal(p.bridge.apply(bad).status, 'invalid_request');
  assert.equal(p.bridge.apply({ toolId: 'nope', expectedGeneration: cap.generation, patch: {} }).status, 'unknown_tool');
  assert.equal(p.values(), before);
});

test('stale responses: no generation, a foreign generation, an edit, edit-then-revert and an un-evented change are all refused before any write', () => {
  const p = wirePage().fill(); const cap = p.bridge.capture('wire_sizing'); const patch = { set: { feet: 50 } };
  for (const g of [undefined, null, '', 7, 'gtest.999']) {
    const r = p.bridge.apply(g === undefined ? { toolId: 'wire_sizing', patch } : { toolId: 'wire_sizing', expectedGeneration: g, patch });
    assert.equal(r.status, 'stale'); assert.equal(r.reason, typeof g === 'string' && g ? 'GENERATION_CHANGED' : 'GENERATION_REQUIRED'); assert.equal(p.els.wsFeet.value, '100');
  }
  p.user('wsVoltage', '240'); p.user('wsVoltage', '120');   // change, then back to the very same values
  const reverted = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: cap.generation, patch });
  assert.equal(reverted.status, 'stale'); assert.equal(reverted.reason, 'GENERATION_CHANGED'); assert.equal(p.els.wsFeet.value, '100');
  const again = p.bridge.capture('wire_sizing');
  assert.deepEqual(json(again.formInput), json(cap.formInput)); assert.equal(again.fingerprint, cap.fingerprint, 'the input fingerprint cannot tell: it is the same again');
  assert.notEqual(again.generation, cap.generation, 'the event-based generation can');
  p.els.wsVoltage.value = '240';   // a script changed the form without any event
  const silent = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: again.generation, patch });
  assert.equal(silent.status, 'stale'); assert.equal(silent.reason, 'FORM_CHANGED_SINCE_CAPTURE'); assert.equal(p.els.wsFeet.value, '100'); assert.notEqual(silent.generation, again.generation);
  const blind = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: p.bridge.invalidate('new turn').generation, patch });   // a current generation without a capture of this form
  assert.equal(blind.status, 'stale'); assert.equal(blind.reason, 'CAPTURE_REQUIRED'); assert.equal(p.els.wsFeet.value, '100');
});

test('tool switch: an answer for a form that is no longer the active one is refused, also after switching back', () => {
  const p = wirePage().fill(); const cap = p.bridge.capture('wire_sizing');
  p.els['panel-wiresizer'].classList.remove('active'); p.els['panel-home'].classList.add('active');   // navigation by any route, no event
  const away = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: cap.generation, patch: { set: { feet: 50 } } });
  assert.equal(away.status, 'stale'); assert.equal(p.els.wsFeet.value, '100');
  const hidden = p.bridge.capture('wire_sizing');
  assert.equal(hidden.status, 'needs_form'); assert.equal(hidden.reason, 'FORM_NOT_ACTIVE'); assert.equal(hidden.formInput, null);
  assert.equal(p.bridge.capture().reason, 'NO_ACTIVE_CALCULATOR');
  const current = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: p.bridge.getState().generation, patch: { set: { feet: 50 } } });
  assert.equal(current.status, 'stale'); assert.equal(current.reason, 'TOOL_NOT_ACTIVE');
  p.els['panel-home'].classList.remove('active'); p.els['panel-wiresizer'].classList.add('active');
  assert.equal(p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: cap.generation, patch: { set: { feet: 50 } } }).status, 'stale');
  assert.equal(p.els.wsFeet.value, '100');
});

// ── the shipped Wh / Runtime tab (helper harness: real markup, real adapter functions, real bundled engine) ────────────
function batteryPage() {
  const h = DOM.buildHarness(HTML); h.open('battery');
  h.els['bt-mode'].options = [...(/<select id="bt-mode"[^>]*>([\s\S]*?)<\/select>/.exec(h.panel) || ['', ''])[1].matchAll(/<option value="([^"]*)"/g)].map((m) => ({ value: m[1] }));
  active(h.els, 'panel-more'); h.els['sub-converter'] = node();
  const doc = makeDoc(h.els, h.tabs);
  const globals = { btRead: h.api.btRead, btCalc: h.api.btCalc, btSyncUnit: h.api.btSyncUnit, currentMoreTab: 'converter' };
  const type = (id, text) => { h.type(id, text); doc.fire('input'); };
  return { h, doc, type, bridge: build(doc, globals, h.EC), reg: h.EC.conversationTools || REG };
}

test('battery: explicit 100 % / 85 % in the form are ordinary stated values; the estimate opt-in is never captured and never model-settable', () => {
  const p = batteryPage();
  const blank = p.bridge.capture('battery_runtime');
  assert.equal(blank.status, 'needs_input'); assert.deepEqual(json(blank.formInput), { consumptionMode: 'w', chargePercent: 100, usablePercent: 85 });
  assert.equal(field(blank, 'capacityWh').reason, 'EMPTY_CONTROL');
  p.type('bt-capacity', '1000'); p.type('bt-consumption', '100');
  const cap = p.bridge.capture('battery_runtime');
  assert.equal(cap.status, 'captured'); assert.deepEqual(json(cap.formInput), { capacityWh: 1000, consumptionMode: 'w', consumption: 100, chargePercent: 100, usablePercent: 85 });
  const run = p.reg.run('battery_runtime', cap.formInput, { origin: 'current_form' });
  assert.equal(run.result.status, 'complete'); assert.ok(run.result.assumptions.every((a) => a.basis !== 'documented_editable_estimate'));
  assert.deepEqual(json(run.result.coreResult), json(p.h.EC.batteryRuntime.calculateBatteryRuntime(p.h.api.btRead())), 'same answer as the form\'s own engine call');
  const before = JSON.stringify(p.h.api.btRead());
  for (const patch of [{ set: { useDocumentedEstimates: true } }, { set: { chargePercent: 50, useDocumentedEstimates: true } }, { clear: ['useDocumentedEstimates'] }]) {
    const res = p.bridge.apply({ toolId: 'battery_runtime', expectedGeneration: cap.generation, patch });
    assert.equal(res.status, 'invalid_patch'); assert.ok(res.errors.some((e) => e.code === 'CONTEXT_ONLY_FIELD')); assert.equal(JSON.stringify(p.h.api.btRead()), before);
  }
  const unit = p.bridge.apply({ toolId: 'battery_runtime', expectedGeneration: cap.generation, patch: { set: { consumptionMode: 'kwh_day' } } });
  assert.equal(unit.status, 'unrepresentable'); assert.ok(unit.fields.some((f) => f.reason === 'UNIT_CHANGE_REQUIRES_CONSUMPTION')); assert.equal(JSON.stringify(p.h.api.btRead()), before, 'a number is never re-read in another unit');
  const ok = p.bridge.apply({ toolId: 'battery_runtime', expectedGeneration: cap.generation, patch: { set: { consumptionMode: 'kwh_day', consumption: 1.2 } } });
  assert.equal(ok.status, 'applied'); assert.deepEqual(p.h.api.btRead(), { capacityWh: '1000', consumptionMode: 'kwh_day', consumption: '1.2', chargePercent: '100', usablePercent: '85' });
  assert.equal(p.h.els['bt-consumption-label'].textContent, 'Consumption (kWh/day)'); assert.ok(p.h.shown().includes('About 17 h 0 min'), 'rendered by the form\'s own btCalc');
  p.type('bt-consumption', '1,5');
  assert.equal(p.bridge.capture('battery_runtime').formInput.consumption, 1.5, 'decimal comma is read by the battery module\'s own parser');
});

// ── Pull Box: the editor's own request builder, taken from the shipped page ─────────────────────────────────────────────
function pullPage(state, extra) {
  const EC = DOM.bootEngine(HTML); const els = {}; active(els, 'panel-pullbox'); active(els, 'pbv2-3d-prototype', 'show');
  // eslint-disable-next-line no-new-func
  const pbv23dEngineRequest = new Function(fnBody(HAND, 'pbv23dEngineRequest') + '\nreturn pbv23dEngineRequest;')();
  const globals = Object.assign({ PBV23D: state, pbv23dEngineRequest, pbv23dMode: 'build', pbv23dTargetMode: null }, extra || {});
  return { EC, globals, bridge: build(makeDoc(els), globals, EC), request: pbv23dEngineRequest };
}
test('pull box: only an explicit editor layout with real rows, entries and connections is a geometry; nothing is synthesized or written', () => {
  const none = pullPage(null).bridge.capture('pull_box');
  assert.equal(none.status, 'needs_form'); assert.equal(none.reason, 'NO_EDITOR_STATE'); assert.equal(none.formInput, null);
  const single = pullPage({ rows: [{ id: 'r1', wall: 'left', order: 0 }], entries: [{ id: 'e1', rowId: 'r1', size: '2' }], connections: [] }).bridge.capture('pull_box');
  assert.equal(single.status, 'needs_input'); assert.ok(!('geometry' in single.formInput), 'one conduit size is not a straight pull'); assert.equal(field(single, 'geometry').reason, 'LAYOUT_INCOMPLETE');
  assert.ok(single.needsInput.some((n) => n.field === 'geometry'));
  const state = { rows: [{ id: 'r2', wall: 'right', order: 0, ui: 1 }, { id: 'r1', wall: 'left', order: 0 }], entries: [{ id: 'e2', rowId: 'r2', size: '2', color: 'x' }, { id: 'e1', rowId: 'r1', size: '2' }], connections: [{ id: 'c1', a: 'e1', b: 'e2' }] };
  const p = pullPage(state); const frozen = JSON.stringify(state);
  const cap = p.bridge.capture('pull_box');
  assert.equal(cap.status, 'captured'); assert.deepEqual(json(cap.formInput.geometry), json(p.request(state)), 'exactly the request the editor sends to its engine');
  const run = (p.EC.conversationTools || REG).run('pull_box', cap.formInput, { origin: 'current_form' });
  assert.deepEqual(json(run.result.engine.args[0]), json(p.request(state))); assert.deepEqual(json(run.result.coreResult), json(p.EC.pullBox.calculatePullBox(p.request(state))));
  const res = p.bridge.apply({ toolId: 'pull_box', expectedGeneration: cap.generation, patch: { set: { geometry: { rows: [], entries: [], connections: [] } } } });
  assert.equal(res.status, 'unrepresentable'); assert.ok(res.fields.some((f) => f.reason === 'FORM_IS_NOT_PATCHABLE')); assert.equal(JSON.stringify(state), frozen);
  const busy = pullPage(state, { pbv23dTargetMode: { from: 'e1' } }).bridge.capture('pull_box');
  assert.equal(busy.status, 'needs_form'); assert.equal(busy.reason, 'EDIT_IN_PROGRESS'); assert.equal(busy.formInput, null);
});

// ── Load Calc / Service Sizing: the SHIPPED Load Calc script block of the workspace page, executed as shipped on the stub DOM
// of core/test/helpers/loadCalcDom.js (same extraction as core/test/stage4QualificationUi.test.js), over the calculator
// SOURCE modules. Inputs are entered through the real controls with real events; the bridge sees the page's own readers.
const SRC_DIR = path.join(ROOT, 'core/src');
const sourceEC = () => Object.fromEntries(BUILD.MODULES.map((m) => [m.id, require(path.join(SRC_DIR, m.file))]));   // the ids and files of the generated bundle
const FAV_FNS = ['favState', 'favStorage', 'favEnv', 'favRead', 'favGetAll', 'favRefresh', 'favSettle', 'favExport', 'favRetry', 'favReset', 'favStatusNode', 'favGetValues', 'favSetValues', 'favGetLabel', 'favSave', 'favLoad', 'favDelete', 'favRender'];
const LC_API = 'LC, LC_SVC, LC_CALC, LC_PRE, LC_JOB, lcInit, lcTxn, lcDraft, lcExportState, lcSvcDesignObject, lcIs82, lcCalcFresh';
function lcPage(opts) {
  const o = opts || {};
  assert.ok(/\nvar LC_PRE\b/.test(HAND) && HAND.includes('function lcPreRun('), 'STAGE4-UI MISSING: workspace/mobile.html does not carry the stage-4 Load Calc code (LC_PRE, lcPreRun) the bridge reads');
  const i = HTML.indexOf('// ── LOAD CALCULATION — EC-CALC-2 / B2 thin adapter'); const j = HTML.indexOf('// ── FAVORITES SYSTEM', i);
  assert.ok(i >= 0 && j > i, 'the Load Calc script block of the workspace page');
  const dom = LCDOM.makeDocument(); const st = LCDOM.makeStorage(); const EC = sourceEC();
  const editions = (HTML.match(/var EC_NEC_EDITION = '[^']+', EC_NYCEC_EDITION = '[^']+';/) || [''])[0];
  const refLayer = editions + '\n' + ['necRefInfo', 'necQuestion', 'refAttr', 'refSpanHtml', 'refSpanFromText', 'refSpanNode'].map((n) => fnBody(HTML, n)).join('\n') + '\n(' + fnBody(HTML, 'installRefDelegation') + ')();\n';
  const src = refLayer + HTML.slice(i, j) + "\nvar FAV_KEY = 'sparky_favorites';\n" + FAV_FNS.map((n) => fnBody(HTML, n)).join('\n') + '\nexports.api = { ' + LC_API + ' };';
  const exp = {}; const locks = { request: (name, lockOpts, cb) => { try { return Promise.resolve(cb({ name })); } catch (e) { return Promise.reject(e); } } };
  // eslint-disable-next-line no-new-func
  new Function('navigator', 'confirm', 'document', 'window', 'EC', 'necLink', 'localStorage', 'prompt', 'exports', src)({ locks }, () => true, dom.document, { crypto: require('node:crypto').webcrypto }, EC, () => {}, st.localStorage, () => 'preset', exp);
  const api = exp.api; dom.document.readyState = 'complete';
  const more = dom.mkEl('div'); more.id = 'panel-more'; more.classList.add('active'); dom.mkEl('div').id = 'sub-loadcalc';   // the page chrome that makes Load Calc the active tool
  api.lcInit();
  const globals = { currentMoreTab: 'loadcalc', lcDraft: api.lcDraft, lcExportState: api.lcExportState, lcSvcDesignObject: api.lcSvcDesignObject, lcIs82: api.lcIs82, lcCalcFresh: api.lcCalcFresh, LC_PRE: api.LC_PRE, LC_JOB: api.LC_JOB };
  const bridgeEC = o.bridgeEC ? o.bridgeEC(EC) : EC;
  const bridge = B.createBridge({ document: dom.document, registry: () => REG, ec: () => bridgeEC, page: (n) => globals[n], host: () => null, bootId: 'lc' });
  const $ = (id) => dom.byId[id];
  const set = (id, value) => { const el = $(id); assert.ok(el, 'control in the shipped form: ' + id); el.value = value; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
  return { dom, api, EC, $, set, bridge, globals, state: () => api.lcExportState(), draftText: () => JSON.stringify(api.lcDraft()), request: () => json(SV.toRequestV2(api.lcDraft()).request) };
}
/** the element with this id only if it is attached under #lcForm and not hidden (the stub keeps detached nodes in its id map) */
const live = (h, id) => { const el = h.$(id); if (!el) return null; for (let n = el; n; n = n.parent) { if (n.style && n.style.display === 'none') return null; if (n.id === 'lcForm') return el; } return null; };
const click = (el) => el.dispatch('click');
const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const ctl = (card, role) => card.querySelectorAll('input, select, button').filter((e) => e.attrs['data-role'] === role)[0];
const setIn = (el, v) => { el.value = v; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
const addLoad = (h, preset, va) => { h.$('lcPresetName').value = String(preset); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click'); };
const fill = (h, pairs) => { for (const [id, v] of pairs) h.set(id, v); };
const PLAN = [['lcSvcIntent', 'new_design_candidate'], ['lcSvcOneMainDisconnect', 'yes'], ['lcSvcNoAdditionalSources', 'yes'], ['lcSvcWholeDwelling', 'yes'], ['lcSvcSingleConductorSet', 'yes']];
const COND = (pathV, material) => [['lcSvcSizingPath', pathV], ['lcSvcMaterial', material], ['lcSvcTermTemp', '75'], ['lcSvcTermCompatible', 'yes'], ['lcSvcInsulTemp', '75'], ['lcSvcAmbient', '30'], ['lcSvcCcc', '3'], ['lcSvcWiringMethod', 'single_insulated_conductors_in_raceway'], ['lcSvcNoOtherAdj', 'yes']];
/** The B0 dwelling of the stage-4 UI suite, entered through the real controls; qual === null leaves the conductor ampacity unknown (never typed). */
function lcB0(qual, opts) {
  const h = lcPage(opts);
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_balanced_LN'); h.set('lcDeclBalancedLN', 'yes');
  h.set('lcFloorArea', '1500'); h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '1'); h.set('lcNycAcCircuits', '0');
  h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); if (qual !== null) h.set('lcConductorAmpacity', qual); h.set('lcNycAcException', 'yes');
  for (const [preset, va] of [[0, 12000], [3, 4500], [1, 5000], [2, 1200], [4, 5000]]) addLoad(h, preset, va);
  setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit'); setIn(ctl(cards(h)[3], 'inclusion'), 'fixed_or_permanently_connected'); setIn(ctl(cards(h)[4], 'coverage'), 'yes');
  h.set('lcInventoryComplete', 'yes');
  return h;
}
/** Everything a capture must leave alone: draft, results, held preliminary state, counters. Object identity where the page keeps objects. */
const lcFrozen = (h) => ({ draft: h.draftText(), result: h.api.LC.result, lastRequest: h.api.LC.lastRequest, evaluations: h.api.LC.evaluations, analysis: h.api.LC_SVC.analysis, design: JSON.stringify(h.api.lcSvcDesignObject()),
  mode: h.api.LC_PRE.mode, held: h.api.LC_PRE.result, epoch: h.api.LC_PRE.epoch, runs: h.api.LC_PRE.runs, adopted: h.api.LC_PRE.adopted, calcKey: h.api.LC_CALC.key, attempted: h.api.LC_CALC.attempted });
const EMPTY = { set: {}, clear: [] };

test('load calc: capture is the CURRENT draft — an edit that was never calculated, and a draft the form never re-transported; the last calculated request is not forwarded', () => {
  const h = lcB0('200'); click(h.$('lcCalcBtn'));
  const calculated = json(h.state().lastRequest);
  assert.deepEqual(h.bridge.getState().active.toolIds, ['load_calc', 'load_calc_preliminary', 'service_sizing', 'service_sizing_preliminary']);
  const before = lcFrozen(h);
  const c0 = h.bridge.capture('load_calc');
  assert.equal(c0.status, 'captured'); assert.equal(c0.capture, 'full'); assert.deepEqual(json(c0.formInput), { request: calculated });
  assert.equal(c0.details.requestSource, 'current_draft'); assert.equal(c0.details.matchesLastEvaluatedRequest, true); assert.equal(c0.details.calculateFresh, h.api.lcCalcFresh());
  assert.equal(c0.details.workflowMode, 'existing'); assert.equal(c0.details.optional82Route, true); assert.equal(field(c0, 'request').source, 'form_reader');
  assert.equal(c0.job.available, false); assert.equal(c0.job.reason, 'NO_OPEN_JOB');
  assert.deepEqual(lcFrozen(h), before, 'capture evaluates, renders and changes nothing');
  assert.deepEqual(json(REG.run('load_calc', c0.formInput, { origin: 'current_form' }).result.coreResult), json(FACADE.evaluateV2(calculated)), 'the registry runs the canonical facade on exactly the form\'s request');
  // 1. An ordinary edit through the real control; Calculate is NOT pressed again.
  h.set('lcFloorArea', '1800');
  const c1 = h.bridge.capture('load_calc');
  assert.equal(c1.status, 'captured'); assert.notEqual(c1.generation, c0.generation); assert.notEqual(c1.fingerprint, c0.fingerprint);
  assert.equal(c1.formInput.request.snapshot.dwelling.floorAreaFt2, 1800); assert.deepEqual(json(c1.formInput.request), h.request(), 'the canonical projection of the live draft');
  assert.equal(c1.details.calculateFresh, false, 'no calculation of this input is needed for a capture, and none is claimed');
  // 2. A draft the page published through its own transaction WITHOUT transporting it: the form's "last request" stays behind.
  assert.equal(h.api.lcTxn((d) => { d.snapshot.dwelling.floorAreaFt2 = 2100; }), true);
  assert.equal(h.state().lastRequest.snapshot.dwelling.floorAreaFt2, 1800, 'fixture: the last transported request is now older than the draft');
  const mid = lcFrozen(h);
  const c2 = h.bridge.capture('load_calc');
  assert.equal(c2.status, 'captured'); assert.equal(c2.formInput.request.snapshot.dwelling.floorAreaFt2, 2100, 'the draft, not the earlier request');
  assert.equal(c2.details.matchesLastEvaluatedRequest, false); assert.notEqual(c2.fingerprint, c1.fingerprint); assert.deepEqual(lcFrozen(h), mid);
  // Imported context stays context: no conversation patch can write it, whatever it names.
  for (const [toolId, patch, code] of [['load_calc', { set: { request: calculated } }, 'CONTEXT_ONLY_FIELD'], ['load_calc', { clear: ['request'] }, 'CONTEXT_ONLY_FIELD'], ['load_calc', { action: 'run_with_imported_context' }, 'UNKNOWN_FIELD'],
    ['load_calc', { set: { floorAreaFt2: 900 } }, 'UNKNOWN_FIELD']]) {
    const g = h.bridge.capture(toolId).generation;
    const res = h.bridge.apply({ toolId, expectedGeneration: g, patch });
    assert.equal(res.status, 'invalid_patch', JSON.stringify(patch)); assert.ok(res.errors.some((e) => e.code === code), JSON.stringify(res.errors)); assert.equal(res.applied, false);
  }
  assert.deepEqual(lcFrozen(h), mid, 'nothing was written');
});

test('load calc: an edit and its revert give the same input but a new generation; an un-evented draft change is found; answers for the earlier capture are refused', () => {
  const h = lcB0('200'); const c1 = h.bridge.capture('load_calc'); assert.equal(c1.status, 'captured');
  assert.equal(h.bridge.apply({ toolId: 'load_calc', expectedGeneration: c1.generation, patch: EMPTY }).status, 'no_change', 'control: an untouched form accepts the generation');
  const text = h.draftText();
  h.set('lcFloorArea', '1600'); h.set('lcFloorArea', '1500');   // change, then back to the very same value
  assert.equal(h.draftText(), text, 'fixture: identical draft again');
  const c2 = h.bridge.capture('load_calc');
  assert.deepEqual(json(c2.formInput), json(c1.formInput)); assert.equal(c2.fingerprint, c1.fingerprint, 'the input fingerprint cannot tell'); assert.notEqual(c2.generation, c1.generation, 'the generation can');
  const late = h.bridge.apply({ toolId: 'load_calc', expectedGeneration: c1.generation, patch: EMPTY });
  assert.equal(late.status, 'stale'); assert.equal(late.reason, 'GENERATION_CHANGED');
  h.set('lcQualMode', 'new_design'); h.set('lcQualMode', 'existing');   // the workflow mode and back
  assert.equal(h.bridge.apply({ toolId: 'load_calc', expectedGeneration: c2.generation, patch: EMPTY }).status, 'stale');
  const c3 = h.bridge.capture('load_calc'); assert.equal(c3.fingerprint, c1.fingerprint);
  assert.equal(h.api.lcTxn((d) => { d.snapshot.dwelling.floorAreaFt2 = 1700; }), true);   // a script changed the draft; no event reached the document
  const silent = h.bridge.apply({ toolId: 'load_calc', expectedGeneration: c3.generation, patch: EMPTY });
  assert.equal(silent.status, 'stale'); assert.equal(silent.reason, 'FORM_CHANGED_SINCE_CAPTURE'); assert.notEqual(silent.generation, c3.generation);
  const c4 = h.bridge.capture('load_calc'); h.api.LC_PRE.mode = 'new_design';   // the mode moved without an event
  assert.equal(h.bridge.apply({ toolId: 'load_calc', expectedGeneration: c4.generation, patch: EMPTY }).reason, 'FORM_CHANGED_SINCE_CAPTURE');
});

test('service sizing: the current request and the current design answers, before any Calculate / Assess; a fresh design edit is captured and its revert invalidates', () => {
  const h = lcB0('200');
  const none = h.bridge.capture('service_sizing');
  assert.equal(none.status, 'captured'); assert.deepEqual(json(none.formInput), { request: h.request() }); assert.equal(field(none, 'design').reason, 'DESIGN_BLANK'); assert.equal(field(none, 'design').state, 'not_stated');
  fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu'));
  assert.equal(h.api.LC_SVC.analysis, null, 'fixture: the form itself has assessed nothing'); assert.equal(h.api.LC_CALC.attempted, false, 'fixture: Calculate was never pressed');
  const before = lcFrozen(h);
  const c1 = h.bridge.capture('service_sizing');
  assert.equal(c1.status, 'captured'); assert.deepEqual(json(c1.formInput), { request: h.request(), design: json(h.api.lcSvcDesignObject()) });
  assert.ok(hasLeaf(c1.formInput.design, 200), 'the selected rating typed into the form'); assert.equal(field(c1, 'design').source, 'form_reader');
  assert.deepEqual(json(REG.run('service_sizing', c1.formInput, { origin: 'current_form' }).result.coreResult), json(SIZING.analyzePrototype(h.request(), h.api.lcSvcDesignObject())), 'the registry analyses exactly what the form holds now');
  assert.deepEqual(lcFrozen(h), before, 'capture assessed nothing and stored nothing');
  h.set('lcSvcMaterial', 'Al');   // a fresh design edit, no Assess
  const c2 = h.bridge.capture('service_sizing');
  assert.ok(hasLeaf(c2.formInput.design, 'Al') && !hasLeaf(c2.formInput.design, 'Cu')); assert.notEqual(c2.fingerprint, c1.fingerprint); assert.notEqual(c2.generation, c1.generation);
  assert.deepEqual(json(c2.formInput.request), json(c1.formInput.request), 'a design edit leaves the request alone');
  h.set('lcSvcMaterial', 'Cu');   // …and back
  const c3 = h.bridge.capture('service_sizing');
  assert.equal(c3.fingerprint, c1.fingerprint); assert.notEqual(c3.generation, c1.generation); assert.notEqual(c3.generation, c2.generation);
  for (const g of [c1.generation, c2.generation]) assert.equal(h.bridge.apply({ toolId: 'service_sizing', expectedGeneration: g, patch: EMPTY }).reason, 'GENERATION_CHANGED');
  for (const patch of [{ set: { design: { selectedMainRatingA: 400 } } }, { clear: ['design'] }, { set: { request: h.request() } }]) {
    const res = h.bridge.apply({ toolId: 'service_sizing', expectedGeneration: h.bridge.capture('service_sizing').generation, patch });
    assert.equal(res.status, 'invalid_patch'); assert.ok(res.errors.some((e) => e.code === 'CONTEXT_ONLY_FIELD'));
  }
  assert.ok(hasLeaf(h.api.lcSvcDesignObject(), 200) && !hasLeaf(h.api.lcSvcDesignObject(), 400), 'the design in the form is the user\'s');
});

test('preliminary (stage 4): request + design are captured from the new-design workflow only — no held result is required, none is read, nothing is run or adopted', () => {
  const h = lcB0(null);   // conductor ampacity left unknown
  for (const id of ['load_calc_preliminary', 'service_sizing_preliminary']) {
    const c = h.bridge.capture(id);
    assert.equal(c.status, 'needs_form', id); assert.equal(c.capture, 'requires_form'); assert.equal(c.reason, 'NEW_DESIGN_MODE_NOT_SELECTED'); assert.equal(c.formInput, null); assert.equal(c.details.workflowMode, 'existing'); assert.equal(c.form.workflowMode, 'new_design');
  }
  assert.equal(h.bridge.navigate('service_sizing_preliminary').status, 'already_active'); assert.equal(h.api.LC_PRE.mode, 'existing', 'the bridge never selects the workflow mode');
  assert.equal(h.bridge.capture('load_calc').status, 'captured', 'the ordinary tools are available in either mode');
  h.set('lcQualMode', 'new_design');   // the user's own choice, through the real control
  const blank = h.bridge.capture('service_sizing_preliminary');
  assert.equal(blank.status, 'captured'); assert.equal(blank.details.workflowMode, 'new_design'); assert.equal(blank.details.preliminaryResultHeld, false);
  assert.deepEqual(json(blank.formInput), { request: h.request(), design: json(h.api.lcSvcDesignObject()) }, 'an unanswered design is forwarded as the form holds it — what the form\'s own check would send');
  assert.equal(B.describe().tools.find((t) => t.toolId === 'service_sizing_preliminary').apply, 'refused');
  fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('dwelling_83pct_310_12', 'Cu'));
  assert.equal(h.api.LC_PRE.result, null); assert.equal(h.api.LC_PRE.runs, 0, 'fixture: the form\'s preliminary check was never run');
  const before = lcFrozen(h);
  const cap = h.bridge.capture('service_sizing_preliminary'); const calc = h.bridge.capture('load_calc_preliminary');
  assert.equal(cap.status, 'captured'); assert.deepEqual(json(cap.formInput), { request: h.request(), design: json(h.api.lcSvcDesignObject()) });
  assert.equal(calc.status, 'captured'); assert.deepEqual(json(calc.formInput), { request: h.request() });
  assert.deepEqual(lcFrozen(h), before, 'capture ran no preliminary check');
  const run = REG.run('service_sizing_preliminary', cap.formInput, { origin: 'current_form' });
  assert.deepEqual(json(run.result.coreResult), json(SIZING.analyzePreliminaryPrototype(h.request(), h.api.lcSvcDesignObject())));
  assert.deepEqual(json(REG.run('load_calc_preliminary', calc.formInput, { origin: 'current_form' }).result.coreResult), json(FACADE.evaluatePreliminaryV2(h.request())));
  // The user now runs the form's OWN check: it must be the analysis the registry produced from the captured input (same binding).
  const runBtn = live(h, 'lcPreRunBtn'); assert.ok(runBtn, 'the shipped form offers its own preliminary action in this state');
  click(runBtn); const held = h.api.LC_PRE.result;
  assert.ok(held, 'the shipped form ran its preliminary check'); assert.deepEqual(json(held), json(run.result.coreResult));
  const shown = lcFrozen(h); const adoptBtn = live(h, 'lcPreAdoptBtn');
  const again = h.bridge.capture('service_sizing_preliminary');
  assert.equal(again.status, 'captured'); assert.equal(again.details.preliminaryResultHeld, true); assert.equal(again.fingerprint, cap.fingerprint); assert.notEqual(again.generation, cap.generation);
  assert.ok(!JSON.stringify(again).includes(held.binding ? held.binding.fingerprint : 'fp1-'), 'the held result is not copied into the capture');
  for (const patch of [{ set: { design: { selectedMainRatingA: 400 } } }, { set: { request: h.request() } }, { clear: ['design'] }, { set: { conductorAmpacityA: 175 } }, { set: { adopt: true } }, { confirmation: { action: SIZING.ADOPTION_CONFIRMATION_ACTION } }]) {
    const res = h.bridge.apply({ toolId: 'service_sizing_preliminary', expectedGeneration: again.generation, patch });
    assert.equal(res.status, 'invalid_patch', JSON.stringify(patch)); assert.equal(res.applied, false); assert.deepEqual(res.written, []);
  }
  assert.deepEqual(lcFrozen(h), shown, 'the held preliminary result, its epoch and the draft are untouched');
  assert.equal(h.api.LC_PRE.adopted, null); assert.equal(h.api.lcDraft().snapshot.optional82.conductorAmpacityA.value, null, 'no planned conductor was adopted');
  assert.equal(live(h, 'lcPreAdoptBtn'), adoptBtn, 'the confirmation on screen (if the form offers one) is still the user\'s own and still the same control');
  h.set('lcQualMode', 'existing');   // back to the default workflow
  assert.equal(h.bridge.capture('service_sizing_preliminary').reason, 'NEW_DESIGN_MODE_NOT_SELECTED');
});

test('load calc readers: a missing page reader, projection module or workflow state fails closed with a precise status; a faulted or unprojectable form is not captured', () => {
  const h = lcB0('200');
  const cases = [
    [(p) => { delete p.globals.lcDraft; }, 'load_calc', 'not_ready', 'PAGE_FUNCTION_MISSING', ['lcDraft']],
    [(p) => { delete p.globals.lcExportState; }, 'load_calc_preliminary', 'not_ready', 'PAGE_FUNCTION_MISSING', ['lcExportState']],
    [(p) => { delete p.globals.lcSvcDesignObject; }, 'service_sizing', 'not_ready', 'PAGE_FUNCTION_MISSING', ['lcSvcDesignObject']],
    [(p) => { delete p.globals.lcSvcDesignObject; p.api.LC_PRE.mode = 'new_design'; }, 'service_sizing_preliminary', 'not_ready', 'PAGE_FUNCTION_MISSING', ['lcSvcDesignObject']],
    [(p) => { delete p.globals.LC_PRE; }, 'service_sizing_preliminary', 'not_ready', 'PAGE_READER_MISSING', ['LC_PRE.mode']],
    [(p) => { p.globals.LC_PRE = { mode: 'something_else', result: null }; }, 'load_calc_preliminary', 'not_ready', 'PAGE_READER_MISSING', ['LC_PRE.mode']],
  ];
  for (const [breakIt, toolId, status, reason, missing] of cases) {
    const p = lcB0('200'); breakIt(p);
    const c = p.bridge.capture(toolId);
    assert.equal(c.status, status, toolId + ' ' + reason); assert.equal(c.reason, reason); assert.equal(c.capture, 'none'); assert.equal(c.formInput, null); assert.equal(c.ok, false); assert.deepEqual(c.details.missing, missing);
  }
  const noDesignReader = lcB0('200'); delete noDesignReader.globals.lcSvcDesignObject;
  assert.equal(noDesignReader.bridge.capture('load_calc').status, 'captured', 'a tool that does not need the missing reader is unaffected');
  const preStage4 = lcB0('200'); delete preStage4.globals.LC_PRE;
  const ordinary = preStage4.bridge.capture('service_sizing'); assert.equal(ordinary.status, 'captured'); assert.equal(ordinary.details.workflowMode, null, 'unknown, not assumed');
  for (const strip of [(EC) => null, (EC) => Object.assign({}, EC, { loadCalcStateV2: undefined }), (EC) => Object.assign({}, EC, { loadCalcStateV2: {} })]) {
    const p = lcB0('200', { bridgeEC: strip });
    for (const id of ['load_calc', 'service_sizing']) { const c = p.bridge.capture(id); assert.equal(c.status, 'not_ready'); assert.equal(c.reason, 'PAGE_READER_MISSING'); assert.deepEqual(c.details.missing, ['EC.loadCalcStateV2.toRequestV2']); assert.equal(c.formInput, null); }
    assert.ok(p.state().lastRequest, 'fixture: a last request exists and is NOT used as a fallback');
  }
  // The form reports a controlled fault (reader output stubbed for this one member): no capture, although a draft and a last request exist.
  const real = h.globals.lcExportState; h.globals.lcExportState = () => Object.assign(real(), { fault: { kind: 'storage', message: 'could not be saved', details: [] } });
  const fault = h.bridge.capture('load_calc');
  assert.equal(fault.status, 'needs_form'); assert.equal(fault.reason, 'FORM_REPORTS_FAULT'); assert.equal(fault.formInput, null); assert.deepEqual(fault.details.fault, { kind: 'storage', message: 'could not be saved' });
  h.globals.lcExportState = real;
  // A draft the canonical projection refuses (stubbed draft member): the projection's own problems are reported, nothing is captured.
  const draft = h.globals.lcDraft; h.globals.lcDraft = () => Object.assign({}, draft(), { loadErrors: 'broken' });
  const bad = h.bridge.capture('service_sizing');
  assert.equal(bad.status, 'needs_form'); assert.equal(bad.reason, 'DRAFT_NOT_PROJECTABLE'); assert.equal(bad.formInput, null); assert.ok(bad.details.problems.length > 0);
  h.globals.lcDraft = () => ({ snapshot: null, context: null, fieldErrors: {}, loadErrors: {}, sourceFavId: null });   // the page without a calculator core keeps no snapshot
  assert.equal(h.bridge.capture('load_calc').reason, 'NO_CURRENT_DRAFT');
  h.globals.lcDraft = draft; assert.equal(h.bridge.capture('load_calc').status, 'captured');
  h.$('lcForm').id = 'lcFormGone'; delete h.dom.byId.lcForm;   // the form is not built
  const unbuilt = h.bridge.capture('load_calc'); assert.equal(unbuilt.status, 'needs_form'); assert.equal(unbuilt.reason, 'FORM_NOT_ACTIVE'); assert.equal(unbuilt.active.note, 'LOAD_CALC_FORM_NOT_BUILT');
});

// ── job context: fixtures made by the job model itself (core/src/jobs/jobCard.js), in the shape the page stores them ─────
function jobFixture() {
  const jobId = 'job1_' + 'a'.repeat(32); const r1 = 'jrev1_' + '1'.repeat(32); const r2 = 'jrev1_' + '2'.repeat(32);
  const first = Job.createInitialRevision({ title: 'Private title', address: '1 Private St', notes: 'private note' }, [], { jobId, revisionId: r1, savedAt: '2026-11-21T10:00:00.000Z' });
  assert.equal(first.ok, true, JSON.stringify(first.problems));
  const second = Job.createNextRevision(first.revision, { title: 'Private title', address: '1 Private St', notes: 'private note, edited' }, [], { revisionId: r2, savedAt: '2026-11-21T11:00:00.000Z' });
  assert.equal(second.ok, true, JSON.stringify(second.problems));
  const headFor = (rev) => ({ kind: Job.HEAD_KIND, recordVersion: Job.RECORD_VERSION, jobId: rev.jobId, currentRevisionId: rev.revisionId, revisionNumber: rev.revisionNumber });   // jobCardStore.headFor
  for (const rev of [first.revision, second.revision]) assert.deepEqual(Job.validateHead(headFor(rev)), []);
  return { jobId, r1, r2, first: { head: headFor(first.revision), revision: first.revision }, second: { head: headFor(second.revision), revision: second.revision } };
}
test('job context: job identity, the current SAVED revision and the two draft indicators are separate facts; anything unreadable is unavailable, never invented', () => {
  const f = jobFixture(); const LC_JOB = { hub: null, store: null, listSeq: 0, viewSeq: 0, readSeq: 0, editorSeq: 0, statusSeq: 0, editor: null, current: null };   // the page's own initial object
  let dirty = false;
  const host = { hasDraft: () => dirty, create() { throw new Error('a job write API must never be called'); }, read() { throw new Error('the job store must never be read by the bridge'); } };
  const bridge = build(makeDoc({}), { LC_JOB }, { jobCard: Job }, { host: () => host }); const job = () => bridge.getState().job;
  const none = { available: false, jobId: null, currentRevisionId: null, revisionNumber: null, head: null };
  assert.deepEqual(job(), Object.assign({}, none, { reason: 'NO_OPEN_JOB', headValidation: null, jobCardDraftOpen: false, hasUnsavedDraft: false }));
  LC_JOB.current = f.first;   // lcJobOpen: LC_JOB.current = result.job
  assert.deepEqual(job(), { available: true, reason: null, jobId: f.jobId, currentRevisionId: f.r1, revisionNumber: 1, head: f.first.head, headValidation: 'canonical', jobCardDraftOpen: false, hasUnsavedDraft: false });
  assert.ok(!/rivate/.test(JSON.stringify(bridge.getState())), 'no title, address or note leaves the page through the bridge');
  LC_JOB.editor = { token: 1, base: f.first.revision, fields: { title: 'Private title', address: '1 Private St', notes: 'typed, not saved' }, added: [], busy: false, conflict: false }; dirty = true;   // lcJobEdit
  let j = job();
  assert.equal(j.jobId, f.jobId); assert.equal(j.currentRevisionId, f.r1, 'an open draft has no revision id: this is still the last saved revision'); assert.equal(j.revisionNumber, 1);
  assert.equal(j.jobCardDraftOpen, true); assert.equal(j.hasUnsavedDraft, true); assert.ok(!JSON.stringify(j).includes('typed, not saved'));
  LC_JOB.editor = null; LC_JOB.current = f.second; dirty = false;   // lcJobSave: editor closed, current = result.job
  j = job();
  assert.equal(j.jobId, f.jobId, 'job identity is constant over revisions'); assert.equal(j.currentRevisionId, f.r2); assert.notEqual(j.currentRevisionId, f.r1); assert.equal(j.revisionNumber, 2); assert.equal(j.jobCardDraftOpen, false);
  dirty = true;   // e.g. a measurement / material / photo draft: the host-wide indicator moves, the job-card one does not
  j = job(); assert.equal(j.hasUnsavedDraft, true); assert.equal(j.jobCardDraftOpen, false); assert.equal(j.currentRevisionId, f.r2); dirty = false;
  LC_JOB.current = null; LC_JOB.editor = { token: 2, base: null, fields: { title: 'New', address: '', notes: '' }, added: [], busy: false, conflict: false };   // lcJobNew
  assert.deepEqual(job(), Object.assign({}, none, { reason: 'NEW_JOB_NOT_SAVED', headValidation: null, jobCardDraftOpen: true, hasUnsavedDraft: false }));
  LC_JOB.editor = null;
  for (const [current, reason] of [
    [{ head: f.second.head, revision: f.first.revision }, 'JOB_HEAD_REVISION_MISMATCH'],
    [{ head: f.first.head }, 'JOB_HEAD_REVISION_MISMATCH'],
    [{ head: Object.assign({}, f.first.head, { currentRevisionId: 'rev-7' }), revision: Object.assign({}, f.first.revision, { revisionId: 'rev-7' }) }, 'JOB_HEAD_INVALID'],
    [{ head: { jobId: f.jobId, revisionId: f.r1 }, revision: f.first.revision }, 'JOB_HEAD_UNREADABLE'],   // "revisionId" is not a head member
    [{ head: Object.assign({}, f.first.head, { revisionNumber: 0 }), revision: f.first.revision }, 'JOB_HEAD_UNREADABLE'],
    [{ revision: f.first.revision }, 'JOB_HEAD_UNREADABLE'], ['job-1', 'JOB_HEAD_UNREADABLE'],
  ]) {
    LC_JOB.current = current; j = job();
    assert.equal(j.reason, reason, JSON.stringify(current).slice(0, 80)); assert.equal(j.available, false);
    assert.deepEqual([j.jobId, j.currentRevisionId, j.revisionNumber, j.head], [null, null, null, null], 'no partial or guessed identity');
  }
  // Without the job model in the page only the member types are known — said so, not presented as validated.
  const plainPage = build(makeDoc({}), { LC_JOB: { editor: null, current: f.second } }, null).getState().job;
  assert.equal(plainPage.available, true); assert.equal(plainPage.headValidation, 'member_types_only'); assert.equal(plainPage.currentRevisionId, f.r2); assert.equal(plainPage.hasUnsavedDraft, null, 'no host bridge: unknown, not false');
  const noState = build(makeDoc({}), {}, null).getState().job;
  assert.deepEqual(noState, Object.assign({}, none, { reason: 'JOB_STATE_UNAVAILABLE', headValidation: null, jobCardDraftOpen: null, hasUnsavedDraft: null }));
  assert.deepEqual(f.first, jobFixture().first, 'the page\'s job objects were only read');
});

// ── Wireway: integration prerequisite of the final workspace page ───────────────────────────────────────────────────────
const WW_PREREQ = 'PREREQUISITE NOT MET (root final-workspace phase): wwCalc of the shipped workspace/mobile.html must route to EC.conduitFill.calculateWirewayFill; it still computes with a page-local formula. This is a required failure until root replaces it — do not skip or weaken it.';
test('prerequisite: the shipped workspace wwCalc routes to EC.conduitFill.calculateWirewayFill and holds no wireway formula of its own', () => {
  const src = fnBody(HAND, 'wwCalc');
  assert.ok(/EC\.conduitFill\.calculateWirewayFill\s*\(/.test(src), WW_PREREQ);
  assert.ok(!/WW_AREAS/.test(src) && !/\*\s*0\.20?\b/.test(src), WW_PREREQ + ' (wwCalc still reads a local area table or multiplies by 0.20)');
});
function wirewayPage() {
  const src = fnBody(HAND, 'wwCalc');
  assert.ok(/EC\.conduitFill\.calculateWirewayFill\s*\(/.test(src), WW_PREREQ);
  const a = HAND.indexOf('<select id="wwWidth"'); const b = HAND.indexOf('id="wwResultBox"');
  assert.ok(a >= 0 && b > a, 'the wireway form markup of the shipped page');
  const els = controlsOf(HAND.slice(a, b)); const calls = [];
  for (const id of ['wwResultBox', 'wwResultGrid', 'wwRefTableBody', 'mode-conduit', 'panel-home']) els[id] = node();
  active(els, 'panel-conduit'); active(els, 'mode-wireway');
  const doc = makeDoc(els);
  const EC = { conduitFill: Object.assign({}, CF, { calculateWirewayFill: (input) => { const out = CF.calculateWirewayFill(input); calls.push({ input, out }); return out; } }) };
  const needs = (e) => new Error('the shipped wwCalc needs a page global or element this compact harness does not provide (' + (e && e.message) + '). Extend wirewayPage(); do not weaken the parity assertions.');
  let wwCalc;
  // eslint-disable-next-line no-new-func
  try { wwCalc = new Function('document', 'EC', 'window', src + '\nreturn wwCalc;')(doc, EC, {}); } catch (e) { throw needs(e); }
  const run = () => { try { wwCalc(); } catch (e) { throw needs(e); } };
  const p = { els, calls, bridge: build(doc, { wwCalc: run }, EC) };
  p.user = (id, value) => { els[id].value = value; run(); doc.fire('change'); };
  return p;
}
test('wireway: form and registry share one engine — the captured input is what wwCalc sends to the engine, and both results are equal, also after a correction', () => {
  const p = wirewayPage(); const NAMES = ['width', 'height', 'wireType', 'wireSize', 'numConductors'];
  p.user('wwWidth', '6'); p.user('wwWireSize', '12'); p.user('wwNumWires', '12');
  const shown = p.calls[p.calls.length - 1]; assert.ok(shown, WW_PREREQ);
  const cap = p.bridge.capture('wireway_fill');
  assert.equal(cap.status, 'captured'); assert.deepEqual(json(cap.formInput), { width: 6, height: 4, wireType: 'thhn', wireSize: '12', numConductors: 12 }); assert.deepEqual(cap.warnings, [], 'no page-local-formula warning is left');
  for (const f of NAMES) assert.equal(String(shown.input[f]), String(cap.formInput[f]), 'the form sends the same ' + f + ' to the engine');
  const reg = REG.run('wireway_fill', cap.formInput, { origin: 'current_form' });
  assert.equal(reg.result.engine.module + '.' + reg.result.engine.fn, 'conduitFill.calculateWirewayFill', 'the registry tool runs the engine function the form must call');
  assert.deepEqual(json(reg.result.coreResult), json(shown.out), 'one engine, one answer');
  const n = p.calls.length;
  const res = p.bridge.apply({ toolId: 'wireway_fill', expectedGeneration: cap.generation, patch: { set: { numConductors: 20 } } });
  assert.equal(res.status, 'applied'); assert.deepEqual(res.rendered, ['wwCalc']); assert.deepEqual(res.written, [{ controlId: 'wwNumWires', field: 'numConductors', from: '12', to: '20' }]);
  assert.equal(p.calls.length, n + 1); assert.equal(String(p.calls[n].input.numConductors), '20');
  assert.deepEqual(json(REG.run('wireway_fill', res.formInput, { origin: 'current_form' }).result.coreResult), json(p.calls[n].out));
});

// ── same-origin, cross-realm caller (the parent window calls into the iframe) ───────────────────────────────────────────
function realmRequire(realm, file, cache) {
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: vm.runInContext('({})', realm) }; cache.set(file, mod);
  const fn = vm.runInContext('(function (module, exports, require) {' + fs.readFileSync(file, 'utf8') + '\n})', realm, { filename: file });
  fn(mod, mod.exports, (rel) => realmRequire(realm, require.resolve(path.resolve(path.dirname(file), rel)), cache));
  return mod.exports;
}
test('cross-realm caller: an object built in the parent realm is refused without a write; the WHOLE request cloned through the owning realm\'s JSON is accepted', () => {
  // The "iframe": a second realm with its own Object.prototype. The bridge AND the registry are evaluated inside it, as in the page.
  const iframe = vm.createContext({ console }); const cache = new Map();
  const IB = realmRequire(iframe, BRIDGE_FILE, cache); const IREG = realmRequire(iframe, REG_FILE, cache); const iframeJSON = vm.runInContext('JSON', iframe);
  assert.notEqual(vm.runInContext('Object.prototype', iframe), Object.prototype, 'fixture: two realms');
  const p = wirePage({ registry: () => IREG }, IB).fill();
  const cap = p.bridge.capture('wire_sizing'); assert.equal(cap.status, 'captured'); assert.deepEqual(json(cap.formInput), FILLED);
  const n = p.calls.length; const before = p.values();
  const untouched = (res, why) => { assert.equal(res.ok, false, why); assert.equal(res.applied, false, why); assert.equal(json(res.written).length, 0, why); assert.equal(p.values(), before, why); assert.equal(p.calls.length, n, why); assert.equal(res.generation, cap.generation, why); };
  const parentPatch = { set: { voltage: 240 }, clear: [] };   // built by the parent window: this file's realm
  const parentRequest = { toolId: 'wire_sizing', expectedGeneration: cap.generation, patch: parentPatch };
  const foreign = p.bridge.apply(parentRequest);
  assert.equal(foreign.status, 'invalid_request'); assert.equal(foreign.reason, 'REQUEST_SHAPE'); assert.equal(foreign.detail, 'NOT_A_PLAIN_OBJECT_OF_THIS_WINDOW'); assert.equal(foreign.toolId, null, 'nothing is read from a refused request'); untouched(foreign, 'parent object');
  const nested = p.bridge.apply({ toolId: 'wire_sizing', expectedGeneration: cap.generation, patch: iframeJSON.parse(JSON.stringify(parentPatch)) });
  assert.equal(nested.status, 'invalid_request'); untouched(nested, 'cloning only the nested patch is not enough');
  const outer = iframeJSON.parse(JSON.stringify({ toolId: 'wire_sizing', expectedGeneration: cap.generation })); outer.patch = parentPatch;
  const mixed = p.bridge.apply(outer);
  assert.equal(mixed.status, 'invalid_patch'); assert.ok(mixed.errors.some((e) => e.code === 'PATCH_NOT_OBJECT')); untouched(mixed, 'an iframe request holding a parent patch');
  class Wrapped { constructor() { Object.assign(this, iframeJSON.parse(JSON.stringify(parentRequest))); } }
  untouched(p.bridge.apply(new Wrapped()), 'a class instance is not a plain object in any realm');
  // The documented caller: parent JSON.stringify -> iframe JSON.parse of the whole apply request.
  const ok = p.bridge.apply(iframeJSON.parse(JSON.stringify(parentRequest)));
  assert.equal(ok.status, 'applied'); assert.equal(ok.applied, true); assert.deepEqual(json(ok.written), [{ controlId: 'wsVoltage', field: 'voltage', from: '120', to: '240' }]);
  assert.equal(p.values(), before.replace('wsVoltage=120', 'wsVoltage=240'), 'only the requested control changed'); assert.equal(p.calls.length, n + 1); assert.equal(p.calls[n].input.voltage, 240);
  assert.notEqual(ok.generation, cap.generation);
  assert.equal(p.bridge.apply(iframeJSON.parse(JSON.stringify(parentRequest))).status, 'stale', 'the same cloned answer a second time is a stale response');
});

test('shipped bundle: the workspace page embeds, byte for byte, the current sources of every module the bridge reads — a failure here means REBUILD, not a bridge defect', () => {
  const EC = DOM.bootEngine(HTML);
  for (const [m, f] of [['conversationTools', 'handleToolCall'], ['loadCalcStateV2', 'toRequestV2'], ['loadCalcServiceSizing', 'analyzePreliminaryPrototype'], ['loadCalcFacade', 'evaluatePreliminaryV2'], ['conduitFill', 'calculateWirewayFill'], ['jobCard', 'validateHead'], ['batteryRuntime', 'parseDecimal']]) {
    assert.equal(typeof (EC && EC[m] && EC[m][f]), 'function', 'REBUILD REQUIRED (core: node tools/build-calc.js --workspace): the page bundle lacks EC.' + m + '.' + f);
  }
  const s = HTML.indexOf(BUILD.START); const e = HTML.indexOf(BUILD.END);
  assert.ok(s >= 0 && e > s, 'generated block markers');
  assert.ok(HTML.slice(s, e + BUILD.END.length) === BUILD.buildBlock(), 'REBUILD REQUIRED (core: node tools/build-calc.js --workspace): the generated block of workspace/mobile.html is not the current core/src modules. The Load Calc / Wireway tests above ran on the sources, not on this bundle.');
});

// ── navigation (the app's openTool / cvTool are stubbed; the bridge must report what really became active) ─────────────
function navPage(opts) {
  const o = opts || {}; const els = {}; const opened = []; const cv = [];
  for (const id of ['panel-wiresizer', 'panel-more', 'sub-converter', 'sub-bender', 'cvTabBattery']) els[id] = node();
  active(els, 'panel-home');
  for (const t of ['power', 'battery', 'torque', 'wire', 'temp', 'length']) els['cvt-' + t] = node({ style: { display: t === 'power' ? '' : 'none' } });
  const tabs = ['power', 'torque', 'wire'].map((t) => { const n = node(); n.setAttribute('onclick', "cvTool('" + t + "',this)"); return n; });
  const globals = { currentMoreTab: 'loadcalc' };
  const show = (panel) => { for (const id of ['panel-home', 'panel-wiresizer', 'panel-more']) els[id].classList.toggle('active', id === panel); };
  if (!o.noOpenTool) globals.openTool = (id) => { opened.push(id); if (!['wiresizer', 'converter', 'bender'].includes(id)) return false; if (o.inert) return true; show(id === 'wiresizer' ? 'panel-wiresizer' : 'panel-more'); if (id !== 'wiresizer') globals.currentMoreTab = id; return true; };
  globals.cvTool = (name, el) => { cv.push([name, el]); for (const t of ['power', 'battery', 'torque', 'wire', 'temp', 'length']) els['cvt-' + t].style.display = t === name ? '' : 'none'; };
  return { els, opened, cv, tabs, bridge: build(makeDoc(els, tabs), globals, null, { host: () => o.host || null }) };
}
test('navigation is honest: unsupported where no form exists, navigation-only for power / torque / bender, verified after the app\'s own entry function ran', () => {
  const p = navPage(); const g0 = p.bridge.getState().generation;
  for (const [id, reason] of [['voltage_drop', 'NO_REACHABLE_FORM'], ['conduit_fill_mixed', 'NO_FORM_FOR_MIXED_CONDUCTORS']]) {
    const r = p.bridge.navigate(id); assert.equal(r.ok, false); assert.equal(r.status, 'unsupported'); assert.equal(r.reason, reason);
    const c = p.bridge.capture(id); assert.equal(c.status, 'needs_input'); assert.equal(c.capture, 'unsupported'); assert.equal(c.formInput, null);
  }
  assert.equal(p.bridge.navigate('rm -rf').status, 'unknown_tool'); assert.equal(p.bridge.navigate(undefined).status, 'unknown_tool');
  assert.deepEqual(p.opened, [], 'nothing was opened for an unsupported or unknown tool'); assert.equal(p.bridge.getState().generation, g0);
  const t = p.bridge.navigate('torque');
  assert.equal(t.status, 'navigated'); assert.equal(t.navigationOnly, true); assert.equal(t.executable, false); assert.equal(t.calculated, false);
  assert.deepEqual(p.opened, ['converter']); assert.equal(p.cv.length, 1); assert.equal(p.cv[0][0], 'torque'); assert.equal(p.cv[0][1], p.tabs[1], 'the real tab element is passed to cvTool');
  assert.deepEqual(t.active.navigationOnlyIds, ['torque']); assert.deepEqual(t.active.toolIds, []); assert.notEqual(t.generation, g0);
  assert.equal(p.bridge.capture('torque').status, 'navigation_only'); assert.equal(p.bridge.capture().reason, 'NO_ACTIVE_CALCULATOR');
  assert.equal(p.bridge.apply({ toolId: 'torque', expectedGeneration: t.generation, patch: { set: {} } }).status, 'navigation_only');
  assert.equal(p.bridge.navigate('torque').status, 'already_active'); assert.deepEqual(p.opened, ['converter'], 'an already active form is never re-opened (re-opening resets some forms)');
  assert.equal(p.bridge.navigate('bender').status, 'navigated'); assert.equal(p.bridge.navigate('battery_runtime').status, 'navigated'); assert.equal(p.cv[p.cv.length - 1][1], p.els.cvTabBattery);
  assert.equal(p.bridge.navigate('wire_sizing').status, 'navigated'); assert.deepEqual(p.bridge.getState().active.toolIds, ['wire_sizing']);
  const inert = navPage({ inert: true }).bridge.navigate('wire_sizing');
  assert.equal(inert.ok, false); assert.equal(inert.status, 'failed'); assert.equal(inert.reason, 'TOOL_NOT_ACTIVE_AFTER_NAVIGATION');
  const missing = navPage({ noOpenTool: true }).bridge.navigate('wire_sizing');
  assert.equal(missing.status, 'unsupported'); assert.equal(missing.reason, 'ENTRY_FUNCTION_MISSING');
  const draft = navPage({ host: { hasDraft: () => true, create() { throw new Error('a job write API must never be called'); } } });
  const blocked = draft.bridge.navigate('wire_sizing');
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.reason, 'UNSAVED_JOB_DRAFT'); assert.deepEqual(draft.opened, []); assert.equal(draft.bridge.getState().job.hasUnsavedDraft, true);
});
