// Durable pilot budget. One Durable Object (idFromName('owner-pilot-v1')) holds every counter, so limits
// are global and persistent rather than per isolate. Stored: hashes, counters and expiry times only —
// no e-mail, no conversation content, no audio, no API key, no raw session token, no raw request ID.
const DAY_CAP=60,LEASE_MS=120000,TOKEN_MS=3600000,DEDUP_MS=48*3600000,MAX_TOKENS=8,MAX_DEDUP=256,MAX_BODY=4096;
const STATE_KEY='budget:v1',INTERNAL='https://budget.internal';
const HEX64=/^[0-9a-f]{64}$/,HEX32=/^[0-9a-f]{32}$/,REQUEST_ID=/^[a-zA-Z0-9-]{8,80}$/;
const SHAPES={
 '/session':{principalHash:HEX64},
 '/begin':{principalHash:HEX64,token:HEX64,requestId:REQUEST_ID},
 '/finish':{principalHash:HEX64,requestId:REQUEST_ID,lease:HEX32}
};
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const randomHex=length=>hex(crypto.getRandomValues(new Uint8Array(length)));
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const deny=(status,code)=>({write:false,status,body:{ok:false,code}});
export async function sha256Hex(text){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))));}

function parse(text,shape){
 if(new TextEncoder().encode(text).length>MAX_BODY)return null;
 let value;try{value=JSON.parse(text);}catch{return null;}
 const names=Object.keys(shape);
 if(!plain(value)||Object.keys(value).length!==names.length)return null;
 return names.every(k=>Object.hasOwn(value,k)&&typeof value[k]==='string'&&shape[k].test(value[k]))?value:null;
}
// Loads the single bounded record and drops everything expired. A record of the wrong shape fails closed.
function load(stored,now,day){
 if(stored===undefined)return{v:1,tokens:[],days:{},dedup:{},lease:null};
 const bad=()=>Error('Invalid budget state');
 const exact=(o,keys)=>plain(o)&&Reflect.ownKeys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
 const hex64=s=>typeof s==='string'&&s.length===64&&HEX64.test(s);
 const hex32=s=>typeof s==='string'&&s.length===32&&HEX32.test(s);
 const expiry=(exp,ttl)=>Number.isFinite(exp)&&exp<=now+ttl+60000;
 const isoDay=k=>{if(typeof k!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(k))return false;const ms=Date.parse(k+'T00:00:00.000Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===k;};
 if(!Number.isFinite(now)||!isoDay(day))throw bad();
 if(!exact(stored,['v','tokens','days','dedup','lease']))throw bad();
 const{v,tokens,days,dedup,lease}=stored;
 if(v!==1||!Array.isArray(tokens)||tokens.length>MAX_TOKENS||!plain(days)||!plain(dedup))throw bad();
 for(let i=0;i<tokens.length;i++){const t=tokens[i];if(!exact(t,['h','p','exp'])||!hex64(t.h)||!hex64(t.p)||!expiry(t.exp,TOKEN_MS))throw bad();}
 const dedupKeys=Reflect.ownKeys(dedup);
 if(dedupKeys.length>MAX_DEDUP)throw bad();
 for(const k of dedupKeys)if(!hex64(k)||!expiry(dedup[k],DEDUP_MS))throw bad();
 const dayKeys=Reflect.ownKeys(days);
 if(dayKeys.length>3)throw bad();
 for(const k of dayKeys){const n=days[k];if(!isoDay(k)||!Number.isInteger(n)||n<0||n>DAY_CAP)throw bad();}
 if(lease!==null&&(!exact(lease,['id','r','p','exp'])||!hex32(lease.id)||!hex64(lease.r)||!hex64(lease.p)||!expiry(lease.exp,LEASE_MS)))throw bad();
 const state={v:1,tokens:[],days:{},dedup:{},lease:null};
 state.tokens=tokens.filter(t=>t.exp>now);
 for(const k of dedupKeys)if(dedup[k]>now)state.dedup[k]=dedup[k];
 if(Object.hasOwn(days,day))state.days[day]=days[day];
 if(lease!==null&&lease.exp>now)state.lease={id:lease.id,r:lease.r,p:lease.p,exp:lease.exp};
 return state;
}

export class PilotBudget{
 constructor(ctx,env){this.storage=ctx.storage;this.queue=Promise.resolve();}
 // Every mutation is one storage transaction; steps are synchronous and additionally serialised inside this
 // single instance, so concurrent requests can never both observe the same free lease or the same count.
 atomic(step){
  const run=()=>this.storage.transaction(async txn=>{
   const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
   const state=load(await txn.get(STATE_KEY),now,day);
   const out=step(state,now,day);
   if(out.write)await txn.put(STATE_KEY,state);
   return reply(out.status,out.body);
  });
  const result=this.queue.then(run);
  this.queue=result.then(()=>{},()=>{});
  return result;
 }
 async fetch(request){
  try{
   const url=new URL(request.url),shape=Object.hasOwn(SHAPES,url.pathname)?SHAPES[url.pathname]:null;
   if(url.origin!==INTERNAL||url.search||request.method!=='POST'||!shape)return reply(404,{ok:false,code:'NOT_FOUND'});
   const input=parse(await request.text(),shape);
   if(!input)return reply(400,{ok:false,code:'BAD_INPUT'});
   const principal=input.principalHash;
   // Hashes and random values are prepared before the transaction so the transaction body never awaits non-storage work.
   if(url.pathname==='/session'){
    const token=randomHex(32),tokenHash=await sha256Hex(token);
    return await this.atomic((state,now,day)=>{
     state.tokens.push({h:tokenHash,p:principal,exp:now+TOKEN_MS});
     if(state.tokens.length>MAX_TOKENS)state.tokens.splice(0,state.tokens.length-MAX_TOKENS);
     return{write:true,status:200,body:{ok:true,token,remaining:Math.max(0,DAY_CAP-(state.days[day]||0)),expiresAt:now+TOKEN_MS}};
    });
   }
   const requestHash=await sha256Hex(input.requestId);
   if(url.pathname==='/begin'){
    const tokenHash=await sha256Hex(input.token),leaseId=randomHex(16);
    return await this.atomic((state,now,day)=>{
     if(!state.tokens.some(t=>t.h===tokenHash&&t.p===principal))return deny(403,'TOKEN');
     if(Object.hasOwn(state.dedup,requestHash))return deny(409,'DUPLICATE');
     if(state.lease)return deny(409,'BUSY');
     const used=state.days[day]||0;
     if(used>=DAY_CAP||Object.keys(state.dedup).length>=MAX_DEDUP)return deny(429,'CAP');
     state.days[day]=used+1;state.dedup[requestHash]=now+DEDUP_MS;state.lease={id:leaseId,r:requestHash,p:principal,exp:now+LEASE_MS};
     return{write:true,status:200,body:{ok:true,lease:leaseId,remaining:DAY_CAP-used-1}};
    });
   }
   // /finish: releases only the exact lease it was given; the attempt count and the dedup entry always stay.
   return await this.atomic(state=>{
    const lease=state.lease;
    if(!lease||lease.id!==input.lease||lease.r!==requestHash||lease.p!==principal)return{write:false,status:200,body:{ok:true,released:false}};
    state.lease=null;
    return{write:true,status:200,body:{ok:true,released:true}};
   });
  }catch{return reply(500,{ok:false,code:'BUDGET_STATE'});}
 }
}
