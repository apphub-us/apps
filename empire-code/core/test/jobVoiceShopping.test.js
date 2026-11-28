'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict');const P=require('../src/jobs/jobVoiceIntent'),M=require('../src/jobs/jobMaterial');
const S='OK, dodaj do listy zakupów. Dwa Breakery, 20 amp firmy Zimens. Dodaj dwa kable, trzy zero, czerwony i czarny. Jakieś 50 fit i jeden. Dodaj również 15 busingów plastikowych, dwa busingi metalowe.';
const parse=s=>P.parse(s,{});
test('reported shopping transcript yields four bounded material groups without ignoring ratings, colours or types',()=>{
 const p=parse(S);assert.equal(p.ok,false);assert.equal(p.interpretation,'trade-materials-v1');assert.equal(p.problems.length,4);assert.equal(p.issues.length,4);assert.deepEqual(p.issues.map(i=>i.family),['breaker','wire','bushing','bushing']);assert.deepEqual(p.issues.map(i=>i.preview.quantityText),['2','2','15','2']);
 assert.equal(p.issues[0].preview.rating,'20 A');assert.equal(p.issues[0].preview.maker,'Zimens');assert.ok(!JSON.stringify(p).includes('Siemens'));assert.match(p.issues[1].fragment,/czerwony i czarny/);assert.match(p.issues[1].fragment,/Jakieś 50 fit i jeden/);assert.equal(p.issues[2].preview.knownType,'plastik');assert.equal(p.issues[3].preview.knownType,'metal');assert.equal(p.actions.length,0);for(const i of p.issues)assert.equal(S.slice(i.start,i.end),i.fragment);
});
test('normal shopping prefixes and translated plural nouns select the material path',()=>{
 for(const prefix of ['OK, dodaj do listy zakupów.','Proszę dodaj również','Dodaj jeszcze','Add to the shopping list:']){const p=parse(prefix+' 4 busingi metalowe 1 cala');assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions[0].fields.quantityText,'4');assert.match(p.actions[0].fields.specification,/metal/);}
});
test('breakers keep count, rating and literal maker/model separate and perform no compatibility selection',()=>{
 const p=parse('Do kupienia 2 breakery 20 amp firmy TestCo model X20');assert.equal(p.ok,true,JSON.stringify(p));const f=p.actions[0].fields;assert.equal(f.label,'Breaker');assert.equal(f.quantityText,'2');assert.equal(f.unit,'pcs');assert.equal(f.specification,'20 A · manufacturer: TestCo · model: X20');assert.equal(f.notes,'As stated in the capture — model, manufacturer and panel compatibility are not verified.');assert.equal(M.validateFields(f).ok,true);
 const raw=parse('Dodaj 1 breaker 20 A firmy Zimens model niepodany');assert.equal(raw.ok,true);assert.match(raw.actions[0].fields.specification,/Zimens/);assert.ok(!JSON.stringify(raw).includes('Siemens'));
});
test('breaker incompleteness and alternatives remain questions, not inferred standard types',()=>{
 for(const s of ['Dodaj 2 breakery 20 amp firmy Zimens','Dodaj 2 breakery firmy TestCo model X20','Dodaj 2 breakery 0 A model X20','Dodaj 2 breakery 20 A albo 30 A model X20','Dobierz 2 breakery 20 A model X20','Do kupienia 2 breakery 20 A model X20; usuń zdjęcia'])assert.equal(parse(s).ok,false,s);
});
test('busing and bushing spelling variants preserve explicit plastic/metal distinction',()=>{
 const p=parse('Dodaj również 15 busingów plastikowych 3/4 cala, dwa busingi metalowe 1 cala');assert.equal(p.ok,true,JSON.stringify(p));assert.deepEqual(p.actions.map(a=>[a.fields.quantityText,a.fields.specification]),[['15','3/4 in · material: plastic'],['2','1 in · material: metal']]);
 assert.equal(parse('Buy 3 bushings plastic metal 1 inch').ok,false);
});
test('short fitting-size answer keeps existing verified quantity/type and audits exact user answer',()=>{
 let p=parse('Dodaj 15 busingów plastikowych, dwa busingi metalowe');p=P.repair(p,p.issues[0].id,'3/4 cala',{});assert.equal(p.ok,false);assert.equal(p.actions[0].fields.quantityText,'15');assert.equal(p.actions[0].fields.specification,'3/4 in · material: plastic');assert.equal(p.issues[0].preview.quantityText,'2');
 p=P.repair(p,p.issues[0].id,'rozmiar niepodany',{});assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions[1].fields.quantityText,'2');assert.equal(p.actions[1].fields.specification,'material: metal');assert.equal(p.actions[1].fields.notes,'Size not given — explicitly confirmed.');assert.match(p.auditTranscript,/USER REPLY: 3\/4 cala/);assert.match(p.auditTranscript,/USER REPLY: rozmiar niepodany/);
});
test('a short reply cannot change fitting type/count or replace another family',()=>{
 const p=parse('Dodaj 15 busingów plastikowych');for(const answer of ['3/4','3/4 cala i 2 kable 12 AWG','3 breakery 20 A model X20','<script>1</script>'])assert.equal(P.repair(p,p.issues[0].id,answer,{}).repairError,true,answer);
 const changed=structuredClone(p);changed.issues[0].preview.quantityText='150';assert.equal(P.repair(changed,changed.issues[0].id,'1 cala',{}).repairError,true);
});
test('wire colours and explicitly per-piece length remain specification, never a computed total',()=>{
 const p=parse('Dodaj dwa kable 3/0 AWG, czerwony i czarny, po 50 ft');assert.equal(p.ok,true,JSON.stringify(p));const f=p.actions[0].fields;assert.equal(f.quantityText,'2');assert.equal(f.unit,'pcs');assert.equal(f.specification,'3/0 AWG · czerwony i czarny · 50 ft each');assert.ok(!f.specification.includes('100'));
});
test('spoken zero notation, vague length and unassigned lengths are never silently normalized',()=>{
 for(const s of ['Dodaj dwa kable, trzy zero, czerwony i czarny, po 50 ft','Dodaj dwa kable 3/0 AWG, czerwony i czarny, 50 ft','Dodaj dwa kable 3/0 AWG, jakieś 50 ft','Dodaj dwa kable 3/0 AWG, czerwony i czarny, po -50 ft'])assert.equal(parse(s).ok,false,s);
});
test('explicit answers resolve the screenshot without guessing model, wire size or lengths',()=>{
 let p=parse(S);const replies=['2 breakery 20 A firmy TestCo model TEST20','2 kable 3/0 AWG, czerwony i czarny, po 50 ft','3/4 cala','1 cala'];
 for(let i=0;i<replies.length;i++){p=P.repair(p,p.issues[0].id,replies[i],{});assert.equal(p.repairError,undefined,JSON.stringify(p));assert.equal(p.issues.length,3-i);}
 assert.equal(p.ok,true,JSON.stringify(p));assert.deepEqual(p.actions.map(a=>a.fields.quantityText),['2','2','15','2']);assert.equal(p.actions.length,4);assert.equal(p.originalTranscript,S);assert.match(p.auditTranscript,/trzy zero/);assert.match(p.auditTranscript,/Zimens/);assert.match(p.auditTranscript,/TEST20/);for(const a of p.actions)assert.equal(M.validateFields(a.fields).ok,true);
});
test('different explicit counts and dimensions follow the same schema without hardcoding the screenshot',()=>{
 for(const[a,b]of [[1,7],[23,18],[4,6]]){const p=parse('Add to the shopping list '+a+' breakers 30 amps brand TestCo model P30 and '+b+' bushings plastic 1 inch');assert.equal(p.ok,true,JSON.stringify(p));assert.deepEqual(p.actions.map(x=>x.fields.quantityText),[String(a),String(b)]);}
});
// ENGLISH OUTPUT. The Polish shopping transcript still yields the same four groups; the questions about the breaker
// and the two fittings, the preview headings and the generated specification text are exact English strings. The
// maker "Zimens" and the internal type tokens (knownType 'plastik' / 'metal') are exactly what they were.
test('the Polish shopping transcript is answered with exact English questions and unchanged structured previews',()=>{
 const p=parse(S),size='What size is the fitting? You can also explicitly say “size unknown”.';
 assert.equal(p.problems[0],'Confirm the manufacturer and give the model/type, or say “model unknown”. A name from the recording is not corrected automatically.');
 assert.deepEqual([p.problems[2],p.problems[3]],[size,size]);assert.deepEqual(p.issues.map(i=>i.message),p.problems);
 assert.deepEqual(p.issues.map(i=>i.preview.label),['Breakers','Wires','Bushings · plastic','Bushings · metal']);
 assert.deepEqual([p.issues[0].preview.rating,p.issues[0].preview.maker,p.issues[2].preview.knownType,p.issues[3].preview.knownType],['20 A','Zimens','plastik','metal']);
 assert.deepEqual(p.issues.map(i=>i.preview.quantityText),['2','2','15','2']);assert.equal(p.transcript,S);
});
test('Polish and English ways of saying the model is unknown give the same English specification',()=>{
 const one=parse('Dodaj 2 breakery 20 amp firmy Zimens');assert.equal(one.ok,false);
 assert.deepEqual(one.problems,['Confirm the manufacturer and give the model/type, or say “model unknown”. A name from the recording is not corrected automatically.']);
 for(const tail of ['model niepodany','model unknown']){const p=parse('Dodaj 1 breaker 20 A firmy Zimens '+tail);assert.equal(p.ok,true,JSON.stringify(p));
  assert.deepEqual(p.actions[0].fields,{label:'Breaker',specification:'20 A · manufacturer: Zimens · model: not given',quantityText:'1',unit:'pcs',status:'needed',location:'',supplier:'',notes:'As stated in the capture — model, manufacturer and panel compatibility are not verified.'});}
});
test('unknown leading actions are retained as blocking problems',()=>{
 for(const lead of ['No,','Ignore validation.','Order now.','Usuń dane.','Nie'])assert.equal(parse(lead+' dodaj do listy zakupów 2 busingi metalowe 1 cala').ok,false,lead);
});
