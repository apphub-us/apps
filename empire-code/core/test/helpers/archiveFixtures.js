'use strict';
// Synthetic job archive data. Native image bytes come from the existing generated PNG fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const Job = require('../../src/jobs/jobCard'), Measurement = require('../../src/jobs/jobMeasurement'), Material = require('../../src/jobs/jobMaterial'), Photo = require('../../src/jobs/jobPhoto');
const Archive = require('../../src/jobs/jobArchive'), Source = require('../../src/jobs/jobArchiveSource');
const Record = require('../../src/calc/loadCalcServiceRecord'), State = require('../../src/calc/loadCalcStateV2'), Facade = require('../../src/calc/loadCalcFacade'), Sizing = require('../../src/calc/loadCalcServiceSizing');
const F = require('./photoFixtures'), { makeIndexedDb } = require('./jobIndexedDb');
const id = F.id, J = id('job1_', 1), JR = id('jrev1_', 1), R = id('sr1_', 1), TIME = '2026-10-12T15:00:00.000Z';
const copy = v => JSON.parse(JSON.stringify(v));
function revision(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.revision; }
function resultRecord() {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/loadCalc/LC82-cases-r1.json'), 'utf8')).cases;
  const req = copy(cases.find(c => c.id === 'LC82-B0P').request), draft = State.createEmptyDraftV2(); draft.snapshot = req.snapshot; draft.context = req.context;
  const projected = State.toRequestV2(draft); assert.equal(projected.ok, true); const request = projected.request, response = Facade.evaluateV2(request);
  const design = { selectedMainRatingA: 200, plan: { intent: 'new_design_candidate', oneMainDisconnect: true, noAdditionalSources: true, wholeDwelling: true, singleConductorSet: true }, conductor: { sizingPath: 'dwelling_83pct_310_12', material: 'Cu', terminationTempRatingC: 75, terminationMaterialCompatible: true, insulationTempRatingC: 75, ambientTempC: 30, currentCarryingConductors: 3, wiringMethod: 'single_insulated_conductors_in_raceway', noOtherAdjustmentOrCorrection: true } };
  const made = Record.createRecord({ draft, request, response, design, analysis: Sizing.analyzePrototype(request, design) }, { id: R, name: 'B0 — original 200/175', createdAt: TIME }); assert.equal(made.ok, true); return made.record;
}
function fixture() {
  const result = resultRecord(), fields = { title: 'TEST — Żółć <b>job</b>', address: '123 Test Street\nNYC', notes: 'Original\nnotes' };
  const first = revision(Job.createInitialRevision(fields, [{ serviceResultId: R, savedName: result.name, savedAt: TIME }], { jobId: J, revisionId: JR, savedAt: TIME }));
  const second = revision(Job.createNextRevision(first, { ...fields, notes: 'Revised\nnotes' }, [], { revisionId: id('jrev1_', 2), savedAt: TIME }));
  const head = { kind: Job.HEAD_KIND, recordVersion: 1, jobId: J, currentRevisionId: second.revisionId, revisionNumber: 2 };
  const reading = { label: 'Voltage', quantity: 'voltage', valueText: ' 120.00 ', unit: 'V', location: 'Panel A\nL1–N', measuredLocal: '2026-11-01T01:30', utcOffset: '-04:00', mode: 'AC', instrument: 'Meter', notes: '<b>not markup</b>' };
  const m1 = revision(Measurement.createInitial(reading, { measurementId: id('meas1_', 1), revisionId: id('mrev1_', 1), jobId: J, jobRevisionId: JR, savedAt: TIME }));
  const m2 = revision(Measurement.createCorrection(m1, { ...reading, valueText: '119.50' }, 'Corrected transcription', { revisionId: id('mrev1_', 2), jobRevisionId: second.revisionId, savedAt: TIME }));
  const item = { label: 'EMT', specification: '3/4 inch\nTEST-001', quantityText: '120.00', unit: 'ft', status: 'needed', location: 'Basement\nPanel A', supplier: 'Test', notes: '' };
  const t1 = revision(Material.createInitial(item, { materialId: id('mat1_', 1), revisionId: id('trev1_', 1), jobId: J, jobRevisionId: JR, savedAt: TIME }));
  const t2 = revision(Material.createUpdate(t1, { ...item, status: 'not_needed' }, 'Not needed — retained', { revisionId: id('trev1_', 2), jobRevisionId: second.revisionId, savedAt: TIME }));
  const p1 = revision(Photo.createInitial(F.fields(), F.meta(), { photoId: id('photo1_', 1), revisionId: id('prev1_', 1), jobId: J, jobRevisionId: JR, savedAt: TIME }));
  const p2 = revision(Photo.createUpdate(p1, F.fields({ state: 'excluded' }), 'Retained, not deleted', { revisionId: id('prev1_', 2), jobRevisionId: second.revisionId, savedAt: TIME }));
  const original = { photoId: p1.photoId, jobId: J, file: F.meta(), offset: 0 };
  const manifest = { kind: Archive.KIND, archiveVersion: 1, archiveId: id('archive1_', 1), producer: { applicationRevision: 'LC-JOB-ARCHIVE-1', baseSourcePin: Archive.BASE_SOURCE_PIN }, capture: { startedAt: TIME, completedAt: TIME, consistency: 'two_read_stability_check' }, job: { head, revisions: [first, second] }, measurements: [m1, m2], materials: [t1, t2], photoRevisions: [p1, p2], originals: [original], results: [{ serviceResultId: R, raw: JSON.stringify(result, null, 1) }] };
  const assets = [{ photoId: p1.photoId, blob: new Blob([F.png()], { type: 'image/png' }) }];
  return { manifest, assets };
}
function rig(data = fixture()) {
  const dbs = {};
  for (const name of Object.keys(Source.SCHEMAS)) {
    const d = makeIndexedDb(name), schema = {};
    for (const [n, [keyPath, indexes]] of Object.entries(Source.SCHEMAS[name])) { schema[n] = { keyPath, indexes: Object.fromEntries(indexes.map(([i, k]) => [i, { keyPath: k }])) }; }
    const m = data.manifest;
    const records = name === 'empire_code_jobs' ? { jobs: [m.job.head], jobRevisions: m.job.revisions } : name === 'empire_code_measurements' ? { revisions: m.measurements } : name === 'empire_code_materials' ? { revisions: m.materials } : { assets: m.originals.map(a => ({ kind: Photo.ASSET_KIND, recordVersion: 1, photoId: a.photoId, jobId: a.jobId, file: a.file, blob: data.assets.find(v => v.photoId === a.photoId).blob })), revisions: m.photoRevisions };
    d.control.seed({ schema, ...records }); dbs[name] = d;
  }
  const storage = Object.fromEntries(data.manifest.results.filter(r => r.raw !== null).map(r => [Source.PREFIX + r.serviceResultId, r.raw])); let reads = 0;
  const localStorage = { getItem(k) { reads++; return Object.hasOwn(storage, k) ? storage[k] : null; }, setItem() { throw Error('Archive must not write'); } };
  const indexedDB = { open(n, v) { if (!dbs[n]) throw Error('Unexpected database'); return dbs[n].indexedDB.open(n, v); } };
  const options = { indexedDB, localStorage, crypto: F.crypto(500), now: () => TIME };
  return { dbs, storage, options, snapshot: () => Object.fromEntries(Object.entries(dbs).map(([n, d]) => [n, d.control.snapshot()])), reads: () => reads };
}
module.exports = { fixture, rig, resultRecord, copy, F, id, J, JR, R, TIME };
