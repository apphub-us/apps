'use strict';
/**
 * WM-9A — symbol interaction state.
 * Pure arithmetic, run in Node. Real pointer events against the shipped page
 * are covered by tools/browser-check-wiremap.js; iOS remains a manual gate.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const si = require('../src/wiremap/symbolInteraction');
const vp = require('../src/wiremap/viewport');

const STAGE = { width: 2000, height: 1500 };
const ID = vp.identity();
const at = (x, y) => ({ x, y });

describe('WM-9A symbol placement mode', () => {
  test('arming holds exactly one key; arming another replaces it', () => {
    const s = si.createSymbolState();
    assert.strictEqual(si.isArmed(s), false);
    si.armPlacement(s, 'outlet.duplex');
    assert.strictEqual(si.armedKey(s), 'outlet.duplex');
    si.armPlacement(s, 'device.smoke');
    assert.strictEqual(si.armedKey(s), 'device.smoke', 'one active key at a time');
    si.disarmPlacement(s);
    assert.strictEqual(si.isArmed(s), false);
    assert.strictEqual(si.armedKey(s), null);
  });

  test('arming an empty or non-string key leaves the mode disarmed', () => {
    const s = si.createSymbolState();
    for (const bad of ['', '   ', null, undefined, 7]) {
      si.armPlacement(s, bad);
      assert.strictEqual(si.isArmed(s), false, JSON.stringify(bad));
    }
  });

  test('a placement tap maps through the viewport to a clamped normalized anchor', () => {
    const s = si.createSymbolState();
    si.armPlacement(s, 'outlet.duplex');
    const n = si.placementAt(s, at(1000, 750), ID, STAGE);
    assert.ok(Math.abs(n.x - 0.5) < 1e-9 && Math.abs(n.y - 0.5) < 1e-9);
    const edge = si.placementAt(s, at(-50, 4000), ID, STAGE);
    assert.ok(edge.x >= 0 && edge.x <= 1 && edge.y >= 0 && edge.y <= 1, 'clamped');
  });

  test('placementAt returns null when disarmed — an unarmed tap places nothing', () => {
    const s = si.createSymbolState();
    assert.strictEqual(si.placementAt(s, at(100, 100), ID, STAGE), null);
  });
});

describe('WM-9A symbol drag', () => {
  const press = (s, screen, anchor) =>
    si.symbolPointerDown(s, 'sym1', screen, anchor, ID, STAGE);

  test('below the 8px threshold a press stays a tap', () => {
    const s = si.createSymbolState();
    press(s, at(1000, 750), at(0.5, 0.5));
    const r = si.symbolPointerMove(s, at(1005, 753), ID, STAGE);
    assert.deepStrictEqual(r, { moved: false, normalized: null });
    const up = si.symbolPointerUp(s);
    assert.strictEqual(up.action, 'tap');
    assert.deepStrictEqual(up.normalized, { x: 0.5, y: 0.5 });
  });

  test('past the threshold the drag commits and tracks with NO jump', () => {
    const s = si.createSymbolState();
    // grab 6px right of the anchor — off-center on purpose
    press(s, at(1006, 750), at(0.5, 0.5));
    // commit the drag: pointer 20px right of the press
    const r1 = si.symbolPointerMove(s, at(1026, 750), ID, STAGE);
    assert.strictEqual(r1.moved, true);
    // grab offset was re-taken at commit against the ORIGINAL anchor, so the
    // symbol has not snapped: pointer(1026) − anchorStage(1000) = 26 offset
    assert.ok(Math.abs(r1.normalized.x - 0.5) < 1e-9,
      'no jump: the anchor is still where it was at the commit instant');
    // from here on the offset is preserved exactly
    const r2 = si.symbolPointerMove(s, at(1126, 750), ID, STAGE);
    assert.ok(Math.abs(r2.normalized.x - (0.5 + 100 / STAGE.width)) < 1e-9,
      '100px of pointer travel is 100 stage px of anchor travel at 1×');
    assert.ok(Math.abs(r2.normalized.y - 0.5) < 1e-9);
  });

  test('drag arithmetic respects the viewport scale', () => {
    const s = si.createSymbolState();
    const zoomed = { scale: 4, translateX: 0, translateY: 0 };
    si.symbolPointerDown(s, 'sym1', at(4000, 3000), at(0.5, 0.5), zoomed, STAGE);
    si.symbolPointerMove(s, at(4040, 3000), zoomed, STAGE);       // commit
    const r = si.symbolPointerMove(s, at(4440, 3000), zoomed, STAGE);
    // 400 screen px at 4× is 100 stage px
    assert.ok(Math.abs(r.normalized.x - (0.5 + 100 / STAGE.width)) < 1e-9);
  });

  test('the result is always clamped inside the sheet', () => {
    const s = si.createSymbolState();
    press(s, at(20, 20), at(0.01, 0.01));
    si.symbolPointerMove(s, at(0, 0), ID, STAGE);
    const r = si.symbolPointerMove(s, at(-500, -500), ID, STAGE);
    assert.ok(r.normalized.x >= 0 && r.normalized.y >= 0, 'clamped, never negative');
    assert.ok(Number.isFinite(r.normalized.x) && Number.isFinite(r.normalized.y), 'no NaN');
  });

  test('release after a drag reports ONE move with the final anchor', () => {
    const s = si.createSymbolState();
    press(s, at(1000, 750), at(0.5, 0.5));
    si.symbolPointerMove(s, at(1050, 750), ID, STAGE);   // commit (no jump)
    si.symbolPointerMove(s, at(1110, 750), ID, STAGE);   // 60px of real travel
    const up = si.symbolPointerUp(s);
    assert.strictEqual(up.action, 'move');
    assert.strictEqual(up.id, 'sym1');
    assert.ok(Math.abs(up.normalized.x - (0.5 + 60 / STAGE.width)) < 1e-9);
    assert.strictEqual(si.hasPressedSymbol(s), false, 'state cleared for the next gesture');
  });

  test('pointercancel restores the ORIGINAL stored anchor', () => {
    const s = si.createSymbolState();
    press(s, at(1000, 750), at(0.5, 0.5));
    si.symbolPointerMove(s, at(1200, 900), ID, STAGE);
    const c = si.symbolPointerCancel(s);
    assert.strictEqual(c.action, 'revert');
    assert.deepStrictEqual(c.normalized, { x: 0.5, y: 0.5 });
    assert.strictEqual(si.hasPressedSymbol(s), false);
  });

  test('degenerate input never produces NaN or a phantom drag', () => {
    const s = si.createSymbolState();
    si.symbolPointerDown(s, 'sym1', { x: NaN, y: 0 }, at(0.5, 0.5), ID, STAGE);
    assert.strictEqual(si.hasPressedSymbol(s), false);
    press(s, at(1000, 750), at(0.5, 0.5));
    const r = si.symbolPointerMove(s, { x: Infinity, y: 0 }, ID, STAGE);
    assert.strictEqual(r.moved, false);
  });
});

describe('WM-9A symbol selection', () => {
  test('select and clear', () => {
    const s = si.createSymbolState();
    si.select(s, 'sym9');
    assert.strictEqual(si.getSelected(s), 'sym9');
    si.select(s, null);
    assert.strictEqual(si.getSelected(s), null);
  });
});
