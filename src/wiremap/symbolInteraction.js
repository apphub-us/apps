'use strict';
/**
 * Wire Map — symbol interaction state (WM-9A).
 *
 * Pure. No DOM, no IndexedDB, no rendering. The controller feeds it pointer
 * positions and the current viewport; it decides which symbolKey (if any) the
 * next empty tap places, whether a press on a symbol is a tap or a drag,
 * where a dragged symbol's anchor lands, and which symbol is selected.
 *
 * iOS compatibility-event suppression is NOT re-implemented here: the
 * controller already runs every pointer event through the one shared
 * suppression in labelInteraction before any module sees it. One suppression
 * system, exactly as WM-4 settled it.
 */

const geometry = require('./geometry');
const viewportMath = require('./viewport');

/** Movement before a press on a symbol becomes a drag rather than a tap. */
const SYMBOL_DRAG_THRESHOLD_PX = 8;

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

function createSymbolState() {
  return {
    /** The symbolKey armed for placement, or null. Exactly one at a time. */
    armedKey: null,
    /** Selected symbol annotation id, or null. */
    selectedId: null,
    /** Active symbol drag, if any. */
    drag: null,
  };
}

// ── Placement mode ────────────────────────────────────────────────────────

/**
 * Arm exactly one symbolKey. Arming a second key replaces the first — the
 * two can never be armed together.
 */
function armPlacement(state, symbolKey) {
  const key = typeof symbolKey === 'string' ? symbolKey.trim() : '';
  state.armedKey = key.length > 0 ? key : null;
  return state;
}

function disarmPlacement(state) {
  state.armedKey = null;
  return state;
}

function isArmed(state) {
  return state.armedKey !== null;
}

function armedKey(state) {
  return state.armedKey;
}

/**
 * Screen point → normalized sheet anchor for a placement tap.
 * Goes through the same viewport/geometry helpers as every other annotation,
 * so placement can never disagree with rendering. Clamped to the sheet.
 */
function placementAt(state, screenPoint, viewport, stageSize) {
  if (!isArmed(state) || !isPoint(screenPoint) || !viewport || !stageSize) return null;
  const stagePoint = viewportMath.screenToStage(screenPoint, viewport);
  if (!stagePoint) return null;
  const normalized = geometry.normalizePoint(stagePoint, stageSize);
  return normalized ? geometry.clampNormalized(normalized) : null;
}

// ── Selection ─────────────────────────────────────────────────────────────

function select(state, id) {
  state.selectedId = id || null;
  return state;
}

function getSelected(state) {
  return state.selectedId;
}

// ── Symbol drag ───────────────────────────────────────────────────────────

/**
 * A pointer went down on a symbol. Nothing moves yet: a press under the
 * threshold is a tap, which selects.
 *
 * The grab offset (pointerStage − anchorStage) is captured so the point the
 * user grabbed stays under the finger for the whole drag.
 */
function symbolPointerDown(state, annotationId, screenPoint, anchorNormalized, viewport, stageSize) {
  if (!annotationId || !isPoint(screenPoint) || !anchorNormalized
    || !viewport || !stageSize) return state;
  const pointerStage = viewportMath.screenToStage(screenPoint, viewport);
  const anchorStage = geometry.denormalizePoint(anchorNormalized, stageSize);
  if (!pointerStage || !anchorStage) return state;
  state.drag = {
    id: annotationId,
    startScreen: { x: screenPoint.x, y: screenPoint.y },
    original: { x: anchorNormalized.x, y: anchorNormalized.y },
    current: { x: anchorNormalized.x, y: anchorNormalized.y },
    grabOffset: { x: pointerStage.x - anchorStage.x, y: pointerStage.y - anchorStage.y },
    moved: false,
  };
  return state;
}

/**
 * A pointer moved while pressing a symbol.
 *
 * Below the threshold nothing happens (the press may still be a tap). At the
 * moment the drag commits, the grab offset is re-taken against the CURRENT
 * pointer so the symbol does not snap by the threshold distance — from that
 * moment on, newAnchor = pointerStage − grabOffset exactly, clamped to the
 * sheet.
 *
 * @returns {{moved:boolean, normalized:object|null}}
 */
function symbolPointerMove(state, screenPoint, viewport, stageSize) {
  const d = state.drag;
  if (!d || !isPoint(screenPoint) || !viewport || !stageSize) {
    return { moved: false, normalized: null };
  }
  if (!d.moved && distance(d.startScreen, screenPoint) < SYMBOL_DRAG_THRESHOLD_PX) {
    return { moved: false, normalized: null };
  }
  const pointerStage = viewportMath.screenToStage(screenPoint, viewport);
  if (!pointerStage) return { moved: false, normalized: null };
  if (!d.moved) {
    d.moved = true;
    const anchorStage = geometry.denormalizePoint(d.current, stageSize);
    d.grabOffset = { x: pointerStage.x - anchorStage.x, y: pointerStage.y - anchorStage.y };
  }
  const next = geometry.clampNormalized(geometry.normalizePoint({
    x: pointerStage.x - d.grabOffset.x,
    y: pointerStage.y - d.grabOffset.y,
  }, stageSize));
  if (!next || !isFiniteNumber(next.x) || !isFiniteNumber(next.y)) {
    return { moved: false, normalized: null };
  }
  d.current = next;
  return { moved: true, normalized: next };
}

/**
 * The pointer was released.
 * A drag that moved should be persisted ONCE; a press that did not is a tap.
 * @returns {{action:'move'|'tap'|'none', id:string|null, normalized:object|null}}
 */
function symbolPointerUp(state) {
  const d = state.drag;
  state.drag = null;
  if (!d) return { action: 'none', id: null, normalized: null };
  if (!d.moved) return { action: 'tap', id: d.id, normalized: d.original };
  return { action: 'move', id: d.id, normalized: d.current };
}

/**
 * The gesture was cancelled. The symbol returns to where it was stored —
 * a half-moved symbol must never be left behind, and nothing is written.
 */
function symbolPointerCancel(state) {
  const d = state.drag;
  state.drag = null;
  if (!d) return { action: 'none', id: null, normalized: null };
  return { action: 'revert', id: d.id, normalized: d.original };
}

function hasPressedSymbol(state) {
  return !!state.drag;
}

function isDraggingSymbol(state) {
  return !!(state.drag && state.drag.moved);
}

module.exports = {
  SYMBOL_DRAG_THRESHOLD_PX,
  createSymbolState,
  armPlacement,
  disarmPlacement,
  isArmed,
  armedKey,
  placementAt,
  select,
  getSelected,
  symbolPointerDown,
  symbolPointerMove,
  symbolPointerUp,
  symbolPointerCancel,
  hasPressedSymbol,
  isDraggingSymbol,
};
