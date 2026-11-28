'use strict';
// Explicit review and one-record correction, never a model-triggered database write.
var materialEditConflicts=new Set();
function editSource(plan){const m=workspaceMeta,item=state.items.find(i=>i.id===plan.input.item.id),receipt=m.receipts.find(r=>r.jobId===plan.input.receipt.jobId&&r.itemId===plan.input.item.id);return {sourceId:m.sourceId,sourceRevision:m.sourceRevision,sourceSavedAt:m.sourceSavedAt,item:copy(item),receipt:copy(receipt)};}
function hostSavedMaterial(panel,item,receipt,locked){
 const wrap=node('div',undefined,'material-linked');wrap.append(node('p',item.name+' — linked to a job material.','handoff-saved'));
 if(item.review.length){const label=node('label',undefined,'handoff-row'),ack=node('input');ack.type='checkbox';ack.dataset.editAckId=item.id;ack.checked=hostAcks.has(item.id);ack.disabled=locked;ack.onchange=()=>{ack.checked?hostAcks.add(item.id):hostAcks.delete(item.id);hostRender();};label.append(ack,node('span','I checked the uncertainties of this correction.'));wrap.append(label);}
 const button=hostButton('Review correction','material-edit-'+item.id,()=>hostEditStart(item.id));button.disabled=locked||item.quantity===null||item.unit===null||(item.review.length>0&&!hostAcks.has(item.id));wrap.append(button);
 if(materialEditConflicts.has(item.id)){wrap.append(node('p','There is a newer version in Jobs. The existing entry stays untouched.','handoff-warning'));const compare=hostButton('Compare with the current entry','material-rebase-'+item.id,()=>hostEditStart(item.id,true));compare.disabled=button.disabled;wrap.append(compare);}
 panel.append(wrap);
}
function hostRenderMaterialEdit(panel,locked){
 const e=workspaceMeta.materialEdit,p=e.plan,names={label:'Material',quantityText:'Quantity',unit:'Unit',specification:'Specification',notes:'Notes'};
 panel.append(node('h3','Correction of a saved material'),node('p',p.input.job.revision.title+' · '+p.input.current.item.label,'handoff-help'));
 if(p.input.rebase)panel.append(node('p','Comparison with the newer entry from Jobs. Only the fields shown below will change.','handoff-warning'));
 for(const change of p.changes){const row=node('section',undefined,'material-change');row.append(node('strong',names[change.field]),node('p','Was: '+(change.before||'—'),'change-before'),node('p','Will be: '+(change.after||'—'),'change-after'));if(p.input.baseline.item[change.field]!==p.input.current.item[change.field])row.append(node('p','This field was also changed in Jobs. Confirming replaces its current value shown above.','handoff-warning'));panel.append(row);}
 panel.append(node('p','Status, supplier and location stay unchanged. The previous version stays in the history.','handoff-help'));
 const actions=node('div',undefined,'handoff-actions');
 if(e.phase==='conflict'){
  panel.append(node('p','The material or the job was changed in the meantime. This correction did not overwrite the newer entry.','handoff-warning'));
  const again=hostButton('Compare the current version','material-edit-rebase',()=>hostEditStart(p.input.item.id,true),'primary');again.disabled=locked;actions.append(again);
 }else{if(e.phase==='pending')panel.append(node('p','The confirmation may have been interrupted. Resuming checks the exact version instead of adding a second correction.','handoff-warning'));const save=hostButton(e.phase==='pending'?'Check / resume correction':p.input.rebase?'Replace the shown values':'Confirm correction','material-edit-confirm',hostEditCommit,'primary');save.disabled=locked;actions.append(save);}
 if(e.phase!=='pending'){const cancel=hostButton('Discard correction','material-edit-cancel',async()=>{if(!hostCanEdit())return;try{await hostExclusive(()=>hostPersist(JHSession.editDiscard(workspaceMeta)));controls();hostMessage('Summary discarded. The saved material and the draft are unchanged.');}catch(err){hostMessage(err.message);}});cancel.disabled=locked;actions.append(cancel);}
 panel.append(actions);
}
async function hostEditStart(itemId,rebase=false){
 if(!hostCanEdit()||!hostReady||!workspaceMeta?.targetJobId)return;handoffBusy=true;controls();
 try{await hostExclusive(async()=>{
  hostSameStorage();if(hostApi().hasDraft())throw Error('Finish the open Jobs form before preparing a correction.');
  const m=copy(workspaceMeta),item=copy(state.items.find(i=>i.id===itemId)),receipt=m.receipts.find(r=>r.itemId===itemId&&r.jobId===m.targetJobId);
  if(!receipt)throw Error('There is no saved item linked to this chat.');
  const [job,entry]=await Promise.all([hostApi().read(m.targetJobId),hostApi().material(m.targetJobId,receipt.materialId)]);hostSameStorage();
  if(!job.ok||!entry.ok)throw Error((!job.ok?job.problems:entry.problems).join(' '));
  const baseline=entry.history.find(r=>r.revisionId===receipt.revisionId);if(!baseline)throw Error('The history does not confirm the earlier save. No copy of the material was created.');
  const input={sourceId:m.sourceId,sourceRevision:m.sourceRevision,sourceSavedAt:m.sourceSavedAt,reviewedAt:new Date().toISOString(),item,receipt,job:{head:job.job.head,revision:job.job.revision},baseline,current:entry.current,acknowledged:!item.review.length||hostAcks.has(itemId),rebase};
  const r=await hostApi().prepareEdit(input);hostSameStorage();
  if(!r.ok){if(r.code==='CONFLICT')materialEditConflicts.add(itemId);throw Error(r.problems.join(' '));}
  if(r.unchanged){if(workspaceMeta.materialEdit)hostPersist(JHSession.editDiscard(workspaceMeta));hostMessage('No new changes to this item. No version or material was added.');return;}
  hostPersist(JHSession.editReview(workspaceMeta,r.plan));materialEditConflicts.delete(itemId);hostMessage('The comparison is ready. The saved material has not been changed yet.');
 });}catch(e){hostMessage(e.message);}finally{handoffBusy=false;controls();hostRender();}
}
async function hostEditCommit(){
 if(handoffBusy||busy||audioBusy||recording||hostExternalStale||storageBroken||!workspaceMeta?.materialEdit||workspaceMeta.materialEdit.phase==='conflict')return;
 handoffBusy=true;let committed=false;controls();
 try{await hostExclusive(async()=>{
  hostSameStorage();if(hostApi().hasDraft())throw Error('Finish the open Jobs form before the correction.');
  if(workspaceMeta.boundState!==JSON.stringify(state))throw Error('The draft changed after the review.');
  const p=copy(workspaceMeta.materialEdit.plan),source=editSource(p);
  if(workspaceMeta.materialEdit.phase!=='pending')hostPersist(JHSession.editEnter(workspaceMeta));
  const r=await hostApi().commitEdit(p,source,{accepted:true,planId:p.id});committed=!!r.ok;hostSameStorage();
  if(!r.ok){if(['CONFLICT','JOB_CHANGED','LINK_CHANGED','JOB_UNAVAILABLE','NOT_FOUND'].includes(r.code)&&!r.pending){hostPersist(JHSession.editConflict(workspaceMeta));}throw Error(r.problems.join(' '));}
  hostPersist(JHSession.editDone(workspaceMeta));hostSelected.clear();hostAcks.clear();hostMessage(r.superseded?'This correction is already in the history. The later version of the material stayed untouched.':'The correction of the same material was saved. The previous version stayed in the history; no duplicate was created.');
 });}catch(e){hostMessage((committed?'The correction was saved, but the local confirmation was not stored. Resume the same operation. ':'')+e.message);}finally{handoffBusy=false;controls();hostRender();}
}
