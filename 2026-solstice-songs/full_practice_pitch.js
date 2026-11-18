/* Full-recording adapter for Melete's shared detector, audio clock and grading. */
(function(root,factory){const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('../template/take_pitch.js'):root.MeleteTakePitch,
  common?require('../template/microphone_check.js'):root.MeleteMicrophoneCheck,
  common?require('./full_practice_loop.js'):root.MeleteFullPracticeLoop);
 if(common)module.exports=api;else root.MeleteFullPracticePitch=api;
})(globalThis,function(grade,mic,loops){
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
  constructor({root,viewport,stage,score,canvas,cursor,phrases,stats,seek,preview=()=>{},canPreview=()=>true}){
   Object.assign(this,{root,viewport,stage,score,canvas,cursor,phrases,stats,seek,preview,canPreview});this.trace=new Trace();this.notes=[];this.bars=[];this.beats=[];this.loop=null;this.scale=100;this.stretch=100;this.shift=0;this.time=0;this.lastPaint=0;this.manual=false;
   viewport.addEventListener('scroll',()=>{this.cancelPreview();this.dirty=true;if(!this.scrollPaint)this.scrollPaint=requestAnimationFrame(()=>{this.scrollPaint=null;this.paintTrace();});});
   window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>this.paintTrace());
   viewport.addEventListener('wheel',()=>{this.manual=true;},{passive:true});
   viewport.addEventListener('pointerdown',e=>this.press(e));
   viewport.addEventListener('pointermove',e=>{if(!this.gesture&&e.pointerType!=='touch')this.highlight(this.canPreview()?this.noteAt(e):null,false);});
   viewport.addEventListener('pointerleave',()=>{if(!this.gesture)this.highlight(null,false);});
   viewport.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key)||e.repeat||!this.canPreview())return;e.preventDefault();e.stopPropagation();this.keyboard=true;const n=this.hover||target(this.notes,this.time)||this.notes.find(n=>n.start>=this.time);if(n){this.highlight(n,true);this.preview(n);}});
   viewport.addEventListener('keyup',e=>{if(this.keyboard&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();this.cancelPreview();}});
   viewport.addEventListener('blur',()=>this.cancelPreview());
   window.addEventListener('blur',()=>this.cancelPreview());
   document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancelPreview();});
   phrases.onchange=()=>{const p=this.data?.phrases[Number(phrases.value)];if(p)seek(Math.max(0,p.times[0]-.8));};
   this.resize=new ResizeObserver(()=>{if(this.data)this.render();});this.resize.observe(viewport);
  }
  noteAt(e){
   if(!this.data||!this.x)return null;const r=this.stage.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
   if(y<this.top-12||y>this.bottom+10)return null;
   return nearest(this.notes,x,y,{x:this.x,y:this.y,left:this.viewport.scrollLeft,right:this.viewport.scrollLeft+this.viewport.clientWidth});
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
   this.cancelPreview();const bar=this.bars[Number(e.target.closest?.('[data-measure]')?.dataset.measure)-1];
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
    if(tap){const r=this.stage.getBoundingClientRect();this.seek(bar?bar.start:initial?initial.start:clamp((next.clientX-r.left-40)/this.pps,0,this.data.seconds));}
   },{signal:controller.signal});
   for(const event of ['pointercancel','lostpointercapture'])window.addEventListener(event,finish,{signal:controller.signal});
   this.viewport.addEventListener('contextmenu',event=>event.preventDefault(),{signal:controller.signal});
  }
  setData(data,hash,chart=null){
   this.cancelPreview();this.data=data;this.hash=hash;this.chart=chart;this.shift=0;this.notes=expand(data,hash,0,chart);this.root.hidden=!this.notes.length;this.trace.reset(0);
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
  begin(from){this.trace.reset(from);this.manual=false;this.dirty=true;this.paintStats();}
  clear(from=this.time){this.trace.reset(from);this.dirty=true;this.paintTrace();this.paintStats();}
  observe(frame){if(this.trace.append(frame))this.dirty=true;}
  render(){
   if(!this.data)return;
   this.cancelPreview();
   const minNote=Math.min(...this.notes.map(n=>n.pitch)),maxNote=Math.max(...this.notes.map(n=>n.pitch));
   // This reference lane stays bounded by its written part, never microphone errors.
   this.low=minNote;this.high=maxNote;
   this.step=12*this.scale/100;this.top=28;this.bottom=this.top+(this.high-this.low)*this.step;
   const shortest=Math.min(...this.notes.map(n=>n.end-n.start));this.pps=16/shortest*this.stretch/100;
   this.width=Math.max(this.viewport.clientWidth,80+this.data.seconds*this.pps);
   const y=p=>this.top+(this.high-p)*this.step,x=t=>40+t*this.pps;this.y=y;this.x=x;
   const content=document.createDocumentFragment();
   for(let p=this.low;p<=this.high;p++){
    const degree=((p-(this.data.tonic+this.shift))%12+12)%12;
    if([0,4,7].includes(degree))content.append(svg('line',{x1:0,y1:y(p),x2:this.width,y2:y(p),class:`pitch-guide degree-${degree}`}));
   }
   this.loopLayer=svg('g',{});content.append(this.loopLayer);
   for(const t of this.beats)content.append(svg('line',{x1:x(t),x2:x(t),y1:24,y2:this.bottom+10,class:'pitch-beatline'}));
   if(this.bars.length){
    for(const [i,b] of this.bars.entries()){
     const g=svg('g',{'data-measure':b.number});
     g.append(svg('line',{x1:x(b.start),x2:x(b.start),y1:23,y2:this.bottom+10,class:'pitch-barline'}));
     g.append(svg('text',{x:x(b.start)+4,y:14,class:'pitch-measure'},b.number));
     if(!i||b.meter!==this.bars[i-1].meter)g.append(svg('text',{x:x(b.start)+25,y:14,class:'pitch-meter'},b.meter));
     g.append(svg('rect',{x:x(b.start),y:0,width:(b.end-b.start)*this.pps,height:23,class:'pitch-measure-hit'}));
     g.append(svg('title',{},`Measure ${b.number}, ${b.meter}, ${clock(b.start)}; select measure`));content.append(g);
    }
   }else for(let t=0;t<=this.data.seconds;t+=2)content.append(svg('text',{x:x(t),y:14,class:'pitch-second'},clock(t)));
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
   this.time=time;if(!this.data)return;const x=this.x(time),v=this.viewport;
   this.cursor.style.transform=`translateX(${x}px)`;
   if(force){this.manual=false;v.scrollLeft=clamp(x-80,0,this.width-v.clientWidth);}
   else if(playing&&!this.manual&&(x>v.scrollLeft+v.clientWidth*.82||x<v.scrollLeft+35))v.scrollLeft=clamp(x-v.clientWidth*.22,0,this.width-v.clientWidth);
   const now=performance.now();if(force||this.dirty&&now-this.lastPaint>70){this.paintTrace();this.lastPaint=now;}
   if(now-(this.lastStats||0)>300){this.paintStats();this.lastStats=now;}
  }
  paintTrace(){
   if(!this.data||!this.y)return;this.dirty=false;
   const dpr=Math.min(2,window.devicePixelRatio||1),w=this.viewport.clientWidth,h=this.height,left=this.viewport.scrollLeft,c=this.canvas.getContext('2d');
   this.canvas.width=Math.ceil(w*dpr);this.canvas.height=Math.ceil(h*dpr);this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';this.canvas.style.left=left+'px';c.scale(dpr,dpr);
   const style=getComputedStyle(this.root);c.fillStyle=style.getPropertyValue('--bg');c.fillRect(0,18,36,this.bottom-10);c.fillStyle=style.getPropertyValue('--muted');c.font='11px system-ui';
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
