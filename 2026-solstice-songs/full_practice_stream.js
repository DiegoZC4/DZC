/* Sample-aligned multistem delivery. Waveform previews never enter the audio graph. */
(function(root){'use strict';
function match(s,index){
 const row=index?.recordings?.[s.id+'/'+(s.referenceId||'playlist')];
 if(index?.version!==1||row?.rate!==24000||!Number.isSafeInteger(row.frames)||row.frames<=0||!Array.isArray(row.tracks)||row.tracks.length!==s.tracks.length)return null;
 return s.tracks.every((t,i)=>{const x=row.tracks[i];
  return x.id===t.id&&x.source===(t.playback?.sha256||t.sha256)&&[1,2].includes(x.channels)&&
   (t.audioUrl||t.playback?.frames===row.frames)&&(!t.playback?.src||t.playback.src.includes(x.digest.slice(0,16)))&&
   typeof x.peaks==='string'&&x.peaks.length===1336&&Array.isArray(x.ends)&&x.ends.length>0&&x.ends.at(-1)===x.bytes&&x.ends.length===row.tracks[0].ends.length;
 })?row:null;
}
function previews(row){return row.tracks.map(x=>Float32Array.from(atob(x.peaks),c=>c.charCodeAt(0)/255));}
class Stream{
 constructor(row,song,ctx,url,signal,complete,recover,idleMs=12000){
  this.frames=row.frames;this.rate=row.rate;this.available=0;this.complete=false;this.error=null;
  this.listeners=new Set();this.ends=row.tracks.map(t=>t.start);
  this.buffers=row.tracks.map(t=>ctx.createBuffer(t.channels,row.frames,row.rate));
  this.peaks=previews(row);this.bytes=this.buffers.reduce((n,b)=>n+4*b.length*b.numberOfChannels,0);
  const worker=this.worker=new Worker('full_practice_stream_worker.js');
  let idle;
  const watch=()=>{clearTimeout(idle);idle=setTimeout(()=>void fallback(Error('Stream stalled')),idleMs);};
  const clean=()=>{clearTimeout(idle);worker.terminate();signal?.removeEventListener('abort',abort);};
  const fail=e=>{this.error=e;clean();this.notify();};
  const abort=()=>fail(new DOMException('Canceled','AbortError'));
  const fallback=async e=>{
   if(this.recovering||signal?.aborted||this.complete)return;this.recovering=true;this.fallbackReason=e.message;clearTimeout(idle);worker.terminate();
   try{
    const full=await recover();if(signal?.aborted)return;
    full.buffers.forEach((b,i)=>{
     const dst=this.buffers[i],lo=this.ends[i];if(b.length!==dst.length||b.numberOfChannels!==dst.numberOfChannels)throw Error('Rehearsal file changed. Reload to retry.');
     for(let c=0;c<b.numberOfChannels;c++)if(lo<b.length)dst.copyToChannel(b.getChannelData(c).subarray(lo),c,lo);
    });
    this.ends.fill(row.frames);this.available=row.frames;this.complete=true;clean();complete(this);this.notify();
   }catch(e){if(!signal?.aborted)fail(e);}
  };
  worker.onmessage=({data})=>{if(this.error||this.recovering||this.complete)return;try{
   if(data.error)throw Error(data.error);
   for(const {i,at,channels,last} of data.batch){
    if(at!==this.ends[i]||channels.length!==this.buffers[i].numberOfChannels)throw Error('Invalid stem block.');
    for(let c=0;c<channels.length;c++)this.buffers[i].copyToChannel(channels[c],c,at);
    this.ends[i]=last?row.frames:at+channels[0].length;
   }
   const ready=Math.min(...this.ends);if(ready>this.available)watch();this.available=ready;
   if(data.done){if(this.available!==row.frames)throw Error('Incomplete rehearsal audio.');this.complete=true;clean();complete(this);}
   this.notify();
  }catch(e){void fallback(e);}};
  worker.onerror=e=>{e.preventDefault();void fallback(Error(e.message||'Decoder unavailable'));};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  worker.postMessage({tracks:row.tracks.map((t,i)=>({...t,peaks:undefined,url:url(song,song.tracks[i]),local:!song.tracks[i].audioUrl&&!song.tracks[i].playback?.src}))});watch();
 }
 notify(){for(const f of [...this.listeners])f();}
 listen(f){this.listeners.add(f);return ()=>this.listeners.delete(f);}
 wait(seconds,signal){
  const target=Math.min(this.frames,Math.ceil(Math.max(0,seconds)*this.rate));
  return new Promise((resolve,reject)=>{
   const check=()=>{const err=signal?.aborted?new DOMException('Canceled','AbortError'):this.error;
    if(!err&&this.available<target)return;this.listeners.delete(check);signal?.removeEventListener('abort',check);
    if(err)reject(err);else resolve();
   };
   this.listeners.add(check);signal?.addEventListener('abort',check,{once:true});check();
  });
 }
}
root.MeletePracticeStream={match,previews,Stream};
})(globalThis);
