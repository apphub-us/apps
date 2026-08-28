'use strict';
/**
 * Service worker checks.
 *
 * Two layers, no browser automation:
 *   1. Static analysis of sw.js — cache version, asset lists, cleanup logic.
 *   2. Behavioural simulation — the timeout helper is extracted and executed
 *      against fake fetches to prove the offline / slow-network paths and to
 *      catch unhandled rejections.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SW = path.join(__dirname, '..', 'sw.js');
const APP = path.join(__dirname, '..', 'mobile.html');
const skipAll = fs.existsSync(SW) ? false : 'sw.js not found in the repository root';
const src = fs.existsSync(SW) ? fs.readFileSync(SW, 'utf8') : '';

describe('Service worker — static analysis', { skip: skipAll }, () => {
  test('cache version is v2', () => {
    const m = src.match(/const CACHE_NAME = '([^']+)'/);
    assert.ok(m, 'CACHE_NAME not found');
    assert.strictEqual(m[1], 'empire-code-v2');
  });

  test('the four critical local assets are precached', () => {
    const m = src.match(/const CRITICAL_ASSETS = \[([\s\S]*?)\]/);
    assert.ok(m, 'CRITICAL_ASSETS not found');
    for (const asset of ['/mobile.html', '/manifest.json', '/icon-192.png', '/icon-512.png']) {
      assert.ok(m[1].includes(asset), `${asset} missing from CRITICAL_ASSETS`);
    }
  });

  test('critical precache is same-origin only — no remote URL can fail the install', () => {
    const m = src.match(/const CRITICAL_ASSETS = \[([\s\S]*?)\]/);
    assert.ok(!/https?:\/\//.test(m[1]),
      'a remote URL in CRITICAL_ASSETS would make cache.addAll() fail the whole install');
  });

  test('fonts are optional and their failure is swallowed', () => {
    const m = src.match(/const OPTIONAL_ASSETS = \[([\s\S]*?)\]/);
    assert.ok(m, 'OPTIONAL_ASSETS not found');
    assert.ok(/fonts\.googleapis\.com/.test(m[1]), 'font URL not in OPTIONAL_ASSETS');
    // Optional assets must be added individually with a catch, never via addAll.
    assert.ok(/OPTIONAL_ASSETS\.map[\s\S]{0,200}cache\.add\([\s\S]{0,120}\.catch\(/.test(src),
      'optional assets must use per-item cache.add(...).catch(...)');
  });

  test('the stale Bebas Neue font URL is gone', () => {
    assert.ok(!/Bebas\+Neue/.test(src), 'sw.js still precaches the removed Bebas Neue font');
  });

  test('the precached font URL is exactly the one mobile.html requests', () => {
    if (!fs.existsSync(APP)) return; // covered elsewhere
    const html = fs.readFileSync(APP, 'utf8');
    const wanted = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/);
    assert.ok(wanted, 'no Google Fonts URL found in mobile.html');
    assert.ok(src.includes(wanted[0]),
      `sw.js precaches a different font URL than the app requests:\n  app: ${wanted[0]}`);
  });

  test('old caches are deleted on activate, and only non-current ones', () => {
    assert.ok(/addEventListener\('activate'/.test(src), 'no activate handler');
    assert.ok(/keys\.filter\([\s\S]{0,120}!==\s*CACHE_NAME/.test(src),
      'activate must delete only caches whose key !== CACHE_NAME');
    assert.ok(/caches\.delete\(/.test(src), 'no cache deletion');
  });

  test('cleanup happens in activate, never in install — the new cache is complete first', () => {
    const install = src.slice(src.indexOf("addEventListener('install'"),
      src.indexOf("addEventListener('activate'"));
    assert.ok(!/caches\.delete\(/.test(install),
      'deleting caches during install would leave a window with no usable cache');
  });

  test('skipWaiting runs only after the critical assets are cached', () => {
    const install = src.slice(src.indexOf("addEventListener('install'"),
      src.indexOf("addEventListener('activate'"));
    const addAllAt = install.indexOf('addAll(CRITICAL_ASSETS)');
    const skipAt = install.indexOf('skipWaiting()');
    assert.ok(addAllAt > -1 && skipAt > -1, 'expected both addAll and skipWaiting in install');
    assert.ok(addAllAt < skipAt, 'skipWaiting must come after the critical addAll');
  });

  test('clients.claim() is called on activate', () => {
    assert.ok(/clients\.claim\(\)/.test(src));
  });

  test('build artefacts are NOT precached — production runs from the built mobile.html', () => {
    const lists = (src.match(/const CRITICAL_ASSETS = \[([\s\S]*?)\]/) || [])[1] +
                  (src.match(/const OPTIONAL_ASSETS = \[([\s\S]*?)\]/) || [])[1];
    for (const dir of ['/src', '/test', '/tools', 'src/calc', 'build-calc']) {
      assert.ok(!lists.includes(dir), `${dir} must not be precached`);
    }
  });

  test('navigation uses a bounded network-first fetch', () => {
    assert.ok(/NAV_TIMEOUT_MS/.test(src), 'no navigation timeout defined');
    const m = src.match(/const NAV_TIMEOUT_MS = (\d+)/);
    assert.ok(m, 'NAV_TIMEOUT_MS not a literal');
    const ms = Number(m[1]);
    assert.ok(ms >= 2000 && ms <= 4000, `timeout ${ms}ms outside the intended 2000-4000ms band`);
    assert.ok(/fetchWithTimeout\(req, NAV_TIMEOUT_MS\)/.test(src),
      'the app-shell path does not use the bounded fetch');
  });

  test('live API calls are never served from cache', () => {
    for (const host of ['anthropic.com', 'firestore.googleapis.com', 'firebase']) {
      assert.ok(src.includes(host), `${host} not excluded from caching`);
    }
  });

  test('cache writes cannot reject into the fetch handler', () => {
    assert.ok(/function putInCache[\s\S]*?\.catch\(/.test(src),
      'cache.put must be guarded against quota/opaque failures');
  });
});

describe('Service worker — timeout behaviour', { skip: skipAll }, () => {
  /** Extract fetchWithTimeout and run it against controllable fakes. */
  function makeHelper(fetchImpl) {
    const body = src.slice(src.indexOf('function putInCache'),
      src.indexOf('function cachedOrShell'));
    const factory = new Function('fetch', 'caches', 'setTimeout', 'clearTimeout', 'CACHE_NAME',
      body + '; return { fetchWithTimeout: fetchWithTimeout, putInCache: putInCache };');
    const cacheStore = [];
    const caches = {
      open: () => Promise.resolve({ put: (rq, rs) => { cacheStore.push([rq, rs]); return Promise.resolve(); } }),
    };
    const api = factory(fetchImpl, caches, setTimeout, clearTimeout, 'empire-code-v2');
    api.cacheStore = cacheStore;
    return api;
  }

  const okResponse = () => ({ status: 200, clone: () => ({ status: 200, __clone: true }) });

  test('healthy network resolves with the network response', async () => {
    const h = makeHelper(() => Promise.resolve(okResponse()));
    const res = await h.fetchWithTimeout('/mobile.html', 3000);
    assert.strictEqual(res.status, 200);
  });

  test('healthy network also refreshes the cache', async () => {
    const h = makeHelper(() => Promise.resolve(okResponse()));
    await h.fetchWithTimeout('/mobile.html', 3000);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(h.cacheStore.length, 1, 'response was not written to cache');
  });

  test('offline rejects immediately so the caller can fall back to cache', async () => {
    const h = makeHelper(() => Promise.reject(new Error('offline')));
    await assert.rejects(() => h.fetchWithTimeout('/mobile.html', 3000), /offline/);
  });

  test('a slow network rejects at the deadline, not when the network finally answers', async () => {
    const h = makeHelper(() => new Promise((r) => setTimeout(() => r(okResponse()), 400)));
    const started = Date.now();
    await assert.rejects(() => h.fetchWithTimeout('/mobile.html', 50), /EC_SW_TIMEOUT/);
    const waited = Date.now() - started;
    assert.ok(waited < 300, `caller waited ${waited}ms, expected to bail near the 50ms deadline`);
  });

  test('a late response still warms the cache for next launch', async () => {
    const h = makeHelper(() => new Promise((r) => setTimeout(() => r(okResponse()), 60)));
    await assert.rejects(() => h.fetchWithTimeout('/mobile.html', 20));
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(h.cacheStore.length, 1, 'late response was discarded instead of cached');
  });

  test('a late FAILURE after timeout produces no unhandled rejection', async () => {
    const seen = [];
    const onUnhandled = (err) => seen.push(err);
    process.on('unhandledRejection', onUnhandled);

    const h = makeHelper(() => new Promise((_, rej) => setTimeout(() => rej(new Error('late')), 40)));
    await assert.rejects(() => h.fetchWithTimeout('/mobile.html', 15));
    await new Promise((r) => setTimeout(r, 150));

    process.off('unhandledRejection', onUnhandled);
    assert.deepStrictEqual(seen, [], `unhandled rejection(s): ${seen.map(String)}`);
  });

  test('the promise settles exactly once even when both paths fire', async () => {
    let settles = 0;
    const h = makeHelper(() => new Promise((r) => setTimeout(() => r(okResponse()), 30)));
    const p = h.fetchWithTimeout('/mobile.html', 10).then(() => { settles++; }, () => { settles++; });
    await p;
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(settles, 1);
  });
});
