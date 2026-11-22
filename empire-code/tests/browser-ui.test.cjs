'use strict';
// Conversation UI session states in a VM with a minimal DOM/storage mock and the real storage modules.
// No network: fetch is a local stub. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const DIR=path.resolve(__dirname,'../candidate/browser'),read=f=>fs.readFileSync(path.join(DIR,f),'utf8');
const UI=read('ui.js'),INDEX=read('index.html');
// Session fixture in the real backend shape: online:true and a 64-character lowercase hex token (see SESSION-NOTES.md).
const TOKEN='ab12'.repeat(16);

function element(id){return {id,textContent:'',className:'',value:'',disabled:false,hidden:false,dataset:{},children:[],listeners:{},scrollTop:0,scrollHeight:0,addEventListener(t,f){this.listeners[t]=f;},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},focus(){},scrollIntoView(){},remove(){},click(){}};}
function storage(){const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i]??null,getItem:k=>m.has(k)?m.get(k):null,setItem(k,v){m.set(String(k),String(v));},removeItem(k){m.delete(k);},dump:()=>JSON.stringify([...m])};}
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,3));};
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const notJson=(status=200)=>({ok:status>=200&&status<300,status,json:async()=>{throw new SyntaxError('Unexpected token <');}});

// Loads the page scripts in browser order. `api(url,init)` answers every fetch.
async function load(api,onLine=true){
 const els={},calls=[],local=storage(),session=storage(),win={};
 els.relogin=element('relogin');els.relogin.hidden=true; // as in index.html
 const document={hidden:false,getElementById:id=>els[id]||(els[id]=element(id)),createElement:t=>element(t),querySelector:()=>null,addEventListener(){}};
 const navigator={onLine,locks:{request:(name,opts,fn)=>Promise.resolve().then(()=>fn()),query:async()=>({held:[],pending:[]})}};
 const sandbox={document,navigator,localStorage:local,sessionStorage:session,crypto:webcrypto,setTimeout,clearTimeout,TextEncoder,URL,Blob,AbortController,console,
  addEventListener(t,f){win[t]=f;},fetch:async(url,init={})=>{calls.push({url:String(url),init});return api(String(url),init);}};
 sandbox.window=sandbox;
 const ctx=vm.createContext(sandbox);
 for(const f of ['handoff-session.js','assistant-session.js','conversation-bank.js','draft-recovery.js','ui.js'])vm.runInContext(read(f),ctx,{filename:f});
 await settle();
 const page={els,calls,local,session,win,navigator,token:()=>vm.runInContext('token',ctx),dump:()=>local.dump()+session.dump(),
  submit:async()=>{els.composer.listeners.submit({preventDefault(){}});await settle();},
  type:async text=>{els.input.value=text;els.input.listeners.input();await settle();}};
 return page;
}
function assertAiOff(p){
 assert.equal(p.token(),null);assert.equal(p.els.send.disabled,true,'Wyślij stays disabled');assert.equal(p.els.mic.disabled,true,'Mów stays disabled');
 assert.ok(!/OpenAI ·/.test(p.els.status.textContent),'no claim that the model is ready: '+p.els.status.textContent);
 assert.equal(p.els.input.disabled,false,'the text field stays usable');
}

test('page: build label, truthful pilot wording, re-login link, original asset references',()=>{
 assert.match(INDEX,/<title>Empire Code — PRIVATE-PILOT-7<\/title>/);assert.match(INDEX,/<span class="build">PRIVATE-PILOT-7<\/span>/);
 assert.ok(INDEX.includes('Prywatny pilot PRIVATE-PILOT-7.'),'the help text names the current release');assert.ok(!INDEX.includes('PRIVATE-PILOT-4'),'no stale release label');assert.ok(!INDEX.includes('PRIVATE-PILOT-5'),'no label of the previous release');assert.ok(!INDEX.includes('PRIVATE-PILOT-'+'6'),'no label of the build before this one');
 assert.match(INDEX,/<a id="relogin" href="\/_auth" target="_self" hidden>Zaloguj ponownie<\/a>/);
 assert.ok(!/działa na Macu|127\.0\.0\.1|localhost|WORKSPACE-4/.test(INDEX));
 for(const s of ['tylko do logowania i do rozmowy AI','nie są automatycznie importowane','AI jest pokazywane jako niedostępne','nie stanowi odbioru na fizycznym iPhonie','Ten etap nie jest zweryfikowanym AI Chat o przepisach'])assert.ok(INDEX.includes(s),s);
 for(const id of ['nav-talk','nav-jobs','nav-tools','nav-code','conversation-panel','new','job-target','conversation-select','job-refresh','job-new','job-new-form','job-new-title','context-active','job-status','messages','example','composer','input','mic','cancel','send','status','count','undo','draft-note','items','handoff-panel','copy','export','core-panel','core-frame'])assert.ok(INDEX.includes('id="'+id+'"'),id);
 for(const ref of ['/style.css','/handoff-session.js','/assistant-session.js','/conversation-bank.js','/draft-recovery.js','/ui.js','/material-edit-host.js','/workspace-host.js','/workspace/mobile.html'])assert.ok(INDEX.includes('"'+ref+'"'),ref);
 // Script order of the page: assistant-session.js is loaded before ui.js, which uses ASession while it loads.
 const order=['/handoff-session.js','/assistant-session.js','/conversation-bank.js','/draft-recovery.js','/ui.js','/material-edit-host.js','/workspace-host.js'].map(s=>INDEX.indexOf('<script src="'+s+'" defer></script>'));
 assert.ok(order.every((at,i)=>at>=0&&(i===0||at>order[i-1])),'required scripts are referenced once each, in load order');
});

test('source: every /api call refuses redirects; no cookie access, no automatic navigation',()=>{
 for(const p of ['/api/session','/api/assist','/api/transcribe']){const i=UI.indexOf("fetch('"+p+"'");assert.ok(i>=0,p);assert.ok(UI.slice(i,UI.indexOf(')',UI.indexOf("redirect:'error'",i))).includes("redirect:'error'"),p);assert.ok(UI.indexOf("redirect:'error'",i)-i<400,p);}
 assert.ok(!/document\.cookie|CF_Authorization|location\.(href|assign|replace)|window\.open/.test(UI));
 assert.ok(!/serviceWorker\.[a-z]*sync|SyncManager|sendBeacon/i.test(UI));
});

test('AI_NOT_CONFIGURED: nothing is enabled, nothing stored changes, no re-login link',async()=>{
 let answer;const pending=new Promise(r=>{answer=r;});
 const p=await load(url=>url==='/api/session'?pending:Promise.reject(Error('unexpected '+url)));
 const stored=p.dump();assert.notEqual(p.local.length,0,'the page stored its first conversation before the session answered');
 answer(json({online:false,token:null,reason:'AI_NOT_CONFIGURED'}));await settle();
 assertAiOff(p);
 assert.match(p.els.status.textContent,/AI nie jest jeszcze podłączone/);assert.match(p.els.status.textContent,/Roboty/);
 assert.equal(p.els.relogin.hidden,true,'a login link would be misleading here');
 assert.equal(p.dump(),stored,'the session answer does not touch stored data');
 assert.equal(p.calls[0].url,'/api/session');assert.equal(p.calls[0].init.redirect,'error');assert.equal(p.calls[0].init.cache,'no-store');
 p.els.input.value='dwa breakery';await p.submit();
 assert.deepEqual(p.calls.map(c=>c.url),['/api/session'],'nothing is sent without a session token');
 assert.equal(p.els.input.value,'dwa breakery');assert.equal(p.dump(),stored);
});

test('missing or contradictory token: sends stay disabled and stored state is untouched',async()=>{
 for(const body of [{online:true},{online:true,token:null},{online:true,token:''},{online:true,token:42},{online:false,token:'looks-real',model:'m'},{},[]]){
  let answer;const pending=new Promise(r=>{answer=r;});
  const p=await load(()=>pending),stored=p.dump();
  answer(json(body));await settle();
  assertAiOff(p);assert.equal(p.dump(),stored,JSON.stringify(body));
  await p.submit();assert.equal(p.calls.length,1,JSON.stringify(body));
 }
});

test('a real session token enables the existing workflow',async()=>{
 for(const body of [{online:true,token:TOKEN,model:'model-x'}]){
  const p=await load(()=>json(body));
  assert.equal(p.token(),TOKEN);assert.equal(p.els.send.disabled,false);assert.equal(p.els.mic.disabled,false);
  assert.match(p.els.status.textContent,/^OpenAI · model-x/);assert.equal(p.els.relogin.hidden,true);
 }
});

test('session unreachable: local use stays open; the re-login link shows only for auth/network failures while online',async()=>{
 const redirect=()=>Promise.reject(new TypeError('Failed to fetch'));
 let p=await load(redirect);
 assertAiOff(p);assert.equal(p.els.relogin.hidden,false);assert.match(p.els.status.textContent,/Zaloguj ponownie/);assert.match(p.els.status.textContent,/bez logowania/);
 for(const answer of [()=>json({error:'forbidden'},403),()=>json({},401),()=>notJson(200)]){p=await load(answer);assertAiOff(p);assert.equal(p.els.relogin.hidden,false);}
 p=await load(()=>json({error:'x'},503));assertAiOff(p);assert.equal(p.els.relogin.hidden,true,'server error is not a login problem');
 p=await load(redirect,false);assertAiOff(p);assert.equal(p.els.relogin.hidden,true,'offline: no login link');
});

test('talk blocked by an expired login: draft kept and stored, no retry, re-login link shown',async()=>{
 for(const talk of [()=>Promise.reject(new TypeError('Failed to fetch')),()=>notJson(200),()=>json({error:'Sesja wygasła.'},401)]){
  const p=await load(url=>url==='/api/session'?json({online:true,token:TOKEN,model:'m'}):talk());
  await p.type('dwa kable 50 fit');
  assert.ok(p.local.dump().includes('dwa kable 50 fit'),'the unsent text is stored before any send');
  await p.submit();
  const sent=p.calls.filter(c=>c.url==='/api/assist');
  assert.equal(sent.length,1,'exactly one attempt, no automatic retry');assert.equal(sent[0].init.redirect,'error');
  assert.equal(p.els.input.value,'dwa kable 50 fit','the text stays in the field');
  assert.ok(p.local.dump().includes('dwa kable 50 fit'),'the text stays stored');
  assert.equal(p.els.relogin.hidden,false);assert.equal(p.els.status.className,'error');
  assert.equal(p.els.input.disabled,false,'controls are released after the failure');
  assert.equal(p.token(),null,'the stale token is dropped');assert.equal(p.els.send.disabled,true,'no further post with a lost login');
  assert.equal(p.calls.filter(c=>c.url==='/api/session').length,1,'no hidden session request');
 }
});
