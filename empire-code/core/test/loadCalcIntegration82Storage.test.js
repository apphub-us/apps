'use strict';
/**
 * LC-22082-B0-UI-INTEGRATION-1 — actual UI Save/Restore and the single-key transaction boundary.
 * Storage is the harness's synthetic localStorage; every restore goes through the real Favorites row click
 * / favSetValues('lc') path and the real lcFavSave. Old formats are shown explicitly as old formats.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildHarness } = require('./helpers/loadCalcDom.js');
const H = require('./helpers/loadCalcFixtures.js');
const V2 = require('../src/calc/loadCalcInputV2.js');

const codes = (r) => r.problems.map((p) => p.code + '@' + p.field).sort();
const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const ctl = (card, role) => card.querySelectorAll('input, select, button').filter((e) => e.attrs['data-role'] === role)[0];
const setIn = (el, v) => { el.value = v; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
const addLoad = (h, i, va) => { h.$('lcPresetName').value = String(i); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click'); return cards(h).slice(-1)[0]; };
function driveB0(h) {
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_balanced_LN'); h.set('lcDeclBalancedLN', 'yes');
  h.set('lcFloorArea', '1500'); h.set('lcSmallApplianceCircuits', '2'); h.set('lcLaundryCircuits', '1'); h.set('lcNycAcCircuits', '0'); h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); h.set('lcConductorAmpacity', '200'); h.set('lcNycAcException', 'yes');
  addLoad(h, 0, 12000); addLoad(h, 3, 4500); addLoad(h, 1, 5000); addLoad(h, 2, 1200); addLoad(h, 4, 5000);
  setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit'); setIn(ctl(cards(h)[3], 'inclusion'), 'fixed_or_permanently_connected'); setIn(ctl(cards(h)[4], 'coverage'), 'yes'); h.set('lcInventoryComplete', 'yes');
}
const clickRow = (h, i) => { h.$('lc-fav-list').querySelectorAll('.fav-item')[i || 0].dispatch('click'); };
const freshWith = (h, extra) => { const g = buildHarness(Object.assign({ storage: h.store.data }, extra || {})); g.api.lcInit(); return g; };

describe('D. Save/Restore — lcv-3 round trips, A-selected dormant 82 data, sourceFavId, old formats and their guards', () => {
  test('a complete 82 draft round-trips through Save and a fresh document: snapshot, context, both maps, dormant/stale facts; result recomputed, not stored', () => {
    const h = buildHarness({ promptAnswer: 'B0 house' }); h.api.lcInit(); driveB0(h);
    ctl(cards(h)[4], 'basis-changed').dispatch('click'); h.set('lcFloorArea', '15x'); const saved = h.state(); assert.strictEqual(saved.result.status, 'INVALID_INPUT'); assert.strictEqual(saved.snapshot.loads[4].ratingCoverage82.basis.basisId, 'bs-L5-1');
    assert.strictEqual(h.api.lcFavSave(), true); const all = JSON.parse(h.store.data); assert.strictEqual(all.lc.length, 1); const rec = all.lc[0];
    assert.strictEqual(rec.name, 'B0 house'); assert.deepStrictEqual(Object.keys(rec.vals), ['lcv', 'capabilityProfile', 'context', 'snapshot', 'fieldErrors', 'loadErrors', 'sourceFavId']); assert.strictEqual(rec.vals.lcv, 3); assert.ok(!('result' in rec.vals) && !('facade' in rec.vals), 'no result/cache/facade metadata is stored');
    assert.deepStrictEqual(rec.vals.snapshot, saved.snapshot); assert.deepStrictEqual(rec.vals.fieldErrors, { 'dwelling.floorAreaFt2': { raw: '15x', code: 'NOT_FINITE' } });
    const g = freshWith(h); assert.strictEqual(g.$('lc-fav-list').querySelectorAll('.fav-item').length, 1); clickRow(g);
    const r = g.state(); assert.strictEqual(r.fault, null); assert.deepStrictEqual(r.snapshot, saved.snapshot); assert.deepStrictEqual(r.context, saved.context); assert.deepStrictEqual(r.fieldErrors, saved.fieldErrors); assert.deepStrictEqual(r.loadErrors, saved.loadErrors); assert.strictEqual(r.sourceFavId, null);
    assert.deepStrictEqual(r.result, saved.result, 'recomputed from the restored data'); assert.strictEqual(g.$('lcFloorArea').value, '15x'); assert.strictEqual(g.$('lcArrangement').value, 'ac_only'); assert.strictEqual(ctl(cards(g)[2], 'inclusion').value, 'not_on_counted_laundry_circuit');
    g.set('lcFloorArea', '1500'); const r2 = g.state(); assert.deepStrictEqual(codes(r2.result), ['PREMISE_STALE@loads[4].ratingCoverage82', 'PREMISE_STALE@optional82.inventoryComplete'], 'stale facts survive the round trip');
  });
  test('saving while A is selected keeps the dormant 82 data losslessly (no down-conversion); restoring and switching back to 82 recomputes the same COMPLETE', () => {
    const h = buildHarness({ promptAnswer: 'dormant' }); h.api.lcInit(); driveB0(h); const complete = h.state().result; assert.strictEqual(complete.status, 'COMPLETE');
    h.set('lcMethod', 'measured_220_87'); assert.strictEqual(h.state().result.profileId, 'A_measured_87_core');
    assert.strictEqual(h.api.lcFavSave(), true); const rec = JSON.parse(h.store.data).lc[0]; assert.strictEqual(rec.vals.lcv, 3); assert.strictEqual(rec.vals.snapshot.schemaVersion, '3.3.0'); assert.strictEqual(rec.vals.snapshot.loads[4].ratingCoverage82.value, true); assert.strictEqual(rec.vals.snapshot.optional82.inventoryComplete.value, true);
    const g = freshWith(h); clickRow(g); assert.strictEqual(g.state().result.profileId, 'A_measured_87_core'); g.set('lcMethod', 'opt_220_82'); assert.deepStrictEqual(g.state().result, complete);
  });
  test('sourceFavId is preserved exactly: null (fresh), string (lcv-2 upgrade), number (legacy outer id) — each verbatim through an lcv-3 save', () => {
    const h = buildHarness({ promptAnswer: 'p' }); h.api.lcInit(); driveB0(h); assert.strictEqual(h.state().sourceFavId, null); h.api.lcFavSave(); assert.strictEqual(JSON.parse(h.store.data).lc[0].vals.sourceFavId, null);
    const aSnap = V2.downConvertToA({ snapshot: h.state().snapshot, parseErrors: [] }).snapshot;
    const old2 = { lcv: 2, profileId: 'A_measured_87_core', snapshot: aSnap, fieldErrors: {}, loadErrors: {}, sourceFavId: 'legacy-key-9' };   // an explicit OLD lcv-2 record
    const g = buildHarness({ storage: JSON.stringify({ lc: [{ id: 11, name: 'old2', vals: old2 }] }), promptAnswer: 'copy2' }); g.api.lcInit(); clickRow(g);
    assert.strictEqual(g.state().sourceFavId, 'legacy-key-9', 'lcv-2 upgrade keeps the old payload sourceFavId'); assert.deepStrictEqual(g.state().context.importedFrom, { lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' });
    g.api.lcFavSave(); const all = JSON.parse(g.store.data); assert.strictEqual(all.lc.length, 2); assert.strictEqual(all.lc[1].vals.sourceFavId, 'legacy-key-9'); assert.deepStrictEqual(all.lc[0].vals, old2, 'the old record is untouched');
    const k = buildHarness({ storage: JSON.stringify({ lc: [{ id: 1001, name: 'legacy', vals: H.caseById('T-S-04c').legacyRecord }] }), promptAnswer: 'copy1' }); k.api.lcInit(); clickRow(k);
    assert.strictEqual(k.state().sourceFavId, 1001, 'legacy: the external Favorite id'); k.api.lcFavSave(); assert.strictEqual(JSON.parse(k.store.data).lc[1].vals.sourceFavId, 1001);
    const k2 = freshWith(k); clickRow(k2, 1); assert.strictEqual(k2.state().sourceFavId, 1001, 'verbatim on the lcv-3 path (not reset to null)');
  });
  test('old-valid but unrepresentable lcv-2 records refuse conversion with a precise reason: literal loads[].quantity / loads[].rating.value error paths; the original stays listed and the draft untouched', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h); const aSnap = V2.downConvertToA({ snapshot: h.state().snapshot, parseErrors: [] }).snapshot; const before = JSON.stringify(h.state().snapshot);
    for (const literal of ['loads[].quantity', 'loads[].rating.value']) {
      const old2 = { lcv: 2, profileId: 'A_measured_87_core', snapshot: aSnap, fieldErrors: { [literal]: { raw: '', code: 'MISSING_FIELD' } }, loadErrors: {}, sourceFavId: null };
      h.store.data = JSON.stringify({ lc: [{ id: 3, name: 'literal ' + literal, vals: old2 }] }); h.api.favRender('lc'); clickRow(h);
      const s = h.state(); assert.strictEqual(s.fault && s.fault.kind, 'restore', literal); assert.ok(/valid lcv-2 record whose contents cannot be converted losslessly/.test(s.fault.message), s.fault.message); assert.ok(s.fault.details.some((d) => /conversion refused/.test(d)), JSON.stringify(s.fault.details));
      assert.strictEqual(JSON.stringify(s.snapshot), before); assert.strictEqual(h.$('lc-fav-list').querySelectorAll('.fav-item').length, 1); assert.deepStrictEqual(JSON.parse(h.store.data).lc[0].vals, old2, 'not overwritten, not removed');
      assert.ok(!/loads\[0\]|first/.test(s.fault.message), 'the error is not attributed to an invented record'); assert.ok(/RESTORE FAILED/.test(h.text()) && !/23,680/.test(h.text()));
    }
    h.set('lcFloorArea', '1500'); assert.strictEqual(h.state().fault, null); assert.strictEqual(h.state().result.status, 'COMPLETE', 'the live draft is still editable after the refusal');
  });
  test('unknown versions, malformed context/snapshot/maps, duplicate ids and own-key special ids: atomic refusal with the draft, list and store unchanged; special ids that are unique still round-trip', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h); const good = h.api.lcFavPayload(); const before = JSON.stringify(h.state().snapshot);
    const cases = [
      ['lcv 1 explicit', { lcv: 1, snapshot: good.snapshot }, /unsupported Load Calc version \(payload v1/],
      ['lcv 4', Object.assign({}, good, { lcv: 4 }), /unsupported Load Calc version \(payload v4/],
      ['lcv string', Object.assign({}, good, { lcv: '3' }), /unsupported Load Calc version/],
      ['context missing', (() => { const p = Object.assign({}, good); delete p.context; return p; })(), /lcv-3 contract/],
      ['context wrong flag type', Object.assign({}, good, { context: { importedFrom: null, methodConfirmedAfterImport: 'yes' } }), /lcv-3 contract/],
      ['context extra key', Object.assign({}, good, { context: { importedFrom: null, methodConfirmedAfterImport: false, extra: 1 } }), /lcv-3 contract/],
      ['snapshot schema 3.2.1 inside lcv-3', Object.assign({}, good, { snapshot: V2.downConvertToA({ snapshot: good.snapshot, parseErrors: [] }).snapshot }), /lcv-3 contract/],
      ['snapshot inventory basis malformed', Object.assign({}, good, { snapshot: Object.assign({}, good.snapshot, { optional82: Object.assign({}, good.snapshot.optional82, { inventoryComplete: { value: true, provenance: { source: 'designer_declaration', note: null }, basis: { members: 'x' } } }) }) }), /lcv-3 contract/],
      ['fieldErrors array', Object.assign({}, good, { fieldErrors: [] }), /lcv-3 contract/],
      ['loadErrors null', Object.assign({}, good, { loadErrors: null }), /lcv-3 contract/],
      ['fieldErrors unknown path', Object.assign({}, good, { fieldErrors: { 'dwelling.nope': { raw: '', code: 'MISSING_FIELD' } } }), /lcv-3 contract/],
      ['loadErrors ghost id', Object.assign({}, good, { loadErrors: { ghost: { quantity: { raw: '', code: 'MISSING_FIELD' } } } }), /lcv-3 contract/],
      ['duplicate ids', Object.assign({}, good, { snapshot: Object.assign({}, good.snapshot, { loads: good.snapshot.loads.concat([Object.assign({}, good.snapshot.loads[0])]) }) }), /lcv-3 contract/],
      ['duplicate __proto__ ids', Object.assign({}, good, { snapshot: Object.assign({}, good.snapshot, { loads: good.snapshot.loads.map((l, i) => Object.assign({}, l, { id: i < 2 ? '__proto__' : l.id })) }) }), /lcv-3 contract/]
    ];
    for (const [label, vals, re] of cases) {
      const seed = JSON.stringify({ lc: [{ id: 9, name: label, vals }], vd: [{ id: 1, name: 'other', vals: { amps: '1' } }] }); h.store.data = seed; h.api.favRender('lc'); const sets = h.store.sets;
      assert.doesNotThrow(() => clickRow(h), label); const s = h.state();
      assert.strictEqual(s.fault && s.fault.kind, 'restore', label); assert.ok(re.test(s.fault.message), label + ': ' + s.fault.message); assert.strictEqual(JSON.stringify(s.snapshot), before, label); assert.strictEqual(h.store.data, seed, label); assert.strictEqual(h.store.sets, sets, label);
      assert.ok(/RESTORE FAILED/.test(h.text()) && !/23,680|Total demand/.test(h.text()), label + ': no stale success');
    }
    assert.strictEqual(Object.prototype.quantity, undefined);
    // unique special ids are ordinary data on the lcv-3 path
    const special = Object.assign({}, good, { snapshot: Object.assign({}, good.snapshot, { loads: good.snapshot.loads.map((l, i) => Object.assign({}, l, { id: ['__proto__', 'constructor', 'hasOwnProperty', 'L4', 'L5'][i] })) }) });
    h.store.data = JSON.stringify({ lc: [{ id: 10, name: 'special', vals: special }] }); h.api.favRender('lc'); clickRow(h);
    let s = h.state(); assert.strictEqual(s.fault, null); assert.deepStrictEqual(s.snapshot.loads.map((l) => l.id), ['__proto__', 'constructor', 'hasOwnProperty', 'L4', 'L5']);
    assert.deepStrictEqual(codes(s.result), ['PREMISE_STALE@optional82.inventoryComplete'], 'renamed ids no longer match the declared inventory members: stale, not silently accepted'); h.set('lcInventoryComplete', 'yes'); s = h.state(); assert.strictEqual(s.result.status, 'COMPLETE');
    setIn(ctl(cards(h)[0], 'quantity'), ''); s = h.state(); assert.ok(Object.hasOwn(s.loadErrors, '__proto__')); assert.strictEqual(Object.prototype.quantity, undefined); assert.ok(codes(s.result).includes('MISSING_FIELD@loads[0].quantity'), codes(s.result).join()); assert.ok(s.lastRequest.parseErrors.some((e) => e.field === 'loads[0].quantity'));
    const g = buildHarness({ storage: null, promptAnswer: 'sp' }); g.api.lcInit(); g.api.favSetValues('lc', JSON.parse(JSON.stringify(h.api.lcFavPayload())), 10); assert.strictEqual(g.state().fault, null); assert.ok(Object.hasOwn(g.state().loadErrors, '__proto__'));
    assert.strictEqual(g.api.lcAllocLoadId(g.api.lcDraft()), 'L1', 'deterministic allocation skips only taken ids'); assert.strictEqual(g.api.lcAllocBasisId(g.api.lcDraft(), 'L4'), 'bs-L4-2');
    // equal basis ids across records are not a structural refusal of the accepted contract; the adapter's allocator never creates a colliding basis
    const eq = Object.assign({}, good, { snapshot: Object.assign({}, good.snapshot, { loads: good.snapshot.loads.map((l) => Object.assign({}, l, { basisId: 'bs-L1-1' })) }) }); assert.deepStrictEqual(h.EC.loadCalcStorageV2.validatePayloadV3(eq), []);
    const r = h.EC.loadCalcStorageV2.restorePayloadV3(eq); assert.ok(r.ok); assert.strictEqual(h.api.lcAllocBasisId(r.draft, 'L1'), 'bs-L1-2'); assert.strictEqual(h.api.lcAllocBasisId(r.draft, 'L2'), 'bs-L2-2', 'bs-L2-1 is still referenced by a retained fact basis, so it is taken'); assert.strictEqual(h.api.lcAllocBasisId(r.draft, 'L9'), 'bs-L9-1');
  });
  test('legacy (unversioned) and lcv-2 guards: LegacyRecordError, mixed laundry, a record with lcv is never sent to the legacy migrator; structurally valid incomplete/stale/false data saves and reloads', () => {
    const bad = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: '[', hvac: '[]', ev: '[]' };
    const h = buildHarness({ storage: JSON.stringify({ lc: [{ id: 1, name: 'Bad', vals: bad }, { id: 2, name: 'Good', vals: H.caseById('T-S-04').legacyRecord }] }) }); h.api.lcInit(); const draft = JSON.stringify(h.state().snapshot);
    clickRow(h, 0); let s = h.state(); assert.strictEqual(s.fault && s.fault.kind, 'restore'); assert.ok(/LEGACY_UNPARSEABLE_LIST/.test(s.fault.message) && /"Bad"/.test(s.fault.message)); assert.strictEqual(JSON.stringify(s.snapshot), draft);
    clickRow(h, 1); s = h.state(); assert.strictEqual(s.fault, null); assert.strictEqual(s.snapshot.schemaVersion, '3.3.0'); assert.deepStrictEqual(V2.downConvertToA(s.lastRequest).snapshot, H.caseById('T-S-04').migratedSnapshot); assert.strictEqual(s.sourceFavId, 2);
    const lcv2Bad = { lcv: 2, profileId: 'A_measured_87_core', snapshot: { schemaVersion: '9.9.9' }, fieldErrors: {}, loadErrors: {}, sourceFavId: null };
    h.store.data = JSON.stringify({ lc: [{ id: 5, name: 'lcv2 bad', vals: lcv2Bad }] }); h.api.favRender('lc'); clickRow(h); s = h.state(); assert.strictEqual(s.fault.kind, 'restore'); assert.ok(/not a valid lcv-2 record/.test(s.fault.message), s.fault.message);
    // structurally valid, semantically incomplete + stale + a false declaration: saves and reloads unchanged
    const g = buildHarness({ promptAnswer: 'incomplete' }); g.api.lcInit(); driveB0(g); g.set('lcSingleSupplySet', 'no'); g.set('lcFloorArea', ''); setIn(ctl(cards(g)[0], 'quantity'), '2'); const st = g.state(); assert.ok(['UNQUALIFIED_METHOD', 'INCOMPLETE_INPUT'].includes(st.result.status), st.result.status);
    assert.strictEqual(g.api.lcFavSave(), true); const g2 = freshWith(g); clickRow(g2); assert.deepStrictEqual(g2.state().snapshot, st.snapshot); assert.deepStrictEqual(g2.state().result, st.result); assert.strictEqual(g2.state().snapshot.optional82.singleSupplySet.value, false);
  });
});

describe('E. transaction negatives — corrupt root, non-array LC collection, missing LC key, prompt cancel, read failure, simulated setItem/quota failure; unrelated rows untouched', () => {
  test('corrupt root JSON: no prompt, nothing written, explicit STORAGE ERROR; non-array lc collection: refused, never reset; missing lc key (positive control): created on save', () => {
    const h = buildHarness({ storage: '{corrupt', promptAnswer: 'x' }); h.api.lcInit(); driveB0(h);
    assert.strictEqual(h.api.lcFavSave(), false); assert.strictEqual(h.store.data, '{corrupt'); assert.strictEqual(h.store.sets, 0); assert.strictEqual(h.prompts.calls.length, 0); assert.ok(/STORAGE ERROR/.test(h.text()) && /unreadable/.test(h.text()) && !/23,680|Total demand/.test(h.text()), 'no stale COMPLETE rendered under the fault');
    h.set('lcFloorArea', '1500'); assert.strictEqual(h.state().fault, null); assert.strictEqual(h.state().result.status, 'COMPLETE', 'the draft survived the storage fault');
    for (const bad of ['{"lc": {}}', '{"lc": null}', '{"lc": "str"}', '{"lc": 5}']) {
      const g = buildHarness({ storage: bad, promptAnswer: 'x' }); g.api.lcInit(); driveB0(g);
      assert.strictEqual(g.api.lcFavSave(), false, bad); assert.strictEqual(g.store.data, bad, bad + ' is never reset or sanitized'); assert.strictEqual(g.store.sets, 0); assert.strictEqual(g.prompts.calls.length, 0); assert.ok(/unexpected format/.test(g.text()), bad);
    }
    const seed = JSON.stringify({ vd: [{ id: 1, name: 'VD', vals: { amps: '1' } }], zz: { keep: true } });
    const k = buildHarness({ storage: seed, promptAnswer: 'created' }); k.api.lcInit(); driveB0(k); assert.strictEqual(k.api.lcFavSave(), true);
    const all = JSON.parse(k.store.data); assert.strictEqual(all.lc.length, 1); assert.deepStrictEqual(all.vd, JSON.parse(seed).vd); assert.deepStrictEqual(all.zz, { keep: true }); assert.strictEqual(k.store.sets, 1);
  });
  test('prompt cancel writes nothing; read failure (getItem throws) is a controlled fault; a SIMULATED setItem/quota failure writes nothing and shows no success; the next save works', () => {
    const h = buildHarness({ promptAnswer: null }); h.api.lcInit(); driveB0(h); assert.strictEqual(h.api.lcFavSave(), false); assert.strictEqual(h.store.data, null); assert.strictEqual(h.store.sets, 0); assert.strictEqual(h.prompts.calls.length, 1);
    const g = buildHarness({ promptAnswer: 'q' }); g.api.lcInit(); driveB0(g);
    // SIMULATED quota failure: the synthetic store throws on the next setItem (this is not a real storage-pressure test)
    g.store.failNextSet = Object.assign(new Error('QuotaExceededError (simulated)'), { name: 'QuotaExceededError' });
    assert.strictEqual(g.api.lcFavSave(), false); assert.strictEqual(g.store.data, null); assert.ok(/STORAGE ERROR/.test(g.text()) && /storage full or unavailable/.test(g.text())); assert.ok(!/Saved as a new preset/.test(g.$('lcFavStatus').textContent));
    assert.strictEqual(g.api.lcFavSave(), true); assert.strictEqual(JSON.parse(g.store.data).lc.length, 1); assert.strictEqual(g.state().fault, null); assert.ok(/Saved as a new preset "q" \(lcv-3\)/.test(g.$('lcFavStatus').textContent));
    // SIMULATED security failure on read
    const k = buildHarness({ promptAnswer: 'r' }); k.api.lcInit(); driveB0(k); const realGet = k.EC; void realGet;
    const seed = JSON.stringify({ lc: [{ id: 1, name: 'row', vals: { lcv: 2, profileId: 'A_measured_87_core', snapshot: {}, fieldErrors: {}, loadErrors: {}, sourceFavId: null }, extra: 'keep' }, 'not-an-object', null], vd: [{ id: 2, name: 'v', vals: { amps: '2' } }] });
    k.store.data = seed; k.api.favRender('lc'); assert.strictEqual(k.api.lcFavSave(), true); const all = JSON.parse(k.store.data);
    assert.deepStrictEqual(all.lc.slice(0, 3), JSON.parse(seed).lc, 'malformed-but-retained rows, null entries and unknown properties are untouched'); assert.deepStrictEqual(all.vd, JSON.parse(seed).vd); assert.strictEqual(all.lc.length, 4); assert.strictEqual(all.lc[3].vals.lcv, 3);
    clickRow(k, 0); assert.strictEqual(k.state().fault.kind, 'restore'); assert.strictEqual(k.store.data, JSON.stringify(all), 'a failed restore of the malformed row writes nothing');
    k.api.favDelete('lc', 1); assert.strictEqual(JSON.parse(k.store.data).lc.length, 3, 'an unrelated delete still works once');
  });
  test('two saves get distinct ids even in the same millisecond; every save appends (never in-place upgrade, never bulk conversion of old rows)', () => {
    const old = H.caseById('T-S-04c').legacyRecord;
    const h = buildHarness({ storage: JSON.stringify({ lc: [{ id: 1001, name: 'legacy', vals: old }] }), promptAnswer: 'twice' }); h.api.lcInit(); driveB0(h);
    h.api.lcFavSave(); h.api.lcFavSave(); const all = JSON.parse(h.store.data);
    assert.strictEqual(all.lc.length, 3); assert.notStrictEqual(all.lc[1].id, all.lc[2].id); assert.deepStrictEqual(all.lc[0], { id: 1001, name: 'legacy', vals: old }, 'the old row is not upgraded in place'); assert.strictEqual(all.lc.filter((f) => f.vals.lcv === 3).length, 2);
  });
});

// ── LC-22082-B0-UI-INTEGRATION-1-R1 — storage side of U2 / U3 ──────────────────────────────────────────────
describe('R1 / U2+U3 storage — error-bearing records, corrections and the untouched source Favorite', () => {
  test('an error-bearing lcv-3 record is restored, corrected through real controls and saved as a NEW clean record; the original bytes never change', () => {
    const h = buildHarness({ promptAnswer: 'with errors' }); h.api.lcInit(); driveB0(h);
    const p = h.api.lcFavPayload();
    p.loadErrors.L3 = { inclusion82: { raw: '?', code: 'UNKNOWN_ENUM' } };
    p.fieldErrors['optional82.singleSupplySet'] = { raw: '?', code: 'UNKNOWN_ENUM' };
    const seed = JSON.stringify({ lc: [{ id: 60, name: 'error draft', vals: p }], vd: [{ id: 1, name: 'other', vals: { amps: '3' } }] });
    const g = buildHarness({ storage: seed, promptAnswer: 'corrected copy' }); g.api.lcInit(); clickRow(g);
    assert.strictEqual(g.state().fault, null); assert.strictEqual(g.state().result.status, 'INVALID_INPUT');
    setIn(ctl(cards(g)[2], 'inclusion'), 'not_on_counted_laundry_circuit');
    assert.strictEqual(g.state().result.status, 'INVALID_INPUT', 'the second error still blocks');
    assert.deepStrictEqual(g.state().fieldErrors['optional82.singleSupplySet'], { raw: '?', code: 'UNKNOWN_ENUM' });
    g.set('lcSingleSupplySet', 'yes');
    assert.strictEqual(g.state().result.status, 'COMPLETE'); assert.strictEqual(g.state().result.demand.totalVA, 23680);
    assert.strictEqual(g.api.lcFavSave(), true);
    const all = JSON.parse(g.store.data);
    assert.strictEqual(JSON.stringify(all.lc[0]), JSON.stringify(JSON.parse(seed).lc[0]), 'the source record is byte-identical');
    assert.deepStrictEqual(all.vd, JSON.parse(seed).vd);
    assert.strictEqual(all.lc.length, 2); assert.deepStrictEqual(all.lc[1].vals.loadErrors, {}); assert.deepStrictEqual(all.lc[1].vals.fieldErrors, {});
    const k = buildHarness({ storage: g.store.data }); k.api.lcInit(); clickRow(k, 1);
    assert.strictEqual(k.state().result.status, 'COMPLETE'); assert.deepStrictEqual(k.state().loadErrors, {}); assert.deepStrictEqual(k.state().fieldErrors, {});
  });
  test('a special-id lcv-2 record imports, is answered and saved as lcv-3 with its own-key ids preserved end to end', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h);
    const aSnap = V2.downConvertToA({ snapshot: h.state().snapshot, parseErrors: [] }).snapshot; aSnap.loads[0].id = '__proto__';
    const old = { lcv: 2, profileId: 'A_measured_87_core', snapshot: aSnap, fieldErrors: {}, loadErrors: {}, sourceFavId: 'old-proto' };
    const seed = JSON.stringify({ lc: [{ id: 61, name: 'proto record', vals: old }] });
    const g = buildHarness({ storage: seed, promptAnswer: 'proto answered' }); g.api.lcInit(); clickRow(g);
    let s = g.state(); assert.strictEqual(s.fault, null); assert.strictEqual(s.snapshot.loads[0].basisId, 'bs-__proto__-1'); assert.strictEqual(s.sourceFavId, 'old-proto');
    g.$('lcConfirmMethod').dispatch('click');
    setIn(ctl(cards(g)[2], 'inclusion'), 'not_on_counted_laundry_circuit'); setIn(ctl(cards(g)[3], 'inclusion'), 'fixed_or_permanently_connected'); setIn(ctl(cards(g)[4], 'coverage'), 'yes');
    // the lcv-2 record is an A-only snapshot: the 220.82 qualification data is not in it and must be answered after the import
    g.set('lcNycAcCircuits', '0'); g.set('lcSingleSupplySet', 'yes'); g.set('lcConductorAmpacity', '200'); g.set('lcNycAcException', 'yes'); g.set('lcInventoryComplete', 'yes');
    s = g.state(); assert.strictEqual(s.result.status, 'COMPLETE', codes(s.result).join()); assert.strictEqual(s.result.demand.totalVA, 23680);
    assert.strictEqual(g.api.lcFavSave(), true);
    const all = JSON.parse(g.store.data); assert.strictEqual(all.lc.length, 2);
    assert.strictEqual(JSON.stringify(all.lc[0]), JSON.stringify(JSON.parse(seed).lc[0]));
    assert.strictEqual(all.lc[1].vals.snapshot.loads[0].id, '__proto__'); assert.strictEqual(all.lc[1].vals.snapshot.loads[0].basisId, 'bs-__proto__-1'); assert.strictEqual(all.lc[1].vals.sourceFavId, 'old-proto');
    const k = buildHarness({ storage: g.store.data }); k.api.lcInit(); clickRow(k, 1);
    assert.strictEqual(k.state().fault, null); assert.strictEqual(k.state().result.status, 'COMPLETE'); assert.strictEqual(Object.prototype['bs-__proto__-1'], undefined);
  });
});
