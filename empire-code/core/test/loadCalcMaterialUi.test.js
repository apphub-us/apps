'use strict';
// Real shipped adapter + generated modules, explicitly simulated databases/DOM.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildHarness}=require('./helpers/loadCalcDom');const {makeIndexedDb,deterministicCrypto}=require('./helpers/jobIndexedDb');
const fields={lcMatLabel:'Conduit Żółć',lcMatSpecification:'3/4 inch\nTest part',lcMatQuantity:'120.00',lcMatUnit:'ft',lcMatItemStatus:'needed',lcMatLocation:'Basement\nPanel A',lcMatSupplier:'Test supplier',lcMatNotes:'List note <b>text</b>'};
const click=(h,id)=>h.$(id).dispatch('click');
function rig(){const jobs=makeIndexedDb(),measure=makeIndexedDb('empire_code_materials'),observations=makeIndexedDb('empire_code_measurements');return {jobs,measure,observations,indexedDB:{open(name,v){if(name==='empire_code_jobs')return jobs.indexedDB.open(name,v);if(name==='empire_code_materials')return measure.indexedDB.open(name,v);if(name==='empire_code_measurements')return observations.indexedDB.open(name,v);throw Error('unexpected DB');}}};}
async function flush(r){for(let i=0;i<3;i++){await r.jobs.control.flush();await r.measure.control.flush();await Promise.resolve();}}
async function setup(r=rig(),extra={}){const h=buildHarness({indexedDB:r.indexedDB,crypto:deterministicCrypto(extra.start||1),...extra});h.api.lcInit();await flush(r);return {h,r};}
async function job(h,r){h.api.lcJobNew();h.set('lcJobTitle','Material test job');assert.equal(await h.api.lcJobSave(h.api.LC_JOB.editor,h.$('lcJobSaveBtn')),true);await flush(r);return h.api.LC_JOB.current;}
async function begin(h){if(h.$('lcMatToggleBtn').attrs['aria-expanded']!=='true')click(h,'lcMatToggleBtn');await h.api.lcMatRefresh();click(h,'lcMatNewBtn');for(const[id,value]of Object.entries(fields))h.set(id,value);}
const save=h=>h.api.lcMatSave(h.api.LC_MAT.editor,h.$('lcMatSaveBtn'));
const live=h=>JSON.stringify({state:h.state(),calc:h.api.LC_CALC.key,draft:h.api.lcFavPayload(),design:h.api.lcSvcDesignObject(),analysis:h.api.LC_SVC.analysis,favorites:h.store.data,results:h.store.byKey});
const entries=h=>h.$('lcMatList').querySelectorAll('.lc-mat-item');
async function correct(h,id){return h.api.lcMatOpen(id,true,h.$('lcMatList').querySelectorAll('.lc-mat-correct')[0]);}
test('Materials are lazy, visible only on current saved cards and preserve the job database',async()=>{
 const {h,r}=await setup();assert.equal(h.$('lcMatHub'),undefined);const j=await job(h,r);assert.ok(h.$('lcMatHub'));assert.equal(r.measure.control.snapshot(),null);const before=r.jobs.control.snapshot(),state=live(h);await begin(h);assert.equal(await save(h),true);assert.equal(entries(h).length,1);assert.deepEqual(r.jobs.control.snapshot(),before);assert.equal(live(h),state);assert.equal(h.api.LC_JOB.current.revision.revisionId,j.revision.revisionId);
});
test('no quantity/unit/status facts guessed: mandatory fields refuse and keep draft',async()=>{
 const {h,r}=await setup();await job(h,r);click(h,'lcMatToggleBtn');await h.api.lcMatRefresh();click(h,'lcMatNewBtn');assert.equal(h.$('lcMatQuantity').value,'');assert.equal(h.$('lcMatUnit').value,'');assert.equal(h.$('lcMatItemStatus').value,'not_recorded');h.set('lcMatLabel','Keep this label');assert.equal(await save(h),false);assert.equal(h.$('lcMatLabel').value,'Keep this label');assert.equal(r.measure.control.count('revisions'),0);
});
test('unit change does not convert quantity; fractional pieces refuse without erasing entered fields',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);h.set('lcMatQuantity','12.50');h.set('lcMatUnit','pcs');assert.equal(h.$('lcMatQuantity').value,'12.50');assert.equal(await save(h),false);assert.equal(h.$('lcMatQuantity').value,'12.50');h.set('lcMatUnit','ft');assert.equal(await save(h),true);assert.match(h.$('lcMatList').textContent,/12.50 ft/);
});
test('material draft blocks job/new/edit navigation until explicit discard',async()=>{
 const {h,r}=await setup();const j=await job(h,r);await begin(h);const draft=h.api.LC_MAT.editor;h.api.lcJobNew();assert.equal(h.api.LC_MAT.editor,draft);assert.equal(h.api.LC_JOB.current,j);click(h,'lcJobEditBtn');assert.equal(h.api.LC_JOB.editor,null);assert.equal(h.api.LC_MAT.editor,draft);click(h,'lcMatDiscardBtn');click(h,'lcJobEditBtn');assert.ok(h.api.LC_JOB.editor);assert.equal(r.measure.control.count('revisions'),0);
});
test('change retains specification, needs reason and displays original history as inert text',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);assert.equal(await save(h),true);const a=(await h.api.LC_MAT.store.list(h.api.LC_MAT.jobId)).materials[0].current;await correct(h,a.materialId);assert.equal(h.$('lcMatSpecification').value,fields.lcMatSpecification);h.set('lcMatQuantity','119.95');assert.equal(await save(h),false);h.set('lcMatReason','Corrected transcription');assert.equal(await save(h),true);const state=live(h);const entry=(await h.api.LC_MAT.store.read(h.api.LC_MAT.jobId,a.materialId));assert.equal(entry.history.length,2);assert.equal(entry.history[1].item.quantityText,'120.00');assert.equal(entry.current.item.quantityText,'119.95');await h.api.lcMatOpen(a.materialId,false,h.$('lcMatList').querySelectorAll('.lc-mat-history')[0]);assert.match(h.$('lcMatView').textContent,/120.00/);assert.equal(h.$('lcMatView').querySelectorAll('input, textarea, select').length,0);assert.equal(live(h),state);assert.ok(h.dom.walk(h.$('lcMatView')).every(n=>!n.innerHTMLWrites));
});
test('two UI clients keep conflict draft and can view latest before explicit reload',async()=>{
 const shared=rig(),{h:a}=await setup(shared);const j=await job(a,shared);await begin(a);await save(a);const m=(await a.api.LC_MAT.store.list(j.head.jobId)).materials[0].current;
 const {h:b}=await setup(shared,{start:100});await b.api.lcJobOpen(j.head.jobId);click(b,'lcMatToggleBtn');await b.api.lcMatRefresh();await correct(a,m.materialId);await correct(b,m.materialId);a.set('lcMatQuantity','119');a.set('lcMatReason','Window A');b.set('lcMatQuantity','118');b.set('lcMatReason','Window B');assert.equal(await save(a),true);assert.equal(await save(b),false);assert.equal(b.$('lcMatQuantity').value,'118');assert.equal(b.api.LC_MAT.editor.conflict,true);assert.equal(b.$('lcMatSaveBtn').disabled,true);click(b,'lcMatLatestBtn');await flush(shared);assert.equal(b.$('lcMatQuantity').value,'118');assert.match(b.$('lcMatView').textContent,/119/);click(b,'lcMatReloadBtn');await flush(shared);assert.equal(b.$('lcMatQuantity').value,'119');assert.equal(b.api.LC_MAT.editor.conflict,false);assert.equal(shared.measure.control.count('revisions'),2);
});
test('busy save and late abort preserve all inputs; no success before commit',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);const hold=r.measure.control.holdNextCommit('readwrite');const pending=save(h);await hold.reached;assert.equal(h.$('lcMatQuantity').disabled,true);assert.match(h.$('lcMatStatus').textContent,/Saving/);assert.equal(r.measure.control.count('revisions'),0);hold.abort('QuotaExceededError');assert.equal(await pending,false);assert.equal(h.$('lcMatQuantity').value,'120.00');assert.equal(h.$('lcMatQuantity').disabled,false);assert.equal(h.api.LC_MAT.editor.fields.notes,fields.lcMatNotes);assert.equal(await save(h),true);
});
test('refresh list cannot discard a draft; detached Save cannot write after discard',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);assert.equal(h.$('lcMatLocation').tagName,'TEXTAREA'); h.set('lcMatLocation','Panel A\nL1–N'); const draft=h.api.LC_MAT.editor,old=h.$('lcMatSaveBtn');await h.api.lcMatRefresh();assert.equal(h.api.LC_MAT.editor,draft);click(h,'lcMatDiscardBtn');old.dispatch('click');await flush(r);assert.equal(r.measure.control.count('revisions'),0);
});
test('new document uses same saved journal without creating old job metadata revisions',async()=>{
 const shared=rig(),{h}=await setup(shared);const j=await job(h,shared);await begin(h);await save(h);const before=shared.jobs.control.snapshot();const {h:b}=await setup(shared,{start:200});await b.api.lcJobOpen(j.head.jobId);click(b,'lcMatToggleBtn');await b.api.lcMatRefresh();assert.equal(entries(b).length,1);assert.match(b.$('lcMatList').textContent,/120.00 ft/);assert.deepEqual(shared.jobs.control.snapshot(),before);assert.equal(b.api.LC_CALC.attempted,false);
});
test('late read cannot replace a newer material editor',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);await save(h);const entry=(await h.api.LC_MAT.store.list(h.api.LC_MAT.jobId)).materials[0];const store=h.api.LC_MAT.store;let release;const original=store.read;store.read=()=>new Promise(res=>{release=res;});const pending=h.api.lcMatOpen(entry.current.materialId,true,h.$('lcMatList').querySelectorAll('.lc-mat-correct')[0]);await Promise.resolve();await Promise.resolve();click(h,'lcMatNewBtn');h.set('lcMatLabel','New draft wins');release({ok:true,...entry});await pending;assert.equal(h.$('lcMatLabel').value,'New draft wins');assert.equal(h.api.LC_MAT.editor.base,null);store.read=original;
});


test('a late job-open response cannot replace a material draft opened while it was pending',async()=>{
 const {h,r}=await setup();const a=await job(h,r);const b=(await h.api.LC_JOB.store.create({title:'Other job',address:'',notes:''},[])).job;
 const store=h.api.LC_JOB.store,original=store.read;let release;store.read=()=>new Promise(res=>{release=res;});
 const pending=h.api.lcJobOpen(b.head.jobId);await Promise.resolve();await Promise.resolve();await begin(h);h.set('lcMatNotes','Keep my draft');
 release({ok:true,job:b});await pending;assert.equal(h.api.LC_JOB.current.head.jobId,a.head.jobId);assert.equal(h.$('lcMatNotes').value,'Keep my draft');assert.ok(h.api.LC_MAT.editor);store.read=original;
});

test('material and measurement drafts cannot replace each other in either direction',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);h.set('lcMatNotes','Keep material notes');click(h,'lcMeasToggleBtn');await h.api.lcMeasRefresh();click(h,'lcMeasNewBtn');assert.equal(h.api.LC_MEAS.editor,null);assert.equal(h.$('lcMatNotes').value,'Keep material notes');
 click(h,'lcMatDiscardBtn');click(h,'lcMeasNewBtn');h.set('lcMeasLabel','Keep measurement label');click(h,'lcMatNewBtn');assert.equal(h.api.LC_MAT.editor,null);assert.equal(h.$('lcMeasLabel').value,'Keep measurement label');assert.equal(r.measure.control.count('revisions'),0);assert.equal(r.observations.control.count('revisions'),0);
});
test('delayed material-edit response cannot replace a newly opened measurement draft',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);await save(h);const entry=(await h.api.LC_MAT.store.list(h.api.LC_MAT.jobId)).materials[0];let release;const store=h.api.LC_MAT.store,original=store.read;store.read=()=>new Promise(res=>{release=res;});
 const pending=h.api.lcMatOpen(entry.current.materialId,true,h.$('lcMatList').querySelectorAll('.lc-mat-correct')[0]);await Promise.resolve();await Promise.resolve();click(h,'lcMeasToggleBtn');click(h,'lcMeasNewBtn');h.set('lcMeasLabel','Measurement draft wins');release({ok:true,...entry});await pending;assert.equal(h.api.LC_MAT.editor,null);assert.equal(h.$('lcMeasLabel').value,'Measurement draft wins');store.read=original;
});
test('saved Not needed item and prior Needed version remain visible as plain-text history',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);await save(h);const a=(await h.api.LC_MAT.store.list(h.api.LC_MAT.jobId)).materials[0].current;await correct(h,a.materialId);h.set('lcMatItemStatus','not_needed');h.set('lcMatReason','Scope changed');assert.equal(await save(h),true);assert.match(h.$('lcMatList').textContent,/Not needed/);assert.match(h.$('lcMatList').textContent,/120.00 ft/);const r2=await h.api.LC_MAT.store.read(h.api.LC_MAT.jobId,a.materialId);assert.equal(r2.history.length,2);assert.equal(r2.history[1].item.status,'needed');
});
test('missing material module has an explicit message while job metadata remains usable',async()=>{
 const {h,r}=await setup(undefined,{missing:['jobMaterial']});const j=await job(h,r);assert.match(h.$('lcMatHub').textContent,/unavailable/);assert.equal(h.$('lcMatNewBtn'),undefined);click(h,'lcJobEditBtn');h.set('lcJobNotes','Edit still works');assert.equal(await h.api.lcJobSave(h.api.LC_JOB.editor,h.$('lcJobSaveBtn')),true);assert.equal(h.api.LC_JOB.current.head.jobId,j.head.jobId);
});
