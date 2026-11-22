// Stage 5 — server-only provider of POST /api/assist: ONE Responses request with strict function tools, then the
// deterministic boundary in assistant-contract.cjs. Nothing is read or fetched at import time. It reuses the existing
// model, transport (fixed endpoint, 90 s timeout + caller signal, no retry, no redirect; upstream failures become the
// existing safe apiError texts) of cloud-provider.mjs, and that module's material SCHEMA / prepareProposal as they are
// at run time.
import A from './assistant-contract.cjs';
import {MODEL,SCHEMA,createTransport,hasKey,prepareProposal} from './cloud-provider.mjs';
import {ASSISTANT_PROMPT} from './assistant-prompt.mjs';

const NOT_CONFIGURED='Rozmowa AI nie jest jeszcze skonfigurowana na serwerze. Szkic bez zmian.';
const MAX_OUTPUT_TOKENS=2300;
const err=(code,message,status=422)=>Object.assign(new Error(message),{code,status,safe:true});

// Programmatic construction only: `request` is the transport (tests pass a synthetic one), `prompt` the instructions.
// checkAssist is the complete local validation, exposed so the Worker runs it before reserving budget; assist accepts
// only what checkAssist returned.
export function createAssistantProvider({request,prompt}={}){
 if(typeof request!=='function'||typeof prompt!=='string'||!prompt.trim())throw err('AI_NOT_CONFIGURED',NOT_CONFIGURED,503);
 const checkAssist=input=>A.request(input);
 async function assist(checked,{signal}={}){
  if(!A.isChecked(checked))throw err('ASSIST_REQUEST','Nieprawidłowe zapytanie asystenta. Niczego nie wysłano.',400);
  const started=Date.now();
  const response=await request('/responses',{signal,json:{model:MODEL,store:false,background:false,service_tier:'default',reasoning:{effort:'low'},max_output_tokens:MAX_OUTPUT_TOKENS,
   instructions:prompt+'\n'+checked.context,input:[...checked.history,{role:'user',content:checked.text}],tools:A.tools(SCHEMA),tool_choice:'required',parallel_tool_calls:false}});
  const outcome=A.dispatch(checked,A.readCall(response),{prepareProposal});
  return{protocol:A.PROTOCOL,version:A.VERSION,baseRevision:checked.state.revision,
   base:{materialRevision:checked.state.revision,fingerprint:checked.baseFingerprint,contextToken:checked.contextToken},
   ...outcome,model:MODEL,online:true,durationMs:Date.now()-started,usage:response&&response.usage?response.usage:null};
 }
 return{checkAssist,assist,MODEL};
}
// Production construction: only env.OPENAI_API_KEY (the existing key), the static prompt and the platform fetch.
// No flags, no overrides; createTransport re-checks the key format and never logs or returns it.
export async function createCloudAssistantProvider(env){
 if(!hasKey(env))throw err('AI_NOT_CONFIGURED',NOT_CONFIGURED,503);
 return createAssistantProvider({request:createTransport({apiKey:env.OPENAI_API_KEY.trim(),fetchImpl:(input,init)=>fetch(input,init)}),prompt:ASSISTANT_PROMPT});
}
