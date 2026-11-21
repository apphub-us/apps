'use strict';
/**
 * Load Calc pure state helpers — EC-CALC-2 / B1. Empty-state factory (P-5),
 * structured legacy migration (§11, save-as-copy is B2), canonical covered-set
 * projection and staleness (§6.2.1), occupancy transition (§9.6).
 * A plain JSON round trip here is a serialization check only; the persisted
 * Favorites save/reload/restore/save-as-copy sequences (T-S-12, T-S-39) remain B2.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const S = require('../src/calc/loadCalcState');
const { evaluate } = require('../src/calc/loadCalc');
const H = require('./helpers/loadCalcFixtures');

describe('P-5 — empty snapshot factory', () => {
  test('T-S-08: createEmptySnapshot() equals the Init/Reset specification snapshot (no default topology, no seeded loads)', () => {
    const c = H.caseById('T-S-08');
    assert.deepStrictEqual(S.createEmptySnapshot(), c.envelope.snapshot);
    assert.strictEqual(S.createEmptySnapshot().supply.topology, null); assert.deepStrictEqual(S.createEmptySnapshot().loads, []); assert.strictEqual(S.createEmptySnapshot().migration, null);
  });
  test('Init == Reset: two calls are deep-equal but not the same object; evaluate(empty) is EMPTY with every layer cleared', () => {
    const a = S.createEmptySnapshot(); const b = S.createEmptySnapshot();
    assert.deepStrictEqual(a, b); assert.notStrictEqual(a, b); assert.notStrictEqual(a.supply, b.supply);
    const r = evaluate({ snapshot: a, parseErrors: [], profileId: 'A_measured_87_core' });
    assert.strictEqual(r.status, 'EMPTY'); assert.deepStrictEqual(r.problems, []); assert.deepStrictEqual(r.demand.lines, []); assert.deepStrictEqual(r.references, []);
    assert.deepStrictEqual(r, H.caseById('T-S-08').expected);
  });
});

describe('§11 — structured legacy migration (pure transform; persistence is B2)', () => {
  const fixtures = H.loadCases().cases.filter((c) => c.legacyRecord && c.migratedSnapshot);
  test('there are 15 migration fixtures', () => assert.strictEqual(fixtures.length, 15));
  for (const c of fixtures) {
    test(`${c.id} — migrateLegacyRecord equals the literal migrated snapshot; original record unchanged`, () => {
      const rec = H.deepFreeze(H.clone(c.legacyRecord)); const before = JSON.stringify(rec);
      const { snapshot, problems } = S.migrateLegacyRecord(rec);
      assert.deepStrictEqual(snapshot, c.migratedSnapshot);
      assert.strictEqual(JSON.stringify(rec), before);
      // the migration-sourced problems of the expected result are exactly the ones the transform reports (and the engine re-derives them from the record)
      const expectedMig = c.expected.problems.filter((p) => p.source === 'migration');
      assert.deepStrictEqual(problems.slice().sort((a, b) => (a.code + a.field).localeCompare(b.code + b.field)), expectedMig.slice().sort((a, b) => (a.code + a.field).localeCompare(b.code + b.field)));
      const r = evaluate({ snapshot, parseErrors: [], profileId: 'A_measured_87_core' });
      assert.deepStrictEqual(r.problems.filter((p) => p.source === 'migration'), expectedMig);
    });
  }
  test('structured unresolved items and the verbatim source record survive a plain JSON round trip (T-S-22b)', () => {
    const c = H.caseById('T-S-22b'); const { snapshot } = S.migrateLegacyRecord(c.legacyRecord);
    const back = JSON.parse(JSON.stringify(snapshot));
    assert.deepStrictEqual(back, snapshot);
    assert.strictEqual(back.migration.unresolvedItems[0].legacy.va, 2000); assert.strictEqual(back.migration.unresolvedItems[0].legacy.id, 'r3');
    assert.strictEqual(back.migration.sourceRecord.appliances, c.legacyRecord.appliances); assert.strictEqual(back.dwelling.laundryCircuits, null);
  });
  test('T-S-39 record (rec04c) migrates deterministically: 4 transforms, 0 unresolved, laundryCircuits 1; the save-as-copy sequence itself is B2', () => {
    const c = H.caseById('T-S-39'); const a = S.migrateLegacyRecord(c.legacyRecord); const b = S.migrateLegacyRecord(c.legacyRecord);
    assert.deepStrictEqual(a, b); assert.strictEqual(a.snapshot.migration.transforms.length, 4); assert.strictEqual(a.snapshot.migration.unresolvedItems.length, 0);
    assert.strictEqual(a.snapshot.dwelling.laundryCircuits, 1); assert.strictEqual(a.snapshot.migration.savePolicy, 'save_as_copy'); assert.strictEqual(a.snapshot.schemaVersion, '3.2.1');
    assert.deepStrictEqual(a.snapshot, H.caseById('T-S-04c').migratedSnapshot);
  });
  test('robust edges: non-numeric sqFt / lcMeterVA, missing lists, extra keys -> retained as data + notes (no throw); the engine re-derives NOT_FINITE from the record', () => {
    const { snapshot, problems } = S.migrateLegacyRecord({ method: 'nec87', voltage: '240', scope: 'house', sqFt: 'abc', appliances: '[]', ev: '[{"id":"e","name":"EV Charger — Level 2","va":7200,"category":"ev"}]', lcMeterVA: '4x', unknownField: 1 });
    assert.strictEqual(snapshot.dwelling.floorAreaFt2, null); assert.strictEqual(snapshot.measurement.reading.value, null);
    assert.ok(problems.some((p) => p.code === 'NOT_FINITE' && p.field === 'dwelling.floorAreaFt2')); assert.ok(problems.some((p) => p.code === 'NOT_FINITE' && p.field === 'measurement.reading.value'));
    assert.strictEqual(snapshot.loads.length, 1); assert.strictEqual(snapshot.loads[0].category, 'evse'); assert.strictEqual(snapshot.migration.sourceRecord.hvac, null);
    assert.ok(!('unknownField' in snapshot.migration.sourceRecord));
    const r = evaluate({ snapshot, parseErrors: [], profileId: 'A_measured_87_core' });
    assert.strictEqual(r.status, 'INVALID_INPUT'); assert.ok(r.problems.some((p) => p.source === 'migration' && p.code === 'NOT_FINITE' && p.field === 'dwelling.floorAreaFt2'));
    assert.throws(() => S.migrateLegacyRecord(null), TypeError);
  });
  test('B1-r1: a malformed list string is a controlled rejection (LegacyRecordError LEGACY_UNPARSEABLE_LIST), never a trusted empty list; the record is untouched', () => {
    const rec = { method: 'nec87', voltage: '240', scope: 'house', sqFt: '1500', appliances: '{not json', hvac: '[]', ev: '[]' }; const before = JSON.stringify(rec);
    assert.throws(() => S.migrateLegacyRecord(rec), (e) => e instanceof S.LegacyRecordError && e instanceof TypeError && e.code === 'LEGACY_UNPARSEABLE_LIST' && /migrateLegacyRecord/.test(e.message) && e.details.list === 'appliances');
    assert.strictEqual(JSON.stringify(rec), before);
  });
  test('no broad appliance->category guess: only exact preset names map; Reset-style "A/C" and "Heat Pump" need classification (T-S-21, T-S-04c)', () => {
    assert.deepStrictEqual(Object.keys(S.LEGACY_PRESET_CATEGORY).sort(), ['A/C Unit', 'Dishwasher', 'Dryer', 'EV Charger — Level 1', 'EV Charger — Level 2', 'Electric Heat', 'Range / Oven', 'Water Heater']);
    const { snapshot } = S.migrateLegacyRecord({ method: 'nec87', voltage: '240', scope: 'house', sqFt: '1500', appliances: '[{"id":"a","name":"range / oven","va":12000,"category":"appliance"}]', hvac: '[{"id":"h","name":"A/C","va":5000,"category":"ac"}]', ev: '[]' });
    assert.strictEqual(snapshot.loads[0].classification, 'required'); assert.strictEqual(snapshot.loads[0].category, null); assert.strictEqual(snapshot.loads[1].classification, 'required');
  });
});

describe('§6.2.1 — canonical covered-set projection and staleness', () => {
  const s14c = H.caseById('T-S-14').then[1].envelope.snapshot;
  test('projection is sorted by id in code-point order and independent of covers[] / loads[] order; label/legacy excluded', () => {
    const loads = [Object.assign(H.clone(s14c.loads[0]), { id: 'b', label: 'B' }), Object.assign(H.clone(s14c.loads[0]), { id: 'a', label: 'A', legacy: { id: 'a', name: 'x', va: 1, category: 'ev' } }), Object.assign(H.clone(s14c.loads[0]), { id: 'Z' })];
    const p1 = S.coversProjection(loads, ['b', 'a', 'Z']); const p2 = S.coversProjection(loads.slice().reverse(), ['Z', 'a', 'b']);
    assert.deepStrictEqual(p1, p2); assert.deepStrictEqual(p1.map((x) => x.id), ['Z', 'a', 'b']);
    assert.deepStrictEqual(Object.keys(p1[0]).sort(), [...S.COVERS_FIELDS].sort()); assert.ok(!('label' in p1[0])); assert.ok(!('legacy' in p1[0]));
    assert.deepStrictEqual(S.coversProjection([], []), []);
  });
  test('code-point order, not locale order ("Z" < "a"; "é" after "z"); localeCompare would differ', () => {
    assert.deepStrictEqual(['a', 'Z', 'é', 'z'].sort(S.codePointCompare), ['Z', 'a', 'z', 'é']);
    assert.notDeepStrictEqual(['a', 'Z'].sort((x, y) => x.localeCompare(y)), ['a', 'Z'].sort(S.codePointCompare));
  });
  test('duplicate ids in covers[] or loads[] and unknown covered ids make the projection undefined (null) -> DUPLICATE_ID / COVERS_UNKNOWN_LOAD in the engine (T-S-44a/b, T-S-15)', () => {
    assert.strictEqual(S.coversProjection(s14c.loads, ['ev1', 'ev1']), null);
    assert.strictEqual(S.coversProjection([s14c.loads[0], s14c.loads[0]], ['ev1']), null);
    assert.strictEqual(S.coversProjection(s14c.loads, ['ghost']), null);
    for (const id of ['T-S-44a', 'T-S-44b', 'T-S-15']) { const r = evaluate(H.caseById(id).envelope); assert.strictEqual(r.status, 'INVALID_INPUT', id); assert.deepStrictEqual(r.loadsCoverage, [], id); }
  });
  test('canonical JSON: sorted keys, no whitespace, non-ASCII kept; no NaN/Infinity ever emitted', () => {
    assert.strictEqual(S.canonicalJson({ b: [1, { z: null, a: 'é' }], a: 1.5 }), '{"a":1.5,"b":[1,{"a":"é","z":null}]}');
    assert.throws(() => S.canonicalJson({ a: NaN }), TypeError);
  });
  test('T-S-40 steps: basis-relevant edits are stale, label/legacy edits are not; T-S-40s: loads[] order does not matter', () => {
    const base = H.caseById('T-S-40');
    assert.strictEqual(S.isAggregateStale(base.envelope.snapshot.loads, base.envelope.snapshot.measurement.newLoad.precalculated), false);
    base.then.forEach((t, i) => assert.strictEqual(S.isAggregateStale(t.envelope.snapshot.loads, t.envelope.snapshot.measurement.newLoad.precalculated), i < 6, t.step));
    const s40s = H.caseById('T-S-40s');
    assert.strictEqual(S.isAggregateStale(s40s.envelope.snapshot.loads, s40s.envelope.snapshot.measurement.newLoad.precalculated), false);
    assert.strictEqual(S.isAggregateStale(s40s.then[0].envelope.snapshot.loads, s40s.then[0].envelope.snapshot.measurement.newLoad.precalculated), false);
    assert.strictEqual(S.isAggregateStale(s14c.loads, Object.assign(H.clone(s14c.measurement.newLoad.precalculated), { coversSnapshot: null })), true, 'missing snapshot is stale');
    assert.strictEqual(S.isAggregateStale(s14c.loads, Object.assign(H.clone(s14c.measurement.newLoad.precalculated), { covers: ['ev1', 'ev1'] })), null, 'undefined projection');
  });
  test('captureCoversSnapshot is the adapter-time writer: capturing on the stale T-S-14/then[2] snapshot makes it fresh; evaluate never refreshes it (T-S-40r)', () => {
    const stale = H.caseById('T-S-14').then[2].envelope;
    assert.strictEqual(evaluate(stale).status, 'PARTIAL'); assert.strictEqual(evaluate(stale).status, 'PARTIAL', 'repeated evaluation stays stale');
    const captured = S.captureCoversSnapshot(stale.snapshot);
    assert.notDeepStrictEqual(captured.measurement.newLoad.precalculated.coversSnapshot, stale.snapshot.measurement.newLoad.precalculated.coversSnapshot);
    assert.strictEqual(captured.measurement.newLoad.precalculated.coversSnapshot[0].rating.value, 9600);
    const r = evaluate({ snapshot: captured, parseErrors: [], profileId: 'A_measured_87_core' });
    assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.totalVA, 57200, 'the re-entered term value is still the user\'s 7,200 VA; the tool never recomputes it');
    assert.deepStrictEqual(stale.snapshot.measurement.newLoad.precalculated.coversSnapshot[0].rating.value, 7200, 'input not mutated');
    const r40r = evaluate(H.caseById('T-S-40r').envelope); assert.strictEqual(r40r.status, 'PARTIAL'); assert.ok(r40r.problems.some((p) => p.code === 'AGGREGATE_STALE'));
    const none = H.caseById('T-N-01b').envelope.snapshot; assert.deepStrictEqual(S.captureCoversSnapshot(none), none, 'no term: unchanged copy');
  });
});

describe('§9.6 — occupancy transition (pure state helper; the real form action is B2)', () => {
  test('T-S-06 and T-S-16: house -> apartment keeps loads and every other field (equals the specified after-action snapshots)', () => {
    for (const id of ['T-S-06', 'T-S-16']) {
      const c = H.caseById(id); const frozen = H.deepFreeze(H.clone(c.envelope.snapshot));
      assert.deepStrictEqual(S.setOccupancy(frozen, 'dwelling_unit_apartment'), c.snapshotAfterAction, id);
      assert.deepStrictEqual(frozen, c.envelope.snapshot, id + ' input untouched');
    }
  });
  test('T-S-01 / T-S-01b: clearing occupancy clears the guide recommendation and a guide-selected method; a manual selection stays', () => {
    const base = H.clone(H.caseById('T-N-01b').envelope.snapshot);
    base.method = { selected: 'measured_220_87', guideRecommendation: 'measured_220_87', selectionSource: 'guide', guideAnswers: { houseState: 'meter' } };
    const a = S.setOccupancy(base, null);
    assert.deepStrictEqual(a.method, { selected: null, guideRecommendation: null, selectionSource: null, guideAnswers: { houseState: 'meter' } }, 'answers persist, never re-resolved');
    base.method = { selected: 'measured_220_87', guideRecommendation: 'opt_220_82', selectionSource: 'manual', guideAnswers: {} };
    const b = S.setOccupancy(base, null); assert.strictEqual(b.method.selected, 'measured_220_87'); assert.strictEqual(b.method.guideRecommendation, null);
    assert.strictEqual(evaluate({ snapshot: b, parseErrors: [], profileId: 'A_measured_87_core' }).status, 'INCOMPLETE_INPUT');
  });
});

describe('plain JSON round trips of specification snapshots (serialization only; persistence is B2)', () => {
  test('T-S-02 / T-S-03 / T-S-17 / T-S-40r: the input snapshot survives JSON.stringify/parse unchanged and evaluates to the same result', () => {
    for (const id of ['T-S-02', 'T-S-03', 'T-S-17', 'T-S-40r']) {
      const c = H.caseById(id); const back = JSON.parse(JSON.stringify(c.envelope.snapshot));
      assert.deepStrictEqual(back, c.envelope.snapshot, id); assert.strictEqual(c.expectedSnapshotAfterAction, 'input');
      assert.deepStrictEqual(evaluate({ snapshot: back, parseErrors: [], profileId: 'A_measured_87_core' }), c.expected, id);
    }
  });
});
