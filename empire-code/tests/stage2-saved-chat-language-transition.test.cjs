'use strict';
// EC-ENGLISH-CHAT-1 — a chat saved before the English UI is reopened and sent with the new default request language.
// The stored chat carries a Polish-era history and an unsent Polish text. The browser bank stores no language field: the
// language exists only in the request (assistant.lang) and in the answer's echo, which assistant-session.js compares with the
// request that was just sent (a.lang!==s.lang). So the reopened chat must send lang 'en' with its old content untouched, an
// answer echoing 'en' must be accepted into the SAME chat, and an answer echoing another language must still be refused.
// The stored layout is written by the page's own storage code (unchanged schema), not copied from an archived pilot-7 file.
// Page scripts run in the shared VM harness; fixture server, no network, no provider. Authored, not executed by the author.
// Run: node --test tests/stage2-saved-chat-language-transition.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./stage2-harness.cjs');
const {ids}=H;
const TOKEN='cd'.repeat(32);
const DRAFT='dodaj jeszcze dwie puszki 4 cale i żółtą taśmę — nie wysyłać przed sprawdzeniem';
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const own=x=>JSON.parse(JSON.stringify(x));
const sessionBody=()=>({build:'PRIVATE-PILOT-8',model:'model-x',speechModel:'speech-x',online:true,prototype:true,remainingRequests:60,token:TOKEN,reason:null});
const until=async(check,ms=3000)=>{const end=Date.now()+ms;for(;;){if(check())return;if(Date.now()>end)throw Error('condition not reached');await H.settle(2);}};
const idle=p=>until(()=>!p.run('busy')&&!p.run('audioBusy')&&!p.run('handoffBusy'));
// Fixture server: one answer function per accepted /api/assist request; every request body is kept in `seen`.
function server(script,seen){
 return (url,init)=>{
  if(url==='/api/session')return json(sessionBody());
  if(url!=='/api/assist')throw Error('unexpected request '+url);
  const body=JSON.parse(init.body);seen.push(body);
  const next=script.shift();if(!next)throw Error('unexpected extra /api/assist request');
  return next(body);
 };
}
// A chat as an earlier session left it: two items, two Polish exchanges, and a Polish text typed but never sent. The first
// page has no conversation server (nothing can be sent); it only stores the unsent text the way a user's typing does.
async function savedEarlier(){
 const local=H.storage(),session=H.storage(),state=H.filledState(2,2);
 local.setItem(H.KEY,H.bankV1([H.entry(1,{state:own(state)})]));
 const old=await H.load({local,session});
 assert.equal(old.active(),ids.ctx(1),'the stored chat is the open one');
 await old.type(DRAFT);
 const stored=old.bank().contexts;
 assert.equal(stored.length,1);assert.equal(stored[0].contextId,ids.ctx(1));assert.equal(stored[0].input,DRAFT,'the unsent Polish text is stored');
 assert.deepEqual(own(stored[0].envelope.state),state,'the Polish-era draft and history are stored unchanged');
 assert.equal(old.calls.filter(c=>c.url==='/api/assist').length,0,'nothing was sent by the earlier session');
 return {local,session,state,entry:own(stored[0])};
}
const reopened=(saved,script,seen)=>H.load({local:saved.local,session:saved.session,api:server(script,seen)});
function assertRestored(p,saved){
 assert.equal(p.active(),ids.ctx(1),'the same chat is open after the reload');
 assert.equal(p.els.input.value,DRAFT,'the unsent Polish text is back in the field, exactly');
 assert.equal(p.run('JSON.stringify(state)'),JSON.stringify(saved.state),'old history and items are restored unchanged');
 assert.equal(p.bank().contexts.length,1,'opening wrote no second chat');
}

test('reopened Polish-era chat: the unsent text is sent once with lang en, and the en answer lands in the same chat',async()=>{
 const saved=await savedEarlier(),seen=[];
 const p=await reopened(saved,[body=>json(H.assistAnswer(body,{reply:'Added.'}))],seen);
 assertRestored(p,saved);
 assert.equal(p.els.send.disabled,false,'the reopened chat can send');
 await p.submit();await idle(p);
 // the request: new default language, old content byte-for-byte
 assert.equal(seen.length,1,'exactly one request');
 const sent=seen[0];
 assert.equal(sent.assistant.lang,'en','the default request language of the English UI');
 assert.equal(sent.text,DRAFT,'the Polish text is sent as typed, not translated or trimmed');
 assert.deepEqual(sent.state,saved.state,'the Polish-era history and items go out unchanged');
 assert.equal(sent.assistant.job,null,'no job was attached to a chat that had none');
 // the answer was accepted, not refused because the chat predates the language change
 assert.notEqual(p.els.status.className,'error',p.els.status.textContent);
 const now=JSON.parse(p.run('JSON.stringify(state)')),before=saved.state.history.length;
 assert.equal(now.revision,saved.state.revision+1);assert.equal(now.history.length,before+2);
 assert.deepEqual(now.history.slice(0,before),saved.state.history,'earlier Polish messages are kept as they were');
 assert.deepEqual(now.history.slice(before),[{role:'user',content:DRAFT},{role:'assistant',content:'Added.'}]);
 assert.deepEqual(now.items,saved.state.items,'items untouched by this answer');
 // one chat, the same identity, no duplicate or foreign context
 const bank=p.bank().contexts;
 assert.equal(bank.length,1,'no second chat was written');assert.equal(bank[0].contextId,saved.entry.contextId);assert.equal(bank[0].jobId,saved.entry.jobId);
 assert.equal(p.active(),ids.ctx(1));
 assert.deepEqual(own(bank[0].envelope.state),now,'the accepted exchange is what is stored');
 assert.ok(bank[0].version>saved.entry.version,'the stored chat moved forward, it was not replaced');
 assert.equal(bank[0].input,'','the sent text is no longer an unsent text');assert.equal(p.els.input.value,'');
 assert.equal(seen.length,1,'no repeated request');
});

test('reopened Polish-era chat: an answer whose language differs from the request is still refused and loses nothing',async()=>{
 const saved=await savedEarlier(),seen=[];
 const p=await reopened(saved,[body=>json(H.assistAnswer(body,{reply:'Dodano.',assistant:{lang:'pl'}}))],seen);
 assertRestored(p,saved);
 await p.submit();await idle(p);
 assert.equal(seen.length,1);assert.equal(seen[0].assistant.lang,'en');assert.equal(seen[0].text,DRAFT);
 assert.equal(p.els.status.className,'error','a language echo that does not match the request is not accepted');
 assert.equal(p.run('JSON.stringify(state)'),JSON.stringify(saved.state),'draft and history unchanged');
 assert.equal(p.els.input.value,DRAFT,'the text is still in the field');
 const bank=p.bank().contexts;
 assert.equal(bank.length,1);assert.equal(bank[0].contextId,saved.entry.contextId);
 assert.deepEqual(own(bank[0].envelope.state),saved.state,'nothing of the refused answer was stored');
 assert.equal(bank[0].input,DRAFT,'the unsent text is still stored with its chat');
 assert.equal(seen.length,1,'no automatic second request');
});
