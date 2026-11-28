'use strict';
// EC-ENGLISH-CHAT-1: the New chat action (#new) answers every press visibly. The real page scripts run in the stage2 VM
// harness on fixture data only: no network, no real browser, no owner storage.
//  #new-status  the answer to a press (pending, then the outcome); the live region next to the button.
//  #new-reason  why the button is disabled right now; the button's description, not a live region.
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./stage2-harness.cjs');
const note=p=>p.els['new-status'],reason=p=>p.els['new-reason'];
// Counts every assignment of an element's text from now on (the harness element keeps its text in a plain property). An
// assignment is what a live region announces and what a layout reacts to, so "nothing was written" is checked on this count.
function countWrites(el){let text=el.textContent,n=0;Object.defineProperty(el,'textContent',{configurable:true,enumerable:true,get:()=>text,set(v){n++;text=String(v);}});return ()=>n;}
// Holds the conversation lock the way another tab would: every request of the page waits, in order, until release().
function holdLock(p){const locks=p.navigator.locks,was=locks.request;let open;const held=new Promise(r=>{open=r;});locks.request=(name,opts,fn)=>held.then(()=>fn());return ()=>{locks.request=was;open();};}

test('markup: the outcome is a live status in a reserved block after the button row, the reason is not live, both describe the button, and the page is English',()=>{
 const html=H.read('index.html'),css=H.read('style.css');
 assert.match(html,/<html lang="en">/);
 assert.match(html,/<button id="new" class="quiet" type="button" aria-describedby="new-reason new-status">New chat<\/button><\/div><div class="new-feedback"><p id="new-status" class="new-status" role="status" aria-live="polite"><\/p><p id="new-reason" class="new-status blocked"><\/p><\/div>/);
 // Exactly one of each; neither starts hidden (the block is reserved), and the reason carries no live-region attribute.
 assert.equal(html.split('id="new-status"').length,2);assert.equal(html.split('id="new-reason"').length,2);
 // The block reserves its height (a minimum, never a fixed height or a clip), also in the narrow layout.
 const base=css.match(/\n\.new-feedback\{([^}]*)\}/),narrow=css.slice(css.indexOf('@media(max-width:760px)'));
 assert.ok(base);assert.match(base[1],/min-height:1\.5em/);assert.doesNotMatch(base[1],/(?:^|;)(?:height|max-height|overflow):/);
 assert.match(narrow,/\n\.new-feedback\{min-height:3em\}/);
 const line=css.match(/\n\.new-status\{([^}]*)\}/);
 assert.ok(line);assert.match(line[1],/overflow-wrap:anywhere/);assert.doesNotMatch(line[1],/(?:^|;)(?:height|max-height|overflow|white-space|text-overflow):/);
});

test('empty chat: it is reused without any write, the press is answered next to the button and the composer is focused',async()=>{
 const p=await H.load({host:false});
 const before=p.local.getItem(H.KEY),writes=p.local.writes,active=p.active(),focused=p.els.input.focused;
 await p.click('new');
 assert.equal(p.local.getItem(H.KEY),before);assert.equal(p.local.writes,writes);assert.equal(p.active(),active);
 assert.match(note(p).textContent,/already empty/);assert.match(note(p).className,/success/);assert.equal(reason(p).textContent,'');
 assert.match(p.els.status.textContent,/already empty/);assert.equal(p.els.input.focused,focused+1);
 // A session or connection status written afterwards replaces only #status, never the note next to the button.
 p.run("status('OpenAI · fixture')");
 assert.match(note(p).textContent,/already empty/);
 // A repeated press is answered again and still writes nothing.
 await p.click('new');
 assert.equal(p.local.getItem(H.KEY),before);assert.equal(p.local.writes,writes);assert.equal(p.bank().contexts.length,1);assert.equal(p.active(),active);
 assert.match(note(p).textContent,/already empty/);assert.equal(p.els.input.focused,focused+2);
});

test('unsent text, even whitespace only: exactly one new chat, and the chat that is left keeps the text as typed',async()=>{
 const p=await H.load({host:false});const old=p.active();
 await p.type('   ');await p.click('new');
 const b=p.bank();
 assert.equal(b.contexts.length,2);assert.notEqual(p.active(),old);
 assert.equal(b.contexts.find(e=>e.contextId===old).input,'   ');assert.equal(p.els.input.value,'');
 assert.match(note(p).textContent,/New chat started/);assert.match(p.els.status.textContent,/previous chat stays saved/);
 // The fresh chat is empty: another press creates nothing and still says that the previous chat was kept.
 await p.click('new');
 assert.equal(p.bank().contexts.length,2);assert.match(note(p).textContent,/New chat is ready/);assert.match(note(p).textContent,/previous chat stays saved/);
});

test('chat of a job with history: the new chat keeps the job and gets fresh ids; the old chat is stored unchanged',async()=>{
 const local=H.storage();local.setItem(H.KEY,H.bankV1([H.entry(1,{job:7,state:H.filledState(2),input:'draft kept'})]));
 const p=await H.load({local,jobs:[H.jobFixture(7,'Job A')]});
 const old=p.active(),was=p.bank().contexts.find(e=>e.contextId===old);
 await p.click('new');
 const b=p.bank(),kept=b.contexts.find(e=>e.contextId===old),made=b.contexts.find(e=>e.contextId===p.active());
 assert.equal(b.contexts.length,2);assert.deepEqual(kept,was);
 assert.notEqual(made.contextId,old);assert.equal(made.jobId,H.ids.job(7));assert.equal(made.envelope.workspace.targetJobId,H.ids.job(7));
 assert.notEqual(made.envelope.workspace.sourceId,kept.envelope.workspace.sourceId);
 assert.deepEqual(made.envelope.state.history,[]);assert.deepEqual(made.envelope.state.items,[]);assert.equal(made.input,'');
 assert.match(note(p).textContent,/New chat started/);
});

test('rapid presses: the pending note shows at once, the repeated press is dropped, one chat is created',async()=>{
 const p=await H.load({host:false});await p.type('abc');
 const el=p.els.new,first=el.onclick();
 assert.equal(el.disabled,true);assert.match(note(p).textContent,/Starting a new chat/);
 const second=el.onclick();
 await Promise.all([first,second]);await H.settle();
 assert.equal(p.bank().contexts.length,2);assert.equal(el.disabled,false);assert.match(note(p).textContent,/New chat started/);
});

test('waiting for the lock: typing and a repeated press keep the pending note; one chat is created and the right outcome follows',async()=>{
 const p=await H.load({host:false});await p.type('abc');const old=p.active();
 const release=holdLock(p),el=p.els.new,first=el.onclick();
 assert.equal(el.disabled,true);assert.match(note(p).textContent,/Starting a new chat/);
 // Typing while the press waits (the field stays usable): the pending note is not erased and the button states no stale reason.
 await p.type('abcd');
 assert.match(note(p).textContent,/Starting a new chat/);assert.equal(reason(p).textContent,'');assert.equal(el.disabled,true);
 // Neither is it erased by a screen refresh or by another press, and nothing was created yet.
 p.run('controls()');const second=el.onclick();await H.settle();
 assert.match(note(p).textContent,/Starting a new chat/);assert.doesNotMatch(note(p).className,/success|error/);
 assert.equal(p.bank().contexts.length,1);assert.equal(p.active(),old);
 release();await Promise.all([first,second]);await H.settle();
 // One new chat. The chat that was left holds the text as it was when the lock was granted; the outcome is the real one.
 const b=p.bank();
 assert.equal(b.contexts.length,2);assert.notEqual(p.active(),old);
 assert.equal(b.contexts.find(e=>e.contextId===old).input,'abcd');assert.equal(b.contexts.find(e=>e.contextId===p.active()).input,'');
 assert.equal(p.els.input.value,'');assert.equal(el.disabled,false);
 assert.match(note(p).textContent,/New chat started/);assert.match(note(p).className,/success/);assert.match(p.els.status.textContent,/New chat started/);
});

test('a success note is dropped as soon as it is no longer true, with or without an input event',async()=>{
 // The example button fills the field from the script: no input event is fired.
 let p=await H.load({host:false});
 await p.click('new');assert.match(note(p).textContent,/already empty/);
 // While it is still true, a screen refresh keeps it.
 p.run('controls()');assert.match(note(p).textContent,/already empty/);
 p.run('example()');
 assert.notEqual(p.els.input.value,'');assert.equal(note(p).textContent,'');assert.doesNotMatch(note(p).className,/success/);

 // A field written by the page (a transcription, a restored text) and then sent: the note does not come back when the reply ends.
 p=await H.load({host:false});
 await p.click('new');assert.match(note(p).textContent,/already empty/);
 p.els.input.value='two 20 amp breakers';
 p.run('busy=true;controls()');
 assert.equal(note(p).textContent,'');assert.match(reason(p).textContent,/reply is in progress/);
 p.run("state.history.push({role:'user',content:'two 20 amp breakers'},{role:'assistant',content:'OK.'});$('input').value='';busy=false;controls()");
 assert.equal(note(p).textContent,'');assert.equal(reason(p).textContent,'');assert.equal(p.els.new.disabled,false);

 // The chat stops being empty with no disabled state in between: history, or a field written without an event.
 p=await H.load({host:false});
 await p.click('new');assert.match(note(p).textContent,/already empty/);
 p.run("state.history.push({role:'user',content:'a'},{role:'assistant',content:'b'});controls()");
 assert.equal(note(p).textContent,'');
 p=await H.load({host:false});
 await p.click('new');assert.match(note(p).textContent,/already empty/);
 p.els.input.value='x';p.run('controls()');
 assert.equal(note(p).textContent,'');
 // An emptied field does not bring the old outcome back.
 p.els.input.value='';p.run('controls()');
 assert.equal(note(p).textContent,'');
});

test('screen refreshes write nothing that did not change; the live note never carries a passing reason',async()=>{
 const p=await H.load({host:false});
 const notes=countWrites(note(p)),reasons=countWrites(reason(p));
 p.run('controls();controls();controls()');
 assert.equal(notes(),0);assert.equal(reasons(),0);
 // One press: the pending text, then the outcome. Refreshes after it write nothing.
 await p.click('new');
 assert.equal(notes(),2);assert.equal(reasons(),0);assert.match(note(p).textContent,/already empty/);
 p.run('controls();controls()');p.run("status('OpenAI · fixture')");
 assert.equal(notes(),2);assert.equal(reasons(),0);
 // A second press is a user action: it is answered again (pending, then the outcome), although the outcome is the same sentence.
 await p.click('new');
 assert.equal(notes(),4);assert.match(note(p).textContent,/already empty/);
 // A reply starts: the reason is written once into the line that is not live; the outcome leaves the live line (one write).
 p.run('busy=true;controls()');
 assert.equal(reasons(),1);assert.match(reason(p).textContent,/reply is in progress/);
 assert.equal(notes(),5);assert.equal(note(p).textContent,'');
 p.run('controls();controls();controls()');
 assert.equal(reasons(),1);assert.equal(notes(),5);
 // The reply ends: the reason is removed once; nothing is written to the live line.
 p.run('busy=false;controls();controls()');
 assert.equal(reasons(),2);assert.equal(reason(p).textContent,'');assert.equal(notes(),5);assert.equal(note(p).textContent,'');
});

test('blocked: the button stays disabled with a readable reason, a forced press changes nothing, Cancel still works',async()=>{
 const p=await H.load({host:false});await p.type('abc');const before=p.local.getItem(H.KEY);
 p.run('busy=true;controls()');
 assert.equal(p.els.new.disabled,true);
 assert.match(reason(p).textContent,/^New chat is unavailable while a reply is in progress\./);assert.equal(note(p).textContent,'');
 await p.els.new.onclick();await H.settle();
 assert.equal(p.local.getItem(H.KEY),before);assert.equal(p.bank().contexts.length,1);
 assert.match(reason(p).textContent,/reply is in progress/);assert.equal(note(p).textContent,'');
 // Every passing state keeps its own English reason next to the disabled button.
 p.run('busy=false;bankBooting=true;controls()');
 assert.equal(p.els.new.disabled,true);assert.match(reason(p).textContent,/once the saved chats have loaded/);
 p.run('bankBooting=false;audioBusy=true;controls()');
 assert.equal(p.els.new.disabled,true);assert.match(reason(p).textContent,/during a recording/);
 p.run('audioBusy=false;recording=true;controls()');
 assert.equal(p.els.new.disabled,true);assert.match(reason(p).textContent,/during a recording/);
 // Cancel ends the protected operation as before; the reason then goes away and New chat is available again.
 p.els.cancel.onclick();
 assert.equal(p.els.new.disabled,false);assert.equal(reason(p).textContent,'');assert.equal(note(p).textContent,'');
 assert.equal(p.local.getItem(H.KEY),before);
 await p.click('new');
 assert.equal(p.bank().contexts.length,2);assert.match(note(p).textContent,/New chat started/);
});

test('refused save: the open chat and its text stay on the screen, with the reason next to the button and in the status',async()=>{
 const p=await H.load({host:false});await p.type('keep me');const old=p.active(),before=p.local.getItem(H.KEY);
 p.local.refuse=k=>k===H.KEY;
 await p.click('new');
 assert.equal(p.active(),old);assert.equal(p.els.input.value,'keep me');assert.equal(p.local.getItem(H.KEY),before);
 assert.match(note(p).className,/error/);assert.match(note(p).textContent,/previous chat stays open/);
 assert.equal(p.els.status.className,'error');assert.equal(p.els.new.disabled,false);
 // The refusal is still true after a screen refresh (the chat is not empty, and that is not what the note claims).
 p.run('controls()');
 assert.match(note(p).className,/error/);assert.match(note(p).textContent,/previous chat stays open/);
 p.local.refuse=null;
 await p.click('new');
 assert.equal(p.bank().contexts.length,2);assert.match(note(p).textContent,/New chat started/);assert.match(note(p).className,/success/);
});

test('a screen refresh that throws while the press starts: nothing is created, the button is released and the failure is stated',async()=>{
 const p=await H.load({host:false});await p.type('abc');const old=p.active(),before=p.local.getItem(H.KEY);
 // The first refresh after the press fails once (as a host panel error would); later refreshes work again.
 p.run("var hostRenderThrows=1;var hostRender=()=>{if(hostRenderThrows-->0)throw Error('fixture render failure');};");
 await p.els.new.onclick();await H.settle();
 assert.equal(p.run('newBusy'),false);assert.equal(p.els.new.disabled,false);
 assert.equal(p.local.getItem(H.KEY),before);assert.equal(p.active(),old);assert.equal(p.els.input.value,'abc');
 assert.match(note(p).className,/error/);assert.match(note(p).textContent,/was not started/);assert.match(note(p).textContent,/fixture render failure/);
 assert.doesNotMatch(note(p).textContent,/Starting a new chat/);assert.equal(p.els.status.className,'error');
 // The next press works.
 await p.click('new');
 assert.equal(p.bank().contexts.length,2);assert.match(note(p).textContent,/New chat started/);
});

// --- The composer status line (#status) after a press of New chat -------------------------------------------------------
// The exact sentences a person reads, written out here (not taken from the page script).
const CREATED='New chat started. The previous chat stays saved in the chat list.';
const READY='New chat is ready — type your message below. The previous chat stays saved in the chat list.';
const EMPTY='This chat is already empty — type your message below.';
const statusLine=p=>p.els.status;
const cleared=(p,label)=>{assert.equal(statusLine(p).textContent,'',label);assert.equal(statusLine(p).className,'',label);};
// Chooses a chat in the chat selector through the page's own handler (needs the host scripts).
const choose=async(p,id)=>{p.els['conversation-select'].value=id;await p.els['conversation-select'].onchange();await H.settle();};

test('composer status: typing removes each New chat success outcome (empty, started, ready) and keeps the typed text',async()=>{
 const p=await H.load({host:false});
 await p.click('new');assert.equal(statusLine(p).textContent,EMPTY);
 await p.type('a');cleared(p,'empty');assert.equal(p.els.input.value,'a');assert.equal(note(p).textContent,'');
 await p.click('new');assert.equal(statusLine(p).textContent,CREATED);assert.equal(p.bank().contexts.length,2);
 await p.type('b');cleared(p,'started');assert.equal(p.els.input.value,'b');
 const q=await H.load({host:false});await q.type('abc');await q.click('new');await q.click('new');
 assert.equal(statusLine(q).textContent,READY);assert.equal(q.bank().contexts.length,2);
 await q.type('c');cleared(q,'ready');assert.equal(q.els.input.value,'c');
 assert.equal(q.bank().contexts.find(e=>e.contextId===q.active()).input,'c');
});

test('composer status: opening another chat in the selector removes each New chat success outcome and restores that chat with its unsent text',async()=>{
 const p=await H.load();await p.type('old draft');const old=p.active();
 await p.click('new');const fresh=p.active();
 assert.notEqual(fresh,old);assert.equal(statusLine(p).textContent,CREATED);
 await choose(p,old);
 assert.equal(p.active(),old);assert.equal(p.els.input.value,'old draft');cleared(p,'started');assert.equal(note(p).textContent,'');
 assert.match(p.els['job-status'].textContent,/Opened the selected chat/);
 // Back on the chat the press created, still empty: another press says "ready"; that outcome goes the same way.
 await choose(p,fresh);assert.equal(p.active(),fresh);assert.equal(p.els.input.value,'');
 await p.click('new');
 assert.equal(statusLine(p).textContent,READY);assert.equal(p.bank().contexts.length,2);assert.equal(p.active(),fresh);
 await choose(p,old);
 assert.equal(p.active(),old);assert.equal(p.els.input.value,'old draft');cleared(p,'ready');
 // A stored empty chat that no press created: it is reused (the bank bytes stay), then another chat is opened.
 const local=H.storage(),session=H.storage();
 local.setItem(H.KEY,H.bankV1([H.entry(1,{input:'old draft'}),H.entry(2)]));session.setItem(H.ACTIVE_KEY,H.ids.ctx(2));
 const q=await H.load({local,session});
 assert.equal(q.active(),H.ids.ctx(2));
 const stored=local.getItem(H.KEY);
 await q.click('new');
 assert.equal(statusLine(q).textContent,EMPTY);assert.equal(local.getItem(H.KEY),stored);assert.equal(q.active(),H.ids.ctx(2));
 await choose(q,H.ids.ctx(1));
 assert.equal(q.active(),H.ids.ctx(1));assert.equal(q.els.input.value,'old draft');cleared(q,'empty');
});

test('composer status: a status that is not a New chat success outcome stays through typing and through opening another chat',async()=>{
 const p=await H.load();await p.type('old draft');const old=p.active();
 await p.click('new');const fresh=p.active();assert.equal(statusLine(p).textContent,CREATED);
 // A session status took the place of the outcome: typing leaves it alone.
 p.run("status('OpenAI · fixture')");
 await p.type('x');assert.equal(statusLine(p).textContent,'OpenAI · fixture');
 // An error stays an error, through typing and through a switch.
 p.run("status('Fixture failure. Nothing was changed.','error')");
 await p.type('xy');assert.equal(statusLine(p).textContent,'Fixture failure. Nothing was changed.');assert.equal(statusLine(p).className,'error');
 await choose(p,old);
 assert.equal(p.active(),old);assert.equal(statusLine(p).textContent,'Fixture failure. Nothing was changed.');assert.equal(statusLine(p).className,'error');
 // A sentence that only resembles an outcome is not one.
 p.run("status('New chat started.','success')");
 await choose(p,fresh);
 assert.equal(p.active(),fresh);assert.equal(p.els.input.value,'xy');assert.equal(statusLine(p).textContent,'New chat started.');assert.equal(statusLine(p).className,'success');
 await p.type('xyz');assert.equal(statusLine(p).textContent,'New chat started.');assert.equal(statusLine(p).className,'success');
});

test('composer status: the reason of a refused press stays in the status line when another chat is opened',async()=>{
 const p=await H.load();await p.type('old draft');const old=p.active();
 await p.click('new');const fresh=p.active();await p.type('keep me');
 p.local.refuse=k=>k===H.KEY;
 await p.click('new');
 p.local.refuse=null;
 const refusal=statusLine(p).textContent;
 assert.equal(p.active(),fresh);assert.equal(p.els.input.value,'keep me');assert.equal(statusLine(p).className,'error');assert.match(refusal,/previous chat stays open/);
 await choose(p,old);
 assert.equal(p.active(),old);assert.equal(p.els.input.value,'old draft');
 assert.equal(statusLine(p).textContent,refusal);assert.equal(statusLine(p).className,'error');
});

test('in-flight press: typing while it waits clears neither the pending note nor the status line; the outcome or the refusal of that press follows and stays',async()=>{
 // The status line still holds the outcome of an earlier press when the next press starts waiting for the lock.
 const p=await H.load({host:false});
 await p.click('new');assert.equal(statusLine(p).textContent,EMPTY);
 const release=holdLock(p),el=p.els.new,first=el.onclick();
 assert.equal(p.run('newBusy'),true);assert.equal(el.disabled,true);assert.match(note(p).textContent,/Starting a new chat/);
 await p.type('abcd');
 assert.equal(p.run('newBusy'),true);assert.match(note(p).textContent,/Starting a new chat/);assert.equal(statusLine(p).textContent,EMPTY);
 assert.equal(p.bank().contexts.length,1);
 release();await first;await H.settle();
 assert.equal(p.run('newBusy'),false);assert.equal(el.disabled,false);
 const b=p.bank();
 assert.equal(b.contexts.length,2);assert.equal(b.contexts.find(e=>e.contextId!==p.active()).input,'abcd');assert.equal(p.els.input.value,'');
 assert.equal(statusLine(p).textContent,CREATED);assert.equal(note(p).textContent,CREATED);assert.match(note(p).className,/success/);
 // A press that waited and is then refused: the reason is in both lines, the busy flag is released, nothing was lost.
 const q=await H.load({host:false});await q.type('keep me');const old=q.active(),before=q.local.getItem(H.KEY);
 const free=holdLock(q),press=q.els.new.onclick();
 assert.equal(q.run('newBusy'),true);assert.match(note(q).textContent,/Starting a new chat/);
 q.local.refuse=k=>k===H.KEY;
 free();await press;await H.settle();
 assert.equal(q.run('newBusy'),false);assert.equal(q.els.new.disabled,false);
 assert.equal(q.active(),old);assert.equal(q.els.input.value,'keep me');assert.equal(q.local.getItem(H.KEY),before);
 assert.equal(statusLine(q).className,'error');assert.match(statusLine(q).textContent,/previous chat stays open/);
 assert.match(note(q).className,/error/);assert.equal(note(q).textContent,statusLine(q).textContent);
 q.run('controls()');
 assert.equal(statusLine(q).className,'error');assert.match(statusLine(q).textContent,/previous chat stays open/);
});
