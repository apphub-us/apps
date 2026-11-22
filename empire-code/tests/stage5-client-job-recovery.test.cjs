'use strict';
// Stage 5 client, recovery of a started note / measurement write: when may a pending plan be RELEASED ("Zwolnij i przejrzyj ponownie")?
// Only on proof read now that the history of the job holds nothing of it. An answer "not stored" remembered from an earlier check is
// not that proof once a write was attempted again, another check could not read the history, or another tab finished the plan.
// The page scripts run in the stage2 VM harness. The job side is the REAL adapter (core/src/jobs/jobConversationActions.js) on the
// original job stores and the existing IndexedDB test double; its outcomes are never invented here. The only injected faults are:
//   hooks.skip        one commitAction call that never reaches the adapter and answers "pending, nothing stored" (storage did not start);
//   hooks.after       one REAL commit whose answer is lost on the way to the page (the record is written, the page hears "pending");
//   hooks.reconciled  runs after one REAL reconcile and before the page hears it (what another tab does in that gap);
//   env.fault         indexedDB.open throws: the real adapter then cannot read the history and classifies that itself;
//   local.refuse      the browser refuses to store the confirmed receipt.
// Storage evidence is simulated; nothing here shows native durability, cross-database atomicity or real cross-tab timing.
// Authored, not executed by the author. Run: node --test tests/stage5-client-job-recovery.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const H=require('./stage2-harness.cjs');
const A=require('../core/src/jobs/jobConversationActions.js');
const M=require('../core/src/jobs/jobMeasurement.js');
const {createJobStore}=require('../core/src/jobs/jobCardStore.js');
const {createMeasurementStore}=require('../core/src/jobs/jobMeasurementStore.js');
const {makeIndexedDb,deterministicCrypto}=require('../core/test/helpers/jobIndexedDb.js');
const CBank=require('../candidate/browser/conversation-bank.js');
const AS=require('../candidate/browser/assistant-session.js');
const TOKEN='ef'.repeat(32),T0='2020-01-15T09:00:00.000Z';
const NOTE='Neutral bar torque checked at panel A.';
// The sentence the reviewed build said after dropping a plan whose record was in the job.
const RELEASED=/Zwolniono plan zapisu/,ABSENT=/historia roboty go nie zawiera/;
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const own=x=>JSON.parse(JSON.stringify(x));
const until=async(check,ms=4000)=>{const end=Date.now()+ms;for(;;){if(check())return;if(Date.now()>end)throw Error('condition not reached');await H.settle(2);}};
const idle=p=>until(()=>!p.run('busy')&&!p.run('audioBusy')&&!p.run('handoffBusy'));
const send=async(p,text)=>{await p.type(text);await p.submit();await idle(p);};
// The simulated databases of the original stores. `fault` makes every open fail, like storage that does not answer.
function env(){
 const dbs={};let tail=Promise.resolve();
 const e={dbs,fault:false,locks:{request(name,opts,fn){const call=tail.then(()=>fn());tail=call.catch(()=>{});return call;}}};
 e.indexedDB={open(name,version){if(e.fault)throw Object.assign(Error('Fixture: job storage does not answer.'),{name:'UnknownError'});if(!dbs[name])dbs[name]=makeIndexedDb(name);return dbs[name].indexedDB.open(name,version);}};
 return e;
}
async function seedJob(e){
 const store=createJobStore(e.indexedDB,{crypto:deterministicCrypto(1),now:()=>T0});
 const made=await store.create({title:'Panel upgrade',address:'12 Main Street',notes:'First visit.'},[]);store.close();
 assert.equal(made.ok,true,JSON.stringify(made));return made.job;
}
async function revisions(e,jobId){
 const store=createJobStore(e.indexedDB,{}),h=await store.history(jobId);store.close();
 assert.equal(h.ok,true,JSON.stringify(h));return h.revisions.slice().sort((a,b)=>a.revisionNumber-b.revisionNumber);
}
async function readings(e,jobId){
 const store=createMeasurementStore(e.indexedDB,{crypto:webcrypto}),r=await store.list(jobId);if(typeof store.close==='function')store.close();
 assert.equal(r.ok,true,JSON.stringify(r));return r.measurements;
}
// The members host-core.js adds to ecHostBridge, backed by the real adapter. hooks counts: commits (calls of the page), adapter (real
// commits), reconciles (real read-only checks); heard: what the adapter really answered to its commits, in order.
function bridge(e,hooks){
 return {
  read:async id=>{const s=createJobStore(e.indexedDB,{}),r=await s.read(id);s.close();return r;},
  prepareAction:input=>A.prepare(own(input),{crypto:webcrypto}),
  pendingAction:plan=>A.pendingReceipt(own(plan)),
  commitAction:async(plan,input,confirmation,persistPending)=>{
   hooks.commits=(hooks.commits||0)+1;
   const skip=hooks.skip;hooks.skip=null;if(skip)return skip(own(plan));
   hooks.adapter=(hooks.adapter||0)+1;
   const r=await A.commit(own(plan),own(input),own(confirmation),{crypto:webcrypto,indexedDB:e.indexedDB,locks:e.locks,persistPending});
   (hooks.heard=hooks.heard||[]).push(r.status+(r.reconciled?'/reconciled':''));
   const after=hooks.after;hooks.after=null;return after?after(r):r;
  },
  reconcileAction:async receipt=>{
   hooks.reconciles=(hooks.reconciles||0)+1;
   const r=await A.reconcile(own(receipt),{crypto:webcrypto,indexedDB:e.indexedDB});
   const then=hooks.reconciled;hooks.reconciled=null;return then?then(r):r;
  },
  measurementUnits:()=>own(M.UNITS)};
}
function server(script,seen){
 return (url,init)=>{
  if(url==='/api/session')return json({build:'PRIVATE-PILOT-4',model:'model-x',speechModel:'speech-x',online:true,prototype:true,remainingRequests:60,token:TOKEN,reason:null});
  if(url!=='/api/assist')throw Error('unexpected request '+url);
  const body=JSON.parse(init.body);seen.push(body);
  const next=script.shift();if(!next)throw Error('unexpected extra /api/assist request');
  return next(body);
 };
}
async function open(e,job,script){
 const seen=[],hooks={};
 const p=await H.load({jobs:[{head:job.head,revision:job.revision}],bridge:bridge(e,hooks),api:server(script,seen)});
 p.els['job-target'].value=job.head.jobId;await p.els['job-target'].onchange();await H.settle();assert.equal(p.run('workspaceMeta.targetJobId'),job.head.jobId);
 return Object.assign(p,{seen,hooks});
}
const noteAnswer=(text,quote)=>body=>{
 const j=body.assistant.job;assert.ok(j,'the request names the selected job');
 return json(H.assistAnswer(body,{domain:'job_note',reply:'Propozycja notatki czeka na przegląd.',assistant:{actionProposal:{kind:'ec.assist.jobNoteAppend',version:1,proposalId:'a'.repeat(64),committed:false,requiresUserReview:true,
  target:{jobId:j.jobId,baseRevisionId:j.revisionId,baseRevisionNumber:j.revisionNumber},append:{text,separator:j.notesLength?'\n\n':'',baseNotesLength:j.notesLength,resultingNotesLength:j.notesLength+(j.notesLength?2:0)+text.length},evidence:{sourceQuote:quote},modelAuthored:['append.text']}}}));
};
// The time is exactly the device clock that travelled with the request, and its instant by the original measurement model.
const measurementAnswer=(quote,unitQuote)=>body=>{
 const j=body.assistant.job,c=body.assistant.clock;assert.ok(j&&c,'job and clock travel together');
 const fields={label:'L1-N',quantity:'voltage',valueText:'121.4',unit:'V',location:'panel A',measuredLocal:c.local,utcOffset:c.utcOffset,mode:'AC',instrument:'',notes:''};
 return json(H.assistAnswer(body,{domain:'job_measurement',reply:'Propozycja pomiaru czeka na przegląd.',assistant:{actionProposal:{kind:'ec.assist.jobMeasurementCreate',version:1,proposalId:'b'.repeat(64),committed:false,requiresUserReview:true,
  target:{jobId:j.jobId,jobRevisionId:j.revisionId,jobRevisionNumber:j.revisionNumber},fields,measuredAt:M.observedInstant(c.local,c.utcOffset),timeOrigin:'client_clock',evidence:{sourceQuote:quote,unitQuote},modelAuthored:['label','quantity','mode']}}}));
};
const assistant=p=>p.bank().contexts.find(x=>x.contextId===p.active()).envelope.assistant;
const pendingNow=p=>p.run('ASession.pending(assistantMeta)');
const said=p=>p.els['action-status'].textContent;
const fill=(p,id,value)=>{const el=p.find(id);assert.ok(el,'field #'+id);el.value=value;el.oninput();};
// The acknowledgement of a REAL confirmed write is lost: the page hears "pending, outcome unknown".
const lostAck=r=>{assert.equal(r.status,'confirmed','the adapter really wrote the record');return {ok:false,status:'pending',code:'INTERRUPTED',problems:['Acknowledgement lost.'],stored:null,receipt:{...r.receipt,state:'pending'}};};
const receiptRefused=(k,v)=>k===H.KEY&&!v.includes('"phase":"pending"')&&v.includes('"state":"confirmed"');
// What the reviewed build still held after a resume: the plan id remembered from the earlier "not stored" check. Put back by hand to
// show that hostActionRelease itself does not trust it (a button of an old render, or any future path that forgets to withdraw it).
const rememberOldProof=p=>p.run('hostActionChecked=assistantMeta.action.plan.id');

// Common start: a reviewed proposal is confirmed, the pending plan is stored, but the first commitAction never reaches the adapter
// and answers "pending, nothing stored". "Sprawdź w robocie" then reads the real history: not stored — release is offered.
async function unwritten(e,job,kind='note'){
 const p=await open(e,job,[kind==='note'?noteAnswer('Neutral bar torque checked.','neutral bar torque checked'):measurementAnswer('121.4 V','V')]);
 await send(p,kind==='note'?'zapisz notatkę: neutral bar torque checked przy tablicy A':'pomiar L1-N 121.4 V AC w panel A');
 if(kind==='note')fill(p,'action-note',NOTE);
 await p.click('action-review');assert.ok(p.find('action-confirm'),said(p));
 p.hooks.skip=plan=>{const mark=A.pendingReceipt(plan);assert.equal(mark.ok,true);return {ok:false,status:'pending',code:'UNAVAILABLE',problems:['Job storage did not start. Nothing was saved.'],stored:false,receipt:mark.receipt};};
 await p.click('action-confirm');
 assert.equal(p.hooks.commits,1);assert.equal(p.hooks.adapter||0,0,'the first commit never reached the adapter');
 assert.equal(pendingNow(p),true);assert.equal(assistant(p).action.phase,'pending');assert.match(said(p),/w robocie niczego nie zapisano/);
 assert.equal((await revisions(e,job.head.jobId)).length,1);assert.equal((await readings(e,job.head.jobId)).length,0);
 assert.equal(p.find('action-release'),null,'no release before the history was asked');
 await p.click('action-check');
 assert.equal(p.hooks.reconciles,1);assert.match(said(p),/tego zapisu w niej nie ma/);assert.equal(pendingNow(p),true);
 const release=p.find('action-release');assert.ok(release&&!release.disabled,'a current "not stored" answer offers the release');
 assert.equal(p.run('hostActionChecked'),assistant(p).action.plan.id);
 return p;
}

test('positive control: nothing was written and the history says so NOW — release drops the plan, keeps the proposal, and the same review is then written exactly once',async()=>{
 const e=env(),job=await seedJob(e),p=await unwritten(e,job);
 await p.click('action-release');
 assert.equal(p.hooks.reconciles,2,'the release asked the history again itself');
 assert.match(said(p),RELEASED);assert.match(said(p),ABSENT);
 assert.equal(pendingNow(p),false);assert.equal(assistant(p).action,null);assert.equal(assistant(p).receipts.length,0);
 assert.equal(assistant(p).proposal.note,NOTE,'the reviewed proposal stays for a new review');assert.equal(p.run('hostActionChecked'),'');
 assert.equal((await revisions(e,job.head.jobId)).length,1);assert.equal(p.hooks.adapter||0,0);
 assert.equal(p.find('action-release'),null);assert.equal(p.els.send.disabled,false,'the conversation is no longer frozen');
 await p.click('action-review');assert.ok(p.find('action-confirm'),said(p));
 await p.click('action-confirm');
 const all=await revisions(e,job.head.jobId);
 assert.equal(all.length,2);assert.equal(all[1].notes,'First visit.\n\n'+NOTE);assert.match(said(p),/Zapisano notatkę/);
 assert.equal(assistant(p).receipts.length,1);assert.equal(assistant(p).action,null);assert.equal(assistant(p).proposal,null);assert.deepEqual(p.hooks.heard,['confirmed']);
});

test('P1 note: "not stored" was checked, then resume really writes and loses its acknowledgement — release is gone and inert; the check finds the record; one note, one receipt',async()=>{
 const e=env(),job=await seedJob(e),p=await unwritten(e,job),oldButton=p.find('action-release'),planId=assistant(p).action.plan.id;
 p.hooks.after=lostAck;
 await p.click('action-resume');
 assert.deepEqual(p.hooks.heard,['confirmed'],'the adapter wrote the record on resume');
 assert.equal((await revisions(e,job.head.jobId)).length,2,'the record is in the job; only the answer was lost');
 assert.equal(pendingNow(p),true);assert.equal(assistant(p).action.plan.id,planId,'the same plan stays pending');assert.match(said(p),/nie wiadomo, czy robota go przyjęła/);
 // The earlier "not stored" answer is no longer offered as a reason to drop the plan…
 assert.equal(p.find('action-release'),null,'release is not offered after a write attempt');assert.equal(p.run('hostActionChecked'),'');
 // …and the button of the earlier render does nothing: no history read, no change, no message of a release.
 const reads=p.hooks.reconciles;
 await oldButton.onclick();await H.settle();
 assert.equal(p.hooks.reconciles,reads,'inert: not even a read');assert.equal(pendingNow(p),true);assert.equal(assistant(p).action.plan.id,planId);
 assert.ok(!RELEASED.test(said(p))&&!ABSENT.test(said(p)),said(p));
 await p.click('action-check');
 assert.match(said(p),/ten zapis jest w robocie/);assert.equal(pendingNow(p),false);
 const stored=assistant(p),all=await revisions(e,job.head.jobId);
 assert.equal(stored.action,null);assert.equal(stored.proposal,null);assert.equal(stored.receipts.length,1);assert.equal(stored.receipts[0].planId,planId);assert.equal(stored.receipts[0].state,'confirmed');
 assert.equal(stored.receipts[0].record.revisionId,all[1].revisionId);
 assert.equal(all.length,2,'exactly one new revision');assert.equal(all[1].notes,'First visit.\n\n'+NOTE,'the note is in the job once');
 assert.equal(p.hooks.adapter,1,'one real write, never a second');
});

test('P1 note: even with the old remembered answer in place, release reads the history again under the lock — the record is found, the receipt is stored, nothing is released',async()=>{
 const e=env(),job=await seedJob(e),p=await unwritten(e,job),oldButton=p.find('action-release'),planId=assistant(p).action.plan.id;
 p.hooks.after=lostAck;
 await p.click('action-resume');
 assert.equal((await revisions(e,job.head.jobId)).length,2);assert.equal(pendingNow(p),true);
 rememberOldProof(p);const reads=p.hooks.reconciles;
 await oldButton.onclick();await H.settle();
 assert.equal(p.hooks.reconciles,reads+1,'the release asked the history itself');
 assert.match(said(p),/Nie zwolniono planu/);assert.match(said(p),/zawiera ten zapis/);assert.ok(!RELEASED.test(said(p))&&!ABSENT.test(said(p)),said(p));
 const stored=assistant(p);
 assert.equal(pendingNow(p),false);assert.equal(stored.action,null);assert.equal(stored.proposal,null,'the written proposal is not offered for a second review');
 assert.equal(stored.receipts.length,1);assert.equal(stored.receipts[0].planId,planId);
 const all=await revisions(e,job.head.jobId);
 assert.equal(all.length,2);assert.equal(all[1].notes,'First visit.\n\n'+NOTE);assert.equal(p.hooks.adapter,1);assert.equal(p.find('action-review'),null);
});

test('P1 measurement: the same order for a reading — one reading in the job, never released as "not stored", receipt in the end',async()=>{
 const e=env(),job=await seedJob(e),p=await unwritten(e,job,'measurement'),oldButton=p.find('action-release'),planId=assistant(p).action.plan.id;
 p.hooks.after=lostAck;
 await p.click('action-resume');
 assert.equal((await readings(e,job.head.jobId)).length,1,'the reading is stored; only the answer was lost');
 assert.equal(pendingNow(p),true);assert.equal(p.find('action-release'),null);
 await oldButton.onclick();await H.settle();
 assert.equal(pendingNow(p),true);assert.ok(!RELEASED.test(said(p))&&!ABSENT.test(said(p)),said(p));
 rememberOldProof(p);
 await oldButton.onclick();await H.settle();
 assert.match(said(p),/Nie zwolniono planu/);assert.ok(!RELEASED.test(said(p))&&!ABSENT.test(said(p)),said(p));
 const stored=assistant(p),held=await readings(e,job.head.jobId);
 assert.equal(pendingNow(p),false);assert.equal(stored.action,null);assert.equal(stored.proposal,null);
 assert.equal(stored.receipts.length,1);assert.equal(stored.receipts[0].planId,planId);assert.equal(stored.receipts[0].record.store,'measurement');
 assert.equal(held.length,1,'exactly one reading');assert.equal(held[0].current.measurementId,stored.receipts[0].record.id);
 assert.equal((await revisions(e,job.head.jobId)).length,1,'a reading does not change the job card');assert.equal(p.hooks.adapter,1);
});

test('P1 receipt refused: resume writes and is confirmed, the browser refuses the receipt — the plan stays, release is gone, a forced release keeps the plan and tells the truth; later one receipt',async()=>{
 const e=env(),job=await seedJob(e),p=await unwritten(e,job),oldButton=p.find('action-release'),planId=assistant(p).action.plan.id;
 p.local.refuse=receiptRefused;
 await p.click('action-resume');
 assert.deepEqual(p.hooks.heard,['confirmed']);assert.equal((await revisions(e,job.head.jobId)).length,2);
 assert.match(said(p),/Zapis jest w robocie, ale jego potwierdzenie nie zostało utrwalone/);
 assert.equal(pendingNow(p),true);assert.equal(assistant(p).action.phase,'pending');assert.equal(assistant(p).action.plan.id,planId);assert.equal(assistant(p).receipts.length,0);
 assert.equal(p.find('action-release'),null,'release is not offered after a write attempt');
 // The fresh read finds the record; the receipt is refused again. Marker, proposal and job stay exactly as they are.
 rememberOldProof(p);
 await oldButton.onclick();await H.settle();
 assert.match(said(p),/Zapis jest w robocie, ale jego potwierdzenie nie zostało utrwalone/);assert.match(said(p),/nie został zwolniony/);
 assert.ok(!RELEASED.test(said(p))&&!ABSENT.test(said(p)),said(p));
 assert.equal(pendingNow(p),true);assert.equal(assistant(p).action.phase,'pending');assert.equal(assistant(p).action.plan.id,planId);assert.equal(assistant(p).proposal.note,NOTE);
 assert.equal(p.run('hostActionChecked'),'');assert.equal(p.find('action-release'),null);
 assert.equal((await revisions(e,job.head.jobId)).length,2,'the job is not touched by a failed receipt');
 // The same for "Sprawdź w robocie" while the browser still refuses.
 await p.click('action-check');
 assert.match(said(p),/Zapis jest w robocie, ale jego potwierdzenie nie zostało utrwalone/);assert.equal(pendingNow(p),true);assert.equal(p.find('action-release'),null);
 p.local.refuse=null;
 await p.click('action-check');
 const stored=assistant(p),all=await revisions(e,job.head.jobId);
 assert.equal(pendingNow(p),false);assert.equal(stored.receipts.length,1);assert.equal(stored.receipts[0].planId,planId);assert.equal(stored.action,null);
 assert.equal(all.length,2);assert.equal(all[1].notes,'First visit.\n\n'+NOTE);assert.equal(p.hooks.adapter,1);
});

test('P1 unknown read: after "not stored", a history that cannot be read withdraws the release — by the button itself and by a later check; nothing is dropped',async()=>{
 const e=env(),job=await seedJob(e),p=await unwritten(e,job),planId=assistant(p).action.plan.id;
 // The release button is pressed while the job storage does not answer: the real adapter reports "unknown", so nothing is released.
 e.fault=true;
 await p.click('action-release');
 e.fault=false;
 assert.match(said(p),/Nie zwolniono planu/);assert.match(said(p),/nie udało się teraz odczytać historii roboty/);assert.ok(!RELEASED.test(said(p))&&!ABSENT.test(said(p)),said(p));
 assert.equal(pendingNow(p),true);assert.equal(assistant(p).action.plan.id,planId);assert.equal(assistant(p).action.phase,'pending');
 assert.equal(p.find('action-release'),null,'the old answer is withdrawn');assert.equal(p.run('hostActionChecked'),'');
 // A readable history offers it again; a later check that cannot read withdraws it again.
 await p.click('action-check');
 assert.ok(p.find('action-release'),said(p));
 const oldButton=p.find('action-release');
 e.fault=true;
 await p.click('action-check');
 assert.match(said(p),/Nie udało się teraz sprawdzić historii roboty/);
 assert.equal(p.find('action-release'),null,'unknown never keeps an earlier "not stored"');assert.equal(p.run('hostActionChecked'),'');
 const reads=p.hooks.reconciles;
 await oldButton.onclick();await H.settle();
 e.fault=false;
 assert.equal(p.hooks.reconciles,reads,'the button of the earlier render is inert');
 assert.equal(pendingNow(p),true);assert.equal(assistant(p).action.plan.id,planId);assert.equal(assistant(p).proposal.note,NOTE);
 assert.equal((await revisions(e,job.head.jobId)).length,1);assert.equal(p.hooks.adapter||0,0);
 // The plan is still usable: resume writes it once.
 await p.click('action-resume');
 assert.match(said(p),/Zapisano notatkę/);assert.equal((await revisions(e,job.head.jobId)).length,2);assert.equal(assistant(p).receipts.length,1);
});

test('P1 changed while the release was reading: another tab finishes the same plan in that gap — this tab releases nothing and overwrites nothing',async()=>{
 const e=env(),job=await seedJob(e),p=await unwritten(e,job),planId=assistant(p).action.plan.id;
 let gap=0;
 p.hooks.reconciled=async r=>{
  gap++;
  // What this tab's read really saw, before the other tab acted: not stored.
  assert.equal(r.status,'pending');assert.equal(r.code,'NOT_STORED');assert.equal(r.stored,false);
  // The other tab: resumes the stored plan through the real adapter and stores the confirmed receipt in the conversation.
  const raw=p.local.getItem(H.KEY),bank=CBank.parse(raw),entry=CBank.get(bank,p.active()),x=entry.envelope.assistant.action;
  const done=await A.commit(own(x.plan),own(x.input),{accepted:true,planId:x.plan.id},{crypto:webcrypto,indexedDB:e.indexedDB,locks:e.locks,persistPending:async()=>true});
  assert.equal(done.status,'confirmed',JSON.stringify(done));
  const envelope=own(entry.envelope);envelope.assistant=AS.done(envelope.assistant,done.receipt);
  const next=CBank.commit(bank,{contextId:entry.contextId,baseVersion:entry.version,input:entry.input,now:new Date().toISOString(),envelope});
  CBank.store(p.local,H.KEY,next.bank,raw);
  return r;
 };
 await p.click('action-release');
 assert.equal(gap,1);
 assert.ok(!RELEASED.test(said(p))&&!ABSENT.test(said(p)),said(p));assert.match(said(p),/zmienił się w innej karcie/);
 // The stored conversation is exactly what the other tab wrote: its receipt, no pending plan, nothing released or overwritten.
 const stored=assistant(p),all=await revisions(e,job.head.jobId);
 assert.equal(stored.action,null);assert.equal(stored.proposal,null);assert.equal(stored.receipts.length,1);assert.equal(stored.receipts[0].planId,planId);
 assert.equal(all.length,2);assert.equal(all[1].notes,'First visit.\n\n'+NOTE);
 assert.equal(p.run('hostActionChecked'),'');assert.equal(p.hooks.adapter||0,0,'this tab wrote nothing to the job');
});
