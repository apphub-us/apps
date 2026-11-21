'use strict';
/**
 * LC-22082-B0-CORE-1 — facade API v2 tests. Comparison partitions (SPEC-R2 §2.1, CORE-1 §5):
 *   1. direct A on frozen r22 — untouched (tools/loadcalc-core-check.js, test/loadCalcOracles.test.js);
 *   2. facade-delegated A: response.result byte-equivalent to the direct A result of the same A envelope;
 *   3. explicit 82: routed to engine B82_core1 (its own fixtures), never compared with old disabled-82 outputs.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../src/calc/loadCalc.js');
const AI = require('../src/calc/loadCalcInput.js');
const V2 = require('../src/calc/loadCalcInputV2.js');
const B82 = require('../src/calc/loadCalcOpt82.js');
const F = require('../src/calc/loadCalcFacade.js');

const ROOT = path.join(__dirname, '..');
const R22 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'EC-CALC-2-A3-test-cases-r22.json'), 'utf8'));
const LC82 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'LC82-cases-r1.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const decl = () => ({ value: null, provenance: { source: 'designer_declaration', note: null } });
/** Upgrade an A envelope (schema 3.2.1) to a V2 request: unconfirmed premises, fresh basisIds, explicit context. Never sets true. */
function upgradeA(envA, context) {
  const snap = clone(envA.snapshot); snap.schemaVersion = '3.3.0';
  snap.optional82 = { singleSupplySet: decl(), conductorAmpacityA: decl(), nycAcCentralExceptionAttested: decl(), laundryExceptionAttested: decl(), inventoryComplete: { value: null, provenance: { source: 'designer_declaration', note: null }, basis: null } };
  snap.loads = snap.loads.map((l, i) => Object.assign({}, l, { basisId: `bs-${l.id}-${i}`, inclusion82: null, ratingCoverage82: null }));
  return { apiVersion: 2, profileId: 'AB82_core1', context: context || { importedFrom: null, methodConfirmedAfterImport: false }, parseErrors: clone(envA.parseErrors), snapshot: snap };
}
const withEnvelope = R22.cases.filter((c) => c.envelope && c.envelope.snapshot);

describe('Partition 2 — facade-delegated A is byte-equivalent to direct A', () => {
  const delegated = withEnvelope.filter((c) => c.envelope.snapshot.method.selected !== 'opt_220_82');
  const routed82 = withEnvelope.filter((c) => c.envelope.snapshot.method.selected === 'opt_220_82');
  test(`every r22 envelope with method ≠ opt_220_82 (${delegated.length}) yields an identical A result through the facade; ${routed82.length} historical 82 envelopes are the explicit-82 partition`, () => {
    assert.ok(delegated.length > 100 && routed82.length >= 8);
    let checked = 0;
    for (const c of delegated) {
      let direct; try { direct = A.evaluate(c.envelope); } catch (e) { if (e.name === 'LoadCalcEnvelopeError') continue; throw e; }
      const req = upgradeA(c.envelope); const before = JSON.stringify(req);
      const { facade, result } = F.evaluateV2(req);
      assert.strictEqual(JSON.stringify(result), JSON.stringify(direct), `${c.id}: facade result differs from direct A`);
      assert.strictEqual(facade.engine, 'A'); assert.strictEqual(facade.engineProfileId, 'A_measured_87_core'); assert.strictEqual(result.profileId, 'A_measured_87_core');
      assert.strictEqual(JSON.stringify(req), before, `${c.id}: request mutated`);
      checked++;
    }
    assert.ok(checked > 100, 'delegated envelopes compared: ' + checked);
  });
  test('method null routes to A: the empty V2 snapshot yields the accepted EMPTY result unchanged', () => {
    const empty = withEnvelope.find((c) => c.id === 'T-S-08') || withEnvelope.find((c) => c.envelope.snapshot.method.selected === null && c.envelope.snapshot.loads.length === 0);
    assert.ok(empty, 'an empty-snapshot r22 case exists');
    const direct = A.evaluate(empty.envelope); const { facade, result } = F.evaluateV2(upgradeA(empty.envelope));
    assert.strictEqual(JSON.stringify(result), JSON.stringify(direct)); assert.strictEqual(facade.engine, 'A');
    if (direct.status === 'EMPTY') assert.strictEqual(result.status, 'EMPTY');
  });
  test('down-conversion strips exactly the 82-only keys and parse errors on a COPY that the unchanged A validator accepts; the original keeps them', () => {
    const b0 = LC82.cases.find((c) => c.id === 'LC82-B0P').request; const req = clone(b0); req.snapshot.method.selected = 'measured_220_87';
    req.parseErrors = [{ field: 'optional82.conductorAmpacityA.value', raw: 'x', code: 'NOT_FINITE' }, { field: 'loads[2].inclusion82', raw: 'y', code: 'UNKNOWN_ENUM' }, { field: 'dwelling.floorAreaFt2', raw: 'z', code: 'NOT_FINITE' }];
    const envA = V2.downConvertToA(req);
    assert.deepStrictEqual(AI.validateEnvelope(envA), [], 'A validator accepts the projection');
    assert.strictEqual(envA.snapshot.schemaVersion, '3.2.1'); assert.ok(!('optional82' in envA.snapshot)); assert.ok(envA.snapshot.loads.every((l) => !('basisId' in l) && !('inclusion82' in l) && !('ratingCoverage82' in l)));
    assert.deepStrictEqual(envA.parseErrors.map((p) => p.field), ['dwelling.floorAreaFt2']); assert.strictEqual(envA.profileId, 'A_measured_87_core');
    assert.ok('optional82' in req.snapshot && 'basisId' in req.snapshot.loads[0] && req.parseErrors.length === 3, 'original request untouched');
    const { facade, result } = F.evaluateV2(req); assert.strictEqual(facade.engine, 'A'); assert.strictEqual(JSON.stringify(result), JSON.stringify(A.evaluate(envA)));
  });
  test('R1/M2: the A projection keeps every shared parse error (incl. loads[i].separatelyControlledUnits) and strips only 82-only paths; A itself re-emits shared errors unchanged', () => {
    const b0 = LC82.cases.find((c) => c.id === 'LC82-B0P').request; const req = clone(b0); req.snapshot.method.selected = 'measured_220_87';
    req.parseErrors = [{ field: 'loads[0].separatelyControlledUnits', raw: '1.5', code: 'NOT_INTEGER' }, { field: 'loads[2].inclusion82', raw: 'y', code: 'UNKNOWN_ENUM' }, { field: 'optional82.inventoryComplete', raw: 'z', code: 'UNKNOWN_ENUM' }, { field: 'measurement.reading.value', raw: 'q', code: 'NOT_FINITE' }];
    const envA = V2.downConvertToA(req); assert.deepStrictEqual(envA.parseErrors.map((p) => p.field), ['loads[0].separatelyControlledUnits', 'measurement.reading.value']);
    assert.deepStrictEqual(AI.validateEnvelope(envA), []); assert.ok(envA.snapshot.loads.every((l) => 'separatelyControlledUnits' in l), 'the shared retained field stays in the projection');
    const direct = A.evaluate(envA); const { result } = F.evaluateV2(req); assert.strictEqual(JSON.stringify(result), JSON.stringify(direct));
    assert.ok(direct.problems.some((p) => p.source === 'parser' && p.field === 'loads[0].separatelyControlledUnits'), 'A re-emits the shared error under its own accepted semantics (unchanged)');
    assert.strictEqual(req.parseErrors.length, 4, 'stored request untouched');
  });
  test('the A validator rejects the raw V2 request (a naked V2 request is not an A envelope)', () => {
    const b0 = LC82.cases.find((c) => c.id === 'LC82-B0P').request;
    assert.ok(AI.validateEnvelope({ snapshot: b0.snapshot, parseErrors: b0.parseErrors, profileId: 'A_measured_87_core' }).length > 0);
  });
});

describe('Partition 3 — explicit 82 route', () => {
  test('historical disabled-82 r22 envelopes reach engine B82_core1 through the facade and are never compared with their old A expectations', () => {
    const routed = withEnvelope.filter((c) => c.envelope.snapshot.method.selected === 'opt_220_82');
    for (const c of routed) {
      const { facade, result } = F.evaluateV2(upgradeA(c.envelope));
      assert.strictEqual(facade.engine, 'B82'); assert.strictEqual(result.profileId, 'B82_core1');
      assert.ok(['UNSUPPORTED_SCOPE', 'BLOCKED_PENDING_RULE', 'INVALID_INPUT', 'INCOMPLETE_INPUT', 'UNQUALIFIED_METHOD', 'PARTIAL', 'COMPLETE'].includes(result.status));
      assert.ok(!result.problems.some((p) => p.code === 'CAPABILITY_DISABLED' && p.field === 'method.selected'), `${c.id}: method is enabled on the 82 route`);
    }
  });
  test('historical envelopes under the DECISION-1 gate: T-S-07a (arrangement none) → UNSUPPORTED_SCOPE with CAPABILITY_DISABLED; T-S-22a (arrangement null) → INCOMPLETE with MISSING_FIELD (new candidate expectations, not rewrites of the r22 rows)', () => {
    const a = withEnvelope.find((x) => x.id === 'T-S-07a'); const b = withEnvelope.find((x) => x.id === 'T-S-22a'); assert.ok(a && b);
    const ra = F.evaluateV2(upgradeA(a.envelope)).result;
    assert.strictEqual(ra.status, 'UNSUPPORTED_SCOPE'); assert.ok(ra.problems.some((p) => p.code === 'CAPABILITY_DISABLED' && p.field === 'hvac.arrangement')); assert.deepStrictEqual(ra.demand.lines, []);
    const rb = F.evaluateV2(upgradeA(b.envelope)).result;
    assert.strictEqual(rb.status, 'INCOMPLETE_INPUT');
    assert.ok(rb.problems.some((p) => p.code === 'MISSING_FIELD' && p.field === 'hvac.arrangement'));
    assert.ok(rb.problems.some((p) => p.code === 'QUALIFICATION_UNKNOWN' && p.field === 'optional82.conductorAmpacityA'));
    assert.ok(rb.problems.some((p) => p.code === 'MISSING_FIELD' && p.field === 'optional82.inventoryComplete'));
    assert.ok(!rb.problems.some((p) => p.code === 'CAPABILITY_DISABLED'), 'null is an unanswered field, never a disabled capability');
    assert.deepStrictEqual(rb.demand.lines, []);
  });
  test('import guard is read from request.context only: unconfirmed → INCOMPLETE; confirmed → premises still unanswered (reselection certifies nothing)', () => {
    const b0 = LC82.cases.find((c) => c.id === 'LC82-B0P').request;
    const imported = clone(b0); imported.context = { importedFrom: { lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' }, methodConfirmedAfterImport: false };
    const r1 = F.evaluateV2(imported); assert.strictEqual(r1.facade.importGuard, 'unconfirmed'); assert.strictEqual(r1.result.status, 'INCOMPLETE_INPUT'); assert.ok(r1.result.problems.some((p) => p.code === 'IMPORTED_METHOD_UNCONFIRMED'));
    const confirmed = clone(imported); confirmed.context.methodConfirmedAfterImport = true; const r2 = F.evaluateV2(confirmed);
    assert.strictEqual(r2.facade.importGuard, 'confirmed'); assert.strictEqual(r2.result.status, 'COMPLETE', 'B0-P premises are answered in this request, so confirmation alone completes the import path');
    const c = LC82.cases.find((x) => x.id === 'LC82-S3-import-reselected-premises-unanswered'); const r3 = F.evaluateV2(c.request);
    assert.strictEqual(r3.result.status, 'INCOMPLETE_INPUT'); assert.strictEqual(r3.result.problems.filter((p) => p.code === 'MISSING_FIELD').length, 4);
  });
  test('structural V2 failures throw LoadCalcEnvelopeError (no result), including non-JSON values, unknown keys and contradictory supply', () => {
    const b0 = LC82.cases.find((c) => c.id === 'LC82-B0P').request;
    const bad = [
      (r) => { r.snapshot.loads[0].rating.value = NaN; }, (r) => { r.snapshot.loads[0].rating.value = undefined; }, (r) => { r.extra = 1; }, (r) => { r.snapshot.supply.wires = 4; },
      (r) => { r.context.methodConfirmedAfterImport = 'yes'; }, (r) => { r.snapshot.loads[0].inclusion82 = { predicate: 'nope', answer: null, basis: null }; }, (r) => { r.snapshot.optional82.inventoryComplete.basis = { members: [{ id: 'L1' }] }; },
    ];
    for (const mut of bad) { const r = clone(b0); mut(r); assert.throws(() => F.evaluateV2(r), (e) => e.name === 'LoadCalcEnvelopeError' && e.code === 'SCHEMA_INVALID'); }
    assert.throws(() => F.evaluateV2(null), (e) => e.name === 'LoadCalcEnvelopeError');
  });
  test('engine identity: the facade never lets a request pick a profile or enable an arrangement', () => {
    const b0 = LC82.cases.find((c) => c.id === 'LC82-B0P').request;
    const r = clone(b0); r.profileId = 'B82_core1'; assert.throws(() => F.evaluateV2(r), (e) => e.name === 'LoadCalcEnvelopeError');
    const s = clone(b0); s.snapshot.hvac.arrangement = 'none'; const out = F.evaluateV2(s); assert.strictEqual(out.result.status, 'UNSUPPORTED_SCOPE');
    assert.deepStrictEqual(B82.PROFILE_82.enabledArrangements, ['ac_only']); assert.ok(Object.isFrozen(B82.PROFILE_82));
  });
});
