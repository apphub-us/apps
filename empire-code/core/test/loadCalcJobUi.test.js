'use strict';
/**
 * LC-JOB-CARD-1 UI: the shipped handwritten adapter and generated modules.
 * Integrated tests use an explicitly simulated IndexedDB, never native-browser
 * evidence. Deferred API responses cover UI lifecycle races independently.
 * Authored only by the UI worker; coordinator executes after the bundle build.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildHarness, html, adapterSource } = require('./helpers/loadCalcDom');
const { makeIndexedDb, deterministicCrypto } = require('./helpers/jobIndexedDb');
const Job = require('../src/jobs/jobCard');
const Record = require('../src/calc/loadCalcServiceRecord');
const State = require('../src/calc/loadCalcStateV2');
const Facade = require('../src/calc/loadCalcFacade');
const Sizing = require('../src/calc/loadCalcServiceSizing');
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/loadCalc/LC82-cases-r1.json'), 'utf8')).cases;
const PREFIX = 'empire_code_service_result_v1:';
const copy = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const jid = (n) => 'job1_' + n.toString(16).padStart(32, '0');
const rid = (n) => 'jrev1_' + n.toString(16).padStart(32, '0');
const sid = (n) => 'sr1_' + n.toString(16).padStart(32, '0');
const click = (h, id) => h.$(id).dispatch('click');
const status = (h) => h.$('lcJobStatus').textContent;
const editor = (h) => h.api.LC_JOB.editor;
const save = (h) => h.api.lcJobSave(editor(h), h.$('lcJobSaveBtn'));
const jobRows = (h) => h.$('lcJobList').querySelectorAll('.lc-job-open');
const savedRevision = (h) => h.api.LC_JOB.current.revision;
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function begin(h, fields) {
  if (h.$('lcJobToggleBtn').getAttribute('aria-expanded') !== 'true') click(h, 'lcJobToggleBtn');
  click(h, 'lcJobNewBtn');
  for (const [field, value] of Object.entries(fields || { title: 'Test job', address: '', notes: '' })) {
    h.set({ title: 'lcJobTitle', address: 'lcJobAddress', notes: 'lcJobNotes' }[field], value);
  }
  return editor(h);
}
function addResult(h, resultId) { h.set('lcJobResultChoice', resultId); click(h, 'lcJobAddResultBtn'); }
async function integrated(options, rig) {
  const db = rig || makeIndexedDb();
  const h = buildHarness(Object.assign({ indexedDB: db.indexedDB, crypto: deterministicCrypto() }, options || {}));
  h.api.lcInit(); await db.control.flush();
  return { h, ...db };
}
function makeJob(n, fields, links) {
  const made = Job.createInitialRevision(Object.assign({ title: 'Job ' + n, address: '', notes: '' }, fields || {}), links || [], {
    jobId: jid(n), revisionId: rid(n), savedAt: '2026-10-06T01:00:00.000Z'
  });
  assert.equal(made.ok, true, JSON.stringify(made.problems));
  return { head: { kind: 'empire-code.job-head', recordVersion: 1, jobId: jid(n), currentRevisionId: rid(n), revisionNumber: 1 }, revision: made.revision };
}
function nextJob(job, fields, n) {
  const made = Job.createNextRevision(job.revision, Object.assign({ title: job.revision.title, address: job.revision.address, notes: job.revision.notes }, fields), [], {
    revisionId: rid(n), savedAt: '2026-10-06T01:01:00.000Z'
  });
  assert.equal(made.ok, true, JSON.stringify(made.problems));
  return { head: { kind: 'empire-code.job-head', recordVersion: 1, jobId: job.head.jobId, currentRevisionId: made.revision.revisionId, revisionNumber: made.revision.revisionNumber }, revision: made.revision };
}
async function controlled(overrides, options) {
  const store = Object.assign({
    list: async () => ({ ok: true, jobs: [], problems: [] }),
    read: async () => ({ ok: false, code: 'NOT_FOUND', problems: ['No such job.'] }),
    history: async () => ({ ok: true, revisions: [] }),
    readHistorical: async () => ({ ok: false, code: 'NOT_FOUND', problems: ['No such version.'] }),
    create: async () => ({ ok: false, code: 'UNAVAILABLE', problems: ['No synthetic save configured.'] }),
    save: async () => ({ ok: false, code: 'UNAVAILABLE', problems: ['No synthetic save configured.'] }),
    close() {}
  }, overrides || {});
  const h = buildHarness(Object.assign({ jobStoreFactory: () => store }, options || {}));
  h.api.lcInit(); await tick();
  return { h, store };
}
function resultRecord(n, name, designPatch) {
  const request0 = copy(CASES.find((c) => c.id === 'LC82-B0P').request);
  const draft = State.createEmptyDraftV2(); draft.snapshot = request0.snapshot; draft.context = request0.context; draft.sourceFavId = 'job-ui-fixture';
  const projection = State.toRequestV2(draft); assert.equal(projection.ok, true);
  const request = projection.request; const response = Facade.evaluateV2(request);
  const design = {
    selectedMainRatingA: 200,
    plan: { intent: 'new_design_candidate', oneMainDisconnect: true, noAdditionalSources: true, wholeDwelling: true, singleConductorSet: true },
    conductor: { sizingPath: 'dwelling_83pct_310_12', material: 'Cu', terminationTempRatingC: 75, terminationMaterialCompatible: true, insulationTempRatingC: 75, ambientTempC: 30, currentCarryingConductors: 3, wiringMethod: 'single_insulated_conductors_in_raceway', noOtherAdjustmentOrCorrection: true }
  };
  if (designPatch) designPatch(design);
  const analysis = Sizing.analyzePrototype(request, design);
  const made = Record.createRecord({ draft, request, response, design, analysis }, { id: sid(n), name: name || 'B0 saved result', createdAt: '2026-10-06T00:00:00.000Z' });
  assert.equal(made.ok, true, JSON.stringify(made.problems));
  return made.record;
}
function live(h) {
  return {
    state: JSON.stringify(h.state()), favoritePayload: JSON.stringify(h.api.lcFavPayload()),
    design: JSON.stringify(h.api.lcSvcDesignObject()), analysis: h.api.LC_SVC.analysis,
    calc: JSON.stringify({ attempted: h.api.LC_CALC.attempted, key: h.api.LC_CALC.key, commit: h.api.LC_CALC.commit }),
    attempted: h.api.LC_SVC.attempted, calcKey: h.api.LC_SVC.calcKey, notice: h.api.LC_SVC.notice,
    error: h.api.LC_SVC.error, liveKey: h.api.LC_SVC.liveKey, probe: h.api.LC_SVC.probe,
    marks: h.api.LC_SVC.marks.slice(), references: h.necCalls.length, favorites: h.store.data,
    savedResultBytes: JSON.stringify(h.store.byKey), writes: h.store.sets
  };
}
function sameLive(h, before) {
  const after = live(h);
  for (const key of Object.keys(before)) {
    if (key === 'marks') assert.deepEqual(after[key], before[key], key);
    else assert.equal(after[key], before[key], key);
  }
}

describe('Job UI with the actual generated store and an explicit IDB simulator', () => {
  test('creates a zero-link job, preserves exact Unicode strings, and opens it after restart with an empty calculator', async () => {
    const { h, indexedDB, control } = await integrated({ storage: '{"vd":[{"name":"keep favorite"}]}' });
    const before = live(h);
    const fields = { title: '  Łódź — Service <survey>  ', address: '12 Example Street\nApt. 2', notes: '  First line\nSecond line ⚡\n' };
    begin(h, fields); assert.equal(h.$('lcJobResultChoice').value, ''); assert.equal(await save(h), true);
    const original = copy(savedRevision(h)); assert.equal(original.title, fields.title); assert.equal(original.address, fields.address); assert.equal(original.notes, fields.notes);
    assert.deepEqual(original.serviceResultLinks, []); assert.equal(control.count('jobs'), 1); assert.equal(control.count('jobRevisions'), 1);
    sameLive(h, before);
    const restart = await integrated({ indexedDB, crypto: deterministicCrypto(100), storage: h.store.data }, { indexedDB, control });
    // The unchanged calculator initializes its blank draft once. Opening a job
    // must add no evaluation or user Calculate, rather than require a zero counter.
    const restartBefore = live(restart.h);
    assert.equal(jobRows(restart.h).length, 1); assert.equal(await restart.h.api.lcJobOpen(original.jobId), true);
    assert.deepEqual(savedRevision(restart.h), original); sameLive(restart.h, restartBefore);
    assert.equal(restart.h.api.LC_CALC.attempted, false);
    assert.ok(restart.h.$('lcJobWork').textContent.includes(fields.notes));
  });

  test('edits by appending a version and opens each immutable historical snapshot without restore controls', async () => {
    const { h, control } = await integrated(); begin(h, { title: 'Original title', address: 'Old address', notes: 'Original notes' });
    await save(h); const first = copy(savedRevision(h)); const firstBytes = JSON.stringify(control.raw('jobRevisions', first.revisionId));
    click(h, 'lcJobEditBtn'); h.set('lcJobTitle', 'Updated title'); h.set('lcJobAddress', 'New address'); h.set('lcJobNotes', 'New notes');
    await save(h); const second = copy(savedRevision(h));
    assert.equal(second.revisionNumber, 2); assert.equal(second.parentRevisionId, first.revisionId); assert.equal(second.createdAt, first.createdAt);
    assert.equal(JSON.stringify(control.raw('jobRevisions', first.revisionId)), firstBytes); assert.equal(control.count('jobRevisions'), 2);
    const before = live(h); await h.api.lcJobHistory(first.jobId, h.$('lcJobHistoryBtn'));
    const historyButtons = h.$('lcJobReadView').querySelectorAll('.lc-job-history-open'); assert.equal(historyButtons.length, 2);
    assert.match(historyButtons[0].textContent, /Version 2/); assert.match(historyButtons[1].textContent, /Version 1/);
    await h.api.lcJobHistorical(first.jobId, first.revisionId, historyButtons[1]);
    assert.match(h.$('lcJobReadView').textContent, /Original title/); assert.match(h.$('lcJobReadView').textContent, /Original notes/);
    assert.match(h.$('lcJobReadView').textContent, /read-only/);
    assert.equal(h.$('lcJobReadView').querySelectorAll('input, textarea, select').length, 0);
    assert.ok(!/Restore|Delete|Save new version/.test(h.$('lcJobReadView').textContent)); sameLive(h, before);
  });

  test('repeated missing-core initialization preserves the exact dirty job editor and still saves', async () => {
    const { h, control } = await integrated({ missing: ['loadCalcFacade'] });
    assert.equal(h.$('lcForm'), undefined); const e = begin(h, { title: 'Independent job', address: 'Address', notes: 'Keep unsaved notes' });
    const hub = h.$('lcJobHub'); const notes = h.$('lcJobNotes'); h.api.lcInit(); await control.flush();
    assert.equal(h.$('lcJobHub'), hub); assert.equal(h.$('lcJobNotes'), notes); assert.equal(editor(h), e);
    assert.equal(h.$('lcJobNotes').value, 'Keep unsaved notes'); assert.equal(await save(h), true); assert.equal(control.count('jobs'), 1);
  });

  test('two real UI store instances conflict without silently rebasing or losing the losing draft', async () => {
    const rig = makeIndexedDb(); const { h: a } = await integrated({}, rig);
    begin(a, { title: 'Shared job', notes: 'Original' }); await save(a); const first = copy(savedRevision(a));
    const { h: b } = await integrated({ crypto: deterministicCrypto(100) }, rig); await b.api.lcJobOpen(first.jobId);
    click(a, 'lcJobEditBtn'); click(b, 'lcJobEditBtn');
    a.set('lcJobNotes', 'First writer'); b.set('lcJobTitle', 'Second writer title'); b.set('lcJobNotes', 'Second writer notes');
    await save(a); const winner = copy(savedRevision(a)); assert.equal(await save(b), false);
    assert.match(status(b), /newer job version/); assert.equal(b.$('lcJobNotes').value, 'Second writer notes');
    assert.equal(editor(b).base.revisionId, first.revisionId); assert.equal(b.$('lcJobSaveBtn').disabled, true);
    assert.equal(rig.control.count('jobRevisions'), 2);
    await b.api.lcJobLatest(editor(b), b.$('lcJobLatestBtn'));
    assert.match(b.$('lcJobReadView').textContent, /First writer/); assert.equal(b.$('lcJobNotes').value, 'Second writer notes');
    assert.equal(editor(b).base.revisionId, first.revisionId);
    await b.api.lcJobDiscard(editor(b), b.$('lcJobDiscardBtn'));
    assert.equal(editor(b), null); assert.equal(savedRevision(b).revisionId, winner.revisionId);
  });

  test('Save stays busy and reports no success before the write transaction completes', async () => {
    const { h, control } = await integrated(); begin(h, { title: 'Wait for commit', notes: 'Captured text' });
    const e = editor(h); const hold = control.holdNextCommit(); const saving = save(h); await hold.reached;
    assert.equal(e.busy, true); assert.equal(h.$('lcJobTitle').disabled, true); assert.equal(h.$('lcJobNotes').disabled, true);
    assert.equal(h.$('lcJobSaveBtn').disabled, true); assert.equal(h.$('lcJobDiscardBtn').disabled, true);
    assert.equal(control.count('jobs'), 0); assert.match(status(h), /Saving/); assert.ok(!/Saved job version/.test(status(h)));
    assert.equal(await save(h), false); click(h, 'lcJobNewBtn'); assert.equal(editor(h), e);
    hold.release(); assert.equal(await saving, true); assert.equal(control.count('jobs'), 1);
    assert.match(status(h), /Saved job version 1/);
  });

  for (const error of ['QuotaExceededError', 'AbortError']) test(error + ' retains all entered fields and leaves head/history unchanged', async () => {
    const { h, control } = await integrated(); begin(h, { title: 'Original', address: 'A', notes: 'N' }); await save(h);
    const snapshot = JSON.stringify(control.snapshot()); click(h, 'lcJobEditBtn');
    h.set('lcJobTitle', 'Unsaved title'); h.set('lcJobAddress', 'Unsaved address'); h.set('lcJobNotes', 'Unsaved notes');
    const e = editor(h); control.abortNextCommit(error); assert.equal(await save(h), false);
    assert.equal(editor(h), e); assert.equal(e.busy, false); assert.equal(h.$('lcJobNotes').value, 'Unsaved notes');
    assert.equal(h.$('lcJobTitle').value, 'Unsaved title'); assert.equal(h.$('lcJobAddress').value, 'Unsaved address');
    assert.equal(JSON.stringify(control.snapshot()), snapshot); assert.match(status(h), /not saved.*draft has been kept/);
  });

  test('unchanged metadata and duplicate existing link do not create another revision', async () => {
    const result = resultRecord(1); const { h, control } = await integrated({ storageByKey: { [PREFIX + result.id]: JSON.stringify(result) } });
    begin(h, { title: 'Same data' }); addResult(h, result.id); await save(h);
    click(h, 'lcJobEditBtn'); addResult(h, result.id); assert.equal(editor(h).added.length, 0);
    assert.equal(await save(h), true); assert.equal(control.count('jobRevisions'), 1); assert.match(status(h), /No changes to save/);
  });

  test('missing IndexedDB and missing crypto report failure without localStorage fallback or discarded draft', async () => {
    for (const options of [{ indexedDB: null }, { indexedDB: makeIndexedDb().indexedDB, crypto: null }]) {
      const h = buildHarness(options); h.api.lcInit(); await tick(); begin(h, { title: 'Keep this draft', notes: 'Text' });
      const before = live(h); assert.equal(await save(h), false); assert.equal(h.$('lcJobNotes').value, 'Text');
      assert.equal(editor(h).busy, false); assert.match(status(h), /not saved/); sameLive(h, before);
    }
  });
});

describe('Explicit saved-result links and recovery', () => {
  test('chooser starts empty, accepts only an explicit valid selection, and stores original link metadata', async () => {
    const result = resultRecord(2, 'Original saved label'); const raw = JSON.stringify(result);
    const { h } = await integrated({ storageByKey: { [PREFIX + result.id]: raw, [PREFIX + sid(99)]: '{broken' } });
    const before = live(h); begin(h, { title: 'Linked job' });
    assert.equal(h.$('lcJobResultChoice').value, ''); click(h, 'lcJobAddResultBtn'); assert.equal(editor(h).added.length, 0);
    assert.match(h.$('lcJobChoiceStatus').textContent, /unreadable or unsupported/);
    addResult(h, result.id); addResult(h, result.id); assert.equal(editor(h).added.length, 1);
    await save(h); const revision = savedRevision(h); const link = revision.serviceResultLinks[0];
    assert.equal(revision.serviceResultLinks.length, 1);
    assert.deepEqual(link, { serviceResultId: result.id, linkedAt: revision.savedAt, savedName: result.name, savedAt: result.createdAt });
    sameLive(h, before);
  });

  test('changed record contents with the same ID/name/date are refused when adding from an old chooser', async () => {
    const result = resultRecord(3); const { h, control } = await integrated({ storageByKey: { [PREFIX + result.id]: JSON.stringify(result) } });
    begin(h, { title: 'Guard chooser' }); const changed = copy(result); changed.producer.applicationRevision = 'Another-supported-producer';
    assert.equal(Record.parseStoredRecord(JSON.stringify(changed)).ok, true); h.store.byKey[PREFIX + result.id] = JSON.stringify(changed);
    addResult(h, result.id); assert.equal(editor(h).added.length, 0); assert.match(status(h), /unavailable or changed/); assert.equal(control.count('jobs'), 0);
    click(h, 'lcJobChoiceRefreshBtn'); addResult(h, result.id); assert.equal(editor(h).added.length, 1);
  });

  for (const change of ['missing', 'changed']) test('new ' + change + ' target refuses save; remove only the unsaved link and preserve other edits/history', async () => {
    const old = resultRecord(4, 'Already linked'); const fresh = resultRecord(5, 'New link');
    const bytes = { [PREFIX + old.id]: JSON.stringify(old), [PREFIX + fresh.id]: JSON.stringify(fresh) };
    const { h, control } = await integrated({ storageByKey: bytes });
    begin(h, { title: 'Before', address: 'Old address', notes: 'Old notes' }); addResult(h, old.id); await save(h);
    const first = copy(savedRevision(h)); const firstBytes = JSON.stringify(control.raw('jobRevisions', first.revisionId));
    click(h, 'lcJobEditBtn'); h.set('lcJobTitle', 'Keep title'); h.set('lcJobAddress', 'Keep address'); h.set('lcJobNotes', 'Keep notes'); addResult(h, fresh.id);
    if (change === 'missing') delete h.store.byKey[PREFIX + fresh.id];
    else { const altered = copy(fresh); altered.producer.applicationRevision = 'Updated-saved-version'; h.store.byKey[PREFIX + fresh.id] = JSON.stringify(altered); }
    assert.equal(await save(h), false); assert.equal(control.count('jobRevisions'), 1); assert.equal(editor(h).added.length, 1);
    const remove = h.$('lcJobEditorLinks').querySelectorAll('.lc-job-remove-pending'); assert.equal(remove.length, 1);
    remove[0].dispatch('click'); assert.equal(editor(h).added.length, 0);
    assert.equal(h.$('lcJobTitle').value, 'Keep title'); assert.equal(h.$('lcJobAddress').value, 'Keep address'); assert.equal(h.$('lcJobNotes').value, 'Keep notes');
    assert.equal(await save(h), true); assert.equal(savedRevision(h).revisionNumber, 2);
    assert.deepEqual(savedRevision(h).serviceResultLinks, first.serviceResultLinks);
    assert.equal(JSON.stringify(control.raw('jobRevisions', first.revisionId)), firstBytes);
    assert.equal(h.$('lcJobWork').querySelectorAll('.lc-job-remove-pending').length, 0);
  });

  test('an old unavailable link remains visible and does not block ordinary metadata edits', async () => {
    const result = resultRecord(6); const { h, control } = await integrated({ storageByKey: { [PREFIX + result.id]: JSON.stringify(result) } });
    begin(h, { title: 'Before' }); addResult(h, result.id); await save(h); const first = copy(savedRevision(h));
    delete h.store.byKey[PREFIX + result.id]; click(h, 'lcJobEditBtn'); h.set('lcJobNotes', 'New note despite missing old result');
    assert.match(h.$('lcJobEditorLinks').textContent, /Linked result unavailable/);
    assert.equal(h.$('lcJobEditorLinks').querySelectorAll('.lc-job-remove-pending').length, 0);
    assert.equal(await save(h), true); assert.deepEqual(savedRevision(h).serviceResultLinks, first.serviceResultLinks);
    assert.equal(control.count('jobRevisions'), 2); assert.match(h.$('lcJobWork').textContent, /Linked result unavailable/);
  });

  test('a linked result opens through the inert historical viewer with no active calculator reads or writes', async () => {
    const result = resultRecord(7, '<img src=x onerror=alert(1)> saved label');
    const { h } = await integrated({ storageByKey: { [PREFIX + result.id]: JSON.stringify(result) }, storage: '{"vd":[{"name":"keep"}]}' });
    begin(h, { title: 'Read-only link' }); addResult(h, result.id); await save(h); const before = live(h);
    const descriptor = Object.getOwnPropertyDescriptor(h.api.LC, 'snapshot');
    let reads = 0; let evaluations = 0;
    h.EC.loadCalcFacade = { evaluateV2() { evaluations++; throw new Error('must not calculate'); } };
    h.EC.loadCalcServiceSizing = { analyzePrototype() { evaluations++; throw new Error('must not assess'); } };
    Object.defineProperty(h.api.LC, 'snapshot', { configurable: true, get() { reads++; throw new Error('must not read active inputs'); } });
    try {
      h.$('lcJobWork').querySelectorAll('.lc-job-result-open')[0].dispatch('click');
      assert.match(h.$('lcRecordView').textContent, /Saved result — historical/);
      assert.match(h.$('lcRecordView').textContent, /Conditional table reference — not a selection/);
      assert.ok(h.$('lcRecordView').textContent.includes(result.name));
      assert.equal(h.$('lcRecordView').querySelectorAll('input, textarea, select, a').length, 0);
      assert.equal(reads, 0); assert.equal(evaluations, 0);
    } finally { Object.defineProperty(h.api.LC, 'snapshot', descriptor); }
    sameLive(h, before);
  });

  test('fresh opening rejects replaced link-time identity without changing the saved label or record bytes', async () => {
    const result = resultRecord(8, 'Link-time name'); const { h, control } = await integrated({ storageByKey: { [PREFIX + result.id]: JSON.stringify(result) } });
    begin(h, { title: 'Keep original label' }); addResult(h, result.id); await save(h);
    const saved = copy(savedRevision(h)); const snapshot = JSON.stringify(control.snapshot()); const changed = copy(result); changed.name = 'Changed later';
    h.store.byKey[PREFIX + result.id] = JSON.stringify(changed);
    h.$('lcJobWork').querySelectorAll('.lc-job-result-open')[0].dispatch('click');
    assert.match(status(h), /unavailable/); assert.equal(savedRevision(h).serviceResultLinks[0].savedName, 'Link-time name');
    assert.equal(h.$('lcRecordView').textContent, ''); assert.equal(JSON.stringify(control.snapshot()), snapshot);
    assert.deepEqual(savedRevision(h), saved);
  });

  test('new link changed between Save click and store invocation is refused before a write begins', async () => {
    const result = resultRecord(9); let writes = 0;
    const { h } = await controlled({ create: async () => { writes++; return { ok: false, code: 'ABORTED', problems: ['Unexpected write.'] }; } }, { storageByKey: { [PREFIX + result.id]: JSON.stringify(result) } });
    begin(h, { title: 'Guard microtask' }); addResult(h, result.id); const pending = save(h);
    delete h.store.byKey[PREFIX + result.id]; assert.equal(await pending, false); assert.equal(writes, 0);
    assert.equal(editor(h).added.length, 1); assert.equal(h.$('lcJobTitle').value, 'Guard microtask'); assert.equal(editor(h).busy, false);
  });
});

describe('Async job UI lifecycle and contained failures', () => {
  test('invalid title is rejected without starting persistence or losing other fields', async () => {
    let writes = 0; const { h } = await controlled({ create: async () => { writes++; } });
    begin(h, { title: '   ', address: 'Keep address', notes: 'Keep notes' });
    assert.equal(await save(h), false); assert.equal(writes, 0);
    assert.equal(h.$('lcJobTitle').value, '   '); assert.equal(h.$('lcJobAddress').value, 'Keep address'); assert.equal(h.$('lcJobNotes').value, 'Keep notes');
    assert.match(status(h), /1 to 200/);
  });

  test('an unexpected rejected persistence promise becomes a visible failure and keeps the editor usable', async () => {
    const { h } = await controlled({ create: async () => { throw new Error('Synthetic provider rejection'); } });
    begin(h, { title: 'Keep after rejected promise', notes: 'Retained' }); const e = editor(h);
    assert.equal(await save(h), false); assert.equal(editor(h), e); assert.equal(e.busy, false);
    assert.equal(h.$('lcJobSaveBtn').disabled, false); assert.match(status(h), /provider rejection.*draft has been kept/);
  });

  test('successful save followed by list failure remains explicitly saved', async () => {
    const job = makeJob(20, { title: 'Committed' }); let saved = false;
    const { h } = await controlled({
      create: async () => { saved = true; return { ok: true, job }; },
      list: async () => saved ? { ok: false, code: 'ABORTED', problems: ['Refresh fault.'] } : { ok: true, jobs: [], problems: [] }
    });
    begin(h, { title: 'Committed' }); assert.equal(await save(h), true);
    assert.equal(editor(h), null); assert.equal(savedRevision(h).revisionId, job.revision.revisionId);
    assert.match(status(h), /Saved job version 1.*could not be refreshed/); assert.ok(!/not saved/.test(status(h)));
  });

  test('refresh updates only the list, keeps the dirty editor, and ignores an older list completion', async () => {
    const old = deferred(); const fresh = deferred(); let sequence = 0;
    const { h, store } = await controlled(); begin(h, { title: 'Dirty title', notes: 'Do not replace' });
    const e = editor(h); const message = status(h);
    store.list = () => (++sequence === 1 ? old.promise : fresh.promise);
    const first = h.api.lcJobRefresh(); const second = h.api.lcJobRefresh();
    fresh.resolve({ ok: true, jobs: [makeJob(22, { title: 'Newest list' })], problems: [] }); assert.equal(await second, true);
    old.resolve({ ok: true, jobs: [makeJob(21, { title: 'Older list' })], problems: [] }); assert.equal(await first, false);
    assert.equal(editor(h), e); assert.equal(h.$('lcJobNotes').value, 'Do not replace'); assert.equal(status(h), message);
    assert.match(h.$('lcJobList').textContent, /Newest list/); assert.ok(!/Older list/.test(h.$('lcJobList').textContent));
  });

  test('out-of-order card reads cannot replace the most recently selected card', async () => {
    const a = makeJob(23); const b = makeJob(24); const slow = deferred(); const fast = deferred();
    const { h } = await controlled({ read: (id) => id === a.head.jobId ? slow.promise : fast.promise });
    const first = h.api.lcJobOpen(a.head.jobId); const second = h.api.lcJobOpen(b.head.jobId);
    fast.resolve({ ok: true, job: b }); assert.equal(await second, true);
    slow.resolve({ ok: true, job: a }); assert.equal(await first, false);
    assert.equal(savedRevision(h).jobId, b.head.jobId); assert.match(h.$('lcJobWork').textContent, /Job 24/);
  });

  test('a late card read or history response cannot replace a newly opened dirty editor', async () => {
    const read = deferred(); const history = deferred(); const job = makeJob(25);
    const { h } = await controlled({ read: () => read.promise, history: () => history.promise });
    const opening = h.api.lcJobOpen(job.head.jobId); const readingHistory = h.api.lcJobHistory(job.head.jobId);
    const e = begin(h, { title: 'New draft takes priority', notes: 'Typed while reads wait' });
    read.resolve({ ok: true, job }); history.resolve({ ok: true, revisions: [job.revision] });
    assert.equal(await opening, false); assert.equal(await readingHistory, false);
    assert.equal(editor(h), e); assert.equal(h.$('lcJobNotes').value, 'Typed while reads wait'); assert.equal(h.$('lcJobReadView').attrs.hidden, '');
  });

  test('old detached Save and unsaved-link removal handlers cannot mutate the replacement editor', async () => {
    const result = resultRecord(10); let writes = 0;
    const { h } = await controlled({ create: async () => { writes++; return { ok: false, code: 'ABORTED', problems: ['Unexpected write.'] }; } }, { storageByKey: { [PREFIX + result.id]: JSON.stringify(result) } });
    begin(h, { title: 'Old editor' }); addResult(h, result.id);
    const oldSave = h.$('lcJobSaveBtn'); const oldRemove = h.$('lcJobEditorLinks').querySelectorAll('.lc-job-remove-pending')[0];
    await h.api.lcJobDiscard(editor(h), h.$('lcJobDiscardBtn')); begin(h, { title: 'New editor' }); addResult(h, result.id); const e = editor(h);
    oldSave.dispatch('click'); oldRemove.dispatch('click'); await tick();
    assert.equal(writes, 0); assert.equal(editor(h), e); assert.equal(e.added.length, 1); assert.equal(h.$('lcJobTitle').value, 'New editor');
  });

  test('detaching the hub before the queued store call prevents a hidden write', async () => {
    let writes = 0; const { h } = await controlled({ create: async () => { writes++; return { ok: true, job: makeJob(26) }; } });
    begin(h, { title: 'Detached' }); const pending = save(h); const hub = h.$('lcJobHub');
    h.dom.container.removeChild(hub); assert.equal(await pending, false); assert.equal(writes, 0);
  });

  test('late conflict latest-version read is ignored after explicit discard and another view', async () => {
    const initial = makeJob(27); const latest = nextJob(initial, { notes: 'Other window' }, 270);
    const pendingLatest = deferred(); let reads = 0;
    const { h } = await controlled({
      read: async () => { reads++; return reads === 2 ? pendingLatest.promise : { ok: true, job: reads === 1 ? initial : latest }; },
      save: async () => ({ ok: false, code: 'CONFLICT', currentRevisionId: latest.revision.revisionId, problems: ['Newer version.'] })
    });
    await h.api.lcJobOpen(initial.head.jobId); click(h, 'lcJobEditBtn'); h.set('lcJobNotes', 'My draft'); await save(h);
    const viewing = h.api.lcJobLatest(editor(h), h.$('lcJobLatestBtn')); await tick();
    await h.api.lcJobDiscard(editor(h), h.$('lcJobDiscardBtn'));
    pendingLatest.resolve({ ok: true, job: latest }); assert.equal(await viewing, false);
    assert.equal(editor(h), null); assert.equal(savedRevision(h).revisionId, latest.revision.revisionId);
    assert.equal(h.$('lcJobReadView').attrs.hidden, '');
  });

  test('unreadable job rows are visible and leave ordinary jobs and stored result bytes usable', async () => {
    const job = makeJob(28);
    const { h } = await controlled({ list: async () => ({ ok: true, jobs: [job], problems: [{ jobId: jid(29), code: 'UNSUPPORTED', problems: ['Future version retained.'] }] }), read: async () => ({ ok: true, job }) });
    assert.equal(jobRows(h).length, 1); assert.match(h.$('lcJobList').textContent, /Unreadable or unsupported job card/);
    assert.match(h.$('lcJobList').textContent, /Future version retained/); assert.equal(await h.api.lcJobOpen(job.head.jobId), true);
  });
});

describe('Job UI boundaries, accessible controls and text rendering', () => {
  test('job hub precedes the record hub/form, fields have native labels, IDs stay unique, and content is text', async () => {
    const result = resultRecord(11, '<img src=x> saved'); const { h } = await integrated({ storageByKey: { [PREFIX + result.id]: JSON.stringify(result) } });
    assert.equal(h.dom.container.children[0], h.$('lcJobHub'));
    assert.ok(h.dom.container.children.indexOf(h.$('lcRecordHub')) < h.dom.container.children.indexOf(h.$('lcForm')));
    begin(h, { title: '<img src=x onerror=alert(1)>', address: 'A & B', notes: '<script>bad()</script>' }); addResult(h, result.id);
    const labels = h.$('lcJobWork').querySelectorAll('label');
    for (const id of ['lcJobTitle', 'lcJobAddress', 'lcJobNotes', 'lcJobResultChoice']) assert.equal(labels.filter((n) => n.attrs.for === id).length, 1, id);
    assert.equal(h.$('lcJobToggleBtn').attrs['aria-controls'], 'lcJobBody'); assert.equal(h.$('lcJobToggleBtn').attrs['aria-expanded'], 'true');
    assert.equal(h.$('lcJobStatus').attrs.role, 'status'); assert.equal(h.$('lcJobStatus').attrs['aria-live'], 'polite');
    await save(h); await h.api.lcJobHistory(savedRevision(h).jobId, h.$('lcJobHistoryBtn'));
    h.$('lcJobWork').querySelectorAll('.lc-job-result-open')[0].dispatch('click');
    const ids = h.nodes().map((n) => n.id).filter(Boolean); assert.equal(new Set(ids).size, ids.length);
    assert.equal(h.nodes().reduce((n, el) => n + (el.innerHTMLWrites || 0), 0), 0);
    assert.ok(h.$('lcJobWork').textContent.includes('<script>bad()</script>'));
    assert.equal(h.$('lcJobWork').querySelectorAll('img, script').length, 0);
  });

  test('job source has no active calculator access, recalculation, restore, localStorage write, or rich reference routing', () => {
    const src = adapterSource(); const a = src.indexOf('// ── LC-JOB-CARD-1: independent browser job cards');
    const b = src.indexOf('// ── end LC-JOB-CARD-1 ──', a); assert.ok(a > 0 && b > a); const block = src.slice(a, b);
    for (const bad of [/\bLC(?:_CALC|_SVC)?\s*\./, /lcUpdate\(|lcCalculate\(|lcSvcAssess\(|lcTxn\(/, /lcFavRestore|favLoad/, /localStorage\.(?:setItem|removeItem|clear)\(/, /lcRich\(|lcRefFor\(|lcRefTitle\(|necLink\(/, /innerHTML/, /Math\.random/, /deleteDatabase/]) assert.ok(!bad.test(block), String(bad));
    assert.match(block, /lcRecordOpen\(LC_RECORD_PREFIX \+ link\.serviceResultId\)/);
    assert.match(block, /EC\.jobCardStore\.createJobStore\(window\.indexedDB, \{ crypto: window\.crypto \}\)/);
  });

  test('scoped CSS provides 16px controls, 44px buttons, wrapping, focus and hidden behavior before protected disclosure styles', () => {
    const a = html.indexOf('/* LC-JOB-CARD-1: independent job-card surfaces */');
    const b = html.indexOf('/* end LC-JOB-CARD-1: independent job-card surfaces */', a);
    assert.ok(a > 0 && b > a); assert.ok(b < html.indexOf('/* LC-SERVICE-UI-CLEANUP-1: one native disclosure'));
    const css = html.slice(a, b);
    for (const line of css.split('\n').filter((line) => line.startsWith('#'))) assert.ok(line.startsWith('#lcContent '));
    assert.match(css, /\.lc-job-field \{[^}]*font-size: 16px/); assert.match(css, /\.lc-job-button \{[^}]*min-height: 44px[^}]*font-size: 16px/);
    assert.match(css, /:focus-visible \{ outline: 2px/); assert.match(css, /\[hidden\][^{]*\{ display: none; \}/);
    assert.match(css, /overflow-wrap: anywhere/); assert.ok(!/opacity|zoom|user-scalable/.test(css));
  });
});
