'use strict';
// Per-job conversation bank: pure data rules plus one storage boundary.
// No DOM, network, model input, clock or crypto access. Identities and digests are supplied by the app, never by a model.
//
// Layout version 2. It is stored under the SAME key as the released version 1:
//   contexts  active conversations (LIMITS.perJob per job, LIMITS.contexts in total). Entry layout is exactly that of version 1.
//   archived  {archivedAt,entry}: reversible. Not counted in the two active limits; still counted in the size limit.
//   retired   compact records of explicitly deleted conversations (identity, last version, receipts). The payload is gone;
//             the record stops an old tab, an old file or the legacy import from bringing the conversation back unnoticed.
// A version 1 bank is accepted by read() only, entry for entry and byte for byte, and is rewritten in layout 2 by the app under
// its lock. A released version 1 client refuses a version 2 value (UNSUPPORTED) and therefore never overwrites it.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CBank=api;})(typeof window==='object'?window:globalThis,function(){
 const KEY='empire_code_conversation_bank_v1'; // one key for every layout; the layout is the `version` field of the stored value
 const LEGACY_KEY='empire_code_online1_draft'; // read for migration; its bytes are never written or removed by this module
 const KIND='empire-code.conversation-bank',VERSION=2;
 // Portable archive of ONE conversation: validated on export and on import. Raw recovery files are a different kind and are never imported.
 const ARCHIVE_KIND='empire-code.conversation-archive',ARCHIVE_VERSION=1;
 const RAW_KINDS=['empire-code.storage-recovery','empire-code.legacy-raw'],OLD_DRAFT_KIND='empire-code.conversation-draft';
 const LIMITS=Object.freeze({contexts:64,perJob:16,inputChars:3000,entryChars:700000,bankChars:4000000,archived:256,retired:1024,retiredChars:40000,importChars:3000000,recoveryTexts:256});
 const LAYOUT_ROOM=64; // layout 2 adds two list fields; a completely full version 1 bank must still fit after migration
 const CONTEXT_ID=/^ctx1_[0-9a-f]{32}$/,JOB_ID=/^job1_[0-9a-f]{32}$/,SHA256=/^[0-9a-f]{64}$/;
 const BANK_KEYS_V1=['kind','version','serial','legacy','contexts'];
 const BANK_KEYS=['kind','version','serial','legacy','contexts','archived','retired'];
 const LEGACY_KEYS=['contextId','importedAt','chars','sha256'];
 const ENTRY_KEYS=['contextId','jobId','version','created','touched','createdAt','updatedAt','input','envelope'];
 const ARCHIVED_KEYS=['archivedAt','entry'];
 const RETIRED_KEYS=['contextId','jobId','sourceId','sourceRevision','version','receipts','retiredAt','serial'];
 // Stage 5. A deleted conversation that held confirmed job-action receipts (notes / measurements written from the conversation)
 // keeps them verbatim under the optional `actions` member. A record without such receipts has exactly the keys above, so every
 // deletion record written before stage 5 stays valid byte for byte.
 const RETIRED_KEYS_ACTIONS=RETIRED_KEYS.concat('actions');
 const ACTION_RECEIPTS=24;
 const ARCHIVE_KEYS=['kind','version','exportedAt','origin','entry','unsentText','recovery'];
 const RECOVERY_KEYS=['text','savedAt','baseVersion'];
 const BINDING=['version','sourceId','sourceRevision','sourceSavedAt','boundState','targetJobId'];
 const RECEIPT=['jobId','itemId','materialId','revisionId'];
 const MANAGE=' Open “Manage chats”.';

 class BankError extends Error{constructor(code,message){super(message);this.name='BankError';this.code=code;}}
 const fail=(code,message)=>{throw new BankError(code,message);};
 const clone=v=>JSON.parse(JSON.stringify(v));
 const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const exact=(o,keys)=>plain(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
 const utc=x=>{try{return typeof x==='string'&&new Date(x).toISOString()===x;}catch{return false;}};
 const count=n=>Number.isSafeInteger(n)&&n>=0;
 // Deep equality of JSON values; object key order is irrelevant, array order is not.
 function same(a,b){
  if(a===b)return true;
  if(Array.isArray(a))return Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>same(x,b[i]));
  if(!plain(a)||!plain(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
 }

 // The envelope is the legacy {state,undo,diffs,workspace} object, kept verbatim. Only the parts the
 // bank itself relies on are checked here; the app applies its own stricter validators on activation.
 const workspaceOf=envelope=>plain(envelope.workspace)?envelope.workspace:null;
 function jobOf(envelope){const w=workspaceOf(envelope);return w&&w.targetJobId!=null?w.targetJobId:null;}
 function sourceOf(envelope){const w=workspaceOf(envelope);return w?w.sourceId:null;}
 // Optional assistant metadata of the envelope (assistant-session.js). Only what the bank itself relies on is read here: a started
 // job action, and the confirmed receipts. The application applies the strict validator (ASession.validate) on activation,
 // on every write of its own and on import.
 const assistantOf=envelope=>plain(envelope.assistant)?envelope.assistant:null;
 const actionOf=envelope=>{const a=assistantOf(envelope);return a&&plain(a.action)?a.action:null;};
 const actionReceipts=envelope=>{const a=assistantOf(envelope);return a&&Array.isArray(a.receipts)?a.receipts:[];};
 const actionPending=envelope=>{const x=actionOf(envelope);return !!(x&&x.phase==='pending');};
 function isPending(envelope){
  const w=workspaceOf(envelope);
  return !!(w&&(plain(w.prepared)&&w.prepared.phase==='pending'||plain(w.materialEdit)&&w.materialEdit.phase==='pending'))||actionPending(envelope);
 }
 function checkEnvelope(envelope,code){
  if(!plain(envelope)||!plain(envelope.state)||!Array.isArray(envelope.state.items)||!Array.isArray(envelope.state.history))fail(code,'Invalid chat draft.');
  if(envelope.workspace!=null&&!plain(envelope.workspace))fail(code,'Invalid chat link.');
  const w=workspaceOf(envelope);
  if(w&&(typeof w.sourceId!=='string'||!count(w.sourceRevision)||!Array.isArray(w.receipts)))fail(code,'Invalid chat identity.');
  // When the binding carries the bound state it must be exactly the stored state (the host binds JSON.stringify(state)).
  if(w&&w.boundState!==undefined&&w.boundState!==JSON.stringify(envelope.state))fail(code,'The chat link does not match the chat content.');
  const job=jobOf(envelope);
  if(job!==null&&(typeof job!=='string'||!JOB_ID.test(job)))fail(code,'Invalid job of the chat.');
  // The assistant member is optional. When present it is an object with a receipt list; a started or disputed job action carries
  // its plan identity. A job action or a receipt exists only in a conversation that has an identity and a job.
  if(Object.hasOwn(envelope,'assistant')){
   const a=envelope.assistant;
   if(!plain(a)||!Array.isArray(a.receipts)||a.receipts.length>ACTION_RECEIPTS||!a.receipts.every(r=>plain(r)&&typeof r.planId==='string'&&r.state==='confirmed'))fail(code,'Invalid assistant data of the chat.');
   if(a.action!=null&&!(plain(a.action)&&(a.action.phase==='pending'||a.action.phase==='conflict')&&plain(a.action.plan)&&typeof a.action.plan.id==='string'&&plain(a.action.receipt)))fail(code,'Invalid started assistant save to the job.');
   if((a.action!=null||a.receipts.length)&&(!w||job===null))fail(code,'An assistant save to a job without a link between the chat and the job.');
   if(a.receipts.some(r=>r.sourceId!==w.sourceId||r.jobId!==job)||new Set(a.receipts.map(r=>r.planId)).size!==a.receipts.length)fail(code,'An assistant save confirmation does not belong to this chat.');
  }
 }
 function checkEntry(e,code){
  if(!exact(e,ENTRY_KEYS))fail(code,'Unknown layout of the saved chat.');
  if(typeof e.contextId!=='string'||!CONTEXT_ID.test(e.contextId))fail(code,'Invalid chat identifier.');
  if(![e.version,e.created,e.touched].every(n=>count(n)&&n>=1)||e.created>e.touched)fail(code,'Invalid chat version.');
  if(!utc(e.createdAt)||!utc(e.updatedAt))fail(code,'Invalid chat time.');
  if(typeof e.input!=='string'||e.input.length>LIMITS.inputChars)fail(code,'Invalid unsent text.');
  checkEnvelope(e.envelope,code);
  if(e.jobId!==jobOf(e.envelope))fail(code,'The chat points to a different job than its link.');
  if(JSON.stringify(e).length>LIMITS.entryChars)fail(code,'The chat exceeds the size limit.');
 }
 function checkLegacy(l,code){
  if(l!==null&&(!exact(l,LEGACY_KEYS)||typeof l.contextId!=='string'||!CONTEXT_ID.test(l.contextId)||!utc(l.importedAt)||!count(l.chars)||typeof l.sha256!=='string'||!SHA256.test(l.sha256)))fail(code,'Invalid migration record.');
 }
 // Released layout 1, unchanged. Used only to read a stored version 1 value before its migration.
 function checkBankV1(b,code){
  if(!exact(b,BANK_KEYS_V1)||b.kind!==KIND||b.version!==1||!count(b.serial)||!Array.isArray(b.contexts))fail(code,'Unknown layout of the saved chats.');
  const l=b.legacy;checkLegacy(l,code);
  if(b.contexts.length>LIMITS.contexts)fail(code,'The saved chats exceed the limit on the number of chats.');
  const ids=new Set(),sources=new Set(),perJob=new Map();
  for(const e of b.contexts){
   checkEntry(e,code);
   if(ids.has(e.contextId)||e.touched>b.serial)fail(code,'Inconsistent versions or a repeated chat.');
   ids.add(e.contextId);perJob.set(e.jobId,(perJob.get(e.jobId)||0)+1);
   if(perJob.get(e.jobId)>LIMITS.perJob)fail(code,'Too many chats of one job.');
   const source=sourceOf(e.envelope);
   if(source!==null){if(sources.has(source))fail(code,'The same chat identity appears in two chats.');sources.add(source);}
  }
  if(l!==null&&!ids.has(l.contextId))fail(code,'The migration record does not point to the imported chat.');
 }
 // Compact and bounded: identity, last stored version and the acknowledgement receipts, verbatim. No draft, history or text.
 function checkRetired(t,code){
  if(Object.hasOwn(t||{},'actions')&&!(exact(t,RETIRED_KEYS_ACTIONS)&&Array.isArray(t.actions)&&t.actions.length>=1&&t.actions.length<=ACTION_RECEIPTS&&t.sourceId!==null&&t.jobId!==null&&t.actions.every(r=>plain(r)&&typeof r.planId==='string'&&r.sourceId===t.sourceId&&r.jobId===t.jobId)))fail(code,'Invalid assistant save confirmations of the deleted chat.');
  if(!(exact(t,RETIRED_KEYS)||exact(t,RETIRED_KEYS_ACTIONS))||typeof t.contextId!=='string'||!CONTEXT_ID.test(t.contextId)||!utc(t.retiredAt)||!(count(t.version)&&t.version>=1)||!(count(t.serial)&&t.serial>=1))fail(code,'Invalid record of the deleted chat.');
  if(t.jobId!==null&&(typeof t.jobId!=='string'||!JOB_ID.test(t.jobId)))fail(code,'Invalid job of the deleted chat.');
  if(!Array.isArray(t.receipts)||!t.receipts.every(plain))fail(code,'Invalid confirmations of the deleted chat.');
  if(t.sourceId===null?(t.sourceRevision!==null||t.receipts.length>0):(typeof t.sourceId!=='string'||!count(t.sourceRevision)))fail(code,'Invalid identity of the deleted chat.');
  if(JSON.stringify(t).length>LIMITS.retiredChars)fail(code,'The record of the deleted chat exceeds the size limit.');
 }
 function checkBank(b,code){
  if(!exact(b,BANK_KEYS)||b.kind!==KIND||b.version!==VERSION||!count(b.serial)||!Array.isArray(b.contexts)||!Array.isArray(b.archived)||!Array.isArray(b.retired))fail(code,'Unknown layout of the saved chats.');
  const l=b.legacy;checkLegacy(l,code);
  if(b.contexts.length>LIMITS.contexts)fail(code,'The saved chats exceed the limit on the number of active chats.');
  if(b.archived.length>LIMITS.archived)fail(code,'The saved chats exceed the archive limit.');
  if(b.retired.length>LIMITS.retired)fail(code,'The saved chats exceed the limit on deletion records.');
  // One conversation identity and one source identity live in exactly one place: active, archived or retired.
  const ids=new Set(),sources=new Set(),perJob=new Map();
  const claim=(id,source,serial)=>{
   if(ids.has(id)||serial>b.serial)fail(code,'Inconsistent versions or a repeated chat.');
   ids.add(id);
   if(source!==null){if(sources.has(source))fail(code,'The same chat identity appears in two chats.');sources.add(source);}
  };
  for(const e of b.contexts){
   checkEntry(e,code);claim(e.contextId,sourceOf(e.envelope),e.touched);
   perJob.set(e.jobId,(perJob.get(e.jobId)||0)+1);
   if(perJob.get(e.jobId)>LIMITS.perJob)fail(code,'Too many active chats of one job.');
  }
  for(const a of b.archived){
   if(!exact(a,ARCHIVED_KEYS)||!utc(a.archivedAt))fail(code,'Unknown layout of the archived chat.');
   checkEntry(a.entry,code);claim(a.entry.contextId,sourceOf(a.entry.envelope),a.entry.touched);
  }
  for(const t of b.retired){checkRetired(t,code);claim(t.contextId,t.sourceId,t.serial);}
  // The import record of the legacy draft is permanent; its conversation may be active, archived or deleted, never unknown.
  if(l!==null&&!ids.has(l.contextId))fail(code,'The migration record does not point to the imported chat.');
 }

 function empty(){return {kind:KIND,version:VERSION,serial:0,legacy:null,contexts:[],archived:[],retired:[]};}
 function newId(crypto){
  if(!crypto||typeof crypto.getRandomValues!=='function')fail('INVALID','Secure identifiers are not available.');
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  return 'ctx1_'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
 }
 // Strict read of a stored value: {stored,bank}. `stored` is the layout found in storage (1 or 2); `bank` is always layout 2.
 // Unknown versions, extra fields and non-canonical bytes all fail closed. For a version 1 value the conversations and the
 // legacy record are carried over as they are; nothing is normalised, dropped or renumbered. Nothing is written here.
 function read(raw){
  if(typeof raw!=='string')fail('CORRUPT','There is no saved chat storage.');
  if(raw.length>LIMITS.bankChars+LAYOUT_ROOM)fail('LIMIT','The saved chat storage exceeds the size limit.');
  let bank;try{bank=JSON.parse(raw);}catch{fail('CORRUPT','The saved chat storage is damaged.');}
  const tagged=plain(bank)&&bank.kind===KIND;
  if(tagged&&bank.version===1){
   if(raw.length>LIMITS.bankChars)fail('LIMIT','The saved chat storage exceeds the size limit.');
   checkBankV1(bank,'CORRUPT');
   if(JSON.stringify(bank)!==raw)fail('CORRUPT','The saved chat storage has an unexpected form.');
   const next={kind:KIND,version:VERSION,serial:bank.serial,legacy:bank.legacy,contexts:bank.contexts,archived:[],retired:[]};
   checkBank(next,'CORRUPT');
   return {stored:1,bank:next};
  }
  if(tagged&&bank.version!==VERSION)fail('UNSUPPORTED','The saved chats were written by a newer or unknown version of the app.');
  checkBank(bank,'CORRUPT');
  if(JSON.stringify(bank)!==raw)fail('CORRUPT','The saved chat storage has an unexpected form.');
  return {stored:VERSION,bank};
 }
 // Strict read of a value that must already be in the current layout.
 function parse(raw){
  const r=read(raw);
  if(r.stored!==VERSION)fail('OUTDATED','The saved chat storage has an older layout and waits for migration when the page is opened.');
  return r.bank;
 }
 function serialize(bank){
  checkBank(bank,'INVALID');const raw=JSON.stringify(bank);
  if(raw.length>LIMITS.bankChars+LAYOUT_ROOM)fail('LIMIT','Saved chats reached the size limit. Nothing was removed or saved. Space is freed by deleting a chat (the archive uses it too) — export it first.'+MANAGE);
  return raw;
 }
 // Read-only views: callers must not mutate returned entries. Latest write first. get/list/latest see ACTIVE conversations only.
 function get(bank,contextId){return bank.contexts.find(e=>e.contextId===contextId)||null;}
 const newest=(all,jobId)=>(jobId===undefined?all:all.filter(e=>e.jobId===jobId)).slice().sort((a,b)=>b.touched-a.touched);
 function list(bank,jobId){return newest(bank.contexts,jobId);}
 function latest(bank,jobId){return list(bank,jobId)[0]||null;}
 function archived(bank,jobId){return newest(bank.archived.map(a=>a.entry),jobId);}
 // Where one conversation identity lives: {state:'active'|'archived',entry} or {state:'retired',tombstone}; null = unknown.
 function where(bank,contextId){
  const e=bank.contexts.find(x=>x.contextId===contextId);if(e)return {state:'active',contextId,entry:e};
  const a=bank.archived.find(x=>x.entry.contextId===contextId);if(a)return {state:'archived',contextId,entry:a.entry,archivedAt:a.archivedAt};
  const t=bank.retired.find(x=>x.contextId===contextId);return t?{state:'retired',contextId,tombstone:t}:null;
 }
 function sourceHolder(bank,source){
  const e=bank.contexts.find(x=>sourceOf(x.envelope)===source);if(e)return where(bank,e.contextId);
  const a=bank.archived.find(x=>sourceOf(x.entry.envelope)===source);if(a)return where(bank,a.entry.contextId);
  const t=bank.retired.find(x=>x.sourceId===source);return t?where(bank,t.contextId):null;
 }
 // Counts only (cheap). The stored size is the length of the stored string, which the caller already holds.
 function usage(bank,jobId){
  return {active:bank.contexts.length,activeLimit:LIMITS.contexts,job:bank.contexts.filter(e=>e.jobId===(jobId===undefined?null:jobId)).length,jobLimit:LIMITS.perJob,
   archived:bank.archived.length,archivedLimit:LIMITS.archived,retired:bank.retired.length,retiredLimit:LIMITS.retired,charsLimit:LIMITS.bankChars};
 }

 // Receipts compared as an exact multiset; null when any receipt is not a well-formed receipt.
 function receiptBag(receipts){
  const out=[];
  for(const r of receipts){if(!exact(r,RECEIPT)||RECEIPT.some(k=>typeof r[k]!=='string'))return null;out.push(JSON.stringify(RECEIPT.map(k=>r[k])));}
  return out.sort().join('\n');
 }
 function sameReceipts(a,b){if(same(a,b))return true;const bag=receiptBag(a);return bag!==null&&bag===receiptBag(b);}
 // The only receipts a pending create may leave behind (mirrors JHSession.done); null = plan cannot be verified.
 function createReceipts(w){
  const p=w.prepared,x=plain(p.input)?p.input:null,plan=plain(p.handoff)&&plain(p.handoff.plan)?p.handoff.plan:null;
  if(!x||!plan||!plain(x.job)||!plain(x.job.head)||!Array.isArray(x.selectedItemIds)||!Array.isArray(plan.actions)||!plan.actions.length||plan.actions.length!==x.selectedItemIds.length)return null;
  const jobId=x.job.head.jobId;
  if(typeof jobId!=='string'||jobId!==w.targetJobId)return null;
  const out=w.receipts.slice();
  for(let i=0;i<plan.actions.length;i++){
   const a=plan.actions[i],itemId=x.selectedItemIds[i];
   if(!plain(a)||typeof a.id!=='string'||typeof a.revisionId!=='string'||typeof itemId!=='string')return null;
   if(!out.some(r=>plain(r)&&r.jobId===jobId&&r.itemId===itemId))out.push({jobId,itemId,materialId:a.id,revisionId:a.revisionId});
  }
  return out;
 }
 // The only receipts a pending edit may leave behind (mirrors JHSession.editDone); null = plan cannot be verified.
 function editReceipts(w){
  const p=w.materialEdit.plan,x=plain(p)&&plain(p.input)?p.input:null;
  if(!x||!plain(x.receipt)||!plain(x.item)||!plain(p.revision)||typeof p.revision.revisionId!=='string'||x.receipt.jobId!==w.targetJobId)return null;
  const at=w.receipts.findIndex(r=>plain(r)&&r.jobId===x.receipt.jobId&&r.itemId===x.item.id);
  if(at<0)return null;
  const r=w.receipts[at];
  if(r.materialId!==p.revision.materialId||r.revisionId!==x.receipt.revisionId)return null;
  const out=w.receipts.slice();out[at]={...r,revisionId:p.revision.revisionId};
  return out;
 }
 // A started write freezes the source. The next envelope is either the same pending operation, or that
 // very plan finished with exactly its acknowledgement receipts, or (edit only) the same plan in conflict.
 // A started job action (note / measurement) freezes the conversation like a started material write. The next envelope either
 // still holds that very plan (pending, or the same plan marked as a conflict), or the plan is gone: confirmed by exactly its own
 // receipt, or released with the receipt list unchanged after the job history was shown to hold nothing of it. While a material
 // write is the pending one, the assistant data does not change at all.
 function guardAction(previous,next){
  const a=assistantOf(previous),b=assistantOf(next),was=actionOf(previous);
  if(!was||was.phase!=='pending'){if(!same(a,b))fail('INVALID','A started save blocks changing the assistant data of this chat.');return;}
  const part=(m,k)=>m&&m[k]!=null?m[k]:null,now=part(b,'action'),had=a.receipts,have=actionReceipts(next);
  if(!same(part(a,'tool'),part(b,'tool')))fail('INVALID','A started save to the job blocks changing the chat calculator.');
  if(plain(now)){
   if(plain(now.plan)&&now.plan.id===was.plan.id&&same(had,have)&&same(part(a,'proposal'),part(b,'proposal'))&&(same(now,was)||(now.phase==='conflict'&&same(now.plan,was.plan)&&same(now.input,was.input))))return;
  }else{
   if(same(had,have)&&same(part(a,'proposal'),part(b,'proposal')))return;
   const last=have[have.length-1];
   if(have.length===had.length+1&&same(have.slice(0,-1),had)&&last.planId===was.plan.id&&same(last.record,was.receipt.record))return;
  }
  fail('INVALID','A started save to the job can only be finished with the same plan, marked as disputed, or released after checking the job history.');
 }
 function guardPending(previous,next,before,after){
  if(!same(previous.state,next.state)||BINDING.some(k=>!same(before[k],after[k])))fail('INVALID','A started save blocks changing the draft, its identity and its job.');
  guardAction(previous,next);
  const part=(w,k)=>w[k]==null?null:w[k],pend=k=>plain(before[k])&&before[k].phase==='pending';
  const keeps=k=>same(part(before,k),part(after,k)),receipts=want=>want!==null&&sameReceipts(want,after.receipts);
  if(keeps('prepared')&&keeps('materialEdit')&&receipts(before.receipts))return;
  if(pend('prepared')&&!pend('materialEdit')&&keeps('materialEdit')&&part(after,'prepared')===null&&receipts(createReceipts(before)))return;
  if(pend('materialEdit')&&!pend('prepared')&&keeps('prepared')){
   if(part(after,'materialEdit')===null&&receipts(editReceipts(before)))return;
   if(same(part(after,'materialEdit'),{...before.materialEdit,phase:'conflict'})&&receipts(before.receipts))return;
  }
  fail('INVALID','A started save can only be finished with the same plan and its exact confirmation.');
 }
 // A context keeps its source identity and its job, never moves backwards and never loses a receipt.
 function guardIdentity(previous,next){
  const before=workspaceOf(previous),after=workspaceOf(next);
  if(!before)return;
  if(!after||after.sourceId!==before.sourceId)fail('INVALID','The chat identity cannot change.');
  if(after.sourceRevision<before.sourceRevision)fail('INVALID','The chat version cannot go back.');
  // Explicit assignment null -> job is the only job change; an assigned conversation is never moved or detached.
  const job=jobOf(previous);
  if(job!==null&&jobOf(next)!==job)fail('INVALID','A chat assigned to a job cannot be moved or detached.');
  for(const r of before.receipts){
   if(!after.receipts.some(x=>plain(x)&&plain(r)&&x.jobId===r.jobId&&x.itemId===r.itemId&&x.materialId===r.materialId))fail('INVALID','A confirmation of a saved material cannot disappear.');
  }
  // Confirmed job-action receipts of the conversation are kept verbatim as well.
  const kept=actionReceipts(next);
  for(const r of actionReceipts(previous))if(!kept.some(x=>same(x,r)))fail('INVALID','A confirmation of an assistant save to the job cannot disappear.');
  if(isPending(previous))guardPending(previous,next,before,after);
 }
 const GONE={archived:['ARCHIVED','This chat is in the archive (it was archived in another tab). Nothing was saved; restore it in “Manage chats”.'],retired:['RETIRED','This chat was deleted. An ordinary save does not bring it back and nothing was saved; download a recovery copy of the screen.']};
 // The active-count limits, checked before anything is changed. Nothing is ever evicted to make room.
 function room(next,jobId,verb){
  if(next.contexts.length>=LIMITS.contexts)fail('LIMIT','Limit '+LIMITS.contexts+' active chats. '+verb+' Archive one of the active chats to free a slot — nothing was removed.'+MANAGE);
  if(next.contexts.filter(e=>e.jobId===jobId).length>=LIMITS.perJob)fail('LIMIT','Limit '+LIMITS.perJob+' active chats of one job. '+verb+' Archive one of the chats of this job to free a slot — nothing was removed.'+MANAGE);
 }
 // Entry-granular compare-and-set. `bank` must be the freshly read stored bank, so every other
 // context is carried over untouched. baseVersion 0 creates; any other mismatch is a conflict.
 // An archived or deleted conversation is never written by this path, whatever version the caller holds.
 function commit(bank,change){
  checkBank(bank,'INVALID');
  const {contextId,baseVersion,input,now}=change||{};
  if(typeof contextId!=='string'||!CONTEXT_ID.test(contextId)||!count(baseVersion)||!utc(now))fail('INVALID','Invalid chat change.');
  if(typeof input!=='string')fail('INVALID','Invalid unsent text.');
  if(input.length>LIMITS.inputChars)fail('LIMIT','The unsent text exceeds the limit of '+LIMITS.inputChars+' characters. It was not shortened or saved.');
  // Every rule below is applied to exactly the value that would be stored.
  let envelope;try{envelope=clone(change.envelope);}catch{envelope=undefined;}
  checkEnvelope(envelope,'INVALID');
  const next=clone(bank),index=next.contexts.findIndex(e=>e.contextId===contextId),previous=index<0?null:next.contexts[index];
  if(!previous){const held=where(next,contextId);if(held)fail(...GONE[held.state]);}
  if(previous?previous.version!==baseVersion:baseVersion!==0)fail('CONFLICT','This chat changed in another tab. Nothing was overwritten.');
  if(next.serial>=Number.MAX_SAFE_INTEGER)fail('LIMIT','The version limit of the saved chats was reached.');
  const jobId=jobOf(envelope),source=sourceOf(envelope);
  if(source!==null){
   const holder=sourceHolder(next,source);
   if(holder&&holder.contextId!==contextId)fail(holder.state==='retired'?'RETIRED':'DUPLICATE',holder.state==='retired'?'This draft identity belongs to a deleted chat. An ordinary save does not bring it back; nothing was saved.':'The same chat identity already appears in another chat. Nothing was saved.');
  }
  if(previous)guardIdentity(previous.envelope,envelope);
  if(!previous||previous.jobId!==jobId){
   if(!previous)room(next,jobId,'No new chat was created.');
   else if(next.contexts.filter(e=>e.jobId===jobId).length>=LIMITS.perJob)fail('LIMIT','Limit '+LIMITS.perJob+' active chats of one job. Nothing was assigned or removed; archive one of the chats of this job.'+MANAGE);
  }
  next.serial++;
  const entry={contextId,jobId,version:baseVersion+1,created:previous?previous.created:next.serial,touched:next.serial,createdAt:previous?previous.createdAt:now,updatedAt:now,input,envelope};
  if(JSON.stringify(entry).length>LIMITS.entryChars)fail('LIMIT','The chat exceeds the size limit. It was not saved; export it and start a new one.');
  if(previous)next.contexts[index]=entry;else next.contexts.push(entry);
  serialize(next);
  return {bank:next,entry};
 }

 // --- Archive, restore, delete ---------------------------------------------------------------------------
 // Each is a compare-and-set on ONE conversation of the freshly read bank: the caller names the exact version it saw.
 // Pure: on any refusal the given bank is returned to nobody and stays as it was.
 function manage(bank,change){
  checkBank(bank,'INVALID');
  const {contextId,baseVersion,now}=change||{};
  if(typeof contextId!=='string'||!CONTEXT_ID.test(contextId)||!count(baseVersion)||baseVersion<1||!utc(now))fail('INVALID','Invalid chat operation.');
  const next=clone(bank);
  if(next.serial>=Number.MAX_SAFE_INTEGER)fail('LIMIT','The version limit of the saved chats was reached.');
  return next;
 }
 const unseen=()=>fail('CONFLICT','This chat changed or disappeared in another tab. Nothing was changed.');
 const started=what=>fail('PENDING','A save to the job was started in this chat. '+what+' is blocked until that save is finished (“Resume save”). Nothing was changed.');
 // The moved entry keeps every field; only its compare-and-set version and its ordering stamp advance, so a tab that still
 // holds the previous version can no longer write it.
 const advance=(next,entry)=>({...entry,version:entry.version+1,touched:++next.serial});
 function archive(bank,change){
  const next=manage(bank,change),at=next.contexts.findIndex(e=>e.contextId===change.contextId);
  if(at<0||next.contexts[at].version!==change.baseVersion)unseen();
  if(isPending(next.contexts[at].envelope))started('Archiving');
  if(next.archived.length>=LIMITS.archived)fail('LIMIT','Limit '+LIMITS.archived+' chats in the archive. Nothing was changed; export and delete archived chats you no longer need.');
  const entry=advance(next,next.contexts[at]);
  next.contexts.splice(at,1);next.archived.push({archivedAt:change.now,entry});
  serialize(next);
  return {bank:next,entry};
 }
 function restore(bank,change){
  const next=manage(bank,change),at=next.archived.findIndex(a=>a.entry.contextId===change.contextId);
  if(at<0||next.archived[at].entry.version!==change.baseVersion)unseen();
  room(next,next.archived[at].entry.jobId,'The chat stays in the archive in full.');
  const entry=advance(next,next.archived[at].entry);
  next.archived.splice(at,1);next.contexts.push(entry);
  serialize(next);
  return {bank:next,entry};
 }
 // Explicit deletion of an active or archived conversation. The payload leaves the bank; a compact record stays.
 function retire(bank,change){
  const next=manage(bank,change),held=where(next,change.contextId);
  if(!held||held.state==='retired'||held.entry.version!==change.baseVersion)unseen();
  const entry=held.entry,w=workspaceOf(entry.envelope);
  if(isPending(entry.envelope))started('Deleting');
  if(next.retired.length>=LIMITS.retired)fail('LIMIT','Limit '+LIMITS.retired+' deletion records. These short records are not removed silently, so this chat was not deleted. It can be archived and exported.');
  const tombstone={contextId:entry.contextId,jobId:entry.jobId,sourceId:w?w.sourceId:null,sourceRevision:w?w.sourceRevision:null,version:entry.version,receipts:w?clone(w.receipts):[],retiredAt:change.now,serial:++next.serial};
  // Receipts of notes / measurements written from this conversation stay with the deletion record, verbatim.
  const acts=actionReceipts(entry.envelope);if(acts.length)tombstone.actions=clone(acts);
  if(JSON.stringify(tombstone).length>LIMITS.retiredChars)fail('LIMIT','The deletion record of this chat would exceed the size limit. Nothing was deleted; the chat can be archived.');
  if(held.state==='active')next.contexts=next.contexts.filter(e=>e.contextId!==entry.contextId);
  else next.archived=next.archived.filter(a=>a.entry.contextId!==entry.contextId);
  next.retired.push(tombstone);
  serialize(next);
  return {bank:next,tombstone};
 }

 // --- Portable archive of one conversation ---------------------------------------------------------------
 // Field names no application object carries. JSON.parse keeps "__proto__" as an ordinary own field, and a later copy by
 // assignment would turn it into a prototype; a file holding one of these names anywhere is refused as a whole.
 const UNSAFE_KEYS=['__proto__','constructor','prototype'];
 function unsafeKey(value){
  const stack=[value];
  while(stack.length){
   const v=stack.pop();
   if(Array.isArray(v)){for(const x of v)stack.push(x);continue;}
   if(!plain(v))continue;
   for(const k of Object.keys(v)){if(UNSAFE_KEYS.includes(k))return true;stack.push(v[k]);}
  }
  return false;
 }
 // Counters of a file are taken over as they are, so they must leave room to count on: the next save adds one to the version.
 const COUNTER_MAX=1e12;
 function checkArchive(a,code){
  if(!exact(a,ARCHIVE_KEYS)||a.kind!==ARCHIVE_KIND||a.version!==ARCHIVE_VERSION||!utc(a.exportedAt)||(a.origin!=='active'&&a.origin!=='archived'))fail(code,'Unknown layout of the chat archive. Nothing was changed.');
  checkEntry(a.entry,code);
  if([a.entry.version,a.entry.created,a.entry.touched].some(n=>n>COUNTER_MAX)||(Array.isArray(a.recovery)&&a.recovery.some(r=>plain(r)&&r.baseVersion>COUNTER_MAX)))fail(code,'Invalid version counters in the chat archive. Nothing was changed.');
  if(typeof a.unsentText!=='string'||a.unsentText.length>LIMITS.inputChars)fail(code,'Invalid unsent text in the chat archive. Nothing was changed.');
  if(!Array.isArray(a.recovery)||a.recovery.length>LIMITS.recoveryTexts||a.recovery.some(r=>!exact(r,RECOVERY_KEYS)||typeof r.text!=='string'||r.text.length>LIMITS.inputChars||!utc(r.savedAt)||!count(r.baseVersion)))fail(code,'Invalid copies of unsent text in the chat archive. Nothing was changed.');
 }
 // The stored entry, verbatim, plus the exact text of the message field (which may be ahead of the stored text) and the
 // unsent texts kept for this conversation by the recovery journal. options: {exportedAt,unsentText?,recovery?}.
 function portable(bank,contextId,options){
  checkBank(bank,'INVALID');
  const o=options||{},held=where(bank,contextId);
  if(!held||held.state==='retired')fail('MISSING','This chat is not in browser storage; its archive cannot be created.');
  const out={kind:ARCHIVE_KIND,version:ARCHIVE_VERSION,exportedAt:o.exportedAt,origin:held.state,entry:clone(held.entry),unsentText:o.unsentText===undefined?held.entry.input:o.unsentText,recovery:clone(o.recovery||[])};
  checkArchive(out,'INVALID');
  return out;
 }
 function difference(stored,file){
  const a=workspaceOf(stored.envelope),b=workspaceOf(file.envelope),ra=a?a.sourceRevision:-1,rb=b?b.sourceRevision:-1;
  const relation=rb<ra||(rb===ra&&file.version<stored.version)?'older':rb>ra||file.version>stored.version?'newer':'diverged';
  const label={older:'an older state of this chat',newer:'a newer state of this chat',diverged:'a different state of this chat at the same version'}[relation];
  return {relation,reason:'This chat is already in this browser, and the file contains '+label+' (file: version '+file.version+', draft revision '+(b?rb:'—')+'; browser: version '+stored.version+', draft revision '+(a?ra:'—')+'). Import overwrites and merges nothing.'};
 }
 // Empty string = the file is exactly compatible with the deletion record.
 function retiredMismatch(t,entry,w,source){
  if(t.contextId!==entry.contextId||t.sourceId!==source)return 'the chat and draft identifiers do not together name the same deleted record.';
  if(t.jobId!==entry.jobId)return 'the file names a different job than the deleted chat.';
  if(entry.version>t.version||(w&&w.sourceRevision>t.sourceRevision))return 'the file is newer than the state at deletion, so it comes from another save.';
  if(w&&!sameReceipts(t.receipts,w.receipts))return 'the confirmations of materials saved to the job differ (file: '+w.receipts.length+', at deletion: '+t.receipts.length+'), and restoring could duplicate or lose material bindings.';
  const byPlan=list=>list.slice().sort((x,y)=>String(x&&x.planId)<String(y&&y.planId)?-1:1);
  if(!same(byPlan(t.actions||[]),byPlan(actionReceipts(entry.envelope))))return 'the confirmations of notes and measurements saved to the job from this chat differ from the state at deletion (file: '+actionReceipts(entry.envelope).length+', at deletion: '+(t.actions||[]).length+').';
  return '';
 }
 // Reads and classifies an archive file against the given bank. Pure; throws BankError for anything that is not a valid archive.
 function classify(text,bank,validate){
  if(typeof text!=='string')fail('CORRUPT','The file has no content. Nothing was changed.');
  if(text.length>LIMITS.importChars)fail('LIMIT','The file exceeds the import size limit ('+LIMITS.importChars+' characters). Nothing was changed.');
  let a;try{a=JSON.parse(text);}catch{fail('CORRUPT','The file is not valid JSON. Nothing was changed.');}
  if(plain(a)&&RAW_KINDS.includes(a.kind))fail('RAW','This is a raw recovery copy of browser storage, not a chat archive. It is for manual recovery; it is not imported or opened as a draft. Nothing was changed.');
  if(plain(a)&&a.kind===OLD_DRAFT_KIND)fail('UNSUPPORTED','This is a draft export from an older version of the app, without the full chat state. It stays a read-only file; it is not imported. Nothing was changed.');
  if(plain(a)&&a.kind===ARCHIVE_KIND&&a.version!==ARCHIVE_VERSION)fail('UNSUPPORTED','The chat archive was written by a newer or unknown version of the app. Nothing was changed.');
  if(unsafeKey(a))fail('CORRUPT','The file contains forbidden field names (__proto__, constructor or prototype). It is not a chat archive from this app; nothing was changed.');
  checkArchive(a,'CORRUPT');
  if(typeof validate==='function'){try{validate(a.entry.envelope);}catch(e){fail('CORRUPT',(e&&e.message||'The chat from the file did not pass validation.')+' Nothing was changed.');}}
  const entry=a.entry,env=entry.envelope,w=workspaceOf(env),source=sourceOf(env);
  const held=where(bank,entry.contextId),holder=source===null?null:sourceHolder(bank,source);
  const p={archive:a,contextId:entry.contextId,jobId:entry.jobId,sourceId:source,version:entry.version,sourceRevision:w?w.sourceRevision:null,items:env.state.items.length,history:env.state.history.length,receipts:w?w.receipts.length:0,
   unsentText:a.unsentText,recovery:a.recovery.length,exportedAt:a.exportedAt,origin:a.origin,outcome:'new',relation:'',reason:'',restorable:false,retiredAt:null};
  // Assistant data of the file, for the preview only: the calculator kept in the conversation, an unconfirmed proposal, receipts.
  const helper=assistantOf(env);
  p.assistant={tool:helper&&plain(helper.tool)&&typeof helper.tool.tool==='string'?helper.tool.tool:'',proposal:!!(helper&&plain(helper.proposal)),conflict:!!(helper&&plain(helper.action)),receipts:actionReceipts(env).length};
  if(isPending(env)){p.outcome='blocked';p.reason='The file contains a started, unfinished save to the job. Finish it in the browser the file comes from and export the chat again. Nothing was changed.';}
  else if(held&&held.state!=='retired'){
   if(same(held.entry.envelope,env)&&held.entry.input===a.unsentText)p.outcome='identical';
   else{const d=difference(held.entry,entry);p.outcome='conflict';p.relation=d.relation;p.reason=d.reason;}
  }
  else if(holder&&holder.state!=='retired'){p.outcome='conflict';p.relation='source';p.reason='The draft identity from the file already belongs to another chat in this browser. Import would duplicate its material bindings, so nothing was changed.';}
  else if(held||holder){
   const t=(held||holder).tombstone,why=retiredMismatch(t,entry,w,source);
   p.outcome='retired';p.retiredAt=t.retiredAt;p.restorable=!why;
   p.reason=why?'This chat was deleted in this browser, and the file does not match its deletion record: '+why+' The file was not imported.':'This chat was deleted in this browser. The file matches the deletion record (the same chat, job and material confirmations). Restoring requires explicit confirmation.';
  }
  // A file that would be added must not bring acknowledgements of materials that another conversation of this browser already
  // holds (also a deleted one): two conversations bound to the same written material could each rewrite it.
  if((p.outcome==='new'||(p.outcome==='retired'&&p.restorable))&&w&&receiptClaimed(bank,entry.contextId,w.receipts)){
   p.outcome='conflict';p.relation='receipts';p.restorable=false;
   p.reason='The file contains material confirmations that in this browser already belong to another chat (possibly a deleted one). Import would duplicate the bindings of those materials, so nothing was changed.';
  }
  return p;
 }
 // True when a material acknowledged in `receipts` is acknowledged by a conversation other than `contextId` anywhere in the bank.
 function receiptClaimed(bank,contextId,receipts){
  const key=r=>plain(r)&&typeof r.jobId==='string'&&typeof r.materialId==='string'?r.jobId+'/'+r.materialId:null;
  const wanted=new Set(receipts.map(key).filter(k=>k!==null));
  if(!wanted.size)return false;
  const hit=(id,list)=>id!==contextId&&Array.isArray(list)&&list.some(r=>wanted.has(key(r)));
  const of=e=>{const x=workspaceOf(e.envelope);return x?x.receipts:null;};
  return bank.contexts.some(e=>hit(e.contextId,of(e)))||bank.archived.some(a=>hit(a.entry.contextId,of(a.entry)))||bank.retired.some(t=>hit(t.contextId,t.receipts));
 }
 // Applies one archive file to `bank` (the freshly read bank). options: {destination:'active'|'archived',restoreRetired,now,validate}.
 //  - the same file again, or a file equal to what is stored: {changed:false}, the bank is returned as it is
 //  - a conversation or source identity that already lives here in a different state: CONFLICT, nothing is overwritten or merged
 //  - a deleted conversation: only with restoreRetired===true AND a file that matches the deletion record; otherwise RETIRED
 // Identities, receipts, times and the envelope come from the file verbatim. Only bank bookkeeping is local: the ordering stamps,
 // and for a restored deletion the version (one above the deleted version, so a stale tab still cannot write it).
 function adopt(bank,text,options){
  checkBank(bank,'INVALID');
  const {destination,restoreRetired,now,validate}=options||{};
  if((destination!=='active'&&destination!=='archived')||!utc(now))fail('INVALID','Invalid chat import.');
  const p=classify(text,bank,validate),a=p.archive;
  if(p.outcome==='identical')return {bank,entry:where(bank,p.contextId).entry,changed:false,outcome:p.outcome,recovery:[]};
  if(p.outcome==='blocked')fail('PENDING',p.reason);
  if(p.outcome==='conflict')fail('CONFLICT',p.reason);
  if(p.outcome==='retired'){
   if(!p.restorable)fail('RETIRED',p.reason);
   if(restoreRetired!==true)fail('RETIRED','This chat was deleted in this browser. Restoring it from the file requires explicit confirmation in the import preview. Nothing was changed.');
  }
  const next=clone(bank);
  if(next.serial>=Number.MAX_SAFE_INTEGER)fail('LIMIT','The version limit of the saved chats was reached.');
  let version=a.entry.version;
  if(p.outcome==='retired'){const at=next.retired.findIndex(t=>t.contextId===p.contextId);version=next.retired[at].version+1;next.retired.splice(at,1);}
  next.serial++;
  const entry={contextId:a.entry.contextId,jobId:a.entry.jobId,version,created:next.serial,touched:next.serial,createdAt:a.entry.createdAt,updatedAt:a.entry.updatedAt,input:a.unsentText,envelope:clone(a.entry.envelope)};
  if(JSON.stringify(entry).length>LIMITS.entryChars)fail('LIMIT','The chat from the file exceeds the size limit. Nothing was changed.');
  if(destination==='active'){room(next,entry.jobId,'The chat from the file was not added to the active ones.');next.contexts.push(entry);}
  else{
   if(next.archived.length>=LIMITS.archived)fail('LIMIT','Limit '+LIMITS.archived+' chats in the archive. The chat from the file was not added; nothing was removed.');
   next.archived.push({archivedAt:now,entry});
  }
  serialize(next);
  return {bank:next,entry,changed:true,outcome:p.outcome,recovery:clone(a.recovery)};
 }
 // Preview for the user: the classification plus, per destination, why applying would be refused ('' = it would be accepted).
 // Nothing is changed; the same checks run again, on freshly read bytes, when the import is applied.
 function inspect(text,bank,options){
  checkBank(bank,'INVALID');
  const {validate,now}=options||{},p=classify(text,bank,validate);
  p.refused={active:'',archived:''};
  if(p.outcome==='new'||(p.outcome==='retired'&&p.restorable)){
   for(const destination of ['active','archived']){
    try{adopt(bank,text,{destination,restoreRetired:true,now,validate});}
    catch(e){if(!(e instanceof BankError))throw e;p.refused[destination]=e.message;}
   }
  }
  return p;
 }

 const digest=sha256=>{if(typeof sha256!=='string'||!SHA256.test(sha256))fail('INVALID','The SHA-256 digest of the legacy draft is missing. The migration was not performed.');};
 const recorded=(bank,legacyRaw,sha256)=>bank.legacy.sha256===sha256&&bank.legacy.chars===legacyRaw.length;
 // Pure migration decision. The host takes it under its lock, from freshly read bytes of both keys
 // (legacyRaw null = key absent) and the host-computed SHA-256 (lowercase hex) of the legacy bytes.
 //  'none'     no legacy bytes and nothing recorded
 //  'import'   legacy bytes not imported yet: call migrate() with this same bank, even if it already holds contexts
 //  'imported' the legacy bytes are exactly the imported ones (also when the imported conversation was archived or deleted since)
 //  'changed'  an old client rewrote the legacy key after the import: never import again; show the notice and raw export
 //  'missing'  an import is recorded but the legacy key is gone: report; the bank stays usable
 function legacyStatus(bank,legacyRaw,sha256){
  const base=bank==null?empty():bank;checkBank(base,'INVALID');
  if(legacyRaw==null)return base.legacy?'missing':'none';
  if(typeof legacyRaw!=='string')fail('INVALID','Invalid read of the legacy draft.');
  digest(sha256);
  if(!base.legacy)return 'import';
  return recorded(base,legacyRaw,sha256)?'imported':'changed';
 }
 // One-time import of the legacy single-draft envelope, verbatim, as one new context of `bank`
 // (the freshly read bank; default empty). Every existing context is retained untouched and the
 // envelope keeps its own job: nothing is assigned or retargeted. Pure: on any refusal the given bank
 // and the legacy bytes stay as they were, and the caller reports instead of wiping either.
 // The import record is never cleared afterwards, so archiving or deleting the imported conversation never imports it again.
 function migrate(legacyRaw,options){
  const {contextId,now,validate,sha256,bank}=options||{};
  if(typeof legacyRaw!=='string')fail('CORRUPT','There is no legacy draft.');
  digest(sha256);
  const base=bank==null?empty():bank;checkBank(base,'INVALID');
  if(base.legacy!==null){
   if(recorded(base,legacyRaw,sha256))fail('MIGRATED','The legacy draft was already imported.');
   fail('LEGACY_CHANGED','The legacy draft changed after the import (older version of the app). It was not imported again; export its raw record.');
  }
  let envelope;try{envelope=JSON.parse(legacyRaw);}catch{fail('CORRUPT','The legacy draft is damaged.');}
  checkEnvelope(envelope,'CORRUPT');
  if(typeof validate==='function'){try{validate(envelope);}catch(e){fail('CORRUPT',e&&e.message||'The legacy draft did not pass validation.');}}
  const source=sourceOf(envelope);
  if(source!==null&&sourceHolder(base,source))fail('DUPLICATE','The chat from the legacy draft is already in the saved chats (active, archived or deleted). It was not imported a second time.');
  const result=commit(base,{contextId,baseVersion:0,input:'',envelope,now}).bank;
  result.legacy={contextId,importedAt:now,chars:legacyRaw.length,sha256};
  serialize(result);
  return result;
 }
 // Persistence boundary. Writes only when the stored bytes still equal `expectedRaw`
 // (null = key absent) and reports success only after reading the new bytes back.
 function store(storage,key,bank,expectedRaw){
  if(key===LEGACY_KEY)fail('INVALID','The legacy draft is never overwritten.');
  const raw=serialize(bank),before=storage.getItem(key);
  if(before!==expectedRaw)fail('CHANGED','Storage changed in another tab. Nothing was overwritten.');
  try{storage.setItem(key,raw);}
  catch(e){
   let after;try{after=storage.getItem(key);}catch{after=undefined;}
   const error=new BankError('QUOTA','The browser refused to save (out of space?). '+(after===before?'The previous save is intact.':'Check the previous save.'));
   error.intact=after===before;throw error;
  }
  // The write did not throw, yet the bytes read back are not the bytes written. That write is UNCONFIRMED: what the browser
  // holds now is not known here, so nothing is written a second time (no rollback from memory, no repeat). The caller keeps
  // its memory as it was and must read the stored value again before it writes anything.
  if(storage.getItem(key)!==raw){
   const error=new BankError('UNCONFIRMED','The save was not confirmed: the browser returned different content than was saved. Nothing was rolled back or saved again; load the current storage or download a recovery copy.');
   error.unconfirmed=true;throw error;
  }
  return raw;
 }
 return {KEY,LEGACY_KEY,KIND,VERSION,ARCHIVE_KIND,ARCHIVE_VERSION,LIMITS,BankError,empty,newId,read,parse,serialize,get,list,latest,archived,where,usage,commit,archive,restore,retire,portable,inspect,adopt,legacyStatus,migrate,store,jobOf,isPending};
});
