'use strict';
// Stage 5 client, boundaries outside the same-realm fixtures of stage5-client-assistant.test.cjs:
//   1. two realms — the page scripts run in the VM context of the stage2 harness, while the tools frame of these tests is made of
//      objects of THIS (Node main) realm: the REAL form bridge (candidate/browser/workspace/assistant-bridge.js), the REAL
//      registry (core/src/calc/conversationTools.js) and this realm's JSON as the frame's JSON. A request built by the page is
//      therefore a foreign object for the bridge, exactly like parent page -> iframe in a browser;
//   2. the linked form: an answer is accepted only while the form is exactly as it was captured (bridge generation, active tool,
//      frame document);
//   3. the job is read under the conversation lock, so a job revision saved while an answer waits for the lock refuses it;
//   4. the Load Calc form serves four registry tools; the user chooses the analysis, the bridge captures the CURRENT form.
// Form side: compact fixtures written here (controls / page readers in the shape the bridge documents); the shipped
// mobile.html is not loaded, so nothing here shows the real page markup. The server is a fixture: every "model" answer is a
// hand-written function call executed by the real registry. No network, no provider, no browser.
// Authored, not executed by the author. Run: node --test tests/stage5-client-boundaries.test.cjs
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const H=require('./stage2-harness.cjs');
const T=require('../core/src/calc/conversationTools.js');
const B=require('../candidate/browser/workspace/assistant-bridge.js');
const BAT=require('../core/src/calc/batteryRuntime.js');
const SV=require('../core/src/calc/loadCalcStateV2.js');
const F=require('../core/src/calc/loadCalcFacade.js');
const S=require('../core/src/calc/loadCalcServiceSizing.js');
const A=require('../core/src/jobs/jobConversationActions.js');
const M=require('../core/src/jobs/jobMeasurement.js');
const {createJobStore}=require('../core/src/jobs/jobCardStore.js');
const {makeIndexedDb,deterministicCrypto}=require('../core/test/helpers/jobIndexedDb.js');
const TOKEN='ab'.repeat(32),T0='2020-01-15T09:00:00.000Z';
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const own=x=>JSON.parse(JSON.stringify(x));
const sessionBody=()=>({build:'PRIVATE-PILOT-5',model:'model-x',speechModel:'speech-x',online:true,prototype:true,remainingRequests:60,token:TOKEN,reason:null});
const until=async(check,ms=4000)=>{const end=Date.now()+ms;for(;;){if(check())return;if(Date.now()>end)throw Error('condition not reached');await H.settle(2);}};
const idle=p=>until(()=>!p.run('busy')&&!p.run('audioBusy')&&!p.run('handoffBusy'));
const send=async(p,text)=>{await p.type(text);await p.submit();await idle(p);};
function server(script,seen=[]){
 return (url,init)=>{
  if(url==='/api/session')return json(sessionBody());
  if(url!=='/api/assist')throw Error('unexpected request '+url);
  const body=JSON.parse(init.body);seen.push({body,init});
  const next=script.shift();if(!next)throw Error('unexpected extra /api/assist request');
  return next(body,init);
 };
}
const four=d=>({tool:d.tool,input:own(d.input),origins:own(d.origins),fingerprint:d.fingerprint});
// What the real server does for one calculator function call: the registry merges the typed change into the draft the client sent.
function calculator(tool,args){
 return body=>{
  const d=body.assistant.toolDraft,draft=d&&d.tool===tool?{kind:T.DRAFT_KIND,revision:T.CONTRACT_REVISION,...d,result:null,resultFingerprint:null}:null;
  const out=T.handleToolCall({name:T.PROVIDER_TOOL_PREFIX+tool,args,draft});
  assert.equal(out.ok,true,JSON.stringify(out.errors));
  return json(H.assistAnswer(body,{domain:'calculator',reply:T.formatResult(out.result,'pl').slice(0,900),assistant:{toolDraft:four(out.draft),changedFields:out.changedFields.slice(),result:own(out.result)}}));
 };
}
// An answer that arrives only when the test lets it.
function gated(answer){let open;const gate=new Promise(r=>{open=r;});return {open,answer:async body=>{await gate;return answer(body);}};}
const shown=p=>JSON.parse(p.run('JSON.stringify(assistShown&&assistShown.result)'));
const storedAssistant=p=>p.bank().contexts.find(e=>e.contextId===p.active()).envelope.assistant;
const frameOf=p=>p.els['core-frame'].contentWindow;
const walk=el=>el?[el].concat((el.children||[]).flatMap(walk)):[];

// --- The tools frame document of these tests (objects of the Node main realm) -----------------------------------------------
function ctl(value,options){
 const set=new Set(),n={value,style:{},classList:{add:c=>set.add(c),remove:c=>set.delete(c),contains:c=>set.has(c)}};
 if(options)n.options=options.map(v=>({value:v}));
 return n;
}
function frameDoc(els){
 const listeners={};
 return {readyState:'complete',getElementById:id=>(Object.hasOwn(els,id)?els[id]:null),querySelectorAll:()=>[],
  addEventListener(type,fn){(listeners[type]=listeners[type]||[]).push(fn);},fire(type){for(const fn of listeners[type]||[])fn({type});}};
}
// The bridge as the page reaches it, with every capture and apply call recorded as it ARRIVES (before the bridge judges it).
const watched=(bridge,log)=>({getState:()=>bridge.getState(),capture:id=>{log.captures.push(id===undefined?null:id);return bridge.capture(id);},apply:r=>{log.applies.push(r);return bridge.apply(r);},navigate:id=>bridge.navigate(id)});
const BATTERY={capacityWh:1000,consumptionMode:'kwh_year',consumption:365,chargePercent:100,usablePercent:85};
const START={capacity:'1000',mode:'kwh_year',consumption:'365',charge:'100',usable:'85'};
// The Wh / Runtime tab of the converter: five controls, the page's reader (raw field text) and its two render functions.
function batteryForm(bootId='boot-a'){
 const els={'panel-more':ctl(''),'sub-converter':ctl(''),'cvt-battery':ctl(''),'bt-capacity':ctl(START.capacity),'bt-mode':ctl(START.mode,['w','kwh_day','kwh_year']),'bt-consumption':ctl(START.consumption),'bt-charge':ctl(START.charge),'bt-usable':ctl(START.usable)};
 els['panel-more'].classList.add('active');
 const doc=frameDoc(els),calls={btCalc:0,btSyncUnit:0};
 const globals={currentMoreTab:'converter',btCalc:()=>{calls.btCalc++;},btSyncUnit:()=>{calls.btSyncUnit++;},
  btRead:()=>({capacityWh:els['bt-capacity'].value,consumptionMode:els['bt-mode'].value,consumption:els['bt-consumption'].value,chargePercent:els['bt-charge'].value,usablePercent:els['bt-usable'].value})};
 const EC={conversationTools:T,batteryRuntime:BAT};
 const bridge=B.createBridge({document:doc,registry:()=>T,ec:()=>EC,page:n=>globals[n],host:()=>null,bootId});
 return {els,doc,calls,bridge,
  // What a user edit does: the control changes and the document sees a real input event.
  user(id,value){els[id].value=value;doc.fire('input');},
  values:()=>({capacity:els['bt-capacity'].value,mode:els['bt-mode'].value,consumption:els['bt-consumption'].value,charge:els['bt-charge'].value,usable:els['bt-usable'].value})};
}
async function batteryPage(script,seen=[]){
 const form=batteryForm(),log={captures:[],applies:[]};
 const p=await H.load({frame:{EC:{conversationTools:T},ECAssistantBridge:watched(form.bridge,log)},api:server(script,seen)});
 return {p,form,log,seen};
}

test('two realms: the page-built correction is re-created in the frame realm and the REAL bridge and registry write only the changed field',async()=>{
 const {p,form,log}=await batteryPage([calculator('battery_runtime',{set:{chargePercent:50},clear:[]})]);
 assert.notEqual(p.run('Object.prototype'),Object.prototype,'the page and the tools frame of this test are different realms');
 await p.click('assist-use-form');
 assert.deepEqual(log.captures,[null],'a form with one calculator is captured without an id, as before');
 assert.deepEqual(storedAssistant(p).tool.input,BATTERY);assert.ok(Object.values(storedAssistant(p).tool.origins).every(o=>o==='current_form'));
 const captured=form.bridge.getState().generation;assert.equal(p.run('assistLink.generation'),captured);
 // The bridge's own guard is untouched: an object literal of the page realm is still refused, before anything is read or written.
 const foreign=JSON.parse(p.run("JSON.stringify(assistForms().apply({toolId:'battery_runtime',expectedGeneration:assistLink.generation,patch:{set:{chargePercent:40},clear:[]}}))"));
 assert.equal(foreign.status,'invalid_request');assert.equal(foreign.reason,'REQUEST_SHAPE');assert.equal(foreign.applied,false);
 assert.deepEqual(form.values(),START);assert.equal(form.bridge.getState().generation,captured,'a refused request leaves the generation alone');
 // The real client path: answer accepted, then assistFormApply -> ECAssistantBridge.apply.
 await send(p,'naładowanie 50 procent');
 assert.equal(p.run('state.history.length'),2);assert.equal(p.els.input.value,'');
 const request=log.applies[log.applies.length-1];
 assert.equal(Object.getPrototypeOf(request),Object.prototype,'the request the bridge received is a plain object of the frame realm');
 assert.equal(Object.getPrototypeOf(request.patch),Object.prototype);assert.equal(Object.getPrototypeOf(request.patch.set),Object.prototype);assert.equal(Object.getPrototypeOf(request.patch.clear),Array.prototype);
 assert.deepEqual(request,{toolId:'battery_runtime',expectedGeneration:captured,patch:{set:{chargePercent:50},clear:[]}},'the closed request: only the changed field, with the capture generation');
 assert.deepEqual(form.values(),{...START,charge:'50'},'the form holds the correction; every other control is exactly as before');
 assert.equal(form.calls.btCalc,1,'the form rendered through its own function, once');
 assert.match(p.els['assist-status'].textContent,/also entered in the open form/);
 assert.equal(p.run('assistLink.generation'),form.bridge.getState().generation,'the link follows the generation of the accepted write');
 assert.notEqual(form.bridge.getState().generation,captured);
 // The conversation keeps every unchanged field and its provenance; the result is computed by the registry of the frame.
 const kept=storedAssistant(p).tool;
 assert.deepEqual(kept.input,{...BATTERY,chargePercent:50});assert.equal(kept.origins.chargePercent,'conversation');
 for(const k of Object.keys(BATTERY))if(k!=='chargePercent')assert.equal(kept.origins[k],'current_form',k);
 assert.equal(shown(p).status,'complete');assert.equal(shown(p).inputFingerprint,kept.fingerprint);assert.match(JSON.stringify(shown(p).coreResult),/10 h 12 min/);
 // The form the bridge reads now is what the conversation holds: same registry input.
 assert.deepEqual(own(form.bridge.capture('battery_runtime').formInput),kept.input);
});

test('two realms: an invalid or hostile patch from the client path is still refused by the bridge and the registry; the form keeps every value',async()=>{
 const text=o=>JSON.stringify({...BATTERY,...o});
 // Fixture precondition (EC-AUDIT-FIX-1 final triage). The first case used chargePercent 5000 and called it "a value the
 // registry refuses". It is not: battery_runtime.chargePercent is a plain number field without a range in the registry
 // (conversationTools.js: field(num(), { unit: '%' })), so 5000 is a schema-valid typed value that the bridge writes; only the
 // engine judges it (OUT_OF_RANGE -> result status invalid_input). That legitimate behaviour has its own test below. The
 // refusal case now uses a value the registry REALLY refuses, and proves it here instead of assuming it: a numeric string —
 // the registry never coerces.
 const REFUSED='50',refusal=T.validatePatch('battery_runtime',{set:{chargePercent:REFUSED},clear:[]},{origin:'conversation'});
 assert.equal(refusal.ok,false,'precondition: the registry refuses this patch');
 assert.ok(refusal.errors.some(e=>e.code==='WRONG_TYPE'&&e.field==='chargePercent'&&e.source==='registry'),JSON.stringify(refusal.errors));
 assert.notEqual(REFUSED,START.charge,'precondition: a write of the refused value would be visible in the control');
 const cases={
  'a value the registry refuses (a numeric string is never coerced)':{input:text({chargePercent:REFUSED}),changed:['chargePercent'],says:/cannot be entered in the form/},
  'a context-only field':{input:text({useDocumentedEstimates:true}),changed:['useDocumentedEstimates'],says:/cannot be entered in the form/},
  'a field the tool does not have':{input:text({chargePercent:40,installationApproved:true}),changed:['chargePercent','installationApproved'],says:/cannot be entered in the form/},
  'an own __proto__ key beside a valid field':{input:text({chargePercent:40}).replace(/^\{/,'{"__proto__":{"polluted":true},'),changed:['__proto__','chargePercent'],says:/cannot be entered in the form/},
  'a constructor key beside a valid field':{input:text({chargePercent:40,constructor:'x'}),changed:['constructor','chargePercent'],says:/cannot be entered in the form/},
  'a generation that is not the captured one':{input:text({chargePercent:40}),changed:['chargePercent'],generation:'gforged.7',says:/changed since its values were taken/}};
 for(const [name,c] of Object.entries(cases)){
  const {p,form,log}=await batteryPage([]);
  await p.click('assist-use-form');
  const captured=form.bridge.getState().generation,stored=JSON.stringify(storedAssistant(p));
  const said=p.run('(()=>{const input=JSON.parse('+JSON.stringify(c.input)+');'+(c.generation?'assistLink.generation='+JSON.stringify(c.generation)+';':'')+'return assistFormApply({tool:{tool:"battery_runtime",input},changedFields:'+JSON.stringify(c.changed)+'});})()');
  assert.match(said,c.says,name);
  assert.equal(log.applies.length,1,name+': the bridge was asked and decided itself');
  assert.deepEqual(form.values(),START,name+': no control changed, the valid field beside a refused one included');
  assert.equal(form.calls.btCalc,0,name+': nothing was rendered');assert.equal(form.bridge.getState().generation,captured,name+': no write, no rollback');
  assert.equal(p.run('assistLink'),null,name+': the link is dropped');assert.equal(JSON.stringify(storedAssistant(p)),stored,name+': the conversation is unchanged');
  assert.equal({}.polluted,undefined,name);assert.equal(p.run('({}).polluted'),undefined,name);
 }
});

test('two realms: a number the registry accepts and only the engine rejects is an ordinary editable value — it is written like any correction and the truthful result is invalid_input, never a patch refusal',async()=>{
 // Not a security case and not presented as one. The contract is read from the real modules, not assumed:
 //   registry: chargePercent 5000 is a valid typed change (no range in the field descriptor);
 //   engine:   the canonical battery calculation rejects it (OUT_OF_RANGE), exactly as for 5000 typed into the form by hand;
 //   registry result: status invalid_input with the engine's own error — no number, no runtime.
 const patch={set:{chargePercent:5000},clear:[]},INPUT={...BATTERY,chargePercent:5000};
 const schema=T.validatePatch('battery_runtime',patch,{origin:'conversation'});
 assert.equal(schema.ok,true,'precondition: 5000 is schema-valid for the registry: '+JSON.stringify(schema.errors));assert.deepEqual(own(schema.set),{chargePercent:5000});
 const engine=BAT.calculateBatteryRuntime(INPUT);
 assert.equal(engine.ok,false,'precondition: the engine rejects it');assert.deepEqual(engine.errors.map(e=>[e.field,e.code]),[['chargePercent','OUT_OF_RANGE']]);
 const out=T.handleToolCall({name:T.PROVIDER_TOOL_PREFIX+'battery_runtime',args:{set:INPUT,clear:[]},draft:null});
 assert.equal(out.ok,true,'the call itself is well-formed: '+JSON.stringify(out.errors));
 assert.equal(out.result.status,T.STATUS.INVALID_INPUT,'the truthful result: invalid input, not a computed runtime');
 assert.ok(out.result.errors.some(e=>e.field==='chargePercent'&&e.code==='OUT_OF_RANGE'&&e.source==='engine'),JSON.stringify(out.result.errors));
 assert.ok(!/\d+ h \d+ min/.test(JSON.stringify(out.result.summary)),'no runtime is reported for an invalid input');
 // The client path with the real bridge: the typed value reaches the form like any other correction of the conversation.
 const {p,form,log}=await batteryPage([]);
 await p.click('assist-use-form');
 const captured=form.bridge.getState().generation;
 const said=p.run('(()=>{const input=JSON.parse('+JSON.stringify(JSON.stringify(INPUT))+');return assistFormApply({tool:{tool:"battery_runtime",input},changedFields:["chargePercent"]});})()');
 assert.match(said,/also entered in the open form/,'said as a write, because it was one');assert.ok(!/cannot be entered in the form/.test(said),'not reported as a refused change');
 assert.equal(log.applies.length,1);assert.deepEqual(log.applies[0],{toolId:'battery_runtime',expectedGeneration:captured,patch},'the closed request: only the changed field');
 assert.deepEqual(form.values(),{...START,charge:'5000'},'only the corrected control changed; every other control is exactly as before');
 assert.equal(form.calls.btCalc,1,'the form rendered through its own function, once — its own validation message is the form\'s business');
 assert.notEqual(form.bridge.getState().generation,captured);assert.equal(p.run('assistLink.generation'),form.bridge.getState().generation,'the link follows the accepted write');
 // What the form holds now is what the conversation holds, and the engine still rejects exactly that input.
 const held=own(form.bridge.capture('battery_runtime').formInput);
 assert.deepEqual(held,INPUT);assert.equal(BAT.calculateBatteryRuntime(held).ok,false);
 assert.equal({}.polluted,undefined);assert.equal(p.run('({}).polluted'),undefined);
});

test('linked form: the answer is accepted for an unchanged form and discarded as a whole after change-and-revert, a tool switch or a reloaded tools document',async()=>{
 const cases={
  'unchanged form (control)':{accepted:true,during(){}},
  'a field changed and put back':{during:form=>{form.user('bt-capacity','2000');form.user('bt-capacity','1000');}},
  'another tool opened in the frame':{during:form=>{form.els['panel-more'].classList.remove('active');form.els['panel-home']=ctl('');form.els['panel-home'].classList.add('active');}},
  // Same boot id on purpose: the new document reports the very same generation text and the same open form, so only the
  // identity of the frame document's bridge tells it apart.
  'the tools document reloaded':{during:(form,p,fresh)=>{frameOf(p).ECAssistantBridge=watched(fresh.form.bridge,fresh.log);}}};
 for(const [name,c] of Object.entries(cases)){
  const late=gated(calculator('battery_runtime',{set:{chargePercent:50},clear:[]}));
  const {p,form,log}=await batteryPage([late.answer]),fresh={form:batteryForm('boot-a'),log:{captures:[],applies:[]}};
  await p.click('assist-use-form');
  const state=p.run('JSON.stringify(state)'),stored=JSON.stringify(storedAssistant(p)),text='naładowanie 50 procent';
  await p.type(text);await p.submit();
  assert.equal(p.count('/api/assist'),1,name+': dispatched');
  if(name==='the tools document reloaded')assert.equal(fresh.form.bridge.getState().generation,p.run('assistLink.generation'),'precondition: the reloaded document reports an equal generation text');
  await c.during(form,p,fresh);
  late.open();await idle(p);await H.settle();
  assert.equal(p.count('/api/assist'),1,name+': exactly one attempt, no retry');
  if(c.accepted){
   assert.equal(p.run('state.history.length'),2,name);assert.equal(storedAssistant(p).tool.input.chargePercent,50,name);assert.equal(p.els.input.value,'',name);
   assert.deepEqual(form.values(),{...START,charge:'50'},name);assert.equal(log.applies.length,1,name);assert.notEqual(p.run('assistLink'),null,name);
   continue;
  }
  assert.equal(p.run('JSON.stringify(state)'),state,name+': no history, no state change');assert.equal(JSON.stringify(storedAssistant(p)),stored,name+': the draft is not replaced');
  assert.equal(p.run('undo.length'),0,name+': nothing to undo');
  assert.deepEqual(form.values(),START,name+': the form was not patched');assert.equal(log.applies.length,0,name+': the bridge was never asked to write');
  assert.deepEqual(fresh.form.values(),START,name);assert.equal(fresh.log.applies.length,0,name);assert.equal(fresh.log.captures.length,0,name+': no form is captured by itself');
  assert.equal(log.captures.length,1,name+': only the explicit import captured');
  assert.equal(p.els.input.value,text,name+': the unsent text stays in the field');assert.ok(p.local.dump().includes(text),name+': and in storage');
  assert.equal(p.els.status.className,'error',name);assert.match(p.els.status.textContent,/before the reply arrived/,name);assert.match(p.els.status.textContent,/Use open calculator/,name+': the next step is named');
  assert.match(p.els['assist-status'].textContent,/no longer linked to this chat|detached from this chat/,name);assert.equal(p.run('assistLink'),null,name);
 }
});

test('linked form already changed before Send: nothing is sent or re-captured; the link is dropped and said; the next Send is a conversation-only turn',async()=>{
 const seen=[],{p,form,log}=await batteryPage([calculator('battery_runtime',{set:{chargePercent:50},clear:[]})],seen);
 await p.click('assist-use-form');
 form.user('bt-usable','80');   // the user edits the form after the import
 const text='naładowanie 50 procent',stored=JSON.stringify(storedAssistant(p));
 await p.type(text);await p.submit();await idle(p);
 assert.equal(p.count('/api/assist'),0,'no request for a form the conversation no longer matches');
 assert.equal(p.els.input.value,text);assert.ok(p.local.dump().includes(text));
 assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/nothing was sent/);assert.match(p.els.status.textContent,/Use open calculator/);
 assert.match(p.els['assist-status'].textContent,/no longer linked to this chat|detached from this chat/);assert.equal(p.run('assistLink'),null);
 assert.equal(log.captures.length,1,'the changed form is not captured by itself');assert.equal(JSON.stringify(storedAssistant(p)),stored,'the conversation keeps what was imported');
 // Pressed again, the same text is an ordinary turn on the conversation's own data. The form is neither read nor written.
 await p.submit();await idle(p);
 assert.equal(p.count('/api/assist'),1);assert.deepEqual(seen[0].body.assistant.toolDraft.input,BATTERY);assert.equal(seen[0].body.assistant.form,null);
 assert.deepEqual(storedAssistant(p).tool.input,{...BATTERY,chargePercent:50});assert.equal(p.els.input.value,'');
 assert.equal(log.applies.length,0);assert.equal(log.captures.length,1);assert.deepEqual(form.values(),{...START,usable:'80'});
});

test('a draft stated only in the conversation has no form guard: form activity during the request does not discard its answer',async()=>{
 const late=gated(calculator('battery_runtime',{set:{chargePercent:50},clear:[]}));
 const {p,form,log}=await batteryPage([calculator('battery_runtime',{set:BATTERY,clear:[]}),late.answer]);
 await send(p,'akumulator 1000 Wh, 365 kWh rocznie, 100 i 85 procent');
 assert.equal(p.run('assistLink'),null);assert.deepEqual(storedAssistant(p).tool.input,BATTERY);
 await p.type('naładowanie 50 procent');await p.submit();
 form.user('bt-capacity','2000');form.user('bt-capacity','1000');
 late.open();await idle(p);await H.settle();
 assert.equal(p.run('state.history.length'),4);assert.equal(storedAssistant(p).tool.input.chargePercent,50);assert.equal(p.els.input.value,'');
 assert.equal(log.captures.length,0);assert.equal(log.applies.length,0);assert.deepEqual(form.values(),START,'a conversation-only draft never writes to a form');
});

// --- The job is read under the conversation lock ---------------------------------------------------------------------------
function jobEnv(){
 const dbs={};let tail=Promise.resolve();
 const indexedDB={open(name,version){if(!dbs[name])dbs[name]=makeIndexedDb(name);return dbs[name].indexedDB.open(name,version);}};
 const locks={request(name,opts,fn){const call=tail.then(()=>fn());tail=call.catch(()=>{});return call;}};
 return {indexedDB,locks};
}
async function seedJob(e){
 const store=createJobStore(e.indexedDB,{crypto:deterministicCrypto(1),now:()=>T0});
 const made=await store.create({title:'Panel upgrade',address:'12 Main Street',notes:'First visit.'},[]);store.close();
 assert.equal(made.ok,true,JSON.stringify(made));return made.job;
}
// An ordinary edit of the job card by the user, through the original store.
async function editJob(e,jobId,notes){
 const store=createJobStore(e.indexedDB,{crypto:deterministicCrypto(500),now:()=>new Date().toISOString()});
 const now=await store.read(jobId),r=now.job.revision,saved=await store.save(jobId,r.revisionId,{title:r.title,address:r.address,notes},[]);store.close();
 assert.equal(saved.ok,true,JSON.stringify(saved));return saved.job;
}
// The members host-core.js exposes on ecHostBridge, backed by the real adapter and the original job store.
const jobBridge=e=>({
 read:async id=>{const s=createJobStore(e.indexedDB,{}),r=await s.read(id);s.close();return r;},
 prepareAction:input=>A.prepare(own(input),{crypto:webcrypto}),pendingAction:plan=>A.pendingReceipt(own(plan)),
 commitAction:(plan,input,confirmation,persistPending)=>A.commit(own(plan),own(input),own(confirmation),{crypto:webcrypto,indexedDB:e.indexedDB,locks:e.locks,persistPending}),
 reconcileAction:receipt=>A.reconcile(own(receipt),{crypto:webcrypto,indexedDB:e.indexedDB}),measurementUnits:()=>own(M.UNITS)});
const noteAnswer=(text,quote)=>body=>{
 const j=body.assistant.job;assert.ok(j,'the request names the selected job');
 return json(H.assistAnswer(body,{domain:'job_note',reply:'Propozycja notatki czeka na przegląd.',assistant:{actionProposal:{kind:'ec.assist.jobNoteAppend',version:1,proposalId:'a'.repeat(64),committed:false,requiresUserReview:true,
  target:{jobId:j.jobId,baseRevisionId:j.revisionId,baseRevisionNumber:j.revisionNumber},append:{text,separator:j.notesLength?'\n\n':'',baseNotesLength:j.notesLength,resultingNotesLength:j.notesLength+(j.notesLength?2:0)+text.length},evidence:{sourceQuote:quote},modelAuthored:['append.text']}}}));
};
async function jobPage(e,job,script,seen){
 const p=await H.load({jobs:[{head:job.head,revision:job.revision}],bridge:jobBridge(e),api:server(script,seen)});
 p.els['job-target'].value=job.head.jobId;await p.els['job-target'].onchange();await H.settle();
 assert.equal(p.run('workspaceMeta.targetJobId'),job.head.jobId);return p;
}

test('job revision saved while the answer waits for the lock: the answer is refused against the job read under the lock; one attempt, text kept',async()=>{
 const TEXT='zapisz notatkę: rozdzielnia sprawdzona';
 // Control: nothing happens to the job — the proposal is stored for the revision that was sent.
 {
  const e=jobEnv(),job=await seedJob(e),seen=[],p=await jobPage(e,job,[noteAnswer('Rozdzielnia sprawdzona.','rozdzielnia sprawdzona')],seen);
  await send(p,TEXT);
  assert.equal(seen[0].body.assistant.job.revisionId,job.head.currentRevisionId);
  assert.equal(storedAssistant(p).proposal.job.revisionId,job.head.currentRevisionId);assert.equal(p.els.input.value,'');
 }
 const e=jobEnv(),job=await seedJob(e),seen=[];
 // From the moment the fixture server answers, every request for the conversation lock waits until the test releases it.
 let hold=null,release=null,waiting=0;
 const first=body=>{hold=new Promise(r=>{release=r;});return noteAnswer('Rozdzielnia sprawdzona.','rozdzielnia sprawdzona')(body);};
 const p=await jobPage(e,job,[first,noteAnswer('Rozdzielnia sprawdzona.','rozdzielnia sprawdzona')],seen);
 const base=p.navigator.locks.request;
 p.navigator.locks.request=(name,opts,fn)=>{if(!hold)return base(name,opts,fn);waiting++;return hold.then(()=>base(name,opts,fn));};
 await p.type(TEXT);await p.submit();
 await until(()=>waiting>=1);await H.settle();
 assert.equal(p.run('busy'),true,'the answer is waiting for the lock');assert.equal(p.run('assistantMeta'),null);
 // The job gets a newer revision through its original store while the answer waits.
 const edited=await editJob(e,job.head.jobId,'First visit.\n\nEdited meanwhile.');
 assert.notEqual(edited.head.currentRevisionId,job.head.currentRevisionId);
 const open=release;hold=null;open();await idle(p);await H.settle();
 assert.equal(seen[0].body.assistant.job.revisionId,job.head.currentRevisionId,'the request was sent for the older revision');
 assert.equal(p.run('assistantMeta'),null,'no proposal for a job revision that is no longer current');assert.equal(p.run('state.history.length'),0);
 const entry=p.bank().contexts.find(x=>x.contextId===p.active());assert.ok(!entry||!Object.hasOwn(entry.envelope,'assistant'),'nothing of the refused answer is stored');
 assert.equal(p.els.input.value,TEXT);assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/Outdated proposal/);
 assert.equal(p.count('/api/assist'),1,'exactly one attempt, no retry');
 // Sent again by the user: the request names the current revision and its proposal is stored for it.
 await p.submit();await idle(p);
 assert.equal(p.count('/api/assist'),2);assert.equal(seen[1].body.assistant.job.revisionId,edited.head.currentRevisionId);
 assert.equal(storedAssistant(p).proposal.job.revisionId,edited.head.currentRevisionId);assert.equal(storedAssistant(p).proposal.job.revisionNumber,edited.revision.revisionNumber);
});

// --- Load Calc: one form, four analyses ------------------------------------------------------------------------------------
const LC82=JSON.parse(fs.readFileSync(path.join(__dirname,'../core/test/fixtures/loadCalc/LC82-cases-r1.json'),'utf8'));
const B0=()=>{const c=LC82.cases.find(x=>x.id==='LC82-B0P');assert.ok(c,'fixture LC82-B0P');return own(c.request);};
const B0unknown=()=>{const r=B0();r.snapshot.optional82.conductorAmpacityA.value=null;return r;};
const PLAN={intent:'new_design_candidate',oneMainDisconnect:true,noAdditionalSources:true,wholeDwelling:true,singleConductorSet:true};
const COND={sizingPath:'general_table_75C',material:'Cu',terminationTempRatingC:75,terminationMaterialCompatible:true,insulationTempRatingC:75,ambientTempC:30,currentCarryingConductors:3,wiringMethod:'single_insulated_conductors_in_raceway',noOtherAdjustmentOrCorrection:true};
const design=(selected,patch)=>({selectedMainRatingA:selected,plan:{...PLAN},conductor:{...COND,...(patch||{})}});
const DWELLING={sizingPath:'dwelling_83pct_310_12'};
const lcDraftOf=request=>({snapshot:request.snapshot,context:request.context,fieldErrors:SV._internal.dict(),loadErrors:SV._internal.dict(),sourceFavId:null});
// The Load Calc section as the bridge reads it: the live draft (lcDraft), the form's fault flag (lcExportState), the design
// answers (lcSvcDesignObject) and the workflow mode (LC_PRE). `state` is what the "form" holds now; edit() is a user edit.
function loadCalcForm(){
 const els={'panel-more':ctl(''),'sub-loadcalc':ctl(''),lcForm:ctl('')};els['panel-more'].classList.add('active');
 const doc=frameDoc(els);
 const state={request:B0(),design:design(200),fault:null,pre:{mode:'existing',result:null,error:null,refusal:null,adopted:null,notice:null,epoch:0,runs:0}};
 const globals={currentMoreTab:'loadcalc',lcDraft:()=>lcDraftOf(state.request),lcExportState:()=>({lastRequest:null,result:null,fault:state.fault,evaluations:0}),lcSvcDesignObject:()=>own(state.design),lcIs82:()=>true,lcCalcFresh:()=>false};
 Object.defineProperty(globals,'LC_PRE',{enumerable:true,get:()=>state.pre});
 const EC={conversationTools:T,loadCalcStateV2:SV};
 const bridge=B.createBridge({document:doc,registry:()=>T,ec:()=>EC,page:n=>globals[n],host:()=>null,bootId:'boot-lc'});
 return {els,doc,state,bridge,edit(change){change(state);doc.fire('change');}};
}

test('Load Calc form: a labelled choice of its four analyses; the chosen one is captured from the CURRENT form and computed by the canonical engine; nothing is adopted or invented',async()=>{
 const form=loadCalcForm(),log={captures:[],applies:[]};
 // Fixture preconditions: the canonical projection of the form's draft is exactly the request of the core fixture.
 const projected=SV.toRequestV2(lcDraftOf(B0()));assert.equal(projected.ok,true,JSON.stringify(projected));assert.deepEqual(own(projected.request),B0());
 const p=await H.load({frame:{EC:{conversationTools:T},ECAssistantBridge:watched(form.bridge,log)}});
 p.run('assistRender()');
 const select=()=>p.find('assist-form-tool');
 assert.ok(select(),'the choice is offered for a form that serves several calculators');
 const options=select().children.filter(c=>c.tagName==='option');
 assert.deepEqual(options.map(o=>o.value),['load_calc','load_calc_preliminary','service_sizing','service_sizing_preliminary'],'exactly the tools the bridge reports for the open form');
 assert.deepEqual(options.map(o=>o.textContent),options.map(o=>T.getTool(o.value).title.en),'the registry\'s own English titles');
 for(const o of options)assert.ok(o.textContent.length>3&&!/load_calc|service_sizing|[a-z0-9]_[a-z0-9]/.test(o.textContent),'no internal identifier in the visible text: '+o.textContent);
 assert.equal(new Set(options.map(o=>o.textContent)).size,4,'four distinguishable names');
 const label=walk(p.find('assist-body')).find(x=>x.tagName==='label');
 assert.ok(label&&label.getAttribute('for')==='assist-form-tool'&&/Analysis from the open form/.test(label.textContent),'the control has a programmatic label');
 assert.ok(!/load_calc|service_sizing_|_preliminary/.test(p.text('assist-body')),'no identifier anywhere in the panel text');
 assert.equal(select().value,'load_calc','the form\'s primary analysis stays the default');
 const css=H.read('style.css');assert.match(css,/\.assist input,\.assist select,\.assist textarea\{[^}]*width:100%[^}]*max-width:100%[^}]*min-width:0[^}]*font-size:16px/,'16 px control that cannot overflow a 320 px panel');
 const pick=async id=>{const s=select();assert.ok(s&&!s.disabled);s.value=id;s.onchange();await p.click('assist-use-form');};
 const draft=()=>storedAssistant(p).tool;
 // Default press: the ordinary Load Calc of the current form.
 await p.click('assist-use-form');
 assert.deepEqual(log.captures,['load_calc']);assert.equal(draft().tool,'load_calc');assert.deepEqual(draft().origins,{request:'current_form'});assert.deepEqual(draft().input.request,B0());
 assert.equal(shown(p).status,'complete');assert.deepEqual(shown(p).coreResult,own(F.evaluateV2(B0())),'the canonical facade result, computed by the registry of the frame');
 assert.match(p.text('assist-body'),/It is not an inspection, an installation approval or a confirmation of code compliance/);
 // Explicit choice: Service Sizing of the same current form — request and design both imported, both from the form.
 await pick('service_sizing');
 assert.equal(log.captures[log.captures.length-1],'service_sizing');assert.equal(draft().tool,'service_sizing');
 assert.deepEqual(draft().origins,{request:'current_form',design:'current_form'});assert.deepEqual(draft().input.request,B0());
 assert.equal(shown(p).status,'complete');assert.deepEqual(shown(p).coreResult,own(S.analyzePrototype(B0(),design(200))));
 assert.equal(select().value,'service_sizing','the choice is kept until the user changes it');
 // A new-design analysis while the form is in the existing-conductor workflow: refused, said, nothing stored or assumed.
 let kept=JSON.stringify(storedAssistant(p));
 await pick('service_sizing_preliminary');
 assert.match(p.els['assist-status'].textContent,/is not in new-design mode/);assert.match(p.els['assist-status'].textContent,/nothing was taken or assumed/);
 assert.equal(JSON.stringify(storedAssistant(p)),kept);assert.ok(!/service_sizing|_preliminary/.test(p.els['assist-status'].textContent),'the refusal names the analysis by its title');
 // The user switches the form to the new-design workflow with an unknown conductor ampacity and edits the design.
 form.edit(s=>{s.pre.mode='new_design';s.request=B0unknown();s.design=design(200,DWELLING);});
 await pick('service_sizing_preliminary');
 assert.equal(draft().tool,'service_sizing_preliminary');assert.deepEqual(draft().origins,{request:'current_form',design:'current_form'});
 assert.deepEqual(draft().input.request,B0unknown(),'the CURRENT request of the form, not an earlier one');
 assert.equal(draft().input.request.snapshot.optional82.conductorAmpacityA.value,null,'the unknown ampacity stays unknown: nothing is adopted into the request');
 let r=shown(p);
 assert.equal(r.status,'preliminary');assert.deepEqual(r.coreResult,own(S.analyzePreliminaryPrototype(B0unknown(),design(200,DWELLING))));
 assert.equal(r.nextAction.adoption.performedHere,false);assert.equal(r.nextAction.adoption.modelCallable,false);
 assert.ok(!JSON.stringify(r).includes('adoptedRequest')&&!JSON.stringify(r).includes(S.ADOPTION_STATUS.ADOPTED)&&!JSON.stringify(r).includes('"installationApproved":true'));
 assert.match(p.text('assist-body'),/PRELIMINARY/);assert.match(p.text('assist-body'),/It is not an inspection, an installation approval or a confirmation of code compliance/);
 assert.equal(form.state.pre.adopted,null);assert.equal(form.state.pre.result,null);assert.equal(form.state.pre.runs,0,'the form\'s own preliminary check was not run');
 assert.equal(JSON.stringify(form.state.request),JSON.stringify(B0unknown()),'the form\'s draft is not touched');
 await pick('load_calc_preliminary');
 assert.equal(draft().tool,'load_calc_preliminary');assert.deepEqual(draft().origins,{request:'current_form'});
 assert.equal(shown(p).status,'preliminary');assert.deepEqual(shown(p).coreResult,own(F.evaluatePreliminaryV2(B0unknown())));
 // Unresolved input is said honestly: the ordinary analyses of the same form do not get a number.
 await pick('load_calc');
 r=shown(p);assert.equal(r.status,'needs_input');assert.ok(r.needsInput.length>0);
 const asked=r.needsInput[0].question,question=typeof asked==='string'?asked:asked.en;
 assert.ok(question&&p.text('assist-body').includes(question),'the registry question is shown');
 assert.deepEqual(r.coreResult,own(F.evaluateV2(B0unknown())));
 await pick('service_sizing');
 assert.equal(shown(p).status,'unsupported');assert.equal(shown(p).coreResult.ungroundedConductors.tableCandidate,null);
 // A form that reports a data fault, or a page without the workflow state, imports nothing.
 kept=JSON.stringify(storedAssistant(p));
 form.edit(s=>{s.fault={kind:'draft',message:'rejected'};});
 await pick('load_calc');
 assert.match(p.els['assist-status'].textContent,/reports a data error/);assert.equal(JSON.stringify(storedAssistant(p)),kept);
 form.edit(s=>{s.fault=null;s.pre=null;});
 await pick('load_calc_preliminary');
 assert.match(p.els['assist-status'].textContent,/are not ready to read the form yet/);assert.equal(JSON.stringify(storedAssistant(p)),kept);
 // Everything above was local: nothing was sent, nothing was written to the form, and the adoption helper is not referenced.
 assert.equal(p.count('/api/assist'),0);assert.equal(log.applies.length,0);assert.ok(!/adoptPlanned/.test(H.read('ui.js')));
 assert.ok(log.captures.every(id=>typeof id==='string'),'every capture of this form named the chosen analysis');
 // Stored: input state only, as for every other calculator.
 assert.deepEqual(Object.keys(draft()).sort(),['fingerprint','input','origins','tool']);
});

test('a form with one calculator offers no choice',async()=>{
 const {p}=await batteryPage([]);
 p.run('assistRender()');
 assert.equal(p.find('assist-form-tool'),null);assert.ok(p.find('assist-use-form'));assert.equal(p.find('assist-use-form').disabled,false);
 // Without a bridge the choice is not offered either, and the import stays disabled as before.
 const bare=await H.load({frame:{EC:{conversationTools:T}}});
 bare.run('assistRender()');assert.equal(bare.find('assist-form-tool'),null);assert.equal(bare.find('assist-use-form').disabled,true);
});
