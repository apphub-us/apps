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
  const report = { task: 'LC-JOB-ARCHIVE-1', status: 'RUNNING', startedAt: new Date().toISOString(), results: [], userProfilesAccessed: false, runtime: 'Native Chrome, dedicated profile, synthetic data only' };
  const pass = (name, details) => { report.results.push({ name, status: 'PASS', ...(details ? { details } : {}) }); console.log('PASS ' + name); };
  let child, cdp, server, browserLog, activePage;
  const profile = path.join(out, 'chrome-profile'), downloads = path.join(out, 'downloads'); fs.mkdirSync(profile); fs.mkdirSync(downloads);
  try {
    const source = inventory(); report.sourcePin = source.pin; report.sourceCount = source.pairs.length;
    if (expected) assert.equal(source.pin, expected, 'Source differs from approved package');
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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
    child = spawn(chrome, ['--headless', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', browserLog] });
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
    const a = await page(); activePage = a;
    const fixture = F.fixture(); const seed = { manifest: fixture.manifest, png: Array.from(F.F.png()), schemas: Source.SCHEMAS };
    await a.evaluate(`(async()=>{const f=${JSON.stringify(seed)},m=f.manifest;const data={empire_code_jobs:{jobs:[m.job.head],jobRevisions:m.job.revisions},empire_code_measurements:{revisions:m.measurements},empire_code_materials:{revisions:m.materials},empire_code_photos:{assets:m.originals.map(x=>({kind:'empire-code.photo-asset',recordVersion:1,photoId:x.photoId,jobId:x.jobId,file:x.file,blob:new Blob([new Uint8Array(f.png)],{type:x.file.mediaType})})),revisions:m.photoRevisions}};for(const[name,schema]of Object.entries(f.schemas)){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{for(const[n,[key,indexes]]of Object.entries(schema)){const s=r.result.createObjectStore(n,{keyPath:key});for(const[i,k]of indexes)s.createIndex(i,k,{unique:false});}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{await new Promise((resolve,reject)=>{const t=db.transaction(Object.keys(schema),'readwrite');for(const[n,rows]of Object.entries(data[name]))for(const row of rows)t.objectStore(n).add(row);t.oncomplete=resolve;t.onabort=()=>reject(t.error);});}finally{db.close();}}for(const r of m.results)localStorage.setItem(LC_RECORD_PREFIX+r.serviceResultId,r.raw);await lcJobRefresh();return true;})()`);
    await a.click('#lcJobToggleBtn'); await a.click('#lcJobList .lc-job-open'); await a.wait('LC_JOB.current && !LC_JOB.editor');
    const live = p => p.evaluate(`JSON.stringify({state:lcExportState(),draft:lcFavPayload(),service:LC_SVC.analysis,job:LC_JOB.current,calc:LC_CALC.attempted,favorites:localStorage.getItem('sparky_favorites')})`);
    const initial = await live(a); await a.click('#lcArcExportBtn'); await a.wait('LC_ARC.prepared && !LC_ARC.busy');
    assert.equal(await live(a), initial); pass('Native export prepares complete saved histories/originals without changing the live job or calculator');
    await a.click('#lcArcDownload');
    for (let i = 0; i < 200 && !downloadsDone.length; i++) await pause(100);
    assert.equal(downloadsDone.length, 1, 'Browser download was not confirmed'); const names = fs.readdirSync(downloads).filter(n => n.endsWith('.ecjob')); assert.equal(names.length, 1);
    const downloaded = path.join(downloads, names[0]), disk = fs.readFileSync(downloaded);
    const read = await Codec.decode(new Blob([disk]), { crypto: crypto.webcrypto }); assert.equal(read.ok, true, JSON.stringify(read));
    assert.deepEqual(read.manifest.job, fixture.manifest.job); assert.deepEqual(read.manifest.measurements, fixture.manifest.measurements); assert.equal(read.manifest.results[0].raw, fixture.manifest.results[0].raw);
    assert.deepEqual(Buffer.from(await read.assets[0].blob.arrayBuffer()), F.F.png()); pass('Real browser download on disk round-trips every historical field and exact original photo bytes');
    // Change the live same-ID job after export; opening the old file must not overwrite that later state.
    await a.evaluate(`(async()=>{const j=LC_JOB.current;const r=await LC_JOB.store.save(j.head.jobId,j.head.currentRevisionId,{title:'LIVE NEWER — DO NOT REPLACE',address:j.revision.address,notes:'Later edit'},[]);if(!r.ok)throw Error(JSON.stringify(r));await lcJobOpen(j.head.jobId);return true;})()`);
    const newer = await live(a); await a.file(downloaded); await a.wait('LC_ARC.loaded && !LC_ARC.busy'); assert.equal(await live(a), newer);
    assert.equal(await a.evaluate('LC_ARC.checked.job.revisions.length'), 2); assert.equal(await a.evaluate('LC_JOB.current.revision.revisionNumber'), 3);
    pass('Opening a downloaded archive does not overwrite a newer live job with the same ID');
    for (const category of ['job', 'results', 'measurements', 'materials', 'photos']) { await a.set('lcArcCategory', category); assert.ok(await a.evaluate('document.getElementById("lcArcEntryView").textContent.length>20')); }
    assert.equal(await live(a), newer); pass('All five read-only archive sections use file data, not live storage');
    await a.set('lcArcCategory', 'results'); const resultText = await a.evaluate('document.getElementById("lcArcEntryView").textContent'); assert.match(resultText, /23,680/); assert.match(resultText, /98.7/); assert.match(resultText, /Declared premise/);
    pass('Archived B0 and the unresolved 200/175 A qualification remain unchanged and are not recalculated');
    await a.set('lcArcCategory', 'measurements'); await a.set('lcArcVersion', '1'); assert.match(await a.evaluate('document.getElementById("lcArcEntryView").textContent'), /120.00/);
    await a.set('lcArcCategory', 'materials'); assert.match(await a.evaluate('document.getElementById("lcArcEntryView").textContent'), /Not needed/); await a.set('lcArcVersion', '1'); assert.match(await a.evaluate('document.getElementById("lcArcEntryView").textContent'), /Needed/);
    pass('Earlier measurement precision and material statuses remain available as historical versions');
    await a.set('lcArcCategory', 'photos'); await a.click('#lcArcPhotoOpenBtn'); await a.wait('document.querySelector("#lcArcEntryView img").complete && document.querySelector("#lcArcEntryView img").naturalWidth===3');
    await a.click('#lcArcPhotoCloseBtn'); assert.equal(await a.evaluate('LC_ARC.urls.photo'), null); pass('Archived original image decodes natively and its object URL is released on close');
    const badPath = path.join(out, 'corrupt.ecjob'), corrupt = Buffer.from(disk); corrupt[corrupt.length - 1] ^= 1; fs.writeFileSync(badPath, corrupt);
    const archiveId = read.manifest.archiveId; await a.file(badPath); await a.wait('!LC_ARC.busy && document.getElementById("lcArcStatus").textContent.includes("Previously opened")'); assert.equal(await a.evaluate('LC_ARC.loaded.manifest.archiveId'), archiveId); assert.equal(await live(a), newer);
    pass('Corrupt archive is rejected; previous archive and newer live data stay intact');
    // A second isolated browser context has no access to the first context's IndexedDB/localStorage.
    const context = await cdp.send('Target.createBrowserContext'); const b = await page(context.browserContextId); activePage = b;
    const empty = await live(b); await b.evaluate(`(()=>{window.__arcReads=0;const open=indexedDB.open.bind(indexedDB);indexedDB.open=function(...args){window.__arcReads++;return open(...args);};return true;})()`);
    await b.file(downloaded); await b.wait('LC_ARC.loaded && !LC_ARC.busy'); assert.equal(await live(b), empty); assert.equal(await b.evaluate('window.__arcReads'), 0); assert.equal(await b.evaluate('LC_ARC.loaded.summary.photos'), 1); assert.equal(await b.evaluate('LC_JOB.current'), null);
    pass('The downloaded file opens in a clean browser context without opening source databases or creating live job records');
    const layouts = []; for (const width of [390, 430, 768, 1440]) { await b.send('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false }); await b.evaluate('document.getElementById("lcArcLoaded").scrollIntoView({block:"start"});true'); await pause(60);
      const size = await b.evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth,hub:document.getElementById("lcArcHub").scrollWidth,client:document.getElementById("lcArcHub").clientWidth})'); assert.ok(size.document <= width + 1, JSON.stringify(size)); assert.ok(size.hub <= size.client + 1, JSON.stringify(size)); layouts.push(size); await b.screenshot('archive-' + width); }
    pass('Native archive view fits 390/430/768/1440 px without horizontal overflow', layouts);
    await b.click('#lcArcCloseBtn'); assert.equal(await b.evaluate('LC_ARC.loaded'), null); assert.equal(await live(b), empty); pass('Close clears only the temporary archive view, not downloaded files or live records');
    await a.evaluate(`(async()=>{const saved=localStorage.getItem(LC_RECORD_PREFIX+${JSON.stringify(F.R)});try{const r=await EC.jobArchiveSource.capture({indexedDB,localStorage,crypto,progress(){localStorage.removeItem(LC_RECORD_PREFIX+${JSON.stringify(F.R)});}},${JSON.stringify(F.J)});if(r.code!=='SOURCE_CHANGED')throw Error(JSON.stringify(r));return true;}finally{localStorage.setItem(LC_RECORD_PREFIX+${JSON.stringify(F.R)},saved);}})()`);
    pass('Observed cross-storage change during export produces SOURCE_CHANGED rather than a mixed archive');
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions)); pass('No unhandled JavaScript exceptions in the completed archive scenarios');
    assert.equal(inventory().pin, source.pin); report.status = 'PASS'; report.downloadedFile = names[0]; report.downloadSha256 = crypto.createHash('sha256').update(disk).digest('hex'); report.uniqueScenarios = report.results.length;
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
