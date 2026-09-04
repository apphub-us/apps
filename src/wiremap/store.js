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
/* V2-0: 1 -> 2. The upgrade is ADDITIVE — it creates `points` and
 * `connections` and touches nothing that already exists. A v1 database keeps
 * every job, sheet, annotation and image blob exactly as stored. */
const DB_VERSION = 2;

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
  /* ── V2-0: Point + Connection topology (job-owned) ────────────────────── */
  points: {
    keyPath: 'id',
    indexes: [
      { name: 'jobId', keyPath: 'jobId' },
      { name: 'sheetId', keyPath: 'sheetId' },              // sheet render + sheet cascade
      { name: 'jobId_type', keyPath: ['jobId', 'type'] }, // type within job
    ],
  },
  connections: {
    keyPath: 'id',
    indexes: [
      { name: 'jobId', keyPath: 'jobId' },
      { name: 'fromPointId', keyPath: 'fromPointId' },    // inspector + cascades, either end
      { name: 'toPointId', keyPath: 'toPointId' },
      // labelKey reuses the wire-label normalization; the compound index is the
      // job-wide Lookup path, the plain one keeps cross-job diagnostics cheap.
      { name: 'labelKey', keyPath: 'labelKey' },
      { name: 'jobId_labelKey', keyPath: ['jobId', 'labelKey'] },
    ],
  },
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
  // Despite the name (kept so existing callers and tests hold), this is the
  // one additive schema pass for EVERY version: it creates whichever stores
  // an older database lacks and leaves existing stores untouched. A v1 -> v2
  // upgrade therefore adds `points` and `connections` and nothing else.
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
  /**
   * Rewrite the order of a job's sheets in ONE transaction.
   *
   * Move-up/move-down previously issued one independent putSheet per sheet.
   * Each was its own transaction, so a failure partway through could leave two
   * sheets holding the same order permanently. This validates the whole list
   * first and then writes it all-or-nothing.
   *
   * @param {string} jobId
   * @param {string[]} orderedSheetIds every sheet of the job, in the new order
   */
  function reorderSheets(jobId, orderedSheetIds) {
    if (!jobId) return reject(ERR.BAD_ARGUMENT, 'reorderSheets requires a jobId');
    if (!Array.isArray(orderedSheetIds) || orderedSheetIds.length === 0) {
      return reject(ERR.BAD_ARGUMENT, 'reorderSheets requires a non-empty id list');
    }
    const seen = new Set();
    for (const id of orderedSheetIds) {
      if (!id || typeof id !== 'string') {
        return reject(ERR.BAD_ARGUMENT, 'reorderSheets requires string sheet ids');
      }
      if (seen.has(id)) {
        return reject(ERR.BAD_ARGUMENT, `reorderSheets received duplicate sheet id ${id}`);
      }
      seen.add(id);
    }

    return tx(['sheets'], 'readwrite', async (s) => {
      const records = [];
      for (const id of orderedSheetIds) {
        const sheet = await s.sheets.get(id);
        if (!sheet) {
          throw new StoreError(ERR.NOT_FOUND,
            `reorderSheets: sheet ${id} does not exist`, { sheetId: id });
        }
        if (sheet.jobId !== jobId) {
          throw new StoreError(ERR.BAD_ARGUMENT,
            `reorderSheets: sheet ${id} belongs to job ${sheet.jobId}, not ${jobId}`,
            { sheetId: id, jobId: sheet.jobId });
        }
        records.push(sheet);
      }
      // Every id validated before a single write happens, so a rejection
      // leaves the stored order exactly as it was.
      for (let i = 0; i < records.length; i++) {
        await s.sheets.put({ ...records[i], order: i });
      }
      return records.length;
    });
  }

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

  // ── V2-0: Points ─────────────────────────────────────────────────────
  /**
   * Insert or update a Point. The model validates shape; the parent checks
   * run INSIDE the write transaction so a sheet or job deleted concurrently
   * can never leave a Point pointing at nothing. Ownership is strict: the
   * sheet must exist and belong to the same job as the Point. Nothing is
   * repaired silently — a mismatch is an error.
   */
  function putPoint(point) {
    try { assertValid('point', point, model.validatePoint); } catch (e) { return Promise.reject(e); }
    return tx(['jobs', 'sheets', 'points'], 'readwrite', async (s) => {
      const job = await s.jobs.get(point.jobId);
      if (!job) {
        throw new StoreError(ERR.MISSING_PARENT,
          `point ${point.id} references job ${point.jobId}, which does not exist`,
          { pointId: point.id, jobId: point.jobId });
      }
      const sheet = await s.sheets.get(point.sheetId);
      if (!sheet) {
        throw new StoreError(ERR.MISSING_PARENT,
          `point ${point.id} references sheet ${point.sheetId}, which does not exist`,
          { pointId: point.id, sheetId: point.sheetId });
      }
      if (sheet.jobId !== point.jobId) {
        throw new StoreError(ERR.INVALID,
          `point ${point.id} is owned by job ${point.jobId} but its sheet belongs to job ${sheet.jobId}`,
          { pointId: point.id, jobId: point.jobId, sheetJobId: sheet.jobId });
      }
      return s.points.put(point);
    });
  }

  function getPoint(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'getPoint requires an id');
    return tx(['points'], 'readonly', (s) => s.points.get(id)).then((v) => v || null);
  }

  /** Oldest first by createdAt; id ascending breaks ties (as for annotations). */
  function byCreation(rows) {
    return rows.slice().sort((a, b) =>
      (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  function listPoints(sheetId) {
    if (!sheetId) return reject(ERR.BAD_ARGUMENT, 'listPoints requires a sheetId');
    return tx(['points'], 'readonly', (s) => s.points.getAllByIndex('sheetId', sheetId)).then(byCreation);
  }

  function listPointsByJob(jobId) {
    if (!jobId) return reject(ERR.BAD_ARGUMENT, 'listPointsByJob requires a jobId');
    return tx(['points'], 'readonly', (s) => s.points.getAllByIndex('jobId', jobId)).then(byCreation);
  }

  /**
   * Remove a Point AND every Connection touching it, in ONE transaction.
   * Storage never demands "disconnect first"; the confirmation belongs to UI.
   */
  function deletePoint(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'deletePoint requires an id');
    return tx(['points', 'connections'], 'readwrite', async (s) => {
      const point = await s.points.get(id);
      if (!point) return { deleted: false, points: 0, connections: 0 };
      const removed = await removeConnectionsTouching(s, [id]);
      await s.points.delete(id);
      return { deleted: true, points: 1, connections: removed };
    });
  }

  /** Delete every Connection whose either end is in `pointIds`. Returns the count. */
  async function removeConnectionsTouching(s, pointIds) {
    const seen = new Set();
    for (const pid of pointIds) {
      const outs = await s.connections.getAllByIndex('fromPointId', pid);
      const ins = await s.connections.getAllByIndex('toPointId', pid);
      for (const c of outs.concat(ins)) seen.add(c.id);
    }
    for (const cid of seen) await s.connections.delete(cid);
    return seen.size;
  }

  // ── V2-0: Connections ────────────────────────────────────────────────
  /**
   * Insert or update a Connection. Both endpoints must exist, differ, and
   * belong to the Connection's job — checked in the write transaction.
   * Cross-SHEET is valid (that is the point of job ownership); cross-JOB is
   * rejected and nothing is written.
   */
  function putConnection(connection) {
    try { assertValid('connection', connection, model.validateConnection); } catch (e) { return Promise.reject(e); }
    return tx(['jobs', 'points', 'connections'], 'readwrite', async (s) => {
      const job = await s.jobs.get(connection.jobId);
      if (!job) {
        throw new StoreError(ERR.MISSING_PARENT,
          `connection ${connection.id} references job ${connection.jobId}, which does not exist`,
          { connectionId: connection.id, jobId: connection.jobId });
      }
      for (const end of ['fromPointId', 'toPointId']) {
        const p = await s.points.get(connection[end]);
        if (!p) {
          throw new StoreError(ERR.MISSING_PARENT,
            `connection ${connection.id} ${end} ${connection[end]} does not exist`,
            { connectionId: connection.id, [end]: connection[end] });
        }
        if (p.jobId !== connection.jobId) {
          throw new StoreError(ERR.INVALID,
            `connection ${connection.id} ${end} belongs to job ${p.jobId}, not ${connection.jobId}`,
            { connectionId: connection.id, [end]: connection[end], pointJobId: p.jobId });
        }
      }
      return s.connections.put(connection);
    });
  }

  function getConnection(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'getConnection requires an id');
    return tx(['connections'], 'readonly', (s) => s.connections.get(id)).then((v) => v || null);
  }

  function listConnections(jobId) {
    if (!jobId) return reject(ERR.BAD_ARGUMENT, 'listConnections requires a jobId');
    return tx(['connections'], 'readonly', (s) => s.connections.getAllByIndex('jobId', jobId)).then(byCreation);
  }

  /** Every Connection with this Point at either end — one entity each, never duplicated. */
  function listConnectionsForPoint(pointId) {
    if (!pointId) return reject(ERR.BAD_ARGUMENT, 'listConnectionsForPoint requires a pointId');
    return tx(['connections'], 'readonly', async (s) => {
      const outs = await s.connections.getAllByIndex('fromPointId', pointId);
      const ins = await s.connections.getAllByIndex('toPointId', pointId);
      const byId = new Map();
      for (const c of outs.concat(ins)) byId.set(c.id, c);
      return Array.from(byId.values());
    }).then(byCreation);
  }

  /**
   * Job-wide lookup by label, through the SAME normalization as wire labels.
   * Duplicates are returned together. An empty/blank query matches nothing:
   * an unlabeled cable (labelKey '') is reachable by id, by endpoint and by
   * job, but never by label search.
   */
  function findConnectionsByLabel(jobId, label) {
    if (!jobId) return reject(ERR.BAD_ARGUMENT, 'findConnectionsByLabel requires a jobId');
    const key = model.toLabelKey(label);
    if (!key) return Promise.resolve([]);
    return tx(['connections'], 'readonly', (s) => s.connections.getAllByIndex('jobId_labelKey', [jobId, key]))
      .then(byCreation);
  }

  function deleteConnection(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'deleteConnection requires an id');
    return tx(['connections'], 'readwrite', (s) => s.connections.delete(id));
  }

  /**
   * Read-only preview for a future sheet-delete confirmation: how many Points
   * the sheet owns and how many Connections (including cross-sheet ones) would
   * go with them. Query-layer only; no UI here.
   */
  function sheetDeletionImpact(sheetId) {
    if (!sheetId) return reject(ERR.BAD_ARGUMENT, 'sheetDeletionImpact requires a sheetId');
    return tx(['sheets', 'points', 'connections'], 'readonly', async (s) => {
      const sheet = await s.sheets.get(sheetId);
      if (!sheet) return { exists: false, points: 0, connections: 0, crossSheetConnections: 0 };
      const pts = await s.points.getAllByIndex('sheetId', sheetId);
      const own = new Set(pts.map((p) => p.id));
      const seen = new Map();
      for (const p of pts) {
        const outs = await s.connections.getAllByIndex('fromPointId', p.id);
        const ins = await s.connections.getAllByIndex('toPointId', p.id);
        for (const c of outs.concat(ins)) seen.set(c.id, c);
      }
      let cross = 0;
      for (const c of seen.values()) if (!(own.has(c.fromPointId) && own.has(c.toPointId))) cross += 1;
      return { exists: true, points: pts.length, connections: seen.size, crossSheetConnections: cross };
    });
  }

  // ── Cascades ────────────────────────────────────────────────────────
  /**
   * Remove a sheet, its annotations and its image in ONE transaction.
   * Never "delete now, tidy up later": a failure mid-way must leave the sheet
   * exactly as it was.
   */
  function deleteSheet(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'deleteSheet requires an id');
    return tx(['sheets', 'annotations', 'images', 'points', 'connections'], 'readwrite', async (s) => {
      const sheet = await s.sheets.get(id);
      if (!sheet) return { deleted: false, sheets: 0, annotations: 0, images: 0, points: 0, connections: 0 };

      const kids = await s.annotations.getAllByIndex('sheetId', id);
      for (const a of kids) await s.annotations.delete(a.id);
      if (sheet.imageId) await s.images.delete(sheet.imageId);
      // V2-0: the sheet's Points go with it, and so does EVERY Connection that
      // touches them — including cross-sheet ones, whose far Point survives.
      const pts = await s.points.getAllByIndex('sheetId', id);
      const connections = await removeConnectionsTouching(s, pts.map((p) => p.id));
      for (const p of pts) await s.points.delete(p.id);
      await s.sheets.delete(id);

      return { deleted: true, sheets: 1, annotations: kids.length, images: sheet.imageId ? 1 : 0,
        points: pts.length, connections };
    });
  }

  /** Remove a job and everything beneath it in ONE transaction. */
  function deleteJob(id) {
    if (!id) return reject(ERR.BAD_ARGUMENT, 'deleteJob requires an id');
    return tx(['jobs', 'sheets', 'annotations', 'images', 'points', 'connections'], 'readwrite', async (s) => {
      const job = await s.jobs.get(id);
      if (!job) return { deleted: false, sheets: 0, annotations: 0, images: 0, points: 0, connections: 0 };

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
      // V2-0: topology is job-owned, so it is removed by job, not per sheet
      const conns = await s.connections.getAllByIndex('jobId', id);
      for (const c of conns) await s.connections.delete(c.id);
      const pts = await s.points.getAllByIndex('jobId', id);
      for (const p of pts) await s.points.delete(p.id);
      await s.jobs.delete(id);

      return { deleted: true, sheets: sheets.length, annotations, images, points: pts.length, connections: conns.length };
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
    putSheet, getSheet, listSheets, deleteSheet, reorderSheets,
    putAnnotation, getAnnotation, listAnnotations, deleteAnnotation,
    // V2-0 topology
    putPoint, getPoint, listPoints, listPointsByJob, deletePoint,
    putConnection, getConnection, listConnections, listConnectionsForPoint,
    findConnectionsByLabel, deleteConnection, sheetDeletionImpact,
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
