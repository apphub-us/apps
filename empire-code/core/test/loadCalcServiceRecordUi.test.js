'use strict';
/**
 * LC-SERVICE-RESULT-STORE-1: real shipped controls, generated modules, isolated stub browser storage.
 * Synthetic storage faults/interleavings are explicit; these tests are not native browser acceptance.
 * Worker authored only. Coordinator runs after the generated bundle is rebuilt.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildHarness, html } = require('./helpers/loadCalcDom.js');
const PREFIX = 'empire_code_service_result_v1:';
const ID = (n) => 'sr1_' + n.toString(16).padStart(2, '0').repeat(16);
const key = (n) => PREFIX + ID(n);
const copy = (v) => JSON.parse(JSON.stringify(v));
function randomSequence(...values) {
  let calls = 0;
  return { getRandomValues(array) { assert.equal(array.length, 16); array.fill(values[Math.min(calls++, values.length - 1)]); return array; }, calls: () => calls };
}
const records = (h) => Object.keys(h.store.byKey).filter((k) => k.startsWith(PREFIX));
const record = (h, k) => JSON.parse(h.store.byKey[k || records(h)[0]]);
const click = (h, id) => h.$(id).dispatch('click');
const rows = (h) => h.$('lcRecordList').querySelectorAll('.lc-record-open');
const status = (h) => h.$('lcRecordStatus').textContent;
const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const control = (card, role) => card.querySelectorAll('input, select, button').find((n) => n.attrs['data-role'] === role);
function setIn(el, value) { el.value = value; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); }
function ready(options) {
  const h = buildHarness(options); h.api.lcInit();
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', '1ph_3w_120_240');
  h.set('lcModel', 'split_240_balanced_LN'); h.set('lcDeclBalancedLN', 'yes');
  h.set('lcFloorArea', '1500'); h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '1'); h.set('lcNycAcCircuits', '0');
  h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); h.set('lcConductorAmpacity', '200'); h.set('lcNycAcException', 'yes');
  for (const [preset, va] of [[0, 12000], [3, 4500], [1, 5000], [2, 1200], [4, 5000]]) {
    h.$('lcPresetName').value = String(preset); h.$('lcPresetVA').value = String(va); click(h, 'lcAddLoad');
  }
  setIn(control(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit');
  setIn(control(cards(h)[3], 'inclusion'), 'fixed_or_permanently_connected');
  setIn(control(cards(h)[4], 'coverage'), 'yes'); h.set('lcInventoryComplete', 'yes');
  return h;
}
const PLAN = [['lcSvcIntent', 'new_design_candidate'], ['lcSvcOneMainDisconnect', 'yes'], ['lcSvcNoAdditionalSources', 'yes'], ['lcSvcWholeDwelling', 'yes'], ['lcSvcSingleConductorSet', 'yes']];
function design(h, path, material, rating) {
  for (const [id, value] of PLAN.concat([
    ['lcSvcSelectedRating', String(rating)], ['lcSvcSizingPath', path], ['lcSvcMaterial', material],
    ['lcSvcTermTemp', '75'], ['lcSvcTermCompatible', 'yes'], ['lcSvcInsulTemp', '75'],
    ['lcSvcAmbient', '30'], ['lcSvcCcc', '3'], ['lcSvcWiringMethod', 'single_insulated_conductors_in_raceway'], ['lcSvcNoOtherAdj', 'yes']
  ])) h.set(id, value);
}
function assessed(options, setup) {
  const h = ready(options); click(h, 'lcCalcBtn');
  if (setup) setup(h); else design(h, 'general_table_75C', 'Cu', 200);
  click(h, 'lcSvcAssessBtn'); assert.ok(h.api.LC_SVC.analysis); return h;
}
function live(h) {
  return { state: JSON.stringify(h.state()), draft: JSON.stringify(h.api.lcFavPayload()), design: JSON.stringify(h.api.lcSvcDesignObject()),
    analysis: h.api.LC_SVC.analysis, calc: JSON.stringify({ attempted: h.api.LC_CALC.attempted, key: h.api.LC_CALC.key, commit: h.api.LC_CALC.commit }),
    attempted: h.api.LC_SVC.attempted, calcKey: h.api.LC_SVC.calcKey, notice: h.api.LC_SVC.notice,
    error: h.api.LC_SVC.error, liveKey: h.api.LC_SVC.liveKey, probe: h.api.LC_SVC.probe,
    marks: h.api.LC_SVC.marks.slice(), focuses: h.dom.document.focusLog.focuses.length, scrolls: h.dom.document.focusLog.scrolls.length,
    active: h.dom.document.activeElement, refs: h.necCalls.length, favorites: h.store.data };
}
function sameLive(h, before) {
  const after = live(h);
  for (const k of Object.keys(before)) {
    if (k === 'marks') assert.deepEqual(after[k], before[k], k);
    else assert.equal(after[k], before[k], k);
  }
}
function noWriteOnOldButton(h, mutate) {
  const oldButton = h.$('lcRecordSaveBtn'); mutate(h);
  const before = live(h); const writes = h.store.sets; const prompts = h.prompts.calls.length; const bytes = JSON.stringify(h.store.byKey);
  oldButton.dispatch('click');
  sameLive(h, before); assert.equal(h.store.sets, writes); assert.equal(h.prompts.calls.length, prompts); assert.equal(JSON.stringify(h.store.byKey), bytes);
}

describe('full service result: save and historical access', () => {
  test('B0 saves the exact current tuple, real per-record bytes and unmodified Favorites', () => {
    const h = assessed({ storage: '{"lc":[],"vd":[{"id":7,"name":"keep"}]}', promptAnswer: 'B0 full', crypto: randomSequence(1) });
    const before = live(h); const req = copy(h.state().lastRequest); const response = { facade: copy(h.state().lastFacade), result: copy(h.state().result) };
    click(h, 'lcRecordSaveBtn');
    assert.match(status(h), /Saved full result "B0 full" in this browser/);
    assert.deepEqual(records(h), [key(1)]); assert.equal(h.store.sets, 1);
    const saved = record(h); assert.equal(saved.name, 'B0 full'); assert.equal(saved.id, ID(1));
    assert.deepEqual(saved.calculation.request, req); assert.deepEqual(saved.calculation.response, response);
    assert.equal(JSON.stringify(saved.calculation.draftPayload), before.draft);
    assert.equal(JSON.stringify(saved.serviceSizing.design), before.design);
    assert.deepEqual(saved.serviceSizing.analysis, copy(before.analysis));
    assert.equal(saved.calculation.response.result.demand.totalVA, 23680);
    assert.equal(saved.serviceSizing.analysis.operative, false); assert.equal(saved.serviceSizing.analysis.installationApproved, false);
    assert.equal(saved.serviceSizing.analysis.globalCodeCompliance, 'not_verified'); sameLive(h, before);
  });

  test('restart opens saved history from an empty form and keeps it empty', () => {
    const h = assessed({ crypto: randomSequence(2), promptAnswer: 'Restart case' }); click(h, 'lcRecordSaveBtn');
    const g = buildHarness({ storage: h.store.data, storageByKey: h.store.byKey }); g.api.lcInit();
    assert.equal(g.$('lcRecordHub').parentNode, g.dom.container);
    assert.ok(g.dom.container.children.indexOf(g.$('lcRecordHub')) < g.dom.container.children.indexOf(g.$('lcForm')));
    assert.equal(g.api.LC_CALC.attempted, false); assert.equal(g.api.LC_SVC.analysis, null); assert.equal(g.state().snapshot.method.selected, null);
    assert.equal(g.$('lcRecordListBtn').textContent, 'Saved service results (1)');
    const before = live(g); click(g, 'lcRecordListBtn'); rows(g)[0].dispatch('click');
    assert.match(g.$('lcRecordView').textContent, /Saved result — historical/);
    assert.match(g.$('lcRecordView').textContent, /Not recalculated\. Current inputs and the current assessment are unchanged/);
    assert.match(g.$('lcRecordView').textContent, /23,680 VA/); assert.match(g.$('lcRecordView').textContent, /98\.7 A/);
    assert.match(g.$('lcRecordView').textContent, /Saved calculation inputs & provenance/);
    assert.match(g.$('lcRecordView').textContent, /Original source metadata/);
    assert.match(g.$('lcRecordView').textContent, /Full saved record data/);
    click(g, 'lcRecordCloseBtn'); assert.equal(g.$('lcRecordView').attrs.hidden, ''); sameLive(g, before); assert.equal(g.store.sets, 0);
  });

  test('a different current method does not hide history or make opening a restore', () => {
    const h = assessed({ crypto: randomSequence(3) }); click(h, 'lcRecordSaveBtn');
    h.set('lcMethod', 'measured_220_87');
    const before = live(h); assert.equal(h.$('lcSvc').style.display, 'none');
    click(h, 'lcRecordListBtn'); rows(h)[0].dispatch('click');
    assert.match(h.$('lcRecordView').textContent, /SERVICE SIZING — SAVED ASSESSMENT/);
    sameLive(h, before); assert.equal(h.state().snapshot.method.selected, 'measured_220_87');
  });

  test('history remains reachable when live calculator modules are missing', () => {
    const h = assessed({ crypto: randomSequence(4) }); click(h, 'lcRecordSaveBtn');
    const g = buildHarness({ storageByKey: h.store.byKey, missing: ['loadCalcFacade', 'loadCalcServiceSizing'] }); g.api.lcInit();
    assert.equal(g.$('lcForm'), undefined); assert.match(g.dom.container.textContent, /The Load Calc engine is not available/);
    assert.equal(g.$('lcRecordListBtn').textContent, 'Saved service results (1)');
    click(g, 'lcRecordListBtn'); rows(g)[0].dispatch('click');
    assert.match(g.$('lcRecordView').textContent, /23,680 VA/); assert.equal(g.state().evaluations, 0); assert.equal(g.store.sets, 0);
  });

  for (const [name, material, rating, amp, qualification] of [
    ['200 / 175 changed premise', 'Cu', 200, 175, 'revalidation_required'],
    ['100 A Cu conditional interpretation', 'Cu', 100, 85, 'review_required'],
    ['100 A Al conditional interpretation', 'Al', 100, 90, 'review_required']
  ]) test('preserves ' + name, () => {
    const h = assessed({ crypto: randomSequence(5) }, (g) => design(g, 'dwelling_83pct_310_12', material, rating));
    const original = copy(h.api.LC_SVC.analysis); click(h, 'lcRecordSaveBtn');
    const saved = record(h).serviceSizing.analysis; assert.deepEqual(saved, original);
    assert.equal(saved.ungroundedConductors.recommendationAvailable, false); assert.equal(saved.ungroundedConductors.size, null);
    assert.equal(saved.ungroundedConductors.tableCandidate.ampacity75CA, amp);
    assert.equal(saved.ungroundedConductors.qualificationConsistency.status, qualification);
    h.api.lcRecordOpen(records(h)[0]);
    assert.match(h.$('lcRecordView').textContent, /Conditional table reference — not a selection/);
    assert.match(h.$('lcRecordView').textContent, /Open model-interpretation items/);
    if (qualification === 'revalidation_required') assert.match(h.$('lcRecordView').textContent, /met in the saved model/);
    else assert.match(h.$('lcRecordView').textContent, /saved qualification threshold/);
  });

  test('a performed minimum-only assessment can be saved with unanswered design values', () => {
    const h = assessed({ crypto: randomSequence(6) }, (g) => { for (const [id, v] of PLAN) g.set(id, v); });
    assert.equal(h.api.LC_SVC.analysis.minimumService.ratingA, 100); assert.equal(h.api.LC_SVC.analysis.chosenMain.status, 'waiting_input');
    click(h, 'lcRecordSaveBtn'); const saved = record(h); assert.equal(saved.serviceSizing.design.selectedMainRatingA, null);
    h.api.lcRecordOpen(records(h)[0]); assert.match(h.$('lcRecordView').textContent, /saved assessment was waiting/);
  });

  test('a performed DESIGN_INVALID keeps malformed raw input and the refusal', () => {
    const h = assessed({ crypto: randomSequence(7) }, (g) => { design(g, 'general_table_75C', 'Cu', 200); g.set('lcSvcAmbient', '30x'); });
    assert.equal(h.api.LC_SVC.analysis.status, 'DESIGN_INVALID'); click(h, 'lcRecordSaveBtn');
    const saved = record(h); assert.equal(saved.serviceSizing.design.conductor.ambientTempC, '30x');
    assert.equal(saved.serviceSizing.analysis.status, 'DESIGN_INVALID');
    h.api.lcRecordOpen(records(h)[0]);
    assert.match(h.$('lcRecordView').textContent, /does not mark or change current fields/);
    assert.ok(!/Correct the marked field and reassess/.test(h.$('lcRecordView').textContent));
  });
});

describe('full result capture freshness and refusal', () => {
  test('before Calculate and probe-only never save or open the name prompt', () => {
    const h = ready(); assert.equal(h.$('lcRecordSaveBtn'), undefined);
    assert.equal(h.api.lcRecordSave(null, null), false);
    click(h, 'lcCalcBtn'); assert.ok(h.api.LC_SVC.probe); assert.equal(h.api.LC_SVC.analysis, null);
    assert.equal(h.api.lcRecordSave(null, null), false); assert.equal(h.prompts.calls.length, 0); assert.equal(h.store.sets, 0);
  });
  test('load edit and edit-back reject a detached old Save button', () => {
    const h = assessed(); noWriteOnOldButton(h, (g) => { g.set('lcFloorArea', '1501'); g.set('lcFloorArea', '1500'); });
    assert.equal(h.api.LC_SVC.analysis, null);
  });
  test('design edit and edit-back reject a detached old Save button', () => {
    const h = assessed(); noWriteOnOldButton(h, (g) => { g.set('lcSvcSelectedRating', '175'); g.set('lcSvcSelectedRating', '200'); });
    assert.equal(h.api.LC_SVC.analysis, null);
  });
  test('main Calculate drops the old service result and its Save button cannot save it', () => {
    const h = assessed(); noWriteOnOldButton(h, (g) => click(g, 'lcCalcBtn')); assert.equal(h.api.LC_SVC.analysis, null);
  });
  test('even an equivalent newer Assess does not make a detached old Save button current', () => {
    const h = assessed(); noWriteOnOldButton(h, (g) => click(g, 'lcSvcAssessBtn')); assert.ok(h.api.LC_SVC.analysis);
  });
  test('a live Load Calc fault rejects capture without mutating the fault', () => {
    const h = assessed(); noWriteOnOldButton(h, (g) => { g.api.LC.fault = { kind: 'input', message: 'synthetic current fault', details: [] }; });
  });
  test('an actual thrown service evaluation drops the old button and cannot be saved', () => {
    const h = assessed(); noWriteOnOldButton(h, (g) => {
      const real = g.EC.loadCalcServiceSizing;
      g.EC.loadCalcServiceSizing = Object.assign({}, real, { analyzePrototype(request, designInput) {
        if (designInput !== null && designInput !== undefined) throw new Error('synthetic service failure');
        return real.analyzePrototype(request, designInput);
      } });
      click(g, 'lcSvcAssessBtn');
    });
    assert.ok(h.api.LC_SVC.error);
  });
  test('changing design inside the prompt refuses the stale capture', () => {
    const h = assessed({ crypto: randomSequence(8) });
    h.prompts.answer = () => { h.set('lcSvcAmbient', '35'); h.set('lcSvcAmbient', '30'); return 'Changed during prompt'; };
    click(h, 'lcRecordSaveBtn');
    assert.equal(h.store.sets, 0); assert.equal(records(h).length, 0); assert.equal(h.api.LC_SVC.analysis, null);
    assert.match(status(h), /changed while the name dialog was open/);
  });
  test('a load edit inside the prompt refuses the stale capture', () => {
    const h = assessed({ crypto: randomSequence(9) });
    h.prompts.answer = () => { h.set('lcFloorArea', '1600'); return 'Changed load'; };
    click(h, 'lcRecordSaveBtn'); assert.equal(h.store.sets, 0); assert.match(status(h), /changed while the name dialog was open/);
  });
  for (const answer of [null, '', '   ', 'x'.repeat(201)]) test('cancelled/blank/oversized name is not written: ' + String(answer).length, () => {
    const h = assessed({ promptAnswer: answer, crypto: randomSequence(10) }); const before = live(h); click(h, 'lcRecordSaveBtn');
    assert.equal(h.store.sets, 0); assert.equal(records(h).length, 0); sameLive(h, before);
  });
  test('secure randomness is required and never replaced with a counter or clock ID', () => {
    const h = assessed({ crypto: null }); const before = live(h); click(h, 'lcRecordSaveBtn');
    assert.match(status(h), /secure randomness is unavailable/); assert.equal(h.prompts.calls.length, 0); assert.equal(h.store.sets, 0); sameLive(h, before);
  });
});

describe('per-record persistence and controlled storage failures', () => {
  test('same name creates separate keys with independent stored records', () => {
    const h = assessed({ promptAnswer: 'same name', crypto: randomSequence(11, 12) }); click(h, 'lcRecordSaveBtn'); click(h, 'lcRecordSaveBtn');
    assert.deepEqual(records(h), [key(11), key(12)]); assert.equal(record(h, key(11)).name, 'same name'); assert.equal(record(h, key(12)).name, 'same name');
  });
  test('synthetic independent-tab interleaving does not lose a record through a shared index', () => {
    const h = assessed({ crypto: randomSequence(13), promptAnswer: 'Tab one' });
    const g = assessed({ crypto: randomSequence(14), promptAnswer: 'Tab two' });
    g.store.byKey = h.store.byKey; click(h, 'lcRecordSaveBtn'); click(g, 'lcRecordSaveBtn'); h.api.lcRecordRefresh();
    assert.deepEqual(records(h).sort(), [key(13), key(14)].sort()); assert.equal(rows(h).length, 2);
    assert.equal(Object.keys(h.store.byKey).length, 2, 'no collection/index key'); assert.equal(h.store.data, null); assert.equal(g.store.data, null);
  });
  test('existing-key collision is retried boundedly and never overwrites the first record', () => {
    const random = randomSequence(15); const h = assessed({ crypto: random }); click(h, 'lcRecordSaveBtn');
    const bytes = h.store.byKey[key(15)]; const before = live(h); click(h, 'lcRecordSaveBtn');
    assert.equal(h.store.byKey[key(15)], bytes); assert.equal(h.store.sets, 1); assert.equal(random.calls(), 6);
    assert.match(status(h), /five random-ID attempts/); sameLive(h, before);
  });
  test('synthetic collision after record creation is detected before the one write', () => {
    const h = assessed({ crypto: randomSequence(16, 17) }); const m = h.EC.loadCalcServiceRecord; let inserted = false;
    h.EC.loadCalcServiceRecord = Object.assign({}, m, { createRecord(capture, meta) {
      const result = m.createRecord(capture, meta);
      if (!inserted) { inserted = true; h.localStorage.setItem(PREFIX + meta.id, 'other writer bytes'); }
      return result;
    } });
    click(h, 'lcRecordSaveBtn');
    assert.equal(h.store.byKey[key(16)], 'other writer bytes'); assert.equal(record(h, key(17)).id, ID(17));
    assert.match(status(h), /Saved full result/);
  });
  test('quota failure preserves current assessment, Favorites and earlier records', () => {
    const h = assessed({ storage: '{"vd":[{"name":"keep"}]}', crypto: randomSequence(18, 19) }); click(h, 'lcRecordSaveBtn');
    const old = JSON.stringify(h.store.byKey); const before = live(h); h.store.failNextSet = new Error('synthetic quota');
    click(h, 'lcRecordSaveBtn'); assert.match(status(h), /save failed.*quota/i);
    assert.equal(JSON.stringify(h.store.byKey), old); sameLive(h, before); assert.equal(h.state().fault, null);
  });
  test('a prewrite access failure performs no write and preserves live state', () => {
    const h = assessed({ crypto: randomSequence(20) }); const before = live(h);
    h.localStorage.getItem = () => { throw new Error('synthetic access denied'); };
    click(h, 'lcRecordSaveBtn'); assert.equal(h.store.sets, 0); sameLive(h, before); assert.match(status(h), /access denied/);
  });
  test('postwrite read failure reports uncertainty without claiming no write', () => {
    const h = assessed({ crypto: randomSequence(21) }); const before = live(h); const set = h.localStorage.setItem;
    h.localStorage.setItem = (k, v) => { set(k, v); h.localStorage.getItem = () => { throw new Error('synthetic postwrite read failure'); }; };
    click(h, 'lcRecordSaveBtn'); assert.equal(record(h).id, ID(21)); assert.match(status(h), /write completed.*storage state is uncertain/);
    assert.ok(!/Nothing was written|not saved/i.test(status(h))); sameLive(h, before);
  });
  test('postwrite mismatch is not reported as a confirmed save', () => {
    const h = assessed({ crypto: randomSequence(22) }); const before = live(h); const set = h.localStorage.setItem;
    h.localStorage.setItem = (k, v) => { set(k, v); h.localStorage.getItem = () => 'synthetic changed readback'; };
    click(h, 'lcRecordSaveBtn'); assert.match(status(h), /stored contents could not be confirmed/);
    assert.ok(!/Saved full result|Nothing was written/.test(status(h))); sameLive(h, before);
  });
});

describe('historical reading is inert and storage is not repaired on read', () => {
  test('corrupt, future version, ID mismatch and malformed key remain visible and stored', () => {
    const h = assessed({ crypto: randomSequence(23) }); click(h, 'lcRecordSaveBtn'); const valid = record(h);
    const future = copy(valid); future.recordVersion = 9; future.id = ID(25);
    h.store.byKey[key(24)] = '{broken';
    h.store.byKey[key(25)] = JSON.stringify(future);
    h.store.byKey[key(26)] = JSON.stringify(valid);
    h.store.byKey[PREFIX + 'unknown key'] = 'untouched';
    h.store.byKey['unrelated-store'] = '{"keep":true}';
    const bytes = JSON.stringify(h.store.byKey); const sets = h.store.sets; const before = live(h);
    click(h, 'lcRecordListBtn'); assert.equal(rows(h).length, 1);
    assert.equal(h.$('lcRecordList').querySelectorAll('.lc-record-unreadable').length, 4);
    assert.equal(h.$('lcRecordListBtn').textContent, 'Saved service results (5)');
    assert.equal(h.api.lcRecordOpen(key(24)), false); assert.match(h.$('lcRecordView').textContent, /could not be opened/);
    assert.equal(JSON.stringify(h.store.byKey), bytes); assert.equal(h.store.sets, sets); sameLive(h, before);
  });
  test('open rereads changed storage instead of using the earlier list snapshot', () => {
    const h = assessed({ crypto: randomSequence(27) }); click(h, 'lcRecordSaveBtn');
    const row = rows(h)[0]; h.store.byKey[key(27)] = '{later corruption'; const before = live(h); const writes = h.store.sets;
    row.dispatch('click'); assert.match(h.$('lcRecordView').textContent, /could not be opened/);
    assert.ok(!/ORIGINAL LOAD CALC RESULT/.test(h.$('lcRecordView').textContent)); sameLive(h, before); assert.equal(h.store.sets, writes);
  });
  test('list enumeration failure preserves existing rows and never repairs storage', () => {
    const h = assessed({ crypto: randomSequence(28) }); click(h, 'lcRecordSaveBtn');
    const list = h.$('lcRecordList').textContent; const before = live(h); const bytes = JSON.stringify(h.store.byKey);
    h.localStorage.key = () => { throw new Error('synthetic enumeration failure'); };
    assert.equal(h.api.lcRecordRefresh(), false); assert.equal(h.$('lcRecordList').textContent, list);
    assert.match(status(h), /could not be listed/); assert.equal(JSON.stringify(h.store.byKey), bytes); sameLive(h, before);
  });
  test('different historical fingerprints display as saved, with no live engine or LC snapshot dependency', () => {
    const h = assessed({ crypto: randomSequence(29) }); click(h, 'lcRecordSaveBtn');
    const saved = record(h); saved.producer.calculationSourcePin = 'a'.repeat(64); saved.producer.sourceBaselinePin = 'b'.repeat(64);
    saved.producer.applicationRevision = 'OLDER-SAVED-VERSION'; saved.serviceSizing.sources.S2.title = 'Saved source title';
    h.store.byKey[key(29)] = JSON.stringify(saved);
    const before = live(h); const desc = Object.getOwnPropertyDescriptor(h.api.LC, 'snapshot');
    h.EC.loadCalcFacade = { evaluateV2() { throw new Error('must not evaluate'); } };
    h.EC.loadCalcServiceSizing = { analyzePrototype() { throw new Error('must not assess'); } };
    Object.defineProperty(h.api.LC, 'snapshot', { configurable: true, get() { throw new Error('must not read live snapshot'); } });
    try {
      assert.equal(h.api.lcRecordOpen(key(29)), true);
      const view = h.$('lcRecordView'); assert.match(view.textContent, /OLDER-SAVED-VERSION/);
      assert.ok(view.textContent.includes('a'.repeat(64))); assert.match(view.textContent, /Saved source title/);
      assert.match(view.textContent, /met in the saved model/);
      assert.equal(view.querySelectorAll('input, select, textarea, a').length, 0);
      assert.equal(h.dom.walk(view).filter((n) => Object.keys(n.attrs || {}).some((k) => /^data-/.test(k))).length, 0, 'no current-reference or field navigation handlers');
      click(h, 'lcRecordArchive-lcSvcDetailsBtn'); click(h, 'lcRecordCloseBtn');
    } finally { Object.defineProperty(h.api.LC, 'snapshot', desc); }
    sameLive(h, before);
  });
  test('historical details use separate IDs while the live disclosure stays independent', () => {
    const h = assessed({ crypto: randomSequence(30) }); click(h, 'lcRecordSaveBtn'); const before = live(h);
    assert.equal(h.$('lcSvcDetailsBtn').attrs['aria-expanded'], 'false'); h.api.lcRecordOpen(key(30));
    const historical = h.$('lcRecordArchive-lcSvcDetailsBtn'); assert.equal(historical.attrs['aria-controls'], 'lcRecordArchive-lcSvcDetails');
    historical.dispatch('click'); assert.equal(historical.attrs['aria-expanded'], 'true'); assert.equal(h.$('lcSvcDetailsBtn').attrs['aria-expanded'], 'false');
    const ids = h.nodes().filter((n) => n.id).map((n) => n.id); assert.equal(new Set(ids).size, ids.length);
    click(h, 'lcRecordCloseBtn'); sameLive(h, before);
  });
  test('long literal names and hostile markup are text, with local wrapping styles', () => {
    const name = '<img src=x onerror=alert(1)> NEC 220.82 ' + 'L'.repeat(150);
    const h = assessed({ promptAnswer: name, crypto: randomSequence(31) }); click(h, 'lcRecordSaveBtn');
    assert.equal(record(h).name, name); assert.equal(rows(h)[0].textContent, name);
    h.api.lcRecordOpen(key(31)); const view = h.$('lcRecordView');
    assert.ok(view.textContent.includes(name)); assert.equal(view.querySelectorAll('img, script').length, 0);
    assert.ok(h.dom.walk(view).every((n) => !n.innerHTMLWrites));
    assert.match(html, /#lcContent \.lc-record-json \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere/s);
    assert.match(html, /#lcContent \.lc-record-data-row > \* \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/s);
  });
  test('list ordering is deterministic by saved UTC time then ID', () => {
    const h = assessed({ crypto: randomSequence(32, 33) }); click(h, 'lcRecordSaveBtn'); click(h, 'lcRecordSaveBtn');
    for (const k of records(h)) { const r = record(h, k); r.createdAt = '2026-10-06T01:02:03.000Z'; r.name = r.id; h.store.byKey[k] = JSON.stringify(r); }
    h.api.lcRecordRefresh(); assert.deepEqual(rows(h).map((n) => n.textContent), [ID(32), ID(33)]);
    const newer = record(h, key(33)); newer.createdAt = '2026-10-07T01:02:03.000Z'; h.store.byKey[key(33)] = JSON.stringify(newer);
    click(h, 'lcRecordRefreshBtn'); assert.deepEqual(rows(h).map((n) => n.textContent), [ID(33), ID(32)]);
  });
});
