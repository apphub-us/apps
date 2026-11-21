'use strict';
// Session and error contract of the conversation UI, in an isolated VM with a minimal DOM/storage/recorder mock and the real
// storage modules. Every answer below is a local fake fixture: this is NOT a live OpenAI, Cloudflare or network test.
// Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const DIR=path.resolve(__dirname,'../candidate/browser'),read=f=>fs.readFileSync(path.join(DIR,f),'utf8');
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
const SESSION_TOKEN=()=>json({error:'Nieprawidłowy token sesji.',code:'SESSION_TOKEN'},403);
// Answers GET /api/session from the list, in order; one GET more than listed fails the test. Everything else goes to post().
const routes=(sessions,post)=>{let n=0;return (url,init)=>{if(url!=='/api/session')return post(url,init);if(n>=sessions.length)throw Error('unexpected extra GET /api/session');return sessions[n++]();};};
const noPost=url=>{throw Error('unexpected request '+url);};

async function load(api,onLine=true){
 const els={},calls=[],local=storage(),session=storage(),win={};
 els.relogin=element('relogin');els.relogin.hidden=true; // as in index.html
 const document={hidden:false,getElementById:id=>els[id]||(els[id]=element(id)),createElement:t=>element(t),querySelector:()=>null,addEventListener(){}};
 const navigator={onLine,locks:{request:(name,opts,fn)=>Promise.resolve().then(()=>fn()),query:async()=>({held:[],pending:[]})},mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}};
 // stop() delivers one 512-byte chunk and then the stop event, like a short recording.
 class MediaRecorder{
  constructor(stream,options){this.state='inactive';this.mimeType=options&&options.mimeType||'audio/webm';}
  static isTypeSupported(t){return t==='audio/webm;codecs=opus';}
  start(){this.state='recording';}
  stop(){if(this.state!=='recording')return;this.state='inactive';this.ondataavailable({data:new Blob([new Uint8Array(512)])});this.onstop();}
 }
 const sandbox={document,navigator,localStorage:local,sessionStorage:session,crypto:webcrypto,setTimeout,clearTimeout,TextEncoder,URL,Blob,AbortController,MediaRecorder,console,
  addEventListener(t,f){win[t]=f;},fetch:async(url,init={})=>{calls.push({url:String(url),init});return api(String(url),init);}};
 sandbox.window=sandbox;
 const ctx=vm.createContext(sandbox);
 for(const f of ['handoff-session.js','conversation-bank.js','draft-recovery.js','ui.js'])vm.runInContext(read(f),ctx,{filename:f});
 await settle();
 return {els,calls,local,session,win,navigator,run:code=>vm.runInContext(code,ctx),token:()=>vm.runInContext('token',ctx),dump:()=>local.dump()+session.dump(),
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

const PROVIDER=[
 [401,'API_AUTH','OpenAI odrzuciło klucz. Dotychczasowa aplikacja i szkic są bez zmian.'],
 [403,'API_ACCESS','Brak uprawnień do wybranego modelu lub projektu API.'],
 [429,'API_QUOTA','API nie ma dostępnych środków lub limitu. Sprawdź rozliczenia projektu; nie twórz kolejnego klucza.'],
 [429,'API_RATE_LIMIT','Osiągnięto limit API. Nie ponawiam automatycznie płatnej operacji.'],
 [503,'MODEL_UNAVAILABLE','Wybrany model nie jest dostępny dla tego projektu API. Nie przełączam potajemnie na inny.'],
 [422,'API_REQUEST','API odrzuciło format zapytania. Niczego nie zastosowano; potrzebna jest korekta integracji.'],
 [429,'DAILY_LIMIT','Osiągnięto dzienny limit 60 zapytań pilotażu. Szkic bez zmian; limit odnawia się o północy UTC.']
];
// 401/403 that did not come from the application: the login gate.
const ACCESS=[
 ['401 without a code',()=>json({error:'<html>login-page sk-fixture</html>'},401)],
 ['403 without a code',()=>json({},403)],
 ['403 with an unknown code',()=>json({error:'sk-fixture',code:'SOMETHING_NEW'},403)],
 ['401 SESSION_TOKEN is not the exact contract',()=>json({error:'x',code:'SESSION_TOKEN'},401)],
 ['403 that is not JSON',()=>notJson(403)],
 ['login page instead of JSON',()=>notJson(200)],
 ['refused redirect',refused]
];

test('labels: PRIVATE-PILOT-3 in the build constant, the title and the header',()=>{
 assert.equal(require('../candidate/build.cjs').BUILD,'PRIVATE-PILOT-3');
 assert.match(INDEX,/<title>Empire Code — PRIVATE-PILOT-3<\/title>/);assert.match(INDEX,/<span class="build">PRIVATE-PILOT-3<\/span>/);
 assert.ok(!INDEX.includes('PRIVATE-PILOT-1'));
});

test('source: three API calls only, no polling, no automatic navigation',()=>{
 assert.equal(UI.split("fetch('/api/").length-1,3);assert.equal(UI.split('fetch(').length-1,3);
 assert.ok(!/setInterval|location\.(href|assign|replace|reload)|window\.open|document\.cookie|\.click\(\)[^;]*relogin/.test(UI));
});

test('session shape: only online===true with a 64-character lowercase hex token is ready',async()=>{
 const ok=await load(routes([()=>json(sessionBody())],noPost));
 assertReady(ok,T1,'real backend shape');assert.match(ok.els.status.textContent,/^OpenAI · model-x/);assert.equal(ok.els.relogin.hidden,true);
 const bad=[{...sessionBody(),token:T1.toUpperCase()},{...sessionBody(),token:T1.slice(1)},{...sessionBody(),token:T1+'0'},{...sessionBody(),token:'g'+T1.slice(1)},{...sessionBody(),token:' '+T1},
  {...sessionBody(),token:'tok-1'},{...sessionBody(),token:null},{...sessionBody(),online:'true'},{...sessionBody(),online:1},{...sessionBody(),online:false},{token:T1,model:'model-x'}];
 for(const body of bad){
  const p=await load(routes([()=>json(body)],noPost)),note=JSON.stringify(body);
  assertOff(p,note);assert.ok(!/OpenAI ·/.test(p.els.status.textContent),note);assert.equal(p.els.relogin.hidden,true,note);
  p.els.input.value=TEXT;await p.submit();assert.equal(p.calls.length,1,note);assert.equal(p.els.input.value,TEXT,note);
 }
});

test('talk: provider and API errors keep the session, show the safe server message and hide a stale login link',async()=>{
 for(const [status,code,message] of PROVIDER){
  const p=await load(routes([()=>json(sessionBody())],()=>json({error:message,code,detail:'sk-fixture <html>login-page</html>'},status)));
  await p.type(TEXT);p.els.relogin.hidden=false; // a link left over from an earlier failure
  await p.submit();
  assert.equal(p.count('/api/talk'),1,code);assert.equal(p.count('/api/session'),1,code);
  assert.equal(p.els.status.textContent,message,code);assert.equal(p.els.status.className,'error',code);
  assertReady(p,T1,code);assert.equal(p.els.relogin.hidden,true,code+' is not a login problem');assertTextKept(p,code);
 }
});

test('talk: an over-long or uncoded error text is replaced by the fixed message',async()=>{
 for(const [note,answer] of [['known code, long text',()=>json({error:'sk-fixture '.repeat(40),code:'API_SERVICE'},503)],['no code',()=>json({error:'<html>login-page</html>'},500)],['unknown code',()=>json({error:'sk-fixture',code:'SOMETHING_NEW'},500)]]){
  const p=await load(routes([()=>json(sessionBody())],answer));
  await p.type(TEXT);await p.submit();
  assert.equal(p.els.status.textContent,'Brak odpowiedzi usługi AI.',note);noLeak(p,note);
  assertReady(p,T1,note);assert.equal(p.els.relogin.hidden,true,note);assert.equal(p.count('/api/talk'),1,note);assert.equal(p.count('/api/session'),1,note);
 }
});

test('talk: 401/403 without a known code, a login page or a redirect drops the token and shows the login link',async()=>{
 for(const [note,answer] of ACCESS){
  const p=await load(routes([()=>json(sessionBody())],answer));
  await p.type(TEXT);await p.submit();
  assert.equal(p.count('/api/talk'),1,note);assert.equal(p.count('/api/session'),1,note+': no renewal for a lost login');
  assertOff(p,note);assert.equal(p.els.relogin.hidden,false,note);assert.match(p.els.status.textContent,/logowanie wygasło/,note);noLeak(p,note);assertTextKept(p,note);
  await p.submit();assert.equal(p.count('/api/talk'),1,note+': the stale token is never posted again');
 }
});

test('talk: 403 SESSION_TOKEN renews the session once and does not send the message again',async()=>{
 const answers=[SESSION_TOKEN,()=>json({error:'Usługa AI jest chwilowo niedostępna. Szkic bez zmian; brak automatycznej ponownej próby.',code:'API_SERVICE'},503)];
 const p=await load(routes([()=>json(sessionBody(T1)),()=>json(sessionBody(T2))],()=>answers.shift()()));
 await p.type(TEXT);await p.submit();
 assert.equal(p.count('/api/talk'),1,'exactly one rejected POST');assert.equal(p.count('/api/session'),2,'exactly one renewal GET');
 assert.equal(p.sent('/api/talk')[0].init.headers['X-EC-Token'],T1);
 assertReady(p,T2,'renewed');assert.equal(p.els.relogin.hidden,true);assertTextKept(p,'renewed');
 for(const s of [/została odświeżona/,/nie została wysłana/,/Wyślij ponownie/])assert.match(p.els.status.textContent,s);
 assert.ok(!/OpenAI odrzuciło klucz/.test(p.els.status.textContent),'not reported as a key problem');
 // Only an explicit second press sends again, with the new token.
 await p.submit();
 assert.equal(p.count('/api/talk'),2);assert.equal(p.sent('/api/talk')[1].init.headers['X-EC-Token'],T2);assert.equal(p.count('/api/session'),2);
 assert.equal(JSON.parse(p.sent('/api/talk')[1].init.body).text,TEXT);
});

test('talk: failed renewal keeps its own feedback, never the success message, and sends nothing',async()=>{
 const cases=[
  ['login gate',()=>json({error:'forbidden'},403),false,/Zaloguj ponownie/],
  ['refused redirect',refused,false,/Zaloguj ponownie/],
  ['invalid token shape',()=>json(sessionBody('tok-2')),true,/nie udostępnił/],
  ['AI not configured',()=>json({online:false,token:null,reason:'AI_NOT_CONFIGURED'}),true,/AI nie jest jeszcze podłączone/],
  ['server error',()=>json({error:'x'},503),true,/niedostępna/],
  ['interrupted request',()=>Promise.reject(abortError()),true,/Przerwano/]
 ];
 for(const [note,second,linkHidden,expected] of cases){
  const p=await load(routes([()=>json(sessionBody(T1)),second],SESSION_TOKEN));
  await p.type(TEXT);await p.submit();
  assert.equal(p.count('/api/talk'),1,note);assert.equal(p.count('/api/session'),2,note);
  assertOff(p,note);assert.equal(p.els.relogin.hidden,linkHidden,note);assert.match(p.els.status.textContent,expected,note);
  assert.ok(!/została odświeżona/.test(p.els.status.textContent),note);assertTextKept(p,note);
  await p.submit();assert.equal(p.count('/api/talk'),1,note+': nothing is posted without a token');assert.equal(p.count('/api/session'),2,note);
 }
});

test('offline: the text field, the stored text and the token are untouched and nothing is sent',async()=>{
 const p=await load(routes([()=>json(sessionBody())],noPost));
 await p.type(TEXT);p.navigator.onLine=false;p.win.offline();await settle();
 assert.equal(p.token(),T1,'going offline is not a session failure');assert.equal(p.els.send.disabled,true);assert.equal(p.els.input.disabled,false);assert.equal(p.els.relogin.hidden,true);
 await p.submit();assert.equal(p.calls.length,1);assertTextKept(p,'offline');
 await p.type(TEXT+' i dwa metalowe');assert.ok(p.local.dump().includes(TEXT+' i dwa metalowe'),'typing offline is still stored');
 const q=await load(refused,false);
 assertOff(q,'opened offline');assert.equal(q.els.relogin.hidden,true);await q.type(TEXT);assertTextKept(q,'opened offline');assert.equal(q.calls.length,1);
});

test('abort: a cancelled or interrupted request is not a login failure',async()=>{
 // Cancel pressed while the request is in flight.
 let p=await load(routes([()=>json(sessionBody())],(url,init)=>new Promise((res,rej)=>init.signal.addEventListener('abort',()=>rej(abortError())))));
 await p.type(TEXT);await p.submit();assert.equal(p.count('/api/talk'),1);
 await p.cancel();
 assertReady(p,T1,'cancelled');assert.equal(p.els.relogin.hidden,true);assert.match(p.els.status.textContent,/^Anulowano/);assertTextKept(p,'cancelled');
 assert.equal(p.count('/api/talk'),1);assert.equal(p.count('/api/session'),1);
 // The request ends with AbortError on its own.
 p=await load(routes([()=>json(sessionBody())],()=>Promise.reject(abortError())));
 await p.type(TEXT);await p.submit();
 assertReady(p,T1,'interrupted');assert.equal(p.els.relogin.hidden,true);assert.match(p.els.status.textContent,/^Anulowano odpowiedź/);assert.equal(p.count('/api/session'),1);assertTextKept(p,'interrupted');
 // The first session request is interrupted: no login link, nothing enabled.
 p=await load(()=>Promise.reject(abortError()));
 assertOff(p,'session interrupted');assert.equal(p.els.relogin.hidden,true);assert.ok(!/Zaloguj|logowanie wygasło/.test(p.els.status.textContent));
});

test('late response after a context switch changes nothing and starts no request',async()=>{
 const late=[['SESSION_TOKEN',a=>a.res(SESSION_TOKEN())],['401 without a code',a=>a.res(json({},401))],['refused redirect',a=>a.rej(new TypeError('Failed to fetch'))],['login page',a=>a.res(notJson(200))],['API_AUTH',a=>a.res(json({error:'x',code:'API_AUTH'},401))]];
 for(const [note,finish] of late){
  let answer=null;
  const p=await load(routes([()=>json(sessionBody())],()=>new Promise((res,rej)=>{answer={res,rej};})));
  await p.type('robota A');const a=p.run('activeContextId');
  await p.els.new.onclick();await settle();const b=p.run('activeContextId');assert.notEqual(a,b,note);
  await p.type('tekst B');await p.submit();assert.equal(p.count('/api/talk'),1,note);assert.ok(answer,note);
  await p.run('hostExclusive(()=>switchContext('+JSON.stringify(a)+'))');p.run('controls()');await settle();
  assert.equal(p.run('activeContextId'),a,note);assert.equal(p.els.input.value,'robota A',note);
  const stored=p.dump(),shown=p.els.status.textContent;
  finish(answer);await settle();
  assert.equal(p.dump(),stored,note+': stored conversations unchanged');assert.equal(p.els.input.value,'robota A',note);assert.equal(p.run('activeContextId'),a,note);
  assert.equal(p.els.status.textContent,shown,note);assert.equal(p.els.relogin.hidden,true,note);
  assertReady(p,T1,note);assert.equal(p.count('/api/talk'),1,note);assert.equal(p.count('/api/session'),1,note+': no renewal for a late answer');
 }
});

test('late renewal after Cancel restores the session only: no success message, no request',async()=>{
 let renew=null;
 const p=await load(routes([()=>json(sessionBody(T1)),()=>new Promise(r=>{renew=r;})],SESSION_TOKEN));
 await p.type(TEXT);await p.submit();
 assert.ok(renew,'the renewal request is in flight');assert.equal(p.token(),null);assert.equal(p.els.send.disabled,true);
 await p.cancel();
 renew(json(sessionBody(T2)));await settle();
 assertReady(p,T2,'late renewal');assert.ok(!/Wyślij ponownie/.test(p.els.status.textContent));assertTextKept(p,'late renewal');
 assert.equal(p.count('/api/talk'),1);assert.equal(p.count('/api/session'),2);
});

test('audio: 403 SESSION_TOKEN renews once; the recording is neither transcribed again nor sent as a message',async()=>{
 const p=await load(routes([()=>json(sessionBody(T1)),()=>json(sessionBody(T2))],url=>url==='/api/transcribe'?SESSION_TOKEN():noPost(url)));
 await p.speak();
 assert.equal(p.count('/api/transcribe'),1);assert.equal(p.count('/api/talk'),0);assert.equal(p.count('/api/session'),2);
 assert.equal(p.sent('/api/transcribe')[0].init.headers['X-EC-Token'],T1);assert.equal(p.sent('/api/transcribe')[0].init.redirect,'error');
 assertReady(p,T2,'audio renewed');assert.equal(p.els.mic.textContent,'Mów','recording is possible again');assert.equal(p.els.input.value,'');assert.equal(p.els.relogin.hidden,true);
 for(const s of [/została odświeżona/,/nie jest zapisane/,/Nagraj wypowiedź jeszcze raz/])assert.match(p.els.status.textContent,s);
});

test('audio: failed renewal, provider error and lost login each keep their own outcome',async()=>{
 // Renewal fails at the login gate.
 let p=await load(routes([()=>json(sessionBody(T1)),()=>json({},403)],url=>url==='/api/transcribe'?SESSION_TOKEN():noPost(url)));
 await p.speak();
 assertOff(p,'audio renewal failed');assert.equal(p.els.relogin.hidden,false);assert.ok(!/została odświeżona/.test(p.els.status.textContent));
 assert.equal(p.count('/api/transcribe'),1);assert.equal(p.count('/api/session'),2);assert.equal(p.count('/api/talk'),0);
 // Provider errors are not login problems.
 for(const [status,code,message] of PROVIDER.slice(0,2)){
  p=await load(routes([()=>json(sessionBody())],url=>url==='/api/transcribe'?json({error:message,code},status):noPost(url)));
  p.els.relogin.hidden=false;await p.speak();
  assert.equal(p.els.status.textContent,message,code);assertReady(p,T1,code);assert.equal(p.els.relogin.hidden,true,code);
  assert.equal(p.count('/api/transcribe'),1,code);assert.equal(p.count('/api/session'),1,code);assert.equal(p.count('/api/talk'),0,code);
 }
 // The login gate answers instead of the application.
 for(const [note,answer] of ACCESS){
  p=await load(routes([()=>json(sessionBody())],url=>url==='/api/transcribe'?answer():noPost(url)));
  await p.speak();
  assertOff(p,note);assert.equal(p.els.relogin.hidden,false,note);noLeak(p,note);assert.equal(p.els.input.value,'',note);
  assert.equal(p.count('/api/transcribe'),1,note);assert.equal(p.count('/api/session'),1,note);assert.equal(p.count('/api/talk'),0,note);
 }
});
