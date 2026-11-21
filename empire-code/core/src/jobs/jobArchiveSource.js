'use strict';
/** Read-only export source. No put/add/delete/clear, migrations or automatic missing-database creation.
 * Two passes detect observed changes across separate stores; this is NOT a multi-database transaction. */
const M = require('./jobArchive.js');
const Photo = require('./jobPhoto.js');
const Media = require('./jobPhotoFile.js');
const SCHEMAS = Object.freeze({
  empire_code_jobs: { jobs: ['jobId', []], jobRevisions: ['revisionId', [['byJobId', 'jobId']]] },
  empire_code_measurements: { revisions: ['revisionId', [['byJobId', 'jobId'], ['byMeasurementId', 'measurementId']]] },
  empire_code_materials: { revisions: ['revisionId', [['byJobId', 'jobId'], ['byMaterialId', 'materialId']]] },
  empire_code_photos: { assets: ['photoId', [['byJobId', 'jobId']]], revisions: ['revisionId', [['byJobId', 'jobId'], ['byPhotoId', 'photoId']]] }
});
const PREFIX = 'empire_code_service_result_v1:';
const fail = (code, text) => ({ ok: false, code, problems: [text] });
const close = db => { try { if (db) db.close(); } catch (_) { /* No repair */ } };
function check(options) { if (options.check && !options.check()) { const e = Error('Cancelled'); e.code = 'CANCELLED'; throw e; } }
function code(e) { try { return e && e.name === 'VersionError' ? 'UNSUPPORTED' : e && e.name === 'AbortError' ? 'ABORTED' : 'UNAVAILABLE'; } catch (_) { return 'UNAVAILABLE'; } }
/** Existing-only open: abort every upgradeneeded; on missing DB report absence, never persist a schema. */
function openExisting(indexedDB, name, options) {
  return new Promise(resolve => {
    let request, done = false, absent = false, abandoned = false;
    const finish = value => { if (!done) { done = true; resolve(value); } };
    try {
      check(options); if (!indexedDB || typeof indexedDB.open !== 'function') return finish(fail('UNAVAILABLE', 'Browser database access is unavailable.'));
      request = indexedDB.open(name);
      request.onblocked = () => { abandoned = true; finish(fail('BLOCKED', 'Another tab is blocking archive reads. Nothing was changed.')); };
      request.onupgradeneeded = event => { absent = event.oldVersion === 0; try { request.transaction.abort(); } catch (_) {} };
      request.onerror = () => { if (absent) finish({ ok: true, absent: true }); else finish(fail(code(request.error), 'Archive could not open ' + name + '.')); };
      request.onsuccess = () => {
        const db = request.result;
        if (done || abandoned || options.check && !options.check()) { close(db); finish(fail('CANCELLED', 'Archive read cancelled.')); return; }
        if (db.version !== 1) { close(db); finish(fail('UNSUPPORTED', 'Unsupported ' + name + ' database version. No migration was attempted.')); return; }
        db.onversionchange = () => close(db); finish({ ok: true, db });
      };
    } catch (e) { finish(fail(e.code || code(e), 'Archive database access failed.')); }
  });
}
async function readDatabase(indexedDB, name, jobId, options = {}) {
  const schema = SCHEMAS[name]; if (!schema) return fail('VALIDATION', 'Unknown archive source.');
  const opened = await openExisting(indexedDB, name, options); if (!opened.ok || opened.absent) return opened;
  const db = opened.db;
  try {
    return await new Promise(resolve => {
      let tx, settled = false, failure = null;
      const result = { ok: true, data: {} };
      const abort = r => { failure = r; try { tx.abort(); } catch (_) { if (!settled) { settled = true; resolve(r); } } };
      const on = (r, fn) => { r.onsuccess = () => { if (failure || settled) return; try { check(options); fn(r.result); } catch (e) { abort(fail(e.code || 'CORRUPT', 'Archive source read failed.')); } }; r.onerror = () => { failure = fail(code(r.error), 'Archive source request failed.'); }; };
      try {
        check(options); const names = Object.keys(schema);
        if (db.objectStoreNames.length !== names.length || !names.every(n => db.objectStoreNames.contains(n))) { close(db); resolve(fail('CORRUPT', 'Archive source schema is unsupported.')); return; }
        tx = db.transaction(names, 'readonly');
        tx.oncomplete = () => { if (!settled) { settled = true; try { check(options); resolve(failure || result); } catch (_) { resolve(fail('CANCELLED', 'Archive read cancelled.')); } } };
        tx.onabort = () => { if (!settled) { settled = true; resolve(failure || fail('ABORTED', 'Archive read transaction aborted.')); } };
        tx.onerror = e => { failure = failure || fail(code(tx.error || e.target.error), 'Archive read transaction failed.'); };
        for (const n of names) {
          const store = tx.objectStore(n), [keyPath, indexes] = schema[n];
          if (store.keyPath !== keyPath || store.autoIncrement !== false || store.indexNames.length !== indexes.length) { abort(fail('CORRUPT', 'Archive source store is unsupported.')); return; }
          for (const [indexName, field] of indexes) {
            if (!store.indexNames.contains(indexName)) { abort(fail('CORRUPT', 'Archive source index is missing.')); return; }
            const index = store.index(indexName);
            if (index.keyPath !== field || index.unique || index.multiEntry) { abort(fail('CORRUPT', 'Archive source index schema is unsupported.')); return; }
          }
          if (n === 'jobs') { on(store.get(jobId), value => { result.data.head = value; }); continue; }
          const rows = []; result.data[n] = rows;
          const max = n === 'assets' ? 100 : name === 'empire_code_jobs' || name === 'empire_code_photos' ? 1000 : 2000;
          let total, indexed, counts = 0;
          const countCheck = () => { if (++counts === 2 && (!Number.isSafeInteger(total) || total < 0 || total !== indexed)) abort(fail('CORRUPT', 'Unindexed records exist in ' + name + '; refusing an apparently complete export.')); };
          on(store.count(), value => { total = value; countCheck(); }); on(store.index('byJobId').count(), value => { indexed = value; countCheck(); });
          on(store.index('byJobId').openCursor(jobId), cursor => {
            if (!cursor) return;
            if (rows.length >= max) { abort(fail('LIMIT', 'Archive source exceeds its per-job history limit.')); return; }
            const v = cursor.value;
            if (!v || v.jobId !== jobId || cursor.key !== jobId || cursor.primaryKey !== v[keyPath]) { abort(fail('CORRUPT', 'Archive source key and record disagree.')); return; }
            rows.push(v); cursor.continue();
          });
        }
      } catch (e) { if (tx) abort(fail(e.code || code(e), 'Archive read could not start.')); else { settled = true; resolve(fail(e.code || code(e), 'Archive read could not start.')); } }
    });
  } finally { close(db); }
}
async function collect(options, jobId) {
  const data = {};
  for (const name of Object.keys(SCHEMAS)) { check(options); const r = await readDatabase(options.indexedDB, name, jobId, options); if (!r.ok) return r; data[name] = r.absent ? null : r.data; }
  const j = data.empire_code_jobs;
  if (!j || !j.head) return fail('JOB_UNAVAILABLE', 'The saved job is missing. No archive was created.');
  const job = { head: j.head, revisions: j.jobRevisions }, checkedJob = M.readJob(job); if (!checkedJob.ok) return checkedJob;
  const results = [];
  for (const link of checkedJob.revisions[checkedJob.revisions.length - 1].serviceResultLinks) {
    check(options); let raw;
    try { raw = options.localStorage.getItem(PREFIX + link.serviceResultId); } catch (_) { return fail('UNAVAILABLE', 'Linked result storage is inaccessible, not necessarily empty.'); }
    if (!(raw === null || typeof raw === 'string' && raw.length <= M.MAX_RAW_RESULT_TEXT)) return fail('LIMIT', 'A linked result is not readable as bounded text.');
    results.push({ serviceResultId: link.serviceResultId, raw });
  }
  const photos = data.empire_code_photos || {}, originals = [], assets = []; let offset = 0;
  for (const a of photos.assets || []) {
    if (!M.shape(a, ['kind', 'recordVersion', 'photoId', 'jobId', 'file', 'blob']) || a.kind !== Photo.ASSET_KIND || a.recordVersion !== 1) return fail('CORRUPT', 'Original photo record is unsupported.');
    const verified = await Media.verify(a.blob, a.file, options.crypto); if (!verified.ok) return verified;
    check(options); originals.push({ photoId: a.photoId, jobId: a.jobId, file: a.file, offset }); assets.push({ photoId: a.photoId, blob: verified.blob }); offset += a.file.bytes;
    if (offset > M.MAX_PHOTO_BYTES) return fail('LIMIT', 'Job originals exceed 200 MiB.');
  }
  return { ok: true, payload: { job, measurements: (data.empire_code_measurements || {}).revisions || [], materials: (data.empire_code_materials || {}).revisions || [], photoRevisions: photos.revisions || [], originals, results }, assets };
}
async function capture(options, jobId) {
  try {
    if (typeof jobId !== 'string' || !/^job1_[0-9a-f]{32}$/.test(jobId)) return fail('VALIDATION', 'Choose a saved job to export.');
    const now = () => options.now ? options.now() : new Date().toISOString();
    const startedAt = now(); check(options);
    const first = await collect(options, jobId); if (!first.ok) return first;
    if (!M.safeData(first.payload).ok) return fail('LIMIT', 'Archive metadata is too large.');
    const firstText = M.canonical(first.payload);
    if (new TextEncoder().encode(firstText).length > M.MAX_MANIFEST_BYTES) return fail('LIMIT', 'Archive metadata exceeds 32 MiB.');
    if (options.progress) options.progress('Verifying a second read of the saved job…');
    const second = await collect(options, jobId); if (!second.ok) return second;
    if (!M.safeData(second.payload).ok || firstText !== M.canonical(second.payload)) return fail('SOURCE_CHANGED', 'Saved data changed while the archive was being prepared. Retry after other edits finish.');
    check(options);
    if (!options.crypto || typeof options.crypto.getRandomValues !== 'function') return fail('UNAVAILABLE', 'Secure archive identity is unavailable.');
    const bytes = new Uint8Array(16); options.crypto.getRandomValues(bytes);
    const manifest = { kind: M.KIND, archiveVersion: M.VERSION, archiveId: 'archive1_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''), producer: { applicationRevision: 'LC-JOB-ARCHIVE-1', baseSourcePin: M.BASE_SOURCE_PIN }, capture: { startedAt, completedAt: now(), consistency: 'two_read_stability_check' }, ...JSON.parse(firstText) };
    const validated = M.validate(manifest); if (!validated.ok) return validated;
    return { ok: true, manifest, assets: first.assets, summary: validated.summary, warnings: validated.warnings };
  } catch (e) { return fail(e && e.code === 'CANCELLED' ? 'CANCELLED' : 'UNAVAILABLE', 'Archive collection failed or was cancelled. Existing data was not changed.'); }
}
module.exports = { PREFIX, SCHEMAS, readDatabase, collect, capture };
