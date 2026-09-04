'use strict';
/**
 * Wire Map V2-0 — Point + Connection storage foundation.
 *
 * Same discipline as the WM-2 store tests: the real store, the real model,
 * the in-memory driver (Node ships no IndexedDB and this project carries no
 * dependencies). Every invariant the architecture report demanded is pinned
 * here — identity, ownership, cross-sheet topology, cross-job rejection,
 * duplicate-safe labels, atomic cascades and rollback — BEFORE any V2 UI
 * exists. Real-browser upgrade behaviour lives in the browser check.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const store = require('../src/wiremap/store');
const model = require('../src/wiremap/model');
const { createMemoryDriver } = require('./wiremapMemoryDriver');

const NOW = 1_700_000_000_000;
const DB = 'empire-wiremap';
let driver;
let db;

async function fresh() {
  driver = createMemoryDriver();
  db = store.createStore({ driver });
  await db.openDatabase();
}
const job = (id) => model.createJob({ id, name: `Job ${id}`, now: NOW });
const sheet = (id, jobId, over) => ({ ...model.createSheet({ id, jobId, name: `Sheet ${id}`, kind: 'blank',
  width: 1000, height: 1000, order: 0, now: NOW }), ...over });
const point = (id, jobId, sheetId, over) => model.createPoint({ id, jobId, sheetId, type: 'junctionBox',
  x: 0.25, y: 0.75, now: NOW, ...over });
const conn = (id, jobId, from, to, over) => model.createConnection({ id, jobId, fromPointId: from, toPointId: to,
  now: NOW, ...over });
const label = (id, sheetId, text) => model.createAnnotation({ id, sheetId, type: 'wireLabel', at: { x: 0.4, y: 0.6 }, now: NOW,
  data: { label: text, from: 'Panel A / 18', to: 'Bedroom', cable: '12/2 MC', room: 'Bedroom', notes: '' } });

/** One job, two sheets, a point on each, one cross-sheet cable. */
async function seedTopology() {
  await db.putJob(job('J'));
  await db.putSheet(sheet('SA', 'J')); await db.putSheet(sheet('SB', 'J', { order: 1 }));
  await db.putPoint(point('PA', 'J', 'SA', { type: 'panel', name: 'LP-1' }));
  await db.putPoint(point('PB', 'J', 'SB', { type: 'gangBox', gang: { count: 1, slots: [{ device: 'duplex' }] } }));
  await db.putConnection(conn('C1', 'J', 'PA', 'PB', { label: 'HR-07' }));
}

/* ── schema ─────────────────────────────────────────────────────────────── */
describe('V2-0 schema', () => {
  test('version 2 adds exactly two stores, after the five legacy ones', () => {
    assert.strictEqual(store.DB_VERSION, 2);
    assert.deepStrictEqual(store.STORE_NAMES, ['jobs', 'sheets', 'annotations', 'images', 'meta', 'points', 'connections']);
    assert.strictEqual(store.STORES.points.keyPath, 'id');
    assert.strictEqual(store.STORES.connections.keyPath, 'id');
  });
  test('points indices: jobId, sheetId, [jobId, type]', () => {
    assert.deepStrictEqual(store.STORES.points.indexes.map((i) => [i.name, i.keyPath]),
      [['jobId', 'jobId'], ['sheetId', 'sheetId'], ['jobId_type', ['jobId', 'type']]]);
  });
  test('connections indices: jobId, both endpoints, labelKey and [jobId, labelKey]', () => {
    assert.deepStrictEqual(store.STORES.connections.indexes.map((i) => i.name),
      ['jobId', 'fromPointId', 'toPointId', 'labelKey', 'jobId_labelKey']);
    assert.deepStrictEqual(store.STORES.connections.indexes[4].keyPath, ['jobId', 'labelKey']);
  });
  test('a legacy v1 database upgrades additively: v1 stores untouched, v2 stores added', () => {
    const created = [];
    store.applySchemaV1({ existing: ['jobs', 'sheets', 'annotations', 'images', 'meta'],
      createStore(name) { created.push(name); return { createIndex() {} }; } });
    assert.deepStrictEqual(created, ['points', 'connections']);
  });
  test('the memory driver performs the same additive upgrade from a genuine v1 database', async () => {
    driver = createMemoryDriver();
    // Build the database EXACTLY as the frozen v1 code did: five stores, v1 indices.
    const LEGACY = ['jobs', 'sheets', 'annotations', 'images', 'meta'];
    const v1conn = await driver.open(DB, 1, (u) => {
      for (const n of LEGACY) { const c = u.createStore(n, store.STORES[n].keyPath); for (const i of store.STORES[n].indexes) c.createIndex(i.name, i.keyPath); }
    });
    await v1conn.withTransaction(['jobs', 'sheets', 'annotations'], 'readwrite', async (s) => {
      await s.jobs.put(job('J')); await s.sheets.put(sheet('S', 'J')); await s.annotations.put(label('A', 'S', 'HR-07'));
    });
    v1conn.close();
    const dbv1 = driver.__databases.get(DB);
    assert.strictEqual(dbv1.version, 1); assert.ok(!dbv1.stores.has('points') && !dbv1.stores.has('connections'));
    const v2 = store.createStore({ driver });
    await v2.openDatabase();
    assert.strictEqual(driver.__databases.get(DB).version, 2);
    assert.ok(driver.__databases.get(DB).stores.has('points') && driver.__databases.get(DB).stores.has('connections'));
    assert.deepStrictEqual(await v2.getJob('J'), job('J'), 'legacy job byte-logically unchanged');
    assert.deepStrictEqual(await v2.getAnnotation('A'), label('A', 'S', 'HR-07'), 'legacy annotation unchanged');
    assert.deepStrictEqual(await v2.listPoints('S'), [], 'and the new store starts empty');
  });
});

/* ── model: Point ───────────────────────────────────────────────────────── */
describe('V2-0 model — Point', () => {
  test('taxonomy is exactly the approved nine types; legacy POINT_TYPES untouched', () => {
    assert.deepStrictEqual(model.ELECTRICAL_POINT_TYPES, ['panel', 'junctionBox', 'gangBox', 'light.ceiling',
      'light.recessed', 'sconce', 'device.smoke', 'device.thermostat', 'disconnect']);
    assert.deepStrictEqual(model.POINT_TYPES, ['wireLabel', 'text', 'symbol'], 'the annotation enum is not the electrical one');
  });
  test('createPoint normalizes: name optional, coordinates numeric, gang null for non-gang', () => {
    const p = model.createPoint({ id: 'p', jobId: 'j', sheetId: 's', type: 'sconce', x: 0.1, y: 0.9, now: NOW });
    assert.strictEqual(p.name, null); assert.strictEqual(p.gang, null);
    assert.strictEqual(p.createdAt, NOW); assert.strictEqual(p.updatedAt, NOW);
    assert.strictEqual(model.createPoint({ id: 'p', jobId: 'j', sheetId: 's', type: 'panel', name: '  LP-1 ' }).name, 'LP-1');
    assert.strictEqual(model.createPoint({ id: 'p', jobId: 'j', sheetId: 's', type: 'panel', name: '   ' }).name, null);
  });
  test('validatePoint rejects each bad field with a named problem', () => {
    const base = point('p', 'j', 's');
    const bad = (over) => model.validatePoint({ ...base, ...over });
    assert.ok(!bad({ id: '' }).valid); assert.ok(!bad({ jobId: '' }).valid); assert.ok(!bad({ sheetId: '' }).valid);
    assert.ok(/type must be one of/.test(bad({ type: 'receptacle' }).problems[0]));
    assert.ok(/x must be/.test(bad({ x: 1.2 }).problems[0])); assert.ok(/y must be/.test(bad({ y: -0.01 }).problems[0]));
    assert.ok(/x must be/.test(bad({ x: NaN }).problems[0]));
    assert.ok(/name must be a string or null/.test(bad({ name: 7 }).problems[0]));
    assert.ok(/gang must be null/.test(bad({ gang: { count: 1, slots: [{ device: 'duplex' }] } }).problems[0]));
    assert.ok(!model.validatePoint(null).valid); assert.ok(!model.validatePoint('p').valid);
  });
  test('the boundary coordinates 0 and 1 are valid; identity does not derive from content', () => {
    assert.ok(model.validatePoint(point('p', 'j', 's', { x: 0, y: 1 })).valid);
    const a = point('same', 'j', 's', { type: 'panel', name: 'A', x: 0.1, y: 0.1 });
    const b = point('same', 'j', 's', { type: 'sconce', name: 'B', x: 0.9, y: 0.9 });
    assert.strictEqual(a.id, b.id, 'renaming, retyping and moving never changes the id');
  });
});

/* ── model: Gang Box ────────────────────────────────────────────────────── */
describe('V2-0 model — Gang Box', () => {
  const gang = (count, devices) => point('g', 'j', 's', { type: 'gangBox', gang: { count, slots: devices.map((d) => ({ device: d })) } });
  test('devices enum and bounds', () => {
    assert.deepStrictEqual(model.GANG_DEVICES, ['simplex', 'duplex', 'gfci', 'dedicated', 'switch1p', 'switch3w', 'switch4w', 'blank']);
    assert.strictEqual(model.GANG_MIN, 1); assert.strictEqual(model.GANG_MAX, 6);
  });
  test('a well-formed 3-gang [S][S3][DUP] round-trips in slot order', () => {
    const g = gang(3, ['switch1p', 'switch3w', 'duplex']);
    assert.ok(model.validatePoint(g).valid);
    assert.deepStrictEqual(g.gang.slots.map((s) => s.device), ['switch1p', 'switch3w', 'duplex'], 'left -> right');
  });
  test('createGang pads short slot lists with blank and trims long ones to count', () => {
    assert.deepStrictEqual(gang(3, ['duplex']).gang.slots.map((s) => s.device), ['duplex', 'blank', 'blank']);
    assert.deepStrictEqual(gang(1, ['duplex', 'gfci']).gang.slots.map((s) => s.device), ['duplex']);
  });
  test('validation: count 0, count 7, length mismatch, unknown device, missing gang', () => {
    const v = (g) => model.validatePoint(g);
    assert.ok(/gang.count must be an integer 1..6/.test(v({ ...gang(1, ['duplex']), gang: { count: 0, slots: [] } }).problems[0]));
    assert.ok(/gang.count must be an integer 1..6/.test(v({ ...gang(1, ['duplex']), gang: { count: 7, slots: [] } }).problems[0]));
    assert.ok(/exactly gang.count/.test(v({ ...gang(2, ['duplex', 'gfci']), gang: { count: 2, slots: [{ device: 'duplex' }] } }).problems[0]));
    assert.ok(/gang.slots\[1\].device must be one of/.test(v({ ...gang(2, ['duplex', 'gfci']), gang: { count: 2, slots: [{ device: 'duplex' }, { device: 'dimmer' }] } }).problems[0]));
    assert.ok(/gang must be an object/.test(v({ ...gang(1, ['duplex']), gang: null }).problems[0]));
    assert.ok(!v({ ...gang(1, ['duplex']), gang: { count: 1.5, slots: [{ device: 'duplex' }] } }).valid, 'non-integer count');
  });
  test('slots carry no ids: order IS position', () => {
    assert.deepStrictEqual(Object.keys(gang(1, ['gfci']).gang.slots[0]), ['device']);
  });
});

/* ── model: Connection ──────────────────────────────────────────────────── */
describe('V2-0 model — Connection', () => {
  test('createConnection normalizes and derives labelKey through the SAME normalizer as wire labels', () => {
    const c = conn('c', 'j', 'a', 'b', { label: '  HR 07 ', cableType: ' 12/3 MC ', circuit: '', notes: null });
    assert.strictEqual(c.label, 'HR 07'); assert.strictEqual(c.labelKey, model.toLabelKey('HR 07'));
    assert.strictEqual(c.labelKey, 'hr-07');
    assert.strictEqual(c.cableType, '12/3 MC'); assert.strictEqual(c.circuit, null); assert.strictEqual(c.notes, null);
    assert.strictEqual(c.createdAt, NOW); assert.strictEqual(c.updatedAt, NOW);
  });
  test('an unlabeled connection is valid with labelKey \'\'', () => {
    const c = conn('c', 'j', 'a', 'b');
    assert.strictEqual(c.label, null); assert.strictEqual(c.labelKey, '');
    assert.ok(model.validateConnection(c).valid);
  });
  test('validateConnection: self, missing ends, bad job, caller-forged labelKey, bad optionals', () => {
    const v = (over) => model.validateConnection({ ...conn('c', 'j', 'a', 'b', { label: 'K-12' }), ...over });
    assert.ok(/cannot join a point to itself/.test(v({ toPointId: 'a' }).problems[0]));
    assert.ok(!v({ fromPointId: '' }).valid); assert.ok(!v({ toPointId: '' }).valid); assert.ok(!v({ jobId: '' }).valid);
    assert.ok(/labelKey must be derived/.test(v({ labelKey: 'forged' }).problems[0]), 'a supplied key never wins');
    assert.ok(/cableType must be a string or null/.test(v({ cableType: 12 }).problems[0]));
    assert.ok(/label must be a string or null/.test(v({ label: {} , labelKey: '' }).problems[0]));
  });
  test('no colour field exists in V2-0 storage', () => {
    assert.ok(!('color' in conn('c', 'j', 'a', 'b')) && !('colour' in conn('c', 'j', 'a', 'b')));
  });
});

/* ── store: Point CRUD + ownership ──────────────────────────────────────── */
describe('V2-0 store — Points', () => {
  beforeEach(fresh);
  test('put/get/list by sheet and by job, creation order', async () => {
    await db.putJob(job('J')); await db.putSheet(sheet('S', 'J'));
    await db.putPoint(point('P2', 'J', 'S', { now: NOW + 5 }));
    await db.putPoint(point('P1', 'J', 'S', { now: NOW }));
    assert.deepStrictEqual(await db.getPoint('P1'), point('P1', 'J', 'S', { now: NOW }));
    assert.strictEqual(await db.getPoint('nope'), null);
    assert.deepStrictEqual((await db.listPoints('S')).map((p) => p.id), ['P1', 'P2'], 'oldest first');
    assert.deepStrictEqual((await db.listPointsByJob('J')).map((p) => p.id), ['P1', 'P2']);
    await assert.rejects(() => db.listPoints(''), (e) => e.code === store.ERR.BAD_ARGUMENT);
  });
  test('rejects a missing job, a missing sheet, and a sheet owned by another job — nothing written', async () => {
    await db.putJob(job('J')); await db.putJob(job('K'));
    await db.putSheet(sheet('SJ', 'J')); await db.putSheet(sheet('SK', 'K'));
    await assert.rejects(() => db.putPoint(point('P', 'X', 'SJ')), (e) => e.code === store.ERR.MISSING_PARENT);
    await assert.rejects(() => db.putPoint(point('P', 'J', 'nope')), (e) => e.code === store.ERR.MISSING_PARENT);
    await assert.rejects(() => db.putPoint(point('P', 'J', 'SK')), (e) => e.code === store.ERR.INVALID && /belongs to job K/.test(e.message));
    assert.strictEqual(await db.getPoint('P'), null);
  });
  test('invalid shape is rejected before any transaction', async () => {
    await assert.rejects(() => db.putPoint({ id: 'P' }), (e) => e.code === store.ERR.INVALID);
    assert.strictEqual(driver.__state.transactions, 0, 'no transaction was even started');
  });
  test('update keeps id and createdAt, may move within the job, cannot move to another job\'s sheet', async () => {
    await db.putJob(job('J')); await db.putJob(job('K'));
    await db.putSheet(sheet('S1', 'J')); await db.putSheet(sheet('S2', 'J', { order: 1 })); await db.putSheet(sheet('SK', 'K'));
    const p = point('P', 'J', 'S1', { name: 'Old' });
    await db.putPoint(p);
    const moved = { ...p, sheetId: 'S2', name: 'New', x: 0.9, updatedAt: NOW + 10 };
    await db.putPoint(moved);
    const got = await db.getPoint('P');
    assert.strictEqual(got.sheetId, 'S2'); assert.strictEqual(got.name, 'New');
    assert.strictEqual(got.createdAt, NOW, 'createdAt stable'); assert.strictEqual(got.updatedAt, NOW + 10, 'updatedAt advances');
    await assert.rejects(() => db.putPoint({ ...got, sheetId: 'SK' }), (e) => e.code === store.ERR.INVALID);
    assert.strictEqual((await db.getPoint('P')).sheetId, 'S2', 'the failed move changed nothing');
  });
  test('a gangBox update cannot become invalid', async () => {
    await db.putJob(job('J')); await db.putSheet(sheet('S', 'J'));
    const g = point('G', 'J', 'S', { type: 'gangBox', gang: { count: 2, slots: [{ device: 'switch1p' }, { device: 'switch3w' }] } });
    await db.putPoint(g);
    await assert.rejects(() => db.putPoint({ ...g, gang: { count: 7, slots: [] } }), (e) => e.code === store.ERR.INVALID);
    await assert.rejects(() => db.putPoint({ ...g, gang: { count: 1, slots: g.gang.slots } }), (e) => e.code === store.ERR.INVALID);
    await assert.rejects(() => db.putPoint({ ...g, gang: { count: 2, slots: [{ device: 'switch1p' }, { device: 'dimmer' }] } }), (e) => e.code === store.ERR.INVALID);
    assert.deepStrictEqual((await db.getPoint('G')).gang, g.gang, 'the stored composition is intact');
  });
  test('deletePoint removes the point and every touching connection atomically', async () => {
    await seedTopology();
    await db.putPoint(point('PC', 'J', 'SA'));
    await db.putConnection(conn('C2', 'J', 'PB', 'PC', { label: 'K-12' }));
    const r = await db.deletePoint('PB');
    assert.deepStrictEqual(r, { deleted: true, points: 1, connections: 2 });
    assert.strictEqual(await db.getPoint('PB'), null);
    assert.strictEqual(await db.getConnection('C1'), null); assert.strictEqual(await db.getConnection('C2'), null);
    assert.ok(await db.getPoint('PA') && await db.getPoint('PC'), 'the far points survive');
    assert.deepStrictEqual(await db.deletePoint('PB'), { deleted: false, points: 0, connections: 0 }, 'idempotent');
  });
});

/* ── store: Connection CRUD + validation ───────────────────────────────── */
describe('V2-0 store — Connections', () => {
  beforeEach(fresh);
  test('put/get/list by job/list by point; one entity reachable from either end', async () => {
    await seedTopology();
    const c = await db.getConnection('C1');
    assert.strictEqual(c.label, 'HR-07'); assert.strictEqual(c.labelKey, 'hr-07');
    assert.deepStrictEqual((await db.listConnections('J')).map((x) => x.id), ['C1']);
    assert.deepStrictEqual((await db.listConnectionsForPoint('PA')).map((x) => x.id), ['C1'], 'from end');
    assert.deepStrictEqual((await db.listConnectionsForPoint('PB')).map((x) => x.id), ['C1'], 'to end');
    assert.strictEqual(await db.getConnection('nope'), null);
  });
  test('cross-SHEET is valid; the connection has no sheetId of its own', async () => {
    await seedTopology();
    const c = await db.getConnection('C1');
    assert.ok(!('sheetId' in c), 'job-owned, sheets derived from endpoints');
    assert.strictEqual((await db.getPoint(c.fromPointId)).sheetId, 'SA');
    assert.strictEqual((await db.getPoint(c.toPointId)).sheetId, 'SB');
  });
  test('cross-JOB is rejected and nothing is written', async () => {
    await db.putJob(job('A')); await db.putJob(job('B'));
    await db.putSheet(sheet('SA', 'A')); await db.putSheet(sheet('SB', 'B'));
    await db.putPoint(point('PA', 'A', 'SA')); await db.putPoint(point('PB', 'B', 'SB'));
    await assert.rejects(() => db.putConnection(conn('X', 'A', 'PA', 'PB')), (e) => e.code === store.ERR.INVALID && /belongs to job B/.test(e.message));
    await assert.rejects(() => db.putConnection(conn('X', 'B', 'PA', 'PB')), (e) => e.code === store.ERR.INVALID);
    assert.strictEqual(await db.getConnection('X'), null);
    assert.deepStrictEqual(await db.listConnections('A'), []); assert.deepStrictEqual(await db.listConnections('B'), []);
  });
  test('missing endpoint, missing job and self-connection are rejected', async () => {
    await seedTopology();
    await assert.rejects(() => db.putConnection(conn('X', 'J', 'PA', 'ghost')), (e) => e.code === store.ERR.MISSING_PARENT);
    await assert.rejects(() => db.putConnection(conn('X', 'ghost', 'PA', 'PB')), (e) => e.code === store.ERR.MISSING_PARENT);
    await assert.rejects(() => db.putConnection(conn('X', 'J', 'PA', 'PA')), (e) => e.code === store.ERR.INVALID);
    assert.strictEqual(await db.getConnection('X'), null);
  });
  test('update cannot make a connection invalid; createdAt stable, updatedAt advances', async () => {
    await seedTopology();
    const c = await db.getConnection('C1');
    await db.putConnection({ ...c, ...model.createConnection({ ...c, label: 'HR-08', now: NOW }), createdAt: c.createdAt, updatedAt: NOW + 3 });
    const got = await db.getConnection('C1');
    assert.strictEqual(got.labelKey, 'hr-08'); assert.strictEqual(got.createdAt, NOW); assert.strictEqual(got.updatedAt, NOW + 3);
    await assert.rejects(() => db.putConnection({ ...got, toPointId: 'PA' }), (e) => e.code === store.ERR.INVALID);
    await assert.rejects(() => db.putConnection({ ...got, toPointId: 'ghost' }), (e) => e.code === store.ERR.MISSING_PARENT);
    assert.strictEqual((await db.getConnection('C1')).toPointId, 'PB', 'failed updates changed nothing');
  });
  test('deleteConnection removes only that cable', async () => {
    await seedTopology();
    await db.deleteConnection('C1');
    assert.strictEqual(await db.getConnection('C1'), null);
    assert.ok(await db.getPoint('PA') && await db.getPoint('PB'));
  });
});

/* ── labels ─────────────────────────────────────────────────────────────── */
describe('V2-0 store — labels and lookup', () => {
  beforeEach(fresh);
  test('duplicate labels persist as distinct connections and lookup returns both', async () => {
    await seedTopology();
    await db.putPoint(point('PC', 'J', 'SA'));
    await db.putConnection(conn('C2', 'J', 'PB', 'PC', { label: 'HR-07' }));
    const hits = await db.findConnectionsByLabel('J', 'hr 07');
    assert.deepStrictEqual(hits.map((c) => c.id), ['C1', 'C2'], 'both, distinct ids, no overwrite');
    assert.strictEqual((await db.listConnections('J')).length, 2);
  });
  test('lookup normalizes like wire labels and is job-scoped', async () => {
    await seedTopology();
    await db.putJob(job('K')); await db.putSheet(sheet('SK', 'K'));
    await db.putPoint(point('K1', 'K', 'SK')); await db.putPoint(point('K2', 'K', 'SK'));
    await db.putConnection(conn('CK', 'K', 'K1', 'K2', { label: 'HR-07' }));
    assert.deepStrictEqual((await db.findConnectionsByLabel('J', '  Hr_07 ')).map((c) => c.id), ['C1']);
    assert.deepStrictEqual((await db.findConnectionsByLabel('K', 'HR-07')).map((c) => c.id), ['CK']);
  });
  test('an unlabeled connection is reachable by id, endpoint and job, never by label', async () => {
    await seedTopology();
    await db.putConnection(conn('U', 'J', 'PA', 'PB'));
    assert.ok(await db.getConnection('U'));
    assert.ok((await db.listConnectionsForPoint('PA')).some((c) => c.id === 'U'));
    assert.ok((await db.listConnections('J')).some((c) => c.id === 'U'));
    assert.deepStrictEqual(await db.findConnectionsByLabel('J', ''), [], 'blank query matches nothing');
    assert.deepStrictEqual(await db.findConnectionsByLabel('J', '   '), []);
  });
});

/* ── cascades ───────────────────────────────────────────────────────────── */
describe('V2-0 store — sheet and job cascades', () => {
  beforeEach(fresh);
  test('CROSS-SHEET: deleting sheet A removes point A and the cable; point B and sheet B survive', async () => {
    await seedTopology();
    await db.putAnnotation(label('L', 'SA', 'legacy'));
    assert.deepStrictEqual(await db.sheetDeletionImpact('SA'), { exists: true, points: 1, connections: 1, crossSheetConnections: 1 });
    const r = await db.deleteSheet('SA');
    assert.deepStrictEqual(r, { deleted: true, sheets: 1, annotations: 1, images: 0, points: 1, connections: 1 });
    assert.strictEqual(await db.getSheet('SA'), null); assert.strictEqual(await db.getPoint('PA'), null);
    assert.strictEqual(await db.getConnection('C1'), null); assert.strictEqual(await db.getAnnotation('L'), null);
    assert.ok(await db.getSheet('SB'), 'sheet B survives'); assert.ok(await db.getPoint('PB'), 'point B survives');
    assert.deepStrictEqual(await db.listConnectionsForPoint('PB'), [], 'no orphan topology');
  });
  test('same-sheet cable is removed exactly once when both ends are on the deleted sheet', async () => {
    await db.putJob(job('J')); await db.putSheet(sheet('S', 'J'));
    await db.putPoint(point('A', 'J', 'S')); await db.putPoint(point('B', 'J', 'S'));
    await db.putConnection(conn('C', 'J', 'A', 'B'));
    assert.deepStrictEqual(await db.sheetDeletionImpact('S'), { exists: true, points: 2, connections: 1, crossSheetConnections: 0 });
    assert.strictEqual((await db.deleteSheet('S')).connections, 1);
  });
  test('sheetDeletionImpact for an unknown sheet is a clean zero', async () => {
    assert.deepStrictEqual(await db.sheetDeletionImpact('nope'), { exists: false, points: 0, connections: 0, crossSheetConnections: 0 });
  });
  test('deleting a job removes its points and connections with everything else', async () => {
    await seedTopology();
    await db.putJob(job('K')); await db.putSheet(sheet('SK', 'K')); await db.putPoint(point('PK', 'K', 'SK'));
    const r = await db.deleteJob('J');
    assert.deepStrictEqual(r, { deleted: true, sheets: 2, annotations: 0, images: 0, points: 2, connections: 1 });
    assert.strictEqual(await db.getPoint('PA'), null); assert.strictEqual(await db.getConnection('C1'), null);
    assert.ok(await db.getPoint('PK'), 'the other job is untouched');
  });
});

/* ── atomicity ──────────────────────────────────────────────────────────── */
/*
 * Two different guarantees, proven separately and named honestly:
 *
 *   PRE-MUTATION FAILURE SAFETY — the transaction cannot even start (a named
 *   store is missing), so nothing is staged. __breakStore, the WM-2 idiom.
 *
 *   MID-TRANSACTION ROLLBACK ATOMICITY — the transaction starts, one or more
 *   deletes are STAGED in the working copies, and THEN a later operation in
 *   the same cascade fails before commit. __failOperation fires at the
 *   mutation boundary; the driver's commit-or-discard rule must throw every
 *   staged change away and count an abort. Real production cascade code runs.
 */
describe('V2-0 store — PRE-MUTATION failure safety (transaction never starts)', () => {
  beforeEach(fresh);
  test('point delete: a missing store rejects before anything is staged', async () => {
    await seedTopology();
    const tx0 = driver.__state.transactions;
    driver.__breakStore(DB, 'connections');
    await assert.rejects(() => db.deletePoint('PA'), /unknown store: connections/);
    assert.strictEqual(driver.__state.transactions, tx0 + 1, 'counted, but');
    assert.strictEqual(driver.__state.aborted, 0, 'never reached the staging phase');
    assert.ok(await db.getPoint('PA'));
  });
  test('sheet delete: same', async () => {
    await seedTopology();
    await db.putAnnotation(label('L', 'SA', 'legacy'));
    driver.__breakStore(DB, 'images');
    await assert.rejects(() => db.deleteSheet('SA'), /unknown store: images/);
    assert.ok(await db.getSheet('SA') && await db.getAnnotation('L') && await db.getPoint('PA') && await db.getConnection('C1'));
    assert.strictEqual(driver.__state.aborted, 0);
  });
  test('job delete: same', async () => {
    await seedTopology();
    driver.__breakStore(DB, 'connections');
    await assert.rejects(() => db.deleteJob('J'), /unknown store: connections/);
    assert.ok(await db.getJob('J') && await db.getSheet('SA') && await db.getPoint('PA'));
    assert.strictEqual(driver.__state.aborted, 0);
  });
});

describe('V2-0 store — MID-TRANSACTION rollback atomicity (staged, then failed)', () => {
  beforeEach(fresh);
  /** Everything seedTopology + extras created, checked as one unit. */
  async function intact(extra) {
    assert.ok(await db.getJob('J'), 'job'); assert.ok(await db.getSheet('SA'), 'sheet A'); assert.ok(await db.getSheet('SB'), 'sheet B');
    assert.ok(await db.getPoint('PA'), 'point A'); assert.ok(await db.getPoint('PB'), 'point B');
    assert.ok(await db.getConnection('C1'), 'connection');
    for (const [kind, id] of extra || []) {
      const get = { annotation: db.getAnnotation, point: db.getPoint, connection: db.getConnection, image: db.getImage, meta: db.getMeta }[kind];
      assert.ok(await get(id), `${kind} ${id}`);
    }
  }

  test('deletePoint: the point is STAGED for deletion, then the 2nd connection delete fails -> all remain', async () => {
    await seedTopology();
    await db.putPoint(point('PC', 'J', 'SA'));
    await db.putConnection(conn('C2', 'J', 'PB', 'PC', { label: 'K-12' }));
    // PB has two cables. The cascade deletes both connections before the point;
    // fail on the SECOND connection delete: one delete is already staged.
    driver.__failOperation(DB, 'connections', 'delete', 2);
    const aborted0 = driver.__state.aborted;
    await assert.rejects(() => db.deletePoint('PB'), /injected failure: connections\.delete #2/);
    assert.strictEqual(driver.__state.aborted, aborted0 + 1, 'the driver discarded staged work');
    await intact([['point', 'PC'], ['connection', 'C2']]);
    assert.strictEqual((await db.listConnectionsForPoint('PB')).length, 2, 'the first, already-staged delete was rolled back too');
  });

  test('deletePoint: connections staged, then the POINT delete itself fails -> connections restored', async () => {
    await seedTopology();
    driver.__failOperation(DB, 'points', 'delete', 1);
    await assert.rejects(() => db.deletePoint('PB'), /injected failure: points\.delete/);
    await intact();
    assert.strictEqual((await db.listConnectionsForPoint('PB')).length, 1, 'the staged connection delete did not survive');
  });

  test('deleteSheet: annotation + image + point deletes staged, then the connection delete fails -> everything remains', async () => {
    await seedTopology();
    await db.putAnnotation(label('L', 'SA', 'legacy'));
    await db.putImage({ id: 'IMG', blob: { size: 3 }, width: 1, height: 1, type: 'image/png', createdAt: NOW });
    await db.putSheet(sheet('SA', 'J', { kind: 'photo', imageId: 'IMG' }));
    await db.setMeta('currentSheet', 'SA');
    driver.__failOperation(DB, 'connections', 'delete', 1);   // fires after annotation, image and point deletes are staged
    const aborted0 = driver.__state.aborted;
    await assert.rejects(() => db.deleteSheet('SA'), /injected failure: connections\.delete/);
    assert.strictEqual(driver.__state.aborted, aborted0 + 1);
    await intact([['annotation', 'L'], ['image', 'IMG']]);
    assert.strictEqual(await db.getMeta('currentSheet'), 'SA', 'meta untouched');
    assert.strictEqual((await db.getSheet('SA')).imageId, 'IMG', 'photo sheet still linked to its image');
  });

  test('deleteSheet: everything staged, then the final SHEET delete fails -> nothing committed', async () => {
    await seedTopology();
    await db.putAnnotation(label('L', 'SA', 'legacy'));
    driver.__failOperation(DB, 'sheets', 'delete', 1);          // the very last operation of the cascade
    await assert.rejects(() => db.deleteSheet('SA'), /injected failure: sheets\.delete/);
    await intact([['annotation', 'L']]);
    assert.deepStrictEqual(await db.sheetDeletionImpact('SA'), { exists: true, points: 1, connections: 1, crossSheetConnections: 1 });
  });

  test('deleteJob: sheets/annotations/points staged, then a connection delete fails -> whole tree remains', async () => {
    await seedTopology();
    await db.putAnnotation(label('L', 'SB', 'legacy'));
    driver.__failOperation(DB, 'connections', 'delete', 1);   // job cascade deletes sheets first, then connections
    const aborted0 = driver.__state.aborted;
    await assert.rejects(() => db.deleteJob('J'), /injected failure: connections\.delete/);
    assert.strictEqual(driver.__state.aborted, aborted0 + 1);
    await intact([['annotation', 'L']]);
    assert.strictEqual((await db.listSheets('J')).length, 2, 'both sheets restored');
  });

  test('deleteJob: everything staged, then the JOB delete fails -> nothing committed', async () => {
    await seedTopology();
    driver.__failOperation(DB, 'jobs', 'delete', 1);            // the last operation
    await assert.rejects(() => db.deleteJob('J'), /injected failure: jobs\.delete/);
    await intact();
    assert.strictEqual((await db.listPointsByJob('J')).length, 2);
    assert.strictEqual((await db.listConnections('J')).length, 1);
  });

  test('a fault is consumed once: the retried cascade then succeeds completely', async () => {
    await seedTopology();
    driver.__failOperation(DB, 'points', 'delete', 1);
    await assert.rejects(() => db.deleteSheet('SA'));
    await intact();
    const r = await db.deleteSheet('SA');
    assert.deepStrictEqual(r, { deleted: true, sheets: 1, annotations: 0, images: 0, points: 1, connections: 1 });
    assert.strictEqual(await db.getPoint('PA'), null); assert.ok(await db.getPoint('PB'));
  });
});

/* ── legacy isolation ───────────────────────────────────────────────────── */
describe('V2-0 — legacy data and behaviour untouched', () => {
  beforeEach(fresh);
  test('annotations of every legacy type still store and list exactly as before, beside points', async () => {
    await seedTopology();
    for (const [id, type] of [['a1', 'wireLabel'], ['a2', 'arrow'], ['a3', 'line'], ['a4', 'rect'], ['a5', 'text'], ['a6', 'symbol']]) {
      const a = type === 'wireLabel' ? label(id, 'SA', 'HR-07')
        : model.createAnnotation({ id, sheetId: 'SA', type, now: NOW, at: { x: 0.5, y: 0.5 }, a: { x: 0.1, y: 0.1 }, b: { x: 0.9, y: 0.9 },
          data: type === 'symbol' ? { symbolKey: 'outlet.duplex' } : type === 'text' ? { text: 'hi' } : {} });
      await db.putAnnotation(a);
      assert.deepStrictEqual(await db.getAnnotation(id), a, type + ' round-trips unchanged');
    }
    assert.strictEqual((await db.listAnnotations('SA')).length, 6);
    assert.strictEqual((await db.listPoints('SA')).length, 1, 'points are a separate store');
  });
  test('no legacy store function learned about points or connections', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/wiremap/store.js'), 'utf8');
    for (const fn of ['putAnnotation', 'listAnnotations', 'deleteAnnotation', 'putSheet', 'listSheets', 'reorderSheets', 'putImage']) {
      const i = src.indexOf('function ' + fn + '('); const body = src.slice(i, src.indexOf('\n  }\n', i));
      assert.ok(!/points|connections/.test(body), fn + ' is untouched');
    }
  });
  test('the app, renderer and legacy interactions never reference the topology stores', () => {
    const fs = require('node:fs'); const path = require('node:path');
    for (const f of ['app.js', 'sheets.js', 'search.js', 'labelInteraction.js', 'routeInteraction.js', 'sketchInteraction.js', 'symbolInteraction.js', 'viewport.js', 'image.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src/wiremap', f), 'utf8');
      assert.ok(!/putPoint|putConnection|listPoints|ELECTRICAL_POINT_TYPES/.test(src), f + ' has no V2 UI');
    }
  });
});

/* ── V2-0 completion: contract cases the first pass left thin ───────────── */
describe('V2-0 model — Point contract, exhaustively', () => {
  test('every approved type is accepted individually; gang stays null for all non-gang types', () => {
    for (const type of model.ELECTRICAL_POINT_TYPES) {
      const p = point('p', 'j', 's', { type, gang: type === 'gangBox' ? { count: 1, slots: [{ device: 'duplex' }] } : undefined });
      assert.ok(model.validatePoint(p).valid, type + ' accepted');
      if (type !== 'gangBox') assert.strictEqual(p.gang, null, type + ' has no gang');
    }
  });
  test('legacy annotation and symbol vocabularies are rejected as Point types', () => {
    for (const bad of ['wireLabel', 'arrow', 'symbol', 'text', 'outlet.duplex', 'switch.single', 'GangBox', 'panel ']) {
      assert.ok(!model.validatePoint(point('p', 'j', 's', { type: bad })).valid, JSON.stringify(bad) + ' rejected');
    }
    // createPoint applies the model's `type || default` convention (as
    // createAnnotation does), so an EMPTY type normalizes at create time…
    assert.strictEqual(point('p', 'j', 's', { type: '' }).type, 'junctionBox');
    // …but a STORED record with an empty type is rejected by the validator.
    assert.ok(!model.validatePoint({ ...point('p', 'j', 's'), type: '' }).valid, 'stored empty type rejected');
  });
  test('each coordinate boundary is accepted on its own: x=0, x=1, y=0, y=1', () => {
    for (const over of [{ x: 0 }, { x: 1 }, { y: 0 }, { y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }]) {
      assert.ok(model.validatePoint(point('p', 'j', 's', over)).valid, JSON.stringify(over));
    }
  });
  test('NaN, +/-Infinity and non-numbers are rejected for both axes', () => {
    for (const v of [NaN, Infinity, -Infinity, '0.5', null, undefined]) {
      assert.ok(!model.validatePoint({ ...point('p', 'j', 's'), x: v }).valid, 'x=' + String(v));
      assert.ok(!model.validatePoint({ ...point('p', 'j', 's'), y: v }).valid, 'y=' + String(v));
    }
  });
  test('gang is REQUIRED on gangBox and FORBIDDEN elsewhere, in both directions', () => {
    const noGang = { ...point('p', 'j', 's', { type: 'gangBox' }), gang: null };
    assert.ok(/gang must be an object/.test(model.validatePoint(noGang).problems[0]), 'gangBox without gang');
    const stray = { ...point('p', 'j', 's', { type: 'light.ceiling' }), gang: { count: 1, slots: [{ device: 'duplex' }] } };
    assert.ok(/gang must be null/.test(model.validatePoint(stray).problems[0]), 'non-gang with gang');
  });
  test('slot ordering survives a full create -> validate -> re-create round-trip', () => {
    const order = ['switch3w', 'gfci', 'blank', 'switch4w', 'duplex', 'dedicated'];
    const g = point('g', 'j', 's', { type: 'gangBox', gang: { count: 6, slots: order.map((d) => ({ device: d })) } });
    assert.ok(model.validatePoint(g).valid);
    const again = model.createPoint({ ...g, now: g.createdAt });
    assert.deepStrictEqual(again.gang.slots.map((x) => x.device), order, 'left -> right preserved exactly');
  });
});

describe('V2-0 store — Point update contract', () => {
  beforeEach(fresh);
  async function seedTwoSheets() {
    await db.putJob(job('J')); await db.putJob(job('K'));
    await db.putSheet(sheet('S1', 'J')); await db.putSheet(sheet('S2', 'J', { order: 1 })); await db.putSheet(sheet('SK', 'K'));
    await db.putPoint(point('P', 'J', 'S1', { name: 'Kitchen Box', x: 0.2, y: 0.2 }));
    return db.getPoint('P');
  }
  test('rename: id, createdAt, position and sheet untouched; only name and updatedAt change', async () => {
    const p = await seedTwoSheets();
    await db.putPoint({ ...p, name: 'Kitchen 3G Box', updatedAt: NOW + 1 });
    const q = await db.getPoint('P');
    assert.strictEqual(q.id, p.id); assert.strictEqual(q.createdAt, p.createdAt);
    assert.strictEqual(q.x, p.x); assert.strictEqual(q.y, p.y); assert.strictEqual(q.sheetId, p.sheetId);
    assert.strictEqual(q.name, 'Kitchen 3G Box'); assert.strictEqual(q.updatedAt, NOW + 1);
  });
  test('move within the same sheet keeps identity and sheet; coordinates change', async () => {
    const p = await seedTwoSheets();
    await db.putPoint({ ...p, x: 0.9, y: 0.1, updatedAt: NOW + 2 });
    const q = await db.getPoint('P');
    assert.strictEqual(q.id, 'P'); assert.strictEqual(q.sheetId, 'S1');
    assert.strictEqual(q.x, 0.9); assert.strictEqual(q.y, 0.1);
    assert.strictEqual((await db.listPoints('S1')).length, 1, 'still listed under its sheet');
  });
  test('move to another sheet in the SAME job succeeds and re-indexes by sheet', async () => {
    const p = await seedTwoSheets();
    await db.putPoint({ ...p, sheetId: 'S2', updatedAt: NOW + 3 });
    assert.deepStrictEqual((await db.listPoints('S1')).map((x) => x.id), []);
    assert.deepStrictEqual((await db.listPoints('S2')).map((x) => x.id), ['P']);
    assert.strictEqual((await db.getPoint('P')).createdAt, NOW, 'createdAt stable across the move');
  });
  test('move to a sheet in ANOTHER job is rejected and the point is byte-identical afterward', async () => {
    const p = await seedTwoSheets();
    const before = JSON.stringify(await db.getPoint('P'));
    await assert.rejects(() => db.putPoint({ ...p, sheetId: 'SK', updatedAt: NOW + 4 }), (e) => e.code === store.ERR.INVALID);
    assert.strictEqual(JSON.stringify(await db.getPoint('P')), before);
    assert.deepStrictEqual((await db.listPoints('SK')).map((x) => x.id), [], 'nothing leaked into the other job');
  });
  test('a connection follows its point across a same-job sheet move: the cable is untouched', async () => {
    await seedTopology();
    const pa = await db.getPoint('PA');
    await db.putPoint({ ...pa, sheetId: 'SB', updatedAt: NOW + 5 });   // now both ends on SB
    const c = await db.getConnection('C1');
    assert.strictEqual(c.fromPointId, 'PA'); assert.strictEqual(c.toPointId, 'PB');
    assert.deepStrictEqual(await db.sheetDeletionImpact('SB'), { exists: true, points: 2, connections: 1, crossSheetConnections: 0 }, 'now a same-sheet cable');
  });
});

describe('V2-0 store — Connection contract, exhaustively', () => {
  beforeEach(fresh);
  test('from/to orientation survives the round-trip exactly as written', async () => {
    await seedTopology();
    await db.putConnection(conn('R', 'J', 'PB', 'PA', { label: 'return' }));
    const r = await db.getConnection('R');
    assert.strictEqual(r.fromPointId, 'PB'); assert.strictEqual(r.toPointId, 'PA');
  });
  test('reversing endpoints is a different connection, not an identity collision', async () => {
    await seedTopology();
    await db.putConnection(conn('C1r', 'J', 'PB', 'PA', { label: 'HR-07' }));
    assert.strictEqual((await db.listConnections('J')).length, 2);
    assert.deepStrictEqual((await db.listConnectionsForPoint('PA')).map((c) => c.id).sort(), ['C1', 'C1r']);
  });
  test('a caller-forged labelKey is rejected on UPDATE too, and the stored key is untouched', async () => {
    await seedTopology();
    const c = await db.getConnection('C1');
    await assert.rejects(() => db.putConnection({ ...c, labelKey: 'forged', updatedAt: NOW + 1 }), (e) => e.code === store.ERR.INVALID);
    assert.strictEqual((await db.getConnection('C1')).labelKey, 'hr-07');
  });
  test('whitespace, underscores, case and hyphen runs all normalize to one key', () => {
    for (const raw of ['HR-07', ' hr-07 ', 'HR 07', 'hr_07', 'HR--07', 'Hr - 07']) {
      assert.strictEqual(conn('c', 'j', 'a', 'b', { label: raw }).labelKey, 'hr-07', JSON.stringify(raw));
    }
    assert.strictEqual(conn('c', 'j', 'a', 'b', { label: '  K 12  ' }).label, 'K 12', 'the display label keeps its own spelling, trimmed');
  });
  test('duplicate labels across DIFFERENT jobs stay isolated in lookup and in listing', async () => {
    await seedTopology();
    await db.putJob(job('K')); await db.putSheet(sheet('SK', 'K'));
    await db.putPoint(point('K1', 'K', 'SK')); await db.putPoint(point('K2', 'K', 'SK'));
    await db.putConnection(conn('CK', 'K', 'K1', 'K2', { label: 'HR-07' }));
    assert.deepStrictEqual((await db.findConnectionsByLabel('J', 'HR-07')).map((c) => c.id), ['C1']);
    assert.deepStrictEqual((await db.findConnectionsByLabel('K', 'HR-07')).map((c) => c.id), ['CK']);
    assert.deepStrictEqual((await db.listConnections('J')).map((c) => c.id), ['C1']);
  });
  test('listConnectionsForPoint returns incoming and outgoing each exactly once', async () => {
    await seedTopology();
    await db.putPoint(point('PC', 'J', 'SA'));
    await db.putConnection(conn('IN', 'J', 'PC', 'PA'));      // PA is the TO end
    await db.putConnection(conn('OUT', 'J', 'PA', 'PC'));     // PA is the FROM end
    const ids = (await db.listConnectionsForPoint('PA')).map((c) => c.id);
    assert.deepStrictEqual(ids.sort(), ['C1', 'IN', 'OUT']);
    assert.strictEqual(new Set(ids).size, ids.length, 'no duplicates');
  });
  test('deleting an UNRELATED point leaves the connection untouched', async () => {
    await seedTopology();
    await db.putPoint(point('PX', 'J', 'SA'));
    const before = JSON.stringify(await db.getConnection('C1'));
    assert.deepStrictEqual(await db.deletePoint('PX'), { deleted: true, points: 1, connections: 0 });
    assert.strictEqual(JSON.stringify(await db.getConnection('C1')), before);
  });
  test('deleting a connection never deletes its points', async () => {
    await seedTopology();
    await db.deleteConnection('C1');
    assert.ok(await db.getPoint('PA') && await db.getPoint('PB'));
    assert.strictEqual((await db.listPointsByJob('J')).length, 2);
  });
});

describe('V2-0 store — cascade and query boundaries', () => {
  beforeEach(fresh);
  test('sheetDeletionImpact separates same-sheet from cross-sheet cables', async () => {
    await seedTopology();                                       // C1: SA -> SB (cross)
    await db.putPoint(point('PA2', 'J', 'SA'));
    await db.putConnection(conn('SAME', 'J', 'PA', 'PA2'));   // both on SA
    assert.deepStrictEqual(await db.sheetDeletionImpact('SA'), { exists: true, points: 2, connections: 2, crossSheetConnections: 1 });
    assert.deepStrictEqual(await db.sheetDeletionImpact('SB'), { exists: true, points: 1, connections: 1, crossSheetConnections: 1 });
  });
  test('job deletion removes only THAT job\'s topology', async () => {
    await seedTopology();
    await db.putJob(job('K')); await db.putSheet(sheet('SK', 'K'));
    await db.putPoint(point('K1', 'K', 'SK')); await db.putPoint(point('K2', 'K', 'SK'));
    await db.putConnection(conn('CK', 'K', 'K1', 'K2'));
    await db.deleteJob('J');
    assert.deepStrictEqual((await db.listPointsByJob('K')).map((p) => p.id), ['K1', 'K2']);
    assert.deepStrictEqual((await db.listConnections('K')).map((c) => c.id), ['CK']);
    assert.strictEqual(await db.getPoint('PA'), null);
  });
  test('cascades on an empty job and an empty sheet are stable no-ops with zero counts', async () => {
    await db.putJob(job('E')); await db.putSheet(sheet('ES', 'E'));
    assert.deepStrictEqual(await db.deleteSheet('ES'), { deleted: true, sheets: 1, annotations: 0, images: 0, points: 0, connections: 0 });
    assert.deepStrictEqual(await db.deleteJob('E'), { deleted: true, sheets: 0, annotations: 0, images: 0, points: 0, connections: 0 });
    assert.deepStrictEqual(await db.deleteJob('E'), { deleted: false, sheets: 0, annotations: 0, images: 0, points: 0, connections: 0 });
  });
  test('[jobId, type] index: listing points by job then filtering by type matches the model enum', async () => {
    await seedTopology();
    await db.putPoint(point('PP', 'J', 'SA', { type: 'panel' }));
    const byType = (await db.listPointsByJob('J')).reduce((m, p) => { m[p.type] = (m[p.type] || 0) + 1; return m; }, {});
    assert.deepStrictEqual(byType, { panel: 2, gangBox: 1 });
    assert.deepStrictEqual(store.STORES.points.indexes[2].keyPath, ['jobId', 'type'], 'the index a type filter would use');
  });
});
