'use strict';
/**
 * LC-SERVICE-UI-1 — SERVICE SIZING — DESIGN PREVIEW panel (docs/load-calc-service-ui-1.md).
 *
 * Runs the shipped adapter (test/helpers/loadCalcDom.js) against the REAL generated EC block — which now carries the
 * unchanged R2 module as module 20 — with real control events. Every rendered engineering value is compared with the
 * R2 source module called directly (require('../src/calc/loadCalcServiceSizing.js')) on the exact request the adapter
 * transported; expected table facts are hand-written literals from docs/load-calc-service-sizing-1.md §3/§4, never read
 * back from the module's tables. Storage is synthetic only.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildHarness, generatedEC, adapterSource, html } = require('./helpers/loadCalcDom.js');
const S = require('../src/calc/loadCalcServiceSizing.js');

const ROOT = path.join(__dirname, '..');
const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const ctl = (card, role) => card.querySelectorAll('input, select, button').filter((e) => e.attrs['data-role'] === role)[0];
const setIn = (el, v) => { el.value = v; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
const addLoad = (h, preset, va) => { h.$('lcPresetName').value = String(preset); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click'); };
const calc = (h) => h.$('lcCalcBtn').dispatch('click');
const assess = (h) => h.$('lcSvcAssessBtn').dispatch('click');
const focusLog = (h) => h.dom.document.focusLog;
const visible = (el) => { for (let n = el; n; n = n.parent) { if (n.style && n.style.display === 'none') return false; if (n.id === 'lcForm') return true; } return false; };
/** what the panel SHOWS as its state/result (control option labels are excluded; they are inputs, not output) */
const svcText = (h) => ['lcSvcGate', 'lcSvcStatus', 'lcSvcResult'].map((id) => h.$(id).textContent).join(' | ');
const svcMarks = (h) => h.nodes().filter((n) => n._classes.has('lc-svc-invalid'));
const LOAD_STALE = 'Load inputs changed — press Recalculate, then reassess service sizing.';
const DESIGN_STALE = 'Design inputs changed — reassess service sizing.';
const NUMBERS_RE = /Minimum standard-rating candidate|Design-preview conductor candidate|Conditional table reference|Table ampacity|CALCULATED LOAD|23,680|98\.7 A/;

const IDS = { 'plan.intent': 'lcSvcIntent', 'plan.oneMainDisconnect': 'lcSvcOneMainDisconnect', 'plan.noAdditionalSources': 'lcSvcNoAdditionalSources', 'plan.wholeDwelling': 'lcSvcWholeDwelling', 'plan.singleConductorSet': 'lcSvcSingleConductorSet', selectedMainRatingA: 'lcSvcSelectedRating', 'conductor.sizingPath': 'lcSvcSizingPath', 'conductor.material': 'lcSvcMaterial', 'conductor.terminationTempRatingC': 'lcSvcTermTemp', 'conductor.terminationMaterialCompatible': 'lcSvcTermCompatible', 'conductor.insulationTempRatingC': 'lcSvcInsulTemp', 'conductor.ambientTempC': 'lcSvcAmbient', 'conductor.currentCarryingConductors': 'lcSvcCcc', 'conductor.wiringMethod': 'lcSvcWiringMethod', 'conductor.noOtherAdjustmentOrCorrection': 'lcSvcNoOtherAdj' };
const BLANK_DESIGN = { selectedMainRatingA: null, plan: { intent: null, oneMainDisconnect: null, noAdditionalSources: null, wholeDwelling: null, singleConductorSet: null }, conductor: { sizingPath: null, material: null, terminationTempRatingC: null, terminationMaterialCompatible: null, insulationTempRatingC: null, ambientTempC: null, currentCarryingConductors: null, wiringMethod: null, noOtherAdjustmentOrCorrection: null } };
const PLAN = [['lcSvcIntent', 'new_design_candidate'], ['lcSvcOneMainDisconnect', 'yes'], ['lcSvcNoAdditionalSources', 'yes'], ['lcSvcWholeDwelling', 'yes'], ['lcSvcSingleConductorSet', 'yes']];
const COND = (pathV, material) => [['lcSvcSizingPath', pathV], ['lcSvcMaterial', material], ['lcSvcTermTemp', '75'], ['lcSvcTermCompatible', 'yes'], ['lcSvcInsulTemp', '75'], ['lcSvcAmbient', '30'], ['lcSvcCcc', '3'], ['lcSvcWiringMethod', 'single_insulated_conductors_in_raceway'], ['lcSvcNoOtherAdj', 'yes']];
const fill = (h, pairs) => { for (const [id, v] of pairs) h.set(id, v); };

/** the accepted B0 dwelling (23,680 VA, 98.7 A, declared qualification 200 A), entered through the real controls */
function driveB0(h, o) {
  const p = Object.assign({ topology: '1ph_3w_120_240', model: 'split_240_balanced_LN', qual: '200' }, o || {});
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', p.topology); h.set('lcModel', p.model); h.set('lcDeclBalancedLN', 'yes');
  h.set('lcFloorArea', '1500'); h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '1'); h.set('lcNycAcCircuits', '0');
  h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); h.set('lcConductorAmpacity', p.qual); h.set('lcNycAcException', 'yes');
  for (const [preset, va] of [[0, 12000], [3, 4500], [1, 5000], [2, 1200], [4, 5000]]) addLoad(h, preset, va);
  setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit');
  setIn(ctl(cards(h)[3], 'inclusion'), 'fixed_or_permanently_connected');
  setIn(ctl(cards(h)[4], 'coverage'), 'yes');
  h.set('lcInventoryComplete', 'yes');
}
function b0Calculated(opts, o) { const h = buildHarness(opts); h.api.lcInit(); driveB0(h, o); calc(h); return h; }
/** direct R2 call on the exact request the adapter transported, with the adapter's own design object */
const direct = (h) => S.analyzePrototype(h.state().lastRequest, h.api.lcSvcDesignObject());
function assertMatchesDirect(h) {
  const shown = h.api.LC_SVC.analysis; assert.ok(shown, 'an analysis is held');
  assert.strictEqual(JSON.stringify(shown), JSON.stringify(direct(h)), 'the rendered analysis is exactly the R2 module result for this request + design');
  assert.strictEqual(shown.operative, false); assert.strictEqual(shown.installationApproved, false); assert.strictEqual(shown.globalCodeCompliance, 'not_verified');
  return shown;
}

describe('LC-SERVICE-UI-1 — bundle registration and exact parity', () => {
  test('module 20 is registered after its dependencies and embedded verbatim; the source is the pinned R2 bytes; the bundled API is the real one', () => {
    const builder = fs.readFileSync(path.join(ROOT, 'tools', 'build-calc.js'), 'utf8');
    const ids = [...builder.matchAll(/\{ id: '([A-Za-z0-9]+)', file: '([^']+)' \}/g)].map((m) => m[1]);
    assert.strictEqual(ids.length, 38); assert.strictEqual(ids[19], 'loadCalcServiceSizing'); assert.strictEqual(ids[20], 'loadCalcServiceRecord'); assert.strictEqual(ids[21], 'jobCard'); assert.strictEqual(ids[22], 'jobCardStore');
    assert.ok(ids.indexOf('loadCalcFacade') < 19 && ids.indexOf('loadCalcInputV2') < 19, 'after both dependencies');
    const raw = fs.readFileSync(path.join(ROOT, 'src', 'calc', 'loadCalcServiceSizing.js'));
    const s = html.indexOf('<!-- EC-CALC:START'); const e = html.indexOf('<!-- EC-CALC:END -->'); const block = html.slice(s, e);
    const m = /  __reg\["loadCalcServiceSizing"\] = function \(module, exports, require\) \{\n([\s\S]*?)\n  \};/.exec(block); assert.ok(m, 'embedded');
    const body = m[1].split('\n').map((l) => (l.startsWith('    ') ? l.slice(4) : l)).join('\n');
    assert.strictEqual(body, raw.toString('utf8').replace(/\r\n/g, '\n').replace(/\s+$/, ''), 'generated body == source bytes');
    assert.strictEqual((html.slice(html.indexOf('<!-- EC-CALC:END -->')).match(/function analyzePrototype\(/g) || []).length, 0, 'no second copy outside the generated block');
    const EC = generatedEC();
    assert.strictEqual(typeof EC.loadCalcServiceSizing.analyzePrototype, 'function');
    assert.deepStrictEqual(EC.loadCalcServiceSizing.STANDARD_RATINGS_SUBSET, S.STANDARD_RATINGS_SUBSET);
    assert.deepStrictEqual(EC.loadCalcServiceSizing.SAFETY_FLAGS, S.SAFETY_FLAGS);
  });
  test('the R2 source module, its R2 test and its doc are byte-identical to baseline 150', () => {
    // pins from the coordinator's BASELINE.json (baseline 150, 309470aa…357e)
    const pins = { 'src/calc/loadCalcServiceSizing.js': 'cbd1bd57795444a9837967580d7e56425c064efa275a6ec56341c67da068b847', 'test/loadCalcServiceSizing.test.js': 'd0aa9952f60710279a6a2d2549f89595c65002bc19ef15e7b7e0d10d00dfd58c', 'docs/load-calc-service-sizing-1.md': '80db6dd4b34fe8d696e15f0815013365212da6c0edc84706f176e9e3d47905ce' };
    for (const [rel, pin] of Object.entries(pins)) assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'), pin, rel);
  });
});

describe('LC-SERVICE-UI-1 — placement, route and the first Calculate', () => {
  test('the panel sits inside lcForm right after the Load Calc result, is titled, and belongs to opt_220_82 only', () => {
    const h = buildHarness(); h.api.lcInit();
    const form = h.$('lcForm').children; assert.strictEqual(form.indexOf(h.$('lcSvc')), form.indexOf(h.$('lcResult')) + 1, 'directly after #lcResult');
    assert.strictEqual(h.$('lcSvc').style.display, 'none', 'hidden with no method');
    h.set('lcMethod', 'measured_220_87'); assert.strictEqual(h.$('lcSvc').style.display, 'none', 'hidden on 220.87');
    h.set('lcMethod', 'opt_220_82'); assert.strictEqual(h.$('lcSvc').style.display, '');
    const t = h.$('lcSvc').textContent;
    assert.match(t, /SERVICE SIZING — DESIGN PREVIEW/); assert.match(t, /ENGINEERING PREVIEW — NOT INSTALLATION APPROVAL/);
    assert.match(t, /one-family dwelling service, single-phase 120\/240 V/); assert.match(t, /not supported by this module — a limit of this preview, not a prohibition by the NEC/);
    assert.ok(t.includes('Service design settings are not saved with calculation presets.'));
    assert.match(t, /Existing capacity, Required capacity and Rating stay NOT ASSESSED/);
  });
  test('before the first main Calculate: no minimum, chosen assessment or conductor — even for a complete B0 — and no controls or button', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h);
    assert.strictEqual(h.state().result.status, 'COMPLETE', 'the engine evaluated internally');
    assert.strictEqual(h.$('lcSvcControls').style.display, 'none'); assert.ok(!visible(h.$('lcSvcAssessBtn')));
    assert.match(svcText(h), /Press Calculate first/); assert.ok(!NUMBERS_RE.test(svcText(h)), svcText(h));
    assert.strictEqual(h.api.lcSvcAssess(), false, 'no assessment before Calculate'); assert.strictEqual(h.api.LC_SVC.analysis, null);
    assert.ok(!/100 A|Minimum standard/.test(svcText(h)), 'no default 100 A is inferred from the floor');
  });
  test('fresh COMPLETE + computed current in scope: blank explicit controls, a separate type=button Assess button, labels and help wired by id', () => {
    const h = b0Calculated();
    assert.strictEqual(h.$('lcSvcControls').style.display, ''); const btn = h.$('lcSvcAssessBtn');
    assert.strictEqual(btn.tagName, 'BUTTON'); assert.strictEqual(btn.attrs.type, 'button'); assert.strictEqual(btn.textContent, 'Assess service sizing');
    assert.deepStrictEqual(h.api.lcSvcDesignObject(), BLANK_DESIGN, 'every design input starts unanswered (null), including the selected rating');
    const labels = h.$('lcSvc').querySelectorAll('label');
    for (const id of Object.values(IDS)) {
      const el = h.$(id); assert.ok(el, id); assert.strictEqual(el.value, '', id + ' blank'); assert.ok(visible(el), id + ' visible');
      assert.ok(labels.some((l) => l.attrs.for === id && l.textContent.trim().length > 3), id + ' has a <label for>');
      assert.ok(/Help$/.test(el.attrs['aria-describedby']) && h.$(el.attrs['aria-describedby']).textContent.length > 10, id + ' help text via aria-describedby');
      assert.ok(/^lcSvc[A-Z]/.test(id));
    }
    assert.ok(labels.some((l) => l.attrs.for === 'lcSvcSelectedRating' && l.textContent === 'Selected main rating — design input'));
    const intentOpts = h.$('lcSvcIntent').children.map((o) => [o.value, o.textContent]);
    assert.deepStrictEqual(intentOpts, [['', '— unanswered —'], ['new_design_candidate', 'New design — not an existing-service assessment']]);
    for (const id of ['lcSvcOneMainDisconnect', 'lcSvcNoAdditionalSources', 'lcSvcWholeDwelling', 'lcSvcSingleConductorSet', 'lcSvcTermCompatible', 'lcSvcNoOtherAdj']) assert.deepStrictEqual(h.$(id).children.map((o) => o.value), ['', 'yes', 'no'], id + ' Yes/No/Unknown');
    assert.strictEqual(h.$('lcSvcAmbient').type, 'number'); assert.strictEqual(h.$('lcSvcAmbient').attrs.placeholder, 'e.g. 30'); assert.strictEqual(h.$('lcSvcCcc').attrs.placeholder, 'e.g. 3');
    assert.ok(h.$('lcSvc').querySelectorAll('input').every((i) => i.type !== 'checkbox'), 'no enable / verified / override checkbox exists');
    assert.match(h.$('lcSvcQualEcho').textContent, /Declared 220\.82\(A\) conductor ampacity: 200 A — 220\.82\(A\) qualification input only; not a main breaker/);
  });
  test('the rating options ARE the module STANDARD_RATINGS_SUBSET (a different module subset changes them; nothing is hard-coded here)', () => {
    const h = b0Calculated();
    assert.deepStrictEqual(h.$('lcSvcSelectedRating').children.map((o) => o.value), [''].concat(S.STANDARD_RATINGS_SUBSET.map(String)));
    const g = buildHarness(); g.EC.loadCalcServiceSizing = Object.assign({}, g.EC.loadCalcServiceSizing, { STANDARD_RATINGS_SUBSET: Object.freeze([111, 222]) }); g.api.lcInit();
    assert.deepStrictEqual(g.$('lcSvcSelectedRating').children.map((o) => o.textContent), ['— unanswered —', '111 A', '222 A']);
  });
});

describe('LC-SERVICE-UI-1 — rendering equals the direct R2 analysis', () => {
  test('blank design after Calculate: waiting for plan premises, no minimum; first missing control is focused and marked with text + aria', () => {
    const h = b0Calculated(); const scrolls = focusLog(h).scrolls.length;
    assess(h); const a = assertMatchesDirect(h);
    assert.strictEqual(a.minimumService.status, 'waiting_input'); assert.strictEqual(a.minimumService.ratingA, null);
    assert.ok(!/Minimum standard-rating candidate/.test(svcText(h)));
    assert.strictEqual(h.$('lcSvcAssessBtn').textContent, 'Reassess service sizing');
    const first = h.$('lcSvcOneMainDisconnect');
    assert.strictEqual(h.dom.document.activeElement, first, 'focus: first actionable visible control (minimum not reached)'); assert.ok(focusLog(h).scrolls.length > scrolls);
    for (const id of ['lcSvcOneMainDisconnect', 'lcSvcNoAdditionalSources', 'lcSvcWholeDwelling', 'lcSvcSingleConductorSet']) {
      const el = h.$(id); assert.ok(el._classes.has('lc-svc-invalid'), id); assert.strictEqual(el.attrs['aria-invalid'], 'true', id);
      const ids = el.attrs['aria-describedby'].split(' '); assert.strictEqual(ids[0], id + 'Help', 'help stays described'); const msg = h.$(ids[1]);
      assert.ok(msg && el.parent.children.includes(msg), 'inline message next to the control'); assert.match(msg.textContent, /Needs an answer — unknown is never assumed\./);
    }
    assert.ok(!h.$('lcSvcSelectedRating')._classes.has('lc-svc-invalid'), 'the chosen rating is not asked before a minimum exists');
    // an ordinary design edit: no focus move, no scroll, the analysis is removed at once; the answered control loses its mark
    // (LC-SERVICE-UI-MARKS-1: the three still-unanswered premises stay marked by live validation — previously all marks were cleared)
    const f = focusLog(h).focuses.length; const s2 = focusLog(h).scrolls.length;
    h.set('lcSvcOneMainDisconnect', 'yes');
    assert.strictEqual(focusLog(h).focuses.length, f); assert.strictEqual(focusLog(h).scrolls.length, s2);
    assert.strictEqual(h.api.LC_SVC.analysis, null); assert.deepStrictEqual(svcMarks(h).map((n) => n.id), ['lcSvcNoAdditionalSources', 'lcSvcWholeDwelling', 'lcSvcSingleConductorSet']); assert.strictEqual(h.$('lcSvcOneMainDisconnect').attrs['aria-describedby'], 'lcSvcOneMainDisconnectHelp');
    assert.strictEqual(h.$('lcSvcStatus').textContent, DESIGN_STALE); assert.strictEqual(h.$('lcSvcStatus').attrs.role, 'status');
  });
  test('the minimum is available while the chosen rating and conductor settings are still missing: "waiting for your choice", no focus jump', () => {
    const h = b0Calculated(); fill(h, PLAN); const f = focusLog(h).focuses.length;
    assess(h); const a = assertMatchesDirect(h);
    assert.strictEqual(a.minimumService.status, 'experimental_candidate'); assert.strictEqual(a.minimumService.ratingA, 100); assert.strictEqual(a.minimumService.governedBy, 'floor_100A');
    assert.strictEqual(a.chosenMain.status, 'waiting_input'); assert.strictEqual(a.ungroundedConductors.status, 'not_evaluated');
    const t = svcText(h);
    assert.match(t, /MINIMUM STANDARD DISCONNECT RATING/); assert.ok(t.includes('Minimum standard-rating candidate: ' + a.minimumService.ratingA + ' A'));
    assert.match(t, /SELECTED MAIN RATING.*not chosen/); assert.match(t, /Waiting for your choice\. The minimum above is available/);
    assert.ok(!/Design-preview conductor candidate|Conditional table reference/.test(t));
    assert.strictEqual(focusLog(h).focuses.length, f, 'a reached minimum never moves focus');
    assert.ok(h.$('lcSvcSelectedRating')._classes.has('lc-svc-invalid'), 'the missing choice is marked'); assert.match(h.$(h.$('lcSvcSelectedRating').attrs['aria-describedby'].split(' ')[1]).textContent, /Needs an answer/);
    for (const hd of ['CALCULATED LOAD', 'MINIMUM STANDARD DISCONNECT RATING', 'SELECTED MAIN RATING', 'UNGROUNDED CONDUCTORS', 'QUALIFICATION CHECK', 'REMAINING CHECKS']) assert.ok(t.includes(hd), hd);
    assert.ok(t.indexOf('CALCULATED LOAD') < t.indexOf('MINIMUM STANDARD') && t.indexOf('MINIMUM STANDARD') < t.indexOf('SELECTED MAIN') && t.indexOf('SELECTED MAIN') < t.indexOf('UNGROUNDED') && t.indexOf('UNGROUNDED') < t.indexOf('QUALIFICATION CHECK') && t.indexOf('QUALIFICATION CHECK') < t.indexOf('REMAINING CHECKS'));
    assert.ok(t.includes(a.calcBasis.totalVADisplay) && t.includes(a.calcBasis.lineADisplay), 'engine display strings, not recomputed');
  });
  test('explicit 100 A and 200 A selections: meets the minimum, no automatic downgrade; 200 A general Cu -> 3/0 (200 A) premise unchanged', () => {
    const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '100'); assess(h);
    let a = assertMatchesDirect(h); assert.strictEqual(a.chosenMain.status, 'meets_prototype_minimum'); assert.strictEqual(a.chosenMain.selectedRatingA, 100);
    assert.match(svcText(h), /Selected main rating — design input100 A/);
    h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu')); assess(h);
    a = assertMatchesDirect(h); const u = a.ungroundedConductors;
    assert.strictEqual(a.chosenMain.selectedRatingA, 200); assert.strictEqual(u.status, 'experimental_candidate'); assert.strictEqual(u.recommendationAvailable, true);
    assert.strictEqual(u.size, '3/0'); assert.strictEqual(u.ampacity75CA, 200); assert.strictEqual(u.qualificationConsistency.status, 'premise_unchanged');
    const t = svcText(h);
    assert.ok(t.includes('Design-preview conductor candidate (non-operative): Copper (Cu) 3/0 AWG, 75 °C table ampacity 200 A, for the selected 200 A'));
    assert.match(t, /Ampacity thresholdmet in the current model/); assert.match(t, /Declared premiseunchanged/); assert.match(t, /Declared 220\.82\(A\) qualification ampacity200 ACandidate 75 °C table ampacity200 A/);
    assert.match(t, /General path — Table 310\.16, 75 °C column/); assert.match(t, /Not an installation instruction/);
    assert.ok(!/recommended/i.test(t), 'no unqualified recommendation wording');
  });
  test('a chosen rating below the minimum is reported as such (no downgrade/upgrade suggestion is invented)', () => {
    // B0 with a larger A/C: the calculated load governs a minimum above the 100 A floor
    const h = buildHarness(); h.api.lcInit(); driveB0(h); setIn(ctl(cards(h)[4], 'rating'), '30000'); setIn(ctl(cards(h)[4], 'coverage'), 'yes'); h.set('lcInventoryComplete', 'yes'); calc(h);
    assert.strictEqual(h.state().result.status, 'COMPLETE');
    fill(h, PLAN); h.set('lcSvcSelectedRating', '100'); assess(h); const a = assertMatchesDirect(h);
    assert.strictEqual(a.minimumService.governedBy, 'calculated_load'); assert.ok(a.minimumService.ratingA > 100);
    assert.strictEqual(a.chosenMain.status, 'rejected_undersized');
    assert.ok(svcText(h).includes('Minimum standard-rating candidate: ' + a.minimumService.ratingA + ' A')); assert.match(svcText(h), /Below the minimum standard-rating candidate \(\d+ A\)\. Nothing is adjusted automatically/);
    assert.match(svcText(h), /Governed by the calculated load/);
    assert.ok(h.$('lcSvcSelectedRating')._classes.has('lc-svc-invalid'));
  });
});

describe('LC-SERVICE-UI-1 — conditional table references and qualification consistency', () => {
  test('310.12 at 100 A (Cu 4 / 85 A, Al 2 / 90 A) stays a conditional table reference with review_required — never a selected wire, never a violation', () => {
    for (const [mat, size, amp] of [['Cu', '4', 85], ['Al', '2', 90]]) {
      const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '100'); fill(h, COND('dwelling_83pct_310_12', mat)); assess(h);
      const a = assertMatchesDirect(h); const u = a.ungroundedConductors;
      assert.strictEqual(u.status, 'table_candidate_conditional'); assert.strictEqual(u.recommendationAvailable, false); assert.strictEqual(u.size, null);
      assert.strictEqual(u.tableCandidate.size, size); assert.strictEqual(u.tableCandidate.ampacity75CA, amp); assert.strictEqual(u.qualificationConsistency.status, 'review_required');
      const t = svcText(h);
      assert.ok(!/Design-preview conductor candidate/.test(t), 'the table size is never promoted to a candidate/selection');
      assert.match(t, new RegExp('Conditional table reference — not a selectionTableTable 310\\.12Material' + (mat === 'Cu' ? 'Copper \\(Cu\\)' : 'Aluminum \\(Al\\)') + 'Size' + size + ' AWGTable ampacity \\(75 °C column\\)' + amp + ' AFor the selected rating100 ANamed pathConditional dwelling path — Table 310\\.12'));
      assert.match(t, /Conditions of this table lookup/); assert.match(t, /Review required — open model interpretation/); assert.match(t, /NOT an NEC violation finding, and reassessing does not resolve it/);
      assert.ok(!/(?<!NOT an NEC )violation/i.test(t.replace(/NOT an NEC violation/g, '')), 'no violation finding anywhere');
      assert.deepStrictEqual(svcMarks(h), [], 'a conditional table review is never marked as a missing/invalid field');
      assert.strictEqual(h.api.LC_SVC.analysis.minimumService.ratingA, 100, 'the 100 A minimum stays independently available');
      // a repeated click cannot resolve the review, and no flag can be set from the panel
      for (let i = 0; i < 3; i++) { assess(h); assert.strictEqual(h.api.LC_SVC.analysis.ungroundedConductors.qualificationConsistency.status, 'review_required'); assert.strictEqual(h.api.LC_SVC.analysis.sourceReview.closed, false); }
      assert.deepStrictEqual(Object.keys(h.api.lcSvcDesignObject()), ['selectedMainRatingA', 'plan', 'conductor']);
    }
  });
  test('>= 100 A changed premise: general 100 A Cu -> 3 (100 A) and 310.12 200 A Cu -> 2/0 (175 A) are revalidation_required, table reference only', () => {
    for (const [rating, pathV, size, amp] of [['100', 'general_table_75C', '3', 100], ['200', 'dwelling_83pct_310_12', '2/0', 175]]) {
      const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', rating); fill(h, COND(pathV, 'Cu')); assess(h);
      const a = assertMatchesDirect(h); const u = a.ungroundedConductors; const q = u.qualificationConsistency;
      assert.strictEqual(q.status, 'revalidation_required'); assert.strictEqual(u.recommendationAvailable, false); assert.strictEqual(u.size, null);
      assert.strictEqual(u.tableCandidate.size, size); assert.strictEqual(u.tableCandidate.ampacity75CA, amp); assert.strictEqual(q.declaredQualificationAmpacityA, 200);
      const t = svcText(h);
      assert.match(t, /Declared premisedifferent — review needed/); assert.match(t, /Update the declaration only when those facts change or need correction, then use Recalculate and Reassess service sizing/);
      assert.ok(t.includes('Declared 220.82(A) qualification ampacity200 ACandidate 75 °C table ampacity' + amp + ' A'), 'side by side');
      assert.ok(t.includes('Conditional table reference — not a selection')); assert.ok(!/Design-preview conductor candidate/.test(t));
      assert.strictEqual(JSON.stringify(h.state().snapshot.optional82.conductorAmpacityA.value), '200', 'the declared premise is never replaced');
    }
  });
  test('a caller revalidates only by editing the Load Calc input: declared 175 A + Recalculate + Reassess -> 310.12 200 A Cu 2/0 premise unchanged', () => {
    const h = b0Calculated({}, { qual: '175' }); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('dwelling_83pct_310_12', 'Cu')); assess(h);
    const a = assertMatchesDirect(h); assert.strictEqual(a.ungroundedConductors.qualificationConsistency.status, 'premise_unchanged'); assert.strictEqual(a.ungroundedConductors.size, '2/0');
    assert.ok(svcText(h).includes('Design-preview conductor candidate (non-operative): Copper (Cu) 2/0 AWG, 75 °C table ampacity 175 A, for the selected 200 A'));
    assert.match(svcText(h), /Module 83 % check of the service ratingsatisfied/);
  });
  test('unsupported design entries give the MODULE refusal (60 / 90 °C terminals, Type MC, 35 °C, 4 CCC, bad number) — marked with its text, never normalized', () => {
    const cases = [['lcSvcTermTemp', '60', 'TERMINATION_60C_UNSUPPORTED'], ['lcSvcTermTemp', '90', 'TERMINATION_TEMP_UNSUPPORTED'], ['lcSvcWiringMethod', 'type_MC_cable', 'WIRING_METHOD_MC_SERVICE_UNSUPPORTED'], ['lcSvcAmbient', '35', 'AMBIENT_UNSUPPORTED'], ['lcSvcCcc', '4', 'CCC_ADJUSTMENT_UNSUPPORTED'], ['lcSvcCcc', '2.5', 'CCC_INVALID']];
    for (const [id, v, code] of cases) {
      const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu')); h.set(id, v); assess(h);
      const a = assertMatchesDirect(h); const r = a.ungroundedConductors.reasons.find((x) => x.code === code); assert.ok(r, id + '=' + v + ' -> ' + code);
      assert.strictEqual(a.ungroundedConductors.status, 'unsupported'); assert.strictEqual(a.ungroundedConductors.tableCandidate, null);
      const el = h.$(id); assert.ok(el._classes.has('lc-svc-invalid')); assert.ok(h.$(el.attrs['aria-describedby'].split(' ')[1]).textContent.includes(r.message), 'the module message, verbatim');
      assert.ok(!/Design-preview conductor candidate|Conditional table reference/.test(svcText(h)));
    }
    const h = b0Calculated(); fill(h, PLAN); const amb = h.$('lcSvcAmbient'); amb.value = 'abc'; amb.dispatch('input'); assess(h);
    const a = assertMatchesDirect(h); assert.strictEqual(a.status, 'DESIGN_INVALID'); assert.strictEqual(a.minimumService.ratingA, null);
    assert.match(svcText(h), /DESIGN INPUT INVALID/); assert.ok(amb._classes.has('lc-svc-invalid')); assert.match(h.$(amb.attrs['aria-describedby'].split(' ')[1]).textContent, /^Invalid entry — conductor\.ambientTempC must be a finite number/);
    assert.strictEqual(h.dom.document.activeElement, amb, 'no minimum reached -> the invalid control receives focus');
  });
});

describe('LC-SERVICE-UI-1 — out of scope, incomplete and faults', () => {
  const unavailable = (h, codes) => {
    assert.strictEqual(h.$('lcSvcControls').style.display, 'none', 'no design controls'); assert.ok(!visible(h.$('lcSvcAssessBtn')));
    const t = svcText(h); assert.match(t, /SERVICE SIZING UNAVAILABLE FOR THIS CALCULATION/); assert.match(t, /not an NEC prohibition/);
    const probe = S.analyzePrototype(h.state().lastRequest, null);
    for (const c of codes) { const r = probe.minimumService.reasons.find((x) => x.code === c); assert.ok(r, c); assert.ok(t.includes(r.message), 'module reason shown: ' + c); }
    assert.ok(!/Minimum standard-rating candidate|Design-preview|Conditional table reference|CALCULATED LOAD/.test(t), t);
    assert.ok(!/\b\d+(\.\d+)? A\b/.test(t), 'no ampere value is guessed: ' + t);
    assert.strictEqual(h.api.lcSvcAssess(), false); assert.strictEqual(h.api.LC_SVC.analysis, null);
  };
  test('120/208 current-only: demand stays COMPLETE with CURRENT — NOT COMPUTED, no red demand error; the panel is an explicit unavailable note', () => {
    const h = b0Calculated({}, { topology: '1ph_3w_120_208_network' });
    const r = h.state().result; assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.current.status, 'not_computed');
    assert.match(h.text(), /Total demand: 23,680 VA/); assert.match(h.text(), /CURRENT — NOT COMPUTED/); assert.ok(!/FIELDS TO SETTLE/.test(h.text()));
    assert.strictEqual(h.nodes().filter((n) => n._classes.has('lc-calc-invalid')).length, 0, 'current-only limits never become red demand errors');
    unavailable(h, ['SUPPLY_UNSUPPORTED', 'CURRENT_NOT_COMPUTED']);
  });
  test('apartment, feeder, PARTIAL and INCOMPLETE are explicit module refusals; the Load Calc result is untouched', () => {
    const apt = buildHarness(); apt.api.lcInit(); driveB0(apt); apt.set('lcOccupancy', 'dwelling_unit_apartment'); apt.set('lcMethod', 'opt_220_82'); calc(apt); unavailable(apt, ['OCCUPANCY_UNSUPPORTED']);
    const fdr = buildHarness(); fdr.api.lcInit(); driveB0(fdr); fdr.set('lcPurpose', 'feeder'); calc(fdr); unavailable(fdr, ['PURPOSE_UNSUPPORTED']);
    const part = buildHarness(); part.api.lcInit(); driveB0(part); addLoad(part, 7, 7200); part.set('lcInventoryComplete', 'yes'); calc(part);
    assert.strictEqual(part.state().result.status, 'PARTIAL'); unavailable(part, ['CALC_NOT_COMPLETE']); assert.match(part.text(), /GENERAL-LOAD SUBTOTAL/);
    const inc = buildHarness(); inc.api.lcInit(); inc.set('lcOccupancy', 'dwelling_unit_house'); inc.set('lcMethod', 'opt_220_82'); calc(inc);
    assert.strictEqual(inc.state().result.status, 'INCOMPLETE_INPUT'); unavailable(inc, ['CALC_NOT_COMPLETE']);
  });
  test('the 220.87 (A) route is unchanged: no panel, one evaluation per edit, no Calculate gate', () => {
    const h = buildHarness(); h.api.lcInit(); let n = h.state().evaluations;
    for (const [id, v] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcReadingValue', '40000'], ['lcNewLoadMode', 'none'], ['lcServiceRatingA', '225'], ['lcServiceOverload', 'yes']]) { h.set(id, v); n++; }
    assert.strictEqual(h.state().evaluations, n); assert.strictEqual(h.state().result.status, 'COMPLETE'); assert.match(h.text(), /Total demand/);
    assert.strictEqual(h.$('lcSvc').style.display, 'none'); assert.strictEqual(svcText(h).replace(/[ |]/g, ''), ''); assert.strictEqual(h.api.lcSvcAssess(), false);
  });
  test('missing module: Load Calc still computes and displays; the panel states the module is not loaded and shows no number', () => {
    const h = b0Calculated({ missing: ['loadCalcServiceSizing'] });
    assert.strictEqual(h.state().fault, null); assert.match(h.text(), /Total demand: 23,680 VA/);
    assert.match(svcText(h), /SERVICE SIZING NOT AVAILABLE IN THIS BUILD/); assert.match(svcText(h), /missing: loadCalcServiceSizing/);
    assert.strictEqual(h.$('lcSvcControls').style.display, 'none'); assert.ok(!NUMBERS_RE.test(svcText(h).replace('Total demand', '')));
    assert.strictEqual(h.api.lcSvcAssess(), false);
  });
  test('a thrown analysis error clears every service number, shows a scoped failure, keeps Load Calc usable; Reassess after recovery clears the old error', () => {
    const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu')); assess(h);
    assert.match(svcText(h), /3\/0 AWG/);
    const real = h.EC.loadCalcServiceSizing; const resultBefore = JSON.stringify(h.state().result);
    h.EC.loadCalcServiceSizing = Object.assign({}, real, { analyzePrototype: (req, d) => { if (d) throw new real.ServiceSizingPrototypeError('injected fault', null); return real.analyzePrototype(req, d); } });
    assess(h);
    const t = svcText(h); assert.match(t, /SERVICE SIZING FAILED/); assert.match(t, /injected fault/); assert.ok(!/3\/0|Minimum standard-rating|CALCULATED LOAD|200 A/.test(t), t);
    assert.strictEqual(h.api.LC_SVC.analysis, null); assert.strictEqual(JSON.stringify(h.state().result), resultBefore); assert.match(h.text(), /Total demand: 23,680 VA/);
    h.set('lcFloorArea', '1500'); assert.strictEqual(h.state().fault, null, 'Load Calc stays usable');
    h.EC.loadCalcServiceSizing = real; assess(h);
    assert.ok(!/SERVICE SIZING FAILED|injected fault/.test(svcText(h)), 'reassessment clears the previous error'); assertMatchesDirect(h); assert.match(svcText(h), /3\/0 AWG/);
    // a fault inside the design-free probe itself (unexpected TypeError) is scoped too
    const g = b0Calculated(); g.EC.loadCalcServiceSizing = Object.assign({}, real, { analyzePrototype: () => { throw new TypeError('probe exploded'); } });
    g.set('lcFloorArea', '1600'); calc(g); assert.match(svcText(g), /SERVICE SIZING FAILED.*probe exploded/); assert.strictEqual(g.$('lcSvcControls').style.display, 'none'); assert.match(g.text(), /Total demand/);
  });
  test('a module result that is not non-operative is refused (never rendered), and a crafted conditional table size is never promoted', () => {
    const real = generatedEC().loadCalcServiceSizing;
    const h = b0Calculated(); fill(h, PLAN);
    h.EC.loadCalcServiceSizing = Object.assign({}, real, { analyzePrototype: (req, d) => { const a = JSON.parse(JSON.stringify(real.analyzePrototype(req, d))); if (d) a.operative = true; return a; } });
    assess(h); assert.match(svcText(h), /SERVICE SIZING FAILED.*not marked non-operative/); assert.ok(!/Minimum standard-rating candidate/.test(svcText(h)));
    // fake analysis: only the module output decides what is shown (proves the renderer holds no table)
    h.EC.loadCalcServiceSizing = Object.assign({}, real, { analyzePrototype: (req, d) => {
      const a = JSON.parse(JSON.stringify(real.analyzePrototype(req, d)));
      if (d) { a.ungroundedConductors = Object.assign({}, a.ungroundedConductors, { status: 'table_candidate_conditional', recommendationAvailable: false, size: null, tableCandidate: { conditional: true, method: 'general_table_75C', table: 'Table 310.16 (75 °C column)', forRatingA: 777, material: 'Cu', size: 'ZZ-TEST', sizeUnit: 'AWG', ampacity75CA: 4321, eightyThreePercentCheck: null, sourceStatus: 'x' }, qualificationConsistency: { status: 'review_required', declaredQualificationAmpacityA: 200, candidateTableAmpacity75CA: 4321, reasons: [], note: 'n' } }); }
      return a;
    } });
    assess(h); const t = svcText(h);
    assert.ok(t.includes('Conditional table reference — not a selection') && t.includes('ZZ-TEST AWG') && t.includes('4321 A') && t.includes('777 A'));
    assert.ok(!/Design-preview conductor candidate/.test(t), 'recommendationAvailable:false + size:null -> never a selection');
  });
});

describe('LC-SERVICE-UI-1 — stale state: load edits, design edits, revert, recalculate', () => {
  const assessed = () => { const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu')); assess(h); assert.match(svcText(h), /3\/0 AWG/); return h; };
  test('any load edit hides minimum / current / table / selection numbers at once with the exact text; revert and main Calculate never resurrect the analysis', () => {
    const h = assessed();
    h.set('lcFloorArea', '1600');
    let t = svcText(h); assert.ok(t.includes(LOAD_STALE)); assert.strictEqual(h.$('lcSvcStatus').textContent, LOAD_STALE);
    assert.ok(!NUMBERS_RE.test(t) && !/3\/0|200 A|100 A/.test(t), t); assert.strictEqual(h.$('lcSvcControls').style.display, 'none', 'selection controls hidden too');
    assert.strictEqual(h.api.LC_SVC.analysis, null); assert.deepStrictEqual(svcMarks(h), []);
    h.set('lcFloorArea', '1500');   // revert: the main result is shown again (unchanged LC-UI-CALCULATE-1 behaviour) ...
    assert.match(h.text(), /Total demand: 23,680 VA/);
    t = svcText(h); assert.ok(!/3\/0|Minimum standard-rating candidate|CALCULATED LOAD/.test(t), '... but the service analysis is NOT resurrected'); assert.match(t, /previous service analysis was removed/);
    assert.strictEqual(h.api.LC_SVC.analysis, null);
    assess(h); assertMatchesDirect(h); assert.match(svcText(h), /3\/0 AWG/);
    calc(h);   // main Recalculate with an identical request still requires a fresh assessment
    assert.strictEqual(h.api.LC_SVC.analysis, null); assert.ok(!/3\/0/.test(svcText(h))); assert.match(svcText(h), /previous service analysis was removed/);
    assert.deepStrictEqual(h.api.lcSvcDesignObject().conductor.material, 'Cu', 'design inputs survive a load edit (only a scope change or reset clears them)');
  });
  test('a load edit on a load card and a PARTIAL/fault transition also clear the analysis', () => {
    const h = assessed(); setIn(ctl(cards(h)[0], 'rating'), '12500'); assert.strictEqual(h.api.LC_SVC.analysis, null); assert.ok(svcText(h).includes(LOAD_STALE));
    const g = assessed(); addLoad(g, 7, 7200); g.set('lcInventoryComplete', 'yes'); calc(g); assert.strictEqual(g.state().result.status, 'PARTIAL'); assert.strictEqual(g.api.LC_SVC.analysis, null); assert.ok(!/3\/0/.test(svcText(g)));
    const f = assessed(); f.store.failNextSet = new Error('quota'); assert.strictEqual(f.api.lcFavSave(), false); assert.ok(f.state().fault); assert.strictEqual(f.api.LC_SVC.analysis, null); assert.ok(!/3\/0|Minimum standard/.test(svcText(f)));
  });
  test('any design edit removes the prior analysis immediately (edit and revert included); the load result is not touched and lcUpdate is not called', () => {
    const h = assessed(); const ev = h.state().evaluations; const resNodes = h.$('lcResult').children.slice(); const resText = h.text(); const f = focusLog(h).focuses.length; const s = focusLog(h).scrolls.length;
    for (const [id, v, back] of [['lcSvcMaterial', 'Al', 'Cu'], ['lcSvcSelectedRating', '225', '200'], ['lcSvcIntent', '', 'new_design_candidate'], ['lcSvcAmbient', '31', '30']]) {
      h.set(id, v); assert.strictEqual(h.api.LC_SVC.analysis, null, id); assert.strictEqual(h.$('lcSvcStatus').textContent, DESIGN_STALE);
      assert.ok(!/3\/0|Minimum standard-rating candidate|Design-preview/.test(svcText(h)), id + ' hides numbers'); assert.ok(svcText(h).includes(DESIGN_STALE));
      h.set(id, back); assert.strictEqual(h.api.LC_SVC.analysis, null, 'a revert does not resurrect'); assess(h); assertMatchesDirect(h);
    }
    assert.strictEqual(h.state().evaluations, ev, 'no lcUpdate / facade call for design controls');
    assert.deepStrictEqual(h.$('lcResult').children, resNodes, 'the Load Calc result DOM is untouched'); assert.strictEqual(h.text(), resText);
    assert.strictEqual(focusLog(h).focuses.length, f, 'no auto-focus on edits or on a successful assessment'); assert.strictEqual(focusLog(h).scrolls.length, s, 'no auto-scroll');
  });
});

describe('LC-SERVICE-UI-1 — clearing: reset, restore, route, scope', () => {
  const blankControls = (h) => { for (const id of Object.values(IDS)) assert.strictEqual(h.$(id).value, '', id); assert.deepStrictEqual(h.api.lcSvcDesignObject(), BLANK_DESIGN); assert.strictEqual(h.api.LC_SVC.analysis, null); assert.strictEqual(h.api.LC_SVC.error, null); assert.strictEqual(h.api.LC_SVC.attempted, false); assert.deepStrictEqual(svcMarks(h), []); };
  const assessedWithError = (opts) => { const h = b0Calculated(opts); fill(h, PLAN); h.set('lcSvcTermTemp', '60'); h.set('lcSvcSelectedRating', '200'); assess(h); assert.ok(svcMarks(h).length); return h; };
  test('Reset clears design inputs, results, marks and the attempted state', () => {
    const h = assessedWithError(); h.api.lcReset(); blankControls(h); assert.strictEqual(h.$('lcSvc').style.display, 'none');
    h.set('lcMethod', 'opt_220_82'); assert.match(svcText(h), /Press Calculate first/); assert.strictEqual(h.$('lcSvcAssessBtn').textContent, 'Assess service sizing');
  });
  test('preset restore clears them (same and fresh document); Save/Restore bytes are identical with and without service state', () => {
    const a = buildHarness({ promptAnswer: 'B0' }); a.api.lcInit(); driveB0(a); calc(a);
    const b = assessedWithError({ promptAnswer: 'B0' });
    assert.strictEqual(JSON.stringify(b.api.lcFavPayload()), JSON.stringify(a.api.lcFavPayload()), 'payload bytes unchanged by service state');
    assert.strictEqual(a.api.lcFavSave(), true); assert.strictEqual(b.api.lcFavSave(), true);
    const va = JSON.stringify(JSON.parse(a.store.data).lc[0].vals); const vb = JSON.stringify(JSON.parse(b.store.data).lc[0].vals); assert.strictEqual(vb, va);
    assert.ok(!/lcSvc|selectedMainRatingA|sizingPath|terminationTempRatingC|new_design_candidate|analyzePrototype|SERVICE SIZING/.test(b.store.data), 'no design state in storage');
    assert.deepStrictEqual(Object.keys(b.api.lcDraft()).sort(), ['context', 'fieldErrors', 'loadErrors', 'snapshot', 'sourceFavId']);
    assert.ok(!/lcSvc|selectedMainRatingA|sizingPath|LC_SVC/.test(JSON.stringify(b.state())), 'lcExportState carries no design state');
    b.$('lc-fav-list').querySelectorAll('.fav-item')[0].dispatch('click'); blankControls(b); assert.match(svcText(b), /Press Calculate first/);
    const c = buildHarness({ storage: b.store.data }); c.api.lcInit(); c.$('lc-fav-list').querySelectorAll('.fav-item')[0].dispatch('click'); calc(c); blankControls(c); assert.strictEqual(c.$('lcSvcControls').style.display, '');
  });
  test('leaving and re-entering opt_220_82 clears everything; an explicit scope change (occupancy / purpose / topology) clears it too', () => {
    const h = assessedWithError(); h.set('lcMethod', 'measured_220_87'); blankControls(h); h.set('lcMethod', 'opt_220_82'); blankControls(h); assert.match(svcText(h), /Press Calculate first/);
    for (const [id, v, back] of [['lcPurpose', 'feeder', 'service'], ['lcTopology', '1ph_3w_120_208_network', '1ph_3w_120_240']]) {
      const g = assessedWithError(); g.set(id, v); blankControls(g); g.set(id, back); calc(g); blankControls(g); assert.strictEqual(g.$('lcSvcControls').style.display, '');
    }
  });
});

describe('LC-SERVICE-UI-1 — no mutation, no override, no duplicated engineering', () => {
  test('assessment never mutates the snapshot, the request, the Load Calc result or its not_assessed B82 capacity/rating objects', () => {
    const h = b0Calculated(); const snap = JSON.stringify(h.state().snapshot); const req = JSON.stringify(h.state().lastRequest); const res = JSON.stringify(h.state().result); const ev = h.state().evaluations;
    fill(h, PLAN); h.set('lcSvcSelectedRating', '100'); fill(h, COND('dwelling_83pct_310_12', 'Cu')); assess(h); assess(h);
    assert.strictEqual(JSON.stringify(h.state().snapshot), snap); assert.strictEqual(JSON.stringify(h.state().lastRequest), req); assert.strictEqual(JSON.stringify(h.state().result), res); assert.strictEqual(h.state().evaluations, ev);
    const r = h.state().result; assert.strictEqual(r.existingCapacity.status, 'not_assessed'); assert.match(h.text(), /EXISTING CAPACITY — NOT ASSESSED/);
    assert.ok(Object.isFrozen(h.api.LC_SVC.analysis), 'the rendered object is the module\'s deep-frozen result');
  });
  test('the adapter holds no sizing formula, table, threshold, storage or second evaluation path', () => {
    const src = adapterSource(); const i = src.indexOf('// ── LC-SERVICE-UI-1: SERVICE SIZING'); const j = src.indexOf('// ── Favorites (LC branch', i); assert.ok(i > 0 && j > i);
    const block = src.slice(i, j);
    for (const bad of [/\[\s*100\s*,\s*110/, /\b0\.83\b/, /\b83\s*\*/, /\*\s*240|240\s*\*/, /\/ 240\b/, /\b1e4\b|\bE4\b/, /TABLE_310_16_75C|TABLE_310_12(?!_CANDIDATE)/, /'3\/0'|'2\/0'|'4\/0'/, /\b(85|115|130|175|255)\b/, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/, /loadCalcFacade\.evaluateV2|\.evaluate\(/, /Math\./, /innerHTML/, /recommended/i, /enableProduction|sourceVerified|interpretationAccepted|qualificationRevalidated|installationApproved\s*[:=]\s*true|operative\s*[:=]\s*true/]) assert.ok(!bad.test(block), 'service block must not contain ' + bad);
    assert.strictEqual((block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').match(/\.analyzePrototype\(/g) || []).length, 2, 'the module API is the only analysis path (probe + assessment)');
    assert.ok(/STANDARD_RATINGS_SUBSET/.test(block), 'ratings come from the module');
    assert.strictEqual((src.match(/loadCalcFacade\.evaluateV2\(/g) || []).length, 1, 'still exactly one facade call site in the adapter');
  });
  test('every service control is a native labelled control with >= 16px policy intact (no inline font size, zoom lock or input opacity)', () => {
    const h = b0Calculated();
    for (const el of h.$('lcSvc').querySelectorAll('select, input, button')) {
      assert.ok(!/font-size|opacity|zoom/.test(el.style.cssText || ''), el.id + ' inline style ' + el.style.cssText);
      if (el.tagName === 'BUTTON') { assert.strictEqual(el.attrs.type, 'button'); assert.ok(el.textContent.length > 5, 'visible English text'); }
    }
    const css = html.slice(html.indexOf('/* LC-SERVICE-UI-1: service sizing design preview.'), html.indexOf('</style>', html.indexOf('/* LC-SERVICE-UI-1: service sizing design preview.')));
    assert.ok(css.length > 100); for (const line of css.split('\n').filter((l) => l.startsWith('#'))) assert.ok(line.startsWith('#lcContent '), 'scoped: ' + line);
    assert.ok(!/opacity|zoom|user-scalable|font-size:\s*1[0-5]px[^}]*\b(select|input)\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no opacity/zoom on fields');
    assert.match(css, /min-width: 0/); assert.match(css, /overflow-wrap: anywhere/);
    const iHov = html.indexOf('select, input, button, textarea { max-width: 100%; min-width: 0; box-sizing: border-box; }'); assert.ok(iHov > 0 && iHov < html.indexOf('/* LC-SERVICE-UI-1: service sizing design preview.'), 'MOBILE-HOV-1 cap precedes the new scoped rules');
  });
  test('reference links use the shared source-aware helper: one reference click sends one prepared NEC question, no other call', () => {
    const h = b0Calculated(); fill(h, PLAN); assess(h);
    const refs = h.$('lcSvcResult').querySelectorAll('span').filter((s) => s.attrs['data-ref']);
    assert.ok(refs.length > 3); const r = refs.find((x) => x.attrs['data-sec'] === '230.79(C)'); assert.ok(r, '230.79(C) target');
    assert.strictEqual(r.attrs['data-src'], 'nec'); assert.strictEqual(r.attrs.role, 'button'); assert.strictEqual(r.attrs.tabindex, '0');
    const before = h.necCalls.length; r.dispatch('click'); assert.strictEqual(h.necCalls.length, before + 1);
    assert.match(h.necCallsFull.slice(-1)[0].question, /NEC 2020.*230\.79\(C\)/);
  });
});
