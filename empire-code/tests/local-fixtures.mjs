// Test-only helpers for tests/local-*.test.mjs. Real loopback HTTP against local/server.mjs on an ephemeral port.
// Every value is synthetic. The provider transport is always a controlled function; nothing here can reach a key or
// the network. Requests are built by the accepted frontend module itself (candidate/browser/assistant-session.js).
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createLocalServer} from '../local/server.mjs';
import {EMPTY} from './backend-fixtures.mjs';

const require=createRequire(import.meta.url);
export const ASession=require('../candidate/browser/assistant-session.js');
export const R=require('../core/src/calc/conversationTools.js');

export const FULL={capacityWh:1000,consumptionMode:'kwh_year',consumption:365,chargePercent:100,usablePercent:85};
export const BATTERY_TEXT='Bateria 1000 Wh, 365 kWh na rok, 100 procent, użyteczne 85 procent';
export const patch=(tool,stated)=>({set:Object.fromEntries(R.getTool(tool).modelFields.map(k=>[k,Object.hasOwn(stated,k)?stated[k]:null])),clear:[]});
export const called=(name,args)=>({status:'completed',output:[{type:'reasoning',id:'rs_1',summary:[]},{type:'function_call',id:'fc_1',call_id:'call_1',name,arguments:typeof args==='string'?args:JSON.stringify(args),status:'completed'}],usage:{total_tokens:1}});
export const BATTERY=['ec_calc_battery_runtime',patch('battery_runtime',FULL)];
// Same synthetic job, clock and reading as tests/stage5-assistant-contract.test.mjs.
export const JOB={jobId:'job1_'+'a'.repeat(32),revisionId:'jrev1_'+'b'.repeat(32),revisionNumber:4,notesLength:120};
export const CLOCK={local:'2026-11-21T14:05',utcOffset:'+01:00'};
export const MEASURED='Zmierzyłem 121,4 V AC between L1 and neutral w panelu głównym, miernik Fluke 117';
export const READING={label:'L1-N voltage',quantity:'voltage',value_text:'121.4',value_quote:'121,4',unit:'V',unit_quote:'V',reading_quote:'121,4 V',location:'between L1 and neutral w panelu głównym',mode:'AC',instrument:'Fluke 117',notes:null,source_quote:'Zmierzyłem 121,4 V AC between L1 and neutral w panelu głównym'};
export const NOTE_TEXT='Zanotuj: klient chce gniazdo w garażu';
export const NOTE={text:'Klient chce gniazdo w garażu.',source_quote:'klient chce gniazdo w garażu'};

// One request on its own connection, with full control of Host / Origin / Sec-Fetch-Site.
export function call(origin,{method='GET',path='/',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:Number(new URL(origin).port),method,path,headers,agent:false},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));
   res.on('end',()=>{const raw=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.headers,body:raw,json:()=>JSON.parse(raw.toString('utf8'))});});
  });
  req.on('error',reject);
  if(body!==undefined)req.end(body);else req.end();
 });
}
export async function until(check,ms=3000){
 const end=Date.now()+ms;
 for(;;){if(await check())return;if(Date.now()>end)throw new Error('timed out waiting for a condition');await new Promise(r=>setTimeout(r,5));}
}
// The closed /api/assist body exactly as the accepted frontend builds it.
export const sent=(requestId,o={})=>ASession.request({requestId,text:o.text??BATTERY_TEXT,state:o.state??EMPTY,lang:'pl',contextToken:o.contextToken??'ctx-00000001',toolDraft:o.toolDraft??null,form:null,job:o.job??null,clock:o.clock??null});
// An {error,code} refusal with no CORS grant.
export function refused(r,status,code){
 const text=r.body.toString('utf8'),data=JSON.parse(text);
 assert.equal(r.status,status,text);
 if(code!==undefined)assert.equal(data.code,code,text);
 assert.ok(typeof data.error==='string'&&data.error.length>0&&data.error.length<300,text);
 assert.equal(r.headers['access-control-allow-origin'],undefined);
 return data;
}
// A local server over a recording, controlled transport (or over `request` when the test supplies its own).
export async function harness(t,{request,budgetStorage}={}){
 const seen={upstream:[],options:[]};
 const h={seen,respond:async()=>called(...BATTERY)};
 const transport=request||(async(route,options)=>{seen.upstream.push(route);seen.options.push(options);return h.respond(route,options);});
 const local=createLocalServer({request:transport,...(budgetStorage?{budgetStorage}:{})});
 h.origin=await local.start(0);h.port=Number(new URL(h.origin).port);h.stop=()=>local.stop();
 t.after(()=>local.stop());
 h.get=(path,headers={})=>call(h.origin,{path,headers});
 h.session=async()=>(await h.get('/api/session',{'sec-fetch-site':'same-origin'})).json();
 h.post=(path,token,id,payload,headers={})=>call(h.origin,{method:'POST',path,body:typeof payload==='string'||Buffer.isBuffer(payload)?payload:JSON.stringify(payload),
  headers:{origin:h.origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-ec-token':token,'x-ec-request-id':id,...headers}});
 h.assist=(token,id,o={})=>h.post('/api/assist',token,id,sent(id,o));
 return h;
}
