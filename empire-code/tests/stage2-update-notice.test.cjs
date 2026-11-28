'use strict';
// New-version notice (EC-11): the open page notices that a different shell worker took over, offers an explicit switch,
// never reloads by itself and never reloads before the draft is durable. Page scripts and the worker template run in isolated
// VMs with a fake ServiceWorker container; no real browser, no network, no build step. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const H=require('./stage2-harness.cjs');
const {KEY}=H;
const PIN_A='a1'.repeat(32),PIN_B='b2'.repeat(32);

// One-way channel as the page uses it: the worker answers on port2, the page listens on port1.
class Channel{constructor(){const port1={onmessage:null,close(){}};this.port1=port1;this.port2={postMessage:data=>{if(port1.onmessage)port1.onmessage({data});}};}}
// A fake worker. `answer` is what it posts back for a version question (undefined = it never answers, like a worker without the handler).
function worker(answer,state='activated'){
 return {state,asked:[],listeners:{},addEventListener(t,f){this.listeners[t]=f;},
  postMessage(data,ports){this.asked.push(data);if(answer===undefined)return;const port=ports&&ports[0];Promise.resolve().then(()=>port.postMessage(typeof answer==='string'?{type:'empire-shell-version',pin:answer}:answer));}};
}
function container(controller,registration){
 const c={controller,listeners:{},registered:0,addEventListener(t,f){this.listeners[t]=f;},register(){c.registered++;return Promise.resolve(registration||{});},
  ready:registration?Promise.resolve(registration):new Promise(()=>{}),
  // What the browser does when a worker claims the page.
  takeOver:async w=>{c.controller=w;c.listeners.controllerchange({});await H.settle();}};
 return c;
}
const registration=()=>({waiting:null,installing:null,listeners:{},addEventListener(t,f){this.listeners[t]=f;}});
const page=(sw,o={})=>H.load({serviceWorker:sw,MessageChannel:Channel,fastTimers:true,...o});
const banner=p=>p.els['update-banner'];

test('first installation: a page loaded without a controller and then claimed shows no notice and is never reloaded',async()=>{
 const sw=container(null),p=await page(sw);
 assert.equal(sw.registered,1,'the worker is registered as before');assert.equal(banner(p).hidden,true);
 await sw.takeOver(worker(PIN_A));
 assert.equal(banner(p).hidden,true,'the first controller is the version this page runs');
 assert.equal(p.reloads.length,0);
 // the first REAL update after that is recognised
 await sw.takeOver(worker(PIN_B));
 assert.equal(banner(p).hidden,false);assert.equal(p.reloads.length,0);
});

test('update: a different worker takes over a controlled page — notice shown, nothing reloaded, typing continues',async()=>{
 const first=worker(PIN_A),sw=container(first),p=await page(sw);
 // compared as JSON: objects created inside the VM have another prototype
 assert.equal(banner(p).hidden,true);assert.equal(JSON.stringify(first.asked),'[{"type":"empire-shell-version"}]','only the version question is ever sent to a worker');
 await p.type('niewysłany tekst sprzed nowej wersji');
 const next=worker(PIN_B);await sw.takeOver(next);
 assert.equal(banner(p).hidden,false);assert.equal(JSON.stringify(next.asked),'[{"type":"empire-shell-version"}]');
 assert.equal(p.reloads.length,0,'no reload without the user');
 assert.equal(p.els.input.value,'niewysłany tekst sprzed nowej wersji');assert.equal(p.els.input.disabled,false);
 await p.type('niewysłany tekst sprzed nowej wersji, pisany dalej');
 assert.equal(p.bank().contexts[0].input,'niewysłany tekst sprzed nowej wersji, pisany dalej','the old page keeps working and saving');
 assert.equal(p.reloads.length,0);
});

test('explicit switch: the draft is saved first, then exactly one reload',async()=>{
 const sw=container(worker(PIN_A)),p=await page(sw);
 await sw.takeOver(worker(PIN_B));
 p.els.input.value='wpisane tuż przed kliknięciem, jeszcze niezapisane';
 await p.click('update-reload');
 assert.equal(p.reloads.length,1);
 assert.ok(p.reloads[0].includes('wpisane tuż przed kliknięciem, jeszcze niezapisane'),'storage held the text at the moment of the reload');
 assert.equal(JSON.parse(p.local.getItem(KEY)).contexts[0].input,'wpisane tuż przed kliknięciem, jeszcze niezapisane');
});

test('save failure prevents the reload and offers a recovery copy instead',async()=>{
 const sw=container(worker(PIN_A)),p=await page(sw);
 await p.type('zapisany tekst');await sw.takeOver(worker(PIN_B));
 const stored=p.local.getItem(KEY);
 p.local.refuse=()=>true;                                              // the browser refuses every write
 p.els.input.value='tekst, którego nie da się teraz zapisać';
 assert.equal(p.els['update-export'].hidden,true);
 await p.click('update-reload');
 assert.equal(p.reloads.length,0,'no reload while the text is durable nowhere');
 assert.equal(p.els['update-status'].className,'error');assert.match(p.els['update-status'].textContent,/The new version was not started/);assert.match(p.els['update-status'].textContent,/nothing was lost/);
 assert.equal(p.els.input.value,'tekst, którego nie da się teraz zapisać');assert.equal(p.local.getItem(KEY),stored);
 assert.equal(banner(p).hidden,false);assert.equal(p.els['update-export'].hidden,false);assert.equal(p.find('update-reload').disabled,false,'it can be tried again');
 await p.click('update-export');
 const file=JSON.parse(p.downloads[p.downloads.length-1]);
 assert.equal(file.kind,'empire-code.storage-recovery');assert.equal(file.screen.unsentText,'tekst, którego nie da się teraz zapisać');assert.equal(file.bankRaw,stored);
 assert.equal(p.reloads.length,0);
 // once the browser accepts writes again the same click saves and switches
 p.local.refuse=null;await p.click('update-reload');
 assert.equal(p.reloads.length,1);assert.equal(JSON.parse(p.local.getItem(KEY)).contexts[0].input,'tekst, którego nie da się teraz zapisać');
});

test('an open unsaved job form or a tab that lost its conversation also blocks the reload',async()=>{
 let form=true;
 const sw=container(worker(PIN_A)),p=await page(sw,{formOpen:()=>form});
 await sw.takeOver(worker(PIN_B));
 await p.click('update-reload');
 assert.equal(p.reloads.length,0);assert.match(p.els['update-status'].textContent,/unsaved form is open in the Jobs tab/);
 form=false;
 p.local.setItem(KEY,JSON.stringify({...p.bank(),version:3}));await p.storageEvent(KEY);   // rewritten by a newer application
 await p.click('update-reload');
 assert.equal(p.reloads.length,0);assert.equal(p.els['update-export'].hidden,false);
});

test('no false notice: same version, unknown or malformed answers; a waiting worker with a different version is offered',async()=>{
 // a worker that takes over but carries the running version (should not happen; must not alarm)
 let sw=container(worker(PIN_A)),p=await page(sw);
 await sw.takeOver(worker(PIN_A));assert.equal(banner(p).hidden,true);
 // an installed (waiting) worker: offered only when both versions are known and differ
 const reg=registration();sw=container(worker(PIN_A),reg);p=await page(sw);
 for(const bad of [{type:'empire-shell-version',pin:'not-a-pin'},{type:'empire-shell-version',pin:PIN_B,reload:true},{type:'reload'},'x'.repeat(64),PIN_A]){
  const w=worker(bad,'installed');reg.installing=w;reg.listeners.updatefound({});await H.settle();
  assert.equal(banner(p).hidden,true,JSON.stringify(bad));assert.equal(p.reloads.length,0);
 }
 const installing=worker(PIN_B,'installing');reg.installing=installing;reg.listeners.updatefound({});await H.settle();
 assert.equal(banner(p).hidden,true,'not offered while it is still installing');
 installing.state='installed';installing.listeners.statechange({});await H.settle();
 assert.equal(banner(p).hidden,false);assert.equal(p.reloads.length,0);
 // a page that never learnt its own version does not guess from a waiting worker
 const reg2=registration();sw=container(null,reg2);p=await page(sw);
 reg2.installing=worker(PIN_B,'installed');reg2.listeners.updatefound({});await H.settle();
 assert.equal(banner(p).hidden,true);
});

test('a worker that replaces the controller but does not answer is still a new version (bounded wait, no reload)',async()=>{
 const sw=container(worker(PIN_A)),p=await page(sw);
 await sw.takeOver(worker(undefined));await H.settle(30);
 assert.equal(banner(p).hidden,false);assert.equal(p.reloads.length,0);
});

test('page source: the only reload is the click handler of the notice; no polling, no worker-driven navigation',()=>{
 const host=H.read('workspace-host.js'),ui=H.read('ui.js'),index=H.read('index.html');
 assert.equal(host.split('location.reload(').length-1,1);assert.equal(ui.split('.reload(').length-1,0);
 const handler=host.slice(host.indexOf("$('update-reload').onclick"),host.indexOf("$('update-export').onclick"));
 assert.ok(handler.includes('location.reload()'),'the reload lives inside the explicit click handler');
 assert.ok(handler.indexOf('flushInput()')>0&&handler.indexOf('flushInput()')<handler.indexOf('location.reload()'),'saving comes before the reload');
 for(const src of [host,ui])assert.ok(!/setInterval|registration\.update\(|\.update\(\)|skipWaiting|location\.(href|assign|replace)/.test(src));
 assert.equal(host.split('fetch(').length-1,0,'the notice asks no server');
 assert.match(index,/<section id="update-banner"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden>/);
 assert.match(index,/<strong id="update-title">A new version is ready\.<\/strong>/);
 assert.match(index,/<button id="update-reload"[^>]*type="button">/);
 // The page carries the label of the release it belongs to (the builder's own constant) in the title and in the header, and no
 // label of an earlier release: the notice is what moves an open tab from one labelled build to the next.
 const build=require('../candidate/build.cjs').BUILD;
 assert.equal(build,'PRIVATE-PILOT-8');
 assert.ok(index.includes('<title>Empire Code — '+build+'</title>'),'title label');assert.ok(index.includes('<span class="build">'+build+'</span>'),'header label');
 assert.deepEqual([...new Set(index.match(/PRIVATE-PILOT-\d+/g))],[build],'no stale build label on the page');
});

// --- Worker side --------------------------------------------------------------------------------------------------------
// The template with its two build placeholders filled by hand (the build does the same substitution).
function shellWorker(){
 const origin='https://pilot.example',log={skip:0,claim:0,cache:0,fetch:0},listeners={};
 const text=H.read('sw.js').replace("'__EC_SHELL_PIN__'",JSON.stringify(PIN_A)).replace('__EC_SHELL_MANIFEST__','[]');
 assert.ok(!text.includes('__EC_SHELL_'),'both placeholders were present exactly as the build expects');
 const touch=()=>{log.cache++;throw Error('cache access in a message handler');};
 const self={location:{origin},addEventListener(t,f){listeners[t]=f;},skipWaiting:async()=>{log.skip++;},clients:{claim:async()=>{log.claim++;},matchAll:async()=>{log.claim++;return [];}}};
 vm.runInContext(text,vm.createContext({self,caches:{has:touch,open:touch,delete:touch,keys:touch},fetch:async()=>{log.fetch++;throw Error('network in a message handler');},crypto:H.webcrypto,Response,URL,console}),{filename:'sw.template.js'});
 const ask=(over={})=>{const sent=[],event={data:{type:'empire-shell-version'},origin,source:{type:'window',url:origin+'/'},ports:[{postMessage:d=>sent.push(d)}],...over};listeners.message(event);return sent;};
 return {origin,log,listeners,ask};
}

test('worker: answers the version question of a same-origin window with its pin, on the supplied port only',()=>{
 const w=shellWorker();
 assert.equal(typeof w.listeners.message,'function');
 assert.equal(JSON.stringify(w.ask()),JSON.stringify([{type:'empire-shell-version',pin:PIN_A}]));
 assert.equal(JSON.stringify(w.ask({source:{type:'window',url:w.origin+'/workspace/mobile.html'}})),JSON.stringify([{type:'empire-shell-version',pin:PIN_A}]));
 assert.deepEqual(w.log,{skip:0,claim:0,cache:0,fetch:0},'a message never skips waiting, claims, fetches or touches a cache');
});

test('worker: every other message, shape, origin or sender is ignored and triggers nothing',()=>{
 const w=shellWorker(),ok={type:'empire-shell-version'};
 const ignored=[
  ['other origin',{origin:'https://evil.example'}],['window of another origin',{source:{type:'window',url:'https://evil.example/'}}],
  ['origin-prefix lookalike',{source:{type:'window',url:w.origin+'.evil.example/'}}],
  ['a worker client',{source:{type:'worker',url:w.origin+'/x.js'}}],['no sender',{source:null}],['no port',{ports:[]}],
  ['extra field',{data:{...ok,reload:true}}],['refresh command',{data:{type:'reload'}}],['skip-waiting command',{data:{type:'SKIP_WAITING'}}],
  ['string',{data:'empire-shell-version'}],['array',{data:[ok]}],['null',{data:null}]
 ];
 for(const [label,over] of ignored)assert.equal(w.ask(over).length,0,label);
 assert.deepEqual(w.log,{skip:0,claim:0,cache:0,fetch:0});
});
