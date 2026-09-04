'use strict';
/**
 * Wire Map — data model.
 *
 * Pure functions only: no DOM, no browser APIs, no IndexedDB, no globals.
 * Persistence arrives in WM-2 and will consume these shapes unchanged.
 *
 * Every entity carries `id`, `createdAt` and `updatedAt`. Timestamps are
 * supplied by the caller rather than read from the clock here, so the module
 * stays deterministic and testable.
 */

const SHEET_KINDS = ['photo', 'image', 'blank'];
const ANNOTATION_TYPES = ['wireLabel', 'arrow', 'line', 'rect', 'text', 'symbol'];

/** Annotation types positioned by a single normalized point. */
const POINT_TYPES = ['wireLabel', 'text', 'symbol'];

/**
 * A symbolKey is a library identifier such as 'outlet.duplex' — never markup,
 * never geometry. The model does NOT pin the set of known keys: the renderer
 * and the symbol library decide what a key currently means, so the library
 * can grow without a model (or schema) change. 64 chars is far beyond any
 * sane dotted identifier.
 */
const MAX_SYMBOL_KEY_LENGTH = 64;
/** Annotation types defined by two normalized endpoints, never length+angle. */
const TWO_POINT_TYPES = ['arrow', 'line', 'rect'];

/**
 * Search key for a wire label.
 *
 * Field labels are written inconsistently on site — "HR-07", "hr 07", " HR‑07 ".
 * The key collapses those to one comparable form. Search itself lands in WM-7;
 * this only guarantees the key is stored predictably from the start.
 *
 * Lowercased, trimmed, internal whitespace collapsed to a single hyphen, and
 * runs of hyphens reduced to one. Non-string input yields ''.
 */
function toLabelKey(label) {
  if (typeof label !== 'string') return '';
  return label
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A normalized coordinate must be a finite number within the sheet. */
function isNormalizedUnit(v) {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

function isNormalizedPoint(p) {
  return !!p && typeof p === 'object'
    && isNormalizedUnit(p.x) && isNormalizedUnit(p.y);
}

function isTimestamp(v) {
  return isFiniteNumber(v) && v >= 0;
}

/** Shared envelope checks for every entity. */
function baseProblems(entity, kind) {
  const problems = [];
  if (!entity || typeof entity !== 'object') return [`${kind} must be an object`];
  if (!isNonEmptyString(entity.id)) problems.push('id must be a non-empty string');
  if (!isTimestamp(entity.createdAt)) problems.push('createdAt must be a non-negative number');
  if (!isTimestamp(entity.updatedAt)) problems.push('updatedAt must be a non-negative number');
  return problems;
}

// ── Job ───────────────────────────────────────────────────────────────────

function validateJob(job) {
  const problems = baseProblems(job, 'job');
  if (problems.length === 1 && problems[0].startsWith('job must be')) {
    return { valid: false, problems };
  }
  if (!isNonEmptyString(job.name)) problems.push('name must be a non-empty string');
  // An address is optional — a job can be logged before the address is known —
  // but if present it must be a string rather than a stray object.
  if (job.address !== undefined && job.address !== null && typeof job.address !== 'string') {
    problems.push('address must be a string when present');
  }
  return { valid: problems.length === 0, problems };
}

function createJob(input) {
  const now = isTimestamp(input && input.now) ? input.now : 0;
  return {
    id: (input && input.id) || '',
    name: (input && input.name) || '',
    address: (input && input.address) || '',
    createdAt: now,
    updatedAt: now,
  };
}

// ── Sheet ─────────────────────────────────────────────────────────────────

function validateSheet(sheet) {
  const problems = baseProblems(sheet, 'sheet');
  if (problems.length === 1 && problems[0].startsWith('sheet must be')) {
    return { valid: false, problems };
  }
  if (!isNonEmptyString(sheet.jobId)) problems.push('jobId must be a non-empty string');
  if (!isNonEmptyString(sheet.name)) problems.push('name must be a non-empty string');
  if (SHEET_KINDS.indexOf(sheet.kind) === -1) {
    problems.push(`kind must be one of: ${SHEET_KINDS.join(', ')}`);
  }
  // A blank sheet has no image; photo and image sheets must reference one.
  if (sheet.kind === 'blank') {
    if (sheet.imageId !== null && sheet.imageId !== undefined && sheet.imageId !== '') {
      problems.push('a blank sheet must not reference an image');
    }
  } else if (!isNonEmptyString(sheet.imageId)) {
    problems.push(`a ${sheet.kind} sheet requires an imageId`);
  }
  // Dimensions define the aspect ratio that normalized coordinates map onto,
  // so they are required even for a blank sheet.
  if (!isFiniteNumber(sheet.width) || sheet.width <= 0) problems.push('width must be a positive number');
  if (!isFiniteNumber(sheet.height) || sheet.height <= 0) problems.push('height must be a positive number');
  if (!Number.isInteger(sheet.order) || sheet.order < 0) problems.push('order must be a non-negative integer');
  return { valid: problems.length === 0, problems };
}

function createSheet(input) {
  const i = input || {};
  const now = isTimestamp(i.now) ? i.now : 0;
  const kind = i.kind || 'blank';
  return {
    id: i.id || '',
    jobId: i.jobId || '',
    name: i.name || '',
    kind,
    imageId: kind === 'blank' ? null : (i.imageId || ''),
    width: isFiniteNumber(i.width) ? i.width : 0,
    height: isFiniteNumber(i.height) ? i.height : 0,
    order: Number.isInteger(i.order) ? i.order : 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Annotation ────────────────────────────────────────────────────────────

/**
 * Wire-label payload. `labelKey` is derived, never entered by hand — deriving
 * it here is what keeps the future search index consistent.
 */
function createWireLabelData(input) {
  const i = input || {};
  return {
    label: typeof i.label === 'string' ? i.label : '',
    labelKey: toLabelKey(i.label),
    from: typeof i.from === 'string' ? i.from : '',
    to: typeof i.to === 'string' ? i.to : '',
    cable: typeof i.cable === 'string' ? i.cable : '',
    room: typeof i.room === 'string' ? i.room : '',
    notes: typeof i.notes === 'string' ? i.notes : '',
  };
}

function validateWireLabelData(data) {
  const problems = [];
  if (!data || typeof data !== 'object') return ['wireLabel data must be an object'];
  if (!isNonEmptyString(data.label)) problems.push('label must be a non-empty string');
  for (const f of ['from', 'to', 'cable', 'room', 'notes']) {
    if (data[f] !== undefined && typeof data[f] !== 'string') {
      problems.push(`${f} must be a string when present`);
    }
  }
  // The key must match the label it was derived from, or the search index and
  // the visible text will disagree.
  if (data.labelKey !== toLabelKey(data.label)) {
    problems.push('labelKey must be derived from label via toLabelKey()');
  }
  return problems;
}

function validateAnnotation(annotation) {
  const problems = baseProblems(annotation, 'annotation');
  if (problems.length === 1 && problems[0].startsWith('annotation must be')) {
    return { valid: false, problems };
  }
  if (!isNonEmptyString(annotation.sheetId)) problems.push('sheetId must be a non-empty string');

  const type = annotation.type;
  if (ANNOTATION_TYPES.indexOf(type) === -1) {
    problems.push(`type must be one of: ${ANNOTATION_TYPES.join(', ')}`);
    return { valid: false, problems };
  }

  if (POINT_TYPES.indexOf(type) !== -1) {
    if (!isNormalizedPoint(annotation.at)) {
      problems.push('at must be a normalized point with x and y in 0..1');
    }
  } else if (TWO_POINT_TYPES.indexOf(type) !== -1) {
    // Two endpoints, not length and angle: an angle would need recomputing
    // whenever the sheet aspect ratio changes.
    if (!isNormalizedPoint(annotation.a)) problems.push('a must be a normalized point');
    if (!isNormalizedPoint(annotation.b)) problems.push('b must be a normalized point');
  }

  if (type === 'wireLabel') {
    problems.push(...validateWireLabelData(annotation.data));
  }
  if (type === 'text' && !isNonEmptyString(annotation.data && annotation.data.text)) {
    problems.push('text annotations require data.text');
  }
  if (type === 'symbol') {
    const key = annotation.data && annotation.data.symbolKey;
    if (typeof key !== 'string' || key.trim().length === 0) {
      problems.push('symbol annotations require a non-empty data.symbolKey string');
    } else if (key !== key.trim()) {
      problems.push('symbolKey must be trimmed');
    } else if (key.length > MAX_SYMBOL_KEY_LENGTH) {
      problems.push(`symbolKey must be at most ${MAX_SYMBOL_KEY_LENGTH} characters`);
    }
  }

  return { valid: problems.length === 0, problems };
}

function createAnnotation(input) {
  const i = input || {};
  const now = isTimestamp(i.now) ? i.now : 0;
  const type = i.type || 'wireLabel';
  const a = {
    id: i.id || '',
    sheetId: i.sheetId || '',
    type,
    createdAt: now,
    updatedAt: now,
  };
  if (POINT_TYPES.indexOf(type) !== -1) {
    a.at = i.at || { x: 0, y: 0 };
  } else if (TWO_POINT_TYPES.indexOf(type) !== -1) {
    a.a = i.a || { x: 0, y: 0 };
    a.b = i.b || { x: 0, y: 0 };
  }
  if (type === 'wireLabel') {
    a.data = createWireLabelData(i.data);
  } else if (type === 'symbol') {
    // Persist ONLY the identity + anchor: no SVG, no icon paths, no screen px.
    const raw = i.data && typeof i.data.symbolKey === 'string' ? i.data.symbolKey : '';
    a.data = { symbolKey: raw.trim() };
  } else {
    a.data = i.data || {};
  }
  return a;
}

// ── Wire Map V2 — Point + Connection (V2-0 storage foundation) ────────────
//
// A POINT is a physical electrical location — a panel, a box, a fixture, a
// device — anchored on one sheet by ONE normalized coordinate. A CONNECTION is
// one real cable/run between two Points, owned by the job (never by a sheet)
// so a cable may cross plans. Neither carries any visual geometry: rendering
// is derived. These are model contracts only in V2-0; no UI reads them.
//
// Naming: the legacy `POINT_TYPES` above means "single-anchor annotation
// types" and is untouched. The V2 electrical vocabulary is prefixed with
// ELECTRICAL_ to make the two impossible to confuse.

/** The approved MVP taxonomy. Gang Box is ONE type with composition. */
const ELECTRICAL_POINT_TYPES = [
  'panel', 'junctionBox', 'gangBox',
  'light.ceiling', 'light.recessed', 'sconce',
  'device.smoke', 'device.thermostat', 'disconnect',
];
/** What may sit in one gang slot. Order in `slots` is left -> right. */
const GANG_DEVICES = ['simplex', 'duplex', 'gfci', 'dedicated', 'switch1p', 'switch3w', 'switch4w', 'blank'];
const GANG_MIN = 1;
const GANG_MAX = 6;

/** Optional text: null, or a trimmed non-empty string. '' normalizes to null. */
function optionalText(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function createGang(input) {
  const i = input || {};
  const count = Number.isInteger(i.count) ? i.count : GANG_MIN;
  const slots = Array.isArray(i.slots) ? i.slots.map((s) => ({ device: (s && typeof s.device === 'string') ? s.device : 'blank' })) : [];
  // pad/trim to the count so a well-formed input round-trips and a sparse one
  // is still shaped; validation decides whether the result is acceptable
  while (slots.length < count) slots.push({ device: 'blank' });
  return { count, slots: slots.slice(0, count) };
}

function validateGang(gang, problems) {
  if (!gang || typeof gang !== 'object') { problems.push('gang must be an object for a gangBox'); return; }
  if (!Number.isInteger(gang.count) || gang.count < GANG_MIN || gang.count > GANG_MAX) {
    problems.push(`gang.count must be an integer ${GANG_MIN}..${GANG_MAX}`);
  }
  if (!Array.isArray(gang.slots)) { problems.push('gang.slots must be an array'); return; }
  if (Number.isInteger(gang.count) && gang.slots.length !== gang.count) {
    problems.push(`gang.slots must have exactly gang.count (${gang.count}) entries, got ${gang.slots.length}`);
  }
  gang.slots.forEach((slot, idx) => {
    if (!slot || typeof slot !== 'object' || GANG_DEVICES.indexOf(slot.device) === -1) {
      problems.push(`gang.slots[${idx}].device must be one of: ${GANG_DEVICES.join(', ')}`);
    }
  });
}

function validatePoint(point) {
  const problems = baseProblems(point, 'point');
  if (problems.length === 1 && problems[0].startsWith('point must be')) {
    return { valid: false, problems };
  }
  if (!isNonEmptyString(point.jobId)) problems.push('jobId must be a non-empty string');
  if (!isNonEmptyString(point.sheetId)) problems.push('sheetId must be a non-empty string');
  if (ELECTRICAL_POINT_TYPES.indexOf(point.type) === -1) {
    problems.push(`type must be one of: ${ELECTRICAL_POINT_TYPES.join(', ')}`);
  }
  if (point.name !== null && typeof point.name !== 'string') problems.push('name must be a string or null');
  if (!isNormalizedUnit(point.x)) problems.push('x must be a finite number in 0..1');
  if (!isNormalizedUnit(point.y)) problems.push('y must be a finite number in 0..1');
  if (point.type === 'gangBox') {
    validateGang(point.gang, problems);
  } else if (point.gang !== null && point.gang !== undefined) {
    problems.push('gang must be null for a non-gangBox point');
  }
  return { valid: problems.length === 0, problems };
}

/** Normalize a Point. `id` is the caller's opaque stable id; identity never derives from content. */
function createPoint(input) {
  const i = input || {};
  const now = isTimestamp(i.now) ? i.now : 0;
  const type = i.type || 'junctionBox';
  return {
    id: i.id || '',
    jobId: i.jobId || '',
    sheetId: i.sheetId || '',
    type,
    name: optionalText(i.name),
    x: isFiniteNumber(i.x) ? i.x : 0,
    y: isFiniteNumber(i.y) ? i.y : 0,
    gang: type === 'gangBox' ? createGang(i.gang) : null,
    createdAt: now,
    updatedAt: now,
  };
}

function validateConnection(connection) {
  const problems = baseProblems(connection, 'connection');
  if (problems.length === 1 && problems[0].startsWith('connection must be')) {
    return { valid: false, problems };
  }
  if (!isNonEmptyString(connection.jobId)) problems.push('jobId must be a non-empty string');
  if (!isNonEmptyString(connection.fromPointId)) problems.push('fromPointId must be a non-empty string');
  if (!isNonEmptyString(connection.toPointId)) problems.push('toPointId must be a non-empty string');
  if (isNonEmptyString(connection.fromPointId) && connection.fromPointId === connection.toPointId) {
    problems.push('a connection cannot join a point to itself');
  }
  if (connection.label !== null && typeof connection.label !== 'string') problems.push('label must be a string or null');
  // labelKey is DERIVED. A caller-supplied key that disagrees with the label is
  // rejected rather than trusted, exactly as for wire labels.
  if (connection.labelKey !== toLabelKey(connection.label === null ? '' : connection.label)) {
    problems.push('labelKey must be derived from label');
  }
  for (const f of ['cableType', 'circuit', 'notes']) {
    if (connection[f] !== null && typeof connection[f] !== 'string') problems.push(`${f} must be a string or null`);
  }
  return { valid: problems.length === 0, problems };
}

/** Normalize a Connection. Label is optional; an unlabeled cable has labelKey ''. */
function createConnection(input) {
  const i = input || {};
  const now = isTimestamp(i.now) ? i.now : 0;
  const label = optionalText(i.label);
  return {
    id: i.id || '',
    jobId: i.jobId || '',
    fromPointId: i.fromPointId || '',
    toPointId: i.toPointId || '',
    label,
    labelKey: toLabelKey(label === null ? '' : label),
    cableType: optionalText(i.cableType),
    circuit: optionalText(i.circuit),
    notes: optionalText(i.notes),
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = {
  SHEET_KINDS,
  ANNOTATION_TYPES,
  POINT_TYPES,
  ELECTRICAL_POINT_TYPES,
  GANG_DEVICES,
  GANG_MIN,
  GANG_MAX,
  createPoint,
  validatePoint,
  createConnection,
  validateConnection,
  MAX_SYMBOL_KEY_LENGTH,
  TWO_POINT_TYPES,
  toLabelKey,
  isNormalizedUnit,
  isNormalizedPoint,
  createJob,
  validateJob,
  createSheet,
  validateSheet,
  createWireLabelData,
  createAnnotation,
  validateAnnotation,
};
