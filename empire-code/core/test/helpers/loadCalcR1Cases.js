'use strict';
/**
 * EC-CALC-2 / B1-r1 regression cases for the four review findings
 * (R-B1-01 absent qualification properties, R-B1-02 per-conductor completeness,
 * R-B1-03 safe integers + strict JSON object ingress, R-B1-04 migration
 * finalization / controlled rejection). Each case receives the modules under
 * test (`{ engine, input, state }`) so the mutation harness can run the same
 * assertions against disposable mutants. Seeds are unchanged r22 envelopes;
 * expectations are explicit literals derived from contract v3.2.2 §7.2/§7.4/§11
 * and the B1-r1 instructions — no historical fixture is edited.
 * Every "B1 before" note records the actual behaviour reproduced on the
 * delivered B1 (logs/review-regressions-before.log, logs/probe-b1-before.log).
 */
const assert = require('node:assert');
const H = require('./loadCalcFixtures');
const X = require('./loadCalcExtraCases');

const codes = (r) => r.problems.map((p) => `${p.code}:${p.field}:${p.layer}`);
const ENV = (snapshot) => ({ profileId: 'A_measured_87_core', snapshot, parseErrors: [] });
const clone = H.clone;
function seed(id) { return clone(H.caseById(id).envelope); }
function annual() { const e = seed('T-N-01'); e.snapshot.measurement.existing.serviceRatingA = 225; return e; }
function thirty() { const e = seed('T-N-02b'); e.snapshot.measurement.recordedWhileOccupied.value = true; return e; }
/** split-phase declared legs, per-conductor L1 140 / L2 20, L-N 3,600 VA on L2, 150 A (reviewer minimal pair) */
function perSplit() { const e = seed('T-N-16'); const m = e.snapshot.measurement; m.readingsPerConductor.L1 = 140; m.reading.value = null; m.newLoad.precalculated.leg = 'L2'; return e; }
const unknownAt = (r, field) => { assert.strictEqual(r.status, 'INCOMPLETE_INPUT', field); assert.strictEqual(r.demand.status, 'not_computed', field); assert.deepStrictEqual(r.demand.lines, [], field); assert.strictEqual(r.existingCapacity.status, 'not_assessed', field); assert.ok(r.problems.some((p) => p.field === field && (p.code === 'MISSING_FIELD' || p.code === 'QUALIFICATION_UNKNOWN')), `expected an unknown/missing problem at ${field}, got ${codes(r)}`); };
const noDefaultNumbers = (r) => { const s = JSON.stringify(r); for (const bad of ['"periodMonths"', '"periodDays"', '"intervalMinutes"']) assert.ok(!s.includes(bad)); assert.deepStrictEqual(r.demand.lines, []); };

const CASES = [
  // ── R-B1-01 ────────────────────────────────────────────────────────────
  { id: 'R1-01-A', finding: 'R-B1-01', title: 'CONTROL annual (T-N-01, 225 A): 50,000 VA, 208.33.. A, adequate', check: ({ engine }) => {
    const r = engine.evaluate(annual()); assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.totalVA, 50000); assert.strictEqual(r.existingCapacity.status, 'adequate'); assert.deepStrictEqual(r.problems, []);
  } },
  { id: 'R1-01-B', finding: 'R-B1-01', title: 'annual periodMonths absent == null: QUALIFICATION_UNKNOWN, INCOMPLETE, no lines (B1 before: absent -> COMPLETE/adequate)', check: ({ engine }) => {
    const nul = annual(); nul.snapshot.measurement.periodMonths = null; const abs = annual(); delete abs.snapshot.measurement.periodMonths;
    const rn = engine.evaluate(nul); const ra = engine.evaluate(abs);
    unknownAt(rn, 'measurement.periodMonths'); assert.deepStrictEqual(ra, rn, 'absent and null must give the identical result'); noDefaultNumbers(ra);
    assert.deepStrictEqual(codes(ra), ['QUALIFICATION_UNKNOWN:measurement.periodMonths:input']); assert.strictEqual(ra.problems[0].ruleRef, '220.87(1)');
  } },
  { id: 'R1-01-C', finding: 'R-B1-01', title: 'annual periodMonths boundary: 11 -> QUALIFICATION_FAILED, 12 -> qualified, 0 -> failed, undefined value -> unknown', check: ({ engine }) => {
    for (const [v, status] of [[11, 'UNQUALIFIED_METHOD'], [12, 'COMPLETE'], [0, 'UNQUALIFIED_METHOD'], [24, 'COMPLETE']]) { const e = annual(); e.snapshot.measurement.periodMonths = v; assert.strictEqual(engine.evaluate(e).status, status, `periodMonths ${v}`); }
    const u = annual(); u.snapshot.measurement.periodMonths = undefined; assert.throws(() => engine.evaluate(u), (e) => e.code === 'SCHEMA_INVALID', 'an undefined value is not JSON and stops at L2');
  } },
  { id: 'R1-01-D', finding: 'R-B1-01', title: 'CONTROL 30-day (T-N-02b, occupied): COMPLETE', check: ({ engine }) => { const r = engine.evaluate(thirty()); assert.strictEqual(r.status, 'COMPLETE'); assert.deepStrictEqual(r.problems, []); } },
  { id: 'R1-01-E', finding: 'R-B1-01', title: '30-day periodDays / intervalMinutes / connectedTo absent == null: QUALIFICATION_UNKNOWN each (B1 before: absent -> COMPLETE/adequate)', check: ({ engine }) => {
    for (const f of ['periodDays', 'intervalMinutes', 'connectedTo']) {
      const nul = thirty(); nul.snapshot.measurement[f] = null; const abs = thirty(); delete abs.snapshot.measurement[f];
      const rn = engine.evaluate(nul); const ra = engine.evaluate(abs);
      unknownAt(rn, `measurement.${f}`); assert.deepStrictEqual(ra, rn, f); noDefaultNumbers(ra);
      assert.deepStrictEqual(codes(ra), [`QUALIFICATION_UNKNOWN:measurement.${f}:input`], f); assert.strictEqual(ra.problems[0].ruleRef, '220.87(1) Exception');
    }
  } },
  { id: 'R1-01-F', finding: 'R-B1-01', title: '30-day boundaries stay distinct: periodDays 29 failed / 30 ok, intervalMinutes 16 failed / 15 ok / 0 failed, connectedTo unknown -> unknown', check: ({ engine }) => {
    const run = (patch) => { const e = thirty(); Object.assign(e.snapshot.measurement, patch); return engine.evaluate(e); };
    assert.strictEqual(run({ periodDays: 29 }).status, 'UNQUALIFIED_METHOD'); assert.strictEqual(run({ periodDays: 30 }).status, 'COMPLETE');
    assert.strictEqual(run({ intervalMinutes: 16 }).status, 'UNQUALIFIED_METHOD'); assert.strictEqual(run({ intervalMinutes: 15 }).status, 'COMPLETE'); assert.strictEqual(run({ intervalMinutes: 0 }).status, 'UNQUALIFIED_METHOD');
    const r = run({ connectedTo: 'unknown' }); assert.strictEqual(r.status, 'INCOMPLETE_INPUT'); assert.deepStrictEqual(codes(r), ['QUALIFICATION_UNKNOWN:measurement.connectedTo:input']);
    assert.strictEqual(run({ connectedTo: 'highest_loaded_conductor' }).status, 'COMPLETE');
  } },
  { id: 'R1-01-G', finding: 'R-B1-01', title: 'absent declared booleans, existing block and powerFactor are unknown, never satisfied (annualDataAvailable, continuousRecording, hasPeakLoadShaving, serviceOverloadPer230_90, existing, powerFactor)', check: ({ engine }) => {
    const a = annual(); delete a.snapshot.measurement.annualDataAvailable; let r = engine.evaluate(a); unknownAt(r, 'measurement.annualDataAvailable');
    const t = thirty(); delete t.snapshot.measurement.continuousRecording; r = engine.evaluate(t); unknownAt(r, 'measurement.continuousRecording');
    const p = thirty(); delete p.snapshot.measurement.hasPeakLoadShaving; r = engine.evaluate(p); unknownAt(r, 'measurement.hasPeakLoadShaving');
    const o = annual(); delete o.snapshot.measurement.existing.serviceOverloadPer230_90; r = engine.evaluate(o); unknownAt(r, 'measurement.existing.serviceOverloadPer230_90');
    const x = annual(); delete x.snapshot.measurement.existing; r = engine.evaluate(x); assert.strictEqual(r.status, 'INCOMPLETE_INPUT'); assert.strictEqual(r.existingCapacity.status, 'not_assessed'); assert.ok(codes(r).includes('QUALIFICATION_UNKNOWN:measurement.existing.serviceOverloadPer230_90:input'));
    const k = X.env(X.snap({ measurement: X.annual(40, 'kW') })); delete k.snapshot.measurement.powerFactor; r = engine.evaluate(k); unknownAt(r, 'measurement.powerFactor');
  } },
  // ── R-B1-02 ────────────────────────────────────────────────────────────
  { id: 'R1-02-A', finding: 'R-B1-02', title: 'CONTROL complete split per-conductor: L1 175 A / L2 55 A, governing 175, inadequate, two comparisons', check: ({ engine }) => {
    const r = engine.evaluate(perSplit()); assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.totalOnConductorA, 175); assert.strictEqual(r.existingCapacity.status, 'inadequate');
    assert.deepStrictEqual(r.existingCapacity.comparisons.map((c) => [c.conductor, c.demandValueRaw, c.satisfied]), [['L1', 175, false], ['L2', 55, true]]);
    assert.deepStrictEqual(r.demand.lines.map((l) => l.id), ['e_L1', 'e_L2', 'n_L2', 't_L2', 'governing']);
  } },
  { id: 'R1-02-B', finding: 'R-B1-02', title: 'each required conductor null or absent -> MISSING_FIELD at that conductor, INCOMPLETE, no lines, no verdict; restore -> control (B1 before: L1 blank -> COMPLETE 55 A adequate)', check: ({ engine }) => {
    const control = engine.evaluate(perSplit());
    for (const k of ['L1', 'L2']) for (const how of ['null', 'absent']) {
      const e = perSplit(); if (how === 'null') e.snapshot.measurement.readingsPerConductor[k] = null; else delete e.snapshot.measurement.readingsPerConductor[k];
      const r = engine.evaluate(e);
      assert.strictEqual(r.status, 'INCOMPLETE_INPUT', `${k} ${how}`); assert.strictEqual(r.existingCapacity.status, 'not_assessed', `${k} ${how}`); assert.deepStrictEqual(r.demand.lines, [], `${k} ${how}`);
      assert.deepStrictEqual(codes(r), [`MISSING_FIELD:measurement.readingsPerConductor.${k}:input`], `${k} ${how}`);
      const back = clone(e); back.snapshot.measurement.readingsPerConductor[k] = k === 'L1' ? 140 : 20; assert.deepStrictEqual(engine.evaluate(back), control, `${k} restored`);
    }
  } },
  { id: 'R1-02-C', finding: 'R-B1-02', title: 'no new term: a missing required reading still blocks the assessment (B1 before: COMPLETE 25 A adequate from L2 alone)', check: ({ engine }) => {
    const e = perSplit(); e.snapshot.measurement.newLoad = { mode: 'none', precalculated: null }; e.snapshot.measurement.readingsPerConductor.L1 = null;
    const r = engine.evaluate(e); assert.strictEqual(r.status, 'INCOMPLETE_INPUT'); assert.strictEqual(r.existingCapacity.status, 'not_assessed'); assert.deepStrictEqual(codes(r), ['MISSING_FIELD:measurement.readingsPerConductor.L1:input']);
    e.snapshot.measurement.readingsPerConductor.L1 = 140; const ok = engine.evaluate(e); assert.strictEqual(ok.status, 'COMPLETE'); assert.strictEqual(ok.demand.totalOnConductorA, 175); assert.strictEqual(ok.existingCapacity.comparisons.length, 2);
  } },
  { id: 'R1-02-D', finding: 'R-B1-02', title: 'declared highest_loaded_conductor single reading remains a distinct valid route (T-N-17 155 A; T-N-24..26 exact)', check: ({ engine }) => {
    const r = engine.evaluate(seed('T-N-17')); assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.totalOnConductorA, 155);
    for (const id of ['T-N-24', 'T-N-25', 'T-N-26']) assert.deepStrictEqual(engine.evaluate(H.caseById(id).envelope), H.caseById(id).expected, id);
    const e = seed('T-N-17'); e.snapshot.measurement.readingsPerConductor = null; assert.deepStrictEqual(engine.evaluate(e), r, 'a null map is irrelevant on the highest-loaded route');
  } },
  { id: 'R1-02-E', finding: 'R-B1-02', title: 'three-phase per_conductor: {L1} alone -> MISSING L2 and L3; full set computes three terminals and the true maximum (B1 before: COMPLETE from L1 alone)', check: ({ engine }) => {
    const e = seed('T-N-30'); e.snapshot.measurement.readingScope = 'per_conductor'; e.snapshot.measurement.readingsPerConductor = { L1: 100, L2: null, L3: null };
    const r = engine.evaluate(e); assert.strictEqual(r.status, 'INCOMPLETE_INPUT'); assert.strictEqual(r.existingCapacity.status, 'not_assessed');
    assert.deepStrictEqual(codes(r), ['MISSING_FIELD:measurement.readingsPerConductor.L2:input', 'MISSING_FIELD:measurement.readingsPerConductor.L3:input']);
    e.snapshot.measurement.readingsPerConductor = { L1: 100, L2: 90, L3: 110 }; const f = engine.evaluate(e);
    assert.strictEqual(f.status, 'COMPLETE'); assert.deepStrictEqual(f.demand.lines.map((l) => l.id), ['e_L1', 'e_L2', 'e_L3', 'n_3PH', 't_L1', 't_L2', 't_L3', 'governing']);
    assert.strictEqual(f.demand.totalOnConductorA, 110 * 1.25 + 7200 / (Math.sqrt(3) * 208)); assert.strictEqual(f.demand.lines[7].conductor, 'L3'); assert.strictEqual(f.existingCapacity.comparisons.length, 3);
    delete e.snapshot.measurement.readingsPerConductor.L3; assert.deepStrictEqual(codes(engine.evaluate(e)), ['MISSING_FIELD:measurement.readingsPerConductor.L3:input']);
  } },
  { id: 'R1-02-F', finding: 'R-B1-02', title: 'per-topology required set: 1-ph 2-wire 120 V needs L1 only (L2 is LEG_INVALID); 2-wire 240 V needs L1 and L2; split-phase never needs a fictitious L3 (L3 value -> LEG_INVALID)', check: ({ engine }) => {
    const mk = (topology, model, per, existing) => X.env(X.snap({ supply: X.supply(topology), loadModel: { kind: model, declarations: {} }, measurement: X.thirtyDayA(80, { readingScope: 'per_conductor', readingsPerConductor: per, connectedTo: 'each_conductor', existing: existing || { serviceRatingA: 150, feederAmpacityA: null, ocpdA: null, feederOcpPer240_4: X.decl(null), serviceOverloadPer230_90: X.decl(true) } }) }));
    let r = engine.evaluate(mk('1ph_2w_120', 'single_2w', { L1: 80, L2: null, L3: null })); assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.totalOnConductorA, 100); assert.strictEqual(r.existingCapacity.comparisons.length, 1);
    r = engine.evaluate(mk('1ph_2w_120', 'single_2w', { L1: 80, L2: 80, L3: null })); assert.deepStrictEqual(codes(r), ['LEG_INVALID:measurement.readingsPerConductor.L2:input']);
    r = engine.evaluate(mk('1ph_2w_240', 'single_2w', { L1: 80, L2: null, L3: null })); assert.deepStrictEqual(codes(r), ['MISSING_FIELD:measurement.readingsPerConductor.L2:input']);
    r = engine.evaluate(mk('1ph_2w_240', 'single_2w', { L1: 80, L2: 80, L3: null })); assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.existingCapacity.comparisons.length, 2);
    r = engine.evaluate(mk('1ph_2w_240', 'single_2w', { L1: 80, L2: 80, L3: 5 })); assert.deepStrictEqual(codes(r), ['LEG_INVALID:measurement.readingsPerConductor.L3:input']);
    const split = perSplit(); split.snapshot.measurement.readingsPerConductor.L3 = 5; assert.deepStrictEqual(codes(engine.evaluate(split)), ['LEG_INVALID:measurement.readingsPerConductor.L3:input']);
    const noL3 = perSplit(); delete noL3.snapshot.measurement.readingsPerConductor.L3; assert.strictEqual(engine.evaluate(noL3).status, 'COMPLETE', 'absent L3 key is fine on split-phase');
  } },
  { id: 'R1-02-G', finding: 'R-B1-02', title: 'whole map null/absent with per_conductor scope -> MISSING_FIELD readingsPerConductor; unknown topology invents no conductor requirement', check: ({ engine }) => {
    const n = perSplit(); n.snapshot.measurement.readingsPerConductor = null; let r = engine.evaluate(n); unknownAt(r, 'measurement.readingsPerConductor'); assert.deepStrictEqual(codes(r), ['MISSING_FIELD:measurement.readingsPerConductor:input']);
    const a = perSplit(); delete a.snapshot.measurement.readingsPerConductor; assert.deepStrictEqual(engine.evaluate(a), r);
    const t = perSplit(); t.snapshot.supply = { topology: null, vLineToLine: null, vLineToNeutral: null, phases: null, wires: null }; t.snapshot.measurement.readingsPerConductor = { L1: 140, L2: null, L3: null };
    r = engine.evaluate(t); assert.strictEqual(r.status, 'INCOMPLETE_INPUT'); assert.ok(codes(r).includes('MISSING_FIELD:supply.topology:input')); assert.ok(!codes(r).some((c) => c.includes('readingsPerConductor')));
  } },
  { id: 'R1-02-H', finding: 'R-B1-02', title: 'invalid values inside a complete map keep their codes: NaN is stopped at L2, 0 and negatives are OUT_OF_RANGE', check: ({ engine }) => {
    const z = perSplit(); z.snapshot.measurement.readingsPerConductor.L2 = 0; assert.deepStrictEqual(codes(engine.evaluate(z)), ['OUT_OF_RANGE:measurement.readingsPerConductor.L2:input']);
    const n = perSplit(); n.snapshot.measurement.readingsPerConductor.L1 = -5; assert.deepStrictEqual(codes(engine.evaluate(n)), ['OUT_OF_RANGE:measurement.readingsPerConductor.L1:input']);
    const x = perSplit(); x.snapshot.measurement.readingsPerConductor.L1 = NaN; assert.throws(() => engine.evaluate(x), (e) => e.code === 'SCHEMA_INVALID');
  } },
  // ── R-B1-03 ────────────────────────────────────────────────────────────
  { id: 'R1-03-A', finding: 'R-B1-03', title: 'parseNumberField integer: 9007199254740993 / 9007199254740992 / 1e100 -> OUT_OF_RANGE with value null (B1 before: 9007199254740992 returned as valid); 2, 0, MAX_SAFE_INTEGER parse', check: ({ input }) => {
    for (const raw of ['9007199254740993', '9007199254740992', '1e100', '-9007199254740992']) { const r = input.parseNumberField(raw, { field: 'loads[0].quantity', integer: true }); assert.strictEqual(r.value, null, raw); assert.strictEqual(r.error.code, 'OUT_OF_RANGE', raw); assert.strictEqual(r.error.raw, raw); }
    for (const raw of ['2', '0', '9007199254740991', '-9007199254740991', '12', '2.0']) { const r = input.parseNumberField(raw, { field: 'q', integer: true }); assert.strictEqual(r.error, null, raw); assert.strictEqual(r.value, Number(raw), raw); }
    assert.strictEqual(input.parseNumberField('2.5', { field: 'q', integer: true }).error.code, 'NOT_INTEGER');
    const real = input.parseNumberField('9007199254740993', { field: 'measurement.reading.value' }); assert.strictEqual(real.error, null, 'a real-valued VA/A field is not restricted to safe integers');
    assert.strictEqual(input.parseNumberField('40000.5', { field: 'va' }).value, 40000.5);
  } },
  { id: 'R1-03-B', finding: 'R-B1-03', title: 'direct envelope: count fields above MAX_SAFE_INTEGER are rejected at L2 (SCHEMA_INVALID); MAX_SAFE_INTEGER itself passes; real-valued readings are unaffected (B1 before: periodMonths 2^53 -> COMPLETE)', check: ({ engine, input }) => {
    const big = annual(); big.snapshot.measurement.periodMonths = Number.MAX_SAFE_INTEGER + 1; assert.throws(() => engine.evaluate(big), (e) => e.code === 'SCHEMA_INVALID');
    const q = annual(); q.snapshot.loads = [Object.assign(X.load('a', 'evse', 7200), { quantity: 2 ** 53 })]; assert.throws(() => engine.evaluate(q), (e) => e.code === 'SCHEMA_INVALID');
    const ok = annual(); ok.snapshot.measurement.periodMonths = Number.MAX_SAFE_INTEGER; assert.strictEqual(engine.evaluate(ok).status, 'COMPLETE');
    for (const f of ['smallApplianceCircuits', 'laundryCircuits', 'nycAcCircuitCount']) { const e = annual(); e.snapshot.dwelling[f] = 2 ** 53; assert.ok(input.validateEnvelope(e).length, f); e.snapshot.dwelling[f] = 3; assert.deepStrictEqual(input.validateEnvelope(e), [], f); }
    const u = annual(); u.snapshot.multifamily.unitCount = 1e100; assert.ok(input.validateEnvelope(u).length);
    const real = annual(); real.snapshot.measurement.reading.value = 9007199254740993; assert.strictEqual(engine.evaluate(real).status, 'COMPLETE', 'real-valued reading not limited to safe integers');
  } },
  { id: 'R1-03-C', finding: 'R-B1-03', title: 'strict JSON object ingress: nested undefined / NaN / Infinity / -Infinity / function / symbol / bigint / Date / Map / class instance / array hole / cycle anywhere (unitGroups, houseLoads.items, fieldMap, deep nesting) -> SCHEMA_INVALID (B1 before: [undefined] -> COMPLETE, [NaN] in empty snapshot -> EMPTY)', check: ({ engine, input }) => {
    class Weird { constructor() { this.x = 1; } }
    const bad = [['undefined', undefined], ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['function', () => 0], ['symbol', Symbol('s')], ['bigint', 1n], ['Date', new Date(0)], ['Map', new Map()], ['class instance', new Weird()]];
    for (const [label, v] of bad) {
      const e = annual(); e.snapshot.multifamily.unitGroups = [v]; assert.throws(() => engine.evaluate(e), (x) => x.code === 'SCHEMA_INVALID', `unitGroups ${label}`); assert.ok(input.validateSnapshot(e.snapshot).length, label);
      const h = annual(); h.snapshot.multifamily.houseLoads.items = [{ deep: [[[v]]] }]; assert.throws(() => engine.evaluate(h), (x) => x.code === 'SCHEMA_INVALID', `houseLoads.items ${label}`);
      const s = clone(H.caseById('T-S-22b').migratedSnapshot); s.migration.fieldMap = { extra: v }; assert.ok(input.validateSnapshot(s).length, `fieldMap ${label}`);
    }
    const hole = annual(); hole.snapshot.multifamily.unitGroups = [1, , 3]; assert.throws(() => engine.evaluate(hole), (x) => x.code === 'SCHEMA_INVALID'); // eslint-disable-line no-sparse-arrays
    const cyc = annual(); const c = { a: 1 }; c.self = c; cyc.snapshot.multifamily.unitGroups = [c]; assert.throws(() => engine.evaluate(cyc), (x) => x.code === 'SCHEMA_INVALID');
    const empty = engine.evaluate(ENV(Object.assign(X.snap(), { purpose: null, occupancy: null, supply: X.supply(null), loadModel: { kind: null, declarations: {} }, method: { selected: null, guideRecommendation: null, selectionSource: null, guideAnswers: {} } }))); assert.strictEqual(empty.status, 'EMPTY');
    const emptyNaN = X.snap({ purpose: null, occupancy: null, supply: X.supply(null), loadModel: { kind: null, declarations: {} }, method: { selected: null, guideRecommendation: null, selectionSource: null, guideAnswers: {} } }); emptyNaN.multifamily.unitGroups = [NaN]; assert.throws(() => engine.evaluate(ENV(emptyNaN)), (x) => x.code === 'SCHEMA_INVALID', 'even the empty state is rejected with a non-JSON member');
  } },
  { id: 'R1-03-D', finding: 'R-B1-03', title: 'plain JSON data still passes, including hostile keys and nested plain objects inside opaque collections; every r22 envelope and strict-parsed text is representable', check: ({ engine, input }) => {
    const e = annual(); e.snapshot.multifamily.unitGroups = [JSON.parse('{"__proto__":{"evil":1},"constructor":"x","nested":[1,"a",null,true,{"z":[]}]}')]; const r = engine.evaluate(e); assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(({}).evil, undefined);
    assert.ok(Object.prototype.hasOwnProperty.call(e.snapshot.multifamily.unitGroups[0], '__proto__'), 'a JSON-parsed "__proto__" is an own data key');
    assert.deepStrictEqual(input.jsonRepresentabilityErrors(e), []);
    const literal = annual(); literal.snapshot.multifamily.unitGroups = [{ __proto__: { evil: 1 }, x: 1 }]; // an object-literal __proto__ SETS the prototype: that object is not plain and is rejected
    assert.throws(() => engine.evaluate(literal), (x) => x.code === 'SCHEMA_INVALID');
    for (const p of H.enginePairs()) assert.deepStrictEqual(input.jsonRepresentabilityErrors(p.envelope), [], p.id);
    const parsed = input.parseStrictJson('{"__proto__":{"a":1},"b":[{"c":null}]}'); assert.strictEqual(parsed.ok, true); assert.deepStrictEqual(input.jsonRepresentabilityErrors(parsed.value), []);
    assert.deepStrictEqual(input.jsonRepresentabilityErrors(Object.create(null)), [], 'null-prototype objects are plain');
  } },
  // ── R-B1-04 ────────────────────────────────────────────────────────────
  { id: 'R1-04-A', finding: 'R-B1-04', title: 'CONTROL valid-only laundry / NYC A/C outlet items: count finalized (1, 2, 3), no problems, applied transforms sum to the field', check: ({ state, engine, input }) => {
    for (const [name, list, category, field] of [['Laundry Circuit', 'appliances', 'laundry', 'laundryCircuits'], ['A/C Window Outlet — NYCEC 220.14(N)', 'hvac', 'ac', 'nycAcCircuitCount']]) {
      for (const n of [1, 2, 3]) {
        const rec = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: '[]', hvac: '[]', ev: '[]' }; rec[list] = JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name, category, va: 1500 })));
        const m = state.migrateLegacyRecord(rec); assert.strictEqual(m.snapshot.dwelling[field], n, `${field} ${n}`); assert.deepStrictEqual(m.problems, []); assert.deepStrictEqual(input.validateSnapshot(m.snapshot), []);
        assert.strictEqual(m.snapshot.migration.transforms.filter((t) => t.target === `dwelling.${field}` && t.status === 'applied').reduce((a, t) => a + t.contribution, 0), n);
        assert.ok(!engine.evaluate(ENV(m.snapshot)).problems.some((p) => p.code === 'LEGACY_AMBIGUOUS'));
      }
    }
  } },
  { id: 'R1-04-B', finding: 'R-B1-04', title: 'mixed valid + edited item for the same target (laundry and NYC A/C, both list orders): field stays null, valid transform kept as a partial contribution with a note, unresolved item retained, LEGACY_AMBIGUOUS once from the helper AND re-derived by the engine after a JSON round trip (B1 before: field 1, engine silent)', check: ({ state, engine, input }) => {
    for (const [name, list, category, field] of [['Laundry Circuit', 'appliances', 'laundry', 'laundryCircuits'], ['A/C Window Outlet — NYCEC 220.14(N)', 'hvac', 'ac', 'nycAcCircuitCount']]) {
      for (const reverse of [false, true]) {
        const rec = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: '[]', hvac: '[]', ev: '[]' };
        const items = [{ id: 'a', name, category, va: 1500 }, { id: 'b', name, category, va: 2000 }]; rec[list] = JSON.stringify(reverse ? items.slice().reverse() : items); const before = JSON.stringify(rec);
        const m = state.migrateLegacyRecord(rec); assert.strictEqual(JSON.stringify(rec), before, 'record untouched');
        assert.strictEqual(m.snapshot.dwelling[field], null, `${field} not finalized (${reverse})`); assert.deepStrictEqual(input.validateSnapshot(m.snapshot), []);
        assert.strictEqual(m.snapshot.migration.sourceRecord[list], rec[list]);
        const applied = m.snapshot.migration.transforms.find((t) => t.itemId === 'a'); assert.ok(applied && applied.status === 'applied' && applied.contribution === 1 && /not finalized/.test(applied.note) && applied.note.includes('"b"'));
        const open = m.snapshot.migration.unresolvedItems.find((u) => u.itemId === 'b'); assert.ok(open && open.status === 'unresolved' && open.reason === 'LEGACY_AMBIGUOUS' && open.legacy.va === 2000);
        assert.deepStrictEqual(m.problems.map((p) => `${p.code}:${p.field}`), [`LEGACY_AMBIGUOUS:dwelling.${field}`]);
        const round = JSON.parse(JSON.stringify(m.snapshot)); const r = engine.evaluate(ENV(round));
        assert.deepStrictEqual(r.problems.filter((p) => p.source === 'migration').map((p) => `${p.code}:${p.field}`), [`LEGACY_AMBIGUOUS:dwelling.${field}`], `engine re-derives once (${reverse})`);
        assert.strictEqual(r.status, 'UNSUPPORTED_SCOPE', 'legacy optional method stays disabled; no dwelling calculation ran');
      }
    }
  } },
  { id: 'R1-04-C', finding: 'R-B1-04', title: 'two valid + one edited -> still null with two partial contributions; ambiguous-only -> null (T-S-22b unchanged); resolving the count manually closes the problem while the record keeps the unresolved item', check: ({ state, engine }) => {
    const rec = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: JSON.stringify([{ id: 'v1', name: 'Laundry Circuit', category: 'laundry', va: 1500 }, { id: 'x', name: 'Laundry Circuit', category: 'laundry', va: 2000 }, { id: 'v2', name: 'Laundry Circuit', category: 'laundry', va: 1500 }]), hvac: '[]', ev: '[]' };
    const m = state.migrateLegacyRecord(rec); assert.strictEqual(m.snapshot.dwelling.laundryCircuits, null); assert.strictEqual(m.snapshot.migration.transforms.filter((t) => t.target === 'dwelling.laundryCircuits').length, 2); assert.strictEqual(m.snapshot.migration.unresolvedItems.length, 1);
    assert.ok(m.snapshot.migration.notes.some((n) => n.includes('2 valid circuit(s)') && n.includes('"x"')));
    const c = H.caseById('T-S-22b'); assert.deepStrictEqual(state.migrateLegacyRecord(c.legacyRecord).snapshot, c.migratedSnapshot);
    const resolved = clone(m.snapshot); resolved.dwelling.laundryCircuits = 3; const r = engine.evaluate(ENV(resolved)); assert.ok(!r.problems.some((p) => p.code === 'LEGACY_AMBIGUOUS')); assert.strictEqual(resolved.migration.unresolvedItems.length, 1);
  } },
  { id: 'R1-04-D', finding: 'R-B1-04', title: 'unparseable list text (not JSON, JSON object, JSON string, JSON number, non-string value) -> LegacyRecordError LEGACY_UNPARSEABLE_LIST (TypeError, message names migrateLegacyRecord), record untouched, no snapshot (B1 before: trusted empty list + prose note)', check: ({ state }) => {
    for (const [list, raw] of [['appliances', 'not-json'], ['hvac', '{}'], ['ev', '"text"'], ['appliances', '42'], ['hvac', 7], ['ev', ['array-not-string']]]) {
      const rec = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: '[]', hvac: '[]', ev: '[]' }; rec[list] = raw; const before = JSON.stringify(rec);
      assert.throws(() => state.migrateLegacyRecord(rec), (e) => e instanceof state.LegacyRecordError && e instanceof TypeError && e.code === 'LEGACY_UNPARSEABLE_LIST' && /migrateLegacyRecord/.test(e.message) && e.details.list === list, `${list} ${JSON.stringify(raw)}`);
      assert.strictEqual(JSON.stringify(rec), before);
    }
    const blank = state.migrateLegacyRecord({ method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: '', hvac: null, ev: undefined }); assert.deepStrictEqual(blank.snapshot.loads, [], 'blank/null/absent lists are legitimately empty');
  } },
  { id: 'R1-04-E', finding: 'R-B1-04', title: 'unrepresentable item (va null / va string / missing category / non-object / empty id) -> LEGACY_ITEM_UNREPRESENTABLE with list/index/itemId, even next to valid items (all-or-nothing); record untouched (B1 before: snapshot with rating.value null returned as success)', check: ({ state, input }) => {
    const good = { id: 'ok', name: 'Dryer', category: 'appliance', va: 5000 };
    for (const [label, item, itemId] of [['va null', { id: 'bad', name: 'Water Heater', category: 'appliance', va: null }, 'bad'], ['va string', { id: 'bad2', name: 'Water Heater', category: 'appliance', va: '4500' }, 'bad2'], ['missing category', { id: 'bad3', name: 'Dryer', va: 5000 }, 'bad3'], ['non-object', 42, null], ['empty id', { id: '', name: 'Dryer', category: 'appliance', va: 5000 }, ''], ['va 1e400 (Infinity)', JSON.parse('{"id":"inf","name":"Dryer","category":"appliance","va":1e400}'), 'inf']]) {
      const rec = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: JSON.stringify([good, item]), hvac: '[]', ev: '[]' }; const before = JSON.stringify(rec);
      assert.throws(() => state.migrateLegacyRecord(rec), (e) => e instanceof state.LegacyRecordError && e.code === 'LEGACY_ITEM_UNREPRESENTABLE' && e.details.list === 'appliances' && e.details.index === 1 && e.details.itemId === itemId, label);
      assert.strictEqual(JSON.stringify(rec), before, label);
    }
    const okRec = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: JSON.stringify([good]), hvac: '[]', ev: '[]' }; const m = state.migrateLegacyRecord(okRec); assert.deepStrictEqual(input.validateSnapshot(m.snapshot), []); assert.strictEqual(m.snapshot.loads[0].rating.value, 5000);
  } },
  { id: 'R1-04-F', finding: 'R-B1-04', title: 'the 15 locked migration fixtures and T-S-39 still migrate byte-for-byte to their literal snapshots', check: ({ state }) => {
    let n = 0; for (const c of H.loadCases().cases) if (c.legacyRecord && c.migratedSnapshot) { assert.deepStrictEqual(state.migrateLegacyRecord(c.legacyRecord).snapshot, c.migratedSnapshot, c.id); n++; }
    assert.strictEqual(n, 15);
  } },
];

module.exports = { CASES, annual, thirty, perSplit, seed, codes, ENV };
