// Worker gate, routing, origin/CSRF, limits and budget wiring. No network: the provider transport is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import production from '../candidate/server/worker.mjs';
import {apiError} from '../candidate/server/cloud-provider.mjs';
import {harness,access,request,ASSETS,ORIGIN,OWNER,KEY,EMPTY,webm} from './backend-fixtures.mjs';

const ROUTES=[['GET','/'],['HEAD','/'],['GET','/api/session'],['POST','/api/talk'],['POST','/api/transcribe'],['GET','/_auth'],['GET','/nope'],['DELETE','/ui.js']];
const SPOOF={'cf-access-authenticated-user-email':OWNER,'cf-access-jwt-assertion':'a.b.c',cookie:'CF_Authorization=a.b.c','x-forwarded-email':OWNER,origin:ORIGIN};
const begins=h=>h.budget.calls.filter(p=>p==='/begin').length;

test('no platform identity, a throwing identity or another e-mail: generic 403 before any asset, provider or storage use',async()=>{
 const contexts=[null,{},{access:null},{access:{}},{access:{email:OWNER}},{access:{getIdentity:async()=>{throw new Error('x');}}},{access:{getIdentity:async()=>null}},{access:{getIdentity:async()=>({})}},{access:{getIdentity:async()=>({email:''})}},{access:{getIdentity:async()=>({email:[OWNER]})}},access('intruder@example.test')];
 const h=harness();
 for(const ctx of contexts)for(const[method,path]of ROUTES){
  const r=await h.call(path,{method,headers:SPOOF},ctx);
  assert.equal(r.status,403);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(await r.text(),method==='HEAD'?'':'{"error":"Forbidden"}');
 }
 h.env.EC_ALLOWED_EMAIL='';
 assert.equal((await h.call('/',{},access(''))).status,403);
 assert.ok(h.untouched());
});

test('the deployed default export fails closed and exposes only fetch',async()=>{
 const env={EC_ALLOWED_EMAIL:OWNER,EC_ORIGIN:ORIGIN,OPENAI_API_KEY:KEY};
 assert.deepEqual(Object.keys(production),['fetch']);
 for(const ctx of [undefined,{},access('intruder@example.test')])assert.equal((await production.fetch(request('/',{headers:SPOOF}),env,ctx)).status,403);
});

test('static assets: exact own entries only, GET/HEAD, hash and build headers, frame CSP only for mobile.html',async()=>{
 const h=harness();
 const index=await h.call('/',{},access('Owner@Example.TEST')); // e-mail comparison is case-insensitive
 assert.equal(index.status,200);assert.equal(await index.text(),'<!doctype html><title>fixture</title>');
 assert.equal(index.headers.get('x-empire-asset-sha256'),ASSETS['/'].sha256);assert.equal(index.headers.get('x-empire-build'),'TEST-BUILD');
 assert.equal(index.headers.get('content-type'),'text/html; charset=utf-8');assert.equal(index.headers.get('cache-control'),'no-store');
 assert.match(index.headers.get('content-security-policy'),/frame-ancestors 'none'$/);assert.equal(index.headers.get('x-content-type-options'),'nosniff');
 assert.equal(index.headers.get('access-control-allow-origin'),null);
 const head=await h.call('/ui.js',{method:'HEAD'});
 assert.deepEqual([head.status,await head.text(),head.headers.get('x-empire-asset-sha256')],[200,'',ASSETS['/ui.js'].sha256]);
 const frame=await h.call('/workspace/mobile.html');
 assert.match(frame.headers.get('content-security-policy'),/script-src 'self' 'unsafe-inline'.*frame-ancestors 'self'$/);
 for(const path of ['/workspace','/workspace/','/index.htm','/%69ndex.html','/constructor','/__proto__','/toString','/assets.generated.mjs','/contract.cjs']){
  const r=await h.call(path);assert.equal(r.status,404,path);assert.equal(r.headers.get('location'),null);
 }
 const post={method:'POST',headers:{origin:ORIGIN}};
 assert.equal((await h.call('/',post)).status,405);assert.equal((await h.call('/nope',post)).status,404);
 assert.equal((await h.call('/api/talk')).status,405);assert.equal((await h.call('/api/session',{method:'PUT',headers:{origin:ORIGIN}})).status,405);
 const headApi=await h.call('/api/session',{method:'HEAD'});assert.deepEqual([headApi.status,await headApi.text()],[405,'']);
 const auth=await h.call('/_auth',{headers:{'sec-fetch-site':'cross-site'}});
 assert.deepEqual([auth.status,auth.headers.get('location'),await auth.text()],[303,'/','']);
 assert.equal((await h.call('/_auth',post)).status,405);
 assert.equal(h.seen.factory+h.budget.calls.length,0);
});

test('origin and CSRF: wrong host, foreign Origin and cross-site API calls are refused before budget or provider',async()=>{
 const h=harness(),{token}=await h.session(),minted=h.budget.calls.length;
 const body=JSON.stringify({state:EMPTY,text:'x',requestId:'request-0001'});
 const post=headers=>h.call('/api/talk',{method:'POST',body,headers:{'content-type':'application/json','x-ec-token':token,'x-ec-request-id':'request-0001',...headers}});
 const refused=[
  await post({}),await post({origin:'https://evil.example'}),await post({origin:ORIGIN,'sec-fetch-site':'cross-site'}),await post({origin:ORIGIN,'sec-fetch-site':'same-site'}),await post({origin:'null'}),
  await h.call('/api/session',{headers:{'sec-fetch-site':'cross-site'}}),await h.call('/',{headers:{origin:'https://evil.example'}}),
  await h.call('/',{},access(OWNER),'https://other.example.test'),await h.call('/',{},access(OWNER),'http://pilot.example.test')
 ];
 for(const r of refused){assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);}
 assert.equal((await h.call('/',{headers:{'sec-fetch-site':'cross-site'}})).status,200); // first navigation after the Access login redirect
 delete h.env.EC_ORIGIN;assert.equal((await h.call('/')).status,403);
 assert.deepEqual([h.budget.calls.length,h.seen.factory,h.seen.upstream.length],[minted,0,0]);
});

test('without OPENAI_API_KEY: session is offline, operations return 503, and neither budget nor provider is used',async()=>{
 for(const key of [null,'','not-a-key']){
  const h=harness({key});
  assert.deepEqual(await h.session(),{build:'TEST-BUILD',model:'gpt-6-astra',speechModel:'gpt-transcribe',online:false,prototype:true,remainingRequests:0,token:null,reason:'AI_NOT_CONFIGURED'});
  for(const r of [await h.talk('a'.repeat(64),'request-0001'),await h.post('/api/transcribe','a'.repeat(64),'request-0002',webm(),{'content-type':'audio/webm'})]){
   assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).code,'AI_NOT_CONFIGURED');
  }
  assert.deepEqual([h.seen.factory,h.seen.upstream.length,h.budget.calls.length,h.budget.storage.transactions],[0,0,0,0]);
 }
});

test('configured: session token, one upstream call per accepted request, old result shape, duplicate refused',async()=>{
 const h=harness(),s=await h.session();
 assert.deepEqual(Object.keys(s),['build','model','speechModel','online','prototype','remainingRequests','token','reason']);
 assert.deepEqual([s.online,s.remainingRequests,s.reason,s.prototype],[true,60,null,true]);assert.match(s.token,/^[0-9a-f]{64}$/);
 assert.deepEqual([...new Set(h.budget.names)],['owner-pilot-v1']);
 const r=await h.talk(s.token,'request-0001'),data=await r.json();
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual([data.requestId,data.baseRevision,data.state.revision,data.model,data.online,data.diffs.length,data.scope],['request-0001',0,1,'gpt-6-astra',true,1,'materials']);
 assert.deepEqual(h.seen.upstream,['/responses']);
 const again=await h.talk(s.token,'request-0001');
 assert.deepEqual([again.status,(await again.json()).code,h.seen.upstream.length],[409,'DUPLICATE_REQUEST',1]);
 const audio=await h.post('/api/transcribe',s.token,'request-0002',webm(),{'content-type':'audio/webm;codecs=opus'});
 assert.deepEqual([audio.status,await audio.json()],[200,{text:'dwa breakery',model:'gpt-transcribe',requestId:'request-0002'}]);
 assert.deepEqual(h.seen.upstream,['/responses','/audio/transcriptions']);
 assert.equal((await h.session()).remainingRequests,58);
 assert.equal((await h.talk('f'.repeat(64),'request-0003')).status,403);assert.equal(h.seen.upstream.length,2);
});

test('input is validated before reservation: nothing is counted and nothing is sent',async()=>{
 const h=harness(),{token}=await h.session(),json={'content-type':'application/json'},id='request-0001';
 const cases=[
  [403,await h.talk('','request-0001')],[403,await h.talk('short',id)],[400,await h.talk(token,'bad id')],
  [415,await h.post('/api/talk',token,id,'{}',{'content-type':'text/plain'})],
  [413,await h.post('/api/talk',token,id,JSON.stringify({state:EMPTY,text:'x',requestId:id,pad:'x'.repeat(80000)}),json)],
  [400,await h.post('/api/talk',token,id,'{broken',json)],
  [400,await h.post('/api/talk',token,id,JSON.stringify({state:EMPTY,text:'x',requestId:'request-0002'}),json)],
  [400,await h.post('/api/talk',token,id,JSON.stringify({state:EMPTY,text:'x',requestId:id,extra:1}),json)],
  [400,await h.talk(token,id,{text:'   '})],[400,await h.talk(token,id,{text:'x'.repeat(3001)})],
  [400,await h.talk(token,id,{state:{...EMPTY,version:2}})],
  [415,await h.post('/api/transcribe',token,id,webm(),{'content-type':'audio/ogg'})],
  [422,await h.post('/api/transcribe',token,id,webm(64),{'content-type':'audio/webm'})],
  [422,await h.post('/api/transcribe',token,id,new Uint8Array(256),{'content-type':'audio/webm'})],
  [413,await h.post('/api/transcribe',token,id,webm(8*1024*1024+1),{'content-type':'audio/webm'})]
 ];
 for(const[i,[status,r]]of cases.entries()){assert.equal(r.status,status,'case '+i);assert.equal(r.headers.get('cache-control'),'no-store');}
 assert.deepEqual([begins(h),h.seen.upstream.length,(await h.session()).remainingRequests],[0,0,60]);
});

test('a failed upstream attempt stays counted, is not retried, releases the lease and leaks no detail or key',async()=>{
 const h=harness(),{token}=await h.session();
 h.respond=async()=>{throw new Error('socket detail '+KEY);};
 const crashed=await h.talk(token,'request-0001'),crashedText=await crashed.text();
 assert.equal(crashed.status,422);assert.equal(JSON.parse(crashedText).code,'REQUEST_FAILED');
 h.respond=async()=>{throw apiError(401,{error:{message:'Incorrect API key provided: '+KEY}});};
 const rejected=await h.talk(token,'request-0002'),rejectedText=await rejected.text();
 assert.deepEqual([rejected.status,JSON.parse(rejectedText).code],[401,'API_AUTH']);
 for(const text of [crashedText,rejectedText])assert.ok(!text.includes(KEY)&&!text.includes('socket detail')&&!text.includes('Incorrect API key'));
 assert.deepEqual([h.seen.upstream.length,(await h.session()).remainingRequests],[2,58]);
 assert.equal((await h.talk(token,'request-0001')).status,409);assert.equal(h.seen.upstream.length,2);
});

test('one global lease: a concurrent operation is refused rather than queued, and the lease is released afterwards',async()=>{
 const h=harness(),{token}=await h.session();let open;const gate=new Promise(resolve=>{open=resolve;});
 const normal=h.respond;h.respond=async route=>{await gate;return normal(route);};
 const first=h.talk(token,'request-0001');
 for(let i=0;i<500&&h.seen.upstream.length===0;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.seen.upstream.length,1);
 const second=await h.talk(token,'request-0002');
 assert.deepEqual([second.status,(await second.json()).code],[409,'BUSY']);
 open();assert.equal((await first).status,200);
 const third=await h.talk(token,'request-0003');
 assert.deepEqual([third.status,h.seen.upstream.length,begins(h)],[200,2,3]);
});
