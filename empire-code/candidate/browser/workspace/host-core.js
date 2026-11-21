'use strict';
// Integration hook only. Original engine/storage implementations stay in mobile.html.
(function(){
 let batch;const own=x=>JSON.parse(JSON.stringify(x));
 const read=id=>lcJobCall('read',[id]);
 const store=()=>batch||(batch=EC.jobVoiceBatch.createBatchStore(indexedDB,{crypto,locks:navigator.locks,readJob:read}));
 const hasDraft=()=>!!(LC_JOB.editor||lcMeasHasDraft()||lcMatHasDraft()||lcPhotoHasDraft()||LC_ARC.busy||LC_RESTORE.busy);
 window.ecHostBridge={
  ready:true,list:()=>lcJobCall('list',[]),read,
  create:fields=>lcJobCall('create',[own(fields),[]]),
  materials:id=>lcMatStore().list(id),
  prepare:input=>EC.jobConversationHandoff.prepare(own(input),{crypto}),
  commit:(handoff,input,confirmation)=>EC.jobConversationHandoff.commit(own(handoff),own(input),own(confirmation),{crypto,batchStore:store()}),
  inspect:id=>store().inspect(id),hasDraft,
  material:(jobId,id)=>lcMatStore().read(jobId,id),
  prepareEdit:input=>EC.conversationMaterialEdit.prepare(own(input),{crypto}),
  commitEdit:(plan,source,confirmation)=>EC.conversationMaterialEdit.commit(own(plan),own(source),own(confirmation),{crypto,indexedDB,readJob:read}),
  async show(view,id){
   if(view==='jobs'){ecJobsOpen();if(id&&(!LC_JOB.current||LC_JOB.current.head.jobId!==id)){if(!await lcJobOpen(id))return false;}if(LC_JOB.current){await lcMatRefresh();}return true;}
   if(view==='tools'){switchTab('home',document.getElementById('mnav-home'));return true;}
   if(view==='code'){openTool('coderef');return true;}return false;
  }
 };
 // This shell uses online speech in the parent, not the old local speech pilot.
 document.getElementById('ecCapture')?.remove();
 for(const id of ['ecTryDemoBtn','ecTryUnclearBtn','ecTryMaterialsBtn','ecTryShoppingBtn','ecToolsExplain'])document.getElementById(id)?.remove();
 document.querySelectorAll('.ec-preview-notice,.ec-demo-button,.ec-link-button').forEach(e=>{if(!e.closest('#lcJobWork'))e.remove();});
 ecWorkPending=function(){};
 window.parent.postMessage({type:'empire-workspace-ready'},location.origin);
})();
