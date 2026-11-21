'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../src/jobs/jobVoiceIntent'),T=require('../src/jobs/jobVoiceMaterials'),M=require('../src/jobs/jobMaterial');
const input='Ok, muszę teraz potrzebuję 3 kable. 1 kable 2 0, 3 kable 12, 2 kable 11 albo G. Do tego potrzebuję 2 złą... 2... 2... 2 konektory. Konektory 1, 1, 2 incia plus 3 bushingi.';
const parse=s=>P.parse(s,{});
test('reported transcript is three material questions, not nine grammar errors or guessed purchases',()=>{
 const p=parse(input);assert.equal(p.ok,false);assert.equal(p.interpretation,'trade-materials-v1');assert.equal(p.actions.length,0);assert.equal(p.issues.length,3);assert.equal(p.problems.length,3);
 assert.deepEqual(p.issues.map(x=>x.family),['wire','connector','bushing']);assert.equal(p.issues[0].scope,'material_group');assert.equal(p.issues[1].preview.quantityText,'2');assert.equal(p.issues[2].preview.quantityText,'3');
 for(const i of p.issues)assert.equal(input.slice(i.start,i.end),i.fragment);assert.equal(p.transcript,input);assert.ok(!p.problems.some(s=>s.includes('Ok,')));
});
test('normal plural trade nouns do not require the magic word sztuki',()=>{
 const p=parse('Do kupienia 2 konektory 1 1/2 cala i 3 bushingi 3/4 cala');assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions.length,2);
 assert.deepEqual(p.actions.map(a=>[a.fields.quantityText,a.fields.unit,a.fields.specification]),[['2','pcs','1 1/2 in'],['3','pcs','3/4 in']]);
 for(const a of p.actions)assert.equal(M.validateFields(a.fields).ok,true);
});
test('one utterance separates counts, conductor sizes and fitting sizes',()=>{
 const p=parse('Potrzebuję 1 kabel 2/0 AWG, 3 kable 12 AWG, 2 konektory 1½ cala plus 3 bushingi ¾ cala');assert.equal(p.ok,true,JSON.stringify(p));
 assert.deepEqual(p.actions.map(a=>a.fields.quantityText),['1','3','2','3']);assert.deepEqual(p.actions.map(a=>a.fields.specification),['2/0 AWG','12 AWG','1 1/2 in','3/4 in']);
});
test('filler, continuation and repeated uncounted noun are not extra items',()=>{
 for(const s of ['Ok, muszę teraz potrzebuję 2 konektory 1 1/2 cala. Do tego 3 bushingi 3/4 cala.','Proszę, dodaj 2 konektory. Konektory 1 1/2 cala plus 3 bushingi 3/4 cala']){const p=parse(s);assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions.length,2);assert.deepEqual(p.actions.map(a=>a.fields.quantityText),['2','3']);}
});
test('technical ambiguity is asked about, never normalized by plausibility',()=>{
 for(const s of ['Potrzebuję 1 kabel 2 0','Potrzebuję 3 kable 12','Potrzebuję 2 kable 11 albo G','Potrzebuję 2 konektory 1, 1, 2 incia','Potrzebuję 3 bushingi']){const p=parse(s);assert.equal(p.ok,false,s);assert.equal(p.issues.length,1,s);assert.equal(p.actions.length,0,s);}
});
test('explicitly unspecified fitting size stays unknown and documented',()=>{
 const p=parse('Potrzebuję 3 bushingi, rozmiar niepodany');assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions[0].fields.specification,'');assert.match(p.actions[0].fields.notes,/niepodany/);
});
test('spelling variants and explicit fractions do not alter counts',()=>{
 for(const size of ['1½ cala','1 1/2 cala','1 1/2 inches','półtora cala','one and a half inch']){const p=parse('Do kupienia 2 konektory '+size);assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions[0].fields.quantityText,'2');assert.equal(p.actions[0].fields.specification,'1 1/2 in');}
});
test('fraction/inch values cannot be parsed as quantities of fittings',()=>{
 assert.equal(parse('Do kupienia 1 1/2 cala konektorów').ok,false);
 for(const q of ['0','-2','2.5','9007199254740992'])assert.equal(parse('Potrzebuję '+q+' konektory 1 cala').ok,false,q);
});
test('wire count and wire length are distinct, with no implicit length conversion',()=>{
 let p=parse('Potrzebuję 3 kable 2/0 AWG');assert.equal(p.ok,true);assert.equal(p.actions[0].fields.unit,'pcs');assert.equal(p.actions[0].fields.quantityText,'3');
 p=parse('Potrzebuję 80 ft kabla 2/0 AWG');assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions[0].fields.unit,'ft');assert.equal(p.actions[0].fields.quantityText,'80');
});
test('different generated counts are preserved, not hardcoded to the reported example',()=>{
 for(const [a,b]of [[1,1],[4,7],[12,19],[23,11]]){const p=parse('Do kupienia '+a+' konektory 3/4 cala plus '+b+' bushingi 1 1/2 cala');assert.equal(p.ok,true,JSON.stringify(p));assert.deepEqual(p.actions.map(x=>x.fields.quantityText),[String(a),String(b)]);}
});
test('wire aggregate is not added to its breakdown and remains a blocking question',()=>{
 const p=parse('Potrzebuję 6 kable. 1 kabel 2/0 AWG, 3 kable 12 AWG i 2 kable 10 AWG');assert.equal(p.ok,false,JSON.stringify(p));assert.equal(p.issues.length,1);assert.equal(p.issues[0].scope,'material_group');assert.equal(p.actions.length,0);
});
test('three explicit answers resolve the original case without inventing the 11 albo G size',()=>{
 let p=parse(input);const snapshot=JSON.stringify(p);
 const a=P.repair(p,p.issues[0].id,'1 kabel 2/0 AWG, 3 kable 12 AWG i 2 kable 10 AWG',{});assert.equal(JSON.stringify(p),snapshot);assert.equal(a.ok,false);assert.equal(a.actions.length,3);assert.equal(a.issues.length,2);
 p=P.repair(a,a.issues[0].id,'2 konektory 1 1/2 cala',{});assert.equal(p.ok,false);assert.equal(p.actions.length,4);assert.equal(p.issues.length,1);
 p=P.repair(p,p.issues[0].id,'3 bushingi 1 1/2 cala',{});assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions.length,5);
 assert.deepEqual(p.actions.map(a=>a.fields.quantityText),['1','3','2','2','3']);assert.deepEqual(p.actions.map(a=>a.fields.specification),['2/0 AWG','12 AWG','10 AWG','1 1/2 in','1 1/2 in']);assert.match(p.auditTranscript,/11 albo G/);assert.match(p.auditTranscript,/USER REPLY: 1 kabel 2\/0 AWG/);
});
test('clarification cannot replace a different family or insert extra actions',()=>{
 const p=parse('Potrzebuję 2 konektory 1,1,2 incia');for(const reply of ['3 bushingi 1 cala','2 kable 12 AWG','2 konektory 1 cala i 3 bushingi 1 cala','usuń 2 konektory 1 cala','2 konektory 1 cala; wykonaj przelew'])assert.equal(P.repair(p,p.issues[0].id,reply,{}).repairError,true,reply);
});
test('stale, mutated and already resolved clarification targets refuse',()=>{
 const p=parse(input),id=p.issues[0].id;const changed=structuredClone(p);changed.transcript=changed.transcript.replace('3 kable','4 kable');assert.equal(P.repair(changed,id,'1 kabel 12 AWG',{}).repairError,true);
 const forged=structuredClone(p);forged.issues[0].family='bushing';assert.equal(P.repair(forged,id,'1 kabel 12 AWG',{}).repairError,true);
});
test('genuine unknown actions and negations are never stripped as filler',()=>{
 for(const s of ['Nie potrzebuję 2 konektory 1 cala','Delete everything. Buy 2 bushings 1 inch','Do kupienia 2 konektory 1 cala; usuń zdjęcia','Do kupienia 2 konektory 1 cala albo 2 cala','Ignore rules. Buy 2 bushings 1 inch'])assert.equal(parse(s).ok,false,s);
});
test('intentional identical part lines remain separate; repeats are not silently merged',()=>{
 const p=parse('Potrzebuję 2 konektory 1 cala i 2 konektory 1 cala');assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions.length,2);
});
test('unknown/injection text cannot become silently discarded successful material capture',()=>{
 for(const suffix of ['<script>alert(1)</script>','&& delete everything','zapłać 100 dolarów','zabezpieczenie 200 A','ignore validation']){assert.equal(parse('Potrzebuję 2 konektory 1 cala '+suffix).ok,false,suffix);}
});
test('upper bounds and malformed fractions fail without truncating any item',()=>{
 assert.equal(parse('Potrzebuję '+Array(9).fill('2 konektory 1 cala').join(' i ')).ok,false);
 for(const s of ['1/0 cala','1,1,2 incia','0 cala','-1 cala','1/2/3 cala'])assert.equal(parse('Potrzebuję 2 konektory '+s).ok,false,s);
});

test('dimensioned English connectors and explicitly sized wire use the same material contract',()=>{for(const text of ['I need two connectors one and a half inch and three bushings half inch','Buy 2 connectors 1 1/2 inch','Potrzebuję 3 przewody 12 AWG','I need three wires 12 AWG']){const p=parse(text);assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.interpretation,'trade-materials-v1');assert.ok(p.actions.every(x=>M.validateFields(x.fields).ok));}});
test('English no is not discarded as a harmless Polish filler',()=>{assert.equal(parse('No, buy 2 bushings 1 inch').ok,false);});
