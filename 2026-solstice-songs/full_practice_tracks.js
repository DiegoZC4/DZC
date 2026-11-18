/* Local recording lanes use seconds on the original song, regardless of capture tempo/key. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MeleteFullPracticeTracks=api;})(globalThis,function(){
'use strict';
const spec={
 voice:{name:'Voice',icon:'mic'},piano:{name:'Piano',icon:'piano'},
 guitar:{name:'Guitar',icon:'guitar'},other:{name:'Audio',icon:'audio-lines'}
};
function createTrack(song,instrument,lanes){
 const base=spec[instrument].name,names=new Set(lanes.map(l=>l.name));let name=base;
 for(let n=2;names.has(name);n++)name=base+' '+n;
 return {type:'track',id:'track:'+crypto.randomUUID(),song,name,instrument,on:true,level:1,createdAt:Date.now(),clips:[]};
}
function collect(rows){
 const lanes=new Map(),visible=rows.filter(t=>!t.deleteAfter);
 for(const t of visible)if(t.type==='track')lanes.set(t.id,{...t,clips:[]});
 for(const t of visible.filter(t=>t.frames>0).sort((a,b)=>a.createdAt-b.createdAt||(a.number||0)-(b.number||0))){
  const id=t.trackId||'legacy:'+t.id;
  if(!lanes.has(id))lanes.set(id,{id,song:t.song,name:t.trackName||'Recording '+(t.number||1),instrument:t.instrument||'other',createdAt:t.createdAt,on:!!t.trackId,level:1,clips:[]});
  lanes.get(id).clips.push(t);
 }
 return [...lanes.values()].sort((a,b)=>a.createdAt-b.createdAt||a.name.localeCompare(b.name));
}
function rawOffset(c){return (c.latency||0)+(c.leadInSeconds||0);}
function clipEnd(c){return c.sourcePosition+Math.max(0,c.frames/c.sampleRate-rawOffset(c))*c.rate;}
function punch(previous,clip,duration){
 const target=clip.sourcePosition,to=Math.min(duration,clipEnd(clip));if(!(to>target))return previous;
 // Keep an early pick attack in a gap, but never overwrite the previous pass before the punch.
 let from=Math.max(0,target-(clip.leadInSeconds||0)*clip.rate);
 for(const s of previous)if(s.from<target&&s.to>from)from=Math.min(target,s.to);
 const spans=[];
 for(const s of previous){
  if(s.to<=from||s.from>=to)spans.push(s);
  else{if(s.from<from)spans.push({...s,to:from});if(s.to>to)spans.push({...s,from:to});}
 }
 spans.push({from,to,clip});return spans.sort((a,b)=>a.from-b.from);
}
function segments(lane,version,duration){return lane.clips.filter(c=>c.sourceVersion===version).reduce((s,c)=>punch(s,c,duration),[]);}
function trimGain(clip){return Number.isFinite(clip.gainDb)?10**(Math.max(-30,Math.min(30,clip.gainDb))/20):1;}
function wave(ctx,spans,duration,width,height){
 if(!duration)return;
 for(const {clip,from,to} of spans){
  const left=from/duration*width,right=to/duration*width;
  ctx.globalAlpha=.13;ctx.fillRect(left,0,Math.max(1,right-left),height);ctx.globalAlpha=1;
  const env=clip.envelope;if(!env?.bins.length)continue;
  const gain=trimGain(clip),rawHz=clip.sampleRate/env.step,bin=(x)=>((x/width*duration-clip.sourcePosition)/clip.rate+rawOffset(clip))*rawHz;
  for(let x=Math.floor(left);x<Math.ceil(right);x++){
   const a=Math.max(0,Math.floor(bin(Math.max(x,left)))),b=Math.min(env.bins.length,Math.ceil(bin(Math.min(x+1,right))));
   let p=0;for(let i=a;i<b;i++)p=Math.max(p,env.bins[i]);const h=Math.max(1,Math.min(1,p/255*gain)*height);
   ctx.fillRect(x,(height-h)/2,1,h);
  }
 }
}
// Pack only audible intervals into their original performance clock. With looping on,
// each group spans the song so native audio nodes wrap together without JS timers.
function groupSpans(spans,end,loop){
 const groups=new Map();
 for(const span of spans){
  const rate=span.clip.rate,shift=span.clip.shift??span.clip.transpose??0,key=rate+':'+shift;
  if(!groups.has(key))groups.set(key,{from:loop?0:span.from,to:loop?end:span.to,rate,shift,spans:[]});
  const g=groups.get(key);g.to=Math.max(g.to,span.to);g.spans.push(span);
 }
 return [...groups.values()];
}
function copySpan(out,input,sampleRate,group,span){
 const {clip,from,to}=span,start=Math.max(0,Math.round(((from-clip.sourcePosition)/clip.rate+rawOffset(clip))*sampleRate));
 const at=Math.round((from-group.from)/group.rate*sampleRate);
 const n=Math.min(input.length-start,out.length-at,Math.round((to-group.from)/group.rate*sampleRate)-at);
 if(n<=0)return;
 const gain=trimGain(clip);
 if(gain===1)out.set(input.subarray(start,start+n),at);
 else for(let i=0;i<n;i++)out[at+i]=input[start+i]*gain;
}
class Mixer{
 constructor(context,output,readWav,onError){this.ctx=context;this.output=output;this.readWav=readWav;this.onError=onError;this.entries=new Map();this.run=null;}
 discard(e){e.disposed=true;e.groups.forEach(g=>g.deck.clear());e.gain.disconnect();}
 forget(id){const e=this.entries.get(id);if(e){this.discard(e);this.entries.delete(id);}}
 clear(){this.stop();this.entries.forEach(e=>this.discard(e));this.entries.clear();}
 stop(){this.run=null;for(const e of this.entries.values())for(const g of e.groups)g.deck.stop();}
 async entry(lane,opt){
  const key=JSON.stringify([opt.rate,opt.shift,opt.loop,opt.loopStart,opt.end,opt.version,lane.clips.map(c=>[c.id,c.frames,c.gainDb||0])]);
  let e=this.entries.get(lane.id);if(e?.key===key){await e.ready;return e;}
  if(e)this.discard(e);
  e={key,gain:this.ctx.createGain(),groups:[],disposed:false};this.entries.set(lane.id,e);
  e.gain.gain.value=lane.on?lane.level:0;e.gain.connect(this.output);
  e.ready=(async()=>{
   const groups=groupSpans(segments(lane,opt.version,opt.end),opt.end,opt.loop);
   for(const g of groups){
    if(e.disposed)return;
    const sr=this.ctx.sampleRate,len=Math.max(1,Math.ceil((g.to-g.from)/g.rate*sr));
    const buffer=this.ctx.createBuffer(1,len,sr),byClip=new Map();
    for(const s of g.spans){if(!byClip.has(s.clip.id))byClip.set(s.clip.id,[]);byClip.get(s.clip.id).push(s);}
    for(const [id,spans] of byClip){
     const wav=await this.readWav(id);if(e.disposed)return;
     const decoded=await this.ctx.decodeAudioData(await wav.arrayBuffer());if(e.disposed)return;
     for(const s of spans)copySpan(buffer.getChannelData(0),decoded.getChannelData(0),sr,g,s);
    }
    const deck=new MeleteFullPracticeAudio.Deck(this.ctx,e.gain);e.groups.push({...g,deck});
    deck.setBuffers([buffer],[lane.instrument==='voice'?'vocals':lane.instrument]);
    await deck.prepare(opt.rate/g.rate,opt.shift-g.shift,true);
   }
  })().catch(error=>{const stale=e.disposed;if(this.entries.get(lane.id)===e){this.discard(e);this.entries.delete(lane.id);}if(!stale)throw error;});
  await e.ready;return e;
 }
 async prepare(lanes,opt){this.stop();this.options=opt;for(const l of lanes)if(l.on&&l.id!==opt.exclude&&l.clips.length)await this.entry(l,opt);}
 schedule(e,run){
  if(e.disposed||this.run!==run)return;
  const {at,offset,rate,end,loop,loopStart=0}=run,when=Math.max(at,this.ctx.currentTime+.012);
  let pos=offset+(when-at)*rate;if(loop&&pos>=end)pos=loopStart+(pos-end)%(end-loopStart);
  for(const g of e.groups){
   if(pos>=g.to)continue;const from=Math.max(pos,g.from);
   g.deck.start(when+(from-pos)/rate,(from-g.from)/g.rate,(g.to-g.from)/g.rate,[{on:true,level:1}],loop,loop?(loopStart-g.from)/g.rate:0);
  }
 }
 start(at,offset,lanes){this.run={...this.options,at,offset,started:new Set()};this.mix(lanes);}
 mix(lanes){
  const run=this.run;
  for(const l of lanes){
   const e=this.entries.get(l.id),on=l.on&&l.id!==run?.exclude;
   e?.gain.gain.setTargetAtTime(on?l.level:0,this.ctx.currentTime,.008);
   if(!run||!on||!l.clips.length||run.started.has(l.id))continue;
   run.started.add(l.id);
   void this.entry(l,run).then(entry=>{if(this.run===run)this.schedule(entry,run);}).catch(err=>{if(this.run===run){run.started.delete(l.id);this.onError(err);}});
  }
 }
}
return {spec,createTrack,collect,clipEnd,punch,segments,wave,groupSpans,copySpan,Mixer};
});
