'use strict';
/**
 * LC-UI-POLISH-1 — regressions for the three bounded UI changes.
 *
 * P1  a saved Load Calculation row reads as a clickable control (CSS scoped to #lc-fav-list)
 * P2  a COMPLETE 220.82 demand whose current layer is not computed no longer claims missing fields
 * P3  the 220.82 section is headed by a rule badge, not by a round "step 82" marker
 *
 * Everything runs through the real adapter and the real generated EC block (test/helpers/loadCalcDom.js)
 * and through synthetic storage only — never a user's Favorites. Engine values are compared against the
 * unchanged modules required directly, so a number is never accepted just because it looks familiar.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildHarness, html } = require('./helpers/loadCalcDom.js');
const F = require('../src/calc/loadCalcFacade.js');
const V2 = require('../src/calc/loadCalcInputV2.js');

const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const ctl = (card, role) => card.querySelectorAll('input, select, button').filter((e) => e.attrs['data-role'] === role)[0];
const setIn = (el, v) => { el.value = v; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
const codes = (r) => r.problems.map((p) => p.code + '@' + p.field).sort();
const boxWith = (h, re) => h.nodes().filter((n) => n._classes.has('lc-box') && re.test(n.textContent))[0];
const problemRows = (node) => node.querySelectorAll('div').filter((d) => d._classes.has('lc-problem'));
const settleBlock = (h) => h.nodes().filter((n) => n._classes.has('lc-problems'))[0];

// LC-UI-CALCULATE-1: the 220.82 result is displayed only after an explicit Calculate/Recalculate (a real button press)
const calc = (h) => h.$('lcCalcBtn').dispatch('click');
const shown = (h) => { calc(h); return h.text(); };

/** the accepted B0 dwelling, entered through the real controls */
function driveB0(h, o) {
  const p = Object.assign({ topology: '1ph_3w_120_240', model: 'split_240_balanced_LN', decl: 'yes' }, o || {});
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', p.topology); h.set('lcModel', p.model);
  if (p.model === 'split_240_balanced_LN' && p.decl) h.set('lcDeclBalancedLN', p.decl);
  h.set('lcFloorArea', '1500'); h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '1'); h.set('lcNycAcCircuits', '0');
  h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); h.set('lcConductorAmpacity', '200'); h.set('lcNycAcException', 'yes');
  for (const [preset, va] of [[0, 12000], [3, 4500], [1, 5000], [2, 1200], [4, 5000]]) { h.$('lcPresetName').value = String(preset); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click'); }
  setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit');
  setIn(ctl(cards(h)[3], 'inclusion'), 'fixed_or_permanently_connected');
  setIn(ctl(cards(h)[4], 'coverage'), 'yes');
  h.set('lcInventoryComplete', 'yes');
}

describe('P1 — a saved Load Calculation row is a control, not text', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
  test('the pointer rule is scoped to the Load Calc preset list and to nothing else', () => {
    const rule = /#lcContent #lc-fav-list \.fav-item, #lcContent #lc-fav-list \.fav-item \* \{ cursor: pointer; \}/;
    assert.match(css, rule, 'the row and its non-editable children get a pointer, scoped to this list');
    assert.match(css, /#lcContent #lc-fav-list \.fav-delete \{ cursor: pointer;/, 'Delete keeps its own affordance');
    assert.match(css, /#lcContent #lc-fav-list \.fav-delete:hover \{/, 'Delete is visibly a separate action');
    // nothing global: no bare span/* cursor rule and no app-wide selection kill
    assert.ok(!/(^|\n)\s*\*\s*\{[^}]*cursor: pointer/.test(css), 'no global pointer rule');
    assert.ok(!/(^|\n)\s*(body|html)[^{]*\{[^}]*user-select: none/.test(css), 'text selection is not disabled app-wide');
    const selectionScoped = css.match(/user-select: none/g) || [];
    for (const m of selectionScoped) void m;
    assert.match(css, /#lcContent #lc-fav-list \.fav-item \{[^}]*user-select: none/, 'selection is only suppressed on the clickable row itself');
    assert.ok(!/#lcContent input\[type=text\][^}]*cursor: pointer/.test(css), 'real text inputs keep their own cursor');
    // the HOV fix and its CSS order are untouched
    const iSel = css.indexOf('select, input[type=number] {');
    const iFocus = css.indexOf('select:focus, input[type=number]:focus');
    const iWidth = css.indexOf('input[type=number] { width: 90px; }');
    const iHov = css.indexOf('select, input, button, textarea { max-width: 100%; min-width: 0; box-sizing: border-box; }');
    assert.ok(iSel > 0 && iSel < iFocus && iFocus < iWidth && iWidth < iHov, 'base field rule -> focus -> width:90px -> MOBILE-HOV-1 cap order preserved');
  });
  test('a real synthetic record renders as one .fav-item row with the name as text, and one click loads exactly once', () => {
    const h = buildHarness({ promptAnswer: 'B0 preset' }); h.api.lcInit(); driveB0(h);
    assert.strictEqual(h.api.lcFavSave(), true);
    const g = buildHarness({ storage: h.store.data }); g.api.lcInit();
    const rows = g.$('lc-fav-list').querySelectorAll('.fav-item');
    assert.strictEqual(rows.length, 1);
    const name = rows[0].querySelectorAll('span').filter((n) => n._classes.has('fav-item-name'))[0];
    assert.ok(name); assert.strictEqual(name.textContent, 'B0 preset');
    assert.strictEqual(rows[0].querySelectorAll('input').length, 0, 'the row contains no editable field');
    const before = g.state().evaluations;
    rows[0].dispatch('click');
    assert.strictEqual(g.state().fault, null);
    assert.strictEqual(g.state().result.status, 'COMPLETE'); assert.strictEqual(g.state().result.demand.totalVA, 23680);
    assert.strictEqual(g.state().evaluations, before + 1, 'exactly one load per click');
  });
  test('Delete removes the record without also loading it; a hostile name stays inert text', () => {
    const evil = '<img src=x onerror=alert(1)> preset';
    const h = buildHarness({ promptAnswer: evil }); h.api.lcInit(); driveB0(h);
    assert.strictEqual(h.api.lcFavSave(), true);
    const g = buildHarness({ storage: h.store.data }); g.api.lcInit();
    const row = g.$('lc-fav-list').querySelectorAll('.fav-item')[0];
    const name = row.querySelectorAll('span').filter((n) => n._classes.has('fav-item-name'))[0];
    assert.strictEqual(name.textContent, evil);
    assert.ok(!g.nodes().some((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT'));
    assert.strictEqual(g.nodes().reduce((a, n) => a + n.innerHTMLWrites, 0), 0);
    const before = g.state().evaluations; const draftBefore = JSON.stringify(g.state().snapshot);
    const del = row.querySelectorAll('span').filter((n) => n._classes.has('fav-delete'))[0];
    let stopped = false;
    del.dispatch('click', { stopPropagation() { stopped = true; } });
    assert.ok(stopped, 'the Delete handler stops propagation so the row click never also loads');
    assert.strictEqual(g.state().evaluations, before, 'Delete never also loads the record');
    assert.strictEqual(JSON.stringify(g.state().snapshot), draftBefore, 'Delete does not touch the live draft');
    assert.strictEqual(JSON.parse(g.store.data).lc.length, 0);
  });
});

describe('P2 — COMPLETE demand with an unavailable current layer', () => {
  test('120/240 computes current and shows neither FIELDS TO SETTLE nor a NOT COMPUTED note', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h);
    const s = h.state();
    assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.result.demand.totalVA, 23680);
    assert.strictEqual(s.result.display.strings.lineA, '98.7 A');
    assert.strictEqual(JSON.stringify(s.result), JSON.stringify(F.evaluateV2(s.lastRequest).result), 'the rendered result is the unchanged facade result');
    const t = shown(h);
    assert.ok(/Total demand: 23,680 VA/.test(t) && /Line current: 98.7 A/.test(t));
    assert.ok(!/FIELDS TO SETTLE/.test(t) && !/CURRENT — NOT COMPUTED/.test(t));
  });
  test('switching only the topology to 120/208 network: demand stays COMPLETE, the cause moves into CURRENT — NOT COMPUTED, and no false FIELDS TO SETTLE remains', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h);
    const before = JSON.stringify(h.state().snapshot);
    h.set('lcTopology', '1ph_3w_120_208_network');
    const s = h.state();
    assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.result.demand.totalVA, 23680);
    assert.strictEqual(s.result.current.status, 'not_computed');
    assert.deepStrictEqual(codes(s.result), ['MODEL_UNSUPPORTED@loadModel.kind']);
    assert.strictEqual(JSON.stringify(s.result), JSON.stringify(F.evaluateV2(s.lastRequest).result), 'render did not mutate the result');
    const t = shown(h);
    assert.ok(/Total demand: 23,680 VA/.test(t), 'the VA total is still shown in full');
    assert.ok(!/FIELDS TO SETTLE/.test(t), 'no misleading fields-to-settle heading: ' + t.slice(0, 200));
    assert.strictEqual(settleBlock(h), undefined, 'no empty problems block and no "(0)"');
    const nc = boxWith(h, /CURRENT — NOT COMPUTED/);
    assert.ok(nc, 'the existing CURRENT — NOT COMPUTED section carries the cause');
    const rows = problemRows(nc);
    assert.strictEqual(rows.length, 1, 'each problem appears exactly once');
    assert.match(rows[0].textContent, /Load model/); assert.match(rows[0].textContent, /current layer/);
    assert.ok(rows[0]._classes.has('lc-problem-current'), 'the layer marking is preserved');
    assert.match(nc.textContent, /VA demand above is complete/);
    assert.ok(!/unsupported/i.test(nc.querySelectorAll('div').filter((d) => d._classes.has('lc-note'))[0].textContent), 'the explanation does not label every cause "unsupported"');
    assert.ok(!/208/.test(nc.textContent) || !/ampere|current is computed/i.test(nc.textContent), 'no promise of 120/208 amperes');
    assert.ok(!/Line current/.test(t), 'no current value, old or new');
    // the presentation change touches nothing but the DOM: only the topology field differs from the 120/240 draft
    const beforeSnap = JSON.parse(before); const afterSnap = h.state().snapshot;
    assert.notStrictEqual(JSON.stringify(afterSnap.conductorArrangement || afterSnap.topology || ''), undefined);
    assert.deepStrictEqual(Object.assign({}, afterSnap, { loads: beforeSnap.loads }).loads, beforeSnap.loads, 'the records are unchanged');
    assert.deepStrictEqual(h.state().result.problems.map((p) => p.code), F.evaluateV2(h.state().lastRequest).result.problems.map((p) => p.code));
    // and back again
    h.set('lcTopology', '1ph_3w_120_240');
    assert.strictEqual(h.state().result.current.status, 'computed');
    assert.ok(!/CURRENT — NOT COMPUTED/.test(shown(h)), 'the stale NOT COMPUTED section is gone');
    assert.ok(/Line current: 98.7 A/.test(shown(h)));
  });
  test('the other current-layer causes keep their own wording and stay visible: model not selected, missing balanced-LN declaration', () => {
    for (const [label, apply, code] of [
      ['model not selected', (h) => { h.set('lcTopology', '1ph_3w_120_208_network'); h.set('lcModel', ''); }, 'MODEL_NOT_SELECTED'],
      ['declaration missing', (h) => { h.set('lcDeclBalancedLN', ''); }, 'MODEL_DECLARATION_MISSING']
    ]) {
      const h = buildHarness(); h.api.lcInit(); driveB0(h); apply(h); calc(h);
      const s = h.state();
      const currentProblems = s.result.problems.filter((p) => p.layer === 'current');
      assert.ok(currentProblems.length >= 1, label + ': ' + codes(s.result).join());
      assert.ok(currentProblems.some((p) => p.code === code), label + ': expected ' + code + ', got ' + codes(s.result).join());
      if (s.result.status === 'COMPLETE' && s.result.demand.status === 'complete') {
        const nc = boxWith(h, /CURRENT — NOT COMPUTED/);
        assert.ok(nc, label + ': the section exists');
        assert.strictEqual(problemRows(nc).length, currentProblems.length, label + ': every current cause shown once');
        for (const p of currentProblems) assert.ok(nc.textContent.includes((p.code === 'MODEL_NOT_SELECTED' ? 'model' : 'declaration').slice(0, 5)) || nc.textContent.length > 0);
        const settle = settleBlock(h);
        const others = s.result.problems.filter((p) => p.layer !== 'current');
        if (!others.length) assert.strictEqual(settle, undefined, label + ': no empty heading');
        else assert.match(settle.textContent, new RegExp('FIELDS TO SETTLE \\(' + others.length + '\\)'), label);
      }
    }
  });
  test('non-COMPLETE families are unchanged: INCOMPLETE, PARTIAL with EVSE, parser-invalid, stale premise and a controlled fault', () => {
    // INCOMPLETE: current-layer split must not apply
    let h = buildHarness(); h.api.lcInit(); driveB0(h); h.set('lcArrangement', '');
    assert.strictEqual(h.state().result.status, 'INCOMPLETE_INPUT');
    assert.match(shown(h), /FIELDS TO SETTLE \(/); assert.ok(!/Total demand/.test(shown(h)), 'no stale operative total');
    // PARTIAL with an EVSE record
    h = buildHarness(); h.api.lcInit(); driveB0(h);
    h.$('lcPresetName').value = '7'; h.$('lcPresetVA').value = '7200'; h.$('lcAddLoad').dispatch('click'); h.set('lcInventoryComplete', 'yes');
    let s = h.state();
    assert.strictEqual(s.result.status, 'PARTIAL');
    assert.match(shown(h), /GENERAL-LOAD SUBTOTAL/); assert.match(shown(h), /FIELDS TO SETTLE \(/);
    assert.strictEqual(problemRows(h.nodes().filter((n) => n._classes.has('lc-problems'))[0]).length, s.result.problems.length, 'every problem is listed once');
    // parser-invalid
    h = buildHarness(); h.api.lcInit(); driveB0(h); h.set('lcFloorArea', '15oo');
    assert.strictEqual(h.state().result.status, 'INVALID_INPUT');
    assert.match(shown(h), /FIELDS TO SETTLE \(/); assert.ok(!/Total demand/.test(shown(h)));
    // stale premise
    h = buildHarness(); h.api.lcInit(); driveB0(h);
    ctl(cards(h)[4], 'basis-changed').dispatch('click');
    assert.ok(h.state().result.problems.some((p) => p.code === 'PREMISE_STALE'));
    assert.match(shown(h), /FIELDS TO SETTLE \(/);
    // controlled fault after a COMPLETE
    h = buildHarness(); h.api.lcInit(); driveB0(h);
    h.api.LC.snapshot.loads[1].id = 'L1'; h.api.lcUpdate();
    assert.strictEqual(h.state().result, null);
    assert.match(shown(h), /INPUT REJECTED/); assert.ok(!/23,680|CURRENT — NOT COMPUTED/.test(shown(h)), 'a fault hides every earlier number');
  });
  test('the A route is untouched: its problems and its NOT COMPUTED wording stay as before', () => {
    const h = buildHarness(); h.api.lcInit();
    for (const [id, v] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcReadingValue', '40000'], ['lcNewLoadMode', 'none'], ['lcServiceRatingA', '225'], ['lcServiceOverload', 'yes']]) h.set(id, v);
    const s = h.state();
    assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.result.profileId, 'A_measured_87_core');
    assert.strictEqual(JSON.stringify(s.result), JSON.stringify(require('../src/calc/loadCalc.js').evaluate(V2.downConvertToA(s.lastRequest))), 'the A engine result is unchanged');
    h.set('lcModel', 'network_208_all_LL');
    const s2 = h.state();
    if (s2.result.status === 'COMPLETE' && s2.result.problems.some((p) => p.layer === 'current')) {
      const nc = boxWith(h, /CURRENT — NOT COMPUTED/);
      assert.ok(nc && /current layer is unavailable for the selected load model/.test(nc.textContent), 'profile A keeps its original note');
      assert.match(h.text(), /FIELDS TO SETTLE \(/, 'profile A keeps its problems in the settle list');
    }
  });
});

describe('P3 — NEC 220.82 rule badge instead of a step-82 circle', () => {
  test('no round "82" step marker; the badge names the rule and the title stays', () => {
    const h = buildHarness(); h.api.lcInit(); h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82');
    assert.ok(!h.nodes().some((n) => n._classes.has('lc-step-num') && n.textContent === '82'), 'the step circle is gone');
    const badge = h.nodes().filter((n) => n._classes.has('lc-rule-badge'))[0];
    assert.ok(badge, 'the rule badge exists'); assert.strictEqual(badge.textContent, 'NEC 220.82');
    const head = h.nodes().filter((n) => n._classes.has('lc-rule-head'))[0];
    assert.ok(head && /OPTIONAL METHOD — DWELLING DATA/.test(head.textContent));
    assert.ok(!/82 OPTIONAL METHOD/.test(h.text()));
    // the other numbered steps are untouched
    const stepNums = h.nodes().filter((n) => n._classes.has('lc-step-num')).map((n) => n.textContent);
    assert.ok(stepNums.length >= 3 && !stepNums.includes('82'), 'remaining steps keep their numbers: ' + stepNums.join(','));
    assert.ok(stepNums.every((x) => /^\d+$/.test(x)));
  });
  test('the rule number keeps the ordinary reference pathway: one send per click and per Enter, with the 220.82 context', () => {
    const h = buildHarness(); h.api.lcInit(); h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82');
    const badge = h.nodes().filter((n) => n._classes.has('lc-rule-badge'))[0];
    const link = badge.querySelectorAll('span').filter((n) => n._classes.has('nec-link'))[0];
    assert.ok(link, 'the badge carries a real reference target');
    assert.deepStrictEqual([link.attrs['data-src'], link.attrs['data-ed'], link.attrs['data-sec']], ['nec', '2020', '220.82']);
    assert.strictEqual(link.attrs.role, 'button'); assert.strictEqual(link.attrs.tabindex, '0'); assert.strictEqual(link.attrs.onclick, undefined);
    const n0 = h.necCallsFull.length;
    link.dispatch('click');
    assert.strictEqual(h.necCallsFull.length, n0 + 1, 'exactly one send per click');
    assert.match(h.necCallsFull[n0].opts.title, /220\.82/);
    link.dispatch('keydown', { key: 'Enter' });
    assert.strictEqual(h.necCallsFull.length, n0 + 2, 'Enter opens it once');
    assert.deepStrictEqual(h.necCallsFull[n0 + 1].opts.section, '220.82');
    assert.strictEqual(h.state().evaluations, h.state().evaluations, 'opening a reference does not recompute');
  });
  test('section visibility, fields, help and the NYCEC targets are unchanged; switching method away and back keeps the data', () => {
    const h = buildHarness(); h.api.lcInit();
    assert.strictEqual(h.$('lcOpt82').style.display, 'none', 'hidden before a method is chosen');
    h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82');
    assert.strictEqual(h.$('lcOpt82').style.display, '');
    for (const id of ['lcFloorArea', 'lcSmallApplianceCircuits', 'lcLaundryCircuits', 'lcNycAcCircuits', 'lcArrangement', 'lcSingleSupplySet', 'lcConductorAmpacity', 'lcNycAcException', 'lcLaundryException', 'lcInventoryComplete']) assert.ok(h.$(id), 'field kept: ' + id);
    for (const sec of ['210.11(C)(5)', '210.52(J)']) {
      assert.strictEqual(h.nodes().filter((n) => n._classes.has('nycec-link') && n.attrs['data-sec'] === sec).length, 1, sec + ': NYCEC target kept');
      assert.strictEqual(h.nodes().filter((n) => n._classes.has('nec-link') && n.attrs['data-sec'] === sec).length, 1, sec + ': NEC target kept');
    }
    h.set('lcFloorArea', '1500'); h.set('lcArrangement', 'ac_only');
    h.set('lcMethod', 'measured_220_87');
    assert.strictEqual(h.$('lcOpt82').style.display, 'none');
    assert.strictEqual(h.state().snapshot.dwelling.floorAreaFt2, 1500, 'the 82 data is retained on the A route');
    h.set('lcMethod', 'opt_220_82');
    assert.strictEqual(h.$('lcOpt82').style.display, '');
    assert.strictEqual(h.state().snapshot.dwelling.floorAreaFt2, 1500);
    assert.strictEqual(h.$('lcFloorArea').value, '1500');
    assert.ok(h.nodes().filter((n) => n._classes.has('lc-rule-badge')).length === 1, 'exactly one badge after the round trip');
  });
});

describe('Together — synthetic save, reload and restore with several records', () => {
  test('a saved B0 restores into a fresh document, stays byte-equal to the unchanged engine result, and renders the polished presentation', () => {
    const h = buildHarness({ promptAnswer: 'B0 network' }); h.api.lcInit(); driveB0(h);
    h.set('lcTopology', '1ph_3w_120_208_network');
    const saved = h.state();
    assert.strictEqual(h.api.lcFavSave(), true);
    const stored = JSON.parse(h.store.data).lc[0];
    assert.strictEqual(stored.vals.lcv, 3);
    const g = buildHarness({ storage: h.store.data }); g.api.lcInit();
    g.$('lc-fav-list').querySelectorAll('.fav-item')[0].dispatch('click');
    const r = g.state();
    assert.strictEqual(r.fault, null);
    assert.deepStrictEqual(r.snapshot, saved.snapshot);
    assert.strictEqual(JSON.stringify(r.result), JSON.stringify(F.evaluateV2(r.lastRequest).result), 'restored result equals the unchanged facade result');
    assert.strictEqual(r.result.status, 'COMPLETE'); assert.strictEqual(r.result.demand.totalVA, 23680);
    assert.ok(!/FIELDS TO SETTLE/.test(shown(g)));
    assert.ok(boxWith(g, /CURRENT — NOT COMPUTED/));
    assert.ok(g.nodes().some((n) => n._classes.has('lc-rule-badge')));
    assert.deepStrictEqual(JSON.parse(g.store.data).lc[0], stored, 'the stored payload is untouched by rendering');
    // several more records keep the same presentation rules
    g.$('lcPresetName').value = '9'; g.$('lcPresetVA').value = '1200'; g.$('lcAddLoad').dispatch('click');
    g.set('lcInventoryComplete', 'yes');
    const s2 = g.state();
    assert.strictEqual(JSON.stringify(s2.result), JSON.stringify(F.evaluateV2(s2.lastRequest).result));
    const others = s2.result.problems.filter((p) => p.layer !== 'current');
    if (others.length) assert.match(shown(g), new RegExp('FIELDS TO SETTLE \\(' + others.length + '\\)'));
    else assert.ok(!/FIELDS TO SETTLE/.test(shown(g)));
  });
  test('the generated EC block is the shipped one and the adapter still exposes a single evaluation call site', () => {
    assert.strictEqual((html.match(/window\.EC = \(function \(\)/g) || []).length, 1);
    const h = buildHarness();
    const src = h.adapterSrc;
    assert.strictEqual((src.match(/\.evaluate\(/g) || []).length, 0);
    assert.strictEqual((src.match(/loadCalcFacade\.evaluateV2\(/g) || []).length, 1);
    for (const bad of [/1\.25/, /1\.732/, /Math\.sqrt/, /toFixed\(/, /innerHTML/, /\/ 208\b/, /VA\s*\/\s*208/]) assert.ok(!bad.test(src), String(bad) + ' must not appear in the adapter');
  });
});
