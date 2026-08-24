'use strict';
/**
 * Wire Map gesture state — WM-4.
 *
 * Pure arithmetic, run in Node. Real Pointer Events against the shipped page
 * are covered by tools/browser-check-wiremap.js; iOS remains a manual gate.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const g = require('../src/wiremap/interaction');
const vp = require('../src/wiremap/viewport');
const fs = require('node:fs');
const path = require('node:path');

const STAGE = { width: 2000, height: 1500 };
const PHONE = { width: 390, height: 700 };
const BOUNDS = { stageSize: STAGE, viewSize: PHONE };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const finite = (v) => Number.isFinite(v.scale) && Number.isFinite(v.translateX) && Number.isFinite(v.translateY);

const down = (s, id, x, y, v) => g.pointerDown(s, { id, x, y }, v);
const move = (s, id, x, y, v) => g.pointerMove(s, { id, x, y }, v, BOUNDS);

describe('WM-4 gestures — pointer registration', () => {
  test('pointers are tracked and removed by id', () => {
    const s = g.createGestureState();
    assert.strictEqual(g.activeCount(s), 0);
    down(s, 1, 10, 10, vp.identity());
    down(s, 2, 50, 50, vp.identity());
    assert.strictEqual(g.activeCount(s), 2);
    g.pointerUp(s, 1, vp.identity());
    assert.strictEqual(g.activeCount(s), 1);
    assert.strictEqual(s.pointers[0].id, 2, 'the wrong pointer was removed');
  });

  test('a duplicate pointerdown does not double-register', () => {
    const s = g.createGestureState();
    down(s, 1, 10, 10, vp.identity());
    down(s, 1, 20, 20, vp.identity());
    assert.strictEqual(g.activeCount(s), 1);
  });

  test('an unknown pointerup is ignored', () => {
    const s = g.createGestureState();
    down(s, 1, 10, 10, vp.identity());
    g.pointerUp(s, 99, vp.identity());
    assert.strictEqual(g.activeCount(s), 1);
  });

  test('releasing the last pointer returns to idle with no residue', () => {
    const s = g.createGestureState();
    down(s, 1, 10, 10, vp.identity());
    move(s, 1, 100, 100, vp.identity());
    g.pointerUp(s, 1, vp.identity());
    assert.strictEqual(s.mode, 'idle');
    assert.strictEqual(s.panFrom, null);
    assert.strictEqual(s.startPoint, null);
  });

  test('pointercancel clears everything at once', () => {
    const s = g.createGestureState();
    down(s, 1, 10, 10, vp.identity());
    down(s, 2, 90, 90, vp.identity());
    g.cancelAll(s);
    assert.strictEqual(g.activeCount(s), 0);
    assert.strictEqual(s.mode, 'idle');
    // A move after cancel must do nothing rather than resurrect the gesture.
    const r = move(s, 1, 500, 500, vp.identity());
    assert.strictEqual(r.changed, false);
  });
});

describe('WM-4 gestures — one-finger pan', () => {
  test('movement below the threshold does not pan', () => {
    const s = g.createGestureState();
    const v0 = vp.identity();
    down(s, 1, 100, 100, v0);
    const r = move(s, 1, 100 + g.DRAG_THRESHOLD_PX - 1, 100, v0);
    assert.strictEqual(r.changed, false, 'a tap must not move the plan');
    assert.strictEqual(s.mode, 'pending');
  });

  test('crossing the threshold commits to a drag', () => {
    const s = g.createGestureState();
    down(s, 1, 100, 100, vp.identity());
    move(s, 1, 120, 100, vp.identity());
    assert.strictEqual(s.mode, 'pan');
  });

  test('the plan does not lurch by the threshold on the first committed move', () => {
    // Re-anchoring at commit is what prevents an 8px jump.
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    down(s, 1, 100, 100, v0);
    move(s, 1, 120, 100, v0);          // commits, no movement applied yet
    const r = move(s, 1, 130, 100, v0); // 10px past the commit point
    assert.ok(near(r.viewport.translateX, 10), `expected 10, got ${r.viewport.translateX}`);
  });

  test('panning is one-to-one with the finger', () => {
    const s = g.createGestureState();
    const v0 = { scale: 2, translateX: -100, translateY: -50 };
    down(s, 1, 200, 300, v0);
    move(s, 1, 220, 300, v0);
    const r = move(s, 1, 260, 340, v0);
    assert.ok(near(r.viewport.translateX, -100 + 40));
    assert.ok(near(r.viewport.translateY, -50 + 40));
  });

  test('panning never changes the scale', () => {
    const s = g.createGestureState();
    const v0 = { scale: 3.7, translateX: 0, translateY: 0 };
    down(s, 1, 10, 10, v0);
    move(s, 1, 200, 200, v0);
    const r = move(s, 1, 400, 400, v0);
    assert.strictEqual(r.viewport.scale, 3.7);
  });
});

describe('WM-4 gestures — pinch', () => {
  const startPinch = (s, v) => { down(s, 1, 100, 300, v); down(s, 2, 300, 300, v); };

  test('two pointers enter pinch mode', () => {
    const s = g.createGestureState();
    startPinch(s, vp.identity());
    assert.strictEqual(s.mode, 'pinch');
  });

  test('distance and midpoint are computed correctly', () => {
    assert.strictEqual(g.distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
    assert.deepStrictEqual(g.midpoint({ x: 0, y: 0 }, { x: 10, y: 20 }), { x: 5, y: 10 });
  });

  test('spreading the fingers increases the scale proportionally', () => {
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    startPinch(s, v0);                      // 200px apart
    const r = move(s, 2, 500, 300, v0);     // now 400px apart
    assert.ok(near(r.viewport.scale, 2, 1e-9), `expected 2x, got ${r.viewport.scale}`);
  });

  test('pinching in decreases the scale', () => {
    const s = g.createGestureState();
    const v0 = { scale: 4, translateX: 0, translateY: 0 };
    startPinch(s, v0);
    const r = move(s, 2, 200, 300, v0);     // 200px -> 100px
    assert.ok(r.viewport.scale < 4);
  });

  test('THE KEY PROPERTY: content under the midpoint stays under the midpoint', () => {
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    down(s, 1, 100, 300, v0);
    down(s, 2, 300, 300, v0);
    const mid = { x: 200, y: 300 };
    const before = vp.screenToStage(mid, v0);
    // Spread symmetrically so the midpoint does not move.
    for (const [a, b] of [[80, 320], [50, 350], [20, 380], [120, 280]]) {
      const r1 = move(s, 1, a, 300, v0);
      const r2 = move(s, 2, b, 300, r1.viewport);
      const after = vp.screenToStage(mid, r2.viewport);
      assert.ok(near(after.x, before.x, 1e-6) && near(after.y, before.y, 1e-6),
        `content drifted at ${a}/${b}: ${JSON.stringify(after)} vs ${JSON.stringify(before)}`);
    }
  });

  test('a moving midpoint pans while the scale is unchanged', () => {
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    down(s, 1, 100, 300, v0);
    down(s, 2, 300, 300, v0);
    // Slide both fingers 50px right, keeping the distance identical.
    move(s, 1, 150, 300, v0);
    const r = move(s, 2, 350, 300, v0);
    assert.ok(near(r.viewport.scale, 1, 1e-9), 'the scale should not change');
    assert.ok(near(r.viewport.translateX, 50, 1e-6), `expected a 50px pan, got ${r.viewport.translateX}`);
  });

  test('midpoint movement and scaling combine: content follows the fingers', () => {
    // Fingers start at 100 and 300 (midpoint 200), end at 200 and 600
    // (midpoint 400, twice as far apart). The content that began under the
    // midpoint must end up under the NEW midpoint, at twice the scale.
    // Asserting a particular translateX would be meaningless — here the
    // correct answer happens to be exactly 0.
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    down(s, 1, 100, 300, v0);
    down(s, 2, 300, 300, v0);
    const contentAtStartMid = vp.screenToStage({ x: 200, y: 300 }, v0);

    move(s, 1, 200, 300, v0);
    const r = move(s, 2, 600, 300, v0);

    assert.ok(near(r.viewport.scale, 2, 1e-9), `expected 2x, got ${r.viewport.scale}`);
    const nowAtNewMid = vp.screenToStage({ x: 400, y: 300 }, r.viewport);
    assert.ok(near(nowAtNewMid.x, contentAtStartMid.x, 1e-6),
      `content did not follow the midpoint: ${nowAtNewMid.x} vs ${contentAtStartMid.x}`);
  });

  test('scale is clamped to the sheet floor and the shared ceiling', () => {
    const floor = vp.minScaleFor(STAGE, PHONE);
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    down(s, 1, 190, 300, v0); down(s, 2, 200, 300, v0);   // very close together
    let r = move(s, 2, 201, 300, v0);
    assert.ok(r.viewport.scale >= floor - 1e-9, `scale ${r.viewport.scale} below the floor ${floor}`);

    const s2 = g.createGestureState();
    down(s2, 1, 100, 300, v0); down(s2, 2, 110, 300, v0);
    r = move(s2, 2, 9000, 300, v0);
    assert.ok(r.viewport.scale <= vp.MAX_SCALE + 1e-9, `scale ${r.viewport.scale} above MAX_SCALE`);
  });
});

describe('WM-4 gestures — pinch to pan hand-off', () => {
  test('lifting one finger does NOT jump the stage', () => {
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    down(s, 1, 100, 300, v0);
    down(s, 2, 300, 300, v0);
    const zoomed = move(s, 2, 500, 300, v0).viewport;

    g.pointerUp(s, 1, zoomed);                 // one finger leaves
    assert.strictEqual(s.mode, 'pan');
    assert.strictEqual(g.activeCount(s), 1);

    // The very next move must be measured from where the surviving finger IS.
    const r = move(s, 2, 500, 300, zoomed);
    assert.strictEqual(r.changed, true);
    assert.ok(near(r.viewport.translateX, zoomed.translateX, 1e-9),
      'the stage jumped on hand-off');
    assert.ok(near(r.viewport.scale, zoomed.scale, 1e-9), 'the scale changed on hand-off');
  });

  test('panning continues correctly after the hand-off', () => {
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    down(s, 1, 100, 300, v0);
    down(s, 2, 300, 300, v0);
    const zoomed = move(s, 2, 500, 300, v0).viewport;
    g.pointerUp(s, 1, zoomed);
    const r = move(s, 2, 540, 320, zoomed);
    assert.ok(near(r.viewport.translateX, zoomed.translateX + 40, 1e-6));
    assert.ok(near(r.viewport.translateY, zoomed.translateY + 20, 1e-6));
  });

  test('a third finger down and back to two restarts the pinch cleanly', () => {
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    down(s, 1, 100, 300, v0); down(s, 2, 300, 300, v0);
    down(s, 3, 200, 500, v0);
    g.pointerUp(s, 3, v0);
    assert.strictEqual(s.mode, 'pinch');
    assert.strictEqual(g.activeCount(s), 2);
    assert.ok(finite(move(s, 2, 400, 300, v0).viewport));
  });
});

describe('WM-4 gestures — robustness', () => {
  test('no NaN or Infinity survives a malformed sequence', () => {
    const s = g.createGestureState();
    const v0 = vp.identity();
    const junk = [
      { id: 1, x: NaN, y: 0 }, { id: 1, x: Infinity, y: 0 },
      { id: 2, x: 0, y: NaN }, { id: NaN, x: 1, y: 1 }, null, undefined,
    ];
    for (const p of junk) {
      g.pointerDown(s, p, v0);
      const r = g.pointerMove(s, p, v0, BOUNDS);
      assert.ok(finite(r.viewport), `non-finite viewport after ${JSON.stringify(p)}`);
    }
  });

  test('a cancelled pinch mid-flight leaves a usable state', () => {
    const s = g.createGestureState();
    const v0 = vp.identity();
    down(s, 1, 100, 300, v0); down(s, 2, 300, 300, v0);
    move(s, 2, 600, 300, v0);
    g.cancelAll(s);
    down(s, 5, 50, 50, v0);
    const r = move(s, 5, 200, 200, v0);
    assert.strictEqual(s.mode, 'pan');
    assert.ok(finite(r.viewport));
  });

  test('two pointers landing on the same spot do not divide by zero', () => {
    const s = g.createGestureState();
    const v0 = vp.identity();
    down(s, 1, 200, 300, v0); down(s, 2, 200, 300, v0);
    const r = move(s, 2, 200, 300, v0);
    assert.ok(finite(r.viewport), 'a zero-distance pinch produced a bad transform');
  });

  test('a pan is always clamped so the plan stays reachable', () => {
    const s = g.createGestureState();
    const v0 = vp.fitToViewport(STAGE, PHONE);
    down(s, 1, 200, 300, v0);
    move(s, 1, 300, 300, v0);
    const r = move(s, 1, 99999, 99999, v0);
    const clamped = vp.clampTranslation(r.viewport, STAGE, PHONE);
    assert.deepStrictEqual(r.viewport, clamped, 'the pan escaped its bounds');
  });
});

describe('WM-4 gestures — a tap must change nothing', () => {
  // Removed after physical iPhone testing. One tap on iOS produces a
  // pointerdown/up pair with pointerType 'touch' and then a synthesised
  // compatibility pair with pointerType 'mouse' at the same point, so any
  // time-based double-tap detector fires on a single finger.

  test('no tap gesture is exported at all', () => {
    assert.strictEqual(g.registerTap, undefined, 'the tap detector is back');
    assert.strictEqual(g.doubleTapTransform, undefined, 'the double-tap zoom is back');
    assert.strictEqual(g.DOUBLE_TAP_MS, undefined);
    assert.strictEqual(g.DOUBLE_TAP_ZOOM, undefined);
  });

  test('a single tap leaves the transform untouched', () => {
    const s = g.createGestureState();
    const v0 = vp.fitToViewport(STAGE, PHONE);
    down(s, 1, 195, 350, v0);
    const r = g.pointerUp(s, 1, v0);
    assert.deepStrictEqual(r.viewport, v0);
    assert.strictEqual(r.changed, false);
  });

  test('THE iPHONE DEFECT: a touch pair followed by a compatibility pair does nothing', () => {
    // Exactly the sequence WebKit produces for ONE finger.
    const s = g.createGestureState();
    const v0 = vp.fitToViewport(STAGE, PHONE);
    let v = v0;
    for (const id of [1, 2]) {                 // touch pointer, then mouse pointer
      down(s, id, 195, 350, v);
      v = g.pointerUp(s, id, v).viewport;
    }
    assert.deepStrictEqual(v, v0, 'a single physical tap changed the transform');
  });

  test('two deliberate rapid taps also change nothing', () => {
    const s = g.createGestureState();
    const v0 = vp.fitToViewport(STAGE, PHONE);
    let v = v0;
    for (let i = 0; i < 4; i++) {
      down(s, i, 195, 350, v);
      v = g.pointerUp(s, i, v).viewport;
    }
    assert.deepStrictEqual(v, v0);
  });

  test('a tap after a pan changes nothing further', () => {
    const s = g.createGestureState();
    const v0 = vp.fitToViewport(STAGE, PHONE);
    down(s, 1, 100, 300, v0);
    move(s, 1, 200, 300, v0);
    const panned = move(s, 1, 260, 340, v0).viewport;
    g.pointerUp(s, 1, panned);
    down(s, 2, 260, 340, panned);
    const after = g.pointerUp(s, 2, panned).viewport;
    assert.deepStrictEqual(after, panned);
  });

  test('releasing after a pinch does not zoom again', () => {
    const s = g.createGestureState();
    const v0 = { scale: 1, translateX: 0, translateY: 0 };
    down(s, 1, 100, 300, v0);
    down(s, 2, 300, 300, v0);
    const zoomed = move(s, 2, 500, 300, v0).viewport;
    const afterFirst = g.pointerUp(s, 1, zoomed).viewport;
    const afterSecond = g.pointerUp(s, 2, afterFirst).viewport;
    assert.deepStrictEqual(afterFirst, zoomed, 'lifting the first finger changed the transform');
    assert.deepStrictEqual(afterSecond, zoomed, 'lifting the second finger changed the transform');
  });

  test('PINCH OUT REACHES THE FLOOR AND STAYS THERE', () => {
    const floor = vp.minScaleFor(STAGE, PHONE);
    const s = g.createGestureState();
    let v = vp.fitToViewport(STAGE, PHONE);

    // 1. pinch in hard
    down(s, 1, 150, 300, v);
    down(s, 2, 250, 300, v);
    v = move(s, 2, 900, 300, v).viewport;
    assert.ok(v.scale > floor * 3, `expected a real zoom in, got ${v.scale}`);
    g.pointerUp(s, 1, v); g.pointerUp(s, 2, v);

    // 2. pinch out all the way
    down(s, 3, 100, 300, v);
    down(s, 4, 340, 300, v);
    v = move(s, 4, 101, 300, v).viewport;
    assert.ok(Math.abs(v.scale - floor) < 1e-9, `expected the floor ${floor}, got ${v.scale}`);

    // 3. release both — the scale must not bounce back
    const afterFirst = g.pointerUp(s, 3, v).viewport;
    const afterSecond = g.pointerUp(s, 4, afterFirst).viewport;
    assert.ok(Math.abs(afterSecond.scale - floor) < 1e-9,
      `scale bounced to ${afterSecond.scale} after release`);
    assert.strictEqual(s.mode, 'idle');
  });

  test('pointercancel does not trigger any tap behaviour', () => {
    const s = g.createGestureState();
    const v0 = vp.fitToViewport(STAGE, PHONE);
    down(s, 1, 195, 350, v0);
    g.cancelAll(s);
    down(s, 2, 195, 350, v0);
    const after = g.pointerUp(s, 2, v0).viewport;
    assert.deepStrictEqual(after, v0);
  });

  test('the controller has no tap branch left', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'wiremap', 'app.js'), 'utf8');
    assert.ok(!/registerTap|doubleTap|dragged/.test(src),
      'tap plumbing survives in the controller');
    const up = src.slice(src.indexOf('function onPointerUp'), src.indexOf('function onPointerCancel'));
    assert.ok(!/zoomAt|fit\(\)|setViewport/.test(up),
      'pointerup must not change the transform');
  });
});

describe('WM-4 gestures — viewport resize', () => {
  const LAND = { width: 844, height: 320 };

  test('at fit, a rotation recomputes fit for the new viewport', () => {
    const fit = vp.fitToViewport(STAGE, PHONE);
    const after = g.reflowForViewportChange(fit, STAGE, PHONE, LAND, true);
    assert.deepStrictEqual(after, vp.fitToViewport(STAGE, LAND));
  });

  test('when zoomed, the centre point is preserved rather than reset', () => {
    const zoomed = vp.clampTranslation(
      vp.zoomAt(vp.fitToViewport(STAGE, PHONE), { x: 195, y: 350 }, 3), STAGE, PHONE);
    const centreBefore = vp.screenToStage({ x: PHONE.width / 2, y: PHONE.height / 2 }, zoomed);
    const after = g.reflowForViewportChange(zoomed, STAGE, PHONE, LAND, false);
    const centreAfter = vp.screenToStage({ x: LAND.width / 2, y: LAND.height / 2 }, after);
    // Clamping may shift it near an edge, but it must not reset to the corner.
    assert.ok(Math.abs(centreAfter.x - centreBefore.x) < STAGE.width * 0.5,
      'the view jumped away from where the user was looking');
    assert.ok(!(after.translateX === 0 && after.translateY === 0), 'reset to the corner');
  });

  test('resize never produces a non-finite transform', () => {
    for (const size of [{ width: 1, height: 1 }, { width: 3000, height: 200 }, LAND]) {
      const r = g.reflowForViewportChange(vp.identity(), STAGE, PHONE, size, false);
      assert.ok(finite(r), `bad transform for ${JSON.stringify(size)}`);
    }
  });

  test('the result stays within bounds after a resize', () => {
    const zoomed = { scale: 4, translateX: -3000, translateY: -2000 };
    const after = g.reflowForViewportChange(zoomed, STAGE, PHONE, LAND, false);
    assert.deepStrictEqual(after, vp.clampTranslation(after, STAGE, LAND));
  });

  test('isAtFit recognises the fit transform and rejects a zoomed one', () => {
    const fit = vp.fitToViewport(STAGE, PHONE);
    assert.strictEqual(g.isAtFit(fit, STAGE, PHONE), true);
    assert.strictEqual(g.isAtFit({ ...fit, scale: fit.scale * 3 }, STAGE, PHONE), false);
  });

  test('resize does not touch stored normalized coordinates', () => {
    const stored = { x: 0.42, y: 0.63 };
    const snapshot = JSON.stringify(stored);
    g.reflowForViewportChange(vp.fitToViewport(STAGE, PHONE), STAGE, PHONE, LAND, true);
    assert.strictEqual(JSON.stringify(stored), snapshot);
  });
});
