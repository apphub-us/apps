'use strict';
// Conversation bank, layout 2: migration from the released layout 1, archive / restore / delete, portable archive import.
// Pure module tests on hand-written fixtures; no DOM, no browser, no network. Run: node --test tests/
const test=require('node:test'),assert=require('node:assert/strict');
const CBank=require('../candidate/browser/conversation-bank.js');
const H=require('./stage2-harness.cjs');
const {ids,T,entry,bankV1,receipt,filledState,blankState}=H;
const LATER='2026-11-02T08:30:00.000Z',copy=v=>JSON.parse(JSON.stringify(v));
const code=c=>e=>e instanceof CBank.BankError&&e.code===c;
const SHA='ab'.repeat(32);
// A released-layout bank with every kind of content the release could have stored.
function filledV1(){
 const list=[];
 for(let i=1;i<=16;i++)list.push(entry(i,{job:1,input:i%2?'niewysłany tekst '+i:'',state:filledState(i%3,1)}));       // one job at its limit
 list.push(entry(17,{input:'tylko tekst, nigdy nie wysłany'}));                                                      // input only, no job
 list.push(entry(18,{job:2,state:filledState(3,2),receipts:[receipt(2,1),receipt(2,2)],revision:4,version:9}));    // written materials
 list.push(entry(19,{source:77,state:filledState(1,1)}));                                                           // imported legacy draft
 return {list,raw:bankV1(list,{contextId:ids.ctx(19),importedAt:T,chars:321,sha256:SHA})};
}
const current=()=>CBank.read(filledV1().raw).bank;
const archiveText=(bank,contextId,extra={})=>JSON.stringify(CBank.portable(bank,contextId,{exportedAt:LATER,...extra}),null,2);
const adopt=(bank,text,o={})=>CBank.adopt(bank,text,{destination:'active',now:LATER,...o});

test('migration: a filled released bank is carried over entry for entry; legacy record, receipts and unsent text unchanged',()=>{
 const {list,raw}=filledV1(),found=CBank.read(raw);
 assert.equal(found.stored,1);
 const bank=found.bank,stored=CBank.serialize(bank);
 assert.equal(bank.contexts.length,list.length);
 for(const e of list)assert.equal(JSON.stringify(CBank.get(bank,e.contextId)),JSON.stringify(e),e.contextId);
 assert.deepEqual(bank.legacy,JSON.parse(raw).legacy);assert.equal(bank.serial,JSON.parse(raw).serial);
 assert.deepEqual(bank.archived,[]);assert.deepEqual(bank.retired,[]);
 assert.deepEqual(CBank.get(bank,ids.ctx(18)).envelope.workspace.receipts,[receipt(2,1),receipt(2,2)]);
 assert.equal(CBank.get(bank,ids.ctx(17)).input,'tylko tekst, nigdy nie wysłany');
 // the migrated value round-trips strictly and is a different layout version of the same kind
 assert.deepEqual(CBank.parse(stored),bank);assert.equal(CBank.read(stored).stored,CBank.VERSION);
 assert.notEqual(JSON.parse(stored).version,1);
 // an old client fails closed on it (and accepted the bytes it wrote itself), so it never overwrites the new layout
 assert.equal(H.releasedV1Reads(raw),'ACCEPTED');assert.equal(H.releasedV1Reads(stored),'UNSUPPORTED');
 // the strict current-layout reader does not silently treat old bytes as current
 assert.throws(()=>CBank.parse(raw),code('OUTDATED'));
 // migration is a pure function of the bytes: two tabs reach the same value
 assert.equal(CBank.serialize(CBank.read(raw).bank),stored);
});

test('migration: corrupt, extended, non-canonical or newer values are refused, never normalised',()=>{
 const {raw}=filledV1(),v1=JSON.parse(raw);
 assert.throws(()=>CBank.read(raw.slice(0,-7)),code('CORRUPT'));
 assert.throws(()=>CBank.read(JSON.stringify({...v1,extra:1})),code('CORRUPT'));
 assert.throws(()=>CBank.read(JSON.stringify(v1,null,1)),code('CORRUPT'));
 assert.throws(()=>CBank.read(JSON.stringify({...v1,version:3})),code('UNSUPPORTED'));
 assert.throws(()=>CBank.read(JSON.stringify({...v1,legacy:{...v1.legacy,contextId:ids.ctx(999)}})),code('CORRUPT'));
 const twice=copy(v1);twice.contexts[1].contextId=twice.contexts[0].contextId;
 assert.throws(()=>CBank.read(JSON.stringify(twice)),code('CORRUPT'));
 assert.throws(()=>CBank.read(null),code('CORRUPT'));
 // a layout 2 value with an unknown field or a duplicated identity across its lists is refused as well
 const v2=CBank.read(raw).bank;
 assert.throws(()=>CBank.parse(JSON.stringify({...v2,more:[]})),code('CORRUPT'));
 const dup=copy(v2);dup.archived.push({archivedAt:T,entry:dup.contexts[0]});
 assert.throws(()=>CBank.parse(JSON.stringify(dup)),code('CORRUPT'));
});

test('job limit: the 17th conversation is refused with the way out; archiving one makes room; restoring at the limit refuses without loss',()=>{
 let bank=current();const before=CBank.serialize(bank),job=ids.job(1);
 const fresh=n=>({contextId:ids.ctx(n),baseVersion:0,input:'',envelope:{state:blankState(),undo:[],diffs:[],workspace:H.workspace(blankState(),{source:n,job:1})},now:LATER});
 assert.throws(()=>CBank.commit(bank,fresh(40)),e=>code('LIMIT')(e)&&/Manage chats/.test(e.message)&&/Archive one of the/.test(e.message));
 assert.equal(CBank.serialize(bank),before,'a refusal changes nothing');
 const target=CBank.get(bank,ids.ctx(3)),kept=copy(target);
 bank=CBank.archive(bank,{contextId:target.contextId,baseVersion:target.version,now:LATER}).bank;
 assert.equal(CBank.get(bank,target.contextId),null,'archived conversations are not active');
 assert.equal(CBank.list(bank,job).length,15);assert.equal(CBank.archived(bank,job).length,1);
 const held=CBank.where(bank,target.contextId);
 assert.equal(held.state,'archived');assert.deepEqual(held.entry.envelope,kept.envelope);assert.equal(held.entry.input,kept.input);assert.equal(held.entry.jobId,kept.jobId);
 assert.notEqual(held.entry.version,kept.version,'the version a tab held before the archive is no longer current');
 bank=CBank.commit(bank,fresh(40)).bank;
 assert.equal(CBank.list(bank,job).length,16);
 // restore while the job is full again
 const full=CBank.serialize(bank);
 assert.throws(()=>CBank.restore(bank,{contextId:target.contextId,baseVersion:held.entry.version,now:LATER}),e=>code('LIMIT')(e)&&/The chat stays in the archive in full/.test(e.message));
 assert.equal(CBank.serialize(bank),full);assert.deepEqual(CBank.where(bank,target.contextId).entry,held.entry);
 // room again: the conversation comes back whole
 const other=CBank.get(bank,ids.ctx(5));
 bank=CBank.archive(bank,{contextId:other.contextId,baseVersion:other.version,now:LATER}).bank;
 bank=CBank.restore(bank,{contextId:target.contextId,baseVersion:held.entry.version,now:LATER}).bank;
 const back=CBank.get(bank,target.contextId);
 assert.deepEqual(back.envelope,kept.envelope);assert.equal(back.input,kept.input);assert.equal(back.createdAt,kept.createdAt);
 assert.equal(CBank.latest(bank,job).contextId,target.contextId,'a restored conversation is the most recent of its job');
 CBank.parse(CBank.serialize(bank));
});

test('total limit of active conversations: reached across jobs, archived ones are not counted, nothing is evicted',()=>{
 let bank=CBank.empty(),n=0,refusal=null;
 const add=()=>{n++;return CBank.commit(bank,{contextId:ids.ctx(n),baseVersion:0,input:'t'+n,envelope:{state:blankState(),undo:[],diffs:[],workspace:H.workspace(blankState(),{source:n,job:1+n%7})},now:LATER}).bank;};
 for(let i=0;i<500&&!refusal;i++){try{bank=add();}catch(e){refusal=e;n--;}}
 assert.ok(refusal&&code('LIMIT')(refusal)&&/Manage chats/.test(refusal.message),'a bounded number of active conversations');
 const total=bank.contexts.length;assert.ok(total>16,'the total limit is above one job');
 const first=CBank.get(bank,ids.ctx(1));
 bank=CBank.archive(bank,{contextId:first.contextId,baseVersion:first.version,now:LATER}).bank;
 bank=add();
 assert.equal(bank.contexts.length,total);assert.equal(bank.archived.length,1);
 assert.equal(CBank.where(bank,ids.ctx(1)).entry.input,'t1','the archived conversation is still there');
});

test('size limit: archiving does not free space, explicit deletion does; the refusal points to management',()=>{
 let bank=CBank.empty(),n=0,refusal=null;
 const big=()=>{n++;const s=blankState();s.history.push({role:'user',content:'x'.repeat(600000)});return {contextId:ids.ctx(n),baseVersion:0,input:'',envelope:{state:s,undo:[],diffs:[],workspace:null},now:LATER};};
 for(let i=0;i<20&&!refusal;i++){const change=big();try{bank=CBank.commit(bank,change).bank;}catch(e){refusal=e;n--;}}
 assert.ok(refusal&&code('LIMIT')(refusal),'the stored size is bounded');
 assert.match(refusal.message,/Manage chats/);assert.match(refusal.message,/the archive uses it too/);
 const count=bank.contexts.length;assert.ok(count>=2&&count<16,'the size limit was hit before any count limit');
 const a=CBank.get(bank,ids.ctx(1));
 bank=CBank.archive(bank,{contextId:a.contextId,baseVersion:a.version,now:LATER}).bank;
 assert.throws(()=>CBank.commit(bank,big()),code('LIMIT'),'an archived conversation still uses the space');n--;
 const held=CBank.where(bank,a.contextId);
 const gone=CBank.retire(bank,{contextId:a.contextId,baseVersion:held.entry.version,now:LATER});
 assert.ok(JSON.stringify(gone.tombstone).length<1000,'the deletion record is compact');
 bank=CBank.commit(gone.bank,big()).bank;
 assert.equal(bank.contexts.length,count);assert.equal(bank.retired.length,1);
});

test('deletion: compact identity record; a stale tab, a fresh save and a reused source cannot bring the conversation back',()=>{
 let bank=current();const e=CBank.get(bank,ids.ctx(18)),w=e.envelope.workspace;
 const result=CBank.retire(bank,{contextId:e.contextId,baseVersion:e.version,now:LATER});bank=result.bank;
 const t=result.tombstone;
 assert.deepEqual({contextId:t.contextId,jobId:t.jobId,sourceId:t.sourceId,sourceRevision:t.sourceRevision,version:t.version,receipts:t.receipts,retiredAt:t.retiredAt},
  {contextId:e.contextId,jobId:e.jobId,sourceId:w.sourceId,sourceRevision:w.sourceRevision,version:e.version,receipts:w.receipts,retiredAt:LATER});
 assert.ok(!JSON.stringify(t).includes('dodaj bushing'),'no conversation content stays in the record');
 assert.equal(CBank.where(bank,e.contextId).state,'retired');assert.equal(CBank.get(bank,e.contextId),null);
 const stored=CBank.serialize(bank);CBank.parse(stored);
 // the tab that still shows the conversation, at the version it holds
 assert.throws(()=>CBank.commit(bank,{contextId:e.contextId,baseVersion:e.version,input:'więcej',envelope:e.envelope,now:LATER}),code('RETIRED'));
 // a "new" save under the same identity, and a new conversation reusing the deleted source identity
 assert.throws(()=>CBank.commit(bank,{contextId:e.contextId,baseVersion:0,input:'',envelope:e.envelope,now:LATER}),code('RETIRED'));
 assert.throws(()=>CBank.commit(bank,{contextId:ids.ctx(500),baseVersion:0,input:'',envelope:e.envelope,now:LATER}),code('RETIRED'));
 assert.throws(()=>CBank.archive(bank,{contextId:e.contextId,baseVersion:e.version,now:LATER}),code('CONFLICT'));
 assert.throws(()=>CBank.retire(bank,{contextId:e.contextId,baseVersion:e.version,now:LATER}),code('CONFLICT'));
 assert.equal(CBank.serialize(bank),stored);
 // an archived conversation is not writable by the ordinary save path either
 const a=CBank.get(bank,ids.ctx(17)),archived=CBank.archive(bank,{contextId:a.contextId,baseVersion:a.version,now:LATER}).bank;
 assert.throws(()=>CBank.commit(archived,{contextId:a.contextId,baseVersion:a.version,input:'x',envelope:a.envelope,now:LATER}),code('ARCHIVED'));
 // exact base version: a conversation changed since it was shown is not archived or deleted
 const b=CBank.get(bank,ids.ctx(2));
 assert.throws(()=>CBank.archive(bank,{contextId:b.contextId,baseVersion:b.version+1,now:LATER}),code('CONFLICT'));
 assert.throws(()=>CBank.retire(bank,{contextId:b.contextId,baseVersion:b.version+1,now:LATER}),code('CONFLICT'));
});

test('deleting the imported legacy conversation keeps the import record: the legacy draft is never imported again',()=>{
 let bank=current();const legacyRaw=JSON.stringify(CBank.get(bank,ids.ctx(19)).envelope);
 bank.legacy={...bank.legacy,chars:legacyRaw.length};CBank.serialize(bank);
 for(const step of ['archive','retire']){
  const held=CBank.where(bank,ids.ctx(19));
  bank=CBank[step](bank,{contextId:ids.ctx(19),baseVersion:held.entry.version,now:LATER}).bank;
  assert.deepEqual(bank.legacy,{contextId:ids.ctx(19),importedAt:T,chars:legacyRaw.length,sha256:SHA},step);
  assert.equal(CBank.legacyStatus(bank,legacyRaw,SHA),'imported',step);
  assert.throws(()=>CBank.migrate(legacyRaw,{contextId:ids.ctx(600),now:LATER,sha256:SHA,bank}),code('MIGRATED'),step);
  CBank.parse(CBank.serialize(bank));
 }
 // a bank that somehow lost the record still refuses the deleted source instead of importing a duplicate
 const without={...bank,legacy:null};
 assert.throws(()=>CBank.migrate(legacyRaw,{contextId:ids.ctx(600),now:LATER,sha256:SHA,bank:without}),code('DUPLICATE'));
 // the record cannot be cleared while pointing nowhere
 assert.throws(()=>CBank.serialize({...bank,retired:[]}),code('INVALID'));
});

test('a started write to a job blocks archive, delete and import; the conversation and its receipts stay as they are',()=>{
 const pending=entry(30,{job:3,state:filledState(2,1),receipts:[receipt(3,1)],prepared:{phase:'pending'}});
 const editing=entry(31,{job:3,state:filledState(1,1),receipts:[receipt(3,1)]});editing.envelope.workspace.materialEdit={phase:'pending'};editing.envelope.workspace.sourceId=ids.conv(4242);
 const bank=CBank.read(bankV1([pending,editing,entry(32,{input:'inna'})])).bank,before=CBank.serialize(bank);
 for(const e of [pending,editing]){
  assert.equal(CBank.isPending(e.envelope),true);
  assert.throws(()=>CBank.archive(bank,{contextId:e.contextId,baseVersion:e.version,now:LATER}),ex=>code('PENDING')(ex)&&/Resume save/.test(ex.message));
  assert.throws(()=>CBank.retire(bank,{contextId:e.contextId,baseVersion:e.version,now:LATER}),code('PENDING'));
 }
 assert.equal(CBank.serialize(bank),before);
 assert.deepEqual(CBank.get(bank,pending.contextId).envelope.workspace.receipts,[receipt(3,1)]);
 // a file carrying a started write is not importable anywhere
 const file=archiveText(bank,pending.contextId),empty=CBank.empty();
 assert.equal(CBank.inspect(file,empty,{now:LATER}).outcome,'blocked');
 assert.throws(()=>adopt(empty,file),code('PENDING'));
 assert.deepEqual(empty,CBank.empty());
 // a conversation that is only being reviewed (nothing started) is not blocked
 const reviewed=entry(33,{job:3,state:filledState(1,1),prepared:{phase:'review'}}),b2=CBank.read(bankV1([reviewed])).bank;
 assert.equal(CBank.archive(b2,{contextId:reviewed.contextId,baseVersion:1,now:LATER}).bank.archived.length,1);
});

test('portable archive: an input-only conversation is exported with the exact field text and restored exactly; repeat is a no-op',()=>{
 const text='2 puszki 4"\n  — „nie wysyłać”\tżółć \\ {"a":1}';
 const source=CBank.read(bankV1([entry(1,{input:'starszy zapis pola'})])).bank;
 const file=archiveText(source,ids.ctx(1),{unsentText:text,recovery:[{text:'tekst z innej karty',savedAt:T,baseVersion:1}]});
 const parsed=JSON.parse(file);
 assert.equal(parsed.kind,CBank.ARCHIVE_KIND);assert.equal(parsed.unsentText,text);assert.deepEqual(parsed.entry.envelope.state.history,[]);
 assert.deepEqual(parsed.entry,CBank.get(source,ids.ctx(1)),'the stored conversation travels verbatim');
 const target=CBank.empty(),preview=CBank.inspect(file,target,{now:LATER});
 assert.deepEqual({outcome:preview.outcome,items:preview.items,history:preview.history,unsentText:preview.unsentText,jobId:preview.jobId,recovery:preview.recovery,refused:preview.refused},
  {outcome:'new',items:0,history:0,unsentText:text,jobId:null,recovery:1,refused:{active:'',archived:''}});
 assert.deepEqual(target,CBank.empty(),'a preview changes nothing');
 const first=adopt(target,file);
 assert.equal(first.changed,true);assert.equal(first.entry.contextId,ids.ctx(1));assert.equal(first.entry.input,text);
 assert.deepEqual(first.recovery,[{text:'tekst z innej karty',savedAt:T,baseVersion:1}]);
 assert.equal(CBank.get(first.bank,ids.ctx(1)).input,text);
 const stored=CBank.serialize(first.bank);
 // the same file again
 const second=adopt(first.bank,file);
 assert.equal(second.changed,false);assert.equal(second.bank,first.bank);assert.equal(CBank.serialize(second.bank),stored);
 assert.equal(CBank.inspect(file,first.bank,{now:LATER}).outcome,'identical');
 assert.equal(first.bank.contexts.length,1,'no duplicate');
 // also a no-op into the archive, and when the stored copy was archived meanwhile
 assert.equal(adopt(first.bank,file,{destination:'archived'}).changed,false);
 const moved=CBank.archive(first.bank,{contextId:ids.ctx(1),baseVersion:first.entry.version,now:LATER}).bank;
 assert.equal(adopt(moved,file).changed,false);
});

test('import: identities, receipts and times come from the file; an older file never overwrites a newer stored conversation',()=>{
 const source=current(),file=archiveText(source,ids.ctx(18)),original=CBank.get(source,ids.ctx(18));
 let bank=adopt(CBank.empty(),file).bank;
 const got=CBank.get(bank,ids.ctx(18));
 assert.deepEqual(got.envelope,original.envelope);assert.equal(got.jobId,original.jobId);assert.equal(got.version,original.version);
 assert.equal(got.createdAt,original.createdAt);assert.equal(got.updatedAt,original.updatedAt);
 assert.deepEqual(got.envelope.workspace.receipts,[receipt(2,1),receipt(2,2)]);
 // the stored conversation moves on; the old file is then a conflict, in both destinations, and nothing changes
 bank=CBank.commit(bank,{contextId:got.contextId,baseVersion:got.version,input:'nowszy tekst',envelope:got.envelope,now:LATER}).bank;
 const stored=CBank.serialize(bank),preview=CBank.inspect(file,bank,{now:LATER});
 assert.equal(preview.outcome,'conflict');assert.equal(preview.relation,'older');assert.match(preview.reason,/Import overwrites and merges nothing/);
 for(const destination of ['active','archived'])assert.throws(()=>adopt(bank,file,{destination}),code('CONFLICT'));
 assert.equal(CBank.serialize(bank),stored);assert.equal(CBank.get(bank,got.contextId).input,'nowszy tekst');
 // a file that is ahead of the stored conversation is not merged or applied either
 const ahead=JSON.parse(file);ahead.entry.version=got.version+5;ahead.unsentText='z innego urządzenia';
 assert.equal(CBank.inspect(JSON.stringify(ahead),bank,{now:LATER}).relation,'newer');
 assert.throws(()=>adopt(bank,JSON.stringify(ahead)),code('CONFLICT'));
 // the same draft identity under another conversation id would duplicate its materials
 const clone=JSON.parse(file);clone.entry.contextId=ids.ctx(900);
 assert.throws(()=>adopt(bank,JSON.stringify(clone)),e=>code('CONFLICT')(e)&&/would duplicate/.test(e.message));
 assert.equal(CBank.serialize(bank),stored);
});

test('import: capacity is checked before any change and nothing is evicted; the archive is offered as destination',()=>{
 const full=current(),donor=CBank.read(bankV1([entry(70,{job:1,input:'siedemnasta',state:filledState(1,1)})])).bank,file=archiveText(donor,ids.ctx(70));
 const before=CBank.serialize(full),preview=CBank.inspect(file,full,{now:LATER});
 assert.equal(preview.outcome,'new');assert.match(preview.refused.active,/Limit/);assert.equal(preview.refused.archived,'');
 assert.throws(()=>adopt(full,file),code('LIMIT'));assert.equal(CBank.serialize(full),before);
 const added=adopt(full,file,{destination:'archived'}).bank;
 assert.equal(CBank.list(added,ids.job(1)).length,16);assert.equal(CBank.where(added,ids.ctx(70)).state,'archived');
 for(const e of full.contexts)assert.deepEqual(CBank.get(added,e.contextId),e,'every other conversation is untouched');
});

test('import from a deleted conversation: refused by default, restored only on explicit request from a matching file',()=>{
 const source=current(),e=CBank.get(source,ids.ctx(18)),exact=archiveText(source,e.contextId);
 const bank=CBank.retire(source,{contextId:e.contextId,baseVersion:e.version,now:LATER}).bank,stored=CBank.serialize(bank);
 const preview=CBank.inspect(exact,bank,{now:LATER});
 assert.equal(preview.outcome,'retired');assert.equal(preview.restorable,true);assert.equal(preview.retiredAt,LATER);
 assert.throws(()=>adopt(bank,exact),ex=>code('RETIRED')(ex)&&/requires explicit confirmation in the import preview/.test(ex.message));
 assert.throws(()=>adopt(bank,exact,{restoreRetired:'yes'}),code('RETIRED'),'only the exact flag is a request');
 assert.equal(CBank.serialize(bank),stored);
 const restored=adopt(bank,exact,{restoreRetired:true});
 const back=CBank.get(restored.bank,e.contextId);
 assert.deepEqual(back.envelope,e.envelope);assert.deepEqual(back.envelope.workspace.receipts,[receipt(2,1),receipt(2,2)]);
 assert.ok(back.version>e.version,'a tab holding the deleted version still cannot write it');
 assert.equal(restored.bank.retired.length,0);assert.equal(restored.outcome,'retired');
 assert.throws(()=>CBank.commit(restored.bank,{contextId:e.contextId,baseVersion:e.version,input:'stara karta',envelope:e.envelope,now:LATER}),code('CONFLICT'));
 // files that do not match the deletion record are rejected even on explicit request
 const fewer=JSON.parse(exact);fewer.entry.envelope.workspace.receipts.pop();
 const other=JSON.parse(exact);other.entry.contextId=ids.ctx(901);
 const newer=JSON.parse(exact);newer.entry.version=e.version+3;
 for(const [label,file,why] of [['missing receipt',fewer,/confirmations of materials saved to the job differ/],['other conversation id',other,/identifiers do not together name/],['newer than the deletion',newer,/newer than the state at deletion/]]){
  const text=JSON.stringify(file),p=CBank.inspect(text,bank,{now:LATER});
  assert.equal(p.outcome,'retired',label);assert.equal(p.restorable,false,label);assert.match(p.reason,why,label);
  assert.throws(()=>adopt(bank,text,{restoreRetired:true}),code('RETIRED'),label);
 }
 assert.equal(CBank.serialize(bank),stored);
});

test('import: malformed, foreign, raw-recovery and oversized files are refused with the bank untouched',()=>{
 const source=current(),good=JSON.parse(archiveText(source,ids.ctx(17))),bank=CBank.empty();
 const cases=[
  ['truncated JSON',JSON.stringify(good).slice(0,-9),'CORRUPT'],['not an object','[1,2]','CORRUPT'],['empty','', 'CORRUPT'],
  ['extra top-level field',JSON.stringify({...good,note:'x'}),'CORRUPT'],['missing field',JSON.stringify({...good,recovery:undefined}),'CORRUPT'],
  ['newer archive version',JSON.stringify({...good,version:2}),'UNSUPPORTED'],
  ['raw recovery copy',JSON.stringify({kind:'empire-code.storage-recovery',version:2,bankRaw:CBank.serialize(source),screen:{state:blankState(),unsentText:'x'}}),'RAW'],
  ['raw legacy copy',JSON.stringify({kind:'empire-code.legacy-raw',version:1,legacyRaw:'{}'}),'RAW'],
  ['old draft export',JSON.stringify({kind:'empire-code.conversation-draft',version:1,contextId:ids.ctx(1),state:blankState(),workspace:null,unsentText:'x'}),'UNSUPPORTED'],
  ['a whole bank',CBank.serialize(source),'CORRUPT'],
  ['extra entry field',JSON.stringify({...good,entry:{...good.entry,owner:'x'}}),'CORRUPT'],
  ['entry job differs from its binding',JSON.stringify({...good,entry:{...good.entry,jobId:ids.job(9)}}),'CORRUPT'],
  ['bad conversation id',JSON.stringify({...good,entry:{...good.entry,contextId:'ctx1_XYZ'}}),'CORRUPT'],
  ['unsent text over the limit',JSON.stringify({...good,unsentText:'x'.repeat(CBank.LIMITS.inputChars+1)}),'CORRUPT'],
  ['recovery entry with extra field',JSON.stringify({...good,recovery:[{text:'a',savedAt:T,baseVersion:1,run:'x'}]}),'CORRUPT'],
  ['oversized file',' '.repeat(CBank.LIMITS.importChars+1),'LIMIT']
 ];
 for(const [label,text,expected] of cases){
  assert.throws(()=>CBank.inspect(text,bank,{now:LATER}),code(expected),label);
  assert.throws(()=>adopt(bank,text),code(expected),label);
 }
 // the application's own validators are applied to the file's conversation
 assert.throws(()=>CBank.inspect(JSON.stringify(good),bank,{now:LATER,validate:()=>{throw Error('szkic z pliku odrzucony');}}),e=>code('CORRUPT')(e)&&/szkic z pliku odrzucony/.test(e.message));
 assert.deepEqual(bank,CBank.empty());
 // exporting a deleted or unknown conversation is not possible
 assert.throws(()=>CBank.portable(source,ids.ctx(999),{exportedAt:LATER}),code('MISSING'));
});

test('storage boundary: a refused or changed write leaves the stored bytes exactly as they were',()=>{
 const local=H.storage(),bank=current(),raw=CBank.store(local,CBank.KEY,bank,null);
 const e=CBank.get(bank,ids.ctx(1)),next=CBank.archive(bank,{contextId:e.contextId,baseVersion:e.version,now:LATER}).bank;
 local.refuse=k=>k===CBank.KEY;
 assert.throws(()=>CBank.store(local,CBank.KEY,next,raw),ex=>code('QUOTA')(ex)&&ex.intact===true);
 assert.equal(local.getItem(CBank.KEY),raw);
 local.refuse=null;
 assert.throws(()=>CBank.store(local,CBank.KEY,next,'other bytes'),code('CHANGED'));
 assert.equal(local.getItem(CBank.KEY),raw);
 assert.throws(()=>CBank.store(local,CBank.LEGACY_KEY,next,null),code('INVALID'));
});
