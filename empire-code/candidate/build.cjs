'use strict';
// Private-pilot browser build. Local files only: no network, no credentials, no dependencies.
//   node candidate/build.cjs          verify + write the generated files
//   node candidate/build.cjs --check  verify only, write nothing
// Reads   candidate/browser/** (exactly the 18 whitelisted files), input/BROWSER-BASELINE.json, input/RELEASE.json,
//         input/online-prompt.txt
// Writes  candidate/server/assets.generated.mjs, candidate/server/prompt.generated.mjs,
//         candidate/build-manifest.generated.json (hash record; not a served asset)
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const BUILD='PRIVATE-PILOT-3';
// Fixed whitelist: the 18 browser paths of the baseline. Nothing else may exist under candidate/browser.
const ASSET_PATHS=Object.freeze(['conversation-bank.js','draft-recovery.js','handoff-session.js','index.html','material-edit-host.js','style.css','sw.js','ui.js','workspace-host.js','workspace/handoff.js','workspace/host-core.css','workspace/host-core.js','workspace/icon-192.png','workspace/icon-512.png','workspace/icon.svg','workspace/manifest.json','workspace/material-edit.js','workspace/mobile.html']);
// The only files allowed to differ from the baseline hashes.
const CHANGED=Object.freeze(['index.html','sw.js','ui.js']);
const DIRS=Object.freeze(['workspace']);
const MIME=Object.freeze({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'});
const PH_PIN='__EC_SHELL_PIN__',PH_MANIFEST='__EC_SHELL_MANIFEST__',CACHE_PREFIX='empire-private-shell-v1-';
// Local references the main page must keep, and the only non-asset targets it may link to.
const INDEX_REFS=Object.freeze(['/style.css','/handoff-session.js','/conversation-bank.js','/draft-recovery.js','/ui.js','/material-edit-host.js','/workspace-host.js','/workspace/mobile.html']);
const INDEX_EXTRA=Object.freeze(['/','/_auth']);
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
 const root=path.resolve(options.root||path.join(__dirname,'..')),browserDir=path.join(root,'candidate','browser'),inputDir=path.join(root,'input');
 const baselineBytes=readRegular(path.join(inputDir,'BROWSER-BASELINE.json'),'input/BROWSER-BASELINE.json');
 let baseline,release;
 try{baseline=pairs(JSON.parse(utf8(baselineBytes,'baseline')),'input/BROWSER-BASELINE.json');}catch(e){if(e.code)throw e;fail('unreadable input/BROWSER-BASELINE.json');}
 try{release=pairs(JSON.parse(utf8(readRegular(path.join(inputDir,'RELEASE.json'),'input/RELEASE.json'),'release')).pairs,'input/RELEASE.json');}catch(e){if(e.code)throw e;fail('unreadable input/RELEASE.json');}
 if(baseline.size!==ASSET_PATHS.length||!ASSET_PATHS.every(p=>baseline.has(p)))fail('baseline does not list exactly the whitelisted paths');
 for(const p of ASSET_PATHS)if(release.get('app/'+p)!==baseline.get(p))fail('baseline and release pins disagree: '+p);

 scan(browserDir);
 const sources=new Map();
 for(const p of ASSET_PATHS){
  const mime=MIME[path.extname(p)];if(!mime)fail('no content type for: '+p);
  const bytes=readRegular(path.join(browserDir,...p.split('/')),p),hash=sha256(bytes),changed=CHANGED.includes(p);
  if(!changed&&hash!==baseline.get(p))fail('protected asset modified: '+p);
  sources.set(p,{bytes,sha256:hash,mime,status:hash===baseline.get(p)?'baseline':'changed'});
 }

 const index=utf8(sources.get('index.html').bytes,'index.html');
 if(!index.includes(BUILD))fail('index.html does not carry the build label');
 const refs=[...index.matchAll(/\s(?:src|href)="([^"]*)"/g)].map(m=>m[1]);
 for(const r of refs)if(!INDEX_EXTRA.includes(r)&&!(r.startsWith('/')&&ASSET_PATHS.includes(r.slice(1))))fail('index.html references an unknown path: '+r);
 for(const r of INDEX_REFS)if(!refs.includes(r))fail('index.html lost the reference to: '+r);

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

 // Served map: the root alias (same bytes as index.html) and the 18 exact pathnames. Nothing else.
 const served=new Map();
 served.set('/',{bytes:sources.get('index.html').bytes,mime:sources.get('index.html').mime,sha256:sources.get('index.html').sha256});
 for(const p of ASSET_PATHS){const s=sources.get(p);served.set('/'+p,p==='sw.js'?{bytes:swBytes,mime:s.mime,sha256:swSha}:{bytes:s.bytes,mime:s.mime,sha256:s.sha256});}
 if(served.size!==ASSET_PATHS.length+1)fail('served map has an unexpected size');

 const promptBytes=readRegular(path.join(inputDir,'online-prompt.txt'),'input/online-prompt.txt'),promptSha=sha256(promptBytes);
 if(promptSha!==release.get(PROMPT_PIN_PATH))fail('input/online-prompt.txt does not match the release pin');
 const prompt=utf8(promptBytes,'input/online-prompt.txt');

 const header='// GENERATED by candidate/build.cjs ('+BUILD+'). Do not edit.\n';
 const assetsModule=header+'export const BUILD='+JSON.stringify(BUILD)+';\nexport const ASSETS={\n'+[...served].map(([url,a])=>JSON.stringify(url)+':{base64:'+JSON.stringify(a.bytes.toString('base64'))+',mime:'+JSON.stringify(a.mime)+',sha256:'+JSON.stringify(a.sha256)+'}').join(',\n')+'\n};\n';
 const promptModule=header+'export const PROMPT='+jsString(prompt)+';\n';
 const manifest={
  build:BUILD,shellPin:pin,cacheName,baselineFileSha256:sha256(baselineBytes),
  changedAllowed:[...CHANGED],
  sources:ASSET_PATHS.map(p=>({path:p,bytes:sources.get(p).bytes.length,sha256:sources.get(p).sha256,baselineSha256:baseline.get(p),status:sources.get(p).status})),
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
module.exports={BUILD,ASSET_PATHS,CHANGED,MIME,OUT,PH_PIN,PH_MANIFEST,CACHE_PREFIX,sha256,compute,build};

if(require.main===module){
 try{
  const check=process.argv.includes('--check'),r=build({write:!check});
  console.log(BUILD+' '+(check?'verified (nothing written)':'built')+'\n shell pin  '+r.pin+'\n cache      '+r.cacheName+'\n /sw.js     '+r.swSha+'\n served     '+r.served.size+' paths'+(check?'':'\n wrote      '+Object.values(OUT).join(', ')));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
