'use strict';
/**
 * Wire Map — stage controller.
 *
 * The thin browser layer. It owns no arithmetic: gesture state comes from
 * interaction.js, transforms from viewport.js, image bytes from image.js and
 * persistence from store.js. Its whole job is DOM plumbing.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT
 * -----------------------------------------
 * The background <img> and the SVG overlay are children of one .stage element
 * and share exactly ONE transform. Transforming them separately would let the
 * plan and its future annotations drift apart under zoom — a defect that would
 * be invisible at fit scale and glaring at 8x.
 */

const viewportMath = require('./viewport');
const interaction = require('./interaction');
const labelInteraction = require('./labelInteraction');
const routeInteraction = require('./routeInteraction');
const sketchInteraction = require('./sketchInteraction');
const undoStack = require('./undoStack');
const geometry = require('./geometry');

function createStageController(options) {
  const opts = options || {};
  const doc = opts.document || (typeof document !== 'undefined' ? document : null);
  const win = opts.window || (typeof window !== 'undefined' ? window : null);
  if (!doc) throw new Error('createStageController needs a document');

  const el = {
    viewport: doc.getElementById(opts.viewportId || 'wm-viewport'),
    stage: doc.getElementById(opts.stageId || 'wm-stage'),
    image: doc.getElementById(opts.imageId || 'wm-background'),
    svg: doc.getElementById(opts.svgId || 'wm-overlay'),
    empty: doc.getElementById(opts.emptyId || 'wm-empty'),
    labels: doc.getElementById(opts.labelsId || 'wm-labels'),
    routes: doc.getElementById(opts.routesId || 'wm-routes'),
    sketch: doc.getElementById(opts.sketchId || 'wm-sketch'),
    selection: doc.getElementById(opts.selectionId || 'wm-selection'),
    background: doc.getElementById(opts.backgroundHitId || 'wm-background-hit'),
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Logical stage size, always the stored image's displayed dimensions. */
  let stageSize = null;
  let view = viewportMath.identity();
  let objectUrl = null;
  let gesture = interaction.createGestureState();
  let lastViewSize = null;
  /** wireLabel annotations currently on the sheet, keyed by id. */
  let annotations = new Map();
  let labelState = labelInteraction.createLabelState();
  let routeState = routeInteraction.createRouteState();
  let sketchState = sketchInteraction.createSketchState();
  let undo = undoStack.createUndoStack();
  let currentSheetId = null;
  /** Blank sheets draw a drafting grid; image sheets do not. */
  let showGrid = false;
  /** Whether the current press began on the explicit empty-plan surface. */
  let pressedBackground = false;
  /** Called by the controller; the page supplies the editor and persistence. */
  const hooks = {
    onPlaceRequested: opts.onPlaceRequested || null,   // (normalized) => void
    onEditRequested: opts.onEditRequested || null,     // (annotation) => void
    onMoved: opts.onMoved || null,                     // (annotation) => Promise
    onModeChange: opts.onModeChange || null,           // (armed) => void
    onArrowDrawn: opts.onArrowDrawn || null,           // ({start,end}) => void
    onArrowMoved: opts.onArrowMoved || null,           // (annotation) => void
    onArrowSelected: opts.onArrowSelected || null,     // (annotation|null) => void
    onArrowModeChange: opts.onArrowModeChange || null, // (armed) => void
    onSketchDrawn: opts.onSketchDrawn || null,       // ({tool,a,b}) => void
    onSketchChanged: opts.onSketchChanged || null,   // (annotation, before) => void
    onSketchSelected: opts.onSketchSelected || null, // (annotation|null) => void
    onTextPlace: opts.onTextPlace || null,           // (normalized) => void
    onTextEdit: opts.onTextEdit || null,             // (annotation) => void
    onTextMoved: opts.onTextMoved || null,           // (after, before) => void
    onSketchToolChange: opts.onSketchToolChange || null, // (tool) => void
  };

  function viewSize() {
    if (opts.measure) return opts.measure();
    const r = el.viewport.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  /** Write the single transform. Nothing else moves the stage. */
  function applyTransform() {
    if (!el.stage) return;
    el.stage.style.transformOrigin = '0 0';
    el.stage.style.transform =
      'translate(' + view.translateX + 'px,' + view.translateY + 'px) scale(' + view.scale + ')';
  }

  function bounds() {
    return { stageSize, viewSize: lastViewSize || viewSize() };
  }

  function setViewport(next) {
    if (!next || !Number.isFinite(next.scale)
      || !Number.isFinite(next.translateX) || !Number.isFinite(next.translateY)) return;
    view = next;
    applyTransform();
  }

  function fit() {
    if (!stageSize) return;
    lastViewSize = viewSize();
    setViewport(viewportMath.fitToViewport(stageSize, lastViewSize));
    rescaleLabels();
  }

  /**
   * The controller owns this state. The placeholder is visible exactly when no
   * image is on the stage; nothing else may toggle it, so the two can never
   * disagree.
   */
  function setPlaceholderVisible(visible) {
    if (el.empty) el.empty.hidden = !visible;
  }

  /**
   * Remove the displayed image and return the stage to its empty state.
   * Releases the object URL rather than leaving it dangling.
   */
  function clear() {
    releaseImage();
    if (el.image) {
      el.image.removeAttribute('src');
      el.image.hidden = true;
    }
    stageSize = null;
    view = viewportMath.identity();
    applyTransform();
    interaction.cancelAll(gesture);
    labelState = labelInteraction.createLabelState();
    routeState = routeInteraction.createRouteState();
    sketchState = sketchInteraction.createSketchState();
    undoStack.reset(undo);
    showGrid = false;
    currentSheetId = null;
    annotations = new Map();
    [el.labels, el.routes, el.selection, el.sketch].forEach(function (layer) {
      if (layer) { while (layer.firstChild) layer.removeChild(layer.firstChild); }
    });
    setPlaceholderVisible(true);
  }

  /** Free the URL backing the current background before replacing it. */
  function releaseImage() {
    if (objectUrl && win && win.URL && typeof win.URL.revokeObjectURL === 'function') {
      win.URL.revokeObjectURL(objectUrl);
    }
    objectUrl = null;
  }

  /**
   * Show a processed/stored image as the stage background.
   *
   * `width`/`height` come from the stored record, not from the element: they
   * are the dimensions the user actually sees, already corrected for EXIF
   * orientation upstream.
   */
  function showImage(blob, width, height) {
    if (!el.image || !el.svg || !el.stage) return Promise.resolve(false);
    if (!blob || !(width > 0) || !(height > 0)) return Promise.resolve(false);

    releaseImage();
    objectUrl = win.URL.createObjectURL(blob);

    stageSize = { width, height };

    // Stage, image and SVG all take the SAME logical dimensions, so a point at
    // stage coordinate (x, y) is the same point in every layer.
    el.stage.style.width = width + 'px';
    el.stage.style.height = height + 'px';
    el.image.width = width;
    el.image.height = height;
    el.image.style.width = width + 'px';
    el.image.style.height = height + 'px';
    el.svg.setAttribute('width', String(width));
    el.svg.setAttribute('height', String(height));
    el.svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    if (el.background) {
      el.background.setAttribute('width', String(width));
      el.background.setAttribute('height', String(height));
    }

    setPlaceholderVisible(false);
    el.image.hidden = false;

    return new Promise((resolve) => {
      el.image.onload = () => { fit(); resolve(true); };
      el.image.onerror = () => { fit(); resolve(false); };
      el.image.src = objectUrl;
    });
  }

  // ── Label rendering ─────────────────────────────────────────────────

  /**
   * Draw one wire label.
   *
   * The group is translated to the anchor in STAGE coordinates, so it rides the
   * single stage transform and stays glued to the plan. A local inverse scale
   * then keeps the body a constant size on screen. That local transform is not
   * a second viewport — the anchor is still governed by the stage.
   */
  function renderLabel(annotation) {
    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'wm-label');
    g.setAttribute('data-annotation-id', annotation.id);

    const anchor = geometry.denormalizePoint(annotation.at, stageSize);
    const inverse = labelInteraction.labelCounterScale(view.scale);
    g.setAttribute('transform',
      'translate(' + anchor.x + ',' + anchor.y + ') scale(' + inverse + ')');

    const text = String((annotation.data && annotation.data.label) || '');
    const width = Math.max(44, 12 + text.length * 8);

    // Body geometry in one place. The text position is DERIVED from it, so the
    // two cannot drift apart: the old code hard-coded y = -17 against a body
    // whose centre was -22, leaving every label about 4px low.
    const BODY_TOP = -34;
    const BODY_HEIGHT = 24;
    const BODY_CENTRE_Y = BODY_TOP + BODY_HEIGHT / 2;

    // A dot marks the exact stored point; the body sits above it.
    const dot = doc.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '4');
    dot.setAttribute('class', 'wm-label-anchor');

    const box = doc.createElementNS(SVG_NS, 'rect');
    box.setAttribute('x', String(-width / 2));
    box.setAttribute('y', String(BODY_TOP));
    box.setAttribute('width', String(width));
    box.setAttribute('height', String(BODY_HEIGHT));
    box.setAttribute('rx', '4');
    box.setAttribute('class', 'wm-label-box');

    const t = doc.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '0');
    t.setAttribute('y', String(BODY_CENTRE_Y));
    // Horizontal centring is text-anchor, which every engine gets right.
    // Vertical uses dy 0.35em from the body centre rather than
    // dominant-baseline: middle, which WebKit renders inconsistently — that
    // was the other half of the iPhone offset.
    t.setAttribute('dy', '0.35em');
    t.setAttribute('class', 'wm-label-text');
    t.textContent = text;

    g.appendChild(dot);
    g.appendChild(box);
    g.appendChild(t);
    return g;
  }

  /**
   * Draw one arrow.
   *
   * Endpoints live in stage coordinates and ride the single stage transform,
   * so they stay glued to the plan. `vector-effect: non-scaling-stroke` keeps
   * the line a constant weight on screen without a second transform — the
   * SVG-native answer to the same problem the labels solve with inverse scale.
   *
   * A wide transparent stroke sits under the visible one so a thin arrow is
   * still practical to hit with a finger.
   */
  /**
   * Arrowhead outline, in screen pixels, pointing along +x with its tip at the
   * origin so translate+rotate places it exactly on endpoint B.
   */
  /** Arrowhead size in SCREEN pixels, converted to stage units at render time. */
  const HEAD_LENGTH_PX = 13;
  const HEAD_WIDTH_PX = 11;
  const HEAD_NOTCH = 0.25;

  /**
   * Visible arrow line width in SCREEN pixels.
   *
   * Applied as an explicit stage-unit stroke-width, NOT via
   * vector-effect: non-scaling-stroke. Blink honours that property under a
   * CSS-transformed parent; physical iOS Safari does not, and the line grew to
   * tens of pixels at high zoom. Dividing by the stage scale is engine
   * independent — the same principle already proven for the arrowhead and the
   * hit stroke.
   */
  const VISIBLE_ARROW_STROKE_PX = 1.5;

  /**
   * How far short of endpoint B the VISIBLE shaft stops, in screen pixels.
   *
   * The shaft used to run to B with a round linecap, which paints a semicircle
   * half a stroke-width PAST the endpoint — a small yellow blob beyond the
   * arrow tip. Stopping short buries the cap inside the head's fill instead.
   * B itself is untouched: it remains the logical tip, the hit segment and the
   * handle anchor.
   */
  const SHAFT_NECK_OFFSET_PX = 4;

  /**
   * Selected arrows draw a heavier shaft. An explicit screen-pixel target
   * rather than a multiplier: both weights are then stated outright and a
   * change to one cannot silently move the other.
   */
  const SELECTED_ARROW_STROKE_PX = 2.5;

  /**
   * Sketch stroke targets in SCREEN pixels, applied the same way as the arrow:
   * divided by the stage scale, never via vector-effect. WM-6A proved that
   * property unreliable in physical iOS Safari under a transformed stage.
   */
  const SKETCH_STROKE_PX = 1.25;
  const SKETCH_SELECTED_STROKE_PX = 2.0;
  const SKETCH_HIT_PX = 40;

  /**
   * Sketch text size in SCREEN pixels, converted to stage units at render time.
   * Same explicit compensation as every other screen-space target here.
   */
  const TEXT_FONT_PX = 16;
  const TEXT_PAD_PX = 6;
  /** Minimum touch height for text, in screen pixels. */
  const TEXT_HIT_MIN_PX = 44;
  /**
   * Padding around the GLYPHS for the visible selection outline, in screen px.
   * Separate from the touch target: the outline is decoration and must hug the
   * text, while the hit rect stays finger-sized.
   */
  const TEXT_OUTLINE_PAD_X_PX = 6;
  const TEXT_OUTLINE_PAD_Y_PX = 4;

  /** Drafting grid for blank sheets. Visual only; never stored. */
  const GRID_MINOR = 50;      // stage units
  const GRID_MAJOR = 250;

  /** Effective touch width for an arrow, in stage units. */
  const HIT_TARGET_PX = 40;
  /** Visible line width in stage units for the current zoom. */
  function lineWidthForScale(selected) {
    const scale = view.scale > 0 ? view.scale : 1;
    const px = selected ? SELECTED_ARROW_STROKE_PX : VISIBLE_ARROW_STROKE_PX;
    return px / scale;
  }

  /**
   * Where the visible shaft stops: short of B along the A->B bearing, so the
   * round cap cannot protrude past the tip. Rendering only.
   */
  function shaftEnd(a, b) {
    const scale = view.scale > 0 ? view.scale : 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const back = SHAFT_NECK_OFFSET_PX / scale;
    // Never invert a very short arrow: clamp the shortening to its length.
    if (!(len > 1e-9) || back >= len) return { x: a.x, y: a.y };
    return { x: b.x - (dx / len) * back, y: b.y - (dy / len) * back };
  }

  function hitWidthForScale() {
    const scale = view.scale > 0 ? view.scale : 1;
    return HIT_TARGET_PX / scale;
  }

  function renderArrow(annotation) {
    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'wm-arrow'
      + (routeInteraction.getSelected(routeState) === annotation.id ? ' selected' : ''));
    g.setAttribute('data-annotation-id', annotation.id);

    const a = geometry.denormalizePoint(annotation.a, stageSize);
    const b = geometry.denormalizePoint(annotation.b, stageSize);

    const hit = doc.createElementNS(SVG_NS, 'line');
    hit.setAttribute('x1', a.x); hit.setAttribute('y1', a.y);
    hit.setAttribute('x2', b.x); hit.setAttribute('y2', b.y);
    hit.setAttribute('class', 'wm-arrow-hit');
    // Width is set in user units, not left to non-scaling-stroke: Chromium
    // hit-tests a non-scaling stroke against its UNSCALED width, so at fit
    // scale the touch target silently shrank to a few pixels. Dividing by the
    // stage scale keeps roughly HIT_TARGET_PX of finger room at every zoom.
    hit.setAttribute('stroke-width', String(hitWidthForScale()));

    const selected = routeInteraction.getSelected(routeState) === annotation.id;
    const neck = shaftEnd(a, b);
    const line = doc.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    // Stops SHORT of B so the round cap cannot protrude past the tip; the
    // arrowhead covers the remainder. B itself is unchanged.
    line.setAttribute('x2', neck.x); line.setAttribute('y2', neck.y);
    line.setAttribute('class', 'wm-arrow-line');
    // Explicit stage-unit width, recomputed on zoom. See VISIBLE_ARROW_STROKE_PX.
    line.setAttribute('stroke-width', String(lineWidthForScale(selected)));

    g.appendChild(hit);
    g.appendChild(line);
    g.appendChild(renderArrowHead(a, b));
    return g;
  }

  /**
   * The arrowhead, as geometry rather than an SVG <marker>.
   *
   * A marker sizes itself in markerUnits, which defaults to strokeWidth — so
   * the head was 7 x 2.5 = 17.5 USER units and rode the stage transform,
   * measuring 3.4px at fit and 70px at 4x. `non-scaling-stroke` does not help:
   * it changes how the stroke is painted, not the user-space width a marker
   * multiplies by. No marker configuration gives constant screen size here.
   *
   * Instead the head is a path translated to endpoint B, rotated to the A->B
   * bearing and scaled by 1/stageScale — the same local compensation the wire
   * labels use. It is a LOCAL transform inside the one stage transform, not a
   * second viewport.
   */
  function renderArrowHead(a, b) {
    const head = doc.createElementNS(SVG_NS, 'path');
    head.setAttribute('class', 'wm-arrow-head');
      head.setAttribute('d', arrowHeadPath(a, b));
      // No transform: the computed path data already carries the size.
    return head;
  }

  /**
   * Arrowhead as explicit stage-space geometry.
   *
   * Two earlier approaches failed. An SVG <marker> sizes itself in markerUnits
   * and rides the stage transform. A nested scale(1/stageScale) transform
   * measures correctly in Blink but does NOT render equivalently in physical
   * iOS Safari, where the head was invisible at fit.
   *
   * Nothing here relies on a nested transform: the desired screen size is
   * divided by the stage scale and the triangle's points are computed around
   * endpoint B from the A->B unit vector and its perpendicular. The path DATA
   * changes with zoom, which every engine renders identically.
   */
  function arrowHeadPath(a, b, scaleOverride) {
    const scale = Number.isFinite(scaleOverride) && scaleOverride > 0
      ? scaleOverride : (view.scale > 0 ? view.scale : 1);
    const length = HEAD_LENGTH_PX / scale;
    const halfWidth = (HEAD_WIDTH_PX / scale) / 2;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    // A zero-length arrow has no bearing; point it along +x rather than NaN.
    const ux = len > 1e-9 ? dx / len : 1;
    const uy = len > 1e-9 ? dy / len : 0;
    const px = -uy;
    const py = ux;

    const baseX = b.x - ux * length;
    const baseY = b.y - uy * length;
    const notchX = b.x - ux * length * (1 - HEAD_NOTCH);
    const notchY = b.y - uy * length * (1 - HEAD_NOTCH);

    const f = (x, y) => x.toFixed(3) + ',' + y.toFixed(3);
    return 'M' + f(b.x, b.y)                                      // tip IS endpoint B
      + ' L' + f(baseX + px * halfWidth, baseY + py * halfWidth)
      + ' L' + f(notchX, notchY)
      + ' L' + f(baseX - px * halfWidth, baseY - py * halfWidth)
      + ' Z';
  }

  /**
   * Endpoint handles for the selected arrow, drawn in the selection layer so
   * they are visibly transient and never persisted or exported.
   *
   * The visible handle stays small; a larger transparent circle behind it
   * provides a finger-sized target.
   */
  function renderSelection() {
    if (!el.selection || !stageSize) return;
    while (el.selection.firstChild) el.selection.removeChild(el.selection.firstChild);
    const sketchId = sketchInteraction.getSelected(sketchState);
    if (sketchId) {
      const shape = annotations.get(sketchId);
      if (shape) renderSketchHandles(shape);
    }

    const id = routeInteraction.getSelected(routeState);
    if (!id) return;
    const arrow = annotations.get(id);
    if (!arrow || arrow.type !== 'arrow') return;

    const inverse = labelInteraction.labelCounterScale(view.scale);
    [['a', arrow.a], ['b', arrow.b]].forEach(([which, normalized]) => {
      const point = geometry.denormalizePoint(normalized, stageSize);
      const g = doc.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'wm-endpoint');
      g.setAttribute('data-annotation-id', id);
      g.setAttribute('data-endpoint', which);
      g.setAttribute('transform',
        'translate(' + point.x + ',' + point.y + ') scale(' + inverse + ')');
      const target = doc.createElementNS(SVG_NS, 'circle');
      target.setAttribute('r', '22');            // ~44px effective touch target
      target.setAttribute('class', 'wm-endpoint-target');
      const dot = doc.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('r', '7');
      dot.setAttribute('class', 'wm-endpoint-dot');
      g.appendChild(target);
      g.appendChild(dot);
      el.selection.appendChild(g);
    });
  }

  /**
   * Handles for the selected sketch shape: two for a line, four for a
   * rectangle. Drawn in the selection layer so they are visibly transient.
   * A small visible dot sits inside a finger-sized transparent target.
   */
  function renderSketchHandles(shape) {
    if (!el.selection || !stageSize) return;
    // Text has no draggable geometry: it carries `at`, not `a`/`b`, and WM-6B2
    // gives it a subtle outline instead of handles. Without this guard the
    // handle loop dereferenced undefined endpoints and threw, aborting
    // selection midway and leaving the gesture state inconsistent.
    if (shape.type !== 'line' && shape.type !== 'rect') return;

    const inverse = labelInteraction.labelCounterScale(view.scale);
    const points = shape.type === 'rect'
      ? sketchInteraction.rectCorners(shape)
      : { a: shape.a, b: shape.b };
    Object.keys(points).forEach((which) => {
      const p = geometry.denormalizePoint(points[which], stageSize);
      const g = doc.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'wm-sketch-handle');
      g.setAttribute('data-annotation-id', shape.id);
      g.setAttribute('data-handle', which);
      g.setAttribute('transform',
        'translate(' + p.x + ',' + p.y + ') scale(' + inverse + ')');
      const target = doc.createElementNS(SVG_NS, 'circle');
      target.setAttribute('r', '22');          // ~44px effective touch target
      target.setAttribute('class', 'wm-endpoint-target');
      const dot = doc.createElementNS(SVG_NS, 'rect');
      dot.setAttribute('x', '-6'); dot.setAttribute('y', '-6');
      dot.setAttribute('width', '12'); dot.setAttribute('height', '12');
      dot.setAttribute('class', 'wm-sketch-handle-dot');
      g.appendChild(target); g.appendChild(dot);
      el.selection.appendChild(g);
    });
  }

    /** Live preview while an arrow is being drawn. Never persisted. */
  function renderDraft(start, end) {
    if (!el.selection || !stageSize) return;
    let draft = doc.getElementById('wm-draft-arrow');
    if (!start || !end) {
      if (draft && draft.parentNode) draft.parentNode.removeChild(draft);
      return;
    }
    const a = geometry.denormalizePoint(start, stageSize);
    const b = geometry.denormalizePoint(end, stageSize);
    if (!draft) {
      draft = doc.createElementNS(SVG_NS, 'line');
      draft.setAttribute('id', 'wm-draft-arrow');
      draft.setAttribute('class', 'wm-arrow-line wm-arrow-draft');
      el.selection.appendChild(draft);
    }
    draft.setAttribute('x1', a.x); draft.setAttribute('y1', a.y);
    draft.setAttribute('x2', b.x); draft.setAttribute('y2', b.y);
  }

  function renderRoutes() {
    if (!el.routes || !stageSize) return;
    while (el.routes.firstChild) el.routes.removeChild(el.routes.firstChild);
    annotations.forEach((a) => {
      if (a.type === 'arrow') el.routes.appendChild(renderArrow(a));
    });
    renderSelection();
  }

  /** Stroke width in stage units for the current zoom. */
  function sketchWidthForScale(selected) {
    const scale = view.scale > 0 ? view.scale : 1;
    return (selected ? SKETCH_SELECTED_STROKE_PX : SKETCH_STROKE_PX) / scale;
  }

  function sketchHitForScale() {
    const scale = view.scale > 0 ? view.scale : 1;
    return SKETCH_HIT_PX / scale;
  }

  /**
   * Drafting grid for a blank sheet, drawn as SVG geometry inside the one
   * stage transform. It is not a second layer with its own transform, and it
   * is never persisted — a blank sheet should read as drafting paper, not as
   * an empty black rectangle.
   */
  function renderGrid() {
    if (!el.sketch || !stageSize || !showGrid) return null;
    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'wm-grid');
    g.setAttribute('aria-hidden', 'true');
    const line = (x1, y1, x2, y2, cls) => {
      const l = doc.createElementNS(SVG_NS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('class', cls);
      // Hairlines, compensated like everything else.
      l.setAttribute('stroke-width', String((cls === 'wm-grid-major' ? 1 : 0.6)
        / (view.scale > 0 ? view.scale : 1)));
      g.appendChild(l);
    };
    for (let x = 0; x <= stageSize.width; x += GRID_MINOR) {
      line(x, 0, x, stageSize.height, x % GRID_MAJOR === 0 ? 'wm-grid-major' : 'wm-grid-minor');
    }
    for (let y = 0; y <= stageSize.height; y += GRID_MINOR) {
      line(0, y, stageSize.width, y, y % GRID_MAJOR === 0 ? 'wm-grid-major' : 'wm-grid-minor');
    }
    return g;
  }

  /** One sketch shape: a wide invisible hit stroke under a thin visible one. */
  function renderSketchShape(annotation) {
    const selected = sketchInteraction.getSelected(sketchState) === annotation.id;
    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'wm-sketch-shape' + (selected ? ' selected' : ''));
    g.setAttribute('data-annotation-id', annotation.id);

    const a = geometry.denormalizePoint(annotation.a, stageSize);
    const b = geometry.denormalizePoint(annotation.b, stageSize);
    const w = String(sketchWidthForScale(selected));
    const hw = String(sketchHitForScale());

    if (annotation.type === 'line') {
      const hit = doc.createElementNS(SVG_NS, 'line');
      hit.setAttribute('x1', a.x); hit.setAttribute('y1', a.y);
      hit.setAttribute('x2', b.x); hit.setAttribute('y2', b.y);
      hit.setAttribute('class', 'wm-sketch-hit');
      hit.setAttribute('stroke-width', hw);
      const vis = doc.createElementNS(SVG_NS, 'line');
      vis.setAttribute('x1', a.x); vis.setAttribute('y1', a.y);
      vis.setAttribute('x2', b.x); vis.setAttribute('y2', b.y);
      vis.setAttribute('class', 'wm-sketch-line');
      vis.setAttribute('stroke-width', w);
      g.appendChild(hit); g.appendChild(vis);
    } else {
      const bounds = geometry.segmentBounds({ a: annotation.a, b: annotation.b });
      const x = bounds.x1 * stageSize.width;
      const y = bounds.y1 * stageSize.height;
      const width = (bounds.x2 - bounds.x1) * stageSize.width;
      const height = (bounds.y2 - bounds.y1) * stageSize.height;
      // Selection is on the BORDER: a filled interior would swallow taps meant
      // for whatever the rectangle is drawn around.
      const hit = doc.createElementNS(SVG_NS, 'rect');
      hit.setAttribute('x', x); hit.setAttribute('y', y);
      hit.setAttribute('width', width); hit.setAttribute('height', height);
      hit.setAttribute('class', 'wm-sketch-hit');
      hit.setAttribute('stroke-width', hw);
      const vis = doc.createElementNS(SVG_NS, 'rect');
      vis.setAttribute('x', x); vis.setAttribute('y', y);
      vis.setAttribute('width', width); vis.setAttribute('height', height);
      vis.setAttribute('class', 'wm-sketch-rect');
      vis.setAttribute('stroke-width', w);
      g.appendChild(hit); g.appendChild(vis);
    }
    return g;
  }

  /** Live preview while drawing. Never persisted. */
  function renderSketchDraft(tool, a, b) {
    if (!el.selection || !stageSize) return;
    let d = doc.getElementById('wm-draft-sketch');
    if (!tool || !a || !b) {
      if (d && d.parentNode) d.parentNode.removeChild(d);
      return;
    }
    const pa = geometry.denormalizePoint(a, stageSize);
    const pb = geometry.denormalizePoint(b, stageSize);
    const wanted = tool === 'line' ? 'line' : 'rect';
    if (d && d.tagName !== wanted) { d.parentNode.removeChild(d); d = null; }
    if (!d) {
      d = doc.createElementNS(SVG_NS, wanted);
      d.setAttribute('id', 'wm-draft-sketch');
      d.setAttribute('class', wanted === 'line' ? 'wm-sketch-line wm-sketch-draft'
        : 'wm-sketch-rect wm-sketch-draft');
      el.selection.appendChild(d);
    }
    d.setAttribute('stroke-width', String(sketchWidthForScale(false)));
    if (wanted === 'line') {
      d.setAttribute('x1', pa.x); d.setAttribute('y1', pa.y);
      d.setAttribute('x2', pb.x); d.setAttribute('y2', pb.y);
    } else {
      d.setAttribute('x', Math.min(pa.x, pb.x)); d.setAttribute('y', Math.min(pa.y, pb.y));
      d.setAttribute('width', Math.abs(pb.x - pa.x)); d.setAttribute('height', Math.abs(pb.y - pa.y));
    }
  }

  /**
   * One text annotation.
   *
   * The anchor rides the single stage transform; the font size is divided by
   * the stage scale so the text keeps a constant screen size. A transparent
   * backing rect gives it a finger-sized hit area, because a glyph outline is
   * far too thin to tap reliably.
   */
  function renderTextShape(annotation) {
    const g = doc.createElementNS(SVG_NS, 'g');
    const selected = sketchInteraction.getSelected(sketchState) === annotation.id;
    g.setAttribute('class', 'wm-text-shape' + (selected ? ' selected' : ''));
    g.setAttribute('data-annotation-id', annotation.id);

    const p = geometry.denormalizePoint(annotation.at, stageSize);
    const scale = view.scale > 0 ? view.scale : 1;
    const font = sketchInteraction.textFontForScale(TEXT_FONT_PX, scale);
    const pad = TEXT_PAD_PX / scale;
    const text = String((annotation.data && annotation.data.text) || '');

    const t = doc.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(p.x));
    t.setAttribute('y', String(p.y));
    t.setAttribute('class', 'wm-text-body');
    t.setAttribute('font-size', String(font));
    t.textContent = text;   // textContent, never innerHTML: user text is data

    const hit = doc.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('class', 'wm-text-hit');
    // Decoration only, and only when selected. Drawn as its own element so the
    // outline can hug the glyphs while the hit rect stays finger-sized — the
    // two used to be the same rect, which left 24.5px of empty space above the
    // text and 0.5px below it.
    const outline = selected ? doc.createElementNS(SVG_NS, 'rect') : null;
    if (outline) outline.setAttribute('class', 'wm-text-outline');
    // The text must be in the document before it can be measured.
    g.appendChild(hit);
    if (outline) g.appendChild(outline);
    g.appendChild(t);

    /**
     * Size the touch target from the REAL advance width once the glyphs exist,
     * falling back to a character estimate if the engine reports nothing
     * usable. A character estimate alone is wrong for Unicode and punctuation.
     */
    function sizeHit() {
      let measured = 0;
      try {
        if (typeof t.getComputedTextLength === 'function') measured = t.getComputedTextLength();
        if (!(measured > 0) && typeof t.getBBox === 'function') measured = t.getBBox().width;
      } catch (_) { measured = 0; }
      const estimated = Math.max(font * 1.2, text.length * font * 0.58);
      const width = (measured > 0 ? measured : estimated) + pad * 2;
      // Height is a screen-space minimum, converted like every other target.
      const height = Math.max(TEXT_HIT_MIN_PX / scale, font * 1.35 + pad * 2);
      hit.setAttribute('x', String(p.x - pad));
      // Centre the box on the glyph band rather than hanging it off the baseline.
      hit.setAttribute('y', String(p.y + font * 0.28 - height));
      hit.setAttribute('width', String(width));
      hit.setAttribute('height', String(height));

      if (!outline) return;
      // The outline comes from the REAL rendered bounds, so descenders in
      // "gjpqy" and short strings like "A" are all enclosed symmetrically.
      const padX = TEXT_OUTLINE_PAD_X_PX / scale;
      const padY = TEXT_OUTLINE_PAD_Y_PX / scale;
      let box = null;
      try {
        if (typeof t.getBBox === 'function') {
          const bb = t.getBBox();
          if (bb && bb.width > 0 && bb.height > 0) box = bb;
        }
      } catch (_) { box = null; }
      if (!box) {
        // Defensive fallback: approximate the glyph band from the font metrics.
        box = { x: p.x, y: p.y - font * 0.78, width: measured > 0 ? measured : estimated,
          height: font * 1.05 };
      }
      // getBBox and getComputedTextLength both report the ADVANCE width, which
      // for glyph runs with overhang (">", en-dashes) is a shade narrower than
      // what is actually painted. The client rect is the painted extent, so
      // convert it back to stage units and take the widest of the three: the
      // outline must never clip the text it is drawn around.
      // Both getBBox and getComputedTextLength report the ADVANCE width. Glyph
      // runs with overhang ('>', en-dashes) paint a couple of pixels past it,
      // and the group is still detached here so the client rect reads zero.
      // A small font-proportional allowance covers the overhang without
      // loosening the outline noticeably.
      const overhang = font * 0.2;
      const boxWidth = Math.max(box.width, measured > 0 ? measured : 0) + overhang;
      outline.setAttribute('x', String(box.x - padX));
      outline.setAttribute('y', String(box.y - padY));
      outline.setAttribute('width', String(boxWidth + padX * 2));
      outline.setAttribute('height', String(box.height + padY * 2));
    }
    sizeHit();
    return g;
  }

    function renderSketch() {
    if (!el.sketch || !stageSize) return;
    while (el.sketch.firstChild) el.sketch.removeChild(el.sketch.firstChild);
    const grid = renderGrid();
    if (grid) el.sketch.appendChild(grid);
    annotations.forEach((a) => {
      if (a.type === 'line' || a.type === 'rect') el.sketch.appendChild(renderSketchShape(a));
      else if (a.type === 'text') el.sketch.appendChild(renderTextShape(a));
    });
  }

    /** Redraw every label. Cheap at MVP scale and keeps state in one place. */
  function renderLabels() {
    if (!el.labels || !stageSize) return;
    while (el.labels.firstChild) el.labels.removeChild(el.labels.firstChild);
    annotations.forEach((a) => {
      if (a.type === 'wireLabel') el.labels.appendChild(renderLabel(a));
    });
    renderSketch();
    renderRoutes();
  }

  /** Keep label bodies a constant screen size as the plan zooms. */
  function rescaleLabels() {
    renderSelection();   // endpoint handles are inverse-scaled too
    if (el.routes) {
      // Keep the arrow touch target a constant screen size as the plan zooms.
      const w = String(hitWidthForScale());
      const hits = el.routes.querySelectorAll ? el.routes.querySelectorAll('.wm-arrow-hit') : [];
      for (let i = 0; i < hits.length; i++) hits[i].setAttribute('stroke-width', w);
      if (el.sketch) {
        // Sketch strokes, hit widths and grid hairlines are all screen-space
        // targets, so every one of them is recomputed when the zoom changes.
        renderSketch();
      }
      const groups = el.routes.querySelectorAll ? el.routes.querySelectorAll('.wm-arrow') : [];
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const arrow = annotations.get(group.getAttribute('data-annotation-id'));
        const line = group.querySelector && group.querySelector('.wm-arrow-line');
        if (!arrow || !line) continue;
        const selected = routeInteraction.getSelected(routeState) === arrow.id;
        line.setAttribute('stroke-width', String(lineWidthForScale(selected)));
        // The neck is a screen-space offset, so it must be recomputed too.
        const neck = shaftEnd(geometry.denormalizePoint(arrow.a, stageSize),
          geometry.denormalizePoint(arrow.b, stageSize));
        line.setAttribute('x2', neck.x);
        line.setAttribute('y2', neck.y);
      }

      // The head is inverse-scaled, so it must be re-emitted on every zoom.
      const heads = el.routes.querySelectorAll ? el.routes.querySelectorAll('.wm-arrow') : [];
      for (let j = 0; j < heads.length; j++) {
        const group = heads[j];
        const arrow = annotations.get(group.getAttribute('data-annotation-id'));
        const head = group.querySelector && group.querySelector('.wm-arrow-head');
        if (!arrow || !head) continue;
          head.setAttribute('d', arrowHeadPath(
          geometry.denormalizePoint(arrow.a, stageSize),
          geometry.denormalizePoint(arrow.b, stageSize)));
      }
    }
    if (!el.labels || !stageSize) return;
    const inverse = labelInteraction.labelCounterScale(view.scale);
    const nodes = el.labels.childNodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const id = node.getAttribute && node.getAttribute('data-annotation-id');
      const a = id && annotations.get(id);
      if (!a || a.type !== 'wireLabel') continue;
      const anchor = geometry.denormalizePoint(a.at, stageSize);
      node.setAttribute('transform',
        'translate(' + anchor.x + ',' + anchor.y + ') scale(' + inverse + ')');
    }
  }

  function setAnnotations(list) {
    annotations = new Map();
    (list || []).forEach((a) => { if (a && a.id) annotations.set(a.id, a); });
    renderLabels();
  }

  function upsertAnnotation(a) {
    if (!a || !a.id) return;
    annotations.set(a.id, a);
    renderLabels();
  }

  function removeAnnotation(id) {
    annotations.delete(id);
    renderLabels();
  }

  function getAnnotation(id) {
    return annotations.get(id) || null;
  }

  // ── Add Label mode ──────────────────────────────────────────────────
  function armPlacement() {
    labelInteraction.armPlacement(labelState);
    if (hooks.onModeChange) hooks.onModeChange(true);
  }

  function disarmPlacement() {
    labelInteraction.disarmPlacement(labelState);
    if (hooks.onModeChange) hooks.onModeChange(false);
  }

  // ── Arrow mode ──────────────────────────────────────────────────────
  function armArrow() {
    labelInteraction.disarmPlacement(labelState);
    if (hooks.onModeChange) hooks.onModeChange(false);
    routeInteraction.armDraw(routeState);
    if (hooks.onArrowModeChange) hooks.onArrowModeChange(true);
  }

  function disarmArrow() {
    routeInteraction.disarmDraw(routeState);
    renderDraft(null, null);
    if (hooks.onArrowModeChange) hooks.onArrowModeChange(false);
  }

  /**
   * Arm a sketch tool. Arming one disarms every other creation mode, so a
   * pointer can only ever belong to one of them.
   */
  function armSketch(tool) {
    labelInteraction.disarmPlacement(labelState);
    if (hooks.onModeChange) hooks.onModeChange(false);
    routeInteraction.disarmDraw(routeState);
    if (hooks.onArrowModeChange) hooks.onArrowModeChange(false);
    sketchInteraction.armTool(sketchState, tool);
    if (hooks.onSketchToolChange) hooks.onSketchToolChange(sketchInteraction.activeTool(sketchState));
  }

  function disarmSketch() {
    sketchInteraction.disarmTool(sketchState);
    renderSketchDraft(null, null, null);
    if (hooks.onSketchToolChange) hooks.onSketchToolChange('none');
  }

  /**
   * Bring a normalized sheet point as close to the viewport centre as the
   * existing pan bounds legally allow.
   *
   * Delegates to viewport.centerOnNormalized, which already clamps — search
   * must not weaken pan bounds to achieve perfect centering, and a label near
   * an edge simply lands at the nearest legal position.
   *
   * @param {object} at normalized point
   * @param {number} [scale] target scale; omit to keep the current zoom.
   */
  function focusOn(at, scale) {
    if (!stageSize || !at) return false;
    const size = viewSize();
    if (!size || !(size.width > 0) || !(size.height > 0)) return false;
    const next = viewportMath.centerOnNormalized(at, stageSize, size, view,
      Number.isFinite(scale) && scale > 0 ? scale : view.scale);
    if (!next || !Number.isFinite(next.scale)) return false;
    setViewport(next);
    rescaleLabels();
    return true;
  }

    function selectSketch(id) {
    sketchInteraction.select(sketchState, id);
    renderSketch();
    renderSelection();
    if (hooks.onSketchSelected) hooks.onSketchSelected(id ? annotations.get(id) : null);
  }

  /**
   * Bind the controller to a sheet. Undo history is per sheet and is cleared
   * here, because undoing onto a sheet you are no longer looking at would be
   * worse than not undoing at all.
   */
  function setSheet(sheetId, options) {
    currentSheetId = sheetId || null;
    showGrid = !!(options && options.blank);
    undoStack.bindSheet(undo, currentSheetId);
    sketchInteraction.disarmTool(sketchState);
    sketchInteraction.clearSelection(sketchState);
  }

  // ── Undo, sketch mutations only ──────────────────────────────────────
  function recordCreate(annotation) { undoStack.pushCreate(undo, annotation); }
  function recordGeometry(before) { undoStack.pushGeometry(undo, before); }
  function recordDelete(annotation) { undoStack.pushDelete(undo, annotation); }

  /**
   * Describe the work needed to reverse the last sketch mutation. The caller
   * persists it — this module never touches storage.
   */
  function planUndo() {
    return undoStack.undo(undo, (id) => annotations.get(id) || null);
  }

    function selectArrow(id) {
    routeInteraction.select(routeState, id);
    renderRoutes();
    if (hooks.onArrowSelected) hooks.onArrowSelected(id ? annotations.get(id) : null);
  }

  /**
   * Show a blank sheet: same stage, same coordinates, no image blob.
   *
   * Deliberately shares every path with showImage except the background, so
   * sketch geometry on a blank sheet behaves identically to geometry on a plan.
   */
  function showBlank(width, height) {
    if (!el.svg || !el.stage) return false;
    if (!(width > 0) || !(height > 0)) return false;

    releaseImage();
    if (el.image) { el.image.removeAttribute('src'); el.image.hidden = true; }

    stageSize = { width: width, height: height };
    el.stage.style.width = width + 'px';
    el.stage.style.height = height + 'px';
    el.svg.setAttribute('width', String(width));
    el.svg.setAttribute('height', String(height));
    el.svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    if (el.background) {
      el.background.setAttribute('width', String(width));
      el.background.setAttribute('height', String(height));
    }
    setPlaceholderVisible(false);
    showGrid = true;
    fit();
    renderLabels();
    return true;
  }

    // ── Pointer handling ────────────────────────────────────────────────
  // Pointer Events only. No parallel mouse and touch paths.

  function localPoint(e) {
    const r = el.viewport.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Walk up to the nearest ancestor carrying an attribute. */
  function attrFrom(target, name) {
    let node = target;
    while (node && node !== el.viewport) {
      if (node.getAttribute && node.getAttribute(name)) return node.getAttribute(name);
      node = node.parentNode;
    }
    return null;
  }

  /** The annotation id under this event, if any. */
  function labelIdFrom(target) {
    return attrFrom(target, 'data-annotation-id');
  }

  /** The id only when the press landed on an arrow group. */
  function arrowIdFrom(target) {
    let node = target;
    while (node && node !== el.viewport) {
      const cls = node.getAttribute && node.getAttribute('class');
      // Match the GROUP, whose class is exactly "wm-arrow" (plus an optional
      // "selected"). A prefix test would also match the child line's
      // "wm-arrow-hit", which carries no id — the press would then be lost.
      if (cls && /(^|\s)wm-arrow(\s|$)/.test(cls)) return node.getAttribute('data-annotation-id');
      node = node.parentNode;
    }
    return null;
  }

  /** The id only when the press landed on a text group. */
  function textIdFrom(target) {
    let node = target;
    while (node && node !== el.viewport) {
      const cls = node.getAttribute && node.getAttribute('class');
      if (cls && /(^|\s)wm-text-shape(\s|$)/.test(cls)) return node.getAttribute('data-annotation-id');
      node = node.parentNode;
    }
    return null;
  }

  /** The id only when the press landed on a sketch shape group. */
  function sketchShapeIdFrom(target) {
    let node = target;
    while (node && node !== el.viewport) {
      const cls = node.getAttribute && node.getAttribute('class');
      if (cls && /(^|\s)wm-sketch-shape(\s|$)/.test(cls)) return node.getAttribute('data-annotation-id');
      node = node.parentNode;
    }
    return null;
  }

  function capture(e) {
    if (el.viewport.setPointerCapture) {
      try { el.viewport.setPointerCapture(e.pointerId); } catch (_) { /* already captured */ }
    }
  }

  function nowMs() {
    return (win && win.performance && win.performance.now) ? win.performance.now() : Date.now();
  }

  function onPointerDown(e) {
    if (!stageSize) return;
    const point = localPoint(e);
    const type = e.pointerType || 'mouse';

    // One physical iOS touch also emits a synthesised mouse pair. Ignoring the
    // duplicate here is what stops a single tap creating two labels.
    if (labelInteraction.isCompatibilityDuplicate(labelState, type, point, nowMs())) return;
    pressedBackground = false;   // reset before any branch can return
    labelInteraction.noteInput(labelState, type, point, nowMs());

    lastViewSize = viewSize();

    // Sketch handles sit on top of everything and are small, so they claim the
    // pointer first. Ownership is decided here, once, and every branch returns.
    const sketchHandle = attrFrom(e.target, 'data-handle');
    if (sketchHandle) {
      const shapeId = labelIdFrom(e.target);
      const shape = shapeId && annotations.get(shapeId);
      if (shape) {
        capture(e);
        sketchInteraction.handleDown(sketchState, shape, sketchHandle, point);
        if (e.stopPropagation) e.stopPropagation();
        return;
      }
    }

    // Endpoint handles win over everything: they sit on top and are small.
    const handle = attrFrom(e.target, 'data-endpoint');
    if (handle) {
      const arrowId = labelIdFrom(e.target);
      const arrow = arrowId && annotations.get(arrowId);
      if (arrow) {
        capture(e);
        routeInteraction.endpointDown(routeState, arrowId, handle, point, arrow[handle]);
        if (e.stopPropagation) e.stopPropagation();
        return;
      }
    }

    // Arrow mode: a drag on the plan draws.
    if (routeInteraction.isArmed(routeState)) {
      capture(e);
      routeInteraction.drawStart(routeState, point, view, stageSize);
      if (e.stopPropagation) e.stopPropagation();
      return;
    }

    const arrowId = arrowIdFrom(e.target);
    if (arrowId && annotations.has(arrowId)) {
      capture(e);
      selectArrow(arrowId);
      if (e.stopPropagation) e.stopPropagation();
      return;
    }

    // Sketch shapes are below arrows and labels, matching the visual stacking:
    // wm-sketch renders beneath wm-routes and wm-labels, so a label on top of a
    // sketch line stays tappable.
    // Existing text: press to drag, tap to edit. Above line/rect because a
    // caption may sit on top of a shape and must stay reachable.
    const textId = textIdFrom(e.target);
    if (textId && annotations.has(textId)) {
      capture(e);
      sketchInteraction.textPointerDown(sketchState, annotations.get(textId), point, view, stageSize);
      selectSketch(textId);
      if (e.stopPropagation) e.stopPropagation();
      return;
    }

    const sketchId = sketchShapeIdFrom(e.target);
    if (sketchId && annotations.has(sketchId)) {
      capture(e);
      selectSketch(sketchId);
      if (e.stopPropagation) e.stopPropagation();
      return;
    }

    const labelId = labelIdFrom(e.target);
    if (labelId && annotations.has(labelId)) {
      // The label owns this pointer: the plan must not pan underneath it.
      if (el.viewport.setPointerCapture) {
        try { el.viewport.setPointerCapture(e.pointerId); } catch (_) { /* already captured */ }
      }
      labelInteraction.labelPointerDown(labelState, labelId, point, annotations.get(labelId).at);
      if (e.stopPropagation) e.stopPropagation();
      return;
    }

    // An armed sketch tool draws ONLY on empty sheet. It sits here, after every
    // existing-annotation branch, because arming Line must not turn a tap on a
    // label, an arrow or an existing shape into the start of a new line.
    if (sketchInteraction.isArmed(sketchState)) {
      capture(e);
      // Text is placed by a TAP, so there is no draft to start; line and rect
      // begin a drag draft here as before.
      if (sketchInteraction.activeTool(sketchState) !== 'text') {
        sketchInteraction.drawStart(sketchState, point, view, stageSize);
      }
      if (e.stopPropagation) e.stopPropagation();
      return;
    }

    // Nothing above claimed the press, so it landed on empty space: the
    // background surface, the letterboxing beside the sheet, or the image.
    // Deciding it HERE rather than by element identity matters — at fit the
    // plan occupies only part of the viewport, so a tap "well away from the
    // arrow" often lands outside the sheet rect entirely. That is exactly
    // where the iPhone deselect failed.
    pressedBackground = true;

    if (el.viewport.setPointerCapture) {
      try { el.viewport.setPointerCapture(e.pointerId); } catch (_) { /* already captured */ }
    }
    interaction.pointerDown(gesture, localPoint(e), view);
  }

  function onPointerMove(e) {
    if (!stageSize) return;

    if (sketchInteraction.hasPressedText(sketchState)) {
      const r = sketchInteraction.textPointerMove(sketchState, localPoint(e), view, stageSize);
      if (r.moved && r.normalized) {
        const t = annotations.get(r.id);
        // Live visual only; one write at the end of the drag.
        if (t) {
          annotations.set(r.id, sketchInteraction.withAnchor(t, r.normalized));
          renderSketch(); renderSelection();
        }
      }
      return;   // a text drag never pans the plan
    }

    if (sketchInteraction.hasPressedHandle(sketchState)) {
      const r = sketchInteraction.handleMove(sketchState, localPoint(e), view, stageSize);
      if (r.moved && r.geometry) {
        const shape = annotations.get(r.id);
        // Live visual only; the write happens once, at drag end.
        if (shape) {
          annotations.set(r.id, sketchInteraction.withGeometry(shape, r.geometry));
          renderSketch(); renderSelection();
        }
      }
      return;   // a handle drag never pans the plan
    }

    if (sketchInteraction.isDrawing(sketchState)) {
      const r = sketchInteraction.drawMove(sketchState, localPoint(e), view, stageSize);
      if (r.drawing) renderSketchDraft(r.tool, r.a, r.b);
      return;
    }

    if (routeInteraction.hasPressedEndpoint(routeState)) {
      const r = routeInteraction.endpointMove(routeState, localPoint(e), view, stageSize);
      if (r.moved && r.normalized) {
        const d = routeState.endpointDrag;
        const arrow = annotations.get(d.id);
        // Live visual only; the write happens once, on release.
        if (arrow) {
          annotations.set(d.id, routeInteraction.withEndpoint(arrow, r.which, r.normalized));
          renderRoutes();
        }
      }
      return;   // an endpoint drag never pans the plan
    }

    if (routeInteraction.isDrawing(routeState)) {
      const r = routeInteraction.drawMove(routeState, localPoint(e), view, stageSize);
      if (r.drawing) renderDraft(r.start, r.end);
      return;
    }

    if (labelInteraction.hasPressedLabel(labelState)) {
      const r = labelInteraction.labelPointerMove(labelState, localPoint(e), view, stageSize);
      if (r.moved && r.normalized) {
        const id = labelState.drag.id;
        const a = annotations.get(id);
        if (a) {
          // Live visual only. Nothing is written to IndexedDB until the drag ends.
          annotations.set(id, { ...a, at: r.normalized });
          renderLabels();
        }
      }
      return;   // a label drag never pans the plan
    }

    if (interaction.activeCount(gesture) === 0) return;
    const r = interaction.pointerMove(gesture, localPoint(e), view, bounds());
    if (r.changed) { setViewport(r.viewport); rescaleLabels(); }
  }

  function onPointerUp(e) {
    if (!stageSize) return;
    const point = localPoint(e);

    // Record where the touch ENDED, not only where it began. WebKit's
    // synthesised mouse pair follows the release point, so after a drag the
    // suppression window has to track that — otherwise the compatibility click
    // lands somewhere new and is treated as a fresh gesture.
    labelInteraction.noteInput(labelState, e.pointerType || 'mouse', point, nowMs());

    if (sketchInteraction.hasPressedText(sketchState)) {
      const outcome = sketchInteraction.textPointerUp(sketchState);
      release(e);
      if (outcome.action === 'tap' && hooks.onTextEdit) {
        hooks.onTextEdit(annotations.get(outcome.id));
      } else if (outcome.action === 'move' && hooks.onTextMoved) {
        const t = annotations.get(outcome.id);
        if (t) {
          hooks.onTextMoved(sketchInteraction.withAnchor(t, outcome.normalized),
            sketchInteraction.withAnchor(t, outcome.before));
        }
      }
      return;
    }

    if (sketchInteraction.hasPressedHandle(sketchState)) {
      const outcome = sketchInteraction.handleUp(sketchState);
      release(e);
      if (outcome.action === 'move' && hooks.onSketchChanged) {
        const shape = annotations.get(outcome.id);
        if (shape) {
          hooks.onSketchChanged(sketchInteraction.withGeometry(shape, outcome.geometry),
            sketchInteraction.withGeometry(shape, outcome.before));
        }
      }
      return;
    }

    if (sketchInteraction.activeTool(sketchState) === 'text') {
      const normalized = sketchInteraction.textPlacementAt(sketchState, point, view, stageSize);
      release(e);
      disarmSketch();
      if (normalized && hooks.onTextPlace) hooks.onTextPlace(normalized);
      return;
    }

    if (sketchInteraction.isDrawing(sketchState)) {
      const outcome = sketchInteraction.drawEnd(sketchState);
      release(e);
      renderSketchDraft(null, null, null);
      disarmSketch();
      if (outcome.action === 'commit' && hooks.onSketchDrawn) {
        hooks.onSketchDrawn({ tool: outcome.tool, a: outcome.a, b: outcome.b });
      }
      return;
    }

    if (routeInteraction.hasPressedEndpoint(routeState)) {
      const outcome = routeInteraction.endpointUp(routeState);
      release(e);
      if (outcome.action === 'move' && hooks.onArrowMoved) {
        const arrow = annotations.get(outcome.id);
        if (arrow) hooks.onArrowMoved(routeInteraction.withEndpoint(arrow, outcome.which, outcome.normalized));
      }
      return;
    }

    if (routeInteraction.isDrawing(routeState)) {
      const outcome = routeInteraction.drawEnd(routeState);
      release(e);
      renderDraft(null, null);
      disarmArrow();
      if (outcome.action === 'commit' && hooks.onArrowDrawn) {
        hooks.onArrowDrawn({ start: outcome.start, end: outcome.end });
      }
      return;
    }

    if (labelInteraction.hasPressedLabel(labelState)) {
      const outcome = labelInteraction.labelPointerUp(labelState);
      if (el.viewport.releasePointerCapture) {
        try { el.viewport.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }
      }
      if (outcome.action === 'tap' && hooks.onEditRequested) {
        hooks.onEditRequested(annotations.get(outcome.id));
      } else if (outcome.action === 'move' && hooks.onMoved) {
        const a = annotations.get(outcome.id);
        if (a) hooks.onMoved({ ...a, at: outcome.normalized });   // one write, at the end
      }
      return;
    }

    // A tap on the explicit background surface clears the selection.
    //
    // Driven by where the press LANDED, not by inferring that nothing else
    // handled it. Inference passed in Blink but failed on physical iOS Safari.
    // Still gated so a real drag cannot deselect, and it runs after the
    // compatibility check, so the synthesised iOS pair cannot double-fire.
    if (pressedBackground
      && !labelInteraction.isArmed(labelState)
      && !routeInteraction.isArmed(routeState)
      && gesture.mode !== 'pan' && gesture.mode !== 'pinch'
      && (routeInteraction.getSelected(routeState)
        || sketchInteraction.getSelected(sketchState))) {
      interaction.pointerUp(gesture, e.pointerId, view);
      pressedBackground = false;
      selectArrow(null);
      selectSketch(null);
      return;
    }

    // Placement: an armed tap on empty plan opens a draft at that point.
    if (labelInteraction.isArmed(labelState)
      && gesture.mode !== 'pan' && gesture.mode !== 'pinch'
      && interaction.activeCount(gesture) === 1) {
      const normalized = labelInteraction.screenToNormalized(point, view, stageSize);
      interaction.pointerUp(gesture, e.pointerId, view);
      disarmPlacement();
      if (normalized && hooks.onPlaceRequested) hooks.onPlaceRequested(normalized);
      return;
    }

    interaction.pointerUp(gesture, e.pointerId, view);
    if (el.viewport.releasePointerCapture) {
      try { el.viewport.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }
    }
    // Nothing else happens on release. A tap must never change the transform:
    // iOS synthesises a second pointer pair after a touch tap, so any tap
    // gesture here fires twice for one finger. See interaction.js.
  }

  function release(e) {
    if (el.viewport.releasePointerCapture) {
      try { el.viewport.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }
    }
  }

  function onPointerCancel() {
    pressedBackground = false;
    if (sketchInteraction.hasPressedText(sketchState)) {
      const outcome = sketchInteraction.textPointerCancel(sketchState);
      if (outcome.action === 'revert' && outcome.id) {
        const t = annotations.get(outcome.id);
        if (t) {
          annotations.set(outcome.id, sketchInteraction.withAnchor(t, outcome.normalized));
          renderSketch(); renderSelection();
        }
      }
    }
    if (sketchInteraction.hasPressedHandle(sketchState)) {
      const outcome = sketchInteraction.handleCancel(sketchState);
      if (outcome.action === 'revert' && outcome.id) {
        const shape = annotations.get(outcome.id);
        // Put it back where it was stored: never leave a half-moved shape.
        if (shape) {
          annotations.set(outcome.id, sketchInteraction.withGeometry(shape, outcome.geometry));
          renderSketch(); renderSelection();
        }
      }
    }
    if (sketchInteraction.isDrawing(sketchState)) {
      sketchInteraction.drawCancel(sketchState);
      renderSketchDraft(null, null, null);
      disarmSketch();
    }
    if (routeInteraction.hasPressedEndpoint(routeState)) {
      const outcome = routeInteraction.endpointCancel(routeState);
      if (outcome.action === 'revert' && outcome.id) {
        const arrow = annotations.get(outcome.id);
        if (arrow) {
          annotations.set(outcome.id,
            routeInteraction.withEndpoint(arrow, outcome.which, outcome.normalized));
          renderRoutes();
        }
      }
    }
    if (routeInteraction.isDrawing(routeState)) {
      routeInteraction.drawCancel(routeState);
      renderDraft(null, null);
      disarmArrow();
    }
    if (labelInteraction.hasPressedLabel(labelState)) {
      const outcome = labelInteraction.labelPointerCancel(labelState);
      if (outcome.action === 'revert' && outcome.id) {
        const a = annotations.get(outcome.id);
        // Put it back where it was stored: never leave a half-moved label.
        if (a) { annotations.set(outcome.id, { ...a, at: outcome.normalized }); renderLabels(); }
      }
    }
    interaction.cancelAll(gesture);
  }

  function onResize() {
    if (!stageSize) return;
    const previous = lastViewSize || viewSize();
    const next = viewSize();
    if (!(next.width > 0) || !(next.height > 0)) return;
    const wasAtFit = interaction.isAtFit(view, stageSize, previous);
    lastViewSize = next;
    setViewport(interaction.reflowForViewportChange(view, stageSize, previous, next, wasAtFit));
    rescaleLabels();
  }

  /**
   * The viewport ELEMENT can change size without the window doing so — the
   * status line growing, Safari's chrome collapsing, a sibling reflowing.
   * A window resize listener never sees those, which left the plan fitted to a
   * viewport that no longer existed. ResizeObserver watches the element itself.
   */
  function observeElement() {
    const RO = (win && win.ResizeObserver) || (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null);
    if (!RO || !el.viewport) return null;
    const ro = new RO(() => onResize());
    ro.observe(el.viewport);
    return ro;
  }

  let resizeObserver = null;

  function attach() {
    if (!el.viewport) return;
    resizeObserver = observeElement();
    el.viewport.addEventListener('pointerdown', onPointerDown);
    el.viewport.addEventListener('pointermove', onPointerMove);
    el.viewport.addEventListener('pointerup', onPointerUp);
    el.viewport.addEventListener('pointercancel', onPointerCancel);
    el.viewport.addEventListener('lostpointercapture', onPointerCancel);
    if (win && win.addEventListener) {
      win.addEventListener('resize', onResize);
      if (win.visualViewport && win.visualViewport.addEventListener) {
        // Safari changes the usable height when its chrome shows or hides.
        win.visualViewport.addEventListener('resize', onResize);
      }
    }
  }

  function destroy() {
    clear();
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  }

  return {
    attach,
    destroy,
    showImage,
    showBlank,
    clear,
    setAnnotations,
    upsertAnnotation,
    removeAnnotation,
    getAnnotation,
    getAnnotationCount: () => annotations.size,
    armPlacement,
    disarmPlacement,
    isArmed: () => labelInteraction.isArmed(labelState),
    armArrow,
    disarmArrow,
    isArrowArmed: () => routeInteraction.isArmed(routeState),
    selectArrow,
    getSelectedArrow: () => routeInteraction.getSelected(routeState),
    armSketch,
    disarmSketch,
    activeSketchTool: () => sketchInteraction.activeTool(sketchState),
    selectSketch,
    getSelectedSketch: () => sketchInteraction.getSelected(sketchState),
    setSheet,
    focusOn,
    isGridVisible: () => showGrid,
    recordCreate,
    recordContent: (before) => undoStack.pushContent(undo, before),
    recordAnchor: (before) => undoStack.pushAnchor(undo, before),
    recordGeometry,
    recordDelete,
    planUndo,
    canUndo: () => undoStack.canUndo(undo),
    undoSize: () => undoStack.size(undo),
    // Temporary WM-6A diagnostics for physical-device testing.
    getScale: () => view.scale,
    getHeadTargetPx: () => ({ length: HEAD_LENGTH_PX, width: HEAD_WIDTH_PX }),
    getHeadStageLength: () => HEAD_LENGTH_PX / (view.scale > 0 ? view.scale : 1),
    renderLabels,
    hasImage: () => stageSize !== null,
    isPlaceholderVisible: () => !!(el.empty && !el.empty.hidden),
    fit,
    onResize,
    getViewport: () => ({ ...view }),
    getStageSize: () => (stageSize ? { ...stageSize } : null),
    getObjectUrl: () => objectUrl,
    getGestureMode: () => gesture.mode,
    getActivePointers: () => interaction.activeCount(gesture),
    // Exposed for the browser check; not used by the page itself. It rescales
    // too, so the hook mirrors the production zoom path exactly — otherwise
    // derived visuals (hit widths, arrowheads, handles) go stale and the
    // browser tests measure a state the app never actually reaches.
    _setViewport: function (v) { setViewport(v); rescaleLabels(); },
  };
}

module.exports = { createStageController };
