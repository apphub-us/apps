#!/usr/bin/env node
'use strict';
/*
 * OPTIONAL real-browser acceptance of the Converter "Wh / Runtime" tool (CONVERTER-WH-1).
 * This is a CLI script, not a node:test file. It is never part of `node --test`.
 *
 * What it drives
 *   The generated Worker (candidate/server/worker.mjs + assets.generated.mjs) behind tests/local-node-runtime.cjs
 *   on 127.0.0.1, in a FRESH non-persistent browser context. Fixture identity owner@example.invalid, no AI key, no budget,
 *   no external API, no paid inference, no user profile. Every expected number is typed into the real form and read back
 *   from the rendered panel; the calculation module is never called by this script.
 *
 * Offline stage
 *   After the service worker is active, controls the page and holds a complete cache of the current build, the local
 *   fixture server is STOPPED (its own stop(), awaited) and only then is the browser switched offline. The server-request
 *   mark is taken after both. A request still pending from the online phase therefore cannot cross into the offline
 *   window, and no origin exists that could quietly satisfy the reload if an engine's offline emulation misses a context.
 *   The origin stays down and the browser stays offline until the context is closed; the report notes this under
 *   originStoppedForOfflinePhase.
 *
 * Before running
 *   Regenerate the candidate assets from the current sources. The script refuses to run (exit 2) when the served
 *   /workspace/mobile.html is not byte-identical to candidate/browser/workspace/mobile.html.
 *
 * Usage
 *   node tests/converter-runtime-browser.cjs [--engine chromium|webkit] [--out <dir outside the repository>]
 *                                            [--offorigin block|observe] [--headed]
 *
 * Environment
 *   PW_RUNTIME                 directory whose node_modules holds playwright or playwright-core (nothing is installed here)
 *   PLAYWRIGHT_BROWSERS_PATH   browser builds; when unset and PW_RUNTIME has a `browsers` directory next to or inside it, that is used
 *   CHROME_EXECUTABLE          Chromium/Chrome binary for --engine chromium
 *   EC_BROWSER_ENGINE          same as --engine        EC_EVIDENCE_DIR   same as --out
 *   EC_ACCEPT_TIMEOUT_MS       whole-run watchdog (default 240000)
 *
 * Output (evidence directory, never inside the repository)
 *   converter-runtime-<engine>.json and PNG screenshots. Synthetic data only.
 *
 * Exit code   0 = every stage passed · 1 = at least one assertion failed · 2 = blocked (runtime, browser or assets unavailable)
 *
 * Not covered: a same-origin upgrade from the previously released service worker (needs a prior baseline build served on
 * the same origin, which this adapter cannot provide), speech input, Safari on a physical iPhone.
 */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..'); // empire-code/
const REPO = path.resolve(ROOT, '..');
const SOURCE_FRAME = path.join(ROOT, 'candidate/browser/workspace/mobile.html');
const SCRIPT = 'tests/converter-runtime-browser.cjs';
const VIEWPORTS = { narrow: { width: 320, height: 568 }, phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };

class Blocked extends Error {}
class Abort extends Error {}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const firstLine = e => String(e && e.message || e).split('\n')[0];

function options(argv) {
  const o = { engine: process.env.EC_BROWSER_ENGINE || 'chromium', out: process.env.EC_EVIDENCE_DIR || '', offorigin: 'block', headed: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === '--engine') o.engine = value();
    else if (flag === '--out') o.out = value();
    else if (flag === '--offorigin') o.offorigin = value();
    else if (flag === '--headed') o.headed = true;
    else if (flag === '--help' || flag === '-h') o.help = true;
    else throw new Blocked('Unknown argument: ' + argv[i]);
  }
  if (!['chromium', 'webkit'].includes(o.engine)) throw new Blocked('--engine must be chromium or webkit, got: ' + o.engine);
  if (!['block', 'observe'].includes(o.offorigin)) throw new Blocked('--offorigin must be block or observe, got: ' + o.offorigin);
  return o;
}
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
function evidenceDir(requested) {
  const dir = requested ? path.resolve(requested) : fs.mkdtempSync(path.join(os.tmpdir(), 'ec-converter-runtime-'));
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.relative(real(REPO), real(dir));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Blocked('The evidence directory must be outside the repository.');
  return dir;
}
// Resolves an already installed Playwright. Nothing is downloaded or installed.
function loadPlaywright() {
  const sources = [];
  if (process.env.PW_RUNTIME) {
    const runtime = path.resolve(process.env.PW_RUNTIME);
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
      const browsers = [path.join(path.dirname(runtime), 'browsers'), path.join(runtime, 'browsers')].find(p => fs.existsSync(p));
      if (browsers) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
    }
    sources.push(createRequire(path.join(runtime, 'package.json')));
  }
  sources.push(require);
  for (const from of sources) for (const name of ['playwright', 'playwright-core']) {
    try { return from(name); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw new Blocked(name + ' could not load: ' + firstLine(e)); }
  }
  throw new Blocked('Playwright is not resolvable. Set PW_RUNTIME to a directory that already contains node_modules/playwright. Nothing was installed.');
}
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); }).on('error', reject);
  });
}

// --- Reading rendered results -----------------------------------------------------------------------------------------
// The first rendered line of the result box that contains a digit is the runtime headline ("About 20 h 24 min").
function headline(text) {
  return String(text || '').split(/\n+/).map(l => l.replace(/\s+/g, ' ').trim()).find(l => /\d/.test(l)) || '';
}
// From 48 h the module renders days and hours: "About 3 d 13 h" in the English frame (describeDuration(hours, 'en')).
// The day token is exactly the English "d" or the module's Polish "dni", each followed by whitespace and the hours;
// without it "3 d 13 h" would be read as 13 h. No other word is accepted as a day unit.
function minutesOf(line) {
  if (!line) return null;
  if (/less than 1 min/i.test(line)) return 0.5;
  const m = /(?:(\d+)\s*(?:dni|d)\s+)?(\d+)\s*h(?:\s+(\d+)\s*min)?/.exec(line);
  if (m) return Number(m[1] || 0) * 1440 + Number(m[2]) * 60 + Number(m[3] || 0);
  const only = /(\d+)\s*min/.exec(line);
  return only ? Number(only[1]) : null;
}
const shownMinutes = s => (s && s.resultShown ? minutesOf(headline(s.resultText)) : null);
const hm = minutes => Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
const clean = s => !/NaN|Infinity|undefined/.test(s.panelText || '');
const compact = s => (!s || s.evaluateError ? s : { result: s.resultShown ? headline(s.resultText) : null, status: (s.statusText || '').slice(0, 200), fields: s.fields, label: s.label });

async function main() {
  const opt = options(process.argv.slice(2));
  if (opt.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n'use strict';\n\/\*\n?/, '')); return 0; }

  const report = {
    script: SCRIPT, feature: 'CONVERTER-WH-1 Wh / Runtime', engine: opt.engine, result: 'FAIL', startedAt: new Date().toISOString(), finishedAt: null,
    node: process.version, platform: process.platform, browserVersion: null, build: null, sourceFrameSha256: null, initialViewport: VIEWPORTS.phone,
    offOriginPolicy: opt.offorigin, stages: [], pageErrors: [], consoleErrors: [], failedRequests: [], offOriginRequests: [], dialogs: [], screenshots: [],
    notCovered: ['same-origin upgrade from the previously released service worker', 'speech input', 'Safari on a physical iPhone'],
    blocked: null, fatal: null,
  };
  let out = null, server = null, browser = null, context = null, page = null, frame = null, watchdog = null, phase = 'setup', current = null;
  const serverLog = [];
  // The fixture server is stopped exactly once. The offline stage stops it to take the origin away; the final cleanup
  // then awaits the same promise instead of closing an already closed server a second time.
  let serverStopped = null;
  const stopServer = () => { if (!serverStopped) serverStopped = server ? server.stop() : Promise.resolve(); return serverStopped; };

  const check = (name, ok, actual) => {
    const entry = { name, ok: !!ok }; if (actual !== undefined) entry.actual = actual;
    current.checks.push(entry);
    if (!ok) throw new assert.AssertionError({ message: name + (actual !== undefined ? ' — actual: ' + JSON.stringify(actual).slice(0, 900) : '') });
  };
  const note = (name, value) => { current.notes[name] = value; };
  async function shot(name, fullPage = true) {
    if (!page || !out) return null;
    const file = opt.engine + '-' + name.replace(/[^a-zA-Z0-9-]+/g, '-') + '.png';
    try { await page.screenshot({ path: path.join(out, file), fullPage }); report.screenshots.push(file); return file; } catch { return null; }
  }
  async function stage(name, fn, o = {}) {
    const s = { name, status: 'running', ms: 0, checks: [], notes: {} }, started = Date.now();
    report.stages.push(s); current = s; phase = name;
    try { await fn(); s.status = 'passed'; }
    catch (e) { s.status = 'failed'; s.error = String(e && e.message || e).slice(0, 2000); await shot('FAIL-' + name); }
    s.ms = Date.now() - started;
    console.log((s.status === 'passed' ? 'PASS  ' : 'FAIL  ') + name + '  (' + s.ms + ' ms)' + (s.error ? '\n      ' + s.error.split('\n')[0] : ''));
    if (s.status !== 'passed' && o.critical) throw new Abort(name);
    return s.status === 'passed';
  }
  const skip = (name, reason) => { report.stages.push({ name, status: 'skipped', ms: 0, checks: [], notes: { reason } }); console.log('SKIP  ' + name + '  — ' + reason); };
  // Polls with plain evaluate calls. page.waitForFunction is avoided on purpose: the shell CSP has no 'unsafe-eval'.
  async function settle(read, ok, timeout = 5000) {
    const end = Date.now() + timeout; let last = null;
    for (;;) {
      let pass = false;
      try { last = await read(); pass = !!ok(last); } catch (e) { last = { evaluateError: firstLine(e) }; }
      if (pass) return { ok: true, last };
      if (Date.now() >= end) return { ok: false, last };
      await sleep(60);
    }
  }

  // --- Shell helpers --------------------------------------------------------------------------------------------------
  const TAG = crypto.randomBytes(3).toString('hex');
  const TITLE = 'TEST converter-runtime ' + TAG, DRAFT = 'TEST draft ' + TAG + ': 3 puszki 4x4, nie wysylac';
  const readTalk = () => page.evaluate(({ title, draft }) => {
    const g = id => document.getElementById(id), select = g('job-target');
    let bank = null; try { bank = localStorage.getItem(CBank.KEY); } catch (_) {}
    return {
      ready: typeof hostReady !== 'undefined' && hostReady === true && typeof bankBooting !== 'undefined' && bankBooting === false,
      busy: typeof handoffBusy !== 'undefined' ? handoffBusy : null,
      broken: typeof storageBroken !== 'undefined' ? storageBroken : null,
      jobs: select ? select.options.length - 1 : null,
      jobTitle: select && select.selectedOptions[0] ? select.selectedOptions[0].textContent : null,
      jobsNamed: select ? Array.from(select.options).filter(o => o.textContent === title).length : 0,
      input: g('input') ? g('input').value : null,
      bankHasDraft: typeof bank === 'string' && bank.includes(draft),
      talkShown: !!g('conversation-panel') && !g('conversation-panel').hidden,
      jobStatus: g('job-status') ? g('job-status').textContent : '',
      online: navigator.onLine,
    };
  }, { title: TITLE, draft: DRAFT });
  async function waitReady(label) {
    const r = await settle(readTalk, s => s.ready, 25000);
    check(label + ': shell ready (hostReady && !bankBooting)', r.ok, r.last);
    check(label + ': browser storage is healthy', r.last.broken === false, r.last.broken);
    const el = await page.waitForSelector('#core-frame', { state: 'attached' });
    frame = await el.contentFrame();
    const f = await settle(() => frame.evaluate(() => typeof openTool === 'function' && !!(window.ecHostBridge && window.ecHostBridge.ready)), v => v === true, 15000);
    check(label + ': workspace frame ready (openTool + host bridge)', f.ok, f.last);
  }
  async function showTalk() {
    await page.locator('#nav-talk').click();
    const r = await settle(readTalk, s => s.talkShown === true && s.busy === false);
    check('conversation view shown', r.ok, r.last);
  }
  async function expectFixtures(label) {
    const r = await settle(readTalk, s => s.jobTitle === TITLE && s.jobsNamed === 1 && s.input === DRAFT && s.bankHasDraft, 8000);
    check(label + ': synthetic job is still the selected job and the unsent draft is still in the field and in storage', r.ok, r.last);
    const stored = await frame.evaluate(async title => { const l = await window.ecHostBridge.list(); return l && l.ok ? l.jobs.filter(j => j.revision.title === title).length : -1; }, TITLE);
    check(label + ': exactly one stored job carries the synthetic title', stored === 1, stored);
  }

  // --- Converter helpers ----------------------------------------------------------------------------------------------
  const readBattery = () => frame.evaluate(() => {
    const g = id => document.getElementById(id);
    const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const value = id => { const e = g(id); return e ? e.value : null; };
    const panel = g('cvt-battery'), result = g('bt-result'), status = g('bt-status'), tab = g('cvTabBattery'), label = g('bt-consumption-label');
    return {
      present: !!(panel && result && status && tab), panelShown: shown(panel), powerShown: shown(g('cvt-power')),
      tabPressed: tab ? tab.getAttribute('aria-pressed') : null,
      resultShown: shown(result), resultText: shown(result) ? result.innerText : '',
      statusShown: shown(status), statusText: shown(status) ? status.innerText.trim() : '',
      panelText: shown(panel) ? panel.innerText : '', label: label ? label.textContent.trim() : null,
      fields: { capacity: value('bt-capacity'), mode: value('bt-mode'), consumption: value('bt-consumption'), charge: value('bt-charge'), usable: value('bt-usable') },
    };
  });
  async function showBattery() {
    await frame.locator('#cvTabBattery').click();
    const r = await settle(readBattery, s => s.present && s.panelShown && s.tabPressed === 'true');
    check('Wh / Runtime panel shown through #cvTabBattery', r.ok, compact(r.last));
    return r.last;
  }
  async function openConverter(label) {
    await page.locator('#nav-tools').click();
    const nav = await settle(() => page.evaluate(() => ({ hidden: document.getElementById('core-panel').hidden, current: document.getElementById('nav-tools').getAttribute('aria-current'), status: document.getElementById('job-status').textContent })), s => s.hidden === false && s.current === 'page');
    check(label + ': #nav-tools shows the workspace frame', nav.ok, nav.last);
    const opened = await frame.evaluate(() => openTool('converter'));
    check(label + ": openTool('converter') accepted", opened === true, opened);
    return showBattery();
  }
  // Mode first: a mode change may clear the consumption field, so the fields are typed after it.
  async function setForm(v) {
    await frame.locator('#bt-mode').selectOption(v.mode);
    await frame.locator('#bt-capacity').fill(v.capacity);
    await frame.locator('#bt-charge').fill(v.charge === undefined ? '100' : v.charge);
    await frame.locator('#bt-usable').fill(v.usable === undefined ? '85' : v.usable);
    await frame.locator('#bt-consumption').fill(v.consumption);
  }
  async function expectRuntime(label, minutes) {
    const r = await settle(readBattery, s => s.panelShown && shownMinutes(s) === minutes);
    check(label + ' → ' + (minutes === 0 ? '0 h' : hm(minutes)), r.ok, compact(r.last));
    check(label + ': no NaN / Infinity / undefined on the panel', clean(r.last));
    return r.last;
  }
  async function expectNoResult(label) {
    const r = await settle(readBattery, s => s.present && s.panelShown && !s.resultShown);
    check(label + ': no result is shown', r.ok, compact(r.last));
    check(label + ': a prompt or validation message is shown instead', r.last.statusShown && r.last.statusText.length > 0, r.last.statusText);
    check(label + ': no NaN / Infinity / undefined on the panel', clean(r.last), r.last.statusText);
    return r.last;
  }
  // After a unit change the old number must never be re-read in the new unit. Accepted: the result is gone until the
  // consumption is entered again, OR the same runtime is kept with an explicitly converted value in the field.
  async function switchMode(label, mode, unit, before, equivalent) {
    await frame.locator('#bt-mode').selectOption(mode);
    // An unrelated edit must not bring back a result computed from the stale number.
    await frame.locator('#bt-charge').fill('99');
    await frame.locator('#bt-charge').fill('100');
    await sleep(150);
    const s = await readBattery();
    note(label, compact(s));
    check(label + ': unit label follows the selected mode', s.fields.mode === mode && String(s.label).includes(unit) && (mode !== 'w' || !String(s.label).includes('kWh')), { mode: s.fields.mode, label: s.label });
    if (s.resultShown) {
      const typed = Number(String(s.fields.consumption).replace(',', '.'));
      check(label + ': a kept result is the same runtime with an explicitly converted consumption', shownMinutes(s) === before && Math.abs(typed - equivalent) <= equivalent * 0.01, compact(s));
    } else check(label + ': result cleared until the consumption is entered again', true, { consumption: s.fields.consumption });
    check(label + ': no NaN / Infinity / undefined on the panel', clean(s));
  }
  const settleLayout = async () => { await frame.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await sleep(150); };
  async function measure(label) {
    await settleLayout();
    const top = await page.evaluate(() => {
      const de = document.documentElement, f = document.getElementById('core-frame').getBoundingClientRect();
      return { innerWidth: window.innerWidth, scrollWidth: Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0), frameLeft: Math.round(f.left), frameRight: Math.round(f.right), frameWidth: Math.round(f.width) };
    });
    const inner = await frame.evaluate(() => {
      const vw = window.innerWidth, de = document.documentElement, sub = document.getElementById('sub-converter'), panel = document.getElementById('cvt-battery'), outside = [];
      for (const el of sub.querySelectorAll('*')) {
        if (!el.getClientRects().length) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) outside.push({ el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), left: Math.round(r.left), right: Math.round(r.right) });
      }
      return { innerWidth: vw, docScrollWidth: de.scrollWidth, subScrollWidth: sub.scrollWidth, subClientWidth: sub.clientWidth, panelScrollWidth: panel.scrollWidth, panelClientWidth: panel.clientWidth, outsideCount: outside.length, outside: outside.slice(0, 8) };
    });
    note(label, { page: top, frame: inner });
    check(label + ': page has no horizontal overflow', top.scrollWidth <= top.innerWidth + 1, top);
    check(label + ': workspace frame fits the page width', top.frameWidth > 0 && top.frameLeft >= -1 && top.frameRight <= top.innerWidth + 1, top);
    check(label + ': frame document has no horizontal overflow', inner.docScrollWidth <= inner.innerWidth + 1, inner);
    check(label + ': converter and Wh / Runtime panel have no horizontal overflow', inner.subScrollWidth <= inner.subClientWidth + 1 && inner.panelScrollWidth <= inner.panelClientWidth + 1 && inner.outsideCount === 0, inner);
  }
  const exampleButton = () => frame.locator('#cvt-battery button', { hasText: 'Example' });
  const resetButton = () => frame.locator('#cvt-battery button', { hasText: 'Reset' });
  const REFERENCE = { capacity: '1000', mode: 'w', consumption: '100', charge: '100', usable: '85' };

  try {
    // --- Preconditions (blocked, not failed, when the environment is not ready) ---------------------------------------
    out = evidenceDir(opt.out);
    if (!fs.existsSync(SOURCE_FRAME)) throw new Blocked('candidate/browser/workspace/mobile.html is missing.');
    const source = fs.readFileSync(SOURCE_FRAME);
    report.sourceFrameSha256 = sha256(source);
    const html = source.toString('utf8');
    const missing = ['id="cvTabBattery"', 'id="cvt-battery"', 'id="bt-capacity"', 'id="bt-mode"', 'id="bt-consumption"', 'id="bt-charge"', 'id="bt-usable"', 'id="bt-result"', 'id="bt-status"'].filter(x => !html.includes(x));
    if (missing.length) throw new Blocked('The Wh / Runtime UI is not complete in the source yet; missing: ' + missing.join(', ') + '. Nothing was guessed and no browser was started.');
    if (!fs.existsSync(path.join(ROOT, 'candidate/server/assets.generated.mjs'))) throw new Blocked('candidate/server/assets.generated.mjs is missing. Generate the candidate assets first.');
    const playwright = loadPlaywright();
    server = await require('./local-node-runtime.cjs').start(ROOT);
    const origin = server.origin;
    const served = await get(origin + '/workspace/mobile.html');
    if (served.status !== 200) throw new Blocked('The local Worker adapter answered ' + served.status + ' for /workspace/mobile.html. Generate the candidate assets first.');
    if (sha256(served.body) !== report.sourceFrameSha256) throw new Blocked('Generated assets are stale: the served /workspace/mobile.html differs from candidate/browser/workspace/mobile.html. Regenerate the candidate assets, then run again.');
    report.build = served.headers['x-empire-build'] || null;
    // Observer only: every request that reaches the local Worker is logged, none is answered here.
    server.setMock(async request => { serverLog.push({ at: Date.now(), method: request.method, path: new URL(request.url).pathname }); return null; });

    const launch = { headless: !opt.headed };
    if (opt.engine === 'chromium' && process.env.CHROME_EXECUTABLE) launch.executablePath = process.env.CHROME_EXECUTABLE;
    try { browser = await playwright[opt.engine].launch(launch); }
    catch (e) { throw new Blocked(opt.engine + ' could not start: ' + firstLine(e) + ' Nothing was downloaded or installed.'); }
    report.browserVersion = browser.version();
    watchdog = setTimeout(() => { report.fatal = 'Watchdog: the run exceeded its time limit and the browser was closed.'; browser.close().catch(() => {}); }, Number(process.env.EC_ACCEPT_TIMEOUT_MS) || 240000);

    context = await browser.newContext({ viewport: VIEWPORTS.phone }); // fresh, non-persistent, no stored state
    context.setDefaultTimeout(10000); context.setDefaultNavigationTimeout(30000);
    const foreign = url => /^https?:$/.test(url.protocol) && url.origin !== origin;
    const seenForeign = u => { if (!report.offOriginRequests.includes(u)) report.offOriginRequests.push(u); };
    context.on('request', r => { try { if (foreign(new URL(r.url()))) seenForeign(r.url()); } catch {} });
    if (opt.offorigin === 'block') await context.route(foreign, route => { seenForeign(route.request().url()); return route.abort('blockedbyclient'); });
    page = await context.newPage();
    page.on('pageerror', e => report.pageErrors.push({ phase, message: String(e && e.message || e).slice(0, 500) }));
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 60) report.consoleErrors.push({ phase, text: m.text().slice(0, 300) }); });
    page.on('requestfailed', r => { if (report.failedRequests.length < 60) report.failedRequests.push({ phase, url: r.url().replace(origin, ''), error: (r.failure() || {}).errorText || '' }); });
    page.on('dialog', d => { report.dialogs.push({ phase, type: d.type(), message: d.message().slice(0, 200) }); d.accept().catch(() => {}); });

    // --- Stages -------------------------------------------------------------------------------------------------------
    await stage('boot', async () => {
      await page.goto(origin + '/', { waitUntil: 'load' });
      await waitReady('first load');
      check('#nav-tools is visible', await page.locator('#nav-tools').isVisible());
      const s = await readTalk();
      check('fresh context starts without any job or unsent text', s.jobs === 0 && s.input === '', { jobs: s.jobs, input: s.input });
    }, { critical: true });

    const fixtures = await stage('synthetic-job-and-draft', async () => {
      await page.locator('#job-new summary').click();
      await page.locator('#job-new-title').fill(TITLE);
      await page.locator('#job-new-form button[type="submit"]').click();
      const made = await settle(readTalk, s => s.jobTitle === TITLE && s.jobsNamed === 1 && s.busy === false, 10000);
      check('synthetic job created through the real "Nowa robota" form and selected', made.ok, made.last);
      await page.locator('#input').fill(DRAFT);
      const saved = await settle(readTalk, s => s.input === DRAFT && s.bankHasDraft, 8000);
      check('unsent conversation draft typed into the composer and saved in browser storage', saved.ok, saved.last);
      await expectFixtures('after creation');
    });

    await stage('open-converter-wh-runtime', async () => {
      const s = await openConverter('first open');
      check('the Power panel is hidden while Wh / Runtime is shown', s.powerShown === false);
      check('untouched form: capacity and consumption blank, W mode, 100% charge, 85% usable', JSON.stringify(s.fields) === JSON.stringify({ capacity: '', mode: 'w', consumption: '', charge: '100', usable: '85' }), s.fields);
      await expectNoResult('untouched form');
    }, { critical: true });

    await stage('runtime-from-watts', async () => {
      await showBattery(); await setForm(REFERENCE);
      const s = await expectRuntime('1000 Wh · 100 W · 100% · 85% usable', 510);
      check('available energy is shown as 850 Wh', s.resultText.includes('850 Wh'), headline(s.resultText));
    });

    await stage('runtime-from-energy-per-day-and-year', async () => {
      await showBattery();
      await setForm({ capacity: '1000', mode: 'kwh_day', consumption: '1' });
      await expectRuntime('1000 Wh · 1 kWh/day', 1224);
      await setForm({ capacity: '1000', mode: 'kwh_year', consumption: '365' });
      const year = await expectRuntime('1000 Wh · 365 kWh/year (same as 1 kWh/day)', 1224);
      check('average draw is shown as 41.67 W', year.resultText.includes('41.67 W'), year.resultText.replace(/\s+/g, ' ').slice(0, 300));
      await frame.locator('#bt-charge').fill('50');
      await expectRuntime('50% charge', 612);
      await frame.locator('#bt-charge').fill('0');
      await expectRuntime('0% charge', 0);
      await frame.locator('#bt-charge').fill('100');
      await expectRuntime('back to 100% charge', 1224);
    });

    // From 48 h the English frame shows days and hours ("About 3 d 13 h"). The expected values are worked out by hand
    // from the typed fields, not read from the module:
    //   1000 Wh × 100% × 85% = 850 Wh; 850 Wh ÷ 10 W = 85 h = 3 × 24 h + 13 h = 5100 min
    //   960 Wh × 100% × 100% = 960 Wh; 960 Wh ÷ 20 W = 48 h = 2 × 24 h + 0 h  = 2880 min (first value shown in days)
    //   950 Wh × 100% × 100% = 950 Wh; 950 Wh ÷ 20 W = 47.5 h = 47 h 30 min    = 2850 min (last range shown in h + min)
    //   0.24 kWh/day × 1000 ÷ 24 h = 10 W, so 1000 Wh at 85% is the same 85 h
    await stage('runtime-48-hours-and-longer-in-days', async () => {
      await showBattery();
      await setForm({ capacity: '1000', mode: 'w', consumption: '10' });
      const long = await expectRuntime('1000 Wh · 10 W · 100% · 85% usable (85 h)', 5100);
      check('85 h is shown in days and hours as "About 3 d 13 h"', headline(long.resultText) === 'About 3 d 13 h', headline(long.resultText));
      check('the day part is read, not dropped: 3 d 13 h is 5100 min, not 13 h', minutesOf(headline(long.resultText)) === 3 * 1440 + 13 * 60 && minutesOf(headline(long.resultText)) !== 13 * 60, minutesOf(headline(long.resultText)));
      check('available energy is shown as 850 Wh', long.resultText.includes('850 Wh'), long.resultText.replace(/\s+/g, ' ').slice(0, 300));
      await setForm({ capacity: '960', mode: 'w', consumption: '20', usable: '100' });
      const two = await expectRuntime('960 Wh · 20 W · 100% · 100% usable (exactly 48 h)', 2880);
      check('exactly 48 h is shown as "About 2 d 0 h"', headline(two.resultText) === 'About 2 d 0 h', headline(two.resultText));
      await setForm({ capacity: '950', mode: 'w', consumption: '20', usable: '100' });
      const below = await expectRuntime('950 Wh · 20 W · 100% · 100% usable (47 h 30 min)', 2850);
      check('just below 48 h stays in hours and minutes as "About 47 h 30 min"', headline(below.resultText) === 'About 47 h 30 min', headline(below.resultText));
      await setForm({ capacity: '1000', mode: 'kwh_day', consumption: '0,24' });
      const day = await expectRuntime('1000 Wh · 0,24 kWh/day (10 W average, 85 h)', 5100);
      check('the same 85 h from kWh/day is shown as "About 3 d 13 h"', headline(day.resultText) === 'About 3 d 13 h', headline(day.resultText));
    });

    await stage('decimal-comma-and-dot', async () => {
      await showBattery();
      await setForm({ capacity: '1000', mode: 'kwh_day', consumption: '1,2' });
      await expectRuntime('1,2 kWh/day (decimal comma)', 1020);
      await frame.locator('#bt-consumption').fill('');
      await expectNoResult('consumption erased between the two spellings');
      await frame.locator('#bt-consumption').fill('1.2');
      await expectRuntime('1.2 kWh/day (decimal dot)', 1020);
    });

    await stage('mode-switch-never-reinterprets', async () => {
      await showBattery(); await setForm(REFERENCE);
      await expectRuntime('reference in W', 510);
      await switchMode('W → kWh/day', 'kwh_day', 'kWh/day', 510, 2.4);
      await frame.locator('#bt-consumption').fill('1');
      await expectRuntime('1 kWh/day entered after the switch', 1224);
      await switchMode('kWh/day → kWh/year', 'kwh_year', 'kWh/year', 1224, 365);
      await frame.locator('#bt-consumption').fill('365');
      await expectRuntime('365 kWh/year entered after the switch', 1224);
      await switchMode('kWh/year → W', 'w', 'W', 1224, 1000 / 24);
      await frame.locator('#bt-consumption').fill('100');
      await expectRuntime('100 W entered after the switch', 510);
    });

    await stage('invalid-input-hides-stale-result', async () => {
      await showBattery();
      // One wrong field at a time, starting each time from a valid form that shows 8 h 30 min.
      const cases = [
        ['capacity', '', 'blank capacity'], ['capacity', 'abc', 'non-numeric capacity'], ['capacity', '0', 'zero capacity'], ['capacity', '-1000', 'negative capacity'], ['capacity', 'Infinity', 'non-finite capacity'],
        ['consumption', '', 'blank consumption'], ['consumption', '0', 'zero consumption'], ['consumption', '-100', 'negative consumption'], ['consumption', 'NaN', 'NaN consumption'], ['consumption', '1e999', 'overflowing consumption'],
        ['charge', '', 'blank charge'], ['charge', '101', 'charge above 100%'], ['charge', '-1', 'negative charge'],
        ['usable', '', 'blank usable energy'], ['usable', '0', 'zero usable energy'], ['usable', '101', 'usable energy above 100%'],
      ];
      await setForm(REFERENCE);
      for (const [field, bad, label] of cases) {
        await expectRuntime('valid form before ' + label, 510);
        await frame.locator('#bt-' + field).fill(bad);
        await expectNoResult(label);
        await frame.locator('#bt-' + field).fill(REFERENCE[field]);
      }
      await expectRuntime('result returns once every field is valid again', 510);
    });

    await stage('example-and-reset', async () => {
      await showBattery();
      await setForm({ capacity: '500', mode: 'w', consumption: '50', charge: '40', usable: '90' });
      await expectRuntime('500 Wh · 50 W · 40% · 90% usable', 216);
      await exampleButton().click();
      const ex = await expectRuntime('fridge example', 1224);
      check('example fills 1000 Wh · 365 kWh/year · 100% · 85%', JSON.stringify(ex.fields) === JSON.stringify({ capacity: '1000', mode: 'kwh_year', consumption: '365', charge: '100', usable: '85' }), ex.fields);
      check('example shows 850 Wh available and 41.67 W average', ex.resultText.includes('850 Wh') && ex.resultText.includes('41.67 W'), ex.resultText.replace(/\s+/g, ' ').slice(0, 300));
      check('example result is marked as an illustrative example', /example/i.test(ex.resultText), ex.resultText.replace(/\s+/g, ' ').slice(0, 300));
      check('example switches the unit label to kWh/year', String(ex.label).includes('kWh/year'), ex.label);
      await frame.locator('#bt-charge').fill('50');
      const edited = await expectRuntime('example edited to 50% charge', 612);
      note('exampleMarkAfterOwnEdit', /example/i.test(edited.resultText));
      await frame.locator('#bt-usable').fill('90');
      await resetButton().click();
      const cleared = await expectNoResult('after Reset');
      check('Reset returns to blank capacity and consumption, W mode, 100% charge, 85% usable', JSON.stringify(cleared.fields) === JSON.stringify({ capacity: '', mode: 'w', consumption: '', charge: '100', usable: '85' }), cleared.fields);
      check('Reset returns the unit label to W', String(cleared.label).includes('W') && !String(cleared.label).includes('kWh'), cleared.label);
    });

    await stage('existing-power-and-torque-unchanged', async () => {
      const read = () => frame.evaluate(() => {
        const g = id => document.getElementById(id), value = id => (g(id) ? g(id).value : null), shown = el => !!el && el.getClientRects().length > 0;
        return {
          powerShown: shown(g('cvt-power')), torqueShown: shown(g('cvt-torque')), batteryShown: shown(g('cvt-battery')), batteryPressed: g('cvTabBattery').getAttribute('aria-pressed'),
          basis: { voltage: value('cv-voltage'), phase: value('cv-phase'), pf: value('cv-pf') },
          power: { amps: value('cv-amps'), kw: value('cv-kw'), va: value('cv-va'), kva: value('cv-kva'), hp: value('cv-hp') },
          powerResult: shown(g('cv-result')) ? g('cv-result').innerText : '',
          torque: { lbin: value('tq-lbin'), nm: value('tq-nm') }, torqueNote: g('tq-note') ? g('tq-note').innerText : '',
        };
      });
      await frame.locator('#cvToolTabs .conduit-tab', { hasText: /^Power$/ }).click();
      const tab = await settle(read, s => s.powerShown && !s.batteryShown);
      check('Power tab shows the Power panel and hides Wh / Runtime', tab.ok && tab.last.batteryPressed === 'false', tab.last);
      check('Power defaults are still 208 V, single phase, PF 0.85', JSON.stringify(tab.last.basis) === JSON.stringify({ voltage: '208', phase: '1', pf: '0.85' }), tab.last.basis);
      await frame.locator('#cv-watts').fill('1000');
      const power = await settle(read, s => s.power.amps === '5.66');
      check('1000 W → 5.66 A, 1.000 kW, 1176 VA, 1.176 kVA, 1.340 HP', power.ok && JSON.stringify(power.last.power) === JSON.stringify({ amps: '5.66', kw: '1.000', va: '1176', kva: '1.176', hp: '1.340' }), power.last.power);
      check('Power result rows show 5.66 A', power.last.powerResult.includes('5.66 A'), power.last.powerResult.replace(/\s+/g, ' ').slice(0, 200));
      await frame.locator('#cvToolTabs .conduit-tab', { hasText: /^Torque$/ }).click();
      await frame.locator('#tq-lbft').fill('10');
      const torque = await settle(read, s => s.torqueShown && s.torque.lbin === '120.00');
      check('10 lb-ft → 120.00 lb-in and 13.56 N·m', torque.ok && torque.last.torque.nm === '13.56' && !torque.last.batteryShown, torque.last);
      await frame.locator('#cvt-power button', { hasText: 'Reset' }).evaluate(b => b.click()); // leave the Power form as it was found
      await showBattery();
    });

    await stage('layout-320-390-desktop', async () => {
      await showBattery();
      for (const name of ['narrow', 'desktop', 'phone']) {
        const size = VIEWPORTS[name], label = size.width + ' px';
        await page.setViewportSize(size);
        await exampleButton().click();
        await expectRuntime(label + ' fridge example', 1224);
        await measure(label + ' populated');
        if (name === 'narrow') {
          await frame.locator('#bt-capacity').fill('abc'); await frame.locator('#bt-charge').fill('101');
          await expectNoResult(label + ' invalid form');
          await measure(label + ' validation messages');
          continue;
        }
        await frame.locator('#bt-result').scrollIntoViewIfNeeded();
        await settleLayout();
        check(label + ': page screenshot of the populated fridge example saved', !!(await shot('fridge-' + size.width + '-page')));
        const file = opt.engine + '-fridge-' + size.width + '-panel.png';
        try { await frame.locator('#cvt-battery').screenshot({ path: path.join(out, file) }); report.screenshots.push(file); } catch (e) { note(label + ' panel screenshot', 'not captured: ' + firstLine(e)); }
      }
    });

    if (fixtures) await stage('job-and-draft-survive-calculator-and-reload', async () => {
      await showTalk();
      await expectFixtures('after calculator use');
      await page.reload({ waitUntil: 'load' });
      await waitReady('online reload');
      await expectFixtures('after a real reload');
      await openConverter('after reload');
      await exampleButton().click();
      await expectRuntime('fridge example after reload', 1224);
      await showTalk();
      await expectFixtures('after calculator use following the reload');
    });
    else skip('job-and-draft-survive-calculator-and-reload', 'the synthetic job and draft were not created');

    await stage('offline-reload', async () => {
      const sw = await settle(() => page.evaluate(async () => {
        if (!('serviceWorker' in navigator) || !('caches' in window)) return { supported: false };
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 400))]);
        const state = { supported: true, active: !!(reg && reg.active), controller: !!navigator.serviceWorker.controller, caches: [] };
        for (const name of await caches.keys()) {
          const c = await caches.open(name), mark = await c.match(location.origin + '/.ec-shell-complete'), root = await c.match(location.origin + '/'), inner = await c.match(location.origin + '/workspace/mobile.html');
          state.caches.push({ name, complete: !!mark, root: !!root, frame: !!inner, frameSha256: inner ? inner.headers.get('X-Empire-Asset-Sha256') : null });
        }
        return state;
      }), s => s.supported === false || (s.active && s.controller && s.caches.some(c => c.complete && c.root && c.frame)), 30000);
      check('service workers and Cache Storage are available in this engine', sw.last && sw.last.supported === true, sw.last);
      check('service worker is active, controls the page and holds a complete shell cache with / and /workspace/mobile.html', sw.ok, sw.last);
      check('the cached /workspace/mobile.html is the current source build', sw.last.caches.some(c => c.complete && c.frameSha256 === report.sourceFrameSha256), sw.last.caches);
      note('frameControlled', await frame.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)));
      // Stronger isolation than network emulation alone: once the complete, current shell cache is confirmed above, the
      // dedicated fixture origin is shut down for the whole offline phase. stop() resolves only after the listener and
      // every open connection are closed, so a request still pending from the online phase ends here and, if it arrived
      // at all, is logged before the mark below. From then on the origin cannot answer anything, including a request
      // from a context that an engine's offline emulation might not cover (for example the service worker), so only
      // Cache Storage and browser storage can satisfy the reload. The mark is taken after BOTH the shutdown and the
      // offline switch; there is no settling delay to tune. The browser is deliberately not put back online afterwards:
      // the origin is gone for the rest of the run, the context is closed in the final cleanup, and the only stage that
      // follows (hygiene) reads collected evidence and loads nothing.
      const errorsBefore = report.pageErrors.length;
      await stopServer();
      const probe = await get(origin + '/api/session').then(r => 'answered ' + r.status, e => 'unreachable (' + (e && e.code || firstLine(e)) + ')');
      check('the local fixture origin is stopped and accepts no connection', probe.startsWith('unreachable'), probe);
      await context.setOffline(true);
      const mark = serverLog.length;
      note('originStoppedForOfflinePhase', { stopped: true, probeFromNode: probe, serverRequestsLoggedBeforeOfflinePhase: mark, browserLeftOfflineAfterStage: true });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitReady('offline reload');
      const net = await page.evaluate(() => fetch('/api/session', { cache: 'no-store' }).then(r => 'answered ' + r.status, () => 'rejected'));
      const talk = await readTalk();
      check('the browser really is offline (navigator.onLine false, API fetch rejected)', talk.online === false && net === 'rejected', { online: talk.online, apiSession: net });
      if (fixtures) await expectFixtures('offline'); else note('fixtures', 'not checked: the synthetic job and draft were not created');
      await openConverter('offline');
      await setForm(REFERENCE);
      await expectRuntime('offline: 1000 Wh · 100 W · 100% · 85% usable', 510);
      await exampleButton().click();
      await expectRuntime('offline: fridge example', 1224);
      await shot('offline-fridge-390-page');
      const reached = serverLog.slice(mark);
      note('requestsReachingServerWhileOffline', reached.map(r => r.method + ' ' + r.path));
      check('no page, asset or API request reached the local server while offline', reached.filter(r => r.path !== '/sw.js').length === 0, reached.map(r => r.method + ' ' + r.path).slice(0, 20));
      check('no uncaught page error while offline', report.pageErrors.length === errorsBefore, report.pageErrors.slice(errorsBefore));
    });

    await stage('hygiene', async () => {
      check('no uncaught page error during the whole run', report.pageErrors.length === 0, report.pageErrors.slice(0, 10));
      check('no request left the local origin', report.offOriginRequests.length === 0, report.offOriginRequests.slice(0, 10));
      check('no dialog or leave-page prompt appeared', report.dialogs.length === 0, report.dialogs.slice(0, 10));
    });
  } catch (e) {
    if (e instanceof Blocked) { report.blocked = e.message; console.log('BLOCKED  ' + e.message); }
    else if (!(e instanceof Abort)) { report.fatal = report.fatal || String(e && e.message || e).slice(0, 2000); console.log('ERROR  ' + firstLine(report.fatal)); await shot('FAIL-fatal'); }
  } finally {
    clearTimeout(watchdog);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await stopServer().catch(() => {}); // no-op when the offline stage already stopped the origin
    const failed = report.stages.filter(s => s.status !== 'passed' && s.status !== 'skipped').length;
    const skipped = report.stages.filter(s => s.status === 'skipped').length;
    report.result = report.blocked ? 'BLOCKED' : report.fatal || failed || skipped || !report.stages.length ? 'FAIL' : 'PASS';
    report.finishedAt = new Date().toISOString();
    if (out) {
      const file = path.join(out, 'converter-runtime-' + opt.engine + '.json');
      try { fs.writeFileSync(file, JSON.stringify(report, null, 1) + '\n'); console.log('Report: ' + file); } catch (e) { console.log('Report could not be written: ' + firstLine(e)); }
    }
    console.log(report.result + '  ' + opt.engine + '  stages passed ' + report.stages.filter(s => s.status === 'passed').length + '/' + report.stages.length);
  }
  return report.result === 'PASS' ? 0 : report.result === 'BLOCKED' ? 2 : 1;
}

if (require.main === module) {
  // A directory-wide `node --test` run may execute every file it finds; this optional gate never starts a browser there.
  if (process.env.NODE_TEST_CONTEXT) console.log('skipped: ' + SCRIPT + ' is an optional CLI acceptance script, run it directly.');
  else main().then(code => process.exit(code), e => { console.log((e instanceof Blocked ? 'BLOCKED  ' : 'ERROR  ') + firstLine(e)); process.exit(e instanceof Blocked ? 2 : 1); });
}
