// Empire Code — LOCAL-WORKSPACE-8: a loopback Node runtime of the accepted PRIVATE-PILOT-8 build.
//
// This file is an HTTP adapter and nothing else. Every route, shape, limit, guard and text comes from the unchanged
// canonical modules:
//   candidate/server/worker.mjs             routes, origin / CSRF gate, token, request id, budget lease, single provider
//                                           call, abort, safe errors, static assets (assets.generated.mjs) and headers
//   candidate/server/budget.mjs             PilotBudget: 60 attempts per UTC day, session tokens, duplicate ids, busy lease
//   candidate/server/cloud-provider.mjs     /api/talk and /api/transcribe provider, transport (fixed endpoints, no retry)
//   candidate/server/assistant-provider.mjs /api/assist provider: strict tools, evidence validation, deterministic output
// No calculator, contract or validation rule is copied here.
//
// What is local, and why:
//   - Identity. The Worker accepts only a platform identity (ctx.access). There is no Cloudflare Access on loopback, so
//     this adapter supplies ONE fixed local principal. It is not the owner's e-mail and proves nothing about a cloud
//     session; it exists so the canonical gate runs unchanged. It is bounded by what precedes it: the socket is bound to
//     127.0.0.1 only, the Host header must be exactly 127.0.0.1:<port> (DNS rebinding), cross-site requests and foreign
//     Origins are refused, and only six request headers are passed on. The cloud Worker and its config are untouched.
//   - Key. The Worker asks hasKey(env) before it answers /api/session. Passing the real key in env would read the key
//     file for a session request, so env carries ENV_KEY_MARKER instead: a constant that only has the key FORMAT. Both
//     provider factories are injected and ignore env, so the marker is never sent anywhere. The real key is read by
//     createLiveRequest() at the moment of the single upstream request of an accepted, budgeted operation.
//   - Budget storage: see budget-store.mjs.
import http from 'node:http';
import {createWorker,PilotBudget} from '../candidate/server/worker.mjs';
import {createProvider,createTransport} from '../candidate/server/cloud-provider.mjs';
import {createAssistantProvider} from '../candidate/server/assistant-provider.mjs';
import {ASSISTANT_PROMPT} from '../candidate/server/assistant-prompt.mjs';
import {PROMPT} from '../candidate/server/prompt.generated.mjs';
import {createKeyReader} from './credential.mjs';
import {memoryBudgetStorage} from './budget-store.mjs';

export const LOCAL_RUNTIME='LOCAL-WORKSPACE-8';
export const DEFAULT_PORT=12350;
export const LOCAL_PRINCIPAL='local-operator@loopback.invalid';
export const ENV_KEY_MARKER='sk-local-runtime-marker-not-a-credential';
// The largest body any canonical route accepts (the recording limit). The Worker applies its own smaller per-route limits.
export const MAX_BODY=8*1024*1024;
const FORWARDED=Object.freeze(['origin','sec-fetch-site','content-type','content-length','x-ec-token','x-ec-request-id']);
const JSON_HEADERS=Object.freeze({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Empire-Local-Runtime':LOCAL_RUNTIME});
const GENERIC='The operation failed. The draft is unchanged; there is no automatic retry.';

// The live provider transport of the user runtime. Nothing is read or fetched until the returned function is called,
// and the Worker calls it once per accepted operation, after every local refusal and after the budget reservation.
// One call = one key read + one canonical createTransport request (one POST, no retry, no redirect, 90 s + abort).
// Dependency injection is all or nothing. The real key reader and the real fetch are used ONLY by the call with no
// argument at all (local/run.mjs). Any argument — also undefined, null or {} — must carry BOTH readKey and fetchImpl
// as functions; anything else throws here, before a key reader exists. A partial injection is never completed with a
// real dependency: a test fetch can not receive the real key and a test key reader can not reach the real network.
export function createLiveRequest(...args){
 let readKey,fetchImpl;
 if(args.length===0){readKey=createKeyReader();fetchImpl=(input,init)=>fetch(input,init);}
 else{
  const options=args[0];
  if(args.length===1&&options!==null&&typeof options==='object')({readKey,fetchImpl}=options);
  if(typeof readKey!=='function'||typeof fetchImpl!=='function')throw new Error('createLiveRequest needs readKey and fetchImpl');
 }
 return async function request(route,options){
  const apiKey=readKey();
  if(apiKey===ENV_KEY_MARKER)throw new Error('marker');
  return createTransport({apiKey,fetchImpl})(route,options);
 };
}

function send(res,status,value,extra={}){
 if(res.destroyed||res.headersSent)return;
 res.writeHead(status,{...JSON_HEADERS,...extra});res.end(JSON.stringify(value));
}
// Resolves the whole body, or null when it is larger than `limit` (the request is then paused, not drained).
function readBody(req,limit){
 return new Promise((resolve,reject)=>{
  const chunks=[];let size=0;
  req.on('data',chunk=>{
   size+=chunk.length;
   if(size>limit){req.pause();req.removeAllListeners('data');for(const c of chunks)c.fill(0);resolve(null);return;}
   chunks.push(chunk);
  });
  req.on('end',()=>{const all=Buffer.concat(chunks);for(const c of chunks)c.fill(0);resolve(all);});
  req.on('error',reject);
  req.on('close',()=>reject(new Error('closed')));
 });
}

// `request` is REQUIRED: the provider transport (route, {json|form, signal}) => parsed JSON. There is no default, so
// constructing a server can never reach a credential or the network by accident. Tests pass a controlled function;
// the user runtime passes createLiveRequest().
export function createLocalServer({request,budgetStorage=memoryBudgetStorage()}={}){
 if(typeof request!=='function')throw new Error('createLocalServer needs the provider transport: {request}');
 if(!budgetStorage||typeof budgetStorage.transaction!=='function')throw new Error('createLocalServer needs a budget storage');
 const worker=createWorker({
  providerFactory:async()=>createProvider({request,prompt:PROMPT}),
  assistantProviderFactory:async()=>createAssistantProvider({request,prompt:ASSISTANT_PROMPT})
 });
 const budget=new PilotBudget({storage:budgetStorage},{});
 const namespace={idFromName:name=>({name}),get:()=>({fetch:(url,init)=>budget.fetch(new Request(url,init))})};
 const ctx=Object.freeze({access:Object.freeze({getIdentity:async()=>({email:LOCAL_PRINCIPAL})})});

 async function handle(req,res){
  const host='127.0.0.1:'+server.address().port,origin='http://'+host,h=req.headers;
  if(h.host!==host||h['sec-fetch-site']==='cross-site'||(h.origin!==undefined&&h.origin!==origin)){send(res,403,{error:'Request origin not allowed.'});return;}
  let url;try{url=new URL(req.url,origin);}catch{send(res,400,{error:'Invalid address.'});return;}
  if(url.origin!==origin){send(res,400,{error:'Invalid address.'});return;}
  const read=req.method==='GET'||req.method==='HEAD';
  const abort=new AbortController();
  res.on('close',()=>{if(!res.writableEnded)abort.abort();});
  let bytes=null;
  try{
   if(!read){
    const declared=h['content-length'];
    bytes=declared!==undefined&&!(Number(declared)<=MAX_BODY)?null:await readBody(req,MAX_BODY);
    if(bytes===null){
     if(!res.destroyed&&!res.headersSent){res.writeHead(413,{...JSON_HEADERS,Connection:'close'});res.end(JSON.stringify({error:'The request is too large.',code:'REQUEST_FAILED'}),()=>req.destroy());}
     return;
    }
   }
   const headers=new Headers();
   for(const name of FORWARDED)if(typeof h[name]==='string')headers.set(name,h[name]);
   const env={EC_ALLOWED_EMAIL:LOCAL_PRINCIPAL,EC_ORIGIN:origin,OPENAI_API_KEY:ENV_KEY_MARKER,PILOT_BUDGET:namespace};
   const response=await worker.fetch(new Request(url.href,{method:req.method,headers,signal:abort.signal,...(read?{}:{body:bytes})}),env,ctx);
   const out=Object.fromEntries(response.headers);
   out['x-empire-local-runtime']=LOCAL_RUNTIME;
   const body=req.method==='HEAD'?null:Buffer.from(await response.arrayBuffer());
   if(body)out['content-length']=String(body.length);
   if(res.destroyed)return;
   res.writeHead(response.status,out);res.end(body===null?undefined:body);
  }finally{if(bytes)bytes.fill(0);}
 }
 const server=http.createServer((req,res)=>{handle(req,res).catch(()=>{try{send(res,500,{error:GENERIC,code:'INTERNAL'});}catch{}});});

 return{
  server,
  // Always 127.0.0.1. port 0 = an ephemeral port (tests, --check). Resolves the origin.
  start(port=0){
   if(!Number.isInteger(port)||(port!==0&&(port<1024||port>65535)))return Promise.reject(new Error('Invalid port'));
   return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve('http://127.0.0.1:'+server.address().port);});
   });
  },
  stop(){return new Promise(resolve=>{server.close(()=>resolve());server.closeAllConnections();});}
 };
}
