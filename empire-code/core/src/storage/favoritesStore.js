'use strict';
/**
 * EC-03 / EC-05 — Favorites (saved calculator presets) storage boundary.
 *
 * One localStorage value, key "sparky_favorites": a JSON object whose known
 * collections (vd, amp, cf, ww, lc) are arrays of { name, vals, id } rows. Any
 * other top-level key or row field is metadata this build does not interpret
 * and never drops.
 *
 * WHY THIS MODULE EXISTS
 * The previous code read with `try { JSON.parse(raw || '{}') } catch { {} }`
 * and wrote the result back. A truncated or wrong-shaped value was therefore
 * indistinguishable from "no presets yet", and the next Save silently replaced
 * recoverable bytes; a refused write (quota / security) threw with no message.
 *
 * RULES
 *  - read() is strict: absent (empty) is different from corrupt, unsupported
 *    and unavailable. Only `absent` and `ok` are writable states.
 *  - In every other state the stored bytes are left exactly as they are; add
 *    and remove refuse. Rows that are readable can still be listed and loaded.
 *  - A row is addressed by its id inside its own collection, compared strictly
 *    (the number 7 and the string "7" are two identities; the same id may be
 *    used in two different collections). Two rows of one collection with the
 *    same identity cannot be told apart, so such a store is `unsupported`
 *    (recovery): nothing is rewritten, neither row is listed, both stay in the
 *    stored value and in the raw export. A delete removes exactly one row.
 *  - Every mutation runs inside an exclusive Web Lock and, within it, does a
 *    fresh read + validation, applies the change to that fresh state (never to
 *    a copy read earlier), re-checks the raw value, writes inside try/catch and
 *    verifies the read-back. A localStorage compare-then-write on its own is
 *    not atomic across tabs, so without a lock manager mutations are refused
 *    (LOCK_UNAVAILABLE) rather than attempted unsafely. Reading and exporting
 *    never need the lock.
 *  - The lock only coordinates tabs that use it. A tab running an older version
 *    writes without it, so whatever is in storage after this module's single
 *    write is treated as possibly someone else's: when the read-back is not the
 *    value just written (or cannot be read) the result is VERIFY_FAILED and
 *    storage is NOT written again — there is no rollback to the earlier bytes.
 *  - exportBytes() returns the exact stored value for a Blob download and does
 *    not touch storage, so it works when the quota is exhausted.
 *  - reset() removes only this key, only with explicit confirmation, and only
 *    if the stored value is still the one the user was shown.
 *
 * Pure with respect to the browser: storage and the lock manager are injected.
 */
const KEY = 'sparky_favorites';
const LOCK_NAME = 'empire-code-favorites-v1';
const TYPES = Object.freeze(['vd', 'amp', 'cf', 'ww', 'lc']);

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (code, problem, extra) => Object.assign({ ok: false, code, problems: [problem] }, extra || {});
const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : 'a ' + typeof v);

function validRow(row) {
  return isObject(row)
    && own(row, 'id') && ((typeof row.id === 'number' && Number.isFinite(row.id)) || typeof row.id === 'string')
    && typeof row.name === 'string'
    && own(row, 'vals') && isObject(row.vals);
}

/**
 * Identities used by more than one readable row of ONE collection. A Set compares like `===` for every id
 * validRow() accepts (finite numbers and strings; 0 and -0 are the same id, 7 and "7" are not), which is
 * exactly how remove() and the page address a row — so "ambiguous" here means "one delete or load could
 * not say which row it meant".
 */
function repeatedIds(list) {
  const seen = new Set(); const repeated = new Set();
  for (const row of list) {
    if (!validRow(row)) continue;
    if (seen.has(row.id)) repeated.add(row.id); else seen.add(row.id);
  }
  return repeated;
}

/** Structural problems of a parsed store. [] means writable. */
function inspect(parsed) {
  if (!isObject(parsed)) return ['The saved presets value is ' + typeName(parsed) + ', not a presets object.'];
  const problems = [];
  for (const type of TYPES) {
    if (!own(parsed, type)) continue;
    const list = parsed[type];
    if (!Array.isArray(list)) { problems.push('The "' + type + '" presets collection is ' + typeName(list) + ', not a list.'); continue; }
    const bad = list.reduce((n, row) => n + (validRow(row) ? 0 : 1), 0);
    if (bad) problems.push('The "' + type + '" presets collection contains ' + bad + ' entr' + (bad === 1 ? 'y' : 'ies') + ' this version cannot read.');
    const repeated = repeatedIds(list);
    if (repeated.size) {
      const shared = list.reduce((n, row) => n + (validRow(row) && repeated.has(row.id) ? 1 : 0), 0);
      problems.push('The "' + type + '" presets collection contains ' + shared + ' presets that share an identity with another preset, so this version cannot tell them apart. They are not listed; they are still in the stored data and in the raw export.');
    }
  }
  return problems;
}

function getRaw(storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return { ok: false };
    const raw = storage.getItem(KEY);
    if (raw !== null && typeof raw !== 'string') return { ok: false };
    return { ok: true, raw };
  } catch (_) { return { ok: false }; }
}

/**
 * Strict read.
 *   state 'absent'       nothing stored (null or the empty string): an empty, writable store
 *   state 'ok'           valid: writable
 *   state 'corrupt'      not JSON (for example truncated)
 *   state 'unsupported'  JSON, but not a shape this version can safely rewrite
 *   state 'unavailable'  the browser refused access to storage
 * `raw` is the exact stored string (null when absent/unavailable). `data` is the
 * parsed object whenever the top level is an object, so readable collections can
 * still be listed in a recovery state; it is never a base for writing.
 */
function read(storage) {
  const got = getRaw(storage);
  if (!got.ok) return { state: 'unavailable', usable: false, raw: null, data: null, problems: ['Browser storage is unavailable, so saved presets cannot be read.'] };
  if (got.raw === null || got.raw === '') return { state: 'absent', usable: true, raw: got.raw, data: {}, problems: [] };
  let parsed;
  try { parsed = JSON.parse(got.raw); } catch (_) {
    return { state: 'corrupt', usable: false, raw: got.raw, data: null, problems: ['The saved presets data is damaged (it is not complete JSON).'] };
  }
  const problems = inspect(parsed);
  if (problems.length) return { state: 'unsupported', usable: false, raw: got.raw, data: isObject(parsed) ? parsed : null, problems };
  return { state: 'ok', usable: true, raw: got.raw, data: parsed, problems: [] };
}

/**
 * Rows of one collection that can be shown and loaded — also in a recovery state. Never a write base.
 * Only rows validRow() accepts whose identity is unique in the collection: an entry this version cannot
 * read (for example `vals: null`) is not presented as a preset, and of two rows with one identity neither
 * is offered, because a load by id could silently apply the other one's values. Nothing is repaired or
 * dropped by this: `result.raw` and exportBytes() still hold every stored entry, and the store stays in
 * its recovery state.
 */
function rows(result, type) {
  const data = result && result.data;
  if (!isObject(data) || !own(data, type) || !Array.isArray(data[type])) return [];
  const repeated = repeatedIds(data[type]);
  return data[type].filter((row) => validRow(row) && !repeated.has(row.id));
}

function writeFailure(error) {
  let name = '';
  try { name = error && typeof error.name === 'string' ? error.name : ''; } catch (_) { name = ''; }
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return ['QUOTA', 'Browser storage is full, so the change could not be stored.'];
  if (name === 'SecurityError') return ['SECURITY', 'The browser refused access to storage, so the change could not be stored.'];
  return ['WRITE_FAILED', 'The browser refused the storage write.'];
}

/** The synchronous critical section. Runs only while the exclusive lock is held. */
function commit(storage, apply) {
  const fresh = read(storage);
  if (fresh.state === 'unavailable') return fail('UNAVAILABLE', fresh.problems[0], { state: fresh.state });
  if (!fresh.usable) return fail('RECOVERY_REQUIRED', 'Saved presets need recovery first: ' + fresh.problems[0] + ' The stored data was not changed.', { state: fresh.state });
  let base;
  try { base = JSON.parse(JSON.stringify(fresh.data)); } catch (_) { return fail('SERIALIZE', 'The saved presets could not be copied for editing. Nothing was changed.'); }
  let next;
  try { next = apply(base); } catch (_) { return fail('VALIDATION', 'The change could not be applied. Nothing was changed.'); }
  if (!next || next.ok !== true) return next && next.ok === false ? next : fail('VALIDATION', 'The change could not be applied. Nothing was changed.');
  if (inspect(next.data).length) return fail('VALIDATION', 'The change would produce an invalid presets list. Nothing was changed.');
  let serialized;
  try { serialized = JSON.stringify(next.data); } catch (_) { serialized = undefined; }
  if (typeof serialized !== 'string') return fail('SERIALIZE', 'This preset contains values that cannot be stored. Nothing was changed.');
  const before = getRaw(storage);
  if (!before.ok || before.raw !== fresh.raw) return fail('CONFLICT', 'Saved presets changed in another tab while this change was being prepared. Nothing was changed; try again.');
  try { storage.setItem(KEY, serialized); } catch (error) {
    const [code, message] = writeFailure(error);
    const after = getRaw(storage);
    const preserved = after.ok && after.raw === fresh.raw;
    return fail(code, message + (preserved ? ' Your existing presets are unchanged.' : ' The stored presets could not be re-checked afterwards; export the raw data before trying again.'), { preserved });
  }
  const after = getRaw(storage);
  if (after.ok && after.raw === serialized) return { ok: true, raw: serialized, data: next.data, value: next.value };
  // NOT CONFIRMED — and storage is not written again. What is stored now may be the value of a writer that does
  // not take this lock (a tab still running an older version); putting the earlier bytes back would erase it, and
  // when the read-back is refused there is nothing to compare at all. The one setItem above is the only write.
  if (!after.ok) {
    return fail('VERIFY_FAILED', 'The browser accepted the change but then refused to let the saved presets be read back, so it is not confirmed as saved — it may or may not be stored. Nothing else was written. Check the presets list before trying again.', { confirmed: false, preserved: false, observed: 'unreadable' });
  }
  if (after.raw === fresh.raw) {
    return fail('VERIFY_FAILED', 'The browser accepted the change but did not store it. Your existing presets are unchanged.', { confirmed: false, preserved: true, observed: 'previous' });
  }
  return fail('VERIFY_FAILED', 'The change was written, but the saved presets no longer match it — another tab may have saved at the same moment, or the browser did not store the change completely. It is not confirmed as saved. The stored data was left exactly as it was found; check the presets list, export the raw data if anything is missing, then try again.', { confirmed: false, preserved: false, observed: 'different' });
}

/** Run `apply` (data -> { ok:true, data, value? } | failure) under the exclusive cross-tab lock. Always resolves, never rejects. */
function mutate(env, apply) {
  const storage = env && env.storage; const locks = env && env.locks;
  if (!locks || typeof locks.request !== 'function') {
    return Promise.resolve(fail('LOCK_UNAVAILABLE', 'This browser does not provide the cross-tab lock needed to change saved presets safely. Existing presets can still be loaded and exported; nothing was changed.'));
  }
  let pending;
  try {
    pending = locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) return fail('BUSY', 'Saved presets are being changed in another tab right now. Nothing was changed; try again.');
      try { return commit(storage, apply); } catch (_) { return fail('UNAVAILABLE', 'Saved presets could not be changed. Nothing was confirmed as saved.'); }
    });
  } catch (_) {
    return Promise.resolve(fail('LOCK_UNAVAILABLE', 'The cross-tab lock could not be requested. Nothing was changed.'));
  }
  return Promise.resolve(pending).then(
    (r) => (r && typeof r.ok === 'boolean' ? r : fail('UNAVAILABLE', 'Saved presets could not be changed. Nothing was confirmed as saved.')),
    () => fail('LOCK_UNAVAILABLE', 'The cross-tab lock request failed. Nothing was confirmed as saved.'));
}

/**
 * Append a NEW preset. `row` = { name, vals, id }.
 * The id of a new row must be a safe integer (the page passes Date.now()): above Number.MAX_SAFE_INTEGER
 * `id + 1` can equal `id`, so "advance until free" would never end. An id already used in this collection is
 * advanced, never reused; the search takes at most one step per stored row and never passes
 * Number.MAX_SAFE_INTEGER — if no free id is found the add is refused (ID_UNAVAILABLE) and nothing is
 * written. Rows already stored keep whatever valid id they have (strings, large numbers): only NEW ids are
 * restricted.
 */
function add(env, type, row) {
  if (!TYPES.includes(type)) return Promise.resolve(fail('VALIDATION', 'Unknown preset type.'));
  if (!isObject(row) || typeof row.name !== 'string' || !row.name || !isObject(row.vals)) {
    return Promise.resolve(fail('VALIDATION', 'This preset has no name or no values to save. Nothing was changed.'));
  }
  if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id)) {
    return Promise.resolve(fail('VALIDATION', 'This preset was not given a usable identity. Nothing was changed.'));
  }
  return mutate(env, (data) => {
    if (!own(data, type)) data[type] = [];
    const list = data[type];
    const used = new Set(list.map((f) => f.id));
    let id = row.id;
    for (let steps = 0; used.has(id); steps++) {
      if (steps >= list.length || id >= Number.MAX_SAFE_INTEGER) return fail('ID_UNAVAILABLE', 'No free identity could be found for this preset. Nothing was changed; try again.');
      id += 1;
    }
    list.push({ name: row.name, vals: row.vals, id });
    return { ok: true, data, value: { id } };
  });
}

/** Delete exactly ONE preset, addressed by its id (strict comparison), from the FRESH list. */
function remove(env, type, id) {
  if (!TYPES.includes(type)) return Promise.resolve(fail('VALIDATION', 'Unknown preset type.'));
  return mutate(env, (data) => {
    const list = own(data, type) ? data[type] : [];
    const at = [];
    list.forEach((f, i) => { if (f.id === id) at.push(i); });
    if (at.length === 0) return fail('NOT_FOUND', 'That preset is no longer stored (it may have been deleted in another tab). Nothing was changed.');
    // Cannot happen for a store that passed inspect() (repeated identities are a recovery state and never reach
    // this point); kept so that one delete can never take a second row with it, whatever the caller did.
    if (at.length !== 1) return fail('AMBIGUOUS', 'More than one stored preset has this identity, so a single preset cannot be deleted safely. Nothing was changed.');
    data[type] = list.filter((_, i) => i !== at[0]);
    return { ok: true, data, value: { removed: 1 } };
  });
}

/** Lone UTF-16 surrogates cannot be written as UTF-8 without loss. */
function wellFormed(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) { const d = text.charCodeAt(i + 1); if (!(d >= 0xDC00 && d <= 0xDFFF)) return false; i++; } else if (c >= 0xDC00 && c <= 0xDFFF) return false;
  }
  return true;
}
function utf8(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) { c = 0x10000 + ((c - 0xD800) << 10) + (text.charCodeAt(++i) - 0xDC00); }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}
/**
 * The exact stored value as bytes for a file download. UTF-8 whenever that is lossless (the normal
 * case, including damaged or truncated JSON); UTF-16LE with a byte-order mark when the value holds
 * unpaired surrogates, so not one stored code unit is altered. Reads storage once, writes nothing.
 */
function exportBytes(storage) {
  const got = getRaw(storage);
  if (!got.ok) return fail('UNAVAILABLE', 'Browser storage is unavailable, so there is nothing to export.');
  if (got.raw === null) return fail('EMPTY', 'There is no saved presets data to export.');
  const raw = got.raw;
  if (wellFormed(raw)) return { ok: true, raw, encoding: 'utf-8', mediaType: 'application/octet-stream', bytes: utf8(raw) };
  const bytes = new Uint8Array(2 + raw.length * 2); bytes[0] = 0xFF; bytes[1] = 0xFE;
  for (let i = 0; i < raw.length; i++) { const c = raw.charCodeAt(i); bytes[2 + i * 2] = c & 0xFF; bytes[3 + i * 2] = c >> 8; }
  return { ok: true, raw, encoding: 'utf-16le', mediaType: 'application/octet-stream', bytes };
}

/**
 * Remove ONLY the Favorites key. Requires explicit confirmation and the raw value the user was shown;
 * if the stored value is no longer that value nothing is removed. Works in a recovery state — that is
 * its purpose — but still only under the exclusive lock.
 */
function reset(env, request) {
  const storage = env && env.storage; const locks = env && env.locks;
  if (!request || request.confirmed !== true) return Promise.resolve(fail('CONFIRMATION', 'Reset was not confirmed. Nothing was changed.'));
  if (!locks || typeof locks.request !== 'function') return Promise.resolve(fail('LOCK_UNAVAILABLE', 'This browser does not provide the cross-tab lock needed to reset saved presets safely. Nothing was changed; the raw data can still be exported.'));
  let pending;
  try {
    pending = locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) return fail('BUSY', 'Saved presets are being changed in another tab right now. Nothing was reset; try again.');
      const now = getRaw(storage);
      if (!now.ok || typeof storage.removeItem !== 'function') return fail('UNAVAILABLE', 'Browser storage is unavailable. Nothing was reset.');
      if (now.raw !== request.expectedRaw) return fail('CONFLICT', 'Saved presets changed since this message was shown. Nothing was reset; review the current state first.');
      try { storage.removeItem(KEY); } catch (error) { return fail(writeFailure(error)[0], 'The browser refused to reset saved presets. Nothing was confirmed as removed.'); }
      const after = getRaw(storage);
      if (!after.ok) return fail('VERIFY_FAILED', 'Reset could not be confirmed: the browser refused the re-check, so it is not known whether the saved presets data is still present.');
      if (after.raw !== null) return fail('VERIFY_FAILED', 'Reset could not be confirmed; saved presets data is still present.');
      return { ok: true };
    });
  } catch (_) { return Promise.resolve(fail('LOCK_UNAVAILABLE', 'The cross-tab lock could not be requested. Nothing was reset.')); }
  return Promise.resolve(pending).then(
    (r) => (r && typeof r.ok === 'boolean' ? r : fail('UNAVAILABLE', 'Reset could not be confirmed.')),
    () => fail('LOCK_UNAVAILABLE', 'The cross-tab lock request failed. Nothing was confirmed as reset.'));
}

const canMutate = (env) => !!(env && env.locks && typeof env.locks.request === 'function');

module.exports = { KEY, LOCK_NAME, TYPES, read, rows, inspect, validRow, mutate, add, remove, exportBytes, reset, canMutate };
