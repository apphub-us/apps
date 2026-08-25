'use strict';
/** Sketch text — WM-6B2. Pure state and geometry in Node. */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const K = require('../src/wiremap/sketchInteraction');
const U = require('../src/wiremap/undoStack');
const vp = require('../src/wiremap/viewport');
const geom = require('../src/wiremap/geometry');
const model = require('../src/wiremap/model');

const STAGE = { width: 2000, height: 1500 };
const PHONE = { width: 390, height: 700 };
const FIT = vp.fitToViewport(STAGE, PHONE);
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const text = (id, at, str) => model.createAnnotation({ id, sheetId: 's1', type: 'text',
  at: at || { x: 0.4, y: 0.6 }, data: { text: str || 'Feed from 3F' }, now: 1 });
let s;
beforeEach(() => { s = K.createSketchState(); });

describe('WM-6B2 model already covers text', () => {
  test('text is a single-point annotation type', () => {
    assert.ok(model.ANNOTATION_TYPES.includes('text'));
    assert.ok(model.POINT_TYPES.includes('text'));
    assert.ok(!model.TWO_POINT_TYPES.includes('text'));
  });

  test('a complete text annotation validates', () => {
    const t = text('t1');
    assert.strictEqual(model.validateAnnotation(t).valid, true);
    assert.deepStrictEqual(t.at, { x: 0.4, y: 0.6 });
    assert.strictEqual(t.data.text, 'Feed from 3F');
  });

  test('empty, blank and missing text are rejected by the model', () => {
    const t = text('t1');
    assert.strictEqual(model.validateAnnotation({ ...t, data: { text: '' } }).valid, false);
    assert.strictEqual(model.validateAnnotation({ ...t, data: { text: '   ' } }).valid, false);
    assert.strictEqual(model.validateAnnotation({ ...t, data: {} }).valid, false);
  });

  test('an out-of-range anchor is rejected', () => {
    assert.strictEqual(model.validateAnnotation({ ...text('t1'), at: { x: 1.4, y: 0.5 } }).valid, false);
    assert.strictEqual(model.validateAnnotation({ ...text('t1'), at: { x: 840, y: 945 } }).valid, false);
  });

  test('text carries no wire-label fields', () => {
    const t = text('t1');
    for (const f of ['from', 'to', 'cable', 'room', 'labelKey']) {
      assert.strictEqual(t.data[f], undefined, `text must not carry ${f}`);
    }
  });
});

describe('WM-6B2 text normalisation', () => {
  test('leading and trailing whitespace is trimmed', () => {
    assert.strictEqual(K.normalizeText('  Feed from 3F  '), 'Feed from 3F');
  });

  test('blank input yields null so it can never be saved', () => {
    for (const bad of ['', '   ', '\t\n', null, undefined, 42, {}]) {
      assert.strictEqual(K.normalizeText(bad), null, JSON.stringify(bad));
      assert.strictEqual(K.isValidText(bad), false);
    }
  });

  test('length is capped', () => {
    assert.strictEqual(K.TEXT_MAX_LENGTH, 120);
    assert.strictEqual(K.normalizeText('x'.repeat(500)).length, 120);
  });

  test('interior spacing is preserved — it is free text, not an identifier', () => {
    assert.strictEqual(K.normalizeText('Feed  from   3F'), 'Feed  from   3F');
  });
});

describe('WM-6B2 tool exclusivity', () => {
  test('text joins the same single-tool field', () => {
    assert.deepStrictEqual(K.TOOLS, ['none', 'line', 'rect', 'text']);
    K.armTool(s, 'line'); K.armTool(s, 'text');
    assert.strictEqual(K.activeTool(s), 'text');
    K.armTool(s, 'rect');
    assert.strictEqual(K.activeTool(s), 'rect', 'arming rect must disarm text');
  });

  test('placement only resolves while Text is armed', () => {
    assert.strictEqual(K.textPlacementAt(s, { x: 100, y: 300 }, FIT, STAGE), null);
    K.armTool(s, 'line');
    assert.strictEqual(K.textPlacementAt(s, { x: 100, y: 300 }, FIT, STAGE), null);
    K.armTool(s, 'text');
    assert.ok(K.textPlacementAt(s, { x: 100, y: 300 }, FIT, STAGE));
  });

  test('the placement point is normalized and clamped', () => {
    K.armTool(s, 'text');
    const n = K.textPlacementAt(s, { x: 100, y: 300 }, FIT, STAGE);
    assert.ok(n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1);
    assert.deepStrictEqual(K.textPlacementAt(s, { x: 99999, y: 99999 }, FIT, STAGE), { x: 1, y: 1 });
  });

  test('placement round-trips at every zoom', () => {
    K.armTool(s, 'text');
    for (const scale of [FIT.scale, 1, 4, 8]) {
      const view = vp.zoomAt(FIT, { x: 195, y: 350 }, scale, vp.minScaleFor(STAGE, PHONE));
      for (const n of [{ x: 0.1, y: 0.9 }, { x: 0.42, y: 0.63 }]) {
        const screen = K.normalizedToScreen(n, view, STAGE);
        const back = K.screenToNormalized(screen, view, STAGE);
        assert.ok(near(back.x, n.x) && near(back.y, n.y));
      }
    }
  });
});

describe('WM-6B2 text drag versus tap', () => {
  test('a press under the threshold is a tap', () => {
    K.textPointerDown(s, text('t1'), { x: 100, y: 100 }, FIT, STAGE);
    assert.strictEqual(K.textPointerMove(s, { x: 103, y: 101 }, FIT, STAGE).moved, false);
    const out = K.textPointerUp(s);
    assert.strictEqual(out.action, 'tap');
    assert.deepStrictEqual(out.normalized, { x: 0.4, y: 0.6 });
  });

  test('crossing the threshold becomes a move', () => {
    K.textPointerDown(s, text('t1'), { x: 100, y: 100 }, FIT, STAGE);
    K.textPointerMove(s, { x: 220, y: 200 }, FIT, STAGE);
    const out = K.textPointerUp(s);
    assert.strictEqual(out.action, 'move');
    assert.notDeepStrictEqual(out.normalized, { x: 0.4, y: 0.6 });
    assert.deepStrictEqual(out.before, { x: 0.4, y: 0.6 });
  });

  test('THE GRAB OFFSET IS KEPT — the anchor does not snap under the finger', () => {
    const t = text('t1', { x: 0.5, y: 0.5 });
    const anchorScreen = K.normalizedToScreen(t.at, FIT, STAGE);
    // Grab well to the right of the anchor.
    const grab = { x: anchorScreen.x + 40, y: anchorScreen.y + 10 };
    K.textPointerDown(s, t, grab, FIT, STAGE);
    K.textPointerMove(s, { x: grab.x + 60, y: grab.y + 30 }, FIT, STAGE);
    const out = K.textPointerUp(s);
    const expected = K.screenToNormalized(
      { x: anchorScreen.x + 60, y: anchorScreen.y + 30 }, FIT, STAGE);
    assert.ok(near(out.normalized.x, expected.x, 1e-9) && near(out.normalized.y, expected.y, 1e-9),
      'the text jumped instead of keeping the grab point');
  });

  test('dragging is clamped to the sheet', () => {
    K.textPointerDown(s, text('t1'), { x: 100, y: 100 }, FIT, STAGE);
    K.textPointerMove(s, { x: -9999, y: -9999 }, FIT, STAGE);
    assert.deepStrictEqual(K.textPointerUp(s).normalized, { x: 0, y: 0 });
  });

  test('pointercancel restores the stored anchor', () => {
    K.textPointerDown(s, text('t1'), { x: 100, y: 100 }, FIT, STAGE);
    K.textPointerMove(s, { x: 300, y: 300 }, FIT, STAGE);
    const out = K.textPointerCancel(s);
    assert.deepStrictEqual(out, { action: 'revert', id: 't1', normalized: { x: 0.4, y: 0.6 } });
    assert.strictEqual(K.hasPressedText(s), false);
  });

  test('a text drag is distinguishable from a plan pan', () => {
    assert.strictEqual(K.hasPressedText(s), false);
    K.textPointerDown(s, text('t1'), { x: 100, y: 100 }, FIT, STAGE);
    assert.strictEqual(K.hasPressedText(s), true);
    assert.strictEqual(K.isDraggingText(s), false);
    K.textPointerMove(s, { x: 300, y: 300 }, FIT, STAGE);
    assert.strictEqual(K.isDraggingText(s), true);
  });

  test('withAnchor does not mutate the original', () => {
    const t = text('t1');
    const moved = K.withAnchor(t, { x: 0.9, y: 0.1 });
    assert.deepStrictEqual(t.at, { x: 0.4, y: 0.6 });
    assert.deepStrictEqual(moved.at, { x: 0.9, y: 0.1 });
    assert.strictEqual(moved.data.text, t.data.text, 'the content must survive a move');
  });

  test('malformed input produces no NaN', () => {
    for (const bad of [null, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
      const st = K.createSketchState();
      K.textPointerDown(st, text('t1'), bad, FIT, STAGE);
      const r = K.textPointerMove(st, bad, FIT, STAGE);
      if (r.normalized) assert.ok(Number.isFinite(r.normalized.x) && Number.isFinite(r.normalized.y));
    }
  });
});

describe('WM-6B2 constant text size across zoom', () => {
  test('the font size is the screen size divided by the stage scale', () => {
    for (const scale of [0.195, 1, 4, 8]) {
      const font = K.textFontForScale(16, scale);
      assert.ok(near(font * scale, 16, 1e-9), `rendered size drifted at ${scale}`);
    }
  });

  test('a degenerate scale falls back safely', () => {
    for (const bad of [0, -1, NaN, undefined]) {
      assert.strictEqual(K.textFontForScale(16, bad), 16);
    }
  });

  test('the anchor stays on the same stage point through every viewport change', () => {
    const at = { x: 0.42, y: 0.63 };
    const stagePoint = geom.denormalizePoint(at, STAGE);
    const views = [FIT, vp.zoomAt(FIT, { x: 195, y: 350 }, 8, vp.minScaleFor(STAGE, PHONE)),
      vp.fitToViewport(STAGE, { width: 844, height: 390 })];
    for (const view of views) {
      const back = vp.screenToStage(K.normalizedToScreen(at, view, STAGE), view);
      assert.ok(near(back.x, stagePoint.x, 1e-6) && near(back.y, stagePoint.y, 1e-6));
    }
  });

  test('zooming never rewrites the stored anchor', () => {
    const t = text('t1');
    const snapshot = JSON.stringify(t.at);
    for (const scale of [0.195, 1, 8]) {
      K.normalizedToScreen(t.at, { scale, translateX: -100, translateY: -50 }, STAGE);
    }
    assert.strictEqual(JSON.stringify(t.at), snapshot);
  });
});

describe('WM-6B2 undo for text', () => {
  let stack;
  beforeEach(() => { stack = U.bindSheet(U.createUndoStack(), 's1'); });

  test('the two new kinds are recognised', () => {
    assert.deepStrictEqual(U.KINDS, ['create', 'geometry', 'delete', 'content', 'anchor']);
  });

  test('undoing a created text removes it', () => {
    U.pushCreate(stack, text('t1'));
    assert.deepStrictEqual(U.undo(stack),
      { action: 'remove', annotationId: 't1', annotation: null });
  });

  test('undoing an edit restores the previous string, not the position', () => {
    const before = text('t1', { x: 0.4, y: 0.6 }, 'Feed from 3F');
    U.pushContent(stack, before);
    const after = { ...before, data: { text: 'Feed from 4F' }, at: { x: 0.7, y: 0.7 } };
    const out = U.undo(stack, () => after);
    assert.strictEqual(out.annotation.data.text, 'Feed from 3F');
    assert.deepStrictEqual(out.annotation.at, { x: 0.7, y: 0.7 }, 'a content undo must not move it');
  });

  test('undoing a move restores the previous anchor, not the string', () => {
    const before = text('t1', { x: 0.4, y: 0.6 }, 'Feed from 3F');
    U.pushAnchor(stack, before);
    const after = { ...before, at: { x: 0.9, y: 0.2 }, data: { text: 'Changed' } };
    const out = U.undo(stack, () => after);
    assert.deepStrictEqual(out.annotation.at, { x: 0.4, y: 0.6 });
    assert.strictEqual(out.annotation.data.text, 'Changed', 'an anchor undo must not retype it');
  });

  test('undoing a delete restores the same id and content', () => {
    const t = text('t1');
    U.pushDelete(stack, t);
    const out = U.undo(stack);
    assert.strictEqual(out.annotation.id, 't1');
    assert.strictEqual(out.annotation.data.text, 'Feed from 3F');
  });

  test('snapshots are copies — later mutation cannot corrupt them', () => {
    const t = text('t1');
    U.pushContent(stack, t);
    U.pushAnchor(stack, t);
    t.at.x = 0.99; t.data.text = 'mutated';
    assert.deepStrictEqual(U.undo(stack, () => t).annotation.at.x, 0.4);
    assert.strictEqual(U.undo(stack, () => t).annotation.data.text, 'Feed from 3F');
  });

  test('text and shape history interleave in order', () => {
    U.pushCreate(stack, text('t1'));
    U.pushCreate(stack, model.createAnnotation({ id: 'l1', sheetId: 's1', type: 'line',
      a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, now: 1 }));
    U.pushContent(stack, text('t1'));
    assert.strictEqual(U.undo(stack, () => text('t1')).annotationId, 't1');
    assert.strictEqual(U.undo(stack).annotationId, 'l1');
    assert.strictEqual(U.undo(stack).annotationId, 't1');
    assert.strictEqual(U.canUndo(stack), false);
  });

  test('one completed edit pushes exactly one entry', () => {
    U.pushContent(stack, text('t1'));
    assert.strictEqual(U.size(stack), 1);
  });
});
