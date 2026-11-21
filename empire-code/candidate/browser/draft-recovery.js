/*
 * draft-recovery.js
 *
 * Synchronous, per-document journal of unsent text for a localStorage app.
 *
 * - Every record lives under its own key: PREFIX + contextId + ':' + documentId.
 * - This module never reads, writes or removes any key outside PREFIX. For
 *   foreign keys it only looks at the key NAME while scanning, never the value.
 * - It never deletes anything on its own (no cleanup, no rotation, no rollback).
 *   The only removal path is clearExact(), guarded by an exact byte comparison.
 * - It never picks a winner, merges, sends or applies recovered text. The
 *   caller decides.
 * - Importing has no side effects: no DOM, no window, no clock, no network.
 *
 * UMD: Node -> module.exports, browser -> global DraftRecovery.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module !== null && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.DraftRecovery = factory();
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this,
  function () {
    'use strict';

    var PREFIX = 'empire_code_unsent4:';

    var MAX_TEXT_LENGTH = 3000; // UTF-16 code units, exactly as String.length counts
    // Worst case JSON escaping is 6 chars per code unit (\u0000, lone
    // surrogates); the fixed envelope around the text is at most 184 chars.
    var MAX_RAW_LENGTH = MAX_TEXT_LENGTH * 6 + 256;
    var MAX_PREFIX_KEYS = 256; // matching keys examined per list() call
    var MAX_STORAGE_KEYS = 4096; // storage slots (key names only) examined per list() call

    var CONTEXT_ID_RE = /^ctx1_[0-9a-f]{32}$/;
    var DOCUMENT_ID_RE = /^doc1_[0-9a-f]{32}$/;
    var KEY_TAIL_RE = /^(ctx1_[0-9a-f]{32}):(doc1_[0-9a-f]{32})$/;
    var SAVED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    var FIELDS = ['contextId', 'documentId', 'baseVersion', 'text', 'savedAt'];

    // ---------------------------------------------------------------- errors

    /**
     * Typed error. `code` is one of:
     *   invalid_input, invalid_context_id, invalid_document_id,
     *   invalid_base_version, invalid_text, invalid_saved_at,
     *   invalid_key, invalid_expected_raw,
     *   crypto_unavailable,
     *   storage_unavailable, storage_denied, quota_exceeded,
     *   readback_mismatch, remove_failed
     * Messages never contain draft text or stored bytes.
     */
    function DraftRecoveryError(code, message, cause) {
      var err = new Error(message);
      Object.setPrototypeOf(err, DraftRecoveryError.prototype);
      err.name = 'DraftRecoveryError';
      err.code = code;
      if (cause !== undefined) err.cause = cause;
      return err;
    }
    DraftRecoveryError.prototype = Object.create(Error.prototype, {
      constructor: { value: DraftRecoveryError, writable: true, configurable: true }
    });

    function fail(code, message, cause) {
      throw new DraftRecoveryError(code, message, cause);
    }

    function isQuotaError(err) {
      try {
        if (err === null || typeof err !== 'object') return false;
        return (
          err.name === 'QuotaExceededError' ||
          err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
          err.code === 22 ||
          err.code === 1014
        );
      } catch (_ignored) {
        return false;
      }
    }

    function storageFailure(err, operation) {
      return new DraftRecoveryError(
        isQuotaError(err) ? 'quota_exceeded' : 'storage_denied',
        'draft recovery: storage ' + operation + ' failed',
        err
      );
    }

    // ------------------------------------------------------------ validation

    function isContextId(value) {
      return typeof value === 'string' && CONTEXT_ID_RE.test(value);
    }

    function isDocumentId(value) {
      return typeof value === 'string' && DOCUMENT_ID_RE.test(value);
    }

    function isBaseVersion(value) {
      // Object.is rejects -0, which JSON would silently rewrite to 0.
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
    }

    function isText(value) {
      return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
    }

    function isSavedAt(value) {
      if (typeof value !== 'string' || !SAVED_AT_RE.test(value)) return false;
      var ms = Date.parse(value); // parses the argument only; does not read the clock
      if (typeof ms !== 'number' || ms !== ms) return false;
      return new Date(ms).toISOString() === value;
    }

    /** Returns null when valid, else {code, message}. */
    function fieldProblem(candidate) {
      if (!isContextId(candidate.contextId)) {
        return { code: 'invalid_context_id', message: 'contextId must match ctx1_ + 32 lowercase hex' };
      }
      if (!isDocumentId(candidate.documentId)) {
        return { code: 'invalid_document_id', message: 'documentId must match doc1_ + 32 lowercase hex' };
      }
      if (!isBaseVersion(candidate.baseVersion)) {
        return { code: 'invalid_base_version', message: 'baseVersion must be a nonnegative safe integer' };
      }
      if (!isText(candidate.text)) {
        return { code: 'invalid_text', message: 'text must be a string of at most ' + MAX_TEXT_LENGTH + ' UTF-16 code units' };
      }
      if (!isSavedAt(candidate.savedAt)) {
        return { code: 'invalid_saved_at', message: 'savedAt must be canonical UTC (YYYY-MM-DDTHH:mm:ss.sssZ)' };
      }
      return null;
    }

    /** Exactly the five supported own enumerable string keys, nothing else. */
    function hasExactShape(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
      var proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return false;
      if (Object.getOwnPropertySymbols(value).length !== 0) return false;
      var names = Object.getOwnPropertyNames(value);
      if (names.length !== FIELDS.length) return false;
      for (var i = 0; i < FIELDS.length; i++) {
        var descriptor = Object.getOwnPropertyDescriptor(value, FIELDS[i]);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
      }
      return true;
    }

    function buildRecord(source) {
      // Fresh object, fixed field order: this order IS the canonical encoding.
      return Object.freeze({
        contextId: source.contextId,
        documentId: source.documentId,
        baseVersion: source.baseVersion,
        text: source.text,
        savedAt: source.savedAt
      });
    }

    function keyFor(contextId, documentId) {
      if (!isContextId(contextId)) fail('invalid_context_id', 'contextId must match ctx1_ + 32 lowercase hex');
      if (!isDocumentId(documentId)) fail('invalid_document_id', 'documentId must match doc1_ + 32 lowercase hex');
      return PREFIX + contextId + ':' + documentId;
    }

    function requireStorage(storage, methods) {
      if (storage === null || (typeof storage !== 'object' && typeof storage !== 'function')) {
        fail('storage_unavailable', 'draft recovery: storage is not available');
      }
      for (var i = 0; i < methods.length; i++) {
        var method;
        try {
          method = storage[methods[i]];
        } catch (err) {
          throw storageFailure(err, 'access');
        }
        if (typeof method !== 'function') {
          fail('storage_unavailable', 'draft recovery: storage.' + methods[i] + ' is not available');
        }
      }
    }

    function readItem(storage, key) {
      try {
        return storage.getItem(key);
      } catch (err) {
        throw storageFailure(err, 'read');
      }
    }

    // ------------------------------------------------------------ public API

    /**
     * Allocate a fresh document ID. Call once per document load; never copy it
     * from sessionStorage (a duplicated tab would share it).
     * `crypto` must provide getRandomValues (Web Crypto) or randomBytes (Node).
     * There is deliberately no Math.random fallback.
     */
    function createDocumentId(crypto) {
      if (crypto === null || (typeof crypto !== 'object' && typeof crypto !== 'function')) {
        fail('crypto_unavailable', 'draft recovery: a crypto source is required');
      }
      var bytes;
      try {
        if (typeof crypto.getRandomValues === 'function') {
          bytes = new Uint8Array(16);
          crypto.getRandomValues(bytes);
        } else if (typeof crypto.randomBytes === 'function') {
          bytes = crypto.randomBytes(16);
        }
      } catch (err) {
        fail('crypto_unavailable', 'draft recovery: crypto source failed', err);
      }
      if (!bytes || bytes.length !== 16) {
        fail('crypto_unavailable', 'draft recovery: crypto source did not return 16 bytes');
      }
      var hex = '';
      var anyNonZero = false;
      for (var i = 0; i < 16; i++) {
        var b = bytes[i];
        if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 255) {
          fail('crypto_unavailable', 'draft recovery: crypto source returned invalid bytes');
        }
        if (b !== 0) anyNonZero = true;
        hex += (b < 16 ? '0' : '') + b.toString(16);
      }
      if (!anyNonZero) {
        // An untouched buffer means the source did not actually fill it.
        fail('crypto_unavailable', 'draft recovery: crypto source returned no entropy');
      }
      return 'doc1_' + hex;
    }

    /**
     * Journal the current unsent text for one document.
     * Returns {key, raw, record} only after reading back exactly `raw`.
     * On any failure it throws and removes nothing; whatever bytes the key
     * held before are left to the storage implementation (setItem is atomic
     * per the Web Storage spec, so a quota failure keeps the previous record).
     */
    function write(storage, input) {
      requireStorage(storage, ['getItem', 'setItem']);
      if (!hasExactShape(input)) {
        fail('invalid_input', 'draft recovery: input must have exactly contextId, documentId, baseVersion, text, savedAt');
      }
      var record = buildRecord(input);
      var problem = fieldProblem(record);
      if (problem) fail(problem.code, 'draft recovery: ' + problem.message);

      var key = PREFIX + record.contextId + ':' + record.documentId;
      var raw = JSON.stringify(record);
      if (typeof raw !== 'string' || raw.length > MAX_RAW_LENGTH) {
        fail('invalid_text', 'draft recovery: encoded record exceeds the size bound');
      }

      try {
        storage.setItem(key, raw);
      } catch (err) {
        throw storageFailure(err, 'write'); // no rollback, no removal
      }

      var stored = readItem(storage, key);
      if (stored !== raw) {
        fail('readback_mismatch', 'draft recovery: stored bytes do not match what was written');
      }
      return { key: key, raw: raw, record: record };
    }

    /** Decode one stored value. Returns {record} or {code, message}. */
    function decode(key, raw) {
      var tail = KEY_TAIL_RE.exec(key.slice(PREFIX.length));
      if (!tail) {
        return { code: 'bad_key', message: 'key under the prefix is not contextId:documentId' };
      }
      if (typeof raw !== 'string') {
        return { code: 'not_string', message: 'stored value is not a string' };
      }
      if (raw.length > MAX_RAW_LENGTH) {
        return { code: 'oversized', message: 'stored value exceeds the size bound; not parsed' };
      }
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_err) {
        return { code: 'invalid_json', message: 'stored value is not valid JSON' };
      }
      if (!hasExactShape(parsed)) {
        return { code: 'invalid_shape', message: 'stored value does not have exactly the supported fields' };
      }
      var problem = fieldProblem(parsed);
      if (problem) return problem;
      if (parsed.contextId !== tail[1] || parsed.documentId !== tail[2]) {
        return { code: 'key_mismatch', message: 'record IDs do not match the key they are stored under' };
      }
      var record = buildRecord(parsed);
      if (JSON.stringify(record) !== raw) {
        // Catches duplicate keys, reordered fields, whitespace, alternate escapes.
        return { code: 'not_canonical', message: 'stored value is not in canonical encoding' };
      }
      return { record: record };
    }

    /**
     * Enumerate journal entries. Read-only: never writes or removes.
     *
     * Returns {records, problems, truncated}:
     *   records:  [{key, raw, record}] sorted by key; every one fully validated.
     *   problems: [{key, code, message, raw, rawLength}] for every matching key
     *             that could not be validated (the key stays in storage), plus
     *             scan-limit diagnostics (key: null, raw: null).
     *   truncated: true when a scan limit was hit, i.e. the result is partial.
     *
     * With `contextId`, only keys under PREFIX + contextId + ':' are matched.
     * Without it, every key under PREFIX is matched (use this to audit).
     * Values of keys outside PREFIX are never read.
     */
    function list(storage, contextId) {
      requireStorage(storage, ['getItem', 'key']);
      var scope = PREFIX;
      if (contextId !== undefined) {
        if (!isContextId(contextId)) fail('invalid_context_id', 'draft recovery: contextId must match ctx1_ + 32 lowercase hex');
        scope = PREFIX + contextId + ':';
      }

      var total;
      try {
        total = storage.length;
      } catch (err) {
        throw storageFailure(err, 'enumerate');
      }
      if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
        fail('storage_unavailable', 'draft recovery: storage.length is not usable');
      }

      var records = [];
      var problems = [];
      var truncated = false;

      var slots = total;
      if (slots > MAX_STORAGE_KEYS) {
        slots = MAX_STORAGE_KEYS;
        truncated = true;
        problems.push({
          key: null,
          code: 'storage_scan_limit',
          message: 'storage holds more than ' + MAX_STORAGE_KEYS + ' keys; only the first ' + MAX_STORAGE_KEYS + ' key names were examined',
          raw: null,
          rawLength: null
        });
      }

      // Pass 1: collect matching key names only.
      var keys = [];
      var seen = Object.create(null);
      for (var i = 0; i < slots; i++) {
        var name;
        try {
          name = storage.key(i);
        } catch (err) {
          throw storageFailure(err, 'enumerate');
        }
        if (typeof name !== 'string') continue; // slot vanished (another tab)
        if (name.length < scope.length || name.slice(0, scope.length) !== scope) continue;
        if (seen[name] === true) continue;
        if (keys.length >= MAX_PREFIX_KEYS) {
          truncated = true;
          problems.push({
            key: null,
            code: 'prefix_scan_limit',
            message: 'more than ' + MAX_PREFIX_KEYS + ' matching keys; the rest were not examined and nothing was removed',
            raw: null,
            rawLength: null
          });
          break;
        }
        seen[name] = true;
        keys.push(name);
      }
      keys.sort();

      // Pass 2: read and validate matching values.
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var raw = readItem(storage, key);
        if (raw === null || raw === undefined) continue; // removed since pass 1
        var result = decode(key, raw);
        if (result.record) {
          records.push({ key: key, raw: raw, record: result.record });
        } else {
          var isString = typeof raw === 'string';
          problems.push({
            key: key,
            code: result.code,
            message: result.message,
            raw: isString ? raw : null,
            rawLength: isString ? raw.length : null
          });
        }
      }

      return { records: records, problems: problems, truncated: truncated };
    }

    /**
     * Remove `key` only if it is under PREFIX and currently holds exactly
     * `expectedRaw`. Returns true when those bytes were removed by this call,
     * false when the key is absent or holds anything else (e.g. a later
     * keystroke), in which case nothing is touched.
     */
    function clearExact(storage, key, expectedRaw) {
      if (typeof key !== 'string' || key.length < PREFIX.length || key.slice(0, PREFIX.length) !== PREFIX) {
        fail('invalid_key', 'draft recovery: clearExact only accepts keys under the journal prefix');
      }
      if (typeof expectedRaw !== 'string') {
        fail('invalid_expected_raw', 'draft recovery: expectedRaw must be the exact string previously read or written');
      }
      requireStorage(storage, ['getItem', 'removeItem']);

      var current = readItem(storage, key);
      if (current !== expectedRaw) return false;

      try {
        storage.removeItem(key);
      } catch (err) {
        throw storageFailure(err, 'remove');
      }

      var after = readItem(storage, key);
      if (after === expectedRaw) {
        fail('remove_failed', 'draft recovery: storage still holds the bytes after removal');
      }
      return true;
    }

    return Object.freeze({
      PREFIX: PREFIX,
      MAX_TEXT_LENGTH: MAX_TEXT_LENGTH,
      MAX_RAW_LENGTH: MAX_RAW_LENGTH,
      MAX_PREFIX_KEYS: MAX_PREFIX_KEYS,
      MAX_STORAGE_KEYS: MAX_STORAGE_KEYS,
      DraftRecoveryError: DraftRecoveryError,
      createDocumentId: createDocumentId,
      keyFor: keyFor,
      write: write,
      list: list,
      clearExact: clearExact
    });
  }
);
