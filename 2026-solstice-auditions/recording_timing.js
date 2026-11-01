/* Snapshot performed timing for capture, scoring, replay and metronome. */
(function(root) {
  'use strict';
  const reference = typeof module === 'object' && module.exports ? require('./reference_audio.js') : root.MeleteReferenceAudio;
  const pitch = typeof module === 'object' && module.exports ? require('../template/take_pitch.js') : root.MeleteTakePitch;
  // The written measures, then whole bars in the last measure's meter through end:
  // a reviewed loop may run past the music to where her next phrase would start.
  function measuresTo(sequence, end=sequence.endTick) {
    const last=sequence.measures.at(-1),length=last[2]*sequence.division*4/last[3],measures=sequence.measures.map(m=>[...m]);
    for(let tick=sequence.endTick;tick<end-1e-7;tick+=length)measures.push([tick,length,last[2],last[3]]);
    return measures;
  }
  function measureBeats(sequence, end=sequence.endTick) {
    return measuresTo(sequence,end).flatMap(([start,duration,numerator,denominator],index)=>{
      const unit=sequence.division*4/denominator,missing=index===0?Math.max(0,numerator-duration/unit):0;
      const first=Math.ceil(missing-1e-9),beats=[];
      for(let i=first;i<numerator;i++){
        const tick=start+(i-missing)*unit;
        if(tick>=start-1e-7&&tick<start+duration-1e-7&&tick<end)beats.push({tick,label:i+1});
      }
      return beats;
    });
  }
  // Audio kept before a loop's first bar line, so a pickup's consonant survives the seam.
  const LOOP_LEAD = .06;
  // One seamless pass: a pickup's beats come off the last bar, so the meter
  // never changes at the wrap. Reviewed regions (reference-alignment.json loop)
  // also place the seam clear of the singer's next phrase.
  function loopRegion(sequence, alignment = null, recording = true) {
    const full = m => m[2] * sequence.division * 4 / m[3], first = sequence.measures[0], last = sequence.measures.at(-1);
    const pickup = first[1] < full(first) - 1e-7 ? first[1] : 0, loop = alignment?.loop;
    const endTick = loop?.endTick ?? sequence.endTick - Math.max(0, pickup - (full(last) - last[1]));
    if (!recording || !alignment?.beatAnchors) return {startTick:0, endTick};
    if (Number.isFinite(loop?.start) && Number.isFinite(loop?.end)) return {startTick:0, endTick, start:loop.start, end:loop.end};
    const grid = new reference.Timeline(alignment.beatAnchors);
    const lead = Math.max(0, grid.seconds(0) - alignment.anchors[0][1]) + LOOP_LEAD;
    return {startTick:0, endTick, start:grid.seconds(0) - lead, end:grid.seconds(endTick) - lead};
  }
  function plan(song, sequence, alignment, rate, shift = 0, latency = 0, loop = null) {
    const map = alignment ? new reference.Timeline(alignment.anchors) : null;
    const division = sequence.division, unit = division * 4 / sequence.measures[0][3];
    const first = map?.start ?? 0;
    // Full opening measures establish the preparation pulse; a rushed pickup
    // must not turn the count-in into sixteenth-note clicks.
    const pulse = map ? alignment.countInPulse ?? (map.seconds(unit)-first) : 60 / song.tempo * unit / division;
    const guidePulse = 60 / song.tempo * unit / division;
    const leadBeats = song.countIn.seconds / guidePulse;
    const origin = alignment?.countInStart ?? first - leadBeats * pulse;
    const captureTicks = -(first-origin)/pulse*unit;
    const noteSeconds = tick => tick < 0 ? first + tick / unit * pulse : map ? map.seconds(tick) : tick / division * 60 / song.tempo;
    // A loop pass ends where the next begins, cutting any note held past it.
    const loopEnd = loop ? (map ? loop.end : noteSeconds(loop.endTick)) : null;
    const secondsAtTick = loop ? tick => tick >= loop.endTick ? loopEnd : Math.min(loopEnd, noteSeconds(tick)) : noteSeconds;
    const end = loop?.endTick ?? map?.endTick ?? sequence.endTick;
    const ref = pitch.reference({spans: sequence.notes.map(n=>({start:n[1],end:n[2],pitches:[n[3]+shift]})),
      secondsAtTick, start:0, end, rate, fingerprint:song.version, part:0, line:0,
      captureStart:captureTicks, latency, measures:sequence.measures});
    if (loop) ref.notes = ref.notes.filter(n => n[1] - n[0] > .02);
    const anchors = map?.anchors ?? [[0,0],[sequence.endTick, song.duration]];
    ref.timing = {kind:map?'recording':'guide', anchors, origin, pitchShift:shift,
      originalSha256:alignment?.originalSha256 ?? null, correctionCents:alignment?.correctionCents??0,
      beatAnchors:alignment?.beatAnchors??null, loop:loop?{endTick:loop.endTick, start:loop.start ?? null, end:loopEnd}:null};
    const count = {duration:ref.leadInSeconds, beats:alignment?.countInBeats
      ?alignment.countInBeats.map(b=>({label:b.label,seconds:(b.seconds-origin)/rate}))
      :song.countIn.beats.map(b=>({label:b.label,seconds:b.seconds/guidePulse*pulse/rate}))};
    ref.timing.countInBeats=count.beats;
    const beats = clickBeats(sequence,ref);
    return {ref,count,beats,origin,map:new reference.Timeline(anchors)};
  }
  function tickAt(ref, seconds) {
    if(!ref.timing)return null;
    return new reference.Timeline(ref.timing.anchors).tick(ref.timing.origin+seconds*ref.rate);
  }
  function repeatPlan(song, sequence, alignment, rate, shift=0, loop=loopRegion(sequence, alignment, !!alignment)) {
    const result=plan({...song,countIn:{seconds:0,beats:[]}},sequence,
      alignment?{...alignment,countInStart:loop?.start ?? alignment.anchors[0][1],countInBeats:[]}:null,rate,shift,0,loop);
    result.ref.timing.loopPass=true;
    result.count={duration:0,beats:[]};
    return result;
  }
  function passAt(first, repeat, elapsed) {
    if(!repeat||elapsed<first.seconds)return {ref:first,seconds:Math.max(0,elapsed),index:0};
    const index=1+Math.floor((elapsed-first.seconds)/repeat.seconds);
    return {ref:repeat,seconds:(elapsed-first.seconds)%repeat.seconds,index};
  }
  function secondsAt(ref,tick){
    return (new reference.Timeline(ref.timing.anchors).seconds(tick)-ref.timing.origin)/ref.rate;
  }
  function staffTick(ref, seconds) {
    const map = new reference.Timeline(ref.timing.beatAnchors || ref.timing.anchors);
    return map.tick(ref.timing.origin + seconds * ref.rate);
  }
  // gains bring each stem to the shared loudness (recording-clips.json gains).
  function mixGains(vocal, backing, levels = [1, 1], gains = [1, 1]) {
    const v = vocal ? Math.max(0, Math.min(2, levels[0])) * gains[0] : 0;
    const b = backing ? Math.max(0, Math.min(2, levels[1])) * gains[1] : 0;
    // Keep the original at the shared level; add only the louder stem's excess,
    // so as little as possible comes from the lossy separation.
    return {original:Math.min(v,b), vocal:Math.max(0,v-b), backing:Math.max(0,b-v)};
  }
  function clickBeats(sequence,ref){
    const anchors=ref.timing.beatAnchors||ref.timing.anchors,map=new reference.Timeline(anchors);
    // Past the last anchor (a guide loop's tail), keep the last segment's tempo.
    const [[t0,s0],[t1,s1]]=anchors.slice(-2),at=tick=>tick>t1?s1+(tick-t1)*(s1-s0)/(t1-t0):map.seconds(tick);
    return measureBeats(sequence,ref.end).map(b=>({...b,seconds:(at(b.tick)-ref.timing.origin)/ref.rate}))
      .filter(b=>b.seconds>=0&&b.seconds<ref.seconds);
  }
  const LOOP_FADE = .025;
  class ByteCache {
    constructor(limit){this.limit=limit;this.bytes=0;this.items=new Map();}
    get(key){const item=this.items.get(key);if(!item)return;
      this.items.delete(key);this.items.set(key,item);return item.value;}
    set(key,value,bytes){
      const old=this.items.get(key);if(old){this.bytes-=old.bytes;this.items.delete(key);}
      if(bytes>this.limit)return;
      while(this.bytes+bytes>this.limit&&this.items.size){const [k,v]=this.items.entries().next().value;this.items.delete(k);this.bytes-=v.bytes;}
      this.items.set(key,{value,bytes});this.bytes+=bytes;
    }
  }
  // Retain compressed excerpts for song revisits, without keeping every decoded
  // stereo buffer alive. Both caches are LRU and independent of private takes.
  class ClipCache {
    constructor({encodedBytes=48*1048576,decodedBytes=96*1048576}={}){
      this.encoded=new ByteCache(encodedBytes);this.decoded=new ByteCache(decodedBytes);
      this.fetching=new Map();this.decoding=new Map();
    }
    async audio(src){
      const cached=this.encoded.get(src);if(cached)return cached;
      if(!this.fetching.has(src))this.fetching.set(src,(async()=>{
        try{const response=await fetch(src,{cache:'force-cache',signal:AbortSignal.timeout(30000)});
          if(!response.ok)throw new Error('Recording excerpt could not load. Please retry.');
          const bytes=await response.arrayBuffer();this.encoded.set(src,bytes,bytes.byteLength);return bytes;
        }finally{this.fetching.delete(src);}
      })());
      return this.fetching.get(src);
    }
    async prefetch(entry,rate=1){
      const assets=entry.rates[String(entry.runtimeRate?1:rate)];
      if(!assets)throw new Error('Prepared recording speed is unavailable.');
      await Promise.all(Object.values(assets).map(asset=>this.audio(asset.src)));
    }
    async buffers(context,assets){
      const id=JSON.stringify([context.sampleRate,Object.entries(assets).map(([name,a])=>[name,a.src])]);
      const cached=this.decoded.get(id);if(cached)return cached;
      if(!this.decoding.has(id))this.decoding.set(id,(async()=>{
        try{const pairs=await Promise.all(Object.entries(assets).map(async([name,asset])=>
          [name,await context.decodeAudioData((await this.audio(asset.src)).slice(0))]));
          const buffers=Object.fromEntries(pairs),bytes=pairs.reduce((n,[,b])=>n+b.length*b.numberOfChannels*4,0);
          this.decoded.set(id,buffers,bytes);return buffers;
        }finally{this.decoding.delete(id);}
      })());
      return this.decoding.get(id);
    }
  }
  class Deck {
    constructor(context, output=context.destination, clips=new ClipCache()){this.context=context;this.output=output;this.cache=null;this.clips=clips;this.nodes=[];this.gains={};this.abort=null;this.worklets={};this.loops={};this.level=1;this.levels=[1,1];this.stemGains=[1,1];}
    async load(entry, rate, shift=0){
      if(!Number.isInteger(shift)||shift < -12||shift > 12)throw new Error('Invalid transposition.');
      const bufferRate=entry.runtimeRate?1:rate;
      const assets=entry.rates[String(bufferRate)]||{};
      if(Object.keys(assets).length!==3)throw new Error('Prepared recording speed is unavailable.');
      const id=JSON.stringify([entry.id,entry.scoreVersion,entry.correctionCents||0,bufferRate,assets]);
      this.abort?.abort();const controller=new AbortController();this.abort=controller;
      if(this.cache?.id!==id){
        const buffers=await this.clips.buffers(this.context,assets);
        if(controller.signal.aborted)throw new DOMException('Canceled','AbortError');
        this.cache={id,buffers,entry,rate};this.loops={};
      }
      this.cache.rate=rate;this.bufferRate=bufferRate;this.stemGains=[entry.gains?.vocal??1,entry.gains?.backing??1];
      this.stop();this.shift=shift;this.stretched=!!shift||rate!==bufferRate;
      if(this.stretched){
        const {default:createStretch}=await import('./vendor/SignalsmithStretch.js');
        try{for(const [name,buffer] of Object.entries(this.cache.buffers)){
          if(controller.signal.aborted)throw new DOMException('Canceled','AbortError');
          const node=await createStretch(this.context,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[buffer.numberOfChannels]});
          this.worklets[name]=node;
          await node.configure({preset:'default'});
          const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i).slice());
          await node.addBuffers(channels,channels.map(c=>c.buffer));
        }}catch(error){this.stop();throw error;}
      }
      if(controller.signal.aborted){this.stop();throw new DOMException('Canceled','AbortError');}
      return this.cache;
    }
    start(at, sourceTime, end, vocal, backing, loopStart=null){
      this.stop(false);const {buffers,entry,rate}=this.cache;
      const sourceStart=Math.max(entry.start,sourceTime),when=at+(sourceStart-sourceTime)/rate;
      for(const [name,buffer] of Object.entries(buffers)){
        const node=this.stretched?this.worklets[name]:this.context.createBufferSource(),gain=this.context.createGain();
        node.connect(gain).connect(this.output);gain.gain.value=0;this.gains[name]=gain;
        if(this.stretched){
          // Buffered Signalsmith accounts for its look-ahead internally. The
          // output timestamp is the same AudioContext clock as the cursor/click.
          void node.start({active:true,output:when,input:(sourceStart-entry.start)/this.bufferRate,rate:rate/this.bufferRate,semitones:this.shift,
            loopStart:loopStart===null?0:(loopStart-entry.start)/this.bufferRate,loopEnd:loopStart===null?0:(end-entry.start)/this.bufferRate});
        }else{
          if(loopStart!==null){const loop=this.loopBuffer(name,buffer,loopStart,end,sourceStart);
            node.buffer=loop.buffer;node.loop=true;node.loopStart=loop.loopStart;node.loopEnd=loop.loopEnd;node.start(when,Math.max(0,(sourceStart-loop.origin)/rate));}
          else{node.buffer=buffer;node.start(when,(sourceStart-entry.start)/rate,(end-sourceStart)/rate);}
          node.onended=()=>{node.disconnect();gain.disconnect();};this.nodes.push(node);
        }
      }
      this.endTime=loopStart===null?when+(end-sourceStart)/rate:Infinity;this.startTime=when;
      this.mix(vocal,backing,true);
    }
    // Native looping jumps sample-exactly from the pass end to its start. Blend
    // the last moments into the audio just before the start, so the jump lands
    // where that audio continues and the seam has no click or level step.
    loopBuffer(name,buffer,loopStart,loopEnd,from){
      const {entry,rate}=this.cache,sr=buffer.sampleRate,frame=t=>Math.round((t-entry.start)/rate*sr);
      const a=Math.max(0,Math.min(buffer.length,frame(loopStart))),b=Math.max(a+1,Math.min(buffer.length,frame(loopEnd)));
      const cached=this.loops[name];
      if(cached?.source===buffer&&cached.a===a&&cached.b===b&&cached.c<=Math.min(a,Math.max(0,frame(from))))return cached;
      const c=Math.min(a,Math.max(0,frame(from))),fade=Math.max(0,Math.min(Math.round(LOOP_FADE*sr),a,(b-a)>>1));
      const out=this.context.createBuffer(buffer.numberOfChannels,b-c,sr);
      for(let channel=0;channel<buffer.numberOfChannels;channel++){
        const source=buffer.getChannelData(channel),target=out.getChannelData(channel);
        target.set(source.subarray(c,b));
        for(let i=0;i<fade;i++){const t=(i+.5)/fade*Math.PI/2;target[b-c-fade+i]=source[b-fade+i]*Math.cos(t)+source[a-fade+i]*Math.sin(t);}
      }
      return this.loops[name]={source:buffer,a,b,c,buffer:out,origin:entry.start+c/sr*rate,loopStart:(a-c)/sr,loopEnd:(b-c)/sr};
    }
    mix(vocal,backing,immediate=false){
      this.vocal=vocal;this.backing=backing;
      const levels=mixGains(vocal,backing,this.levels,this.stemGains);
      for(const [name,node] of Object.entries(this.gains)){
        node.gain.cancelScheduledValues(this.context.currentTime);
        if(immediate){node.gain.setValueAtTime(0,this.context.currentTime);node.gain.setValueAtTime(0,this.startTime);
          node.gain.linearRampToValueAtTime(levels[name]*this.level,this.startTime+.25);}
        else node.gain.setTargetAtTime(levels[name]*this.level,this.context.currentTime,.005);
        if(Number.isFinite(this.endTime)&&this.endTime>this.context.currentTime)node.gain.setValueAtTime(0,this.endTime);
      }
    }
    volume(level){this.level=Math.max(0,Math.min(1,level));this.mix(this.vocal,this.backing);}
    trackLevels(vocal,backing){this.levels=[vocal,backing];this.mix(this.vocal,this.backing);}
    stop(clearWorklets=true){for(const n of this.nodes){try{n.stop();}catch{}}this.nodes=[];
      for(const n of Object.values(this.gains))n.disconnect();this.gains={};
      if(clearWorklets){for(const n of Object.values(this.worklets)){n.disconnect();n.port.close();}this.worklets={};}
    }
    cancel(){this.abort?.abort();this.stop();}
  }
  const api={plan,repeatPlan,loopRegion,passAt,tickAt,staffTick,secondsAt,mixGains,measuresTo,measureBeats,clickBeats,ByteCache,ClipCache,Deck};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MeleteRecordingTiming=api;
})(globalThis);
