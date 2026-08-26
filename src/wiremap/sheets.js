'use strict';
/**
 * Wire Map — sheet manager logic (WM-8).
 *
 * Pure. No DOM, no IndexedDB.
 *
 * Owns the decisions the Sheets Manager has to get right — what a valid sheet
 * name is, what order the sheets are in after a move or a delete, and which
 * sheet becomes current when the open one is removed. The controller does the
 * store work; nothing here knows how sheets are stored.
 */

/** Names are short labels on a phone screen, not descriptions. */
const MAX_NAME_LENGTH = 80;

/** A job must always keep at least one sheet in WM-8. */
const MIN_SHEETS = 1;

function asText(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Normalize a sheet name for storage.
 * @returns {string|null} null when nothing usable remains.
 */
function normalizeName(raw) {
  const trimmed = asText(raw).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

function isValidName(raw) {
  return normalizeName(raw) !== null;
}

/**
 * Sort by stored order, then id, and renumber to 0..n-1.
 *
 * Compact integers keep the list deterministic and make move-up/move-down a
 * swap rather than fractional arithmetic. Ties break on id so a store that has
 * somehow ended up with duplicate order values still produces one stable
 * answer rather than a different one each read.
 */
function normalizeOrder(sheets) {
  return (sheets || [])
    .filter((s) => s && s.id)
    .slice()
    .sort((a, b) => {
      const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
      return (ao - bo) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    })
    .map((s, i) => ({ ...s, order: i }));
}

function indexOfSheet(sheets, sheetId) {
  for (let i = 0; i < sheets.length; i++) if (sheets[i].id === sheetId) return i;
  return -1;
}

function canMoveUp(sheets, sheetId) {
  return indexOfSheet(normalizeOrder(sheets), sheetId) > 0;
}

function canMoveDown(sheets, sheetId) {
  const ordered = normalizeOrder(sheets);
  const i = indexOfSheet(ordered, sheetId);
  return i >= 0 && i < ordered.length - 1;
}

/**
 * Swap a sheet with its neighbour.
 * Returns a fresh normalized list; the input is never mutated.
 */
function move(sheets, sheetId, delta) {
  const ordered = normalizeOrder(sheets);
  const i = indexOfSheet(ordered, sheetId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ordered.length) return ordered;
  const next = ordered.slice();
  const tmp = next[i];
  next[i] = next[j];
  next[j] = tmp;
  return next.map((s, k) => ({ ...s, order: k }));
}

function moveUp(sheets, sheetId) { return move(sheets, sheetId, -1); }
function moveDown(sheets, sheetId) { return move(sheets, sheetId, 1); }

/** The order value a newly added sheet should take: last. */
function nextOrder(sheets) {
  return normalizeOrder(sheets).length;
}

/** Whether the job can afford to lose this sheet. */
function canDelete(sheets) {
  return normalizeOrder(sheets).length > MIN_SHEETS;
}

/**
 * Which sheet should become current after deleting one.
 *
 * Prefer the next sheet, fall back to the previous. Deleting a sheet the user
 * is not looking at must not move them, so that case returns the current id
 * unchanged.
 *
 * @returns {{allowed:boolean, reason?:string, nextCurrentId:string|null, remaining:Array}}
 */
function planDelete(sheets, sheetId, currentSheetId) {
  const ordered = normalizeOrder(sheets);
  const i = indexOfSheet(ordered, sheetId);
  if (i < 0) {
    return { allowed: false, reason: 'Sheet not found.', nextCurrentId: currentSheetId, remaining: ordered };
  }
  if (ordered.length <= MIN_SHEETS) {
    return { allowed: false, reason: 'At least one Sheet is required.',
      nextCurrentId: currentSheetId, remaining: ordered };
  }
  const remaining = ordered.filter((s) => s.id !== sheetId).map((s, k) => ({ ...s, order: k }));
  if (sheetId !== currentSheetId) {
    return { allowed: true, nextCurrentId: currentSheetId, remaining };
  }
  const successor = ordered[i + 1] || ordered[i - 1];
  return { allowed: true, nextCurrentId: successor ? successor.id : null, remaining };
}

/** Human label for a sheet kind, for the list row. */
function kindLabel(kind) {
  if (kind === 'blank') return 'Blank';
  if (kind === 'photo') return 'Photo';
  if (kind === 'image') return 'Image';
  return asText(kind) || 'Sheet';
}

/**
 * Apply a rename without mutating the original.
 * Returns null when the name is invalid or unchanged — the caller then knows
 * to skip the store write entirely.
 */
function renamed(sheet, raw, now) {
  if (!sheet) return null;
  const name = normalizeName(raw);
  if (!name || name === sheet.name) return null;
  return { ...sheet, name, updatedAt: Number.isFinite(now) ? now : sheet.updatedAt };
}

module.exports = {
  MAX_NAME_LENGTH,
  MIN_SHEETS,
  normalizeName,
  isValidName,
  normalizeOrder,
  indexOfSheet,
  canMoveUp,
  canMoveDown,
  moveUp,
  moveDown,
  nextOrder,
  canDelete,
  planDelete,
  kindLabel,
  renamed,
};
