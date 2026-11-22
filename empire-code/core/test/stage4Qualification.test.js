'use strict';
/**
 * STAGE4 — qualification workflow for a NEW design (docs/stage4-qualification-contract.md).
 *
 * Authored for coordinator execution; no worker test run is claimed.
 * Requests are the real LC82 fixtures (test/fixtures/loadCalc/LC82-cases-r1.json) or explicit edits of LC82-B0P; drafts, the
 * lcv-3 payload and the v1 record come from the accepted public State/Storage/Record APIs. Expected sizes and ampacities are
 * hand-written literals from the audit table (G-02) and Tables 310.16 (75 °C) / 310.12, never read back from the module tables.
 * The ordinary evaluator is the oracle for the preliminary arithmetic: the preliminary route must reproduce it, not restate it.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V2 = require('../src/calc/loadCalcInputV2.js');
const B82 = require('../src/calc/loadCalcOpt82.js');
const F = require('../src/calc/loadCalcFacade.js');
const S = require('../src/calc/loadCalcServiceSizing.js');
const State = require('../src/calc/loadCalcStateV2.js');
const Record = require('../src/calc/loadCalcServiceRecord.js');
const { deepFreeze, clone } = require('./helpers/loadCalcFixtures.js');

const ROOT = path.join(__dirname, '..');
const LC82 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'LC82-cases-r1.json'), 'utf8'));
const caseReq = (id) => { const c = LC82.cases.find((x) => x.id === id); assert.ok(c, `fixture ${id}`); return clone(c.request); };
const AMP_PATH = 'optional82.conductorAmpacityA.value';
const amp = (req) => req.snapshot.optional82.conductorAmpacityA;
/** B0 exactly as accepted (declared 200 A). */
const B0 = () => caseReq('LC82-B0P');
/** B0 with the caller's own declaration set to `a`. */
const B0declared = (a) => { const r = B0(); amp(r).value = a; return r; };
/** The new-design request: B0 whose conductor ampacity is a well-formed unknown. */
const B0unknown = (edit) => { const r = B0declared(null); if (edit) edit(r); return r; };

const PLAN = { intent: 'new_design_candidate', oneMainDisconnect: true, noAdditionalSources: true, wholeDwelling: true, singleConductorSet: true };
const COND = { sizingPath: 'general_table_75C', material: 'Cu', terminationTempRatingC: 75, terminationMaterialCompatible: true, insulationTempRatingC: 75, ambientTempC: 30, currentCarryingConductors: 3, wiringMethod: 'single_insulated_conductors_in_raceway', noOtherAdjustmentOrCorrection: true };
const design = (selected, condPatch, planPatch) => ({ selectedMainRatingA: selected, plan: Object.assign({}, PLAN, planPatch || {}), conductor: Object.assign({}, COND, condPatch || {}) });
const DWELLING = { sizingPath: 'dwelling_83pct_310_12' };

const ORDINARY_RESULT_KEYS = ['schemaVersion', 'ruleBasis', 'profileId', 'status', 'problems', 'loadsCoverage', 'demand', 'current', 'existingCapacity', 'requiredCapacity', 'rating', 'diagnostics', 'display', 'presentation', 'references'];
const ORDINARY_FACADE_KEYS = ['apiVersion', 'capabilityProfile', 'engine', 'engineProfileId', 'engineRuleStatus', 'importGuard'];
const ORDINARY_ANALYSIS_KEYS = ['prototypeId', 'operative', 'ruleReview', 'installationApproved', 'globalCodeCompliance', 'sourceReview', 'status', 'calcBasis', 'qualificationEcho', 'minimumService', 'chosenMain', 'ungroundedConductors', 'designProblems', 'remainingChecks'];
const B0_VA = 23680; const B0_E4 = 236800000; const B0_A = 23680 / 240;   // 98.666… A

const flagsFalse = (x) => {
  assert.equal(x.operative, false); assert.equal(x.installationApproved, false); assert.equal(x.globalCodeCompliance, 'not_verified');
  const json = JSON.stringify(x);
  assert.ok(!json.includes('"operative":true') && !json.includes('"installationApproved":true') && !json.includes('"globalCodeCompliance":"verified"') && !json.includes('"installationApproval":"approved"'));
};
const codeAt = (problems) => problems.map((p) => `${p.code}@${p.field}`);
const stageCodes = (stage) => stage.reasons.map((r) => r.code);
const qc = (a) => a.ungroundedConductors.qualificationConsistency;

/** Preliminary analysis on frozen inputs: never mutates, always frozen, always a preliminary kind with false prototype flags. */
function preliminary(request, des) {
  const req = deepFreeze(request); const d = des === undefined ? undefined : deepFreeze(des);
  const before = JSON.stringify(req); const dBefore = JSON.stringify(d);
  const p = S.analyzePreliminaryPrototype(req, d);
  assert.equal(p.kind, S.PRELIMINARY_ANALYSIS_KIND); assert.ok(Object.values(S.PRELIMINARY_ANALYSIS_STATUS).includes(p.status), p.status);
  assert.notEqual(p.status, 'EVALUATED'); assert.notEqual(p.status, 'DESIGN_INVALID');
  assert.equal(p.fullResultRecordEligible, false); assert.ok(Object.isFrozen(p) && Object.isFrozen(p.ungroundedConductors) && Object.isFrozen(p.adoption));
  flagsFalse(p);
  // a preliminary analysis never offers a selection, whatever the inputs
  assert.equal(p.ungroundedConductors.recommendationAvailable, false); assert.equal(p.ungroundedConductors.size, null);
  assert.notEqual(p.ungroundedConductors.status, 'experimental_candidate');
  if (qc(p)) { assert.notEqual(qc(p).status, 'premise_unchanged'); assert.equal(qc(p).declaredQualificationAmpacityA, null); }
  assert.equal(p.qualificationPending, p.status === S.PRELIMINARY_ANALYSIS_STATUS.EVALUATED);
  assert.equal(p.deferredConditions.length, p.qualificationPending ? 1 : 0);
  assert.equal(typeof p.nextAction.code, 'string'); assert.ok(p.nextAction.message.length > 0);
  assert.equal(JSON.stringify(req), before, 'request not mutated'); assert.equal(JSON.stringify(d), dBefore, 'design not mutated');
  return p;
}
const confirmFor = (p, patch) => Object.assign({ action: S.ADOPTION_CONFIRMATION_ACTION, expectedFingerprint: p.binding ? p.binding.fingerprint : null, expectedAmpacityA: p.adoption.candidateAmpacityA }, patch || {});
/** Adoption on frozen inputs: never mutates; a refusal carries no request/response/analysis. */
function adopt(args) {
  const frozen = deepFreeze(args); const before = JSON.stringify(frozen);
  const r = S.adoptPlannedConductorDeclaration(frozen);
  assert.equal(JSON.stringify(frozen), before, 'adoption arguments not mutated');
  assert.equal(r.kind, S.ADOPTION_KIND); assert.ok(Object.isFrozen(r)); flagsFalse(r);
  assert.equal(r.adopted, r.status === S.ADOPTION_STATUS.ADOPTED);
  if (!r.adopted) {
    assert.equal(r.status, S.ADOPTION_STATUS.REFUSED);
    for (const k of ['after', 'plannedDeclaration', 'provenanceNote', 'adoptedRequest', 'response', 'analysis', 'recheck']) assert.equal(r[k], null, k);
    assert.equal(r.reasons.length, 1); assert.ok(r.nextAction.message.length > 0);
  }
  return r;
}
const refusedWith = (r, code) => { assert.equal(r.adopted, false); assert.equal(r.reasons[0].code, code, JSON.stringify(r.reasons)); };

describe('STAGE4 — the ordinary route is unchanged', () => {
  test('B0 through the ordinary facade: same key sets, COMPLETE, 23680 VA / 98.666… A; no preliminary marker leaks in', () => {
    const out = F.evaluateV2(deepFreeze(B0()));
    assert.deepEqual(Object.keys(out), ['facade', 'result']); assert.deepEqual(Object.keys(out.facade), ORDINARY_FACADE_KEYS); assert.deepEqual(Object.keys(out.result), ORDINARY_RESULT_KEYS);
    assert.equal(out.result.status, 'COMPLETE'); assert.equal(out.result.demand.totalVA, B0_VA); assert.equal(out.result.demand.totalExactE4, B0_E4); assert.equal(out.result.current.lineA, B0_A);
    assert.equal(out.result.display.strings.lineA, '98.7 A'); assert.equal(out.result.presentation.finalResultHeading, true);
    assert.ok(!JSON.stringify(out).includes('PRELIMINARY'));
    assert.deepEqual(out.result, B82.evaluate82(V2.toEnvelope82(B0())), 'the facade is still the direct engine result');
  });
  test('an unknown ampacity is still refused by the ordinary facade and the ordinary analysis (no silent preliminary)', () => {
    const req = deepFreeze(B0unknown()); const out = F.evaluateV2(req);
    assert.deepEqual(Object.keys(out.result), ORDINARY_RESULT_KEYS);
    assert.equal(out.result.status, 'INCOMPLETE_INPUT'); assert.deepEqual(codeAt(out.result.problems), ['QUALIFICATION_UNKNOWN@optional82.conductorAmpacityA']);
    assert.equal(out.result.demand.totalVA, null); assert.equal(out.result.current.lineA, null); assert.deepEqual(out.result.demand.lines, []);
    const a = S.analyzePrototype(req, design(200, DWELLING));
    assert.deepEqual(Object.keys(a), ORDINARY_ANALYSIS_KEYS); assert.equal(a.status, 'EVALUATED');
    assert.equal(a.minimumService.status, 'unsupported'); assert.deepEqual(stageCodes(a.minimumService), ['CALC_NOT_COMPLETE']);
    assert.equal(a.ungroundedConductors.tableCandidate, null); assert.equal(a.qualificationEcho.conductorAmpacityA, null);
  });
  test('audit table G-02 through the ordinary analysis: 200/200 general Cu, 200/200 dwelling Cu, 175/200 dwelling Cu, 200/100 dwelling Cu and Al', () => {
    const rows = [
      [200, 200, {}, '3/0', 200, 'premise_unchanged', true],
      [200, 200, DWELLING, '2/0', 175, 'revalidation_required', false],
      [175, 200, DWELLING, '2/0', 175, 'premise_unchanged', true],
      [200, 100, DWELLING, '4', 85, 'review_required', false],
      [200, 100, Object.assign({ material: 'Al' }, DWELLING), '2', 90, 'review_required', false],
    ];
    for (const [declared, main, cond, size, ampacity, status, available] of rows) {
      const a = S.analyzePrototype(deepFreeze(B0declared(declared)), deepFreeze(design(main, cond)));
      assert.deepEqual(Object.keys(a), ORDINARY_ANALYSIS_KEYS); assert.equal(a.status, 'EVALUATED'); flagsFalse(a);
      assert.equal(a.calcBasis.calcStatus, 'COMPLETE'); assert.equal(a.calcBasis.totalVA, B0_VA); assert.equal(a.calcBasis.lineA, B0_A);
      const u = a.ungroundedConductors;
      assert.equal(u.tableCandidate.size, size); assert.equal(u.tableCandidate.ampacity75CA, ampacity);
      assert.equal(qc(a).status, status); assert.equal(qc(a).declaredQualificationAmpacityA, declared); assert.equal(qc(a).candidateTableAmpacity75CA, ampacity);
      assert.equal(u.recommendationAvailable, available); assert.equal(u.size, available ? size : null);
      assert.equal(Object.hasOwn(u, 'preliminary'), false); assert.equal(Object.hasOwn(a.minimumService, 'conditionalOn'), false);
    }
  });
});

describe('STAGE4 — preliminary calculation: only a well-formed unknown conductor ampacity is deferred', () => {
  test('B0 with unknown ampacity: 23680 VA / 98.666… A from the shared stages, original ampacity still null, never COMPLETE or approved', () => {
    const req = deepFreeze(B0unknown()); const before = JSON.stringify(req);
    const out = F.evaluatePreliminaryV2(req); const r = out.result;
    assert.equal(JSON.stringify(req), before); assert.equal(amp(req).value, null);
    assert.equal(out.facade.resultKind, 'B82_PRELIMINARY_NEW_DESIGN'); assert.equal(r.kind, 'B82_PRELIMINARY_NEW_DESIGN');
    assert.equal(r.status, 'PRELIMINARY_QUALIFICATION_PENDING'); assert.equal(r.blockingStatus, null);
    assert.ok(!JSON.stringify(out).includes('"COMPLETE"'), 'the ordinary COMPLETE status appears nowhere in a preliminary pair');
    assert.equal(r.ordinaryResult, false); assert.equal(r.qualificationEstablished, false); assert.equal(r.operative, false);
    for (const k of ['existingCapacity', 'requiredCapacity', 'rating']) assert.equal(Object.hasOwn(r, k), false, k);
    assert.equal(r.presentation.finalResultHeading, false); assert.equal(r.presentation.verdictLabel, null);
    assert.equal(r.demand.totalVA, B0_VA); assert.equal(r.demand.totalExactE4, B0_E4); assert.equal(r.current.status, 'computed'); assert.equal(r.current.lineA, B0_A);
    assert.equal(r.display.strings.totalVA, '23,680 VA'); assert.equal(r.display.strings.lineA, '98.7 A');
    assert.deepEqual(r.problems, []);
    assert.equal(r.deferred.length, 1);
    assert.equal(r.deferred[0].code, 'CONDUCTOR_AMPACITY_QUALIFICATION_DEFERRED'); assert.equal(r.deferred[0].deferredEngineCode, 'QUALIFICATION_UNKNOWN');
    assert.equal(r.deferred[0].field, 'optional82.conductorAmpacityA'); assert.equal(r.deferred[0].ruleRef, '220.82(A)'); assert.equal(r.deferred[0].gateMinA, 100);
    assert.equal(r.nextAction.code, 'ESTABLISH_CONDUCTOR_AMPACITY'); assert.ok(Object.isFrozen(r) && Object.isFrozen(r.demand));
    // the arithmetic is the ordinary engine's own: identical graph, coverage and current to the same request declared at 200 A
    const ordinary = F.evaluateV2(B0()).result;
    assert.deepEqual(r.demand, ordinary.demand); assert.deepEqual(r.current, ordinary.current); assert.deepEqual(r.loadsCoverage, ordinary.loadsCoverage); assert.deepEqual(r.diagnostics, ordinary.diagnostics);
  });

  test('every accepted LC82 fixture: the preliminary route is pending exactly when the ordinary route (same request, declared 200 A) is COMPLETE, with identical outputs; otherwise it is blocked with the ordinary refusal and problems', () => {
    let pendingSeen = 0; let blockedSeen = 0; const classes = new Set();
    for (const c of LC82.cases.filter((x) => x.kind !== 'L2')) {
      const declaredReq = clone(c.request); amp(declaredReq).value = 200;
      const unknownReq = clone(c.request); amp(unknownReq).value = null;
      const rs = c.assumptions.engineRuleStatus;
      const ordinary = (rs === 'default' ? B82.evaluate82 : B82.TEST_ONLY.createPendingSourceEvaluator(rs))(V2.toEnvelope82(declaredReq));
      const p = (rs === 'default' ? B82.evaluatePreliminary82 : B82.TEST_ONLY.createPendingSourcePreliminaryEvaluator(rs))(V2.toEnvelope82(deepFreeze(unknownReq)));
      assert.equal(p.kind, 'B82_PRELIMINARY_NEW_DESIGN', c.id); assert.notEqual(p.status, 'COMPLETE', c.id);
      assert.deepEqual(p.problems, ordinary.problems, c.id); assert.deepEqual(p.loadsCoverage, ordinary.loadsCoverage, c.id);
      assert.deepEqual(p.demand, ordinary.demand, c.id); assert.deepEqual(p.current, ordinary.current, c.id); assert.deepEqual(p.display.strings, ordinary.display.strings, c.id);
      if (ordinary.status === 'COMPLETE') {
        pendingSeen++; assert.equal(p.status, 'PRELIMINARY_QUALIFICATION_PENDING', c.id); assert.equal(p.blockingStatus, null, c.id); assert.equal(p.deferred.length, 1, c.id);
        assert.ok(!c.request.parseErrors.some((pe) => pe.field === AMP_PATH), c.id);
      } else {
        blockedSeen++; classes.add(ordinary.status);
        assert.equal(p.status, 'PRELIMINARY_BLOCKED', c.id); assert.equal(p.blockingStatus, ordinary.status, c.id); assert.deepEqual(p.deferred, [], c.id);
      }
    }
    assert.ok(pendingSeen >= 1, 'at least B0 is pending'); assert.ok(blockedSeen >= 5, `blocked fixtures: ${blockedSeen}`); assert.ok(classes.size >= 2, [...classes].join(','));
  });

  const BLOCKERS = [
    ['single supply set unknown', (r) => { r.snapshot.optional82.singleSupplySet.value = null; }, 'INCOMPLETE_INPUT', 'QUALIFICATION_UNKNOWN@optional82.singleSupplySet'],
    ['single supply set denied', (r) => { r.snapshot.optional82.singleSupplySet.value = false; }, 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED@optional82.singleSupplySet'],
    ['inventory unanswered', (r) => { r.snapshot.optional82.inventoryComplete = { value: null, provenance: { source: 'designer_declaration', note: null }, basis: null }; }, 'INCOMPLETE_INPUT', 'MISSING_FIELD@optional82.inventoryComplete'],
    ['inventory declared incomplete', (r) => { r.snapshot.optional82.inventoryComplete.value = false; }, 'INCOMPLETE_INPUT', 'INVENTORY_INCOMPLETE_DECLARED@optional82.inventoryComplete'],
    ['inventory stale', (r) => { r.snapshot.optional82.inventoryComplete.basis.members.pop(); }, 'INCOMPLETE_INPUT', 'PREMISE_STALE@optional82.inventoryComplete'],
    ['pending source rule (laundry count 0, I-82-2)', (r) => { r.snapshot.dwelling.laundryCircuits = 0; }, 'BLOCKED_PENDING_RULE', 'RULE_PENDING@dwelling.laundryCircuits'],
    ['pending source rule (NYC A/C circuits, I-82-1)', (r) => { r.snapshot.dwelling.nycAcCircuitCount = 1; }, 'BLOCKED_PENDING_RULE', 'RULE_PENDING@dwelling.nycAcCircuitCount'],
    ['malformed raw ampacity (parser NOT_FINITE)', (r) => { r.parseErrors.push({ field: AMP_PATH, raw: '2oo', code: 'NOT_FINITE' }); }, 'INVALID_INPUT', `NOT_FINITE@${AMP_PATH}`],
    ['rejected raw ampacity (parser PARSE_REJECTED)', (r) => { r.parseErrors.push({ field: AMP_PATH, raw: '1e999', code: 'PARSE_REJECTED' }); }, 'INVALID_INPUT', `PARSE_REJECTED@${AMP_PATH}`],
    ['HVAC arrangement missing', (r) => { r.snapshot.hvac.arrangement = null; }, 'INCOMPLETE_INPUT', 'MISSING_FIELD@hvac.arrangement'],
    ['unsupported HVAC arrangement', (r) => { r.snapshot.hvac.arrangement = 'heat_pump_with_supplemental'; }, 'UNSUPPORTED_SCOPE', 'CAPABILITY_DISABLED@hvac.arrangement'],
    ['occupancy out of scope', (r) => { r.snapshot.occupancy = 'nondwelling'; }, 'UNSUPPORTED_SCOPE', 'SCOPE_UNSUPPORTED@occupancy'],
    ['another method (no preliminary 220.87 route)', (r) => { r.snapshot.method.selected = 'measured_220_87'; }, 'UNSUPPORTED_SCOPE', 'CAPABILITY_DISABLED@method.selected'],
    ['imported method not confirmed', (r) => { r.context = { importedFrom: { lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' }, methodConfirmedAfterImport: false }; }, 'INCOMPLETE_INPUT', 'IMPORTED_METHOD_UNCONFIRMED@method.selected'],
    ['invalid load rating', (r) => { r.snapshot.loads[0].rating.value = -1; }, 'INVALID_INPUT', 'OUT_OF_RANGE@loads[0].rating.value'],
    ['floor area missing', (r) => { r.snapshot.dwelling.floorAreaFt2 = null; }, 'INCOMPLETE_INPUT', 'MISSING_FIELD@dwelling.floorAreaFt2'],
  ];
  for (const [name, edit, blockingStatus, problem] of BLOCKERS) {
    test(`unknown ampacity + ${name} → blocked (${blockingStatus}); nothing is deferred and no candidate is produced`, () => {
      const req = B0unknown(edit);
      assert.equal(F.evaluateV2(clone(req)).result.status === 'COMPLETE', false, 'not an ordinary COMPLETE either');
      const r = F.evaluatePreliminaryV2(deepFreeze(req)).result;
      assert.equal(r.status, 'PRELIMINARY_BLOCKED'); assert.equal(r.blockingStatus, blockingStatus); assert.deepEqual(r.deferred, []);
      assert.ok(codeAt(r.problems).includes(problem), codeAt(r.problems).join(' '));
      assert.equal(r.demand.totalVA, null); assert.equal(r.demand.totalExactE4, null); assert.equal(r.current.lineA, null); assert.equal(r.nextAction.code, 'RESOLVE_BLOCKERS');
      const p = preliminary(req, design(200, DWELLING));
      assert.equal(p.status, 'PRELIMINARY_BLOCKED'); assert.equal(p.calcBasis.totalVA, null); assert.equal(p.calcBasis.lineA, null);
      assert.equal(p.minimumService.status, 'unsupported'); assert.ok(stageCodes(p.minimumService).includes('PRELIMINARY_CALC_NOT_READY')); assert.equal(p.minimumService.ratingA, null);
      assert.equal(p.chosenMain.status, 'not_evaluated'); assert.equal(p.ungroundedConductors.status, 'not_evaluated'); assert.equal(p.ungroundedConductors.tableCandidate, null);
      assert.equal(p.adoption.available, false); assert.equal(p.nextAction.code, 'RESOLVE_CALCULATION_BLOCKERS');
      refusedWith(adopt({ request: req, design: design(200, DWELLING), preliminary: p, confirmation: confirmFor(p, { expectedAmpacityA: 175 }) }), 'PRELIMINARY_NOT_ADOPTABLE');
    });
  }
  test('a raw parser error on the ampacity field stays a parser problem: it is never turned into the allowed unknown', () => {
    const r = F.evaluatePreliminaryV2(B0unknown((q) => { q.parseErrors.push({ field: AMP_PATH, raw: '17 5', code: 'NOT_FINITE' }); })).result;
    const hit = r.problems.find((x) => x.field === AMP_PATH);
    assert.equal(hit.source, 'parser'); assert.equal(hit.layer, 'input'); assert.ok(!JSON.stringify(r).includes('CONDUCTOR_AMPACITY_QUALIFICATION_DEFERRED'));
  });
  test('a pending core source rule blocks the preliminary route as well (test-only, non-escalating configuration)', () => {
    for (const cfg of [{ '220.82': 'pending' }, { 'S-11a': 'pending' }]) {
      const r = B82.TEST_ONLY.createPendingSourcePreliminaryEvaluator(cfg)(V2.toEnvelope82(B0unknown()));
      assert.equal(r.status, 'PRELIMINARY_BLOCKED'); assert.equal(r.blockingStatus, 'BLOCKED_PENDING_RULE'); assert.ok(r.problems.some((x) => x.code === 'RULE_PENDING')); assert.equal(r.demand.totalVA, null);
    }
    assert.throws(() => B82.TEST_ONLY.createPendingSourcePreliminaryEvaluator({ 'I-82-1': 'verified' }), /may only make/);
    assert.throws(() => B82.TEST_ONLY.createPendingSourcePreliminaryEvaluator({ '220.82': 'verified' }), /never an escalation/);
  });
  test('an ampacity VALUE (adequate, below the gate, or not encodable) is never deferred: the preliminary route does not apply', () => {
    for (const value of [200, 175, 100, 99, 99.999, 0]) {
      const req = B0declared(value); const r = F.evaluatePreliminaryV2(deepFreeze(req)).result;
      assert.equal(r.status, 'PRELIMINARY_NOT_APPLICABLE', String(value)); assert.deepEqual(r.deferred, []); assert.equal(r.demand.totalVA, null); assert.equal(r.current.lineA, null);
      assert.equal(r.nextAction.code, 'USE_ORDINARY_CALCULATION'); assert.equal(amp(req).value, value);
      const p = preliminary(req, design(200, DWELLING));
      assert.equal(p.status, 'PRELIMINARY_NOT_APPLICABLE'); assert.equal(p.qualificationEcho.conductorAmpacityA, value); assert.equal(p.ungroundedConductors.tableCandidate, null);
      assert.equal(p.adoption.available, false); assert.equal(p.nextAction.code, 'USE_ORDINARY_ANALYSIS');
    }
  });
  test('a structurally invalid request throws at the preliminary facade exactly like the ordinary one', () => {
    const bad = B0unknown(); bad.displayedA = 98.7;
    assert.throws(() => F.evaluatePreliminaryV2(bad), (e) => e.name === 'LoadCalcEnvelopeError');
    assert.throws(() => F.evaluatePreliminaryV2(null), (e) => e.name === 'LoadCalcEnvelopeError');
    const p = preliminary(bad, design(200));
    assert.equal(p.status, 'PRELIMINARY_REQUEST_INVALID'); assert.equal(p.binding, null); assert.equal(p.calcBasis, null); assert.equal(p.nextAction.code, 'FIX_REQUEST');
  });
});

describe('STAGE4 — preliminary service sizing: a CONDITIONAL candidate from the explicit plan, scope fidelity kept', () => {
  test('main 200 A, dwelling 310.12, Cu → conditional 2/0 at 175 A; selection withheld; qualification deferred; next action is the explicit confirmation', () => {
    const p = preliminary(B0unknown(), design(200, DWELLING));
    assert.equal(p.status, 'PRELIMINARY_EVALUATED'); assert.equal(p.qualificationPending, true);
    assert.equal(p.calcBasis.calcStatus, 'PRELIMINARY_QUALIFICATION_PENDING'); assert.equal(p.calcBasis.totalVA, B0_VA); assert.equal(p.calcBasis.totalExactE4, B0_E4); assert.equal(p.calcBasis.lineA, B0_A); assert.equal(p.calcBasis.lineADisplay, '98.7 A');
    assert.equal(p.qualificationEcho.conductorAmpacityA, null);
    assert.equal(p.minimumService.status, 'experimental_candidate'); assert.equal(p.minimumService.ratingA, 100); assert.equal(p.minimumService.governedBy, 'floor_100A');
    assert.equal(p.chosenMain.status, 'meets_prototype_minimum'); assert.equal(p.chosenMain.selectedRatingA, 200);
    for (const st of [p.minimumService, p.chosenMain, p.ungroundedConductors]) { assert.equal(st.preliminary, true); assert.deepEqual(st.conditionalOn, ['CONDUCTOR_AMPACITY_QUALIFICATION_DEFERRED']); }
    const u = p.ungroundedConductors;
    assert.equal(u.status, 'table_candidate_conditional'); assert.equal(u.tableCandidate.conditional, true); assert.equal(u.tableCandidate.table, 'Table 310.12');
    assert.equal(u.tableCandidate.material, 'Cu'); assert.equal(u.tableCandidate.size, '2/0'); assert.equal(u.tableCandidate.sizeUnit, 'AWG'); assert.equal(u.tableCandidate.ampacity75CA, 175); assert.equal(u.tableCandidate.forRatingA, 200);
    assert.equal(qc(p).status, 'deferred_pending_declaration'); assert.deepEqual(stageCodes(qc(p)), ['QUALIFICATION_DECLARATION_DEFERRED']); assert.equal(qc(p).candidateTableAmpacity75CA, 175); assert.equal(qc(p).b82SoftwareGateMinA, 100);
    assert.equal(p.deferredConditions[0].code, 'CONDUCTOR_AMPACITY_QUALIFICATION_DEFERRED'); assert.equal(p.deferredConditions[0].field, 'snapshot.optional82.conductorAmpacityA'); assert.deepEqual(p.deferredConditions[0].sections, ['220.82(A)']);
    assert.equal(p.preliminaryCalculation.status, 'PRELIMINARY_QUALIFICATION_PENDING'); assert.equal(p.preliminaryCalculation.deferred.length, 1);
    assert.deepEqual(Object.assign({}, p.adoption, { message: null }), { available: true, candidateAmpacityA: 175, code: 'PLANNED_DECLARATION_AVAILABLE', message: null, helper: 'adoptPlannedConductorDeclaration', requiresExplicitConfirmation: true, confirmationAction: 'ADOPT_PLANNED_CONDUCTOR_DECLARATION', b82SoftwareGateMinA: 100 });
    assert.equal(p.nextAction.code, 'CONFIRM_PLANNED_CONDUCTOR_DECLARATION');
    assert.match(p.binding.fingerprint, /^fp1-[0-9a-f]{16}-[0-9a-f]+$/); assert.match(p.binding.requestFingerprint, /^fp1-/); assert.match(p.binding.designFingerprint, /^fp1-/);
    // the conditional table candidate is the ordinary stage's own table fact for the same plan
    const ordinary = S.analyzePrototype(B0(), design(200, DWELLING));
    assert.deepEqual(u.tableCandidate, ordinary.ungroundedConductors.tableCandidate); assert.deepEqual(u.conditions, ordinary.ungroundedConductors.conditions);
    assert.deepEqual(Object.assign({}, p.minimumService, { preliminary: undefined, conditionalOn: undefined }), Object.assign({}, ordinary.minimumService, { preliminary: undefined, conditionalOn: undefined }));
    assert.deepEqual(p.sourceReview, ordinary.sourceReview); assert.deepEqual(p.remainingChecks, ordinary.remainingChecks);
  });
  test('main 200 A general Cu → conditional 3/0 at 200 A; main 110 A dwelling Cu #3 / Al #1 → 100 A, exactly at the gate, still conditional', () => {
    for (const [main, cond, size, ampacity] of [[200, {}, '3/0', 200], [110, DWELLING, '3', 100], [110, Object.assign({ material: 'Al' }, DWELLING), '1', 100]]) {
      const p = preliminary(B0unknown(), design(main, cond));
      assert.equal(p.status, 'PRELIMINARY_EVALUATED'); assert.equal(p.ungroundedConductors.tableCandidate.size, size); assert.equal(p.ungroundedConductors.tableCandidate.ampacity75CA, ampacity);
      assert.equal(qc(p).status, 'deferred_pending_declaration'); assert.equal(p.adoption.available, true); assert.equal(p.adoption.candidateAmpacityA, ampacity);
    }
  });
  test('scope fidelity is not deferred: purpose, occupancy, plan premises, chosen rating and conductor conditions still refuse or wait', () => {
    const variants = [
      [B0unknown((r) => { r.snapshot.purpose = 'feeder'; }), design(200, DWELLING), 'minimumService', 'unsupported', 'PURPOSE_UNSUPPORTED'],
      [B0unknown((r) => { r.snapshot.occupancy = 'dwelling_unit_apartment'; }), design(200, DWELLING), 'minimumService', 'unsupported', 'OCCUPANCY_UNSUPPORTED'],
      [B0unknown(), design(200, DWELLING, { singleConductorSet: false }), 'minimumService', 'unsupported', 'PARALLEL_SETS_UNSUPPORTED'],
      [B0unknown(), design(200, DWELLING, { noAdditionalSources: null }), 'minimumService', 'waiting_input', 'PREMISE_UNANSWERED'],
      [B0unknown(), design(200, DWELLING, { intent: 'existing_equipment_check' }), 'chosenMain', 'unsupported', 'INTENT_UNSUPPORTED'],
      [B0unknown(), design(null, DWELLING), 'chosenMain', 'waiting_input', 'SELECTED_RATING_MISSING'],
      [B0unknown((r) => { const l = r.snapshot.loads.find((x) => x.id === 'L5'); l.rating.value = 5320.01; l.ratingCoverage82.basis.rating.value = 5320.01; }), design(100, DWELLING), 'chosenMain', 'rejected_undersized', 'SELECTED_RATING_UNDERSIZED'],
      [B0unknown(), design(200, Object.assign({ ambientTempC: 35 }, DWELLING)), 'ungroundedConductors', 'unsupported', 'AMBIENT_UNSUPPORTED'],
      [B0unknown(), design(200, Object.assign({ terminationTempRatingC: 60 }, DWELLING)), 'ungroundedConductors', 'unsupported', 'TERMINATION_60C_UNSUPPORTED'],
      [B0unknown(), design(200, Object.assign({ material: null }, DWELLING)), 'ungroundedConductors', 'waiting_input', 'PREMISE_UNANSWERED'],
      [B0unknown(), design(200, { sizingPath: null }), 'ungroundedConductors', 'waiting_input', 'PREMISE_UNANSWERED'],
    ];
    for (const [req, des, stage, status, code] of variants) {
      const p = preliminary(req, des);
      assert.equal(p.status, 'PRELIMINARY_EVALUATED', code); assert.equal(p[stage].status, status, code); assert.ok(stageCodes(p[stage]).includes(code), stageCodes(p[stage]).join(','));
      assert.equal(p.ungroundedConductors.tableCandidate, null, code); assert.equal(p.adoption.available, false); assert.equal(p.adoption.code, 'NO_CONDITIONAL_CANDIDATE');
      assert.equal(p.nextAction.code, 'COMPLETE_SERVICE_DESIGN_INPUT');
      refusedWith(adopt({ request: req, design: des, preliminary: p, confirmation: confirmFor(p, { expectedAmpacityA: 175 }) }), 'NO_CONDITIONAL_CANDIDATE');
    }
  });
  test('an invalid or forged design is refused as a preliminary design error; no key can claim the qualification', () => {
    for (const des of [Object.assign(design(200, DWELLING), { conductorAmpacityA: 175 }), Object.assign(design(200, DWELLING), { qualificationRevalidated: true }), design(200, Object.assign({ ampacity75CA: 300 }, DWELLING)), design(200, DWELLING, { interpretationAccepted: true }), design('200', DWELLING)]) {
      const p = preliminary(B0unknown(), des);
      assert.equal(p.status, 'PRELIMINARY_DESIGN_INVALID'); assert.ok(p.designProblems.length > 0); assert.equal(p.binding, null);
      assert.equal(p.minimumService.status, 'not_computed'); assert.equal(p.ungroundedConductors.tableCandidate, null); assert.equal(p.nextAction.code, 'FIX_DESIGN_INPUT');
    }
  });
  test('main 100 A, dwelling 310.12: Cu #4 / 85 A and Al #2 / 90 A stay an open review — never raised to 100 A, never called prohibited, never adoptable', () => {
    for (const [material, size, ampacity] of [['Cu', '4', 85], ['Al', '2', 90]]) {
      const req = B0unknown(); const des = design(100, Object.assign({ material }, DWELLING));
      const p = preliminary(req, des); const u = p.ungroundedConductors;
      assert.equal(p.status, 'PRELIMINARY_EVALUATED'); assert.equal(u.status, 'table_candidate_conditional');
      assert.equal(u.tableCandidate.size, size); assert.equal(u.tableCandidate.ampacity75CA, ampacity); assert.equal(u.tableCandidate.eightyThreePercentCheck.satisfied, true);
      assert.equal(qc(p).status, 'review_required'); assert.deepEqual(stageCodes(qc(p)), ['B82_310_12_INTERPRETATION_PENDING']);
      assert.equal(qc(p).candidateTableAmpacity75CA, ampacity); assert.equal(qc(p).declaredQualificationAmpacityA, null);
      assert.match(qc(p).reasons[0].message, /not a finding against 310\.12 use/); assert.match(qc(p).reasons[0].message, /no value is substituted/);
      assert.equal(p.adoption.available, false); assert.equal(p.adoption.code, 'CANDIDATE_BELOW_B82_GATE_REVIEW_REQUIRED'); assert.equal(p.adoption.candidateAmpacityA, ampacity);
      assert.equal(p.nextAction.code, 'INTERPRETATION_REVIEW_REQUIRED'); assert.match(p.nextAction.message, /documented interpretation\/model decision/);
      assert.ok(!/prohibit|not permitted|violation/i.test(JSON.stringify([u, p.adoption, p.nextAction, p.deferredConditions])), 'no finding against 310.12');
      for (const claimed of [ampacity, 100, 200]) {
        const r = adopt({ request: req, design: des, preliminary: p, confirmation: confirmFor(p, { expectedAmpacityA: claimed }) });
        refusedWith(r, 'CANDIDATE_BELOW_B82_GATE_REVIEW_REQUIRED'); assert.equal(r.nextAction.code, 'INTERPRETATION_REVIEW_REQUIRED'); assert.equal(r.before.conductorAmpacityA.value, null);
      }
      assert.equal(amp(req).value, null);
    }
  });
});

describe('STAGE4 — explicit adoption of a planned conductor declaration and the ordinary recheck', () => {
  const reviewed = (cond) => { const request = B0unknown(); const des = design(200, cond === undefined ? DWELLING : cond); return { request, design: des, preliminary: preliminary(request, des) }; };

  test('Cu 175 A / main 200 A dwelling: explicit confirmation → planned 175 A, ordinary facade COMPLETE 23680 VA, premise unchanged, prototype flags still false', () => {
    const ctx = reviewed(); const p = ctx.preliminary; const originalText = JSON.stringify(ctx.request);
    const r = adopt({ request: ctx.request, design: ctx.design, preliminary: p, confirmation: confirmFor(p) });
    assert.equal(r.status, 'ADOPTED_AND_RECHECKED'); assert.equal(r.adopted, true);
    assert.equal(JSON.stringify(ctx.request), originalText); assert.equal(amp(ctx.request).value, null, 'the original input object is unchanged');
    // before / after and the documented provenance (existing source enum + note; no new schema)
    assert.deepEqual(r.before.conductorAmpacityA, { value: null, provenance: { source: 'designer_declaration', note: null } });
    assert.equal(r.before.preliminaryFingerprint, p.binding.fingerprint); assert.equal(r.before.requestFingerprint, p.binding.requestFingerprint); assert.equal(r.before.totalVA, B0_VA);
    assert.equal(r.after.conductorAmpacityA.value, 175); assert.equal(r.after.conductorAmpacityA.provenance.source, 'designer_declaration');
    const note = r.after.conductorAmpacityA.provenance.note;
    assert.equal(note, r.provenanceNote); assert.ok(note.startsWith('PLANNED_NEW_DESIGN_CONDUCTOR/1:'));
    for (const part of ['not inspected, not installed', 'Table 310.12', '200 A service rating', 'Cu 2/0 AWG', '175 A', p.binding.fingerprint]) assert.ok(note.includes(part), part);
    assert.equal(S.isPlannedConductorDeclaration(r.after.conductorAmpacityA), true); assert.equal(S.isPlannedConductorDeclaration(amp(B0())), false); assert.equal(S.isPlannedConductorDeclaration(r.before.conductorAmpacityA), false);
    assert.notEqual(r.after.requestFingerprint, r.before.requestFingerprint);
    assert.deepEqual(r.plannedDeclaration.candidate, { method: 'dwelling_83pct_310_12', table: 'Table 310.12', forRatingA: 200, material: 'Cu', size: '2/0', sizeUnit: 'AWG', ampacity75CA: 175 });
    assert.equal(r.plannedDeclaration.declarationKind, 'planned_new_design_conductor'); assert.equal(r.plannedDeclaration.inspectedOrInstalledFact, false); assert.equal(r.plannedDeclaration.ampacityA, 175);
    // the adopted request is the original with exactly that one declaration replaced, and it passes the accepted V2 boundary
    assert.deepEqual(V2.validateRequestV2(clone(r.adoptedRequest)), []);
    const reverted = clone(r.adoptedRequest); reverted.snapshot.optional82.conductorAmpacityA = clone(amp(ctx.request)); assert.deepEqual(reverted, clone(ctx.request));
    // response and analysis are the ORDINARY outputs for that request — recomputed here independently
    const response = F.evaluateV2(clone(r.adoptedRequest)); const analysis = S.analyzePrototype(clone(r.adoptedRequest), clone(ctx.design));
    assert.deepEqual(clone(r.response), clone(response)); assert.equal(JSON.stringify(r.analysis), JSON.stringify(analysis));
    assert.deepEqual(Object.keys(r.response.result), ORDINARY_RESULT_KEYS); assert.deepEqual(Object.keys(r.response.facade), ORDINARY_FACADE_KEYS); assert.deepEqual(Object.keys(r.analysis), ORDINARY_ANALYSIS_KEYS);
    assert.equal(r.response.result.status, 'COMPLETE'); assert.equal(r.response.result.demand.totalVA, B0_VA); assert.equal(r.response.result.demand.totalExactE4, B0_E4); assert.equal(r.response.result.current.lineA, B0_A);
    assert.equal(r.analysis.status, 'EVALUATED'); assert.equal(r.analysis.qualificationEcho.conductorAmpacityA, 175);
    assert.equal(qc(r.analysis).status, 'premise_unchanged'); assert.equal(qc(r.analysis).declaredQualificationAmpacityA, 175); assert.equal(qc(r.analysis).candidateTableAmpacity75CA, 175);
    assert.equal(r.analysis.ungroundedConductors.tableCandidate.size, '2/0'); assert.equal(r.analysis.ungroundedConductors.status, 'experimental_candidate');
    flagsFalse(r.analysis); assert.equal(r.analysis.sourceReview.closed, false); assert.equal(r.analysis.sourceReview.installationApproval, 'not_approved');
    assert.deepEqual(r.recheck, { calcStatus: 'COMPLETE', totalVA: B0_VA, totalExactE4: B0_E4, lineA: B0_A, totalUnchangedFromPreliminary: true, analysisStatus: 'EVALUATED', qualificationStatus: 'premise_unchanged', declaredQualificationAmpacityA: 175, candidateUnchangedFromPreliminary: true, recommendationAvailable: true });
    assert.equal(r.after.qualificationStatus, 'premise_unchanged'); assert.equal(r.after.totalVA, B0_VA); assert.equal(r.nextAction.code, 'APPLY_ADOPTED_DECLARATION_TO_DRAFT');
    // after adoption the preliminary route no longer applies to the new request, and the declaration is not overwritten again
    assert.equal(preliminary(clone(r.adoptedRequest), ctx.design).status, 'PRELIMINARY_NOT_APPLICABLE');
    refusedWith(adopt({ request: clone(r.adoptedRequest), design: ctx.design, preliminary: p, confirmation: confirmFor(p) }), 'EXISTING_CONDUCTOR_DECLARATION_NOT_REPLACED');
  });
  test('a JSON copy of the reviewed preliminary result is accepted; general 200 A Cu adopts 200 A (3/0); 110 A dwelling Cu adopts exactly 100 A', () => {
    const a = reviewed(); const ra = adopt({ request: a.request, design: a.design, preliminary: clone(a.preliminary), confirmation: confirmFor(a.preliminary) });
    assert.equal(ra.adopted, true); assert.equal(ra.after.conductorAmpacityA.value, 175);
    const g = reviewed({}); const rg = adopt({ request: g.request, design: g.design, preliminary: g.preliminary, confirmation: confirmFor(g.preliminary) });
    assert.equal(rg.adopted, true); assert.equal(rg.after.conductorAmpacityA.value, 200); assert.equal(rg.analysis.ungroundedConductors.size, '3/0'); assert.ok(rg.provenanceNote.includes('Table 310.16 (75 °C column)'));
    const req = B0unknown(); const des = design(110, DWELLING); const p = preliminary(req, des);
    const rt = adopt({ request: req, design: des, preliminary: p, confirmation: confirmFor(p) });
    assert.equal(rt.adopted, true); assert.equal(rt.after.conductorAmpacityA.value, 100); assert.equal(rt.response.result.status, 'COMPLETE'); assert.equal(qc(rt.analysis).status, 'premise_unchanged'); flagsFalse(rt.analysis);
  });
  test('no confirmation, a wrong action, extra confirmation or argument keys, or a different restated ampacity → refused', () => {
    const { request, design: des, preliminary: p } = reviewed();
    refusedWith(adopt({ request, design: des, preliminary: p }), 'EXPLICIT_CONFIRMATION_REQUIRED');
    for (const confirmation of [null, true, 'yes', {}, { action: 'adopt' }, confirmFor(p, { action: 'CONFIRM' }), confirmFor(p, { force: true }), confirmFor(p, { qualificationAccepted: true })]) refusedWith(adopt({ request, design: des, preliminary: p, confirmation }), 'EXPLICIT_CONFIRMATION_REQUIRED');
    refusedWith(adopt({ request, design: des, preliminary: p, confirmation: confirmFor(p), skipChecks: true }), 'ADOPTION_ARGUMENTS_INVALID');
    refusedWith(S.adoptPlannedConductorDeclaration(null), 'ADOPTION_ARGUMENTS_INVALID'); refusedWith(S.adoptPlannedConductorDeclaration(undefined), 'ADOPTION_ARGUMENTS_INVALID');
    for (const expectedAmpacityA of [200, 100, 174.99, '175', null, undefined]) refusedWith(adopt({ request, design: des, preliminary: p, confirmation: confirmFor(p, { expectedAmpacityA }) }), 'CONFIRMED_AMPACITY_MISMATCH');
    for (const prelim of [null, {}, S.analyzePrototype(B0(), des), F.evaluatePreliminaryV2(request).result]) refusedWith(adopt({ request, design: des, preliminary: prelim, confirmation: confirmFor(p) }), 'PRELIMINARY_RESULT_REQUIRED');
    assert.equal(amp(request).value, null);
  });
  test('stale fingerprint, changed input, changed plan and a forged candidate are all rejected', () => {
    const { request, design: des, preliminary: p } = reviewed();
    // wrong / missing confirmed fingerprint
    for (const expectedFingerprint of ['fp1-0000000000000000-0', p.binding.requestFingerprint, null, undefined]) refusedWith(adopt({ request, design: des, preliminary: p, confirmation: confirmFor(p, { expectedFingerprint }) }), 'STALE_BINDING_FINGERPRINT');
    // the load changed after the review (same candidate, different calculation)
    const changedLoad = B0unknown((r) => { r.snapshot.dwelling.floorAreaFt2 = 1600; });
    refusedWith(adopt({ request: changedLoad, design: des, preliminary: p, confirmation: confirmFor(p) }), 'STALE_BINDING_FINGERPRINT');
    // a change that does not alter any number (a label) is still a different input
    refusedWith(adopt({ request: B0unknown((r) => { r.snapshot.loads[0].label = 'Range (renamed)'; }), design: des, preliminary: p, confirmation: confirmFor(p) }), 'STALE_BINDING_FINGERPRINT');
    // the plan changed after the review
    for (const changedDesign of [design(225, DWELLING), design(200, {}), design(200, Object.assign({ material: 'Al' }, DWELLING)), design(200, Object.assign({ insulationTempRatingC: 90 }, DWELLING)), design(200, DWELLING, { wholeDwelling: null })]) {
      refusedWith(adopt({ request, design: changedDesign, preliminary: p, confirmation: confirmFor(p) }), 'STALE_BINDING_FINGERPRINT');
    }
    // a caller confirming the NEW fingerprint with the OLD reviewed result is refused as well
    const fresh = preliminary(clone(changedLoad), des);
    refusedWith(adopt({ request: changedLoad, design: des, preliminary: p, confirmation: confirmFor(p, { expectedFingerprint: fresh.binding.fingerprint }) }), 'STALE_BINDING_FINGERPRINT');
    // forged candidate / forged flags inside an otherwise current result (binding untouched)
    const forgeries = [
      (x) => { x.ungroundedConductors.tableCandidate.ampacity75CA = 200; x.adoption.candidateAmpacityA = 200; },
      (x) => { x.ungroundedConductors.tableCandidate.size = '3/0'; },
      (x) => { x.calcBasis.totalVA = 20000; },
      (x) => { x.ungroundedConductors.qualificationConsistency.status = 'premise_unchanged'; },
      (x) => { x.installationApproved = true; },
      (x) => { x.extra = 'unreviewed'; },
    ];
    for (const forge of forgeries) {
      const forged = clone(p); forge(forged);
      refusedWith(adopt({ request, design: des, preliminary: forged, confirmation: confirmFor(forged) }), 'STALE_PRELIMINARY_RESULT');
    }
    // a self-referencing object is refused, not followed
    const cyclic = clone(p); cyclic.self = cyclic;
    refusedWith(S.adoptPlannedConductorDeclaration({ request, design: des, preliminary: cyclic, confirmation: confirmFor(p) }), 'STALE_PRELIMINARY_RESULT');
    assert.equal(amp(request).value, null);
  });
  test('binding output for the UI: any change alters the fingerprint; change-then-revert restores it (so UI invalidation must be event-based, not hash-based)', () => {
    const des = design(200, DWELLING); const p0 = preliminary(B0unknown(), des);
    const p1 = preliminary(B0unknown((r) => { r.snapshot.dwelling.floorAreaFt2 = 1501; }), des);
    const p2 = preliminary(B0unknown(), design(200, Object.assign({ currentCarryingConductors: 2 }, DWELLING)));
    const p3 = preliminary(B0unknown((r) => { r.snapshot.dwelling.floorAreaFt2 = 1501; r.snapshot.dwelling.floorAreaFt2 = 1500; }), design(200, DWELLING));
    assert.notEqual(p1.binding.fingerprint, p0.binding.fingerprint); assert.notEqual(p1.binding.requestFingerprint, p0.binding.requestFingerprint); assert.equal(p1.binding.designFingerprint, p0.binding.designFingerprint);
    assert.notEqual(p2.binding.fingerprint, p0.binding.fingerprint); assert.equal(p2.binding.requestFingerprint, p0.binding.requestFingerprint); assert.notEqual(p2.binding.designFingerprint, p0.binding.designFingerprint);
    assert.deepEqual(p3.binding, p0.binding); assert.equal(JSON.stringify(p3), JSON.stringify(p0), 'deterministic');
    assert.match(p0.binding.algorithm, /NON-cryptographic/);
  });
  test('an existing known conductor value is never overwritten by a proposal (200 A, and a value below the gate alike)', () => {
    const { design: des, preliminary: p } = reviewed();
    for (const existing of [200, 90]) {
      const request = B0declared(existing); const text = JSON.stringify(request);
      const r = adopt({ request, design: des, preliminary: p, confirmation: confirmFor(p) });
      refusedWith(r, 'EXISTING_CONDUCTOR_DECLARATION_NOT_REPLACED'); assert.equal(r.before.conductorAmpacityA.value, existing); assert.equal(r.nextAction.code, 'USE_ORDINARY_ANALYSIS');
      // even with a preliminary result computed for that very request and a matching confirmation
      const own = preliminary(clone(request), des);
      refusedWith(adopt({ request, design: des, preliminary: own, confirmation: confirmFor(own, { expectedAmpacityA: 175 }) }), 'EXISTING_CONDUCTOR_DECLARATION_NOT_REPLACED');
      assert.equal(JSON.stringify(request), text); assert.equal(amp(request).value, existing);
    }
    // the ordinary 200 → 175 revalidation diagnostic is untouched by this stage
    const a = S.analyzePrototype(B0(), des); assert.equal(qc(a).status, 'revalidation_required'); assert.equal(a.qualificationEcho.conductorAmpacityA, 200); assert.equal(a.ungroundedConductors.size, null);
  });
});

describe('STAGE4 — persistence: the v1 full-result record', () => {
  const metadata = () => ({ id: 'sr1_0123456789abcdef0123456789abcdef', name: 'Stage 4 result', createdAt: '2026-11-21T00:00:00.000Z' });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.problems)); return r.record; };
  const refused = (r, re) => { assert.equal(r.ok, false); assert.equal(Object.hasOwn(r, 'record'), false); if (re) assert.ok(r.problems.some((x) => re.test(x)), JSON.stringify(r.problems)); };
  /** Draft + projection exactly like the accepted record tests (the lcv-3 draft is the saved source of the request). */
  function draftFor(request) {
    const draft = State.createEmptyDraftV2(); draft.snapshot = clone(request.snapshot); draft.context = clone(request.context);
    const projection = State.toRequestV2(draft); assert.equal(projection.ok, true, JSON.stringify(projection.problems));
    return { draft, request: projection.request };
  }
  const ordinaryCapture = (request, des) => { const d = draftFor(request); return { draft: d.draft, request: d.request, response: F.evaluateV2(d.request), design: des, analysis: S.analyzePrototype(d.request, des) }; };

  test('a transient preliminary result cannot be saved or read as a v1 full result, in any combination', () => {
    const des = design(200, DWELLING); const d = draftFor(B0unknown());
    const prelimPair = F.evaluatePreliminaryV2(d.request); const prelimAnalysis = S.analyzePreliminaryPrototype(d.request, des);
    assert.equal(prelimAnalysis.status, 'PRELIMINARY_EVALUATED');
    const ordinaryResponse = F.evaluateV2(d.request); const ordinaryAnalysis = S.analyzePrototype(d.request, des);
    refused(Record.createRecord({ draft: d.draft, request: d.request, response: clone(prelimPair), design: des, analysis: clone(prelimAnalysis) }, metadata()), /complete calculated load/);
    refused(Record.createRecord({ draft: d.draft, request: d.request, response: ordinaryResponse, design: des, analysis: clone(prelimAnalysis) }, metadata()), /complete calculated load/);
    refused(Record.createRecord({ draft: d.draft, request: d.request, response: clone(prelimPair), design: des, analysis: ordinaryAnalysis }, metadata()), /complete calculated load/);
    // a preliminary response relabelled COMPLETE (with an ordinary-status analysis) still does not match the ordinary engine for its request
    const relabelled = clone(prelimPair); relabelled.result.status = 'COMPLETE';
    refused(Record.createRecord({ draft: d.draft, request: d.request, response: relabelled, design: des, analysis: ordinaryAnalysis }, metadata()), /does not match/);
    refused(Record.createRecord({ draft: d.draft, request: d.request, response: relabelled, design: des, analysis: clone(prelimAnalysis) }, metadata()), /performed/);
    // a preliminary analysis attached to an otherwise valid ordinary capture is refused at creation …
    const good = ordinaryCapture(B0(), des);
    refused(Record.createRecord(Object.assign({}, good, { analysis: clone(prelimAnalysis) }), metadata()), /performed|service analysis/);
    // … and spliced into a stored record it is refused by the structural v1 reader
    const stored = ok(Record.createRecord(good, metadata()));
    const splices = [
      (r) => { r.serviceSizing.analysis = clone(prelimAnalysis); },
      (r) => { r.calculation.response = clone(prelimPair); },
      (r) => { r.calculation.response.result.status = 'PRELIMINARY_QUALIFICATION_PENDING'; },
      (r) => { r.calculation.response.result.kind = 'B82_PRELIMINARY_NEW_DESIGN'; },
      (r) => { r.calculation.response.facade.resultKind = 'B82_PRELIMINARY_NEW_DESIGN'; },
      (r) => { r.serviceSizing.analysis.status = 'PRELIMINARY_EVALUATED'; },
      (r) => { r.serviceSizing.analysis.kind = 'SERVICE_SIZING_PRELIMINARY_NEW_DESIGN'; },
      (r) => { r.serviceSizing.analysis.ungroundedConductors.qualificationConsistency.status = 'deferred_pending_declaration'; },
      (r) => { r.serviceSizing.analysis.minimumService.preliminary = true; },
      (r) => { r.serviceSizing.analysis.calcBasis.calcStatus = 'PRELIMINARY_QUALIFICATION_PENDING'; },
    ];
    for (const splice of splices) { const r = clone(stored); splice(r); assert.ok(Record.validateStoredRecord(r).length > 0); refused(Record.readStoredRecord(r)); refused(Record.parseStoredRecord(JSON.stringify(r))); }
  });
  test('after a valid explicit adoption the ordinary v1 Save works, from the helper outputs and from an independent recalculation alike', () => {
    const des = design(200, DWELLING); const d0 = draftFor(B0unknown());
    const p = S.analyzePreliminaryPrototype(d0.request, des);
    const adoption = S.adoptPlannedConductorDeclaration({ request: d0.request, design: des, preliminary: p, confirmation: confirmFor(p) });
    assert.equal(adoption.adopted, true);
    // the caller writes the adopted declaration into ITS draft; the projection must then be the adopted request
    const draft = clone(d0.draft); draft.fieldErrors = d0.draft.fieldErrors; draft.loadErrors = d0.draft.loadErrors;
    draft.snapshot.optional82.conductorAmpacityA = clone(adoption.after.conductorAmpacityA);
    const projection = State.toRequestV2(draft); assert.equal(projection.ok, true, JSON.stringify(projection.problems));
    assert.deepEqual(projection.request, clone(adoption.adoptedRequest));
    const record = ok(Record.createRecord({ draft, request: projection.request, response: adoption.response, design: des, analysis: adoption.analysis }, metadata()));
    const again = ok(Record.createRecord({ draft, request: projection.request, response: F.evaluateV2(projection.request), design: des, analysis: S.analyzePrototype(projection.request, des) }, metadata()));
    assert.equal(JSON.stringify(again), JSON.stringify(record));
    assert.equal(record.calculation.response.result.status, 'COMPLETE'); assert.equal(record.calculation.response.result.demand.totalVA, B0_VA);
    const saved = record.calculation.draftPayload.snapshot.optional82.conductorAmpacityA;
    assert.equal(saved.value, 175); assert.equal(saved.provenance.source, 'designer_declaration'); assert.equal(saved.provenance.note, adoption.provenanceNote); assert.equal(S.isPlannedConductorDeclaration(saved), true);
    assert.equal(record.serviceSizing.analysis.ungroundedConductors.qualificationConsistency.status, 'premise_unchanged');
    assert.equal(record.serviceSizing.analysis.operative, false); assert.equal(record.serviceSizing.analysis.installationApproved, false); assert.equal(record.serviceSizing.analysis.globalCodeCompliance, 'not_verified');
    assert.deepEqual(Record.validateStoredRecord(record), []);
    assert.equal(JSON.stringify(ok(Record.parseStoredRecord(JSON.stringify(record)))), JSON.stringify(record), 'planned provenance survives the strict v1 round trip verbatim');
  });
  test('a historic 200 → 175 record stays readable with its original values and status; reading never recomputes or reinterprets', () => {
    const des = design(200, DWELLING);
    const record = ok(Record.createRecord(ordinaryCapture(B0(), des), metadata()));
    record.producer.applicationRevision = 'historical-revision'; record.producer.calculationSourcePin = 'a'.repeat(64); record.producer.sourceBaselinePin = 'b'.repeat(64);
    const text = JSON.stringify(record);
    const saved = { evaluateV2: F.evaluateV2, evaluatePreliminaryV2: F.evaluatePreliminaryV2, analyzePrototype: S.analyzePrototype, analyzePreliminaryPrototype: S.analyzePreliminaryPrototype, adopt: S.adoptPlannedConductorDeclaration };
    let calls = 0; const boom = () => { calls++; throw new Error('must not run on read'); };
    let read;
    try {
      F.evaluateV2 = boom; F.evaluatePreliminaryV2 = boom; S.analyzePrototype = boom; S.analyzePreliminaryPrototype = boom; S.adoptPlannedConductorDeclaration = boom;
      assert.deepEqual(Record.validateStoredRecord(record), []);
      read = ok(Record.parseStoredRecord(text));
      assert.equal(JSON.stringify(ok(Record.readStoredRecord(record))), text);
    } finally { F.evaluateV2 = saved.evaluateV2; F.evaluatePreliminaryV2 = saved.evaluatePreliminaryV2; S.analyzePrototype = saved.analyzePrototype; S.analyzePreliminaryPrototype = saved.analyzePreliminaryPrototype; S.adoptPlannedConductorDeclaration = saved.adopt; }
    assert.equal(calls, 0); assert.equal(JSON.stringify(read), text);
    const u = read.serviceSizing.analysis.ungroundedConductors; const q = u.qualificationConsistency;
    assert.equal(read.calculation.request.snapshot.optional82.conductorAmpacityA.value, 200); assert.equal(read.calculation.request.snapshot.optional82.conductorAmpacityA.provenance.note, null);
    assert.equal(S.isPlannedConductorDeclaration(read.calculation.request.snapshot.optional82.conductorAmpacityA), false);
    assert.equal(read.serviceSizing.analysis.qualificationEcho.conductorAmpacityA, 200);
    assert.equal(q.status, 'revalidation_required'); assert.equal(q.declaredQualificationAmpacityA, 200); assert.equal(q.candidateTableAmpacity75CA, 175); assert.deepEqual(q.reasons.map((x) => x.code), ['QUALIFICATION_PREMISE_CHANGED']);
    assert.equal(u.tableCandidate.size, '2/0'); assert.equal(u.recommendationAvailable, false); assert.equal(u.size, null); assert.equal(u.status, 'table_candidate_conditional');
    assert.equal(read.calculation.response.result.status, 'COMPLETE'); assert.equal(read.calculation.response.result.demand.totalVA, B0_VA);
  });
});

describe('STAGE4 — module contract', () => {
  test('new entry points are separate exports; no export name suggests a production switch, bypass or approval; the sizing module still has only its two dependencies', () => {
    assert.equal(typeof F.evaluatePreliminaryV2, 'function'); assert.notEqual(F.evaluatePreliminaryV2, F.evaluateV2);
    assert.equal(F.PRELIMINARY_RESULT_KIND, 'B82_PRELIMINARY_NEW_DESIGN'); assert.equal(B82.CONDUCTOR_AMPACITY_GATE_A, 100); assert.equal(S.B82_QUALIFICATION_GATE_A, 100);
    assert.ok(!Object.values(B82.PRELIMINARY_STATUS).includes('COMPLETE')); assert.ok(!Object.values(S.PRELIMINARY_ANALYSIS_STATUS).some((v) => v === 'EVALUATED' || v === 'DESIGN_INVALID'));
    for (const k of Object.keys(S).concat(Object.keys(F))) assert.ok(!/enable|production|bypass|override|attest|verified|approve/i.test(k), k);
    const src = fs.readFileSync(path.join(ROOT, 'src', 'calc', 'loadCalcServiceSizing.js'), 'utf8');
    assert.deepEqual((src.match(/require\([^)]*\)/g) || []).sort(), ["require('./loadCalcFacade.js')", "require('./loadCalcInputV2.js')"]);
    for (const f of ['loadCalcServiceSizing.js', 'loadCalcFacade.js', 'loadCalcOpt82.js']) assert.ok(!/process\.env|localStorage|Date\.now|Math\.random|new Date\b/.test(fs.readFileSync(path.join(ROOT, 'src', 'calc', f), 'utf8')), f);
  });
  test('an unexpected fault in the preliminary analysis or the adoption is thrown with the prototype safety flags', () => {
    const trap = new Proxy({}, { get() { throw new TypeError('boom'); }, ownKeys() { throw new TypeError('boom'); }, getOwnPropertyDescriptor() { throw new TypeError('boom'); } });
    const flagged = (e) => e instanceof S.ServiceSizingPrototypeError && e.operative === false && e.installationApproved === false && e.globalCodeCompliance === 'not_verified';
    assert.throws(() => S.analyzePreliminaryPrototype(trap, design(200)), flagged);
    assert.throws(() => S.adoptPlannedConductorDeclaration(trap), flagged);
  });
});
