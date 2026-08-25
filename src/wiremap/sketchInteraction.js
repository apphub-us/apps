'use strict';
/**
 * Wire Map — sketch interaction state (WM-6B1).
 *
 * Pure. No DOM, no IndexedDB, no rendering.
 *
 * The model already carries `line` and `rect` as two-point annotations with
 * normalized endpoints `a` and `b`, so nothing here invents a schema. This
 * module owns which tool is armed, when a drag becomes a shape, and which
 * handle a drag is moving.
 *
 * iOS compatibility suppression is NOT reimplemented: labelInteraction owns it
 * and the controller shares one input state for the whole page. A second
 * suppression clock would drift from the first.
 */

const geometry = require('./geometry');
const viewportMath = require('./viewport');

/** Minimum travel before a drag becomes a line, in screen pixels. */
const LINE_MIN_DRAW_PX = 16;

/**
 * Minimum extent before a drag becomes a rectangle, in screen pixels.
 * Applied to BOTH sides: a sliver is as unlikely to be intended as a speck.
 */
const RECT_MIN_SIZE_PX = 16;

/** Movement before a handle press becomes a drag rather than a tap. */
const HANDLE_DRAG_THRESHOLD_PX = 8;

const TOOLS = ['none', 'line', 'rect', 'text'];

/** Single-line sketch text. Long enough for "Feed from 3F", short by design. */
const TEXT_MAX_LENGTH = 120;

/** Movement before a press on text becomes a drag rather than a tap. */
const TEXT_DRAG_THRESHOLD_PX = 8;

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

/**
 * Normalise text for storage: trimmed and length-capped.
 * Returns null when nothing meaningful remains, so callers cannot save blanks.
 */
function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, TEXT_MAX_LENGTH);
}

function isValidText(value) {
  return normalizeText(value) !== null;
}

function createSketchState() {
  return {
    /** 'none' | 'line' | 'rect' — only ever one. */
    tool: 'none',
    /** In-flight draw. */
    draft: null,
    /** In-flight handle drag. */
    handleDrag: null,
    /** Currently selected sketch shape id. */
    selectedId: null,
    /** In-flight text move. */
    textDrag: null,
  };
}

// ── Tool state ────────────────────────────────────────────────────────────

/**
 * Arm a tool. Arming one disarms the other by construction — a single field
 * cannot hold two tools, so "line and rect both active" is unrepresentable.
 */
function armTool(state, tool) {
  if (TOOLS.indexOf(tool) === -1) return state;
  state.tool = tool;
  state.draft = null;
  return state;
}

function disarmTool(state) {
  state.tool = 'none';
  state.draft = null;
  return state;
}

function activeTool(state) {
  return state.tool;
}

function isArmed(state) {
  return state.tool !== 'none';
}

// ── Coordinates — shared helpers only ─────────────────────────────────────

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

// ── Drawing ───────────────────────────────────────────────────────────────

/** Begin a draft for whichever tool is armed. Nothing is created yet. */
function drawStart(state, screenPoint, viewport, stageSize) {
  if (!isArmed(state)) return { started: false };
  const normalized = screenToNormalized(screenPoint, viewport, stageSize);
  if (!normalized) return { started: false };
  state.draft = {
    tool: state.tool,
    startScreen: { x: screenPoint.x, y: screenPoint.y },
    a: normalized,
    b: normalized,
    exceeded: false,
  };
  return { started: true, tool: state.tool, a: normalized };
}

/**
 * Extend the draft.
 *
 * The preview follows from the first move; `exceeded` alone decides whether it
 * survives release. A line needs enough travel; a rectangle needs enough of
 * BOTH width and height, so a sliver is discarded too.
 */
function drawMove(state, screenPoint, viewport, stageSize) {
  const d = state.draft;
  if (!d || !isPoint(screenPoint)) return { drawing: false };
  const normalized = screenToNormalized(screenPoint, viewport, stageSize);
  if (!normalized) return { drawing: false };
  d.b = normalized;

  if (d.tool === 'line') {
    if (distance(d.startScreen, screenPoint) >= LINE_MIN_DRAW_PX) d.exceeded = true;
  } else {
    const w = Math.abs(screenPoint.x - d.startScreen.x);
    const h = Math.abs(screenPoint.y - d.startScreen.y);
    if (w >= RECT_MIN_SIZE_PX && h >= RECT_MIN_SIZE_PX) d.exceeded = true;
  }
  return { drawing: true, tool: d.tool, a: d.a, b: d.b, exceeded: d.exceeded };
}

/**
 * Release.
 * A drag that never grew enough commits nothing — a tap with a tool armed must
 * not litter the sheet with zero-size shapes.
 */
function drawEnd(state) {
  const d = state.draft;
  state.draft = null;
  if (!d) return { action: 'none' };
  if (!d.exceeded) return { action: 'discarded', tool: d.tool };
  return { action: 'commit', tool: d.tool, a: d.a, b: d.b };
}

function drawCancel(state) {
  const had = !!state.draft;
  state.draft = null;
  return { action: had ? 'cancelled' : 'none' };
}

function isDrawing(state) {
  return !!state.draft;
}

// ── Handles ───────────────────────────────────────────────────────────────

/**
 * Corner names for a rectangle, resolved against the stored a/b pair.
 *
 * The store keeps the two corners the user actually dragged; rendering derives
 * min/max. Handles therefore address corners by POSITION (nw/ne/se/sw) and this
 * function maps each to the stored field and axis it controls.
 */
function rectCorners(annotation) {
  const { a, b } = annotation;
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return {
    nw: { x: left, y: top },
    ne: { x: right, y: top },
    se: { x: right, y: bottom },
    sw: { x: left, y: bottom },
  };
}

/** The corner diagonally opposite the named one. It must stay put. */
function oppositeCorner(annotation, corner) {
  const c = rectCorners(annotation);
  const map = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };
  return c[map[corner]] || null;
}

/**
 * A pointer went down on a handle.
 * @param {'a'|'b'|'nw'|'ne'|'se'|'sw'} which
 */
function handleDown(state, annotation, which, screenPoint) {
  if (!annotation || !which || !isPoint(screenPoint)) return state;
  const isRect = annotation.type === 'rect';
  const anchor = isRect ? oppositeCorner(annotation, which) : annotation[which];
  if (!anchor) return state;
  state.handleDrag = {
    id: annotation.id,
    type: annotation.type,
    which,
    anchor,                       // the fixed corner, for rectangles
    original: { a: { ...annotation.a }, b: { ...annotation.b } },
    current: { a: { ...annotation.a }, b: { ...annotation.b } },
    startScreen: { x: screenPoint.x, y: screenPoint.y },
    moved: false,
  };
  return state;
}

/**
 * Move the handle to the pointer.
 *
 * Absolute position, not an accumulated delta, so the handle sits exactly under
 * the finger and behaves identically at every zoom. For a rectangle the
 * opposite corner is pinned and the dragged corner is free to cross it.
 */
function handleMove(state, screenPoint, viewport, stageSize) {
  const d = state.handleDrag;
  if (!d || !isPoint(screenPoint) || !stageSize) return { moved: false, geometry: null };
  if (!d.moved && distance(d.startScreen, screenPoint) < HANDLE_DRAG_THRESHOLD_PX) {
    return { moved: false, geometry: null };
  }
  const normalized = screenToNormalized(screenPoint, viewport, stageSize);
  if (!normalized) return { moved: false, geometry: null };
  d.moved = true;

  if (d.type === 'rect') {
    // Crossing the anchor is allowed; rendering normalises min/max.
    d.current = { a: { ...d.anchor }, b: normalized };
  } else {
    d.current = { ...d.current, [d.which]: normalized };
  }
  return { moved: true, id: d.id, which: d.which, geometry: { a: d.current.a, b: d.current.b } };
}

/** @returns {{action:'move'|'tap'|'none', id, geometry}} */
function handleUp(state) {
  const d = state.handleDrag;
  state.handleDrag = null;
  if (!d) return { action: 'none', id: null, geometry: null };
  if (!d.moved) return { action: 'tap', id: d.id, geometry: d.original };
  return { action: 'move', id: d.id, which: d.which, geometry: d.current, before: d.original };
}

/** Cancel restores the stored geometry: never leave a half-moved shape. */
function handleCancel(state) {
  const d = state.handleDrag;
  state.handleDrag = null;
  if (!d) return { action: 'none', id: null, geometry: null };
  return { action: 'revert', id: d.id, geometry: d.original };
}

function isDraggingHandle(state) {
  return !!(state.handleDrag && state.handleDrag.moved);
}

function hasPressedHandle(state) {
  return !!state.handleDrag;
}

// ── Selection ─────────────────────────────────────────────────────────────

function select(state, id) { state.selectedId = id || null; return state; }
function clearSelection(state) { state.selectedId = null; return state; }
function getSelected(state) { return state.selectedId; }

/** Apply new geometry without mutating the original. */
function withGeometry(annotation, geo) {
  if (!annotation || !geo) return annotation;
  return {
    ...annotation,
    a: geometry.clampNormalized(geo.a),
    b: geometry.clampNormalized(geo.b),
  };
}

// ── Text ──────────────────────────────────────────────────────────────────

/**
 * Where an armed Text tool would place a new annotation.
 * Returns the normalized anchor, or null if the point is unusable.
 */
function textPlacementAt(state, screenPoint, viewport, stageSize) {
  if (activeTool(state) !== 'text') return null;
  return screenToNormalized(screenPoint, viewport, stageSize);
}

/**
 * A pointer went down on existing text.
 *
 * The grab offset between the pointer and the anchor is recorded in STAGE
 * units, so the text keeps the point the finger grabbed instead of snapping
 * its anchor under the finger.
 */
function textPointerDown(state, annotation, screenPoint, viewport, stageSize) {
  if (!annotation || !isPoint(screenPoint) || !stageSize || !viewport) return state;
  const pointerStage = viewportMath.screenToStage(screenPoint, viewport);
  const anchorStage = geometry.denormalizePoint(annotation.at, stageSize);
  if (!pointerStage || !anchorStage) return state;
  state.textDrag = {
    id: annotation.id,
    startScreen: { x: screenPoint.x, y: screenPoint.y },
    grabOffset: { x: pointerStage.x - anchorStage.x, y: pointerStage.y - anchorStage.y },
    original: { x: annotation.at.x, y: annotation.at.y },
    current: { x: annotation.at.x, y: annotation.at.y },
    moved: false,
  };
  return state;
}

/**
 * Move the text.
 * newAnchor = pointerStage - grabOffset, then normalized and clamped.
 */
function textPointerMove(state, screenPoint, viewport, stageSize) {
  const d = state.textDrag;
  if (!d || !isPoint(screenPoint) || !stageSize) return { moved: false, normalized: null };
  if (!d.moved && distance(d.startScreen, screenPoint) < TEXT_DRAG_THRESHOLD_PX) {
    return { moved: false, normalized: null };
  }
  const pointerStage = viewportMath.screenToStage(screenPoint, viewport);
  if (!pointerStage) return { moved: false, normalized: null };
  d.moved = true;
  const next = geometry.normalizePoint({
    x: pointerStage.x - d.grabOffset.x,
    y: pointerStage.y - d.grabOffset.y,
  }, stageSize);
  if (!next) return { moved: false, normalized: null };
  d.current = next;
  return { moved: true, id: d.id, normalized: next };
}

/** @returns {{action:'move'|'tap'|'none', id, normalized, before}} */
function textPointerUp(state) {
  const d = state.textDrag;
  state.textDrag = null;
  if (!d) return { action: 'none', id: null, normalized: null };
  if (!d.moved) return { action: 'tap', id: d.id, normalized: d.original };
  return { action: 'move', id: d.id, normalized: d.current, before: d.original };
}

/** Cancel restores the stored anchor. */
function textPointerCancel(state) {
  const d = state.textDrag;
  state.textDrag = null;
  if (!d) return { action: 'none', id: null, normalized: null };
  return { action: 'revert', id: d.id, normalized: d.original };
}

function isDraggingText(state) {
  return !!(state.textDrag && state.textDrag.moved);
}

function hasPressedText(state) {
  return !!state.textDrag;
}

/** Apply a new anchor without mutating the original. */
function withAnchor(annotation, normalized) {
  if (!annotation || !normalized) return annotation;
  return { ...annotation, at: geometry.clampNormalized(normalized) };
}

/**
 * Font size in stage units for the current zoom.
 * Explicit compensation, never vector-effect or a nested inverse transform —
 * both proved unreliable in physical iOS Safari under a transformed stage.
 */
function textFontForScale(screenPx, scale) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const px = Number.isFinite(screenPx) && screenPx > 0 ? screenPx : 16;
  return px / s;
}

/** Axis-aligned bounds for rendering a rectangle, in normalized units. */
function rectBounds(annotation) {
  return geometry.segmentBounds({ a: annotation.a, b: annotation.b });
}

module.exports = {
  LINE_MIN_DRAW_PX,
  RECT_MIN_SIZE_PX,
  HANDLE_DRAG_THRESHOLD_PX,
  TOOLS,
  TEXT_MAX_LENGTH,
  TEXT_DRAG_THRESHOLD_PX,
  normalizeText,
  isValidText,
  createSketchState,
  armTool,
  disarmTool,
  activeTool,
  isArmed,
  screenToNormalized,
  normalizedToScreen,
  drawStart,
  drawMove,
  drawEnd,
  drawCancel,
  isDrawing,
  rectCorners,
  oppositeCorner,
  handleDown,
  handleMove,
  handleUp,
  handleCancel,
  isDraggingHandle,
  hasPressedHandle,
  select,
  clearSelection,
  getSelected,
  withGeometry,
  withAnchor,
  textPlacementAt,
  textPointerDown,
  textPointerMove,
  textPointerUp,
  textPointerCancel,
  isDraggingText,
  hasPressedText,
  textFontForScale,
  rectBounds,
  distance,
};
