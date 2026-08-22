'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const g = require('../src/wiremap/geometry');

const SHEET = { width: 2000, height: 1500 };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('Wire Map geometry — normalize and denormalize', () => {
  test('the origin maps to 0,0 in both directions', () => {
    assert.deepStrictEqual(g.normalizePoint({ x: 0, y: 0 }, SHEET), { x: 0, y: 0 });
    assert.deepStrictEqual(g.denormalizePoint({ x: 0, y: 0 }, SHEET), { x: 0, y: 0 });
  });

  test('the far corner maps to 1,1 in both directions', () => {
    assert.deepStrictEqual(g.normalizePoint({ x: 2000, y: 1500 }, SHEET), { x: 1, y: 1 });
    assert.deepStrictEqual(g.denormalizePoint({ x: 1, y: 1 }, SHEET), { x: 2000, y: 1500 });
  });

  test('the centre maps to 0.5, 0.5', () => {
    assert.deepStrictEqual(g.normalizePoint({ x: 1000, y: 750 }, SHEET), { x: 0.5, y: 0.5 });
    assert.deepStrictEqual(g.denormalizePoint({ x: 0.5, y: 0.5 }, SHEET), { x: 1000, y: 750 });
  });

  test('the documented example survives a round trip', () => {
    const stored = { x: 0.42, y: 0.63 };
    const px = g.denormalizePoint(stored, SHEET);
    assert.deepStrictEqual(px, { x: 840, y: 945 });
    const back = g.normalizePoint(px, SHEET);
    assert.ok(near(back.x, 0.42) && near(back.y, 0.63));
  });

  test('round trips hold across very different sheet sizes', () => {
    const sizes = [
      { width: 100, height: 100 },
      { width: 4032, height: 3024 },
      { width: 800, height: 3000 },
      { width: 1, height: 1 },
    ];
    for (const size of sizes) {
      for (const n of [{ x: 0, y: 0 }, { x: 0.42, y: 0.63 }, { x: 1, y: 1 }, { x: 0.999, y: 0.001 }]) {
        const back = g.normalizePoint(g.denormalizePoint(n, size), size);
        assert.ok(near(back.x, n.x, 1e-12) && near(back.y, n.y, 1e-12),
          `round trip failed for ${JSON.stringify(n)} on ${JSON.stringify(size)}`);
      }
    }
  });

  test('THE POINT OF NORMALIZING: the stored value is independent of the sheet size', () => {
    // The same normalized coordinate resolves to different pixels on different
    // sheets, but the stored number never changes. Resizing must not rewrite data.
    const stored = { x: 0.25, y: 0.75 };
    assert.deepStrictEqual(g.denormalizePoint(stored, { width: 400, height: 400 }), { x: 100, y: 300 });
    assert.deepStrictEqual(g.denormalizePoint(stored, { width: 4000, height: 800 }), { x: 1000, y: 600 });
    assert.deepStrictEqual(stored, { x: 0.25, y: 0.75 });
  });
});

describe('Wire Map geometry — clamping', () => {
  test('values beyond the sheet are pulled to the edge', () => {
    assert.deepStrictEqual(g.clampNormalized({ x: 1.4, y: -0.2 }), { x: 1, y: 0 });
    assert.deepStrictEqual(g.clampNormalized({ x: -5, y: 9 }), { x: 0, y: 1 });
  });

  test('values already inside are left alone', () => {
    assert.deepStrictEqual(g.clampNormalized({ x: 0.42, y: 0.63 }), { x: 0.42, y: 0.63 });
  });

  test('edges are inclusive', () => {
    assert.deepStrictEqual(g.clampNormalized({ x: 0, y: 1 }), { x: 0, y: 1 });
  });

  test('missing or non-finite input collapses to the origin rather than NaN', () => {
    for (const bad of [null, undefined, {}, { x: NaN, y: 0.5 }, { x: Infinity, y: 0 }]) {
      const r = g.clampNormalized(bad);
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), `NaN leaked for ${JSON.stringify(bad)}`);
    }
  });

  test('a pixel position outside the sheet normalises to the edge', () => {
    assert.deepStrictEqual(g.normalizePoint({ x: 5000, y: -100 }, SHEET), { x: 1, y: 0 });
  });

  test('isInsideSheet reports membership without clamping', () => {
    assert.strictEqual(g.isInsideSheet({ x: 0.5, y: 0.5 }), true);
    assert.strictEqual(g.isInsideSheet({ x: 1, y: 0 }), true);
    assert.strictEqual(g.isInsideSheet({ x: 1.0001, y: 0.5 }), false);
    assert.strictEqual(g.isInsideSheet(null), false);
  });
});

describe('Wire Map geometry — invalid sizes', () => {
  test('a zero or negative sheet is rejected rather than dividing by zero', () => {
    for (const bad of [{ width: 0, height: 10 }, { width: 10, height: 0 },
      { width: -5, height: 5 }, null, undefined, {}]) {
      assert.strictEqual(g.normalizePoint({ x: 1, y: 1 }, bad), null);
      assert.strictEqual(g.denormalizePoint({ x: 0.5, y: 0.5 }, bad), null);
    }
  });

  test('non-numeric points are rejected', () => {
    assert.strictEqual(g.normalizePoint({ x: 'a', y: 1 }, SHEET), null);
    assert.strictEqual(g.denormalizePoint({ x: undefined, y: 0.5 }, SHEET), null);
  });
});

describe('Wire Map geometry — two-point shapes', () => {
  test('both endpoints are clamped independently', () => {
    const s = g.clampSegment({ a: { x: -1, y: 0.5 }, b: { x: 0.5, y: 3 } });
    assert.deepStrictEqual(s, { a: { x: 0, y: 0.5 }, b: { x: 0.5, y: 1 } });
  });

  test('bounds are normalised regardless of endpoint order', () => {
    const forward = g.segmentBounds({ a: { x: 0.2, y: 0.8 }, b: { x: 0.7, y: 0.1 } });
    const reversed = g.segmentBounds({ a: { x: 0.7, y: 0.1 }, b: { x: 0.2, y: 0.8 } });
    assert.deepStrictEqual(forward, reversed);
    assert.deepStrictEqual(forward, { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.8 });
  });

  test('a two-point shape is stable across sheet sizes', () => {
    // Endpoints, not length and angle: the shape follows the plan when the
    // aspect ratio changes instead of skewing.
    const seg = { a: { x: 0.1, y: 0.2 }, b: { x: 0.9, y: 0.8 } };
    for (const size of [{ width: 1000, height: 1000 }, { width: 3000, height: 500 }]) {
      const a = g.denormalizePoint(seg.a, size);
      const b = g.denormalizePoint(seg.b, size);
      assert.deepStrictEqual(g.normalizePoint(a, size), seg.a);
      assert.deepStrictEqual(g.normalizePoint(b, size), seg.b);
    }
  });

  test('a degenerate segment produces zero-area bounds without error', () => {
    const b = g.segmentBounds({ a: { x: 0.5, y: 0.5 }, b: { x: 0.5, y: 0.5 } });
    assert.deepStrictEqual(b, { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 });
  });
});

describe('Wire Map geometry — distance', () => {
  test('distance accounts for the aspect ratio, not raw normalized units', () => {
    // 0.1 across a 2000px sheet is 200px; 0.1 down a 1500px sheet is 150px.
    const dx = g.distanceOnSheet({ x: 0, y: 0 }, { x: 0.1, y: 0 }, SHEET);
    const dy = g.distanceOnSheet({ x: 0, y: 0 }, { x: 0, y: 0.1 }, SHEET);
    assert.ok(near(dx, 200) && near(dy, 150), `${dx} / ${dy}`);
    assert.notStrictEqual(dx, dy);
  });

  test('distance is zero for identical points and rejects a bad sheet', () => {
    assert.strictEqual(g.distanceOnSheet({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 }, SHEET), 0);
    assert.strictEqual(g.distanceOnSheet({ x: 0, y: 0 }, { x: 1, y: 1 }, { width: 0, height: 1 }), null);
  });
});
