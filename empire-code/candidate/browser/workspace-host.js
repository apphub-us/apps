'use strict';
// Same-origin coordinator. No model, credentials, or network is used to save a reviewed draft.
// Conversations live in the per-job bank owned by ui.js (CBank). This file switches the active context and
// persists host metadata through ui.js (bankSync / persist / switchContext); it never writes bank bytes itself.
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
 if(!persist()){workspaceMeta=old;throw Error('Nie zapisano powiązania w przeglądarce'+(persistError?' ('+persistError+')':'')+'. Materiały nie zostały wysłane do zapisu.');}
 return true;
}
function hostEnsure(){if(!workspaceMeta){if(!persist())throw Error('Nie można utrwalić identyfikatora szkicu.');}return workspaceMeta;}
function hostPending(){return JHSession.pending(workspaceMeta);}
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
 hostRender();
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
 hostSelectors();
 panel.append(node('h3','Zapis do roboty'));
 const stamp=activeContextId+':'+(workspaceMeta?workspaceMeta.sourceId+':'+workspaceMeta.sourceRevision+':'+(workspaceMeta.targetJobId||''):'');
 if(stamp!==hostSelectionStamp){hostSelected.clear();hostAcks.clear();hostSelectionStamp=stamp;hostDefaultSelection();}
 hostRenderRecovery(panel,locked);
 if(hostExternalStale){panel.append(node('p','Ta rozmowa zmieniła się w innej karcie. Nie używaj starego podsumowania.','handoff-warning'));const sync=hostButton('Wczytaj aktualny szkic','handoff-resync',hostResync);sync.disabled=handoffBusy;panel.append(sync);return;}
 if(storageBroken){panel.append(node('p','Zapis przeglądarki wymaga sprawdzenia. Niczego nie nadpisano.','handoff-warning'));return;}
 if(bankBooting){panel.append(node('p','Wczytuję zapisane rozmowy…','handoff-help'));return;}
 if(!hostReady){panel.append(node('p','Wczytuję lokalne roboty…','handoff-help'));return;}
 if(workspaceMeta?.materialEdit){hostRenderMaterialEdit(panel,locked);return;}
 const prepared=workspaceMeta?.prepared;
 if(prepared){
  const p=prepared.handoff.plan,summary=node('div',undefined,'handoff-summary');
  summary.append(node('strong',p.title));
  for(const a of p.actions)summary.append(node('p',a.fields.quantityText+' '+a.fields.unit+' — '+a.fields.label+(a.fields.specification?' · '+a.fields.specification:'')));
  const left=prepared.handoff.excludedItemIds.length;if(left)summary.append(node('p',left+' poz. pozostaje w szkicu — nie będą usunięte.','handoff-help'));
  panel.append(summary,node('p',prepared.phase==='pending'?'Zapis rozpoczęto. Część wpisów mogła już powstać. Wznowienie sprawdzi ich identyfikatory i nie powieli ich.':'Sprawdź robotę, ilości i specyfikacje. Ten zapis nie zatwierdza zgodności instalacji.','handoff-help'));
  const row=node('div',undefined,'handoff-actions');const save=hostButton(prepared.phase==='pending'?'Wznów zapis':'Potwierdź zapis do roboty','handoff-confirm',hostCommit,'primary');save.disabled=locked;row.append(save);
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
  if(receipt){hostSavedMaterial(panel,item,receipt,locked);continue;}
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
 const preview=hostButton('Przejrzyj zapis','handoff-prepare',hostPrepare,'primary');preview.disabled=locked||!hostSelected.size;row.append(preview);if(available>0)panel.append(row);
 const open=hostButton('Otwórz materiały roboty','handoff-open-job',()=>hostNavigate('jobs'));open.disabled=locked;panel.append(open);
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
 if(handoffBusy||busy||audioBusy||recording||!workspaceMeta?.prepared||storageBroken||bankBooting)return;handoffBusy=true;let materialCommitted=false;controls();hostRender();
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
 hostView=view;$('conversation-panel').hidden=view!=='talk';$('core-panel').hidden=view==='talk';for(const n of ['talk','jobs','tools','code'])$('nav-'+n).setAttribute('aria-current',n===view?'page':'false');if(view==='talk')await hostRefresh();return true;
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
 }catch(e){hostMessage(e.message);}
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
 }catch(e){hostMessage(e.message);}
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

// --- Other tabs -----------------------------------------------------------------------------------------
// Reloads the ACTIVE conversation after another tab changed it. Local unsent text is kept in the field when the other tab
// did not touch the text. When both tabs changed the text, the stored text is shown and this tab's text is offered for
// explicit recovery; it is never written over the other tab's text automatically.
async function hostResync(){
 if(handoffBusy||busy||audioBusy||recording||bankBooting||storageBroken)return;
 try{
  let note='Wczytano aktualną rozmowę z drugiej karty.';
  await hostExclusive(()=>{
   const raw=localStorage.getItem(KEY);if(raw===null)throw Error('Zapis został usunięty w innej karcie. Zachowano dane na ekranie; wyeksportuj szkic.');
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
hostRefresh();hostRender();
