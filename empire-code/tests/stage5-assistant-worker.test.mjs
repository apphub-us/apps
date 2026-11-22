// Stage 5 — POST /api/assist through the Worker: identity, origin / CSRF, token, request id, budget lease, single
// attempt, abort, safe errors, and the unchanged /api/talk. Authored for coordinator execution; no run is claimed.
// No network and no credential: the provider transport is synthetic and injected only through createWorker().
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import production,{createWorker} from '../candidate/server/worker.mjs';
import {createProvider,apiError} from '../candidate/server/cloud-provider.mjs';
import {createAssistantProvider} from '../candidate/server/assistant-provider.mjs';
import {budgetNamespace,access,request,ASSETS,ORIGIN,OWNER,KEY,EMPTY,ADD,TEXT,completed} from './backend-fixtures.mjs';

const require=createRequire(import.meta.url);
const A=require('../candidate/server/assistant-contract.cjs');
const R=require('../core/src/calc/conversationTools.js');

const FULL={capacityWh:1000,consumptionMode:'kwh_year',consumption:365,chargePercent:100,usablePercent:85};
const JOB={jobId:'job1_'+'a'.repeat(32),revisionId:'jrev1_'+'b'.repeat(32),revisionNumber:4,notesLength:120};
const CLOCK={local:'2026-11-21T14:05',utcOffset:'+01:00'};
const patch=(tool,stated)=>({set:Object.fromEntries(R.getTool(tool).modelFields.map(k=>[k,Object.hasOwn(stated,k)?stated[k]:null])),clear:[]});
const called=(name,args)=>({status:'completed',output:[{type:'reasoning',id:'rs_1',summary:[]},{type:'function_call',id:'fc_1',call_id:'call_1',name,arguments:typeof args==='string'?args:JSON.stringify(args),status:'completed'}],usage:{total_tokens:1}});
const BATTERY=['ec_calc_battery_runtime',patch('battery_runtime',FULL)];
const wire=draft=>({tool:draft.tool,input:JSON.parse(JSON.stringify(draft.input)),origins:{...draft.origins},fingerprint:draft.fingerprint});
function body({text='Bateria 1000 Wh, 365 kWh na rok, 100 procent, użyteczne 85 procent',state=EMPTY,lang='pl',toolDraft=null,form=null,job=null,clock=null,requestId='request-0001',contextToken='ctx-00000001',baseFingerprint}={}){
 return{protocol:'ec.assist',version:1,requestId,text,state,assistant:{lang,contextToken,baseFingerprint:baseFingerprint??A.baseFingerprint({revision:state.revision,toolDraft,form,job}),toolDraft,form,job,clock}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// A worker with fixture assets, the recording budget and BOTH real provider implementations over one synthetic transport.
function harness({key=KEY}={}){
 const seen={talkFactory:0,assistFactory:0,upstream:[],options:[]};
 const budget=budgetNamespace();
 const h={seen,budget,respond:async()=>called(...BATTERY)};
 const transport=async(route,options)=>{seen.upstream.push(route);seen.options.push(options);return h.respond(route,options);};
 const worker=createWorker({assets:ASSETS,build:'TEST-BUILD',
  providerFactory:async()=>{seen.talkFactory++;return createProvider({prompt:'TEST PROMPT',request:transport});},
  assistantProviderFactory:async()=>{seen.assistFactory++;return createAssistantProvider({prompt:'TEST ASSISTANT PROMPT',request:transport});}});
 h.env={EC_ALLOWED_EMAIL:OWNER,EC_ORIGIN:ORIGIN,PILOT_BUDGET:budget.namespace};
 if(key!==null)h.env.OPENAI_API_KEY=key;
 h.call=(path,init={},ctx=access(OWNER),origin=ORIGIN)=>worker.fetch(request(path,init,origin),h.env,ctx);
 h.session=async()=>(await h.call('/api/session',{headers:{'sec-fetch-site':'same-origin'}})).json();
 h.post=(path,token,id,payload,headers={},init={})=>h.call(path,{method:'POST',body:typeof payload==='string'?payload:JSON.stringify(payload),headers:{origin:ORIGIN,'sec-fetch-site':'same-origin','content-type':'application/json','x-ec-token':token,'x-ec-request-id':id,...headers},...init});
 h.assist=(token,id,options={},headers={},init={})=>h.post('/api/assist',token,id,body({requestId:id,...options}),headers,init);
 h.talk=(token,id,payload={state:EMPTY,text:TEXT,requestId:id})=>h.post('/api/talk',token,id,payload);
 h.count=path=>budget.calls.filter(p=>p===path).length;
 return h;
}
const failure=async(response,status,code)=>{
 const text=await response.text(),data=JSON.parse(text);
 assert.equal(response.status,status,text);assert.equal(data.code,code);assert.deepEqual(Object.keys(data),['error','code']);
 assert.ok(typeof data.error==='string'&&data.error.length>0&&data.error.length<300);assert.equal(response.headers.get('cache-control'),'no-store');
 return text;
};

test('/api/assist: one upstream call per accepted request, closed response shape, echoes, duplicate refused',async()=>{
 const h=harness(),s=await h.session();
 const r=await h.assist(s.token,'request-0001'),data=await r.json();
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('access-control-allow-origin'),null);
 assert.deepEqual(Object.keys(data).sort(),['assistant','base','baseRevision','corrections','diffs','domain','durationMs','model','online','proposalId','protocol','question','reply','requestId','scope','state','usage','version']);
 assert.deepEqual(Object.keys(data.assistant).sort(),['actionProposal','changedFields','clarification','historyReplyTruncated','lang','navigation','replyOrigin','result','toolDraft']);
 assert.deepEqual([data.protocol,data.version,data.requestId,data.baseRevision,data.domain,data.state.revision,data.model,data.online],['ec.assist',1,'request-0001',0,'calculator',1,'gpt-6-astra',true]);
 assert.deepEqual(data.base,{materialRevision:0,fingerprint:'ab1/r0/d:-/f:-/j:-',contextToken:'ctx-00000001'});
 assert.ok(data.reply.includes('Około 20 h 24 min'));assert.equal(data.assistant.result.status,'complete');
 assert.deepEqual([h.seen.upstream,h.seen.assistFactory,h.seen.talkFactory],[['/responses'],1,0]);
 assert.ok(h.seen.options[0].signal instanceof AbortSignal);
 assert.equal(h.seen.options[0].json.instructions.startsWith('TEST ASSISTANT PROMPT\n'),true);
 await failure(await h.assist(s.token,'request-0001'),409,'DUPLICATE_REQUEST');assert.equal(h.seen.upstream.length,1);
 // The answer's draft is sent back as it is; a correction changes only the stated field.
 h.respond=async()=>called('ec_calc_battery_runtime',patch('battery_runtime',{chargePercent:50}));
 const next=await h.assist(s.token,'request-0002',{text:'a przy 50 procent?',state:data.state,toolDraft:data.assistant.toolDraft}),second=await next.json();
 assert.equal(next.status,200);assert.deepEqual(second.assistant.changedFields,['chargePercent']);assert.ok(second.reply.includes('Około 10 h 12 min'));
 assert.deepEqual([second.baseRevision,second.state.revision,second.state.history.length],[1,2,4]);
 assert.deepEqual([h.seen.upstream.length,h.count('/begin'),h.count('/finish'),(await h.session()).remainingRequests],[2,3,2,58]);
});

test('/api/assist is behind the same identity, origin and CSRF gate; nothing is constructed, counted or sent when refused',async()=>{
 const h=harness(),{token}=await h.session(),minted=h.budget.calls.length;
 const payload=JSON.stringify(body()),good={origin:ORIGIN,'sec-fetch-site':'same-origin'};
 const post=(headers,ctx,origin)=>h.call('/api/assist',{method:'POST',body:payload,headers:{'content-type':'application/json','x-ec-token':token,'x-ec-request-id':'request-0001',...headers}},ctx,origin);
 const spoof={...good,'cf-access-authenticated-user-email':OWNER,'cf-access-jwt-assertion':'a.b.c',cookie:'CF_Authorization=a.b.c','x-forwarded-email':OWNER};
 for(const ctx of [null,{},{access:{}},{access:{getIdentity:async()=>null}},{access:{getIdentity:async()=>{throw new Error('x');}}},access('intruder@example.test')]){
  const r=await post(spoof,ctx);assert.equal(r.status,403);assert.equal(await r.text(),'{"error":"Forbidden"}');
 }
 const refused=[await post({}),await post({origin:'https://evil.example','sec-fetch-site':'same-origin'}),await post({origin:ORIGIN,'sec-fetch-site':'cross-site'}),await post({origin:ORIGIN,'sec-fetch-site':'same-site'}),await post({origin:'null'}),
  await post(good,access(OWNER),'https://other.example.test'),await post(good,access(OWNER),'http://pilot.example.test')];
 for(const r of refused){assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);}
 const get=await h.call('/api/assist',{headers:{'sec-fetch-site':'same-origin'}});assert.deepEqual([get.status,get.headers.get('allow')],[405,'POST']);
 assert.equal((await h.call('/api/assist',{method:'PUT',body:payload,headers:good})).status,405);
 assert.equal((await h.call('/api/assist/',{method:'POST',body:payload,headers:good})).status,404);
 assert.deepEqual([h.budget.calls.length,h.seen.assistFactory,h.seen.talkFactory,h.seen.upstream.length],[minted,0,0,0]);
 const env={EC_ALLOWED_EMAIL:OWNER,EC_ORIGIN:ORIGIN,OPENAI_API_KEY:KEY};
 for(const ctx of [undefined,{},access('intruder@example.test')])assert.equal((await production.fetch(request('/api/assist',{method:'POST',body:payload,headers:spoof}),env,ctx)).status,403);
});

test('/api/assist input and context are validated before reservation: nothing is counted and nothing is sent',async()=>{
 const h=harness(),{token}=await h.session(),id='request-0001';
 const draft=wire(R.run('battery_runtime',FULL).draft),stale={...draft,input:{...draft.input,chargePercent:50}};
 const history=Array.from({length:36},(_,i)=>({role:i%2?'assistant':'user',content:'m'}));
 const cases=[
  [403,'SESSION_TOKEN',await h.assist('',id)],[403,'SESSION_TOKEN',await h.assist('short',id)],[400,'REQUEST_FAILED',await h.assist(token,'bad id')],
  [415,'REQUEST_FAILED',await h.post('/api/assist',token,id,body(),{'content-type':'text/plain'})],
  [413,'REQUEST_FAILED',await h.post('/api/assist',token,id,{...body(),pad:'x'.repeat(200000)})],
  [400,'REQUEST_FAILED',await h.post('/api/assist',token,id,'{broken')],
  [400,'ASSIST_REQUEST',await h.post('/api/assist',token,id,body({requestId:'request-0002'}))],
  [400,'ASSIST_REQUEST',await h.post('/api/assist',token,id,'[]')],[400,'ASSIST_REQUEST',await h.post('/api/assist',token,id,'null')],
  [400,'ASSIST_REQUEST',await h.post('/api/assist',token,id,{state:EMPTY,text:TEXT,requestId:id})],
  [400,'ASSIST_REQUEST',await h.post('/api/assist',token,id,{...body(),provider:'test'})],[400,'ASSIST_REQUEST',await h.post('/api/assist',token,id,{...body(),model:'other'})],
  [400,'ASSIST_REQUEST',await h.assist(token,id,{text:'   '})],[400,'ASSIST_REQUEST',await h.assist(token,id,{text:'x'.repeat(3001)})],
  [400,'ASSIST_STATE',await h.assist(token,id,{state:{...EMPTY,version:2}})],
  [400,'ASSIST_CONTEXT',await h.assist(token,id,{toolDraft:{...draft,result:{status:'complete'},resultFingerprint:draft.fingerprint}})],
  [400,'ASSIST_CONTEXT',await h.assist(token,id,{toolDraft:{...draft,tool:'eval'}})],
  [400,'ASSIST_CONTEXT',await h.assist(token,id,{job:JOB})],[400,'ASSIST_CONTEXT',await h.assist(token,id,{job:{...JOB,title:'private'},clock:CLOCK})],
  [400,'ASSIST_CONTEXT',await h.assist(token,id,{lang:'de'})],
  [409,'ASSIST_MISMATCH',await h.assist(token,id,{toolDraft:stale})],[409,'ASSIST_MISMATCH',await h.assist(token,id,{baseFingerprint:'ab1/r9/d:-/f:-/j:-'})],
  [422,'HISTORY_LIMIT',await h.assist(token,id,{state:{...EMPTY,revision:18,history}})]
 ];
 for(const[i,[status,code,r]]of cases.entries()){try{await failure(r,status,code);}catch(e){e.message='case '+i+': '+e.message;throw e;}}
 assert.deepEqual([h.count('/begin'),h.seen.upstream.length,(await h.session()).remainingRequests],[0,0,60]);
 // A refused, unreserved attempt does not burn the request id.
 assert.equal((await h.assist(token,id)).status,200);assert.deepEqual([h.count('/begin'),h.seen.upstream.length],[1,1]);
});

// Review fix F8 (authored for coordinator execution; NOT RUN by the author).
test('/api/assist at the revision ceiling: HISTORY_LIMIT before the budget and the provider; revision 99 is still answered once',async()=>{
 const h=harness(),{token}=await h.session();
 await failure(await h.assist(token,'request-0001',{state:{...EMPTY,revision:100}}),422,'HISTORY_LIMIT');
 assert.deepEqual([h.count('/begin'),h.count('/finish'),h.seen.upstream.length,(await h.session()).remainingRequests],[0,0,0,60]);
 // Above the state limit it is an invalid state, as before; still nothing is reserved or sent.
 await failure(await h.assist(token,'request-0002',{state:{...EMPTY,revision:101}}),400,'ASSIST_STATE');
 assert.deepEqual([h.count('/begin'),h.seen.upstream.length],[0,0]);
 // Control: the last answerable revision runs exactly one provider call and returns the state at the ceiling.
 const r=await h.assist(token,'request-0003',{state:{...EMPTY,revision:99}}),data=await r.json();
 assert.equal(r.status,200,JSON.stringify(data));
 assert.deepEqual([data.baseRevision,data.state.revision,data.domain],[99,100,'calculator']);
 assert.deepEqual([h.count('/begin'),h.count('/finish'),h.seen.upstream.length],[1,1,1]);
 // That returned state cannot be continued: refused locally, with no second reservation and no second provider call.
 await failure(await h.assist(token,'request-0004',{text:'a przy 50 procent?',state:data.state,toolDraft:data.assistant.toolDraft}),422,'HISTORY_LIMIT');
 assert.deepEqual([h.count('/begin'),h.count('/finish'),h.seen.upstream.length,(await h.session()).remainingRequests],[1,1,1,59]);
 // A refused, unreserved attempt does not burn its request id.
 assert.equal((await h.assist(token,'request-0001')).status,200);
});

test('/api/assist without the server key: 503, no provider, no budget; no request value can enable it',async()=>{
 for(const key of [null,'','not-a-key']){
  const h=harness({key});
  await failure(await h.assist('a'.repeat(64),'request-0001',{},{'x-openai-api-key':KEY,authorization:'Bearer '+KEY}),503,'AI_NOT_CONFIGURED');
  assert.deepEqual([h.seen.assistFactory,h.seen.upstream.length,h.budget.calls.length,h.budget.storage.transactions],[0,0,0,0]);
 }
});

test('/api/assist failures stay counted, are never retried, release the lease and return only safe texts',async()=>{
 const h=harness(),{token}=await h.session(),texts=[];
 const attempts=[
  [422,'REQUEST_FAILED',async()=>{throw new Error('socket detail '+KEY);}],
  [401,'API_AUTH',async()=>{throw apiError(401,{error:{message:'Incorrect API key provided: '+KEY}});}],
  [429,'API_RATE_LIMIT',async()=>{throw apiError(429,{error:{code:'rate_limit_exceeded',message:'upstream detail'}});}],
  [422,'ASSIST_CALL',async()=>called('ec_calc_eval',{code:'process.env.OPENAI_API_KEY'})],
  [422,'ASSIST_CALL',async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'upstream detail 20 h'}]}]})],
  [422,'ASSIST_REFUSAL',async()=>({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'upstream detail '+KEY}]}]})],
  [422,'ASSIST_INCOMPLETE',async()=>({status:'incomplete',incomplete_details:{reason:'upstream detail'},output:[]})],
  [422,'ASSIST_ARGUMENTS',async()=>called('ec_calc_battery_runtime','{"set":{"capacityWh":1e999},"clear":[]}')],
  [422,'ASSIST_ARGUMENTS',async()=>called('ec_calc_battery_runtime','{"set":{"__proto__":{"upstream detail":1}},"clear":[]}')],
  [422,'PROPOSAL_EVIDENCE',async()=>called('ec_materials_propose',{...ADD,operations:[{...ADD.operations[0],source_quote:'upstream detail'}]})]
 ];
 for(const[i,[status,code,respond]]of attempts.entries()){h.respond=respond;texts.push(await failure(await h.assist(token,'request-000'+i,{text:TEXT}),status,code));}
 for(const text of texts)for(const secret of [KEY,'socket detail','Incorrect API key','upstream detail','process.env','stack','sk-'])assert.ok(!text.includes(secret),secret);
 assert.deepEqual([h.seen.upstream.length,h.count('/begin'),h.count('/finish'),(await h.session()).remainingRequests],[attempts.length,attempts.length,attempts.length,60-attempts.length]);
 await failure(await h.assist(token,'request-0000',{text:TEXT}),409,'DUPLICATE_REQUEST');assert.equal(h.seen.upstream.length,attempts.length);
 h.respond=async()=>called(...BATTERY);
 assert.equal((await h.assist(token,'request-0100')).status,200);
});

test('one lease for every endpoint: a concurrent /api/assist or /api/talk is refused, not queued',async()=>{
 const h=harness(),{token}=await h.session();let open;const gate=new Promise(resolve=>{open=resolve;});
 h.respond=async()=>{await gate;return called(...BATTERY);};
 const first=h.assist(token,'request-0001');
 for(let i=0;i<500&&h.seen.upstream.length===0;i++)await tick();
 assert.equal(h.seen.upstream.length,1);
 await failure(await h.assist(token,'request-0002'),409,'BUSY');await failure(await h.talk(token,'request-0003'),409,'BUSY');
 open();assert.equal((await first).status,200);
 h.respond=async()=>completed(ADD);
 assert.equal((await h.talk(token,'request-0004')).status,200);
 h.respond=async()=>called(...BATTERY);
 assert.equal((await h.assist(token,'request-0005')).status,200);
 assert.deepEqual([h.seen.upstream.length,h.count('/begin')],[3,5]);
});

test('abort: the request signal reaches the single provider call; the attempt is counted once and never repeated',async()=>{
 const h=harness(),{token}=await h.session(),controller=new AbortController();
 h.respond=async(route,{signal})=>{
  controller.abort();await tick();
  if(signal&&signal.aborted)throw Object.assign(new Error('Anulowano. Szkic bez zmian.'),{code:'CANCELLED',status:499,safe:true}); // what createTransport throws on an aborted fetch
  return called(...BATTERY);
 };
 await failure(await h.assist(token,'request-0001',{},{},{signal:controller.signal}),499,'CANCELLED');
 assert.deepEqual([h.seen.upstream.length,h.count('/begin'),h.count('/finish'),(await h.session()).remainingRequests],[1,1,1,59]);
 await failure(await h.assist(token,'request-0001'),409,'DUPLICATE_REQUEST');assert.equal(h.seen.upstream.length,1);
 h.respond=async()=>called(...BATTERY);
 assert.equal((await h.assist(token,'request-0002')).status,200);
});

test('proposals are answers only: the Worker stores nothing but the budget record and sends no job identity upstream',async()=>{
 const h=harness(),{token}=await h.session();
 h.respond=async()=>called('ec_job_note_propose',{text:'Klient chce gniazdo w garażu.',source_quote:'klient chce gniazdo w garażu'});
 const r=await h.assist(token,'request-0001',{text:'Zanotuj: klient chce gniazdo w garażu',job:JOB,clock:CLOCK}),data=await r.json();
 assert.equal(r.status,200);assert.equal(data.domain,'job_note');
 const p=data.assistant.actionProposal;
 assert.deepEqual([p.kind,p.committed,p.requiresUserReview,p.target.jobId,p.target.baseRevisionId],['ec.assist.jobNoteAppend',false,true,JOB.jobId,JOB.revisionId]);
 assert.equal(data.base.fingerprint,'ab1/r0/d:-/f:-/j:'+JOB.jobId+'@'+JOB.revisionId);
 assert.deepEqual([...h.budget.storage.data.keys()],['budget:v1']);
 const stored=JSON.stringify([...h.budget.storage.data.values()]),sent=JSON.stringify(h.seen.options[0].json);
 for(const secret of [JOB.jobId,JOB.revisionId,'gniazdo','request-0001',token,OWNER])assert.ok(!stored.includes(secret),secret);
 for(const secret of ['job1_','jrev1_',token,OWNER,KEY,'2026-11-21'])assert.ok(!sent.includes(secret),secret);
});

test('/api/talk is unchanged for already-open clients: same request, same result, no tools, no assistant provider',async()=>{
 const h=harness(),{token}=await h.session();
 h.respond=async()=>completed(ADD);
 const r=await h.talk(token,'request-0001'),data=await r.json();
 const direct=await createProvider({prompt:'TEST PROMPT',request:async()=>completed(ADD)}).run(EMPTY,TEXT);
 assert.equal(r.status,200);
 assert.deepEqual(Object.keys(data).sort(),[...Object.keys(direct),'requestId','baseRevision'].sort());
 for(const key of ['state','reply','question','diffs','proposalId','scope','model','online','usage'])assert.deepEqual(data[key],direct[key],key);
 assert.deepEqual([data.requestId,data.baseRevision,data.state.revision,data.scope],['request-0001',0,1,'materials']);
 for(const key of ['protocol','version','base','domain','assistant'])assert.ok(!(key in data),key);
 const q=h.seen.options[0].json;
 assert.ok(!('tools' in q)&&!('tool_choice' in q)&&!('parallel_tool_calls' in q));
 assert.deepEqual([q.text.format.type,q.text.format.strict,q.instructions.startsWith('TEST PROMPT\n')],['json_schema',true,true]);
 assert.deepEqual(q.input,[{role:'user',content:TEXT}]);
 assert.deepEqual([h.seen.talkFactory,h.seen.assistFactory],[1,0]);
 // The old endpoint keeps its closed three-key body; the new protocol is not accepted there, and the reverse.
 assert.equal((await h.post('/api/talk',token,'request-0002',body({requestId:'request-0002',text:TEXT}))).status,400);
 assert.equal((await h.post('/api/talk',token,'request-0003',{state:EMPTY,text:TEXT,requestId:'request-0003',assistant:body().assistant})).status,400);
 await failure(await h.post('/api/assist',token,'request-0004',{state:EMPTY,text:TEXT,requestId:'request-0004'}),400,'ASSIST_REQUEST');
 assert.deepEqual([h.seen.upstream.length,h.count('/begin')],[1,1]);
 // The same material utterance through /api/assist yields the same material state.
 h.respond=async()=>called('ec_materials_propose',ADD);
 const viaAssist=await(await h.assist(token,'request-0005',{text:TEXT})).json();
 for(const key of ['state','reply','question','diffs','proposalId','scope'])assert.deepEqual(viaAssist[key],direct[key],key);
 assert.equal(viaAssist.domain,'materials');
});
