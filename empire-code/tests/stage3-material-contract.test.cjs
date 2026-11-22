'use strict';
// EC-AUDIT-FIX-1 stage 3 — EC-08, server side: the proposal contract and the provider schema use the shared unit /
// quantity definition (core/src/jobs/materialQuantity.js). Local only: no network, no key. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../candidate/server/contract.cjs'),Q=require('../core/src/jobs/materialQuantity.js');
const provider=()=>import('../candidate/server/cloud-provider.mjs');
const FIELDS=['name','quantity','unit','specification','notes','review'];
const text='Dodaj pół rolki taśmy';
const add=(quantity,unit)=>({scope:'materials',reply:'ok',question:'',operations:[{op:'add',id:'new1',changed_fields:FIELDS,source_quote:'pół rolki',fields:{name:'Tape',quantity,unit,specification:'',notes:'',review:[]}}]});
const update=(id,changed)=>({scope:'materials',reply:'ok',question:'',operations:[{op:'update',id,changed_fields:Object.keys(changed),source_quote:'pół rolki',fields:Object.fromEntries(FIELDS.map(k=>[k,Object.hasOwn(changed,k)?changed[k]:null]))}]});
const item=(n,quantity,unit)=>({id:'i'+String(n).padStart(4,'0'),name:'Item '+n,quantity,unit,specification:'',notes:'',review:[]});
const legacy=()=>({version:1,revision:1,nextId:4,items:[item(1,'0.5','roll'),item(2,'0.5','m'),item(3,'2','pcs')],history:[{role:'user',content:'x'},{role:'assistant',content:'y'}]});
const refusal=e=>e.code==='PROPOSAL_QUANTITY'&&e.safe===true&&e.status===422;

test('EC-08: the model schema and the contract schema enumerate exactly the shared units plus null',async()=>{
 const {SCHEMA}=await provider();
 const modelUnits=SCHEMA.properties.operations.items.properties.fields.properties.unit.enum;
 assert.deepEqual(modelUnits,[...Q.UNITS,null]);
 assert.deepEqual(C.schema.properties.operations.items.properties.fields.properties.unit.enum,[...Q.UNITS,null]);
 for(const unit of ['box','pack','roll','set','pcs','ft','in','m','cm','mm'])assert.ok(modelUnits.includes(unit),unit);
 assert.equal(C.UNITS,Q.UNITS);
});

test('EC-08: new proposals — 0.5 roll / set / pcs / box / pack refused with the safe corrective error; 1 roll, box, pack and fractional lengths accepted',async()=>{
 const {prepareProposal}=await provider();
 for(const unit of Q.COUNT_UNITS){
  const state=C.empty();
  assert.throws(()=>prepareProposal(state,add('0.5',unit),text),refusal,unit);
  assert.deepEqual(state,C.empty(),'a refused proposal leaves the draft unchanged');
  const out=prepareProposal(C.empty(),add('1',unit),text);
  assert.deepEqual([out.state.items[0].quantity,out.state.items[0].unit,out.state.items[0].id],['1',unit,'i0001']);assert.deepEqual(out.corrections,[]);
 }
 for(const unit of Q.LENGTH_UNITS)assert.equal(prepareProposal(C.empty(),add('0.5',unit),text).state.items[0].quantity,'0.5',unit);
 // unknown values are kept for review, not refused and not guessed
 const unknown=prepareProposal(C.empty(),add(null,null),text).state.items[0];assert.deepEqual([unknown.quantity,unknown.unit],[null,null]);
});

test('EC-08 compatibility: a stored draft with 0.5 roll is accepted by the provider checks, kept verbatim and reported for correction',async()=>{
 const {prepareProposal,createProvider}=await provider();
 const p=createProvider({prompt:'synthetic prompt',request:async()=>{throw Error('not called');}});
 const checked=p.checkRun(legacy(),text);
 assert.deepEqual(checked.state,legacy());assert.ok(checked.context.includes('"quantity":"0.5","unit":"roll"'),'the model sees the original values');
 assert.deepEqual(C.corrections(legacy()),[{id:'i0001',code:'WHOLE_COUNT_REQUIRED',quantity:'0.5',unit:'roll'}]);
 // an update of an unrelated item goes through; the legacy item is untouched and still reported
 const other=prepareProposal(legacy(),update('i0003',{notes:'blue'}),text);
 assert.deepEqual(other.state.items[0],legacy().items[0]);assert.deepEqual(other.corrections.map(c=>c.id),['i0001']);assert.equal(other.state.items[2].notes,'blue');
});

test('EC-08: updates validate the merged quantity + unit (0.5 m -> roll refused; quantity-only correction to 1 accepted)',async()=>{
 const {prepareProposal}=await provider();
 assert.throws(()=>prepareProposal(legacy(),update('i0002',{unit:'roll'}),text),refusal);
 assert.throws(()=>prepareProposal(legacy(),update('i0001',{name:'Tape'}),text),refusal,'the legacy item itself cannot be rewritten while still fractional');
 const fixed=prepareProposal(legacy(),update('i0001',{quantity:'1'}),text);
 assert.deepEqual([fixed.state.items[0].id,fixed.state.items[0].quantity,fixed.state.items[0].unit],['i0001','1','roll']);assert.deepEqual(fixed.corrections,[]);
 assert.deepEqual(fixed.state.items.map(i=>i.id),['i0001','i0002','i0003']);assert.equal(fixed.state.nextId,4);
 assert.equal(fixed.diffs[0].before.quantity,'0.5','the diff shows the original value, not a rounded one');
});
