// Test-only Node adapter of the unchanged Workers fetch handler. No credentials or external API.
'use strict';
const http=require('node:http'),{Readable}=require('node:stream'),{pathToFileURL}=require('node:url');
exports.start=async function(root){
 const {default:worker}=await import(pathToFileURL(root+'/candidate/server/worker.mjs').href);
 let origin,mock=null;
 const server=http.createServer(async(req,res)=>{try{
  const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
  const init={method:req.method,headers};if(!['GET','HEAD'].includes(req.method)){init.body=Readable.toWeb(req);init.duplex='half';}
  const request=new Request(origin+req.url,init);
  // Explicit fixture identity, confined to this local test adapter; absent key, no API, no durable budget.
  const mocked=mock?await mock(request):null;
  const response=mocked||await worker.fetch(request,{EC_ALLOWED_EMAIL:'owner@example.invalid',EC_ORIGIN:origin},{access:{getIdentity:async()=>({email:'owner@example.invalid'})}});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500,{'content-type':'text/plain'});res.end('Local test adapter failed');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 return{origin,setMock:fn=>{mock=fn;},stop:()=>new Promise(r=>{server.close(r);server.closeAllConnections();})};
};
