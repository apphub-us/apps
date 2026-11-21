import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../candidate/server/worker.mjs';
import {ASSETS} from '../candidate/server/assets.generated.mjs';
const origin='https://pilot.example.invalid';
const good=()=>({access:{aud:'synthetic-audience',getIdentity:async()=>({email:'owner@example.invalid'})}});
const req=(path,method='GET',headers={})=>new Request(origin+path,{method,headers,...(['POST','PUT','PATCH'].includes(method)?{body:'{}'}:{})});
function environment(){let keyReads=0,budgetReads=0;const env={EC_ORIGIN:origin,EC_ALLOWED_EMAIL:'owner@example.invalid'};Object.defineProperty(env,'OPENAI_API_KEY',{get(){keyReads++;return '';}});Object.defineProperty(env,'PILOT_BUDGET',{get(){budgetReads++;throw Error('Storage must not run for unauthenticated/static/unconfigured requests');}});return{env,reads:()=>({keyReads,budgetReads})};}
test('independent: fabricated access headers never replace the authenticated platform context',async()=>{
 const {env,reads}=environment();const headers={'cf-access-jwt-assertion':'synthetic.invalid.signature','cf-access-authenticated-user-email':'owner@example.invalid',authorization:'Bearer fake',cookie:'CF_Authorization=fake',origin};
 for(const method of ['GET','HEAD','POST','OPTIONS'])for(const path of ['/','/index.html','/ui.js','/api/session','/api/talk','/workspace/mobile.html']){const r=await worker.fetch(req(path,method,headers),env,{});assert.equal(r.status,403,method+' '+path);const b=await r.text();assert.ok(!b.includes('owner@example.invalid')&&!b.includes('EMPIRE CODE'));assert.match(r.headers.get('cache-control'),/no-store/);if(method==='HEAD')assert.equal(b,'');}
 assert.deepEqual(reads(),{keyReads:0,budgetReads:0});
});
test('independent: wrong, missing and failing identity are denied before secret or storage access',async()=>{
 for(const access of [undefined,{}, {getIdentity:async()=>null},{getIdentity:async()=>({email:'someone@example.invalid'})},{getIdentity:async()=>({email:'owner@example.invalid.evil'})},{getIdentity:async()=>{throw Error('Synthetic identity failure');}}]){const {env,reads}=environment();const r=await worker.fetch(req('/api/session'),env,{access});assert.equal(r.status,403);assert.deepEqual(reads(),{keyReads:0,budgetReads:0});}
});
test('independent: every allowlisted static file is exact and tagged, without touching the API key or budget',async()=>{
 const {env,reads}=environment();for(const [url,a] of Object.entries(ASSETS)){const r=await worker.fetch(req(url),env,good());assert.equal(r.status,200,url);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256,url);assert.equal(r.headers.get('X-Empire-Asset-Sha256'),a.sha256,url);assert.deepEqual(bytes,Buffer.from(a.base64,'base64'),url);assert.ok(r.headers.get('content-security-policy'),url);const head=await worker.fetch(req(url,'HEAD'),env,good());assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);}
 assert.deepEqual(reads(),{keyReads:0,budgetReads:0});
});
test('independent: unknown server/credential paths cannot be served to an authenticated owner either',async()=>{
 const {env}=environment();for(const path of ['/.env','/worker.mjs','/server.cjs','/openai-provider.cjs','/online-prompt.txt','/RELEASE.json','/assets.generated.mjs']){const r=await worker.fetch(req(path),env,good());assert.equal(r.status,404,path);assert.ok(!(await r.text()).includes('OPENAI_API_KEY'));}
});
test('independent: unconfigured API is explicitly disabled and cannot consume a budget or contact an upstream',async()=>{
 const {env,reads}=environment();const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No real network allowed');};try{const r=await worker.fetch(req('/api/session'),env,good());assert.equal(r.status,200);const v=await r.json();assert.equal(v.online,false);assert.equal(v.token,null);assert.equal(v.reason,'AI_NOT_CONFIGURED');for(const path of ['/api/talk','/api/transcribe']){const q=await worker.fetch(req(path,'POST',{'content-type':'application/json',origin,'x-ec-request-id':'synthetic-id-1','x-ec-token':'fake'}),env,good());assert.equal(q.status,503,path);}assert.equal(calls,0);assert.equal(reads().budgetReads,0);}finally{globalThis.fetch=oldFetch;}
});
test('independent: host and cross-site write boundaries remain enforced even for authenticated identity',async()=>{
 const {env}=environment();const foreignHost=new Request('https://elsewhere.invalid/api/session');assert.equal((await worker.fetch(foreignHost,env,good())).status,403);for(const headers of [{origin:'https://attacker.invalid'},{origin,'sec-fetch-site':'cross-site'}])assert.equal((await worker.fetch(req('/api/talk','POST',headers),env,good())).status,403);
});
test('independent: explicit reauthentication navigation does not erase data and cannot redirect offsite',async()=>{
 const {env,reads}=environment();const r=await worker.fetch(req('/_auth?return=https://attacker.invalid/'),env,good());assert.equal(r.status,303);const location=new URL(r.headers.get('location'),origin);assert.equal(location.origin,origin);assert.equal(location.pathname,'/');assert.match(r.headers.get('cache-control'),/no-store/);assert.deepEqual(reads(),{keyReads:0,budgetReads:0});
});
