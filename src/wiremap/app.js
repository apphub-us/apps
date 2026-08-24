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
  /** Called by the controller; the page supplies the editor and persistence. */
  const hooks = {
    onPlaceRequested: opts.onPlaceRequested || null,   // (normalized) => void
    onEditRequested: opts.onEditRequested || null,     // (annotation) => void
    onMoved: opts.onMoved || null,                     // (annotation) => Promise
    onModeChange: opts.onModeChange || null,           // (armed) => void
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
    annotations = new Map();
    if (el.labels) { while (el.labels.firstChild) el.labels.removeChild(el.labels.firstChild); }
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

  /** Redraw every label. Cheap at MVP scale and keeps state in one place. */
  function renderLabels() {
    if (!el.labels || !stageSize) return;
    while (el.labels.firstChild) el.labels.removeChild(el.labels.firstChild);
    annotations.forEach((a) => el.labels.appendChild(renderLabel(a)));
  }

  /** Keep label bodies a constant screen size as the plan zooms. */
  function rescaleLabels() {
    if (!el.labels || !stageSize) return;
    const inverse = labelInteraction.labelCounterScale(view.scale);
    const nodes = el.labels.childNodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const id = node.getAttribute && node.getAttribute('data-annotation-id');
      const a = id && annotations.get(id);
      if (!a) continue;
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

  // ── Pointer handling ────────────────────────────────────────────────
  // Pointer Events only. No parallel mouse and touch paths.

  function localPoint(e) {
    const r = el.viewport.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** The annotation id under this event, if the press landed on a label. */
  function labelIdFrom(target) {
    let node = target;
    while (node && node !== el.viewport) {
      if (node.getAttribute && node.getAttribute('data-annotation-id')) {
        return node.getAttribute('data-annotation-id');
      }
      node = node.parentNode;
    }
    return null;
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
    labelInteraction.noteInput(labelState, type, point, nowMs());

    lastViewSize = viewSize();

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

    if (el.viewport.setPointerCapture) {
      try { el.viewport.setPointerCapture(e.pointerId); } catch (_) { /* already captured */ }
    }
    interaction.pointerDown(gesture, localPoint(e), view);
  }

  function onPointerMove(e) {
    if (!stageSize) return;

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

  function onPointerCancel() {
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
    clear,
    setAnnotations,
    upsertAnnotation,
    removeAnnotation,
    getAnnotation,
    getAnnotationCount: () => annotations.size,
    armPlacement,
    disarmPlacement,
    isArmed: () => labelInteraction.isArmed(labelState),
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
    // Exposed for the browser check; not used by the page itself.
    _setViewport: setViewport,
  };
}

module.exports = { createStageController };
