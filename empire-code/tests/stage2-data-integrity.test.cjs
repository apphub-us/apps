'use strict';
// Data-loss edge cases of conversation continuity: strict validation of an imported archive, acknowledgements of written
// materials that must not be replayed, a refused save with its visible retry, text that could be preserved nowhere, and a write
// the read-back cannot confirm. The real page scripts run in an isolated VM (tests/stage2-harness.cjs) on fixture data only;
// this is not a real browser and not the owner's storage. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./stage2-harness.cjs');
const CBank=require('../candidate/browser/conversation-bank.js'),DraftRecovery=require('../candidate/browser/draft-recovery.js');
const {KEY,ids,T,entry,bankV1,receipt,filledState,item,jobFixture}=H;
const LATER='2026-11-02T08:30:00.000Z',copy=v=>JSON.parse(JSON.stringify(v));
const code=c=>e=>e instanceof CBank.BankError&&e.code===c;
// A portable archive (as an object) made from a hand-written released-layout fixture.
function archiveOf(fixture,o={}){const bank=CBank.read(bankV1([fixture])).bank;return CBank.portable(bank,fixture.contextId,{exportedAt:LATER,...o});}
// A complete, valid file: a draft with two items and two exchanges, one written material, one undo step, the three kinds of
// marked changes the server produces, unsent text and one extra copy of unsent text.
function goodFile(){
 const file=archiveOf(entry(5,{job:1,state:filledState(2,2),receipts:[receipt(1,1)],input:'tekst z pliku'}),{recovery:[{text:'kopia z innej karty',savedAt:T,baseVersion:1}]});
 file.entry.envelope.undo=[filledState(1,1)];
 file.entry.envelope.diffs=[{op:'add',after:item(2)},{op:'update',before:item(1),after:{...item(1),quantity:'4'}},{op:'remove',before:item(9)}];
 return file;
}
// The good file with one defect. The binding is re-bound to the changed draft (unless keepBinding), so the refusal is the rule under test.
function variant(change,keepBinding){
 const f=goodFile();change(f,f.entry.envelope.state,f.entry.envelope.workspace);
 const w=f.entry.envelope.workspace;if(w&&typeof w==='object'&&!keepBinding)w.boundState=JSON.stringify(f.entry.envelope.state);
 return JSON.stringify(f);
}
// An own field with a reserved name, the way JSON.parse creates it (a plain assignment would set the prototype instead).
const own=(o,k,v)=>Object.defineProperty(o,k,{value:v,enumerable:true,writable:true,configurable:true});
const DRAFT=/ieprawidłowy szkic/,UNDO=/historię cofania/,DIFF=/opis zmian/,BINDING=/Nieprawidłowe powiązanie szkicu/,UNSAFE=/niedozwolone nazwy pól/,VERSION=/Nieprawidłowa wersja rozmowy/;
const CASES=[
 // history
 ['history: extra field in a message',(f,s)=>{s.history[0].tool='x';},DRAFT],
 ['history: unknown role',(f,s)=>{s.history[1].role='system';},DRAFT],
 ['history: content is not text',(f,s)=>{s.history[0].content=42;},DRAFT],
 ['history: empty content',(f,s)=>{s.history[0].content='  ';},DRAFT],
 ['history: not a list',(f,s)=>{s.history={0:'x'};},DRAFT],
 ['history: 41 messages',(f,s)=>{while(s.history.length<41)s.history.push({role:'user',content:'x'});},DRAFT],
 // draft items
 ['item: extra field',(f,s)=>{s.items[0].owner='x';},DRAFT],
 ['item: missing field',(f,s)=>{delete s.items[0].notes;},DRAFT],
 ['item: malformed id',(f,s)=>{s.items[0].id='x1';},DRAFT],
 ['item: repeated id',(f,s)=>{s.items[1].id=s.items[0].id;},DRAFT],
 ['item: id not below nextId',(f,s)=>{s.nextId=2;},DRAFT],
 ['item: quantity is a number',(f,s)=>{s.items[0].quantity=3;},DRAFT],
 ['item: name over 120 characters',(f,s)=>{s.items[0].name='n'.repeat(121);},DRAFT],
 ['item: review is not a list',(f,s)=>{s.items[0].review='x';},DRAFT],
 ['item: review entry is not text',(f,s)=>{s.items[0].review=[7];},DRAFT],
 ['items: 17',(f,s)=>{for(let i=3;i<=17;i++)s.items.push(item(i));s.nextId=18;},DRAFT],
 // counters
 ['draft: negative revision',(f,s)=>{s.revision=-1;},DRAFT],
 ['draft: fractional revision',(f,s)=>{s.revision=1.5;},DRAFT],
 ['draft: revision over the limit',(f,s)=>{s.revision=101;},DRAFT],
 ['draft: nextId 0',(f,s)=>{s.nextId=0;},DRAFT],
 ['draft: unknown version',(f,s)=>{s.version=2;},DRAFT],
 ['draft: extra field',(f,s)=>{s.extra=1;},DRAFT],
 ['entry: version 0',f=>{f.entry.version=0;},VERSION],
 ['entry: fractional version',f=>{f.entry.version=1.5;},VERSION],
 ['entry: created after touched',f=>{f.entry.created=f.entry.touched+1;},VERSION],
 ['entry: version beyond any real count',f=>{f.entry.version=2e12;},/liczniki/],
 ['copy of unsent text: negative base version',f=>{f.recovery[0].baseVersion=-1;},/kopie niewysłanego tekstu/],
 // undo
 ['undo: nine states',f=>{f.entry.envelope.undo=Array.from({length:9},()=>filledState(1,1));},UNDO],
 ['undo: malformed state',f=>{f.entry.envelope.undo=[{version:1}];},UNDO],
 ['undo: state with an extra field',f=>{f.entry.envelope.undo[0].x=1;},UNDO],
 ['undo: not a list',f=>{f.entry.envelope.undo='x';},UNDO],
 // marked changes
 ['change: update without "before"',f=>{f.entry.envelope.diffs=[{op:'update',after:item(1)}];},DIFF],
 ['change: unknown operation',f=>{f.entry.envelope.diffs[0].op='replace';},DIFF],
 ['change: extra field',f=>{f.entry.envelope.diffs[0].note='x';},DIFF],
 ['change: malformed item',f=>{f.entry.envelope.diffs[0].after={id:'i0002'};},DIFF],
 ['changes: not a list',f=>{f.entry.envelope.diffs={};},DIFF],
 ['changes: 65',f=>{f.entry.envelope.diffs=Array.from({length:65},()=>({op:'add',after:item(2)}));},DIFF],
 // binding, source identity, receipts
 ['binding: extra field',(f,s,w)=>{w.owner='x';},BINDING],
 ['source: malformed id',(f,s,w)=>{w.sourceId='conv1_XYZ';},BINDING],
 ['source: revision over the limit',(f,s,w)=>{w.sourceRevision=101;},BINDING],
 ['source: negative revision',(f,s,w)=>{w.sourceRevision=-1;},/Nieprawidłowa tożsamość rozmowy/],
 ['source: saved time is not a time',(f,s,w)=>{w.sourceSavedAt='wczoraj';},BINDING],
 ['binding: does not match the draft',(f,s)=>{s.revision=3;},/nie zgadza się z jej treścią/,true],
 ['binding: another job than the conversation',(f,s,w)=>{w.targetJobId=ids.job(2);},/inną robotę/],
 ['receipt: extra field',(f,s,w)=>{w.receipts[0].note='x';},/potwierdzenie wcześniejszego zapisu/],
 ['receipt: malformed material id',(f,s,w)=>{w.receipts[0].materialId='mat1_1';},/potwierdzenie wcześniejszego zapisu/],
 ['receipt: repeated',(f,s,w)=>{w.receipts.push(copy(w.receipts[0]));},/Powtórzone powiązanie/],
 ['receipts: not a list',(f,s,w)=>{w.receipts={};},/Nieprawidłowa tożsamość rozmowy/],
 ['prepared write: malformed',(f,s,w)=>{w.prepared={phase:'review'};},/przygotowanego zapisu/],
 // reserved field names
 ['"__proto__" in a draft item',(f,s)=>{own(s.items[0],'__proto__',{admin:true});},UNSAFE],
 ['"__proto__" in a message',(f,s)=>{own(s.history[0],'__proto__',{});},UNSAFE],
 ['"__proto__" in the binding',(f,s,w)=>{own(w,'__proto__',{});},UNSAFE],
 ['"__proto__" in a copy of unsent text',f=>{own(f.recovery[0],'__proto__',{});},UNSAFE],
 ['"constructor" in the draft',(f,s)=>{own(s,'constructor',{});},UNSAFE],
 ['"prototype" at the top of the file',f=>{f.prototype={};},UNSAFE],
 // unsent text and size bounds
 ['unsent text over 3000 characters',f=>{f.unsentText='x'.repeat(3001);},/niewysłany tekst w archiwum/],
 ['unsent text is not text',f=>{f.unsentText=null;},/niewysłany tekst w archiwum/],
 ['stored text over 3000 characters',f=>{f.entry.input='x'.repeat(3001);},/Nieprawidłowy niewysłany tekst/],
 ['envelope: extra field',f=>{f.entry.envelope.script='x';},/nieznane pola/],
 ['copies of unsent text: 257',f=>{f.recovery=Array.from({length:257},(_,i)=>({text:'t'+i,savedAt:T,baseVersion:1}));},/kopie niewysłanego tekstu/],
 ['copy of unsent text: not text',f=>{f.recovery[0].text=7;},/kopie niewysłanego tekstu/]
];

test('import: every malformed field of a file is refused with its reason; the bank, the unsent field and the preview stay as they were',async()=>{
 const TEXT='mój niewysłany tekst';
 const p=await H.load({jobs:[jobFixture(1,'Kuchnia')]});await p.type(TEXT);await p.click('manage-open');
 const before=p.local.dump();
 // control: the unchanged file is a valid archive and could be applied
 await p.choose(JSON.stringify(goodFile()),'dobre.json');
 const shown=p.text('import-preview');
 assert.match(shown,/pozycje szkicu: 2/);assert.match(shown,/wiadomości: 4/);assert.match(shown,/potwierdzenia zapisanych materiałów: 1/);assert.match(shown,/dodatkowe kopie niewysłanego tekstu: 1/);
 const ready=p.find('import-apply');assert.ok(ready&&!ready.disabled,'the control file is applicable');
 assert.equal(p.local.dump(),before);
 for(const [label,change,expected,keepBinding] of CASES){
  await p.choose(variant(change,keepBinding),label+'.json');
  assert.equal(p.els['import-preview'].hidden,false,label);
  assert.match(p.text('import-preview'),expected,label);
  const apply=p.find('import-apply');assert.ok(!apply||apply.disabled,label+': nothing to apply');
  // even past the missing button the file is not applied, and the preview with its reason stays for another try
  await p.run('hostImportApply()');await H.settle(4);
  assert.equal(p.local.dump(),before,label+': stored bytes unchanged');
  assert.equal(p.els.input.value,TEXT,label+': unsent field unchanged');
  assert.equal(p.els['manage-status'].className,'error',label);
  assert.equal(p.els['import-preview'].hidden,false,label+': preview kept');assert.match(p.text('import-preview'),expected,label);
 }
 // the same rules below the panel: the bank module with the application's validator, evaluated inside the page
 const verdict=text=>p.run('(()=>{try{return CBank.inspect('+JSON.stringify(text)+',CBank.empty(),{now:'+JSON.stringify(LATER)+',validate:envelopeCheck}).outcome;}catch(e){return "refused:"+e.code;}})()');
 assert.equal(verdict(JSON.stringify(goodFile())),'new');
 for(const [label,change,,keepBinding] of CASES)assert.equal(verdict(variant(change,keepBinding)),'refused:CORRUPT',label);
});

test('import: a valid file is stored exactly as it is; its copies of unsent text wait for an explicit choice and are never put into the field',async()=>{
 const file=goodFile(),text=JSON.stringify(file,null,2);
 const p=await H.load({jobs:[jobFixture(1,'Kuchnia')]});await p.type('moja rozmowa');
 await p.click('manage-open');await p.choose(text);await p.click('import-apply');
 const got=p.bank().contexts.find(e=>e.contextId===ids.ctx(5));
 assert.ok(got);assert.equal(JSON.stringify(got.envelope),JSON.stringify(file.entry.envelope),'draft, undo, changes, binding and receipts are stored verbatim');
 assert.equal(got.input,'tekst z pliku');assert.equal(got.version,file.entry.version);assert.equal(got.createdAt,file.entry.createdAt);assert.equal(got.jobId,ids.job(1));
 const copies=()=>DraftRecovery.list(p.local,ids.ctx(5)).records.map(r=>r.record.text);
 assert.deepEqual(copies(),['kopia z innej karty'],'the copy of unsent text from the file is kept');
 assert.match(p.els['manage-status'].textContent,/czekają przy tej rozmowie na jawny wybór/);
 assert.equal(p.els.input.value,'moja rozmowa');
 // the same file again: nothing changes, and it is said that the copies were not added a second time
 const after=p.local.dump();
 await p.choose(text);await p.click('import-apply');
 assert.equal(p.local.dump(),after);assert.match(p.els['manage-status'].textContent,/Bez zmian/);assert.match(p.els['manage-status'].textContent,/nie zostały dodane ponownie/);
 // opened: the stored unsent text is in the field; the copy is offered, not applied (although it names the same version)
 await p.run('hostExclusive(()=>{switchContext('+JSON.stringify(ids.ctx(5))+');render();})');await H.settle();
 assert.equal(p.els.input.value,'tekst z pliku');assert.equal(p.run('undo.length'),1);assert.equal(p.run('diffs.length'),3);
 assert.equal(p.bank().contexts.find(e=>e.contextId===ids.ctx(5)).input,'tekst z pliku');
 assert.ok(p.find('recovered-append'),'offered for an explicit choice');assert.ok(p.text('handoff-panel').includes('kopia z innej karty'));
 assert.deepEqual(copies(),['kopia z innej karty']);
});

test('import cannot replay acknowledgements of written materials: forged identity, deleted holder, older file',()=>{
 const holder=entry(18,{job:2,state:filledState(3,2),receipts:[receipt(2,1),receipt(2,2)],revision:4,version:9});
 const source=CBank.read(bankV1([holder,entry(1,{input:'inna rozmowa'})])).bank,file=CBank.portable(source,ids.ctx(18),{exportedAt:LATER});
 const adopt=(bank,f,o={})=>CBank.adopt(bank,JSON.stringify(f),{destination:'active',now:LATER,...o});
 const inspect=(bank,f)=>CBank.inspect(JSON.stringify(f),bank,{now:LATER});
 // another conversation id AND another draft identity, same acknowledged materials
 const forged=copy(file);forged.entry.contextId=ids.ctx(950);forged.entry.envelope.workspace.sourceId=ids.conv(950);
 const stored=CBank.serialize(source);
 let preview=inspect(source,forged);
 assert.equal(preview.outcome,'conflict');assert.equal(preview.relation,'receipts');assert.match(preview.reason,/należą już do innej rozmowy/);
 for(const destination of ['active','archived'])assert.throws(()=>adopt(source,forged,{destination}),code('CONFLICT'));
 assert.equal(CBank.serialize(source),stored);
 // the holder is in the archive, or was deleted: its materials are still not handed to another conversation
 const archived=CBank.archive(source,{contextId:ids.ctx(18),baseVersion:9,now:LATER}).bank;
 assert.throws(()=>adopt(archived,forged),code('CONFLICT'));
 const deleted=CBank.retire(source,{contextId:ids.ctx(18),baseVersion:9,now:LATER}).bank,afterDelete=CBank.serialize(deleted);
 preview=inspect(deleted,forged);
 assert.equal(preview.outcome,'conflict');assert.equal(preview.relation,'receipts');
 assert.throws(()=>adopt(deleted,forged,{restoreRetired:true}),code('CONFLICT'));
 // one shared material is enough
 const partial=copy(forged);partial.entry.envelope.workspace.receipts=[receipt(2,2)];
 assert.throws(()=>adopt(deleted,partial,{restoreRetired:true}),code('CONFLICT'));
 // an older file of the deleted conversation, from before its second material was written, cannot come back even on request
 const older=copy(file);older.entry.version=3;older.entry.envelope.workspace.receipts.pop();
 preview=inspect(deleted,older);
 assert.equal(preview.outcome,'retired');assert.equal(preview.restorable,false);
 assert.throws(()=>adopt(deleted,older,{restoreRetired:true}),code('RETIRED'));
 assert.equal(CBank.serialize(deleted),afterDelete);
 // the exact file restores the conversation with exactly its receipts, once
 const restored=adopt(deleted,file,{restoreRetired:true});
 assert.deepEqual(CBank.get(restored.bank,ids.ctx(18)).envelope.workspace.receipts,[receipt(2,1),receipt(2,2)]);
 assert.equal(restored.bank.retired.length,0);
 const again=adopt(restored.bank,file);
 assert.equal(again.changed,false,'the same file once more adds nothing');assert.equal(again.bank,restored.bank);
 assert.throws(()=>adopt(restored.bank,forged),code('CONFLICT'));
 // where nobody holds these materials the same file is an ordinary new conversation
 assert.equal(inspect(CBank.empty(),forged).outcome,'new');
});

test('an imported conversation whose job is missing stays read-only for materials until exactly that job exists here',async()=>{
 const jobs=[jobFixture(1,'Kuchnia')];
 const p=await H.load({jobs});
 await p.click('manage-open');await p.choose(JSON.stringify(archiveOf(entry(5,{job:9,state:filledState(2,1),input:'z innego urządzenia'}))));await p.click('import-apply');
 await p.run('hostExclusive(()=>{switchContext('+JSON.stringify(ids.ctx(5))+');render();})');await H.settle();
 const locked=()=>{const b=p.find('handoff-prepare');return !!b&&b.disabled&&/zapis materiałów jest wyłączony/.test(p.text('handoff-panel'));};
 assert.equal(locked(),true);
 // another job, even one that looks alike, changes nothing
 jobs.push(jobFixture(10,'Robota z pliku'));await p.click('job-refresh');
 assert.equal(locked(),true);
 assert.equal(p.bank().contexts.find(e=>e.contextId===ids.ctx(5)).jobId,ids.job(9),'never retargeted');
 // the very job of the conversation appears
 jobs.push(jobFixture(9,'Robota z pliku'));await p.click('job-refresh');
 assert.ok(!/zapis materiałów jest wyłączony/.test(p.text('handoff-panel')));
 const prepare=p.find('handoff-prepare');assert.ok(prepare&&!prepare.disabled);
 assert.equal(p.bank().contexts.find(e=>e.contextId===ids.ctx(5)).jobId,ids.job(9));
});

test('refused save: the text stays in the field, the retry is visible and works without retyping, the input-only conversation stays exportable',async()=>{
 const TEXT='tylko tekst — zapis odmówiony, „nie wysyłać”';
 const p=await H.load(),stored=p.local.getItem(KEY);
 assert.equal(p.els['save-retry'].hidden,true);
 p.local.refuse=k=>k===KEY;
 await p.type(TEXT);
 assert.equal(p.local.getItem(KEY),stored);assert.equal(p.els.input.value,TEXT);
 assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/Nie zapisano niewysłanego tekstu/);assert.match(p.els.status.textContent,/Zapisz tekst ponownie/);
 assert.equal(p.els['save-retry'].hidden,false);
 // handlers that reset the screen state do not clear the field or hide the retry
 await p.fire('offline');await p.els.cancel.onclick();await H.settle();
 assert.equal(p.els.input.value,TEXT);assert.equal(p.els['save-retry'].hidden,false);
 // exportable although nothing but unsaved text exists
 assert.equal(p.els.export.disabled,false);await p.click('export');
 const file=JSON.parse(p.downloads[0]);
 assert.equal(file.kind,CBank.ARCHIVE_KIND);assert.equal(file.unsentText,TEXT);assert.equal(file.entry.input,'');assert.deepEqual(file.entry.envelope.state.history,[]);assert.deepEqual(file.entry.envelope.state.items,[]);
 assert.equal(CBank.adopt(CBank.empty(),p.downloads[0],{destination:'active',now:LATER}).entry.input,TEXT,'the file restores the text elsewhere');
 // a retry while the refusal lasts changes nothing
 await p.click('save-retry');
 assert.equal(p.els['save-retry'].hidden,false);assert.equal(p.els.input.value,TEXT);assert.equal(p.local.getItem(KEY),stored);assert.equal(p.els.status.className,'error');
 // the obstacle is gone: one click saves the very same text
 p.local.refuse=null;
 await p.click('save-retry');
 assert.equal(p.bank().contexts[0].input,TEXT);assert.equal(p.els.input.value,TEXT);
 assert.equal(p.els['save-retry'].hidden,true);assert.notEqual(p.els.status.className,'error');assert.match(p.els.status.textContent,/jest zapisany w przeglądarce/);
});

test('text preserved nowhere: import and archive are refused, deleting another conversation still makes room, the field is never touched',async()=>{
 const p=await H.load();
 await p.type('pierwsza rozmowa');const first=p.active();await p.click('new');await p.type('druga rozmowa');const second=p.active();
 await p.click('manage-open');
 // the browser has no room: the recovery journal is refused, and so is every bank value that would carry the new text
 p.local.refuse=(k,v)=>k!==KEY||v.includes('NIEZAPISANY');
 const TEXT='druga rozmowa — NIEZAPISANY dopisek';
 await p.type(TEXT);
 const stored=p.local.getItem(KEY);
 assert.ok(!p.local.dump().includes('NIEZAPISANY'),'the text exists on the screen only');
 const note=()=>p.els['manage-status'];
 await p.choose(JSON.stringify(archiveOf(entry(41,{input:'z pliku'}))));await p.click('import-apply');
 assert.equal(note().className,'error');assert.match(note().textContent,/ani w rozmowie, ani w kopii awaryjnej/);
 assert.equal(p.local.getItem(KEY),stored);assert.equal(p.els.input.value,TEXT);assert.equal(p.els['import-preview'].hidden,false,'the chosen file stays for later');
 await p.click('manage-archive-'+first);
 assert.equal(note().className,'error');assert.match(note().textContent,/ani w rozmowie, ani w kopii awaryjnej/);assert.equal(p.local.getItem(KEY),stored);
 // deleting ANOTHER conversation is the way to make room; it goes through and says that the text is still unsaved
 await p.click('manage-delete-'+first);await p.check('manage-delete-ack');await p.click('manage-delete-confirm');
 let bank=p.bank();
 assert.equal(bank.retired.length,1);assert.equal(bank.retired[0].contextId,first);assert.equal(bank.contexts.length,1);assert.equal(bank.contexts[0].contextId,second);
 assert.equal(p.active(),second);assert.equal(p.els.input.value,TEXT);
 assert.match(note().textContent,/Usunięto rozmowę/);assert.match(note().textContent,/nadal nie jest w niej zapisany/);assert.equal(note().className,'error');
 assert.equal(p.els['save-retry'].hidden,false);assert.equal(p.els.export.disabled,false);
 // room is there now
 p.local.refuse=null;
 await p.click('save-retry');
 bank=p.bank();assert.equal(bank.contexts[0].input,TEXT);assert.equal(p.els.input.value,TEXT);assert.equal(p.els['save-retry'].hidden,true);
 await p.click('import-apply');
 assert.ok(p.bank().contexts.some(e=>e.contextId===ids.ctx(41)),'the kept preview is applied without choosing the file again');
});

test('a write the read-back cannot confirm is not repeated and not rolled back; the page re-reads the stored value on an explicit click',async()=>{
 // storage boundary
 const local=H.storage(),bank=CBank.read(bankV1([entry(1,{input:'a'})])).bank,raw=CBank.store(local,KEY,bank,null);
 const e=CBank.get(bank,ids.ctx(1)),next=CBank.commit(bank,{contextId:e.contextId,baseVersion:e.version,input:'b',envelope:e.envelope,now:LATER}).bank;
 local.drop=k=>k===KEY;
 const attempts=local.attempts.length;
 assert.throws(()=>CBank.store(local,KEY,next,raw),ex=>code('UNCONFIRMED')(ex)&&ex.unconfirmed===true);
 assert.equal(local.attempts.length,attempts+1,'exactly one write: no second, blind one');assert.equal(local.getItem(KEY),raw);
 // the page
 const p=await H.load();await p.type('zapisany tekst');
 const stored=p.local.getItem(KEY),bankWrites=()=>p.local.attempts.filter(a=>a[0]===KEY).length;
 p.local.drop=k=>k===KEY;
 const before=bankWrites();
 await p.type('zapisany tekst i dopisek');
 assert.equal(bankWrites(),before+1,'one attempt; nothing was written after it');
 assert.equal(p.local.getItem(KEY),stored);assert.equal(p.els.input.value,'zapisany tekst i dopisek');
 assert.equal(p.els.status.className,'error');assert.match(p.els.status.textContent,/nie został potwierdzony/);
 assert.equal(p.run('hostExternalStale'),true);assert.equal(p.run('inputSaved'),'zapisany tekst','memory still names the last confirmed text');
 const resync=p.find('handoff-resync');assert.ok(resync&&!resync.disabled,'the stored value is re-read only on an explicit click');
 assert.ok(p.local.dump().includes('zapisany tekst i dopisek'),'the text is held by the recovery journal meanwhile');
 p.local.drop=null;
 await p.click('handoff-resync');
 assert.equal(p.run('hostExternalStale'),false);assert.equal(p.els.input.value,'zapisany tekst i dopisek');
 assert.equal(p.bank().contexts[0].input,'zapisany tekst i dopisek','the kept text is then saved through the normal, compared write');
});
