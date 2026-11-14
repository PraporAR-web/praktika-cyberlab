/* Progress schema v2. All primary/backup writes share one IndexedDB transaction. */
(function(root){'use strict';
const LEGACY_KEY='karnet-practice-v1',DB_NAME='praktika-cyberlab-v2',SETTINGS_KEY='praktika-settings-v2',SIGNAL_KEY='praktika-storage-signal-v2',MAX_BACKUPS=5;
const newestBackup=(a,b)=>(b.order||0)-(a.order||0)||b.createdAt.localeCompare(a.createdAt);
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),uid=()=>root.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2),revisionOf=r=>Number.isSafeInteger(r?.revision)&&r.revision>=1?r.revision:0;
const messages={quota:'Недостаточно места в хранилище. Скачай текущую сессию, освободи место и повтори сохранение.',unavailable:'Хранилище недоступно. Скачай текущую сессию, чтобы сохранить изменения.',blocked:'Доступ к хранилищу заблокирован. Закрой старые вкладки приложения и перезагрузи страницу. Текущую сессию можно скачать.',corrupt:'Сохранение повреждено. Оно не будет заменено пустым. Скачай исходные данные или восстанови свой экспорт в «Мой прогресс».',conflict:'В другой вкладке изменены те же данные. Твоя сессия сохранена в памяти. Скачай её или загрузи общую версию с резервной копией.'};
class StoreError extends Error{constructor(code,cause){super(messages[code]||messages.unavailable);this.name='StoreError';this.code=code;this.cause=cause;}}
function classify(e){if(e instanceof StoreError)return e;return new StoreError(e?.name==='QuotaExceededError'?'quota':e?.name==='SecurityError'?'blocked':'unavailable',e);}
function makePatch(before,after){
 const fields=[],add=(path,a,b)=>{if(!same(a,b))fields.push({path,before:clone(a),after:clone(b)});};
 for(const key of ['minutes','track','active'])add([key],before[key],after[key]);
 for(const id of new Set([...Object.keys(before.statuses),...Object.keys(after.statuses)]))add(['statuses',id],before.statuses[id],after.statuses[id]);
 for(const id of new Set([...Object.keys(before.drafts),...Object.keys(after.drafts)])){
  const a=before.drafts[id],b=after.drafts[id];
  if(!b)add(['drafts',id],a,b);else{const baseline=a||{code:'',output:'',hint:0,started:false};for(const key of ['code','output','hint','started'])add(['drafts',id,key],baseline[key],b[key]);}
 }
 const old=new Set(before.events.map(e=>JSON.stringify(e)));return{fields,events:after.events.filter(e=>!old.has(JSON.stringify(e))).map(clone)};
}
function applyPatch(latest,patch){
 const result=clone(latest);
 for(const f of patch.fields){if(f.path[0]==='drafts'&&f.path.length===3&&!result.drafts[f.path[1]])result.drafts[f.path[1]]={code:'',output:'',hint:0,started:false,passed:false};let target=result;for(const key of f.path.slice(0,-1)){if(!target[key])target[key]={};target=target[key];}const key=f.path.at(-1),value=target[key];if(!same(value,f.before)&&!same(value,f.after))throw new StoreError('conflict');if(f.after===undefined)delete target[key];else target[key]=clone(f.after);}
 const seen=new Set(result.events.map(e=>JSON.stringify(e)));for(const e of patch.events){const key=JSON.stringify(e);if(!seen.has(key)){result.events.push(clone(e));seen.add(key);}}result.events=result.events.slice(-5000);return result;
}
class IndexedAdapter{
 constructor(db){this.db=db;db.onversionchange=()=>db.close();}
 static open(factory=root.indexedDB,name=DB_NAME){return new Promise((resolve,reject)=>{if(!factory)return reject(new StoreError('unavailable'));let request;try{request=factory.open(name,1);}catch(e){reject(classify(e));return;}let settled=false;request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('records'))request.result.createObjectStore('records',{keyPath:'key'});};request.onblocked=()=>{settled=true;reject(new StoreError('blocked'));};request.onerror=()=>reject(classify(request.error));request.onsuccess=()=>{if(settled)request.result.close();else resolve(new IndexedAdapter(request.result));};});}
 read(){return this._read(false);}
 list(){return this._read(true);}
 _read(all){return new Promise((resolve,reject)=>{let tx;try{tx=this.db.transaction('records','readonly');const req=all?tx.objectStore('records').getAll():tx.objectStore('records').get('progress');let value;req.onsuccess=()=>{value=req.result;};tx.oncomplete=()=>resolve(all?value.filter(r=>r.key.startsWith('backup:')).sort(newestBackup):value);tx.onabort=()=>reject(classify(tx.error));tx.onerror=()=>{};}catch(e){reject(classify(e));}});}
 mutate(fn){return new Promise((resolve,reject)=>{
  let tx,result,failure;
  try{tx=this.db.transaction('records','readwrite');const os=tx.objectStore('records'),req=os.get('progress');req.onsuccess=()=>{try{result=fn(req.result)||{};if(result.record)os.put(result.record);if(result.backups?.length){const all=os.getAll();all.onsuccess=()=>{try{const existing=all.result.filter(r=>r.key.startsWith('backup:'));let order=Math.max(0,...existing.map(b=>b.order||0));for(const b of result.backups)b.order=++order;const backups=[...result.backups,...existing].sort(newestBackup);const keep=new Set(backups.slice(0,MAX_BACKUPS).map(b=>b.key));for(const b of result.backups)os.put(b);for(const b of backups)if(!keep.has(b.key))os.delete(b.key);}catch(e){failure=e;tx.abort();}};}}catch(e){failure=e;tx.abort();}};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(classify(failure||tx.error));tx.onerror=()=>{};
  }catch(e){if(tx)try{tx.abort();}catch(_){}reject(classify(e));}
 });}
 close(){this.db.close();}
}
class ProgressStore{
 constructor(options){this.core=options.core;this.lessons=options.lessons;this.options=options;this.writer=uid();this.state=this.core.initial();this.localView=clone(this.state);this.savedLocalView=clone(this.state);this.revision=0;this.error=null;this.raw=null;this.notice='';this.pending=0;this.sequence=0;this.queue=Promise.resolve();this.listeners=new Set();this.adapter=null;this.storage=Object.prototype.hasOwnProperty.call(options,'localStorage')?options.localStorage:undefined;}
 normalize(v){return this.core.validateImport(v,this.lessons);}
 getStorage(){return this.storage===undefined?root.localStorage:this.storage;}
 validRecord(record){try{if(!record||!revisionOf(record))throw Error('revision');return this.normalize(record.state);}catch(e){throw new StoreError('corrupt',e);}}
 rawRecord(record){return{name:'praktika-damaged-record.json',text:JSON.stringify(record,null,2)};}
 snapshot(state,reason){return{key:'backup:'+uid(),kind:'snapshot',createdAt:new Date().toISOString(),reason,data:clone(state)};}
 rawBackup(raw,reason){return{key:'backup:'+uid(),kind:'raw',createdAt:new Date().toISOString(),reason,raw:raw.text};}
 record(state,previous){return{key:'progress',revision:revisionOf(previous)+1,updatedAt:new Date().toISOString(),writer:this.writer,state:clone(state)};}
 adopt(record){this.state=this.validRecord(record);this.revision=record.revision;this.localView=clone(this.state);this.savedLocalView=clone(this.state);return{state:clone(this.state),revision:this.revision};}
 async init(){
  let legacy=null,legacyError=null;
  try{const raw=this.getStorage()?.getItem(LEGACY_KEY);if(raw!==null&&raw!==undefined){this.raw={name:'praktika-legacy-original.json',text:raw};try{legacy=this.normalize(JSON.parse(raw));}catch(e){legacyError=new StoreError('corrupt',e);}}}catch(e){legacyError=classify(e);}
  try{this.adapter=this.options.adapter||await IndexedAdapter.open(this.options.indexedDB===undefined?root.indexedDB:this.options.indexedDB,this.options.dbName||DB_NAME);
   let record=await this.adapter.read();
   if(record){try{this.adopt(record);this.raw=null;}catch(e){this.raw=this.rawRecord(record);throw e;}}
   else{if(legacyError)throw legacyError;
    const outcome=await this.adapter.mutate(latest=>{if(latest){this.validRecord(latest);return{record:latest};}return{record:this.record(legacy||this.core.initial(),null),backups:legacy?[this.snapshot(legacy,'Перенос старого сохранения')]:[]};});this.adopt(outcome.record);this.raw=null;if(legacy)this.notice='Старый прогресс перенесён в новое хранилище. Исходная копия сохранена.';
   }
  }catch(e){this.error=classify(e);if(legacy){this.state=legacy;this.localView=clone(legacy);this.savedLocalView=clone(legacy);}}
  this.connect();return this;
 }
 connect(){if(this.options.broadcast===false)return;try{if(root.BroadcastChannel){this.channel=new root.BroadcastChannel('praktika-progress-v2');this.channel.onmessage=e=>{if(e.data?.writer!==this.writer)this.signal();};}}catch(_){}
  this.storageListener=e=>{if(e.key===SIGNAL_KEY)this.signal();};root.addEventListener?.('storage',this.storageListener);
 }
 subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 signal(){for(const fn of this.listeners)fn();}
 notify(){try{this.channel?.postMessage({writer:this.writer,revision:this.revision});}catch(_){}try{const storage=this.getStorage();storage?.setItem(SETTINGS_KEY,JSON.stringify({minutes:this.state.minutes,track:this.state.track}));storage?.setItem(SIGNAL_KEY,JSON.stringify({writer:this.writer,revision:this.revision,time:uid()}));}catch(_){} }
 enqueue(fn){this.pending++;const run=this.queue.catch(()=>{}).then(fn);this.queue=run;return run.catch(e=>{this.error=classify(e);throw this.error;}).finally(()=>{this.pending--;});}
 save(desired){
  let next;try{next=this.normalize(desired);}catch(e){return Promise.reject(e);}const patch=makePatch(this.localView,next),seq=++this.sequence;this.localView=clone(next);
  return this.enqueue(async()=>{if(this.error)throw this.error;if(!this.adapter)throw new StoreError('unavailable');const outcome=await this.adapter.mutate(latest=>{const state=latest?this.validRecord(latest):this.core.initial();return{record:this.record(this.normalize(applyPatch(state,patch)),latest)};});this.state=clone(outcome.record.state);this.revision=outcome.record.revision;this.savedLocalView=clone(next);if(seq===this.sequence){this.localView=clone(this.state);this.savedLocalView=clone(this.state);}this.error=null;this.notify();return{state:clone(this.state),revision:this.revision};});
 }
 retry(desired){if(!this.adapter||['corrupt','conflict','blocked'].includes(this.error?.code))return Promise.reject(this.error||new StoreError('unavailable'));this.error=null;this.localView=clone(this.savedLocalView);return this.save(desired);}
 async flush(){await this.queue;if(this.error)throw this.error;return{state:clone(this.state),revision:this.revision};}
 async inspect(){if(!this.adapter)throw this.error||new StoreError('unavailable');const record=await this.adapter.read();if(!record)return{state:this.core.initial(),revision:0};try{return{state:this.validRecord(record),revision:record.revision};}catch(e){return{state:null,revision:revisionOf(record),corrupt:true};}}
 async backups(){if(!this.adapter)throw this.error||new StoreError('unavailable');return this.adapter.list();}
 replace(candidate,{expectedRevision,reason='Перед импортом'}={}){
  let next;try{next=this.normalize(candidate);}catch(e){return Promise.reject(e);}const seq=++this.sequence,local=clone(this.localView);
  return this.enqueue(async()=>{if(!this.adapter)throw this.error||new StoreError('unavailable');const outcome=await this.adapter.mutate(latest=>{
   if(expectedRevision!==undefined&&revisionOf(latest)!==expectedRevision)throw new StoreError('conflict');const backups=[];let previous;
   if(latest){try{previous=this.validRecord(latest);backups.push(this.snapshot(previous,reason));}catch(e){backups.push(this.rawBackup(this.rawRecord(latest),'Повреждённое сохранение перед заменой'));}}
   else if(this.raw)backups.push(this.rawBackup(this.raw,'Исходные данные перед восстановлением'));
   if(!same(local,previous||this.core.initial()))backups.push(this.snapshot(local,'Локальная сессия перед заменой'));
   return{record:this.record(next,latest),backups};
  });this.state=clone(next);this.revision=outcome.record.revision;if(seq===this.sequence){this.localView=clone(next);this.savedLocalView=clone(next);}this.error=null;this.raw=null;this.notify();return{state:clone(next),revision:this.revision};});
 }
 async restore(key,expectedRevision){const backup=(await this.backups()).find(b=>b.key===key);if(!backup||backup.kind!=='snapshot')throw new StoreError('corrupt');return this.replace(backup.data,{expectedRevision,reason:'Перед восстановлением копии'});}
 reloadLatest({backupLocal=true}={}){
  const sequence=this.sequence,local=clone(this.localView);
  return this.enqueue(async()=>{if(!this.adapter)throw this.error||new StoreError('unavailable');const outcome=await this.adapter.mutate(latest=>{const state=this.validRecord(latest);return{record:latest,backups:backupLocal&&!same(local,state)?[this.snapshot(local,'Локальная сессия перед загрузкой общей версии')]:[]};});const state=this.validRecord(outcome.record);this.revision=outcome.record.revision;this.error=null;this.raw=null;if(sequence===this.sequence){this.state=state;this.localView=clone(state);this.savedLocalView=clone(state);}return{state:clone(state),revision:this.revision};});
 }
 close(){this.channel?.close();root.removeEventListener?.('storage',this.storageListener);this.adapter?.close?.();}
}
root.PracticeStore={open:options=>new ProgressStore(options).init(),ProgressStore,IndexedAdapter,StoreError,classify,makePatch,applyPatch,LEGACY_KEY,DB_NAME,MAX_BACKUPS};
})(typeof window!=='undefined'?window:globalThis);
