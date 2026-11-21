'use strict';
/** Manual field observations. No calculator dependency, conversion or approval. */
const KIND = 'empire-code.measurement-revision';
const VERSION = 1;
const PRODUCER = Object.freeze({ applicationRevision: 'LC-JOB-MEASUREMENTS-1', recordContractRevision: 1 });
const UNITS = Object.freeze({ voltage: Object.freeze(['V', 'mV']), current: Object.freeze(['A', 'mA']), resistance: Object.freeze(['ohm', 'kohm', 'Mohm']), temperature: Object.freeze(['degC', 'degF']), active_power: Object.freeze(['W', 'kW']), apparent_power: Object.freeze(['VA', 'kVA']), frequency: Object.freeze(['Hz']), length: Object.freeze(['mm', 'cm', 'm', 'in', 'ft']) });
const FIELDS = Object.freeze(['label', 'quantity', 'valueText', 'unit', 'location', 'measuredLocal', 'utcOffset', 'mode', 'instrument', 'notes']);
const ID = /^meas1_[0-9a-f]{32}$/;
const REV_ID = /^mrev1_[0-9a-f]{32}$/;
const JOB_ID = /^job1_[0-9a-f]{32}$/;
const JOB_REV_ID = /^jrev1_[0-9a-f]{32}$/;
const MAX_REVISIONS = 50, MAX_MEASUREMENTS = 500, MAX_JOB_ROWS = 2000, MAX_TOTAL_ROWS = 50000;
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
  catch (_) { return fail('VALIDATION', 'Unsupported, non-JSON or oversized measurement data.'); }
}
const copy = v => JSON.parse(JSON.stringify(v));
function shape(v, keys) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => own(v, k)); }
function utc(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) return false; try { return new Date(v).toISOString() === v; } catch (_) { return false; } }
function observedInstant(local, offset) {
  if (typeof local !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)) return null;
  if (typeof offset !== 'string' || !/^[+-]\d\d:\d\d$/.test(offset) || offset === '-00:00') return null;
  const hh = Number(offset.slice(1, 3)), mm = Number(offset.slice(4, 6));
  if (hh > 14 || mm > 59 || hh === 14 && mm !== 0) return null;
  const naive = new Date(local + ':00.000Z');
  if (!Number.isFinite(naive.getTime()) || naive.toISOString() !== local + ':00.000Z' || Number(local.slice(0, 4)) < 1) return null;
  const date = new Date(naive.getTime() - (offset[0] === '-' ? -1 : 1) * (hh * 60 + mm) * 60000);
  const result = date.toISOString(); return utc(result) ? result : null;
}
function validateFields(fields) {
  const safe = safeData(fields); if (!safe.ok) return safe;
  if (!shape(fields, FIELDS)) return fail('VALIDATION', 'Measurement fields are missing or unsupported.');
  const problems = [];
  function text(k, max, required) { if (typeof fields[k] !== 'string' || fields[k].length > max || required && !fields[k].trim()) problems.push(k + ': ' + (required ? 'nonblank ' : '') + 'text of at most ' + max + ' characters required.'); }
  text('label', 160, true); text('location', 500, true); text('instrument', 200, false); text('notes', 4000, false);
  if (typeof fields.quantity !== 'string' || !own(UNITS, fields.quantity) || typeof fields.unit !== 'string' || !UNITS[fields.quantity].includes(fields.unit)) problems.push('Choose a quantity and matching unit; units are never converted automatically.');
  if (typeof fields.valueText !== 'string' || fields.valueText.length > 64 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(fields.valueText.trim()) || !Number.isFinite(Number(fields.valueText))) problems.push('Enter a decimal value with a dot, without thousands separators or exponent notation.');
  if (!['not_recorded', 'AC', 'DC'].includes(fields.mode) || !['voltage', 'current'].includes(fields.quantity) && fields.mode !== 'not_recorded') problems.push('AC/DC applies only to voltage or current; otherwise choose Not recorded.');
  const measuredAt = observedInstant(fields.measuredLocal, fields.utcOffset);
  if (!measuredAt) problems.push('Enter a valid observed local date/time and UTC offset (+/-HH:MM).');
  return problems.length ? fail('VALIDATION', problems) : { ok: true, fields: copy(fields), measuredAt };
}
function readRevision(value) {
  const safe = safeData(value); if (!safe.ok) return safe;
  if (!shape(value, ['kind', 'recordVersion', 'measurementId', 'revisionId', 'parentRevisionId', 'revisionNumber', 'jobId', 'jobRevisionId', 'createdAt', 'savedAt', 'producer', 'reading', 'measuredAt', 'correctionReason'])) return fail('CORRUPT', 'Measurement record shape is unsupported.');
  if (value.kind !== KIND || value.recordVersion !== VERSION) return fail('UNSUPPORTED', 'Unsupported measurement record version.');
  const r = value, initial = r.revisionNumber === 1, fields = validateFields(r.reading);
  if (!fields.ok) return fail('CORRUPT', fields.problems);
  if (typeof r.measurementId !== 'string' || !ID.test(r.measurementId) || typeof r.revisionId !== 'string' || !REV_ID.test(r.revisionId) || typeof r.jobId !== 'string' || !JOB_ID.test(r.jobId) || typeof r.jobRevisionId !== 'string' || !JOB_REV_ID.test(r.jobRevisionId)) return fail('CORRUPT', 'Invalid measurement or job identity.');
  if (!Number.isSafeInteger(r.revisionNumber) || r.revisionNumber < 1 || r.revisionNumber > MAX_REVISIONS || !utc(r.createdAt) || !utc(r.savedAt)) return fail('CORRUPT', 'Invalid revision number or save timestamps.');
  if (initial ? r.parentRevisionId !== null || r.createdAt !== r.savedAt || r.correctionReason !== '' : typeof r.parentRevisionId !== 'string' || !REV_ID.test(r.parentRevisionId) || r.parentRevisionId === r.revisionId || typeof r.correctionReason !== 'string' || !r.correctionReason.trim() || r.correctionReason.length > 1000) return fail('CORRUPT', 'Invalid revision parent or correction explanation.');
  if (!shape(r.producer, ['applicationRevision', 'recordContractRevision']) || typeof r.producer.applicationRevision !== 'string' || !r.producer.applicationRevision.trim() || r.producer.applicationRevision.length > 160 || r.producer.recordContractRevision !== 1 || fields.measuredAt !== r.measuredAt) return fail('CORRUPT', 'Invalid producer or inconsistent measurement timestamp.');
  return { ok: true, revision: copy(r) };
}
function make(fields, meta, current, reason) {
  if (!safeData(meta).ok || !shape(meta, current ? ['revisionId', 'jobRevisionId', 'savedAt'] : ['measurementId', 'revisionId', 'jobId', 'jobRevisionId', 'savedAt'])) return fail('VALIDATION', 'Invalid measurement metadata.');
  const f = validateFields(fields); if (!f.ok) return f;
  let old = null;
  if (current) { const r = readRevision(current); if (!r.ok) return r; old = r.revision; }
  if (!utc(meta.savedAt) || typeof meta.revisionId !== 'string' || !REV_ID.test(meta.revisionId) || typeof meta.jobRevisionId !== 'string' || !JOB_REV_ID.test(meta.jobRevisionId)) return fail('VALIDATION', 'Invalid revision metadata.');
  if (old && FIELDS.every(k => old.reading[k] === f.fields[k])) return { ok: true, revision: old, unchanged: true };
  if (old && old.revisionNumber >= MAX_REVISIONS) return fail('LIMIT', 'Maximum number of corrections reached.');
  if (old && (typeof reason !== 'string' || !reason.trim() || reason.length > 1000)) return fail('VALIDATION', 'Explain why the recorded entry is being corrected (maximum 1000 characters).');
  const r = { kind: KIND, recordVersion: VERSION, measurementId: old ? old.measurementId : meta.measurementId, revisionId: meta.revisionId, parentRevisionId: old ? old.revisionId : null, revisionNumber: old ? old.revisionNumber + 1 : 1, jobId: old ? old.jobId : meta.jobId, jobRevisionId: meta.jobRevisionId, createdAt: old ? old.createdAt : meta.savedAt, savedAt: meta.savedAt, producer: copy(PRODUCER), reading: f.fields, measuredAt: f.measuredAt, correctionReason: old ? reason : '' };
  return readRevision(r);
}
function assemble(rows, jobId) {
  if (!Array.isArray(rows) || rows.length > MAX_JOB_ROWS) return fail('LIMIT', 'Measurement history exceeds the supported per-job limit.');
  const groups = new Map(), ids = new Set();
  for (const row of rows) {
    const parsed = readRevision(row); if (!parsed.ok) return parsed;
    const r = parsed.revision;
    if (r.jobId !== jobId || ids.has(r.revisionId)) return fail('CORRUPT', 'Measurement job identity or revision uniqueness mismatch.');
    ids.add(r.revisionId); if (!groups.has(r.measurementId)) groups.set(r.measurementId, []); groups.get(r.measurementId).push(r);
  }
  if (groups.size > MAX_MEASUREMENTS) return fail('LIMIT', 'Too many measurement entries for this job.');
  const measurements = [];
  for (const revisions of groups.values()) {
    revisions.sort((a, b) => a.revisionNumber - b.revisionNumber);
    for (let i = 0; i < revisions.length; i++) {
      const r = revisions[i], parent = revisions[i - 1];
      if (r.revisionNumber !== i + 1 || r.parentRevisionId !== (parent ? parent.revisionId : null) || r.createdAt !== revisions[0].createdAt) return fail('CORRUPT', 'Measurement history has a missing parent, duplicate sequence or changed creation time.');
    }
    measurements.push({ current: revisions[revisions.length - 1], history: revisions.slice().reverse() });
  }
  measurements.sort((a, b) => a.current.measuredAt === b.current.measuredAt ? a.current.measurementId.localeCompare(b.current.measurementId) : a.current.measuredAt > b.current.measuredAt ? -1 : 1);
  return { ok: true, measurements };
}
module.exports = { KIND, VERSION, PRODUCER, UNITS, FIELDS, ID, REV_ID, JOB_ID, MAX_REVISIONS, MAX_MEASUREMENTS, MAX_JOB_ROWS, MAX_TOTAL_ROWS, safeData, observedInstant, validateFields, readRevision, assemble,
  createInitial: (fields, meta) => make(fields, meta, null, ''),
  createCorrection: (current, fields, reason, meta) => make(fields, meta, current, reason) };
