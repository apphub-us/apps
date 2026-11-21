'use strict';
/**
 * LC-JOB-CARD-1: administrative card snapshots only. No calculator dependency,
 * storage, clock, randomness, reference resolution or electrical interpretation.
 * Reading validates the saved version; it never repairs or updates old metadata.
 */
const REVISION_KIND = 'empire-code.job-revision';
const HEAD_KIND = 'empire-code.job-head';
const RECORD_VERSION = 1;
const PRODUCER = Object.freeze({ applicationRevision: 'LC-JOB-CARD-1', recordContractRevision: 1 });
const LIMITS = Object.freeze({ title: 200, address: 2000, notes: 20000, links: 100, revisionText: 128 * 1024, nodes: 4000, depth: 16 });
const JOB_ID_RE = /^job1_[0-9a-f]{32}$/;
const REVISION_ID_RE = /^jrev1_[0-9a-f]{32}$/;
const RESULT_ID_RE = /^sr1_[0-9a-f]{32}$/;
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const failure = (problems, code) => ({ ok: false, code: code || 'VALIDATION', problems: problems.slice(0, 24) });
function errorText(e) {
  try { const message = e && e.message; return typeof message === 'string' ? message.slice(0, 2000) : 'operation refused'; }
  catch (_) { return 'operation refused'; }
}
function copy(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(copy);
  const out = {};
  for (const key of Object.keys(v)) Object.defineProperty(out, key, { value: copy(v[key]), enumerable: true, writable: true, configurable: true });
  return out;
}
/** Descriptor inspection precedes reads/cloning: getters and JSON-lossy values are refused. */
function dataProblems(value, where) {
  const problems = []; const stack = new Set(); let nodes = 0; let text = 0;
  const add = (s) => { if (problems.length < 24) problems.push(s); };
  function visit(v, at, depth) {
    if (problems.length >= 24) return;
    if (++nodes > LIMITS.nodes) { add(at + ': data node limit exceeded'); return; }
    if (depth > LIMITS.depth) { add(at + ': nesting limit exceeded'); return; }
    const type = typeof v;
    if (v === null || type === 'boolean') return;
    if (type === 'string') { text += v.length; if (text > LIMITS.revisionText) add(at + ': text limit exceeded'); return; }
    if (type === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) add(at + ': finite JSON number required; negative zero is unsupported'); return; }
    if (type !== 'object') { add(at + ': unsupported JSON value ' + type); return; }
    const array = Array.isArray(v);
    if (array ? Object.getPrototypeOf(v) !== Array.prototype : !plain(v)) { add(at + ': plain object or ordinary array required'); return; }
    if (stack.has(v)) { add(at + ': reference cycle'); return; }
    stack.add(v);
    const keys = Reflect.ownKeys(v);
    if (keys.length > LIMITS.nodes) { add(at + ': property limit exceeded'); stack.delete(v); return; }
    for (const key of keys) {
      if (typeof key !== 'string') { add(at + ': symbol key is unsupported'); continue; }
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (!descriptor || !own(descriptor, 'value')) { add(at + ': accessor is unsupported'); continue; }
      if (!descriptor.enumerable) { add(at + ': non-enumerable data would be lost'); continue; }
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) { add(at + ': extra array property would be lost'); continue; }
      text += key.length;
      visit(descriptor.value, at + (array ? '[' + key + ']' : '.' + key), depth + 1);
    }
    if (array) {
      if (v.length > LIMITS.nodes) add(at + ': array limit exceeded');
      else for (let i = 0; i < v.length; i++) if (!own(v, String(i))) add(at + ': array hole at ' + i);
    }
    stack.delete(v);
  }
  visit(value, where, 0);
  if (!problems.length && JSON.stringify(value).length > LIMITS.revisionText) add(where + ': serialized size exceeds ' + LIMITS.revisionText + ' UTF-16 code units');
  return problems;
}
function canonicalUtc(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false;
  try { return new Date(v).toISOString() === v; } catch (_) { return false; }
}
function checker() {
  const problems = [];
  const add = (s) => { if (problems.length < 24) problems.push(s); };
  function object(v, at, keys) {
    if (!plain(v)) { add(at + ': object required'); return false; }
    for (const key of keys) if (!own(v, key)) add(at + ': missing ' + key);
    for (const key of Object.keys(v)) if (!keys.includes(key)) add(at + ': unexpected key ' + JSON.stringify(key));
    return true;
  }
  function text(v, at, max, required) {
    if (typeof v !== 'string' || v.length > max || required && !v.trim()) add(at + ': ' + (required ? 'nonblank ' : '') + 'text, maximum ' + max + ' characters, required');
  }
  const id = (v, at, re) => { if (typeof v !== 'string' || !re.test(v)) add(at + ': unsupported ID'); };
  const utc = (v, at) => { if (!canonicalUtc(v)) add(at + ': canonical UTC millisecond timestamp required'); };
  const number = (v, at) => { if (!Number.isSafeInteger(v) || v < 1) add(at + ': positive safe integer required'); };
  const exact = (v, expected, at) => { if (v !== expected) add(at + ': expected ' + JSON.stringify(expected)); };
  return { problems, add, object, text, id, utc, number, exact };
}
function fieldsChecks(fields, c, at) {
  if (!c.object(fields, at, ['title', 'address', 'notes'])) return;
  c.text(fields.title, at + '.title', LIMITS.title, true);
  c.text(fields.address, at + '.address', LIMITS.address, false);
  c.text(fields.notes, at + '.notes', LIMITS.notes, false);
}
function linksChecks(links, c, at, stored) {
  if (!Array.isArray(links)) { c.add(at + ': array required'); return; }
  if (links.length > LIMITS.links) c.add(at + ': maximum ' + LIMITS.links + ' links');
  const ids = new Set();
  links.forEach((link, i) => {
    const p = at + '[' + i + ']';
    if (!c.object(link, p, stored ? ['serviceResultId', 'linkedAt', 'savedName', 'savedAt'] : ['serviceResultId', 'savedName', 'savedAt'])) return;
    c.id(link.serviceResultId, p + '.serviceResultId', RESULT_ID_RE);
    if (ids.has(link.serviceResultId)) c.add(p + ': duplicate service result ID');
    ids.add(link.serviceResultId);
    c.text(link.savedName, p + '.savedName', 200, true); c.utc(link.savedAt, p + '.savedAt');
    if (stored) c.utc(link.linkedAt, p + '.linkedAt');
  });
}
function revisionChecks(v) {
  const pre = dataProblems(v, 'revision'); if (pre.length) return pre;
  const c = checker();
  if (!c.object(v, 'revision', ['kind', 'recordVersion', 'jobId', 'revisionId', 'parentRevisionId', 'revisionNumber', 'createdAt', 'savedAt', 'producer', 'title', 'address', 'notes', 'serviceResultLinks'])) return c.problems;
  c.exact(v.kind, REVISION_KIND, 'revision.kind'); c.exact(v.recordVersion, RECORD_VERSION, 'revision.recordVersion');
  c.id(v.jobId, 'revision.jobId', JOB_ID_RE); c.id(v.revisionId, 'revision.revisionId', REVISION_ID_RE);
  c.number(v.revisionNumber, 'revision.revisionNumber'); c.utc(v.createdAt, 'revision.createdAt'); c.utc(v.savedAt, 'revision.savedAt');
  if (v.revisionNumber === 1) {
    c.exact(v.parentRevisionId, null, 'revision.parentRevisionId');
    c.exact(v.createdAt, v.savedAt, 'revision.createdAt');
  } else {
    c.id(v.parentRevisionId, 'revision.parentRevisionId', REVISION_ID_RE);
    if (v.parentRevisionId === v.revisionId) c.add('revision.parentRevisionId: cannot refer to itself');
  }
  if (c.object(v.producer, 'revision.producer', ['applicationRevision', 'recordContractRevision'])) {
    c.text(v.producer.applicationRevision, 'revision.producer.applicationRevision', 160, true);
    c.exact(v.producer.recordContractRevision, 1, 'revision.producer.recordContractRevision');
  }
  fieldsChecks({ title: v.title, address: v.address, notes: v.notes }, c, 'revision fields');
  linksChecks(v.serviceResultLinks, c, 'revision.serviceResultLinks', true);
  if (v.revisionNumber === 1 && Array.isArray(v.serviceResultLinks)) for (const link of v.serviceResultLinks) if (plain(link) && link.linkedAt !== v.savedAt) c.add('revision.serviceResultLinks: initial link time must equal revision savedAt');
  return c.problems;
}
function headChecks(v) {
  const pre = dataProblems(v, 'head'); if (pre.length) return pre;
  const c = checker();
  if (!c.object(v, 'head', ['kind', 'recordVersion', 'jobId', 'currentRevisionId', 'revisionNumber'])) return c.problems;
  c.exact(v.kind, HEAD_KIND, 'head.kind'); c.exact(v.recordVersion, RECORD_VERSION, 'head.recordVersion');
  c.id(v.jobId, 'head.jobId', JOB_ID_RE); c.id(v.currentRevisionId, 'head.currentRevisionId', REVISION_ID_RE); c.number(v.revisionNumber, 'head.revisionNumber');
  return c.problems;
}
function validateRevision(value) { try { return revisionChecks(value); } catch (e) { return ['revision validation refused: ' + errorText(e)]; } }
function validateHead(value) { try { return headChecks(value); } catch (e) { return ['head validation refused: ' + errorText(e)]; } }
function unsupported(value, kind) {
  if (!plain(value)) return false;
  const k = Object.getOwnPropertyDescriptor(value, 'kind'); const v = Object.getOwnPropertyDescriptor(value, 'recordVersion');
  return !!(k && own(k, 'value') && k.value !== kind || v && own(v, 'value') && v.value !== RECORD_VERSION);
}
function readRevision(value) {
  try { const p = validateRevision(value); return p.length ? failure(p, unsupported(value, REVISION_KIND) ? 'UNSUPPORTED' : 'VALIDATION') : { ok: true, revision: copy(value) }; }
  catch (e) { return failure(['revision read refused: ' + errorText(e)]); }
}
function readHead(value) {
  try { const p = validateHead(value); return p.length ? failure(p, unsupported(value, HEAD_KIND) ? 'UNSUPPORTED' : 'VALIDATION') : { ok: true, head: copy(value) }; }
  catch (e) { return failure(['head read refused: ' + errorText(e)]); }
}
function inputs(fields, links, metadata, initial) {
  for (const [value, at] of [[fields, 'fields'], [links, 'links'], [metadata, 'metadata']]) {
    const problems = dataProblems(value, at); if (problems.length) return failure(problems);
  }
  const c = checker(); fieldsChecks(fields, c, 'fields'); linksChecks(links, c, 'links', false);
  if (c.object(metadata, 'metadata', initial ? ['jobId', 'revisionId', 'savedAt'] : ['revisionId', 'savedAt'])) {
    if (initial) c.id(metadata.jobId, 'metadata.jobId', JOB_ID_RE);
    c.id(metadata.revisionId, 'metadata.revisionId', REVISION_ID_RE); c.utc(metadata.savedAt, 'metadata.savedAt');
  }
  return c.problems.length ? failure(c.problems) : { ok: true };
}
function savedLinks(links, savedAt) {
  return links.map((link) => ({ serviceResultId: link.serviceResultId, linkedAt: savedAt, savedName: link.savedName, savedAt: link.savedAt }));
}
function createInitialRevision(fields, links, metadata) {
  try {
    const checked = inputs(fields, links, metadata, true); if (!checked.ok) return checked;
    const revision = {
      kind: REVISION_KIND, recordVersion: RECORD_VERSION, jobId: metadata.jobId, revisionId: metadata.revisionId,
      parentRevisionId: null, revisionNumber: 1, createdAt: metadata.savedAt, savedAt: metadata.savedAt,
      producer: copy(PRODUCER), title: fields.title, address: fields.address, notes: fields.notes,
      serviceResultLinks: savedLinks(links, metadata.savedAt)
    };
    return readRevision(revision);
  } catch (e) { return failure(['creation refused: ' + errorText(e)]); }
}
function createNextRevision(currentRevision, fields, addedLinks, metadata) {
  try {
    const current = readRevision(currentRevision); if (!current.ok) return current;
    const checked = inputs(fields, addedLinks, metadata, false); if (!checked.ok) return checked;
    const old = current.revision;
    if (metadata.revisionId === old.revisionId) return failure(['metadata.revisionId: a new revision ID is required']);
    const ids = new Set(old.serviceResultLinks.map((link) => link.serviceResultId));
    const fresh = addedLinks.filter((link) => !ids.has(link.serviceResultId));
    if (old.title === fields.title && old.address === fields.address && old.notes === fields.notes && !fresh.length) return { ok: true, revision: old, unchanged: true };
    if (old.revisionNumber === Number.MAX_SAFE_INTEGER) return failure(['revision number limit reached'], 'LIMIT');
    const revision = {
      kind: REVISION_KIND, recordVersion: RECORD_VERSION, jobId: old.jobId, revisionId: metadata.revisionId,
      parentRevisionId: old.revisionId, revisionNumber: old.revisionNumber + 1, createdAt: old.createdAt, savedAt: metadata.savedAt,
      producer: copy(PRODUCER), title: fields.title, address: fields.address, notes: fields.notes,
      serviceResultLinks: old.serviceResultLinks.concat(savedLinks(fresh, metadata.savedAt))
    };
    return readRevision(revision);
  } catch (e) { return failure(['revision creation refused: ' + errorText(e)]); }
}
module.exports = {
  REVISION_KIND, HEAD_KIND, RECORD_VERSION, PRODUCER, LIMITS, JOB_ID_RE, REVISION_ID_RE, RESULT_ID_RE,
  createInitialRevision, createNextRevision, validateRevision, readRevision, validateHead, readHead
};
