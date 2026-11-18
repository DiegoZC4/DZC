/* Bounded decoded-song LRU. No prefetch, storage migration, or microphone access. */
(function(root){'use strict';
function placeGuide(context,t,clip){
 const rate=clip.sampleRate,at=Math.round(t.startSeconds*rate),end=Math.round(t.endSeconds*rate),length=Math.round(t.timelineSeconds*rate);
 if(![at,end,length].every(Number.isSafeInteger)||at<0||end<=at||end>length||Math.abs(clip.length-(end-at))>3)throw Error('Guide does not match its recording timeline.');
 const aligned=context.createBuffer(1,length,rate);
 aligned.getChannelData(0).set(clip.getChannelData(0).subarray(0,end-at),at);
 return aligned;
}
class Loader{
 constructor({maxBytes=384*1024*1024,maxSongs=2,fetchAudio=(...args)=>globalThis.fetch(...args)}={}){this.maxBytes=maxBytes;this.maxSongs=maxSongs;this.fetchAudio=fetchAudio;this.cache=new Map();}
 key(song){return JSON.stringify([song.id,song.tracks.map(t=>[t.id,t.sha256||t.file,t.playback?.sha256,t.playback?.src,t.startSeconds,t.endSeconds,t.timelineSeconds])]);}
 async load(song,context,{signal,onProgress=()=>{}}={}){const key=this.key(song),check=()=>{if(signal?.aborted)throw new DOMException('Canceled','AbortError');};check();if(this.cache.has(key)){const entry=this.cache.get(key);this.cache.delete(key);this.cache.set(key,entry);onProgress(song.tracks.length,true);return entry;}
  const buffers=new Array(song.tracks.length);let next=0,done=0;const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  try{await Promise.all(Array.from({length:Math.min(3,song.tracks.length)},async()=>{while(next<song.tracks.length){check();const i=next++,t=song.tracks[i],p=t.playback;const query=new URLSearchParams({song:song.id,track:t.id});if(song.referenceId)query.set('ref',song.referenceId);if(p){query.set('variant','playback');query.set('v',p.sha256);}const url=t.audioUrl?t.audioUrl+'?v='+encodeURIComponent(t.sha256):(p?.src||'full-practice-audio.php?'+query);const r=await this.fetchAudio(url,{signal:controller.signal});if(!r.ok)throw Error(p?.src||t.audioUrl?'Practice audio unavailable.':'Audio unavailable; check the external media disk.');const decoded=await context.decodeAudioData(await r.arrayBuffer());check();let mono=decoded;if(decoded.numberOfChannels!==1){mono=context.createBuffer(1,decoded.length,decoded.sampleRate);const out=mono.getChannelData(0);for(let ch=0;ch<decoded.numberOfChannels;ch++){const input=decoded.getChannelData(ch);for(let j=0;j<out.length;j++)out[j]+=input[j]/decoded.numberOfChannels;}}buffers[i]=t.audioUrl?placeGuide(context,t,mono):mono;onProgress(++done,false);}}));check();
   if(Math.max(...buffers.map(b=>b.duration))-Math.min(...buffers.map(b=>b.duration))>.12)throw Error('Stem durations differ; playback withheld.');
   const peaks=buffers.map(b=>{const d=b.getChannelData(0),out=new Float32Array(1000),step=Math.ceil(d.length/1000);for(let x=0;x<1000;x++)for(let k=x*step;k<Math.min((x+1)*step,d.length);k++)out[x]=Math.max(out[x],Math.abs(d[k]));return out;});
   const bytes=buffers.reduce((n,b)=>n+b.length*b.numberOfChannels*4,0),entry={buffers,peaks,bytes};
   if(bytes<=this.maxBytes){this.cache.set(key,entry);while(this.cache.size>this.maxSongs||[...this.cache.values()].reduce((n,e)=>n+e.bytes,0)>this.maxBytes)this.cache.delete(this.cache.keys().next().value);}
   return entry;
  }catch(e){controller.abort();throw e;}finally{signal?.removeEventListener('abort',cancel);}
 }
}
root.MeleteFullPracticeLoader={Loader};if(typeof module!=='undefined')module.exports={Loader};
})(globalThis);
