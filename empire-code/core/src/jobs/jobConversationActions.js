'use strict';
/**
 * STAGE5 conversation -> job actions: one appended job note, or one measurement.
 *
 * review -> explicit confirmation -> the ORIGINAL job history. This module owns no
 * database and no record contract:
 *   note        -> jobCardStore.save(): a new job-card revision in which only `notes` changed;
 *   measurement -> jobMeasurementStore.create(): one initial revision, written by that store's own
 *                  single transaction. No capture (voice) journal marker is created: one record needs
 *                  no multi-action journal, so nothing can stay pending outside the receipt.
 * validate() is pure and synchronous. prepare() is deterministic (no storage, clock or
 * randomness); it is asynchronous only because SHA-256 comes from the injected Web Crypto.
 * Record identities are SHA-256 derived from source + source revision + job + content, so a
 * repeated confirmation, a retry after a lost acknowledgement or a reload can only find the
 * record that is already stored. The host owns source identity/revision/time and the job
 * choice; an action carries no job reference and no identifier.
 */
const Job = require('./jobCard.js');
const JobStore = require('./jobCardStore.js');
const Measurement = require('./jobMeasurement.js');
const MeasurementStore = require('./jobMeasurementStore.js');

const PLAN_KIND = 'empire-code.job-action-plan';
const RECEIPT_KIND = 'empire-code.job-action-receipt';
const VERSION = 1;
/** sourceText equals the /api/assist utterance limit (docs/assistant-api-contract.md: 1..3000). */
const LIMITS = Object.freeze({ sourceText: 3000, noteText: 4000, sourceRevision: 100, jobNotes: Job.LIMITS.notes });
/** Inserted between existing non-empty notes and the appended text. Existing notes stay an exact prefix. */
const NOTE_SEPARATOR = '\n\n';
/** The exclusive lock the original capture journal (jobVoiceBatch) holds while it creates measurements:
 * a confirmed conversation measurement and a voice capture never interleave. */
const MEASUREMENT_LOCK = 'empire-code-voice-save-v1';
const STATUS = Object.freeze({ CONFIRMED: 'confirmed', PENDING: 'pending', CONFLICT: 'conflict', REFUSED: 'refused' });
const RECEIPT_STATES = Object.freeze(['pending', 'confirmed', 'conflict']);
const INPUT_KEYS = ['sourceId', 'sourceRevision', 'sourceSavedAt', 'sourceText', 'job', 'action'];
const PLAN_KEYS = ['kind', 'version', 'id', 'action', 'binding', 'job', 'record'];
const BINDING_KEYS = ['inputHash', 'sourceFingerprint', 'sourceId', 'sourceRevision', 'sourceSavedAt'];
const PLAN_JOB_KEYS = ['jobId', 'jobRevisionId', 'revisionNumber'];
const NOTE_RECORD_KEYS = ['revisionId', 'parentRevisionId', 'revisionNumber', 'savedAt', 'recordHash', 'text', 'separator'];
const MEASUREMENT_RECORD_KEYS = ['measurementId', 'revisionId', 'savedAt', 'measuredAt', 'recordHash', 'fields'];
const RECEIPT_KEYS = ['kind', 'version', 'state', 'planId', 'action', 'sourceId', 'sourceRevision', 'sourceFingerprint', 'inputHash', 'jobId', 'jobRevisionId', 'record'];
/** `journalPlanId` is kept so the closed receipt shape is unchanged; it is always null (no journal exists). */
const RECEIPT_RECORD_KEYS = ['store', 'id', 'revisionId', 'recordHash', 'journalPlanId'];
const SOURCE_ID_RE = /^conv1_[0-9a-f]{32}$/;
const PLAN_ID_RE = /^jact1_[0-9a-f]{32}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
/** Failure codes after which repeating the same plan cannot succeed: the plan must be reviewed again. */
const DEFINITIVE = ['VALIDATION', 'INVALID', 'LIMIT', 'CORRUPT', 'UNSUPPORTED', 'CONFIRMATION', 'NOT_FOUND', 'JOB_UNAVAILABLE'];

const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const copy = (v) => JSON.parse(JSON.stringify(v));
const canonical = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
    : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
function problemsOf(result) {
  const list = result && Array.isArray(result.problems) ? result.problems.filter((p) => typeof p === 'string').slice(0, 24) : [];
  return list.length ? list : ['The operation was refused.'];
}
function refuse(code, problems, extra) {
  return Object.assign({ ok: false, status: STATUS.REFUSED, code, problems: Array.isArray(problems) ? problems : [problems] }, extra || {});
}
function utc(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) return false;
  try { return new Date(v).toISOString() === v; } catch (_) { return false; }
}
const boundedText = (v, max) => typeof v === 'string' && v.length <= max && !!v.trim() && !CONTROL_RE.test(v);
/** Exact own enumerable data properties, read through descriptors only: a getter is never executed. */
function exact(value, keys) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    if (Reflect.ownKeys(value).length !== keys.length) return null;
    const out = {};
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !own(d, 'value') || !d.enumerable) return null;
      out[key] = d.value;
    }
    return out;
  } catch (_) { return null; }
}

/* ---------------------------------------------------------------- input */

function capture(input) {
  const x = exact(input, INPUT_KEYS);
  if (!x) return refuse('INVALID', 'Expected plain input with exactly: ' + INPUT_KEYS.join(', ') + '.');
  if (typeof x.sourceId !== 'string' || !SOURCE_ID_RE.test(x.sourceId) || !Number.isSafeInteger(x.sourceRevision) || x.sourceRevision < 0 || !utc(x.sourceSavedAt)) {
    return refuse('INVALID', 'Invalid app-owned source identity, revision or save time.');
  }
  if (x.sourceRevision > LIMITS.sourceRevision) return refuse('LIMIT', 'The source revision exceeds the supported limit of ' + LIMITS.sourceRevision + '. Nothing was changed.');
  if (typeof x.sourceText !== 'string' || !x.sourceText.trim() || CONTROL_RE.test(x.sourceText)) return refuse('INVALID', 'The original source text is required as plain text.');
  if (x.sourceText.length > LIMITS.sourceText) return refuse('LIMIT', 'The source text exceeds ' + LIMITS.sourceText + ' characters. Nothing was shortened.');
  const job = exact(x.job, ['head', 'revision']);
  if (!job) return refuse('JOB_REQUIRED', 'A saved job (current head and revision) chosen in the app is required.');
  const head = Job.readHead(job.head); const revision = Job.readRevision(job.revision);
  if (!head.ok || !revision.ok || head.head.jobId !== revision.revision.jobId || head.head.currentRevisionId !== revision.revision.revisionId
    || head.head.revisionNumber !== revision.revision.revisionNumber) return refuse('JOB_REQUIRED', 'The saved job identity or revision is missing or inconsistent.');
  // sourceSavedAt becomes the record time. A record dated before the job revision it is attached to would
  // misstate the order of events, so it is refused here; the time is never adjusted and no clock is read.
  if (Date.parse(x.sourceSavedAt) < Date.parse(revision.revision.savedAt)) {
    return refuse('SOURCE_OUTDATED', 'The reviewed source was saved before the current job revision. Save the reviewed proposal again, then review it against the current job. Nothing was saved.');
  }
  const kind = x.action !== null && typeof x.action === 'object' && !Array.isArray(x.action) ? Object.getOwnPropertyDescriptor(x.action, 'kind') : null;
  const kindValue = kind && own(kind, 'value') ? kind.value : null;
  let action;
  if (kindValue === 'note') {
    const a = exact(x.action, ['kind', 'text']);
    if (!a || typeof a.text !== 'string' || !a.text.trim() || CONTROL_RE.test(a.text)) return refuse('INVALID', 'A note action is exactly { kind: "note", text } with non-blank plain text.');
    if (a.text.length > LIMITS.noteText) return refuse('LIMIT', 'The note exceeds ' + LIMITS.noteText + ' characters. Nothing was shortened.');
    action = { kind: 'note', text: a.text };
  } else if (kindValue === 'measurement') {
    const a = exact(x.action, ['kind', 'fields']);
    if (!a) return refuse('INVALID', 'A measurement action is exactly { kind: "measurement", fields }.');
    // The original model decides: exact canonical field set, listed quantity/unit pairs, a finite decimal
    // value and an explicit observed local time + UTC offset. Nothing is inferred, converted or defaulted.
    const checked = Measurement.validateFields(a.fields);
    if (!checked.ok) return refuse('VALIDATION', problemsOf(checked));
    action = { kind: 'measurement', fields: checked.fields };
  } else return refuse('INVALID', 'Unsupported action. Only "note" and "measurement" exist.');
  return { ok: true, input: { sourceId: x.sourceId, sourceRevision: x.sourceRevision, sourceSavedAt: x.sourceSavedAt, sourceText: x.sourceText,
    job: { head: head.head, revision: revision.revision }, action } };
}
/** Pure, synchronous. Returns an independent validated copy; never touches storage, time or crypto. */
function validate(input) {
  try { return capture(input); } catch (_) { return refuse('INVALID', 'The input could not be validated. Nothing was saved.'); }
}

/* ---------------------------------------------------------------- hashing */

function digestOf(crypto) { return crypto && crypto.subtle && typeof crypto.subtle.digest === 'function' ? crypto.subtle : null; }
async function sha256(value, subtle) {
  let bytes;
  try {
    const result = await subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
    bytes = new Uint8Array(result);
    if (bytes.length !== 32) throw new Error('Invalid digest length');
  } catch (_) { throw Object.assign(new Error('Required digest unavailable'), { actionCode: 'UNAVAILABLE' }); }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------------------------------------------------------- plan */

function validatePlanShape(value) {
  if (!Measurement.safeData(value).ok) return null;
  const p = exact(value, PLAN_KEYS); if (!p) return null;
  const b = exact(p.binding, BINDING_KEYS); const j = exact(p.job, PLAN_JOB_KEYS);
  if (!b || !j || p.kind !== PLAN_KIND || p.version !== VERSION || typeof p.id !== 'string' || !PLAN_ID_RE.test(p.id)) return null;
  if (typeof b.inputHash !== 'string' || !HASH_RE.test(b.inputHash) || typeof b.sourceFingerprint !== 'string' || !HASH_RE.test(b.sourceFingerprint)
    || typeof b.sourceId !== 'string' || !SOURCE_ID_RE.test(b.sourceId) || !Number.isSafeInteger(b.sourceRevision) || b.sourceRevision < 0
    || b.sourceRevision > LIMITS.sourceRevision || !utc(b.sourceSavedAt)) return null;
  if (typeof j.jobId !== 'string' || !Job.JOB_ID_RE.test(j.jobId) || typeof j.jobRevisionId !== 'string' || !Job.REVISION_ID_RE.test(j.jobRevisionId)
    || !Number.isSafeInteger(j.revisionNumber) || j.revisionNumber < 1) return null;
  if (p.action === 'note') {
    const r = exact(p.record, NOTE_RECORD_KEYS);
    if (!r || typeof r.revisionId !== 'string' || !Job.REVISION_ID_RE.test(r.revisionId) || r.revisionId === j.jobRevisionId || r.parentRevisionId !== j.jobRevisionId
      || r.revisionNumber !== j.revisionNumber + 1 || r.savedAt !== b.sourceSavedAt || typeof r.recordHash !== 'string' || !HASH_RE.test(r.recordHash)
      || !boundedText(r.text, LIMITS.noteText) || r.separator !== '' && r.separator !== NOTE_SEPARATOR) return null;
    return copy(value);
  }
  if (p.action === 'measurement') {
    const r = exact(p.record, MEASUREMENT_RECORD_KEYS);
    if (!r || typeof r.measurementId !== 'string' || !Measurement.ID.test(r.measurementId) || typeof r.revisionId !== 'string' || !Measurement.REV_ID.test(r.revisionId)
      || r.savedAt !== b.sourceSavedAt || !utc(r.measuredAt) || typeof r.recordHash !== 'string' || !HASH_RE.test(r.recordHash)) return null;
    // The reviewed reading itself, checked by the original model; the observed instant must be its own.
    const fields = Measurement.validateFields(r.fields);
    if (!fields.ok || fields.measuredAt !== r.measuredAt) return null;
    return copy(value);
  }
  return null;
}
/** Pure, synchronous closed-shape check of a plan (for example one read back from the host's pending marker). */
function validatePlan(plan) {
  try { const checked = validatePlanShape(plan); return checked ? { ok: true, plan: checked } : refuse('INVALID', 'Unsupported or altered job action plan.'); }
  catch (_) { return refuse('INVALID', 'Unsupported or altered job action plan.'); }
}
function receiptOf(plan, state) {
  const note = plan.action === 'note';
  return { kind: RECEIPT_KIND, version: VERSION, state, planId: plan.id, action: plan.action,
    sourceId: plan.binding.sourceId, sourceRevision: plan.binding.sourceRevision, sourceFingerprint: plan.binding.sourceFingerprint, inputHash: plan.binding.inputHash,
    jobId: plan.job.jobId, jobRevisionId: plan.job.jobRevisionId,
    record: { store: note ? 'job-card' : 'measurement', id: note ? plan.job.jobId : plan.record.measurementId, revisionId: plan.record.revisionId,
      recordHash: plan.record.recordHash, journalPlanId: null } };
}
function validateReceiptShape(value) {
  if (!Measurement.safeData(value).ok) return null;
  const r = exact(value, RECEIPT_KEYS); if (!r) return null;
  const rec = exact(r.record, RECEIPT_RECORD_KEYS); if (!rec) return null;
  if (r.kind !== RECEIPT_KIND || r.version !== VERSION || !RECEIPT_STATES.includes(r.state) || typeof r.planId !== 'string' || !PLAN_ID_RE.test(r.planId)
    || typeof r.sourceId !== 'string' || !SOURCE_ID_RE.test(r.sourceId) || !Number.isSafeInteger(r.sourceRevision) || r.sourceRevision < 0 || r.sourceRevision > LIMITS.sourceRevision
    || typeof r.sourceFingerprint !== 'string' || !HASH_RE.test(r.sourceFingerprint) || typeof r.inputHash !== 'string' || !HASH_RE.test(r.inputHash)
    || typeof r.jobId !== 'string' || !Job.JOB_ID_RE.test(r.jobId) || typeof r.jobRevisionId !== 'string' || !Job.REVISION_ID_RE.test(r.jobRevisionId)
    || typeof rec.recordHash !== 'string' || !HASH_RE.test(rec.recordHash) || typeof rec.revisionId !== 'string' || typeof rec.id !== 'string'
    || rec.journalPlanId !== null) return null;
  if (r.action === 'note') {
    if (rec.store !== 'job-card' || rec.id !== r.jobId || !Job.REVISION_ID_RE.test(rec.revisionId)) return null;
  } else if (r.action === 'measurement') {
    if (rec.store !== 'measurement' || !Measurement.ID.test(rec.id) || !Measurement.REV_ID.test(rec.revisionId)) return null;
  } else return null;
  return copy(value);
}
/** Pure, synchronous closed-shape check of a receipt the host persisted. */
function validateReceipt(receipt) {
  try { const checked = validateReceiptShape(receipt); return checked ? { ok: true, receipt: checked } : refuse('INVALID', 'Unsupported or altered job action receipt.'); }
  catch (_) { return refuse('INVALID', 'Unsupported or altered job action receipt.'); }
}
/** The bounded object the host persists: `pending` BEFORE commit(), then the one returned by commit()/reconcile(). */
function pendingReceipt(plan) {
  const checked = validatePlan(plan);
  return checked.ok ? { ok: true, receipt: receiptOf(checked.plan, 'pending') } : checked;
}

async function build(x, subtle) {
  const jobId = x.job.head.jobId; const jobRevisionId = x.job.head.currentRevisionId; const old = x.job.revision;
  const sourceFingerprint = await sha256(['ec-job-action-source-v1', x.sourceId, x.sourceRevision, x.sourceSavedAt, x.sourceText], subtle);
  const inputHash = await sha256(['ec-job-action-binding-v1', x], subtle);
  const id = 'jact1_' + (await sha256(['ec-job-action-plan-v1', inputHash], subtle)).slice(0, 32);
  const binding = { inputHash, sourceFingerprint, sourceId: x.sourceId, sourceRevision: x.sourceRevision, sourceSavedAt: x.sourceSavedAt };
  const job = { jobId, jobRevisionId, revisionNumber: old.revisionNumber };
  let record; let expected; let review;
  if (x.action.kind === 'note') {
    const text = x.action.text; const separator = old.notes === '' ? '' : NOTE_SEPARATOR;
    const total = old.notes.length + separator.length + text.length;
    if (total > LIMITS.jobNotes) {
      return refuse('LIMIT', 'This job\'s notes would reach ' + total + ' characters; the limit is ' + LIMITS.jobNotes + ' (' + Math.max(0, LIMITS.jobNotes - old.notes.length - separator.length)
        + ' available). Nothing was shortened and nothing was saved.');
    }
    const notes = old.notes + separator + text;
    // Identity excludes the reviewed revision on purpose: the same source action cannot be appended twice
    // to one job even when it is reviewed again against a later head.
    const revisionId = 'jrev1_' + (await sha256(['ec-job-action-note-revision-v1', x.sourceId, x.sourceRevision, jobId, text], subtle)).slice(0, 32);
    if (revisionId === old.revisionId) return refuse('COLLISION','The derived revision identity equals the reviewed revision. Nothing was saved.');
    const made = Job.createNextRevision(old, { title: old.title, address: old.address, notes }, [], { revisionId, savedAt: x.sourceSavedAt });
    if (!made.ok) return refuse(made.code === 'LIMIT' ? 'LIMIT' : 'VALIDATION', problemsOf(made));
    if (made.unchanged) return refuse('INVALID', 'The note would not change the job card.');
    expected = made.revision;
    record = { revisionId, parentRevisionId: old.revisionId, revisionNumber: expected.revisionNumber, savedAt: x.sourceSavedAt,
      recordHash: await sha256(expected, subtle), text, separator };
    review = { action: 'note', jobTitle: old.title, appendedText: text, separator, notesBefore: old.notes, notesAfter: notes, expectedRecord: expected };
  } else {
    const fields = x.action.fields; const identity = [x.sourceId, x.sourceRevision, jobId, fields];
    const measurementId = 'meas1_' + (await sha256(['ec-job-action-measurement-v1'].concat(identity), subtle)).slice(0, 32);
    const revisionId = 'mrev1_' + (await sha256(['ec-job-action-measurement-revision-v1'].concat(identity), subtle)).slice(0, 32);
    // Exactly the record jobMeasurementStore.create() builds from the pinned identities, the reviewed job
    // revision and the pinned time.
    const made = Measurement.createInitial(fields, { measurementId, revisionId, jobId, jobRevisionId, savedAt: x.sourceSavedAt });
    if (!made.ok) return refuse('VALIDATION', problemsOf(made));
    expected = made.revision;
    record = { measurementId, revisionId, savedAt: x.sourceSavedAt, measuredAt: expected.measuredAt, recordHash: await sha256(expected, subtle), fields: copy(fields) };
    review = { action: 'measurement', jobTitle: old.title, fields: copy(fields), measuredAt: expected.measuredAt, expectedRecord: expected };
  }
  const plan = { kind: PLAN_KIND, version: VERSION, id, action: x.action.kind, binding, job, record };
  if (!validatePlanShape(plan)) return refuse('INVALID', 'Could not prepare a bounded plan. Nothing was saved.');
  return { ok: true, plan, review };
}
/** Deterministic review step. Same input -> identical plan. Writes nothing and reads no storage. */
async function prepare(input, options) {
  try {
    // Captured synchronously: later changes to the caller's objects cannot reach the plan.
    const captured = capture(input); if (!captured.ok) return captured;
    const subtle = digestOf(options && options.crypto);
    if (!subtle) return refuse('UNAVAILABLE', 'Web Crypto SHA-256 is required; no unstable fallback identity was allocated.');
    return await build(captured.input, subtle);
  } catch (e) {
    return e && e.actionCode === 'UNAVAILABLE' ? refuse('UNAVAILABLE', 'Required SHA-256 could not complete. Nothing was saved.')
      : refuse('INVALID', 'Could not prepare a bounded plan. Nothing was saved.');
  }
}

/* ---------------------------------------------------------------- storage */

/** One-shot source of exactly the allocated 128-bit identities, in the order the original store draws them.
 * A further request (the store retrying after a collision) is refused, so no second identity is ever drawn. */
function pinnedRandom(ids) {
  const queue = ids.map((id) => id.split('_')[1]); const state = { exhausted: false };
  return { state, crypto: { getRandomValues(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 16 || !queue.length) { state.exhausted = true; throw new Error('Allocated identity collision; re-review required'); }
    const hex = queue.shift();
    for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  } } };
}
/** Read-only: is exactly the planned record in the original history? stored | absent | conflict | unknown. */
async function inspect(receipt, stores, subtle) {
  try {
    let found = null;
    if (receipt.action === 'note') {
      const result = await stores.jobs.readHistorical(receipt.jobId, receipt.record.revisionId);
      if (result && result.ok && result.revision) found = result.revision;
      else if (result && result.code === 'NOT_FOUND') return { state: 'absent' };
      else return { state: 'unknown', code: result && typeof result.code === 'string' ? result.code : 'UNAVAILABLE', problems: problemsOf(result) };
    } else {
      const result = await stores.measurements().read(receipt.jobId, receipt.record.id);
      if (result && result.ok && Array.isArray(result.history)) {
        found = result.history.find((r) => r.revisionId === receipt.record.revisionId) || null;
        if (!found) return { state: 'conflict', existing: { id: receipt.record.id, revisionId: null } };
      } else if (result && result.code === 'NOT_FOUND') return { state: 'absent' };
      else return { state: 'unknown', code: result && typeof result.code === 'string' ? result.code : 'UNAVAILABLE', problems: problemsOf(result) };
    }
    // Exact identity only: every stored field, in canonical form, must hash to the reviewed record.
    if (await sha256(found, subtle) === receipt.record.recordHash) return { state: 'stored' };
    return { state: 'conflict', existing: { id: receipt.record.id, revisionId: found.revisionId, savedAt: found.savedAt,
      revisionNumber: found.revisionNumber, parentRevisionId: found.parentRevisionId } };
  } catch (_) { return { state: 'unknown', code: 'UNAVAILABLE', problems: ['Stored history could not be read. No success is assumed.'] }; }
}
function openStores(indexedDB, jobOptions, measurementOptions) {
  const jobs = JobStore.createJobStore(indexedDB, jobOptions || {});
  let measurements = null;
  return { jobs,
    measurements() { if (!measurements) measurements = MeasurementStore.createMeasurementStore(indexedDB, measurementOptions || {}); return measurements; },
    close() { try { jobs.close(); } catch (_) { /* nothing to repair */ } try { if (measurements) measurements.close(); } catch (_) { /* nothing to repair */ } } };
}
const confirmed = (plan, reconciled) => ({ ok: true, status: STATUS.CONFIRMED, reconciled, receipt: receiptOf(plan, 'confirmed') });
function conflict(plan, problems, existing) {
  return { ok: false, status: STATUS.CONFLICT, code: 'CONFLICT', problems: Array.isArray(problems) ? problems : [problems], existing: existing || null, receipt: receiptOf(plan, 'conflict') };
}
const pending = (plan, code, problems, stored) => ({ ok: false, status: STATUS.PENDING, code, problems: Array.isArray(problems) ? problems : [problems], stored, receipt: receiptOf(plan, 'pending') });
const CONFLICT_TEXT = 'The allocated record identity already holds different data. Nothing was overwritten and nothing was appended.';
const LOST_TEXT = 'The save acknowledgement is unavailable. Keep the pending receipt and reconcile; do not prepare a duplicate.';
/** Classify a failed write only after re-reading the original history. Nothing is written here. */
async function afterFailure(plan, failure, stores, subtle, collided) {
  const code = failure && typeof failure.code === 'string' ? failure.code : 'UNAVAILABLE'; const problems = problemsOf(failure);
  const seen = await inspect(receiptOf(plan, 'pending'), stores, subtle);
  // The exact reviewed record is stored (this attempt after all, or another writer of the same plan).
  if (seen.state === 'stored') return confirmed(plan, true);
  // Unreadable history is never classified: neither as absent nor as a conflict.
  if (seen.state === 'unknown') return pending(plan, code, problems.concat('The outcome could not be verified. Keep the pending receipt and reconcile before any new save.'), null);
  if (seen.state === 'conflict' || collided) return conflict(plan, CONFLICT_TEXT, seen.existing);
  if (code === 'CONFLICT' || code === 'JOB_CHANGED') return refuse('STALE', 'The job changed after review. Nothing was saved; review the action against the current job.', { stored: false });
  if (DEFINITIVE.includes(code)) return refuse(code, problems, { stored: false });
  return pending(plan, code, problems.concat('Nothing was saved. The same confirmed plan can be retried.'), false);
}

/**
 * Explicitly confirmed write. Order: confirmation gate -> exact re-preparation from the current input ->
 * (measurement: exclusive browser lock) -> read-only search for the already stored exact record -> current
 * saved job equals the reviewed job -> REQUIRED pending-marker hook -> one write through the original store
 * -> on any failure, the history is read again before the result is classified.
 * options: { crypto, indexedDB, locks (measurement only), persistPending (required for any new write: an async
 * function that resolves exactly `true` once the pending receipt is durable; otherwise PENDING_MARKER, nothing written) }.
 */
async function commit(plan, currentInput, confirmation, options) {
  let accepted = null; let entered = false;
  try {
    const o = options || {};
    // Gate first: without an exact explicit acceptance nothing is hashed, opened, read or written.
    if (!Measurement.safeData(confirmation).ok) return refuse('CONFIRMATION', 'Explicit confirmation of this exact plan is required. Nothing was saved.');
    const consent = exact(confirmation, ['accepted', 'planId']);
    if (!consent || typeof consent.accepted !== 'boolean' || typeof consent.planId !== 'string' || !PLAN_ID_RE.test(consent.planId)) return refuse('CONFIRMATION', 'Explicit confirmation of this exact plan is required. Nothing was saved.');
    if (consent.accepted !== true) return refuse('DECLINED', 'The action was not confirmed. Nothing was saved.');
    const checked = validatePlan(plan);
    if (!checked.ok || checked.plan.id !== consent.planId) return refuse('CONFIRMATION', 'The confirmation does not match this exact plan. Nothing was saved.');
    const captured = capture(currentInput); if (!captured.ok) return captured;
    const subtle = digestOf(o.crypto);
    if (!subtle) return refuse('UNAVAILABLE', 'Web Crypto SHA-256 is required. Nothing was saved.');
    if (!o.indexedDB || typeof o.indexedDB.open !== 'function') return refuse('UNAVAILABLE', 'Job storage is unavailable. Nothing was saved.');
    const fresh = await build(captured.input, subtle); if (!fresh.ok) return fresh;
    if (canonical(fresh.plan) !== canonical(checked.plan)) return refuse('STALE', 'The source, the job or the reviewed action has changed. Nothing was saved; review again.');
    accepted = fresh.plan; const x = captured.input; const reviewedJob = canonical(x.job); const isNote = accepted.action === 'note';
    if (!isNote && (!o.locks || typeof o.locks.request !== 'function')) return refuse('UNAVAILABLE', 'Exclusive browser locks are unavailable. Nothing was saved.');

    const run = async () => {
      entered = true;
      const pin = pinnedRandom(isNote ? [accepted.record.revisionId] : [accepted.record.measurementId, accepted.record.revisionId]);
      const pinned = { crypto: pin.crypto, now: () => accepted.record.savedAt };
      const sameJob = (r) => !!(r && r.ok && r.job) && canonical({ head: r.job.head, revision: r.job.revision }) === reviewedJob;
      let stores = null;
      // The measurement store's own job check (its `readJob` guard, run immediately before its transaction)
      // accepts only the exact reviewed job. Why it refused is kept here, because the store reports every
      // job problem as JOB_UNAVAILABLE.
      const guard = { refusal: null };
      const readReviewedJob = async (jobId) => {
        guard.refusal = null;
        let r = null;
        try { r = await stores.jobs.read(jobId); } catch (_) { r = null; }
        if (sameJob(r)) return r;
        if (r && r.ok && r.job) guard.refusal = { code: 'JOB_CHANGED', problems: ['The job changed after review.'] };
        else if (r && r.code === 'NOT_FOUND') guard.refusal = { code: 'JOB_UNAVAILABLE', problems: ['The saved job no longer exists. Nothing was saved.'] };
        else guard.refusal = { code: r && typeof r.code === 'string' ? r.code : 'UNAVAILABLE', problems: problemsOf(r) };
        return { ok: false, code: guard.refusal.code, problems: guard.refusal.problems };
      };
      try {
        stores = openStores(o.indexedDB, isNote ? pinned : {}, isNote ? {} : Object.assign({ readJob: readReviewedJob }, pinned));
        const lookup = receiptOf(accepted, 'pending');

        // 1. Never append again: an exact stored record ends the operation, whatever the job head is now.
        let seen = await inspect(lookup, stores, subtle);
        if (seen.state === 'conflict') return conflict(accepted, CONFLICT_TEXT, seen.existing);
        if (seen.state === 'unknown') return pending(accepted, seen.code, seen.problems.concat('Nothing was written by this attempt.'), null);
        if (seen.state === 'stored') return confirmed(accepted, true);

        // 2. Nothing is stored yet: the actual saved job must still be exactly the reviewed one.
        const current = await stores.jobs.read(accepted.job.jobId);
        const readable = !!(current && current.ok && current.job);
        if (!sameJob(current)) {
          // Another confirmation of this same plan may have completed meanwhile: look once more before refusing.
          seen = await inspect(lookup, stores, subtle);
          if (seen.state === 'stored') return confirmed(accepted, true);
          if (seen.state === 'conflict') return conflict(accepted, CONFLICT_TEXT, seen.existing);
          if (seen.state === 'unknown') return pending(accepted, seen.code, seen.problems.concat('Nothing was written by this attempt.'), null);
          if (readable) return refuse('STALE', 'The job changed after review. Nothing was saved; review the action against the current job.', { stored: false });
          const code = current && typeof current.code === 'string' ? current.code : 'UNAVAILABLE';
          if (code === 'NOT_FOUND') return refuse('JOB_UNAVAILABLE', 'The saved job no longer exists. Nothing was saved.', { stored: false });
          return DEFINITIVE.includes(code) ? refuse(code, problemsOf(current), { stored: false }) : pending(accepted, code, problemsOf(current).concat('Nothing was saved.'), false);
        }

        // 3. Mandatory host hook: the pending receipt must be durable before ANY new write. A missing, undefined,
        //    misspelled or non-function hook, a hook that throws and a hook that resolves anything but exactly
        //    `true` all refuse here, before the store is asked to write. Only the read-only paths above (the exact
        //    record is already stored) can answer without it.
        let recorded = false;
        try { recorded = typeof o.persistPending === 'function' && await o.persistPending(receiptOf(accepted, 'pending')) === true; } catch (_) { recorded = false; }
        if (!recorded) return refuse('PENDING_MARKER', 'The pending receipt could not be recorded first. Nothing was saved.', { stored: false });

        // 4. One write through the original store, with the allocated identities and time pinned.
        if (isNote) {
          const old = x.job.revision;
          const saved = await stores.jobs.save(accepted.job.jobId, accepted.job.jobRevisionId,
            { title: old.title, address: old.address, notes: old.notes + accepted.record.separator + accepted.record.text }, []);
          if (saved && saved.ok === true && saved.job && !saved.unchanged && canonical(saved.job.revision) === canonical(fresh.review.expectedRecord)) return confirmed(accepted, false);
          if (saved && saved.ok === true) return await afterFailure(accepted, { code: 'UNCERTAIN', problems: ['The stored revision differs from the reviewed plan.'] }, stores, subtle, true);
          return await afterFailure(accepted, saved, stores, subtle, pin.state.exhausted);
        }
        // Measurement: jobMeasurementStore.create() validates the fields again, checks the job through
        // readReviewedJob and adds the one row inside its own transaction (limits and identity uniqueness
        // included). If the job changed since step 2 the store refuses before its transaction: nothing is
        // written anywhere and no marker of any kind is left behind.
        const saved = await stores.measurements().create(accepted.job.jobId, accepted.record.fields);
        if (saved && saved.ok === true && saved.revision && canonical(saved.revision) === canonical(fresh.review.expectedRecord)) return confirmed(accepted, false);
        if (saved && saved.ok === true) return await afterFailure(accepted, { code: 'UNCERTAIN', problems: ['The stored reading differs from the reviewed plan.'] }, stores, subtle, true);
        return await afterFailure(accepted, guard.refusal || saved, stores, subtle, pin.state.exhausted);
      } finally { if (stores) stores.close(); }
    };

    if (isNote) return await run();
    // Measurement: search, job check and write run under one exclusive lock, so two confirmations of one
    // plan are serialized and the second one only finds the stored record.
    const result = await o.locks.request(MEASUREMENT_LOCK, { mode: 'exclusive' }, run);
    if (!entered) return refuse('UNAVAILABLE', 'The exclusive browser lock was not granted. Nothing was written by this attempt.');
    return result !== null && typeof result === 'object' ? result : pending(accepted, 'INTERRUPTED', LOST_TEXT, null);
  } catch (e) {
    if (entered && accepted) return pending(accepted, 'INTERRUPTED', LOST_TEXT, null);
    if (accepted) return refuse('UNAVAILABLE', 'The save could not start (the exclusive browser lock was not granted). Nothing was written by this attempt.');
    return e && e.actionCode === 'UNAVAILABLE' ? refuse('UNAVAILABLE', 'Required SHA-256 could not complete. Nothing was saved.') : refuse('INVALID', 'The action could not be validated. No save was attempted.');
  }
}

/**
 * Read-only recovery after a reload, a lost acknowledgement or an import. Never writes a record.
 * confirmed: the exact reviewed record is in the original history (even if the job head advanced).
 * pending + stored:false: it is not stored; pending + stored:null: storage could not answer.
 * options: { crypto, indexedDB }.
 */
async function reconcile(receipt, options) {
  let stores = null;
  try {
    const o = options || {};
    const checked = validateReceipt(receipt); if (!checked.ok) return checked;
    const r = checked.receipt;
    const subtle = digestOf(o.crypto);
    if (!subtle) return refuse('UNAVAILABLE', 'Web Crypto SHA-256 is required. Nothing was read or saved.');
    if (!o.indexedDB || typeof o.indexedDB.open !== 'function') return refuse('UNAVAILABLE', 'Job storage is unavailable. Nothing was read or saved.');
    stores = openStores(o.indexedDB, {}, {});
    const seen = await inspect(r, stores, subtle);
    const out = (state) => Object.assign({}, r, { state });
    if (seen.state === 'stored') return { ok: true, status: STATUS.CONFIRMED, reconciled: true, receipt: out('confirmed') };
    if (seen.state === 'conflict') return { ok: false, status: STATUS.CONFLICT, code: 'CONFLICT', problems: [CONFLICT_TEXT], existing: seen.existing || null, receipt: out('conflict') };
    if (seen.state === 'absent') return { ok: false, status: STATUS.PENDING, code: 'NOT_STORED', problems: ['This action is not in the job history. Nothing was written. Review and confirm it again, or discard the pending receipt.'], stored: false, receipt: out('pending') };
    return { ok: false, status: STATUS.PENDING, code: seen.code, problems: seen.problems.concat('The outcome is unknown. Keep the pending receipt.'), stored: null, receipt: out('pending') };
  } catch (_) { return refuse('UNAVAILABLE', 'The stored history could not be inspected. Keep the pending receipt.'); }
  finally { if (stores) stores.close(); }
}

module.exports = { PLAN_KIND, RECEIPT_KIND, VERSION, LIMITS, NOTE_SEPARATOR, STATUS, RECEIPT_STATES,
  validate, prepare, validatePlan, validateReceipt, pendingReceipt, commit, reconcile };
