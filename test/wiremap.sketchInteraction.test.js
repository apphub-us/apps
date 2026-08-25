'use strict';
/**
 * Sketch tools — WM-6B1. Pure state and geometry, run in Node.
 * Rendering, real Pointer Events and IndexedDB are covered by the browser check.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const K = require('../src/wiremap/sketchInteraction');
const vp = require('../src/wiremap/viewport');
const geom = require('../src/wiremap/geometry');
const model = require('../src/wiremap/model');

const STAGE = { width: 2000, height: 1500 };
const PHONE = { width: 390, height: 700 };
const FIT = vp.fitToViewport(STAGE, PHONE);
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
let s;
beforeEach(() => { s = K.createSketchState(); });

describe('WM-6B1 model already covers sketch shapes', () => {
  test('line and rect are two-point annotation types', () => {
    for (const t of ['line', 'rect']) {
      assert.ok(model.ANNOTATION_TYPES.includes(t));
      assert.ok(model.TWO_POINT_TYPES.includes(t));
    }
  });

  test('a blank sheet needs no image', () => {
    const sheet = model.createSheet({ id: 's1', jobId: 'j', name: 'Blank', kind: 'blank',
      width: 2000, height: 1500, order: 0, now: 1 });
    assert.strictEqual(model.validateSheet(sheet).valid, true);
    assert.strictEqual(sheet.imageId, null);
  });

  test('out-of-range geometry is rejected by the model', () => {
    const a = model.createAnnotation({ id: 'l1', sheetId: 's1', type: 'line',
      a: { x: 0.1, y: 0.2 }, b: { x: 0.8, y: 0.7 }, now: 1 });
    assert.strictEqual(model.validateAnnotation(a).valid, true);
    assert.strictEqual(model.validateAnnotation({ ...a, b: { x: 1.3, y: 0.5 } }).valid, false);
  });
});

describe('WM-6B1 tool state', () => {
  test('arming and disarming', () => {
    assert.strictEqual(K.activeTool(s), 'none');
    K.armTool(s, 'line');
    assert.strictEqual(K.activeTool(s), 'line');
    assert.strictEqual(K.isArmed(s), true);
    K.disarmTool(s);
    assert.strictEqual(K.activeTool(s), 'none');
  });

  test('LINE AND RECT CAN NEVER BOTH BE ACTIVE', () => {
    K.armTool(s, 'line');
    K.armTool(s, 'rect');
    assert.strictEqual(K.activeTool(s), 'rect');
    // One field cannot hold two tools; the state is unrepresentable.
    assert.strictEqual(K.TOOLS.filter((t) => t !== 'none' && K.activeTool(s) === t).length, 1);
  });

  test('an unknown tool is refused', () => {
    K.armTool(s, 'freehand');
    assert.strictEqual(K.activeTool(s), 'none');
  });

  test('arming a tool discards any draft in flight', () => {
    K.armTool(s, 'line');
    K.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    K.armTool(s, 'rect');
    assert.strictEqual(K.isDrawing(s), false);
  });

  test('nothing draws unless a tool is armed', () => {
    assert.deepStrictEqual(K.drawStart(s, { x: 100, y: 100 }, FIT, STAGE), { started: false });
  });
});

describe('WM-6B1 line tool', () => {
  beforeEach(() => K.armTool(s, 'line'));

  test('a drag past the threshold commits a line', () => {
    K.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    K.drawMove(s, { x: 200, y: 380 }, FIT, STAGE);
    const out = K.drawEnd(s);
    assert.strictEqual(out.action, 'commit');
    assert.strictEqual(out.tool, 'line');
    for (const p of [out.a, out.b]) {
      assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, 'endpoints must be normalized');
    }
  });

  test('A TAP CREATES NOTHING', () => {
    K.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    K.drawMove(s, { x: 103, y: 301 }, FIT, STAGE);
    assert.strictEqual(K.drawEnd(s).action, 'discarded');
  });

  test('the threshold is the documented distance', () => {
    K.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    assert.strictEqual(K.drawMove(s, { x: 100 + K.LINE_MIN_DRAW_PX - 1, y: 300 }, FIT, STAGE).exceeded, false);
    assert.strictEqual(K.drawMove(s, { x: 100 + K.LINE_MIN_DRAW_PX + 1, y: 300 }, FIT, STAGE).exceeded, true);
  });

  test('the preview follows from the first move', () => {
    K.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    const r = K.drawMove(s, { x: 104, y: 302 }, FIT, STAGE);
    assert.strictEqual(r.drawing, true);
    assert.ok(r.a && r.b);
  });

  test('a draw past the sheet edge clamps', () => {
    K.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    K.drawMove(s, { x: 99999, y: 99999 }, FIT, STAGE);
    assert.deepStrictEqual(K.drawEnd(s).b, { x: 1, y: 1 });
  });

  test('cancel leaves nothing behind', () => {
    K.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    K.drawMove(s, { x: 400, y: 400 }, FIT, STAGE);
    assert.strictEqual(K.drawCancel(s).action, 'cancelled');
    assert.strictEqual(K.drawEnd(s).action, 'none');
  });

  test('coordinates round-trip at every zoom', () => {
    for (const scale of [FIT.scale, 1, 4, 8]) {
      const view = vp.zoomAt(FIT, { x: 195, y: 350 }, scale, vp.minScaleFor(STAGE, PHONE));
      for (const n of [{ x: 0, y: 0 }, { x: 0.42, y: 0.63 }, { x: 1, y: 1 }]) {
        const back = K.screenToNormalized(K.normalizedToScreen(n, view, STAGE), view, STAGE);
        assert.ok(near(back.x, n.x) && near(back.y, n.y));
      }
    }
  });

  test('geometry comes from the shared modules', () => {
    const view = { scale: 2, translateX: -100, translateY: -50 };
    assert.deepStrictEqual(K.screenToNormalized({ x: 300, y: 250 }, view, STAGE),
      geom.normalizePoint(vp.screenToStage({ x: 300, y: 250 }, view), STAGE));
  });

  test('malformed input produces no NaN', () => {
    for (const bad of [null, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
      const st = K.createSketchState(); K.armTool(st, 'line');
      K.drawStart(st, bad, FIT, STAGE);
      const r = K.drawMove(st, bad, FIT, STAGE);
      if (r.b) assert.ok(Number.isFinite(r.b.x) && Number.isFinite(r.b.y));
    }
  });
});

describe('WM-6B1 rectangle tool', () => {
  beforeEach(() => K.armTool(s, 'rect'));
  const drag = (from, to) => {
    K.drawStart(s, from, FIT, STAGE);
    K.drawMove(s, to, FIT, STAGE);
    return K.drawEnd(s);
  };

  test('every drag direction produces a rectangle', () => {
    const dirs = {
      'top-left to bottom-right': [{ x: 120, y: 250 }, { x: 260, y: 380 }],
      'bottom-right to top-left': [{ x: 260, y: 380 }, { x: 120, y: 250 }],
      'top-right to bottom-left': [{ x: 260, y: 250 }, { x: 120, y: 380 }],
      'bottom-left to top-right': [{ x: 120, y: 380 }, { x: 260, y: 250 }],
    };
    for (const [name, [from, to]] of Object.entries(dirs)) {
      const st = K.createSketchState(); K.armTool(st, 'rect');
      K.drawStart(st, from, FIT, STAGE);
      K.drawMove(st, to, FIT, STAGE);
      const out = K.drawEnd(st);
      assert.strictEqual(out.action, 'commit', name);
      const bounds = geom.segmentBounds({ a: out.a, b: out.b });
      assert.ok(bounds.x2 > bounds.x1 && bounds.y2 > bounds.y1, `${name} has no area`);
    }
  });

  test('bounds are identical whichever way it was dragged', () => {
    const one = drag({ x: 120, y: 250 }, { x: 260, y: 380 });
    const st = K.createSketchState(); K.armTool(st, 'rect');
    K.drawStart(st, { x: 260, y: 380 }, FIT, STAGE);
    K.drawMove(st, { x: 120, y: 250 }, FIT, STAGE);
    const two = K.drawEnd(st);
    assert.deepStrictEqual(geom.segmentBounds({ a: one.a, b: one.b }),
      geom.segmentBounds({ a: two.a, b: two.b }));
  });

  test('A SLIVER IS DISCARDED — both sides must exceed the minimum', () => {
    // Wide but flat.
    assert.strictEqual(drag({ x: 120, y: 300 }, { x: 300, y: 303 }).action, 'discarded');
    const st = K.createSketchState(); K.armTool(st, 'rect');
    // Tall but thin.
    K.drawStart(st, { x: 120, y: 250 }, FIT, STAGE);
    K.drawMove(st, { x: 123, y: 400 }, FIT, STAGE);
    assert.strictEqual(K.drawEnd(st).action, 'discarded');
  });

  test('a tap creates nothing', () => {
    assert.strictEqual(drag({ x: 150, y: 300 }, { x: 152, y: 301 }).action, 'discarded');
  });

  test('geometry is clamped to the sheet', () => {
    const out = drag({ x: 150, y: 300 }, { x: 99999, y: 99999 });
    assert.deepStrictEqual(out.b, { x: 1, y: 1 });
  });
});

describe('WM-6B1 line endpoint handles', () => {
  const line = () => model.createAnnotation({ id: 'l1', sheetId: 's1', type: 'line',
    a: { x: 0.2, y: 0.3 }, b: { x: 0.8, y: 0.7 }, now: 1 });

  test('a press under the threshold is a tap', () => {
    K.handleDown(s, line(), 'a', { x: 100, y: 100 });
    assert.strictEqual(K.handleMove(s, { x: 103, y: 101 }, FIT, STAGE).moved, false);
    assert.strictEqual(K.handleUp(s).action, 'tap');
  });

  test('dragging moves only that endpoint', () => {
    const l = line();
    K.handleDown(s, l, 'b', { x: 100, y: 100 });
    K.handleMove(s, { x: 250, y: 400 }, FIT, STAGE);
    const out = K.handleUp(s);
    assert.strictEqual(out.action, 'move');
    assert.deepStrictEqual(out.geometry.a, l.a, 'the other endpoint moved');
    assert.notDeepStrictEqual(out.geometry.b, l.b);
  });

  test('the endpoint lands exactly under the finger', () => {
    K.handleDown(s, line(), 'a', { x: 100, y: 100 });
    const target = { x: 260, y: 420 };
    K.handleMove(s, target, FIT, STAGE);
    assert.deepStrictEqual(K.handleUp(s).geometry.a, K.screenToNormalized(target, FIT, STAGE));
  });

  test('pointercancel restores the stored geometry', () => {
    const l = line();
    K.handleDown(s, l, 'a', { x: 100, y: 100 });
    K.handleMove(s, { x: 400, y: 400 }, FIT, STAGE);
    const out = K.handleCancel(s);
    assert.strictEqual(out.action, 'revert');
    assert.deepStrictEqual(out.geometry, { a: l.a, b: l.b });
    assert.strictEqual(K.hasPressedHandle(s), false);
  });

  test('a handle drag is distinguishable from a plan pan', () => {
    assert.strictEqual(K.hasPressedHandle(s), false);
    K.handleDown(s, line(), 'a', { x: 100, y: 100 });
    assert.strictEqual(K.hasPressedHandle(s), true);
    assert.strictEqual(K.isDraggingHandle(s), false);
    K.handleMove(s, { x: 300, y: 300 }, FIT, STAGE);
    assert.strictEqual(K.isDraggingHandle(s), true);
  });
});

describe('WM-6B1 rectangle corner handles', () => {
  const rect = () => model.createAnnotation({ id: 'r1', sheetId: 's1', type: 'rect',
    a: { x: 0.2, y: 0.3 }, b: { x: 0.8, y: 0.7 }, now: 1 });

  test('four corners are derived from the stored pair', () => {
    const c = K.rectCorners(rect());
    assert.deepStrictEqual(c.nw, { x: 0.2, y: 0.3 });
    assert.deepStrictEqual(c.ne, { x: 0.8, y: 0.3 });
    assert.deepStrictEqual(c.se, { x: 0.8, y: 0.7 });
    assert.deepStrictEqual(c.sw, { x: 0.2, y: 0.7 });
  });

  test('corners are the same whichever way the rectangle was drawn', () => {
    const flipped = { ...rect(), a: { x: 0.8, y: 0.7 }, b: { x: 0.2, y: 0.3 } };
    assert.deepStrictEqual(K.rectCorners(flipped), K.rectCorners(rect()));
  });

  test('the opposite corner is correct for all four', () => {
    const r = rect();
    assert.deepStrictEqual(K.oppositeCorner(r, 'nw'), { x: 0.8, y: 0.7 });
    assert.deepStrictEqual(K.oppositeCorner(r, 'se'), { x: 0.2, y: 0.3 });
    assert.deepStrictEqual(K.oppositeCorner(r, 'ne'), { x: 0.2, y: 0.7 });
    assert.deepStrictEqual(K.oppositeCorner(r, 'sw'), { x: 0.8, y: 0.3 });
  });

  test('THE OPPOSITE CORNER STAYS PUT while one is dragged', () => {
    const r = rect();
    const anchor = K.oppositeCorner(r, 'nw');
    K.handleDown(s, r, 'nw', { x: 100, y: 100 });
    K.handleMove(s, { x: 200, y: 250 }, FIT, STAGE);
    const out = K.handleUp(s);
    const corners = K.rectCorners({ ...r, ...out.geometry });
    assert.ok(near(corners.se.x, anchor.x) && near(corners.se.y, anchor.y),
      'the anchored corner moved');
  });

  test('crossing over the opposite corner is allowed and stays valid', () => {
    const r = rect();
    K.handleDown(s, r, 'nw', { x: 100, y: 100 });
    // Drag far past the SE corner.
    K.handleMove(s, { x: 380, y: 690 }, FIT, STAGE);
    const out = K.handleUp(s);
    const bounds = geom.segmentBounds(out.geometry);
    assert.ok(bounds.x2 >= bounds.x1 && bounds.y2 >= bounds.y1, 'bounds inverted');
    const rebuilt = model.createAnnotation({ id: 'r1', sheetId: 's1', type: 'rect',
      a: out.geometry.a, b: out.geometry.b, now: 1 });
    assert.strictEqual(model.validateAnnotation(rebuilt).valid, true);
  });

  test('corner geometry is clamped to the sheet', () => {
    K.handleDown(s, rect(), 'nw', { x: 100, y: 100 });
    K.handleMove(s, { x: -9999, y: -9999 }, FIT, STAGE);
    const g = K.withGeometry(rect(), K.handleUp(s).geometry);
    for (const p of [g.a, g.b]) {
      assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
    }
  });

  test('pointercancel restores the prior geometry', () => {
    const r = rect();
    K.handleDown(s, r, 'se', { x: 100, y: 100 });
    K.handleMove(s, { x: 300, y: 500 }, FIT, STAGE);
    assert.deepStrictEqual(K.handleCancel(s).geometry, { a: r.a, b: r.b });
  });
});

describe('WM-6B1 selection', () => {
  test('a single selected id, clearable', () => {
    assert.strictEqual(K.getSelected(s), null);
    K.select(s, 'l1');
    assert.strictEqual(K.getSelected(s), 'l1');
    K.clearSelection(s);
    assert.strictEqual(K.getSelected(s), null);
  });

  test('withGeometry does not mutate the original', () => {
    const l = model.createAnnotation({ id: 'l1', sheetId: 's1', type: 'line',
      a: { x: 0.2, y: 0.3 }, b: { x: 0.8, y: 0.7 }, now: 1 });
    const next = K.withGeometry(l, { a: { x: 0.5, y: 0.5 }, b: { x: 0.9, y: 0.9 } });
    assert.deepStrictEqual(l.a, { x: 0.2, y: 0.3 });
    assert.deepStrictEqual(next.a, { x: 0.5, y: 0.5 });
  });
});
