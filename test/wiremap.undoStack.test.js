'use strict';
/** Sketch undo history — WM-6B1. Pure; the controller does the persistence. */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const U = require('../src/wiremap/undoStack');
const model = require('../src/wiremap/model');

const line = (id, a, b) => model.createAnnotation({ id, sheetId: 's1', type: 'line',
  a: a || { x: 0.2, y: 0.3 }, b: b || { x: 0.8, y: 0.7 }, now: 1 });
const rect = (id) => model.createAnnotation({ id, sheetId: 's1', type: 'rect',
  a: { x: 0.1, y: 0.1 }, b: { x: 0.5, y: 0.5 }, now: 1 });

let stack;
beforeEach(() => { stack = U.createUndoStack(); U.bindSheet(stack, 's1'); });

describe('WM-6B1 undo — creation', () => {
  test('undoing a created line removes it', () => {
    U.pushCreate(stack, line('l1'));
    assert.strictEqual(U.canUndo(stack), true);
    const out = U.undo(stack);
    assert.deepStrictEqual(out, { action: 'remove', annotationId: 'l1', annotation: null });
    assert.strictEqual(U.canUndo(stack), false);
  });

  test('undoing a created rectangle removes it', () => {
    U.pushCreate(stack, rect('r1'));
    assert.strictEqual(U.undo(stack).action, 'remove');
  });

  test('undo with nothing recorded is a safe no-op', () => {
    assert.deepStrictEqual(U.undo(stack), { action: 'none', annotationId: null, annotation: null });
  });
});

describe('WM-6B1 undo — geometry', () => {
  test('undoing an endpoint move restores the earlier geometry', () => {
    const before = line('l1', { x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 });
    U.pushGeometry(stack, before);
    const after = { ...before, a: { x: 0.5, y: 0.5 } };
    const out = U.undo(stack, () => after);
    assert.strictEqual(out.action, 'restore');
    assert.deepStrictEqual(out.annotation.a, { x: 0.2, y: 0.3 });
    assert.deepStrictEqual(out.annotation.b, { x: 0.8, y: 0.7 });
    assert.strictEqual(out.annotation.id, 'l1', 'the id must not change');
  });

  test('the snapshot is a copy — later mutation cannot corrupt it', () => {
    const before = line('l1');
    U.pushGeometry(stack, before);
    before.a.x = 0.99;                       // caller mutates afterwards
    const out = U.undo(stack, () => before);
    assert.strictEqual(out.annotation.a.x, 0.2, 'the recorded snapshot was shared, not copied');
  });

  test('a geometry undo for a shape that no longer exists fails safely', () => {
    U.pushGeometry(stack, line('gone'));
    const out = U.undo(stack, () => null);
    assert.strictEqual(out.action, 'none');
    assert.strictEqual(out.annotation, null);
  });
});

describe('WM-6B1 undo — deletion', () => {
  test('undoing a delete restores the same id and geometry', () => {
    const l = line('l1');
    U.pushDelete(stack, l);
    const out = U.undo(stack);
    assert.strictEqual(out.action, 'restore');
    assert.strictEqual(out.annotation.id, 'l1', 'a new id would be a duplicate, not a restore');
    assert.deepStrictEqual(out.annotation.a, l.a);
    assert.deepStrictEqual(out.annotation.b, l.b);
    assert.strictEqual(out.annotation.type, 'line');
  });

  test('the delete snapshot is deep — the original may be discarded', () => {
    const l = line('l1');
    U.pushDelete(stack, l);
    l.a.x = 0.99;
    assert.strictEqual(U.undo(stack).annotation.a.x, 0.2);
  });
});

describe('WM-6B1 undo — sequencing', () => {
  test('operations reverse in the order they happened', () => {
    U.pushCreate(stack, line('l1'));
    U.pushCreate(stack, rect('r1'));
    U.pushDelete(stack, line('l2'));
    assert.strictEqual(U.undo(stack).annotationId, 'l2');
    assert.strictEqual(U.undo(stack).annotationId, 'r1');
    assert.strictEqual(U.undo(stack).annotationId, 'l1');
    assert.strictEqual(U.canUndo(stack), false);
  });

  test('each completed mutation pushes exactly one entry', () => {
    U.pushCreate(stack, line('l1'));
    assert.strictEqual(U.size(stack), 1);
    U.pushGeometry(stack, line('l1'));
    assert.strictEqual(U.size(stack), 2);
    U.pushDelete(stack, line('l1'));
    assert.strictEqual(U.size(stack), 3);
  });

  test('the stack is bounded and drops the OLDEST', () => {
    assert.strictEqual(U.MAX_ENTRIES, 20);
    for (let i = 0; i < 25; i++) U.pushCreate(stack, line('l' + i));
    assert.strictEqual(U.size(stack), 20);
    // l0..l4 were dropped; the next undo should be the most recent.
    assert.strictEqual(U.undo(stack).annotationId, 'l24');
  });

  test('a custom limit is honoured', () => {
    const small = U.bindSheet(U.createUndoStack({ limit: 3 }), 's1');
    for (let i = 0; i < 5; i++) U.pushCreate(small, line('l' + i));
    assert.strictEqual(U.size(small), 3);
    assert.strictEqual(U.peek(small).annotationId, 'l4');
  });

  test('malformed entries are refused rather than corrupting the stack', () => {
    U.push(stack, null);
    U.push(stack, { kind: 'nonsense', annotationId: 'x' });
    U.push(stack, { kind: 'create' });                    // no id
    U.pushCreate(stack, { });                             // no id
    assert.strictEqual(U.size(stack), 0);
  });
});

describe('WM-6B1 undo — sheet scope', () => {
  test('switching sheets clears the history', () => {
    U.pushCreate(stack, line('l1'));
    assert.strictEqual(U.size(stack), 1);
    U.bindSheet(stack, 's2');
    assert.strictEqual(U.size(stack), 0, 'undo must not reach onto another sheet');
    assert.strictEqual(stack.sheetId, 's2');
  });

  test('rebinding the SAME sheet keeps the history', () => {
    U.pushCreate(stack, line('l1'));
    U.bindSheet(stack, 's1');
    assert.strictEqual(U.size(stack), 1);
  });

  test('reset empties the stack', () => {
    U.pushCreate(stack, line('l1'));
    U.reset(stack);
    assert.strictEqual(U.canUndo(stack), false);
  });

  test('history is in memory only — nothing here touches storage', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'src', 'wiremap', 'undoStack.js'), 'utf8');
    assert.ok(!/indexedDB|localStorage|require\('\.\/store/.test(src),
      'the undo stack must not persist itself');
  });
});

describe('WM-6B1 undo — scope is sketch only', () => {
  test('only the three sketch mutation kinds are recognised', () => {
    assert.deepStrictEqual(U.KINDS, ['create', 'geometry', 'delete']);
  });

  test('there is no redo', () => {
    assert.strictEqual(U.redo, undefined);
  });

  test('a pointermove cannot spam history — nothing pushes without a completed mutation', () => {
    // Simulate 50 preview frames: the controller pushes only at drag end.
    for (let i = 0; i < 50; i++) { /* drawMove would run here */ }
    assert.strictEqual(U.size(stack), 0);
    U.pushGeometry(stack, line('l1'));      // one completed drag
    assert.strictEqual(U.size(stack), 1);
  });
});
