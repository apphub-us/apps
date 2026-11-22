'use strict';
/**
 * EC-AUDIT-FIX-1 stage 3 (continuation) — the Load Calc "Save preset" path uses the shared Favorites store.
 * The shipped lcFavSave() is executed unwrapped (api.lcFavSaveAsync) with lock managers supplied by each test, so
 * the Promise contract, the lock request and the fresh read under the lock are the shipped ones.
 * (The other Load Calc suites call api.lcFavSave with the harness's immediate lock stand-in; see helpers/loadCalcDom.js.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildHarness, fnBody, html } = require('./helpers/loadCalcDom');

const HOSTED = fs.readFileSync(path.join(__dirname, '..', '..', 'candidate', 'browser', 'workspace', 'mobile.html'), 'utf8');
const row = (id, name) => ({ id, name, vals: { a: 1 } });
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** A lock manager that grants the lock on a later turn, like a browser, and records what was asked for. */
function deferredLocks(log, beforeGrant) {
  return { request: (name, opts, cb) => { log.push({ name, opts }); return new Promise((resolve, reject) => setImmediate(() => { try { if (beforeGrant) beforeGrant(); resolve(cb({ name })); } catch (e) { reject(e); } })); } };
}
function ready(opts) {
  const h = buildHarness(opts); h.api.lcInit(); h.set('lcOccupancy', 'nondwelling');
  return h;
}

test('lcFavSave returns a Promise and saves through the exclusive Favorites lock; nothing is written before the lock is granted', async () => {
  const log = []; const seed = JSON.stringify({ vd: [row(1, 'VD')], custom: { keep: true } });
  const h = ready({ storage: seed, promptAnswer: 'mine', locks: deferredLocks(log) });
  const pending = h.api.lcFavSaveAsync();
  assert.ok(pending instanceof Promise, 'a real Promise, not a boolean');
  assert.equal(typeof h.api.lcFavSave, 'function');   // the harness keeps both entry points
  assert.equal(h.store.data, seed, 'no write before the lock'); assert.equal(h.store.sets, 0);
  assert.equal(await pending, true);
  assert.deepEqual(log.map((l) => [l.name, l.opts.mode]), [['empire-code-favorites-v1', 'exclusive']]);
  const all = JSON.parse(h.store.data);
  assert.deepEqual(all.vd, [row(1, 'VD')]); assert.deepEqual(all.custom, { keep: true }); assert.equal(h.store.sets, 1);
  assert.equal(all.lc.length, 1); assert.equal(all.lc[0].name, 'mine'); assert.equal(all.lc[0].vals.lcv, 3); assert.equal(typeof all.lc[0].id, 'number');
  assert.match(h.$('lcFavStatus').textContent, /Saved as a new preset "mine" \(lcv-3\)/); assert.equal(h.state().fault, null);
});

test('the row is appended to what is in storage WHEN THE LOCK IS HELD, not to what was read earlier (no silent overwrite)', async () => {
  const log = []; let h = null;
  const foreign = JSON.stringify({ vd: [row(1, 'VD'), row(2, 'saved in another tab')], lc: [row(7, 'theirs')] });
  h = ready({ storage: JSON.stringify({ vd: [row(1, 'VD')] }), promptAnswer: 'mine', locks: deferredLocks(log, () => { h.store.data = foreign; }) });
  assert.equal(await h.api.lcFavSaveAsync(), true);
  const all = JSON.parse(h.store.data);
  assert.deepEqual(all.vd, JSON.parse(foreign).vd, 'the other tab\'s preset survived');
  assert.deepEqual(all.lc.map((f) => f.name), ['theirs', 'mine']);
});

test('a store that needs recovery is never appended to: refused before the prompt, bytes untouched, no lock taken', async () => {
  const seeds = [
    JSON.stringify({ cf: [{ id: 1 }], lc: [] }),                                  // unreadable row in ANOTHER calculator's list
    JSON.stringify({ lc: [row(5, 'a'), row(5, 'b')] }),                           // two presets with one identity
    JSON.stringify({ lc: [row(1, 'ok'), null, 'not-an-object'] }),                // unreadable Load Calc entries
    '{"lc": "str"}', '[]', '{truncated',
  ];
  for (const seed of seeds) {
    const log = []; const h = ready({ storage: seed, promptAnswer: 'x', locks: deferredLocks(log) });
    assert.equal(await h.api.lcFavSaveAsync(), false, seed);
    assert.equal(h.store.data, seed, 'bytes preserved: ' + seed); assert.equal(h.store.sets, 0); assert.equal(h.prompts.calls.length, 0, 'no name asked for a preset that cannot be stored');
    assert.equal(log.length, 0); assert.equal(h.state().fault.kind, 'storage');
    assert.match(h.state().fault.message, seed === '{truncated' ? /unreadable/ : /unexpected format/, seed);
    assert.match(h.state().fault.message, /Export raw data/); assert.match(h.$('lcFavStatus').textContent, /^Not saved/);
  }
});

test('recovery that appears between the first look and the lock is still refused under the lock', async () => {
  const log = []; let h = null; const damaged = JSON.stringify({ lc: [null] });
  h = ready({ promptAnswer: 'x', locks: deferredLocks(log, () => { h.store.data = damaged; }) });
  assert.equal(await h.api.lcFavSaveAsync(), false);
  assert.equal(h.store.data, damaged); assert.equal(h.store.sets, 0); assert.equal(log.length, 1);
  assert.match(h.state().fault.message, /need recovery/); assert.match(h.$('lcFavStatus').textContent, /need recovery, storage untouched/);
});

test('lock busy in another tab, and no lock manager at all: refused, nothing written, said plainly', async () => {
  const busy = ready({ promptAnswer: 'x', locks: { request: (name, opts, cb) => Promise.resolve(cb(null)) } });
  assert.equal(await busy.api.lcFavSaveAsync(), false);
  assert.equal(busy.store.data, null); assert.equal(busy.store.sets, 0); assert.match(busy.state().fault.message, /another tab/);
  const none = ready({ promptAnswer: 'x', locks: null });
  assert.equal(await none.api.lcFavSaveAsync(), false);
  assert.equal(none.store.data, null); assert.equal(none.prompts.calls.length, 0); assert.match(none.state().fault.message, /cross-tab lock/);
});

test('a refused write and an unverified write are reported truthfully (never as saved; "not confirmed" is not "nothing was written")', async () => {
  const seed = JSON.stringify({ lc: [row(1, 'old')] });
  const quota = ready({ storage: seed, promptAnswer: 'x', locks: deferredLocks([]) });
  quota.store.failNextSet = Object.assign(new Error('simulated'), { name: 'QuotaExceededError' });
  assert.equal(await quota.api.lcFavSaveAsync(), false);
  assert.equal(quota.store.data, seed); assert.match(quota.state().fault.message, /storage full or unavailable/); assert.match(quota.state().fault.message, /existing presets are unchanged/);
  assert.ok(!/Saved as a new preset/.test(quota.$('lcFavStatus').textContent));
  assert.equal(await quota.api.lcFavSaveAsync(), true, 'the next save works'); assert.equal(JSON.parse(quota.store.data).lc.length, 2); assert.equal(quota.state().fault, null);

  const dropped = ready({ storage: seed, promptAnswer: 'x', locks: deferredLocks([]) });
  dropped.localStorage.setItem = () => {};   // the browser "accepts" the write and stores nothing
  assert.equal(await dropped.api.lcFavSaveAsync(), false);
  assert.equal(dropped.store.data, seed);
  assert.match(dropped.state().fault.message, /NOT CONFIRMED/); assert.ok(!/Nothing was written/.test(dropped.state().fault.message));
  assert.match(dropped.$('lcFavStatus').textContent, /^Not confirmed/);
  await tick();
  assert.match(dropped.$('lc-fav-list').textContent, /Not confirmed/, 'the same notice is shown beside the presets list');
});

test('cancelled prompt and an unsaveable store state leave everything alone; the synchronous harness entry point agrees', async () => {
  const h = ready({ promptAnswer: null, locks: deferredLocks([]) });
  assert.equal(await h.api.lcFavSaveAsync(), false); assert.equal(h.store.data, null); assert.equal(h.prompts.calls.length, 1);
  // default harness lock (immediate): the same shipped function, outcome and effects observable synchronously
  const s = ready({ promptAnswer: 'sync' });
  assert.equal(s.api.lcFavSave(), true); assert.equal(JSON.parse(s.store.data).lc[0].name, 'sync'); assert.match(s.$('lcFavStatus').textContent, /Saved as a new preset "sync"/);
  assert.equal(await s.api.lcFavSaveAsync(), true); assert.equal(JSON.parse(s.store.data).lc.length, 2);
});

test('source: the Load Calc adapter no longer touches the Favorites key directly, in either page', () => {
  for (const [name, page] of [['core/mobile.html', html], ['hosted workspace/mobile.html', HOSTED]]) {
    const from = page.indexOf('// ── LOAD CALCULATION — EC-CALC-2 / B2 thin adapter'); const to = page.indexOf('// ── FAVORITES SYSTEM', from);
    assert.ok(from > 0 && to > from, name + ': adapter found');
    const adapter = page.slice(from, to);
    assert.ok(!/localStorage\.(?:setItem|getItem|removeItem)\(\s*FAV_KEY/.test(adapter), name + ': direct Favorites storage access is back');
    assert.ok(!adapter.includes('lcFavReadAll'), name);
    assert.ok(adapter.includes("EC.favoritesStore.add(favEnv(), 'lc',"), name);
  }
  const body = (page, fn) => { const i = page.indexOf('function ' + fn + '('); let depth = 0; for (let j = page.indexOf('{', i); j < page.length; j++) { if (page[j] === '{') depth++; else if (page[j] === '}' && --depth === 0) return page.slice(i, j + 1); } return ''; };
  assert.equal(body(HOSTED, 'lcFavSave'), fnBody('lcFavSave')); assert.equal(body(HOSTED, 'lcFavRefuse'), fnBody('lcFavRefuse'));
  assert.ok(fnBody('lcFavSave').length > 500);
});
