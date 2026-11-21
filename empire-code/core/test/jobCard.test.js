'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/jobs/jobCard.js');
const id = (prefix, value) => prefix + value.toString(16).padStart(32, '0');
const jobId = id('job1_', 1); const revisionId = id('jrev1_', 1);
const time = '2026-10-06T01:23:45.678Z';
const later = '2026-10-06T02:00:00.000Z';
const fields = () => ({ title: '  Panel — piętro 2  ', address: 'West End Ave\nUnit 4B', notes: 'Measured by hand: 18,7 A; verify context.\n<script>text only</script>' });
const link = (n) => ({ serviceResultId: id('sr1_', n), savedName: 'Result ' + n, savedAt: '2026-10-05T23:00:00.000Z' });
const metadata = () => ({ jobId, revisionId, savedAt: time });
const clone = (v) => JSON.parse(JSON.stringify(v));
function initial(links) {
  const result = Model.createInitialRevision(fields(), links || [], metadata());
  assert.equal(result.ok, true, JSON.stringify(result)); return result.revision;
}
function next(revision, f, links, n) {
  return Model.createNextRevision(revision, f || fields(), links || [], { revisionId: id('jrev1_', n || 2), savedAt: later });
}
function refused(result, code) { assert.equal(result.ok, false); assert.equal(result.code, code || 'VALIDATION'); assert.ok(result.problems.length); }

test('job card initial snapshot has exact identity, manual text and no invented status or calculator data', () => {
  const input = fields(); const descriptors = [link(1)];
  const result = Model.createInitialRevision(input, descriptors, metadata());
  assert.deepEqual(result, { ok: true, revision: {
    kind: 'empire-code.job-revision', recordVersion: 1, jobId, revisionId, parentRevisionId: null,
    revisionNumber: 1, createdAt: time, savedAt: time,
    producer: { applicationRevision: 'LC-JOB-CARD-1', recordContractRevision: 1 },
    title: input.title, address: input.address, notes: input.notes,
    serviceResultLinks: [{ serviceResultId: link(1).serviceResultId, linkedAt: time, savedName: 'Result 1', savedAt: link(1).savedAt }]
  } });
  input.title = 'mutated'; descriptors[0].savedName = 'mutated';
  assert.equal(result.revision.title, fields().title); assert.equal(result.revision.serviceResultLinks[0].savedName, 'Result 1');
});
test('card may be created before any calculation or saved result exists', () => {
  const result = Model.createInitialRevision({ title: 'Site visit', address: '', notes: '' }, [], metadata());
  assert.equal(result.ok, true); assert.deepEqual(result.revision.serviceResultLinks, []);
});
test('metadata edit creates a separate snapshot and preserves previous data and exact link labels', () => {
  const old = initial([link(1)]); const frozen = clone(old);
  Object.freeze(old.serviceResultLinks[0]); Object.freeze(old.serviceResultLinks); Object.freeze(old);
  const changed = Object.assign(fields(), { title: 'Revisit', notes: 'New note' });
  const result = next(old, changed, [Object.assign(link(1), { savedName: 'Changed external label' }), link(2)]);
  assert.equal(result.ok, true); assert.equal(result.revision.revisionNumber, 2);
  assert.equal(result.revision.parentRevisionId, old.revisionId); assert.equal(result.revision.createdAt, time);
  assert.equal(result.revision.savedAt, later); assert.equal(result.revision.jobId, jobId);
  assert.deepEqual(result.revision.serviceResultLinks[0], frozen.serviceResultLinks[0]);
  assert.equal(result.revision.serviceResultLinks[1].linkedAt, later);
  assert.equal(result.revision.serviceResultLinks[1].savedName, 'Result 2');
  assert.deepEqual(old, frozen);
});
test('duplicate existing link is idempotent and does not relabel/re-date the stored association', () => {
  const old = initial([link(1)]);
  const result = next(old, fields(), [Object.assign(link(1), { savedName: 'Another label', savedAt: later })]);
  assert.equal(result.ok, true); assert.equal(result.unchanged, true); assert.deepEqual(result.revision, old);
  result.revision.serviceResultLinks[0].savedName = 'independent copy'; assert.equal(old.serviceResultLinks[0].savedName, 'Result 1');
});
test('identical fields and no additions return unchanged independent snapshot', () => {
  const old = initial(); const result = next(old);
  assert.equal(result.unchanged, true); assert.equal(result.revision.revisionId, old.revisionId);
  result.revision.notes = 'changed return'; assert.equal(old.notes, fields().notes);
});
test('two duplicate descriptors in one new batch are refused even when already linked', () => {
  refused(Model.createInitialRevision(fields(), [link(1), link(1)], metadata()));
  refused(next(initial([link(1)]), fields(), [link(1), link(1)]));
});
test('link count allows 100 and refuses append beyond limit without losing prior links', () => {
  const old = initial(Array.from({ length: 100 }, (_, n) => link(n + 1)));
  assert.equal(old.serviceResultLinks.length, 100);
  refused(next(old, fields(), [link(101)]));
  assert.equal(old.serviceResultLinks.length, 100);
});
test('link descriptors require exact scalar metadata; they do not accept result payloads', () => {
  const bad = Object.assign(link(1), { calculation: { demand: 23680 } });
  refused(Model.createInitialRevision(fields(), [bad], metadata()));
  refused(Model.createInitialRevision(fields(), [{ serviceResultId: link(1).serviceResultId }], metadata()));
});
test('historical reader retains old supported producer metadata without injecting current revision', () => {
  const stored = initial([link(1)]); stored.producer.applicationRevision = 'Earlier bounded application';
  const read = Model.readRevision(stored);
  assert.equal(read.ok, true); assert.equal(read.revision.producer.applicationRevision, stored.producer.applicationRevision);
  const revised = next(stored, Object.assign(fields(), { notes: 'edit' }));
  assert.equal(revised.revision.producer.applicationRevision, 'LC-JOB-CARD-1');
  assert.equal(stored.producer.applicationRevision, 'Earlier bounded application');
});
test('read copies nested structures and does not normalize Unicode, whitespace or literal markup', () => {
  const stored = initial([link(1)]); const read = Model.readRevision(stored);
  assert.equal(read.ok, true); assert.deepEqual(read.revision, stored);
  read.revision.serviceResultLinks.push(Object.assign(link(2), { linkedAt: time }));
  read.revision.producer.applicationRevision = 'changed';
  assert.equal(stored.serviceResultLinks.length, 1); assert.equal(stored.producer.applicationRevision, 'LC-JOB-CARD-1');
});
test('revision ordering uses the parent and integer sequence even if wall clock moves backwards', () => {
  const old = initial();
  const result = Model.createNextRevision(old, Object.assign(fields(), { notes: 'later edit; clock corrected' }), [], {
    revisionId: id('jrev1_', 2), savedAt: '2025-01-01T00:00:00.000Z'
  });
  assert.equal(result.ok, true); assert.equal(result.revision.revisionNumber, 2); assert.equal(result.revision.createdAt, time);
});
test('canonical UTC milliseconds include real calendar validation', () => {
  const good = Model.createInitialRevision(fields(), [], Object.assign(metadata(), { savedAt: '2024-02-29T00:00:00.000Z' })); assert.equal(good.ok, true);
  for (const stamp of ['2026-02-29T00:00:00.000Z', '2026-10-06', '2026-10-06T01:23:45Z', '2026-10-06T01:23:45.678+00:00', '2026-13-01T00:00:00.000Z', '2026-10-06T24:00:00.000Z']) {
    refused(Model.createInitialRevision(fields(), [], Object.assign(metadata(), { savedAt: stamp })));
  }
});
test('blank title is refused while entered title spaces are retained verbatim', () => {
  for (const title of ['', ' ', '\n\t']) refused(Model.createInitialRevision(Object.assign(fields(), { title }), [], metadata()));
  assert.equal(initial().title, '  Panel — piętro 2  ');
});
test('text limits count UTF-16 code units and permit exact maxima', () => {
  const at = { title: '😀'.repeat(100), address: 'a'.repeat(2000), notes: 'n'.repeat(20000) };
  assert.equal(Model.createInitialRevision(at, [], metadata()).ok, true);
  for (const [key, value] of [['title', 'a'.repeat(201)], ['address', 'a'.repeat(2001)], ['notes', 'n'.repeat(20001)]]) refused(Model.createInitialRevision(Object.assign({}, at, { [key]: value }), [], metadata()));
});
test('complete revision size limit includes escaping overhead', () => {
  const result = Model.createInitialRevision({ title: 'size', address: '\u0000'.repeat(2000), notes: '\u0000'.repeat(20000) }, [], metadata());
  refused(result); assert.ok(result.problems.some((message) => /size|limit/.test(message)));
});
test('wrong/missing IDs and unknown fields never become accepted snapshots', () => {
  refused(Model.createInitialRevision(fields(), [], Object.assign(metadata(), { jobId: id('job1_', 1).toUpperCase() })));
  refused(Model.createInitialRevision(fields(), [], { jobId, savedAt: time }));
  refused(Model.createInitialRevision(Object.assign(fields(), { approval: true }), [], metadata()));
  refused(Model.createInitialRevision(fields(), [Object.assign(link(1), { serviceResultId: jobId })], metadata()));
});
test('stored revision version/kind are explicitly unsupported', () => {
  for (const change of [{ recordVersion: 2 }, { kind: 'other.kind' }]) {
    const stored = Object.assign(initial(), change);
    assert.ok(Model.validateRevision(stored).length); refused(Model.readRevision(stored), 'UNSUPPORTED');
  }
});
test('root and nonroot identities require coherent parent and creation timestamp shape', () => {
  const root = initial(); root.createdAt = later; refused(Model.readRevision(root));
  const wrongParent = initial(); wrongParent.parentRevisionId = id('jrev1_', 3); refused(Model.readRevision(wrongParent));
  const second = next(initial(), Object.assign(fields(), { notes: 'edit' })).revision;
  second.parentRevisionId = second.revisionId; refused(Model.readRevision(second));
  second.parentRevisionId = null; refused(Model.readRevision(second));
});
test('a next revision cannot reuse its current identity or exceed safe integer numbering', () => {
  refused(Model.createNextRevision(initial(), fields(), [], { revisionId, savedAt: later }));
  const last = initial(); last.revisionNumber = Number.MAX_SAFE_INTEGER; last.parentRevisionId = id('jrev1_', 99);
  refused(next(last, Object.assign(fields(), { notes: 'edit' })), 'LIMIT');
});
test('initial historical link times must match their creation revision', () => {
  const stored = initial([link(1)]); stored.serviceResultLinks[0].linkedAt = later;
  refused(Model.readRevision(stored));
});
test('null-prototype plain data is accepted and read into independent ordinary objects', () => {
  const input = Object.assign(Object.create(null), fields());
  assert.equal(Model.createInitialRevision(input, [], metadata()).ok, true);
  const stored = Object.assign(Object.create(null), initial()); const result = Model.readRevision(stored);
  assert.equal(result.ok, true); assert.equal(Object.getPrototypeOf(result.revision), Object.prototype);
});
test('head shape is closed and read copies the stored value', () => {
  const head = { kind: 'empire-code.job-head', recordVersion: 1, jobId, currentRevisionId: revisionId, revisionNumber: 1 };
  assert.deepEqual(Model.validateHead(head), []);
  const read = Model.readHead(head); assert.equal(read.ok, true); assert.deepEqual(read.head, head);
  read.head.revisionNumber = 9; assert.equal(head.revisionNumber, 1);
  refused(Model.readHead(Object.assign({}, head, { title: 'duplicated metadata' })));
  refused(Model.readHead(Object.assign({}, head, { recordVersion: 2 })), 'UNSUPPORTED');
  refused(Model.readHead(Object.assign({}, head, { revisionNumber: 0 })));
});
test('no getter is evaluated before unsafe input is refused', () => {
  let calls = 0; const input = fields(); Object.defineProperty(input, 'notes', { enumerable: true, get() { calls++; return 'unsafe'; } });
  refused(Model.createInitialRevision(input, [], metadata())); assert.equal(calls, 0);
  const stored = initial(); Object.defineProperty(stored, 'producer', { enumerable: true, get() { calls++; return {}; } });
  refused(Model.readRevision(stored)); assert.equal(calls, 0);
});
test('unsafe values, array holes, extra properties and custom prototypes are refused without coercion', async (t) => {
  const changes = {
    undefined: (v) => { v.notes = undefined; },
    function: (v) => { v.notes = () => 'x'; },
    bigint: (v) => { v.notes = 1n; },
    NaN: (v) => { v.revisionNumber = NaN; },
    infinity: (v) => { v.revisionNumber = Infinity; },
    negativeZero: (v) => { v.revisionNumber = -0; },
    symbolValue: (v) => { v.notes = Symbol('x'); },
    symbolKey: (v) => { v[Symbol('x')] = 'hidden'; },
    nonEnumerable: (v) => { Object.defineProperty(v, 'extra', { value: 1, enumerable: false }); },
    cycle: (v) => { v.notes = v; },
    customObject: (v) => { Object.setPrototypeOf(v, { inherited: true }); },
    customArray: (v) => { Object.setPrototypeOf(v.serviceResultLinks, Object.create(Array.prototype)); },
    hole: (v) => { v.serviceResultLinks = new Array(1); },
    arrayExtra: (v) => { v.serviceResultLinks.extra = 'lost'; },
    date: (v) => { v.savedAt = new Date(time); },
    toJSON: (v) => { v.toJSON = () => ({ title: 'lossy replacement' }); }
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => { const stored = initial([link(1)]); change(stored); refused(Model.readRevision(stored)); });
});
test('reflection exceptions become controlled failure envelopes', () => {
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error('synthetic reflection refusal'); } });
  const result = Model.createInitialRevision(proxy, [], metadata()); refused(result);
  assert.match(result.problems.join(' '), /refusal/);
});

test('even a hostile thrown value is converted to a controlled failure', () => {
  const thrown = {}; Object.defineProperty(thrown, 'message', { get() { throw thrown; } });
  const proxy = new Proxy({}, { getPrototypeOf() { throw thrown; } });
  assert.doesNotThrow(() => Model.validateRevision(proxy));
  refused(Model.readRevision(proxy));
  refused(Model.createInitialRevision(proxy, [], metadata()));
});
