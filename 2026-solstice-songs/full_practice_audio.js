/* Full-length multistem adapter using the audition player's Signalsmith processor. */
(function(root){'use strict';
const CONTROL_HZ=1000,BUFFER_HZ=8000,CLOCK_RATIO=CONTROL_HZ/BUFFER_HZ;
const isVocal=id=>['vocals','vocal','harmony-vocals'].includes(id);
function vocalSplit(song,book){
 const row=book?.[song.id+'/'+(song.referenceId||'playlist')],original=song.tracks.find(t=>t.id==='vocals');
 return row&&original&&row.source===original.sha256&&row.clock===original.playback?.sha256&&
  row.lanes?.length===2&&row.lanes.every((l,i)=>l.index.id===['vocals','harmony-vocals'][i]&&
  l.index.frames===original.playback.frames&&l.index.start===0&&l.src.includes(l.index.digest.slice(0,16)))?row:null;
}
function mixerTracks(song,split){
 return [...song.tracks.flatMap(t=>t.id!=='vocals'||!split?[t]:split.lanes.map(({label,src,index:x})=>({
  id:x.id,label,sha256:x.digest,playback:{src,sha256:x.digest,frames:x.frames,sampleRate:24000,channels:x.channels}
 }))),...(song.guides||[])];
}
function splitIndex(index,song){
 const key=song.id+'/'+(song.referenceId||'playlist'),row=index?.recordings?.[key],split=song.vocalSplit;
 if(!split||!row)return index;
 if(!row.tracks.some(t=>t.id==='vocals'&&t.source===split.clock))return null;
 return {...index,recordings:{[key]:{...row,tracks:row.tracks.flatMap(t=>t.id==='vocals'?split.lanes.map(l=>l.index):[t])}}};
}
function vocalEdges(rec){
 const e=rec?.vocalBoundaries,v=rec?.tracks?.find(t=>t.id==='vocals')?.playback;
 return e&&v&&e.vocalSha256===v.sha256&&[e.onset,e.entry,e.outro].every(Number.isFinite)&&
  e.onset>=0&&e.onset<e.outro&&e.entry>=0&&e.outro>e.entry&&e.outro<=v.frames/v.sampleRate+.002?e:null;
}
function listenEnd(duration,cut,region,whole,lastDub=0){
 if(cut==null||region&&!whole)return region?.end??duration;
 return Math.min(region?.end??duration,Math.max(cut,lastDub));
}
// A native looping control signal shares the stem source clock, even in a
// background tab. One millisecond per control sample; no audio is rewritten.
function edgeEnvelope(ctx,duration,intro,outro){
 const buffer=ctx.createBuffer(1,Math.ceil(duration*CONTROL_HZ)+2,BUFFER_HZ),a=buffer.getChannelData(0);
 const lo=intro==null?0:Math.round(intro*CONTROL_HZ),hi=outro==null?a.length:Math.ceil(outro*CONTROL_HZ);
 a.fill(1,lo,hi);
 // Finish opening on the first consonant; don't spend the attack fading in.
 const fade=Math.min(8,lo);
 for(let k=0;k<fade;k++)a[lo-fade+k]=k/fade;
 if(outro!=null)for(let k=0;k<8&&hi-1-k>=lo;k++)a[hi-1-k]=Math.min(a[hi-1-k],(k+1)/8);
 return buffer;
}
class Deck{
 constructor(context,output=context.destination){this.context=context;this.output=output;this.buffers=[];this.ids=[];this.nodes=[];this.gains=[];this.worklets=[];this.token=0;this.rate=1;this.shift=0;}
 setBuffers(buffers,ids,concertIds=[],stream=null){this.clear();this.buffers=buffers;this.ids=ids;this.concertIds=new Set(concertIds);
  this.stream=stream?.listen?stream:null;this.unlisten=this.stream?.listen(()=>{
   if(this.canFeed)void this.feed().catch(e=>this.onStreamError?.(e));else if(!this.worklets.length)this.extend();
  });
 }
 async feed(){
  if(this.feeding)return this.feeding;const token=this.token;
  const task=(async()=>{
   while(token===this.token&&this.canFeed&&this.uploaded<this.stream.available){
    const lo=this.uploaded,hi=this.stream.available;
    await Promise.all(this.worklets.map((node,i)=>{
     const b=this.buffers[i],channels=Array.from({length:b.numberOfChannels},(_,c)=>b.getChannelData(c).slice(lo,hi));
     return node.addBuffers(channels,channels.map(a=>a.buffer));
    }));
    if(token!==this.token)return;this.uploaded=hi;this.extend();
   }
  })();this.feeding=task;try{await task;}finally{if(this.feeding===task)this.feeding=null;}
 }
 semitones(id){return id==='drums'?0:this.concertIds?.has(id)?this.keyShift:this.shift;}
 async prepare(rate,shift,relative=false,tuningCents=0){if(!(rate>=(relative ? .25 : .5)&&rate<=(relative?4:2)&&Number.isInteger(shift)&&Math.abs(shift)<=(relative?24:12)&&Number.isFinite(tuningCents)&&Math.abs(tuningCents)<=50))throw Error('Invalid speed, transposition or tuning.');this.stop();const key=`${rate}/${shift}/${tuningCents}`;if(this.prepared===key){if(this.canFeed&&this.uploaded<this.stream.available)await this.feed();return;}this.closeWorklets();const token=++this.token;this.rate=rate;this.keyShift=shift;this.shift=shift+tuningCents/100;
  if(rate!==1||this.shift!==0){const {default:create}=await import('./vendor/SignalsmithStretch.js');try{for(const buffer of this.buffers){const node=await create(this.context,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[buffer.numberOfChannels]});if(token!==this.token){node.port.close();throw new DOMException('Canceled','AbortError');}this.worklets.push(node);await node.configure({preset:'default'});if(!this.stream){const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i).slice());await node.addBuffers(channels,channels.map(c=>c.buffer));}}
   if(this.stream){this.canFeed=true;await this.feed();}
  }catch(e){this.closeWorklets();throw e;}}
  if(token!==this.token)throw new DOMException('Canceled','AbortError');this.prepared=key;
 }
 start(at,offset,duration,mix,loop=false,loopStart=0,edges=null){this.stop();
  // Stretch worklets can emit analysis pre-roll. Gate their shared output independently of the live faders.
  const gate=this.gate=this.context.createGain();gate.gain.value=0;gate.gain.setValueAtTime(1,at);
  if(!loop)gate.gain.setValueAtTime(0,at+(duration-offset)/this.rate);
  gate.connect(this.output);
  let band=gate;
  if(edges&&(edges.intro!=null||edges.outro!=null)){
   const length=this.buffers[0].duration,key=[length,edges.intro,edges.outro].join('/');
   if(this.envelope?.key!==key)this.envelope={key,buffer:edgeEnvelope(this.context,length,edges.intro,edges.outro)};
   band=this.band=this.context.createGain();band.gain.value=0;band.connect(gate);
   const control=this.context.createBufferSource();control.buffer=this.envelope.buffer;control.playbackRate.value=this.rate*CLOCK_RATIO;
   control.loop=loop;control.loopStart=loopStart*CLOCK_RATIO;control.loopEnd=duration*CLOCK_RATIO;control.connect(band.gain);
   control.start(at,offset*CLOCK_RATIO);if(!loop)control.stop(at+(duration-offset)/this.rate);this.nodes.push(control);
  }
  const growing=this.stream&&(!this.stream.complete||this.canFeed&&this.uploaded<this.stream.frames);
  this.gains=this.buffers.map((buffer,i)=>{const g=this.context.createGain();g.gain.value=mix[i].on?mix[i].level:0;g.connect(isVocal(this.ids[i])?gate:band);
   if(growing&&!this.worklets[i])return g;
   const n=this.worklets[i]||this.context.createBufferSource();n.connect(g);if(this.worklets[i]){void n.start({active:true,output:at,input:offset,rate:this.rate,semitones:this.semitones(this.ids[i]),formantSemitones:0,formantCompensation:isVocal(this.ids[i])&&this.shift!==0,formantBaseHz:0,loopStart,loopEnd:loop?duration:0});}else{n.buffer=buffer;n.loop=loop;n.loopStart=loopStart;n.loopEnd=duration;n.start(at,offset);if(!loop)n.stop(at+(duration-offset)/this.rate);this.nodes.push(n);}return g;});
  if(growing){this.job={at,offset,end:duration,loop,loopStart,next:offset};this.extend();}
 }
 clearLimit(){
  if(this.sentinel){this.sentinel.onended=null;try{this.sentinel.stop();}catch{}this.sentinel.disconnect();this.sentinel=null;}
  this.onHorizon?.(Infinity);
 }
 extend(){
  const j=this.job;if(!j||j.finished)return;
  const now=this.context.currentTime,s=this.stream,rate=s.rate;
  if(j.deadline!=null&&now>=j.deadline){this.starve(j);return;}
  const usable=this.canFeed?this.uploaded/rate-(this.uploaded<s.frames ? .4 : 0):s.available/rate;
  const to=Math.min(j.end,Math.max(0,usable));if(to<=j.next)return;
  const when=j.at+(j.next-j.offset)/this.rate,final=to>=j.end;
  if(!this.worklets.length)for(const [i,b] of this.buffers.entries()){
   const n=this.context.createBufferSource(),wrap=j.loop&&final;
   // BufferSource takes a snapshot. Never hand it an unfilled tail and mutate it while sounding.
   const a=s.complete?0:Math.floor((wrap?Math.min(j.next,j.loopStart):j.next)*rate);
   if(s.complete)n.buffer=b;else{
    const z=Math.min(b.length,Math.ceil(to*rate)),part=this.context.createBuffer(b.numberOfChannels,z-a,rate);
    for(let c=0;c<b.numberOfChannels;c++)part.copyToChannel(b.getChannelData(c).subarray(a,z),c);
    n.buffer=part;
   }
   n.connect(this.gains[i]);n.loop=wrap;if(wrap){n.loopStart=j.loopStart-a/rate;n.loopEnd=j.end-a/rate;}
   n.start(when,j.next-a/rate);if(!wrap)n.stop(j.at+(to-j.offset)/this.rate);
   this.nodes.push(n);n.onended=()=>{n.disconnect();const k=this.nodes.indexOf(n);if(k>=0)this.nodes.splice(k,1);};
  }
  j.next=to;this.clearLimit();if(final){j.finished=true;return;}
  j.deadline=j.at+(to-j.offset)/this.rate;this.onHorizon?.(j.deadline);
  const sentinel=this.sentinel=this.context.createConstantSource();sentinel.offset.value=0;sentinel.connect(this.output);
  sentinel.onended=()=>{if(this.sentinel===sentinel)this.starve(j);};sentinel.start(j.deadline);sentinel.stop(j.deadline+1/rate);
 }
 starve(j){if(this.job!==j||j.finished)return;j.finished=true;this.onStarve?.(j.next);}
 mix(values){this.gains.forEach((g,i)=>g.gain.setTargetAtTime(values[i].on?values[i].level:0,this.context.currentTime,.01));}
 stop(){this.job=null;this.clearLimit();this.gate?.disconnect();this.gate=null;this.band?.disconnect();this.band=null;for(const n of this.nodes){try{n.stop();}catch{}n.disconnect();}this.nodes=[];for(const n of this.worklets){void n.stop();n.disconnect();}this.gains.forEach(g=>g.disconnect());this.gains=[];}
 closeWorklets(){this.canFeed=false;this.uploaded=0;this.feeding=null;this.worklets.forEach(n=>{n.disconnect();n.port.close();});this.worklets=[];this.prepared=null;}
 clear(){this.token++;this.unlisten?.();this.unlisten=null;this.stream=null;this.stop();this.closeWorklets();this.buffers=[];this.envelope=null;}
}
root.MeleteFullPracticeAudio={Deck,vocalEdges,listenEnd,isVocal,vocalSplit,mixerTracks,splitIndex};
})(globalThis);
