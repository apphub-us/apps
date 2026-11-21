// PilotBudget: persistence, dedup, concurrency, day cap, lease and token expiry. Storage and clock are mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PilotBudget} from '../candidate/server/budget.mjs';
import {MemoryStorage,sha} from './backend-fixtures.mjs';

const P=sha('owner@example.test'),START=Date.UTC(2026,10,16,12,0,0),MIN=60000,HOUR=3600000;
const send=async(budget,path,payload,init={})=>{const r=await budget.fetch(new Request('https://budget.internal'+path,{method:'POST',body:JSON.stringify(payload),...init}));return{status:r.status,...await r.json()};};
function setup(t){
 const clock={now:START};t.mock.method(Date,'now',()=>clock.now);
 const storage=new MemoryStorage();
 const s={clock,storage,budget:new PilotBudget({storage},{}),state:()=>storage.data.get('budget:v1')};
 s.token=async()=>(await send(s.budget,'/session',{principalHash:P})).token;
 s.begin=(token,requestId)=>send(s.budget,'/begin',{principalHash:P,token,requestId});
 s.finish=(requestId,lease)=>send(s.budget,'/finish',{principalHash:P,requestId,lease});
 return s;
}

test('malformed internal input is rejected without touching storage',async t=>{
 const s=setup(t),token='a'.repeat(64);
 const bad=[
  ['/session',{}],['/session',{principalHash:'x'}],['/session',{principalHash:P,limit:1000}],['/session',[P]],
  ['/begin',{principalHash:P,token,requestId:'short'}],['/begin',{principalHash:P,token:'nope',requestId:'request-0001'}],
  ['/begin',{principalHash:P,token,requestId:'request-0001',cap:9999}],['/finish',{principalHash:P,requestId:'request-0001',lease:'zz'}],
  ['/session',{principalHash:P,pad:'x'.repeat(5000)}]
 ];
 for(const[path,payload]of bad)assert.equal((await send(s.budget,path,payload)).code,'BAD_INPUT',JSON.stringify([path,payload]).slice(0,80));
 assert.equal((await send(s.budget,'/session',{principalHash:P},{body:'{not json'})).code,'BAD_INPUT');
 assert.equal((await send(s.budget,'/reset',{principalHash:P})).status,404);
 assert.equal((await send(s.budget,'/session',{principalHash:P},{method:'PUT'})).status,404);
 assert.equal((await s.budget.fetch(new Request('https://elsewhere.example/session',{method:'POST',body:JSON.stringify({principalHash:P})}))).status,404);
 assert.equal(s.storage.transactions,0);
});

test('session tokens: random 256-bit, stored only hashed, bounded to 8, expire after one hour',async t=>{
 const s=setup(t),tokens=[];
 for(let i=0;i<9;i++)tokens.push(await s.token());
 assert.ok(tokens.every(x=>/^[0-9a-f]{64}$/.test(x)));assert.equal(new Set(tokens).size,9);
 assert.equal(s.state().tokens.length,8);
 assert.equal((await s.begin(tokens[0],'request-0001')).code,'TOKEN'); // oldest was evicted
 assert.equal((await send(s.budget,'/begin',{principalHash:sha('someone else'),token:tokens[8],requestId:'request-0002'})).code,'TOKEN');
 const ok=await s.begin(tokens[8],'request-0003');assert.equal(ok.ok,true);await s.finish('request-0003',ok.lease);
 const stored=JSON.stringify(s.state());
 for(const secret of [...tokens,'request-0003','owner@example.test'])assert.ok(!stored.includes(secret));
 s.clock.now+=HOUR+1;
 assert.equal((await s.begin(tokens[8],'request-0004')).code,'TOKEN');
 assert.equal((await send(s.budget,'/session',{principalHash:P})).remaining,59);
});

test('begin/finish: one lease, duplicate IDs refused, failed attempts stay counted, state survives a new instance',async t=>{
 const s=setup(t),token=await s.token();
 const first=await s.begin(token,'request-0001');
 assert.deepEqual([first.status,first.ok,first.remaining],[200,true,59]);assert.match(first.lease,/^[0-9a-f]{32}$/);
 assert.deepEqual([(await s.begin(token,'request-0001')).status,(await s.begin(token,'request-0001')).code],[409,'DUPLICATE']);
 assert.deepEqual([(await s.begin(token,'request-0002')).status,(await s.begin(token,'request-0002')).code],[409,'BUSY']);
 assert.equal((await s.finish('request-0001','0'.repeat(32))).released,false);  // wrong lease
 assert.equal((await s.finish('request-0002',first.lease)).released,false);     // wrong request
 assert.equal((await s.begin(token,'request-0002')).code,'BUSY');
 s.budget=new PilotBudget({storage:s.storage},{});                              // new instance, same durable storage
 assert.equal((await s.begin(token,'request-0002')).code,'BUSY');
 assert.equal((await s.finish('request-0001',first.lease)).released,true);
 assert.equal((await s.finish('request-0001',first.lease)).released,false);
 assert.equal((await s.begin(token,'request-0001')).code,'DUPLICATE');          // release never forgets the ID
 assert.equal((await send(s.budget,'/session',{principalHash:P})).remaining,59); // or the count
 assert.equal((await s.begin(token,'request-0002')).remaining,58);
});

test('concurrent requests cannot share the lease or lose updates',async t=>{
 const s=setup(t),token=await s.token();
 const results=await Promise.all([1,2,3,4,5].map(i=>s.begin(token,'parallel-000'+i)));
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.code==='BUSY').length,4);
 assert.equal(s.state().days['2026-11-16'],1);assert.equal(Object.keys(s.state().dedup).length,1);
 const winner='parallel-000'+(results.findIndex(r=>r.ok)+1); // which one wins is not deterministic
 const same=await Promise.all([1,2,3].map(()=>s.begin(token,winner)));
 assert.ok(same.every(r=>r.code==='DUPLICATE'));
 const minted=await Promise.all(Array.from({length:12},()=>send(s.budget,'/session',{principalHash:P})));
 assert.equal(new Set(minted.map(r=>r.token)).size,12);assert.equal(s.state().tokens.length,8);
});

test('60 attempts per UTC day, then refused until the next UTC day; old day data is pruned',async t=>{
 const s=setup(t),token=await s.token();
 for(let i=0;i<60;i++){const r=await s.begin(token,'cap-request-'+String(i).padStart(4,'0'));assert.equal(r.remaining,59-i);await s.finish('cap-request-'+String(i).padStart(4,'0'),r.lease);}
 assert.deepEqual([(await s.begin(token,'cap-request-over')).status,(await s.begin(token,'cap-request-over')).code],[429,'CAP']);
 assert.equal((await send(s.budget,'/session',{principalHash:P})).remaining,0);
 s.clock.now+=12*HOUR+MIN;
 const next=await s.begin(await s.token(),'cap-request-over');
 assert.deepEqual([next.ok,next.remaining],[true,59]);assert.deepEqual(Object.keys(s.state().days),['2026-11-17']);
});

test('an abandoned lease expires after 120 s and its stale release cannot free a newer lease',async t=>{
 const s=setup(t),token=await s.token();
 const stale=await s.begin(token,'request-0001');
 s.clock.now+=119000;assert.equal((await s.begin(token,'request-0002')).code,'BUSY');
 s.clock.now+=1001;const fresh=await s.begin(token,'request-0002');assert.equal(fresh.ok,true);
 assert.equal((await s.finish('request-0001',stale.lease)).released,false);
 assert.equal((await s.begin(token,'request-0003')).code,'BUSY');
 assert.equal((await s.finish('request-0002',fresh.lease)).released,true);
 assert.equal((await s.begin(token,'request-0003')).ok,true);
});

test('request IDs are refused for 48 h and pruned afterwards',async t=>{
 const s=setup(t);const first=await s.begin(await s.token(),'request-0001');await s.finish('request-0001',first.lease);
 s.clock.now+=47*HOUR;assert.equal((await s.begin(await s.token(),'request-0001')).code,'DUPLICATE');
 s.clock.now+=HOUR+1;assert.equal((await s.begin(await s.token(),'request-0001')).ok,true);
 assert.equal(Object.keys(s.state().dedup).length,1);
});
