'use strict';
/** Manually recorded material rows, not automatic selection, purchases or stock movements. */
const KIND = 'empire-code.material-revision';
const VERSION = 1;
const PRODUCER = Object.freeze({ applicationRevision: 'LC-JOB-MATERIALS-1', recordContractRevision: 1 });
// EC-08: units and the whole-count rule come from the one shared definition (materialQuantity.js), which the
// server proposal contract and the conversation handoff use too. UNITS / COUNT_UNITS stay exported from here.
const Quantity = require('./materialQuantity.js');
const UNITS = Quantity.UNITS;
const COUNT_UNITS = Quantity.COUNT_UNITS;
const STATUSES = Object.freeze(['not_recorded', 'needed', 'ordered', 'on_site', 'used', 'not_needed']);
const FIELDS = Object.freeze(['label', 'specification', 'quantityText', 'unit', 'status', 'location', 'supplier', 'notes']);
const ID = /^mat1_[0-9a-f]{32}$/;
const REV_ID = /^trev1_[0-9a-f]{32}$/;
const JOB_ID = /^job1_[0-9a-f]{32}$/;
const JOB_REV_ID = /^jrev1_[0-9a-f]{32}$/;
const MAX_REVISIONS = 50, MAX_MATERIALS = 500, MAX_JOB_ROWS = 2000, MAX_TOTAL_ROWS = 50000;
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const fail = (code, problems, extra) => Object.assign({ ok: false, code, problems: Array.isArray(problems) ? problems : [problems] }, extra || {});
function safeData(value) {
  const seen = new Set(); let nodes = 0, text = 0;
  function visit(v, depth) {
    if (++nodes > 5000 || depth > 12) throw new Error('Data is too large or deeply nested.');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { if ((text += v.length) > 32768) throw new Error('Text size limit exceeded.'); return; }
    if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) throw new Error('Unsupported number.'); return; }
    if (typeof v !== 'object') throw new Error('Plain JSON data required.');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new Error('Custom objects are unsupported.');
    if (seen.has(v)) throw new Error('Cyclic data is unsupported.'); seen.add(v);
    const keys = Reflect.ownKeys(v); if (keys.length > 5000) throw new Error('Too many properties.');
    for (const k of keys) {
      if (array && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (typeof k !== 'string' || !d || !own(d, 'value') || !d.enumerable) throw new Error('Accessors and hidden properties are unsupported.');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) throw new Error('Extra array properties are unsupported.');
      visit(d.value, depth + 1);
    }
    if (array) { if (v.length > 5000) throw new Error('Array limit exceeded.'); for (let i = 0; i < v.length; i++) if (!own(v, i)) throw new Error('Array holes are unsupported.'); }
    seen.delete(v);
  }
  try { visit(value, 0); if (JSON.stringify(value).length > 65536) throw new Error('Serialized record exceeds 64 KiB.'); return { ok: true }; }
  catch (_) { return fail('VALIDATION', 'Unsupported, non-JSON or oversized material data.'); }
}
const copy = v => JSON.parse(JSON.stringify(v));
function shape(v, keys) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => own(v, k)); }
function utc(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) return false; try { return new Date(v).toISOString() === v; } catch (_) { return false; } }
function validateFields(fields) {
  const safe = safeData(fields); if (!safe.ok) return safe;
  if (!shape(fields, FIELDS)) return fail('VALIDATION', 'Material fields are missing or unsupported.');
  const problems = [];
  function text(k, max, required, singleLine) {
    if (typeof fields[k] !== 'string' || fields[k].length > max || required && !fields[k].trim() || singleLine && /[\r\n]/.test(fields[k])) problems.push(k + ': ' + (required ? 'nonblank ' : '') + (singleLine ? 'single-line ' : '') + 'text of at most ' + max + ' characters required.');
  }
  text('label', 160, true, true); text('specification', 1000, false, false);
  text('location', 500, false, false); text('supplier', 200, false, true); text('notes', 4000, false, false);
  if (!Quantity.isUnit(fields.unit)) problems.push('Choose a unit; quantities are never converted automatically.');
  if (!Quantity.isJobQuantityText(fields.quantityText)) problems.push('Enter a positive decimal quantity with a dot, without signs, thousands separators or exponent notation. Use Not needed rather than a zero quantity for an item you no longer need.');
  else if (Quantity.fractionalCount(fields.quantityText, fields.unit)) problems.push(Quantity.WHOLE_COUNT_MESSAGE);
  if (typeof fields.status !== 'string' || !STATUSES.includes(fields.status)) problems.push('Choose a supported material status or Not recorded.');
  return problems.length ? fail('VALIDATION', problems) : { ok: true, fields: copy(fields) };
}
function readRevision(value) {
  const safe = safeData(value); if (!safe.ok) return safe;
  if (!shape(value, ['kind', 'recordVersion', 'materialId', 'revisionId', 'parentRevisionId', 'revisionNumber', 'jobId', 'jobRevisionId', 'createdAt', 'savedAt', 'producer', 'item', 'changeReason'])) return fail('CORRUPT', 'Material record shape is unsupported.');
  if (value.kind !== KIND || value.recordVersion !== VERSION) return fail('UNSUPPORTED', 'Unsupported material record version.');
  const r = value, initial = r.revisionNumber === 1, fields = validateFields(r.item);
  if (!fields.ok) return fail('CORRUPT', fields.problems);
  if (typeof r.materialId !== 'string' || !ID.test(r.materialId) || typeof r.revisionId !== 'string' || !REV_ID.test(r.revisionId) || typeof r.jobId !== 'string' || !JOB_ID.test(r.jobId) || typeof r.jobRevisionId !== 'string' || !JOB_REV_ID.test(r.jobRevisionId)) return fail('CORRUPT', 'Invalid material or job identity.');
  if (!Number.isSafeInteger(r.revisionNumber) || r.revisionNumber < 1 || r.revisionNumber > MAX_REVISIONS || !utc(r.createdAt) || !utc(r.savedAt)) return fail('CORRUPT', 'Invalid revision number or save timestamps.');
  if (initial ? r.parentRevisionId !== null || r.createdAt !== r.savedAt || r.changeReason !== '' : typeof r.parentRevisionId !== 'string' || !REV_ID.test(r.parentRevisionId) || r.parentRevisionId === r.revisionId || typeof r.changeReason !== 'string' || !r.changeReason.trim() || r.changeReason.length > 1000) return fail('CORRUPT', 'Invalid revision parent or change explanation.');
  if (!shape(r.producer, ['applicationRevision', 'recordContractRevision']) || typeof r.producer.applicationRevision !== 'string' || !r.producer.applicationRevision.trim() || r.producer.applicationRevision.length > 160 || r.producer.recordContractRevision !== 1) return fail('CORRUPT', 'Invalid producer.');
  return { ok: true, revision: copy(r) };
}
function make(fields, meta, current, reason) {
  if (!safeData(meta).ok || !shape(meta, current ? ['revisionId', 'jobRevisionId', 'savedAt'] : ['materialId', 'revisionId', 'jobId', 'jobRevisionId', 'savedAt'])) return fail('VALIDATION', 'Invalid material metadata.');
  const f = validateFields(fields); if (!f.ok) return f;
  let old = null;
  if (current) { const r = readRevision(current); if (!r.ok) return r; old = r.revision; }
  if (!utc(meta.savedAt) || typeof meta.revisionId !== 'string' || !REV_ID.test(meta.revisionId) || typeof meta.jobRevisionId !== 'string' || !JOB_REV_ID.test(meta.jobRevisionId)) return fail('VALIDATION', 'Invalid revision metadata.');
  if (old && FIELDS.every(k => old.item[k] === f.fields[k])) return { ok: true, revision: old, unchanged: true };
  if (old && old.revisionNumber >= MAX_REVISIONS) return fail('LIMIT', 'Maximum number of material versions reached.');
  if (old && (typeof reason !== 'string' || !reason.trim() || reason.length > 1000)) return fail('VALIDATION', 'Explain why this material entry is changing (maximum 1000 characters).');
  const r = { kind: KIND, recordVersion: VERSION, materialId: old ? old.materialId : meta.materialId, revisionId: meta.revisionId, parentRevisionId: old ? old.revisionId : null, revisionNumber: old ? old.revisionNumber + 1 : 1, jobId: old ? old.jobId : meta.jobId, jobRevisionId: meta.jobRevisionId, createdAt: old ? old.createdAt : meta.savedAt, savedAt: meta.savedAt, producer: copy(PRODUCER), item: f.fields, changeReason: old ? reason : '' };
  return readRevision(r);
}
function assemble(rows, jobId) {
  if (!Array.isArray(rows) || rows.length > MAX_JOB_ROWS) return fail('LIMIT', 'Material history exceeds the supported per-job limit.');
  const groups = new Map(), ids = new Set();
  for (const row of rows) {
    const parsed = readRevision(row); if (!parsed.ok) return parsed;
    const r = parsed.revision;
    if (r.jobId !== jobId || ids.has(r.revisionId)) return fail('CORRUPT', 'Material job identity or revision uniqueness mismatch.');
    ids.add(r.revisionId); if (!groups.has(r.materialId)) groups.set(r.materialId, []); groups.get(r.materialId).push(r);
  }
  if (groups.size > MAX_MATERIALS) return fail('LIMIT', 'Too many material entries for this job.');
  const materials = [];
  for (const revisions of groups.values()) {
    revisions.sort((a, b) => a.revisionNumber - b.revisionNumber);
    for (let i = 0; i < revisions.length; i++) {
      const r = revisions[i], parent = revisions[i - 1];
      if (r.revisionNumber !== i + 1 || r.parentRevisionId !== (parent ? parent.revisionId : null) || r.createdAt !== revisions[0].createdAt) return fail('CORRUPT', 'Material history has a missing parent, duplicate sequence or changed creation time.');
    }
    materials.push({ current: revisions[revisions.length - 1], history: revisions.slice().reverse() });
  }
  materials.sort((a, b) => a.current.createdAt === b.current.createdAt ? a.current.materialId.localeCompare(b.current.materialId) : a.current.createdAt > b.current.createdAt ? -1 : 1);
  return { ok: true, materials };
}
module.exports = { KIND, VERSION, PRODUCER, UNITS, COUNT_UNITS, STATUSES, FIELDS, ID, REV_ID, JOB_ID, MAX_REVISIONS, MAX_MATERIALS, MAX_JOB_ROWS, MAX_TOTAL_ROWS, safeData, validateFields, readRevision, assemble,
  createInitial: (fields, meta) => make(fields, meta, null, ''),
  createUpdate: (current, fields, reason, meta) => make(fields, meta, current, reason) };
