'use strict';
// Conversation UI. All persistence goes through CBank under one versioned key (KEY).
// The legacy single-draft key is read once for migration and is never written or removed.
const $=id=>document.getElementById(id),KEY=CBank.KEY,LEGACY_KEY=CBank.LEGACY_KEY,ACTIVE_KEY='empire_code_active_context_v1',copy=v=>JSON.parse(JSON.stringify(v));
const blank=()=>({version:1,revision:0,nextId:1,items:[],history:[]});
let workspaceMeta=null,storageBroken=false,persistError='',inputSaving=false;
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
function controls(){
 const occupied=busy||audioBusy||recording;
 const handoffLocked=!!(typeof hostExternalStale!=='undefined'&&hostExternalStale)||storageBroken||bankBooting||!!(typeof handoffBusy!=='undefined'&&handoffBusy)||JHSession.pending(workspaceMeta);
 $('send').disabled=occupied||handoffLocked||!token||!navigator.onLine;$('input').disabled=occupied||bankBooting;$('mic').disabled=busy||audioBusy||handoffLocked||!token||!navigator.onLine;
 $('mic').textContent=recording?'Stop':audioBusy?'Przygotowanie…':'Mów';$('cancel').hidden=!occupied;$('undo').disabled=occupied||handoffLocked||!undo.length;$('new').disabled=occupied||handoffLocked;
 $('copy').disabled=!state.items.length;$('export').disabled=!state.history.length&&!storageBroken;if(typeof hostRender==='function')hostRender();
}
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
// Throws unless the active context is still exactly what this tab last read or wrote.
function bankSync(){
 if(storageBroken)throw Error('Zapis przeglądarki wymaga sprawdzenia. Niczego nie nadpisano.');
 const raw=localStorage.getItem(KEY);
 if(raw!==storageVersion&&!adoptForeign(raw))throw Error('Szkic zmienił się w innej karcie. Nie nadpisano danych.');
}
// Single write path: re-read, compare-and-set the active entry only, verify bytes. Throws without changing memory.
function writeEntry(envelope,input){
 bankSync();
 const result=CBank.commit(bank,{contextId:activeContextId,baseVersion:activeVersion,input,envelope,now:new Date().toISOString()});
 const raw=CBank.store(localStorage,KEY,result.bank,storageVersion);
 bank=result.bank;storageVersion=raw;activeVersion=result.entry.version;inputSaved=input;
 try{sessionStorage.setItem(ACTIVE_KEY,activeContextId);}catch{}
 journalConfirm(input);
}
// Saves the screen state, host metadata and the unsent text of the active context. Returns false and changes nothing on failure.
function persist(){
 try{const next=JHSession.bind(workspaceMeta,state,crypto,new Date().toISOString());writeEntry({state,undo:undo.slice(-8),diffs,workspace:next},$('input').value);workspaceMeta=next;return true;}
 catch(e){persistError=e&&e.message||'';status('Brak zapisu w przeglądarce. '+persistError+' Nie zamykaj strony; wyeksportuj szkic.','error');return false;}
}
function snapshotContext(){return {state:copy(state),undo:copy(undo),diffs:copy(diffs),workspaceMeta:workspaceMeta?copy(workspaceMeta):null,activeContextId,activeVersion,inputSaved,input:$('input').value};}
function restoreContext(s){state=s.state;undo=s.undo;diffs=s.diffs;workspaceMeta=s.workspaceMeta;activeContextId=s.activeContextId;activeVersion=s.activeVersion;inputSaved=s.inputSaved;$('input').value=s.input;}
// Mutate + persist as one step; state, undo, diffs, metadata and the input field are rolled back when the write fails.
function applyChange(mutate){const snap=snapshotContext();try{mutate();}catch(e){restoreContext(snap);throw e;}if(persist())return true;restoreContext(snap);return false;}
function contextBlank(){return !state.history.length&&!state.items.length&&!$('input').value&&!(workspaceMeta&&workspaceMeta.receipts.length);}

// --- Unsent text -----------------------------------------------------------------------------
// Call inside the lock. Stores the textarea content for the active context; throws (text stays in the field) on failure.
function flushInput(){
 clearTimeout(inputTimer);inputTimer=null;const text=$('input').value;
 if(text===inputSaved){if(journal){try{bankSync();journalConfirm(text);}catch{}}return;}
 bankSync();const stored=CBank.get(bank,activeContextId);
 writeEntry(stored?stored.envelope:{state,undo:undo.slice(-8),diffs,workspace:workspaceMeta},text);
}
// Saves immediately (no debounce), always under the lock. One request runs at a time; the text is read when the lock is
// granted, and anything typed meanwhile triggers one more run. A failed save is not retried in a loop: the text stays in
// the field, the next keystroke/blur tries again, and leaving the page asks first (beforeunload below).
async function saveInputNow(){
 clearTimeout(inputTimer);inputTimer=null;
 if(storageBroken||bankBooting||inputSaving||($('input').value===inputSaved&&!journal))return;
 inputSaving=true;let failed=false;const context=activeContextId;
 try{await hostExclusive(()=>{if(context===activeContextId)flushInput();});}
 catch(e){failed=true;status('Nie zapisano niewysłanego tekstu: '+e.message+' Tekst pozostaje w polu.','error');}
 finally{inputSaving=false;}
 if(!failed&&$('input').value!==inputSaved)scheduleInputSave();
}
function scheduleInputSave(delay=0){clearTimeout(inputTimer);inputTimer=setTimeout(saveInputNow,delay);}
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
 const keep=!!options.keepInput&&$('input').value!==inputSaved;
 state=copy(env.state);workspaceMeta=meta;undo=Array.isArray(env.undo)?copy(env.undo.filter(safeState).slice(-8)):[];diffs=Array.isArray(env.diffs)?copy(env.diffs):[];
 activeContextId=entry.contextId;activeVersion=entry.version;inputSaved=entry.input;
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
  state=blank();undo=[];diffs=[];$('input').value='';inputSaved='';activeContextId=CBank.newId(crypto);activeVersion=0;
  workspaceMeta=jobId?JHSession.target(JHSession.bind(null,state,crypto,new Date().toISOString()),jobId):null;
  if(!persist())throw Error('Nie zapisano nowej rozmowy. Poprzednia pozostaje otwarta.');
 }catch(e){restoreContext(snap);throw e;}
 if(journal&&journal.contextId!==activeContextId)journal=null;
 if(audioSession)cancelAudio();contextGeneration++;++seq;releaseBusy();recoveryReset();
}

function safeState(s){return s&&s.version===1&&Array.isArray(s.items)&&s.items.length<=16&&Array.isArray(s.history)&&s.history.length<=40&&s.history.every(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string')&&s.items.every(i=>typeof i.id==='string'&&typeof i.name==='string'&&Array.isArray(i.review));}
function render(){
 $('count').textContent=state.items.length;const messages=$('messages');
 if(state.history.length){messages.replaceChildren();for(const m of state.history){const box=node('div',undefined,'message '+m.role);box.append(node('span',m.role==='user'?'TY':'EMPIRE · ONLINE','role'),node('div',m.content));messages.append(box);}}
 else{messages.replaceChildren();const w=node('div',undefined,'welcome');w.append(node('h2','Jedna rozmowa. Jedna lista.'),node('p','Opisz materiały po swojemu. Potem dopowiadaj i poprawiaj bez powtarzania całej listy.'));const e=node('button','Wstaw przykładową wypowiedź','example');e.id='example';e.type='button';e.onclick=example;w.append(e);messages.append(w);}
 const items=$('items');items.replaceChildren();if(!state.items.length)items.append(node('p','Tutaj pojawią się pozycje z rozmowy.','empty'));
 for(const item of state.items){const card=node('article',undefined,'item');card.dataset.itemId=item.id;const top=node('div',undefined,'item-main');top.append(node('span',item.name,'item-name'),node('span',item.quantity===null?'ilość ?':item.quantity+' '+(item.unit||'?'),'item-qty'));card.append(top);if(item.specification)card.append(node('p',item.specification,'spec'));if(item.notes)card.append(node('p',item.notes,'notes'));for(const r of item.review)card.append(node('p',r,'review'));
  const change=diffs.find(d=>d.after?.id===item.id);if(change){let text=change.op==='add'?'Nowa propozycja':change.before.quantity!==item.quantity?'Zmieniono ilość: '+(change.before.quantity??'?')+' → '+(item.quantity??'?'):'Zaktualizowano opis';card.append(node('p',text,'changed'));}items.append(card);}
 messages.scrollTop=messages.scrollHeight;controls();
}
function example(){if(busy||audioBusy||recording)return;$('input').value='Dodaj dwa breakery 20 amp firmy Zimens, dwa kable trzy zero czerwony i czarny, jakieś 50 fit, 15 bushingów plastikowych i dwa metalowe.';journalWrite();scheduleInputSave(0);$('input').focus();status('To tylko przykład w polu wiadomości. Naciśnij Wyślij, aby zapytać rzeczywisty model.');}
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
const API_CODES=/^(?:API_(?:AUTH|ACCESS|QUOTA|RATE_LIMIT|REQUEST|SERVICE|CONNECTION|FORMAT)|MODEL_UNAVAILABLE|AI_NOT_CONFIGURED|INVALID_ROUTE|CANCELLED|PROPOSAL_[A-Z]{1,12}|HISTORY_LIMIT|CONTEXT_LIMIT|OUTPUT_LIMIT|OUTPUT_JSON|AUDIO_(?:SIZE|TYPE|FORMAT)|DUPLICATE_REQUEST|BUSY|DAILY_LIMIT|BUDGET_UNAVAILABLE|REQUEST_FAILED|INTERNAL)$/;
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
 const my=++connectSeq;let next=null,text='',kind='error',login=false;
 try{
  const r=await fetch('/api/session',{cache:'no-store',redirect:'error'});
  if(r.status===401||r.status===403)throw Object.assign(Error('session '+r.status),{reauth:true});
  if(!r.ok)throw Error('session '+r.status);
  const s=await apiBody(r);
  if(s.online===true&&typeof s.token==='string'&&/^[0-9a-f]{64}$/.test(s.token)){next=s.token;kind='';text='OpenAI · '+(typeof s.model==='string'&&s.model?s.model:'model online')+' · polski + English · szkic do sprawdzenia';}
  else if(s.reason==='AI_NOT_CONFIGURED'){kind='';text='AI nie jest jeszcze podłączone na serwerze pilota — rozmowa i głos online są wyłączone. Lokalne Roboty, narzędzia, szkic i niewysłany tekst działają na tym urządzeniu.';}
  else text='Serwer nie udostępnił teraz rozmowy online. Lokalne Roboty, narzędzia, szkic i niewysłany tekst pozostają na tym urządzeniu.';
 }catch(e){
  // An interrupted request says nothing about the login: the token and the login link stay as they are.
  if(e&&e.name==='AbortError'){if(my===connectSeq){if(!token&&!storageBroken)status('Przerwano łączenie z rozmową online. Zapisane roboty, narzędzia i niewysłany tekst pozostają na tym urządzeniu.','error');controls();}return false;}
  login=!!(e&&(e.reauth||e.name==='TypeError'));
  text=navigator.onLine&&login?'Rozmowa online jest teraz niedostępna: brak połączenia z serwerem albo logowanie wygasło. Zapisane roboty, narzędzia i niewysłany tekst pozostają na tym urządzeniu i działają bez logowania. Do rozmowy online użyj „Zaloguj ponownie”.':'Rozmowa online jest teraz niedostępna. Zapisane roboty, narzędzia i niewysłany tekst pozostają na tym urządzeniu.';
 }
 if(my!==connectSeq)return false;
 token=next;relogin(login);if(!storageBroken)status(text,kind);controls();return !!next;
}
async function sendMessage(){
 if(busy||audioBusy||recording||storageBroken||bankBooting||JHSession.pending(workspaceMeta)||(typeof handoffBusy!=='undefined'&&handoffBusy)||!token)return;
 if(!navigator.onLine){status('Brak internetu. Szkic i niewysłany tekst są zachowane; nic nie zostanie wysłane automatycznie.','error');scheduleInputSave(0);return;}
 const text=$('input').value.trim();if(!text)return;
 // The response is accepted only for the same request, the same immutable context and the same context generation.
 const context=activeContextId,generation=contextGeneration,myseq=++seq,requestId=crypto.randomUUID(),used=token;
 const current=()=>myseq===seq&&context===activeContextId&&generation===contextGeneration;
 const blocked=()=>JHSession.pending(workspaceMeta)||!!(typeof handoffBusy!=='undefined'&&handoffBusy);
 const sourceStamp=()=>workspaceMeta?workspaceMeta.sourceId+':'+workspaceMeta.sourceRevision:'';
 busy=true;controller=new AbortController();controls();let pending=null,source='';
 try{
  // Save the text before any network use, so a failed or cancelled send keeps it. A failed save sends nothing.
  // bankSync runs even when the text is already saved: a conversation changed by another tab is never sent from here.
  await hostExclusive(()=>{
   if(!current())return;if(blocked())throw Error('Najpierw dokończ rozpoczęty zapis do roboty. Niczego nie wysłano.');
   flushInput();bankSync();source=sourceStamp();
  });if(!current())return;
  const before=copy(state),snapshot=JSON.stringify(state);
  status('Model porządkuje wypowiedź i uwzględnia wcześniejszą rozmowę…');pending=node('p','Rozumiem wypowiedź…','pending');$('messages').append(pending);pending.scrollIntoView({block:'nearest'});
  // Only the active context travels: its draft/history (`before`) and its text.
  const r=await fetch('/api/talk',{method:'POST',headers:{'Content-Type':'application/json','X-EC-Token':used,'X-EC-Request-Id':requestId},body:JSON.stringify({state:before,text,requestId}),signal:controller.signal,redirect:'error'}).catch(apiLost);
  const result=await apiBody(r);if(!current())return;
  if(!r.ok)throw apiError(r,result,'Brak odpowiedzi usługi AI.');
  relogin(false);
  if(result.requestId!==requestId||result.baseRevision!==before.revision||JSON.stringify(state)!==snapshot||!safeState(result.state))throw Error('Nieaktualna propozycja. Szkic nie został zmieniony.');
  await hostExclusive(()=>{
   // Every guard is evaluated again here, inside the lock, immediately before the response is applied.
   if(!current())return;bankSync();
   if(blocked())throw Error('W tej rozmowie rozpoczęto zapis do roboty. Odpowiedź modelu nie została zastosowana; szkic bez zmian.');
   if(sourceStamp()!==source||JSON.stringify(state)!==snapshot)throw Error('Nieaktualna propozycja. Szkic nie został zmieniony.');
   const saved=applyChange(()=>{undo.push(before);undo=undo.slice(-8);state=result.state;diffs=result.diffs;$('input').value='';});
   if(saved)status('Zaktualizowano roboczy szkic · '+(result.durationMs/1000).toFixed(1)+' s · sprawdź propozycję','success');
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
 finally{pending?.remove();if(myseq===seq){busy=false;controller=null;controls();$('input').focus();}}
}
$('composer').addEventListener('submit',e=>{e.preventDefault();sendMessage();});
$('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();sendMessage();}});
$('input').addEventListener('input',()=>{journalWrite();saveInputNow();});
$('input').addEventListener('blur',()=>{journalWrite();saveInputNow();});
const editBlocked=()=>storageBroken||bankBooting||busy||audioBusy||recording||JHSession.pending(workspaceMeta)||!!(typeof handoffBusy!=='undefined'&&handoffBusy);
// 'Nowa rozmowa' never deletes: the current conversation stays in the bank and in the conversation selector.
$('new').onclick=async()=>{
 if(storageBroken||bankBooting||busy||audioBusy||recording||JHSession.pending(workspaceMeta)||(typeof handoffBusy!=='undefined'&&handoffBusy))return;
 try{
  let created=false;
  await hostExclusive(()=>{if(editBlocked())throw Error('Najpierw dokończ bieżącą operację.');flushInput();bankSync();if(contextBlank())return;openNewContext(workspaceMeta?.targetJobId||null);created=true;if(typeof hostSelected!=='undefined'){hostSelected.clear();hostAcks.clear();}});
  render();status(created?'Nowa rozmowa. Poprzednia pozostaje zapisana i dostępna na liście rozmów.':'Ta rozmowa jest już pusta — możesz zacząć pisać.');
 }catch(e){status(e.message,'error');}
};
$('undo').onclick=async()=>{
 if(storageBroken||bankBooting||busy||JHSession.pending(workspaceMeta)||(typeof handoffBusy!=='undefined'&&handoffBusy)||!undo.length)return;
 try{await hostExclusive(()=>{if(editBlocked())throw Error('Najpierw dokończ bieżącą operację.');bankSync();if(!undo.length)return;const saved=applyChange(()=>{state=undo.pop();diffs=[];});render();if(saved)status('Cofnięto ostatnią propozycję modelu.');else status('Nie zapisano cofnięcia. Szkic pozostaje bez zmian.','error');});}catch(e){status(e.message,'error');}
};
$('copy').onclick=async()=>{const text=state.items.map(i=>(i.quantity??'?')+' '+(i.unit??'?')+' — '+i.name+(i.specification?' · '+i.specification:'')+(i.review.length?' [do sprawdzenia: '+i.review.join('; ')+']':'')).join('\n');try{await navigator.clipboard.writeText(text);status('Skopiowano szkic — to nie specyfikacja zatwierdzona.');}catch{status('Nie udało się skopiować. Użyj eksportu szkicu.','error');}};
// Normal export: the active conversation. When storage could not be read: the raw stored bytes, untouched, for recovery.
$('export').onclick=()=>{
 const readRaw=key=>{try{return localStorage.getItem(key);}catch{return null;}},exportedAt=new Date().toISOString();
 const payload=storageBroken
  ?{kind:'empire-code.storage-recovery',version:1,exportedAt,note:'Surowe zapisy przeglądarki. Niczego nie zmieniono ani nie usunięto.',bankKey:KEY,bankRaw:readRaw(KEY),legacyKey:LEGACY_KEY,legacyRaw:readRaw(LEGACY_KEY),screen:{state,workspace:workspaceMeta,unsentText:$('input').value},unsentRecovery:journalExport(true)}
  :{kind:'empire-code.conversation-draft',version:1,exportedAt,model:'OpenAI online prototype',contextId:activeContextId,state,workspace:workspaceMeta,unsentText:$('input').value,unsentRecovery:journalExport(false)};
 download(payload,storageBroken?'EmpireCode-odzyskiwanie-zapisu.json':'EmpireCode-rozmowa-szkic.json');
};
function download(payload,name){const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
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
 clearTimeout(s.timer);s.timer=null;clearTimeout(s.deadline);s.deadline=null;s.chunks.length=0;s.bytes=0;const own=s.stream;s.stream=null;if(!own)return;
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
 s.stopping=true;clearTimeout(s.timer);recording=false;audioBusy=true;s.timer=setTimeout(()=>{if(!audioMine(s)||s.submitted)return;cancelAudio();status(AUDIO_STOP_FAILED,'error');},AUDIO_STOP_MS);controls();
 try{if(s.recorder.state!=='inactive')s.recorder.stop();}catch{if(audioMine(s)&&!s.submitted){cancelAudio();status(AUDIO_STOP_FAILED,'error');}}
}
// The stop event of a session: the only place a recording is posted, and at most once per session.
async function audioFinish(s){
 if(!audioMine(s)||s.submitted)return;s.submitted=true;
 const parts=s.chunks.splice(0),type=s.recorder&&typeof s.recorder.mimeType==='string'&&s.recorder.mimeType||'audio/webm',field=s.field,used=token;
 audioInert(s);audioRelease(s);recording=false;audioBusy=true;controls();
 if(!used||!navigator.onLine){audioEnd(s);status((navigator.onLine?'Brak aktywnej sesji.':'Brak połączenia z internetem.')+' Nagranie nie zostało przetranskrybowane, nie jest zapisane i nie zostanie automatycznie wysłane ponownie.','error');relogin(!used&&navigator.onLine);return;}
 status('Transkrypcja online · polski + English…');let handed=false;
 try{
  const blob=new Blob(parts,{type});parts.length=0;if(blob.size<128||blob.size>AUDIO_MAX_BYTES)throw voiceError('Nagranie jest puste lub zbyt duże. Nie wysłano go.');
  const id=crypto.randomUUID();s.abort=new AbortController();const ctl=s.abort;s.deadline=setTimeout(()=>{if(s!==audioSession||s.abort!==ctl)return;s.timedOut=true;try{ctl.abort();}catch{}},AUDIO_REQUEST_MS);
  if(!audioMine(s))return;
  const response=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':type,'X-EC-Token':used,'X-EC-Request-Id':id},body:blob,signal:s.abort.signal,redirect:'error'}).catch(apiLost);
  const result=await apiBody(response);
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
  if(seq===sent&&navigator.onLine)status('Transkrypcja jest w polu wiadomości, ale nie została wysłana do modelu. Sprawdź tekst i naciśnij Wyślij.','error');
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
 finally{audioEnd(s);}
}
$('cancel').onclick=()=>{++seq;controller?.abort();controller=null;busy=false;cancelAudio();document.querySelector('.pending')?.remove();status('Anulowano. Roboczy szkic bez zmian; tekst pozostaje w polu.');controls();};
$('mic').onclick=async()=>{
 if(recording){audioStop(audioSession);return;}if(busy||audioBusy||audioSession||storageBroken||bankBooting||JHSession.pending(workspaceMeta)||(typeof handoffBusy!=='undefined'&&handoffBusy)||!token||!navigator.onLine)return;
 if($('input').value.trim()){status('Wyślij lub usuń bieżący tekst przed nowym nagraniem.','error');return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status('Mikrofon nie jest dostępny w tej przeglądarce. Nadal możesz pisać.','error');return;}
 const s={id:++audioSeq,context:activeContextId,generation:contextGeneration,field:$('input').value,stream:null,recorder:null,timer:null,chunks:[],bytes:0,abort:null,deadline:null,timedOut:false,stopping:false,submitted:false};
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
 ++seq;controller?.abort();busy=false;cancelAudio();status('Ta rozmowa zmieniła się w innej karcie. Niczego nie nadpisano; niewysłany tekst pozostaje w polu.','error');
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
 const raw=localStorage.getItem(KEY);let fresh=raw===null?CBank.empty():CBank.parse(raw),version=raw,imported=null;
 legacyNotice='';
 if(legacyRaw!==null){
  if(fresh.legacy===null){
   try{
    if(!digest)throw Error('nie udało się obliczyć skrótu starszego zapisu');
    const contextId=CBank.newId(crypto),next=CBank.migrate(legacyRaw,{contextId,now:new Date().toISOString(),validate:legacyCheck,sha256:digest,bank:fresh});
    // The import may only ADD the legacy conversation and its record: every stored conversation must come back unchanged.
    if(!next.legacy||next.legacy.sha256!==digest||next.legacy.contextId!==contextId||!CBank.get(next,contextId)||fresh.contexts.some(e=>JSON.stringify(CBank.get(next,e.contextId))!==JSON.stringify(e)))throw Error('import nie zachował zapisanych rozmów lub skrótu');
    version=CBank.store(localStorage,KEY,next,raw);fresh=next;imported=contextId;
   }catch(e){legacyNotice='Starszy szkic nie został zaimportowany ('+(e&&e.message||'błąd')+'). Pozostaje nienaruszony w przeglądarce; zapisane rozmowy działają dalej.';}
  }else if(!digest)legacyNotice='Nie udało się sprawdzić, czy stary szkic zmienił się po imporcie. Pozostaje nienaruszony w przeglądarce.';
  else if(fresh.legacy.sha256!==digest)legacyNotice=LEGACY_CHANGED;
 }
 bank=fresh;storageVersion=version;
 const entry=(imported&&CBank.get(bank,imported))||initialEntry();
 if(entry){activateEntry(entry);return;}
 // No conversation yet: create and store an empty one now, so a journal record never points to an unknown conversation.
 state=blank();undo=[];diffs=[];workspaceMeta=null;$('input').value='';inputSaved='';activeContextId=CBank.newId(crypto);activeVersion=0;
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
 try{const raw=localStorage.getItem(KEY);if(raw!==null){bank=CBank.parse(raw);storageVersion=raw;const entry=initialEntry();if(entry)activateEntry(entry);}}
 catch(e){bootFailed(e);return;}
 bootLocked().then(()=>{bankBooting=false;render();recoveryRefresh();},e=>{bootFailed(e);render();});
}
boot();render();connect();

window.addEventListener('offline',()=>{++seq;controller?.abort();controller=null;busy=false;cancelAudio();document.querySelector('.pending')?.remove();relogin(false);status('Brak internetu. Szkic, niewysłany tekst i eksport działają; niczego nie wysłano ponownie.','error');controls();});
window.addEventListener('online',()=>connect());
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
