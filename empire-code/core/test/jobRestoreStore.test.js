'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const F = require('./helpers/archiveFixtures');
const Source = require('../src/jobs/jobArchiveSource');
const { makeIndexedDb } = require('./helpers/jobIndexedDb');
const { createRestoreStore } = require('../src/jobs/jobRestoreStore');
const fail = (r) => assert.equal(r.ok,false,JSON.stringify(r));
function env(steps) {
 const dbs={}, objects={};for(const n of [...Object.keys(Source.SCHEMAS),'empire_code_restore_operations'])dbs[n]=makeIndexedDb(n);
 const indexedDB={open(name,version){if(!dbs[name])throw Error(name);return dbs[name].indexedDB.open(name,version);}};
 const localStorage={getItem(k){return Object.hasOwn(objects,k)?objects[k]:null;},setItem(k,v){objects[k]=v;},removeItem(k){delete objects[k];}};
 const locks={request:async (_name,_opts,fn)=>fn({name:'test'})};
 const options={crypto:crypto.webcrypto,locks,...(steps?{step:steps}:{})};
 const store=createRestoreStore(indexedDB,localStorage,options);
 return {dbs,objects,indexedDB,localStorage,locks,options,store,snapshot:()=>Object.fromEntries(Object.entries(dbs).map(([n,d])=>[n,d.control.snapshot()]))};
}
const archive=()=>({ok:true,...F.fixture()});
test('full restore writes exact original chains, text and blobs, and a second restore refuses with no mutations',async()=>{
 const e=env(),f=archive();let r=await e.store.restore(f,true);assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(e.objects[Source.PREFIX+F.R],f.manifest.results[0].raw);
 for(const [n,k,expected]of [['empire_code_jobs','jobs',[f.manifest.job.head]],['empire_code_jobs','jobRevisions',f.manifest.job.revisions],['empire_code_measurements','revisions',f.manifest.measurements],['empire_code_materials','revisions',f.manifest.materials],['empire_code_photos','revisions',f.manifest.photoRevisions]]){
  const rows=e.dbs[n].control.snapshot()[k].map(x=>x[1]);assert.deepEqual(rows,expected.slice().sort((a,b)=>a[k==='jobs'?'jobId':'revisionId'].localeCompare(b[k==='jobs'?'jobId':'revisionId'])),n+'/'+k);
 }
 assert.equal(e.dbs.empire_code_photos.control.count('assets'),1);
 assert.deepEqual((await e.store.inspect()).pending,[]);
 const snap=e.snapshot(),objects={...e.objects};r=await e.store.restore(f,true);fail(r);assert.equal(r.code,'EXISTS');assert.deepEqual(e.snapshot(),snap);assert.deepEqual(e.objects,objects);
});
test('missing confirmation and untrusted/incomplete archive create nothing',async()=>{
 const e=env(),f=archive();assert.equal((await e.store.restore(f,false)).code,'CONFIRMATION');f.manifest.results[0].raw=null;assert.equal((await e.store.restore(f,true)).code,'INCOMPLETE');assert.deepEqual(e.snapshot(),Object.fromEntries(Object.keys(e.dbs).map(n=>[n,null])));
});
test('injected failure after material commit rolls back all children and result without an exposed job',async()=>{
 const e=env(async name=>{if(name==='empire_code_materials')throw Error('fault');});const r=await e.store.restore(archive(),true);fail(r);assert.equal(r.code,'UNAVAILABLE',JSON.stringify(r));assert.deepEqual((await e.store.inspect()).pending,[]);assert.deepEqual(e.objects,{});
 for(const [n,d] of Object.entries(e.dbs))if(n!=='empire_code_restore_operations')for(const store of n==='empire_code_jobs'?['jobs','jobRevisions']:n==='empire_code_photos'?['assets','revisions']:['revisions'])assert.equal(d.control.count(store),0,n+'/'+store);
});
test('can recover a staged marker without ever touching unrelated keys',async()=>{
 const e=env(),f=archive();const first=await e.store.restore(f,true);assert.equal(first.ok,true,JSON.stringify(first));
 e.objects.unrelated='keep';const answer=await e.store.recover();assert.deepEqual(answer,{ok:true,recovered:0});assert.equal(e.objects.unrelated,'keep');
});

test('restart-style pending journal removes only matching committed fragments; unrelated results survive',async()=>{
 const R=require('../src/jobs/jobRestore');const e=env(),f=archive(),p=R.plan(f);assert.equal(p.ok,true);
 const rows=Object.fromEntries(Object.entries(p.records).map(([name,stores])=>[name,Object.fromEntries(Object.entries(stores).map(([s,vs])=>[s,vs.map(v=>s==='assets'?{kind:v.kind,recordVersion:v.recordVersion,photoId:v.photoId,jobId:v.jobId,file:v.file}:v)]))]));
 const marker={jobId:p.jobId,archiveId:p.archiveId,state:'pending',rows,results:p.results};
 e.dbs.empire_code_restore_operations.control.seed({schema:{operations:{keyPath:'jobId',indexes:{}}},operations:[marker]});
 e.dbs.empire_code_measurements.control.seed({schema:{revisions:{keyPath:'revisionId',indexes:{byJobId:{keyPath:'jobId'},byMeasurementId:{keyPath:'measurementId'}}}},revisions:p.records.empire_code_measurements.revisions});
 e.objects[p.results[0].key]=p.results[0].raw;e.objects['unrelated-key']='do-not-touch';
 const recovered=await e.store.recover();assert.deepEqual(recovered,{ok:true,recovered:1});assert.equal(e.objects[p.results[0].key],undefined);assert.equal(e.objects['unrelated-key'],'do-not-touch');assert.equal(e.dbs.empire_code_measurements.control.count('revisions'),0);assert.deepEqual((await e.store.inspect()).pending,[]);
});

test('recovery refuses deletion when another editor changed a staged row',async()=>{
 const R=require('../src/jobs/jobRestore');const e=env(),p=R.plan(archive());assert.equal(p.ok,true);
 const rows=Object.fromEntries(Object.entries(p.records).map(([n,stores])=>[n,Object.fromEntries(Object.entries(stores).map(([s,v])=>[s,s==='assets'?[]:v]))]));
 e.dbs.empire_code_restore_operations.control.seed({schema:{operations:{keyPath:'jobId',indexes:{}}},operations:[{jobId:p.jobId,archiveId:p.archiveId,state:'pending',rows,results:[]}]});
 e.dbs.empire_code_measurements.control.seed({schema:{revisions:{keyPath:'revisionId',indexes:{byJobId:{keyPath:'jobId'},byMeasurementId:{keyPath:'measurementId'}}}},revisions:[{...p.records.empire_code_measurements.revisions[0],correctionReason:'CHANGED'}]});
 const r=await e.store.recover();assert.equal(r.code,'CLEANUP_BLOCKED');assert.equal(e.dbs.empire_code_measurements.control.count('revisions'),1);assert.equal((await e.store.inspect()).pending.length,1);
});
