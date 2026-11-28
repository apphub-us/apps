'use strict';
// Boundary for model proposals. No language parsing, electrical inference or writes.
const crypto=require('node:crypto');
// EC-08: units and the whole-count rule are the ONE shared definition that Jobs and the conversation handoff use
// (core/src/jobs/materialQuantity.js: pure, no dependencies). This file keeps no unit list of its own.
const Q=require('../../core/src/jobs/materialQuantity.js');
const ITEM_FIELDS=['name','quantity','unit','specification','notes','review'];
const units=Q.draftUnitEnum();
const object=(v)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k));
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=message=>{throw Error(message);};
// A refusal the user can act on. `safe` marks the only error texts the Worker may show to the client; the code matches
// the client's PROPOSAL_* allow-list and the message stays under its 300-character limit.
const QUANTITY_CODE='PROPOSAL_QUANTITY';
const QUANTITY_MESSAGE='Pieces, boxes, packs, rolls and sets (pcs, box, pack, roll, set) need a whole number; a fraction is allowed only for lengths (ft, in, m, cm, mm). Give a whole quantity or a length. Nothing was rounded; the draft is unchanged.';
const quantityFail=()=>{throw Object.assign(Error(QUANTITY_MESSAGE),{code:QUANTITY_CODE,status:422,safe:true});};
function string(value,max,empty=true){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('Invalid bounded string');return value;}
// READ shape of item fields (complete or partial). A fractional count (0.5 roll) is READABLE: drafts saved before EC-08
// may hold one and must stay loadable exactly as stored. Whether a value may be WRITTEN is decided by writable().
function readable(value,partial=false){
 if(!keys(value,ITEM_FIELDS)||(!partial&&ITEM_FIELDS.some(k=>!Object.hasOwn(value,k))))fail('Invalid item fields');
 for(const[k,v]of Object.entries(value)){
  if(k==='quantity'){if(v!==null&&!Q.isDraftQuantity(v))fail('Invalid quantity');}
  else if(k==='unit'){if(v!==null&&!Q.isUnit(v))fail('Invalid unit');}
  else if(k==='review'){if(!Array.isArray(v)||v.length>8)fail('Invalid review list');v.forEach(s=>string(s,220,false));}
  else string(v,k==='name'?120:k==='notes'?600:500,k!=='name');
 }
 return clone(value);
}
// WRITE rule for a COMPLETE item (a new one, or an update merged over its target): the shared whole-count rule for every
// count unit. An unknown quantity or unit stays allowed — such an item remains in review, it is not an error.
function writable(value){const item=readable(value);if(!Q.inspectDraft(item.quantity,item.unit).writeValid)quantityFail();return item;}
// Public validator for values about to be written. A partial set is shape-checked only; its quantity + unit can be
// judged only after merging with the target, which apply() does.
function fields(value,partial=false){return partial?readable(value,true):writable(value);}
function empty(){return{version:1,revision:0,nextId:1,items:[],history:[]};}
// READ: accepts every well-formed stored conversation, including items that now need a quantity correction.
// Returns an exact copy — nothing is rounded, dropped or rewritten. corrections() lists what must be corrected.
function state(input){
 if(!keys(input,['version','revision','nextId','items','history'])||input.version!==1||!Number.isInteger(input.revision)||input.revision<0||input.revision>100||!Number.isInteger(input.nextId)||input.nextId<1||input.nextId>1000)fail('Invalid conversation state');
 if(!Array.isArray(input.items)||input.items.length>16||!Array.isArray(input.history)||input.history.length>40)fail('Conversation limit exceeded');
 const ids=new Set();for(const item of input.items){if(!keys(item,['id',...ITEM_FIELDS])||!/^i[0-9]{4}$/.test(item.id)||ids.has(item.id))fail('Invalid/duplicate item ID');ids.add(item.id);const{id,...rest}=item;readable(rest);}
 for(const m of input.history){if(!keys(m,['role','content'])||!['user','assistant'].includes(m.role))fail('Invalid conversation message');string(m.content,5000,false);}
 if(input.items.some(i=>Number(i.id.slice(1))>=input.nextId))fail('Invalid next identity');
 if(Buffer.byteLength(JSON.stringify(input),'utf8')>50000)fail('Conversation is too large; export it and start a new draft');return clone(input);
}
// Items of a readable state that cannot be written or handed to Jobs until corrected. Derived on demand, never stored,
// so the saved v1 state shape is unchanged.
function corrections(input){
 return state(input).items.filter(i=>Q.inspectDraft(i.quantity,i.unit).correctionRequired).map(i=>({id:i.id,code:Q.WHOLE_COUNT_CODE,quantity:i.quantity,unit:i.unit}));
}
function apply(input,result,userText){
 const current=state(input);string(userText,3000,false);
 if(!keys(result,['reply','question','operations','scope'])||!['materials','out_of_scope'].includes(result.scope))fail('Invalid model response');
 string(result.reply,1000);string(result.question,400);
 if(!Array.isArray(result.operations)||result.operations.length>20)fail('Invalid operation list');
 if(result.scope==='out_of_scope'&&result.operations.length)fail('Out-of-scope response cannot modify a list');
 const next=clone(current),diffs=[],used=new Set();
 for(const op of result.operations){
  if(!keys(op,['op','id','fields'])||!['add','update','remove'].includes(op.op)||typeof op.id!=='string'||used.has(op.id))fail('Invalid/duplicate operation');used.add(op.id);
  if(op.op==='add'){
   if(!/^new[0-9]{1,2}$/.test(op.id))fail('New item must use a temporary ID');
   const item={id:'i'+String(next.nextId++).padStart(4,'0'),...writable(op.fields)};next.items.push(item);diffs.push({op:'add',after:clone(item)});
  }else{
   const ix=next.items.findIndex(x=>x.id===op.id);if(ix<0)fail('Model referred to an unknown item');const before=clone(next.items[ix]);
   if(op.op==='remove'){if(!object(op.fields)||Object.keys(op.fields).length)fail('Removal has unexpected fields');next.items.splice(ix,1);diffs.push({op:'remove',before});}
   // The MERGED target is what gets written, so the merged quantity + unit are what must be write-valid: changing only the
   // unit of 0.5 m to roll is refused, changing only the quantity of 0.5 roll to 1 is accepted. Items the proposal does
   // not touch are not re-judged here and stay exactly as stored.
   else{readable(op.fields,true);const updated={...before,...clone(op.fields)};const{id,...rest}=updated;writable(rest);next.items[ix]=updated;diffs.push({op:'update',before,after:clone(updated)});}
  }
 }
 if(next.items.length>16)fail('Maximum 16 draft items');
 next.revision++;next.history.push({role:'user',content:userText},{role:'assistant',content:[result.reply,result.question].filter(Boolean).join('\n')||'The draft is unchanged.'});state(next);
 const hash=crypto.createHash('sha256').update(JSON.stringify({revision:current.revision,userText,result})).digest('hex');
 return{state:next,reply:result.reply,question:result.question,diffs,proposalId:hash,scope:result.scope,corrections:corrections(next)};
}
const fieldSchema={type:'object',additionalProperties:false,properties:{name:{type:'string',maxLength:120},quantity:{anyOf:[{type:'string'},{type:'null'}]},unit:{enum:units},specification:{type:'string',maxLength:500},notes:{type:'string',maxLength:600},review:{type:'array',items:{type:'string'},maxItems:8}}};
const schema={type:'object',additionalProperties:false,required:['scope','reply','question','operations'],properties:{scope:{enum:['materials','out_of_scope']},reply:{type:'string',maxLength:1000},question:{type:'string',maxLength:400},operations:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,required:['op','id','fields'],properties:{op:{enum:['add','update','remove']},id:{type:'string'},fields:fieldSchema}}}}};
module.exports={empty,state,corrections,fields,apply,schema,ITEM_FIELDS,UNITS:Q.UNITS,COUNT_UNITS:Q.COUNT_UNITS,QUANTITY_CODE,QUANTITY_MESSAGE};
