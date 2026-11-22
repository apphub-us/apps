'use strict';
// CONVERTER-WH-1 — the hosted workspace copy (candidate/browser/workspace/mobile.html) of the Converter "Wh / Runtime" tab.
// Local files only; no network. Proves that the deployed page carries the generated core engine byte for byte, that it
// is core/mobile.html plus exactly the documented host differences, and that the shipped tab behaves as specified.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),B=require('../candidate/build.cjs');
const GEN=require('../core/tools/build-calc.js'),SRC=require('../core/src/calc/batteryRuntime.js'),DOM=require('../core/test/helpers/batteryRuntimeDom.js');
const WORKSPACE=path.join(ROOT,'candidate/browser/workspace/mobile.html'),CORE=path.join(ROOT,'core/mobile.html');
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const block=html=>{const s=html.indexOf(GEN.START),e=html.indexOf(GEN.END);assert.ok(s>=0&&e>s,'engine markers');return html.slice(s,e+GEN.END.length);};
const FONT_LINKS=['<link rel="preconnect" href="https://fonts.googleapis.com">','<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>','<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@400;600&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">'];

// EC-AUDIT-FIX-1: the generator's registration contract, written out by hand — 44 [id, file] pairs in the exact order of
// core/tools/build-calc.js. Never derived from GEN.MODULES: the list below is the expectation, the builder is the subject.
// It is the previous 42-entry order, unchanged (batteryRuntime was its last entry), plus two STAGE5 additions:
//   jobConversationActions  directly after jobVoiceBatch; it require()s jobCard, jobCardStore, jobMeasurement,
//                           jobMeasurementStore, all registered earlier;
//   conversationTools       last, directly after batteryRuntime; the registry require()s batteryRuntime and eleven
//                           calculator modules (tables ... loadCalcServiceSizing), all registered earlier.
// Any added, removed, renamed or moved module fails the full-list equality; review the position, then update this list.
const EXPECTED_MODULES=[
 ['tables','calc/tables.js'],['ampacity','calc/ampacity.js'],['voltageDrop','calc/voltageDrop.js'],['conduitFill','calc/conduitFill.js'],
 ['boxFill','calc/boxFill.js'],['motor','calc/motor.js'],['grounding','calc/grounding.js'],['wireSizing','calc/wireSizing.js'],
 ['pullBox','calc/pullBox.js'],['pullBoxEntryGeometry','standards/pullBoxEntryGeometry.js'],['pullBoxLayout','layout/pullBoxLayout.js'],
 ['loadCalcState','calc/loadCalcState.js'],['loadCalcInput','calc/loadCalcInput.js'],['loadCalc','calc/loadCalc.js'],
 ['loadCalcInputV2','calc/loadCalcInputV2.js'],['loadCalcOpt82','calc/loadCalcOpt82.js'],['loadCalcFacade','calc/loadCalcFacade.js'],
 ['loadCalcStateV2','calc/loadCalcStateV2.js'],['loadCalcStorageV2','calc/loadCalcStorageV2.js'],
 ['loadCalcServiceSizing','calc/loadCalcServiceSizing.js'],['loadCalcServiceRecord','calc/loadCalcServiceRecord.js'],
 ['jobCard','jobs/jobCard.js'],['jobCardStore','jobs/jobCardStore.js'],['jobMeasurement','jobs/jobMeasurement.js'],
 ['jobMeasurementStore','jobs/jobMeasurementStore.js'],['materialQuantity','jobs/materialQuantity.js'],['jobMaterial','jobs/jobMaterial.js'],
 ['jobMaterialStore','jobs/jobMaterialStore.js'],['jobPhoto','jobs/jobPhoto.js'],['jobPhotoFile','jobs/jobPhotoFile.js'],
 ['jobPhotoStore','jobs/jobPhotoStore.js'],['jobArchive','jobs/jobArchive.js'],['jobArchiveFile','jobs/jobArchiveFile.js'],
 ['jobArchiveSource','jobs/jobArchiveSource.js'],['jobRestore','jobs/jobRestore.js'],['jobRestoreStore','jobs/jobRestoreStore.js'],
 ['jobVoiceMaterials','jobs/jobVoiceMaterials.js'],['jobVoiceIntent','jobs/jobVoiceIntent.js'],['jobVoiceBatch','jobs/jobVoiceBatch.js'],
 ['jobConversationActions','jobs/jobConversationActions.js'],
 ['favoritesStore','storage/favoritesStore.js'],['codeSources','refs/codeSources.js'],['batteryRuntime','calc/batteryRuntime.js'],
 ['conversationTools','calc/conversationTools.js']
].map(([id,file])=>({id,file}));

test('the generator targets: default is core/mobile.html, --workspace is the hosted copy; the 44 modules are registered in the exact dependency order',()=>{
 assert.equal(GEN.CORE_APP,CORE);assert.equal(GEN.WORKSPACE_APP,WORKSPACE);
 assert.equal(EXPECTED_MODULES.length,44);
 const ids=GEN.MODULES.map(m=>m.id);
 assert.deepEqual(ids,EXPECTED_MODULES.map(m=>m.id),'module ids, in registration order');
 assert.deepEqual(GEN.MODULES.map(m=>({...m})),EXPECTED_MODULES,'every entry is exactly {id, file}, in registration order');
 assert.equal(new Set(ids).size,44,'no id is registered twice');
 // The dependency-sensitive positions, stated on their own so a failure names the rule that was broken.
 assert.deepEqual(GEN.MODULES[42],{id:'batteryRuntime',file:'calc/batteryRuntime.js'});
 assert.deepEqual(GEN.MODULES[43],{id:'conversationTools',file:'calc/conversationTools.js'});
 assert.equal(ids.indexOf('batteryRuntime')+1,ids.indexOf('conversationTools'),'batteryRuntime directly before the registry');
 assert.equal(ids.indexOf('conversationTools'),ids.length-1,'the registry is the last module');
 for(const dep of ['tables','batteryRuntime','ampacity','voltageDrop','wireSizing','conduitFill','boxFill','motor','grounding','pullBox','loadCalcFacade','loadCalcServiceSizing'])
  assert.ok(ids.indexOf(dep)>=0&&ids.indexOf(dep)<ids.indexOf('conversationTools'),'conversationTools after its prerequisite '+dep);
 assert.deepEqual(GEN.MODULES[39],{id:'jobConversationActions',file:'jobs/jobConversationActions.js'});
 assert.equal(ids[38],'jobVoiceBatch','the job actions directly follow jobVoiceBatch');
 for(const dep of ['jobCard','jobCardStore','jobMeasurement','jobMeasurementStore'])
  assert.ok(ids.indexOf(dep)>=0&&ids.indexOf(dep)<ids.indexOf('jobConversationActions'),'jobConversationActions after its required module '+dep);
});

test('the engine embedded in the hosted page is the generated core bundle, byte for byte, and equals the one in core/mobile.html',()=>{
 const generated=GEN.buildBlock(),hosted=block(read(WORKSPACE));
 assert.ok(generated.includes('  // ---- src/calc/batteryRuntime.js ----'));
 assert.ok(hosted===generated,'candidate/browser/workspace/mobile.html is stale — run: node core/tools/build-calc.js --workspace');
 assert.ok(block(read(CORE))===generated,'core/mobile.html is stale — run: node core/tools/build-calc.js');
});

test('build-calc --workspace --check verifies the hosted copy and writes nothing',()=>{
 const before=fs.readFileSync(WORKSPACE),tool=path.join(ROOT,'core/tools/build-calc.js');
 const out=String(execFileSync(process.execPath,[tool,'--workspace','--check'],{cwd:path.join(ROOT,'core'),stdio:'pipe'}));
 assert.match(out,/BUILD CHECK OK/);assert.match(out,/candidate[\\/]browser[\\/]workspace[\\/]mobile\.html/);
 assert.ok(fs.readFileSync(WORKSPACE).equals(before));
});

// PRIVATE-PILOT-5: the exact hosted tail, written out so this test does not merely trust the builder's own constant. The three
// earlier host scripts keep their order (handoff, material-edit, host-core); the assistant form bridge is the fourth and LAST
// tag, because it needs the generated engine, the page's own functions and the host core before it. The standalone
// core/mobile.html gets no such tag.
const HOSTED_TAIL='</html>\n\n<script src="/workspace/handoff.js"></script>\n<script src="/workspace/material-edit.js"></script>\n<script src="/workspace/host-core.js"></script>\n<script src="/workspace/assistant-bridge.js"></script>';

test('the hosted page is core/mobile.html plus exactly the documented host differences (fonts, host stylesheet, /sw.js, four host scripts)',()=>{
 const lines=read(CORE).trimEnd().split('\n'),W=B.WORKSPACE_HOST_WIRING;
 assert.equal(W.tail,HOSTED_TAIL,'the builder requires exactly this hosted tail');
 assert.ok(read(WORKSPACE).trimEnd().endsWith(HOSTED_TAIL),'the hosted page ends with the four host scripts, the bridge last');
 for(const src of ['/workspace/handoff.js','/workspace/material-edit.js','/workspace/host-core.js','/workspace/assistant-bridge.js'])assert.equal(read(WORKSPACE).split('<script src="'+src+'"></script>').length-1,1,'loaded exactly once: '+src);
 assert.ok(!read(CORE).includes('assistant-bridge.js'),'the standalone core page loads no assistant bridge');
 for(const link of FONT_LINKS){const i=lines.indexOf(link);assert.ok(i>=0,'core font link: '+link);lines[i]='';}
 const head=lines.indexOf('</head>');assert.ok(head>=0);lines[head]=W.stylesheet;
 const sw=lines.findIndex(l=>l.includes("navigator.serviceWorker.register('sw.js')"));assert.ok(sw>=0);lines[sw]=lines[sw].replace("register('sw.js')","register('/sw.js')");
 assert.equal(lines[lines.length-1],'</html>');lines.splice(lines.length-1,1,...W.tail.split('\n'));
 const hosted=read(WORKSPACE).trimEnd().split('\n');let i=0;while(i<lines.length&&i<hosted.length&&lines[i]===hosted[i])i++;
 assert.ok(i===lines.length&&i===hosted.length,'first difference at line '+(i+1)+':\n expected '+JSON.stringify((lines[i]||'').slice(0,160))+'\n hosted   '+JSON.stringify((hosted[i]||'').slice(0,160)));
 for(const link of FONT_LINKS)assert.ok(!hosted.includes(link),'the hosted page loads no external font');
});

test('hosted engine: required values and refusals, identical to the core source',()=>{
 const EC=DOM.bootEngine(read(WORKSPACE));assert.ok(EC.batteryRuntime,'EC.batteryRuntime missing from the hosted page');
 const run=(capacityWh,consumptionMode,consumption,chargePercent,usablePercent)=>EC.batteryRuntime.calculateBatteryRuntime({capacityWh,consumptionMode,consumption,chargePercent,usablePercent});
 const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,a+' vs '+b);
 close(run('1000','w','100','100','100').data.hours,10);close(run('1000','w','100','100','85').data.hours,8.5);
 close(run('1000','kwh_day','1','100','85').data.hours,20.4);close(run('1000','kwh_year','365','100','85').data.hours,20.4);close(run('1000','kwh_year','365','100','85').data.averageW,125/3);
 close(run('1000','kwh_day','1','50','85').data.hours,10.2);assert.equal(run('1000','kwh_day','1','0','85').data.hours,0);
 close(run('1000','kwh_day','1,2','100','85').data.averageW,50);close(run('1000','kwh_day','1.2','100','85').data.hours,17);
 assert.equal(run('1000','kwh_year','365','100','85').data.text.duration,'Około 20 h 24 min');
 let compared=0;
 for(const c of ['','  ','0','-1','1000','1000x','Infinity','NaN','99999999999'])for(const m of ['w','kwh_day','kwh_year','mah'])for(const v of ['','0','-2','1,2','1.2','100','1e3','12W','99999999'])for(const p of ['0','100','101','',' 50 '])for(const u of ['85','0','100','abc']){
  const input={capacityWh:c,consumptionMode:m,consumption:v,chargePercent:p,usablePercent:u},r=EC.batteryRuntime.calculateBatteryRuntime(input);
  assert.deepEqual(r,SRC.calculateBatteryRuntime(input),JSON.stringify(input));
  assert.equal(r.ok,r.data!==null);assert.equal(r.ok,r.errors.length===0);assert.ok(!/NaN|Infinity|undefined/.test(JSON.stringify(r.ok?r.data.text:r.errors)));compared++;
 }
 assert.ok(compared>6000);
});

test('the feature added no network, storage or dependency to the hosted page and left the existing converters in place',()=>{
 const html=read(WORKSPACE),s=html.indexOf('// ── WH / RUNTIME (CONVERTER-WH-1)'),adapter=html.slice(s,html.indexOf('// ── TORQUE',s));
 assert.ok(s>0&&adapter.length>500);
 assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|import\(|https?:\/\//.test(adapter));
 for(const id of ['cvt-power','cvt-battery','cvt-torque','cvt-wire','cvt-temp','cvt-length'])assert.equal(html.split('<div id="'+id+'"').length-1,1,id);
 for(const fn of ['cvCalc','cvReset','tqCalc','tpCalc','lnCalc'])assert.equal(html.split('function '+fn+'(').length-1,1,fn);
 assert.ok(html.includes('<div class="conduit-tab active" onclick="cvTool(\'power\',this)">Power</div>'),'Power is still the default tab');
});

DOM.defineUiSuite('candidate/browser/workspace/mobile.html',WORKSPACE);
