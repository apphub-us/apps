// Empire Code private pilot — Cloudflare Worker entry.
// Every route and method is gated first by the platform Access identity (ctx.access). No request header or
// cookie is ever used as proof of identity. Assets and the prompt are generated modules loaded only after the gate.
import C from './contract.cjs';
import {Buffer} from 'node:buffer';
import {createCloudProvider,hasKey,MODEL,SPEECH_MODEL} from './cloud-provider.mjs';
import {sha256Hex} from './budget.mjs';
export {PilotBudget} from './budget.mjs';

const CSP="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; frame-src 'self' blob:; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const FRAME_CSP="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; frame-src 'self' blob:; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
const COMMON={'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'microphone=(self), camera=()','Cache-Control':'no-store'};
const BUDGET_NAME='owner-pilot-v1',TALK_LIMIT=80000,ASSIST_LIMIT=200000,AUDIO_LIMIT=8*1024*1024;
const AUDIO_MIME=/^(?:audio\/(?:webm|mp4|wav|x-wav)|video\/(?:webm|mp4))(?:;|$)/;
const GENERIC='The operation failed. The draft is unchanged; there is no automatic retry.';
const DENIED={
 TOKEN:[403,'Invalid session token.','SESSION_TOKEN'],
 DUPLICATE:[409,'This operation was already sent. No automatic repeat is counted; check the draft.','DUPLICATE_REQUEST'],
 BUSY:[409,'The previous operation is still in progress. The draft was not changed.','BUSY'],
 CAP:[429,'The daily pilot limit of 60 requests was reached. The draft is unchanged; the limit renews at midnight UTC.','DAILY_LIMIT']
};
const fail=(status,message,code)=>Object.assign(new Error(message),{status,code,safe:true});
const json=(status,value,extra={})=>new Response(JSON.stringify(value),{status,headers:{...COMMON,'Content-Type':'application/json; charset=utf-8',...extra}});
const notAllowed=allow=>json(405,{error:'Method not allowed.'},{Allow:allow});

// Returns the lower-cased owner e-mail only when the platform identity matches the configured owner; otherwise null.
async function ownerEmail(env,ctx){
 try{
  const allowed=env&&typeof env.EC_ALLOWED_EMAIL==='string'?env.EC_ALLOWED_EMAIL.trim().toLowerCase():'';
  const access=ctx&&ctx.access;
  if(!allowed||!access||typeof access.getIdentity!=='function')return null;
  const identity=await access.getIdentity();
  const email=identity&&typeof identity.email==='string'?identity.email.toLowerCase():'';
  return email&&email===allowed?email:null;
 }catch{return null;}
}
async function readLimited(request,limit){
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^\d{1,12}$/.test(declared)||Number(declared)>limit))throw fail(413,'The request is too large.');
 if(!request.body)return new Uint8Array(0);
 const reader=request.body.getReader(),chunks=[];let size=0;
 for(;;){
  const{done,value}=await reader.read();if(done)break;
  size+=value.byteLength;
  if(size>limit){try{await reader.cancel();}catch{}throw fail(413,'The request is too large.');}
  chunks.push(value);
 }
 const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}
 return out;
}
async function budget(env,path,payload){
 let data;
 try{
  const namespace=env.PILOT_BUDGET,stub=namespace.get(namespace.idFromName(BUDGET_NAME));
  const response=await stub.fetch('https://budget.internal'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  data=await response.json();
 }catch{data=null;}
 if(!data||typeof data!=='object')throw fail(503,'The pilot counter is unavailable. Nothing was sent.','BUDGET_UNAVAILABLE');
 return data;
}
function ownAsset(assets,path){
 const entry=assets instanceof Map?assets.get(path):assets&&Object.hasOwn(assets,path)?assets[path]:undefined;
 return entry&&typeof entry.base64==='string'&&typeof entry.mime==='string'&&typeof entry.sha256==='string'&&/^[0-9a-f]{64}$/.test(entry.sha256)?entry:null;
}

// Tests construct a worker with fixture assets and provider factories. The deployed default export below is built
// with no arguments, so production always uses the generated modules and the real providers; no request, header or
// environment value can select another identity source, asset set or provider.
export function createWorker(deps){
 const custom=deps&&typeof deps==='object'?deps:{};
 const loadAssets=custom.assets?async()=>({ASSETS:custom.assets,BUILD:custom.build}):()=>import('./assets.generated.mjs');
 const providerFactory=typeof custom.providerFactory==='function'?custom.providerFactory:createCloudProvider;
 // The assistant module graph (calculator registry, job contracts) is loaded only by an /api/assist call, after the
 // gate, so the existing routes neither load it nor depend on it.
 const assistantProviderFactory=typeof custom.assistantProviderFactory==='function'?custom.assistantProviderFactory:async env=>(await import('./assistant-provider.mjs')).createCloudAssistantProvider(env);
 const decoded=new Map();

 async function session(env,email,build){
  const shape=(online,remainingRequests,token,reason)=>json(200,{build,model:MODEL,speechModel:SPEECH_MODEL,online,prototype:true,remainingRequests,token,reason});
  if(!hasKey(env))return shape(false,0,null,'AI_NOT_CONFIGURED');
  try{
   const granted=await budget(env,'/session',{principalHash:await sha256Hex(email)});
   if(granted.ok!==true||typeof granted.token!=='string'||!Number.isInteger(granted.remaining))throw Error('budget');
   return shape(true,granted.remaining,granted.token,null);
  }catch{return shape(false,0,null,'BUDGET_UNAVAILABLE');}
 }
 // mode: 'talk' (unchanged /api/talk), 'transcribe' (unchanged /api/transcribe) or 'assist' (protocol ec.assist v1).
 // All three share the token, request id, budget lease, single provider call, abort signal and safe-error handling.
 async function operate(request,env,email,mode){
  const talk=mode==='talk',assist=mode==='assist';
  let bytes;
  try{
   if(!hasKey(env))throw fail(503,'AI chat is not configured on the server yet. The draft is unchanged.','AI_NOT_CONFIGURED');
   const token=request.headers.get('x-ec-token');
   if(!token||!/^[0-9a-f]{64}$/.test(token))throw fail(...DENIED.TOKEN);
   const id=request.headers.get('x-ec-request-id');
   if(!id||!/^[a-zA-Z0-9-]{8,80}$/.test(id))throw fail(400,'The operation identifier is missing.');
   const mime=request.headers.get('content-type')||'';
   const provider=await(assist?assistantProviderFactory:providerFactory)(env);
   // All local validation happens here, before any budget is reserved.
   let input,checked;
   if(assist){
    if(!mime.startsWith('application/json'))throw fail(415,'JSON is required.');
    const raw=await readLimited(request,ASSIST_LIMIT);
    // Negative zero is read as zero so that every fingerprint is stable across the JSON round trip of the answer.
    try{input=JSON.parse(new TextDecoder('utf-8',{ignoreBOM:true}).decode(raw),(k,v)=>Object.is(v,-0)?0:v);}catch{throw fail(400,'Invalid chat data.');}
    if(!input||typeof input!=='object'||Array.isArray(input)||input.requestId!==id)throw fail(400,'Invalid assistant request. Nothing was sent.','ASSIST_REQUEST');
    checked=provider.checkAssist(input);
   }else if(talk){
    if(!mime.startsWith('application/json'))throw fail(415,'JSON is required.');
    const raw=await readLimited(request,TALK_LIMIT);
    try{input=JSON.parse(new TextDecoder('utf-8',{ignoreBOM:true}).decode(raw));}catch{throw fail(400,'Invalid chat data.');}
    if(!input||Object.keys(input).some(k=>!['state','text','requestId'].includes(k))||input.requestId!==id||typeof input.text!=='string'||!input.text.trim()||input.text.length>3000)throw fail(400,'Invalid message.');
    try{C.state(input.state);}catch{throw fail(400,'Invalid chat draft. Nothing was sent.');}
    provider.checkRun(input.state,input.text);
   }else{
    if(!AUDIO_MIME.test(mime))throw fail(415,'Unsupported recording.');
    bytes=await readLimited(request,AUDIO_LIMIT);
    provider.checkAudio(bytes,mime);
   }
   const principalHash=await sha256Hex(email);
   const begun=await budget(env,'/begin',{principalHash,token,requestId:id});
   if(begun.ok!==true||typeof begun.lease!=='string')throw Object.hasOwn(DENIED,begun.code)?fail(...DENIED[begun.code]):fail(503,'The pilot counter is unavailable. Nothing was sent.','BUDGET_UNAVAILABLE');
   // Reserved: exactly one provider call, no retry. The attempt stays counted whatever happens; only the lease is released.
   let result;
   try{result=assist?await provider.assist(checked,{signal:request.signal}):talk?await provider.run(input.state,input.text,{signal:request.signal}):await provider.transcribe(bytes,mime,{signal:request.signal});}
   finally{try{await budget(env,'/finish',{principalHash,requestId:id,lease:begun.lease});}catch{}}
   return json(200,talk?{...result,requestId:id,baseRevision:input.state.revision}:{...result,requestId:id});
  }catch(e){
   const known=!!e&&e.safe===true;
   return json(known&&Number.isInteger(e.status)?e.status:422,{error:known?e.message:GENERIC,code:known&&e.code?e.code:'REQUEST_FAILED'});
  }finally{if(bytes)bytes.fill(0);}
 }
 async function handle(request,env,ctx){
  const email=await ownerEmail(env,ctx);
  if(!email)return json(403,{error:'Forbidden'});
  const url=new URL(request.url),method=request.method,path=url.pathname,read=method==='GET'||method==='HEAD';
  const known=typeof env.EC_ORIGIN==='string'&&env.EC_ORIGIN?env.EC_ORIGIN:null;
  const sent=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  let allowed=known!==null&&url.origin===known&&(sent===null||sent===known);
  // API calls and every state-changing method must come from this origin itself. Plain page navigations are not
  // checked against Sec-Fetch-Site because the first load after the Access login arrives through a cross-site redirect.
  if(allowed&&(!read||path.startsWith('/api/')))allowed=(site===null||site==='same-origin')&&(read||sent===known);
  if(!allowed)return json(403,{error:'Request origin not allowed.'});
  if(path==='/_auth')return method==='GET'?new Response(null,{status:303,headers:{...COMMON,Location:'/'}}):notAllowed('GET');
  if(path==='/api/talk'||path==='/api/transcribe'||path==='/api/assist')return method==='POST'?operate(request,env,email,path.slice(5)):notAllowed('POST');
  const{ASSETS,BUILD}=await loadAssets();
  if(path==='/api/session')return method==='GET'?session(env,email,BUILD):notAllowed('GET');
  const entry=ownAsset(ASSETS,path);
  if(!entry)return json(404,{error:'Nie znaleziono.'});
  if(!read)return notAllowed('GET, HEAD');
  const headers={...COMMON,...(path==='/workspace/mobile.html'?{'Content-Security-Policy':FRAME_CSP}:{}),'Content-Type':entry.mime,'X-Empire-Asset-Sha256':entry.sha256,'X-Empire-Build':String(BUILD)};
  if(method==='HEAD')return new Response(null,{status:200,headers});
  let body=decoded.get(path);
  if(!body){
   try{body=Buffer.from(entry.base64,'base64');}catch{return json(404,{error:'The interface file is missing.'});}
   decoded.set(path,body);
  }
  return new Response(body,{status:200,headers});
 }
 return{async fetch(request,env,ctx){
  let response;
  try{response=await handle(request,env,ctx);}catch{response=json(500,{error:GENERIC,code:'INTERNAL'});}
  return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
 }};
}
export default createWorker();
