'use strict';
/** Material-list interpreter. Captures counts/specifications, never selects a
 * conductor or fitting for an installation. Uncertain spans remain questions.
 * Pure: no microphone, network, clock, browser state or persistence access. */
const Material = require('./jobMaterial.js');
const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
const trim = s => s.trim().replace(/\s+/g, ' ');
const NOUN = /\b(?:konektor(?:y|ów|ow|a|ami|em)?|connectors?|bus(?:h)?ing(?:i|ów|ow|a|s)?|breaker(?:y|ów|ow|a|s)?|wyłącznik(?:i|ów|ow|a)?|wylacznik(?:i|ow|a)?|kab(?:el|le|li|la|lami)|przew[oó]d(?:y|ów|ow|u|ami)?|cables?|wires?|conductors?|złącz(?:ki|ek|ka)|zlacz(?:ki|ek|ka))\b/giu;
const NEW_TRADE = /\b(?:konektor\w*|bus(?:h)?ing\w*|breaker\w*|wylacznik\w*|kab(?:el|le|li|la)|cables?|conductors?)\b/i;
const PURCHASE = /(?:do\s+kupienia|potrzebuj[ęe]|(?:i\s+)?need|buy|dodaj(?:\s+(?:również|rowniez|jeszcze))?(?:\s+(?:materiały|materialy|do\s+listy\s+zakup[oó]w))?|add(?:\s+(?:also|to\s+(?:the\s+)?shopping\s+list|materials?))?|kup)\s*:?\s*/giu;
const UNIT = /\s+(ft|feet|foot|st[oó]p(?:y)?|m|metr(?:y|ów|ow)?|meters?|cm|mm|in|inches|inch|pcs|pieces?|szt(?:uki|uk|uka)?\.?)(?:\s*)$/iu;
const NUMBER = /\S+/gu;
const countUnit = s => /^(pcs|piece|szt)/.test(fold(s));
function unitOf(s) { const x=fold(s); if(countUnit(x))return 'pcs'; if(/^(ft|feet|foot|stop|stopy)$/.test(x))return 'ft'; if(/^(metr|meter)/.test(x)||x==='m')return 'm'; if(/^(inch|in)/.test(x))return 'in'; return ['cm','mm'].includes(x)?x:null; }
function family(word) { const x=fold(word); return /^(konektor|connector|zlacz)/.test(x)?'connector':/^bus(?:h)?ing/.test(x)?'bushing':/^(breaker|wylacznik)/.test(x)?'breaker':'wire'; }
function title(f) { return f==='wire'?'Przewody':f==='connector'?'Konektory':f==='breaker'?'Breakery':'Bushingi'; }
function cleanBoundary(s) { return s.replace(/^[\s,;:.]+|[\s,;:.]+$/g,'').trim(); }
function filler(s) {
 let x=fold(s).replace(/[,.!;:…]+/g,' ').trim();
 // Remove only complete nontechnical discourse markers; never numbers,
 // negation or instructions such as delete/approve/order.
 for(let i=0;i<16;i++) {const before=x;x=x.replace(/^(?:(?:ok|okay|okej|wiec|teraz|musze|prosze|do listy zakupow|to the shopping list|to shopping list|rowniez|do tego|a do tego|i do tego|jeszcze|potrzebuje|do kupienia|dopisz|dodaj|materialy|i need|need|buy|add|please|also|and|oraz|plus|i)\b\s*)/,'').trim();if(x===before)break;}
 return !x;
}
function stripTail(s) {
 let x=s.trim();
 for(let i=0;i<8;i++){const old=x;x=x.replace(/[\s,;:.]+$/,'').replace(/\s+(?:i|and|oraz|plus|do tego|do kupienia|potrzebuj[ęe]|buy|need|i need)$/iu,'').trim();if(old===x)break;}
 return x;
}
function countBefore(text,from,to,decimal) {
 const gap=text.slice(from,to);let unit='pcs',before=gap,unitRaw='';const u=UNIT.exec(gap);
 if(u){unit=unitOf(u[1]);unitRaw=u[1];before=gap.slice(0,u.index);}
 const tokens=Array.from(before.matchAll(NUMBER));
 for(let n=Math.min(8,tokens.length);n>=1;n--){const start=tokens[tokens.length-n].index;const raw=before.slice(start).trim();if(/^plus\s+/i.test(raw))continue;const v=decimal(raw);
  if(v!==null){const preceding=before.slice(0,start);if(/(?:\b(?:minus|negative|nie|not)|[+−–—-])\s*$/iu.test(preceding))return null;return {start:from+start,value:v,unit:unit||'pcs',explicitUnit:!!unitRaw,raw};}}
 return null;
}
function supported(text) {
 if(typeof text!=='string'||text.length>4000)return false;
 const x=fold(text);const dimensionedConnector=/\bconnectors?\b/.test(x)&&(/\b(?:inch(?:es)?|in|cala)\b/.test(x)||/[½¼¾]|\d\/\d/.test(x)||/^(?:ok|okay|please)[, ]/i.test(x));const sizedWire=/\b(?:awg|kcmil|mcm)\b/.test(x)&&/\b(?:przewod\w*|wires?)\b/.test(x);if(!NEW_TRADE.test(x)&&!dimensionedConnector&&!sizedWire)return false;
 // Leave mixed observations to the existing measurement interpreter rather
 // than reclassifying numbers in a reading as ordered materials.
 if(/\b(?:zmierzylem|zmierzylam|measured|measurement|pomiar|open job|otworz robote)\b/.test(x))return false;
 return /\b(?:potrzebuje|kup|do kupienia|buy|need|dodaj|add)\b/.test(x);
}
function inchSize(s) {
 let x=cleanBoundary(s);
 x=x.replace(/\b(?:rozmiar(?:u)?|size|o srednicy|średnicy|srednicy)\s*/gi,'').trim();
 x=x.replace(/\bp[oó]łtora\b/gi,'1 1/2').replace(/\b(?:jeden i p[oó]ł|one and a half)\b/gi,'1 1/2').replace(/\b(?:trzy czwarte|three quarters?)\b/gi,'3/4').replace(/\b(?:p[oó]ł|half)\b/gi,'1/2');
 x=x.replace(/(\d)([¼½¾])/g,(_,n,f)=>n+' '+({'¼':'1/4','½':'1/2','¾':'3/4'}[f])).replace(/[¼½¾]/g,f=>({'¼':'1/4','½':'1/2','¾':'3/4'}[f]));
 const m=/^(\d+(?:[.,]\d+|\s+\d+\/\d+)?|\d+\/\d+)\s*(?:cala|cale|cali|cal|inch(?:es)?|in|["″])$/i.exec(x);
 if(!m)return null;
 const value=m[1].replace(',','.');if(/\/0(?:\D|$)/.test(value))return null;
 const v=value.split(' ');const fraction=v[v.length-1].split('/');const q=fraction.length===2?(v.length===2?Number(v[0]):0)+Number(fraction[0])/Number(fraction[1]):Number(value);
 return Number.isFinite(q)&&q>0?value+' in':null;
}
function wireSpec(s) {
 const x=cleanBoundary(s).replace(/^(?:rozmiar|size|gauge)\s*/i,'');
 if(/^(?:\d{1,2}\/0|\d{1,2})\s*AWG(?:\s+(?:Cu|Al|THHN|THWN-2|XHHW-2))*$/i.test(x)||/^\d{2,4}\s*(?:kcmil|MCM)(?:\s+(?:Cu|Al|THHN|THWN-2|XHHW-2))*$/i.test(x))return x;
 // Slash-zero notation is explicitly spoken/typed; separated "2 0" isn't.
 if(/^\d\/0(?:\s+(?:Cu|Al|THHN|THWN-2|XHHW-2))*$/i.test(x))return x;
 return null;
}
function unknownSpec(s){return /^(?:rozmiar (?:niepodany|nieznany)|bez rozmiaru|size (?:unknown|not recorded)|not specified)$/i.test(cleanBoundary(s));}

function fittingDetails(raw) {
 let rest=cleanBoundary(raw),types=[];
 rest=rest.replace(/\b(?:plastikow(?:e|y|ych|a|ego)|plastic|metalow(?:e|y|ych|a|ego)|metal)\b/giu,word=>{types.push(/^plast/i.test(word)?'plastik':'metal');return '';});
 types=[...new Set(types)];rest=cleanBoundary(rest);const kind=types.join(' / '),dimension=inchSize(rest),unknown=unknownSpec(rest);
 return {kind,rest,dimension,unknown,conflict:types.length>1,shown:[dimension,kind?'materiał: '+kind:''].filter(Boolean).join(' · ')};
}
function breakerDetails(raw) {
 const value=cleanBoundary(raw);
 // Store a shopping-list rating, not suitability for a panel or installation.
 const rating=/^(\d+(?:[.,]\d+)?)\s*(A|amps?|amper(?:y|a|ów|ow)?)(?=$|\s|[,;])/iu.exec(value);
 if(!rating||!Number.isFinite(Number(rating[1].replace(',','.')))||Number(rating[1].replace(',','.'))<=0)return {ok:false,message:'Podaj prąd znamionowy i model/typ breakera. To zapis materiału, nie dobór zabezpieczenia.'};
 const amperes=rating[1].replace(',','.')+' A';let tail=cleanBoundary(value.slice(rating[0].length));
 const model=/\b(?:model|typ|type)\s+([\p{L}\p{N}][\p{L}\p{N}_. /-]{0,59})$/iu.exec(tail);
 const rawBrand=model?cleanBoundary(tail.slice(0,model.index)):tail;
 const brand=/^(?:firmy|producent(?:a)?|marki|brand|by)\s+([\p{L}\p{N}][\p{L}\p{N} .&-]{0,59})$/iu.exec(rawBrand);
 const maker=brand?brand[1].trim():'';
 if(rawBrand&&!maker)return {ok:false,rating:amperes,message:'Potwierdź producenta oraz model/typ breakera. Nie odgaduję ich z tekstu.'};
 if(!model)return {ok:false,rating:amperes,maker,message:'Potwierdź producenta i podaj model/typ albo powiedz „model niepodany”. Nazwa z nagrania nie jest automatycznie poprawiana.'};
 const name=model[1].trim();if(/\b(?:delete|usun|order|zamow|approve|dobierz|albo|lub|or|instead|zamiast)\b/i.test(fold(name)))return {ok:false,rating:amperes,maker,message:'Model zawiera dodatkowe polecenie lub alternatywę. Potwierdź jedną pozycję.'};
 const unknown=/^(?:niepodany|nieznany|unknown|not recorded)$/i.test(name);
 return {ok:true,rating:amperes,maker,specification:[amperes,maker?'producent: '+maker:'',unknown?'model: niepodany':'model: '+name].filter(Boolean).join(' · '),notes:'Opis z wypowiedzi — model, producent i zgodność z rozdzielnicą nie są weryfikowane.'};
}
function extendedWireSpec(raw) {
 const basic=wireSpec(raw);if(basic)return basic;
 let text=cleanBoundary(raw),head=/^(\d{1,2}\/0|\d{1,2})\s*AWG\b/iu.exec(text);
 if(!head)return null;const specs=[head[1]+' AWG'];text=cleanBoundary(text.slice(head[0].length));
 // No unstated lengths, colours, quantity multiplication or installation suitability.
 const colours=/^((?:czerwon[ya]|czarn[ya]|bial[ya]|biał[ya]|zielon[ya]|niebiesk[ia]|red|black|white|green|blue)(?:\s+(?:i|and)\s+(?:czerwon[ya]|czarn[ya]|bial[ya]|biał[ya]|zielon[ya]|niebiesk[ia]|red|black|white|green|blue))*)(?=$|[,;\s])/iu.exec(text);
 if(colours){specs.push(colours[1]);text=cleanBoundary(text.slice(colours[0].length));}
 if(text){const length=/^(?:po|each)\s+(\d+(?:[.,]\d+)?)\s*(ft|feet|foot|stóp|stopy|m|meters?|metry|metrów)$/iu.exec(text);if(!length||!Number.isFinite(Number(length[1].replace(',','.')))||Number(length[1].replace(',','.'))<=0)return null;specs.push('po '+length[1].replace(',','.')+' '+unitOf(length[2]));}
 return specs.length>1?specs.join(' · '):null;
}

function parse(text,decimal,{force=false}={}) {
 if(!force&&!supported(text))return null;
 if(typeof text!=='string'||!text.trim()||text.length>4000)return null;
 const tokens=Array.from(text.matchAll(NOUN)).map(m=>({word:m[0],start:m.index,end:m.index+m[0].length,family:family(m[0])}));
 if(!tokens.length)return null;
 const out={ok:false,transcript:text,target:null,actions:[],problems:[],issues:[],draftItems:[],interpretation:'trade-materials-v1'};
 function ask(start,end,fam,message,preview={},group=false) {
  while(start<end&&/[\s,;:.]/.test(text[start]))start++;const visible=stripTail(text.slice(start,end));end=start+visible.length;
  const fragment=text.slice(start,end),id='trade-'+start+'-'+end;
  if(!fragment){out.problems.push(message);return;}
  const item={id,kind:'material',scope:group?'material_group':'trade_item',start,end,fragment,message,family:fam,preview:{label:title(fam),...preview}};
  out.issues.push(item);out.problems.push(message);out.draftItems.push({state:'question',...item});
 }
 // Build count-led entries. An uncounted repeat of the same noun is a
 // specification continuation, not another purchased item.
 const entries=[];let lastNounEnd=0;
 for(const token of tokens){const q=countBefore(text,lastNounEnd,token.start,decimal);let start=q?q.start:token.start;
  const gap=text.slice(lastNounEnd,start);const purchases=Array.from(gap.matchAll(PURCHASE));let restart='';
  if(purchases.length){const mark=purchases[purchases.length-1];const after=gap.slice(mark.index+mark[0].length);if(!filler(after)){start=lastNounEnd+mark.index;restart=after;}}
  if(!q&&entries.length&&entries[entries.length-1].family===token.family){entries[entries.length-1].echoes.push(token);}
  else entries.push({...token,start,nounStart:token.start,q,restart,echoes:[]});
  lastNounEnd=token.end;
 }
 if(!entries.length)return null;
 const leading=text.slice(0,entries[0].start);
 if(!filler(leading))out.problems.push('Niejasny początek listy: „'+trim(leading)+'”. Nie pominięto tego fragmentu.');
 // Expand entry boundaries to a new purchase clause (and its false starts)
 // so interrupted counts stay with their own material, not the prior wire.
 for(let i=1;i<entries.length;i++){
  const prev=entries[i-1],cur=entries[i],gap=text.slice(prev.end,cur.start),purchases=Array.from(gap.matchAll(PURCHASE));
  if(purchases.length){let offset=prev.end+purchases[purchases.length-1].index;const before=text.slice(prev.end,offset);const m=/(?:[.,;]\s*)?(?:do tego|a do tego|i do tego)\s*$/iu.exec(before);if(m)offset=prev.end+m.index;cur.start=offset;}
 }
 for(let i=0;i<entries.length;i++){
  const e=entries[i];let end=i+1<entries.length?entries[i+1].start:text.length;
  // Preserve a possible total/count declaration followed by a wire breakdown
  // as one question; never sum the declaration and its individual entries.
  const rawTail=stripTail(text.slice(e.end,end));
  if(e.family==='wire'&&e.q&&e.q.unit==='pcs'&&!rawTail&&i+1<entries.length&&entries[i+1].family==='wire'){
   let j=i+1;while(j+1<entries.length&&entries[j+1].family==='wire')j++;
   end=j+1<entries.length?entries[j+1].start:text.length;
   ask(e.start,end,'wire','Podano ogólną liczbę kabli oraz dalsze ilości lub rozmiary. Wymień każdy przewód z ilością i jednoznacznym rozmiarem; nie zsumowałem tych liczb.',{},true);i=j;continue;
  }
  const raw=text.slice(e.start,end);let spec=stripTail(text.slice(e.end,end));
  if(e.echoes.length){const first=e.echoes[0];const before=cleanBoundary(text.slice(e.end,first.start));if(!before)spec=stripTail(text.slice(first.end,end));}
  const q=e.q,fit=(e.family==='connector'||e.family==='bushing')?fittingDetails(spec):null,preview={label:title(e.family)+(fit&&fit.kind?' · '+fit.kind:''),...(q?{quantityText:q.value,unit:q.unit}:{}),rawSpecification:spec};
  if(!q){ask(e.start,end,e.family,'Ile sztuk lub jaka długość tej pozycji? Powtórz ją z ilością.',preview);continue;}
  if(q.unit==='pcs'&&(!Number.isSafeInteger(Number(q.value))||Number(q.value)<=0)){ask(e.start,end,e.family,'Podaj dodatnią całkowitą liczbę sztuk w obsługiwanym zakresie.',preview);continue;}
  if(e.restart||/(?:\d|zł[ąa]?)\s*(?:\.\.\.|…)/iu.test(raw)){
   ask(e.start,end,e.family,'W tej pozycji są urwane słowa lub powtórzone liczby. Potwierdź ilość i rozmiar jednym zdaniem; nie naliczyłem powtórzeń.',preview);continue;
  }
  if(/\b(?:nie|not|albo|lub|or|maybe|chyba|moze|zamiast|instead|usun|delete|zamow|order|zatwierdz|approve|dobierz)\b/i.test(fold(raw))||/[<>]/.test(raw)){
   ask(e.start,end,e.family,'Opis zawiera alternatywę, zaprzeczenie lub dodatkowe polecenie. Podaj jedną potwierdzoną pozycję.',preview);continue;
  }
  let specification='',notes='';
  if(e.family==='breaker'){
   if(q.unit!=='pcs'){ask(e.start,end,e.family,'Podaj liczbę sztuk breakerów, nie długość.',preview);continue;}
   const d=breakerDetails(spec);if(!d.ok){ask(e.start,end,e.family,d.message,{...preview,rating:d.rating||'',maker:d.maker||''});continue;}
   specification=d.specification;notes=d.notes;
  } else if(e.family==='wire'){
   if(spec){specification=extendedWireSpec(spec);if(!specification&&!unknownSpec(spec)){ask(e.start,end,'wire','Potwierdź rozmiar przewodu oraz, jeśli podano długość, czy dotyczy każdej sztuki czy całości. Nie zamieniam „trzy zero” / „2 0” na AWG ani nie przypisuję domyślnie długości.',preview);continue;}}
   if(q.unit==='pcs'&&!specification&&!unknownSpec(spec)){ask(e.start,end,'wire','Podaj rozmiar tych przewodów albo wyraźnie powiedz „rozmiar niepodany”. Liczba sztuk nie jest długością.',preview);continue;}
  } else {
   if(q.unit!=='pcs'){ask(e.start,end,e.family,'Dla osprzętu podaj liczbę sztuk. Wymiar osprzętu zapisz osobno po jego nazwie.',preview);continue;}
   if(fit.conflict){ask(e.start,end,e.family,'Opis jednego elementu zawiera plastik i metal. Potwierdź typ materiału.',preview);continue;}
   if(fit.dimension)specification=fit.shown;
   else if(fit.unknown){specification=fit.kind?'materiał: '+fit.kind:'';notes='Rozmiar niepodany — jawnie potwierdzone.';}
   else {
    const message=fit.rest?'Rozmiar osprzętu jest niejednoznaczny. Potwierdź wymiar — bez zgadywania z ciągu cyfr.':'Jaki rozmiar osprzętu? Możesz też jawnie powiedzieć „rozmiar niepodany”.';
    ask(e.start,end,e.family,message,{...preview,knownType:fit.kind,answerMode:'fitting_size'});continue;
   }
  }
  if(unknownSpec(spec))notes='Rozmiar niepodany — jawnie potwierdzone.';
  const fields={label:e.family==='wire'?'Przewód':e.family==='connector'?'Konektor':e.family==='breaker'?'Breaker':'Bushing',specification:specification||'',quantityText:q.value,unit:q.unit,status:'needed',location:'',supplier:'',notes};
  const validation=Material.validateFields(fields);
  if(!validation.ok){ask(e.start,end,e.family,validation.problems.join(' '),preview);continue;}
  const action={kind:'material',fields,source:cleanBoundary(raw)};out.actions.push(action);out.draftItems.push({state:'ready',...action});
 }
 if(out.actions.length+out.issues.length>8)out.problems.push('Maksymalnie osiem pozycji w jednej wypowiedzi. Podziel listę; niczego nie zapisano.');
 out.ok=out.problems.length===0&&out.actions.length>0;return out;
}
function repair(parsed,id,reply,decimal) {
 const bad=m=>({ok:false,repairError:true,problems:[m]});
 if(!parsed||parsed.interpretation!=='trade-materials-v1'||typeof reply!=='string'||!reply.trim()||reply.length>1000)return bad('Podaj poprawioną pozycję z ilością i rozmiarem.');
 const checked=parse(parsed.transcript,decimal,{force:true}),issue=checked&&checked.issues.find(i=>i.id===id),old=parsed.issues&&parsed.issues.find(i=>i.id===id);
 if(!issue||!old||JSON.stringify(issue)!==JSON.stringify(old))return bad('Lista zmieniła się. Wybierz bieżące pytanie ponownie.');
 let applied=reply.trim(),answer=parse(applied,decimal,{force:true});
 // A short size answer applies only to a verified fitting-size question; no count or material is inferred.
 if((!answer||!answer.ok)&&issue.preview.answerMode==='fitting_size'){
  const size=inchSize(applied),unspecified=unknownSpec(applied);
  if(size||unspecified){const word=issue.family==='connector'?'konektory':'bushingi',kind=issue.preview.knownType==='plastik'?'plastikowe':issue.preview.knownType==='metal'?'metalowe':'';
   applied=issue.preview.quantityText+' '+word+' '+kind+' '+applied;answer=parse(applied,decimal,{force:true});}
 }
 if(!answer||!answer.ok||answer.issues.length||answer.actions.some(a=>a.kind!=='material')||(issue.scope!=='material_group'&&answer.actions.length!==1))return bad(answer&&answer.problems.length?answer.problems.join(' '):'Powtórz tę pozycję z ilością i jednoznacznym rozmiarem.');
 if(answer.draftItems.some(a=>{const label=a.fields&&a.fields.label;return issue.family==='wire'?label!=='Przewód':issue.family==='connector'?label!=='Konektor':issue.family==='breaker'?label!=='Breaker':label!=='Bushing';}))return bad('Odpowiedź dotyczy innego rodzaju materiału. Nie zastąpiono wpisu.');
 const text=parsed.transcript.slice(0,issue.start)+applied+parsed.transcript.slice(issue.end),next=parse(text,decimal,{force:true});
 if(!next)return bad('Nie udało się ponownie odczytać całej listy.');
 const history=Array.isArray(parsed.repairs)?parsed.repairs:[];if(history.length>=8)return bad('Limit doprecyzowań. Sprawdź cały tekst; niczego nie zapisano.');
 next.originalTranscript=parsed.originalTranscript||parsed.transcript;next.repairs=history.concat([{kind:'material',before:issue.fragment,reply:reply.trim(),after:applied}]);
 next.auditTranscript=next.originalTranscript+'\nUSER CLARIFICATIONS:\n'+next.repairs.map((r,i)=>(i+1)+'. ['+r.before+'] -> ['+r.after+'] | USER REPLY: '+r.reply).join('\n')+'\nREVIEWED TRANSCRIPT:\n'+text;
 if(next.auditTranscript.length>5000)return bad('Historia jest zbyt długa. Niczego nie skrócono ani nie zapisano.');return next;
}
module.exports={supported,parse,repair,inchSize,wireSpec};
