'use strict';
/** Sheet manager logic — WM-8. Pure ordering and validation, run in Node. */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const K = require('../src/wiremap/sheets');
const model = require('../src/wiremap/model');

const sheet = (id, name, order, kind) => model.createSheet({ id, jobId: 'j1', name,
  kind: kind || 'blank', width: 2000, height: 1500, order, now: 1 });
const THREE = [sheet('a', '1F Plan', 0), sheet('b', '2F Plan', 1), sheet('c', 'Roof', 2)];
const ids = (list) => list.map((s) => s.id);
const orders = (list) => list.map((s) => s.order);

describe('WM-8 sheet names', () => {
  test('names are trimmed', () => {
    assert.strictEqual(K.normalizeName('  1F Plan  '), '1F Plan');
  });

  test('blank names are rejected', () => {
    for (const bad of ['', '   ', '\t\n', null, undefined, 7, {}]) {
      assert.strictEqual(K.normalizeName(bad), null, JSON.stringify(bad));
      assert.strictEqual(K.isValidName(bad), false);
    }
  });

  test('names cap at 80 characters', () => {
    assert.strictEqual(K.MAX_NAME_LENGTH, 80);
    assert.strictEqual(K.normalizeName('x'.repeat(200)).length, 80);
  });

  test('Unicode survives intact', () => {
    assert.strictEqual(K.normalizeName('  Piwnica \u2013 rozdzielnia \u00e7\u00f6  '),
      'Piwnica \u2013 rozdzielnia \u00e7\u00f6');
  });

  test('HTML-looking names are kept LITERALLY, not stripped', () => {
    const raw = '<script>alert(1)</script>';
    assert.strictEqual(K.normalizeName(raw), raw);
    assert.strictEqual(model.validateSheet(sheet('x', raw, 0)).valid, true);
  });

  test('interior spacing is preserved', () => {
    assert.strictEqual(K.normalizeName('Panel  Room   B'), 'Panel  Room   B');
  });
});

describe('WM-8 ordering', () => {
  test('order normalizes to compact integers from zero', () => {
    const messy = [sheet('a', 'A', 7), sheet('b', 'B', 2), sheet('c', 'C', 99)];
    const out = K.normalizeOrder(messy);
    assert.deepStrictEqual(orders(out), [0, 1, 2]);
    assert.deepStrictEqual(ids(out), ['b', 'a', 'c']);
  });

  test('duplicate order values break deterministically on id', () => {
    const dupes = [sheet('z', 'Z', 1), sheet('a', 'A', 1), sheet('m', 'M', 1)];
    const first = ids(K.normalizeOrder(dupes));
    assert.deepStrictEqual(first, ['a', 'm', 'z']);
    // Shuffling the input must not change the answer.
    assert.deepStrictEqual(ids(K.normalizeOrder([dupes[2], dupes[0], dupes[1]])), first);
  });

  test('a missing order is treated as last, not as zero', () => {
    const partial = [{ id: 'a', name: 'A' }, sheet('b', 'B', 0)];
    assert.deepStrictEqual(ids(K.normalizeOrder(partial)), ['b', 'a']);
  });

  test('moving up swaps with the previous sheet', () => {
    const out = K.moveUp(THREE, 'c');
    assert.deepStrictEqual(ids(out), ['a', 'c', 'b']);
    assert.deepStrictEqual(orders(out), [0, 1, 2]);
  });

  test('moving down swaps with the next sheet', () => {
    assert.deepStrictEqual(ids(K.moveDown(THREE, 'a')), ['b', 'a', 'c']);
  });

  test('THE FIRST SHEET CANNOT MOVE UP', () => {
    assert.strictEqual(K.canMoveUp(THREE, 'a'), false);
    assert.deepStrictEqual(ids(K.moveUp(THREE, 'a')), ['a', 'b', 'c']);
  });

  test('THE LAST SHEET CANNOT MOVE DOWN', () => {
    assert.strictEqual(K.canMoveDown(THREE, 'c'), false);
    assert.deepStrictEqual(ids(K.moveDown(THREE, 'c')), ['a', 'b', 'c']);
  });

  test('middle sheets can move both ways', () => {
    assert.strictEqual(K.canMoveUp(THREE, 'b'), true);
    assert.strictEqual(K.canMoveDown(THREE, 'b'), true);
  });

  test('a move never mutates the input or changes ids and names', () => {
    const snapshot = JSON.stringify(THREE);
    const out = K.moveUp(THREE, 'c');
    assert.strictEqual(JSON.stringify(THREE), snapshot, 'input was mutated');
    assert.deepStrictEqual(out.map((s) => s.name).sort(), THREE.map((s) => s.name).sort());
    assert.deepStrictEqual(ids(out).slice().sort(), ids(THREE).slice().sort());
  });

  test('a move preserves every other sheet field', () => {
    const photo = sheet('p', 'Roof', 1, 'photo');
    photo.imageId = 'img-1';
    const out = K.moveUp([sheet('a', 'A', 0), photo], 'p');
    const moved = out.find((s) => s.id === 'p');
    assert.strictEqual(moved.imageId, 'img-1');
    assert.strictEqual(moved.kind, 'photo');
    assert.strictEqual(moved.width, 2000);
  });

  test('an unknown id leaves the order untouched', () => {
    assert.deepStrictEqual(ids(K.moveUp(THREE, 'nope')), ['a', 'b', 'c']);
  });

  test('a new sheet takes the last order', () => {
    assert.strictEqual(K.nextOrder(THREE), 3);
    assert.strictEqual(K.nextOrder([]), 0);
  });

  test('repeated moves stay compact with no duplicate order values', () => {
    let list = THREE;
    for (const step of [['c', 'up'], ['c', 'up'], ['a', 'down'], ['b', 'down']]) {
      list = step[1] === 'up' ? K.moveUp(list, step[0]) : K.moveDown(list, step[0]);
      assert.deepStrictEqual(orders(list), [0, 1, 2]);
      assert.strictEqual(new Set(orders(list)).size, 3);
    }
  });
});

describe('WM-8 delete planning', () => {
  test('deleting a NON-current sheet leaves the current one alone', () => {
    const plan = K.planDelete(THREE, 'c', 'a');
    assert.strictEqual(plan.allowed, true);
    assert.strictEqual(plan.nextCurrentId, 'a');
    assert.deepStrictEqual(ids(plan.remaining), ['a', 'b']);
  });

  test('deleting the current MIDDLE sheet moves to the NEXT one', () => {
    const plan = K.planDelete(THREE, 'b', 'b');
    assert.strictEqual(plan.nextCurrentId, 'c');
  });

  test('deleting the current LAST sheet falls back to the PREVIOUS one', () => {
    const plan = K.planDelete(THREE, 'c', 'c');
    assert.strictEqual(plan.nextCurrentId, 'b');
  });

  test('deleting the current FIRST sheet moves to the next', () => {
    assert.strictEqual(K.planDelete(THREE, 'a', 'a').nextCurrentId, 'b');
  });

  test('THE LAST REMAINING SHEET CANNOT BE DELETED', () => {
    const one = [sheet('solo', 'Only', 0)];
    assert.strictEqual(K.canDelete(one), false);
    const plan = K.planDelete(one, 'solo', 'solo');
    assert.strictEqual(plan.allowed, false);
    assert.match(plan.reason, /At least one Sheet/);
    assert.deepStrictEqual(ids(plan.remaining), ['solo'], 'nothing may be removed');
  });

  test('two sheets can still be reduced to one', () => {
    assert.strictEqual(K.canDelete([sheet('a', 'A', 0), sheet('b', 'B', 1)]), true);
  });

  test('the remaining order compacts after a delete', () => {
    const plan = K.planDelete(THREE, 'a', 'c');
    assert.deepStrictEqual(orders(plan.remaining), [0, 1]);
    assert.deepStrictEqual(ids(plan.remaining), ['b', 'c']);
  });

  test('an unknown sheet id is refused rather than corrupting the list', () => {
    const plan = K.planDelete(THREE, 'ghost', 'a');
    assert.strictEqual(plan.allowed, false);
    assert.deepStrictEqual(ids(plan.remaining), ['a', 'b', 'c']);
  });

  test('planning never mutates the input', () => {
    const snapshot = JSON.stringify(THREE);
    K.planDelete(THREE, 'b', 'b');
    assert.strictEqual(JSON.stringify(THREE), snapshot);
  });
});

describe('WM-8 rename', () => {
  test('a real change produces a new record with the same identity', () => {
    const out = K.renamed(THREE[0], '  Ground Floor  ', 99);
    assert.strictEqual(out.name, 'Ground Floor');
    assert.strictEqual(out.id, 'a');
    assert.strictEqual(out.jobId, 'j1');
    assert.strictEqual(out.kind, 'blank');
    assert.strictEqual(out.order, 0);
    assert.strictEqual(out.width, 2000);
    assert.strictEqual(out.updatedAt, 99);
  });

  test('AN UNCHANGED NAME RETURNS NULL so the caller can skip the write', () => {
    assert.strictEqual(K.renamed(THREE[0], '1F Plan', 99), null);
    assert.strictEqual(K.renamed(THREE[0], '  1F Plan  ', 99), null, 'trim first, then compare');
  });

  test('an invalid name returns null', () => {
    assert.strictEqual(K.renamed(THREE[0], '   ', 99), null);
    assert.strictEqual(K.renamed(null, 'X', 99), null);
  });

  test('renaming does not mutate the original sheet', () => {
    const before = JSON.stringify(THREE[0]);
    K.renamed(THREE[0], 'Ground Floor', 99);
    assert.strictEqual(JSON.stringify(THREE[0]), before);
  });

  test('a renamed sheet still validates against the model', () => {
    const out = K.renamed(THREE[0], '<script>alert(1)</script>', 99);
    assert.strictEqual(model.validateSheet(out).valid, true);
    assert.strictEqual(out.name, '<script>alert(1)</script>');
  });
});

describe('WM-8 presentation helpers', () => {
  test('kind labels are human, not raw values', () => {
    assert.strictEqual(K.kindLabel('blank'), 'Blank');
    assert.strictEqual(K.kindLabel('photo'), 'Photo');
    assert.strictEqual(K.kindLabel('image'), 'Image');
  });

  test('an unknown kind degrades rather than showing nothing', () => {
    assert.strictEqual(K.kindLabel('mystery'), 'mystery');
    assert.strictEqual(K.kindLabel(undefined), 'Sheet');
  });

  test('the module touches no DOM or storage', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'src', 'wiremap', 'sheets.js'), 'utf8');
    assert.ok(!/document|window|indexedDB|innerHTML|require\('\.\/(store|app)/.test(src));
  });
});
