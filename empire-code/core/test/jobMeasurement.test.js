'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/jobs/jobMeasurement');
const id = (p, n) => p + n.toString(16).padStart(32, '0');
const fields = patch => ({ label: 'L1–N under load', quantity: 'voltage', valueText: ' 120.00 ', unit: 'V', location: 'Panel A\nL1–N', measuredLocal: '2026-10-08T14:30', utcOffset: '-04:00', mode: 'AC', instrument: 'Meter 01', notes: 'Żółć ⚡ <script>plain text</script>', ...patch });
const meta = n => ({ measurementId: id('meas1_', n), revisionId: id('mrev1_', n), jobId: id('job1_', 1), jobRevisionId: id('jrev1_', 1), savedAt: '2026-10-08T18:31:00.000Z' });
const initial = patch => { const r = M.createInitial(fields(patch), meta(1)); assert.equal(r.ok, true, JSON.stringify(r)); return r.revision; };
const nextMeta = n => ({ revisionId: id('mrev1_', n), jobRevisionId: id('jrev1_', 2), savedAt: '2026-10-08T18:32:00.000Z' });
test('measurement preserves exact input strings, decimal precision, date offset and separate savedAt', () => {
 const f=fields(), r=initial(); assert.deepEqual(r.reading, f); assert.equal(r.measuredAt,'2026-10-08T18:30:00.000Z'); assert.equal(r.createdAt,meta(1).savedAt); assert.equal(r.correctionReason,''); assert.equal(Object.hasOwn(r,'installationApproved'),false);
});
test('all advertised quantity/unit pairs accept without conversion or replacement',()=>{
 for(const [quantity,units] of Object.entries(M.UNITS))for(const unit of units){const r=initial({quantity,unit,mode:'not_recorded',valueText:'-0.0500'});assert.equal(r.reading.valueText,'-0.0500');assert.equal(r.reading.unit,unit);}
});
test('wrong units and AC/DC combinations refuse; quantity cannot be a prototype key',()=>{
 for(const patch of [{quantity:'temperature',unit:'V'},{quantity:'current',unit:'V'},{quantity:'__proto__',unit:'V'},{mode:'guess'},{quantity:'temperature',unit:'degC',mode:'AC'}])assert.equal(M.validateFields(fields(patch)).ok,false);
});
test('decimal input is explicit; empty values, Infinity, separators and exponents do not become numbers',()=>{
 for(const valueText of ['', ' ', '1,000', '120,4', 'NaN', 'Infinity', '1e3','0x20','1/2', '9'.repeat(65)])assert.equal(M.validateFields(fields({valueText})).ok,false,valueText);
 for(const valueText of ['0','-0','+0.000','-.25','.25','120.',' -12.500 '])assert.equal(M.validateFields(fields({valueText})).ok,true,valueText);
});
test('observed local time and explicit offset distinguish ambiguous DST wall times',()=>{
 assert.equal(M.observedInstant('2026-11-01T01:30','-04:00'),'2026-11-01T05:30:00.000Z');assert.equal(M.observedInstant('2026-11-01T01:30','-05:00'),'2026-11-01T06:30:00.000Z');
 assert.equal(M.observedInstant('2026-10-08T14:30','+05:45'),'2026-10-08T08:45:00.000Z');
});
test('invalid calendar values or unspecified offsets refuse without local-time guessing',()=>{
 for(const [measuredLocal,utcOffset] of [['2026-02-29T12:00','+00:00'],['2026-04-31T12:00','+00:00'],['2026-10-08T24:00','+00:00'],['2026-10-08T12:00',''],['2026-10-08T12:00','-00:00'],['2026-10-08T12:00','+14:01'],['2026-10-08T12:00','-04:60']])assert.equal(M.validateFields(fields({measuredLocal,utcOffset})).ok,false);
 assert.equal(M.observedInstant('2024-02-29T12:00','+00:00'),'2024-02-29T12:00:00.000Z');
});
test('correction appends identity and reason, keeps original observation time and never mutates prior entry',()=>{
 const old=initial(), bytes=JSON.stringify(old);const r=M.createCorrection(old,fields({valueText:'119.90'}),'Transcription correction',nextMeta(2));assert.equal(r.ok,true);assert.equal(r.revision.revisionNumber,2);assert.equal(r.revision.parentRevisionId,old.revisionId);assert.equal(r.revision.createdAt,old.createdAt);assert.equal(r.revision.measuredAt,old.measuredAt);assert.equal(r.revision.jobRevisionId,nextMeta(2).jobRevisionId);assert.equal(JSON.stringify(old),bytes);
});
test('actual corrections require a reason; unchanged input writes no semantic change',()=>{
 const old=initial();assert.equal(M.createCorrection(old,fields({valueText:'119'}),'',nextMeta(2)).ok,false);const r=M.createCorrection(old,fields(),'unused explanation',nextMeta(2));assert.equal(r.ok,true);assert.equal(r.unchanged,true);assert.deepEqual(r.revision,old);
});
test('read returns independent copies and rejects changed derived UTC, future versions and extra fields',()=>{
 const old=initial(), read=M.readRevision(old);read.revision.reading.notes='changed return';assert.notEqual(old.reading.notes,'changed return');
 for(const patch of [{measuredAt:'2026-10-08T14:30:00.000Z'},{recordVersion:2},{extra:'bad'},{parentRevisionId:id('mrev1_',4)},{correctionReason:'bad initial'}])assert.equal(M.readRevision({...old,...patch}).ok,false);
});
test('unknown historic producer label is preserved within supported schema',()=>{
 const old=initial();old.producer.applicationRevision='earlier';assert.equal(M.readRevision(old).revision.producer.applicationRevision,'earlier');
});
test('hostile or non-JSON input is contained without invoking accessors',()=>{
 const getter=fields();let called=0;Object.defineProperty(getter,'notes',{get(){called++;throw Error('do not call');},enumerable:true});assert.equal(M.validateFields(getter).ok,false);assert.equal(called,0);
 const bad=[undefined,null,[],new Date(),Object.assign(Object.create({x:1}),fields()),{...fields(),extra:Infinity},{...fields(),extra:-0},{...fields(),notes:'x'.repeat(4001)}];
 for(const v of bad)assert.equal(M.validateFields(v).ok,false);
 const cycle=fields();cycle.extra=cycle;assert.equal(M.validateFields(cycle).ok,false);
});
test('complete chain is ordered by revision not clocks, while gaps and branches refuse',()=>{
 const a=initial(), b=M.createCorrection(a,fields({valueText:'119'}),'Fixed reading',{...nextMeta(2),savedAt:'2026-10-07T01:00:00.000Z'}).revision;
 const ok=M.assemble([b,a],a.jobId);assert.equal(ok.ok,true);assert.deepEqual(ok.measurements[0].history.map(r=>r.revisionNumber),[2,1]);
 for(const rows of [[b],[a,b,{...b,revisionId:id('mrev1_',3)}],[a,{...b,parentRevisionId:id('mrev1_',8)}],[a,{...b,createdAt:b.savedAt}]])assert.equal(M.assemble(rows,a.jobId).ok,false);
});
test('journal refuses foreign jobs and bounded revision growth',()=>{
 const a=initial();assert.equal(M.assemble([a],id('job1_',2)).ok,false);let last=a;
 for(let i=2;i<=50;i++){const r=M.createCorrection(last,fields({valueText:String(i)}),'Corrected recorded data',nextMeta(i));assert.equal(r.ok,true);last=r.revision;}
 assert.equal(M.createCorrection(last,fields({valueText:'51'}),'reason',nextMeta(51)).code,'LIMIT');
});
