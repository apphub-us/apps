'use strict';
/**
 * EC-AUDIT-FIX-1 stage 3 — EC-08: one material unit / quantity contract for
 *   Jobs (jobMaterial.js), server proposals (candidate/server/contract.cjs),
 *   the conversation handoff (core jobConversationHandoff.js AND the hosted browser copy workspace/handoff.js).
 * The hosted handoff file is executed as shipped, against the same core modules it receives as window.EC.*.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto: crypto } = require('node:crypto');
const Q = require('../src/jobs/materialQuantity');
const M = require('../src/jobs/jobMaterial');
const H = require('../src/jobs/jobConversationHandoff');
const Job = require('../src/jobs/jobCard');
const Batch = require('../src/jobs/jobVoiceBatch');
const C = require('../../candidate/server/contract.cjs');
const BUILD = require('../tools/build-calc.js');

const REPO = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(REPO, ...parts), 'utf8');

function browserHandoff() {
  const window = { EC: { jobCard: Job, jobMaterial: M, jobVoiceBatch: Batch, materialQuantity: Q } };
  new Function('window', read('candidate', 'browser', 'workspace', 'handoff.js'))(window);   // eslint-disable-line no-new-func
  return window.EC.jobConversationHandoff;
}
const HB = browserHandoff();

const time = '2026-11-15T20:00:00.000Z';
const item = (n, quantity, unit, extra) => Object.assign({ id: 'i' + String(n).padStart(4, '0'), name: 'Item ' + n, quantity, unit, specification: '', notes: '', review: [] }, extra || {});
function draft(items, selected) {
  const jobId = 'job1_' + '1'.repeat(32), revisionId = 'jrev1_' + '2'.repeat(32);
  const revision = Job.createInitialRevision({ title: 'Synthetic job', address: '', notes: '' }, [], { jobId, revisionId, savedAt: time }).revision;
  return { sourceId: 'conv1_' + '3'.repeat(32), sourceRevision: 2, sourceSavedAt: time, items, selectedItemIds: selected, acknowledgedReviewIds: [],
    job: { head: { kind: 'empire-code.job-head', recordVersion: 1, jobId, currentRevisionId: revisionId, revisionNumber: 1 }, revision } };
}
const jobFields = (q, u) => ({ label: 'Item', specification: '', quantityText: q, unit: u, status: 'not_recorded', location: '', supplier: '', notes: '' });
const addOp = (q, u) => ({ scope: 'materials', reply: 'ok', question: '', operations: [{ op: 'add', id: 'new1', fields: { name: 'Item', quantity: q, unit: u, specification: '', notes: '', review: [] } }] });
const upd = (id, fields) => ({ scope: 'materials', reply: 'ok', question: '', operations: [{ op: 'update', id, fields }] });
const quantityRefusal = (e) => e.code === 'PROPOSAL_QUANTITY' && e.safe === true && e.status === 422 && e.message === C.QUANTITY_MESSAGE;

const layers = {
  jobs: async (q, u) => M.validateFields(jobFields(q, u)).ok,
  server: async (q, u) => { try { C.apply(C.empty(), addOp(q, u), 'add it'); return true; } catch (_) { return false; } },
  coreHandoff: async (q, u) => (await H.prepare(draft([item(1, q, u)], ['i0001']), { crypto })).ok,
  browserHandoff: async (q, u) => (await HB.prepare(draft([item(1, q, u)], ['i0001']), { crypto })).ok,
};
// [quantity, unit, may be WRITTEN]
const MATRIX = [
  ['0.5', 'roll', false], ['0.5', 'set', false], ['0.5', 'pcs', false], ['0.5', 'box', false], ['0.5', 'pack', false], ['1.25', 'roll', false],
  ['1', 'roll', true], ['1', 'set', true], ['4', 'pcs', true], ['2', 'box', true], ['3', 'pack', true], ['2.0', 'roll', true],
  ['0.5', 'm', true], ['12.25', 'ft', true], ['0.5', 'in', true], ['2.5', 'cm', true], ['7.5', 'mm', true], ['3', 'ft', true],
];

test('EC-08: one definition — Jobs and the server contract expose the SAME unit objects; no layer keeps its own unit list', () => {
  assert.deepEqual([...Q.COUNT_UNITS], ['pcs', 'box', 'pack', 'roll', 'set']);
  assert.deepEqual([...Q.LENGTH_UNITS], ['ft', 'in', 'm', 'cm', 'mm']);
  assert.deepEqual([...Q.UNITS], [...Q.COUNT_UNITS, ...Q.LENGTH_UNITS]);
  assert.equal(M.UNITS, Q.UNITS); assert.equal(M.COUNT_UNITS, Q.COUNT_UNITS);
  assert.equal(C.UNITS, Q.UNITS); assert.equal(C.COUNT_UNITS, Q.COUNT_UNITS);
  assert.deepEqual(C.schema.properties.operations.items.properties.fields.properties.unit.enum, [...Q.UNITS, null]);
  for (const file of [['core', 'src', 'jobs', 'jobMaterial.js'], ['core', 'src', 'jobs', 'jobConversationHandoff.js'], ['candidate', 'browser', 'workspace', 'handoff.js'], ['candidate', 'server', 'contract.cjs'], ['candidate', 'server', 'cloud-provider.mjs']]) {
    assert.ok(!/['"](?:roll|pack|pcs)['"]/.test(read(...file)), file.join('/') + ' carries its own unit literal again');
  }
  assert.match(read('core', 'src', 'jobs', 'jobConversationHandoff.js'), /require\('\.\/materialQuantity\.js'\)/);
  assert.match(read('candidate', 'browser', 'workspace', 'handoff.js'), /window\.EC\.materialQuantity/);
  assert.match(read('candidate', 'server', 'contract.cjs'), /require\('\.\.\/\.\.\/core\/src\/jobs\/materialQuantity\.js'\)/);
});

test('EC-08: the calculator build emits the shared module before its first user and the bundle resolves it', () => {
  const ids = BUILD.MODULES.map((m) => m.id);
  assert.ok(ids.includes('materialQuantity') && ids.indexOf('materialQuantity') < ids.indexOf('jobMaterial'));
  assert.deepEqual(BUILD.MODULES[ids.indexOf('materialQuantity')], { id: 'materialQuantity', file: 'jobs/materialQuantity.js' });
  const block = BUILD.buildBlock();
  const script = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  const win = {}; new Function('window', script)(win);   // eslint-disable-line no-new-func
  assert.deepEqual([...win.EC.materialQuantity.UNITS], [...Q.UNITS]);
  assert.equal(win.EC.jobMaterial.UNITS, win.EC.materialQuantity.UNITS, 'inside the bundle Jobs uses the shared object, not a copy');
  assert.equal(win.EC.jobMaterial.validateFields(jobFields('0.5', 'roll')).ok, false);
  assert.equal(win.EC.jobMaterial.validateFields(jobFields('1', 'pack')).ok, true);
});

test('EC-08: shared rule — whole counts for pcs/box/pack/roll/set, fractions for lengths, decided on the text', () => {
  for (const [q, u, ok] of MATRIX) {
    const seen = Q.inspectDraft(q, u);
    assert.equal(seen.readable, true, q + ' ' + u); assert.equal(seen.complete, true); assert.equal(seen.writeValid, ok, q + ' ' + u);
    assert.equal(seen.correctionRequired, !ok); assert.equal(seen.code, ok ? null : 'WHOLE_COUNT_REQUIRED');
  }
  assert.equal(Q.isWholeDecimal('002.00'), true); assert.equal(Q.isWholeDecimal('2.01'), false); assert.equal(Q.isWholeDecimal('.5'), false);
  for (const bad of ['0', '0.0', '-1', '1e3', '1,5', ' 1', '12345678', '1.23456', '', 2]) assert.deepEqual([Q.inspectDraft(bad, 'ft').readable, Q.inspectDraft(bad, 'ft').code], [false, 'QUANTITY'], String(bad));
  for (const bad of ['A', 'rolls', 'PCS', '', 5]) assert.deepEqual([Q.inspectDraft('1', bad).readable, Q.inspectDraft('1', bad).code], [false, 'UNIT'], String(bad));
});

test('EC-08: all layers agree on every case — 0.5 roll/set/pcs/box/pack refused, 1 roll and box/pack accepted, fractional lengths accepted', async () => {
  for (const [q, u, ok] of MATRIX) {
    for (const [name, accepts] of Object.entries(layers)) assert.equal(await accepts(q, u), ok, name + ': ' + q + ' ' + u);
  }
});

test('EC-08: box and pack travel end to end — proposal, draft state, handoff plan, Jobs fields', async () => {
  for (const unit of ['box', 'pack']) {
    const out = C.apply(C.empty(), addOp('3', unit), 'three of them');
    assert.deepEqual([out.state.items[0].quantity, out.state.items[0].unit], ['3', unit]); assert.deepEqual(out.corrections, []);
    for (const impl of [H, HB]) {
      const r = await impl.prepare(draft(out.state.items, ['i0001']), { crypto });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual([r.handoff.plan.actions[0].fields.quantityText, r.handoff.plan.actions[0].fields.unit], ['3', unit]);
      assert.equal(M.validateFields(r.handoff.plan.actions[0].fields).ok, true);
    }
  }
});

test('EC-08: an unknown quantity or unit is not an error — the item stays in the draft for review and cannot be handed off yet', async () => {
  for (const [q, u] of [[null, 'roll'], ['0.5', null], [null, null], [null, 'ft']]) {
    assert.deepEqual([Q.inspectDraft(q, u).readable, Q.inspectDraft(q, u).complete, Q.inspectDraft(q, u).writeValid], [true, false, true]);
    const out = C.apply(C.empty(), addOp(q, u), 'not sure yet');
    assert.deepEqual([out.state.items[0].quantity, out.state.items[0].unit], [q, u]); assert.deepEqual(out.corrections, []);
    for (const impl of [H, HB]) {
      assert.equal((await impl.prepare(draft([item(1, q, u), item(2, '2', 'pcs')], ['i0001']), { crypto })).code, 'INCOMPLETE');
      assert.equal((await impl.prepare(draft([item(1, q, u), item(2, '2', 'pcs')], ['i0002']), { crypto })).ok, true);
    }
  }
});

const legacy = () => ({ version: 1, revision: 3, nextId: 5, items: [item(1, '0.5', 'roll'), item(2, '2', 'pcs'), item(3, '0.5', 'set'), item(4, '0.5', 'm')],
  history: [{ role: 'user', content: 'pół rolki taśmy' }, { role: 'assistant', content: 'Dodano.' }] });

test('EC-08 compatibility: a saved v1 draft with 0.5 roll / 0.5 set loads unchanged and is flagged, never rejected, rounded or erased', () => {
  const stored = legacy();
  assert.deepEqual(C.state(stored), legacy(), 'state() returns the stored content exactly');
  assert.deepEqual(stored, legacy(), 'the input is not mutated');
  assert.deepEqual(C.corrections(stored), [
    { id: 'i0001', code: 'WHOLE_COUNT_REQUIRED', quantity: '0.5', unit: 'roll' },
    { id: 'i0003', code: 'WHOLE_COUNT_REQUIRED', quantity: '0.5', unit: 'set' }]);
  // malformed is still malformed: the legacy tolerance covers fractional counts only
  for (const mutate of [(s) => { s.items[0].unit = 'rolls'; }, (s) => { s.items[0].quantity = '0'; }, (s) => { s.items[0].quantity = 0.5; }, (s) => { s.items[1].id = 'i0001'; }]) {
    const bad = legacy(); mutate(bad); assert.throws(() => C.state(bad));
  }
});

test('EC-08 compatibility: unrelated items stay workable; the legacy item cannot be written until its quantity is corrected', () => {
  // an update of ANOTHER item succeeds and leaves the legacy items byte-identical, ids and nextId included
  const other = C.apply(legacy(), upd('i0002', { notes: 'blue' }), 'make them blue');
  assert.deepEqual(other.state.items.map((i) => i.id), ['i0001', 'i0002', 'i0003', 'i0004']); assert.equal(other.state.nextId, 5);
  assert.deepEqual(other.state.items[0], legacy().items[0]); assert.deepEqual(other.state.items[2], legacy().items[2]);
  assert.equal(other.state.items[1].notes, 'blue'); assert.deepEqual(other.corrections.map((c) => c.id), ['i0001', 'i0003']);
  // any write to the legacy item whose merged quantity + unit is still a fractional count is refused with the corrective, client-safe error
  const before = legacy();
  assert.throws(() => C.apply(before, upd('i0001', { notes: 'x' }), 'note'), quantityRefusal);
  assert.throws(() => C.apply(before, upd('i0001', { quantity: '1.5' }), 'more'), quantityRefusal);
  assert.deepEqual(before, legacy(), 'a refused proposal changes nothing');
  // the quantity-only correction is accepted and clears the flag for that item only
  const fixed = C.apply(legacy(), upd('i0001', { quantity: '1' }), 'one roll');
  assert.deepEqual([fixed.state.items[0].id, fixed.state.items[0].quantity, fixed.state.items[0].unit], ['i0001', '1', 'roll']);
  assert.deepEqual(fixed.corrections.map((c) => c.id), ['i0003']);
  // making the quantity unknown, or stating a length unit, are also explicit user corrections — nothing is inferred
  assert.equal(C.apply(legacy(), upd('i0001', { quantity: null }), 'unknown').state.items[0].quantity, null);
  assert.deepEqual(C.apply(legacy(), upd('i0003', { unit: 'm' }), 'metres').corrections.map((c) => c.id), ['i0001']);
  // the legacy item can be removed, and a NEW fractional count cannot be added beside it
  assert.deepEqual(C.apply(legacy(), { scope: 'materials', reply: 'ok', question: '', operations: [{ op: 'remove', id: 'i0003', fields: {} }] }, 'drop it').state.items.map((i) => i.id), ['i0001', 'i0002', 'i0004']);
  assert.throws(() => C.apply(legacy(), addOp('0.5', 'roll'), 'another half'), quantityRefusal);
});

test('EC-08: partial updates are judged on the MERGED quantity + unit', () => {
  assert.throws(() => C.apply(legacy(), upd('i0004', { unit: 'roll' }), 'rolls'), quantityRefusal, '0.5 m -> roll');
  assert.throws(() => C.apply(legacy(), upd('i0002', { quantity: '2.5' }), 'half more'), quantityRefusal, '2 pcs -> 2.5 pcs');
  assert.deepEqual(C.apply(legacy(), upd('i0004', { unit: 'roll', quantity: '2' }), 'two rolls').state.items[3].quantity, '2');
  assert.deepEqual(C.apply(legacy(), upd('i0002', { unit: 'ft', quantity: '2.5' }), 'feet').state.items[1].unit, 'ft');
  assert.deepEqual(C.fields({ unit: 'roll' }, true), { unit: 'roll' }, 'a partial set alone is only shape-checked');
  assert.throws(() => C.fields({ name: 'X', quantity: '0.5', unit: 'roll', specification: '', notes: '', review: [] }), quantityRefusal);
});

test('EC-08: the corrective refusal is one the Worker may show (safe, PROPOSAL_* code, within the client limit)', () => {
  assert.match(C.QUANTITY_CODE, /^PROPOSAL_[A-Z]{1,12}$/);
  assert.ok(C.QUANTITY_MESSAGE.length > 0 && C.QUANTITY_MESSAGE.length <= 300, String(C.QUANTITY_MESSAGE.length));
  for (const unit of Q.UNITS) assert.ok(C.QUANTITY_MESSAGE.includes(unit), unit);
});

test('EC-08 handoff: a legacy fractional count blocks only itself — explicit corrective error when selected, other items transfer', async () => {
  const items = [item(1, '0.5', 'roll'), item(2, '2', 'pcs'), item(3, null, null), item(4, '3', 'box')];
  for (const impl of [H, HB]) {
    const ok = await impl.prepare(draft(items, ['i0002', 'i0004']), { crypto });
    assert.equal(ok.ok, true, JSON.stringify(ok)); assert.deepEqual(ok.excludedItemIds, ['i0001', 'i0003']);
    assert.deepEqual(ok.handoff.plan.actions.map((a) => [a.fields.quantityText, a.fields.unit]), [['2', 'pcs'], ['3', 'box']]);
    const bad = await impl.prepare(draft(items, ['i0001', 'i0002']), { crypto });
    assert.deepEqual([bad.ok, bad.code], [false, 'QUANTITY_CORRECTION']);
    assert.match(bad.problems[0], /i0001/); assert.match(bad.problems[0], /0\.5 roll/); assert.match(bad.problems[0], /whole-number/); assert.match(bad.problems[0], /Nothing was rounded/);
    // malformed (not legacy) content still refuses the whole input, selected or not
    for (const mutate of [(list) => { list[3].unit = 'A'; }, (list) => { list[3].quantity = '1e3'; }]) {
      const broken = items.map((i) => Object.assign({}, i)); mutate(broken);
      assert.equal((await impl.prepare(draft(broken, ['i0002']), { crypto })).code, 'INVALID');
    }
  }
});

test('EC-08 handoff: the core module and the hosted browser copy return identical results, and identities are not lost', async () => {
  const items = [item(1, '0.5', 'roll'), item(2, '2', 'pcs'), item(4, '3', 'pack')];
  for (const selected of [['i0002'], ['i0002', 'i0004'], ['i0001'], ['i0001', 'i0004']]) {
    assert.deepEqual(await HB.prepare(draft(items, selected), { crypto }), await H.prepare(draft(items, selected), { crypto }), selected.join());
  }
  // the material identity of a valid item depends on source, job and item id only: the legacy neighbour does not change it
  const withLegacy = await H.prepare(draft(items, ['i0002']), { crypto });
  const alone = await H.prepare(draft([item(2, '2', 'pcs')], ['i0002']), { crypto });
  assert.equal(withLegacy.handoff.plan.actions[0].id, alone.handoff.plan.actions[0].id);
  assert.match(withLegacy.handoff.plan.actions[0].id, /^mat1_[0-9a-f]{32}$/);
  // correcting the legacy item keeps ITS identity too (same item id -> same material id), so an earlier receipt still matches
  const corrected = items.map((i) => (i.id === 'i0001' ? Object.assign({}, i, { quantity: '1' }) : i));
  const a = await H.prepare(draft(corrected, ['i0001']), { crypto });
  const b = await H.prepare(draft([item(1, '1', 'roll')], ['i0001']), { crypto });
  assert.equal(a.ok, true); assert.equal(a.handoff.plan.actions[0].id, b.handoff.plan.actions[0].id);
});

test('EC-08 Jobs: manual entry keeps its text form and message; nothing is rounded', () => {
  for (const unit of Q.COUNT_UNITS) {
    const bad = M.validateFields(jobFields('2.5', unit)); assert.equal(bad.ok, false); assert.ok(bad.problems.includes(Q.WHOLE_COUNT_MESSAGE));
    assert.equal(M.validateFields(jobFields('002.00', unit)).fields.quantityText, '002.00');
  }
  for (const unit of Q.LENGTH_UNITS) assert.equal(M.validateFields(jobFields('.5', unit)).fields.quantityText, '.5');
});
