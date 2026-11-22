'use strict';
// TEMPLATE of the private-pilot shell worker. candidate/build.cjs substitutes the two build placeholders in the next statement:
// the manifest is the exact [{url,sha256,mime}] list of the shell files (this worker excluded, root alias included) and the pin
// is the SHA-256 of that list. The generated worker is embedded by the build and is never written back into this file.
const PIN='__EC_SHELL_PIN__',MANIFEST=__EC_SHELL_MANIFEST__;
const CACHE='empire-private-shell-v1-'+PIN,ORIGIN=self.location.origin,MARK=ORIGIN+'/.ec-shell-complete';
const BY_PATH=new Map(MANIFEST.map(e=>[e.url,e]));
// Response headers of a verified asset that are kept with its cached copy. Nothing else from the network is stored.
const KEEP=['Content-Security-Policy','Referrer-Policy','Permissions-Policy','X-Content-Type-Options'];
const family=v=>String(v||'').split(';')[0].trim().toLowerCase();
const hex=buf=>Array.from(new Uint8Array(buf),x=>x.toString(16).padStart(2,'0')).join('');
let ready=false,repair=null;

// True only when the cache of exactly this pin holds the completion mark, which is written last, after every asset.
async function complete(){
 if(ready)return true;
 try{
  if(!(await caches.has(CACHE)))return false;
  const c=await caches.open(CACHE),m=await c.match(MARK);
  if(!m||(await m.text())!==PIN)return false;
  ready=true;return true;
 }catch{return false;}
}
// One manifest asset from the network. A login page, a redirect, an error page or any other bytes are refused:
// status 200, not redirected, same-origin exact URL, the expected content type, the declared hash and the actual hash.
async function fetchVerified(entry){
 const url=ORIGIN+entry.url;
 const r=await fetch(url,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error'});
 if(r.status!==200||r.redirected||r.type!=='basic'||r.url!==url)throw Error('shell: unexpected response for '+entry.url);
 if(family(r.headers.get('Content-Type'))!==family(entry.mime))throw Error('shell: content type of '+entry.url);
 if(r.headers.get('X-Empire-Asset-Sha256')!==entry.sha256)throw Error('shell: declared hash of '+entry.url);
 const bytes=await r.arrayBuffer();
 if(hex(await crypto.subtle.digest('SHA-256',bytes))!==entry.sha256)throw Error('shell: bytes of '+entry.url);
 const headers={'Content-Type':entry.mime,'X-Empire-Asset-Sha256':entry.sha256};
 for(const k of KEEP){const v=r.headers.get(k);if(v!==null)headers[k]=v;}
 return {url,bytes,headers};
}
// The cached copy is rebuilt from the verified bytes; the network response object itself is never stored.
const stored=v=>new Response(v.bytes,{status:200,headers:v.headers});
// Everything is fetched and verified in memory first; only then is the cache of this pin written, the mark last.
// On failure only the unfinished cache of this pin is removed. Caches of other versions and browser stores are never touched.
async function install(){
 if(await complete())return;
 try{
  const verified=await Promise.all(MANIFEST.map(fetchVerified));
  await caches.delete(CACHE); // at this point only an unfinished leftover of this same pin can carry this name
  const c=await caches.open(CACHE);
  for(const v of verified)await c.put(v.url,stored(v));
  await c.put(MARK,new Response(PIN,{status:200,headers:{'Content-Type':'text/plain'}}));
  if(!(await complete()))throw Error('shell: cache not complete');
 }catch(e){
  ready=false;
  try{if(!(await complete()))await caches.delete(CACHE);}catch{}
  throw e;
 }
}
self.addEventListener('install',e=>e.waitUntil(install().then(()=>self.skipWaiting())));
// Older caches are deliberately left in place.
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
// The one message this worker understands: a window of this origin asks which shell version the worker carries. The answer (the pin)
// goes only to the port supplied with the question. This worker never tells a page to reload or navigate, never skips waiting,
// claims clients or touches a cache because of a message, and ignores every other message, sender and shape.
self.addEventListener('message',e=>{
 const d=e.data,from=e.source,port=e.ports&&e.ports[0];
 if(!port||!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).length!==1||d.type!=='empire-shell-version')return;
 if(e.origin!==ORIGIN||!from||from.type!=='window'||typeof from.url!=='string'||!from.url.startsWith(ORIGIN+'/'))return;
 try{port.postMessage({type:'empire-shell-version',pin:PIN});}catch{}
});

// Known shell paths are answered from the complete cache of this pin only, keyed by the manifest pathname (a query string
// never selects or creates an entry). There is no network-first mixing and no lookup in other caches.
async function serve(entry,req,e){
 if(await complete()){
  const c=await caches.open(CACHE),hit=await c.match(ORIGIN+entry.url);
  if(hit)return hit;
  ready=false;
  if(await complete()){
   // A single entry is missing from a complete cache: only verified bytes may fill it.
   try{const v=await fetchVerified(entry);await c.put(v.url,stored(v));return stored(v);}
   catch{return req.mode==='navigate'?fetch(req):Response.error();}
  }
 }
 // No complete cache of this version (first use, or the browser evicted it): plain network, nothing unverified is stored.
 // One full verified install is attempted in the background per worker lifetime.
 if(!repair){repair=install().catch(()=>{});try{e.waitUntil(repair);}catch{}}
 return fetch(req);
}
self.addEventListener('fetch',e=>{
 const req=e.request;let u;try{u=new URL(req.url);}catch{return;}
 if(req.method!=='GET'||u.origin!==ORIGIN)return;
 const p=u.pathname;
 // API, login and access-control paths always go to the network and are never cached or synthesized.
 if(p==='/api'||p.startsWith('/api/')||p==='/_auth'||p.startsWith('/_auth/')||p.startsWith('/cdn-cgi/'))return;
 const entry=BY_PATH.get(p);if(!entry)return; // unknown route: network, no cache
 e.respondWith(serve(entry,req,e));
});
