// Stage 5 correction — measurement evidence (one value span bound to one adjacent unit span), spoken PL / EN numbers,
// observation time, and the generalized speech prompt (docs/assistant-api-contract.md, sections 2.4, 3.3 and 3.4).
// Authored for coordinator execution; no run is claimed. No network: the transport is synthetic and every "model"
// answer is a hand-written function call. These tests prove what the APPLICATION accepts or refuses for a given call;
// they are NOT evidence of how a real model quotes Polish, English or mixed speech.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAssistantProvider} from '../candidate/server/assistant-provider.mjs';
import {createProvider,SPEECH_MODEL} from '../candidate/server/cloud-provider.mjs';
import {ASSISTANT_PROMPT} from '../candidate/server/assistant-prompt.mjs';
import {EMPTY} from './backend-fixtures.mjs';

const require=createRequire(import.meta.url);
const A=require('../candidate/server/assistant-contract.cjs');
const M=require('../core/src/jobs/jobMeasurement.js');
const V=require('../core/src/jobs/jobVoiceIntent.js');

const JOB={jobId:'job1_'+'a'.repeat(32),revisionId:'jrev1_'+'b'.repeat(32),revisionNumber:4,notesLength:0};
const CLOCK={local:'2026-11-21T14:05',utcOffset:'+01:00'};
const TOOL='ec_job_measurement_propose';
const called=(name,args)=>({status:'completed',output:[{type:'function_call',id:'fc_1',call_id:'call_1',name,arguments:JSON.stringify(args),status:'completed'}],usage:{total_tokens:1}});
function body(text,lang='pl',job=JOB){
 return{protocol:'ec.assist',version:1,requestId:'request-0001',text,state:EMPTY,assistant:{lang,contextToken:'ctx-00000001',baseFingerprint:A.baseFingerprint({revision:EMPTY.revision,toolDraft:null,form:null,job}),toolDraft:null,form:null,job,clock:job?CLOCK:null}};
}
const provider=createAssistantProvider({prompt:ASSISTANT_PROMPT,request:async()=>answer});
let answer=null;
async function propose(text,args,lang){answer=called(TOOL,args);return provider.assist(provider.checkAssist(body(text,lang)));}
const evidence=e=>e.safe===true&&e.code==='ASSIST_EVIDENCE'&&e.status===422;
// One reading claim. `value` is value_text; `said` the utterance (also the default source_quote).
const claim=(said,value,valueQuote,unit,unitQuote,location,extra={})=>({label:'Reading',quantity:Object.keys(M.UNITS).find(q=>M.UNITS[q].includes(unit)),value_text:value,value_quote:valueQuote,unit,unit_quote:unitQuote,
 reading_quote:valueQuote+' '+unitQuote,location,mode:'not_recorded',instrument:null,notes:null,source_quote:said,...extra});
async function accepted(said,args,lang){
 const out=await propose(said,args,lang),p=out.assistant.actionProposal;
 assert.equal(out.domain,'job_measurement',said);
 assert.deepEqual([p.fields.valueText,p.fields.unit,p.fields.quantity],[args.value_text,args.unit,args.quantity],said);
 assert.deepEqual([p.committed,p.requiresUserReview,p.timeOrigin,p.fields.measuredLocal,p.fields.utcOffset],[false,true,'client_clock',CLOCK.local,CLOCK.utcOffset]);
 assert.deepEqual(Object.keys(p),['kind','version','proposalId','committed','requiresUserReview','target','fields','measuredAt','timeOrigin','evidence','modelAuthored'],'public proposal shape unchanged');
 assert.deepEqual(p.evidence,{sourceQuote:args.source_quote,unitQuote:args.unit_quote});
 assert.equal(M.validateFields(p.fields).ok,true);
 return out;
}
const refused=(said,args,note)=>assert.rejects(propose(said,args),evidence,note||said);

const PL='pomiar L1-N, miernik Fluke 117, sto dwadzieścia woltów teraz';
const EN='Reading at panel A, L1 to neutral, meter Fluke 117, one hundred twenty volts AC just now';
const MIX='Zmierzyłem na breaker panel B, L2 to ground, dwieście osiem volts teraz';

test('spoken numbers: PL, EN and mixed number words are read by the existing bounded parser and bound to the adjacent unit',async()=>{
 const pl=await accepted(PL,claim(PL,'120','sto dwadzieścia','V','woltów','L1-N',{instrument:'Fluke 117'}));
 assert.equal(pl.assistant.actionProposal.fields.instrument,'Fluke 117');
 assert.ok(pl.reply.includes('120 V')&&!pl.reply.includes('117 V'));
 await accepted(EN,claim(EN,'120','one hundred twenty','V','volts','panel A, L1 to neutral',{mode:'AC',instrument:'Fluke 117'}),'en');
 await accepted(MIX,claim(MIX,'208','dwieście osiem','V','volts','breaker panel B, L2 to ground'));
 // The canonical value is exactly what jobVoiceIntent.decimal returns for the quoted span: no second number grammar.
 for(const[span,value]of [['sto dwadzieścia','120'],['one hundred twenty','120'],['dwieście osiem','208'],['minus pięć przecinek dwa','-5.2'],['121,4','121.4']])assert.equal(V.decimal(span),value,span);
 // A value the words do not state is refused: no conversion is invented.
 await refused(PL,claim(PL,'121','sto dwadzieścia','V','woltów','L1-N'));
 await refused(PL,claim(PL,'120.0','sto dwadzieścia','V','woltów','L1-N'));
 await refused(EN,claim(EN,'20','twenty','V','volts','panel A, L1 to neutral'),'part of a larger spoken number');
 await refused(EN,claim(EN,'100','one hundred','V','volts','panel A, L1 to neutral',{reading_quote:'one hundred twenty volts'}));
});

test('explicit decimals and signs stay exact: comma, dot, minus sign, minus word, decimal words',async()=>{
 const words='Temperatura w rozdzielni R2 teraz: minus pięć przecinek dwa stopnia Celsjusza';
 await accepted(words,claim(words,'-5.2','minus pięć przecinek dwa','degC','stopnia Celsjusza','w rozdzielni R2'));
 await refused(words,claim(words,'5.2','pięć przecinek dwa','degC','stopnia Celsjusza','w rozdzielni R2'),'the spoken minus is part of the value');
 await refused(words,claim(words,'-5','minus pięć','degC','stopnia Celsjusza','w rozdzielni R2'));
 const comma='Pomiar w rozdzielni R2 teraz: -5,25 °C';
 await accepted(comma,claim(comma,'-5.25','-5,25','degC','°C','w rozdzielni R2'));
 await refused(comma,claim(comma,'5.25','5,25','degC','°C','w rozdzielni R2'),'the minus sign is part of the value');
 await refused(comma,claim(comma,'-5.3','-5,25','degC','°C','w rozdzielni R2'),'no rounding');
 const dot='Measured 121.4 V at L1 in the main panel just now';
 await accepted(dot,claim(dot,'121.4','121.4','V','V','L1 in the main panel'),'en');
 const word='Temperatura minus 5 degC w rozdzielni R2';
 await accepted(word,claim(word,'-5','minus 5','degC','degC','w rozdzielni R2'));
 await refused(word,claim(word,'5','5','degC','degC','w rozdzielni R2'));
 const glued='L1-N w panelu głównym 120V AC teraz';
 await accepted(glued,claim(glued,'120','120','V','V','L1-N w panelu głównym',{mode:'AC',reading_quote:'120V'}));
 // "1,000" may be a thousand or a decimal, a detached dash may be a minus or a separator: neither is guessed.
 const thousand='Pomiar izolacji w panelu A teraz: 1,000 Mohm';
 for(const value of ['1000','1.000','1'])await refused(thousand,claim(thousand,value,'1,000','Mohm','Mohm','w panelu A'));
 const dash='L1-N w panelu A teraz - 120 V';
 await refused(dash,claim(dash,'120','120','V','V','w panelu A'));
 await refused(dash,claim(dash,'-120','- 120','V','V','w panelu A'));
});

test('the unit is the adjacent whole unit span and must name the claimed unit: wrong unit, "V" inside a word, letter case',async()=>{
 // Claimed ampere while the utterance says volts.
 await refused(PL,claim(PL,'120','sto dwadzieścia','A','woltów','L1-N'));
 await refused(PL,claim(PL,'120','sto dwadzieścia','A','A','L1-N'));
 await refused(PL,claim(PL,'120','sto dwadzieścia','mV','woltów','L1-N'));
 // The letter V inside a word is not a unit, with or without a number before the word.
 const inside='Odczyt 12 Vario w szafie R1 teraz';
 await refused(inside,claim(inside,'12','12','V','V','w szafie R1'));
 const noUnit='Pomiar L1-N w panelu głównym teraz: 120';
 await refused(noUnit,claim(noUnit,'120','120','V','V','w panelu głównym'),'a missing unit is never defaulted');
 const preposition='Zmierzyłem 5 w panelu A teraz';
 await refused(preposition,claim(preposition,'5','5','W','w','panelu A'),'Polish "w" is not watt');
 // SI letter case: mV is millivolt, MV is not a supported unit and never becomes mV.
 const milli='Zmierzyłem 5 mV na L1 w panelu teraz',mega='Zmierzyłem 5 MV na L1 w panelu teraz';
 await accepted(milli,claim(milli,'5','5','mV','mV','na L1 w panelu'));
 await refused(mega,claim(mega,'5','5','mV','MV','na L1 w panelu'));
 await refused(mega,claim(mega,'5','5','mV','mV','na L1 w panelu'));
 await refused(milli,claim(milli,'5','5','V','mV','na L1 w panelu'));
 // VAC / VDC name the volt and state the mode.
 const vac='L1-N w panelu głównym 120 VAC teraz';
 await accepted(vac,claim(vac,'120','120','V','VAC','L1-N w panelu głównym',{mode:'AC'}));
 await refused(vac,claim(vac,'120','120','V','VAC','L1-N w panelu głównym',{mode:'DC'}));
 // The strict unit and location arguments are still required and still checked.
 answer=called(TOOL,claim(PL,'120','sto dwadzieścia','kV','woltów','L1-N'));
 await assert.rejects(provider.assist(provider.checkAssist(body(PL))),e=>e.code==='ASSIST_ARGUMENTS');
 await refused(PL,claim(PL,'120','sto dwadzieścia','V','woltów','panel w kuchni'));
 await refused(PL,claim(PL,'120','sto dwadzieścia','V','woltów','L1-N',{source_quote:'pomiar L1-N, miernik Fluke 117'}),'the reading must lie inside the source quote');
});

test('an instrument model number is never the reading; a true pair inside a longer utterance is accepted',async()=>{
 await refused(PL,claim(PL,'117','117','V','woltów','L1-N'));
 await refused(PL,claim(PL,'117','117','V','woltów','L1-N',{reading_quote:'117, sto dwadzieścia woltów'}));
 await refused(EN,claim(EN,'117','117','V','volts','panel A, L1 to neutral'));
 const none='Zmierzyłem napięcie V na L1 w panelu miernikiem Fluke 117';
 await refused(none,claim(none,'117','117','V','V','na L1 w panelu'),'a number and a unit that merely both occur are not a reading');
 // Without a clause boundary two adjacent numbers are ambiguous; with one, the reading is clear.
 const adjacent='pomiar L1-N miernik Fluke 117 120 V teraz';
 await refused(adjacent,claim(adjacent,'120','120','V','V','L1-N'));
 const clear='pomiar L1-N, miernik Fluke 117, 120 V teraz';
 await accepted(clear,claim(clear,'120','120','V','V','L1-N',{instrument:'Fluke 117'}));
 // A rating of another quantity in the location does not compete with the reading.
 const rated='W panelu 100 A, L1-N 121,4 V teraz';
 await accepted(rated,claim(rated,'121.4','121,4','V','V','W panelu 100 A, L1-N'));
});

test('ranges, alternatives and several readings of one quantity are ambiguous and refused',async()=>{
 const cases=[
  ['Pomiar L1-N w panelu A teraz: 118-121 V','121','121'],
  ['Pomiar L1-N w panelu A teraz: od 118 do 121 V','121','121'],
  ['Pomiar L1-N w panelu A teraz: od 118 do 121 V','118','118'],
  ['Pomiar L1-N w panelu A teraz: 120 albo 121 V','121','121'],
  ['Reading at panel A, L1 to neutral: between 118 and 121 volts now','121','121'],
  ['Reading at panel A, L1 to neutral: 120 or 121 V now','120','120'],
  ['L1 120 V, L2 121 V w panelu głównym teraz','121','121'],
  ['L1 120 V, L2 121 V w panelu głównym teraz','120','120'],
  ['Na gniazdku 120 V zmierzyłem 118 V w panelu głównym teraz','118','118']
 ];
 for(const[said,value,quote]of cases)await refused(said,claim(said,value,quote,'V',said.includes('volts')?'volts':'V',said.includes('panel A')?'panel A':said.includes('panelu A')?'w panelu A':'w panelu głównym'));
});

test('observation time: the device clock is a proposal for review; an utterance that names another time is never stamped with now',async()=>{
 // Unspecified or explicitly "now": the proposal carries the client clock and still awaits review.
 const now=await accepted(PL,claim(PL,'120','sto dwadzieścia','V','woltów','L1-N'));
 assert.equal(now.assistant.actionProposal.measuredAt,'2026-11-21T13:05:00.000Z');
 assert.ok(now.reply.includes('proponowany bieżący czas urządzenia')&&now.reply.includes('niczego nie zatwierdzono')&&!now.reply.includes('2026-11-21'));
 const plain='Measured 121.4 V at L1 in the main panel';
 const en=await accepted(plain,claim(plain,'121.4','121.4','V','V','L1 in the main panel'),'en');
 assert.ok(en.reply.includes('current device time, as a proposal'));
 // Another time, with otherwise perfect evidence: a deterministic clarification, no proposal, no fabricated time.
 const other=[
  ['pl','Wczoraj zmierzyłem 121,4 V na L1 w panelu głównym','121,4','na L1 w panelu głównym'],
  ['pl','Zmierzyłem dziś rano 121,4 V na L1 w panelu głównym','121,4','na L1 w panelu głównym'],
  ['pl','Godzinę temu zmierzyłem 121,4 V na L1 w panelu głównym','121,4','na L1 w panelu głównym'],
  ['pl','Pomiar na L1 w panelu głównym o 14:30, 121,4 V','121,4','na L1 w panelu głównym'],
  ['pl','Pomiar z 20 listopada na L1 w panelu głównym, 121,4 V','121,4','na L1 w panelu głównym'],
  ['en','Measured 121.4 V at L1 in the main panel an hour ago','121.4','L1 in the main panel'],
  ['en','Yesterday I measured 121.4 V at L1 in the main panel','121.4','L1 in the main panel'],
  ['en','Measured 121.4 V at L1 in the main panel on 2026-11-20','121.4','L1 in the main panel'],
  ['en','Measured 121.4 V at L1 in the main panel this morning','121.4','L1 in the main panel']
 ];
 for(const[lang,said,quote,location]of other){
  const out=await propose(said,claim(said,'121.4',quote,'V','V',location),lang);
  assert.equal(out.domain,'clarification',said);assert.equal(out.assistant.actionProposal,null,said);
  assert.deepEqual(out.assistant.clarification,{reason:'missing_details',topic:'job_measurement',modelQuestionUsed:false},said);
  assert.equal(out.assistant.replyOrigin,'deterministic');
  assert.ok(out.reply.includes(lang==='en'?'measurement form':'formularzu pomiaru'),said);
  assert.ok(!JSON.stringify(out).includes(CLOCK.local)&&!JSON.stringify(out).includes('measuredAt'),said);
 }
 // The model is told the same thing: it never states a time and routes another time to a clarification.
 assert.match(ASSISTANT_PROMPT,/TIME: you never state a time/);assert.match(ASSISTANT_PROMPT,/another time/);
 // No job selected is still answered first, without a proposal.
 answer=called(TOOL,claim(PL,'120','sto dwadzieścia','V','woltów','L1-N'));
 const none=await provider.assist(provider.checkAssist(body(PL,'pl',null)));
 assert.equal(none.assistant.clarification.reason,'job_not_selected');
});

// ── review fixes F1–F3, F5 (authored for coordinator execution; NOT RUN by the author) ───────────────────────────────
test('F1: the readable tail of a longer number the canonical parser cannot read is never the value; whole numbers still pass',async()=>{
 // The canonical parser refuses these whole spans, so the only "readable" part is a tail — which must not be accepted.
 for(const span of ['a hundred twenty','tysiąc dwieście','pięć przecinek dwadzieścia pięć','five point twenty five'])assert.equal(V.decimal(span),null,span);
 const hundred='Reading at panel A, L1 to neutral: a hundred twenty volts now';
 await refused(hundred,claim(hundred,'20','twenty','V','volts','panel A'),'tail of "a hundred twenty"');
 await refused(hundred,claim(hundred,'120','a hundred twenty','V','volts','panel A'),'the unreadable whole span is refused, never guessed');
 await refused(hundred,claim(hundred,'120','hundred twenty','V','volts','panel A'));
 const and='Reading at panel A, L1 to neutral: a hundred and twenty volts now';
 await refused(and,claim(and,'20','twenty','V','volts','panel A'),'tail after "hundred and"');
 const thousand='Pomiar L1-N w panelu A teraz: tysiąc dwieście woltów';
 await refused(thousand,claim(thousand,'200','dwieście','V','woltów','w panelu A'),'tail of "tysiąc dwieście"');
 await refused(thousand,claim(thousand,'1200','tysiąc dwieście','V','woltów','w panelu A'));
 const fraction='Pomiar L1-N w panelu A teraz: pięć przecinek dwadzieścia pięć woltów';
 await refused(fraction,claim(fraction,'25','dwadzieścia pięć','V','woltów','w panelu A'),'tail after "przecinek"');
 await refused(fraction,claim(fraction,'5.25','pięć przecinek dwadzieścia pięć','V','woltów','w panelu A'));
 await refused(fraction,claim(fraction,'5','pięć','V','woltów','w panelu A'));
 const point='Reading at panel A, L1 to neutral: five point twenty five volts now';
 await refused(point,claim(point,'25','twenty five','V','volts','panel A'),'tail after "point"');
 await refused(point,claim(point,'5.25','five point twenty five','V','volts','panel A'));
 const hyphen='Reading at panel A, L1 to neutral: two-thousand twenty volts now';
 await refused(hyphen,claim(hyphen,'20','twenty','V','volts','panel A'),'tail after a hyphenated scale word');
 // Controls: whole numbers the canonical parser reads, digits after a point name, and digit-by-digit decimals still pass.
 await accepted(EN,claim(EN,'120','one hundred twenty','V','volts','panel A, L1 to neutral',{mode:'AC',instrument:'Fluke 117'}),'en');
 await accepted(PL,claim(PL,'120','sto dwadzieścia','V','woltów','L1-N',{instrument:'Fluke 117'}));
 const whole='Reading at panel A, L1 to neutral: one hundred and twenty volts now';
 await accepted(whole,claim(whole,'120','one hundred and twenty','V','volts','panel A'),'en');
 const digits='L1 120 V w panelu głównym teraz';
 await accepted(digits,claim(digits,'120','120','V','V','w panelu głównym'));
 const spoken='Pomiar L1-N w panelu A teraz: pięć przecinek dwa pięć wolta';
 await accepted(spoken,claim(spoken,'5.25','pięć przecinek dwa pięć','V','wolta','w panelu A'));
});

test('F2: ranges, alternatives and hedges on EITHER side of the reading are refused; clause boundaries and other quantities are kept',async()=>{
 // [utterance, value_text, value_quote, unit_quote, location]
 const ambiguous=[
  ['Pomiar L1-N w panelu A teraz: między 118 a 121 V','121','121','V','w panelu A'],
  ['Reading at panel A, L1 to neutral: 118 up to 121 V now','121','121','V','panel A'],
  ['Pomiar L1-N w panelu A teraz: 120 V albo 121','120','120','V','w panelu A'],
  ['Pomiar L1-N w panelu A teraz: 120 V do 125','120','120','V','w panelu A'],
  ['Reading at panel A, L1 to neutral: 120 V or 121 now','120','120','V','panel A'],
  ['Reading at panel A, L1 to neutral: 120 V up to 125 now','120','120','V','panel A'],
  ['Pomiar L1-N w panelu A teraz: 120 V AC albo 121','120','120','V','w panelu A'],
  ['Pomiar L1-N w panelu A teraz: 120 V - 125','120','120','V','w panelu A'],
  ['Reading at panel A, L1 to neutral: between 118 V and 121 now','118','118','V','panel A'],
  ['Wyłącznik 20 i 121,4 V na L1 w panelu głównym teraz','121.4','121,4','V','na L1 w panelu głównym'],
  // Hedges, bounds and negation directly attached to the reading: an approximate value is not made exact.
  ['Pomiar L1-N w panelu A teraz około 120 V','120','120','V','w panelu A'],
  ['Pomiar L1-N w panelu A teraz chyba 120 V','120','120','V','w panelu A'],
  ['Pomiar L1-N w panelu A teraz może 120 V','120','120','V','w panelu A'],
  ['Pomiar L1-N w panelu A teraz ponad 120 V','120','120','V','w panelu A'],
  ['Pomiar L1-N w panelu A teraz mniej więcej 120 V','120','120','V','w panelu A'],
  ['Pomiar L1-N w panelu A teraz około sto dwadzieścia woltów','120','sto dwadzieścia','woltów','w panelu A'],
  ['Reading at panel A, L1 to neutral, about 120 volts now','120','120','volts','panel A'],
  ['Reading at panel A, L1 to neutral, maybe 120 V now','120','120','V','panel A'],
  ['Reading at panel A, L1 to neutral, perhaps 120 V now','120','120','V','panel A'],
  ['Reading at panel A, L1 to neutral, under 120 V now','120','120','V','panel A'],
  ['Reading at panel A, L1 to neutral, over 120 V now','120','120','V','panel A'],
  ['Reading at panel A, L1 to neutral, not 120 V now','120','120','V','panel A'],
  ['Pomiar L1-N w panelu A teraz: 120 V mniej więcej','120','120','V','w panelu A'],
  ['Pomiar L1-N w panelu A teraz: 120 V chyba','120','120','V','w panelu A'],
  ['Pomiar L1-N w panelu A teraz: 120 V ±2','120','120','V','w panelu A'],
  ['Reading at panel A, L1 to neutral: 120 V or so','120','120','V','panel A']
 ];
 for(const[said,value,quote,unitQuote,location]of ambiguous)await refused(said,claim(said,value,quote,'V',unitQuote,location));
 // Controls. A clause boundary still separates an instrument model from the reading.
 await accepted(PL,claim(PL,'120','sto dwadzieścia','V','woltów','L1-N',{instrument:'Fluke 117'}));
 // A rating of another quantity does not compete, with a comma or with a connector between them.
 const rated='W panelu 100 A, L1-N 121,4 V teraz';
 await accepted(rated,claim(rated,'121.4','121,4','V','V','W panelu 100 A, L1-N'));
 const breaker='Wyłącznik 20 A i 121,4 V na L1 w panelu głównym teraz';
 await accepted(breaker,claim(breaker,'121.4','121,4','V','V','na L1 w panelu głównym'));
 // "między L1 a N" names the measuring points, not a range of values; "do" / "to" without a second number is no range.
 const points='Zmierzyłem między L1 a N 120 V w panelu głównym teraz';
 await accepted(points,claim(points,'120','120','V','V','między L1 a N'));
 const dropped='Napięcie na L1 w panelu głównym spadło do 118 V';
 await accepted(dropped,claim(dropped,'118','118','V','V','na L1 w panelu głównym'));
 const ground='Measured 120 V to ground at L1 in the main panel';
 await accepted(ground,claim(ground,'120','120','V','V','L1 in the main panel'),'en');
});

test('F5: a reading that overlaps the instrument the model itself quoted is not a reading; the real reading next to it still passes',async()=>{
 const only='Pomiar na L1 w panelu głównym miernikiem Fluke 87V teraz',at='na L1 w panelu głównym';
 await refused(only,claim(only,'87','87','V','V',at,{instrument:'Fluke 87V',reading_quote:'87V'}),'"87V" is part of the quoted instrument');
 const both='Pomiar na L1 w panelu głównym miernikiem Fluke 87V, 120 V teraz';
 const out=await accepted(both,claim(both,'120','120','V','V',at,{instrument:'Fluke 87V'}));
 assert.equal(out.assistant.actionProposal.fields.instrument,'Fluke 87V');assert.ok(out.reply.includes('120 V')&&!out.reply.includes('87 V'));
 await accepted(both,claim(both,'120','120','V','V',at,{instrument:'fluke 87v'}),undefined);
 await refused(both,claim(both,'87','87','V','V',at,{instrument:'Fluke 87V',reading_quote:'87V'}));
 // Without the instrument quote nothing tells the two voltage pairs apart: the call is refused, not guessed.
 await refused(both,claim(both,'120','120','V','V',at));
 const adjacent='Pomiar na L1 w panelu głównym miernikiem Fluke 87V 120 V teraz';
 await accepted(adjacent,claim(adjacent,'120','120','V','V',at,{instrument:'Fluke 87V'}));
 // An instrument quote that covers the reading itself leaves no reading.
 await refused(both,claim(both,'120','120','V','V',at,{instrument:'Fluke 87V, 120 V'}));
});

test('F3: common PL / EN phrasings of another time get the existing clarification and no proposal; a stated difference "o 2 V" is not a clock time',async()=>{
 const pl='na L1 w panelu głównym',en='L1 in the main panel';
 const other=[
  ['pl','Przed godziną zmierzyłem 121,4 V na L1 w panelu głównym','121,4',pl],
  ['pl','Przed tygodniem zmierzyłem 121,4 V na L1 w panelu głównym','121,4',pl],
  ['pl','Zmierzyłem przed 5 minutami 121,4 V na L1 w panelu głównym','121,4',pl],
  ['pl','Zmierzyłem 5 min temu 121,4 V na L1 w panelu głównym','121,4',pl],
  ['pl','Zmierzyłem 2 godz. temu 121,4 V na L1 w panelu głównym','121,4',pl],
  ['pl','Kwadrans temu zmierzyłem 121,4 V na L1 w panelu głównym','121,4',pl],
  ['pl','Wczorajszy pomiar na L1 w panelu głównym: 121,4 V','121,4',pl],
  ['pl','Z rana zmierzyłem 121,4 V na L1 w panelu głównym','121,4',pl],
  ['pl','Nad ranem zmierzyłem 121,4 V na L1 w panelu głównym','121,4',pl],
  ['pl','Pomiar na L1 w panelu głównym o 14, 121,4 V','121,4',pl],
  ['pl','Pomiar na L1 w panelu głównym o 14.30, 121,4 V','121,4',pl],
  ['pl','Pomiar na L1 w panelu głównym o czternastej, 121,4 V','121,4',pl],
  ['pl','Pomiar na L1 w panelu głównym o godz. 14, 121,4 V','121,4',pl],
  ['en','Measured 121.4 V at L1 in the main panel at 3 o\'clock','121.4',en],
  ['en','Measured 121.4 V at L1 in the main panel at 14.30','121.4',en]
 ];
 for(const[lang,said,quote,location]of other){
  const out=await propose(said,claim(said,'121.4',quote,'V','V',location),lang);
  assert.equal(out.domain,'clarification',said);assert.equal(out.assistant.actionProposal,null,said);
  assert.deepEqual(out.assistant.clarification,{reason:'missing_details',topic:'job_measurement',modelQuestionUsed:false},said);
  assert.equal(out.assistant.replyOrigin,'deterministic',said);
  assert.ok(out.reply.includes(lang==='en'?'measurement form':'formularzu pomiaru'),said);
  assert.ok(!JSON.stringify(out).includes(CLOCK.local)&&!JSON.stringify(out).includes('measuredAt')&&!JSON.stringify(out).includes('client_clock'),said);
 }
 // Controls: now / unspecified time is still proposed with the device clock, as an editable proposal.
 const now=await accepted(PL,claim(PL,'120','sto dwadzieścia','V','woltów','L1-N'));
 assert.equal(now.assistant.actionProposal.timeOrigin,'client_clock');assert.equal(now.assistant.actionProposal.requiresUserReview,true);
 const plain='Measured 121.4 V at L1 in the main panel';
 await accepted(plain,claim(plain,'121.4','121.4','V','V',en),'en');
 // "o 2 V" is a difference whose digits are the value of the reading pair, not two o'clock (spaced and glued).
 const delta='Napięcie na L1 w panelu głównym spadło o 2 V';
 const spaced=await accepted(delta,claim(delta,'2','2','V','V',pl));
 assert.equal(spaced.assistant.actionProposal.measuredAt,'2026-11-21T13:05:00.000Z');
 const glued='Napięcie na L1 w panelu głównym wzrosło o 2V';
 await accepted(glued,claim(glued,'2','2','V','V',pl,{reading_quote:'2V'}));
 const decimal='Napięcie na L1 w panelu głównym spadło o 2,5 V';
 await accepted(decimal,claim(decimal,'2.5','2,5','V','V',pl));
 // The same digits with no unit after them are a clock time again.
 const clock='Napięcie na L1 w panelu głównym o 2 spadło, 121,4 V';
 assert.equal((await propose(clock,claim(clock,'121.4','121,4','V','V',pl))).assistant.actionProposal,null);
 assert.match(ASSISTANT_PROMPT,/o czternastej/);assert.match(ASSISTANT_PROMPT,/przed godziną/);
});

test('speech prompt: generalized to calculations, notes, measurements and materials; model, languages, keywords and request shape unchanged; no audio API call',async()=>{
 const bytes=Buffer.alloc(128);bytes.write('RIFF');bytes.write('WAVE',8);
 const sent=[];
 const speech=createProvider({prompt:'TEST PROMPT',request:async(route,options)=>{sent.push({route,options});return{text:'  sto dwadzieścia woltów on L1  '};}});
 assert.deepEqual(await speech.transcribe(bytes,'audio/wav'),{text:'sto dwadzieścia woltów on L1',model:SPEECH_MODEL});
 assert.equal(sent.length,1);assert.equal(sent[0].route,'/audio/transcriptions');
 const form=sent[0].options.form,prompt=form.get('prompt');
 assert.deepEqual([...new Set([...form.keys()])].sort(),['file','keywords[]','languages[]','model','prompt','response_format']);
 assert.equal(form.get('model'),SPEECH_MODEL);assert.equal(form.get('response_format'),'json');
 assert.deepEqual(form.getAll('languages[]'),['pl','en']);assert.deepEqual(form.getAll('keywords[]'),['EMT','THHN','AWG','breaker','bushing']);
 for(const part of ['calculation','job notes','measurements','material','Polish and English','numbers','uncertainty','corrections','units'])assert.ok(prompt.includes(part),part);
 assert.match(prompt,/Do not translate/);assert.match(prompt,/complete/);assert.ok(!prompt.includes('material note'));assert.ok(prompt.length<400);
});
