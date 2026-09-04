'use strict';
/**
 * Wire Map persistence — WM-2.
 *
 * Exercised through a small in-memory driver, because Node 22 ships no
 * IndexedDB and this project carries no dependencies. See the driver header
 * for exactly what that does and does not prove.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const store = require('../src/wiremap/store');
const model = require('../src/wiremap/model');
const { createMemoryDriver } = require('./wiremapMemoryDriver');

const NOW = 1_700_000_000_000;
let driver;
let db;

async function fresh() {
  driver = createMemoryDriver();
  db = store.createStore({ driver });
  await db.openDatabase();
}

const job = (id, over) => ({ ...model.createJob({ id, name: `Job ${id}`, now: NOW }), ...over });
const sheet = (id, jobId, over) => ({
  ...model.createSheet({ id, jobId, name: `Sheet ${id}`, kind: 'blank',
    width: 1000, height: 1000, order: 0, now: NOW }),
  ...over,
});
const label = (id, sheetId, text, over) => ({
  ...model.createAnnotation({ id, sheetId, type: 'wireLabel', at: { x: 0.4, y: 0.6 }, now: NOW,
    data: { label: text, from: 'Panel A / 18', to: 'Bedroom', cable: '12/2 MC', room: 'Bedroom', notes: '' } }),
  ...over,
});

describe('WM-2 store — schema', () => {
  test('the database name and version are as specified', () => {
    assert.strictEqual(store.DB_NAME, 'empire-wiremap');
    // V2-0: schema version 2 adds the points/connections stores additively.
    assert.strictEqual(store.DB_VERSION, 2);
  });

  test('the legacy object stores and the V2-0 topology stores are defined with the right keyPaths', () => {
    // The five v1 stores keep their names AND their order; V2-0 appends two.
    assert.deepStrictEqual(store.STORE_NAMES.slice(0, 5), ['jobs', 'sheets', 'annotations', 'images', 'meta']);
    assert.deepStrictEqual(store.STORE_NAMES.slice(5), ['points', 'connections']);
    assert.strictEqual(store.STORES.jobs.keyPath, 'id');
    assert.strictEqual(store.STORES.sheets.keyPath, 'id');
    assert.strictEqual(store.STORES.annotations.keyPath, 'id');
    assert.strictEqual(store.STORES.images.keyPath, 'id');
    assert.strictEqual(store.STORES.meta.keyPath, 'key');
  });

  test('the required indexes are declared', () => {
    const names = (s) => store.STORES[s].indexes.map((i) => i.name);
    assert.deepStrictEqual(names('jobs'), ['updatedAt', 'name']);
    assert.deepStrictEqual(names('sheets'), ['jobId', 'jobId_order']);
    assert.deepStrictEqual(names('annotations'), ['sheetId', 'labelKey', 'sheetId_labelKey']);
  });

  test('compound indexes use array keyPaths', () => {
    const sheetsIdx = store.STORES.sheets.indexes.find((i) => i.name === 'jobId_order');
    assert.deepStrictEqual(sheetsIdx.keyPath, ['jobId', 'order']);
    const annIdx = store.STORES.annotations.indexes.find((i) => i.name === 'sheetId_labelKey');
    assert.deepStrictEqual(annIdx.keyPath, ['sheetId', 'data.labelKey']);
  });

  test('the labelKey index points at the model-derived field', () => {
    const idx = store.STORES.annotations.indexes.find((i) => i.name === 'labelKey');
    assert.strictEqual(idx.keyPath, 'data.labelKey');
  });

  test('schema creation is idempotent — reopening a v1 database recreates nothing', async () => {
    const d = createMemoryDriver();
    const a = store.createStore({ driver: d });
    await a.openDatabase();
    await a.putJob(job('j1'));
    a.closeDatabase();

    const b = store.createStore({ driver: d });
    await b.openDatabase();
    assert.ok(await b.getJob('j1'), 'data was lost when the database was reopened');
    b.closeDatabase();
  });

  test('applySchemaV1 skips stores that already exist', () => {
    const created = [];
    store.applySchemaV1({
      existing: ['jobs', 'sheets'],
      createStore(name) { created.push(name); return { createIndex() {} }; },
    });
    // V2-0: the same additive pass now also creates the two topology stores
    assert.deepStrictEqual(created, ['annotations', 'images', 'meta', 'points', 'connections']);
  });
});

describe('WM-2 store — unavailable IndexedDB', () => {
  test('a missing IndexedDB fails clearly rather than hanging', async () => {
    const s = store.createStore({ factory: null });
    await assert.rejects(() => s.openDatabase(), (e) => {
      assert.strictEqual(e.code, store.ERR.UNAVAILABLE);
      assert.ok(/not available/i.test(e.message));
      return true;
    });
  });

  test('operating before openDatabase() gives a clear error', async () => {
    const s = store.createStore({ driver: createMemoryDriver() });
    await assert.rejects(() => s.putJob(job('j1')), (e) => e.code === store.ERR.NOT_OPEN);
  });

  test('errors carry a structured code, not just a message', async () => {
    await fresh();
    await assert.rejects(() => db.getJob(''), (e) => {
      assert.strictEqual(e.name, 'StoreError');
      assert.strictEqual(e.code, store.ERR.BAD_ARGUMENT);
      return true;
    });
  });
});

describe('WM-2 store — jobs', () => {
  beforeEach(fresh);

  test('put then get round-trips', async () => {
    await db.putJob(job('j1', { name: 'Baylander', address: '1 Pier' }));
    const got = await db.getJob('j1');
    assert.strictEqual(got.name, 'Baylander');
    assert.strictEqual(got.address, '1 Pier');
  });

  test('putting the same id updates rather than duplicating', async () => {
    await db.putJob(job('j1', { name: 'First' }));
    await db.putJob(job('j1', { name: 'Second', updatedAt: NOW + 10 }));
    assert.strictEqual((await db.getJob('j1')).name, 'Second');
    assert.strictEqual((await db.listJobs()).length, 1);
  });

  test('an invalid job is rejected before it reaches storage', async () => {
    await assert.rejects(() => db.putJob({ ...job('j1'), name: '' }), (e) => {
      assert.strictEqual(e.code, store.ERR.INVALID);
      assert.ok(Array.isArray(e.detail) && e.detail.some((p) => /name/.test(p)));
      return true;
    });
    assert.strictEqual((await db.listJobs()).length, 0, 'the invalid job was stored anyway');
  });

  test('validation comes from the model, not a second implementation', async () => {
    // Anything the model rejects, the store must reject too.
    const bad = { ...job('j1'), createdAt: 'yesterday' };
    assert.strictEqual(model.validateJob(bad).valid, false);
    await assert.rejects(() => db.putJob(bad), (e) => e.code === store.ERR.INVALID);
  });

  test('listJobs returns newest updatedAt first', async () => {
    await db.putJob(job('a', { updatedAt: NOW + 1 }));
    await db.putJob(job('b', { updatedAt: NOW + 300 }));
    await db.putJob(job('c', { updatedAt: NOW + 50 }));
    assert.deepStrictEqual((await db.listJobs()).map((j) => j.id), ['b', 'c', 'a']);
  });

  test('ties are broken deterministically by id', async () => {
    await db.putJob(job('z', { updatedAt: NOW }));
    await db.putJob(job('m', { updatedAt: NOW }));
    await db.putJob(job('a', { updatedAt: NOW }));
    const first = (await db.listJobs()).map((j) => j.id);
    const second = (await db.listJobs()).map((j) => j.id);
    assert.deepStrictEqual(first, ['a', 'm', 'z']);
    assert.deepStrictEqual(first, second, 'ordering must be repeatable');
  });

  test('getting an unknown job yields null, not a throw', async () => {
    assert.strictEqual(await db.getJob('nope'), null);
  });

  test('deleting a job with no children reports what it removed', async () => {
    await db.putJob(job('j1'));
    assert.deepStrictEqual(await db.deleteJob('j1'),
      { deleted: true, sheets: 0, annotations: 0, images: 0, points: 0, connections: 0 });   // V2-0 reports topology too
    assert.strictEqual(await db.getJob('j1'), null);
  });

  test('deleting an unknown job is a no-op, not an error', async () => {
    assert.deepStrictEqual(await db.deleteJob('ghost'),
      { deleted: false, sheets: 0, annotations: 0, images: 0, points: 0, connections: 0 });
  });
});

describe('WM-2 store — sheets and referential integrity', () => {
  beforeEach(async () => { await fresh(); await db.putJob(job('j1')); });

  test('put then get round-trips', async () => {
    await db.putSheet(sheet('s1', 'j1', { name: 'Floor 2' }));
    assert.strictEqual((await db.getSheet('s1')).name, 'Floor 2');
  });

  test('a sheet referencing a missing job is REJECTED', async () => {
    await assert.rejects(() => db.putSheet(sheet('s1', 'ghost')), (e) => {
      assert.strictEqual(e.code, store.ERR.MISSING_PARENT);
      assert.strictEqual(e.detail.jobId, 'ghost');
      return true;
    });
    assert.strictEqual(await db.getSheet('s1'), null, 'an orphan sheet was stored');
  });

  test('an invalid sheet is rejected by model validation', async () => {
    await assert.rejects(() => db.putSheet(sheet('s1', 'j1', { kind: 'pdf' })),
      (e) => e.code === store.ERR.INVALID);
    // A blank sheet must not carry an image.
    await assert.rejects(() => db.putSheet(sheet('s2', 'j1', { imageId: 'img1' })),
      (e) => e.code === store.ERR.INVALID);
  });

  test('listSheets returns ascending order', async () => {
    await db.putSheet(sheet('s3', 'j1', { order: 2 }));
    await db.putSheet(sheet('s1', 'j1', { order: 0 }));
    await db.putSheet(sheet('s2', 'j1', { order: 1 }));
    assert.deepStrictEqual((await db.listSheets('j1')).map((s) => s.id), ['s1', 's2', 's3']);
  });

  test('equal order values break the tie by id, repeatably', async () => {
    await db.putSheet(sheet('sz', 'j1', { order: 0 }));
    await db.putSheet(sheet('sa', 'j1', { order: 0 }));
    const ids = (await db.listSheets('j1')).map((s) => s.id);
    assert.deepStrictEqual(ids, ['sa', 'sz']);
    assert.deepStrictEqual((await db.listSheets('j1')).map((s) => s.id), ids);
  });

  test('listSheets is scoped to one job', async () => {
    await db.putJob(job('j2'));
    await db.putSheet(sheet('s1', 'j1'));
    await db.putSheet(sheet('s2', 'j2'));
    assert.deepStrictEqual((await db.listSheets('j1')).map((s) => s.id), ['s1']);
    assert.deepStrictEqual((await db.listSheets('j2')).map((s) => s.id), ['s2']);
  });
});

describe('WM-2 store — annotations', () => {
  beforeEach(async () => {
    await fresh();
    await db.putJob(job('j1'));
    await db.putSheet(sheet('s1', 'j1'));
  });

  test('put then get round-trips with every wire-label field', async () => {
    await db.putAnnotation(label('a1', 's1', 'HR-7'));
    const got = await db.getAnnotation('a1');
    assert.strictEqual(got.data.label, 'HR-7');
    assert.strictEqual(got.data.cable, '12/2 MC');
    assert.strictEqual(got.data.from, 'Panel A / 18');
    assert.deepStrictEqual(got.at, { x: 0.4, y: 0.6 });
  });

  test('an annotation referencing a missing sheet is REJECTED', async () => {
    await assert.rejects(() => db.putAnnotation(label('a1', 'ghost', 'HR-7')), (e) => {
      assert.strictEqual(e.code, store.ERR.MISSING_PARENT);
      assert.strictEqual(e.detail.sheetId, 'ghost');
      return true;
    });
    assert.strictEqual(await db.getAnnotation('a1'), null);
  });

  test('labelKey stays model-derived through a full round trip', async () => {
    await db.putAnnotation(label('a1', 's1', 'HR 07'));
    const got = await db.getAnnotation('a1');
    assert.strictEqual(got.data.labelKey, 'hr-07');
    assert.strictEqual(got.data.labelKey, model.toLabelKey('HR 07'));
  });

  test('an annotation whose labelKey was tampered with is rejected', async () => {
    const a = label('a1', 's1', 'HR-7');
    a.data.labelKey = 'something-else';
    await assert.rejects(() => db.putAnnotation(a), (e) => e.code === store.ERR.INVALID);
  });

  test('out-of-range coordinates are rejected', async () => {
    await assert.rejects(() => db.putAnnotation(label('a1', 's1', 'HR-7', { at: { x: 1.5, y: 0.5 } })),
      (e) => e.code === store.ERR.INVALID);
  });

  test('listAnnotations orders oldest first, then by id', async () => {
    await db.putAnnotation(label('a3', 's1', 'C', { createdAt: NOW + 30 }));
    await db.putAnnotation(label('a1', 's1', 'A', { createdAt: NOW + 10 }));
    await db.putAnnotation(label('a2', 's1', 'B', { createdAt: NOW + 20 }));
    assert.deepStrictEqual((await db.listAnnotations('s1')).map((a) => a.id), ['a1', 'a2', 'a3']);

    await db.putAnnotation(label('az', 's1', 'D', { createdAt: NOW + 10 }));
    const ids = (await db.listAnnotations('s1')).map((a) => a.id);
    assert.deepStrictEqual(ids, ['a1', 'az', 'a2', 'a3']);
    assert.deepStrictEqual((await db.listAnnotations('s1')).map((a) => a.id), ids);
  });

  test('listAnnotations is scoped to one sheet', async () => {
    await db.putSheet(sheet('s2', 'j1', { order: 1 }));
    await db.putAnnotation(label('a1', 's1', 'HR-7'));
    await db.putAnnotation(label('a2', 's2', 'HR-8'));
    assert.deepStrictEqual((await db.listAnnotations('s1')).map((a) => a.id), ['a1']);
  });

  test('deleting one annotation leaves its siblings alone', async () => {
    await db.putAnnotation(label('a1', 's1', 'HR-7'));
    await db.putAnnotation(label('a2', 's1', 'HR-8', { createdAt: NOW + 5 }));
    await db.deleteAnnotation('a1');
    assert.strictEqual(await db.getAnnotation('a1'), null);
    assert.ok(await db.getAnnotation('a2'));
  });
});

describe('WM-2 store — cascade delete', () => {
  beforeEach(async () => {
    await fresh();
    await db.putJob(job('j1'));
    await db.putJob(job('j2'));                       // bystander
    await db.putSheet(sheet('s1', 'j1', { order: 0 }));
    await db.putSheet(sheet('s2', 'j1', { order: 1, kind: 'photo', imageId: 'img2' }));
    await db.putSheet(sheet('s9', 'j2', { order: 0 }));  // bystander
    // putImage now requires a blob — WM-3 made the contract explicit.
    await db.putImage({ id: 'img2', blob: { size: 1, type: 'image/jpeg' },
      mime: 'image/jpeg', width: 10, height: 10, bytes: 1, createdAt: NOW });
    await db.putAnnotation(label('a1', 's1', 'HR-7'));
    await db.putAnnotation(label('a2', 's1', 'HR-8', { createdAt: NOW + 1 }));
    await db.putAnnotation(label('a3', 's2', 'HR-9'));
    await db.putAnnotation(label('a9', 's9', 'ZZ-1'));   // bystander
  });

  test('deleting a sheet removes its annotations', async () => {
    const r = await db.deleteSheet('s1');
    assert.deepStrictEqual(r, { deleted: true, sheets: 1, annotations: 2, images: 0, points: 0, connections: 0 });
    assert.strictEqual(await db.getSheet('s1'), null);
    assert.strictEqual(await db.getAnnotation('a1'), null);
    assert.strictEqual(await db.getAnnotation('a2'), null);
  });

  test('deleting a sheet removes its referenced image', async () => {
    assert.ok(await db.getImage('img2'));
    const r = await db.deleteSheet('s2');
    assert.strictEqual(r.images, 1);
    assert.strictEqual(await db.getImage('img2'), null);
  });

  test('deleting a sheet leaves other sheets and their annotations intact', async () => {
    await db.deleteSheet('s1');
    assert.ok(await db.getSheet('s2'));
    assert.ok(await db.getAnnotation('a3'));
    assert.ok(await db.getSheet('s9'));
    assert.ok(await db.getAnnotation('a9'));
  });

  test('deleting a job removes every descendant sheet and annotation', async () => {
    const r = await db.deleteJob('j1');
    assert.deepStrictEqual(r, { deleted: true, sheets: 2, annotations: 3, images: 1, points: 0, connections: 0 });
    assert.strictEqual(await db.getJob('j1'), null);
    for (const id of ['s1', 's2']) assert.strictEqual(await db.getSheet(id), null, id);
    for (const id of ['a1', 'a2', 'a3']) assert.strictEqual(await db.getAnnotation(id), null, id);
    assert.strictEqual(await db.getImage('img2'), null);
  });

  test('an unrelated job survives the cascade untouched', async () => {
    await db.deleteJob('j1');
    assert.ok(await db.getJob('j2'));
    assert.deepStrictEqual((await db.listSheets('j2')).map((s) => s.id), ['s9']);
    assert.deepStrictEqual((await db.listAnnotations('s9')).map((a) => a.id), ['a9']);
  });

  test('nothing is orphaned: no annotation outlives its sheet', async () => {
    await db.deleteJob('j1');
    for (const sheetId of ['s1', 's2']) {
      assert.deepStrictEqual(await db.listAnnotations(sheetId), []);
    }
  });

  test('A FAILED CASCADE LEAVES NOTHING PARTIALLY DELETED', async () => {
    // The whole point of doing this in one transaction. Break the images store
    // mid-cascade and the job, its sheets and its annotations must all remain.
    driver.__breakStore('empire-wiremap', 'images');
    await assert.rejects(() => db.deleteJob('j1'));

    assert.ok(await db.getJob('j1'), 'the job was deleted despite the failure');
    assert.ok(await db.getSheet('s1'), 'a sheet was deleted despite the failure');
    assert.ok(await db.getSheet('s2'));
    for (const id of ['a1', 'a2', 'a3']) {
      assert.ok(await db.getAnnotation(id), `annotation ${id} was deleted despite the failure`);
    }
  });

  test('a failed sheet cascade is equally all-or-nothing', async () => {
    driver.__breakStore('empire-wiremap', 'images');
    await assert.rejects(() => db.deleteSheet('s1'));
    assert.ok(await db.getSheet('s1'));
    assert.ok(await db.getAnnotation('a1'));
    assert.ok(await db.getAnnotation('a2'));
  });
});

describe('WM-2 store — meta and lifecycle', () => {
  beforeEach(fresh);

  test('meta round-trips and overwrites by key', async () => {
    await db.setMeta('schemaNote', 'v1');
    assert.strictEqual(await db.getMeta('schemaNote'), 'v1');
    await db.setMeta('schemaNote', 'v1-updated');
    assert.strictEqual(await db.getMeta('schemaNote'), 'v1-updated');
  });

  test('an unknown meta key yields null', async () => {
    assert.strictEqual(await db.getMeta('nothing'), null);
  });

  test('THE WM-2 GOAL: data survives closing and reopening the connection', async () => {
    await db.putJob(job('j1', { name: 'Baylander' }));
    await db.putSheet(sheet('s1', 'j1', { name: 'Main deck' }));
    await db.putAnnotation(label('a1', 's1', 'HR-7'));

    db.closeDatabase();
    assert.strictEqual(db.isOpen(), false);

    const reopened = store.createStore({ driver });
    await reopened.openDatabase();
    assert.strictEqual((await reopened.getJob('j1')).name, 'Baylander');
    assert.strictEqual((await reopened.getSheet('s1')).name, 'Main deck');
    const a = await reopened.getAnnotation('a1');
    assert.strictEqual(a.data.label, 'HR-7');
    assert.strictEqual(a.data.labelKey, 'hr-7');   // 'HR-7' has no leading zero
    reopened.closeDatabase();
  });

  test('openDatabase is idempotent and closeDatabase is safe to repeat', async () => {
    await db.openDatabase();
    await db.openDatabase();
    assert.strictEqual(driver.__state.openConnections, 1);
    db.closeDatabase();
    db.closeDatabase();
    assert.strictEqual(driver.__state.openConnections, 0);
  });
});

// ── WM-8: atomic sheet reordering ───────────────────────────────────────────
describe('WM-8 reorderSheets', () => {
  const now = 1;
  const build = async () => {
    const db = store.createStore({ driver: createMemoryDriver() });
    await db.openDatabase();
    await db.putJob(model.createJob({ id: 'jA', name: 'A', now }));
    await db.putJob(model.createJob({ id: 'jB', name: 'B', now }));
    for (const [id, order] of [['a', 0], ['b', 1], ['c', 2]]) {
      await db.putSheet(model.createSheet({ id, jobId: 'jA', name: id.toUpperCase(),
        kind: 'blank', width: 2000, height: 1500, order, now }));
    }
    await db.putSheet(model.createSheet({ id: 'x', jobId: 'jB', name: 'X',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    return db;
  };
  const orderOf = async (db, jobId) => {
    const list = await db.listSheets(jobId);
    return list.slice().sort((p, q) => p.order - q.order).map((s) => s.id + ':' + s.order);
  };

  test('rewrites order compactly from zero', async () => {
    const db = await build();
    await db.reorderSheets('jA', ['c', 'a', 'b']);
    assert.deepStrictEqual(await orderOf(db, 'jA'), ['c:0', 'a:1', 'b:2']);
  });

  test('the new order survives a reopen', async () => {
    const driver = createMemoryDriver();
    const db = store.createStore({ driver });
    await db.openDatabase();
    await db.putJob(model.createJob({ id: 'jA', name: 'A', now }));
    for (const [id, order] of [['a', 0], ['b', 1]]) {
      await db.putSheet(model.createSheet({ id, jobId: 'jA', name: id, kind: 'blank',
        width: 2000, height: 1500, order, now }));
    }
    await db.reorderSheets('jA', ['b', 'a']);
    db.closeDatabase();
    const again = store.createStore({ driver });
    await again.openDatabase();
    assert.deepStrictEqual(await orderOf(again, 'jA'), ['b:0', 'a:1']);
  });

  test('an unknown sheet id is rejected', async () => {
    const db = await build();
    await assert.rejects(() => db.reorderSheets('jA', ['a', 'ghost', 'b']));
    assert.deepStrictEqual(await orderOf(db, 'jA'), ['a:0', 'b:1', 'c:2'], 'order must be untouched');
  });

  test('A SHEET FROM ANOTHER JOB IS REJECTED', async () => {
    const db = await build();
    await assert.rejects(() => db.reorderSheets('jA', ['a', 'x', 'b']));
    assert.deepStrictEqual(await orderOf(db, 'jA'), ['a:0', 'b:1', 'c:2']);
    assert.deepStrictEqual(await orderOf(db, 'jB'), ['x:0'], 'the other job must be untouched');
  });

  test('duplicate ids are rejected', async () => {
    const db = await build();
    await assert.rejects(() => db.reorderSheets('jA', ['a', 'a', 'b']));
    assert.deepStrictEqual(await orderOf(db, 'jA'), ['a:0', 'b:1', 'c:2']);
  });

  test('bad arguments are rejected without touching anything', async () => {
    const db = await build();
    for (const bad of [[null, ['a']], ['jA', []], ['jA', null], ['jA', ['a', 7]]]) {
      await assert.rejects(() => db.reorderSheets(bad[0], bad[1]));
    }
    assert.deepStrictEqual(await orderOf(db, 'jA'), ['a:0', 'b:1', 'c:2']);
  });

  test('VALIDATION HAPPENS BEFORE ANY WRITE — no partial reorder', async () => {
    const db = await build();
    // 'ghost' sits last, so a naive implementation would already have written
    // the first two sheets by the time it failed.
    await assert.rejects(() => db.reorderSheets('jA', ['c', 'b', 'ghost']));
    assert.deepStrictEqual(await orderOf(db, 'jA'), ['a:0', 'b:1', 'c:2']);
  });

  test('no duplicate order values result from repeated reorders', async () => {
    const db = await build();
    for (const seq of [['b', 'a', 'c'], ['c', 'b', 'a'], ['a', 'c', 'b']]) {
      await db.reorderSheets('jA', seq);
      const list = await db.listSheets('jA');
      assert.strictEqual(new Set(list.map((s) => s.order)).size, 3);
    }
  });
});
