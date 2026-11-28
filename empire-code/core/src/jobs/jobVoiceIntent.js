'use strict';
/** Bounded local PL/EN intent parsing. No writes, electrical inference or implicit confirmation.
 * Language: Polish, English and mixed INPUT is recognised (the regex vocabulary below is input, not UI).
 * Every problem / question / help string this module RETURNS is English first-party text; a quoted
 * fragment of the user's own words is repeated literally, in whatever language it was said. */
const Measurement=require('./jobMeasurement.js'),Material=require('./jobMaterial.js');
const TradeMaterials=require('./jobVoiceMaterials.js');
const MAX_TEXT=4000,MAX_ACTIONS=8;
const fold=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/Ł/g,'L').toLowerCase();
const clean=s=>s.trim().replace(/\s+/g,' ');
const WORDS=Object.freeze({zero:0,jeden:1,jedna:1,jedno:1,one:1,dwa:2,dwie:2,two:2,trzy:3,three:3,cztery:4,four:4,piec:5,five:5,szesc:6,six:6,siedem:7,seven:7,osiem:8,eight:8,dziewiec:9,nine:9,dziesiec:10,ten:10,jedenascie:11,eleven:11,dwanascie:12,twelve:12,trzynascie:13,thirteen:13,czternascie:14,fourteen:14,pietnascie:15,fifteen:15,szesnascie:16,sixteen:16,siedemnascie:17,seventeen:17,osiemnascie:18,eighteen:18,dziewietnascie:19,nineteen:19,dwadziescia:20,twenty:20,trzydziesci:30,thirty:30,czterdziesci:40,forty:40,piecdziesiat:50,fifty:50,szescdziesiat:60,sixty:60,siedemdziesiat:70,seventy:70,osiemdziesiat:80,eighty:80,dziewiecdziesiat:90,ninety:90,sto:100,dwiescie:200,trzysta:300,czterysta:400,piecset:500,szescset:600,siedemset:700,osiemset:800,dziewiecset:900});
function decimal(raw){const s=fold(clean(raw));const spaced=/^([+\-−])\s+(\d+(?:[.,]\d+)?)$/.exec(s);if(spaced){const unsigned=decimal(spaced[2]);return unsigned===null?null:(spaced[1]==='+'?'+':'-')+unsigned;}const signed=/^(minus|negative|ujemny|ujemna|ujemne|plus|positive|dodatni|dodatnia|dodatnie)\s+(.+)$/.exec(s);if(signed){if(/^(?:minus|negative|ujemn|plus|positive|dodatn|[+-])/.test(signed[2]))return null;const magnitude=decimal(signed[2]);return magnitude===null?null:(/^(minus|negative|ujemn)/.test(signed[1])?'-':'+')+magnitude;}const mixed=/^(\d+)\s+(?:przecinek|point|kropka)\s+(.+)$/.exec(s);if(mixed){let fraction='';for(const d of mixed[2].split(/\s+/)){if(/^\d+$/.test(d))fraction+=d;else if(Object.hasOwn(WORDS,d)&&WORDS[d]<10)fraction+=WORDS[d];else return null;}return fraction?mixed[1]+'.'+fraction:null;}if(/^\d{1,3},\d{3}$/.test(s))return null;if(/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(s))return s.replace(',','.');const sides=s.split(/\s+(?:przecinek|point|kropka)\s+/);if(sides.length>2)return null;let sum=0,last=Infinity,seen=false;const ws=sides[0].split(/[\s-]+/);for(let i=0;i<ws.length;i++){const w=ws[i];if(w==='and'&&i>0&&i<ws.length-1)continue;if(w==='hundred'&&sum>0&&sum<10&&i===1){sum*=100;last=100;continue;}if(!Object.hasOwn(WORDS,w))return null;const n=WORDS[w];if(seen&&(n>=last||last<20||n===0||(last<100&&n>=10)||(last>=100&&n>=100)))return null;sum+=n;last=n;seen=true;}if(!seen)return null;let result=String(sum);if(sides.length===2){const digits=sides[1].split(/\s+/);if(!digits.length)return null;let tail='';for(const d of digits){if(/^\d+$/.test(d))tail+=d;else if(Object.hasOwn(WORDS,d)&&WORDS[d]<10)tail+=WORDS[d];else return null;}result+='.'+tail;}return result;}
const COUNT_WORD='(?:pcs|pieces?|szt(?:uk[ai]?)?\\.?|sztuki|sztuk|złączek|zlaczek|złączki|zlaczki|connectors?|couplings?|złączka|zlaczka)';
const UNIT_WORD='(?:mA|mV|kW|kVA|VA|V|A|Hz|wat(?:y|[oó]w)?|watt(?:s)?|wolt(?:a|y|[oó]w)?|volt(?:a|y|[oó]w|s)?|amper(?:a|y|[oó]w)?|amp(?:s)?|feet|foot|ft|stop(?:y)?|stóp|metr(?:y|ow|ów)?|meters?|m|inches|inch|in|cm|mm|pcs|pieces|szt(?:uk[ai]?)?\\.?)';
const UNIT_MAP={v:['voltage','V'],mv:['voltage','mV'],a:['current','A'],ma:['current','mA'],w:['active_power','W'],kw:['active_power','kW'],va:['apparent_power','VA'],kva:['apparent_power','kVA'],hz:['frequency','Hz']};
function measurementUnit(word){const w=fold(word);if(/^(wolt|volt)/.test(w))return ['voltage','V'];if(/^(amper|amp)/.test(w))return ['current','A'];if(/^(wat|watt)/.test(w))return ['active_power','W'];return UNIT_MAP[w]||null;}
function materialUnit(word){const w=fold(word);if(/^(st[oó]p(?:y)?|feet|foot|ft)$/.test(w))return 'ft';if(/^(metr|meter)/.test(w)||w==='m')return 'm';if(/^(inch|inches|in)$/.test(w))return 'in';if(['cm','mm'].includes(w))return w;if(/^(pcs|piece|szt)/.test(w))return 'pcs';return null;}
function numberSuffix(text){const tokens=clean(text).split(' ');for(let i=0;i<tokens.length;i++){const value=decimal(tokens.slice(i).join(' '));if(value!==null){if(i>0&&(Object.hasOwn(WORDS,fold(tokens[i-1]))||/^(?:minus|negative|ujemny|ujemna|ujemne|plus|positive|dodatni|dodatnia|dodatnie|not|nie|[+\-−–—])$/.test(fold(tokens[i-1]))||/^[+-]?\d+(?:[.,]\d+)?$/.test(tokens[i-1])))return null;return {value,prefix:tokens.slice(0,i).join(' '),raw:tokens.slice(i).join(' ')};}}return null;}
function parse(text,context={}){
 if(typeof text!=='string'||!text.trim()||text.length>MAX_TEXT)return {ok:false,actions:[],problems:['Say what you want to record (max. 4000 characters).'],transcript:typeof text==='string'?text:''};
 const trade=TradeMaterials.parse(text,decimal);if(trade)return trade;
 const transcript=text,actions=[],problems=[],issues=[];let target=null;
 // A clarification refers to an exact, unique span of the captured transcript.
 // If normalisation destroyed the mapping or the span repeats, retain the refusal
 // and require a full text edit rather than guessing which entry to replace.
 function issue(kind,fragment,message){problems.push(message);const start=transcript.indexOf(fragment);if(start<0||!fragment||transcript.indexOf(fragment,start+1)!==-1)return;const end=start+fragment.length;issues.push({id:'span-'+start+'-'+end,kind,start,end,fragment,message});}

 const chunks=text.replace(/[。]/g,'.').replace(/(?:^|\s+)(?:(?:i|and|oraz)\s+)?((?:dopisz\s+)?do\s+kupienia|buy|add\s+materials?|(?:i\s+)?need|potrzebuj[ęe])\s+/gi,'; $1 ').split(/(?:[;\n]+|(?<!\d)\.(?!\d)|(?<=\d)\.(?=\s+[A-ZĄĆĘŁŃÓŚŹŻ]))/u).map(clean).filter(Boolean);
 if(chunks.length>16)return {ok:false,actions:[],problems:['Too many commands in one entry. Split it into shorter parts.'],transcript};
 for(const chunk of chunks){const normalized=fold(chunk);const job=/^(?:otworz\s+(?:robote|zlecenie)|open\s+(?:job|project))\s+(?:przy\s+|at\s+)?(.+)$/i.exec(normalized);
  if(job){if(target!==null)problems.push('Choose one job for the whole instruction.');else target=chunk.slice(chunk.length-job[1].length).replace(/[.]+$/,'');continue;}
  if(/^(?:tak|yes|zapisz|save|confirm|zatwierdz)$/i.test(normalized)){problems.push('Confirm the visible summary with the button. Saying “yes” or “save” while dictating saves nothing.');continue;}
  if(/\b(?:usun|delete|replace|nadpisz|dobierz|calculate|oblicz|code compliant|zgodn[aeiy] z|zabezpieczenie|breaker|ampacity)\b/.test(normalized)){problems.push('This command goes beyond recording observations and materials: “'+chunk+'”. Use the appropriate tool.');continue;}
  const buy=/^(?:dopisz\s+)?(?:do\s+kupienia|kup|potrzebuje|dodaj\s+(?:materialy?|do\s+kupienia)|add\s+(?:materials?|to\s+buy)|to\s+buy|buy|(?:i\s+)?need)\s*:?\s*(.+)$/i.exec(normalized);
  if(buy){const list=chunk.slice(chunk.length-buy[1].length).split(/\s+(?:i|oraz|and)\s+|,\s+(?=\d+(?:\s|[a-zA-Z]))/i);for(const item of list){const match=new RegExp('^(.+?)\\s+('+UNIT_WORD+'|'+COUNT_WORD+')(?![a-zA-Ząćęłńóśźż])\\s*(.*)$','iu').exec(clean(item));if(!match){issue('material',item,'Give the quantity, unit and name of the material: “'+item+'”.');continue;}const value=decimal(match[1]),word=fold(match[2]);let unit=materialUnit(word),label=clean(match[3]);if(/^(zlaczk|zlacze|connector|coupling)/.test(word)){unit='pcs';label=clean(match[2]+' '+label);}if(!value||!unit||!label){issue('material',item,'The quantity, unit or name was not recognised unambiguously: “'+item+'”.');continue;}label=label.replace(/\btrzy\s+czwarte\b/ig,'¾').replace(/\bthree\s+quarters?\b/ig,'¾');const fields={label,specification:'',quantityText:value,unit,status:'needed',location:'',supplier:'',notes:''};const checked=Material.validateFields(fields);if(!checked.ok){issue('material',item,checked.problems.join(' '));continue;}actions.push({kind:'material',fields,source:item});}continue;}
  const measured=/\b(?:zmierzylem|zmierzylam|pomiar|measured|measurement|reading)\b/i.exec(normalized);
  if(measured){if(/\b(?:albo|lub|or|okolo|about|chyba|perhaps|moze|maybe|between|miedzy|nie|not|instead|zamiast)\b/.test(normalized)||/\d\s*[-–]\s*\d/.test(normalized)){issue('measurement',chunk,'The measurement is ambiguous. Give one confirmed value and unit.');continue;}const re=new RegExp('('+UNIT_WORD+')(?![a-zA-Ząćęłńóśźż])','giu');let found=[],m;while((m=re.exec(chunk))){const unit=measurementUnit(m[1]);if(!unit)continue;const num=numberSuffix(chunk.slice(0,m.index).replace(/[:=]\s*/g,' '));if(num)found.push({unit,num,index:m.index,end:re.lastIndex});}if(found.length!==1){issue('measurement',chunk,'Give one measurement with a clear value and unit: “'+chunk+'”.');continue;}const x=found[0],tail=clean(chunk.slice(x.end)).replace(/[.,]+$/,'');if(tail&&!/^(?:ac|dc|prad przemienny|prąd przemienny|prad staly|prąd stały|teraz|now)(?:\s+(?:ac|dc|teraz|now))?$/i.test(tail)){issue('measurement',chunk,'The end of the measurement was not recognised: “'+tail+'”.');continue;}if(!/\b(?:teraz|wlasnie|now|just)\b/.test(normalized)){issue('measurement',chunk,'When was the measurement taken? Add “now” or use the measurement form for an earlier time.');continue;}const point=clean(x.num.prefix.replace(/\b(?:właśnie|wlasnie|teraz|now|just|zmierzyłem|zmierzylem|zmierzyłam|zmierzylam|pomiar|measured|measurement|reading)\b/giu,'').replace(/[,:]+/g,' '));if(!point||/^(?:(?:w|in|at|the)\s+)?(?:panel|panelu|rozdzielnic[ay]|rozdzielnicy)$/i.test(point)){issue('measurement',chunk,'Give the measurement point, e.g. “panel A, L1 to neutral”.');continue;}const mode=/\bac\b/.test(normalized)?'AC':/\bdc\b/.test(normalized)?'DC':'not_recorded';if(/\bac\b/.test(normalized)&&/\bdc\b/.test(normalized)){issue('measurement',chunk,'The measurement contains both AC and DC. Say which one applies.');continue;}if(!context.measuredLocal||!context.utcOffset){problems.push('The capture time of this instruction is missing. Try again.');continue;}const fields={label:point.slice(0,160),quantity:x.unit[0],valueText:x.num.value,unit:x.unit[1],location:point,measuredLocal:context.measuredLocal,utcOffset:context.utcOffset,mode,instrument:'',notes:''};const checked=Measurement.validateFields(fields);if(!checked.ok){issue('measurement',chunk,checked.problems.join(' '));continue;}actions.push({kind:'measurement',fields,source:chunk});continue;}
  problems.push('Command not recognised: “'+chunk+'”. Nothing will be saved.');
 }
 if(actions.length>MAX_ACTIONS)problems.push('At most '+MAX_ACTIONS+' entries in one instruction.');if(!actions.length&&!target&&!problems.length)problems.push('No entries were recognised.');return {ok:!problems.length,transcript,target,actions,problems,issues,interpretation:'bounded-local-v1'};
}
function resolveJob(query,jobs){const q=fold(clean(query||''));if(!q)return {ok:false,code:'MISSING_JOB'};const matches=jobs.filter(j=>fold(clean(j.revision.title))===q||j.revision.address&&fold(clean(j.revision.address))===q);return matches.length===1?{ok:true,job:matches[0]}:{ok:false,code:matches.length?'AMBIGUOUS_JOB':'JOB_NOT_FOUND',matches};}
// The appended "Correction: " line is provenance text inside the transcript (shown in the capture field and stored
// with the plan). Nothing reads it back: re-parsing such a line is an unrecognised command in either language, and
// a transcript stored earlier with the former Polish "Korekta: " line is kept exactly as it was written.
function correct(parsed,utterance){if(!parsed||!parsed.ok||typeof utterance!=='string')return {ok:false,problems:['Prepare the summary first.']};const match=/^(?:nie\s+(.+?)\s*,?\s*(?:tylko|lecz)\s+(.+)|(?:change|replace)\s+(.+?)\s+(?:to|with)\s+(.+))$/i.exec(clean(utterance));if(!match)return {ok:false,problems:['Correction not recognised. Say “change 80 to 60” or „nie 80, tylko 60”. If several values are identical, correct the whole text.']};const from=decimal((match[1]||match[3]).replace(/,$/,'')),to=decimal(match[2]||match[4]);const hits=parsed.actions.map((a,i)=>({a,i})).filter(({a})=>(a.kind==='material'?a.fields.quantityText:a.fields.valueText)===from);if(from===null||to===null||hits.length!==1)return {ok:false,problems:['The correction does not point to exactly one value. Correct the text of the instruction.']};const result=JSON.parse(JSON.stringify(parsed)),a=result.actions[hits[0].i];a.fields[a.kind==='material'?'quantityText':'valueText']=to;const v=(a.kind==='material'?Material:Measurement).validateFields(a.fields);if(!v.ok)return v;result.correction={from,to,source:utterance};result.transcript=parsed.transcript+'\nCorrection: '+utterance;if(result.auditTranscript)result.auditTranscript+='\nUSER VALUE CORRECTION: '+utterance;return result;}

/** Replace ONLY one user-selected failed fragment. No write, unit inference or
 * automatic replacement occurs. Every replacement must itself parse as exactly
 * one supported action of the original kind, then the whole instruction is
 * revalidated with the ORIGINAL capture-time context. */
function repair(parsed,issueId,reply,context={}) {
 if(parsed&&parsed.interpretation==='trade-materials-v1')return TradeMaterials.repair(parsed,issueId,reply,decimal);
 const fail=message=>({ok:false,repairError:true,problems:[message]});
 if(!parsed||typeof parsed.transcript!=='string'||parsed.ok!==false||typeof issueId!=='string'||typeof reply!=='string'||!reply.trim()||reply.length>1000)return fail('Choose the unrecognised fragment and give its full corrected text.');
 const original=parsed.transcript,checked=parse(original,context);
 if(checked.ok)return fail('The text has changed. Prepare the summary again.');
 const item=checked.issues&&checked.issues.find(x=>x.id===issueId);
 const prior=parsed.issues&&parsed.issues.find(x=>x.id===issueId);
 if(!item||!prior||JSON.stringify(item)!==JSON.stringify(prior)||original.slice(item.start,item.end)!==item.fragment)return fail('The selected fragment is no longer current. Nothing was replaced.');
 let answer=reply.trim(),one=parse(answer,context);
 // 'Do kupienia ' is parser INPUT (a recognised purchase verb), used only to validate a bare material reply. It is
 // never shown or stored: the applied text is the action source, which excludes the verb.
 if(item.kind==='material'&&!(one.ok&&one.actions.length===1&&one.actions[0].kind==='material'&&!one.target))one=parse('Do kupienia '+answer,context);
 if(!one.ok||one.target||one.actions.length!==1||one.actions[0].kind!==item.kind)return fail(item.kind==='material'?'Give only this material: quantity, unit and name. The other entries are kept.':'Repeat only this measurement: point, value, unit and “now”. The other entries are kept.');
 // The outer material clause already supplies its action verb.
 if(item.kind==='material'){
  const hasVerb=/^(?:(?:dopisz\s+)?do\s+kupienia|kup|potrzebuj[ęe]|dodaj\s+(?:materialy?|do\s+kupienia)|add\s+(?:materials?|to\s+buy)|to\s+buy|buy|(?:i\s+)?need)\s*:?\s*/i;
  answer=one.actions[0].source.replace(hasVerb,'').trim();
  if(/[;\n]/.test(answer))return fail('One clarification can contain only one item.');
 }
 const corrected=original.slice(0,item.start)+answer+original.slice(item.end);
 const next=parse(corrected,context),previous=Array.isArray(parsed.repairs)?parsed.repairs:[];
 if(previous.length>=8)return fail('The clarification limit was reached. Check the whole text before trying again.');
 next.originalTranscript=parsed.originalTranscript||original;
 next.repairs=previous.concat([{kind:item.kind,before:item.fragment,reply:reply.trim(),after:answer}]);
 next.auditTranscript=next.originalTranscript+'\nUSER CLARIFICATIONS:\n'+next.repairs.map((r,i)=>(i+1)+'. ['+r.before+'] -> ['+r.after+'] | USER REPLY: '+r.reply).join('\n')+'\nREVIEWED TRANSCRIPT:\n'+corrected;
 if(next.auditTranscript.length>5000)return fail('The clarification history is too long. Split the instruction; nothing was shortened or saved.');
 return next;
}

module.exports={MAX_TEXT,MAX_ACTIONS,decimal,parse,resolveJob,correct,repair};
