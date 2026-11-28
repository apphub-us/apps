'use strict';
// Visible limits (EC-07): the request budget of GET /api/session shown before sending, an exhausted or insufficient budget, a
// conversation at its history limit, and the clock of a recording against the existing 29 s stop.
// The real page scripts run in an isolated VM (tests/stage2-harness.cjs) against a fixture server that follows the real
// contract; no network, no microphone, no real browser. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./stage2-harness.cjs');
const {KEY,entry,bankV1,filledState}=H;
const TOKEN='ab'.repeat(32);
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
// The session answer with exactly the fields the server sends (worker.mjs session()); there is no reset time among them.
const sessionBody=remainingRequests=>({build:'PRIVATE-PILOT-4',model:'model-x',speechModel:'speech-x',online:true,prototype:true,remainingRequests,token:TOKEN,reason:null});
const DAILY_LIMIT=()=>json({error:'The daily pilot limit of 60 requests was reached. The draft is unchanged; the limit renews at midnight UTC.',code:'DAILY_LIMIT'},429);
// Fixture server. Sessions are answered in order (the last one repeats). An accepted talk request returns the draft with one more
// exchange; an accepted recording returns a transcript. o.talk / o.transcribe replace those answers.
function server(sessions,o={}){
 let n=0;
 return (url,init)=>{
  if(url==='/api/session')return json(sessions[Math.min(n++,sessions.length-1)]);
  const id=init.headers['X-EC-Request-Id'];
  if(url==='/api/assist'){
   if(o.talk)return o.talk(init);
   const body=JSON.parse(init.body),state=JSON.parse(JSON.stringify(body.state));
   state.revision++;state.history.push({role:'user',content:body.text},{role:'assistant',content:'Zapisano.'});
   return json(H.assistAnswer(body,{state,reply:'Zapisano.',durationMs:900}));
  }
  if(url==='/api/transcribe')return o.transcribe?o.transcribe(init):json({text:'dwa breakery 20 amp',requestId:id});
  throw Error('unexpected request '+url);
 };
}
const VOICE_MS=[1000,29000,5000,95000]; // clock tick, recording limit, stop watchdog, transcription watchdog
const voiceTimers=timers=>timers.filter(t=>VOICE_MS.includes(t.ms));
const pendingVoice=timers=>voiceTimers(timers).filter(t=>!t.fired&&!t.cleared).map(t=>t.ms);
const limits=p=>p.els.limits.textContent;
// Presses Mów the way the button does, also when it is disabled: the handler has its own guards.
const pressMic=async p=>{await p.els.mic.onclick();await H.settle();};
const urls=p=>p.calls.map(c=>c.url);

test('known budget: the remaining requests are shown before sending and one typed message costs one',async()=>{
 const p=await H.load({api:server([sessionBody(60)]),media:true});
 assert.equal(p.run('token'),TOKEN);
 assert.equal(p.els.send.disabled,false);assert.equal(p.els.mic.disabled,false);
 assert.equal(p.els.limits.hidden,false);assert.match(limits(p),/Pilot requests remaining: 60/);assert.match(limits(p),/typed message = 1, voice message = 2/);
 assert.equal(p.els['limits-refresh'].hidden,true,'nothing to re-read while the budget is ample');
 await p.type('dodaj dwa breakery 20 amp');await p.submit();
 assert.equal(p.count('/api/assist'),1);assert.equal(p.run('state.history.length'),2);assert.equal(p.els.input.value,'');
 assert.match(limits(p),/Pilot requests remaining: 59/);assert.match(limits(p),/Exchanges in this chat: 1 of 18/);
 assert.equal(p.count('/api/session'),1,'the budget is not polled');
});

test('budget 0: explicit message, Send and Speak disabled, text and local tools kept; an explicit re-read restores sending',async()=>{
 const p=await H.load({api:server([sessionBody(0),sessionBody(5)]),media:true});
 assert.equal(p.run('token'),TOKEN,'the session itself is valid');
 assert.equal(p.els.send.disabled,true);assert.equal(p.els.mic.disabled,true);assert.equal(p.els.input.disabled,false);
 assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/daily pilot request limit is used up/);
 assert.match(limits(p),/daily pilot request limit is used up/);assert.match(limits(p),/does not know when it renews/);
 assert.ok(!/\d{1,2}:\d{2}/.test(limits(p)+p.els.status.textContent),'no reset time is invented');
 await p.type('tekst na później');
 await p.submit();await pressMic(p);
 assert.deepEqual(urls(p),['/api/session'],'nothing was sent');assert.equal(p.media.requests,0,'the microphone was not asked for');
 assert.equal(p.els.input.value,'tekst na później');assert.equal(p.bank().contexts[0].input,'tekst na później');
 assert.match(p.els.status.textContent,/daily pilot request limit is used up/);
 // local tools keep working: export of the unsent text, a new conversation
 assert.equal(p.els.export.disabled,false);await p.click('export');
 assert.equal(JSON.parse(p.downloads[0]).unsentText,'tekst na później');
 assert.equal(p.els.new.disabled,false);
 // the way back is an explicit click, one session request
 assert.equal(p.els['limits-refresh'].hidden,false);
 await p.click('limits-refresh');
 assert.equal(p.count('/api/session'),2);assert.match(limits(p),/Pilot requests remaining: 5/);
 assert.equal(p.els.send.disabled,false);assert.equal(p.els.mic.disabled,false);assert.equal(p.els.input.value,'tekst na później');
});

test('budget 1: a typed message can still be sent; a recording cannot start because its transcript could not be interpreted',async()=>{
 const p=await H.load({api:server([sessionBody(1)]),media:true});
 assert.equal(p.els.send.disabled,false);assert.equal(p.els.mic.disabled,true);
 assert.match(limits(p),/Pilot requests remaining: 1/);assert.match(limits(p),/needs 2 requests/);assert.match(limits(p),/at most 1 is certain/);assert.match(limits(p),/A typed message can still be sent/);
 await pressMic(p);
 assert.equal(p.media.requests,0);assert.equal(p.count('/api/transcribe'),0);assert.equal(p.run('recording'),false);
 assert.match(p.els.status.textContent,/needs 2 requests/);
 await p.type('jeden kabel 50 ft');await p.submit();
 assert.equal(p.count('/api/assist'),1);assert.equal(p.run('state.history.length'),2);
 assert.equal(p.run('budgetLeft'),0);assert.equal(p.els.send.disabled,true);assert.equal(p.els.mic.disabled,true);assert.match(limits(p),/daily pilot request limit is used up/);
 await p.type('następna wiadomość');await p.submit();
 assert.equal(p.count('/api/assist'),1,'the exhausted budget sends nothing more');assert.equal(p.els.input.value,'następna wiadomość');
});

test('budget 2: one spoken message uses both requests — transcription, then the model',async()=>{
 const timers=[],p=await H.load({api:server([sessionBody(2)]),media:true,timers});
 assert.equal(p.els.mic.disabled,false);
 await pressMic(p);assert.equal(p.run('recording'),true);assert.equal(p.media.requests,1);
 assert.equal(p.els.mic.disabled,false,'Stop stays available');
 await pressMic(p);await p.media.recorders[0].finish();await H.settle();
 assert.deepEqual(urls(p),['/api/session','/api/transcribe','/api/assist']);
 assert.equal(p.run('state.history.length'),2);assert.equal(p.run('budgetLeft'),0);
 assert.equal(p.els.send.disabled,true);assert.equal(p.els.mic.disabled,true);
 assert.deepEqual(pendingVoice(timers),[]);assert.equal(p.media.tracks[0].stops,1);
});

test('unknown budget: a missing or malformed number is never shown as 0 and blocks nothing; the server refusal is then authoritative',async()=>{
 const bodies=[['missing',(()=>{const b=sessionBody(0);delete b.remainingRequests;return b;})()],['negative',sessionBody(-1)],['text',sessionBody('5')],['fraction',sessionBody(2.5)],['null',sessionBody(null)]];
 for(const [label,body] of bodies){
  const p=await H.load({api:server([body]),media:true});
  assert.equal(p.run('budgetLeft'),null,label);
  assert.equal(p.els.send.disabled,false,label);assert.equal(p.els.mic.disabled,false,label);
  assert.match(limits(p),/did not report the number of remaining requests/,label);assert.ok(!/used up|Pilot requests remaining: 0/.test(limits(p)+p.els.status.textContent),label);
  assert.equal(p.els['limits-refresh'].hidden,true,label);
 }
 // the working flow goes on, and nothing is counted or guessed without a number from the server
 let refuse=false;
 const api=server([bodies[0][1]]);
 const q=await H.load({api:(url,init)=>url==='/api/assist'&&refuse?DAILY_LIMIT():api(url,init)});
 await q.type('pierwsza wiadomość');await q.submit();
 assert.equal(q.count('/api/assist'),1);assert.equal(q.run('state.history.length'),2);assert.equal(q.run('budgetLeft'),null);assert.equal(q.els.send.disabled,false);
 // the server reports the daily limit: only now is the budget known to be 0
 refuse=true;
 await q.type('druga wiadomość');await q.submit();
 assert.equal(q.count('/api/assist'),2);assert.equal(q.els.status.className,'error');assert.match(q.els.status.textContent,/daily pilot limit of 60 requests/);
 assert.equal(q.els.input.value,'druga wiadomość','the refused text stays in the field');assert.equal(q.run('state.history.length'),2);
 assert.equal(q.run('budgetLeft'),0);assert.equal(q.els.send.disabled,true);assert.match(limits(q),/daily pilot request limit is used up/);
});

test('an answer without a session carries no budget: its 0 is not presented as an exhausted limit',async()=>{
 const p=await H.load({api:()=>json({build:'PRIVATE-PILOT-4',model:'model-x',speechModel:'speech-x',online:false,prototype:true,remainingRequests:0,token:null,reason:'BUDGET_UNAVAILABLE'})});
 assert.equal(p.run('token'),null);assert.equal(p.run('budgetLeft'),null);
 assert.equal(p.els.send.disabled,true,'no session, so nothing can be sent');assert.equal(p.els.input.disabled,false);
 assert.ok(!/used up|Pilot requests remaining/.test(limits(p)+p.els.status.textContent));
 assert.equal(p.els['limits-refresh'].hidden,true);
});

test('history limit: at 18 complete exchanges nothing is sent, no microphone is acquired and no transcription is dispatched',async()=>{
 const local=H.storage();local.setItem(KEY,bankV1([entry(1,{state:filledState(1,18)})]));
 const p=await H.load({local,api:server([sessionBody(60)]),media:true});
 assert.equal(p.run('state.history.length'),36);
 assert.equal(p.els.send.disabled,true);assert.equal(p.els.mic.disabled,true);assert.equal(p.els.input.disabled,false);
 assert.match(limits(p),/limit of 18 exchanges/);assert.match(limits(p),/New chat/);
 await pressMic(p);
 assert.equal(p.media.requests,0,'the microphone is not asked for');assert.equal(p.media.recorders.length,0);assert.equal(p.run('recording'),false);
 assert.match(p.els.status.textContent,/limit of 18 exchanges/);
 await p.type('jeszcze jedna pozycja');await p.submit();
 assert.deepEqual(urls(p),['/api/session']);
 assert.equal(p.els.input.value,'jeszcze jedna pozycja');assert.equal(p.bank().contexts[0].input,'jeszcze jedna pozycja');
 assert.equal(p.els.export.disabled,false);assert.equal(p.els.new.disabled,false);
 // the way out named in the message
 await p.click('new');
 assert.equal(p.run('state.history.length'),0);assert.equal(p.els.send.disabled,false);assert.equal(p.els.mic.disabled,false);
 assert.equal(p.bank().contexts.find(e=>e.contextId===H.ids.ctx(1)).input,'jeszcze jedna pozycja','the full conversation keeps its text');
});

test('history limit: 17 exchanges still accept one more message; the 18th closes the conversation for sending',async()=>{
 const local=H.storage();local.setItem(KEY,bankV1([entry(1,{state:filledState(1,17)})]));
 const p=await H.load({local,api:server([sessionBody(60)]),media:true});
 assert.equal(p.els.send.disabled,false);assert.equal(p.els.mic.disabled,false);assert.match(limits(p),/Exchanges in this chat: 17 of 18/);
 await p.type('osiemnasta');await p.submit();
 assert.equal(p.count('/api/assist'),1);assert.equal(p.run('state.history.length'),36);
 assert.equal(p.els.send.disabled,true);assert.equal(p.els.mic.disabled,true);assert.match(limits(p),/limit of 18 exchanges/);
});

test('limits are checked again before a finished recording leaves the device',async()=>{
 const timers=[],p=await H.load({api:server([sessionBody(2)]),media:true,timers});
 await pressMic(p);assert.equal(p.run('recording'),true);
 p.run('budgetLeft=1');                                                     // a newer reading arrived while recording
 await pressMic(p);await p.media.recorders[0].finish();await H.settle();
 assert.equal(p.count('/api/transcribe'),0);assert.equal(p.count('/api/assist'),0);
 assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/The recording was not sent for transcription/);
 assert.equal(p.run('audioBusy'),false);assert.equal(p.media.tracks[0].stops,1);assert.deepEqual(pendingVoice(timers),[]);
});

test('recording clock: elapsed and remaining seconds against the 29 s limit; Cancel clears the clock and every timer',async()=>{
 const timers=[],p=await H.load({api:server([sessionBody(60)]),media:true,timers}),clock=p.els['rec-time'];
 const at=ms=>p.run('Date.now=()=>'+(5000000+ms));
 const tick=async ms=>{at(ms);const due=timers.filter(t=>t.ms===1000&&!t.fired&&!t.cleared);assert.equal(due.length,1,'exactly one clock tick is pending');await p.runTimer(due[0]);};
 at(0);
 assert.equal(clock.hidden,true);
 await pressMic(p);
 assert.equal(p.run('recording'),true);assert.equal(clock.hidden,false);
 assert.match(clock.textContent,/Recording: 0 s of 29 s · 29 s left/);
 assert.equal(timers.filter(t=>t.ms===29000).length,1,'the existing stop timer is the only limit');
 await tick(7300);assert.match(clock.textContent,/Recording: 7 s of 29 s · 22 s left/);
 await tick(25000);assert.match(clock.textContent,/Recording: 25 s of 29 s · 4 s left/);
 assert.match(p.els.status.textContent,/Recording time left: 4 s/,'one notice near the end');
 const stale=timers.filter(t=>t.ms===1000).pop();
 await p.click('cancel');
 assert.equal(p.run('recording'),false);assert.equal(clock.hidden,true);assert.equal(clock.textContent,'');
 assert.deepEqual(pendingVoice(timers),[]);assert.equal(p.media.tracks[0].stops,1);assert.equal(p.count('/api/transcribe'),0);
 // a tick of the cancelled recording that still arrives writes nothing, also into the clock of the next recording
 at(40000);await pressMic(p);
 assert.match(clock.textContent,/Recording: 0 s of 29 s/);
 at(90000);stale.cleared=false;stale.fired=false;await stale.fn();
 assert.match(clock.textContent,/Recording: 0 s of 29 s/,'the old session did not touch the new clock');
 await p.click('cancel');assert.deepEqual(pendingVoice(timers),[]);
});

test('recording clock: the 29 s stop ends the recording by itself, the clock disappears and the recording is sent once',async()=>{
 const timers=[],p=await H.load({api:server([sessionBody(60)]),media:true,timers}),clock=p.els['rec-time'];
 p.run('Date.now=()=>7000000');
 await pressMic(p);
 const stop=timers.find(t=>t.ms===29000);assert.ok(stop);
 p.run('Date.now=()=>7029000');await p.runTimer(stop);
 assert.equal(p.run('recording'),false);assert.equal(p.media.recorders[0].state,'inactive');assert.equal(clock.hidden,true);
 assert.deepEqual(timers.filter(t=>t.ms===1000&&!t.fired&&!t.cleared),[],'no clock tick outlives the recording');
 await p.media.recorders[0].finish();await H.settle();
 assert.equal(p.count('/api/transcribe'),1);assert.equal(p.count('/api/assist'),1);assert.equal(p.run('state.history.length'),2);
 assert.deepEqual(pendingVoice(timers),[]);assert.match(limits(p),/Pilot requests remaining: 58/);
});

test('recording errors leave no clock and no timer: refused microphone, recorder fault, failed transcription',async()=>{
 // the microphone is refused: nothing starts
 let timers=[],p=await H.load({api:server([sessionBody(60)]),media:true,timers});
 p.media.deny='NotAllowedError';await pressMic(p);
 assert.equal(p.run('recording'),false);assert.equal(p.els['rec-time'].hidden,true);assert.deepEqual(voiceTimers(timers),[]);
 assert.equal(p.els.status.className,'error');assert.equal(p.els.mic.disabled,false);
 // the recorder reports a fault while recording
 timers=[];p=await H.load({api:server([sessionBody(60)]),media:true,timers});
 await pressMic(p);assert.equal(p.els['rec-time'].hidden,false);
 p.media.recorders[0].onerror();await H.settle();
 assert.equal(p.run('recording'),false);assert.equal(p.els['rec-time'].hidden,true);assert.equal(p.els['rec-time'].textContent,'');
 assert.deepEqual(pendingVoice(timers),[]);assert.equal(p.media.tracks[0].stops,1);assert.equal(p.count('/api/transcribe'),0);
 // the transcription fails after it was dispatched: the attempt may have been counted, which is said, and voice waits for a re-read
 timers=[];p=await H.load({api:server([sessionBody(2)],{transcribe:()=>json({error:'The AI service is temporarily unavailable.',code:'API_SERVICE'},503)}),media:true,timers});
 await pressMic(p);await pressMic(p);await p.media.recorders[0].finish();await H.settle();
 assert.equal(p.count('/api/transcribe'),1);assert.equal(p.count('/api/assist'),0);assert.equal(p.els.status.className,'error');
 assert.deepEqual(pendingVoice(timers),[]);assert.equal(p.els['rec-time'].hidden,true);
 assert.match(limits(p),/Pilot requests remaining: 2/);assert.match(limits(p),/there may be 1 fewer/);
 assert.equal(p.els.mic.disabled,true,'two certain requests are no longer available');assert.equal(p.els.send.disabled,false);
 assert.equal(p.els['limits-refresh'].hidden,false);
});
