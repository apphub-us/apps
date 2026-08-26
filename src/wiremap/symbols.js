'use strict';
/**
 * Wire Map — electrical symbol library (WM-9A).
 *
 * Pure. No DOM, no IndexedDB, no viewport state. Definitions only.
 *
 * ONE definition per symbol is the single source of truth: the plan renderer
 * and the picker preview both resolve the same entry, so what the electrician
 * sees on the card is exactly what lands on the plan.
 *
 * These are Empire Code library conventions drawn in simple, conventional
 * electrical-plan visual language. They are deliberately NOT labelled as any
 * standard's symbols — architectural symbol conventions vary by drawing
 * office and project.
 *
 * Geometry lives in a fixed 24×24 viewBox. A definition is a flat list of
 * primitives; every numeric field is a finite number and every text field is
 * a short fixed internal constant (never user data), applied by the renderer
 * through setAttribute/textContent only.
 *
 * Primitive shapes:
 *   { t: 'circle', cx, cy, r }
 *   { t: 'line',   x1, y1, x2, y2 }
 *   { t: 'rect',   x, y, w, h }
 *   { t: 'path',   d }                        — trusted internal constant
 *   { t: 'text',   x, y, size, text }         — fixed identifier letters
 */

/** Category display order — deterministic, matches the picker sections. */
const CATEGORIES = ['Outlets', 'Switches', 'Lighting', 'Devices'];

const VIEW_BOX = '0 0 24 24';

/**
 * The eleven WM-9A symbols, in their permanent display order.
 * Keys are dotted identifiers; expanding the library later means appending
 * here — no model or schema change. Keys already persisted in testing
 * (outlet.duplex, outlet.gfci, switch.single, switch.threeWay) keep their
 * identity — only their artwork may evolve.
 */
const SYMBOLS = [
  {
    key: 'outlet.simplex',
    category: 'Outlets',
    name: 'Simplex Receptacle',
    viewBox: VIEW_BOX,
    primitives: [
      { t: 'circle', cx: 12, cy: 12, r: 7 },
      { t: 'line', x1: 8.6, y1: 12, x2: 15.4, y2: 12 },
    ],
  },
  {
    key: 'outlet.duplex',
    category: 'Outlets',
    name: 'Duplex Receptacle',
    viewBox: VIEW_BOX,
    primitives: [
      { t: 'circle', cx: 12, cy: 12, r: 7 },
      { t: 'line', x1: 8.6, y1: 9.6, x2: 15.4, y2: 9.6 },
      { t: 'line', x1: 8.6, y1: 14.4, x2: 15.4, y2: 14.4 },
    ],
  },
  {
    key: 'outlet.gfci',
    category: 'Outlets',
    name: 'GFCI Receptacle',
    viewBox: VIEW_BOX,
    // ONLY a circle with GF inside — deliberately not a duplex variation, so
    // it reads at 24 px without the picker name.
    primitives: [
      { t: 'circle', cx: 12, cy: 12, r: 8 },
      { t: 'text', x: 12, y: 14.4, size: 6.8, text: 'GF' },
    ],
  },
  {
    key: 'outlet.dedicated',
    category: 'Outlets',
    name: 'Dedicated Receptacle',
    viewBox: VIEW_BOX,
    // ONLY a circle with D inside.
    primitives: [
      { t: 'circle', cx: 12, cy: 12, r: 8 },
      { t: 'text', x: 12, y: 15.1, size: 8.6, text: 'D' },
    ],
  },
  {
    key: 'switch.single',
    category: 'Switches',
    name: 'Single-Pole Switch',
    viewBox: VIEW_BOX,
    // The common S-family plan notation, drawn as our own glyph.
    primitives: [
      { t: 'text', x: 12, y: 17, size: 14.5, text: 'S' },
    ],
  },
  {
    key: 'switch.threeWay',
    category: 'Switches',
    name: '3-Way Switch',
    viewBox: VIEW_BOX,
    primitives: [
      { t: 'text', x: 8.8, y: 17.2, size: 14.5, text: 'S' },
      { t: 'text', x: 18, y: 19.9, size: 9.4, text: '3' },
    ],
  },
  {
    key: 'switch.fourWay',
    category: 'Switches',
    name: '4-Way Switch',
    viewBox: VIEW_BOX,
    primitives: [
      { t: 'text', x: 8.8, y: 17.2, size: 14.5, text: 'S' },
      { t: 'text', x: 18, y: 19.9, size: 9.4, text: '4' },
    ],
  },
  {
    key: 'light.ceiling',
    category: 'Lighting',
    name: 'Ceiling Light',
    viewBox: VIEW_BOX,
    primitives: [
      { t: 'circle', cx: 12, cy: 12, r: 6 },
      { t: 'line', x1: 16.6, y1: 7.4, x2: 19.4, y2: 4.6 },
      { t: 'line', x1: 7.4, y1: 7.4, x2: 4.6, y2: 4.6 },
      { t: 'line', x1: 16.6, y1: 16.6, x2: 19.4, y2: 19.4 },
      { t: 'line', x1: 7.4, y1: 16.6, x2: 4.6, y2: 19.4 },
    ],
  },
  {
    key: 'light.recessed',
    category: 'Lighting',
    name: 'Recessed Light',
    viewBox: VIEW_BOX,
    primitives: [
      { t: 'circle', cx: 12, cy: 12, r: 7.2 },
      { t: 'text', x: 12, y: 14.9, size: 8, text: 'R' },
    ],
  },
  {
    key: 'device.smoke',
    category: 'Devices',
    name: 'Smoke Detector',
    viewBox: VIEW_BOX,
    primitives: [
      { t: 'circle', cx: 12, cy: 12, r: 8 },
      { t: 'text', x: 12, y: 14.3, size: 6.4, text: 'SD' },
    ],
  },
  {
    key: 'device.thermostat',
    category: 'Devices',
    name: 'Thermostat',
    viewBox: VIEW_BOX,
    primitives: [
      { t: 'circle', cx: 12, cy: 12, r: 8 },
      { t: 'text', x: 12, y: 15.2, size: 9, text: 'T' },
    ],
  },
];

/**
 * The safe stand-in for a persisted symbolKey the library does not (or does
 * not YET) know. The annotation itself is preserved untouched — id, anchor,
 * selectability, deletability — so a plan written by a newer library never
 * loses data in an older one.
 */
const PLACEHOLDER = {
  key: '__unknown__',
  category: 'Devices',
  name: 'Unknown Symbol',
  viewBox: VIEW_BOX,
  primitives: [
    { t: 'circle', cx: 12, cy: 12, r: 8 },
    { t: 'text', x: 12, y: 15.4, size: 9, text: '?' },
  ],
};

const BY_KEY = new Map(SYMBOLS.map((s) => [s.key, s]));

/** Every symbol, in permanent display order. Returns a fresh array. */
function list() {
  return SYMBOLS.slice();
}

/** Category names in permanent display order. */
function categories() {
  return CATEGORIES.slice();
}

/** Symbols belonging to one category, in display order. */
function inCategory(category) {
  return SYMBOLS.filter((s) => s.category === category);
}

/**
 * Resolve a symbolKey to its definition, or null when unknown.
 * The caller decides how to handle null — the renderer substitutes
 * PLACEHOLDER; validation-time callers may reject.
 */
function get(key) {
  return BY_KEY.get(key) || null;
}

/** Whether the library currently knows this key. */
function isKnown(key) {
  return BY_KEY.has(key);
}

/**
 * The definition a renderer should draw for a persisted key: the real one
 * when known, the placeholder otherwise. Never null, never throws — an
 * unknown key must not take the sheet down.
 */
function forRender(key) {
  return BY_KEY.get(key) || PLACEHOLDER;
}

module.exports = {
  CATEGORIES,
  VIEW_BOX,
  SYMBOLS,
  PLACEHOLDER,
  list,
  categories,
  inCategory,
  get,
  isKnown,
  forRender,
};
