'use strict';
// Explicit review and one-record correction, never a model-triggered database write.
var materialEditConflicts=new Set();
function editSource(plan){const m=workspaceMeta,item=state.items.find(i=>i.id===plan.input.item.id),receipt=m.receipts.find(r=>r.jobId===plan.input.receipt.jobId&&r.itemId===plan.input.item.id);return {sourceId:m.sourceId,sourceRevision:m.sourceRevision,sourceSavedAt:m.sourceSavedAt,item:copy(item),receipt:copy(receipt)};}
function hostSavedMaterial(panel,item,receipt,locked){
 const wrap=node('div',undefined,'material-linked');wrap.append(node('p',item.name+' — powiązano z materiałem roboty.','handoff-saved'));
 if(item.review.length){const label=node('label',undefined,'handoff-row'),ack=node('input');ack.type='checkbox';ack.dataset.editAckId=item.id;ack.checked=hostAcks.has(item.id);ack.disabled=locked;ack.onchange=()=>{ack.checked?hostAcks.add(item.id):hostAcks.delete(item.id);hostRender();};label.append(ack,node('span','Sprawdziłem niepewności tej poprawki.'));wrap.append(label);}
 const button=hostButton('Przejrzyj poprawkę','material-edit-'+item.id,()=>hostEditStart(item.id));button.disabled=locked||item.quantity===null||item.unit===null||(item.review.length>0&&!hostAcks.has(item.id));wrap.append(button);
 if(materialEditConflicts.has(item.id)){wrap.append(node('p','W Robocie jest nowsza wersja. Dotychczasowy zapis pozostaje nietknięty.','handoff-warning'));const compare=hostButton('Porównaj z aktualnym zapisem','material-rebase-'+item.id,()=>hostEditStart(item.id,true));compare.disabled=button.disabled;wrap.append(compare);}
 panel.append(wrap);
}
function hostRenderMaterialEdit(panel,locked){
 const e=workspaceMeta.materialEdit,p=e.plan,names={label:'Materiał',quantityText:'Ilość',unit:'Jednostka',specification:'Specyfikacja',notes:'Notatki'};
 panel.append(node('h3','Poprawka zapisanego materiału'),node('p',p.input.job.revision.title+' · '+p.input.current.item.label,'handoff-help'));
 if(p.input.rebase)panel.append(node('p','Porównanie z nowszym zapisem z Roboty. Zmienią się tylko pola pokazane poniżej.','handoff-warning'));
 for(const change of p.changes){const row=node('section',undefined,'material-change');row.append(node('strong',names[change.field]),node('p','Było: '+(change.before||'—'),'change-before'),node('p','Będzie: '+(change.after||'—'),'change-after'));if(p.input.baseline.item[change.field]!==p.input.current.item[change.field])row.append(node('p','To pole było również zmienione w Robocie. Potwierdzenie zastąpi jego aktualną wartość pokazaną powyżej.','handoff-warning'));panel.append(row);}
 panel.append(node('p','Status, dostawca i lokalizacja pozostają bez zmian. Poprzednia wersja zostaje w historii.','handoff-help'));
 const actions=node('div',undefined,'handoff-actions');
 if(e.phase==='conflict'){
  panel.append(node('p','W międzyczasie zmieniono materiał lub robotę. Ta poprawka nie nadpisała nowszego zapisu.','handoff-warning'));
  const again=hostButton('Porównaj aktualną wersję','material-edit-rebase',()=>hostEditStart(p.input.item.id,true),'primary');again.disabled=locked;actions.append(again);
 }else{if(e.phase==='pending')panel.append(node('p','Potwierdzenie mogło zostać przerwane. Wznowienie sprawdzi dokładną wersję zamiast dopisywać drugą poprawkę.','handoff-warning'));const save=hostButton(e.phase==='pending'?'Sprawdź / wznów poprawkę':p.input.rebase?'Zastąp wskazane wartości':'Potwierdź poprawkę','material-edit-confirm',hostEditCommit,'primary');save.disabled=locked;actions.append(save);}
 if(e.phase!=='pending'){const cancel=hostButton('Odrzuć poprawkę','material-edit-cancel',async()=>{if(!hostCanEdit())return;try{await hostExclusive(()=>hostPersist(JHSession.editDiscard(workspaceMeta)));controls();hostMessage('Odrzucono podsumowanie. Zapisany materiał i szkic pozostają bez zmian.');}catch(err){hostMessage(err.message);}});cancel.disabled=locked;actions.append(cancel);}
 panel.append(actions);
}
async function hostEditStart(itemId,rebase=false){
 if(!hostCanEdit()||!hostReady||!workspaceMeta?.targetJobId)return;handoffBusy=true;controls();
 try{await hostExclusive(async()=>{
  hostSameStorage();if(hostApi().hasDraft())throw Error('Zakończ otwarty formularz Roboty przed przygotowaniem poprawki.');
  const m=copy(workspaceMeta),item=copy(state.items.find(i=>i.id===itemId)),receipt=m.receipts.find(r=>r.itemId===itemId&&r.jobId===m.targetJobId);
  if(!receipt)throw Error('Nie ma zapisanej pozycji powiązanej z tą rozmową.');
  const [job,entry]=await Promise.all([hostApi().read(m.targetJobId),hostApi().material(m.targetJobId,receipt.materialId)]);hostSameStorage();
  if(!job.ok||!entry.ok)throw Error((!job.ok?job.problems:entry.problems).join(' '));
  const baseline=entry.history.find(r=>r.revisionId===receipt.revisionId);if(!baseline)throw Error('Historia nie potwierdza wcześniejszego zapisu. Nie utworzono kopii materiału.');
  const input={sourceId:m.sourceId,sourceRevision:m.sourceRevision,sourceSavedAt:m.sourceSavedAt,reviewedAt:new Date().toISOString(),item,receipt,job:{head:job.job.head,revision:job.job.revision},baseline,current:entry.current,acknowledged:!item.review.length||hostAcks.has(itemId),rebase};
  const r=await hostApi().prepareEdit(input);hostSameStorage();
  if(!r.ok){if(r.code==='CONFLICT')materialEditConflicts.add(itemId);throw Error(r.problems.join(' '));}
  if(r.unchanged){if(workspaceMeta.materialEdit)hostPersist(JHSession.editDiscard(workspaceMeta));hostMessage('Brak nowych zmian tej pozycji. Nie dopisano wersji ani materiału.');return;}
  hostPersist(JHSession.editReview(workspaceMeta,r.plan));materialEditConflicts.delete(itemId);hostMessage('Porównanie gotowe. Zapisany materiał jeszcze nie został zmieniony.');
 });}catch(e){hostMessage(e.message);}finally{handoffBusy=false;controls();hostRender();}
}
async function hostEditCommit(){
 if(handoffBusy||busy||audioBusy||recording||hostExternalStale||storageBroken||!workspaceMeta?.materialEdit||workspaceMeta.materialEdit.phase==='conflict')return;
 handoffBusy=true;let committed=false;controls();
 try{await hostExclusive(async()=>{
  hostSameStorage();if(hostApi().hasDraft())throw Error('Zakończ otwarty formularz Roboty przed poprawką.');
  if(workspaceMeta.boundState!==JSON.stringify(state))throw Error('Szkic zmienił się po przeglądzie.');
  const p=copy(workspaceMeta.materialEdit.plan),source=editSource(p);
  if(workspaceMeta.materialEdit.phase!=='pending')hostPersist(JHSession.editEnter(workspaceMeta));
  const r=await hostApi().commitEdit(p,source,{accepted:true,planId:p.id});committed=!!r.ok;hostSameStorage();
  if(!r.ok){if(['CONFLICT','JOB_CHANGED','LINK_CHANGED','JOB_UNAVAILABLE','NOT_FOUND'].includes(r.code)&&!r.pending){hostPersist(JHSession.editConflict(workspaceMeta));}throw Error(r.problems.join(' '));}
  hostPersist(JHSession.editDone(workspaceMeta));hostSelected.clear();hostAcks.clear();hostMessage(r.superseded?'Ta poprawka jest już w historii. Późniejsza wersja materiału pozostała nietknięta.':'Zapisano poprawkę tego samego materiału. Poprzednia wersja pozostała w historii; nie utworzono duplikatu.');
 });}catch(e){hostMessage((committed?'Poprawkę zapisano, ale potwierdzenie lokalne nie zostało utrwalone. Wznów tę samą operację. ':'')+e.message);}finally{handoffBusy=false;controls();hostRender();}
}
