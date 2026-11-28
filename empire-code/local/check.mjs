// Local runtime — verification of what would be served. No credential, no provider, no external network.
//   verifyAccepted()  browser sources → canonical build (candidate/build.cjs compute(): whitelist, pins, wiring)
//                     → committed generated files → the accepted release record (RELEASE.json build + browserShellPin)
//   verifyServed()    starts the real local server on an ephemeral loopback port with an inert provider transport and
//                     compares every served path, byte for byte, with the accepted manifest; then reads /api/session
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createLocalServer,LOCAL_RUNTIME} from './server.mjs';

const require=createRequire(import.meta.url);
export const APP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const refuse=message=>Object.assign(new Error(message),{code:'EC_LOCAL_CHECK'});

export function verifyAccepted(){
 const build=require('../candidate/build.cjs'),computed=build.compute({root:APP});
 const text=rel=>fs.readFileSync(path.join(APP,...rel.split('/')),'utf8');
 if(text(build.OUT.manifest)!==computed.manifestJson)throw refuse('The saved manifest (candidate/build-manifest.generated.json) does not match the candidate/browser files.');
 if(text(build.OUT.assets)!==computed.assetsModule)throw refuse('The saved assets (candidate/server/assets.generated.mjs) do not match the candidate/browser files.');
 if(text(build.OUT.prompt)!==computed.promptModule)throw refuse('The saved prompt (candidate/server/prompt.generated.mjs) does not match input/online-prompt.txt.');
 const release=JSON.parse(text('RELEASE.json'));
 if(release.build!==computed.build||release.browserShellPin!==computed.pin)throw refuse('The browser files are not the accepted release from RELEASE.json (build or shell pin).');
 return{build:computed.build,pin:computed.pin,served:computed.manifest.served};
}

export function get(url,headers={}){
 return new Promise((resolve,reject)=>{
  http.get(url,{headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);}).on('error',reject);
 });
}

export async function verifyServed(accepted){
 let upstream=0;
 const local=createLocalServer({request:async()=>{upstream++;throw new Error('check mode has no provider');}});
 const origin=await local.start(0);
 try{
  for(const entry of accepted.served){
   const r=await get(origin+entry.url);
   const ok=r.status===200&&r.body.length===entry.bytes&&sha256(r.body)===entry.sha256&&r.headers['x-empire-asset-sha256']===entry.sha256&&r.headers['content-type']===entry.mime
    &&r.headers['x-empire-build']===accepted.build&&r.headers['x-empire-local-runtime']===LOCAL_RUNTIME&&r.headers['cache-control']==='no-store';
   if(!ok)throw refuse('A served file differs from the accepted manifest: '+entry.url);
  }
  const s=await get(origin+'/api/session',{'sec-fetch-site':'same-origin'});
  let session=null;try{session=JSON.parse(s.body.toString('utf8'));}catch{}
  if(s.status!==200||!session||session.build!==accepted.build||session.online!==true||typeof session.token!=='string'||!/^[0-9a-f]{64}$/.test(session.token)||!Number.isInteger(session.remainingRequests))throw refuse('Invalid /api/session response from the local server.');
  if(upstream!==0)throw refuse('The check touched the AI provider — that is an error.');
  return{paths:accepted.served.length,model:session.model,speechModel:session.speechModel};
 }finally{await local.stop();}
}

export async function check(){
 const accepted=verifyAccepted(),served=await verifyServed(accepted);
 return{build:accepted.build,pin:accepted.pin,...served};
}
