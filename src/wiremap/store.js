'use strict';
/**
 * Wire Map — persistence.
 *
 * Native IndexedDB in the browser. No library.
 *
 * WHY THE DRIVER IS INJECTABLE
 * ----------------------------
 * Node 22 ships no IndexedDB, and adding `fake-indexeddb` would put the first
 * dependency into a project that has none. So the raw IDB plumbing sits behind
 * one narrow driver interface. Production passes the native factory; tests pass
 * a small in-memory driver. Everything worth getting wrong — validation,
 * referential integrity, cascade deletes, ordering, transaction atomicity —
 * lives above that line and is exercised in Node.
 *
 * What this buys, and what it does not: the storage CONTRACT is tested; the
 * behaviour of a real IDB engine is not. See the WM-2 report.
 */

const model = require('./model');

const DB_NAME = 'empire-wiremap';
const DB_VERSION = 1;

const STORES = {
  jobs: {
    keyPath: 'id',
    indexes: [
      { name: 'updatedAt', keyPath: 'updatedAt' },
      { name: 'name', keyPath: 'name' },
    ],
  },
  sheets: {
    keyPath: 'id',
    indexes: [
      { name: 'jobId', keyPath: 'jobId' },
      { name: 'jobId_order', keyPath: ['jobId', 'order'] },
    ],
  },
  annotations: {
    keyPath: 'id',
    indexes: [
      { name: 'sheetId', keyPath: 'sheetId' },
      // labelKey powers the WM-7 search without scanning every annotation.
      { name: 'labelKey', keyPath: 'data.labelKey' },
      { name: 'sheetId_labelKey', keyPath: ['sheetId', 'data.labelKey'] },
    ],
  },
  // Present in v1 purely so WM-3 does not need a migration on day one.
  // WM-2 reads and writes no image content.
  images: { keyPath: 'id', indexes: [] },
  meta: { keyPath: 'key', indexes: [] },
};

const STORE_NAMES = Object.keys(STORES);

/** Structured failure. Callers branch on `code`, never on message text. */
class StoreError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const ERR = {
  UNAVAILABLE: 'INDEXEDDB_UNAVAILABLE',
  OPEN_FAILED: 'OPEN_FAILED',
  BLOCKED: 'OPEN_BLOCKED',
  NOT_OPEN: 'DATABASE_NOT_OPEN',
  INVALID: 'VALIDATION_FAILED',
  MISSING_PARENT: 'MISSING_PARENT',
  NOT_FOUND: 'NOT_FOUND',
  BAD_ARGUMENT: 'BAD_ARGUMENT',
};

// ── Native IndexedDB driver ───────────────────────────────────────────────

/**
 * Wrap a native IDBFactory in the narrow interface the store uses.
 * This is the only code that touches IDB request objects.
 */
function createNativeDriver(factory) {
  if (!factory) throw new StoreError(ERR.UNAVAILABLE, 'IndexedDB is not available in this environment');

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    open(name, version, applySchema) {
      return new Promise((resolve, reject) => {
        let req;
        try {
          req = factory.open(name, version);
        } catch (e) {
          reject(new StoreError(ERR.OPEN_FAILED, 'Could not open the database', String(e && e.message)));
          return;
        }
        // Another tab holds an older version open. Surface it instead of hanging.
        req.onblocked = () => reject(new StoreError(ERR.BLOCKED,
          'The database is blocked by another open connection'));
        req.onerror = () => reject(new StoreError(ERR.OPEN_FAILED,
          'Could not open the database', String(req.error && req.error.message)));
        req.onupgradeneeded = (event) => {
          applySchema({
            existing: Array.from(event.target.result.objectStoreNames),
            createStore(storeName, keyPath) {
              return wrapNativeStore(event.target.result.createObjectStore(storeName, { keyPath }));
            },
          });
        };
        req.onsuccess = () => {
          const db = req.result;
          // If another tab upgrades the schema, let go rather than operate on
          // a connection the browser is about to block.
          db.onversionchange = () => db.close();
          resolve({
            close() { db.close(); },
            withTransaction(storeNames, mode, work) {
              return new Promise((res, rej) => {
                let tx;
                try {
                  tx = db.transaction(storeNames, mode);
                } catch (e) {
                  rej(new StoreError(ERR.OPEN_FAILED, 'Could not start a transaction',
                    String(e && e.message)));
                  return;
                }
                let outcome;
                let failure = null;
                tx.oncomplete = () => (failure ? rej(failure) : res(outcome));
                tx.onabort = () => rej(failure
                  || new StoreError(ERR.OPEN_FAILED, 'Transaction aborted',
                    String(tx.error && tx.error.message)));
                tx.onerror = () => { /* surfaced through onabort */ };

                const ctx = {};
                for (const n of storeNames) ctx[n] = nativeStoreOps(tx.objectStore(n), request);

                Promise.resolve()
                  .then(() => work(ctx))
                  .then((value) => { outcome = value; })
                  .catch((err) => {
                    // Any rejection rolls the whole transaction back: a failed
                    // cascade must never leave a half-deleted job.
                    failure = err;
                    try { tx.abort(); } catch (_) { /* already finishing */ }
                  });
              });
            },
          });
        };
      });
    },
  };
}

function wrapNativeStore(objectStore) {
  return {
    createIndex(name, keyPath) {
      objectStore.createIndex(name, keyPath, { unique: false });
    },
  };
}

function nativeStoreOps(objectStore, request) {
  return {
    get: (key) => request(objectStore.get(key)),
    put: (value) => request(objectStore.put(value)).then(() => value),
    delete: (key) => request(objectStore.delete(key)),
    getAll: () => request(objectStore.getAll()),
    getAllByIndex: (indexName, query) => request(objectStore.index(indexName).getAll(query)),
  };
}

// ── Schema ────────────────────────────────────────────────────────────────

/**
 * Deterministic schema creation. Guarded by `existing`, so opening an already
 * created v1 database leaves the stores untouched.
 */
function applySchemaV1(upgrade) {
  for (const name of STORE_NAMES) {
    if (upgrade.existing.indexOf(name) !== -1) continue;
    const spec = STORES[name];
    const created = upgrade.createStore(name, spec.keyPath);
    for (const idx of spec.indexes) created.createIndex(idx.name, idx.keyPath);
  }
}

// ── Store ─────────────────────────────────────────────────────────────────

/**
 * @param {object} [options]
 * @param {object} [options.driver]  injected driver; defaults to native IndexedDB
 * @param {object} [options.factory] an IDBFactory, when supplying one explicitly
 * @param {string} [options.name]
 * @param {number} [options.version]
 */
function createStore(options) {
  const opts = options || {};
  const name = opts.name || DB_NAME;
  const version = opts.version || DB_VERSION;

  let driver = opts.driver || null;
  let conn = null;

  function resolveDriver() {
    if (driver) return driver;
    const factory = opts.factory
      || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
    if (!factory) {
      throw new StoreError(ERR.UNAVAILABLE,
        'IndexedDB is not available in this environment. Wire Map cannot store work here.');
    }
    driver = createNativeDriver(factory);
    return driver;
  }

  function requireOpen() {
    if (!conn) throw new StoreError(ERR.NOT_OPEN, 'openDatabase() must be called first');
    return conn;
  }

  async function openDatabase() {
    if (conn) return conn;
    conn = await resolveDriver().open(name, version, applySchemaV1);
    return conn;
  }

  function closeDatabase() {
    if (conn) { conn.close(); conn = null; }
  }

  /**
   * Every public method is async, so a closed database must REJECT rather than
   * throw synchronously — otherwise callers need both a try/catch and a .catch.
   */
  function tx(storeNames, mode, work) {
    let connection;
    try { connection = requireOpen(); } catch (e) { return Promise.reject(e); }
    return connection.withTransaction(storeNames, mode, work);
  }

  function reject(code, message, detail) {
    return Promise.reject(new StoreError(code, message, detail));
  }

  /** Validate with the model — never a second implementation here. */
  function assertValid(kind, entity, validator) {
    const result = validator(entity);
    if (!result.valid) {
      throw new StoreError(ERR.INVALID, `${kind} failed validation`, result.problems);
    }
  }

  // ── Jobs ────────────────────────────────────────────────────────────
  function putJob(job) {
    try { assertValid('job', job, model.validateJob); } catch (e) { return Promise.reject(e); }
    return tx(['jobs'], 'readwrite', (s) => s.jobs.put(job));
  }

  function getJob(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'getJob requires an id');
    return tx(['jobs'], 'readonly', (s) => s.jobs.get(id)).then((v) => v || null);
  }

  /** Newest first by updatedAt; id ascending breaks ties so order is stable. */
  function listJobs() {
    return tx(['jobs'], 'readonly', (s) => s.jobs.getAll()).then((rows) =>
      rows.slice().sort((a, b) =>
        (b.updatedAt - a.updatedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }

  // ── Sheets ──────────────────────────────────────────────────────────
  function putSheet(sheet) {
    try { assertValid('sheet', sheet, model.validateSheet); } catch (e) { return Promise.reject(e); }
    // The parent check and the write share one transaction, so a job deleted
    // concurrently cannot leave an orphan behind.
    return tx(['jobs', 'sheets'], 'readwrite', async (s) => {
      const parent = await s.jobs.get(sheet.jobId);
      if (!parent) {
        throw new StoreError(ERR.MISSING_PARENT,
          `sheet ${sheet.id} references job ${sheet.jobId}, which does not exist`,
          { sheetId: sheet.id, jobId: sheet.jobId });
      }
      return s.sheets.put(sheet);
    });
  }

  function getSheet(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'getSheet requires an id');
    return tx(['sheets'], 'readonly', (s) => s.sheets.get(id)).then((v) => v || null);
  }

  /** Ascending `order`; id ascending breaks ties. */
  function listSheets(jobId) {
    if (!jobId) return reject(ERR.BAD_ARGUMENT, 'listSheets requires a jobId');
    return tx(['sheets'], 'readonly', (s) => s.sheets.getAllByIndex('jobId', jobId))
      .then((rows) => rows.slice().sort((a, b) =>
        (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }

  // ── Annotations ─────────────────────────────────────────────────────
  function putAnnotation(annotation) {
    try {
      assertValid('annotation', annotation, model.validateAnnotation);
    } catch (e) { return Promise.reject(e); }
    return tx(['sheets', 'annotations'], 'readwrite', async (s) => {
      const parent = await s.sheets.get(annotation.sheetId);
      if (!parent) {
        throw new StoreError(ERR.MISSING_PARENT,
          `annotation ${annotation.id} references sheet ${annotation.sheetId}, which does not exist`,
          { annotationId: annotation.id, sheetId: annotation.sheetId });
      }
      return s.annotations.put(annotation);
    });
  }

  function getAnnotation(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'getAnnotation requires an id');
    return tx(['annotations'], 'readonly', (s) => s.annotations.get(id)).then((v) => v || null);
  }

  /**
   * Oldest first by createdAt; id ascending breaks ties.
   * Creation order matches the order the electrician placed the labels, which
   * is the least surprising thing to read back on site.
   */
  function listAnnotations(sheetId) {
    if (!sheetId) return reject(ERR.BAD_ARGUMENT, 'listAnnotations requires a sheetId');
    return tx(['annotations'], 'readonly', (s) => s.annotations.getAllByIndex('sheetId', sheetId))
      .then((rows) => rows.slice().sort((a, b) =>
        (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }

  function deleteAnnotation(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'deleteAnnotation requires an id');
    return tx(['annotations'], 'readwrite', (s) => s.annotations.delete(id));
  }

  // ── Cascades ────────────────────────────────────────────────────────
  /**
   * Remove a sheet, its annotations and its image in ONE transaction.
   * Never "delete now, tidy up later": a failure mid-way must leave the sheet
   * exactly as it was.
   */
  function deleteSheet(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'deleteSheet requires an id');
    return tx(['sheets', 'annotations', 'images'], 'readwrite', async (s) => {
      const sheet = await s.sheets.get(id);
      if (!sheet) return { deleted: false, sheets: 0, annotations: 0, images: 0 };

      const kids = await s.annotations.getAllByIndex('sheetId', id);
      for (const a of kids) await s.annotations.delete(a.id);
      if (sheet.imageId) await s.images.delete(sheet.imageId);
      await s.sheets.delete(id);

      return { deleted: true, sheets: 1, annotations: kids.length, images: sheet.imageId ? 1 : 0 };
    });
  }

  /** Remove a job and everything beneath it in ONE transaction. */
  function deleteJob(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'deleteJob requires an id');
    return tx(['jobs', 'sheets', 'annotations', 'images'], 'readwrite', async (s) => {
      const job = await s.jobs.get(id);
      if (!job) return { deleted: false, sheets: 0, annotations: 0, images: 0 };

      const sheets = await s.sheets.getAllByIndex('jobId', id);
      let annotations = 0;
      let images = 0;
      for (const sheet of sheets) {
        const kids = await s.annotations.getAllByIndex('sheetId', sheet.id);
        for (const a of kids) await s.annotations.delete(a.id);
        annotations += kids.length;
        if (sheet.imageId) { await s.images.delete(sheet.imageId); images += 1; }
        await s.sheets.delete(sheet.id);
      }
      await s.jobs.delete(id);

      return { deleted: true, sheets: sheets.length, annotations, images };
    });
  }

  // ── Meta ────────────────────────────────────────────────────────────
  function getMeta(key) {
    if (!key) return reject(ERR.BAD_ARGUMENT, 'getMeta requires a key');
    return tx(['meta'], 'readonly', (s) => s.meta.get(key))
      .then((row) => (row ? row.value : null));
  }

  function setMeta(key, value) {
    if (!key) return reject(ERR.BAD_ARGUMENT, 'setMeta requires a key');
    return tx(['meta'], 'readwrite', (s) => s.meta.put({ key, value })).then(() => value);
  }

  // ── Images ──────────────────────────────────────────────────────────
  // Persistence only. Decoding, resizing and encoding belong to image.js and
  // must never leak in here.
  //
  // A record looks like:
  //   { id, blob, mime, width, height, bytes, createdAt }
  function putImage(record) {
    if (!record || !record.id) return reject(ERR.BAD_ARGUMENT, 'an image record requires an id');
    if (!record.blob) return reject(ERR.BAD_ARGUMENT, 'an image record requires a blob');
    return tx(['images'], 'readwrite', (s) => s.images.put(record));
  }

  function getImage(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'getImage requires an id');
    return tx(['images'], 'readonly', (s) => s.images.get(id)).then((v) => v || null);
  }

  /**
   * Delete an image record directly. Cascades from deleteSheet/deleteJob remove
   * images too; this is for replacing a sheet's background.
   */
  function deleteImage(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'deleteImage requires an id');
    return tx(['images'], 'readwrite', (s) => s.images.delete(id));
  }

  return {
    openDatabase,
    closeDatabase,
    isOpen: () => conn !== null,
    putJob, getJob, listJobs, deleteJob,
    putSheet, getSheet, listSheets, deleteSheet,
    putAnnotation, getAnnotation, listAnnotations, deleteAnnotation,
    getMeta, setMeta,
    putImage, getImage, deleteImage,
    // Retained so WM-2 tests and any existing caller keep working.
    _putImageRecord: putImage,
    _getImageRecord: getImage,
  };
}

module.exports = {
  DB_NAME,
  DB_VERSION,
  STORES,
  STORE_NAMES,
  StoreError,
  ERR,
  applySchemaV1,
  createNativeDriver,
  createStore,
};
