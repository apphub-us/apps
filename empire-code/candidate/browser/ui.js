'use strict';
// Conversation UI. All persistence goes through CBank under one versioned key (KEY).
// The legacy single-draft key is read once for migration and is never written or removed.
const $=id=>document.getElementById(id),KEY=CBank.KEY,LEGACY_KEY=CBank.LEGACY_KEY,ACTIVE_KEY='empire_code_active_context_v1',copy=v=>JSON.parse(JSON.stringify(v));
const blank=()=>({version:1,revision:0,nextId:1,items:[],history:[]});
let workspaceMeta=null,storageBroken=false,persistError='',persistCode='',inputSaving=false;
// Assistant data of the open conversation: the optional `assistant` member of its stored envelope (ASession), or null. It holds
// the active calculator draft (input only), a note / measurement proposal under review, a started job action and its receipts.
// assistEpoch counts every local change of what a request is based on besides the material state (the calculator draft, the
// proposal, the open conversation). It is part of the context token of a request, so an answer to a request that was sent
// before such a change is refused even when the change was reverted and every fingerprint is equal again.
// assistShown is the result computed HERE for the stored draft (never stored); assistNav a navigation-only answer (not stored).
let assistantMeta=null,assistEpoch=0,assistShown=null,assistNav=null,assistChanged=[];
const ASSIST_NONCE=Array.from(crypto.getRandomValues(new Uint8Array(6)),x=>x.toString(16).padStart(2,'0')).join('');
// A started write to the job — materials (JHSession) or a note / measurement (ASession) — freezes the conversation until it is reconciled.
function writePending(){return JHSession.pending(workspaceMeta)||ASession.pending(assistantMeta);}
// contextLost: why the stored bank no longer holds the open conversation as an active one ('' = it does). Set when another tab
// archived or deleted it, removed the bank, or a newer application rewrote the bank. Such a tab never writes the bank again;
// its screen can only be exported as a raw recovery copy. recoveryExported: such a copy was downloaded since then.
let contextLost='',recoveryExported=false;
const LOST={retired:'Ta rozmowa została usunięta w innej karcie.',archived:'Ta rozmowa została przeniesiona do archiwum w innej karcie.',missing:'Tej rozmowy nie ma już w zapisie przeglądarki.',version:'Nowsza wersja aplikacji zmieniła układ zapisanych rozmów; zamknij tę kartę albo odśwież stronę po pobraniu kopii.'};
const LOST_HELP=' Ta karta niczego już nie zapisze ani nie nadpisze. Zawartość ekranu i niewysłany tekst pozostają tutaj — „Eksportuj szkic” pobierze ich kopię awaryjną.';
let state=blank(),undo=[],diffs=[],token=null,busy=false,seq=0,controller=null,storageVersion=null;
// Voice capture: `audioSession` is the one current capture and owns its stream, recorder, stop timer, chunks and abort
// controller (see "Voice capture" below). `recording`/`audioBusy` are the screen flags of that current session only.
let audioSession=null,recording=false,audioBusy=false,audioSeq=0;
// Bank bookkeeping of this tab. `bank` is the last stored snapshot this tab has seen; `storageVersion` is its exact bytes.
// The active context is per tab (sessionStorage); it is never forced onto other tabs.
let bank=CBank.empty(),activeContextId=null,activeVersion=0,contextGeneration=0,inputSaved='',inputTimer=null,bankBooting=false;
// Unsent-text journal (DraftRecovery): one localStorage key per (conversation, loaded document). It is written synchronously
// on every change of the field, before the asynchronous bank save, and its exact bytes are removed only after the bank commit
// holding that text was read back. `journal` is this document's handle {key,raw,text,contextId}; the document id is new on every load.
const DOC_LOCK='empire-code-document-v1:';
let documentId=null,journal=null,journalError='',legacyNotice='',recovery={contextId:null,items:[],problems:0,truncated:false},recoveryVolatile=[],recoveryRun=0;
try{documentId=DraftRecovery.createDocumentId(crypto);}catch(e){journalError='Kopia awaryjna niewysłanego tekstu jest niedostępna ('+(e&&e.code||'błąd')+').';}
// Held for the life of this document, so other tabs can tell that its journal record is not abandoned.
if(documentId&&navigator.locks)navigator.locks.request(DOC_LOCK+documentId,{mode:'exclusive'},()=>new Promise(()=>{})).catch(()=>{});
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(cls)el.className=cls;return el;}
function status(text,kind=''){$('status').textContent=text;$('status').className=kind;}
// --- Visible limits (EC-07) ---------------------------------------------------------------------
// Informative only: the server stays the authority and refuses on its own. Facts used, all from the server contract:
//  - GET /api/session answers `remainingRequests` (attempts left today) together with a real token. It carries no reset time, so
//    no time is shown or counted down here. Every attempt the server accepts is counted once, whatever its result: a typed
//    message needs one attempt, a spoken one needs two (the transcription, then the model).
//  - the model endpoint refuses a conversation that already holds HISTORY_MAX messages (18 complete exchanges).
// budgetLeft: null = not known (no session, or the server sent no usable number); an unknown budget blocks nothing.
// budgetDoubt: attempts of this tab since the last reading whose counting could not be told (lost answer, cancel, provider error).
const HISTORY_MAX=36,VOICE_REQUESTS=2;
let budgetLeft=null,budgetDoubt=0;
// saveFailed: why the last save of the unsent text was refused; '' once a save went through. Drives the visible retry button.
let saveFailed='';
const HISTORY_FULL='Ta rozmowa osiągnęła limit '+HISTORY_MAX/2+' wymian ('+HISTORY_MAX+' wiadomości). Niczego nie wysłano ani nie nagrano; tekst pozostaje w polu. Wyeksportuj szkic i użyj „Nowa rozmowa” — ta rozmowa pozostaje zapisana.';
const BUDGET_EMPTY='Dzienny limit zapytań pilotażu jest wyczerpany (serwer podał 0 pozostałych). Wyślij i Mów są wyłączone; tekst pozostaje w polu, a szkic, eksport, lokalne Roboty i narzędzia działają dalej. Limit liczy serwer na dobę UTC; ta strona nie zna chwili jego odnowienia — „Sprawdź limit” odczyta aktualny stan.';
const budgetVoice=()=>'Wypowiedź głosowa wymaga '+VOICE_REQUESTS+' zapytań (transkrypcja, potem odpowiedź modelu), a pewne jest najwyżej '+Math.max(0,budgetLeft-budgetDoubt)+'. Mów jest wyłączone, aby nie zużyć ostatniego zapytania na transkrypcję, której model już nie zinterpretuje. Wiadomość pisaną nadal można wysłać (1 zapytanie).';
const historyFull=()=>state.history.length>=HISTORY_MAX;
// '' = as far as the visible limits go, a typed message may be sent.
function sendBlock(){return historyFull()?HISTORY_FULL:budgetLeft===0?BUDGET_EMPTY:'';}
// '' = a recording may start (and its transcription may be dispatched).
function voiceBlock(){return sendBlock()||(budgetLeft!==null&&budgetLeft-budgetDoubt<VOICE_REQUESTS?budgetVoice():'');}
// What one answered request says about the counter. Refusals issued before the server reserves an attempt are not counted.
const BUDGET_FREE=/^(?:SESSION_TOKEN|DUPLICATE_REQUEST|BUSY|AI_NOT_CONFIGURED|HISTORY_LIMIT|CONTEXT_LIMIT)$/;
function budgetOutcome(r,result){
 if(r.ok)return 'counted';
 const code=typeof result.code==='string'?result.code:'';
 return code==='DAILY_LIMIT'?'cap':BUDGET_FREE.test(code)?'refused':'unknown';
}
// 'cap' is the server itself reporting the daily limit. Without a number from the server nothing is counted or guessed.
function budgetNote(outcome){
 if(outcome==='cap'){budgetLeft=0;budgetDoubt=0;}
 else if(budgetLeft!==null&&outcome==='counted')budgetLeft=Math.max(0,budgetLeft-1);
 else if(budgetLeft!==null&&outcome==='unknown')budgetDoubt++;
 budgetDoubt=Math.min(budgetDoubt,budgetLeft||0);controls();
}
function limitsShow(occupied){
 const out=[],used=Math.ceil(state.history.length/2),voice=voiceBlock();
 if(historyFull())out.push(HISTORY_FULL);else if(used)out.push('Wymiany w tej rozmowie: '+used+' z '+HISTORY_MAX/2+'.');
 if(token){
  if(budgetLeft===null)out.push('Serwer nie podał liczby pozostałych zapytań; limit sprawdza serwer przy wysyłaniu.');
  else if(budgetLeft===0)out.push(BUDGET_EMPTY);
  else{
   out.push('Pozostałe zapytania pilotażu: '+budgetLeft+' (wiadomość pisana = 1, wypowiedź głosowa = '+VOICE_REQUESTS+').'+(budgetDoubt?' Nieudana lub przerwana operacja mogła zostać policzona przez serwer — może być o '+budgetDoubt+' mniej.':''));
   if(!historyFull()&&voice)out.push(voice);
  }
 }
 const line=$('limits'),again=$('limits-refresh'),clock=$('rec-time'),retry=$('save-retry');
 line.textContent=out.join(' ');line.hidden=!out.length;line.className='limits'+(token&&voice||historyFull()?' warn':'');
 again.hidden=!(token&&budgetLeft!==null&&(budgetLeft-budgetDoubt<VOICE_REQUESTS||budgetDoubt>0));again.disabled=occupied||!navigator.onLine;
 clock.hidden=!recording;if(!recording)clock.textContent='';
 retry.hidden=!saveFailed||storageBroken||bankBooting||!!contextLost||$('input').value===inputSaved;retry.disabled=inputSaving;
}
function controls(){
 const occupied=busy||audioBusy||recording;
 const handoffLocked=!!(typeof hostExternalStale!=='undefined'&&hostExternalStale)||storageBroken||bankBooting||!!(typeof handoffBusy!=='undefined'&&handoffBusy)||writePending();
 // The Stop button of a running recording is never disabled by a limit; only starting a new recording is.
 $('send').disabled=occupied||handoffLocked||!token||!navigator.onLine||!!sendBlock();$('input').disabled=occupied||bankBooting;$('mic').disabled=busy||audioBusy||handoffLocked||!token||!navigator.onLine||(!recording&&!!voiceBlock());
 $('mic').textContent=recording?'Stop':audioBusy?'Przygotowanie…':'Mów';$('cancel').hidden=!occupied;$('undo').disabled=occupied||handoffLocked||!undo.length;$('new').disabled=occupied||handoffLocked;
 $('copy').disabled=!state.items.length;exportControl();limitsShow(occupied);assistRender();if(typeof hostRender==='function')hostRender();
}
// True when this tab can no longer vouch for the stored conversation: export then means a raw recovery copy of the screen.
function exportStale(){return storageBroken||!!contextLost||!!(typeof hostExternalStale!=='undefined'&&hostExternalStale);}
// Export is available for anything worth keeping — a draft, a history, receipts or only unsent text — and always for recovery.
function exportControl(){$('export').disabled=contextBlank()&&!exportStale();}
function hostExclusive(fn){if(!navigator.locks)return Promise.reject(Error('Brak wymaganej blokady zapisu.'));return navigator.locks.request('empire-code-conversation-host-v1',{mode:'exclusive'},fn);}

// --- Bank access -----------------------------------------------------------------------------
// True when the stored bank differs from this tab's snapshot only in OTHER contexts; the snapshot is then adopted.
function adoptForeign(raw){
 try{
  if(storageBroken||raw===null)return false;
  const fresh=CBank.parse(raw);
  if(JSON.stringify(CBank.get(fresh,activeContextId))!==JSON.stringify(CBank.get(bank,activeContextId)))return false;
  bank=fresh;storageVersion=raw;return true;
 }catch{return false;}
}
// Why the stored bytes no longer hold the open conversation as an active one; '' when they do, or when they cannot be judged.
function lostReason(raw){
 if(raw===null)return 'missing';
 try{const held=CBank.where(CBank.parse(raw),activeContextId);return !held?'missing':held.state==='active'?'':held.state;}
 catch(e){return e&&e.code==='UNSUPPORTED'?'version':'';}
}
// Throws unless the active context is still exactly what this tab last read or wrote.
function bankSync(){
 if(storageBroken)throw Error('Zapis przeglądarki wymaga sprawdzenia. Niczego nie nadpisano.');
 const raw=localStorage.getItem(KEY);
 if(raw===storageVersion||adoptForeign(raw))return;
 contextLost=lostReason(raw);
 throw Object.assign(Error(contextLost?LOST[contextLost]+LOST_HELP:'Szkic zmienił się w innej karcie. Nie nadpisano danych.'),{code:contextLost?'LOST':'CHANGED'});
}
// Single write path: re-read, compare-and-set the active entry only, verify bytes. Throws without changing memory.
function writeEntry(envelope,input){
 bankSync();
 const result=CBank.commit(bank,{contextId:activeContextId,baseVersion:activeVersion,input,envelope,now:new Date().toISOString()});
 const raw=CBank.store(localStorage,KEY,result.bank,storageVersion);
 bank=result.bank;storageVersion=raw;activeVersion=result.entry.version;inputSaved=input;saveFailed='';
 try{sessionStorage.setItem(ACTIVE_KEY,activeContextId);}catch{}
 journalConfirm(input);
}
// A write whose read-back differed (UNCONFIRMED) is never repeated or rolled back from memory: what the browser really holds is
// unknown here. The host then offers „Wczytaj aktualny szkic”, which reads the stored bytes and keeps the local unsent text.
function saveDiverged(e){if(e&&e.code==='UNCONFIRMED'&&typeof hostExternalStale!=='undefined')hostExternalStale=true;}
// The envelope of the open conversation as it is stored. The assistant member is written only when it holds something, so a
// conversation that never used it keeps exactly the earlier layout. It is validated against the conversation's identity and job
// on every write of this application; a refusal throws before anything is stored.
function envelopeOf(workspace){
 const envelope={state,undo:undo.slice(-8),diffs,workspace};
 if(!ASession.blank(assistantMeta))envelope.assistant=ASession.validate(assistantMeta,ASession.contextOf(workspace));
 return envelope;
}
// Saves the screen state, host metadata and the unsent text of the active context. Returns false and changes nothing on failure.
function persist(){
 try{const next=JHSession.bind(workspaceMeta,state,crypto,new Date().toISOString());writeEntry(envelopeOf(next),$('input').value);workspaceMeta=next;return true;}
 catch(e){persistError=e&&e.message||'';persistCode=e&&e.code||'';saveDiverged(e);status('Brak zapisu w przeglądarce. '+persistError+' Nie zamykaj strony; wyeksportuj szkic.','error');return false;}
}
// A refused write that is a capacity limit leads straight to the place where room can be made; the reason stays visible there.
function limitHelp(e){if(e&&e.code==='LIMIT'&&typeof hostManageOpen==='function')hostManageOpen(e.message);}
function snapshotContext(){return {state:copy(state),undo:copy(undo),diffs:copy(diffs),workspaceMeta:workspaceMeta?copy(workspaceMeta):null,assistantMeta:assistantMeta?copy(assistantMeta):null,activeContextId,activeVersion,inputSaved,input:$('input').value};}
function restoreContext(s){state=s.state;undo=s.undo;diffs=s.diffs;workspaceMeta=s.workspaceMeta;assistantMeta=s.assistantMeta;activeContextId=s.activeContextId;activeVersion=s.activeVersion;inputSaved=s.inputSaved;$('input').value=s.input;}
// Mutate + persist as one step; state, undo, diffs, metadata and the input field are rolled back when the write fails.
function applyChange(mutate){const snap=snapshotContext();try{mutate();}catch(e){restoreContext(snap);throw e;}if(persist())return true;restoreContext(snap);return false;}
function contextBlank(){return !state.history.length&&!state.items.length&&!$('input').value&&!(workspaceMeta&&workspaceMeta.receipts.length)&&ASession.blank(assistantMeta);}

// --- Unsent text -----------------------------------------------------------------------------
// Call inside the lock. Stores the textarea content for the active context; throws (text stays in the field) on failure.
function flushInput(){
 clearTimeout(inputTimer);inputTimer=null;const text=$('input').value;
 if(text===inputSaved){saveFailed='';if(journal){try{bankSync();journalConfirm(text);}catch{}}return;}
 // The refusal is remembered (saveFailed) for the visible retry; the field itself is never touched here.
 try{
  bankSync();const stored=CBank.get(bank,activeContextId);
  writeEntry(stored?stored.envelope:envelopeOf(workspaceMeta),text);
 }catch(e){saveFailed=e&&e.message||'błąd';saveDiverged(e);throw e;}
}
// Saves immediately (no debounce), always under the lock. One request runs at a time; the text is read when the lock is
// granted, and anything typed meanwhile triggers one more run. A failed save is not retried in a loop: the text stays in
// the field, the next keystroke/blur tries again, and leaving the page asks first (beforeunload below).
async function saveInputNow(){
 clearTimeout(inputTimer);inputTimer=null;
 if(storageBroken||bankBooting||inputSaving||($('input').value===inputSaved&&!journal))return;
 inputSaving=true;let failed=false;const context=activeContextId;
 try{await hostExclusive(()=>{if(context===activeContextId)flushInput();});}
 catch(e){failed=true;if(!saveFailed)saveFailed=e&&e.message||'błąd';status('Nie zapisano niewysłanego tekstu: '+e.message+' Tekst pozostaje w polu — po usunięciu przeszkody użyj „Zapisz tekst ponownie” albo wyeksportuj szkic.','error');}
 finally{inputSaving=false;}
 // The retry button follows the outcome; the host panel is redrawn too when the tab lost its conversation or must re-read it.
 if(failed&&(contextLost||(typeof hostExternalStale!=='undefined'&&hostExternalStale)))controls();else limitsShow(busy||audioBusy||recording);
 if(!failed&&$('input').value!==inputSaved)scheduleInputSave();
}
function scheduleInputSave(delay=0){clearTimeout(inputTimer);inputTimer=setTimeout(saveInputNow,delay);}
// Visible retry of a refused save: the same save path, on the text that is in the field now. Nothing is retyped and nothing is sent.
$('save-retry').onclick=async()=>{
 if(inputSaving||storageBroken||bankBooting)return;
 journalWrite();await saveInputNow();
 // Also when there was nothing left to save (the field was edited back to the stored text): the refusal is over.
 if($('input').value===inputSaved)saveFailed='';
 limitsShow(busy||audioBusy||recording);
 if(!saveFailed&&$('input').value===inputSaved)status('Niewysłany tekst jest zapisany w przeglądarce. Niczego nie wysłano.');
};
// Durable = confirmed in the bank, or held byte-for-byte in this document's journal record. Anything else asks before leaving.
function inputDurable(){
 const text=$('input').value;if(text===inputSaved)return true;
 try{return !!journal&&journal.contextId===activeContextId&&journal.text===text&&localStorage.getItem(journal.key)===journal.raw;}catch{return false;}
}
function inputUnsaved(){return !inputDurable()||recoveryVolatile.length>0;}

// --- Unsent-text journal ----------------------------------------------------------------------
function journalFail(e){journalError='Kopia awaryjna niewysłanego tekstu nie została zapisana ('+(e&&(e.code||e.message)||'błąd')+'). Nie zamykaj strony, dopóki tekst nie zostanie zapisany lub wysłany.';status(journalError,'error');}
// Stores a record under a fresh document id that no open document owns; it is then offered for explicit recovery in its own conversation.
function journalCopy(r){DraftRecovery.write(localStorage,{contextId:r.contextId,documentId:DraftRecovery.createDocumentId(crypto),baseVersion:r.baseVersion,text:r.text,savedAt:r.savedAt});}
// Synchronous. Writes ONLY this document's key for the active conversation; never the bank. False = this text is not journaled.
function journalWrite(){
 const text=$('input').value;
 if(storageBroken||bankBooting||!documentId||!activeContextId||!CBank.get(bank,activeContextId))return false;
 if(journal&&journal.contextId!==activeContextId)journal=null;
 try{
  const key=DraftRecovery.keyFor(activeContextId,documentId),held=localStorage.getItem(key);
  // Bytes under this document's key that it holds no handle for are never overwritten: they are copied aside first.
  if(held!==null&&!(journal&&journal.raw===held)){journalCopy(JSON.parse(held));journal=null;}
  if(!journal&&held===null&&text===inputSaved)return true;
  const written=DraftRecovery.write(localStorage,{contextId:activeContextId,documentId,baseVersion:activeVersion,text,savedAt:new Date().toISOString()});
  journal={key:written.key,raw:written.raw,text,contextId:activeContextId};
  if(journalError){journalError='';if(typeof hostRender==='function')hostRender();}
  return true;
 }catch(e){journalFail(e);return false;}
}
// Call after the bank bytes holding `text` were read back. Removes only this document's own record, and only its exact bytes.
function journalConfirm(text){
 if(!journal||journal.contextId!==activeContextId||journal.text!==text)return;
 const stored=CBank.get(bank,activeContextId);if(!stored||stored.input!==text)return;
 try{DraftRecovery.clearExact(localStorage,journal.key,journal.raw);journal=null;}catch(e){journalFail(e);}
}
function releaseBusy(){if(!busy&&!controller)return;controller?.abort();controller=null;busy=false;document.querySelector('.pending')?.remove();}
function recoveryReset(){recovery={contextId:null,items:[],problems:0,truncated:false};setTimeout(recoveryRefresh,0);}
// Recovery candidates of the ACTIVE conversation only: journal records of closed documents plus texts that could not be journaled.
function recoveryItems(){return (recovery.contextId===activeContextId?recovery.items:[]).concat(recoveryVolatile.filter(v=>v.contextId===activeContextId));}
// Keeps a text that lost to another tab's text, for its own conversation, across reloads and switches. Never applied automatically:
// baseVersion is the version this tab had BEFORE the other tab's write, so it can never match the stored entry again.
function recoveryPark(contextId,text,baseVersion){
 try{journalCopy({contextId,baseVersion,text,savedAt:new Date().toISOString()});}
 catch(e){recoveryVolatile.push({contextId,text,records:[],removable:true,volatile:true});journalFail(e);return false;}
 try{if(journal&&journal.contextId===contextId&&journal.text===text){DraftRecovery.clearExact(localStorage,journal.key,journal.raw);journal=null;}}catch(e){journalFail(e);}
 return true;
}
// Explicit removal. Records that may belong to a still-open document (removable=false) are never removed.
function recoveryForget(item){
 if(item.volatile){recoveryVolatile=recoveryVolatile.filter(v=>v!==item);return true;}
 if(!item.removable)return false;
 for(const r of item.records)DraftRecovery.clearExact(localStorage,r.key,r.raw);
 recovery.items=recovery.items.filter(i=>i!==item);return true;
}
function recoveryDiscard(item){
 try{return recoveryForget(item)?'Usunięto kopię niewysłanego tekstu.':'Nie usunięto: ten tekst może należeć do otwartej karty.';}catch(e){journalFail(e);return journalError;}
}
// Explicit recovery: appends the chosen text to the field, saves under the lock, and only then removes the chosen records.
async function recoveryAccept(item){
 if(storageBroken||bankBooting||busy||audioBusy||recording||item.contextId!==activeContextId)return 'Najpierw dokończ bieżącą operację.';
 const field=$('input'),joined=field.value?field.value+'\n'+item.text:item.text;
 if(joined.length>3000)return 'Połączony tekst przekracza 3000 znaków. Niczego nie zmieniono — skróć pole albo skopiuj tekst ręcznie.';
 field.value=joined;journalWrite();
 try{
  let note='';
  await hostExclusive(()=>{
   if(item.contextId!==activeContextId)throw Error('Rozmowa zmieniła się. Kopia tekstu pozostaje przy swojej rozmowie.');
   flushInput();bankSync();const stored=CBank.get(bank,item.contextId);
   if(!stored||!stored.input.includes(item.text))throw Error('Tekst dopisano do pola, ale zapis nie został potwierdzony. Kopia pozostaje.');
   note=recoveryForget(item)?'Dopisano do pola i zapisano. Niczego nie wysłano.':'Dopisano do pola i zapisano. Kopii nie usunięto — może należeć do otwartej karty.';
  });
  return note;
 }catch(e){return e.message;}
}
// Reads the journal of the active conversation. Records of open documents are left alone. A record of a closed document whose
// text is already the stored text (or empty) is removed. Exactly one remaining text written against the stored version is
// restored to the field and saved (never sent); anything else is listed for an explicit choice.
async function recoveryRefresh(){
 if(storageBroken||bankBooting||!activeContextId)return;
 const run=++recoveryRun,context=activeContextId;
 try{
  // Only keys seen BEFORE the liveness query are judged, so a document that started after the query is never taken for closed.
  const first=new Set(DraftRecovery.list(localStorage,context).records.map(r=>r.key));
  let live=null;
  try{const q=await navigator.locks.query();live=new Set((q.held||[]).concat(q.pending||[]).map(l=>l.name));}catch{}
  if(run!==recoveryRun||context!==activeContextId)return;
  await hostExclusive(()=>{
   if(run!==recoveryRun||context!==activeContextId||storageBroken)return;
   try{bankSync();}catch{return;}
   const entry=CBank.get(bank,context);if(!entry)return;
   const now=DraftRecovery.list(localStorage,context),groups=new Map();
   for(const r of now.records){
    const text=r.record.text;if(r.record.documentId===documentId||!first.has(r.key))continue;
    const alive=live?live.has(DOC_LOCK+r.record.documentId):null;
    if(alive===true)continue;
    if(text===entry.input){if(alive===false)DraftRecovery.clearExact(localStorage,r.key,r.raw);continue;}
    if(text===$('input').value)continue;
    const g=groups.get(text)||{contextId:context,text,records:[],removable:true,same:false,savedAt:r.record.savedAt};
    g.records.push({key:r.key,raw:r.raw});if(alive!==false)g.removable=false;if(r.record.baseVersion===entry.version)g.same=true;groups.set(text,g);
   }
   let items=[...groups.values()];
   const idle=!busy&&!audioBusy&&!recording&&!(typeof handoffBusy!=='undefined'&&handoffBusy)&&!journal&&$('input').value===inputSaved&&!recoveryVolatile.some(v=>v.contextId===context);
   if(items.length===1&&items[0].same&&items[0].removable&&idle){
    const only=items[0];$('input').value=only.text;journalWrite();
    try{flushInput();}catch(e){status('Przywrócono niewysłany tekst do pola, ale nie zapisano go w rozmowie: '+e.message,'error');}
    if(inputSaved===only.text){for(const r of only.records)DraftRecovery.clearExact(localStorage,r.key,r.raw);status('Przywrócono niewysłany tekst sprzed przerwanego zapisu. Niczego nie wysłano.');}
    items=[];
   }
   recovery={contextId:context,items,problems:now.problems.filter(p=>p.key!==null).length,truncated:now.truncated};
  });
 }catch(e){journalFail(e);}
 controls();
}

// --- Context switching (call inside the lock) -------------------------------------------------
// Validates first, then replaces the screen state; nothing is written. Local unsaved typing can be kept on resync.
function activateEntry(entry,options={}){
 const env=entry.envelope;if(!safeState(env.state))throw Error('Zapisana rozmowa ma nieprawidłowy szkic. Niczego nie nadpisano.');
 const meta=env.workspace?JHSession.validate(env.workspace):null;
 if(meta&&meta.boundState!==JSON.stringify(env.state))throw Error('Powiązanie szkicu wymaga sprawdzenia. Niczego nie nadpisano.');
 // Assistant data written by this application or accepted from a file: the same strict validator, tied to this conversation.
 const helper=Object.hasOwn(env,'assistant')?ASession.validate(env.assistant,ASession.contextOf(meta)):null;
 const keep=!!options.keepInput&&$('input').value!==inputSaved;
 assistantMeta=helper;assistEpoch++;assistShown=null;assistNav=null;assistChanged=[];assistLink=null;assistNote='';
 state=copy(env.state);workspaceMeta=meta;undo=Array.isArray(env.undo)?copy(env.undo.filter(safeState).slice(-8)):[];diffs=Array.isArray(env.diffs)?copy(env.diffs):[];
 activeContextId=entry.contextId;activeVersion=entry.version;inputSaved=entry.input;contextLost='';recoveryExported=false;
 if(journal&&journal.contextId!==activeContextId)journal=null;
 if(keep){journalWrite();scheduleInputSave(0);}else $('input').value=entry.input;
 // A context change never leaves a request of the previous context running or the UI marked busy.
 if(audioSession)cancelAudio();contextGeneration++;++seq;releaseBusy();recoveryReset();try{sessionStorage.setItem(ACTIVE_KEY,activeContextId);}catch{}
}
function switchContext(contextId){
 flushInput();bankSync();const entry=CBank.get(bank,contextId);
 if(!entry)throw Error('Tej rozmowy nie ma już w zapisie. Bieżąca pozostaje otwarta.');
 activateEntry(entry);
}
// Creates and saves an empty conversation for jobId (null = unassigned). The previous one stays in the bank.
function openNewContext(jobId){
 const snap=snapshotContext();
 try{
  state=blank();undo=[];diffs=[];assistantMeta=null;$('input').value='';inputSaved='';activeContextId=CBank.newId(crypto);activeVersion=0;
  workspaceMeta=jobId?JHSession.target(JHSession.bind(null,state,crypto,new Date().toISOString()),jobId):null;
  // The reason of the refusal (limit, quota, another tab) is the message; it is never replaced by a generic one.
  if(!persist())throw Object.assign(Error((persistError||'Przeglądarka odmówiła zapisu; nowa rozmowa nie powstała.')+' Poprzednia rozmowa pozostaje otwarta razem z niewysłanym tekstem.'),{code:persistCode});
 }catch(e){restoreContext(snap);throw e;}
 contextLost='';recoveryExported=false;
 if(journal&&journal.contextId!==activeContextId)journal=null;
 assistEpoch++;assistShown=null;assistNav=null;assistChanged=[];assistLink=null;assistNote='';
 if(audioSession)cancelAudio();contextGeneration++;++seq;releaseBusy();recoveryReset();
}

function safeState(s){return s&&s.version===1&&Array.isArray(s.items)&&s.items.length<=16&&Array.isArray(s.history)&&s.history.length<=40&&s.history.every(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string')&&s.items.every(i=>typeof i.id==='string'&&typeof i.name==='string'&&Array.isArray(i.review));}
function render(){
 $('count').textContent=state.items.length;const messages=$('messages');
 if(state.history.length){messages.replaceChildren();for(const m of state.history){const box=node('div',undefined,'message '+m.role);box.append(node('span',m.role==='user'?'TY':'EMPIRE · ONLINE','role'),node('div',m.content));messages.append(box);}}
 else{messages.replaceChildren();const w=node('div',undefined,'welcome');w.append(node('h2','Jedna rozmowa. Jedna lista.'),node('p','Opisz materiały po swojemu, zapytaj o obliczenie albo podyktuj notatkę lub pomiar do wybranej roboty. Potem dopowiadaj i poprawiaj bez powtarzania całości.'));const e=node('button','Wstaw przykładową wypowiedź','example');e.id='example';e.type='button';e.onclick=example;w.append(e);messages.append(w);}
 const items=$('items');items.replaceChildren();if(!state.items.length)items.append(node('p','Tutaj pojawią się pozycje z rozmowy.','empty'));
 for(const item of state.items){const card=node('article',undefined,'item');card.dataset.itemId=item.id;const top=node('div',undefined,'item-main');top.append(node('span',item.name,'item-name'),node('span',item.quantity===null?'ilość ?':item.quantity+' '+(item.unit||'?'),'item-qty'));card.append(top);if(item.specification)card.append(node('p',item.specification,'spec'));if(item.notes)card.append(node('p',item.notes,'notes'));for(const r of item.review)card.append(node('p',r,'review'));
  const change=diffs.find(d=>d.after?.id===item.id);if(change){let text=change.op==='add'?'Nowa propozycja':change.before.quantity!==item.quantity?'Zmieniono ilość: '+(change.before.quantity??'?')+' → '+(item.quantity??'?'):'Zaktualizowano opis';card.append(node('p',text,'changed'));}items.append(card);}
 messages.scrollTop=messages.scrollHeight;controls();
}
function example(){if(busy||audioBusy||recording)return;$('input').value='Dodaj dwa breakery 20 amp firmy Zimens, dwa kable trzy zero czerwony i czarny, jakieś 50 fit, 15 bushingów plastikowych i dwa metalowe.';journalWrite();scheduleInputSave(0);exportControl();$('input').focus();status('To tylko przykład w polu wiadomości. Naciśnij Wyślij, aby zapytać rzeczywisty model.');}
// --- Assistant: calculators in the conversation -------------------------------------------------
// The conversation keeps ONE calculator draft: tool id, stated input and where each value came from. Every result on the screen
// is computed here, by the registry of the local tools frame (window.EC.conversationTools → the canonical engines), from that
// stored input: after an answer, after a reload, offline, with or without the AI. A result that arrives in an answer is only
// compared with the local one and is discarded when it differs; no number is shown that the local engine did not produce.
const ASSIST_STATUS={complete:'policzono',partial:'wynik częściowy',preliminary:'wynik wstępny',needs_input:'brakuje danych',invalid_input:'narzędzie odrzuciło dane',unsupported:'poza zakresem narzędzia',blocked:'obliczenie zablokowane',navigation_only:'tylko w zakładce Narzędzia',error:'błąd obliczenia'};
const ASSIST_NOT_READY='Lokalne narzędzia jeszcze się wczytują albo ta wersja nie zawiera kalkulatorów rozmowy. Wynik pojawi się po ich wczytaniu; bez lokalnego przeliczenia nie pokazano żadnej liczby.';
const ASSIST_REFUSED='Zapisane dane tego kalkulatora nie przechodzą walidacji narzędzia, więc niczego nie policzono. Usuń kalkulator z rozmowy albo pobierz wartości z formularza ponownie.';
// assistLink: the open form this conversation's draft was taken from ({context,tool,generation,bridge} of
// ECAssistantBridge.capture; `bridge` is the bridge object of that frame document). Corrections made in the conversation are
// written back to exactly that form while its generation is unchanged; never stored. A message sent while the link exists is
// tied to it: its answer is accepted only while the form is still exactly as captured (assistLinkCurrent).
// assistFormChoice: the analysis of the open form the user chose for the next import ('' = the form's own primary one).
let assistLink=null,assistNote='',assistFormChoice='';
const ASSIST_FORM_BEFORE='Formularz w zakładce Narzędzia zmienił się od pobrania wartości, więc niczego nie wysłano, a Twój tekst pozostał w polu. Formularz odłączono od tej rozmowy: rozmowa zachowuje wcześniej pobrane dane i nie zmieni formularza. Pobierz formularz ponownie („Użyj otwartego kalkulatora”) albo naciśnij Wyślij jeszcze raz, aby liczyć na danych rozmowy.';
const ASSIST_FORM_LATE='Formularz w zakładce Narzędzia zmienił się, zanim nadeszła odpowiedź, więc odpowiedź odrzucono. Rozmowa, kalkulator i formularz pozostają bez zmian, a Twój tekst jest w polu. Formularz odłączono od tej rozmowy: pobierz go ponownie („Użyj otwartego kalkulatora”) albo wyślij jeszcze raz, aby liczyć na danych rozmowy.';
const ASSIST_FORM_DETACHED='Formularz w zakładce Narzędzia zmienił się od pobrania wartości i nie jest już połączony z tą rozmową. Rozmowa liczy na własnych, wcześniej pobranych danych; formularz pozostał bez zmian. Aby użyć jego obecnych wartości, pobierz go ponownie.';
const pl=x=>typeof x==='string'?x:x&&typeof x==='object'?(typeof x.pl==='string'&&x.pl?x.pl:typeof x.en==='string'?x.en:''):'';
function assistFrame(){try{return $('core-frame').contentWindow||null;}catch{return null;}}
function assistRegistry(){return ASession.registry(assistFrame());}
// docs/conversation-form-bridge.md: the synchronous, iframe-local form bridge. null = not loaded in this build.
function assistForms(){try{const w=assistFrame(),b=w&&w.ECAssistantBridge;return b&&['capture','apply','navigate'].every(k=>typeof b[k]==='function')?b:null;}catch{return null;}}
// The bridge and the registry accept only plain objects of their OWN realm (the tools frame document). A request built on this
// page is re-created there with the frame's own JSON, exactly as ASession.registry and ecHostBridge do at their boundaries.
// No check of the bridge or of the registry is involved or relaxed: what arrives is validated there as before.
function assistFrameOwn(value){const w=assistFrame(),J=w&&w.JSON;if(!J||typeof J.parse!=='function')throw Error('Brak ramki narzędzi.');return J.parse(JSON.stringify(value));}
// What the tools frame reports about its open form NOW: {bridge,generation,toolIds,primary}. null = no bridge, a bridge without
// getState, a frame that is not ready or an unreadable answer; a link can then not be confirmed and counts as changed.
function assistFormNow(){
 try{
  const forms=assistForms();if(!forms||typeof forms.getState!=='function')return null;
  const s=copy(forms.getState());if(!s||s.ok!==true||typeof s.generation!=='string'||!s.generation)return null;
  const a=s.active&&typeof s.active==='object'?s.active:{};
  return {bridge:forms,generation:s.generation,toolIds:Array.isArray(a.toolIds)?a.toolIds.filter(x=>typeof x==='string'):[],primary:typeof a.primaryToolId==='string'?a.primaryToolId:''};
 }catch{return null;}
}
// True while `link` names the form exactly as this page last saw it: this conversation, the same frame document (its bridge
// object), the same bridge generation (it advances on every input, change, click, navigation and tool switch in that document,
// also when a change is reverted) and that tool's form still the open one.
function assistLinkCurrent(link){
 if(!link||link.context!==activeContextId||!link.generation)return false;
 const now=assistFormNow();
 return !!now&&now.bridge===link.bridge&&now.generation===link.generation&&now.toolIds.includes(link.tool);
}
// The analyses of the open form the user can choose from: only when that one form serves several registry calculators (Load
// Calc: ordinary / new-design calculation, Service Sizing: ordinary / new-design). [{tool,title}] with the registry's own titles;
// a tool the registry does not name is not offered. One tool or none => [] (nothing to choose).
function assistFormOptions(now){
 if(!now||now.toolIds.length<2)return [];
 let reg=null;try{reg=assistRegistry();}catch{}
 if(!reg)return [];
 const out=[];
 for(const id of now.toolIds){let entry=null;try{entry=reg.tool(id);}catch{}const title=pl(entry&&entry.title);if(title&&!out.some(o=>o.tool===id))out.push({tool:id,title});}
 return out.length>1?out:[];
}
// The option that is selected: the user's explicit choice while it is still offered, otherwise the form's primary tool (the
// behaviour before there was a choice).
function assistFormChosen(now,options){
 if(!options.length)return '';
 if(options.some(o=>o.tool===assistFormChoice))return assistFormChoice;
 return options.some(o=>o.tool===now.primary)?now.primary:options[0].tool;
}
function assistToken(){return 'ctx-'+ASSIST_NONCE+'-'+contextGeneration+'-'+assistEpoch;}
function assistLocked(){return busy||audioBusy||recording||storageBroken||bankBooting||!!contextLost||writePending()||!!(typeof hostExternalStale!=='undefined'&&hostExternalStale)||!!(typeof handoffBusy!=='undefined'&&handoffBusy);}
function assistSay(text){assistNote=text;const el=$('assist-status');if(el)el.textContent=text;}
function assistTitle(tool){let entry=null;try{const reg=assistRegistry();entry=reg?reg.tool(tool):null;}catch{}return pl(entry&&entry.title)||tool;}
// The job this conversation writes to, read now from the original store: {snapshot,job}. null = no job, the job is not on this
// device, or the local tools are not ready; the request then carries no job and the server proposes no job action.
async function assistJobRead(){
 const jobId=workspaceMeta&&workspaceMeta.targetJobId;if(!jobId||typeof hostApi!=='function')return null;
 try{const r=await hostApi().read(jobId);if(!r||!r.ok)return null;const job=copy(r.job),snapshot=ASession.jobSnapshot(job);return snapshot&&snapshot.jobId===jobId?{snapshot,job:{head:job.head,revision:job.revision}}:null;}
 catch{return null;}
}
const assistKey=ready=>{const d=assistantMeta&&assistantMeta.tool;return activeContextId+'|'+(d?d.tool+'@'+d.fingerprint:'')+'|'+(ready?1:0);};
// Computes the result of the stored draft locally. `untrusted` is a result that came from outside (an answer): it is compared, never shown.
function assistCompute(untrusted){
 const draft=assistantMeta&&assistantMeta.tool;let reg=null;try{reg=draft?assistRegistry():null;}catch{}
 const view={key:assistKey(!!reg),result:null,entry:null,note:'',discarded:false};
 if(draft&&!reg)view.note=ASSIST_NOT_READY;
 if(draft&&reg){
  try{
   view.entry=reg.tool(draft.tool);
   if(untrusted){
    const v=reg.verify(draft,untrusted);view.result=v.ok?v.result:null;
    if(!v.ok)view.note=ASSIST_REFUSED;
    else if(!v.current){view.discarded=true;view.note='Wynik przesłany w odpowiedzi różnił się od lokalnego przeliczenia i został odrzucony. Poniżej wynik policzony na tym urządzeniu.';}
   }else{const r=reg.run(draft);view.result=r.ok?r.result:null;if(!r.ok)view.note=ASSIST_REFUSED;}
  }catch{view.result=null;view.note='Nie udało się przeliczyć kalkulatora na tym urządzeniu. Nie pokazano żadnej liczby.';}
 }
 assistShown=view;
}
// The next assistant data for an accepted answer. Only a calculator turn replaces the draft; every other turn keeps this
// conversation's own copy. A proposal is stored for review with the time of this save and the revision this save will have.
function assistAccept(answer,text){
 let next=assistantMeta;
 if(answer.domain==='calculator')next=ASession.withTool(next,answer.tool);
 if(answer.proposal){
  // A conflict that was shown and never written gives way to the new proposal; a pending write never gets here (sending is blocked).
  if(ASession.frozen(next))next=ASession.dismiss(next);
  const p=answer.proposal;
  next=ASession.withProposal(next,{kind:p.kind,proposalId:p.proposalId,savedAt:new Date().toISOString(),sourceRevision:workspaceMeta?workspaceMeta.sourceRevision+1:0,sourceText:text,job:p.job,note:p.note,fields:p.fields,edited:false});
 }
 return next;
}
// After the answer was stored: recompute, write the changed fields to the linked form, and say what happened.
function assistApplied(answer){
 assistEpoch++;assistNav=answer.navigation;assistChanged=answer.changedFields;assistSay('');
 if(answer.domain==='calculator'){
  if(assistLink&&assistLink.tool!==answer.tool.tool)assistLink=null;
  assistCompute(answer.result);
  const form=assistFormApply(answer);if(form)assistSay(form);
  return 'Kalkulator przeliczony na tym urządzeniu · sprawdź dane wejściowe i założenia. To nie jest odbiór instalacji.';
 }
 if(answer.domain==='navigation')return 'To narzędzie działa w zakładce Narzędzia — rozmowa niczego nie policzyła.';
 if(answer.proposal)return 'Propozycja zapisu do roboty czeka na przegląd poniżej. W robocie niczego jeszcze nie zapisano.';
 return 'Asystent prosi o doprecyzowanie — szkic, kalkulator i robota bez zmian.';
}
// Writes ONLY the fields this turn changed to the form the draft was taken from, through the form's own controls and renderer
// (ECAssistantBridge.apply). The bridge refuses when the form was touched since the capture; then nothing is written.
// The closed request {toolId,expectedGeneration,patch:{set,clear}} is re-created in the frame's own realm (assistFrameOwn) before
// the call; the bridge and the registry then judge its shape, keys, values and generation themselves.
function assistFormApply(answer){
 const link=assistLink,forms=assistForms(),draft=answer.tool;
 if(!link||!forms||!answer.changedFields.length||link.context!==activeContextId||link.tool!==draft.tool||!link.generation)return '';
 // Another frame document than the one the values were taken from: its form was never captured for this conversation.
 if(link.bridge!==forms){assistLink=null;return ASSIST_FORM_DETACHED;}
 // `set` has no prototype: a field named like a prototype member stays an ordinary own key, travels as it is and is refused by the
 // registry's own key check instead of being silently lost here.
 const set=Object.create(null),clear=[];for(const k of answer.changedFields){if(Object.hasOwn(draft.input,k))set[k]=draft.input[k];else clear.push(k);}
 let r=null;try{r=copy(forms.apply(assistFrameOwn({toolId:draft.tool,expectedGeneration:link.generation,patch:{set,clear}})));}catch{}
 if(r&&r.ok===true&&r.applied===true&&typeof r.generation==='string'){link.generation=r.generation;return 'Zmienione pola wpisano także do otwartego formularza tego narzędzia; pozostałe pola formularza bez zmian.';}
 if(r&&r.status==='no_change')return '';
 assistLink=null;
 return r&&r.status==='stale'?'Formularz w zakładce Narzędzia zmienił się od pobrania wartości, więc nie został zmieniony. Rozmowa liczy dalej na własnych danych.':'Tej zmiany nie można wpisać do formularza w zakładce Narzędzia; formularz pozostał bez zmian, a rozmowa liczy na własnych danych.';
}
// Explicit, one-shot: what the open form holds NOW becomes this conversation's draft (origin: form). Nothing is sent anywhere.
async function assistUseForm(){
 if(assistLocked())return;
 const forms=assistForms();let reg=null;try{reg=assistRegistry();}catch{}
 if(!forms||!reg){assistSay('Lokalne narzędzia jeszcze się wczytują albo ta wersja nie udostępnia odczytu formularzy. Niczego nie pobrano.');return;}
 // One open form can serve several analyses (Load Calc). The user's explicit choice is captured by its id; without a choice
 // (or for a form with one calculator) the bridge takes the form's primary tool, as before. Nothing is chosen by a model.
 const now=assistFormNow(),options=assistFormOptions(now),chosen=assistFormChosen(now,options);
 let c=null;try{c=copy(chosen?forms.capture(chosen):forms.capture());}catch{}
 const tool=c&&typeof c.toolId==='string'?c.toolId:'',name=tool?assistTitle(tool):'';
 if(!c||c.status==='not_ready'||c.status==='error'){assistSay('Narzędzia nie są jeszcze gotowe do odczytu formularza. Niczego nie pobrano.');assistRender();return;}
 if(c.status==='navigation_only'){assistSay('Otwarte narzędzie (moc, moment albo giętarka) działa tylko w zakładce Narzędzia; rozmowa niczego dla niego nie liczy i niczego nie pobrano.');assistRender();return;}
 if(!tool||c.status==='unknown_tool'||(chosen&&tool!==chosen)){assistSay('W zakładce Narzędzia nie jest otwarty kalkulator, którego wartości można pobrać. Otwórz go, wypełnij i wróć do rozmowy.');assistRender();return;}
 if(c.status==='needs_form'||!c.formInput||typeof c.formInput!=='object'||!Object.keys(c.formInput).length){
  assistSay(c.capture==='unsupported'?'Narzędzie „'+name+'” nie ma formularza, z którego można pobrać wartości — podaj je w rozmowie. Niczego nie założono.'
   :c.reason==='NEW_DESIGN_MODE_NOT_SELECTED'?'Analiza „'+name+'” dotyczy nowego projektu, a otwarty formularz nie jest w trybie nowego projektu. Wybierz ten tryb w formularzu w zakładce Narzędzia albo wybierz tutaj inną analizę; niczego nie pobrano ani nie założono.'
   :c.reason==='FORM_REPORTS_FAULT'?'Otwarty formularz zgłasza błąd danych, więc analizy „'+name+'” nie pobrano. Popraw formularz w zakładce Narzędzia i pobierz ponownie; niczego nie założono.'
   :'Formularz „'+name+'” nie ma teraz wartości do pobrania. Wypełnij go w zakładce Narzędzia i pobierz ponownie; niczego nie założono.');assistRender();return;
 }
 let made=null;try{made=reg.importForm(tool,c.formInput);}catch{}
 if(!made||!made.ok||!ASession.toolValid(made.draft)){assistSay('Wartości formularza „'+name+'” nie przeszły walidacji narzędzia. Niczego nie pobrano.');assistRender();return;}
 try{
  let saved=false;
  await hostExclusive(()=>{if(assistLocked())throw Error('Najpierw dokończ bieżącą operację.');bankSync();saved=applyChange(()=>{assistantMeta=ASession.withTool(assistantMeta,made.draft);});});
  if(!saved){assistSay('Nie zapisano pobranych wartości w przeglądarce'+(persistError?' ('+persistError+')':'')+'. Rozmowa bez zmian.');render();return;}
  assistEpoch++;assistNav=null;assistChanged=[];assistLink={context:activeContextId,tool,generation:typeof c.generation==='string'?c.generation:'',bridge:forms};assistCompute(null);
  assistSay('Pobrano '+Object.keys(made.draft.input).length+' wartości z formularza „'+name+'” do tej rozmowy'+(c.status==='needs_input'?'; czego brakuje, wypisano niżej jako pytania':'')+'. Poprawki z rozmowy nie będą nadpisywane przez formularz, dopóki nie pobierzesz go ponownie.'+(Array.isArray(c.warnings)&&c.warnings.length?' Uwaga: formularz może liczyć ten wynik własnym wzorem; w rozmowie liczy wspólny silnik aplikacji.':''));
 }catch(e){assistSay(e.message);}
 render();
}
async function assistClear(){
 if(assistLocked()||!(assistantMeta&&assistantMeta.tool))return;
 try{
  let saved=false;
  await hostExclusive(()=>{if(assistLocked())throw Error('Najpierw dokończ bieżącą operację.');bankSync();saved=applyChange(()=>{assistantMeta=ASession.withTool(assistantMeta,null);});});
  if(saved){assistEpoch++;assistLink=null;assistNav=null;assistChanged=[];assistShown=null;assistSay('Usunięto kalkulator z tej rozmowy. Historia rozmowy i formularz w Narzędziach pozostają bez zmian.');}
  else assistSay('Nie zapisano zmiany w przeglądarce. Kalkulator pozostaje w rozmowie.');
 }catch(e){assistSay(e.message);}
 render();
}
// Navigation only: opens the app's own tool. Nothing is calculated, captured or written by this.
async function assistOpenTool(tool){
 if(busy||audioBusy||recording||typeof hostNavigate!=='function')return;
 const name=assistTitle(tool);
 if(!await hostNavigate('tools'))return;
 let r=null;try{const forms=assistForms();r=forms?copy(forms.navigate(tool)):null;}catch{}
 assistLink=null;
 assistSay(r&&(r.status==='navigated'||r.status==='already_active')?'Otwarto narzędzie „'+name+'” w zakładce Narzędzia. Rozmowa niczego tam nie policzyła ani nie zmieniła.':r&&r.status==='blocked'?'Najpierw zapisz albo odrzuć otwarty formularz roboty; narzędzia „'+name+'” nie otwarto.':'Narzędzia „'+name+'” nie można otworzyć z rozmowy. Wybierz je w zakładce Narzędzia.');
}
function assistValue(v,unit){
 if(typeof v==='boolean')return v?'tak':'nie';
 if(typeof v==='number'||typeof v==='string')return String(v)+(typeof unit==='string'&&unit?' '+unit:'');
 return 'dane formularza';
}
// Lines of a registry result: the engine's own summary, then what is missing, unresolved, assumed and warned. Questions are the
// registry's sentences; field identifiers and warning codes are not shown.
function assistLines(r){
 const out=[],add=(text,cls)=>{if(text)out.push([text,cls]);};
 if(r.status!=='needs_input')for(const s of r.summary||[])add(pl(s),'assist-result');
 for(const n of r.needsInput||[])add(pl(n.question),'assist-question');
 for(const p of r.parts||[])if(p&&p.state==='unresolved')add('Nierozstrzygnięte: '+pl(p.label),'handoff-warning');
 for(const u of r.unresolved||[])add(pl(u.message),'handoff-warning');
 for(const e of r.errors||[])add(pl(e.message),'handoff-warning');
 for(const a of r.assumptions||[])add('Założenie: '+pl(a.note),'assist-assumption');
 for(const w of r.warnings||[])if(w&&typeof w.text==='string'&&w.text)add('Uwaga: '+w.text,'assist-assumption');
 return out;
}
function assistRender(){
 const body=$('assist-body');if(!body)return;
 const draft=assistantMeta&&assistantMeta.tool;let ready=false;try{ready=!!(draft&&assistRegistry());}catch{}
 if(!assistShown||assistShown.key!==assistKey(ready))assistCompute(null);
 const view=assistShown,locked=assistLocked(),occupied=busy||audioBusy||recording;
 body.replaceChildren();
 if(assistNav)body.append(node('p','Narzędzie „'+assistTitle(assistNav.tool)+'” działa w zakładce Narzędzia. Rozmowa niczego dla niego nie policzyła.','handoff-help'));
 if(!draft)body.append(node('p','Zapytaj o obliczenie albo pobierz wartości z kalkulatora otwartego w zakładce Narzędzia. Liczy zawsze silnik aplikacji na tym urządzeniu, także offline.','handoff-help'));
 else{
  const entry=view.entry,r=view.result,fields=entry&&entry.fields||{};
  body.append(node('p',(pl(entry&&entry.title)||draft.tool)+(r?' — '+(ASSIST_STATUS[r.status]||'stan nieznany'):''),'assist-title'));
  if(view.note)body.append(node('p',view.note,'handoff-warning'));
  if(r)for(const [text,cls] of assistLines(r))body.append(node('p',text,cls));
  const list=node('ul',undefined,'assist-fields');
  for(const k of Object.keys(draft.input)){const f=fields[k]||{};list.append(node('li',(pl(f.label)||k)+': '+assistValue(draft.input[k],f.unit)+(draft.origins[k]==='current_form'?' · z formularza':'')+(assistChanged.includes(k)?' · zmienione teraz':'')));}
  if(Object.keys(draft.input).length)body.append(list);
  body.append(node('p','Wynik obliczeniowy z silnika aplikacji. To nie jest odbiór, zatwierdzenie instalacji ani potwierdzenie zgodności z przepisami.','handoff-help'));
 }
 // A form that serves several analyses: a labelled choice with the registry's own titles (never an identifier in the text).
 // It only selects what „Użyj otwartego kalkulatora” will read; nothing is captured, calculated or adopted by choosing.
 const formNow=assistForms()?assistFormNow():null,options=assistFormOptions(formNow);
 if(options.length){
  const wrap=node('div',undefined,'assist-choice'),label=node('label','Analiza z otwartego formularza'),select=node('select');
  select.id='assist-form-tool';label.setAttribute('for','assist-form-tool');
  for(const o of options){const op=node('option',o.title);op.value=o.tool;select.append(op);}
  select.value=assistFormChosen(formNow,options);select.disabled=locked;
  select.onchange=()=>{assistFormChoice=options.some(o=>o.tool===select.value)?select.value:'';};
  wrap.append(label,select,node('p','Wybór wskazuje tylko, którą analizę otwartego formularza pobierze „Użyj otwartego kalkulatora”. Dane pochodzą wyłącznie z formularza.','handoff-help'));body.append(wrap);
 }
 const row=node('div',undefined,'handoff-actions'),button=(text,id,fn,off)=>{const b=node('button',text,'quiet');b.id=id;b.type='button';b.onclick=fn;b.disabled=!!off;row.append(b);};
 button('Użyj otwartego kalkulatora','assist-use-form',assistUseForm,locked||!assistForms());
 const target=assistNav?assistNav.tool:draft?draft.tool:'';
 if(target)button('Otwórz to narzędzie','assist-open-tool',()=>assistOpenTool(target),occupied||typeof hostNavigate!=='function');
 if(draft)button('Usuń kalkulator z rozmowy','assist-clear',assistClear,locked);
 body.append(row);
 const say=$('assist-status');if(say)say.textContent=assistNote;
}
// --- Online session ---------------------------------------------------------------------------
// The pilot server sits behind a login. After the login expires an /api call is answered with a redirect (refused here:
// redirect:'error') or with a page that is not JSON. Nothing is retried, nothing navigates on its own, and no cookie or
// login token is read here. 'Zaloguj ponownie' is a plain link to /_auth, shown only while online after such a failure.
const API_LOST='Serwer rozmowy online nie odpowiada albo logowanie wygasło. Niczego nie wysłano ponownie; tekst pozostaje w polu, a lokalne Roboty i narzędzia działają dalej. Użyj „Zaloguj ponownie”, aby wrócić do rozmowy online.';
let connectSeq=0;
function relogin(show){const a=$('relogin');if(a)a.hidden=!(show&&navigator.onLine);}
function apiLost(e){if(e&&e.name==='AbortError')throw e;throw Object.assign(Error(API_LOST),{reauth:true});}
async function apiBody(r){let v=null;try{v=await r.json();}catch(e){if(e&&e.name==='AbortError')throw e;}if(v===null||typeof v!=='object'||Array.isArray(v))apiLost();return v;}
// Server error contract: {error,code}. A known code means the request reached the application, so it is never a login problem,
// whatever the HTTP status (API_AUTH is 401, API_ACCESS is 403): only then is the server's short safe message shown. Exactly
// 403 SESSION_TOKEN is the local session token (not the API key). Any other 401/403 (no code, unknown code) is the login gate.
// Nothing else of a response body is ever shown.
const API_CODES=/^(?:API_(?:AUTH|ACCESS|QUOTA|RATE_LIMIT|REQUEST|SERVICE|CONNECTION|FORMAT)|MODEL_UNAVAILABLE|AI_NOT_CONFIGURED|INVALID_ROUTE|CANCELLED|PROPOSAL_[A-Z]{1,12}|ASSIST_[A-Z]{1,12}|HISTORY_LIMIT|CONTEXT_LIMIT|OUTPUT_LIMIT|OUTPUT_JSON|AUDIO_(?:SIZE|TYPE|FORMAT)|DUPLICATE_REQUEST|BUSY|DAILY_LIMIT|BUDGET_UNAVAILABLE|REQUEST_FAILED|INTERNAL)$/;
function apiError(r,result,fallback){
 const code=typeof result.code==='string'?result.code:'',known=API_CODES.test(code);
 if(r.status===403&&code==='SESSION_TOKEN')return Object.assign(Error('Sesja rozmowy wygasła.'),{sessionToken:true});
 if((r.status===401||r.status===403)&&!known)return Object.assign(Error(API_LOST),{reauth:true});
 return Object.assign(Error(known&&typeof result.error==='string'&&result.error&&result.error.length<=300?result.error:fallback),{code});
}
const SESSION_RENEWING='Sesja rozmowy wygasła. Odświeżam ją jeden raz; niczego nie wysyłam ponownie…';
const RENEWED_TALK='Sesja rozmowy została odświeżona. Wiadomość nie została wysłana — tekst pozostaje w polu. Naciśnij Wyślij ponownie.';
const RENEWED_AUDIO='Sesja rozmowy została odświeżona. Nagranie nie zostało przepisane, nie jest zapisane i nie zostanie wysłane ponownie. Nagraj wypowiedź jeszcze raz.';
// After 403 SESSION_TOKEN for the token `used`: drops that token and asks for the session once, through connect(). The rejected
// talk/audio request is never sent again from here. True only when a usable token is present afterwards; on failure connect()
// has already shown its own unavailable/login feedback.
async function renewSession(used){
 if(token!==used)return !!token;
 token=null;relogin(false);controls();status(SESSION_RENEWING);
 return connect();
}
// token stays null unless the server issued a real session token; only then do Wyślij and Mów become available (controls()).
async function connect(){
 const my=++connectSeq;let next=null,left=null,text='',kind='error',login=false;
 try{
  const r=await fetch('/api/session',{cache:'no-store',redirect:'error'});
  if(r.status===401||r.status===403)throw Object.assign(Error('session '+r.status),{reauth:true});
  if(!r.ok)throw Error('session '+r.status);
  const s=await apiBody(r);
  if(s.online===true&&typeof s.token==='string'&&/^[0-9a-f]{64}$/.test(s.token)){
   next=s.token;kind='';text='OpenAI · '+(typeof s.model==='string'&&s.model?s.model:'model online')+' · polski + English · szkic do sprawdzenia';
   // The budget is read only from an answer that also issued a token. A missing or malformed number stays unknown (null): it is
   // never taken for 0, and the 0 the server sends along with "offline" answers is not a budget at all.
   left=Number.isInteger(s.remainingRequests)&&s.remainingRequests>=0?s.remainingRequests:null;
   if(left===0){kind='error';text=BUDGET_EMPTY;}
  }
  else if(s.reason==='AI_NOT_CONFIGURED'){kind='';text='AI nie jest jeszcze podłączone na serwerze pilota — rozmowa i głos online są wyłączone. Lokalne Roboty, narzędzia, szkic i niewysłany tekst działają na tym urządzeniu.';}
  else text='Serwer nie udostępnił teraz rozmowy online. Lokalne Roboty, narzędzia, szkic i niewysłany tekst pozostają na tym urządzeniu.';
 }catch(e){
  // An interrupted request says nothing about the login: the token and the login link stay as they are.
  if(e&&e.name==='AbortError'){if(my===connectSeq){if(!token&&!storageBroken)status('Przerwano łączenie z rozmową online. Zapisane roboty, narzędzia i niewysłany tekst pozostają na tym urządzeniu.','error');controls();}return false;}
  login=!!(e&&(e.reauth||e.name==='TypeError'));
  text=navigator.onLine&&login?'Rozmowa online jest teraz niedostępna: brak połączenia z serwerem albo logowanie wygasło. Zapisane roboty, narzędzia i niewysłany tekst pozostają na tym urządzeniu i działają bez logowania. Do rozmowy online użyj „Zaloguj ponownie”.':'Rozmowa online jest teraz niedostępna. Zapisane roboty, narzędzia i niewysłany tekst pozostają na tym urządzeniu.';
 }
 if(my!==connectSeq)return false;
 token=next;budgetLeft=left;budgetDoubt=0;relogin(login);if(!storageBroken)status(text,kind);controls();return !!next;
}
// Explicit re-reading of the budget: one session request, on this click only. Nothing is polled and no message is sent.
$('limits-refresh').onclick=async()=>{
 if(busy||audioBusy||recording||!navigator.onLine)return;
 status('Sprawdzam limit zapytań na serwerze…');await connect();
};
async function sendMessage(){
 if(busy||audioBusy||recording||storageBroken||bankBooting||writePending()||(typeof handoffBusy!=='undefined'&&handoffBusy)||!token)return;
 if(!navigator.onLine){status('Brak internetu. Szkic i niewysłany tekst są zachowane; nic nie zostanie wysłane automatycznie.','error');scheduleInputSave(0);return;}
 const text=$('input').value.trim();if(!text)return;
 // Visible limits first (full history, exhausted budget): nothing is sent, and the text stays in the field and is saved.
 const stop=sendBlock();if(stop){status(stop,'error');scheduleInputSave(0);return;}
 // The response is accepted only for the same request, the same immutable context and the same context generation.
 const context=activeContextId,generation=contextGeneration,myseq=++seq,requestId=crypto.randomUUID(),used=token;
 const current=()=>myseq===seq&&context===activeContextId&&generation===contextGeneration;
 const blocked=()=>writePending()||!!(typeof handoffBusy!=='undefined'&&handoffBusy);
 const sourceStamp=()=>workspaceMeta?workspaceMeta.sourceId+':'+workspaceMeta.sourceRevision:'';
 // spent: a request was dispatched and its answer has not yet told whether the server counted it.
 busy=true;controller=new AbortController();controls();let pending=null,source='',spent=false;
 try{
  // Save the text before any network use, so a failed or cancelled send keeps it. A failed save sends nothing.
  // bankSync runs even when the text is already saved: a conversation changed by another tab is never sent from here.
  await hostExclusive(()=>{
   if(!current())return;if(blocked())throw Error('Najpierw dokończ rozpoczęty zapis do roboty. Niczego nie wysłano.');
   flushInput();bankSync();source=sourceStamp();
  });if(!current())return;
  const before=copy(state),snapshot=JSON.stringify(state);
  // The form this conversation's draft was taken from, as it is linked at dispatch (identity and generation). A link whose form
  // changed since the capture is dropped HERE, said plainly, and nothing is sent for this press: the request would otherwise
  // be answered for a form the user no longer sees. The form is never captured again by itself; a draft that was never linked
  // (stated in the conversation only) has no form guard at all.
  const draftNow=assistantMeta&&assistantMeta.tool;
  if(assistLink&&(!draftNow||assistLink.tool!==draftNow.tool||assistLink.context!==activeContextId))assistLink=null;
  const bound=assistLink;
  // The answer of this request is accepted only while that same link still holds (checked before the lock and inside it).
  const formHeld=()=>!bound||(assistLink===bound&&assistLinkCurrent(bound));
  const formDrop=why=>{if(assistLink===bound)assistLink=null;assistSay(ASSIST_FORM_DETACHED);return Object.assign(Error(why),{formStale:true});};
  if(!formHeld())throw formDrop(ASSIST_FORM_BEFORE);
  // Only the active context travels (docs/assistant-api-contract.md, protocol ec.assist 1): its draft/history (`before`), its
  // text, the calculator draft kept in this conversation (input only) and the identity, revision and notes length of the job the
  // conversation writes to — never the job's content. No form snapshot is sent: an open form enters the conversation only
  // through the explicit „Użyj otwartego kalkulatora”, which imports it into the draft once.
  const held=await assistJobRead();if(!current())return;
  if(!formHeld())throw formDrop(ASSIST_FORM_BEFORE);
  const contextToken=assistToken(),sent=ASession.request({requestId,text,state:before,lang:'pl',contextToken,toolDraft:assistantMeta&&assistantMeta.tool?copy(assistantMeta.tool):null,form:null,job:held?held.snapshot:null,clock:held?ASession.clock(new Date()):null});
  status('Model porządkuje wypowiedź i uwzględnia wcześniejszą rozmowę…');pending=node('p','Rozumiem wypowiedź…','pending');$('messages').append(pending);pending.scrollIntoView({block:'nearest'});
  spent=true;
  const r=await fetch('/api/assist',{method:'POST',headers:{'Content-Type':'application/json','X-EC-Token':used,'X-EC-Request-Id':requestId},body:JSON.stringify(sent),signal:controller.signal,redirect:'error'}).catch(apiLost);
  const result=await apiBody(r);spent=false;budgetNote(budgetOutcome(r,result));if(!current())return;
  if(!r.ok)throw apiError(r,result,'Brak odpowiedzi usługi AI.');
  relogin(false);
  // Acceptance (contract section 4). Request id, protocol, base revision, the echoed token and fingerprint of the request and the
  // closed shape of the answer: ASession.response. Then the CURRENT context: the token (it changes with every conversation switch
  // and every local change of the calculator draft or proposal, reverted or not), the linked form (formHeld: the bridge
  // generation of the dispatch, so a form that changed — reverted or not —, another open tool or a reloaded tools document
  // discards the answer) and the fingerprint recomputed from the current draft and the job as its original store holds it.
  const answer=ASession.response(result,sent);
  if(JSON.stringify(state)!==snapshot||!safeState(answer.state)||assistToken()!==contextToken)throw Error(ASession.STALE);
  if(!formHeld())throw formDrop(ASSIST_FORM_LATE);
  const fresh=job=>assistToken()===contextToken&&ASession.baseFingerprint(state.revision,assistantMeta&&assistantMeta.tool,null,job?job.snapshot:null)===sent.assistant.baseFingerprint;
  await hostExclusive(async()=>{
   if(!current())return;
   // The job is read from its original store HERE, after the conversation lock was obtained: a job revision saved while this
   // answer waited for the lock is seen, and the answer (its proposal names the revision that was sent) is refused. The job
   // lives in another database, so this is not one atomic step with the write below; the job adapter checks the revision
   // again before it writes anything to the job.
   const jobNow=await assistJobRead();
   // Every guard is evaluated again here, after that read and immediately before the response is applied; nothing below awaits.
   if(!current())return;bankSync();
   if(blocked())throw Error('W tej rozmowie rozpoczęto zapis do roboty. Odpowiedź modelu nie została zastosowana; szkic bez zmian.');
   if(sourceStamp()!==source||JSON.stringify(state)!==snapshot||!fresh(jobNow))throw Error(ASession.STALE);
   if(!formHeld())throw formDrop(ASSIST_FORM_LATE);
   const next=assistAccept(answer,text);
   const saved=applyChange(()=>{undo.push(before);undo=undo.slice(-8);state=answer.state;diffs=answer.diffs;assistantMeta=next;$('input').value='';});
   if(saved){
    const note=assistApplied(answer);
    status(answer.domain==='materials'?'Zaktualizowano roboczy szkic · '+(answer.durationMs/1000).toFixed(1)+' s · sprawdź propozycję':note,answer.domain==='clarification'?'':'success');
   }
   else status('Nie zapisano odpowiedzi w przeglądarce. Szkic i Twój tekst pozostają bez zmian; wyeksportuj szkic.','error');
   render();
  });
 }catch(e){if(current()){
  // Only the request the screen still waits for may touch the session. A cancellation is never a session problem. A rejected
  // session token is renewed once; the message is not sent again. A lost login drops the token, so nothing is posted again.
  if(e.name==='AbortError'){status('Anulowano odpowiedź. Szkic bez zmian.','error');relogin(false);}
  else if(e.sessionToken){pending?.remove();if(await renewSession(used)&&current())status(RENEWED_TALK);}
  else{if(e.reauth&&token===used)token=null;status(e.message,'error');relogin(!!e.reauth);}
 }}
 finally{if(spent)budgetNote('unknown');pending?.remove();if(myseq===seq){busy=false;controller=null;controls();$('input').focus();}}
}
$('composer').addEventListener('submit',e=>{e.preventDefault();sendMessage();});
$('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();sendMessage();}});
$('input').addEventListener('input',()=>{journalWrite();saveInputNow();exportControl();});
$('input').addEventListener('blur',()=>{journalWrite();saveInputNow();});
const editBlocked=()=>storageBroken||bankBooting||busy||audioBusy||recording||writePending()||!!(typeof handoffBusy!=='undefined'&&handoffBusy);
// 'Nowa rozmowa' never deletes: the current conversation stays in the bank and in the conversation selector.
$('new').onclick=async()=>{
 if(storageBroken||bankBooting||busy||audioBusy||recording||writePending()||(typeof handoffBusy!=='undefined'&&handoffBusy))return;
 try{
  let created=false;
  await hostExclusive(()=>{if(editBlocked())throw Error('Najpierw dokończ bieżącą operację.');flushInput();bankSync();if(contextBlank())return;openNewContext(workspaceMeta?.targetJobId||null);created=true;if(typeof hostSelected!=='undefined'){hostSelected.clear();hostAcks.clear();}});
  render();status(created?'Nowa rozmowa. Poprzednia pozostaje zapisana i dostępna na liście rozmów.':'Ta rozmowa jest już pusta — możesz zacząć pisać.');
 }catch(e){render();status(e.message,'error');limitHelp(e);}
};
$('undo').onclick=async()=>{
 if(storageBroken||bankBooting||busy||writePending()||(typeof handoffBusy!=='undefined'&&handoffBusy)||!undo.length)return;
 try{await hostExclusive(()=>{if(editBlocked())throw Error('Najpierw dokończ bieżącą operację.');bankSync();if(!undo.length)return;const saved=applyChange(()=>{state=undo.pop();diffs=[];});render();if(saved)status('Cofnięto ostatnią propozycję modelu.');else status('Nie zapisano cofnięcia. Szkic pozostaje bez zmian.','error');});}catch(e){status(e.message,'error');}
};
$('copy').onclick=async()=>{const text=state.items.map(i=>(i.quantity??'?')+' '+(i.unit??'?')+' — '+i.name+(i.specification?' · '+i.specification:'')+(i.review.length?' [do sprawdzenia: '+i.review.join('; ')+']':'')).join('\n');try{await navigator.clipboard.writeText(text);status('Skopiowano szkic — to nie specyfikacja zatwierdzona.');}catch{status('Nie udało się skopiować. Użyj eksportu szkicu.','error');}};
// --- Export ----------------------------------------------------------------------------------
// Two different files, never confused:
//  - conversation archive (empire-code.conversation-archive): one stored conversation, validated, importable. It carries the stored
//    entry verbatim (draft, history, undo, diffs, job binding, receipts), the EXACT text of the message field even when it was never
//    sent or saved, and the unsent texts kept for this conversation by the recovery journal.
//  - raw recovery copy (empire-code.storage-recovery): stored bytes and the screen as they are, for manual recovery when the
//    bank is unreadable or this tab lost its conversation. It is never imported and never opened as a draft.
// Unsent texts of one conversation other than `text`, each once, from validated journal records and from texts that could not be journaled.
function recoveryTexts(contextId,text){
 const out=[],add=(t,savedAt,baseVersion)=>{if(t&&t!==text&&!out.some(x=>x.text===t))out.push({text:t,savedAt,baseVersion});};
 for(const r of DraftRecovery.list(localStorage,contextId).records)add(r.record.text,r.record.savedAt,r.record.baseVersion);
 for(const v of recoveryVolatile)if(v.contextId===contextId)add(v.text,new Date().toISOString(),0);
 return out;
}
// Call inside the lock for the open conversation. `text` undefined = the stored unsent text (archived or other conversations).
function conversationArchive(contextId,text){
 const held=CBank.where(bank,contextId),shown=text===undefined&&held&&held.state!=='retired'?held.entry.input:text;
 return CBank.portable(bank,contextId,{exportedAt:new Date().toISOString(),unsentText:shown,recovery:recoveryTexts(contextId,shown)});
}
function exportRecovery(){
 const readRaw=key=>{try{return localStorage.getItem(key);}catch{return null;}};
 download({kind:'empire-code.storage-recovery',version:2,exportedAt:new Date().toISOString(),note:'Surowa kopia awaryjna: zapisy przeglądarki i zawartość ekranu. Niczego nie zmieniono ani nie usunięto. Ten plik nie jest importowany jako rozmowa.',reason:storageBroken?'storage':contextLost||'changed',bankKey:KEY,bankRaw:readRaw(KEY),legacyKey:LEGACY_KEY,legacyRaw:readRaw(LEGACY_KEY),screen:{contextId:activeContextId,version:activeVersion,state,undo,diffs,workspace:workspaceMeta,assistant:assistantMeta,assistantUnsaved:typeof hostActionUnsaved==='function'?hostActionUnsaved():null,unsentText:$('input').value},unsentRecovery:journalExport(true)},'EmpireCode-odzyskiwanie-zapisu.json');
 recoveryExported=true;
}
function archiveNote(payload){return JSON.stringify(payload).length>CBank.LIMITS.importChars?' Uwaga: plik przekracza limit importu i pozostanie kopią tylko do odczytu.':'';}
// 'Eksportuj szkic'. The text is journaled and saved first; when that save is refused the archive still carries the field text.
async function exportActive(){
 if(exportStale()){exportRecovery();status('Pobrano surową kopię awaryjną ekranu i zapisów przeglądarki. Niczego nie zmieniono.');if(typeof hostRender==='function')hostRender();return;}
 journalWrite();
 try{
  let payload=null,unsaved='';
  await hostExclusive(()=>{
   try{flushInput();}catch(e){unsaved=e&&e.message||'błąd';}
   bankSync();payload=conversationArchive(activeContextId,$('input').value);
  });
  download(payload,'EmpireCode-rozmowa.json');
  status('Pobrano archiwum tej rozmowy: szkic, historię, powiązania i niewysłany tekst. Eksport niczego nie usuwa i nie zwalnia miejsca.'+(unsaved?' Niewysłany tekst jest w pliku, ale nie został zapisany w przeglądarce ('+unsaved+').':'')+archiveNote(payload),unsaved?'error':'');
 }catch(e){
  exportRecovery();status('Nie udało się przygotować archiwum rozmowy ('+(e&&e.message||'błąd')+'). Pobrano surową kopię awaryjną ekranu; niczego nie zmieniono.','error');
 }
 controls();
}
$('export').onclick=exportActive;
function download(payload,name){const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}

// --- Conversation management (call inside the lock) -------------------------------------------
// Validators the application applies to a conversation that did not come from its own write path (an archive file).
// A draft that arrives from a file is held to the exact shape the model endpoint accepts and returns (server contract, state
// version 1): exact fields, bounded counters and lengths, unique item ids below nextId. Nothing is repaired, trimmed or dropped:
// a file that fails any rule is refused as a whole. Units are checked as a short text, not against a list. The lenient
// safeState() stays the rule for conversations this application stored itself.
const fileKeys=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const fileText=(v,max,min=0)=>typeof v==='string'&&v.length<=max&&v.trim().length>=min;
function fileItem(i){
 return fileKeys(i,['id','name','quantity','unit','specification','notes','review'])&&typeof i.id==='string'&&/^i\d{4}$/.test(i.id)&&fileText(i.name,120,1)
  &&(i.quantity===null||typeof i.quantity==='string'&&/^\d{1,7}(?:\.\d{1,4})?$/.test(i.quantity)&&Number(i.quantity)>0)
  &&(i.unit===null||fileText(i.unit,16,1))&&fileText(i.specification,500)&&fileText(i.notes,600)
  &&Array.isArray(i.review)&&i.review.length<=8&&i.review.every(r=>fileText(r,220,1));
}
function fileState(s){
 if(!fileKeys(s,['version','revision','nextId','items','history'])||s.version!==1||!Number.isInteger(s.revision)||s.revision<0||s.revision>100||!Number.isInteger(s.nextId)||s.nextId<1||s.nextId>1000)return false;
 if(!Array.isArray(s.items)||s.items.length>16||!Array.isArray(s.history)||s.history.length>40)return false;
 if(!s.items.every(fileItem)||new Set(s.items.map(i=>i.id)).size!==s.items.length||s.items.some(i=>Number(i.id.slice(1))>=s.nextId))return false;
 if(!s.history.every(m=>fileKeys(m,['role','content'])&&(m.role==='user'||m.role==='assistant')&&fileText(m.content,5000,1)))return false;
 return JSON.stringify(s).length<=60000;
}
// One change of the last model answer, in the three shapes the server produces. render() reads `before` of every non-add change.
function fileDiff(d){
 if(!d||typeof d!=='object')return false;
 if(d.op==='add')return fileKeys(d,['op','after'])&&fileItem(d.after);
 if(d.op==='remove')return fileKeys(d,['op','before'])&&fileItem(d.before);
 return d.op==='update'&&fileKeys(d,['op','before','after'])&&fileItem(d.before)&&fileItem(d.after)&&d.before.id===d.after.id;
}
function envelopeCheck(env){
 if(!Object.keys(env).every(k=>['state','undo','diffs','workspace','assistant'].includes(k)))throw Error('Rozmowa w pliku ma nieznane pola.');
 if(!fileState(env.state))throw Error('Rozmowa w pliku ma nieprawidłowy szkic (pola, liczniki, pozycje lub wiadomości poza dozwolonym układem i limitami).');
 if(env.undo!=null&&!(Array.isArray(env.undo)&&env.undo.length<=8&&env.undo.every(fileState)))throw Error('Rozmowa w pliku ma nieprawidłową historię cofania.');
 if(env.diffs!=null&&!(Array.isArray(env.diffs)&&env.diffs.length<=64&&env.diffs.every(fileDiff)))throw Error('Rozmowa w pliku ma nieprawidłowy opis zmian.');
 if(env.workspace!=null&&JHSession.validate(env.workspace).boundState!==JSON.stringify(env.state))throw Error('Powiązanie rozmowy w pliku nie zgadza się z jej szkicem.');
 // Assistant data of a file: the exact bounded layout or nothing. An empty member is not a layout this application writes.
 // The calculator input is also put to the registry when the local tools are loaded; a draft the registry refuses is not imported.
 // No result is read from a file: none is stored in this layout, and a result is always recomputed here before it is shown.
 if(Object.hasOwn(env,'assistant')){
  const helper=ASession.validate(env.assistant,ASession.contextOf(env.workspace||null));
  if(ASession.blank(helper))throw Error('Rozmowa w pliku ma puste dane asystenta.');
  const reg=helper.tool?assistRegistry():null;
  if(reg&&!reg.run(helper.tool).ok)throw Error('Kalkulator zapisany w pliku nie przechodzi walidacji narzędzia (pola, wartości lub skrót danych).');
 }
}
// One archive / restore / delete / import = one verified bank write. Order:
//  1. the text of the message field is journaled and saved (captured before anything else);
//  2. the stored bank is re-read; `change(bank)` is ONE pure CBank operation on it, returning {bank,...};
//  3. when that removes the OPEN conversation from the active list, the conversation shown next (the job's latest, otherwise a new
//     empty one) is part of the same write;
//  4. bytes are written against the exact bytes read and read back. Any refusal throws before memory or storage changed:
//     the original bank, the screen and the text in the field stay as they were.
// `targetId` is the conversation the operation concerns (null for an import).
function bankManage(targetId,change){
 if(storageBroken||bankBooting)throw Error('Zapis przeglądarki wymaga sprawdzenia. Niczego nie zmieniono.');
 if(busy||audioBusy||recording||writePending())throw Error('Najpierw dokończ bieżącą operację albo rozpoczęty zapis do roboty („Wznów zapis”). Niczego nie zmieniono.');
 const own=targetId===activeContextId;let unsaved=null;
 journalWrite();
 try{flushInput();}catch(e){unsaved=e;}
 bankSync();
 const result=change(bank),leaving=own&&!CBank.get(result.bank,activeContextId);
 // Archiving keeps the conversation, so its text must be stored in it first. Deleting it was confirmed together with that text.
 if(unsaved&&own&&!result.tombstone)throw Error('Niewysłany tekst tej rozmowy nie został zapisany ('+unsaved.message+'). Niczego nie zmieniono; tekst pozostaje w polu.');
 // Text that is held neither by the bank nor by this document's journal record exists only on the screen. Nothing is then
 // archived, restored or imported around it. Deleting ANOTHER conversation stays possible: it is the way to free the space the
 // text needs, and it does not touch the field (the caller reports the unsaved text and retries the save).
 if(unsaved&&!result.tombstone&&!inputDurable())throw Error('Niewysłany tekst otwartej rozmowy nie jest zapisany ani w rozmowie, ani w kopii awaryjnej ('+unsaved.message+'). Niczego nie zmieniono; tekst pozostaje w polu. Wyeksportuj szkic albo zwolnij miejsce, usuwając zbędną rozmowę.');
 let next=result.bank,follow=null;
 if(leaving){
  const jobId=workspaceMeta?.targetJobId||null;follow=CBank.latest(next,jobId);
  if(!follow){
   const now=new Date().toISOString(),fresh=blank(),meta=jobId?JHSession.target(JHSession.bind(null,fresh,crypto,now),jobId):null;
   const made=CBank.commit(next,{contextId:CBank.newId(crypto),baseVersion:0,input:'',envelope:{state:fresh,undo:[],diffs:[],workspace:meta},now});
   next=made.bank;follow=made.entry;
  }
 }
 if(next!==bank){const raw=CBank.store(localStorage,KEY,next,storageVersion);bank=next;storageVersion=raw;}
 if(follow){
  // This document's own journal record of the conversation it just left: its text is in the archived entry, or was deleted on request.
  if(journal&&journal.contextId===targetId){try{DraftRecovery.clearExact(localStorage,journal.key,journal.raw);}catch{}journal=null;}
  activateEntry(CBank.get(bank,follow.contextId));
 }
 return {...result,switched:!!follow,unsaved:unsaved?unsaved.message||'błąd':''};
}
// Applies an archive file. The unsent texts it carries are put back into the recovery journal of that conversation, where they
// are offered for an explicit choice; they are never written into the field or sent.
function conversationImport(text,options){
 const result=bankManage(null,fresh=>CBank.adopt(fresh,text,{...options,now:new Date().toISOString(),validate:envelopeCheck}));
 // Each copy is stored against base version 0, which no stored conversation has: the automatic restore of an interrupted save
 // (recoveryRefresh, same base version) can therefore never put a text from a file into the field over the imported unsent text.
 let lost=0;
 for(const r of result.recovery){try{journalCopy({contextId:result.entry.contextId,baseVersion:0,text:r.text,savedAt:r.savedAt});}catch{lost++;}}
 if(result.changed&&result.entry.contextId===activeContextId)recoveryReset();
 return {...result,lost};
}
// Raw journal records, read-only: of the active conversation, or of every conversation when the bank could not be read.
function journalExport(all){
 try{const l=all?DraftRecovery.list(localStorage):DraftRecovery.list(localStorage,activeContextId);return {prefix:DraftRecovery.PREFIX,records:l.records.map(r=>({key:r.key,raw:r.raw})),problems:l.problems,truncated:l.truncated,notJournaled:recoveryVolatile.filter(v=>all||v.contextId===activeContextId).map(v=>({contextId:v.contextId,text:v.text}))};}
 catch(e){return {error:e&&(e.code||e.message)||'błąd'};}
}
// The legacy key exactly as stored, plus what the bank recorded about its import. Nothing is changed or removed.
function exportLegacyRaw(){let raw=null;try{raw=localStorage.getItem(LEGACY_KEY);}catch{}download({kind:'empire-code.legacy-raw',version:1,exportedAt:new Date().toISOString(),note:'Surowy starszy zapis. Niczego nie zmieniono ani nie usunięto.',legacyKey:LEGACY_KEY,legacyRaw:raw,imported:bank.legacy},'EmpireCode-starszy-zapis.json');}
// --- Voice capture ---------------------------------------------------------------------------
// One press of Mów creates one session object that owns its stream, recorder, stop timer, chunk buffer and abort controller.
// MediaRecorder.stop() only QUEUES the last dataavailable and the stop event, so callbacks of a cancelled recording can arrive
// after the next one has started. Every callback therefore checks the session identity FIRST: a session that is not
// `audioSession` may only release its own stream and chunks; it never touches the flags, timer, network or status of a newer one.
// Audio lives in memory only: at most 29 s and 8 MB, posted at most once per session, never stored and never retried.
const AUDIO_MAX_MS=29000,AUDIO_MAX_BYTES=8*1024*1024,TRANSCRIPT_MAX=3000,AUDIO_STOP_MS=5000,AUDIO_REQUEST_MS=95000;const AUDIO_STOP_FAILED='Nie udało się zakończyć nagrania. Mikrofon został zwolniony, a nagranie nie zostało wysłane ani zapisane. Nagraj wypowiedź jeszcze raz albo pisz dalej.',AUDIO_TIMEOUT='Transkrypcja nie odpowiedziała na czas. Nagranie nie jest zapisane i nie zostanie wysłane ponownie. Nagraj wypowiedź jeszcze raz albo pisz dalej.',AUDIO_NOT_STARTED='Nagrywanie nie zostało rozpoczęte, bo sesja wygasła, nie ma połączenia albo strona jest w tle. Mikrofon został zwolniony i nic nie wysłano. Spróbuj ponownie.';
const AUDIO_CHANGED='Rozmowa zmieniła się w trakcie nagrania. Nagranie nie zostało wysłane ani zapisane; nagraj wypowiedź jeszcze raz.';
const AUDIO_FAILED='Transkrypcja nie powiodła się. Nagranie nie jest zapisane i nie zostanie wysłane ponownie.';
// Visible clock of the current recording, counted against the same limit after which the session's stop timer ends it. The tick
// (`s.tick`) belongs to its session exactly like that stop timer: audioRelease() and audioStop() clear it, and a tick of a session
// that is no longer the current recording writes nothing. It only shows time; it never stops, cancels or sends anything.
const AUDIO_MAX_S=AUDIO_MAX_MS/1000;
function audioClock(s){
 clearTimeout(s.tick);s.tick=null;if(s!==audioSession||!recording||s.stopping)return;
 const elapsed=Math.max(0,Math.min(AUDIO_MAX_S,Math.floor((Date.now()-s.started)/1000))),left=AUDIO_MAX_S-elapsed;
 $('rec-time').textContent='Nagrywanie: '+elapsed+' s z '+AUDIO_MAX_S+' s · zostało '+left+' s. Po upływie czasu nagranie kończy się samo i jest wysyłane do transkrypcji.';
 // One spoken-status notice near the end, for those who do not watch the clock; the clock itself is not announced every second.
 if(left<=5&&!s.warned){s.warned=true;status('Zostało '+left+' s nagrania. Po upływie czasu nagranie skończy się samo i zostanie wysłane; Anuluj je odrzuca.');}
 if(left>0)s.tick=setTimeout(()=>audioClock(s),1000);
}
// Only errors marked here carry a message written for the user; anything else from the browser is replaced by a fixed text.
const voiceError=text=>Object.assign(Error(text),{voice:true});
function audioDenied(e){
 const n=e&&typeof e.name==='string'?e.name:'';
 if(n==='NotAllowedError'||n==='SecurityError'||n==='PermissionDeniedError')return 'Brak zgody na mikrofon. Zezwól na mikrofon w przeglądarce albo pisz dalej.';
 if(n==='NotFoundError'||n==='DevicesNotFoundError'||n==='OverconstrainedError')return 'Nie znaleziono mikrofonu. Nadal możesz pisać.';
 if(n==='NotReadableError'||n==='TrackStartError'||n==='AbortError')return 'Mikrofon jest zajęty lub niedostępny. Nadal możesz pisać.';
 return 'Nie uruchomiono mikrofonu. Nadal możesz pisać.';
}
// Idempotent. Touches only what this session owns: its timer, its chunks and every track of its stream.
function audioRelease(s){
 clearTimeout(s.timer);s.timer=null;clearTimeout(s.deadline);s.deadline=null;clearTimeout(s.tick);s.tick=null;s.chunks.length=0;s.bytes=0;const own=s.stream;s.stream=null;if(!own)return;
 try{for(const t of own.getTracks()){try{t.onended=null;}catch{}try{t.stop();}catch{}}}catch{}
}
// Handlers of a finished or cancelled session stay callable (a late event must not throw) but can only release that session.
function audioInert(s){const r=s.recorder,drop=()=>audioRelease(s);if(!r)return;try{r.ondataavailable=drop;r.onerror=drop;r.onstop=drop;}catch{}}
// Ends a session whose recorder is no longer running. Screen flags change only if it is still the current session.
function audioEnd(s){audioInert(s);audioRelease(s);s.abort=null;if(s!==audioSession)return;audioSession=null;recording=false;audioBusy=false;controls();}
// Invalidates the current session synchronously BEFORE stop(), so whatever stop() delivers, now or later, is already stale.
function cancelAudio(){
 const s=audioSession;++audioSeq;audioSession=null;recording=false;audioBusy=false;
 if(s){
  audioInert(s);
  try{if(s.recorder&&s.recorder.state!=='inactive')s.recorder.stop();}catch{}
  try{s.abort?.abort();}catch{}
  s.abort=null;audioRelease(s);
 }
 controls();
}
// The gate of every callback. A stale session releases itself and gets false. The current session in a conversation that
// changed meanwhile is cancelled as a whole (it IS the current one, so nothing newer is touched) and also gets false.
function audioMine(s){
 if(!s||s!==audioSession){if(s)audioRelease(s);return false;}
 if(s.context!==activeContextId||s.generation!==contextGeneration){cancelAudio();status(AUDIO_CHANGED,'error');return false;}
 return true;
}
function audioChunk(s,e){
 if(!audioMine(s)||s.submitted)return;const size=e&&e.data?e.data.size:0;if(!(size>0))return;
 s.bytes+=size;if(s.bytes>AUDIO_MAX_BYTES){cancelAudio();status('Nagranie przekroczyło 8 MB. Nie wysłano go.','error');return;}
 s.chunks.push(e.data);
}
function audioFault(s){if(!audioMine(s)||s.submitted)return;cancelAudio();status('Błąd mikrofonu. Szkic bez zmian.','error');}
// Stop button, the 29 s limit and a track that ended all come here. Only the first request reaches recorder.stop(); a recorder
// that already stopped by itself (InvalidStateError) is ignored, because its stop event is queued and ends the session.
function audioStop(s){
 if(!audioMine(s)||s.stopping||!s.recorder)return;
 s.stopping=true;clearTimeout(s.timer);clearTimeout(s.tick);s.tick=null;recording=false;audioBusy=true;s.timer=setTimeout(()=>{if(!audioMine(s)||s.submitted)return;cancelAudio();status(AUDIO_STOP_FAILED,'error');},AUDIO_STOP_MS);controls();
 try{if(s.recorder.state!=='inactive')s.recorder.stop();}catch{if(audioMine(s)&&!s.submitted){cancelAudio();status(AUDIO_STOP_FAILED,'error');}}
}
// The stop event of a session: the only place a recording is posted, and at most once per session.
async function audioFinish(s){
 if(!audioMine(s)||s.submitted)return;s.submitted=true;
 const parts=s.chunks.splice(0),type=s.recorder&&typeof s.recorder.mimeType==='string'&&s.recorder.mimeType||'audio/webm',field=s.field,used=token;
 audioInert(s);audioRelease(s);recording=false;audioBusy=true;controls();
 if(!used||!navigator.onLine){audioEnd(s);status((navigator.onLine?'Brak aktywnej sesji.':'Brak połączenia z internetem.')+' Nagranie nie zostało przetranskrybowane, nie jest zapisane i nie zostanie automatycznie wysłane ponownie.','error');relogin(!used&&navigator.onLine);return;}
 // The limits are checked again before the recording leaves the device: a conversation that cannot take another exchange, or a
 // budget that cannot cover transcription AND interpretation, gets no transcription request at all.
 const stop=voiceBlock();if(stop){audioEnd(s);status(stop+' Nagranie nie zostało wysłane do transkrypcji i nie jest zapisane.','error');return;}
 // spent: the transcription was dispatched and its answer has not yet told whether the server counted it.
 status('Transkrypcja online · polski + English…');let handed=false,spent=false;
 try{
  const blob=new Blob(parts,{type});parts.length=0;if(blob.size<128||blob.size>AUDIO_MAX_BYTES)throw voiceError('Nagranie jest puste lub zbyt duże. Nie wysłano go.');
  const id=crypto.randomUUID();s.abort=new AbortController();const ctl=s.abort;s.deadline=setTimeout(()=>{if(s!==audioSession||s.abort!==ctl)return;s.timedOut=true;try{ctl.abort();}catch{}},AUDIO_REQUEST_MS);
  if(!audioMine(s))return;
  spent=true;
  const response=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':type,'X-EC-Token':used,'X-EC-Request-Id':id},body:blob,signal:s.abort.signal,redirect:'error'}).catch(apiLost);
  const result=await apiBody(response);spent=false;budgetNote(budgetOutcome(response,result));
  // A late transcript or error never lands in another conversation or in a newer recording.
  if(!audioMine(s))return;
  if(!response.ok)throw Object.assign(apiError(response,result,'Transkrypcja nie powiodła się.'),{voice:true});
  // Accepted only for this request, as 1–3000 characters after trimming the ends; the spoken content itself is not altered.
  const spoken=result.requestId===id&&typeof result.text==='string'?result.text.trim():'';
  if(!spoken||spoken.length>TRANSCRIPT_MAX)throw voiceError('Nie otrzymano poprawnej transkrypcji. Pole wiadomości bez zmian i nic nie wysłano do modelu. Nagraj wypowiedź jeszcze raz.');
  // Text that appeared in the field while the capture was pending is never overwritten.
  if($('input').value!==field){audioEnd(s);status('W polu wiadomości pojawił się tekst, więc transkrypcja nie została wstawiona ani wysłana. Tekst pozostaje w polu.','error');return;}
  // From here it is an ordinary message: journal first, then sendMessage(), which saves to the bank before any network use
  // and sends nothing when that save fails. The session is over before the message starts.
  audioEnd(s);$('input').value=spoken;handed=true;journalWrite();scheduleInputSave(0);
  const sent=seq,sending=sendMessage();
  if(seq===sent&&navigator.onLine)status('Transkrypcja jest w polu wiadomości, ale nie została wysłana do modelu. '+(sendBlock()||'Sprawdź tekst i naciśnij Wyślij.'),'error');
  await sending;
 }catch(e){
  // Same rules as for a message. The recording is not kept anywhere and is never sent or transcribed again.
  if(handed)status('Nie udało się wysłać transkrypcji. Tekst pozostaje w polu.','error');
  else if(audioMine(s)){
   if(s.timedOut){status(AUDIO_TIMEOUT,'error');relogin(false);}else if(e&&e.name==='AbortError'){status('Anulowano nagranie.','error');relogin(false);}
   else if(e&&e.sessionToken){if(await renewSession(used)&&audioMine(s))status(RENEWED_AUDIO);}
   else{const lost=!!(e&&e.reauth);if(lost&&token===used)token=null;status(lost?'Nie otrzymano transkrypcji. Nagranie nie jest zapisane lokalnie i nie zostanie automatycznie wysłane ponownie. Zaloguj się ponownie przed nowym nagraniem.':e&&e.voice?e.message:AUDIO_FAILED,'error');relogin(lost);}
  }
 }
 finally{if(spent)budgetNote('unknown');audioEnd(s);}
}
$('cancel').onclick=()=>{++seq;controller?.abort();controller=null;busy=false;cancelAudio();document.querySelector('.pending')?.remove();status('Anulowano. Roboczy szkic bez zmian; tekst pozostaje w polu.');controls();};
$('mic').onclick=async()=>{
 if(recording){audioStop(audioSession);return;}if(busy||audioBusy||audioSession||storageBroken||bankBooting||writePending()||(typeof handoffBusy!=='undefined'&&handoffBusy)||!token||!navigator.onLine)return;
 // Visible limits before the microphone is even asked for: a full conversation or a budget that cannot cover transcription and
 // interpretation starts no recording, acquires no microphone and sends nothing.
 const stop=voiceBlock();if(stop){status(stop,'error');return;}
 if($('input').value.trim()){status('Wyślij lub usuń bieżący tekst przed nowym nagraniem.','error');return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status('Mikrofon nie jest dostępny w tej przeglądarce. Nadal możesz pisać.','error');return;}
 const s={id:++audioSeq,context:activeContextId,generation:contextGeneration,field:$('input').value,stream:null,recorder:null,timer:null,tick:null,started:0,warned:false,chunks:[],bytes:0,abort:null,deadline:null,timedOut:false,stopping:false,submitted:false};
 audioSession=s;audioBusy=true;controls();status('Zezwól na mikrofon. Po Stop nagranie zostanie wysłane do OpenAI.');
 let acquired=null;
 try{acquired=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true},video:false});}
 catch(e){if(s===audioSession){const text=audioDenied(e);audioEnd(s);status(text,'error');}return;}
 // Permission can be answered after Cancel, offline, a hidden page or a conversation change: that stream is released at once
 // and no recorder is created for it.
 s.stream=acquired;if(!audioMine(s))return;if(!token||!navigator.onLine||document.hidden){cancelAudio();status(AUDIO_NOT_STARTED,'error');return;}
 try{
  const preferred=['audio/webm;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
  const r=new MediaRecorder(acquired,preferred?{mimeType:preferred}:undefined);s.recorder=r;
  r.ondataavailable=e=>audioChunk(s,e);r.onerror=()=>audioFault(s);r.onstop=()=>audioFinish(s);
  for(const t of acquired.getTracks())t.onended=()=>audioStop(s);
  r.start(1000);
 }catch{
  if(s===audioSession){cancelAudio();status('Nie udało się uruchomić nagrywania w tej przeglądarce. Mikrofon został zwolniony; nadal możesz pisać.','error');}else audioRelease(s);
  return;
 }
 recording=true;audioBusy=false;controls();status('Słucham. Mieszaj polski i English. Stop wyśle wypowiedź online.');s.timer=setTimeout(()=>audioStop(s),AUDIO_MAX_MS);
 s.started=Date.now();audioClock(s);
};
// Leaving writes this document's journal key synchronously (never the bank, which needs the lock). The browser asks before
// leaving only when the text is durable nowhere: not confirmed in the bank and not held in the journal.
window.addEventListener('beforeunload',e=>{journalWrite();saveInputNow();if(!inputUnsaved())return;e.preventDefault();e.returnValue='';});
window.addEventListener('pagehide',()=>{journalWrite();saveInputNow();controller?.abort();cancelAudio();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)return;journalWrite();saveInputNow();if(recording||audioBusy){cancelAudio();status('Nagranie anulowane po opuszczeniu strony.');}});
// Another tab wrote the bank. Changes to other contexts are adopted silently; only a change of THIS context interrupts work.
window.addEventListener('storage',e=>{
 if(e.key===LEGACY_KEY){legacyWatch();return;}
 if(typeof e.key==='string'&&activeContextId&&e.key.startsWith(DraftRecovery.PREFIX+activeContextId+':')){recoveryRefresh();return;}
 if(e.key!==KEY)return;let raw;try{raw=localStorage.getItem(KEY);}catch{raw=e.newValue;}
 if(raw===storageVersion)return;
 if(adoptForeign(raw)){if(typeof hostRender==='function')hostRender();return;}
 contextLost=lostReason(raw);
 ++seq;controller?.abort();busy=false;cancelAudio();status(contextLost?LOST[contextLost]+LOST_HELP:'Ta rozmowa zmieniła się w innej karcie. Niczego nie nadpisano; niewysłany tekst pozostaje w polu.','error');
});

// --- Startup ---------------------------------------------------------------------------------
// Same acceptance rules the legacy loader used; a legacy draft that fails them is left untouched and reported.
function legacyCheck(saved){
 if(!safeState(saved.state))throw Error('Nieprawidłowy zapis poprzedniego szkicu.');
 if(!saved.workspace&&localStorage.getItem('empire_code_workspace2_seen')==='1')throw Error('Starsza karta zapisała szkic bez powiązania.');
 if(saved.workspace)JHSession.validate(saved.workspace);
}
function initialEntry(){let id=null;try{id=sessionStorage.getItem(ACTIVE_KEY);}catch{}return (id&&CBank.get(bank,id))||CBank.latest(bank)||null;}
function bootFailed(e){
 storageBroken=true;bankBooting=false;if(!activeContextId)activeContextId=CBank.newId(crypto);
 status('Nie udało się odczytać zapisanych rozmów ('+(e&&e.message||'błąd')+'). Niczego nie usunięto ani nie nadpisano. „Eksportuj szkic” pobierze surowy zapis do odzyskania.','error');
}
// Lowercase hex SHA-256 of the UTF-8 encoding of the stored legacy string.
async function sha256Hex(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,'0')).join('');}
const LEGACY_CHANGED='Starsza wersja aplikacji zmieniła stary szkic po jego imporcie. Zmienionej treści nie zaimportowano ponownie (powieliłaby rozmowę i jej identyfikatory); pozostaje nienaruszona w przeglądarce.';
// Call inside the lock. Decides the legacy import against the freshly read bank (whether or not a bank already exists), then
// opens a stored conversation or creates and stores an empty one. The legacy key is only read. A legacy problem never blocks the bank.
function bootDecide(legacyRaw,digest){
 const raw=localStorage.getItem(KEY);let fresh=CBank.empty(),version=raw,imported=null;
 if(raw!==null){
  const found=CBank.read(raw);fresh=found.bank;
  // Layout migration of a bank written by an earlier release: the same conversations, entry for entry, in the current layout.
  // Written once, here under the lock, against exactly the bytes just read, and read back. A refusal (another tab, no space)
  // throws: the old bytes stay untouched and the page reports them as recoverable instead of working on an unsaved copy.
  if(found.stored!==CBank.VERSION)version=CBank.store(localStorage,KEY,fresh,raw);
 }
 legacyNotice='';
 if(legacyRaw!==null){
  if(fresh.legacy===null){
   try{
    if(!digest)throw Error('nie udało się obliczyć skrótu starszego zapisu');
    const contextId=CBank.newId(crypto),next=CBank.migrate(legacyRaw,{contextId,now:new Date().toISOString(),validate:legacyCheck,sha256:digest,bank:fresh});
    // The import may only ADD the legacy conversation and its record: every stored conversation must come back unchanged.
    if(!next.legacy||next.legacy.sha256!==digest||next.legacy.contextId!==contextId||!CBank.get(next,contextId)||fresh.contexts.some(e=>JSON.stringify(CBank.get(next,e.contextId))!==JSON.stringify(e))||JSON.stringify(next.archived)!==JSON.stringify(fresh.archived)||JSON.stringify(next.retired)!==JSON.stringify(fresh.retired))throw Error('import nie zachował zapisanych rozmów lub skrótu');
    version=CBank.store(localStorage,KEY,next,version);fresh=next;imported=contextId;
   }catch(e){legacyNotice='Starszy szkic nie został zaimportowany ('+(e&&e.message||'błąd')+'). Pozostaje nienaruszony w przeglądarce; zapisane rozmowy działają dalej.';}
  }else if(!digest)legacyNotice='Nie udało się sprawdzić, czy stary szkic zmienił się po imporcie. Pozostaje nienaruszony w przeglądarce.';
  else if(fresh.legacy.sha256!==digest)legacyNotice=LEGACY_CHANGED;
 }
 bank=fresh;storageVersion=version;
 const entry=(imported&&CBank.get(bank,imported))||initialEntry();
 if(entry){activateEntry(entry);return;}
 // No conversation yet: create and store an empty one now, so a journal record never points to an unknown conversation.
 state=blank();undo=[];diffs=[];workspaceMeta=null;assistantMeta=null;$('input').value='';inputSaved='';activeContextId=CBank.newId(crypto);activeVersion=0;
 if(!persist())throw Error(persistError||'Nie zapisano pierwszej rozmowy.');
}
// The digest is computed outside the lock (it is asynchronous); the decision is taken inside it, on bytes re-read there.
async function bootLocked(){
 for(let attempt=0;;attempt++){
  const seen=localStorage.getItem(LEGACY_KEY);let digest=null,settled=false;
  if(seen!==null){try{digest=await sha256Hex(seen);}catch{}}
  await hostExclusive(()=>{
   const same=localStorage.getItem(LEGACY_KEY)===seen;if(!same&&attempt<3)return;
   bootDecide(seen,same?digest:null);settled=true;
  });
  if(settled)return;
 }
}
// An old client wrote the legacy key while this page is open: report it, import nothing here.
async function legacyWatch(){
 try{
  if(storageBroken||bankBooting)return;const raw=localStorage.getItem(LEGACY_KEY);if(raw===null)return;const digest=await sha256Hex(raw);
  if(!bank.legacy)legacyNotice='Starsza wersja aplikacji zapisała stary szkic. Zostanie sprawdzony przy następnym otwarciu strony; pozostaje nienaruszony.';
  else if(bank.legacy.sha256!==digest)legacyNotice=LEGACY_CHANGED;else return;
  controls();
 }catch{}
}
// Nothing is written before the lock: the stored conversation is only shown, and the field stays disabled (bankBooting)
// until the lock callback has decided the migration and a stored conversation exists.
function boot(){
 bankBooting=true;
 // read() also accepts the released layout 1; it is only SHOWN here. Its migration is written inside the lock (bootDecide).
 try{const raw=localStorage.getItem(KEY);if(raw!==null){bank=CBank.read(raw).bank;storageVersion=raw;const entry=initialEntry();if(entry)activateEntry(entry);}}
 catch(e){bootFailed(e);return;}
 bootLocked().then(()=>{bankBooting=false;render();recoveryRefresh();},e=>{bootFailed(e);render();});
}
boot();render();connect();

window.addEventListener('offline',()=>{++seq;controller?.abort();controller=null;busy=false;cancelAudio();document.querySelector('.pending')?.remove();relogin(false);status('Brak internetu. Szkic, niewysłany tekst i eksport działają; niczego nie wysłano ponownie.','error');controls();});
window.addEventListener('online',()=>connect());
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
