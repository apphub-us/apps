'use strict';
/**
 * LC-SERVICE-SIZING-1 (R2) — service sizing PROTOTYPE tests (non-operative layer; docs/load-calc-service-sizing-1.md).
 * Requests are the real LC82-B0P fixture (test/fixtures/loadCalc/LC82-cases-r1.json) or edits of it; demand/current are
 * always recomputed by the unchanged facade inside analyzePrototype. Expected ratings/sizes/ampacities are hand-written
 * literals transcribed from the source digest (Table 240.6(A), Table 310.16 75 °C, Table 310.12), never read back from
 * the module's own tables.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../src/calc/loadCalcFacade.js');
const S = require('../src/calc/loadCalcServiceSizing.js');
const { deepFreeze, clone } = require('./helpers/loadCalcFixtures.js');

const ROOT = path.join(__dirname, '..');
const LC82 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'LC82-cases-r1.json'), 'utf8'));
const caseReq = (id) => { const c = LC82.cases.find((x) => x.id === id); assert.ok(c, `fixture ${id}`); return clone(c.request); };
const B0 = () => caseReq('LC82-B0P');
const load = (req, id) => req.snapshot.loads.find((l) => l.id === id);
/** A/C record: rating and its coverage basis move together (otherwise the engine reports PREMISE_STALE). */
function setAc(req, va) { const l = load(req, 'L5'); l.rating.value = va; l.ratingCoverage82.basis.rating.value = va; return req; }
function setDishwasher(req, va) { load(req, 'L4').rating.value = va; return req; }
/** Declared 220.82(A) qualification ampacity (the caller's own deliberate edit of its own request). */
function setQual(req, a) { req.snapshot.optional82.conductorAmpacityA.value = a; return req; }
const PLAN = { intent: 'new_design_candidate', oneMainDisconnect: true, noAdditionalSources: true, wholeDwelling: true, singleConductorSet: true };
const COND = { sizingPath: 'general_table_75C', material: 'Cu', terminationTempRatingC: 75, terminationMaterialCompatible: true, insulationTempRatingC: 75, ambientTempC: 30, currentCarryingConductors: 3, wiringMethod: 'single_insulated_conductors_in_raceway', noOtherAdjustmentOrCorrection: true };
const P31012 = { sizingPath: 'dwelling_83pct_310_12' };
function design(selected, planPatch, condPatch) {
  const d = { plan: Object.assign({}, PLAN, planPatch || {}), conductor: Object.assign({}, COND, condPatch || {}) };
  if (selected !== undefined) d.selectedMainRatingA = selected;
  return d;
}
const HISTORY_ONLY = new Set(['S2', 'S3', 'S4', 'S5']);
const allReasons = (r) => [r.minimumService, r.chosenMain, r.ungroundedConductors].flatMap((st) => st.reasons)
  .concat(r.ungroundedConductors.qualificationConsistency ? r.ungroundedConductors.qualificationConsistency.reasons : []);

/** Invariants for EVERY result: safety flags, separated source/interpretation/approval status, frozen, no approval, no output leaking from a refused stage. */
function run(request, des) {
  const req = deepFreeze(request); const d = des === undefined ? undefined : deepFreeze(des);
  const before = JSON.stringify(req); const dBefore = JSON.stringify(d);
  const r = S.analyzePrototype(req, d);
  assert.strictEqual(r.operative, false); assert.strictEqual(r.installationApproved, false); assert.strictEqual(r.globalCodeCompliance, 'not_verified');
  assert.strictEqual(r.ruleReview, 'SCOPED_PRIMARY_TEXT_RECEIVED_INTERPRETATION_OPEN');
  assert.strictEqual(r.sourceReview.primaryTextComplete, true); assert.strictEqual(r.sourceReview.closed, false);
  assert.strictEqual(r.sourceReview.installationApproval, 'not_approved'); assert.strictEqual(r.sourceReview.globalCodeCompliance, 'not_verified');
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.minimumService) && Object.isFrozen(r.ungroundedConductors));
  const uc = r.ungroundedConductors;
  assert.ok(r.remainingChecks.length > 0 && uc.appliesTo === 'ungrounded conductors only');
  if (r.minimumService.status !== 'experimental_candidate') { assert.strictEqual(r.minimumService.ratingA, null); assert.notStrictEqual(r.chosenMain.status, 'meets_prototype_minimum'); }
  if (r.chosenMain.status !== 'meets_prototype_minimum') assert.strictEqual(uc.status, 'not_evaluated');
  // no refusal produces an unconditional conductor recommendation
  assert.strictEqual(typeof uc.recommendationAvailable, 'boolean');
  if (!uc.recommendationAvailable) { assert.strictEqual(uc.size, null); assert.ok(uc.ampacity75CA === undefined || uc.ampacity75CA === null); }
  else { assert.strictEqual(uc.status, 'experimental_candidate'); assert.strictEqual(uc.qualificationConsistency.status, 'premise_unchanged'); assert.strictEqual(r.chosenMain.status, 'meets_prototype_minimum'); }
  if (uc.status === 'experimental_candidate') assert.strictEqual(uc.recommendationAvailable, true);
  if (['not_evaluated', 'waiting_input', 'unsupported'].includes(uc.status)) { assert.strictEqual(uc.tableCandidate, null); assert.strictEqual(uc.qualificationConsistency, null); }
  if (uc.tableCandidate) { assert.strictEqual(uc.tableCandidate.conditional, true); assert.strictEqual(uc.tableCandidate.forRatingA, r.chosenMain.selectedRatingA); }
  const ids = new Set(Object.keys(S.SOURCES));
  for (const x of allReasons(r)) {
    assert.ok(Array.isArray(x.sourceIds) && Array.isArray(x.sections) && typeof x.code === 'string' && typeof x.message === 'string');
    for (const id of x.sourceIds) { assert.ok(ids.has(id), id); assert.ok(!HISTORY_ONLY.has(id), `historical source ${id} cited by ${x.code}`); }
  }
  assert.strictEqual(JSON.stringify(req), before, 'request not mutated'); assert.strictEqual(JSON.stringify(d), dBefore, 'design not mutated');
  const json = JSON.stringify(r);
  assert.ok(!json.includes('"installationApproved":true') && !json.includes('"globalCodeCompliance":"verified"') && !json.includes('"operative":true'));
  const o82 = request && request.snapshot && request.snapshot.optional82;
  if (r.qualificationEcho) assert.strictEqual(r.qualificationEcho.conductorAmpacityA, o82 && o82.conductorAmpacityA ? o82.conductorAmpacityA.value : null, 'qualification echo is the declared value');
  return r;
}
const codes = (stage) => stage.reasons.map((x) => x.code);
const qc = (r) => r.ungroundedConductors.qualificationConsistency;

describe('B0 through the pure API (recomputed by the unchanged facade)', () => {
  test('B0 23680 VA (displayed 98.7 A) → experimental minimum 100 A; the displayed ampere value is not the source', () => {
    const r = run(B0(), design());
    assert.strictEqual(r.status, 'EVALUATED');
    assert.strictEqual(r.calcBasis.totalVA, 23680); assert.strictEqual(r.calcBasis.totalExactE4, 236800000); assert.strictEqual(r.calcBasis.lineADisplay, '98.7 A');
    assert.strictEqual(r.minimumService.status, 'experimental_candidate'); assert.strictEqual(r.minimumService.ratingA, 100); assert.strictEqual(r.minimumService.governedBy, 'floor_100A');
    assert.strictEqual(r.chosenMain.status, 'waiting_input'); assert.strictEqual(r.chosenMain.selectedRatingA, null); assert.ok(codes(r.chosenMain).includes('SELECTED_RATING_MISSING'));
    assert.strictEqual(r.ungroundedConductors.status, 'not_evaluated');
  });
  test('edited B0 (dishwasher 1300 VA) → 23720 VA, raw 98.8333… A, displayed 98.8 A → still 100 A', () => {
    const r = run(setDishwasher(B0(), 1300), design());
    assert.strictEqual(r.calcBasis.totalVA, 23720); assert.strictEqual(r.calcBasis.lineA, 23720 / 240); assert.strictEqual(r.calcBasis.lineADisplay, '98.8 A');
    assert.strictEqual(r.minimumService.ratingA, 100);
  });
  test('calcBasis equals a direct facade evaluation of the same request (no user-supplied display value is involved)', () => {
    const req = setDishwasher(B0(), 1300); const direct = F.evaluateV2(clone(req)).result;
    const r = run(req, design(200));
    assert.strictEqual(r.calcBasis.totalExactE4, direct.demand.totalExactE4); assert.strictEqual(r.calcBasis.lineA, direct.current.lineA); assert.strictEqual(r.calcBasis.calcStatus, direct.status);
    assert.strictEqual(r.minimumService.loadExactE4, direct.demand.totalExactE4);
  });
  test('a display value smuggled into the request or the design is refused, never used', () => {
    const req = B0(); req.displayedA = 98.8; const r1 = run(req, design(200));
    assert.strictEqual(r1.status, 'REQUEST_INVALID'); assert.strictEqual(r1.minimumService.status, 'not_computed'); assert.strictEqual(r1.chosenMain.status, 'not_evaluated');
    const d = design(200); d.totalVA = 20000; const r2 = run(B0(), d);
    assert.strictEqual(r2.status, 'DESIGN_INVALID'); assert.ok(r2.designProblems.some((p) => p.code === 'DESIGN_UNKNOWN_KEY' && p.field === 'totalVA'));
    const r3 = run(null, design(200)); assert.strictEqual(r3.status, 'REQUEST_INVALID');
  });
});

describe('Minimum rating: exact raw-VA boundaries (no EPSILON, no rounding down)', () => {
  test('exactly 24000 VA → 100 A; +0.004 VA (smallest total increment via a 0.01 VA general-load change) displays 100.0 A but → 110 A', () => {
    const exact = run(setAc(B0(), 5320), design());
    assert.strictEqual(exact.calcBasis.totalExactE4, 240000000); assert.strictEqual(exact.calcBasis.lineADisplay, '100.0 A'); assert.strictEqual(exact.minimumService.ratingA, 100);
    const over = run(setDishwasher(setAc(B0(), 5320), 1200.01), design());
    assert.strictEqual(over.calcBasis.totalExactE4, 240000040); assert.strictEqual(over.calcBasis.lineADisplay, '100.0 A');
    assert.strictEqual(over.minimumService.ratingA, 110); assert.strictEqual(over.minimumService.governedBy, 'calculated_load');
    const overAc = run(setAc(B0(), 5320.01), design());
    assert.strictEqual(overAc.calcBasis.totalExactE4, 240000100); assert.strictEqual(overAc.minimumService.ratingA, 110);
  });
  test('exactly 26400 VA (110 A) → 110; just over → 125', () => {
    assert.strictEqual(run(setAc(B0(), 7720), design()).minimumService.ratingA, 110);
    assert.strictEqual(run(setDishwasher(setAc(B0(), 7720), 1200.01), design()).minimumService.ratingA, 125);
    assert.strictEqual(run(setAc(B0(), 7720.01), design()).minimumService.ratingA, 125);
  });
  test('max 400 A boundary (96000 VA) → 400; overflow → unsupported, no automatic parallelization, no downstream output', () => {
    const at = run(setAc(B0(), 77320), design(400));
    assert.strictEqual(at.calcBasis.totalExactE4, 960000000); assert.strictEqual(at.minimumService.ratingA, 400); assert.strictEqual(at.chosenMain.status, 'meets_prototype_minimum');
    // R2: 600 kcmil Cu (420 A) differs from the declared qualification 200 A → table candidate kept, selection withheld
    assert.strictEqual(at.ungroundedConductors.tableCandidate.size, '600'); assert.strictEqual(at.ungroundedConductors.tableCandidate.sizeUnit, 'kcmil');
    assert.strictEqual(qc(at).status, 'revalidation_required'); assert.strictEqual(at.ungroundedConductors.size, null);
    for (const req of [setDishwasher(setAc(B0(), 77320), 1200.01), setAc(B0(), 77320.01), setAc(B0(), 90000)]) {
      const r = run(req, design(400));
      assert.strictEqual(r.minimumService.status, 'unsupported'); assert.deepStrictEqual(codes(r.minimumService), ['LOAD_EXCEEDS_PROTOTYPE_RANGE']);
      assert.strictEqual(r.chosenMain.status, 'not_evaluated'); assert.strictEqual(r.ungroundedConductors.status, 'not_evaluated');
    }
  });
});

describe('Chosen main rating (explicit, separate; the 220.82(A) qualification is never reused)', () => {
  test('absent vs below minimum vs 200', () => {
    const req = setAc(B0(), 5320.01);   // minimum 110
    const absent = run(req, design());
    assert.strictEqual(absent.minimumService.ratingA, 110); assert.strictEqual(absent.chosenMain.status, 'waiting_input'); assert.strictEqual(absent.ungroundedConductors.status, 'not_evaluated');
    const below = run(setAc(B0(), 5320.01), design(100));
    assert.strictEqual(below.chosenMain.status, 'rejected_undersized'); assert.deepStrictEqual(codes(below.chosenMain), ['SELECTED_RATING_UNDERSIZED']); assert.strictEqual(below.ungroundedConductors.status, 'not_evaluated');
    const two = run(setAc(B0(), 5320.01), design(200));
    assert.strictEqual(two.chosenMain.status, 'meets_prototype_minimum'); assert.strictEqual(two.ungroundedConductors.sizedForRatingA, 200);
  });
  test('ratings outside the fixture list are unsupported (no rounding to a neighbour, no >400 A)', () => {
    for (const v of [90, 105, 120, 200.5, 450, 0]) {
      const r = run(B0(), design(v)); assert.strictEqual(r.chosenMain.status, 'unsupported', String(v)); assert.ok(codes(r.chosenMain).includes('SELECTED_RATING_UNSUPPORTED')); assert.strictEqual(r.ungroundedConductors.status, 'not_evaluated');
      // R2 added: scope refusal wording, not a legal-prohibition claim
      const m = r.chosenMain.reasons.find((x) => x.code === 'SELECTED_RATING_UNSUPPORTED').message;
      assert.match(m, /outside this product scope/); assert.match(m, /scope refusal, not a statement that the rating is not permitted/);
    }
  });
  test('the original qualification 200 A never becomes the selected breaker and is not mutated; changing the proposed rating changes neither request nor calculation', () => {
    const req = deepFreeze(B0()); const before = JSON.stringify(req);
    const none = run(req, design());
    assert.strictEqual(none.qualificationEcho.conductorAmpacityA, 200); assert.strictEqual(none.chosenMain.selectedRatingA, null); assert.strictEqual(none.chosenMain.status, 'waiting_input');
    const bases = [100, 150, 200, 400].map((v) => { const r = run(req, design(v)); assert.strictEqual(r.qualificationEcho.conductorAmpacityA, 200); assert.strictEqual(r.chosenMain.selectedRatingA, v); return JSON.stringify(r.calcBasis); });
    assert.ok(bases.every((b) => b === JSON.stringify(none.calcBasis)));
    assert.strictEqual(JSON.stringify(req), before);
    assert.strictEqual(JSON.stringify(F.evaluateV2(req).result), JSON.stringify(F.evaluateV2(B0()).result), 'facade result identical after prototype use');
    const q150 = B0(); q150.snapshot.optional82.conductorAmpacityA.value = 150; const r150 = run(q150, design(200));
    assert.strictEqual(r150.qualificationEcho.conductorAmpacityA, 150); assert.strictEqual(r150.ungroundedConductors.sizedForRatingA, 200);
  });
  test('intent other than new_design_candidate: no existing-equipment compatibility claim', () => {
    const r = run(B0(), design(200, { intent: 'existing_service_evaluation' }));
    assert.strictEqual(r.chosenMain.status, 'unsupported'); assert.ok(codes(r.chosenMain).includes('INTENT_UNSUPPORTED'));
    const n = run(B0(), design(200, { intent: null })); assert.strictEqual(n.chosenMain.status, 'waiting_input');
  });
});

describe('Ungrounded conductor candidate: conservative general 75 °C table path', () => {
  test('general 75 °C fixtures: 100 → 3 Cu / 1 Al; 200 → 3/0 Cu / 250 Al', () => {
    // R2: table candidates stay visible; only an unchanged qualification premise (declared 200 A) releases a selection
    const cu100 = run(B0(), design(100)).ungroundedConductors; const al100 = run(B0(), design(100, null, { material: 'Al' })).ungroundedConductors;
    assert.deepStrictEqual([cu100.status, cu100.tableCandidate.size, cu100.tableCandidate.sizeUnit, cu100.tableCandidate.ampacity75CA], ['table_candidate_conditional', '3', 'AWG', 100]);
    assert.deepStrictEqual([al100.tableCandidate.size, al100.tableCandidate.sizeUnit, al100.tableCandidate.ampacity75CA], ['1', 'AWG', 100]);
    for (const x of [cu100, al100]) { assert.strictEqual(x.qualificationConsistency.status, 'revalidation_required'); assert.strictEqual(x.size, null); assert.strictEqual(x.recommendationAvailable, false); }
    const cu200 = run(B0(), design(200)).ungroundedConductors; const al200 = run(B0(), design(200, null, { material: 'Al' })).ungroundedConductors;
    assert.deepStrictEqual([cu200.status, cu200.size, cu200.sizeUnit, cu200.ampacity75CA, cu200.qualificationConsistency.status], ['experimental_candidate', '3/0', 'AWG', 200, 'premise_unchanged']);
    assert.deepStrictEqual([al200.tableCandidate.size, al200.tableCandidate.sizeUnit, al200.tableCandidate.ampacity75CA, al200.qualificationConsistency.status], ['250', 'kcmil', 205, 'revalidation_required']);
  });
  test('every fixture rating maps to the least entry with ampacity >= rating (hand-written expectations)', () => {
    const cu = { 100: '3', 110: '2', 125: '1', 150: '1/0', 175: '2/0', 200: '3/0', 225: '4/0', 250: '250', 300: '350', 350: '500', 400: '600' };
    const al = { 100: '1', 110: '1/0', 125: '2/0', 150: '3/0', 175: '4/0', 200: '250', 225: '300', 250: '350', 300: '500', 350: '700', 400: '900' };
    for (const R of S.STANDARD_RATINGS_SUBSET) {
      const c = run(B0(), design(R)).ungroundedConductors.tableCandidate; const a = run(B0(), design(R, null, { material: 'Al' })).ungroundedConductors.tableCandidate;
      assert.strictEqual(c.size, cu[R], `Cu ${R}`); assert.strictEqual(a.size, al[R], `Al ${R}`); assert.ok(c.ampacity75CA >= R && a.ampacity75CA >= R);
    }
  });
  test('explicit 200 A with the 98.8 A calculation sizes UNGROUNDED conductors for 200 A, never for 98.8 A', () => {
    const r = run(setDishwasher(B0(), 1300), design(200));
    assert.strictEqual(r.calcBasis.lineADisplay, '98.8 A'); assert.strictEqual(r.ungroundedConductors.sizedForRatingA, 200);
    assert.strictEqual(r.ungroundedConductors.size, '3/0'); assert.notStrictEqual(r.ungroundedConductors.size, '3'); assert.ok(r.ungroundedConductors.ampacity75CA >= 200);
    assert.strictEqual(r.ungroundedConductors.appliesTo, 'ungrounded conductors only');
    for (const k of ['neutral (grounded) conductor', 'equipment grounding conductor', 'grounding electrode conductor', 'conduit/raceway', 'parallel conductor sets', 'short-circuit current withstand', 'final equipment/model selection']) assert.ok(r.ungroundedConductors.notSized.includes(k), k);
    assert.ok(r.remainingChecks.some((c) => /fault current/.test(c)) && r.remainingChecks.some((c) => /lug/.test(c)) && r.remainingChecks.some((c) => /utility/.test(c)) && r.remainingChecks.some((c) => /NYC/.test(c)));
    assert.strictEqual(r.installationApproved, false);
  });
  test('90 °C insulation is accepted as insulation only: same 75 °C-column size (no 90 °C sizing)', () => {
    const r = run(B0(), design(200, null, { insulationTempRatingC: 90 })).ungroundedConductors;
    assert.strictEqual(r.size, '3/0'); assert.strictEqual(r.ampacity75CA, 200);
  });
  test('2 current-carrying conductors are within the table condition; 1 is inconsistent; 4+ unsupported', () => {
    assert.strictEqual(run(B0(), design(200, null, { currentCarryingConductors: 2 })).ungroundedConductors.status, 'experimental_candidate');
    const one = run(B0(), design(200, null, { currentCarryingConductors: 1 })).ungroundedConductors; assert.strictEqual(one.status, 'unsupported'); assert.ok(codes(one).includes('CCC_INCONSISTENT'));
    for (const n of [4, 6, 9]) { const r = run(B0(), design(200, null, { currentCarryingConductors: n })).ungroundedConductors; assert.strictEqual(r.status, 'unsupported'); assert.ok(codes(r).includes('CCC_ADJUSTMENT_UNSUPPORTED')); }
    const frac = run(B0(), design(200, null, { currentCarryingConductors: 2.5 })).ungroundedConductors; assert.ok(codes(frac).includes('CCC_INVALID'));
  });
  const refusals = [
    ['incompatible terminal material', { terminationMaterialCompatible: false }, 'unsupported', 'TERMINATION_MATERIAL_INCOMPATIBLE'],
    ['terminal material compatibility unknown', { terminationMaterialCompatible: null }, 'waiting_input', 'PREMISE_UNANSWERED'],
    ['60 °C terminals', { terminationTempRatingC: 60 }, 'unsupported', 'TERMINATION_60C_UNSUPPORTED'],
    ['unknown terminal temperature', { terminationTempRatingC: null }, 'waiting_input', 'PREMISE_UNANSWERED'],
    ['90 °C terminals (no 90 °C sizing)', { terminationTempRatingC: 90 }, 'unsupported', 'TERMINATION_TEMP_UNSUPPORTED'],
    ['60 °C insulation', { insulationTempRatingC: 60 }, 'unsupported', 'INSULATION_TEMP_INSUFFICIENT'],
    ['unknown insulation', { insulationTempRatingC: null }, 'waiting_input', 'PREMISE_UNANSWERED'],
    ['hot ambient 40 °C', { ambientTempC: 40 }, 'unsupported', 'AMBIENT_UNSUPPORTED'],
    ['cold ambient 20 °C', { ambientTempC: 20 }, 'unsupported', 'AMBIENT_UNSUPPORTED'],
    ['unknown ambient', { ambientTempC: null }, 'waiting_input', 'PREMISE_UNANSWERED'],
    ['MC cable as service conductors', { wiringMethod: 'type_MC_cable' }, 'unsupported', 'WIRING_METHOD_MC_SERVICE_UNSUPPORTED'],
    ['unrecognized wiring method', { wiringMethod: 'cable_tray' }, 'unsupported', 'WIRING_METHOD_UNSUPPORTED'],
    ['unknown wiring method', { wiringMethod: null }, 'waiting_input', 'PREMISE_UNANSWERED'],
    ['other adjustment required', { noOtherAdjustmentOrCorrection: false }, 'unsupported', 'ADJUSTMENT_REQUIRED_UNSUPPORTED'],
    ['unsupported material', { material: 'CCA' }, 'unsupported', 'MATERIAL_UNSUPPORTED'],
    ['lowercase material is not guessed', { material: 'cu' }, 'unsupported', 'MATERIAL_UNSUPPORTED'],
    ['unknown material', { material: null }, 'waiting_input', 'PREMISE_UNANSWERED'],
    ['unrecognized sizing path', { sizingPath: 'auto' }, 'unsupported', 'SIZING_PATH_UNSUPPORTED'],
    ['sizing path not chosen', { sizingPath: null }, 'waiting_input', 'PREMISE_UNANSWERED'],
    ['unknown CCC count', { currentCarryingConductors: null }, 'waiting_input', 'PREMISE_UNANSWERED'],
  ];
  for (const [name, patch, status, code] of refusals) {
    test(`refusal: ${name} → ${status} (${code}), no wire output`, () => {
      const r = run(B0(), design(200, null, patch));
      assert.strictEqual(r.chosenMain.status, 'meets_prototype_minimum');
      assert.strictEqual(r.ungroundedConductors.status, status); assert.ok(codes(r.ungroundedConductors).includes(code), codes(r.ungroundedConductors).join());
      assert.strictEqual(r.ungroundedConductors.size, null); assert.strictEqual(r.ungroundedConductors.tableCandidate, null); assert.strictEqual(r.ungroundedConductors.recommendationAvailable, false);
    });
    // R2 added: the same refusal on the conditional 310.12 path (sizing-path rows excluded: they replace the path itself)
    if (!('sizingPath' in patch)) {
      test(`refusal (310.12 path): ${name} → ${status} (${code}), no table candidate`, () => {
        const r = run(B0(), design(200, null, Object.assign({}, P31012, patch)));
        assert.strictEqual(r.ungroundedConductors.status, status); assert.ok(codes(r.ungroundedConductors).includes(code), codes(r.ungroundedConductors).join());
        assert.strictEqual(r.ungroundedConductors.size, null); assert.strictEqual(r.ungroundedConductors.tableCandidate, null); assert.strictEqual(r.ungroundedConductors.recommendationAvailable, false);
      });
    }
  }
  test('310.12 83 % path requested (was a pending refusal in R1) → evaluated conditional Table 310.12 lookup, not SIZING_PATH_PENDING', () => {
    const r = run(B0(), design(200, null, P31012)).ungroundedConductors;
    assert.strictEqual(r.method, 'dwelling_83pct_310_12'); assert.ok(!codes(r).includes('SIZING_PATH_PENDING'));
    assert.strictEqual(r.status, 'table_candidate_conditional'); assert.strictEqual(r.tableCandidate.size, '2/0');
  });
  test('whole conductor object missing → waiting, never defaults to 75 °C / 30 °C / no derating', () => {
    const d = design(200); delete d.conductor; const r = run(B0(), d);
    assert.strictEqual(r.ungroundedConductors.status, 'waiting_input'); assert.ok(r.ungroundedConductors.reasons.length >= 9);
  });
  test('83 % reason carries source ids/sections and the path stays unimplemented even with every other premise set', () => {
    // R2: the path is implemented as a conditional table lookup; its reason cites the received 310.12 primary excerpts
    const r = run(B0(), design(100, null, P31012)).ungroundedConductors;
    const x = r.reasons.find((y) => y.code === 'TABLE_310_12_CANDIDATE'); assert.ok(x.sections.includes('310.12') && x.sourceIds.includes('P_310_12_B') && x.sourceIds.includes('P_310_12_A'));
    assert.strictEqual(r.status, 'table_candidate_conditional'); assert.strictEqual(r.size, null);
  });
});

describe('Scope refusals from the calculation: explicit reasons, no breaker or wire outputs', () => {
  const expectNoOutputs = (r, code) => {
    assert.strictEqual(r.minimumService.status, 'unsupported'); assert.ok(codes(r.minimumService).includes(code), `${code} in ${codes(r.minimumService).join()}`);
    assert.strictEqual(r.chosenMain.status, 'not_evaluated'); assert.strictEqual(r.ungroundedConductors.status, 'not_evaluated');
    assert.strictEqual(r.ungroundedConductors.tableCandidate, null); assert.strictEqual(r.ungroundedConductors.size, null);
  };
  test('A route (measured 220.87) and method null', () => {
    const a = B0(); a.snapshot.method.selected = 'measured_220_87'; const r = run(a, design(200)); assert.strictEqual(r.calcBasis.engine, 'A'); expectNoOutputs(r, 'METHOD_UNSUPPORTED');
    const n = B0(); n.snapshot.method.selected = null; expectNoOutputs(run(n, design(200)), 'METHOD_UNSUPPORTED');
  });
  test('120/208 network: engine completes the demand but computes no current; no amperes are guessed', () => {
    const req = B0(); req.snapshot.supply.topology = '1ph_3w_120_208_network'; req.snapshot.supply.vLineToLine = 208;
    const r = run(req, design(200));
    assert.strictEqual(r.calcBasis.calcStatus, 'COMPLETE'); assert.strictEqual(r.calcBasis.lineA, null);
    expectNoOutputs(r, 'CURRENT_NOT_COMPUTED'); assert.ok(codes(r.minimumService).includes('SUPPLY_UNSUPPORTED'));
  });
  test('missing balancedLN declaration → current not computed', () => {
    const req = B0(); req.snapshot.loadModel.declarations.balancedLN.value = null; expectNoOutputs(run(req, design(200)), 'CURRENT_NOT_COMPUTED');
  });
  test('apartment, feeder and null purpose', () => {
    const apt = B0(); apt.snapshot.occupancy = 'dwelling_unit_apartment'; expectNoOutputs(run(apt, design(200)), 'OCCUPANCY_UNSUPPORTED');
    expectNoOutputs(run(caseReq('LC82-feeder'), design(200)), 'PURPOSE_UNSUPPORTED');
    const np = B0(); np.snapshot.purpose = null; expectNoOutputs(run(np, design(200)), 'PURPOSE_UNSUPPORTED');
    expectNoOutputs(run(caseReq('LC82-11-network-apartment'), design(200)), 'OCCUPANCY_UNSUPPORTED');
  });
  test('incomplete, partial and parser-invalid calculations', () => {
    for (const id of ['LC82-inventory-null', 'LC82-09a-evse-plus-ac', 'LC82-08b-parser-area', 'LC82-07e-single-set-null', 'LC82-07c-ampacity-null', 'LC82-13d-import-unconfirmed']) {
      const r = run(caseReq(id), design(200)); assert.notStrictEqual(r.calcBasis.calcStatus, 'COMPLETE', id); expectNoOutputs(r, 'CALC_NOT_COMPLETE');
    }
  });
  test('stale or false whole-dwelling inventory', () => {
    const stale = B0(); stale.snapshot.optional82.inventoryComplete.basis.members[0].basisId = 'bs-old'; const rs = run(stale, design(200));
    assert.ok(rs.calcBasis.engineProblemCodes.includes('PREMISE_STALE')); expectNoOutputs(rs, 'CALC_NOT_COMPLETE');
    const moved = B0(); load(moved, 'L1').quantity = 2; expectNoOutputs(run(moved, design(200)), 'CALC_NOT_COMPLETE');
    const no = B0(); no.snapshot.optional82.inventoryComplete.value = false; const rn = run(no, design(200));
    assert.ok(rn.calcBasis.engineProblemCodes.includes('INVENTORY_INCOMPLETE_DECLARED')); expectNoOutputs(rn, 'CALC_NOT_COMPLETE');
  });
  test('service premises: unknown → waiting (nothing assumed); false → unsupported (parallel sets, extra sources, multiple disconnects, partial dwelling)', () => {
    const map = { oneMainDisconnect: 'MULTIPLE_DISCONNECTS_UNSUPPORTED', noAdditionalSources: 'ADDITIONAL_SOURCES_UNSUPPORTED', singleConductorSet: 'PARALLEL_SETS_UNSUPPORTED', wholeDwelling: 'PARTIAL_DWELLING_UNSUPPORTED' };
    for (const [k, code] of Object.entries(map)) {
      const u = run(B0(), design(200, { [k]: null })); assert.strictEqual(u.minimumService.status, 'waiting_input', k); assert.strictEqual(u.minimumService.ratingA, null); assert.strictEqual(u.chosenMain.status, 'not_evaluated');
      const f = run(B0(), design(200, { [k]: false })); expectNoOutputs(f, code);
    }
    const none = run(B0()); assert.strictEqual(none.minimumService.status, 'waiting_input'); assert.strictEqual(none.ungroundedConductors.status, 'not_evaluated');
  });
  // R2 added: the same scope refusals with the conditional 310.12 path requested
  test('310.12 path requested: A route, 120/208, apartment, feeder, partial dwelling and stale inventory give no table candidate', () => {
    const d = () => design(200, null, P31012);
    const a = B0(); a.snapshot.method.selected = 'measured_220_87'; expectNoOutputs(run(a, d()), 'METHOD_UNSUPPORTED');
    const n208 = B0(); n208.snapshot.supply.topology = '1ph_3w_120_208_network'; n208.snapshot.supply.vLineToLine = 208; expectNoOutputs(run(n208, d()), 'SUPPLY_UNSUPPORTED');
    const apt = B0(); apt.snapshot.occupancy = 'dwelling_unit_apartment'; expectNoOutputs(run(apt, d()), 'OCCUPANCY_UNSUPPORTED');
    expectNoOutputs(run(caseReq('LC82-feeder'), d()), 'PURPOSE_UNSUPPORTED');
    expectNoOutputs(run(B0(), design(200, { wholeDwelling: false }, P31012)), 'PARTIAL_DWELLING_UNSUPPORTED');
    expectNoOutputs(run(B0(), design(200, { singleConductorSet: false }, P31012)), 'PARALLEL_SETS_UNSUPPORTED');
    expectNoOutputs(run(B0(), design(200, { noAdditionalSources: false }, P31012)), 'ADDITIONAL_SOURCES_UNSUPPORTED');
    const stale = B0(); stale.snapshot.optional82.inventoryComplete.basis.members[0].basisId = 'bs-old'; expectNoOutputs(run(stale, d()), 'CALC_NOT_COMPLETE');
  });
});

describe('Invalid design input: no stage output at all', () => {
  const bad = [
    ['string boolean', design(200, { oneMainDisconnect: 'true' })], ['numeric boolean', design(200, null, { terminationMaterialCompatible: 1 })],
    ['NaN rating', design(NaN)], ['Infinity rating', design(Infinity)], ['-Infinity rating', design(-Infinity)], ['negative rating', design(-200)], ['negative zero rating', design(-0)], ['string rating', design('200')],
    ['NaN ambient', design(200, null, { ambientTempC: NaN })], ['negative ambient', design(200, null, { ambientTempC: -5 })], ['Infinity CCC', design(200, null, { currentCarryingConductors: Infinity })], ['negative CCC', design(200, null, { currentCarryingConductors: -3 })],
    ['negative termination temperature', design(200, null, { terminationTempRatingC: -75 })], ['empty material', design(200, null, { material: '' })], ['numeric material', design(200, null, { material: 1 })],
    ['unknown top-level key enableProduction', Object.assign(design(200), { enableProduction: true })], ['source attestation key', Object.assign(design(200), { sourceVerified: true })],
    ['freshness declaration key', design(200, { freshAfterCalculate: true })], ['unknown conductor key', design(200, null, { use90C: true })],
    ['array design', [200]], ['plan array', Object.assign(design(200), { plan: [] })], ['string design', '200'],
  ];
  // R2 added: provenance / qualification / table forgeries are unknown keys too
  const forged = [
    ['qualification revalidation claim', Object.assign(design(200, null, P31012), { qualificationRevalidated: true })],
    ['interpretation acceptance claim', design(200, { interpretationAccepted: true }, P31012)],
    ['caller-supplied table row', design(200, null, Object.assign({ tableOverride: [[200, '4', '2']] }, P31012))],
    ['caller-supplied ampacity', design(200, null, { ampacity75CA: 300 })],
    ['caller-supplied qualification ampacity', Object.assign(design(200), { conductorAmpacityA: 175 })],
    ['caller-supplied source record', Object.assign(design(200), { sources: { P_310_12_B: { sha256: 'x' } } })],
    ['installation approval claim', Object.assign(design(200), { installationApproved: true })],
  ];
  for (const [name, d] of bad.concat(forged)) {
    test(`${name} → DESIGN_INVALID`, () => {
      const r = run(B0(), d);
      assert.strictEqual(r.status, 'DESIGN_INVALID'); assert.ok(r.designProblems.length > 0);
      assert.strictEqual(r.minimumService.status, 'not_computed'); assert.strictEqual(r.chosenMain.status, 'not_evaluated'); assert.strictEqual(r.ungroundedConductors.status, 'not_evaluated');
    });
  }
});

describe('Safety contract of the module', () => {
  test('exports: analyzePrototype, no production flag / bypass; constants frozen; flags cannot be flipped', () => {
    assert.strictEqual(typeof S.analyzePrototype, 'function');
    for (const k of Object.keys(S)) assert.ok(!/enable|production|bypass|override|attest|verified/i.test(k), k);
    assert.deepStrictEqual(Object.assign({}, S.SAFETY_FLAGS), { operative: false, ruleReview: 'SCOPED_PRIMARY_TEXT_RECEIVED_INTERPRETATION_OPEN', installationApproved: false, globalCodeCompliance: 'not_verified' });
    for (const c of [S.SAFETY_FLAGS, S.SOURCE_REVIEW, S.STANDARD_RATINGS_SUBSET, S.TABLE_310_16_75C, S.TABLE_310_16_75C.Cu, S.TABLE_310_12, S.SOURCES, S.STAGE_EVIDENCE]) assert.ok(Object.isFrozen(c));
    const r = run(B0(), design(200)); assert.throws(() => { r.installationApproved = true; }, TypeError); assert.throws(() => { r.ungroundedConductors.size = '1'; }, TypeError);
    const src = fs.readFileSync(path.join(ROOT, 'src', 'calc', 'loadCalcServiceSizing.js'), 'utf8');
    assert.ok(!/process\.env|localStorage|require\([^)]*(wireSizing|loadCalcStorage)/.test(src), 'no environment bypass, no generic Wire Sizer, no storage');
    assert.deepStrictEqual((src.match(/require\([^)]*\)/g) || []).sort(), ["require('./loadCalcFacade.js')", "require('./loadCalcInputV2.js')"]);
  });
  test('source ids referenced by reasons exist; review stays open with the seven outstanding NEC 2020 items', () => {
    // R2: primary text received for the bounded profile; the review stays open for interpretation, not for missing text
    const r = run(B0(), design(200)); const ids = new Set(Object.keys(S.SOURCES));
    for (const x of allReasons(r)) for (const id of x.sourceIds) assert.ok(ids.has(id), id);
    assert.strictEqual(S.SOURCE_REVIEW.primaryTextComplete, true); assert.strictEqual(S.SOURCE_REVIEW.closed, false); assert.ok(S.OPEN_INTERPRETATION_ITEMS.length >= 3);
    assert.ok(S.SOURCES.S3.role.includes('NOT a NEC 2020 primary source'));
    assert.ok(!JSON.stringify(S.SOURCE_REVIEW).includes('PENDING_NEC2020_PRIMARY') && !/primary text (is )?missing/i.test(JSON.stringify(S.SOURCE_REVIEW)));
  });
  test('an unexpected fault is thrown as ServiceSizingPrototypeError carrying the safety flags and the source-review warning', () => {
    const trap = new Proxy({}, { get() { throw new TypeError('boom'); }, ownKeys() { throw new TypeError('boom'); }, getOwnPropertyDescriptor() { throw new TypeError('boom'); } });
    assert.throws(() => S.analyzePrototype(trap, design(200)), (e) => e instanceof S.ServiceSizingPrototypeError && e.operative === false && e.installationApproved === false && e.globalCodeCompliance === 'not_verified'
      && e.ruleReview === 'SCOPED_PRIMARY_TEXT_RECEIVED_INTERPRETATION_OPEN' && e.sourceReview.closed === false && /interpretation items remain open/.test(e.message));
  });
  test('request-invalid and design-invalid results also carry the source-review warning', () => {
    const a = run({ apiVersion: 1 }, design(200)); const b = run(B0(), Object.assign(design(200), { enableProduction: true }));
    for (const r of [a, b]) { assert.ok(/no result is an installation instruction/.test(r.sourceReview.warning)); assert.strictEqual(r.installationApproved, false); assert.strictEqual(r.ungroundedConductors.recommendationAvailable, false); }
  });
  test('the accepted B82 result stays not_assessed for capacity/rating (the prototype layer is separate)', () => {
    const out = F.evaluateV2(B0());
    assert.strictEqual(out.result.existingCapacity.status, 'not_assessed'); assert.strictEqual(out.result.requiredCapacity.status, 'not_assessed'); assert.strictEqual(out.result.rating.status, 'not_assessed');
  });
});

// ─────────────────────────────── R2 additions ───────────────────────────────

describe('R2: minimum standard-rating candidate at all eleven exact boundaries', () => {
  // total VA = A/C + 18680 in B0 (A/C at 100 %); exact R x 240 VA and the smallest increments above it
  const next = { 100: 110, 110: 125, 125: 150, 150: 175, 175: 200, 200: 225, 225: 250, 250: 300, 300: 350, 350: 400, 400: null };
  for (const R of [100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400]) {
    test(`exactly ${R * 240} VA → ${R} A; +0.004 VA and +0.01 VA → ${next[R] === null ? 'unsupported' : `${next[R]} A`}`, () => {
      const ac = R * 240 - 18680;
      const at = run(setAc(B0(), ac), design());
      assert.strictEqual(at.calcBasis.totalExactE4, R * 240 * 10000); assert.strictEqual(at.minimumService.ratingA, R);
      assert.strictEqual(at.minimumService.governedBy, R === 100 ? 'floor_100A' : 'calculated_load');
      for (const [req, e4] of [[setDishwasher(setAc(B0(), ac), 1200.01), R * 2400000 + 40], [setAc(B0(), ac + 0.01), R * 2400000 + 100]]) {
        const over = run(req, design());
        assert.strictEqual(over.calcBasis.totalExactE4, e4);
        if (next[R] === null) { assert.strictEqual(over.minimumService.status, 'unsupported'); assert.match(over.minimumService.reasons[0].message, /product scope limit/); }
        else assert.strictEqual(over.minimumService.ratingA, next[R]);
      }
    });
  }
  test('exact 100 A vs a tiny amount above although both display "100.0 A"', () => {
    const a = run(setAc(B0(), 5320), design()); const b = run(setDishwasher(setAc(B0(), 5320), 1200.01), design());
    assert.strictEqual(a.calcBasis.lineADisplay, b.calcBasis.lineADisplay); assert.strictEqual(a.minimumService.ratingA, 100); assert.strictEqual(b.minimumService.ratingA, 110);
  });
  test('original B0 and edited B0 → minimum 100 A; neither the sizing path nor 83 % changes the minimum (no 125 %, no 0.83 on the load)', () => {
    for (const req of [B0(), setDishwasher(B0(), 1300)]) {
      const g = run(clone(req), design(200)); const p = run(clone(req), design(200, null, P31012));
      assert.strictEqual(g.minimumService.ratingA, 100); assert.strictEqual(p.minimumService.ratingA, 100);
      assert.strictEqual(JSON.stringify(g.minimumService), JSON.stringify(p.minimumService));
      assert.match(g.minimumService.meaning, /minimum STANDARD service-disconnect rating candidate/); assert.match(g.minimumService.meaning, /not an approved main breaker/);
    }
  });
  test('primary text is source-verified for the required scope, but nothing is installation-approved or globally compliant', () => {
    const r = run(B0(), design(200));
    assert.strictEqual(r.minimumService.sourceEvidence.primaryText, 'source_verified_bounded_profile');
    assert.ok(r.minimumService.sourceEvidence.sourceIds.includes('P_230_79') && r.minimumService.sourceEvidence.sourceIds.includes('P_240_6'));
    assert.strictEqual(r.minimumService.sourceEvidence.installationApproval, 'not_approved');
    assert.match(r.minimumService.sourceEvidence.productScope, /other and nonstandard ratings/);
    for (const k of Object.keys(S.STAGE_EVIDENCE)) assert.strictEqual(S.STAGE_EVIDENCE[k].installationApproval, 'not_approved', k);
    assert.strictEqual(r.installationApproved, false); assert.strictEqual(r.globalCodeCompliance, 'not_verified'); assert.strictEqual(r.sourceReview.closed, false);
    assert.ok(codes(r.minimumService).includes('STANDARD_RATING_CANDIDATE'));
  });
});

describe('R2: primary-source provenance is engine-owned and complete for the bounded profile', () => {
  test('eleven primary excerpt records with file ids, sha256 and clauses; manufacturer records are history only', () => {
    const P = Object.entries(S.SOURCES).filter(([, v]) => v.kind === 'nec2020_primary_excerpt');
    assert.strictEqual(P.length, 11);
    for (const [id, v] of P) { assert.match(v.fileId, /^file_[0-9a-f]{32}$/, id); assert.match(v.sha256, /^[0-9a-f]{64}$/, id); assert.ok(v.clauses.length > 0, id); assert.match(v.provenance, /not present in this sandbox/); }
    assert.strictEqual(S.SOURCES.P_310_12_B.sha256, '0d0e831e18ce7da25a5c814e2a7349d3284fe82140cbd704acb4b5b67d1c81de');
    assert.strictEqual(S.SOURCES.P_310_16_TABLE.fileId, 'file_00000000797481f6ae1acd3b993caf51');
    assert.strictEqual(S.SOURCES.P_110_14_C.sha256, 'a6a5fea44ff8d44e5ef032da02fa6960ca0f0aa01d91801f82733f7c567c2cbc');
    assert.strictEqual(S.SOURCES.P_230_79.sha256, '4d63d2ec6426e105a4914492f7465feb20af29691f791ed21e8f3d17bcdc0ff8');
    for (const id of ['S2', 'S3', 'S4', 'S5']) assert.match(S.SOURCES[id].kind, /^historical_/, id);
    for (const [k, v] of Object.entries(S.STAGE_EVIDENCE)) for (const id of v.sourceIds) { assert.ok(id in S.SOURCES, `${k}:${id}`); assert.ok(!HISTORY_ONLY.has(id), `${k}:${id}`); }
    assert.doesNotMatch(S.SOURCES.S1.title, /enacted/);
  });
  test('constants and provenance cannot be forged or mutated by a caller', () => {
    assert.throws(() => { S.SOURCES.P_310_12_B.sha256 = 'x'; }, TypeError);
    assert.throws(() => { S.TABLE_310_12[0][1] = '6'; }, TypeError);
    assert.throws(() => { S.TABLE_310_16_75C.Cu.push(['8', 50]); }, TypeError);
    assert.throws(() => { S.STAGE_EVIDENCE.minimumService.installationApproval = 'approved'; }, TypeError);
    assert.throws(() => { S.SOURCE_REVIEW.closed = true; }, TypeError);
    const r1 = run(B0(), design(200)); const r2 = run(B0(), design(100, null, P31012));
    assert.strictEqual(r1.sourceReview, S.SOURCE_REVIEW); assert.strictEqual(r2.sourceReview, S.SOURCE_REVIEW);
    assert.strictEqual(r2.ungroundedConductors.sourceEvidence, S.STAGE_EVIDENCE.dwelling_83pct_310_12);
  });
});

describe('R2: conditional Table 310.12 path (dwelling_83pct_310_12)', () => {
  // hand-written from the digest: [rating, Cu, Cu 75 °C ampacity, Al, Al 75 °C ampacity]
  const ROWS = [[100, '4', 85, '2', 90], [110, '3', 100, '1', 100], [125, '2', 115, '1/0', 120], [150, '1', 130, '2/0', 135], [175, '1/0', 150, '3/0', 155], [200, '2/0', 175, '4/0', 180],
    [225, '3/0', 200, '250', 205], [250, '4/0', 230, '300', 230], [300, '250', 255, '350', 250], [350, '350', 310, '500', 310], [400, '400', 335, '600', 340]];
  test('all eleven Table 310.12 rows for both materials, with the 75 °C Table 310.16 ampacity mapping and 83 %-of-rating arithmetic', () => {
    for (const [R, cu, cuA, al, alA] of ROWS) {
      for (const [mat, size, amp] of [['Cu', cu, cuA], ['Al', al, alA]]) {
        const u = run(B0(), design(R, null, Object.assign({ material: mat }, P31012))).ungroundedConductors;
        const t = u.tableCandidate;
        assert.deepStrictEqual([t.table, t.forRatingA, t.material, t.size, t.ampacity75CA], ['Table 310.12', R, mat, size, amp], `${mat} ${R}`);
        assert.strictEqual(t.sizeUnit, /^\d{3}$/.test(size) ? 'kcmil' : 'AWG');
        assert.deepStrictEqual(t.eightyThreePercentCheck, { selectedRatingA: R, thresholdE2: 83 * R, ampacity75CE2: amp * 100, satisfied: true });
        assert.strictEqual(t.sourceStatus, 'source_verified_conditional_table_fact');
        assert.strictEqual(u.qualificationConsistency.declaredQualificationAmpacityA, 200); assert.strictEqual(u.qualificationConsistency.candidateTableAmpacity75CA, amp);
        const expected = amp < 100 ? 'review_required' : amp === 200 ? 'premise_unchanged' : 'revalidation_required';
        assert.strictEqual(u.qualificationConsistency.status, expected, `${mat} ${R}`);
      }
    }
  });
  test('exported Table 310.12 and 75 °C rows equal the hand-written digest values', () => {
    assert.deepStrictEqual(S.TABLE_310_12.map((x) => [...x]), ROWS.map(([R, cu, , al]) => [R, cu, al]));
    assert.deepStrictEqual(S.TABLE_310_16_75C.Cu.slice(0, 2).map((x) => [...x]), [['4', 85], ['3', 100]]);
    assert.deepStrictEqual(S.TABLE_310_16_75C.Al.slice(0, 2).map((x) => [...x]), [['2', 90], ['1', 100]]);
  });
  test('100 A → Cu 4 (85 A) / Al 2 (90 A): conditional reference data kept, selection withheld, review_required — not a code-violation finding', () => {
    for (const [mat, size, amp] of [['Cu', '4', 85], ['Al', '2', 90]]) {
      const r = run(B0(), design(100, null, Object.assign({ material: mat }, P31012))); const u = r.ungroundedConductors;
      assert.strictEqual(r.minimumService.ratingA, 100); assert.strictEqual(r.chosenMain.status, 'meets_prototype_minimum');
      assert.strictEqual(u.status, 'table_candidate_conditional'); assert.strictEqual(u.recommendationAvailable, false); assert.strictEqual(u.size, null); assert.strictEqual(u.ampacity75CA, null);
      assert.deepStrictEqual([u.tableCandidate.size, u.tableCandidate.ampacity75CA, u.tableCandidate.conditional], [size, amp, true]);
      assert.strictEqual(u.qualificationConsistency.status, 'review_required'); assert.deepStrictEqual(codes(u.qualificationConsistency), ['B82_310_12_INTERPRETATION_PENDING']);
      assert.match(u.qualificationConsistency.reasons[0].message, /open model\/premise interpretation item/);
      assert.ok(!/violat|illegal|prohibit|not permitted/i.test(JSON.stringify([r.minimumService, r.chosenMain, u])), 'no statutory-violation wording');
      assert.ok(!codes(u).some((c) => /UNSUPPORTED|UNDERSIZED/.test(c)), '310.12 path does not enforce ampacity >= breaker');
      assert.strictEqual(r.qualificationEcho.conductorAmpacityA, 200);
    }
  });
  test('200 A → Cu 2/0 (175 A) / Al 4/0 (180 A) with declared qualification 200 A → changed premise, revalidation_required', () => {
    for (const [mat, size, amp] of [['Cu', '2/0', 175], ['Al', '4/0', 180]]) {
      const u = run(B0(), design(200, null, Object.assign({ material: mat }, P31012))).ungroundedConductors;
      assert.deepStrictEqual([u.status, u.recommendationAvailable, u.size, u.tableCandidate.size, u.tableCandidate.ampacity75CA], ['table_candidate_conditional', false, null, size, amp]);
      assert.strictEqual(u.qualificationConsistency.status, 'revalidation_required'); assert.deepStrictEqual(codes(u.qualificationConsistency), ['QUALIFICATION_PREMISE_CHANGED']);
      assert.match(u.qualificationConsistency.reasons[0].message, /not proved invalid/);
      assert.strictEqual(u.qualificationConsistency.declaredQualificationAmpacityA, 200);
    }
  });
  test('equal predicate: declared qualification 175 A, chosen 200 A, 310.12 Cu 2/0 (175 A) → premise unchanged, candidate available (still non-operative)', () => {
    const r = run(setQual(B0(), 175), design(200, null, P31012)); const u = r.ungroundedConductors;
    assert.strictEqual(r.calcBasis.calcStatus, 'COMPLETE');
    assert.deepStrictEqual([u.status, u.recommendationAvailable, u.size, u.sizeUnit, u.ampacity75CA, u.sizedForRatingA], ['experimental_candidate', true, '2/0', 'AWG', 175, 200]);
    assert.strictEqual(u.qualificationConsistency.status, 'premise_unchanged'); assert.strictEqual(r.installationApproved, false);
    const al = run(setQual(B0(), 180), design(200, null, Object.assign({ material: 'Al' }, P31012))).ungroundedConductors;
    assert.deepStrictEqual([al.status, al.size], ['experimental_candidate', '4/0']);
  });
  test('>= 100 A changed qualification (revalidation_required) versus < 100 A interpretation gate (review_required) use distinct reasons', () => {
    const cu110 = run(B0(), design(110, null, P31012)).ungroundedConductors;   // Cu 3 = 100 A, declared 200
    assert.deepStrictEqual([cu110.tableCandidate.size, cu110.tableCandidate.ampacity75CA, cu110.qualificationConsistency.status], ['3', 100, 'revalidation_required']);
    const cu100 = run(B0(), design(100, null, P31012)).ungroundedConductors;   // Cu 4 = 85 A
    assert.strictEqual(cu100.qualificationConsistency.status, 'review_required');
    assert.notDeepStrictEqual(codes(cu110.qualificationConsistency), codes(cu100.qualificationConsistency));
    const eq = run(setQual(B0(), 100), design(110, null, P31012)).ungroundedConductors;   // caller deliberately declared 100 A
    assert.deepStrictEqual([eq.qualificationConsistency.status, eq.size], ['premise_unchanged', '3']);
    const stillGate = run(setQual(B0(), 100), design(100, null, P31012)).ungroundedConductors;   // 85 A < 100 A regardless of declaration
    assert.strictEqual(stillGate.qualificationConsistency.status, 'review_required'); assert.strictEqual(stillGate.size, null);
  });
  test('90 °C insulation never uses the 90 °C ampacity on the 310.12 path', () => {
    const u = run(setQual(B0(), 175), design(200, null, Object.assign({ insulationTempRatingC: 90 }, P31012))).ungroundedConductors;
    assert.strictEqual(u.tableCandidate.ampacity75CA, 175); assert.strictEqual(u.size, '2/0'); assert.match(u.conditions.insulation, /no 90 °C ampacity/);
  });
  test('the path sizes for the explicit selected rating, never for the 98.8 A calculation nor the 200 A qualification', () => {
    const r = run(setDishwasher(B0(), 1300), design(150, null, P31012)); const u = r.ungroundedConductors;
    assert.strictEqual(r.calcBasis.lineADisplay, '98.8 A'); assert.strictEqual(u.tableCandidate.forRatingA, 150); assert.strictEqual(u.tableCandidate.size, '1');
    const none = run(B0(), design(undefined, null, P31012)); assert.strictEqual(none.ungroundedConductors.status, 'not_evaluated'); assert.strictEqual(none.ungroundedConductors.tableCandidate, null);
  });
});

describe('R2: qualification-consistency contract (general path, no mutation, no default)', () => {
  test('declared and candidate ampacities are kept separately; request, qualification and calculation are never changed', () => {
    const req = deepFreeze(B0()); const before = JSON.stringify(req); const facadeBefore = JSON.stringify(F.evaluateV2(req).result);
    for (const d of [design(100), design(200), design(200, null, { material: 'Al' }), design(100, null, P31012), design(200, null, P31012)]) {
      const r = run(req, d); const q = r.ungroundedConductors.qualificationConsistency;
      assert.strictEqual(q.declaredQualificationAmpacityA, 200); assert.strictEqual(r.qualificationEcho.conductorAmpacityA, 200);
      assert.strictEqual(q.candidateTableAmpacity75CA, r.ungroundedConductors.tableCandidate.ampacity75CA);
      assert.match(q.note, /never replaced/);
    }
    assert.strictEqual(JSON.stringify(req), before); assert.strictEqual(JSON.stringify(F.evaluateV2(req).result), facadeBefore);
  });
  test('general path: a caller that deliberately revalidates (declares 205 A for Al 250 kcmil) gets premise_unchanged', () => {
    const before = run(B0(), design(200, null, { material: 'Al' })).ungroundedConductors;
    assert.deepStrictEqual([before.qualificationConsistency.status, before.size], ['revalidation_required', null]);
    const after = run(setQual(B0(), 205), design(200, null, { material: 'Al' })).ungroundedConductors;
    assert.deepStrictEqual([after.qualificationConsistency.status, after.size, after.sizeUnit, after.ampacity75CA], ['premise_unchanged', '250', 'kcmil', 205]);
    const cu100 = run(setQual(B0(), 100), design(100)).ungroundedConductors;
    assert.deepStrictEqual([cu100.status, cu100.size], ['experimental_candidate', '3']);
  });
  test('general path: changed premise uses QUALIFICATION_PREMISE_CHANGED, never the 310.12 interpretation code', () => {
    const u = run(B0(), design(100)).ungroundedConductors;
    assert.deepStrictEqual(codes(u.qualificationConsistency), ['QUALIFICATION_PREMISE_CHANGED']);
  });
});

describe('R2: remaining site review and refusal sweep', () => {
  test('generic raceway input carries a separate NYC 230.43 remaining-review note and never claims method eligibility', () => {
    for (const d of [design(200), design(200, null, P31012)]) {
      const r = run(B0(), d);
      assert.match(r.ungroundedConductors.conditions.wiringMethodNote, /230\.43/); assert.match(r.ungroundedConductors.conditions.wiringMethodNote, /not verified/);
      assert.ok(r.remainingChecks.some((c) => /230\.43/.test(c) && /not verified/.test(c)));
      assert.ok(r.remainingChecks.some((c) => /torque/.test(c)) && r.ungroundedConductors.notSized.includes('terminal torque (110.14(D))'));
    }
  });
  test('no refusal or waiting state anywhere yields an unconditional conductor recommendation', () => {
    const cases = [
      [B0(), design()], [B0(), design(90, null, P31012)], [setAc(B0(), 5320.01), design(100, null, P31012)], [B0(), design(200, { intent: 'existing_service_evaluation' }, P31012)],
      [B0(), design(200, null, Object.assign({ terminationTempRatingC: null }, P31012))], [B0(), design(200, null, Object.assign({ terminationTempRatingC: 60 }, P31012))],
      [B0(), design(200, null, Object.assign({ ambientTempC: 40, currentCarryingConductors: 4, noOtherAdjustmentOrCorrection: false, wiringMethod: 'type_MC_cable' }, P31012))],
      [B0(), design(200, null, Object.assign({ material: 'CCA' }, P31012))], [setAc(B0(), 90000), design(400, null, P31012)], [{ apiVersion: 1 }, design(200, null, P31012)],
    ];
    for (const [req, d] of cases) {
      const u = run(req, d).ungroundedConductors;
      assert.strictEqual(u.recommendationAvailable, false); assert.strictEqual(u.size, null); assert.strictEqual(u.tableCandidate, null);
    }
  });
});
