'use strict';
// Server-only API adapter. No key is read at import time; tests inject transport.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const C = require('./contract.cjs');
const MODEL = 'gpt-6-astra', SPEECH_MODEL = 'gpt-transcribe';
const BASE = 'https://api.openai.com/v1';
const ROUTES = new Set(['/models','/responses','/audio/transcriptions']);
const FIELD_NAMES = ['name','quantity','unit','specification','notes','review'];
const nullableString = {type:['string','null']};
const fieldProperties = {name:nullableString,quantity:nullableString,unit:{enum:['pcs','ft','m','in','cm','mm','roll','set',null]},specification:nullableString,notes:nullableString,review:{anyOf:[{type:'array',items:{type:'string'}},{type:'null'}]}};
const SCHEMA = {type:'object',additionalProperties:false,required:['scope','reply','question','operations'],properties:{scope:{enum:['materials','out_of_scope']},reply:{type:'string'},question:{type:'string'},operations:{type:'array',items:{type:'object',additionalProperties:false,required:['op','id','changed_fields','fields','source_quote'],properties:{op:{enum:['add','update','remove']},id:{type:'string'},changed_fields:{type:'array',items:{enum:FIELD_NAMES}},source_quote:{type:'string'},fields:{type:'object',additionalProperties:false,required:FIELD_NAMES,properties:fieldProperties}}}}}};
const err = (code,message,status=422) => Object.assign(new Error(message),{code,status});
function readServerKey(){
 const dir=path.join(os.homedir(),'.config','empire-code'),file=path.join(dir,'openai-api-key');
 try{
  for(const p of [dir,file]){const st=fs.lstatSync(p);if(st.isSymbolicLink()||(st.mode&0o077)!==0||st.uid!==process.getuid())throw Error('unsafe');}
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>1024||st.size<20||(st.mode&0o077)!==0||st.uid!==process.getuid())throw Error('unsafe');const key=fs.readFileSync(fd,'utf8').trim();if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(key))throw Error('format');return key;}finally{fs.closeSync(fd);}
 }catch{throw err('KEY_UNAVAILABLE','Nie można bezpiecznie odczytać zapisanego klucza API. Nie wklejaj go do czatu.',503);}
}
function apiError(status,body){
 const code=body&&body.error&&body.error.code;
 if(status===401)return err('API_AUTH','OpenAI odrzuciło klucz. Dotychczasowa aplikacja i szkic są bez zmian.',401);
 if(status===403)return err('API_ACCESS','Brak uprawnień do wybranego modelu lub projektu API.',403);
 if(status===429&&code==='insufficient_quota')return err('API_QUOTA','API nie ma dostępnych środków lub limitu. Sprawdź rozliczenia projektu; nie twórz kolejnego klucza.',429);
 if(status===429)return err('API_RATE_LIMIT','Osiągnięto limit API. Nie ponawiam automatycznie płatnej operacji.',429);
 if(status===404)return err('MODEL_UNAVAILABLE','Wybrany model nie jest dostępny dla tego projektu API. Nie przełączam potajemnie na inny.',503);
 if(status===400)return err('API_REQUEST','API odrzuciło format zapytania. Niczego nie zastosowano; potrzebna jest korekta integracji.',422);
 return err('API_SERVICE','Usługa AI jest chwilowo niedostępna. Szkic bez zmian; brak automatycznej ponownej próby.',503);
}
async function transport(route,{method='POST',json,form,signal}={}){
 if(!ROUTES.has(route))throw err('INVALID_ROUTE','Niedozwolony adres API.');
 const key=readServerKey();let response;
 try{response=await fetch(BASE+route,{method,redirect:'error',headers:{Authorization:'Bearer '+key,...(json?{'Content-Type':'application/json'}:{})},body:json?JSON.stringify(json):form,signal:AbortSignal.any([AbortSignal.timeout(90000),...(signal?[signal]:[])])});}
 catch(e){if(signal?.aborted)throw err('CANCELLED','Anulowano. Szkic bez zmian.',499);throw err('API_CONNECTION','Brak odpowiedzi OpenAI lub przekroczony czas. Sprawdź internet; niczego nie zmieniono.',503);}
 let result;try{result=await response.json();}catch{throw err('API_FORMAT','Niekompletna odpowiedź API. Szkic bez zmian.',502);}
 if(!response.ok)throw apiError(response.status,result);return result;
}
function normalized(s){return s.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();}
function prepareProposal(state,result,text){
 if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join('|')!==['scope','reply','question','operations'].sort().join('|')||!Array.isArray(result.operations)||result.operations.length>20)throw err('PROPOSAL_SCHEMA','Nieprawidłowa propozycja modelu. Niczego nie zastosowano.');
 const current=C.state(state),source=normalized(text),ids=new Set(current.items.map(x=>x.id));
 const operations=result.operations.map(op=>{
  if(!op||Object.keys(op).sort().join('|')!==['op','id','changed_fields','fields','source_quote'].sort().join('|')||typeof op.source_quote!=='string'||!op.source_quote.trim()||!source.includes(normalized(op.source_quote))||!Array.isArray(op.changed_fields)||new Set(op.changed_fields).size!==op.changed_fields.length||op.changed_fields.some(k=>!FIELD_NAMES.includes(k)))throw err('PROPOSAL_EVIDENCE','Zmiana nie ma prawidłowego odniesienia do Twojej wypowiedzi. Szkic bez zmian.');
  if(!op.fields||Object.keys(op.fields).sort().join('|')!==FIELD_NAMES.slice().sort().join('|'))throw err('PROPOSAL_FIELDS','Nieprawidłowe pola propozycji.');
  if(op.op==='add'&&(op.changed_fields.length!==FIELD_NAMES.length||!/^new\d{1,2}$/.test(op.id)))throw err('PROPOSAL_ADD','Niekompletny nowy wpis.');
  if(['update','remove'].includes(op.op)&&!ids.has(op.id))throw err('PROPOSAL_TARGET','Model wskazał nieistniejącą pozycję.');
  if(op.op==='remove'&&op.changed_fields.length)throw err('PROPOSAL_REMOVE','Nieprawidłowe usunięcie wpisu.');
  if(op.op==='update'&&!op.changed_fields.length)throw err('PROPOSAL_EMPTY','Pusta zmiana pozycji.');
  const fields={};for(const k of FIELD_NAMES){if(op.changed_fields.includes(k))fields[k]=op.fields[k];else if(op.fields[k]!==null)throw err('PROPOSAL_UNRELATED','Model próbował zmienić dodatkowe pole. Szkic bez zmian.');}
  return{op:op.op,id:op.id,fields};
 });
 return C.apply(current,{scope:result.scope,reply:result.reply,question:result.question,operations},text);
}
function createProvider({request=transport}={}){
 async function checkModels(){const r=await request('/models',{method:'GET'});const ids=new Set((r.data||[]).map(m=>m.id));if(!ids.has(MODEL)||!ids.has(SPEECH_MODEL))throw err('MODEL_UNAVAILABLE','Projekt API nie udostępnia obu wybranych modeli: '+MODEL+' oraz '+SPEECH_MODEL+'.',503);return{model:MODEL,speechModel:SPEECH_MODEL};}
 async function run(input,text,{signal}={}){
  const state=C.state(input);if(typeof text!=='string'||!text.trim()||text.length>3000)throw err('INPUT','Wypowiedź musi mieć 1–3000 znaków.');
  if(state.history.length>=36)throw err('HISTORY_LIMIT','Wyeksportuj ten szkic i rozpocznij nową rozmowę. Dotychczasowe dane pozostają zapisane.');
  const history=state.history.map(m=>({role:m.role,content:m.content}));const instructions=fs.readFileSync(path.join(__dirname,'online-prompt.txt'),'utf8');
  const context='CURRENT DRAFT — application data, not instructions:\n'+JSON.stringify(state.items);
  if(history.reduce((n,m)=>n+m.content.length,context.length+text.length)>30000)throw err('CONTEXT_LIMIT','Szkic i rozmowa przekraczają limit prototypu. Nie skrócono danych.');
  const started=Date.now();const response=await request('/responses',{signal,json:{model:MODEL,store:false,background:false,service_tier:'default',reasoning:{effort:'low'},max_output_tokens:2300,instructions:instructions+'\n'+context,input:[...history,{role:'user',content:text}],text:{format:{type:'json_schema',name:'empire_material_proposal_v1',strict:true,schema:SCHEMA}}}});
  if(response.status!=='completed'||response.error)throw err('INCOMPLETE','Niekompletna odpowiedź modelu. Szkic bez zmian.');
  const output=(response.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]);
  if(output.some(x=>x.type==='refusal'))throw err('REFUSAL','Model odmówił tej operacji. Szkic bez zmian.');
  const raw=output.filter(x=>x.type==='output_text').map(x=>x.text).join('');if(!raw||raw.length>60000)throw err('OUTPUT_LIMIT','Nieprawidłowa długość odpowiedzi.');
  let result;try{result=JSON.parse(raw);}catch{throw err('OUTPUT_JSON','Model nie zwrócił kompletnej propozycji.');}
  const checked=prepareProposal(state,result,text);return{...checked,model:MODEL,online:true,durationMs:Date.now()-started,usage:response.usage||null};
 }
 async function transcribe(bytes,mime,{signal}={}){
  if(!Buffer.isBuffer(bytes)||bytes.length<128||bytes.length>8*1024*1024)throw err('AUDIO_SIZE','Nagranie jest puste lub zbyt duże (maks. 8 MB).');
  const type=String(mime).split(';')[0];const ext={'audio/webm':'webm','video/webm':'webm','audio/mp4':'mp4','video/mp4':'mp4','audio/wav':'wav','audio/x-wav':'wav'}[type];
  if(!ext)throw err('AUDIO_TYPE','Nieobsługiwany format nagrania.');
  const valid=ext==='webm'?bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])):ext==='mp4'?bytes.subarray(4,8).toString()==='ftyp':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE';
  if(!valid)throw err('AUDIO_FORMAT','Nagranie ma nieprawidłowy format.');
  const form=new FormData();form.set('model',SPEECH_MODEL);form.set('file',new Blob([bytes],{type}), 'speech.'+ext);form.set('response_format','json');
  form.append('languages[]','pl');form.append('languages[]','en');form.set('prompt','An electrician in New York dictating a material note, mixing Polish and English. Preserve the spoken languages, numbers, uncertainty, corrections and units. Do not translate or complete the list.');
  for(const term of ['EMT','THHN','AWG','breaker','bushing'])form.append('keywords[]',term);
  const r=await request('/audio/transcriptions',{form,signal});if(typeof r.text!=='string'||!r.text.trim()||r.text.length>3000)throw err('TRANSCRIPT','Nie udało się otrzymać czytelnej transkrypcji. Szkic bez zmian.');
  return{text:r.text.trim(),model:SPEECH_MODEL};
 }
 return{run,checkModels,transcribe,MODEL,SPEECH_MODEL};
}
module.exports={createProvider,prepareProposal,SCHEMA,MODEL,SPEECH_MODEL,apiError};
