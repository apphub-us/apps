'use strict';
/**
 * EC-04 (audit E09/A0–A1) — a restore must never commit photo data that the photo store then refuses to read.
 *
 * Everything here runs the REAL createRestoreStore().restore() and reads back through the REAL
 * createPhotoStore() on the project's IndexedDB simulator, with fixtures built by the app's own
 * constructors. The byte limit is scaled in this process only (jobPhoto.MAX_TOTAL_BYTES, exactly as the
 * audit did) and always put back; the control case runs with the untouched production limit. Outcomes are
 * observed in storage — rows, journal, saved results, later readability — not by asserting constants.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const AF = require('./helpers/archiveFixtures');
const { makeIndexedDb } = require('./helpers/jobIndexedDb');
const Source = require('../src/jobs/jobArchiveSource');
const Job = require('../src/jobs/jobCard');
const Photo = require('../src/jobs/jobPhoto');
const { createPhotoStore } = require('../src/jobs/jobPhotoStore');
const { createRestoreStore } = require('../src/jobs/jobRestoreStore');

const { F, id, J, TIME } = AF;
const RESTORE_DB = 'empire_code_restore_operations';
const N = F.png().length;   // one synthetic PNG (102 B in the audit); measured here, never assumed
const EJ = id('job1_', 100), EJR = id('jrev1_', 100), EP = id('photo1_', 100), EPR = id('prev1_', 100);
const schemaOf = (name) => Object.fromEntries(Object.entries(Source.SCHEMAS[name]).map(([store, [keyPath, indexes]]) => [store, { keyPath, indexes: Object.fromEntries(indexes.map(([i, k]) => [i, { keyPath: k }])) }]));

/** One unrelated pre-existing job with one valid original photo, plus empty simulators for every other database. */
function env(opts = {}) {
  const dbs = {}; for (const name of [...Object.keys(Source.SCHEMAS), RESTORE_DB]) dbs[name] = makeIndexedDb(name);
  const objects = {}; const writes = { sets: 0 };
  const indexedDB = { open(name, version) { if (!dbs[name]) throw Error('Unexpected database ' + name); return dbs[name].indexedDB.open(name, version); } };
  const localStorage = { getItem(k) { return Object.hasOwn(objects, k) ? objects[k] : null; }, setItem(k, v) { writes.sets++; objects[k] = v; }, removeItem(k) { delete objects[k]; } };
  const locks = { request: async (_name, _opts, fn) => fn({ name: 'test' }) };
  const jr = Job.createInitialRevision({ title: 'Existing synthetic job', address: '1 Synthetic Way', notes: 'Fixture.' }, [], { jobId: EJ, revisionId: EJR, savedAt: TIME }); assert.equal(jr.ok, true, JSON.stringify(jr));
  const head = { kind: Job.HEAD_KIND, recordVersion: 1, jobId: EJ, currentRevisionId: EJR, revisionNumber: 1 };
  const pr = Photo.createInitial(F.fields(), F.meta(), { photoId: EP, revisionId: EPR, jobId: EJ, jobRevisionId: EJR, savedAt: TIME }); assert.equal(pr.ok, true, JSON.stringify(pr));
  const valid = { kind: Photo.ASSET_KIND, recordVersion: 1, photoId: EP, jobId: EJ, file: F.meta(), blob: new Blob([F.png()], { type: 'image/png' }) };
  dbs.empire_code_jobs.control.seed({ schema: schemaOf('empire_code_jobs'), jobs: [head], jobRevisions: [jr.revision] });
  dbs.empire_code_photos.control.seed({ schema: schemaOf('empire_code_photos'), assets: [opts.asset ? opts.asset(valid) : valid], revisions: [pr.revision] });
  const readJob = async (jobId) => (jobId === EJ ? { ok: true, job: { head, revision: jr.revision } } : { ok: false });
  const photoStore = (start) => createPhotoStore(indexedDB, { crypto: F.crypto(start || 900), decode: F.decode, readJob, now: () => TIME });
  const list = async (jobId) => { const s = photoStore(); try { return await s.list(jobId); } finally { s.close(); } };
  const count = (name, store) => { try { return dbs[name].control.count(store); } catch (_) { return 0; } };   // a database that was never created holds nothing
  const fingerprint = async () => {
    const a = dbs.empire_code_photos.control.raw('assets', EP), r = dbs.empire_code_photos.control.raw('revisions', EPR);
    const h = dbs.empire_code_jobs.control.raw('jobs', EJ), v = dbs.empire_code_jobs.control.raw('jobRevisions', EJR);
    const blob = a && a.blob ? nodeCrypto.createHash('sha256').update(Buffer.from(await a.blob.arrayBuffer())).digest('hex') : null;
    return JSON.stringify({ a: a ? { ...a, blob: a.blob ? { size: a.blob.size, type: a.blob.type, sha256: blob } : null } : null, r, h, v });
  };
  const store = createRestoreStore(indexedDB, localStorage, { crypto: nodeCrypto.webcrypto, locks, ...(opts.step ? { step: opts.step } : {}) });
  return { dbs, objects, writes, indexedDB, store, photoStore, list, count, fingerprint };
}
const archive = () => ({ ok: true, ...AF.fixture() });
/** Scale the shared global byte limit for one scenario; the production value is always restored. */
async function withTotalByteLimit(limit, run) {
  const original = Photo.MAX_TOTAL_BYTES;
  try { if (limit !== null) Photo.MAX_TOTAL_BYTES = limit; return await run(); } finally { Photo.MAX_TOTAL_BYTES = original; assert.equal(Photo.MAX_TOTAL_BYTES, original); }
}
/** Nothing of the incoming archive exists anywhere: no job, no children, no saved result, no journal. */
async function assertNothingIncoming(e, extraPhotos = 0) {
  assert.equal(e.dbs.empire_code_jobs.control.raw('jobs', J), undefined, 'incoming job head must not exist');
  assert.equal(e.count('empire_code_jobs', 'jobs'), 1); assert.equal(e.count('empire_code_jobs', 'jobRevisions'), 1);
  assert.equal(e.count('empire_code_measurements', 'revisions'), 0); assert.equal(e.count('empire_code_materials', 'revisions'), 0);
  assert.equal(e.count('empire_code_photos', 'assets'), 1 + extraPhotos); assert.equal(e.count('empire_code_photos', 'revisions'), 1 + extraPhotos);
  assert.equal(e.dbs.empire_code_photos.control.raw('assets', id('photo1_', 1)), undefined, 'incoming original must not exist');
  assert.deepEqual(e.objects, {}, 'no saved result of the archive is left behind');
  assert.equal(e.count(RESTORE_DB, 'operations'), 0, 'no journal row');
  assert.deepEqual((await e.store.inspect()).pending, [], 'no pending restore');
}

test('fixture sanity: the existing photo and the archived photo are the same measured size', () => {
  const f = archive();
  assert.equal(f.manifest.originals.length, 1); assert.equal(f.manifest.originals[0].file.bytes, N); assert.ok(N > 0);
  assert.ok(2 * N < Photo.MAX_TOTAL_BYTES, 'the production limit is far above the fixture');
});

test('existing N + incoming N at a limit of 2N-1 (audit: 102 + 102 at 203 B): refused before any write; existing photos stay byte-identical and readable', async () => {
  await withTotalByteLimit(2 * N - 1, async () => {
    const e = env(); const before = await e.fingerprint();
    const first = await e.list(EJ); assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(first.photos.length, 1);
    const r = await e.store.restore(archive(), true);
    assert.equal(r.ok, false, 'the audit defect: restore returned ok and both later lists returned LIMIT'); assert.equal(r.code, 'LIMIT', JSON.stringify(r));
    assert.deepEqual(r.capacity, { label: 'total original-photo bytes', total: 2 * N, limit: 2 * N - 1 });
    assert.equal(e.writes.sets, 0, 'refused in the preflight: not a single saved-result write was attempted');
    await assertNothingIncoming(e);
    assert.equal(await e.fingerprint(), before, 'existing rows are byte-identical');
    const after = await e.list(EJ); assert.equal(after.ok, true, JSON.stringify(after)); assert.equal(after.photos.length, 1); assert.equal(after.bytes, N);
    const original = e.photoStore(); try { const o = await original.original(EJ, EP); assert.equal(o.ok, true, JSON.stringify(o)); assert.equal(o.blob.size, N); } finally { original.close(); }
    const incoming = await e.list(J); assert.equal(incoming.ok, true); assert.equal(incoming.photos.length, 0);
  });
});

test('the same data at a limit of exactly 2N (204 B) is accepted and both jobs stay readable', async () => {
  await withTotalByteLimit(2 * N, async () => {
    const e = env(); const before = await e.fingerprint();
    const r = await e.store.restore(archive(), true); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.jobId, J);
    const a = await e.list(EJ), b = await e.list(J);
    assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(b.ok, true, JSON.stringify(b)); assert.equal(a.photos.length, 1); assert.equal(b.photos.length, 1);
    assert.equal(await e.fingerprint(), before); assert.equal(e.count('empire_code_photos', 'assets'), 2); assert.deepEqual((await e.store.inspect()).pending, []);
  });
});

test('control with the unmodified production limit: restore succeeds and both jobs stay readable', async () => {
  await withTotalByteLimit(null, async () => {
    const e = env(); const r = await e.store.restore(archive(), true); assert.equal(r.ok, true, JSON.stringify(r));
    const a = await e.list(EJ), b = await e.list(J); assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(b.photos[0].current.photoId, id('photo1_', 1));
  });
});

for (const [label, limit, accepted] of [['3N-1: the upload consumed the room the preflight saw', 3 * N - 1, false], ['3N: the same upload still fits', 3 * N, true]]) {
  test('an ordinary photo upload committed between the preflight and the restore photo transaction — ' + label, async () => {
    await withTotalByteLimit(limit, async () => {
      let uploaded = null; let e = null;
      // `step` runs after each store commit; after materials is exactly the gap before the photo transaction. The
      // upload goes through the real PhotoStore.create, which does not take the restore lock.
      e = env({ step: async (name) => { if (name !== 'empire_code_materials') return; const s = e.photoStore(700); try { uploaded = await s.create(EJ, F.fields({ label: 'Concurrent upload' }), F.file('upload.png', 'tes2')); } finally { s.close(); } } });
      const before = await e.fingerprint();
      const r = await e.store.restore(archive(), true);
      assert.ok(uploaded && uploaded.ok === true, 'the concurrent upload itself succeeded: ' + JSON.stringify(uploaded));
      assert.equal(uploaded.revision.file.bytes, N);
      const existing = await e.list(EJ); assert.equal(existing.ok, true, JSON.stringify(existing)); assert.equal(existing.photos.length, 2, 'the pre-existing photo and the upload are both readable');
      assert.equal(await e.fingerprint(), before);
      if (accepted) {
        assert.equal(r.ok, true, JSON.stringify(r)); const restored = await e.list(J); assert.equal(restored.ok, true, JSON.stringify(restored)); assert.equal(restored.photos.length, 1);
        return;
      }
      assert.equal(r.ok, false, 'a preflight-only fix would have committed here and locked every photo list'); assert.equal(r.code, 'LIMIT', JSON.stringify(r));
      assert.ok(/rolled back/.test(r.problems[0]), r.problems[0]);
      assert.deepEqual(r.capacity, undefined, 'the refusal went through the compensating rollback path, not the preflight return');
      await assertNothingIncoming(e, 1);
      const o = e.photoStore(); try { const got = await o.original(EJ, uploaded.revision.photoId); assert.equal(got.ok, true, JSON.stringify(got)); } finally { o.close(); }
    });
  });
}

test('a write refused by the browser (QuotaExceededError) inside the photo transaction rolls back only the staged archive data', async () => {
  const e = env(); const before = await e.fingerprint();
  e.dbs.empire_code_photos.control.failRequest({ store: 'assets', operation: 'add', name: 'QuotaExceededError' });
  const r = await e.store.restore(archive(), true);
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.code, 'QUOTA', JSON.stringify(r)); assert.ok(/rolled back/.test(r.problems[0]), r.problems[0]);
  await assertNothingIncoming(e);
  assert.equal(await e.fingerprint(), before); const after = await e.list(EJ); assert.equal(after.ok, true, JSON.stringify(after)); assert.equal(after.photos.length, 1);
});

test('existing original-photo metadata that cannot be validated refuses the restore; nothing is written or repaired', async () => {
  const variants = {
    'bytes differ from the stored blob': (a) => ({ ...a, file: { ...a.file, bytes: a.file.bytes + 1 } }),
    'negative byte count': (a) => ({ ...a, file: { ...a.file, bytes: -1 } }),
    'non-integer byte count': (a) => ({ ...a, file: { ...a.file, bytes: 1.5 } }),
    'unsupported asset kind': (a) => ({ ...a, kind: 'something-else' }),
    'missing file metadata': (a) => { const c = { ...a }; delete c.file; return c; },
  };
  for (const [label, asset] of Object.entries(variants)) {
    const e = env({ asset }); const raw = JSON.stringify({ ...e.dbs.empire_code_photos.control.raw('assets', EP), blob: null });
    const r = await e.store.restore(archive(), true);
    assert.equal(r.ok, false, label); assert.equal(r.code, 'CORRUPT', label + ': ' + JSON.stringify(r));
    assert.equal(e.writes.sets, 0, label + ': refused before any write');
    await assertNothingIncoming(e);
    assert.equal(JSON.stringify({ ...e.dbs.empire_code_photos.control.raw('assets', EP), blob: null }), raw, label + ': the unreadable record was not altered');
  }
});

test('the per-job byte limit uses the same shared constant: an archive that would exceed it is refused (N at N-1) and fits at exactly N', async () => {
  const original = Photo.MAX_JOB_BYTES;
  try {
    Photo.MAX_JOB_BYTES = N - 1;   // the incoming job alone would hold N bytes
    const e = env(); const r = await e.store.restore(archive(), true);
    assert.equal(r.ok, false); assert.equal(r.code, 'LIMIT'); assert.equal(r.capacity.label, 'photo bytes in this job'); await assertNothingIncoming(e);
    Photo.MAX_JOB_BYTES = N;
    const ok = env(); assert.equal((await ok.store.restore(archive(), true)).ok, true);
  } finally { Photo.MAX_JOB_BYTES = original; }
});

/* ── Count limits: original photos (assets) and photo history rows ─────────────────────────────────────────
 * Same method as the byte cases: ONE shared limit (an export of jobPhoto.js, read at call time by the restore
 * ledger, by the photo store and by the archive validator) is scaled in this process for one scenario and always
 * put back. The fixture sizes are measured, not assumed: the existing job holds 1 original with 1 history row,
 * the archive brings SHAPE.photos originals with SHAPE.rows history rows.
 *
 * What is and is not exercised:
 *  - the two GLOBAL count lines of the ledger ('total original photos', 'total photo history rows'): refused at
 *    total-1 in the preflight, accepted at exactly total, and re-checked inside the photo write transaction when
 *    an ordinary upload lands after the preflight (compensating rollback);
 *  - the two PER-JOB count limits (MAX_PHOTOS, MAX_JOB_ROWS) as restore() actually applies them to an incoming
 *    archive: the archive validator uses the same shared constants and refuses first, with its own code. The
 *    ledger's own per-job count lines ('photos in this job', 'photo history rows in this job') are NOT reached
 *    here — the restored job must be absent, so its existing per-job counts are 0 — and are not claimed.
 */
const SHAPE = (() => { const m = AF.fixture().manifest; return { photos: m.originals.length, rows: m.photoRevisions.length }; })();
const EXISTING = { photos: 1, rows: 1 };   // what env() seeds; asserted in the sanity test below
/** Scale one shared photo limit for one scenario; the production value is always restored. */
async function withLimit(name, value, run) {
  const original = Photo[name];
  assert.ok(Number.isSafeInteger(original) && original > 0, name + ' is a shared numeric limit');
  try { Photo[name] = value; return await run(); } finally { Photo[name] = original; assert.equal(Photo[name], original); }
}
const GLOBAL_COUNTS = [
  // [shared limit, ledger label, existing, incoming]
  ['MAX_TOTAL_PHOTOS', 'total original photos', EXISTING.photos, SHAPE.photos],
  ['MAX_TOTAL_ROWS', 'total photo history rows', EXISTING.rows, SHAPE.rows],
];

test('fixture sanity for the count cases: 1 existing original with 1 history row; the archive brings at least 1 original and 1 history row, far below the production limits', () => {
  const e = env();
  assert.equal(e.count('empire_code_photos', 'assets'), EXISTING.photos); assert.equal(e.count('empire_code_photos', 'revisions'), EXISTING.rows);
  assert.ok(SHAPE.photos >= 1 && SHAPE.rows >= SHAPE.photos, JSON.stringify(SHAPE));
  assert.ok(EXISTING.photos + SHAPE.photos + 1 < Photo.MAX_TOTAL_PHOTOS && EXISTING.rows + SHAPE.rows + 1 < Photo.MAX_TOTAL_ROWS && SHAPE.photos < Photo.MAX_PHOTOS && SHAPE.rows < Photo.MAX_JOB_ROWS);
});

for (const [name, label, existing, incoming] of GLOBAL_COUNTS) {
  const total = existing + incoming;
  test(label + ': existing ' + existing + ' + incoming ' + incoming + ' at a limit of ' + (total - 1) + ' (' + name + ') is refused before any write; the existing photo stays byte-identical and readable', async () => {
    await withLimit(name, total - 1, async () => {
      const e = env(); const before = await e.fingerprint();
      const first = await e.list(EJ); assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(first.photos.length, 1);
      const r = await e.store.restore(archive(), true);
      assert.equal(r.ok, false, 'a restore that only counted bytes would have committed and locked every later photo list'); assert.equal(r.code, 'LIMIT', JSON.stringify(r));
      assert.deepEqual(r.capacity, { label, total, limit: total - 1 });
      assert.equal(e.writes.sets, 0, 'refused in the preflight: not a single saved-result write was attempted');
      await assertNothingIncoming(e);
      assert.equal(await e.fingerprint(), before, 'existing rows are byte-identical');
      const after = await e.list(EJ); assert.equal(after.ok, true, JSON.stringify(after)); assert.equal(after.photos.length, 1); assert.equal(after.bytes, N);
      const original = e.photoStore(); try { const o = await original.original(EJ, EP); assert.equal(o.ok, true, JSON.stringify(o)); assert.equal(o.blob.size, N); } finally { original.close(); }
      const none = await e.list(J); assert.equal(none.ok, true, JSON.stringify(none)); assert.equal(none.photos.length, 0);
    });
  });

  test(label + ': the same data at a limit of exactly ' + total + ' (' + name + ') is accepted and both jobs stay readable', async () => {
    await withLimit(name, total, async () => {
      const e = env(); const before = await e.fingerprint();
      const r = await e.store.restore(archive(), true); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.jobId, J);
      const a = await e.list(EJ), b = await e.list(J);
      assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(b.ok, true, JSON.stringify(b)); assert.equal(a.photos.length, 1); assert.equal(b.photos.length, SHAPE.photos);
      assert.equal(await e.fingerprint(), before);
      assert.equal(e.count('empire_code_photos', 'assets'), EXISTING.photos + SHAPE.photos); assert.equal(e.count('empire_code_photos', 'revisions'), EXISTING.rows + SHAPE.rows);
      assert.deepEqual((await e.store.inspect()).pending, []);
    });
  });

  // The upload adds exactly one original and one history row, so the preflight total fits at `total` and the
  // transaction total is total + 1.
  for (const [limit, accepted] of [[total, false], [total + 1, true]]) {
    test('an ordinary photo upload committed between the preflight and the restore photo transaction — ' + label + ' at ' + limit + (accepted ? ': the same upload still fits' : ': the upload consumed the room the preflight saw'), async () => {
      await withLimit(name, limit, async () => {
        let uploaded = null; let e = null;
        e = env({ step: async (store) => { if (store !== 'empire_code_materials') return; const s = e.photoStore(700); try { uploaded = await s.create(EJ, F.fields({ label: 'Concurrent upload' }), F.file('upload.png', 'tes2')); } finally { s.close(); } } });
        const before = await e.fingerprint();
        const r = await e.store.restore(archive(), true);
        assert.ok(uploaded && uploaded.ok === true, 'the concurrent upload itself succeeded: ' + JSON.stringify(uploaded));
        const existingNow = await e.list(EJ); assert.equal(existingNow.ok, true, JSON.stringify(existingNow)); assert.equal(existingNow.photos.length, 2, 'the pre-existing photo and the upload are both readable');
        assert.equal(await e.fingerprint(), before);
        if (accepted) {
          assert.equal(r.ok, true, JSON.stringify(r)); const restored = await e.list(J); assert.equal(restored.ok, true, JSON.stringify(restored)); assert.equal(restored.photos.length, SHAPE.photos);
          assert.equal(e.count('empire_code_photos', 'assets'), EXISTING.photos + 1 + SHAPE.photos); assert.equal(e.count('empire_code_photos', 'revisions'), EXISTING.rows + 1 + SHAPE.rows);
          return;
        }
        assert.equal(r.ok, false, 'a preflight-only count check would have committed here and locked every photo list'); assert.equal(r.code, 'LIMIT', JSON.stringify(r));
        assert.ok(/rolled back/.test(r.problems[0]), r.problems[0]); assert.ok(r.problems[0].includes(label + ': ' + (total + 1) + ' of ' + limit), r.problems[0]);
        assert.deepEqual(r.capacity, undefined, 'the refusal went through the compensating rollback path, not the preflight return');
        await assertNothingIncoming(e, 1);
        const o = e.photoStore(); try { const got = await o.original(EJ, uploaded.revision.photoId); assert.equal(got.ok, true, JSON.stringify(got)); } finally { o.close(); }
        const old = e.photoStore(); try { const got = await old.original(EJ, EP); assert.equal(got.ok, true, JSON.stringify(got)); assert.equal(got.blob.size, N); } finally { old.close(); }
      });
    });
  }
}

for (const [name, what, incoming] of [['MAX_PHOTOS', 'originals', SHAPE.photos], ['MAX_JOB_ROWS', 'photo history rows', SHAPE.rows]]) {
  test('per-job ' + what + ' (' + name + '): an archive that brings ' + incoming + ' at a limit of ' + (incoming - 1) + ' is refused by archive validation before the capacity ledger and before any write; at exactly ' + incoming + ' it restores and both jobs stay readable', async () => {
    const e = env(); const before = await e.fingerprint();
    await withLimit(name, incoming - 1, async () => {
      const r = await e.store.restore(archive(), true);
      assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.code, 'CORRUPT', 'refused by the archive validator, which reads the same shared constant: ' + JSON.stringify(r));
      assert.equal(r.capacity, undefined, 'not a ledger refusal — the ledger was never reached');
      assert.equal(e.writes.sets, 0, 'refused before any write');
      await assertNothingIncoming(e);
      assert.equal(await e.fingerprint(), before, 'existing rows are byte-identical');
    });
    // With the production limit back, the pre-existing photo is exactly as readable as before the refused restore.
    const after = await e.list(EJ); assert.equal(after.ok, true, JSON.stringify(after)); assert.equal(after.photos.length, 1); assert.equal(after.bytes, N);
    const original = e.photoStore(); try { const o = await original.original(EJ, EP); assert.equal(o.ok, true, JSON.stringify(o)); assert.equal(o.blob.size, N); } finally { original.close(); }
    await withLimit(name, incoming, async () => {
      const fits = env(); const r = await fits.store.restore(archive(), true); assert.equal(r.ok, true, JSON.stringify(r));
      const a = await fits.list(EJ), b = await fits.list(J);
      assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(b.ok, true, JSON.stringify(b)); assert.equal(a.photos.length, 1); assert.equal(b.photos.length, SHAPE.photos);
      assert.deepEqual((await fits.store.inspect()).pending, []);
    });
  });
}

/* ── Photo-less archives (review P2) ───────────────────────────────────────────────────────────────────────
 * An archive with no original and no photo history row adds nothing to the photo database, so the capacity
 * ledger must not run for it — neither in the preflight nor inside the photo write transaction. Otherwise an
 * unrelated unreadable original, or a collection that is already over a shared limit, blocks the restore of a
 * job that has no photos at all.
 *
 * Each case below is PAIRED on the same seeded photo database: the fixture archive WITH its photo is still
 * refused (the guard is unchanged whenever photo data is incoming), the photo-less archive restores. "Restored"
 * is read from storage (job head, every job/measurement/material row, the saved result, an empty journal);
 * "did not touch photo storage" is read from the simulator's request log of the photo database, from its row
 * keys and from the byte-level fingerprint of the resident photo.
 */
const PHOTO_WRITE = /\.(add|put|delete|clear)$/;
/** The repository's archive fixture without its photo: no history row, no original, no attached blob. */
function photolessArchive() {
  const f = AF.fixture(); f.manifest.photoRevisions = []; f.manifest.originals = [];
  return { ok: true, manifest: f.manifest, assets: [] };
}
/** Every IndexedDB request run against the photo database since its last resetStats(), as 'store.operation'. */
const photoRequests = (e) => e.dbs.empire_code_photos.control.stats.events.filter((ev) => ev.type === 'request').map((ev) => ev.store + '.' + ev.operation);
/** The photo-less archive is completely stored, exactly as archived, and the photo database holds only the resident rows. */
async function assertPhotolessRestored(e, f, r, label) {
  const m = f.manifest;
  assert.equal(r.ok, true, label + ': ' + JSON.stringify(r)); assert.equal(r.jobId, J, label);
  assert.equal(r.summary.photos, 0, label); assert.equal(r.summary.photoVersions, 0, label); assert.equal(r.journalCleanupPending, false, label);
  const jobs = e.dbs.empire_code_jobs.control;
  assert.deepEqual(jobs.raw('jobs', J), m.job.head, label + ': the restored job head is stored');
  assert.equal(e.count('empire_code_jobs', 'jobs'), 2, label); assert.equal(e.count('empire_code_jobs', 'jobRevisions'), 1 + m.job.revisions.length, label);
  for (const revision of m.job.revisions) assert.deepEqual(jobs.raw('jobRevisions', revision.revisionId), revision, label + ': job revision ' + revision.revisionNumber);
  for (const [name, rows] of [['empire_code_measurements', m.measurements], ['empire_code_materials', m.materials]]) {
    assert.ok(rows.length > 0, name); assert.equal(e.count(name, 'revisions'), rows.length, label + ': ' + name);
    for (const row of rows) assert.deepEqual(e.dbs[name].control.raw('revisions', row.revisionId), row, label + ': ' + name + ' ' + row.revisionId);
  }
  assert.deepEqual(e.objects, { [Source.PREFIX + AF.R]: m.results[0].raw }, label + ': the linked saved result is stored');
  assert.equal(e.count(RESTORE_DB, 'operations'), 0, label + ': no journal row'); assert.deepEqual((await e.store.inspect()).pending, [], label + ': no pending restore');
  const photos = e.dbs.empire_code_photos.control.snapshot();
  assert.deepEqual(photos.assets.map(([key]) => key), [EP], label + ': only the resident original exists'); assert.deepEqual(photos.revisions.map(([key]) => key), [EPR], label + ': only the resident photo history row exists');
}

test('photo-less control: next to a valid, unrelated photo collection the archive restores exactly and no photo row is written', async () => {
  const f = photolessArchive();
  assert.equal(f.manifest.photoRevisions.length, 0); assert.equal(f.manifest.originals.length, 0); assert.equal(f.assets.length, 0);
  assert.ok(f.manifest.measurements.length > 0 && f.manifest.materials.length > 0 && f.manifest.results.length === 1, 'still a complete job archive');
  const e = env(); const before = await e.fingerprint();
  e.dbs.empire_code_photos.control.resetStats();
  const r = await e.store.restore(f, true); const requests = photoRequests(e);
  await assertPhotolessRestored(e, f, r, 'control');
  assert.deepEqual(requests.filter((x) => PHOTO_WRITE.test(x)), [], 'no write request reached the photo database');
  assert.equal(await e.fingerprint(), before, 'resident rows are byte-identical');
  const a = await e.list(EJ), b = await e.list(J);
  assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.photos.length, 1); assert.equal(a.bytes, N);
  assert.equal(b.ok, true, JSON.stringify(b)); assert.equal(b.photos.length, 0);
});

const UNREADABLE_ORIGINALS = {
  'bytes differ from the stored blob': (a) => ({ ...a, file: { ...a.file, bytes: a.file.bytes + 1 } }),
  'negative byte count': (a) => ({ ...a, file: { ...a.file, bytes: -1 } }),
  'non-integer byte count': (a) => ({ ...a, file: { ...a.file, bytes: 1.5 } }),
  'unsupported asset kind': (a) => ({ ...a, kind: 'something-else' }),
  'missing file metadata': (a) => { const c = { ...a }; delete c.file; return c; },
};
for (const [label, asset] of Object.entries(UNREADABLE_ORIGINALS)) {
  test('photo-less archive next to an unrelated unreadable original (' + label + '): restored without reading or writing photo storage; the same database still refuses the archive with a photo', async () => {
    const withPhoto = env({ asset });
    const refused = await withPhoto.store.restore(archive(), true);
    assert.equal(refused.ok, false, 'photo data incoming: the ledger must still refuse'); assert.equal(refused.code, 'CORRUPT', JSON.stringify(refused));
    assert.equal(withPhoto.writes.sets, 0, 'refused before any write'); await assertNothingIncoming(withPhoto);

    const e = env({ asset }); const before = await e.fingerprint();
    const unreadable = await e.list(EJ); assert.equal(unreadable.ok, false, 'precondition: the photo store itself cannot read this collection'); assert.equal(unreadable.code, 'CORRUPT', JSON.stringify(unreadable));
    const f = photolessArchive();
    e.dbs.empire_code_photos.control.resetStats();
    const r = await e.store.restore(f, true); const requests = photoRequests(e);
    await assertPhotolessRestored(e, f, r, label);
    assert.deepEqual(requests, [], 'the photo database was neither scanned nor written');
    assert.equal(await e.fingerprint(), before, 'the unreadable record was not altered or repaired');
    assert.deepEqual(await e.list(EJ), unreadable, 'the photo collection is in exactly the state it was in before the restore');
  });
}

for (const [name, label, existing, incoming] of [
  // [shared limit, ledger label, what env() already stores, what the archive WITH its photo would add]
  ['MAX_TOTAL_BYTES', 'total original-photo bytes', N, N],
  ['MAX_TOTAL_PHOTOS', 'total original photos', EXISTING.photos, SHAPE.photos],
  ['MAX_TOTAL_ROWS', 'total photo history rows', EXISTING.rows, SHAPE.rows],
]) {
  const limit = existing - 1;   // the existing collection alone is already above the shared limit
  test('photo-less archive next to a collection already over ' + name + ' (' + existing + ' stored at a limit of ' + limit + '): restored without reading or writing photo storage; the same database still refuses the archive with a photo', async () => {
    await withLimit(name, limit, async () => {
      const withPhoto = env(); const untouched = await withPhoto.fingerprint();
      const refused = await withPhoto.store.restore(archive(), true);
      assert.equal(refused.ok, false, 'photo data incoming: the ledger must still refuse'); assert.equal(refused.code, 'LIMIT', JSON.stringify(refused));
      assert.deepEqual(refused.capacity, { label, total: existing + incoming, limit });
      assert.equal(withPhoto.writes.sets, 0, 'refused before any write'); await assertNothingIncoming(withPhoto);
      assert.equal(await withPhoto.fingerprint(), untouched);

      const e = env(); const before = await e.fingerprint();
      const over = await e.list(EJ); assert.equal(over.ok, false, 'precondition: the photo store itself reports this collection as over capacity'); assert.equal(over.code, 'LIMIT', JSON.stringify(over));
      const f = photolessArchive();
      e.dbs.empire_code_photos.control.resetStats();
      const r = await e.store.restore(f, true); const requests = photoRequests(e);
      await assertPhotolessRestored(e, f, r, name);
      assert.deepEqual(requests, [], 'the photo database was neither scanned nor written');
      assert.equal(await e.fingerprint(), before, 'resident rows are byte-identical');
      assert.deepEqual(await e.list(EJ), over, 'the photo collection is in exactly the state it was in before the restore');
    });
  });
}

test('write site in isolation — an unrelated original becomes unreadable AFTER the preflight: the photo-less archive still restores; the archive with a photo is refused inside the photo transaction and rolled back', async () => {
  // `step` runs after each store commit; after materials is exactly the gap between the preflight and the photo
  // transaction. The preflight therefore sees a valid collection in both halves, and only the write site decides.
  const damage = (e) => { const c = e.dbs.empire_code_photos.control, a = c.raw('assets', EP); c.set('assets', EP, { ...a, file: { ...a.file, bytes: a.file.bytes + 1 } }); };

  let withPhoto = null; let damagedWithPhoto = false;
  withPhoto = env({ step: async (name) => { if (name !== 'empire_code_materials') return; damage(withPhoto); damagedWithPhoto = true; } });
  const refused = await withPhoto.store.restore(archive(), true);
  assert.equal(damagedWithPhoto, true, 'the preflight passed and the damage landed before the photo transaction');
  assert.equal(refused.ok, false, 'photo data incoming: the ledger inside the write transaction must still refuse'); assert.equal(refused.code, 'CORRUPT', JSON.stringify(refused));
  assert.ok(/rolled back/.test(refused.problems[0]), refused.problems[0]);
  await assertNothingIncoming(withPhoto);
  assert.equal(withPhoto.dbs.empire_code_photos.control.raw('assets', EP).file.bytes, N + 1, 'the unreadable record was not altered or repaired');

  let e = null; let damaged = null;
  e = env({ step: async (name) => { if (name !== 'empire_code_materials') return; damage(e); damaged = await e.fingerprint(); } });
  const f = photolessArchive();
  e.dbs.empire_code_photos.control.resetStats();
  const r = await e.store.restore(f, true); const requests = photoRequests(e);
  assert.ok(damaged, 'the damage landed between the preflight and the photo transaction');
  await assertPhotolessRestored(e, f, r, 'write site');
  assert.deepEqual(requests, [], 'the photo database was neither scanned nor written');
  assert.equal(await e.fingerprint(), damaged, 'the unreadable record was not altered or repaired');
  assert.equal(e.dbs.empire_code_photos.control.raw('assets', EP).file.bytes, N + 1);
});
