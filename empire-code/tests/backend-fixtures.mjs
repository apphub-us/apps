// Test-only helpers for tests/backend-*.test.mjs. Every value is synthetic: no real key, identity, origin or network.
import {createHash} from 'node:crypto';
import {PilotBudget} from '../candidate/server/budget.mjs';
import {createProvider} from '../candidate/server/cloud-provider.mjs';
import {createWorker} from '../candidate/server/worker.mjs';

export const ORIGIN='https://pilot.example.test',OWNER='owner@example.test';
export const KEY='sk-'+'T'.repeat(40); // matches the key format only; not a credential
export const EMPTY={version:1,revision:0,nextId:1,items:[],history:[]};
export const TEXT='Dodaj dwa breakery';
export const ALL_FIELDS=['name','quantity','unit','specification','notes','review'];
export const ADD={scope:'materials',reply:'Dodano.',question:'',operations:[{op:'add',id:'new1',changed_fields:ALL_FIELDS,source_quote:'dwa breakery',fields:{name:'breaker',quantity:'2',unit:'pcs',specification:'',notes:'',review:[]}}]};
export const completed=proposal=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(proposal)}]}],usage:{total_tokens:1}});
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function webm(size=256){const bytes=new Uint8Array(size);bytes.set([0x1a,0x45,0xdf,0xa3]);return bytes;}
const asset=(text,mime)=>({base64:Buffer.from(text).toString('base64'),mime,sha256:sha(text)});
const INDEX=asset('<!doctype html><title>fixture</title>','text/html; charset=utf-8');
export const ASSETS={'/':INDEX,'/index.html':INDEX,'/ui.js':asset('console.log(1)','text/javascript; charset=utf-8'),'/workspace/mobile.html':asset('<!doctype html><p>frame</p>','text/html; charset=utf-8')};

const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Snapshot-isolated storage that yields on every operation and survives new PilotBudget instances.
// It does not serialise transactions itself, so lost updates would show up if PilotBudget did not.
export class MemoryStorage{
 constructor(){this.data=new Map();this.transactions=0;}
 async transaction(fn){
  this.transactions++;await tick();
  const snapshot=new Map(this.data);
  const out=await fn({
   get:async k=>{await tick();return snapshot.has(k)?structuredClone(snapshot.get(k)):undefined;},
   put:async(k,v)=>{await tick();snapshot.set(k,structuredClone(v));}
  });
  this.data=snapshot;return out;
 }
}
export function budgetNamespace(storage=new MemoryStorage()){
 const calls=[],names=[];let instance=new PilotBudget({storage},{});
 const namespace={idFromName(name){names.push(name);return{name};},get(){return{fetch:async(url,init)=>{calls.push(new URL(url).pathname);return instance.fetch(new Request(url,init));}};}};
 return{storage,calls,names,namespace,restart(){instance=new PilotBudget({storage},{});}};
}
export const access=email=>({access:{getIdentity:async()=>({email})}});
export const request=(path,init={},origin=ORIGIN)=>new Request(origin+path,init);

// A worker built with fixture assets, a recording budget and the real provider logic over a synthetic transport.
export function harness({key=KEY}={}){
 const seen={assetReads:0,factory:0,upstream:[]};
 const count=name=>(...args)=>{seen.assetReads++;return Reflect[name](...args);};
 const assets=new Proxy(ASSETS,{get:count('get'),has:count('has'),getOwnPropertyDescriptor:count('getOwnPropertyDescriptor'),ownKeys:count('ownKeys')});
 const budget=budgetNamespace();
 const h={seen,budget,respond:async route=>route==='/responses'?completed(ADD):{text:' dwa breakery '}};
 const worker=createWorker({assets,build:'TEST-BUILD',providerFactory:async()=>{seen.factory++;return createProvider({prompt:'TEST PROMPT',request:async(route,options)=>{seen.upstream.push(route);return h.respond(route,options);}});}});
 h.env={EC_ALLOWED_EMAIL:OWNER,EC_ORIGIN:ORIGIN,PILOT_BUDGET:budget.namespace};
 if(key!==null)h.env.OPENAI_API_KEY=key;
 h.call=(path,init={},ctx=access(OWNER),origin=ORIGIN)=>worker.fetch(request(path,init,origin),h.env,ctx);
 h.session=async()=>(await h.call('/api/session',{headers:{'sec-fetch-site':'same-origin'}})).json();
 h.post=(path,token,id,body,headers={})=>h.call(path,{method:'POST',body,headers:{origin:ORIGIN,'sec-fetch-site':'same-origin','x-ec-token':token,'x-ec-request-id':id,...headers}});
 h.talk=(token,id,{text=TEXT,state=EMPTY,headers={}}={})=>h.post('/api/talk',token,id,JSON.stringify({state,text,requestId:id}),{'content-type':'application/json',...headers});
 h.untouched=()=>seen.assetReads===0&&seen.factory===0&&seen.upstream.length===0&&budget.calls.length===0&&budget.names.length===0&&budget.storage.transactions===0;
 return h;
}
