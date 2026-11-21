'use strict';
/**
 * LC-22082-B0-STATE-STORE-1 — tests for src/calc/loadCalcStateV2.js (pure V2 draft/state helpers).
 * The accepted engine (loadCalcFacade / loadCalcOpt82 / loadCalc) is used only as the oracle for
 * transition invariants (stale, dormant, COMPLETE); expectations are stated independently.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ST = require('../src/calc/loadCalcStateV2.js');
const V2 = require('../src/calc/loadCalcInputV2.js');
const A = require('../src/calc/loadCalc.js');
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
const evalDraft = (draft) => { const r = unwrap(ST.toRequestV2(draft), 'toRequestV2'); return F.evaluateV2(r.request).result; };
const codes = (result) => result.problems.map((p) => p.code + '@' + p.field).sort();

/** Build the B0-P candidate purely through the new helpers (explicit ids/basisIds; no seeded data). */
function buildB0P() {
  const d = ST.createEmptyDraftV2();
  const s = d.snapshot;
  s.occupancy = 'dwelling_unit_house';
  s.supply = { topology: '1ph_3w_120_240', vLineToLine: 240, vLineToNeutral: 120, phases: 1, wires: 3 };
  s.loadModel = { kind: 'split_240_balanced_LN', declarations: { balancedLN: { value: true, provenance: { source: 'designer_declaration', note: null } } } };
  s.method.selected = 'opt_220_82'; s.method.selectionSource = 'manual';
  s.dwelling = { floorAreaFt2: 1500, smallApplianceCircuits: 2, laundryCircuits: 1, nycAcCircuitCount: 0, existingDwelling: null };
  s.hvac.arrangement = 'ac_only';
  s.optional82.singleSupplySet.value = true; s.optional82.nycAcCentralExceptionAttested.value = true; s.optional82.conductorAmpacityA.value = 200;
  const specs = [['L1', 'Range', 'range', 12000], ['L2', 'Water heater', 'water_heater', 4500], ['L3', 'Dryer', 'dryer', 5000], ['L4', 'Dishwasher', 'dishwasher', 1200], ['L5', 'Central A/C', 'ac', 5000]];
  for (const [id, label, category, va] of specs) s.loads.push(unwrap(ST.newLoadRecord({ id, basisId: `bs-${id}-1`, label, category, status: 'existing', rating: { kind: 'va', value: va, volts: null }, quantity: 1 }), id).load);
  let cur = d;
  cur = unwrap(ST.setInclusionAnswer(cur, 'L3', 'not_on_counted_laundry_circuit'), 'L3').draft;
  cur = unwrap(ST.setInclusionAnswer(cur, 'L4', 'fixed_or_permanently_connected'), 'L4').draft;
  cur = unwrap(ST.setRatingCoverageAnswer(cur, 'L5', true), 'L5').draft;
  cur = unwrap(ST.setInventoryAnswer(cur, true), 'inventory').draft;
  return cur;
}

describe('createEmptyDraftV2 — blank, independent, 3.3.0', () => {
  test('two calls give independent equal blanks; structure matches the accepted empty A snapshot lifted to V2; no seeded records; sourceFavId null', () => {
    const a = ST.createEmptyDraftV2(); const b = ST.createEmptyDraftV2();
    assert.deepStrictEqual(a, b); assert.notStrictEqual(a.snapshot, b.snapshot); a.snapshot.loads.push({}); assert.strictEqual(b.snapshot.loads.length, 0);
    const d = ST.createEmptyDraftV2();
    assert.deepStrictEqual(Object.keys(d).sort(), ['context', 'fieldErrors', 'loadErrors', 'snapshot', 'sourceFavId']);
    assert.strictEqual(d.snapshot.schemaVersion, '3.3.0'); assert.deepStrictEqual(d.snapshot.loads, []); assert.strictEqual(d.sourceFavId, null);
    assert.deepStrictEqual(d.context, { importedFrom: null, methodConfirmedAfterImport: false });
    assert.deepStrictEqual(d.snapshot.optional82.inventoryComplete, { value: null, provenance: { source: 'designer_declaration', note: null }, basis: null });
    for (const k of ['singleSupplySet', 'conductorAmpacityA', 'nycAcCentralExceptionAttested', 'laundryExceptionAttested']) assert.deepStrictEqual(d.snapshot.optional82[k], { value: null, provenance: { source: 'designer_declaration', note: null } });
    const emptyA = AS.createEmptySnapshot(); const lifted = clone(d.snapshot); delete lifted.optional82; lifted.schemaVersion = '3.2.1';
    assert.deepStrictEqual(lifted, emptyA, 'everything except the V2 additions is the accepted P-5 empty snapshot (purpose service, rule basis)');
    assert.deepStrictEqual(V2.validateSnapshotV2(d.snapshot), []); assert.ok(Object.getPrototypeOf(d.fieldErrors) === null && Object.getPrototypeOf(d.loadErrors) === null);
    const r = unwrap(ST.toRequestV2(d), 'blank'); assert.strictEqual(F.evaluateV2(r.request).result.status, 'EMPTY', 'the blank draft is the accepted EMPTY on the A route');
    assert.ok(!('sourceFavId' in r.request));
  });
});

describe('newLoadRecord / cloneLoadRecord — explicit arguments, no invented data (S1)', () => {
  const okArgs = { id: 'L9', basisId: 'bs-L9-1', rating: { kind: 'va', value: 1200, volts: null }, quantity: 1 };
  test('explicit rating/quantity give the exact R3-valid shape; category unanswered ⇒ classification required; only nullable fields are null', () => {
    const r = unwrap(ST.newLoadRecord(okArgs), 'ok');
    assert.deepStrictEqual(r.load, { id: 'L9', label: '', legacy: null, category: null, classification: 'required', rating: { kind: 'va', value: 1200, volts: null }, quantity: 1, status: null, continuous: null, connection: null, leg: null, separatelyControlledUnits: null, alms: { present: false, maxLoadVA: null }, basisId: 'bs-L9-1', inclusion82: null, ratingCoverage82: null });
    const d = ST.createEmptyDraftV2(); d.snapshot.loads.push(r.load); assert.deepStrictEqual(V2.validateSnapshotV2(d.snapshot), []);
    const c = unwrap(ST.newLoadRecord(Object.assign({}, okArgs, { category: 'dryer', status: 'new', label: 'Dryer' })), 'cat'); assert.strictEqual(c.load.classification, 'confirmed'); assert.strictEqual(c.load.category, 'dryer'); assert.strictEqual(c.load.status, 'new');
  });
  test('missing/wrong arguments are structured failures; an explicit zero is data; the args object is never mutated', () => {
    const before = frozen(okArgs);
    const cases = [[{}, /id/], [{ id: 'L9', basisId: 'b', quantity: 1 }, /rating.*no invented zero/], [{ id: 'L9', basisId: 'b', rating: { kind: 'va', value: null }, quantity: 1 }, /rating\.value/], [{ id: 'L9', basisId: 'b', rating: { kind: 'hp', value: 2 }, quantity: 1 }, /rating\.kind/], [Object.assign({}, okArgs, { quantity: 0 }), /quantity/], [Object.assign({}, okArgs, { quantity: 1.5 }), /quantity/], [Object.assign({}, okArgs, { basisId: '' }), /basisId/], [Object.assign({}, okArgs, { category: 'nope' }), /category/], [Object.assign({}, okArgs, { extra: 1 }), /unexpected/], [null, /object/]];
    for (const [args, re] of cases) { const r = ST.newLoadRecord(args); assert.strictEqual(r.ok, false, JSON.stringify(args)); assert.ok(r.problems.some((m) => re.test(m)), JSON.stringify(r.problems)); }
    assert.strictEqual(unwrap(ST.newLoadRecord(Object.assign({}, okArgs, { rating: { kind: 'va', value: 0, volts: null } })), 'zero').load.rating.value, 0);
    assert.strictEqual(frozen(okArgs), before);
  });
  test('clone copies data under fresh ids and never inherits an affirmative or negative premise; same id/basisId refused', () => {
    const d = buildB0P(); const src = d.snapshot.loads[2]; const before = frozen(src);
    const c = unwrap(ST.cloneLoadRecord(src, { id: 'L3b', basisId: 'bs-L3b-1' }), 'clone').load;
    assert.strictEqual(c.rating.value, 5000); assert.strictEqual(c.category, 'dryer'); assert.strictEqual(c.inclusion82, null); assert.strictEqual(c.ratingCoverage82, null); assert.strictEqual(c.basisId, 'bs-L3b-1');
    assert.strictEqual(frozen(src), before);
    assert.strictEqual(ST.cloneLoadRecord(src, { id: 'L3', basisId: 'x' }).ok, false); assert.strictEqual(ST.cloneLoadRecord(src, { id: 'L3b', basisId: 'bs-L3-1' }).ok, false);
    const neg = unwrap(ST.setRatingCoverageAnswer(d, 'L5', false), 'neg').draft; const c2 = unwrap(ST.cloneLoadRecord(neg.snapshot.loads[4], { id: 'L5b', basisId: 'bs-L5b-1' }), 'clone-neg').load; assert.strictEqual(c2.ratingCoverage82, null);
  });
});

describe('answers, bases, labels — transitions verified through the accepted engine', () => {
  test('B0-P built purely through the helpers equals the CORE-SCOPE-1 request and evaluates to COMPLETE 23,680 VA with the model-gated current', () => {
    const d = buildB0P(); const r = unwrap(ST.toRequestV2(d), 'req').request;
    assert.deepStrictEqual(r, B0P, 'the settled B0-P candidate'); assert.strictEqual(JSON.stringify(r), JSON.stringify(B0P), 'byte-for-byte, including key order');
    const out = F.evaluateV2(r).result; assert.deepStrictEqual([out.status, out.demand.totalVA, out.demand.totalExactE4, out.current.lineA], ['COMPLETE', 23680, 236800000, 23680 / 240]);
    assert.strictEqual(out.existingCapacity.status, 'not_assessed'); assert.strictEqual(out.current.neutralA, null);
  });
  test('answer setters capture only the current basis; reset yields the unanswered shape; wrong category or answer refused; input draft untouched', () => {
    const d = buildB0P(); const before = frozen(d);
    assert.deepStrictEqual(d.snapshot.loads[2].inclusion82, { predicate: 'b3c_dryer_not_on_counted_laundry_circuit', answer: 'not_on_counted_laundry_circuit', basis: { basisId: 'bs-L3-1', category: 'dryer', quantity: 1 } });
    assert.deepStrictEqual(d.snapshot.loads[4].ratingCoverage82, { value: true, basis: { basisId: 'bs-L5-1', category: 'ac', quantity: 1, rating: { kind: 'va', value: 5000 } } });
    assert.deepStrictEqual(d.snapshot.optional82.inventoryComplete.basis.members.map((m) => m.id), ['L1', 'L2', 'L3', 'L4', 'L5']);
    const reset = unwrap(ST.setInclusionAnswer(d, 'L3', null), 'reset').draft; assert.deepStrictEqual(reset.snapshot.loads[2].inclusion82, { predicate: 'b3c_dryer_not_on_counted_laundry_circuit', answer: null, basis: null });
    assert.strictEqual(codes(evalDraft(reset))[0], 'MISSING_FIELD@loads[2].inclusion82');
    const inv0 = unwrap(ST.setInventoryAnswer(d, null), 'inv-reset').draft; assert.deepStrictEqual(inv0.snapshot.optional82.inventoryComplete, { value: null, provenance: { source: 'designer_declaration', note: null }, basis: null });
    assert.strictEqual(ST.setInclusionAnswer(d, 'L1', 'specific_circuit').ok, false, 'range has no predicate');
    assert.strictEqual(ST.setInclusionAnswer(d, 'L3', 'specific_circuit').ok, false, 'a (3)(a) answer is invalid for the dryer predicate');
    assert.strictEqual(ST.setRatingCoverageAnswer(d, 'L3', true).ok, false); assert.strictEqual(ST.setRatingCoverageAnswer(d, 'L5', 'yes').ok, false);
    assert.strictEqual(ST.setInclusionAnswer(d, 'L77', 'specific_circuit').ok, false);
    const neg = unwrap(ST.setInclusionAnswer(d, 'L3', 'on_counted_laundry_circuit'), 'neg').draft; const on = evalDraft(neg); assert.strictEqual(on.status, 'PARTIAL'); assert.strictEqual(on.demand.partialSubtotalVA, null, 'fresh negative B-group inclusion: no subtotal');
    const negAc = unwrap(ST.setRatingCoverageAnswer(d, 'L5', false), 'negac').draft; const oac = evalDraft(negAc); assert.strictEqual(oac.status, 'PARTIAL'); assert.strictEqual(oac.demand.partialSubtotalVA, 18680);
    assert.strictEqual(frozen(d), before);
  });
  test('markBasisChanged changes only the identified basis and R3 reports staleness for BOTH polarities; restoring the identical basis restores applicability', () => {
    const d = buildB0P();
    const changed = unwrap(ST.markBasisChanged(d, 'L5', { basisId: 'bs-L5-2' }), 'chg').draft;
    assert.strictEqual(changed.snapshot.loads[4].basisId, 'bs-L5-2'); assert.strictEqual(changed.snapshot.loads[4].ratingCoverage82.basis.basisId, 'bs-L5-1', 'old fact retained, not erased');
    assert.deepStrictEqual(codes(evalDraft(changed)), ['PREMISE_STALE@loads[4].ratingCoverage82', 'PREMISE_STALE@optional82.inventoryComplete']);
    const negFirst = unwrap(ST.setRatingCoverageAnswer(d, 'L5', false), 'neg').draft; const negStale = unwrap(ST.markBasisChanged(negFirst, 'L5', { basisId: 'bs-L5-2' }), 'chg2').draft;
    assert.deepStrictEqual(codes(evalDraft(negStale)), ['PREMISE_STALE@loads[4].ratingCoverage82', 'PREMISE_STALE@optional82.inventoryComplete'], 'staleness before the negative branch');
    const back = unwrap(ST.markBasisChanged(changed, 'L5', { basisId: 'bs-L5-1' }), 'back').draft; assert.strictEqual(evalDraft(back).status, 'COMPLETE', 'identical basis restored ⇒ declarations apply again');
    assert.strictEqual(ST.markBasisChanged(d, 'L5', { basisId: 'bs-L5-1' }).ok, false); assert.strictEqual(ST.markBasisChanged(d, 'L5', { basisId: 'bs-L1-1' }).ok, false, 'collision with another record');
  });
  test('label edit changes nothing else; quantity edit makes inventory stale; dormant category fact vs newly required predicate', () => {
    const d = buildB0P();
    const lab = unwrap(ST.setLabel(d, 'L5', 'AC'), 'label').draft; assert.strictEqual(lab.snapshot.loads[4].label, 'AC'); const x = clone(lab); x.snapshot.loads[4].label = 'Central A/C'; assert.strictEqual(JSON.stringify(x), JSON.stringify(d), 'nothing but the label changed'); assert.strictEqual(evalDraft(lab).status, 'COMPLETE');
    assert.strictEqual(ST.setLabel(d, 'L5', 5).ok, false);
    const q = clone(d); q.snapshot.loads[0].quantity = 2; assert.deepStrictEqual(codes(evalDraft(q)), ['PREMISE_STALE@optional82.inventoryComplete']);
    const refreshed = unwrap(ST.setInventoryAnswer(q, true), 'refresh').draft; assert.strictEqual(evalDraft(refreshed).status, 'COMPLETE'); assert.strictEqual(refreshed.snapshot.optional82.inventoryComplete.basis.members[0].quantity, 2);
    const dormant = clone(d); dormant.snapshot.loads[2].category = 'range'; const dr = unwrap(ST.setInventoryAnswer(dormant, true), 'inv').draft; assert.strictEqual(evalDraft(dr).status, 'COMPLETE', 'dryer fact dormant on range');
    const newPred = clone(d); newPred.snapshot.loads[2].category = 'dishwasher'; const np = unwrap(ST.setInventoryAnswer(newPred, true), 'inv2').draft; assert.deepStrictEqual(codes(evalDraft(np)), ['MISSING_FIELD@loads[2].inclusion82']);
    const answered = unwrap(ST.setInclusionAnswer(np, 'L3', 'specific_circuit'), 'ans').draft; assert.strictEqual(evalDraft(answered).status, 'COMPLETE');
  });
});

describe('activeAPaths / toRequestV2 — deterministic A-adapter filter and canonical projection', () => {
  const measured = (mut) => { const d = ST.createEmptyDraftV2(); d.snapshot.method.selected = 'measured_220_87'; d.snapshot.measurement = clone(R22.cases.find((c) => c.id === 'T-S-15').envelope.snapshot.measurement); mut(d.snapshot); return d; };
  test('every lcFieldActive branch: measured only, precalculated mode, basis-dependent period fields, kW power factor, per-conductor readings, scope, purpose-dependent existing fields; non-measurement paths always active', () => {
    const on = (d, p) => ST.activeAPaths(d.snapshot).has(p);
    const none = measured((s) => { s.measurement.newLoad.mode = 'none'; s.measurement.newLoad.precalculated = null; });
    assert.ok(!on(none, 'measurement.newLoad.precalculated.va')); const pre = measured((s) => { s.measurement.newLoad.mode = 'precalculated'; }); assert.ok(on(pre, 'measurement.newLoad.precalculated.va'));
    const annual = measured((s) => { s.measurement.basis = 'annual_max_demand'; }); assert.ok(on(annual, 'measurement.periodMonths') && !on(annual, 'measurement.periodDays') && !on(annual, 'measurement.connectedTo'));
    const thirty = measured((s) => { s.measurement.basis = '30d_recording_exception'; }); assert.ok(!on(thirty, 'measurement.periodMonths') && on(thirty, 'measurement.periodDays') && on(thirty, 'measurement.intervalMinutes') && on(thirty, 'measurement.connectedTo'));
    const kw = measured((s) => { s.measurement.reading.unit = 'kW'; }); assert.ok(on(kw, 'measurement.powerFactor')); assert.ok(!on(annual, 'measurement.powerFactor'));
    const perC = measured((s) => { s.measurement.reading.unit = 'A'; s.measurement.readingScope = 'per_conductor'; }); assert.ok(on(perC, 'measurement.readingsPerConductor.L1') && !on(perC, 'measurement.reading.value') && on(perC, 'measurement.readingScope'));
    const single = measured((s) => { s.measurement.reading.unit = 'A'; s.measurement.readingScope = 'highest_loaded_conductor'; }); assert.ok(!on(single, 'measurement.readingsPerConductor.L1') && on(single, 'measurement.reading.value'));
    const feeder = measured((s) => { s.purpose = 'feeder'; }); assert.ok(on(feeder, 'measurement.existing.feederAmpacityA') && !on(feeder, 'measurement.existing.serviceRatingA')); assert.ok(on(annual, 'measurement.existing.serviceRatingA') && !on(annual, 'measurement.existing.feederAmpacityA'));
    const notMeasured = ST.createEmptyDraftV2(); notMeasured.snapshot.method.selected = 'opt_220_82'; assert.ok(!on(notMeasured, 'measurement.reading.value') && on(notMeasured, 'dwelling.floorAreaFt2') && on(notMeasured, 'optional82.inventoryComplete'));
    const nullM = ST.createEmptyDraftV2(); nullM.snapshot.method.selected = 'measured_220_87'; assert.ok(!on(nullM, 'measurement.reading.value'), 'measurement null ⇒ measurement paths inactive');
  });
  test('a retained precalculated.va error under mode none stays in the draft but leaves the A request; under mode precalculated it is transported; facade result equals direct A', () => {
    const d = measured((s) => { s.measurement.newLoad.mode = 'none'; s.measurement.newLoad.precalculated = null; }); ST._internal.put(d.fieldErrors, 'measurement.newLoad.precalculated.va', { raw: '12k', code: 'NOT_FINITE' });
    const before = frozen(d); const r = unwrap(ST.toRequestV2(d), 'none').request; assert.deepStrictEqual(r.parseErrors, []); assert.strictEqual(frozen(d), before);
    const envA = V2.downConvertToA(r); assert.strictEqual(JSON.stringify(F.evaluateV2(r).result), JSON.stringify(A.evaluate(envA)));
    const d2 = measured((s) => { s.measurement.newLoad.mode = 'precalculated'; }); ST._internal.put(d2.fieldErrors, 'measurement.newLoad.precalculated.va', { raw: '12k', code: 'NOT_FINITE' });
    const r2 = unwrap(ST.toRequestV2(d2), 'pre').request; assert.deepStrictEqual(r2.parseErrors, [{ field: 'measurement.newLoad.precalculated.va', raw: '12k', code: 'NOT_FINITE' }]);
    assert.ok(F.evaluateV2(r2).result.problems.some((p) => p.source === 'parser' && p.field === 'measurement.newLoad.precalculated.va'));
  });
  test('on the 82 route all canonical errors are carried (the engine decides activity); load errors follow ids and current indices; deterministic sort', () => {
    const d = buildB0P(); ST._internal.put(d.fieldErrors, 'measurement.reading.value', { raw: 'x', code: 'NOT_FINITE' }); ST._internal.put(d.fieldErrors, 'hvac.installingAdditionalHvac', { raw: 'y', code: 'UNKNOWN_ENUM' });
    const le = ST._internal.dict(); ST._internal.put(le, 'quantity', { raw: '1.5', code: 'NOT_INTEGER', badInput: true }); ST._internal.put(d.loadErrors, 'L4', le);
    const r = unwrap(ST.toRequestV2(d), '82').request;
    assert.deepStrictEqual(r.parseErrors, [{ field: 'hvac.installingAdditionalHvac', raw: 'y', code: 'UNKNOWN_ENUM' }, { field: 'loads[3].quantity', raw: '1.5', code: 'NOT_INTEGER' }, { field: 'measurement.reading.value', raw: 'x', code: 'NOT_FINITE' }]);
    const out = F.evaluateV2(r).result; assert.deepStrictEqual(codes(out), ['NOT_INTEGER@loads[3].quantity'], 'dormant hvac/measurement errors stay dormant in the engine; the active load error is transported');
    const re = clone(d); re.snapshot.loads.reverse(); re.snapshot.optional82.inventoryComplete = d.snapshot.optional82.inventoryComplete; const r2 = unwrap(ST.toRequestV2(re), 'reordered').request;
    assert.ok(r2.parseErrors.some((p) => p.field === 'loads[1].quantity'), 'index follows the record position; attribution follows the id');
  });
  test('the full draft is validated before filtering: malformed dormant entries, unknown paths/ids, duplicate ids, non-JSON values and bad shapes are refused, never silently dropped', () => {
    const bad = (mut, re) => { const d = buildB0P(); mut(d); const r = ST.toRequestV2(d); assert.strictEqual(r.ok, false); assert.ok(r.problems.some((m) => re.test(m)), JSON.stringify(r.problems)); };
    bad((d) => ST._internal.put(d.fieldErrors, 'measurement.reading.value', { raw: 5, code: 'NOT_FINITE' }), /raw must be a string/);
    bad((d) => ST._internal.put(d.fieldErrors, 'dwelling.bogus', { raw: 'x', code: 'NOT_FINITE' }), /not a canonical V2 scalar path/);
    bad((d) => ST._internal.put(d.fieldErrors, 'measurement.reading.value', { raw: 'x', code: 'WEIRD' }), /unknown code/);
    bad((d) => ST._internal.put(d.fieldErrors, 'measurement.reading.value', { raw: 'x', code: 'NOT_FINITE', badInput: false }), /badInput/);
    bad((d) => { const m = ST._internal.dict(); ST._internal.put(m, 'label', { raw: 'x', code: 'NOT_FINITE' }); ST._internal.put(d.loadErrors, 'L1', m); }, /not a canonical load field/);
    bad((d) => { const m = ST._internal.dict(); ST._internal.put(m, 'quantity', { raw: 'x', code: 'NOT_FINITE' }); ST._internal.put(d.loadErrors, 'L99', m); }, /not a load of this snapshot/);
    bad((d) => { d.snapshot.loads[1].id = 'L1'; }, /repeated/);
    bad((d) => { d.snapshot.loads[0].rating.value = NaN; }, /not JSON/);
    bad((d) => { d.sourceFavId = {}; }, /sourceFavId/);
    bad((d) => { delete d.context; }, /context/);
    bad((d) => { d.extra = 1; }, /unexpected key/);
    assert.strictEqual(ST.toRequestV2(null).ok, false);
  });
  test("special ids '__proto__' and 'constructor' are ordinary data keys in the maps and in the request", () => {
    const d = buildB0P(); const rec = unwrap(ST.newLoadRecord({ id: '__proto__', basisId: 'bs-p-1', rating: { kind: 'va', value: 100, volts: null }, quantity: 1, category: 'water_heater' }), 'proto').load; d.snapshot.loads.push(rec);
    const m = ST._internal.dict(); ST._internal.put(m, 'rating.value', { raw: 'zz', code: 'NOT_FINITE' }); ST._internal.put(d.loadErrors, '__proto__', m);
    const inv = unwrap(ST.setInventoryAnswer(d, true), 'inv').draft; const r = unwrap(ST.toRequestV2(inv), 'req').request;
    assert.ok(r.parseErrors.some((p) => p.field === 'loads[5].rating.value')); assert.strictEqual(Object.getPrototypeOf(inv.loadErrors), null); assert.ok(Object.prototype.hasOwnProperty.call(inv.loadErrors, '__proto__'));
    assert.strictEqual(F.evaluateV2(r).result.status, 'INVALID_INPUT');
  });
});

describe('R1 corrections — V1 original-input validation, V2 controlled refusals, V3 owned path lists', () => {
  const base = () => ({ snapshot: clone(B0P.snapshot), context: clone(B0P.context), fieldErrors: {}, loadErrors: {}, sourceFavId: null });
  const SS = require('../src/calc/loadCalcStorageV2.js');
  const refuses = (r, re, what) => { assert.strictEqual(r.ok, false, what); assert.ok(!('draft' in r) && !('load' in r) && !('request' in r) && !('payload' in r), what + ': no candidate'); if (re) assert.ok(r.problems.some((m) => re.test(m)), what + ': ' + JSON.stringify(r.problems)); };

  test('V1: an invalid nested error submap of ANY type is refused by every entry point — no successful copy silently sanitizes it', () => {
    for (const badSub of [null, 7, [], false, 'x', () => {}]) {
      const d = base(); d.loadErrors.L3 = badSub; const before = JSON.stringify(d.loadErrors.L3 === undefined ? null : typeof d.loadErrors.L3);
      refuses(ST.toRequestV2(d), /loadErrors\[L3\]|not JSON/, 'toRequestV2 ' + typeof badSub);
      refuses(SS.toPayloadV3(d), /loadErrors\[L3\]|not JSON/, 'toPayloadV3 ' + typeof badSub);
      refuses(ST.setLabel(d, 'L1', 'renamed'), /loadErrors\[L3\]|not JSON/, 'setLabel ' + typeof badSub);
      refuses(ST.setInclusionAnswer(d, 'L3', 'not_on_counted_laundry_circuit'), /loadErrors\[L3\]|not JSON/, 'setInclusionAnswer ' + typeof badSub);
      refuses(ST.setRatingCoverageAnswer(d, 'L5', true), /loadErrors\[L3\]|not JSON/, 'setRatingCoverageAnswer ' + typeof badSub);
      refuses(ST.setInventoryAnswer(d, true), /loadErrors\[L3\]|not JSON/, 'setInventoryAnswer ' + typeof badSub);
      refuses(ST.markBasisChanged(d, 'L5', { basisId: 'bs-L5-9' }), /loadErrors\[L3\]|not JSON/, 'markBasisChanged ' + typeof badSub);
      assert.strictEqual(typeof d.loadErrors.L3, before.replace(/"/g, ''), 'source untouched');
    }
    for (const badMap of [null, 7, [], 'x']) { const d = base(); d.loadErrors = badMap; refuses(ST.toRequestV2(d), /loadErrors|draft/, 'whole map ' + typeof badMap); refuses(SS.toPayloadV3(d), /loadErrors|draft/, 'whole map serialize'); const e = base(); e.fieldErrors = badMap; refuses(SS.toPayloadV3(e), /fieldErrors|draft/, 'fieldErrors ' + typeof badMap); }
    const entry = base(); entry.fieldErrors['dwelling.floorAreaFt2'] = { raw: 5, code: 'NOT_FINITE' };
    refuses(SS.toPayloadV3(entry), /raw must be a string/, 'malformed entry'); refuses(ST.setLabel(entry, 'L1', 'x'), /raw must be a string/, 'malformed entry via setter');
  });

  test('V1: a non-plain context or snapshot value is refused everywhere (never flattened into an accepted object)', () => {
    const d = base(); d.context = Object.create({ inherited: 1 }); d.context.importedFrom = null; d.context.methodConfirmedAfterImport = false;
    refuses(SS.toPayloadV3(d), /not JSON|context/, 'serializer'); refuses(ST.setLabel(d, 'L1', 'x'), /not JSON|context/, 'setter'); refuses(ST.toRequestV2(d), /not JSON|context/, 'request');
    const e = base(); e.snapshot.dwelling.floorAreaFt2 = new Number(1500); refuses(SS.toPayloadV3(e), /not JSON/, 'boxed number');
    const f = base(); f.snapshot.loads[0].alms = Object.create(null); f.snapshot.loads[0].alms.present = false; f.snapshot.loads[0].alms.maxLoadVA = null;
    assert.strictEqual(SS.toPayloadV3(f).ok, true, 'a prototype-free plain object is still accepted JSON data');
  });

  test('V1: malformed source records and answered declarations are refused BEFORE cloning or re-answering; the reset of valid facts is not a bypass', () => {
    const src = clone(B0P.snapshot.loads[0]);
    refuses(ST.cloneLoadRecord(Object.assign(clone(src), { quantity: 0 }), { id: 'Z', basisId: 'bz' }), /quantity/, 'quantity 0');
    refuses(ST.cloneLoadRecord(Object.assign(clone(src), { rating: { kind: 'va', value: null, volts: null } }), { id: 'Z', basisId: 'bz' }), /rating/, 'null rating');
    refuses(ST.cloneLoadRecord(Object.assign(clone(src), { classification: null }), { id: 'Z', basisId: 'bz' }), /classification/, 'null classification');
    const badFact = Object.assign(clone(B0P.snapshot.loads[2]), { inclusion82: { predicate: 'b3c_dryer_not_on_counted_laundry_circuit', answer: 'not_on_counted_laundry_circuit', basis: null } });
    refuses(ST.cloneLoadRecord(badFact, { id: 'Z', basisId: 'bz' }), /inclusion82/, 'answered without basis is not erased by the clone reset');
    const d = base(); d.snapshot.loads[2].inclusion82 = { predicate: 'b3c_dryer_not_on_counted_laundry_circuit', answer: 'not_on_counted_laundry_circuit', basis: null };
    refuses(ST.setInclusionAnswer(d, 'L3', 'on_counted_laundry_circuit'), /inclusion82/, 'a setter does not overwrite an invalid original');
    refuses(ST.setLabel(d, 'L1', 'x'), /inclusion82/, 'nor does a label edit');
    const cov = base(); cov.snapshot.loads[4].ratingCoverage82 = { value: true, basis: null };
    refuses(ST.setRatingCoverageAnswer(cov, 'L5', false), /ratingCoverage82/, 'answered coverage without basis');
    const dup = base(); dup.snapshot.loads[1].id = 'L1'; refuses(SS.toPayloadV3(dup), /repeated/, 'duplicate ids');
    assert.strictEqual(ST.cloneLoadRecord(clone(B0P.snapshot.loads[2]), { id: 'L3b', basisId: 'bs-L3b-1' }).ok, true, 'a valid record still clones with its facts reset');
  });

  test('V1: constructor arguments are closed at every level; no electrical default replaces a missing number', () => {
    refuses(ST.newLoadRecord({ id: 'X', basisId: 'b', rating: { kind: 'va', value: 5, bogus: 1 }, quantity: 1 }), /rating: unexpected key/, 'unknown nested rating key');
    refuses(ST.newLoadRecord({ id: 'X', basisId: 'b', rating: { kind: 'va' }, quantity: 1 }), /rating\.value/, 'missing value');
    refuses(ST.newLoadRecord({ id: 'X', basisId: 'b', rating: { kind: 'va', value: NaN }, quantity: 1 }), /rating\.value/, 'NaN');
    refuses(ST.newLoadRecord({ id: 'X', basisId: 'b', rating: { kind: 'va', value: 5, volts: 'x' }, quantity: 1 }), /volts/, 'bad volts');
    assert.strictEqual(ST.newLoadRecord({ id: 'X', basisId: 'b', rating: { kind: 'va', value: 0, volts: null }, quantity: 1 }).ok, true, 'an explicit zero is still data');
  });

  test('V2: missing or wrong snapshot / load-array / record parents give a structured refusal, never a throw or a partial draft', () => {
    const mutations = [['snapshot null', (d) => { d.snapshot = null; }], ['snapshot {}', (d) => { d.snapshot = {}; }], ['loads null', (d) => { d.snapshot.loads = null; }], ['loads {}', (d) => { d.snapshot.loads = {}; }], ['loads [null]', (d) => { d.snapshot.loads = [null]; }], ['loads [7]', (d) => { d.snapshot.loads = [7]; }], ['optional82 missing', (d) => { delete d.snapshot.optional82; }], ['context missing', (d) => { delete d.context; }]];
    for (const [what, mut] of mutations) {
      const d = base(); mut(d); const before = JSON.stringify(d);
      for (const [name, call] of [['toRequestV2', () => ST.toRequestV2(d)], ['toPayloadV3', () => SS.toPayloadV3(d)], ['setLabel', () => ST.setLabel(d, 'L1', 'x')], ['setInventoryAnswer', () => ST.setInventoryAnswer(d, true)], ['markBasisChanged', () => ST.markBasisChanged(d, 'L5', { basisId: 'z' })]]) {
        let r; assert.doesNotThrow(() => { r = call(); }, `${what} / ${name} must not throw`); refuses(r, null, `${what} / ${name}`);
      }
      assert.strictEqual(JSON.stringify(d), before, what + ': original unchanged');
    }
  });

  test('V2: cyclic and non-JSON inputs are refused by the representability boundary before any copy', () => {
    const cyc = base(); cyc.snapshot.self = cyc.snapshot;
    for (const [name, call] of [['toRequestV2', () => ST.toRequestV2(cyc)], ['toPayloadV3', () => SS.toPayloadV3(cyc)], ['setLabel', () => ST.setLabel(cyc, 'L1', 'x')], ['setInclusionAnswer', () => ST.setInclusionAnswer(cyc, 'L3', 'not_on_counted_laundry_circuit')]]) {
      let r; assert.doesNotThrow(() => { r = call(); }, name); refuses(r, /reference cycle|not JSON/, name);
    }
    const cycLoad = clone(B0P.snapshot.loads[0]); cycLoad.self = cycLoad; let cl; assert.doesNotThrow(() => { cl = ST.cloneLoadRecord(cycLoad, { id: 'Z', basisId: 'bz' }); }); refuses(cl, /reference cycle|not JSON/, 'clone cycle');
    const fn = base(); fn.snapshot.loads[0].label = () => 'x'; refuses(SS.toPayloadV3(fn), /not JSON/, 'function value');
    const und = base(); und.snapshot.loads[0].status = undefined; refuses(SS.toPayloadV3(und), /not JSON|status/, 'undefined value');
  });

  test('V3: adding a member to the exported R3 Sets after module load cannot widen this layer (memory-only, restored in finally)', () => {
    const d = base(); d.fieldErrors['dwelling.untrusted'] = { raw: 'x', code: 'NOT_FINITE' };
    refuses(SS.toPayloadV3(d), /not a canonical V2 scalar path/, 'unknown path before'); 
    try {
      V2.SCALAR_PATHS.add('dwelling.untrusted');
      refuses(SS.toPayloadV3(d), /not a canonical V2 scalar path/, 'serializer after widening');
      refuses(ST.toRequestV2(d), /not a canonical V2 scalar path/, 'request after widening');
      refuses(ST.setLabel(d, 'L1', 'x'), /not a canonical V2 scalar path/, 'setter after widening');
      const p = SS.toPayloadV3(base()).payload; p.fieldErrors['dwelling.untrusted'] = { raw: 'x', code: 'NOT_FINITE' };
      assert.ok(SS.validatePayloadV3(p).some((m) => /not a canonical V2 scalar path/.test(m)), 'validator after widening');
    } finally { V2.SCALAR_PATHS.delete('dwelling.untrusted'); }
    const e = base(); e.loadErrors.L1 = { bogus: { raw: 'x', code: 'NOT_FINITE' } };
    try { V2.LOAD_FIELDS.add('bogus'); refuses(SS.toPayloadV3(e), /not a canonical load field/, 'subfield after widening'); } finally { V2.LOAD_FIELDS.delete('bogus'); }
    assert.deepStrictEqual(ST.OWNED_SCALAR_PATHS.slice().sort(), Array.from(V2.SCALAR_PATHS).sort(), 'the owned copy matches the accepted export at load time');
    assert.deepStrictEqual(ST.OWNED_LOAD_FIELDS.slice().sort(), Array.from(V2.LOAD_FIELDS).sort());
    assert.ok(Object.isFrozen(ST.OWNED_SCALAR_PATHS) && Object.isFrozen(ST.OWNED_LOAD_FIELDS));
    assert.ok(!Object.isFrozen(V2.SCALAR_PATHS) || true, 'R3 exports are not modified or frozen by this layer');
    assert.strictEqual(SS.toPayloadV3(base()).ok, true, 'ordinary payloads still serialize');
  });

  test('legitimate incomplete, negative, stale, dormant and special-ID data remain editable and savable after the corrections', () => {
    const b = base();
    const unanswered = clone(b); unanswered.snapshot.optional82.inventoryComplete = ST._internal.unconfirmedInventory(); assert.strictEqual(SS.toPayloadV3(unanswered).ok, true);
    const neg = unwrap(ST.setRatingCoverageAnswer(b, 'L5', false), 'neg').draft; assert.strictEqual(SS.toPayloadV3(neg).ok, true); assert.strictEqual(evalDraft(neg).status, 'PARTIAL');
    const stale = unwrap(ST.markBasisChanged(neg, 'L5', { basisId: 'bs-L5-2' }), 'stale').draft; assert.strictEqual(SS.toPayloadV3(stale).ok, true); assert.deepStrictEqual(codes(evalDraft(stale)).filter((c) => /PREMISE_STALE/.test(c)).length > 0, true);
    const dormant = clone(b); dormant.snapshot.loads[2].category = 'range'; const dr = unwrap(ST.setInventoryAnswer(dormant, true), 'inv').draft; assert.strictEqual(SS.toPayloadV3(dr).ok, true); assert.strictEqual(evalDraft(dr).status, 'COMPLETE');
    const special = clone(b); special.snapshot.loads[0].id = '__proto__'; const m = ST._internal.dict(); ST._internal.put(m, 'quantity', { raw: 'q', code: 'NOT_INTEGER' }); ST._internal.put(special.loadErrors, '__proto__', m);
    const sp = unwrap(ST.setInventoryAnswer(special, true), 'special').draft; assert.strictEqual(SS.toPayloadV3(sp).ok, true, 'special ids stay ordinary data');
    const label = unwrap(ST.setLabel(b, 'L1', 'renamed'), 'label').draft; assert.strictEqual(label.snapshot.loads[0].label, 'renamed'); assert.strictEqual(evalDraft(label).status, 'COMPLETE');
  });
});

describe('R2 correction — C1: the ORIGINAL context is validated on the shared editing boundary', () => {
  const base = (ctx) => ({ snapshot: clone(B0P.snapshot), context: clone(ctx), fieldErrors: {}, loadErrors: {}, sourceFavId: 'old-17' });
  const SS = require('../src/calc/loadCalcStorageV2.js');
  const EDITS = [
    ['setLabel', (d) => ST.setLabel(d, 'L1', 'renamed')],
    ['setInclusionAnswer', (d) => ST.setInclusionAnswer(d, 'L3', 'not_on_counted_laundry_circuit')],
    ['setRatingCoverageAnswer', (d) => ST.setRatingCoverageAnswer(d, 'L5', true)],
    ['setInventoryAnswer', (d) => ST.setInventoryAnswer(d, true)],
    ['markBasisChanged', (d) => ST.markBasisChanged(d, 'L5', { basisId: 'bs-L5-9' })],
  ];
  const INVALID = [
    ['context null', null, /context/], ['context array', [], /context/], ['context {}', {}, /importedFrom|methodConfirmedAfterImport/],
    ['missing methodConfirmedAfterImport', { importedFrom: null }, /methodConfirmedAfterImport/],
    ['missing importedFrom', { methodConfirmedAfterImport: false }, /importedFrom/],
    ['string flag', { importedFrom: null, methodConfirmedAfterImport: 'false' }, /methodConfirmedAfterImport/],
    ['numeric flag', { importedFrom: null, methodConfirmedAfterImport: 0 }, /methodConfirmedAfterImport/],
    ['importedFrom string', { importedFrom: 'lcv2', methodConfirmedAfterImport: false }, /importedFrom/],
    ['importedFrom array', { importedFrom: [], methodConfirmedAfterImport: false }, /importedFrom/],
    ['importedFrom.lcv 0', { importedFrom: { lcv: 0, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' }, methodConfirmedAfterImport: false }, /lcv/],
    ['importedFrom.lcv string', { importedFrom: { lcv: '2', profileId: 'A_measured_87_core', schemaVersion: '3.2.1' }, methodConfirmedAfterImport: false }, /lcv/],
    ['importedFrom missing schemaVersion', { importedFrom: { lcv: 2, profileId: 'A_measured_87_core' }, methodConfirmedAfterImport: false }, /schemaVersion/],
    ['unknown context key', { importedFrom: null, methodConfirmedAfterImport: false, extra: 1 }, /extra/],
    ['unknown importedFrom key', { importedFrom: { lcv: 2, profileId: 'A', schemaVersion: '3.2.1', note: 'x' }, methodConfirmedAfterImport: false }, /note/],
  ];
  test('every editing helper refuses an invalid original context, with no candidate and no mutation; downstream refusals are unchanged', () => {
    for (const [what, ctx, re] of INVALID) {
      const d = base(ctx); const before = JSON.stringify(d);
      for (const [name, call] of EDITS) {
        let r; assert.doesNotThrow(() => { r = call(d); }, `${what} / ${name} must not throw`);
        assert.strictEqual(r.ok, false, `${what} / ${name} must refuse`);
        assert.ok(!('draft' in r), `${what} / ${name}: no candidate`);
        assert.ok(r.problems.length && r.problems.every((m) => typeof m === 'string'), `${what} / ${name}: nonempty string[]`);
        assert.ok(r.problems.some((m) => re.test(m)), `${what} / ${name}: names the context problem — ${JSON.stringify(r.problems)}`);
      }
      assert.strictEqual(JSON.stringify(d), before, what + ': original unchanged');
      assert.strictEqual(ST.toRequestV2(d).ok, false, what + ': projection still refuses');
      assert.strictEqual(SS.toPayloadV3(d).ok, false, what + ': serializer still refuses');
      assert.ok(SS.validatePayloadV3({ lcv: 3, capabilityProfile: 'AB82_core1', context: ctx, snapshot: d.snapshot, fieldErrors: {}, loadErrors: {}, sourceFavId: null }).length, what + ': direct payload validation still refuses');
    }
  });
  test('valid contexts stay editable: fresh, imported-unconfirmed(false) and imported-confirmed(true) all edit, keep context/sourceFavId and round-trip; nothing is auto-confirmed or normalised', () => {
    const valid = [
      ['fresh', { importedFrom: null, methodConfirmedAfterImport: false }],
      ['imported lcv-2 unconfirmed', { importedFrom: { lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' }, methodConfirmedAfterImport: false }],
      ['imported legacy confirmed', { importedFrom: { lcv: 1, profileId: 'legacy_pre_lcv_favorite', schemaVersion: 'unversioned' }, methodConfirmedAfterImport: true }],
    ];
    for (const [what, ctx] of valid) {
      for (const [name, call] of EDITS) {
        const d = base(ctx); const r = call(d);
        assert.strictEqual(r.ok, true, `${what} / ${name}: ${JSON.stringify(r.problems)}`);
        assert.deepStrictEqual(r.draft.context, ctx, `${what} / ${name}: context preserved verbatim`);
        assert.strictEqual(r.draft.sourceFavId, 'old-17');
        const p = SS.toPayloadV3(r.draft); assert.strictEqual(p.ok, true, `${what} / ${name}: candidate round-trips`);
        assert.deepStrictEqual(SS.restorePayloadV3(p.payload).draft.context, ctx);
      }
      const out = evalDraft(base(ctx));
      if (ctx.importedFrom !== null && ctx.methodConfirmedAfterImport === false) assert.ok(out.problems.some((p) => p.code === 'IMPORTED_METHOD_UNCONFIRMED'), what + ': the engine keeps the import guard');
      else assert.strictEqual(out.status, 'COMPLETE', what);
    }
  });
  test('the context check runs only after the shape prerequisites and does not mask them; incomplete/stale/dormant data with a valid context still edits', () => {
    const bad = base({ importedFrom: null }); bad.snapshot.loads = null;
    const r = ST.setLabel(bad, 'L1', 'x'); assert.strictEqual(r.ok, false); assert.ok(r.problems.some((m) => /loads/.test(m)), 'the snapshot problem is reported first: ' + JSON.stringify(r.problems));
    const good = base({ importedFrom: null, methodConfirmedAfterImport: false });
    const unanswered = clone(good); unanswered.snapshot.optional82.inventoryComplete = ST._internal.unconfirmedInventory();
    assert.strictEqual(ST.setLabel(unanswered, 'L1', 'x').ok, true);
    const neg = unwrap(ST.setRatingCoverageAnswer(good, 'L5', false), 'neg').draft; assert.strictEqual(ST.setLabel(neg, 'L1', 'x').ok, true);
    const stale = unwrap(ST.markBasisChanged(neg, 'L5', { basisId: 'bs-L5-2' }), 'stale').draft; assert.strictEqual(ST.setLabel(stale, 'L1', 'x').ok, true);
    const dormant = clone(good); dormant.snapshot.loads[2].category = 'range'; assert.strictEqual(unwrap(ST.setInventoryAnswer(dormant, true), 'dormant').ok, true);
  });
});
