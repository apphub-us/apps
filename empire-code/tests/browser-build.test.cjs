'use strict';
// Build whitelist, baseline pins and service-worker pin. Local temp copies only; no network. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),B=require('../candidate/build.cjs');
const BASELINE=new Map(JSON.parse(fs.readFileSync(path.join(ROOT,'input/BROWSER-BASELINE.json'),'utf8')));

// A clean copy of the 18 whitelisted files and the three inputs; the checkpoint itself is never modified by a test.
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ec-build-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const p of B.ASSET_PATHS){const to=path.join(dir,'candidate/browser',p);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(ROOT,'candidate/browser',p),to);}
 fs.mkdirSync(path.join(dir,'input'));
 for(const f of ['BROWSER-BASELINE.json','RELEASE.json','online-prompt.txt'])fs.copyFileSync(path.join(ROOT,'input',f),path.join(dir,'input',f));
 return dir;
}
const at=(dir,p)=>path.join(dir,'candidate/browser',p);
const refused=re=>e=>e.code==='EC_BUILD_REFUSED'&&re.test(e.message);
function evaluate(moduleText){const out={};new Function('out',moduleText.replace(/^export const (\w+)=/gm,'out.$1='))(out);return out;}

test('whitelist is exactly the 18 baseline paths; only four files may change (the three shell files and, since CONVERTER-WH-1, workspace/mobile.html)',()=>{
 assert.equal(B.ASSET_PATHS.length,18);
 assert.deepEqual([...B.ASSET_PATHS].sort(),[...BASELINE.keys()].sort());
 assert.deepEqual([...B.CHANGED].sort(),['index.html','sw.js','ui.js','workspace/mobile.html']);
 // the other 14 assets stay pinned, byte for byte, to the historical baseline
 assert.equal(B.ASSET_PATHS.filter(p=>!B.CHANGED.includes(p)).length,14);
 assert.equal(B.BUILD,'PRIVATE-PILOT-4');
});

test('served map: root alias plus the 18 exact pathnames, unchanged assets pinned to the baseline',t=>{
 const r=B.compute({root:fixture(t)});
 assert.deepEqual([...r.served.keys()].sort(),['/',...B.ASSET_PATHS.map(p=>'/'+p)].sort());
 assert.ok(r.served.get('/').bytes.equals(r.served.get('/index.html').bytes));
 assert.equal(r.served.get('/').sha256,r.served.get('/index.html').sha256);
 for(const [url,a] of r.served){assert.equal(B.sha256(a.bytes),a.sha256,url);assert.ok(a.mime,url);}
 for(const p of B.ASSET_PATHS)if(!B.CHANGED.includes(p))assert.equal(r.served.get('/'+p).sha256,BASELINE.get(p),p);
 for(const url of r.served.keys())assert.ok(!/server|provider|prompt|contract|\.cjs|\.mjs|\.log|\.env|key/i.test(url),url);
 assert.equal(r.manifest.sources.filter(s=>s.status==='changed').every(s=>B.CHANGED.includes(s.path)),true);
});

test('shell manifest excludes generated worker bytes; pin covers manifest AND raw template; no hash recursion',t=>{
 const r=B.compute({root:fixture(t)});
 assert.equal(r.shell.length,18);
 assert.deepEqual(r.shell.map(e=>e.url).sort(),['/',...B.ASSET_PATHS.filter(p=>p!=='sw.js').map(p=>'/'+p)].sort());
 assert.ok(!r.shell.some(e=>e.url==='/sw.js'));
 for(const e of r.shell){assert.deepEqual(Object.keys(e),['url','sha256','mime']);assert.equal(e.sha256,r.served.get(e.url).sha256);assert.equal(e.mime,r.served.get(e.url).mime);}
 assert.equal(r.pin,B.sha256(Buffer.concat([Buffer.from(JSON.stringify(r.shell),'utf8'),Buffer.from('\n'),r.sources.get('sw.js').bytes])));
 assert.equal(r.cacheName,'empire-private-shell-v1-'+r.pin);
 assert.ok(r.swText.includes("'"+r.pin+"'")&&r.swText.includes(r.shellJson));
 assert.ok(!r.swText.includes(B.PH_PIN)&&!r.swText.includes(B.PH_MANIFEST));
 assert.equal(r.served.get('/sw.js').sha256,B.sha256(Buffer.from(r.swText,'utf8')));
 assert.equal(r.served.get('/sw.js').sha256,r.swSha);
 assert.ok(!r.swText.includes(r.swSha),'the worker does not contain its own hash');
 assert.notEqual(r.swSha,r.manifest.serviceWorker.templateSha256);
});

test('worker-only and shell changes both isolate the new cache identity; the build remains deterministic',t=>{
 const dir=fixture(t),a=B.compute({root:dir});
 assert.equal(B.compute({root:dir}).manifestJson,a.manifestJson);
 fs.appendFileSync(at(dir,'sw.js'),'\n// worker-only change\n');
 const b=B.compute({root:dir});
 assert.notEqual(b.pin,a.pin);assert.notEqual(b.cacheName,a.cacheName);assert.equal(b.shellJson,a.shellJson);assert.notEqual(b.swSha,a.swSha);
 fs.appendFileSync(at(dir,'ui.js'),'\n// shell change\n');
 const c=B.compute({root:dir});
 assert.notEqual(c.pin,a.pin);assert.notEqual(c.cacheName,a.cacheName);
});

test('refuses a modified protected asset',t=>{
 const dir=fixture(t);fs.appendFileSync(at(dir,'style.css'),'\n/* x */');
 assert.throws(()=>B.compute({root:dir}),refused(/protected asset modified: style\.css/));
 // CONVERTER-WH-1: workspace/mobile.html left the protected set, so the write-nothing check moved to a file that is still pinned.
 const dir2=fixture(t);fs.appendFileSync(at(dir2,'workspace/host-core.js'),' ');
 assert.throws(()=>B.build({root:dir2}),refused(/protected asset modified: workspace\/host-core\.js/));
 assert.equal(fs.existsSync(path.join(dir2,B.OUT.assets)),false,'nothing is written when the build is refused');
 // every other workspace file is still protected
 for(const p of ['workspace/handoff.js','workspace/host-core.css','workspace/material-edit.js','workspace/manifest.json']){
  const d=fixture(t);fs.appendFileSync(at(d,p),' ');
  assert.throws(()=>B.compute({root:d}),e=>e.code==='EC_BUILD_REFUSED'&&e.message==='build refused: protected asset modified: '+p,p);
 }
});

test('workspace/mobile.html may change, is hashed into the shell pin, and must keep its host wiring',t=>{
 const dir=fixture(t),a=B.compute({root:dir}),file=at(dir,'workspace/mobile.html'),html=fs.readFileSync(file,'utf8');
 // a content change inside the page is accepted, reported as changed and moves the cache identity
 fs.writeFileSync(file,html.replace('<body>','<body><!-- x -->'));
 const b=B.compute({root:dir}),bytes=fs.readFileSync(file);
 assert.equal(b.served.get('/workspace/mobile.html').sha256,B.sha256(bytes));
 assert.ok(b.served.get('/workspace/mobile.html').bytes.equals(bytes));
 assert.equal(b.manifest.sources.find(s=>s.path==='workspace/mobile.html').status,'changed');
 assert.equal(b.manifest.sources.find(s=>s.path==='workspace/mobile.html').baselineSha256,BASELINE.get('workspace/mobile.html'),'the historical pin is still reported');
 assert.notEqual(b.pin,a.pin);assert.notEqual(b.cacheName,a.cacheName);
 // losing any part of the host wiring is refused, and nothing is written
 const W=B.WORKSPACE_HOST_WIRING;
 for(const [label,broken] of [
  ['stylesheet',html.replace(W.stylesheet,'</head>')],
  ['sw',html.replace(W.worker,"navigator.serviceWorker.register('sw.js')")],
  ['host scripts',html.replace('<script src="/workspace/host-core.js"></script>','')],
  ['host scripts',html.trimEnd()+'\n<script src="/workspace/extra.js"></script>\n']
 ]){
  const d=fixture(t);fs.writeFileSync(at(d,'workspace/mobile.html'),broken);
  assert.throws(()=>B.build({root:d}),refused(/workspace\/mobile\.html lost the /),label);
  assert.equal(fs.existsSync(path.join(d,B.OUT.assets)),false,label);
 }
});

test('refuses an absent asset',t=>{
 const dir=fixture(t);fs.rmSync(at(dir,'workspace/icon.svg'));
 assert.throws(()=>B.compute({root:dir}),refused(/missing asset: workspace\/icon\.svg/));
 const dir2=fixture(t);fs.rmSync(at(dir2,'ui.js'));
 assert.throws(()=>B.compute({root:dir2}),refused(/missing asset: ui\.js/));
});

test('refuses symlinks, also when they point at identical bytes',t=>{
 const dir=fixture(t),real=path.join(dir,'icon-copy.svg');
 fs.renameSync(at(dir,'workspace/icon.svg'),real);fs.symlinkSync(real,at(dir,'workspace/icon.svg'));
 assert.throws(()=>B.compute({root:dir}),refused(/symlink refused: workspace\/icon\.svg/));
 const dir2=fixture(t),moved=path.join(dir2,'workspace-real');
 fs.renameSync(at(dir2,'workspace'),moved);fs.symlinkSync(moved,at(dir2,'workspace'));
 assert.throws(()=>B.compute({root:dir2}),refused(/symlink refused: workspace/));
});

test('refuses unknown files and directories',t=>{
 const dir=fixture(t);fs.writeFileSync(at(dir,'extra.js'),'1');
 assert.throws(()=>B.compute({root:dir}),refused(/unknown file: extra\.js/));
 const dir2=fixture(t);fs.writeFileSync(at(dir2,'workspace/server.cjs'),'1');
 assert.throws(()=>B.compute({root:dir2}),refused(/unknown file: workspace\/server\.cjs/));
 const dir3=fixture(t);fs.mkdirSync(at(dir3,'logs'));
 assert.throws(()=>B.compute({root:dir3}),refused(/unknown directory: logs/));
});

test('refuses a worker template without exactly one of each placeholder',t=>{
 const dir=fixture(t),src=fs.readFileSync(at(dir,'sw.js'),'utf8');
 assert.equal(src.split(B.PH_PIN).length-1,1);assert.equal(src.split(B.PH_MANIFEST).length-1,1);
 fs.writeFileSync(at(dir,'sw.js'),src+'\n// '+B.PH_PIN+'\n');
 assert.throws(()=>B.compute({root:dir}),refused(/placeholder/));
 fs.writeFileSync(at(dir,'sw.js'),src.replace(B.PH_MANIFEST,'[]'));
 assert.throws(()=>B.compute({root:dir}),refused(/placeholder/));
});

test('refuses a prompt that differs from the release pin and a page that references unknown paths',t=>{
 const dir=fixture(t);fs.appendFileSync(path.join(dir,'input/online-prompt.txt'),' ');
 assert.throws(()=>B.compute({root:dir}),refused(/online-prompt\.txt/));
 const dir2=fixture(t),html=fs.readFileSync(at(dir2,'index.html'),'utf8');
 fs.writeFileSync(at(dir2,'index.html'),html.replace('</body>','<script src="/other.js"></script></body>'));
 assert.throws(()=>B.compute({root:dir2}),refused(/unknown path: \/other\.js/));
});

test('writes the generated modules and the manifest outside the served assets; the template stays untouched',t=>{
 const dir=fixture(t),template=fs.readFileSync(at(dir,'sw.js'));
 const r=B.build({root:dir});
 assert.ok(fs.readFileSync(at(dir,'sw.js')).equals(template));
 for(const rel of Object.values(B.OUT))assert.ok(!rel.startsWith('candidate/browser/'),rel);
 const assetsText=fs.readFileSync(path.join(dir,B.OUT.assets),'utf8'),promptText=fs.readFileSync(path.join(dir,B.OUT.prompt),'utf8');
 assert.match(assetsText,/^export const BUILD="PRIVATE-PILOT-4";$/m);assert.match(assetsText,/^export const ASSETS=\{$/m);
 const mod=evaluate(assetsText);
 assert.equal(mod.BUILD,'PRIVATE-PILOT-4');
 assert.deepEqual(Object.keys(mod.ASSETS).sort(),[...r.served.keys()].sort());
 for(const [url,a] of Object.entries(mod.ASSETS)){
  assert.deepEqual(Object.keys(a),['base64','mime','sha256']);
  assert.equal(B.sha256(Buffer.from(a.base64,'base64')),a.sha256,url);assert.equal(a.sha256,r.served.get(url).sha256,url);
 }
 assert.equal(mod.ASSETS['/'].base64,mod.ASSETS['/index.html'].base64);
 assert.equal(evaluate(promptText).PROMPT,fs.readFileSync(path.join(dir,'input/online-prompt.txt'),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,B.OUT.manifest),'utf8'));
 assert.equal(manifest.build,'PRIVATE-PILOT-4');assert.equal(manifest.shellPin,r.pin);
 assert.equal(manifest.sources.length,18);assert.equal(manifest.served.length,19);
 assert.equal(manifest.outputs.find(o=>o.path===B.OUT.assets).sha256,B.sha256(Buffer.from(assetsText,'utf8')));
 assert.ok(!Object.keys(mod.ASSETS).some(k=>k.includes('generated')||k.includes('manifest.generated')));
 // --check style run writes nothing
 const dir2=fixture(t);B.build({root:dir2,write:false});assert.equal(fs.existsSync(path.join(dir2,'candidate/server')),false);
});
