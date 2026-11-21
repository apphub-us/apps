'use strict';
/**
 * LC-22082-B0-STATE-STORE-1 — tests for src/calc/loadCalcStorageV2.js (lcv-3 format, old-record import I1–I3).
 * Pure helpers only: no localStorage; nothing here is a storage transaction or quota test.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ST = require('../src/calc/loadCalcStateV2.js');
const SS = require('../src/calc/loadCalcStorageV2.js');
const V2 = require('../src/calc/loadCalcInputV2.js');
const AI = require('../src/calc/loadCalcInput.js');
const AS = require('../src/calc/loadCalcState.js');
const F = require('../src/calc/loadCalcFacade.js');

const ROOT = path.join(__dirname, '..');
const LC82 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'LC82-cases-r1.json'), 'utf8'));
const R22 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'EC-CALC-2-A3-test-cases-r22.json'), 'utf8'));
const B0P = LC82.cases.find((c) => c.id === 'LC82-B0P').request;
const clone = (v) => JSON.parse(JSON.stringify(v));
const frozen = (v) => JSON.stringify(v);
const unwrap = (r, what) => { assert.strictEqual(r.ok, true, `${what}: ${JSON.stringify(r.problems)}`); return r; };
const { dict, put } = ST._internal;
/** The frozen descriptor exactly as supplied in evidence (34 paths, 2 subfields, A profile). */
const DESCRIPTOR = () => ({ profileId: 'A_measured_87_core', fieldPaths: SS.FROZEN_A_LCV2.fieldPaths.slice(), loadSubfields: SS.FROZEN_A_LCV2.loadSubfields.slice() });
const alloc = (snapshot) => { const m = {}; snapshot.loads.forEach((l, i) => { m[l.id] = `bs-${l.id}-u${i}`; }); return m; };
const opts = (extra) => Object.assign({ legacyContract: DESCRIPTOR(), basisIdByLoadId: {}, sourceFavId: null }, extra || {});

function draftFromRequest(req, sourceFavId) {
  const d = ST.createEmptyDraftV2(); d.snapshot = clone(req.snapshot); d.context = clone(req.context); d.sourceFavId = sourceFavId === undefined ? null : sourceFavId; return d;
}
/** A valid lcv-2 payload built from an r22 A envelope (the accepted B2 shape). */
function lcv2FromEnvelope(env, extra) {
  return Object.assign({ lcv: 2, profileId: 'A_measured_87_core', snapshot: clone(env.snapshot), fieldErrors: {}, loadErrors: {}, sourceFavId: null }, extra || {});
}
const TS15 = R22.cases.find((c) => c.id === 'T-S-15').envelope;
const TS16 = R22.cases.find((c) => c.id === 'T-S-16').envelope;   // two loads (ev1, gd), measured method

describe('lcv-3 payload — serialization, validation, lossless restore', () => {
  test('B0-P draft round-trips byte-for-byte (82 selected); the payload has exactly the seven keys and no result', () => {
    const d = draftFromRequest(B0P, 17); const before = frozen(d);
    const p = unwrap(SS.toPayloadV3(d), 'payload').payload;
    assert.deepStrictEqual(Object.keys(p), ['lcv', 'capabilityProfile', 'context', 'snapshot', 'fieldErrors', 'loadErrors', 'sourceFavId']);
    assert.strictEqual(p.lcv, 3); assert.strictEqual(p.capabilityProfile, 'AB82_core1'); assert.strictEqual(p.sourceFavId, 17); assert.ok(!('result' in p) && !('facade' in p));
    assert.deepStrictEqual(SS.validatePayloadV3(p), []);
    const back = unwrap(SS.restorePayloadV3(p), 'restore').draft; assert.strictEqual(frozen(back), before); assert.strictEqual(frozen(d), before, 'input untouched');
    assert.deepStrictEqual(SS.validatePayloadV3(JSON.parse(JSON.stringify(p))), [], 'survives JSON text');
  });
  test('a draft with A selected keeps every 82 datum (optional82, basisId, facts) — not downgraded; delegated result equals direct A', () => {
    const d = draftFromRequest(B0P, 'old-17'); d.snapshot.method.selected = 'measured_220_87';
    const p = unwrap(SS.toPayloadV3(d), 'payload').payload; assert.ok(p.snapshot.optional82 && p.snapshot.loads[2].inclusion82.answer === 'not_on_counted_laundry_circuit');
    const back = unwrap(SS.restorePayloadV3(p), 'restore').draft; assert.strictEqual(frozen(back), frozen(d)); assert.strictEqual(back.sourceFavId, 'old-17');
    const r = unwrap(ST.toRequestV2(back), 'req').request; assert.strictEqual(JSON.stringify(F.evaluateV2(r).result), JSON.stringify(require('../src/calc/loadCalc.js').evaluate(V2.downConvertToA(r))));
  });
  test('active and inactive maps, stale facts and every sourceFavId form survive the round trip verbatim; context preserved', () => {
    const d = draftFromRequest(B0P, null);
    put(d.fieldErrors, 'measurement.newLoad.precalculated.va', { raw: '12k', code: 'NOT_FINITE' }); put(d.fieldErrors, 'hvac.installingAdditionalHvac', { raw: 'maybe', code: 'UNKNOWN_ENUM' });
    const le = dict(); put(le, 'quantity', { raw: '1.5', code: 'NOT_INTEGER', badInput: true }); put(le, 'inclusion82', { raw: 'old', code: 'UNKNOWN_ENUM' }); put(d.loadErrors, 'L3', le);
    d.snapshot.loads[4].rating.value = 6000;   // the coverage fact is now stale — still savable
    d.context = { importedFrom: { lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' }, methodConfirmedAfterImport: true };
    for (const sfi of [null, 42, 'old-17', -0.5]) {
      d.sourceFavId = sfi; const p = unwrap(SS.toPayloadV3(d), 'payload ' + sfi).payload; const back = unwrap(SS.restorePayloadV3(p), 'restore ' + sfi).draft;
      assert.strictEqual(frozen(back), frozen(d)); assert.deepStrictEqual(back.context, d.context);
      assert.deepStrictEqual(back.loadErrors.L3.quantity, { raw: '1.5', code: 'NOT_INTEGER', badInput: true });
    }
    const out = F.evaluateV2(unwrap(ST.toRequestV2(d), 'req').request).result; assert.strictEqual(out.status, 'INVALID_INPUT', 'semantically blocked drafts are still structurally valid to store');
  });
  test('malformed wrappers are refused as a whole, without mutation and without a blank replacement', () => {
    const good = unwrap(SS.toPayloadV3(draftFromRequest(B0P, 1)), 'good').payload;
    const bad = (mut, re) => { const p = clone(good); mut(p); const before = frozen(p); const v = SS.validatePayloadV3(p); assert.ok(v.length, 'expected refusal'); assert.ok(v.some((m) => re.test(m)), JSON.stringify(v)); const r = SS.restorePayloadV3(p); assert.strictEqual(r.ok, false); assert.ok(!('draft' in r)); assert.strictEqual(frozen(p), before); };
    bad((p) => { p.lcv = 4; }, /version 4 is not 3/); bad((p) => { p.lcv = 2; }, /version 2 is not 3/);
    bad((p) => { p.capabilityProfile = 'B82_core1'; }, /capabilityProfile/); bad((p) => { p.result = {}; }, /unexpected payload key/); bad((p) => { delete p.context; }, /missing payload key context/);
    bad((p) => { p.context = { importedFrom: null }; }, /methodConfirmedAfterImport/); bad((p) => { p.context.importedFrom = { lcv: 0, profileId: 'x', schemaVersion: 'y' }; }, /lcv/);
    bad((p) => { p.sourceFavId = {}; }, /sourceFavId/); bad((p) => { p.sourceFavId = Infinity; }, /not JSON|sourceFavId/);
    bad((p) => { p.snapshot.schemaVersion = '3.2.1'; }, /schemaVersion/); bad((p) => { delete p.snapshot.optional82.inventoryComplete.provenance; }, /provenance/);
    bad((p) => { p.snapshot.optional82.inventoryComplete = null; }, /inventoryComplete/);
    bad((p) => { p.fieldErrors = []; }, /object map/); bad((p) => { p.fieldErrors['dwelling.bogus'] = { raw: 'x', code: 'NOT_FINITE' }; }, /not a canonical V2 scalar path/);
    bad((p) => { p.fieldErrors['dwelling.floorAreaFt2'] = { raw: 'x', code: 'NOPE' }; }, /unknown code/); bad((p) => { p.fieldErrors['dwelling.floorAreaFt2'] = { raw: 'x', code: 'NOT_FINITE', badInput: 'yes' }; }, /badInput/);
    bad((p) => { p.fieldErrors['dwelling.floorAreaFt2'] = { raw: 'x', code: 'NOT_FINITE', extra: 1 }; }, /unexpected key/);
    bad((p) => { p.loadErrors.L99 = { quantity: { raw: 'x', code: 'NOT_FINITE' } }; }, /not a load of this snapshot/);
    bad((p) => { p.loadErrors.L1 = { label: { raw: 'x', code: 'NOT_FINITE' } }; }, /not a canonical load field/);
    bad((p) => { p.snapshot.loads[1].id = 'L1'; }, /repeated/);
    bad((p) => { p.snapshot.loads[0].rating.value = NaN; }, /not JSON/);
    bad((p) => { p.snapshot.loads[0].extra = 1; }, /unexpected property/);
    assert.deepStrictEqual(SS.validatePayloadV3(null), ['payload is not an object']); assert.strictEqual(SS.restorePayloadV3('x').ok, false);
  });
  test("special ids '__proto__' / 'constructor' in loadErrors are ordinary own keys and round-trip", () => {
    const d = draftFromRequest(B0P, null); d.snapshot.loads[0].id = '__proto__'; d.snapshot.loads[1].id = 'constructor'; d.snapshot.optional82.inventoryComplete = ST._internal.unconfirmedInventory();
    const m = dict(); put(m, 'quantity', { raw: 'q', code: 'NOT_INTEGER' }); put(d.loadErrors, '__proto__', m); const m2 = dict(); put(m2, 'rating.value', { raw: 'r', code: 'NOT_FINITE' }); put(d.loadErrors, 'constructor', m2);
    const p = unwrap(SS.toPayloadV3(d), 'payload').payload; const text = JSON.stringify(p); const back = unwrap(SS.restorePayloadV3(JSON.parse(text)), 'restore').draft;
    assert.ok(Object.prototype.hasOwnProperty.call(back.loadErrors, '__proto__') && Object.prototype.hasOwnProperty.call(back.loadErrors, 'constructor'));
    assert.strictEqual(Object.getPrototypeOf(back.loadErrors), null); assert.strictEqual(frozen(back), frozen(d));
  });
});

describe('classifyStoredRecord and the frozen A/lcv-2 descriptor (I1)', () => {
  test('classification uses the OWN lcv key only', () => {
    assert.strictEqual(SS.classifyStoredRecord({ method: 'opt', voltage: '240' }), 'legacy');
    assert.strictEqual(SS.classifyStoredRecord({ lcv: 2 }), 'lcv2'); assert.strictEqual(SS.classifyStoredRecord({ lcv: 3 }), 'lcv3');
    assert.strictEqual(SS.classifyStoredRecord({ lcv: 1 }), 'unknown'); assert.strictEqual(SS.classifyStoredRecord({ lcv: '2' }), 'unknown'); assert.strictEqual(SS.classifyStoredRecord({ lcv: 4 }), 'unknown');
    assert.strictEqual(SS.classifyStoredRecord(null), 'unknown'); assert.strictEqual(SS.classifyStoredRecord([]), 'unknown');
    const inherited = Object.create({ lcv: 2 }); inherited.method = 'x'; assert.strictEqual(SS.classifyStoredRecord(inherited), 'unknown', 'a non-plain object is not classified from an inherited key');
  });
  test('FROZEN_A_LCV2 equals the supplied evidence (34 unique paths incl. both literal loads[] keys, 2 subfields, A profile) and is immutable', () => {
    assert.strictEqual(SS.FROZEN_A_LCV2.fieldPaths.length, 34); assert.strictEqual(new Set(SS.FROZEN_A_LCV2.fieldPaths).size, 34);
    assert.ok(SS.FROZEN_A_LCV2.fieldPaths.includes('loads[].rating.value') && SS.FROZEN_A_LCV2.fieldPaths.includes('loads[].quantity'));
    assert.deepStrictEqual(SS.FROZEN_A_LCV2.loadSubfields, ['rating.value', 'quantity']); assert.strictEqual(SS.FROZEN_A_LCV2.profileId, 'A_measured_87_core');
    assert.ok(Object.isFrozen(SS.FROZEN_A_LCV2) && Object.isFrozen(SS.FROZEN_A_LCV2.fieldPaths));
    const ref = path.join(ROOT, '..', 'proof', 'frozen-A-lcv2-descriptor.json');
    if (fs.existsSync(ref)) { const j = JSON.parse(fs.readFileSync(ref, 'utf8')); assert.deepStrictEqual(new Set(j.fieldPaths), new Set(SS.FROZEN_A_LCV2.fieldPaths)); assert.deepStrictEqual(j.loadSubfields, SS.FROZEN_A_LCV2.loadSubfields); }
  });
  test('opts.legacyContract is a checked assertion: exact set (order irrelevant) passes; extra/missing/duplicate/non-string/profile mismatch refuse before any import', () => {
    const src = lcv2FromEnvelope(TS15); const before = frozen(src);
    const reordered = DESCRIPTOR(); reordered.fieldPaths.reverse(); reordered.loadSubfields.reverse();
    assert.strictEqual(SS.upgradeToDraftV2(src, opts({ legacyContract: reordered, basisIdByLoadId: alloc(src.snapshot) })).ok, true);
    const cases = [
      [(c) => c.fieldPaths.push('optional82.inventoryComplete'), /extra member/], [(c) => c.fieldPaths.pop(), /missing member/], [(c) => c.fieldPaths.push(c.fieldPaths[0]), /duplicate member/],
      [(c) => c.fieldPaths.push(5), /non-string/], [(c) => c.loadSubfields.push('separatelyControlledUnits'), /extra member/], [(c) => c.loadSubfields.pop(), /missing member/],
      [(c) => { c.profileId = 'AB82_core1'; }, /profileId/], [(c) => { c.extra = 1; }, /unexpected key/],
    ];
    for (const [mut, re] of cases) { const c = DESCRIPTOR(); mut(c); const r = SS.upgradeToDraftV2(src, opts({ legacyContract: c, basisIdByLoadId: alloc(src.snapshot) })); assert.strictEqual(r.ok, false); assert.ok(r.problems.some((m) => re.test(m)), JSON.stringify(r.problems)); }
    assert.strictEqual(SS.upgradeToDraftV2(src, opts({ legacyContract: null })).ok, false); assert.strictEqual(frozen(src), before);
  });
});

describe('upgradeToDraftV2 — old validity, then lossless representability, then candidate (I2/I3)', () => {
  test('a valid, representable lcv-2 becomes a V2 candidate: lifted snapshot, unconfirmed facts, fresh basisIds, sourceFavId copied, import provenance, method NOT confirmed; source untouched', () => {
    const src = lcv2FromEnvelope(TS15, { sourceFavId: 'fav-9' }); const before = frozen(src); const map = alloc(src.snapshot);
    const r = unwrap(SS.upgradeToDraftV2(src, opts({ expectKind: 'lcv2', basisIdByLoadId: map, sourceFavId: 'ignored-for-lcv2' })), 'upgrade');
    assert.strictEqual(frozen(src), before);
    assert.strictEqual(r.draft.snapshot.schemaVersion, '3.3.0'); assert.deepStrictEqual(r.draft.context, { importedFrom: { lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' }, methodConfirmedAfterImport: false });
    assert.strictEqual(r.draft.sourceFavId, 'fav-9'); assert.deepStrictEqual(r.draft.snapshot.optional82.inventoryComplete, { value: null, provenance: { source: 'designer_declaration', note: null }, basis: null });
    r.draft.snapshot.loads.forEach((l) => { assert.strictEqual(l.basisId, map[l.id]); assert.strictEqual(l.inclusion82, null); assert.strictEqual(l.ratingCoverage82, null); });
    const lifted = clone(r.draft.snapshot); lifted.schemaVersion = '3.2.1'; delete lifted.optional82; lifted.loads = lifted.loads.map((l) => { delete l.basisId; delete l.inclusion82; delete l.ratingCoverage82; return l; });
    assert.deepStrictEqual(lifted, src.snapshot, 'every A datum carried over unchanged');
    assert.deepStrictEqual(SS.validatePayloadV3(unwrap(SS.toPayloadV3(r.draft), 'p').payload), []);
    assert.strictEqual(JSON.stringify(F.evaluateV2(unwrap(ST.toRequestV2(r.draft), 'q').request).result), JSON.stringify(require('../src/calc/loadCalc.js').evaluate(TS15)), 'delegated A result equals the direct A result of the old envelope');
  });
  test("old-valid fieldErrors['loads[].quantity'] / ['loads[].rating.value'] are refused as an unrepresentable conversion, not mislabelled invalid; per-id loadErrors are the positive control", () => {
    for (const key of ['loads[].quantity', 'loads[].rating.value']) {
      const src = lcv2FromEnvelope(TS15, { fieldErrors: { [key]: { raw: 'x', code: 'NOT_INTEGER' } } }); const before = frozen(src);
      assert.deepStrictEqual(SS.validateLcv2(src), [], 'the old record is VALID under the frozen lcv-2 boundary');
      const r = SS.upgradeToDraftV2(src, opts({ basisIdByLoadId: alloc(src.snapshot) }));
      assert.strictEqual(r.ok, false); assert.ok(!('draft' in r)); assert.strictEqual(r.problems.length, 1); assert.ok(r.problems[0].includes(`fieldErrors["${key}"]`) && /no load id\/index/.test(r.problems[0]) && /conversion refused/.test(r.problems[0]), r.problems[0]);
      assert.strictEqual(frozen(src), before);
    }
    const id = TS15.snapshot.loads[0].id;
    const pos = lcv2FromEnvelope(TS15, { loadErrors: { [id]: { quantity: { raw: '1.5', code: 'NOT_INTEGER', badInput: true } } } });
    const r = unwrap(SS.upgradeToDraftV2(pos, opts({ basisIdByLoadId: alloc(pos.snapshot) })), 'positive');
    assert.deepStrictEqual(r.draft.loadErrors[id].quantity, { raw: '1.5', code: 'NOT_INTEGER', badInput: true });
    const req = unwrap(ST.toRequestV2(r.draft), 'req').request; const i = r.draft.snapshot.loads.findIndex((l) => l.id === id);
    assert.deepStrictEqual(req.parseErrors, [{ field: `loads[${i}].quantity`, raw: '1.5', code: 'NOT_INTEGER' }], 'canonical index derived at projection time');
  });
  test('old-INVALID lcv-2 (unknown path, unknown subfield, unknown load id, bad snapshot, wrong profile, extra key) is refused under the frozen boundary; expectKind never selects a weaker validator', () => {
    const bad = (extra, re) => { const src = lcv2FromEnvelope(TS15, extra); const before = frozen(src); const r = SS.upgradeToDraftV2(src, opts({ basisIdByLoadId: alloc(src.snapshot) })); assert.strictEqual(r.ok, false); assert.ok(r.problems.some((m) => re.test(m)), JSON.stringify(r.problems)); assert.strictEqual(frozen(src), before); };
    bad({ fieldErrors: { 'optional82.inventoryComplete': { raw: 'x', code: 'UNKNOWN_ENUM' } } }, /unknown field path/);
    bad({ loadErrors: { [TS15.snapshot.loads[0].id]: { inclusion82: { raw: 'x', code: 'UNKNOWN_ENUM' } } } }, /unknown field "inclusion82"/);
    bad({ loadErrors: { ghost: { quantity: { raw: 'x', code: 'NOT_INTEGER' } } } }, /not a load in the saved snapshot/);
    bad({ profileId: 'AB82_core1' }, /profile AB82_core1 is not/); bad({ cached: {} }, /unexpected payload key/);
    const s2 = lcv2FromEnvelope(TS15); s2.snapshot.schemaVersion = '3.3.0'; bad(Object.assign({}, { snapshot: s2.snapshot }), /schemaVersion/);
    const legacy = { method: 'opt', voltage: '240', scope: 'house', sqFt: '1500', appliances: '[]', hvac: '[]', ev: '[]' };
    const r = SS.upgradeToDraftV2(legacy, opts({ expectKind: 'lcv2' })); assert.strictEqual(r.ok, false); assert.ok(r.problems[0].includes('expectKind lcv2 but the record is legacy'));
    const r3 = SS.upgradeToDraftV2(unwrap(SS.toPayloadV3(draftFromRequest(B0P)), 'p').payload, opts()); assert.strictEqual(r3.ok, false); assert.ok(/already lcv-3/.test(r3.problems[0]));
    const unknown = SS.upgradeToDraftV2({ lcv: 1, snapshot: {} }, opts()); assert.strictEqual(unknown.ok, false); assert.ok(/unsupported stored version 1/.test(unknown.problems[0]));
    assert.strictEqual(SS.upgradeToDraftV2(lcv2FromEnvelope(TS15), opts({ expectKind: 'lcv4' })).ok, false);
  });
  test('basisIdByLoadId policy: missing, extra, duplicate, empty or non-string entries refuse; the allocation is caller-supplied (no clock/random)', () => {
    const src = lcv2FromEnvelope(TS16); const ids = src.snapshot.loads.map((l) => l.id); assert.ok(ids.length >= 2);
    const cases = [[{}, /missing basis id/], [Object.assign(alloc(src.snapshot), { ghost: 'bs-g' }), /extra entry/], [Object.fromEntries(ids.map((id) => [id, 'same'])), /duplicate basis id/], [Object.fromEntries(ids.map((id) => [id, ''])), /non-empty string/], [Object.fromEntries(ids.map((id) => [id, 7])), /non-empty string/], [null, /object map/]];
    for (const [m, re] of cases) { const r = SS.upgradeToDraftV2(src, opts({ basisIdByLoadId: m })); assert.strictEqual(r.ok, false); assert.ok(r.problems.some((x) => re.test(x)), JSON.stringify(r.problems)); }
    const a = unwrap(SS.upgradeToDraftV2(src, opts({ basisIdByLoadId: alloc(src.snapshot) })), 'a'); const b = unwrap(SS.upgradeToDraftV2(src, opts({ basisIdByLoadId: alloc(src.snapshot) })), 'b'); assert.strictEqual(frozen(a), frozen(b), 'deterministic');
  });
  test('unversioned legacy: migrated via the accepted migrator, unresolvedItems retained, explicit outer Favorite id, descriptive legacy provenance, method not confirmed even when the record selects opt_220_82', () => {
    const legacy = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: JSON.stringify([{ id: 'a1', name: 'Range / Oven', va: 12000, category: 'appliance' }, { id: 'a2', name: 'Microwave', va: 1500, category: 'appliance' }, { id: 'a3', name: 'Laundry Circuit', va: 1500, category: 'laundry' }]), hvac: JSON.stringify([{ id: 'h1', name: 'A/C Unit', va: 5000, category: 'hvac' }]), ev: '[]' };
    const before = frozen(legacy); const migrated = AS.migrateLegacyRecord(legacy); const map = alloc(migrated.snapshot);
    const r = unwrap(SS.upgradeToDraftV2(legacy, opts({ expectKind: 'legacy', basisIdByLoadId: map, sourceFavId: 1700000000000 })), 'legacy');
    assert.strictEqual(frozen(legacy), before);
    assert.deepStrictEqual(r.draft.context, { importedFrom: { lcv: 1, profileId: 'legacy_pre_lcv_favorite', schemaVersion: 'unversioned' }, methodConfirmedAfterImport: false });
    assert.strictEqual(r.draft.sourceFavId, 1700000000000); assert.strictEqual(r.draft.snapshot.method.selected, migrated.snapshot.method.selected, 'method exactly as the accepted migrator maps it');
    assert.deepStrictEqual(r.draft.snapshot.migration, migrated.snapshot.migration, 'migration record incl. unresolvedItems retained verbatim');
    assert.ok(r.draft.snapshot.migration.unresolvedItems.length >= 1 || r.draft.snapshot.loads.some((l) => l.classification === 'required'), 'the Microwave item stays unresolved/required, not repaired');
    if (migrated.snapshot.method.selected === 'opt_220_82') { assert.ok(r.notes.some((n) => /does not confirm the method/.test(n))); const out = F.evaluateV2(unwrap(ST.toRequestV2(r.draft), 'req').request).result; assert.ok(out.problems.some((p) => p.code === 'IMPORTED_METHOD_UNCONFIRMED'), 'the accepted engine keeps the import guard'); }
    assert.strictEqual(r.draft.context.methodConfirmedAfterImport, false);
    const rejected = SS.upgradeToDraftV2({ method: 'optional', voltage: '240', appliances: '{not json' }, opts({ expectKind: 'legacy', sourceFavId: 1 })); assert.strictEqual(rejected.ok, false); assert.ok(/migration refused|legacy/.test(rejected.problems[0]));
    const unrep = SS.upgradeToDraftV2({ method: 'optional', voltage: '240', appliances: JSON.stringify([{ id: 'a1', name: 'Range / Oven', va: 12000 }]), hvac: '[]', ev: '[]' }, opts({ expectKind: 'legacy', sourceFavId: 1 })); assert.strictEqual(unrep.ok, false); assert.ok(/LEGACY_ITEM_UNREPRESENTABLE/.test(unrep.problems[0]), 'an unrepresentable legacy item is named, not repaired');
  });
  test('reselection is data, not the importer: only an explicit manual reselection transition sets methodConfirmedAfterImport true; import/recommendation/save/evaluation never do', () => {
    const src = lcv2FromEnvelope(TS15); src.snapshot.method.selected = 'opt_220_82'; src.snapshot.method.selectionSource = 'manual';
    const up = unwrap(SS.upgradeToDraftV2(src, opts({ basisIdByLoadId: alloc(src.snapshot) })), 'up').draft; assert.strictEqual(up.context.methodConfirmedAfterImport, false, 'already-selected 82 is not confirmed by import');
    const saved = unwrap(SS.toPayloadV3(up), 'save').payload; assert.strictEqual(saved.context.methodConfirmedAfterImport, false); assert.strictEqual(unwrap(SS.restorePayloadV3(saved), 'r').draft.context.methodConfirmedAfterImport, false);
    const guide = clone(up); guide.snapshot.method.selectionSource = 'guide'; guide.snapshot.method.guideRecommendation = 'opt_220_82'; assert.strictEqual(guide.context.methodConfirmedAfterImport, false, 'a recommendation is data on the snapshot, not a confirmation');
    // documented explicit manual reselection transition (future UI action), supplied here as data
    const reselected = clone(up); reselected.snapshot.method.selected = 'opt_220_82'; reselected.snapshot.method.selectionSource = 'manual'; reselected.context.methodConfirmedAfterImport = true;
    const p2 = unwrap(SS.toPayloadV3(reselected), 'p2').payload; assert.strictEqual(unwrap(SS.restorePayloadV3(p2), 'r2').draft.context.methodConfirmedAfterImport, true, 'lcv-3 preserves the flag verbatim');
    const out = F.evaluateV2(unwrap(ST.toRequestV2(reselected), 'q').request).result; assert.ok(!out.problems.some((p) => p.code === 'IMPORTED_METHOD_UNCONFIRMED')); assert.ok(out.problems.some((p) => p.code === 'MISSING_FIELD' && p.field === 'optional82.inventoryComplete'), 'reselection confirms nothing about premises');
  });
});

describe('R1 corrections — storage side of V1–V3', () => {
  const base = () => draftFromRequest(B0P, null);
  const refuses = (r, re, what) => { assert.strictEqual(r.ok, false, what); assert.ok(!('draft' in r) && !('payload' in r), what + ': no candidate'); if (re) assert.ok(r.problems.some((m) => re.test(m)), what + ': ' + JSON.stringify(r.problems)); };

  test('V1: serialization refuses what direct validation refuses — the three boundaries agree, and no payload ever contains a cleaned submap', () => {
    for (const badSub of [null, 7, [], false]) {
      const d = base(); d.loadErrors.L3 = badSub;
      const ser = SS.toPayloadV3(d); refuses(ser, /loadErrors\[L3\]|not JSON/, 'serializer ' + typeof badSub);
      const req = ST.toRequestV2(d); refuses(req, /loadErrors\[L3\]|not JSON/, 'projection ' + typeof badSub);
      const handMade = { lcv: 3, capabilityProfile: 'AB82_core1', context: clone(d.context), snapshot: clone(d.snapshot), fieldErrors: {}, loadErrors: { L3: badSub }, sourceFavId: null };
      assert.ok(SS.validatePayloadV3(handMade).length, 'direct validation ' + typeof badSub);
      assert.strictEqual(SS.restorePayloadV3(handMade).ok, false);
    }
  });
  test('V1: an upgraded candidate is never produced from a malformed source snapshot; the old-boundary order is unchanged', () => {
    const lc = DESCRIPTOR();
    for (const mut of [(v) => { v.snapshot = null; }, (v) => { v.snapshot = {}; }, (v) => { v.snapshot.loads = null; }, (v) => { v.snapshot.loads = [null]; }]) {
      const src = lcv2FromEnvelope(TS15); mut(src); const before = frozen(src);
      let r; assert.doesNotThrow(() => { r = SS.upgradeToDraftV2(src, opts({ legacyContract: lc, basisIdByLoadId: {} })); }); refuses(r, null, 'upgrade with malformed snapshot');
      assert.strictEqual(frozen(src), before);
    }
  });
  test('V2: every malformed-parent payload class gives a nonempty string[] and {ok:false}, with no throw and no mutation', () => {
    const good = unwrap(SS.toPayloadV3(base()), 'good').payload;
    const classes = [['snapshot null', (p) => { p.snapshot = null; }], ['snapshot {}', (p) => { p.snapshot = {}; }], ['loads null', (p) => { p.snapshot.loads = null; }], ['loads {}', (p) => { p.snapshot.loads = {}; }], ['loads [null]', (p) => { p.snapshot.loads = [null]; }], ['loads [7]', (p) => { p.snapshot.loads = [7]; }], ['context null', (p) => { p.context = null; }], ['context array', (p) => { p.context = []; }], ['optional82 missing', (p) => { delete p.snapshot.optional82; }], ['loadErrors null', (p) => { p.loadErrors = null; }], ['fieldErrors array', (p) => { p.fieldErrors = []; }]];
    for (const [what, mut] of classes) {
      const p = clone(good); mut(p); const before = frozen(p);
      let v; assert.doesNotThrow(() => { v = SS.validatePayloadV3(p); }, what + ': validate must not throw');
      assert.ok(Array.isArray(v) && v.length && v.every((m) => typeof m === 'string'), what + ': nonempty string[]');
      let r; assert.doesNotThrow(() => { r = SS.restorePayloadV3(p); }, what + ': restore must not throw'); refuses(r, null, what);
      assert.strictEqual(frozen(p), before, what + ': payload unchanged');
    }
    const cyc = clone(good); cyc.snapshot.self = cyc.snapshot;
    let v2; assert.doesNotThrow(() => { v2 = SS.validatePayloadV3(cyc); }); assert.ok(v2.some((m) => /reference cycle|not JSON/.test(m)));
    let r2; assert.doesNotThrow(() => { r2 = SS.restorePayloadV3(cyc); }); refuses(r2, /reference cycle|not JSON/, 'cyclic payload');
  });
  test('V3: the storage list is owned — widening the exported R3 Sets after load changes nothing here (restored in finally)', () => {
    const good = unwrap(SS.toPayloadV3(base()), 'good').payload;
    const p = clone(good); p.fieldErrors['dwelling.untrusted'] = { raw: 'x', code: 'NOT_FINITE' };
    assert.ok(SS.validatePayloadV3(p).some((m) => /not a canonical V2 scalar path/.test(m)), 'before');
    try {
      V2.SCALAR_PATHS.add('dwelling.untrusted');
      assert.ok(SS.validatePayloadV3(p).some((m) => /not a canonical V2 scalar path/.test(m)), 'validator stays narrow');
      assert.strictEqual(SS.restorePayloadV3(p).ok, false, 'restore stays narrow');
      const d = base(); d.fieldErrors['dwelling.untrusted'] = { raw: 'x', code: 'NOT_FINITE' }; assert.strictEqual(SS.toPayloadV3(d).ok, false, 'serializer stays narrow');
    } finally { V2.SCALAR_PATHS.delete('dwelling.untrusted'); }
    assert.deepStrictEqual(SS.validatePayloadV3(good), [], 'the ordinary payload is still valid afterwards');
  });
  test('accepted I1–I3 outcomes and lossless round trips are unchanged by the corrections', () => {
    const d = draftFromRequest(B0P, 'old-17'); const p = unwrap(SS.toPayloadV3(d), 'p').payload; assert.strictEqual(frozen(unwrap(SS.restorePayloadV3(p), 'r').draft), frozen(d));
    const lc = DESCRIPTOR(); const src = lcv2FromEnvelope(TS15, { sourceFavId: 'fav-9' });
    const up = unwrap(SS.upgradeToDraftV2(src, opts({ legacyContract: lc, basisIdByLoadId: alloc(src.snapshot) })), 'up');
    assert.strictEqual(up.draft.sourceFavId, 'fav-9'); assert.strictEqual(up.draft.context.methodConfirmedAfterImport, false); assert.deepStrictEqual(up.draft.context.importedFrom, { lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' });
    const nonConvertible = lcv2FromEnvelope(TS15, { fieldErrors: { 'loads[].quantity': { raw: 'x', code: 'NOT_INTEGER' } } });
    assert.deepStrictEqual(SS.validateLcv2(nonConvertible), [], 'still old-valid');
    const r = SS.upgradeToDraftV2(nonConvertible, opts({ legacyContract: lc, basisIdByLoadId: alloc(nonConvertible.snapshot) }));
    refuses(r, /no load id\/index/, 'still refused as unrepresentable, not as invalid');
    const widened = DESCRIPTOR(); widened.fieldPaths.push('optional82.inventoryComplete');
    refuses(SS.upgradeToDraftV2(src, opts({ legacyContract: widened, basisIdByLoadId: alloc(src.snapshot) })), /extra member/, 'I1 assertion unchanged');
  });
});
