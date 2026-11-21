'use strict';
/** LC-JOB-RESTORE-1: exact-ID restore plan for previously validated .ecjob v1 files.
 * Refuses an existing job identity. Never edits record contents, remaps IDs, or
 * interprets electrical results. An incomplete linked result cannot be restored. */
const Archive = require('./jobArchive.js');
const fail = (code, message) => ({ ok: false, code, problems: [message] });
const frozenClone = v => JSON.parse(JSON.stringify(v));
function plan(decoded) {
  if (!decoded || decoded.ok !== true || !decoded.manifest || !Array.isArray(decoded.assets)) return fail('VALIDATION', 'Select and verify a downloaded .ecjob archive first.');
  const checked = Archive.validate(decoded.manifest);
  if (!checked.ok) return checked;
  if (checked.resultEntries.some(r => r.status !== 'readable')) return fail('INCOMPLETE', 'This archive contains missing or unreadable linked service results. It remains available read-only; full restoration is refused.');
  if (checked.warnings.length) return fail('INCOMPLETE', 'Linked result metadata is inconsistent; full editable restoration is refused.');
  if (decoded.assets.length !== decoded.manifest.originals.length) return fail('CORRUPT', 'Original photo count differs from the archive.');
  const assetMap = new Map();
  for (const a of decoded.assets) {
    if (!a || typeof a.photoId !== 'string' || assetMap.has(a.photoId) || !(a.blob instanceof Blob)) return fail('CORRUPT', 'Invalid original photo attachment.');
    assetMap.set(a.photoId, a.blob);
  }
  const m = decoded.manifest, photoAssets = [];
  for (const a of m.originals) {
    const blob = assetMap.get(a.photoId);
    if (!blob || blob.size !== a.file.bytes || blob.type !== a.file.mediaType) return fail('CORRUPT', 'A photo Blob does not match its archived descriptor.');
    photoAssets.push({ kind: 'empire-code.photo-asset', recordVersion: 1, photoId: a.photoId, jobId: a.jobId, file: frozenClone(a.file), blob: Blob.prototype.slice.call(blob, 0, blob.size, blob.type) });
  }
  // The descriptor is validated once more by the native adapter before write.
  const records = {
    empire_code_jobs: { jobs: [frozenClone(m.job.head)], jobRevisions: frozenClone(m.job.revisions) },
    empire_code_measurements: { revisions: frozenClone(m.measurements) },
    empire_code_materials: { revisions: frozenClone(m.materials) },
    empire_code_photos: { assets: photoAssets, revisions: frozenClone(m.photoRevisions) }
  };
  const results = m.results.filter(x => x.raw !== null).map(x => ({ key: 'empire_code_service_result_v1:' + x.serviceResultId, raw: x.raw }));
  const ids = records.empire_code_jobs.jobs.map(x => x.jobId);
  if (ids.length !== 1 || ids[0] !== checked.job.head.jobId) return fail('CORRUPT', 'Restore job identity mismatch.');
  return { ok: true, jobId: ids[0], archiveId: m.archiveId, records, results,
    title: checked.job.revisions[checked.job.revisions.length - 1].title,
    summary: checked.summary };
}
module.exports = { plan };
