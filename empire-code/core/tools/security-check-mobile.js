'use strict';
/**
 * EC-SAFE-1 — real-browser security check for mobile.html.
 *
 *   node tools/security-check-mobile.js [path/to/mobile.html]
 *
 * Runs the ACTUAL application file in headless Chromium with every external
 * request blocked before the page loads and Firebase mocked, then drives the
 * three audited sinks with attacker-controlled data and checks two things
 * independently: that no attacker code executed (a test-only window marker
 * stays unset) and that the untrusted content created no executable DOM
 * (no <script>, no on* attributes, no javascript: URLs inside the sinks).
 *
 * A positive control first proves the harness CAN observe execution — a
 * browser with scripting off would otherwise "pass" everything.
 *
 * The same script is run against the preserved pre-task copy (expected: the
 * three attack checks FAIL) and against the patched file (expected: PASS).
 * It is a Node tool under tools/, never reachable from the app itself.
 */
const path = require('path');
const fs = require('fs');

const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'mobile.html'));
if (!fs.existsSync(target)) { console.error('no such file: ' + target); process.exit(2); }

const MARK = '__ecSafeExecuted';     // harmless, test-only execution marker
// NOTE: no '|' anywhere in an execution payload — a Markdown table splits cells on it.
const BUMP = `window.${MARK}=(window.${MARK}?window.${MARK}+1:1)`;
const payloads = {
  imgOnerror: `<img src=x onerror="${BUMP}">`,
  svgOnload: `<svg onload="${BUMP}"></svg>`,
  script: `<script>${BUMP}</script>`,
  quotes: `Tom's "quoted" & <b>bold</b> ' \u00e9 &amp;lt;script&amp;gt;`,
  entityLike: `&lt;img src=x onerror=alert(1)&gt; &#60;script&#62;`,
};

async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const pageErrors = []; const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });
  // block ALL external network before anything loads; only file:// may pass
  let blocked = 0;
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file://')) return route.continue();
    blocked++; return route.abort();
  });
  // mock Firebase before app init: reads return what the test supplies, writes are recorded
  await page.addInitScript(() => {
    window.__ecMock = { getDocsCalls: 0, setDocCalls: 0, records: [] };
    window._fns = {
      query: () => ({}), collection: () => ({}), orderBy: () => ({}), limit: () => ({}), doc: () => ({}),
      getDocs: async () => { window.__ecMock.getDocsCalls++; const r = window.__ecMock.records; return { empty: r.length === 0, forEach: (f) => r.forEach((x) => f({ data: () => x })) }; },
      getDoc: async () => ({ exists: () => false, data: () => ({}) }),
      setDoc: async () => { window.__ecMock.setDocCalls++; },
    };
    window._db = {};   // truthy: the ORIGINAL loadTrending only proceeds when _db is set
    window.__ecInitFirebaseCalls = 0;
    // record whether the app tries to load the SDK (it is network-blocked anyway)
    const origImport = window.importShim;
  });
  await page.goto('file://' + target, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  const exec = () => page.evaluate((m) => window[m] || 0, MARK);
  const resetExec = () => page.evaluate((m) => { window[m] = 0; }, MARK);

  // ── 0. positive control: the harness can see execution ──────────────────
  await resetExec();
  await page.evaluate((b) => { const s = document.createElement('script'); s.textContent = b; document.body.appendChild(s); s.remove(); }, BUMP);
  check('control: harness observes script execution (JS enabled)', (await exec()) === 1);
  await resetExec();
  await page.evaluate((p) => { const d = document.createElement('div'); d.innerHTML = p; document.body.appendChild(d); }, payloads.imgOnerror);
  await page.waitForTimeout(150);
  check('control: harness observes an onerror handler firing from injected markup', (await exec()) >= 1);
  await page.evaluate(() => { document.body.lastElementChild.remove(); });
  await resetExec();

  const executable = (sel) => page.evaluate((s) => {
    const all = document.querySelectorAll(s); const root = all[all.length - 1]; if (!root) return { missing: true, bad: [], html: '', text: '' };
    const bad = [];
    // The app's own NEC auto-link is the ONE sanctioned inline handler: it is
    // generated from a [\d.\w()] regex capture that cannot carry quotes or
    // brackets. Anything else on* is attacker-created.
    const isNecLink = (el, a) => el.tagName === 'SPAN' && el.classList.contains('nec-link') && a.name === 'onclick'
      && /^necLink\('NEC [\d.\w()]+'\)$/.test(a.value) && el.attributes.length === 3;
    root.querySelectorAll('*').forEach((el) => {
      if (el.tagName === 'SCRIPT' || el.tagName === 'IFRAME' || el.tagName === 'OBJECT' || el.tagName === 'EMBED') bad.push(el.tagName);
      for (const a of el.attributes) {
        if (/^on/i.test(a.name) && !isNecLink(el, a)) bad.push(el.tagName + '@' + a.name);
        if (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) bad.push(el.tagName + '@' + a.name + '=javascript:');
      }
    });
    return { bad, html: root.innerHTML, text: root.textContent };
  }, sel);

  // ── 1. CHAT tables ───────────────────────────────────────────────────────
  const BT = String.fromCharCode(96);   // a literal backtick for the inline-code case
  const md = ['| Ref | Note |', '|---|---|',
    '| ' + payloads.imgOnerror + ' | ' + payloads.svgOnload + ' |',
    '| ' + payloads.script + ' | ' + payloads.quotes + ' |',
    '| ' + payloads.entityLike + ' | **bold** and *it* and ' + BT + 'code' + BT + ' NEC 314.28(A) |'].join('\n');
  await page.evaluate((text) => { addMessage('ai', text); }, md);
  await page.waitForTimeout(200);
  const tbl = await executable('#chatArea .msg-bubble');
  check('CHAT: no attacker code executed from table cells', (await exec()) === 0, 'exec=' + (await exec()));
  check('CHAT: table cells created no executable DOM (scripts / on* / javascript:)', !tbl.missing && tbl.bad.length === 0, JSON.stringify(tbl.bad));
  check('CHAT: table structure and inline Markdown preserved (th/td, strong, em, code)', /<table>[\s\S]*<th>/.test(tbl.html) && /<td>/.test(tbl.html) && /<strong/.test(tbl.html) && /<em/.test(tbl.html) && /<code/.test(tbl.html));
  check('CHAT: quotes, apostrophes, ampersands and angle brackets survive as literal text', tbl.text.includes('Tom\'s "quoted" & <b>bold</b>') && tbl.text.includes('&amp;lt;script&amp;gt;'));
  check('CHAT: entity-like input is not decoded into markup on render', tbl.text.includes('&lt;img src=x onerror=alert(1)&gt;'));
  // NEC reference inside a table cell keeps the existing click behaviour
  await page.evaluate(() => { window.__ecNec = null; window.necLink = (ref) => { window.__ecNec = ref; }; });
  const necClicked = await page.evaluate(() => { const el = (function(){const b=document.querySelectorAll('#chatArea .msg-bubble');return b[b.length-1].querySelector('table .nec-link');})(); if (!el) return 'missing'; el.click(); return window.__ecNec; });
  check('CHAT: NEC reference in a table is an auto-link and its click still calls necLink with its context', necClicked === 'NEC 314.28(A)', String(necClicked));
  // repeated rendering of already-escaped text must not decode it
  const before = await page.evaluate(() => document.querySelectorAll('#chatArea .msg-bubble').length);
  await page.evaluate((text) => { addMessage('ai', text); addMessage('ai', (function(){const b=document.querySelectorAll('#chatArea .msg-bubble');return b[b.length-1].textContent;})()); }, md);
  await page.waitForTimeout(150);
  const rerender = await executable('#chatArea .msg-bubble');
  check('CHAT: re-rendering rendered text creates no executable DOM (no double-decode)', rerender.bad.length === 0 && (await exec()) === 0);
  const fence = BT + BT + BT;
  const codeBlock = [fence, 'const x = "<b>";', fence].join('\n');
  check('CHAT: ordinary code block renders as a pre with escaped content', await page.evaluate((cb) => { addMessage('ai', cb); const bb=document.querySelectorAll('#chatArea .msg-bubble'); const h = bb[bb.length-1].innerHTML; return /<pre/.test(h) && h.includes('&lt;b&gt;') && !/<b>/.test(h); }, codeBlock));

  // ── 2. TRENDING (renderer tested with mocked remote records regardless of the gate) ─
  await resetExec();
  const renderRecords = (recs) => page.evaluate(async (recs) => {
    const c = document.getElementById('trendingBtns');
    if (typeof renderTrending === 'function') {            // patched build: the safe renderer, exercised directly
      window.__ecAsk = []; renderTrending(c, recs, (s) => window.__ecAsk.push(s)); return 'renderer';
    }
    // pre-task build: drive the original loadTrending through the mocked Firestore
    window.__ecMock.records = recs; window.__ecAsk = []; window.quickAsk = (s) => window.__ecAsk.push(s);
    await window.loadTrending(); return 'original';
  }, recs);
  // pass 1 — well-formed but hostile records: the pure injection question
  const hostile = [
    { label: payloads.imgOnerror, count: payloads.svgOnload, sample: payloads.script },
    { label: 'Panel <b>sizing</b> & "quotes"', count: 42, sample: 'How do I size a 200A panel?' },
  ];
  const trendingMode = await renderRecords(hostile);
  await page.waitForTimeout(200);
  const tr = await executable('#trendingBtns');
  check('TRENDING (' + trendingMode + '): no attacker code executed from remote label/count/sample', (await exec()) === 0, 'exec=' + (await exec()));
  check('TRENDING: remote fields created no executable DOM', !tr.missing && tr.bad.length === 0, JSON.stringify(tr.bad));
  // pass 2 — the same plus malformed records: the robustness question
  await resetExec();
  await renderRecords(hostile.concat([{ label: 'Bad count', count: 'NaN<img src=x onerror=1>', sample: 'x' }, null, { label: 7 }, { label: '   ' }, { count: 3 }]));
  await page.waitForTimeout(200);
  const trendInfo = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#trendingBtns .trend-btn')];
    return { n: btns.length, texts: btns.map((b) => b.textContent), counts: btns.map((b) => (b.querySelector('.trend-count') || {}).textContent) };
  });
  check('TRENDING: label markup rendered as literal text', trendInfo.texts.some((t) => t.includes('<img src=x onerror=')) && trendInfo.texts.some((t) => t.includes('Panel <b>sizing</b> & "quotes"')));
  check('TRENDING: malformed records skipped without taking the panel down (' + trendInfo.n + ' buttons)', trendInfo.n >= 2 && trendInfo.n <= 3);
  check('TRENDING: count rendered as a number or blank, never as markup', trendInfo.counts.every((c) => /^\d*$/.test(c || '')));
  const asked = await page.evaluate(() => { const b = [...document.querySelectorAll('#trendingBtns .trend-btn')].find((x) => x.textContent.includes('Panel')); if (!b) return ['<no Panel button rendered>']; b.click(); return window.__ecAsk; });
  check('TRENDING: clicking passes the correct sample as a value to the stubbed downstream action', JSON.stringify(asked) === JSON.stringify(['How do I size a 200A panel?']));

  // ── 3. FAVORITES / SAVED PRESETS ───────────────────────────────────────
  await resetExec();
  // an id crafted so that, if interpolated into an inline handler, it becomes VALID code that runs
  const evilId = '1002);' + BUMP + ';void(0';
  const seedFavs = (withNull) => page.evaluate((arg) => {
    window.__ecLoaded = [];
    const list = [
      { name: arg.p.imgOnerror + ' Kitchen', vals: { a: 1 }, id: 1001 },
      { name: "O'Brien \"run\" & <b>x</b>", vals: { a: 2 }, id: arg.evilId },
      { name: 'Good', vals: { a: 3 }, id: 1003 },
      { name: 12, vals: {}, id: 1004 },
    ];
    if (arg.withNull) list.push(null);
    localStorage.setItem('sparky_favorites', JSON.stringify({ cf: list }));
    window.__ecFavRenderError = null;
    try { favRender('cf'); } catch (e) { window.__ecFavRenderError = String(e && e.message); }
    return window.__ecFavRenderError;
  }, { p: payloads, evilId, withNull });
  // pass 1 — hostile but well-formed presets: the pure injection question
  await seedFavs(false);
  await page.waitForTimeout(150);
  // a click on the row with the crafted id: inert on a safe build, code on an unsafe one
  await page.evaluate(() => { window.favSetValues = () => {}; const r = [...document.querySelectorAll('#cf-fav-list .fav-item')].find((x) => x.textContent.includes("O'Brien")); if (r) r.click(); });
  const fav = await executable('#cf-fav-list');
  check('FAVORITES: no attacker code executed from preset name or crafted id', (await exec()) === 0, 'exec=' + (await exec()));
  check('FAVORITES: stored name/id/type created no executable DOM or inline handlers', !fav.missing && fav.bad.length === 0, JSON.stringify(fav.bad));
  check('FAVORITES: names rendered as literal text', fav.text.includes('<img src=x onerror=') && fav.text.includes('O\'Brien "run" & <b>x</b>'));
  // pass 2 — plus a null entry: the robustness question; the list is re-seeded so later behaviour checks run on it
  const favErr = await seedFavs(true);
  await page.waitForTimeout(150);
  check('FAVORITES: a malformed (null) stored entry does not crash the list render', favErr === null, favErr || '');
  // load and delete behaviour (downstream stubbed)
  const favOps = await page.evaluate(() => {
    window.favSetValues = (type, vals) => { window.__ecLoaded.push([type, vals]); };
    const rows = [...document.querySelectorAll('#cf-fav-list .fav-item')];
    const good = rows.find((r) => r.textContent.includes('Good'));
    if (good) good.click();                                        // load
    const before = JSON.parse(localStorage.getItem('sparky_favorites')).cf.length;
    const kitchen = rows.find((r) => r.textContent.includes('Kitchen'));
    const del = kitchen && kitchen.querySelector('.fav-delete');
    if (del) del.click();                                          // delete only
    const stored = JSON.parse(localStorage.getItem('sparky_favorites')).cf;
    // EC-03 / EC-05 (EC-AUDIT-FIX-1): the seeded list holds entries the app cannot read (a preset whose name is the number 12,
    // and null). Favorites is therefore in a recovery state: readable presets are listed and can be loaded, Delete is REFUSED
    // and no stored entry is removed until the user exports / resets. The earlier expectation ("delete removes exactly one",
    // every object row rendered) described the pre-fix behaviour that rewrote the store around unreadable entries.
    const after = stored.length, readable = stored.filter((f) => f && typeof f === 'object' && typeof f.name === 'string' && f.vals && typeof f.vals === 'object' && !Array.isArray(f.vals)).length;
    return { loaded: window.__ecLoaded, before, after, readable, rowsNow: document.querySelectorAll('#cf-fav-list .fav-item').length, status: document.querySelectorAll('#cf-fav-list .fav-status').length };
  });
  await page.waitForTimeout(150);   // the refusal is delivered asynchronously (lock); re-read storage after it has settled
  favOps.settled = await page.evaluate(() => ({ stored: JSON.parse(localStorage.getItem('sparky_favorites')).cf.length, rows: document.querySelectorAll('#cf-fav-list .fav-item').length, text: (document.getElementById('cf-fav-list') || {}).textContent || '' }));
  check('FAVORITES: load applies the preset values', JSON.stringify(favOps.loaded) === JSON.stringify([['cf', { a: 3 }]]), JSON.stringify(favOps.loaded));
  check('FAVORITES: only the readable presets are listed and the recovery status is shown', favOps.rowsNow === favOps.readable && favOps.status === 1, JSON.stringify(favOps));
  check('FAVORITES: Delete in a recovery state removes NOTHING, says so, and does NOT also load the preset', favOps.before - favOps.after === 0 && favOps.settled.stored === favOps.before && favOps.settled.rows === favOps.readable && favOps.loaded.length === 1 && /Not deleted/.test(favOps.settled.text), JSON.stringify(favOps));
  // malformed id: load must be inert, not executable
  const malformed = await page.evaluate(() => { window.__ecLoaded = []; const r = [...document.querySelectorAll('#cf-fav-list .fav-item')].find((x) => x.textContent.includes("O'Brien")); if (r) r.click(); return window.__ecLoaded; });
  check('FAVORITES: a malformed string id loads by value (or not at all) — never executes', (await exec()) === 0 && (malformed.length === 0 || JSON.stringify(malformed[0]) === JSON.stringify(['cf', { a: 2 }])));
  // rerender + Conduit/Wireway switching keeps live handlers
  const switching = await page.evaluate(() => {
    if (typeof fillCalcMode !== 'function') return 'no-fillCalcMode';
    fillCalcMode('wireway'); fillCalcMode('conduit');
    window.__ecLoaded = [];
    const r = [...document.querySelectorAll('#cf-fav-list .fav-item')].find((x) => x.textContent.includes('Good'));
    if (!r) return 'row-missing-after-switch';
    r.click(); return window.__ecLoaded.length === 1 ? 'live' : 'dead-handler';
  });
  check('FAVORITES: after Conduit/Wireway switching the preset list is present and its handlers are live', switching === 'live', switching);

  // containment: with the gate off, startup shows the calm fallback and never fetched the SDK
  const gate = await page.evaluate(() => ({ enabled: typeof TRENDING_REMOTE_ENABLED === 'undefined' ? 'absent' : TRENDING_REMOTE_ENABLED, fbReady: !!window._fbReady }));
  if (gate.enabled === false) {
    await page.reload(); await page.waitForTimeout(1200);
    const startup = await page.evaluate(() => ({ text: document.getElementById('trendingBtns').textContent.trim(), fbReady: !!window._fbReady, cls: (document.querySelector('#trendingBtns span') || {}).className }));
    check('CONTAINMENT: gated startup shows the calm fallback text and no SDK was initialised', startup.text === 'Trending is temporarily unavailable' && startup.cls === 'trending-loading' && !startup.fbReady, JSON.stringify(startup));
  }
  check('no page errors during the run', pageErrors.length === 0, pageErrors.join(' | '));
  check('all external network was blocked before load (' + blocked + ' requests aborted)', true);
  await browser.close();

  const fails = results.filter((r) => !r.ok);
  console.log('EC-SAFE-1 security check — ' + target);
  for (const r of results) console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : ('  [' + (r.detail || '') + ']')));
  console.log(fails.length === 0 ? 'ALL ' + results.length + ' CHECKS PASSED' : fails.length + ' of ' + results.length + ' CHECKS FAILED');
  process.exit(fails.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(3); });
