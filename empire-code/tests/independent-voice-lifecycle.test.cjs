'use strict';
// Session and error contract of the conversation UI, in an isolated VM with a minimal DOM/storage/recorder mock and the real
// storage modules. Every answer below is a local fake fixture: this is NOT a live OpenAI, Cloudflare or network test.
// Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const DIR=process.env.EC_VOICE_BASELINE_DIR?path.resolve(process.env.EC_VOICE_BASELINE_DIR):path.resolve(__dirname,'../candidate/browser'),read=f=>fs.readFileSync(path.join(DIR,f),'utf8');
const UI=read('ui.js'),INDEX=read('index.html');
const T1='a1'.repeat(32),T2='b2'.repeat(32),TEXT='dwa kable 50 fit';

function element(id){return {id,textContent:'',className:'',value:'',disabled:false,hidden:false,dataset:{},children:[],listeners:{},scrollTop:0,scrollHeight:0,addEventListener(t,f){this.listeners[t]=f;},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},focus(){},scrollIntoView(){},remove(){},click(){}};}
function storage(){const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i]??null,getItem:k=>m.has(k)?m.get(k):null,setItem(k,v){m.set(String(k),String(v));},removeItem(k){m.delete(k);},dump:()=>JSON.stringify([...m])};}
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,3));};
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const notJson=(status=200)=>({ok:status>=200&&status<300,status,json:async()=>{throw new SyntaxError('Unexpected token <');}});
const abortError=()=>Object.assign(Error('The operation was aborted.'),{name:'AbortError'});
const refused=()=>Promise.reject(new TypeError('Failed to fetch')); // what fetch reports for a refused redirect
// The session answer in the shape the backend really sends.
const sessionBody=(token=T1)=>({build:'PRIVATE-PILOT-2',model:'model-x',speechModel:'speech-x',online:true,prototype:true,remainingRequests:60,token,reason:null});
const SESSION_TOKEN=()=>json({error:'Invalid session token.',code:'SESSION_TOKEN'},403);
// Answers GET /api/session from the list, in order; one GET more than listed fails the test. Everything else goes to post().
const routes=(sessions,post)=>{let n=0;return (url,init)=>{if(url!=='/api/session')return post(url,init);if(n>=sessions.length)throw Error('unexpected extra GET /api/session');return sessions[n++]();};};
const noPost=url=>{throw Error('unexpected request '+url);};

async function load(api,onLine=true){
 const els={},calls=[],local=storage(),session=storage(),win={};
 els.relogin=element('relogin');els.relogin.hidden=true; // as in index.html
 const document={hidden:false,getElementById:id=>els[id]||(els[id]=element(id)),createElement:t=>element(t),querySelector:()=>null,addEventListener(){}};
 const navigator={onLine,locks:{request:(name,opts,fn)=>Promise.resolve().then(()=>fn()),query:async()=>({held:[],pending:[]})},mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}};
 const recorders=[];
 class MediaRecorder{
  constructor(stream,options){this.state='inactive';this.mimeType=options&&options.mimeType||'audio/webm';recorders.push(this);}
  static isTypeSupported(t){return t==='audio/webm;codecs=opus';}
  start(){this.state='recording';}
  stop(){this.state='inactive';}
  async finish(){this.ondataavailable?.({data:new Blob([new Uint8Array(512)])});return this.onstop?.();}
 }
 const sandbox={document,navigator,localStorage:local,sessionStorage:session,crypto:webcrypto,setTimeout,clearTimeout,TextEncoder,URL,Blob,AbortController,MediaRecorder,console,
  addEventListener(t,f){win[t]=f;},fetch:async(url,init={})=>{calls.push({url:String(url),init});return api(String(url),init);}};
 sandbox.window=sandbox;
 const ctx=vm.createContext(sandbox);
 for(const f of ['handoff-session.js','assistant-session.js','conversation-bank.js','draft-recovery.js','ui.js'])vm.runInContext(read(f),ctx,{filename:f});
 await settle();
 return {els,calls,local,session,win,navigator,recorders,run:code=>vm.runInContext(code,ctx),token:()=>vm.runInContext('token',ctx),dump:()=>local.dump()+session.dump(),
  count:url=>calls.filter(c=>c.url===url).length,sent:url=>calls.filter(c=>c.url===url),
  submit:async()=>{els.composer.listeners.submit({preventDefault(){}});await settle();},
  type:async text=>{els.input.value=text;els.input.listeners.input();await settle();},
  cancel:async()=>{els.cancel.onclick();await settle();},
  // One recording: press Mów, then Stop.
  speak:async()=>{await els.mic.onclick();await settle();await els.mic.onclick();await settle();}};
}
function assertReady(p,token,note){assert.equal(p.token(),token,note);assert.equal(p.els.send.disabled,false,note);assert.equal(p.els.mic.disabled,false,note);}
function assertOff(p,note){assert.equal(p.token(),null,note);assert.equal(p.els.send.disabled,true,note);assert.equal(p.els.mic.disabled,true,note);assert.equal(p.els.input.disabled,false,note);}
function assertTextKept(p,note){assert.equal(p.els.input.value,TEXT,note);assert.ok(p.local.dump().includes(TEXT),note);}
const noLeak=(p,note)=>assert.ok(!/<html|sk-fixture|login-page/.test(p.els.status.textContent),note+': '+p.els.status.textContent);


test('independent voice: old stop event cannot turn off a newer recording',async()=>{
 const p=await load(routes([()=>json(sessionBody())],noPost));await p.els.mic.onclick();const old=p.recorders[0];assert.equal(p.run('recording'),true);await p.cancel();await p.els.mic.onclick();assert.equal(p.recorders.length,2);assert.equal(p.run('recording'),true);await old.finish();await settle();assert.equal(p.run('recording'),true);assert.equal(p.els.mic.textContent,'Stop');assert.equal(p.recorders[1].state,'recording');assert.equal(p.count('/api/transcribe'),0);p.run('cancelAudio()');
});
test('independent voice: old recorder error must not cancel the next active recorder',async()=>{
 const p=await load(routes([()=>json(sessionBody())],noPost));await p.els.mic.onclick();const old=p.recorders[0];await p.cancel();await p.els.mic.onclick();old.onerror?.();await settle();assert.equal(p.run('recording'),true);assert.equal(p.recorders[1].state,'recording');assert.equal(p.els.mic.textContent,'Stop');p.run('cancelAudio()');
});
test('independent voice: oversized stale chunk cannot cancel a later recording',async()=>{
 const p=await load(routes([()=>json(sessionBody())],noPost));await p.els.mic.onclick();const old=p.recorders[0];await p.cancel();await p.els.mic.onclick();old.ondataavailable?.({data:new Blob([new Uint8Array(8*1024*1024+1)])});await settle();assert.equal(p.run('recording'),true);assert.equal(p.recorders[1].state,'recording');assert.equal(p.count('/api/transcribe'),0);p.run('cancelAudio()');
});
test('independent voice: whitespace-only transcript is not a successful dictation',async()=>{
 const p=await load(routes([()=>json(sessionBody())],(url,init)=>url==='/api/transcribe'?json({requestId:init.headers['X-EC-Request-Id'],text:'  '+String.fromCharCode(10)+'  '}):noPost(url)));await p.els.mic.onclick();p.recorders[0].stop();await p.recorders[0].finish();await settle();assert.equal(p.count('/api/transcribe'),1);assert.equal(p.count('/api/assist'),0);assert.equal(p.els.input.value,'');assert.equal(p.els.status.className,'error');
});
