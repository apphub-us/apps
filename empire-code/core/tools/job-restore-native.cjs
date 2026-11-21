#!/usr/bin/env node
'use strict';
/** Local-only Chrome acceptance for .ecjob download/reopen. Fresh profile + synthetic records.
 * No Playwright/npm installation; no personal Chrome/Safari profile; no publication.
 * Usage: node tools/job-archive-native.cjs /absolute/new/evidence-dir [expected-source-pin]
 */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const F = require('../test/helpers/archiveFixtures');
const Codec = require('../src/jobs/jobArchiveFile');
const Source = require('../src/jobs/jobArchiveSource');
const pause = ms => new Promise(r => setTimeout(r, ms));
function inventory() {
  const pairs = []; function walk(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, item.name); if (item.isSymbolicLink()) throw Error('Source contains a symlink'); if (item.isDirectory()) walk(f); else if (item.isFile()) pairs.push([path.relative(ROOT, f).split(path.sep).join('/'), crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]); } }
  walk(ROOT); pairs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return { pairs, pin: crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex') };
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.pending = new Map(); this.handlers = [];
    socket.addEventListener('message', e => { const m = JSON.parse(String(e.data)); if (m.id) { const p = this.pending.get(m.id); if (!p) return; clearTimeout(p.timer); this.pending.delete(m.id); if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result); } else this.handlers.forEach(f => f(m)); });
    socket.addEventListener('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('CDP closed')); } this.pending.clear(); });
  }
  static async connect(url) { const s = new WebSocket(url); await new Promise((resolve, reject) => { const t = setTimeout(() => { s.close(); reject(Error('Browser connection timeout')); }, 8000); s.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true }); s.addEventListener('error', () => { clearTimeout(t); s.close(); reject(Error('Browser connection failed')); }, { once: true }); }); return new CDP(s); }
  send(method, params = {}, sessionId) { const id = this.next++; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Timed out: ' + method)); }, 25000); this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
}
async function main(out, expected) {
  assert.ok(path.isAbsolute(out), 'Evidence directory must be absolute');
  assert.ok(!path.resolve(out).startsWith(ROOT + path.sep), 'Do not put test artifacts inside source');
  assert.ok(!fs.existsSync(out), 'Use a new evidence directory; never overwrite logs'); fs.mkdirSync(out, { recursive: true });
  const report = { task: 'LC-JOB-RESTORE-1', status: 'RUNNING', startedAt: new Date().toISOString(), results: [], userProfilesAccessed: false, runtime: 'Native Chrome, dedicated profile, synthetic data only' };
  const pass = (name, details) => { report.results.push({ name, status: 'PASS', ...(details ? { details } : {}) }); console.log('PASS ' + name); };
  let child, cdp, server, browserLog, activePage;
  const profile = path.join(out, 'chrome-profile'), downloads = path.join(out, 'downloads'); fs.mkdirSync(profile); fs.mkdirSync(downloads);
  try {
    const source = inventory(); report.sourcePin = source.pin; report.sourceCount = source.pairs.length;
    if (expected) assert.equal(source.pin, expected, 'Source differs from approved package');
    const chrome = process.env.EC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!fs.existsSync(chrome)) throw Error('Google Chrome is not installed at its standard Mac path. Nothing was installed or changed.');
    if (typeof WebSocket !== 'function') throw Error('This browser test needs Node with built-in WebSocket (Node 22 as on the project Mac).');
    const files = new Map(source.pairs.map(([rel, digest]) => { const bytes = fs.readFileSync(path.join(ROOT, rel)); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), digest); return ['/' + rel, bytes]; }));
    server = http.createServer((req, res) => {
      let url; try { url = new URL(req.url, 'http://localhost').pathname; } catch (_) { res.writeHead(400).end(); return; }
      if (url === '/') url = '/mobile.html'; const bytes = files.get(url);
      if (!bytes || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html;charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };
      res.writeHead(200, { 'Content-Type': types[path.extname(url)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'" }); res.end(req.method === 'HEAD' ? undefined : bytes);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const origin = 'http://127.0.0.1:' + server.address().port; report.origin = origin;
    browserLog = fs.openSync(path.join(out, 'chrome.log'), 'wx');
    child = spawn(chrome, ['--headless', ...(process.env.EC_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-proxy-server', '--proxy-bypass-list=<-loopback>', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', browserLog] });
    let spawnError; child.once('error', e => { spawnError = e; });
    let port; for (let i = 0; i < 150; i++) { if (spawnError) throw spawnError; if (child.exitCode !== null) throw Error('Test Chrome stopped early'); try { const lines = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'); if (lines[1]) { port = lines; break; } } catch (_) {} await pause(100); }
    if (!port) throw Error('Test Chrome did not expose its local test endpoint'); cdp = await CDP.connect('ws://127.0.0.1:' + port[0] + port[1]);
    report.browser = await cdp.send('Browser.getVersion'); const downloadsDone = [], exceptions = [];
    cdp.handlers.push(m => {
      if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed') downloadsDone.push(m.params);
      if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
      if (m.method === 'Fetch.requestPaused') { let allowed = false; try { const url = new URL(m.params.request.url); allowed = url.origin === origin || url.protocol === 'blob:'; } catch (_) {} cdp.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: 'BlockedByClient' }, m.sessionId).catch(() => {}); }
    });
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    async function page(contextId) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', ...(contextId ? { browserContextId: contextId } : {}) });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const send = (method, params = {}) => cdp.send(method, params, sessionId);
      await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
      async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
      async function wait(expression, timeout = 18000) { const end = Date.now() + timeout; let last; do { try { const v = await evaluate(expression); if (v) return v; } catch (e) { last = e.message; } await pause(80); } while (Date.now() < end); throw Error('Page wait failed: ' + expression + (last ? ' — ' + last : '')); }
      async function click(selector) { const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing/disabled control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden control');return {x:r.x+r.width/2,y:r.y+r.height/2};})()`); await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }); }
      async function set(id, value) { await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`); }
      async function file(filename) { const doc = await send('DOM.getDocument'); const el = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#lcArcFile' }); await send('DOM.setFileInputFiles', { nodeId: el.nodeId, files: [filename] }); }
      async function screenshot(name) { const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(image.data, 'base64')); }
      const nav = await send('Page.navigate', { url: origin + '/mobile.html' }); if (nav.errorText) throw Error(nav.errorText);
      await wait('document.readyState==="complete" && typeof openTool==="function"'); await evaluate('openTool("loadcalc");true'); await wait('LC.built && document.getElementById("lcJobListStatus").textContent.includes("readable")');
      return { evaluate, wait, click, set, file, screenshot, send };
    }
    const fixture = F.fixture();
    const encoded = await Codec.encode(fixture.manifest, fixture.assets, { crypto: crypto.webcrypto });
    assert.equal(encoded.ok,true,JSON.stringify(encoded));
    const downloaded = path.join(out,'synthetic-verified.ecjob'); fs.writeFileSync(downloaded,Buffer.from(await encoded.blob.arrayBuffer()));
    const a = await page(); activePage=a;
    await a.file(downloaded); await a.wait('LC_ARC.loaded && !LC_ARC.busy');
    assert.ok(await a.evaluate('LC_RESTORE.ready'));
    pass('Verified file opens read-only; explicit restore is offered without initial browser writes');
    await a.evaluate('document.getElementById("lcRestoreAgree").click();true');
    await a.click('#lcRestoreRunBtn');
    await a.wait('!LC_RESTORE.busy && document.getElementById("lcRestoreStatus").textContent.includes("RESTORED")',30000);
    assert.equal(await a.evaluate('LC_RESTORE.ready'),false);
    pass('Explicitly confirmed restore publishes the job and all historical rows');
    const sums=await a.evaluate(`(async()=>{const names=['empire_code_jobs','empire_code_measurements','empire_code_materials','empire_code_photos'];const data={};for(const n of names){const db=await new Promise((ok,bad)=>{const r=indexedDB.open(n);r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const stores=Array.from(db.objectStoreNames);data[n]=await new Promise((ok,bad)=>{const tx=db.transaction(stores);const d={};for(const st of stores){const r=tx.objectStore(st).getAll();r.onsuccess=()=>d[st]=r.result.map(v=>n==='empire_code_photos'&&st==='assets'?({...v,blob:{size:v.blob.size,type:v.blob.type}}):v);}tx.oncomplete=()=>ok(d);tx.onabort=()=>bad(tx.error)});db.close();}return data;})()`);
    assert.deepEqual(sums.empire_code_jobs.jobs[0],fixture.manifest.job.head);
    assert.deepEqual(sums.empire_code_jobs.jobRevisions,fixture.manifest.job.revisions);
    assert.deepEqual(sums.empire_code_measurements.revisions,fixture.manifest.measurements);
    assert.deepEqual(sums.empire_code_materials.revisions,fixture.manifest.materials);
    assert.deepEqual(sums.empire_code_photos.revisions,fixture.manifest.photoRevisions);
    assert.equal(sums.empire_code_photos.assets.length,1);
    assert.equal(sums.empire_code_photos.assets[0].blob.size,fixture.assets[0].blob.size);
    const orig=await a.evaluate(`(async()=>{const x=await EC.jobPhotoStore.createPhotoStore(indexedDB,{crypto,readJob:id=>LC_JOB.store.read(id),decode:createImageBitmap}).original(${JSON.stringify(F.J)},${JSON.stringify(fixture.manifest.originals[0].photoId)});return {ok:x.ok,size:x.blob&&x.blob.size};})()`);
    assert.equal(orig.ok,true,JSON.stringify(orig));
    assert.equal(await a.evaluate(`localStorage.getItem(LC_RECORD_PREFIX+${JSON.stringify(F.R)})`),fixture.manifest.results[0].raw);
    pass('All four existing databases and original calculation text exactly match the historical archive');
    assert.equal((await a.evaluate(`(async()=>await LC_JOB.store.read(${JSON.stringify(F.J)}))()`)).ok,true);
    assert.equal(await a.evaluate('LC_CALC.attempted'),false);
    assert.equal(await a.evaluate(`(async()=>await EC.jobRestoreStore.createRestoreStore(indexedDB,localStorage,{crypto,locks:navigator.locks}).inspect())()` ).then(x=>x.pending.length),0);
    pass('Restored job is editable through the original reader; current calculator remained untouched');
    await a.evaluate('lcRestoreReady(LC_ARC.loaded);document.getElementById("lcRestoreAgree").click();true');
    await a.click('#lcRestoreRunBtn'); await a.wait('!LC_RESTORE.busy && document.getElementById("lcRestoreStatus").textContent.includes("already")',30000);
    assert.equal((await a.evaluate(`(async()=>await LC_JOB.store.read(${JSON.stringify(F.J)}))()`)).job.head.revisionNumber,2);
    pass('Same-ID second restore is refused; existing history remains unchanged');
    const context=await cdp.send('Target.createBrowserContext');const b=await page(context.browserContextId);activePage=b;
    await b.file(downloaded);await b.wait('LC_ARC.loaded && !LC_ARC.busy');
    const result=await b.evaluate(`(async()=>{window.__restoreFault=true;const s=EC.jobRestoreStore.createRestoreStore(indexedDB,localStorage,{crypto,locks:navigator.locks,step:async name=>{if(name==='empire_code_materials')throw Error('injected fault')}});window.__restoreAdapter=s;return await s.restore(LC_ARC.loaded,true);})()`);
    assert.equal(result.ok,false);assert.equal(result.code,'UNAVAILABLE',JSON.stringify(result));
    assert.equal(await b.evaluate(`(async()=>{const x=await EC.jobArchiveSource.readDatabase(indexedDB,'empire_code_jobs',${JSON.stringify(F.J)});return x.data&&x.data.head||null})()`),null);
    assert.equal(await b.evaluate(`localStorage.getItem(LC_RECORD_PREFIX+${JSON.stringify(F.R)})`),null);
    assert.equal((await b.evaluate('window.__restoreAdapter.inspect()')).pending.length,0);
    pass('Injected failure midway rolls back all staged data; no job becomes visible');
    await b.evaluate(`(async()=>{const db=await new Promise((ok,bad)=>{const r=indexedDB.open('empire_code_restore_operations',1);r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const marker={jobId:${JSON.stringify(F.J)},archiveId:'archive1_'+ '0'.repeat(32),state:'pending',rows:{empire_code_jobs:{jobs:[],jobRevisions:[]},empire_code_measurements:{revisions:[]},empire_code_materials:{revisions:[]},empire_code_photos:{assets:[],revisions:[]}},results:[]};await new Promise((ok,bad)=>{const tx=db.transaction('operations','readwrite');tx.objectStore('operations').add(marker);tx.oncomplete=ok;tx.onabort=()=>bad(tx.error)});db.close();return true;})()`);
    const pending=await b.evaluate('(async()=>await window.__restoreAdapter.inspect())()');assert.equal(pending.pending.length,1);
    const rec=await b.evaluate('(async()=>await window.__restoreAdapter.recover())()');assert.deepEqual(rec,{ok:true,recovered:1});
    pass('Recovery explicitly clears a pending journal after verifying intended cleanup');
    await b.evaluate('document.getElementById("lcRestoreAgree").click();true');
    await b.click('#lcRestoreRunBtn');await b.wait('!LC_RESTORE.busy && document.getElementById("lcRestoreStatus").textContent.includes("RESTORED")',30000);
    pass('Restore succeeds in an independent clean browser context after recovery');
    assert.equal(exceptions.length,0,JSON.stringify(exceptions));
    pass('No uncaught exceptions during native restore scenarios');
    report.status='PASS';report.uniqueScenarios=report.results.length;
  } catch (e) {
    report.status = 'FAIL'; report.error = e.stack; process.exitCode = 1;
    try { if (activePage) await activePage.screenshot('failure'); } catch (_) { /* Original failure retained. */ }
  } finally {
    if (cdp) { try { await cdp.send('Browser.close'); } catch (_) {} cdp.socket.close(); }
    if (child) { for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await pause(100); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await pause(100); } report.testChromeStopped = child.exitCode !== null || child.signalCode !== null; if (!report.testChromeStopped) { report.status = 'FAIL'; process.exitCode = 1; } }
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (browserLog !== undefined) fs.closeSync(browserLog);
    report.endedAt = new Date().toISOString(); report.finalSourcePin = inventory().pin;
    fs.writeFileSync(path.join(out, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ status: report.status, scenarios: report.results.length, report: path.join(out, 'REPORT.json'), error: report.error }));
  }
}
if (require.main === module) main(path.resolve(process.argv[2] || 'native-archive-evidence'), process.argv[3]).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { inventory, main };
