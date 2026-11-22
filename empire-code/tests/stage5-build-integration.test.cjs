'use strict';
// EC-AUDIT-FIX-1 / STAGE5 — build integration of the two stage 5 core modules and the hosted bridge.
// Local files only; no network, no storage. Run: node --test tests/
//
// What is NOT repeated here: the behaviour of the registry (core/test/stage5Tools.test.js), of the job adapter
// (core/test/stage5JobActions.test.js), of the bridge (tests/stage5-form-bridge.test.cjs), the exact 44-entry list
// (core/test/loadCalcServiceUi.test.js) and the staleness of the two shipped pages (tests/converter-wh-runtime.test.cjs).
// What IS covered only here: the generated bundle embeds the registry and the adapter verbatim and exactly once, their
// real require() statements resolve to modules registered before them, and the code that runs inside the bundle is
// the code the Node tests run — same results, over the bundle's own engines and job models.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),SRC=path.join(ROOT,'core/src');
const GEN=require('../core/tools/build-calc.js'),B=require('../candidate/build.cjs');
const CT=require('../core/src/calc/conversationTools.js'),A=require('../core/src/jobs/jobConversationActions.js');
const Job=require('../core/src/jobs/jobCard.js'),Battery=require('../core/src/calc/batteryRuntime.js'),Record=require('../core/src/calc/loadCalcServiceRecord.js');

// The dependency lists as written in the two sources (hand-copied; compared with the files below).
const STAGE5={
 jobConversationActions:{file:'jobs/jobConversationActions.js',after:'jobVoiceBatch',requires:['./jobCard.js','./jobCardStore.js','./jobMeasurement.js','./jobMeasurementStore.js']},
 conversationTools:{file:'calc/conversationTools.js',after:'batteryRuntime',requires:['./tables','./batteryRuntime','./ampacity','./voltageDrop','./wireSizing','./conduitFill','./boxFill','./motor','./grounding','./pullBox','./loadCalcFacade.js','./loadCalcServiceSizing.js']}
};
const ids=()=>GEN.MODULES.map(m=>m.id);
const raw=file=>fs.readFileSync(path.join(SRC,file),'utf8');
// Exactly what tools/build-calc.js embeds: line endings normalised, trailing whitespace dropped, nothing else.
const normalised=file=>raw(file).replace(/\r\n/g,'\n').replace(/\s+$/,'');
const requiresOf=text=>[...text.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)].map(m=>m[2]);
let cached=null;
function bundle(){
 if(cached)return cached;
 const block=GEN.buildBlock(),script=block.slice(block.indexOf('<script>')+8,block.lastIndexOf('</script>'));
 const win={};new Function('window',script)(win);   // eslint-disable-line no-new-func
 cached={block,EC:win.EC};return cached;
}
// The body of one module as it stands in the generated block, with the generator's four-space indent removed.
function embedded(block,index){
 const m=GEN.MODULES[index],next=GEN.MODULES[index+1];
 const head='  // ---- src/'+m.file+' ----\n  __reg['+JSON.stringify(m.id)+'] = function (module, exports, require) {\n';
 const start=block.indexOf(head);
 assert.ok(start>=0,m.id+' is not embedded');assert.equal(block.indexOf(head,start+1),-1,m.id+' is embedded more than once');
 const end=block.indexOf('\n  };\n\n'+(next?'  // ---- src/'+next.file+' ----\n':'  var api = {};\n'),start);
 assert.ok(end>start,m.id+' has no closing line before the next module');
 return block.slice(start+head.length,end).split('\n').map(l=>l.startsWith('    ')?l.slice(4):l).join('\n');
}

test('stage 5 modules are registered once, directly after the stated module, and after every module they require()',()=>{
 const list=ids();
 assert.equal(list.length,44);assert.equal(new Set(list).size,44);
 for(const [id,spec] of Object.entries(STAGE5)){
  const at=list.indexOf(id);
  assert.ok(at>=0,id+' is not registered');assert.equal(list.lastIndexOf(id),at,id);
  assert.deepEqual({...GEN.MODULES[at]},{id,file:spec.file});
  assert.equal(list[at-1],spec.after,id+' follows '+spec.after);
  // the real dependency list of the source, in source order
  assert.deepEqual(requiresOf(raw(spec.file)),spec.requires,id+' gained or lost a require(): review its position in tools/build-calc.js');
  for(const p of spec.requires){
   // local sibling only: the shim strips './' and '.js' and needs no alias for these
   assert.match(p,/^\.\/[A-Za-z0-9]+(\.js)?$/,p);
   const dep=p.replace(/^\.\//,'').replace(/\.js$/,'');
   assert.ok(list.indexOf(dep)>=0,id+' requires an unregistered module: '+dep);
   assert.ok(list.indexOf(dep)<at,id+' is registered before its dependency '+dep);
   assert.ok(fs.existsSync(path.join(SRC,path.dirname(spec.file),dep+'.js')),'the Node path of '+p+' is the registered file');
   assert.equal(GEN.MODULES[list.indexOf(dep)].file,path.dirname(spec.file)+'/'+dep+'.js',dep+' resolves to the same file in Node and in the bundle');
  }
 }
 assert.equal(list[list.length-1],'conversationTools','the registry is last: it requires batteryRuntime');
 // the job adapter writes through the ORIGINAL models and stores; it does not pull in the capture journal or the materials model
 for(const other of ['jobVoiceBatch','jobMaterial','jobMaterialStore','jobConversationHandoff'])assert.ok(!STAGE5.jobConversationActions.requires.some(p=>p.includes(other)),other);
});

test('every module of the generated bundle is its source, verbatim and exactly once; the two stage 5 modules byte for byte',()=>{
 const {block}=bundle();
 GEN.MODULES.forEach((m,i)=>{
  const body=embedded(block,i);
  assert.ok(body===normalised(m.file),'generated body differs from core/src/'+m.file);
 });
 for(const [id,spec] of Object.entries(STAGE5)){
  const text=raw(spec.file),body=embedded(block,ids().indexOf(id));
  // nothing for the generator to normalise except whitespace after the last line: the embedded text is the file itself
  assert.ok(!text.includes('\r'),spec.file+' has CR line endings');
  assert.ok(text.startsWith(body)&&/^\s*$/.test(text.slice(body.length)),spec.file+' is embedded byte for byte (up to its final newline)');
  assert.ok(body.length>1000&&body.startsWith("'use strict';"),spec.file+' body');
  assert.ok(!text.includes('</script'),spec.file+' would end the generated script element');
 }
 // one registration line and one export line per module, in list order
 assert.deepEqual([...block.matchAll(/^  __reg\["([A-Za-z0-9]+)"\] = function \(module, exports, require\) \{$/gm)].map(m=>m[1]),ids());
 assert.deepEqual([...block.matchAll(/^  api\["([A-Za-z0-9]+)"\] = __require\("([A-Za-z0-9]+)"\);$/gm)].map(m=>[m[1],m[2]]),ids().map(id=>[id,id]));
 assert.equal(GEN.buildBlock(),block,'the generator is deterministic');
});

test('inside the bundle the registry is the Node registry: same surface, same results, over the bundle\'s own engines',()=>{
 const {EC}=bundle();
 assert.deepEqual(Object.keys(EC),ids(),'window.EC exposes exactly the registered modules, in order');
 const R=EC.conversationTools;
 assert.deepEqual(Object.keys(R),Object.keys(CT));
 assert.equal(JSON.stringify(R.TOOL_IDS),JSON.stringify(CT.TOOL_IDS));assert.equal(R.CONTRACT_REVISION,CT.CONTRACT_REVISION);
 // the functions the hosted bridge looks up on window.EC.conversationTools
 for(const fn of ['getTool','createDraft','validatePatch','mergeDraft','importFormInput','validateDraft'])assert.equal(typeof R[fn],'function',fn);
 const FULL={capacityWh:1000,consumptionMode:'kwh_year',consumption:365,chargePercent:100,usablePercent:85};
 const WS={noncontinuousLoadA:20,continuousLoadA:0,material:'cu',insulation:'thhn',ambientF:86,adjustmentFactor:1,terminalRatingC:75,circuitType:'BRANCH_CIRCUIT',jurisdiction:'NYC',feet:100,voltage:120,phase:1,maxVoltDropPercent:3};
 for(const [tool,input] of [['battery_runtime',FULL],['battery_runtime',{capacityWh:1000}],['battery_runtime',{capacityWh:'1000'}],['wire_sizing',WS],['wire_sizing',{}],['no_such_tool',{}]]){
  assert.equal(JSON.stringify(R.run(tool,input)),JSON.stringify(CT.run(tool,input)),tool+' '+JSON.stringify(input));
 }
 // the result is the engine's own return value — the engine instance that the same bundle exposes as EC.batteryRuntime
 const out=R.run('battery_runtime',FULL);
 assert.equal(out.ok,true,JSON.stringify(out.errors));assert.equal(out.result.status,'complete');
 assert.deepEqual(out.result.coreResult,EC.batteryRuntime.calculateBatteryRuntime(FULL));
 assert.deepEqual(out.result.coreResult,Battery.calculateBatteryRuntime(FULL));
 const sized=R.run('wire_sizing',WS);
 assert.equal(sized.ok,true,JSON.stringify(sized.errors));assert.equal(sized.result.engine.called,true);
 assert.equal(JSON.stringify(sized.result.coreResult),JSON.stringify(CT.run('wire_sizing',WS).result.coreResult));
});

test('inside the bundle the job adapter is the Node adapter over the bundle\'s own job-card and measurement models',async()=>{
 const {EC}=bundle(),X=EC.jobConversationActions;
 assert.deepEqual(Object.keys(X),Object.keys(A));
 assert.equal(JSON.stringify(X.LIMITS),JSON.stringify(A.LIMITS));assert.equal(X.NOTE_SEPARATOR,A.NOTE_SEPARATOR);
 assert.equal(X.PLAN_KIND,A.PLAN_KIND);assert.equal(X.RECEIPT_KIND,A.RECEIPT_KIND);assert.equal(X.VERSION,A.VERSION);
 assert.equal(X.LIMITS.jobNotes,EC.jobCard.LIMITS.notes,'the note limit is read from the bundled job-card model, not copied');
 const T0='2026-11-20T09:00:00.000Z',T1='2026-11-21T15:00:00.000Z',JOB='job1_'+'1'.repeat(32),REV='jrev1_'+'2'.repeat(32);
 // a saved job built by the given job-card model (the Node one or the bundled one)
 const job=J=>{
  const made=J.createInitialRevision({title:'Panel upgrade',address:'12 Main Street',notes:'First visit.'},[],{jobId:JOB,revisionId:REV,savedAt:T0});
  assert.equal(made.ok,true,JSON.stringify(made));
  return {head:{kind:J.HEAD_KIND,recordVersion:J.RECORD_VERSION,jobId:JOB,currentRevisionId:REV,revisionNumber:1},revision:made.revision};
 };
 const input=(J,action)=>({sourceId:'conv1_'+'3'.repeat(32),sourceRevision:2,sourceSavedAt:T1,sourceText:'Neutral bar torque checked, L1 to neutral 120.00 V AC at panel A.',job:job(J),action});
 assert.equal(JSON.stringify(job(EC.jobCard)),JSON.stringify(job(Job)));
 const FIELDS={label:'L1-N',quantity:'voltage',valueText:'120.00',unit:'V',location:'Panel A',measuredLocal:'2026-11-21T10:00',utcOffset:'-05:00',mode:'AC',instrument:'Meter',notes:'Observation only'};
 for(const action of [{kind:'note',text:'Checked.'},{kind:'measurement',fields:FIELDS}]){
  const node=await A.prepare(input(Job,action),{crypto:webcrypto}),hosted=await X.prepare(input(EC.jobCard,action),{crypto:webcrypto});
  assert.equal(node.ok,true,action.kind+': '+JSON.stringify(node));
  assert.equal(JSON.stringify(hosted),JSON.stringify(node),action.kind+': same plan, identities and review');
  assert.equal(JSON.stringify(X.validate(input(EC.jobCard,action))),JSON.stringify(A.validate(input(Job,action))),action.kind);
  assert.equal(JSON.stringify(X.validatePlan(node.plan)),JSON.stringify(A.validatePlan(node.plan)),action.kind);
  assert.equal(JSON.stringify(X.pendingReceipt(hosted.plan)),JSON.stringify(A.pendingReceipt(node.plan)),action.kind);
  assert.equal(X.validatePlan(node.plan).ok,true,action.kind);
 }
 // refusals agree as well, and neither side writes or needs storage to refuse
 for(const bad of [{},null,input(Job,{kind:'delete'}),Object.assign(input(Job,{kind:'note',text:'x'}),{extra:1})]){
  const node=A.validate(bad),hosted=X.validate(bad);
  assert.equal(node.ok,false);assert.equal(JSON.stringify(hosted),JSON.stringify(node));
 }
 const declined=await X.commit({},{},{accepted:false,planId:'jact1_'+'0'.repeat(32)},{});
 assert.equal(declined.ok,false);assert.equal(declined.code,'DECLINED');
});

test('the bundled record module stamps new records with the current producer and still reads the previous one',()=>{
 const {EC}=bundle(),R=EC.loadCalcServiceRecord;
 assert.deepEqual({...R.PRODUCER},{...Record.PRODUCER});
 assert.equal(R.PRODUCER.applicationRevision,'EC-AUDIT-FIX-1');
 assert.equal(R.PRODUCER.calculationSourcePin,'ca231858042fcca62f871495bf281f3262e61ad5d86be755a6ea0795c7171699');
 assert.deepEqual([...R.CALCULATION_SOURCE_FILES],[...Record.CALCULATION_SOURCE_FILES]);
 // every one of the nine pinned calculation sources is a module of this bundle, embedded verbatim (previous test)
 for(const f of Record.CALCULATION_SOURCE_FILES)assert.ok(GEN.MODULES.some(m=>'src/'+m.file===f),f);
 // a record of the previous producer, read by the BUNDLED module with both engines disabled: structural read only
 const cases=JSON.parse(fs.readFileSync(path.join(ROOT,'core/test/fixtures/loadCalc/LC82-cases-r1.json'),'utf8')).cases;
 const request0=JSON.parse(JSON.stringify(cases.find(c=>c.id==='LC82-B0P').request));
 const draft=EC.loadCalcStateV2.createEmptyDraftV2();draft.snapshot=request0.snapshot;draft.context=request0.context;
 const projection=EC.loadCalcStateV2.toRequestV2(draft);assert.equal(projection.ok,true,JSON.stringify(projection.problems));
 const design={selectedMainRatingA:200,plan:{intent:'new_design_candidate',oneMainDisconnect:true,noAdditionalSources:true,wholeDwelling:true,singleConductorSet:true},
  conductor:{sizingPath:'general_table_75C',material:'Cu',terminationTempRatingC:75,terminationMaterialCompatible:true,insulationTempRatingC:75,ambientTempC:30,currentCarryingConductors:3,wiringMethod:'single_insulated_conductors_in_raceway',noOtherAdjustmentOrCorrection:true}};
 const capture={draft,request:projection.request,response:EC.loadCalcFacade.evaluateV2(projection.request),design,analysis:EC.loadCalcServiceSizing.analyzePrototype(projection.request,design)};
 const made=R.createRecord(capture,{id:'sr1_0123456789abcdef0123456789abcdef',name:'B0 service result',createdAt:'2026-10-06T00:12:53.000Z'});
 assert.equal(made.ok,true,JSON.stringify(made.problems));
 assert.deepEqual(made.record.producer,{...Record.PRODUCER});
 const old=JSON.parse(JSON.stringify(made.record));
 old.producer={applicationRevision:'LC-SERVICE-RESULT-STORE-1',sourceBaselinePin:'d168fa3b6be018ec2560a3cfbd3a5347b17d6d802926a1b5b4f85b2fbe3b6ab7',calculationSourcePin:'40a7de48e3c0ede97210bacb6e40b3e7e3fb0a5fdf9fd26f7d1cfe21f0709ebe',recordContractRevision:1};
 const text=JSON.stringify(old),facade=EC.loadCalcFacade.evaluateV2,sizing=EC.loadCalcServiceSizing.analyzePrototype;let calls=0;
 try{
  EC.loadCalcFacade.evaluateV2=()=>{calls++;throw new Error('must not calculate on read');};
  EC.loadCalcServiceSizing.analyzePrototype=()=>{calls++;throw new Error('must not reassess on read');};
  const read=R.parseStoredRecord(text);
  assert.equal(read.ok,true,JSON.stringify(read.problems));
  assert.equal(JSON.stringify(read.record),text,'the previous producer and every saved value come back unchanged');
  assert.equal(calls,0);
 }finally{EC.loadCalcFacade.evaluateV2=facade;EC.loadCalcServiceSizing.analyzePrototype=sizing;}
 assert.equal(JSON.stringify(old),text);
});

test('the hosted page loads the bridge after the generated bundle and the host core; the standalone core page never loads it',()=>{
 const hosted=fs.readFileSync(path.join(ROOT,'candidate/browser/workspace/mobile.html'),'utf8').replace(/\r\n/g,'\n');
 const core=fs.readFileSync(path.join(ROOT,'core/mobile.html'),'utf8');
 const tag=src=>'<script src="'+src+'"></script>',BRIDGE=tag('/workspace/assistant-bridge.js');
 assert.deepEqual([...B.WORKSPACE_HOST_WIRING.scripts],['/workspace/handoff.js','/workspace/material-edit.js','/workspace/host-core.js','/workspace/assistant-bridge.js']);
 const end=hosted.indexOf(GEN.END),bridge=hosted.indexOf(BRIDGE);
 assert.ok(end>0,'the hosted page carries the generated block');
 assert.ok(bridge>end,'the bridge script is missing from the hosted page or precedes window.EC');
 assert.equal(hosted.indexOf(BRIDGE,bridge+1),-1,'the bridge is loaded once');
 assert.ok(hosted.indexOf(tag('/workspace/host-core.js'))>end&&hosted.indexOf(tag('/workspace/host-core.js'))<bridge,'host-core.js runs before the bridge');
 assert.ok(hosted.trimEnd().endsWith(BRIDGE),'the bridge is the last script of the hosted page');
 // the registry the bridge reads is in the block of the hosted page (regenerate with: node core/tools/build-calc.js --workspace)
 const block=hosted.slice(hosted.indexOf(GEN.START),end);
 for(const spec of Object.values(STAGE5))assert.ok(block.includes('  // ---- src/'+spec.file+' ----\n'),'hosted block is stale: missing src/'+spec.file);
 // host-only wiring stays out of the standalone core page and out of the main page list
 assert.ok(!/<script\b[^>]*\ssrc="[^"]*assistant-(?:bridge|session)\.js"/.test(core),'core/mobile.html must not load an assistant script');
 assert.ok(!core.includes('src="/workspace/'),'core/mobile.html must not load a host script');
 assert.ok(!B.INDEX_REFS.includes('/workspace/assistant-bridge.js'));
 assert.ok(B.ADDED.includes('workspace/assistant-bridge.js')&&B.ADDED.includes('assistant-session.js'));
});
