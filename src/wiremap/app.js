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
  };

  /** Logical stage size, always the stored image's displayed dimensions. */
  let stageSize = null;
  let view = viewportMath.identity();
  let objectUrl = null;
  let gesture = interaction.createGestureState();
  let lastViewSize = null;

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

  // ── Pointer handling ────────────────────────────────────────────────
  // Pointer Events only. No parallel mouse and touch paths.

  function localPoint(e) {
    const r = el.viewport.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    if (!stageSize) return;
    lastViewSize = viewSize();
    if (el.viewport.setPointerCapture) {
      try { el.viewport.setPointerCapture(e.pointerId); } catch (_) { /* already captured */ }
    }
    interaction.pointerDown(gesture, localPoint(e), view);
  }

  function onPointerMove(e) {
    if (!stageSize || interaction.activeCount(gesture) === 0) return;
    const r = interaction.pointerMove(gesture, localPoint(e), view, bounds());
    if (r.changed) setViewport(r.viewport);
  }

  function onPointerUp(e) {
    if (!stageSize) return;
    interaction.pointerUp(gesture, e.pointerId, view);
    if (el.viewport.releasePointerCapture) {
      try { el.viewport.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }
    }
    // Nothing else happens on release. A tap must never change the transform:
    // iOS synthesises a second pointer pair after a touch tap, so any tap
    // gesture here fires twice for one finger. See interaction.js.
  }

  function onPointerCancel() {
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
