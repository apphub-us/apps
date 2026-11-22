'use strict';
// Shared VM harness of the stage2 tests (conversation continuity and the new-version notice). Not a test file itself.
// It loads the real page scripts, in page order, into an isolated VM with a small DOM, storage, lock, download and
// service-worker mock. Fixture data only: no network, no real browser, no owner profile or storage.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const DIR=path.resolve(__dirname,'../candidate/browser'),read=f=>fs.readFileSync(path.join(DIR,f),'utf8');
const KEY='empire_code_conversation_bank_v1',LEGACY_KEY='empire_code_online1_draft',ACTIVE_KEY='empire_code_active_context_v1',JOURNAL='empire_code_unsent4:';
const T='2026-11-01T10:00:00.000Z';
const hex=(n,width=32)=>n.toString(16).padStart(width,'0');
const ids={ctx:n=>'ctx1_'+hex(n),job:n=>'job1_'+hex(n),conv:n=>'conv1_'+hex(n),mat:n=>'mat1_'+hex(n),trev:n=>'trev1_'+hex(n),doc:n=>'doc1_'+hex(n)};

function element(id){
 return {id,tagName:'',textContent:'',className:'',value:'',disabled:false,hidden:false,checked:false,files:null,dataset:{},attributes:{},children:[],listeners:{},scrollTop:0,scrollHeight:0,focused:0,
  addEventListener(t,f){this.listeners[t]=f;},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},
  setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;},
  querySelector(){return this.queried||(this.queried=element(''));},focus(){this.focused++;},scrollIntoView(){},remove(){},click(){}};
}
// localStorage/sessionStorage mock. `refuse(key,value)` returning true makes setItem throw like a full or blocked store.
function storage(){
 const m=new Map();
 // `drop(key,value)` returning true makes setItem return normally WITHOUT storing: a write that the read-back cannot confirm.
 // `attempts` lists every setItem call ([key,value]), accepted or not.
 const s={refuse:null,drop:null,writes:0,attempts:[],get length(){return m.size;},key:i=>[...m.keys()][i]??null,getItem:k=>m.has(k)?m.get(k):null,
  setItem(k,v){s.attempts.push([String(k),String(v)]);if(s.refuse&&s.refuse(String(k),String(v)))throw Object.assign(Error('The quota has been exceeded.'),{name:'QuotaExceededError',code:22});if(s.drop&&s.drop(String(k),String(v)))return;s.writes++;m.set(String(k),String(v));},
  removeItem(k){m.delete(k);},dump:()=>JSON.stringify([...m]),keys:()=>[...m.keys()]};
 return s;
}
const settle=async(rounds=12)=>{for(let i=0;i<rounds;i++)await new Promise(r=>setTimeout(r,3));};
// Every element reachable from the page roots, including ones created by the scripts.
function reach(els){const seen=new Set(),stack=Object.values(els),out=[];while(stack.length){const e=stack.pop();if(!e||typeof e!=='object'||seen.has(e))continue;seen.add(e);out.push(e);for(const c of e.children||[])stack.push(c);}return out;}
const textOf=el=>el?[el.textContent||''].concat((el.children||[]).map(textOf)).join(' '):'';

// Fixture jobs in the shape the Jobs bridge lists them.
const jobFixture=(n,title)=>({head:{jobId:ids.job(n)},revision:{title}});
// options: local, session (shared storages), jobs, formOpen(), host:false (ui.js only), serviceWorker, MessageChannel, fastTimers.
//  api(url,init)  answers every request of the page (default: the conversation server is "not configured"); requests are listed in page.calls
//  media:true     a fixture microphone and recorder: page.media = {requests, tracks, recorders, deny}
//  timers:[]      every timer the page sets is listed there as {fn,ms,id,fired,cleared}; page.runTimer(t) fires one now
async function load(o={}){
 const els={},local=o.local||storage(),session=o.session||storage(),win={},downloads=[],reloads=[],calls=[];
 const media={requests:0,tracks:[],recorders:[],deny:null};
 const frame=element('core-frame');
 // o.bridge adds members to the Jobs bridge (read, prepareAction, …); o.frame adds members to the tools window (EC, ECAssistantBridge).
 frame.contentWindow={JSON,ecHostBridge:{ready:true,list:async()=>({ok:true,jobs:o.jobs||[]}),hasDraft:()=>!!(o.formOpen&&o.formOpen()),...(o.bridge||{})},...(o.frame||{})};
 els['core-frame']=frame;els.relogin=element('relogin');els.relogin.hidden=true;
 for(const id of ['update-banner','update-export','manage-panel','manage-reason','manage-confirm','manage-view','import-preview']){els[id]=element(id);els[id].hidden=true;} // hidden in index.html
 const document={hidden:false,getElementById:id=>els[id]||(els[id]=element(id)),createElement:t=>{const e=element('');e.tagName=t;return e;},querySelector:()=>null,addEventListener(){}};
 const navigator={onLine:o.onLine!==false,locks:{held:[],request:(name,opts,fn)=>Promise.resolve().then(()=>fn()),query:async()=>({held:navigator.locks.held.map(name=>({name})),pending:[]})}};
 if(o.serviceWorker)navigator.serviceWorker=o.serviceWorker;
 class Blob{constructor(parts){this.text=parts.join('');this.size=this.text.length;}}
 // Fixture microphone: every request for it is counted, every track records its stop() calls; `deny` makes the request fail.
 if(o.media)navigator.mediaDevices={getUserMedia:async()=>{media.requests++;if(media.deny)throw Object.assign(Error('denied'),{name:media.deny});const track={stops:0,stop(){this.stops++;}};media.tracks.push(track);return {getTracks:()=>[track]};}};
 class MediaRecorder{
  constructor(stream,options){this.state='inactive';this.mimeType=options&&options.mimeType||'audio/webm';media.recorders.push(this);}
  static isTypeSupported(t){return t==='audio/webm;codecs=opus';}
  start(){this.state='recording';}
  stop(){this.state='inactive';}
  // What the browser delivers after stop(): the last chunk (512 bytes of fixture audio), then the stop event.
  async finish(){this.ondataavailable?.({data:{size:512,toString:()=>'a'.repeat(512)}});return this.onstop?.();}
 }
 const baseTimer=o.fastTimers?(f,ms,...a)=>setTimeout(f,Math.min(ms||0,25),...a):setTimeout;
 const timer=o.timers?(f,ms,...a)=>{const t={fn:null,ms,id:null,fired:false,cleared:false};t.fn=()=>{t.fired=true;return f(...a);};t.id=baseTimer(t.fn,ms);o.timers.push(t);return t.id;}:baseTimer;
 const clear=o.timers?id=>{for(const t of o.timers)if(t.id===id)t.cleared=true;clearTimeout(id);}:clearTimeout;
 const notConfigured=async()=>({ok:true,status:200,json:async()=>({online:false,token:null,reason:'AI_NOT_CONFIGURED'})});
 const sandbox={document,navigator,localStorage:local,sessionStorage:session,crypto:webcrypto,setTimeout:timer,clearTimeout:clear,TextEncoder,AbortController,console,Blob,
  URL:{createObjectURL:b=>{downloads.push(b.text);return 'blob:fixture';},revokeObjectURL(){}},MessageChannel:o.MessageChannel,
  location:{origin:'https://pilot.example',reload(){reloads.push(local.dump());}},
  addEventListener(t,f){(win[t]=win[t]||[]).push(f);},
  // Without `api` the conversation server is "not configured": those tests never need a model answer.
  fetch:async(url,init={})=>{calls.push({url:String(url),init});return o.api?o.api(String(url),init):notConfigured();}};
 if(o.media)sandbox.MediaRecorder=MediaRecorder;
 sandbox.window=sandbox;
 const ctx=vm.createContext(sandbox);
 const scripts=['handoff-session.js','assistant-session.js','conversation-bank.js','draft-recovery.js','ui.js'].concat(o.host===false?[]:['material-edit-host.js','workspace-host.js']);
 for(const f of scripts)vm.runInContext(read(f),ctx,{filename:f});
 await settle();
 const run=code=>vm.runInContext(code,ctx);
 const find=id=>reach(els).find(e=>e.id===id)||null;
 const page={els,local,session,win,navigator,downloads,reloads,run,find,calls,media,
  count:url=>calls.filter(c=>c.url===url).length,
  submit:async()=>{els.composer.listeners.submit({preventDefault(){}});await settle();},
  // Fires a listed timer now (once) instead of waiting for it; the real timer behind it is cancelled.
  runTimer:async t=>{clearTimeout(t.id);if(!t.fired&&!t.cleared)await t.fn();await settle();},
  text:id=>textOf(find(id)),
  bank:()=>JSON.parse(local.getItem(KEY)),
  active:()=>run('activeContextId'),
  type:async text=>{els.input.value=text;els.input.listeners.input();await settle();},
  // Presses a control the way a user could: a missing or disabled control is a test failure, not a silent no-op.
  click:async id=>{const el=find(id);if(!el)throw Error('no control #'+id);if(el.disabled)throw Error('control #'+id+' is disabled');if(typeof el.onclick!=='function')throw Error('control #'+id+' has no click handler');await el.onclick();await settle();},
  check:async(id,value=true)=>{const el=find(id);if(!el||el.disabled)throw Error('no usable checkbox #'+id);el.checked=value;await el.onchange();await settle();},
  // Chooses a file in the import field; `text` null = the file dialog was cancelled.
  choose:async(text,name='rozmowa.json')=>{const input=els['import-file'];input.files=text===null?[]:[{name,size:Buffer.byteLength(text),text:async()=>text}];await input.onchange();await settle();},
  fire:async(type,event={})=>{for(const f of win[type]||[])f(event);await settle();},
  // What another tab's write looks like to this page.
  storageEvent:async key=>{await page.fire('storage',{key,newValue:local.getItem(key)});}};
 return page;
}

// --- Bank fixtures, written by hand in the released version 1 layout (not produced by the code under test) -----------------
const blankState=()=>({version:1,revision:0,nextId:1,items:[],history:[]});
const item=n=>({id:'i'+String(n).padStart(4,'0'),name:'Bushing '+n,quantity:String(n),unit:'pcs',specification:'',notes:'',review:[]});
function filledState(n,turns=1){const s=blankState();for(let i=1;i<=n;i++)s.items.push(item(i));for(let t=0;t<turns;t++)s.history.push({role:'user',content:'dodaj bushing '+t},{role:'assistant',content:'Dodano.'});s.revision=turns;s.nextId=n+1;return s;}
const receipt=(job,n)=>({jobId:ids.job(job),itemId:'i'+String(n).padStart(4,'0'),materialId:ids.mat(n),revisionId:ids.trev(n)});
function workspace(state,o={}){return {version:1,sourceId:ids.conv(o.source||1),sourceRevision:o.revision||0,sourceSavedAt:T,boundState:JSON.stringify(state),targetJobId:o.job?ids.job(o.job):null,prepared:o.prepared||null,receipts:o.receipts||[],materialEdit:o.materialEdit||null};}
// One stored conversation. o: state, job, source (number => bound workspace), receipts, input, version, prepared.
function entry(n,o={}){
 const state=o.state||blankState(),bound=o.source||o.job;
 const ws=bound?workspace(state,{source:o.source||1000+n,job:o.job,receipts:o.receipts,revision:o.revision,prepared:o.prepared}):null;
 return {contextId:ids.ctx(n),jobId:o.job?ids.job(o.job):null,version:o.version||1,created:n,touched:n,createdAt:T,updatedAt:T,input:o.input||'',envelope:{state,undo:[],diffs:[],workspace:ws}};
}
const bankV1=(entries,legacy=null)=>JSON.stringify({kind:'empire-code.conversation-bank',version:1,serial:entries.reduce((m,e)=>Math.max(m,e.touched),0),legacy,contexts:entries});
// The gate of the RELEASED version 1 client (PRIVATE-PILOT-4 conversation-bank.js parse()), reduced to its refusal order. It is
// reproduced here from the release, independently of the new module, to show what an old client does with a newer bank.
function releasedV1Reads(raw){
 const b=JSON.parse(raw),plain=!!b&&typeof b==='object'&&!Array.isArray(b);
 if(plain&&b.kind==='empire-code.conversation-bank'&&b.version!==1)return 'UNSUPPORTED';
 const keys=['kind','version','serial','legacy','contexts'];
 if(!plain||Object.keys(b).length!==keys.length||!keys.every(k=>Object.hasOwn(b,k)))return 'CORRUPT';
 return 'ACCEPTED';
}
// A valid `ec.assist` 1 answer to the request body `body` (docs/assistant-api-contract.md section 3), as the fixture server sends
// it. Default: a material turn that adds one exchange and changes no item. o: {state,reply,domain,replyOrigin,diffs,durationMs,
// assistant:{…members that differ from the default…}}. Nothing here is produced by the code under test.
function assistAnswer(body,o={}){
 const reply=o.reply||'OK.',a=body.assistant,other=!!o.domain&&o.domain!=='materials';
 let state=o.state;
 if(!state){state=JSON.parse(JSON.stringify(body.state));state.revision++;state.history.push({role:'user',content:body.text},{role:'assistant',content:reply});}
 return {protocol:'ec.assist',version:1,requestId:body.requestId,baseRevision:body.state.revision,base:{materialRevision:body.state.revision,fingerprint:a.baseFingerprint,contextToken:a.contextToken},
  domain:o.domain||'materials',state,reply,question:'',diffs:o.diffs||[],proposalId:'0'.repeat(64),scope:other?'out_of_scope':'materials',corrections:[],
  assistant:{lang:a.lang,replyOrigin:o.replyOrigin||(other?'deterministic':'model_text'),historyReplyTruncated:false,toolDraft:a.toolDraft,changedFields:[],result:null,actionProposal:null,navigation:null,clarification:null,...(o.assistant||{})},
  model:'fixture-model',online:true,durationMs:o.durationMs===undefined?900:o.durationMs,usage:null};
}
module.exports={assistAnswer,DIR,read,KEY,LEGACY_KEY,ACTIVE_KEY,JOURNAL,T,ids,element,storage,settle,load,textOf,jobFixture,blankState,filledState,item,receipt,workspace,entry,bankV1,releasedV1Reads,webcrypto};
