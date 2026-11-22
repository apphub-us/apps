import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createProvider,createTransport,SCHEMA,prepareProposal} from '../candidate/server/cloud-provider.mjs';
const require=createRequire(import.meta.url),old=require('../input/openai-provider.cjs');
const prompt=await readFile(new URL('../input/online-prompt.txt',import.meta.url),'utf8');
const state={version:1,revision:0,nextId:1,items:[],history:[]};
const text='Dodaj dwa metalowe bushings';
const proposal={scope:'materials',reply:'Dwie sztuki w szkicu.',question:'',operations:[{op:'add',id:'new1',changed_fields:['name','quantity','unit','specification','notes','review'],source_quote:text,fields:{name:'Metal bushing',quantity:'2',unit:'pcs',specification:'',notes:'',review:[]}}]};
const completed=()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(proposal)}]}],usage:{input_tokens:1,output_tokens:1}});
// EC-08 (EC-AUDIT-FIX-1 stage 3): the current schema takes its unit list from the shared definition, which adds box and
// pack. input/openai-provider.cjs is the historical pin and keeps the old list, so everything EXCEPT that one enum must
// still be identical, and the enum may differ only by those two additions.
const unitEnum=s=>s.properties.operations.items.properties.fields.properties.unit;
const withoutUnits=s=>{const c=structuredClone(s);unitEnum(c).enum=[];return c;};
const callWithoutUnits=c=>({route:c.route,options:{...c.options,json:{...c.options.json,text:{format:{...c.options.json.text.format,schema:withoutUnits(c.options.json.text.format.schema)}}}}});
test('independent: cloud and existing local provider use the same structured schema apart from the EC-08 unit list (box, pack added), exact prompt and model request',async()=>{
 assert.deepEqual(withoutUnits(SCHEMA),withoutUnits(old.SCHEMA));
 assert.deepEqual(unitEnum(SCHEMA).enum.filter(u=>!unitEnum(old.SCHEMA).enum.includes(u)),['box','pack']);
 assert.deepEqual(unitEnum(old.SCHEMA).enum.filter(u=>!unitEnum(SCHEMA).enum.includes(u)),[]);let oldCall,newCall;
 const a=old.createProvider({request:async(route,options)=>{oldCall={route,options};return completed();}});
 const b=createProvider({prompt,request:async(route,options)=>{newCall={route,options};return completed();}});
 const x=await a.run(state,text),y=await b.run(state,text);assert.deepEqual(callWithoutUnits(newCall),callWithoutUnits(oldCall));assert.deepEqual(unitEnum(newCall.options.json.text.format.schema).enum,unitEnum(SCHEMA).enum);assert.deepEqual(y.state,x.state);assert.deepEqual(y.diffs,x.diffs);assert.equal(y.model,x.model);assert.deepEqual(state.items,[]);
});
// EC-AUDIT-FIX-1 stage 5 (speech prompt): the current provider dictation prompt covers calculation requests, job notes,
// field measurements and material lists instead of a material note only. That TEXT is the one intentional difference of
// the transcription request; input/openai-provider.cjs is the historical pin and keeps the old wording. Both texts are
// asserted exactly, and every other form entry (and the entry order) must still equal the historical request.
const OLD_SPEECH_PROMPT='An electrician in New York dictating a material note, mixing Polish and English. Preserve the spoken languages, numbers, uncertainty, corrections and units. Do not translate or complete the list.';
const NEW_SPEECH_PROMPT='An electrician in New York dictating calculation requests, job notes, field measurements and material lists, mixing Polish and English. Preserve the spoken languages, numbers, uncertainty, corrections and units exactly as spoken. Do not translate, convert or complete anything.';
const SPEECH_PRESERVE='Preserve the spoken languages, numbers, uncertainty, corrections and units';
const promptsOf=entries=>entries.filter(e=>e[0]==='prompt').map(e=>e[1]);
test('independent: mixed-language transcription request fields and original synthetic audio bytes are preserved',async()=>{
 const bytes=Buffer.alloc(128);bytes.write('RIFF');bytes.write('WAVE',8);let oldCall,newCall;
 const a=old.createProvider({request:async(route,options)=>{oldCall={route,options};return{text:'  Test PL i English  '};}});
 const b=createProvider({prompt,request:async(route,options)=>{newCall={route,options};return{text:'  Test PL i English  '};}});
 assert.deepEqual(await b.transcribe(bytes,'audio/wav'),await a.transcribe(bytes,'audio/wav'));assert.equal(newCall.route,oldCall.route);
 const normalize=async form=>{const entries=[];for(const[k,v]of form.entries())entries.push([k,typeof v==='string'?v:{name:v.name,type:v.type,bytes:[...new Uint8Array(await v.arrayBuffer())]}]);return entries;};
 const n=await normalize(newCall.options.form),o=await normalize(oldCall.options.form);
 // Exactly one 'prompt' entry on each side, each with its exact text: the historical pin keeps the material-only wording,
 // the current provider sends the generalized one. Neither is matched loosely.
 assert.deepEqual(promptsOf(o),[OLD_SPEECH_PROMPT]);assert.deepEqual(promptsOf(n),[NEW_SPEECH_PROMPT]);
 // The verbatim-preservation instruction (languages, numbers, uncertainty, corrections, units; no translation) is in both.
 for(const p of[promptsOf(o)[0],promptsOf(n)[0]]){assert.ok(p.includes(SPEECH_PRESERVE));assert.ok(p.includes('mixing Polish and English.'));assert.ok(p.includes('Do not translate'));}
 // Every other form field — model, file name / type / bytes, response_format, languages[], keywords[] — and the entry
 // order stay identical to the historical request: only the text of that one entry is put back before the comparison.
 assert.deepEqual(n.map(e=>e[0]==='prompt'?['prompt',OLD_SPEECH_PROMPT]:e),o);
});
test('independent: cloud transport sends exactly once to fixed API endpoint and never follows redirects or leaks raw upstream errors',async()=>{
 const fake='sk-'+('synthetic-not-real-'.repeat(3));let calls=[];
 const t=createTransport({apiKey:fake,fetchImpl:async(url,init)=>{calls.push({url,init});return new Response('not followed',{status:302,headers:{Location:'https://attacker.invalid'}});}});
 await assert.rejects(t('/responses',{json:{test:true}}),e=>e.code==='API_SERVICE'&&!e.message.includes(fake));assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.equal(calls[0].init.redirect,'manual');assert.equal(calls[0].init.method,'POST');
 await assert.rejects(t('/models'),e=>e.code==='INVALID_ROUTE');await assert.rejects(t('https://attacker.invalid'),e=>e.code==='INVALID_ROUTE');assert.equal(calls.length,1);
 const leak=createTransport({apiKey:fake,fetchImpl:async()=>{throw Error('request secret '+fake);}});await assert.rejects(leak('/responses',{json:{}}),e=>e.code==='API_CONNECTION'&&!e.message.includes(fake));
});
test('independent: ungrounded operation quote is refused by both implementations without mutating input',()=>{
 const bad=structuredClone(proposal);bad.operations[0].source_quote='Not present in the user message';assert.throws(()=>prepareProposal(state,bad,text),e=>e.code==='PROPOSAL_EVIDENCE');assert.throws(()=>old.prepareProposal(state,bad,text),e=>e.code==='PROPOSAL_EVIDENCE');assert.equal(state.revision,0);assert.deepEqual(state.items,[]);
});
