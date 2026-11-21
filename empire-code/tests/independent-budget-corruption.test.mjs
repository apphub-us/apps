import test from 'node:test';
import assert from 'node:assert/strict';
import {PilotBudget} from '../candidate/server/budget.mjs';
import {MemoryStorage} from './backend-fixtures.mjs';
const now=Date.now(),day=new Date(now).toISOString().slice(0,10),h='a'.repeat(64),p='b'.repeat(64);
const valid=()=>({v:1,tokens:[{h,p,exp:now+300000}],days:{[day]:1},dedup:{[h]:now+1000000},lease:null});
const request=()=>new Request('https://budget.internal/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({principalHash:p})});
test('independent: malformed stored budget cannot be silently repaired into a fresh token or reset dedup',async()=>{
 const mutations=[x=>{x.extra=true;},x=>{x.tokens[0].h=[h];},x=>{x.tokens[0].exp='tomorrow';},x=>{x.tokens[0].exp=now+3600000+120000;},x=>{x.tokens=Array(9).fill(x.tokens[0]);},x=>{x.dedup[h]='expired';},x=>{x.dedup[h]=now+48*3600000+120000;},x=>{x.days[day]=61;},x=>{x.days['not-a-day']=1;},x=>{x.lease={id:'broken',r:h,p,exp:now+1000};},x=>{x.lease={id:'a'.repeat(32),r:h,p,exp:now+240000};}];
 for(const mutation of mutations){const store=new MemoryStorage(),record=valid();mutation(record);store.data.set('budget:v1',structuredClone(record));const budget=new PilotBudget({storage:store},{});const r=await budget.fetch(request());assert.equal(r.status,500,JSON.stringify(record));assert.equal((await r.json()).code,'BUDGET_STATE');assert.deepEqual(store.data.get('budget:v1'),record);}
});
test('independent: legitimate expired records are pruned, not mistaken for malformed data',async()=>{
 const store=new MemoryStorage(),record=valid();record.tokens[0].exp=now-10000;record.dedup[h]=now-10000;record.lease={id:'a'.repeat(32),r:h,p,exp:now-10000};store.data.set('budget:v1',record);const r=await new PilotBudget({storage:store},{}).fetch(request());assert.equal(r.status,200);const body=await r.json();assert.equal(body.remaining,59);const after=store.data.get('budget:v1');assert.equal(after.lease,null);assert.deepEqual(after.dedup,{});assert.equal(after.tokens.length,1);assert.notEqual(after.tokens[0].h,h);
});
