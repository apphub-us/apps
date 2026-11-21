'use strict';
/** Binary ECJOB v1. Bounded canonical UTF-8 manifest + exact raster Blobs; no ZIP/decompression/code execution. */
const M = require('./jobArchive.js');
const Media = require('./jobPhotoFile.js');
const MAGIC = new Uint8Array([69, 67, 74, 79, 66, 48, 49, 10]); // ECJOB01\n
const HEADER_BYTES = 44;
const fail = (code, text) => ({ ok: false, code, problems: [text] });
function check(options) { if (options.check && !options.check()) { const error = Error('Cancelled'); error.code = 'CANCELLED'; throw error; } }
async function hash(bytes, crypto) { if (!crypto || !crypto.subtle || typeof crypto.subtle.digest !== 'function') throw Error('Secure hashing unavailable'); return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
function sameBytes(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }
function rawBlob(blob, type) { return Blob.prototype.slice.call(blob, 0, blob.size, type === undefined ? blob.type : type); }
async function encode(manifest, assets, options = {}) {
  try {
    check(options); const validated = M.validate(manifest); if (!validated.ok) return validated;
    // Copy once before awaiting hashing or untrusted progress callbacks.
    const text = M.canonical(manifest), bytes = new TextEncoder().encode(text);
    if (bytes.length > M.MAX_MANIFEST_BYTES) return fail('LIMIT', 'Archive metadata exceeds 32 MiB. No history was truncated.');
    const snapshot = JSON.parse(text);
    if (!Array.isArray(assets) || assets.length !== snapshot.originals.length) return fail('CORRUPT', 'Archive photo files are missing or excessive.');
    const captured = assets.map(a => ({ photoId: a.photoId, blob: rawBlob(a.blob) })), map = new Map(captured.map(a => [a.photoId, a.blob]));
    if (map.size !== captured.length) return fail('CORRUPT', 'Duplicate archive photo file.');
    const header = new Uint8Array(HEADER_BYTES); header.set(MAGIC); new DataView(header.buffer).setUint32(8, bytes.length);
    header.set(await hash(bytes, options.crypto), 12); check(options);
    const parts = [header, bytes];
    for (const a of snapshot.originals) {
      check(options); if (!map.has(a.photoId)) return fail('CORRUPT', 'Archive original is missing.');
      const verified = await Media.verify(map.get(a.photoId), a.file, options.crypto); if (!verified.ok) return verified;
      parts.push(verified.blob); if (options.progress) options.progress(parts.length - 2, snapshot.originals.length);
    }
    check(options); const blob = new Blob(parts, { type: 'application/octet-stream' });
    if (blob.size > M.MAX_ARCHIVE_BYTES) return fail('LIMIT', 'Archive exceeds its maximum size.');
    return { ok: true, blob, manifest: snapshot, summary: validated.summary, warnings: validated.warnings, filename: M.filename(snapshot) };
  } catch (e) { return fail(e && e.code === 'CANCELLED' ? 'CANCELLED' : 'UNAVAILABLE', 'Archive creation failed or was cancelled. Nothing was written to the browser databases.'); }
}
async function decode(file, options = {}) {
  try {
    check(options); const blob = rawBlob(file, 'application/octet-stream');
    if (blob.size < HEADER_BYTES || blob.size > M.MAX_ARCHIVE_BYTES) return fail('FILE_LIMIT', 'This archive is truncated or exceeds the supported size.');
    const header = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer()); check(options);
    if (!sameBytes(header.slice(0, 8), MAGIC)) return fail('UNSUPPORTED', 'Choose an Empire Code .ecjob v1 archive, not a source ZIP or an image.');
    const length = new DataView(header.buffer).getUint32(8);
    if (length < 2 || length > M.MAX_MANIFEST_BYTES || HEADER_BYTES + length > blob.size) return fail('FILE_LIMIT', 'Archive metadata length is invalid.');
    const bytes = new Uint8Array(await blob.slice(HEADER_BYTES, HEADER_BYTES + length).arrayBuffer()); check(options);
    if (!sameBytes(await hash(bytes, options.crypto), header.slice(12))) return fail('CORRUPT', 'Archive metadata failed its SHA-256 check.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), manifest = JSON.parse(text);
    const validated = M.validate(manifest); if (!validated.ok) return validated;
    // Reject duplicate JSON keys, ambiguous numeric spellings, trailing data and noncanonical JSON.
    if (M.canonical(manifest) !== text) return fail('CORRUPT', 'Archive manifest is not in its unambiguous canonical form.');
    const start = HEADER_BYTES + length;
    if (start + validated.summary.photoBytes !== blob.size) return fail('CORRUPT', 'Archive photo bytes are truncated or have unreferenced trailing data.');
    const assets = [];
    for (const a of manifest.originals) {
      check(options); const original = blob.slice(start + a.offset, start + a.offset + a.file.bytes, a.file.mediaType);
      const verified = await Media.verify(original, a.file, options.crypto); if (!verified.ok) return verified;
      assets.push({ photoId: a.photoId, blob: verified.blob }); if (options.progress) options.progress(assets.length, manifest.originals.length);
    }
    check(options);
    return { ok: true, manifest, assets, summary: validated.summary, warnings: validated.warnings };
  } catch (e) { return fail(e && e.code === 'CANCELLED' ? 'CANCELLED' : 'CORRUPT', 'Archive could not be verified or was cancelled. No live data was imported.'); }
}
module.exports = { HEADER_BYTES, encode, decode };
