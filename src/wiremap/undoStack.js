'use strict';
/**
 * Wire Map — sketch undo history (WM-6B1).
 *
 * Pure. No DOM, no IndexedDB. Records the INVERSE of each completed sketch
 * mutation; the controller performs the persistence.
 *
 * Deliberately narrow. WM-6B1 undoes sketch shapes only — not labels, arrows,
 * image import, viewport changes or sheet lifecycle. Widening it later means
 * pushing more entry kinds, not rewriting this.
 *
 * There is no redo.
 */

/** How many completed sketch operations are remembered. */
const MAX_ENTRIES = 20;

/** Kinds of mutation this stack can reverse. */
const KINDS = ['create', 'geometry', 'delete', 'content', 'anchor'];

function createUndoStack(options) {
  const limit = (options && Number.isFinite(options.limit) && options.limit > 0)
    ? options.limit : MAX_ENTRIES;
  return { entries: [], limit, sheetId: null };
}

/**
 * Bind the stack to a sheet, clearing it if the sheet changed.
 *
 * History is per sheet and never persisted: undoing onto a sheet you are no
 * longer looking at would be worse than not undoing at all.
 */
function bindSheet(stack, sheetId) {
  if (stack.sheetId !== sheetId) {
    stack.entries = [];
    stack.sheetId = sheetId || null;
  }
  return stack;
}

function reset(stack) {
  stack.entries = [];
  return stack;
}

function size(stack) {
  return stack.entries.length;
}

function canUndo(stack) {
  return stack.entries.length > 0;
}

function push(stack, entry) {
  if (!entry || KINDS.indexOf(entry.kind) === -1 || !entry.annotationId) return stack;
  stack.entries.push(entry);
  // Oldest first out. A bounded stack keeps memory predictable on a phone.
  while (stack.entries.length > stack.limit) stack.entries.shift();
  return stack;
}

/** A shape was created: undoing removes it. */
function pushCreate(stack, annotation) {
  if (!annotation || !annotation.id) return stack;
  return push(stack, { kind: 'create', annotationId: annotation.id, sheetId: annotation.sheetId });
}

/** Geometry changed: undoing restores the snapshot taken BEFORE the change. */
function pushGeometry(stack, annotationBefore) {
  if (!annotationBefore || !annotationBefore.id) return stack;
  return push(stack, {
    kind: 'geometry',
    annotationId: annotationBefore.id,
    sheetId: annotationBefore.sheetId,
    // Deep enough: only a and b can change here.
    before: { a: { ...annotationBefore.a }, b: { ...annotationBefore.b } },
  });
}

/** Text content changed: undoing restores the previous string. */
function pushContent(stack, annotationBefore) {
  if (!annotationBefore || !annotationBefore.id) return stack;
  return push(stack, {
    kind: 'content',
    annotationId: annotationBefore.id,
    sheetId: annotationBefore.sheetId,
    before: { text: (annotationBefore.data || {}).text },
  });
}

/** Text moved: undoing restores the previous normalized anchor. */
function pushAnchor(stack, annotationBefore) {
  if (!annotationBefore || !annotationBefore.id || !annotationBefore.at) return stack;
  return push(stack, {
    kind: 'anchor',
    annotationId: annotationBefore.id,
    sheetId: annotationBefore.sheetId,
    before: { at: { ...annotationBefore.at } },
  });
}

/**
 * A shape was deleted: undoing restores the whole record, id included, so the
 * same annotation comes back rather than a copy under a new id.
 */
function pushDelete(stack, annotation) {
  if (!annotation || !annotation.id) return stack;
  return push(stack, {
    kind: 'delete',
    annotationId: annotation.id,
    sheetId: annotation.sheetId,
    snapshot: JSON.parse(JSON.stringify(annotation)),
  });
}

/**
 * Take the most recent entry and describe the work needed to reverse it.
 * The caller applies it to the store and the stage.
 *
 * @returns {{action:'remove'|'restore'|'none', annotationId, annotation}}
 */
function undo(stack, lookup) {
  const entry = stack.entries.pop();
  if (!entry) return { action: 'none', annotationId: null, annotation: null };

  if (entry.kind === 'create') {
    return { action: 'remove', annotationId: entry.annotationId, annotation: null };
  }

  if (entry.kind === 'delete') {
    return { action: 'restore', annotationId: entry.annotationId, annotation: entry.snapshot };
  }

  // geometry / content / anchor: rebuild the current record with the old value.
  const current = typeof lookup === 'function' ? lookup(entry.annotationId) : null;
  if (!current) {
    // The shape is gone; there is nothing to restore. Fail quietly rather than
    // inventing a record and corrupting the sheet.
    return { action: 'none', annotationId: entry.annotationId, annotation: null };
  }
  let restored;
  if (entry.kind === 'content') {
    restored = { ...current, data: { ...(current.data || {}), text: entry.before.text } };
  } else if (entry.kind === 'anchor') {
    restored = { ...current, at: { ...entry.before.at } };
  } else {
    restored = { ...current, a: { ...entry.before.a }, b: { ...entry.before.b } };
  }
  return { action: 'restore', annotationId: entry.annotationId, annotation: restored };
}

/** Inspect the next entry without consuming it. */
function peek(stack) {
  return stack.entries.length ? stack.entries[stack.entries.length - 1] : null;
}

module.exports = {
  MAX_ENTRIES,
  KINDS,
  createUndoStack,
  bindSheet,
  reset,
  size,
  canUndo,
  push,
  pushCreate,
  pushGeometry,
  pushDelete,
  pushContent,
  pushAnchor,
  undo,
  peek,
};
