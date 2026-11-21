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
test('independent: cloud and existing local provider use identical structured schema, exact prompt and model request',async()=>{
 assert.deepEqual(SCHEMA,old.SCHEMA);let oldCall,newCall;
 const a=old.createProvider({request:async(route,options)=>{oldCall={route,options};return completed();}});
 const b=createProvider({prompt,request:async(route,options)=>{newCall={route,options};return completed();}});
 const x=await a.run(state,text),y=await b.run(state,text);assert.deepEqual(newCall,oldCall);assert.deepEqual(y.state,x.state);assert.deepEqual(y.diffs,x.diffs);assert.equal(y.model,x.model);assert.deepEqual(state.items,[]);
});
test('independent: mixed-language transcription request fields and original synthetic audio bytes are preserved',async()=>{
 const bytes=Buffer.alloc(128);bytes.write('RIFF');bytes.write('WAVE',8);let oldCall,newCall;
 const a=old.createProvider({request:async(route,options)=>{oldCall={route,options};return{text:'  Test PL i English  '};}});
 const b=createProvider({prompt,request:async(route,options)=>{newCall={route,options};return{text:'  Test PL i English  '};}});
 assert.deepEqual(await b.transcribe(bytes,'audio/wav'),await a.transcribe(bytes,'audio/wav'));assert.equal(newCall.route,oldCall.route);
 const normalize=async form=>{const entries=[];for(const[k,v]of form.entries())entries.push([k,typeof v==='string'?v:{name:v.name,type:v.type,bytes:[...new Uint8Array(await v.arrayBuffer())]}]);return entries;};assert.deepEqual(await normalize(newCall.options.form),await normalize(oldCall.options.form));
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
