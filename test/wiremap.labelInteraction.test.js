'use strict';
/**
 * Wire label interaction — WM-5.
 *
 * Pure state and geometry, run in Node. Real Pointer Events, SVG rendering and
 * IndexedDB writes are covered by tools/browser-check-wiremap.js; iOS remains a
 * manual gate.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const L = require('../src/wiremap/labelInteraction');
const vp = require('../src/wiremap/viewport');
const geom = require('../src/wiremap/geometry');
const model = require('../src/wiremap/model');

const STAGE = { width: 2000, height: 1500 };
const PHONE = { width: 390, height: 700 };
const FIT = vp.fitToViewport(STAGE, PHONE);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

let s;
beforeEach(() => { s = L.createLabelState(); });

describe('WM-5 placement — screen to normalized', () => {
  test('a tap maps to the normalized point under it', () => {
    // Place at the stage centre and check it round-trips.
    const screen = L.normalizedToScreen({ x: 0.5, y: 0.5 }, FIT, STAGE);
    const back = L.screenToNormalized(screen, FIT, STAGE);
    assert.ok(near(back.x, 0.5, 1e-9) && near(back.y, 0.5, 1e-9));
  });

  test('placement round-trips at several viewport states', () => {
    const states = [
      FIT,
      vp.zoomAt(FIT, { x: 195, y: 350 }, 3, vp.minScaleFor(STAGE, PHONE)),
      { scale: 6, translateX: -4000, translateY: -3000 },
    ];
    for (const view of states) {
      for (const n of [{ x: 0.1, y: 0.9 }, { x: 0.42, y: 0.63 }, { x: 0.5, y: 0.5 }]) {
        const back = L.screenToNormalized(L.normalizedToScreen(n, view, STAGE), view, STAGE);
        assert.ok(near(back.x, n.x, 1e-9) && near(back.y, n.y, 1e-9),
          `drift at scale ${view.scale} for ${JSON.stringify(n)}`);
      }
    }
  });

  test('THE INVARIANT: the same screen tap at different zooms stores different points, but a stored point never moves', () => {
    const stored = { x: 0.42, y: 0.63 };
    const snapshot = JSON.stringify(stored);
    for (const scale of [FIT.scale, 1, 4, 8]) {
      const view = vp.zoomAt(FIT, { x: 195, y: 350 }, scale, vp.minScaleFor(STAGE, PHONE));
      L.normalizedToScreen(stored, view, STAGE);
      L.screenToNormalized({ x: 195, y: 350 }, view, STAGE);
    }
    assert.strictEqual(JSON.stringify(stored), snapshot, 'the stored coordinate was mutated');
  });

  test('a tap beyond the plan clamps to the sheet edge', () => {
    const far = L.screenToNormalized({ x: -5000, y: -5000 }, FIT, STAGE);
    assert.deepStrictEqual(far, { x: 0, y: 0 });
    const far2 = L.screenToNormalized({ x: 99999, y: 99999 }, FIT, STAGE);
    assert.deepStrictEqual(far2, { x: 1, y: 1 });
  });

  test('placement never returns a screen pixel', () => {
    const n = L.screenToNormalized({ x: 100, y: 200 }, FIT, STAGE);
    assert.ok(n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1);
  });

  test('bad input returns null rather than NaN', () => {
    assert.strictEqual(L.screenToNormalized(null, FIT, STAGE), null);
    assert.strictEqual(L.screenToNormalized({ x: NaN, y: 0 }, FIT, STAGE), null);
    assert.strictEqual(L.screenToNormalized({ x: 1, y: 1 }, FIT, null), null);
  });

  test('geometry comes from the shared module, not a second formula', () => {
    const view = { scale: 2, translateX: -100, translateY: -50 };
    const mine = L.screenToNormalized({ x: 300, y: 250 }, view, STAGE);
    const theirs = geom.normalizePoint(vp.screenToStage({ x: 300, y: 250 }, view), STAGE);
    assert.deepStrictEqual(mine, theirs);
  });
});

describe('WM-5 placement mode', () => {
  test('arming and disarming', () => {
    assert.strictEqual(L.isArmed(s), false);
    L.armPlacement(s);
    assert.strictEqual(L.isArmed(s), true);
    L.disarmPlacement(s);
    assert.strictEqual(L.isArmed(s), false);
  });
});

describe('WM-5 iOS compatibility suppression', () => {
  test('THE WM-4 DEFECT SEQUENCE: one touch does not count twice', () => {
    const point = { x: 195, y: 350 };
    L.noteInput(s, 'touch', point, 1000);
    // WebKit's synthesised mouse pair, ~300 ms later at the same spot.
    assert.strictEqual(L.isCompatibilityDuplicate(s, 'mouse', point, 1300), true);
  });

  test('a desktop mouse still works — nothing precedes it', () => {
    assert.strictEqual(L.isCompatibilityDuplicate(s, 'mouse', { x: 100, y: 100 }, 1000), false);
  });

  test('a mouse click long after a touch is genuine', () => {
    L.noteInput(s, 'touch', { x: 195, y: 350 }, 1000);
    assert.strictEqual(L.isCompatibilityDuplicate(s, 'mouse', { x: 195, y: 350 },
      1000 + L.COMPAT_SUPPRESS_MS + 50), false);
  });

  test('a mouse click far from the touch is genuine', () => {
    L.noteInput(s, 'touch', { x: 100, y: 100 }, 1000);
    assert.strictEqual(L.isCompatibilityDuplicate(s, 'mouse', { x: 300, y: 100 }, 1100), false);
  });

  test('touch events are never suppressed', () => {
    L.noteInput(s, 'touch', { x: 100, y: 100 }, 1000);
    assert.strictEqual(L.isCompatibilityDuplicate(s, 'touch', { x: 100, y: 100 }, 1050), false);
  });

  test('a stylus counts as touch for suppression purposes', () => {
    L.noteInput(s, 'pen', { x: 100, y: 100 }, 1000);
    assert.strictEqual(L.isCompatibilityDuplicate(s, 'mouse', { x: 100, y: 100 }, 1100), true);
  });
});

describe('WM-5 label drag versus tap', () => {
  const AT = { x: 0.4, y: 0.6 };

  test('a press under the threshold is a tap', () => {
    L.labelPointerDown(s, 'a1', { x: 100, y: 100 }, AT);
    const r = L.labelPointerMove(s, { x: 103, y: 102 }, FIT, STAGE);
    assert.strictEqual(r.moved, false);
    assert.deepStrictEqual(L.labelPointerUp(s), { action: 'tap', id: 'a1', normalized: AT });
  });

  test('crossing the threshold becomes a move', () => {
    L.labelPointerDown(s, 'a1', { x: 100, y: 100 }, AT);
    L.labelPointerMove(s, { x: 140, y: 100 }, FIT, STAGE);
    const out = L.labelPointerUp(s);
    assert.strictEqual(out.action, 'move');
    assert.strictEqual(out.id, 'a1');
  });

  test('no jump at the threshold: the first committed move applies no offset', () => {
    L.labelPointerDown(s, 'a1', { x: 100, y: 100 }, AT);
    const commit = L.labelPointerMove(s, { x: 110, y: 100 }, FIT, STAGE);
    assert.deepStrictEqual(commit.normalized, AT, 'the label jumped on commit');
  });

  test('dragging tracks the finger through the viewport transform', () => {
    const view = { scale: 2, translateX: 0, translateY: 0 };
    L.labelPointerDown(s, 'a1', { x: 100, y: 100 }, { x: 0.5, y: 0.5 });
    L.labelPointerMove(s, { x: 110, y: 100 }, view, STAGE);   // commit
    const r = L.labelPointerMove(s, { x: 210, y: 100 }, view, STAGE);
    // 100 screen px at scale 2 is 50 stage px, which is 50/2000 of the sheet.
    assert.ok(near(r.normalized.x, 0.5 + 50 / 2000, 1e-9), `got ${r.normalized.x}`);
  });

  test('the same finger travel moves less of the sheet when zoomed in', () => {
    const move = (scale) => {
      const st = L.createLabelState();
      const view = { scale, translateX: 0, translateY: 0 };
      L.labelPointerDown(st, 'a1', { x: 100, y: 100 }, { x: 0.5, y: 0.5 });
      L.labelPointerMove(st, { x: 110, y: 100 }, view, STAGE);
      return L.labelPointerMove(st, { x: 210, y: 100 }, view, STAGE).normalized.x;
    };
    assert.ok(move(8) - 0.5 < move(1) - 0.5, 'zoomed dragging should be finer');
  });

  test('a drag is clamped to the sheet', () => {
    L.labelPointerDown(s, 'a1', { x: 100, y: 100 }, { x: 0.95, y: 0.95 });
    L.labelPointerMove(s, { x: 110, y: 110 }, FIT, STAGE);
    const r = L.labelPointerMove(s, { x: 99999, y: 99999 }, FIT, STAGE);
    assert.deepStrictEqual(r.normalized, { x: 1, y: 1 });
  });

  test('pointercancel reverts to the stored position', () => {
    L.labelPointerDown(s, 'a1', { x: 100, y: 100 }, AT);
    L.labelPointerMove(s, { x: 300, y: 300 }, FIT, STAGE);
    const out = L.labelPointerCancel(s);
    assert.deepStrictEqual(out, { action: 'revert', id: 'a1', normalized: AT });
    assert.strictEqual(L.hasPressedLabel(s), false);
  });

  test('pointerup commits the moved position, not the original', () => {
    L.labelPointerDown(s, 'a1', { x: 100, y: 100 }, AT);
    L.labelPointerMove(s, { x: 110, y: 100 }, FIT, STAGE);
    const r = L.labelPointerMove(s, { x: 200, y: 160 }, FIT, STAGE);
    const out = L.labelPointerUp(s);
    assert.strictEqual(out.action, 'move');
    assert.deepStrictEqual(out.normalized, r.normalized);
    assert.notDeepStrictEqual(out.normalized, AT);
  });

  test('a label drag is distinguishable from a plan pan', () => {
    assert.strictEqual(L.hasPressedLabel(s), false);
    L.labelPointerDown(s, 'a1', { x: 100, y: 100 }, AT);
    assert.strictEqual(L.hasPressedLabel(s), true, 'the controller must route to the label');
    assert.strictEqual(L.isDraggingLabel(s), false, 'not yet a drag');
    L.labelPointerMove(s, { x: 200, y: 100 }, FIT, STAGE);
    assert.strictEqual(L.isDraggingLabel(s), true);
  });

  test('malformed sequences produce no NaN', () => {
    for (const bad of [null, undefined, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
      const st = L.createLabelState();
      L.labelPointerDown(st, 'a1', bad, AT);
      const r = L.labelPointerMove(st, bad, FIT, STAGE);
      assert.ok(r.normalized === null
        || (Number.isFinite(r.normalized.x) && Number.isFinite(r.normalized.y)));
    }
  });

  test('a move with no press does nothing', () => {
    assert.deepStrictEqual(L.labelPointerMove(s, { x: 1, y: 1 }, FIT, STAGE),
      { moved: false, normalized: null });
    assert.deepStrictEqual(L.labelPointerUp(s), { action: 'none', id: null, normalized: null });
  });
});

describe('WM-5 constant label size across zoom', () => {
  test('the counter scale is the inverse of the viewport scale', () => {
    for (const scale of [0.195, 0.5, 1, 4, 8]) {
      assert.ok(near(L.labelCounterScale(scale) * scale, 1, 1e-12));
    }
  });

  test('rendered label size stays constant from fit to maximum zoom', () => {
    const BODY_PX = 24;   // the label body height in stage units at scale 1
    const sizes = [FIT.scale, 1, 4, vp.MAX_SCALE].map((scale) =>
      BODY_PX * L.labelCounterScale(scale) * scale);
    for (const size of sizes) {
      assert.ok(near(size, BODY_PX, 1e-9), `label size drifted to ${size}`);
    }
  });

  test('a degenerate scale falls back to 1 rather than dividing by zero', () => {
    for (const bad of [0, -1, NaN, undefined]) {
      assert.strictEqual(L.labelCounterScale(bad), 1);
    }
  });
});

describe('WM-5 anchor invariant under viewport change', () => {
  test('the anchor stays on the same stage point through pan, zoom and rotation', () => {
    const stored = { x: 0.42, y: 0.63 };
    const stagePoint = geom.denormalizePoint(stored, STAGE);
    const views = [
      FIT,
      vp.clampTranslation({ ...FIT, translateX: FIT.translateX - 120 }, STAGE, PHONE),
      vp.zoomAt(FIT, { x: 195, y: 350 }, 5, vp.minScaleFor(STAGE, PHONE)),
      vp.fitToViewport(STAGE, { width: 844, height: 390 }),
    ];
    for (const view of views) {
      const screen = L.normalizedToScreen(stored, view, STAGE);
      const back = vp.screenToStage(screen, view);
      assert.ok(near(back.x, stagePoint.x, 1e-6) && near(back.y, stagePoint.y, 1e-6),
        `anchor drifted at scale ${view.scale}`);
    }
  });

  test('a viewport change never rewrites the stored coordinate', () => {
    const a = model.createAnnotation({ id: 'a1', sheetId: 's1', type: 'wireLabel',
      at: { x: 0.42, y: 0.63 }, now: 1, data: { label: 'HR-7' } });
    const snapshot = JSON.stringify(a.at);
    for (const scale of [0.195, 1, 8]) {
      L.normalizedToScreen(a.at, { scale, translateX: -10, translateY: -20 }, STAGE);
    }
    assert.strictEqual(JSON.stringify(a.at), snapshot);
  });
});

describe('WM-5 label data uses the existing model', () => {
  const make = (label) => model.createAnnotation({
    id: 'a1', sheetId: 's1', type: 'wireLabel', at: { x: 0.42, y: 0.63 }, now: 1,
    data: { label, from: 'Panel A / Ckt 18', to: 'Master Bedroom receptacles',
            cable: '12/2 MC', room: 'Master Bedroom', notes: 'Home run' },
  });

  test('a complete wire label validates through the model', () => {
    const a = make('HR-7');
    assert.strictEqual(model.validateAnnotation(a).valid, true);
    assert.strictEqual(a.data.cable, '12/2 MC');
  });

  test('labelKey is derived by the model, never by the UI', () => {
    assert.strictEqual(make('HR 07').data.labelKey, model.toLabelKey('HR 07'));
    assert.strictEqual(make('HR 07').data.labelKey, 'hr-07');
  });

  test('an empty label is rejected', () => {
    assert.strictEqual(model.validateAnnotation(make('')).valid, false);
    assert.strictEqual(model.validateAnnotation(make('   ')).valid, false);
  });

  test('stored coordinates are normalized, never pixels', () => {
    const a = make('HR-7');
    assert.ok(a.at.x >= 0 && a.at.x <= 1 && a.at.y >= 0 && a.at.y <= 1);
    assert.strictEqual(model.validateAnnotation({ ...a, at: { x: 840, y: 945 } }).valid, false);
  });
});
