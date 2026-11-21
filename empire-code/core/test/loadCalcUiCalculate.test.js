'use strict';
/**
 * LC-UI-CALCULATE-1 — the 220.82 Calculate / Recalculate UX.
 *
 * Runs the shipped adapter (test/helpers/loadCalcDom.js) against the real generated EC block with real control
 * events. Engine values are compared with the unchanged facade required directly; nothing here re-derives NEC
 * arithmetic. Storage is synthetic only.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildHarness } = require('./helpers/loadCalcDom.js');
const F = require('../src/calc/loadCalcFacade.js');

const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const ctl = (card, role) => card.querySelectorAll('input, select, button').filter((e) => e.attrs['data-role'] === role)[0];
const setIn = (el, v) => { el.value = v; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
const addLoad = (h, preset, va) => { h.$('lcPresetName').value = String(preset); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click'); };
const calc = (h) => h.$('lcCalcBtn').dispatch('click');
const focusLog = (h) => h.dom.document.focusLog;
const marked = (h) => h.nodes().filter((n) => n._classes.has('lc-calc-invalid'));
const msgs = (h) => h.nodes().filter((n) => n._classes.has('lc-calc-msg'));
const ariaInvalid = (h) => h.nodes().filter((n) => n.attrs['aria-invalid'] === 'true');
const goRows = (h) => h.nodes().filter((n) => n._classes.has('lc-problem-go'));
const visible = (el) => { for (let n = el; n; n = n.parent) { if (n.style && n.style.display === 'none') return false; if (n.id === 'lcForm') return true; } return false; };
const STALE = 'Inputs changed — press Recalculate.';

/** the accepted B0 dwelling (23,680 VA), entered through the real controls */
function driveB0(h, o) {
  const p = Object.assign({ topology: '1ph_3w_120_240', model: 'split_240_balanced_LN' }, o || {});
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', p.topology); h.set('lcModel', p.model); h.set('lcDeclBalancedLN', 'yes');
  h.set('lcFloorArea', '1500'); h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '1'); h.set('lcNycAcCircuits', '0');
  h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); h.set('lcConductorAmpacity', '200'); h.set('lcNycAcException', 'yes');
  for (const [preset, va] of [[0, 12000], [3, 4500], [1, 5000], [2, 1200], [4, 5000]]) addLoad(h, preset, va);
  setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit');
  setIn(ctl(cards(h)[3], 'inclusion'), 'fixed_or_permanently_connected');
  setIn(ctl(cards(h)[4], 'coverage'), 'yes');
  h.set('lcInventoryComplete', 'yes');
}
function fresh82() { const h = buildHarness(); h.api.lcInit(); h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); return h; }

describe('LC-UI-CALCULATE-1 — labels and first-attempt gating', () => {
  test('the Calculate button exists only on the 220.82 route, before the result; Calculate -> Recalculate after the first press', () => {
    const h = buildHarness(); h.api.lcInit();
    assert.strictEqual(h.$('lcCalcBar').style.display, 'none', 'hidden with no method');
    h.set('lcMethod', 'measured_220_87'); assert.strictEqual(h.$('lcCalcBar').style.display, 'none', 'hidden on 220.87');
    h.set('lcMethod', 'opt_220_82'); assert.strictEqual(h.$('lcCalcBar').style.display, '');
    const form = h.$('lcForm').children; assert.ok(form.indexOf(h.$('lcCalcBar')) < form.indexOf(h.$('lcResult')), 'placed before the result');
    assert.strictEqual(h.$('lcCalcBtn').textContent, 'Calculate'); assert.strictEqual(h.$('lcCalcBtn').attrs.type, 'button');
    calc(h); assert.strictEqual(h.$('lcCalcBtn').textContent, 'Recalculate');
    h.set('lcFloorArea', '1200'); assert.strictEqual(h.$('lcCalcBtn').textContent, 'Recalculate', 'an edit keeps the Recalculate label');
  });
  test('before the first Calculate: internal evaluation runs, but no status, total or red mark is shown for incomplete empty fields', () => {
    const h = fresh82();
    assert.strictEqual(h.state().result.status, 'INCOMPLETE_INPUT', 'the engine still evaluates internally');
    const t = h.text(); assert.match(t, /press Calculate/); assert.ok(!/INCOMPLETE|FIELDS TO SETTLE|Total demand/.test(t), t);
    assert.deepStrictEqual(marked(h), []); assert.deepStrictEqual(ariaInvalid(h), []); assert.deepStrictEqual(msgs(h), []);
    assert.strictEqual(h.nodes().filter((n) => n._classes.has('lc-invalid')).length, 0, 'no red border on empty fields');
    driveB0(h); const t2 = h.text(); assert.strictEqual(h.state().result.status, 'COMPLETE'); assert.ok(!/Total demand|23,680|Line current|LOAD COVERAGE/.test(t2), 'a complete draft is not displayed before Calculate');
    assert.ok(cards(h).every((c) => !/Coverage:/.test(c.textContent)), 'no per-record coverage numbers before Calculate');
    assert.deepStrictEqual(focusLog(h).scrolls, [], 'nothing scrolls before Calculate');
  });
});

describe('LC-UI-CALCULATE-1 — red marks, inline text, focus and scroll', () => {
  test('Calculate marks every current actionable issue with a red border, aria-invalid, aria-describedby and a text explanation', () => {
    const h = fresh82(); const before = h.state().evaluations; calc(h);
    assert.strictEqual(h.state().evaluations, before + 1, 'exactly one fresh evaluation per press');
    const r = h.state().result; assert.strictEqual(r.status, 'INCOMPLETE_INPUT'); assert.match(h.text(), /FIELDS TO SETTLE/);
    const expectIds = { 'supply.topology': 'lcTopology', 'dwelling.floorAreaFt2': 'lcFloorArea', 'dwelling.smallApplianceCircuits': 'lcSmallApplianceCircuits', 'dwelling.laundryCircuits': 'lcLaundryCircuits', 'hvac.arrangement': 'lcArrangement', 'optional82.singleSupplySet': 'lcSingleSupplySet', 'optional82.conductorAmpacityA': 'lcConductorAmpacity', 'optional82.inventoryComplete': 'lcInventoryComplete', 'dwelling.nycAcCircuitCount': 'lcNycAcCircuits' };
    const actionable = r.problems.filter((p) => p.layer !== 'current' && expectIds[p.field]);
    assert.ok(actionable.length >= 5, 'several issues: ' + r.problems.map((p) => p.code + '@' + p.field).join());
    for (const p of actionable) {
      const el = h.$(expectIds[p.field]);
      assert.ok(el._classes.has('lc-calc-invalid'), p.field + ' has the red class');
      assert.strictEqual(el.attrs['aria-invalid'], 'true', p.field);
      const msg = h.$(el.attrs['aria-describedby']); assert.ok(msg, p.field + ' is described'); assert.ok(el.parent.children.includes(msg), 'inline, next to the control');
      assert.match(msg.textContent, /^Needs attention — /); assert.ok(msg.textContent.length < 120, 'concise');
    }
    for (const m of msgs(h)) assert.match(m.id, /^lcCalcMsg\d+$/, 'message ids are counters, never derived from user or load ids');
  });
  test('focus and scroll go to the first actionable issue in form order, and never to a hidden element', () => {
    const h = fresh82(); h.set('lcTopology', '1ph_3w_120_240'); h.set('lcFloorArea', '1500'); calc(h);
    assert.strictEqual(h.dom.document.activeElement, h.$('lcSmallApplianceCircuits'), 'floor area is settled; the next dwelling field is first');
    assert.strictEqual(focusLog(h).scrolls.slice(-1)[0], h.$('lcSmallApplianceCircuits'));
    assert.ok(focusLog(h).focuses.every(visible) && focusLog(h).scrolls.filter((e) => e.id !== 'lcResult').every(visible), 'no display:none target');
    // a load-card issue: the mapped control inside the card
    const g = fresh82(); driveB0(g); setIn(ctl(cards(g)[2], 'inclusion'), ''); g.set('lcInventoryComplete', 'yes'); calc(g);
    const inc = ctl(cards(g)[2], 'inclusion');
    assert.strictEqual(g.dom.document.activeElement, inc); assert.ok(inc._classes.has('lc-calc-invalid')); assert.strictEqual(inc.attrs['aria-invalid'], 'true');
    assert.match(g.$(inc.attrs['aria-describedby']).textContent, /missing/);
  });
  test('a hidden mapped control is never focused: navigation falls back to its visible load card', () => {
    const h = fresh82(); driveB0(h); setIn(ctl(cards(h)[2], 'inclusion'), ''); h.set('lcInventoryComplete', 'yes'); calc(h);
    const card = cards(h)[2]; const inc = ctl(card, 'inclusion'); assert.strictEqual(h.dom.document.activeElement, inc);
    inc.parent.style.display = 'none';   // the control becomes display:none (e.g. hidden by another section) before the row is used
    goRows(h).find((r) => /inclusion answer/.test(r.textContent)).dispatch('click');
    assert.strictEqual(h.dom.document.activeElement, card, 'the visible card, not the hidden control'); assert.strictEqual(card.attrs.tabindex, '-1');
    assert.ok(focusLog(h).focuses.slice(1).every(visible));
  });
});

describe('LC-UI-CALCULATE-1 — FIELDS TO SETTLE navigation', () => {
  test('rows are click and keyboard (Enter / Space) navigable to their control or card', () => {
    const h = fresh82(); calc(h);
    const rows = goRows(h); assert.ok(rows.length >= 5);
    for (const r of rows) { assert.strictEqual(r.attrs.role, 'button'); assert.strictEqual(r.attrs.tabindex, '0'); }
    const floor = rows.find((r) => /Floor area/.test(r.textContent)); floor.dispatch('click'); assert.strictEqual(h.dom.document.activeElement, h.$('lcFloorArea'));
    const inv = rows.find((r) => /Inventory completeness/.test(r.textContent)); inv.dispatch('keydown', { key: 'Enter' }); assert.strictEqual(h.dom.document.activeElement, h.$('lcInventoryComplete'));
    const topo = rows.find((r) => /Supply topology/.test(r.textContent)); topo.dispatch('keydown', { key: ' ' }); assert.strictEqual(h.dom.document.activeElement, h.$('lcTopology'));
    const n = focusLog(h).focuses.length; floor.dispatch('keydown', { key: 'a' }); assert.strictEqual(focusLog(h).focuses.length, n, 'other keys do nothing');
    // a load row goes to the card control
    const g = fresh82(); driveB0(g); setIn(ctl(cards(g)[3], 'inclusion'), ''); g.set('lcInventoryComplete', 'yes'); calc(g);
    const lr = goRows(g).find((r) => /inclusion answer/.test(r.textContent)); assert.ok(lr); lr.dispatch('click');
    assert.strictEqual(g.dom.document.activeElement, ctl(cards(g)[3], 'inclusion'));
  });
  test('the 220.87 route problem rows are not turned into navigation targets', () => {
    const h = buildHarness(); h.api.lcInit(); h.set('lcMethod', 'measured_220_87');
    assert.match(h.text(), /FIELDS TO SETTLE/); assert.deepStrictEqual(goRows(h), []);
  });
});

describe('LC-UI-CALCULATE-1 — live mark updates after the first attempt', () => {
  test('a corrected field loses its mark, a newly current issue is marked, and normal edits never scroll or move focus', () => {
    const h = fresh82(); calc(h);
    assert.ok(h.$('lcFloorArea')._classes.has('lc-calc-invalid'));
    const scrolls = focusLog(h).scrolls.length; const focuses = focusLog(h).focuses.length;
    h.set('lcFloorArea', '1500');
    assert.ok(!h.$('lcFloorArea')._classes.has('lc-calc-invalid')); assert.strictEqual(h.$('lcFloorArea').attrs['aria-invalid'], undefined); assert.strictEqual(h.$('lcFloorArea').attrs['aria-describedby'], undefined);
    assert.ok(!msgs(h).some((m) => m.parent === h.$('lcFloorArea').parent), 'its inline text is removed');
    assert.ok(h.$('lcSmallApplianceCircuits')._classes.has('lc-calc-invalid'), 'unresolved marks stay');
    h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '0');
    assert.ok(h.$('lcLaundryCircuits')._classes.has('lc-calc-invalid'), 'a laundry count of zero is a newly current issue');
    assert.match(h.$(h.$('lcLaundryCircuits').attrs['aria-describedby']).textContent, /not verified/);
    assert.strictEqual(focusLog(h).scrolls.length, scrolls, 'no auto-scroll on edits'); assert.strictEqual(focusLog(h).focuses.length, focuses, 'no focus move on edits');
    assert.strictEqual(new Set(msgs(h).map((m) => m.id)).size, msgs(h).length, 'no duplicated messages');
  });
});

describe('LC-UI-CALCULATE-1 — stale results', () => {
  test('after a displayed COMPLETE result, an edit hides every operative number and shows the Recalculate status; Recalculate shows the new result', () => {
    const h = fresh82(); driveB0(h); calc(h);
    assert.match(h.text(), /Total demand: 23,680 VA/); assert.match(h.text(), /Line current: 98.7 A/); assert.strictEqual(h.$('lcCalcStatus').textContent, '');
    assert.ok(cards(h).some((c) => /Coverage:/.test(c.textContent)));
    h.set('lcFloorArea', '1600');
    const t = h.text(); assert.ok(!/Total demand|23,680|Line current|COMPLETE|LOAD COVERAGE|GENERAL-LOAD/.test(t), t); assert.ok(t.includes(STALE));
    assert.ok(cards(h).every((c) => !/Coverage:/.test(c.textContent)), 'per-card coverage numbers hidden too');
    const st = h.$('lcCalcStatus'); assert.strictEqual(st.textContent, STALE); assert.strictEqual(st.attrs.role, 'status'); assert.strictEqual(st.attrs['aria-live'], 'polite');
    calc(h); const r = h.state().result; assert.strictEqual(JSON.stringify(r), JSON.stringify(F.evaluateV2(h.state().lastRequest).result));
    assert.strictEqual(r.status, 'COMPLETE'); assert.ok(h.text().includes('Total demand: ' + r.display.strings.totalVA)); assert.strictEqual(st.textContent, '');
  });
  test('a displayed PARTIAL subtotal is hidden by the next edit as well', () => {
    const h = fresh82(); driveB0(h); addLoad(h, 7, 7200); h.set('lcInventoryComplete', 'yes'); calc(h);
    assert.strictEqual(h.state().result.status, 'PARTIAL'); assert.match(h.text(), /GENERAL-LOAD SUBTOTAL/);
    h.set('lcConductorAmpacity', '201');
    assert.ok(!/SUBTOTAL|18,680|PARTIAL/.test(h.text())); assert.ok(h.text().includes(STALE));
  });
  test('an edit that reproduces the calculated request shows that result again (no false staleness)', () => {
    const h = fresh82(); driveB0(h); calc(h);
    h.set('lcFloorArea', '1600'); assert.ok(h.text().includes(STALE)); h.set('lcFloorArea', '1500');
    assert.match(h.text(), /Total demand: 23,680 VA/);
  });
});

describe('LC-UI-CALCULATE-1 — reset, restore and method switching', () => {
  test('Reset clears the attempted state, the marks and the stale status', () => {
    const h = fresh82(); calc(h); assert.ok(marked(h).length);
    h.api.lcReset(); assert.deepStrictEqual(marked(h), []); assert.deepStrictEqual(msgs(h), []); assert.strictEqual(h.$('lcCalcBtn').textContent, 'Calculate'); assert.strictEqual(h.api.LC_CALC.attempted, false);
    h.set('lcMethod', 'opt_220_82'); assert.match(h.text(), /press Calculate/); assert.deepStrictEqual(marked(h), []); assert.strictEqual(h.$('lcCalcStatus').textContent, '');
  });
  test('leaving opt_220_82 drops the attempted state; re-entering starts before the first Calculate', () => {
    const h = fresh82(); driveB0(h); calc(h); assert.match(h.text(), /23,680/);
    h.set('lcMethod', 'measured_220_87'); assert.strictEqual(h.$('lcCalcBar').style.display, 'none'); assert.deepStrictEqual(marked(h), []); assert.strictEqual(h.$('lcCalcStatus').textContent, '');
    h.set('lcMethod', 'opt_220_82');
    assert.strictEqual(h.$('lcCalcBtn').textContent, 'Calculate'); assert.ok(!/23,680|Total demand/.test(h.text())); assert.match(h.text(), /press Calculate/); assert.ok(!h.text().includes(STALE));
  });
  test('a restored 220.82 preset is evaluated internally but needs a fresh Calculate to display its result', () => {
    const h = buildHarness({ promptAnswer: 'B0' }); h.api.lcInit(); driveB0(h); calc(h); assert.strictEqual(h.api.lcFavSave(), true);
    // restore into the same (already calculated) document and into a fresh one
    for (const g of [h, (() => { const x = buildHarness({ storage: h.store.data }); x.api.lcInit(); return x; })()]) {
      g.set('lcFloorArea', '1700');
      g.$('lc-fav-list').querySelectorAll('.fav-item')[0].dispatch('click');
      assert.strictEqual(g.state().fault, null); assert.strictEqual(g.state().result.status, 'COMPLETE'); assert.strictEqual(g.state().result.demand.totalVA, 23680);
      assert.ok(!/Total demand|23,680/.test(g.text())); assert.match(g.text(), /press Calculate/); assert.ok(!g.text().includes(STALE));
      assert.strictEqual(g.$('lcCalcBtn').textContent, 'Calculate'); assert.deepStrictEqual(marked(g), []);
      assert.match(g.$('lcFavStatus').textContent, /Press Calculate to show the 220\.82 result/);
      calc(g); assert.match(g.text(), /Total demand: 23,680 VA/);
    }
  });
});

describe('LC-UI-CALCULATE-1 — 120/208 current-only exception (P2 preserved)', () => {
  test('COMPLETE demand with only current-layer problems is a successful Calculate: no red field, no FIELDS TO SETTLE, no focus jump', () => {
    const h = fresh82(); driveB0(h, { topology: '1ph_3w_120_208_network' }); calc(h);
    const r = h.state().result; assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.current.status, 'not_computed');
    assert.ok(r.problems.length && r.problems.every((p) => p.layer === 'current'));
    const t = h.text(); assert.match(t, /Total demand: 23,680 VA/); assert.match(t, /CURRENT — NOT COMPUTED/); assert.ok(!/FIELDS TO SETTLE/.test(t)); assert.ok(!t.includes(STALE));
    assert.deepStrictEqual(marked(h), []); assert.deepStrictEqual(ariaInvalid(h), []); assert.ok(!h.$('lcModel')._classes.has('lc-calc-invalid'));
    assert.strictEqual(h.dom.document.activeElement, null, 'no field focus on success'); assert.strictEqual(focusLog(h).scrolls.slice(-1)[0], h.$('lcResult'), 'the result is brought into view');
  });
});

describe('LC-UI-CALCULATE-1 — nothing is auto-confirmed and storage is unchanged', () => {
  test('Calculate never answers Yes/No, premises, inventory, A/C coverage, inclusion or the imported method', () => {
    const h = fresh82(); const before = JSON.stringify(h.state().snapshot); calc(h); calc(h);
    assert.strictEqual(JSON.stringify(h.state().snapshot), before, 'the draft is untouched by Calculate');
    const rec = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: '[]', hvac: '[]', ev: '[]' };
    const g = buildHarness(); g.api.lcInit(); g.api.favSetValues('lc', rec, 7); calc(g);
    assert.strictEqual(g.state().context.methodConfirmedAfterImport, false);
    assert.ok(g.$('lcConfirmMethod')._classes.has('lc-calc-invalid'), 'the explicit confirmation is pointed at, not performed');
  });
  test('Save writes the same bytes with or without Calculate / Recalculate / stale UI state', () => {
    const a = buildHarness({ promptAnswer: 'x' }); a.api.lcInit(); driveB0(a);
    const b = buildHarness({ promptAnswer: 'x' }); b.api.lcInit(); driveB0(b); calc(b); b.set('lcFloorArea', '1600'); b.set('lcFloorArea', '1500'); calc(b); b.set('lcFloorArea', '1500');
    assert.strictEqual(JSON.stringify(b.api.lcFavPayload()), JSON.stringify(a.api.lcFavPayload()));
    assert.strictEqual(a.api.lcFavSave(), true); assert.strictEqual(b.api.lcFavSave(), true);
    assert.strictEqual(JSON.stringify(JSON.parse(b.store.data).lc[0].vals), JSON.stringify(JSON.parse(a.store.data).lc[0].vals));
    assert.ok(!/attempted|Recalculate|lcCalc|lc-calc/.test(b.store.data), 'no UI state in the stored bytes');
    assert.deepStrictEqual(Object.keys(b.api.lcDraft()).sort(), ['context', 'fieldErrors', 'loadErrors', 'snapshot', 'sourceFavId']);
  });
});

describe('LC-UI-CALCULATE-1 — the 220.87 route is unchanged', () => {
  test('220.87 renders its result on every edit with no Calculate button, gate, stale status or marks', () => {
    const h = buildHarness(); h.api.lcInit(); let n = h.state().evaluations;
    const steps = [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcReadingValue', '40000'], ['lcNewLoadMode', 'none'], ['lcServiceRatingA', '225'], ['lcServiceOverload', 'yes']];
    for (const [id, v] of steps) { h.set(id, v); n++; }
    assert.strictEqual(h.state().evaluations, n, 'one evaluation per edit, as before');
    const r = h.state().result; assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.profileId, 'A_measured_87_core');
    assert.match(h.text(), /Total demand/); assert.ok(!/press Calculate|Inputs changed/.test(h.text()));
    assert.strictEqual(h.$('lcCalcBar').style.display, 'none'); assert.deepStrictEqual(marked(h), []);
    h.set('lcReadingValue', '41000'); assert.match(h.text(), /Total demand/); assert.ok(!h.text().includes(STALE));
    assert.strictEqual(h.api.lcCalculate(), false, 'Calculate does nothing off the 220.82 route');
  });
});
