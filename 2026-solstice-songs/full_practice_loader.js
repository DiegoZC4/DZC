/* Bounded decoded-song LRU. No prefetch, storage migration, or microphone access. */
(function(root){'use strict';
async function bounded(signal,ms,read){
 const c=new AbortController(),cancel=()=>c.abort();let expired=false;
 if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>{expired=true;c.abort();},ms);
 try{return await read(c.signal);}catch(e){if(expired)throw new DOMException('Audio delivery timed out','TimeoutError');throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
function placeGuide(context,t,clip){
 const rate=clip.sampleRate,at=Math.round(t.startSeconds*rate),end=Math.round(t.endSeconds*rate),length=Math.round(t.timelineSeconds*rate);
 if(![at,end,length].every(Number.isSafeInteger)||at<0||end<=at||end>length||Math.abs(clip.length-(end-at))>3)throw Error('Guide does not match its recording timeline.');
 const aligned=context.createBuffer(clip.numberOfChannels,length,rate);
 for(let ch=0;ch<clip.numberOfChannels;ch++)aligned.getChannelData(ch).set(clip.getChannelData(ch).subarray(0,end-at),at);
 return aligned;
}
function waveform(buffer){
 const out=new Float32Array(1000),step=Math.ceil(buffer.length/out.length);
 for(let ch=0;ch<buffer.numberOfChannels;ch++){
  const data=buffer.getChannelData(ch);
  for(let x=0;x<out.length;x++){let peak=out[x];const end=Math.min((x+1)*step,data.length);
   for(let j=x*step;j<end;j++)peak=Math.max(peak,Math.abs(data[j]));out[x]=peak;}
 }
 return out;
}
function trackUrl(song,t){
 if(t.audioUrl)return t.audioUrl+'?v='+encodeURIComponent(t.sha256);
 const p=t.playback;if(p?.src)return p.src;
 const q=new URLSearchParams({song:song.id,track:t.id});if(song.referenceId)q.set('ref',song.referenceId);
 if(p){q.set('variant','listen');q.set('v',p.sha256);}return 'full-practice-audio.php?'+q;
}
class Loader{
 constructor({maxBytes=384*1024*1024,maxSongs=2,fetchAudio=(...args)=>globalThis.fetch(...args)}={}){this.maxBytes=maxBytes;this.maxSongs=maxSongs;this.fetchAudio=fetchAudio;this.cache=new Map();}
 key(song){return JSON.stringify([song.id,song.tracks.map(t=>[t.id,t.sha256||t.file,t.playback?.sha256,t.playback?.src,t.startSeconds,t.endSeconds,t.timelineSeconds])]);}
 remember(key,entry){
  if(entry.bytes>this.maxBytes)return;
  this.cache.delete(key);this.cache.set(key,entry);
  while(this.cache.size>this.maxSongs||[...this.cache.values()].reduce((n,e)=>n+e.bytes,0)>this.maxBytes)this.cache.delete(this.cache.keys().next().value);
 }
 open(song,ctx,index,signal){
  const key=this.key(song),row=root.MeletePracticeStream?.match(song,index),cached=this.cache.get(key);
  if(cached){this.remember(key,cached);return cached;}
  if(!row||ctx.sampleRate!==row.rate||typeof Worker==='undefined')return null;
  try{return new root.MeletePracticeStream.Stream(row,song,ctx,trackUrl,signal,entry=>this.remember(key,entry),()=>this.load(song,ctx,{signal}));}
  catch(e){if(e.name!=='SecurityError'&&e.name!=='NotSupportedError')throw e;return null;}
 }
 async audioBytes(song,t,signal){
  for(let attempt=0;;attempt++){
   try{
    return await bounded(signal,90000,async download=>{
    const r=await this.fetchAudio(trackUrl(song,t),{signal:download});
    if(!r.ok){const e=Error(t.playback?.src||t.audioUrl?'Practice audio unavailable.':'Audio unavailable; check the external media disk.');
     e.retryable=r.status>=500||[408,429].includes(r.status);throw e;}
    return r.arrayBuffer();});
   }catch(e){if(signal.aborted||attempt||!(e.retryable||['TypeError','TimeoutError'].includes(e.name)))throw e;}
  }
 }
 async load(song,context,{signal,onProgress=()=>{}}={}){const key=this.key(song),check=()=>{if(signal?.aborted)throw new DOMException('Canceled','AbortError');};check();if(this.cache.has(key)){const entry=this.cache.get(key);this.cache.delete(key);this.cache.set(key,entry);onProgress(song.tracks.length,true);return entry;}
  const buffers=new Array(song.tracks.length);let next=0,done=0;const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  try{await Promise.all(Array.from({length:Math.min(3,song.tracks.length)},async()=>{while(next<song.tracks.length){check();const i=next++,t=song.tracks[i];const decoded=await context.decodeAudioData(await this.audioBytes(song,t,controller.signal));check();buffers[i]=t.audioUrl?placeGuide(context,t,decoded):decoded;onProgress(++done,false);}}));check();
   if(Math.max(...buffers.map(b=>b.duration))-Math.min(...buffers.map(b=>b.duration))>.12)throw Error('Stem durations differ; playback withheld.');
   const peaks=buffers.map(waveform);
   const bytes=buffers.reduce((n,b)=>n+b.length*b.numberOfChannels*4,0),entry={buffers,peaks,bytes};
   this.remember(key,entry);
   return entry;
  }catch(e){controller.abort();throw e;}finally{signal?.removeEventListener('abort',cancel);}
 }
}
root.MeleteFullPracticeLoader={Loader,bounded};if(typeof module!=='undefined')module.exports=root.MeleteFullPracticeLoader;
})(globalThis);
