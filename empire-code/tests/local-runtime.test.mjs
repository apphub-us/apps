// LOCAL-WORKSPACE-5 — the local Node runtime (local/server.mjs) over real loopback HTTP on an ephemeral port.
// Authored for root execution; the author could not run anything and claims no result.
// No credential and no network: the provider transport is a controlled function injected through createLocalServer().
// Calculator arithmetic, evidence parsing and budget internals are tested by the existing suites and are not repeated.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createLocalServer,LOCAL_RUNTIME,MAX_BODY} from '../local/server.mjs';
import {apiError} from '../candidate/server/cloud-provider.mjs';
import {ASSISTANT_PROMPT} from '../candidate/server/assistant-prompt.mjs';
import {EMPTY,ADD,TEXT,completed,webm} from './backend-fixtures.mjs';
import {ASession,R,FULL,BATTERY,JOB,CLOCK,MEASURED,READING,NOTE_TEXT,NOTE,call,until,sent,refused,harness,called,patch} from './local-fixtures.mjs';

const APP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(APP,'candidate','build-manifest.generated.json'),'utf8'));
const ui=fs.readFileSync(path.join(APP,'candidate','browser','ui.js'),'utf8');
// The error codes the accepted frontend shows with the server's own text (ui.js API_CODES), read from its source.
const FRONTEND_CODES=new RegExp(/const API_CODES=\/(.+?)\/;/.exec(ui)[1]);
const GENERIC='Operacja nie powiodła się. Szkic bez zmian; brak automatycznej ponownej próby.';

test('static: every path of the accepted manifest is served byte-identically, with the canonical headers; nothing else exists',async t=>{
 const h=await harness(t);
 assert.equal(manifest.build,'PRIVATE-PILOT-5');assert.equal(manifest.served.length,21);
 for(const entry of manifest.served){
  const r=await h.get(entry.url);
  assert.equal(r.status,200,entry.url);assert.equal(r.body.length,entry.bytes,entry.url);assert.equal(sha256(r.body),entry.sha256,entry.url);
  assert.deepEqual([r.headers['x-empire-asset-sha256'],r.headers['content-type'],r.headers['x-empire-build'],r.headers['x-empire-local-runtime'],r.headers['cache-control'],r.headers['x-content-type-options']],
   [entry.sha256,entry.mime,'PRIVATE-PILOT-5',LOCAL_RUNTIME,'no-store','nosniff'],entry.url);
  assert.ok(r.headers['content-security-policy'].includes(entry.url==='/workspace/mobile.html'?"frame-ancestors 'self'":"frame-ancestors 'none'"),entry.url);
 }
 // The same bytes as the canonical browser files (sw.js is the build's generated worker, pinned by the manifest).
 for(const source of manifest.sources){
  if(source.path==='sw.js')continue;
  assert.ok((await h.get('/'+source.path)).body.equals(fs.readFileSync(path.join(APP,'candidate','browser',...source.path.split('/')))),source.path);
 }
 assert.ok((await h.get('/')).body.equals(fs.readFileSync(path.join(APP,'candidate','browser','index.html'))));
 assert.equal(sha256((await h.get('/sw.js')).body),manifest.serviceWorker.generatedSha256);
 const head=await call(h.origin,{method:'HEAD',path:'/'});
 assert.deepEqual([head.status,head.body.length,head.headers['x-empire-local-runtime']],[200,0,LOCAL_RUNTIME]);
 for(const missing of ['/package.json','/../package.json','/local/server.mjs','/candidate/server/worker.mjs','/api','/workspace/','/index.html/'])assert.equal((await h.get(missing)).status,404,missing);
 const post=await call(h.origin,{method:'POST',path:'/',headers:{origin:h.origin,'sec-fetch-site':'same-origin'},body:'x'});
 assert.deepEqual([post.status,post.headers.allow],[405,'GET, HEAD']);
 assert.equal(h.seen.upstream.length,0);
});

test('GET /api/session: the shape the accepted frontend reads, the configured models, and no provider contact',async t=>{
 const h=await harness(t),r=await h.get('/api/session',{'sec-fetch-site':'same-origin'}),s=r.json();
 assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');
 assert.deepEqual(Object.keys(s).sort(),['build','model','online','prototype','reason','remainingRequests','speechModel','token']);
 assert.deepEqual([s.build,s.model,s.speechModel,s.online,s.prototype,s.remainingRequests,s.reason],['PRIVATE-PILOT-5','gpt-6-astra','gpt-transcribe',true,true,60,null]);
 assert.match(s.token,/^[0-9a-f]{64}$/);
 assert.notEqual((await h.session()).token,s.token);
 assert.deepEqual([(await call(h.origin,{method:'POST',path:'/api/session',headers:{origin:h.origin,'sec-fetch-site':'same-origin'},body:'{}'})).status,h.seen.upstream.length],[405,0]);
 assert.throws(()=>createLocalServer(),/provider transport/);
});

test('loopback gate: exact Host, same Origin and no cross-site request, for pages and for the API; nothing reaches the provider',async t=>{
 const h=await harness(t),{token}=await h.session(),payload=JSON.stringify(sent('request-0001'));
 const api={'content-type':'application/json','x-ec-token':token,'x-ec-request-id':'request-0001'},good={origin:h.origin,'sec-fetch-site':'same-origin'};
 const page=headers=>call(h.origin,{path:'/',headers}),post=headers=>call(h.origin,{method:'POST',path:'/api/assist',headers:{...api,...headers},body:payload});
 const cases=[
  await page({host:'localhost:'+h.port}),await page({host:'127.0.0.1'}),await page({host:'127.0.0.1:1'}),await page({host:'evil.example'}),await page({host:'evil.example:'+h.port}),
  await page({'sec-fetch-site':'cross-site'}),await page({origin:'http://evil.example'}),await page({origin:'http://localhost:'+h.port}),await page({origin:'null'}),
  await h.get('/api/session',{'sec-fetch-site':'cross-site'}),await h.get('/api/session',{'sec-fetch-site':'same-site'}),await h.get('/api/session',{'sec-fetch-site':'none'}),
  await post({...good,host:'localhost:'+h.port}),await post({origin:'http://evil.example','sec-fetch-site':'same-origin'}),await post({origin:'http://localhost:'+h.port,'sec-fetch-site':'same-origin'}),
  await post({origin:h.origin,'sec-fetch-site':'cross-site'}),await post({origin:h.origin,'sec-fetch-site':'same-site'}),await post({origin:'null'}),await post({})
 ];
 for(const[i,r]of cases.entries()){assert.equal(r.status,403,'case '+i);assert.equal(r.headers['access-control-allow-origin'],undefined);assert.equal(typeof r.json().error,'string');}
 assert.equal((await call(h.origin,{path:'http://evil.example/'})).status,400);
 assert.equal((await call(h.origin,{path:'//evil.example/'})).status,400);
 assert.deepEqual([h.seen.upstream.length,(await h.session()).remainingRequests],[0,60]);
 // Control: the same request from the app's own origin is answered.
 assert.equal((await post(good)).status,200);assert.equal(h.seen.upstream.length,1);
});

test('token, request id, body and context are refused before the provider and before the budget; duplicate and busy are refused, not queued',async t=>{
 const h=await harness(t),{token}=await h.session(),id='request-0001',body=sent(id);
 const cases=[
  [403,'SESSION_TOKEN',await h.assist('a'.repeat(64),id)],[403,'SESSION_TOKEN',await h.assist('short',id)],[403,'SESSION_TOKEN',await h.assist('',id)],
  [400,'REQUEST_FAILED',await h.assist(token,'bad id')],
  [415,'REQUEST_FAILED',await h.post('/api/assist',token,id,body,{'content-type':'text/plain'})],
  [400,'REQUEST_FAILED',await h.post('/api/assist',token,id,'{broken')],
  [413,'REQUEST_FAILED',await h.post('/api/assist',token,id,{...body,pad:'x'.repeat(200001)})],
  [413,'REQUEST_FAILED',await call(h.origin,{method:'POST',path:'/api/transcribe',headers:{origin:h.origin,'sec-fetch-site':'same-origin','content-type':'audio/webm','x-ec-token':token,'x-ec-request-id':id,'content-length':String(MAX_BODY+1)}})],
  [400,'ASSIST_REQUEST',await h.post('/api/assist',token,id,sent('request-0002'))],
  [400,'ASSIST_REQUEST',await h.post('/api/assist',token,id,{state:EMPTY,text:TEXT,requestId:id})],
  [400,'ASSIST_REQUEST',await h.post('/api/assist',token,id,{...body,model:'other'})],
  [400,'ASSIST_STATE',await h.assist(token,id,{state:{...EMPTY,version:2}})],
  [400,'ASSIST_CONTEXT',await h.assist(token,id,{job:JOB})],
  [409,'ASSIST_MISMATCH',await h.post('/api/assist',token,id,{...body,assistant:{...body.assistant,baseFingerprint:'ab1/r9/d:-/f:-/j:-'}})],
  [400,'REQUEST_FAILED',await h.post('/api/talk',token,id,{state:EMPTY,text:TEXT,requestId:id,assistant:body.assistant})],
  [415,'REQUEST_FAILED',await h.post('/api/transcribe',token,id,Buffer.from(webm()),{'content-type':'audio/ogg'})],
  [422,'AUDIO_SIZE',await h.post('/api/transcribe',token,id,Buffer.from(webm(10)),{'content-type':'audio/webm'})]
 ];
 // SESSION_TOKEN is handled by ui.js apiError() on its own (one silent renewal); every other code must be one it shows.
 for(const[i,[status,code,r]]of cases.entries()){try{const got=refused(r,status,code).code;assert.ok(got==='SESSION_TOKEN'||FRONTEND_CODES.test(got),got);}catch(e){e.message='case '+i+': '+e.message;throw e;}}
 assert.equal((await h.get('/api/assist',{'sec-fetch-site':'same-origin'})).status,405);
 assert.deepEqual([h.seen.upstream.length,(await h.session()).remainingRequests],[0,60]);
 // A refused, unreserved attempt does not burn its request id; an accepted one does.
 assert.equal((await h.assist(token,id)).status,200);
 refused(await h.assist(token,id),409,'DUPLICATE_REQUEST');
 assert.equal(h.seen.upstream.length,1);
 // One operation at a time, for every endpoint.
 let open;const gate=new Promise(resolve=>{open=resolve;});
 h.respond=async()=>{await gate;return called(...BATTERY);};
 const first=h.assist(token,'request-0002');
 await until(()=>h.seen.upstream.length===2);
 refused(await h.assist(token,'request-0003'),409,'BUSY');
 refused(await h.post('/api/talk',token,'request-0004',{state:EMPTY,text:TEXT,requestId:'request-0004'}),409,'BUSY');
 open();assert.equal((await first).status,200);
 assert.deepEqual([h.seen.upstream.length,(await h.session()).remainingRequests],[2,58]);
});

test('/api/assist success: one strict-tool request to the configured model, the registry computes, and the accepted frontend accepts the answer',async t=>{
 const h=await harness(t),{token}=await h.session(),first=sent('request-0001');
 const r=await h.post('/api/assist',token,'request-0001',first),data=r.json();
 assert.equal(r.status,200,r.body.toString());
 assert.deepEqual(Object.keys(data).sort(),['assistant','base','baseRevision','corrections','diffs','domain','durationMs','model','online','proposalId','protocol','question','reply','requestId','scope','state','usage','version']);
 assert.deepEqual([data.protocol,data.version,data.requestId,data.baseRevision,data.domain,data.state.revision,data.model,data.online],['ec.assist',1,'request-0001',0,'calculator',1,'gpt-6-astra',true]);
 // The frontend's own acceptance rules: request id, base revision, fingerprint, context token and the closed shape.
 const answer=ASession.response(data,first);
 assert.deepEqual([answer.domain,answer.tool.tool,answer.result.tool],['calculator','battery_runtime','battery_runtime']);
 // The number is the registry's: the canonical engine, re-run on the returned draft (as the frontend does before it
 // shows a result), confirms the returned result as current.
 const verified=R.verifyResult({kind:R.DRAFT_KIND,revision:R.CONTRACT_REVISION,...data.assistant.toolDraft,result:data.assistant.result,resultFingerprint:data.assistant.toolDraft.fingerprint});
 assert.deepEqual([verified.ok,verified.current],[true,true],JSON.stringify(verified));
 assert.deepEqual(Object.keys(data.assistant.toolDraft.input).sort(),Object.keys(FULL).sort());
 assert.equal(data.assistant.result.status,'complete');assert.ok(data.reply.includes('Około 20 h 24 min'),data.reply);
 // Exactly one upstream request, carrying the accepted contract.
 assert.deepEqual(h.seen.upstream,['/responses']);
 const q=h.seen.options[0].json;
 assert.deepEqual([q.model,q.store,q.tool_choice,q.parallel_tool_calls,q.instructions.startsWith(ASSISTANT_PROMPT+'\n')],['gpt-6-astra',false,'required',false,true]);
 assert.ok(q.tools.length>4&&q.tools.every(tool=>tool.type==='function'&&tool.strict===true));
 assert.ok(h.seen.options[0].signal instanceof AbortSignal);
 // The answer belongs to its own request only.
 assert.throws(()=>ASession.response(data,sent('request-0009')),e=>e.code==='ASSIST_RESPONSE');
 assert.throws(()=>ASession.response(data,sent('request-0001',{state:{...EMPTY,revision:3}})),e=>e.code==='ASSIST_RESPONSE');
 assert.throws(()=>ASession.response(data,sent('request-0001',{contextToken:'ctx-00000002'})),e=>e.code==='ASSIST_RESPONSE');
 // A correction is sent on the returned state and draft and changes only the stated field.
 h.respond=async()=>called('ec_calc_battery_runtime',patch('battery_runtime',{chargePercent:50}));
 const second=sent('request-0002',{text:'a przy 50 procent?',state:data.state,toolDraft:data.assistant.toolDraft});
 const next=(await h.post('/api/assist',token,'request-0002',second)).json(),corrected=ASession.response(next,second);
 assert.deepEqual([next.baseRevision,next.state.revision,corrected.changedFields],[1,2,['chargePercent']]);assert.ok(next.reply.includes('Około 10 h 12 min'),next.reply);
 // The older state is no longer the base of that draft: refused locally, nothing sent.
 refused(await h.post('/api/assist',token,'request-0003',{...second,requestId:'request-0003',state:EMPTY}),409,'ASSIST_MISMATCH');
 assert.deepEqual([h.seen.upstream.length,(await h.session()).remainingRequests],[2,58]);
});

test('note and measurement proposals stay bound to the job, revision and clock that were sent; nothing is committed',async t=>{
 const h=await harness(t),{token}=await h.session();
 h.respond=async()=>called('ec_job_note_propose',NOTE);
 const noteSent=sent('request-0001',{text:NOTE_TEXT,job:JOB,clock:CLOCK}),noteData=(await h.post('/api/assist',token,'request-0001',noteSent)).json();
 assert.equal(noteData.domain,'job_note',JSON.stringify(noteData));
 const note=ASession.response(noteData,noteSent).proposal,raw=noteData.assistant.actionProposal;
 assert.deepEqual([note.kind,note.note,note.job],['note',NOTE.text,{jobId:JOB.jobId,revisionId:JOB.revisionId,revisionNumber:JOB.revisionNumber}]);
 assert.deepEqual([raw.committed,raw.requiresUserReview,raw.target.baseRevisionId,raw.append.baseNotesLength],[false,true,JOB.revisionId,JOB.notesLength]);
 assert.equal(noteData.base.fingerprint,'ab1/r0/d:-/f:-/j:'+JOB.jobId+'@'+JOB.revisionId);
 // The same answer against a request for another revision of the job, or without a job, is refused by the frontend.
 const moved={...JOB,revisionId:'jrev1_'+'c'.repeat(32),revisionNumber:5};
 assert.throws(()=>ASession.response(noteData,sent('request-0001',{text:NOTE_TEXT,job:moved,clock:CLOCK})),e=>e.code==='ASSIST_RESPONSE');
 assert.throws(()=>ASession.response(noteData,sent('request-0001',{text:NOTE_TEXT})),e=>e.code==='ASSIST_RESPONSE');
 // A request whose job changed after its fingerprint was taken is refused by the server before the provider.
 refused(await h.post('/api/assist',token,'request-0002',{...noteSent,requestId:'request-0002',assistant:{...noteSent.assistant,job:moved}}),409,'ASSIST_MISMATCH');
 assert.equal(h.seen.upstream.length,1);
 // The model sees that a job is selected, never which one.
 const upstream=JSON.stringify(h.seen.options[0].json);
 for(const secret of ['job1_','jrev1_',token,'2026-11-21'])assert.ok(!upstream.includes(secret),secret);

 h.respond=async()=>called('ec_job_measurement_propose',READING);
 const readSent=sent('request-0003',{text:MEASURED,state:noteData.state,job:JOB,clock:CLOCK}),readData=(await h.post('/api/assist',token,'request-0003',readSent)).json();
 assert.equal(readData.domain,'job_measurement',JSON.stringify(readData));
 const reading=ASession.response(readData,readSent).proposal;
 assert.deepEqual([reading.kind,reading.fields.valueText,reading.fields.unit,reading.fields.measuredLocal,reading.fields.utcOffset,reading.job.revisionId],['measurement','121.4','V',CLOCK.local,CLOCK.utcOffset,JOB.revisionId]);
 assert.deepEqual([readData.assistant.actionProposal.committed,readData.assistant.actionProposal.timeOrigin],[false,'client_clock']);
 // Another device clock than the one sent: the 'client_clock' proposal is refused as a whole.
 assert.throws(()=>ASession.response(readData,{...readSent,assistant:{...readSent.assistant,clock:{local:'2026-11-21T15:05',utcOffset:'+01:00'}}}),e=>e.code==='ASSIST_RESPONSE');
 // Evidence that is not in the utterance is refused by the canonical contract; the attempt stays counted.
 h.respond=async()=>called('ec_job_measurement_propose',{...READING,value_text:'230',value_quote:'230',reading_quote:'230 V'});
 refused(await h.assist(token,'request-0004',{text:MEASURED,job:JOB,clock:CLOCK}),422,'ASSIST_EVIDENCE');
 assert.deepEqual([h.seen.upstream.length,(await h.session()).remainingRequests],[3,57]);
});

test('/api/talk and /api/transcribe keep their accepted shapes and routes',async t=>{
 const h=await harness(t),{token}=await h.session();
 h.respond=async route=>route==='/responses'?completed(ADD):{text:' dwa breakery '};
 const talk=await h.post('/api/talk',token,'request-0001',{state:EMPTY,text:TEXT,requestId:'request-0001'}),data=talk.json();
 assert.equal(talk.status,200,talk.body.toString());
 assert.deepEqual([data.requestId,data.baseRevision,data.state.revision,data.scope,data.model,data.state.items.length],['request-0001',0,1,'materials','gpt-6-astra',1]);
 for(const key of ['protocol','base','domain','assistant'])assert.ok(!(key in data),key);
 const q=h.seen.options[0].json;
 assert.ok(!('tools' in q)&&q.text.format.strict===true&&q.model==='gpt-6-astra');
 const audio=await h.post('/api/transcribe',token,'request-0002',Buffer.from(webm()),{'content-type':'audio/webm;codecs=opus'});
 assert.equal(audio.status,200,audio.body.toString());
 assert.deepEqual(audio.json(),{text:'dwa breakery',model:'gpt-transcribe',requestId:'request-0002'});
 assert.deepEqual(h.seen.upstream,['/responses','/audio/transcriptions']);
 assert.equal(h.seen.options[1].form.get('model'),'gpt-transcribe');
 assert.equal((await h.session()).remainingRequests,58);
});

test('provider failures: one attempt each, never retried, counted, and returned as codes and texts the accepted frontend shows',async t=>{
 const h=await harness(t),{token}=await h.session(),texts=[];
 const attempts=[
  [422,'REQUEST_FAILED',async()=>{throw new Error('socket detail sk-not-shown');}],
  [401,'API_AUTH',async()=>{throw apiError(401,{error:{message:'upstream detail'}});}],
  [429,'API_QUOTA',async()=>{throw apiError(429,{error:{code:'insufficient_quota',message:'upstream detail'}});}],
  [429,'API_RATE_LIMIT',async()=>{throw apiError(429,{error:{code:'rate_limit_exceeded'}});}],
  [503,'MODEL_UNAVAILABLE',async()=>{throw apiError(404,{});}],
  [422,'ASSIST_CALL',async()=>called('ec_calc_eval',{code:'process.exit()'})],
  [422,'ASSIST_INCOMPLETE',async()=>({status:'incomplete',output:[]})],
  [422,'PROPOSAL_EVIDENCE',async()=>called('ec_materials_propose',{...ADD,operations:[{...ADD.operations[0],source_quote:'upstream detail'}]})]
 ];
 for(const[i,[status,code,respond]]of attempts.entries()){
  h.respond=respond;
  const r=await h.assist(token,'request-000'+i,{text:TEXT}),data=refused(r,status,code);
  assert.match(data.code,FRONTEND_CODES);assert.deepEqual(Object.keys(data),['error','code']);texts.push(r.body.toString('utf8'));
 }
 assert.equal(JSON.parse(texts[0]).error,GENERIC);
 for(const text of texts)for(const secret of ['socket detail','upstream detail','sk-','process.exit','stack'])assert.ok(!text.includes(secret),secret);
 assert.deepEqual([h.seen.upstream.length,(await h.session()).remainingRequests],[attempts.length,60-attempts.length]);
 refused(await h.assist(token,'request-0000',{text:TEXT}),409,'DUPLICATE_REQUEST');
 assert.equal(h.seen.upstream.length,attempts.length);
});

test('abort: a client that goes away aborts the single provider call; the attempt is counted once and the lease is released',async t=>{
 const h=await harness(t),{token}=await h.session();let aborted=false;
 h.respond=(route,{signal})=>new Promise((resolve,reject)=>{
  signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('Anulowano. Szkic bez zmian.'),{code:'CANCELLED',status:499,safe:true}));},{once:true}); // what the canonical transport throws
 });
 const req=http.request({host:'127.0.0.1',port:h.port,method:'POST',path:'/api/assist',agent:false,headers:{origin:h.origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-ec-token':token,'x-ec-request-id':'request-0001'}});
 req.on('error',()=>{});req.end(JSON.stringify(sent('request-0001')));
 await until(()=>h.seen.upstream.length===1);
 req.destroy();
 await until(()=>aborted);
 h.respond=async()=>called(...BATTERY);
 // The lease is released a few ticks after the abort; a BUSY refusal reserves nothing, so polling costs no attempt.
 let answered=null;
 for(let i=0;i<200&&!answered;i++){const r=await h.assist(token,'request-1'+String(i).padStart(3,'0'));if(r.status===409&&r.json().code==='BUSY')await new Promise(resolve=>setTimeout(resolve,10));else answered=r;}
 assert.equal(answered&&answered.status,200);
 refused(await h.assist(token,'request-0001'),409,'DUPLICATE_REQUEST');
 assert.deepEqual([h.seen.upstream.length,(await h.session()).remainingRequests],[2,58]);
});
