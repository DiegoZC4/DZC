/* Compact, precomputed envelopes; transport remains owned by the audition player. */
(function(root){
  'use strict';
  const clamp=x=>Math.max(0,Math.min(1,x));
  // While downbeats are being edited, room after the last bar line so it can move later.
  const EDIT_TAIL=1;
  // With a recording, the lanes begin at the count-in downbeat (start), before the first note.
  function fraction(tick,endTick,map,start=map?.start,end=map?.end){
    return clamp(map?(map.seconds(tick)-start)/(end-start):tick/endTick);
  }
  function tickAt(f,endTick,map,start=map?.start,end=map?.end){return map?map.tick(start+clamp(f)*(end-start)):clamp(f)*endTick;}
  // Playback reports recording time, which moves through the count-in; at rest,
  // the excerpt's start is the count-in downbeat, where playback begins.
  function playheadAt(d,tick,media){
    if(!d)return 0;
    if(d.map&&Number.isFinite(media))return clamp((media-d.start)/((d.end??d.map.end)-d.start));
    return tick<=0?0:fraction(tick,d.endTick,d.map,d.start,d.end);
  }
  function peakAt(envelope,time){
    if(!envelope?.peaks?.length||time<envelope.start||time>=envelope.end)return 0;
    return envelope.peaks[Math.min(envelope.peaks.length-1,Math.floor((time-envelope.start)/(envelope.end-envelope.start)*envelope.peaks.length))]/255;
  }
  function bounds(d){
    const start=Math.min(d.start??d.map.start,d.map.start),cut=d.playbackEnd??d.cut?.end??Math.max(d.map.end,d.beatMap?.end??-Infinity);
    return {start,end:d.edit?Math.max(cut,d.map.end,d.beatMap?.end??-Infinity)+EDIT_TAIL:cut};
  }
  function audiblePeak(envelope,time,cut){
    if(cut&&(time<cut.start||time>=cut.end||time>=cut.fadeOut?.end))return 0;
    // The outro fade is baked into the MP3; only the runtime entrance ramp is applied here.
    const fade=cut?.fadeIn,gain=fade?clamp((time-fade.start)/(fade.end-fade.start)):1;
    return peakAt(envelope,time)*gain;
  }
  class View{
    constructor(element,canvas,cursor,onSeek){
      Object.assign(this,{element,canvas,cursor,onSeek,data:null,position:0,enabled:true,onDrag:null,dragging:null});
      const seek=e=>{const box=element.getBoundingClientRect();onSeek(clamp((e.clientX-box.left)/box.width));};
      element.addEventListener('pointerdown',e=>{
        if(!this.enabled||e.button!==0)return;e.preventDefault();element.focus();
        const tick=this.handleAt(e)?.tick;if(tick===undefined){seek(e);return;}
        // A click on a grid handle still seeks; only a drag moves that bar line or beat.
        const x0=e.clientX;let moved=false;element.setPointerCapture?.(e.pointerId);
        const move=ev=>{if(!moved&&Math.abs(ev.clientX-x0)<3)return;moved=true;this.dragging={tick,seconds:this.secondsAt(ev)};this.onDrag(tick,this.dragging.seconds,false);};
        const up=ev=>{for(const [name,fn] of [['pointermove',move],['pointerup',up],['pointercancel',up]])element.removeEventListener(name,fn);
          const seconds=this.dragging?.seconds;this.dragging=null;if(moved&&ev.type==='pointerup')this.onDrag(tick,seconds,true);else if(moved)this.onDrag(tick,null,true);else seek(ev);};
        for(const [name,fn] of [['pointermove',move],['pointerup',up],['pointercancel',up]])element.addEventListener(name,fn);
      });
      element.addEventListener('pointermove',e=>{if(!this.dragging)element.style.cursor=this.enabled&&this.handleAt(e)?'ew-resize':'';});
      element.addEventListener('keydown',e=>{
        if(!this.enabled)return;
        let value=this.position;
        if(e.key==='ArrowRight')value+=.01;else if(e.key==='ArrowLeft')value-=.01;
        else if(e.key==='Home')value=0;else if(e.key==='End')value=1;else return;
        e.preventDefault();onSeek(clamp(value));
      });
      this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(element);
    }
    set(data){
      if(data?.map)Object.assign(data,bounds(data));
      this.data=data;this.draw();
    }
    // Temporary beat review: onDrag(tick, seconds, done) receives bar line and beat moves.
    editable(onDrag){this.onDrag=onDrag;this.draw();}
    // A handle on every grid anchor and every beat of grid {bars, beats} between the first and last anchor.
    handles(){
      const d=this.data;if(!this.onDrag||!d?.map||!d.beatMap||!d.edit)return [];
      const {anchors}=d.beatMap,bars=new Set(d.grid?.bars||[]),first=anchors[0][0],last=anchors.at(-1)[0];
      const ticks=new Set([...anchors.map(p=>p[0]),...(d.grid?.beats||[]).filter(t=>t>first&&t<last)]);
      return [...ticks].sort((a,b)=>a-b).map(tick=>({tick,seconds:d.beatMap.seconds(tick),bar:bars.has(tick)}));
    }
    secondsAt(e){const d=this.data,box=this.element.getBoundingClientRect();return d.start+clamp((e.clientX-box.left)/box.width)*(d.end-d.start);}
    handleAt(e){
      const box=this.element.getBoundingClientRect(),x=e.clientX-box.left,d=this.data;let best=null,distance=10;
      for(const h of this.handles()){const gap=Math.abs((h.seconds-d.start)/(d.end-d.start)*box.width-x);if(gap<distance){best=h;distance=gap;}}
      return best;
    }
    at(tick,media){return playheadAt(this.data,tick,media);}
    tick(f){const d=this.data;return d?tickAt(f,d.endTick,d.map,d.start,d.end):0;}
    seekable(enabled){this.enabled=enabled;this.element.setAttribute('aria-disabled',String(!enabled));}
    move(value,label){
      this.position=clamp(value);this.cursor.style.left=`${this.position*100}%`;
      this.element.setAttribute('aria-valuenow',String(Math.round(this.position*100)));
      if(label)this.element.setAttribute('aria-valuetext',label);
    }
    draw(){
      const width=this.element.clientWidth,height=124,ratio=window.devicePixelRatio||1;
      if(!width)return;
      this.canvas.width=Math.round(width*ratio);this.canvas.height=Math.round(height*ratio);
      const ctx=this.canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);
      const d=this.data;if(!d)return;
      const css=getComputedStyle(this.element),line=css.getPropertyValue('--line').trim(),muted=css.getPropertyValue('--muted').trim();
      const colours=['#5ba9be','#c28c55','#8caa72'];
      const xAt=seconds=>clamp((seconds-d.start)/(d.end-d.start))*width;
      const xTick=tick=>d.map&&d.beatMap?xAt(d.beatMap.seconds(tick)):fraction(tick,d.endTick,d.map,d.start,d.end)*width;
      const count=d.map?d.count||[]:[];
      ctx.strokeStyle=line;ctx.fillStyle=muted;ctx.font='10px system-ui';ctx.textBaseline='middle';
      if(count.length){
        const end=xTick(0);
        ctx.fillStyle=css.getPropertyValue('--accent').trim();ctx.globalAlpha=.08;ctx.fillRect(0,16,end,height-16);
        ctx.globalAlpha=1;ctx.fillStyle=muted;
        for(const b of count)if(b.label===1){const x=xAt(b.seconds);ctx.beginPath();ctx.moveTo(x,16);ctx.lineTo(x,height);ctx.stroke();}
        if(end>=52)ctx.fillText('Count-in',3,8);
      }
      let last=-80;const handles=this.handles();
      for(const [i,m] of d.measures.entries()){
        if(d.map&&d.beatMap.seconds(m[0])>=d.end-1e-7)continue;
        const x=xTick(m[0]);
        ctx.beginPath();ctx.moveTo(x,16);ctx.lineTo(x,height);ctx.stroke();
        if(x>last+40&&x<width-12){ctx.fillText(String(i+1),x+(handles.length?7:3),8);last=x;}
      }
      if(handles.length){
        const accent=css.getPropertyValue('--accent').trim();
        for(const {tick,seconds,bar} of handles){
          const x=xAt(seconds),size=bar?5:3.5;
          ctx.fillStyle=bar?accent:muted;ctx.beginPath();ctx.moveTo(x-size,1);ctx.lineTo(x+size,1);ctx.lineTo(x,2+size*1.6);ctx.closePath();ctx.fill();
          if(this.dragging?.tick===tick){ctx.strokeStyle=accent;ctx.beginPath();ctx.moveTo(x,16);ctx.lineTo(x,height);ctx.stroke();ctx.strokeStyle=line;
            ctx.fillStyle=accent;const text=`${seconds.toFixed(3)} s`;ctx.fillText(text,Math.min(width-ctx.measureText(text).width-2,x+7),24);}
        }
        ctx.fillStyle=muted;
      }
      for(let row=0;row<3;row++){
        const top=16+row*36,mid=top+18;
        ctx.strokeStyle=line;ctx.globalAlpha=1;ctx.beginPath();ctx.moveTo(0,top+36);ctx.lineTo(width,top+36);ctx.stroke();
        ctx.fillStyle=colours[row];ctx.globalAlpha=d.active[row]?1:.3;
        if(row<2){
          ctx.globalAlpha=.2;ctx.strokeStyle=colours[row];ctx.beginPath();ctx.moveTo(0,mid);ctx.lineTo(width,mid);ctx.stroke();
          ctx.globalAlpha=d.active[row]?1:.3;
          const envelope=d.map&&d.envelopes?.[row===0?'vocal':'backing'];
          if(envelope){for(let x=0;x<width;x+=2){
            const t=d.start+(x+.5)/width*(d.end-d.start),amplitude=audiblePeak(envelope,t,d.cut);
            if(amplitude<=0)continue;
            const h=amplitude*27;ctx.fillRect(x,mid-h/2,1.5,h);
          }}else{ctx.fillStyle=muted;ctx.font='11px system-ui';ctx.fillText('Waveform pending',8,mid);}
        }else if(row===2)for(const b of [...count.map(b=>({x:xAt(b.seconds),label:b.label})),...d.beats.filter(b=>!d.map||d.beatMap.seconds(b.tick)<d.end-1e-7).map(b=>({x:xTick(b.tick),label:b.label}))]){
          const h=b.label===1?24:13;ctx.fillRect(b.x,mid-h/2,b.label===1?2:1.5,h);
        }
      }
      ctx.globalAlpha=1;
      if(d.cut){
        const end=Math.min(width-1,xAt(d.cut.end));
        ctx.strokeStyle=muted;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(end,16);ctx.lineTo(end,height);ctx.stroke();
        if(Number.isFinite(d.cut.loopStart)){
          const x=xAt(d.cut.loopStart);ctx.fillStyle=css.getPropertyValue('--accent').trim();
          ctx.beginPath();ctx.moveTo(x,16);ctx.lineTo(x+6,16);ctx.lineTo(x,22);ctx.closePath();ctx.fill();
        }
        ctx.textAlign='left';ctx.lineWidth=1;
        this.element.title=`Audio ends at ${d.cut.end.toFixed(3)} s`;
      }
    }
  }
  const api={fraction,tickAt,playheadAt,peakAt,bounds,audiblePeak,View};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MeleteWaveformLanes=api;
})(globalThis);
