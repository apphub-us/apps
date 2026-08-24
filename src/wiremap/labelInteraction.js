'use strict';
/**
 * Wire Map — label interaction state.
 *
 * Pure. No DOM, no IndexedDB, no rendering. The controller feeds it pointer
 * positions and the current viewport; it decides whether a touch is a tap or a
 * drag, where a label should land in normalized sheet coordinates, and whether
 * an input event is a duplicate synthesised by iOS.
 *
 * Kept separate from interaction.js on purpose: that module owns the viewport
 * gesture, this one owns the annotation gesture, and the controller decides
 * which is in charge. Merging them would make the "is the plan moving or is the
 * label moving?" question implicit rather than explicit.
 */

const geometry = require('./geometry');
const viewportMath = require('./viewport');

/** Movement before a press on a label becomes a drag rather than a tap. */
const LABEL_DRAG_THRESHOLD_PX = 8;

/**
 * How long a synthesised mouse event may follow a touch and still be treated
 * as the same physical gesture.
 *
 * WM-4 was defeated by this: one finger on iOS produces a touch pointer pair
 * and then, roughly 300 ms later, a compatibility mouse pair at the same
 * coordinates. 700 ms leaves margin without swallowing a deliberate second tap
 * from a real mouse.
 */
const COMPAT_SUPPRESS_MS = 700;
const COMPAT_SUPPRESS_PX = 30;

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

function createLabelState() {
  return {
    /** 'idle' | 'armed' — armed means the next plan tap places a label. */
    placementMode: 'idle',
    /** Active label drag, if any. */
    drag: null,
    /** Last touch-originated input, for compatibility-event suppression. */
    lastTouch: null,
  };
}

// ── Placement mode ────────────────────────────────────────────────────────

function armPlacement(state) {
  state.placementMode = 'armed';
  return state;
}

function disarmPlacement(state) {
  state.placementMode = 'idle';
  return state;
}

function isArmed(state) {
  return state.placementMode === 'armed';
}

// ── iOS compatibility-event suppression ───────────────────────────────────

/**
 * Record a touch-originated event so the mouse pair WebKit synthesises after
 * it can be recognised and ignored.
 */
function noteInput(state, pointerType, point, now) {
  if (pointerType === 'touch' || pointerType === 'pen') {
    state.lastTouch = { x: point.x, y: point.y, time: now };
  }
  return state;
}

/**
 * Whether this event is a synthesised duplicate of a touch that just happened.
 *
 * Only mouse events are ever suppressed, so a desktop mouse still works: on
 * desktop there is no preceding touch, so `lastTouch` stays null.
 */
function isCompatibilityDuplicate(state, pointerType, point, now) {
  if (pointerType !== 'mouse') return false;
  const last = state.lastTouch;
  if (!last || !isPoint(point) || !isFiniteNumber(now)) return false;
  return (now - last.time) <= COMPAT_SUPPRESS_MS
    && distance(last, point) <= COMPAT_SUPPRESS_PX;
}

// ── Placement geometry ────────────────────────────────────────────────────

/**
 * Screen point -> normalized sheet coordinate.
 *
 * Goes through the existing viewport and geometry helpers, so placement can
 * never disagree with rendering. Clamped, because a tap can land just off the
 * plan and the label should sit on the edge rather than be rejected.
 */
function screenToNormalized(screenPoint, viewport, stageSize) {
  if (!isPoint(screenPoint) || !stageSize) return null;
  const stagePoint = viewportMath.screenToStage(screenPoint, viewport);
  if (!stagePoint) return null;
  return geometry.normalizePoint(stagePoint, stageSize);
}

/** Normalized sheet coordinate -> screen point. The exact inverse. */
function normalizedToScreen(normalized, viewport, stageSize) {
  if (!normalized || !stageSize) return null;
  const stagePoint = geometry.denormalizePoint(normalized, stageSize);
  if (!stagePoint) return null;
  return viewportMath.stageToScreen(stagePoint, viewport);
}

// ── Label drag ────────────────────────────────────────────────────────────

/**
 * A pointer went down on a label. Nothing moves yet: a press under the
 * threshold is a tap, which opens the editor.
 */
function labelPointerDown(state, annotationId, screenPoint, originalNormalized) {
  if (!annotationId || !isPoint(screenPoint) || !originalNormalized) return state;
  state.drag = {
    id: annotationId,
    startScreen: { x: screenPoint.x, y: screenPoint.y },
    original: { x: originalNormalized.x, y: originalNormalized.y },
    current: { x: originalNormalized.x, y: originalNormalized.y },
    moved: false,
  };
  return state;
}

/**
 * A pointer moved while pressing a label.
 *
 * The screen delta is converted through the CURRENT viewport, so a drag tracks
 * the finger identically at every zoom level. Position is clamped to the sheet.
 *
 * @returns {{moved:boolean, normalized:object|null}}
 */
function labelPointerMove(state, screenPoint, viewport, stageSize) {
  const d = state.drag;
  if (!d || !isPoint(screenPoint) || !stageSize || !viewport) {
    return { moved: false, normalized: null };
  }
  if (!d.moved && distance(d.startScreen, screenPoint) < LABEL_DRAG_THRESHOLD_PX) {
    return { moved: false, normalized: null };
  }
  if (!d.moved) {
    // Re-anchor at the moment the drag commits, so the label does not jump by
    // the threshold distance on the first committed move.
    d.moved = true;
    d.startScreen = { x: screenPoint.x, y: screenPoint.y };
    d.anchorAtCommit = { x: d.current.x, y: d.current.y };
  }
  const scale = viewport.scale > 0 ? viewport.scale : 1;
  const base = d.anchorAtCommit || d.original;
  const stageDx = (screenPoint.x - d.startScreen.x) / scale;
  const stageDy = (screenPoint.y - d.startScreen.y) / scale;
  const next = geometry.clampNormalized({
    x: base.x + stageDx / stageSize.width,
    y: base.y + stageDy / stageSize.height,
  });
  d.current = next;
  return { moved: true, normalized: next };
}

/**
 * The pointer was released.
 * A drag that moved should be persisted; a press that did not is a tap.
 * @returns {{action:'move'|'tap'|'none', id:string|null, normalized:object|null}}
 */
function labelPointerUp(state) {
  const d = state.drag;
  state.drag = null;
  if (!d) return { action: 'none', id: null, normalized: null };
  if (!d.moved) return { action: 'tap', id: d.id, normalized: d.original };
  return { action: 'move', id: d.id, normalized: d.current };
}

/**
 * The gesture was cancelled. The label returns to where it was stored; a
 * half-moved label must never be left behind, saved or not.
 */
function labelPointerCancel(state) {
  const d = state.drag;
  state.drag = null;
  if (!d) return { action: 'none', id: null, normalized: null };
  return { action: 'revert', id: d.id, normalized: d.original };
}

function isDraggingLabel(state) {
  return !!(state.drag && state.drag.moved);
}

function hasPressedLabel(state) {
  return !!state.drag;
}

/**
 * Inverse scale for a label group.
 *
 * The anchor lives in stage coordinates and rides the single stage transform,
 * but the label body must stay legible and tappable at every zoom. Dividing by
 * the stage scale keeps its rendered size constant. This is a LOCAL transform
 * inside the stage — it is not a second viewport transform.
 */
function labelCounterScale(viewportScale) {
  if (!isFiniteNumber(viewportScale) || viewportScale <= 0) return 1;
  return 1 / viewportScale;
}

module.exports = {
  LABEL_DRAG_THRESHOLD_PX,
  COMPAT_SUPPRESS_MS,
  COMPAT_SUPPRESS_PX,
  createLabelState,
  armPlacement,
  disarmPlacement,
  isArmed,
  noteInput,
  isCompatibilityDuplicate,
  screenToNormalized,
  normalizedToScreen,
  labelPointerDown,
  labelPointerMove,
  labelPointerUp,
  labelPointerCancel,
  isDraggingLabel,
  hasPressedLabel,
  labelCounterScale,
  distance,
};
