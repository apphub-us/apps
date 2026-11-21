'use strict';
/** LC-JOB-RESTORE-1. Non-atomic browser stores require a durable operation journal.
 * Write children and results first; publish job head LAST. On failure attempt
 * verified compensating rollback; on unexpected shutdown expose Recover before
 * another restore. Never overwrite pre-existing keys, migrate or remap IDs. */
const Restore = require('./jobRestore.js');
const Archive = require('./jobArchive.js');
const Source = require('./jobArchiveSource.js');
const Media = require('./jobPhotoFile.js');
const fail = (code, message, extra) => Object.assign({ ok: false, code, problems: [message] }, extra || {});
const DB = 'empire_code_restore_operations', OP = 'operations', VERSION = 1;
const ORDER = ['empire_code_measurements', 'empire_code_materials', 'empire_code_photos', 'empire_code_jobs'];
const KEY = { jobs: 'jobId', jobRevisions: 'revisionId', revisions: 'revisionId', assets: 'photoId' };
function code(error) { const n = error && error.name; return n === 'QuotaExceededError' ? 'QUOTA' : n === 'ConstraintError' ? 'CONFLICT' : n === 'VersionError' ? 'UNSUPPORTED' : n === 'AbortError' ? 'ABORTED' : 'UNAVAILABLE'; }
function snapshot(plan) {
  const rows = {};
  for (const [name, stores] of Object.entries(plan.records)) {
    rows[name] = {};
    for (const [store, entries] of Object.entries(stores)) rows[name][store] = entries.map(entry => store === 'assets' ?
      { kind: entry.kind, recordVersion: entry.recordVersion, photoId: entry.photoId, jobId: entry.jobId, file: entry.file } : entry);
  }
  return { jobId: plan.jobId, archiveId: plan.archiveId, state: 'pending', rows, results: plan.results };
}
function createRestoreStore(indexedDB, localStorage, options = {}) {
  const crypto = options.crypto;
  function open(name, schema, create) {
    return new Promise(resolve => {
      let request, finished = false, abandoned = false;
      const finish = r => { if (!finished) { finished = true; resolve(r); } };
      try {
        if (!indexedDB || typeof indexedDB.open !== 'function') return finish(fail('UNAVAILABLE', 'IndexedDB is unavailable.'));
        request = indexedDB.open(name, 1);
        request.onblocked = () => { abandoned = true; finish(fail('BLOCKED', 'Another browser tab blocks access to ' + name + '.')); };
        request.onupgradeneeded = event => {
          if (abandoned || finished || event.oldVersion !== 0 || request.result.objectStoreNames.length !== 0) { try { request.transaction.abort(); } catch (_) {} return; }
          try {
            if (!create) { request.transaction.abort(); return; }
            for (const [storeName, [key, indexes]] of Object.entries(schema)) {
              const store = request.result.createObjectStore(storeName, { keyPath: key });
              for (const [indexName, field] of indexes) store.createIndex(indexName, field, { unique: false });
            }
          } catch (_) { try { request.transaction.abort(); } catch (_) {} }
        };
        request.onerror = () => finish(fail('UNAVAILABLE', 'Cannot open browser database ' + name + '.'));
        request.onsuccess = () => {
          const db = request.result;
          if (finished || abandoned) { db.close(); return; }
          if (db.version !== 1 || db.objectStoreNames.length !== Object.keys(schema).length || Object.keys(schema).some(n => !db.objectStoreNames.contains(n))) { db.close(); return finish(fail('UNSUPPORTED', 'Unsupported database schema: ' + name + '.')); }
          try {
            const tx = db.transaction(Object.keys(schema), 'readonly');
            for (const [n, [key, indexes]] of Object.entries(schema)) {
              const s = tx.objectStore(n);
              if (s.keyPath !== key || s.autoIncrement || s.indexNames.length !== indexes.length) throw Error();
              for (const [idx, field] of indexes) { const i = s.index(idx); if (i.keyPath !== field || i.unique || i.multiEntry) throw Error(); }
            }
          } catch (_) { db.close(); return finish(fail('UNSUPPORTED', 'Incompatible object-store/index structure in ' + name + '.')); }
          db.onversionchange = () => db.close(); finish({ ok: true, db });
        };
      } catch (_) { finish(fail('UNAVAILABLE', 'Database opening failed.')); }
    });
  }
  async function transact(db, names, mode, action) {
    return new Promise(resolve => {
      let tx, failed, data, settled = false;
      const abort = r => { failed = r; try { tx.abort(); } catch (_) { if (!settled) { settled = true; resolve(r); } } };
      try {
        tx = db.transaction(names, mode);
        tx.oncomplete = () => { if (!settled) { settled = true; resolve(failed || { ok: true, value: data }); } };
        tx.onabort = () => { if (!settled) { settled = true; resolve(failed || fail(code(tx.error), 'Storage transaction aborted.')); } };
        tx.onerror = () => { if (!failed) failed = fail(code(tx.error), 'Storage request failed.'); };
        const ctx = { abort, done(v) { data = v; }, request(r, onSuccess) {
          r.onsuccess = () => { if (!failed) { try { onSuccess(r.result); } catch (_) { abort(fail('CORRUPT', 'Transaction callback refused.')); } } };
          r.onerror = () => { if (!failed) failed = fail(code(r.error), 'Storage request refused.'); };
        } };
        action(tx, ctx);
      } catch (_) { if (tx) abort(fail('UNAVAILABLE', 'Cannot start transaction.')); else resolve(fail('UNAVAILABLE', 'Cannot start transaction.')); }
    });
  }
  async function openedAll() {
    const dbs = {};
    for (const name of [...ORDER, DB]) {
      const schema = name === DB ? { operations: ['jobId', []] } : Source.SCHEMAS[name];
      const r = await open(name, schema, true);
      if (!r.ok) { Object.values(dbs).forEach(d => d.close()); return r; }
      dbs[name] = r.db;
    }
    return { ok: true, dbs };
  }
  async function pendingIn(db) {
    const r = await transact(db, [OP], 'readonly', (tx, c) => { const rows = []; c.request(tx.objectStore(OP).openCursor(), cursor => { if (!cursor) { c.done(rows); return; } if (rows.length > 4) { c.abort(fail('LIMIT', 'Too many pending restores; manual review required.')); return; } rows.push(cursor.value); cursor.continue(); }); });
    return r.ok ? { ok: true, rows: r.value } : r;
  }
  function storage() { try { if (!localStorage || !localStorage.getItem || !localStorage.setItem || !localStorage.removeItem) throw Error(); return true; } catch (_) { return false; } }
  async function keysAbsent(dbs, plan) {
    for (const [name, stores] of Object.entries(plan.records)) {
      const r = await transact(dbs[name], Object.keys(stores), 'readonly', (tx, ctx) => {
        let waiting = 0;
        for (const [storeName, entries] of Object.entries(stores)) for (const entry of entries) {
          waiting++;const key = entry[KEY[storeName]];
          ctx.request(tx.objectStore(storeName).get(key), v => {
            if (v !== undefined) { ctx.abort(fail('EXISTS', 'An archived ID is already stored. Restore will never overwrite existing records.')); return; }
            if (!--waiting) ctx.done(true);
          });
        }
        if (!waiting) ctx.done(true);
      });
      if (!r.ok) return r;
      // Existing stores can be at their global application limits.
      for (const [s, entries] of Object.entries(stores)) {
        const max = name === 'empire_code_photos' ? s === 'assets' ? 500 : 10000 :
          name === 'empire_code_jobs' ? s === 'jobs' ? 500 : 500000 : 50000;
        const count = await transact(dbs[name], [s], 'readonly', (tx,ctx) => ctx.request(tx.objectStore(s).count(), n => ctx.done(n)));
        if (!count.ok) return count;
        if (count.value + entries.length > max) return fail('LIMIT', 'The target browser store lacks supported capacity: ' + name + '/' + s + '.');
      }
    }
    for (const entry of plan.results) {
      let v; try { v = localStorage.getItem(entry.key); } catch (_) { return fail('UNAVAILABLE', 'Cannot inspect saved results.'); }
      if (v !== null) return fail('EXISTS', 'An archived saved-result ID already exists. No records were replaced.');
    }
    return { ok: true };
  }
  async function addRows(db, stores) {
    return transact(db, Object.keys(stores), 'readwrite', (tx, ctx) => {
      for (const [name, entries] of Object.entries(stores)) for (const row of entries) ctx.request(tx.objectStore(name).add(row), () => {});
      ctx.done(true);
    });
  }
  async function removeRows(db, stores) {
    // Refuse cleanup when any resident row has changed; do not delete user-modified data.
    for (const [name, expected] of Object.entries(stores)) {
      const r = await transact(db, [name], 'readonly', (tx,ctx) => {
        const hits = [];let remaining=expected.length;
        for (const row of expected) ctx.request(tx.objectStore(name).get(row[KEY[name]]), x => { hits.push([row,x]); if (!--remaining) ctx.done(hits); });
        if (!remaining) ctx.done(hits);
      });
      if (!r.ok) return r;
      for (const [row, actual] of r.value) {
        if (actual === undefined) continue;
        const comparable = name === 'assets' ? { kind: actual.kind, recordVersion: actual.recordVersion, photoId: actual.photoId, jobId: actual.jobId, file: actual.file } : actual;
        if (Archive.canonical(comparable) !== Archive.canonical(row)) return fail('CLEANUP_BLOCKED', 'A staged record changed since restoration began. Refusing to delete it: ' + name + '.');
        if (name === 'assets') {
          const verify = await Media.verify(actual.blob, actual.file, crypto);
          if (!verify.ok) return fail('CLEANUP_BLOCKED', 'A photo no longer matches its staged original; it will not be deleted.');
        }
      }
    }
    return transact(db, Object.keys(stores), 'readwrite', (tx,ctx) => {
      for (const [name, entries] of Object.entries(stores)) for (const row of entries) ctx.request(tx.objectStore(name).delete(row[KEY[name]]), () => {});
      ctx.done(true);
    });
  }
  async function rollback(dbs, record) {
    for (const name of ORDER.slice().reverse()) { const r = await removeRows(dbs[name], record.rows[name]); if (!r.ok) return r; }
    for (const e of record.results) {
      try { const old = localStorage.getItem(e.key); if (old !== null && old !== e.raw) return fail('CLEANUP_BLOCKED', 'A staged result changed; refusing to remove it.'); if (old === e.raw) localStorage.removeItem(e.key); }
      catch (_) { return fail('CLEANUP_BLOCKED', 'Cannot remove staged result safely.'); }
    }
    return transact(dbs[DB], [OP], 'readwrite', (tx,ctx) => { ctx.request(tx.objectStore(OP).delete(record.jobId), () => {}); ctx.done(true); });
  }
  async function inspect() {
    const r = await open(DB, { operations: ['jobId', []] }, true); if (!r.ok) return r;
    try { const p = await pendingIn(r.db); return p.ok ? { ok: true, pending: p.rows.map(x => ({ jobId:x.jobId, archiveId:x.archiveId, state:x.state })) } : p; }
    finally { r.db.close(); }
  }
  async function recover() {
    if (!storage()) return fail('UNAVAILABLE', 'Saved-result storage is unavailable; cleanup cannot be safely verified.');
    if (!options.locks || typeof options.locks.request !== 'function') return fail('LOCK_UNAVAILABLE', 'A cross-tab restore lock is required for safe recovery.');
    return options.locks.request('empire-code-restore-v1', { mode:'exclusive', ifAvailable:true }, async lock => {
    if (!lock) return fail('BUSY', 'Another restoration or recovery is in progress.');
    const o = await openedAll(); if (!o.ok) return o;
    try {
      const p = await pendingIn(o.dbs[DB]); if (!p.ok) return p;
      for (const record of p.rows) {
        if (record.state === 'committed') {
          const cleared = await transact(o.dbs[DB],[OP],'readwrite',(tx,c)=>{c.request(tx.objectStore(OP).delete(record.jobId),()=>{});c.done(true);});
          if (!cleared.ok) return cleared;
        } else {
          const cleaned = await rollback(o.dbs, record); if (!cleaned.ok) return cleaned;
        }
      }
      return { ok:true, recovered:p.rows.length };
    } finally { Object.values(o.dbs).forEach(db => db.close()); }
    });
  }
  async function restore(decoded, approved) {
    if (approved !== true) return fail('CONFIRMATION', 'Explicit confirmation is required before restoring into live browser storage.');
    if (!storage()) return fail('UNAVAILABLE', 'Local saved-result storage is inaccessible.');
    const plan = Restore.plan(decoded); if (!plan.ok) return plan;
    for (const a of plan.records.empire_code_photos.assets) {
      const verified = await Media.verify(a.blob, a.file, crypto);
      if (!verified.ok) return verified;
    }
    // Web Locks coordinate multiple tabs using this restore implementation.
    if (!options.locks || typeof options.locks.request !== 'function') return fail('LOCK_UNAVAILABLE', 'This browser does not provide a cross-tab restore lock. No live records were written.');
    return options.locks.request('empire-code-restore-v1', { mode:'exclusive', ifAvailable:true }, async lock => {
      if (!lock) return fail('BUSY', 'Another restoration is in progress.');
      const opened = await openedAll(); if (!opened.ok) return opened;
      const dbs = opened.dbs;
      try {
        const p = await pendingIn(dbs[DB]); if (!p.ok) return p;
        if (p.rows.length) return fail('RECOVERY_REQUIRED', 'An interrupted restore is recorded. Run Recover interrupted restore before importing anything else.');
        const available = await keysAbsent(dbs, plan); if (!available.ok) return available;
        const marker = snapshot(plan);
        const staged = await transact(dbs[DB], [OP], 'readwrite', (tx,ctx) => { ctx.request(tx.objectStore(OP).add(marker), () => {}); ctx.done(true); });
        if (!staged.ok) return staged;
        let failure = null;
        try {
          for (const e of plan.results) {
            if (localStorage.getItem(e.key) !== null) { failure = fail('EXISTS', 'Saved-result ID became occupied during restore.'); break; }
            localStorage.setItem(e.key, e.raw);
          }
          if (!failure) for (const name of ORDER) {
            const result = await addRows(dbs[name], plan.records[name]);
            if (!result.ok) { failure = result; break; }
            if (typeof options.step === 'function') await options.step(name);
          }
        } catch (_) { failure = fail('UNAVAILABLE', 'Restore was interrupted while writing. Recovery is required if cleanup cannot complete.'); }
        if (failure) {
          const cleaned = await rollback(dbs, marker);
          return cleaned.ok ? fail(failure.code, failure.problems[0] + ' All staged records were rolled back; existing records remained untouched.') :
            fail('RECOVERY_REQUIRED', failure.problems[0] + ' Cleanup could not complete: ' + cleaned.problems.join(' ') + ' Keep the archive and run recovery.', { originalCode: failure.code });
        }
        const finished = await transact(dbs[DB], [OP], 'readwrite', (tx,ctx) => {ctx.request(tx.objectStore(OP).put({...marker,state:'committed'}),()=>{});ctx.done(true);});
        if (!finished.ok) return fail('RECOVERY_REQUIRED', 'All records were written but commit confirmation is unavailable. Run recovery before another restore.');
        const cleared = await transact(dbs[DB],[OP],'readwrite',(tx,ctx)=>{ctx.request(tx.objectStore(OP).delete(marker.jobId),()=>{});ctx.done(true);});
        return { ok:true, jobId: plan.jobId, archiveId:plan.archiveId, summary:plan.summary, journalCleanupPending:!cleared.ok };
      } finally { Object.values(dbs).forEach(db => db.close()); }
    });
  }
  return { inspect, recover, restore };
}
module.exports = { DB, VERSION, createRestoreStore };
