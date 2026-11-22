// Stage 5 — /api/assist deterministic boundary and provider (docs/assistant-api-contract.md).
// Authored for coordinator execution; no run is claimed. No network: the transport is synthetic and every "model"
// answer below is a hand-written Responses fixture. These tests prove what the APPLICATION does with a given function
// call; they are NOT evidence of how a real model interprets Polish, English or mixed speech.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createAssistantProvider,createCloudAssistantProvider} from '../candidate/server/assistant-provider.mjs';
import {createProvider,SCHEMA,MODEL} from '../candidate/server/cloud-provider.mjs';
import {ASSISTANT_PROMPT} from '../candidate/server/assistant-prompt.mjs';
import {EMPTY,ADD,TEXT,completed} from './backend-fixtures.mjs';

const require=createRequire(import.meta.url);
const A=require('../candidate/server/assistant-contract.cjs');
const C=require('../candidate/server/contract.cjs');
const R=require('../core/src/calc/conversationTools.js');
const battery=require('../core/src/calc/batteryRuntime.js');
const {selectConductor}=require('../core/src/calc/wireSizing.js');
const M=require('../core/src/jobs/jobMeasurement.js');
const J=require('../core/src/jobs/jobCard.js');

const json=v=>JSON.parse(JSON.stringify(v));
const FULL={capacityWh:1000,consumptionMode:'kwh_year',consumption:365,chargePercent:100,usablePercent:85};
const WS={noncontinuousLoadA:20,continuousLoadA:0,material:'cu',insulation:'thhn',ambientF:86,adjustmentFactor:1,terminalRatingC:75,circuitType:'BRANCH_CIRCUIT',jurisdiction:'NYC',feet:10,voltage:120,phase:1,maxVoltDropPercent:3};
const JOB={jobId:'job1_'+'a'.repeat(32),revisionId:'jrev1_'+'b'.repeat(32),revisionNumber:4,notesLength:120};
const CLOCK={local:'2026-11-21T14:05',utcOffset:'+01:00'};
const MEASURED='Zmierzyłem 121,4 V AC between L1 and neutral w panelu głównym, miernik Fluke 117';
const READING={label:'L1-N voltage',quantity:'voltage',value_text:'121.4',value_quote:'121,4',unit:'V',unit_quote:'V',reading_quote:'121,4 V',location:'between L1 and neutral w panelu głównym',mode:'AC',instrument:'Fluke 117',notes:null,source_quote:'Zmierzyłem 121,4 V AC between L1 and neutral w panelu głównym'};

// The model-facing patch of a typed tool: every model field present, null when not stated in the utterance.
const patch=(tool,stated,clear=[])=>({set:Object.fromEntries(R.getTool(tool).modelFields.map(k=>[k,Object.hasOwn(stated,k)?stated[k]:null])),clear});
const calc=(tool,stated)=>['ec_calc_'+tool,patch(tool,stated)];
// A completed Responses answer with one function call (plus a reasoning item, as reasoning models return).
const called=(name,args,{before=[],after=[]}={})=>({status:'completed',output:[{type:'reasoning',id:'rs_1',summary:[]},...before,{type:'function_call',id:'fc_1',call_id:'call_1',name,arguments:typeof args==='string'?args:JSON.stringify(args),status:'completed'},...after],usage:{total_tokens:1}});
const wire=draft=>draft?{tool:draft.tool,input:json(draft.input),origins:{...draft.origins},fingerprint:draft.fingerprint}:null;
const formOf=(tool,input)=>({tool,input,fingerprint:R.fingerprintInput(tool,input).fingerprint});
function body({text='Policz',state=EMPTY,lang='pl',toolDraft=null,form=null,job=null,clock=null,requestId='request-0001',contextToken='ctx-00000001',baseFingerprint}={}){
 return{protocol:'ec.assist',version:1,requestId,text,state,assistant:{lang,contextToken,baseFingerprint:baseFingerprint??A.baseFingerprint({revision:state.revision,toolDraft,form,job}),toolDraft,form,job,clock}};
}
const follow=(out,text,extra={})=>body({text,state:out.state,toolDraft:out.assistant.toolDraft,...extra});
function session(){
 const sent=[];
 let answer=null;
 const provider=createAssistantProvider({prompt:ASSISTANT_PROMPT,request:async(route,options)=>{sent.push({route,options});return typeof answer==='function'?answer(route,options):answer;}});
 const turn=async(input,response)=>{answer=response;const before=JSON.stringify(input);const out=await provider.assist(provider.checkAssist(structuredClone(input)));assert.equal(JSON.stringify(input),before,'request not mutated');return out;};
 return{provider,sent,turn};
}
const code=(name,status)=>e=>e.safe===true&&e.code===name&&(status===undefined||e.status===status)&&typeof e.message==='string'&&e.message.length<300;
// Invariants of every non-material answer: one more revision, two more history messages, untouched items.
function recorded(input,out){
 assert.equal(out.protocol,'ec.assist');assert.equal(out.version,1);
 assert.equal(out.baseRevision,input.state.revision);assert.deepEqual(out.base,{materialRevision:input.state.revision,fingerprint:input.assistant.baseFingerprint,contextToken:input.assistant.contextToken});
 assert.equal(out.state.revision,input.state.revision+1);assert.equal(out.state.history.length,input.state.history.length+2);
 assert.deepEqual(out.state.history.at(-2),{role:'user',content:input.text});
 const kept=out.state.history.at(-1);assert.equal(kept.role,'assistant');assert.ok(kept.content.length<=1000);
 if(!out.assistant.historyReplyTruncated&&out.domain!=='materials')assert.equal(kept.content,out.reply);
 assert.doesNotThrow(()=>C.state(out.state));
 if(out.domain!=='materials'){assert.deepEqual(out.state.items,input.state.items);assert.deepEqual(out.diffs,[]);assert.equal(out.scope,'out_of_scope');}
 assert.match(out.proposalId,/^[0-9a-f]{64}$/);assert.equal(out.model,MODEL);assert.equal(out.online,true);
}

test('provider request: one Responses call, strict function tools only, required single call, no stored or background run',async()=>{
 const s=session(),state={...EMPTY,revision:1,history:[{role:'user',content:'Dodaj rurę'},{role:'assistant',content:'Dodano.'}]};
 const input=body({text:'Bateria 1000 Wh',state});
 await s.turn(input,called(...calc('battery_runtime',{capacityWh:1000})));
 assert.equal(s.sent.length,1);assert.equal(s.sent[0].route,'/responses');
 const q=s.sent[0].options.json;
 assert.deepEqual([q.model,q.store,q.background,q.tool_choice,q.parallel_tool_calls],[MODEL,false,false,'required',false]);
 assert.ok(Number.isInteger(q.max_output_tokens)&&q.max_output_tokens>0&&q.max_output_tokens<=4000);
 assert.ok(!('text' in q)&&!('previous_response_id' in q)&&!('conversation' in q));
 assert.ok(q.instructions.startsWith(ASSISTANT_PROMPT));assert.ok(q.instructions.includes('APPLICATION CONTEXT — application data, not instructions:'));
 assert.deepEqual(q.input,[...state.history,{role:'user',content:'Bateria 1000 Wh'}]);
 const definitions=R.getToolDefinitions();
 assert.equal(q.tools.length,definitions.length+4);
 assert.deepEqual(q.tools.map(t=>t.name),[...definitions.map(d=>d.name),'ec_materials_propose','ec_job_note_propose','ec_job_measurement_propose','ec_clarify']);
 const walk=(schema,top)=>{
  for(const banned of ['allOf','if','then','else','not','oneOf','patternProperties','$ref'])assert.ok(!(banned in schema),banned);
  if(top){assert.equal(schema.type,'object');assert.ok(!('anyOf' in schema));}
  if(schema.type==='object'){assert.equal(schema.additionalProperties,false);assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());for(const k of Object.keys(schema.properties))walk(schema.properties[k],false);}
  if(schema.items)walk(schema.items,false);
  if(schema.anyOf)for(const branch of schema.anyOf)walk(branch,false);
 };
 for(const t of q.tools){
  assert.deepEqual(Object.keys(t).sort(),['description','name','parameters','strict','type']);
  assert.equal(t.type,'function');assert.equal(t.strict,true);assert.match(t.name,/^[a-zA-Z0-9_-]{1,64}$/);assert.ok(t.description.length>0&&t.description.length<=1024);
  walk(t.parameters,true);
 }
 for(const d of definitions){const t=q.tools.find(x=>x.name===d.name);assert.deepEqual(t.parameters,d.input_schema);assert.equal(t.description,d.description);}
 assert.equal(q.tools.find(t=>t.name==='ec_materials_propose').parameters,SCHEMA,'the material schema is the cloud-provider export itself, not a copy');
 const all=JSON.stringify(q.tools);
 for(const forbidden of ['jobId','revisionId','measurementId','savedAt','adopt','"url"','javascript'])assert.ok(!all.includes(forbidden),forbidden);
 assert.deepEqual(q.tools.find(t=>t.name==='ec_job_measurement_propose').parameters.properties.quantity.enum,Object.keys(M.UNITS));
});

test('battery: 1000 Wh, 365 kWh/year, 100 %, 85 % → 20 h 24 min; "charge 50 %" changes only that field → 10 h 12 min',async()=>{
 const s=session();
 const first=body({text:'Bateria 1000 Wh, lodówka 365 kWh na rok, naładowana na 100 procent, energia użyteczna 85 procent. Na ile starczy?'});
 const prose={type:'message',content:[{type:'output_text',text:'Czas pracy: Około 99 h'}]};
 const one=await s.turn(first,called(...calc('battery_runtime',FULL),{before:[prose]}));
 recorded(first,one);
 const direct=R.run('battery_runtime',FULL);
 assert.equal(one.domain,'calculator');assert.equal(one.assistant.replyOrigin,'deterministic');
 assert.deepEqual(one.assistant.result,json(direct.result));
 assert.deepEqual(one.assistant.result.coreResult,json(battery.calculateBatteryRuntime(FULL)));
 assert.equal(one.reply,R.formatResult(direct.result,'pl'));assert.ok(one.reply.includes('Około 20 h 24 min'));
 assert.ok(!JSON.stringify(one).includes('99 h'),'model prose is never used');
 assert.deepEqual(one.assistant.toolDraft,wire(direct.draft));assert.deepEqual(Object.keys(one.assistant.toolDraft),['tool','input','origins','fingerprint']);
 assert.deepEqual(one.assistant.changedFields,Object.keys(FULL));
 assert.deepEqual([one.assistant.result.flags.installationApproved,one.assistant.result.flags.approval,one.assistant.result.flags.persistence],[false,'none','conversation_only']);

 const second=follow(one,'a przy naładowaniu 50 procent?');
 const two=await s.turn(second,called(...calc('battery_runtime',{chargePercent:50})));
 recorded(second,two);
 const half={...FULL,chargePercent:50},expected=R.run('battery_runtime',half);
 assert.deepEqual(two.assistant.changedFields,['chargePercent']);
 assert.deepEqual(two.assistant.toolDraft.input,half);
 assert.deepEqual(two.assistant.result.coreResult,json(battery.calculateBatteryRuntime(half)));
 assert.deepEqual([two.assistant.result.coreResult.data.duration.hours,two.assistant.result.coreResult.data.duration.minutes],[10,12]);
 assert.equal(two.reply,'Zmienione pola: chargePercent.\n'+R.formatResult(expected.result,'pl'));assert.ok(two.reply.includes('Około 10 h 12 min'));
 assert.notEqual(two.assistant.toolDraft.fingerprint,one.assistant.toolDraft.fingerprint);
 // The context of the second request carried the draft as data and listed nothing as missing.
 const context=s.sent[1].options.json.instructions;
 assert.ok(context.includes('"calculatorDraft":{"tool":"battery_runtime"')&&context.includes('"missing":[]'));

 // Restore: the client sends the draft without any result; an utterance that states nothing new recomputes the same result.
 const third=follow(two,'pokaż jeszcze raz wynik');
 const three=await s.turn(third,called(...calc('battery_runtime',{})));
 assert.deepEqual(three.assistant.changedFields,[]);assert.deepEqual(three.assistant.result,two.assistant.result);assert.equal(three.reply,R.formatResult(expected.result,'pl'));
 assert.equal(s.sent.length,3);
});

test('Wire Sizer parity with the engine; the explicit form snapshot is imported once and a stated value overrides it',async()=>{
 const s=session(),long={...WS,feet:100};
 const input=body({lang:'en',text:'Size it: 20 A noncontinuous, 0 continuous, copper THHN, 86 F, factor 1, 75 C terminals, branch circuit, NYC, 100 ft, 120 V single phase, 3 percent drop.'});
 const out=await s.turn(input,called(...calc('wire_sizing',long)));
 recorded(input,out);
 const direct=R.run('wire_sizing',long),engine=selectConductor({...long,feedsDwellingUnit:null});
 assert.deepEqual(out.assistant.result.coreResult,json(engine));
 assert.deepEqual(out.assistant.result,json(direct.result));
 assert.equal(out.reply,R.formatResult(direct.result,'en'));
 assert.equal(out.assistant.result.coreResult.finalSelectedConductor,engine.finalSelectedConductor);
 assert.equal(out.assistant.result.flags.installationApproved,false);

 const form=formOf('wire_sizing',WS);
 const withForm=body({lang:'en',text:'Use what is in the form, but make it 100 feet',form});
 const imported=await s.turn(withForm,called(...calc('wire_sizing',{feet:100})));
 recorded(withForm,imported);
 assert.deepEqual(imported.assistant.result.coreResult,json(engine));
 assert.deepEqual(imported.assistant.toolDraft.input,json(direct.draft.input));
 assert.equal(imported.assistant.toolDraft.origins.material,'current_form');assert.equal(imported.assistant.toolDraft.origins.feet,'conversation');
 assert.ok(s.sent[1].options.json.instructions.includes('"formSnapshot":{"tool":"wire_sizing"'));
 // A snapshot for another tool is ignored, never merged into the called tool.
 const other=body({text:'Bateria 1000 Wh',form});
 const ignored=await s.turn(other,called(...calc('battery_runtime',{capacityWh:1000})));
 assert.deepEqual(ignored.assistant.toolDraft.input,{capacityWh:1000});
 // A function for another tool does not touch the active draft: it starts a new one from the stated values only.
 const switched=follow(out,'A teraz bateria 1000 Wh');
 const fresh=await s.turn(switched,called(...calc('battery_runtime',{capacityWh:1000})));
 assert.deepEqual(fresh.assistant.toolDraft,wire(R.run('battery_runtime',{capacityWh:1000}).draft));assert.deepEqual(fresh.assistant.changedFields,['capacityWh']);
});

test('missing critical fields are asked by the registry: nothing is defaulted, no engine runs, no number is produced',async()=>{
 const s=session();
 const input=body({text:'Dobierz przewód na 20 amperów'});
 const out=await s.turn(input,called(...calc('wire_sizing',{noncontinuousLoadA:20})));
 recorded(input,out);
 const r=out.assistant.result;
 assert.equal(r.status,'needs_input');assert.equal(r.engine.called,false);assert.equal(r.coreResult,null);
 for(const field of ['continuousLoadA','material','insulation','ambientF','adjustmentFactor','terminalRatingC','circuitType','jurisdiction','feet'])assert.ok(r.needsInput.some(n=>n.field===field),field);
 assert.deepEqual(out.assistant.toolDraft.input,{noncontinuousLoadA:20});
 assert.ok(out.reply.includes(R.STATUS_LABEL.needs_input.pl));assert.ok(!/AWG/.test(out.reply.split('\n')[0]));
 const unit=body({text:'Bateria 1000 Wh, zużycie 365'});
 const asked=await s.turn(unit,called(...calc('battery_runtime',{capacityWh:1000,consumption:365})));
 assert.equal(asked.assistant.result.status,'needs_input');
 assert.deepEqual(asked.assistant.result.needsInput.map(n=>n.field),['consumptionMode','chargePercent','usablePercent']);
});

test('Load Calc: imported form context only, parity with the registry, data never sent to the provider or set by the model',async()=>{
 const cases=JSON.parse(await readFile(new URL('../core/test/fixtures/loadCalc/LC82-cases-r1.json',import.meta.url),'utf8'));
 const request=cases.cases.find(c=>c.id==='LC82-B0P').request;
 const s=session();
 for(const tool of ['load_calc','load_calc_preliminary']){
  const input=body({text:'Policz Load Calc z formularza',form:formOf(tool,{request})});
  const out=await s.turn(input,called('ec_calc_'+tool,{action:'run_with_imported_context'}));
  const direct=R.run(tool,{request},{origin:'current_form'});
  assert.equal(out.domain,'calculator');assert.deepEqual(out.assistant.result,json(direct.result));assert.equal(out.reply,R.formatResult(direct.result,'pl'));
  assert.deepEqual(out.assistant.toolDraft.origins,{request:'current_form'});
  assert.deepEqual([out.assistant.result.flags.installationApproved,out.assistant.result.flags.approval,out.assistant.result.flags.serviceSizingRecord],[false,'none',false]);
  const q=s.sent.at(-1).options.json,secret=JSON.stringify(request).slice(1,121);
  assert.ok(q.instructions.includes('"formSnapshot":{"tool":"'+tool+'","importedFromForm":["request"]}'));
  assert.ok(!q.instructions.includes(secret)&&!JSON.stringify(q.input).includes(JSON.stringify(secret).slice(1,-1)),'the imported request stays on the server');
  // The draft alone (no form, no result) is enough to recompute on the next turn.
  const again=await s.turn(follow(out,'jeszcze raz'),called('ec_calc_'+tool,{action:'run_with_imported_context'}));
  assert.deepEqual(again.assistant.result,out.assistant.result);
 }
 const none=await s.turn(body({text:'Policz Load Calc'}),called('ec_calc_load_calc',{action:'run_with_imported_context'}));
 assert.equal(none.assistant.result.status,'needs_input');assert.equal(none.assistant.result.engine.called,false);
 for(const args of [{action:'run_with_imported_context',request},{set:{request},clear:[]},{action:'run'}])await assert.rejects(s.turn(body({text:'Policz Load Calc'}),called('ec_calc_load_calc',args)),code('ASSIST_ARGUMENTS',422));
 // A conversation-origin label on context-only data is refused before anything is sent.
 const forged=wire(R.run('load_calc',{request},{origin:'current_form'}).draft);forged.origins.request='conversation';
 const upstream=s.sent.length;
 assert.throws(()=>s.provider.checkAssist(body({toolDraft:forged})),code('ASSIST_CONTEXT',400));assert.equal(s.sent.length,upstream);
});

test('Power / Torque / Bender: honest navigation only; the active draft is left as it is',async()=>{
 const s=session(),draft=wire(R.run('battery_runtime',FULL).draft);
 for(const tool of ['power','torque','bender']){
  const input=body({text:'Otwórz '+tool,toolDraft:draft});
  const out=await s.turn(input,called('ec_open_tool',{tool}));
  recorded(input,out);
  assert.equal(out.domain,'navigation');assert.equal(out.assistant.result.status,'navigation_only');assert.equal(out.assistant.result.engine.called,false);assert.equal(out.assistant.result.coreResult,null);
  assert.deepEqual([out.assistant.navigation.tool,out.assistant.navigation.executableHere,out.assistant.navigation.reason],[tool,false,'NO_PURE_MODULE']);
  assert.ok(out.reply.includes(R.STATUS_LABEL.navigation_only.pl));assert.deepEqual(out.assistant.toolDraft,draft);
 }
 await assert.rejects(s.turn(body({text:'Otwórz'}),called('ec_open_tool',{tool:'eval'})),code('ASSIST_ARGUMENTS'));
});

test('exactly one valid function call: refusal, incomplete, zero or two calls, other items and malformed arguments are refused',async()=>{
 const s=session(),input=body({text:'Bateria 1000 Wh'}),good=calc('battery_runtime',{capacityWh:1000});
 const call=called(...good).output[1];
 const refused=[
  ['ASSIST_INCOMPLETE',{...called(...good),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}],
  ['ASSIST_INCOMPLETE',{...called(...good),error:{message:'x'}}],
  ['ASSIST_INCOMPLETE',null],
  ['ASSIST_REFUSAL',{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}],
  ['ASSIST_REFUSAL',called(...good,{before:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]})],
  ['ASSIST_CALL',{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'20 h'}]}]}],
  ['ASSIST_CALL',{status:'completed',output:[]}],
  ['ASSIST_CALL',{status:'completed'}],
  ['ASSIST_CALL',called(...good,{after:[{...call,id:'fc_2',call_id:'call_2'}]})],
  ['ASSIST_CALL',called(...good,{after:[{type:'web_search_call',id:'ws_1'}]})],
  ['ASSIST_CALL',{status:'completed',output:[{...call,status:'in_progress'}]}],
  ['ASSIST_CALL',{status:'completed',output:[{...call,arguments:{set:{}}}]}],
  ['ASSIST_CALL',called(good[0],'{"set":')],
  ['ASSIST_CALL',called(good[0],'[]')],
  ['ASSIST_CALL',called(good[0],'"text"')],
  ['ASSIST_CALL',called(good[0],' '.repeat(60001))],
  ['ASSIST_CALL',called('ec_calc_eval',good[1])],
  ['ASSIST_CALL',called('run_javascript',{code:'1+1'})],
  ['ASSIST_CALL',called('__proto__',{})],
  ['ASSIST_ARGUMENTS',called(good[0],{...good[1],formula:'1+1'})],
  ['ASSIST_ARGUMENTS',called(good[0],{set:{...good[1].set,result:20},clear:[]})],
  ['ASSIST_ARGUMENTS',called(good[0],{set:{...good[1].set,capacityWh:'1000'},clear:[]})],
  ['ASSIST_ARGUMENTS',called(good[0],JSON.stringify(good[1]).replace('"capacityWh":1000','"capacityWh":1e999'))],
  ['ASSIST_ARGUMENTS',called(good[0],JSON.stringify(good[1]).replace('"capacityWh":1000','"capacityWh":-1e999'))],
  ['ASSIST_ARGUMENTS',called(good[0],'{"set":{"__proto__":{"capacityWh":1}},"clear":[]}')],
  ['ASSIST_ARGUMENTS',called(good[0],'{"__proto__":{"x":1},"set":{},"clear":[]}')],
  ['ASSIST_ARGUMENTS',called(good[0],'{"set":{"constructor":1},"clear":[]}')],
  ['ASSIST_ARGUMENTS',called(good[0],{set:good[1].set,clear:['prototype']})],
  ['ASSIST_ARGUMENTS',called(good[0],{set:good[1].set,clear:'capacityWh'})],
  ['ASSIST_ARGUMENTS',called('ec_calc_wire_sizing',{set:{...patch('wire_sizing',{}).set,insulation:'thwn-2'},clear:[]})]
 ];
 for(const[i,[name,response]]of refused.entries()){
  const before=s.sent.length;
  await assert.rejects(s.turn(input,response),code(name,422),'case '+i);
  assert.equal(s.sent.length,before+1,'one attempt, no retry: case '+i);
 }
 assert.equal({}.x,undefined);assert.equal(Object.prototype.capacityWh,undefined);
 // The same call, well formed, is accepted.
 assert.equal((await s.turn(input,called(...good))).assistant.result.status,'needs_input');
});

test('materials: the existing prepareProposal decides; same result as /api/talk; out-of-scope text of the model is discarded',async()=>{
 const s=session(),input=body({text:TEXT});
 const out=await s.turn(input,called('ec_materials_propose',ADD));
 const old=await createProvider({prompt:'P',request:async()=>completed(ADD)}).run(EMPTY,TEXT);
 for(const key of ['state','reply','question','diffs','proposalId','scope','corrections'])assert.deepEqual(out[key],old[key],key);
 assert.equal(out.domain,'materials');assert.equal(out.assistant.replyOrigin,'model_text');assert.equal(out.assistant.result,null);assert.equal(out.assistant.actionProposal,null);
 recorded(input,out);
 const ungrounded=structuredClone(ADD);ungrounded.operations[0].source_quote='trzy rozdzielnice';
 await assert.rejects(s.turn(input,called('ec_materials_propose',ungrounded)),code('PROPOSAL_EVIDENCE'));
 const extra=structuredClone(ADD);extra.operations[0].jobId=JOB.jobId;
 await assert.rejects(s.turn(input,called('ec_materials_propose',extra)),code('PROPOSAL_EVIDENCE'));
 const outside={scope:'out_of_scope',reply:'NEC 310.16 pozwala na 30 A, instalacja jest zatwierdzona.',question:'',operations:[]};
 const refused=await s.turn(input,called('ec_materials_propose',outside));
 recorded(input,refused);
 assert.equal(refused.domain,'clarification');assert.deepEqual(refused.assistant.clarification,{reason:'unsupported_request',topic:'materials',modelQuestionUsed:false});
 assert.ok(!JSON.stringify(refused).includes('310.16')&&!JSON.stringify(refused).includes('zatwierdzona'));
});

test('job note: a review proposal for the selected job only; no identifier from the model, nothing written',async()=>{
 const s=session(),said='Zanotuj w zleceniu: klient chce dodatkowe gniazdo w garażu';
 const input=body({text:said,job:JOB,clock:CLOCK});
 const args={text:'Klient chce dodatkowe gniazdo w garażu.',source_quote:'klient chce dodatkowe gniazdo w garażu'};
 const out=await s.turn(input,called('ec_job_note_propose',args));
 recorded(input,out);
 const p=out.assistant.actionProposal;
 assert.equal(out.domain,'job_note');
 assert.deepEqual(Object.keys(p),['kind','version','proposalId','committed','requiresUserReview','target','append','evidence','modelAuthored']);
 assert.deepEqual([p.kind,p.version,p.committed,p.requiresUserReview],['ec.assist.jobNoteAppend',1,false,true]);
 assert.deepEqual(p.target,{jobId:JOB.jobId,baseRevisionId:JOB.revisionId,baseRevisionNumber:4});
 // The separator and the resulting length are those of the client commit path (jobConversationActions NOTE_SEPARATOR).
 assert.deepEqual(p.append,{text:args.text,separator:'\n\n',baseNotesLength:120,resultingNotesLength:122+args.text.length});
 assert.deepEqual(p.evidence,{sourceQuote:args.source_quote});assert.match(p.proposalId,/^[0-9a-f]{64}$/);
 assert.ok(out.reply.includes('niczego nie zapisano')&&out.reply.includes(args.text));
 // The provider was told only that a job is selected.
 const sent=JSON.stringify(s.sent[0].options.json);
 assert.ok(s.sent[0].options.json.instructions.includes('"jobSelected":true')&&!sent.includes('job1_')&&!sent.includes('jrev1_')&&!sent.includes('2026-11-21'));
 assert.equal((await s.turn(body({text:said,job:{...JOB,notesLength:0},clock:CLOCK}),called('ec_job_note_propose',args))).assistant.actionProposal.append.separator,'');
 for(const bad of [{...args,jobId:'job1_'+'c'.repeat(32)},{...args,revisionId:JOB.revisionId},{text:args.text},{...args,text:'   '},{...args,text:'x'.repeat(2001)},{...args,text:7}])
  await assert.rejects(s.turn(input,called('ec_job_note_propose',bad)),code('ASSIST_ARGUMENTS'));
 await assert.rejects(s.turn(input,called('ec_job_note_propose',{...args,source_quote:'klient chce nową rozdzielnicę'})),code('ASSIST_EVIDENCE'));
 const none=await s.turn(body({text:said}),called('ec_job_note_propose',args));
 assert.equal(none.domain,'clarification');assert.equal(none.assistant.actionProposal,null);assert.equal(none.assistant.clarification.reason,'job_not_selected');
 const full=await s.turn(body({text:said,job:{...JOB,notesLength:J.LIMITS.notes},clock:CLOCK}),called('ec_job_note_propose',args));
 assert.equal(full.assistant.actionProposal,null);assert.equal(full.assistant.clarification.reason,'note_limit');
 // Limit boundary with the two-character separator: exactly at the limit is proposed whole, one character over is
 // refused whole (with a one-character separator that second case would have been proposed and then refused on commit).
 const room=J.LIMITS.notes-2-args.text.length;
 const fits=await s.turn(body({text:said,job:{...JOB,notesLength:room},clock:CLOCK}),called('ec_job_note_propose',args));
 assert.deepEqual(fits.assistant.actionProposal.append,{text:args.text,separator:'\n\n',baseNotesLength:room,resultingNotesLength:J.LIMITS.notes});
 const over=await s.turn(body({text:said,job:{...JOB,notesLength:room+1},clock:CLOCK}),called('ec_job_note_propose',args));
 assert.equal(over.assistant.actionProposal,null);assert.equal(over.assistant.clarification.reason,'note_limit');
 // An empty job gets no separator; the text is never shortened to fit.
 const empty=await s.turn(body({text:said,job:{...JOB,notesLength:0},clock:CLOCK}),called('ec_job_note_propose',args));
 assert.deepEqual(empty.assistant.actionProposal.append,{text:args.text,separator:'',baseNotesLength:0,resultingNotesLength:args.text.length});
 const longest={text:'n'.repeat(2000),source_quote:args.source_quote};
 assert.equal((await s.turn(input,called('ec_job_note_propose',longest))).assistant.actionProposal.append.text.length,2000);
});

test('job measurement: fields of the real contract, value / unit / location only from the utterance, time from the client clock',async()=>{
 const s=session(),input=body({text:MEASURED,job:JOB,clock:CLOCK});
 const out=await s.turn(input,called('ec_job_measurement_propose',READING));
 recorded(input,out);
 const p=out.assistant.actionProposal;
 assert.equal(out.domain,'job_measurement');
 assert.deepEqual(Object.keys(p),['kind','version','proposalId','committed','requiresUserReview','target','fields','measuredAt','timeOrigin','evidence','modelAuthored']);
 assert.deepEqual([p.kind,p.committed,p.requiresUserReview,p.timeOrigin,p.measuredAt],['ec.assist.jobMeasurementCreate',false,true,'client_clock','2026-11-21T13:05:00.000Z']);
 assert.deepEqual(p.target,{jobId:JOB.jobId,jobRevisionId:JOB.revisionId,jobRevisionNumber:4});
 assert.deepEqual(p.fields,{label:'L1-N voltage',quantity:'voltage',valueText:'121.4',unit:'V',location:'between L1 and neutral w panelu głównym',measuredLocal:CLOCK.local,utcOffset:CLOCK.utcOffset,mode:'AC',instrument:'Fluke 117',notes:''});
 assert.deepEqual(Object.keys(p.fields),[...M.FIELDS]);assert.equal(M.validateFields(p.fields).ok,true);
 // The CLIENT can commit it later with its own identifiers; the proposal itself carries none.
 const committed=M.createInitial(p.fields,{measurementId:'meas1_'+'1'.repeat(32),revisionId:'mrev1_'+'2'.repeat(32),jobId:p.target.jobId,jobRevisionId:p.target.jobRevisionId,savedAt:'2026-11-21T13:06:00.000Z'});
 assert.equal(committed.ok,true);assert.ok(!JSON.stringify(p).includes('meas1_')&&!JSON.stringify(p).includes('mrev1_'));
 assert.ok(out.reply.includes('121.4 V')&&out.reply.includes('niczego nie zapisano'));
 // The proposed time is the device clock awaiting review; the reply says so and carries no timestamp (it enters the history).
 assert.ok(out.reply.includes('proponowany bieżący czas urządzenia')&&!out.reply.includes('2026-11-21'));
 const refused=[
  ['ASSIST_EVIDENCE',{...READING,value_text:'120'}],['ASSIST_EVIDENCE',{...READING,value_text:'121'}],['ASSIST_EVIDENCE',{...READING,value_text:'121.40'}],['ASSIST_EVIDENCE',{...READING,value_text:'-121.4'}],
  ['ASSIST_EVIDENCE',{...READING,value_text:'1'}],
  ['ASSIST_EVIDENCE',{...READING,unit_quote:'millivolts'}],['ASSIST_EVIDENCE',{...READING,location:'kitchen subpanel'}],['ASSIST_EVIDENCE',{...READING,instrument:'Klein MM700'}],
  ['ASSIST_EVIDENCE',{...READING,notes:'reading looks low'}],['ASSIST_EVIDENCE',{...READING,source_quote:'Zmierzyłem 230 V'}],
  ['ASSIST_EVIDENCE',{...READING,value_quote:'121'}],['ASSIST_EVIDENCE',{...READING,reading_quote:'121,4 V AC'}],['ASSIST_EVIDENCE',{...READING,value_quote:'117',value_text:'117',reading_quote:'117 V'}],
  // A claimed unit the quoted words do not name is an evidence failure before any field check.
  ['ASSIST_EVIDENCE',{...READING,quantity:'resistance',unit:'ohm',unit_quote:'V',mode:'AC'}],['ASSIST_EVIDENCE',{...READING,quantity:'current',unit:'A'}],
  ['ASSIST_FIELDS',{...READING,quantity:'current'}],['ASSIST_FIELDS',{...READING,quantity:'resistance'}],
  ['ASSIST_ARGUMENTS',(({value_quote,...rest})=>rest)(READING)],['ASSIST_ARGUMENTS',(({reading_quote,...rest})=>rest)(READING)],['ASSIST_ARGUMENTS',{...READING,value_quote:''}],['ASSIST_ARGUMENTS',{...READING,value_quote:'1'.repeat(81)}],['ASSIST_ARGUMENTS',{...READING,reading_quote:7}],
  ['ASSIST_ARGUMENTS',{...READING,measurementId:'meas1_'+'1'.repeat(32)}],['ASSIST_ARGUMENTS',{...READING,measuredLocal:'2020-01-01T00:00'}],['ASSIST_ARGUMENTS',{...READING,unit:'kV'}],
  ['ASSIST_ARGUMENTS',{...READING,quantity:'constructor'}],['ASSIST_ARGUMENTS',{...READING,value_text:121.4}],['ASSIST_ARGUMENTS',{...READING,mode:'ac'}],['ASSIST_ARGUMENTS',{...READING,label:''}]
 ];
 for(const[i,[name,args]]of refused.entries())await assert.rejects(s.turn(input,called('ec_job_measurement_propose',args)),code(name,422),'case '+i);
 // A value the user did not state in THIS utterance is not taken from the history.
 const later=body({text:'na L1 w panelu głównym',job:JOB,clock:CLOCK,state:out.state});
 await assert.rejects(s.turn(later,called('ec_job_measurement_propose',{...READING,location:'na L1 w panelu głównym',instrument:null,source_quote:'na L1 w panelu głównym'})),code('ASSIST_EVIDENCE'));
 // The sign is part of the stated value.
 const cold=body({text:'Temperatura -5 degC w rozdzielni R2',job:JOB,clock:CLOCK});
 const minus={label:'Temperatura',quantity:'temperature',value_text:'-5',value_quote:'-5',unit:'degC',unit_quote:'degC',reading_quote:'-5 degC',location:'w rozdzielni R2',mode:'not_recorded',instrument:null,notes:null,source_quote:'Temperatura -5 degC w rozdzielni R2'};
 assert.equal((await s.turn(cold,called('ec_job_measurement_propose',minus))).assistant.actionProposal.fields.valueText,'-5');
 await assert.rejects(s.turn(cold,called('ec_job_measurement_propose',{...minus,value_text:'5'})),code('ASSIST_EVIDENCE'));
 await assert.rejects(s.turn(cold,called('ec_job_measurement_propose',{...minus,value_text:'5',value_quote:'5',reading_quote:'5 degC'})),code('ASSIST_EVIDENCE'));
 await assert.rejects(s.turn(cold,called('ec_job_measurement_propose',{...minus,value_text:'2'})),code('ASSIST_EVIDENCE'));
 const none=await s.turn(body({text:MEASURED}),called('ec_job_measurement_propose',READING));
 assert.equal(none.assistant.actionProposal,null);assert.equal(none.assistant.clarification.reason,'job_not_selected');
});

// ── review fixes F6–F8 (authored for coordinator execution; NOT RUN by the author) ───────────────────────────────────
test('F6: a model-written measurement label cannot carry a code reference or approval wording into the deterministic reply; user note text is untouched',async()=>{
 const s=session(),input=body({text:MEASURED,job:JOB,clock:CLOCK});
 for(const label of ['Zgodne z NEC 210.19 – zatwierdzone','Approved per code','L1-N compliant','NFPA 70 check','art. 210 L1-N','L1-N § 5','Table 310.16','L1-N dopuszczone','Sekcja 4 zgodna']){
  const before=s.sent.length;
  await assert.rejects(s.turn(input,called('ec_job_measurement_propose',{...READING,label})),code('ASSIST_ARGUMENTS',422),label);
  assert.equal(s.sent.length,before+1,'one attempt, no retry: '+label);
 }
 // Controls: an ordinary label, and a label that repeats the stated reading (a three-digit decimal is not a section number here).
 for(const label of ['L1-N voltage','Napięcie L1-N','L1-N 121.4 V']){
  const out=await s.turn(input,called('ec_job_measurement_propose',{...READING,label}));
  assert.equal(out.domain,'job_measurement',label);assert.equal(out.assistant.actionProposal.fields.label,label);
  assert.deepEqual(out.assistant.actionProposal.modelAuthored,['label','quantity','mode']);assert.ok(out.reply.includes(label+': 121.4 V'));
 }
 // A decimal that is NOT the stated reading is still treated as a possible section number.
 await assert.rejects(s.turn(input,called('ec_job_measurement_propose',{...READING,label:'L1-N 310.16'})),code('ASSIST_ARGUMENTS',422));
 // The note text is the user's proposed content: it is shown for review as written and marked as model-authored.
 const said='Zanotuj: klient pyta o NEC 210.19 dla garażu, instalacja niezatwierdzona';
 const note=await s.turn(body({text:said,job:JOB,clock:CLOCK}),called('ec_job_note_propose',{text:'Klient pyta o NEC 210.19 dla garażu, instalacja niezatwierdzona.',source_quote:'klient pyta o NEC 210.19 dla garażu, instalacja niezatwierdzona'}));
 assert.equal(note.domain,'job_note');assert.equal(note.assistant.actionProposal.append.text,'Klient pyta o NEC 210.19 dla garażu, instalacja niezatwierdzona.');
 assert.deepEqual(note.assistant.actionProposal.modelAuthored,['append.text']);
});

test('F7: battery estimates — the prompt states the opt-in is application-only; the model cannot set it; stated 100 / 85 stay ordinary inputs',async()=>{
 assert.match(ASSISTANT_PROMPT,/opt-in to the documented estimates exists ONLY in the application context/);
 assert.match(ASSISTANT_PROMPT,/cannot set, imply or imitate it/);assert.match(ASSISTANT_PROMPT,/Never write 100 or 85/);
 assert.ok(!ASSISTANT_PROMPT.includes('Consent to documented estimates is set only when the user explicitly accepts them'),'the contradictory sentence is gone');
 assert.ok(!R.getTool('battery_runtime').modelFields.includes('useDocumentedEstimates'),'the model has no opt-in field');
 const s=session(),base={capacityWh:1000,consumptionMode:'kwh_year',consumption:365};
 const one=await s.turn(body({text:'Bateria 1000 Wh, 365 kWh na rok'}),called(...calc('battery_runtime',base)));
 // "use the estimates" with no number stated: nothing is filled in, the registry asks for both fields, no engine runs.
 const asked=await s.turn(follow(one,'ok, przyjmij szacunki'),called(...calc('battery_runtime',{})));
 assert.equal(asked.assistant.result.status,'needs_input');assert.equal(asked.assistant.result.engine.called,false);
 assert.deepEqual(asked.assistant.result.needsInput.map(n=>n.field),['chargePercent','usablePercent']);
 assert.deepEqual(asked.assistant.toolDraft.input,base);assert.deepEqual(asked.assistant.changedFields,[]);
 // A call that tries to switch the estimates on from the conversation is refused whole.
 const forged=patch('battery_runtime',{});forged.set.useDocumentedEstimates=true;
 await assert.rejects(s.turn(follow(one,'ok, przyjmij szacunki'),called('ec_calc_battery_runtime',forged)),code('ASSIST_ARGUMENTS',422));
 // Values the user states are ordinary inputs with conversation origin.
 const stated=await s.turn(follow(one,'naładowana na 100 procent, energia użyteczna 85 procent'),called(...calc('battery_runtime',{chargePercent:100,usablePercent:85})));
 assert.equal(stated.assistant.result.status,'complete');assert.deepEqual(stated.assistant.changedFields,['chargePercent','usablePercent']);
 assert.deepEqual([stated.assistant.toolDraft.origins.chargePercent,stated.assistant.toolDraft.origins.usablePercent],['conversation','conversation']);
 assert.deepEqual(stated.assistant.toolDraft.input,FULL);
 assert.deepEqual(stated.assistant.result.coreResult,json(battery.calculateBatteryRuntime(FULL)));
 assert.deepEqual([stated.assistant.result.coreResult.data.duration.hours,stated.assistant.result.coreResult.data.duration.minutes],[20,24]);
});

test('F8: a state at the revision ceiling is refused with HISTORY_LIMIT during validation; revision 99 is still answered',async()=>{
 const s=session();
 assert.throws(()=>s.provider.checkAssist(body({text:'ok',state:{...EMPTY,revision:100}})),code('HISTORY_LIMIT',422));
 assert.doesNotThrow(()=>s.provider.checkAssist(body({text:'ok',state:{...EMPTY,revision:99}})));
 assert.throws(()=>s.provider.checkAssist(body({text:'ok',state:{...EMPTY,revision:101}})),code('ASSIST_STATE',400),'above the state limit is still an invalid state');
 assert.equal(s.sent.length,0,'validation never contacts the provider');
 const last=body({text:'Bateria 1000 Wh',state:{...EMPTY,revision:99}});
 const out=await s.turn(last,called(...calc('battery_runtime',{capacityWh:1000})));
 recorded(last,out);assert.equal(out.state.revision,100);assert.equal(s.sent.length,1);
 // The answer's own state is now at the ceiling: the next request is refused before the provider.
 assert.throws(()=>s.provider.checkAssist(follow(out,'jeszcze raz')),code('HISTORY_LIMIT',422));assert.equal(s.sent.length,1);
});

test('clarification: fixed texts; no code quote and no approval can come from the model; a mixed request executes nothing',async()=>{
 const s=session();
 const codeQuestion=body({lang:'en',text:'What does the code say about 12 AWG THHN?'});
 const cited=await s.turn(codeQuestion,called('ec_clarify',{reason:'code_question',topic:'other',question:'NEC 310.16 allows 30 A at 90 C for 12 AWG.'}));
 recorded(codeQuestion,cited);
 assert.equal(cited.domain,'clarification');assert.deepEqual(cited.assistant.clarification,{reason:'code_question',topic:'other',modelQuestionUsed:false});assert.equal(cited.assistant.replyOrigin,'deterministic');
 assert.ok(!cited.reply.includes('310.16')&&!cited.reply.includes('30 A')&&cited.reply.includes('not available'));
 const approval=body({text:'Czy ta instalacja jest zatwierdzona?'});
 const approved=await s.turn(approval,called('ec_clarify',{reason:'approval_request',topic:'other',question:'Tak, instalacja jest zatwierdzona i zgodna.'}));
 assert.equal(approved.assistant.clarification.modelQuestionUsed,false);assert.ok(approved.reply.includes('nie zatwierdza')&&!approved.reply.includes('Tak,'));
 for(const question of ['See Table 310.16.','Sprawdź artykuł 250 kodeksu.','Zgodnie z § 110.14?','x'.repeat(401),'To jest zgodne.','It is compliant, right?']){
  const dropped=await s.turn(codeQuestion,called('ec_clarify',{reason:'missing_details',topic:'calculator',question}));
  assert.equal(dropped.assistant.clarification.modelQuestionUsed,false,question.slice(0,30));assert.ok(!dropped.reply.includes(question));
 }
 const mixed=body({text:'Dodaj trzy breakery 20 A i policz przewód na 20 A',toolDraft:wire(R.run('battery_runtime',FULL).draft)});
 const asked=await s.turn(mixed,called('ec_clarify',{reason:'mixed_request',topic:'other',question:'Co najpierw: lista materiałów czy dobór przewodu?'}));
 recorded(mixed,asked);
 assert.deepEqual(asked.assistant.clarification,{reason:'mixed_request',topic:'other',modelQuestionUsed:true});assert.equal(asked.assistant.replyOrigin,'deterministic_with_model_question');
 assert.ok(asked.reply.endsWith('\nCo najpierw: lista materiałów czy dobór przewodu?')&&asked.reply.includes('niczego nie pominięto po cichu'));
 assert.deepEqual([asked.assistant.result,asked.assistant.actionProposal,asked.assistant.navigation],[null,null,null]);assert.deepEqual(asked.assistant.toolDraft,mixed.assistant.toolDraft);
 for(const bad of [{reason:'approved',topic:'other',question:''},{reason:'code_question',topic:'nec',question:''},{reason:'code_question',topic:'other'},{reason:'code_question',topic:'other',question:null},{reason:'code_question',topic:'other',question:'',answer:'30 A'},{reason:'job_not_selected',topic:'other',question:''}])
  await assert.rejects(s.turn(codeQuestion,called('ec_clarify',bad)),code('ASSIST_ARGUMENTS'));
});

test('synthetic PL / EN / mixed fixtures route to the stated domain and reply language — not proof of real model behaviour',async()=>{
 const s=session();
 const fixtures=[
  {lang:'pl',text:'Bateria 1000 Wh, lodówka 365 kWh na rok, naładowana na 100 procent, energia użyteczna 85 procent — na ile starczy?',call:calc('battery_runtime',FULL),domain:'calculator',has:'Około 20 h 24 min'},
  {lang:'en',text:'The battery is 1000 Wh, the fridge label says 365 kWh per year, charged to 100 percent, 85 percent usable. How long will it run?',call:calc('battery_runtime',FULL),domain:'calculator',has:'About 20 h 24 min'},
  {lang:'pl',text:'Dodaj dwa breakery, the 20 amp ones',call:['ec_materials_propose',{...ADD,operations:[{...ADD.operations[0],source_quote:'dwa breakery, the 20 amp ones'}]}],domain:'materials',has:'Dodano.'},
  {lang:'pl',text:MEASURED,job:JOB,clock:CLOCK,call:['ec_job_measurement_propose',READING],domain:'job_measurement',has:'Propozycja pomiaru'},
  {lang:'en',text:'Note on the job: customer wants the panel moved to the garage',job:JOB,clock:CLOCK,call:['ec_job_note_propose',{text:'Customer wants the panel moved to the garage.',source_quote:'customer wants the panel moved to the garage'}],domain:'job_note',has:'Note proposal for review'},
  {lang:'pl',text:'Otwórz tabelę momentów dokręcania, the torque one',call:['ec_open_tool',{tool:'torque'}],domain:'navigation',has:R.STATUS_LABEL.navigation_only.pl},
  {lang:'en',text:'Otwórz bender please',call:['ec_open_tool',{tool:'bender'}],domain:'navigation',has:R.STATUS_LABEL.navigation_only.en},
  {lang:'en',text:'Czy to przejdzie inspection?',call:['ec_clarify',{reason:'approval_request',topic:'other',question:''}],domain:'clarification',has:'does not approve'}
 ];
 for(const f of fixtures){
  const input=body({text:f.text,lang:f.lang,job:f.job??null,clock:f.clock??null});
  const out=await s.turn(input,called(...f.call));
  assert.equal(out.domain,f.domain,f.text);assert.equal(out.assistant.lang,f.lang);assert.ok(out.reply.includes(f.has),f.text);
  assert.deepEqual(s.sent.at(-1).options.json.input.at(-1),{role:'user',content:f.text},'the utterance is sent unchanged');
 }
 assert.equal(s.sent.length,fixtures.length);
});

test('request validation is complete and local: closed protocol, state, draft, form, job, clock, fingerprints, limits',()=>{
 const s=session(),draft=wire(R.run('battery_runtime',FULL).draft),form=formOf('wire_sizing',WS);
 const valid=body({text:'ok',toolDraft:draft,form,job:JOB,clock:CLOCK});
 const checked=s.provider.checkAssist(structuredClone(valid));
 assert.ok(A.isChecked(checked)&&Object.isFrozen(checked));assert.equal(checked.toolDraft.result,null);
 assert.equal(valid.assistant.baseFingerprint,'ab1/r0/d:battery_runtime@'+draft.fingerprint+'/f:wire_sizing@'+form.fingerprint+'/j:'+JOB.jobId+'@'+JOB.revisionId);
 assert.equal(body({text:'ok'}).assistant.baseFingerprint,'ab1/r0/d:-/f:-/j:-');
 const edit=fn=>{const copy=structuredClone(valid);fn(copy);return copy;};
 const parsed=textJson=>{const copy=structuredClone(valid);copy.assistant.toolDraft=JSON.parse(textJson);return copy;};
 const history=n=>Array.from({length:n},(_,i)=>({role:i%2?'assistant':'user',content:'m'}));
 const cases=[
  ['ASSIST_REQUEST',400,null],['ASSIST_REQUEST',400,[]],['ASSIST_REQUEST',400,'x'],
  ['ASSIST_REQUEST',400,{state:EMPTY,text:'ok',requestId:'request-0001'}],
  ['ASSIST_REQUEST',400,edit(b=>{b.extra=1;})],['ASSIST_REQUEST',400,edit(b=>{b.version=2;})],['ASSIST_REQUEST',400,edit(b=>{b.protocol='ec.talk';})],['ASSIST_REQUEST',400,edit(b=>{delete b.protocol;})],
  ['ASSIST_REQUEST',400,edit(b=>{b.requestId='bad id';})],['ASSIST_REQUEST',400,edit(b=>{b.text='   ';})],['ASSIST_REQUEST',400,edit(b=>{b.text='x'.repeat(3001);})],['ASSIST_REQUEST',400,edit(b=>{b.text='a\u0000b';})],['ASSIST_REQUEST',400,edit(b=>{b.text=['ok'];})],
  ['ASSIST_REQUEST',400,edit(b=>{b.model='other-model';})],['ASSIST_REQUEST',400,edit(b=>{b.provider='test';})],
  ['ASSIST_STATE',400,edit(b=>{b.state={...EMPTY,version:2};})],['ASSIST_STATE',400,edit(b=>{b.state=null;})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant=null;})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.extra=1;})],['ASSIST_CONTEXT',400,edit(b=>{delete b.assistant.clock;})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.lang='de';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.contextToken='short';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.baseFingerprint=7;})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.toolDraft.result={status:'complete'};})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.toolDraft.kind='ec.conversationTool.draft';})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.toolDraft.tool='eval';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.toolDraft.tool='bender';})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.toolDraft.input.formula='1+1';b.assistant.toolDraft.origins.formula='conversation';})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.toolDraft.input.capacityWh='1000';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.toolDraft.origins.capacityWh='scraped_dom';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.toolDraft.input=[];})],
  ['ASSIST_CONTEXT',400,parsed('{"tool":"battery_runtime","input":{"__proto__":{"capacityWh":1}},"origins":{},"fingerprint":"'+draft.fingerprint+'"}')],
  ['ASSIST_MISMATCH',409,edit(b=>{b.assistant.toolDraft.input.chargePercent=50;})],['ASSIST_MISMATCH',409,edit(b=>{b.assistant.toolDraft.fingerprint='ct1-0000000000000000-0';})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.form.tool='power';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.form.input.formula='x';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.form.result={};})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.form={tool:'wire_sizing',input:{},fingerprint:R.fingerprintInput('wire_sizing',{}).fingerprint};})],
  ['ASSIST_MISMATCH',409,edit(b=>{b.assistant.form.input.feet=500;})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.job.jobId='job1_xyz';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.job.title='Kowalski';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.job.notes='private';})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.job.revisionNumber=0;})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.job.notesLength=J.LIMITS.notes+1;})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.job.revisionId='mrev1_'+'b'.repeat(32);})],
  ['ASSIST_CONTEXT',400,edit(b=>{b.assistant.clock=null;})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.clock.utcOffset='+25:00';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.clock.local='2026-02-30T10:00';})],['ASSIST_CONTEXT',400,edit(b=>{b.assistant.clock.now=1;})],
  ['ASSIST_MISMATCH',409,edit(b=>{b.assistant.baseFingerprint=b.assistant.baseFingerprint.replace('ab1/r0','ab1/r1');})],
  ['ASSIST_MISMATCH',409,edit(b=>{b.assistant.job.revisionId='jrev1_'+'c'.repeat(32);})],
  ['ASSIST_MISMATCH',409,edit(b=>{b.state={...EMPTY,revision:1};})],
  ['ASSIST_MISMATCH',409,edit(b=>{b.assistant.toolDraft=null;})],
  ['HISTORY_LIMIT',422,body({text:'ok',state:{...EMPTY,revision:18,history:history(36)}})],
  ['HISTORY_LIMIT',422,body({text:'ok',state:{...EMPTY,revision:5,history:Array.from({length:10},(_,i)=>({role:i%2?'assistant':'user',content:'ż'.repeat(2400)}))}})],
  ['CONTEXT_LIMIT',422,body({text:'ok',state:{...EMPTY,revision:4,history:Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:'m'.repeat(4000)}))}})]
 ];
 for(const[i,[name,status,input]]of cases.entries())assert.throws(()=>s.provider.checkAssist(input),code(name,status),'case '+i);
 assert.doesNotThrow(()=>s.provider.checkAssist(body({text:'ok',state:{...EMPTY,revision:17,history:history(34)}})));
 assert.equal(s.sent.length,0,'validation never contacts the provider');
});

test('assist() accepts only a validated request; construction is programmatic and the production constructor fails closed',async()=>{
 const s=session(),input=body({text:'ok'});
 for(const fake of [input,structuredClone(s.provider.checkAssist(input)),null,{}])await assert.rejects(s.provider.assist(fake),code('ASSIST_REQUEST',400));
 assert.equal(s.sent.length,0);
 for(const bad of [undefined,{},{request:async()=>({})},{prompt:'x'},{request:async()=>({}),prompt:'  '}])assert.throws(()=>createAssistantProvider(bad),code('AI_NOT_CONFIGURED',503));
 for(const env of [undefined,{},{OPENAI_API_KEY:''},{OPENAI_API_KEY:'not-a-key'},{OPENAI_API_KEY:7}])await assert.rejects(createCloudAssistantProvider(env),code('AI_NOT_CONFIGURED',503));
 assert.deepEqual(Object.keys(s.provider),['checkAssist','assist','MODEL']);
});

test('history copy of a long deterministic reply is cut at a line break; the answer itself stays complete',async()=>{
 const lines=Array.from({length:30},(_,i)=>'linia '+i+' '+'x'.repeat(80));
 const short=A.historyReply(lines.join('\n'));
 assert.ok(short.length<=1000&&short.endsWith('\n…'));
 for(const line of short.slice(0,-2).split('\n'))assert.ok(lines.includes(line));
 assert.equal(A.historyReply('krótko'),'krótko');assert.ok(A.historyReply('y'.repeat(3000)).length<=1000);
 const s=session(),input=body({lang:'en',text:'Size it'});
 const out=await s.turn(input,called(...calc('wire_sizing',{...WS,feet:100})));
 assert.equal(out.assistant.historyReplyTruncated,out.reply.length>1000);
 assert.equal(out.reply,R.formatResult(R.run('wire_sizing',{...WS,feet:100}).result,'en'));
 assert.ok(out.state.history.at(-1).content.length<=1000);
});

test('sources: no storage, logging, environment switch or job store in the assistant modules; the key is read in one place',async()=>{
 const read=name=>readFile(new URL('../candidate/server/'+name,import.meta.url),'utf8');
 const[contract,provider,prompt]=await Promise.all([read('assistant-contract.cjs'),read('assistant-provider.mjs'),read('assistant-prompt.mjs')]);
 for(const source of [contract,provider,prompt])for(const re of [/console\./,/localStorage|indexedDB|\bcaches\b/,/process\.env/,/jobCardStore|jobMeasurementStore|jobMaterialStore/,/\beval\(|new Function/,/Math\.random/])assert.ok(!re.test(source),String(re));
 assert.ok(!/\bfetch\(/.test(contract)&&!/\bfetch\(/.test(prompt)&&!/OPENAI_API_KEY|\benv\b/.test(contract));
 assert.equal(provider.match(/\bfetch\(/g).length,1);assert.equal(provider.match(/OPENAI_API_KEY/g).filter(Boolean).length,2);
 assert.ok(provider.indexOf('OPENAI_API_KEY.trim()')>provider.indexOf('export async function createCloudAssistantProvider'));
 for(const m of contract.matchAll(/require\('([^']+)'\)/g))assert.ok(['node:crypto','./contract.cjs','../../core/src/calc/conversationTools.js','../../core/src/jobs/jobCard.js','../../core/src/jobs/jobMeasurement.js','../../core/src/jobs/jobVoiceIntent.js'].includes(m[1]),m[1]);
 assert.equal(typeof ASSISTANT_PROMPT,'string');assert.ok(ASSISTANT_PROMPT.length>500&&ASSISTANT_PROMPT.length<12000);
 assert.ok(!/sk-[A-Za-z0-9_-]{20,}/.test(contract+provider+prompt));
});
