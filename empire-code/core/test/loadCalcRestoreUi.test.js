'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildHarness}=require('./helpers/loadCalcDom');const F=require('./helpers/archiveFixtures');
const file=()=>({ok:true,...F.fixture(),summary:{},warnings:[]});
function rig(returnValue){let calls=0;const h=buildHarness({archiveDecode:async()=>file(),restoreStoreFactory:()=>({restore:async()=>{calls++;return returnValue||{ok:true,jobId:F.J};},recover:async()=>({ok:true,recovered:0})})});h.api.lcInit();return {h,calls:()=>calls};}
test('read-only archive shows restore panel, confirmation required, and explicit click uses selected immutable file',async()=>{
 const {h,calls}=rig();assert.equal(await h.api.lcArcOpenFile({}),true);const agree=h.$('lcRestoreAgree'),button=h.$('lcRestoreRunBtn');assert.equal(button.disabled,true);assert.equal(calls(),0);
 agree.checked=true;agree.dispatch('change');assert.equal(button.disabled,false);assert.equal(await h.api.lcRestoreRun(),true);assert.equal(calls(),1);assert.match(h.$('lcRestoreStatus').textContent,/RESTORED/);assert.equal(button.disabled,true);
});
test('restore failure preserves opened archive and leaves confirmation explicit',async()=>{
 const {h,calls}=rig({ok:false,code:'EXISTS',problems:['already exists; no overwrite']});assert.equal(await h.api.lcArcOpenFile({}),true);
 h.$('lcRestoreAgree').checked=true;h.$('lcRestoreAgree').dispatch('change');assert.equal(await h.api.lcRestoreRun(),false);assert.equal(calls(),1);assert.match(h.$('lcRestoreStatus').textContent,/already exists/);assert.ok(h.api.LC_ARC.loaded);
});
test('archive close clears restore readiness but not unrelated calculator state',async()=>{
 const {h}=rig();assert.equal(await h.api.lcArcOpenFile({}),true);const initial=JSON.stringify(h.api.LC.snapshot);h.api.lcArcClear();assert.equal(h.api.LC_RESTORE.ready,false);assert.equal(h.$('lcRestoreControls').hasAttribute('hidden'),true);assert.equal(JSON.stringify(h.api.LC.snapshot),initial);
});
