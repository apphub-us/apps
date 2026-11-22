'use strict';
/**
 * EC-CALC-2 / B2-r1 — explicit regressions for the independent-review findings
 * R-B2-01..06, executed against the REAL adapter block and shared Favorites
 * functions of mobile.html on the shipped bundle (stub DOM, fake storage).
 * Real keystrokes, caret edits and persisted reload are covered by
 * tools/loadcalc-check-mobile.js (native file:// origin) and the reviewer's
 * review-browser-regressions.cjs; the stub proves the structural/state contract.
 * "B2 before" notes record the behaviour reproduced on the unchanged B2 tree.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildHarness } = require('./helpers/loadCalcDom');
const H = require('./helpers/loadCalcFixtures');

const PROFILE = 'A_measured_87_core';
function annual(h, rating) {
  h.api.lcInit();
  for (const [id, v] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcReadingValue', '40000'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcServiceRatingA', rating || '225'], ['lcServiceOverload', 'yes'], ['lcNewLoadMode', 'none']]) h.set(id, v);
}
function addLoad(h, preset, va, status) { h.$('lcPresetName').value = String(preset === undefined ? 0 : preset); h.$('lcPresetVA').value = String(va === undefined ? 12000 : va); h.$('lcAddLoad').dispatch('click'); if (status) { const st = h.$('lcLoads').querySelectorAll('.lc-load').slice(-1)[0].querySelectorAll('select')[2]; st.value = status; st.dispatch('change'); } }
const numIn = (h, i) => h.$('lcLoads').querySelectorAll('input[type=number]')[i];
const labelIn = (h) => h.$('lcLoads').querySelector('input[type=text]');
function restoreRow(h, payload, id) { const store = JSON.stringify({ lc: [{ id: id === undefined ? 999 : id, name: 'synthetic', vals: payload }], vd: [{ id: 7, name: 'other', vals: { amps: '10' } }] }); h.store.data = store; h.api.favRender('lc'); h.$('lc-fav-list').querySelector('.fav-item').dispatch('click'); return store; }
const REF_RE = /(?:220\.(?:87|82|83|84|61|14)|230\.90|240\.4)/;
/** visible app text nodes carrying a reference number outside a nec-link (stub inventory; hidden subtrees and select/option/button excluded) */
function unlinkedRefs(h) {
  const out = [];
  const walk = (el, hidden, inLink) => {
    if (el.tagName === '#text') { if (!hidden && !inLink && REF_RE.test(el.textContent)) out.push(el.textContent.trim()); return; }
    const h2 = hidden || el.style.display === 'none' || ['SELECT', 'OPTION', 'BUTTON', 'SCRIPT', 'STYLE'].includes(el.tagName);
    const l2 = inLink || el._classes.has('nec-link') || el._classes.has('nycec-link');
    for (const c of el.children) walk(c, h2, l2);
  };
  walk(h.dom.container, false, false); return out;
}

describe('B2-r1 R-B2-01 — load-card controls persist across updates', () => {
  test('typing into label / rating / quantity keeps the SAME input element (no rebuild), the full text and one evaluate per event; a change after captureCoversSnapshot still applies (stale-closure regression)', () => {
    const calls = []; const h = buildHarness({ engine: (EC) => Object.assign({}, EC.loadCalc, { evaluate: (e, o) => { calls.push(1); return EC.loadCalc.evaluate(e, o); } }) });
    annual(h); addLoad(h, 7, 5000, 'new');
    const lbl = labelIn(h); const va = numIn(h, 0); const q = numIn(h, 1); const before = calls.length;
    for (const [i, ch] of [...'My new charger'].entries()) { lbl.value = 'My new charger'.slice(0, i + 1); lbl.dispatch('input'); assert.strictEqual(labelIn(h), lbl, 'label input recreated at keystroke ' + i); }
    assert.strictEqual(h.state().snapshot.loads[0].label, 'My new charger'); assert.strictEqual(calls.length - before, 14, 'one evaluate per keystroke');
    for (const v of ['3', '34', '345', '3456']) { va.value = v; va.dispatch('input'); assert.strictEqual(numIn(h, 0), va); }
    assert.strictEqual(h.state().snapshot.loads[0].rating.value, 3456);
    for (const v of ['1', '12']) { q.value = v; q.dispatch('input'); assert.strictEqual(numIn(h, 1), q); }
    assert.strictEqual(h.state().snapshot.loads[0].quantity, 12); assert.strictEqual(numIn(h, 1).value, '12');
    // a term confirmation replaces LC.snapshot; the persistent card must keep editing the CURRENT load
    h.set('lcNewLoadMode', 'precalculated'); h.set('lcTermVA', '3456'); h.set('lcTermConnection', 'LL'); h.set('lcTermEstablished', 'yes'); h.set('lcTermBasisMethod', 'other_stated'); h.set('lcTermCalculatedBy', 'engineer'); h.set('lcTermDemandFactors', 'yes');
    const cb = h.$('lcLoads').querySelector('input[type=checkbox]'); cb.checked = true; cb.dispatch('change'); h.$('lcConfirmCovers').dispatch('click');
    assert.strictEqual(h.state().result.status, 'COMPLETE');
    const q2 = numIn(h, 1); q2.value = '2'; q2.dispatch('input');
    assert.strictEqual(h.state().snapshot.loads[0].quantity, 2, 'edit after a snapshot replacement lands in the current draft'); assert.ok(h.state().result.problems.some((p) => p.code === 'AGGREGATE_STALE'));
    const l2 = labelIn(h); l2.value = 'Garage'; l2.dispatch('input'); assert.strictEqual(h.state().snapshot.loads[0].label, 'Garage');
  });
  test('structural changes rebuild; connection LN reveals the leg control in place; a topology change refreshes connection/leg options in place keeping the value', () => {
    const h = buildHarness(); annual(h); addLoad(h, 0, 12000, 'existing');
    const card0 = h.$('lcLoads').querySelector('.lc-load'); const sels = card0.querySelectorAll('select').filter((el) => !el.attrs['data-role'] || !['inclusion', 'coverage'].includes(el.attrs['data-role']));
    assert.strictEqual(sels.length, 6, 'category, classification, status, connection, leg (hidden), continuous (ledger L-12: the two 220.82 premise selects are excluded here and hidden on the A route)');
    assert.strictEqual(card0.querySelectorAll('select').length, 8); assert.ok(card0.querySelectorAll('select').filter((el) => ['inclusion', 'coverage'].includes(el.attrs['data-role'])).every((el) => el.parent.style.display === 'none'), 'premise selects are hidden under NEC 220.87');
    const legCtrl = sels[4].parent; assert.strictEqual(legCtrl.style.display, 'none');
    sels[3].value = 'LN'; sels[3].dispatch('change'); assert.strictEqual(h.$('lcLoads').querySelector('.lc-load'), card0, 'connection change is not a rebuild'); assert.strictEqual(legCtrl.style.display, '');
    sels[4].value = 'L2'; sels[4].dispatch('change'); assert.strictEqual(h.state().snapshot.loads[0].leg, 'L2');
    h.set('lcTopology', '3ph_4w_208Y_120'); h.set('lcModel', 'three_phase_balanced');
    const card1 = h.$('lcLoads').querySelector('.lc-load'); const s1 = card1.querySelectorAll('select');
    assert.ok(s1[3].children.some((o) => o.value === '3PH'), 'connection options follow the topology'); assert.strictEqual(s1[3].value, 'LN'); assert.strictEqual(s1[4].value, 'L2');
    addLoad(h, 1, 5000, 'existing'); assert.notStrictEqual(h.$('lcLoads').querySelector('.lc-load'), card1, 'adding a load is a structural rebuild');
    assert.strictEqual(h.$('lcLoads').querySelectorAll('.lc-load').length, 2);
    h.$('lcLoads').querySelectorAll('.lc-x')[0].dispatch('click'); assert.strictEqual(h.$('lcLoads').querySelectorAll('.lc-load').length, 1);
  });
});

describe('B2-r1 R-B2-02 — the Favorites wrapper is validated as a whole; Save never reports a record its loader cannot reopen', () => {
  test('quantity 0 / -1 are typed OUT_OF_RANGE errors (schema minimum in the transport); the draft stays schema-valid, Save succeeds and a fresh document restores the identical state with no fault (B2 before: "Saved" then RESTORE FAILED)', () => {
    for (const v of ['0', '-1']) {
      const h = buildHarness({ promptAnswer: 'q' }); annual(h); addLoad(h, 0, 12000, 'existing');
      const q = numIn(h, 1); q.value = v; q.dispatch('input');
      const before = h.state(); assert.deepStrictEqual(before.parseErrors, [{ field: 'loads[0].quantity', raw: v, code: 'OUT_OF_RANGE' }]); assert.strictEqual(before.fault, null); assert.strictEqual(before.result.status, 'INVALID_INPUT');
      assert.strictEqual(h.api.lcFavSave(), true);
      const h2 = buildHarness({ storage: h.store.data }); h2.api.lcInit(); h2.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
      const after = h2.state(); assert.strictEqual(after.fault, null); assert.deepStrictEqual(after.snapshot, before.snapshot); assert.deepStrictEqual(after.loadErrors, before.loadErrors); assert.deepStrictEqual(after.fieldErrors, before.fieldErrors); assert.deepStrictEqual(after.result, before.result);
      assert.strictEqual(numIn(h2, 1).value, v, 'the raw entry is shown again');
    }
  });
  test('Save refuses a draft the loader could not reopen (belt): an out-of-schema snapshot yields a storage fault with the reason, no prompt, nothing written', () => {
    const h = buildHarness({ promptAnswer: 'x' }); annual(h); addLoad(h, 0, 12000, 'existing');
    h.api.LC.snapshot.loads[0].quantity = 0;   // simulated corruption of the in-memory draft (no form path produces it after B2-r1)
    h.api.lcUpdate(); assert.strictEqual(h.state().fault.kind, 'input');
    assert.strictEqual(h.api.lcFavSave(), false); assert.strictEqual(h.store.data, null); assert.strictEqual(h.prompts.calls.length, 0);
    assert.strictEqual(h.state().fault.kind, 'storage'); assert.ok(/could not restore it/.test(h.state().fault.message) && /quantity/.test(h.state().fault.message), h.state().fault.message);
  });
  test('malformed present maps are rejected atomically, not normalized to {}: fieldErrors / loadErrors as array, string, null, number, plus unknown field path, unknown load id, extra entry key, extra payload key (B2 before: [] etc. became {} and INCOMPLETE turned COMPLETE/adequate)', () => {
    const h = buildHarness(); annual(h); addLoad(h, 0, 12000, 'existing');
    numIn(h, 1).value = ''; numIn(h, 1).dispatch('input');
    const before = h.state(); assert.strictEqual(before.result.status, 'INCOMPLETE_INPUT');
    const good = h.api.lcFavPayload(); const loadId = before.snapshot.loads[0].id;
    const cases = [];
    for (const [kind, bad] of [['array', []], ['string', 'bad-map'], ['null', null], ['number', 5]]) for (const f of ['fieldErrors', 'loadErrors']) cases.push([f + ' ' + kind, Object.assign({}, good, { [f]: bad })]);
    cases.push(['unknown field path', Object.assign({}, good, { fieldErrors: { 'measurement.nope': { raw: '', code: 'MISSING_FIELD' } } })]);
    cases.push(['unknown load id', Object.assign({}, good, { loadErrors: { ghost: { quantity: { raw: '', code: 'MISSING_FIELD' } } } })]);
    cases.push(['unknown load subfield', Object.assign({}, good, { loadErrors: { [loadId]: { label: { raw: '', code: 'MISSING_FIELD' } } } })]);
    cases.push(['extra entry key', Object.assign({}, good, { loadErrors: { [loadId]: { quantity: { raw: '', code: 'MISSING_FIELD', extra: 1 } } } })]);
    cases.push(['raw not a string', Object.assign({}, good, { loadErrors: { [loadId]: { quantity: { raw: 0, code: 'MISSING_FIELD' } } } })]);
    cases.push(['badInput false', Object.assign({}, good, { loadErrors: { [loadId]: { quantity: { raw: '', code: 'NOT_FINITE', badInput: false } } } })]);
    cases.push(['extra payload key', Object.assign({}, good, { extra: true })]);
    cases.push(['sourceFavId object', Object.assign({}, good, { sourceFavId: {} })]);
    for (const [label, payload] of cases) {
      const store = restoreRow(h, payload);
      const s = h.state(); assert.strictEqual(s.fault && s.fault.kind, 'restore', label); assert.ok(/lcv-3 contract/.test(s.fault.message), label + ': ' + s.fault.message);   // ledger L-13: the lcv-3 wrapper is validated by the accepted storage module
      assert.deepStrictEqual(s.snapshot, before.snapshot, label); assert.deepStrictEqual(s.loadErrors, before.loadErrors, label); assert.deepStrictEqual(s.fieldErrors, before.fieldErrors, label); assert.strictEqual(h.store.data, store, label);
      assert.ok(/RESTORE FAILED/.test(h.text()) && !/ADEQUATE|50,000/.test(h.text()), label + ': no stale success');
    }
    restoreRow(h, good); assert.strictEqual(h.state().fault, null); assert.strictEqual(h.state().result.status, 'INCOMPLETE_INPUT'); assert.deepStrictEqual(h.state().loadErrors, before.loadErrors);
    assert.deepStrictEqual(h.api.lcFavValidatePayload(good), []);
    assert.ok(/loadErrors: object map required/.test(h.api.lcFavValidatePayload(Object.assign({}, good, { loadErrors: [] }))[0]), 'ledger L-13: the accepted storage validator names the map, not the offending type');
  });
  test('valid, incomplete and unsupported payloads still round-trip losslessly through Save and restore', () => {
    for (const setup of [(h) => annual(h), (h) => { annual(h); h.set('lcPeriodMonths', ''); }, (h) => { annual(h); h.set('lcMethod', 'opt_220_82'); }, (h) => { annual(h); h.set('lcReadingValue', '12,3'); }]) {
      const h = buildHarness({ promptAnswer: 'p' }); setup(h); const before = h.state(); assert.strictEqual(h.api.lcFavSave(), true);
      const h2 = buildHarness({ storage: h.store.data }); h2.api.lcInit(); h2.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
      const after = h2.state(); assert.strictEqual(after.fault, null); assert.deepStrictEqual(after.snapshot, before.snapshot); assert.deepStrictEqual(after.fieldErrors, before.fieldErrors); assert.deepStrictEqual(after.result, before.result);
    }
  });
});

describe('B2-r1 R-B2-03 — a present malformed lc collection is never replaced', () => {
  test('lc as object / string / number / null: Save refused with a storage fault, the exact store string preserved, no prompt (B2 before: replaced by [new record])', () => {
    for (const bad of [{ recoverable: { name: 'old', data: 123 } }, 'recoverable text', 5, null]) {
      const seed = JSON.stringify({ lc: bad, vd: [{ id: 1, name: 'other' }] });
      const h = buildHarness({ storage: seed, promptAnswer: 'x' }); annual(h);
      assert.strictEqual(h.api.lcFavSave(), false, JSON.stringify(bad)); assert.strictEqual(h.store.data, seed); assert.strictEqual(h.store.sets, 0); assert.strictEqual(h.prompts.calls.length, 0);
      assert.strictEqual(h.state().fault.kind, 'storage'); assert.ok(/unexpected format/.test(h.state().fault.message)); assert.ok(/STORAGE ERROR/.test(h.text()));
    }
  });
  test('controls: absent lc is created; an array is appended; quota failure and root-JSON corruption stay explicit and non-destructive', () => {
    // EC-03 (stage 3): Save goes through EC.favoritesStore, which refuses to rewrite a store holding an unreadable row in ANY
    // list. The control rows are therefore readable presets; the refusal for unreadable rows has its own test (stage3Favorites).
    const seed = JSON.stringify({ vd: [{ id: 1, name: 'VD', vals: {} }], custom: { v: 2 } });
    const h = buildHarness({ storage: seed, promptAnswer: 'x' }); annual(h); assert.strictEqual(h.api.lcFavSave(), true); const out = JSON.parse(h.store.data); assert.deepStrictEqual(out.vd, [{ id: 1, name: 'VD', vals: {} }]); assert.deepStrictEqual(out.custom, { v: 2 }); assert.strictEqual(out.lc.length, 1);
    assert.strictEqual(h.api.lcFavSave(), true); assert.strictEqual(JSON.parse(h.store.data).lc.length, 2);
    const q = buildHarness({ storage: '{"lc":[],"vd":[{"id":7,"name":"v","vals":{}}]}', promptAnswer: 'x' }); annual(q); q.store.failNextSet = new Error('quota'); assert.strictEqual(q.api.lcFavSave(), false); assert.strictEqual(q.store.data, '{"lc":[],"vd":[{"id":7,"name":"v","vals":{}}]}');
    const b = buildHarness({ storage: '{broken', promptAnswer: 'x' }); annual(b); assert.strictEqual(b.api.lcFavSave(), false); assert.strictEqual(b.store.data, '{broken');
  });
});

describe('B2-r1 R-B2-04 — ids and dictionary keys are data', () => {
  function withPrototypeGuard(fn) {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    try { return fn(before); } finally { for (const k of Reflect.ownKeys(Object.prototype)) if (!Object.hasOwn(before, k)) delete Object.prototype[k]; for (const k of Reflect.ownKeys(before)) Object.defineProperty(Object.prototype, k, before[k]); }
  }
  for (const evil of ['__proto__', 'constructor', 'hasOwnProperty']) {
    test(`load id "${evil}": clearing quantity writes an OWN error entry, never Object.prototype; the entry survives Save and a fresh-document restore as own data (B2 before: Object.prototype.quantity was written and the payload serialized {})`, () => {
      withPrototypeGuard((before) => {
        const h = buildHarness({ promptAnswer: 'x' }); annual(h); addLoad(h, 0, 12000, 'existing');
        const p = h.api.lcFavPayload(); p.snapshot.loads[0].id = evil; restoreRow(h, p);
        assert.strictEqual(h.state().fault, null); assert.strictEqual(h.state().snapshot.loads[0].id, evil);
        numIn(h, 1).value = ''; numIn(h, 1).dispatch('input');
        assert.deepStrictEqual(Reflect.ownKeys(Object.getOwnPropertyDescriptors(Object.prototype)), Reflect.ownKeys(before), 'Object.prototype untouched');
        assert.strictEqual(Object.prototype.quantity, undefined);
        const payload = h.api.lcFavPayload(); assert.ok(Object.hasOwn(payload.loadErrors, evil)); assert.strictEqual(JSON.stringify(payload.loadErrors[evil]), JSON.stringify({ quantity: { raw: '', code: 'MISSING_FIELD' } }));   // ledger L-14: lcv-3 maps are prototype-free own-key dictionaries
        assert.ok(h.state().parseErrors.some((e) => e.field === 'loads[0].quantity'));
        assert.ok(JSON.stringify(payload.loadErrors).includes('"' + evil + '"'), 'serialized as an own key');
        h.store.data = null; assert.strictEqual(h.api.lcFavSave(), true);
        const h2 = buildHarness({ storage: h.store.data }); h2.api.lcInit(); h2.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
        assert.strictEqual(h2.state().fault, null); assert.ok(Object.hasOwn(h2.api.lcFavPayload().loadErrors, evil)); assert.ok(h2.state().parseErrors.some((e) => e.field === 'loads[0].quantity')); assert.strictEqual(numIn(h2, 1).value, '');
        numIn(h2, 1).value = '3'; numIn(h2, 1).dispatch('input'); assert.deepStrictEqual(h2.state().loadErrors, {}); assert.strictEqual(h2.state().snapshot.loads[0].quantity, 3);
        h2.$('lcLoads').querySelector('.lc-x').dispatch('click'); assert.strictEqual(h2.state().snapshot.loads.length, 0);
        assert.deepStrictEqual(Reflect.ownKeys(Object.getOwnPropertyDescriptors(Object.prototype)), Reflect.ownKeys(before));
      });
    });
  }
  test('control: an ordinary id behaves the same; a fieldErrors path is an own key as well', () => {
    const h = buildHarness(); annual(h); addLoad(h, 0, 12000, 'existing'); numIn(h, 1).value = ''; numIn(h, 1).dispatch('input');
    const id = h.state().snapshot.loads[0].id; assert.ok(Object.hasOwn(h.api.lcFavPayload().loadErrors, id));
    h.set('lcReadingValue', 'abc'); assert.ok(Object.hasOwn(h.api.lcFavPayload().fieldErrors, 'measurement.reading.value'));
  });
});

describe('B2-r1 R-B2-05 — optional blanks are null; required blanks are missing', () => {
  test('clearing the optional existing service rating / feeder ampacity / OCPD / power factor leaves no parse error: demand COMPLETE 50,000 VA, capacity not_assessed (MISSING_FIELD at the capacity layer) — B2 before: INCOMPLETE_INPUT via a parser MISSING_FIELD', () => {
    const h = buildHarness(); annual(h);
    for (const [id, path] of [['lcServiceRatingA', 'measurement.existing.serviceRatingA'], ['lcOcpdA', 'measurement.existing.ocpdA']]) {
      h.set(id, '225'); h.set(id, ''); const s = h.state();
      assert.deepStrictEqual(s.parseErrors, [], id); assert.strictEqual(s.result.status, 'COMPLETE', id); assert.strictEqual(s.result.demand.totalVA, 50000, id);
      if (id === 'lcServiceRatingA') { assert.strictEqual(s.result.existingCapacity.status, 'not_assessed'); assert.ok(s.result.problems.some((p) => p.field === path && p.layer === 'capacity' && p.code === 'MISSING_FIELD')); assert.ok(/NOT ASSESSED/.test(h.text()) && /Demand above is computed independently/.test(h.text())); }
      assert.ok(!h.$(id).classList.contains('lc-invalid'), id + ' is not marked invalid');
      h.set(id, '225');
    }
    h.set('lcPurpose', 'feeder'); h.set('lcFeederAmpacityA', '200'); h.set('lcFeederOcp', 'yes'); h.set('lcFeederAmpacityA', ''); assert.deepStrictEqual(h.state().parseErrors, []); assert.strictEqual(h.state().result.demand.totalVA, 50000); assert.strictEqual(h.state().result.existingCapacity.status, 'not_assessed');
    h.set('lcPurpose', 'service'); h.set('lcReadingUnit', 'kW'); h.set('lcReadingValue', '40'); h.set('lcPowerFactor', '0.8'); assert.strictEqual(h.state().result.status, 'COMPLETE'); h.set('lcPowerFactor', '');
    assert.deepStrictEqual(h.state().parseErrors, []); assert.ok(h.state().result.problems.some((p) => p.field === 'measurement.powerFactor' && p.code === 'MISSING_FIELD' && p.source !== 'parser'), 'the engine, not the parser, reports the conditionally required power factor');
  });
  test('required blanks still block with a parser MISSING_FIELD (reading value, months, term VA); malformed optional text is still NOT_FINITE; per-conductor blanks are reported by the engine', () => {
    const h = buildHarness(); annual(h);
    for (const [id, path] of [['lcReadingValue', 'measurement.reading.value'], ['lcPeriodMonths', 'measurement.periodMonths']]) { h.set(id, ''); const s = h.state(); assert.deepStrictEqual(s.parseErrors, [{ field: path, raw: '', code: 'MISSING_FIELD' }], id); assert.strictEqual(s.result.status, 'INCOMPLETE_INPUT'); assert.strictEqual(s.result.demand.totalVA, null); h.set(id, id === 'lcReadingValue' ? '40000' : '12'); }
    h.set('lcNewLoadMode', 'precalculated'); h.set('lcTermVA', '5000'); h.set('lcTermVA', ''); assert.ok(h.state().parseErrors.some((p) => p.field === 'measurement.newLoad.precalculated.va' && p.code === 'MISSING_FIELD'));
    h.set('lcNewLoadMode', 'none'); h.set('lcServiceRatingA', '12x'); const s = h.state(); assert.deepStrictEqual(s.parseErrors, [{ field: 'measurement.existing.serviceRatingA', raw: '12x', code: 'NOT_FINITE' }]); assert.strictEqual(s.result.status, 'INVALID_INPUT'); assert.ok(h.$('lcServiceRatingA').classList.contains('lc-invalid'));
    h.set('lcServiceRatingA', '225'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    h.set('lcReadingUnit', 'A'); h.set('lcReadingScope', 'per_conductor'); h.set('lcReadL1', '100'); h.set('lcReadL2', ''); assert.deepStrictEqual(h.state().parseErrors, []); assert.ok(h.state().result.problems.some((p) => p.field === 'measurement.readingsPerConductor.L2' && p.code === 'MISSING_FIELD'));
  });
  test('valid -> clear optional rating -> Save -> fresh document restore reproduces COMPLETE / not_assessed exactly', () => {
    const h = buildHarness({ promptAnswer: 'opt' }); annual(h); h.set('lcServiceRatingA', ''); const before = h.state(); assert.strictEqual(before.result.status, 'COMPLETE');
    assert.strictEqual(h.api.lcFavSave(), true); const h2 = buildHarness({ storage: h.store.data }); h2.api.lcInit(); h2.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
    const after = h2.state(); assert.strictEqual(after.fault, null); assert.deepStrictEqual(after.snapshot, before.snapshot); assert.deepStrictEqual(after.result, before.result); assert.strictEqual(h2.$('lcServiceRatingA').value, '');
  });
});

describe('B2-r1 R-B2-06 — every visible app-authored NEC reference is a necLink; user text stays inert', () => {
  test('no visible app text node carries a reference number outside a nec-link in the empty, annual, no-rating, 30-day per-conductor, unsupported-method and restore-fault states (B2 before: 7 unlinked texts)', () => {
    const h = buildHarness(); h.api.lcInit(); assert.deepStrictEqual(unlinkedRefs(h), [], 'empty');
    annual(h); assert.deepStrictEqual(unlinkedRefs(h), [], 'annual');
    h.set('lcServiceRatingA', ''); assert.deepStrictEqual(unlinkedRefs(h), [], 'no rating'); h.set('lcServiceRatingA', '225');
    h.set('lcMethod', 'opt_220_82'); assert.deepStrictEqual(unlinkedRefs(h), [], 'unsupported'); h.set('lcMethod', 'measured_220_87');
    h.set('lcBasis', '30d_recording_exception'); h.set('lcReadingUnit', 'A'); h.set('lcReadingScope', 'per_conductor'); h.set('lcReadL1', '140'); h.set('lcReadL2', '20'); h.set('lcModel', 'split_240_declared_legs'); h.set('lcDeclUnityPF', 'yes'); h.set('lcNewLoadMode', 'precalculated'); h.set('lcTermVA', '3600'); h.set('lcTermConnection', 'LN'); h.set('lcTermLeg', 'L2');
    assert.deepStrictEqual(unlinkedRefs(h), [], '30-day per-conductor with term');
    h.api.favLoad('lc', 1); // no such record: nothing happens; a real failure:
    h.store.data = JSON.stringify({ lc: [{ id: 5, name: 'Broken 220.87', vals: { method: 'optional', voltage: '240', scope: 'house', sqFt: '1', appliances: '{', hvac: '[]', ev: '[]' } }] }); h.api.favRender('lc'); h.api.favLoad('lc', 5);
    assert.strictEqual(h.state().fault.kind, 'restore'); assert.deepStrictEqual(unlinkedRefs(h).filter((t) => !t.includes('Broken 220.87')), [], 'restore fault');
    const faultNodes = h.nodes().filter((n) => (n._classes.has('nec-link') || n._classes.has('nycec-link')) && n.textContent.includes('Broken')); assert.strictEqual(faultNodes.length, 0, 'the preset name inside the fault message is user text: not linked');
  });
  test('links carry the real necLink context (transport-only stub) and a user load label containing "220.87" is never linked', () => {
    const h = buildHarness(); annual(h); addLoad(h, 0, 12000);
    const lbl = labelIn(h); lbl.value = 'Per 220.87 heater'; lbl.dispatch('input');
    // EC-UI-LAYOUT-REFS-1 (old -> new): links are data-ref spans handled by one delegated listener; the orange link is the NEC 2020 section, the separate blue link the NYCEC 2025 amendment
    const links = h.nodes().filter((n) => n._classes.has('nec-link') || n._classes.has('nycec-link'));
    assert.ok(links.length >= 8, 'section title, capacity subtitle, attestation label, hint, method note, banner text, line labels, references: ' + links.length);
    assert.ok(links.every((n) => n.attrs.onclick === undefined && (n.listeners.click || []).length === 0 && typeof n.attrs['data-ref'] === 'string' && !n.textContent.includes('heater')));
    assert.ok(!links.some((n) => n.parent && n.parent._classes.has('lc-problem-field') && n.parent.textContent.includes('heater')), 'the load\'s own problem row keeps the user label inert');
    const tick = links.find((n) => n.textContent === '230.90'); tick.dispatch('click'); assert.ok(/^NEC 2020 230\.90 — Load Calc/.test(h.necCalls[h.necCalls.length - 1]), h.necCalls[h.necCalls.length - 1]);
    const amended = links.find((n) => n._classes.has('nycec-link') && n.attrs['data-sec'] === '220.87(2)'); amended.dispatch('click'); assert.ok(/^NYCEC 2025 amendment to NEC 220\.87\(2\) — Load Calc/.test(h.necCalls[h.necCalls.length - 1]), h.necCalls[h.necCalls.length - 1]);
    assert.strictEqual(h.state().snapshot.loads[0].label, 'Per 220.87 heater'); assert.strictEqual(lbl.value, 'Per 220.87 heater');
    assert.ok(unlinkedRefs(h).every((t) => t.includes('heater')), 'only the user label carries an unlinked number');
  });
});

describe('B2-r1 — unchanged guarantees', () => {
  test('Init == Reset == empty snapshot; one evaluate per update; no arithmetic / innerHTML in the adapter; coversSnapshot has one writer; the 15 migrations still restore', () => {
    // ledger L-3 / L-2 / L-7: blank V2 draft (A projection == contract empty snapshot); one facade call site; legacy imports keep the A projection of every historical migration
    const h = buildHarness(); h.api.lcInit(); assert.deepStrictEqual(h.state().snapshot, h.EC.loadCalcStateV2.createEmptyDraftV2().snapshot); assert.deepStrictEqual(h.EC.loadCalcInputV2.downConvertToA(h.state().lastRequest).snapshot, h.EC.loadCalcState.createEmptySnapshot()); assert.deepStrictEqual(h.EC.loadCalcInputV2.downConvertToA(h.state().lastRequest).snapshot, H.caseById('T-S-08').envelope.snapshot);
    const src = h.adapterSrc; for (const bad of [/1\.25/, /1\.732/, /Math\.sqrt/, /toFixed\(/, /serviceSize/, /innerHTML/, /600 A/]) assert.ok(!bad.test(src), String(bad));
    assert.strictEqual((src.match(/\.evaluate\(/g) || []).length, 0); assert.strictEqual((src.match(/loadCalcFacade\.evaluateV2\(/g) || []).length, 1); assert.strictEqual((src.match(/captureCoversSnapshot\(/g) || []).length, 1);
    for (const c of H.loadCases().cases) if (c.legacyRecord && c.migratedSnapshot) { const g = buildHarness(); g.api.lcInit(); g.api.favSetValues('lc', H.clone(c.legacyRecord), 1); assert.strictEqual(g.state().fault, null, c.id); assert.deepStrictEqual(g.EC.loadCalcInputV2.downConvertToA(g.state().lastRequest).snapshot, c.migratedSnapshot, c.id); assert.strictEqual(g.state().context.methodConfirmedAfterImport, false, c.id); }
    assert.strictEqual(h.api.favGetLabel('lc', h.api.lcFavPayload()), 'no supply · no method');
    void PROFILE;
  });
});
