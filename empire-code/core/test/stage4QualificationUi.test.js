'use strict';
/**
 * STAGE4-UI — conductor workflow mode, preliminary new-design check and explicit planned-declaration adoption
 * (docs/stage4-qualification-contract.md §9).
 *
 * Runs the SHIPPED Load Calc adapter of BOTH pages (core/mobile.html and candidate/browser/workspace/mobile.html) in the
 * established stub DOM (test/helpers/loadCalcDom.js: makeDocument / makeStorage), against the page's own generated EC
 * block, with real control events. Expected engineering values come from the canonical source modules called directly
 * on the exact request the adapter transported (never from a second calculator), plus the hand-written B0 literals of the
 * contract (23 680 VA, 98.7 A, 2/0 Cu 175 A, #4 Cu 85 A, #2 Al 90 A).
 *
 * STALE GENERATED BLOCK vs ASSERTION FAILURE: the pages embed the calculator modules. If a page's generated block does
 * not carry the Stage 4 core yet, every test of that page fails with a message that starts with "STALE GENERATED BLOCK"
 * — run `node tools/build-calc.js && node tools/build-calc.js --workspace` in core/ first. Any other failure is a real
 * assertion about the UI.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeDocument, makeStorage } = require('./helpers/loadCalcDom.js');
const S = require('../src/calc/loadCalcServiceSizing.js');
const F = require('../src/calc/loadCalcFacade.js');

const ROOT = path.join(__dirname, '..');
const PAGES = { core: path.join(ROOT, 'mobile.html'), workspace: path.join(ROOT, '..', 'candidate', 'browser', 'workspace', 'mobile.html') };
const cache = {};
const page = (which) => cache[which] || (cache[which] = fs.readFileSync(PAGES[which], 'utf8'));

function fnBody(html, name) {
  const i = html.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function not found: ' + name);
  let depth = 0; let started = false;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') { depth++; started = true; } else if (html[j] === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); } }
  throw new Error('unbalanced: ' + name);
}
function adapterSource(html) {
  const i = html.indexOf('// ── LOAD CALCULATION — EC-CALC-2 / B2 thin adapter'); const j = html.indexOf('// ── FAVORITES SYSTEM', i);
  if (i === -1 || j === -1) throw new Error('adapter block not found');
  return html.slice(i, j);
}
function generatedEC(html) {
  const s = html.indexOf('<!-- EC-CALC:START'); const e = html.indexOf('<!-- EC-CALC:END -->');
  let block = html.slice(s, e); block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  const win = {}; new Function('window', block)(win); return win.EC;   // eslint-disable-line no-new-func
}
const stage4Block = (html) => { const i = html.indexOf('// ── STAGE4-UI: conductor workflow mode'); const j = html.indexOf('// ── end STAGE4-UI ──', i); if (i === -1 || j === -1) throw new Error('STAGE4-UI block not found'); return html.slice(i, j); };
const FAV_FNS = ['favState', 'favStorage', 'favEnv', 'favRead', 'favGetAll', 'favRefresh', 'favSettle', 'favExport', 'favRetry', 'favReset', 'favStatusNode', 'favGetValues', 'favSetValues', 'favGetLabel', 'favSave', 'favLoad', 'favDelete', 'favRender'];
const API = 'LC, LC_SVC, LC_CALC, LC_PRE, LC_RECORD_PREFIX, lcInit, lcReset, lcDraft, lcExportState, lcFavSave, lcFavRestore, lcFavPayload, lcSvcDesignObject, lcPreRun, lcPreAdopt, lcPreSetMode, lcRecordOpen, favSave, favState, favLoad, favGetAll';

/** the shipped adapter + Favorites functions of one page, executed as shipped; `o.patch(EC)` may replace a module on the page's own EC copy */
function build(which, o) {
  o = o || {}; const html = page(which); const dom = makeDocument(); const st = makeStorage(o.storage);
  const EC = Object.assign({}, generatedEC(html));
  const sizing = EC.loadCalcServiceSizing;
  if (!sizing || typeof sizing.analyzePreliminaryPrototype !== 'function' || typeof sizing.adoptPlannedConductorDeclaration !== 'function' || !EC.loadCalcFacade || typeof EC.loadCalcFacade.evaluatePreliminaryV2 !== 'function') {
    throw new Error('STALE GENERATED BLOCK (' + which + '): the page does not embed the Stage 4 core yet — rebuild with core/tools/build-calc.js (and --workspace) before judging the UI assertions');
  }
  if (o.patch) o.patch(EC);
  const prompts = { answer: o.promptAnswer === undefined ? 'preset' : o.promptAnswer, calls: [] };
  const locks = { request: (name, opts, cb) => { try { return Promise.resolve(cb({ name })); } catch (e) { return Promise.reject(e); } } };
  const editions = (html.match(/var EC_NEC_EDITION = '[^']+', EC_NYCEC_EDITION = '[^']+';/) || [''])[0];
  const refLayer = editions + '\n' + ['necRefInfo', 'necQuestion', 'refAttr', 'refSpanHtml', 'refSpanFromText', 'refSpanNode'].map((n) => fnBody(html, n)).join('\n') + '\n(' + fnBody(html, 'installRefDelegation') + ')();\n';
  const src = refLayer + adapterSource(html) + "\nvar FAV_KEY = 'sparky_favorites';\n" + FAV_FNS.map((n) => fnBody(html, n)).join('\n') + '\nexports.api = { ' + API + ' };';
  const exp = {}; const win = { crypto: require('node:crypto').webcrypto };
  new Function('navigator', 'confirm', 'document', 'window', 'EC', 'necLink', 'localStorage', 'prompt', 'exports', src)({ locks }, () => true, dom.document, win, EC, () => {}, st.localStorage, (msg, def) => { prompts.calls.push([msg, def]); return typeof prompts.answer === 'function' ? prompts.answer(msg, def) : prompts.answer; }, exp);   // eslint-disable-line no-new-func
  const api = exp.api; const $ = (id) => dom.byId[id];
  const set = (id, value) => { const el = $(id); if (!el) throw new Error('no element ' + id); el.value = value; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
  return { which, dom, api, EC, $, set, state: () => api.lcExportState(), store: st.store, localStorage: st.localStorage, prompts };
}

// ── helpers ──
/** the element with this id ONLY if it is attached under #lcForm and not hidden (the stub keeps detached nodes in its id map) */
const live = (h, id) => { const el = h.$(id); if (!el) return null; for (let n = el; n; n = n.parent) { if (n.style && n.style.display === 'none') return null; if (n.id === 'lcForm') return el; } return null; };
const click = (el) => el.dispatch('click');
const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const ctl = (card, role) => card.querySelectorAll('input, select, button').filter((e) => e.attrs['data-role'] === role)[0];
const setIn = (el, v) => { el.value = v; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
const addLoad = (h, preset, va) => { h.$('lcPresetName').value = String(preset); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click'); };
const fill = (h, pairs) => { for (const [id, v] of pairs) h.set(id, v); };
const PLAN = [['lcSvcIntent', 'new_design_candidate'], ['lcSvcOneMainDisconnect', 'yes'], ['lcSvcNoAdditionalSources', 'yes'], ['lcSvcWholeDwelling', 'yes'], ['lcSvcSingleConductorSet', 'yes']];
const COND = (pathV, material) => [['lcSvcSizingPath', pathV], ['lcSvcMaterial', material], ['lcSvcTermTemp', '75'], ['lcSvcTermCompatible', 'yes'], ['lcSvcInsulTemp', '75'], ['lcSvcAmbient', '30'], ['lcSvcCcc', '3'], ['lcSvcWiringMethod', 'single_insulated_conductors_in_raceway'], ['lcSvcNoOtherAdj', 'yes']];
/** the accepted B0 dwelling entered through the real controls; qual === null leaves the conductor ampacity UNKNOWN (never typed) */
function driveB0(h, qual) {
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_balanced_LN'); h.set('lcDeclBalancedLN', 'yes');
  h.set('lcFloorArea', '1500'); h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '1'); h.set('lcNycAcCircuits', '0');
  h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); if (qual !== null) h.set('lcConductorAmpacity', qual); h.set('lcNycAcException', 'yes');
  for (const [preset, va] of [[0, 12000], [3, 4500], [1, 5000], [2, 1200], [4, 5000]]) addLoad(h, preset, va);
  setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit');
  setIn(ctl(cards(h)[3], 'inclusion'), 'fixed_or_permanently_connected');
  setIn(ctl(cards(h)[4], 'coverage'), 'yes');
  h.set('lcInventoryComplete', 'yes');
}
const start = (which, qual, o) => { const h = build(which, o); h.api.lcInit(); driveB0(h, qual); return h; };
const draftText = (h) => JSON.stringify(h.api.lcDraft());
const decl = (h) => h.api.lcDraft().snapshot.optional82.conductorAmpacityA;
const preText = (h) => (live(h, 'lcPre') ? h.$('lcPre').textContent : '') + (live(h, 'lcPreRoute') ? h.$('lcPreRoute').textContent : '');
const titles = (host) => host.querySelectorAll('.lc-banner-title').map((n) => n.textContent);
/** new-design mode, plan + selected rating + conductor conditions, then the explicit preliminary action */
function preliminary(h, rating, pathV, material) {
  h.set('lcQualMode', 'new_design'); fill(h, PLAN); h.set('lcSvcSelectedRating', String(rating)); fill(h, COND(pathV, material));
  assert.strictEqual(h.api.LC_PRE.result, null, 'nothing preliminary is computed before the explicit action');
  const btn = live(h, 'lcPreRunBtn'); assert.ok(btn, 'the explicit preliminary action is offered'); click(btn);
  return h.api.LC_PRE.result;
}
const directPre = (h) => S.analyzePreliminaryPrototype(h.state().lastRequest, h.api.lcSvcDesignObject());

for (const which of ['core', 'workspace']) {
  describe('STAGE4-UI [' + which + '] — default route and the mode control', () => {
    test('default is the existing-conductor check: labelled mode control, no preliminary block, ordinary B0 unchanged', () => {
      const h = start(which, '200');
      const sel = h.$('lcQualMode'); assert.ok(sel && sel.tagName === 'SELECT'); assert.strictEqual(sel.value, 'existing'); assert.strictEqual(h.api.LC_PRE.mode, 'existing');
      assert.deepStrictEqual(sel.children.map((o) => o.value), ['existing', 'new_design']);
      const label = h.$('lcOpt82').querySelectorAll('label').filter((l) => l.attrs.for === 'lcQualMode'); assert.strictEqual(label.length, 1, 'one <label for>'); assert.ok(label[0].textContent.trim().length > 3);
      assert.ok(h.$(sel.attrs['aria-describedby']).textContent.length > 20, 'help text via aria-describedby');
      assert.strictEqual(live(h, 'lcPre'), null); assert.strictEqual(live(h, 'lcPreRoute'), null); assert.strictEqual(live(h, 'lcPreRunBtn'), null);
      click(h.$('lcCalcBtn')); const st = h.state();
      assert.strictEqual(st.result.status, 'COMPLETE'); assert.strictEqual(st.result.demand.totalVA, 23680);
      assert.strictEqual(JSON.stringify(st.result), JSON.stringify(F.evaluateV2(st.lastRequest).result), 'the ordinary facade result, unchanged');
      assert.ok(live(h, 'lcSvcAssessBtn'), 'ordinary Assess stays available'); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('general_table_75C', 'Cu')); click(h.$('lcSvcAssessBtn'));
      assert.strictEqual(JSON.stringify(h.api.LC_SVC.analysis), JSON.stringify(S.analyzePrototype(h.state().lastRequest, h.api.lcSvcDesignObject())));
      assert.ok(!/PLANNED/.test(h.$('lcSvcResult').textContent), 'an ordinary manual declaration is never shown as planned');
      assert.ok(live(h, 'lcRecordSaveBtn'), 'ordinary Save full result keeps its normal guard');
    });
    test('the mode is UI state only: not in the draft, the request, the exported state or a preset payload; Reset returns to the default', () => {
      const h = start(which, '200'); const before = draftText(h); const payload = JSON.stringify(h.api.lcFavPayload()); const evals = h.api.LC.evaluations;
      h.set('lcQualMode', 'new_design');
      assert.strictEqual(h.api.LC_PRE.mode, 'new_design'); assert.strictEqual(draftText(h), before); assert.strictEqual(JSON.stringify(h.api.lcFavPayload()), payload);
      assert.strictEqual(h.api.LC.evaluations, evals, 'choosing the mode evaluates nothing');
      assert.ok(!/new_design"|LC_PRE|"mode":"new_design"/.test(JSON.stringify(h.state())), 'not exported');
      h.api.lcReset(); assert.strictEqual(h.api.LC_PRE.mode, 'existing'); assert.strictEqual(h.$('lcQualMode').value, 'existing');
    });
    test('existing route with an unknown ampacity is still refused: INCOMPLETE_INPUT / QUALIFICATION_UNKNOWN, no preliminary action, nothing invented', () => {
      const h = start(which, null); click(h.$('lcCalcBtn')); const st = h.state();
      assert.strictEqual(st.result.status, 'INCOMPLETE_INPUT'); assert.ok(st.result.problems.some((p) => p.code === 'QUALIFICATION_UNKNOWN'));
      assert.strictEqual(decl(h).value, null); assert.strictEqual(live(h, 'lcPreRunBtn'), null); assert.strictEqual(live(h, 'lcSvcAssessBtn'), null);
      assert.strictEqual(h.$('lcSvcControls').style.display, 'none'); assert.strictEqual(h.api.LC_PRE.result, null); assert.strictEqual(h.api.LC_PRE.runs, 0);
    });
    test('selecting the new-design mode never erases or replaces an existing 200 A declaration and offers no preliminary action for it', () => {
      const h = start(which, '200'); const before = draftText(h);
      h.set('lcQualMode', 'new_design');
      assert.strictEqual(draftText(h), before); assert.strictEqual(decl(h).value, 200); assert.strictEqual(decl(h).provenance.note, null); assert.strictEqual(h.$('lcConductorAmpacity').value, '200');
      assert.strictEqual(live(h, 'lcPreRunBtn'), null); assert.strictEqual(live(h, 'lcPreAdoptBtn'), null);
      assert.match(preText(h), /already declared \(200 A\)/); assert.match(preText(h), /never erases, replaces or re-derives an existing declaration/); assert.match(preText(h), /ordinary analysis/);
      assert.strictEqual(h.api.lcPreAdopt({ kind: S.PRELIMINARY_ANALYSIS_KIND }, h.api.LC_PRE.epoch), false, 'a forged confirmation is refused');
      assert.strictEqual(draftText(h), before, 'still exactly the declared 200 A');
      click(h.$('lcCalcBtn')); assert.strictEqual(h.state().result.status, 'COMPLETE'); assert.ok(live(h, 'lcSvcAssessBtn'), 'the ordinary analysis is the route for a declared value');
    });
  });

  describe('STAGE4-UI [' + which + '] — preliminary check (B0, unknown ampacity)', () => {
    test('main 200 A, 310.12, Cu: preliminary 23,680 VA / 98.7 A and a conditional 2/0 at 175 A — canonical result, never COMPLETE, never saveable', () => {
      const h = start(which, null); const before = draftText(h);
      const a = preliminary(h, 200, 'dwelling_83pct_310_12', 'Cu');
      assert.ok(a, preText(h)); assert.strictEqual(JSON.stringify(a), JSON.stringify(directPre(h)), 'exactly analyzePreliminaryPrototype(current request, current design)');
      assert.strictEqual(a.kind, S.PRELIMINARY_ANALYSIS_KIND); assert.strictEqual(a.status, 'PRELIMINARY_EVALUATED'); assert.strictEqual(a.fullResultRecordEligible, false);
      assert.strictEqual(a.calcBasis.totalVA, 23680); assert.strictEqual(a.ungroundedConductors.tableCandidate.size, '2/0'); assert.strictEqual(a.ungroundedConductors.tableCandidate.ampacity75CA, 175);
      assert.strictEqual(a.ungroundedConductors.recommendationAvailable, false); assert.strictEqual(a.adoption.available, true);
      const t = preText(h);
      for (const s of ['23,680 VA', '98.7 A', 'PRELIMINARY DEMAND', 'UNRESOLVED QUALIFICATION', 'Conditional table reference — not a selection', 'Table 310.12', 'Copper (Cu)', '2/0 AWG', '175 A', 'MISSING INPUTS AND NEXT ACTION', 'It cannot be saved as a full result', 'unknown — nothing assumed']) assert.ok(t.includes(s), s);
      const heads = titles(h.$('lcPre')); assert.ok(heads.includes('PRELIMINARY — QUALIFICATION PENDING'), heads.join(' | '));
      assert.ok(heads.every((x) => !/\bCOMPLETE\b|APPROVED|RECOMMENDED/i.test(x)), 'no heading calls it complete, approved or recommended');
      assert.ok(!/Design-preview conductor candidate/.test(t) && !/recommended conductor|final conductor/i.test(t), 'no final-conductor wording');
      // no Save for a preliminary result; nothing preliminary leaks into the ordinary result slots
      assert.strictEqual(live(h, 'lcRecordSaveBtn'), null); assert.ok(h.$('lcPre').querySelectorAll('button').every((b) => !/save/i.test(b.textContent)));
      assert.strictEqual(h.api.LC_SVC.analysis, null); assert.notStrictEqual(h.state().result && h.state().result.status, 'COMPLETE'); assert.ok(!h.state().result || h.state().result.kind !== 'B82_PRELIMINARY_NEW_DESIGN', 'the ordinary result slot never holds a preliminary result');
      assert.strictEqual(draftText(h), before, 'the check wrote nothing'); assert.strictEqual(decl(h).value, null); assert.strictEqual(h.$('lcConductorAmpacity').value, '');
      const adopt = live(h, 'lcPreAdoptBtn'); assert.ok(adopt, 'the explicit confirmation is offered'); assert.strictEqual(adopt.attrs.type, 'button');
      assert.ok(adopt.textContent.includes('Copper (Cu) 2/0 AWG') && adopt.textContent.includes('175 A'), 'named for the displayed candidate: ' + adopt.textContent);
      assert.match(h.$(adopt.attrs['aria-describedby']).textContent, /PLANNED 220\.82\(A\) conductor declaration/); assert.match(h.$(adopt.attrs['aria-describedby']).textContent, /not an inspected or installed conductor/);
      assert.strictEqual(h.api.LC_PRE.runs, 1, 'one explicit run; no adoption happened by calculating');
    });
    test('main 100 A, 310.12: Cu #4 / 85 A and Al #2 / 90 A are INTERPRETATION_REVIEW_REQUIRED — no confirmation, not raised to 100 A, not called prohibited', () => {
      for (const [material, size, amp] of [['Cu', '4', 85], ['Al', '2', 90]]) {
        const h = start(which, null); const a = preliminary(h, 100, 'dwelling_83pct_310_12', material);
        assert.ok(a, preText(h)); assert.strictEqual(JSON.stringify(a), JSON.stringify(directPre(h)));
        assert.strictEqual(a.ungroundedConductors.tableCandidate.size, size); assert.strictEqual(a.ungroundedConductors.tableCandidate.ampacity75CA, amp);
        assert.strictEqual(a.adoption.available, false); assert.strictEqual(a.nextAction.code, 'INTERPRETATION_REVIEW_REQUIRED');
        const t = preText(h);
        assert.ok(t.includes(amp + ' A'), 'the table value is shown as it is'); assert.ok(t.includes('Interpretation review required')); assert.ok(t.includes('NOT an NEC violation finding'));
        assert.ok(t.includes('PLANNED CONDUCTOR DECLARATION — NOT AVAILABLE')); assert.ok(t.includes('No confirmation is offered for this result, and no value is substituted.'));
        assert.strictEqual(live(h, 'lcPreAdoptBtn'), null, 'no adopt action'); assert.strictEqual(decl(h).value, null); assert.strictEqual(h.$('lcConductorAmpacity').value, '');
        assert.strictEqual(h.api.lcPreAdopt(a, h.api.LC_PRE.epoch), false, 'even a direct call is refused by the canonical helper'); assert.strictEqual(decl(h).value, null);
      }
    });
    test('other prerequisites are never bypassed: an unanswered inventory blocks the check; another method reports the engine refusal', () => {
      const h = start(which, null); h.set('lcInventoryComplete', '');
      const a = preliminary(h, 200, 'dwelling_83pct_310_12', 'Cu');
      assert.ok(a, preText(h)); assert.strictEqual(JSON.stringify(a), JSON.stringify(directPre(h))); assert.strictEqual(a.status, 'PRELIMINARY_BLOCKED'); assert.strictEqual(a.calcBasis.totalVA, null);
      assert.ok(titles(h.$('lcPre')).includes('PRELIMINARY CHECK BLOCKED')); assert.ok(preText(h).includes('No preliminary demand is shown for this request.')); assert.ok(!preText(h).includes('23,680'));
      assert.strictEqual(live(h, 'lcPreAdoptBtn'), null); assert.strictEqual(decl(h).value, null);
      // another method: the 220.82 panel is gone, the route notice offers only the canonical refusal and the way back
      h.set('lcMethod', 'measured_220_87');
      assert.strictEqual(h.api.LC_PRE.result, null); assert.strictEqual(live(h, 'lcPre'), null); assert.ok(live(h, 'lcPreRoute')); assert.match(preText(h), /exists only for the NEC 220\.82 optional method/);
      click(live(h, 'lcPreRunBtn')); const r = h.api.LC_PRE.result; assert.ok(r, preText(h));
      assert.notStrictEqual(r.status, 'PRELIMINARY_EVALUATED'); assert.strictEqual(r.adoption.available, false); assert.strictEqual(r.calcBasis ? r.calcBasis.totalVA : null, null); assert.strictEqual(live(h, 'lcPreAdoptBtn'), null);
      click(live(h, 'lcPreBackBtn')); assert.strictEqual(h.api.LC_PRE.mode, 'existing'); assert.strictEqual(live(h, 'lcPreRoute'), null);
    });
  });

  describe('STAGE4-UI [' + which + '] — explicit adoption and the ordinary result', () => {
    test('confirming the displayed 175 A candidate writes only the returned planned declaration and shows the helper\'s ordinary COMPLETE result', () => {
      const h = start(which, null); const a = preliminary(h, 200, 'dwelling_83pct_310_12', 'Cu'); assert.ok(a, preText(h));
      const before = h.api.lcDraft(); const evals = h.api.LC.evaluations;
      const expected = S.adoptPlannedConductorDeclaration({ request: h.state().lastRequest, design: h.api.lcSvcDesignObject(), preliminary: a, confirmation: { action: S.ADOPTION_CONFIRMATION_ACTION, expectedFingerprint: a.binding.fingerprint, expectedAmpacityA: 175 } });
      assert.strictEqual(expected.adopted, true, 'canonical oracle');
      click(live(h, 'lcPreAdoptBtn'));
      const d = decl(h); assert.deepStrictEqual(JSON.parse(JSON.stringify(d)), JSON.parse(JSON.stringify(expected.after.conductorAmpacityA)), 'value AND provenance note exactly as returned');
      assert.strictEqual(d.value, 175); assert.strictEqual(d.provenance.source, 'designer_declaration'); assert.ok(d.provenance.note.indexOf(S.PLANNED_DECLARATION_NOTE_PREFIX + ':') === 0); assert.strictEqual(S.isPlannedConductorDeclaration(d), true);
      const after = JSON.parse(draftText(h)); after.snapshot.optional82.conductorAmpacityA = JSON.parse(JSON.stringify(before.snapshot.optional82.conductorAmpacityA));
      assert.strictEqual(JSON.stringify(after), JSON.stringify(before), 'no other premise, answer or field changed');
      const st = h.state();
      assert.deepStrictEqual(st.lastRequest, JSON.parse(JSON.stringify(expected.adoptedRequest)), 'the projected request equals adoptedRequest');
      assert.strictEqual(st.result.status, 'COMPLETE'); assert.strictEqual(st.result.demand.totalVA, 23680);
      assert.strictEqual(JSON.stringify(st.result), JSON.stringify(expected.response.result), 'the returned ordinary response'); assert.strictEqual(JSON.stringify(h.api.LC_SVC.analysis), JSON.stringify(expected.analysis), 'the returned ordinary analysis');
      assert.strictEqual(h.api.LC.evaluations, evals, 'the adapter recomputed nothing of its own');
      const an = h.api.LC_SVC.analysis; assert.strictEqual(an.ungroundedConductors.qualificationConsistency.status, 'premise_unchanged');
      assert.strictEqual(an.operative, false); assert.strictEqual(an.installationApproved, false); assert.strictEqual(an.globalCodeCompliance, 'not_verified'); assert.ok(an.remainingChecks.length > 0);
      assert.strictEqual(h.$('lcConductorAmpacity').value, '175'); assert.match(h.$('lcResult').textContent, /COMPLETE/);
      const t = h.$('lcSvcResult').textContent;
      assert.match(t, /PLANNED conductor declaration for a new design/); assert.match(t, /not an inspected or installed conductor/); assert.match(t, /compares the candidate table ampacity with this planned declaration only; it does not verify a physical installation/);
      assert.match(t, /Declared premiseunchanged/); assert.match(t, /Installation approval: /);
      assert.ok(live(h, 'lcPlannedNote') && /Planned declaration: 175 A/.test(h.$('lcPlannedNote').textContent));
      assert.ok(!h.$('lcForm').textContent.includes(S.PLANNED_DECLARATION_NOTE_PREFIX), 'the machine prefix is not part of the user flow');
      assert.strictEqual(h.api.LC_PRE.result, null); assert.strictEqual(live(h, 'lcPreAdoptBtn'), null); assert.ok(preText(h).includes('PLANNED DECLARATION RECORDED'));
      // the ordinary Save becomes eligible under its normal guards and stores the provenance verbatim; reopening shows it
      h.prompts.answer = 'Planned result'; const save = live(h, 'lcRecordSaveBtn'); assert.ok(save, 'ordinary Save full result'); click(save);
      const key = Object.keys(h.store.byKey).find((k) => k.indexOf(h.api.LC_RECORD_PREFIX) === 0); assert.ok(key, h.$('lcRecordSaveStatus') ? h.$('lcRecordSaveStatus').textContent : 'not saved');
      const bytes = h.store.byKey[key]; const rec = JSON.parse(bytes);
      assert.deepStrictEqual(rec.calculation.request.snapshot.optional82.conductorAmpacityA, JSON.parse(JSON.stringify(d))); assert.strictEqual(rec.calculation.response.result.status, 'COMPLETE');
      assert.strictEqual(h.api.lcRecordOpen(key), true); assert.match(h.$('lcRecordView').textContent, /The saved declared ampacity \(175 A\) is a PLANNED conductor declaration/);
      assert.strictEqual(h.store.byKey[key], bytes, 'opening a record changes no byte');
    });
    test('a manual ampacity edit after adoption is a new declaration: the planned note is dropped, also when the same number is typed', () => {
      const h = start(which, null); preliminary(h, 200, 'dwelling_83pct_310_12', 'Cu'); click(live(h, 'lcPreAdoptBtn')); assert.strictEqual(S.isPlannedConductorDeclaration(decl(h)), true);
      h.set('lcConductorAmpacity', '175');
      assert.strictEqual(decl(h).value, 175); assert.strictEqual(decl(h).provenance.note, null); assert.strictEqual(decl(h).provenance.source, 'designer_declaration'); assert.strictEqual(S.isPlannedConductorDeclaration(decl(h)), false);
      assert.strictEqual(live(h, 'lcPlannedNote'), null); assert.strictEqual(h.api.LC_SVC.analysis, null, 'ordinary freshness: the edit drops the shown assessment');
      click(h.$('lcCalcBtn')); click(h.$('lcSvcAssessBtn')); assert.ok(!/PLANNED/.test(h.$('lcSvcResult').textContent), 'a manual value is not shown as adopted');
      h.set('lcConductorAmpacity', '180'); h.set('lcConductorAmpacity', '175'); assert.strictEqual(decl(h).provenance.note, null);
    });
    test('a helper refusal shows its reason and next action and changes nothing', () => {
      const refusal = { status: 'ADOPTION_REFUSED', adopted: false, reasons: [{ code: 'STALE_PRELIMINARY_RESULT', message: 'refusal reason from the helper' }], nextAction: { code: 'RERUN_PRELIMINARY_ANALYSIS', message: 'next action from the helper', fields: [] } };
      const h = start(which, null); const a = preliminary(h, 200, 'dwelling_83pct_310_12', 'Cu'); assert.ok(a, preText(h)); const before = draftText(h);
      h.EC.loadCalcServiceSizing = Object.assign({}, h.EC.loadCalcServiceSizing, { adoptPlannedConductorDeclaration: () => refusal });
      click(live(h, 'lcPreAdoptBtn'));
      assert.strictEqual(draftText(h), before); assert.strictEqual(decl(h).value, null); assert.strictEqual(h.$('lcConductorAmpacity').value, '');
      assert.ok(preText(h).includes('PLANNED DECLARATION NOT RECORDED')); assert.ok(preText(h).includes('refusal reason from the helper')); assert.ok(preText(h).includes('next action from the helper'));
      assert.strictEqual(h.api.LC_PRE.result, null); assert.strictEqual(live(h, 'lcPreAdoptBtn'), null); assert.strictEqual(h.api.LC_SVC.analysis, null); assert.notStrictEqual(h.state().result.status, 'COMPLETE');
    });
  });

  describe('STAGE4-UI [' + which + '] — invalidation of the held result and of every confirmation', () => {
    const CHANGES = [
      ['load edit then revert', (h) => { h.set('lcFloorArea', '1600'); h.set('lcFloorArea', '1500'); }],
      ['load record edit then revert', (h) => { setIn(ctl(cards(h)[0], 'rating'), '12500'); setIn(ctl(cards(h)[0], 'rating'), '12000'); }],
      ['design edit then revert', (h) => { h.set('lcSvcMaterial', 'Al'); h.set('lcSvcMaterial', 'Cu'); }],
      ['selected rating edit then revert', (h) => { h.set('lcSvcSelectedRating', '225'); h.set('lcSvcSelectedRating', '200'); }],
      ['mode change and back', (h) => { h.set('lcQualMode', 'existing'); h.set('lcQualMode', 'new_design'); }],
      ['a main Calculate', (h) => { click(h.$('lcCalcBtn')); }],
    ];
    for (const [name, change] of CHANGES) {
      test(name + ': the preview and its confirmation are gone although the inputs are identical again; the old button records nothing', () => {
        const h = start(which, null); const a = preliminary(h, 200, 'dwelling_83pct_310_12', 'Cu'); assert.ok(a, preText(h));
        const stale = live(h, 'lcPreAdoptBtn'); assert.ok(stale); const before = draftText(h); const fp = a.binding.fingerprint;
        change(h);
        assert.strictEqual(draftText(h), before, 'identical values again'); assert.strictEqual(S.analyzePreliminaryPrototype(h.state().lastRequest, h.api.lcSvcDesignObject()).binding.fingerprint, fp, 'the fingerprint alone would not have noticed');
        assert.strictEqual(h.api.LC_PRE.result, null); assert.strictEqual(live(h, 'lcPreAdoptBtn'), null); assert.ok(!preText(h).includes('23,680'), 'no old preview');
        click(stale);   // the confirmation the user saw before the change
        assert.strictEqual(draftText(h), before); assert.strictEqual(decl(h).value, null); assert.strictEqual(h.api.LC_SVC.analysis, null);
        if (h.api.LC_PRE.mode === 'new_design') assert.ok(preText(h).includes('PLANNED DECLARATION NOT RECORDED'));
      });
    }
    test('Reset and a preset restore drop the held result, return to the default mode and never carry a confirmation over', async () => {
      const h = start(which, null); h.prompts.answer = 'unknown-ampacity preset'; assert.strictEqual(await h.api.lcFavSave(), true);
      const a = preliminary(h, 200, 'dwelling_83pct_310_12', 'Cu'); assert.ok(a); const stale = live(h, 'lcPreAdoptBtn');
      const row = h.api.favGetAll().lc[0]; h.api.favLoad('lc', row.id);
      assert.strictEqual(h.api.LC_PRE.mode, 'existing'); assert.strictEqual(h.api.LC_PRE.result, null); assert.strictEqual(live(h, 'lcPre'), null);
      click(stale); assert.strictEqual(decl(h).value, null);
      h.set('lcQualMode', 'new_design'); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('dwelling_83pct_310_12', 'Cu')); click(live(h, 'lcPreRunBtn')); assert.ok(live(h, 'lcPreAdoptBtn'));
      h.api.lcReset(); assert.strictEqual(h.api.LC_PRE.result, null); assert.strictEqual(h.api.LC_PRE.mode, 'existing'); assert.strictEqual(live(h, 'lcPreAdoptBtn'), null);
    });
  });

  describe('STAGE4-UI [' + which + '] — history, presets and Favorites name retention', () => {
    test('an ordinary declared-200 A / candidate-175 A record keeps its bytes and its revalidation status; nothing is re-read as planned', () => {
      const h = start(which, '200'); click(h.$('lcCalcBtn')); fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('dwelling_83pct_310_12', 'Cu')); click(h.$('lcSvcAssessBtn'));
      assert.strictEqual(h.api.LC_SVC.analysis.ungroundedConductors.qualificationConsistency.status, 'revalidation_required');
      h.prompts.answer = 'Old 200 to 175'; click(live(h, 'lcRecordSaveBtn'));
      const key = Object.keys(h.store.byKey).find((k) => k.indexOf(h.api.LC_RECORD_PREFIX) === 0); assert.ok(key); const bytes = h.store.byKey[key];
      h.set('lcQualMode', 'new_design'); assert.strictEqual(h.api.lcRecordOpen(key), true);
      assert.strictEqual(h.store.byKey[key], bytes); const view = h.$('lcRecordView').textContent;
      assert.ok(!/PLANNED/.test(view)); assert.strictEqual(JSON.parse(bytes).serviceSizing.analysis.ungroundedConductors.qualificationConsistency.status, 'revalidation_required'); assert.strictEqual(decl(h).value, 200);
    });
    test('a preset saved after adoption restores the planned provenance verbatim; no preliminary object is ever in a payload', async () => {
      const h = start(which, null); preliminary(h, 200, 'dwelling_83pct_310_12', 'Cu');
      assert.ok(!/PRELIMINARY|fp1-/.test(JSON.stringify(h.api.lcFavPayload())), 'a held preliminary result is not part of the preset payload');
      click(live(h, 'lcPreAdoptBtn')); const d = JSON.parse(JSON.stringify(decl(h)));
      h.prompts.answer = 'planned preset'; assert.strictEqual(await h.api.lcFavSave(), true);
      h.api.lcReset(); assert.strictEqual(decl(h).value, null);
      const row = h.api.favGetAll().lc[0]; h.api.favLoad('lc', row.id);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(decl(h))), d); assert.ok(live(h, 'lcPlannedNote')); assert.strictEqual(h.api.LC_PRE.mode, 'existing');
    });
    test('Load Calc Save: a custom name survives a failed write for the same draft only; success, cancel or changed inputs drop it', async () => {
      const h = start(which, '200'); const generated = () => h.prompts.calls[h.prompts.calls.length - 1][1];
      const fail = () => { h.store.failNextSet = Object.assign(new Error('quota'), { name: 'QuotaExceededError', code: 22 }); };
      h.prompts.answer = 'Custom LC name'; fail(); assert.strictEqual(await h.api.lcFavSave(), false); const first = h.prompts.calls[0][1]; assert.notStrictEqual(first, 'Custom LC name');
      assert.strictEqual(h.api.favState().retainedName.name, 'Custom LC name'); assert.strictEqual(h.api.favState().retainedName.type, 'lc');
      h.prompts.answer = (msg, def) => def; assert.strictEqual(await h.api.lcFavSave(), true); assert.strictEqual(generated(), 'Custom LC name', 'the retry prompt offers the failed custom name');
      assert.strictEqual(h.api.favGetAll().lc[0].name, 'Custom LC name'); assert.ok(!h.api.favState().retainedName, 'cleared by the successful save');
      assert.strictEqual(await h.api.lcFavSave(), true); assert.strictEqual(generated(), first, 'after success the generated default is back');
      h.prompts.answer = 'Stale name'; fail(); assert.strictEqual(await h.api.lcFavSave(), false);
      h.set('lcFloorArea', '1600'); h.prompts.answer = (msg, def) => def; assert.strictEqual(await h.api.lcFavSave(), true); assert.notStrictEqual(generated(), 'Stale name', 'changed inputs never reuse the name');
      h.prompts.answer = 'Cancelled name'; fail(); assert.strictEqual(await h.api.lcFavSave(), false);
      h.prompts.answer = null; assert.strictEqual(await h.api.lcFavSave(), false); assert.strictEqual(generated(), 'Cancelled name'); assert.ok(!h.api.favState().retainedName, 'cleared by the cancel');
      h.prompts.answer = (msg, def) => def; assert.strictEqual(await h.api.lcFavSave(), true); assert.notStrictEqual(generated(), 'Cancelled name');
      assert.ok(!Object.keys(h.store.byKey).some((k) => /name/i.test(k)), 'no separate storage for the retained name');
    });
    test('shared favSave (Voltage Drop list): same retention rule, per list and per input snapshot', async () => {
      const h = build(which); const vals = { vdAmps: '20', vdFeet: '100', vdVoltage: '208', vdPhase: '1', vdMaterial: 'cu', vdMaxPct: '3' };
      for (const id of Object.keys(vals)) { const el = h.dom.mkEl('input'); el.id = id; el.value = vals[id]; }
      const last = () => h.prompts.calls[h.prompts.calls.length - 1][1];
      h.prompts.answer = 'Shop feeder'; h.store.failNextSet = Object.assign(new Error('quota'), { name: 'QuotaExceededError', code: 22 });
      assert.strictEqual(await h.api.favSave('vd'), false); const generated = h.prompts.calls[0][1];
      h.prompts.answer = (msg, def) => def; assert.strictEqual(await h.api.favSave('vd'), true); assert.strictEqual(last(), 'Shop feeder'); assert.strictEqual(h.api.favGetAll().vd[0].name, 'Shop feeder');
      assert.strictEqual(await h.api.favSave('vd'), true); assert.strictEqual(last(), generated);
      h.prompts.answer = 'Other'; h.store.failNextSet = Object.assign(new Error('quota'), { name: 'QuotaExceededError', code: 22 }); assert.strictEqual(await h.api.favSave('vd'), false);
      h.$('vdFeet').value = '150'; h.prompts.answer = (msg, def) => def; assert.strictEqual(await h.api.favSave('vd'), true); assert.notStrictEqual(last(), 'Other');
    });
  });
}

describe('STAGE4-UI — both pages stay synchronized outside the generated block', () => {
  const core = page('core'); const ws = page('workspace');
  test('the STAGE4-UI block and every touched adapter / Favorites function are byte-identical in both pages', () => {
    assert.strictEqual(stage4Block(ws), stage4Block(core));
    // every function edited by STAGE4-UI; a difference here that predates this stage would be a hosted-copy divergence, not a Stage 4 defect (see NOTES §6)
    for (const fn of ['lcPublish', 'lcOpFault', 'lcSetNumber', 'lcUpdate', 'lcBuildOpt82SectionInner', 'lcSyncOpt82', 'lcCalcReset', 'lcSvcReset', 'lcSvcSetDesign', 'lcSvcSync', 'lcSvcFail', 'lcSvcRender', 'lcSvcRenderPanel', 'lcSvcRenderAnalysis', 'lcSvcBuildInner', 'lcFavSave', 'favSave']) assert.strictEqual(fnBody(ws, fn), fnBody(core, fn), fn + ' differs between the two pages');
    for (const marker of ["lcPreInvalidate('load'); }   // STAGE4-UI", "id: 'lcPreRoute'", "id: 'lcPre', className: 'lc-pre'", 'declaration: lcPreRecordDeclaration(r)', '#lcContent .lc-pre-btn']) { assert.ok(core.includes(marker), 'core: ' + marker); assert.ok(ws.includes(marker), 'workspace: ' + marker); }
  });
  test('the obsolete help text is gone, the corrected one is present, and the Grounding ring-condition controls are labelled — in both pages', () => {
    for (const [name, html] of [['core', core], ['workspace', ws]]) {
      const outside = html.slice(html.indexOf('<!-- EC-CALC:END -->'));
      assert.ok(!outside.includes('cannot start a preliminary load calculation'), name + ': obsolete claim removed');
      assert.ok(outside.includes('Leave unknown if not established: the ordinary calculation then stays incomplete.'), name);
      assert.ok(outside.includes('<label class="ctrl-lbl" for="gnd-electrode">Connecting To</label>'), name + ': the electrode choice that opens the ring condition has a real label');
      assert.ok(outside.includes('<label class="ctrl-lbl" for="gnd-ring">Ground ring conductor (required)</label>'), name);
      assert.ok(/<select id="gnd-ring" onchange="gndCalc\(\)"[^>]*aria-required="true"[^>]*aria-describedby="gnd-ring-help">/.test(outside), name + ': required + described');
      assert.strictEqual((outside.match(/id="gnd-ring"/g) || []).length, 1, name + ': one control for that label');
      assert.ok(!/function analyzePreliminaryPrototype\(|function adoptPlannedConductorDeclaration\(/.test(outside), name + ': no second copy of the core outside the generated block');
    }
  });
  test('every Stage 4 control has an accessible name: label[for] for the field, type=button with text for each action', () => {
    const h = build('core'); h.api.lcInit(); driveB0(h, null); h.set('lcQualMode', 'new_design');
    assert.strictEqual(h.$('lcForm').querySelectorAll('label').filter((l) => l.attrs.for === 'lcQualMode').length, 1);
    fill(h, PLAN); h.set('lcSvcSelectedRating', '200'); fill(h, COND('dwelling_83pct_310_12', 'Cu')); click(live(h, 'lcPreRunBtn'));
    const buttons = h.$('lcPre').querySelectorAll('button'); assert.ok(buttons.length >= 3);
    for (const b of buttons) { assert.strictEqual(b.attrs.type, 'button', b.id); assert.ok(b.textContent.trim().length > 5, b.id); }
    assert.strictEqual(h.$('lcPre').querySelectorAll('input, select').length, 0, 'no unlabeled field and no accept-everything checkbox in the preliminary block');
    assert.strictEqual(h.$('lcPreStatus').attrs.role, 'status');
  });
});
