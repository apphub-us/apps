'use strict';
// EC-AUDIT-FIX-1 — native A5-02/03/05/06/07: „Użyj otwartego kalkulatora” (#assist-use-form) and the Load Calc analysis choice
// (#assist-form-tool) must follow the tools frame when it BECOMES ready and when the user RETURNS from Tools to the conversation,
// before any conversation turn. Before the fix only controls() drew them (assistRender), and neither the frame-ready handlers nor
// the view navigation ever reached it: on a fresh conversation the button stayed disabled with an empty status.
//
// What runs here: the real page scripts in the stage2 VM harness, and the page's OWN handlers —
//   * the 'load' listener of #core-frame and the window 'message' listener (workspace-host.js) for frame readiness,
//   * the onclick handlers of #nav-tools / #nav-talk (hostNavigate) for navigation,
//   * the onclick handler of #assist-use-form for the one explicit import.
// This file never calls assistRender(), controls() or render() itself: a missing hook cannot be masked here.
// Form side: the REAL form bridge (candidate/browser/workspace/assistant-bridge.js) and the REAL registry
// (core/src/calc/conversationTools.js) over compact control fixtures, as in stage5-client-boundaries.test.cjs. The shipped
// mobile.html is not loaded, ecHostBridge.show() is a fixture that only records the view, and the server is a fixture that
// answers /api/session only. No network, no provider, no browser: this does not replace the native A5 flows.
// Authored, not executed by the author. Run: node --test tests/stage5-frame-ready.test.cjs
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const H=require('./stage2-harness.cjs');
const T=require('../core/src/calc/conversationTools.js');
const B=require('../candidate/browser/workspace/assistant-bridge.js');
const BAT=require('../core/src/calc/batteryRuntime.js');
const SV=require('../core/src/calc/loadCalcStateV2.js');
const TOKEN='ef'.repeat(32),ORIGIN='https://pilot.example';   // ORIGIN: location.origin of the harness page
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const own=x=>JSON.parse(JSON.stringify(x));
const sessionBody=()=>({build:'PRIVATE-PILOT-5',model:'model-x',speechModel:'speech-x',online:true,prototype:true,remainingRequests:60,token:TOKEN,reason:null});
// Every request other than the session probe is a test failure: nothing in this file may reach the assistant.
const server=()=>url=>{if(url==='/api/session')return json(sessionBody());throw Error('unexpected request '+url);};
const until=async(check,ms=4000)=>{const end=Date.now()+ms;for(;;){if(check())return;if(Date.now()>end)throw Error('condition not reached');await H.settle(2);}};
const idle=p=>until(()=>!p.run('busy')&&!p.run('audioBusy')&&!p.run('handoffBusy'));
const frameOf=p=>p.els['core-frame'].contentWindow;
const use=p=>p.find('assist-use-form'),choice=p=>p.find('assist-form-tool');
const optionsOf=p=>choice(p).children.filter(c=>c.tagName==='option').map(o=>o.value);
const storedAssistant=p=>{const e=p.bank().contexts.find(x=>x.contextId===p.active());return e&&Object.hasOwn(e.envelope,'assistant')?e.envelope.assistant:null;};
// Everything a load, a navigation or a render must leave alone: both storages byte for byte, the history, the conversation's
// calculator, the form link and every request other than the session probe.
const untouched=p=>JSON.stringify({local:p.local.dump(),session:p.session.dump(),history:p.run('state.history.length'),revision:p.run('state.revision'),assistant:p.run('JSON.stringify(assistantMeta)'),link:p.run('assistLink===null'),requests:p.calls.filter(c=>c.url!=='/api/session').length});

// --- The page's own handlers ------------------------------------------------------------------------------------------------
// The 'load' listener workspace-host.js put on #core-frame (the harness element keeps the listener that was registered).
async function frameLoad(p){const f=p.els['core-frame'].listeners.load;assert.equal(typeof f,'function','workspace-host.js listens for the frame load');f({type:'load'});await H.settle();}
// The ready message host-core.js posts from the frame document, delivered to the page's window 'message' listener.
async function frameReady(p,o={}){await p.fire('message',{origin:o.origin||ORIGIN,source:o.source||frameOf(p),data:{type:'empire-workspace-ready'}});}
// What the frame document looks like once its scripts have run: the Jobs bridge is ready, the registry and the form bridge exist.
function arrive(p,bridge,o={}){const w=frameOf(p);if(o.registry!==false)w.EC={conversationTools:T};if(bridge)w.ECAssistantBridge=bridge;w.ecHostBridge.ready=true;}
// A frame document that is still loading: no ready Jobs bridge, no registry, no form bridge. `shows` lists every view the page asks for.
function unreadyHost(shows){return {ready:false,show:async view=>{shows.push(view);return true;}};}

// --- The tools frame document of these tests (objects of the Node main realm), as in stage5-client-boundaries.test.cjs ---------
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
// The bridge as the page reaches it, with every capture and apply call recorded as it ARRIVES.
const watched=(bridge,log)=>({getState:()=>bridge.getState(),capture:id=>{log.captures.push(id===undefined?null:id);return bridge.capture(id);},apply:r=>{log.applies.push(r);return bridge.apply(r);},navigate:id=>bridge.navigate(id)});
const newLog=()=>({captures:[],applies:[]});
const BATTERY={capacityWh:1000,consumptionMode:'kwh_year',consumption:365,chargePercent:100,usablePercent:85};
const START={capacity:'1000',mode:'kwh_year',consumption:'365',charge:'100',usable:'85'};
// The Wh / Runtime tab of the converter: one calculator (battery_runtime).
function batteryForm(){
 const els={'panel-more':ctl(''),'sub-converter':ctl(''),'cvt-battery':ctl(''),'bt-capacity':ctl(START.capacity),'bt-mode':ctl(START.mode,['w','kwh_day','kwh_year']),'bt-consumption':ctl(START.consumption),'bt-charge':ctl(START.charge),'bt-usable':ctl(START.usable)};
 els['panel-more'].classList.add('active');
 const doc=frameDoc(els),calls={btCalc:0,btSyncUnit:0};
 const globals={currentMoreTab:'converter',btCalc:()=>{calls.btCalc++;},btSyncUnit:()=>{calls.btSyncUnit++;},
  btRead:()=>({capacityWh:els['bt-capacity'].value,consumptionMode:els['bt-mode'].value,consumption:els['bt-consumption'].value,chargePercent:els['bt-charge'].value,usablePercent:els['bt-usable'].value})};
 const EC={conversationTools:T,batteryRuntime:BAT};
 const bridge=B.createBridge({document:doc,registry:()=>T,ec:()=>EC,page:n=>globals[n],host:()=>null,bootId:'boot-ready'});
 return {els,doc,calls,bridge,
  user(id,value){els[id].value=value;doc.fire('input');},
  values:()=>({capacity:els['bt-capacity'].value,mode:els['bt-mode'].value,consumption:els['bt-consumption'].value,charge:els['bt-charge'].value,usable:els['bt-usable'].value})};
}
// The converter with its Power tab open: a navigation-only tool, no calculator behind it.
function powerForm(){
 const els={'panel-more':ctl(''),'sub-converter':ctl(''),'cvt-power':ctl('')};els['panel-more'].classList.add('active');
 const doc=frameDoc(els),globals={currentMoreTab:'converter'},EC={conversationTools:T};
 return {els,doc,bridge:B.createBridge({document:doc,registry:()=>T,ec:()=>EC,page:n=>globals[n],host:()=>null,bootId:'boot-power'})};
}
const LC82=JSON.parse(fs.readFileSync(path.join(__dirname,'../core/test/fixtures/loadCalc/LC82-cases-r1.json'),'utf8'));
const B0=()=>{const c=LC82.cases.find(x=>x.id==='LC82-B0P');assert.ok(c,'fixture LC82-B0P');return own(c.request);};
const PLAN={intent:'new_design_candidate',oneMainDisconnect:true,noAdditionalSources:true,wholeDwelling:true,singleConductorSet:true};
const COND={sizingPath:'general_table_75C',material:'Cu',terminationTempRatingC:75,terminationMaterialCompatible:true,insulationTempRatingC:75,ambientTempC:30,currentCarryingConductors:3,wiringMethod:'single_insulated_conductors_in_raceway',noOtherAdjustmentOrCorrection:true};
const lcDraftOf=request=>({snapshot:request.snapshot,context:request.context,fieldErrors:SV._internal.dict(),loadErrors:SV._internal.dict(),sourceFavId:null});
const LC_IDS=['load_calc','load_calc_preliminary','service_sizing','service_sizing_preliminary'];
// The tools document with the Load Calc section built. open:false = the tools home screen is shown; openLoadCalc() is the user
// opening the calculator there (a real click event in that document). The Load Calc readers are the ones the bridge documents.
function loadCalcForm(o={}){
 const els={'panel-home':ctl(''),'panel-more':ctl(''),'sub-loadcalc':ctl(''),lcForm:ctl('')};
 els[o.open===false?'panel-home':'panel-more'].classList.add('active');
 const doc=frameDoc(els);
 const state={request:B0(),design:{selectedMainRatingA:200,plan:{...PLAN},conductor:{...COND}},fault:null,pre:{mode:'existing',result:null,error:null,refusal:null,adopted:null,notice:null,epoch:0,runs:0}};
 const globals={currentMoreTab:'loadcalc',lcDraft:()=>lcDraftOf(state.request),lcExportState:()=>({lastRequest:null,result:null,fault:state.fault,evaluations:0}),lcSvcDesignObject:()=>own(state.design),lcIs82:()=>true,lcCalcFresh:()=>false};
 Object.defineProperty(globals,'LC_PRE',{enumerable:true,get:()=>state.pre});
 const EC={conversationTools:T,loadCalcStateV2:SV};
 const bridge=B.createBridge({document:doc,registry:()=>T,ec:()=>EC,page:n=>globals[n],host:()=>null,bootId:'boot-lc-nav'});
 return {els,doc,state,bridge,
  openLoadCalc(){els['panel-home'].classList.remove('active');els['panel-more'].classList.add('active');doc.fire('click');},
  edit(change){change(state);doc.fire('change');}};
}

test('frame not ready at start: the real frame-load handler makes the import available; one explicit press captures once; load, ready message and navigation never capture; a changed form is still refused',async()=>{
 const form=batteryForm(),log=newLog(),shows=[];
 const p=await H.load({bridge:unreadyHost(shows),api:server()});
 // The native symptom's starting point: a fresh conversation, the frame document still loading.
 assert.equal(p.run('state.history.length'),0);assert.equal(p.run('hostReady'),false);assert.equal(frameOf(p).ECAssistantBridge,undefined);
 assert.ok(use(p),'the import button is drawn');assert.equal(use(p).disabled,true,'no form bridge yet: disabled');assert.equal(p.els['assist-status'].textContent,'');
 const before=untouched(p);
 // The frame document finishes loading: its scripts have installed the Jobs bridge, the registry and the form bridge.
 arrive(p,watched(form.bridge,log));
 await frameLoad(p);
 assert.equal(p.run('hostReady'),true,'the Jobs side became ready through the same handler');
 assert.equal(use(p).disabled,false,'the import is available without any conversation turn or extra action');
 assert.equal(choice(p),null,'a form with one calculator offers no choice');assert.equal(p.els['assist-status'].textContent,'');
 assert.deepEqual(log,newLog(),'becoming ready read no form and wrote none');assert.equal(untouched(p),before,'nothing stored, sent or adopted by the load');
 assert.deepEqual(form.values(),START);assert.equal(form.calls.btCalc,0);
 // The ready message of the same document arrives as well (host-core.js posts it): still nothing but a redraw.
 await frameReady(p);
 assert.equal(use(p).disabled,false);assert.deepEqual(log,newLog());assert.equal(untouched(p),before);
 // Exactly one listener of each kind exists on the page side.
 assert.equal((p.win.message||[]).length,1,'one window message listener');
 // The one explicit import: one capture of the current form, stored as this conversation's calculator, linked to that form.
 await p.click('assist-use-form');
 assert.deepEqual(log.captures,[null],'one press, one capture (the form\'s primary calculator)');assert.equal(log.applies.length,0);
 assert.deepEqual(storedAssistant(p).tool.input,BATTERY);assert.ok(Object.values(storedAssistant(p).tool.origins).every(x=>x==='current_form'));
 const captured=form.bridge.getState().generation,stored=JSON.stringify(storedAssistant(p));
 assert.equal(p.run('assistLink.generation'),captured);assert.equal(p.run('assistLinkCurrent(assistLink)'),true);
 const after=untouched(p);
 // Frame-ready handlers and a Tools -> Conversation round trip after the import: no second capture, the link is neither
 // refreshed nor dropped, the form's generation is not advanced by being looked at.
 await frameLoad(p);await frameReady(p);
 await p.click('nav-tools');assert.deepEqual(shows,['tools']);assert.equal(p.run('hostView'),'tools');
 await p.click('nav-talk');assert.equal(p.run('hostView'),'talk');
 assert.deepEqual(log.captures,[null],'still the one explicit capture');assert.equal(log.applies.length,0);assert.equal(untouched(p),after);
 assert.equal(form.bridge.getState().generation,captured);assert.equal(p.run('assistLinkCurrent(assistLink)'),true);assert.equal(use(p).disabled,false);
 // The user edits the form in Tools and comes back: nothing is re-captured by the navigation and the stale link is not repaired.
 await p.click('nav-tools');form.user('bt-usable','80');await p.click('nav-talk');
 assert.deepEqual(log.captures,[null]);assert.equal(JSON.stringify(storedAssistant(p)),stored,'the conversation keeps what was imported');
 assert.equal(p.run('assistLink.generation'),captured,'the link still names the captured form');assert.equal(p.run('assistLinkCurrent(assistLink)'),false,'and that form has changed');
 // Stale-context refusal is unchanged: Send for the changed form sends nothing and drops the link.
 const text='naładowanie 50 procent';
 await p.type(text);await p.submit();await idle(p);
 assert.equal(p.count('/api/assist'),0,'no request for a form the conversation no longer matches');
 assert.equal(p.els.input.value,text);assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/nothing was sent/);
 assert.equal(p.run('assistLink'),null);assert.deepEqual(log.captures,[null],'the changed form is not captured by itself');
 assert.equal(JSON.stringify(storedAssistant(p)),stored);assert.deepEqual(form.values(),{...START,usable:'80'},'the form was never written');
});

test('the ready message alone (host-core.js) has the same effect; a message from another window or origin has none',async()=>{
 const form=batteryForm(),log=newLog();
 const p=await H.load({bridge:unreadyHost([]),api:server()});
 assert.equal(use(p).disabled,true);const before=untouched(p);
 arrive(p,watched(form.bridge,log));
 await frameReady(p,{source:{}});assert.equal(use(p).disabled,true,'a message that is not from the tools frame is ignored');
 await frameReady(p,{origin:'https://elsewhere.example'});assert.equal(use(p).disabled,true,'a message of another origin is ignored');
 await frameReady(p);
 assert.equal(use(p).disabled,false,'the frame\'s own ready message refreshes the import');
 assert.deepEqual(log,newLog());assert.equal(untouched(p),before);
 await p.click('assist-use-form');
 assert.deepEqual(log.captures,[null]);assert.deepEqual(storedAssistant(p).tool.input,BATTERY);
});

test('Tools -> Load Calc -> Conversation before the first import: the four analyses are offered at once; the choice captures nothing; one press imports exactly the chosen analysis',async()=>{
 const form=loadCalcForm({open:false}),log=newLog(),shows=[];
 const p=await H.load({frame:{EC:{conversationTools:T},ECAssistantBridge:watched(form.bridge,log)},bridge:{show:async view=>{shows.push(view);return true;}},api:server()});
 // Fresh conversation, tools ready, the tools home screen open: nothing to choose from yet.
 assert.equal(p.run('state.history.length'),0);assert.equal(choice(p),null);assert.equal(use(p).disabled,false);
 const before=untouched(p),pre=JSON.stringify(form.state.pre);
 // The user's real route: Tools, open Load Calc there, back to the conversation.
 await p.click('nav-tools');assert.deepEqual(shows,['tools']);
 form.openLoadCalc();
 await p.click('nav-talk');
 assert.ok(choice(p),'the analysis choice is drawn on the return, without a conversation turn');
 assert.deepEqual(optionsOf(p),LC_IDS,'exactly the four analyses the bridge reports for the open form, in its order');
 assert.equal(choice(p).value,'load_calc','the form\'s primary analysis is the default');assert.equal(choice(p).disabled,false);assert.equal(use(p).disabled,false);
 assert.deepEqual(log,newLog(),'drawing the choice read no form values and wrote none');assert.equal(untouched(p),before,'nothing stored, sent or adopted');
 assert.equal(JSON.stringify(form.state.pre),pre,'the form\'s own workflow state (LC_PRE) is untouched');assert.equal(JSON.stringify(form.state.request),JSON.stringify(B0()));
 // Choosing an analysis only selects what the button will read. It survives another round trip; looking does not invalidate.
 const s=choice(p);s.value='service_sizing';s.onchange();
 const generation=form.bridge.getState().generation;
 await p.click('nav-tools');await p.click('nav-talk');
 assert.deepEqual(optionsOf(p),LC_IDS);assert.equal(choice(p).value,'service_sizing','the user\'s choice is kept');
 assert.equal(form.bridge.getState().generation,generation,'navigation and redraw do not advance the form\'s generation');
 assert.deepEqual(log,newLog());assert.equal(untouched(p),before);
 // One explicit press: one capture, of the chosen analysis, from the current form.
 await p.click('assist-use-form');
 assert.deepEqual(log.captures,['service_sizing']);assert.equal(log.applies.length,0);
 const draft=storedAssistant(p).tool;
 assert.equal(draft.tool,'service_sizing');assert.deepEqual(draft.origins,{request:'current_form',design:'current_form'});assert.deepEqual(draft.input.request,B0());
 assert.equal(p.run('assistLink.tool'),'service_sizing');assert.equal(p.run('assistLinkCurrent(assistLink)'),true);
 // And it stays one-shot: later round trips and frame-ready events import nothing more.
 const stored=JSON.stringify(storedAssistant(p)),after=untouched(p);
 await p.click('nav-tools');await p.click('nav-talk');await frameLoad(p);await frameReady(p);
 assert.deepEqual(log.captures,['service_sizing']);assert.equal(JSON.stringify(storedAssistant(p)),stored);assert.equal(untouched(p),after);
 assert.deepEqual(optionsOf(p),LC_IDS);assert.equal(choice(p).value,'service_sizing');
 assert.equal(JSON.stringify(form.state.pre),pre);assert.deepEqual(shows,['tools','tools','tools']);
});

test('frame not ready at start with Load Calc already open in it: the real frame-load handler offers the four analyses before any import',async()=>{
 const form=loadCalcForm(),log=newLog();
 const p=await H.load({bridge:unreadyHost([]),api:server()});
 assert.equal(use(p).disabled,true);assert.equal(choice(p),null);const before=untouched(p);
 arrive(p,watched(form.bridge,log));
 await frameLoad(p);
 assert.equal(use(p).disabled,false);assert.ok(choice(p));assert.deepEqual(optionsOf(p),LC_IDS);assert.equal(choice(p).value,'load_calc');
 assert.deepEqual(log,newLog());assert.equal(untouched(p),before);
 await p.click('assist-use-form');
 assert.deepEqual(log.captures,['load_calc'],'the default press reads the primary analysis, once');
 assert.equal(storedAssistant(p).tool.tool,'load_calc');assert.deepEqual(storedAssistant(p).tool.input.request,B0());
});

test('truthful when there is nothing to import: an unready frame, a build without the form bridge, a bridge without its registry and a navigation-only tool',async()=>{
 // 1. The frame never becomes ready: every real handler leaves the import disabled, and Tools cannot be opened.
 {
  const shows=[],p=await H.load({bridge:unreadyHost(shows),api:server()}),before=untouched(p);
  await frameLoad(p);
  assert.match(p.els['job-status'].textContent,/The local tools could not be loaded/,'the load of a frame without its Jobs bridge is said');
  assert.equal(use(p).disabled,true);
  await frameReady(p);assert.equal(use(p).disabled,true,'a ready message cannot make an absent bridge appear');
  await p.click('nav-tools');
  assert.match(p.els['job-status'].textContent,/The tools are still loading/);assert.deepEqual(shows,[],'no view was opened');assert.equal(p.run('hostView'),'talk');
  await p.click('nav-talk');
  assert.equal(use(p).disabled,true);assert.equal(choice(p),null);assert.equal(p.els['assist-status'].textContent,'');assert.equal(untouched(p),before);
 }
 // 2. The frame is ready but this build has no form bridge: Jobs work, the import stays disabled.
 {
  const p=await H.load({bridge:unreadyHost([]),api:server()}),before=untouched(p);
  arrive(p,null);
  await frameLoad(p);
  assert.equal(p.run('hostReady'),true);assert.equal(use(p).disabled,true,'no form bridge: nothing to import from');assert.equal(choice(p),null);
  await p.click('nav-tools');await p.click('nav-talk');
  assert.equal(use(p).disabled,true);assert.equal(untouched(p),before);
 }
 // 3. A form bridge whose document has no registry: the bridge reports not ready, no choice is drawn, and a press says so and reads nothing.
 {
  const doc=frameDoc({'panel-home':ctl('')}),log=newLog();
  const bridge=B.createBridge({document:doc,registry:()=>null,ec:()=>null,page:()=>undefined,host:()=>null,bootId:'boot-bare'});
  assert.equal(bridge.getState().ok,false,'precondition: this bridge is not ready');
  const p=await H.load({bridge:unreadyHost([]),api:server()}),before=untouched(p);
  arrive(p,watched(bridge,log),{registry:false});
  await frameLoad(p);
  assert.equal(choice(p),null);
  await p.click('assist-use-form');
  assert.match(p.els['assist-status'].textContent,/Nothing was taken/);assert.deepEqual(log,newLog(),'nothing was read');assert.equal(untouched(p),before);
 }
 // 4. A navigation-only tool is open in Tools (converter, Power): no analysis choice; a press imports nothing and says why.
 {
  const form=powerForm(),log=newLog();
  assert.deepEqual(form.bridge.getState().active.toolIds,[],'precondition: no calculator behind this tool');assert.deepEqual(form.bridge.getState().active.navigationOnlyIds,['power']);
  const p=await H.load({frame:{EC:{conversationTools:T},ECAssistantBridge:watched(form.bridge,log)},bridge:{show:async()=>true},api:server()}),before=untouched(p);
  await p.click('nav-tools');await p.click('nav-talk');await frameLoad(p);
  assert.equal(choice(p),null,'nothing to choose for a tool the conversation does not calculate');assert.deepEqual(log,newLog());assert.equal(untouched(p),before);
  await p.click('assist-use-form');
  assert.match(p.els['assist-status'].textContent,/No calculator whose values can be taken is open|[Nn]othing was taken/i,'the refusal is said');
  assert.equal(log.captures.length,1,'the one explicit press asked the bridge once');assert.equal(log.applies.length,0);
  assert.equal(untouched(p),before,'and nothing was imported, stored or sent');assert.equal(storedAssistant(p),null);
 }
});

test('the hook is a redraw in the two existing handlers: no new listener, timer or state in the fix',()=>{
 const host=H.read('workspace-host.js');
 const count=re=>(host.match(re)||[]).length;
 assert.equal(count(/addEventListener\('message'/g),1,'one window message listener');assert.equal(count(/\$\('core-frame'\)\.addEventListener\('load'/g),1,'one frame load listener');
 assert.equal(count(/setInterval\(/g),0,'no polling');
 assert.equal(count(/\bassistRender\(\)/g),2,'the redraw is requested in exactly two places');
 assert.match(host,/async function hostRefresh\(\)\{[\s\S]*?assistRender\(\);hostRender\(\);\n\}/,'after the tools frame answered (hostRefresh)');
 assert.match(host,/if\(view==='talk'\)\{assistRender\(\);await hostRefresh\(\);\}return true;/,'and on the return to the conversation (hostNavigate)');
 assert.ok(!/\bassistUseForm\b|\.capture\(/.test(host),'the host never imports or captures a form by itself');
});
