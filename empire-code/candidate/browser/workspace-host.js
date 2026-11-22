'use strict';
// Same-origin coordinator. No model, credentials, or network is used to save a reviewed draft.
// Conversations live in the per-job bank owned by ui.js (CBank). This file switches the active context and
// persists host metadata through ui.js (bankSync / persist / switchContext); it never writes bank bytes itself.
// It also renders the conversation management panel (archive, restore, export, delete, import: every change goes through
// bankManage / conversationImport in ui.js) and the new-version notice with its explicit, user-pressed reload.
var hostExternalStale=false,hostSelectionStamp='',handoffBusy=false,hostReady=false,hostJobs=[],hostGeneration=0,hostSelected=new Set(),hostAcks=new Set(),hostView='talk';
// hostSelectorStamp: what the two selectors currently show. hostAssignTarget: job chosen for 'Przypisz ten szkic'.
// hostRecovered: read-only mirror of the first recovery candidate of the ACTIVE conversation (null when it has none). The candidates
// themselves live in the unsent-text journal per conversation (ui.js recoveryItems), so they survive reloads and never follow a switch.
// hostListed: the first job list attempt finished. hostReady is raised only when that is true AND the bank has finished booting.
var hostSelectorStamp='',hostAssignTarget='',hostRecovered=null,hostListed=false;
function hostApi(){const api=$('core-frame').contentWindow.ecHostBridge;if(!api||!api.ready)throw Error('Lokalne roboty jeszcze się wczytują.');return api;}
function hostMessage(text){$('job-status').textContent=text;}
function hostButton(text,id,handler,cls='quiet'){const b=node('button',text,cls);b.id=id;b.type='button';b.onclick=handler;return b;}
// Passes only when the ACTIVE conversation is still exactly what this tab last read or wrote.
// Changes that other tabs made to other conversations are adopted here, never treated as a conflict.
function hostSameStorage(){if(bankBooting)throw Error('Zapisane rozmowy jeszcze się wczytują.');bankSync();}
// Saves new host metadata for the active conversation only (entry-granular). Memory is rolled back when the write fails.
function hostPersist(meta){
 hostSameStorage();const old=workspaceMeta;workspaceMeta=meta;
 if(!persist()){workspaceMeta=old;throw Object.assign(Error('Nie zapisano powiązania w przeglądarce'+(persistError?' ('+persistError+')':'')+'. Materiały nie zostały wysłane do zapisu.'),{code:persistCode});}
 return true;
}
function hostEnsure(){if(!workspaceMeta){if(!persist())throw Error('Nie można utrwalić identyfikatora szkicu.');}return workspaceMeta;}
function hostPending(){return writePending();}
function hostCanEdit(){return !hostExternalStale&&!storageBroken&&!bankBooting&&!handoffBusy&&!busy&&!audioBusy&&!recording&&!hostPending();}
function hostJob(jobId){return hostJobs.find(j=>j.head.jobId===jobId)||null;}

// hostReady becomes true only after the first job list has been shown, so the job selector is never offered half-filled.
async function hostRefresh(){
 let api;try{api=hostApi();}catch(_){return;}
 const generation=++hostGeneration;
 try{
  const r=await api.list();if(generation!==hostGeneration)return;if(!r.ok)throw Error((r.problems||[]).join(' '));
  hostJobs=r.jobs;hostListed=true;const target=workspaceMeta?.targetJobId;
  if(target&&!hostJob(target))hostMessage('Wybrana robota nie jest dostępna. Szkic i oczekujący zapis pozostają zachowane.');
  else hostMessage(hostJobs.length?'Roboty i materiały są zapisane lokalnie na tym urządzeniu.':'Utwórz robotę lub otwórz archiwum w zakładce Roboty. Dane ze starszych adresów nie są automatycznie przenoszone.');
 }catch(e){if(generation!==hostGeneration)return;hostListed=true;hostMessage(e.message);}
 // The tools frame has answered (frame load, its ready message, or a return to the conversation): the import button and the
 // analysis choice are drawn again from what its form bridge reports NOW. Render only: nothing is captured, imported, sent or stored.
 assistRender();hostRender();
}

// --- Job and conversation selectors ---------------------------------------------------------------
function hostConversationLabel(entry){
 const first=entry.envelope.state.history.find(m=>m&&m.role==='user'&&typeof m.content==='string');
 const text=first?first.content.replace(/\s+/g,' ').trim():'';
 let when='';try{when=new Date(entry.updatedAt).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(_){}
 return (text?(text.length>32?text.slice(0,32)+'…':text):entry.input?'Niewysłany tekst':'Pusta rozmowa')+' · '+entry.envelope.state.items.length+' poz.'+(when?' · '+when:'');
}
// Options are rebuilt only when their content changed; the shown values always follow the active context.
function hostSelectors(){
 const jobId=workspaceMeta?.targetJobId||null,entries=CBank.list(bank,jobId),stored=entries.some(e=>e.contextId===activeContextId);
 const signature=JSON.stringify([hostReady,hostJobs.map(j=>[j.head.jobId,j.revision.title]),jobId,activeContextId,entries.map(e=>[e.contextId,e.version])]);
 if(signature!==hostSelectorStamp){
  hostSelectorStamp=signature;
  const jobs=$('job-target');jobs.replaceChildren();
  const none=node('option','Bez roboty (nieprzypisane)');none.value='';jobs.append(none);
  for(const j of hostJobs){const op=node('option',j.revision.title);op.value=j.head.jobId;jobs.append(op);}
  if(jobId&&!hostJob(jobId)){const op=node('option',hostReady?'Robota niedostępna':'Robota tej rozmowy…');op.value=jobId;jobs.append(op);}
  const list=$('conversation-select');list.replaceChildren();
  if(!stored){const op=node('option','Nowa rozmowa (jeszcze pusta)');op.value=activeContextId;list.append(op);}
  for(const e of entries){const op=node('option',hostConversationLabel(e));op.value=e.contextId;list.append(op);}
 }
 $('job-target').value=jobId||'';$('conversation-select').value=activeContextId;
 const job=jobId?hostJob(jobId):null;
 $('context-active').textContent=(jobId?'Aktywna robota: „'+(job?job.revision.title:hostReady?'niedostępna':'…')+'”':'Bez roboty — szkic nieprzypisany')+' · rozmów: '+(entries.length+(stored?0:1))+(hostPending()?' · rozpoczęty zapis blokuje zmianę rozmowy':'');
 // Capacity is always visible, with the reason and the way out once a limit is reached. Archived conversations are not counted.
 const use=CBank.usage(bank,jobId),cap=$('context-capacity');
 cap.textContent='Aktywne rozmowy tej roboty: '+use.job+' z '+use.jobLimit+' · wszystkie aktywne: '+use.active+' z '+use.activeLimit+' · w archiwum: '+use.archived
  +(use.job>=use.jobLimit?' · limit tej roboty osiągnięty: nowa rozmowa wymaga zarchiwizowania jednej z obecnych („Zarządzaj rozmowami”)':use.active>=use.activeLimit?' · limit aktywnych rozmów osiągnięty: zarchiwizuj jedną z nich („Zarządzaj rozmowami”)':'');
 cap.className=use.job>=use.jobLimit||use.active>=use.activeLimit?'at-limit':'';
}
// Call inside the lock. Opens the latest conversation of jobId (null = unassigned) or a fresh empty one.
// The conversation being left is saved first (including its unsent text) and is never retargeted.
function hostOpenJob(jobId){
 if(!hostCanEdit())throw Error('Najpierw dokończ bieżącą operację.');
 flushInput();bankSync();
 if((workspaceMeta?.targetJobId||null)===jobId)return 'same';
 const entry=CBank.latest(bank,jobId);
 if(entry){switchContext(entry.contextId);return 'existing';}
 openNewContext(jobId);return 'created';
}
// An explicitly reopened older conversation becomes the job's latest, so returning to the job restores it.
// Only its bank ordering changes; a failed write here is harmless (the conversation is already open).
function hostTouch(){
 const entry=CBank.get(bank,activeContextId);if(!entry)return;
 if(CBank.latest(bank,entry.jobId).contextId===entry.contextId)return;
 try{writeEntry(entry.envelope,entry.input);}catch(_){}
}

// --- Review panel -----------------------------------------------------------------------------------
function hostEligible(item){return item.quantity!==null&&item.unit!==null&&!workspaceMeta.receipts.some(r=>r.jobId===workspaceMeta.targetJobId&&r.itemId===item.id);}
// Complete new items without a technical warning start selected (at most 8). Items with warnings stay manual.
function hostDefaultSelection(){
 if(!workspaceMeta?.targetJobId||workspaceMeta.prepared||workspaceMeta.materialEdit)return;
 for(const item of state.items){if(hostSelected.size>=8)break;if(hostEligible(item)&&!item.review.length)hostSelected.add(item.id);}
}
// Journal/legacy notices and the recovery candidates of the active conversation only. Every candidate is shown; none is chosen
// automatically here, and recovering or removing one is always an explicit click.
function hostRenderRecovery(panel,locked){
 const items=recoveryItems();hostRecovered=items.length?items[0].text:null;
 if(journalError)panel.append(node('p',journalError,'handoff-warning'));
 if(legacyNotice){const box=node('div',undefined,'material-linked');box.id='legacy-notice';box.append(node('p',legacyNotice,'handoff-warning'),hostButton('Pobierz starszy zapis','legacy-export',exportLegacyRaw));panel.append(box);}
 if(recovery.contextId===activeContextId&&(recovery.problems||recovery.truncated))panel.append(node('p','Część kopii niewysłanego tekstu tej rozmowy jest nieczytelna lub nie została przejrzana ('+recovery.problems+'). Niczego nie usunięto; „Eksportuj szkic” zawiera surowe zapisy.','handoff-warning'));
 items.forEach((item,i)=>{
  const suffix=i?'-'+i:'',box=node('div',undefined,'material-linked');
  box.append(node('p',items.length>1?'Niewysłany tekst tej rozmowy z innej karty ('+(i+1)+' z '+items.length+'). Żaden nie został wybrany automatycznie, wysłany ani wpisany do pola.':'W tej rozmowie zachowano niewysłany tekst z innej karty. Nie został wysłany i nie zastąpił tekstu w polu.','handoff-warning'),node('p',item.text,'recovered-text'));
  const row=node('div',undefined,'handoff-actions');
  const add=hostButton('Dopisz do pola','recovered-append'+suffix,async()=>{hostMessage(await recoveryAccept(item));hostRender();});
  add.disabled=locked||$('input').disabled;
  const drop=hostButton('Odrzuć ten tekst','recovered-discard'+suffix,()=>{hostMessage(recoveryDiscard(item));hostRender();});
  row.append(add,drop);box.append(row);panel.append(box);
 });
}
// Explicit assignment of an unassigned draft. The target is shown before the button becomes available.
function hostRenderAssign(panel,locked){
 panel.append(node('p','Ten szkic nie jest przypisany do żadnej roboty. Wybranie roboty u góry otwiera jej własną rozmowę; ten szkic pozostaje pod „Bez roboty”.','handoff-help'));
 if(!hostJobs.length){panel.append(node('p','Utwórz robotę, aby móc przypisać do niej ten szkic.','handoff-help'));return;}
 if(hostAssignTarget&&!hostJob(hostAssignTarget))hostAssignTarget='';
 const select=node('select');select.id='assign-target';select.setAttribute('aria-label','Robota docelowa tego szkicu');
 const none=node('option','Wybierz robotę docelową…');none.value='';select.append(none);
 for(const j of hostJobs){const op=node('option',j.revision.title);op.value=j.head.jobId;select.append(op);}
 select.value=hostAssignTarget;select.disabled=locked;select.onchange=()=>{hostAssignTarget=select.value;hostRender();};panel.append(select);
 const job=hostJob(hostAssignTarget);
 if(job)panel.append(node('p','Po potwierdzeniu ta rozmowa, '+state.items.length+' poz. szkicu i niewysłany tekst zostaną przypisane do roboty „'+job.revision.title+'”. Żaden materiał nie zostanie jeszcze zapisany.','handoff-warning'));
 const assign=hostButton('Przypisz ten szkic','assign-draft',hostAssign,'primary');assign.disabled=locked||!job;panel.append(assign);
}
function hostRender(){
 if(!$('handoff-panel'))return;
 if(hostListed&&!bankBooting)hostReady=true;
 const panel=$('handoff-panel');panel.replaceChildren();const locked=hostExternalStale||storageBroken||bankBooting||handoffBusy||busy||audioBusy||recording;
 const fixed=locked||hostPending();
 $('job-target').disabled=fixed;$('conversation-select').disabled=fixed;$('job-refresh').disabled=handoffBusy;$('job-new-title').disabled=fixed;$('job-new-form').querySelector('button').disabled=fixed;
 hostSelectors();hostManageRender();hostActionRender();
 panel.append(node('h3','Zapis do roboty'));
 const stamp=activeContextId+':'+(workspaceMeta?workspaceMeta.sourceId+':'+workspaceMeta.sourceRevision+':'+(workspaceMeta.targetJobId||''):'');
 if(stamp!==hostSelectionStamp){hostSelected.clear();hostAcks.clear();hostSelectionStamp=stamp;hostDefaultSelection();}
 hostRenderRecovery(panel,locked);
 // This tab's conversation was archived or deleted elsewhere, or the bank was rewritten by a newer application. Nothing is saved
 // from here any more; the screen can be downloaded as a raw recovery copy before the tab moves on to a stored conversation.
 if(contextLost){
  const box=node('div',undefined,'material-linked');box.id='lost-notice';
  box.append(node('p',LOST[contextLost]+LOST_HELP,'handoff-warning'));
  const row=node('div',undefined,'handoff-actions'),leave=hostButton('Otwórz zapisane rozmowy','lost-leave',hostLeaveLost);
  leave.disabled=handoffBusy||busy||audioBusy||recording||storageBroken||!(recoveryExported||(contextLost==='archived'&&$('input').value===inputSaved));
  row.append(hostButton('Pobierz kopię awaryjną','lost-export',()=>{exportRecovery();hostMessage('Pobrano kopię awaryjną ekranu. Niczego nie zmieniono.');hostRender();},'primary'),leave);
  box.append(row,node('p','„Otwórz zapisane rozmowy” porzuca ten ekran, dlatego jest dostępne po pobraniu kopii awaryjnej.','handoff-help'));panel.append(box);return;
 }
 if(hostExternalStale){panel.append(node('p','Ta rozmowa zmieniła się w innej karcie. Nie używaj starego podsumowania.','handoff-warning'));const sync=hostButton('Wczytaj aktualny szkic','handoff-resync',hostResync);sync.disabled=handoffBusy;panel.append(sync);return;}
 if(storageBroken){panel.append(node('p','Zapis przeglądarki wymaga sprawdzenia. Niczego nie nadpisano.','handoff-warning'));return;}
 if(bankBooting){panel.append(node('p','Wczytuję zapisane rozmowy…','handoff-help'));return;}
 if(!hostReady){panel.append(node('p','Wczytuję lokalne roboty…','handoff-help'));return;}
 // A conversation whose job is not on this device (e.g. imported from a file) stays readable, editable and exportable; every
 // write of materials is disabled until exactly that job exists here. Nothing is retargeted to another job.
 const jobMissing=!!workspaceMeta?.targetJobId&&!hostJob(workspaceMeta.targetJobId);
 if(jobMissing)panel.append(node('p','Robota tej rozmowy nie istnieje na tym urządzeniu. Szkic i rozmowę można czytać, zmieniać i eksportować; zapis materiałów jest wyłączony, dopóki ta robota nie pojawi się w zakładce Roboty (np. po odtworzeniu jej archiwum .ecjob).','handoff-warning'));
 if(workspaceMeta?.materialEdit){hostRenderMaterialEdit(panel,locked||jobMissing);return;}
 const prepared=workspaceMeta?.prepared;
 if(prepared){
  const p=prepared.handoff.plan,summary=node('div',undefined,'handoff-summary');
  summary.append(node('strong',p.title));
  for(const a of p.actions)summary.append(node('p',a.fields.quantityText+' '+a.fields.unit+' — '+a.fields.label+(a.fields.specification?' · '+a.fields.specification:'')));
  const left=prepared.handoff.excludedItemIds.length;if(left)summary.append(node('p',left+' poz. pozostaje w szkicu — nie będą usunięte.','handoff-help'));
  panel.append(summary,node('p',prepared.phase==='pending'?'Zapis rozpoczęto. Część wpisów mogła już powstać. Wznowienie sprawdzi ich identyfikatory i nie powieli ich.':'Sprawdź robotę, ilości i specyfikacje. Ten zapis nie zatwierdza zgodności instalacji.','handoff-help'));
  const row=node('div',undefined,'handoff-actions');const save=hostButton(prepared.phase==='pending'?'Wznów zapis':'Potwierdź zapis do roboty','handoff-confirm',hostCommit,'primary');save.disabled=locked||jobMissing;row.append(save);
  if(prepared.phase==='review'){const back=hostButton('Wróć do wyboru','handoff-discard',async()=>{try{if(!hostCanEdit())return;await hostExclusive(()=>hostPersist(JHSession.discard(workspaceMeta)));hostRender();}catch(e){hostMessage(e.message);}});back.disabled=locked;row.append(back);}panel.append(row);return;
 }
 if(!workspaceMeta?.targetJobId){
  if(contextBlank())panel.append(node('p','Wybierz lub utwórz robotę nad rozmową.','handoff-help'));else hostRenderAssign(panel,locked);
  return;
 }
 if(!state.items.length){panel.append(node('p','Pozycje z rozmowy pojawią się tutaj.','handoff-help'));return;}
 const ids=new Set(state.items.map(i=>i.id));for(const id of hostSelected)if(!ids.has(id))hostSelected.delete(id);for(const id of hostAcks)if(!ids.has(id))hostAcks.delete(id);
 let available=0;
 for(const item of state.items){
  const receipt=workspaceMeta.receipts.find(r=>r.jobId===workspaceMeta.targetJobId&&r.itemId===item.id);
  if(receipt){hostSavedMaterial(panel,item,receipt,locked||jobMissing);continue;}
  const complete=item.quantity!==null&&item.unit!==null,wrap=node('div');const label=node('label',undefined,'handoff-row'),check=node('input');check.type='checkbox';check.dataset.itemId=item.id;check.checked=hostSelected.has(item.id);check.disabled=locked||!complete;
  check.onchange=()=>{if(check.checked){if(hostSelected.size>=8){check.checked=false;hostMessage('Jednorazowo wybierz maksymalnie 8 pozycji. Pozostałe zostają w szkicu.');return;}hostSelected.add(item.id);}else{hostSelected.delete(item.id);hostAcks.delete(item.id);}hostRender();};
  label.append(check,node('span',(item.quantity??'?')+' '+(item.unit??'?')+' — '+item.name));wrap.append(label);
  if(!complete){wrap.append(node('p','Brakuje ilości lub jednostki — pozycja pozostaje w szkicu.','handoff-help'));hostSelected.delete(item.id);}else available++;
  if(item.review.length){wrap.append(node('p',item.review.join(' · '),'handoff-warning'));if(hostSelected.has(item.id)){const ackLabel=node('label',undefined,'handoff-row'),ack=node('input');ack.type='checkbox';ack.dataset.ackId=item.id;ack.checked=hostAcks.has(item.id);ack.disabled=locked;ack.onchange=()=>{ack.checked?hostAcks.add(item.id):hostAcks.delete(item.id);};ackLabel.append(ack,node('span','Sprawdziłem tę niepewność; uwaga pozostanie w zapisie.'));wrap.append(ackLabel);}}
  panel.append(wrap);
 }
 // Nothing is dropped silently: when the limit of one save is reached, the remaining complete items are named here.
 const waiting=state.items.filter(i=>hostEligible(i)&&!hostSelected.has(i.id)).length;
 if(hostSelected.size>=8&&waiting)panel.append(node('p','Wybrano 8 pozycji — to limit jednego zapisu. Pozostałe kompletne pozycje ('+waiting+') zostają w szkicu do kolejnego zapisu.','handoff-help'));
 const row=node('div',undefined,'handoff-actions');const all=hostButton('Wybierz kompletne','handoff-select-complete',()=>{hostSelected.clear();for(const item of state.items){if(hostSelected.size>=8)break;if(hostEligible(item))hostSelected.add(item.id);}hostRender();});all.disabled=locked||!available;row.append(all);
 const preview=hostButton('Przejrzyj zapis','handoff-prepare',hostPrepare,'primary');preview.disabled=locked||jobMissing||!hostSelected.size;row.append(preview);if(available>0)panel.append(row);
 const open=hostButton('Otwórz materiały roboty','handoff-open-job',()=>hostNavigate('jobs'));open.disabled=locked||jobMissing;panel.append(open);
}
async function hostInput(){
 hostSameStorage();const m=hostEnsure(),r=await hostApi().read(m.targetJobId);hostSameStorage();if(!r.ok)throw Error((r.problems||[]).join(' '));
 return {sourceId:m.sourceId,sourceRevision:m.sourceRevision,sourceSavedAt:m.sourceSavedAt,items:copy(state.items),selectedItemIds:state.items.filter(i=>hostSelected.has(i.id)).map(i=>i.id),job:{head:r.job.head,revision:r.job.revision},acknowledgedReviewIds:state.items.filter(i=>hostSelected.has(i.id)&&hostAcks.has(i.id)&&i.review.length).map(i=>i.id)};
}
async function hostPrepare(){
 if(!hostCanEdit()||!workspaceMeta?.targetJobId)return;handoffBusy=true;controls();hostRender();const generation=seq,context=activeContextId;
 try{await hostExclusive(async()=>{if(hostApi().hasDraft())throw Error('W Robocie jest otwarty formularz. Zapisz lub odrzuć go przed przekazaniem materiałów.');const input=await hostInput(),r=await hostApi().prepare(input);hostSameStorage();if(generation!==seq||context!==activeContextId)throw Error('Szkic zmienił się podczas przygotowania.');if(!r.ok)throw Error(r.problems.join(' '));
 const existing=await hostApi().materials(input.job.head.jobId);if(!existing.ok)throw Error(existing.problems.join(' '));
 if(r.handoff.plan.actions.some(a=>existing.materials.some(x=>x.current.materialId===a.id)))throw Error('Co najmniej jedna pozycja została już zapisana do tej roboty. Otwórz jej materiały zamiast tworzyć kopię.');
 hostSameStorage();if(generation!==seq||context!==activeContextId)throw Error('Szkic zmienił się podczas przygotowania.');hostPersist(JHSession.review(workspaceMeta,input,r.handoff));hostMessage('Podsumowanie gotowe. Żadnego materiału jeszcze nie zapisano.');});
 }catch(e){hostMessage(e.message);}finally{handoffBusy=false;controls();hostRender();}
}
async function hostCommit(){
 if(handoffBusy||busy||audioBusy||recording||!workspaceMeta?.prepared||storageBroken||bankBooting)return;
 if(ASession.pending(assistantMeta)){hostMessage('Najpierw dokończ rozpoczęty zapis notatki lub pomiaru do roboty. Materiałów nie zapisano.');return;}
 handoffBusy=true;let materialCommitted=false;controls();hostRender();
 try{
  if(!navigator.locks)throw Error('Ta przeglądarka nie udostępnia wymaganej blokady zapisu.');
  await navigator.locks.request('empire-code-conversation-host-v1',{mode:'exclusive'},async()=>{
   hostSameStorage();const p=copy(workspaceMeta.prepared);if(hostApi().hasDraft())throw Error('W Robocie jest otwarty formularz. Najpierw go zakończ.');
   const current=await hostApi().read(p.input.job.head.jobId);hostSameStorage();if(!current.ok)throw Error(current.problems.join(' '));
   if(current.job.head.currentRevisionId!==p.input.job.head.currentRevisionId){if(p.phase==='review')hostPersist(JHSession.discard(workspaceMeta));throw Error('Robota została zmieniona. Zapis nie został rozpoczęty lub wymaga sprawdzenia przerwanej partii.');}
   if(workspaceMeta.boundState!==JSON.stringify(state))throw Error('Szkic zmienił się po przeglądzie.');
   if(p.phase!=='pending')hostPersist(JHSession.enter(workspaceMeta));
   const input={...p.input,items:copy(state.items),job:{head:current.job.head,revision:current.job.revision}};
   const r=await hostApi().commit(p.handoff,input,{accepted:true,planId:p.handoff.plan.id});hostSameStorage();
   if(!r.ok)throw Error(r.problems.join(' ')+' Zapis pozostaje oznaczony do sprawdzenia/wznowienia.');
   materialCommitted=true;hostPersist(JHSession.done(workspaceMeta));hostSelected.clear();hostAcks.clear();hostMessage('Zapisano '+r.completed.length+' poz. do roboty „'+p.input.job.revision.title+'”. Szkic i historia rozmowy pozostają zachowane.');
  });
 }catch(e){hostMessage((materialCommitted?'Materiały zapisano, ale potwierdzenie lokalne nie zostało utrwalone. Wznów tę samą partię bez powielania. ':'')+e.message);}finally{handoffBusy=false;controls();hostRender();}
}
async function hostNavigate(view){
 if(handoffBusy||busy||audioBusy||recording){hostMessage('Dokończ bieżącą operację przed zmianą widoku.');return false;}
 try{if(view!=='talk'){if(!hostReady)throw Error('Narzędzia jeszcze się wczytują.');if(!await hostApi().show(view,workspaceMeta?.targetJobId))throw Error('Najpierw zapisz lub odrzuć otwarty formularz roboty.');}
 hostView=view;$('conversation-panel').hidden=view!=='talk';$('core-panel').hidden=view==='talk';for(const n of ['talk','jobs','tools','code'])$('nav-'+n).setAttribute('aria-current',n===view?'page':'false');
 // Back in the conversation: the open form may have changed in the Tools tab, so the import availability and the analysis choice
 // are drawn again at once (also when the frame is not ready: the button is then disabled). Render only, no capture.
 if(view==='talk'){assistRender();await hostRefresh();}return true;
 }catch(e){hostMessage(e.message);return false;}
}
for(const view of ['talk','jobs','tools','code'])$('nav-'+view).onclick=()=>hostNavigate(view);
$('job-refresh').onclick=hostRefresh;

// --- Context actions (all under the named lock) ---------------------------------------------------------
// Choosing a job (or 'Bez roboty') opens that job's own conversation. It never moves the current conversation.
$('job-target').onchange=async()=>{
 const wanted=$('job-target').value||null;
 try{
  if(!hostCanEdit())throw Error('Najpierw dokończ bieżącą operację.');
  if(wanted&&!hostJob(wanted))throw Error('Ta robota nie jest teraz dostępna. Bieżąca rozmowa pozostaje otwarta.');
  let outcome='same';
  await hostExclusive(()=>{outcome=hostOpenJob(wanted);if(outcome!=='same'){hostSelected.clear();hostAcks.clear();}render();});
  const name=wanted?'roboty „'+hostJob(wanted).revision.title+'”':'bez roboty';
  if(outcome==='existing')hostMessage('Otwarto ostatnią rozmowę '+name+' razem z jej niewysłanym tekstem. Poprzednia rozmowa pozostaje zapisana.');
  if(outcome==='created')hostMessage('Nowa, pusta rozmowa '+name+'. Poprzednia rozmowa pozostaje zapisana przy swojej robocie.');
 }catch(e){hostMessage(e.message);limitHelp(e);}
 finally{controls();}
};
// Older conversations of the selected job.
$('conversation-select').onchange=async()=>{
 const wanted=$('conversation-select').value;
 try{
  if(!hostCanEdit())throw Error('Najpierw dokończ bieżącą operację.');
  if(wanted&&wanted!==activeContextId){
   await hostExclusive(()=>{if(!hostCanEdit())throw Error('Najpierw dokończ bieżącą operację.');switchContext(wanted);hostTouch();hostSelected.clear();hostAcks.clear();render();});
   hostMessage('Otwarto wybraną rozmowę tej roboty. Pozostałe rozmowy pozostają zapisane.');
  }
 }catch(e){hostMessage(e.message);}
 finally{controls();}
};
async function hostAssign(){
 const target=hostAssignTarget,job=hostJob(target);
 if(!hostCanEdit()||!job||workspaceMeta?.targetJobId)return;
 try{
  await hostExclusive(()=>{
   if(!hostCanEdit()||workspaceMeta?.targetJobId||target!==hostAssignTarget)throw Error('Szkic lub wybór roboty zmienił się. Niczego nie przypisano.');
   hostSameStorage();
   const base=workspaceMeta||JHSession.bind(null,state,crypto,new Date().toISOString());
   hostPersist(JHSession.target(base,target));hostAssignTarget='';
  });
  hostMessage('Przypisano ten szkic do roboty „'+job.revision.title+'”. Rozmowa, pozycje i niewysłany tekst pozostały bez zmian; żadnego materiału jeszcze nie zapisano.');
 }catch(e){hostMessage(e.message);limitHelp(e);}
 finally{controls();}
}
// A new job gets its own empty conversation. The conversation being left keeps its unsent text (saved before the job is created).
// An unassigned draft with content is not moved: it stays open and the new job is offered as the assignment target.
$('job-new-form').onsubmit=async e=>{
 e.preventDefault();if(!hostCanEdit()||!hostReady)return;handoffBusy=true;controls();let note='';
 try{
  await hostExclusive(async()=>{
   hostSameStorage();if(hostPending())throw Error('Najpierw dokończ rozpoczęty zapis.');
   const title=$('job-new-title').value.trim();if(!title)throw Error('Podaj nazwę roboty.');
   flushInput();const context=activeContextId;
   const r=await hostApi().create({title,address:'',notes:''});if(!r.ok)throw Error(r.problems.join(' '));
   const jobId=r.job.head.jobId;$('job-new-title').value='';$('job-new').open=false;
   try{
    hostSameStorage();if(context!==activeContextId)throw Error('Rozmowa zmieniła się w trakcie tworzenia roboty.');
    if(!workspaceMeta?.targetJobId&&!contextBlank()){hostAssignTarget=jobId;note='Utworzono robotę „'+title+'”. Bieżący szkic pozostaje nieprzypisany — „Przypisz ten szkic” dołączy go do tej roboty.';return;}
    flushInput();openNewContext(jobId);hostSelected.clear();hostAcks.clear();render();
    note='Utworzono robotę „'+title+'” z nową, pustą rozmową. Poprzednia rozmowa i jej niewysłany tekst pozostają zapisane.';
   }catch(err){throw Error('Robotę „'+title+'” utworzono, ale nie otwarto jej rozmowy: '+err.message+' Wybierz ją z listy robót.');}
  });
  await hostRefresh();if(note)hostMessage(note);
 }catch(err){await hostRefresh();hostMessage(err.message);}
 finally{handoffBusy=false;controls();}
};
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==$('core-frame').contentWindow||e.data?.type!=='empire-workspace-ready')return;hostRefresh();});
$('core-frame').addEventListener('load',()=>{try{if(hostApi().ready)hostRefresh();}catch(e){hostMessage('Nie udało się wczytać lokalnych narzędzi. Szkic pozostaje zachowany.');}});

// --- Note / measurement for the job (stage 5) -------------------------------------------------------------
// A proposal of the assistant (assistantMeta.proposal) is only text on this screen until the user confirms an exact plan:
//   1. the user reads and corrects the fields; „Przejrzyj zapis” saves the corrected proposal (with its time and the job revision
//      it is reviewed against) and asks the job adapter for the plan: the exact record that would be stored;
//   2. „Potwierdź i zapisz w robocie” prepares again from what is saved now; only the very plan that was shown is accepted. The
//      plan, its input and its pending receipt are stored in the conversation BEFORE the adapter is called — when the browser
//      refuses that write, the job is not touched;
//   3. the adapter (core jobConversationActions through ecHostBridge) writes through the original job stores. „Zapisano” is said
//      only after the confirmed receipt replaced the pending plan in the stored conversation.
// A lost answer, a reload or a refused receipt write leave the pending plan in place: „Wznów zapis” repeats the same plan with
// its stored input (the adapter finds an already stored record instead of writing it twice), and the history of the job is asked
// (reconcile) before a plan is ever dropped. Nothing here writes a job store directly, and no spoken or typed "yes" confirms.
// hostActionForm: what is in the fields now (not yet saved). hostActionReview: the plan shown for confirmation.
// hostActionChecked: plan id for which the LAST history check of this tab answered "not stored", with no write attempt and no other
//   check since. It only decides whether „Zwolnij i przejrzyj ponownie” is offered; it is never the proof for dropping a plan:
//   hostActionRelease asks the history again under the lock. It is withdrawn before every commit attempt (first confirmation and
//   resume), as every check begins, on any answer other than "not stored", on an error and when the plan or conversation changes.
// hostActionAuto: plan id already checked after load.
var HOST_ACTION_UNACKED='Zapis jest w robocie, ale jego potwierdzenie nie zostało utrwalone w tej rozmowie — plan pozostaje oczekujący i nie został zwolniony. „Sprawdź w robocie” albo „Wznów zapis” dokończy potwierdzenie bez powielania. ';
// The only answer of reconcileAction that proves absence: the history was read and holds nothing of the plan. Unreadable history
// (stored:null), a refusal or any other shape is "unknown".
function hostActionAbsent(c){return !!c&&c.status==='pending'&&c.code==='NOT_STORED'&&c.stored===false;}
var hostActionForm=null,hostActionReview=null,hostActionStamp='',hostActionNote='',hostActionChecked='',hostActionAuto='',hostActionUnits=null,hostActionContext='';
var HOST_ACTION_LABELS={label:'Nazwa pomiaru',quantity:'Wielkość',valueText:'Wartość (liczba z kropką)',unit:'Jednostka',location:'Miejsce pomiaru',measuredLocal:'Czas pomiaru (lokalny)',utcOffset:'Strefa czasu (+/-GG:MM)',mode:'Rodzaj prądu',instrument:'Przyrząd',notes:'Uwagi do pomiaru'};
var HOST_ACTION_MAX={label:160,valueText:64,location:500,utcOffset:6,instrument:200,notes:4000};
var HOST_QUANTITIES={voltage:'napięcie',current:'prąd',resistance:'rezystancja',temperature:'temperatura',active_power:'moc czynna',apparent_power:'moc pozorna',frequency:'częstotliwość',length:'długość'};
var HOST_MODES=[['not_recorded','nie zapisano'],['AC','AC'],['DC','DC']];
function hostActionSay(text){hostActionNote=text;const el=$('action-status');if(el)el.textContent=text;}
// What the review fields hold and the conversation has not stored yet; part of the raw recovery copy.
function hostActionUnsaved(){const p=assistantMeta&&assistantMeta.proposal,f=hostActionForm;return p&&f&&f.proposalId===p.proposalId&&(f.note!==p.note||JSON.stringify(f.fields)!==JSON.stringify(p.fields))?copy(f):null;}
function hostActionValues(){
 const p=assistantMeta.proposal;
 if(!hostActionForm||hostActionForm.proposalId!==p.proposalId||hostActionForm.savedAt!==p.savedAt)hostActionForm={proposalId:p.proposalId,savedAt:p.savedAt,note:p.note,fields:p.fields?copy(p.fields):null};
 return hostActionForm;
}
// The adapter's refusals in the user's words. Field names of the measurement model are replaced by the labels of this form.
function hostActionProblem(r){
 const code=r&&typeof r.code==='string'?r.code:'',problems=r&&Array.isArray(r.problems)?r.problems.filter(x=>typeof x==='string'):[];
 if(code==='SOURCE_OUTDATED'||code==='STALE')return 'Robota albo propozycja zmieniła się od przeglądu. Niczego nie zapisano — użyj „Przejrzyj zapis” jeszcze raz.';
 if(code==='LIMIT')return 'Zapis przekroczyłby limit roboty (długość notatek albo liczba wersji). Niczego nie zapisano ani nie skrócono.';
 if(code==='JOB_REQUIRED'||code==='JOB_UNAVAILABLE')return 'Robota tej rozmowy nie jest teraz dostępna albo nie dała się odczytać. Niczego nie zapisano.';
 if(code==='UNAVAILABLE')return 'Zapis do roboty nie jest teraz możliwy w tej przeglądarce (blokada zapisu, pamięć albo funkcje kryptograficzne). Niczego nie zapisano tą próbą.';
 if(code==='VALIDATION'){
  const out=[];
  for(const text of problems){
   const field=/^([A-Za-z]+): /.exec(text);
   out.push(field&&HOST_ACTION_LABELS[field[1]]?'Pole „'+HOST_ACTION_LABELS[field[1]]+'” jest puste albo za długie.':/matching unit/.test(text)?'Wybierz wielkość i pasującą do niej jednostkę; jednostki nie są przeliczane.':/decimal value/.test(text)?'Wpisz wartość jako liczbę z kropką, bez separatorów tysięcy.':/AC\/DC/.test(text)?'Rodzaj prądu AC/DC dotyczy tylko napięcia i prądu; w innym razie wybierz „nie zapisano”.':/observed local/.test(text)?'Podaj poprawny czas pomiaru i strefę czasu (+/-GG:MM).':'Dane nie przeszły walidacji roboty.');
  }
  return [...new Set(out)].join(' ')||'Dane nie przeszły walidacji roboty.';
 }
 return 'Robota odmówiła zapisu'+(code?' ('+code+')':'')+'. Niczego nie zapisano tą próbą.';
}
// Saves new assistant data of the open conversation (entry-granular, like hostPersist). Memory is rolled back when the write fails.
function hostAssistPersist(next){
 hostSameStorage();const old=assistantMeta;assistantMeta=next;
 if(!persist()){assistantMeta=old;throw Object.assign(Error('Nie zapisano zmiany w przeglądarce'+(persistError?' ('+persistError+')':'')+'.'),{code:persistCode});}
}
function hostActionInput(job){
 const m=workspaceMeta,p=assistantMeta.proposal;
 return {sourceId:m.sourceId,sourceRevision:p.sourceRevision,sourceSavedAt:p.savedAt,sourceText:p.sourceText,job:{head:job.head,revision:job.revision},action:p.kind==='note'?{kind:'note',text:p.note}:{kind:'measurement',fields:copy(p.fields)}};
}
function hostActionLocked(){return hostExternalStale||storageBroken||bankBooting||handoffBusy||busy||audioBusy||recording||!!contextLost||!hostReady;}
function hostActionField(key,value,o){
 const wrap=node('div'),id='action-'+key,label=node('label',o.label);label.setAttribute('for',id);
 let el;
 if(o.options){
  el=node('select');
  for(const [v,t] of o.options){const op=node('option',t);op.value=v;el.append(op);}
  // A value outside the list is shown as it is, never replaced: the job model refuses it at review and the user chooses.
  if(!o.options.some(x=>x[0]===value)){const op=node('option',(value||'—')+' (do wyboru)');op.value=value;el.append(op);}
 }else{el=node(o.area?'textarea':'input');if(!o.area)el.type=o.type||'text';if(o.max)el.maxLength=o.max;}
 el.id=id;el.value=value;el.disabled=!!o.off;
 el.oninput=el.onchange=()=>{if(el.value===o.get())return;o.set(el.value);hostActionEdited(!!o.redraw);};
 wrap.append(label,el);return wrap;
}
// Any change of a field withdraws the plan that was shown: the user confirms only what was reviewed after the last change.
function hostActionEdited(redraw){
 const had=!!hostActionReview;hostActionReview=null;
 if(!had&&!redraw)return;
 let focused='';try{focused=document.activeElement&&document.activeElement.id||'';}catch(_){}
 if(had)hostActionSay('Zmieniono dane po przeglądzie — użyj „Przejrzyj zapis” ponownie. Niczego nie zapisano.');
 hostActionStamp='';hostActionRender();
 if(focused.startsWith('action-')){try{$(focused).focus();}catch(_){}}
}
function hostActionRender(){
 const panel=$('action-panel'),body=$('action-body');if(!panel||!body)return;
 if(hostActionContext!==activeContextId){hostActionContext=activeContextId;hostActionForm=null;hostActionReview=null;hostActionChecked='';hostActionNote='';hostActionStamp='';}
 const a=assistantMeta,p=a&&a.proposal,x=a&&a.action;
 // A remembered "not stored" answer belongs to exactly one pending plan of this conversation and never outlives it.
 if(hostActionChecked&&!(x&&x.phase==='pending'&&x.plan.id===hostActionChecked))hostActionChecked='';
 $('action-status').textContent=hostActionNote;panel.hidden=!p&&!hostActionNote;
 if(!p){hostActionForm=null;hostActionReview=null;if(hostActionStamp!=='none'){hostActionStamp='none';body.replaceChildren();}return;}
 const job=hostJob(p.job.jobId),jobMissing=!job,locked=hostActionLocked(),title=job?job.revision.title:'robota niedostępna na tym urządzeniu',form=hostActionValues();
 if(hostActionUnits===null&&hostReady){try{hostActionUnits=copy(hostApi().measurementUnits());}catch(_){hostActionUnits=null;}}
 // After a reload (or in a second tab) a started write is checked against the history of the job once, before anything else.
 if(x&&x.phase==='pending'&&!locked&&!jobMissing&&hostActionAuto!==x.plan.id){hostActionAuto=x.plan.id;Promise.resolve().then(hostActionReconcile);}
 const review=hostActionReview&&hostActionReview.savedAt===p.savedAt?hostActionReview:null;
 const stamp=JSON.stringify([activeContextId,p,x?[x.phase,x.plan.id]:null,review?review.plan.id:null,locked,jobMissing,hostActionChecked,!!hostActionUnits]);
 if(stamp===hostActionStamp)return;hostActionStamp=stamp;
 body.replaceChildren();
 body.append(node('p','Robota: „'+title+'” · '+(p.kind==='note'?'dopisanie do notatek roboty':'nowy pomiar w robocie'),'assist-title'),node('p','Na podstawie wypowiedzi:','handoff-help'),node('p',p.sourceText,'recovered-text'));
 if(jobMissing)body.append(node('p','Robota tej rozmowy nie istnieje na tym urządzeniu. Propozycję można czytać i odrzucić; zapis jest wyłączony, dopóki ta sama robota nie pojawi się w zakładce Roboty.','handoff-warning'));
 const row=node('div',undefined,'handoff-actions'),off=locked||jobMissing;
 const add=(text,id,fn,disabled,cls)=>{const b=hostButton(text,id,fn,cls||'quiet');b.disabled=!!disabled;row.append(b);};
 const preview=(kind,text,fields)=>{
  if(kind==='note'){body.append(node('p',text,'action-preview'));return;}
  body.append(node('p',fields.label+': '+fields.valueText+' '+fields.unit+' · '+(HOST_QUANTITIES[fields.quantity]||fields.quantity)+(fields.mode!=='not_recorded'?' · '+fields.mode:'')+'\nMiejsce: '+fields.location+'\nCzas pomiaru: '+fields.measuredLocal.replace('T',' ')+' (UTC'+fields.utcOffset+')'+(fields.instrument?'\nPrzyrząd: '+fields.instrument:'')+(fields.notes?'\nUwagi: '+fields.notes:''),'action-preview'));
 };
 if(x){
  const act=x.input.action;
  preview(act.kind,act.text,act.fields);
  if(x.phase==='conflict'){
   body.append(node('p','W historii roboty pod tożsamością tego zapisu jest inny zapis. Niczego nie nadpisano ani nie dopisano; ten plan nie będzie ponawiany. Sprawdź robotę w zakładce Roboty.','handoff-warning'));
   add('Zamknij ten zapis','action-dismiss',hostActionDismiss,locked);
  }else{
   body.append(node('p','Zapis do roboty został rozpoczęty i nie jest jeszcze potwierdzony w tej rozmowie. Rozmowa, jej archiwizacja, usunięcie i import są wstrzymane do wyjaśnienia. „Wznów zapis” używa tego samego planu i niczego nie powiela.','handoff-warning'));
   add('Wznów zapis','action-resume',hostActionCommit,off,'primary');
   add('Sprawdź w robocie','action-check',hostActionReconcile,off);
   if(hostActionChecked===x.plan.id)add('Zwolnij i przejrzyj ponownie','action-release',hostActionRelease,locked);
  }
  body.append(row);return;
 }
 if(p.kind==='note')body.append(hostActionField('note',form.note,{label:'Tekst dopisywany do notatek roboty',area:true,max:4000,off,get:()=>form.note,set:v=>{form.note=v;}}));
 else{
  const f=form.fields,units=hostActionUnits,field=(k,o={})=>body.append(hostActionField(k,f[k],{label:HOST_ACTION_LABELS[k],max:HOST_ACTION_MAX[k],off,get:()=>f[k],set:v=>{f[k]=v;},...o}));
  field('label');field('valueText');
  field('quantity',units?{options:Object.keys(units).map(k=>[k,HOST_QUANTITIES[k]||k]),redraw:true}:{max:40});
  field('unit',units&&units[f.quantity]?{options:units[f.quantity].map(u=>[u,u])}:{max:16});
  field('location');field('measuredLocal',{type:'datetime-local'});field('utcOffset');field('mode',{options:HOST_MODES});field('instrument');field('notes',{area:true});
 }
 if(review){
  const v=review.review;
  body.append(node('p','Dokładna treść zapisu po potwierdzeniu:','handoff-help'));
  if(p.kind==='note'){preview('note',String(v.appendedText));body.append(node('p','Istniejące notatki roboty ('+String(v.notesBefore).length+' zn.) pozostają bez zmian; po zapisie notatki będą miały '+String(v.notesAfter).length+' zn. Tekst zostanie dopisany na końcu'+(v.separator?' po pustym wierszu':'')+'.','handoff-help'));}
  else preview('measurement','',v.fields);
  body.append(node('p','Zapis utworzy nową wersję w historii roboty. Nie zatwierdza instalacji; poprawki zapisanych danych wprowadza się w zakładce Roboty.','handoff-help'));
  add('Potwierdź i zapisz w robocie','action-confirm',hostActionCommit,off,'primary');
 }else add('Przejrzyj zapis','action-review',hostActionPrepare,off,'primary');
 add('Odrzuć propozycję','action-cancel',hostActionCancel,locked);
 body.append(row);
}
async function hostActionPrepare(){
 if(!hostCanEdit()||!hostReady||!assistantMeta?.proposal||assistantMeta.action)return;
 handoffBusy=true;hostActionReview=null;controls();
 try{await hostExclusive(async()=>{
  hostSameStorage();
  const p=assistantMeta.proposal,form=hostActionValues(),change={};
  if(p.kind==='note'){if(!form.note.trim())throw Error('Notatka jest pusta. Wpisz tekst albo odrzuć propozycję.');if(form.note!==p.note)change.note=form.note;}
  else if(JSON.stringify(form.fields)!==JSON.stringify(p.fields))change.fields=copy(form.fields);
  const held=await assistJobRead();hostSameStorage();
  if(!held||held.snapshot.jobId!==p.job.jobId)throw Error('Robota tej rozmowy nie jest teraz dostępna na tym urządzeniu. Niczego nie zapisano.');
  // The proposal is saved again — with a new time — whenever it was corrected, the job has a newer revision than the one it was
  // reviewed against, or the job was saved after it. The time of that durable save is the time the record will carry.
  const s=held.snapshot,saved=held.job.revision.savedAt;
  if(s.revisionId!==p.job.revisionId)change.job={jobId:s.jobId,revisionId:s.revisionId,revisionNumber:s.revisionNumber};
  if(Object.keys(change).length||(typeof saved==='string'&&p.savedAt<saved)){
   // The job refuses a record dated before its current revision (SOURCE_OUTDATED). When the clock of this device is behind the
   // last save of the job, saving the proposal again cannot help and reviewing again would only repeat the refusal: the cause
   // is said here, before anything is stored. The fields on the screen stay as they are.
   const now=new Date().toISOString();
   if(typeof saved==='string'&&Date.parse(now)<Date.parse(saved))throw Error('Zegar tego urządzenia ('+hostWhen(now)+') wskazuje czas wcześniejszy niż ostatni zapis tej roboty ('+hostWhen(saved)+'), a zapis z rozmowy nie może być datowany przed nim. Ustaw poprawną datę i godzinę urządzenia, potem użyj „Przejrzyj zapis” — samo ponawianie przeglądu niczego nie zmieni. Niczego nie zapisano; propozycja i poprawki pozostają na ekranie.');
   hostAssistPersist(ASession.editProposal(assistantMeta,change,now));assistEpoch++;hostActionValues();
  }
  const input=hostActionInput(held.job),r=copy(await hostApi().prepareAction(input));hostSameStorage();
  if(!r.ok)throw Error(hostActionProblem(r));
  hostActionReview={plan:r.plan,review:r.review,savedAt:assistantMeta.proposal.savedAt};
  hostActionSay('Sprawdź dokładną treść zapisu. W robocie niczego jeszcze nie zapisano.');
 });}catch(e){hostActionReview=null;hostActionSay(e.message);}finally{handoffBusy=false;hostActionStamp='';controls();}
}
// True only when the STORED conversation holds exactly this plan as pending. Asked by the adapter immediately before its write.
function hostActionMarker(planId){
 try{const stored=CBank.get(CBank.parse(localStorage.getItem(KEY)),activeContextId),held=stored&&stored.envelope.assistant&&stored.envelope.assistant.action;return !!(held&&held.phase==='pending'&&held.plan.id===planId);}
 catch(_){return false;}
}
async function hostActionCommit(){
 if(handoffBusy||busy||audioBusy||recording||storageBroken||bankBooting||hostExternalStale||contextLost||!hostReady||!assistantMeta?.proposal)return;
 const resume=ASession.pending(assistantMeta);
 if(!resume&&(assistantMeta.action||!hostActionReview||JHSession.pending(workspaceMeta)))return;
 // A write attempt begins: whatever the history answered before is no longer known to be true. Withdrawn BEFORE the attempt, on
 // the first confirmation and on every resume, and never restored by this function — only a later check can show absence again.
 handoffBusy=true;hostActionChecked='';let written=false;controls();
 try{await hostExclusive(async()=>{
  hostSameStorage();if(hostApi().hasDraft())throw Error('W Robocie jest otwarty formularz. Zapisz go albo odrzuć przed zapisem z rozmowy.');
  let plan,input;
  if(resume){plan=copy(assistantMeta.action.plan);input=copy(assistantMeta.action.input);}
  else{
   // Prepared again from the saved proposal and the job as its store holds it NOW: only the very plan that was shown is confirmed.
   const shown=hostActionReview,p=assistantMeta.proposal,form=hostActionValues(),again='Robota albo propozycja zmieniła się po przeglądzie. Niczego nie zapisano — użyj „Przejrzyj zapis” ponownie.';
   if(shown.savedAt!==p.savedAt||(p.kind==='note'?form.note!==p.note:JSON.stringify(form.fields)!==JSON.stringify(p.fields))){hostActionReview=null;throw Error(again);}
   const held=await assistJobRead();hostSameStorage();
   if(!held)throw Error('Robota tej rozmowy nie jest teraz dostępna na tym urządzeniu. Niczego nie zapisano.');
   input=hostActionInput(held.job);const r=copy(await hostApi().prepareAction(input));hostSameStorage();
   if(!r.ok||r.plan.id!==shown.plan.id){hostActionReview=null;throw Error(again);}
   plan=r.plan;const mark=copy(hostApi().pendingAction(plan));
   if(!mark.ok)throw Error(hostActionProblem(mark));
   // The durable marker comes first. A refusal of the browser (no room, another tab) ends here: the job is not touched.
   hostAssistPersist(ASession.enter(assistantMeta,plan,input,mark.receipt));hostActionChecked='';
  }
  // The automatic history check is for a plan found after a reload; a plan this tab is working on is settled right here.
  hostActionAuto=plan.id;
  const name=hostJobName(plan.job.jobId);
  const finish=(receipt,reconciled)=>{
   written=true;hostAssistPersist(ASession.done(assistantMeta,receipt));hostActionReview=null;assistEpoch++;
   hostActionSay('Zapisano '+(plan.action==='note'?'notatkę w notatkach roboty ':'pomiar w robocie ')+name+(reconciled?' — ten zapis był już w historii roboty, niczego nie dopisano drugi raz':'')+'. Poprawki zapisanych danych wprowadza się w zakładce Roboty.');
  };
  hostActionChecked='';
  const r=copy(await hostApi().commitAction(plan,input,{accepted:true,planId:plan.id},async()=>hostActionMarker(plan.id)));
  if(r.status==='confirmed'){finish(r.receipt,r.reconciled===true);return;}
  if(r.status==='conflict'){hostAssistPersist(ASession.conflict(assistantMeta,r.receipt));throw Error('W historii roboty pod tożsamością tego zapisu jest inny zapis. Niczego nie nadpisano ani nie dopisano; ten plan nie będzie ponawiany.');}
  if(r.status==='pending')throw Error('Zapis nie został potwierdzony'+(r.stored===false?' — w robocie niczego nie zapisano':' — nie wiadomo, czy robota go przyjęła')+'. Plan pozostaje zachowany; „Wznów zapis” sprawdzi historię roboty i niczego nie powieli.');
  // Refused: this call wrote nothing. The plan is dropped only with proof that the history holds nothing of it.
  let absent=r.stored===false;
  if(!absent){
   const c=copy(await hostApi().reconcileAction(assistantMeta.action.receipt));
   if(c.status==='confirmed'){finish(c.receipt,true);return;}
   absent=hostActionAbsent(c);
  }
  if(absent){hostAssistPersist(ASession.release(assistantMeta));hostActionReview=null;}
  throw Error(hostActionProblem(r)+(absent?' Propozycja czeka na ponowny przegląd.':' Plan pozostaje zachowany do sprawdzenia („Sprawdź w robocie”).'));
 });}catch(e){hostActionSay((written?'Zapis jest w robocie, ale jego potwierdzenie nie zostało utrwalone w tej rozmowie — potwierdzenie oczekuje. „Wznów zapis” dokończy je bez powielania. ':'')+e.message);}
 finally{handoffBusy=false;hostActionStamp='';controls();}
}
// Read-only question to the history of the job about a started write. Never writes a record.
async function hostActionReconcile(){
 if(handoffBusy||busy||audioBusy||recording||storageBroken||bankBooting||hostExternalStale||contextLost||!hostReady||!ASession.pending(assistantMeta))return;
 // An earlier "not stored" answer is withdrawn as this check begins; only the answer read below, for the same plan of the same
 // conversation, can make it true again. Unknown, an error, confirmed and conflict all leave it withdrawn.
 handoffBusy=true;hostActionChecked='';controls();const id=assistantMeta.action.plan.id,context=activeContextId;let found=false;
 try{await hostExclusive(async()=>{
  hostSameStorage();
  const same=()=>context===activeContextId&&ASession.pending(assistantMeta)&&assistantMeta.action.plan.id===id;
  if(!same())return;
  const c=copy(await hostApi().reconcileAction(assistantMeta.action.receipt));hostSameStorage();
  if(!same())return;
  // The record IS in the job. When the browser refuses the receipt (hostAssistPersist throws), the pending plan stays and the
  // truth is said (found); the job is never touched from here.
  if(c.status==='confirmed'){found=true;hostAssistPersist(ASession.done(assistantMeta,c.receipt));assistEpoch++;hostActionSay('Sprawdzono historię roboty: ten zapis jest w robocie. Potwierdzenie utrwalono w rozmowie; niczego nie dopisano drugi raz.');return;}
  if(c.status==='conflict'){hostAssistPersist(ASession.conflict(assistantMeta,c.receipt));hostActionSay('Sprawdzono historię roboty: pod tożsamością tego zapisu jest inny zapis. Niczego nie nadpisano; plan nie będzie ponawiany.');return;}
  if(hostActionAbsent(c)){hostActionChecked=id;hostActionSay('Sprawdzono historię roboty: tego zapisu w niej nie ma. „Wznów zapis” zapisze go teraz tym samym planem; „Zwolnij i przejrzyj ponownie” sprawdzi historię jeszcze raz i porzuci plan bez zapisu.');return;}
  hostActionSay('Nie udało się teraz sprawdzić historii roboty. Plan pozostaje zachowany; spróbuj ponownie.');
 });}catch(e){hostActionChecked='';hostActionSay((found?HOST_ACTION_UNACKED:'')+e.message);}finally{handoffBusy=false;hostActionStamp='';controls();}
}
// One stored change of the assistant data from a button of this panel; `change` returns the next data.
async function hostActionChange(allowed,change,done){
 if(hostActionLocked()||!allowed())return;
 try{await hostExclusive(()=>{if(hostActionLocked()||!allowed())throw Error('Najpierw dokończ bieżącą operację.');hostAssistPersist(change());});hostActionReview=null;hostActionForm=null;assistEpoch++;hostActionSay(done);}
 catch(e){hostActionSay(e.message);}
 hostActionStamp='';controls();
}
// Cancelling is inert: the proposal disappears from the conversation, nothing was or will be written for it.
function hostActionCancel(){return hostActionChange(()=>!!assistantMeta?.proposal&&!assistantMeta.action,()=>ASession.dropProposal(assistantMeta),'Odrzucono propozycję. W robocie niczego nie zapisano.');}
// Drops a pending plan ONLY on proof read now. The button is offered after a "not stored" check, but that remembered answer is
// not the proof (a resume in this tab or a write of the same plan in another tab may have stored the record since): it is
// withdrawn here and the history of the job is asked again inside the conversation lock, for exactly the plan the button was
// shown for. Released only when that fresh answer is "not stored" and the conversation, its stored bytes and the whole pending
// action are still the same after the read. Record found -> the confirmed receipt replaces the plan (nothing is released);
// another record under its identity -> conflict; unreadable history -> nothing changes and the plan stays pending.
// The job lives in another database: this is a check immediately before the conversation write, not one atomic step with it.
async function hostActionRelease(){
 if(hostActionLocked()||!ASession.pending(assistantMeta)||hostActionChecked!==assistantMeta.action.plan.id)return;
 const id=assistantMeta.action.plan.id,context=activeContextId,held=JSON.stringify(assistantMeta.action);let found=false;
 handoffBusy=true;hostActionChecked='';controls();
 try{await hostExclusive(async()=>{
  const changed='Rozmowa albo plan zapisu zmieniły się w trakcie sprawdzania. Niczego nie zwolniono; plan pozostaje zachowany.';
  const same=()=>context===activeContextId&&!contextLost&&ASession.pending(assistantMeta)&&assistantMeta.action.plan.id===id&&JSON.stringify(assistantMeta.action)===held;
  hostSameStorage();if(!same())throw Error(changed);
  const c=copy(await hostApi().reconcileAction(assistantMeta.action.receipt));
  hostSameStorage();if(!same())throw Error(changed);
  if(c.status==='confirmed'){
   found=true;hostAssistPersist(ASession.done(assistantMeta,c.receipt));hostActionReview=null;hostActionForm=null;assistEpoch++;
   hostActionSay('Nie zwolniono planu: sprawdzona teraz historia roboty zawiera ten zapis. Potwierdzenie utrwalono w rozmowie; niczego nie dopisano drugi raz.');return;
  }
  if(c.status==='conflict'){hostAssistPersist(ASession.conflict(assistantMeta,c.receipt));hostActionSay('Nie zwolniono planu: pod tożsamością tego zapisu jest w historii roboty inny zapis. Niczego nie nadpisano; plan nie będzie ponawiany.');return;}
  if(hostActionAbsent(c)){
   hostAssistPersist(ASession.release(assistantMeta));hostActionReview=null;hostActionForm=null;assistEpoch++;
   hostActionSay('Zwolniono plan zapisu — sprawdzona teraz historia roboty go nie zawiera. Propozycja czeka na ponowny przegląd; niczego nie zapisano.');return;
  }
  hostActionSay('Nie zwolniono planu: nie udało się teraz odczytać historii roboty, więc nie wiadomo, czy zapis w niej jest. Plan pozostaje zachowany; użyj „Sprawdź w robocie” albo „Wznów zapis”.');
 });}catch(e){hostActionSay((found?HOST_ACTION_UNACKED:'')+e.message);}finally{handoffBusy=false;hostActionStamp='';controls();}
}
function hostActionDismiss(){return hostActionChange(()=>assistantMeta?.action?.phase==='conflict',()=>ASession.dismiss(assistantMeta),'Zamknięto sporny zapis. W robocie niczego nie zmieniono.');}

// --- Other tabs -----------------------------------------------------------------------------------------
// Reloads the ACTIVE conversation after another tab changed it. Local unsent text is kept in the field when the other tab
// did not touch the text. When both tabs changed the text, the stored text is shown and this tab's text is offered for
// explicit recovery; it is never written over the other tab's text automatically.
async function hostResync(){
 if(handoffBusy||busy||audioBusy||recording||bankBooting||storageBroken)return;
 try{
  let note='Wczytano aktualną rozmowę z drugiej karty.';
  await hostExclusive(()=>{
   const raw=localStorage.getItem(KEY);
   // Archived, deleted or rewritten by a newer application: this tab keeps its screen and offers a recovery copy (hostRender).
   contextLost=lostReason(raw);if(contextLost)throw Error(LOST[contextLost]+LOST_HELP);
   const fresh=CBank.parse(raw),entry=CBank.get(fresh,activeContextId);
   if(!entry)throw Error('Tej rozmowy nie ma już w zapisie. Zachowano dane na ekranie; wyeksportuj szkic.');
   const local=$('input').value,dirty=local!==inputSaved,foreignText=entry.input!==inputSaved,previous={bank,storageVersion},staleVersion=activeVersion;
   bank=fresh;storageVersion=raw;
   try{activateEntry(entry,{keepInput:dirty&&!foreignText});}catch(e){bank=previous.bank;storageVersion=previous.storageVersion;throw e;}
   if(dirty&&!foreignText)note+=' Niewysłany tekst pozostał w polu.';
   if(dirty&&foreignText&&local!==entry.input){recoveryPark(entry.contextId,local,staleVersion);note+=' Tekst wpisany w tej karcie zachowano obok — nie nadpisał tekstu z drugiej karty.';}
   hostSelected.clear();hostAcks.clear();hostExternalStale=false;render();
  });
  await hostRefresh();hostMessage(note);
 }catch(e){hostExternalStale=true;hostMessage(e.message);controls();}
}
// ui.js handles the same event first and adopts changes that concern only other conversations (then the bytes match).
window.addEventListener('storage',e=>{
 if(e.key!==KEY&&e.key!==null)return;
 let raw;try{raw=localStorage.getItem(KEY);}catch(_){return;}
 if(storageBroken||raw===storageVersion)return;
 hostExternalStale=true;controls();if(!handoffBusy)hostResync();
});
window.addEventListener('beforeunload',e=>{if(handoffBusy){e.preventDefault();e.returnValue='';}});
// Leaves a conversation this tab can no longer save. Nothing is written: the stored bank is read and one of its conversations is shown.
async function hostLeaveLost(){
 if(handoffBusy||busy||audioBusy||recording||storageBroken||!contextLost)return;
 try{
  await hostExclusive(()=>{
   const raw=localStorage.getItem(KEY);if(raw===null)throw Error('Zapis rozmów nie istnieje. Po pobraniu kopii awaryjnej otwórz stronę ponownie.');
   const fresh=CBank.parse(raw),entry=CBank.latest(fresh,workspaceMeta?.targetJobId||null)||CBank.latest(fresh);
   if(!entry)throw Error('W zapisie nie ma aktywnej rozmowy. Po pobraniu kopii awaryjnej otwórz stronę ponownie, aby zacząć nową.');
   const previous={bank,storageVersion};bank=fresh;storageVersion=raw;
   try{activateEntry(entry);}catch(e){bank=previous.bank;storageVersion=previous.storageVersion;throw e;}
   hostSelected.clear();hostAcks.clear();hostExternalStale=false;render();
  });
  await hostRefresh();hostMessage('Otwarto zapisaną rozmowę. Poprzedni ekran nie został zapisany w przeglądarce.');
 }catch(e){hostMessage(e.message);controls();}
}

// --- Conversation management ------------------------------------------------------------------------------
// The panel shows what is stored and collects an explicit choice. Every change goes through ui.js (bankManage /
// conversationImport): one pure CBank operation and one verified write under the lock. Opening the panel, choosing a file,
// a preview, a confirmation box and Cancel change nothing.
var hostManageShown=false,hostManageReason='',hostManageNote='',hostManageNoteKind='',hostManageConfirm=null,hostManageViewId='',hostImport=null,hostImportRun=0;
var HOST_IMPORT_BYTES=8000000;
function hostManageOpen(reason){hostManageShown=true;hostManageReason=reason||'';hostManageNote='';hostManageNoteKind='';hostRender();try{$('manage-title').focus();}catch(_){}}
function hostManageClose(){hostManageShown=false;hostManageReason='';hostManageConfirm=null;hostManageViewId='';hostRender();try{$('manage-open').focus();}catch(_){}}
function hostManageSay(text,kind){hostManageNote=text;hostManageNoteKind=kind||'';}
function hostJobName(jobId){const job=jobId?hostJob(jobId):null;return jobId?(job?'„'+job.revision.title+'”':'robota niedostępna na tym urządzeniu'):'bez roboty';}
function hostWhen(iso){try{return new Date(iso).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch(_){return String(iso);}}
// A started write to a job, a running request or recording, or a tab that lost its conversation: no management until that is settled.
function hostManageBusy(){return hostExternalStale||storageBroken||bankBooting||handoffBusy||busy||audioBusy||recording||hostPending()||!!contextLost;}
// Runs one management operation under the lock and reports the outcome in the panel. A refusal leaves bank, screen and text as they were.
async function hostManageRun(run,done){
 const refused='Najpierw dokończ bieżącą operację albo rozpoczęty zapis do roboty („Wznów zapis”). Niczego nie zmieniono.';
 if(hostManageBusy()){hostManageSay(refused,'error');hostRender();return;}
 try{
  let result=null;
  await hostExclusive(()=>{if(hostManageBusy())throw Error(refused);result=run();if(result.switched){hostSelected.clear();hostAcks.clear();}});
  // The operation went through while the text of the conversation that stays open could not be stored in it (it is in the field
  // and, when the journal took it, in the recovery copy). That is said here, and the save is tried again at once: room may be free now.
  const unsaved=result.unsaved&&!result.switched?' Uwaga: niewysłany tekst otwartej rozmowy nadal nie jest w niej zapisany ('+result.unsaved+'). Pozostaje w polu; ponawiam zapis — w razie odmowy użyj „Zapisz tekst ponownie” albo wyeksportuj szkic.':'';
  hostManageConfirm=null;hostManageReason='';hostManageSay(done(result)+unsaved,unsaved?'error':'');
  if(unsaved)scheduleInputSave(0);
 }catch(e){hostManageSay(e&&e.message||'Operacja nie powiodła się. Niczego nie zmieniono.','error');}
 render();
}
// The exact version the operation is based on: for the open conversation the version this tab holds after saving its text,
// for any other conversation the version shown in the panel when the button was pressed.
function hostBase(id,seen){return {contextId:id,baseVersion:id===activeContextId?activeVersion:seen,now:new Date().toISOString()};}
function hostManageArchive(id,seen){return hostManageRun(()=>bankManage(id,b=>CBank.archive(b,hostBase(id,seen))),r=>'Przeniesiono rozmowę do archiwum. Nadal zajmuje pamięć przeglądarki; można ją przejrzeć, wyeksportować i przywrócić.'+(r.switched?' Otwarto inną rozmowę tej roboty.':''));}
function hostManageRestore(id,seen){return hostManageRun(()=>bankManage(id,b=>CBank.restore(b,hostBase(id,seen))),()=>'Przywrócono rozmowę do aktywnych. Jest na liście rozmów swojej roboty.');}
function hostManageDelete(id,seen){return hostManageRun(()=>bankManage(id,b=>CBank.retire(b,hostBase(id,seen))),r=>'Usunięto rozmowę i zwolniono jej miejsce. Pozostał krótki zapis o usunięciu.'+(r.switched?' Otwarto inną rozmowę.':''));}
async function hostManageExport(id){
 try{
  let payload=null;const own=id===activeContextId;
  await hostExclusive(()=>{if(own){journalWrite();try{flushInput();}catch(_){}}bankSync();payload=conversationArchive(id,own?$('input').value:undefined);});
  download(payload,'EmpireCode-rozmowa.json');hostManageSay('Pobrano archiwum rozmowy. Eksport niczego nie usuwa i nie zwalnia miejsca.'+archiveNote(payload));
 }catch(e){hostManageSay('Nie pobrano archiwum rozmowy: '+(e&&e.message||'błąd')+' Niczego nie zmieniono.','error');}
 hostRender();
}
function hostManageRow(entry,state,busyNow){
 const id=entry.contextId,s=entry.envelope.state,w=entry.envelope.workspace,pending=CBank.isPending(entry.envelope);
 const row=node('div',undefined,'manage-row'+(id===activeContextId?' current':''));
 row.append(node('strong',hostConversationLabel(entry)));
 row.append(node('p',hostJobName(entry.jobId)+' · wiadomości: '+s.history.length+' · pozycje: '+s.items.length+(w&&w.receipts.length?' · zapisane materiały: '+w.receipts.length:'')+(entry.input?' · niewysłany tekst: '+entry.input.length+' zn.':'')+(id===activeContextId?' · otwarta teraz':'')+(pending?' · rozpoczęty zapis do roboty — najpierw go dokończ':''),'manage-meta'));
 const actions=node('div',undefined,'handoff-actions');
 const add=(text,key,fn,off,cls)=>{const b=hostButton(text,'manage-'+key+'-'+id,fn,cls||'quiet');b.disabled=!!off;actions.append(b);};
 if(state==='active')add('Archiwizuj','archive',()=>hostManageArchive(id,entry.version),busyNow||pending);
 else{
  add('Podgląd','view',()=>{hostManageViewId=hostManageViewId===id?'':id;hostRender();},false);
  add('Przywróć','restore',()=>hostManageRestore(id,entry.version),busyNow);
 }
 add('Eksportuj','export',()=>hostManageExport(id),storageBroken||bankBooting||!!contextLost);
 add('Usuń…','delete',()=>{hostManageConfirm={contextId:id,version:entry.version,ack:false};hostManageSay('');hostRender();},busyNow||pending,'danger');
 row.append(actions);return row;
}
// Explicit confirmation of a deletion. Showing it, ticking the box and Cancel change nothing.
function hostManageRenderConfirm(busyNow){
 const box=$('manage-confirm'),c=hostManageConfirm,held=c?CBank.where(bank,c.contextId):null;
 box.replaceChildren();
 if(!c||!held||held.state==='retired'){hostManageConfirm=null;box.hidden=true;return;}
 const e=held.entry,w=e.envelope.workspace,saved=w?w.receipts.length:0;
 box.hidden=false;box.append(node('strong','Usunąć rozmowę „'+hostConversationLabel(e)+'”?'));
 box.append(node('p','Usunięcie jest trwałe: z tej przeglądarki znikną wiadomości tej rozmowy ('+e.envelope.state.history.length+'), pozycje szkicu ('+e.envelope.state.items.length+') i jej niewysłany tekst'+(e.contextId===activeContextId?' — także tekst wpisany teraz w polu wiadomości':'')+'. To zwalnia miejsce. '+(saved?'Materiały już zapisane do roboty ('+saved+') pozostają w robocie. ':'')+'Zostanie krótki zapis o usunięciu (identyfikatory i potwierdzenia materiałów), aby stara karta ani stary plik nie przywróciły tej rozmowy po cichu. Jeśli chcesz ją zachować, najpierw użyj „Eksportuj”.','handoff-warning'));
 const label=node('label',undefined,'handoff-row'),ack=node('input');ack.type='checkbox';ack.id='manage-delete-ack';ack.checked=c.ack;ack.onchange=()=>{c.ack=ack.checked;hostRender();};
 label.append(ack,node('span','Rozumiem — usuń tę rozmowę na stałe.'));box.append(label);
 const row=node('div',undefined,'handoff-actions'),yes=hostButton('Usuń na stałe','manage-delete-confirm',()=>hostManageDelete(c.contextId,c.version),'danger');
 yes.disabled=busyNow||!c.ack;row.append(yes,hostButton('Anuluj','manage-delete-cancel',()=>{hostManageConfirm=null;hostRender();}));box.append(row);
}
// Read-only view of one archived conversation. Nothing here can be edited, sent or written to a job.
function hostManageRenderView(){
 const box=$('manage-view'),held=hostManageViewId?CBank.where(bank,hostManageViewId):null;
 box.replaceChildren();
 if(!held||held.state!=='archived'){hostManageViewId='';box.hidden=true;return;}
 const e=held.entry,s=e.envelope.state;
 box.hidden=false;box.append(node('strong','Podgląd zarchiwizowanej rozmowy (tylko do odczytu)'),node('p',hostJobName(e.jobId)+' · w archiwum od '+hostWhen(held.archivedAt)+' · ostatnia zmiana '+hostWhen(e.updatedAt),'manage-meta'));
 if(!s.history.length)box.append(node('p','Brak wiadomości.','manage-empty'));
 for(const m of s.history){const msg=node('div',undefined,'message '+(m.role==='user'?'user':'assistant'));msg.append(node('span',m.role==='user'?'TY':'EMPIRE · ONLINE','role'),node('div',m.content));box.append(msg);}
 for(const i of s.items)box.append(node('p',(i.quantity??'?')+' '+(i.unit??'?')+' — '+i.name+(i.specification?' · '+i.specification:'')));
 box.append(node('p',e.input?'Niewysłany tekst:':'Brak niewysłanego tekstu.','manage-meta'));
 if(e.input)box.append(node('p',e.input,'recovered-text'));
 box.append(hostButton('Zamknij podgląd','manage-view-close',()=>{hostManageViewId='';hostRender();}));
}
// Read-only: classifies the chosen file against this tab's view of the bank. Applying repeats every check on freshly read bytes.
function hostImportInspect(){
 const x=hostImport;if(!x||x.text===null)return;
 try{x.preview=CBank.inspect(x.text,bank,{validate:envelopeCheck,now:new Date().toISOString()});x.error='';if(x.preview.refused.active&&!x.preview.refused.archived)x.destination='archived';}
 catch(e){x.preview=null;x.error=e&&e.message||'Plik nie jest archiwum rozmowy. Niczego nie zmieniono.';}
}
function hostImportCancel(){hostImportRun++;hostImport=null;try{$('import-file').value='';}catch(_){}hostRender();}
function hostImportRender(busyNow){
 const box=$('import-preview'),x=hostImport;box.replaceChildren();
 if(!x){box.hidden=true;return;}
 box.hidden=false;box.append(node('strong','Podgląd importu: '+x.name));
 const row=node('div',undefined,'handoff-actions'),cancel=hostButton('Anuluj','import-cancel',hostImportCancel);
 if(x.error||!x.preview){box.append(node('p',x.error||'Sprawdzam plik…',x.error?'handoff-warning':'handoff-help'));row.append(cancel);box.append(row);return;}
 const p=x.preview,job=p.jobId?hostJob(p.jobId):null;
 box.append(node('p','Robota: '+(p.jobId?(job?'„'+job.revision.title+'”':'nie istnieje na tym urządzeniu'):'bez roboty (nieprzypisana)')+' · pozycje szkicu: '+p.items+' · wiadomości: '+p.history+' · potwierdzenia zapisanych materiałów: '+p.receipts+' · dodatkowe kopie niewysłanego tekstu: '+p.recovery+' · plik z '+hostWhen(p.exportedAt),'manage-meta'));
 if(p.jobId&&!job)box.append(node('p','Roboty z pliku nie ma w zakładce Roboty na tym urządzeniu. Rozmowę można wczytać, czytać, zmieniać i eksportować, ale zapis materiałów pozostanie wyłączony, dopóki ta sama robota nie pojawi się tutaj (np. po odtworzeniu jej archiwum .ecjob). Import nie tworzy roboty i nie przypisuje rozmowy do innej.','handoff-warning'));
 // Assistant data of the file. A calculator is imported as input only and is recomputed here; a proposal is never written by an import.
 const helper=p.assistant;
 if(helper&&(helper.tool||helper.proposal||helper.conflict||helper.receipts))box.append(node('p','Dane asystenta w pliku: '+[helper.tool?'kalkulator rozmowy (same dane wejściowe — wynik zostanie policzony na tym urządzeniu)':'',helper.proposal?'propozycja notatki lub pomiaru do przeglądu (niezapisana w robocie)':'',helper.conflict?'zamknięty spór o zapis do roboty':'',helper.receipts?'potwierdzenia notatek i pomiarów zapisanych do roboty: '+helper.receipts:''].filter(Boolean).join(' · ')+'.','manage-meta'));
 box.append(node('p',p.unsentText?'Niewysłany tekst z pliku (nie zostanie wysłany):':'Plik nie zawiera niewysłanego tekstu.','manage-meta'));
 if(p.unsentText)box.append(node('p',p.unsentText,'recovered-text'));
 const addable=p.outcome==='new'||(p.outcome==='retired'&&p.restorable);
 const verdict=p.outcome==='new'?'Tej rozmowy nie ma w tej przeglądarce. Zostanie dodana z identyfikatorami, czasami i potwierdzeniami z pliku; żadna inna rozmowa nie zostanie zmieniona ani usunięta.':p.outcome==='identical'?'Ta rozmowa jest już w tej przeglądarce w dokładnie tej postaci. Ponowny import niczego nie zmieni i niczego nie powieli.':(p.outcome==='conflict'?'Konflikt: ':'')+p.reason;
 box.append(node('p',verdict,p.outcome==='new'||p.outcome==='identical'?'handoff-help':'handoff-warning'));
 if(addable){
  for(const [value,text] of [['active','Dodaj do aktywnych rozmów'],['archived','Dodaj do archiwum (nie liczy się do limitu aktywnych, zajmuje miejsce)']]){
   const label=node('label',undefined,'handoff-row'),radio=node('input');radio.type='radio';radio.name='import-destination';radio.id='import-to-'+value;radio.checked=x.destination===value;radio.disabled=!!p.refused[value];
   radio.onchange=()=>{x.destination=value;hostRender();};label.append(radio,node('span',text+(p.refused[value]?' — teraz niedostępne: '+p.refused[value]:'')));box.append(label);
  }
  if(p.outcome==='retired'){
   const label=node('label',undefined,'handoff-row'),ack=node('input');ack.type='checkbox';ack.id='import-restore-ack';ack.checked=x.restore;ack.onchange=()=>{x.restore=ack.checked;hostRender();};
   label.append(ack,node('span','Przywróć usuniętą rozmowę z tego pliku.'));box.append(label);
  }
 }
 const apply=hostButton('Zastosuj import','import-apply',hostImportApply,'primary');
 apply.disabled=busyNow||!(p.outcome==='identical'||(addable&&!p.refused[x.destination]&&(p.outcome!=='retired'||x.restore)));
 row.append(apply,cancel);box.append(row);
}
async function hostImportApply(){
 const x=hostImport;if(!x||x.text===null)return;
 let applied=false;
 await hostManageRun(()=>conversationImport(x.text,{destination:x.destination,restoreRetired:x.restore===true}),r=>{
  applied=true;
  // Nothing of an identical file is applied a second time, including its copies of unsent text; that is said, not done silently.
  if(!r.changed)return 'Bez zmian: ta rozmowa jest już w tej przeglądarce w tej samej postaci.'+(x.preview&&x.preview.recovery?' Kopie niewysłanego tekstu z pliku ('+x.preview.recovery+') nie zostały dodane ponownie; pozostają w pliku.':'');
  return (r.outcome==='retired'?'Przywrócono usuniętą rozmowę z pliku':'Zaimportowano rozmowę')+(x.destination==='archived'?' do archiwum.':' do aktywnych — jest na liście rozmów swojej roboty.')+(r.recovery.length>r.lost?' Kopie niewysłanego tekstu z pliku ('+(r.recovery.length-r.lost)+') czekają przy tej rozmowie na jawny wybór.':'')+(r.lost?' Nie udało się odtworzyć '+r.lost+' kopii niewysłanego tekstu; pozostają w pliku.':'');
 });
 if(applied){hostImportRun++;hostImport=null;try{$('import-file').value='';}catch(_){}}else hostImportInspect();
 hostRender();
}
function hostManageRender(){
 const panel=$('manage-panel');if(!panel)return;
 panel.hidden=!hostManageShown;$('manage-open').setAttribute('aria-expanded',hostManageShown?'true':'false');
 if(!hostManageShown)return;
 const jobId=workspaceMeta?.targetJobId||null,use=CBank.usage(bank,jobId),busyNow=hostManageBusy();
 const reason=$('manage-reason');reason.hidden=!hostManageReason;reason.textContent=hostManageReason;
 $('manage-usage').textContent='Wybrana robota: '+hostJobName(jobId)+' — aktywne rozmowy '+use.job+' z '+use.jobLimit+'. Wszystkie aktywne: '+use.active+' z '+use.activeLimit+'. Archiwum: '+use.archived+' z '+use.archivedLimit+'. Zapisy o usuniętych rozmowach: '+use.retired+' z '+use.retiredLimit+'. Zajęte miejsce zapisu rozmów: około '+Math.round((storageVersion?storageVersion.length:0)/use.charsLimit*100)+'% limitu (aktywne, archiwum i zapisy o usunięciu razem).'+(busyNow?' Zmiany są teraz wstrzymane: dokończ bieżącą operację albo rozpoczęty zapis do roboty.':'');
 const note=$('manage-status');note.textContent=hostManageNote;note.className=hostManageNoteKind;
 // The selected job first, then the rest: the global limit concerns all of them.
 const active=CBank.list(bank,jobId).concat(CBank.list(bank).filter(e=>e.jobId!==jobId)),stored=CBank.archived(bank,jobId).concat(CBank.archived(bank).filter(e=>e.jobId!==jobId));
 const a=$('manage-active');a.replaceChildren();if(!active.length)a.append(node('p','Brak zapisanych aktywnych rozmów.','manage-empty'));for(const e of active)a.append(hostManageRow(e,'active',busyNow));
 const z=$('manage-archived');z.replaceChildren();if(!stored.length)z.append(node('p','Archiwum jest puste.','manage-empty'));for(const e of stored)z.append(hostManageRow(e,'archived',busyNow));
 hostManageRenderConfirm(busyNow);hostManageRenderView();hostImportRender(busyNow);
}
$('manage-open').onclick=()=>{if(hostManageShown)hostManageClose();else hostManageOpen('');};
$('manage-close').onclick=hostManageClose;
// Choosing a file reads and checks it, nothing more. A cancelled file dialog (no file) is ignored.
$('import-file').onchange=async()=>{
 const input=$('import-file'),file=input.files&&input.files[0];if(!file)return;
 const run=++hostImportRun;hostImport={name:String(file.name||'plik').slice(0,120),text:null,preview:null,error:'',destination:'active',restore:false};hostManageSay('');
 try{
  if(!(file.size<=HOST_IMPORT_BYTES))throw Error('Plik jest za duży na archiwum rozmowy ('+file.size+' bajtów). Nie został odczytany; niczego nie zmieniono.');
  const text=await file.text();if(run!==hostImportRun)return;
  hostImport.text=text;hostImportInspect();
 }catch(e){if(run!==hostImportRun)return;hostImport.error=e&&e.message||'Nie udało się odczytać pliku. Niczego nie zmieniono.';}
 hostRender();
};

// --- New version notice ---------------------------------------------------------------------------------
// The shell worker installs a new version in the background and takes over the open page; the page itself keeps running the code
// it was loaded with. This part only NOTICES that and offers an explicit switch. It never reloads on its own, polls nothing
// (no /api, no login, no timer) and acts on no instruction from a worker: the only thing read from a worker is its version pin,
// asked for over a private MessageChannel, so the answer can only come from the worker that was asked.
//   running  pin of the first worker that controlled this page: the version this page runs
//   offered  set once a different worker took over, or a waiting/activated worker carries a different pin
// A first installation (page loaded without a controller, then claimed) only establishes `running`; it never shows the notice.
var hostUpdate={running:null,offered:null,saving:false,chain:Promise.resolve()};
var HOST_PIN=/^[0-9a-f]{64}$/;
function hostWorkerPin(worker){
 return new Promise(resolve=>{
  let channel,timer=null,done=false;
  const finish=pin=>{if(done)return;done=true;clearTimeout(timer);try{channel.port1.onmessage=null;channel.port1.close();}catch(_){}resolve(pin);};
  try{
   channel=new MessageChannel();timer=setTimeout(()=>finish(null),4000);
   channel.port1.onmessage=e=>{const d=e&&e.data;finish(d&&typeof d==='object'&&!Array.isArray(d)&&Object.keys(d).length===2&&d.type==='empire-shell-version'&&typeof d.pin==='string'&&HOST_PIN.test(d.pin)?d.pin:null);};
   worker.postMessage({type:'empire-shell-version'},[channel.port2]);
  }catch(_){finish(null);}
 });
}
// role: 'baseline' the first controller of this page; 'replaced' a worker that took over from an earlier controller;
// 'candidate' a worker that finished installing or activating while the page was open.
function hostUpdateSeen(worker,role){
 hostUpdate.chain=hostUpdate.chain.then(async()=>{
  const pin=await hostWorkerPin(worker);
  if(role==='baseline'){if(pin&&hostUpdate.running===null)hostUpdate.running=pin;return;}
  if(pin&&pin===hostUpdate.running)return;
  // A candidate is offered only when both versions are known to differ; a worker that replaced the controller is a new version.
  if(role==='candidate'&&(!pin||hostUpdate.running===null))return;
  hostUpdate.offered=pin||'unknown';hostUpdateRender();
 }).catch(()=>{});
}
function hostUpdateRender(){const box=$('update-banner');if(!box)return;box.hidden=!hostUpdate.offered;$('update-reload').disabled=hostUpdate.saving;}
function hostUpdateSay(text,kind){$('update-status').textContent=text;$('update-status').className=kind||'';}
function hostUpdateWatch(){
 const sw=navigator.serviceWorker;if(!sw)return;
 let controlled=!!sw.controller;
 if(sw.controller)hostUpdateSeen(sw.controller,'baseline');
 sw.addEventListener('controllerchange',()=>{const now=sw.controller;if(!now)return;hostUpdateSeen(now,controlled?'replaced':'baseline');controlled=true;});
 const track=worker=>{if(!worker)return;const check=()=>{if(worker.state==='installed'||worker.state==='activated')hostUpdateSeen(worker,'candidate');};worker.addEventListener('statechange',check);check();};
 Promise.resolve(sw.ready).then(reg=>{if(!reg)return;track(reg.waiting);track(reg.installing);reg.addEventListener('updatefound',()=>track(reg.installing));}).catch(()=>{});
}
// The only reload in the shell, and only from this click. First everything this page holds is made durable: the unsent text
// (journal, then the bank) and the open conversation with its host metadata (a reviewed or started write to a job is part of the
// stored conversation). When that cannot be confirmed, or a job form is open, nothing is reloaded and a recovery copy is offered.
$('update-reload').onclick=async()=>{
 if(hostUpdate.saving||!hostUpdate.offered)return;
 if(handoffBusy||busy||audioBusy||recording){hostUpdateSay('Najpierw dokończ bieżącą operację (odpowiedź, nagranie albo zapis do roboty). Niczego nie przerwano i niczego nie przeładowano.','error');return;}
 hostUpdate.saving=true;hostUpdateRender();
 try{
  let form=false;try{form=!!hostApi().hasDraft();}catch(_){}
  if(form)throw Error('W zakładce Roboty jest otwarty, niezapisany formularz. Zapisz go albo odrzuć.');
  if(storageBroken||contextLost||hostExternalStale)throw Error('Ta karta nie może teraz zapisać rozmowy w przeglądarce.');
  journalWrite();
  await hostExclusive(()=>{flushInput();bankSync();const stored=CBank.get(bank,activeContextId);if(!stored||stored.version!==activeVersion||stored.input!==$('input').value)throw Error('Zapis rozmowy nie został potwierdzony.');});
  if(inputUnsaved())throw Error('Niewysłany tekst nie jest jeszcze zapisany w przeglądarce.');
 }catch(e){
  hostUpdate.saving=false;$('update-export').hidden=false;hostUpdateRender();
  hostUpdateSay('Nowa wersja nie została uruchomiona: '+(e&&e.message||'zapis nie powiódł się')+' Strona pozostaje otwarta i niczego nie utracono. Pobierz kopię awaryjną albo usuń przeszkodę i spróbuj ponownie.','error');
  return;
 }
 hostUpdateSay('Szkic i niewysłany tekst są zapisane. Uruchamiam nową wersję…');
 location.reload();
};
$('update-export').onclick=()=>{exportRecovery();hostUpdateSay('Pobrano kopię awaryjną ekranu i zapisów przeglądarki. Niczego nie zmieniono ani nie przeładowano.');};
hostUpdateWatch();
hostRefresh();hostRender();
