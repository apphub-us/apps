'use strict';
/**
 * LC-JOB-CARD-1 native IndexedDB boundary. No DOM, ambient storage, calculator
 * evaluation or migration. Source-result links remain external references:
 * IndexedDB cannot transact atomically with the existing localStorage records.
 * Every successful result is published ONLY by transaction.oncomplete, never
 * by an individual request's success handler (a later request/commit can abort).
 */
const Model = require('./jobCard.js');
const DB_NAME = 'empire_code_jobs';
const DB_VERSION = 1;
const MAX_JOBS = 500;
const MAX_REVISIONS = 1000;
const MAX_COLLISIONS = 5;
const STORES = ['jobs', 'jobRevisions'];
function errorText(e) {
  try { const message = e && e.message; return typeof message === 'string' ? message.slice(0, 2000) : 'operation refused'; }
  catch (_) { return 'operation refused'; }
}
const fail = (code, message, extra) => Object.assign({ ok: false, code, problems: Array.isArray(message) ? message : [message] }, extra || {});
function storageError(error, message) {
  let name;
  try { name = error && error.name; } catch (_) { name = null; }
  const code = name === 'QuotaExceededError' ? 'QUOTA' : name === 'VersionError' ? 'UNSUPPORTED'
    : name === 'ConstraintError' ? 'COLLISION' : name === 'AbortError' ? 'ABORTED' : 'UNAVAILABLE';
  return fail(code, message + ': ' + errorText(error));
}
function storedFailure(result) { return fail(result.code === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'CORRUPT', result.problems); }
function headFor(revision) {
  return { kind: Model.HEAD_KIND, recordVersion: Model.RECORD_VERSION, jobId: revision.jobId,
    currentRevisionId: revision.revisionId, revisionNumber: revision.revisionNumber };
}
function listHas(list, value) { return list && typeof list.contains === 'function' && list.contains(value); }
function connectionProblem(db) {
  if (!db || db.version !== DB_VERSION) return fail('UNSUPPORTED', 'Unsupported job database version. Stored data was not changed.');
  if (!db.objectStoreNames || db.objectStoreNames.length !== 2 || !STORES.every((name) => listHas(db.objectStoreNames, name))) return fail('CORRUPT', 'The job database stores do not match the supported schema. No repair was attempted.');
  return null;
}
function schemaProblem(db, tx) {
  const bad = connectionProblem(db); if (bad) return bad;
  const jobs = tx.objectStore('jobs'); const revisions = tx.objectStore('jobRevisions');
  if (jobs.keyPath !== 'jobId' || jobs.autoIncrement !== false || jobs.indexNames.length !== 0
    || revisions.keyPath !== 'revisionId' || revisions.autoIncrement !== false
    || revisions.indexNames.length !== 1 || !listHas(revisions.indexNames, 'byJobId')) return fail('CORRUPT', 'Unsupported job store keys or indexes. Stored data was not changed.');
  const index = revisions.index('byJobId');
  if (index.keyPath !== 'jobId' || index.unique !== false || index.multiEntry !== false) return fail('CORRUPT', 'Unsupported job revision index. Stored data was not changed.');
  return null;
}
/** Full-chain validation disallows missing parents, alternate heads and link rewriting. */
function coherentJob(jobId, rawHead, rows) {
  if (rawHead === undefined) return rows.length ? fail('CORRUPT', 'Revision records exist without a job head. They were preserved.') : fail('NOT_FOUND', 'This job card is no longer available.');
  const parsedHead = Model.readHead(rawHead); if (!parsedHead.ok) return storedFailure(parsedHead);
  const head = parsedHead.head;
  if (head.jobId !== jobId) return fail('CORRUPT', 'The job head does not match its storage key.');
  const revisions = [];
  for (const row of rows) {
    const parsed = Model.readRevision(row.value); if (!parsed.ok) return storedFailure(parsed);
    const revision = parsed.revision;
    if (row.primaryKey !== revision.revisionId || row.key !== jobId || revision.jobId !== jobId) return fail('CORRUPT', 'A revision does not match its job/index/storage key.');
    revisions.push(revision);
  }
  revisions.sort((a, b) => b.revisionNumber - a.revisionNumber);
  if (!revisions.length || revisions.length !== head.revisionNumber || revisions[0].revisionId !== head.currentRevisionId) return fail('CORRUPT', 'The current head and complete revision history disagree. No alternate result was chosen.');
  const createdAt = revisions[0].createdAt;
  for (let i = 0; i < revisions.length; i++) {
    const revision = revisions[i]; const parent = revisions[i + 1];
    if (revision.revisionNumber !== head.revisionNumber - i || revision.createdAt !== createdAt
      || revision.parentRevisionId !== (parent ? parent.revisionId : null)) return fail('CORRUPT', 'The revision chain contains a missing parent, duplicate number or inconsistent identity.');
    const oldLinks = parent ? parent.serviceResultLinks : [];
    if (revision.serviceResultLinks.length < oldLinks.length) return fail('CORRUPT', 'A historical revision removed a saved-result link.');
    for (let j = 0; j < oldLinks.length; j++) {
      const a = oldLinks[j]; const b = revision.serviceResultLinks[j];
      if (!b || a.serviceResultId !== b.serviceResultId || a.linkedAt !== b.linkedAt || a.savedName !== b.savedName || a.savedAt !== b.savedAt) return fail('CORRUPT', 'A historical revision rewrote or reordered an existing saved-result link.');
    }
    for (let j = oldLinks.length; j < revision.serviceResultLinks.length; j++) if (revision.serviceResultLinks[j].linkedAt !== revision.savedAt) return fail('CORRUPT', 'A newly linked result has an inconsistent revision time.');
  }
  return { ok: true, job: { head, revision: revisions[0] }, revisions };
}
function createJobStore(indexedDB, options) {
  const opts = options || {};
  let connection = null; let opening = null; let closed = false; let epoch = 0;
  function unavailable() { return fail('UNAVAILABLE', 'Job storage is unavailable or this connection has closed. Reload to reconnect.'); }
  function closeConnection(db) { try { if (db && typeof db.close === 'function') db.close(); } catch (_) { /* closure cannot authorize a repair */ } }
  function close() {
    closed = true; epoch++;
    if (opening && opening.cancel) opening.cancel();
    closeConnection(connection); connection = null;
  }
  function open() {
    if (closed) return Promise.resolve(unavailable());
    if (connection) return Promise.resolve({ ok: true, db: connection });
    if (opening) return opening.promise;
    const holder = {}; opening = holder;
    holder.promise = new Promise((resolve) => {
      let settled = false; let abandoned = false; let upgradeFailure = null; let request;
      const generation = epoch;
      function settle(result) {
        if (settled) return;
        settled = true;
        if (opening === holder) opening = null;
        resolve(result);
      }
      holder.cancel = () => { abandoned = true; settle(unavailable()); };
      try {
        if (!indexedDB || typeof indexedDB.open !== 'function') { settle(fail('UNAVAILABLE', 'This browser does not provide job storage. No fallback was written.')); return; }
        request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onblocked = () => { abandoned = true; settle(fail('BLOCKED', 'Another tab is blocking job storage. Close the other Empire Code tab and try again.')); };
        request.onupgradeneeded = (event) => {
          // A blocked/closed request may later resume. It must never perform a hidden write.
          if (abandoned || settled || closed || generation !== epoch) { try { request.transaction.abort(); } catch (_) { /* already finished */ } return; }
          try {
            const db = request.result;
            if (event.oldVersion !== 0 || db.objectStoreNames.length !== 0) {
              upgradeFailure = fail('UNSUPPORTED', 'Unsupported prior job database schema. No migration was attempted.');
              request.transaction.abort(); return;
            }
            db.createObjectStore('jobs', { keyPath: 'jobId' });
            const revisions = db.createObjectStore('jobRevisions', { keyPath: 'revisionId' });
            revisions.createIndex('byJobId', 'jobId', { unique: false });
          } catch (e) { upgradeFailure = storageError(e, 'Job database creation failed'); try { request.transaction.abort(); } catch (_) { /* already finished */ } }
        };
        request.onerror = () => { settle(upgradeFailure || storageError(request.error, 'Job database could not be opened')); };
        request.onsuccess = () => {
          const db = request.result;
          if (abandoned || settled || closed || generation !== epoch) { closeConnection(db); settle(unavailable()); return; }
          const bad = connectionProblem(db);
          if (bad) { closeConnection(db); settle(bad); return; }
          connection = db;
          db.onversionchange = () => { close(); };
          db.onclose = () => { if (connection === db) { connection = null; closed = true; epoch++; } };
          settle({ ok: true, db });
        };
      } catch (e) { settle(storageError(e, 'Job database could not be opened')); }
    });
    return holder.promise;
  }
  function transact(db, mode, operation) {
    if (closed || db !== connection) return Promise.resolve(unavailable());
    return new Promise((resolve) => {
      let tx; let outcome = null; let requestFailure = null; let settled = false;
      const context = {
        failed: false,
        finish(result) { if (!context.failed) outcome = result; },
        abort(result) {
          if (settled || context.failed) return;
          context.failed = true; outcome = result;
          try { tx.abort(); } catch (e) { if (!settled) { settled = true; resolve(result || storageError(e, 'Job transaction could not be aborted')); } }
        },
        request(request, success) {
          request.onsuccess = () => {
            if (settled || context.failed) return;
            try { success(request.result); } catch (e) { context.abort(storageError(e, 'Job transaction callback failed')); }
          };
          request.onerror = () => { requestFailure = storageError(request.error, 'Job storage request failed'); context.failed = true; };
          return request;
        }
      };
      try {
        tx = db.transaction(STORES.slice(), mode);
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(requestFailure || outcome || fail('CORRUPT', 'The job transaction completed without a coherent result.'));
        };
        tx.onabort = () => {
          if (settled) return;
          settled = true;
          resolve(outcome && !outcome.ok ? outcome : requestFailure || storageError(tx.error || { name: 'AbortError', message: 'transaction aborted' }, 'Job transaction aborted'));
        };
        tx.onerror = (event) => { if (!requestFailure) requestFailure = storageError(tx.error || event && event.target && event.target.error, 'Job transaction failed'); };
        const bad = schemaProblem(db, tx);
        if (bad) { context.abort(bad); return; }
        operation(tx, context);
      } catch (e) {
        const result = storageError(e, 'Job transaction could not be started');
        if (tx) context.abort(result); else { settled = true; resolve(result); }
      }
    });
  }
  function loadJob(tx, context, jobId, done) {
    let headReady = false; let rawHead; let cursorDone = false; let finished = false; const rows = [];
    function finish(result) { if (!finished) { finished = true; done(result); } }
    function check() { if (headReady && cursorDone && !finished) finish(coherentJob(jobId, rawHead, rows)); }
    context.request(tx.objectStore('jobs').get(jobId), (value) => { rawHead = value; headReady = true; check(); });
    context.request(tx.objectStore('jobRevisions').index('byJobId').openCursor(jobId), (cursor) => {
      if (finished) return;
      if (!cursor) { cursorDone = true; check(); return; }
      if (rows.length >= MAX_REVISIONS) { finish(fail('LIMIT', 'This card exceeds the supported history limit of ' + MAX_REVISIONS + ' revisions. No history was truncated.')); return; }
      rows.push({ key: cursor.key, primaryKey: cursor.primaryKey, value: cursor.value });
      cursor.continue();
    });
  }
  /** Check the POST-WRITE aggregate bounds in the SAME readwrite transaction.
   * An orphan identity still occupies one slot. Creating an absent job adds one
   * distinct identity; appending to a validated current job adds none. Only a
   * real write uses this guard: an unchanged save creates no new data.
   * Count unindexed revisions too, without loading every historical value. */
  function prospectiveGlobalLimits(tx, context, addedJobs, done) {
    const jobs = tx.objectStore('jobs'); const revisions = tx.objectStore('jobRevisions'); const index = revisions.index('byJobId');
    let heads; let total; let indexed; let distinct = 0; let ready = 0;
    function check() {
      if (++ready !== 4 || context.failed) return;
      if (![heads, total, indexed].every((n) => Number.isSafeInteger(n) && n >= 0) || indexed > total) {
        context.abort(fail('CORRUPT', 'The global job/revision counts are inconsistent. No new data was written.')); return;
      }
      if (heads + addedJobs > MAX_JOBS || total + 1 > MAX_JOBS * MAX_REVISIONS) {
        context.abort(fail('LIMIT', 'This write would exceed the supported global job/history limit. Existing data was preserved.')); return;
      }
      done();
    }
    context.request(jobs.count(), (value) => { heads = value; check(); });
    context.request(revisions.count(), (value) => { total = value; check(); });
    context.request(index.count(), (value) => { indexed = value; check(); });
    context.request(index.openCursor(undefined, 'nextunique'), (cursor) => {
      if (!cursor) { check(); return; }
      if (++distinct + addedJobs > MAX_JOBS) {
        context.abort(fail('LIMIT', 'This write would exceed the supported number of stored job identities, including orphan histories. Existing data was preserved.')); return;
      }
      cursor.continue();
    });
  }
  function validJobId(jobId) { return typeof jobId === 'string' && Model.JOB_ID_RE.test(jobId); }
  function validRevisionId(id) { return typeof id === 'string' && Model.REVISION_ID_RE.test(id); }
  function newId(prefix) {
    if (!opts.crypto || typeof opts.crypto.getRandomValues !== 'function') throw new Error('Secure randomness is unavailable; no ID was guessed.');
    const bytes = new Uint8Array(16); opts.crypto.getRandomValues(bytes);
    return prefix + Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  function prepare(fields, links, jobId) {
    const savedAt = typeof opts.now === 'function' ? opts.now() : new Date().toISOString();
    // The validated independent copy is made synchronously, before awaiting any open.
    const result = Model.createInitialRevision(fields, links, { jobId: jobId || 'job1_' + '0'.repeat(32), revisionId: 'jrev1_' + '0'.repeat(32), savedAt });
    if (!result.ok) return result;
    return { ok: true, fields: { title: result.revision.title, address: result.revision.address, notes: result.revision.notes },
      links: result.revision.serviceResultLinks.map((link) => ({ serviceResultId: link.serviceResultId, savedName: link.savedName, savedAt: link.savedAt })), savedAt };
  }
  async function create(fields, links) {
    try {
      const prepared = prepare(fields, links); if (!prepared.ok) return prepared;
      let jobId; let revisionId;
      try { jobId = newId('job1_'); revisionId = newId('jrev1_'); } catch (e) { return fail('UNAVAILABLE', errorText(e)); }
      const opened = await open(); if (!opened.ok) return opened;
      for (let attempt = 0; attempt < MAX_COLLISIONS; attempt++) {
        if (attempt) { try { jobId = newId('job1_'); revisionId = newId('jrev1_'); } catch (e) { return fail('UNAVAILABLE', errorText(e)); } }
        const made = Model.createInitialRevision(prepared.fields, prepared.links, { jobId, revisionId, savedAt: prepared.savedAt }); if (!made.ok) return made;
        const revision = made.revision; const head = headFor(revision);
        const result = await transact(opened.db, 'readwrite', (tx, context) => {
          const jobs = tx.objectStore('jobs'); const revisions = tx.objectStore('jobRevisions');
          let count; let existing; let orphan; let ready = 0;
          function check() {
            if (++ready !== 3) return;
            if (!Number.isSafeInteger(count) || count < 0) { context.abort(fail('CORRUPT', 'Job count is unavailable.')); return; }
            if (count >= MAX_JOBS) { context.abort(fail('LIMIT', 'The limit of ' + MAX_JOBS + ' job cards has been reached. No card was added.')); return; }
            if (existing !== undefined || orphan) { context.abort(fail('COLLISION', 'The generated card ID already has stored data.')); return; }
            prospectiveGlobalLimits(tx, context, 1, () => {
              context.request(revisions.add(revision), () => {});
              context.request(jobs.add(head), () => {});
              context.finish({ ok: true, job: { head, revision } });
            });
          }
          context.request(jobs.count(), (value) => { count = value; check(); });
          context.request(jobs.get(jobId), (value) => { existing = value; check(); });
          context.request(revisions.index('byJobId').openCursor(jobId), (cursor) => { orphan = !!cursor; check(); });
        });
        if (result.code !== 'COLLISION') return result;
      }
      return fail('COLLISION', 'No unique job/revision ID was available after five attempts. Existing data was preserved.');
    } catch (e) { return fail('VALIDATION', 'Job creation refused: ' + errorText(e)); }
  }
  async function save(jobId, expectedRevisionId, fields, addedLinks) {
    try {
      if (!validJobId(jobId) || !validRevisionId(expectedRevisionId)) return fail('VALIDATION', 'Valid job and expected revision IDs are required.');
      const prepared = prepare(fields, addedLinks, jobId); if (!prepared.ok) return prepared;
      let revisionId;
      try { revisionId = newId('jrev1_'); } catch (e) { return fail('UNAVAILABLE', errorText(e)); }
      const opened = await open(); if (!opened.ok) return opened;
      for (let attempt = 0; attempt < MAX_COLLISIONS; attempt++) {
        if (attempt) { try { revisionId = newId('jrev1_'); } catch (e) { return fail('UNAVAILABLE', errorText(e)); } }
        const result = await transact(opened.db, 'readwrite', (tx, context) => {
          loadJob(tx, context, jobId, (current) => {
            if (!current.ok) { context.abort(current); return; }
            // Compare inside the same transaction, before even the unchanged optimization.
            if (current.job.head.currentRevisionId !== expectedRevisionId) { context.abort(fail('CONFLICT', 'This job card has a newer revision. Your draft was not saved.', { currentRevisionId: current.job.head.currentRevisionId })); return; }
            // A collision with the current revision is retryable, not a model-validation error.
            if (revisionId === current.job.head.currentRevisionId) { context.abort(fail('COLLISION', 'The generated revision ID already exists.')); return; }
            const made = Model.createNextRevision(current.job.revision, prepared.fields, prepared.links, { revisionId, savedAt: prepared.savedAt });
            if (!made.ok) { context.abort(made); return; }
            if (made.unchanged) { context.finish({ ok: true, job: current.job, unchanged: true }); return; }
            if (current.revisions.length >= MAX_REVISIONS) { context.abort(fail('LIMIT', 'This card has reached the history limit of ' + MAX_REVISIONS + ' revisions. No new revision was written.')); return; }
            const revision = made.revision; const head = headFor(revision);
            prospectiveGlobalLimits(tx, context, 0, () => {
              context.request(tx.objectStore('jobRevisions').add(revision), () => {});
              context.request(tx.objectStore('jobs').put(head), () => {});
              context.finish({ ok: true, job: { head, revision } });
            });
          });
        });
        if (result.code !== 'COLLISION') return result;
      }
      return fail('COLLISION', 'No unique revision ID was available after five attempts. Existing revisions were preserved.');
    } catch (e) { return fail('VALIDATION', 'Job save refused: ' + errorText(e)); }
  }
  async function readOperation(jobId, revisionId, kind) {
    try {
      if (!validJobId(jobId) || kind === 'historical' && !validRevisionId(revisionId)) return fail('VALIDATION', 'Valid job/revision IDs are required.');
      const opened = await open(); if (!opened.ok) return opened;
      return await transact(opened.db, 'readonly', (tx, context) => {
        loadJob(tx, context, jobId, (result) => {
          if (!result.ok) { context.finish(result); return; }
          if (kind === 'history') { context.finish({ ok: true, revisions: result.revisions }); return; }
          if (kind === 'historical') {
            const revision = result.revisions.find((item) => item.revisionId === revisionId);
            context.finish(revision ? { ok: true, revision } : fail('NOT_FOUND', 'This revision is not part of the requested card.')); return;
          }
          context.finish({ ok: true, job: result.job });
        });
      });
    } catch (e) { return storageError(e, 'Job card could not be read'); }
  }
  async function list() {
    try {
      const opened = await open(); if (!opened.ok) return opened;
      return await transact(opened.db, 'readonly', (tx, context) => {
        const jobs = []; const problems = []; const headIds = new Set(); let seen = 0;
        function finish() {
          if (context.failed) return;
          jobs.sort((a, b) => a.revision.savedAt === b.revision.savedAt ? a.head.jobId.localeCompare(b.head.jobId) : a.revision.savedAt > b.revision.savedAt ? -1 : 1);
          problems.sort((a, b) => a.jobId.localeCompare(b.jobId));
          context.finish({ ok: true, jobs, problems });
        }
        function auditUnattached() {
          const revisions = tx.objectStore('jobRevisions'); const index = revisions.index('byJobId');
          let total; let indexed; let ready = 0; let distinct = 0;
          function checked() {
            if (++ready !== 3 || context.failed) return;
            if (!Number.isSafeInteger(total) || !Number.isSafeInteger(indexed) || total < 0 || indexed < 0 || indexed > total) { context.abort(fail('CORRUPT', 'The revision/index counts are inconsistent.')); return; }
            if (total > MAX_JOBS * MAX_REVISIONS) { context.abort(fail('LIMIT', 'The stored revision collection exceeds the supported inspection limit. No partial success was presented.')); return; }
            if (indexed !== total) problems.push({ jobId: '', code: 'CORRUPT', problems: ['Some saved revisions have no indexable job identity and could not be assigned to a card. Their stored values were preserved.'] });
            finish();
          }
          context.request(revisions.count(), (value) => { total = value; checked(); });
          context.request(index.count(), (value) => { indexed = value; checked(); });
          // One row per indexed job identity; do not retain every full revision globally.
          context.request(index.openCursor(undefined, 'nextunique'), (cursor) => {
            if (!cursor) { checked(); return; }
            if (++distinct > MAX_JOBS) { context.abort(fail('LIMIT', 'The stored revision identities exceed the supported limit of ' + MAX_JOBS + '. No partial success was presented.')); return; }
            const jobId = cursor.key;
            if (!validJobId(jobId)) problems.push({ jobId: String(jobId), code: 'CORRUPT', problems: ['Saved revisions have an unsupported indexed job identity. Their stored values were preserved.'] });
            else if (!headIds.has(jobId)) problems.push({ jobId, code: 'CORRUPT', problems: ['Saved revisions exist without a current job head. No replacement head was created.'] });
            cursor.continue();
          });
        }
        context.request(tx.objectStore('jobs').openCursor(), (cursor) => {
          if (!cursor) { auditUnattached(); return; }
          if (++seen > MAX_JOBS) { context.abort(fail('LIMIT', 'The listing exceeds ' + MAX_JOBS + ' job cards. No partial list was presented.')); return; }
          const jobId = cursor.primaryKey; const parsed = Model.readHead(cursor.value);
          if (validJobId(jobId)) headIds.add(jobId);
          if (!validJobId(jobId) || !parsed.ok || parsed.head.jobId !== jobId) {
            problems.push({ jobId: String(jobId), code: !parsed.ok && parsed.code === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'CORRUPT', problems: parsed.ok ? ['Job head/key identity mismatch.'] : parsed.problems });
            cursor.continue(); return;
          }
          // Continue the head cursor only after this chain is validated, keeping at
          // most one bounded full history in memory within the coherent transaction.
          loadJob(tx, context, jobId, (result) => {
            if (result.code === 'LIMIT') { context.abort(result); return; }
            if (result.ok) jobs.push(result.job); else problems.push({ jobId, code: result.code, problems: result.problems });
            cursor.continue();
          });
        });
      });
    } catch (e) { return storageError(e, 'Job cards could not be listed'); }
  }

  return { create, save, list, read: (jobId) => readOperation(jobId, null, 'current'), history: (jobId) => readOperation(jobId, null, 'history'), readHistorical: (jobId, revisionId) => readOperation(jobId, revisionId, 'historical'), close };
}
module.exports = { DB_NAME, DB_VERSION, MAX_JOBS, MAX_REVISIONS, MAX_COLLISIONS, createJobStore };
