'use strict';
// Stage 5 client: calculators in the existing conversation (protocol ec.assist 1), their persistence and the current-form link.
// The real page scripts run in the stage2 VM harness. The tools frame holds the REAL registry (core/src/calc/conversationTools.js),
// so every number asserted here comes from the canonical engines. The server is a fixture: its "model" is a hand-written function
// call per utterance, executed by the same registry the real server uses. Nothing here shows that a model understands Polish or
// English; no network, no provider, no real browser. Authored, not executed by the author. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./stage2-harness.cjs');
const T=require('../core/src/calc/conversationTools.js');
const AS=require('../candidate/browser/assistant-session.js');
const CBank=require('../candidate/browser/conversation-bank.js');
const TOKEN='cd'.repeat(32);
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const own=x=>JSON.parse(JSON.stringify(x));
const sessionBody=()=>({build:'PRIVATE-PILOT-4',model:'model-x',speechModel:'speech-x',online:true,prototype:true,remainingRequests:60,token:TOKEN,reason:null});
const until=async(check,ms=3000)=>{const end=Date.now()+ms;for(;;){if(check())return;if(Date.now()>end)throw Error('condition not reached');await H.settle(2);}};
const idle=p=>until(()=>!p.run('busy')&&!p.run('audioBusy')&&!p.run('handoffBusy'));
const send=async(p,text)=>{await p.type(text);await p.submit();await idle(p);};
// Fixture server. `script` is the list of answers, one function (body,init) per accepted /api/assist request, in order.
function server(script,seen=[]){
 return (url,init)=>{
  if(url==='/api/session')return json(sessionBody());
  if(url==='/api/transcribe')return json({text:'pojemność 1000 Wh',requestId:init.headers['X-EC-Request-Id']});
  if(url!=='/api/assist')throw Error('unexpected request '+url);
  const body=JSON.parse(init.body);seen.push({body,init});
  const next=script.shift();if(!next)throw Error('unexpected extra /api/assist request');
  return next(body,init);
 };
}
const four=d=>({tool:d.tool,input:own(d.input),origins:own(d.origins),fingerprint:d.fingerprint});
// What the real server does for one calculator function call: the registry merges the model's typed change into the draft the
// client sent and runs the engine. `tamper` alters the result on its way to the client.
function calculator(tool,args,tamper){
 return body=>{
  const d=body.assistant.toolDraft,draft=d&&d.tool===tool?{kind:T.DRAFT_KIND,revision:T.CONTRACT_REVISION,...d,result:null,resultFingerprint:null}:null;
  const out=T.handleToolCall({name:T.PROVIDER_TOOL_PREFIX+tool,args,draft});
  assert.equal(out.ok,true,JSON.stringify(out.errors));
  const result=tamper?tamper(own(out.result)):own(out.result);
  return json(H.assistAnswer(body,{domain:'calculator',reply:T.formatResult(out.result,'pl').slice(0,900),assistant:{toolDraft:four(out.draft),changedFields:out.changedFields.slice(),result}}));
 };
}
const frame=extra=>({EC:{conversationTools:T},...(extra||{})});
const shown=p=>JSON.parse(p.run('JSON.stringify(assistShown&&assistShown.result)'));
// The panel shows the registry's own summary lines of the locally computed result, word for word.
const panelShows=p=>{const text=p.text('assist-body'),r=shown(p);assert.ok(r.summary.length>0);for(const s of r.summary)assert.ok(text.includes(s.pl),'summary line shown: '+s.pl);};
const storedAssistant=p=>p.bank().contexts.find(e=>e.contextId===p.active()).envelope.assistant;
const BATTERY={capacityWh:1000,consumptionMode:'kwh_year',consumption:365,chargePercent:100,usablePercent:85};
const WIRE={noncontinuousLoadA:20,continuousLoadA:0,material:'cu',insulation:'thhn',ambientF:86,adjustmentFactor:1,terminalRatingC:75,circuitType:'BRANCH_CIRCUIT',jurisdiction:'NEC',feet:0};

test('battery: 1000 Wh / 365 kWh per year / 100 % / 85 % gives 20 h 24 min; "charge 50" changes only that field and gives 10 h 12 min',async()=>{
 const seen=[];
 const p=await H.load({frame:frame(),api:server([calculator('battery_runtime',{set:BATTERY,clear:[]}),calculator('battery_runtime',{set:{capacityWh:null,consumptionMode:null,consumption:null,chargePercent:50,usablePercent:null},clear:[]})],seen)});
 await send(p,'pojemność 1000 Wh, zużycie 365 kWh na rok, naładowanie 100 procent, użyteczne 85 procent');
 // The exact closed body of the contract, no job and no form for this conversation.
 const first=seen[0].body;
 assert.deepEqual(Object.keys(first).sort(),['assistant','protocol','requestId','state','text','version']);
 assert.deepEqual(Object.keys(first.assistant).sort(),['baseFingerprint','clock','contextToken','form','job','lang','toolDraft']);
 assert.equal(first.protocol,'ec.assist');assert.equal(first.version,1);assert.equal(seen[0].init.headers['X-EC-Request-Id'],first.requestId);assert.equal(seen[0].init.headers['X-EC-Token'],TOKEN);
 assert.deepEqual([first.assistant.toolDraft,first.assistant.form,first.assistant.job,first.assistant.clock],[null,null,null,null]);
 assert.equal(first.assistant.baseFingerprint,'ab1/r0/d:-/f:-/j:-');assert.match(first.assistant.contextToken,/^[A-Za-z0-9_-]{8,80}$/);
 assert.match(JSON.stringify(shown(p).coreResult),/20 h 24 min/);assert.equal(shown(p).status,'complete');
 panelShows(p);assert.match(p.text('assist-body'),/To nie jest odbiór/);
 assert.equal(p.els.input.value,'');assert.equal(p.run('state.history.length'),2);
 await send(p,'naładowanie 50 procent');
 const second=seen[1].body,draft=second.assistant.toolDraft;
 assert.deepEqual(Object.keys(draft).sort(),['fingerprint','input','origins','tool'],'only the four draft members travel: no result is ever sent');
 assert.deepEqual(draft.input,BATTERY);assert.equal(second.assistant.baseFingerprint,'ab1/r1/d:battery_runtime@'+draft.fingerprint+'/f:-/j:-');
 const kept=storedAssistant(p).tool;
 assert.deepEqual(kept.input,{...BATTERY,chargePercent:50},'every other field is exactly as stated before');
 assert.deepEqual(JSON.parse(p.run('JSON.stringify(assistChanged)')),['chargePercent']);
 assert.match(JSON.stringify(shown(p).coreResult),/10 h 12 min/);panelShows(p);assert.match(p.text('assist-body'),/zmienione teraz/);
 // Direct core parity: the screen holds exactly what the registry computes for these declared values.
 assert.deepEqual(shown(p),own(T.run('battery_runtime',{...BATTERY,chargePercent:50}).result));
 // Stored: input state only. No result, summary or engine answer is kept with the draft.
 assert.deepEqual(Object.keys(kept).sort(),['fingerprint','input','origins','tool']);
 assert.ok(!/coreResult|summary|normalizedInput/.test(JSON.stringify(storedAssistant(p))));
});

test('reload, offline and portable export: the stored input is recomputed locally; nothing is trusted from storage or a file',async()=>{
 const p=await H.load({frame:frame(),api:server([calculator('battery_runtime',{set:{...BATTERY,chargePercent:50},clear:[]})])});
 await send(p,'akumulator 1000 Wh przy 50 procentach');
 // Same browser storage, a new document, no AI at all (the default fixture server is "not configured"), offline.
 const q=await H.load({local:p.local,session:p.session,frame:frame(),onLine:false});
 assert.equal(q.count('/api/assist'),0);assert.equal(q.run('token'),null);
 assert.match(JSON.stringify(shown(q).coreResult),/10 h 12 min/);panelShows(q);
 // Without the registry in the tools frame no number is shown at all.
 const bare=await H.load({local:p.local,session:p.session});
 assert.equal(shown(bare),null);assert.match(bare.text('assist-body'),/nie pokazano żadnej liczby/);assert.ok(!/10 h 12 min/.test(bare.text('assist-body')));
 // Portable archive: carries the draft (input only); a fresh browser accepts it and computes the result itself.
 await p.click('export');const archive=JSON.parse(p.downloads[p.downloads.length-1]);
 assert.equal(archive.kind,'empire-code.conversation-archive');assert.deepEqual(archive.entry.envelope.assistant.tool.input,{...BATTERY,chargePercent:50});
 const fresh=await H.load({frame:frame()});
 await fresh.click('manage-open');await fresh.choose(JSON.stringify(archive));
 assert.match(fresh.text('import-preview'),/kalkulator rozmowy/);
 await fresh.click('import-apply');
 await fresh.run("hostExclusive(()=>{switchContext('"+archive.entry.contextId+"');render();})");await H.settle();
 assert.match(JSON.stringify(shown(fresh).coreResult),/10 h 12 min/);
 // A file that smuggles a result, an unknown member, or an input the registry refuses is refused as a whole.
 const variants={
  'a result inside the draft':a=>{a.tool.result={status:'complete',summary:[{pl:'Około 99 h',en:'99 h'}]};},
  'an unknown member':a=>{a.shadow={any:'thing'};},
  'an input the registry refuses':a=>{a.tool.input.chargePercent=5000;},
  'a stale fingerprint':a=>{a.tool.input.capacityWh=2000;},
  'an empty assistant member':a=>{a.tool=null;},
  'a foreign origin':a=>{a.tool.origins.capacityWh='model';}};
 for(const [name,change] of Object.entries(variants)){
  const file=own(archive);change(file.entry.envelope.assistant);
  const other=await H.load({frame:frame()}),before=other.local.dump();
  await other.click('manage-open');await other.choose(JSON.stringify(file));
  const apply=other.find('import-apply');
  assert.ok(!apply||apply.disabled,name+': not applicable');assert.equal(other.local.dump(),before,name+': nothing stored');
 }
});

test('a result that differs from the local engine is discarded; the screen shows the recomputed one',async()=>{
 const tamper=r=>{r.coreResult=JSON.parse(JSON.stringify(r.coreResult).replace(/20 h 24 min/g,'99 h 59 min'));r.summary=[{pl:'Około 99 h 59 min',en:'About 99 h 59 min'}];return r;};
 const p=await H.load({frame:frame(),api:server([calculator('battery_runtime',{set:BATTERY,clear:[]},tamper)])});
 await send(p,'akumulator 1000 Wh, 365 kWh rocznie, 100 i 85 procent');
 assert.equal(p.run('assistShown.discarded'),true);
 assert.deepEqual(shown(p),own(T.run('battery_runtime',BATTERY).result));
 assert.ok(!/99 h 59 min/.test(p.text('assist-body')));panelShows(p);assert.match(p.text('assist-body'),/został odrzucony/);
});

test('stale answers change nothing: wrong token, context change and revert with an identical fingerprint, conversation switch',async()=>{
 const cases={
  'echoed token of another context':{answer:body=>{const a=H.assistAnswer(body);a.base.contextToken='ctx-somebody-else-0-0';return a;}},
  'wrong protocol version':{answer:body=>({...H.assistAnswer(body),version:2})},
  'state that is not base + 1':{answer:body=>{const a=H.assistAnswer(body);a.state.revision+=1;return a;}},
  'a non-material turn that changes the list':{answer:body=>{const a=H.assistAnswer(body,{domain:'clarification'});a.state.items.push(H.item(1));a.state.nextId=2;return a;}},
  'model text outside the material domain':{answer:body=>H.assistAnswer(body,{domain:'clarification',replyOrigin:'model_text'})},
  // The calculator draft is taken away and put back while the request is in flight: every fingerprint is equal again.
  'draft changed and reverted':{during:p=>p.run('{const keep=assistantMeta;assistantMeta=null;assistEpoch++;assistantMeta=keep;assistEpoch++;}')},
  'conversation left and reopened':{during:async p=>{const id=p.active();await p.run('hostExclusive(()=>{openNewContext(null);})');await p.run("hostExclusive(()=>{switchContext('"+id+"');})");}}};
 for(const [name,c] of Object.entries(cases)){
  let release;const gate=new Promise(r=>{release=r;});
  const late=async body=>{await gate;return json(c.answer?c.answer(body):H.assistAnswer(body));};
  const p=await H.load({frame:frame(),api:server([calculator('battery_runtime',{set:BATTERY,clear:[]}),late])});
  await send(p,'akumulator 1000 Wh, 365 kWh rocznie');
  const state=p.run('JSON.stringify(state)'),assistant=JSON.stringify(storedAssistant(p)),text='naładowanie 50 procent';
  await p.type(text);await p.submit();
  if(c.during)await c.during(p);
  release();await idle(p);await H.settle();
  assert.equal(p.run('JSON.stringify(state)'),state,name+': state');assert.equal(JSON.stringify(storedAssistant(p)),assistant,name+': draft');
  assert.equal(p.count('/api/assist'),2,name+': exactly one attempt, no retry');
  assert.ok(p.local.dump().includes(text),name+': the typed text stays stored');
  if(!/conversation/.test(name)){assert.equal(p.els.input.value,text,name+': text stays in the field');assert.equal(p.els.status.className,'error',name);}
 }
});

test('current Wire Sizer form: explicit one-shot import, registry parity, and a correction patches only the changed field',async()=>{
 assert.equal(T.run('wire_sizing',WIRE,{origin:'current_form'}).ok,true,'fixture form input is valid for the registry');
 const applied=[];let generation='g7.1',captures=0,applyAnswer=null;
 const bridge={
  // What the real bridge reports about its open form (docs/conversation-form-bridge.md, getState): the current generation and the active tool.
  getState(){return {ok:true,status:'ready',ready:true,reasons:[],bridgeRevision:1,generation,active:{toolIds:['wire_sizing'],navigationOnlyIds:[],primaryToolId:'wire_sizing'},job:null};},
  capture(){captures++;return {ok:true,status:'captured',capture:'full',toolId:'wire_sizing',reason:null,formInput:WIRE,fingerprint:T.fingerprintInput('wire_sizing',WIRE).fingerprint,fields:[],needsInput:[],warnings:[],generation,bridgeRevision:1,active:null};},
  apply(request){applied.push(own(request));if(applyAnswer)return applyAnswer;generation='g7.2';return {ok:true,status:'applied',applied:true,reason:null,toolId:request.toolId,changedFields:Object.keys(request.patch.set),previousGeneration:'g7.1',generation};},
  navigate:()=>({ok:false,status:'unsupported'})};
 const seen=[];
 // The second answer arrives after the user touched the form: the bridge generation moved on while the request was pending.
 const touchedMeanwhile=body=>{generation='g7.9';return calculator('wire_sizing',{set:{ambientF:104},clear:[]})(body);};
 const p=await H.load({frame:frame({ECAssistantBridge:bridge}),api:server([calculator('wire_sizing',{set:{feet:120,voltage:240,phase:1,maxVoltDropPercent:3},clear:[]}),touchedMeanwhile,calculator('wire_sizing',{set:{ambientF:104},clear:[]})],seen)});
 await p.click('assist-use-form');
 assert.equal(captures,1);assert.equal(p.count('/api/assist'),0,'the form is imported locally; nothing is sent');
 const local=storedAssistant(p).tool;
 assert.deepEqual(local.input,WIRE);assert.ok(Object.values(local.origins).every(o=>o==='current_form'));
 assert.deepEqual(shown(p),own(T.run('wire_sizing',WIRE,{origin:'current_form'}).result),'same result as the canonical engine through the registry');
 assert.match(p.text('assist-body'),/z formularza/);
 await send(p,'długość 120 stóp przy 240 V jednofazowo, limit spadku 3 procent');
 assert.equal(seen[0].body.assistant.form,null,'no form snapshot is resent with a later turn');assert.deepEqual(seen[0].body.assistant.toolDraft.input,WIRE);
 const next=storedAssistant(p).tool,changed=['feet','voltage','phase','maxVoltDropPercent'];
 for(const k of Object.keys(WIRE))if(!changed.includes(k)){assert.deepEqual(next.input[k],WIRE[k],k+' unchanged');assert.equal(next.origins[k],'current_form',k);}
 for(const k of changed)assert.equal(next.origins[k],'conversation',k);
 assert.equal(captures,1,'the form is not captured again, so it cannot overwrite the correction');
 assert.deepEqual(applied,[{toolId:'wire_sizing',expectedGeneration:'g7.1',patch:{set:{feet:120,voltage:240,phase:1,maxVoltDropPercent:3},clear:[]}}],'only the changed fields go to the form, with the capture generation');
 assert.deepEqual(shown(p),own(T.run('wire_sizing',{...WIRE,feet:120,voltage:240,phase:1,maxVoltDropPercent:3}).result));
 // The form was touched while the next request was pending (stricter contract of the correction): the late answer is discarded
 // as a whole. Nothing is stored, nothing is written to the form, the text stays, and the link is dropped with the next step said.
 applyAnswer={ok:false,status:'stale',applied:false,reason:'GENERATION_CHANGED',generation:'g7.9'};
 const keptState=p.run('JSON.stringify(state)'),keptDraft=JSON.stringify(storedAssistant(p));
 await send(p,'temperatura otoczenia 104 stopnie');
 assert.equal(applied.length,1,'the bridge is not asked to write for a discarded answer');
 assert.equal(p.run('JSON.stringify(state)'),keptState);assert.equal(JSON.stringify(storedAssistant(p)),keptDraft);assert.equal(storedAssistant(p).tool.input.ambientF,86);
 assert.equal(p.els.input.value,'temperatura otoczenia 104 stopnie');assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/zanim nadeszła odpowiedź/);
 assert.match(p.els['assist-status'].textContent,/zmienił się od pobrania/);assert.equal(p.run('assistLink'),null);
 assert.equal(p.count('/api/assist'),2,'one attempt, no retry');assert.equal(captures,1,'the form is not captured again by itself');
 // Sent again by the user, the message is an ordinary turn on the conversation's own data: stored, and the form is left alone.
 await p.submit();await idle(p);
 assert.equal(p.count('/api/assist'),3);assert.equal(storedAssistant(p).tool.input.ambientF,104);assert.equal(applied.length,1);assert.equal(captures,1);
 assert.deepEqual(seen[2].body.assistant.toolDraft.input,{...WIRE,feet:120,voltage:240,phase:1,maxVoltDropPercent:3});assert.equal(seen[2].body.assistant.form,null);
});

test('form capture is honest: nothing is assumed for a missing, navigation-only or unready form',async()=>{
 const answers=[[{ok:false,status:'needs_form',capture:'requires_form',toolId:'pull_box',formInput:null,generation:'g1.1'},/nie ma teraz wartości/],[{ok:false,status:'navigation_only',capture:'none',toolId:'power',formInput:null,generation:'g1.1'},/tylko w zakładce Narzędzia/],[{ok:false,status:'not_ready',capture:'none',toolId:null,formInput:null,generation:null},/nie są jeszcze gotowe/],[{ok:false,status:'needs_input',capture:'unsupported',toolId:'voltage_drop',formInput:null,generation:'g1.1'},/nie ma formularza/]];
 for(const [answer,message] of answers){
  const p=await H.load({frame:frame({ECAssistantBridge:{capture:()=>answer,apply(){throw Error('no write expected');},navigate:()=>({status:'unsupported'})}})}),before=p.local.dump();
  await p.click('assist-use-form');
  assert.match(p.els['assist-status'].textContent,message);assert.equal(p.local.dump(),before);assert.equal(p.run('assistantMeta'),null);
 }
 // Without the bridge the action is not offered at all.
 const bare=await H.load({frame:frame()});assert.equal(bare.find('assist-use-form').disabled,true);
});

test('Power / Torque / Bender: a navigation answer calculates nothing and creates no draft',async()=>{
 const p=await H.load({frame:frame(),api:server([body=>json(H.assistAnswer(body,{domain:'navigation',reply:'Otwórz narzędzie „Moc” w aplikacji. Nic nie policzono.',assistant:{navigation:{tool:'power',form:{},executableHere:false,reason:'NO_PURE_MODULE'}}}))])});
 await send(p,'policz moc dla 20 amperów');
 assert.equal(p.run('assistantMeta'),null);assert.equal(shown(p),null);
 assert.match(p.text('assist-body'),/niczego dla niego nie policzyła/);assert.ok(p.find('assist-open-tool'));
});

test('old material flow through the same endpoint: items, changes and undo work as before; errors keep the text and are not retried',async()=>{
 const add=body=>{const state=own(body.state),it=H.item(1);state.items.push(it);state.nextId=2;state.revision++;state.history.push({role:'user',content:body.text},{role:'assistant',content:'Dodano.'});return json(H.assistAnswer(body,{state,reply:'Dodano.',diffs:[{op:'add',after:it}]}));};
 const refuse=()=>json({error:'Nie rozpoznano jednego wywołania funkcji.',code:'ASSIST_CALL'},422);
 const p=await H.load({frame:frame(),api:server([add,refuse])});
 await send(p,'dodaj jeden bushing');
 assert.equal(p.run('state.items.length'),1);assert.equal(p.els.count.textContent,1);assert.match(p.els.status.textContent,/Zaktualizowano roboczy szkic/);assert.equal(p.run('assistantMeta'),null);
 await send(p,'tekst którego serwer nie przyjmie');
 assert.equal(p.els.input.value,'tekst którego serwer nie przyjmie');assert.match(p.els.status.textContent,/Nie rozpoznano jednego wywołania funkcji/);assert.equal(p.count('/api/assist'),2);
 assert.equal(p.els.export.disabled,false);assert.match(p.els.limits.textContent,/Pozostałe zapytania pilotażu: 59/,'only the accepted request is known to be counted');
 await p.click('undo');assert.equal(p.run('state.items.length'),0);
});

test('voice: one transcription and one interpretation; the budget guards of typed and spoken messages still hold',async()=>{
 const p=await H.load({frame:frame(),media:true,api:server([body=>json(H.assistAnswer(body))])});
 await p.els.mic.onclick();await H.settle();await p.els.mic.onclick();await p.media.recorders[0].finish();await idle(p);await H.settle();
 assert.deepEqual(p.calls.map(c=>c.url),['/api/session','/api/transcribe','/api/assist']);
 assert.equal(JSON.parse(p.calls[2].init.body).text,'pojemność 1000 Wh');assert.equal(p.run('state.history.length'),2);
 const one=await H.load({media:true,api:url=>url==='/api/session'?json({...sessionBody(),remainingRequests:1}):Promise.reject(Error('unexpected '+url))});
 assert.equal(one.els.send.disabled,false);assert.equal(one.els.mic.disabled,true);
 const zero=await H.load({media:true,api:url=>url==='/api/session'?json({...sessionBody(),remainingRequests:0}):Promise.reject(Error('unexpected '+url))});
 assert.equal(zero.els.send.disabled,true);assert.equal(zero.els.mic.disabled,true);assert.equal(zero.els.input.disabled,false);
});

test('pure rules: response acceptance, bank layout compatibility and the optional assistant member',()=>{
 const state=H.blankState(),sent=AS.request({requestId:'r'.repeat(12),text:'policz',state,lang:'pl',contextToken:'ctx-test-0-0',toolDraft:null,form:null,job:null,clock:null});
 assert.equal(sent.assistant.baseFingerprint,'ab1/r0/d:-/f:-/j:-');
 assert.equal(AS.response(H.assistAnswer(sent),sent).domain,'materials');
 for(const change of [a=>{a.requestId='other-request';},a=>{a.baseRevision=5;},a=>{a.base.fingerprint='ab1/r0/d:x@ct1-0000000000000000-1/f:-/j:-';},a=>{a.assistant.extra=1;},a=>{a.domain='code_answer';},a=>{a.assistant.actionProposal={kind:'ec.assist.jobNoteAppend'};}]){
  const a=H.assistAnswer(sent);change(a);assert.throws(()=>AS.response(a,sent),/Nieaktualna propozycja/);
 }
 // A proposal without a selected job in the request is never accepted.
 const note=H.assistAnswer(sent,{domain:'job_note',assistant:{actionProposal:{kind:'ec.assist.jobNoteAppend',version:1,proposalId:'a'.repeat(64),committed:false,requiresUserReview:true,target:{jobId:H.ids.job(1),baseRevisionId:'jrev1_'+'1'.repeat(32),baseRevisionNumber:1},append:{text:'x',separator:'',baseNotesLength:0,resultingNotesLength:1},evidence:{sourceQuote:'policz'},modelAuthored:['append.text']}}});
 assert.throws(()=>AS.response(note,sent),/Nieaktualna propozycja/);
 // Released layout 1 and conversations without assistant data: read entry for entry, nothing added, nothing dropped.
 const old=H.entry(1,{state:H.filledState(2),job:3,source:11,receipts:[H.receipt(3,1)],input:'niewysłane'});
 const read=CBank.read(H.bankV1([old]));
 assert.equal(read.stored,1);assert.equal(JSON.stringify(read.bank.contexts[0]),JSON.stringify(old));assert.ok(!Object.hasOwn(read.bank.contexts[0].envelope,'assistant'));
 // The member is optional but never loose: a malformed one is refused by the bank itself.
 const draft=four(T.run('battery_runtime',BATTERY).draft),now=H.T;
 const good=CBank.commit(CBank.empty(),{contextId:H.ids.ctx(5),baseVersion:0,input:'',now,envelope:{state,undo:[],diffs:[],workspace:null,assistant:{version:1,tool:draft,proposal:null,action:null,receipts:[]}}});
 assert.deepEqual(good.entry.envelope.assistant.tool,draft);
 assert.deepEqual(AS.validate(good.entry.envelope.assistant,AS.contextOf(null)).tool,draft);
 for(const assistant of [null,[],{version:1,tool:draft,proposal:null,action:null},{version:1,tool:null,proposal:null,action:{phase:'pending'},receipts:[]},{version:1,tool:null,proposal:null,action:null,receipts:[{planId:'x',state:'confirmed'}]}]){
  assert.throws(()=>CBank.commit(CBank.empty(),{contextId:H.ids.ctx(6),baseVersion:0,input:'',now,envelope:{state,undo:[],diffs:[],workspace:null,assistant}}),e=>e.code==='INVALID');
 }
 assert.throws(()=>AS.validate({version:1,tool:{...draft,result:{status:'complete'}},proposal:null,action:null,receipts:[]}),/kalkulator/);
 assert.throws(()=>AS.validate({version:2,tool:draft,proposal:null,action:null,receipts:[]}),/nieznany układ/);
});
