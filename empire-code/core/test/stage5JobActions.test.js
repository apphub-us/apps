'use strict';
/**
 * STAGE5 conversation -> job actions (append note / create measurement).
 * All storage evidence here is SIMULATED with the existing job IndexedDB test double; the records are
 * written and read back only through the original stores. Authored, not executed by the author.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const A = require('../src/jobs/jobConversationActions');
const Job = require('../src/jobs/jobCard');
const { createJobStore } = require('../src/jobs/jobCardStore');
const { createMeasurementStore } = require('../src/jobs/jobMeasurementStore');
const Batch = require('../src/jobs/jobVoiceBatch');
const { makeIndexedDb, deterministicCrypto } = require('./helpers/jobIndexedDb');

const T0 = '2026-11-20T09:00:00.000Z', T1 = '2026-11-21T15:00:00.000Z', T2 = '2026-11-21T16:30:00.000Z',
  T3 = '2026-11-21T17:00:00.000Z', T4 = '2026-11-21T18:00:00.000Z';
const SRC = 'conv1_' + '3'.repeat(32);
const LINK = { serviceResultId: 'sr1_' + '5'.repeat(32), savedName: 'B0 / review required', savedAt: T0 };
const FIELDS = Object.freeze({ label: 'L1-N', quantity: 'voltage', valueText: '120.00', unit: 'V', location: 'Panel A',
  measuredLocal: '2026-11-21T10:00', utcOffset: '-05:00', mode: 'AC', instrument: 'Meter', notes: 'Observation only' });
const DBS = ['empire_code_jobs', 'empire_code_measurements', 'empire_code_materials', Batch.DB_NAME];

function env() {
  const dbs = {};
  for (const name of DBS) dbs[name] = makeIndexedDb(name);
  const indexedDB = { open(name, version) { if (!dbs[name]) throw new Error('unexpected database ' + name); return dbs[name].indexedDB.open(name, version); } };
  let tail = Promise.resolve();
  const lockCalls = [];
  const locks = { request(name, opts, fn) { lockCalls.push({ name, mode: opts && opts.mode }); const call = tail.then(() => fn()); tail = call.catch(() => {}); return call; } };
  // commit() writes nothing new without a host hook that resolves exactly true (the durable pending marker), so
  // every positive fixture supplies one explicitly. `bare()` is the same environment WITHOUT the hook.
  const pendingCalls = [];
  const persistPending = async (receipt) => { pendingCalls.push(receipt); return true; };
  return { dbs, indexedDB, locks, lockCalls, pendingCalls,
    options: (extra) => Object.assign({ crypto: webcrypto, indexedDB, locks, persistPending }, extra || {}),
    bare: (extra) => Object.assign({ crypto: webcrypto, indexedDB, locks }, extra || {}),
    snap: () => Object.fromEntries(DBS.map((name) => [name, dbs[name].control.snapshot()])),
    jobs: dbs.empire_code_jobs.control, measurements: dbs.empire_code_measurements.control, journal: dbs[Batch.DB_NAME].control };
}
/** A real saved job, created by the original store. */
async function seedJob(e, patch) {
  const store = createJobStore(e.indexedDB, { crypto: deterministicCrypto(1), now: () => T0 });
  const made = await store.create(Object.assign({ title: '  Panel upgrade  ', address: '12 Main Street\nApt 2', notes: 'First visit.\n  Keep original wording.  ' }, patch || {}), [LINK]);
  store.close();
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.job;
}
/** A later ordinary edit of the card by the user, through the original store. */
async function editJob(e, jobId, patch) {
  const store = createJobStore(e.indexedDB, { crypto: deterministicCrypto(500), now: () => T2 });
  const now = await store.read(jobId);
  assert.equal(now.ok, true, JSON.stringify(now));
  const r = now.job.revision;
  const saved = await store.save(jobId, r.revisionId, Object.assign({ title: r.title, address: r.address, notes: r.notes }, patch), []);
  store.close();
  assert.equal(saved.ok, true, JSON.stringify(saved));
  return saved.job;
}
async function readJob(e, jobId) {
  const store = createJobStore(e.indexedDB, {});
  const now = await store.read(jobId), history = await store.history(jobId);
  store.close();
  assert.equal(now.ok, true, JSON.stringify(now)); assert.equal(history.ok, true, JSON.stringify(history));
  return { job: now.job, revisions: history.revisions };
}
function fixedIds(list) {
  const queue = list.map((id) => id.split('_')[1]);
  return { getRandomValues(bytes) {
    const hex = queue.shift(); if (!hex) throw new Error('no more test identities');
    for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  } };
}
const note = (text) => ({ kind: 'note', text });
const measurement = (patch) => ({ kind: 'measurement', fields: Object.assign({}, FIELDS, patch || {}) });
function input(job, action, patch) {
  return Object.assign({ sourceId: SRC, sourceRevision: 2, sourceSavedAt: T1, sourceText: 'Neutral bar torque checked, L1 to neutral 120.00 V AC at panel A.',
    job: structuredClone(job), action }, patch || {});
}
async function prepared(e, value) {
  const r = await A.prepare(value, e.options());
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
const yes = (plan) => ({ accepted: true, planId: plan.id });
/** The capture (voice) journal database is never created and never even opened by the adapter. */
function noVoiceJournal(e) {
  assert.equal(e.journal.snapshot(), null, 'no voice journal database exists');
  assert.equal(e.journal.stats.opens, 0, 'the voice journal was never opened');
}
const derived = (prefix, parts) => prefix + createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex').slice(0, 32);
function refused(result, code) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.status, 'refused', JSON.stringify(result));
  assert.equal(result.code, code, JSON.stringify(result));
  assert.ok(Array.isArray(result.problems) && result.problems.length > 0);
}

test('validate is synchronous and pure; prepare is deterministic and writes nothing', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), before = structuredClone(value), s0 = e.snap();
  const checked = A.validate(value);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.deepEqual(checked.input, before);
  checked.input.action.text = 'mutated copy';
  assert.deepEqual(value, before);
  const a = await prepared(e, value), b = await prepared(e, structuredClone(value));
  assert.deepEqual(a, b);
  assert.deepEqual(value, before);
  assert.deepEqual(e.snap(), s0);
  assert.equal(A.validatePlan(JSON.parse(JSON.stringify(a.plan))).ok, true);
  assert.match(a.plan.id, /^jact1_[0-9a-f]{32}$/);
  assert.deepEqual(a.plan.job, { jobId: job.head.jobId, jobRevisionId: job.head.currentRevisionId, revisionNumber: 1 });
  assert.equal(a.plan.binding.sourceId, SRC); assert.equal(a.plan.binding.sourceRevision, 2); assert.equal(a.plan.binding.sourceSavedAt, T1);
});

test('record identities are SHA-256 of source + source revision + job + content, not random and not model supplied', async () => {
  const e = env(), job = await seedJob(e);
  const n = await prepared(e, input(job, note('Checked.')));
  assert.equal(n.plan.record.revisionId, derived('jrev1_', ['ec-job-action-note-revision-v1', SRC, 2, job.head.jobId, 'Checked.']));
  const sorted = Object.fromEntries(Object.keys(FIELDS).sort().map((k) => [k, FIELDS[k]]));
  const m = await prepared(e, input(job, measurement()));
  assert.equal(m.plan.record.measurementId, derived('meas1_', ['ec-job-action-measurement-v1', SRC, 2, job.head.jobId, sorted]));
  assert.equal(m.plan.record.revisionId, derived('mrev1_', ['ec-job-action-measurement-revision-v1', SRC, 2, job.head.jobId, sorted]));
  // A different source revision, source, content or job is a different record; the surrounding source text is not identity.
  for (const change of [{ sourceRevision: 3 }, { sourceId: 'conv1_' + '4'.repeat(32) }, { action: note('Checked!') }]) {
    assert.notEqual((await prepared(e, input(job, note('Checked.'), change))).plan.record.revisionId, n.plan.record.revisionId);
  }
  const reworded = await prepared(e, input(job, note('Checked.'), { sourceText: 'Other words around the same note.' }));
  assert.equal(reworded.plan.record.revisionId, n.plan.record.revisionId);
  assert.notEqual(reworded.plan.id, n.plan.id);
  assert.notEqual(reworded.plan.binding.sourceFingerprint, n.plan.binding.sourceFingerprint);
  const other = env(), otherJob = (await editJob(other, (await seedJob(other)).head.jobId, { title: 'Other' }));
  assert.equal((await prepared(other, input(otherJob, note('Checked.'), { sourceSavedAt: T3 }))).plan.record.revisionId, n.plan.record.revisionId, 'same job id, later head: same record identity');
  // An action cannot carry a job or an identifier.
  for (const action of [{ kind: 'note', text: 'Checked.', jobId: job.head.jobId }, { kind: 'measurement', fields: Object.assign({}, FIELDS), jobId: job.head.jobId },
    { kind: 'note', text: 'Checked.', revisionId: 'jrev1_' + '9'.repeat(32) }, { kind: 'delete', text: 'x' }, { kind: 'material', fields: {} }, 'note', null]) {
    refused(await A.prepare(input(job, action), e.options()), 'INVALID');
  }
});

test('note: a confirmed append is one new original revision in which only notes changed', async () => {
  const e = env(), job = await seedJob(e), text = '  Neutral bar torque checked.\n\tSecond line  ';
  const value = input(job, note(text)), p = await prepared(e, value);
  assert.equal(p.review.notesBefore, job.revision.notes);
  assert.equal(p.review.notesAfter, job.revision.notes + A.NOTE_SEPARATOR + text);
  const r = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.status, 'confirmed'); assert.equal(r.reconciled, false);
  assert.equal(r.receipt.state, 'confirmed'); assert.equal(r.receipt.planId, p.plan.id);
  assert.equal(r.receipt.record.store, 'job-card'); assert.equal(r.receipt.record.revisionId, p.plan.record.revisionId);
  const stored = await readJob(e, job.head.jobId), rev = stored.job.revision;
  assert.deepEqual(rev, p.review.expectedRecord);
  assert.equal(rev.revisionId, p.plan.record.revisionId);
  assert.equal(rev.parentRevisionId, job.revision.revisionId);
  assert.equal(rev.revisionNumber, 2);
  assert.equal(rev.title, job.revision.title);
  assert.equal(rev.address, job.revision.address);
  assert.deepEqual(rev.serviceResultLinks, job.revision.serviceResultLinks);
  assert.equal(rev.createdAt, job.revision.createdAt);
  assert.equal(rev.savedAt, T1);
  assert.equal(rev.notes, 'First visit.\n  Keep original wording.  \n\n  Neutral bar torque checked.\n\tSecond line  ');
  assert.equal(/conv1_|jact1_|jrev1_|voice1_/.test(rev.notes), false, 'no implementation identity in user-facing notes');
  // History: the earlier revision is byte-for-byte what it was and is still readable.
  assert.equal(stored.revisions.length, 2);
  assert.deepEqual(stored.revisions[1], job.revision);
  assert.deepEqual(e.jobs.raw('jobRevisions', job.revision.revisionId), job.revision);
  assert.equal(e.jobs.count('jobs'), 1);
  assert.equal(e.measurements.snapshot(), null);
  noVoiceJournal(e);
  assert.deepEqual(e.lockCalls, [], 'the note path takes no lock');
});

test('note: empty existing notes receive exactly the reviewed text, without a separator', async () => {
  const e = env(), job = await seedJob(e, { notes: '' }), value = input(job, note('Only note.')), p = await prepared(e, value);
  assert.equal(p.plan.record.separator, '');
  assert.equal((await A.commit(p.plan, value, yes(p.plan), e.options())).status, 'confirmed');
  assert.equal((await readJob(e, job.head.jobId)).job.revision.notes, 'Only note.');
});

test('measurement: confirmed canonical fields are stored once by the original measurement journal', async () => {
  const e = env(), job = await seedJob(e), value = input(job, measurement()), p = await prepared(e, value), jobsBefore = e.jobs.snapshot();
  assert.deepEqual(p.plan.record.fields, Object.assign({}, FIELDS));
  assert.deepEqual(Object.keys(p.plan.record).sort(), ['fields', 'measuredAt', 'measurementId', 'recordHash', 'revisionId', 'savedAt']);
  // A plan of the earlier shape (an embedded voice plan) is not a valid plan any more.
  const legacy = structuredClone(p.plan); legacy.record.batchPlan = { id: 'voice1_' + '1'.repeat(32) };
  assert.equal(A.validatePlan(legacy).ok, false);
  assert.equal(p.plan.record.measuredAt, '2026-11-21T15:00:00.000Z');
  const r = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.status, 'confirmed'); assert.equal(r.reconciled, false);
  assert.equal(r.receipt.record.store, 'measurement'); assert.equal(r.receipt.record.id, p.plan.record.measurementId);
  assert.deepEqual(r.receipt.record, { store: 'measurement', id: p.plan.record.measurementId, revisionId: p.plan.record.revisionId,
    recordHash: p.plan.record.recordHash, journalPlanId: null });
  assert.equal(A.validateReceipt(r.receipt).ok, true);
  const journaled = structuredClone(r.receipt); journaled.record.journalPlanId = 'voice1_' + '1'.repeat(32);
  assert.equal(A.validateReceipt(journaled).ok, false, 'a receipt cannot point at a voice journal entry');
  assert.deepEqual(e.lockCalls, [{ name: 'empire-code-voice-save-v1', mode: 'exclusive' }], 'one exclusive measurement lock');
  assert.equal(e.measurements.count('revisions'), 1);
  const raw = e.measurements.raw('revisions', p.plan.record.revisionId);
  assert.deepEqual(raw, p.review.expectedRecord);
  assert.deepEqual(raw.reading, Object.assign({}, FIELDS));
  assert.equal(raw.measurementId, p.plan.record.measurementId);
  assert.equal(raw.jobId, job.head.jobId); assert.equal(raw.jobRevisionId, job.head.currentRevisionId);
  assert.equal(raw.revisionNumber, 1); assert.equal(raw.savedAt, T1); assert.equal(raw.measuredAt, '2026-11-21T15:00:00.000Z');
  // The original store lists it; the job card and the materials journal are untouched; no capture stays pending.
  const store = createMeasurementStore(e.indexedDB, {}), list = await store.list(job.head.jobId); store.close();
  assert.equal(list.ok, true); assert.equal(list.measurements.length, 1); assert.deepEqual(list.measurements[0].current, raw);
  assert.deepEqual(e.jobs.snapshot(), jobsBefore);
  assert.equal(e.dbs.empire_code_materials.control.snapshot(), null);
  noVoiceJournal(e);
});

test('absent, false or mismatched confirmation never hashes, opens storage, locks or writes', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), p = await prepared(e, value);
  const mValue = input(job, measurement()), m = await prepared(e, mValue), s0 = e.snap();
  let calls = 0;
  const guarded = { crypto: { subtle: { digest: async () => { calls++; throw new Error('must not hash'); } } },
    indexedDB: { open() { calls++; throw new Error('must not open'); } }, locks: { request() { calls++; throw new Error('must not lock'); } },
    persistPending: async () => { calls++; return true; } };
  let getterRuns = 0;
  const trap = { planId: p.plan.id }; Object.defineProperty(trap, 'accepted', { get() { getterRuns++; return true; }, enumerable: true });
  const cases = [[undefined, 'CONFIRMATION'], [null, 'CONFIRMATION'], [{}, 'CONFIRMATION'], [true, 'CONFIRMATION'], [{ accepted: true }, 'CONFIRMATION'],
    [{ accepted: 'true', planId: p.plan.id }, 'CONFIRMATION'], [{ accepted: 1, planId: p.plan.id }, 'CONFIRMATION'], [{ accepted: true, planId: p.plan.id, extra: 1 }, 'CONFIRMATION'],
    [{ accepted: true, planId: 'jact1_' + '0'.repeat(32) }, 'CONFIRMATION'], [{ accepted: true, planId: m.plan.id }, 'CONFIRMATION'], [trap, 'CONFIRMATION'],
    [{ accepted: false, planId: p.plan.id }, 'DECLINED']];
  for (const [consent, code] of cases) refused(await A.commit(p.plan, value, consent, guarded), code);
  refused(await A.commit(m.plan, mValue, { accepted: false, planId: m.plan.id }, guarded), 'DECLINED');
  refused(await A.commit(m.plan, mValue, undefined, e.options()), 'CONFIRMATION');
  assert.equal(calls, 0); assert.equal(getterRuns, 0);
  assert.deepEqual(e.snap(), s0);
});

test('note: a changed source, action or plan after review refuses and writes nothing', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), p = await prepared(e, value), s0 = e.snap();
  for (const change of [{ sourceRevision: 3 }, { sourceSavedAt: T2 }, { sourceText: 'Different words.' }, { sourceId: 'conv1_' + '4'.repeat(32) }, { action: note('Checked!') }, { action: measurement() }]) {
    refused(await A.commit(p.plan, input(job, note('Checked.'), change), yes(p.plan), e.options()), 'STALE');
  }
  // A plan altered after review (for example a damaged pending marker) is not the reviewed plan.
  const altered = structuredClone(p.plan); altered.record.text = 'Checked and approved.';
  assert.equal(A.validatePlan(altered).ok, true, 'shape alone is valid');
  refused(await A.commit(altered, value, yes(altered), e.options()), 'STALE');
  const broken = structuredClone(p.plan); broken.record.revisionNumber = 7;
  refused(await A.commit(broken, value, yes(broken), e.options()), 'CONFIRMATION');
  // An invalid recovered source cannot save either.
  refused(await A.commit(p.plan, input(job, note('Checked.'), { sourceText: '   ' }), yes(p.plan), e.options()), 'INVALID');
  assert.deepEqual(e.snap(), s0);
});

test('note: a job that changed after review requires a new review; the action keeps one record identity', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), p = await prepared(e, value);
  const edited = await editJob(e, job.head.jobId, { address: 'New address' }), s1 = e.snap();
  const stale = await A.commit(p.plan, value, yes(p.plan), e.options());
  refused(stale, 'STALE'); assert.equal(stale.stored, false);
  assert.deepEqual(e.snap(), s1);
  const absent = await A.reconcile(A.pendingReceipt(p.plan).receipt, e.options());
  assert.equal(absent.status, 'pending'); assert.equal(absent.code, 'NOT_STORED'); assert.equal(absent.stored, false);
  // A forged copy of the current job (same identities, different content) is not the saved job.
  const forged = structuredClone(edited); forged.revision.title = 'Forged title';
  const forgedValue = input(forged, note('Checked.'), { sourceSavedAt: T3 }), forgedPlan = await prepared(e, forgedValue);
  refused(await A.commit(forgedPlan.plan, forgedValue, yes(forgedPlan.plan), e.options()), 'STALE');
  assert.deepEqual(e.snap(), s1);
  // The proposal saved before the manual edit cannot be dated before its new parent revision.
  refused(await A.prepare(input(edited, note('Checked.')), e.options()), 'SOURCE_OUTDATED');
  // The proposal is saved again (T3), then reviewed against the current job: a new plan, the same record identity.
  const again = input(edited, note('Checked.'), { sourceSavedAt: T3 }), q = await prepared(e, again);
  assert.notEqual(q.plan.id, p.plan.id); assert.equal(q.plan.record.revisionId, p.plan.record.revisionId);
  assert.equal((await A.commit(q.plan, again, yes(q.plan), e.options())).status, 'confirmed');
  const stored = await readJob(e, job.head.jobId);
  assert.equal(stored.revisions.length, 3);
  assert.equal(stored.job.revision.address, 'New address');
  assert.equal(stored.job.revision.notes, edited.revision.notes + '\n\nChecked.');
  // The superseded plan can no longer append: its identity holds the record of the later review.
  const s2 = e.snap(), old = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(old.status, 'conflict', JSON.stringify(old)); assert.equal(old.code, 'CONFLICT'); assert.equal(old.receipt.state, 'conflict');
  assert.equal(old.existing.revisionId, p.plan.record.revisionId);
  assert.deepEqual(e.snap(), s2);
});

test('measurement: a job that changed after review blocks the write before any journal marker exists', async () => {
  const e = env(), job = await seedJob(e), value = input(job, measurement()), p = await prepared(e, value);
  await editJob(e, job.head.jobId, { title: 'Renamed' });
  const jobsBefore = e.jobs.snapshot(), r = await A.commit(p.plan, value, yes(p.plan), e.options());
  refused(r, 'STALE'); assert.equal(r.stored, false);
  assert.equal(e.measurements.count('revisions'), 0);
  assert.equal(e.journal.snapshot(), null);
  assert.deepEqual(e.jobs.snapshot(), jobsBefore);
});

test('note: repeated confirmation, a lost acknowledgement, a reload and a later head never append twice', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), p = await prepared(e, value);
  // The host recorded this before commit; then the page died after the transaction committed (result never seen).
  const marker = JSON.parse(JSON.stringify({ plan: p.plan, input: value, receipt: A.pendingReceipt(p.plan).receipt }));
  await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(e.jobs.count('jobRevisions'), 2);
  const s1 = e.snap();
  // Reload: nothing in memory. The receipt alone finds the exact stored revision.
  const found = await A.reconcile(marker.receipt, e.options());
  assert.equal(found.ok, true, JSON.stringify(found)); assert.equal(found.status, 'confirmed'); assert.equal(found.receipt.state, 'confirmed');
  const retry = await A.commit(marker.plan, marker.input, yes(marker.plan), e.options());
  assert.equal(retry.status, 'confirmed', JSON.stringify(retry)); assert.equal(retry.reconciled, true);
  assert.deepEqual(e.snap(), s1);
  // The user edits the card afterwards: the head advances, the stored note revision is historical.
  const edited = await editJob(e, job.head.jobId, { title: 'Renamed later' }), s2 = e.snap();
  assert.equal(edited.head.revisionNumber, 3);
  assert.equal((await A.reconcile(marker.receipt, e.options())).status, 'confirmed');
  const late = await A.commit(marker.plan, marker.input, yes(marker.plan), e.options());
  assert.equal(late.status, 'confirmed', JSON.stringify(late)); assert.equal(late.reconciled, true);
  assert.deepEqual(e.snap(), s2);
  const stored = await readJob(e, job.head.jobId);
  assert.equal(stored.revisions.length, 3);
  assert.equal(stored.job.revision.notes.split('Checked.').length, 2, 'the note text occurs once');
});

test('note: two simultaneous confirmations of one plan store exactly one revision', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), p = await prepared(e, value);
  const results = await Promise.all([A.commit(p.plan, value, yes(p.plan), e.options()), A.commit(structuredClone(p.plan), structuredClone(value), yes(p.plan), e.options())]);
  assert.ok(results.every((r) => r.status === 'confirmed'), JSON.stringify(results));
  assert.deepEqual(results.map((r) => r.reconciled).sort(), [false, true]);
  assert.equal(e.jobs.count('jobRevisions'), 2);
  assert.equal((await readJob(e, job.head.jobId)).job.revision.notes, job.revision.notes + '\n\nChecked.');
});

test('measurement: retry, simultaneous confirmation, lost acknowledgement and a later job head reuse the stored record', async () => {
  const e = env(), job = await seedJob(e), value = input(job, measurement()), p = await prepared(e, value);
  const first = await Promise.all([A.commit(p.plan, value, yes(p.plan), e.options()), A.commit(p.plan, structuredClone(value), yes(p.plan), e.options())]);
  assert.ok(first.every((r) => r.status === 'confirmed'), JSON.stringify(first));
  assert.deepEqual(first.map((r) => r.reconciled).sort(), [false, true], 'one write, one reconciliation');
  assert.equal(e.measurements.count('revisions'), 1);
  await editJob(e, job.head.jobId, { title: 'Renamed later' });
  const s1 = e.snap(), receipt = JSON.parse(JSON.stringify(A.pendingReceipt(p.plan).receipt));
  const found = await A.reconcile(receipt, e.options());
  assert.equal(found.status, 'confirmed', JSON.stringify(found));
  const retry = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(retry.status, 'confirmed', JSON.stringify(retry)); assert.equal(retry.reconciled, true);
  assert.deepEqual(e.snap(), s1);
  assert.equal(e.measurements.count('revisions'), 1);
  assert.deepEqual(e.measurements.raw('revisions', p.plan.record.revisionId), p.review.expectedRecord);
});

test('measurement: a lost acknowledgement is pending with an unknown outcome; reconcile and a retry find the one stored record', async () => {
  const e = env(), job = await seedJob(e), value = input(job, measurement()), p = await prepared(e, value);
  // The write completes under the lock, then its result never reaches the caller.
  const lossy = { request: (name, opts, fn) => e.locks.request(name, opts, fn).then(() => { throw new Error('acknowledgement lost'); }) };
  const r = await A.commit(p.plan, value, yes(p.plan), e.options({ locks: lossy }));
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.status, 'pending'); assert.equal(r.code, 'INTERRUPTED');
  assert.equal(r.stored, null, 'the outcome is not guessed'); assert.equal(r.receipt.state, 'pending');
  assert.equal(e.measurements.count('revisions'), 1);
  const s1 = e.snap();
  assert.equal((await A.reconcile(r.receipt, e.options())).status, 'confirmed');
  const retry = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(retry.status, 'confirmed', JSON.stringify(retry)); assert.equal(retry.reconciled, true);
  assert.deepEqual(e.snap(), s1, 'the retry wrote nothing');
  noVoiceJournal(e);
});

test('measurement: a job changed just before the original store\'s own check writes nothing and leaves no journal; the re-review commits exactly once', async () => {
  const e = env(), job = await seedJob(e), value = input(job, measurement()), p = await prepared(e, value);
  let hookRuns = 0;
  // The hook runs after the adapter's own job check and before the store's check: the narrowest window there is.
  const r = await A.commit(p.plan, value, yes(p.plan), e.options({ persistPending: async () => { hookRuns++; await editJob(e, job.head.jobId, { title: 'Renamed in the window' }); return true; } }));
  refused(r, 'STALE'); assert.equal(r.stored, false); assert.equal(hookRuns, 1);
  assert.equal(e.measurements.count('revisions'), 0);
  noVoiceJournal(e);
  const absent = await A.reconcile(A.pendingReceipt(p.plan).receipt, e.options());
  assert.equal(absent.status, 'pending'); assert.equal(absent.code, 'NOT_STORED'); assert.equal(absent.stored, false);
  // The stale plan stays refused and is never written blindly.
  const stale = await A.commit(p.plan, value, yes(p.plan), e.options({ persistPending: async () => { hookRuns++; return true; } }));
  refused(stale, 'STALE'); assert.equal(stale.stored, false); assert.equal(hookRuns, 1);
  assert.equal(e.measurements.count('revisions'), 0);
  // Re-review against the new head. The proposal is saved again first (T3 is not before the edited revision).
  const head = (await readJob(e, job.head.jobId)).job;
  refused(await A.prepare(input(head, measurement()), e.options()), 'SOURCE_OUTDATED');
  const next = input(head, measurement(), { sourceSavedAt: T3 }), q = await prepared(e, next);
  assert.notEqual(q.plan.id, p.plan.id);
  assert.equal(q.plan.record.measurementId, p.plan.record.measurementId); assert.equal(q.plan.record.revisionId, p.plan.record.revisionId);
  assert.equal(q.plan.job.jobRevisionId, head.head.currentRevisionId);
  const done = await A.commit(q.plan, next, yes(q.plan), e.options());
  assert.equal(done.status, 'confirmed', JSON.stringify(done)); assert.equal(done.reconciled, false);
  assert.equal(e.measurements.count('revisions'), 1);
  const raw = e.measurements.raw('revisions', q.plan.record.revisionId);
  assert.deepEqual(raw, q.review.expectedRecord);
  assert.equal(raw.jobRevisionId, head.head.currentRevisionId); assert.equal(raw.savedAt, T3);
  const s1 = e.snap(), twice = await A.commit(q.plan, next, yes(q.plan), e.options());
  assert.equal(twice.status, 'confirmed'); assert.equal(twice.reconciled, true);
  assert.equal((await A.reconcile(done.receipt, e.options())).status, 'confirmed');
  // The superseded plan cannot add a second reading: its identity holds the re-reviewed record.
  const old = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(old.status, 'conflict', JSON.stringify(old)); assert.equal(old.existing.revisionId, q.plan.record.revisionId);
  assert.deepEqual(e.snap(), s1);
  noVoiceJournal(e);
});

test('measurement: a failed write whose result cannot be read back is pending with an unknown outcome, then stored once', async () => {
  const e = env(), job = await seedJob(e), value = input(job, measurement()), p = await prepared(e, value);
  e.measurements.abortNextCommit('QuotaExceededError', 'readwrite');
  // Store counts: 1 = search before the write, 2 = the write transaction, 3 = the read after the failure.
  e.measurements.failRequest({ store: 'revisions', operation: 'count', after: 2 });
  const r = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.status, 'pending'); assert.equal(r.code, 'QUOTA');
  assert.equal(r.stored, null, 'neither "absent" nor "stored" is assumed');
  assert.equal(e.measurements.count('revisions'), 0);
  const absent = await A.reconcile(r.receipt, e.options());
  assert.equal(absent.status, 'pending'); assert.equal(absent.code, 'NOT_STORED'); assert.equal(absent.stored, false);
  const retry = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(retry.status, 'confirmed', JSON.stringify(retry)); assert.equal(retry.reconciled, false);
  assert.equal(e.measurements.count('revisions'), 1);
  assert.deepEqual(e.measurements.raw('revisions', p.plan.record.revisionId), p.review.expectedRecord);
  noVoiceJournal(e);
});

test('measurement: a record stored by another writer inside the window is reconciled or reported, never duplicated or overwritten', async () => {
  const same = env(), job = await seedJob(same), value = input(job, measurement()), p = await prepared(same, value);
  const otherWriter = async (e, fields, at) => {
    const store = createMeasurementStore(e.indexedDB, { crypto: fixedIds([p.plan.record.measurementId, p.plan.record.revisionId]), now: () => at,
      readJob: async () => ({ ok: true, job: structuredClone(job) }) });
    const made = await store.create(job.head.jobId, fields); store.close();
    assert.equal(made.ok, true, JSON.stringify(made));
  };
  // Exactly the reviewed record appears after the adapter's search: the store refuses the identity, the history is read again.
  const r = await A.commit(p.plan, value, yes(p.plan), same.options({ persistPending: async () => { await otherWriter(same, Object.assign({}, FIELDS), T1); return true; } }));
  assert.equal(r.status, 'confirmed', JSON.stringify(r)); assert.equal(r.reconciled, true);
  assert.equal(same.measurements.count('revisions'), 1);
  assert.deepEqual(same.measurements.raw('revisions', p.plan.record.revisionId), p.review.expectedRecord);
  noVoiceJournal(same);
  // A different reading under the same identity appears in the window: conflict, the existing row is untouched.
  const diff = env(), job2 = await seedJob(diff);
  assert.deepEqual(job2, job, 'same deterministic seed');
  const c = await A.commit(p.plan, value, yes(p.plan), diff.options({ persistPending: async () => { await otherWriter(diff, Object.assign({}, FIELDS, { valueText: '119.00' }), T2); return true; } }));
  assert.equal(c.ok, false); assert.equal(c.status, 'conflict', JSON.stringify(c)); assert.equal(c.receipt.state, 'conflict');
  assert.equal(c.existing.revisionId, p.plan.record.revisionId);
  assert.equal(diff.measurements.count('revisions'), 1);
  assert.equal(diff.measurements.raw('revisions', p.plan.record.revisionId).reading.valueText, '119.00');
  assert.equal((await A.reconcile(c.receipt, diff.options())).status, 'conflict');
  noVoiceJournal(diff);
});

test('record time: a source saved before the reviewed job revision is refused; a retry of one plan keeps its time', async () => {
  const e = env(), job = await seedJob(e);
  const edited = await editJob(e, job.head.jobId, { address: 'New address' }), s0 = e.snap();
  assert.equal(edited.revision.savedAt, T2);
  for (const action of [note('Checked.'), measurement()]) {
    assert.equal(A.validate(input(edited, action)).code, 'SOURCE_OUTDATED', 'T1 is before the reviewed revision');
    refused(await A.prepare(input(edited, action), e.options()), 'SOURCE_OUTDATED');
    assert.equal(A.validate(input(edited, action, { sourceSavedAt: T2 })).ok, true, 'the same instant is accepted');
  }
  assert.deepEqual(e.snap(), s0);
  const value = input(edited, note('Checked.'), { sourceSavedAt: T3 }), p = await prepared(e, value);
  assert.equal((await A.commit(p.plan, value, yes(p.plan), e.options())).status, 'confirmed');
  const stored = await readJob(e, job.head.jobId);
  assert.equal(stored.job.revision.savedAt, T3); assert.equal(stored.revisions[1].savedAt, T2);
  // A retry is the same plan with the same time. A different save time is a different plan, not a silent re-date.
  const s1 = e.snap(), retry = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(retry.status, 'confirmed'); assert.equal(retry.reconciled, true);
  refused(await A.commit(p.plan, input(edited, note('Checked.'), { sourceSavedAt: T4 }), yes(p.plan), e.options()), 'STALE');
  assert.deepEqual(e.snap(), s1);
  assert.equal((await readJob(e, job.head.jobId)).job.revision.savedAt, T3);
});

test('note: a different record under the allocated identity is a conflict; nothing is overwritten or appended', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), p = await prepared(e, value);
  // The planned revision ID is already used by an unrelated edit of the same card.
  const store = createJobStore(e.indexedDB, { crypto: fixedIds([p.plan.record.revisionId]), now: () => T2 });
  const other = await store.save(job.head.jobId, job.head.currentRevisionId, { title: 'Unrelated edit', address: job.revision.address, notes: job.revision.notes }, []);
  store.close();
  assert.equal(other.ok, true, JSON.stringify(other)); assert.equal(other.job.revision.revisionId, p.plan.record.revisionId);
  const s1 = e.snap(), r = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(r.ok, false); assert.equal(r.status, 'conflict', JSON.stringify(r)); assert.equal(r.code, 'CONFLICT'); assert.equal(r.receipt.state, 'conflict');
  const again = await A.reconcile(A.pendingReceipt(p.plan).receipt, e.options());
  assert.equal(again.status, 'conflict', JSON.stringify(again));
  assert.deepEqual(e.snap(), s1);
  // A receipt whose record hash was altered does not match the stored revision either.
  const e2 = env(), job2 = await seedJob(e2), value2 = input(job2, note('Checked.')), p2 = await prepared(e2, value2);
  assert.equal((await A.commit(p2.plan, value2, yes(p2.plan), e2.options())).status, 'confirmed');
  const tampered = structuredClone(A.pendingReceipt(p2.plan).receipt); tampered.record.recordHash = '0'.repeat(64);
  assert.equal((await A.reconcile(tampered, e2.options())).status, 'conflict');
  for (const bad of [null, {}, Object.assign({}, tampered, { state: 'done' }), Object.assign({}, tampered, { extra: 1 }), Object.assign({}, tampered, { jobId: 'job-1' })]) {
    refused(await A.reconcile(bad, e2.options()), 'INVALID');
  }
});

test('measurement: a different reading under the allocated identity is a conflict and leaves no journal marker', async () => {
  const e = env(), job = await seedJob(e), value = input(job, measurement()), p = await prepared(e, value);
  const store = createMeasurementStore(e.indexedDB, { crypto: fixedIds([p.plan.record.measurementId, p.plan.record.revisionId]), now: () => T2,
    readJob: async () => ({ ok: true, job: structuredClone(job) }) });
  const other = await store.create(job.head.jobId, Object.assign({}, FIELDS, { valueText: '119.00' }));
  store.close();
  assert.equal(other.ok, true, JSON.stringify(other)); assert.equal(other.revision.revisionId, p.plan.record.revisionId);
  const r = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(r.status, 'conflict', JSON.stringify(r)); assert.equal(r.receipt.state, 'conflict');
  assert.equal(e.measurements.count('revisions'), 1);
  assert.equal(e.measurements.raw('revisions', p.plan.record.revisionId).reading.valueText, '119.00');
  assert.equal(e.journal.snapshot(), null);
  assert.equal((await A.reconcile(A.pendingReceipt(p.plan).receipt, e.options())).status, 'conflict');
});

test('note: a quota abort keeps the job exactly as it was, reports pending, and one retry stores it once', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), p = await prepared(e, value), s0 = e.snap();
  e.jobs.abortNextCommit('QuotaExceededError', 'readwrite');
  const r = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.status, 'pending'); assert.equal(r.code, 'QUOTA'); assert.equal(r.stored, false);
  assert.equal(r.receipt.state, 'pending');
  assert.deepEqual(e.snap(), s0);
  const absent = await A.reconcile(r.receipt, e.options());
  assert.equal(absent.status, 'pending'); assert.equal(absent.code, 'NOT_STORED'); assert.equal(absent.stored, false);
  assert.deepEqual(e.snap(), s0);
  const retry = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(retry.status, 'confirmed', JSON.stringify(retry)); assert.equal(retry.reconciled, false);
  assert.equal(e.jobs.count('jobRevisions'), 2);
  assert.deepEqual(e.jobs.raw('jobRevisions', job.revision.revisionId), job.revision);
});

test('measurement: a failed store write leaves the job and readings intact, stays pending, and a retry stores one record', async () => {
  const e = env(), job = await seedJob(e), value = input(job, measurement()), p = await prepared(e, value), jobsBefore = e.jobs.snapshot();
  e.measurements.abortNextCommit('QuotaExceededError', 'readwrite');
  const r = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.status, 'pending'); assert.equal(r.code, 'QUOTA'); assert.equal(r.stored, false);
  assert.equal(e.measurements.count('revisions'), 0);
  assert.deepEqual(e.jobs.snapshot(), jobsBefore);
  assert.equal((await A.reconcile(r.receipt, e.options())).code, 'NOT_STORED');
  const retry = await A.commit(p.plan, value, yes(p.plan), e.options());
  assert.equal(retry.status, 'confirmed', JSON.stringify(retry)); assert.equal(retry.reconciled, false);
  assert.equal(e.measurements.count('revisions'), 1);
  noVoiceJournal(e);
  assert.deepEqual(e.jobs.snapshot(), jobsBefore);
});

test('unavailable crypto, storage or locks refuse before anything is written', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), p = await prepared(e, value);
  const mValue = input(job, measurement()), m = await prepared(e, mValue), s0 = e.snap();
  refused(await A.prepare(value, {}), 'UNAVAILABLE');
  refused(await A.prepare(value, { crypto: { subtle: { digest: async () => new ArrayBuffer(1) } } }), 'UNAVAILABLE');
  refused(await A.commit(p.plan, value, yes(p.plan), e.options({ crypto: null })), 'UNAVAILABLE');
  refused(await A.commit(p.plan, value, yes(p.plan), e.options({ indexedDB: null })), 'UNAVAILABLE');
  refused(await A.commit(m.plan, mValue, yes(m.plan), e.options({ locks: null })), 'UNAVAILABLE');
  refused(await A.reconcile(A.pendingReceipt(p.plan).receipt, { crypto: webcrypto }), 'UNAVAILABLE');
  assert.deepEqual(e.snap(), s0);
});

test('note: the original 20000-character job notes limit is exact; nothing is truncated', async () => {
  const e = env(), base = 'n'.repeat(Job.LIMITS.notes - 12), job = await seedJob(e, { notes: base }), s0 = e.snap();
  const over = await A.prepare(input(job, note('x'.repeat(11))), e.options());
  refused(over, 'LIMIT');
  refused(await A.prepare(input(job, note('y'.repeat(A.LIMITS.noteText + 1))), e.options()), 'LIMIT');
  assert.deepEqual(e.snap(), s0);
  const value = input(job, note('x'.repeat(10))), p = await prepared(e, value);
  assert.equal(p.review.notesAfter.length, Job.LIMITS.notes);
  assert.equal((await A.commit(p.plan, value, yes(p.plan), e.options())).status, 'confirmed');
  const full = (await readJob(e, job.head.jobId)).job;
  assert.equal(full.revision.notes, base + '\n\n' + 'x'.repeat(10));
  // The card is now full: one more character is refused, the stored notes are unchanged.
  const s1 = e.snap();
  refused(await A.prepare(input(full, note('z'), { sourceRevision: 3 }), e.options()), 'LIMIT');
  assert.deepEqual(e.snap(), s1);
});

test('measurement: unit, value and observed time are never inferred, converted or repaired', async () => {
  const e = env(), job = await seedJob(e), s0 = e.snap();
  const patches = [{ unit: 'volts' }, { unit: 'A' }, { unit: '' }, { unit: null }, { quantity: 'pressure' }, { quantity: 'length', unit: 'ft', mode: 'AC' },
    { valueText: 'NaN' }, { valueText: 'Infinity' }, { valueText: '-Infinity' }, { valueText: '1e3' }, { valueText: '1,5' }, { valueText: '' }, { valueText: 'about 120' },
    { valueText: 120 }, { valueText: Number.NaN }, { valueText: Number.POSITIVE_INFINITY },
    { measuredLocal: '' }, { measuredLocal: 'now' }, { measuredLocal: '2026-13-01T10:00' }, { measuredLocal: '2026-11-21T10:00:00' }, { measuredLocal: '2026-11-21' },
    { utcOffset: '' }, { utcOffset: 'Z' }, { utcOffset: '-00:00' }, { utcOffset: '+15:00' }, { mode: 'AC ' }, { label: '   ' }, { location: '' }, { convertedValue: '0.12' }];
  for (const patch of patches) {
    const value = input(job, measurement(patch));
    assert.equal(A.validate(value).ok, false, JSON.stringify(patch));
    refused(await A.prepare(value, e.options()), 'VALIDATION');
  }
  for (const missing of Object.keys(FIELDS)) {
    const action = measurement(); delete action.fields[missing];
    refused(await A.prepare(input(job, action), e.options()), 'VALIDATION');
  }
  // What was reviewed is what is planned: no trimming, no unit or time normalization.
  const exact = measurement({ valueText: ' 0120.50 ', unit: 'mV', notes: '  as read  ' }), p = await prepared(e, input(job, exact));
  assert.deepEqual(p.plan.record.fields, exact.fields);
  assert.deepEqual(p.review.expectedRecord.reading, exact.fields);
  assert.deepEqual(e.snap(), s0);
});

test('persistPending is mandatory for every NEW write: an absent, undefined, misspelled, non-function, throwing or non-true hook writes nothing (note and measurement); a stored record is still found read-only', async () => {
  for (const action of [note('Checked.'), measurement()]) {
    const isNote = action.kind === 'note';
    const e = env(), job = await seedJob(e), value = input(job, action), p = await prepared(e, value), jobsBefore = e.jobs.snapshot();
    let strayRuns = 0;
    const stray = async () => { strayRuns++; return true; };
    const cases = [
      ['options without the key', e.bare()],
      ['explicit undefined', e.bare({ persistPending: undefined })],
      ['misspelled keys', e.bare({ persistPendng: stray, persistpending: stray, persist_pending: stray, onPending: stray })],
      ['null', e.bare({ persistPending: null })],
      ['a string', e.bare({ persistPending: 'yes' })],
      ['boolean true', e.bare({ persistPending: true })],
      ['a number', e.bare({ persistPending: 1 })],
      ['an object', e.bare({ persistPending: { ok: true } })],
      ['resolves false', e.bare({ persistPending: async () => false })],
      ['resolves undefined', e.bare({ persistPending: async () => undefined })],
      ['resolves 1', e.bare({ persistPending: async () => 1 })],
      ['resolves "true"', e.bare({ persistPending: async () => 'true' })],
      ['resolves an object', e.bare({ persistPending: async () => ({ ok: true }) })],
      ['throws synchronously', e.bare({ persistPending: () => { throw new Error('host storage full'); } })],
      ['rejects', e.bare({ persistPending: async () => { throw new Error('host storage full'); } })]
    ];
    let afterFirst = null;
    for (const [name, options] of cases) {
      const r = await A.commit(p.plan, value, yes(p.plan), options);
      refused(r, 'PENDING_MARKER'); assert.equal(r.stored, false, name);
      assert.deepEqual(e.jobs.snapshot(), jobsBefore, name);
      assert.equal(e.jobs.count('jobRevisions'), 1, name);
      // A note never opens the measurement database; a measurement opens it for the read-only search and adds no row.
      if (isNote) assert.equal(e.measurements.snapshot(), null, name); else assert.equal(e.measurements.count('revisions'), 0, name);
      if (afterFirst === null) afterFirst = e.snap(); else assert.deepEqual(e.snap(), afterFirst, name);
      noVoiceJournal(e);
    }
    assert.equal(strayRuns, 0, 'a misspelled hook is never called and never counts');
    assert.deepEqual(e.pendingCalls, []);
    const absent = await A.reconcile(A.pendingReceipt(p.plan).receipt, e.bare());
    assert.equal(absent.status, 'pending'); assert.equal(absent.code, 'NOT_STORED'); assert.equal(absent.stored, false);
    // Positive control: the same plan with a hook that resolves exactly true is written once, after one hook call.
    const done = await A.commit(p.plan, value, yes(p.plan), e.options());
    assert.equal(done.status, 'confirmed', JSON.stringify(done)); assert.equal(done.reconciled, false);
    assert.equal(e.pendingCalls.length, 1); assert.deepEqual(e.pendingCalls[0], A.pendingReceipt(p.plan).receipt);
    if (isNote) assert.equal(e.jobs.count('jobRevisions'), 2); else assert.equal(e.measurements.count('revisions'), 1);
    // Already stored: the read-only search answers `confirmed` without a hook, without a hook call and without a write.
    const s1 = e.snap();
    for (const options of [e.bare(), e.bare({ persistPending: undefined }), e.bare({ persistPending: async () => { strayRuns++; return false; } })]) {
      const again = await A.commit(p.plan, value, yes(p.plan), options);
      assert.equal(again.status, 'confirmed', JSON.stringify(again)); assert.equal(again.reconciled, true);
    }
    assert.deepEqual(e.snap(), s1); assert.equal(e.pendingCalls.length, 1); assert.equal(strayRuns, 0);
    if (isNote) assert.equal(e.jobs.count('jobRevisions'), 2); else assert.equal(e.measurements.count('revisions'), 1);
    noVoiceJournal(e);
  }
});

test('lost acknowledgement: a hooked write that lost its answer is found without a hook; a NEW action without a hook is never written, with or without a lost answer', async () => {
  const e = env(), job = await seedJob(e), value = input(job, measurement()), p = await prepared(e, value);
  const lossy = { request: (name, opts, fn) => e.locks.request(name, opts, fn).then(() => { throw new Error('acknowledgement lost'); }) };
  const r = await A.commit(p.plan, value, yes(p.plan), e.options({ locks: lossy }));
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.status, 'pending'); assert.equal(r.code, 'INTERRUPTED'); assert.equal(r.stored, null);
  assert.equal(e.pendingCalls.length, 1, 'the marker was recorded before the write');
  assert.equal(e.measurements.count('revisions'), 1);
  const s1 = e.snap();
  assert.equal((await A.reconcile(r.receipt, e.bare())).status, 'confirmed');
  const retry = await A.commit(p.plan, value, yes(p.plan), e.bare());
  assert.equal(retry.status, 'confirmed', JSON.stringify(retry)); assert.equal(retry.reconciled, true);
  assert.deepEqual(e.snap(), s1, 'the hookless retry wrote nothing');
  // A different reading is a new action. Without the hook it is not written, even when the answer is lost on the way.
  const otherValue = input(job, measurement({ valueText: '119.00' })), q = await prepared(e, otherValue);
  assert.notEqual(q.plan.record.measurementId, p.plan.record.measurementId);
  const lost = await A.commit(q.plan, otherValue, yes(q.plan), e.bare({ locks: lossy }));
  assert.equal(lost.status, 'pending', JSON.stringify(lost)); assert.equal(lost.code, 'INTERRUPTED'); assert.equal(lost.stored, null, 'a lost answer is never guessed');
  assert.equal(e.measurements.count('revisions'), 1);
  const absent = await A.reconcile(lost.receipt, e.bare());
  assert.equal(absent.status, 'pending'); assert.equal(absent.code, 'NOT_STORED'); assert.equal(absent.stored, false);
  const plain = await A.commit(q.plan, otherValue, yes(q.plan), e.bare());
  refused(plain, 'PENDING_MARKER'); assert.equal(plain.stored, false);
  assert.deepEqual(e.snap(), s1); assert.equal(e.pendingCalls.length, 1);
  // Note path, same rule: the stored note is found without a hook; nothing new is appended without one.
  const n = env(), nJob = await seedJob(n), nValue = input(nJob, note('Checked.')), np = await prepared(n, nValue);
  assert.equal((await A.commit(np.plan, nValue, yes(np.plan), n.options())).status, 'confirmed');
  const n1 = n.snap(), found = await A.commit(np.plan, nValue, yes(np.plan), n.bare());
  assert.equal(found.status, 'confirmed', JSON.stringify(found)); assert.equal(found.reconciled, true);
  const head = (await readJob(n, nJob.head.jobId)).job, moreValue = input(head, note('Second note.')), more = await prepared(n, moreValue);
  const blocked = await A.commit(more.plan, moreValue, yes(more.plan), n.bare());
  refused(blocked, 'PENDING_MARKER'); assert.equal(blocked.stored, false);
  assert.deepEqual(n.snap(), n1); assert.equal(n.jobs.count('jobRevisions'), 2);
  noVoiceJournal(e); noVoiceJournal(n);
});

test('pending receipt: bounded, content-free, recorded before the first write by the required hook', async () => {
  const e = env(), job = await seedJob(e), value = input(job, note('Checked.')), p = await prepared(e, value), s0 = e.snap();
  const made = A.pendingReceipt(p.plan);
  assert.equal(made.ok, true); assert.equal(made.receipt.state, 'pending');
  assert.deepEqual(made.receipt, { kind: A.RECEIPT_KIND, version: 1, state: 'pending', planId: p.plan.id, action: 'note', sourceId: SRC, sourceRevision: 2,
    sourceFingerprint: p.plan.binding.sourceFingerprint, inputHash: p.plan.binding.inputHash, jobId: job.head.jobId, jobRevisionId: job.head.currentRevisionId,
    record: { store: 'job-card', id: job.head.jobId, revisionId: p.plan.record.revisionId, recordHash: p.plan.record.recordHash, journalPlanId: null } });
  assert.equal(A.validateReceipt(JSON.parse(JSON.stringify(made.receipt))).ok, true);
  assert.equal(JSON.stringify(made.receipt).includes('Checked.'), false);
  assert.equal(A.pendingReceipt({}).ok, false);
  // The hook must resolve exactly true; anything else means the marker is not durable and nothing is written.
  for (const hook of [async () => false, async () => ({ ok: true }), async () => { throw new Error('host storage full'); }, 'not a function', null]) {
    const r = await A.commit(p.plan, value, yes(p.plan), e.options({ persistPending: hook }));
    refused(r, 'PENDING_MARKER'); assert.equal(r.stored, false);
  }
  assert.deepEqual(e.snap(), s0);
  const seen = [];
  const r = await A.commit(p.plan, value, yes(p.plan), e.options({ persistPending: async (receipt) => { seen.push({ receipt, revisions: e.jobs.count('jobRevisions') }); return true; } }));
  assert.equal(r.status, 'confirmed', JSON.stringify(r));
  assert.equal(seen.length, 1); assert.equal(seen[0].revisions, 1, 'recorded before the write');
  assert.deepEqual(seen[0].receipt, made.receipt);
  assert.deepEqual(r.receipt, Object.assign({}, made.receipt, { state: 'confirmed' }));
  // Already stored: confirmed again without a new pending marker and without a write.
  const s1 = e.snap(), again = await A.commit(p.plan, value, yes(p.plan), e.options({ persistPending: async () => { seen.push('again'); return true; } }));
  assert.equal(again.status, 'confirmed'); assert.equal(again.reconciled, true); assert.equal(seen.length, 1);
  assert.deepEqual(e.snap(), s1);
});

test('a real saved job is required: missing, incoherent or never-saved jobs are refused', async () => {
  const e = env(), job = await seedJob(e);
  const bad = [null, undefined, {}, 'job1_' + '1'.repeat(32), { head: job.head }, { head: job.head, revision: job.revision, extra: 1 },
    { head: Object.assign({}, job.head, { revisionNumber: 2 }), revision: job.revision },
    { head: Object.assign({}, job.head, { currentRevisionId: 'jrev1_' + '9'.repeat(32) }), revision: job.revision },
    { head: job.head, revision: Object.assign({}, job.revision, { jobId: 'job1_' + '9'.repeat(32) }) },
    { head: job.head, revision: Object.assign({}, job.revision, { notes: undefined }) }];
  for (const value of bad) {
    for (const action of [note('Checked.'), measurement()]) {
      assert.equal(A.validate(input(job, action, { job: value })).code, 'JOB_REQUIRED');
      refused(await A.prepare(input(job, action, { job: value }), e.options()), 'JOB_REQUIRED');
    }
  }
  const noJob = input(job, note('Checked.')); delete noJob.job;
  refused(await A.prepare(noJob, e.options()), 'INVALID');
  // A well-formed job that this storage never saved cannot receive anything.
  const ghostId = 'job1_' + '7'.repeat(32);
  const ghostRevision = Job.createInitialRevision({ title: 'Never saved', address: '', notes: '' }, [], { jobId: ghostId, revisionId: 'jrev1_' + '8'.repeat(32), savedAt: T0 }).revision;
  const ghost = { head: { kind: Job.HEAD_KIND, recordVersion: 1, jobId: ghostId, currentRevisionId: ghostRevision.revisionId, revisionNumber: 1 }, revision: ghostRevision };
  const jobsBefore = e.jobs.snapshot();
  for (const action of [note('Checked.'), measurement()]) {
    const value = input(ghost, action), p = await prepared(e, value), r = await A.commit(p.plan, value, yes(p.plan), e.options());
    refused(r, 'JOB_UNAVAILABLE'); assert.equal(r.stored, false);
  }
  assert.deepEqual(e.jobs.snapshot(), jobsBefore);
  assert.equal(e.measurements.count('revisions'), 0);
  assert.equal(e.journal.snapshot(), null);
});

test('input is a closed bounded shape, captured before the first await; getters never run', async () => {
  const e = env(), job = await seedJob(e), base = () => input(job, note('Checked.'));
  const mutations = [(v) => { v.extra = 1; }, (v) => { delete v.sourceText; }, (v) => { v.sourceId = 'conversation-1'; }, (v) => { v.sourceRevision = '2'; },
    (v) => { v.sourceRevision = -1; }, (v) => { v.sourceRevision = 1.5; }, (v) => { v.sourceSavedAt = '2026-11-21 15:00'; }, (v) => { v.sourceText = ''; },
    (v) => { v.sourceText = ' \n '; }, (v) => { v.sourceText = 'bell\u0007'; }, (v) => { v.action.text = ''; }, (v) => { v.action.text = '\n \t'; },
    (v) => { v.action.text = 'null\u0000byte'; }, (v) => { v.action.text = 42; }, (v) => { v.action.extra = true; }, (v) => { v.action = []; }];
  for (const mutate of mutations) {
    const value = base(); mutate(value);
    assert.equal(A.validate(value).ok, false);
    refused(await A.prepare(value, e.options()), 'INVALID');
  }
  for (const value of [null, undefined, [], 'text', 7]) refused(await A.prepare(value, e.options()), 'INVALID');
  refused(await A.prepare(input(job, note('Checked.'), { sourceRevision: 101 }), e.options()), 'LIMIT');
  refused(await A.prepare(input(job, note('Checked.'), { sourceText: 's'.repeat(A.LIMITS.sourceText + 1) }), e.options()), 'LIMIT');
  // The source text limit is the /api/assist utterance limit; the note and reading limits stay as they were.
  assert.equal(A.LIMITS.sourceText, 3000); assert.equal(A.LIMITS.noteText, 4000);
  assert.equal(A.validate(input(job, note('Checked.'), { sourceText: 's'.repeat(3000) })).ok, true);
  assert.equal((await A.prepare(input(job, measurement(), { sourceText: 's'.repeat(3000) }), e.options())).ok, true);
  let getterRuns = 0;
  const trap = base(); Object.defineProperty(trap, 'sourceText', { get() { getterRuns++; return 'from a getter'; }, enumerable: true });
  assert.equal(A.validate(trap).ok, false); refused(await A.prepare(trap, e.options()), 'INVALID');
  const trapAction = base(); Object.defineProperty(trapAction.action, 'text', { get() { getterRuns++; return 'from a getter'; }, enumerable: true });
  refused(await A.prepare(trapAction, e.options()), 'INVALID');
  assert.equal(getterRuns, 0);
  // Changes made by the caller while SHA-256 is still running do not reach the plan.
  let release, entered, first = true;
  const started = new Promise((resolve) => { entered = resolve; }), gate = new Promise((resolve) => { release = resolve; });
  const slow = { subtle: { async digest(...args) { if (first) { first = false; entered(); await gate; } return webcrypto.subtle.digest(...args); } } };
  const value = base(), running = A.prepare(value, { crypto: slow });
  await started; value.action.text = 'Changed meanwhile'; value.sourceText = 'Changed meanwhile'; value.job.revision.title = 'Changed meanwhile'; release();
  const r = await running;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.plan, (await prepared(e, base())).plan);
});
