'use strict';
/**
 * Wire Map — normalized coordinate geometry.
 *
 * Annotations are stored relative to the sheet, as x and y in 0..1, never as
 * screen pixels. A label at { x: 0.42, y: 0.63 } sits on the same spot of the
 * plan whatever the zoom, the device or the orientation. Pixel positions would
 * move the moment the phone rotated.
 *
 * Pure functions only. No DOM.
 */

/** Sheet dimensions must be positive to define an aspect ratio. */
function isValidSize(size) {
  return !!size && typeof size === 'object'
    && typeof size.width === 'number' && Number.isFinite(size.width) && size.width > 0
    && typeof size.height === 'number' && Number.isFinite(size.height) && size.height > 0;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Force a scalar into the 0..1 range. Non-finite input collapses to 0. */
function clampUnit(value) {
  return clamp(value, 0, 1);
}

/**
 * Force a point inside the sheet.
 *
 * A drag can travel past the edge of the plan; the position is clamped rather
 * than rejected, so the annotation lands on the border instead of vanishing.
 */
function clampNormalized(point) {
  const p = point || {};
  return { x: clampUnit(p.x), y: clampUnit(p.y) };
}

/**
 * Pixel position on the sheet -> normalized.
 * @param {{x:number,y:number}} pixel position in sheet pixels
 * @param {{width:number,height:number}} size sheet dimensions
 */
function normalizePoint(pixel, size) {
  if (!isValidSize(size)) return null;
  const p = pixel || {};
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return clampNormalized({ x: p.x / size.width, y: p.y / size.height });
}

/** Normalized -> pixel position on the sheet. */
function denormalizePoint(point, size) {
  if (!isValidSize(size)) return null;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const c = clampNormalized(point);
  return { x: c.x * size.width, y: c.y * size.height };
}

/** Both endpoints of a two-point shape, clamped. */
function clampSegment(segment) {
  const s = segment || {};
  return { a: clampNormalized(s.a), b: clampNormalized(s.b) };
}

/**
 * Axis-aligned bounds of a two-point shape, in normalized units.
 * Endpoints may be given in any order; the result is always normalised so that
 * x1 <= x2 and y1 <= y2.
 */
function segmentBounds(segment) {
  const s = clampSegment(segment);
  return {
    x1: Math.min(s.a.x, s.b.x),
    y1: Math.min(s.a.y, s.b.y),
    x2: Math.max(s.a.x, s.b.x),
    y2: Math.max(s.a.y, s.b.y),
  };
}

/** Whether a normalized point lies inside the sheet, inclusive of the edge. */
function isInsideSheet(point) {
  return !!point
    && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

/**
 * Distance between two normalized points, corrected for the sheet's aspect
 * ratio. Normalized space is not square: on a 2000x1000 sheet a step of 0.1 in
 * x covers twice the ground of 0.1 in y. Hit testing must account for that.
 */
function distanceOnSheet(a, b, size) {
  if (!isValidSize(size)) return null;
  if (!a || !b) return null;
  const dx = (a.x - b.x) * size.width;
  const dy = (a.y - b.y) * size.height;
  return Math.sqrt(dx * dx + dy * dy);
}

module.exports = {
  isValidSize,
  clamp,
  clampUnit,
  clampNormalized,
  normalizePoint,
  denormalizePoint,
  clampSegment,
  segmentBounds,
  isInsideSheet,
  distanceOnSheet,
};
