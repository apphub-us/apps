'use strict';
// EC-08, linked-material correction (candidate/browser/workspace/material-edit.js): the edit of an item that is already
// linked to a Jobs material uses the ONE shared unit / quantity definition (core/src/jobs/materialQuantity.js, loaded in
// the browser as EC.materialQuantity) — box and pack are editable, counts are whole, lengths may be fractional, a legacy
// fractional count needs a user correction and nothing is rounded. The file is loaded exactly as shipped (its factory).
// Authored for coordinator execution; no run is claimed. Local only: no network, no storage. Run: node --test tests/
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto:crypto}=require('node:crypto');
const Q=require('../core/src/jobs/materialQuantity.js');
const M=require('../core/src/jobs/jobMaterial.js');
const Job=require('../core/src/jobs/jobCard.js');
const Store=require('../core/src/jobs/jobMaterialStore.js');
const factory=require('../candidate/browser/workspace/material-edit.js');
const E=factory(M,Store,Job,Q);

const T0='2026-11-15T20:00:00.000Z',T1='2026-11-15T20:30:00.000Z',T2='2026-11-15T21:00:00.000Z';
const jobId='job1_'+'1'.repeat(32),jobRevisionId='jrev1_'+'2'.repeat(32),sourceId='conv1_'+'3'.repeat(32),materialId='mat1_'+'4'.repeat(32);
const jobRevision=Job.createInitialRevision({title:'Synthetic job',address:'',notes:''},[],{jobId,revisionId:jobRevisionId,savedAt:T0}).revision;
const head={kind:'empire-code.job-head',recordVersion:1,jobId,currentRevisionId:jobRevisionId,revisionNumber:1};
const provenance='[Conversation '+sourceId+' / revision 1 / item i0001]';
const saved=(quantityText,unit)=>({label:'Item 1',specification:'',quantityText,unit,status:'not_recorded',location:'',supplier:'',notes:provenance});
const baselineOf=(quantityText,unit)=>{const made=M.createInitial(saved(quantityText,unit),{materialId,revisionId:'trev1_'+'5'.repeat(32),jobId,jobRevisionId,savedAt:T0});assert.equal(made.ok,true,JSON.stringify(made));return made.revision;};
const item=(quantity,unit,extra)=>Object.assign({id:'i0001',name:'Item 1',quantity,unit,specification:'',notes:'',review:[]},extra||{});
function input(conversationItem,extra){
 const baseline=baselineOf('2','pcs');
 return Object.assign({sourceId,sourceRevision:2,sourceSavedAt:T1,reviewedAt:T2,item:conversationItem,receipt:{jobId,itemId:'i0001',materialId,revisionId:baseline.revisionId},
  job:{head,revision:jobRevision},baseline,current:baseline,acknowledged:true,rebase:false},extra||{});
}
const prepare=(conversationItem,extra)=>E.prepare(input(conversationItem,extra),{crypto});

test('EC-08 linked edit: the shipped file takes the shared module and keeps no unit list of its own',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','candidate','browser','workspace','material-edit.js'),'utf8');
 assert.match(source,/root\.EC\.materialQuantity/);assert.match(source,/Q\.inspectDraft\(/);
 assert.ok(!/['"](?:roll|pack|pcs|box|set)['"]/.test(source),'a unit literal is back in material-edit.js');
 assert.deepEqual(Object.keys(E),['capture','prepare','commit']);
});

test('EC-08 linked edit: box and pack are really edited — the prepared revision carries the new whole count and unit',async()=>{
 for(const[quantity,unit]of [['3','box'],['12','pack'],['4','roll'],['1','set'],['2.0','roll']]){
  const r=await prepare(item(quantity,unit));
  assert.equal(r.ok,true,quantity+' '+unit+': '+JSON.stringify(r));assert.equal(r.unchanged,false);
  const expected=[{field:'unit',before:'pcs',after:unit}];
  if(quantity!=='2')expected.unshift({field:'quantityText',before:'2',after:quantity});
  assert.deepEqual(r.plan.changes,expected);
  assert.deepEqual([r.plan.revision.item.quantityText,r.plan.revision.item.unit],[quantity,unit],'stored exactly as stated, not reformatted');
  assert.deepEqual([r.plan.kind,r.plan.version,r.plan.revision.revisionNumber,r.plan.revision.parentRevisionId,r.plan.revision.materialId],['empire-code.material-edit',1,2,input(item('2','pcs')).baseline.revisionId,materialId]);
  assert.match(r.plan.id,/^edit1_[a-f0-9]{64}$/);assert.equal(M.readRevision(r.plan.revision).ok,true);
  assert.equal(r.plan.revision.item.notes,provenance,'an equivalent provenance note is not rewritten');
 }
});

test('EC-08 linked edit: a fractional length is kept digit for digit; a fractional count is never rounded and needs a correction',async()=>{
 for(const[quantity,unit]of [['12.25','ft'],['0.5','m'],['0.5','in'],['2.5','cm'],['7.5','mm']]){
  const r=await prepare(item(quantity,unit));
  assert.equal(r.ok,true,quantity+' '+unit);assert.deepEqual([r.plan.revision.item.quantityText,r.plan.revision.item.unit],[quantity,unit]);
 }
 for(const unit of Q.COUNT_UNITS){
  for(const quantity of ['0.5','2.5','1.25']){
   const r=await prepare(item(quantity,unit));
   assert.deepEqual([r.ok,r.code],[false,'QUANTITY_CORRECTION'],quantity+' '+unit);
   assert.ok(r.problems[0].includes('i0001')&&r.problems[0].includes(quantity+' '+unit)&&r.problems[0].includes('Niczego nie zaokrąglono'),r.problems[0]);
   assert.equal(r.plan,undefined);
  }
 }
 // The same decision as the shared module for every unit, and the corrected legacy item goes through unchanged in form.
 for(const unit of Q.UNITS)for(const quantity of ['1','0.5']){
  const r=await prepare(item(quantity,unit)),seen=Q.inspectDraft(quantity,unit);
  assert.equal(r.ok,seen.writeValid,quantity+' '+unit);
 }
 const corrected=await prepare(item('1','roll'));
 assert.deepEqual([corrected.ok,corrected.plan.revision.item.quantityText,corrected.plan.revision.item.unit],[true,'1','roll']);
});

test('EC-08 linked edit: unknown stays INCOMPLETE, malformed stays INVALID, a missing shared module fails closed',async()=>{
 for(const[quantity,unit]of [[null,'box'],['3',null],[null,null]])assert.equal((await prepare(item(quantity,unit))).code,'INCOMPLETE');
 for(const[quantity,unit]of [['3','boxes'],['3','PCS'],['3','A'],['1e3','box'],['0','box'],['-1','ft'],['1,5','ft'],[3,'box'],['12345678','ft'],['1.23456','ft']])assert.equal((await prepare(item(quantity,unit))).code,'INVALID',quantity+' '+unit);
 const without=factory(M,Store,Job);
 const r=await without.prepare(input(item('3','box')),{crypto});
 assert.deepEqual([r.ok,r.code],[false,'UNAVAILABLE']);
});

test('EC-08 linked edit: the existing source, receipt, revision, review and confirmation guards are unchanged',async()=>{
 assert.equal((await prepare(item('3','box',{review:['sprawdź rozmiar']}),{acknowledged:false})).code,'REVIEW_REQUIRED');
 assert.equal((await prepare(item('3','box',{review:['sprawdź rozmiar']}))).ok,true);
 const base=input(item('3','box'));
 assert.equal((await E.prepare({...base,receipt:{...base.receipt,itemId:'i0002'}},{crypto})).code,'INVALID');
 assert.equal((await E.prepare({...base,receipt:{...base.receipt,revisionId:'trev1_'+'9'.repeat(32)}},{crypto})).code,'LINK_CHANGED');
 assert.equal((await E.prepare({...base,sourceId:'conv1_xyz'},{crypto})).code,'INVALID');
 assert.equal((await E.prepare({...base,reviewedAt:T0},{crypto})).code,'CLOCK_SKEW');
 assert.equal((await E.prepare({...base,job:{head:{...head,currentRevisionId:'jrev1_'+'8'.repeat(32)},revision:jobRevision}},{crypto})).code,'JOB_CHANGED');
 assert.equal((await E.prepare({...base,extra:1},{crypto})).code,'INVALID');
 assert.equal((await E.prepare(base,{})).code,'UNAVAILABLE','no digest, no identity');
 // A newer Jobs revision is a conflict until the user explicitly compares; the job-only field then survives the edit.
 const newer=M.createUpdate(base.baseline,{...saved('2','pcs'),status:'ordered'},'manual status',{revisionId:'trev1_'+'6'.repeat(32),jobRevisionId,savedAt:T1});
 assert.equal(newer.ok,true,JSON.stringify(newer));
 assert.equal((await E.prepare({...base,current:newer.revision},{crypto})).code,'CONFLICT');
 const rebased=await E.prepare({...base,current:newer.revision,rebase:true},{crypto});
 assert.equal(rebased.ok,true,JSON.stringify(rebased));
 assert.deepEqual([rebased.plan.revision.item.quantityText,rebased.plan.revision.item.unit,rebased.plan.revision.item.status,rebased.plan.revision.revisionNumber],['3','box','ordered',3]);
 // An unchanged item writes nothing.
 assert.deepEqual(await prepare(item('2','pcs')),{ok:true,unchanged:true});
 // Commit: exact confirmation of this plan, an unchanged source, then the store — in that order, before any write.
 const ready=await E.prepare(base,{crypto}),plan=ready.plan;
 const source={sourceId:base.sourceId,sourceRevision:base.sourceRevision,sourceSavedAt:base.sourceSavedAt,item:base.item,receipt:base.receipt};
 for(const confirmation of [{accepted:false,planId:plan.id},{accepted:true,planId:'edit1_'+'0'.repeat(64)},{accepted:true},{accepted:true,planId:plan.id,extra:1}])
  assert.equal((await E.commit(plan,source,confirmation,{crypto})).code,'CONFIRMATION');
 assert.equal((await E.commit(plan,{...source,item:item('4','box')},{accepted:true,planId:plan.id},{crypto})).code,'STALE');
 assert.equal((await E.commit({...plan,revision:{...plan.revision,item:{...plan.revision.item,quantityText:'30'}}},source,{accepted:true,planId:plan.id},{crypto})).code,'STALE');
 assert.equal((await E.commit(plan,source,{accepted:true,planId:plan.id},{crypto})).code,'UNAVAILABLE','no store was given: nothing is written');
});
