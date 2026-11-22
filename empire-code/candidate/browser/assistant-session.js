'use strict';
// Assistant metadata of ONE conversation and the pure client rules of the `ec.assist` protocol (docs/assistant-api-contract.md).
// No DOM, storage, network, clock or randomness. Loaded before conversation-bank.js / ui.js, which consume it.
//
// The metadata is the OPTIONAL `assistant` member of a stored conversation envelope ({state,undo,diffs,workspace[,assistant]}).
// An envelope without it is exactly the earlier layout and stays valid; the member is written only when it holds something.
//   tool      the active calculator draft: exactly {tool,input,origins,fingerprint}. INPUT ONLY. No result, number or text of a
//             result is ever stored: a result is recomputed by the registry in the local tools frame every time it is shown.
//   proposal  one note / measurement proposed for the conversation's job, as the user last reviewed or corrected it. Not written.
//   action    the durable plan of a confirmed write: {phase,plan,input,receipt}. 'pending' = the write was started and is not yet
//             acknowledged in this conversation; it blocks edits, archive, delete and import until it is reconciled.
//   receipts  confirmed job-action receipts (identities and hashes only), never removed.
// Everything here is application data. Model output reaches it only through response(), which accepts a closed shape.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ASession=api;})(typeof window==='object'?window:globalThis,function(){
 const VERSION=1,PROTOCOL='ec.assist';
 const LIMITS=Object.freeze({receipts:24,toolChars:150000,planChars:120000,inputChars:160000,metaChars:480000,sourceText:3000,noteText:4000,changed:64});
 const DOMAINS=Object.freeze(['calculator','navigation','materials','job_note','job_measurement','clarification']);
 const ORIGINS=['conversation','current_form'],REPLY_ORIGINS=['deterministic','deterministic_with_model_question','model_text'];
 const MEASUREMENT_FIELDS=Object.freeze(['label','quantity','valueText','unit','location','measuredLocal','utcOffset','mode','instrument','notes']);
 // Bounds only. Which quantity / unit pairs, values and times are acceptable is decided by the original job modules when the
 // write is prepared; no unit list is copied here.
 const FIELD_MAX={label:160,quantity:40,valueText:64,unit:16,location:500,measuredLocal:16,utcOffset:6,mode:16,instrument:200,notes:4000};
 const TOOL_ID=/^[a-z][a-z0-9_]{1,47}$/,FIELD_ID=/^[A-Za-z][A-Za-z0-9_]{0,63}$/,FINGERPRINT=/^ct1-[0-9a-f]{16}-[0-9a-f]{1,8}$/;
 const JOB_ID=/^job1_[0-9a-f]{32}$/,JOB_REV=/^jrev1_[0-9a-f]{32}$/,SOURCE_ID=/^conv1_[0-9a-f]{32}$/,PLAN_ID=/^jact1_[0-9a-f]{32}$/,HASH=/^[0-9a-f]{64}$/;
 const RECORD_ID=/^(?:job1|meas1)_[0-9a-f]{32}$/,RECORD_REV=/^(?:jrev1|mrev1)_[0-9a-f]{32}$/;
 const PLAN_KIND='empire-code.job-action-plan',RECEIPT_KIND='empire-code.job-action-receipt';
 const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/,UNSAFE=['__proto__','constructor','prototype'];
 const META_KEYS=['version','tool','proposal','action','receipts'];
 const PROPOSAL_KEYS=['kind','proposalId','savedAt','sourceRevision','sourceText','job','note','fields','edited'];

 const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const exact=(o,keys)=>plain(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
 const clone=v=>JSON.parse(JSON.stringify(v));
 const utc=x=>{try{return typeof x==='string'&&new Date(x).toISOString()===x;}catch{return false;}};
 const text=(v,max,min=0)=>typeof v==='string'&&v.length<=max&&v.trim().length>=min&&!CONTROL.test(v);
 const whole=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
 const size=v=>{try{return JSON.stringify(v).length;}catch{return Infinity;}};
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 // Bounded plain JSON without reserved field names.
 function jsonSafe(v,depth=0){
  if(v===null||typeof v==='boolean'||typeof v==='string')return true;
  if(typeof v==='number')return Number.isFinite(v);
  if(depth>24)return false;
  if(Array.isArray(v))return v.every(x=>jsonSafe(x,depth+1));
  return plain(v)&&Object.keys(v).every(k=>!UNSAFE.includes(k)&&jsonSafe(v[k],depth+1));
 }
 const bad=what=>{throw Object.assign(Error('Nieprawidłowe dane asystenta rozmowy ('+what+'). Niczego nie nadpisano.'),{code:'ASSISTANT'});};

 // The four members the server accepts and returns as `toolDraft`. Field values are validated by the registry, not here.
 function toolValid(t){
  if(!exact(t,['tool','input','origins','fingerprint'])||typeof t.tool!=='string'||!TOOL_ID.test(t.tool)||typeof t.fingerprint!=='string'||!FINGERPRINT.test(t.fingerprint))return false;
  if(!plain(t.input)||!plain(t.origins)||!jsonSafe(t.input))return false;
  const keys=Object.keys(t.input);
  if(keys.length>LIMITS.changed||Object.keys(t.origins).length!==keys.length||!keys.every(k=>FIELD_ID.test(k)&&ORIGINS.includes(t.origins[k])))return false;
  return size(t)<=LIMITS.toolChars;
 }
 function fieldsValid(f){return exact(f,MEASUREMENT_FIELDS)&&MEASUREMENT_FIELDS.every(k=>text(f[k],FIELD_MAX[k]));}
 const jobRef=j=>exact(j,['jobId','revisionId','revisionNumber'])&&typeof j.jobId==='string'&&JOB_ID.test(j.jobId)&&typeof j.revisionId==='string'&&JOB_REV.test(j.revisionId)&&whole(j.revisionNumber,1,1e9);
 function proposalValid(p){
  if(!exact(p,PROPOSAL_KEYS)||(p.kind!=='note'&&p.kind!=='measurement')||typeof p.proposalId!=='string'||!HASH.test(p.proposalId)||!utc(p.savedAt)||!whole(p.sourceRevision,0,100))return false;
  if(!text(p.sourceText,LIMITS.sourceText,1)||!jobRef(p.job)||typeof p.edited!=='boolean')return false;
  return p.kind==='note'?p.fields===null&&text(p.note,LIMITS.noteText,1):p.note===null&&fieldsValid(p.fields);
 }
 // docs/conversation-job-actions.md section 5, exactly.
 function receiptValid(r){
  if(!exact(r,['kind','version','state','planId','action','sourceId','sourceRevision','sourceFingerprint','inputHash','jobId','jobRevisionId','record'])||r.kind!==RECEIPT_KIND||r.version!==1)return false;
  if(!['pending','confirmed','conflict'].includes(r.state)||typeof r.planId!=='string'||!PLAN_ID.test(r.planId)||(r.action!=='note'&&r.action!=='measurement'))return false;
  if(typeof r.sourceId!=='string'||!SOURCE_ID.test(r.sourceId)||!whole(r.sourceRevision,0,100)||![r.sourceFingerprint,r.inputHash].every(h=>typeof h==='string'&&HASH.test(h)))return false;
  if(typeof r.jobId!=='string'||!JOB_ID.test(r.jobId)||typeof r.jobRevisionId!=='string'||!JOB_REV.test(r.jobRevisionId))return false;
  const x=r.record;
  return exact(x,['store','id','revisionId','recordHash','journalPlanId'])&&x.store===(r.action==='note'?'job-card':'measurement')&&typeof x.id==='string'&&RECORD_ID.test(x.id)
   &&typeof x.revisionId==='string'&&RECORD_REV.test(x.revisionId)&&typeof x.recordHash==='string'&&HASH.test(x.recordHash)&&x.journalPlanId===null; // always null since the adapter writes readings through the original measurement store
 }
 // Top level of the plan and of its input exactly as documented (sections 2 and 4). `record` and `job` are the adapter's own
 // data: kept verbatim as bounded plain JSON and judged only by the adapter (validatePlan / commit), never interpreted here.
 function actionValid(a){
  if(!exact(a,['phase','plan','input','receipt'])||(a.phase!=='pending'&&a.phase!=='conflict'))return false;
  const p=a.plan,x=a.input,r=a.receipt;
  if(!exact(p,['kind','version','id','action','binding','job','record'])||p.kind!==PLAN_KIND||p.version!==1||typeof p.id!=='string'||!PLAN_ID.test(p.id)||(p.action!=='note'&&p.action!=='measurement'))return false;
  if(!exact(p.binding,['inputHash','sourceFingerprint','sourceId','sourceRevision','sourceSavedAt'])||!exact(p.job,['jobId','jobRevisionId','revisionNumber'])||!plain(p.record)||!jsonSafe(p.record)||size(p)>LIMITS.planChars)return false;
  if(!exact(x,['sourceId','sourceRevision','sourceSavedAt','sourceText','job','action'])||typeof x.sourceId!=='string'||!SOURCE_ID.test(x.sourceId)||!whole(x.sourceRevision,0,100)||!utc(x.sourceSavedAt)||!text(x.sourceText,LIMITS.sourceText,1))return false;
  if(!exact(x.job,['head','revision'])||!plain(x.job.head)||!plain(x.job.revision)||!jsonSafe(x.job)||size(x)>LIMITS.inputChars)return false;
  const act=x.action;
  if(!(p.action==='note'?exact(act,['kind','text'])&&act.kind==='note'&&text(act.text,LIMITS.noteText,1):exact(act,['kind','fields'])&&act.kind==='measurement'&&fieldsValid(act.fields)))return false;
  if(!receiptValid(r)||r.state!==a.phase||r.planId!==p.id||r.action!==p.action||r.sourceId!==x.sourceId||r.sourceRevision!==x.sourceRevision)return false;
  const b=p.binding;
  return b.sourceId===x.sourceId&&b.sourceRevision===x.sourceRevision&&b.sourceSavedAt===x.sourceSavedAt&&b.inputHash===r.inputHash&&b.sourceFingerprint===r.sourceFingerprint
   &&p.job.jobId===r.jobId&&p.job.jobRevisionId===r.jobRevisionId&&x.job.head.jobId===r.jobId;
 }
 // Strict check of a whole metadata object; returns an independent copy. `context` ties it to its conversation:
 // {sourceId,sourceRevision,jobId} of the envelope's workspace binding (null members when the conversation has none).
 function validate(a,context){
  if(!exact(a,META_KEYS)||a.version!==VERSION)bad('nieznany układ');
  if(a.tool!==null&&!toolValid(a.tool))bad('kalkulator');
  if(a.proposal!==null&&!proposalValid(a.proposal))bad('propozycja zapisu do roboty');
  if(a.action!==null&&!actionValid(a.action))bad('rozpoczęty zapis do roboty');
  if(!Array.isArray(a.receipts)||a.receipts.length>LIMITS.receipts||!a.receipts.every(r=>receiptValid(r)&&r.state==='confirmed'))bad('potwierdzenia zapisów');
  if(new Set(a.receipts.map(r=>r.record.store+'/'+r.record.id+'/'+r.record.revisionId)).size!==a.receipts.length||new Set(a.receipts.map(r=>r.planId)).size!==a.receipts.length)bad('powtórzone potwierdzenie');
  const p=a.proposal,x=a.action;
  if(x){
   if(!p||a.receipts.some(r=>r.planId===x.plan.id))bad('zapis bez propozycji albo już potwierdzony');
   const i=x.input;
   if(i.sourceText!==p.sourceText||i.sourceSavedAt!==p.savedAt||i.sourceRevision!==p.sourceRevision||i.action.kind!==p.kind||x.receipt.jobId!==p.job.jobId||(p.kind==='note'?i.action.text!==p.note:!same(MEASUREMENT_FIELDS.map(k=>i.action.fields[k]),MEASUREMENT_FIELDS.map(k=>p.fields[k]))))bad('zapis niezgodny z propozycją');
  }
  if(context){
   const bound=typeof context.sourceId==='string';
   if((p||x||a.receipts.length)&&(!bound||typeof context.jobId!=='string'))bad('zapis do roboty bez powiązania rozmowy');
   if(p&&(p.job.jobId!==context.jobId||(Number.isSafeInteger(context.sourceRevision)&&p.sourceRevision>context.sourceRevision)))bad('propozycja innej roboty lub wersji');
   if(x&&x.input.sourceId!==context.sourceId)bad('zapis innej rozmowy');
   if(a.receipts.some(r=>r.sourceId!==context.sourceId||r.jobId!==context.jobId))bad('potwierdzenie innej rozmowy lub roboty');
  }
  if(size(a)>LIMITS.metaChars)bad('limit rozmiaru');
  return clone(a);
 }
 const contextOf=workspace=>({sourceId:workspace?workspace.sourceId:null,sourceRevision:workspace?workspace.sourceRevision:null,jobId:workspace?workspace.targetJobId:null});

 // --- Transitions. Each returns a NEW validated object, or null when nothing is left to store. ---------------------------
 const empty=()=>({version:VERSION,tool:null,proposal:null,action:null,receipts:[]});
 const blank=a=>!a||(!a.tool&&!a.proposal&&!a.action&&!a.receipts.length);
 const pending=a=>!!(a&&a.action&&a.action.phase==='pending');
 const frozen=a=>!!(a&&a.action);
 const open=a=>a?validate(a):empty();
 const tidy=m=>{const v=validate(m);return blank(v)?null:v;};
 const busy=m=>{if(m.action)throw Object.assign(Error('W tej rozmowie jest rozpoczęty albo sporny zapis do roboty. Najpierw go dokończ.'),{code:'PENDING'});};
 function withTool(a,tool){const m=open(a);m.tool=tool===null?null:clone(tool);return tidy(m);}
 // One unwritten proposal per conversation, and it is never replaced silently: while one is held, ANY new proposal of the server
 // is refused — also one with the same proposalId — so the held proposal, its saved corrections and the fields the user is
 // editing stay exactly as they are. The slot is freed only by the user: the proposal is written (done), cancelled (dropProposal)
 // or its conflict is closed (dismiss). editProposal and every turn without a proposal are not affected.
 const PROPOSAL_HELD='W tej rozmowie czeka już propozycja zapisu do roboty, która nie została jeszcze zapisana. Nowa propozycja jej nie zastąpiła i niczego nie zapisano. Najpierw przejrzyj i zapisz tamtą propozycję albo ją odrzuć („Odrzuć propozycję”), a potem wyślij tę wypowiedź ponownie — Twój tekst pozostaje w polu.';
 function withProposal(a,proposal){
  const m=open(a);busy(m);
  if(m.proposal)throw Object.assign(Error(PROPOSAL_HELD),{code:'PROPOSAL_HELD'});
  m.proposal=clone(proposal);return tidy(m);
 }
 // A correction by the user, or a review against a newer job revision: the proposal becomes a new reviewed version with a new time.
 function editProposal(a,change,now){
  const m=open(a);busy(m);if(!m.proposal)bad('brak propozycji');
  const p=m.proposal;
  if(change.note!==undefined)p.note=change.note;
  if(change.fields!==undefined)p.fields=clone(change.fields);
  if(change.job!==undefined)p.job=clone(change.job);
  if(change.note!==undefined||change.fields!==undefined)p.edited=true;
  p.savedAt=now;return tidy(m);
 }
 function dropProposal(a){const m=open(a);busy(m);m.proposal=null;return tidy(m);}
 function enter(a,plan,input,receipt){
  const m=open(a);busy(m);
  if(!m.proposal)bad('brak propozycji');
  if(m.receipts.length>=LIMITS.receipts)throw Object.assign(Error('Ta rozmowa osiągnęła limit '+LIMITS.receipts+' zapisów do roboty. Niczego nie zapisano; zacznij nową rozmowę.'),{code:'LIMIT'});
  m.action={phase:'pending',plan:clone(plan),input:clone(input),receipt:clone(receipt)};return tidy(m);
 }
 function done(a,receipt){
  const m=open(a);
  if(!m.action||!receiptValid(receipt)||receipt.state!=='confirmed'||receipt.planId!==m.action.plan.id||!same(receipt.record,m.action.receipt.record))bad('potwierdzenie innego zapisu');
  m.receipts.push(clone(receipt));m.action=null;m.proposal=null;return tidy(m);
 }
 function conflict(a,receipt){
  const m=open(a);
  if(!m.action||!receiptValid(receipt)||receipt.state!=='conflict'||receipt.planId!==m.action.plan.id)bad('konflikt innego zapisu');
  m.action.phase='conflict';m.action.receipt=clone(receipt);return tidy(m);
 }
 // The history was checked and holds nothing of this plan: the marker goes, the proposal stays for a new review.
 function release(a){const m=open(a);if(!m.action)bad('brak rozpoczętego zapisu');m.action=null;return tidy(m);}
 // Closes a conflict the user has seen. A pending write is never dismissed.
 function dismiss(a){const m=open(a);if(pending(m))busy(m);m.action=null;m.proposal=null;return tidy(m);}

 // --- Protocol ------------------------------------------------------------------------------------------------------------
 function baseFingerprint(revision,draft,form,job){
  return 'ab1/r'+revision+'/d:'+(draft?draft.tool+'@'+draft.fingerprint:'-')+'/f:'+(form?form.tool+'@'+form.fingerprint:'-')+'/j:'+(job?job.jobId+'@'+job.revisionId:'-');
 }
 // Device time of `date` in the form the server validates (jobMeasurement.observedInstant).
 function clock(date){
  const two=n=>String(n).padStart(2,'0'),offset=-date.getTimezoneOffset(),abs=Math.abs(offset);
  return {local:String(date.getFullYear()).padStart(4,'0')+'-'+two(date.getMonth()+1)+'-'+two(date.getDate())+'T'+two(date.getHours())+':'+two(date.getMinutes()),utcOffset:(offset<0?'-':'+')+two(Math.floor(abs/60))+':'+two(abs%60)};
 }
 // The UTC instant named by a clock exactly as clock() writes it ({local:'YYYY-MM-DDTHH:MM',utcOffset:'+/-HH:MM'}), or null for
 // anything else. Read by the built-in Date from the ISO date-time with that offset — no time-zone arithmetic of its own; the
 // server derives the same instant from the same two strings (jobMeasurement.observedInstant: local minutes at the offset, as UTC).
 function clockInstant(c){
  if(!exact(c,['local','utcOffset'])||typeof c.local!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(c.local)||typeof c.utcOffset!=='string'||!/^[+-]\d\d:\d\d$/.test(c.utcOffset))return null;
  try{const d=new Date(c.local+':00.000'+c.utcOffset);return Number.isFinite(d.getTime())?d.toISOString():null;}catch{return null;}
 }
 // {jobId,revisionId,revisionNumber,notesLength} of a job read from the original store, or null when it cannot be told.
 function jobSnapshot(job){
  const h=job&&job.head,r=job&&job.revision;
  if(!plain(h)||!plain(r)||typeof h.jobId!=='string'||!JOB_ID.test(h.jobId)||typeof h.currentRevisionId!=='string'||!JOB_REV.test(h.currentRevisionId)||r.revisionId!==h.currentRevisionId||!whole(r.revisionNumber,1,1e9)||typeof r.notes!=='string')return null;
  return {jobId:h.jobId,revisionId:h.currentRevisionId,revisionNumber:r.revisionNumber,notesLength:r.notes.length};
 }
 // The closed request body of POST /api/assist. o: {requestId,text,state,lang,contextToken,toolDraft,form,job,clock}.
 function request(o){
  const draft=o.toolDraft||null,form=o.form||null,job=o.job||null;
  return {protocol:PROTOCOL,version:1,requestId:o.requestId,text:o.text,state:o.state,assistant:{lang:o.lang,contextToken:o.contextToken,baseFingerprint:baseFingerprint(o.state.revision,draft,form,job),toolDraft:draft,form,job,clock:o.clock||null}};
 }
 const STALE='Nieaktualna propozycja. Szkic nie został zmieniony.';
 const refuse=why=>{throw Object.assign(Error(STALE),{code:'ASSIST_RESPONSE',detail:why});};
 function noteProposal(v,sent){
  if(!exact(v,['kind','version','proposalId','committed','requiresUserReview','target','append','evidence','modelAuthored'])||v.kind!=='ec.assist.jobNoteAppend')refuse('proposal');
  const t=v.target,job=sent.assistant.job;
  if(!exact(t,['jobId','baseRevisionId','baseRevisionNumber'])||!job||t.jobId!==job.jobId||t.baseRevisionId!==job.revisionId||t.baseRevisionNumber!==job.revisionNumber)refuse('proposal.target');
  if(!exact(v.append,['text','separator','baseNotesLength','resultingNotesLength'])||!text(v.append.text,LIMITS.noteText,1)||!exact(v.evidence,['sourceQuote'])||typeof v.evidence.sourceQuote!=='string'||!v.evidence.sourceQuote||!sent.text.includes(v.evidence.sourceQuote))refuse('proposal.append');
  return {kind:'note',proposalId:v.proposalId,job:{jobId:job.jobId,revisionId:job.revisionId,revisionNumber:job.revisionNumber},note:v.append.text,fields:null};
 }
 function measurementProposal(v,sent){
  if(!exact(v,['kind','version','proposalId','committed','requiresUserReview','target','fields','measuredAt','timeOrigin','evidence','modelAuthored'])||v.kind!=='ec.assist.jobMeasurementCreate')refuse('proposal');
  const t=v.target,job=sent.assistant.job;
  if(!exact(t,['jobId','jobRevisionId','jobRevisionNumber'])||!job||t.jobId!==job.jobId||t.jobRevisionId!==job.revisionId||t.jobRevisionNumber!==job.revisionNumber)refuse('proposal.target');
  if(!fieldsValid(v.fields)||!utc(v.measuredAt)||v.timeOrigin!=='client_clock'||!exact(v.evidence,['sourceQuote','unitQuote'])||![v.evidence.sourceQuote,v.evidence.unitQuote].every(q=>typeof q==='string'&&q&&sent.text.includes(q)))refuse('proposal.fields');
  // 'client_clock' is a claim about THIS request: the proposed time must be exactly the device clock that was sent with it, and
  // measuredAt the instant of that clock. A request without a clock, a malformed clock, another local time, another offset or
  // another instant is refused as a whole. (Only the incoming proposal is judged; the user may still correct the time in review.)
  const c=sent.assistant.clock,at=clockInstant(c);
  if(at===null||v.fields.measuredLocal!==c.local||v.fields.utcOffset!==c.utcOffset||v.measuredAt!==at)refuse('proposal.fields');
  return {kind:'measurement',proposalId:v.proposalId,job:{jobId:job.jobId,revisionId:job.revisionId,revisionNumber:job.revisionNumber},note:null,fields:clone(v.fields)};
 }
 // Reads a 200 answer against the request body that was sent (contract section 4, rules 1, 2 and 5, plus the closed shape of
 // every member this client uses). Rules 3 and 4 need the CURRENT context and are applied by the caller. Throws on any mismatch;
 // nothing of a refused answer is used. The returned `result` is untrusted display data: the caller recomputes it locally.
 function response(r,sent){
  if(!plain(r)||r.protocol!==PROTOCOL||r.version!==1)refuse('protocol');
  if(r.requestId!==sent.requestId)refuse('requestId');
  if(r.baseRevision!==sent.state.revision)refuse('baseRevision');
  const s=sent.assistant,b=r.base;
  if(!exact(b,['materialRevision','fingerprint','contextToken'])||b.materialRevision!==sent.state.revision||b.fingerprint!==s.baseFingerprint||b.contextToken!==s.contextToken)refuse('base');
  if(!DOMAINS.includes(r.domain)||!plain(r.state)||r.state.revision!==r.baseRevision+1||typeof r.reply!=='string'||typeof r.question!=='string'||!Array.isArray(r.diffs))refuse('envelope');
  const a=r.assistant;
  if(!exact(a,['lang','replyOrigin','historyReplyTruncated','toolDraft','changedFields','result','actionProposal','navigation','clarification'])||a.lang!==s.lang||!REPLY_ORIGINS.includes(a.replyOrigin)||typeof a.historyReplyTruncated!=='boolean')refuse('assistant');
  if(a.toolDraft!==null&&!toolValid(a.toolDraft))refuse('toolDraft');
  if(!Array.isArray(a.changedFields)||a.changedFields.length>LIMITS.changed||!a.changedFields.every(k=>typeof k==='string'&&FIELD_ID.test(k)))refuse('changedFields');
  if(a.result!==null&&!plain(a.result))refuse('result');
  const calc=r.domain==='calculator';
  if(r.domain!=='materials'){
   // A turn outside the material domain never changes the list, and its text is application text, never model text.
   if(a.replyOrigin==='model_text'||r.diffs.length||!same(r.state.items,sent.state.items))refuse('materials');
  }
  if(calc){if(!a.toolDraft||!a.result||a.result.tool!==a.toolDraft.tool||a.result.inputFingerprint!==a.toolDraft.fingerprint)refuse('calculator');}
  // Any other turn returns the incoming draft unchanged; the caller keeps its own copy of it, never the echoed one.
  else if(!(a.toolDraft===null?s.toolDraft===null:!!s.toolDraft&&a.toolDraft.tool===s.toolDraft.tool&&a.toolDraft.fingerprint===s.toolDraft.fingerprint))refuse('toolDraft changed');
  let proposal=null;
  if(r.domain==='job_note'||r.domain==='job_measurement'){
   const v=a.actionProposal;
   if(!plain(v)||v.version!==1||typeof v.proposalId!=='string'||!HASH.test(v.proposalId)||v.committed!==false||v.requiresUserReview!==true||!Array.isArray(v.modelAuthored))refuse('proposal');
   proposal=r.domain==='job_note'?noteProposal(v,sent):measurementProposal(v,sent);
  }else if(a.actionProposal!==null)refuse('proposal');
  let navigation=null;
  if(r.domain==='navigation'){if(!plain(a.navigation)||typeof a.navigation.tool!=='string'||!TOOL_ID.test(a.navigation.tool))refuse('navigation');navigation={tool:a.navigation.tool,executableHere:a.navigation.executableHere===true};}
  else if(a.navigation!==null)refuse('navigation');
  if(a.clarification!==null&&!plain(a.clarification))refuse('clarification');
  return {domain:r.domain,state:r.state,diffs:r.diffs,reply:r.reply,tool:a.toolDraft,changedFields:calc?a.changedFields.slice():[],result:calc?a.result:null,proposal,navigation,
   clarification:a.clarification?String(a.clarification.reason||''):'',durationMs:typeof r.durationMs==='number'&&Number.isFinite(r.durationMs)?r.durationMs:0};
 }

 // --- Registry facade -------------------------------------------------------------------------------------------------------
 // `win` is the window that holds the built core (the same-origin tools frame). The registry accepts only plain objects of its
 // own realm, so every argument is re-created there and every answer is copied back. Returns null when the registry is absent:
 // nothing is then computed, assumed or shown as a result.
 function registry(win){
  let T=null;try{T=win&&win.EC&&win.EC.conversationTools;}catch{T=null;}
  if(!T||!['createDraft','importFormInput','execute','verifyResult','getTool'].every(k=>typeof T[k]==='function')||typeof T.DRAFT_KIND!=='string')return null;
  const J=win.JSON&&typeof win.JSON.parse==='function'?win.JSON:JSON;
  const own=x=>J.parse(JSON.stringify(x)),back=x=>JSON.parse(J.stringify(x));
  const four=d=>({tool:d.tool,input:d.input,origins:d.origins,fingerprint:d.fingerprint});
  const full=(d,result)=>own({kind:T.DRAFT_KIND,revision:T.CONTRACT_REVISION,tool:d.tool,input:d.input,origins:d.origins,fingerprint:d.fingerprint,result:result||null,resultFingerprint:result?d.fingerprint:null});
  return {
   // Runs the canonical engine for a stored draft. {ok,result,errors}
   run(d){const r=T.execute(full(d));return back({ok:r.ok===true,result:r.ok?r.result:null,errors:r.errors||[]});},
   // Re-runs the draft and says whether `stored` (untrusted) equals the fresh result. {ok,current,reason,result,errors}
   verify(d,stored){const r=T.verifyResult(full(d,stored));return back({ok:r.ok===true,current:r.current===true,reason:r.reason||null,result:r.result||null,errors:r.errors||[]});},
   // A NEW draft of `tool` holding exactly the given current-form input (origin current_form). {ok,draft,errors}
   importForm(tool,formInput){
    const made=T.createDraft(tool);if(!made.ok)return back({ok:false,draft:null,errors:made.errors||[]});
    const m=T.importFormInput(made.draft,own(formInput));return back({ok:m.ok===true,draft:m.ok?four(m.draft):null,errors:m.errors||[]});
   },
   // Catalogue entry (titles, field labels, units, questions) or null.
   tool(id){const t=T.getTool(id);return t?back(t):null;}
  };
 }
 return {VERSION,PROTOCOL,LIMITS,DOMAINS,MEASUREMENT_FIELDS,STALE,validate,contextOf,toolValid,receiptValid,empty,blank,pending,frozen,withTool,withProposal,editProposal,dropProposal,enter,done,conflict,release,dismiss,baseFingerprint,clock,jobSnapshot,request,response,registry};
});
