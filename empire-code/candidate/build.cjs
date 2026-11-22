'use strict';
// Private-pilot browser build. Local files only: no network, no credentials, no dependencies.
//   node candidate/build.cjs          verify + write the generated files
//   node candidate/build.cjs --check  verify only, write nothing
// Reads   candidate/browser/** (exactly the 20 whitelisted files: the 18 baseline paths and the 2 added scripts),
//         input/BROWSER-BASELINE.json, input/RELEASE.json, input/online-prompt.txt (historical inputs, never written)
// Writes  candidate/server/assets.generated.mjs, candidate/server/prompt.generated.mjs,
//         candidate/build-manifest.generated.json (hash record; not a served asset)
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const BUILD='PRIVATE-PILOT-6';
// The 18 browser paths of the historical baseline, in the order input/BROWSER-BASELINE.json lists them. Fixed: the
// baseline file and the matching input/RELEASE.json pins must name exactly these, and neither file is ever edited.
const BASELINE_PATHS=Object.freeze(['conversation-bank.js','draft-recovery.js','handoff-session.js','index.html','material-edit-host.js','style.css','sw.js','ui.js','workspace-host.js','workspace/handoff.js','workspace/host-core.css','workspace/host-core.js','workspace/icon-192.png','workspace/icon-512.png','workspace/icon.svg','workspace/manifest.json','workspace/material-edit.js','workspace/mobile.html']);
// EC-AUDIT-FIX-1: the two deliberate new browser assets. They have no historical pin (reported as baselineSha256:null,
// status:'added'); in exchange each one must be wired exactly once into its page (INDEX_* / WORKSPACE_HOST_WIRING below).
//   assistant-session.js           main page: assistant metadata + `ec.assist` client rules, consumed by conversation-bank.js and ui.js
//   workspace/assistant-bridge.js  hosted frame only: reads/corrects the calculator forms through window.EC and the page's own functions
const ADDED=Object.freeze(['assistant-session.js','workspace/assistant-bridge.js']);
// Fixed whitelist: the 18 baseline paths plus the 2 added ones, sorted. Nothing else may exist under candidate/browser.
const ASSET_PATHS=Object.freeze(['assistant-session.js','conversation-bank.js','draft-recovery.js','handoff-session.js','index.html','material-edit-host.js','style.css','sw.js','ui.js','workspace-host.js','workspace/assistant-bridge.js','workspace/handoff.js','workspace/host-core.css','workspace/host-core.js','workspace/icon-192.png','workspace/icon-512.png','workspace/icon.svg','workspace/manifest.json','workspace/material-edit.js','workspace/mobile.html']);
// The only baseline files allowed to differ from their historical hashes: exactly the 13 the EC-AUDIT-FIX-1 implementation
// was authorized to edit. Being listed permits a change, it does not require one — a listed file that is still byte-identical
// is reported as 'baseline'. Each historical pin stays recorded as evidence. workspace/mobile.html (listed since
// CONVERTER-WH-1) must in exchange keep its host wiring (WORKSPACE_HOST_WIRING below).
const CHANGED=Object.freeze(['conversation-bank.js','draft-recovery.js','handoff-session.js','index.html','material-edit-host.js','style.css','sw.js','ui.js','workspace-host.js','workspace/handoff.js','workspace/host-core.js','workspace/material-edit.js','workspace/mobile.html']);
// Everything else of the baseline stays SHA-protected, byte for byte: workspace/host-core.css, the three icons, workspace/manifest.json.
const PROTECTED=Object.freeze(BASELINE_PATHS.filter(p=>!CHANGED.includes(p)));
// What makes workspace/mobile.html the HOSTED copy of core/mobile.html: the host stylesheet, the root-scoped worker
// registration and the four host scripts, in this order, as the last bytes of the file. A raw core copy has none of them.
// The bridge is last: it needs window.EC (the generated bundle), the page's own functions and the host core before it.
// It is never part of the standalone core/mobile.html and never loaded by the main page.
const HOST_SCRIPTS=Object.freeze(['/workspace/handoff.js','/workspace/material-edit.js','/workspace/host-core.js','/workspace/assistant-bridge.js']);
const scriptTag=src=>'<script src="'+src+'"></script>';
const WORKSPACE_HOST_WIRING=Object.freeze({
 stylesheet:'<link rel="stylesheet" href="/workspace/host-core.css"></head>',
 worker:"navigator.serviceWorker.register('/sw.js')",
 scripts:HOST_SCRIPTS,
 tail:'</html>\n\n'+HOST_SCRIPTS.map(scriptTag).join('\n')
});
const DIRS=Object.freeze(['workspace']);
const MIME=Object.freeze({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'});
const PH_PIN='__EC_SHELL_PIN__',PH_MANIFEST='__EC_SHELL_MANIFEST__',CACHE_PREFIX='empire-private-shell-v1-';
// Local references the main page must keep, and the only non-asset targets it may link to.
const INDEX_REFS=Object.freeze(['/style.css','/handoff-session.js','/assistant-session.js','/conversation-bank.js','/draft-recovery.js','/ui.js','/material-edit-host.js','/workspace-host.js','/workspace/mobile.html']);
const INDEX_EXTRA=Object.freeze(['/','/_auth']);
// Execution order the main page must guarantee: assistant-session.js defines the global `ASession` and depends on no other
// script; conversation-bank.js and ui.js consume it. Each [first, later] pair must be loaded exactly once, never async,
// with `first` running before `later`.
const INDEX_SCRIPT_ORDER=Object.freeze([Object.freeze(['/assistant-session.js','/conversation-bank.js']),Object.freeze(['/assistant-session.js','/ui.js'])]);
const BUILD_LABEL=/PRIVATE-PILOT-\d+/g;
const PROMPT_PIN_PATH='app/online-prompt.txt';
const OUT=Object.freeze({assets:'candidate/server/assets.generated.mjs',prompt:'candidate/server/prompt.generated.mjs',manifest:'candidate/build-manifest.generated.json'});

const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const HEX=/^[0-9a-f]{64}$/;
function fail(message){throw Object.assign(Error('build refused: '+message),{code:'EC_BUILD_REFUSED'});}
// Reads one regular file without following a symlink at the final path component.
function readRegular(file,label){
 let st;try{st=fs.lstatSync(file);}catch{fail('missing file: '+label);}
 if(st.isSymbolicLink())fail('symlink refused: '+label);
 if(!st.isFile())fail('not a regular file: '+label);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{if(!fs.fstatSync(fd).isFile())fail('not a regular file: '+label);return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
function utf8(bytes,label){const text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))fail('not valid UTF-8: '+label);return text;}
function pairs(value,label){
 if(!Array.isArray(value)||!value.every(p=>Array.isArray(p)&&p.length===2&&typeof p[0]==='string'&&typeof p[1]==='string'&&HEX.test(p[1])))fail('malformed hash list: '+label);
 const map=new Map(value);if(map.size!==value.length)fail('duplicate path in hash list: '+label);return map;
}
// The three fixed lists must describe one whitelist: 18 baseline + 2 added = the 20 assets, 13 of the 18 changeable.
function whitelist(){
 const all=[...BASELINE_PATHS,...ADDED];
 if(BASELINE_PATHS.length!==18||ADDED.length!==2||ASSET_PATHS.length!==20||new Set(all).size!==20||[...all].sort().join('\n')!==ASSET_PATHS.join('\n'))fail('asset whitelist is inconsistent');
 if(CHANGED.length!==13||new Set(CHANGED).size!==13||!CHANGED.every(p=>BASELINE_PATHS.includes(p))||PROTECTED.length!==5)fail('changed-asset list is inconsistent');
}
// Refuses symlinks, special files, unknown files and unknown directories; requires every whitelisted file.
function scan(browserDir){
 let st;try{st=fs.lstatSync(browserDir);}catch{fail('missing directory: candidate/browser');}
 if(st.isSymbolicLink()||!st.isDirectory())fail('candidate/browser must be a real directory');
 const found=new Set();
 const walk=rel=>{
  for(const name of fs.readdirSync(path.join(browserDir,rel)).sort()){
   const r=rel?rel+'/'+name:name,s=fs.lstatSync(path.join(browserDir,r));
   if(s.isSymbolicLink())fail('symlink refused: '+r);
   if(s.isDirectory()){if(!DIRS.includes(r))fail('unknown directory: '+r);walk(r);}
   else if(s.isFile()){if(!ASSET_PATHS.includes(r))fail('unknown file: '+r);found.add(r);}
   else fail('not a regular file: '+r);
  }
 };
 walk('');
 for(const p of ASSET_PATHS)if(!found.has(p))fail('missing asset: '+p);
}
function count(text,needle){return text.split(needle).length-1;}
const jsString=text=>JSON.stringify(text).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');

// Verifies everything and returns the build result in memory. Writes nothing.
function compute(options={}){
 whitelist();
 const root=path.resolve(options.root||path.join(__dirname,'..')),browserDir=path.join(root,'candidate','browser'),inputDir=path.join(root,'input');
 const baselineBytes=readRegular(path.join(inputDir,'BROWSER-BASELINE.json'),'input/BROWSER-BASELINE.json');
 let baseline,release;
 try{baseline=pairs(JSON.parse(utf8(baselineBytes,'baseline')),'input/BROWSER-BASELINE.json');}catch(e){if(e.code)throw e;fail('unreadable input/BROWSER-BASELINE.json');}
 try{release=pairs(JSON.parse(utf8(readRegular(path.join(inputDir,'RELEASE.json'),'input/RELEASE.json'),'release')).pairs,'input/RELEASE.json');}catch(e){if(e.code)throw e;fail('unreadable input/RELEASE.json');}
 // Historical evidence: the baseline is exactly the 18 baseline paths (same order, nothing added, nothing missing) and every
 // one of its hashes equals the historical release pin. An added asset can therefore never acquire an invented baseline.
 if([...baseline.keys()].join('\n')!==BASELINE_PATHS.join('\n'))fail('baseline does not list exactly the 18 baseline paths');
 for(const p of BASELINE_PATHS)if(release.get('app/'+p)!==baseline.get(p))fail('baseline and release pins disagree: '+p);
 for(const p of ADDED)if(release.has('app/'+p))fail('added asset has a historical release pin: '+p);

 scan(browserDir);
 const sources=new Map();
 for(const p of ASSET_PATHS){
  const mime=MIME[path.extname(p)];if(!mime)fail('no content type for: '+p);
  const bytes=readRegular(path.join(browserDir,...p.split('/')),p),hash=sha256(bytes);
  if(ADDED.includes(p)){
   // No pin exists to compare with; the script must at least be non-empty text.
   if(!bytes.length)fail('added asset is empty: '+p);
   utf8(bytes,p);
   sources.set(p,{bytes,sha256:hash,mime,baselineSha256:null,status:'added'});
   continue;
  }
  const pinned=baseline.get(p);
  if(!CHANGED.includes(p)&&hash!==pinned)fail('protected asset modified: '+p);
  sources.set(p,{bytes,sha256:hash,mime,baselineSha256:pinned,status:hash===pinned?'baseline':'changed'});
 }

 const frame=utf8(sources.get('workspace/mobile.html').bytes,'workspace/mobile.html').replace(/\r\n/g,'\n');
 if(count(frame,WORKSPACE_HOST_WIRING.stylesheet)!==1)fail('workspace/mobile.html lost the host stylesheet link');
 if(count(frame,WORKSPACE_HOST_WIRING.worker)!==1)fail('workspace/mobile.html lost the /sw.js registration');
 // The four tags, adjacent and in order, are the end of the file; and none of them is loaded a second time elsewhere.
 if(!frame.trimEnd().endsWith(WORKSPACE_HOST_WIRING.tail))fail('workspace/mobile.html lost the trailing host scripts');
 for(const src of HOST_SCRIPTS)if(count(frame,scriptTag(src))!==1||count(frame,'src="'+src+'"')!==1)fail('workspace/mobile.html must load each host script exactly once: '+src);

 const index=utf8(sources.get('index.html').bytes,'index.html');
 const labels=new Set(index.match(BUILD_LABEL)||[]);
 if(!labels.has(BUILD))fail('index.html does not carry the build label');
 for(const label of labels)if(label!==BUILD)fail('index.html carries a stale build label: '+label);
 const refs=[...index.matchAll(/\s(?:src|href)="([^"]*)"/g)].map(m=>m[1]);
 for(const r of refs)if(!INDEX_EXTRA.includes(r)&&!(r.startsWith('/')&&ASSET_PATHS.includes(r.slice(1))))fail('index.html references an unknown path: '+r);
 for(const r of INDEX_REFS)if(!refs.includes(r))fail('index.html lost the reference to: '+r);
 for(const r of HOST_SCRIPTS)if(refs.includes(r))fail('index.html must not load a workspace-frame script: '+r);
 // Classic scripts only run in a known order when neither is async: two of the same kind (both deferred or both blocking)
 // run in document order, and a blocking script runs before every deferred one.
 const scripts=[...index.matchAll(/<script\b([^>]*)>/g)].map(m=>{const s=/\ssrc="([^"]*)"/.exec(m[1]);return s?{src:s[1],mode:/\sasync\b/.test(m[1])?'async':/\sdefer\b/.test(m[1])?'defer':'blocking'}:null;}).filter(Boolean);
 const once=src=>{const found=scripts.filter(s=>s.src===src);if(found.length!==1)fail('index.html must load exactly once: '+src);return found[0];};
 for(const [first,later] of INDEX_SCRIPT_ORDER){
  const a=once(first),b=once(later);
  const ordered=a.mode!=='async'&&b.mode!=='async'&&(a.mode===b.mode?scripts.indexOf(a)<scripts.indexOf(b):a.mode==='blocking');
  if(!ordered)fail('index.html must load '+first+' before '+later);
 }

 // Shell manifest: every asset except the worker itself (its hash would otherwise depend on itself), plus the root alias.
 const template=utf8(sources.get('sw.js').bytes,'sw.js');
 if(count(template,PH_PIN)!==1||count(template,PH_MANIFEST)!==1)fail('sw.js template must contain each placeholder exactly once');
 const shell=[{url:'/',sha256:sources.get('index.html').sha256,mime:sources.get('index.html').mime}];
 for(const p of ASSET_PATHS)if(p!=='sw.js')shell.push({url:'/'+p,sha256:sources.get(p).sha256,mime:sources.get(p).mime});
 shell.sort((a,b)=>a.url<b.url?-1:a.url>b.url?1:0);
 const shellJson=JSON.stringify(shell),pin=sha256(Buffer.concat([Buffer.from(shellJson),Buffer.from('\n'),Buffer.from(template)])),cacheName=CACHE_PREFIX+pin;
 const swText=template.replace(PH_PIN,()=>pin).replace(PH_MANIFEST,()=>shellJson);
 if(swText.includes(PH_PIN)||swText.includes(PH_MANIFEST))fail('sw.js placeholders were not substituted');
 const swBytes=Buffer.from(swText,'utf8'),swSha=sha256(swBytes);

 // Served map: the root alias (same bytes as index.html) and the 20 exact pathnames — 21 entries. Nothing else.
 const served=new Map();
 served.set('/',{bytes:sources.get('index.html').bytes,mime:sources.get('index.html').mime,sha256:sources.get('index.html').sha256});
 for(const p of ASSET_PATHS){const s=sources.get(p);served.set('/'+p,p==='sw.js'?{bytes:swBytes,mime:s.mime,sha256:swSha}:{bytes:s.bytes,mime:s.mime,sha256:s.sha256});}
 if(served.size!==ASSET_PATHS.length+1||shell.length!==ASSET_PATHS.length)fail('served map has an unexpected size');

 const promptBytes=readRegular(path.join(inputDir,'online-prompt.txt'),'input/online-prompt.txt'),promptSha=sha256(promptBytes);
 if(promptSha!==release.get(PROMPT_PIN_PATH))fail('input/online-prompt.txt does not match the release pin');
 const prompt=utf8(promptBytes,'input/online-prompt.txt');

 const header='// GENERATED by candidate/build.cjs ('+BUILD+'). Do not edit.\n';
 const assetsModule=header+'export const BUILD='+JSON.stringify(BUILD)+';\nexport const ASSETS={\n'+[...served].map(([url,a])=>JSON.stringify(url)+':{base64:'+JSON.stringify(a.bytes.toString('base64'))+',mime:'+JSON.stringify(a.mime)+',sha256:'+JSON.stringify(a.sha256)+'}').join(',\n')+'\n};\n';
 const promptModule=header+'export const PROMPT='+jsString(prompt)+';\n';
 const manifest={
  build:BUILD,shellPin:pin,cacheName,baselineFileSha256:sha256(baselineBytes),
  changedAllowed:[...CHANGED],addedAssets:[...ADDED],
  sources:ASSET_PATHS.map(p=>({path:p,bytes:sources.get(p).bytes.length,sha256:sources.get(p).sha256,baselineSha256:sources.get(p).baselineSha256,status:sources.get(p).status})),
  served:[...served].map(([url,a])=>({url,bytes:a.bytes.length,mime:a.mime,sha256:a.sha256})),
  shell,serviceWorker:{templateSha256:sources.get('sw.js').sha256,generatedSha256:swSha},
  prompt:{source:'input/online-prompt.txt',sha256:promptSha},
  outputs:[{path:OUT.assets,sha256:sha256(Buffer.from(assetsModule,'utf8'))},{path:OUT.prompt,sha256:sha256(Buffer.from(promptModule,'utf8'))}]
 };
 return {root,build:BUILD,pin,cacheName,shell,shellJson,sources,served,swText,swSha,prompt,promptSha,assetsModule,promptModule,manifest,manifestJson:JSON.stringify(manifest,null,2)+'\n'};
}
function writeOut(root,rel,text){
 const file=path.join(root,...rel.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});
 let st=null;try{st=fs.lstatSync(file);}catch{}
 if(st&&(st.isSymbolicLink()||!st.isFile()))fail('output path is not a regular file: '+rel);
 fs.writeFileSync(file,text,'utf8');
}
// compute() first; files are written only when every check passed. The sw.js template is never written.
function build(options={}){
 const result=compute(options);
 if(options.write!==false){writeOut(result.root,OUT.assets,result.assetsModule);writeOut(result.root,OUT.prompt,result.promptModule);writeOut(result.root,OUT.manifest,result.manifestJson);}
 return result;
}
module.exports={BUILD,BASELINE_PATHS,ADDED,ASSET_PATHS,CHANGED,PROTECTED,WORKSPACE_HOST_WIRING,INDEX_REFS,INDEX_SCRIPT_ORDER,MIME,OUT,PH_PIN,PH_MANIFEST,CACHE_PREFIX,sha256,compute,build};

if(require.main===module){
 try{
  const check=process.argv.includes('--check'),r=build({write:!check});
  console.log(BUILD+' '+(check?'verified (nothing written)':'built')+'\n shell pin  '+r.pin+'\n cache      '+r.cacheName+'\n /sw.js     '+r.swSha+'\n served     '+r.served.size+' paths'+(check?'':'\n wrote      '+Object.values(OUT).join(', ')));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
