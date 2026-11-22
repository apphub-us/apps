'use strict';
// Build whitelist, baseline pins and service-worker pin. Local temp copies only; no network. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),B=require('../candidate/build.cjs');
const INPUTS=['BROWSER-BASELINE.json','RELEASE.json','online-prompt.txt'];
const BASELINE=new Map(JSON.parse(fs.readFileSync(path.join(ROOT,'input/BROWSER-BASELINE.json'),'utf8')));
const RELEASE=new Map(JSON.parse(fs.readFileSync(path.join(ROOT,'input/RELEASE.json'),'utf8')).pairs);

// Hand-written expectations (EC-AUDIT-FIX-1). They are not read back from the build script.
const OLD18=['conversation-bank.js','draft-recovery.js','handoff-session.js','index.html','material-edit-host.js','style.css','sw.js','ui.js','workspace-host.js','workspace/handoff.js','workspace/host-core.css','workspace/host-core.js','workspace/icon-192.png','workspace/icon-512.png','workspace/icon.svg','workspace/manifest.json','workspace/material-edit.js','workspace/mobile.html'];
const NEW2=['assistant-session.js','workspace/assistant-bridge.js'];
const ALL20=['assistant-session.js','conversation-bank.js','draft-recovery.js','handoff-session.js','index.html','material-edit-host.js','style.css','sw.js','ui.js','workspace-host.js','workspace/assistant-bridge.js','workspace/handoff.js','workspace/host-core.css','workspace/host-core.js','workspace/icon-192.png','workspace/icon-512.png','workspace/icon.svg','workspace/manifest.json','workspace/material-edit.js','workspace/mobile.html'];
const CHANGED13=['conversation-bank.js','draft-recovery.js','handoff-session.js','index.html','material-edit-host.js','style.css','sw.js','ui.js','workspace-host.js','workspace/handoff.js','workspace/host-core.js','workspace/material-edit.js','workspace/mobile.html'];
const PROTECTED5=['workspace/host-core.css','workspace/icon-192.png','workspace/icon-512.png','workspace/icon.svg','workspace/manifest.json'];
const HOST_TAGS=['/workspace/handoff.js','/workspace/material-edit.js','/workspace/host-core.js','/workspace/assistant-bridge.js'].map(s=>'<script src="'+s+'"></script>');
const JS_MIME='text/javascript; charset=utf-8';

// A clean copy of the 20 whitelisted files and the three inputs; the checkpoint itself is never modified by a test.
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ec-build-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const p of ALL20){const to=path.join(dir,'candidate/browser',p);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(ROOT,'candidate/browser',p),to);}
 fs.mkdirSync(path.join(dir,'input'));
 for(const f of INPUTS)fs.copyFileSync(path.join(ROOT,'input',f),path.join(dir,'input',f));
 return dir;
}
const at=(dir,p)=>path.join(dir,'candidate/browser',p);
const refused=re=>e=>e.code==='EC_BUILD_REFUSED'&&re.test(e.message);
const exactly=message=>e=>e.code==='EC_BUILD_REFUSED'&&e.message==='build refused: '+message;
const nothingWritten=(dir,label)=>{for(const rel of Object.values(B.OUT))assert.equal(fs.existsSync(path.join(dir,rel)),false,(label||'')+' wrote '+rel);};
function evaluate(moduleText){const out={};new Function('out',moduleText.replace(/^export const (\w+)=/gm,'out.$1='))(out);return out;}

test('whitelist: the 18 historical baseline paths plus exactly 2 added scripts = 20; 13 authorized originals may change, 5 stay SHA-protected',()=>{
 assert.deepEqual([...B.BASELINE_PATHS],OLD18);assert.equal(B.BASELINE_PATHS.length,18);
 assert.deepEqual([...BASELINE.keys()],OLD18,'input/BROWSER-BASELINE.json lists exactly the 18 baseline paths, in this order');
 assert.deepEqual([...B.ADDED],NEW2);assert.equal(B.ADDED.length,2);
 assert.deepEqual([...B.ASSET_PATHS],ALL20);assert.equal(B.ASSET_PATHS.length,20);assert.equal(new Set(B.ASSET_PATHS).size,20);
 assert.deepEqual([...B.ASSET_PATHS],[...OLD18,...NEW2].sort(),'the whitelist is the two fixed lists and nothing else');
 assert.deepEqual([...B.CHANGED],CHANGED13);assert.equal(new Set(B.CHANGED).size,13);
 assert.deepEqual([...B.PROTECTED],PROTECTED5);
 assert.deepEqual(OLD18.filter(p=>!CHANGED13.includes(p)),PROTECTED5,'13 + 5 = the 18 baseline paths');
 // the historical files: every baseline path is pinned identically in the release; the added scripts have no history at all
 for(const p of OLD18)assert.equal(RELEASE.get('app/'+p),BASELINE.get(p),p);
 for(const p of NEW2){assert.equal(BASELINE.has(p),false,p);assert.equal(RELEASE.has('app/'+p),false,p);assert.equal(B.CHANGED.includes(p),false,p);assert.equal(B.BASELINE_PATHS.includes(p),false,p);}
 for(const list of [B.BASELINE_PATHS,B.ADDED,B.ASSET_PATHS,B.CHANGED,B.PROTECTED,B.INDEX_REFS,B.WORKSPACE_HOST_WIRING,B.WORKSPACE_HOST_WIRING.scripts])assert.equal(Object.isFrozen(list),true);
 assert.equal(B.BUILD,'PRIVATE-PILOT-5');
});

test('served map: root alias plus the 20 exact pathnames (21); protected assets pinned to the baseline; every source status is honest',t=>{
 const dir=fixture(t),r=B.compute({root:dir});
 assert.equal(r.served.size,21);
 assert.deepEqual([...r.served.keys()].sort(),['/',...ALL20.map(p=>'/'+p)].sort());
 assert.ok(r.served.get('/').bytes.equals(r.served.get('/index.html').bytes));
 assert.equal(r.served.get('/').sha256,r.served.get('/index.html').sha256);
 for(const [url,a] of r.served){assert.equal(B.sha256(a.bytes),a.sha256,url);assert.ok(a.mime,url);}
 for(const p of PROTECTED5)assert.equal(r.served.get('/'+p).sha256,BASELINE.get(p),p);
 for(const p of NEW2){assert.ok(r.served.get('/'+p).bytes.equals(fs.readFileSync(at(dir,p))),p);assert.equal(r.served.get('/'+p).mime,JS_MIME,p);}
 for(const url of r.served.keys())assert.ok(!/server|provider|prompt|contract|\.cjs|\.mjs|\.log|\.env|key/i.test(url),url);
 // the hash record: one row per asset, in whitelist order
 assert.deepEqual(r.manifest.sources.map(s=>s.path),ALL20);
 for(const s of r.manifest.sources){
  const bytes=fs.readFileSync(at(dir,s.path));
  assert.deepEqual(Object.keys(s),['path','bytes','sha256','baselineSha256','status'],s.path);
  assert.equal(s.sha256,B.sha256(bytes),s.path);assert.equal(s.bytes,bytes.length,s.path);
  if(NEW2.includes(s.path)){assert.equal(s.baselineSha256,null,s.path+' has no historical hash');assert.equal(s.status,'added',s.path);continue;}
  assert.equal(s.baselineSha256,BASELINE.get(s.path),s.path+' keeps its historical pin');
  assert.equal(s.status,s.sha256===BASELINE.get(s.path)?'baseline':'changed',s.path);
  if(s.status==='changed')assert.ok(CHANGED13.includes(s.path),s.path+' differs from the baseline without being authorized');
  if(PROTECTED5.includes(s.path))assert.equal(s.status,'baseline',s.path);
 }
 assert.deepEqual(r.manifest.sources.filter(s=>s.status==='added').map(s=>s.path),NEW2);
 assert.deepEqual(r.manifest.changedAllowed,CHANGED13);assert.deepEqual(r.manifest.addedAssets,NEW2);
 assert.equal(r.manifest.baselineFileSha256,B.sha256(fs.readFileSync(path.join(ROOT,'input/BROWSER-BASELINE.json'))));
 assert.equal(r.manifest.served.length,21);assert.equal(r.manifest.build,'PRIVATE-PILOT-5');
});

test('shell manifest excludes generated worker bytes; pin covers manifest AND raw template; no hash recursion; both added scripts are offline entries',t=>{
 const dir=fixture(t),r=B.compute({root:dir});
 assert.equal(r.shell.length,20);
 assert.deepEqual(r.shell.map(e=>e.url).sort(),['/',...ALL20.filter(p=>p!=='sw.js').map(p=>'/'+p)].sort());
 assert.ok(!r.shell.some(e=>e.url==='/sw.js'));
 for(const e of r.shell){assert.deepEqual(Object.keys(e),['url','sha256','mime']);assert.equal(e.sha256,r.served.get(e.url).sha256);assert.equal(e.mime,r.served.get(e.url).mime);}
 for(const p of NEW2)assert.deepEqual(r.shell.filter(e=>e.url==='/'+p),[{url:'/'+p,sha256:B.sha256(fs.readFileSync(at(dir,p))),mime:JS_MIME}],p+' is cached for offline use with its byte hash');
 for(const e of r.shell)assert.ok(!/^\/(api|_auth|cdn-cgi)(\/|$)/.test(e.url),e.url);
 assert.equal(r.pin,B.sha256(Buffer.concat([Buffer.from(JSON.stringify(r.shell),'utf8'),Buffer.from('\n'),r.sources.get('sw.js').bytes])));
 assert.equal(r.cacheName,'empire-private-shell-v1-'+r.pin);
 assert.ok(r.swText.includes("'"+r.pin+"'")&&r.swText.includes(r.shellJson));
 assert.ok(!r.swText.includes(B.PH_PIN)&&!r.swText.includes(B.PH_MANIFEST));
 assert.equal(r.served.get('/sw.js').sha256,B.sha256(Buffer.from(r.swText,'utf8')));
 assert.equal(r.served.get('/sw.js').sha256,r.swSha);
 assert.ok(!r.swText.includes(r.swSha),'the worker does not contain its own hash');
 assert.notEqual(r.swSha,r.manifest.serviceWorker.templateSha256);
});

test('worker-only and shell changes both isolate the new cache identity; an added script is part of the pin; the build remains deterministic',t=>{
 const dir=fixture(t),a=B.compute({root:dir}),again=B.compute({root:dir});
 assert.equal(again.manifestJson,a.manifestJson);assert.equal(again.assetsModule,a.assetsModule);assert.equal(again.promptModule,a.promptModule);
 fs.appendFileSync(at(dir,'sw.js'),'\n// worker-only change\n');
 const b=B.compute({root:dir});
 assert.notEqual(b.pin,a.pin);assert.notEqual(b.cacheName,a.cacheName);assert.equal(b.shellJson,a.shellJson);assert.notEqual(b.swSha,a.swSha);
 fs.appendFileSync(at(dir,'ui.js'),'\n// shell change\n');
 const c=B.compute({root:dir});
 assert.notEqual(c.pin,a.pin);assert.notEqual(c.cacheName,a.cacheName);
 for(const p of NEW2){
  const d=fixture(t),before=B.compute({root:d});fs.appendFileSync(at(d,p),'\n// added-script change\n');
  const after=B.compute({root:d}),bytes=fs.readFileSync(at(d,p));
  assert.equal(before.pin,a.pin,'same tree, same pin');assert.notEqual(after.pin,before.pin,p);assert.notEqual(after.cacheName,before.cacheName,p);
  assert.equal(after.served.get('/'+p).sha256,B.sha256(bytes),p);assert.equal(after.shell.find(e=>e.url==='/'+p).sha256,B.sha256(bytes),p);
  const row=after.manifest.sources.find(s=>s.path===p);assert.equal(row.status,'added');assert.equal(row.baselineSha256,null);
 }
});

test('refuses a modified protected asset: each of the 5, exactly, and nothing is written',t=>{
 for(const p of PROTECTED5){
  const d=fixture(t);fs.appendFileSync(at(d,p),' ');
  assert.throws(()=>B.compute({root:d}),exactly('protected asset modified: '+p),p);
  assert.throws(()=>B.build({root:d}),exactly('protected asset modified: '+p),p);
  nothingWritten(d,p);
 }
 // replacing a protected file with other bytes of the same length is refused as well
 const d=fixture(t),icon=fs.readFileSync(at(d,'workspace/icon.svg'));icon[icon.length-1]^=1;fs.writeFileSync(at(d,'workspace/icon.svg'),icon);
 assert.throws(()=>B.compute({root:d}),exactly('protected asset modified: workspace/icon.svg'));
});

test('each of the 13 authorized originals may change: reported as changed with its historical pin, and it moves the cache identity',t=>{
 const dir=fixture(t);let last=B.compute({root:dir});
 for(const p of CHANGED13){
  fs.appendFileSync(at(dir,p),'\n');
  const r=B.compute({root:dir}),bytes=fs.readFileSync(at(dir,p)),row=r.manifest.sources.find(s=>s.path===p);
  assert.equal(row.status,'changed',p);assert.equal(row.sha256,B.sha256(bytes),p);assert.notEqual(row.sha256,BASELINE.get(p),p);
  assert.equal(row.baselineSha256,BASELINE.get(p),p+': the historical pin is still reported');
  if(p!=='sw.js'){assert.equal(r.served.get('/'+p).sha256,B.sha256(bytes),p);assert.ok(r.served.get('/'+p).bytes.equals(bytes),p);}
  assert.notEqual(r.pin,last.pin,p);assert.notEqual(r.cacheName,last.cacheName,p);last=r;
 }
 // the five protected rows never moved while the thirteen changed
 for(const p of PROTECTED5)assert.equal(last.manifest.sources.find(s=>s.path===p).status,'baseline',p);
});

test('workspace/mobile.html must keep its host wiring: stylesheet, /sw.js, and the four trailing host scripts exactly once, in order, bridge last',t=>{
 const dir=fixture(t),a=B.compute({root:dir}),file=at(dir,'workspace/mobile.html'),html=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
 const W=B.WORKSPACE_HOST_WIRING,TAIL='</html>\n\n'+HOST_TAGS.join('\n');
 assert.equal(W.tail,TAIL);assert.deepEqual([...W.scripts],['/workspace/handoff.js','/workspace/material-edit.js','/workspace/host-core.js','/workspace/assistant-bridge.js']);
 assert.ok(html.trimEnd().endsWith(TAIL),'the hosted page does not end with the four host script tags (bridge after host-core.js)');
 for(const tag of HOST_TAGS)assert.equal(html.split(tag).length-1,1,tag);
 // a content change inside the page is accepted, reported as changed and moves the cache identity
 assert.ok(html.includes('<body>'));fs.writeFileSync(file,html.replace('<body>','<body><!-- x -->'));
 const b=B.compute({root:dir}),bytes=fs.readFileSync(file);
 assert.equal(b.served.get('/workspace/mobile.html').sha256,B.sha256(bytes));
 assert.ok(b.served.get('/workspace/mobile.html').bytes.equals(bytes));
 assert.equal(b.manifest.sources.find(s=>s.path==='workspace/mobile.html').status,'changed');
 assert.equal(b.manifest.sources.find(s=>s.path==='workspace/mobile.html').baselineSha256,BASELINE.get('workspace/mobile.html'),'the historical pin is still reported');
 assert.notEqual(b.pin,a.pin);assert.notEqual(b.cacheName,a.cacheName);
 // losing, reordering or repeating any part of the host wiring is refused, and nothing is written
 const [HANDOFF,EDIT,CORE,BRIDGE]=HOST_TAGS,tail=order=>'</html>\n\n'+order.join('\n');
 const LOST=/workspace\/mobile\.html lost the trailing host scripts/;
 for(const [label,broken,re] of [
  ['stylesheet',html.replace(W.stylesheet,'</head>'),/workspace\/mobile\.html lost the host stylesheet link/],
  ['sw',html.replace(W.worker,"navigator.serviceWorker.register('sw.js')"),/workspace\/mobile\.html lost the \/sw\.js registration/],
  ['bridge missing (the PRIVATE-PILOT-4 tail)',html.replace(TAIL,tail([HANDOFF,EDIT,CORE])),LOST],
  ['host-core missing',html.replace(TAIL,tail([HANDOFF,EDIT,BRIDGE])),LOST],
  ['handoff missing',html.replace(TAIL,tail([EDIT,CORE,BRIDGE])),LOST],
  ['bridge before host-core',html.replace(TAIL,tail([HANDOFF,EDIT,BRIDGE,CORE])),LOST],
  ['bridge first',html.replace(TAIL,tail([BRIDGE,HANDOFF,EDIT,CORE])),LOST],
  ['handoff / material-edit swapped',html.replace(TAIL,tail([EDIT,HANDOFF,CORE,BRIDGE])),LOST],
  ['bridge before </html>',html.replace(TAIL,BRIDGE+'\n'+tail([HANDOFF,EDIT,CORE])),LOST],
  ['extra trailing script',html.trimEnd()+'\n<script src="/workspace/extra.js"></script>\n',LOST],
  ['bridge loaded twice',html.replace(TAIL,BRIDGE+'\n'+TAIL),/must load each host script exactly once: \/workspace\/assistant-bridge\.js/],
  ['bridge also loaded deferred',html.replace(TAIL,'<script src="/workspace/assistant-bridge.js" defer></script>\n'+TAIL),/must load each host script exactly once: \/workspace\/assistant-bridge\.js/],
  ['host-core loaded twice',html.replace('<body>','<body>'+CORE),/must load each host script exactly once: \/workspace\/host-core\.js/]
 ]){
  assert.notEqual(broken,html,label+': the mutation did not apply');
  const d=fixture(t);fs.writeFileSync(at(d,'workspace/mobile.html'),broken);
  assert.throws(()=>B.build({root:d}),refused(re),label);
  nothingWritten(d,label);
 }
});

test('index.html must load /assistant-session.js exactly once and before /conversation-bank.js and /ui.js; it never loads the frame bridge',t=>{
 const html=fs.readFileSync(path.join(ROOT,'candidate/browser/index.html'),'utf8');
 const tagOf=(text,src)=>{const m=text.match(new RegExp('<script\\b[^>]*\\ssrc="'+src.replace(/[.\/]/g,'\\$&')+'"[^>]*></script>'));assert.ok(m,'index.html has no script tag for '+src);return m[0];};
 const srcs=[...html.matchAll(/<script\b[^>]*\ssrc="([^"]*)"/g)].map(m=>m[1]);
 // the page as shipped
 assert.equal(srcs.filter(s=>s==='/assistant-session.js').length,1);
 assert.ok(srcs.indexOf('/assistant-session.js')<srcs.indexOf('/conversation-bank.js'),'assistant-session.js before conversation-bank.js');
 assert.ok(srcs.indexOf('/assistant-session.js')<srcs.indexOf('/ui.js'),'assistant-session.js before ui.js');
 assert.ok(!srcs.includes('/workspace/assistant-bridge.js'),'the bridge belongs to the workspace frame only');
 assert.deepEqual([...B.INDEX_REFS],['/style.css','/handoff-session.js','/assistant-session.js','/conversation-bank.js','/draft-recovery.js','/ui.js','/material-edit-host.js','/workspace-host.js','/workspace/mobile.html']);
 assert.deepEqual(B.INDEX_SCRIPT_ORDER.map(p=>[...p]),[['/assistant-session.js','/conversation-bank.js'],['/assistant-session.js','/ui.js']]);
 for(const r of B.INDEX_REFS)assert.ok(html.includes('"'+r+'"'),r);
 const session=tagOf(html,'/assistant-session.js'),without=html.replace(session,'');
 const after=src=>{const tag=tagOf(without,src);return without.replace(tag,tag+session);};
 const BEFORE=/index\.html must load \/assistant-session\.js before \/(conversation-bank|ui)\.js/;
 for(const [label,broken,re] of [
  ['script missing',without,/index\.html lost the reference to: \/assistant-session\.js/],
  ['after ui.js',after('/ui.js'),BEFORE],
  ['after conversation-bank.js, before ui.js',after('/conversation-bank.js'),/must load \/assistant-session\.js before \/conversation-bank\.js/],
  ['loaded twice',html.replace(session,session+session),/index\.html must load exactly once: \/assistant-session\.js/],
  ['async',html.replace(session,'<script src="/assistant-session.js" async></script>'),BEFORE],
  ['deferred while its consumer blocks',html.replace(session,'<script src="/assistant-session.js" defer></script>').replace(tagOf(html,'/conversation-bank.js'),'<script src="/conversation-bank.js"></script>'),/must load \/assistant-session\.js before \/conversation-bank\.js/],
  ['conversation-bank.js loaded twice',html.replace(tagOf(html,'/conversation-bank.js'),m=>m+m),/index\.html must load exactly once: \/conversation-bank\.js/],
  ['bridge in the main page',html.replace('</head>','<script src="/workspace/assistant-bridge.js" defer></script></head>'),/index\.html must not load a workspace-frame script: \/workspace\/assistant-bridge\.js/],
  ['unknown script',html.replace('</body>','<script src="/other.js"></script></body>'),/unknown path: \/other\.js/],
  ['a stale build label beside the current one',html.replace('</body>','<p>PRIVATE-PILOT-4</p></body>'),/index\.html carries a stale build label: PRIVATE-PILOT-4/],
  ['no current build label',html.split('PRIVATE-PILOT-5').join('PRIVATE-PILOT-4'),/index\.html does not carry the build label/]
 ]){
  assert.notEqual(broken,html,label+': the mutation did not apply');
  const d=fixture(t);fs.writeFileSync(at(d,'index.html'),broken);
  assert.throws(()=>B.build({root:d}),refused(re),label);
  nothingWritten(d,label);
 }
});

test('refuses an absent asset, including either added script',t=>{
 for(const p of ['workspace/icon.svg','ui.js',...NEW2]){
  const d=fixture(t);fs.rmSync(at(d,p));
  assert.throws(()=>B.build({root:d}),exactly('missing asset: '+p),p);
  nothingWritten(d,p);
 }
 // an empty added script is not an asset either
 for(const p of NEW2){const d=fixture(t);fs.writeFileSync(at(d,p),'');assert.throws(()=>B.build({root:d}),exactly('added asset is empty: '+p),p);nothingWritten(d,p);}
});

test('refuses symlinks, also when they point at identical bytes',t=>{
 const dir=fixture(t),real=path.join(dir,'icon-copy.svg');
 fs.renameSync(at(dir,'workspace/icon.svg'),real);fs.symlinkSync(real,at(dir,'workspace/icon.svg'));
 assert.throws(()=>B.compute({root:dir}),refused(/symlink refused: workspace\/icon\.svg/));
 const dir2=fixture(t),moved=path.join(dir2,'workspace-real');
 fs.renameSync(at(dir2,'workspace'),moved);fs.symlinkSync(moved,at(dir2,'workspace'));
 assert.throws(()=>B.compute({root:dir2}),refused(/symlink refused: workspace/));
 for(const p of NEW2){
  const d=fixture(t),copy=path.join(d,'added-copy.js');
  fs.renameSync(at(d,p),copy);fs.symlinkSync(copy,at(d,p));
  assert.throws(()=>B.build({root:d}),exactly('symlink refused: '+p),p);nothingWritten(d,p);
 }
});

test('refuses unknown files and directories; a third new asset is not accepted under any name',t=>{
 const dir=fixture(t);fs.writeFileSync(at(dir,'extra.js'),'1');
 assert.throws(()=>B.compute({root:dir}),refused(/unknown file: extra\.js/));
 const dir2=fixture(t);fs.writeFileSync(at(dir2,'workspace/server.cjs'),'1');
 assert.throws(()=>B.compute({root:dir2}),refused(/unknown file: workspace\/server\.cjs/));
 const dir3=fixture(t);fs.mkdirSync(at(dir3,'logs'));
 assert.throws(()=>B.compute({root:dir3}),refused(/unknown directory: logs/));
 // the whitelist grew by exactly two fixed paths, not by a pattern
 for(const [p,from] of [['assistant-tools.js','assistant-session.js'],['assistant-session.min.js','assistant-session.js'],['assistant-bridge.js','workspace/assistant-bridge.js'],['workspace/assistant-session.js','assistant-session.js'],['workspace/assistant-bridge-2.js','workspace/assistant-bridge.js'],['workspace/assistant-bridge.js.map','workspace/assistant-bridge.js']]){
  const d=fixture(t);fs.copyFileSync(at(d,from),at(d,p));
  assert.throws(()=>B.build({root:d}),exactly('unknown file: '+p),p);nothingWritten(d,p);
 }
 // a directory in the place of an added script, and a new directory holding one
 const d4=fixture(t);fs.rmSync(at(d4,'assistant-session.js'));fs.mkdirSync(at(d4,'assistant-session.js'));
 assert.throws(()=>B.compute({root:d4}),exactly('unknown directory: assistant-session.js'));
 const d5=fixture(t);fs.mkdirSync(at(d5,'assistant'));fs.copyFileSync(at(d5,'assistant-session.js'),at(d5,'assistant/session.js'));
 assert.throws(()=>B.compute({root:d5}),exactly('unknown directory: assistant'));
});

test('refuses a worker template without exactly one of each placeholder',t=>{
 const dir=fixture(t),src=fs.readFileSync(at(dir,'sw.js'),'utf8');
 assert.equal(src.split(B.PH_PIN).length-1,1);assert.equal(src.split(B.PH_MANIFEST).length-1,1);
 fs.writeFileSync(at(dir,'sw.js'),src+'\n// '+B.PH_PIN+'\n');
 assert.throws(()=>B.compute({root:dir}),refused(/placeholder/));
 fs.writeFileSync(at(dir,'sw.js'),src.replace(B.PH_MANIFEST,'[]'));
 assert.throws(()=>B.compute({root:dir}),refused(/placeholder/));
 fs.writeFileSync(at(dir,'sw.js'),src.replace(B.PH_PIN,'pin'));
 assert.throws(()=>B.compute({root:dir}),refused(/placeholder/));
 fs.writeFileSync(at(dir,'sw.js'),src+'\n// '+B.PH_MANIFEST+'\n');
 assert.throws(()=>B.build({root:dir}),refused(/placeholder/));nothingWritten(dir,'placeholder');
});

test('refuses invalid UTF-8 in every text file the build interprets, including both added scripts',t=>{
 for(const p of ['index.html','workspace/mobile.html','sw.js',...NEW2]){
  const d=fixture(t);fs.appendFileSync(at(d,p),Buffer.from([0x0a,0xff,0xfe,0x0a]));
  assert.throws(()=>B.build({root:d}),exactly('not valid UTF-8: '+p),p);
  nothingWritten(d,p);
 }
});

test('refuses a prompt that differs from the historical release pin',t=>{
 const dir=fixture(t);fs.appendFileSync(path.join(dir,'input/online-prompt.txt'),' ');
 assert.throws(()=>B.build({root:dir}),refused(/online-prompt\.txt does not match the release pin/));nothingWritten(dir,'prompt');
 const dir2=fixture(t);fs.rmSync(path.join(dir2,'input/online-prompt.txt'));
 assert.throws(()=>B.build({root:dir2}),refused(/missing file: input\/online-prompt\.txt/));nothingWritten(dir2,'prompt missing');
});

test('the historical baseline and release pins are evidence: an edited, added, removed, renamed or reordered entry is refused',t=>{
 const flip=h=>(h[0]==='0'?'1':'0')+h.slice(1);
 const row=(list,p)=>{const r=list.find(x=>x[0]===p);assert.ok(r,p);return r;};
 const sessionSha=B.sha256(fs.readFileSync(path.join(ROOT,'candidate/browser/assistant-session.js')));
 const LIST=/baseline does not list exactly the 18 baseline paths/;
 const cases=[
  // input/BROWSER-BASELINE.json alone
  ['baseline: an added script given its real hash','BROWSER-BASELINE.json',b=>{b.push(['assistant-session.js',sessionSha]);},LIST],
  ['baseline: an added script given an invented hash','BROWSER-BASELINE.json',b=>{b.splice(9,0,['workspace/assistant-bridge.js','a'.repeat(64)]);},LIST],
  ['baseline: an entry removed','BROWSER-BASELINE.json',b=>{b.pop();},LIST],
  ['baseline: a protected entry removed','BROWSER-BASELINE.json',b=>{b.splice(b.indexOf(row(b,'workspace/icon-192.png')),1);},LIST],
  ['baseline: an entry renamed','BROWSER-BASELINE.json',b=>{row(b,'ui.js')[0]='ui2.js';},LIST],
  ['baseline: an entry replaced by an added script','BROWSER-BASELINE.json',b=>{row(b,'workspace/manifest.json')[0]='workspace/assistant-bridge.js';},LIST],
  ['baseline: reordered','BROWSER-BASELINE.json',b=>{b.reverse();},LIST],
  ['baseline: empty','BROWSER-BASELINE.json',b=>{b.length=0;},LIST],
  ['baseline: a protected pin rewritten','BROWSER-BASELINE.json',b=>{const r=row(b,'workspace/icon.svg');r[1]=flip(r[1]);},/baseline and release pins disagree: workspace\/icon\.svg/],
  ['baseline: the pin of a changeable file rewritten','BROWSER-BASELINE.json',b=>{const r=row(b,'ui.js');r[1]=flip(r[1]);},/baseline and release pins disagree: ui\.js/],
  ['baseline: a malformed hash','BROWSER-BASELINE.json',b=>{row(b,'style.css')[1]='not-a-hash';},/malformed hash list: input\/BROWSER-BASELINE\.json/],
  ['baseline: a duplicated path','BROWSER-BASELINE.json',b=>{b.push(b[0].slice());},/duplicate path in hash list: input\/BROWSER-BASELINE\.json/],
  // input/RELEASE.json alone
  ['release: a protected pin rewritten','RELEASE.json',r=>{const x=row(r.pairs,'app/workspace/manifest.json');x[1]=flip(x[1]);},/baseline and release pins disagree: workspace\/manifest\.json/],
  ['release: a baseline pin removed','RELEASE.json',r=>{r.pairs.splice(r.pairs.indexOf(row(r.pairs,'app/style.css')),1);},/baseline and release pins disagree: style\.css/],
  ['release: an added script given a historical pin','RELEASE.json',r=>{r.pairs.push(['app/assistant-session.js',sessionSha]);},/added asset has a historical release pin: assistant-session\.js/],
  ['release: the prompt pin rewritten','RELEASE.json',r=>{const x=row(r.pairs,'app/online-prompt.txt');x[1]=flip(x[1]);},/online-prompt\.txt does not match the release pin/]
 ];
 for(const [label,file,edit,re] of cases){
  const d=fixture(t),f=path.join(d,'input',file),json=JSON.parse(fs.readFileSync(f,'utf8'));
  edit(json);fs.writeFileSync(f,JSON.stringify(json,null,2)+'\n');
  assert.throws(()=>B.build({root:d}),refused(re),label);
  nothingWritten(d,label);
 }
 // both historical files rewritten consistently for a protected asset: its untouched bytes no longer match, so it is still refused
 const d=fixture(t);
 for(const [file,key,list] of [['BROWSER-BASELINE.json','workspace/icon-512.png',j=>j],['RELEASE.json','app/workspace/icon-512.png',j=>j.pairs]]){
  const f=path.join(d,'input',file),json=JSON.parse(fs.readFileSync(f,'utf8'));row(list(json),key)[1]='f'.repeat(64);fs.writeFileSync(f,JSON.stringify(json,null,2)+'\n');
 }
 assert.throws(()=>B.build({root:d}),exactly('protected asset modified: workspace/icon-512.png'));nothingWritten(d,'consistent rewrite');
 // not JSON at all
 for(const file of ['BROWSER-BASELINE.json','RELEASE.json']){
  const d2=fixture(t);fs.writeFileSync(path.join(d2,'input',file),'{');
  assert.throws(()=>B.build({root:d2}),exactly('unreadable input/'+file),file);nothingWritten(d2,file);
 }
});

test('writes the generated modules and the manifest outside the served assets; both added scripts round-trip byte for byte; inputs and template stay untouched',t=>{
 const dir=fixture(t),template=fs.readFileSync(at(dir,'sw.js'));
 const r=B.build({root:dir});
 assert.ok(fs.readFileSync(at(dir,'sw.js')).equals(template));
 for(const f of INPUTS)assert.ok(fs.readFileSync(path.join(dir,'input',f)).equals(fs.readFileSync(path.join(ROOT,'input',f))),'the build never writes input/'+f);
 for(const rel of Object.values(B.OUT))assert.ok(!rel.startsWith('candidate/browser/'),rel);
 const assetsText=fs.readFileSync(path.join(dir,B.OUT.assets),'utf8'),promptText=fs.readFileSync(path.join(dir,B.OUT.prompt),'utf8');
 assert.match(assetsText,/^export const BUILD="PRIVATE-PILOT-5";$/m);assert.match(assetsText,/^export const ASSETS=\{$/m);
 assert.ok(assetsText.startsWith('// GENERATED by candidate/build.cjs (PRIVATE-PILOT-5). Do not edit.\n'));
 const mod=evaluate(assetsText);
 assert.equal(mod.BUILD,'PRIVATE-PILOT-5');
 assert.equal(Object.keys(mod.ASSETS).length,21);
 assert.deepEqual(Object.keys(mod.ASSETS).sort(),['/',...ALL20.map(p=>'/'+p)].sort());
 assert.deepEqual(Object.keys(mod.ASSETS).sort(),[...r.served.keys()].sort());
 for(const [url,a] of Object.entries(mod.ASSETS)){
  assert.deepEqual(Object.keys(a),['base64','mime','sha256']);
  assert.equal(B.sha256(Buffer.from(a.base64,'base64')),a.sha256,url);assert.equal(a.sha256,r.served.get(url).sha256,url);
 }
 assert.equal(mod.ASSETS['/'].base64,mod.ASSETS['/index.html'].base64);
 // the generated worker carries the offline manifest; each added script is in ASSETS and in that manifest with the hash of its file
 const worker=Buffer.from(mod.ASSETS['/sw.js'].base64,'base64').toString('utf8');
 assert.equal(worker,r.swText);assert.ok(worker.includes(r.shellJson));assert.equal(JSON.parse(r.shellJson).length,20);
 for(const p of NEW2){
  const bytes=fs.readFileSync(at(dir,p)),a=mod.ASSETS['/'+p],entry={url:'/'+p,sha256:B.sha256(bytes),mime:JS_MIME};
  assert.ok(bytes.equals(fs.readFileSync(path.join(ROOT,'candidate/browser',p))),p+' is the checkpoint file');
  assert.ok(Buffer.from(a.base64,'base64').equals(bytes),p+' ASSETS bytes');assert.equal(a.sha256,B.sha256(bytes),p);assert.equal(a.mime,JS_MIME,p);
  assert.deepEqual(JSON.parse(r.shellJson).filter(e=>e.url==='/'+p),[entry],p+' offline manifest entry');
  assert.ok(worker.includes(JSON.stringify(entry)),p+' is in the manifest embedded in the generated worker');
 }
 assert.equal(evaluate(promptText).PROMPT,fs.readFileSync(path.join(dir,'input/online-prompt.txt'),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,B.OUT.manifest),'utf8'));
 assert.equal(manifest.build,'PRIVATE-PILOT-5');assert.equal(manifest.shellPin,r.pin);
 assert.equal(manifest.sources.length,20);assert.equal(manifest.served.length,21);assert.equal(manifest.shell.length,20);
 assert.deepEqual(manifest.sources.filter(s=>s.status==='added').map(s=>[s.path,s.baselineSha256]),NEW2.map(p=>[p,null]));
 assert.deepEqual(manifest.sources.filter(s=>s.baselineSha256!==null).map(s=>s.path),OLD18);
 assert.equal(manifest.outputs.find(o=>o.path===B.OUT.assets).sha256,B.sha256(Buffer.from(assetsText,'utf8')));
 assert.equal(manifest.outputs.find(o=>o.path===B.OUT.prompt).sha256,B.sha256(Buffer.from(promptText,'utf8')));
 assert.ok(!Object.keys(mod.ASSETS).some(k=>k.includes('generated')||k.includes('manifest.generated')));
 // a second build of the same tree writes the same bytes
 const dirB=fixture(t);B.build({root:dirB});
 for(const rel of Object.values(B.OUT))assert.ok(fs.readFileSync(path.join(dirB,rel)).equals(fs.readFileSync(path.join(dir,rel))),rel+' is deterministic');
 // --check style run writes nothing
 const dir2=fixture(t);B.build({root:dir2,write:false});assert.equal(fs.existsSync(path.join(dir2,'candidate/server')),false);nothingWritten(dir2,'--check');
});
