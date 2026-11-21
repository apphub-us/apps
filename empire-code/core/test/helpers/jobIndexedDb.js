'use strict';
/**
 * Independent, deliberately small asynchronous IndexedDB test double.
 *
 * This is NOT a native IndexedDB implementation or browser evidence. It models
 * only the standard API subset used by the job-card boundary: staged writes,
 * overlapping transaction scheduling, separate request/transaction events,
 * rollback, cursors and schema metadata. It cannot establish native task
 * activity windows, crash durability, cross-process locking or Safari behavior.
 * Fault controls are test-only; production modules never import this file.
 */
const { setImmediate: later } = require('node:timers');

function namedError(name, message) {
  const error = new Error(message || name);
  error.name = name;
  return error;
}
function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function names(values) {
  const list = Array.from(values).sort();
  Object.defineProperties(list, {
    contains: { value: (name) => list.includes(name) },
    item: { value: (index) => list[index] === undefined ? null : list[index] },
  });
  return list;
}
function compare(a, b) { return a === b ? 0 : a < b ? -1 : 1; }
function indexableKey(value, ancestors) {
  if (typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (!Array.isArray(value)) return false;
  const stack = ancestors || new Set(); if (stack.has(value)) return false; stack.add(value);
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !indexableKey(value[i], stack)) { stack.delete(value); return false; }
  stack.delete(value); return true;
}
function schemaStore(keyPath) { return { keyPath, autoIncrement: false, indexes: new Map(), values: new Map() }; }
function copyEntry(entry) {
  const out = { name: entry.name, version: entry.version, stores: new Map(), active: new Set(), queue: [] };
  for (const [name, source] of entry.stores) {
    const store = schemaStore(clone(source.keyPath)); store.autoIncrement = source.autoIncrement;
    for (const [index, spec] of source.indexes) store.indexes.set(index, clone(spec));
    for (const [key, value] of source.values) store.values.set(key, clone(value));
    out.stores.set(name, store);
  }
  return out;
}
function deterministicCrypto(start) {
  // Test-only predictable bytes, explicitly NOT a production random fallback.
  let next = start === undefined ? 1 : start;
  return { getRandomValues(array) {
    if (!(array instanceof Uint8Array) || array.length !== 16) throw new Error('Expected one 128-bit Uint8Array');
    array.fill(0); let n = next++;
    for (let i = 15; i >= 0 && n; i--) { array[i] = n & 255; n = Math.floor(n / 256); }
    return array;
  } };
}

function makeIndexedDb(databaseName = 'empire_code_jobs') {
  const databases = new Map(); const connections = new Set();
  const openingNames = new Set(); const queuedOpens = new Map();
  const openFaults = []; const requestFaults = []; const commitFaults = []; const commitHolds = []; const blocked = [];
  let scheduled = 0; let transactionId = 0;
  const stats = { opens: 0, closes: 0, transactions: 0, commits: 0, aborts: 0, requests: 0, cursorRows: 0, getAllCalls: 0, events: [] };
  function log(type, info) {
    if (stats.events.length < 5000) stats.events.push(Object.assign({ type }, info || {}));
  }
  function schedule(callback) {
    scheduled++;
    later(() => { scheduled--; callback(); });
  }
  function fire(target, type, extra) {
    const event = Object.assign({ type, target, currentTarget: target, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, extra || {});
    if (typeof target['on' + type] === 'function') target['on' + type](event);
    const listeners = target._listeners && target._listeners[type];
    if (listeners) for (const listener of listeners.slice()) listener.call(target, event);
    return event;
  }
  function eventTarget(target) {
    target._listeners = Object.create(null);
    target.addEventListener = (type, callback) => (target._listeners[type] || (target._listeners[type] = [])).push(callback);
    target.removeEventListener = (type, callback) => {
      target._listeners[type] = (target._listeners[type] || []).filter((f) => f !== callback);
    };
    return target;
  }
  function request(transaction, source) {
    return eventTarget({ result: undefined, error: null, readyState: 'pending', transaction: transaction || null, source: source || null });
  }
  function overlaps(a, b) { return Array.from(a.scope).some((name) => b.scope.has(name)); }
  function incompatible(a, b) { return overlaps(a, b) && (a.mode !== 'readonly' || b.mode !== 'readonly'); }
  function pump(entry) {
    for (let i = 0; i < entry.queue.length; i++) {
      const candidate = entry.queue[i];
      if (Array.from(entry.active).some((active) => incompatible(candidate, active))) continue;
      if (entry.queue.slice(0, i).some((prior) => incompatible(candidate, prior))) continue;
      entry.queue.splice(i--, 1); entry.active.add(candidate); candidate.start();
    }
  }
  function consumeFault(list, matches) {
    const index = list.findIndex(matches); if (index < 0) return null;
    const fault = list[index];
    if (fault.after > 0) { fault.after--; return null; }
    list.splice(index, 1); return fault;
  }

  class Transaction {
    constructor(connection, scope, mode, upgrade, finished) {
      eventTarget(this); this.db = connection; this.entry = connection._entry;
      this.scope = new Set(scope); this.mode = mode; this.error = null;
      this.id = ++transactionId; this.state = 'queued'; this.work = new Map(); this.tasks = [];
      this.running = false; this.finishing = false; this.upgrade = !!upgrade; this.finished = finished || null;
      this.objectStoreNames = names(this.scope); stats.transactions++; log('transaction', { id: this.id, mode, scope: Array.from(this.scope) });
      this.entry.queue.push(this); schedule(() => pump(this.entry));
    }
    start() {
      if (this.state !== 'queued') return;
      this.state = 'active';
      for (const name of this.scope) {
        const store = this.entry.stores.get(name);
        if (store) this.work.set(name, new Map(Array.from(store.values, ([key, value]) => [key, clone(value)])));
      }
      this.drain();
    }
    objectStore(name) {
      if (this.state === 'done') throw namedError('InvalidStateError');
      if (!this.scope.has(name) || !this.entry.stores.has(name)) throw namedError('NotFoundError', 'Store is not in this transaction');
      return new Store(this, name);
    }
    values(name) {
      if (!this.work.has(name)) this.work.set(name, new Map());
      return this.work.get(name);
    }
    enqueue(req, store, operation, run) {
      if (this.state === 'done') throw namedError('TransactionInactiveError');
      this.tasks.push({ req, store, operation, run }); this.finishing = false; this.drain(); return req;
    }
    drain() {
      if (this.state !== 'active' || this.running) return;
      if (!this.tasks.length) { this.prepareComplete(); return; }
      this.running = true;
      schedule(() => {
        if (this.state !== 'active') { this.running = false; return; }
        const task = this.tasks.shift(); stats.requests++;
        log('request', { id: this.id, store: task.store, operation: task.operation });
        const fault = consumeFault(requestFaults, (f) => (!f.store || f.store === task.store) && (!f.operation || f.operation === task.operation));
        try {
          if (fault) throw namedError(fault.name);
          task.req.result = task.run(); task.req.error = null; task.req.readyState = 'done';
          log('request-success', { id: this.id, store: task.store, operation: task.operation });
          fire(task.req, 'success');
        } catch (error) {
          task.req.error = error; task.req.result = undefined; task.req.readyState = 'done';
          try {
            const event = fire(task.req, 'error');
            if (!event.defaultPrevented && this.state === 'active') this.abortWith(error);
          } catch (handlerError) { this.abortWith(handlerError); }
        }
        this.running = false; this.drain();
      });
    }
    prepareComplete() {
      if (this.finishing || this.state !== 'active') return;
      this.finishing = true;
      schedule(() => {
        if (this.state !== 'active' || this.tasks.length || this.running || !this.finishing) return;
        const holdIndex = commitHolds.findIndex((h) => h.mode === this.mode);
        if (holdIndex >= 0) {
          const hold = commitHolds.splice(holdIndex, 1)[0]; hold.transaction = this; hold.reach(this);
          return;
        }
        this.complete();
      });
    }
    complete() {
      if (this.state !== 'active') return;
      if (this.tasks.length || this.running) { this.finishing = false; this.drain(); return; }
      const fault = consumeFault(commitFaults, (f) => !f.mode || f.mode === this.mode);
      if (fault) { this.abortWith(namedError(fault.name)); return; }
      if (this.mode !== 'readonly') for (const [name, values] of this.work) {
        this.entry.stores.get(name).values = new Map(Array.from(values, ([key, value]) => [key, clone(value)]));
      }
      this.state = 'done'; this.entry.active.delete(this); stats.commits++;
      log('complete', { id: this.id, mode: this.mode });
      try { fire(this, 'complete'); } finally { if (this.finished) this.finished(null); pump(this.entry); }
    }
    abort() {
      if (this.state === 'done') throw namedError('InvalidStateError');
      this.abortWith(namedError('AbortError'));
    }
    abortWith(error) {
      if (this.state === 'done') return;
      this.error = error; this.state = 'done'; this.tasks.length = 0;
      this.entry.active.delete(this); this.entry.queue = this.entry.queue.filter((tx) => tx !== this);
      stats.aborts++; log('abort', { id: this.id, name: error.name, mode: this.mode });
      schedule(() => {
        try { fire(this, 'error'); } finally {
          try { fire(this, 'abort'); } finally { if (this.finished) this.finished(error); pump(this.entry); }
        }
      });
    }
  }
  class Store {
    constructor(transaction, name) { this.transaction = transaction; this.name = name; }
    get meta() { return this.transaction.entry.stores.get(this.name); }
    get keyPath() { return clone(this.meta.keyPath); }
    get autoIncrement() { return this.meta.autoIncrement; }
    get indexNames() { return names(this.meta.indexes.keys()); }
    get(key) { return this.transaction.enqueue(request(this.transaction, this), this.name, 'get', () => clone(this.transaction.values(this.name).get(key))); }
    count(query) {
      return this.transaction.enqueue(request(this.transaction, this), this.name, 'count', () => Array.from(this.transaction.values(this.name).keys()).filter((key) => query === undefined || key === query).length);
    }
    add(value, key) { return this.write('add', value, key); }
    put(value, key) { return this.write('put', value, key); }
    write(operation, value, suppliedKey) {
      if (this.transaction.mode === 'readonly') throw namedError('ReadOnlyError');
      const data = clone(value); const key = suppliedKey === undefined ? data && data[this.keyPath] : clone(suppliedKey);
      if (typeof key !== 'string' && typeof key !== 'number') throw namedError('DataError');
      return this.transaction.enqueue(request(this.transaction, this), this.name, operation, () => {
        const values = this.transaction.values(this.name);
        if (operation === 'add' && values.has(key)) throw namedError('ConstraintError');
        for (const spec of this.meta.indexes.values()) if (spec.unique) {
          for (const [otherKey, other] of values) if (otherKey !== key && other[spec.keyPath] === data[spec.keyPath]) throw namedError('ConstraintError');
        }
        values.set(key, clone(data)); return clone(key);
      });
    }
    delete(key) {
      if (this.transaction.mode === 'readonly') throw namedError('ReadOnlyError');
      return this.transaction.enqueue(request(this.transaction, this), this.name, 'delete', () => { this.transaction.values(this.name).delete(key); return undefined; });
    }
    clear() {
      if (this.transaction.mode === 'readonly') throw namedError('ReadOnlyError');
      return this.transaction.enqueue(request(this.transaction, this), this.name, 'clear', () => { this.transaction.values(this.name).clear(); return undefined; });
    }
    getAll() { stats.getAllCalls++; throw new Error('Unbounded getAll is outside the bounded job-store test contract'); }
    createIndex(name, keyPath, options) {
      if (!this.transaction.upgrade) throw namedError('InvalidStateError');
      if (this.meta.indexes.has(name)) throw namedError('ConstraintError');
      this.meta.indexes.set(name, { name, keyPath: clone(keyPath), unique: !!(options && options.unique), multiEntry: !!(options && options.multiEntry) });
      return this.index(name);
    }
    index(name) {
      const spec = this.meta.indexes.get(name); if (!spec) throw namedError('NotFoundError');
      const store = this;
      return Object.assign({}, clone(spec), { objectStore: this,
        openCursor(query, direction) { return cursor(store, spec, query, direction); },
        count(query) { return store.transaction.enqueue(request(store.transaction, this), store.name, 'index.count', () => Array.from(store.transaction.values(store.name).values()).filter((value) => indexableKey(value[spec.keyPath]) && (query === undefined || value[spec.keyPath] === query)).length); },
        getAll() { stats.getAllCalls++; throw new Error('Unbounded index.getAll is outside the bounded job-store test contract'); },
      });
    }
    openCursor(query, direction) { return cursor(this, null, query, direction); }
  }
  function cursor(store, spec, query, direction) {
    const tx = store.transaction; const req = request(tx, store); let rows = null; let position = 0; let pending = false;
    function next() {
      if (pending) throw namedError('InvalidStateError'); pending = true; req.readyState = 'pending';
      tx.enqueue(req, store.name, spec ? 'index.openCursor' : 'openCursor', () => {
        pending = false;
        if (!rows) {
          rows = Array.from(tx.values(store.name), ([key, value]) => ({ key: spec ? value[spec.keyPath] : key, primaryKey: key, value }));
          rows = rows.filter((row) => (!spec || indexableKey(row.key)) && (query === undefined || query === null || (query && typeof query === 'object' && !Array.isArray(query) && typeof query.includes === 'function' ? query.includes(row.key) : row.key === query)));
          rows.sort((a, b) => compare(a.key, b.key) || compare(a.primaryKey, b.primaryKey));
          if (direction === 'nextunique' || direction === 'prevunique') rows = rows.filter((row, i, all) => i === 0 || compare(row.key, all[i - 1].key) !== 0);
          if (direction === 'prev' || direction === 'prevunique') rows.reverse();
        }
        const row = rows[position++]; if (!row) return null;
        stats.cursorRows++;
        let continued = false;
        return { key: clone(row.key), primaryKey: clone(row.primaryKey), value: clone(row.value), direction: direction || 'next', source: store,
          continue() { if (continued) throw namedError('InvalidStateError'); continued = true; next(); },
          advance(count) { if (!Number.isInteger(count) || count < 1 || continued) throw namedError('DataError'); continued = true; position += count - 1; next(); },
        };
      });
    }
    next(); return req;
  }
  class Connection {
    constructor(entry) { eventTarget(this); this._entry = entry; this._closed = false; this._upgrade = null; connections.add(this); }
    get name() { return this._entry.name; }
    get version() { return this._entry.version; }
    get objectStoreNames() { return names(this._entry.stores.keys()); }
    createObjectStore(name, options) {
      const tx = this._upgrade;
      if (!tx || tx.state === 'done') throw namedError('InvalidStateError');
      if (this._entry.stores.has(name)) throw namedError('ConstraintError');
      const meta = schemaStore(options && options.keyPath); meta.autoIncrement = !!(options && options.autoIncrement);
      this._entry.stores.set(name, meta); tx.scope.add(name); tx.objectStoreNames = names(tx.scope); tx.work.set(name, new Map());
      return new Store(tx, name);
    }
    transaction(scope, mode) {
      if (this._closed) throw namedError('InvalidStateError');
      const list = typeof scope === 'string' ? [scope] : Array.from(scope);
      for (const name of list) if (!this._entry.stores.has(name)) throw namedError('NotFoundError');
      return new Transaction(this, list, mode || 'readonly');
    }
    close() { if (!this._closed) { this._closed = true; connections.delete(this); stats.closes++; log('close'); } }
  }
  function finishOpen(req, name, version) {
    if (openingNames.has(name)) {
      if (!queuedOpens.has(name)) queuedOpens.set(name, []);
      queuedOpens.get(name).push(() => finishOpen(req, name, version)); return;
    }
    const existing = databases.get(name);
    if (existing && version < existing.version) {
      req.error = namedError('VersionError'); req.readyState = 'done'; fire(req, 'error'); return;
    }
    if (!existing || version > existing.version) {
      openingNames.add(name);
      const entry = existing ? copyEntry(existing) : { name, version: 0, stores: new Map(), active: new Set(), queue: [] };
      const conn = new Connection(entry); const oldVersion = entry.version; entry.version = version;
      const tx = new Transaction(conn, Array.from(entry.stores.keys()), 'versionchange', true, (error) => {
        conn._upgrade = null; req.transaction = null;
        if (error) { conn.close(); req.result = undefined; req.error = error; req.readyState = 'done'; fire(req, 'error'); }
        else { databases.set(name, entry); req.result = conn; req.readyState = 'done'; schedule(() => fire(req, 'success')); }
        openingNames.delete(name);
        const waiting = queuedOpens.get(name) || []; queuedOpens.delete(name);
        waiting.forEach(schedule);
      });
      conn._upgrade = tx; req.transaction = tx; req.result = conn;
      try { fire(req, 'upgradeneeded', { oldVersion, newVersion: version }); }
      catch (error) { tx.abortWith(error); }
    } else {
      req.result = new Connection(existing); req.readyState = 'done'; fire(req, 'success');
    }
  }
  const indexedDB = {
    open(name, version) {
      stats.opens++; log('open', { name, version });
      const fault = openFaults.shift(); if (fault && fault.kind === 'throw') throw namedError(fault.name);
      const req = request(null, null);
      schedule(() => {
        if (fault && fault.kind === 'error') { req.error = namedError(fault.name); req.readyState = 'done'; fire(req, 'error'); }
        else if (fault && fault.kind === 'blocked') { blocked.push(() => schedule(() => finishOpen(req, name, version || 1))); fire(req, 'blocked', { oldVersion: 0, newVersion: version || 1 }); }
        else finishOpen(req, name, version || 1);
      });
      return req;
    },
    deleteDatabase() { throw new Error('Destructive database repair is forbidden by the job-card contract'); },
  };
  function entryOrThrow() { const entry = databases.get(databaseName); if (!entry) throw new Error('Test database not seeded or created'); return entry; }
  const control = {
    stats,
    failNextOpen(name) { openFaults.push({ kind: 'error', name }); },
    throwNextOpen(name) { openFaults.push({ kind: 'throw', name }); },
    blockNextOpen() { openFaults.push({ kind: 'blocked' }); },
    releaseBlockedOpen() { const run = blocked.shift(); if (!run) throw new Error('No blocked open'); run(); },
    failRequest(options) { requestFaults.push(Object.assign({ after: 0, name: 'UnknownError' }, options)); },
    abortNextCommit(name, mode) { commitFaults.push({ name: name || 'AbortError', mode: mode || 'readwrite', after: 0 }); },
    holdNextCommit(mode) {
      let reach; const reached = new Promise((resolve) => { reach = resolve; });
      const hold = { mode: mode || 'readwrite', reached, reach, transaction: null,
        release() { if (!hold.transaction) throw new Error('Commit not reached'); schedule(() => hold.transaction.complete()); },
        abort(name) { if (!hold.transaction) throw new Error('Commit not reached'); hold.transaction.abortWith(namedError(name || 'AbortError')); },
      };
      commitHolds.push(hold); return hold;
    },
    seed(seed) {
      if (connections.size) throw new Error('Close test connections before replacing the whole database');
      const spec = seed || {}; const entry = { name: databaseName, version: spec.version === undefined ? 1 : spec.version, stores: new Map(), active: new Set(), queue: [] };
      const schemas = spec.schema || { jobs: { keyPath: 'jobId' }, jobRevisions: { keyPath: 'revisionId', indexes: { byJobId: { keyPath: 'jobId', unique: false, multiEntry: false } } } };
      for (const [name, shape] of Object.entries(schemas)) {
        const meta = schemaStore(shape.keyPath); meta.autoIncrement = !!shape.autoIncrement;
        for (const [index, fields] of Object.entries(shape.indexes || {})) meta.indexes.set(index, Object.assign({ name: index, unique: false, multiEntry: false }, clone(fields)));
        for (const row of spec[name] || []) meta.values.set(row[shape.keyPath], clone(row));
        entry.stores.set(name, meta);
      }
      databases.set(databaseName, entry);
    },
    set(store, key, value) { entryOrThrow().stores.get(store).values.set(key, clone(value)); },
    delete(store, key) { entryOrThrow().stores.get(store).values.delete(key); },
    raw(store, key) { return clone(entryOrThrow().stores.get(store).values.get(key)); },
    count(store) { return entryOrThrow().stores.get(store).values.size; },
    snapshot() {
      const entry = databases.get(databaseName); if (!entry) return null;
      const result = { version: entry.version, schema: {} };
      for (const [name, meta] of entry.stores) {
        result.schema[name] = { keyPath: clone(meta.keyPath), autoIncrement: meta.autoIncrement, indexes: Array.from(meta.indexes.values(), clone) };
        result[name] = Array.from(meta.values.entries()).sort(([a], [b]) => compare(a, b)).map(([key, value]) => [key, clone(value)]);
      }
      return result;
    },
    resetStats() { for (const key of Object.keys(stats)) { if (key === 'events') stats.events.length = 0; else stats[key] = 0; } },
    async changeVersion(version) {
      const entry = entryOrThrow();
      await new Promise((resolve) => schedule(() => {
        const oldVersion = entry.version;
        for (const conn of Array.from(connections)) if (conn._entry === entry) fire(conn, 'versionchange', { oldVersion, newVersion: version });
        entry.version = version; resolve();
      }));
    },
    async flush() {
      for (let turns = 0; turns < 10000; turns++) {
        await new Promise((resolve) => later(resolve));
        if (!scheduled) return;
      }
      throw new Error('Test-double event queue did not settle within its bound');
    },
  };
  return { indexedDB, control };
}
module.exports = { makeIndexedDb, deterministicCrypto, namedError };
