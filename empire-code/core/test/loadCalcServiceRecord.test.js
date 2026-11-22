'use strict';
/**
 * LC-SERVICE-RESULT-STORE-1 — pure historical-record contract.
 * These are authored cases; execution belongs to the coordinator, not the implementer.
 * Uses the actual accepted fixture, public projection/facade/sizing APIs and original outputs.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Record = require('../src/calc/loadCalcServiceRecord.js');
const State = require('../src/calc/loadCalcStateV2.js');
const Storage = require('../src/calc/loadCalcStorageV2.js');
const Facade = require('../src/calc/loadCalcFacade.js');
const Sizing = require('../src/calc/loadCalcServiceSizing.js');

const ROOT = path.join(__dirname, '..');
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/loadCalc/LC82-cases-r1.json'), 'utf8')).cases;
const copy = (v) => JSON.parse(JSON.stringify(v));
const text = (v) => JSON.stringify(v);
const metadata = (patch) => Object.assign({ id: 'sr1_0123456789abcdef0123456789abcdef', name: 'B0 service result', createdAt: '2026-10-06T00:12:53.000Z' }, patch || {});
const freeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.keys(v).forEach((k) => freeze(v[k])); } return v; };
const ok = (r, why) => { assert.equal(r.ok, true, (why || 'expected success') + ': ' + text(r.problems)); return r.record; };
const refusal = (r, pattern) => {
  assert.equal(r.ok, false); assert.equal(Object.hasOwn(r, 'record'), false);
  assert.ok(Array.isArray(r.problems) && r.problems.length && r.problems.every((p) => typeof p === 'string'));
  if (pattern) assert.ok(r.problems.some((p) => pattern.test(p)), text(r.problems));
};
const newDesign = (patch) => {
  const d = {
    selectedMainRatingA: 200,
    plan: { intent: 'new_design_candidate', oneMainDisconnect: true, noAdditionalSources: true, wholeDwelling: true, singleConductorSet: true },
    conductor: { sizingPath: 'general_table_75C', material: 'Cu', terminationTempRatingC: 75, terminationMaterialCompatible: true, insulationTempRatingC: 75, ambientTempC: 30, currentCarryingConductors: 3, wiringMethod: 'single_insulated_conductors_in_raceway', noOtherAdjustmentOrCorrection: true },
  };
  if (patch) patch(d);
  return d;
};
function capture(opts) {
  const o = opts || {}; const request0 = copy(cases.find((c) => c.id === 'LC82-B0P').request);
  const draft = State.createEmptyDraftV2(); draft.snapshot = request0.snapshot; draft.context = request0.context; draft.sourceFavId = 'original-favorite';
  if (o.draft) o.draft(draft);
  const projection = State.toRequestV2(draft); assert.equal(projection.ok, true, text(projection.problems));
  const request = projection.request; const response = Facade.evaluateV2(request);
  const design = newDesign(o.design); const analysis = Sizing.analyzePrototype(request, design);
  return { draft, request, response, design, analysis };
}
const makeRecord = (opts) => ok(Record.createRecord(capture(opts), metadata()));
const qualification = (r) => r.serviceSizing.analysis.ungroundedConductors.qualificationConsistency;

describe('Historical record captures the original full result', () => {
  test('B0 round-trips the entire tuple, lcv-3 provenance, original sources and source metadata without mutation', () => {
    const cap = capture(); const meta = metadata(); const before = text(cap); const beforeMeta = text(meta);
    freeze(cap); freeze(meta);
    const r = ok(Record.createRecord(cap, meta));
    assert.deepEqual(Object.keys(r), ['kind', 'recordVersion', 'id', 'name', 'createdAt', 'producer', 'calculation', 'serviceSizing']);
    assert.equal(r.kind, Record.KIND); assert.equal(r.recordVersion, 1); assert.deepEqual(r.producer, Record.PRODUCER);
    assert.deepEqual(r.calculation.draftPayload, Storage.toPayloadV3(cap.draft).payload);
    assert.deepEqual(r.calculation.request, cap.request); assert.deepEqual(r.calculation.response, cap.response);
    assert.deepEqual(r.serviceSizing.design, cap.design); assert.deepEqual(r.serviceSizing.analysis, cap.analysis); assert.deepEqual(r.serviceSizing.sources, Sizing.SOURCES);
    assert.equal(r.calculation.draftPayload.sourceFavId, 'original-favorite'); assert.equal(r.calculation.draftPayload.lcv, 3);
    assert.deepEqual(Object.keys(r.calculation.draftPayload), Storage.PAYLOAD_KEYS);
    assert.equal(Object.hasOwn(r.calculation.draftPayload, 'result'), false);
    assert.equal(Object.hasOwn(r.calculation.draftPayload, 'design'), false);
    assert.equal(r.calculation.response.result.demand.totalVA, 23680);
    assert.equal(r.calculation.response.result.current.lineA, 23680 / 240);
    assert.equal(r.serviceSizing.analysis.minimumService.ratingA, 100);
    assert.equal(r.serviceSizing.analysis.operative, false); assert.equal(r.serviceSizing.analysis.installationApproved, false);
    assert.equal(r.serviceSizing.analysis.globalCodeCompliance, 'not_verified');
    assert.equal(qualification(r).status, 'premise_unchanged');
    assert.equal(r.serviceSizing.analysis.ungroundedConductors.recommendationAvailable, true);
    assert.deepEqual(Record.validateStoredRecord(r), []);
    const parsed = ok(Record.parseStoredRecord(text(r)));
    assert.equal(text(parsed), text(r), 'JSON round trip is exact');
    assert.equal(text(cap), before); assert.equal(text(meta), beforeMeta);
    parsed.serviceSizing.sources.ENGINE_B82.title = 'edited copy only';
    parsed.calculation.request.snapshot.loads[0].label = 'edited copy only';
    assert.notEqual(parsed.serviceSizing.sources.ENGINE_B82.title, r.serviceSizing.sources.ENGINE_B82.title);
    assert.equal(text(cap), before, 'read record never aliases the captured draft');
    assert.equal(Sizing.SOURCES.ENGINE_B82.title, r.serviceSizing.sources.ENGINE_B82.title);
  });

  test('200 / 175 A conditional result and original review reasons survive without enabling selection', () => {
    const cap = capture({ design: (d) => { d.conductor.sizingPath = 'dwelling_83pct_310_12'; } });
    const r = ok(Record.createRecord(cap, metadata()));
    const u = r.serviceSizing.analysis.ungroundedConductors;
    assert.equal(u.tableCandidate.ampacity75CA, 175); assert.equal(u.tableCandidate.size, '2/0');
    assert.equal(u.size, null); assert.equal(u.ampacity75CA, null); assert.equal(u.recommendationAvailable, false);
    assert.equal(qualification(r).declaredQualificationAmpacityA, 200);
    assert.equal(qualification(r).status, 'revalidation_required');
    assert.deepEqual(qualification(r).reasons, cap.analysis.ungroundedConductors.qualificationConsistency.reasons);
    assert.equal(text(ok(Record.parseStoredRecord(text(r)))), text(r));
  });

  test('100 A dwelling Cu 85 / Al 90 preserve open interpretation and false approval flags', () => {
    for (const [material, ampacity, size] of [['Cu', 85, '4'], ['Al', 90, '2']]) {
      const r = makeRecord({ design: (d) => { d.selectedMainRatingA = 100; d.conductor.sizingPath = 'dwelling_83pct_310_12'; d.conductor.material = material; } });
      const u = r.serviceSizing.analysis.ungroundedConductors;
      assert.equal(u.tableCandidate.ampacity75CA, ampacity); assert.equal(u.tableCandidate.size, size);
      assert.equal(u.size, null); assert.equal(u.recommendationAvailable, false);
      assert.equal(qualification(r).status, 'review_required');
      assert.equal(qualification(r).reasons[0].code, 'B82_310_12_INTERPRETATION_PENDING');
      assert.equal(r.serviceSizing.analysis.operative, false); assert.equal(r.serviceSizing.analysis.installationApproved, false);
      assert.equal(r.serviceSizing.analysis.sourceReview.closed, false);
      assert.equal(text(ok(Record.readStoredRecord(r))), text(r));
    }
  });

  test('missing chosen rating, unanswered plans and an unsupported conductor are performed assessments, not guessed defaults', () => {
    const variants = [
      { patch: (d) => { d.selectedMainRatingA = null; }, minimum: 'experimental_candidate', chosen: 'waiting_input', conductor: 'not_evaluated' },
      { patch: (d) => { d.plan.oneMainDisconnect = null; }, minimum: 'waiting_input', chosen: 'not_evaluated', conductor: 'not_evaluated' },
      { patch: (d) => { d.plan.noAdditionalSources = false; }, minimum: 'unsupported', chosen: 'not_evaluated', conductor: 'not_evaluated' },
      { patch: (d) => { d.conductor.ambientTempC = 35; }, minimum: 'experimental_candidate', chosen: 'meets_prototype_minimum', conductor: 'unsupported' },
    ];
    for (const v of variants) {
      const cap = capture({ design: v.patch }); const r = ok(Record.createRecord(cap, metadata()));
      assert.equal(r.serviceSizing.analysis.minimumService.status, v.minimum);
      assert.equal(r.serviceSizing.analysis.chosenMain.status, v.chosen);
      assert.equal(r.serviceSizing.analysis.ungroundedConductors.status, v.conductor);
      assert.equal(r.serviceSizing.analysis.ungroundedConductors.recommendationAvailable, false);
      assert.equal(text(ok(Record.parseStoredRecord(text(r)))), text(r));
    }
  });

  test('DESIGN_INVALID stores raw malformed numeric strings exactly, including browser badInput empty text', () => {
    for (const raw of ['12,5', '4e', '', '-not-a-number']) {
      const cap = capture({ design: (d) => { d.conductor.ambientTempC = raw; } });
      assert.equal(cap.analysis.status, 'DESIGN_INVALID');
      const r = ok(Record.createRecord(cap, metadata()));
      assert.equal(r.serviceSizing.design.conductor.ambientTempC, raw);
      assert.equal(r.serviceSizing.analysis.status, 'DESIGN_INVALID'); assert.equal(r.serviceSizing.analysis.minimumService.ratingA, null);
      assert.ok(r.serviceSizing.analysis.designProblems.some((p) => p.field === 'conductor.ambientTempC' && p.code === 'INVALID_NUMBER'));
      assert.equal(text(ok(Record.parseStoredRecord(text(r)))), text(r));
    }
  });

  test('special load IDs, inactive raw errors, context and sourceFavId remain ordinary own-key data', () => {
    const cap = capture({ draft: (d) => {
      const old0 = d.snapshot.loads[0].id; const old1 = d.snapshot.loads[1].id;
      d.snapshot.loads[0].id = '__proto__'; d.snapshot.loads[1].id = 'constructor';
      d.snapshot.optional82.inventoryComplete.basis.members.forEach((m) => { if (m.id === old0) m.id = '__proto__'; else if (m.id === old1) m.id = 'constructor'; });
      for (const id of ['__proto__', 'constructor']) Object.defineProperty(d.loadErrors, id, { value: { inclusion82: { raw: 'retained dormant error', code: 'UNKNOWN_ENUM', badInput: true } }, writable: true, enumerable: true, configurable: true });
      d.fieldErrors['measurement.periodMonths'] = { raw: 'twelve?', code: 'NOT_FINITE' };
      d.context = { importedFrom: { lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' }, methodConfirmedAfterImport: true };
      d.sourceFavId = '__proto__';
    } });
    assert.equal(cap.response.result.status, 'COMPLETE', 'named dormant errors do not change the accepted active result');
    const before = text(cap); const r = ok(Record.createRecord(cap, metadata()));
    const restored = ok(Record.parseStoredRecord(text(r)));
    assert.ok(Object.hasOwn(restored.calculation.draftPayload.loadErrors, '__proto__'));
    assert.ok(Object.hasOwn(restored.calculation.draftPayload.loadErrors, 'constructor'));
    assert.equal(restored.calculation.draftPayload.loadErrors.__proto__.inclusion82.raw, 'retained dormant error');
    assert.equal(restored.calculation.draftPayload.fieldErrors['measurement.periodMonths'].raw, 'twelve?');
    assert.deepEqual(restored.calculation.draftPayload.context, cap.draft.context);
    assert.equal(restored.calculation.draftPayload.sourceFavId, '__proto__');
    assert.equal(text(cap), before); assert.equal(({}).inclusion82, undefined);
  });
});

describe('Creation verifies the captured pair; read never reruns current engines', () => {
  test('mismatched draft, request, facade, calculated numbers, design or original diagnostics refuse atomically', () => {
    const variants = [
      [(c) => { c.draft.snapshot.loads[0].label = 'changed draft'; }, /request.*projection/],
      [(c) => { c.request.snapshot.dwelling.floorAreaFt2 += 1; }, /request.*projection/],
      [(c) => { c.response.result.demand.totalVA += 1; }, /calculation response/],
      [(c) => { c.response.result.display.strings.totalVA = '1 VA'; }, /calculation response/],
      [(c) => { c.response.facade.engineRuleStatus['I-82-1'] = 'verified'; }, /calculation response/],
      [(c) => { c.design.conductor.sizingPath = 'dwelling_83pct_310_12'; }, /service analysis/],
      [(c) => { c.analysis.ungroundedConductors.qualificationConsistency.reasons[0].message = 'invented claim'; }, /service analysis/],
      [(c) => { c.analysis.operative = true; }, /service analysis|operative/],
    ];
    for (const [mutate, re] of variants) {
      const cap = copy(capture()); mutate(cap); const before = text(cap);
      refusal(Record.createRecord(cap, metadata()), re); assert.equal(text(cap), before);
    }
  });

  test('creation refuses absent/unperformed assessment, incomplete calculations and another scope', () => {
    const variants = [
      [(c) => { c.analysis = null; }, /performed/],
      [(c) => { c.analysis.status = 'REQUEST_INVALID'; }, /performed/],
      [(c) => { c.response.result.status = 'INCOMPLETE_INPUT'; }, /complete calculated/],
      [(c) => { c.response.result.current.status = 'not_computed'; }, /complete calculated/],
      [(c) => { delete c.design; }, /missing design/],
    ];
    for (const [mutate, re] of variants) { const c = copy(capture()); mutate(c); refusal(Record.createRecord(c, metadata()), re); }
    const feeder = capture({ draft: (d) => { d.snapshot.purpose = 'feeder'; } });
    refusal(Record.createRecord(feeder, metadata()), /outside.*bounded/);
    const aperture = capture({ draft: (d) => { d.snapshot.occupancy = 'dwelling_unit_apartment'; } });
    refusal(Record.createRecord(aperture, metadata()), /outside.*bounded/);
  });

  test('creation catches current-engine faults without changing the caller; there is no fallback result', () => {
    const cap = capture(); const before = text(cap); const f = Facade.evaluateV2; const s = Sizing.analyzePrototype;
    try {
      Facade.evaluateV2 = () => { throw new Error('calculation temporarily unavailable'); };
      refusal(Record.createRecord(cap, metadata()), /calculation temporarily unavailable/);
      Facade.evaluateV2 = f;
      Sizing.analyzePrototype = () => { throw new Error('assessment temporarily unavailable'); };
      refusal(Record.createRecord(cap, metadata()), /assessment temporarily unavailable/);
    } finally { Facade.evaluateV2 = f; Sizing.analyzePrototype = s; }
    assert.equal(text(cap), before);
  });

  test('older valid fingerprints and saved source wording open while both current engines are disabled', () => {
    const r = makeRecord(); r.producer.applicationRevision = 'historical-revision';
    r.producer.calculationSourcePin = 'a'.repeat(64); r.producer.sourceBaselinePin = 'b'.repeat(64);
    r.serviceSizing.sources.ENGINE_B82.title = 'Historical engine reference — preserve this wording';
    const before = text(r); const f = Facade.evaluateV2; const s = Sizing.analyzePrototype;
    const catalog = Sizing.SOURCES; let calls = 0;
    try {
      Facade.evaluateV2 = () => { calls++; throw new Error('must not calculate on read'); };
      Sizing.analyzePrototype = () => { calls++; throw new Error('must not reassess on read'); };
      Sizing.SOURCES = { incompatibleCurrentCatalog: { title: 'must not be substituted' } };
      assert.deepEqual(Record.validateStoredRecord(r), []);
      assert.equal(text(ok(Record.readStoredRecord(r))), before);
      assert.equal(text(ok(Record.parseStoredRecord(before))), before);
      assert.equal(calls, 0);
    } finally { Facade.evaluateV2 = f; Sizing.analyzePrototype = s; Sizing.SOURCES = catalog; }
    assert.equal(text(r), before);
  });

  // EC-AUDIT-FIX-1: the nine files changed for the preliminary-qualification work, so the pin names their CURRENT
  // bytes (it is recomputed from the files below, never trusted from a literal alone). The literal is the value the
  // coordinator computed independently; the previous producer survives only inside records saved before this revision.
  test('the source fingerprint identifies exactly the nine current calculation source files, not the record module', () => {
    const expected = ['loadCalc', 'loadCalcFacade', 'loadCalcInput', 'loadCalcInputV2', 'loadCalcOpt82', 'loadCalcServiceSizing', 'loadCalcState', 'loadCalcStateV2', 'loadCalcStorageV2'].map((n) => 'src/calc/' + n + '.js').sort();
    assert.deepEqual(Record.CALCULATION_SOURCE_FILES, expected);
    const pairs = expected.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')]);
    const pin = crypto.createHash('sha256').update(JSON.stringify(pairs), 'utf8').digest('hex');
    assert.equal(pin, Record.PRODUCER.calculationSourcePin);
    assert.equal(Record.PRODUCER.calculationSourcePin, 'ca231858042fcca62f871495bf281f3262e61ad5d86be755a6ea0795c7171699');
    assert.deepEqual(Object.keys(Record.PRODUCER), ['applicationRevision', 'sourceBaselinePin', 'calculationSourcePin', 'recordContractRevision']);
    assert.equal(Record.PRODUCER.applicationRevision, 'EC-AUDIT-FIX-1');
    assert.equal(Record.PRODUCER.recordContractRevision, 1); assert.equal(Record.RECORD_VERSION, 1);
    assert.equal(Record.PRODUCER.sourceBaselinePin, 'd168fa3b6be018ec2560a3cfbd3a5347b17d6d802926a1b5b4f85b2fbe3b6ab7');
    assert.equal(Object.isFrozen(Record.PRODUCER), true); assert.equal(Object.isFrozen(Record.CALCULATION_SOURCE_FILES), true);
  });

  test('a record saved by the previous producer (LC-SERVICE-RESULT-STORE-1 pins) still opens byte-exactly and is never restamped', () => {
    // The producer block every record carried before EC-AUDIT-FIX-1 changed the calculation sources.
    const PREVIOUS = { applicationRevision: 'LC-SERVICE-RESULT-STORE-1', sourceBaselinePin: 'd168fa3b6be018ec2560a3cfbd3a5347b17d6d802926a1b5b4f85b2fbe3b6ab7', calculationSourcePin: '40a7de48e3c0ede97210bacb6e40b3e7e3fb0a5fdf9fd26f7d1cfe21f0709ebe', recordContractRevision: 1 };
    assert.notEqual(PREVIOUS.calculationSourcePin, Record.PRODUCER.calculationSourcePin, 'the current pin really differs from the historical one');
    assert.notEqual(PREVIOUS.applicationRevision, Record.PRODUCER.applicationRevision);
    for (const design of [null, (d) => { d.conductor.sizingPath = 'dwelling_83pct_310_12'; }, (d) => { d.conductor.ambientTempC = '12,5'; }]) {
      const saved = makeRecord(design ? { design } : undefined); saved.producer = copy(PREVIOUS);
      const before = text(saved);
      assert.deepEqual(Record.validateStoredRecord(saved), [], 'no current pin is required to read');
      const read = ok(Record.readStoredRecord(saved)); const parsed = ok(Record.parseStoredRecord(before));
      assert.deepEqual(read.producer, PREVIOUS); assert.deepEqual(parsed.producer, PREVIOUS);
      assert.equal(text(read), before, 'the saved record is returned unchanged'); assert.equal(text(parsed), before);
      assert.equal(text(saved), before, 'reading never mutates the stored object');
      assert.notEqual(read, saved, 'an independent copy'); assert.notEqual(read.producer, saved.producer);
    }
    // only a NEW record carries the current producer
    assert.deepEqual(makeRecord().producer, Record.PRODUCER);
    assert.equal(text(Record.PRODUCER), text({ applicationRevision: 'EC-AUDIT-FIX-1', sourceBaselinePin: PREVIOUS.sourceBaselinePin, calculationSourcePin: 'ca231858042fcca62f871495bf281f3262e61ad5d86be755a6ea0795c7171699', recordContractRevision: 1 }));
  });
});

describe('Stored-data boundary: no lossy JSON, silent repair or live approval', () => {
  test('unknown versions and malformed/extra wrappers refuse with controlled string problems', () => {
    const good = makeRecord();
    const edits = [
      (r) => { r.kind = 'other'; }, (r) => { r.recordVersion = 2; },
      (r) => { r.producer.recordContractRevision = 2; }, (r) => { r.serviceSizing.designContractRevision = 2; },
      (r) => { r.extra = true; }, (r) => { r.producer.extra = 'not allowed'; },
      (r) => { r.calculation.extra = {}; }, (r) => { r.serviceSizing.extra = {}; },
      (r) => { r.calculation.response.extra = {}; }, (r) => { r.calculation.draftPayload.analysis = {}; },
      (r) => { r.calculation = null; }, (r) => { r.calculation.draftPayload.snapshot = null; },
      (r) => { r.serviceSizing = []; }, (r) => { r.serviceSizing.analysis = 1; },
      (r) => { delete r.serviceSizing.analysis.ungroundedConductors; }, (r) => { r.serviceSizing.sources = null; },
      (r) => { delete r.calculation.response.result.current; },
    ];
    for (const edit of edits) {
      const r = copy(good); edit(r); const before = text(r);
      let problems; assert.doesNotThrow(() => { problems = Record.validateStoredRecord(r); });
      assert.ok(problems.length && problems.every((p) => typeof p === 'string'));
      refusal(Record.readStoredRecord(r)); refusal(Record.parseStoredRecord(before));
      assert.equal(text(r), before);
    }
    for (const r of [null, false, 1, 'record', []]) refusal(Record.readStoredRecord(r));
  });

  test('approval flags, wrong renderer field types, unresolved source IDs and inconsistent copied identities refuse', () => {
    const good = makeRecord();
    const edits = [
      (r) => { r.serviceSizing.analysis.operative = true; },
      (r) => { r.serviceSizing.analysis.installationApproved = true; },
      (r) => { r.serviceSizing.analysis.globalCodeCompliance = 'verified'; },
      (r) => { r.serviceSizing.analysis.sourceReview.installationApproval = 'approved'; },
      (r) => { r.serviceSizing.analysis.sourceReview.globalCodeCompliance = 'verified'; },
      (r) => { r.calculation.response.result.diagnostics.operative = true; },
      (r) => { r.calculation.response.facade.engineProfileId = 'different'; },
      (r) => { r.serviceSizing.analysis.calcBasis.totalVA += 1; },
      (r) => { r.serviceSizing.analysis.qualificationEcho.conductorAmpacityA = 175; },
      (r) => { r.serviceSizing.analysis.ungroundedConductors.tableCandidate.forRatingA = 100; },
      (r) => { r.serviceSizing.analysis.ungroundedConductors.tableCandidate.ampacity75CA = '200'; },
      (r) => { r.serviceSizing.analysis.ungroundedConductors.qualificationConsistency.candidateTableAmpacity75CA = 175; },
      (r) => { r.serviceSizing.analysis.minimumService.reasons[0].sections = '230.79'; },
      (r) => { r.serviceSizing.analysis.minimumService.reasons[0].message = 42; },
      (r) => { r.serviceSizing.analysis.sourceReview.openInterpretation = null; },
      (r) => { r.serviceSizing.analysis.ungroundedConductors.conditions.ambientC = '30'; },
      (r) => { delete r.serviceSizing.sources.P_230_79; },
      (r) => { r.calculation.response.result.display.strings.totalVA = 23680; },
      (r) => { r.calculation.response.result.current.lineA = '98.7'; },
      (r) => { r.calculation.response.result.demand.lines[0].result.value = null; },
      (r) => { r.calculation.response.result.demand.lines[0].operands = {}; },
      (r) => { r.calculation.response.result.existingCapacity.status = 'adequate'; },
    ];
    for (const edit of edits) { const r = copy(good); edit(r); refusal(Record.readStoredRecord(r)); }
  });

  test('minimum-only never accepts unvalidated conditions, evidence or numeric output fields without a table', () => {
    const original = makeRecord({ design: (d) => { d.selectedMainRatingA = null; } });
    assert.equal(original.serviceSizing.analysis.ungroundedConductors.tableCandidate, null);
    const variants = [
      ['conditions', 1], ['conditions', { ambientC: 'bad' }], ['sourceEvidence', {}],
      ['sourceEvidence', 1], ['sizedForRatingA', 200], ['ampacity75CA', null], ['material', 'Cu'],
    ];
    for (const [key, value] of variants) {
      const r = copy(original); r.serviceSizing.analysis.ungroundedConductors[key] = value;
      refusal(Record.readStoredRecord(r), /table-output field requires/);
    }
    const badDesign = makeRecord({ design: (d) => { d.conductor.ambientTempC = 'bad'; } });
    const patches = [
      (r) => { r.serviceSizing.analysis.minimumService.sourceEvidence = 1; },
      (r) => { r.serviceSizing.analysis.minimumService.ratingsSubset = ['100']; },
      (r) => { r.serviceSizing.analysis.chosenMain.sourceEvidence = { primaryText: 'missing the rest' }; },
    ];
    for (const patch of patches) { const r = copy(badDesign); patch(r); refusal(Record.readStoredRecord(r)); }
  });

  test('unavailable selection cannot acquire a size or be relabeled as an available candidate', () => {
    const base = makeRecord({ design: (d) => { d.conductor.sizingPath = 'dwelling_83pct_310_12'; } });
    const edits = [
      (u) => { u.size = '2/0'; }, (u) => { u.ampacity75CA = 175; },
      (u) => { u.recommendationAvailable = true; }, (u) => { u.status = 'experimental_candidate'; },
      (u) => { u.qualificationConsistency = null; }, (u) => { u.tableCandidate.conditional = false; },
    ];
    for (const edit of edits) { const r = copy(base); edit(r.serviceSizing.analysis.ungroundedConductors); refusal(Record.readStoredRecord(r)); }
  });

  test('metadata limits are explicit, dates are actual UTC calendar dates and names remain literal text', () => {
    const cap = capture();
    for (const bad of [
      { id: 'sr1_abc' }, { id: 'sr1_' + 'A'.repeat(32) }, { id: '__proto__' },
      { name: '' }, { name: ' \t\n' }, { name: 'n'.repeat(201) },
      { createdAt: '2026-02-29T00:00:00.000Z' }, { createdAt: '2026-04-31T00:00:00.000Z' },
      { createdAt: '2026-10-06T24:00:00.000Z' }, { createdAt: '2026-10-06T00:00:60.000Z' },
      { createdAt: '2026-10-06T00:00:00-04:00' }, { createdAt: '2026-10-06T00:00:00Z' },
    ]) refusal(Record.createRecord(cap, metadata(bad)));
    const literal = '  <img src=x onerror=alert(1)> & "B0"  ';
    const r = ok(Record.createRecord(cap, metadata({ name: literal, createdAt: '2024-02-29T23:59:59.999Z' })));
    assert.equal(r.name, literal); assert.equal(ok(Record.parseStoredRecord(text(r))).name, literal);
    assert.equal(ok(Record.createRecord(cap, metadata({ name: 'n'.repeat(200) }))).name.length, 200);
  });

  test('lossy values, hidden properties, accessors and extra array keys are refused before copying', () => {
    const makeInvalid = [
      (r) => { r.serviceSizing.design.conductor.ambientTempC = undefined; },
      (r) => { r.serviceSizing.design.conductor.ambientTempC = NaN; },
      (r) => { r.serviceSizing.design.conductor.ambientTempC = Infinity; },
      (r) => { r.serviceSizing.design.conductor.ambientTempC = -0; },
      (r) => { r.serviceSizing.design.conductor.ambientTempC = 1n; },
      (r) => { r.serviceSizing.design.conductor.ambientTempC = Symbol('x'); },
      (r) => { r.serviceSizing.design.conductor.ambientTempC = () => 30; },
      (r) => { r.serviceSizing.design.conductor.ambientTempC = new Number(30); },
      (r) => { r.serviceSizing.design.conductor.ambientTempC = new Date('2026-10-06T00:00:00.000Z'); },
      (r) => { r.serviceSizing.analysis.remainingChecks[1] = undefined; },
      (r) => { delete r.serviceSizing.analysis.remainingChecks[1]; },
      (r) => { r.serviceSizing.analysis.remainingChecks.extra = 'lost by JSON'; },
      (r) => { r[Symbol('hidden')] = 'lost'; },
      (r) => { Object.defineProperty(r, 'invisible', { value: 'lost', enumerable: false }); },
      (r) => { r.calculation.request.snapshot.self = r.calculation.request.snapshot; },
      (r) => { r.toJSON = () => ({ kind: 'changed' }); },
    ];
    for (const mutate of makeInvalid) { const r = makeRecord(); mutate(r); refusal(Record.readStoredRecord(r), /cannot|lost|losslessly|cycle|non-enumerable|array hole/); }
    let calls = 0; const r = makeRecord();
    Object.defineProperty(r, 'name', { get() { calls++; return 'side effect'; }, enumerable: true });
    refusal(Record.readStoredRecord(r), /accessor/); assert.equal(calls, 0);
    const cap = capture(); cap.design.conductor.ambientTempC = -0;
    refusal(Record.createRecord(cap, metadata()), /negative zero/);
    assert.ok(Object.is(cap.design.conductor.ambientTempC, -0), 'failure never converts -0 to 0');
  });

  test('custom/subclass/null-prototype arrays refuse before inherited toJSON runs; null-prototype dictionaries remain valid', () => {
    let calls = 0;
    const proto = Object.create(Array.prototype);
    proto.toJSON = function () { calls++; return ['changed through inherited toJSON']; };
    const r1 = makeRecord(); Object.setPrototypeOf(r1.serviceSizing.analysis.remainingChecks, proto);
    refusal(Record.readStoredRecord(r1), /custom.*array/);
    const r2 = makeRecord(); Object.setPrototypeOf(r2.serviceSizing.analysis.remainingChecks, null);
    refusal(Record.readStoredRecord(r2), /custom.*array/);
    class CustomArray extends Array { toJSON() { calls++; return ['changed subclass']; } }
    const r3 = makeRecord(); r3.serviceSizing.analysis.remainingChecks = CustomArray.from(r3.serviceSizing.analysis.remainingChecks);
    refusal(Record.readStoredRecord(r3), /custom.*array/);
    assert.equal(calls, 0, 'no custom serialization was executed');
    const r4 = makeRecord();
    const dict = Object.create(null);
    for (const [k, v] of Object.entries(r4.serviceSizing.sources)) Object.defineProperty(dict, k, { value: v, enumerable: true });
    r4.serviceSizing.sources = dict;
    assert.deepEqual(Record.validateStoredRecord(r4), []);
    assert.equal(text(ok(Record.readStoredRecord(r4))), text(r4));
  });

  test('strict text ingress refuses duplicate keys, non-JSON numbers, roots, negative zero and oversized/deep input', () => {
    const valid = text(makeRecord());
    const duplicate = valid.replace('{"kind":', '{"recordVersion":1,"kind":');
    refusal(Record.parseStoredRecord(duplicate), /duplicate key/);
    for (const bad of ['null', '[]', 'false', '1', '"text"', '{"x":NaN}', '{"x":Infinity}', '{"x":-Infinity}', '{"x":1e1000}', valid + 'x']) refusal(Record.parseStoredRecord(bad));
    refusal(Record.parseStoredRecord(valid.replace('"selectedMainRatingA":200', '"selectedMainRatingA":-0')), /negative zero/);
    refusal(Record.parseStoredRecord(' '.repeat(2 * 1024 * 1024 + 1)), /exceeds/);
    refusal(Record.parseStoredRecord('{"x":'.repeat(70) + 'null' + '}'.repeat(70)), /nesting/);
    refusal(Record.parseStoredRecord(undefined), /string/);
  });
});
