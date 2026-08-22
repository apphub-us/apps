'use strict';
/**
 * A small in-memory driver implementing the narrow interface src/wiremap/store.js
 * expects. NOT a browser IndexedDB implementation and not trying to be one.
 *
 * Node 22 ships no IndexedDB and this project has zero dependencies, so rather
 * than pull in `fake-indexeddb` the store was written against an injectable
 * driver. This adapter substitutes for it in tests.
 *
 * What it faithfully models, because these are the properties the store's
 * correctness rests on:
 *   - keyPath addressing and index lookups, including compound key paths
 *   - transaction ATOMICITY: work happens on a copy, and a rejection discards
 *     every change, so a failed cascade cannot half-delete a job
 *   - schema creation guarded by which stores already exist
 *
 * What it does NOT model, and therefore what these tests do NOT prove:
 *   - real IDB key ordering, cursors, or key ranges
 *   - structured-clone semantics, Blob storage, quota behaviour
 *   - versionchange/blocked interactions between browser tabs
 * Those need a real browser. See the WM-2 report.
 */

/** Read a value by keyPath, including nested paths such as 'data.labelKey'. */
function readPath(obj, keyPath) {
  if (Array.isArray(keyPath)) return keyPath.map((k) => readPath(obj, k));
  return String(keyPath).split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

function sameKey(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function createMemoryDriver() {
  /** dbName -> { version, stores: Map<name, {keyPath, indexes, rows: Map}> } */
  const databases = new Map();
  const state = { openConnections: 0, transactions: 0, aborted: 0 };

  function driver() {
    return {
      open(name, version, applySchema) {
        let db = databases.get(name);
        if (!db) {
          db = { version: 0, stores: new Map() };
          databases.set(name, db);
        }
        if (db.version < version) {
          applySchema({
            existing: Array.from(db.stores.keys()),
            createStore(storeName, keyPath) {
              const store = { keyPath, indexes: new Map(), rows: new Map() };
              db.stores.set(storeName, store);
              return {
                createIndex(indexName, indexKeyPath) {
                  store.indexes.set(indexName, indexKeyPath);
                },
              };
            },
          });
          db.version = version;
        }

        state.openConnections += 1;
        let closed = false;

        return Promise.resolve({
          close() { if (!closed) { closed = true; state.openConnections -= 1; } },
          withTransaction(storeNames, mode, work) {
            if (closed) return Promise.reject(new Error('connection is closed'));
            state.transactions += 1;

            // Snapshot every touched store; commit or discard as one unit.
            const working = new Map();
            for (const n of storeNames) {
              const store = db.stores.get(n);
              if (!store) return Promise.reject(new Error(`unknown store: ${n}`));
              working.set(n, { spec: store, rows: new Map(store.rows) });
            }

            const ctx = {};
            for (const n of storeNames) {
              const w = working.get(n);
              const readonly = mode === 'readonly';
              ctx[n] = {
                get: (key) => Promise.resolve(clone(w.rows.get(JSON.stringify(key)))),
                getAll: () => Promise.resolve(Array.from(w.rows.values()).map(clone)),
                getAllByIndex: (indexName, query) => {
                  const keyPath = w.spec.indexes.get(indexName);
                  if (keyPath === undefined) {
                    return Promise.reject(new Error(`unknown index: ${n}.${indexName}`));
                  }
                  const out = [];
                  for (const row of w.rows.values()) {
                    if (query === undefined || sameKey(readPath(row, keyPath), query)) out.push(clone(row));
                  }
                  return Promise.resolve(out);
                },
                put: (value) => {
                  if (readonly) return Promise.reject(new Error('write in a readonly transaction'));
                  const key = readPath(value, w.spec.keyPath);
                  w.rows.set(JSON.stringify(key), clone(value));
                  return Promise.resolve(value);
                },
                delete: (key) => {
                  if (readonly) return Promise.reject(new Error('write in a readonly transaction'));
                  w.rows.delete(JSON.stringify(key));
                  return Promise.resolve();
                },
              };
            }

            return Promise.resolve()
              .then(() => work(ctx))
              .then((result) => {
                for (const [n, w] of working) db.stores.get(n).rows = w.rows;
                return result;
              })
              .catch((err) => {
                state.aborted += 1;   // working copies are simply discarded
                throw err;
              });
          },
        });
      },
    };
  }

  const d = driver();
  d.__state = state;
  d.__databases = databases;
  /** Force the next transaction touching `storeName` to fail, to test rollback. */
  d.__breakStore = (dbName, storeName) => {
    const db = databases.get(dbName);
    if (db) db.stores.delete(storeName);
  };
  return d;
}

module.exports = { createMemoryDriver, readPath, sameKey };
