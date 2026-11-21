'use strict';
/** Append-only material journal, separate from the unchanged job database.
 * Current revision is derived only from a validated complete chain. All reads
 * and writes resolve on transaction completion; request success is not commit. */
const Model = require('./jobMaterial.js');
const Job = require('./jobCard.js');
const DB_NAME = 'empire_code_materials', DB_VERSION = 1, STORE = 'revisions';
const fail = (code, p, extra) => Object.assign({ ok: false, code, problems: Array.isArray(p) ? p : [p] }, extra || {});
function err(e) { let n; try { n = e && e.name; } catch (_) {} return fail(n === 'QuotaExceededError' ? 'QUOTA' : n === 'VersionError' ? 'UNSUPPORTED' : n === 'ConstraintError' ? 'COLLISION' : n === 'AbortError' ? 'ABORTED' : 'UNAVAILABLE', 'Material storage operation failed' + (n ? ' (' + n + ').' : '.')); }
const validJob = id => typeof id === 'string' && Model.JOB_ID.test(id);
function createMaterialStore(indexedDB, options) {
  const opts = options || {}; let db = null, pending = null, closed = false;
  const unavailable = () => fail('UNAVAILABLE', 'Material storage is unavailable. Reopen the app to reconnect.');
  function closeDb(value) { try { if (value) value.close(); } catch (_) {} }
  function close() { closed = true; if (pending && pending.cancel) pending.cancel(); closeDb(db); db = null; }
  function open() {
    if (closed) return Promise.resolve(unavailable());
    if (db) return Promise.resolve({ ok: true, db }); if (pending) return pending.promise;
    const holder = {}; pending = holder;
    holder.promise = new Promise(resolve => {
      let done = false, abandoned = false, req, upgradeFailure;
      const finish = result => { if (!done) { done = true; if (pending === holder) pending = null; resolve(result); } };
      holder.cancel = () => { abandoned = true; finish(unavailable()); };
      try {
        if (!indexedDB || typeof indexedDB.open !== 'function') { finish(unavailable()); return; }
        req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onblocked = () => { abandoned = true; finish(fail('BLOCKED', 'Another tab is blocking material storage. Close it and retry.')); };
        req.onupgradeneeded = e => {
          if (done || abandoned || closed) { try { req.transaction.abort(); } catch (_) {} return; }
          try {
            if (e.oldVersion !== 0 || req.result.objectStoreNames.length !== 0) { upgradeFailure = fail('UNSUPPORTED', 'Material database migration is not supported. Data was left intact.'); req.transaction.abort(); return; }
            const store = req.result.createObjectStore(STORE, { keyPath: 'revisionId' });
            store.createIndex('byJobId', 'jobId', { unique: false }); store.createIndex('byMaterialId', 'materialId', { unique: false });
          } catch (error) { upgradeFailure = err(error); try { req.transaction.abort(); } catch (_) {} }
        };
        req.onerror = () => finish(upgradeFailure || err(req.error));
        req.onsuccess = () => {
          const value = req.result;
          if (done || abandoned || closed) { closeDb(value); finish(unavailable()); return; }
          if (value.version !== DB_VERSION || value.objectStoreNames.length !== 1 || !value.objectStoreNames.contains(STORE)) { closeDb(value); finish(fail('CORRUPT', 'Unsupported material database structure. No repair was attempted.')); return; }
          db = value; db.onversionchange = close; db.onclose = () => { if (db === value) { db = null; closed = true; } }; finish({ ok: true, db });
        };
      } catch (error) { finish(err(error)); }
    }); return holder.promise;
  }
  function transaction(connection, mode, action) {
    if (closed || connection !== db) return Promise.resolve(unavailable());
    return new Promise(resolve => {
      let tx, outcome, failure, settled = false;
      const ctx = {
        failed: false,
        finish(value) { if (!ctx.failed) outcome = value; },
        abort(value) { if (settled || ctx.failed) return; failure = value; ctx.failed = true; try { tx.abort(); } catch (_) { settled = true; resolve(failure); } },
        request(request, callback) {
          request.onsuccess = () => { if (!settled && !ctx.failed) { try { callback(request.result); } catch (e) { ctx.abort(err(e)); } } };
          request.onerror = () => { failure = err(request.error); ctx.failed = true; };
        }
      };
      try {
        tx = connection.transaction([STORE], mode);
        tx.oncomplete = () => { if (!settled) { settled = true; resolve(failure || outcome || fail('CORRUPT', 'Transaction completed without a valid material result.')); } };
        tx.onabort = () => { if (!settled) { settled = true; resolve(failure || err(tx.error || { name: 'AbortError' })); } };
        tx.onerror = e => { if (!failure) failure = err(tx.error || e && e.target && e.target.error); };
        const store = tx.objectStore(STORE);
        if (store.keyPath !== 'revisionId' || store.autoIncrement || store.indexNames.length !== 2 || !['byJobId', 'byMaterialId'].every(n => store.indexNames.contains(n))) { ctx.abort(fail('CORRUPT', 'Unsupported material store schema.')); return; }
        for (const [name, key] of [['byJobId', 'jobId'], ['byMaterialId', 'materialId']]) { const index = store.index(name); if (index.keyPath !== key || index.unique || index.multiEntry) { ctx.abort(fail('CORRUPT', 'Unsupported material index schema.')); return; } }
        action(store, ctx);
      } catch (e) { if (tx) ctx.abort(err(e)); else { settled = true; resolve(err(e)); } }
    });
  }
  function load(store, ctx, jobId, done) {
    let total, indexedJobs, indexedMaterials, ready = 0; const rows = [];
    function check() {
      if (++ready !== 4 || ctx.failed) return;
      if (![total, indexedJobs, indexedMaterials].every(n => Number.isSafeInteger(n) && n >= 0) || indexedJobs !== total || indexedMaterials !== total) { ctx.abort(fail('CORRUPT', 'Some stored material entries have invalid or missing links. Nothing was repaired or deleted.')); return; }
      if (total > Model.MAX_TOTAL_ROWS) { ctx.abort(fail('LIMIT', 'The material database exceeds its supported history limit.')); return; }
      const result = Model.assemble(rows, jobId); if (!result.ok) { ctx.abort(result); return; }
      done({ ok: true, materials: result.materials, rows, total });
    }
    ctx.request(store.count(), value => { total = value; check(); });
    ctx.request(store.index('byJobId').count(), value => { indexedJobs = value; check(); });
    ctx.request(store.index('byMaterialId').count(), value => { indexedMaterials = value; check(); });
    ctx.request(store.index('byJobId').openCursor(jobId), cursor => {
      if (!cursor) { check(); return; }
      if (rows.length >= Model.MAX_JOB_ROWS) { ctx.abort(fail('LIMIT', 'This job exceeds the material history limit; no partial list was returned.')); return; }
      const value = cursor.value;
      if (!value || value.revisionId !== cursor.primaryKey || value.jobId !== cursor.key) { ctx.abort(fail('CORRUPT', 'Material storage key does not match the record.')); return; }
      rows.push(value); cursor.continue();
    });
  }
  async function verifyJob(jobId) {
    try {
      if (typeof opts.readJob !== 'function') return fail('UNAVAILABLE', 'The linked job cannot be verified.');
      const result = await opts.readJob(jobId); if (!result || !result.ok || !result.job) return fail('JOB_UNAVAILABLE', 'The saved job is missing, unreadable or unavailable. Your material entry was not saved.');
      const head = Job.readHead(result.job.head), revision = Job.readRevision(result.job.revision);
      if (!head.ok || !revision.ok || head.head.jobId !== jobId || revision.revision.jobId !== jobId || head.head.currentRevisionId !== revision.revision.revisionId || head.head.revisionNumber !== revision.revision.revisionNumber) return fail('JOB_UNAVAILABLE', 'The linked job has inconsistent metadata.');
      return { ok: true, revisionId: revision.revision.revisionId };
    } catch (_) { return fail('JOB_UNAVAILABLE', 'The linked job could not be read.'); }
  }
  function randomId(prefix) {
    if (!opts.crypto || typeof opts.crypto.getRandomValues !== 'function') throw new Error('No secure randomness');
    const bytes = new Uint8Array(16); opts.crypto.getRandomValues(bytes); return prefix + Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  }
  async function write(jobId, materialId, expectedRevisionId, fields, reason) {
    try {
      if (!validJob(jobId) || materialId !== null && (typeof materialId !== 'string' || !Model.ID.test(materialId) || typeof expectedRevisionId !== 'string' || !Model.REV_ID.test(expectedRevisionId))) return fail('VALIDATION', 'Valid job and material IDs are required.');
      const checked = Model.validateFields(fields); if (!checked.ok) return checked;
      if (typeof reason !== 'string' || reason.length > 1000) return fail('VALIDATION', 'Change explanation must be text up to 1000 characters.');
      // Independent field copy is captured before the first await.
      const input = checked.fields, capturedReason = reason;
      let id = materialId || randomId('mat1_'), revisionId = randomId('trev1_');
      const job = await verifyJob(jobId); if (!job.ok) return job;
      const opened = await open(); if (!opened.ok) return opened;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt) { id = materialId || randomId('mat1_'); revisionId = randomId('trev1_'); }
        const savedAt = typeof opts.now === 'function' ? opts.now() : new Date().toISOString();
        const result = await transaction(opened.db, 'readwrite', (store, ctx) => {
          load(store, ctx, jobId, ledger => {
            let made;
            if (materialId !== null) {
              const entry = ledger.materials.find(m => m.current.materialId === id);
              if (!entry) { ctx.abort(fail('NOT_FOUND', 'The material is not part of this job.')); return; }
              if (entry.current.revisionId !== expectedRevisionId) { ctx.abort(fail('CONFLICT', 'This entry was updated in another window. Your draft has been kept.', { currentRevisionId: entry.current.revisionId })); return; }
              if (revisionId === entry.current.revisionId) { ctx.abort(fail('COLLISION', 'Revision ID already exists.')); return; }
              made = Model.createUpdate(entry.current, input, capturedReason, { revisionId, jobRevisionId: job.revisionId, savedAt });
              if (made.ok && made.unchanged) { ctx.finish({ ok: true, revision: made.revision, unchanged: true }); return; }
            } else {
              if (ledger.materials.length >= Model.MAX_MATERIALS) { ctx.abort(fail('LIMIT', 'This job has reached the material-entry limit.')); return; }
              made = Model.createInitial(input, { materialId: id, revisionId, jobId, jobRevisionId: job.revisionId, savedAt });
            }
            if (!made.ok) { ctx.abort(made); return; }
            if (ledger.total >= Model.MAX_TOTAL_ROWS || ledger.rows.length >= Model.MAX_JOB_ROWS) { ctx.abort(fail('LIMIT', 'Material history limit reached. No new revision was saved.')); return; }
            function commit() { ctx.request(store.add(made.revision), () => {}); ctx.finish({ ok: true, revision: made.revision }); }
            if (materialId === null) ctx.request(store.index('byMaterialId').openCursor(id), cursor => { if (cursor) ctx.abort(fail('COLLISION', 'Material ID already exists.')); else commit(); });
            else {
              // Validate the global identity as well: a corrupt foreign-job row must not be adopted.
              let count = 0;
              ctx.request(store.index('byMaterialId').openCursor(id), cursor => { if (!cursor) { if (count !== made.revision.revisionNumber - 1) ctx.abort(fail('CORRUPT', 'Material history identity is inconsistent.')); else commit(); return; } if (++count > Model.MAX_REVISIONS || cursor.value.jobId !== jobId) { ctx.abort(fail('CORRUPT', 'A material ID is shared across incompatible job histories.')); return; } cursor.continue(); });
            }
          });
        });
        if (result.code !== 'COLLISION') return result;
      }
      return fail('COLLISION', 'Could not obtain a unique material ID after five attempts. No existing data was overwritten.');
    } catch (_) { return fail('UNAVAILABLE', 'Material save could not start. Verify secure randomness and storage availability.'); }
  }
  async function list(jobId) {
    if (!validJob(jobId)) return fail('VALIDATION', 'Valid job ID required.');
    const opened = await open(); if (!opened.ok) return opened;
    return transaction(opened.db, 'readonly', (store, ctx) => load(store, ctx, jobId, ledger => ctx.finish({ ok: true, materials: ledger.materials })));
  }
  async function read(jobId, materialId) {
    if (typeof materialId !== 'string' || !Model.ID.test(materialId)) return fail('VALIDATION', 'Valid material ID required.');
    const result = await list(jobId); if (!result.ok) return result;
    const entry = result.materials.find(m => m.current.materialId === materialId);
    return entry ? { ok: true, ...entry } : fail('NOT_FOUND', 'This material is not available for the selected job.');
  }
  return { create: (jobId, fields) => write(jobId, null, null, fields, ''), update: (jobId, materialId, expectedRevisionId, fields, reason) => write(jobId, materialId, expectedRevisionId, fields, reason), list, read, close };
}
module.exports = { DB_NAME, DB_VERSION, createMaterialStore };
