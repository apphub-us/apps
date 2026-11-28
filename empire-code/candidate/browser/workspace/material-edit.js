'use strict';
// Single linked-material correction. The original append-only store owns commit/conflict checks.
// EC-08: units and the whole-count rule are the one shared definition (EC.materialQuantity, core/src/jobs/
// materialQuantity.js), passed in as the fourth factory argument; no unit list is kept here.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.EC.conversationMaterialEdit=factory(root.EC.jobMaterial,root.EC.jobMaterialStore,root.EC.jobCard,root.EC.materialQuantity);})(typeof window==='object'?window:globalThis,function(M,Store,J,Q){
 const copy=x=>JSON.parse(JSON.stringify(x));
 const exact=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===k.length&&k.every(n=>Object.hasOwn(x,n));
 const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
 const fail=(code,message)=>({ok:false,code,problems:[message]});
 const text=(x,n,required=false)=>typeof x==='string'&&x.length<=n&&(!required||x.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
 const utc=x=>{try{return typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&new Date(x).toISOString()===x;}catch{return false;}};
 const names=['sourceId','sourceRevision','sourceSavedAt','reviewedAt','item','receipt','job','baseline','current','acknowledged','rebase'];
 function capture(input){
  if(!M.safeData(input).ok||!exact(input,names))return fail('INVALID','Invalid correction data. Nothing was saved.');
  const x=copy(input),i=x.item,r=x.receipt;
  if(!/^conv1_[a-f0-9]{32}$/.test(x.sourceId)||!Number.isSafeInteger(x.sourceRevision)||x.sourceRevision<0||x.sourceRevision>100||!utc(x.sourceSavedAt)||!utc(x.reviewedAt)||typeof x.acknowledged!=='boolean'||typeof x.rebase!=='boolean')return fail('INVALID','Invalid draft version.');
  if(!exact(i,['id','name','quantity','unit','specification','notes','review'])||!/^i\d{4}$/.test(i.id)||!text(i.name,120,true)||!text(i.specification,500)||!text(i.notes,600)||!Array.isArray(i.review)||i.review.length>8||!i.review.every(s=>text(s,220,true)))return fail('INVALID','Invalid chat item.');
  // Same reading rules as the handoff: malformed is INVALID, unknown is INCOMPLETE, and a fractional count kept from a
  // draft saved before EC-08 (0.5 roll) is readable but must be corrected by the user. Nothing is rounded or converted.
  if(!Q||typeof Q.inspectDraft!=='function')return fail('UNAVAILABLE','The shared definition of material units is unavailable. Nothing was saved.');
  const q=Q.inspectDraft(i.quantity,i.unit);
  if(!q.readable)return fail('INVALID','Invalid quantity or unit.');
  if(!q.complete)return fail('INCOMPLETE','The quantity or the unit is missing. The saved material is unchanged.');
  if(q.correctionRequired)return fail('QUANTITY_CORRECTION','Item '+i.id+' ('+i.quantity+' '+i.unit+') needs a quantity correction: pieces, boxes, packs, rolls and sets take a whole number, a fraction is allowed only for lengths. Correct the quantity in the chat to a whole number or give a length. Nothing was rounded and nothing was saved; the saved material is unchanged.');
  if(i.review.length&&!x.acknowledged)return fail('REVIEW_REQUIRED','First review the uncertainties of this item.');
  if(!exact(r,['jobId','itemId','materialId','revisionId'])||r.itemId!==i.id||!M.JOB_ID.test(r.jobId)||!M.ID.test(r.materialId)||!M.REV_ID.test(r.revisionId))return fail('INVALID','There is no valid material link.');
  if(!exact(x.job,['head','revision'])||!J.readHead(x.job.head).ok||!J.readRevision(x.job.revision).ok||x.job.head.jobId!==r.jobId||x.job.revision.jobId!==r.jobId||x.job.head.currentRevisionId!==x.job.revision.revisionId||x.job.head.revisionNumber!==x.job.revision.revisionNumber)return fail('JOB_CHANGED','The job was changed or is unavailable.');
  if(!M.readRevision(x.baseline).ok||!M.readRevision(x.current).ok||x.baseline.materialId!==r.materialId||x.current.materialId!==r.materialId||x.baseline.jobId!==r.jobId||x.current.jobId!==r.jobId||x.baseline.revisionId!==r.revisionId)return fail('LINK_CHANGED','The history does not confirm the link with this chat.');
  if(x.reviewedAt<x.current.savedAt||x.reviewedAt<x.sourceSavedAt)return fail('CLOCK_SKEW','The device time is earlier than the saved record or the draft. Nothing was saved.');
  if(x.current.revisionId!==r.revisionId&&!x.rebase)return fail('CONFLICT','The material was already changed in the job. Compare the correction with the current record; nothing was overwritten.');
  return {ok:true,input:x};
 }
 async function hash(x,crypto){if(!crypto?.subtle)throw Error('Digest unavailable');const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(x))));if(bytes.length!==32)throw Error('Invalid digest');return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
 function noteParts(x){const i=x.item,w=i.review.length?'\nReview warnings acknowledged, not electrical approval:\n'+i.review.join('\n'):'';return {prefix:i.notes+(i.notes?'\n':'')+'[Conversation '+x.sourceId+' / revision ',suffix:' / item '+i.id+']'+w};}
 function equivalentNotes(old,x){const p=noteParts(x);if(!old.startsWith(p.prefix)||!old.endsWith(p.suffix))return false;const revision=old.slice(p.prefix.length,old.length-p.suffix.length);return /^(?:0|[1-9]\d{0,2})$/.test(revision)&&Number(revision)<=100;}
 async function prepare(input,options={}){
  const checked=capture(input);if(!checked.ok)return checked;const x=checked.input,b=x.baseline.item,current=x.current.item,parts=noteParts(x);
  const proposed={label:x.item.name,quantityText:x.item.quantity,unit:x.item.unit,specification:x.item.specification,notes:parts.prefix+x.sourceRevision+parts.suffix};
  const after=copy(current),changes=[];
  // Three-way mapping: do not rewrite unrelated job-only fields or manually changed fields
  // that the conversational item did not actually change relative to its linked revision.
  for(const k of Object.keys(proposed)){
   const changed=k==='notes'?!equivalentNotes(b.notes,x):b[k]!==proposed[k];
   if(changed&&current[k]!==proposed[k]){after[k]=proposed[k];changes.push({field:k,before:current[k],after:proposed[k]});}
  }
  const valid=M.validateFields(after);if(!valid.ok)return valid;
  if(!changes.length)return {ok:true,unchanged:true};
  try{
   const digest=await hash(['ec-material-edit-v1',x],options.crypto),id='edit1_'+digest;
   const revisionId='trev1_'+(await hash(['ec-material-edit-revision-v1',id],options.crypto)).slice(0,32);
   const reason='Conversation correction '+x.sourceId+' / revision '+x.sourceRevision+' / item '+x.item.id+(x.rebase?' — explicitly compared with newer job record':'');
   const made=M.createUpdate(x.current,valid.fields,reason,{revisionId,jobRevisionId:x.job.head.currentRevisionId,savedAt:x.reviewedAt});
   if(!made.ok)return made;if(made.unchanged)return {ok:true,unchanged:true};
   return {ok:true,unchanged:false,plan:{kind:'empire-code.material-edit',version:1,id,input:x,revision:made.revision,changes}};
  }catch{return fail('UNAVAILABLE','A stable identifier of the correction cannot be prepared.');}
 }
 function sourceMatches(x,s){return s&&canonical(s)===canonical({sourceId:x.sourceId,sourceRevision:x.sourceRevision,sourceSavedAt:x.sourceSavedAt,item:x.item,receipt:x.receipt});}
 async function commit(plan,source,confirmation,options={}){
  let store,entered=false,readStarted=false;
  try{
   if(!M.safeData(plan).ok||!M.safeData(source).ok||!M.safeData(confirmation).ok||!exact(plan,['kind','version','id','input','revision','changes'])||!exact(confirmation,['accepted','planId'])||confirmation.accepted!==true||typeof confirmation.planId!=='string'||confirmation.planId!==plan.id)return fail('CONFIRMATION','Confirm exactly this correction.');
   const held=copy(plan),live=copy(source),fresh=await prepare(held.input,options);
   if(!fresh.ok||fresh.unchanged||canonical(fresh.plan)!==canonical(held)||!sourceMatches(held.input,live))return fail('STALE','The draft or the correction summary has changed. Nothing was saved.');
   if(!options.indexedDB||typeof options.readJob!=='function')return fail('UNAVAILABLE','The local material store is unavailable.');
   readStarted=true;let randomUsed=false;const crypto={getRandomValues(bytes){if(randomUsed||bytes.length!==16)throw Error('Unexpected second identity');randomUsed=true;const h=held.revision.revisionId.slice(6);for(let i=0;i<16;i++)bytes[i]=parseInt(h.slice(i*2,i*2+2),16);return bytes;}};
   const jobId=held.input.receipt.jobId,materialId=held.input.receipt.materialId;
   const readJob=async id=>{const r=await options.readJob(id);return r?.ok&&r.job?.head.currentRevisionId===held.input.job.head.currentRevisionId?r:fail('JOB_CHANGED','The job changed after the review.');};
   store=Store.createMaterialStore(options.indexedDB,{crypto,now:()=>held.revision.savedAt,readJob});
   const r=await store.read(jobId,materialId);if(!r.ok)return r;
   const existing=r.history.find(v=>v.revisionId===held.revision.revisionId);
   if(existing){if(canonical(existing)!==canonical(held.revision))return fail('COLLISION','The correction identifier holds different data. Nothing was overwritten.');return {ok:true,revision:existing,alreadySaved:true,superseded:r.current.revisionId!==existing.revisionId};}
   if(r.current.revisionId!==held.input.current.revisionId||canonical(r.current)!==canonical(held.input.current))return fail('CONFLICT','The material was changed after the review. Your correction was not saved.');
   const j=await readJob(jobId);if(!j.ok)return j;
   entered=true;const result=await store.update(jobId,materialId,held.input.current.revisionId,held.revision.item,held.revision.changeReason);
   if(!result.ok)return ['CONFLICT','JOB_CHANGED','JOB_UNAVAILABLE','NOT_FOUND'].includes(result.code)?result:{...result,pending:true};
   if(canonical(result.revision)!==canonical(held.revision))return {...fail('UNCERTAIN','The save needs to be checked. Do not create a new correction.'),pending:true};
   return {ok:true,revision:result.revision,alreadySaved:false,superseded:false};
  }catch{return {...fail(entered?'INTERRUPTED':readStarted?'UNAVAILABLE':'INVALID',entered?'The save was not confirmed. Resume the same correction.':readStarted?'The local store is unavailable. The save was not started.':'The correction cannot be verified.'),pending:entered};}
  finally{store?.close();}
 }
 return {capture,prepare,commit};
});
