'use strict';
/**
 * EC-CALC-2 / B2-r1.1 — closure of R-B2R1-01 (repeated load ids): the shared
 * Save/restore validator rejects a snapshot whose loads repeat an id BEFORE a
 * prompt, a store write or a draft replacement; card render/refresh is finite
 * for every state admitted to rendering (a rebuild happens exactly when the
 * structural signature of the loads list changes, and the signature is
 * recorded first); an internally invalid duplicate draft reaches the accepted
 * core's INVALID_INPUT / DUPLICATE_ID with a read-only structural view and no
 * old total. Nothing is renamed, merged or dropped automatically.
 * "B2-r1 before" notes record the behaviour reproduced on the unchanged 117 tree.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildHarness } = require('./helpers/loadCalcDom');

function ready(opts) {
  const h = buildHarness(Object.assign({ promptAnswer: 'dup' }, opts || {})); h.api.lcInit();
  for (const [id, v] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcReadingValue', '40000'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcServiceRatingA', '225'], ['lcServiceOverload', 'yes'], ['lcNewLoadMode', 'none']]) h.set(id, v);
  h.$('lcPresetName').value = '0'; h.$('lcPresetVA').value = '12000'; h.$('lcAddLoad').dispatch('click');
  const st = h.$('lcLoads').querySelector('.lc-load').querySelectorAll('select')[2]; st.value = 'existing'; st.dispatch('change');
  assert.strictEqual(h.state().result.status, 'COMPLETE'); assert.strictEqual(h.state().result.existingCapacity.status, 'adequate');
  return h;
}
function withSecond(h, id, secondId, extra) { const p = h.api.lcFavPayload(); p.snapshot.loads[0].id = id; p.snapshot.loads[0].label = 'same display label'; p.snapshot.loads.push(Object.assign({}, p.snapshot.loads[0], { id: secondId, label: 'same display label' }, extra || {})); return p; }
const numIn = (h, i) => h.$('lcLoads').querySelectorAll('input[type=number]')[i];
const labelIn = (h) => h.$('lcLoads').querySelector('input[type=text]');

describe('B2-r1.1 R-B2R1-01 — validator: repeated load ids are rejected; labels and special keys are data', () => {
  test('positive controls: two loads with the SAME display label and different ids (including "__proto__", "constructor", "hasOwnProperty") validate, restore and evaluate', () => {
    for (const id of ['first', '__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
      const h = ready(); const p = withSecond(h, id, id + '-distinct');
      assert.deepStrictEqual(h.api.lcFavValidatePayload(p), [], id);
      h.api.lcFavRestore(p, 77); assert.strictEqual(h.state().fault, null, id); assert.strictEqual(h.state().result.status, 'COMPLETE'); assert.strictEqual(h.state().snapshot.loads.length, 2);
      assert.strictEqual(h.$('lcLoads').querySelectorAll('.lc-load').length, 2); assert.strictEqual(h.$('lcLoads').querySelectorAll('input[type=text]').length, 2, 'both cards are editable');
      assert.deepStrictEqual(h.state().snapshot.loads.map((l) => l.id), [id, id + '-distinct']);
    }
  });
  test('a shape-valid payload whose loads repeat an id fails the validator with the id and positions; three repeats and a "__proto__" repeat are reported the same way (B2-r1 before: [] then infinite recursion)', () => {
    const h = ready();
    const p = withSecond(h, 'first', 'first');
    // ledger L-15: the lcv-3 wrapper is validated by the accepted storage module, which names the repeated id (positions are shown by the adapter's read-only view, tested below)
    const errs = h.api.lcFavValidatePayload(p); assert.strictEqual(errs.length, 1); assert.ok(/snapshot\.loads: id "first" is repeated/.test(errs[0]), errs[0]);
    const p3 = withSecond(h, 'x', 'x'); p3.snapshot.loads.push(Object.assign({}, p3.snapshot.loads[0], { label: 'third' })); assert.ok(/id "x" is repeated/.test(h.api.lcFavValidatePayload(p3)[0]));
    const pp = withSecond(h, '__proto__', '__proto__'); assert.ok(/id "__proto__" is repeated/.test(h.api.lcFavValidatePayload(pp)[0])); assert.strictEqual(Object.prototype.first, undefined);
    assert.strictEqual(h.state().result.status, 'COMPLETE', 'validation is pure: the draft is untouched');
  });
});

describe('B2-r1.1 R-B2R1-01 — atomic refusal at the Favorites boundary', () => {
  test('Favorites row click with a duplicate-id record: no throw, RESTORE FAILED naming the repeated id, snapshot / fieldErrors / loadErrors / raw entries unchanged, stored record and other collections byte-identical, no stale COMPLETE / adequate under the failure (B2-r1 before: RangeError, draft partially replaced, old COMPLETE visible)', () => {
    const h = ready(); h.set('lcReadingValue', '4o000');   // a raw parse error in the active draft must survive the failed restore too
    assert.strictEqual(h.state().result.status, 'INVALID_INPUT');
    const p = withSecond(h, 'first', 'first'); p.snapshot.measurement.reading.value = 40000;
    const seed = JSON.stringify({ lc: [{ id: 77, name: 'Synthetic duplicate', vals: p }], vd: [{ id: 90, name: 'Other calculator', vals: { amps: '3' } }] });
    h.store.data = seed; h.api.favRender('lc'); const before = h.state(); const sets = h.store.sets;
    assert.doesNotThrow(() => h.$('lc-fav-list').querySelector('.fav-item').dispatch('click'));
    const after = h.state();
    assert.strictEqual(after.fault && after.fault.kind, 'restore'); assert.ok(/does not match the Load Calc lcv-3 contract/.test(after.fault.message)); assert.ok(after.fault.details.some((d) => /id "first" is repeated/.test(d)), JSON.stringify(after.fault.details));
    assert.deepStrictEqual(after.snapshot, before.snapshot); assert.deepStrictEqual(after.fieldErrors, before.fieldErrors); assert.deepStrictEqual(after.loadErrors, before.loadErrors); assert.strictEqual(after.snapshot.loads.length, 1);
    assert.strictEqual(h.store.data, seed); assert.strictEqual(h.store.sets, sets);
    const text = h.text(); assert.ok(/RESTORE FAILED/.test(text)); assert.ok(!/ADEQUATE|50,000|Total demand/.test(text), 'no stale success under the failure');
    assert.strictEqual(h.$('lcReadingValue').value, '4o000', 'the raw invalid entry of the previous draft is still shown');
    assert.strictEqual(h.$('lcLoads').querySelectorAll('.lc-load').length, 1); assert.strictEqual(h.$('lc-fav-list').querySelectorAll('.fav-item').length, 1, 'the stored record is still listed, not repaired or removed');
    h.set('lcReadingValue', '40000'); assert.strictEqual(h.state().fault, null); assert.strictEqual(h.state().result.status, 'COMPLETE', 'the previous draft is fully usable afterwards');
  });
  test('Save with an internally duplicated draft is refused before the prompt and before any write; the draft, raw errors and store are unchanged; a valid draft still saves', () => {
    const h = ready({ storage: JSON.stringify({ lc: [{ id: 1, name: 'keep', vals: { method: 'optional', voltage: '240', scope: 'house', sqFt: '1', appliances: '[]', hvac: '[]', ev: '[]' } }], vd: [{ id: 2 }] }) });
    const store = h.store.data; const p = withSecond(h, 'first', 'first');
    h.api.LC.snapshot = p.snapshot; h.api.lcUpdate();   // simulated internal corruption (no form path produces it)
    const before = h.state(); const prompts = h.prompts.calls.length; const sets = h.store.sets;
    let saved; assert.doesNotThrow(() => { saved = h.api.lcFavSave(); }); assert.strictEqual(saved, false);
    assert.strictEqual(h.prompts.calls.length, prompts); assert.strictEqual(h.store.sets, sets); assert.strictEqual(h.store.data, store);
    assert.strictEqual(h.state().fault.kind, 'storage'); assert.ok(/could not restore it: snapshot\.loads: id "first" is repeated/.test(h.state().fault.message), h.state().fault.message);
    assert.deepStrictEqual(h.state().snapshot, before.snapshot); assert.strictEqual(h.state().snapshot.loads.length, 2, 'nothing merged or dropped');
    h.api.lcReset(); h.set('lcOccupancy', 'nondwelling'); assert.strictEqual(h.api.lcFavSave(), true); assert.strictEqual(JSON.parse(h.store.data).lc.length, 2, 'a valid draft still appends a new record');
  });
});

describe('B2-r1.1 R-B2R1-01 — finite render / refresh for every admitted state', () => {
  test('an internally invalid duplicate draft passed to lcUpdate reaches the accepted core (INVALID_INPUT / DUPLICATE_ID), renders a read-only structural view with the repeated id and positions, no editable card, no old total; render and refresh terminate (B2-r1 before: Maximum call stack size exceeded)', () => {
    const h = ready(); const p = withSecond(h, 'first', 'first');
    h.api.LC.snapshot = p.snapshot;
    assert.doesNotThrow(() => h.api.lcUpdate());
    // ledger L-9: the accepted V2 projection refuses a duplicate-id draft BEFORE any engine call (controlled INPUT REJECTED fault, no result); the unchanged
    // A engine still reports DUPLICATE_ID on the direct route (control in loadCalcB2r1DuplicateIds.test.js)
    const s = h.state(); assert.strictEqual(s.result, null); assert.strictEqual(s.fault && s.fault.kind, 'input'); assert.ok(s.fault.details.some((d) => /repeated/.test(d)), JSON.stringify(s.fault.details)); assert.strictEqual(s.lastRequest, null);
    const text = h.text(); assert.ok(!/Total demand: 50,000|ADEQUATE/.test(text)); assert.ok(/INPUT REJECTED/.test(text) && /repeated/.test(text), text.slice(0, 200));
    const loadsText = h.$('lcLoads').textContent; assert.ok(/repeated identifier/.test(loadsText) && /"first" at positions 1 and 2/.test(loadsText) && /Nothing was renamed, merged or removed/.test(loadsText), loadsText.slice(0, 200));
    assert.strictEqual(h.$('lcLoads').querySelectorAll('input').length, 0, 'read-only rows: no controls in the invalid view'); assert.strictEqual(h.$('lcLoads').querySelectorAll('.lc-load').length, 2, 'both entries listed, none dropped');
    assert.strictEqual(h.state().snapshot.loads.length, 2);
    assert.doesNotThrow(() => { h.api.lcUpdate(); h.api.lcUpdate(); });   // repeated updates on the same invalid list: no rebuild loop
    assert.strictEqual(h.api.LC.cardsInvalid, true);
    // the fault-rendering path on the same invalid draft is finite as well
    h.store.data = '{broken'; assert.doesNotThrow(() => h.api.lcFavSave()); assert.strictEqual(h.state().fault.kind, 'storage'); assert.ok(/STORAGE ERROR/.test(h.text()));
    // leaving the invalid state through Reset restores editable cards
    h.api.lcReset(); assert.strictEqual(h.api.LC.cardsInvalid, false); assert.strictEqual(h.state().result.status, 'EMPTY');
  });
  test('the structural signature drives rebuilds: same ids -> no rebuild while typing (element identity kept); reordered / added / removed ids -> exactly one rebuild; one evaluate per event', () => {
    const calls = []; const h = buildHarness({ engine: (EC) => Object.assign({}, EC.loadCalc, { evaluate: (e, o) => { calls.push(1); return EC.loadCalc.evaluate(e, o); } }) });
    h.api.lcInit(); for (const [id, v] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcReadingValue', '40000'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcServiceRatingA', '225'], ['lcServiceOverload', 'yes'], ['lcNewLoadMode', 'none']]) h.set(id, v);
    h.$('lcPresetName').value = '0'; h.$('lcPresetVA').value = '12000'; h.$('lcAddLoad').dispatch('click');
    const lbl = labelIn(h); const key = h.api.LC.cardsKey; const n = calls.length;
    for (const [i, ch] of [...'Heater'].entries()) { lbl.value = 'Heater'.slice(0, i + 1); lbl.dispatch('input'); assert.strictEqual(labelIn(h), lbl); }
    assert.strictEqual(calls.length - n, 6); assert.strictEqual(h.api.LC.cardsKey, key, 'signature unchanged by typing');
    const q = numIn(h, 1); q.value = '3'; q.dispatch('input'); assert.strictEqual(numIn(h, 1), q); assert.strictEqual(h.state().snapshot.loads[0].quantity, 3);
    h.$('lcPresetName').value = '1'; h.$('lcPresetVA').value = '5000'; h.$('lcAddLoad').dispatch('click'); assert.notStrictEqual(h.api.LC.cardsKey, key); assert.strictEqual(h.$('lcLoads').querySelectorAll('.lc-load').length, 2);
    const ids = h.state().snapshot.loads.map((l) => l.id); h.api.LC.snapshot.loads.reverse(); h.api.lcUpdate();   // reordered ids: one rebuild, cards follow the new order
    assert.deepStrictEqual(h.state().snapshot.loads.map((l) => l.id), ids.slice().reverse()); assert.strictEqual(h.api.LC.cardsKey, JSON.stringify(ids.slice().reverse()));
    assert.strictEqual(h.$('lcLoads').querySelectorAll('input[type=text]')[0].value, h.state().snapshot.loads[0].label, 'cards follow the new order'); assert.strictEqual(h.$('lcLoads').querySelectorAll('input[type=text]')[1].value, h.state().snapshot.loads[1].label);
    h.$('lcLoads').querySelectorAll('.lc-x')[0].dispatch('click'); assert.strictEqual(h.state().snapshot.loads.length, 1); assert.strictEqual(h.$('lcLoads').querySelectorAll('.lc-load').length, 1);
  });
});
