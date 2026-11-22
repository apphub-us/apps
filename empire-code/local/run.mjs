#!/usr/bin/env node
// Empire Code — LOCAL-WORKSPACE-7 launcher. User-invoked; foreground; one fixed address: http://127.0.0.1:12350/
//   node local/run.mjs            verify, then serve until Control-C / SIGTERM
//   node local/run.mjs --open     the same, then open the address with /usr/bin/open
//   node local/run.mjs --check    verify the accepted browser manifest and the served bytes; no key, no AI, then exit
//   node local/run.mjs --status   say what answers on the port; changes nothing
// Start reads no key and makes no provider request: the key file is read only for an AI / transcription request the
// user sends from the app. This program never looks for, signals or stops another process, and never falls back to
// another port: when the port is taken it says so and exits.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';

const KNOWN=['--open','--check','--dry-run','--status'];
const args=process.argv.slice(2);

// What answers on the port, by one HEAD / (no session is minted, no budget is touched).
function probe(url){
 return new Promise(resolve=>{
  const r=http.request(url,{method:'HEAD',timeout:2000},res=>{res.resume();resolve({answered:true,runtime:res.headers['x-empire-local-runtime']||null,build:res.headers['x-empire-build']||null});});
  r.on('timeout',()=>r.destroy());
  r.on('error',()=>resolve({answered:false,runtime:null,build:null}));
  r.end();
 });
}
// Same rule as the WORKSPACE-4 launcher, so the app opens in the browser that already holds its data. Only the
// application bundle's existence is tested; no browser profile is read and no browser is automated.
function open(url){
 const target=fs.existsSync('/Applications/Brave Browser.app')?['-a','Brave Browser',url]:[url];
 spawn('/usr/bin/open',target,{stdio:'ignore'}).on('error',()=>console.log('Otwórz: '+url));
}

async function main(){
 for(const a of args)if(!KNOWN.includes(a))throw new Error('Nieznany argument: '+a+' (dozwolone: '+KNOWN.join(', ')+')');
 if(Number(process.versions.node.split('.')[0])<22)throw new Error('Wymagany Node.js 22 lub nowszy (jest '+process.versions.node+').');
 const{createLocalServer,createLiveRequest,LOCAL_RUNTIME,DEFAULT_PORT}=await import('./server.mjs');
 const{check,APP}=await import('./check.mjs');
 const{fileBudgetStorage}=await import('./budget-store.mjs');
 const url='http://127.0.0.1:'+DEFAULT_PORT+'/';

 if(args.includes('--status')){
  const p=await probe(url);
  console.log(!p.answered?'Nic nie odpowiada na '+url:p.runtime===LOCAL_RUNTIME?LOCAL_RUNTIME+' ('+p.build+') działa: '+url:'Na '+url+' odpowiada inna wersja (nie '+LOCAL_RUNTIME+').');
  return;
 }
 const report=await check();
 console.log('PLIKI: OK — '+report.paths+' ścieżek · '+report.build+' · pin '+report.pin.slice(0,16)+'… · bez odczytu klucza i bez API.');
 if(args.includes('--check')||args.includes('--dry-run'))return;

 const existing=await probe(url);
 if(existing.answered){
  if(existing.runtime!==LOCAL_RUNTIME)throw new Error('Na porcie '+DEFAULT_PORT+' działa inna wersja (np. WORKSPACE-4). Nie zatrzymano jej i niczego nie uruchomiono.');
  console.log('EMPIRE CODE '+LOCAL_RUNTIME+' już działa: '+url);
  if(args.includes('--open'))open(url);
  return;
 }
 // Counters and hashes of the canonical budget only; /runtime/ is already excluded by .gitignore.
 const local=createLocalServer({request:createLiveRequest(),budgetStorage:fileBudgetStorage(path.join(APP,'runtime','local-budget-v1.json'))});
 try{await local.start(DEFAULT_PORT);}
 catch(e){throw new Error(e&&e.code==='EADDRINUSE'?'Port '+DEFAULT_PORT+' jest zajęty. Niczego nie zatrzymano i nie użyto innego portu.':'Serwer nie może się uruchomić na 127.0.0.1:'+DEFAULT_PORT+'.');}
 console.log('EMPIRE CODE '+LOCAL_RUNTIME+' · '+report.build+': '+url);
 console.log('Rozmowa ('+report.model+') i głos ('+report.speechModel+') online przez klucz zapisany na tym Macu; roboty i narzędzia lokalnie.');
 console.log('Start nie odczytał klucza i nie wykonał płatnego zapytania. Limit: 60 prób AI/transkrypcji na dobę UTC, bez automatycznego ponawiania.');
 console.log('To lokalne uruchomienie bez logowania Cloudflare — nie jest sesją chmurową. Dane przeglądarki nie są kopiowane ani zmieniane przez serwer.');
 console.log('Pozostaw to okno otwarte. Zatrzymanie: Control-C (PID '+process.pid+').');
 let stopping=false;
 const stop=()=>{if(stopping)return;stopping=true;local.stop().finally(()=>process.exit(0));};
 for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,stop);
 if(args.includes('--open'))open(url);
}
main().catch(e=>{console.error('STOP — '+(e&&e.message?e.message:e));process.exitCode=1;});
