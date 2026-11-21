'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const R = require('../src/jobs/jobRestore'), F = require('./helpers/archiveFixtures');
test('full archive plans exact original job, result bytes, full version chains and original photo Blob without altering input', () => {
 const f = F.fixture(), before=JSON.stringify(f.manifest), p=R.plan({ok:true,...f});
 assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.jobId,F.J);assert.equal(p.records.empire_code_jobs.jobRevisions.length,2);assert.equal(p.records.empire_code_measurements.revisions.length,2);assert.equal(p.records.empire_code_materials.revisions.length,2);assert.equal(p.records.empire_code_photos.revisions.length,2);assert.equal(p.records.empire_code_photos.assets.length,1);assert.equal(p.records.empire_code_photos.assets[0].blob.size,f.assets[0].blob.size);assert.equal(p.results[0].raw, f.manifest.results[0].raw);assert.equal(JSON.stringify(f.manifest),before);
});
test('partial, missing or inconsistent linked results refuse an editable restore', () => {
 for(const raw of [null,'{}','{broken']){const f=F.fixture();f.manifest.results[0].raw=raw;assert.equal(R.plan({ok:true,...f}).code,'INCOMPLETE');}
 const f=F.fixture();f.manifest.results[0].raw=JSON.stringify({...F.resultRecord(),name:'changed'});assert.equal(R.plan({ok:true,...f}).code,'INCOMPLETE');
});
test('cannot plan without a verified archive and matching original blobs', () => {
 assert.equal(R.plan(null).code,'VALIDATION');const f=F.fixture();f.assets[0].blob=new Blob([],{type:'image/png'});assert.equal(R.plan({ok:true,...f}).code,'CORRUPT');
});
