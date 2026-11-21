'use strict';
// Generated service worker in a VM with mocked caches/fetch. No network, no real browser. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),B=require('../candidate/build.cjs');
const ORIGIN='https://pilot.example',OLD='empire-workspace4-shell-v1',OTHER='empire-private-shell-v1-'+'0'.repeat(64);

let built=null;
function result(){
 if(built)return built;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ec-sw-'));
 try{
  for(const p of B.ASSET_PATHS){const to=path.join(dir,'candidate/browser',p);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(ROOT,'candidate/browser',p),to);}
  fs.mkdirSync(path.join(dir,'input'));
  for(const f of ['BROWSER-BASELINE.json','RELEASE.json','online-prompt.txt'])fs.copyFileSync(path.join(ROOT,'input',f),path.join(dir,'input',f));
  built=B.compute({root:dir});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 return built;
}
const buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
// A response as the pilot server is expected to send it for a known asset.
function good(url,over={}){
 const a=result().served.get(new URL(url).pathname);
 if(!a)return {status:404,redirected:false,type:'basic',url,headers:new Headers({'Content-Type':'text/plain'}),arrayBuffer:async()=>new ArrayBuffer(0)};
 const headers=new Headers({'Content-Type':a.mime,'X-Empire-Asset-Sha256':a.sha256,'Content-Security-Policy':"default-src 'self'",'Set-Cookie':'never=stored'});
 return {status:200,redirected:false,type:'basic',url,headers,arrayBuffer:async()=>buffer(a.bytes),...over};
}
const LOGIN=Buffer.from('<!doctype html><title>Sign in</title><form action="https://team.example/login"></form>');
// Serves everything correctly except one pathname, which gets `bad(url)`.
const except=(pathname,bad)=>url=>new URL(url).pathname===pathname?bad(url):good(url);

function world(serve,stores=new Map()){
 const log={fetches:[],skip:0,claim:0,deleted:[]},listeners={};
 const key=k=>String(k&&k.url||k);
 const cache=m=>({async put(k,r){m.set(key(k),r);},async match(k){const r=m.get(key(k));return r?r.clone():undefined;},async keys(){return [...m.keys()].map(url=>({url}));}});
 const caches={async has(n){return stores.has(n);},async open(n){if(!stores.has(n))stores.set(n,new Map());return cache(stores.get(n));},async delete(n){log.deleted.push(n);return stores.delete(n);},async keys(){return [...stores.keys()];}};
 const self={location:{origin:ORIGIN},addEventListener(type,fn){listeners[type]=fn;},skipWaiting:async()=>{log.skip++;},clients:{claim:async()=>{log.claim++;}}};
 const w={serve,stores,log,listeners,name:result().cacheName};
 const fetch=async(input,init={})=>{const url=key(input);log.fetches.push({url,init});return w.serve(url,init);};
 vm.runInContext(result().swText,vm.createContext({self,caches,fetch,crypto:webcrypto,Response,URL,console}),{filename:'sw.generated.js'});
 return w;
}
async function fire(w,type){const waits=[];w.listeners[type]({waitUntil(p){waits.push(p);}});await Promise.all(waits);}
function request(w,url,o={}){
 const e={request:{url,method:o.method||'GET',mode:o.mode||'no-cors'},responded:null,waits:[],respondWith(p){this.responded=p;},waitUntil(p){this.waits.push(p);}};
 w.listeners.fetch(e);return e;
}
function oldStores(){
 return new Map([[OLD,new Map([[ORIGIN+'/ui.js',new Response('old ui')]])],[OTHER,new Map([[ORIGIN+'/',new Response('previous pilot')],[ORIGIN+'/.ec-shell-complete',new Response('0'.repeat(64))]])]]);
}
async function expectInstallRefused(serve){
 const w=world(serve,oldStores());
 await assert.rejects(fire(w,'install'));
 assert.equal(w.log.skip,0,'a failed install never calls skipWaiting');
 assert.equal(w.stores.has(w.name),false,'no candidate cache is left behind');
 assert.deepEqual([...w.stores.keys()].sort(),[OLD,OTHER].sort(),'older caches are kept');
 assert.equal(await w.stores.get(OLD).get(ORIGIN+'/ui.js').clone().text(),'old ui');
 assert.equal(w.stores.get(OTHER).size,2);
 for(const n of w.log.deleted)assert.equal(n,w.name,'only the cache of this candidate may ever be deleted');
 return w;
}

test('install: verified prefetch of the whole manifest, then skipWaiting; older caches stay',async()=>{
 const w=world(good,oldStores());await fire(w,'install');
 assert.equal(w.log.skip,1);
 const urls=result().shell.map(e=>ORIGIN+e.url);
 assert.deepEqual(w.log.fetches.map(f=>f.url).sort(),[...urls].sort());
 for(const f of w.log.fetches){assert.equal(f.init.credentials,'same-origin');assert.equal(f.init.cache,'no-store');assert.equal(f.init.redirect,'error');assert.equal(f.init.method,'GET');}
 const stored=w.stores.get(w.name);
 assert.deepEqual([...stored.keys()].sort(),[...urls,ORIGIN+'/.ec-shell-complete'].sort());
 for(const k of stored.keys())assert.ok(!/\/api|\/_auth|\/sw\.js|cdn-cgi/.test(k),k);
 for(const e of result().shell){
  const r=stored.get(ORIGIN+e.url).clone();
  assert.equal(B.sha256(Buffer.from(await r.arrayBuffer())),e.sha256,e.url);assert.equal(r.headers.get('Content-Type'),e.mime);
  assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(r.headers.get('Content-Security-Policy'),"default-src 'self'");
 }
 assert.ok(w.stores.has(OLD)&&w.stores.has(OTHER));assert.deepEqual(w.log.deleted.filter(n=>n!==w.name),[]);
 await fire(w,'activate');assert.equal(w.log.claim,1);assert.ok(w.stores.has(OLD)&&w.stores.has(OTHER),'activate deletes nothing');
});

test('install refuses a login redirect (fetch error, followed redirect, 302, 403)',async()=>{
 await expectInstallRefused(except('/ui.js',()=>{throw new TypeError('redirect mode is set to error');}));
 await expectInstallRefused(except('/',url=>good(url,{redirected:true})));
 await expectInstallRefused(except('/index.html',()=>({status:200,redirected:true,type:'basic',url:'https://team.example/cdn-cgi/access/login',headers:new Headers({'Content-Type':'text/html; charset=utf-8'}),arrayBuffer:async()=>buffer(LOGIN)})));
 await expectInstallRefused(except('/style.css',url=>good(url,{status:302})));
 await expectInstallRefused(except('/workspace/mobile.html',url=>good(url,{status:403})));
 await expectInstallRefused(except('/ui.js',url=>good(url,{type:'opaqueredirect',status:0})));
});

test('install refuses a 200 login page and a wrong content type',async()=>{
 const login=url=>({status:200,redirected:false,type:'basic',url,headers:new Headers({'Content-Type':'text/html; charset=utf-8'}),arrayBuffer:async()=>buffer(LOGIN)});
 await expectInstallRefused(except('/',login));
 await expectInstallRefused(except('/ui.js',login));
 // correct bytes and declared hash, but served as HTML
 await expectInstallRefused(except('/ui.js',url=>{const r=good(url);r.headers.set('Content-Type','text/html; charset=utf-8');return r;}));
 await expectInstallRefused(except('/workspace/icon.svg',url=>{const r=good(url);r.headers.delete('Content-Type');return r;}));
});

test('install refuses a wrong declared hash and wrong bytes',async()=>{
 await expectInstallRefused(except('/ui.js',url=>{const r=good(url);r.headers.set('X-Empire-Asset-Sha256','f'.repeat(64));return r;}));
 await expectInstallRefused(except('/ui.js',url=>{const r=good(url);r.headers.delete('X-Empire-Asset-Sha256');return r;}));
 await expectInstallRefused(except('/workspace/mobile.html',url=>good(url,{arrayBuffer:async()=>buffer(Buffer.concat([result().served.get('/workspace/mobile.html').bytes,Buffer.from(' ')]))})));
 // the generated worker's own bytes under a shell path
 await expectInstallRefused(except('/workspace-host.js',url=>good(url,{arrayBuffer:async()=>buffer(Buffer.from(result().swText))})));
});

test('install refuses a missing asset',async()=>{
 await expectInstallRefused(except('/workspace/icon-512.png',url=>good(url,{status:404})));
 await expectInstallRefused(except('/draft-recovery.js',()=>{throw new TypeError('network');}));
});

test('a complete cache of the same pin survives a later install attempt that cannot reach the network',async()=>{
 const first=world(good);await fire(first,'install');
 const again=world(()=>{throw new TypeError('offline');},first.stores);
 await fire(again,'install');
 assert.equal(again.log.fetches.length,0);assert.deepEqual(again.log.deleted,[]);assert.equal(again.stores.get(again.name).size,result().shell.length+1);
});

test('an unfinished cache of this pin is never served and is rebuilt only from verified bytes',async()=>{
 const stores=new Map([[result().cacheName,new Map([[ORIGIN+'/ui.js',new Response('half written')]])]]);
 const down=world(()=>{throw new TypeError('offline');},stores);
 const e=request(down,ORIGIN+'/ui.js');await assert.rejects(e.responded);await Promise.all(e.waits);
 const w=world(good,new Map([[result().cacheName,new Map([[ORIGIN+'/ui.js',new Response('half written')]])]]));
 await fire(w,'install');
 assert.equal(B.sha256(Buffer.from(await w.stores.get(w.name).get(ORIGIN+'/ui.js').clone().arrayBuffer())),result().served.get('/ui.js').sha256);
});

test('fetch: known paths come from the complete cache without the network, also offline and with a query string',async()=>{
 const w=world(good);await fire(w,'install');
 const before=w.log.fetches.length;w.serve=()=>{throw new TypeError('offline');};
 for(const [url,pathname] of [[ORIGIN+'/','/'],[ORIGIN+'/?source=pwa&x=/api/session','/'],[ORIGIN+'/index.html?a=1','/index.html'],[ORIGIN+'/ui.js?v=9','/ui.js'],[ORIGIN+'/workspace/mobile.html','/workspace/mobile.html'],[ORIGIN+'/workspace/icon-192.png','/workspace/icon-192.png']]){
  const e=request(w,url,{mode:pathname==='/'?'navigate':'no-cors'});assert.ok(e.responded,url);
  const r=await e.responded;assert.equal(r.status,200);
  assert.equal(B.sha256(Buffer.from(await r.arrayBuffer())),result().served.get(pathname).sha256,url);
 }
 assert.equal(w.log.fetches.length,before,'no network use for cached shell paths');
 assert.equal(w.stores.get(w.name).size,result().shell.length+1,'a query string never creates a cache entry');
});

test('fetch: API, login, worker script, unknown, non-GET and cross-origin requests are left to the network and never cached',async()=>{
 const w=world(good);await fire(w,'install');const size=w.stores.get(w.name).size,before=w.log.fetches.length;
 const untouched=[[ORIGIN+'/api/session'],[ORIGIN+'/api/talk',{method:'POST'}],[ORIGIN+'/api/transcribe',{method:'POST'}],[ORIGIN+'/_auth',{mode:'navigate'}],[ORIGIN+'/_auth/callback'],[ORIGIN+'/cdn-cgi/access/logout'],
  [ORIGIN+'/sw.js'],[ORIGIN+'/unknown.js'],[ORIGIN+'/workspace/'],[ORIGIN+'/ui.js/../api/session'],[ORIGIN+'/ui.js',{method:'POST'}],[ORIGIN+'/ui.js',{method:'HEAD'}],['https://other.example/ui.js'],['https://team.example/cdn-cgi/access/login']];
 for(const [url,o] of untouched)assert.equal(request(w,url,o).responded,null,url);
 assert.equal(w.log.fetches.length,before);assert.equal(w.stores.get(w.name).size,size);
});

test('fetch without an installed cache: plain network, nothing unverified is stored, older caches are not consulted',async()=>{
 const stores=oldStores(),login=url=>({status:200,redirected:false,type:'basic',url,headers:new Headers({'Content-Type':'text/html'}),arrayBuffer:async()=>buffer(LOGIN),marker:'network'});
 const w=world(login,stores);
 const e=request(w,ORIGIN+'/ui.js');const r=await e.responded;await Promise.all(e.waits);
 assert.equal(r.marker,'network','the old cache entry for /ui.js is not used as a fallback');
 assert.equal(w.stores.has(w.name),false);assert.deepEqual([...w.stores.keys()].sort(),[OLD,OTHER].sort());
 assert.equal(w.log.skip,0);
});

test('a single missing entry of a complete cache is refilled only with verified bytes',async()=>{
 const w=world(good);await fire(w,'install');
 w.stores.get(w.name).delete(ORIGIN+'/style.css');
 w.serve=url=>good(url,{status:403});
 const refusedResponse=await request(w,ORIGIN+'/style.css').responded;
 assert.equal(refusedResponse.type,'error');assert.equal(w.stores.get(w.name).has(ORIGIN+'/style.css'),false);
 w.serve=good;
 const r=await request(w,ORIGIN+'/style.css').responded;
 assert.equal(B.sha256(Buffer.from(await r.arrayBuffer())),result().served.get('/style.css').sha256);
 assert.equal(w.stores.get(w.name).has(ORIGIN+'/style.css'),true);
});
