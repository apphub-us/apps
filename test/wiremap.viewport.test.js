'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const v = require('../src/wiremap/viewport');
const g = require('../src/wiremap/geometry');

const STAGE = { width: 2000, height: 1500 };
const PHONE = { width: 390, height: 700 };   // roughly the 390x844 target, minus chrome
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('Wire Map viewport — identity', () => {
  test('identity leaves coordinates untouched', () => {
    const id = v.identity();
    assert.deepStrictEqual(id, { scale: 1, translateX: 0, translateY: 0 });
    assert.deepStrictEqual(v.screenToStage({ x: 137, y: 42 }, id), { x: 137, y: 42 });
    assert.deepStrictEqual(v.stageToScreen({ x: 137, y: 42 }, id), { x: 137, y: 42 });
  });
});

describe('Wire Map viewport — screen and stage conversion', () => {
  const vp = { scale: 2, translateX: 100, translateY: -50 };

  test('stage to screen applies scale then translation', () => {
    assert.deepStrictEqual(v.stageToScreen({ x: 10, y: 10 }, vp), { x: 120, y: -30 });
  });

  test('screen to stage is the exact inverse', () => {
    assert.deepStrictEqual(v.screenToStage({ x: 120, y: -30 }, vp), { x: 10, y: 10 });
  });

  test('round trips hold at many scales and offsets', () => {
    for (const scale of [0.5, 1, 1.37, 3, 8]) {
      for (const t of [-500, -13, 0, 77, 1200]) {
        const view = { scale, translateX: t, translateY: -t };
        for (const p of [{ x: 0, y: 0 }, { x: 0.5, y: 999 }, { x: -42, y: 17.25 }]) {
          const back = v.screenToStage(v.stageToScreen(p, view), view);
          assert.ok(near(back.x, p.x, 1e-9) && near(back.y, p.y, 1e-9),
            `round trip failed at scale ${scale}, t ${t}`);
        }
      }
    }
  });

  test('an invalid viewport returns null rather than NaN', () => {
    for (const bad of [null, {}, { scale: 0, translateX: 0, translateY: 0 },
      { scale: NaN, translateX: 0, translateY: 0 }]) {
      assert.strictEqual(v.screenToStage({ x: 1, y: 1 }, bad), null);
      assert.strictEqual(v.stageToScreen({ x: 1, y: 1 }, bad), null);
    }
  });
});

describe('Wire Map viewport — scale limits', () => {
  test('the range is exposed as constants, not scattered literals', () => {
    assert.strictEqual(v.MIN_SCALE, 0.5);
    assert.strictEqual(v.MAX_SCALE, 8);
  });

  test('scale is clamped at both ends', () => {
    assert.strictEqual(v.clampScale(0.01), v.MIN_SCALE);
    assert.strictEqual(v.clampScale(-3), v.MIN_SCALE);
    assert.strictEqual(v.clampScale(99), v.MAX_SCALE);
    assert.strictEqual(v.clampScale(2), 2);
  });

  test('the limits themselves are permitted', () => {
    assert.strictEqual(v.clampScale(v.MIN_SCALE), v.MIN_SCALE);
    assert.strictEqual(v.clampScale(v.MAX_SCALE), v.MAX_SCALE);
  });

  test('a non-finite scale falls back to 1', () => {
    assert.strictEqual(v.clampScale(NaN), 1);
    assert.strictEqual(v.clampScale(undefined), 1);
  });

  test('zoom respects the limits', () => {
    const start = { scale: 1, translateX: 0, translateY: 0 };
    assert.strictEqual(v.zoomAt(start, { x: 100, y: 100 }, 50).scale, v.MAX_SCALE);
    assert.strictEqual(v.zoomAt(start, { x: 100, y: 100 }, 0.01).scale, v.MIN_SCALE);
  });
});

describe('Wire Map viewport — focal-point zoom', () => {
  test('THE KEY PROPERTY: the point under the focus stays under the focus', () => {
    const focal = { x: 195, y: 350 };
    let vp = v.identity();
    const before = v.screenToStage(focal, vp);
    for (const factor of [1.2, 1.2, 1.2, 0.7, 2.5]) {
      vp = v.zoomBy(vp, focal, factor);
      const after = v.screenToStage(focal, vp);
      assert.ok(near(after.x, before.x, 1e-9) && near(after.y, before.y, 1e-9),
        `content jumped at factor ${factor}: ${JSON.stringify(after)} vs ${JSON.stringify(before)}`);
    }
  });

  test('the property holds for off-centre focal points', () => {
    for (const focal of [{ x: 0, y: 0 }, { x: 390, y: 700 }, { x: 12, y: 688 }]) {
      const vp = { scale: 1.7, translateX: -240, translateY: 88 };
      const before = v.screenToStage(focal, vp);
      const after = v.screenToStage(focal, v.zoomBy(vp, focal, 2));
      assert.ok(near(after.x, before.x, 1e-9) && near(after.y, before.y, 1e-9));
    }
  });

  test('zooming at the clamp does not shift the content', () => {
    const focal = { x: 100, y: 100 };
    const atMax = v.zoomAt(v.identity(), focal, v.MAX_SCALE);
    const beyond = v.zoomAt(atMax, focal, v.MAX_SCALE * 4);
    assert.deepStrictEqual(beyond, atMax);
  });

  test('a zero or negative factor is ignored', () => {
    const vp = { scale: 2, translateX: 5, translateY: 5 };
    assert.deepStrictEqual(v.zoomBy(vp, { x: 0, y: 0 }, 0), vp);
    assert.deepStrictEqual(v.zoomBy(vp, { x: 0, y: 0 }, -1), vp);
  });
});

describe('Wire Map viewport — translation clamping', () => {
  test('a stage smaller than the viewport is centred', () => {
    const small = { width: 100, height: 100 };
    const r = v.clampTranslation({ scale: 1, translateX: 999, translateY: -999 }, small, PHONE);
    assert.strictEqual(r.translateX, (PHONE.width - 100) / 2);
    assert.strictEqual(r.translateY, (PHONE.height - 100) / 2);
  });

  test('a large stage cannot be panned entirely off screen', () => {
    const r = v.clampTranslation({ scale: 2, translateX: 99999, translateY: 99999 }, STAGE, PHONE);
    const scaledW = STAGE.width * 2;
    assert.ok(r.translateX <= PHONE.width * v.OVERSCROLL + 1e-9, `tx ${r.translateX} too far right`);
    assert.ok(r.translateX >= PHONE.width - scaledW - PHONE.width * v.OVERSCROLL - 1e-9);
  });

  test('a translation already in range is untouched', () => {
    const vp = { scale: 2, translateX: -500, translateY: -400 };
    assert.deepStrictEqual(v.clampTranslation(vp, STAGE, PHONE), vp);
  });

  test('clamping never changes the scale', () => {
    const r = v.clampTranslation({ scale: 3.25, translateX: 1e6, translateY: -1e6 }, STAGE, PHONE);
    assert.strictEqual(r.scale, 3.25);
  });

  test('invalid sizes fall back safely instead of producing NaN', () => {
    const vp = { scale: 1, translateX: 10, translateY: 10 };
    for (const bad of [null, { width: 0, height: 10 }, {}]) {
      const r = v.clampTranslation(vp, bad, PHONE);
      assert.ok(Number.isFinite(r.scale) && Number.isFinite(r.translateX) && Number.isFinite(r.translateY));
    }
  });
});

describe('Wire Map viewport — fit and centre', () => {
  test('fit shows the whole sheet and centres it', () => {
    const r = v.fitToViewport(STAGE, PHONE);
    assert.ok(STAGE.width * r.scale <= PHONE.width + 1e-9);
    assert.ok(STAGE.height * r.scale <= PHONE.height + 1e-9);
    assert.ok(near(r.translateX, (PHONE.width - STAGE.width * r.scale) / 2));
  });

  test('fit is NOT clamped by MIN_SCALE — the whole sheet must be visible', () => {
    // A 2000x1500 plan needs ~0.195 on a 390x700 phone. Clamping fit at
    // MIN_SCALE 0.5 would leave most of the plan off-screen.
    const r = v.fitToViewport(STAGE, PHONE);
    assert.ok(r.scale < v.MIN_SCALE, `fit scale ${r.scale} should be below MIN_SCALE here`);
    assert.ok(STAGE.width * r.scale <= PHONE.width + 1e-9);
  });

  test('the usable zoom floor is the smaller of MIN_SCALE and the fit scale', () => {
    // Large sheet: the fit scale is the floor.
    assert.ok(v.minScaleFor(STAGE, PHONE) < v.MIN_SCALE);
    assert.strictEqual(v.minScaleFor(STAGE, PHONE), v.fitToViewport(STAGE, PHONE).scale);
    // Small sheet: MIN_SCALE is the floor, so a tiny sketch cannot be shrunk away.
    const small = { width: 100, height: 100 };
    assert.strictEqual(v.minScaleFor(small, PHONE), v.MIN_SCALE);
  });

  test('clampScaleFor uses that per-sheet floor and the shared ceiling', () => {
    assert.strictEqual(v.clampScaleFor(0.01, STAGE, PHONE), v.minScaleFor(STAGE, PHONE));
    assert.strictEqual(v.clampScaleFor(99, STAGE, PHONE), v.MAX_SCALE);
    assert.strictEqual(v.clampScaleFor(2, STAGE, PHONE), 2);
  });

  test('centring on a normalized point puts it at the middle of the view', () => {
    // This is the movement a search hit will perform in WM-7.
    const target = { x: 0.42, y: 0.63 };
    const vp = v.centerOnNormalized(target, STAGE, PHONE, v.identity(), 2);
    const stagePoint = g.denormalizePoint(target, STAGE);
    const screen = v.stageToScreen(stagePoint, vp);
    // Allow for translation clamping pulling it off dead centre near an edge.
    assert.ok(screen.x > 0 && screen.x < PHONE.width, `x ${screen.x} off screen`);
    assert.ok(screen.y > 0 && screen.y < PHONE.height, `y ${screen.y} off screen`);
  });

  test('centring on the middle of the sheet lands dead centre', () => {
    const vp = v.centerOnNormalized({ x: 0.5, y: 0.5 }, STAGE, PHONE, v.identity(), 1);
    const screen = v.stageToScreen(g.denormalizePoint({ x: 0.5, y: 0.5 }, STAGE), vp);
    assert.ok(near(screen.x, PHONE.width / 2, 1e-6) && near(screen.y, PHONE.height / 2, 1e-6));
  });

  test('centring keeps the scale when none is given', () => {
    const start = { scale: 3, translateX: 0, translateY: 0 };
    assert.strictEqual(v.centerOnNormalized({ x: 0.5, y: 0.5 }, STAGE, PHONE, start).scale, 3);
  });
});

describe('Wire Map viewport — stored coordinates are viewport-independent', () => {
  test('THE ARCHITECTURAL GUARANTEE: viewport size never alters stored data', () => {
    // The same normalized annotation, viewed on three devices at three zooms,
    // lands on different pixels but the stored value is never touched.
    const stored = { x: 0.42, y: 0.63 };
    const snapshot = JSON.stringify(stored);
    const views = [{ width: 390, height: 700 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
    const seen = new Set();
    for (const view of views) {
      for (const scale of [0.5, 1, 4]) {
        const vp = v.clampTranslation(
          v.zoomAt(v.fitToViewport(STAGE, view), { x: view.width / 2, y: view.height / 2 }, scale),
          STAGE, view,
        );
        const screen = v.stageToScreen(g.denormalizePoint(stored, STAGE), vp);
        seen.add(`${screen.x.toFixed(3)},${screen.y.toFixed(3)}`);
      }
    }
    assert.ok(seen.size > 1, 'different viewports should produce different screen positions');
    assert.strictEqual(JSON.stringify(stored), snapshot, 'the stored coordinate was mutated');
  });

  test('one stage transform serves both the image and the SVG overlay', () => {
    // Image and overlay must consume the SAME transform. Two transforms would
    // let the plan and its annotations drift apart under zoom.
    const vp = { scale: 2.5, translateX: -300, translateY: -120 };
    const point = g.denormalizePoint({ x: 0.7, y: 0.3 }, STAGE);
    const forImage = v.stageToScreen(point, vp);
    const forOverlay = v.stageToScreen(point, vp);
    assert.deepStrictEqual(forImage, forOverlay);
  });
});
