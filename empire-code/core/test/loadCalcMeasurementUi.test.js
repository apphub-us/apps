'use strict';
// Real shipped adapter + generated modules, explicitly simulated databases/DOM.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildHarness}=require('./helpers/loadCalcDom');const {makeIndexedDb,deterministicCrypto}=require('./helpers/jobIndexedDb');
const fields={lcMeasLabel:'Test voltage Żółć',lcMeasQuantity:'voltage',lcMeasValue:'120.00',lcMeasUnit:'V',lcMeasLocation:'Panel A · L1–N',lcMeasObserved:'2026-10-08T14:30',lcMeasOffset:'-04:00',lcMeasMode:'AC',lcMeasInstrument:'Meter 01',lcMeasNotes:'Field note <b>text</b>'};
const click=(h,id)=>h.$(id).dispatch('click');
function rig(){const jobs=makeIndexedDb(),measure=makeIndexedDb('empire_code_measurements');return {jobs,measure,indexedDB:{open(name,v){if(name==='empire_code_jobs')return jobs.indexedDB.open(name,v);if(name==='empire_code_measurements')return measure.indexedDB.open(name,v);throw Error('unexpected DB');}}};}
async function flush(r){for(let i=0;i<3;i++){await r.jobs.control.flush();await r.measure.control.flush();await Promise.resolve();}}
async function setup(r=rig(),extra={}){const h=buildHarness({indexedDB:r.indexedDB,crypto:deterministicCrypto(extra.start||1),...extra});h.api.lcInit();await flush(r);return {h,r};}
async function job(h,r){h.api.lcJobNew();h.set('lcJobTitle','Measurement test job');assert.equal(await h.api.lcJobSave(h.api.LC_JOB.editor,h.$('lcJobSaveBtn')),true);await flush(r);return h.api.LC_JOB.current;}
async function begin(h){if(h.$('lcMeasToggleBtn').attrs['aria-expanded']!=='true')click(h,'lcMeasToggleBtn');await h.api.lcMeasRefresh();click(h,'lcMeasNewBtn');for(const[id,value]of Object.entries(fields))h.set(id,value);}
const save=h=>h.api.lcMeasSave(h.api.LC_MEAS.editor,h.$('lcMeasSaveBtn'));
const live=h=>JSON.stringify({state:h.state(),calc:h.api.LC_CALC.key,draft:h.api.lcFavPayload(),design:h.api.lcSvcDesignObject(),analysis:h.api.LC_SVC.analysis,favorites:h.store.data,results:h.store.byKey});
const entries=h=>h.$('lcMeasList').querySelectorAll('.lc-meas-item');
async function correct(h,id){return h.api.lcMeasOpen(id,true,h.$('lcMeasList').querySelectorAll('.lc-meas-correct')[0]);}
test('Measurements are lazy, visible only on current saved cards and preserve the job database',async()=>{
 const {h,r}=await setup();assert.equal(h.$('lcMeasHub'),undefined);const j=await job(h,r);assert.ok(h.$('lcMeasHub'));assert.equal(r.measure.control.snapshot(),null);const before=r.jobs.control.snapshot(),state=live(h);await begin(h);assert.equal(await save(h),true);assert.equal(entries(h).length,1);assert.deepEqual(r.jobs.control.snapshot(),before);assert.equal(live(h),state);assert.equal(h.api.LC_JOB.current.revision.revisionId,j.revision.revisionId);
});
test('no unit/time guessed: blank mandatory fields refuse and preserve typed draft',async()=>{
 const {h,r}=await setup();await job(h,r);click(h,'lcMeasToggleBtn');await h.api.lcMeasRefresh();click(h,'lcMeasNewBtn');assert.equal(h.$('lcMeasObserved').value,'');assert.equal(h.$('lcMeasOffset').value,'');assert.equal(h.$('lcMeasUnit').value,'');h.set('lcMeasLabel','Keep this label');assert.equal(await save(h),false);assert.equal(h.$('lcMeasLabel').value,'Keep this label');assert.equal(r.measure.control.count('revisions'),0);
});
test('Use current time is explicit and preserves value/location; quantity change never converts value',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);click(h,'lcMeasNowBtn');assert.match(h.$('lcMeasObserved').value,/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);assert.match(h.$('lcMeasOffset').value,/^[+-]\d\d:\d\d$/);h.set('lcMeasQuantity','temperature');assert.equal(h.$('lcMeasValue').value,'120.00');assert.equal(h.$('lcMeasUnit').value,'');assert.equal(h.$('lcMeasMode').value,'not_recorded');assert.equal(h.$('lcMeasLocation').value,fields.lcMeasLocation);
});
test('measurement draft blocks job/new/edit navigation until explicit discard',async()=>{
 const {h,r}=await setup();const j=await job(h,r);await begin(h);const draft=h.api.LC_MEAS.editor;h.api.lcJobNew();assert.equal(h.api.LC_MEAS.editor,draft);assert.equal(h.api.LC_JOB.current,j);click(h,'lcJobEditBtn');assert.equal(h.api.LC_JOB.editor,null);assert.equal(h.api.LC_MEAS.editor,draft);click(h,'lcMeasDiscardBtn');click(h,'lcJobEditBtn');assert.ok(h.api.LC_JOB.editor);assert.equal(r.measure.control.count('revisions'),0);
});
test('correction retains measured time, needs reason and displays original history as inert text',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);assert.equal(await save(h),true);const a=(await h.api.LC_MEAS.store.list(h.api.LC_MEAS.jobId)).measurements[0].current;await correct(h,a.measurementId);assert.equal(h.$('lcMeasObserved').value,fields.lcMeasObserved);h.set('lcMeasValue','119.95');assert.equal(await save(h),false);h.set('lcMeasReason','Corrected transcription');assert.equal(await save(h),true);const state=live(h);const entry=(await h.api.LC_MEAS.store.read(h.api.LC_MEAS.jobId,a.measurementId));assert.equal(entry.history.length,2);assert.equal(entry.history[1].reading.valueText,'120.00');assert.equal(entry.current.reading.valueText,'119.95');await h.api.lcMeasOpen(a.measurementId,false,h.$('lcMeasList').querySelectorAll('.lc-meas-history')[0]);assert.match(h.$('lcMeasView').textContent,/120.00/);assert.equal(h.$('lcMeasView').querySelectorAll('input, textarea, select').length,0);assert.equal(live(h),state);assert.ok(h.dom.walk(h.$('lcMeasView')).every(n=>!n.innerHTMLWrites));
});
test('two UI clients keep conflict draft and can view latest before explicit reload',async()=>{
 const shared=rig(),{h:a}=await setup(shared);const j=await job(a,shared);await begin(a);await save(a);const m=(await a.api.LC_MEAS.store.list(j.head.jobId)).measurements[0].current;
 const {h:b}=await setup(shared,{start:100});await b.api.lcJobOpen(j.head.jobId);click(b,'lcMeasToggleBtn');await b.api.lcMeasRefresh();await correct(a,m.measurementId);await correct(b,m.measurementId);a.set('lcMeasValue','119');a.set('lcMeasReason','Window A');b.set('lcMeasValue','118');b.set('lcMeasReason','Window B');assert.equal(await save(a),true);assert.equal(await save(b),false);assert.equal(b.$('lcMeasValue').value,'118');assert.equal(b.api.LC_MEAS.editor.conflict,true);assert.equal(b.$('lcMeasSaveBtn').disabled,true);click(b,'lcMeasLatestBtn');await flush(shared);assert.equal(b.$('lcMeasValue').value,'118');assert.match(b.$('lcMeasView').textContent,/119/);click(b,'lcMeasReloadBtn');await flush(shared);assert.equal(b.$('lcMeasValue').value,'119');assert.equal(b.api.LC_MEAS.editor.conflict,false);assert.equal(shared.measure.control.count('revisions'),2);
});
test('busy save and late abort preserve all inputs; no success before commit',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);const hold=r.measure.control.holdNextCommit('readwrite');const pending=save(h);await hold.reached;assert.equal(h.$('lcMeasValue').disabled,true);assert.match(h.$('lcMeasStatus').textContent,/Saving/);assert.equal(r.measure.control.count('revisions'),0);hold.abort('QuotaExceededError');assert.equal(await pending,false);assert.equal(h.$('lcMeasValue').value,'120.00');assert.equal(h.$('lcMeasValue').disabled,false);assert.equal(h.api.LC_MEAS.editor.fields.notes,fields.lcMeasNotes);assert.equal(await save(h),true);
});
test('refresh list cannot discard a draft; detached Save cannot write after discard',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);assert.equal(h.$('lcMeasLocation').tagName,'TEXTAREA'); h.set('lcMeasLocation','Panel A\nL1–N'); const draft=h.api.LC_MEAS.editor,old=h.$('lcMeasSaveBtn');await h.api.lcMeasRefresh();assert.equal(h.api.LC_MEAS.editor,draft);click(h,'lcMeasDiscardBtn');old.dispatch('click');await flush(r);assert.equal(r.measure.control.count('revisions'),0);
});
test('new document uses same saved journal without creating old job metadata revisions',async()=>{
 const shared=rig(),{h}=await setup(shared);const j=await job(h,shared);await begin(h);await save(h);const before=shared.jobs.control.snapshot();const {h:b}=await setup(shared,{start:200});await b.api.lcJobOpen(j.head.jobId);click(b,'lcMeasToggleBtn');await b.api.lcMeasRefresh();assert.equal(entries(b).length,1);assert.match(b.$('lcMeasList').textContent,/120.00 V/);assert.deepEqual(shared.jobs.control.snapshot(),before);assert.equal(b.api.LC_CALC.attempted,false);
});
test('late read cannot replace a newer measurement editor',async()=>{
 const {h,r}=await setup();await job(h,r);await begin(h);await save(h);const entry=(await h.api.LC_MEAS.store.list(h.api.LC_MEAS.jobId)).measurements[0];const store=h.api.LC_MEAS.store;let release;const original=store.read;store.read=()=>new Promise(res=>{release=res;});const pending=h.api.lcMeasOpen(entry.current.measurementId,true,h.$('lcMeasList').querySelectorAll('.lc-meas-correct')[0]);await Promise.resolve();await Promise.resolve();click(h,'lcMeasNewBtn');h.set('lcMeasLabel','New draft wins');release({ok:true,...entry});await pending;assert.equal(h.$('lcMeasLabel').value,'New draft wins');assert.equal(h.api.LC_MEAS.editor.base,null);store.read=original;
});


test('a late job-open response cannot replace a measurement draft opened while it was pending',async()=>{
 const {h,r}=await setup();const a=await job(h,r);const b=(await h.api.LC_JOB.store.create({title:'Other job',address:'',notes:''},[])).job;
 const store=h.api.LC_JOB.store,original=store.read;let release;store.read=()=>new Promise(res=>{release=res;});
 const pending=h.api.lcJobOpen(b.head.jobId);await Promise.resolve();await Promise.resolve();await begin(h);h.set('lcMeasNotes','Keep my draft');
 release({ok:true,job:b});await pending;assert.equal(h.api.LC_JOB.current.head.jobId,a.head.jobId);assert.equal(h.$('lcMeasNotes').value,'Keep my draft');assert.ok(h.api.LC_MEAS.editor);store.read=original;
});
