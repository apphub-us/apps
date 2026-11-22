'use strict';
// Conversation UI session states in a VM with a minimal DOM/storage mock and the real storage modules.
// No network: fetch is a local stub. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const DIR=process.env.EC_SESSION_BASELINE_DIR?path.resolve(process.env.EC_SESSION_BASELINE_DIR):path.resolve(__dirname,'../candidate/browser'),read=f=>fs.readFileSync(path.join(DIR,f),'utf8');
const UI=read('ui.js'),INDEX=read('index.html');

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
 const page={els,calls,local,session,win,navigator,run:code=>vm.runInContext(code,ctx),token:()=>vm.runInContext('token',ctx),dump:()=>local.dump()+session.dump(),
  submit:async()=>{els.composer.listeners.submit({preventDefault(){}});await settle();},
  type:async text=>{els.input.value=text;els.input.listeners.input();await settle();}};
 return page;
}
function assertAiOff(p){
 assert.equal(p.token(),null);assert.equal(p.els.send.disabled,true,'Wyślij stays disabled');assert.equal(p.els.mic.disabled,true,'Mów stays disabled');
 assert.ok(!/OpenAI ·/.test(p.els.status.textContent),'no claim that the model is ready: '+p.els.status.textContent);
 assert.equal(p.els.input.disabled,false,'the text field stays usable');
}


const GOOD={online:true,token:'a'.repeat(64),model:'synthetic-model'},NEW={...GOOD,token:'b'.repeat(64)};
const phrase='Synthetic material note only — żadnych danych robót';
for(const [code,http] of [['API_AUTH',401],['API_ACCESS',403],['API_QUOTA',429]])test('independent: '+code+' is an upstream problem, never Cloudflare login',async()=>{
 const p=await load(url=>url==='/api/session'?json(GOOD):json({code,error:'Synthetic provider diagnosis: '+code},http));
 await p.type(phrase);const before=p.run('JSON.stringify(state)');await p.submit();
 assert.equal(p.els.relogin.hidden,true);assert.equal(p.run('JSON.stringify(state)'),before);assert.equal(p.els.input.value,phrase);assert.equal(p.calls.filter(c=>c.url==='/api/assist').length,1);assert.equal(p.calls.filter(c=>c.url==='/api/session').length,1);assert.match(p.els.status.textContent,new RegExp(code));
});
test('independent: a real Access denial clears stale session and disables AI, retaining text',async()=>{
 const p=await load(url=>url==='/api/session'?json(GOOD):json({error:'Forbidden'},403));await p.type(phrase);await p.submit();assert.equal(p.token(),null);assert.equal(p.els.send.disabled,true);assert.equal(p.els.mic.disabled,true);assert.equal(p.els.relogin.hidden,false);assert.equal(p.els.input.value,phrase);await p.submit();assert.equal(p.calls.filter(c=>c.url==='/api/assist').length,1);
});
test('independent: non-JSON login HTML never leaves an enabled stale session',async()=>{
 const p=await load(url=>url==='/api/session'?json(GOOD):notJson());await p.type(phrase);await p.submit();assert.equal(p.token(),null);assert.equal(p.els.send.disabled,true);assert.equal(p.els.input.value,phrase);assert.ok(!p.els.status.textContent.includes('<html'));assert.equal(p.els.relogin.hidden,false);
});
test('independent: rejected session renews with one free GET and never repeats the original AI request',async()=>{
 let gets=0;const p=await load(url=>url==='/api/session'?json(++gets===1?GOOD:NEW):json({code:'SESSION_TOKEN',error:'Synthetic expired session'},403));
 await p.type(phrase);const before=p.run('JSON.stringify(state)');await p.submit();assert.equal(gets,2);assert.equal(p.calls.filter(c=>c.url==='/api/assist').length,1);assert.equal(p.token(),NEW.token);assert.equal(p.els.send.disabled,false);assert.equal(p.els.relogin.hidden,true);assert.equal(p.els.input.value,phrase);assert.equal(p.run('JSON.stringify(state)'),before);assert.match(p.els.status.textContent,/nie.*wysł|Wyślij|wyślij/);
});
test('independent: failed renewal does not loop and cannot claim the message was sent',async()=>{
 let gets=0;const p=await load(url=>url==='/api/session'?(++gets===1?json(GOOD):notJson()):json({code:'SESSION_TOKEN',error:'Expired'},403));await p.type(phrase);await p.submit();assert.equal(gets,2);assert.equal(p.calls.filter(c=>c.url==='/api/assist').length,1);assert.equal(p.token(),null);assert.equal(p.els.relogin.hidden,false);assert.equal(p.els.input.value,phrase);assert.ok(!/zapisano|zaktualizowano/i.test(p.els.status.textContent));
});
test('independent: malformed session cannot enable inference even with a nonempty fake token',async()=>{
 for(const x of [{token:GOOD.token},{online:true,token:'bad'}, {...GOOD,token:GOOD.token.toUpperCase()}, {online:'true',token:GOOD.token}]){
  const p=await load(()=>json(x));assert.equal(p.token(),null,JSON.stringify(x));assert.equal(p.els.send.disabled,true);assert.equal(p.els.mic.disabled,true);assert.equal(p.calls.length,1);
 }
});
test('independent: cancelled delayed expired-token result does not renew, replay or overwrite text',async()=>{
 let finish;const pending=new Promise(r=>finish=r);const p=await load(url=>url==='/api/session'?json(GOOD):pending);await p.type(phrase);await p.submit();assert.equal(p.run('busy'),true);p.els.cancel.onclick();finish(json({code:'SESSION_TOKEN',error:'Expired'},403));await settle();assert.equal(p.calls.length,2);assert.equal(p.els.input.value,phrase);assert.equal(p.run('busy'),false);assert.equal(p.els.relogin.hidden,true);
});
test('independent: offline text remains locally durable and no API post is scheduled',async()=>{
 const p=await load(()=>json(GOOD));await p.type(phrase);p.navigator.onLine=false;p.win.offline();await p.submit();assert.equal(p.calls.filter(c=>c.url!=='/api/session').length,0);assert.equal(p.els.input.value,phrase);assert.ok(p.local.dump().includes(phrase));assert.equal(p.els.relogin.hidden,true);
});
