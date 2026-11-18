/* Local full-recording microphone takes. No score targets, uploads or audition DB writes. */
(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('../template/loop_recorder.js'):root.MeleteRecording,common?require('../template/microphone_check.js'):root.MeleteMicrophoneCheck);if(common)module.exports=api;else root.MeleteFullPracticeRecording=api;})(globalThis,function(R,mic){
'use strict';
const DB='melete-full-song-takes-v1';
const clone=value=>JSON.parse(JSON.stringify(value));
function snapshot(o){
 if(typeof o.songId!=='string'||!o.songId||!Number.isFinite(o.sourcePosition)||o.sourcePosition<0||!Number.isFinite(o.rate)||o.rate<=0||!Number.isFinite(o.shift))throw Error('Invalid full-song recording setup');
 return {song:o.songId,sourceVersion:String(o.sourceVersion||''),sourcePosition:o.sourcePosition,rate:o.rate,transpose:o.shift,shift:o.shift,mix:clone(o.mix||[]),...(o.trackId?{trackId:o.trackId,trackName:o.trackName,instrument:o.instrument}:{})};
}
// One amplitude maximum per 40 ms of raw input. The same bins drive live and saved lanes.
class Envelope{
 constructor(rate){this.step=Math.max(1,Math.round(rate*.04));this.bins=[];this.frames=0;}
 append(pcm){let i=0;while(i<pcm.length){const k=Math.floor(this.frames/this.step),n=Math.min(pcm.length-i,this.step-this.frames%this.step);let peak=0;for(const end=i+n;i<end;i++)peak=Math.max(peak,Math.abs(pcm[i]));this.bins[k]=Math.max(this.bins[k]||0,Math.round(255*peak/32768));this.frames+=n;}}
 stored(){return {step:this.step,bins:Uint8Array.from(this.bins)};}
}
class ChunkWriter{
 constructor(store,record,{onSaved=()=>{},onError=()=>{}}={}){this.store=store;this.record=record;this.onSaved=onSaved;this.onError=onError;this.frames=0;this.savedFrames=0;this.queue=[];this.parts=[];this.pendingFrames=0;this.peak=0;this.gap=false;this.running=null;this.failed=null;this.final=null;this.envelope=new Envelope(record.sampleRate);}
 append(frame,samples,startFrame,endFrame){
  if(this.final||this.failed)return;
  const from=Math.max(frame,startFrame+this.frames),to=Math.min(frame+samples.length,endFrame);if(to<=from)return;
  if(from>startFrame+this.frames){this.gap=true;const missing=from-startFrame-this.frames;if(missing>this.record.sampleRate*30){this.fail(Error('Microphone clock jumped; partial audio retained'));return;}this.push(new Int16Array(missing));}
  const pcm=new Int16Array(to-from);for(let i=0;i<pcm.length;i++){const v=Math.max(-1,Math.min(1,Number(samples[from-frame+i])||0));pcm[i]=Math.round(v*(v<0?32768:32767));this.peak=Math.max(this.peak,Math.abs(v));}this.push(pcm);
  if(this.pendingFrames>=this.record.sampleRate)this.flushParts();
  if(this.frames-this.savedFrames>this.record.sampleRate*30)this.fail(Error('Local storage is not keeping up. The unsaved audio is retained for recovery.'));
 }
 push(pcm){if(!pcm.length)return;this.envelope.append(pcm);this.parts.push(pcm);this.pendingFrames+=pcm.length;this.frames+=pcm.length;}
 flushParts(){if(!this.pendingFrames)return;const pcm=new Int16Array(this.pendingFrames);let at=0;for(const p of this.parts){pcm.set(p,at);at+=p.length;}this.parts=[];this.pendingFrames=0;this.queue.push(pcm);this.pump();}
 fail(error){if(this.failed)return;this.failed=error;this.onError(error);}
 pump(){if(this.running||this.failed||(!this.queue.length&&!this.final))return;this.running=(async()=>{try{while(this.queue.length){const pcm=this.queue[0];this.record=await this.store.append(this.record,this.savedFrames,pcm,{finalized:false,complete:false,gap:this.gap,peak:this.peak});this.savedFrames+=pcm.length;this.queue.shift();this.onSaved(this.record);}if(this.final&&this.frames){this.record=await this.store.append(this.record,this.savedFrames,new Int16Array(0),{...this.final,seconds:this.frames/this.record.sampleRate,sourceEnd:this.record.sourcePosition+Math.max(0,this.frames/this.record.sampleRate-(this.record.latency||0)-(this.record.leadInSeconds||0))*this.record.rate,finalized:true,complete:!!this.final.complete&&!this.gap,gap:this.gap,peak:this.peak});this.final=null;this.onSaved(this.record);}}catch(e){this.fail(e);}finally{this.running=null;}})();}
 async finish(complete=false){if(this.frames<=Math.round((this.record.leadInSeconds||0)*this.record.sampleRate))return null;this.flushParts();this.final={complete,envelope:this.envelope.stored()};while(this.running)await this.running;this.pump();while(this.running)await this.running;if(this.failed)throw this.failed;return this.frames?this.record:null;}
 async retry(){this.failed=null;this.pump();while(this.running)await this.running;if(this.failed)throw this.failed;return this.record;}
 async recoveryWav(){let prefix=new Int16Array(0);if(this.savedFrames){const b=await (await this.store.wav(this.record.id)).arrayBuffer();prefix=new Int16Array(b.slice(44));}const parts=[prefix,...this.queue,...this.parts],pcm=new Int16Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){pcm.set(p,at);at+=p.length;}return new Blob([R.wavBytes(pcm,this.record.sampleRate)],{type:'audio/wav'});}
}
class Recorder{
 constructor({onState=()=>{},onError=()=>{},onSaved=()=>{},store,mediaDevices,AudioContext,createCapture,now,uuid}={}){
  this.store=store||new R.TakeStore(undefined,DB);this.onState=onState;this.onError=onError;this.onSaved=onSaved;this.mediaDevices=mediaDevices||globalThis.navigator?.mediaDevices;this.AudioContext=AudioContext||globalThis.AudioContext;this.createCapture=createCapture||R.PcmCapture.create.bind(R.PcmCapture);this.now=now||Date.now;this.uuid=uuid||(()=>globalThis.crypto.randomUUID());this.state='idle';this.generation=0;this.owned=null;this.recoverable=null;this.stopping=null;
 }
 setState(state){this.state=state;this.onState(state);}
 async devices(){if(!this.mediaDevices?.enumerateDevices)return [];return (await this.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput').map(d=>({deviceId:d.deviceId,label:d.label}));}
 async prepare(options){
  if(this.state!=='idle'||this.recoverable)throw Error('Finish or recover the current recording first');const data=snapshot(options),token=++this.generation;this.setState('preparing');let owned={data,playbackContext:options.playbackContext,capture:null,stream:null,context:null,source:null,writer:null,startFrame:null,endFrame:null};this.owned=owned;
  try{
   await this.store.open();if(!this.mediaDevices?.getUserMedia)throw Error('Microphone access requires HTTPS or localhost');
   owned.stream=await this.mediaDevices.getUserMedia({...mic.rawAudioConstraints(options.deviceId),video:false});
   if(token!==this.generation)throw new DOMException('Recording canceled','AbortError');
   owned.data.captureProfile=mic.verifyRawInput(owned.stream);
   owned.context=new this.AudioContext({latencyHint:'interactive',sampleRate:48000});await owned.context.resume();owned.source=owned.context.createMediaStreamSource(owned.stream);
   owned.capture=await this.createCapture(owned.context,owned.source,(frame,samples)=>{if(this.owned!==owned||owned.startFrame===null)return;owned.writer?.append(frame,samples,owned.startFrame,owned.endFrame);if(frame+samples.length>=owned.endFrame&&this.state==='recording')void this.stop({complete:true}).catch(()=>{});},error=>this.interrupted(error));
   if(token!==this.generation)throw new DOMException('Recording canceled','AbortError');
   const track=owned.stream.getAudioTracks()[0];if(track)track.contentHint='music';
   owned.latency=Math.max(0,Number(track?.getSettings?.().latency)||0)+Math.max(0,Number(options.playbackContext?.baseLatency)||0)+Math.max(0,Number(options.playbackContext?.outputLatency)||0);
   owned.stream.getAudioTracks().forEach(t=>t.onended=()=>this.interrupted(Error('Microphone disconnected; partial take retained')));
   owned.context.onstatechange=()=>{if(this.state==='recording'&&owned.context.state!=='running')this.interrupted(Error('Microphone interrupted; partial take retained'));};
   this.setState('prepared');return {latency:owned.latency,sampleRate:owned.context.sampleRate,context:owned.context,source:owned.source,track};
  }catch(e){await this.release(owned);if(this.owned===owned)this.owned=null;if(token===this.generation)this.setState('idle');throw e;}
 }
 startAt({playbackAt,sourcePosition,maxSeconds,pickupSeconds=0}){
  const o=this.owned;if(this.state!=='prepared'||!o||!Number.isFinite(playbackAt)||!Number.isFinite(maxSeconds)||maxSeconds<=0)throw Error('Recording is not prepared');
  if(!o.playbackContext||!Number.isFinite(o.playbackContext.currentTime))throw Error('Missing shared playback clock');
  const delay=playbackAt-o.playbackContext.currentTime;if(delay<-.02)throw Error('Recording start time has already passed');
  if(Number.isFinite(sourcePosition)){if(sourcePosition<0)throw Error('Invalid source position');o.data.sourcePosition=sourcePosition;}
  const sr=o.context.sampleRate,punchFrame=Math.round((o.context.currentTime+Math.max(0,delay))*sr);
  const pickupFrames=Math.round(Math.max(0,Math.min(.18,pickupSeconds,delay))*sr);
  o.startFrame=punchFrame-pickupFrames;o.endFrame=punchFrame+Math.round(maxSeconds*sr);
  const record={...o.data,id:this.uuid(),createdAt:this.now(),sampleRate:sr,seconds:maxSeconds+pickupFrames/sr,frames:0,leadInSeconds:pickupFrames/sr,latency:o.latency,latencyKind:'browser-estimate',label:'Full-song practice',part:'Microphone',finalized:false,complete:false,favorite:false,sourceClock:'recording-seconds',recordingSchema:1};
  o.writer=new ChunkWriter(this.store,record,{onSaved:this.onSaved,onError:e=>this.interrupted(e)});this.setState('recording');return {startFrame:o.startFrame,endFrame:o.endFrame,sampleRate:o.context.sampleRate,latency:o.latency,id:record.id};
 }
 interrupted(error){this.onError(error);if(this.state==='recording')void this.stop({complete:false}).catch(()=>{});}
 async stop({complete=false,cancelLead=false}={}){
  if(this.stopping)return this.stopping;const o=this.owned;if(!o)return null;if(this.state==='preparing'){await this.cancel();return null;}
  if(cancelLead&&o.writer)o.endFrame=Math.min(o.endFrame,o.startFrame+Math.round(o.writer.record.leadInSeconds*o.context.sampleRate));
  this.setState('saving');this.stopping=(async()=>{let result=null;try{await o.capture?.stop();if(o.writer)result=await o.writer.finish(complete&&o.writer.frames>=o.endFrame-o.startFrame);return result;}catch(e){this.recoverable=o.writer;this.onError(e);throw e;}finally{await this.release(o);if(this.owned===o)this.owned=null;this.stopping=null;this.setState(this.recoverable?'recovery':'idle');}})();return this.stopping;
 }
 async cancel(){const o=this.owned;++this.generation;if(this.state==='recording'||this.state==='saving')return this.stop({complete:false});this.owned=null;if(o)await this.release(o);this.setState('idle');return null;}
 async release(o){if(!o)return;try{await o.capture?.stop();}catch{}try{o.source?.disconnect();}catch{}o.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});if(o.context){o.context.onstatechange=null;if(o.context.state!=='closed')try{await o.context.close();}catch{}}}
 async load(songId){await this.store.purgeDeleted(songId);return (await this.store.list(songId)).sort((a,b)=>b.createdAt-a.createdAt);}
 async saveTrack(track,patch={}){
  return this.store.transaction(['takes'],'readwrite',(tx,done,fail)=>{
   const s=tx.objectStore('takes');s.get(track.id).onsuccess=({target:{result:old}})=>{
    if(old&&(old.song!==track.song||old.type!=='track'||old.deleteAfter)){fail(Error('Track changed in another tab'));return;}
    const {id,song,name,instrument,on,level,createdAt}=track;
    s.put({...{id,song,name,instrument,on,level,createdAt,type:'track'},...old,...patch});done(true);
   };
  });
 }
 async setClipGain(clip,gainDb){
  if(!Number.isFinite(gainDb)||Math.abs(gainDb)>30)throw Error('Clip gain must be between -30 and +30 dB.');
  return this.store.transaction(['takes'],'readwrite',(tx,done,fail)=>{
   const store=tx.objectStore('takes');store.get(clip.id).onsuccess=({target:{result:t}})=>{
    if(!t||t.type==='track'||t.deleteAfter||!t.frames||t.song!==clip.song||t.trackId!==clip.trackId||
       t.sourceVersion!==clip.sourceVersion||t.frames!==clip.frames||(t.gainDb??0)!==(clip.gainDb??0)){
     fail(Error('Recording changed. Reopen its clip gain before editing.'));return;
    }
    store.put({...t,gainDb});done(true);
   };
  });
 }
 async deleteTrack(song,id){
  const until=this.now()+R.DELETE_UNDO_MS;
  return this.store.transaction(['takes'],'readwrite',(tx,done)=>{
   tx.objectStore('takes').index('song').openCursor(song).onsuccess=({target:{result:c}})=>{
    if(!c)return;const t=c.value;
    if(!t.deleteAfter&&(t.id===id||(t.trackId||'legacy:'+t.id)===id))c.update({...t,deleteAfter:until,deleteFavorite:true});
    c.continue();
   };done(until);
  });
 }
 async readEnvelope(clip){
  if(clip.envelope)return clip.envelope;
  const env=new Envelope(clip.sampleRate),wav=await (await this.wav(clip.id)).arrayBuffer();
  env.append(new Int16Array(wav,44));const envelope=env.stored();
  await this.store.transaction(['takes'],'readwrite',tx=>{const store=tx.objectStore('takes');store.get(clip.id).onsuccess=({target:{result:t}})=>{if(t&&!t.deleteAfter&&t.frames===clip.frames&&t.finalized)store.put({...t,envelope});};});
  return envelope;
 }
 async remove(songId,id){return this.store.stageDelete(songId,id,this.now(),{includeFavorites:true});}
 async undo(songId){return this.store.undoDeletes(songId,this.now());}
 async favorite(id,value){return this.store.favorite(id,!!value);}
 async wav(id){return this.store.wav(id);}
 recovery(){return this.recoverable?{record:this.recoverable.record,frames:this.recoverable.frames,savedFrames:this.recoverable.savedFrames,error:this.recoverable.failed?.message}:null;}
 async recoveryWav(){if(!this.recoverable)throw Error('No recovery recording');return this.recoverable.recoveryWav();}
 async retry(){if(!this.recoverable)return null;const r=await this.recoverable.retry();this.recoverable=null;this.setState('idle');return r;}
}
return {DB,snapshot,Envelope,ChunkWriter,Recorder};
});
