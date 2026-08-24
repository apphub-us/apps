'use strict';
/**
 * Wire Map — pointer gesture state.
 *
 * Pure. No DOM, no events, no storage, no image decoding. The controller feeds
 * it pointer positions and it returns the next viewport transform.
 *
 * Everything that can be got wrong in a gesture — the drag threshold, focal
 * stability under pinch, and the hand-off when one finger leaves a pinch — is
 * arithmetic, and arithmetic can be tested in Node. Only the plumbing needs a
 * browser.
 */

const viewportMath = require('./viewport');

/**
 * Movement before a press becomes a drag, in CSS pixels.
 *
 * Below this a tap is a tap. Without it every touch nudges the plan a few
 * pixels, which on site with gloves makes the plan feel like it is sliding
 * away from you.
 */
const DRAG_THRESHOLD_PX = 8;

/*
 * There is deliberately NO tap gesture here.
 *
 * A double-tap zoom was implemented and then removed after physical iPhone
 * testing. One physical tap on iOS produces a pointerdown/pointerup pair with
 * pointerType 'touch' and then, roughly 300 ms later, a synthesised
 * compatibility pair with pointerType 'mouse' at the same coordinates. Any
 * time-and-distance based double-tap detector counts that single tap as two
 * and zooms. Filtering by pointerType would paper over it while leaving the
 * same trap for the next tap-based gesture.
 *
 * WM-4 therefore manipulates the viewport with one-finger pan and two-finger
 * pinch only. A tap changes nothing.
 */

/** A pinch is only meaningful once the fingers are measurably apart. */
const MIN_PINCH_DISTANCE_PX = 12;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPoint(p) {
  return !!p && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Create gesture state.
 *
 * Pointers are tracked by pointerId in insertion order, so the surviving
 * pointer after a lift is unambiguous.
 */
function createGestureState() {
  return {
    /** Map-like: ordered list of { id, x, y }. */
    pointers: [],
    mode: 'idle',            // 'idle' | 'pending' | 'pan' | 'pinch'
    /** Where the press began, for the drag threshold. */
    startPoint: null,
    /** Anchor for incremental panning; reset on every mode change. */
    panFrom: null,
    panFromViewport: null,
    /** Pinch baseline. */
    pinchStartDistance: 0,
    pinchStartScale: 1,
  };
}

function findIndex(state, id) {
  for (let i = 0; i < state.pointers.length; i++) {
    if (state.pointers[i].id === id) return i;
  }
  return -1;
}

function activeCount(state) {
  return state.pointers.length;
}

/** Begin a pinch from the current two pointers. */
function beginPinch(state, viewport) {
  const [a, b] = state.pointers;
  state.mode = 'pinch';
  state.pinchStartDistance = Math.max(MIN_PINCH_DISTANCE_PX, distance(a, b));
  state.pinchStartScale = viewport.scale;
  state.panFrom = midpoint(a, b);
  state.panFromViewport = { ...viewport };
}

/** Begin (or re-anchor) a one-finger pan from a given screen point. */
function beginPan(state, point, viewport) {
  state.mode = 'pan';
  state.panFrom = { x: point.x, y: point.y };
  state.panFromViewport = { ...viewport };
}

/**
 * A pointer went down.
 * @returns {{state, viewport, changed:boolean}}
 */
function pointerDown(state, pointer, viewport) {
  if (!pointer || !isFiniteNumber(pointer.id) || !isPoint(pointer)) {
    return { state, viewport, changed: false };
  }
  const existing = findIndex(state, pointer.id);
  if (existing !== -1) state.pointers.splice(existing, 1);
  state.pointers.push({ id: pointer.id, x: pointer.x, y: pointer.y });

  if (activeCount(state) === 1) {
    // Not a drag yet — wait for the threshold so a tap stays a tap.
    state.mode = 'pending';
    state.startPoint = { x: pointer.x, y: pointer.y };
    state.panFrom = { x: pointer.x, y: pointer.y };
    state.panFromViewport = { ...viewport };
  } else if (activeCount(state) >= 2) {
    beginPinch(state, viewport);
  }
  return { state, viewport, changed: false };
}

/**
 * A pointer moved.
 * @returns {{state, viewport, changed:boolean}} viewport is the NEW transform
 */
function pointerMove(state, pointer, viewport, bounds) {
  if (!pointer || !isPoint(pointer)) return { state, viewport, changed: false };
  const idx = findIndex(state, pointer.id);
  if (idx === -1) return { state, viewport, changed: false };
  state.pointers[idx].x = pointer.x;
  state.pointers[idx].y = pointer.y;

  const clamp = (v) => (bounds && bounds.stageSize && bounds.viewSize
    ? viewportMath.clampTranslation(v, bounds.stageSize, bounds.viewSize)
    : v);

  if (state.mode === 'pending') {
    if (distance(state.startPoint, pointer) < DRAG_THRESHOLD_PX) {
      return { state, viewport, changed: false };
    }
    // Re-anchor at the moment the drag commits so the plan does not lurch by
    // the threshold distance on the first committed move.
    beginPan(state, pointer, viewport);
    return { state, viewport, changed: false };
  }

  if (state.mode === 'pan' && activeCount(state) === 1) {
    const p = state.pointers[0];
    const next = clamp({
      scale: state.panFromViewport.scale,
      translateX: state.panFromViewport.translateX + (p.x - state.panFrom.x),
      translateY: state.panFromViewport.translateY + (p.y - state.panFrom.y),
    });
    return { state, viewport: next, changed: true };
  }

  if (state.mode === 'pinch' && activeCount(state) >= 2) {
    const [a, b] = state.pointers;
    const dist = Math.max(MIN_PINCH_DISTANCE_PX, distance(a, b));
    const mid = midpoint(a, b);

    // Scale relative to the pinch baseline, clamped to what this sheet allows.
    const desired = state.pinchStartScale * (dist / state.pinchStartDistance);
    const hasBounds = !!(bounds && bounds.stageSize && bounds.viewSize);
    // The floor for THIS sheet, which on a large plan is below MIN_SCALE.
    const floor = hasBounds
      ? viewportMath.minScaleFor(bounds.stageSize, bounds.viewSize)
      : viewportMath.MIN_SCALE;
    const target = hasBounds
      ? viewportMath.clampScaleFor(desired, bounds.stageSize, bounds.viewSize)
      : viewportMath.clampScale(desired);

    // Zoom about the ORIGINAL midpoint against the ORIGINAL transform, then
    // translate by however far the midpoint has travelled. Doing it in this
    // order keeps the content under the fingers while still letting a moving
    // midpoint pan, which a naive per-frame zoom does not.
    // Pass the floor through: zoomAt would otherwise re-clamp to MIN_SCALE and
    // make pinching back out to fit impossible on a large plan.
    const zoomed = viewportMath.zoomAt(state.panFromViewport, state.panFrom, target, floor);
    const next = clamp({
      scale: zoomed.scale,
      translateX: zoomed.translateX + (mid.x - state.panFrom.x),
      translateY: zoomed.translateY + (mid.y - state.panFrom.y),
    });
    return { state, viewport: next, changed: true };
  }

  return { state, viewport, changed: false };
}

/**
 * A pointer went up or was cancelled.
 *
 * The hand-off matters: lifting one finger mid-pinch must continue as a pan
 * from wherever the surviving finger is, against the CURRENT transform. Anchor
 * it anywhere else and the plan jumps.
 */
function pointerUp(state, pointerId, viewport) {
  const idx = findIndex(state, pointerId);
  if (idx !== -1) state.pointers.splice(idx, 1);

  if (activeCount(state) === 0) {
    state.mode = 'idle';
    state.startPoint = null;
    state.panFrom = null;
    state.panFromViewport = null;
    state.pinchStartDistance = 0;
    return { state, viewport, changed: false };
  }

  if (activeCount(state) === 1) {
    beginPan(state, state.pointers[0], viewport);
    return { state, viewport, changed: false };
  }

  // Three fingers down to two: restart the pinch from the current pair.
  beginPinch(state, viewport);
  return { state, viewport, changed: false };
}

/** Drop every pointer. Used for pointercancel storms and lost capture. */
function cancelAll(state) {
  state.pointers = [];
  state.mode = 'idle';
  state.startPoint = null;
  state.panFrom = null;
  state.panFromViewport = null;
  state.pinchStartDistance = 0;
  return state;
}

/**
 * Keep the sheet point under the viewport centre after a viewport resize.
 *
 * A rotation must not dump the electrician back at the top-left corner. Stored
 * normalized coordinates are never touched — only the transform is recomputed.
 */
function reflowForViewportChange(viewport, stageSize, oldViewSize, newViewSize, wasAtFit) {
  if (!stageSize || !newViewSize) return viewport;
  if (wasAtFit) return viewportMath.fitToViewport(stageSize, newViewSize);

  const centre = { x: oldViewSize.width / 2, y: oldViewSize.height / 2 };
  const stagePoint = viewportMath.screenToStage(centre, viewport);
  if (!stagePoint) return viewportMath.fitToViewport(stageSize, newViewSize);

  const scale = viewportMath.clampScaleFor(viewport.scale, stageSize, newViewSize);
  return viewportMath.clampTranslation({
    scale,
    translateX: newViewSize.width / 2 - stagePoint.x * scale,
    translateY: newViewSize.height / 2 - stagePoint.y * scale,
  }, stageSize, newViewSize);
}

/** Whether a transform is at (or effectively at) fit for this viewport. */
function isAtFit(viewport, stageSize, viewSize, tolerance) {
  const fit = viewportMath.fitToViewport(stageSize, viewSize);
  const tol = isFiniteNumber(tolerance) ? tolerance : 0.01;
  return Math.abs(viewport.scale - fit.scale) / fit.scale <= tol;
}

module.exports = {
  DRAG_THRESHOLD_PX,
  MIN_PINCH_DISTANCE_PX,
  createGestureState,
  activeCount,
  distance,
  midpoint,
  pointerDown,
  pointerMove,
  pointerUp,
  cancelAll,
  reflowForViewportChange,
  isAtFit,
};
