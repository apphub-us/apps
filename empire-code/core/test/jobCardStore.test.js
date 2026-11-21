'use strict';
/**
 * LC-JOB-CARD-1 public persistence contract, independent of model constructors.
 * All IndexedDB evidence in this file is SIMULATED. Native browser behavior is
 * a separate gate: tools/check-job-card-browser.js. Authors do not run tests.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createJobStore } = require('../src/jobs/jobCardStore');
const { makeIndexedDb, deterministicCrypto } = require('./helpers/jobIndexedDb');
const clone = (value) => structuredClone(value);
const id = (prefix, number) => prefix + number.toString(16).padStart(32, '0');
const jobId = (number) => id('job1_', number);
const revisionId = (number) => id('jrev1_', number);
const resultId = (number) => id('sr1_', number);
const timestamp = (number) => new Date(Date.UTC(2026, 9, 6, 2, 0, 0) + number * 1000).toISOString();
const fields = (patch) => Object.assign({ title: '  Robota Żółć 🏠  ', address: '12 Main Street\nApt 2', notes: 'First visit.\nRetain original wording.' }, patch || {});
const link = (number) => ({ serviceResultId: resultId(number), savedName: 'B0 / review required ' + number, savedAt: timestamp(0) });
function fixture(jobNumber, count) {
  const revisions = [];
  for (let i = 1; i <= (count || 1); i++) revisions.push({
    kind: 'empire-code.job-revision', recordVersion: 1, jobId: jobId(jobNumber), revisionId: revisionId(jobNumber * 10000 + i),
    parentRevisionId: i === 1 ? null : revisionId(jobNumber * 10000 + i - 1), revisionNumber: i,
    createdAt: timestamp(1), savedAt: timestamp(i), producer: { applicationRevision: 'LC-JOB-CARD-1', recordContractRevision: 1 },
    title: 'Job ' + jobNumber + ' revision ' + i, address: 'Original address', notes: 'Original note ' + i, serviceResultLinks: [],
  });
  const current = revisions[revisions.length - 1];
  return { head: { kind: 'empire-code.job-head', recordVersion: 1, jobId: current.jobId, currentRevisionId: current.revisionId, revisionNumber: current.revisionNumber }, revisions };
}
function seedRows(cases) { return { jobs: cases.map((c) => c.head), jobRevisions: cases.flatMap((c) => c.revisions) }; }
function setup(options) {
  const env = makeIndexedDb(); const opts = options || {};
  if (opts.seed) env.control.seed(opts.seed);
  const store = createJobStore(env.indexedDB, { crypto: Object.hasOwn(opts, 'crypto') ? opts.crypto : deterministicCrypto(opts.start || 1), now: opts.now || (() => timestamp(9)) });
  return Object.assign({ store }, env);
}
function good(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.job; }
function rejected(result, code) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (Array.isArray(code)) assert.ok(code.includes(result.code), JSON.stringify(result));
  else assert.equal(result.code, code, JSON.stringify(result));
  assert.ok(Array.isArray(result.problems) && result.problems.length > 0 && result.problems.every((p) => typeof p === 'string'));
  assert.equal(Object.hasOwn(result, 'job'), false); assert.equal(Object.hasOwn(result, 'revision'), false);
}
function editor(revision) { return { title: revision.title, address: revision.address, notes: revision.notes }; }
function fixedCrypto(number) {
  let calls = 0;
  return { get calls() { return calls; }, getRandomValues(array) {
    calls++; const value = deterministicCrypto(number); return value.getRandomValues(array);
  } };
}

describe('Independent simulator mechanics, not native evidence', () => {
  test('native-style index counting omits missing keys and nextunique visits one key per job', async () => {
    const env = makeIndexedDb(); const a = fixture(91, 3); const b = fixture(92, 2);
    const seed = seedRows([a, b]); seed.jobRevisions.push({ revisionId: revisionId(93001), title: 'No indexable jobId' }); env.control.seed(seed);
    const db = await new Promise((resolve, reject) => { const request = env.indexedDB.open('empire_code_jobs', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['jobs', 'jobRevisions'], 'readonly'); let total; let indexed; const keys = [];
    const completed = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    const revisions = tx.objectStore('jobRevisions'); const countAll = revisions.count(); countAll.onsuccess = () => { total = countAll.result; };
    const countIndexed = revisions.index('byJobId').count(); countIndexed.onsuccess = () => { indexed = countIndexed.result; };
    const scan = revisions.index('byJobId').openCursor(undefined, 'nextunique');
    scan.onsuccess = () => { if (scan.result) { keys.push(scan.result.key); scan.result.continue(); } };
    await completed; assert.equal(total, 6); assert.equal(indexed, 5); assert.deepEqual(keys, [a.head.jobId, b.head.jobId]); db.close();
  });

  test('raw requests clone at enqueue and staged head/revision values roll back together', async () => {
    const env = makeIndexedDb(); env.control.seed({ jobs: [], jobRevisions: [] });
    const db = await new Promise((resolve, reject) => { const request = env.indexedDB.open('empire_code_jobs', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const held = env.control.holdNextCommit('readwrite'); const raw = fixture(91); const before = clone(raw.revisions[0]);
    const tx = db.transaction(['jobs', 'jobRevisions'], 'readwrite');
    const finished = new Promise((resolve) => { tx.oncomplete = () => resolve('complete'); tx.onabort = () => resolve('abort'); });
    tx.objectStore('jobRevisions').add(raw.revisions[0]); tx.objectStore('jobs').add(raw.head);
    raw.revisions[0].title = 'Mutation after enqueue';
    let read;
    const request = tx.objectStore('jobRevisions').get(before.revisionId); request.onsuccess = () => { read = request.result; };
    await held.reached; assert.deepEqual(read, before); read.notes = 'Mutation of request result';
    assert.equal(env.control.count('jobs'), 0); assert.equal(env.control.count('jobRevisions'), 0);
    held.abort(); assert.equal(await finished, 'abort');
    assert.equal(env.control.count('jobs'), 0); assert.equal(env.control.count('jobRevisions'), 0); db.close();
  });
});

describe('Public create, immutable revisions and restart (simulated IndexedDB)', () => {
  test('empty list permits a card without a calculation; full strings survive close/reopen', async () => {
    const env = setup(); const empty = await env.store.list();
    assert.deepEqual(empty, { ok: true, jobs: [], problems: [] });
    const input = fields(); const before = clone(input); const created = good(await env.store.create(input, []));
    assert.equal(created.revision.title, input.title); assert.equal(created.revision.address, input.address); assert.equal(created.revision.notes, input.notes);
    assert.equal(created.revision.revisionNumber, 1); assert.equal(created.revision.parentRevisionId, null);
    assert.equal(created.head.jobId, created.revision.jobId); assert.equal(created.head.currentRevisionId, created.revision.revisionId);
    assert.equal(created.revision.createdAt, timestamp(9)); assert.equal(created.revision.savedAt, timestamp(9));
    assert.deepEqual(created.revision.serviceResultLinks, []); assert.deepEqual(input, before);
    assert.equal(env.control.count('jobs'), 1); assert.equal(env.control.count('jobRevisions'), 1);
    env.store.close();
    const reopened = createJobStore(env.indexedDB, { crypto: deterministicCrypto(20), now: () => timestamp(10) });
    assert.deepEqual(good(await reopened.read(created.head.jobId)), created);
    const listing = await reopened.list(); assert.equal(listing.ok, true); assert.deepEqual(listing.jobs, [created]); assert.deepEqual(listing.problems, []);
    reopened.close();
  });

  test('edits append one revision and immutable prior snapshots remain exact', async () => {
    const env = setup(); const original = good(await env.store.create(fields(), [link(3)]));
    const originalBytes = clone(env.control.raw('jobRevisions', original.revision.revisionId));
    const changed = fields({ notes: 'Second visit\nMeasured manually; no calculator interpretation.' });
    const next = good(await env.store.save(original.head.jobId, original.head.currentRevisionId, changed, [link(4)]));
    assert.equal(next.revision.revisionNumber, 2); assert.equal(next.revision.parentRevisionId, original.revision.revisionId);
    assert.equal(next.revision.jobId, original.revision.jobId); assert.equal(next.revision.createdAt, original.revision.createdAt);
    assert.equal(next.revision.notes, changed.notes); assert.equal(next.revision.serviceResultLinks.length, 2);
    assert.deepEqual(next.revision.serviceResultLinks[0], original.revision.serviceResultLinks[0]);
    assert.deepEqual(next.revision.serviceResultLinks[1], Object.assign({ linkedAt: timestamp(9) }, link(4)));
    assert.deepEqual(env.control.raw('jobRevisions', original.revision.revisionId), originalBytes);
    const history = await env.store.history(original.head.jobId); assert.equal(history.ok, true);
    assert.deepEqual(history.revisions, [next.revision, original.revision]);
    assert.deepEqual(await env.store.readHistorical(original.head.jobId, original.revision.revisionId), { ok: true, revision: original.revision });
    const writes = env.control.stats.events.filter((e) => e.type === 'request' && ['add', 'put', 'delete', 'clear'].includes(e.operation));
    assert.equal(writes.filter((e) => e.store === 'jobRevisions' && e.operation === 'put').length, 0, 'history must use add, never put');
    assert.equal(writes.filter((e) => ['delete', 'clear'].includes(e.operation)).length, 0);
    assert.ok(writes.some((e) => e.store === 'jobs' && e.operation === 'put'));
    env.store.close();
  });

  test('returned heads/revisions/links are independent copies, including list and history', async () => {
    const env = setup(); const initial = good(await env.store.create(fields(), [link(1)])); const original = clone(initial);
    initial.revision.title = 'Modified return'; initial.head.revisionNumber = 900;
    initial.revision.serviceResultLinks[0].savedName = 'Modified return';
    assert.deepEqual(good(await env.store.read(original.head.jobId)), original);
    const listing = await env.store.list(); listing.jobs[0].revision.notes = 'List mutation';
    const history = await env.store.history(original.head.jobId); history.revisions[0].address = 'History mutation';
    const historical = await env.store.readHistorical(original.head.jobId, original.revision.revisionId); historical.revision.serviceResultLinks.length = 0;
    assert.deepEqual(good(await env.store.read(original.head.jobId)), original); env.store.close();
  });

  test('unchanged fields and already linked result are a no-op preserving original link metadata', async () => {
    const env = setup(); const original = good(await env.store.create(fields(), [link(7)])); const before = env.control.snapshot();
    const duplicate = Object.assign({}, link(7), { savedName: 'Later label must not replace history', savedAt: timestamp(6) });
    env.control.resetStats();
    const result = await env.store.save(original.head.jobId, original.head.currentRevisionId, fields(), [duplicate]);
    assert.equal(result.ok, true); assert.equal(result.unchanged, true); assert.deepEqual(result.job, original);
    assert.deepEqual(env.control.snapshot(), before);
    assert.equal(env.control.stats.events.filter((e) => e.type === 'request' && ['add', 'put'].includes(e.operation)).length, 0);
    env.store.close();
  });

  test('clock reversal does not reorder revisions or rewrite createdAt', async () => {
    let time = timestamp(20); const env = setup({ now: () => time });
    const original = good(await env.store.create(fields(), [])); time = timestamp(1);
    const next = good(await env.store.save(original.head.jobId, original.head.currentRevisionId, fields({ notes: 'Clock moved backward' }), []));
    assert.equal(next.revision.createdAt, timestamp(20)); assert.equal(next.revision.savedAt, timestamp(1));
    const history = await env.store.history(original.head.jobId); assert.equal(history.ok, true);
    assert.deepEqual(history.revisions.map((r) => r.revisionNumber), [2, 1]); env.store.close();
  });
});

describe('Transaction boundary and two-client conflicts (simulation only)', () => {
  test('simultaneous first opens share one database and preserve both independent creations', async () => {
    const env = setup();
    const other = createJobStore(env.indexedDB, { crypto: deterministicCrypto(100), now: () => timestamp(10) });
    const results = await Promise.all([env.store.create(fields({ title: 'First client' }), []), other.create(fields({ title: 'Second client' }), [])]);
    results.forEach(good); assert.notEqual(results[0].job.head.jobId, results[1].job.head.jobId);
    assert.equal(env.control.count('jobs'), 2); assert.equal(env.control.count('jobRevisions'), 2);
    assert.deepEqual(good(await env.store.read(results[1].job.head.jobId)), results[1].job);
    other.close(); env.store.close();
  });

  test('request successes are not public success; a late abort rolls back head and revision', async () => {
    const env = setup(); const held = env.control.holdNextCommit('readwrite'); let settled = false;
    const pending = env.store.create(fields(), []).then((result) => { settled = true; return result; });
    await held.reached; await Promise.resolve();
    assert.equal(settled, false, 'must await transaction complete');
    assert.equal(env.control.count('jobs'), 0); assert.equal(env.control.count('jobRevisions'), 0);
    assert.ok(env.control.stats.events.some((e) => e.type === 'request-success' && e.operation === 'add'));
    held.abort(); rejected(await pending, 'ABORTED');
    assert.equal(env.control.count('jobs'), 0); assert.equal(env.control.count('jobRevisions'), 0); env.store.close();
  });

  test('successful create becomes visible atomically only after complete', async () => {
    const env = setup(); const held = env.control.holdNextCommit('readwrite');
    const pending = env.store.create(fields(), []); await held.reached;
    assert.equal(env.control.count('jobs'), 0); assert.equal(env.control.count('jobRevisions'), 0);
    held.release(); const created = good(await pending);
    assert.deepEqual(env.control.raw('jobs', created.head.jobId), created.head);
    assert.deepEqual(env.control.raw('jobRevisions', created.revision.revisionId), created.revision);
    env.store.close();
  });

  test('quota after successful add requests cannot leave a head or orphan revision', async () => {
    const env = setup(); env.control.abortNextCommit('QuotaExceededError');
    rejected(await env.store.create(fields(), []), 'QUOTA');
    assert.equal(env.control.count('jobs'), 0); assert.equal(env.control.count('jobRevisions'), 0);
    good(await env.store.create(fields(), [])); assert.equal(env.control.count('jobs'), 1); env.store.close();
  });

  test('head write failure after revision add rolls back all changes and preserves original history', async () => {
    const env = setup(); const original = good(await env.store.create(fields(), [])); const before = env.control.snapshot();
    env.control.failRequest({ store: 'jobs', operation: 'put', name: 'QuotaExceededError' });
    rejected(await env.store.save(original.head.jobId, original.head.currentRevisionId, fields({ notes: 'Must not commit' }), [link(8)]), 'QUOTA');
    assert.deepEqual(env.control.snapshot(), before); assert.deepEqual(good(await env.store.read(original.head.jobId)), original);
    env.store.close();
  });

  test('readonly methods also wait for coherent transaction complete and contain abort', async () => {
    const env = setup(); const original = good(await env.store.create(fields(), []));
    for (const operation of [() => env.store.read(original.head.jobId), () => env.store.list(), () => env.store.history(original.head.jobId), () => env.store.readHistorical(original.head.jobId, original.revision.revisionId)]) {
      const before = env.control.snapshot(); const held = env.control.holdNextCommit('readonly'); let settled = false;
      const pending = operation().then((result) => { settled = true; return result; });
      await held.reached; await Promise.resolve(); assert.equal(settled, false);
      held.abort(); rejected(await pending, 'ABORTED'); assert.deepEqual(env.control.snapshot(), before);
    }
    env.store.close();
  });

  test('two clients with one expected revision produce one winner, one conflict and no overwritten history', async () => {
    const env = setup(); const original = good(await env.store.create(fields(), []));
    const other = createJobStore(env.indexedDB, { crypto: deterministicCrypto(100), now: () => timestamp(10) });
    good(await other.read(original.head.jobId));
    const held = env.control.holdNextCommit('readwrite');
    const first = env.store.save(original.head.jobId, original.head.currentRevisionId, fields({ notes: 'Client A' }), []);
    await held.reached;
    const second = other.save(original.head.jobId, original.head.currentRevisionId, fields({ notes: 'Client B' }), []);
    await env.control.flush(); held.release();
    const results = await Promise.all([first, second]);
    assert.equal(results.filter((r) => r.ok).length, 1); const winner = results.find((r) => r.ok).job;
    const conflict = results.find((r) => !r.ok); rejected(conflict, 'CONFLICT'); assert.equal(conflict.currentRevisionId, winner.revision.revisionId);
    const history = await env.store.history(original.head.jobId); assert.equal(history.ok, true); assert.equal(history.revisions.length, 2);
    assert.equal(history.revisions[0].notes, 'Client A'); assert.deepEqual(history.revisions[1], original.revision);
    assert.equal(env.control.count('jobRevisions'), 2); other.close(); env.store.close();
  });

  test('stale unchanged save conflicts before the no-op decision', async () => {
    const env = setup(); const original = good(await env.store.create(fields(), []));
    const next = good(await env.store.save(original.head.jobId, original.head.currentRevisionId, fields({ notes: 'New current data' }), []));
    const before = env.control.snapshot();
    const stale = await env.store.save(original.head.jobId, original.head.currentRevisionId, editor(next.revision), []);
    rejected(stale, 'CONFLICT'); assert.equal(stale.currentRevisionId, next.revision.revisionId); assert.deepEqual(env.control.snapshot(), before);
    env.store.close();
  });
});

describe('Open, schema, unavailable capability and collision safety', () => {
  test('missing IndexedDB and unavailable secure randomness refuse without fallback writes', async () => {
    const absent = createJobStore(undefined, { crypto: deterministicCrypto() }); rejected(await absent.create(fields(), []), 'UNAVAILABLE'); absent.close();
    for (const crypto of [null, {}, { getRandomValues() { throw new Error('Crypto unavailable'); } }]) {
      const env = setup({ crypto }); const before = env.control.snapshot();
      rejected(await env.store.create(fields(), []), 'UNAVAILABLE');
      assert.equal(env.control.snapshot() ? env.control.count('jobs') : 0, 0);
      if (env.control.snapshot()) assert.equal(env.control.count('jobRevisions'), 0);
      env.store.close();
    }
  });

  test('open exception and rejected open are contained and never produce records', async () => {
    for (const fail of ['throwNextOpen', 'failNextOpen']) {
      const env = setup(); env.control[fail]('SecurityError'); rejected(await env.store.create(fields(), []), 'UNAVAILABLE');
      await env.control.flush(); assert.equal(env.control.snapshot(), null); env.store.close();
    }
  });

  test('closing while open is pending cancels the instance without a later hidden creation', async () => {
    const env = setup(); const pending = env.store.create(fields(), []); env.store.close();
    rejected(await pending, 'UNAVAILABLE'); await env.control.flush();
    const snapshot = env.control.snapshot();
    if (snapshot) { assert.equal(snapshot.jobs.length, 0); assert.equal(snapshot.jobRevisions.length, 0); }
    assert.equal(env.control.stats.events.some((e) => e.type === 'request' && ['add', 'put'].includes(e.operation)), false);
    rejected(await env.store.list(), 'UNAVAILABLE');
  });

  test('blocked open followed by late upgrade cannot perform an abandoned create', async () => {
    const env = setup(); env.control.blockNextOpen();
    rejected(await env.store.create(fields(), []), 'BLOCKED');
    env.control.releaseBlockedOpen(); await env.control.flush();
    assert.equal(env.control.stats.events.filter((e) => e.type === 'request' && ['add', 'put'].includes(e.operation)).length, 0);
    const snapshot = env.control.snapshot();
    if (snapshot) { assert.equal(snapshot.jobs.length, 0); assert.equal(snapshot.jobRevisions.length, 0); }
    env.store.close();
  });

  test('blocked open followed by late success on existing data closes and changes nothing', async () => {
    const seeded = fixture(5, 2); const env = setup({ seed: seedRows([seeded]) }); const before = env.control.snapshot();
    env.control.blockNextOpen(); rejected(await env.store.save(seeded.head.jobId, seeded.head.currentRevisionId, fields(), []), 'BLOCKED');
    env.control.releaseBlockedOpen(); await env.control.flush();
    assert.deepEqual(env.control.snapshot(), before); assert.ok(env.control.stats.closes >= 1);
    assert.equal(env.control.stats.events.filter((e) => e.type === 'request' && ['add', 'put'].includes(e.operation)).length, 0); env.store.close();
  });

  test('future database version stays intact and is explicitly unsupported', async () => {
    const env = setup({ seed: Object.assign(seedRows([fixture(6)]), { version: 2 }) }); const before = env.control.snapshot();
    rejected(await env.store.list(), 'UNSUPPORTED'); assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('existing malformed schema is never silently repaired or recreated', async () => {
    const variants = [
      { jobs: { keyPath: 'wrong' }, jobRevisions: { keyPath: 'revisionId', indexes: { byJobId: { keyPath: 'jobId' } } } },
      { jobs: { keyPath: 'jobId' } },
      { jobs: { keyPath: 'jobId' }, jobRevisions: { keyPath: 'revisionId' } },
      { jobs: { keyPath: 'jobId' }, jobRevisions: { keyPath: 'revisionId', indexes: { byJobId: { keyPath: 'wrong' } } } },
      { jobs: { keyPath: 'jobId' }, jobRevisions: { keyPath: 'revisionId', indexes: { byJobId: { keyPath: 'jobId', unique: true } } } },
      { jobs: { keyPath: 'jobId' }, jobRevisions: { keyPath: 'revisionId', indexes: { byJobId: { keyPath: 'jobId', multiEntry: true } } } },
    ];
    for (const schema of variants) {
      const env = setup({ seed: { schema } }); const before = env.control.snapshot();
      rejected(await env.store.create(fields(), []), ['CORRUPT', 'UNSUPPORTED']);
      assert.deepEqual(env.control.snapshot(), before); assert.equal(env.control.stats.events.some((e) => e.type === 'request' && ['add', 'put'].includes(e.operation)), false); env.store.close();
    }
  });

  test('versionchange closes the connection and next operation cannot silently read a newer schema', async () => {
    const env = setup(); const original = good(await env.store.create(fields(), [])); const before = env.control.snapshot();
    const closes = env.control.stats.closes; await env.control.changeVersion(2);
    assert.ok(env.control.stats.closes > closes); rejected(await env.store.read(original.head.jobId), ['UNAVAILABLE', 'UNSUPPORTED']);
    const after = env.control.snapshot(); before.version = 2; assert.deepEqual(after, before); env.store.close();
    const fresh = createJobStore(env.indexedDB, { crypto: deterministicCrypto() });
    rejected(await fresh.read(original.head.jobId), 'UNSUPPORTED'); fresh.close();
  });

  test('creation collision retries are bounded and never overwrite an existing card', async () => {
    const random = fixedCrypto(77); const env = setup({ crypto: random }); good(await env.store.create(fields(), []));
    const before = env.control.snapshot(); const calls = random.calls;
    rejected(await env.store.create(fields({ title: 'Second independent card' }), []), 'COLLISION');
    assert.ok(random.calls - calls >= 5 && random.calls - calls <= 10, 'maximum five attempts with one job and one revision id per attempt');
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('generated job id with orphan history is a collision and never adopts or replaces that history', async () => {
    const raw = fixture(77); const env = setup({ seed: { jobs: [], jobRevisions: raw.revisions }, crypto: fixedCrypto(77) });
    const before = env.control.snapshot(); rejected(await env.store.create(fields(), []), 'COLLISION');
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('revision add collision rolls back the candidate head before a fresh create attempt succeeds', async () => {
    const existing = fixture(7); const sequence = [900001, 70001, 900002, 900003]; let calls = 0;
    const crypto = { getRandomValues(array) { assert.ok(calls < sequence.length, 'one native-key collision only'); return deterministicCrypto(sequence[calls++]).getRandomValues(array); } };
    const env = setup({ seed: seedRows([existing]), crypto }); const before = clone(existing.revisions[0]);
    const created = good(await env.store.create(fields({ title: 'Independent new card' }), []));
    assert.equal(calls, 4); assert.equal(created.head.jobId, jobId(900002)); assert.equal(created.head.currentRevisionId, revisionId(900003));
    assert.equal(env.control.raw('jobs', jobId(900001)), undefined, 'the collided transaction must not leave its candidate head');
    assert.deepEqual(env.control.raw('jobRevisions', before.revisionId), before);
    assert.equal(env.control.count('jobs'), 2); assert.equal(env.control.count('jobRevisions'), 2); env.store.close();
  });

  test('revision collision is bounded, preserves current head and never puts an old revision', async () => {
    const seeded = fixture(7); const random = fixedCrypto(70001); const env = setup({ seed: seedRows([seeded]), crypto: random });
    const before = env.control.snapshot(); rejected(await env.store.save(seeded.head.jobId, seeded.head.currentRevisionId, fields(), []), 'COLLISION');
    assert.equal(random.calls, 5); assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('one collided revision id can retry a new id while retaining both historical identities', async () => {
    const seeded = fixture(8); let calls = 0;
    const crypto = { getRandomValues(array) { calls++; assert.ok(calls <= 2, 'only one collision'); return deterministicCrypto(calls === 1 ? 80001 : 90001).getRandomValues(array); } };
    const env = setup({ seed: seedRows([seeded]), crypto }); const original = clone(seeded.revisions[0]);
    const saved = good(await env.store.save(seeded.head.jobId, seeded.head.currentRevisionId, fields(), []));
    assert.equal(calls, 2); assert.equal(saved.revision.revisionId, revisionId(90001)); assert.equal(saved.revision.parentRevisionId, original.revisionId);
    assert.deepEqual(env.control.raw('jobRevisions', original.revisionId), original); assert.equal(env.control.count('jobRevisions'), 2); env.store.close();
  });
});

describe('Validation and stored head/history integrity', () => {
  test('malformed input fields, descriptors and IDs are contained without writes', async () => {
    const env = setup(); const original = good(await env.store.create(fields(), [])); const before = env.control.snapshot();
    for (const bad of [fields({ title: ' ' }), fields({ title: 'x'.repeat(201) }), fields({ address: 'x'.repeat(2001) }), fields({ notes: 'x'.repeat(20001) }), Object.assign(fields(), { extra: true })]) {
      rejected(await env.store.create(bad, []), 'VALIDATION');
      rejected(await env.store.save(original.head.jobId, original.head.currentRevisionId, bad, []), 'VALIDATION');
    }
    rejected(await env.store.create(fields(), [link(1), link(1)]), 'VALIDATION');
    rejected(await env.store.create(fields(), [Object.assign(link(2), { serviceResultId: '__proto__' })]), 'VALIDATION');
    rejected(await env.store.read('__proto__'), 'VALIDATION');
    rejected(await env.store.history('invalid'), 'VALIDATION');
    rejected(await env.store.readHistorical(original.head.jobId, 'invalid'), 'VALIDATION');
    rejected(await env.store.save(original.head.jobId, 'invalid', fields(), []), 'VALIDATION');
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('missing job and wrong-job historical lookup never select a plausible alternative', async () => {
    const a = fixture(11); const b = fixture(12); const env = setup({ seed: seedRows([a, b]) }); const before = env.control.snapshot();
    for (const operation of [() => env.store.read(jobId(999)), () => env.store.history(jobId(999)), () => env.store.save(jobId(999), revisionId(999), fields(), [])]) rejected(await operation(), 'NOT_FOUND');
    rejected(await env.store.readHistorical(a.head.jobId, b.head.currentRevisionId), ['NOT_FOUND', 'CORRUPT']);
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('old supported producer metadata is read unchanged rather than rewritten to current application', async () => {
    const old = fixture(13, 2); old.revisions.forEach((r) => { r.producer.applicationRevision = 'EARLIER-APP-REVISION'; });
    const env = setup({ seed: seedRows([old]) }); const before = env.control.snapshot();
    assert.equal(good(await env.store.read(old.head.jobId)).revision.producer.applicationRevision, 'EARLIER-APP-REVISION');
    const history = await env.store.history(old.head.jobId); assert.equal(history.ok, true); assert.deepEqual(history.revisions, old.revisions.slice().reverse());
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('an orphan-only database visibly reports preserved history instead of presenting empty success', async () => {
    const orphan = fixture(23, 2); const env = setup({ seed: { jobs: [], jobRevisions: orphan.revisions } }); const before = env.control.snapshot();
    const listing = await env.store.list(); assert.equal(listing.ok, true, JSON.stringify(listing)); assert.deepEqual(listing.jobs, []);
    assert.ok(listing.problems.some((p) => p.jobId === orphan.head.jobId && p.code === 'CORRUPT' && p.problems.length > 0), JSON.stringify(listing));
    rejected(await env.store.read(orphan.head.jobId), 'CORRUPT'); assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('unindexed malformed revision is visibly diagnosed while a valid card remains available', async () => {
    for (const invalidJobId of [undefined, null, { malformed: true }]) {
      const valid = fixture(24); const malformed = fixture(25).revisions[0];
      if (invalidJobId === undefined) delete malformed.jobId; else malformed.jobId = invalidJobId;
      const seed = seedRows([valid]); seed.jobRevisions.push(malformed);
      const env = setup({ seed }); const before = env.control.snapshot(); const listing = await env.store.list();
      assert.equal(listing.ok, true, JSON.stringify(listing)); assert.deepEqual(listing.jobs.map((job) => job.head.jobId), [valid.head.jobId]);
      assert.ok(listing.problems.some((p) => p.code === 'CORRUPT' && p.problems.length > 0), JSON.stringify(listing));
      assert.deepEqual(env.control.snapshot(), before); env.store.close();
    }
  });

  test('malformed or unsupported head/revision entries remain visible problems while a valid card stays usable', async () => {
    for (const edit of [
      (env, bad) => { const head = clone(bad.head); head.recordVersion = 2; env.control.set('jobs', head.jobId, head); },
      (env, bad) => { const head = clone(bad.head); head.extra = 'not supported'; env.control.set('jobs', head.jobId, head); },
      (env, bad) => { const r = clone(bad.revisions[0]); r.recordVersion = 2; env.control.set('jobRevisions', r.revisionId, r); },
      (env, bad) => { env.control.delete('jobRevisions', bad.head.currentRevisionId); },
      (env, bad) => { const head = clone(bad.head); head.jobId = jobId(99); env.control.set('jobs', bad.head.jobId, head); },
    ]) {
      const valid = fixture(14); const bad = fixture(15); const env = setup({ seed: seedRows([valid, bad]) }); edit(env, bad); const before = env.control.snapshot();
      const listing = await env.store.list(); assert.equal(listing.ok, true, JSON.stringify(listing));
      assert.deepEqual(listing.jobs.map((job) => job.head.jobId), [valid.head.jobId]);
      assert.equal(listing.problems.length, 1); assert.equal(listing.problems[0].jobId, bad.head.jobId);
      assert.ok(['CORRUPT', 'UNSUPPORTED'].includes(listing.problems[0].code)); assert.ok(listing.problems[0].problems.length > 0);
      rejected(await env.store.read(bad.head.jobId), ['CORRUPT', 'UNSUPPORTED']);
      good(await env.store.read(valid.head.jobId)); assert.deepEqual(env.control.snapshot(), before); env.store.close();
    }
  });

  test('missing parent, wrong head number, branch, orphan and inconsistent identity refuse read/history/save with no repair', async () => {
    const edits = [
      (env, c) => { env.control.delete('jobRevisions', c.revisions[0].revisionId); },
      (env, c) => { const head = clone(c.head); head.revisionNumber = 1; env.control.set('jobs', head.jobId, head); },
      (env, c) => { const r = clone(c.revisions[1]); r.parentRevisionId = revisionId(999999); env.control.set('jobRevisions', r.revisionId, r); },
      (env, c) => { const r = clone(c.revisions[1]); r.revisionId = revisionId(999998); env.control.set('jobRevisions', r.revisionId, r); },
      (env, c) => { const r = clone(c.revisions[0]); r.revisionId = revisionId(999997); env.control.set('jobRevisions', r.revisionId, r); },
      (env, c) => { const r = clone(c.revisions[1]); r.jobId = jobId(98); env.control.set('jobRevisions', r.revisionId, r); },
      (env, c) => { const r = clone(c.revisions[1]); r.revisionId = revisionId(999996); env.control.set('jobRevisions', c.revisions[1].revisionId, r); },
      (env, c) => { const r = clone(c.revisions[0]); r.createdAt = timestamp(3); env.control.set('jobRevisions', r.revisionId, r); },
      (env, c) => { const head = clone(c.head); head.currentRevisionId = c.revisions[0].revisionId; head.revisionNumber = 1; env.control.set('jobs', head.jobId, head); },
    ];
    for (const edit of edits) {
      const current = fixture(16, 2); const env = setup({ seed: seedRows([current]) }); edit(env, current); const before = env.control.snapshot();
      rejected(await env.store.read(current.head.jobId), 'CORRUPT');
      rejected(await env.store.history(current.head.jobId), 'CORRUPT');
      rejected(await env.store.save(current.head.jobId, current.head.currentRevisionId, fields(), []), 'CORRUPT');
      assert.deepEqual(env.control.snapshot(), before); env.store.close();
    }
  });

  test('stored history cannot remove, relabel, reorder or backdate a newly added result link', async () => {
    const edits = [
      (r) => { r.serviceResultLinks = []; },
      (r) => { r.serviceResultLinks[0].savedName = 'Rewritten historical name'; },
      (r) => { r.serviceResultLinks[0].savedAt = timestamp(9); },
      (r) => { r.serviceResultLinks.reverse(); },
      (r) => { r.serviceResultLinks.push(Object.assign({ linkedAt: timestamp(10) }, link(3))); },
    ];
    for (const edit of edits) {
      const current = fixture(19, 2);
      const originalLinks = [1, 2].map((number) => Object.assign({ linkedAt: timestamp(1) }, link(number)));
      current.revisions[0].serviceResultLinks = clone(originalLinks); current.revisions[1].serviceResultLinks = clone(originalLinks);
      edit(current.revisions[1]); const env = setup({ seed: seedRows([current]) }); const before = env.control.snapshot();
      rejected(await env.store.read(current.head.jobId), 'CORRUPT'); rejected(await env.store.history(current.head.jobId), 'CORRUPT');
      rejected(await env.store.save(current.head.jobId, current.head.currentRevisionId, fields(), []), 'CORRUPT');
      assert.deepEqual(env.control.snapshot(), before); env.store.close();
    }
  });

  test('unsupported hidden historical entry prevents presenting an apparently valid current chain', async () => {
    const current = fixture(17, 2); current.revisions[0].recordVersion = 2;
    const env = setup({ seed: seedRows([current]) }); const before = env.control.snapshot();
    rejected(await env.store.read(current.head.jobId), 'UNSUPPORTED'); rejected(await env.store.history(current.head.jobId), 'UNSUPPORTED');
    rejected(await env.store.readHistorical(current.head.jobId, current.head.currentRevisionId), 'UNSUPPORTED');
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('links can be retained without resolving service storage; duplicate additions do not rewrite their names', async () => {
    const current = fixture(18); current.revisions[0].serviceResultLinks = [Object.assign({ linkedAt: current.revisions[0].savedAt }, link(9))];
    const env = setup({ seed: seedRows([current]) });
    const saved = good(await env.store.save(current.head.jobId, current.head.currentRevisionId, fields({ notes: 'Metadata edit while saved result is unavailable' }), []));
    assert.deepEqual(saved.revision.serviceResultLinks, current.revisions[0].serviceResultLinks);
    assert.equal(saved.revision.serviceResultLinks[0].savedName, 'B0 / review required 9'); env.store.close();
  });
});

describe('Explicit bounded scans and history growth', () => {
  test('the 500-card boundary refuses another creation inside the transaction without an orphan revision', async () => {
    const env = setup({ seed: seedRows(Array.from({ length: 500 }, (_, i) => fixture(i + 1))), start: 900000 });
    const before = env.control.snapshot();
    rejected(await env.store.create(fields({ title: 'Would exceed bound' }), []), 'LIMIT');
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('501 heads return LIMIT without success truncation or getAll', async () => {
    const env = setup({ seed: seedRows(Array.from({ length: 501 }, (_, i) => fixture(i + 1))) }); const before = env.control.snapshot();
    rejected(await env.store.list(), 'LIMIT');
    assert.equal(env.control.stats.getAllCalls, 0); assert.ok(env.control.stats.cursorRows <= 2002, 'bounded head, distinct-index audit and one-row history scans; never an unbounded getAll');
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('501 distinct orphan identities return explicit LIMIT instead of a truncated problem list', async () => {
    const raw = Array.from({ length: 501 }, (_, i) => fixture(i + 1).revisions[0]);
    const env = setup({ seed: { jobs: [], jobRevisions: raw } }); const before = env.control.snapshot();
    rejected(await env.store.list(), 'LIMIT');
    assert.equal(env.control.stats.getAllCalls, 0); assert.ok(env.control.stats.cursorRows <= 501);
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('1001 revisions return LIMIT and never silently truncate an apparently complete history', async () => {
    const current = fixture(21, 1001); const env = setup({ seed: seedRows([current]) }); const before = env.control.snapshot();
    rejected(await env.store.history(current.head.jobId), 'LIMIT');
    assert.equal(env.control.stats.getAllCalls, 0); assert.ok(env.control.stats.cursorRows <= 1001);
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });

  test('a complete 1000-revision history is readable but appending revision 1001 refuses without changing its head', async () => {
    const current = fixture(22, 1000); const env = setup({ seed: seedRows([current]), start: 900000 }); const before = env.control.snapshot();
    const history = await env.store.history(current.head.jobId); assert.equal(history.ok, true, JSON.stringify(history));
    assert.equal(history.revisions.length, 1000); assert.equal(history.revisions[0].revisionNumber, 1000); assert.equal(history.revisions[999].revisionNumber, 1);
    rejected(await env.store.save(current.head.jobId, current.head.currentRevisionId, fields(), []), 'LIMIT');
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });
});


/** RESUME global-limit regression: small real simulator datasets plus explicitly
 * injected aggregate counts. The half-million boundary is NOT a real storage-size test. */
function overrideTotalRevisionCount(indexedDB, total) {
  const wrap = (target, get) => new Proxy(target, { get(t, k) { const custom = get(t, k); if (custom !== undefined) return custom; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; }, set(t, k, v) { return Reflect.set(t, k, v, t); } });
  return { open(name, version) {
    const request = indexedDB.open(name, version); let connection;
    return wrap(request, (r, k) => {
      if (k !== 'result' || !r.result) return undefined;
      if (!connection) connection = wrap(r.result, (db, member) => member === 'transaction' ? (...args) => {
        const transaction = db.transaction(...args);
        return wrap(transaction, (tx, p) => p === 'objectStore' ? (storeName) => {
          const store = tx.objectStore(storeName);
          return storeName !== 'jobRevisions' ? store : wrap(store, (s, field) => field === 'count' ? (...countArgs) => {
            const countRequest = s.count(...countArgs);
            return wrap(countRequest, (q, fieldName) => fieldName === 'result' && q.readyState === 'done' && !q.error ? total() : undefined);
          } : undefined);
        } : undefined);
      } : undefined);
      return connection;
    });
  } };
}

describe('Resumed global limits — prospective bounds inside the writing transaction', () => {
  test('500 orphan identities forbid creating a 501st identity although there are no heads', async () => {
    const raw = Array.from({ length: 500 }, (_, i) => fixture(i + 1).revisions[0]);
    const env = setup({ seed: { jobs: [], jobRevisions: raw }, start: 900000 }); const before = env.control.snapshot();
    rejected(await env.store.create(fields(), []), 'LIMIT');
    assert.deepEqual(env.control.snapshot(), before); assert.equal(env.control.count('jobs'), 0);
    assert.ok(env.control.stats.cursorRows <= 501, 'bounded distinct-identity scan'); env.store.close();
  });
  test('499 orphan identities permit exactly one new card and the resulting list remains readable', async () => {
    const raw = Array.from({ length: 499 }, (_, i) => fixture(i + 1).revisions[0]);
    const env = setup({ seed: { jobs: [], jobRevisions: raw }, start: 900000 });
    const job = good(await env.store.create(fields(), [])); const listing = await env.store.list();
    assert.equal(listing.ok, true, JSON.stringify(listing)); assert.deepEqual(listing.jobs, [job]); assert.equal(listing.problems.length, 499);
    rejected(await env.store.create(fields(), []), 'LIMIT'); assert.equal(env.control.count('jobs'), 1); env.store.close();
  });
  test('append at 500 distinct identities is allowed; append at 501 is refused', async () => {
    for (const orphanCount of [499, 500]) {
      const current = fixture(700); const raw = Array.from({ length: orphanCount }, (_, i) => fixture(i + 1).revisions[0]);
      const env = setup({ seed: { jobs: [current.head], jobRevisions: raw.concat(current.revisions) }, start: 900000 }); const before = env.control.snapshot();
      const result = await env.store.save(current.head.jobId, current.head.currentRevisionId, fields(), []);
      if (orphanCount === 499) { assert.equal(good(result).revision.revisionNumber, 2); assert.equal((await env.store.list()).ok, true); }
      else { rejected(result, 'LIMIT'); assert.deepEqual(env.control.snapshot(), before); }
      env.store.close();
    }
  });
  test('a real append refuses a global head count above 500 even for a valid one-revision card', async () => {
    const current = fixture(700); const heads = Array.from({ length: 500 }, (_, i) => fixture(i + 1).head);
    const env = setup({ seed: { jobs: heads.concat(current.head), jobRevisions: current.revisions }, start: 900000 }); const before = env.control.snapshot();
    rejected(await env.store.save(current.head.jobId, current.head.currentRevisionId, fields(), []), 'LIMIT');
    assert.deepEqual(env.control.snapshot(), before); env.store.close();
  });
  test('two clients creating from 499 orphan identities cannot both pass the prospective limit', async () => {
    const raw = Array.from({ length: 499 }, (_, i) => fixture(i + 1).revisions[0]);
    const env = setup({ seed: { jobs: [], jobRevisions: raw }, start: 900000 });
    const other = createJobStore(env.indexedDB, { crypto: deterministicCrypto(910000), now: () => timestamp(10) });
    const results = await Promise.all([env.store.create(fields({ title: 'Window A' }), []), other.create(fields({ title: 'Window B' }), [])]);
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results)); rejected(results.find((r) => !r.ok), 'LIMIT');
    assert.equal(env.control.count('jobs'), 1); assert.equal(env.control.count('jobRevisions'), 500);
    const listing = await env.store.list(); assert.equal(listing.ok, true); assert.equal(listing.jobs.length, 1); assert.equal(listing.problems.length, 499);
    other.close(); env.store.close();
  });
  test('synthetic total-count boundary refuses both create and append at 500000 without writing', async () => {
    const current = fixture(700); const env = setup({ seed: seedRows([current]) });
    const store = createJobStore(overrideTotalRevisionCount(env.indexedDB, () => 500000), { crypto: deterministicCrypto(900000), now: () => timestamp(10) }); const before = env.control.snapshot();
    rejected(await store.create(fields(), []), 'LIMIT');
    rejected(await store.save(current.head.jobId, current.head.currentRevisionId, fields(), []), 'LIMIT');
    assert.deepEqual(env.control.snapshot(), before); store.close(); env.store.close();
  });
  test('synthetic total 499999 permits the last append but forbids the next, while no-op remains no-write', async () => {
    const current = fixture(700); const env = setup({ seed: seedRows([current]) });
    const store = createJobStore(overrideTotalRevisionCount(env.indexedDB, () => 499998 + env.control.count('jobRevisions')), { crypto: deterministicCrypto(900000), now: () => timestamp(10) });
    const saved = good(await store.save(current.head.jobId, current.head.currentRevisionId, fields(), []));
    assert.equal(saved.revision.revisionNumber, 2); const before = env.control.snapshot();
    rejected(await store.save(saved.head.jobId, saved.head.currentRevisionId, fields({ notes: 'Would exceed global count' }), []), 'LIMIT');
    const unchanged = await store.save(saved.head.jobId, saved.head.currentRevisionId, editor(saved.revision), []);
    assert.equal(unchanged.ok, true); assert.equal(unchanged.unchanged, true); assert.deepEqual(env.control.snapshot(), before); store.close(); env.store.close();
  });
  test('invalid global count or failed global read refuses before any writes are queued', async () => {
    for (const total of [-1, NaN, Infinity]) {
      const env = setup({ seed: { jobs: [], jobRevisions: [] } }); const before = env.control.snapshot();
      const store = createJobStore(overrideTotalRevisionCount(env.indexedDB, () => total), { crypto: deterministicCrypto(900000), now: () => timestamp(10) });
      rejected(await store.create(fields(), []), 'CORRUPT'); assert.deepEqual(env.control.snapshot(), before); store.close(); env.store.close();
    }
    const env = setup({ seed: { jobs: [], jobRevisions: [] } }); const before = env.control.snapshot();
    env.control.failRequest({ store: 'jobRevisions', operation: 'count', name: 'UnknownError' });
    rejected(await env.store.create(fields(), []), 'UNAVAILABLE'); assert.deepEqual(env.control.snapshot(), before);
    assert.equal(env.control.stats.events.some((e) => e.type === 'request' && ['add', 'put'].includes(e.operation)), false); env.store.close();
  });
});
