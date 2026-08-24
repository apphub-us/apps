'use strict';
/**
 * Arrow interaction — WM-6A.
 *
 * Pure state and geometry in Node. Rendering, real Pointer Events and
 * IndexedDB are covered by tools/browser-check-wiremap.js; iOS is a manual gate.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const R = require('../src/wiremap/routeInteraction');
const L = require('../src/wiremap/labelInteraction');
const vp = require('../src/wiremap/viewport');
const geom = require('../src/wiremap/geometry');
const model = require('../src/wiremap/model');

const STAGE = { width: 2000, height: 1500 };
const PHONE = { width: 390, height: 700 };
const FIT = vp.fitToViewport(STAGE, PHONE);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

let s;
beforeEach(() => { s = R.createRouteState(); });

describe('WM-6A arrows — the existing model is sufficient', () => {
  test('arrow is already a two-point annotation type', () => {
    assert.ok(model.ANNOTATION_TYPES.includes('arrow'));
    assert.ok(model.TWO_POINT_TYPES.includes('arrow'));
  });

  test('an arrow with two normalized endpoints validates', () => {
    const a = model.createAnnotation({ id: 'r1', sheetId: 's1', type: 'arrow',
      a: { x: 0.1, y: 0.2 }, b: { x: 0.8, y: 0.7 }, now: 1 });
    assert.strictEqual(model.validateAnnotation(a).valid, true);
    assert.deepStrictEqual(a.a, { x: 0.1, y: 0.2 });
    assert.deepStrictEqual(a.b, { x: 0.8, y: 0.7 });
  });

  test('the model rejects a missing endpoint or an out-of-range one', () => {
    const base = model.createAnnotation({ id: 'r1', sheetId: 's1', type: 'arrow',
      a: { x: 0.1, y: 0.2 }, b: { x: 0.8, y: 0.7 }, now: 1 });
    assert.strictEqual(model.validateAnnotation({ ...base, b: undefined }).valid, false);
    assert.strictEqual(model.validateAnnotation({ ...base, b: { x: 1.4, y: 0.5 } }).valid, false);
    assert.strictEqual(model.validateAnnotation({ ...base, a: { x: 840, y: 945 } }).valid, false);
  });

  test('endpoints are stored, never length and angle', () => {
    const a = model.createAnnotation({ id: 'r1', sheetId: 's1', type: 'arrow',
      a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, now: 1 });
    assert.ok(!('length' in a) && !('angle' in a));
  });
});

describe('WM-6A arrows — draw mode', () => {
  test('arming and disarming', () => {
    assert.strictEqual(R.isArmed(s), false);
    R.armDraw(s);
    assert.strictEqual(R.isArmed(s), true);
    R.disarmDraw(s);
    assert.strictEqual(R.isArmed(s), false);
  });

  test('nothing starts unless armed', () => {
    assert.deepStrictEqual(R.drawStart(s, { x: 100, y: 100 }, FIT, STAGE), { started: false });
    assert.strictEqual(R.isDrawing(s), false);
  });

  test('a drag beyond the threshold commits one arrow', () => {
    R.armDraw(s);
    R.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    R.drawMove(s, { x: 200, y: 380 }, FIT, STAGE);
    const out = R.drawEnd(s);
    assert.strictEqual(out.action, 'commit');
    for (const p of [out.start, out.end]) {
      assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, 'endpoints must be normalized');
    }
    assert.notDeepStrictEqual(out.start, out.end);
  });

  test('A TAP IN ARROW MODE CREATES NOTHING', () => {
    // A zero-length arrow is never intentional.
    R.armDraw(s);
    R.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    R.drawMove(s, { x: 103, y: 302 }, FIT, STAGE);
    assert.strictEqual(R.drawEnd(s).action, 'discarded');
  });

  test('the threshold is the documented distance', () => {
    R.armDraw(s);
    R.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    const just = R.drawMove(s, { x: 100 + R.ARROW_MIN_DRAW_PX - 1, y: 300 }, FIT, STAGE);
    assert.strictEqual(just.exceeded, false);
    const over = R.drawMove(s, { x: 100 + R.ARROW_MIN_DRAW_PX + 1, y: 300 }, FIT, STAGE);
    assert.strictEqual(over.exceeded, true);
  });

  test('once exceeded, coming back short still commits', () => {
    // The finger having travelled is what matters, not where it stopped.
    R.armDraw(s);
    R.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    R.drawMove(s, { x: 300, y: 300 }, FIT, STAGE);
    R.drawMove(s, { x: 104, y: 300 }, FIT, STAGE);
    assert.strictEqual(R.drawEnd(s).action, 'commit');
  });

  test('the preview follows the finger from the first move', () => {
    R.armDraw(s);
    R.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    const r = R.drawMove(s, { x: 105, y: 305 }, FIT, STAGE);
    assert.strictEqual(r.drawing, true);
    assert.ok(r.end);
  });

  test('cancel leaves nothing behind', () => {
    R.armDraw(s);
    R.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    R.drawMove(s, { x: 400, y: 400 }, FIT, STAGE);
    assert.strictEqual(R.drawCancel(s).action, 'cancelled');
    assert.strictEqual(R.isDrawing(s), false);
    assert.strictEqual(R.drawEnd(s).action, 'none');
  });

  test('a draw past the plan edge clamps rather than escaping', () => {
    R.armDraw(s);
    R.drawStart(s, { x: 100, y: 300 }, FIT, STAGE);
    R.drawMove(s, { x: 99999, y: 99999 }, FIT, STAGE);
    const out = R.drawEnd(s);
    assert.deepStrictEqual(out.end, { x: 1, y: 1 });
  });
});

describe('WM-6A arrows — iOS compatibility events', () => {
  test('THE SHARED MECHANISM: one touch is not counted twice', () => {
    // Suppression is owned by labelInteraction and shared by the controller —
    // two clocks would drift apart. Confirm it covers the arrow path too.
    const input = L.createLabelState();
    const point = { x: 195, y: 350 };
    L.noteInput(input, 'touch', point, 1000);
    assert.strictEqual(L.isCompatibilityDuplicate(input, 'mouse', point, 1300), true);
  });

  test('a suppressed duplicate never reaches drawStart, so one arrow results', () => {
    const input = L.createLabelState();
    const point = { x: 195, y: 350 };
    R.armDraw(s);

    // Real touch: draws.
    L.noteInput(input, 'touch', point, 1000);
    R.drawStart(s, point, FIT, STAGE);
    R.drawMove(s, { x: 300, y: 420 }, FIT, STAGE);
    const first = R.drawEnd(s);
    R.disarmDraw(s);

    // WebKit's synthesised pair: the controller drops it before any draw begins.
    const suppressed = L.isCompatibilityDuplicate(input, 'mouse', point, 1300);
    assert.strictEqual(suppressed, true);
    assert.strictEqual(first.action, 'commit');
    assert.strictEqual(R.isArmed(s), false, 'arrow mode must not stay armed');
    assert.strictEqual(R.drawStart(s, point, FIT, STAGE).started, false);
  });

  test('a desktop mouse still draws', () => {
    const input = L.createLabelState();
    assert.strictEqual(L.isCompatibilityDuplicate(input, 'mouse', { x: 10, y: 10 }, 1000), false);
  });
});

describe('WM-6A arrows — endpoint dragging', () => {
  const A = { x: 0.2, y: 0.3 };
  const B = { x: 0.8, y: 0.7 };

  test('a press under the threshold is a tap, not a move', () => {
    R.endpointDown(s, 'r1', 'a', { x: 100, y: 100 }, A);
    assert.strictEqual(R.endpointMove(s, { x: 103, y: 101 }, FIT, STAGE).moved, false);
    const out = R.endpointUp(s);
    assert.strictEqual(out.action, 'tap');
    assert.deepStrictEqual(out.normalized, A);
  });

  test('crossing the threshold moves only that endpoint', () => {
    R.endpointDown(s, 'r1', 'b', { x: 100, y: 100 }, B);
    R.endpointMove(s, { x: 200, y: 200 }, FIT, STAGE);
    const out = R.endpointUp(s);
    assert.strictEqual(out.action, 'move');
    assert.strictEqual(out.which, 'b');
    assert.notDeepStrictEqual(out.normalized, B);
  });

  test('the endpoint lands exactly under the finger', () => {
    R.endpointDown(s, 'r1', 'a', { x: 100, y: 100 }, A);
    const target = { x: 250, y: 400 };
    R.endpointMove(s, target, FIT, STAGE);
    const out = R.endpointUp(s);
    const expected = R.screenToNormalized(target, FIT, STAGE);
    assert.deepStrictEqual(out.normalized, expected);
  });

  test('dragging is clamped to the sheet', () => {
    R.endpointDown(s, 'r1', 'a', { x: 100, y: 100 }, A);
    R.endpointMove(s, { x: 200, y: 200 }, FIT, STAGE);
    const r = R.endpointMove(s, { x: -99999, y: -99999 }, FIT, STAGE);
    assert.deepStrictEqual(r.normalized, { x: 0, y: 0 });
  });

  test('pointercancel restores the stored endpoint', () => {
    R.endpointDown(s, 'r1', 'b', { x: 100, y: 100 }, B);
    R.endpointMove(s, { x: 400, y: 400 }, FIT, STAGE);
    const out = R.endpointCancel(s);
    assert.deepStrictEqual(out, { action: 'revert', id: 'r1', which: 'b', normalized: B });
    assert.strictEqual(R.hasPressedEndpoint(s), false);
  });

  test('withEndpoint changes one end and leaves the other alone', () => {
    const arrow = model.createAnnotation({ id: 'r1', sheetId: 's1', type: 'arrow',
      a: A, b: B, now: 1 });
    const moved = R.withEndpoint(arrow, 'a', { x: 0.5, y: 0.5 });
    assert.deepStrictEqual(moved.a, { x: 0.5, y: 0.5 });
    assert.deepStrictEqual(moved.b, B);
    assert.deepStrictEqual(arrow.a, A, 'the original must not be mutated');
    assert.strictEqual(model.validateAnnotation(moved).valid, true);
  });

  test('withEndpoint clamps whatever it is given', () => {
    const arrow = model.createAnnotation({ id: 'r1', sheetId: 's1', type: 'arrow',
      a: A, b: B, now: 1 });
    assert.deepStrictEqual(R.withEndpoint(arrow, 'a', { x: 5, y: -5 }).a, { x: 1, y: 0 });
  });

  test('an endpoint drag is distinguishable from a plan pan', () => {
    assert.strictEqual(R.hasPressedEndpoint(s), false);
    R.endpointDown(s, 'r1', 'a', { x: 100, y: 100 }, A);
    assert.strictEqual(R.hasPressedEndpoint(s), true, 'the controller must route to the endpoint');
    assert.strictEqual(R.isDraggingEndpoint(s), false);
    R.endpointMove(s, { x: 300, y: 300 }, FIT, STAGE);
    assert.strictEqual(R.isDraggingEndpoint(s), true);
  });
});

describe('WM-6A arrows — endpoint invariant', () => {
  test('THE INVARIANT: endpoints stay on the same stage points through every viewport change', () => {
    const a = { x: 0.2, y: 0.3 };
    const b = { x: 0.8, y: 0.7 };
    const stageA = geom.denormalizePoint(a, STAGE);
    const stageB = geom.denormalizePoint(b, STAGE);
    const views = [
      FIT,
      vp.clampTranslation({ ...FIT, translateX: FIT.translateX - 150 }, STAGE, PHONE),
      vp.zoomAt(FIT, { x: 195, y: 350 }, 8, vp.minScaleFor(STAGE, PHONE)),
      vp.fitToViewport(STAGE, { width: 844, height: 390 }),
    ];
    for (const view of views) {
      for (const [n, expected] of [[a, stageA], [b, stageB]]) {
        const back = vp.screenToStage(R.normalizedToScreen(n, view, STAGE), view);
        assert.ok(near(back.x, expected.x, 1e-6) && near(back.y, expected.y, 1e-6),
          `endpoint drifted at scale ${view.scale}`);
      }
    }
  });

  test('a viewport change never rewrites stored endpoints', () => {
    const arrow = model.createAnnotation({ id: 'r1', sheetId: 's1', type: 'arrow',
      a: { x: 0.2, y: 0.3 }, b: { x: 0.8, y: 0.7 }, now: 1 });
    const snapshot = JSON.stringify({ a: arrow.a, b: arrow.b });
    for (const scale of [0.195, 1, 4, 8]) {
      const view = { scale, translateX: -100, translateY: -50 };
      R.normalizedToScreen(arrow.a, view, STAGE);
      R.normalizedToScreen(arrow.b, view, STAGE);
      R.screenToNormalized({ x: 195, y: 350 }, view, STAGE);
    }
    assert.strictEqual(JSON.stringify({ a: arrow.a, b: arrow.b }), snapshot);
  });

  test('conversions round-trip at every zoom', () => {
    for (const scale of [0.195, 1, 3.7, 8]) {
      const view = { scale, translateX: -220, translateY: 90 };
      for (const n of [{ x: 0, y: 0 }, { x: 0.42, y: 0.63 }, { x: 1, y: 1 }]) {
        const back = R.screenToNormalized(R.normalizedToScreen(n, view, STAGE), view, STAGE);
        assert.ok(near(back.x, n.x, 1e-9) && near(back.y, n.y, 1e-9));
      }
    }
  });

  test('geometry comes from the shared modules, not a second formula', () => {
    const view = { scale: 2, translateX: -100, translateY: -50 };
    assert.deepStrictEqual(
      R.screenToNormalized({ x: 300, y: 250 }, view, STAGE),
      geom.normalizePoint(vp.screenToStage({ x: 300, y: 250 }, view), STAGE));
  });
});

describe('WM-6A arrows — selection and robustness', () => {
  test('selection is a single id and can be cleared', () => {
    assert.strictEqual(R.getSelected(s), null);
    R.select(s, 'r1');
    assert.strictEqual(R.getSelected(s), 'r1');
    R.clearSelection(s);
    assert.strictEqual(R.getSelected(s), null);
  });

  test('malformed input produces no NaN', () => {
    for (const bad of [null, undefined, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
      const st = R.createRouteState();
      R.armDraw(st);
      R.drawStart(st, bad, FIT, STAGE);
      const r = R.drawMove(st, bad, FIT, STAGE);
      assert.ok(!r.end || (Number.isFinite(r.end.x) && Number.isFinite(r.end.y)));
      const out = R.drawEnd(st);
      if (out.start) assert.ok(Number.isFinite(out.start.x) && Number.isFinite(out.start.y));
    }
  });

  test('an endpoint move with no press does nothing', () => {
    assert.deepStrictEqual(R.endpointMove(s, { x: 1, y: 1 }, FIT, STAGE),
      { moved: false, normalized: null });
    assert.deepStrictEqual(R.endpointUp(s),
      { action: 'none', id: null, which: null, normalized: null });
  });

  test('an invalid endpoint name is refused', () => {
    R.endpointDown(s, 'r1', 'c', { x: 1, y: 1 }, { x: 0.5, y: 0.5 });
    assert.strictEqual(R.hasPressedEndpoint(s), false);
  });

  test('a bad stage size is refused rather than dividing by zero', () => {
    assert.strictEqual(R.screenToNormalized({ x: 1, y: 1 }, FIT, null), null);
    assert.strictEqual(R.screenToNormalized({ x: 1, y: 1 }, FIT, { width: 0, height: 10 }), null);
  });
});
