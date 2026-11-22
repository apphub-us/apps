'use strict';
/**
 * EC-03 / EC-05 (audit E07/FAV-02, FAV-03) and the EC-10 label — Favorites storage.
 *
 * Part 1 drives the storage boundary (src/storage/favoritesStore.js — the exact source both pages bundle) against
 * a simulated browser profile: ONE localStorage and ONE lock manager shared by every "tab", with asynchronous lock
 * callbacks like a real Web Locks implementation. Part 2 executes the SHIPPED presentation functions of
 * core/mobile.html and of the hosted workspace copy against a stub DOM. Outcomes are read from the stored bytes.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Fav = require('../src/storage/favoritesStore');

function profile(initial) {
  const map = new Map(); if (typeof initial === 'string') map.set(Fav.KEY, initial);
  const log = { sets: 0, removes: [] }; let refuse = null; let mangle = null;
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { log.sets++; if (refuse) { const e = refuse; if (!e.always) refuse = null; throw e; } const m = mangle; mangle = null; map.set(k, m ? m(String(v)) : String(v)); },
    removeItem: (k) => { log.removes.push(k); map.delete(k); },
  };
  const held = new Set();
  const locks = { request: (name, opts, cb) => new Promise((resolve, reject) => setImmediate(async () => {
    if (held.has(name)) { try { resolve(await cb(null)); } catch (e) { reject(e); } return; }   // exclusive + ifAvailable: not granted
    held.add(name); try { resolve(await cb({ name })); } catch (e) { reject(e); } finally { held.delete(name); }
  })) };
  const error = (name, always) => Object.assign(new Error(name), { name, always: !!always });
  return { map, log, storage, locks, held, env: { storage, locks }, raw: () => storage.getItem(Fav.KEY), refuse: (name, always) => { refuse = error(name, always); }, mangleNextWrite: (f) => { mangle = f; } };
}
const row = (name, id, vals) => ({ name, id, vals: vals || { a: String(id) } });
const LEGACY = JSON.stringify({ vd: [{ name: '20A · 100ft', vals: { amps: '20', feet: '100' }, id: 1700000000001 }], amp: [{ name: '8 AWG', vals: { wire: '8', temp: '104' }, id: 1700000000002, pinned: true }], zz: { keep: true } }, null, 1);   // historic shape, unknown metadata, non-compact whitespace
const TRUNCATED = LEGACY.slice(0, 57);
const AMP_STRING = JSON.stringify({ vd: [row('kept', 1)], amp: 'not-a-list' });
const BAD_ROW = JSON.stringify({ cf: [row('ok', 1), null, 'x', { name: 5, id: 2, vals: {} }] });
const RECOVERY = { 'truncated JSON': [TRUNCATED, 'corrupt'], 'null': ['null', 'unsupported'], 'array': ['[]', 'unsupported'], 'string': ['"x"', 'unsupported'], 'amp is a string': [AMP_STRING, 'unsupported'], 'invalid rows': [BAD_ROW, 'unsupported'] };

describe('favoritesStore — strict read', () => {
  test('absent and empty are an empty writable store; a valid historic store is readable byte for byte', () => {
    for (const initial of [undefined, '']) { const r = Fav.read(profile(initial).storage); assert.equal(r.state, 'absent'); assert.equal(r.usable, true); assert.deepEqual(r.data, {}); assert.deepEqual(r.problems, []); }
    const r = Fav.read(profile(LEGACY).storage);
    assert.equal(r.state, 'ok'); assert.equal(r.usable, true); assert.equal(r.raw, LEGACY);
    assert.deepEqual(Fav.rows(r, 'vd').map((f) => f.name), ['20A · 100ft']); assert.equal(Fav.rows(r, 'amp')[0].vals.temp, '104'); assert.deepEqual(Fav.rows(r, 'cf'), []);
  });
  test('damaged, wrong-shaped and unreachable storage are distinct recovery states, never "empty"', () => {
    for (const [label, [raw, state]] of Object.entries(RECOVERY)) {
      const r = Fav.read(profile(raw).storage);
      assert.equal(r.state, state, label); assert.equal(r.usable, false, label); assert.equal(r.raw, raw, label + ': exact raw kept'); assert.ok(r.problems.length >= 1 && r.problems.every((p) => typeof p === 'string' && p.length > 10), label);
    }
    const amp = Fav.read(profile(AMP_STRING).storage);
    assert.ok(/"amp"/.test(amp.problems.join(' ')), amp.problems.join(' ')); assert.deepEqual(Fav.rows(amp, 'amp'), [], 'no crash on a non-list collection (was: all[type].push is not a function)');
    assert.deepEqual(Fav.rows(amp, 'vd').map((f) => f.name), ['kept'], 'a valid collection stays available beside a broken one');
    assert.deepEqual(Fav.rows(Fav.read(profile(BAD_ROW).storage), 'cf').map((f) => f.id), [1], 'only rows this version can read are listed; null, strings and a row with a non-string name are not');
    const throwing = { getItem() { throw Object.assign(new Error('denied'), { name: 'SecurityError' }); } };
    for (const s of [throwing, null, undefined, {}]) { const r = Fav.read(s); assert.equal(r.state, 'unavailable'); assert.equal(r.usable, false); assert.equal(r.raw, null); }
  });
  test('rows() offers only rows validRow() accepts (review 3): an entry with vals:null is not a loadable preset, and nothing is repaired or dropped', async () => {
    const unreadable = [{ name: 'no values', id: 2, vals: null }, { name: 'list values', id: 3, vals: [] }, { name: 'no id', vals: {} }, { name: 'bad id', id: null, vals: {} }, { id: 6, vals: {} }, [], 7];
    const raw = JSON.stringify({ cf: [row('ok', 1), ...unreadable, row('also ok', 8)], vd: [row('other list', 1)] });
    const p = profile(raw); const r = Fav.read(p.storage);
    assert.equal(r.state, 'unsupported'); assert.equal(r.usable, false); assert.ok(/"cf"/.test(r.problems.join(' ')) && /7 entries this version cannot read/.test(r.problems.join(' ')), r.problems.join(' '));
    const listed = Fav.rows(r, 'cf');
    assert.deepEqual(listed.map((f) => [f.name, f.id]), [['ok', 1], ['also ok', 8]]); assert.ok(listed.every(Fav.validRow), 'every listed row is a valid row');
    assert.deepEqual(Fav.rows(r, 'vd').map((f) => f.name), ['other list']);
    assert.equal(r.raw, raw, 'the original value is still held exactly'); assert.equal(r.data.cf.length, 9, 'the parsed original still has every entry'); assert.equal(Fav.exportBytes(p.storage).raw, raw, 'and is exported whole');
    for (const m of [await Fav.add(p.env, 'cf', row('B', 50)), await Fav.remove(p.env, 'cf', 1), await Fav.remove(p.env, 'cf', 2)]) assert.equal(m.code, 'RECOVERY_REQUIRED');
    assert.equal(p.raw(), raw, 'not repaired, not rewritten'); assert.equal(p.log.sets, 0); assert.equal(Fav.read(p.storage).state, 'unsupported', 'still a recovery state after being listed');
  });
});

describe('favoritesStore — row identity (review 2)', () => {
  const dup = (a, b) => '{"vd":[{"name":"first","id":' + a + ',"vals":{"a":"1"}},{"name":"second","id":' + b + ',"vals":{"a":"2"}},{"name":"other","id":6,"vals":{"a":"6"}}],"amp":[{"name":"amp five","id":5,"vals":{"a":"5"}}]}';
  test('two rows of one collection with the same identity are a recovery state: a single delete never removes two rows, neither is listed, every byte stays', async () => {
    // equal numbers written differently, equal strings, and the numeric edge cases that `===` (what remove() uses) treats as one id
    for (const [a, b] of [['5', '5'], ['5', '5.0'], ['1000', '1e3'], ['0', '-0'], ['"k"', '"k"'], ['9007199254740992', '9007199254740993'], ['1700000000001', '1700000000001']]) {
      const raw = dup(a, b); const p = profile(raw); const r = Fav.read(p.storage); const label = a + ' / ' + b;
      const id = JSON.parse(a); assert.ok(JSON.parse(b) === id, label + ': the two ids are equal for ===');
      assert.equal(r.state, 'unsupported', label); assert.equal(r.usable, false, label);
      assert.ok(/"vd" presets collection contains 2 presets that share an identity/.test(r.problems.join(' ')), label + ': ' + r.problems.join(' ')); assert.ok(!/"amp"/.test(r.problems.join(' ')), label);
      assert.deepEqual(Fav.rows(r, 'vd').map((f) => f.name), ['other'], label + ': neither ambiguous row is offered for loading');
      assert.deepEqual(Fav.rows(r, 'amp').map((f) => f.name), ['amp five'], label + ': another collection is unaffected');
      const d = await Fav.remove(p.env, 'vd', id); assert.equal(d.ok, false, label); assert.equal(d.code, 'RECOVERY_REQUIRED', label + ' (was: ok, removed 2)');
      assert.equal((await Fav.remove(p.env, 'vd', 6)).code, 'RECOVERY_REQUIRED', label); assert.equal((await Fav.add(p.env, 'vd', row('B', 70))).code, 'RECOVERY_REQUIRED', label);
      assert.equal(p.raw(), raw, label + ': exact bytes preserved'); assert.equal(p.log.sets, 0, label); assert.deepEqual(p.log.removes, [], label);
      const out = Fav.exportBytes(p.storage); assert.equal(out.raw, raw, label + ': both rows are in the raw export'); assert.equal(JSON.parse(out.raw).vd.length, 3, label);
    }
    const three = JSON.stringify({ lc: [row('a', 1), row('b', 1), row('c', 1), row('d', 2), row('e', 2), row('f', 3)] });
    const r = Fav.read(profile(three).storage); assert.ok(/contains 5 presets that share an identity/.test(r.problems[0]), r.problems[0]); assert.deepEqual(Fav.rows(r, 'lc').map((f) => f.name), ['f']);
  });
  test('identity is strict, in inspect and in remove alike: the number 7 and the string "7" are two presets and each delete removes exactly its own row', async () => {
    const both = JSON.stringify({ vd: [row('number', 7), row('string', '7'), row('legacy string id', 'abc')] });
    const seen = Fav.read(profile(both).storage); assert.equal(seen.state, 'ok', seen.problems.join(' ')); assert.equal(Fav.rows(seen, 'vd').length, 3);
    const p = profile(both); const n = await Fav.remove(p.env, 'vd', 7);
    assert.equal(n.ok, true, JSON.stringify(n)); assert.deepEqual(n.value, { removed: 1 }); assert.deepEqual(JSON.parse(p.raw()).vd.map((f) => f.id), ['7', 'abc'], 'the string-id row is not taken with it');
    const q = profile(both); const s = await Fav.remove(q.env, 'vd', '7');
    assert.equal(s.ok, true, JSON.stringify(s)); assert.deepEqual(s.value, { removed: 1 }); assert.deepEqual(JSON.parse(q.raw()).vd.map((f) => f.id), [7, 'abc'], 'the number-id row is not taken with it');
    assert.equal((await Fav.remove(q.env, 'vd', '7')).code, 'NOT_FOUND'); assert.equal((await Fav.remove(q.env, 'vd', 'ABC')).code, 'NOT_FOUND'); assert.deepEqual(JSON.parse(q.raw()).vd.map((f) => f.id), [7, 'abc']);
  });
  test('the same id in two different collections is legitimate: both stay writable and a delete touches only its own collection', async () => {
    const p = profile(JSON.stringify({ vd: [row('vd five', 5)], amp: [row('amp five', 5)], cf: [row('cf five', '5')] }));
    assert.equal(Fav.read(p.storage).state, 'ok');
    const d = await Fav.remove(p.env, 'vd', 5); assert.equal(d.ok, true, JSON.stringify(d)); assert.deepEqual(d.value, { removed: 1 });
    assert.deepEqual(JSON.parse(p.raw()), { vd: [], amp: [row('amp five', 5)], cf: [row('cf five', '5')] });
    const a = await Fav.add(p.env, 'ww', row('ww five', 5)); assert.equal(a.ok, true); assert.equal(a.value.id, 5, 'an id used only in other collections is free here');
  });
});

describe('favoritesStore — new preset ids (review, robustness)', () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  test('a new id must be a safe integer: 1e100, 2^53, fractions and strings are refused before the lock, with no write — also when such an id is already stored', async () => {
    const raw = JSON.stringify({ vd: [row('huge', 1e100), row('past safe', 2 ** 53), row('legacy string', 'abc')] });
    const p = profile(raw); const before = Fav.read(p.storage);
    assert.equal(before.state, 'ok', 'existing large and string ids stay readable'); assert.deepEqual(Fav.rows(before, 'vd').map((f) => f.id), [1e100, 2 ** 53, 'abc']);
    let requests = 0; const counting = { storage: p.storage, locks: { request: (...args) => { requests++; return p.locks.request(...args); } } };
    for (const id of [1e100, 2 ** 53, -(2 ** 53), 1.5, Infinity, -Infinity, NaN, '5', null, undefined]) {
      const r = await Fav.add(counting, 'vd', { name: 'B', vals: { a: '1' }, id });   // was: `while (used) id++` never ends once id + 1 === id
      assert.equal(r.ok, false, String(id)); assert.equal(r.code, 'VALIDATION', String(id));
    }
    assert.equal(requests, 0, 'refused without asking for the lock'); assert.equal(p.log.sets, 0); assert.equal(p.raw(), raw);
    const ok = await Fav.add(counting, 'vd', row('normal', 1700000000000)); assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.deepEqual(JSON.parse(p.raw()).vd.map((f) => f.id), [1e100, 2 ** 53, 'abc', 1700000000000], 'legacy ids are rewritten unchanged');
    const d = await Fav.remove(p.env, 'vd', 1e100); assert.equal(d.ok, true, 'a legacy large id can still be addressed'); assert.deepEqual(JSON.parse(p.raw()).vd.map((f) => f.id), [2 ** 53, 'abc', 1700000000000]);
  });
  test('collision at Number.MAX_SAFE_INTEGER: the search stops there — ID_UNAVAILABLE, nothing written; one below still advances to the last safe id', async () => {
    const top = JSON.stringify({ vd: [row('top', MAX)] });
    const p = profile(top); const r = await Fav.add(p.env, 'vd', row('B', MAX));
    assert.equal(r.ok, false); assert.equal(r.code, 'ID_UNAVAILABLE', JSON.stringify(r)); assert.ok(/Nothing was changed/.test(r.problems[0])); assert.equal(p.raw(), top); assert.equal(p.log.sets, 0);
    const below = profile(JSON.stringify({ vd: [row('below', MAX - 1)] }));
    const a = await Fav.add(below.env, 'vd', row('B', MAX - 1)); assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.value.id, MAX, 'advanced by exactly one, to the last safe integer');
    const full = below.raw(); const sets = below.log.sets;
    for (const id of [MAX - 1, MAX]) { const again = await Fav.add(below.env, 'vd', row('C', id)); assert.equal(again.code, 'ID_UNAVAILABLE', String(id)); }
    assert.equal(below.raw(), full); assert.equal(below.log.sets, sets, 'no write for a refused id');
    assert.deepEqual(JSON.parse(full).vd.map((f) => f.id), [MAX - 1, MAX]); assert.ok(JSON.parse(full).vd.every((f) => Number.isSafeInteger(f.id)));
    const other = await Fav.add(below.env, 'amp', row('other collection', MAX)); assert.equal(other.ok, true, 'the bound is per collection'); assert.equal(other.value.id, MAX);
  });
  test('a long run of used ids is passed in one bounded search and yields the first free id', async () => {
    const start = 1700000000000; const run = []; for (let i = 0; i < 500; i++) run.push(row('n' + i, start + i));
    const p = profile(JSON.stringify({ lc: run.concat([row('string twin', String(start + 500))]) }));
    const a = await Fav.add(p.env, 'lc', row('B', start)); assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.value.id, start + 500, 'a string id never blocks a number id');
    assert.equal(p.log.sets, 1); assert.equal(Fav.read(p.storage).state, 'ok'); assert.equal(Fav.rows(Fav.read(p.storage), 'lc').length, 502);
  });
});

describe('favoritesStore — mutations', () => {
  test('every recovery state blocks add and remove and leaves the stored bytes untouched', async () => {
    for (const [label, [raw]] of Object.entries(RECOVERY)) {
      const p = profile(raw);
      const a = await Fav.add(p.env, 'vd', row('B', 5)); const d = await Fav.remove(p.env, 'vd', 1);
      for (const r of [a, d]) { assert.equal(r.ok, false, label); assert.equal(r.code, 'RECOVERY_REQUIRED', label); assert.ok(/need recovery/.test(r.problems[0]), label); }
      assert.equal(p.raw(), raw, label + ': exact bytes preserved'); assert.equal(p.log.sets, 0, label + ': no write attempted'); assert.deepEqual(p.log.removes, [], label);
    }
  });
  test('normal add -> reload -> delete -> reload; historic presets and unknown metadata survive every rewrite', async () => {
    const p = profile(LEGACY);
    const a = await Fav.add(p.env, 'cf', row('EMT 3/4', 1700000000009, { conduitType: 'emt' })); assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.raw, p.raw());
    const same = await Fav.add(p.env, 'cf', row('same millisecond', 1700000000009)); assert.equal(same.ok, true); assert.equal(same.value.id, 1700000000010, 'an id in use is advanced, never reused');
    let reloaded = Fav.read(p.storage); assert.equal(reloaded.state, 'ok');
    assert.deepEqual(Fav.rows(reloaded, 'cf').map((f) => [f.name, f.id]), [['EMT 3/4', 1700000000009], ['same millisecond', 1700000000010]]);
    assert.deepEqual(reloaded.data.zz, { keep: true }); assert.equal(reloaded.data.amp[0].pinned, true, 'unknown row metadata kept'); assert.deepEqual(reloaded.data.vd, JSON.parse(LEGACY).vd);
    const d = await Fav.remove(p.env, 'cf', 1700000000009); assert.equal(d.ok, true);
    reloaded = Fav.read(p.storage); assert.deepEqual(Fav.rows(reloaded, 'cf').map((f) => f.id), [1700000000010]); assert.deepEqual(reloaded.data.zz, { keep: true }); assert.deepEqual(reloaded.data.amp, JSON.parse(LEGACY).amp);
    const gone = await Fav.remove(p.env, 'cf', 1700000000009); assert.equal(gone.code, 'NOT_FOUND'); assert.equal(Fav.read(p.storage).raw, reloaded.raw);
    const first = profile(); assert.equal((await Fav.add(first.env, 'amp', row('first ever', 1))).ok, true); assert.deepEqual(JSON.parse(first.raw()), { amp: [row('first ever', 1)] });
    for (const bad of [{ name: '', id: 1, vals: {} }, { name: 'x', id: 1, vals: null }, { name: 'x', id: NaN, vals: {} }, null]) { const r = await Fav.add(first.env, 'amp', bad); assert.equal(r.code, 'VALIDATION'); }
    assert.equal((await Fav.add(first.env, 'nope', row('x', 2))).code, 'VALIDATION'); assert.deepEqual(JSON.parse(first.raw()), { amp: [row('first ever', 1)] });
  });
  test('QuotaExceededError / SecurityError: no false success, old list byte-identical, retry works once storage accepts the write', async () => {
    for (const [name, code] of [['QuotaExceededError', 'QUOTA'], ['SecurityError', 'SECURITY'], ['UnknownError', 'WRITE_FAILED']]) {
      const p = profile(LEGACY); p.refuse(name);
      const r = await Fav.add(p.env, 'vd', row('B', 7));
      assert.equal(r.ok, false, name); assert.equal(r.code, code, name); assert.equal(r.preserved, true, name); assert.ok(/unchanged/.test(r.problems[0]), r.problems[0]);
      assert.equal(p.raw(), LEGACY, name + ': old bytes intact'); assert.equal(p.log.sets, 1);
      const retry = await Fav.add(p.env, 'vd', row('B', 7)); assert.equal(retry.ok, true, name + ': retry'); assert.equal(Fav.rows(Fav.read(p.storage), 'vd').length, 2);
    }
  });
  test('review 1: a writer that ignores the lock (an older tab) lands between the write and the read-back — its value survives; exactly one setItem, no rollback', async () => {
    const start = JSON.stringify({ vd: [row('start', 1)] }); const foreign = JSON.stringify({ vd: [row('start', 1), row('older tab', 2)] });
    for (const mutation of ['add', 'remove']) {
      const p = profile(start); const written = [];
      // our setItem is stored for real; the other tab's write (not through this storage object, so not counted) replaces it before the read-back
      const storage = { getItem: p.storage.getItem, removeItem: p.storage.removeItem, setItem: (k, v) => { p.storage.setItem(k, v); written.push(v); p.map.set(k, foreign); } };
      const r = mutation === 'add' ? await Fav.add({ storage, locks: p.locks }, 'vd', row('mine', 3)) : await Fav.remove({ storage, locks: p.locks }, 'vd', 1);
      assert.equal(r.ok, false, mutation + ': not reported as saved'); assert.equal(r.code, 'VERIFY_FAILED', JSON.stringify(r));
      assert.equal(r.confirmed, false); assert.equal(r.preserved, false); assert.equal(r.observed, 'different'); assert.equal(r.restored, undefined, 'no rollback is claimed');
      assert.ok(/not confirmed as saved/.test(r.problems[0]) && /left exactly as it was found/.test(r.problems[0]), r.problems[0]);
      assert.equal(p.raw(), foreign, mutation + ': the other tab’s newer value is still there (was: overwritten with the pre-mutation bytes)');
      assert.equal(p.log.sets, 1, mutation + ': exactly one setItem — the mutation itself'); assert.equal(written.length, 1); assert.notEqual(written[0], start); assert.deepEqual(p.log.removes, []);
      assert.deepEqual(Fav.rows(Fav.read(p.storage), 'vd').map((f) => f.name), ['start', 'older tab']);
    }
  });
  test('review 1: when the read-back is refused or throws there is no blind rollback — one setItem, the outcome is reported as unknown', async () => {
    const denied = () => { throw Object.assign(new Error('denied'), { name: 'SecurityError' }); };
    for (const [label, after] of [['getItem throws', denied], ['getItem returns a non-string', () => 42]]) {
      const p = profile(LEGACY); let wrote = false;
      const storage = { getItem: (k) => (wrote ? after() : p.storage.getItem(k)), removeItem: p.storage.removeItem, setItem: (k, v) => { p.storage.setItem(k, v); wrote = true; } };
      const r = await Fav.add({ storage, locks: p.locks }, 'vd', row('B', 7));
      assert.equal(r.ok, false, label); assert.equal(r.code, 'VERIFY_FAILED', label + ': ' + JSON.stringify(r)); assert.equal(r.confirmed, false, label); assert.equal(r.preserved, false, label); assert.equal(r.observed, 'unreadable', label);
      assert.ok(/may or may not be stored/.test(r.problems[0]) && /Nothing else was written/.test(r.problems[0]), r.problems[0]);
      assert.equal(p.log.sets, 1, label + ': the previous bytes were NOT written back'); assert.deepEqual(p.log.removes, [], label);
      assert.notEqual(p.raw(), LEGACY, label); assert.deepEqual(JSON.parse(p.raw()).vd.map((f) => f.name), ['20A · 100ft', 'B'], label + ': what the single write stored is left as it is');
    }
  });
  test('review 1: a write the browser stores differently, or silently drops, is never reported as saved and is never followed by a second write', async () => {
    const p = profile(LEGACY); let stored = null; p.mangleNextWrite((v) => { stored = v.slice(0, v.length - 3); return stored; });
    const r = await Fav.add(p.env, 'vd', row('B', 7));
    assert.equal(r.ok, false); assert.equal(r.code, 'VERIFY_FAILED'); assert.equal(r.observed, 'different'); assert.equal(r.preserved, false); assert.equal(r.restored, undefined);
    assert.equal(p.raw(), stored, 'the observed bytes are left for export, not replaced'); assert.equal(p.log.sets, 1);
    assert.equal(Fav.read(p.storage).state, 'corrupt', 'the next read reports the damage instead of hiding it'); assert.equal(Fav.exportBytes(p.storage).raw, stored);
    const q = profile(LEGACY); q.mangleNextWrite(() => LEGACY);   // accepted, but the old value is still what is stored
    const dropped = await Fav.add(q.env, 'vd', row('B', 7));
    assert.equal(dropped.ok, false); assert.equal(dropped.code, 'VERIFY_FAILED'); assert.equal(dropped.observed, 'previous'); assert.equal(dropped.preserved, true); assert.ok(/existing presets are unchanged/.test(dropped.problems[0]), dropped.problems[0]);
    assert.equal(q.raw(), LEGACY); assert.equal(q.log.sets, 1);
    const retry = await Fav.add(q.env, 'vd', row('B', 7)); assert.equal(retry.ok, true, 'a later attempt on a healthy store still saves'); assert.equal(q.log.sets, 2);
  });
  test('without a lock manager mutations are unavailable — reading and exporting still work, nothing is written', async () => {
    const p = profile(LEGACY);
    for (const locks of [undefined, null, {}, { request: 'nope' }]) {
      const env = { storage: p.storage, locks }; assert.equal(Fav.canMutate(env), false);
      for (const r of [await Fav.add(env, 'vd', row('B', 7)), await Fav.remove(env, 'vd', 1700000000001), await Fav.reset(env, { confirmed: true, expectedRaw: LEGACY })]) { assert.equal(r.ok, false); assert.equal(r.code, 'LOCK_UNAVAILABLE'); }
    }
    assert.equal(p.raw(), LEGACY); assert.equal(p.log.sets, 0); assert.deepEqual(p.log.removes, []);
    assert.equal(Fav.read(p.storage).state, 'ok'); assert.equal(Fav.exportBytes(p.storage).ok, true); assert.equal(Fav.canMutate(p.env), true);
    const throwing = { request() { throw new Error('denied'); } }; assert.equal((await Fav.add({ storage: p.storage, locks: throwing }, 'vd', row('B', 7))).code, 'LOCK_UNAVAILABLE');
    const rejecting = { request: () => Promise.reject(new Error('x')) }; assert.equal((await Fav.add({ storage: p.storage, locks: rejecting }, 'vd', row('B', 7))).code, 'LOCK_UNAVAILABLE'); assert.equal(p.raw(), LEGACY);
  });
  test('two tabs: simultaneous saves both land (each is applied to the fresh stored list); a tab that holds the lock makes the other refuse cleanly', async () => {
    const p = profile(JSON.stringify({ vd: [row('start', 1)] }));
    const tabA = { storage: p.storage, locks: p.locks }, tabB = { storage: p.storage, locks: p.locks };   // same profile, two tabs
    const [a, b] = await Promise.all([Fav.add(tabA, 'vd', row('from A', 10)), Fav.add(tabB, 'vd', row('from B', 10))]);
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.deepEqual(Fav.rows(Fav.read(p.storage), 'vd').map((f) => [f.name, f.id]), [['start', 1], ['from A', 10], ['from B', 11]], 'no lost update, no duplicate id');
    // tab A is inside a (slow) locked operation; tab B must not write and must say so
    let release; const slow = p.locks.request(Fav.LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, () => new Promise((r) => { release = r; }));
    await new Promise((r) => setImmediate(r));
    const before = p.raw(); const busy = await Fav.add(tabB, 'vd', row('while busy', 20)); const busyDel = await Fav.remove(tabB, 'vd', 1);
    assert.equal(busy.code, 'BUSY'); assert.equal(busyDel.code, 'BUSY'); assert.equal(p.raw(), before);
    release(); await slow;
    assert.equal((await Fav.add(tabB, 'vd', row('after', 20))).ok, true);
    // tab B deletes what tab A deleted a moment earlier: applied to fresh state -> NOT_FOUND, nothing rewritten
    assert.equal((await Fav.remove(tabA, 'vd', 10)).ok, true); const sets = p.log.sets; assert.equal((await Fav.remove(tabB, 'vd', 10)).code, 'NOT_FOUND'); assert.equal(p.log.sets, sets);
  });
  test('a writer that ignores the lock (an older tab) between the fresh read and the write is detected: CONFLICT, no overwrite', async () => {
    const p = profile(JSON.stringify({ vd: [row('start', 1)] })); const foreign = JSON.stringify({ vd: [row('start', 1), row('older tab', 2)] });
    let reads = 0; const storage = { getItem: (k) => { if (++reads === 2) p.map.set(k, foreign); return p.storage.getItem(k); }, setItem: p.storage.setItem, removeItem: p.storage.removeItem };
    const r = await Fav.add({ storage, locks: p.locks }, 'vd', row('mine', 3));
    assert.equal(r.ok, false); assert.equal(r.code, 'CONFLICT'); assert.equal(p.raw(), foreign, 'the other writer’s data is not overwritten'); assert.equal(p.log.sets, 0);
  });
});

describe('favoritesStore — raw export and explicit reset', () => {
  test('export returns the exact stored value for every state, writes nothing and does not depend on free quota', () => {
    const lone = '{"a":"\ud800 broken"}';
    for (const raw of [LEGACY, TRUNCATED, 'null', AMP_STRING, '{"n":"żółć € 🔌"}', lone]) {
      const p = profile(raw); p.refuse('QuotaExceededError', true);
      const r = Fav.exportBytes(p.storage); assert.equal(r.ok, true); assert.equal(r.raw, raw); assert.ok(r.bytes instanceof Uint8Array);
      if (raw === lone) {
        assert.equal(r.encoding, 'utf-16le'); assert.deepEqual([r.bytes[0], r.bytes[1]], [0xFF, 0xFE]);
        let back = ''; for (let i = 2; i < r.bytes.length; i += 2) back += String.fromCharCode(r.bytes[i] | (r.bytes[i + 1] << 8));
        assert.equal(back, raw, 'every stored code unit survives, including the unpaired surrogate');
      } else {
        assert.equal(r.encoding, 'utf-8'); assert.ok(Buffer.from(r.bytes).equals(Buffer.from(raw, 'utf8')), 'independent encoder agrees'); assert.equal(Buffer.from(r.bytes).toString('utf8'), raw);
      }
      assert.equal(p.log.sets, 0); assert.deepEqual(p.log.removes, []); assert.equal(p.raw(), raw);
    }
    assert.equal(Fav.exportBytes(profile().storage).code, 'EMPTY'); assert.equal(Fav.exportBytes(null).code, 'UNAVAILABLE');
  });
  test('reset: unconfirmed or stale requests change nothing; a confirmed reset removes ONLY the Favorites key', async () => {
    const p = profile(TRUNCATED); p.map.set('empire_code_service_result_v1:sr1_x', '{"keep":1}'); p.map.set('nec_ai_key', 'other');
    for (const request of [undefined, {}, { confirmed: false, expectedRaw: TRUNCATED }, { confirmed: 'yes', expectedRaw: TRUNCATED }]) { const r = await Fav.reset(p.env, request); assert.equal(r.code, 'CONFIRMATION'); }
    assert.equal((await Fav.reset(p.env, { confirmed: true, expectedRaw: LEGACY })).code, 'CONFLICT', 'the data is no longer what the user was shown');
    assert.equal(p.raw(), TRUNCATED); assert.deepEqual(p.log.removes, []);
    p.held.add(Fav.LOCK_NAME); assert.equal((await Fav.reset(p.env, { confirmed: true, expectedRaw: TRUNCATED })).code, 'BUSY'); p.held.delete(Fav.LOCK_NAME); assert.equal(p.raw(), TRUNCATED);
    const r = await Fav.reset(p.env, { confirmed: true, expectedRaw: TRUNCATED });
    assert.deepEqual(r, { ok: true }); assert.equal(p.raw(), null); assert.deepEqual(p.log.removes, [Fav.KEY]); assert.equal(p.log.sets, 0);
    assert.deepEqual([...p.map.entries()], [['empire_code_service_result_v1:sr1_x', '{"keep":1}'], ['nec_ai_key', 'other']], 'every other key is untouched');
    assert.equal(Fav.read(p.storage).state, 'absent'); assert.equal((await Fav.add(p.env, 'vd', row('fresh', 1))).ok, true, 'saving works again after the reset');
  });
  test('reset that cannot be confirmed says what is actually known: "still present" only when the data was read back; "not known" when the re-check was refused', async () => {
    const kept = profile(TRUNCATED); const ignoring = { getItem: kept.storage.getItem, setItem: kept.storage.setItem, removeItem: (k) => { kept.log.removes.push(k); } };
    const present = await Fav.reset({ storage: ignoring, locks: kept.locks }, { confirmed: true, expectedRaw: TRUNCATED });
    assert.equal(present.code, 'VERIFY_FAILED'); assert.ok(/still present/.test(present.problems[0]), present.problems[0]); assert.equal(kept.raw(), TRUNCATED); assert.deepEqual(kept.log.removes, [Fav.KEY]); assert.equal(kept.log.sets, 0);
    const p = profile(TRUNCATED); let removed = false;
    const blind = { getItem: (k) => { if (removed) throw Object.assign(new Error('denied'), { name: 'SecurityError' }); return p.storage.getItem(k); }, setItem: p.storage.setItem, removeItem: (k) => { p.storage.removeItem(k); removed = true; } };
    const unknown = await Fav.reset({ storage: blind, locks: p.locks }, { confirmed: true, expectedRaw: TRUNCATED });
    assert.equal(unknown.ok, false); assert.equal(unknown.code, 'VERIFY_FAILED'); assert.ok(/not known whether/.test(unknown.problems[0]), unknown.problems[0]); assert.notEqual(unknown.problems[0], present.problems[0], 'the refused re-check is not worded as a confirmed "still present"');
    assert.deepEqual(p.log.removes, [Fav.KEY], 'one removal, nothing else'); assert.equal(p.log.sets, 0);
  });
});

/* ── Part 2: the shipped presentation functions, both pages ─────────────────────────────────────────────── */
const PAGES = [['core/mobile.html', path.join(__dirname, '..', 'mobile.html')], ['hosted workspace/mobile.html', path.join(__dirname, '..', '..', 'candidate', 'browser', 'workspace', 'mobile.html')]];
const UI_FNS = ['favState', 'favStorage', 'favEnv', 'favRead', 'favGetAll', 'favRefresh', 'favSettle', 'favExport', 'favRetry', 'favReset', 'favStatusNode', 'favGetLabel', 'favSave', 'favLoad', 'favDelete', 'favRender'];
function fnOf(page, name) {
  const i = page.indexOf('function ' + name + '('); assert.ok(i >= 0, 'function not found: ' + name);
  let depth = 0; let started = false;
  for (let j = i; j < page.length; j++) { if (page[j] === '{') { depth++; started = true; } else if (page[j] === '}') { depth--; if (started && depth === 0) return page.slice(i, j + 1); } }
  throw new Error('unbalanced: ' + name);
}
function ui(page, p, opts = {}) {
  const byId = {};
  const mk = (tag) => ({ tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, style: {}, className: '', textContent: '', parent: null, clicked: 0,
    appendChild(c) { this.children.push(c); c.parent = this; return c; }, removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; }, remove() { if (this.parent) this.parent.removeChild(this); },
    get firstChild() { return this.children[0] || null; }, setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    click() { this.clicked++; (this.listeners.click || []).forEach((f) => f({ stopPropagation() {} })); } });
  for (const t of Fav.TYPES) byId[t + '-fav-list'] = mk('div');
  const document = { createElement: mk, getElementById: (id) => byId[id] || null, body: mk('body') };
  const seen = { prompts: [], confirms: [], blobs: [], anchors: [], applied: [] };
  const origCreate = document.createElement; document.createElement = (tag) => { const el = origCreate(tag); if (tag === 'a') seen.anchors.push(el); return el; };
  const api = new Function('EC', 'navigator', 'document', 'localStorage', 'prompt', 'confirm', 'URL', 'Blob', 'setTimeout', 'favGetValues', 'favSetValues', 'lcFavLabel',   // eslint-disable-line no-new-func
    "var FAV_KEY = 'sparky_favorites';" + UI_FNS.map((n) => fnOf(page, n)).join('\n') + '; return { favState, favSave, favLoad, favDelete, favRender, favReset, favGetLabel };')(
    { favoritesStore: Fav }, opts.noLocks ? {} : { locks: p.locks }, document, p.storage,
    (msg, def) => { seen.prompts.push([msg, def]); return opts.name === undefined ? 'B' : opts.name; }, (msg) => { seen.confirms.push(msg); return opts.confirm === true; },
    { createObjectURL: (blob) => { seen.blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} }, Blob, () => 0,
    () => opts.vals || { wire: '8', insul: '75', material: 'cu', temp: '104', bundle: '1.00' }, (t, vals) => seen.applied.push([t, vals]), () => 'Load Calc');
  const list = (t) => byId[t + '-fav-list'];
  const text = (el) => el.textContent + el.children.map(text).join(' ');
  const status = (t) => list(t).children.filter((c) => c.className === 'fav-status');
  const rows = (t) => list(t).children.filter((c) => c.className === 'fav-item');
  const button = (t, label) => status(t)[0].children[status(t)[0].children.length - 1].children.find((b) => b.textContent === label);
  return { api, seen, list, text, status, rows, button };
}

for (const [label, file] of PAGES) {
  describe('Favorites UI — ' + label, { skip: fs.existsSync(file) ? false : 'page not found' }, () => {
    const page = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    test('EC-10: the proposed Ampacity preset name carries the ambient temperature that is actually saved', () => {
      const h = ui(page, profile());
      assert.equal(h.api.favGetLabel('amp', { wire: '8', temp: '104' }), '8 AWG · 104°F'); assert.equal(h.api.favGetLabel('amp', { wire: '12', temp: '86' }), '12 AWG · 86°F');
      assert.ok(/temp: document\.getElementById\('ampTemp'\)\.value/.test(fnOf(page, 'favGetValues')), 'the saved field is `temp`'); assert.ok(!/vals\.ambient/.test(fnOf(page, 'favGetLabel')));
    });
    test('normal save confirms success, lists the preset after a reload, and delete removes it', async () => {
      const p = profile(LEGACY); const h = ui(page, p); h.api.favRender('amp');
      assert.equal(h.status('amp').length, 0, 'a healthy store shows no status'); assert.equal(h.rows('amp').length, 1);
      assert.equal(await h.api.favSave('amp'), true); assert.deepEqual(h.seen.prompts[0], ['Name this preset:', '8 AWG · 104°F']);
      assert.equal(h.rows('amp').length, 2); assert.equal(h.status('amp')[0].attrs.role, 'status'); assert.ok(/Saved preset "B"\./.test(h.text(h.status('amp')[0])));
      const reloaded = ui(page, p); reloaded.api.favRender('amp'); assert.equal(reloaded.rows('amp').length, 2); assert.equal(reloaded.status('amp').length, 0);
      const saved = Fav.rows(Fav.read(p.storage), 'amp')[1]; assert.equal(saved.name, 'B'); assert.equal(saved.vals.temp, '104');
      reloaded.rows('amp')[1].click(); assert.deepEqual(reloaded.seen.applied, [['amp', saved.vals]], 'a row click loads its values');
      assert.equal(await reloaded.api.favDelete('amp', saved.id), true); assert.equal(reloaded.rows('amp').length, 1); assert.deepEqual(JSON.parse(p.raw()).zz, { keep: true });
      assert.equal(await ui(page, p, { name: null }).api.favSave('amp'), false, 'cancelling the name prompt saves nothing'); assert.equal(Fav.rows(Fav.read(p.storage), 'amp').length, 1);
    });
    test('truncated JSON / null / wrong-typed collection: persistent recovery status, Save and Delete refused, stored bytes identical, readable presets still load', async () => {
      for (const [name, [raw]] of Object.entries(RECOVERY)) {
        const p = profile(raw); const h = ui(page, p); h.api.favRender('amp'); h.api.favRender('vd');
        assert.equal(h.status('amp').length, 1, name); assert.equal(h.status('amp')[0].attrs.role, 'alert', name); assert.ok(/Saved presets need recovery/.test(h.text(h.status('amp')[0])) && /Calculators keep working/.test(h.text(h.status('amp')[0])), name);
        for (const b of ['Export raw data', 'Retry', 'Reset Favorites…']) assert.ok(h.button('amp', b), name + ': ' + b);
        assert.equal(await h.api.favSave('amp'), false, name); assert.equal(await h.api.favDelete('vd', 1), false, name);
        assert.equal(p.raw(), raw, name + ': not one byte changed (was: silently replaced on the next Save)'); assert.equal(p.log.sets, 0, name);
        assert.ok(/Not deleted/.test(h.text(h.status('vd')[0])) && /Your entries on this screen are unchanged/.test(h.text(h.status('vd')[0])), name);
        h.button('amp', 'Retry').click(); assert.equal(h.status('amp').length, 1, name + ': the status persists while the data is still unreadable');
      }
      const h = ui(page, profile(AMP_STRING)); h.api.favRender('vd'); assert.equal(h.rows('vd').length, 1); h.api.favLoad('vd', 1); assert.equal(h.seen.applied.length, 1, 'valid presets remain usable');
    });
    test('refused write (quota / security): visible "Not saved", old list kept, export offered, retry succeeds', async () => {
      for (const name of ['QuotaExceededError', 'SecurityError']) {
        const p = profile(LEGACY); const h = ui(page, p); h.api.favRender('amp'); p.refuse(name);
        assert.equal(await h.api.favSave('amp'), false, name + ': no false success (was: uncaught exception, no message)');
        assert.equal(p.raw(), LEGACY, name); assert.equal(h.rows('amp').length, 1, name + ': the old preset is still listed');
        const s = h.status('amp')[0]; assert.equal(s.attrs.role, 'alert'); assert.ok(/Not saved/.test(h.text(s)) && /existing presets are unchanged/.test(h.text(s)), h.text(s)); assert.ok(h.button('amp', 'Export raw data'));
        assert.equal(await h.api.favSave('amp'), true, name + ': retry'); assert.equal(h.rows('amp').length, 2);
      }
    });
    test('review 1: an unconfirmed save is shown as "Not confirmed" (never "Not saved"), the other tab’s value is kept and listed, the form is untouched and export is offered', async () => {
      const foreign = JSON.stringify({ amp: [row('8 AWG', 1), row('older tab', 2)] });
      const p = profile(JSON.stringify({ amp: [row('8 AWG', 1)] }));
      const storage = { getItem: p.storage.getItem, removeItem: p.storage.removeItem, setItem: (k, v) => { p.storage.setItem(k, v); p.map.set(k, foreign); } };
      const h = ui(page, Object.assign({}, p, { storage })); h.api.favRender('amp'); assert.equal(h.rows('amp').length, 1);
      assert.equal(await h.api.favSave('amp'), false, 'no false success');
      assert.equal(p.raw(), foreign, 'the value written by the other tab is not rolled back'); assert.equal(p.log.sets, 1, 'one write only');
      const s = h.status('amp')[0]; assert.equal(s.attrs.role, 'alert');
      assert.ok(/Not confirmed — /.test(h.text(s)) && !/Not saved/.test(h.text(s)), h.text(s)); assert.ok(/not confirmed as saved/.test(h.text(s)) && /Your entries on this screen are unchanged/.test(h.text(s)), h.text(s));
      assert.equal(h.rows('amp').length, 2, 'the list shows what is actually stored now'); assert.ok(h.button('amp', 'Export raw data')); assert.ok(h.button('amp', 'Dismiss'));
      assert.deepEqual(h.seen.applied, [], 'the calculator form was not written to');
      // the read-back itself is refused: the outcome is unknown and is worded that way
      const q = profile(LEGACY); let wrote = false;
      const blind = { getItem: (k) => { if (wrote) throw Object.assign(new Error('denied'), { name: 'SecurityError' }); return q.storage.getItem(k); }, removeItem: q.storage.removeItem, setItem: (k, v) => { q.storage.setItem(k, v); wrote = true; } };
      const g = ui(page, Object.assign({}, q, { storage: blind })); g.api.favRender('amp');
      assert.equal(await g.api.favSave('amp'), false); assert.equal(q.log.sets, 1, 'no second write');
      const t = g.text(g.status('amp')[0]); assert.ok(/Not confirmed — /.test(t) && !/Not saved/.test(t) && /may or may not be stored/.test(t), t);
    });
    test('review 2 + 3: presets sharing an identity and entries without values are not listed; the recovery status says so; Delete changes nothing', async () => {
      const raw = JSON.stringify({ amp: [row('twin A', 5, { wire: '8' }), row('twin B', 5, { wire: '6' }), row('single', 6, { wire: '4' }), { name: 'no values', id: 7, vals: null }], vd: [row('vd five', 5)] });
      const p = profile(raw); const h = ui(page, p); h.api.favRender('amp'); h.api.favRender('vd');
      assert.deepEqual(h.rows('amp').map((r) => r.children[1].textContent), ['single'], 'only the row that can be addressed and read is offered');
      const s = h.text(h.status('amp')[0]); assert.equal(h.status('amp')[0].attrs.role, 'alert');
      assert.ok(/Saved presets need recovery/.test(s) && /2 presets that share an identity/.test(s) && /1 entry this version cannot read/.test(s), s);
      for (const b of ['Export raw data', 'Retry', 'Reset Favorites…']) assert.ok(h.button('amp', b), b);
      h.api.favLoad('amp', 5); assert.deepEqual(h.seen.applied, [], 'an ambiguous id loads nothing (was: silently the first of the two)');
      h.rows('amp')[0].click(); assert.deepEqual(h.seen.applied, [['amp', { wire: '4' }]]);
      assert.equal(await h.api.favDelete('amp', 5), false, 'was: one click deleted both rows'); assert.equal(await h.api.favDelete('amp', 6), false);
      assert.equal(p.raw(), raw); assert.equal(p.log.sets, 0);
      assert.equal(h.rows('vd').length, 1, 'the same id in another collection is an ordinary preset');
      h.button('amp', 'Export raw data').click(); assert.equal(await h.seen.blobs[0].text(), raw, 'every stored entry, including the unlisted ones, is in the export');
    });
    test('raw export is the exact stored value in a Blob, with no storage write; reset asks first, cancel changes nothing, confirm removes only Favorites', async () => {
      const p = profile(TRUNCATED); p.map.set('unrelated', 'keep'); const h = ui(page, p); h.api.favRender('cf'); p.refuse('QuotaExceededError', true);
      h.button('cf', 'Export raw data').click();
      assert.equal(h.seen.blobs.length, 1); assert.equal(await h.seen.blobs[0].text(), TRUNCATED); assert.equal(h.seen.blobs[0].size, Buffer.byteLength(TRUNCATED));
      assert.ok(/^empire-code-favorites-raw-\d{8}T\d{6}\.json$/.test(h.seen.anchors[0].download), h.seen.anchors[0].download); assert.equal(h.seen.anchors[0].clicked, 1);
      assert.equal(p.log.sets, 0); assert.equal(p.raw(), TRUNCATED);
      assert.equal(await h.api.favReset('cf'), false); assert.equal(h.seen.confirms.length, 1); assert.ok(/Only Favorites are removed/.test(h.seen.confirms[0]));
      assert.equal(p.raw(), TRUNCATED, 'cancel: unchanged'); assert.deepEqual(p.log.removes, []);
      const yes = ui(page, p, { confirm: true }); yes.api.favRender('cf'); assert.equal(await yes.api.favReset('cf'), true);
      assert.equal(p.raw(), null); assert.deepEqual(p.log.removes, [Fav.KEY]); assert.equal(p.map.get('unrelated'), 'keep');
      assert.equal(yes.status('cf')[0].attrs.role, 'status'); assert.ok(/Favorites were reset/.test(yes.text(yes.status('cf')[0])));
    });
    test('no cross-tab lock in the browser: Save is clearly unavailable, nothing is written, presets stay readable and exportable', async () => {
      const p = profile(LEGACY); const h = ui(page, p, { noLocks: true }); h.api.favRender('amp');
      assert.ok(/unavailable in this browser/.test(h.text(h.status('amp')[0]))); assert.equal(h.rows('amp').length, 1); assert.ok(h.button('amp', 'Export raw data'));
      assert.equal(await h.api.favSave('amp'), false); assert.equal(p.raw(), LEGACY); assert.equal(p.log.sets, 0);
    });
    test('the page no longer contains the unguarded read / write helpers', () => {
      assert.ok(!page.includes("JSON.parse(localStorage.getItem(FAV_KEY) || '{}')") && !page.includes('function favSaveAll('), 'silent {} fallback and blind setItem are gone');
      assert.ok(page.includes("window.addEventListener('storage', function (ev) { if (ev.key === null || ev.key === FAV_KEY) favRefresh(); });"), 'another tab’s change is reflected');
    });
  });
}
