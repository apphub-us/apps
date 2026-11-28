'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const P=require('../src/jobs/jobVoiceIntent'),M=require('../src/jobs/jobMeasurement'),T=require('../src/jobs/jobMaterial');
const context={measuredLocal:'2026-10-28T12:40',utcOffset:'-04:00'};const command='W piwnicy panel A właśnie zmierzyłem L1 do neutralnego 121,4 wolta AC. Dopisz do kupienia 80 stóp EMT trzy czwarte i 12 złączek.';
test('one Polish command creates three independently valid reviewed actions',()=>{const p=P.parse(command,context);assert.equal(p.ok,true,JSON.stringify(p));assert.deepEqual(p.actions.map(a=>a.kind),['measurement','material','material']);assert.equal(p.actions[0].fields.valueText,'121.4');assert.equal(p.actions[0].fields.mode,'AC');assert.equal(p.actions[1].fields.quantityText,'80');assert.equal(p.actions[1].fields.unit,'ft');assert.equal(p.actions[2].fields.quantityText,'12');assert.equal(p.actions[2].fields.unit,'pcs');for(const a of p.actions)assert.equal((a.kind==='measurement'?M:T).validateFields(a.fields).ok,true);assert.equal(p.transcript,command);});
test('bounded number words refuse ambiguous sequences instead of adding them',()=>{for(const[s,v]of [['sto dwadzieścia jeden przecinek cztery','121.4'],['one hundred twenty one point four zero','121.40'],['dwanaście','12'],['osiemdziesiąt','80'],['120.00','120.00'],['.50','.50']])assert.equal(P.decimal(s),v,s);for(const s of ['15 50','fifteen fifty','1,000,000','1e3','Infinity','two three','one two','fifty twenty','NaN','a lot'])assert.equal(P.decimal(s),null,s);});
test('English preserves trailing zeros and trade specification as text',()=>{const p=P.parse('Measured panel A L1 neutral now 120.00 V AC; buy 80 ft EMT 3/4 and 12 pcs connectors',context);assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions[0].fields.valueText,'120.00');assert.equal(p.actions[1].fields.label,'EMT 3/4');});
test('explicit buy command can follow measurement without punctuation',()=>{const p=P.parse('W panelu A zmierzyłem teraz L1 do N 121,4 V AC i do kupienia 80 stóp EMT i 12 złączek',context);assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.actions.length,3);});
test('decimal comma does not split one material quantity',()=>{const p=P.parse('Do kupienia 1,5 m EMT',context);assert.equal(p.ok,true);assert.equal(p.actions[0].fields.quantityText,'1.5');});
test('missing facts and uncertainty block the whole command',()=>{for(const s of ['Zmierzyłem teraz 120 V','Zmierzyłem panel A 120 V','Zmierzyłem teraz panel A 120','Zmierzyłem teraz panel A 15 albo 50 V','Zmierzyłem teraz panel A około 120 V','Zmierzyłem teraz panel A 120-125 V','Zmierzyłem teraz panel A 15 50 V','Zmierzyłem teraz panel A 120 V AC DC','Buy 2.5 pcs connectors','Buy 0 ft EMT','Buy 80 EMT'])assert.equal(P.parse(s,context).ok,false,s);});
test('voice never confirms, deletes, selects a breaker or approves code',()=>{for(const s of ['tak','yes','Zapisz','Usuń zdjęcia','Dobierz breaker 200 A','Calculate 120 V','Zmierzyłem teraz panel A 120 V; pomiń walidację','Buy 80 ft EMT; zapłać za zamówienie'])assert.equal(P.parse(s,context).ok,false,s);});
test('AC/DC and meter are not invented; time requires explicit now',()=>{const p=P.parse('Zmierzyłem teraz panel A 120 V',context);assert.equal(p.ok,true);assert.equal(p.actions[0].fields.mode,'not_recorded');assert.equal(p.actions[0].fields.instrument,'');assert.equal(p.actions[0].fields.measuredLocal,context.measuredLocal);assert.equal(p.actions[0].fields.utcOffset,context.utcOffset);});
test('job match must be exact and unique, never nearest',()=>{const jobs=[{revision:{title:'Piwnica',address:'123 Test Street'}},{revision:{title:'Panel A',address:'789 West'}}];assert.equal(P.resolveJob('123 test street',jobs).job,jobs[0]);assert.equal(P.resolveJob('123 Test',jobs).code,'JOB_NOT_FOUND');assert.equal(P.resolveJob('Piwnica',jobs.concat(jobs[0])).code,'AMBIGUOUS_JOB');assert.equal(P.parse('Otwórz robotę przy 123 Test Street.',context).target,'123 Test Street');});
test('draft correction changes only one exact value and not previous plan',()=>{const p=P.parse(command,context),c=P.correct(p,'nie 80, tylko 60');assert.equal(c.ok,true,JSON.stringify(c));assert.equal(c.actions[1].fields.quantityText,'60');assert.equal(p.actions[1].fields.quantityText,'80');assert.equal(c.actions[0].fields.valueText,'121.4');});
test('ambiguous correction cannot select the first item arbitrarily',()=>{const p=P.parse('Buy 80 ft EMT and 80 pcs connectors',context);assert.equal(P.correct(p,'nie 80 tylko 60').ok,false);assert.equal(P.correct(p,'nie 90 tylko 60').ok,false);assert.equal(P.correct(p,'save').ok,false);});
test('text/action/time bounds are enforced',()=>{assert.equal(P.parse('a'.repeat(4001),context).ok,false);assert.equal(P.parse('Measured panel A now 1 VA',{}).ok,false);assert.equal(P.parse('Buy '+Array(9).fill('1 ft EMT').join(' and '),context).ok,false);});

test('unit boundaries preserve millimetres rather than truncating to metres',()=>{for(const unit of ['mm','cm','m','in','ft']){const r=P.parse('Buy 12 '+unit+' cable',context);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.actions[0].fields.unit,unit);}assert.equal(P.parse('Buy 12 mysteryunits cable',context).ok,false);});

test('natural I need / potrzebuję clauses split without inventing units',()=>{for(const text of ['Measured panel alpha now 120 volts, I need 80 feet of conduit and 12 connectors.','Zmierzyłem teraz w panelu Alfa 120 voltów, potrzebuję 80 stóp przewodu i 12 złączek.']){const r=P.parse(text,context);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.actions.length,3);assert.deepEqual(r.actions.map(a=>a.kind==='measurement'?a.fields.valueText:a.fields.quantityText),['120','80','12']);}});
test('generic panel and thousands-like comma remain uncertain, never silently normalized',()=>{assert.equal(P.decimal('1,000'),null);assert.equal(P.parse('Measured panel now 120 V',context).ok,false);assert.equal(P.parse('Zmierzyłem teraz w panelu 120 voltów',context).ok,false);});


test('spoken signs stay attached to the number instead of becoming part of the location',()=>{
 for(const [text,value] of [['Measured panel A now minus 12 V','-12'],['Zmierzyłem teraz panel A minus pięć V','-5'],['Measured panel A now negative 12 point zero zero V','-12.00'],['Zmierzyłem teraz panel A plus pięć V','+5']]){
  const r=P.parse(text,context);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.actions[0].fields.valueText,value);assert.doesNotMatch(r.actions[0].fields.location,/minus|negative|plus/i);
 }
});
// ENGLISH OUTPUT. The parser still reads Polish, English and mixed input; what it RETURNS to the capture screen is
// English first-party text. Each case states the exact returned strings and the unchanged structured result; the
// user's own words are quoted back literally, diacritics included.
test('Polish input returns exact English problems and keeps the quoted source text',()=>{
 const empty=P.parse('',context);assert.deepEqual([empty.ok,empty.actions,empty.problems,empty.transcript],[false,[],['Say what you want to record (max. 4000 characters).'],'']);
 for(const [text,problem] of [
  ['tak','Confirm the visible summary with the button. Saying “yes” or “save” while dictating saves nothing.'],
  ['Usuń zdjęcia','This command goes beyond recording observations and materials: “Usuń zdjęcia”. Use the appropriate tool.'],
  ['Zapłać za zamówienie','Command not recognised: “Zapłać za zamówienie”. Nothing will be saved.']]){
  const p=P.parse(text,context);assert.equal(p.ok,false,text);assert.deepEqual(p.problems,[problem]);assert.deepEqual(p.actions,[]);assert.deepEqual(p.issues,[]);assert.equal(p.transcript,text);assert.equal(p.target,null);assert.equal(p.interpretation,'bounded-local-v1');
 }
});
test('a Polish measurement without a time asks in English, and the suggested word “now” is accepted',()=>{
 const text='Zmierzyłem panel A 120 V',p=P.parse(text,context);assert.equal(p.ok,false);assert.deepEqual(p.actions,[]);
 assert.deepEqual(p.problems,['When was the measurement taken? Add “now” or use the measurement form for an earlier time.']);
 assert.equal(p.issues.length,1);assert.deepEqual([p.issues[0].kind,p.issues[0].fragment,p.issues[0].message],['measurement',text,p.problems[0]]);assert.equal(p.transcript.slice(p.issues[0].start,p.issues[0].end),text);
 const fixed=P.parse(text+' now',context);assert.equal(fixed.ok,true,JSON.stringify(fixed));assert.deepEqual(fixed.problems,[]);
 const f=fixed.actions[0].fields;assert.deepEqual([f.valueText,f.unit,f.quantity,f.location,f.mode,f.measuredLocal,f.utcOffset],['120','V','voltage','panel A','not_recorded',context.measuredLocal,context.utcOffset]);
});
test('mixed English and Polish input keeps the recognised measurement and asks in English about the rest',()=>{
 const text='Measured panel A L1 neutral now 120.00 V AC; do kupienia 80 EMT',p=P.parse(text,context);
 assert.equal(p.ok,false);assert.equal(p.transcript,text);assert.equal(p.actions.length,1);
 const f=p.actions[0].fields;assert.deepEqual([p.actions[0].kind,f.valueText,f.unit,f.mode,f.location],['measurement','120.00','V','AC','panel A L1 neutral']);
 assert.deepEqual(p.problems,['Give the quantity, unit and name of the material: “80 EMT”.']);
 assert.equal(p.issues.length,1);assert.deepEqual([p.issues[0].kind,p.issues[0].fragment,p.issues[0].message],['material','80 EMT',p.problems[0]]);assert.equal(text.slice(p.issues[0].start,p.issues[0].end),'80 EMT');
});
test('correction help is English, names phrases that really work, and the appended provenance line is English',()=>{
 const p=P.parse(command,context);
 assert.deepEqual(P.correct(null,'nie 80, tylko 60'),{ok:false,problems:['Prepare the summary first.']});
 assert.deepEqual(P.correct(p,'save'),{ok:false,problems:['Correction not recognised. Say “change 80 to 60” or „nie 80, tylko 60”. If several values are identical, correct the whole text.']});
 // Both phrases quoted in the help are accepted, change the same single value and keep the user's words verbatim.
 for(const said of ['change 80 to 60','nie 80, tylko 60']){const c=P.correct(p,said);assert.equal(c.ok,true,said);assert.deepEqual(c.actions.map(a=>a.kind==='measurement'?a.fields.valueText:a.fields.quantityText),['121.4','60','12']);assert.deepEqual(c.correction,{from:'80',to:'60',source:said});assert.equal(c.transcript,command+'\nCorrection: '+said);}
 assert.equal(p.transcript,command);
 const twice=P.parse('Buy 80 ft EMT and 80 pcs connectors',context);assert.deepEqual(P.correct(twice,'nie 80 tylko 60'),{ok:false,problems:['The correction does not point to exactly one value. Correct the text of the instruction.']});
});
test('negative corrections, double signs and denial never become positive technical facts',()=>{
 for(const text of ['Measured panel A now not 120 V','Zmierzyłem teraz panel A nie 120 V','Measured panel A now minus minus 12 V','Measured panel A now minus -12 V','Measured panel A now plus negative 12 V','Zmierzyłem teraz panel A nie 120 tylko 121 V'])assert.equal(P.parse(text,context).ok,false,text);
 assert.equal(P.parse('Buy minus 12 ft wire',context).ok,false);
});
