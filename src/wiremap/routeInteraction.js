'use strict';
/**
 * Wire Map — arrow (route) interaction state.
 *
 * Pure. No DOM, no IndexedDB, no rendering.
 *
 * The model already carries `arrow` as a two-point annotation with normalized
 * endpoints `a` and `b`, so nothing here invents a second schema. This module
 * only decides when a drag becomes an arrow, where its endpoints land, and
 * which endpoint a drag is moving.
 *
 * iOS compatibility-event suppression is NOT reimplemented here: WM-5 already
 * solved that in labelInteraction, and the controller shares one input state
 * for the whole page. Two suppression clocks would drift apart.
 */

const geometry = require('./geometry');
const viewportMath = require('./viewport');

/**
 * How far a finger must travel before a drag becomes an arrow.
 *
 * Larger than the label threshold on purpose: an arrow of a few pixels is
 * never intentional, and a stray tap while Arrow mode is armed should leave
 * nothing behind rather than litter the plan with specks.
 */
const ARROW_MIN_DRAW_PX = 16;

/** Endpoint drag commits at the ordinary threshold. */
const ENDPOINT_DRAG_THRESHOLD_PX = 8;

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

function createRouteState() {
  return {
    /** 'idle' | 'armed' — armed means the next plan drag draws an arrow. */
    drawMode: 'idle',
    /** In-flight draw: { startScreen, startNormalized, endNormalized, exceeded }. */
    draft: null,
    /** In-flight endpoint drag: { id, which, original, current, moved }. */
    endpointDrag: null,
    /** Currently selected arrow id, for showing handles. */
    selectedId: null,
  };
}

// ── Draw mode ─────────────────────────────────────────────────────────────

function armDraw(state) { state.drawMode = 'armed'; return state; }
function disarmDraw(state) { state.drawMode = 'idle'; state.draft = null; return state; }
function isArmed(state) { return state.drawMode === 'armed'; }

// ── Coordinate conversion — shared helpers only, never a second formula ───

function screenToNormalized(screenPoint, viewport, stageSize) {
  if (!isPoint(screenPoint) || !stageSize) return null;
  const stagePoint = viewportMath.screenToStage(screenPoint, viewport);
  if (!stagePoint) return null;
  return geometry.normalizePoint(stagePoint, stageSize);
}

function normalizedToScreen(normalized, viewport, stageSize) {
  if (!normalized || !stageSize) return null;
  const stagePoint = geometry.denormalizePoint(normalized, stageSize);
  if (!stagePoint) return null;
  return viewportMath.stageToScreen(stagePoint, viewport);
}

// ── Drawing an arrow ──────────────────────────────────────────────────────

/** Begin a draft at the press point. Nothing is created yet. */
function drawStart(state, screenPoint, viewport, stageSize) {
  if (!isArmed(state)) return { started: false };
  const normalized = screenToNormalized(screenPoint, viewport, stageSize);
  if (!normalized) return { started: false };
  state.draft = {
    startScreen: { x: screenPoint.x, y: screenPoint.y },
    startNormalized: normalized,
    endNormalized: normalized,
    exceeded: false,
  };
  return { started: true, start: normalized };
}

/**
 * Extend the draft. The preview follows the finger from the first move; only
 * `exceeded` decides whether it will survive the release.
 */
function drawMove(state, screenPoint, viewport, stageSize) {
  const d = state.draft;
  if (!d || !isPoint(screenPoint)) return { drawing: false, start: null, end: null };
  const normalized = screenToNormalized(screenPoint, viewport, stageSize);
  if (!normalized) return { drawing: false, start: null, end: null };
  d.endNormalized = normalized;
  if (distance(d.startScreen, screenPoint) >= ARROW_MIN_DRAW_PX) d.exceeded = true;
  return { drawing: true, start: d.startNormalized, end: normalized, exceeded: d.exceeded };
}

/**
 * Release.
 * A drag that never travelled far enough commits nothing — a tap in Arrow mode
 * must not leave a zero-length arrow on the plan.
 */
function drawEnd(state) {
  const d = state.draft;
  state.draft = null;
  if (!d) return { action: 'none', start: null, end: null };
  if (!d.exceeded) return { action: 'discarded', start: null, end: null };
  return { action: 'commit', start: d.startNormalized, end: d.endNormalized };
}

function drawCancel(state) {
  const had = !!state.draft;
  state.draft = null;
  return { action: had ? 'cancelled' : 'none' };
}

function isDrawing(state) { return !!state.draft; }

// ── Endpoint dragging ─────────────────────────────────────────────────────

/**
 * A pointer went down on an endpoint handle.
 * @param {'a'|'b'} which
 */
function endpointDown(state, annotationId, which, screenPoint, originalNormalized) {
  if (!annotationId || (which !== 'a' && which !== 'b')) return state;
  if (!isPoint(screenPoint) || !originalNormalized) return state;
  state.endpointDrag = {
    id: annotationId,
    which,
    startScreen: { x: screenPoint.x, y: screenPoint.y },
    original: { x: originalNormalized.x, y: originalNormalized.y },
    current: { x: originalNormalized.x, y: originalNormalized.y },
    moved: false,
  };
  return state;
}

/**
 * Move the endpoint under the finger.
 *
 * Uses the absolute pointer position rather than an accumulated delta: an
 * endpoint should sit exactly where the finger is, which is also what makes it
 * behave identically at every zoom.
 */
function endpointMove(state, screenPoint, viewport, stageSize) {
  const d = state.endpointDrag;
  if (!d || !isPoint(screenPoint) || !stageSize) return { moved: false, normalized: null };
  if (!d.moved && distance(d.startScreen, screenPoint) < ENDPOINT_DRAG_THRESHOLD_PX) {
    return { moved: false, normalized: null };
  }
  d.moved = true;
  const normalized = screenToNormalized(screenPoint, viewport, stageSize);
  if (!normalized) return { moved: false, normalized: null };
  d.current = normalized;
  return { moved: true, which: d.which, normalized };
}

/** @returns {{action:'move'|'tap'|'none', id, which, normalized}} */
function endpointUp(state) {
  const d = state.endpointDrag;
  state.endpointDrag = null;
  if (!d) return { action: 'none', id: null, which: null, normalized: null };
  if (!d.moved) return { action: 'tap', id: d.id, which: d.which, normalized: d.original };
  return { action: 'move', id: d.id, which: d.which, normalized: d.current };
}

/** Cancel restores the stored endpoint: never leave a half-moved arrow. */
function endpointCancel(state) {
  const d = state.endpointDrag;
  state.endpointDrag = null;
  if (!d) return { action: 'none', id: null, which: null, normalized: null };
  return { action: 'revert', id: d.id, which: d.which, normalized: d.original };
}

function isDraggingEndpoint(state) {
  return !!(state.endpointDrag && state.endpointDrag.moved);
}

function hasPressedEndpoint(state) {
  return !!state.endpointDrag;
}

// ── Selection ─────────────────────────────────────────────────────────────

function select(state, id) { state.selectedId = id || null; return state; }
function clearSelection(state) { state.selectedId = null; return state; }
function getSelected(state) { return state.selectedId; }

/**
 * Apply an endpoint change to an annotation without mutating the original.
 * The caller persists the result; nothing here touches storage.
 */
function withEndpoint(annotation, which, normalized) {
  if (!annotation || (which !== 'a' && which !== 'b') || !normalized) return annotation;
  const next = { ...annotation };
  next[which] = geometry.clampNormalized(normalized);
  return next;
}

module.exports = {
  ARROW_MIN_DRAW_PX,
  ENDPOINT_DRAG_THRESHOLD_PX,
  createRouteState,
  armDraw,
  disarmDraw,
  isArmed,
  screenToNormalized,
  normalizedToScreen,
  drawStart,
  drawMove,
  drawEnd,
  drawCancel,
  isDrawing,
  endpointDown,
  endpointMove,
  endpointUp,
  endpointCancel,
  isDraggingEndpoint,
  hasPressedEndpoint,
  select,
  clearSelection,
  getSelected,
  withEndpoint,
  distance,
};
