'use strict';
/** Independent reviewer regressions for EC-CALC-2 B1 (review/review-regressions.test.cjs of the B1 review handoff), integrated unchanged in B1-r1 except for the ROOT line below. No fixture or production writes.
 * Delivered B1: 36 tests / 15 pass / 21 fail. B1-r1: 36 / 36.
 * B1_REVIEW_ROOT=/absolute/tree node --test /path/review-regressions.test.cjs
 * These deliberately fail on the received B1, testing the approved contract,
 * not new NEC interpretations. The original locked cases are only input seeds.
 */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..'); // integrated into the B1-r1 tree: the module under test is this tree (reviewer original: B1_REVIEW_ROOT || ./candidate)
const E=require(path.join(ROOT,'src/calc/loadCalc.js'));
const I=require(path.join(ROOT,'src/calc/loadCalcInput.js'));
const S=require(path.join(ROOT,'src/calc/loadCalcState.js'));
const cases=JSON.parse(fs.readFileSync(path.join(ROOT,'test/fixtures/loadCalc/EC-CALC-2-A3-test-cases-r22.json'),'utf8')).cases;
const cp=x=>JSON.parse(JSON.stringify(x));
function env(id){const e=cases.find(c=>c.id===id)?.envelope;assert.ok(e,'Missing seed '+id);return cp(e);}
function unknown(r,field){
 assert.equal(r.status,'INCOMPLETE_INPUT');
 assert.equal(r.demand.status,'not_computed');
 assert.equal(r.existingCapacity.status,'not_assessed');
 assert.ok(r.problems.some(p=>p.field===field&&['MISSING_FIELD','QUALIFICATION_UNKNOWN'].includes(p.code)),field);
}
function annual(){const e=env('T-N-01');e.snapshot.measurement.existing.serviceRatingA=225;return e;}
function thirty(){const e=env('T-N-02b');e.snapshot.measurement.recordedWhileOccupied.value=true;return e;}
test('CONTROL: qualified annual input still computes 50000 VA / 225 A comparison',()=>{
 const r=E.evaluate(annual());assert.equal(r.status,'COMPLETE');assert.equal(r.demand.totalVA,50000);assert.equal(r.existingCapacity.status,'adequate');
});
for(const nullOrAbsent of ['null','absent'])test('B1-01 annual periodMonths '+nullOrAbsent,()=>{
 const e=annual();if(nullOrAbsent==='null')e.snapshot.measurement.periodMonths=null;else delete e.snapshot.measurement.periodMonths;
 unknown(E.evaluate(e),'measurement.periodMonths');
});
test('CONTROL: explicit insufficient annual period remains unqualified',()=>{
 const e=annual();e.snapshot.measurement.periodMonths=11;assert.equal(E.evaluate(e).status,'UNQUALIFIED_METHOD');
});
test('CONTROL: fully qualified 30-day seed still computes',()=>{assert.equal(E.evaluate(thirty()).status,'COMPLETE');});
for(const field of ['periodDays','intervalMinutes','connectedTo'])for(const state of ['null','absent'])test('B1-01 exception '+field+' '+state,()=>{
 const e=thirty();if(state==='null')e.snapshot.measurement[field]=null;else delete e.snapshot.measurement[field];
 unknown(E.evaluate(e),'measurement.'+field);
});
function per(){const e=env('T-N-16'),m=e.snapshot.measurement;m.readingsPerConductor.L1=140;m.reading.value=null;m.newLoad.precalculated.leg='L2';return e;}
test('CONTROL: complete split per-conductor data gives 175 A, not adequate for 150 A',()=>{
 const r=E.evaluate(per());assert.equal(r.demand.totalOnConductorA,175);assert.equal(r.existingCapacity.status,'inadequate');assert.equal(r.existingCapacity.comparisons.length,2);
});
for(const which of ['L1','L2'])for(const missing of ['null','absent'])test('B1-02 per_conductor '+which+' '+missing+' cannot yield an exact verdict for the whole set',()=>{
 const e=per();if(missing==='null')e.snapshot.measurement.readingsPerConductor[which]=null;else delete e.snapshot.measurement.readingsPerConductor[which];
 const r=E.evaluate(e);assert.equal(r.existingCapacity.status,'not_assessed');
 assert.notEqual(r.status,'COMPLETE');assert.ok(r.problems.some(p=>p.field.includes('readingsPerConductor')));
});
test('B1-02 per_conductor with no new term still needs the required set of readings',()=>{
 const e=per();e.snapshot.measurement.newLoad={mode:'none',precalculated:null};e.snapshot.measurement.readingsPerConductor.L1=null;
 assert.equal(E.evaluate(e).existingCapacity.status,'not_assessed');
});
test('CONTROL: declared highest-loaded single reading remains a distinct supported mode',()=>{
 const e=env('T-N-17');const r=E.evaluate(e);assert.equal(r.status,'COMPLETE');assert.equal(r.demand.totalOnConductorA,155);
});
test('B1-02 three-phase per_conductor subset is not a complete assessment',()=>{
 const e=env('T-N-30');e.snapshot.measurement.readingScope='per_conductor';e.snapshot.measurement.readingsPerConductor={L1:100,L2:null,L3:null};
 assert.equal(E.evaluate(e).existingCapacity.status,'not_assessed');
});
for(const raw of ['9007199254740993','1e100'])test('B1-03 safe integer parser rejects '+raw+' without a rounded count',()=>{
 const r=I.parseNumberField(raw,{field:'loads[0].quantity',integer:true,min:1});assert.ok(r.error);assert.equal(r.value,null);
});
for(const raw of ['2',String(Number.MAX_SAFE_INTEGER)])test('CONTROL: representable integer '+raw,()=>{
 const r=I.parseNumberField(raw,{field:'quantity',integer:true,min:1});assert.equal(r.error,null);assert.equal(r.value,Number(raw));
});
test('B1-03 direct object input cannot bypass the safe-count boundary',()=>{
 const e=annual();e.snapshot.measurement.periodMonths=Number.MAX_SAFE_INTEGER+1;
 let threw=false,r;try{r=E.evaluate(e);}catch(ex){assert.equal(ex.code,'SCHEMA_INVALID');threw=true;}
 assert.ok(threw||r.status==='INVALID_INPUT');
});
for(const [label,value] of [['undefined',undefined],['NaN',NaN],['Infinity',Infinity],['function',()=>0]])test('B1-03 strict JSON object ingress rejects nested '+label+' even in an opaque collection',()=>{
 const e=annual();e.snapshot.multifamily.unitGroups=[value];
 assert.throws(()=>E.evaluate(e),ex=>ex?.code==='SCHEMA_INVALID');
});
const recBase={method:'optional',voltage:'240',scope:'house',sqFt:'1500',appliances:'[]',hvac:'[]',ev:'[]'};
for(const [name,list,category,field] of [['Laundry Circuit','appliances','laundry','laundryCircuits'],['A/C Window Outlet — NYCEC 220.14(N)','hvac','ac','nycAcCircuitCount']]){
 test('CONTROL: valid-only migration '+field,()=>{
  const rec=cp(recBase);rec[list]=JSON.stringify([{id:'a',name,category,va:1500}]);const m=S.migrateLegacyRecord(rec);assert.equal(m.snapshot.dwelling[field],1);assert.deepEqual(m.problems,[]);
 });
 for(const reverse of [false,true])test('B1-04 mixed valid and edited migration keeps '+field+' unresolved (reverse='+reverse+')',()=>{
  const rec=cp(recBase);const items=[{id:'a',name,category,va:1500},{id:'b',name,category,va:2000}];rec[list]=JSON.stringify(reverse?items.reverse():items);const raw=JSON.stringify(rec);
  const m=S.migrateLegacyRecord(rec);assert.equal(JSON.stringify(rec),raw);assert.equal(m.snapshot.migration.sourceRecord[list],rec[list]);
  assert.equal(m.snapshot.dwelling[field],null);assert.ok(m.snapshot.migration.unresolvedItems.some(u=>u.itemId==='b'));
  const r=E.evaluate({profileId:'A_measured_87_core',snapshot:m.snapshot,parseErrors:[]});
  assert.ok(r.problems.some(p=>p.code==='LEGACY_AMBIGUOUS'&&p.field==='dwelling.'+field));
 });
}
for(const [name,rawList] of [
 ['unparseable list','not-json'],
 ['unrepresentable item rating','[{"id":"bad","name":"Water Heater","category":"appliance","va":null}]']
])test('B1-04 migration of '+name+' must reject or preserve a valid explicitly unresolved snapshot',()=>{
 const rec=cp(recBase);rec.appliances=rawList;const before=JSON.stringify(rec);let m;
 try{m=S.migrateLegacyRecord(rec);}catch(ex){
  // Allow a documented controlled ingress rejection, not accidental undefined-property errors.
  assert.ok((ex instanceof TypeError&&/legacy|migrateLegacyRecord/i.test(ex.message))||(/^LEGACY_|^MIGRATION_/.test(ex.code||'')));
  assert.equal(JSON.stringify(rec),before);return;
 }
 assert.equal(JSON.stringify(rec),before);
 assert.deepEqual(I.validateSnapshot(m.snapshot),[], 'successful transform may not return a structurally invalid snapshot');
 assert.equal(m.snapshot.migration.sourceRecord.appliances,rawList);
 assert.ok(m.problems.length>0||m.snapshot.migration.unresolvedItems.length>0,'malformed content must not become a trusted empty list with only a prose note');
});
