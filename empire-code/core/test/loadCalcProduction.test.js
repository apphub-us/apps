'use strict';
/**
 * EC-CALC-2 / B2 — production-path tests for the shipped Load Calc adapter.
 *
 * These execute the REAL adapter block and the REAL shared Favorites functions
 * extracted from mobile.html against the SHIPPED generated bundle (window.EC),
 * on a recording stub DOM (test/helpers/loadCalcDom.js). Nothing here
 * re-implements the engine; assertions read what the adapter stored (the
 * canonical draft) and what it rendered (text nodes). Real-browser events,
 * native badInput and persisted reload are covered by tools/loadcalc-check-mobile.js
 * and test/loadCalcPersistence.test.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildHarness } = require('./helpers/loadCalcDom');
const H = require('./helpers/loadCalcFixtures');

const PROFILE = 'A_measured_87_core';
const EMPTY = () => buildHarness().EC.loadCalcState.createEmptySnapshot();
function annual(h, rating) {
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcHouseFeeder', 'yes100'); h.set('lcHouseState', 'meter');
  h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_all_LL'); h.set('lcBasis', 'annual_max_demand');
  h.set('lcReadingValue', '40000'); h.set('lcAnnualData', 'yes'); h.set('lcPeriodMonths', '12');
  h.set('lcServiceRatingA', rating || '200'); h.set('lcServiceOverload', 'yes'); h.set('lcNewLoadMode', 'none');
}
function thirtyPerConductor(h) {
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'measured_220_87'); h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_declared_legs'); h.set('lcDeclUnityPF', 'yes');
  h.set('lcBasis', '30d_recording_exception'); h.set('lcReadingUnit', 'A'); h.set('lcReadingScope', 'per_conductor'); h.set('lcReadL1', '140'); h.set('lcReadL2', '20');
  h.set('lcAnnualData', 'no'); h.set('lcPeriodDays', '30'); h.set('lcIntervalMinutes', '15'); h.set('lcContinuousRecording', 'yes'); h.set('lcConnectedTo', 'each_conductor');
  for (const id of ['lcBasedOnInitialLoading', 'lcRecordedWhileOccupied', 'lcIncludesLargerOfHeatingOrCooling', 'lcIncludesPeriodicSeasonalLoads']) h.set(id, 'yes');
  for (const id of ['lcHasRenewableEnergySystem', 'lcHasPeakLoadShaving']) h.set(id, 'no');
  h.set('lcServiceRatingA', '150'); h.set('lcServiceOverload', 'yes');
  h.set('lcNewLoadMode', 'precalculated'); h.set('lcTermVA', '3600'); h.set('lcTermConnection', 'LN'); h.set('lcTermLeg', 'L2'); h.set('lcTermEstablished', 'yes'); h.set('lcTermBasisMethod', 'other_stated'); h.set('lcTermCalculatedBy', 'engineer'); h.set('lcTermDemandFactors', 'yes');
}
/** add a preset load through the real add row, then set its selects: [category, classification, status, connection, (leg), continuous] */
function addLoad(h, presetIndex, va, status, connection, leg) {
  h.$('lcPresetName').value = String(presetIndex); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click');
  const card = h.$('lcLoads').querySelectorAll('.lc-load').slice(-1)[0];
  const sel = () => card.querySelectorAll('select');
  if (status !== undefined) { sel()[2].value = status; sel()[2].dispatch('change'); }
  if (connection !== undefined) { sel()[3].value = connection; sel()[3].dispatch('change'); }
  const card2 = h.$('lcLoads').querySelectorAll('.lc-load').slice(-1)[0];
  if (leg !== undefined) { const s = card2.querySelectorAll('select'); s[4].value = leg; s[4].dispatch('change'); }
  return h.$('lcLoads').querySelectorAll('.lc-load').slice(-1)[0];
}
const codes = (r) => r.problems.map((p) => p.code + ':' + p.field);

describe('B2 PRODUCTION — the adapter is thin: one draft, one parser path, one engine call', () => {
  test('adapter source: no demand arithmetic, rating thresholds, innerHTML or legacy formulas; exactly one evaluate call site; accepted parsers used', () => {
    const src = buildHarness().adapterSrc;
    for (const bad of [/1\.25/, /1\.732/, /Math\.sqrt/, /toFixed\(/, /serviceSize/, /Min Service/, /\/ 240\b/, /\* 3\b/, /lcTable22084/, /innerHTML/, /600 A/]) assert.ok(!bad.test(src), 'adapter must not contain ' + bad);
    assert.strictEqual((src.match(/\.evaluate\(/g) || []).length, 0, 'no direct A engine call site any more (LC-22082-B0-UI-INTEGRATION-1 ledger L-2)');
    assert.strictEqual((src.match(/loadCalcFacade\.evaluateV2\(/g) || []).length, 1, 'exactly one evaluation call site: the accepted facade in lcUpdate');
    assert.strictEqual((src.match(/loadCalcStateV2\.toRequestV2\(/g) || []).length >= 1, true, 'the canonical request comes from the accepted state helper');
    // ledger L-2: the blank draft comes from loadCalcStateV2.createEmptyDraftV2 (built on the unchanged createEmptySnapshot); payload validation and legacy migration now run inside the accepted storage module
    assert.ok(/loadCalcInput\.parseNumberField/.test(src) && /loadCalcInput\.parseEnumField/.test(src) && /loadCalcStateV2\.createEmptyDraftV2/.test(src) && /loadCalcState\.migrateLegacyRecord/.test(src) && /loadCalcState\.captureCoversSnapshot/.test(src) && /loadCalcState\.setOccupancy/.test(src) && /loadCalcStorageV2\.validatePayloadV3/.test(src) && /loadCalcStorageV2\.toPayloadV3/.test(src) && /loadCalcStorageV2\.upgradeToDraftV2/.test(src) && /loadCalcStateV2\.newLoadRecord/.test(src) && /loadCalcStateV2\.toRequestV2/.test(src) && /loadCalcFacade\.evaluateV2/.test(src), 'accepted helpers are the only data/validation/evaluation paths');
    assert.strictEqual((src.match(/captureCoversSnapshot\(/g) || []).length, 1, 'coversSnapshot is captured in exactly one place: the explicit Confirm button');
    assert.ok(/schemaVersion/.test(JSON.stringify(EMPTY())) && EMPTY().schemaVersion === '3.2.1', 'the A empty snapshot stays 3.2.1 (unchanged accepted helper)');
    assert.strictEqual(buildHarness().EC.loadCalcStateV2.createEmptyDraftV2().snapshot.schemaVersion, '3.3.0', 'the V2 draft the form now starts from is 3.3.0 (ledger L-3)');
  });
  test('Init builds the form from the contract empty snapshot (purpose service, everything else unknown), evaluates once -> EMPTY; Reset returns to the identical state', () => {
    const h = buildHarness(); h.api.lcInit();
    let s = h.state();
    const BLANK = () => h.EC.loadCalcStateV2.createEmptyDraftV2().snapshot;
    assert.deepStrictEqual(s.snapshot, BLANK()); assert.deepStrictEqual(s.context, { importedFrom: null, methodConfirmedAfterImport: false });
    assert.deepStrictEqual(h.EC.loadCalcInputV2.downConvertToA(s.lastRequest).snapshot, EMPTY(), 'the A projection of the blank V2 draft is the accepted empty A snapshot (ledger L-3)');
    assert.deepStrictEqual(h.EC.loadCalcInputV2.downConvertToA(s.lastRequest).snapshot, H.caseById('T-S-08').envelope.snapshot);
    assert.strictEqual(s.result.status, 'EMPTY'); assert.strictEqual(s.evaluations, 1); assert.deepStrictEqual(s.parseErrors, []);
    assert.strictEqual(s.snapshot.loads.length, 0); assert.strictEqual(s.snapshot.measurement, null);
    annual(h); addLoad(h, 0, 12000, 'new'); assert.notDeepStrictEqual(h.state().snapshot, BLANK());
    h.api.lcReset(); s = h.state();
    assert.deepStrictEqual(s.snapshot, BLANK()); assert.deepStrictEqual(s.parseErrors, []); assert.strictEqual(s.result.status, 'EMPTY'); assert.strictEqual(s.fault, null); assert.strictEqual(s.sourceFavId, null);
    assert.ok(!/Min Service|recommended|2-pole|Neutral load calculated per/.test(h.text()));
  });
  test('one engine call per user update; the rendered result is the engine\'s (poisoned engine output is placed verbatim, nothing recomputed)', () => {
    const calls = [];
    const h = buildHarness({ engine: (EC) => Object.assign({}, EC.loadCalc, { evaluate: (env, o) => { calls.push(JSON.stringify(env)); return EC.loadCalc.evaluate(env, o); } }) });
    h.api.lcInit(); assert.strictEqual(calls.length, 1);
    h.set('lcOccupancy', 'dwelling_unit_house'); assert.strictEqual(calls.length, 2);
    h.set('lcMethod', 'measured_220_87'); h.set('lcReadingValue', '4'); assert.strictEqual(calls.length, 4);
    assert.deepStrictEqual(JSON.parse(calls[3]).parseErrors, []); assert.strictEqual(JSON.parse(calls[3]).snapshot.measurement.reading.value, 4); assert.strictEqual(JSON.parse(calls[3]).profileId, PROFILE);
    const poison = buildHarness({ engine: (EC) => Object.assign({}, EC.loadCalc, { evaluate: (env) => { const r = EC.loadCalc.evaluate(env); r.status = 'COMPLETE'; r.display.strings.totalVA = 'POISON-TOTAL'; r.demand.lines = [{ id: 'x', label: 'poison line', op: 'identity', operands: [], factor: null, divisorV: null, powerFactor: null, conductor: null, result: { value: 4242, unit: 'VA' }, ruleRef: null, amended: false, ruleStatus: 'user_supplied', loadIds: [] }]; r.demand.status = 'complete'; r.demand.unit = 'VA'; r.existingCapacity = { status: 'not_assessed', ruleRef: '220.87(2)', amended: true, blockingCode: 'MISSING_FIELD', comparisons: [] }; return r; } }) });
    poison.api.lcInit(); const t = poison.text();
    assert.ok(/POISON-TOTAL/.test(t) && /poison line/.test(t) && /4,242 VA/.test(t) && /NOT ASSESSED/.test(t), t.slice(0, 300));
  });
  test('LoadCalcEnvelopeError / SCHEMA_INVALID from the engine is caught: old success discarded, explicit INPUT REJECTED shown, no forged result', () => {
    let boom = false;
    const h = buildHarness({ engine: (EC) => Object.assign({}, EC.loadCalc, { evaluate: (env, o) => { if (boom) throw new EC.loadCalc.LoadCalcEnvelopeError(['snapshot.x: injected']); return EC.loadCalc.evaluate(env, o); } }) });
    h.api.lcInit(); annual(h); assert.strictEqual(h.state().result.status, 'COMPLETE'); assert.ok(/INADEQUATE/.test(h.text()));
    boom = true; h.set('lcReadingValue', '41000');
    const s = h.state(); assert.strictEqual(s.result, null); assert.strictEqual(s.fault.kind, 'input'); assert.ok(/INPUT REJECTED/.test(h.text()) && /injected/.test(h.text()) && !/INADEQUATE|50,000|COMPLETE/.test(h.text()), h.text().slice(0, 200));
    boom = false; h.set('lcReadingValue', '40000'); assert.strictEqual(h.state().fault, null); assert.strictEqual(h.state().result.status, 'COMPLETE');
  });
});

describe('B2 PRODUCTION — input transport through the accepted parsers', () => {
  test('annual route: valid -> each field missing / unknown / unqualified and back; every non-COMPLETE state removes lines and verdict', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h);
    assert.strictEqual(h.state().result.status, 'COMPLETE'); assert.strictEqual(h.state().result.demand.totalVA, 50000); assert.strictEqual(h.state().result.existingCapacity.status, 'inadequate');
    const steps = [['lcPeriodMonths', '11', 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED:measurement.periodMonths'], ['lcPeriodMonths', '', 'INCOMPLETE_INPUT', 'MISSING_FIELD:measurement.periodMonths'], ['lcPeriodMonths', '12', 'COMPLETE', null],
      ['lcAnnualData', '', 'INCOMPLETE_INPUT', 'QUALIFICATION_UNKNOWN:measurement.annualDataAvailable'], ['lcAnnualData', 'no', 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED:measurement.annualDataAvailable'], ['lcAnnualData', 'yes', 'COMPLETE', null],
      ['lcServiceOverload', '', 'INCOMPLETE_INPUT', 'QUALIFICATION_UNKNOWN:measurement.existing.serviceOverloadPer230_90'], ['lcServiceOverload', 'no', 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED:measurement.existing.serviceOverloadPer230_90'], ['lcServiceOverload', 'yes', 'COMPLETE', null],
      ['lcReadingValue', '', 'INCOMPLETE_INPUT', 'MISSING_FIELD:measurement.reading.value'], ['lcReadingValue', '-5', 'INVALID_INPUT', 'OUT_OF_RANGE:measurement.reading.value'], ['lcReadingValue', '40000', 'COMPLETE', null],
      ['lcServiceRatingA', '', 'COMPLETE', 'MISSING_FIELD:measurement.existing.serviceRatingA'], ['lcServiceRatingA', '200', 'COMPLETE', null],   // B2-r1 (R-B2-05): an optional blank is null, demand still completes, the verdict is not assessed
      ['lcModel', '', 'INCOMPLETE_INPUT', 'MISSING_FIELD:loadModel.kind'], ['lcModel', 'split_240_all_LL', 'COMPLETE', null],
      ['lcNewLoadMode', '', 'INCOMPLETE_INPUT', 'MISSING_FIELD:measurement.newLoad.mode'], ['lcNewLoadMode', 'none', 'COMPLETE', null]];
    for (const [id, v, status, code] of steps) {
      h.set(id, v); const s = h.state(); const t = h.text();
      assert.strictEqual(s.result.status, status, `${id}=${v}: ${codes(s.result)}`);
      if (code) assert.ok(codes(s.result).includes(code), `${id}=${v}: ${codes(s.result)}`);
      if (status !== 'COMPLETE') { assert.deepStrictEqual(s.result.demand.lines, []); assert.strictEqual(s.result.existingCapacity.status, 'not_assessed'); assert.ok(!/INADEQUATE|Total demand|50,000/.test(t)); }
      else if (id === 'lcServiceRatingA' && v === '') { assert.strictEqual(s.result.demand.totalVA, 50000); assert.strictEqual(s.result.existingCapacity.status, 'not_assessed'); assert.strictEqual(s.result.existingCapacity.blockingCode, 'MISSING_FIELD'); assert.deepStrictEqual(s.parseErrors, [], 'optional blank carries no parse error'); assert.ok(/50,000 VA/.test(t) && /NOT ASSESSED/.test(t) && !/INADEQUATE/.test(t)); }
      else assert.ok(/50,000 VA/.test(t) && /INADEQUATE/.test(t));
    }
  });
  test('30-day route: each exception field unknown / unqualified and back', () => {
    const h = buildHarness(); h.api.lcInit(); thirtyPerConductor(h); h.$('lcConfirmCovers').dispatch('click');
    assert.strictEqual(h.state().result.status, 'COMPLETE'); assert.strictEqual(h.state().result.demand.totalOnConductorA, 175);
    for (const [id, v, status, code] of [['lcPeriodDays', '29', 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED:measurement.periodDays'], ['lcPeriodDays', '', 'INCOMPLETE_INPUT', 'MISSING_FIELD:measurement.periodDays'], ['lcPeriodDays', '30', 'COMPLETE', null], ['lcIntervalMinutes', '16', 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED:measurement.intervalMinutes'], ['lcIntervalMinutes', '15', 'COMPLETE', null], ['lcContinuousRecording', '', 'INCOMPLETE_INPUT', 'QUALIFICATION_UNKNOWN:measurement.continuousRecording'], ['lcContinuousRecording', 'yes', 'COMPLETE', null], ['lcConnectedTo', 'unknown', 'INCOMPLETE_INPUT', 'QUALIFICATION_UNKNOWN:measurement.connectedTo'], ['lcConnectedTo', 'each_conductor', 'COMPLETE', null], ['lcHasPeakLoadShaving', 'yes', 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED:measurement.hasPeakLoadShaving'], ['lcHasPeakLoadShaving', 'no', 'COMPLETE', null], ['lcAnnualData', 'yes', 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED:measurement.annualDataAvailable'], ['lcAnnualData', 'no', 'COMPLETE', null]]) {
      h.set(id, v); const s = h.state(); assert.strictEqual(s.result.status, status, `${id}=${v}: ${codes(s.result)}`); if (code) assert.ok(codes(s.result).includes(code), `${id}=${v}: ${codes(s.result)}`);
    }
  });
  test('T-S-41: blank is null + parser MISSING_FIELD (never zero); malformed "12,3" keeps its raw text with NOT_FINITE (not the previous number); corrected value clears it', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h);
    h.set('lcReadingValue', ''); let s = h.state();
    assert.deepStrictEqual(s.parseErrors, [{ field: 'measurement.reading.value', raw: '', code: 'MISSING_FIELD' }]); assert.strictEqual(s.snapshot.measurement.reading.value, null); assert.strictEqual(s.result.status, 'INCOMPLETE_INPUT');
    assert.ok(s.result.problems.some((p) => p.field === 'measurement.reading.value' && p.code === 'MISSING_FIELD' && p.source === 'parser'));
    h.set('lcReadingValue', '12,3'); s = h.state();
    assert.deepStrictEqual(s.parseErrors, [{ field: 'measurement.reading.value', raw: '12,3', code: 'NOT_FINITE' }]); assert.strictEqual(s.snapshot.measurement.reading.value, null); assert.strictEqual(s.result.status, 'INVALID_INPUT');
    assert.ok(h.$('lcReadingValue').classList.contains('lc-invalid'));
    h.set('lcReadingValue', '40000'); s = h.state(); assert.deepStrictEqual(s.parseErrors, []); assert.strictEqual(s.result.status, 'COMPLETE'); assert.ok(!h.$('lcReadingValue').classList.contains('lc-invalid'));
  });
  test('native badInput: an empty DOM value with validity.badInput is the declared NOT_FINITE transport, never an intentional blank or a number', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h);
    const el = h.$('lcReadingValue'); el.value = ''; el.validity.badInput = true; el.dispatch('input');
    const s = h.state(); assert.deepStrictEqual(s.parseErrors, [{ field: 'measurement.reading.value', raw: '', code: 'NOT_FINITE' }]); assert.strictEqual(s.snapshot.measurement.reading.value, null); assert.strictEqual(s.result.status, 'INVALID_INPUT');
    assert.ok(/not a number/.test(h.text()));
    const q = h.$('lcPeriodMonths'); q.value = ''; q.validity.badInput = true; q.dispatch('input');
    assert.ok(h.state().parseErrors.some((p) => p.field === 'measurement.periodMonths' && p.code === 'NOT_FINITE'));
  });
  test('T-S-36 enum tamper: a select value outside the enum is UNKNOWN_ENUM with the raw text; the draft field becomes null; count boundary rejects an unsafe integer as typed', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h);
    h.set('lcTopology', '999'); let s = h.state();
    assert.deepStrictEqual(s.parseErrors, [{ field: 'supply.topology', raw: '999', code: 'UNKNOWN_ENUM' }]); assert.strictEqual(s.snapshot.supply.topology, null); assert.strictEqual(s.result.status, 'INVALID_INPUT');
    h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_all_LL'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    h.set('lcBasis', 'not_a_basis'); s = h.state(); assert.ok(s.parseErrors.some((p) => p.field === 'measurement.basis' && p.code === 'UNKNOWN_ENUM')); assert.strictEqual(s.snapshot.measurement.basis, null);
    h.set('lcBasis', 'annual_max_demand'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    h.set('lcPeriodMonths', '9007199254740993'); s = h.state(); assert.deepStrictEqual(s.parseErrors, [{ field: 'measurement.periodMonths', raw: '9007199254740993', code: 'OUT_OF_RANGE' }]); assert.strictEqual(s.snapshot.measurement.periodMonths, null); assert.strictEqual(s.result.status, 'INVALID_INPUT');
    h.set('lcPeriodMonths', '2.5'); assert.strictEqual(h.state().parseErrors[0].code, 'NOT_INTEGER');
    h.set('lcPeriodMonths', '12'); assert.strictEqual(h.state().result.status, 'COMPLETE');
  });
  test('topology is an explicit enum: labels never change meaning; supply fields follow the table; per-conductor inputs are revealed by topology (no fictitious L3 on split-phase)', () => {
    const h = buildHarness(); h.api.lcInit(); h.set('lcMethod', 'measured_220_87'); h.set('lcReadingUnit', 'A'); h.set('lcReadingScope', 'per_conductor');
    const shown = (k) => h.dom.document.querySelectorAll('.lc-per-' + k).every((el) => el.style.display !== 'none');
    h.set('lcTopology', '1ph_3w_120_240'); assert.deepStrictEqual(h.state().snapshot.supply, { topology: '1ph_3w_120_240', vLineToLine: 240, vLineToNeutral: 120, phases: 1, wires: 3 }); assert.ok(shown('L1') && shown('L2') && !shown('L3'));
    h.set('lcTopology', '3ph_4w_208Y_120'); assert.deepStrictEqual(h.state().snapshot.supply, { topology: '3ph_4w_208Y_120', vLineToLine: 208, vLineToNeutral: 120, phases: 3, wires: 4 }); assert.ok(shown('L1') && shown('L2') && shown('L3'));
    h.set('lcTopology', '1ph_2w_120'); assert.ok(shown('L1') && !shown('L2') && !shown('L3'));
    h.set('lcTopology', 'other'); assert.deepStrictEqual(h.state().snapshot.supply, { topology: 'other', vLineToLine: null, vLineToNeutral: null, phases: null, wires: null }); assert.strictEqual(h.state().result.status, 'UNSUPPORTED_SCOPE');
    h.set('lcTopology', ''); assert.deepStrictEqual(h.state().snapshot.supply, EMPTY().supply);
    assert.deepStrictEqual(h.api.lcRevealedConductors('1ph_2w_240'), ['L1', 'L2']); assert.deepStrictEqual(h.api.lcRevealedConductors('3ph_3w_480_delta'), ['L1', 'L2', 'L3']); assert.deepStrictEqual(h.api.lcRevealedConductors(null), []);
    assert.deepStrictEqual(h.api.lcModelOptions('1ph_2w_120').map((o) => o[0]), ['', 'single_2w']); assert.ok(h.api.lcModelOptions('1ph_3w_120_240').map((o) => o[0]).includes('split_240_declared_legs'));
  });
  test('per-conductor completeness through the form: complete -> each required reading blank -> restored; a hidden L3 stays null in the map', () => {
    const h = buildHarness(); h.api.lcInit(); thirtyPerConductor(h); h.$('lcConfirmCovers').dispatch('click');
    let s = h.state(); assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.result.demand.totalOnConductorA, 175); assert.strictEqual(s.result.existingCapacity.status, 'inadequate'); assert.deepStrictEqual(s.snapshot.measurement.readingsPerConductor, { L1: 140, L2: 20, L3: null });
    for (const k of ['L1', 'L2']) {
      h.set('lcRead' + k, ''); s = h.state();
      assert.strictEqual(s.result.status, 'INCOMPLETE_INPUT', k); assert.deepStrictEqual(codes(s.result), ['MISSING_FIELD:measurement.readingsPerConductor.' + k]); assert.deepStrictEqual(s.result.demand.lines, []); assert.strictEqual(s.result.existingCapacity.status, 'not_assessed');
      assert.strictEqual(s.snapshot.measurement.readingsPerConductor[k], null, 'the blank stays in the map as null');
      h.set('lcRead' + k, k === 'L1' ? '140' : '20'); assert.strictEqual(h.state().result.demand.totalOnConductorA, 175);
    }
    h.set('lcReadL2', '0'); assert.deepStrictEqual(codes(h.state().result), ['OUT_OF_RANGE:measurement.readingsPerConductor.L2']);
    h.set('lcReadL2', '20'); assert.strictEqual(h.state().result.status, 'COMPLETE');
  });
});

describe('B2 PRODUCTION — guide, method, occupancy and unsupported methods', () => {
  test('guide recommendation follows the answers; manual selection is kept; clearing occupancy clears only a guide-selected method (setOccupancy)', () => {
    const h = buildHarness(); h.api.lcInit();
    h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcHouseFeeder', 'yes100'); h.set('lcHouseState', 'meter');
    let m = h.state().snapshot.method; assert.deepStrictEqual([m.selected, m.selectionSource, m.guideRecommendation], ['measured_220_87', 'guide', 'measured_220_87']);
    assert.ok(/Guide suggests: NEC 220\.87/.test(h.$('lcGuideResult').textContent));
    h.set('lcHouseState', 'new'); m = h.state().snapshot.method; assert.deepStrictEqual([m.selected, m.selectionSource], ['opt_220_82', 'guide']);
    h.set('lcMethod', 'measured_220_87'); m = h.state().snapshot.method; assert.deepStrictEqual([m.selected, m.selectionSource], ['measured_220_87', 'manual']);
    h.set('lcHouseState', 'existing'); m = h.state().snapshot.method; assert.deepStrictEqual([m.selected, m.selectionSource, m.guideRecommendation], ['measured_220_87', 'manual', 'existing_220_83'], 'guide never overwrites a manual choice');
    assert.ok(/Your manual selection is kept/.test(h.$('lcGuideResult').textContent));
    h.set('lcOccupancy', ''); m = h.state().snapshot.method; assert.deepStrictEqual([m.selected, m.selectionSource, m.guideRecommendation, m.guideAnswers.houseFeeder], ['measured_220_87', 'manual', null, 'yes100']);
    h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', ''); h.set('lcHouseState', 'meter'); assert.strictEqual(h.state().snapshot.method.selectionSource, 'guide');
    h.set('lcOccupancy', ''); m = h.state().snapshot.method; assert.deepStrictEqual([m.selected, m.selectionSource, m.guideRecommendation], [null, null, null], 'a guide-selected method is cleared with the occupancy');
    const rec = h.api.lcGuideRecommendation;
    const s = EMPTY(); s.occupancy = 'multifamily_building'; s.method.guideAnswers.bldgCooking = 'yesall'; assert.strictEqual(rec(s), 'multifamily_220_84'); s.method.guideAnswers.bldgCooking = 'noall'; assert.strictEqual(rec(s), 'standard_part_III');
    s.occupancy = 'nondwelling'; assert.strictEqual(rec(s), 'standard_part_III'); s.occupancy = 'dwelling_unit_apartment'; s.method.guideAnswers.aptFeeder = 'no100'; assert.strictEqual(rec(s), 'standard_part_III'); s.method.guideAnswers.aptFeeder = 'yes100'; assert.strictEqual(rec(s), null);
  });
  test('every inactive method is explicit non-success with retained data: UNSUPPORTED_SCOPE, no lines, no verdict, no legacy output; loads and measurement survive the switch', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h); addLoad(h, 0, 12000, 'existing');
    const before = h.state().snapshot;
    // LC-22082-B0-UI-INTEGRATION-1 (ledger L-4): opt_220_82 is now an explicit computed route (accepted core R3) — on an
    // A-annual draft without dwelling data it is INCOMPLETE_INPUT, never UNSUPPORTED_SCOPE, never a total, never a verdict
    h.set('lcMethod', 'opt_220_82'); { const s = h.state(); const t = h.text();
      assert.strictEqual(s.result.status, 'INCOMPLETE_INPUT', 'opt_220_82'); assert.strictEqual(s.result.profileId, 'B82_core1'); assert.ok(codes(s.result).includes('MISSING_FIELD:dwelling.floorAreaFt2') && codes(s.result).includes('MISSING_FIELD:hvac.arrangement'));
      assert.deepStrictEqual(s.result.demand.lines, []); assert.strictEqual(s.result.demand.totalVA, null); assert.strictEqual(s.result.existingCapacity.status, 'not_assessed');
      assert.ok(!/Total demand|Line current|Min Service|INADEQUATE|ADEQUATE\b/.test(t), t.slice(0, 200));
      assert.deepStrictEqual(s.snapshot.loads.map((l) => l.id), before.loads.map((l) => l.id)); assert.deepStrictEqual(s.snapshot.measurement, before.measurement, 'measurement survives the switch to 82');
    }
    for (const m of ['existing_220_83', 'multifamily_220_84', 'standard_part_III']) {
      h.set('lcMethod', m); const s = h.state(); const t = h.text();
      assert.strictEqual(s.result.status, 'UNSUPPORTED_SCOPE', m); assert.ok(codes(s.result).includes('CAPABILITY_DISABLED:method.selected'));
      assert.deepStrictEqual(s.result.demand.lines, []); assert.strictEqual(s.result.demand.totalVA, null); assert.strictEqual(s.result.existingCapacity.status, 'not_assessed');
      assert.ok(/not computed|not available/i.test(t) && !/Total demand|Line current|Min Service|INADEQUATE|ADEQUATE\b/.test(t), t.slice(0, 200));
      assert.deepStrictEqual(s.snapshot.loads, before.loads); assert.deepStrictEqual(s.snapshot.measurement, before.measurement);
      assert.ok(/NOT computed in this profile|not computed/i.test(h.$('lcMethodNote').textContent));
    }
    h.set('lcMethod', 'measured_220_87'); assert.strictEqual(h.state().result.status, 'COMPLETE', 'back to measured: the listed load is EXISTING (inside the measured demand), so the engine completes; nothing was silently dropped'); assert.strictEqual(h.state().snapshot.loads.length, 1);
  });
  test('COMPLETE is not approval: not_assessed capacity is rendered as such; adequate/inadequate are the raw engine comparison with the entered rating', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h, '225');
    let t = h.text(); assert.ok(/COMPLETE/.test(t) && /ADEQUATE/.test(t) && !/INADEQUATE/.test(t) && /208\.3 A vs service rating 225\.0 A/.test(t) && /within/.test(t) && /completeness is not approval/.test(t), t.slice(0, 300));
    h.set('lcServiceRatingA', '200'); t = h.text(); assert.ok(/INADEQUATE/.test(t) && /exceeds/.test(t));
    h.set('lcServiceRatingA', ''); t = h.text(); assert.ok(/NOT ASSESSED/.test(t) && /No verdict/.test(t) && !/INADEQUATE|ADEQUATE\b/.test(t.replace('NOT ASSESSED', '')));
    assert.ok(/not assessed in profile A/i.test(t) && /No automatic Wire Sizer handoff/.test(t), 'requiredCapacity / rating notes come from the engine');
  });
  test('NEC references are necLink spans with the exact amended context; the diagnostic continuityOfNewLoadKnown is never rendered as an appliance statement', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h);
    // EC-UI-LAYOUT-REFS-1 (old -> new): links are source-aware data-ref spans handled by one delegated listener (no per-element listener); an amended reference has two targets
    const links = h.nodes().filter((n) => n._classes.has('nec-link') || n._classes.has('nycec-link'));
    assert.ok(links.length >= 3 && links.every((n) => n.attrs.onclick === undefined && (n.listeners.click || []).length === 0 && typeof n.attrs['data-ref'] === 'string' && n.attrs['data-src'] === (n._classes.has('nycec-link') ? 'nycec' : 'nec')));
    const nec = links.find((n) => n._classes.has('nec-link') && n.attrs['data-sec'] === '220.87(2)'); nec.dispatch('click'); assert.ok(/^NEC 2020 220\.87\(2\)/.test(h.necCalls[0]) && /Load Calc/.test(h.necCalls[0]) && /Section 220\.87\(2\)/.test(h.necCallsFull[0].question) && /NEC 2020/.test(h.necCallsFull[0].question), h.necCalls[0]);
    const nyc = links.find((n) => n._classes.has('nycec-link') && n.attrs['data-sec'] === '220.87(2)'); nyc.dispatch('click'); assert.ok(/^NYCEC 2025 amendment to NEC 220\.87\(2\)/.test(h.necCalls[1]) && /amendment to NEC Section 220\.87\(2\)/.test(h.necCallsFull[1].question), h.necCalls[1]);
    assert.ok(!/continuityOfNewLoadKnown|is noncontinuous|not continuous/i.test(h.text()), 'the disposed diagnostic is not rendered as a statement about the equipment');
  });
});

describe('B2 PRODUCTION — loads, new-load term, explicit coverage confirmation', () => {
  test('a preset load is added with its category and VA, status unknown (never silently existing/new); + ADD refuses an invalid VA; remove works', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h);
    const card = addLoad(h, 0, 12000);
    let l = h.state().snapshot.loads[0]; assert.deepStrictEqual([l.label, l.category, l.classification, l.rating, l.quantity, l.status], ['Range / Oven', 'range', 'confirmed', { kind: 'va', value: 12000, volts: null }, 1, null]);
    assert.strictEqual(h.state().result.status, 'PARTIAL'); assert.ok(codes(h.state().result).includes('LOAD_UNRESOLVED:loads[0]'), codes(h.state().result).join());
    h.$('lcPresetVA').value = 'abc'; h.$('lcAddLoad').dispatch('click'); assert.strictEqual(h.state().snapshot.loads.length, 1); assert.ok(/valid VA/.test(h.$('lcLoads').textContent));
    addLoad(h, 9, 1500); l = h.state().snapshot.loads[1]; assert.deepStrictEqual([l.category, l.classification], [null, 'required']); assert.ok(/Needs classification/.test(h.$('lcLoads').textContent));
    card.querySelector('.lc-x').dispatch('click'); assert.strictEqual(h.state().snapshot.loads.length, 1); assert.strictEqual(h.state().snapshot.loads[0].classification, 'required');
  });
  test('a malformed load VA keeps a load-scoped parse error (loads[i].rating.value) and blocks evaluation; the retained number is not used; quantity likewise', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h); const card = addLoad(h, 0, 12000, 'existing');
    const va = card.querySelectorAll('input[type=number]')[0]; va.value = '12k'; va.dispatch('input');
    let s = h.state(); assert.deepStrictEqual(s.parseErrors, [{ field: 'loads[0].rating.value', raw: '12k', code: 'NOT_FINITE' }]); assert.strictEqual(s.result.status, 'INVALID_INPUT'); assert.strictEqual(s.snapshot.loads[0].rating.value, 12000, 'structural number retained but flagged');
    assert.ok(/last accepted value is not used/.test(h.$('lcLoads').textContent));
    const va2 = h.$('lcLoads').querySelectorAll('input[type=number]')[0]; va2.value = '13000'; va2.dispatch('input'); s = h.state(); assert.deepStrictEqual(s.parseErrors, []); assert.strictEqual(s.snapshot.loads[0].rating.value, 13000);
    const q = h.$('lcLoads').querySelectorAll('input[type=number]')[1]; q.value = '0'; q.dispatch('input');
    s = h.state(); assert.deepStrictEqual(s.parseErrors, [{ field: 'loads[0].quantity', raw: '0', code: 'OUT_OF_RANGE' }], 'B2-r1 (R-B2-02): the schema minimum (>= 1) is part of the form transport, so 0 is a typed parse error');
    assert.strictEqual(s.fault, null, 'the snapshot stays schema-valid: no L2 rejection'); assert.strictEqual(s.snapshot.loads[0].quantity, 1, 'the last accepted count is retained but not used'); assert.strictEqual(s.result.status, 'INVALID_INPUT');
    q.value = '-1'; q.dispatch('input'); assert.strictEqual(h.state().parseErrors[0].code, 'OUT_OF_RANGE');
    q.value = '2'; q.dispatch('input'); assert.strictEqual(h.state().fault, null); assert.deepStrictEqual(h.state().parseErrors, []); assert.strictEqual(h.state().snapshot.loads[0].quantity, 2);
  });
  test('coversSnapshot is captured ONLY by the Confirm button; ticking/quantity/category edits make it stale; label-only edits stay fresh; NEWLOAD_MODE none with a new load is flagged', () => {
    const h = buildHarness(); h.api.lcInit(); thirtyPerConductor(h);
    let s = h.state(); assert.deepStrictEqual(s.snapshot.measurement.newLoad.precalculated.coversSnapshot, []); assert.strictEqual(s.result.status, 'COMPLETE');
    const card = addLoad(h, 7, 3600, 'new', 'LN', 'L2');
    s = h.state(); assert.strictEqual(s.result.status, 'PARTIAL'); assert.ok(codes(s.result).includes('NOT_COVERED_BY_AGGREGATE:loads[0]'));
    const cb = h.$('lcLoads').querySelector('input[type=checkbox]'); cb.checked = true; cb.dispatch('change');
    s = h.state(); assert.strictEqual(s.result.status, 'PARTIAL'); assert.ok(codes(s.result).includes('AGGREGATE_STALE:measurement.newLoad.precalculated.coversSnapshot')); assert.deepStrictEqual(s.snapshot.measurement.newLoad.precalculated.coversSnapshot, [], 'ticking never captures');
    assert.ok(/STALE/.test(h.$('lcCoversState').textContent));
    h.$('lcConfirmCovers').dispatch('click'); s = h.state(); assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.snapshot.measurement.newLoad.precalculated.coversSnapshot.length, 1); assert.strictEqual(s.result.demand.totalOnConductorA, 175);
    let confirmed = JSON.stringify(s.snapshot.measurement.newLoad.precalculated.coversSnapshot);
    for (const [why, mutate] of [['quantity', () => { const q = h.$('lcLoads').querySelectorAll('input[type=number]')[1]; q.value = '2'; q.dispatch('input'); }], ['category', () => { const c = h.$('lcLoads').querySelectorAll('select')[0]; c.value = 'other'; c.dispatch('change'); }], ['status', () => { const c = h.$('lcLoads').querySelectorAll('select')[2]; c.value = 'existing'; c.dispatch('change'); }]]) {
      mutate(); s = h.state(); assert.strictEqual(s.result.status, 'PARTIAL', why); assert.ok(codes(s.result).includes('AGGREGATE_STALE:measurement.newLoad.precalculated.coversSnapshot'), why); assert.strictEqual(JSON.stringify(s.snapshot.measurement.newLoad.precalculated.coversSnapshot), confirmed, why + ': never recaptured by an edit, an evaluate or a render');
      h.$('lcConfirmCovers').dispatch('click'); s = h.state(); assert.strictEqual(s.result.status, 'COMPLETE', why + ': explicit re-confirmation'); confirmed = JSON.stringify(s.snapshot.measurement.newLoad.precalculated.coversSnapshot); assert.ok(confirmed !== '[]');
    }
    const lbl = h.$('lcLoads').querySelector('input[type=text]'); lbl.value = 'renamed'; lbl.dispatch('input'); s = h.state(); assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.snapshot.loads[0].label, 'renamed');
    h.set('lcNewLoadMode', 'none'); const c = h.$('lcLoads').querySelectorAll('select')[2]; c.value = 'new'; c.dispatch('change'); s = h.state(); assert.ok(codes(s.result).includes('NEWLOAD_MODE_NONE_WITH_NEW_LOADS:measurement.newLoad.mode')); assert.strictEqual(s.result.status, 'PARTIAL', 'engine-defined: a coverage-layer problem, no final total, no verdict'); assert.strictEqual(s.result.existingCapacity.status, 'not_assessed');
    assert.ok(s.snapshot.measurement.newLoad.precalculated !== null, 'switching the mode retains the entered term (no data loss)');
    void card;
  });
  test('hostile label/note/legacy text is data only: rendered through text nodes, no element created from it, no innerHTML write', () => {
    const h = buildHarness(); h.api.lcInit(); thirtyPerConductor(h); addLoad(h, 0, 12000, 'existing');
    const evil = '<img src=x onerror="alert(1)"><script>x</script>';
    const lbl = h.$('lcLoads').querySelector('input[type=text]'); lbl.value = evil; lbl.dispatch('input');
    h.set('lcTermNote', evil);
    const stSel = h.$('lcLoads').querySelectorAll('select')[2]; stSel.value = ''; stSel.dispatch('change'); // an unknown status puts the load into the problem list, so its label is rendered as a problem field
    const s = h.state(); assert.strictEqual(s.snapshot.loads[0].label, evil); assert.strictEqual(s.snapshot.measurement.newLoad.precalculated.basis.note, evil);
    assert.ok(!h.nodes().some((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT')); assert.strictEqual(h.nodes().reduce((a, n) => a + n.innerHTMLWrites, 0), 0);
    assert.ok(h.nodes().some((n) => n._classes.has('lc-problem-field') && n.textContent.includes(evil)), 'the label is shown as literal text in the problem list');
  });
});

describe('B2 PRODUCTION — Favorites LC branch (versioned payload, restore, legacy, failures)', () => {
  const LEGACY = () => H.clone(H.caseById('T-S-04c').legacyRecord);
  test('favGetValues("lc") is the versioned payload; label is derived from the snapshot; legacy vals get the generic label', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h);
    const p = h.api.favGetValues('lc');
    // ledger L-5: new saves are the accepted lcv-3 wrapper (loadCalcStorageV2.toPayloadV3); the A engine profile is not a wrapper field
    assert.deepStrictEqual(Object.keys(p), ['lcv', 'capabilityProfile', 'context', 'snapshot', 'fieldErrors', 'loadErrors', 'sourceFavId']); assert.strictEqual(p.lcv, 3); assert.strictEqual(p.capabilityProfile, 'AB82_core1'); assert.deepStrictEqual(p.snapshot, h.state().snapshot); assert.strictEqual(p.sourceFavId, null);
    assert.deepStrictEqual(h.EC.loadCalcStorageV2.validatePayloadV3(p), []); assert.strictEqual(h.state().result.profileId, PROFILE, 'the delegated A result still carries the A engine profile');
    assert.strictEqual(h.api.favGetLabel('lc', p), '120/240 V, 1-phase, 3-wire (split-phase) · NEC 220.87 (NYC amended) · 40000 VA');
    assert.strictEqual(h.api.favGetLabel('lc', LEGACY()), 'Load Calc');
  });
  test('T-S-12 (storage-level): save through the real LC Save creates one record; restore through favLoad/favSetValues reproduces the snapshot, draft errors and a recomputed result', () => {
    const h = buildHarness({ promptAnswer: 'my preset' }); h.api.lcInit(); annual(h, '225');
    h.set('lcNewLoadMode', 'precalculated'); h.set('lcTermVA', '5000'); h.set('lcTermConnection', 'LL'); h.set('lcTermEstablished', 'yes'); h.set('lcTermBasisMethod', 'other_stated'); h.set('lcTermCalculatedBy', 'engineer'); h.set('lcTermDemandFactors', 'yes');
    addLoad(h, 7, 5000, 'new', 'LL'); const cb = h.$('lcLoads').querySelector('input[type=checkbox]'); cb.checked = true; cb.dispatch('change'); h.$('lcConfirmCovers').dispatch('click');
    h.set('lcPeriodMonths', '12x'); const saved = h.state(); assert.strictEqual(saved.result.status, 'INVALID_INPUT');
    assert.strictEqual(h.api.lcFavSave(), true); const all = JSON.parse(h.store.data); assert.strictEqual(all.lc.length, 1); assert.strictEqual(all.lc[0].name, 'my preset'); assert.strictEqual(all.lc[0].vals.lcv, 3); assert.deepStrictEqual(all.lc[0].vals.snapshot, saved.snapshot); assert.deepStrictEqual(all.lc[0].vals.fieldErrors, { 'measurement.periodMonths': { raw: '12x', code: 'NOT_FINITE' } });
    assert.ok(/Saved as a new preset/.test(h.$('lcFavStatus').textContent));
    // a fresh document with the same storage (storage-level round trip; the real reload is in the browser harness)
    const h2 = buildHarness({ storage: h.store.data }); h2.api.lcInit(); assert.deepStrictEqual(h2.state().snapshot, h2.EC.loadCalcStateV2.createEmptyDraftV2().snapshot);
    assert.strictEqual(h2.$('lc-fav-list').querySelectorAll('.fav-item').length, 1); h2.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
    const r = h2.state(); assert.deepStrictEqual(r.snapshot, saved.snapshot); assert.deepStrictEqual(r.fieldErrors, saved.fieldErrors); assert.deepStrictEqual(r.loadErrors, saved.loadErrors); assert.deepStrictEqual(r.result, saved.result); assert.strictEqual(r.sourceFavId, null, 'lcv-3 restores its stored sourceFavId verbatim (null here)'); assert.deepStrictEqual(r.context, saved.context);
    assert.strictEqual(h2.$('lcPeriodMonths').value, '12x'); assert.ok(h2.$('lcPeriodMonths').classList.contains('lc-invalid'));
    h2.set('lcPeriodMonths', '12'); assert.strictEqual(h2.state().result.status, 'COMPLETE'); assert.strictEqual(h2.state().result.demand.totalVA, 55000);
  });
  test('restore never borrows from the live draft or runs the guide: a restored manual method survives; unsupported saved method stays retained and unavailable', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h); h.set('lcMethod', 'existing_220_83'); const payload = h.api.lcFavPayload();
    const h2 = buildHarness(); h2.api.lcInit(); h2.set('lcOccupancy', 'multifamily_building'); h2.set('lcBldgCooking', 'yesall'); h2.set('lcTopology', '3ph_4w_208Y_120');
    h2.api.favSetValues('lc', payload, 5);
    const s = h2.state(); assert.deepStrictEqual(s.snapshot, payload.snapshot); assert.deepStrictEqual([s.snapshot.method.selected, s.snapshot.method.selectionSource], ['existing_220_83', 'manual']); assert.strictEqual(s.snapshot.supply.topology, '1ph_3w_120_240'); assert.strictEqual(s.result.status, 'UNSUPPORTED_SCOPE');
    assert.ok(/not computed|not available/i.test(h2.text()));
  });
  test('T-S-39 (storage-level): legacy record migrates on load with no write-back; Save creates a NEW record keeping the original vals; sourceFavId recorded; unrelated records untouched', () => {
    const seed = JSON.stringify({ vd: [{ name: 'VD', vals: { amps: '1' }, id: 1 }], lc: [{ name: 'Old house', vals: LEGACY(), id: 1001 }] });
    const h = buildHarness({ storage: seed, promptAnswer: 'copy' }); h.api.lcInit();
    h.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
    const s = h.state(); const expected = h.EC.loadCalcState.migrateLegacyRecord(LEGACY()).snapshot;
    // ledger L-7: the import is the accepted V2 upgrade — its A projection is byte-identical to the unchanged migrator output; the V2 additions are fresh bases and unconfirmed facts
    assert.deepStrictEqual(h.EC.loadCalcInputV2.downConvertToA(s.lastRequest).snapshot, expected); assert.deepStrictEqual(h.EC.loadCalcInputV2.downConvertToA(s.lastRequest).snapshot, H.caseById('T-S-04c').migratedSnapshot);
    assert.strictEqual(s.snapshot.schemaVersion, '3.3.0'); assert.ok(s.snapshot.loads.every((l) => typeof l.basisId === 'string' && l.inclusion82 === null && l.ratingCoverage82 === null));
    assert.strictEqual(s.sourceFavId, 1001); assert.deepStrictEqual(s.context, { importedFrom: { lcv: 1, profileId: 'legacy_pre_lcv_favorite', schemaVersion: 'unversioned' }, methodConfirmedAfterImport: false }); assert.strictEqual(h.store.data, seed, 'no write-back on load');
    assert.notStrictEqual(s.result.status, 'COMPLETE'); assert.ok(codes(s.result).includes('IMPORTED_METHOD_UNCONFIRMED:method.selected') || s.result.status === 'BLOCKED_PENDING_RULE', codes(s.result).join());
    assert.ok(/Legacy preset "Old house" imported as a new draft/.test(h.$('lcFavStatus').textContent) && /NOT confirmed/.test(h.$('lcFavStatus').textContent)); assert.ok(/MIGRATED FROM A LEGACY SAVE/.test(h.$('lcMigration').textContent));
    assert.strictEqual(h.api.lcFavSave(), true); const all = JSON.parse(h.store.data);
    assert.strictEqual(all.lc.length, 2); assert.deepStrictEqual(all.lc[0], { name: 'Old house', vals: LEGACY(), id: 1001 }); assert.strictEqual(all.lc[1].name, 'copy'); assert.strictEqual(all.lc[1].vals.lcv, 3); assert.strictEqual(all.lc[1].vals.sourceFavId, 1001); assert.deepStrictEqual(all.lc[1].vals.snapshot, s.snapshot); assert.deepStrictEqual(h.EC.loadCalcInputV2.downConvertToA({ snapshot: all.lc[1].vals.snapshot, parseErrors: [] }).snapshot, expected); assert.notStrictEqual(all.lc[1].id, 1001); assert.deepStrictEqual(all.vd, [{ name: 'VD', vals: { amps: '1' }, id: 1 }]);
    h.api.favDelete('lc', all.lc[1].id); assert.strictEqual(JSON.parse(h.store.data).lc.length, 1, 'unrelated delete still works once');
  });
  test('mixed laundry (both orders) and NYC A/C legacy records: count null, unresolved item shown as needing attention, LEGACY_AMBIGUOUS from the engine', () => {
    for (const reverse of [false, true]) {
      const items = [{ id: 'a', name: 'Laundry Circuit', category: 'laundry', va: 1500 }, { id: 'b', name: 'Laundry Circuit', category: 'laundry', va: 2000 }];
      const rec = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: JSON.stringify(reverse ? items.slice().reverse() : items), hvac: '[]', ev: '[]' };
      const h = buildHarness(); h.api.lcInit(); h.api.favSetValues('lc', rec, 7);
      const s = h.state(); assert.strictEqual(s.snapshot.dwelling.laundryCircuits, null); assert.ok(s.snapshot.migration.unresolvedItems.some((u) => u.itemId === 'b'));
      // ledger L-8: the legacy method 'optional' now routes to the accepted 82 core (import unconfirmed, laundry count missing); the A-layer LEGACY_AMBIGUOUS
      // guarantee is kept on the A route by a manual method selection below
      assert.strictEqual(s.result.status, 'INCOMPLETE_INPUT'); assert.ok(codes(s.result).includes('MISSING_FIELD:dwelling.laundryCircuits') && codes(s.result).includes('IMPORTED_METHOD_UNCONFIRMED:method.selected'), codes(s.result).join());
      assert.ok(/Needs attention: "Laundry Circuit" 2000 VA/.test(h.$('lcMigration').textContent)); h.$('lcCalcBtn').dispatch('click'); assert.ok(/Laundry circuits \(legacy\)/.test(h.text()), 'shown after an explicit Calculate (LC-UI-CALCULATE-1)'); assert.strictEqual(h.state().context.methodConfirmedAfterImport, false, 'Calculate never confirms the imported method');
      h.set('lcMethod', 'measured_220_87'); assert.ok(codes(h.state().result).includes('LEGACY_AMBIGUOUS:dwelling.laundryCircuits'), 'the unchanged A engine still reports the legacy ambiguity: ' + codes(h.state().result).join());
      assert.strictEqual(h.state().snapshot.dwelling.laundryCircuits, null); assert.ok(h.state().snapshot.migration.unresolvedItems.some((u) => u.itemId === 'b'), 'migration history survives the method switch');
    }
  });
  test('LegacyRecordError (unparseable list / unrepresentable item): controlled RESTORE FAILED naming the preset; draft, storage and list untouched; no leaked content', () => {
    const seed = JSON.stringify({ lc: [{ name: 'Broken', vals: { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: 'not-json{secret}', hvac: '[]', ev: '[]' }, id: 9 }, null, { name: 'NullVA', vals: { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: '[{"id":"x","name":"Water Heater","va":null,"category":"appliance"}]', hvac: '[]', ev: '[]' }, id: 10 }] });
    const h = buildHarness({ storage: seed }); h.api.lcInit(); annual(h); const before = JSON.stringify(h.state().snapshot);
    h.api.favLoad('lc', 9); let s = h.state(); assert.strictEqual(s.fault.kind, 'restore'); assert.ok(/LEGACY_UNPARSEABLE_LIST/.test(s.fault.message) && /"Broken"/.test(s.fault.message) && !/secret/.test(s.fault.message)); assert.strictEqual(JSON.stringify(s.snapshot), before); assert.strictEqual(h.store.data, seed);
    assert.ok(/RESTORE FAILED/.test(h.text()) && !/INADEQUATE/.test(h.text()), 'no stale success shown for the requested record');
    h.api.favLoad('lc', 10); s = h.state(); assert.ok(/LEGACY_ITEM_UNREPRESENTABLE/.test(s.fault.message)); assert.strictEqual(JSON.stringify(s.snapshot), before);
    assert.strictEqual(h.$('lc-fav-list').querySelectorAll('.fav-item').length, 2, 'list intact (null entry skipped by favRender)');
    assert.strictEqual(h.state().result.status, 'COMPLETE', 'the unchanged draft still has its result, but it is not rendered under the failure');
    h.set('lcReadingValue', '41000'); assert.strictEqual(h.state().fault, null, 'the next user update clears the restore fault'); assert.ok(/INADEQUATE/.test(h.text()));
    h.api.favLoad('lc', 9); assert.strictEqual(h.state().fault.kind, 'restore'); h.api.lcReset(); assert.strictEqual(h.state().fault, null); assert.strictEqual(h.state().result.status, 'EMPTY');
  });
  test('unknown future payload version, wrong profile, schema-invalid lcv-2 snapshot and malformed draft errors are explicit restore failures that keep the draft', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h); const before = JSON.stringify(h.state().snapshot);
    const good = h.api.lcFavPayload();
    for (const [label, vals, re] of [['future version', { lcv: 99, profileId: PROFILE, snapshot: good.snapshot }, /unsupported Load Calc version/], ['other profile', Object.assign({}, good, { capabilityProfile: 'B_something' }), /does not match the Load Calc lcv-3 contract/], ['invalid snapshot', Object.assign({}, good, { snapshot: Object.assign({}, good.snapshot, { schemaVersion: '9.9.9' }) }), /does not match the Load Calc lcv-3 contract/], ['malformed errors', Object.assign({}, good, { fieldErrors: { x: { raw: 1, code: 'NOPE' } } }), /does not match the Load Calc lcv-3 contract/], ['empty', null, /empty or malformed/]]) {
      h.api.favSetValues('lc', vals, 3); const s = h.state(); assert.strictEqual(s.fault && s.fault.kind, 'restore', label); assert.ok(re.test(s.fault.message), label + ': ' + s.fault.message); assert.strictEqual(JSON.stringify(s.snapshot), before, label);
    }
    h.api.favSetValues('lc', good, 3); assert.strictEqual(h.state().fault, null);
  });
  test('save refuses an unreadable presets store (nothing overwritten) and reports a write failure explicitly; a cancelled prompt saves nothing', () => {
    const h = buildHarness({ storage: '{corrupt', promptAnswer: 'x' }); h.api.lcInit(); annual(h);
    assert.strictEqual(h.api.lcFavSave(), false); assert.strictEqual(h.store.data, '{corrupt'); assert.strictEqual(h.store.sets, 0); assert.ok(/STORAGE ERROR/.test(h.text()) && /unreadable/.test(h.text())); assert.strictEqual(h.prompts.calls.length, 0, 'no prompt when the store cannot be read');
    const h2 = buildHarness({ promptAnswer: 'x' }); h2.api.lcInit(); annual(h2); h2.store.failNextSet = new Error('QuotaExceededError');
    assert.strictEqual(h2.api.lcFavSave(), false); assert.strictEqual(h2.store.data, null); assert.ok(/storage full or unavailable/.test(h2.text()));
    h2.store.failNextSet = null; assert.strictEqual(h2.api.lcFavSave(), true); assert.strictEqual(JSON.parse(h2.store.data).lc.length, 1); assert.strictEqual(h2.state().fault, null);
    const h3 = buildHarness({ promptAnswer: null }); h3.api.lcInit(); annual(h3); assert.strictEqual(h3.api.lcFavSave(), false); assert.strictEqual(h3.store.data, null);
    const h4 = buildHarness({ promptAnswer: 'twice' }); h4.api.lcInit(); annual(h4); h4.api.lcFavSave(); h4.api.lcFavSave(); const ids = JSON.parse(h4.store.data).lc.map((f) => f.id); assert.notStrictEqual(ids[0], ids[1], 'two saves in the same millisecond still get distinct ids');
  });
});
