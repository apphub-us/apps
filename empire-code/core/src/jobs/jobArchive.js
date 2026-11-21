'use strict';
/** LC-JOB-ARCHIVE-1: closed, bounded, read-only archive contract. No engines or storage calls. */
const Job = require('./jobCard.js');
const Measurement = require('./jobMeasurement.js');
const Material = require('./jobMaterial.js');
const Photo = require('./jobPhoto.js');
const Result = require('../calc/loadCalcServiceRecord.js');
const KIND = 'empire-code.job-archive', VERSION = 1;
const BASE_SOURCE_PIN = 'e8e6a611472f3697a983194a1c6d468a33c2429900f23236900420e1fcc3e026';
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_PHOTO_BYTES = Photo.MAX_JOB_BYTES;
const MAX_ARCHIVE_BYTES = 44 + MAX_MANIFEST_BYTES + MAX_PHOTO_BYTES;
const MAX_RAW_RESULT_TEXT = 2 * 1024 * 1024;
const ARCHIVE_ID = /^archive1_[0-9a-f]{32}$/;
const PIN = /^[0-9a-f]{64}$/;
const FIELDS = ['kind', 'archiveVersion', 'archiveId', 'producer', 'capture', 'job', 'measurements', 'materials', 'photoRevisions', 'originals', 'results'];
const fail = (code, text) => ({ ok: false, code, problems: [text] });
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
function shape(v, keys) { return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => own(v, k)); }
function utc(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) return false; try { return new Date(v).toISOString() === v; } catch (_) { return false; } }
function safeData(value) {
  const stack = new Set(); let nodes = 0, chars = 0;
  function visit(v, depth) {
    if (++nodes > 1000000 || depth > 80) throw Error();
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { chars += v.length; if (chars > MAX_MANIFEST_BYTES) throw Error(); return; }
    if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) throw Error(); return; }
    if (typeof v !== 'object' || stack.has(v)) throw Error();
    const arr = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (arr ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw Error();
    const keys = Reflect.ownKeys(v); if (keys.length > 100000) throw Error(); stack.add(v);
    for (const k of keys) { if (arr && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (typeof k !== 'string' || !d || !own(d, 'value') || !d.enumerable) throw Error();
      if (arr && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) throw Error();
      chars += k.length; visit(d.value, depth + 1);
    }
    if (arr) { if (v.length > 100000) throw Error(); for (let i = 0; i < v.length; i++) if (!own(v, String(i))) throw Error(); }
    stack.delete(v);
  }
  try { visit(value, 0); return { ok: true }; } catch (_) { return fail('LIMIT_OR_DATA', 'Archive metadata is oversized or contains unsafe/non-JSON values.'); }
}
// Stable key order for two-read comparison and strict archive serialization; no normalization of values.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
function readJob(value) {
  if (!shape(value, ['head', 'revisions']) || !Array.isArray(value.revisions) || !value.revisions.length || value.revisions.length > 1000) return fail('CORRUPT', 'Archive must include a bounded complete job history.');
  const h = Job.readHead(value.head); if (!h.ok) return h;
  const rows = [], ids = new Set();
  for (const v of value.revisions) { const r = Job.readRevision(v); if (!r.ok) return r;
    if (r.revision.jobId !== h.head.jobId || ids.has(r.revision.revisionId)) return fail('CORRUPT', 'Job identity or revision uniqueness mismatch.');
    ids.add(r.revision.revisionId); rows.push(r.revision);
  }
  rows.sort((a, b) => a.revisionNumber - b.revisionNumber);
  if (h.head.revisionNumber !== rows.length || h.head.currentRevisionId !== rows[rows.length - 1].revisionId) return fail('CORRUPT', 'Job head and history disagree.');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], p = rows[i - 1];
    if (r.revisionNumber !== i + 1 || r.parentRevisionId !== (p ? p.revisionId : null) || r.createdAt !== rows[0].createdAt) return fail('CORRUPT', 'Job history is missing or branched.');
    const old = p ? p.serviceResultLinks : [];
    if (r.serviceResultLinks.length < old.length || old.some((l, j) => canonical(l) !== canonical(r.serviceResultLinks[j]))) return fail('CORRUPT', 'A saved result link was removed, reordered or changed in job history.');
    if (r.serviceResultLinks.slice(old.length).some(l => l.linkedAt !== r.savedAt)) return fail('CORRUPT', 'New result link time does not match its job revision.');
  }
  return { ok: true, head: h.head, revisions: rows, ids };
}
function validate(value) {
  try {
    const safe = safeData(value); if (!safe.ok) return safe;
    if (!shape(value, FIELDS)) return fail('CORRUPT', 'Archive fields are missing or unrecognized.');
    const v = value;
    if (v.kind !== KIND || v.archiveVersion !== VERSION) return fail('UNSUPPORTED', 'This archive version is not supported. Nothing was imported.');
    if (typeof v.archiveId !== 'string' || !ARCHIVE_ID.test(v.archiveId)) return fail('CORRUPT', 'Archive ID is invalid.');
    if (!shape(v.producer, ['applicationRevision', 'baseSourcePin']) || typeof v.producer.applicationRevision !== 'string' || !v.producer.applicationRevision.trim() || v.producer.applicationRevision.length > 160 || typeof v.producer.baseSourcePin !== 'string' || !PIN.test(v.producer.baseSourcePin)) return fail('CORRUPT', 'Archive producer metadata is invalid.');
    if (!shape(v.capture, ['startedAt', 'completedAt', 'consistency']) || !utc(v.capture.startedAt) || !utc(v.capture.completedAt) || v.capture.consistency !== 'two_read_stability_check') return fail('CORRUPT', 'Archive capture metadata is invalid.');
    const job = readJob(v.job); if (!job.ok) return job;
    const jobId = job.head.jobId;
    for (const [rows, max] of [[v.measurements, Measurement.MAX_JOB_ROWS], [v.materials, Material.MAX_JOB_ROWS], [v.photoRevisions, Photo.MAX_JOB_ROWS]]) {
      if (!Array.isArray(rows) || rows.length > max || rows.some(r => !r || !job.ids.has(r.jobRevisionId))) return fail('CORRUPT', 'A journal exceeds its bounds or references a missing job revision.');
    }
    const measurements = Measurement.assemble(v.measurements, jobId); if (!measurements.ok) return measurements;
    const materials = Material.assemble(v.materials, jobId); if (!materials.ok) return materials;
    const photos = Photo.assemble(v.photoRevisions, jobId); if (!photos.ok) return photos;
    if (!Array.isArray(v.originals) || v.originals.length !== photos.photos.length || v.originals.length > Photo.MAX_PHOTOS) return fail('CORRUPT', 'Photo originals and history counts disagree.');
    const photoMap = new Map(photos.photos.map(p => [p.current.photoId, p])); let photoBytes = 0;
    const photoIds = new Set();
    for (const a of v.originals) {
      if (!shape(a, ['photoId', 'jobId', 'file', 'offset']) || a.jobId !== jobId || typeof a.photoId !== 'string' || !photoMap.has(a.photoId) || photoIds.has(a.photoId)) return fail('CORRUPT', 'Photo original identity mismatch.');
      photoIds.add(a.photoId); const f = Photo.validateFile(a.file); if (!f.ok) return f;
      if (!Number.isSafeInteger(a.offset) || a.offset !== photoBytes || !Photo.sameFile(a.file, photoMap.get(a.photoId).current.file)) return fail('CORRUPT', 'Original byte layout or immutable descriptor mismatch.');
      photoBytes += a.file.bytes; if (photoBytes > MAX_PHOTO_BYTES) return fail('LIMIT', 'Archive originals exceed 200 MiB. No partial archive was returned.');
    }
    // Links are additive in a valid job chain: the current revision covers every historic link.
    const links = job.revisions[job.revisions.length - 1].serviceResultLinks, linkMap = new Map(links.map(l => [l.serviceResultId, l]));
    if (!Array.isArray(v.results) || v.results.length !== links.length) return fail('CORRUPT', 'Every linked result must have exactly one archive entry, including missing ones.');
    const seen = new Set(), warnings = [], resultEntries = [];
    for (const e of v.results) {
      if (!shape(e, ['serviceResultId', 'raw']) || typeof e.serviceResultId !== 'string' || !linkMap.has(e.serviceResultId) || seen.has(e.serviceResultId) || !(e.raw === null || typeof e.raw === 'string' && e.raw.length <= MAX_RAW_RESULT_TEXT)) return fail('CORRUPT', 'Linked result entry is invalid or too large.');
      seen.add(e.serviceResultId);
      let read = e.raw === null ? null : Result.parseStoredRecord(e.raw);
      if (read && read.ok && read.record.id !== e.serviceResultId) read = null;
      const status = e.raw === null ? 'missing' : read && read.ok ? 'readable' : 'unreadable';
      if (status !== 'readable') warnings.push({ code: status === 'missing' ? 'MISSING_RESULT' : 'UNREADABLE_RESULT', id: e.serviceResultId, message: status === 'missing' ? 'Linked result is missing. Only its link is retained.' : 'Linked result is unreadable/unsupported. Its exact stored text is retained, not interpreted.' });
      else { const l = linkMap.get(e.serviceResultId);
        if (l.savedName !== read.record.name || l.savedAt !== read.record.createdAt) warnings.push({ code: 'RESULT_LINK_METADATA_MISMATCH', id: e.serviceResultId, message: 'Link label/time differs from the stored result. Both are retained without substitution.' });
      }
      resultEntries.push({ serviceResultId: e.serviceResultId, status, record: status === 'readable' ? read.record : null, raw: e.raw });
    }
    return { ok: true, job, measurements: measurements.measurements, materials: materials.materials, photos: photos.photos, resultEntries, warnings,
      summary: { jobVersions: job.revisions.length, measurements: measurements.measurements.length, measurementVersions: v.measurements.length, materials: materials.materials.length, materialVersions: v.materials.length, photos: photos.photos.length, photoVersions: v.photoRevisions.length, photoBytes, linkedResults: links.length, readableResults: resultEntries.filter(r => r.status === 'readable').length, warnings: warnings.length } };
  } catch (_) { return fail('CORRUPT', 'Archive metadata could not be validated. Nothing was imported.'); }
}
function filename(manifest) { return 'EmpireCode-job-' + manifest.job.head.jobId.slice(5) + '-' + manifest.archiveId.slice(9, 17) + '.ecjob'; }
module.exports = { KIND, VERSION, BASE_SOURCE_PIN, MAX_MANIFEST_BYTES, MAX_PHOTO_BYTES, MAX_ARCHIVE_BYTES, MAX_RAW_RESULT_TEXT, FIELDS, ARCHIVE_ID, safeData, shape, canonical, utc, readJob, validate, filename };
