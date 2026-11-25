/* One worker per selected recording. Each decoder sees byte zero through EOF in order. */
'use strict';
async function bytesFor(t,start,end){
 if(t.whole)return t.whole.subarray(start,end);
 const chunks=[];let pos=start;
 while(pos<end){
  const r=await fetch(t.url,{headers:{Range:'bytes='+pos+'-'+(end-1)}});
  if(t.local&&r.headers.get('etag')!=='"'+t.digest+'"')throw Error('The rehearsal audio index is out of date.');
  if(r.status===200){
   const data=new Uint8Array(await r.arrayBuffer());if(data.length!==t.bytes)throw Error('Incomplete rehearsal file.');
   t.whole=data;return data.subarray(start,end);
  }
  const m=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range')||'');
  if(r.status!==206||!m||+m[1]!==pos||+m[2]>=end||+m[3]!==t.bytes)throw Error('Invalid rehearsal audio range.');
  const data=new Uint8Array(await r.arrayBuffer());if(data.length!==+m[2]-pos+1)throw Error('Interrupted rehearsal audio.');
  chunks.push(data);pos+=data.length;
 }
 if(chunks.length===1)return chunks[0];
 const joined=new Uint8Array(end-start);let at=0;for(const b of chunks){joined.set(b,at);at+=b.length;}return joined;
}
async function read(t,round){
 const end=t.ends[round];if(end===t.pos)return null;
 let data;try{data=await bytesFor(t,t.pos,end);}catch{data=await bytesFor(t,t.pos,end);}
 const output=await t.decoder.decode(data),last=end===t.bytes;
 const blocks=[output];if(last&&t.format==='flac')blocks.push(await t.decoder.flush());
 let count=blocks.reduce((n,b)=>n+b.samplesDecoded,0);
 // A final FLAC frame can be shorter than the parser's sync lookahead. Decode its actual bytes.
 if(last&&t.finalPacket&&t.frames-t.framesDone-count===t.finalPacket[1]&&t.finalPacket[0]>=t.pos){
  const tail=await t.decoder.decodeFrames([data.subarray(t.finalPacket[0]-t.pos)]);blocks.push(tail);count+=tail.samplesDecoded;
 }
 if(blocks.some(b=>b.errors?.length||b.samplesDecoded&&(b.sampleRate!==24000||b.channelData.length<t.channels))||
    t.framesDone+count>t.frames||last&&t.framesDone+count!==t.frames)throw Error('Decoded stem does not match its recording clock: '+t.id);
 const channels=Array.from({length:t.channels},(_,i)=>{
  const out=new Float32Array(count);let n=0;for(const b of blocks){if(b.samplesDecoded)out.set(b.channelData[i],n);n+=b.samplesDecoded;}return out;
 });
 const at=t.start+t.framesDone;t.framesDone+=count;t.pos=end;
 return {i:t.i,at,channels,last};
}
onmessage=async({data:{tracks}})=>{
 const decoders=[];
 try{
  for(const format of new Set(tracks.map(t=>t.format)))importScripts('vendor/'+(format==='mp3'?'mpg123':'flac')+'-decoder.min.js');
  for(const [i,t] of tracks.entries()){
   t.i=i;t.pos=t.framesDone=0;t.decoder=t.format==='mp3'?new self['mpg123-decoder'].MPEGDecoder({enableGapless:true}):new self['flac-decoder'].FLACDecoder();
   decoders.push(t.decoder);
  }
  await Promise.all(decoders.map(d=>d.ready));
  // Request short synchronized ranges on slower links; amortize round trips on fast ones.
  for(let k=0,stride=1;k<tracks[0].ends.length;){
   const first=k,began=performance.now();k=Math.min(k+stride,tracks[0].ends.length);
   let next=0;const batch=[];
   await Promise.all(Array.from({length:3},async()=>{while(next<tracks.length){const block=await read(tracks[next++],k-1);if(block)batch.push(block);}}));
   postMessage({batch,done:k===tracks[0].ends.length},batch.flatMap(b=>b.channels.map(c=>c.buffer)));
   stride=Math.min(8,2*stride,Math.max(1,Math.floor((k-first)*750/Math.max(1,performance.now()-began))));
  }
 }catch(e){postMessage({error:e.message||String(e)});}
 finally{for(const d of decoders)d.free();close();}
};
