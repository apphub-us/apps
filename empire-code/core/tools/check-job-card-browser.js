#!/usr/bin/env node
'use strict';
/**
 * Native IndexedDB gate for LC-JOB-CARD-1.
 *
 * Run: node tools/check-job-card-browser.js
 * An already installed Playwright runtime and Chromium executable are required.
 * Nothing is downloaded or installed. Absent runtime => explicit SKIP, exit 0.
 * The wrapper test preserves that result as node:test SKIP, never a pass.
 *
 * Exact public model/store source bytes execute at a newly served loopback
 * origin in a fresh, nonpersistent browser context. It never opens mobile.html,
 * the user's application origin, profile, service results or Favorites.
 * Chromium evidence does not establish Safari/iPhone or crash durability.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.join(__dirname, '..');

function runtime(options) {
  const opts = options || {}; let automation = null;
  for (const name of ['playwright', 'playwright-core']) {
    try { automation = require(name); break; } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') return { available: false, reason: name + ' could not load: ' + error.message };
    }
  }
  if (!automation) return { available: false, reason: 'Native job-card IndexedDB gate: Playwright is not installed/resolvable; no browser was installed. Transaction simulations are separate evidence.' };
  const browserName = opts.browserName || 'chromium'; const type = automation[browserName];
  if (!type || typeof type.launch !== 'function') return { available: false, reason: 'Native job-card IndexedDB gate: requested browser type is unavailable: ' + browserName };
  let executable;
  try { executable = opts.executablePath || type.executablePath(); }
  catch (error) { return { available: false, reason: 'Native job-card IndexedDB gate: no available browser executable: ' + error.message }; }
  if (!executable || !fs.existsSync(executable)) return { available: false, reason: 'Native job-card IndexedDB gate: ' + browserName + ' executable is not installed; no download or install was attempted.' };
  return { available: true, type, executable, browserName };
}
function sourceScript() {
  const model = fs.readFileSync(path.join(ROOT, 'src/jobs/jobCard.js'), 'utf8');
  const persistence = fs.readFileSync(path.join(ROOT, 'src/jobs/jobCardStore.js'), 'utf8');
  // Source is embedded verbatim, using the same CommonJS export contract as the
  // application bundle. This is not an alternate implementation of the store.
  return "'use strict';\n(function(){\nconst definitions = Object.create(null), cache = Object.create(null);\n" +
    "definitions.jobCard = function(module,exports,require){\n" + model + "\n};\n" +
    "definitions.jobCardStore = function(module,exports,require){\n" + persistence + "\n};\n" +
    "function load(name){ name = name.replace(/^.*\\//, '').replace(/\\.js$/, ''); if(cache[name]) return cache[name].exports; if(!definitions[name]) throw new Error('Unknown gate module '+name); const module = {exports:{}}; cache[name]=module; definitions[name](module,module.exports,load); return module.exports; }\n" +
    "window.JobCardStore = load('jobCardStore');\n})();\n";
}
async function serve() {
  const script = sourceScript();
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><meta charset="utf-8"><title>Isolated native job-card gate</title><script src="/job-gate.js"></script><p>Isolated native IndexedDB test.</p>');
    } else if (req.url === '/job-gate.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(script);
    } else { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
}
async function stopServer(server) {
  if (!server) return;
  await new Promise((resolve) => { server.close(resolve); if (server.closeAllConnections) server.closeAllConnections(); });
}
async function run(options) {
  const opts = options || {}; const available = runtime(opts);
  if (!available.available) return { status: 'SKIP', native: false, reason: available.reason, results: [] };
  const results = []; let browser = null; let context = null; let server = null;
  function check(name, condition, details) {
    const item = { name, ok: !!condition }; if (details !== undefined) item.details = details;
    results.push(item); if (opts.verbose) process.stdout.write((condition ? 'PASS ' : 'FAIL ') + name + '\n');
    if (!condition) throw new Error(name);
  }
  try {
    try { browser = await available.type.launch({ headless: true, executablePath: available.executable }); }
    catch (error) { return { status: 'SKIP', native: false, reason: 'Native job-card IndexedDB gate: installed browser could not launch in this environment: ' + error.message, results: [] }; }
    const served = await serve(); server = served.server;
    context = await browser.newContext(); const pageA = await context.newPage(); const pageB = await context.newPage();
    const pageErrors = []; pageA.on('pageerror', (error) => pageErrors.push(error.message)); pageB.on('pageerror', (error) => pageErrors.push(error.message));
    await Promise.all([pageA.goto(served.origin), pageB.goto(served.origin)]);
    const created = await pageA.evaluate(async () => {
      window.subject = window.JobCardStore.createJobStore(window.indexedDB, { crypto: window.crypto });
      return await window.subject.create({ title: 'Native job Żółć 🏠', address: 'Isolated browser test', notes: 'Original note' }, []);
    });
    check('native create commits one complete card', created.ok && created.job.revision.revisionNumber === 1, created);
    const key = created.job.head.jobId; const expected = created.job.head.currentRevisionId;
    const fromB = await pageB.evaluate(async (jobId) => {
      window.subject = window.JobCardStore.createJobStore(window.indexedDB, { crypto: window.crypto });
      return await window.subject.read(jobId);
    }, key);
    check('separate page reads committed native data', JSON.stringify(fromB.job) === JSON.stringify(created.job), fromB);
    const edits = [
      pageA.evaluate(async ({ jobId, revisionId }) => await window.subject.save(jobId, revisionId, { title: 'Native job Żółć 🏠', address: 'Isolated browser test', notes: 'Client A edit' }, []), { jobId: key, revisionId: expected }),
      pageB.evaluate(async ({ jobId, revisionId }) => await window.subject.save(jobId, revisionId, { title: 'Native job Żółć 🏠', address: 'Isolated browser test', notes: 'Client B edit' }, []), { jobId: key, revisionId: expected }),
    ];
    const outcomes = await Promise.all(edits); const winner = outcomes.find((r) => r.ok); const loser = outcomes.find((r) => !r.ok);
    check('two native clients with the same expected revision yield one commit and one conflict', outcomes.filter((r) => r.ok).length === 1 && loser && loser.code === 'CONFLICT' && loser.currentRevisionId === winner.job.head.currentRevisionId, outcomes);
    const history = await pageA.evaluate(async (jobId) => await window.subject.history(jobId), key);
    check('native concurrent save retains both immutable revisions in revision order', history.ok && history.revisions.length === 2 && history.revisions[0].revisionNumber === 2 && history.revisions[1].revisionId === expected, history);

    // Fault interception delegates to REAL native IDB requests/transactions. It
    // calls native abort after a revision add request succeeds; no fake database
    // or fake success event participates in this gate.
    const aborted = await pageA.evaluate(async ({ jobId, expectedRevisionId }) => {
      let successfulAdds = 0;
      const injected = { open(name, version) {
        const request = window.indexedDB.open(name, version);
        request.addEventListener('success', () => {
          const connection = request.result; const originalTransaction = connection.transaction.bind(connection);
          Object.defineProperty(connection, 'transaction', { configurable: true, value(names, mode, options) {
            const transaction = options === undefined ? originalTransaction(names, mode) : originalTransaction(names, mode, options);
            if (mode === 'readwrite') {
              const originalStore = transaction.objectStore.bind(transaction);
              Object.defineProperty(transaction, 'objectStore', { configurable: true, value(storeName) {
                const store = originalStore(storeName);
                if (storeName !== 'jobRevisions') return store;
                return new Proxy(store, { get(target, property) {
                  if (property === 'add') return function(value, key) {
                    const add = key === undefined ? target.add(value) : target.add(value, key);
                    add.addEventListener('success', () => { successfulAdds++; transaction.abort(); });
                    return add;
                  };
                  const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
                } });
              } });
            }
            return transaction;
          } });
        });
        return request;
      } };
      const abortingStore = window.JobCardStore.createJobStore(injected, { crypto: window.crypto });
      const result = await abortingStore.save(jobId, expectedRevisionId, { title: 'Must roll back', address: 'Not committed', notes: 'Not committed' }, []);
      abortingStore.close(); return { result, successfulAdds };
    }, { jobId: key, expectedRevisionId: winner.job.head.currentRevisionId });
    check('native request success followed by native transaction abort is reported as failure', aborted.successfulAdds === 1 && !aborted.result.ok && aborted.result.code === 'ABORTED', aborted);
    const afterAbort = await pageB.evaluate(async (jobId) => ({ current: await window.subject.read(jobId), history: await window.subject.history(jobId) }), key);
    check('native abort leaves the old head and history exact, without an orphan revision', JSON.stringify(afterAbort.current.job) === JSON.stringify(winner.job) && JSON.stringify(afterAbort.history) === JSON.stringify(history), afterAbort);

    await pageA.evaluate(() => window.subject.close()); await pageA.reload();
    const restarted = await pageA.evaluate(async (jobId) => {
      window.subject = window.JobCardStore.createJobStore(window.indexedDB, { crypto: window.crypto });
      return { current: await window.subject.read(jobId), history: await window.subject.history(jobId) };
    }, key);
    check('real document restart reads the committed native card and full history', JSON.stringify(restarted.current.job) === JSON.stringify(winner.job) && JSON.stringify(restarted.history) === JSON.stringify(history), restarted);
    const staleNoop = await pageA.evaluate(async ({ jobId, stale, fields }) => await window.subject.save(jobId, stale, fields, []), {
      jobId: key, stale: expected, fields: { title: winner.job.revision.title, address: winner.job.revision.address, notes: winner.job.revision.notes },
    });
    check('native stale unchanged save conflicts instead of bypassing revision comparison', !staleNoop.ok && staleNoop.code === 'CONFLICT', staleNoop);

    // Both production connections must close on native versionchange so this
    // isolated upgrade can finish. It creates no user-data migration or repair.
    const upgraded = await pageA.evaluate(async () => await new Promise((resolve) => {
      let blocked = false; const request = window.indexedDB.open('empire_code_jobs', 2);
      const timer = setTimeout(() => resolve({ ok: false, timeout: true, blocked }), 4000);
      request.onblocked = () => { blocked = true; };
      request.onerror = () => { clearTimeout(timer); resolve({ ok: false, error: request.error && request.error.name, blocked }); };
      request.onsuccess = () => { clearTimeout(timer); request.result.close(); resolve({ ok: true, blocked }); };
    }));
    check('native versionchange releases all production connections', upgraded.ok, upgraded);
    const future = await pageA.evaluate(async (jobId) => {
      const store = window.JobCardStore.createJobStore(window.indexedDB, { crypto: window.crypto }); const result = await store.read(jobId); store.close(); return result;
    }, key);
    check('new client refuses the now newer native database version', !future.ok && future.code === 'UNSUPPORTED', future);
    check('native gate records no page errors', pageErrors.length === 0, pageErrors);
    return { status: 'PASS', native: true, browser: available.browserName, results, limitations: ['No Safari/iPhone acceptance', 'No crash durability or forced native quota exhaustion claim', 'Public store boundary only; UI lifecycle has separate tests'] };
  } catch (error) {
    if (!results.some((r) => !r.ok)) results.push({ name: 'Native gate execution', ok: false, details: error.stack || error.message });
    return { status: 'FAIL', native: true, browser: available.browserName, results, error: error.message };
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    await stopServer(server);
  }
}
async function main() {
  const result = await run({ verbose: true });
  process.stdout.write('JOB_CARD_NATIVE_GATE ' + JSON.stringify(result) + '\n');
  process.exitCode = result.status === 'FAIL' ? 1 : 0;
}
if (require.main === module) main().catch((error) => {
  process.stderr.write('JOB_CARD_NATIVE_GATE ' + JSON.stringify({ status: 'FAIL', native: false, error: error.stack || error.message }) + '\n'); process.exitCode = 1;
});
module.exports = { run, runtime };
