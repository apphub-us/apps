'use strict';
/**
 * LC-SERVICE-UI-CLEANUP-1 — results presentation of the SERVICE SIZING — DESIGN PREVIEW panel (docs/load-calc-service-ui-1.md §2a).
 *
 * The default view keeps the load, the minimum candidate, the selected rating, the candidate / conditional conductor result,
 * the qualification check, every active problem and a concise limits summary. Supplementary text (module comparison, raw
 * meaning strings, informational reason rows, full conditions, source status, the full remainingChecks / notSized /
 * openInterpretation arrays and the operative/installationApproved flags) moves into ONE native disclosure labelled
 * "Calculation details & sources" (type=button + aria-expanded/aria-controls + a hidden region).
 *
 * "Default-visible" text is computed from the DOM with hidden subtrees excluded (hidden attribute or display:none), so these
 * tests stay meaningful while the disclosure is closed; whole textContent is used only to prove that nothing was deleted.
 * Runs the shipped adapter in the Node DOM harness (test/helpers/loadCalcDom.js); every analysis is compared with the R2 source
 * module called directly. Not a native browser run: keyboard/visual behaviour in a real browser is a separate gate.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildHarness, adapterSource, html } = require('./helpers/loadCalcDom.js');
const S = require('../src/calc/loadCalcServiceSizing.js');

const LABEL = 'Calculation details & sources';
const DETAIL_CODES = ['STANDARD_RATING_CANDIDATE', 'SELECTED_AT_OR_ABOVE_MINIMUM', 'TABLE_310_16_CANDIDATE', 'TABLE_310_12_CANDIDATE', 'QUALIFICATION_PREMISE_UNCHANGED', 'QUALIFICATION_PREMISE_CHANGED', 'B82_310_12_INTERPRETATION_PENDING'];
const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const ctl = (card, role) => card.querySelectorAll('input, select, button').filter((e) => e.attrs['data-role'] === role)[0];
const setIn = (el, v) => { el.value = v; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
const addLoad = (h, preset, va) => { h.$('lcPresetName').value = String(preset); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click'); };
const calc = (h) => h.$('lcCalcBtn').dispatch('click');
const assess = (h) => h.$('lcSvcAssessBtn').dispatch('click');
const focusLog = (h) => h.dom.document.focusLog;
const PLAN = [['lcSvcIntent', 'new_design_candidate'], ['lcSvcOneMainDisconnect', 'yes'], ['lcSvcNoAdditionalSources', 'yes'], ['lcSvcWholeDwelling', 'yes'], ['lcSvcSingleConductorSet', 'yes']];
const COND = (pathV, material) => [['lcSvcSizingPath', pathV], ['lcSvcMaterial', material], ['lcSvcTermTemp', '75'], ['lcSvcTermCompatible', 'yes'], ['lcSvcInsulTemp', '75'], ['lcSvcAmbient', '30'], ['lcSvcCcc', '3'], ['lcSvcWiringMethod', 'single_insulated_conductors_in_raceway'], ['lcSvcNoOtherAdj', 'yes']];
const NINE = ['lcSvcSizingPath', 'lcSvcMaterial', 'lcSvcTermTemp', 'lcSvcTermCompatible', 'lcSvcInsulTemp', 'lcSvcAmbient', 'lcSvcCcc', 'lcSvcWiringMethod', 'lcSvcNoOtherAdj'];
const fill = (h, pairs) => { for (const [id, v] of pairs) h.set(id, v); };
const markIds = (h) => h.nodes().filter((n) => n._classes.has('lc-svc-invalid')).map((n) => n.id);

/** the accepted B0 dwelling (23,680 VA, 98.7 A, declared qualification 200 A) entered through the real controls */
function driveB0(h, o) {
  const p = Object.assign({ topology: '1ph_3w_120_240', qual: '200', ac: 5000 }, o || {});
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', p.topology); h.set('lcModel', 'split_240_balanced_LN'); h.set('lcDeclBalancedLN', 'yes');
  h.set('lcFloorArea', '1500'); h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '1'); h.set('lcNycAcCircuits', '0');
  h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); h.set('lcConductorAmpacity', p.qual); h.set('lcNycAcException', 'yes');
  for (const [preset, va] of [[0, 12000], [3, 4500], [1, 5000], [2, 1200], [4, p.ac]]) addLoad(h, preset, va);
  setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit');
  setIn(ctl(cards(h)[3], 'inclusion'), 'fixed_or_permanently_connected');
  setIn(ctl(cards(h)[4], 'coverage'), 'yes');
  h.set('lcInventoryComplete', 'yes');
}
function b0Calculated(opts, o) { const h = buildHarness(opts); h.api.lcInit(); driveB0(h, o); calc(h); return h; }
function assessed(rating, pathV, mat, opts) { const h = b0Calculated(opts); fill(h, PLAN); if (rating) h.set('lcSvcSelectedRating', rating); if (pathV) fill(h, COND(pathV, mat)); assess(h); return h; }

/** hidden = the `hidden` attribute or display:none on the element or any ancestor inside #lcContent */
const isHidden = (el) => el.attrs.hidden !== undefined || (el.style && el.style.display === 'none');
const isShown = (el) => { for (let n = el; n; n = n.parent) { if (n.tagName && n.tagName !== '#text' && isHidden(n)) return false; if (n.id === 'lcContent') return true; } return false; };
const shownText = (el) => (el.tagName === '#text' ? el._text : isHidden(el) ? '' : el.children.map(shownText).join(''));
/** what the panel shows as state/result WITHOUT opening the disclosure */
const defaultText = (h) => ['lcSvcGate', 'lcSvcStatus', 'lcSvcResult'].map((id) => shownText(h.$(id))).join(' | ');
/** the disclosure currently attached to the panel (the harness id map can still hold detached nodes) */
const disclosureBtns = (h) => h.$('lcSvc').querySelectorAll('button').filter((b) => b.textContent === LABEL || b._classes.has('lc-svc-details-btn'));
const detailsOf = (h) => { const b = disclosureBtns(h); assert.strictEqual(b.length, 1, 'exactly one disclosure'); const r = h.$(b[0].attrs['aria-controls']); assert.ok(r && h.$('lcSvc').contains(r), 'controlled region attached'); return { btn: b[0], region: r }; };
const direct = (h) => S.analyzePrototype(h.state().lastRequest, h.api.lcSvcDesignObject());
const allReasons = (a) => [].concat(a.designProblems || [], a.minimumService.reasons, a.chosenMain.reasons, a.ungroundedConductors.reasons, a.ungroundedConductors.qualificationConsistency ? a.ungroundedConductors.qualificationConsistency.reasons : []);
function assertMatchesDirect(h) {
  const shown = h.api.LC_SVC.analysis; assert.ok(shown, 'an analysis is held');
  assert.strictEqual(JSON.stringify(shown), JSON.stringify(direct(h)), 'the rendered analysis is exactly the R2 module return');
  assert.strictEqual(shown.operative, false); assert.strictEqual(shown.installationApproved, false);
  return shown;
}
/** every refusal / missing / unknown reason is in the DEFAULT view; every reason message (incl. informational) is still in the panel */
function assertReasonsPlaced(h, a) {
  const vis = defaultText(h); const all = h.$('lcSvcResult').textContent;
  for (const r of allReasons(a)) {
    assert.ok(all.includes(String(r.message)), 'never deleted: ' + r.code);
    if (DETAIL_CODES.indexOf(r.code) === -1) assert.ok(vis.includes(String(r.message)), 'active/unknown reason visible without opening details: ' + r.code);
  }
}
/** default view: the always-visible preview banner, scope, not-saved warning and the concise limits summary */
function assertHeaderAndLimits(h) {
  const t = shownText(h.$('lcSvc'));
  assert.ok(t.includes('ENGINEERING PREVIEW — NOT INSTALLATION APPROVAL')); assert.match(t, /one-family dwelling service, single-phase 120\/240 V/);
  assert.ok(t.includes('Service design settings are not saved with calculation presets.'));
  const lim = h.$('lcSvcResult').querySelectorAll('.lc-svc-limits')[0]; assert.ok(lim && isShown(lim), 'limits summary shown');
  const lt = shownText(lim);
  assert.match(lt, /REMAINING CHECKS — NOT COMPLETED HERE/); assert.match(lt, /Ungrounded conductors only\. NOT completed by this preview/);
  for (const w of ['neutral', 'grounding and bonding', 'voltage drop', 'short-circuit', 'equipment, device and listing', 'utility requirements', 'NYC service wiring-method', 'site verification']) assert.ok(lt.includes(w), 'limits name: ' + w);
  assert.match(lt, /does not mean they were checked/); assert.ok(!/\bcompleted\b(?! by this preview| here)/i.test(lt.replace(/NOT completed/g, '')), 'never claims a check was completed');
}

const SCENARIOS = [
  // [label, rating, path, material, size, amp, qualification status, recommendationAvailable]
  ['general 100 A Cu', '100', 'general_table_75C', 'Cu', '3', 100, 'revalidation_required', false],
  ['dwelling 100 A Cu', '100', 'dwelling_83pct_310_12', 'Cu', '4', 85, 'review_required', false],
  ['dwelling 200 A Cu', '200', 'dwelling_83pct_310_12', 'Cu', '2/0', 175, 'revalidation_required', false],
  ['general 200 A Cu', '200', 'general_table_75C', 'Cu', '3/0', 200, 'premise_unchanged', true]
];

describe('LC-SERVICE-UI-CLEANUP-1 — A. acceptance scenarios: same module return, compact default view', () => {
  for (const [label, rating, pathV, mat, size, amp, qstatus, rec] of SCENARIOS) {
    test(label + ' -> ' + size + ' AWG / ' + amp + ' A, ' + qstatus + ' (200 vs ' + amp + '), preview only', () => {
      const h = assessed(rating, pathV, mat); const a = assertMatchesDirect(h); const u = a.ungroundedConductors; const q = u.qualificationConsistency;
      assert.strictEqual(u.tableCandidate.size, size); assert.strictEqual(u.tableCandidate.ampacity75CA, amp); assert.strictEqual(q.status, qstatus);
      assert.strictEqual(q.declaredQualificationAmpacityA, 200); assert.strictEqual(q.candidateTableAmpacity75CA, amp); assert.strictEqual(u.recommendationAvailable, rec);
      const { btn, region } = detailsOf(h); assert.strictEqual(btn.attrs['aria-expanded'], 'false'); assert.ok(!isShown(region), 'details closed after an assessment');
      const t = defaultText(h);
      // load, minimum, selected rating
      for (const s of ['CALCULATED LOAD', '23,680 VA', '98.7 A', '220.82 Optional', 'Minimum standard-rating candidate: 100 A', 'not an approved main breaker', 'Selected main rating — design input' + rating + ' A', 'At or above the minimum candidate']) assert.ok(t.includes(s), 'visible: ' + s);
      // conductor result: material/size, 75 °C ampacity, selected rating, path/table — once
      const refs = h.$('lcSvcResult').querySelectorAll('.lc-svc-ref').filter(isShown); assert.strictEqual(refs.length, 1, 'one conductor result block, not two copies');
      const rt = shownText(refs[0]);
      assert.ok(rt.includes(size + ' AWG') && rt.includes(amp + ' A') && rt.includes(rating + ' A'), rt);
      assert.match(rt, pathV === 'general_table_75C' ? /Table 310\.16 \(75 °C column\).*General path — Table 310\.16, 75 °C column/ : /Table 310\.12.*Conditional dwelling path — Table 310\.12/);
      assert.strictEqual(t.split(size + ' AWG').length - 1, 1, 'the size appears once in the default view');
      if (rec) {
        assert.ok(rt.includes('Design-preview conductor candidate (non-operative): Copper (Cu) ' + size + ' AWG, 75 °C table ampacity ' + amp + ' A, for the selected ' + rating + ' A'));
        assert.match(t, /Not an installation instruction or a verified selection/); assert.ok(!t.includes('Conditional table reference'));
      } else {
        assert.ok(refs[0]._classes.has('lc-svc-ref-only')); assert.strictEqual(refs[0].children[0].textContent, 'Conditional table reference — not a selection', 'the label heads the block that holds the size');
        assert.ok(!/Design-preview conductor candidate/.test(h.$('lcSvcResult').textContent), 'never promoted, not even inside details');
      }
      assert.match(t, /Lookup conditions, as entered \(never inferred\): terminations 75 °C · insulation 75 °C · ambient 30 °C · 3 current-carrying conductors · 1 conductor set\(s\)/);
      // qualification: both values side by side, distinct status, actionable explanation
      const cells = h.$('lcSvcResult').querySelectorAll('.lc-svc-cell').filter(isShown).map((c) => c.textContent);
      assert.deepStrictEqual(cells, ['Declared 220.82(A) qualification ampacity200 A', 'Candidate 75 °C table ampacity' + amp + ' A']);
      if (qstatus === 'premise_unchanged') { assert.match(t, /Ampacity thresholdmet in the current model/); assert.match(t, /Declared premiseunchanged/); assert.match(t, /Model premise unchanged — not installation approval\./); }
      if (qstatus === 'revalidation_required') { assert.match(t, /Ampacity thresholdmet in the current model/); assert.match(t, /Declared premisedifferent — review needed/); assert.match(t, /Update the declaration only when those facts change or need correction, then use Recalculate and Reassess service sizing/); assert.match(t, /This is NOT an NEC violation finding/); }
      if (qstatus === 'review_required') { assert.match(t, /Review required — open model interpretation/); assert.match(t, /NOT an NEC violation finding, and reassessing does not resolve it/); }
      assert.ok(!/(?<!NOT an NEC )violation/i.test(t), 'no violation finding');
      // diagnostics only behind the disclosure
      for (const s of ['totalExactE4', 'Module comparison', 'Meaning:', 'operative: false', 'installation approved: false', 'Module note:', 'Source status', 'source status', 'Rule: ', 'Not sized here:']) assert.ok(!t.includes(s), 'not in the default view: ' + s);
      const all = h.$('lcSvcResult').textContent;
      for (const s of ['Module comparison: totalExactE4', 'Meaning: minimum STANDARD service-disconnect rating candidate', 'operative: false · installation approved: false', 'Module note: ', 'Table reference source status: ', 'Conditions of this table lookup', 'Not sized here: ']) assert.ok(all.includes(s), 'kept in details: ' + s);
      assertReasonsPlaced(h, a); assertHeaderAndLimits(h);
    });
  }
  test('the full supplied remainingChecks, notSized and openInterpretation arrays are inside the details, item by item', () => {
    const h = assessed('200', 'dwelling_83pct_310_12', 'Cu'); const a = assertMatchesDirect(h); const { region } = detailsOf(h);
    const lis = region.querySelectorAll('li').map((l) => l.textContent);
    for (const s of a.remainingChecks) assert.ok(lis.includes(s), 'remaining check: ' + s);
    for (const s of a.sourceReview.openInterpretation) assert.ok(lis.includes(s), 'open item: ' + s);
    const nt = region.textContent; for (const s of a.ungroundedConductors.notSized) assert.ok(nt.includes(s), 'not sized: ' + s);
    assert.ok(nt.includes(a.sourceReview.warning)); assert.ok(nt.includes(a.ungroundedConductors.conditions.wiringMethodNote)); assert.ok(nt.includes(a.ungroundedConductors.conditions.rule));
    assert.ok(nt.includes('Declared 220.82(A) conductor ampacity — qualification only200 A'), 'the moved declared-ampacity line is still inspectable');
    assert.match(defaultText(h), /Open model-interpretation items: 4\./);
  });
});

describe('LC-SERVICE-UI-CLEANUP-1 — B. problems stay outside the closed disclosure', () => {
  test('minimum available while the selected rating is missing: minimum, waiting note and the missing-choice reason are visible', () => {
    const h = assessed(null, null); const a = assertMatchesDirect(h);
    assert.strictEqual(a.minimumService.ratingA, 100); assert.strictEqual(a.chosenMain.status, 'waiting_input');
    const t = defaultText(h); assert.ok(t.includes('Minimum standard-rating candidate: 100 A')); assert.match(t, /SELECTED MAIN RATING.*not chosen/); assert.match(t, /Waiting for your choice/);
    assert.ok(a.chosenMain.reasons.some((r) => r.code === 'SELECTED_RATING_MISSING')); assertReasonsPlaced(h, a); assertHeaderAndLimits(h);
  });
  test('a chosen rating below the minimum: undersized warning and the module reason are visible; nothing is adjusted', () => {
    const h = assessed('100', null, null, undefined); // B0 floor case is not undersized; use the larger A/C below
    const g = buildHarness(); g.api.lcInit(); driveB0(g, { ac: 30000 }); calc(g); fill(g, PLAN); g.set('lcSvcSelectedRating', '100'); assess(g);
    const a = assertMatchesDirect(g); assert.strictEqual(a.chosenMain.status, 'rejected_undersized');
    const t = defaultText(g); assert.match(t, /Below the minimum standard-rating candidate \(\d+ A\)\. Nothing is adjusted automatically/); assert.match(t, /Governed by the calculated load/);
    assert.ok(a.chosenMain.reasons.some((r) => r.code === 'SELECTED_RATING_UNDERSIZED')); assertReasonsPlaced(g, a);
    assert.strictEqual(assertMatchesDirect(h).chosenMain.status, 'meets_prototype_minimum');
  });
  test('refused / incomplete design values (60 °C, 35 °C, Type MC, unknown answer, invalid number): every module reason visible while details are closed', () => {
    for (const [id, v] of [['lcSvcTermTemp', '60'], ['lcSvcAmbient', '35'], ['lcSvcWiringMethod', 'type_MC_cable'], ['lcSvcTermCompatible', ''], ['lcSvcCcc', '4']]) {
      const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu')); h.set(id, v); assess(h);
      const a = assertMatchesDirect(h); assert.ok(a.ungroundedConductors.reasons.length > 0, id); assert.ok(a.ungroundedConductors.reasons.every((r) => DETAIL_CODES.indexOf(r.code) === -1), id + ': refusals only');
      assertReasonsPlaced(h, a); assert.ok(h.$(id)._classes.has('lc-svc-invalid'), id + ' still marked');
      assert.ok(!/Design-preview conductor candidate|Conditional table reference/.test(defaultText(h)));
    }
    const h = b0Calculated(); fill(h, PLAN); const amb = h.$('lcSvcAmbient'); amb.value = 'abc'; amb.dispatch('input'); assess(h);
    const a = assertMatchesDirect(h); assert.strictEqual(a.status, 'DESIGN_INVALID'); assert.match(defaultText(h), /DESIGN INPUT INVALID/); assertReasonsPlaced(h, a);
  });
  test('incomplete and out-of-scope requests: the module refusal reasons are visible and no disclosure or number exists', () => {
    const cases = [
      () => { const g = buildHarness(); g.api.lcInit(); g.set('lcOccupancy', 'dwelling_unit_house'); g.set('lcMethod', 'opt_220_82'); calc(g); return g; },
      () => { const g = buildHarness(); g.api.lcInit(); driveB0(g); g.set('lcOccupancy', 'dwelling_unit_apartment'); g.set('lcMethod', 'opt_220_82'); calc(g); return g; },
      () => { const g = buildHarness(); g.api.lcInit(); driveB0(g); g.set('lcPurpose', 'feeder'); calc(g); return g; },
      () => b0Calculated({}, { topology: '1ph_3w_120_208_network' })
    ];
    for (const mk of cases) {
      const g = mk(); const probe = S.analyzePrototype(g.state().lastRequest, null); const t = defaultText(g);
      assert.match(t, /SERVICE SIZING UNAVAILABLE FOR THIS CALCULATION/);
      const blocking = probe.minimumService.reasons.filter((r) => r.code !== 'PREMISE_UNANSWERED'); assert.ok(blocking.length);
      for (const r of blocking) assert.ok(t.includes(r.message), 'refusal visible: ' + r.code);
      assert.strictEqual(disclosureBtns(g).length, 0); assert.ok(!/\b\d+(\.\d+)? A\b/.test(t), t);
    }
  });
  test('runtime failures (thrown error, not-non-operative return) are visible; no disclosure or old detail survives', () => {
    const h = assessed('200', 'general_table_75C', 'Cu'); detailsOf(h).btn.dispatch('click');
    const real = h.EC.loadCalcServiceSizing;
    h.EC.loadCalcServiceSizing = Object.assign({}, real, { analyzePrototype: (req, d) => { if (d) throw new real.ServiceSizingPrototypeError('injected fault', null); return real.analyzePrototype(req, d); } });
    assess(h); let t = defaultText(h); assert.match(t, /SERVICE SIZING FAILED/); assert.match(t, /injected fault/);
    assert.strictEqual(disclosureBtns(h).length, 0); assert.ok(!/Module comparison|3\/0|totalExactE4|Remaining checks — full list/.test(shownText(h.$('lcSvc')) + h.$('lcSvcResult').textContent));
    h.EC.loadCalcServiceSizing = Object.assign({}, real, { analyzePrototype: (req, d) => { const a = JSON.parse(JSON.stringify(real.analyzePrototype(req, d))); if (d) a.installationApproved = true; return a; } });
    assess(h); t = defaultText(h); assert.match(t, /SERVICE SIZING FAILED.*not marked non-operative/); assert.strictEqual(disclosureBtns(h).length, 0);
  });
  test('an unrecognized reason code is never hidden, in any stage (fake module output)', () => {
    const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu'));
    const real = h.EC.loadCalcServiceSizing; const extra = (st) => ({ stage: st, code: 'FUTURE_UNKNOWN_' + st.toUpperCase(), field: null, sourceIds: [], sections: [], message: 'zz unknown reason for ' + st + ' zz' });
    h.EC.loadCalcServiceSizing = Object.assign({}, real, { analyzePrototype: (req, d) => {
      const a = JSON.parse(JSON.stringify(real.analyzePrototype(req, d))); if (!d) return a;
      a.minimumService.reasons.push(extra('minimumService')); a.chosenMain.reasons.push(extra('chosenMain')); a.ungroundedConductors.reasons.push(extra('ungroundedConductors')); a.ungroundedConductors.qualificationConsistency.reasons.push(extra('qualification'));
      return a;
    } });
    assess(h); const t = defaultText(h);
    for (const st of ['minimumService', 'chosenMain', 'ungroundedConductors', 'qualification']) assert.ok(t.includes('zz unknown reason for ' + st + ' zz'), st);
    assert.ok(!t.includes('candidate 75 °C table ampacity 200 A equals the declared qualification ampacity 200 A'), 'the known qualification duplicate (module diagnostic) still moved into details');
    assert.ok(h.$('lcSvcResult').textContent.includes('candidate 75 °C table ampacity 200 A equals the declared qualification ampacity 200 A'), '... and is still inspectable there');
  });
});

describe('LC-SERVICE-UI-CLEANUP-1 — C/D. the disclosure: native, labelled, inert', () => {
  test('one native type=button, exact label, aria-expanded/aria-controls, a hidden labelled region, last in the result and scoped to the panel', () => {
    const h = assessed('100', 'dwelling_83pct_310_12', 'Cu'); const { btn, region } = detailsOf(h);
    assert.strictEqual(btn.tagName, 'BUTTON'); assert.strictEqual(btn.attrs.type, 'button'); assert.strictEqual(btn.textContent, LABEL); assert.strictEqual(btn.children.length, 1, 'text only: the accessible name is exactly the label');
    assert.strictEqual(btn.attrs['aria-expanded'], 'false'); assert.strictEqual(btn.attrs['aria-controls'], region.id); assert.strictEqual(region.attrs.hidden, '');
    assert.strictEqual(region.attrs.role, 'region'); assert.strictEqual(region.attrs['aria-labelledby'], btn.id);
    assert.strictEqual(btn.parent, region.parent); const wrap = btn.parent; assert.ok(wrap._classes.has('lc-svc-details'));
    assert.strictEqual(h.$('lcSvcResult').children[h.$('lcSvcResult').children.length - 1], wrap, 'full-width row after the result boxes');
    assert.ok(h.$('lcSvcResult').contains(wrap)); assert.ok(!h.$('lcResult').contains(wrap));
    assert.strictEqual(h.nodes().filter((n) => n.tagName === 'BUTTON' && n.textContent === LABEL).length, 1);
    assert.strictEqual(btn.listeners.keydown, undefined, 'no custom keyboard handler: Enter/Space are the native button activation');
    assert.ok(isShown(btn));
  });
  test('opening and closing change only the two attributes: no evaluation, analysis, design, marks, storage, focus or scroll change', () => {
    const h = assessed('100', 'general_table_75C', 'Cu'); h.set('lcSvcTermTemp', '75');   // a design edit then Reassess so marks/notice paths are exercised
    assess(h); const { btn, region } = detailsOf(h);
    const snap = () => ({ an: h.api.LC_SVC.analysis, design: JSON.stringify(h.api.lcSvcDesignObject()), att: h.api.LC_SVC.attempted, notice: h.api.LC_SVC.notice, err: h.api.LC_SVC.error, marks: markIds(h).join(), ev: h.state().evaluations, state: JSON.stringify(h.state()), sets: h.store.sets, data: h.store.data, foc: focusLog(h).focuses.length, scr: focusLog(h).scrolls.length, act: h.dom.document.activeElement, nec: h.necCalls.length, status: h.$('lcSvcStatus').textContent, res: h.text(), btnLabel: h.$('lcSvcAssessBtn').textContent });
    const before = snap();
    btn.dispatch('click'); assert.strictEqual(btn.attrs['aria-expanded'], 'true'); assert.strictEqual(region.attrs.hidden, undefined); assert.ok(isShown(region));
    let after = snap(); for (const k of Object.keys(before)) assert.strictEqual(after[k], before[k], 'open changed ' + k);
    assert.ok(defaultText(h).includes('totalExactE4'), 'opened: diagnostics readable');
    btn.dispatch('click'); assert.strictEqual(btn.attrs['aria-expanded'], 'false'); assert.strictEqual(region.attrs.hidden, ''); assert.ok(!defaultText(h).includes('totalExactE4'));
    after = snap(); for (const k of Object.keys(before)) assert.strictEqual(after[k], before[k], 'close changed ' + k);
    assert.strictEqual(h.api.LC_SVC.analysis, before.an, 'the same frozen analysis object');
  });
  test('source references inside the opened details keep the shared activation (click and Enter: one prepared NEC question each)', () => {
    const h = assessed('200', 'general_table_75C', 'Cu'); const { btn, region } = detailsOf(h); btn.dispatch('click');
    const refs = region.querySelectorAll('span').filter((s) => s.attrs['data-ref']); assert.ok(refs.length >= 8, 'informational reason rows keep their source links');
    const r = refs.find((x) => x.attrs['data-sec'] === '240.6(A)'); assert.ok(r); assert.strictEqual(r.attrs['data-src'], 'nec'); assert.strictEqual(r.attrs.role, 'button'); assert.strictEqual(r.attrs.tabindex, '0');
    let n = h.necCalls.length; r.dispatch('click'); assert.strictEqual(h.necCalls.length, n + 1); assert.match(h.necCallsFull.slice(-1)[0].question, /NEC 2020.*240\.6\(A\)/);
    n = h.necCalls.length; r.dispatch('keydown', { key: 'Enter' }); assert.strictEqual(h.necCalls.length, n + 1);
    const outside = h.$('lcSvcResult').querySelectorAll('span').filter((s) => s.attrs['data-sec'] === '230.79(C)' && isShown(s) && !region.contains(s));
    assert.ok(outside.length >= 1, 'the governing reference stays visible next to the minimum');
    assert.strictEqual(btn.attrs['aria-expanded'], 'true', 'activating a reference does not toggle the disclosure');
  });
  test('a new assessment renders the disclosure closed again', () => {
    const h = assessed('200', 'general_table_75C', 'Cu'); detailsOf(h).btn.dispatch('click'); assert.strictEqual(detailsOf(h).btn.attrs['aria-expanded'], 'true');
    assess(h); const { btn, region } = detailsOf(h); assert.strictEqual(btn.attrs['aria-expanded'], 'false'); assert.strictEqual(region.attrs.hidden, ''); assertMatchesDirect(h);
  });
  const STALE_ACTIONS = [
    ['load edit', (h) => h.set('lcFloorArea', '1600')],
    ['load edit and revert', (h) => { h.set('lcFloorArea', '1600'); h.set('lcFloorArea', '1500'); }],
    ['main Calculate', (h) => calc(h)],
    ['design edit', (h) => h.set('lcSvcMaterial', 'Al')],
    ['Reset', (h) => h.api.lcReset()],
    ['method switch', (h) => h.set('lcMethod', 'measured_220_87')],
    ['scope change', (h) => h.set('lcPurpose', 'feeder')],
    ['supply change', (h) => h.set('lcTopology', '1ph_3w_120_208_network')],
    ['save fault', (h) => { h.store.failNextSet = new Error('quota'); h.api.lcFavSave(); }]
  ];
  for (const [label, act] of STALE_ACTIONS) {
    test('stale / clear: ' + label + ' removes the opened details with the results (no hidden cached numbers)', () => {
      const h = assessed('200', 'general_table_75C', 'Cu'); detailsOf(h).btn.dispatch('click');
      act(h);
      assert.strictEqual(h.api.LC_SVC.analysis, null); assert.strictEqual(disclosureBtns(h).length, 0, 'no disclosure left');
      const whole = h.$('lcSvc').querySelectorAll('div').filter((d) => d.id === 'lcSvcResult' || d.id === 'lcSvcGate' || d.id === 'lcSvcStatus').map((d) => d.textContent).join(' ');
      assert.ok(!/totalExactE4|Module comparison|3\/0|Minimum standard-rating|Remaining checks — full list|operative: false/.test(whole), label + ': ' + whole.slice(0, 200));
    });
  }
  test('preset restore removes the opened details with the results', () => {
    const h = assessed('200', 'general_table_75C', 'Cu', { promptAnswer: 'B0' }); assert.strictEqual(h.api.lcFavSave(), true); detailsOf(h).btn.dispatch('click');
    h.$('lc-fav-list').querySelectorAll('.fav-item')[0].dispatch('click');
    assert.strictEqual(h.api.LC_SVC.analysis, null); assert.strictEqual(disclosureBtns(h).length, 0); assert.ok(!/totalExactE4|3\/0/.test(h.$('lcSvcResult').textContent));
  });
  test('scoped CSS: >= 44px full-width toggle, visible focus, wrapping, [hidden] honoured, every line under #lcContent, after the MOBILE-HOV-1 cap', () => {
    const start = html.indexOf('/* LC-SERVICE-UI-CLEANUP-1: one native disclosure'); assert.ok(start > 0);
    const css = html.slice(start, html.indexOf('</style>', start));
    for (const line of css.split('\n').filter((l) => l.startsWith('#'))) assert.ok(line.startsWith('#lcContent .lc-svc-details'), 'scoped: ' + line);
    assert.match(css, /\.lc-svc-details-btn \{[^}]*width: 100%[^}]*min-height: 44px/); assert.match(css, /\.lc-svc-details-btn \{[^}]*min-width: 0[^}]*white-space: normal[^}]*overflow-wrap: anywhere/);
    assert.match(css, /\.lc-svc-details-btn:focus-visible \{ outline: 2px solid/); assert.match(css, /\.lc-svc-details-body\[hidden\] \{ display: none; \}/);
    assert.ok(!/opacity|zoom|\b(select|input)\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no field styling touched');
    const iHov = html.indexOf('select, input, button, textarea { max-width: 100%; min-width: 0; box-sizing: border-box; }'); assert.ok(iHov > 0 && iHov < start);
  });
  test('the presentation helpers hold no focus/scroll/storage/evaluation call and the module is still called only at its two sites', () => {
    const src = adapterSource(); const i = src.indexOf('function lcSvcDisclosure('); const j = src.indexOf('function lcSvcRenderAnalysis(', i); assert.ok(i > 0 && j > i);
    const helpers = src.slice(i, j);
    for (const bad of [/\.focus\(/, /scrollIntoView/, /localStorage|sessionStorage/, /analyzePrototype/, /lcUpdate|lcSvcAssess|lcSvcRender\(/, /keydown|keyup/, /necLink|fetch\(/]) assert.ok(!bad.test(helpers), 'helper must not contain ' + bad);
    const block = src.slice(src.indexOf('// ── LC-SERVICE-UI-1: SERVICE SIZING'), src.indexOf('// ── Favorites (LC branch'));
    assert.strictEqual((block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').match(/\.analyzePrototype\(/g) || []).length, 2);
  });
});

describe('LC-SERVICE-UI-CLEANUP-1 — E. marks, gates, storage and the main result are unchanged', () => {
  test('exact 9 -> 8 -> 7 live marks with no service number and no disclosure before Reassess', () => {
    const h = b0Calculated(); fill(h, PLAN); h.set('lcSvcSelectedRating', '100'); assess(h);
    assert.deepStrictEqual(markIds(h), NINE); assert.strictEqual(disclosureBtns(h).length, 1, 'the min-only analysis has its disclosure');
    h.set('lcSvcSizingPath', 'general_table_75C'); assert.deepStrictEqual(markIds(h), NINE.slice(1));
    h.set('lcSvcMaterial', 'Cu'); assert.deepStrictEqual(markIds(h), NINE.slice(2));
    assert.strictEqual(h.api.LC_SVC.analysis, null); assert.strictEqual(disclosureBtns(h).length, 0);
    assert.ok(!/Minimum standard-rating candidate|\b\d+ A\b|23,680|98\.7|totalExactE4/.test(h.$('lcSvcResult').textContent + defaultText(h)), defaultText(h));
  });
  test('no number and no disclosure before the first Assess; main B0 result stays 23,680 VA / 98.7 A', () => {
    const h = b0Calculated(); assert.strictEqual(disclosureBtns(h).length, 0); assert.ok(!/\b\d+ A\b|Minimum standard/.test(h.$('lcSvcResult').textContent + h.$('lcSvcGate').textContent));
    const r = h.state().result; assert.strictEqual(r.status, 'COMPLETE'); assert.match(h.text(), /Total demand: 23,680 VA/); assert.match(h.text(), /98\.7 A/);
    const before = h.text(); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu')); assess(h); detailsOf(h).btn.dispatch('click');
    assert.strictEqual(h.text(), before, 'the Load Calc result DOM text is untouched by the panel and its disclosure');
  });
  test('Save/Restore bytes are identical with and without service state, including an opened disclosure', () => {
    const a = buildHarness({ promptAnswer: 'B0' }); a.api.lcInit(); driveB0(a); calc(a);
    const b = assessed('200', 'general_table_75C', 'Cu', { promptAnswer: 'B0' }); detailsOf(b).btn.dispatch('click');
    assert.strictEqual(JSON.stringify(b.api.lcFavPayload()), JSON.stringify(a.api.lcFavPayload()));
    assert.strictEqual(a.api.lcFavSave(), true); assert.strictEqual(b.api.lcFavSave(), true);
    assert.strictEqual(JSON.stringify(JSON.parse(b.store.data).lc[0].vals), JSON.stringify(JSON.parse(a.store.data).lc[0].vals));
    assert.ok(!/lcSvc|Calculation details|aria-expanded|totalExactE4/.test(b.store.data));
  });
  test('the Load Calc footer wording names the separate preview; its reference targets are unchanged', () => {
    const h = buildHarness(); h.api.lcInit(); const f = h.nodes().filter((n) => n._classes.has('lc-foot')); assert.strictEqual(f.length, 1);
    assert.match(f[0].textContent, /the Load Calc result selects no conductor or service rating; the separate SERVICE SIZING — DESIGN PREVIEW panel is a non-operative engineering preview, not a selection or approval/);
    assert.deepStrictEqual(f[0].querySelectorAll('span').filter((s) => s.attrs['data-ref']).map((s) => s.attrs['data-src'] + ':' + (s.attrs['data-sec'] || s.attrs['data-ref'])), ['nec:220.87', 'nycec:220.87', 'nec:220.82', 'nec:220.61']);
  });
});
