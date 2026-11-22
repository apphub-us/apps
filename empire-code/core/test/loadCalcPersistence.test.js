'use strict';
/**
 * EC-CALC-2 / B2 — Load Calc persistence.
 *
 * Storage format (docs/load-calc-b2.md):
 *   localStorage['sparky_favorites'] = { vd:[...], amp:[...], cf:[...], ww:[...], lc:[ { name, id, vals } ... ] }
 *   NEW lc record:  vals = { lcv: 2, profileId: 'A_measured_87_core', snapshot: <LoadCalcInput 3.2.1>,
 *                            fieldErrors: { <path>: { raw, code } }, loadErrors: { <loadId>: { <sub>: { raw, code } } }, sourceFavId }
 *   LEGACY record:  vals = { method, voltage, scope, sqFt, appliances, hvac, ev, ... } (strings; no `lcv`)
 * A record is legacy exactly when `vals` has no own `lcv` property. Legacy vals are
 * migrated on load (no write-back) and a later Save always appends a NEW record.
 *
 * Two classes here: STORAGE-LEVEL sequences run the real adapter/Favorites code
 * against a fake localStorage in two independent "documents" (T-S-12 / T-S-39
 * data round trips); the REAL-BROWSER gate runs tools/loadcalc-check-mobile.js
 * (actual Save button, storage inspection, page.reload(), row click) and is the
 * actual persisted-reload proof. That gate needs the already-installed Playwright
 * (resolvable via NODE_PATH); when it is not resolvable the test is reported as
 * SKIPPED with the reason — never as a pass.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildHarness, fnBody } = require('./helpers/loadCalcDom');
const H = require('./helpers/loadCalcFixtures');

const PROFILE = 'A_measured_87_core';
let playwright = null; let playwrightReason = '';
try { playwright = require('playwright'); } catch (e) { playwrightReason = 'playwright is not resolvable here (NODE_PATH=<global node_modules> makes it resolvable); the real-browser gate is tools/loadcalc-check-mobile.js'; }

function annual(h, rating) {
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcHouseFeeder', 'yes100'); h.set('lcHouseState', 'meter');
  h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_all_LL'); h.set('lcBasis', 'annual_max_demand');
  h.set('lcReadingValue', '40000'); h.set('lcAnnualData', 'yes'); h.set('lcPeriodMonths', '12');
  h.set('lcServiceRatingA', rating || '200'); h.set('lcServiceOverload', 'yes'); h.set('lcNewLoadMode', 'none');
}

describe('B2 PERSISTENCE — versioned payload and legacy distinction', () => {
  test('a new record carries exactly {lcv 2, profileId, snapshot 3.2.1, fieldErrors, loadErrors, sourceFavId}; the snapshot is the accepted shape (validateSnapshot []) and JSON-representable', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h);
    const p = h.api.lcFavPayload();
    // ledger L-5/L-6: every new save is the accepted lcv-3 wrapper; its A projection is still the accepted 3.2.1 shape
    assert.deepStrictEqual(Object.keys(p).sort(), ['capabilityProfile', 'context', 'fieldErrors', 'loadErrors', 'lcv', 'snapshot', 'sourceFavId'].sort());
    assert.strictEqual(p.lcv, 3); assert.strictEqual(p.capabilityProfile, 'AB82_core1'); assert.strictEqual(p.snapshot.schemaVersion, '3.3.0');
    assert.deepStrictEqual(h.EC.loadCalcStorageV2.validatePayloadV3(p), []); assert.deepStrictEqual(h.EC.loadCalcInput.validateSnapshot(h.EC.loadCalcInputV2.downConvertToA({ snapshot: p.snapshot, parseErrors: [] }).snapshot), []); assert.deepStrictEqual(h.EC.loadCalcInput.jsonRepresentabilityErrors(p), []);
    assert.strictEqual(h.state().result.profileId, PROFILE, 'the delegated A result keeps the A engine profile');
    assert.strictEqual(JSON.stringify(JSON.parse(JSON.stringify(p))), JSON.stringify(p), 'round-trips through JSON unchanged (ledger L-10: lcv-3 error maps are prototype-free own-key dictionaries, so the comparison is on the serialized form)');
    assert.strictEqual(Object.getPrototypeOf(p.fieldErrors), null); assert.strictEqual(Object.getPrototypeOf(p.loadErrors), null);
  });
  test('legacy vals (no lcv) are migrated through migrateLegacyRecord; a record with lcv is never migrated; other calculators keep their own formats', () => {
    const rec = H.clone(H.caseById('T-S-21a').legacyRecord);
    const h = buildHarness(); h.api.lcInit(); h.api.favSetValues('lc', rec, 44);
    // ledger L-7: legacy vals are imported through the accepted upgrade; the A projection is byte-identical to the unchanged migrator output
    assert.deepStrictEqual(h.EC.loadCalcInputV2.downConvertToA(h.state().lastRequest).snapshot, H.caseById('T-S-21a').migratedSnapshot); assert.strictEqual(h.state().sourceFavId, 44); assert.strictEqual(h.state().context.methodConfirmedAfterImport, false);
    assert.strictEqual(h.api.favGetLabel('lc', rec), 'Load Calc');
    assert.ok(/vals\.amps/.test(fnBody('favGetLabel')) && /document\.getElementById\('vdAmps'\)/.test(fnBody('favGetValues')), 'V-Drop and the other calculators are untouched');
  });
  test('T-S-12 storage-level: two independent documents share one store; save then restore reproduces every field, the covered-set confirmation, the manual method, migration history and the recomputed result', () => {
    const h = buildHarness({ promptAnswer: 'round trip' }); h.api.lcInit();
    h.api.favSetValues('lc', H.clone(H.caseById('T-S-04c').legacyRecord), 77);   // migrated history stays in the snapshot
    h.set('lcMethod', 'measured_220_87'); h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_all_LL'); h.set('lcBasis', 'annual_max_demand'); h.set('lcReadingValue', '40000'); h.set('lcAnnualData', 'yes'); h.set('lcPeriodMonths', '12'); h.set('lcServiceRatingA', '225'); h.set('lcServiceOverload', 'yes');
    h.set('lcNewLoadMode', 'precalculated'); h.set('lcTermVA', '2000'); h.set('lcTermConnection', 'LL'); h.set('lcTermEstablished', 'yes'); h.set('lcTermBasisMethod', 'other_stated'); h.set('lcTermCalculatedBy', 'engineer'); h.set('lcTermDemandFactors', 'yes'); h.set('lcTermContinuous', 'yes');
    // the migrated 'A/C' item is not an exact preset name -> classification required: classify it (category ac, confirmed), and mark every load existing
    for (let i = 0; i < h.state().snapshot.loads.length; i++) { const c = h.$('lcLoads').querySelectorAll('.lc-load')[i]; if (h.state().snapshot.loads[i].classification === 'required') { const cat = c.querySelectorAll('select')[0]; cat.value = 'ac'; cat.dispatch('change'); const cls = h.$('lcLoads').querySelectorAll('.lc-load')[i].querySelectorAll('select')[1]; cls.value = 'confirmed'; cls.dispatch('change'); } const st = h.$('lcLoads').querySelectorAll('.lc-load')[i].querySelectorAll('select')[2]; st.value = 'existing'; st.dispatch('change'); }
    h.$('lcConfirmCovers').dispatch('click');
    const before = h.state(); assert.strictEqual(before.result.status, 'COMPLETE'); assert.strictEqual(before.snapshot.migration.transforms.length, 4); assert.strictEqual(before.snapshot.method.selectionSource, 'manual');
    assert.strictEqual(h.api.lcFavSave(), true);
    const stored = JSON.parse(h.store.data); assert.strictEqual(stored.lc.length, 1); assert.strictEqual(stored.lc[0].vals.sourceFavId, 77); assert.strictEqual(stored.lc[0].vals.lcv, 3);
    const h2 = buildHarness({ storage: h.store.data }); h2.api.lcInit(); h2.set('lcOccupancy', 'nondwelling');   // a different live draft must not leak into the restore
    h2.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
    const after = h2.state();
    assert.deepStrictEqual(after.snapshot, before.snapshot); assert.deepStrictEqual(after.fieldErrors, before.fieldErrors); assert.deepStrictEqual(after.loadErrors, before.loadErrors); assert.deepStrictEqual(after.result, before.result);
    assert.strictEqual(after.sourceFavId, 77, 'ledger L-6: an lcv-3 record restores its stored sourceFavId verbatim (the old lcv-2 null rule is not resurrected)'); assert.deepStrictEqual(after.context, before.context); assert.strictEqual(h2.$('lcMethod').value, 'measured_220_87'); assert.strictEqual(h2.$('lcOccupancy').value, 'dwelling_unit_house');
  });
  // EC-AUDIT-FIX-1 (final regression triage): T-S-39 was one test on a fixture that mixed two things — a valid legacy preset with
  // unknown types / unknown properties, and list entries no version can read (`null`, a bare string). Under the accepted Favorites
  // boundary (core/src/storage/favoritesStore.js: only `absent` and `ok` are writable) those two have different outcomes, so they
  // are two tests now. Neither weakens the other: the valid legacy store keeps its full preservation + append contract, and the
  // malformed store must stay byte-identical with the save refused. The legacy preset is READABLE in both.
  test('T-S-39 storage-level (valid legacy store): legacy load, no write-back; Save appends a new lcv-3 record; the original record, unknown types and unknown properties are preserved, no schema migration of the stored legacy record', () => {
    const legacy = H.clone(H.caseById('T-S-22c').legacyRecord);
    const store = { zzUnknownType: [{ name: 'x', vals: { a: 1 }, id: 5 }], vd: [{ name: 'VD', vals: { amps: '1' }, id: 1, extra: 'keep' }], lc: [{ name: 'AC outlets', vals: legacy, id: 1002, note: 'user-added property' }] };
    const seed = JSON.stringify(store);
    const h = buildHarness({ storage: seed, promptAnswer: 'copy' }); h.api.lcInit();
    assert.deepStrictEqual(h.EC.favoritesStore.inspect(JSON.parse(seed)), [], 'fixture precondition: unknown types and unknown row properties do not make a store unwritable');
    h.api.favLoad('lc', 1002); assert.strictEqual(h.store.data, seed, 'loading a legacy preset writes nothing back'); assert.strictEqual(h.state().snapshot.dwelling.nycAcCircuitCount, 2); assert.strictEqual(h.state().sourceFavId, 1002);
    assert.strictEqual(h.api.lcFavSave(), true);
    const after = JSON.parse(h.store.data);
    assert.deepStrictEqual(after.zzUnknownType, store.zzUnknownType); assert.deepStrictEqual(after.vd, store.vd); assert.deepStrictEqual(after.lc.slice(0, 1), store.lc);
    // member for member AND in the stored key order: the legacy record is not migrated, re-ordered or stripped of its unknown property
    assert.strictEqual(JSON.stringify(after.lc[0]), JSON.stringify(store.lc[0])); assert.strictEqual(JSON.stringify(after.vd), JSON.stringify(store.vd)); assert.strictEqual(JSON.stringify(after.zzUnknownType), JSON.stringify(store.zzUnknownType));
    assert.ok(!Object.prototype.hasOwnProperty.call(after.lc[0].vals, 'lcv'), 'the stored legacy record is still legacy'); assert.strictEqual(after.lc[0].note, 'user-added property');
    assert.strictEqual(after.lc.length, 2); assert.strictEqual(after.lc[1].vals.lcv, 3); assert.strictEqual(after.lc[1].vals.sourceFavId, 1002); assert.deepStrictEqual(h.EC.loadCalcInputV2.downConvertToA({ snapshot: after.lc[1].vals.snapshot, parseErrors: [] }).snapshot, H.caseById('T-S-22c').migratedSnapshot);
    assert.strictEqual(after.lc.filter((f) => f && typeof f === 'object' && f.vals && f.vals.lcv === 3).length, 1, 'only the new record has the new payload');
  });
  test('T-S-39 storage-level (malformed list entries): the valid legacy preset beside a null entry and a bare string still loads with no write-back; Save is refused before the prompt and the stored bytes — null entries, unknown types, unknown properties — stay exactly as they were', () => {
    const legacy = H.clone(H.caseById('T-S-22c').legacyRecord);
    // The exact former T-S-39 fixture.
    const store = { zzUnknownType: [{ name: 'x', vals: { a: 1 }, id: 5 }], vd: [{ name: 'VD', vals: { amps: '1' }, id: 1, extra: 'keep' }], lc: [null, { name: 'AC outlets', vals: legacy, id: 1002, note: 'user-added property' }, 'not-an-object'] };
    const seed = JSON.stringify(store);
    const h = buildHarness({ storage: seed, promptAnswer: 'copy' }); h.api.lcInit();
    const problems = h.EC.favoritesStore.inspect(JSON.parse(seed));
    assert.strictEqual(problems.length, 1, 'fixture precondition: one structural problem, in the lc list only'); assert.ok(/"lc" presets collection contains 2 entries this version cannot read/.test(problems[0]), problems[0]);
    // Readability of the valid legacy preset is NOT lost in the recovery state.
    h.api.favLoad('lc', 1002); assert.strictEqual(h.store.data, seed, 'loading writes nothing back'); assert.strictEqual(h.state().snapshot.dwelling.nycAcCircuitCount, 2); assert.strictEqual(h.state().sourceFavId, 1002);
    const loaded = JSON.stringify(h.state().snapshot); const prompts = h.prompts.calls.length; const sets = h.store.sets;
    // Appending would mean rewriting a list this version cannot fully read: refused, nothing repaired or dropped.
    assert.strictEqual(h.api.lcFavSave(), false, 'not reported as saved');
    assert.strictEqual(h.prompts.calls.length, prompts, 'no name is asked for a preset that cannot be stored');
    assert.strictEqual(h.store.sets, sets, 'no storage write was attempted'); assert.strictEqual(h.store.data, seed, 'byte-for-byte: the null entry, the bare string, the unknown type and the unknown properties are all still stored');
    const fault = h.state().fault; assert.strictEqual(fault && fault.kind, 'storage');
    assert.ok(/unexpected format, so this preset was not saved/.test(fault.message), fault.message); assert.ok(/"lc" presets collection contains 2 entries this version cannot read/.test(fault.message), fault.message);
    assert.ok(/Nothing was written and nothing was replaced/.test(fault.message), fault.message); assert.ok(/Export raw data/.test(fault.message) && /Reset Favorites/.test(fault.message), 'the recovery actions are named: ' + fault.message);
    assert.strictEqual(JSON.stringify(h.state().snapshot), loaded, 'the loaded legacy draft is still on screen'); assert.strictEqual(h.state().sourceFavId, 1002);
    const read = h.EC.favoritesStore.read({ getItem: () => h.store.data });
    assert.strictEqual(read.state, 'unsupported'); assert.strictEqual(read.raw, seed, 'the raw value offered for export is the stored value');
    assert.deepStrictEqual(h.EC.favoritesStore.rows(read, 'lc').map((r) => r.id), [1002], 'the valid legacy preset is still listed; the two unreadable entries are not presented as presets');
  });
  test('a legacy list is never dropped or repaired: LegacyRecordError leaves the store, the list and the draft untouched; deleting an unrelated record still works once', () => {
    const seed = JSON.stringify({ lc: [{ name: 'Bad', vals: { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: '[', hvac: '[]', ev: '[]' }, id: 1 }, { name: 'Good', vals: H.caseById('T-S-04').legacyRecord, id: 2 }] });
    const h = buildHarness({ storage: seed }); h.api.lcInit(); const draft = JSON.stringify(h.state().snapshot);
    h.api.favLoad('lc', 1); assert.strictEqual(h.state().fault.kind, 'restore'); assert.strictEqual(h.store.data, seed); assert.strictEqual(JSON.stringify(h.state().snapshot), draft);
    h.api.favDelete('lc', 2); assert.deepStrictEqual(JSON.parse(h.store.data).lc.map((f) => f.id), [1]);
  });
});

describe('B2 PERSISTENCE — real browser: Save, storage, document reload, restore, save-as-copy (T-S-12 / T-S-39)', () => {
  test('tools/loadcalc-check-mobile.js reports no FAIL (BLOCKED items are environment limits, reported separately)', { skip: playwright ? false : playwrightReason }, async () => {
    const harness = require('../tools/loadcalc-check-mobile');
    const r = await harness.run({});
    const names = r.results.map((x) => x.name);
    for (const must of ['T-S-12 restore through the real row click', 'T-S-39 save-as-copy', 'real document reload keeps the same test storage', 'broken legacy preset: LegacyRecordError handled']) assert.ok(names.some((n) => n.startsWith(must)), 'gate covers: ' + must);
    assert.deepStrictEqual(r.fails.map((f) => f.name + ' — ' + f.detail), []);
    assert.ok(r.results.filter((x) => x.ok === true).length >= 80);
  });
});
