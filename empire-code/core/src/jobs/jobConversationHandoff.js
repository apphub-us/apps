'use strict';
/** Explicit, model-independent transfer to original Jobs material contracts.
 * Pure preparation. Storage is delegated only after exact current-state review.
 * The host owns and persists source identity/revision/time. No clocks or network.
 */
const Job = require('./jobCard.js');
const Material = require('./jobMaterial.js');
const Batch = require('./jobVoiceBatch.js');
// EC-08: units and the whole-count rule are the one shared definition (materialQuantity.js); no list is kept here.
const Quantity = require('./materialQuantity.js');
const INPUT = ['sourceId','sourceRevision','sourceSavedAt','items','selectedItemIds','job','acknowledgedReviewIds'];
const ITEM = ['id','name','quantity','unit','specification','notes','review'];
const fail = (code, message) => ({ok:false, code, problems:[message]});
const copy = value => JSON.parse(JSON.stringify(value));
const shape = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '['+value.map(canonical).join(',')+']' : '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
const text = (value,max,required=false) => typeof value==='string' && value.length<=max && (!required||!!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
function utc(value) { try { return typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && new Date(value).toISOString()===value; } catch { return false; } }
function capture(input) {
  // Descriptor-level validation must precede any property access or cloning.
  if (!Material.safeData(input).ok || !shape(input,INPUT)) return fail('INVALID','Expected bounded plain input data with the exact handoff fields.');
  const x=copy(input);
  if (Number.isSafeInteger(x.sourceRevision) && x.sourceRevision>100) return fail('LIMIT','The source revision exceeds this handoff version limit; the draft was not changed.');
  if (!/^conv1_[0-9a-f]{32}$/.test(x.sourceId) || typeof x.sourceId!=='string' || !Number.isSafeInteger(x.sourceRevision) || x.sourceRevision<0 || x.sourceRevision>100 || !utc(x.sourceSavedAt)) return fail('INVALID','Invalid app-owned source identity, revision or save time.');
  if (!shape(x.job,['head','revision'])) return fail('JOB_CHANGED','A saved Jobs head and revision are required.');
  const h=Job.readHead(x.job.head),r=Job.readRevision(x.job.revision);
  if (!h.ok||!r.ok||h.head.jobId!==r.revision.jobId||h.head.currentRevisionId!==r.revision.revisionId||h.head.revisionNumber!==r.revision.revisionNumber) return fail('JOB_CHANGED','Saved job identity or revision is inconsistent.');
  if (!Array.isArray(x.items)||x.items.length>16) return fail('LIMIT','At most 16 conversation items are supported; nothing was trimmed.');
  const ids=new Set();
  for (const i of x.items) {
    if (!shape(i,ITEM)||typeof i.id!=='string'||!/^i[0-9]{4}$/.test(i.id)||ids.has(i.id)||!text(i.name,120,true)||!text(i.specification,500)||!text(i.notes,600)||!Array.isArray(i.review)||i.review.length>8||!i.review.every(v=>text(v,220,true))) return fail('INVALID','An item is malformed, oversized or has a duplicate ID.');
    ids.add(i.id);
    // Every item must be READABLE. A fractional count (0.5 roll from a draft saved before EC-08) is readable: it is
    // refused below only when that item is SELECTED, so the other items of the same draft stay transferable.
    const q=Quantity.inspectDraft(i.quantity,i.unit);
    if (!q.readable) return fail('INVALID',q.code==='UNIT'?'Unsupported source unit.':'Quantity must be a positive exact decimal string or unknown.');
  }
  const selection=x.selectedItemIds,ack=x.acknowledgedReviewIds;
  if (!Array.isArray(selection)||!selection.length||selection.length>8||new Set(selection).size!==selection.length||!selection.every(id=>typeof id==='string'&&ids.has(id))) return fail('SELECTION','Choose one to eight distinct existing items; no remainder is discarded.');
  if (canonical(selection)!==canonical(x.items.filter(i=>selection.includes(i.id)).map(i=>i.id))) return fail('SELECTION','Selected IDs must retain source order.');
  if (!Array.isArray(ack)||ack.length>8||new Set(ack).size!==ack.length||!ack.every(id=>selection.includes(id)&&x.items.some(item=>item.id===id&&item.review.length>0))) return fail('ACKNOWLEDGEMENT','Acknowledgements must refer to distinct selected items.');
  return {ok:true,input:x};
}
async function hash(value,crypto) {
  const data=new TextEncoder().encode(canonical(value));
  let bytes;
  try { const result=await crypto.subtle.digest('SHA-256',data);bytes=new Uint8Array(result);if(bytes.length!==32)throw Error('Invalid digest length'); }
  catch { throw Object.assign(Error('Required digest unavailable'),{handoffCode:'UNAVAILABLE'}); }
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
async function prepare(input,options={}) {
  try {
    const captured=capture(input);if(!captured.ok)return captured;const x=captured.input;
    const crypto=options.crypto;if(!crypto||!crypto.subtle||typeof crypto.subtle.digest!=='function')return fail('UNAVAILABLE','Web Crypto SHA-256 is required; no unstable fallback identity was allocated.');
    const jobId=x.job.head.jobId,selected=x.items.filter(i=>x.selectedItemIds.includes(i.id)),fields=[];
    for(const item of selected){
      if(item.quantity===null||item.unit===null)return fail('INCOMPLETE','Selected item '+item.id+' has no quantity/unit; keep it in the conversation draft.');
      // EC-08: the shared whole-count rule, stated before anything is prepared. Nothing is rounded and no length is inferred.
      if(Quantity.inspectDraft(item.quantity,item.unit).correctionRequired)return fail('QUANTITY_CORRECTION','Selected item '+item.id+' ('+item.quantity+' '+item.unit+') needs a correction before it can be saved to a job: '+Quantity.WHOLE_COUNT_MESSAGE+' Correct the quantity in the conversation (a whole number, or a length in ft/in/m/cm/mm) or unselect this item. Nothing was rounded and nothing was saved. / Pozycja '+item.id+': popraw ilość w rozmowie na liczbę całkowitą albo podaj długość, lub odznacz tę pozycję. Niczego nie zaokrąglono ani nie zapisano.');
      if(item.review.length&&!x.acknowledgedReviewIds.includes(item.id))return fail('REVIEW_REQUIRED','Review warnings for '+item.id+' require explicit acknowledgement.');
      const provenance='[Conversation '+x.sourceId+' / revision '+x.sourceRevision+' / item '+item.id+']';
      const warnings=item.review.length?'\nReview warnings acknowledged, not electrical approval:\n'+item.review.join('\n'):'';
      const f={label:item.name,quantityText:item.quantity,unit:item.unit,specification:item.specification,notes:item.notes+(item.notes?'\n':'')+provenance+warnings,status:'not_recorded',location:'',supplier:''};
      const checked=Material.validateFields(f);if(!checked.ok)return checked;fields.push(checked.fields);
    }
    const inputHash=await hash(['ec-conversation-binding-v1',x],crypto);
    const planId='voice1_'+(await hash(['ec-conversation-plan-v1',x.sourceId,x.sourceRevision,jobId,x.selectedItemIds],crypto)).slice(0,32);
    const actions=[];
    for(let index=0;index<selected.length;index++){
      const item=selected[index];
      const id='mat1_'+(await hash(['ec-conversation-material-v1',x.sourceId,jobId,item.id],crypto)).slice(0,32);
      const revisionId='trev1_'+(await hash(['ec-conversation-material-revision-v1',x.sourceId,x.sourceRevision,jobId,item.id],crypto)).slice(0,32);
      actions.push({kind:'material',id,revisionId,fields:fields[index]});
    }
    const excludedItemIds=x.items.filter(i=>!x.selectedItemIds.includes(i.id)).map(i=>i.id);
    const plan={kind:'empire-code.voice-plan',version:1,id:planId,jobId,jobRevisionId:x.job.head.currentRevisionId,title:x.job.revision.title,createdAt:x.sourceSavedAt,transcript:canonical({sourceId:x.sourceId,sourceRevision:x.sourceRevision,selectedItemIds:x.selectedItemIds,excludedItemIds}),actions};
    const checked=Batch.validate(plan);if(!checked.ok)return checked;
    const handoff={kind:'empire-code.conversation-handoff',version:1,binding:{inputHash,sourceId:x.sourceId,sourceRevision:x.sourceRevision},excludedItemIds,plan:checked.plan};
    return {ok:true,handoff,excludedItemIds:excludedItemIds.slice()};
  }catch(e){return e&&e.handoffCode==='UNAVAILABLE'?fail('UNAVAILABLE','Required SHA-256 could not complete; nothing was saved.'):fail('INVALID','Could not prepare a bounded handoff; no data was saved.');}
}
async function commit(handoff,currentInput,confirmation,options={}) {
  let persistenceEntered=false;
  try {
    if(!Material.safeData(handoff).ok||!Material.safeData(confirmation).ok||!shape(confirmation,['accepted','planId'])||confirmation.accepted!==true||typeof confirmation.planId!=='string'||!/^voice1_[0-9a-f]{32}$/.test(confirmation.planId)||!shape(handoff,['kind','version','binding','excludedItemIds','plan'])||!Batch.validate(handoff.plan).ok||confirmation.planId!==handoff.plan.id)return fail('CONFIRMATION','Explicit confirmation of this exact handoff is required.');
    const accepted=copy(handoff),consent=copy(confirmation);
    const fresh=await prepare(currentInput,options);if(!fresh.ok)return fresh;
    if(canonical(fresh.handoff)!==canonical(accepted))return fail('STALE','The source, selection, target job or reviewed plan has changed. Nothing was written.');
    if(!options.batchStore||typeof options.batchStore.save!=='function')return fail('UNAVAILABLE','Existing batch persistence is unavailable.');
    persistenceEntered=true;
    return await options.batchStore.save(fresh.handoff.plan,{accepted:true,planId:consent.planId});
  }catch{ return persistenceEntered?Object.assign(fail('INTERRUPTED','Save acknowledgement unavailable. Reconcile the exact prepared plan; do not prepare duplicate items.'),{pending:true}):fail('INVALID','The handoff could not be validated; no save was attempted.'); }
}
module.exports={prepare,commit};
