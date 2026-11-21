'use strict';
/** Separate native photo database. Asset + first revision commit atomically; originals are add-only. */
const M=require('./jobPhoto.js'), Media=require('./jobPhotoFile.js'), Job=require('./jobCard.js');
const DB_NAME='empire_code_photos',DB_VERSION=1,STORES=['assets','revisions'];
const fail=(code,p,extra)=>Object.assign({ok:false,code,problems:Array.isArray(p)?p:[p]},extra||{});
const validJob=id=>typeof id==='string'&&M.JOB_ID.test(id);
function err(e){let n;try{n=e&&e.name;}catch(_){}return fail(n==='QuotaExceededError'?'QUOTA':n==='VersionError'?'UNSUPPORTED':n==='ConstraintError'?'COLLISION':n==='AbortError'?'ABORTED':'UNAVAILABLE','Photo storage operation failed'+(n?' ('+n+').':'.'));}
function assetRead(a){
 try{
  if(!M.shape(a,['kind','recordVersion','photoId','jobId','file','blob'])||a.kind!==M.ASSET_KIND||a.recordVersion!==1)return fail('CORRUPT','Unsupported original-photo record.');
  if(typeof a.photoId!=='string'||!M.ID.test(a.photoId)||!validJob(a.jobId))return fail('CORRUPT','Original-photo identity is invalid.');
  const file=M.validateFile(a.file);if(!file.ok)return fail('CORRUPT',file.problems);
  const blob=Blob.prototype.slice.call(a.blob,0,a.blob.size,a.blob.type);
  if(blob.size!==file.file.bytes||blob.type!==file.file.mediaType)return fail('CORRUPT','Original photo size/type differs from its saved metadata.');
  return {ok:true,asset:{kind:a.kind,recordVersion:1,photoId:a.photoId,jobId:a.jobId,file:file.file,blob}};
 }catch(_){return fail('CORRUPT','Unreadable original-photo asset.');}
}
function createPhotoStore(indexedDB,options){
 const opts=options||{};let db=null,pending=null,closed=false;
 const unavailable=()=>fail('UNAVAILABLE','Photo storage is unavailable. Reopen the app to reconnect.');
 function closeDb(d){try{if(d)d.close();}catch(_){}}
 function close(){closed=true;if(pending&&pending.cancel)pending.cancel();closeDb(db);db=null;}
 function open(){
  if(closed)return Promise.resolve(unavailable());if(db)return Promise.resolve({ok:true,db});if(pending)return pending.promise;
  const holder={};pending=holder;holder.promise=new Promise(resolve=>{
   let done=false,abandoned=false,req,upgradeFailure;
   const finish=r=>{if(!done){done=true;if(pending===holder)pending=null;resolve(r);}};holder.cancel=()=>{abandoned=true;finish(unavailable());};
   try{
    if(!indexedDB||typeof indexedDB.open!=='function'){finish(unavailable());return;}req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onblocked=()=>{abandoned=true;finish(fail('BLOCKED','Another window is blocking photo storage. Close it and retry.'));};
    req.onupgradeneeded=e=>{
     if(done||abandoned||closed){try{req.transaction.abort();}catch(_){}return;}
     try{if(e.oldVersion!==0||req.result.objectStoreNames.length!==0){upgradeFailure=fail('UNSUPPORTED','No photo database migration or repair was attempted.');req.transaction.abort();return;}
      const a=req.result.createObjectStore('assets',{keyPath:'photoId'});a.createIndex('byJobId','jobId',{unique:false});
      const r=req.result.createObjectStore('revisions',{keyPath:'revisionId'});r.createIndex('byJobId','jobId',{unique:false});r.createIndex('byPhotoId','photoId',{unique:false});
     }catch(error){upgradeFailure=err(error);try{req.transaction.abort();}catch(_){}}
    };
    req.onerror=()=>finish(upgradeFailure||err(req.error));
    req.onsuccess=()=>{const d=req.result;if(done||abandoned||closed){closeDb(d);finish(unavailable());return;}if(d.version!==1||d.objectStoreNames.length!==2||!STORES.every(n=>d.objectStoreNames.contains(n))){closeDb(d);finish(fail('CORRUPT','Photo database schema is unsupported.'));return;}db=d;db.onversionchange=close;db.onclose=()=>{if(db===d){db=null;closed=true;}};finish({ok:true,db});};
   }catch(e){finish(err(e));}
  });return holder.promise;
 }
 function transaction(d,mode,action){
  if(closed||d!==db)return Promise.resolve(unavailable());
  return new Promise(resolve=>{let tx,outcome,failure,settled=false;
   const ctx={failed:false,finish(v){if(!ctx.failed)outcome=v;},abort(v){if(settled||ctx.failed)return;failure=v;ctx.failed=true;try{tx.abort();}catch(_){settled=true;resolve(failure);}},request(r,cb){r.onsuccess=()=>{if(!settled&&!ctx.failed)try{cb(r.result);}catch(e){ctx.abort(err(e));}};r.onerror=()=>{failure=err(r.error);ctx.failed=true;};}};
   try{tx=d.transaction(STORES,mode);tx.oncomplete=()=>{if(!settled){settled=true;resolve(failure||outcome||fail('CORRUPT','Photo transaction completed without a result.'));}};tx.onabort=()=>{if(!settled){settled=true;resolve(failure||err(tx.error||{name:'AbortError'}));}};tx.onerror=e=>{if(!failure)failure=err(tx.error||e&&e.target&&e.target.error);};
    const assets=tx.objectStore('assets'),revisions=tx.objectStore('revisions');
    for(const[store,key,indexes]of [[assets,'photoId',[['byJobId','jobId']]],[revisions,'revisionId',[['byJobId','jobId'],['byPhotoId','photoId']]]]){
     if(store.keyPath!==key||store.autoIncrement||store.indexNames.length!==indexes.length){ctx.abort(fail('CORRUPT','Unsupported photo store keys.'));return;}
     for(const[name,field]of indexes){if(!store.indexNames.contains(name)){ctx.abort(fail('CORRUPT','Missing photo index.'));return;}const i=store.index(name);if(i.keyPath!==field||i.unique||i.multiEntry){ctx.abort(fail('CORRUPT','Unsupported photo index.'));return;}}
    }action(assets,revisions,ctx);
   }catch(e){if(tx)ctx.abort(err(e));else{settled=true;resolve(err(e));}}
  });
 }
 function load(assets,revisions,ctx,jobId,done){
  const originals=new Map(),rows=[],groups=new Map();let totalRows,jobIndexed,photoIndexed,assetIndexed,bytes=0,ready=0,seenAssets=0;
  function check(){
   if(++ready!==7||ctx.failed)return;
   if(![totalRows,jobIndexed,photoIndexed,assetIndexed].every(n=>Number.isSafeInteger(n)&&n>=0)||totalRows!==jobIndexed||totalRows!==photoIndexed||assetIndexed!==originals.size)return ctx.abort(fail('CORRUPT','Non-indexable photo data exists. Nothing was silently hidden or repaired.'));
   if(totalRows>M.MAX_TOTAL_ROWS||bytes>M.MAX_TOTAL_BYTES)return ctx.abort(fail('LIMIT','Photo collection exceeds its supported capacity.'));
   if(groups.size!==originals.size)return ctx.abort(fail('CORRUPT','An original or photo history is missing. No partial archive was returned.'));
   for(const[id,group]of groups){const a=originals.get(id);if(!a||a.jobId!==group.jobId||group.count>M.MAX_REVISIONS)return ctx.abort(fail('CORRUPT','A photo identity has missing, foreign or excessive history.'));}
   const assembled=M.assemble(rows,jobId);if(!assembled.ok)return ctx.abort(assembled);
   let jobBytes=0,jobCount=0;for(const a of originals.values())if(a.jobId===jobId){jobBytes+=a.file.bytes;jobCount++;}
   if(jobCount>M.MAX_PHOTOS||jobBytes>M.MAX_JOB_BYTES)return ctx.abort(fail('LIMIT','This job exceeds the supported photo capacity.'));
   if(jobCount!==assembled.photos.length)return ctx.abort(fail('CORRUPT','A job photo has no complete metadata history.'));
   for(const p of assembled.photos){const a=originals.get(p.current.photoId),g=groups.get(p.current.photoId);if(!a||!M.sameFile(a.file,p.current.file)||g.count!==p.history.length)return ctx.abort(fail('CORRUPT','Photo asset and complete history disagree.'));}
   done({ok:true,photos:assembled.photos,originals,totalRows,totalBytes:bytes,jobBytes,jobCount});
  }
  ctx.request(revisions.count(),v=>{totalRows=v;check();});ctx.request(revisions.index('byJobId').count(),v=>{jobIndexed=v;check();});ctx.request(revisions.index('byPhotoId').count(),v=>{photoIndexed=v;check();});ctx.request(assets.index('byJobId').count(),v=>{assetIndexed=v;check();});
  ctx.request(assets.openCursor(),c=>{if(!c){check();return;}if(++seenAssets>M.MAX_TOTAL_PHOTOS)return ctx.abort(fail('LIMIT','Too many original photos.'));
   const a=assetRead(c.value);if(!a.ok)return ctx.abort(a);if(a.asset.photoId!==c.primaryKey)return ctx.abort(fail('CORRUPT','Original-photo key mismatch.'));originals.set(a.asset.photoId,a.asset);bytes+=a.asset.file.bytes;if(bytes>M.MAX_TOTAL_BYTES)return ctx.abort(fail('LIMIT','Total photo byte limit exceeded.'));c.continue();});
  let groupCount=0;ctx.request(revisions.index('byPhotoId').openCursor(undefined,'nextunique'),c=>{
   if(!c){check();return;}if(++groupCount>M.MAX_TOTAL_PHOTOS||typeof c.key!=='string'||!M.ID.test(c.key)||!c.value||!validJob(c.value.jobId))return ctx.abort(fail('CORRUPT','Invalid photo history identity.'));
   const id=c.key,owner=c.value.jobId;ctx.request(revisions.index('byPhotoId').count(id),count=>{groups.set(id,{jobId:owner,count});c.continue();});
  });
  ctx.request(revisions.index('byJobId').openCursor(jobId),c=>{if(!c){check();return;}if(rows.length>=M.MAX_JOB_ROWS)return ctx.abort(fail('LIMIT','Photo history exceeds the per-job limit.'));if(!c.value||c.value.revisionId!==c.primaryKey||c.value.jobId!==c.key)return ctx.abort(fail('CORRUPT','Photo revision storage key mismatch.'));rows.push(c.value);c.continue();});
 }
 async function verifyJob(jobId){try{if(typeof opts.readJob!=='function')return fail('UNAVAILABLE','Job reader unavailable.');const r=await opts.readJob(jobId);if(!r||!r.ok||!r.job)return fail('JOB_UNAVAILABLE','Saved job is unavailable. Photo was not saved.');const h=Job.readHead(r.job.head),v=Job.readRevision(r.job.revision);if(!h.ok||!v.ok||h.head.jobId!==jobId||v.revision.jobId!==jobId||h.head.currentRevisionId!==v.revision.revisionId||h.head.revisionNumber!==v.revision.revisionNumber)return fail('JOB_UNAVAILABLE','Linked job metadata is inconsistent.');return {ok:true,revisionId:v.revision.revisionId};}catch(_){return fail('JOB_UNAVAILABLE','Linked job could not be read.');}}
 function random(prefix){if(!opts.crypto||typeof opts.crypto.getRandomValues!=='function')throw Error();const b=new Uint8Array(16);opts.crypto.getRandomValues(b);return prefix+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}
 async function write(jobId,photoId,expectedRevisionId,fields,file,reason){
  try{
   if(!validJob(jobId)||photoId!==null&&(typeof photoId!=='string'||!M.ID.test(photoId)||typeof expectedRevisionId!=='string'||!M.REV_ID.test(expectedRevisionId)))return fail('VALIDATION','Valid job/photo identities required.');
   const f=M.validateFields(fields);if(!f.ok)return f;if(typeof reason!=='string'||reason.length>1000)return fail('VALIDATION','Change explanation must be text up to 1000 characters.');
   // Metadata copy and File snapshot precede all asynchronous parent/database work.
   const input=f.fields,capturedReason=reason;let prepared=null;
   if(photoId===null){prepared=await Media.prepare(file,{crypto:opts.crypto,decode:opts.decode});if(!prepared.ok)return prepared;}
   let id=photoId||random('photo1_'),revisionId=random('prev1_');const job=await verifyJob(jobId);if(!job.ok)return job;const opened=await open();if(!opened.ok)return opened;
   for(let attempt=0;attempt<5;attempt++){
    if(attempt){id=photoId||random('photo1_');revisionId=random('prev1_');}const savedAt=typeof opts.now==='function'?opts.now():new Date().toISOString();
    const result=await transaction(opened.db,'readwrite',(a,r,ctx)=>load(a,r,ctx,jobId,ledger=>{
     let made;if(photoId!==null){const entry=ledger.photos.find(p=>p.current.photoId===id);if(!entry)return ctx.abort(fail('NOT_FOUND','Photo is not part of this job.'));if(entry.current.revisionId!==expectedRevisionId)return ctx.abort(fail('CONFLICT','Photo details changed in another window. Your draft is kept.',{currentRevisionId:entry.current.revisionId}));if(revisionId===entry.current.revisionId)return ctx.abort(fail('COLLISION','Photo revision ID already exists.'));
      made=M.createUpdate(entry.current,input,capturedReason,{revisionId,jobRevisionId:job.revisionId,savedAt});if(made.ok&&made.unchanged){ctx.finish({ok:true,revision:made.revision,unchanged:true});return;}
     }else{
      if(ledger.originals.has(id))return ctx.abort(fail('COLLISION','Photo ID already exists.'));
      if(ledger.jobCount>=M.MAX_PHOTOS||ledger.originals.size>=M.MAX_TOTAL_PHOTOS||ledger.jobBytes+prepared.file.bytes>M.MAX_JOB_BYTES||ledger.totalBytes+prepared.file.bytes>M.MAX_TOTAL_BYTES)return ctx.abort(fail('LIMIT','Photo count or byte limit reached. Excluded photos are retained and still count.'));
      made=M.createInitial(input,prepared.file,{photoId:id,revisionId,jobId,jobRevisionId:job.revisionId,savedAt});
     }
     if(!made.ok)return ctx.abort(made);if(ledger.totalRows>=M.MAX_TOTAL_ROWS||ledger.photos.reduce((n,p)=>n+p.history.length,0)>=M.MAX_JOB_ROWS)return ctx.abort(fail('LIMIT','Photo metadata history limit reached.'));
     if(photoId===null)ctx.request(a.add({kind:M.ASSET_KIND,recordVersion:1,photoId:id,jobId,file:prepared.file,blob:prepared.blob}),()=>{});
     ctx.request(r.add(made.revision),()=>{});ctx.finish({ok:true,revision:made.revision});
    }));if(result.code!=='COLLISION')return result;
   }return fail('COLLISION','No unique photo identity after five attempts. No existing data was overwritten.');
  }catch(_){return fail('UNAVAILABLE','Photo save could not start. Existing data and your draft are unchanged.');}
 }
 async function operation(jobId,photoId,withBlob){
  if(!validJob(jobId)||photoId!==null&&(typeof photoId!=='string'||!M.ID.test(photoId)))return fail('VALIDATION','Valid job/photo identities required.');
  const opened=await open();if(!opened.ok)return opened;
  return transaction(opened.db,'readonly',(a,r,ctx)=>load(a,r,ctx,jobId,ledger=>{
   if(photoId===null){ctx.finish({ok:true,photos:ledger.photos,bytes:ledger.jobBytes});return;}
   const entry=ledger.photos.find(p=>p.current.photoId===photoId);if(!entry){ctx.finish(fail('NOT_FOUND','This photo is unavailable for the selected job.'));return;}
   ctx.finish({ok:true,...entry,...(withBlob?{blob:ledger.originals.get(photoId).blob}:{})});
  }));
 }
 async function original(jobId,photoId){const r=await operation(jobId,photoId,true);if(!r.ok)return r;const verified=await Media.verify(r.blob,r.current.file,opts.crypto);return verified.ok?{ok:true,current:r.current,blob:verified.blob}:verified;}
 return {create:(jobId,fields,file)=>write(jobId,null,null,fields,file,''),update:(jobId,photoId,expected,fields,reason)=>write(jobId,photoId,expected,fields,null,reason),list:jobId=>operation(jobId,null,false),read:(jobId,photoId)=>operation(jobId,photoId,false),original,close};
}
module.exports={DB_NAME,DB_VERSION,assetRead,createPhotoStore};
