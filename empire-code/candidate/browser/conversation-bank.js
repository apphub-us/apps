'use strict';
// Per-job conversation bank: pure data rules plus one storage boundary.
// No DOM, network, model input, clock or crypto access. Identities and digests are supplied by the app, never by a model.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CBank=api;})(typeof window==='object'?window:globalThis,function(){
 const KEY='empire_code_conversation_bank_v1'; // version 1 is not released yet; its shape may still be extended
 const LEGACY_KEY='empire_code_online1_draft'; // read for migration; its bytes are never written or removed by this module
 const KIND='empire-code.conversation-bank';
 const LIMITS=Object.freeze({contexts:64,perJob:16,inputChars:3000,entryChars:700000,bankChars:4000000});
 const CONTEXT_ID=/^ctx1_[0-9a-f]{32}$/,JOB_ID=/^job1_[0-9a-f]{32}$/,SHA256=/^[0-9a-f]{64}$/;
 const BANK_KEYS=['kind','version','serial','legacy','contexts'];
 const LEGACY_KEYS=['contextId','importedAt','chars','sha256'];
 const ENTRY_KEYS=['contextId','jobId','version','created','touched','createdAt','updatedAt','input','envelope'];
 const BINDING=['version','sourceId','sourceRevision','sourceSavedAt','boundState','targetJobId'];
 const RECEIPT=['jobId','itemId','materialId','revisionId'];

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
 function isPending(envelope){
  const w=workspaceOf(envelope);
  return !!(w&&(plain(w.prepared)&&w.prepared.phase==='pending'||plain(w.materialEdit)&&w.materialEdit.phase==='pending'));
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
 function checkBank(b,code){
  if(!exact(b,BANK_KEYS)||b.kind!==KIND||b.version!==1||!count(b.serial)||!Array.isArray(b.contexts))fail(code,'Nieznany układ banku rozmów.');
  const l=b.legacy;
  if(l!==null&&(!exact(l,LEGACY_KEYS)||typeof l.contextId!=='string'||!CONTEXT_ID.test(l.contextId)||!utc(l.importedAt)||!count(l.chars)||typeof l.sha256!=='string'||!SHA256.test(l.sha256)))fail(code,'Nieprawidłowy zapis migracji.');
  if(b.contexts.length>LIMITS.contexts)fail(code,'Bank rozmów przekracza limit liczby rozmów.');
  const ids=new Set(),sources=new Set(),perJob=new Map();
  for(const e of b.contexts){
   checkEntry(e,code);
   if(ids.has(e.contextId)||e.touched>b.serial)fail(code,'Niespójne wersje lub powtórzona rozmowa.');
   ids.add(e.contextId);perJob.set(e.jobId,(perJob.get(e.jobId)||0)+1);
   if(perJob.get(e.jobId)>LIMITS.perJob)fail(code,'Zbyt wiele rozmów jednej roboty.');
   // One source identity lives in exactly one context; a copy would duplicate its materials.
   const source=sourceOf(e.envelope);
   if(source!==null){if(sources.has(source))fail(code,'Ta sama tożsamość rozmowy występuje w dwóch rozmowach.');sources.add(source);}
  }
  // Contexts are never removed, so the import record always points at its imported context.
  if(l!==null&&!ids.has(l.contextId))fail(code,'Zapis migracji nie wskazuje zaimportowanej rozmowy.');
 }

 function empty(){return {kind:KIND,version:1,serial:0,legacy:null,contexts:[]};}
 function newId(crypto){
  if(!crypto||typeof crypto.getRandomValues!=='function')fail('INVALID','Brak bezpiecznych identyfikatorów.');
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  return 'ctx1_'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
 }
 // Strict read: unknown versions, extra fields and non-canonical bytes all fail closed.
 function parse(raw){
  if(typeof raw!=='string')fail('CORRUPT','Brak zapisu banku rozmów.');
  if(raw.length>LIMITS.bankChars)fail('LIMIT','Zapis banku rozmów przekracza limit rozmiaru.');
  let bank;try{bank=JSON.parse(raw);}catch{fail('CORRUPT','Zapis banku rozmów jest uszkodzony.');}
  if(plain(bank)&&bank.kind===KIND&&bank.version!==1)fail('UNSUPPORTED','Bank rozmów zapisała nowsza lub nieznana wersja aplikacji.');
  checkBank(bank,'CORRUPT');
  if(JSON.stringify(bank)!==raw)fail('CORRUPT','Zapis banku rozmów ma nieoczekiwaną postać.');
  return bank;
 }
 function serialize(bank){
  checkBank(bank,'INVALID');const raw=JSON.stringify(bank);
  if(raw.length>LIMITS.bankChars)fail('LIMIT','Bank rozmów osiągnął limit rozmiaru. Niczego nie usunięto; wyeksportuj rozmowy.');
  return raw;
 }
 // Read-only views: callers must not mutate returned entries. Latest write first.
 function get(bank,contextId){return bank.contexts.find(e=>e.contextId===contextId)||null;}
 function list(bank,jobId){
  const all=jobId===undefined?bank.contexts:bank.contexts.filter(e=>e.jobId===jobId);
  return all.slice().sort((a,b)=>b.touched-a.touched);
 }
 function latest(bank,jobId){return list(bank,jobId)[0]||null;}

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
 function guardPending(previous,next,before,after){
  if(!same(previous.state,next.state)||BINDING.some(k=>!same(before[k],after[k])))fail('INVALID','Rozpoczęty zapis blokuje zmianę szkicu, jego tożsamości i roboty.');
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
  if(isPending(previous))guardPending(previous,next,before,after);
 }
 // Entry-granular compare-and-set. `bank` must be the freshly read stored bank, so every other
 // context is carried over untouched. baseVersion 0 creates; any other mismatch is a conflict.
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
  if(previous?previous.version!==baseVersion:baseVersion!==0)fail('CONFLICT','Ta rozmowa zmieniła się w innej karcie. Niczego nie nadpisano.');
  if(next.serial>=Number.MAX_SAFE_INTEGER)fail('LIMIT','Limit wersji banku rozmów.');
  const jobId=jobOf(envelope);
  if(previous)guardIdentity(previous.envelope,envelope);
  else if(next.contexts.length>=LIMITS.contexts)fail('LIMIT','Limit '+LIMITS.contexts+' zapisanych rozmów. Niczego nie usunięto; wyeksportuj rozmowy.');
  if((!previous||previous.jobId!==jobId)&&next.contexts.filter(e=>e.jobId===jobId).length>=LIMITS.perJob)fail('LIMIT','Limit '+LIMITS.perJob+' rozmów dla jednej roboty. Niczego nie usunięto.');
  next.serial++;
  const entry={contextId,jobId,version:baseVersion+1,created:previous?previous.created:next.serial,touched:next.serial,createdAt:previous?previous.createdAt:now,updatedAt:now,input,envelope};
  if(JSON.stringify(entry).length>LIMITS.entryChars)fail('LIMIT','Rozmowa przekracza limit rozmiaru. Nie została zapisana.');
  if(previous)next.contexts[index]=entry;else next.contexts.push(entry);
  serialize(next); // also refuses a source identity already held by another context
  return {bank:next,entry};
 }
 const digest=sha256=>{if(typeof sha256!=='string'||!SHA256.test(sha256))fail('INVALID','Brak skrótu SHA-256 starszego szkicu. Migracji nie wykonano.');};
 const recorded=(bank,legacyRaw,sha256)=>bank.legacy.sha256===sha256&&bank.legacy.chars===legacyRaw.length;
 // Pure migration decision. The host takes it under its lock, from freshly read bytes of both keys
 // (legacyRaw null = key absent) and the host-computed SHA-256 (lowercase hex) of the legacy bytes.
 //  'none'     no legacy bytes and nothing recorded
 //  'import'   legacy bytes not imported yet: call migrate() with this same bank, even if it already holds contexts
 //  'imported' the legacy bytes are exactly the imported ones
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
  if(source!==null&&base.contexts.some(e=>sourceOf(e.envelope)===source))fail('DUPLICATE','Rozmowa ze starszego szkicu jest już w banku. Nie zaimportowano jej drugi raz.');
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
  if(storage.getItem(key)!==raw)fail('QUOTA','Zapis nie został potwierdzony przez przeglądarkę.');
  return raw;
 }
 return {KEY,LEGACY_KEY,KIND,LIMITS,BankError,empty,newId,parse,serialize,get,list,latest,commit,legacyStatus,migrate,store,jobOf,isPending};
});
