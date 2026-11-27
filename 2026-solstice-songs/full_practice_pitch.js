/* Full-recording adapter for Melete's shared detector, audio clock and grading. */
(function(root,factory){const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('../template/take_pitch.js'):root.MeleteTakePitch,
  common?require('../template/microphone_check.js'):root.MeleteMicrophoneCheck,
  common?require('./full_practice_loop.js'):root.MeleteFullPracticeLoop,
  common?require('./full_practice_pitch_rows.js'):root.MeleteFullPracticePitchRows);
 if(common)module.exports=api;else root.MeleteFullPracticePitch=api;
})(globalThis,function(grade,mic,loops,partRows){
 'use strict';
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function phraseRole(data,index,chart){
  const cue=data.phraseCues?.[index];
  if(!cue)return data.phraseCues?'solo':'harmony';
  const [section,line,at=0]=cue,entry=chart?.sections?.[section]?.lines?.[line];
  return entry?.spans?.find(s=>at>=s.from&&at<s.to)?.role||entry?.role||'solo';
 }
 function expand(data,hash,shift=0,chart=null){
  if(!data||data.vocalSha256!==hash)return [];
  const notes=[];
  if(data.kind==='bass'){
   for(const [start,end,pitch,lyric,phrase,slurToNext] of data.notes){
    if(!(end>start&&start>=(notes.at(-1)?.end||0)&&end<=data.seconds&&Number.isInteger(pitch)&&pitch>=0&&pitch<=127))throw Error('Invalid bass staff');
    notes.push({start,end,pitch:pitch+shift,lyric,phrase,slurToNext,role:'bass'});
   }
   return notes;
  }
  for(const [p,phrase] of data.phrases.entries()){
   const role=phraseRole(data,p,chart);if(role==='solo')continue;
   const patternName=data.rolePatterns?.[phrase.pattern]?.[role]||phrase.pattern;
   const pattern=data.patterns[patternName],times=phrase.times;
   if(!pattern||times.length!==pattern.length+1)throw Error('Invalid harmony phrase');
   for(let i=0;i<pattern.length;i++){
    const [pitch,lyric]=pattern[i],start=times[i],end=times[i+1];
    if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>data.seconds||start<(notes.at(-1)?.end||0)-1e-7)throw Error('Invalid harmony timing');
    notes.push({start,end,pitch:pitch+shift,lyric,phrase:p,pattern:patternName,role,
     slurToNext:i+1<pattern.length&&pattern[i+1][1]===''});
   }
  }
  return notes;
 }
 function nearest(notes,x,y,geometry){
  let best=null,distance=Infinity;
  for(const note of notes){
   const left=geometry.x(note.start),right=geometry.x(note.end),cy=geometry.y(note.pitch);
   if(right<geometry.left||left>geometry.right)continue;
   const d=Math.hypot(Math.max(left-x,0,x-right),cy-y);
   if(d<distance){best=note;distance=d;}
  }
  return best;
 }
 function target(notes,time){
  let lo=0,hi=notes.length;
  while(lo<hi){const m=(lo+hi)>>1;if(notes[m].start<=time)lo=m+1;else hi=m;}
  const n=notes[lo-1];return n&&time<n.end?n:null;
 }
 function errorColor(error){
  const a=clamp((Math.abs(error)-10)/40,0,1);
  return `rgb(${Math.round(32+223*a)},${Math.round(216-163*a)},${Math.round(70-17*a)})`;
 }
 function assess(frames,notes,from,to){
  if(!(to>from))return null;
  const rows=notes.filter(n=>n.end>from&&n.start<to).map(n=>[Math.max(from,n.start),Math.min(to,n.end),[n.pitch]]);
  if(!rows.length||to<=0)return null;
  return grade.scoreFrames(frames,{version:grade.VERSION,fingerprint:'full-song-harmony',part:0,rate:1,seconds:Math.max(to,.001),latency:0,notes:rows},to);
 }
 function outputTime(context,now=performance.now()){
  const stamp=context.getOutputTimestamp?.();
  if(stamp?.contextTime>0&&stamp.performanceTime>0&&now-stamp.performanceTime>=0&&now-stamp.performanceTime<500)
   return clamp(stamp.contextTime+(now-stamp.performanceTime)/1000,0,context.currentTime);
  return Math.max(0,context.currentTime-(context.baseLatency||0)-(context.outputLatency||0));
 }
 function sourceTime(contextTime,{anchor,from,rate,end,loop,loopStart=0}){
  const t=from+Math.max(0,contextTime-anchor)*rate;
  return loops.position(t,loopStart,end,loop);
 }
 class Trace{
  constructor(){this.reset(0);}
  reset(from){this.from=from;this.to=from;this.frames=[];this.lastEnd=from;}
  append(frame){
   if(frame.end<=this.from||frame.start<this.lastEnd-.5)return false;
   const start=Math.max(this.from,this.lastEnd,frame.start),end=frame.end;
   if(end<=start)return false;
   this.frames.push({...frame,start,end});this.lastEnd=end;this.to=end;return true;
  }
 }
 let runtime;
 class Sampler{
  constructor({observe,fail,wrap=()=>{}}){Object.assign(this,{observe,fail,wrap});this.generation=0;this.timer=null;}
  async prepare(input,playback){
   this.detach();const token=++this.generation;
   runtime??=fetch('vendor/pitchy-browser.js').then(r=>{if(!r.ok)throw Error('Pitch detector unavailable');return r.text();}).catch(e=>{runtime=null;throw e;});
   const text=await runtime;if(token!==this.generation)return;
   const url=URL.createObjectURL(new Blob([MeleteLivePitch.workerSource(text)],{type:'text/javascript'}));
   try{this.channel=new MeleteLivePitch.Channel(new Worker(url),(result,meta,cost)=>this.accept(result,meta,cost),e=>{this.stop();this.fail(e);});}
   finally{URL.revokeObjectURL(url);}
   this.input=input;this.playback=playback;this.analyser=input.context.createAnalyser();this.analyser.fftSize=4096;
   this.buffer=new Float32Array(4096);input.source.connect(this.analyser);
  }
  start(transport){
   this.stop();if(!this.channel||!this.input)return;
   this.transport=transport;this.lastTime=null;this.previous=null;this.lastCycle=null;this.interval=10;
   const {context,track}=this.input,p=this.playback;
   const latency=Math.max(0,Number(track?.getSettings?.().latency)||0)+(p.baseLatency||0)+(p.outputLatency||0);
   this.clock=mic.passClock(context.currentTime,p.currentTime,transport.anchor,transport.from,transport.from,transport.rate,context.sampleRate,latency);
   this.active=true;this.poll();
  }
  poll(){
   if(!this.active)return;
   try{
    const {context,track}=this.input,now=context.currentTime,sr=context.sampleRate;
    if(track.readyState==='ended')throw Error('Microphone disconnected. Reconnect Samson and press Play to retry.');
    if(context.state==='running'&&track.enabled&&!track.muted&&!this.channel.pending&&(this.lastTime===null||now-this.lastTime>=128/sr)){
     this.analyser.getFloatTimeDomainData(this.buffer);
     const real=mic.sampleScoreTime(this.clock,now,this.buffer.length/(2*sr)),{end,loop,rate,loopStart=0}=this.transport;
     const cycle=loops.cycle(real,loopStart,end,loop);
     if(this.lastCycle!==null&&cycle!==this.lastCycle){this.channel.invalidate();this.previous=null;this.wrap();}
     this.lastCycle=cycle;
     const at=loops.position(real,loopStart,end,loop);
     const width=Math.min(.04,this.lastTime===null?.01:now-this.lastTime)*rate;
     this.lastTime=now;
     let energy=0;for(const v of this.buffer)energy+=v*v;
     const meta={start:at-width/2,end:Math.min(end,at+width/2),voiced:Math.sqrt(energy/this.buffer.length)>=.001};
     this.channel.submit(this.buffer,{sampleRate:sr,previous:this.previous,minimum:55,maximum:1200},meta);
    }
   }catch(e){this.stop();this.fail(e);return;}
   this.timer=setTimeout(()=>this.poll(),this.interval);
  }
  accept([frequency,clarity],frame,cost){
   if(!this.active)return;
   this.interval=clamp(Math.max(cost*2,this.interval*.97),10,60);
   const cents=frame.voiced&&clarity>=.85&&frequency>=55&&frequency<=1200?(69+12*Math.log2(frequency/440))*100:null;
   this.previous=cents;this.observe({start:frame.start,end:frame.end,cents,live:true});
  }
  stop(){this.active=false;clearTimeout(this.timer);this.timer=null;this.channel?.invalidate();}
  detach(){this.stop();this.generation++;this.channel?.close();this.channel=null;
   try{if(this.analyser)this.input?.source.disconnect(this.analyser);}catch{}
   this.analyser=null;this.input=null;
  }
 }
 const NS='http://www.w3.org/2000/svg';
 function svg(tag,attrs,text){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;return e;}
 const name=p=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][((p%12)+12)%12]+(Math.floor(p/12)-1);
 const clock=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
 class View{
  constructor({root,viewport,stage,score,canvas,cursor,phrases,stats,seek,preview=()=>{},canPreview=()=>true,chordName=s=>s}){
   Object.assign(this,{root,viewport,stage,score,canvas,cursor,phrases,stats,seek,preview,canPreview,chordName});this.trace=new Trace();this.notes=[];this.bars=[];this.beats=[];this.loop=null;this.scale=100;this.stretch=100;this.shift=0;this.time=0;this.lastPaint=0;this.manual=false;
   viewport.addEventListener('scroll',()=>{this.cancelPreview();if(this.wrapped)return;this.dirty=true;if(!this.scrollPaint)this.scrollPaint=requestAnimationFrame(()=>{this.scrollPaint=null;this.paintTrace();});});
   window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>this.paintTrace());
   viewport.addEventListener('wheel',()=>{this.manual=true;},{passive:true});
   viewport.addEventListener('touchmove',()=>{this.manual=true;},{passive:true});
   viewport.addEventListener('pointerdown',e=>this.press(e));
   viewport.addEventListener('pointermove',e=>{if(!this.gesture&&e.pointerType!=='touch')this.highlight(this.canPreview()?this.noteAt(e):null,false);});
   viewport.addEventListener('pointerleave',()=>{if(!this.gesture)this.highlight(null,false);});
   viewport.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key)||e.repeat||!this.canPreview())return;e.preventDefault();e.stopPropagation();this.keyboard=true;const n=this.hover||target(this.notes,this.time)||this.notes.find(n=>n.start>=this.time);if(n){this.highlight(n,true);this.preview(n);}});
   viewport.addEventListener('keyup',e=>{if(this.keyboard&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();this.cancelPreview();}});
   viewport.addEventListener('blur',()=>this.cancelPreview());
   window.addEventListener('blur',()=>this.cancelPreview());
   document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancelPreview();});
   phrases.onchange=()=>{const p=phrases.value!==''&&this.data?.phrases[Number(phrases.value)];if(p)seek(Math.max(0,p.times[0]-.8));};
   this.resize=new ResizeObserver(()=>{
    if(!this.data||!viewport.clientWidth||this.renderWidth===viewport.clientWidth)return;
    this.render();if(this.data.kind==='bass')this.move(this.time,false,!this.manual);
   });this.resize.observe(viewport);
  }
  noteAt(e){
   if(!this.data)return null;const r=this.stage.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
   if(this.wrapped){
    const row=this.wrapped.atY(y),ink=e.target.closest?.('g[data-start]');
    if(ink&&this.score.contains(ink))return this.notes.find(n=>n.start===Number(ink.dataset.start));
    if(!row.range||y<row.pitchTop-9||y>row.pitchBottom+9)return null;
    const n=nearest(row.notes.map(w=>w.n),x,y,{x:t=>row.x(this.wrapped.quarter(t)),y:row.y,left:row.x(row.q),right:row.x(row.z)});
    return n&&x>=row.x(Math.max(row.q,this.wrapped.quarter(n.start)))-6&&x<=row.x(Math.min(row.z,this.wrapped.quarter(n.end)))+6?n:null;
   }
   if(!this.x)return null;
   if(y<this.top-12||y>this.bottom+10)return null;
   const note=nearest(this.notes,x,y,{x:this.x,y:this.y,left:this.viewport.scrollLeft,right:this.viewport.scrollLeft+this.viewport.clientWidth});
   return this.data.kind==='bass'&&note&&(x<this.x(note.start)-7||x>this.x(note.end)+7)?null:note;
  }
  highlight(note,held){
   this.hover=note;
   for(const group of this.score.querySelectorAll('g[data-start]')){
    const active=note&&Number(group.dataset.start)===note.start;
    group.classList.toggle('note-hover',!!active&&!held);group.classList.toggle('note-held',!!active&&held);
   }
  }
  cancelPreview(){this.gesture?.abort();this.gesture=null;this.keyboard=false;this.preview(null);this.highlight(null,false);}
  press(e){
   if(e.button!==0||!this.data||!this.canPreview())return;
   this.cancelPreview();const bar=(this.data.bars||this.bars).find(b=>b.number===Number(e.target.closest?.('[data-measure]')?.dataset.measure));
   const initial=bar?null:this.noteAt(e),controller=new AbortController(),started=e.timeStamp,x=e.clientX,y=e.clientY;
   this.gesture=controller;let held=initial,moved=false;
   if(initial){this.highlight(initial,true);this.preview(initial);}
   const finish=()=>this.cancelPreview();
   window.addEventListener('pointermove',next=>{if(next.pointerId!==e.pointerId)return;
    if(Math.hypot(next.clientX-x,next.clientY-y)>8)moved=true;
    if(moved&&e.pointerType==='touch'){this.manual=true;finish();return;}
    if(initial){const n=this.noteAt(next);if(n!==held){held=n;this.highlight(n,true);this.preview(n);}}
   },{signal:controller.signal});
   window.addEventListener('pointerup',next=>{if(next.pointerId!==e.pointerId)return;const tap=!moved&&next.timeStamp-started<250;finish();
    if(tap){const r=this.stage.getBoundingClientRect(),row=this.wrapped?.atY(next.clientY-r.top);
     this.seek(bar?(row?Math.max(row.start,bar.start):bar.start):initial?(row?Math.max(row.start,initial.start):initial.start):
      row?this.wrapped.timeAt(row,next.clientX-r.left):clamp((next.clientX-r.left-40)/this.pps,0,this.data.seconds));}
   },{signal:controller.signal});
   for(const event of ['pointercancel','lostpointercapture'])window.addEventListener(event,finish,{signal:controller.signal});
   this.viewport.addEventListener('contextmenu',event=>event.preventDefault(),{signal:controller.signal});
  }
  setData(data,hash,chart=null){
   this.cancelPreview();this.data=data;this.hash=hash;this.chart=chart;this.shift=0;this.notes=expand(data,hash,0,chart);this.root.hidden=!this.notes.length;this.trace.reset(0);
   this.wrapped=null;this.loopLayer=null;this.x=null;this.y=null;this.followed=null;
   this.viewport.toggleAttribute('data-wrapped',data?.kind==='bass');
   this.phrases.replaceChildren();
   if(!this.notes.length){this.data=null;return;}
   this.phrases.append(new Option('Jump to vocal entry',''));
   const sounding=new Set(this.notes.map(n=>n.phrase));
   data.phrases.forEach((p,i)=>{if(sounding.has(i))this.phrases.append(new Option(`${clock(p.times[0])} ${p.label}`,i));});
   this.root.querySelector('h2').title=data.provenance;this.manual=false;this.render();this.move(0,false,true);this.paintStats();
  }
  setMeasures(bars,beats=[]){this.bars=bars;this.beats=beats;if(this.data)this.render();}
  setLoop(range,enabled){
   this.loop=range?{...range,enabled}:null;
   if(this.wrapped){
    for(const r of this.wrapped.rows){
     r.loop.replaceChildren();if(!range||range.end<=r.start||range.start>=r.end)continue;
     const x=t=>r.x(this.wrapped.quarter(t)),a=x(Math.max(r.start,range.start)),b=x(Math.min(r.end,range.end));
     const top=r.top+18,end=(r.range?r.pitchBottom+6:r.bottom);
     r.loop.append(svg('rect',{x:a,y:top,width:b-a,height:end-top,class:'practice-loop-band'+(enabled?'':' is-disabled')}));
     for(const t of [range.start,range.end])if(t>=r.start&&t<=r.end)r.loop.append(svg('line',{x1:x(t),x2:x(t),y1:top,y2:end,class:'practice-loop-edge',opacity:enabled?1:.35}));
    }return;
   }
   if(!this.loopLayer||!this.x)return;
   this.loopLayer.replaceChildren();if(!range)return;
   const {start,end}=range;
   this.loopLayer.append(svg('rect',{x:this.x(start),y:20,width:(end-start)*this.pps,height:this.bottom-10,class:'practice-loop-band'+(enabled?'':' is-disabled')}));
   for(const t of [start,end])this.loopLayer.append(svg('line',{x1:this.x(t),x2:this.x(t),y1:20,y2:this.bottom+10,class:'practice-loop-edge',opacity:enabled?1:.35}));
  }
  settings(scale,stretch,shift){
   const keyChanged=this.shift!==shift;this.scale=scale;this.stretch=stretch;this.shift=shift;
   if(!this.data)return;
   this.notes=expand(this.data,this.hash,shift,this.chart);if(keyChanged)this.clear(this.time);this.render();this.move(this.time,false,true);
  }
  begin(from){this.trace.reset(from);this.manual=false;this.followed=null;this.dirty=true;this.paintStats();}
  clear(from=this.time){this.trace.reset(from);this.dirty=true;this.paintTrace();this.paintStats();}
  observe(frame){if(this.trace.append(frame))this.dirty=true;}
  partScroller(){
   if(getComputedStyle(this.viewport).overflowY==='auto')return this.viewport;
   return this.viewport.closest('main');
  }
  followRow(r,force){
   const owner=this.partScroller();if(!owner)return;
   const rect=owner.getBoundingClientRect(),stage=this.stage.getBoundingClientRect();
   if(owner!==this.viewport&&(stage.top>=rect.bottom||stage.bottom<=rect.top))return;
   const a=stage.top+r.top-rect.top,b=stage.top+r.bottom-rect.top,h=owner.clientHeight;
   if(a<0||b>h)owner.scrollTop+=a-Math.max(0,(h-(r.bottom-r.top))*(force ? .18 : .10));
  }
  renderPart(){
   const owner=this.partScroller(),old=this.wrapped,offset=owner?owner.getBoundingClientRect().top-this.stage.getBoundingClientRect().top:0;
   const bookmark=old&&this.manual&&offset>=0&&offset<old.height?old.atY(offset).start:null;
   const ctx=document.createElement('canvas').getContext('2d'),cache=new Map();
   const measure=(text,kind)=>{
    const key=kind+':'+text;if(!cache.has(key)){ctx.font=kind==='lyric'?'italic 14px Georgia,serif':'700 15px system-ui';
     cache.set(key,ctx.measureText(text).width);}return cache.get(key);
   };
   const part=this.wrapped=partRows.layout(this.data,this.notes,{width:this.renderWidth,stretch:this.stretch,
    scale:this.scale,shift:this.shift,chordName:this.chordName,measure});
   const pitchName=p=>this.chordName(name(p-this.shift).replace(/-?\d+$/,''),this.shift,this.data.key)+(Math.floor(p/12)-1);
   const content=document.createDocumentFragment(),ruler=this.data.bars;
   for(const r of part.rows){
    const a=r.segments[0].bar.number,b=r.segments.at(-1).bar.number,endX=r.x(r.z);
    const g=svg('g',{class:'pitch-system','data-first':a,'data-last':b,'data-start-time':r.start,'data-end-time':r.end,
     'aria-label':a===b?'Measure '+a:`Measures ${a} to ${b}`});
    if(r.range){
     g.dataset.low=r.range.lo;g.dataset.high=r.range.hi;
     for(const {p,degree} of r.range.guides)g.append(svg('line',{x1:part.left,x2:endX,y1:r.y(p),y2:r.y(p),class:'pitch-guide degree-'+degree,'data-pitch-guide':p}));
     g.append(svg('text',{x:part.left-5,y:r.y(r.range.ref)+3,'text-anchor':'end',class:'pitch-reference'},pitchName(r.range.ref)));
    }
    const edgeBottom=r.range?r.pitchBottom+6:r.bottom;
    r.loop=svg('g',{});g.append(r.loop);
    for(const [j,s] of r.segments.entries()){
     const bar=s.bar,x=r.x(s.q),continuation=s.q>bar.q+.00001;
     const mark=svg('g',{'data-measure':bar.number});
     mark.append(svg('line',{x1:x,x2:x,y1:r.top+16,y2:edgeBottom,class:'pitch-barline'}));
     mark.append(svg('text',{x:x+3,y:r.top+12,class:'pitch-measure'},bar.number+(continuation?' (cont.)':'')));
     if(!continuation&&(!j||ruler[bar.number-2]?.meter!==bar.meter))
      mark.append(svg('text',{x:x+24,y:r.top+12,class:'pitch-meter'},bar.meter));
     mark.append(svg('rect',{x,y:r.top,width:r.x(s.z)-x,height:18,class:'pitch-measure-hit'}));
     mark.append(svg('title',{},`Measure ${bar.number}, ${bar.meter}, ${clock(part.seconds(s.q))}`));g.append(mark);
    }
    g.append(svg('line',{x1:endX,x2:endX,y1:r.top+16,y2:edgeBottom,class:'pitch-barline'}));
    if(r.carried)g.append(svg('text',{x:part.left-5,y:r.top+31,'text-anchor':'end',class:'pitch-carried'},r.carried.text));
    for(const c of r.chords)g.append(svg('text',{x:r.x(c.q)+2,y:r.top+32,class:'pitch-chord','data-time':c.t,'data-chord':c.raw},c.text));
    const lyrics=new Map(r.lyrics.map(l=>[l.n,l]));
    for(const [j,w] of r.notes.entries()){
     const n=w.n,x=r.x(Math.max(w.q,r.q)),end=r.x(Math.min(w.z,r.z)),y=r.y(n.pitch);
     const group=svg('g',{'data-start':n.start,'data-pitch':n.pitch,'data-role':n.role});
     group.append(svg('rect',{x,y:y-3.5,width:Math.max(.8,end-x-(w.z<=r.z?1:0)),height:7,class:'harmony-note'}));
     group.append(svg('title',{},`${n.lyric||'melisma'}: ${pitchName(n.pitch)}, ${clock(n.start)}`));
     const next=r.notes[j+1];
     if(n.slurToNext&&next?.n.phrase===n.phrase&&Math.abs(next.q-w.z)<.0001){
      const y2=r.y(next.pitch);
      group.append(svg('path',{d:`M ${end-3} ${y} C ${end+2} ${y}, ${end-2} ${y2}, ${end+3} ${y2}`,class:'harmony-slur'}));
     }
     const l=lyrics.get(n);
     if(l)group.append(svg('text',{x:r.x(l.q)-l.before,y:r.base,class:'harmony-lyric'},n.lyric));
     g.append(group);
    }
    r.trace=svg('g',{class:'pitch-system-trace','aria-hidden':'true'});r.paths=new Map();g.append(r.trace);content.append(g);
   }
   this.score.replaceChildren(content);this.width=part.width;this.height=part.height;
   this.score.setAttribute('width',part.width);this.score.setAttribute('height',part.height);
   this.score.setAttribute('aria-label','Bass part with concert chords, wrapped by measure');
   this.stage.style.width=part.width+'px';this.stage.style.height=part.height+'px';
   this.setLoop(this.loop,this.loop?.enabled);this.paintPartTrace();this.followed=null;
   if(bookmark!==null&&owner)owner.scrollTop+=part.atTime(bookmark).top-offset;
   this.move(this.time,false);
  }
  paintPartTrace(){
   const part=this.wrapped,frames=this.trace.frames;
   if(part.frames!==frames){
    part.frames=frames;part.painted=0;part.prev=null;
    for(const r of part.rows){r.trace.replaceChildren();r.paths.clear();}
   }
   const dirty=new Set();
   for(;part.painted<frames.length;part.painted++){
    const f=frames[part.painted],t=(f.start+f.end)/2,r=part.atTime(t),p=f.cents/100;
    if(!Number.isFinite(f.cents)||!r.range||t<r.start||t>=r.end||p<r.range.lo-.5||p>r.range.hi+.5){part.prev=null;continue;}
    const x=r.x(part.quarter(t)).toFixed(2),y=r.y(p).toFixed(2),n=target(this.notes,t);
    const color=errorColor(n?grade.octaveError(f.cents-100*n.pitch):100);
    let path=r.paths.get(color);
    if(!path){
     path={el:svg('path',{stroke:color}),d:''};r.trace.append(path.el);r.paths.set(color,path);
    }
    const prev=part.prev;
    path.d+=prev&&prev.r===r&&f.start-prev.end<.05&&Math.abs(prev.pitch-p)<5?
     (prev.path===path?'':`M${prev.x} ${prev.y}`)+`L${x} ${y}`:`M${x} ${y}l0 .1`;
    part.prev={r,path,x,y,end:f.end,pitch:p};dirty.add(path);
   }
   for(const p of dirty)p.el.setAttribute('d',p.d);
  }
  render(){
   if(!this.data)return;
   this.cancelPreview();
   this.renderWidth=this.viewport.clientWidth;
   if(this.data.kind==='bass'){if(this.renderWidth)this.renderPart();return;}
   this.score.setAttribute('aria-label','Harmony pitchbars');
   const minNote=Math.min(...this.notes.map(n=>n.pitch)),maxNote=Math.max(...this.notes.map(n=>n.pitch));
   // This reference lane stays bounded by its written part, never microphone errors.
   this.low=minNote;this.high=maxNote;
   const chords=this.data.chords||[];
   this.step=12*this.scale/100;this.top=chords.length?57:28;this.bottom=this.top+(this.high-this.low)*this.step;
   const shortest=Math.min(...this.notes.map(n=>n.end-n.start));this.pps=16/shortest*this.stretch/100;
   if(chords.length>1){
    const measure=document.createElement('canvas').getContext('2d');measure.font='bold 15px system-ui';
    for(let i=1;i<chords.length;i++)this.pps=Math.max(this.pps,(measure.measureText(this.chordName(chords[i-1][1],this.shift,this.data.key)).width+6)/(chords[i][0]-chords[i-1][0]));
   }
   this.width=Math.max(this.viewport.clientWidth,80+this.data.seconds*this.pps);
   const y=p=>this.top+(this.high-p)*this.step,x=t=>40+t*this.pps;this.y=y;this.x=x;
   const content=document.createDocumentFragment();
   for(let p=this.low;p<=this.high;p++){
    const degree=((p-(this.data.tonic+this.shift))%12+12)%12;
    if([0,4,7].includes(degree))content.append(svg('line',{x1:0,y1:y(p),x2:this.width,y2:y(p),class:`pitch-guide degree-${degree}`}));
   }
   this.loopLayer=svg('g',{});content.append(this.loopLayer);
   for(const t of this.data.bars?[]:this.beats)content.append(svg('line',{x1:x(t),x2:x(t),y1:24,y2:this.bottom+10,class:'pitch-beatline'}));
   const ruler=this.data.bars||this.bars;
   if(ruler.length){
    for(const [i,b] of ruler.entries()){
     const g=svg('g',{'data-measure':b.number});
     g.append(svg('line',{x1:x(b.start),x2:x(b.start),y1:23,y2:this.bottom+10,class:'pitch-barline'}));
     g.append(svg('text',{x:x(b.start)+4,y:14,class:'pitch-measure'},b.number));
     if(!i||b.meter!==ruler[i-1].meter)g.append(svg('text',{x:x(b.start)+25,y:14,class:'pitch-meter'},b.meter));
     g.append(svg('rect',{x:x(b.start),y:0,width:(b.end-b.start)*this.pps,height:23,class:'pitch-measure-hit'}));
     g.append(svg('title',{},`Measure ${b.number}, ${b.meter}, ${clock(b.start)}; select measure`));content.append(g);
    }
   }else for(let t=0;t<=this.data.seconds;t+=2)content.append(svg('text',{x:x(t),y:14,class:'pitch-second'},clock(t)));
   for(const [t,ch] of chords)content.append(svg('text',{x:x(t)+2,y:38,class:'pitch-chord','data-time':t,'data-chord':ch},this.chordName(ch,this.shift,this.data.key)));
   const measure=document.createElement('canvas').getContext('2d');measure.font='italic 14px Georgia';const ends=[];
   for(const [i,n] of this.notes.entries()){
    const group=svg('g',{'data-start':n.start,'data-pitch':n.pitch,'data-role':n.role});
    group.append(svg('rect',{x:x(n.start),y:y(n.pitch)-4,width:Math.max(1,(n.end-n.start)*this.pps-1),height:8,class:'harmony-note'}));
    group.append(svg('title',{},`${n.lyric||'melisma'}: ${name(n.pitch)}, ${n.start.toFixed(2)} s`));
    const next=this.notes[i+1];
    if(n.slurToNext&&next?.phrase===n.phrase){
     const edge=x(n.end),from=y(n.pitch),to=y(next.pitch);
     group.append(svg('path',{d:`M ${edge-4} ${from} C ${edge+3} ${from}, ${edge-3} ${to}, ${edge+4} ${to}`,class:'harmony-slur'}));
    }
    if(n.lyric){const left=x(n.start)-measure.measureText(n.lyric[0]).width/2,w=measure.measureText(n.lyric).width;let row=ends.findIndex(v=>v+7<left);if(row<0)row=ends.length;ends[row]=left+w;
     group.append(svg('text',{x:left,y:this.bottom+25+row*19,class:'harmony-lyric'},n.lyric));}
    content.append(group);
   }
   this.height=this.bottom+35+Math.max(1,ends.length)*19;
   this.score.replaceChildren(content);this.score.setAttribute('width',this.width);this.score.setAttribute('height',this.height);
   this.stage.style.width=this.width+'px';this.stage.style.height=this.height+'px';this.cursor.style.height=this.bottom+9+'px';
   this.setLoop(this.loop,this.loop?.enabled);
   this.paintTrace();this.dirty=true;
  }
  move(time,playing,force=false){
   this.time=time;if(!this.data)return;const v=this.viewport;
   if(this.data.kind==='bass'){
    if(!this.wrapped||!v.clientWidth)return;
    const r=this.wrapped.atTime(time),x=r.x(this.wrapped.quarter(time));
    this.cursor.style.transform=`translate(${x}px,${r.top}px)`;
    this.cursor.style.height=((r.range?r.pitchBottom+6:r.bottom)-r.top-20)+'px';
    if(force)this.manual=false;
    if(force||playing&&!this.manual&&r!==this.followed)this.followRow(r,force);
    this.followed=r;
   }else{
   if(!this.x)return;const x=this.x(time);
   this.cursor.style.transform=`translateX(${x}px)`;
   if(force){this.manual=false;v.scrollLeft=clamp(x-80,0,this.width-v.clientWidth);}
   else if(playing&&!this.manual&&(x>v.scrollLeft+v.clientWidth*.82||x<v.scrollLeft+35))v.scrollLeft=clamp(x-v.clientWidth*.22,0,this.width-v.clientWidth);
   }
   const now=performance.now();if(force||this.dirty&&now-this.lastPaint>70){this.paintTrace();this.lastPaint=now;}
   if(now-(this.lastStats||0)>300){this.paintStats();this.lastStats=now;}
  }
  paintTrace(){
   if(this.wrapped){this.paintPartTrace();this.dirty=false;return;}
   if(!this.data||!this.y)return;this.dirty=false;
   const dpr=Math.min(2,window.devicePixelRatio||1),w=this.viewport.clientWidth,h=this.height,left=this.viewport.scrollLeft,c=this.canvas.getContext('2d');
   this.canvas.width=Math.ceil(w*dpr);this.canvas.height=Math.ceil(h*dpr);this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';this.canvas.style.left=left+'px';c.scale(dpr,dpr);
   const style=getComputedStyle(this.root);c.fillStyle=style.getPropertyValue('--bg');c.fillRect(0,18,36,this.bottom-10);c.fillStyle=style.getPropertyValue('--muted');c.font='11px system-ui';
   const carried=this.data.chords?.findLast(([t])=>this.x(t)+2<left+36);
   if(carried){
    c.save();c.beginPath();c.rect(0,20,36,22);c.clip();c.font='600 12px system-ui';
    c.fillText(this.chordName(carried[1],this.shift,this.data.key),3,38);c.restore();
   }
   for(let p=this.low;p<=this.high;p++)if(((p-this.data.tonic-this.shift)%12+12)%12===0)c.fillText(name(p),3,this.y(p)+3);
   // Preserve raw outliers for scoring, but don't paint them over lyrics or the ruler.
   c.save();c.beginPath();c.rect(36,this.top-5,Math.max(0,w-36),this.bottom-this.top+10);c.clip();
   let last=null;
   for(const f of this.trace.frames){
    const t=(f.start+f.end)/2,xx=this.x(t)-left;
    if(!Number.isFinite(f.cents)||xx<36||xx>w){last=null;continue;}
    const pitch=f.cents/100;
    const n=target(this.notes,t),error=n?grade.octaveError(f.cents-n.pitch*100):100;
    const yy=this.y(pitch);c.strokeStyle=errorColor(error);c.fillStyle=c.strokeStyle;c.lineWidth=1.7;
    if(last&&f.start-last.end<.05&&Math.abs(last.pitch-pitch)<5){c.beginPath();c.moveTo(last.x,last.y);c.lineTo(xx,yy);c.stroke();}
    else{c.beginPath();c.arc(xx,yy,1.3,0,Math.PI*2);c.fill();}
    last={x:xx,y:yy,end:f.end,pitch};
   }
   c.restore();
  }
  paintStats(){
   const result=assess(this.trace.frames,this.notes,this.trace.from,this.trace.to),fields={tracked:result?.expectedSeconds?`${(result.coverage*100).toFixed(1)}%`:null,mean:result?.meanAbsCents?.toFixed(1),median:result?.medianAbsCents?.toFixed(1),within:result?.trackedSeconds?`${(100*result.within50CentsSeconds/result.trackedSeconds).toFixed(1)}%`:null};
   for(const [k,v]of Object.entries(fields))this.stats.querySelector(`[data-stat=${k}]`).textContent=v??'\u2014';
  }
 }
 return {expand,phraseRole,nearest,target,errorColor,assess,outputTime,sourceTime,Trace,Sampler,View};
});
