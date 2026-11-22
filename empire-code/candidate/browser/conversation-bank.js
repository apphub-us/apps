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
 const MANAGE=' Otwórz „Zarządzaj rozmowami”.';

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
  if(!plain(envelope)||!plain(envelope.state)||!Array.isArray(envelope.state.items)||!Array.isArray(envelope.state.history))fail(code,'Nieprawidłowy szkic rozmowy.');
  if(envelope.workspace!=null&&!plain(envelope.workspace))fail(code,'Nieprawidłowe powiązanie rozmowy.');
  const w=workspaceOf(envelope);
  if(w&&(typeof w.sourceId!=='string'||!count(w.sourceRevision)||!Array.isArray(w.receipts)))fail(code,'Nieprawidłowa tożsamość rozmowy.');
  // When the binding carries the bound state it must be exactly the stored state (the host binds JSON.stringify(state)).
  if(w&&w.boundState!==undefined&&w.boundState!==JSON.stringify(envelope.state))fail(code,'Powiązanie rozmowy nie zgadza się z jej treścią.');
  const job=jobOf(envelope);
  if(job!==null&&(typeof job!=='string'||!JOB_ID.test(job)))fail(code,'Nieprawidłowa robota rozmowy.');
  // The assistant member is optional. When present it is an object with a receipt list; a started or disputed job action carries
  // its plan identity. A job action or a receipt exists only in a conversation that has an identity and a job.
  if(Object.hasOwn(envelope,'assistant')){
   const a=envelope.assistant;
   if(!plain(a)||!Array.isArray(a.receipts)||a.receipts.length>ACTION_RECEIPTS||!a.receipts.every(r=>plain(r)&&typeof r.planId==='string'&&r.state==='confirmed'))fail(code,'Nieprawidłowe dane asystenta rozmowy.');
   if(a.action!=null&&!(plain(a.action)&&(a.action.phase==='pending'||a.action.phase==='conflict')&&plain(a.action.plan)&&typeof a.action.plan.id==='string'&&plain(a.action.receipt)))fail(code,'Nieprawidłowy rozpoczęty zapis asystenta do roboty.');
   if((a.action!=null||a.receipts.length)&&(!w||job===null))fail(code,'Zapis asystenta do roboty bez powiązania rozmowy z robotą.');
   if(a.receipts.some(r=>r.sourceId!==w.sourceId||r.jobId!==job)||new Set(a.receipts.map(r=>r.planId)).size!==a.receipts.length)fail(code,'Potwierdzenie zapisu asystenta nie należy do tej rozmowy.');
  }
 }
 function checkEntry(e,code){
  if(!exact(e,ENTRY_KEYS))fail(code,'Nieznany układ zapisanej rozmowy.');
  if(typeof e.contextId!=='string'||!CONTEXT_ID.test(e.contextId))fail(code,'Nieprawidłowy identyfikator rozmowy.');
  if(![e.version,e.created,e.touched].every(n=>count(n)&&n>=1)||e.created>e.touched)fail(code,'Nieprawidłowa wersja rozmowy.');
  if(!utc(e.createdAt)||!utc(e.updatedAt))fail(code,'Nieprawidłowy czas rozmowy.');
  if(typeof e.input!=='string'||e.input.length>LIMITS.inputChars)fail(code,'Nieprawidłowy niewysłany tekst.');
  checkEnvelope(e.envelope,code);
  if(e.jobId!==jobOf(e.envelope))fail(code,'Rozmowa wskazuje inną robotę niż jej powiązanie.');
  if(JSON.stringify(e).length>LIMITS.entryChars)fail(code,'Rozmowa przekracza limit rozmiaru.');
 }
 function checkLegacy(l,code){
  if(l!==null&&(!exact(l,LEGACY_KEYS)||typeof l.contextId!=='string'||!CONTEXT_ID.test(l.contextId)||!utc(l.importedAt)||!count(l.chars)||typeof l.sha256!=='string'||!SHA256.test(l.sha256)))fail(code,'Nieprawidłowy zapis migracji.');
 }
 // Released layout 1, unchanged. Used only to read a stored version 1 value before its migration.
 function checkBankV1(b,code){
  if(!exact(b,BANK_KEYS_V1)||b.kind!==KIND||b.version!==1||!count(b.serial)||!Array.isArray(b.contexts))fail(code,'Nieznany układ banku rozmów.');
  const l=b.legacy;checkLegacy(l,code);
  if(b.contexts.length>LIMITS.contexts)fail(code,'Bank rozmów przekracza limit liczby rozmów.');
  const ids=new Set(),sources=new Set(),perJob=new Map();
  for(const e of b.contexts){
   checkEntry(e,code);
   if(ids.has(e.contextId)||e.touched>b.serial)fail(code,'Niespójne wersje lub powtórzona rozmowa.');
   ids.add(e.contextId);perJob.set(e.jobId,(perJob.get(e.jobId)||0)+1);
   if(perJob.get(e.jobId)>LIMITS.perJob)fail(code,'Zbyt wiele rozmów jednej roboty.');
   const source=sourceOf(e.envelope);
   if(source!==null){if(sources.has(source))fail(code,'Ta sama tożsamość rozmowy występuje w dwóch rozmowach.');sources.add(source);}
  }
  if(l!==null&&!ids.has(l.contextId))fail(code,'Zapis migracji nie wskazuje zaimportowanej rozmowy.');
 }
 // Compact and bounded: identity, last stored version and the acknowledgement receipts, verbatim. No draft, history or text.
 function checkRetired(t,code){
  if(Object.hasOwn(t||{},'actions')&&!(exact(t,RETIRED_KEYS_ACTIONS)&&Array.isArray(t.actions)&&t.actions.length>=1&&t.actions.length<=ACTION_RECEIPTS&&t.sourceId!==null&&t.jobId!==null&&t.actions.every(r=>plain(r)&&typeof r.planId==='string'&&r.sourceId===t.sourceId&&r.jobId===t.jobId)))fail(code,'Nieprawidłowe potwierdzenia zapisów asystenta usuniętej rozmowy.');
  if(!(exact(t,RETIRED_KEYS)||exact(t,RETIRED_KEYS_ACTIONS))||typeof t.contextId!=='string'||!CONTEXT_ID.test(t.contextId)||!utc(t.retiredAt)||!(count(t.version)&&t.version>=1)||!(count(t.serial)&&t.serial>=1))fail(code,'Nieprawidłowy zapis usuniętej rozmowy.');
  if(t.jobId!==null&&(typeof t.jobId!=='string'||!JOB_ID.test(t.jobId)))fail(code,'Nieprawidłowa robota usuniętej rozmowy.');
  if(!Array.isArray(t.receipts)||!t.receipts.every(plain))fail(code,'Nieprawidłowe potwierdzenia usuniętej rozmowy.');
  if(t.sourceId===null?(t.sourceRevision!==null||t.receipts.length>0):(typeof t.sourceId!=='string'||!count(t.sourceRevision)))fail(code,'Nieprawidłowa tożsamość usuniętej rozmowy.');
  if(JSON.stringify(t).length>LIMITS.retiredChars)fail(code,'Zapis usuniętej rozmowy przekracza limit rozmiaru.');
 }
 function checkBank(b,code){
  if(!exact(b,BANK_KEYS)||b.kind!==KIND||b.version!==VERSION||!count(b.serial)||!Array.isArray(b.contexts)||!Array.isArray(b.archived)||!Array.isArray(b.retired))fail(code,'Nieznany układ banku rozmów.');
  const l=b.legacy;checkLegacy(l,code);
  if(b.contexts.length>LIMITS.contexts)fail(code,'Bank rozmów przekracza limit liczby aktywnych rozmów.');
  if(b.archived.length>LIMITS.archived)fail(code,'Bank rozmów przekracza limit archiwum.');
  if(b.retired.length>LIMITS.retired)fail(code,'Bank rozmów przekracza limit zapisów o usuniętych rozmowach.');
  // One conversation identity and one source identity live in exactly one place: active, archived or retired.
  const ids=new Set(),sources=new Set(),perJob=new Map();
  const claim=(id,source,serial)=>{
   if(ids.has(id)||serial>b.serial)fail(code,'Niespójne wersje lub powtórzona rozmowa.');
   ids.add(id);
   if(source!==null){if(sources.has(source))fail(code,'Ta sama tożsamość rozmowy występuje w dwóch rozmowach.');sources.add(source);}
  };
  for(const e of b.contexts){
   checkEntry(e,code);claim(e.contextId,sourceOf(e.envelope),e.touched);
   perJob.set(e.jobId,(perJob.get(e.jobId)||0)+1);
   if(perJob.get(e.jobId)>LIMITS.perJob)fail(code,'Zbyt wiele aktywnych rozmów jednej roboty.');
  }
  for(const a of b.archived){
   if(!exact(a,ARCHIVED_KEYS)||!utc(a.archivedAt))fail(code,'Nieznany układ zarchiwizowanej rozmowy.');
   checkEntry(a.entry,code);claim(a.entry.contextId,sourceOf(a.entry.envelope),a.entry.touched);
  }
  for(const t of b.retired){checkRetired(t,code);claim(t.contextId,t.sourceId,t.serial);}
  // The import record of the legacy draft is permanent; its conversation may be active, archived or deleted, never unknown.
  if(l!==null&&!ids.has(l.contextId))fail(code,'Zapis migracji nie wskazuje zaimportowanej rozmowy.');
 }

 function empty(){return {kind:KIND,version:VERSION,serial:0,legacy:null,contexts:[],archived:[],retired:[]};}
 function newId(crypto){
  if(!crypto||typeof crypto.getRandomValues!=='function')fail('INVALID','Brak bezpiecznych identyfikatorów.');
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  return 'ctx1_'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
 }
 // Strict read of a stored value: {stored,bank}. `stored` is the layout found in storage (1 or 2); `bank` is always layout 2.
 // Unknown versions, extra fields and non-canonical bytes all fail closed. For a version 1 value the conversations and the
 // legacy record are carried over as they are; nothing is normalised, dropped or renumbered. Nothing is written here.
 function read(raw){
  if(typeof raw!=='string')fail('CORRUPT','Brak zapisu banku rozmów.');
  if(raw.length>LIMITS.bankChars+LAYOUT_ROOM)fail('LIMIT','Zapis banku rozmów przekracza limit rozmiaru.');
  let bank;try{bank=JSON.parse(raw);}catch{fail('CORRUPT','Zapis banku rozmów jest uszkodzony.');}
  const tagged=plain(bank)&&bank.kind===KIND;
  if(tagged&&bank.version===1){
   if(raw.length>LIMITS.bankChars)fail('LIMIT','Zapis banku rozmów przekracza limit rozmiaru.');
   checkBankV1(bank,'CORRUPT');
   if(JSON.stringify(bank)!==raw)fail('CORRUPT','Zapis banku rozmów ma nieoczekiwaną postać.');
   const next={kind:KIND,version:VERSION,serial:bank.serial,legacy:bank.legacy,contexts:bank.contexts,archived:[],retired:[]};
   checkBank(next,'CORRUPT');
   return {stored:1,bank:next};
  }
  if(tagged&&bank.version!==VERSION)fail('UNSUPPORTED','Bank rozmów zapisała nowsza lub nieznana wersja aplikacji.');
  checkBank(bank,'CORRUPT');
  if(JSON.stringify(bank)!==raw)fail('CORRUPT','Zapis banku rozmów ma nieoczekiwaną postać.');
  return {stored:VERSION,bank};
 }
 // Strict read of a value that must already be in the current layout.
 function parse(raw){
  const r=read(raw);
  if(r.stored!==VERSION)fail('OUTDATED','Zapis banku rozmów ma starszy układ i czeka na migrację przy otwarciu strony.');
  return r.bank;
 }
 function serialize(bank){
  checkBank(bank,'INVALID');const raw=JSON.stringify(bank);
  if(raw.length>LIMITS.bankChars+LAYOUT_ROOM)fail('LIMIT','Zapisane rozmowy osiągnęły limit rozmiaru. Niczego nie usunięto ani nie zapisano. Miejsce zwalnia usunięcie rozmowy (archiwum też je zajmuje) — najpierw ją wyeksportuj.'+MANAGE);
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
  if(!was||was.phase!=='pending'){if(!same(a,b))fail('INVALID','Rozpoczęty zapis blokuje zmianę danych asystenta tej rozmowy.');return;}
  const part=(m,k)=>m&&m[k]!=null?m[k]:null,now=part(b,'action'),had=a.receipts,have=actionReceipts(next);
  if(!same(part(a,'tool'),part(b,'tool')))fail('INVALID','Rozpoczęty zapis do roboty blokuje zmianę kalkulatora rozmowy.');
  if(plain(now)){
   if(plain(now.plan)&&now.plan.id===was.plan.id&&same(had,have)&&same(part(a,'proposal'),part(b,'proposal'))&&(same(now,was)||(now.phase==='conflict'&&same(now.plan,was.plan)&&same(now.input,was.input))))return;
  }else{
   if(same(had,have)&&same(part(a,'proposal'),part(b,'proposal')))return;
   const last=have[have.length-1];
   if(have.length===had.length+1&&same(have.slice(0,-1),had)&&last.planId===was.plan.id&&same(last.record,was.receipt.record))return;
  }
  fail('INVALID','Rozpoczęty zapis do roboty można tylko dokończyć tym samym planem, oznaczyć jako sporny albo zwolnić po sprawdzeniu historii roboty.');
 }
 function guardPending(previous,next,before,after){
  if(!same(previous.state,next.state)||BINDING.some(k=>!same(before[k],after[k])))fail('INVALID','Rozpoczęty zapis blokuje zmianę szkicu, jego tożsamości i roboty.');
  guardAction(previous,next);
  const part=(w,k)=>w[k]==null?null:w[k],pend=k=>plain(before[k])&&before[k].phase==='pending';
  const keeps=k=>same(part(before,k),part(after,k)),receipts=want=>want!==null&&sameReceipts(want,after.receipts);
  if(keeps('prepared')&&keeps('materialEdit')&&receipts(before.receipts))return;
  if(pend('prepared')&&!pend('materialEdit')&&keeps('materialEdit')&&part(after,'prepared')===null&&receipts(createReceipts(before)))return;
  if(pend('materialEdit')&&!pend('prepared')&&keeps('prepared')){
   if(part(after,'materialEdit')===null&&receipts(editReceipts(before)))return;
   if(same(part(after,'materialEdit'),{...before.materialEdit,phase:'conflict'})&&receipts(before.receipts))return;
  }
  fail('INVALID','Rozpoczęty zapis można tylko dokończyć tym samym planem i jego dokładnym potwierdzeniem.');
 }
 // A context keeps its source identity and its job, never moves backwards and never loses a receipt.
 function guardIdentity(previous,next){
  const before=workspaceOf(previous),after=workspaceOf(next);
  if(!before)return;
  if(!after||after.sourceId!==before.sourceId)fail('INVALID','Tożsamość rozmowy nie może się zmienić.');
  if(after.sourceRevision<before.sourceRevision)fail('INVALID','Wersja rozmowy nie może się cofnąć.');
  // Explicit assignment null -> job is the only job change; an assigned conversation is never moved or detached.
  const job=jobOf(previous);
  if(job!==null&&jobOf(next)!==job)fail('INVALID','Rozmowa przypisana do roboty nie może zostać przeniesiona ani odpięta.');
  for(const r of before.receipts){
   if(!after.receipts.some(x=>plain(x)&&plain(r)&&x.jobId===r.jobId&&x.itemId===r.itemId&&x.materialId===r.materialId))fail('INVALID','Potwierdzenie zapisanego materiału nie może zniknąć.');
  }
  // Confirmed job-action receipts of the conversation are kept verbatim as well.
  const kept=actionReceipts(next);
  for(const r of actionReceipts(previous))if(!kept.some(x=>same(x,r)))fail('INVALID','Potwierdzenie zapisu asystenta do roboty nie może zniknąć.');
  if(isPending(previous))guardPending(previous,next,before,after);
 }
 const GONE={archived:['ARCHIVED','Ta rozmowa jest w archiwum (zarchiwizowano ją w innej karcie). Niczego nie zapisano; przywróć ją w „Zarządzaj rozmowami”.'],retired:['RETIRED','Ta rozmowa została usunięta. Zwykły zapis jej nie przywraca i niczego nie zapisano; pobierz kopię awaryjną ekranu.']};
 // The active-count limits, checked before anything is changed. Nothing is ever evicted to make room.
 function room(next,jobId,verb){
  if(next.contexts.length>=LIMITS.contexts)fail('LIMIT','Limit '+LIMITS.contexts+' aktywnych rozmów. '+verb+' Zarchiwizuj jedną z aktywnych rozmów, aby zwolnić miejsce — niczego nie usunięto.'+MANAGE);
  if(next.contexts.filter(e=>e.jobId===jobId).length>=LIMITS.perJob)fail('LIMIT','Limit '+LIMITS.perJob+' aktywnych rozmów jednej roboty. '+verb+' Zarchiwizuj jedną z rozmów tej roboty, aby zwolnić miejsce — niczego nie usunięto.'+MANAGE);
 }
 // Entry-granular compare-and-set. `bank` must be the freshly read stored bank, so every other
 // context is carried over untouched. baseVersion 0 creates; any other mismatch is a conflict.
 // An archived or deleted conversation is never written by this path, whatever version the caller holds.
 function commit(bank,change){
  checkBank(bank,'INVALID');
  const {contextId,baseVersion,input,now}=change||{};
  if(typeof contextId!=='string'||!CONTEXT_ID.test(contextId)||!count(baseVersion)||!utc(now))fail('INVALID','Nieprawidłowa zmiana rozmowy.');
  if(typeof input!=='string')fail('INVALID','Nieprawidłowy niewysłany tekst.');
  if(input.length>LIMITS.inputChars)fail('LIMIT','Niewysłany tekst przekracza limit '+LIMITS.inputChars+' znaków. Nie został skrócony ani zapisany.');
  // Every rule below is applied to exactly the value that would be stored.
  let envelope;try{envelope=clone(change.envelope);}catch{envelope=undefined;}
  checkEnvelope(envelope,'INVALID');
  const next=clone(bank),index=next.contexts.findIndex(e=>e.contextId===contextId),previous=index<0?null:next.contexts[index];
  if(!previous){const held=where(next,contextId);if(held)fail(...GONE[held.state]);}
  if(previous?previous.version!==baseVersion:baseVersion!==0)fail('CONFLICT','Ta rozmowa zmieniła się w innej karcie. Niczego nie nadpisano.');
  if(next.serial>=Number.MAX_SAFE_INTEGER)fail('LIMIT','Limit wersji banku rozmów.');
  const jobId=jobOf(envelope),source=sourceOf(envelope);
  if(source!==null){
   const holder=sourceHolder(next,source);
   if(holder&&holder.contextId!==contextId)fail(holder.state==='retired'?'RETIRED':'DUPLICATE',holder.state==='retired'?'Ta tożsamość szkicu należy do usuniętej rozmowy. Zwykły zapis jej nie przywraca; niczego nie zapisano.':'Ta sama tożsamość rozmowy występuje już w innej rozmowie. Niczego nie zapisano.');
  }
  if(previous)guardIdentity(previous.envelope,envelope);
  if(!previous||previous.jobId!==jobId){
   if(!previous)room(next,jobId,'Nowa rozmowa nie powstała.');
   else if(next.contexts.filter(e=>e.jobId===jobId).length>=LIMITS.perJob)fail('LIMIT','Limit '+LIMITS.perJob+' aktywnych rozmów jednej roboty. Niczego nie przypisano ani nie usunięto; zarchiwizuj jedną z rozmów tej roboty.'+MANAGE);
  }
  next.serial++;
  const entry={contextId,jobId,version:baseVersion+1,created:previous?previous.created:next.serial,touched:next.serial,createdAt:previous?previous.createdAt:now,updatedAt:now,input,envelope};
  if(JSON.stringify(entry).length>LIMITS.entryChars)fail('LIMIT','Rozmowa przekracza limit rozmiaru. Nie została zapisana; wyeksportuj ją i zacznij nową.');
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
  if(typeof contextId!=='string'||!CONTEXT_ID.test(contextId)||!count(baseVersion)||baseVersion<1||!utc(now))fail('INVALID','Nieprawidłowa operacja na rozmowie.');
  const next=clone(bank);
  if(next.serial>=Number.MAX_SAFE_INTEGER)fail('LIMIT','Limit wersji banku rozmów.');
  return next;
 }
 const unseen=()=>fail('CONFLICT','Ta rozmowa zmieniła się lub zniknęła w innej karcie. Niczego nie zmieniono.');
 const started=what=>fail('PENDING','W tej rozmowie rozpoczęto zapis do roboty. '+what+' jest zablokowane, dopóki ten zapis nie zostanie dokończony („Wznów zapis”). Niczego nie zmieniono.');
 // The moved entry keeps every field; only its compare-and-set version and its ordering stamp advance, so a tab that still
 // holds the previous version can no longer write it.
 const advance=(next,entry)=>({...entry,version:entry.version+1,touched:++next.serial});
 function archive(bank,change){
  const next=manage(bank,change),at=next.contexts.findIndex(e=>e.contextId===change.contextId);
  if(at<0||next.contexts[at].version!==change.baseVersion)unseen();
  if(isPending(next.contexts[at].envelope))started('Archiwizowanie');
  if(next.archived.length>=LIMITS.archived)fail('LIMIT','Limit '+LIMITS.archived+' rozmów w archiwum. Niczego nie zmieniono; wyeksportuj i usuń z archiwum rozmowy, których już nie potrzebujesz.');
  const entry=advance(next,next.contexts[at]);
  next.contexts.splice(at,1);next.archived.push({archivedAt:change.now,entry});
  serialize(next);
  return {bank:next,entry};
 }
 function restore(bank,change){
  const next=manage(bank,change),at=next.archived.findIndex(a=>a.entry.contextId===change.contextId);
  if(at<0||next.archived[at].entry.version!==change.baseVersion)unseen();
  room(next,next.archived[at].entry.jobId,'Rozmowa pozostaje w archiwum w całości.');
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
  if(isPending(entry.envelope))started('Usuwanie');
  if(next.retired.length>=LIMITS.retired)fail('LIMIT','Limit '+LIMITS.retired+' zapisów o usuniętych rozmowach. Te krótkie zapisy nie są usuwane po cichu, więc tej rozmowy nie usunięto. Można ją zarchiwizować i wyeksportować.');
  const tombstone={contextId:entry.contextId,jobId:entry.jobId,sourceId:w?w.sourceId:null,sourceRevision:w?w.sourceRevision:null,version:entry.version,receipts:w?clone(w.receipts):[],retiredAt:change.now,serial:++next.serial};
  // Receipts of notes / measurements written from this conversation stay with the deletion record, verbatim.
  const acts=actionReceipts(entry.envelope);if(acts.length)tombstone.actions=clone(acts);
  if(JSON.stringify(tombstone).length>LIMITS.retiredChars)fail('LIMIT','Zapis o usunięciu tej rozmowy przekroczyłby limit rozmiaru. Niczego nie usunięto; rozmowę można zarchiwizować.');
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
  if(!exact(a,ARCHIVE_KEYS)||a.kind!==ARCHIVE_KIND||a.version!==ARCHIVE_VERSION||!utc(a.exportedAt)||(a.origin!=='active'&&a.origin!=='archived'))fail(code,'Nieznany układ archiwum rozmowy. Niczego nie zmieniono.');
  checkEntry(a.entry,code);
  if([a.entry.version,a.entry.created,a.entry.touched].some(n=>n>COUNTER_MAX)||(Array.isArray(a.recovery)&&a.recovery.some(r=>plain(r)&&r.baseVersion>COUNTER_MAX)))fail(code,'Nieprawidłowe liczniki wersji w archiwum rozmowy. Niczego nie zmieniono.');
  if(typeof a.unsentText!=='string'||a.unsentText.length>LIMITS.inputChars)fail(code,'Nieprawidłowy niewysłany tekst w archiwum rozmowy. Niczego nie zmieniono.');
  if(!Array.isArray(a.recovery)||a.recovery.length>LIMITS.recoveryTexts||a.recovery.some(r=>!exact(r,RECOVERY_KEYS)||typeof r.text!=='string'||r.text.length>LIMITS.inputChars||!utc(r.savedAt)||!count(r.baseVersion)))fail(code,'Nieprawidłowe kopie niewysłanego tekstu w archiwum rozmowy. Niczego nie zmieniono.');
 }
 // The stored entry, verbatim, plus the exact text of the message field (which may be ahead of the stored text) and the
 // unsent texts kept for this conversation by the recovery journal. options: {exportedAt,unsentText?,recovery?}.
 function portable(bank,contextId,options){
  checkBank(bank,'INVALID');
  const o=options||{},held=where(bank,contextId);
  if(!held||held.state==='retired')fail('MISSING','Tej rozmowy nie ma w zapisie przeglądarki; nie można utworzyć jej archiwum.');
  const out={kind:ARCHIVE_KIND,version:ARCHIVE_VERSION,exportedAt:o.exportedAt,origin:held.state,entry:clone(held.entry),unsentText:o.unsentText===undefined?held.entry.input:o.unsentText,recovery:clone(o.recovery||[])};
  checkArchive(out,'INVALID');
  return out;
 }
 function difference(stored,file){
  const a=workspaceOf(stored.envelope),b=workspaceOf(file.envelope),ra=a?a.sourceRevision:-1,rb=b?b.sourceRevision:-1;
  const relation=rb<ra||(rb===ra&&file.version<stored.version)?'older':rb>ra||file.version>stored.version?'newer':'diverged';
  const label={older:'starszy stan tej rozmowy',newer:'nowszy stan tej rozmowy',diverged:'inny stan tej rozmowy przy tej samej wersji'}[relation];
  return {relation,reason:'Ta rozmowa jest już w tej przeglądarce, a plik zawiera '+label+' (plik: wersja '+file.version+', rewizja szkicu '+(b?rb:'—')+'; przeglądarka: wersja '+stored.version+', rewizja szkicu '+(a?ra:'—')+'). Import niczego nie nadpisuje ani nie scala.'};
 }
 // Empty string = the file is exactly compatible with the deletion record.
 function retiredMismatch(t,entry,w,source){
  if(t.contextId!==entry.contextId||t.sourceId!==source)return 'identyfikatory rozmowy i szkicu nie wskazują razem tego samego usuniętego zapisu.';
  if(t.jobId!==entry.jobId)return 'plik wskazuje inną robotę niż usunięta rozmowa.';
  if(entry.version>t.version||(w&&w.sourceRevision>t.sourceRevision))return 'plik jest nowszy niż stan z chwili usunięcia, więc pochodzi z innego zapisu.';
  if(w&&!sameReceipts(t.receipts,w.receipts))return 'potwierdzenia materiałów zapisanych do roboty różnią się (plik: '+w.receipts.length+', w chwili usunięcia: '+t.receipts.length+'), a przywrócenie mogłoby powielić lub zgubić powiązania materiałów.';
  const byPlan=list=>list.slice().sort((x,y)=>String(x&&x.planId)<String(y&&y.planId)?-1:1);
  if(!same(byPlan(t.actions||[]),byPlan(actionReceipts(entry.envelope))))return 'potwierdzenia notatek i pomiarów zapisanych do roboty z tej rozmowy różnią się od stanu z chwili usunięcia (plik: '+actionReceipts(entry.envelope).length+', w chwili usunięcia: '+(t.actions||[]).length+').';
  return '';
 }
 // Reads and classifies an archive file against the given bank. Pure; throws BankError for anything that is not a valid archive.
 function classify(text,bank,validate){
  if(typeof text!=='string')fail('CORRUPT','Brak treści pliku. Niczego nie zmieniono.');
  if(text.length>LIMITS.importChars)fail('LIMIT','Plik przekracza limit rozmiaru importu ('+LIMITS.importChars+' znaków). Niczego nie zmieniono.');
  let a;try{a=JSON.parse(text);}catch{fail('CORRUPT','Plik nie jest poprawnym zapisem JSON. Niczego nie zmieniono.');}
  if(plain(a)&&RAW_KINDS.includes(a.kind))fail('RAW','To surowa kopia awaryjna zapisu przeglądarki, a nie archiwum rozmowy. Służy do ręcznego odzyskiwania; nie jest importowana ani otwierana jako szkic. Niczego nie zmieniono.');
  if(plain(a)&&a.kind===OLD_DRAFT_KIND)fail('UNSUPPORTED','To eksport szkicu ze starszej wersji aplikacji, bez pełnego stanu rozmowy. Pozostaje plikiem do odczytu; nie jest importowany. Niczego nie zmieniono.');
  if(plain(a)&&a.kind===ARCHIVE_KIND&&a.version!==ARCHIVE_VERSION)fail('UNSUPPORTED','Archiwum rozmowy zapisała nowsza lub nieznana wersja aplikacji. Niczego nie zmieniono.');
  if(unsafeKey(a))fail('CORRUPT','Plik zawiera niedozwolone nazwy pól (__proto__, constructor lub prototype). Nie jest archiwum rozmowy z tej aplikacji; niczego nie zmieniono.');
  checkArchive(a,'CORRUPT');
  if(typeof validate==='function'){try{validate(a.entry.envelope);}catch(e){fail('CORRUPT',(e&&e.message||'Rozmowa z pliku nie przeszła walidacji.')+' Niczego nie zmieniono.');}}
  const entry=a.entry,env=entry.envelope,w=workspaceOf(env),source=sourceOf(env);
  const held=where(bank,entry.contextId),holder=source===null?null:sourceHolder(bank,source);
  const p={archive:a,contextId:entry.contextId,jobId:entry.jobId,sourceId:source,version:entry.version,sourceRevision:w?w.sourceRevision:null,items:env.state.items.length,history:env.state.history.length,receipts:w?w.receipts.length:0,
   unsentText:a.unsentText,recovery:a.recovery.length,exportedAt:a.exportedAt,origin:a.origin,outcome:'new',relation:'',reason:'',restorable:false,retiredAt:null};
  // Assistant data of the file, for the preview only: the calculator kept in the conversation, an unconfirmed proposal, receipts.
  const helper=assistantOf(env);
  p.assistant={tool:helper&&plain(helper.tool)&&typeof helper.tool.tool==='string'?helper.tool.tool:'',proposal:!!(helper&&plain(helper.proposal)),conflict:!!(helper&&plain(helper.action)),receipts:actionReceipts(env).length};
  if(isPending(env)){p.outcome='blocked';p.reason='Plik zawiera rozpoczęty, niedokończony zapis do roboty. Dokończ go w przeglądarce, z której pochodzi plik, i wyeksportuj rozmowę ponownie. Niczego nie zmieniono.';}
  else if(held&&held.state!=='retired'){
   if(same(held.entry.envelope,env)&&held.entry.input===a.unsentText)p.outcome='identical';
   else{const d=difference(held.entry,entry);p.outcome='conflict';p.relation=d.relation;p.reason=d.reason;}
  }
  else if(holder&&holder.state!=='retired'){p.outcome='conflict';p.relation='source';p.reason='Tożsamość szkicu z pliku należy już do innej rozmowy w tej przeglądarce. Import powieliłby jej powiązania z materiałami, więc niczego nie zmieniono.';}
  else if(held||holder){
   const t=(held||holder).tombstone,why=retiredMismatch(t,entry,w,source);
   p.outcome='retired';p.retiredAt=t.retiredAt;p.restorable=!why;
   p.reason=why?'Ta rozmowa została usunięta w tej przeglądarce, a plik nie odpowiada zapisowi jej usunięcia: '+why+' Pliku nie zaimportowano.':'Ta rozmowa została usunięta w tej przeglądarce. Plik zgadza się z zapisem usunięcia (ta sama rozmowa, robota i potwierdzenia materiałów). Przywrócenie wymaga jawnego potwierdzenia.';
  }
  // A file that would be added must not bring acknowledgements of materials that another conversation of this browser already
  // holds (also a deleted one): two conversations bound to the same written material could each rewrite it.
  if((p.outcome==='new'||(p.outcome==='retired'&&p.restorable))&&w&&receiptClaimed(bank,entry.contextId,w.receipts)){
   p.outcome='conflict';p.relation='receipts';p.restorable=false;
   p.reason='Plik zawiera potwierdzenia materiałów, które w tej przeglądarce należą już do innej rozmowy (także usuniętej). Import powieliłby powiązania tych materiałów, więc niczego nie zmieniono.';
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
  if((destination!=='active'&&destination!=='archived')||!utc(now))fail('INVALID','Nieprawidłowy import rozmowy.');
  const p=classify(text,bank,validate),a=p.archive;
  if(p.outcome==='identical')return {bank,entry:where(bank,p.contextId).entry,changed:false,outcome:p.outcome,recovery:[]};
  if(p.outcome==='blocked')fail('PENDING',p.reason);
  if(p.outcome==='conflict')fail('CONFLICT',p.reason);
  if(p.outcome==='retired'){
   if(!p.restorable)fail('RETIRED',p.reason);
   if(restoreRetired!==true)fail('RETIRED','Ta rozmowa została usunięta w tej przeglądarce. Jej przywrócenie z pliku wymaga jawnego potwierdzenia w podglądzie importu. Niczego nie zmieniono.');
  }
  const next=clone(bank);
  if(next.serial>=Number.MAX_SAFE_INTEGER)fail('LIMIT','Limit wersji banku rozmów.');
  let version=a.entry.version;
  if(p.outcome==='retired'){const at=next.retired.findIndex(t=>t.contextId===p.contextId);version=next.retired[at].version+1;next.retired.splice(at,1);}
  next.serial++;
  const entry={contextId:a.entry.contextId,jobId:a.entry.jobId,version,created:next.serial,touched:next.serial,createdAt:a.entry.createdAt,updatedAt:a.entry.updatedAt,input:a.unsentText,envelope:clone(a.entry.envelope)};
  if(JSON.stringify(entry).length>LIMITS.entryChars)fail('LIMIT','Rozmowa z pliku przekracza limit rozmiaru. Niczego nie zmieniono.');
  if(destination==='active'){room(next,entry.jobId,'Rozmowy z pliku nie dodano do aktywnych.');next.contexts.push(entry);}
  else{
   if(next.archived.length>=LIMITS.archived)fail('LIMIT','Limit '+LIMITS.archived+' rozmów w archiwum. Rozmowy z pliku nie dodano; niczego nie usunięto.');
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

 const digest=sha256=>{if(typeof sha256!=='string'||!SHA256.test(sha256))fail('INVALID','Brak skrótu SHA-256 starszego szkicu. Migracji nie wykonano.');};
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
  if(typeof legacyRaw!=='string')fail('INVALID','Nieprawidłowy odczyt starszego szkicu.');
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
  if(typeof legacyRaw!=='string')fail('CORRUPT','Brak starszego szkicu.');
  digest(sha256);
  const base=bank==null?empty():bank;checkBank(base,'INVALID');
  if(base.legacy!==null){
   if(recorded(base,legacyRaw,sha256))fail('MIGRATED','Starszy szkic został już zaimportowany.');
   fail('LEGACY_CHANGED','Starszy szkic zmienił się po imporcie (starsza wersja aplikacji). Nie zaimportowano go ponownie; wyeksportuj jego surowy zapis.');
  }
  let envelope;try{envelope=JSON.parse(legacyRaw);}catch{fail('CORRUPT','Starszy szkic jest uszkodzony.');}
  checkEnvelope(envelope,'CORRUPT');
  if(typeof validate==='function'){try{validate(envelope);}catch(e){fail('CORRUPT',e&&e.message||'Starszy szkic nie przeszedł walidacji.');}}
  const source=sourceOf(envelope);
  if(source!==null&&sourceHolder(base,source))fail('DUPLICATE','Rozmowa ze starszego szkicu jest już w banku (aktywna, w archiwum albo usunięta). Nie zaimportowano jej drugi raz.');
  const result=commit(base,{contextId,baseVersion:0,input:'',envelope,now}).bank;
  result.legacy={contextId,importedAt:now,chars:legacyRaw.length,sha256};
  serialize(result);
  return result;
 }
 // Persistence boundary. Writes only when the stored bytes still equal `expectedRaw`
 // (null = key absent) and reports success only after reading the new bytes back.
 function store(storage,key,bank,expectedRaw){
  if(key===LEGACY_KEY)fail('INVALID','Starszy szkic nie jest nigdy nadpisywany.');
  const raw=serialize(bank),before=storage.getItem(key);
  if(before!==expectedRaw)fail('CHANGED','Zapis zmienił się w innej karcie. Niczego nie nadpisano.');
  try{storage.setItem(key,raw);}
  catch(e){
   let after;try{after=storage.getItem(key);}catch{after=undefined;}
   const error=new BankError('QUOTA','Przeglądarka odmówiła zapisu (brak miejsca?). '+(after===before?'Poprzedni zapis pozostał nienaruszony.':'Sprawdź poprzedni zapis.'));
   error.intact=after===before;throw error;
  }
  // The write did not throw, yet the bytes read back are not the bytes written. That write is UNCONFIRMED: what the browser
  // holds now is not known here, so nothing is written a second time (no rollback from memory, no repeat). The caller keeps
  // its memory as it was and must read the stored value again before it writes anything.
  if(storage.getItem(key)!==raw){
   const error=new BankError('UNCONFIRMED','Zapis nie został potwierdzony: przeglądarka zwróciła inną treść niż zapisana. Niczego nie cofnięto ani nie zapisano ponownie; wczytaj aktualny zapis albo pobierz kopię awaryjną.');
   error.unconfirmed=true;throw error;
  }
  return raw;
 }
 return {KEY,LEGACY_KEY,KIND,VERSION,ARCHIVE_KIND,ARCHIVE_VERSION,LIMITS,BankError,empty,newId,read,parse,serialize,get,list,latest,archived,where,usage,commit,archive,restore,retire,portable,inspect,adopt,legacyStatus,migrate,store,jobOf,isPending};
});
