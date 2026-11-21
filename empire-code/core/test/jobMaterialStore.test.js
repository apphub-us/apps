'use strict';
// Store tests use explicit simulated IndexedDB; native acceptance is separate.
const { test } = require('node:test');const assert=require('node:assert/strict');
const M=require('../src/jobs/jobMaterial'), {createMaterialStore}=require('../src/jobs/jobMaterialStore');
const Job=require('../src/jobs/jobCard');const {makeIndexedDb,deterministicCrypto}=require('./helpers/jobIndexedDb');
const id=(p,n)=>p+n.toString(16).padStart(32,'0'), J=id('job1_',1), R=id('jrev1_',1), NOW='2026-10-08T18:31:00.000Z';
const fields=patch=>({label:'Conduit Żółć',specification:'3/4 inch\nTest part',quantityText:'120.00',unit:'ft',status:'needed',location:'Panel A',supplier:'Test supplier',notes:'Observation only',...patch});
const readJob=async jobId=>{const r=Job.createInitialRevision({title:'Saved job',address:'Test',notes:''},[],{jobId,revisionId:R,savedAt:NOW});return {ok:true,job:{head:{kind:'empire-code.job-head',recordVersion:1,jobId,currentRevisionId:R,revisionNumber:1},revision:r.revision}};};
const schema={revisions:{keyPath:'revisionId',indexes:{byJobId:{keyPath:'jobId'},byMaterialId:{keyPath:'materialId'}}}};
function env(options={}){const e=makeIndexedDb('empire_code_materials');if(options.rows)e.control.seed({schema,revisions:options.rows});const opts={crypto:deterministicCrypto(options.start||1),readJob,now:()=>NOW,...options};return {...e,store:createMaterialStore(e.indexedDB,opts)};}
const good=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.revision;};
const reject=(r,code)=>{assert.equal(r.ok,false,JSON.stringify(r));assert.equal(r.code,code,JSON.stringify(r));};
function revision(n,patch={}){return good(M.createInitial(fields(patch),{materialId:id('mat1_',n),revisionId:id('trev1_',n),jobId:J,jobRevisionId:R,savedAt:NOW}));}
test('create/list/restart retain exact raw item, original unit and independent return copies',async()=>{
 const e=env();assert.deepEqual(await e.store.list(J),{ok:true,materials:[]});const r=good(await e.store.create(J,fields()));assert.equal(r.item.quantityText,'120.00');assert.equal(e.control.count('revisions'),1);const bytes=e.control.snapshot();r.item.notes='mutated';e.store.close();
 const next=createMaterialStore(e.indexedDB,{crypto:deterministicCrypto(100),readJob});const list=await next.list(J);assert.equal(list.ok,true);assert.equal(list.materials[0].current.item.notes,'Observation only');assert.deepEqual(e.control.snapshot(),bytes);next.close();
});
test('update appends new immutable row; no-op and history do not write',async()=>{
 const e=env();const a=good(await e.store.create(J,fields()));const b=good(await e.store.update(J,a.materialId,a.revisionId,fields({quantityText:'119.95'}),'Typo in transcription'));assert.equal(b.revisionNumber,2);assert.deepEqual(e.control.raw('revisions',a.revisionId),a);const snap=e.control.snapshot();
 const noop=await e.store.update(J,b.materialId,b.revisionId,b.item,'');assert.equal(noop.unchanged,true);assert.deepEqual(e.control.snapshot(),snap);const read=await e.store.read(J,a.materialId);assert.deepEqual(read.history,[b,a]);assert.equal(e.control.stats.events.some(x=>['put','delete','clear'].includes(x.operation)),false);e.store.close();
});
test('same expected revision in two clients has one winner and one conflict',async()=>{
 const e=env(), a=good(await e.store.create(J,fields()));const b=createMaterialStore(e.indexedDB,{crypto:deterministicCrypto(100),readJob,now:()=>NOW});
 const results=await Promise.all([e.store.update(J,a.materialId,a.revisionId,fields({quantityText:'119'}),'A typo'),b.update(J,a.materialId,a.revisionId,fields({quantityText:'118'}),'B typo')]);assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.find(x=>!x.ok).code,'CONFLICT');assert.equal(e.control.count('revisions'),2);b.close();e.store.close();
});
test('stale unchanged update conflicts before no-op and keeps winner intact',async()=>{
 const e=env(),a=good(await e.store.create(J,fields())),b=good(await e.store.update(J,a.materialId,a.revisionId,fields({quantityText:'118'}),'Correct typo'));const snap=e.control.snapshot();reject(await e.store.update(J,a.materialId,a.revisionId,b.item,''),'CONFLICT');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
});
test('successful add is not success until commit; native-style late abort rolls back row',async()=>{
 const e=env();await e.store.list(J);const hold=e.control.holdNextCommit('readwrite');let resolved=false;const saving=e.store.create(J,fields()).then(x=>{resolved=true;return x;});await hold.reached;assert.equal(resolved,false);assert.equal(e.control.count('revisions'),0);hold.abort('QuotaExceededError');reject(await saving,'QUOTA');assert.equal(e.control.count('revisions'),0);good(await e.store.create(J,fields()));e.store.close();
});
test('read waits for transaction completion and abort does not publish partial results',async()=>{
 const e=env();good(await e.store.create(J,fields()));const hold=e.control.holdNextCommit('readonly');let settled=false;const pending=e.store.list(J).then(x=>{settled=true;return x;});await hold.reached;assert.equal(settled,false);hold.abort();reject(await pending,'ABORTED');e.store.close();
});
test('missing job and malformed job response refuse before material writes',async()=>{
 for(const readJob of [async()=>({ok:false}),async()=>{throw Error('offline');},async()=>({ok:true,job:{head:{},revision:{}}})]){const e=env({readJob});reject(await e.store.create(J,fields()),'JOB_UNAVAILABLE');assert.equal(e.control.snapshot(),null);e.store.close();}
});
test('input data is copied before async job read, not mutated while waiting',async()=>{
 let release;const wait=new Promise(r=>{release=r;});const e=env({readJob:async j=>{await wait;return readJob(j);}});const input=fields();const pending=e.store.create(J,input);input.quantityText='999';release();assert.equal(good(await pending).item.quantityText,'120.00');e.store.close();
});
test('unknown/future records and missing parent do not become an empty history',async()=>{
 const a=revision(1),b=good(M.createUpdate(a,fields({quantityText:'119'}),'Fix',{revisionId:id('trev1_',2),jobRevisionId:R,savedAt:NOW}));
 for(const rows of [[{...a,recordVersion:99}],[b],[a,{...b,parentRevisionId:id('trev1_',8)}]]){const e=env({rows});const snap=e.control.snapshot();const r=await e.store.list(J);assert.equal(r.ok,false);assert.ok(['CORRUPT','UNSUPPORTED'].includes(r.code));assert.deepEqual(e.control.snapshot(),snap);e.store.close();}
});
test('unindexed corrupted row is explicitly reported, not silently hidden',async()=>{
 const a=revision(1);delete a.jobId;const e=env({rows:[a]});const snap=e.control.snapshot();reject(await e.store.list(J),'CORRUPT');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
});
test('job identity isolation prevents updating or reading a different job material',async()=>{
 const e=env(),a=good(await e.store.create(J,fields()));assert.deepEqual(await e.store.list(id('job1_',2)),{ok:true,materials:[]});reject(await e.store.read(id('job1_',2),a.materialId),'NOT_FOUND');reject(await e.store.update(id('job1_',2),a.materialId,a.revisionId,fields({quantityText:'10'}),'wrong job'),'NOT_FOUND');assert.equal(e.control.count('revisions'),1);e.store.close();
});
test('blocked open cancellation and closing during open cannot cause hidden writes',async()=>{
 const e=env();e.control.blockNextOpen();reject(await e.store.create(J,fields()),'BLOCKED');e.control.releaseBlockedOpen();await e.control.flush();const snap=e.control.snapshot();assert.ok(!snap||snap.revisions.length===0);e.store.close();
 const f=env();const pending=f.store.create(J,fields());f.store.close();reject(await pending,'UNAVAILABLE');await f.control.flush();assert.equal(f.control.snapshot(),null);
});
test('secure random is mandatory; collisions retry at most five times and retain prior data',async()=>{
 const e=env({crypto:{getRandomValues(a){a.fill(7);return a;}}});good(await e.store.create(J,fields()));const snap=e.control.snapshot();reject(await e.store.create(J,fields()),'COLLISION');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
 const f=env({crypto:null});reject(await f.store.create(J,fields()),'UNAVAILABLE');assert.equal(f.control.snapshot(),null);f.store.close();
});
test('entry limit is enforced atomically without truncating list or deleting old items',async()=>{
 const rows=Array.from({length:500},(_,i)=>revision(i+1));const e=env({rows,start:9000});const snap=e.control.snapshot();assert.equal((await e.store.list(J)).materials.length,500);reject(await e.store.create(J,fields()),'LIMIT');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
});
test('revision 50 remains readable and update 51 refuses without changing history',async()=>{
 const rows=[revision(1)];for(let i=2;i<=50;i++)rows.push(good(M.createUpdate(rows.at(-1),fields({quantityText:String(i)}),'Update',{revisionId:id('trev1_',i),jobRevisionId:R,savedAt:NOW})));
 const e=env({rows,start:9000});assert.equal((await e.store.read(J,rows[0].materialId)).history.length,50);const snap=e.control.snapshot();reject(await e.store.update(J,rows[0].materialId,rows.at(-1).revisionId,fields({quantityText:'51'}),'Update'),'LIMIT');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
});
test('versionchange closes adapter and future database remains unsupported',async()=>{
 const e=env();good(await e.store.create(J,fields()));await e.control.changeVersion(2);reject(await e.store.list(J),'UNAVAILABLE');e.store.close();const later=createMaterialStore(e.indexedDB,{crypto:deterministicCrypto(100),readJob});reject(await later.list(J),'UNSUPPORTED');later.close();
});

test('Not needed remains in current list with original quantity and prior states retained',async()=>{const e=env(),a=good(await e.store.create(J,fields())),b=good(await e.store.update(J,a.materialId,a.revisionId,fields({status:'not_needed'}),'Scope changed'));const list=await e.store.list(J);assert.equal(list.materials.length,1);assert.equal(list.materials[0].current.item.status,'not_needed');assert.equal(list.materials[0].current.item.quantityText,a.item.quantityText);assert.deepEqual(list.materials[0].history,[b,a]);e.store.close();});
test('two independent rows with identical labels are never silently merged',async()=>{const e=env();const a=good(await e.store.create(J,fields())),b=good(await e.store.create(J,fields()));assert.notEqual(a.materialId,b.materialId);assert.equal((await e.store.list(J)).materials.length,2);e.store.close();});
test('global item identity collision is not adopted across jobs',async()=>{const e=env({crypto:{getRandomValues(a){a.fill(8);return a;}}});good(await e.store.create(J,fields()));const before=e.control.snapshot();reject(await e.store.create(id('job1_',2),fields()),'COLLISION');assert.deepEqual(e.control.snapshot(),before);e.store.close();});
test('per-job 2000-row boundary refuses additional items without corrupting a readable journal',async()=>{const rows=[];for(let m=1;m<=40;m++){let previous=good(M.createInitial(fields({quantityText:'1'}),{materialId:id('mat1_',m),revisionId:id('trev1_',m*100),jobId:J,jobRevisionId:R,savedAt:NOW}));rows.push(previous);for(let v=2;v<=50;v++){previous=good(M.createUpdate(previous,fields({quantityText:String(v)}),'Updated amount',{revisionId:id('trev1_',m*100+v),jobRevisionId:R,savedAt:NOW}));rows.push(previous);}}const e=env({rows,start:90000});assert.equal((await e.store.list(J)).materials.length,40);const before=e.control.snapshot();reject(await e.store.create(J,fields()),'LIMIT');assert.deepEqual(e.control.snapshot(),before);e.store.close();});
