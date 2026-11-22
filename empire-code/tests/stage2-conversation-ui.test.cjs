'use strict';
// Conversation continuity through the page itself (EC-06): limit with a way out, archive / restore / delete with confirmation,
// export of unsent text, import with preview, stale tabs, failed writes. The real page scripts run in an isolated VM
// (tests/stage2-harness.cjs) on fixture data only; this is not a real browser and not the owner's storage.
// Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./stage2-harness.cjs');
const CBank=require('../candidate/browser/conversation-bank.js'),DraftRecovery=require('../candidate/browser/draft-recovery.js');
const {KEY,LEGACY_KEY,ACTIVE_KEY,ids,T,entry,bankV1,receipt,filledState,jobFixture}=H;
const LATER='2026-11-02T08:30:00.000Z';
// A portable archive file made from a hand-written released-layout fixture.
function archiveFile(fixture,o={}){const bank=CBank.read(bankV1([fixture])).bank;return JSON.stringify(CBank.portable(bank,fixture.contextId,{exportedAt:LATER,...o}),null,2);}
const lastDownload=p=>JSON.parse(p.downloads[p.downloads.length-1]);
// Two conversations without a job, each with unsent text; the second one is open. Returns [first,second] ids.
async function twoConversations(p){await p.type('pierwsza rozmowa');const first=p.active();await p.click('new');await p.type('druga rozmowa');return [first,p.active()];}

test('boot: a bank stored by the released version is migrated in place; conversations, the open one and its text are preserved',async()=>{
 const list=[entry(1,{input:'pierwsza'}),entry(2,{job:1,input:'druga robota',state:filledState(2,1),receipts:[receipt(1,1)]}),entry(3,{input:'trzecia, najnowsza'})];
 const local=H.storage(),session=H.storage(),raw=bankV1(list);
 local.setItem(KEY,raw);session.setItem(ACTIVE_KEY,ids.ctx(2));
 const p=await H.load({local,session,jobs:[jobFixture(1,'Kuchnia')]});
 const stored=local.getItem(KEY),bank=p.bank();
 assert.notEqual(stored,raw);assert.equal(H.releasedV1Reads(stored),'UNSUPPORTED','an old tab can no longer accept, and so never overwrites, these bytes');
 assert.equal(bank.contexts.length,3);
 for(const e of list)assert.equal(JSON.stringify(bank.contexts.find(x=>x.contextId===e.contextId)),JSON.stringify(e),e.contextId);
 assert.equal(p.active(),ids.ctx(2));assert.equal(p.els.input.value,'druga robota');assert.equal(p.run('state.items.length'),2);
 assert.deepEqual(JSON.parse(p.run('JSON.stringify(workspaceMeta.receipts)')),[receipt(1,1)]); // parsed here: VM objects have another prototype
 assert.equal(p.run('storageBroken'),false);
 // typing afterwards saves into the migrated bank
 await p.type('druga robota i więcej');
 assert.equal(p.bank().contexts.find(x=>x.contextId===ids.ctx(2)).input,'druga robota i więcej');
});

test('boot: when the migration write is refused the old bytes stay untouched and are offered as a raw recovery copy',async()=>{
 const local=H.storage(),raw=bankV1([entry(1,{input:'ważny niewysłany tekst'})]);
 local.setItem(KEY,raw);local.refuse=k=>k===KEY;
 const p=await H.load({local});
 assert.equal(local.getItem(KEY),raw);assert.equal(p.run('storageBroken'),true);
 assert.match(p.els.status.textContent,/Niczego nie usunięto ani nie nadpisano/);
 await p.type('nowy tekst');assert.equal(local.getItem(KEY),raw,'nothing is written over the unmigrated bank');
 await p.click('export');
 const file=lastDownload(p);
 assert.equal(file.kind,'empire-code.storage-recovery');assert.equal(file.bankRaw,raw);assert.equal(file.screen.unsentText,'nowy tekst');
 assert.throws(()=>CBank.inspect(p.downloads[p.downloads.length-1],CBank.empty(),{now:LATER}),e=>e.code==='RAW','a recovery copy is not an importable conversation');
});

test('EC-06: the 17th conversation is refused with the limit named and management opened; archiving one makes room; restore at the limit loses nothing',async()=>{
 const p=await H.load();
 for(let i=1;i<=15;i++){await p.type('rozmowa '+i);await p.click('new');}
 await p.type('rozmowa 16');
 const atLimit=p.local.getItem(KEY);
 assert.equal(p.bank().contexts.length,16);assert.equal(p.els['manage-panel'].hidden,true,'management is not forced open before it is needed');
 await p.click('new');
 assert.equal(p.local.getItem(KEY),atLimit,'the refusal stored nothing');
 assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/Limit 16/);assert.match(p.els.status.textContent,/Zarządzaj rozmowami/);
 assert.ok(!/^Nie zapisano nowej rozmowy/.test(p.els.status.textContent),'the reason is not replaced by a generic failure');
 assert.equal(p.els.input.value,'rozmowa 16','the unsent text stays in the field');
 assert.equal(p.els['manage-panel'].hidden,false);assert.match(p.els['manage-reason'].textContent,/Limit 16/);
 assert.match(p.els['context-capacity'].textContent,/16 z 16/);assert.match(p.els['manage-usage'].textContent,/Archiwum: 0/);
 // archive another conversation of the group, straight from the opened panel
 const other=p.bank().contexts.find(e=>e.contextId!==p.active());
 await p.click('manage-archive-'+other.contextId);
 let bank=p.bank();
 assert.equal(bank.contexts.length,15);assert.equal(bank.archived.length,1);
 assert.deepEqual(bank.archived[0].entry.envelope,other.envelope);assert.equal(bank.archived[0].entry.input,other.input);
 assert.match(p.els['manage-status'].textContent,/archiwum/);assert.match(p.els['manage-status'].textContent,/zajmuje pamięć/);
 assert.equal(p.els.input.value,'rozmowa 16');
 await p.click('new');
 bank=p.bank();
 assert.equal(bank.contexts.length,16);assert.equal(p.els.input.value,'');assert.notEqual(p.els.status.className,'error');
 assert.equal(bank.contexts.filter(e=>e.input==='rozmowa 16').length,1,'the conversation left behind keeps its text');
 // the archived conversation can be looked at without becoming editable
 await p.click('manage-view-'+other.contextId);
 assert.match(p.text('manage-view'),/tylko do odczytu/);assert.ok(p.text('manage-view').includes(other.input));
 // restore while the group is full again: refused, everything stays
 const full=p.local.getItem(KEY);
 await p.click('manage-restore-'+other.contextId);
 assert.equal(p.local.getItem(KEY),full);
 assert.equal(p.els['manage-status'].className,'error');assert.match(p.els['manage-status'].textContent,/Limit 16/);assert.match(p.els['manage-status'].textContent,/pozostaje w archiwum/);
});

test('delete needs an explicit confirmation; opening the box and Cancel change nothing; the deleted conversation leaves only its record',async()=>{
 const p=await H.load(),[first]=await twoConversations(p);
 await p.click('manage-open');
 const before=p.local.dump();
 await p.click('manage-delete-'+first);
 assert.equal(p.els['manage-confirm'].hidden,false);assert.equal(p.find('manage-delete-confirm').disabled,true,'not confirmable before the explicit tick');
 assert.match(p.text('manage-confirm'),/trwałe/);assert.match(p.text('manage-confirm'),/Eksportuj/);
 await assert.rejects(p.click('manage-delete-confirm'),/disabled/);
 await p.click('manage-delete-cancel');
 assert.equal(p.els['manage-confirm'].hidden,true);assert.equal(p.local.dump(),before);
 await p.click('manage-close');await p.click('manage-open');
 assert.equal(p.local.dump(),before,'opening and closing the panel changes nothing');
 await p.click('manage-delete-'+first);await p.check('manage-delete-ack');await p.click('manage-delete-confirm');
 const bank=p.bank();
 assert.equal(bank.contexts.length,1);assert.equal(bank.contexts[0].input,'druga rozmowa');
 assert.equal(bank.retired.length,1);assert.equal(bank.retired[0].contextId,first);
 assert.ok(!p.local.getItem(KEY).includes('pierwsza rozmowa'),'the payload is gone from the bank');
 assert.equal(p.els.input.value,'druga rozmowa','the open conversation is untouched');
});

test('deleting or archiving the OPEN conversation saves its text first and opens another one in the same write',async()=>{
 const p=await H.load(),[first,second]=await twoConversations(p);
 p.els.input.value='druga rozmowa, dopisane bez zapisu';                 // typed, not yet saved anywhere
 await p.click('manage-open');await p.click('manage-archive-'+second);
 let bank=p.bank();
 assert.equal(bank.archived.length,1);assert.equal(bank.archived[0].entry.input,'druga rozmowa, dopisane bez zapisu','the exact field text went into the archived conversation');
 assert.equal(p.active(),first);assert.equal(p.els.input.value,'pierwsza rozmowa');
 // deleting the last active conversation leaves a new empty one, never a page without a stored conversation
 await p.click('manage-delete-'+first);await p.check('manage-delete-ack');await p.click('manage-delete-confirm');
 bank=p.bank();
 assert.equal(bank.contexts.length,1);assert.equal(bank.contexts[0].contextId,p.active());assert.notEqual(p.active(),first);
 assert.equal(bank.contexts[0].input,'');assert.equal(p.els.input.value,'');assert.equal(bank.retired[0].contextId,first);
 CBank.parse(p.local.getItem(KEY));
});

test('C2B: a conversation with only unsent text is exportable; the file carries the exact field text, saved or not',async()=>{
 const TEXT='2 puszki 4"\n — „nie wysyłać”, 50 ft #12';
 const p=await H.load();
 assert.equal(p.els.export.disabled,true,'nothing to export in an empty conversation');
 await p.type(TEXT);
 assert.equal(p.els.export.disabled,false,'unsent text alone is exportable');
 await p.click('export');
 let file=lastDownload(p);
 assert.equal(file.kind,CBank.ARCHIVE_KIND);assert.equal(file.unsentText,TEXT);assert.equal(file.entry.input,TEXT);
 assert.deepEqual(file.entry.envelope.state.history,[]);assert.equal(file.entry.contextId,p.active());assert.notEqual(p.els.status.className,'error');
 // text that was typed but not yet saved or journaled is captured too
 p.els.input.value=TEXT+' + 1 box';await p.click('export');
 file=lastDownload(p);assert.equal(file.unsentText,TEXT+' + 1 box');assert.equal(p.bank().contexts[0].input,TEXT+' + 1 box');
 // the browser refuses the save: the file still has the text, and says so
 const stored=p.local.getItem(KEY);p.local.refuse=k=>k===KEY;
 p.els.input.value='tekst, którego nie da się zapisać';await p.click('export');
 file=lastDownload(p);
 assert.equal(file.kind,CBank.ARCHIVE_KIND);assert.equal(file.unsentText,'tekst, którego nie da się zapisać');assert.equal(file.entry.input,TEXT+' + 1 box');
 assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/nie został zapisany w przeglądarce/);
 assert.equal(p.local.getItem(KEY),stored);assert.equal(p.els.input.value,'tekst, którego nie da się zapisać');
});

test('import: choosing a file only previews; Cancel is inert; Apply restores the exact text; the same file again changes nothing',async()=>{
 const TEXT='tylko tekst\n„nigdy nie wysłany” — 3 × 20 A';
 const source=await H.load();await source.type(TEXT);await source.click('export');
 const text=source.downloads[0],id=source.active();
 const p=await H.load();await p.type('moja rozmowa');
 const before=p.local.dump();
 await p.click('manage-open');
 await p.choose(null);assert.equal(p.els['import-preview'].hidden,true,'a cancelled file dialog does nothing');
 await p.choose(text,'EmpireCode-rozmowa.json');
 assert.equal(p.local.dump(),before,'reading and previewing a file stores nothing');
 assert.equal(p.els['import-preview'].hidden,false);
 const shown=p.text('import-preview');
 assert.ok(shown.includes(TEXT),'the unsent text of the file is shown');assert.match(shown,/bez roboty/);assert.match(shown,/pozycje szkicu: 0/);assert.match(shown,/wiadomości: 0/);
 await p.click('import-cancel');
 assert.equal(p.els['import-preview'].hidden,true);assert.equal(p.local.dump(),before);assert.equal(p.find('import-apply'),null);
 await p.choose(text);await p.click('import-apply');
 let bank=p.bank();
 assert.equal(bank.contexts.length,2);
 const got=bank.contexts.find(e=>e.contextId===id);
 assert.ok(got,'the conversation keeps its identity');assert.equal(got.input,TEXT);
 assert.equal(p.els.input.value,'moja rozmowa','the open conversation is not replaced');assert.equal(p.els['manage-status'].className,'');
 // open it: the text is back in the field, unsent
 p.els['conversation-select'].value=id;await p.els['conversation-select'].onchange();await H.settle();
 assert.equal(p.active(),id);assert.equal(p.els.input.value,TEXT);
 // the same file once more
 const after=p.local.dump();
 await p.choose(text);
 assert.match(p.text('import-preview'),/niczego nie zmieni/);
 await p.click('import-apply');
 assert.equal(p.local.dump(),after);assert.equal(p.bank().contexts.length,2);assert.match(p.els['manage-status'].textContent,/Bez zmian/);
});

test('import: conflicts, malformed and raw files are explained and not applicable; the stored conversations stay byte for byte',async()=>{
 const p=await H.load();await p.type('tekst A');
 await p.click('export');const older=p.downloads[0];
 await p.type('tekst A, nowsza wersja');
 await p.click('manage-open');
 const before=p.local.dump();
 const raw=JSON.stringify({kind:'empire-code.storage-recovery',version:2,bankRaw:p.local.getItem(KEY),screen:{unsentText:'x'}});
 for(const [label,text,expected] of [['older file over newer state',older,/Konflikt/],['truncated',older.slice(0,-20),/JSON/],['raw recovery copy',raw,/surowa kopia awaryjna/],['unknown fields',JSON.stringify({...JSON.parse(older),extra:true}),/Nieznany układ/]]){
  await p.choose(text,label+'.json');
  assert.match(p.text('import-preview'),expected,label);
  const apply=p.find('import-apply');assert.ok(!apply||apply.disabled,label+': nothing to apply');
  assert.equal(p.local.dump(),before,label);
  await p.click('import-cancel');
 }
 // a file over the size bound is not even read
 let readCalls=0;p.els['import-file'].files=[{name:'big.json',size:50000000,text:async()=>{readCalls++;return '';}}];
 await p.els['import-file'].onchange();await H.settle();
 assert.equal(readCalls,0);assert.match(p.text('import-preview'),/za duży/);assert.equal(p.local.dump(),before);
});

test('import of a conversation whose job is not on this device: readable draft, material writes disabled',async()=>{
 const file=archiveFile(entry(5,{job:9,state:filledState(2,1),input:'do roboty z innego urządzenia'}));
 const p=await H.load({jobs:[jobFixture(1,'Kuchnia')]});
 await p.click('manage-open');await p.choose(file);
 const shown=p.text('import-preview');
 assert.match(shown,/nie istnieje na tym urządzeniu/);assert.match(shown,/zapis materiałów pozostanie wyłączony/);assert.match(shown,/pozycje szkicu: 2/);
 await p.click('import-apply');
 const got=p.bank().contexts.find(e=>e.contextId===ids.ctx(5));
 assert.equal(got.jobId,ids.job(9),'the conversation is not retargeted to another job');
 await p.run('hostExclusive(()=>{switchContext('+JSON.stringify(ids.ctx(5))+');render();})');await H.settle();
 assert.equal(p.els.input.value,'do roboty z innego urządzenia');assert.equal(p.run('state.items.length'),2);
 assert.match(p.text('handoff-panel'),/zapis materiałów jest wyłączony/);
 const prepare=p.find('handoff-prepare');assert.ok(prepare&&prepare.disabled,'no write to a job that does not exist here');
 assert.equal(p.els.export.disabled,false);
});

test('stale tab: after another tab deleted its conversation it cannot save it back, says why and offers a recovery copy',async()=>{
 const local=H.storage();
 const a=await H.load({local});await a.type('tekst w karcie A');const x=a.active();
 const b=await H.load({local});assert.equal(b.active(),x);
 await b.click('manage-open');await b.click('manage-delete-'+x);await b.check('manage-delete-ack');await b.click('manage-delete-confirm');
 const afterDelete=local.getItem(KEY);
 assert.equal(JSON.parse(afterDelete).retired[0].contextId,x);
 await a.storageEvent(KEY);
 assert.equal(a.run('contextLost'),'retired');assert.equal(a.els.status.className,'error');assert.match(a.els.status.textContent,/usunięta w innej karcie/);
 await a.type('tekst w karcie A, dopisany po usunięciu');
 assert.equal(local.getItem(KEY),afterDelete,'the stale tab did not bring the conversation back');
 assert.equal(a.els.input.value,'tekst w karcie A, dopisany po usunięciu');
 assert.match(a.text('handoff-panel'),/kopi[ię] awaryjn/);
 assert.equal(a.find('lost-leave').disabled,true,'the screen is not abandoned before a copy exists');
 assert.equal(a.els.export.disabled,false);
 await a.click('export');
 const file=lastDownload(a);
 assert.equal(file.kind,'empire-code.storage-recovery');assert.equal(file.reason,'retired');assert.equal(file.screen.contextId,x);
 assert.equal(file.screen.unsentText,'tekst w karcie A, dopisany po usunięciu');assert.equal(file.bankRaw,afterDelete);
 // also a direct save attempt of the retired conversation is refused by the bank itself
 assert.throws(()=>a.run('writeEntry({state,undo,diffs,workspace:workspaceMeta},"x")'));
 assert.equal(local.getItem(KEY),afterDelete);
 await a.click('lost-leave');
 assert.equal(a.run('contextLost'),'');assert.equal(a.active(),b.active());assert.equal(local.getItem(KEY),afterDelete);
});

test('stale tab: a bank rewritten by a newer application is never written again from this tab',async()=>{
 const p=await H.load();await p.type('tekst przed zmianą układu');
 const newer=JSON.stringify({...p.bank(),version:3,future:{}});
 p.local.setItem(KEY,newer);await p.storageEvent(KEY);
 assert.equal(p.run('contextLost'),'version');
 await p.type('tekst po zmianie układu');
 assert.equal(p.local.getItem(KEY),newer);
 await p.click('export');
 const file=lastDownload(p);
 assert.equal(file.kind,'empire-code.storage-recovery');assert.equal(file.reason,'version');assert.equal(file.screen.unsentText,'tekst po zmianie układu');
});

test('the imported legacy draft, once deleted, is not imported again on the next load',async()=>{
 const local=H.storage(),session=H.storage(),legacy=JSON.stringify({state:filledState(1,1),undo:[],diffs:[]});
 local.setItem(LEGACY_KEY,legacy);
 const p=await H.load({local,session});
 const imported=p.bank().legacy.contextId;
 assert.equal(p.active(),imported);assert.equal(p.run('state.history.length'),2);
 await p.click('manage-open');await p.click('manage-delete-'+imported);await p.check('manage-delete-ack');await p.click('manage-delete-confirm');
 const record=p.bank().legacy;
 assert.equal(record.contextId,imported);assert.equal(local.getItem(LEGACY_KEY),legacy,'the legacy bytes are never touched');
 const again=await H.load({local,session}),bank=again.bank();
 assert.deepEqual(bank.legacy,record);
 assert.equal(bank.retired.filter(t=>t.contextId===imported).length,1);
 assert.equal(bank.contexts.length,1);assert.equal(bank.contexts[0].envelope.state.history.length,0,'no second copy of the legacy conversation');
 assert.equal(again.run('state.history.length'),0);assert.equal(again.run('legacyNotice'),'');assert.equal(local.getItem(LEGACY_KEY),legacy);
});

test('unsent-text copies of other open tabs survive archive, restore, delete and import; an export carries them',async()=>{
 const p=await H.load(),[first,second]=await twoConversations(p);
 const foreign=n=>{const w=DraftRecovery.write(p.local,{contextId:n===7?first:second,documentId:ids.doc(n),baseVersion:1,text:'tekst z karty '+n,savedAt:T});p.navigator.locks.held.push('empire-code-document-v1:'+ids.doc(n));return w;};
 const one=foreign(7),two=foreign(8);
 const kept=()=>{assert.equal(p.local.getItem(one.key),one.raw);assert.equal(p.local.getItem(two.key),two.raw);};
 await p.click('manage-open');
 await p.click('manage-export-'+first);
 assert.deepEqual(lastDownload(p).recovery.map(r=>r.text),['tekst z karty 7']);
 await p.click('manage-archive-'+first);kept();
 await p.click('manage-restore-'+first);kept();
 await p.choose(archiveFile(entry(40,{input:'z pliku'})));await p.click('import-apply');kept();
 await p.click('manage-archive-'+second);kept();                          // the open conversation, with a live foreign copy
 await p.click('manage-delete-'+first);await p.check('manage-delete-ack');await p.click('manage-delete-confirm');kept();
 assert.equal(p.bank().retired.length,1);
});

test('a refused write during management or import leaves the bank, the field text and the preview as they were',async()=>{
 const p=await H.load(),[first,second]=await twoConversations(p);
 await p.click('manage-open');
 const stored=p.local.getItem(KEY);
 p.local.refuse=k=>k===KEY;
 await p.type('druga rozmowa i jeszcze');                                    // journaled; the bank save is refused
 assert.equal(p.local.getItem(KEY),stored);
 await p.click('manage-archive-'+first);
 assert.equal(p.els['manage-status'].className,'error');assert.match(p.els['manage-status'].textContent,/odmówiła zapisu/);
 assert.equal(p.local.getItem(KEY),stored);assert.equal(p.els.input.value,'druga rozmowa i jeszcze');assert.equal(p.active(),second);
 assert.ok(p.local.dump().includes('druga rozmowa i jeszcze'),'the text is held by the recovery journal');
 // archiving the open conversation is refused outright while its text is not stored in it
 await p.click('manage-archive-'+second);
 assert.equal(p.els['manage-status'].className,'error');assert.match(p.els['manage-status'].textContent,/nie został zapisany/);assert.equal(p.local.getItem(KEY),stored);
 await p.choose(archiveFile(entry(41,{input:'z pliku'})));await p.click('import-apply');
 assert.equal(p.els['manage-status'].className,'error');assert.equal(p.local.getItem(KEY),stored);
 assert.equal(p.els['import-preview'].hidden,false,'the chosen file is still there to apply later');
 // storage works again: the same explicit actions go through and the text is saved first
 p.local.refuse=null;
 await p.click('import-apply');await p.click('manage-archive-'+first);
 const bank=p.bank();
 assert.equal(bank.contexts.find(e=>e.contextId===second).input,'druga rozmowa i jeszcze');
 assert.equal(bank.archived.length,1);assert.ok(bank.contexts.some(e=>e.contextId===ids.ctx(41)));
});
