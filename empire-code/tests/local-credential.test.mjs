// LOCAL-WORKSPACE-7 — key reader, live transport wiring, persisted budget and the --check verification.
// Authored for root execution; the author could not run anything and claims no result.
// The real credential is never touched: every key reader gets a synthetic temporary directory, every live transport
// gets an injected fetch. No test calls createKeyReader() or createLiveRequest() with no argument — the only form that
// selects the real key location and the real fetch. The refusal cases pass explicit incomplete options, expect the
// factory itself to throw, and never call anything a factory returned.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createKeyReader,KEY_MESSAGE} from '../local/credential.mjs';
import {createLiveRequest,ENV_KEY_MARKER} from '../local/server.mjs';
import {fileBudgetStorage} from '../local/budget-store.mjs';
import {verifyAccepted,check} from '../local/check.mjs';
import {BATTERY,called,sent,refused,harness} from './local-fixtures.mjs';

const APP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const KEY='sk-'+'T'.repeat(40); // key format only; not a credential
const temp=(t,prefix)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
// A synthetic key directory laid out like the real convention: <dir>/openai-api-key.
function keyDir(t,{dirMode=0o700,fileMode=0o600,content=KEY+'\n',link=false}={}){
 const base=temp(t,'ec-local-key-'),dir=path.join(base,'empire-code'),file=path.join(dir,'openai-api-key');
 fs.mkdirSync(dir,{mode:0o700});
 if(link){const real=path.join(base,'real-key');fs.writeFileSync(real,content,{mode:0o600});fs.symlinkSync(real,file);}
 else if(content!==null){fs.writeFileSync(file,content,{mode:0o600});fs.chmodSync(file,fileMode);}
 fs.chmodSync(dir,dirMode);
 return dir;
}
const keyFailure=dir=>e=>e.safe===true&&e.status===503&&e.code==='REQUEST_FAILED'&&e.message===KEY_MESSAGE&&e.message.length<300&&!e.message.includes(dir)&&!e.message.includes('sk-');
const upstreamAnswer=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});

test('key reader: the WORKSPACE-4 convention and hardening; reads only when called; errors carry no detail',t=>{
 const good=keyDir(t),read=createKeyReader({dir:good});
 assert.equal(read(),KEY);
 const bad=[keyDir(t,{fileMode:0o640}),keyDir(t,{fileMode:0o604}),keyDir(t,{dirMode:0o750}),keyDir(t,{dirMode:0o705}),keyDir(t,{link:true}),keyDir(t,{content:null}),
  keyDir(t,{content:'not-a-key-but-long-enough-000000'}),keyDir(t,{content:'sk-short'}),keyDir(t,{content:KEY+'x'.repeat(1100)}),path.join(good,'missing')];
 for(const[i,dir]of bad.entries())assert.throws(()=>createKeyReader({dir})(),keyFailure(dir),'case '+i);
 // Creating a reader touches nothing: a reader for a missing directory is created without an error.
 assert.equal(typeof createKeyReader({dir:path.join(good,'missing')}),'function');
});

test('local sources: one place names the key file, and no environment variable configures the runtime',()=>{
 const files=fs.readdirSync(path.join(APP,'local')).filter(name=>name.endsWith('.mjs'));
 assert.deepEqual(files.sort(),['budget-store.mjs','check.mjs','credential.mjs','run.mjs','server.mjs']);
 for(const name of files){
  const text=fs.readFileSync(path.join(APP,'local',name),'utf8');
  assert.equal(text.includes('process.env'),false,name);
  assert.equal(text.includes("'openai-api-key'"),name==='credential.mjs',name);
 }
});

test('live transport: nothing happens until a request; then one key read and one POST to the fixed endpoint, never retried',async t=>{
 const calls={key:0,fetch:[]};
 const read=createKeyReader({dir:keyDir(t)}),readKey=()=>{calls.key++;return read();};
 let answer=()=>upstreamAnswer({ok:true});
 const request=createLiveRequest({readKey,fetchImpl:async(url,init)=>{calls.fetch.push({url,init});return answer();}});
 assert.deepEqual([calls.key,calls.fetch.length],[0,0]);
 assert.deepEqual(await request('/responses',{json:{a:1}}),{ok:true});
 assert.deepEqual([calls.key,calls.fetch.length],[1,1]);
 const{url,init}=calls.fetch[0];
 assert.deepEqual([url,init.method,init.redirect,init.headers.Authorization,init.body],['https://api.openai.com/v1/responses','POST','manual','Bearer '+KEY,'{"a":1}']);
 answer=()=>new Response(JSON.stringify({error:{code:'rate_limit_exceeded'}}),{status:429,headers:{'content-type':'application/json'}});
 await assert.rejects(request('/responses',{json:{}}),e=>e.code==='API_RATE_LIMIT'&&e.safe===true);
 assert.equal(calls.fetch.length,2);
 // No key: no request at all.
 const missing=path.join(temp(t,'ec-local-nokey-'),'empire-code'),blind=createLiveRequest({readKey:createKeyReader({dir:missing}),fetchImpl:async()=>{calls.fetch.push('unexpected');return upstreamAnswer({});}});
 await assert.rejects(blind('/responses',{json:{}}),keyFailure(missing));
 assert.equal(calls.fetch.length,2);
 assert.throws(()=>createLiveRequest({readKey:null}));
});

test('dependency injection is all or nothing: partial, empty and invalid options are refused at creation, before any key reader, file system or network work',async t=>{
 // Tripwires for the length of this test (restored by node:test when it ends). The real key location can not even be
 // resolved and the real fetch can not be reached; both would be recorded. The two fs spies only count calls.
 const live=[];
 t.mock.method(os,'homedir',()=>{live.push('homedir');throw new Error('tripwire: the real key location was requested');});
 t.mock.method(globalThis,'fetch',async()=>{live.push('fetch');throw new Error('tripwire: the real network was requested');});
 const lstat=t.mock.method(fs,'lstatSync'),open=t.mock.method(fs,'openSync');
 const stub={key:0,fetch:[]},readKey=()=>{stub.key++;return KEY;},fetchImpl=async(url,init)=>{stub.fetch.push({url,init});return upstreamAnswer({ok:true});};
 const absent=path.join(os.tmpdir(),'ec-local-never-created-'+process.pid,'empire-code');

 // createLiveRequest: every argument list except "no argument at all" needs BOTH functions. Nothing returned is called.
 const incomplete=[
  [{fetchImpl}], // fetch only: must not be completed with the real key reader (the key would reach the stub)
  [{readKey}],   // key reader only: must not be completed with the real fetch
  [{}],[undefined],[null],
  [{readKey:undefined,fetchImpl:undefined}],[{readKey,fetchImpl:undefined}],[{readKey:undefined,fetchImpl}],
  [{readKey,fetchImpl:null}],[{readKey:null,fetchImpl}],[{readKey:KEY,fetchImpl}],[{readKey,fetchImpl:'fetch'}],[{readKey:{},fetchImpl}],[{readKey,fetchImpl:{}}],
  ['options'],[1],[true],[readKey],[[readKey,fetchImpl]],
  [{readKey,fetchImpl},{}],[undefined,{readKey,fetchImpl}]
 ];
 for(const[i,args]of incomplete.entries())assert.throws(()=>createLiveRequest(...args),/createLiveRequest needs readKey and fetchImpl/,'createLiveRequest case '+i);

 // createKeyReader: every argument list except "no argument at all" needs {dir: <non-empty absolute path>}. An absent
 // or undefined dir is refused, never replaced by the real location. Nothing returned is called.
 const noDirectory=[
  [{dir:undefined}],[{}],[undefined],[null],[{dir:null}],[{dir:''}],
  [{dir:'empire-code'}],[{dir:'./empire-code'}],[{dir:'~/.config/empire-code'}],
  [{dir:1}],[{dir:true}],[{dir:[absent]}],[{dir:Buffer.from(absent)}],[{dir:absent+'\0x'}],
  [absent],[{dir:absent},{}],[undefined,{dir:absent}]
 ];
 for(const[i,args]of noDirectory.entries())assert.throws(()=>createKeyReader(...args),/createKeyReader needs an explicit absolute directory/,'createKeyReader case '+i);

 // Every refusal happened at creation: no real location, no network, no file system call, and no stub was called.
 assert.deepEqual([live,stub,lstat.mock.callCount(),open.mock.callCount()],[[],{key:0,fetch:[]},0,0]);

 // Complete explicit dependencies still work. A reader of an explicit directory is created without touching anything
 // and, when called, looks at that directory only (never created here, so it fails safely).
 const read=createKeyReader({dir:absent});
 assert.deepEqual([typeof read,lstat.mock.callCount()],['function',0]);
 assert.throws(()=>read(),keyFailure(absent));
 assert.deepEqual([lstat.mock.calls.map(c=>c.arguments[0]),open.mock.callCount()],[[absent],0]);
 const request=createLiveRequest({readKey,fetchImpl});
 assert.deepEqual([stub.key,stub.fetch.length],[0,0]);
 assert.deepEqual(await request('/responses',{json:{a:1}}),{ok:true});
 assert.deepEqual([stub.key,stub.fetch.length,stub.fetch[0].url,stub.fetch[0].init.headers.Authorization],[1,1,'https://api.openai.com/v1/responses','Bearer '+KEY]);
 assert.deepEqual(live,[]);
});

test('server over the live wiring: start, static files, session and refused requests read no key; one accepted request reads it once',async t=>{
 const calls={key:0,fetch:[]},read=createKeyReader({dir:keyDir(t)});
 const request=createLiveRequest({readKey:()=>{calls.key++;return read();},fetchImpl:async(url,init)=>{calls.fetch.push({url,init});return upstreamAnswer(called(...BATTERY));}});
 const h=await harness(t,{request});
 assert.equal((await h.get('/')).status,200);assert.equal((await h.get('/workspace/mobile.html')).status,200);assert.equal((await h.get('/sw.js')).status,200);
 const{token,online}=await h.session();assert.equal(online,true);
 refused(await h.assist('a'.repeat(64),'request-0001'),403,'SESSION_TOKEN');
 refused(await h.post('/api/assist',token,'request-0001',sent('request-0002')),400,'ASSIST_REQUEST');
 assert.equal((await h.get('/',{'sec-fetch-site':'cross-site'})).status,403);
 assert.deepEqual([calls.key,calls.fetch.length],[0,0]);
 const r=await h.assist(token,'request-0001');
 assert.equal(r.status,200,r.body.toString());assert.ok(r.json().reply.includes('Około 20 h 24 min'));
 assert.deepEqual([calls.key,calls.fetch.length],[1,1]);
 const{url,init}=calls.fetch[0],body=JSON.parse(init.body);
 assert.deepEqual([url,init.headers.Authorization,body.model,body.store],['https://api.openai.com/v1/responses','Bearer '+KEY,'gpt-6-astra',false]);
 // The format-only marker the Worker's hasKey() sees is never a credential on the wire, and no key reaches the client.
 assert.ok(!JSON.stringify(calls.fetch[0]).includes(ENV_KEY_MARKER));assert.ok(!r.body.toString().includes(KEY));
});

test('server over the live wiring without a readable key: a safe text the frontend shows, no upstream request, the attempt counted once',async t=>{
 const fetched=[],missing=path.join(temp(t,'ec-local-nokey-'),'empire-code');
 const h=await harness(t,{request:createLiveRequest({readKey:createKeyReader({dir:missing}),fetchImpl:async(...a)=>{fetched.push(a);return upstreamAnswer({});}})});
 const s=await h.session();
 assert.deepEqual([s.online,s.remainingRequests],[true,60]); // like WORKSPACE-4: the key is not probed for a session
 const data=refused(await h.assist(s.token,'request-0001'),503,'REQUEST_FAILED');
 assert.equal(data.error,KEY_MESSAGE);
 assert.match(data.code,/^(?:REQUEST_FAILED)$/); // a code ui.js API_CODES knows and does not treat as budget-free
 assert.deepEqual([fetched.length,(await h.session()).remainingRequests],[0,59]);
});

test('budget file: the canonical per-UTC-day count, duplicate ids and nothing else survive a restart; a damaged file fails closed',async t=>{
 const file=path.join(temp(t,'ec-local-budget-'),'runtime','local-budget-v1.json');
 const first=await harness(t,{budgetStorage:fileBudgetStorage(file)}),a=await first.session();
 assert.equal(a.remainingRequests,60);
 assert.equal((await first.assist(a.token,'request-0001')).status,200);
 await first.stop();
 const text=fs.readFileSync(file,'utf8');
 assert.deepEqual(Object.keys(JSON.parse(text)),['budget:v1']);
 for(const secret of [a.token,'request-0001','Bateria','loopback'])assert.ok(!text.includes(secret),secret);
 assert.equal(fs.statSync(file).mode&0o077,0);
 const second=await harness(t,{budgetStorage:fileBudgetStorage(file)}),b=await second.session();
 assert.equal(b.remainingRequests,59);
 refused(await second.assist(b.token,'request-0001'),409,'DUPLICATE_REQUEST');
 assert.equal((await second.assist(a.token,'request-0002')).status,200); // a token of the hour stays valid across the restart
 assert.deepEqual([second.seen.upstream.length,(await second.session()).remainingRequests],[1,58]);
 await second.stop();
 fs.writeFileSync(file,'{broken');
 const third=await harness(t,{budgetStorage:fileBudgetStorage(file)}),c=await third.session();
 assert.deepEqual([c.online,c.token,c.remainingRequests,c.reason],[false,null,0,'BUDGET_UNAVAILABLE']);
 assert.equal(fs.readFileSync(file,'utf8'),'{broken'); // never repaired or overwritten silently
 assert.throws(()=>fileBudgetStorage('relative.json'));
});

test('--check: sources, build, generated files, release record and served bytes agree; no provider is contacted',async()=>{
 const release=JSON.parse(fs.readFileSync(path.join(APP,'RELEASE.json'),'utf8')),accepted=verifyAccepted();
 assert.deepEqual([accepted.build,accepted.pin,accepted.served.length],['PRIVATE-PILOT-7',release.browserShellPin,21]);
 const report=await check();
 assert.deepEqual(report,{build:'PRIVATE-PILOT-7',pin:release.browserShellPin,paths:21,model:'gpt-6-astra',speechModel:'gpt-transcribe'});
});
