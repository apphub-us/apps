'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../src/jobs/jobVoiceIntent');
const time={measuredLocal:'2026-10-28T12:34',utcOffset:'-04:00'};
const speech='Zmierzyłem teraz w panelu Alpha 120 V, potrzebuję 80% przewodu i 12 złączek.';
function state(text=speech){const p=P.parse(text,time);assert.equal(p.ok,false);return p;}
function first(p){assert.ok(p.issues.length);return p.issues[0].id;}
test('known unit transcription error yields exactly one source-bounded clarification',()=>{
 const p=state();assert.equal(p.actions.length,2);assert.equal(p.issues.length,1);
 const i=p.issues[0];assert.equal(i.kind,'material');assert.equal(i.fragment,'80% przewodu');assert.equal(p.transcript.slice(i.start,i.end),i.fragment);
 assert.equal(p.actions[0].fields.valueText,'120');assert.equal(p.actions[1].fields.quantityText,'12');
});
test('explicit clarification changes only selected material and keeps earlier facts/time',()=>{
 const p=state(),snapshot=JSON.stringify(p),r=P.repair(p,first(p),'80 ft przewodu',time);
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(JSON.stringify(p),snapshot);
 assert.deepEqual(r.actions.map(a=>a.kind==='measurement'?a.fields.valueText:a.fields.quantityText),['120','80','12']);
 assert.deepEqual(r.actions.map(a=>a.fields.unit),['V','ft','pcs']);assert.equal(r.actions[0].fields.measuredLocal,time.measuredLocal);
 assert.equal(r.originalTranscript,speech);assert.equal(r.repairs[0].before,'80% przewodu');assert.match(r.auditTranscript,/80% przewodu/);assert.match(r.auditTranscript,/80 ft przewodu/);
});
test('complete material voice response is accepted without duplicating its action verb',()=>{
 const p=state();for(const reply of ['Do kupienia 80 stóp przewodu','I need 80 feet of wire','80 ft przewodu']){const r=P.repair(p,first(p),reply,time);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.actions.length,3);assert.equal(r.actions[1].fields.unit,'ft');}
});
test('partial, unsafe and multi-action replies do not change the original draft',()=>{
 const p=state(),before=JSON.stringify(p);for(const reply of ['80','80% przewodu','ft','tak','Open job Other','80 ft wire and 12 pcs connectors','80 ft wire; measured panel B now 120 V','delete everything','-80 ft wire']){const r=P.repair(p,first(p),reply,time);assert.equal(r.repairError,true,reply);assert.equal(JSON.stringify(p),before);}
});
test('a reply for a stale span is refused, not applied to a different input',()=>{
 const p=state(),id=first(p);p.transcript=p.transcript.replace('80%','90%');const r=P.repair(p,id,'80 ft wire',time);assert.equal(r.repairError,true);assert.match(p.transcript,/90%/);
});
test('repeated identical failed fragment has no guessed replacement target',()=>{
 const p=state('Buy 80% wire and 80% wire');assert.equal(p.issues.length,0);assert.equal(P.repair(p,'span-4-12','80 ft wire',time).repairError,true);
});
test('multiple failures require separate repairs and never omit unresolved data',()=>{
 let p=state('Buy 80% wire and 3 mystery connectors');assert.equal(p.issues.length,2);
 p=P.repair(p,first(p),'80 ft wire',time);assert.equal(p.ok,false);assert.equal(p.issues.length,1);assert.equal(p.actions.length,1);
 p=P.repair(p,first(p),'3 pcs connectors',time);assert.equal(p.ok,true);assert.equal(p.repairs.length,2);assert.equal(p.actions.length,2);assert.equal(p.originalTranscript,'Buy 80% wire and 3 mystery connectors');
});
test('measurement clarification requires a full observation and preserves negative sign',()=>{
 const p=state('Measured panel now not 120 V');assert.equal(p.issues[0].kind,'measurement');
 assert.equal(P.repair(p,first(p),'120 V',time).repairError,true);assert.equal(P.repair(p,first(p),'Buy 12 ft wire',time).repairError,true);
 const r=P.repair(p,first(p),'Measured panel Alpha now minus 7 V',time);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.actions[0].fields.valueText,'-7');assert.equal(r.actions[0].fields.measuredLocal,time.measuredLocal);
});
test('clarification questions and refusals are exact English text; the draft and the quoted Polish fragment are unchanged',()=>{
 const p=state(),before=JSON.stringify(p);
 assert.deepEqual(p.problems,['Give the quantity, unit and name of the material: “80% przewodu”.']);assert.equal(p.issues[0].message,p.problems[0]);assert.equal(p.issues[0].fragment,'80% przewodu');
 assert.deepEqual(p.actions.map(a=>a.kind==='measurement'?a.fields.valueText:a.fields.quantityText),['120','12']);
 assert.deepEqual(P.repair(p,first(p),'80',time),{ok:false,repairError:true,problems:['Give only this material: quantity, unit and name. The other entries are kept.']});
 assert.deepEqual(P.repair(p,first(p),'',time),{ok:false,repairError:true,problems:['Choose the unrecognised fragment and give its full corrected text.']});
 assert.equal(JSON.stringify(p),before);
 const stale=state(),id=first(stale);stale.transcript=stale.transcript.replace('80%','90%');
 assert.deepEqual(P.repair(stale,id,'80 ft wire',time),{ok:false,repairError:true,problems:['The selected fragment is no longer current. Nothing was replaced.']});
 const m=state('Measured panel now not 120 V');assert.deepEqual(m.problems,['The measurement is ambiguous. Give one confirmed value and unit.']);
 assert.deepEqual(P.repair(m,first(m),'120 V',time),{ok:false,repairError:true,problems:['Repeat only this measurement: point, value, unit and “now”. The other entries are kept.']});
});
test('oversized responses and mutation of issue metadata are refused',()=>{
 const p=state();assert.equal(P.repair(p,first(p),'x'.repeat(1001),time).repairError,true);const id=first(p);p.issues[0].kind='measurement';assert.equal(P.repair(p,id,'80 ft wire',time).repairError,true);
});
test('unrecognized unrelated command remains a blocking problem after a valid clarification',()=>{
 const p=state(speech+' Ship the order.');const r=P.repair(p,first(p),'80 ft przewodu',time);assert.equal(r.ok,false);assert.ok(r.problems.some(x=>x.includes('Ship the order')));assert.equal(r.actions.length,3);
});


test('separated mathematical signs are retained; punctuation dashes cannot silently become positive',()=>{
 for(const [raw,value] of [['- 7','-7'],['+ 7','+7'],['− 7','-7'],['- 7.00','-7.00']]){const r=P.parse('Measured panel Delta now '+raw+' V',time);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.actions[0].fields.valueText,value);}
 for(const raw of ['– 7','— 7','- minus 7','- +7'])assert.equal(P.parse('Measured panel Delta now '+raw+' V',time).ok,false,raw);
});
test('explicit plural Polish foot unit is recognized without substituting a percent unit',()=>{
 const r=P.parse('Do kupienia 63 stopy przewodu i 14 złączek',time);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.actions[0].fields.unit,'ft');assert.equal(r.actions[0].fields.quantityText,'63');assert.equal(P.parse('Do kupienia 63% przewodu',time).ok,false);
});
test('later numeric correction remains in provenance after an earlier clarification',()=>{
 const p=state(),fixed=P.repair(p,first(p),'80 ft przewodu',time),r=P.correct(fixed,'nie 80 tylko 60');assert.equal(r.ok,true);assert.equal(r.actions[1].fields.quantityText,'60');assert.match(r.auditTranscript,/80% przewodu/);assert.match(r.auditTranscript,/nie 80 tylko 60/);
});

test('a spoken reply ending in a full stop replaces only its material, not the following connector entry',()=>{const p=state(),r=P.repair(p,first(p),'Eighty feet of wire.',time);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.actions.length,3);assert.equal(r.actions[1].fields.quantityText,'80');assert.equal(r.actions[2].fields.quantityText,'12');assert.match(r.auditTranscript,/Eighty feet of wire\./);});
