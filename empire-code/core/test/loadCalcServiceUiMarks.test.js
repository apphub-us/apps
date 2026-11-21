'use strict';
/**
 * LC-SERVICE-UI-MARKS-1 — live design validation after the first Assess (docs/load-calc-service-ui-1.md §"Live validation").
 *
 * A design edit after an Assess refreshes ONLY the current actionable design marks from a transient, validation-only call of
 * the unchanged bundled module (same fresh request + current design). The old analysis is dropped at once and never comes
 * back before the next explicit Assess/Reassess; the transient return is never stored, rendered or persisted. Runs the shipped
 * adapter (test/helpers/loadCalcDom.js) with real control events; expected marks are checked against the R2 source module
 * called directly. Node DOM harness only — not a native browser run.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildHarness } = require('./helpers/loadCalcDom.js');
const S = require('../src/calc/loadCalcServiceSizing.js');

const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const ctl = (card, role) => card.querySelectorAll('input, select, button').filter((e) => e.attrs['data-role'] === role)[0];
const setIn = (el, v) => { el.value = v; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
const addLoad = (h, preset, va) => { h.$('lcPresetName').value = String(preset); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click'); };
const calc = (h) => h.$('lcCalcBtn').dispatch('click');
const assess = (h) => h.$('lcSvcAssessBtn').dispatch('click');
const focusLog = (h) => h.dom.document.focusLog;
const svcText = (h) => ['lcSvcGate', 'lcSvcStatus', 'lcSvcResult'].map((id) => h.$(id).textContent).join(' | ');
/** ids only — never compare DOM nodes structurally (cyclic) */
const markIds = (h) => h.nodes().filter((n) => n._classes.has('lc-svc-invalid')).map((n) => n.id);
const msgNodes = (h) => h.nodes().filter((n) => n._classes.has('lc-svc-msg'));
const msgOf = (h, id) => { const ids = (h.$(id).attrs['aria-describedby'] || '').split(' '); return ids[1] ? h.$(ids[1]).textContent : null; };
const DESIGN_STALE = 'Design inputs changed — reassess service sizing.';
const NUMBERS_RE = /Minimum standard-rating candidate|Design-preview conductor candidate|Conditional table reference|Table ampacity|CALCULATED LOAD|23,680|98\.7 A|3\/0|\b\d+ A\b/;

const IDS = { 'plan.intent': 'lcSvcIntent', 'plan.oneMainDisconnect': 'lcSvcOneMainDisconnect', 'plan.noAdditionalSources': 'lcSvcNoAdditionalSources', 'plan.wholeDwelling': 'lcSvcWholeDwelling', 'plan.singleConductorSet': 'lcSvcSingleConductorSet', selectedMainRatingA: 'lcSvcSelectedRating', 'conductor.sizingPath': 'lcSvcSizingPath', 'conductor.material': 'lcSvcMaterial', 'conductor.terminationTempRatingC': 'lcSvcTermTemp', 'conductor.terminationMaterialCompatible': 'lcSvcTermCompatible', 'conductor.insulationTempRatingC': 'lcSvcInsulTemp', 'conductor.ambientTempC': 'lcSvcAmbient', 'conductor.currentCarryingConductors': 'lcSvcCcc', 'conductor.wiringMethod': 'lcSvcWiringMethod', 'conductor.noOtherAdjustmentOrCorrection': 'lcSvcNoOtherAdj' };
const ORDER = Object.values(IDS);
const PLAN = [['lcSvcIntent', 'new_design_candidate'], ['lcSvcOneMainDisconnect', 'yes'], ['lcSvcNoAdditionalSources', 'yes'], ['lcSvcWholeDwelling', 'yes'], ['lcSvcSingleConductorSet', 'yes']];
const COND = (pathV, material) => [['lcSvcSizingPath', pathV], ['lcSvcMaterial', material], ['lcSvcTermTemp', '75'], ['lcSvcTermCompatible', 'yes'], ['lcSvcInsulTemp', '75'], ['lcSvcAmbient', '30'], ['lcSvcCcc', '3'], ['lcSvcWiringMethod', 'single_insulated_conductors_in_raceway'], ['lcSvcNoOtherAdj', 'yes']];
const NINE = ['lcSvcSizingPath', 'lcSvcMaterial', 'lcSvcTermTemp', 'lcSvcTermCompatible', 'lcSvcInsulTemp', 'lcSvcAmbient', 'lcSvcCcc', 'lcSvcWiringMethod', 'lcSvcNoOtherAdj'];
const fill = (h, pairs) => { for (const [id, v] of pairs) h.set(id, v); };

function driveB0(h, ac) {
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_balanced_LN'); h.set('lcDeclBalancedLN', 'yes');
  h.set('lcFloorArea', '1500'); h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '1'); h.set('lcNycAcCircuits', '0');
  h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); h.set('lcConductorAmpacity', '200'); h.set('lcNycAcException', 'yes');
  for (const [preset, va] of [[0, 12000], [3, 4500], [1, 5000], [2, 1200], [4, ac || 5000]]) addLoad(h, preset, va);
  setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit');
  setIn(ctl(cards(h)[3], 'inclusion'), 'fixed_or_permanently_connected');
  setIn(ctl(cards(h)[4], 'coverage'), 'yes');
  h.set('lcInventoryComplete', 'yes');
}
function b0Calculated(opts, ac) { const h = buildHarness(opts); h.api.lcInit(); driveB0(h, ac); calc(h); assert.strictEqual(h.state().result.status, 'COMPLETE'); return h; }
/** B0 + plan + explicit 100 A + Assess with nine unfilled conductor conditions (the reported screen) */
function nineMarked(opts) { const h = b0Calculated(opts); fill(h, PLAN); h.set('lcSvcSelectedRating', '100'); assess(h); assert.deepStrictEqual(markIds(h), NINE); return h; }
/** marks the module itself would produce for the CURRENT design (actionable stages only), in form order */
function expectedIds(h) {
  const a = S.analyzePrototype(h.state().lastRequest, h.api.lcSvcDesignObject());
  const ids = new Set();
  const all = [].concat(a.designProblems || []);
  [a.minimumService, a.chosenMain, a.ungroundedConductors].forEach((st) => { if (st.status !== 'not_evaluated') all.push(...st.reasons); });
  for (const r of all) if (IDS[r.field] && !['STANDARD_RATING_CANDIDATE', 'SELECTED_AT_OR_ABOVE_MINIMUM', 'TABLE_310_16_CANDIDATE', 'TABLE_310_12_CANDIDATE'].includes(r.code)) ids.add(IDS[r.field]);
  return ORDER.filter((id) => ids.has(id));
}
/** marked = aria-invalid + Help first + exactly one inline message next to the control; unmarked = Help only */
function assertMarkDom(h) {
  const marked = new Set(markIds(h));
  for (const id of ORDER) {
    const el = h.$(id); const d = (el.attrs['aria-describedby'] || '').split(' ');
    assert.strictEqual(d[0], id + 'Help', id + ' keeps its help reference first');
    if (marked.has(id)) {
      assert.strictEqual(el.attrs['aria-invalid'], 'true', id); assert.strictEqual(d.length, 2, id + ' one message');
      const m = h.$(d[1]); assert.ok(m && el.parent.children.includes(m), id + ' message next to the control');
    } else { assert.strictEqual(el.attrs['aria-invalid'], undefined, id); assert.strictEqual(d.length, 1, id + ' no stale message'); }
  }
  const msgs = msgNodes(h); assert.strictEqual(msgs.length, marked.size, 'no orphan / duplicated message nodes');
  assert.strictEqual(new Set(msgs.map((m) => m.id)).size, msgs.length, 'unique message ids');
}
const noServiceNumbers = (h) => { assert.strictEqual(h.api.LC_SVC.analysis, null); assert.ok(!NUMBERS_RE.test(svcText(h)), svcText(h)); for (const m of msgNodes(h)) assert.ok(!/\b\d+ A\b|3\/0|AWG|kcmil/.test(m.textContent), 'mark text carries no computed amperes/size: ' + m.textContent); };

describe('LC-SERVICE-UI-MARKS-1 — before the first Assess', () => {
  test('1. design edits before any Assess: zero marks, no analysis, no numeric service output', () => {
    const h = b0Calculated();
    for (const [id, v] of [['lcSvcSelectedRating', '100'], ['lcSvcTermTemp', '60'], ['lcSvcAmbient', '40'], ['lcSvcSizingPath', 'general_table_75C'], ['lcSvcOneMainDisconnect', 'no']]) {
      h.set(id, v); assert.deepStrictEqual(markIds(h), [], id); noServiceNumbers(h); assert.strictEqual(h.$('lcSvcStatus').textContent, '', 'no stale notice before an Assess');
    }
    assert.strictEqual(h.api.LC_SVC.attempted, false); assert.strictEqual(h.api.LC_SVC.liveKey, null);
  });
});

describe('LC-SERVICE-UI-MARKS-1 — live marks follow the current design', () => {
  test('2. nine conductor marks; General -> 8, Copper -> 7 with exact ids, aria and texts; analysis null + stale notice until Reassess', () => {
    const h = nineMarked(); const f = focusLog(h).focuses.length; const s = focusLog(h).scrolls.length; const active = h.dom.document.activeElement;
    h.set('lcSvcSizingPath', 'general_table_75C');
    assert.deepStrictEqual(markIds(h), NINE.slice(1)); assert.deepStrictEqual(markIds(h), expectedIds(h)); assertMarkDom(h);
    for (const id of NINE.slice(1)) assert.strictEqual(msgOf(h, id), 'Needs an answer — unknown is never assumed.', id);
    assert.strictEqual(h.api.LC_SVC.analysis, null); assert.strictEqual(h.$('lcSvcStatus').textContent, DESIGN_STALE); noServiceNumbers(h);
    h.set('lcSvcMaterial', 'Cu');
    assert.deepStrictEqual(markIds(h), NINE.slice(2)); assert.deepStrictEqual(markIds(h), expectedIds(h)); assertMarkDom(h);
    assert.strictEqual(h.$('lcSvcSizingPath').attrs['aria-describedby'], 'lcSvcSizingPathHelp'); assert.strictEqual(h.$('lcSvcMaterial').attrs['aria-describedby'], 'lcSvcMaterialHelp');
    assert.strictEqual(h.api.LC_SVC.analysis, null); assert.strictEqual(h.$('lcSvcStatus').textContent, DESIGN_STALE); noServiceNumbers(h);
    assert.strictEqual(focusLog(h).focuses.length, f, 'no focus move'); assert.strictEqual(focusLog(h).scrolls.length, s, 'no scroll'); assert.ok(h.dom.document.activeElement === active, 'focus unchanged');
  });
  test('3. all conditions filled: marks reach 0 before Reassess with no service output; Reassess restores the direct module result', () => {
    const h = nineMarked();
    COND('general_table_75C', 'Cu').forEach(([id, v], i) => { h.set(id, v); assert.deepStrictEqual(markIds(h), NINE.slice(i + 1), id); noServiceNumbers(h); });
    assert.deepStrictEqual(markIds(h), []); assert.strictEqual(h.$('lcSvcStatus').textContent, DESIGN_STALE); assert.ok(!/Table 310|Revalidation|QUALIFICATION CHECK/.test(svcText(h)));
    assess(h);
    assert.strictEqual(JSON.stringify(h.api.LC_SVC.analysis), JSON.stringify(S.analyzePrototype(h.state().lastRequest, h.api.lcSvcDesignObject())), 'Reassess = direct unchanged module call');
    assert.strictEqual(h.api.LC_SVC.analysis.ungroundedConductors.tableCandidate.size, '3'); assert.match(svcText(h), /Conditional table reference — not a selection/);
    assert.strictEqual(h.$('lcSvcStatus').textContent, ''); assert.deepStrictEqual(markIds(h), [], 'a revalidation review is never a field mark');
  });
  test('4. refused inputs (60 °C terminals, 40 °C ambient) stay marked through other edits, clear when corrected, mark again when emptied — general and dwelling paths', () => {
    for (const pathV of ['general_table_75C', 'dwelling_83pct_310_12']) {
      const h = nineMarked(); fill(h, COND(pathV, 'Al')); h.set('lcSvcTermTemp', '60'); h.set('lcSvcAmbient', '40');
      const r60 = S.analyzePrototype(h.state().lastRequest, h.api.lcSvcDesignObject()).ungroundedConductors.reasons;
      assert.deepStrictEqual(markIds(h), ['lcSvcTermTemp', 'lcSvcAmbient'], pathV); assertMarkDom(h);
      assert.strictEqual(msgOf(h, 'lcSvcTermTemp'), 'Not supported by this preview — ' + r60.find((r) => r.code === 'TERMINATION_60C_UNSUPPORTED').message);
      assert.strictEqual(msgOf(h, 'lcSvcAmbient'), 'Not supported by this preview — ' + r60.find((r) => r.code === 'AMBIENT_UNSUPPORTED').message);
      h.set('lcSvcMaterial', 'Cu'); h.set('lcSvcCcc', '2'); h.set('lcSvcWiringMethod', 'single_insulated_conductors_in_raceway');
      assert.deepStrictEqual(markIds(h), ['lcSvcTermTemp', 'lcSvcAmbient'], 'other edits keep the refusals marked');
      h.set('lcSvcTermTemp', '75'); assert.deepStrictEqual(markIds(h), ['lcSvcAmbient']); assertMarkDom(h);
      h.set('lcSvcAmbient', '30'); assert.deepStrictEqual(markIds(h), []); assertMarkDom(h);
      h.set('lcSvcAmbient', ''); assert.deepStrictEqual(markIds(h), ['lcSvcAmbient']); assert.strictEqual(msgOf(h, 'lcSvcAmbient'), 'Needs an answer — unknown is never assumed.');
      h.set('lcSvcAmbient', '40'); h.set('lcSvcAmbient', '30'); assert.deepStrictEqual(markIds(h), [], 'edit + revert'); noServiceNumbers(h);
      const amb = h.$('lcSvcAmbient'); amb.value = 'abc'; amb.dispatch('input');
      assert.deepStrictEqual(markIds(h), ['lcSvcAmbient']); assert.match(msgOf(h, 'lcSvcAmbient'), /^Invalid entry — conductor\.ambientTempC must be a finite number/); noServiceNumbers(h);
      assert.strictEqual(h.api.LC_SVC.analysis, null);
    }
  });
  test('5. gate changes recalculate applicability: no obsolete downstream marks from not_evaluated stages', () => {
    const h = nineMarked();
    h.set('lcSvcSelectedRating', '');   // chosen main waiting -> conductors not_evaluated
    assert.deepStrictEqual(markIds(h), ['lcSvcSelectedRating']); assert.deepStrictEqual(markIds(h), expectedIds(h)); assert.strictEqual(msgOf(h, 'lcSvcSelectedRating'), 'Needs an answer — unknown is never assumed.');
    h.set('lcSvcSelectedRating', '100'); assert.deepStrictEqual(markIds(h), NINE, 'the conductor stage is applicable again');
    h.set('lcSvcOneMainDisconnect', 'no');   // minimum unsupported -> chosen + conductors not_evaluated
    assert.deepStrictEqual(markIds(h), ['lcSvcOneMainDisconnect']); assert.deepStrictEqual(markIds(h), expectedIds(h)); assert.match(msgOf(h, 'lcSvcOneMainDisconnect'), /^Not supported by this preview — one main service disconnect is required/);
    h.set('lcSvcOneMainDisconnect', 'yes'); h.set('lcSvcIntent', '');
    assert.deepStrictEqual(markIds(h), ['lcSvcIntent']); assert.deepStrictEqual(markIds(h), expectedIds(h));
    h.set('lcSvcIntent', 'new_design_candidate'); h.set('lcSvcSizingPath', 'dwelling_83pct_310_12'); assert.deepStrictEqual(markIds(h), NINE.slice(1)); assertMarkDom(h);
    noServiceNumbers(h);
  });
  test('5b. an undersized selection is marked live without quoting the computed minimum; Reassess shows the module message', () => {
    const h = b0Calculated({}, 30000); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); assess(h);
    const min = h.api.LC_SVC.analysis.minimumService.ratingA; assert.ok(min > 100);
    h.set('lcSvcSelectedRating', '100');
    assert.deepStrictEqual(markIds(h), ['lcSvcSelectedRating']); assert.strictEqual(msgOf(h, 'lcSvcSelectedRating'), 'Below the minimum candidate — reassess service sizing to see the minimum.');
    assert.ok(!msgOf(h, 'lcSvcSelectedRating').includes(String(min))); noServiceNumbers(h);
    assess(h); assert.ok(msgOf(h, 'lcSvcSelectedRating').includes(min + ' A'), 'the explicit Reassess shows the module message');
  });
});

describe('LC-SERVICE-UI-MARKS-1 — safety clearing is unchanged', () => {
  test('6. load edit / revert / Calculate / Reset / restore / route / scope: no live leakage, storage bytes unchanged', () => {
    let h = nineMarked(); h.set('lcSvcSizingPath', 'general_table_75C'); assert.strictEqual(markIds(h).length, 8);
    h.set('lcFloorArea', '1600'); assert.deepStrictEqual(markIds(h), [], 'stale load: no marks'); noServiceNumbers(h);
    h.set('lcSvcMaterial', 'Cu'); assert.deepStrictEqual(markIds(h), [], 'a design edit on a stale load marks nothing');
    h.set('lcFloorArea', '1500'); assert.deepStrictEqual(markIds(h), [], 'revert does not resurrect live marks'); noServiceNumbers(h); assert.strictEqual(h.$('lcSvcStatus').textContent, DESIGN_STALE);
    h.set('lcSvcTermTemp', '60'); assert.ok(markIds(h).includes('lcSvcTermTemp'), 'a new design edit on the fresh load validates again');
    calc(h); assert.deepStrictEqual(markIds(h), [], 'main Calculate clears live marks'); assert.match(svcText(h), /previous service analysis was removed/); noServiceNumbers(h);
    assess(h); assert.ok(markIds(h).length);
    h.api.lcReset(); assert.deepStrictEqual(markIds(h), []); assert.strictEqual(h.api.LC_SVC.liveKey, null); assert.strictEqual(h.api.LC_SVC.attempted, false);
    // method / scope switch
    for (const [id, v] of [['lcMethod', 'measured_220_87'], ['lcPurpose', 'feeder'], ['lcTopology', '1ph_3w_120_208_network']]) {
      h = nineMarked(); h.set('lcSvcSizingPath', 'general_table_75C'); h.set(id, v);
      assert.deepStrictEqual(markIds(h), [], id); assert.strictEqual(h.api.LC_SVC.attempted, false, id); assert.strictEqual(h.api.LC_SVC.liveKey, null, id);
      h.set('lcSvcMaterial', 'Cu'); assert.deepStrictEqual(markIds(h), [], id + ': no live validation off-route / out of scope');
    }
    // restore + storage bytes
    const a = buildHarness({ promptAnswer: 'B0' }); a.api.lcInit(); driveB0(a); calc(a);
    const b = nineMarked({ promptAnswer: 'B0' }); b.set('lcSvcSizingPath', 'general_table_75C'); b.set('lcSvcTermTemp', '60');
    assert.strictEqual(JSON.stringify(b.api.lcFavPayload()), JSON.stringify(a.api.lcFavPayload()));
    assert.strictEqual(a.api.lcFavSave(), true); assert.strictEqual(b.api.lcFavSave(), true);
    assert.strictEqual(JSON.stringify(JSON.parse(b.store.data).lc[0].vals), JSON.stringify(JSON.parse(a.store.data).lc[0].vals));
    assert.ok(!/lcSvc|liveKey|sizingPath|terminationTempRatingC|lc-svc-invalid/.test(b.store.data)); assert.ok(!/lcSvc|liveKey|LC_SVC/.test(JSON.stringify(b.state())));
    b.$('lc-fav-list').querySelectorAll('.fav-item')[0].dispatch('click'); assert.deepStrictEqual(markIds(b), []); assert.strictEqual(b.api.LC_SVC.liveKey, null);
  });
  test('7. after a displayed preview candidate every design edit hides all service numbers; the main B0 result stays identical', () => {
    const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu')); assess(h);
    assert.match(svcText(h), /Design-preview conductor candidate.*3\/0 AWG/);
    const res = JSON.stringify(h.state().result); const req = JSON.stringify(h.state().lastRequest); const resText = h.$('lcResult').textContent; const ev = h.state().evaluations;
    for (const [id, v] of [['lcSvcAmbient', '31'], ['lcSvcAmbient', '30'], ['lcSvcSelectedRating', '225'], ['lcSvcSelectedRating', '200'], ['lcSvcMaterial', 'Al'], ['lcSvcMaterial', 'Cu'], ['lcSvcNoOtherAdj', 'no']]) {
      h.set(id, v); noServiceNumbers(h); assert.strictEqual(h.$('lcSvcStatus').textContent, DESIGN_STALE, id); assert.deepStrictEqual(markIds(h), expectedIds(h), id + '=' + v);
    }
    assert.strictEqual(JSON.stringify(h.state().result), res); assert.strictEqual(JSON.stringify(h.state().lastRequest), req); assert.strictEqual(h.$('lcResult').textContent, resText); assert.strictEqual(h.state().evaluations, ev);
    assert.match(h.text(), /Total demand: 23,680 VA/);
  });
});

describe('LC-SERVICE-UI-MARKS-1 — faults during live validation', () => {
  const swap = (h, fn) => { const real = h.EC.loadCalcServiceSizing; h.EC.loadCalcServiceSizing = Object.assign({}, real, { analyzePrototype: (req, d) => (d ? fn(real, req, d) : real.analyzePrototype(req, d)) }); return real; };
  const variants = [
    ['throw', () => { throw new TypeError('live exploded'); }, /live exploded/],
    ['malformed', () => ({ operative: false, installationApproved: false, globalCodeCompliance: 'not_verified', minimumService: { status: 'waiting_input', reasons: [null] }, chosenMain: {}, ungroundedConductors: {}, remainingChecks: [] }), /SERVICE SIZING FAILED/],
    ['bad shape', () => ({ operative: false, installationApproved: false, globalCodeCompliance: 'not_verified' }), /unexpected analysis shape/],
    ['unsafe approval', (real, req, d) => Object.assign(JSON.parse(JSON.stringify(real.analyzePrototype(req, d))), { installationApproved: true }), /not marked non-operative/],
  ];
  for (const [name, fn, re] of variants) {
    test('8. ' + name + ': old output and marks cleared, scoped error, Load Calc untouched, no focus move; next valid edit and Reassess recover', () => {
      const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu')); h.set('lcSvcTermTemp', '60'); assess(h);
      assert.deepStrictEqual(markIds(h), ['lcSvcTermTemp']);
      const res = JSON.stringify(h.state().result); const f = focusLog(h).focuses.length; const s = focusLog(h).scrolls.length;
      const real = swap(h, fn);
      assert.doesNotThrow(() => h.set('lcSvcAmbient', '31'));
      assert.match(svcText(h), /SERVICE SIZING FAILED/); assert.match(svcText(h), re);
      assert.deepStrictEqual(markIds(h), []); assertMarkDom(h); noServiceNumbers(h);
      assert.ok(!/installation approved: true|operative: true/.test(h.$('lcSvc').textContent), 'no false approval');
      assert.strictEqual(JSON.stringify(h.state().result), res); assert.match(h.text(), /Total demand: 23,680 VA/); assert.strictEqual(h.state().fault, null);
      assert.strictEqual(focusLog(h).focuses.length, f); assert.strictEqual(focusLog(h).scrolls.length, s);
      assert.strictEqual(h.$('lcSvcControls').style.display, '', 'controls stay usable');
      h.EC.loadCalcServiceSizing = real;
      h.set('lcSvcAmbient', '30');   // next valid edit recovers live validation
      assert.ok(!/SERVICE SIZING FAILED/.test(svcText(h))); assert.deepStrictEqual(markIds(h), ['lcSvcTermTemp']); noServiceNumbers(h);
      swap(h, fn); h.set('lcSvcCcc', '2'); assert.match(svcText(h), /SERVICE SIZING FAILED/);
      h.EC.loadCalcServiceSizing = real; h.set('lcSvcTermTemp', '75'); assess(h);   // Reassess recovers
      assert.ok(!/SERVICE SIZING FAILED/.test(svcText(h))); assert.match(svcText(h), /3\/0 AWG/); assert.deepStrictEqual(markIds(h), []);
    });
  }
});

describe('LC-SERVICE-UI-MARKS-1 — DOM hygiene over repeated edits', () => {
  test('9. repeated live edits never accumulate messages / ids, keep help references and never move focus or scroll', () => {
    const h = nineMarked(); const f = focusLog(h).focuses.length; const s = focusLog(h).scrolls.length; const active = h.dom.document.activeElement;
    for (let i = 0; i < 6; i++) {
      for (const [id, v] of [['lcSvcSizingPath', 'general_table_75C'], ['lcSvcTermTemp', '60'], ['lcSvcAmbient', '40'], ['lcSvcTermTemp', ''], ['lcSvcAmbient', ''], ['lcSvcSizingPath', '']]) {
        h.set(id, v); assertMarkDom(h); assert.deepStrictEqual(markIds(h), expectedIds(h));
      }
    }
    assert.deepStrictEqual(markIds(h), NINE); assert.strictEqual(msgNodes(h).length, 9);
    assert.strictEqual(focusLog(h).focuses.length, f); assert.strictEqual(focusLog(h).scrolls.length, s); assert.ok(h.dom.document.activeElement === active, 'focus unchanged');
    assert.ok(!h.nodes().some((n) => n.innerHTMLWrites), 'text-only rendering');
    // Reassess keeps its existing behaviour: missing conductor answers with a reached minimum -> marks, no focus jump
    assess(h); assert.deepStrictEqual(markIds(h), NINE); assert.strictEqual(focusLog(h).focuses.length, f); assertMarkDom(h);
  });
});
