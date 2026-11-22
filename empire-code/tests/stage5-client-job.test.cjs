'use strict';
// Stage 5 client: a note or a measurement proposed in the conversation, reviewed, confirmed by a button and written to the selected
// job through the REAL adapter (core/src/jobs/jobConversationActions.js) and the original job stores, on the existing IndexedDB
// test double. The page scripts run in the stage2 VM harness; the Jobs bridge of the fixture exposes the same members as
// candidate/browser/workspace/host-core.js. The server is a fixture: every proposal is a hand-written answer in the documented
// shape. Storage evidence is simulated; nothing here shows native durability or that a model understands speech.
// Authored, not executed by the author. Run: node --test tests/
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
// T0: when the fixture job was created — well before any time this test run can read from the clock.
const TOKEN='ef'.repeat(32),T0='2020-01-15T09:00:00.000Z';
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const own=x=>JSON.parse(JSON.stringify(x));
const until=async(check,ms=4000)=>{const end=Date.now()+ms;for(;;){if(check())return;if(Date.now()>end)throw Error('condition not reached');await H.settle(2);}};
const idle=p=>until(()=>!p.run('busy')&&!p.run('audioBusy')&&!p.run('handoffBusy'));
const send=async(p,text)=>{await p.type(text);await p.submit();await idle(p);};
// The simulated databases of the original stores, created on first open like in a browser.
function env(){
 const dbs={};let tail=Promise.resolve();
 const indexedDB={open(name,version){if(!dbs[name])dbs[name]=makeIndexedDb(name);return dbs[name].indexedDB.open(name,version);}};
 const locks={request(name,opts,fn){const call=tail.then(()=>fn());tail=call.catch(()=>{});return call;}};
 return {dbs,indexedDB,locks};
}
async function seedJob(e,savedAt=T0){
 const store=createJobStore(e.indexedDB,{crypto:deterministicCrypto(1),now:()=>savedAt});
 const made=await store.create({title:'Panel upgrade',address:'12 Main Street',notes:'First visit.'},[]);store.close();
 assert.equal(made.ok,true,JSON.stringify(made));return made.job;
}
// A later ordinary edit of the card by the user, through the original store, at the real current time.
async function editJob(e,jobId,notes){
 const store=createJobStore(e.indexedDB,{crypto:deterministicCrypto(500),now:()=>new Date().toISOString()});
 const now=await store.read(jobId),r=now.job.revision,saved=await store.save(jobId,r.revisionId,{title:r.title,address:r.address,notes},[]);store.close();
 assert.equal(saved.ok,true,JSON.stringify(saved));return saved.job;
}
async function revisions(e,jobId){
 const store=createJobStore(e.indexedDB,{}),h=await store.history(jobId);store.close();
 assert.equal(h.ok,true,JSON.stringify(h));return h.revisions.slice().sort((a,b)=>a.revisionNumber-b.revisionNumber);
}
async function readings(e,jobId){
 const store=createMeasurementStore(e.indexedDB,{crypto:webcrypto}),r=await store.list(jobId);if(typeof store.close==='function')store.close();
 assert.equal(r.ok,true,JSON.stringify(r));return JSON.stringify(r);
}
// The members host-core.js adds to ecHostBridge, backed by the real adapter. hooks: {commits, after(result)} to observe or
// replace what the page hears from one commit (a lost acknowledgement).
function bridge(e,hooks){
 return {
  read:async id=>{const s=createJobStore(e.indexedDB,{}),r=await s.read(id);s.close();return r;},
  prepareAction:input=>A.prepare(own(input),{crypto:webcrypto}),
  pendingAction:plan=>A.pendingReceipt(own(plan)),
  commitAction:async(plan,input,confirmation,persistPending)=>{
   hooks.commits=(hooks.commits||0)+1;
   const r=await A.commit(own(plan),own(input),own(confirmation),{crypto:webcrypto,indexedDB:e.indexedDB,locks:e.locks,persistPending});
   const after=hooks.after;hooks.after=null;return after?after(r):r;
  },
  reconcileAction:receipt=>A.reconcile(own(receipt),{crypto:webcrypto,indexedDB:e.indexedDB}),
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
// One page with the job selected for its conversation (a new conversation of that job), or a reload on the same storage.
async function open(e,job,script,o={}){
 const seen=[],hooks=o.hooks||{};
 const p=await H.load({local:o.local,session:o.session,jobs:o.noJob?[]:[{head:job.head,revision:job.revision}],bridge:bridge(e,hooks),api:server(script,seen)});
 if(!o.local&&!o.noJob){p.els['job-target'].value=job.head.jobId;await p.els['job-target'].onchange();await H.settle();assert.equal(p.run('workspaceMeta.targetJobId'),job.head.jobId);}
 return Object.assign(p,{seen,hooks});
}
const noteAnswer=(text,quote)=>body=>{
 const j=body.assistant.job;assert.ok(j,'the request names the selected job');
 return json(H.assistAnswer(body,{domain:'job_note',reply:'Propozycja notatki czeka na przegląd.',assistant:{actionProposal:{kind:'ec.assist.jobNoteAppend',version:1,proposalId:'a'.repeat(64),committed:false,requiresUserReview:true,
  target:{jobId:j.jobId,baseRevisionId:j.revisionId,baseRevisionNumber:j.revisionNumber},append:{text,separator:j.notesLength?'\n\n':'',baseNotesLength:j.notesLength,resultingNotesLength:j.notesLength+(j.notesLength?2:0)+text.length},evidence:{sourceQuote:quote},modelAuthored:['append.text']}}}));
};
// The answer body of a measurement proposal with the given fields and instant, whatever they are (also ones the contract forbids).
const measurementBody=(body,fields,measuredAt,quote,unitQuote)=>{
 const j=body.assistant.job;
 return H.assistAnswer(body,{domain:'job_measurement',reply:'Propozycja pomiaru czeka na przegląd.',assistant:{actionProposal:{kind:'ec.assist.jobMeasurementCreate',version:1,proposalId:'b'.repeat(64),committed:false,requiresUserReview:true,
  target:{jobId:j.jobId,jobRevisionId:j.revisionId,jobRevisionNumber:j.revisionNumber},fields,measuredAt,timeOrigin:'client_clock',evidence:{sourceQuote:quote,unitQuote},modelAuthored:['label','quantity','mode']}}});
};
const reading=(clock,patch)=>({label:'L1-N',quantity:'voltage',valueText:'121.4',unit:'V',location:'panel A',measuredLocal:clock.local,utcOffset:clock.utcOffset,mode:'AC',instrument:'',notes:'',...patch});
// As the contract says: the time is exactly the clock sent with the request, the instant is derived from it by the original model.
const measurementAnswer=(patch,quote,unitQuote)=>body=>{
 const j=body.assistant.job,c=body.assistant.clock;assert.ok(j&&c,'job and clock travel together');
 return json(measurementBody(body,reading(c,patch),M.observedInstant(c.local,c.utcOffset),quote,unitQuote));
};
const clarify=body=>json(H.assistAnswer(body,{domain:'clarification',reply:'Zapis do roboty wymaga przeglądu i potwierdzenia przyciskiem.',assistant:{clarification:{reason:'approval_request',topic:null,modelQuestionUsed:false}}}));
const assistant=p=>p.bank().contexts.find(x=>x.contextId===p.active()).envelope.assistant;
const pendingNow=p=>p.run('ASession.pending(assistantMeta)');
const said=p=>p.els['action-status'].textContent;
const fill=(p,id,value)=>{const el=p.find(id);assert.ok(el,'field #'+id);el.value=value;el.oninput();};
const NOTE='Neutral bar torque checked at panel A.';
async function proposeNote(e,job,o){
 const p=await open(e,job,[noteAnswer('Neutral bar torque checked.','neutral bar torque checked'),clarify,clarify],o);
 await send(p,'zapisz notatkę: neutral bar torque checked przy tablicy A');
 return p;
}
async function reviewed(e,job,o){const p=await proposeNote(e,job,o);fill(p,'action-note',NOTE);await p.click('action-review');assert.ok(p.find('action-confirm'),said(p));return p;}

test('note: proposed, corrected, reviewed and confirmed by the button — appended once to the selected job; a typed "yes" writes nothing',async()=>{
 const e=env(),job=await seedJob(e),p=await proposeNote(e,job);
 // Only identity, revision and notes length of the job travel; never its content.
 assert.deepEqual(p.seen[0].assistant.job,{jobId:job.head.jobId,revisionId:job.head.currentRevisionId,revisionNumber:job.revision.revisionNumber,notesLength:job.revision.notes.length});
 assert.match(p.seen[0].assistant.clock.local,/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);assert.match(p.seen[0].assistant.clock.utcOffset,/^[+-]\d\d:\d\d$/);
 for(const secret of ['First visit','12 Main Street','Panel upgrade'])assert.ok(!JSON.stringify(p.seen[0]).includes(secret),secret);
 assert.match(p.seen[0].assistant.baseFingerprint,new RegExp('/j:'+job.head.jobId+'@'+job.head.currentRevisionId+'$'));
 assert.equal(p.els['action-panel'].hidden,false);assert.match(p.text('action-body'),/Panel upgrade/);assert.match(p.text('action-body'),/neutral bar torque checked przy tablicy A/);
 assert.equal((await revisions(e,job.head.jobId)).length,1,'a proposal writes nothing');
 await send(p,'tak, zapisz to');
 assert.equal((await revisions(e,job.head.jobId)).length,1,'words never confirm a write');assert.equal(p.run('assistantMeta.proposal.kind'),'note');
 fill(p,'action-note',NOTE);await p.click('action-review');
 assert.match(p.text('action-body'),/Neutral bar torque checked at panel A\./);assert.equal(assistant(p).proposal.note,NOTE);assert.equal(assistant(p).proposal.edited,true);
 assert.equal((await revisions(e,job.head.jobId)).length,1,'a review writes nothing');assert.equal(p.hooks.commits||0,0);
 await p.click('action-confirm');
 const all=await revisions(e,job.head.jobId),last=all[all.length-1];
 assert.equal(all.length,2);assert.equal(last.notes,'First visit.\n\n'+NOTE,'existing notes are an exact prefix');assert.equal(last.title,'Panel upgrade');assert.equal(last.address,'12 Main Street');
 assert.match(said(p),/Zapisano notatkę/);assert.equal(p.hooks.commits,1);
 const stored=assistant(p);
 assert.equal(stored.proposal,null);assert.equal(stored.action,null);assert.equal(stored.receipts.length,1);
 assert.equal(stored.receipts[0].state,'confirmed');assert.equal(stored.receipts[0].record.store,'job-card');assert.equal(stored.receipts[0].record.revisionId,last.revisionId);
 assert.ok(!JSON.stringify(stored).includes(NOTE),'the receipt holds identities and hashes, not the text');
 assert.equal(p.find('action-confirm'),null);assert.equal(p.els.send.disabled,false);
 // Deleting the conversation keeps its receipts with the deletion record; a file is restorable only with exactly those receipts.
 const bank=p.bank(),entry=bank.contexts.find(x=>x.contextId===p.active()),file=CBank.portable(bank,entry.contextId,{exportedAt:H.T});
 const gone=CBank.retire(bank,{contextId:entry.contextId,baseVersion:entry.version,now:H.T});
 assert.deepEqual(gone.tombstone.actions,stored.receipts);
 assert.equal(CBank.inspect(JSON.stringify(file),gone.bank,{now:H.T}).restorable,true);
 const fewer=own(file);fewer.entry.envelope.assistant.receipts=[];
 const verdict=CBank.inspect(JSON.stringify(fewer),gone.bank,{now:H.T});
 assert.equal(verdict.outcome,'retired');assert.equal(verdict.restorable,false);assert.match(verdict.reason,/notatek i pomiarów/);
 assert.throws(()=>CBank.commit(bank,{contextId:entry.contextId,baseVersion:entry.version,input:'',now:H.T,envelope:fewer.entry.envelope}),x=>x.code==='INVALID','a receipt never disappears from a stored conversation');
});

test('no room for the pending plan: the job is not touched; after room is made the same review is confirmed once',async()=>{
 const e=env(),job=await seedJob(e),p=await reviewed(e,job);
 p.local.refuse=(k,v)=>k===H.KEY&&v.includes('"phase":"pending"');
 await p.click('action-confirm');
 assert.equal(p.hooks.commits||0,0,'the adapter is not called without the durable plan');assert.equal((await revisions(e,job.head.jobId)).length,1);
 assert.match(said(p),/Nie zapisano zmiany w przeglądarce/);assert.equal(pendingNow(p),false);assert.equal(assistant(p).action,null);
 p.local.refuse=null;
 await p.click('action-confirm');
 assert.equal((await revisions(e,job.head.jobId)).length,2);assert.match(said(p),/Zapisano notatkę/);assert.equal(assistant(p).receipts.length,1);
});

test('lost acknowledgement: the plan stays pending and blocks the conversation; a reload reconciles it without a second record',async()=>{
 const e=env(),job=await seedJob(e),p=await reviewed(e,job);
 p.hooks.after=r=>({ok:false,status:'pending',code:'INTERRUPTED',problems:['Acknowledgement lost.'],stored:null,receipt:{...r.receipt,state:'pending'}});
 await p.click('action-confirm');
 assert.equal((await revisions(e,job.head.jobId)).length,2,'the record was written; only the answer was lost');
 assert.match(said(p),/nie został potwierdzony/);assert.ok(!/Zapisano notatkę/.test(said(p)),'never "saved" without the durable acknowledgement');
 assert.equal(pendingNow(p),true);assert.equal(assistant(p).action.phase,'pending');assert.equal(assistant(p).receipts.length,0);
 // Pending blocks sending, archive, delete, import and every other change of the stored conversation.
 assert.equal(p.els.send.disabled,true);assert.equal(p.els['job-target'].disabled,true);assert.equal(p.els['conversation-select'].disabled,true);
 const manage=op=>p.run("(()=>{try{bankManage(activeContextId,b=>CBank."+op+"(b,{contextId:activeContextId,baseVersion:activeVersion,now:new Date().toISOString()}));return 'done';}catch(e){return e.message;}})()");
 assert.match(manage('archive'),/dokończ/i);assert.match(manage('retire'),/dokończ/i);
 const bank=p.bank(),entry=bank.contexts.find(x=>x.contextId===p.active());
 assert.throws(()=>CBank.archive(bank,{contextId:entry.contextId,baseVersion:entry.version,now:H.T}),x=>x.code==='PENDING');
 assert.equal(CBank.inspect(JSON.stringify(CBank.portable(bank,entry.contextId,{exportedAt:H.T})),CBank.empty(),{now:H.T}).outcome,'blocked');
 const swapped=own(entry.envelope);swapped.assistant.action.plan.id='jact1_'+'9'.repeat(32);
 assert.throws(()=>CBank.commit(bank,{contextId:entry.contextId,baseVersion:entry.version,input:'',now:H.T,envelope:swapped}),x=>x.code==='INVALID');
 // A new document on the same storage asks the history of the job before anything else and finds the record.
 const q=await open(e,job,[],{local:p.local,session:p.session});
 await until(()=>!pendingNow(q));await idle(q);
 assert.equal(assistant(q).receipts.length,1);assert.equal(assistant(q).action,null);assert.match(said(q),/ten zapis jest w robocie/);
 assert.equal(q.hooks.commits||0,0,'reconciling writes nothing');assert.equal((await revisions(e,job.head.jobId)).length,2,'no duplicate');
});

test('receipt not stored after the real write: the truth is told, the plan is kept and a retry reconciles without a duplicate',async()=>{
 const e=env(),job=await seedJob(e),p=await reviewed(e,job);
 p.local.refuse=(k,v)=>k===H.KEY&&!v.includes('"phase":"pending"')&&v.includes('"state":"confirmed"');
 await p.click('action-confirm');
 assert.equal((await revisions(e,job.head.jobId)).length,2);
 assert.match(said(p),/Zapis jest w robocie, ale jego potwierdzenie nie zostało utrwalone/);assert.equal(pendingNow(p),true);assert.equal(assistant(p).action.phase,'pending');
 p.local.refuse=null;
 await p.click('action-resume');
 assert.match(said(p),/Zapisano notatkę/);assert.match(said(p),/niczego nie dopisano drugi raz/);
 assert.equal((await revisions(e,job.head.jobId)).length,2,'no duplicate');assert.equal(assistant(p).receipts.length,1);assert.equal(pendingNow(p),false);assert.equal(p.hooks.commits,2);
});

test('job edited after the review: nothing is written until it is reviewed again; the record carries the time of that later review',async()=>{
 const e=env(),job=await seedJob(e),p=await reviewed(e,job),first=assistant(p).proposal.savedAt;
 await H.settle(2);
 const edited=await editJob(e,job.head.jobId,'First visit.\nEdited by hand.');
 await p.click('action-confirm');
 assert.match(said(p),/zmieniła się po przeglądzie/);assert.equal(p.hooks.commits||0,0);assert.equal((await revisions(e,job.head.jobId)).length,2,'only the manual edit');
 assert.equal(pendingNow(p),false);assert.equal(p.find('action-confirm'),null,'the old review cannot be confirmed');
 await H.settle(2);await p.click('action-review');
 const again=assistant(p).proposal;
 assert.ok(again.savedAt>first&&again.savedAt>=edited.revision.savedAt,'the proposal was saved again, after the edit');assert.equal(again.job.revisionId,edited.head.currentRevisionId);
 await p.click('action-confirm');
 const all=await revisions(e,job.head.jobId),last=all[all.length-1];
 assert.equal(all.length,3);assert.equal(last.notes,'First visit.\nEdited by hand.\n\n'+NOTE);assert.equal(last.savedAt,again.savedAt);assert.ok(last.savedAt>=all[1].savedAt,'never dated before its parent');
});

test('measurement: value corrected in review, one reading created; cancel is inert; without the job on the device writes are disabled',async()=>{
 const e=env(),job=await seedJob(e);
 const p=await open(e,job,[measurementAnswer({},'121.4 V','V'),noteAnswer('Sprawdzić uziom.','sprawdzić uziom')]);
 await send(p,'pomiar L1-N 121.4 V AC w panel A');
 assert.equal(p.find('action-valueText').value,'121.4');assert.equal(p.find('action-unit').value,'V');assert.equal(p.find('action-location').value,'panel A');
 assert.ok(!(await readings(e,job.head.jobId)).includes('121.4'),'a proposal writes nothing');
 // A wrong value is refused by the job model at review, in the user's words; nothing is written.
 fill(p,'action-valueText','sto dwadzieścia');await p.click('action-review');
 assert.match(said(p),/liczbę z kropką/);assert.equal(p.find('action-confirm'),null);
 fill(p,'action-valueText','120.9');fill(p,'action-location','panel A, zaciski główne');await p.click('action-review');
 assert.match(p.text('action-body'),/120\.9 V/);
 await p.click('action-confirm');
 const stored=await readings(e,job.head.jobId);
 assert.ok(stored.includes('120.9')&&stored.includes('panel A, zaciski główne')&&!stored.includes('121.4'),'the reviewed values are stored, not the proposed ones');
 assert.match(said(p),/Zapisano pomiar/);assert.equal(assistant(p).receipts[0].record.store,'measurement');assert.equal((await revisions(e,job.head.jobId)).length,1,'a reading does not change the job card');
 // A second proposal, exported for another device, then cancelled here.
 await send(p,'notatka: sprawdzić uziom przy liczniku');
 await p.click('export');const archive=p.downloads[p.downloads.length-1];
 await p.click('action-cancel');
 assert.equal(assistant(p).proposal,null);assert.match(said(p),/Odrzucono propozycję/);assert.equal(p.hooks.commits,1);assert.equal((await revisions(e,job.head.jobId)).length,1);
 // Another browser without that job: the conversation is readable, the proposal is shown, nothing can be written.
 const other=env(),far=await open(other,job,[],{noJob:true});
 await far.click('manage-open');await far.choose(archive);
 assert.match(far.text('import-preview'),/propozycja notatki lub pomiaru do przeglądu/);assert.match(far.text('import-preview'),/potwierdzenia notatek i pomiarów zapisanych do roboty: 1/);
 await far.click('import-apply');
 await far.run("hostExclusive(()=>{switchContext('"+JSON.parse(archive).entry.contextId+"');render();})");await H.settle();
 assert.match(far.text('action-body'),/sprawdzić uziom przy liczniku/);assert.match(far.text('action-body'),/nie istnieje na tym urządzeniu/);
 assert.equal(far.find('action-review').disabled,true);assert.equal(far.find('action-cancel').disabled,false);
 await far.run('hostActionPrepare()');await far.run('hostActionCommit()');await H.settle();
 assert.equal(far.hooks.commits||0,0);assert.equal(JSON.parse(far.run('JSON.stringify(assistantMeta.receipts)')).length,1,'the imported receipt stays with the conversation');
});

test('import refuses malformed job-action metadata as a whole',async()=>{
 const e=env(),job=await seedJob(e),p=await reviewed(e,job);
 await p.click('action-confirm');await send(p,'tak');
 const archive=CBank.portable(p.bank(),p.active(),{exportedAt:H.T});
 const variants={
  'receipt of another conversation':a=>{a.receipts[0].sourceId='conv1_'+'7'.repeat(32);},
  'receipt of another job':a=>{a.receipts[0].jobId=H.ids.job(77);},
  'receipt with an unknown member':a=>{a.receipts[0].note='saved';},
  'receipt that is only pending':a=>{a.receipts[0].state='pending';},
  'duplicated receipt':a=>{a.receipts.push(own(a.receipts[0]));},
  'proposal for another job':a=>{a.proposal={kind:'note',proposalId:'c'.repeat(64),savedAt:H.T,sourceRevision:0,sourceText:'x',job:{jobId:H.ids.job(78),revisionId:'jrev1_'+'1'.repeat(32),revisionNumber:1},note:'x',fields:null,edited:false};},
  'proposal with an unknown member':a=>{a.proposal={kind:'note',proposalId:'c'.repeat(64),savedAt:H.T,sourceRevision:0,sourceText:'x',job:{jobId:job.head.jobId,revisionId:job.head.currentRevisionId,revisionNumber:1},note:'x',fields:null,edited:false,approved:true};},
  'action without a plan':a=>{a.action={phase:'conflict'};}};
 for(const [name,change] of Object.entries(variants)){
  const file=own(archive);change(file.entry.envelope.assistant);
  const other=await H.load({}),before=other.local.dump();
  await other.click('manage-open');await other.choose(JSON.stringify(file));
  const apply=other.find('import-apply');
  assert.ok(!apply||apply.disabled,name+': not applicable');assert.equal(other.local.dump(),before,name+': nothing stored');
 }
 // The unchanged file is accepted by a browser that does not hold the conversation.
 const clean=await H.load({});await clean.click('manage-open');await clean.choose(JSON.stringify(archive));
 assert.equal(clean.find('import-apply').disabled,false);
});

// --- Review fixes (client): clock binding of a proposed reading, one unwritten proposal per conversation, device clock behind the job.
// The recovery of a started write (release only on current proof) is in stage5-client-job-recovery.test.cjs.

test('measurement proposal labelled client_clock is accepted only with exactly the clock that was sent and its instant (pure)',()=>{
 const CLOCK={local:'2026-11-21T14:05',utcOffset:'+01:00'},AT='2026-11-21T13:05:00.000Z',TEXT='pomiar L1-N 121.4 V AC w panel A';
 const jobRef={jobId:H.ids.job(1),revisionId:'jrev1_'+'1'.repeat(32),revisionNumber:1,notesLength:12};
 const read=(clock,fields,at)=>{
  const sent=AS.request({requestId:'req-1',text:TEXT,state:H.blankState(),lang:'pl',contextToken:'ctx-test',toolDraft:null,form:null,job:jobRef,clock});
  return AS.response(measurementBody(sent,fields,at,'121.4 V','V'),sent);
 };
 assert.equal(M.observedInstant(CLOCK.local,CLOCK.utcOffset),AT,'the fixture instant is the one the original model derives');
 // Control: the sent clock and its instant, for several offsets (the instant always by the original model).
 const ok=read(CLOCK,reading(CLOCK),AT);
 assert.equal(ok.proposal.kind,'measurement');assert.equal(ok.proposal.fields.measuredLocal,CLOCK.local);assert.equal(ok.proposal.fields.utcOffset,CLOCK.utcOffset);
 for(const c of [{local:'2026-03-08T01:30',utcOffset:'-05:00'},{local:'2026-06-01T23:59',utcOffset:'+05:30'},{local:'2026-01-01T00:10',utcOffset:'+00:00'},{local:'2026-12-31T23:59',utcOffset:'-09:30'}]){
  const at=M.observedInstant(c.local,c.utcOffset);assert.ok(at,JSON.stringify(c));
  assert.equal(read(c,reading(c),at).proposal.fields.measuredLocal,c.local,JSON.stringify(c));
 }
 const refused=(name,clock,fields,at)=>assert.throws(()=>read(clock,fields,at),x=>x.code==='ASSIST_RESPONSE'&&x.detail==='proposal.fields'&&x.message===AS.STALE,name);
 refused('local time one hour later, with its own consistent instant',CLOCK,reading(CLOCK,{measuredLocal:'2026-11-21T15:05'}),M.observedInstant('2026-11-21T15:05','+01:00'));
 refused('local time one hour later, instant of the sent clock',CLOCK,reading(CLOCK,{measuredLocal:'2026-11-21T15:05'}),AT);
 refused('offset shifted, with its own consistent instant',CLOCK,reading(CLOCK,{utcOffset:'+02:00'}),M.observedInstant(CLOCK.local,'+02:00'));
 refused('offset shifted, instant of the sent clock',CLOCK,reading(CLOCK,{utcOffset:'+02:00'}),AT);
 refused('another local time and offset that name the same instant',CLOCK,reading(CLOCK,{measuredLocal:'2026-11-21T15:05',utcOffset:'+02:00'}),AT);
 refused('fields of the clock, instant one hour off (the local time read as UTC)',CLOCK,reading(CLOCK),'2026-11-21T14:05:00.000Z');
 refused('fields of the clock, instant one minute off',CLOCK,reading(CLOCK),'2026-11-21T13:06:00.000Z');
 refused('no clock was sent',null,reading(CLOCK),AT);
 // A clock that is not exactly what ASession.clock writes proves nothing, even when a lenient date parser would read it.
 const loose={local:CLOCK.local,utcOffset:'+0100'};
 refused('malformed clock: offset without a colon',loose,reading(loose),AT);
 refused('malformed clock: seconds',{local:'2026-11-21T14:05:00',utcOffset:'+01:00'},reading(CLOCK),AT);
 refused('malformed clock: an extra member',{...CLOCK,zone:'Europe/Warsaw'},reading(CLOCK),AT);
 refused('malformed clock: members that are not text',{local:20261121,utcOffset:60},reading(CLOCK),AT);
 const noDate={local:'2026-13-41T14:05',utcOffset:'+01:00'};
 refused('malformed clock: not a date',noDate,reading(noDate),AT);
});

test('measurement answer with a time that is not the sent device clock: refused as a whole — no proposal, draft and text unchanged; the contract answer is accepted',async()=>{
 const e=env(),job=await seedJob(e),TEXT='pomiar L1-N 121.4 V AC w panel A';
 // One hour later than the clock of the request, self-consistent (its instant is derived from the shifted time): a server that
 // deviates from the contract, not a malformed answer.
 const shifted=body=>{
  const c=body.assistant.clock,later=new Date(Date.parse(c.local+':00.000Z')+3600000).toISOString().slice(0,16);
  return json(measurementBody(body,reading(c,{measuredLocal:later}),M.observedInstant(later,c.utcOffset),'121.4 V','V'));
 };
 const p=await open(e,job,[shifted,measurementAnswer({},'121.4 V','V')]);
 const before=p.run('JSON.stringify(state)');
 await send(p,TEXT);
 assert.equal(p.seen.length,1);assert.match(p.els.status.textContent,/Nieaktualna propozycja/);assert.equal(p.els.status.className,'error');
 assert.equal(p.run('assistantMeta'),null,'no proposal is kept');assert.equal(p.run('JSON.stringify(state)'),before,'the draft is unchanged');
 const entry=p.bank().contexts.find(x=>x.contextId===p.active());assert.ok(!entry||!Object.hasOwn(entry.envelope,'assistant'),'nothing of the refused answer is stored');
 assert.equal(p.els.input.value,TEXT,'the unsent text stays');assert.equal(p.els['action-panel'].hidden,true);assert.equal(p.find('action-measuredLocal'),null);
 assert.equal((await readings(e,job.head.jobId)).includes('121.4'),false);assert.equal(p.hooks.commits||0,0);
 // Sent again by the user: the answer carries the clock of THAT request and is accepted.
 await p.submit();await idle(p);
 assert.equal(p.seen.length,2);assert.equal(p.run('assistantMeta.proposal.kind'),'measurement');
 assert.equal(p.find('action-measuredLocal').value,p.seen[1].assistant.clock.local);assert.equal(p.find('action-utcOffset').value,p.seen[1].assistant.clock.utcOffset);
 assert.equal(p.els.input.value,'');
});

test('one unwritten proposal per conversation (pure): a new proposal is refused while one is held — also the same one; corrections, a calculator draft and cancel are not blocked',()=>{
 const job={jobId:H.ids.job(1),revisionId:'jrev1_'+'1'.repeat(32),revisionNumber:1};
 const first={kind:'note',proposalId:'a'.repeat(64),savedAt:H.T,sourceRevision:0,sourceText:'zapisz notatkę: a',job,note:'a',fields:null,edited:false};
 const second={...first,proposalId:'c'.repeat(64),sourceText:'zapisz notatkę: b',note:'b'};
 const held=AS.withProposal(null,first),before=JSON.stringify(held);
 const refused=x=>x.code==='PROPOSAL_HELD'&&/czeka już propozycja zapisu do roboty/.test(x.message)&&/Odrzuć propozycję/.test(x.message)&&/nie zastąpiła/.test(x.message);
 assert.throws(()=>AS.withProposal(held,second),refused);
 assert.throws(()=>AS.withProposal(held,first),refused,'the same proposal id is no exception');
 assert.equal(JSON.stringify(held),before,'a refusal does not touch the held data');
 const corrected=AS.editProposal(held,{note:'a, poprawione'},'2026-11-01T10:05:00.000Z');
 assert.equal(corrected.proposal.note,'a, poprawione');assert.equal(corrected.proposal.edited,true);
 assert.throws(()=>AS.withProposal(corrected,second),refused,'a corrected proposal is protected as well');
 const tool={tool:'voltage_drop',input:{},origins:{},fingerprint:'ct1-'+'0'.repeat(16)+'-1'};
 const both=AS.withTool(corrected,tool);
 assert.deepEqual(both.proposal,corrected.proposal,'a calculator turn keeps the proposal');assert.deepEqual(both.tool,tool);
 assert.equal(AS.withProposal(AS.dropProposal(corrected),second).proposal.note,'b','cancel frees the slot');
 const next=AS.withProposal(AS.dropProposal(both),second);
 assert.equal(next.tool.tool,'voltage_drop');assert.equal(next.proposal.proposalId,'c'.repeat(64));
});

test('a second proposal never replaces an unwritten one: refused with the reason; the first proposal, its unsaved corrections, the draft and the new text stay; other turns and cancel work',async()=>{
 const e=env(),job=await seedJob(e),SECOND='notatka: sprawdzić uziom przy liczniku',second=noteAnswer('Sprawdzić uziom.','sprawdzić uziom');
 const p=await open(e,job,[noteAnswer('Neutral bar torque checked.','neutral bar torque checked'),second,body=>json(H.assistAnswer(body)),measurementAnswer({},'121.4 V','V'),second]);
 await send(p,'zapisz notatkę: neutral bar torque checked przy tablicy A');
 // Corrected in the field, not yet reviewed: this text exists only in the review form.
 fill(p,'action-note',NOTE);
 const held=own(assistant(p)),state=p.run('JSON.stringify(state)'),undo=p.run('JSON.stringify(undo)');
 assert.equal(held.proposal.note,'Neutral bar torque checked.');assert.equal(held.proposal.edited,false);
 await send(p,SECOND);
 assert.equal(p.seen.length,2,'the second request was answered with another proposal');
 assert.match(p.els.status.textContent,/czeka już propozycja zapisu do roboty/);assert.match(p.els.status.textContent,/nie zastąpiła/);assert.match(p.els.status.textContent,/Odrzuć propozycję/);assert.equal(p.els.status.className,'error');
 assert.deepEqual(assistant(p),held,'the stored proposal is exactly the first one');
 assert.deepEqual(JSON.parse(p.run('JSON.stringify(assistantMeta)')),held);assert.equal(p.run('assistantMeta.tool'),null);
 assert.equal(p.run('JSON.stringify(state)'),state,'draft and history are unchanged');assert.equal(p.run('JSON.stringify(undo)'),undo);
 assert.equal(p.els.input.value,SECOND,'the new utterance stays in the field');
 assert.equal(p.bank().contexts.find(x=>x.contextId===p.active()).input,SECOND,'and in the stored conversation as unsent text');
 assert.equal(p.find('action-note').value,NOTE,'the unsaved correction is still in the review form');
 assert.equal(JSON.parse(p.run('JSON.stringify(hostActionUnsaved())')).note,NOTE);
 assert.match(p.text('action-body'),/neutral bar torque checked przy tablicy A/);assert.ok(!/uziom/.test(p.text('action-body')),'nothing of the second proposal is shown');
 assert.equal(p.hooks.commits||0,0);assert.equal((await revisions(e,job.head.jobId)).length,1,'neither proposal was written');
 // A turn without a proposal (materials) is not blocked and leaves the held proposal and the form alone.
 const turns=p.run('state.history.length');
 await send(p,'dodaj 3 puszki 4x4');
 assert.equal(p.seen.length,3);assert.equal(p.run('state.history.length'),turns+2);assert.equal(p.els.input.value,'');
 assert.deepEqual(assistant(p).proposal,held.proposal);assert.equal(p.find('action-note').value,NOTE);
 // The explicit way out: cancel. The next proposal is then accepted — and is itself protected from the one after it.
 await p.click('action-cancel');
 assert.equal(p.run('assistantMeta'),null);assert.match(said(p),/Odrzucono propozycję/);
 await send(p,'pomiar L1-N 121.4 V AC w panel A');
 assert.equal(p.seen.length,4);assert.equal(p.run('assistantMeta.proposal.kind'),'measurement');assert.equal(p.find('action-valueText').value,'121.4');
 fill(p,'action-valueText','120.9');
 const reading2=own(assistant(p));
 await send(p,SECOND);
 assert.equal(p.seen.length,5);assert.match(p.els.status.textContent,/czeka już propozycja zapisu do roboty/);
 assert.deepEqual(assistant(p),reading2);assert.equal(p.run('assistantMeta.proposal.kind'),'measurement');assert.equal(p.find('action-valueText').value,'120.9');assert.equal(p.els.input.value,SECOND);
 assert.equal(p.hooks.commits||0,0);assert.equal((await revisions(e,job.head.jobId)).length,1);assert.equal((await readings(e,job.head.jobId)).includes('121.4'),false);
 // (A confirmed write frees the slot too: the measurement test above sends a note proposal after its reading was written.)
});

test('device clock behind the last save of the job: the review names the clock instead of asking for one more review; nothing is saved again or written',async()=>{
 const e=env(),job=await seedJob(e,'2099-01-01T00:00:00.000Z'),p=await proposeNote(e,job),held=own(assistant(p));
 await p.click('action-review');
 assert.match(said(p),/Zegar tego urządzenia/);assert.match(said(p),/datę i godzinę/);assert.ok(!/jeszcze raz/.test(said(p)),'no generic "review again"');
 assert.equal(p.find('action-confirm'),null);assert.deepEqual(assistant(p),held,'the proposal was not saved again');
 fill(p,'action-note',NOTE);await p.click('action-review');
 assert.match(said(p),/Zegar tego urządzenia/);assert.equal(p.find('action-confirm'),null);
 assert.deepEqual(assistant(p),held);assert.equal(p.find('action-note').value,NOTE,'the correction stays in the form');
 assert.equal(p.hooks.commits||0,0);assert.equal((await revisions(e,job.head.jobId)).length,1);
});
