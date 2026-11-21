'use strict';
/** Photo metadata only; original files are immutable separate assets. No AI interpretation. */
const KIND='empire-code.photo-revision', ASSET_KIND='empire-code.photo-asset', VERSION=1;
const PRODUCER=Object.freeze({applicationRevision:'LC-JOB-PHOTOS-1',recordContractRevision:1});
const STAGES=Object.freeze(['not_recorded','before','during','after']);
const FIELDS=Object.freeze(['label','location','stage','notes','state']);
const ID=/^photo1_[0-9a-f]{32}$/, REV_ID=/^prev1_[0-9a-f]{32}$/, JOB_ID=/^job1_[0-9a-f]{32}$/, JOB_REV_ID=/^jrev1_[0-9a-f]{32}$/;
const FILE_FIELDS=Object.freeze(['name','mediaType','bytes','sha256','width','height','fileModifiedMs']);
const MAX_FILE_BYTES=12*1024*1024, MAX_PIXELS=60000000, MAX_DIMENSION=16000;
const MAX_PHOTOS=100, MAX_TOTAL_PHOTOS=500, MAX_JOB_BYTES=200*1024*1024, MAX_TOTAL_BYTES=500*1024*1024;
const MAX_REVISIONS=20, MAX_JOB_ROWS=1000, MAX_TOTAL_ROWS=10000;
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const fail = (code, problems, extra) => Object.assign({ ok: false, code, problems: Array.isArray(problems) ? problems : [problems] }, extra || {});
function safeData(value) {
  const seen = new Set(); let nodes = 0, text = 0;
  function visit(v, depth) {
    if (++nodes > 5000 || depth > 12) throw new Error('Data is too large or deeply nested.');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { if ((text += v.length) > 32768) throw new Error('Text size limit exceeded.'); return; }
    if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) throw new Error('Unsupported number.'); return; }
    if (typeof v !== 'object') throw new Error('Plain JSON data required.');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new Error('Custom objects are unsupported.');
    if (seen.has(v)) throw new Error('Cyclic data is unsupported.'); seen.add(v);
    const keys = Reflect.ownKeys(v); if (keys.length > 5000) throw new Error('Too many properties.');
    for (const k of keys) {
      if (array && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (typeof k !== 'string' || !d || !own(d, 'value') || !d.enumerable) throw new Error('Accessors and hidden properties are unsupported.');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) throw new Error('Extra array properties are unsupported.');
      visit(d.value, depth + 1);
    }
    if (array) { if (v.length > 5000) throw new Error('Array limit exceeded.'); for (let i = 0; i < v.length; i++) if (!own(v, i)) throw new Error('Array holes are unsupported.'); }
    seen.delete(v);
  }
  try { visit(value, 0); if (JSON.stringify(value).length > 65536) throw new Error('Serialized record exceeds 64 KiB.'); return { ok: true }; }
  catch (_) { return fail('VALIDATION', 'Unsupported, non-JSON or oversized photo data.'); }
}
const copy = v => JSON.parse(JSON.stringify(v));
function shape(v, keys) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => own(v, k)); }
function utc(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) return false; try { return new Date(v).toISOString() === v; } catch (_) { return false; } }
function formatBytes(bytes){if(!Number.isSafeInteger(bytes)||bytes<0)return 'unavailable';if(bytes<1024)return bytes+' B';if(bytes<1024*1024)return (bytes/1024).toFixed(1)+' KiB';return (bytes/(1024*1024)).toFixed(2)+' MiB';}
function dimensions(width,height){return Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width<=MAX_DIMENSION&&height<=MAX_DIMENSION&&width*height<=MAX_PIXELS;}
function validateFile(v){
 if(!safeData(v).ok||!shape(v,FILE_FIELDS))return fail('VALIDATION','Unsupported photo file metadata.');
 if(typeof v.name!=='string'||!v.name.trim()||v.name.length>255||/[\x00\r\n]/.test(v.name)||!['image/jpeg','image/png','image/webp'].includes(v.mediaType)||!Number.isSafeInteger(v.bytes)||v.bytes<1||v.bytes>MAX_FILE_BYTES||typeof v.sha256!=='string'||!(/^[a-f0-9]{64}$/).test(v.sha256)||!dimensions(v.width,v.height)||!(v.fileModifiedMs===null||Number.isSafeInteger(v.fileModifiedMs)&&v.fileModifiedMs>=0&&v.fileModifiedMs<=8640000000000000))return fail('VALIDATION','Invalid file name, type, size, dimensions, digest or file timestamp.');
 return {ok:true,file:copy(v)};
}
function validateFields(v){
 if(!safeData(v).ok||!shape(v,FIELDS))return fail('VALIDATION','Photo fields are missing or unsupported.');
 const p=[];
 for(const[k,max,required,line]of [['label',160,true,true],['location',500,false,false],['notes',4000,false,false]])if(typeof v[k]!=='string'||v[k].length>max||required&&!v[k].trim()||line&&/[\r\n]/.test(v[k]))p.push(k+': '+(required?'nonblank ':'')+(line?'single-line ':'')+'text, at most '+max+' characters.');
 if(!STAGES.includes(v.stage)||!['active','excluded'].includes(v.state))p.push('Select a supported stage and retained-photo status.');
 return p.length?fail('VALIDATION',p):{ok:true,fields:copy(v)};
}
function readRevision(v){
 if(!safeData(v).ok||!shape(v,['kind','recordVersion','photoId','revisionId','parentRevisionId','revisionNumber','jobId','jobRevisionId','createdAt','savedAt','producer','details','file','changeReason']))return fail('CORRUPT','Photo revision shape is unsupported.');
 if(v.kind!==KIND||v.recordVersion!==VERSION)return fail('UNSUPPORTED','Unsupported photo revision version.');
 const f=validateFields(v.details),file=validateFile(v.file),initial=v.revisionNumber===1;
 if(!f.ok||!file.ok)return fail('CORRUPT',!f.ok?f.problems:file.problems);
 if(![[v.photoId,ID],[v.revisionId,REV_ID],[v.jobId,JOB_ID],[v.jobRevisionId,JOB_REV_ID]].every(([x,re])=>typeof x==='string'&&re.test(x))||!Number.isSafeInteger(v.revisionNumber)||v.revisionNumber<1||v.revisionNumber>MAX_REVISIONS||!utc(v.createdAt)||!utc(v.savedAt))return fail('CORRUPT','Invalid photo identity or revision timestamps.');
 if(initial?v.parentRevisionId!==null||v.createdAt!==v.savedAt||v.changeReason!=='':typeof v.parentRevisionId!=='string'||!REV_ID.test(v.parentRevisionId)||v.parentRevisionId===v.revisionId||typeof v.changeReason!=='string'||!v.changeReason.trim()||v.changeReason.length>1000)return fail('CORRUPT','Invalid photo parent or change explanation.');
 if(!shape(v.producer,['applicationRevision','recordContractRevision'])||typeof v.producer.applicationRevision!=='string'||!v.producer.applicationRevision.trim()||v.producer.applicationRevision.length>160||v.producer.recordContractRevision!==1)return fail('CORRUPT','Unsupported photo producer metadata.');
 return {ok:true,revision:copy(v)};
}
function make(fields,file,meta,current,reason){
 if(!safeData(meta).ok||!shape(meta,current?['revisionId','jobRevisionId','savedAt']:['photoId','revisionId','jobId','jobRevisionId','savedAt']))return fail('VALIDATION','Invalid photo metadata.');
 const f=validateFields(fields);if(!f.ok)return f;
 let old=null;if(current){const r=readRevision(current);if(!r.ok)return r;old=r.revision;file=old.file;}
 const checked=validateFile(file);if(!checked.ok)return checked;
 if(!utc(meta.savedAt)||typeof meta.revisionId!=='string'||!REV_ID.test(meta.revisionId)||typeof meta.jobRevisionId!=='string'||!JOB_REV_ID.test(meta.jobRevisionId))return fail('VALIDATION','Invalid revision metadata.');
 if(old&&FIELDS.every(k=>old.details[k]===f.fields[k]))return {ok:true,revision:old,unchanged:true};
 if(old&&old.revisionNumber>=MAX_REVISIONS)return fail('LIMIT','Maximum photo metadata versions reached.');
 if(old&&(typeof reason!=='string'||!reason.trim()||reason.length>1000))return fail('VALIDATION','Give a reason for changing photo details (maximum 1000 characters).');
 return readRevision({kind:KIND,recordVersion:VERSION,photoId:old?old.photoId:meta.photoId,revisionId:meta.revisionId,parentRevisionId:old?old.revisionId:null,revisionNumber:old?old.revisionNumber+1:1,jobId:old?old.jobId:meta.jobId,jobRevisionId:meta.jobRevisionId,createdAt:old?old.createdAt:meta.savedAt,savedAt:meta.savedAt,producer:copy(PRODUCER),details:f.fields,file:checked.file,changeReason:old?reason:''});
}
function sameFile(a,b){return FILE_FIELDS.every(k=>a[k]===b[k]);}
function assemble(rows,jobId){
 if(!Array.isArray(rows)||rows.length>MAX_JOB_ROWS)return fail('LIMIT','Photo history exceeds its supported limit.');
 const groups=new Map(),ids=new Set();
 for(const row of rows){const r=readRevision(row);if(!r.ok)return r;const v=r.revision;if(v.jobId!==jobId||ids.has(v.revisionId))return fail('CORRUPT','Photo job or revision identity mismatch.');ids.add(v.revisionId);if(!groups.has(v.photoId))groups.set(v.photoId,[]);groups.get(v.photoId).push(v);}
 if(groups.size>MAX_PHOTOS)return fail('LIMIT','Too many photos for this job.');
 const photos=[];for(const revisions of groups.values()){revisions.sort((a,b)=>a.revisionNumber-b.revisionNumber);for(let i=0;i<revisions.length;i++){const r=revisions[i],p=revisions[i-1];if(r.revisionNumber!==i+1||r.parentRevisionId!==(p?p.revisionId:null)||r.createdAt!==revisions[0].createdAt||!sameFile(r.file,revisions[0].file))return fail('CORRUPT','Photo history is missing, branched or attempted to replace original file metadata.');}photos.push({current:revisions[revisions.length-1],history:revisions.slice().reverse()});}
 photos.sort((a,b)=>a.current.createdAt===b.current.createdAt?a.current.photoId.localeCompare(b.current.photoId):a.current.createdAt>b.current.createdAt?-1:1);return {ok:true,photos};
}
module.exports={KIND,ASSET_KIND,VERSION,PRODUCER,STAGES,FIELDS,FILE_FIELDS,ID,REV_ID,JOB_ID,MAX_FILE_BYTES,MAX_PIXELS,MAX_DIMENSION,MAX_PHOTOS,MAX_TOTAL_PHOTOS,MAX_JOB_BYTES,MAX_TOTAL_BYTES,MAX_REVISIONS,MAX_JOB_ROWS,MAX_TOTAL_ROWS,safeData,shape,formatBytes,dimensions,sameFile,validateFile,validateFields,readRevision,assemble,
 createInitial:(fields,file,meta)=>make(fields,file,meta,null,''),createUpdate:(current,fields,reason,meta)=>make(fields,null,meta,current,reason)};
