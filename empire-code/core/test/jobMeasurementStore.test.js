'use strict';
// Store tests use explicit simulated IndexedDB; native acceptance is separate.
const { test } = require('node:test');const assert=require('node:assert/strict');
const M=require('../src/jobs/jobMeasurement'), {createMeasurementStore}=require('../src/jobs/jobMeasurementStore');
const Job=require('../src/jobs/jobCard');const {makeIndexedDb,deterministicCrypto}=require('./helpers/jobIndexedDb');
const id=(p,n)=>p+n.toString(16).padStart(32,'0'), J=id('job1_',1), R=id('jrev1_',1), NOW='2026-10-08T18:31:00.000Z';
const fields=patch=>({label:'L1–N',quantity:'voltage',valueText:'120.00',unit:'V',location:'Panel A',measuredLocal:'2026-10-08T14:30',utcOffset:'-04:00',mode:'AC',instrument:'Meter',notes:'Observation only',...patch});
const readJob=async jobId=>{const r=Job.createInitialRevision({title:'Saved job',address:'Test',notes:''},[],{jobId,revisionId:R,savedAt:NOW});return {ok:true,job:{head:{kind:'empire-code.job-head',recordVersion:1,jobId,currentRevisionId:R,revisionNumber:1},revision:r.revision}};};
const schema={revisions:{keyPath:'revisionId',indexes:{byJobId:{keyPath:'jobId'},byMeasurementId:{keyPath:'measurementId'}}}};
function env(options={}){const e=makeIndexedDb('empire_code_measurements');if(options.rows)e.control.seed({schema,revisions:options.rows});const opts={crypto:deterministicCrypto(options.start||1),readJob,now:()=>NOW,...options};return {...e,store:createMeasurementStore(e.indexedDB,opts)};}
const good=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.revision;};
const reject=(r,code)=>{assert.equal(r.ok,false,JSON.stringify(r));assert.equal(r.code,code,JSON.stringify(r));};
function revision(n,patch={}){return good(M.createInitial(fields(patch),{measurementId:id('meas1_',n),revisionId:id('mrev1_',n),jobId:J,jobRevisionId:R,savedAt:NOW}));}
test('create/list/restart retain exact raw reading, original unit and independent return copies',async()=>{
 const e=env();assert.deepEqual(await e.store.list(J),{ok:true,measurements:[]});const r=good(await e.store.create(J,fields()));assert.equal(r.reading.valueText,'120.00');assert.equal(e.control.count('revisions'),1);const bytes=e.control.snapshot();r.reading.notes='mutated';e.store.close();
 const next=createMeasurementStore(e.indexedDB,{crypto:deterministicCrypto(100),readJob});const list=await next.list(J);assert.equal(list.ok,true);assert.equal(list.measurements[0].current.reading.notes,'Observation only');assert.deepEqual(e.control.snapshot(),bytes);next.close();
});
test('correction appends new immutable row; no-op and history do not write',async()=>{
 const e=env();const a=good(await e.store.create(J,fields()));const b=good(await e.store.correct(J,a.measurementId,a.revisionId,fields({valueText:'119.95'}),'Typo in transcription'));assert.equal(b.revisionNumber,2);assert.deepEqual(e.control.raw('revisions',a.revisionId),a);const snap=e.control.snapshot();
 const noop=await e.store.correct(J,b.measurementId,b.revisionId,b.reading,'');assert.equal(noop.unchanged,true);assert.deepEqual(e.control.snapshot(),snap);const read=await e.store.read(J,a.measurementId);assert.deepEqual(read.history,[b,a]);assert.equal(e.control.stats.events.some(x=>['put','delete','clear'].includes(x.operation)),false);e.store.close();
});
test('same expected revision in two clients has one winner and one conflict',async()=>{
 const e=env(), a=good(await e.store.create(J,fields()));const b=createMeasurementStore(e.indexedDB,{crypto:deterministicCrypto(100),readJob,now:()=>NOW});
 const results=await Promise.all([e.store.correct(J,a.measurementId,a.revisionId,fields({valueText:'119'}),'A typo'),b.correct(J,a.measurementId,a.revisionId,fields({valueText:'118'}),'B typo')]);assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.find(x=>!x.ok).code,'CONFLICT');assert.equal(e.control.count('revisions'),2);b.close();e.store.close();
});
test('stale unchanged correction conflicts before no-op and keeps winner intact',async()=>{
 const e=env(),a=good(await e.store.create(J,fields())),b=good(await e.store.correct(J,a.measurementId,a.revisionId,fields({valueText:'118'}),'Correct typo'));const snap=e.control.snapshot();reject(await e.store.correct(J,a.measurementId,a.revisionId,b.reading,''),'CONFLICT');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
});
test('successful add is not success until commit; native-style late abort rolls back row',async()=>{
 const e=env();await e.store.list(J);const hold=e.control.holdNextCommit('readwrite');let resolved=false;const saving=e.store.create(J,fields()).then(x=>{resolved=true;return x;});await hold.reached;assert.equal(resolved,false);assert.equal(e.control.count('revisions'),0);hold.abort('QuotaExceededError');reject(await saving,'QUOTA');assert.equal(e.control.count('revisions'),0);good(await e.store.create(J,fields()));e.store.close();
});
test('read waits for transaction completion and abort does not publish partial results',async()=>{
 const e=env();good(await e.store.create(J,fields()));const hold=e.control.holdNextCommit('readonly');let settled=false;const pending=e.store.list(J).then(x=>{settled=true;return x;});await hold.reached;assert.equal(settled,false);hold.abort();reject(await pending,'ABORTED');e.store.close();
});
test('missing job and malformed job response refuse before measurement writes',async()=>{
 for(const readJob of [async()=>({ok:false}),async()=>{throw Error('offline');},async()=>({ok:true,job:{head:{},revision:{}}})]){const e=env({readJob});reject(await e.store.create(J,fields()),'JOB_UNAVAILABLE');assert.equal(e.control.snapshot(),null);e.store.close();}
});
test('input data is copied before async job read, not mutated while waiting',async()=>{
 let release;const wait=new Promise(r=>{release=r;});const e=env({readJob:async j=>{await wait;return readJob(j);}});const input=fields();const pending=e.store.create(J,input);input.valueText='999';release();assert.equal(good(await pending).reading.valueText,'120.00');e.store.close();
});
test('unknown/future records and missing parent do not become an empty history',async()=>{
 const a=revision(1),b=good(M.createCorrection(a,fields({valueText:'119'}),'Fix',{revisionId:id('mrev1_',2),jobRevisionId:R,savedAt:NOW}));
 for(const rows of [[{...a,recordVersion:99}],[b],[a,{...b,parentRevisionId:id('mrev1_',8)}]]){const e=env({rows});const snap=e.control.snapshot();const r=await e.store.list(J);assert.equal(r.ok,false);assert.ok(['CORRUPT','UNSUPPORTED'].includes(r.code));assert.deepEqual(e.control.snapshot(),snap);e.store.close();}
});
test('unindexed corrupted row is explicitly reported, not silently hidden',async()=>{
 const a=revision(1);delete a.jobId;const e=env({rows:[a]});const snap=e.control.snapshot();reject(await e.store.list(J),'CORRUPT');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
});
test('job identity isolation prevents correcting or reading a different job measurement',async()=>{
 const e=env(),a=good(await e.store.create(J,fields()));assert.deepEqual(await e.store.list(id('job1_',2)),{ok:true,measurements:[]});reject(await e.store.read(id('job1_',2),a.measurementId),'NOT_FOUND');reject(await e.store.correct(id('job1_',2),a.measurementId,a.revisionId,fields({valueText:'10'}),'wrong job'),'NOT_FOUND');assert.equal(e.control.count('revisions'),1);e.store.close();
});
test('blocked open cancellation and closing during open cannot cause hidden writes',async()=>{
 const e=env();e.control.blockNextOpen();reject(await e.store.create(J,fields()),'BLOCKED');e.control.releaseBlockedOpen();await e.control.flush();const snap=e.control.snapshot();assert.ok(!snap||snap.revisions.length===0);e.store.close();
 const f=env();const pending=f.store.create(J,fields());f.store.close();reject(await pending,'UNAVAILABLE');await f.control.flush();assert.equal(f.control.snapshot(),null);
});
test('secure random is mandatory; collisions retry at most five times and retain prior data',async()=>{
 const e=env({crypto:{getRandomValues(a){a.fill(7);return a;}}});good(await e.store.create(J,fields()));const snap=e.control.snapshot();reject(await e.store.create(J,fields()),'COLLISION');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
 const f=env({crypto:null});reject(await f.store.create(J,fields()),'UNAVAILABLE');assert.equal(f.control.snapshot(),null);f.store.close();
});
test('entry limit is enforced atomically without truncating list or deleting old observations',async()=>{
 const rows=Array.from({length:500},(_,i)=>revision(i+1));const e=env({rows,start:9000});const snap=e.control.snapshot();assert.equal((await e.store.list(J)).measurements.length,500);reject(await e.store.create(J,fields()),'LIMIT');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
});
test('revision 50 remains readable and correction 51 refuses without changing history',async()=>{
 const rows=[revision(1)];for(let i=2;i<=50;i++)rows.push(good(M.createCorrection(rows.at(-1),fields({valueText:String(i)}),'Correction',{revisionId:id('mrev1_',i),jobRevisionId:R,savedAt:NOW})));
 const e=env({rows,start:9000});assert.equal((await e.store.read(J,rows[0].measurementId)).history.length,50);const snap=e.control.snapshot();reject(await e.store.correct(J,rows[0].measurementId,rows.at(-1).revisionId,fields({valueText:'51'}),'Correction'),'LIMIT');assert.deepEqual(e.control.snapshot(),snap);e.store.close();
});
test('versionchange closes adapter and future database remains unsupported',async()=>{
 const e=env();good(await e.store.create(J,fields()));await e.control.changeVersion(2);reject(await e.store.list(J),'UNAVAILABLE');e.store.close();const later=createMeasurementStore(e.indexedDB,{crypto:deterministicCrypto(100),readJob});reject(await later.list(J),'UNSUPPORTED');later.close();
});
