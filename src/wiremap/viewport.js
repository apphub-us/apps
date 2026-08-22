'use strict';
/**
 * Wire Map — viewport transform.
 *
 * ONE transform drives the whole stage. The background image and the SVG
 * overlay are both children of that stage and share this single
 * { scale, translateX, translateY }. Two independent transforms would let the
 * plan and its annotations drift apart under zoom — the defect this module
 * exists to prevent.
 *
 * Pure maths. No DOM, no gestures; those arrive in WM-4.
 */

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
/**
 * How much of the stage may leave the viewport, as a fraction of viewport size.
 * A little overscroll is useful for reaching a label near the edge; unlimited
 * panning loses the plan off-screen entirely.
 */
const OVERSCROLL = 0.25;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidSize(size) {
  return !!size && isFiniteNumber(size.width) && isFiniteNumber(size.height)
    && size.width > 0 && size.height > 0;
}

function isValidViewport(v) {
  return !!v && isFiniteNumber(v.scale) && isFiniteNumber(v.translateX)
    && isFiniteNumber(v.translateY) && v.scale > 0;
}

/** Neutral transform: no zoom, no pan. */
function identity() {
  return { scale: 1, translateX: 0, translateY: 0 };
}

function clampScale(scale) {
  if (!isFiniteNumber(scale)) return 1;
  if (scale < MIN_SCALE) return MIN_SCALE;
  if (scale > MAX_SCALE) return MAX_SCALE;
  return scale;
}

/**
 * Screen (viewport) coordinates -> stage coordinates.
 * Inverse of stageToScreen; the two must always round-trip.
 */
function screenToStage(point, viewport) {
  if (!isValidViewport(viewport) || !point
    || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;
  return {
    x: (point.x - viewport.translateX) / viewport.scale,
    y: (point.y - viewport.translateY) / viewport.scale,
  };
}

/** Stage coordinates -> screen (viewport) coordinates. */
function stageToScreen(point, viewport) {
  if (!isValidViewport(viewport) || !point
    || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;
  return {
    x: point.x * viewport.scale + viewport.translateX,
    y: point.y * viewport.scale + viewport.translateY,
  };
}

/**
 * Keep the stage roughly within view.
 *
 * When the scaled stage is smaller than the viewport it is centred, because
 * letting a small plan drift into a corner reads as a bug. When it is larger,
 * translation is limited so at most OVERSCROLL of the viewport can show empty
 * space on any side.
 */
function clampTranslation(viewport, stageSize, viewSize) {
  if (!isValidViewport(viewport) || !isValidSize(stageSize) || !isValidSize(viewSize)) {
    return viewport && isValidViewport(viewport) ? { ...viewport } : identity();
  }
  const scaledW = stageSize.width * viewport.scale;
  const scaledH = stageSize.height * viewport.scale;
  const slackX = viewSize.width * OVERSCROLL;
  const slackY = viewSize.height * OVERSCROLL;

  let tx;
  if (scaledW <= viewSize.width) {
    tx = (viewSize.width - scaledW) / 2;
  } else {
    const min = viewSize.width - scaledW - slackX;
    const max = slackX;
    tx = Math.min(max, Math.max(min, viewport.translateX));
  }

  let ty;
  if (scaledH <= viewSize.height) {
    ty = (viewSize.height - scaledH) / 2;
  } else {
    const min = viewSize.height - scaledH - slackY;
    const max = slackY;
    ty = Math.min(max, Math.max(min, viewport.translateY));
  }

  return { scale: viewport.scale, translateX: tx, translateY: ty };
}

/**
 * Zoom about a focal point.
 *
 * The stage point under the focus must stay under the focus afterwards. Without
 * this the plan lurches away from the fingers during a pinch, which is the
 * single most noticeable flaw in a hand-rolled zoom.
 *
 * Returns an unclamped translation; apply clampTranslation() separately so the
 * caller decides when bounds matter.
 */
function zoomAt(viewport, focalScreenPoint, nextScaleRaw) {
  if (!isValidViewport(viewport)) return identity();
  const focal = focalScreenPoint || { x: 0, y: 0 };
  if (!isFiniteNumber(focal.x) || !isFiniteNumber(focal.y)) return { ...viewport };

  const nextScale = clampScale(nextScaleRaw);
  // The stage point currently beneath the focus.
  const stagePoint = screenToStage(focal, viewport);
  if (!stagePoint) return { ...viewport };

  // Re-anchor so that point lands under the focus again at the new scale.
  return {
    scale: nextScale,
    translateX: focal.x - stagePoint.x * nextScale,
    translateY: focal.y - stagePoint.y * nextScale,
  };
}

/** Multiply the current scale, keeping the focal point fixed. */
function zoomBy(viewport, focalScreenPoint, factor) {
  if (!isValidViewport(viewport) || !isFiniteNumber(factor) || factor <= 0) {
    return isValidViewport(viewport) ? { ...viewport } : identity();
  }
  return zoomAt(viewport, focalScreenPoint, viewport.scale * factor);
}

/**
 * The smallest scale the user may zoom out to on THIS sheet.
 *
 * MIN_SCALE alone is not usable as a floor. A 2000x1500 plan needs about 0.195
 * to fit a 390x700 phone, well under MIN_SCALE, so clamping the fit at 0.5
 * would leave most of the plan off-screen and make "fit" a lie. The floor is
 * therefore whichever is smaller: the nominal minimum, or the scale that shows
 * the whole sheet. MIN_SCALE still stops the user shrinking a small sheet into
 * a useless speck.
 */
function minScaleFor(stageSize, viewSize) {
  if (!isValidSize(stageSize) || !isValidSize(viewSize)) return MIN_SCALE;
  const fit = Math.min(viewSize.width / stageSize.width, viewSize.height / stageSize.height);
  return Math.min(MIN_SCALE, fit);
}

/** Clamp a scale against the floor appropriate to this sheet and viewport. */
function clampScaleFor(scale, stageSize, viewSize) {
  if (!isFiniteNumber(scale)) return 1;
  const min = minScaleFor(stageSize, viewSize);
  if (scale < min) return min;
  if (scale > MAX_SCALE) return MAX_SCALE;
  return scale;
}

/**
 * Scale and centre the stage so the WHOLE sheet is visible.
 * Deliberately not clamped by MIN_SCALE — see minScaleFor().
 */
function fitToViewport(stageSize, viewSize) {
  if (!isValidSize(stageSize) || !isValidSize(viewSize)) return identity();
  const scale = Math.min(MAX_SCALE, Math.min(
    viewSize.width / stageSize.width,
    viewSize.height / stageSize.height,
  ));
  return {
    scale,
    translateX: (viewSize.width - stageSize.width * scale) / 2,
    translateY: (viewSize.height - stageSize.height * scale) / 2,
  };
}

/**
 * Centre the viewport on a normalized point of the sheet — the movement WM-7
 * needs after a search hit. Scale is preserved unless one is supplied.
 */
function centerOnNormalized(normalizedPoint, stageSize, viewSize, viewport, nextScale) {
  if (!isValidSize(stageSize) || !isValidSize(viewSize)) return identity();
  const p = normalizedPoint || { x: 0.5, y: 0.5 };
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return identity();

  const base = isValidViewport(viewport) ? viewport : identity();
  const scale = clampScale(isFiniteNumber(nextScale) ? nextScale : base.scale);
  const stageX = p.x * stageSize.width;
  const stageY = p.y * stageSize.height;

  return clampTranslation({
    scale,
    translateX: viewSize.width / 2 - stageX * scale,
    translateY: viewSize.height / 2 - stageY * scale,
  }, stageSize, viewSize);
}

module.exports = {
  MIN_SCALE,
  MAX_SCALE,
  OVERSCROLL,
  identity,
  clampScale,
  minScaleFor,
  clampScaleFor,
  screenToStage,
  stageToScreen,
  clampTranslation,
  zoomAt,
  zoomBy,
  fitToViewport,
  centerOnNormalized,
};
