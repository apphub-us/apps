// Local runtime — storage for the canonical PilotBudget (candidate/server/budget.mjs), which is used unchanged.
// PilotBudget needs storage.transaction(fn) with txn.get / txn.put, and serialises its own transactions. What it stores
// is its single bounded record: hashes, counters and expiry times — no key, token, request id, text or audio.
// This is not a database of Jobs or conversations; those stay in the browser.
import fs from 'node:fs';
import path from 'node:path';

// Lives and dies with the process. Used by --check and by tests.
export function memoryBudgetStorage(){
 let data=new Map();
 return{async transaction(fn){
  const next=new Map(data);
  const out=await fn({get:async k=>next.has(k)?structuredClone(next.get(k)):undefined,put:async(k,v)=>{next.set(k,structuredClone(v));}});
  data=next;return out;
 }};
}

// One small JSON file, so the 60-per-UTC-day count survives a restart exactly as the accepted frontend describes it.
// Each committed transaction replaces the file atomically (temporary file, then rename). A missing file is an empty
// store. An unreadable or malformed file is an error: PilotBudget then answers BUDGET_STATE and the runtime offers no
// online conversation (fail closed) until the file is removed by a person.
export function fileBudgetStorage(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('fileBudgetStorage needs an absolute path');
 const read=()=>{
  let text;try{text=fs.readFileSync(file,'utf8');}catch(e){if(e&&e.code==='ENOENT')return{};throw e;}
  const value=JSON.parse(text);
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('budget file');
  return value;
 };
 return{async transaction(fn){
  const data=read();let dirty=false;
  const out=await fn({get:async k=>Object.hasOwn(data,k)?structuredClone(data[k]):undefined,put:async(k,v)=>{data[k]=structuredClone(v);dirty=true;}});
  if(dirty){
   fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
   const tmp=file+'.tmp';
   fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});
   fs.renameSync(tmp,file);
  }
  return out;
 }};
}
