/* Measure-selected loops over an exact recording's source-time map. */
(function(root){'use strict';
function measures(map,duration){
 if(!(duration>0)||!Array.isArray(map?.downbeats)||!map.downbeats.length)return [];
 const starts=map.firstDownbeatIsBarOne?[]:[0];
 for(const t of map.downbeats){
  if(!Number.isFinite(t)||t<0||t>=duration||t<starts.at(-1))return [];
  if(!starts.length||t>starts.at(-1)+.02)starts.push(t);
 }
 return starts.map((start,i)=>{
  const end=starts[i+1]??duration,review=map.meterReview?.bars?.find(b=>Math.abs(b.start-start)<.02);
  const labels=map.times?.flatMap((t,j)=>t>=start-.00001&&t<end-.00001?[map.beatLabels?.[j]]:[])||[];
  return {number:i+1,start,end,meter:review?.meter||(Math.max(...labels.filter(Number.isFinite))===3?'3/4':'4/4')};
 });
}
function at(bars,time){
 let lo=0,hi=bars.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(bars[mid].start<=time+1e-7)lo=mid+1;else hi=mid;}
 return bars[Math.max(0,lo-1)]||null;
}
function range(state,bars){
 const start=state?.start??1,end=state?.end;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>bars.length)return null;
 return {start:bars[start-1].start,end:bars[end-1].end};
}
function point(state,kind,number){
 const next={...state,enabled:true,[kind]:number};
 if(kind==='start'&&next.end<number)next.end=null;
 if(kind==='end'&&(next.start??1)>number)next.start=null;
 return next;
}
function position(time,start,end,loop){
 const n=cycle(time,start,end,loop);
 return n?Math.max(start,time-n*(end-start)):Math.min(time,end);
}
function cycle(time,start,end,loop){return loop&&end>start&&time+1e-8>=end?1+Math.floor((time-end+1e-8)/(end-start)):0;}
function bindPoint(button,activate,clear){
 let press=null,suppress=false;
 const cancel=()=>{if(press)clearTimeout(press.timer);press=null;button.classList.remove('holding');};
 button.addEventListener('pointerdown',e=>{
  if(e.button!==0||button.disabled)return;cancel();suppress=false;
  const p={id:e.pointerId,x:e.clientX,y:e.clientY};press=p;button.classList.add('holding');
  p.timer=setTimeout(()=>{if(press!==p)return;suppress=true;cancel();clear();},600);
 });
 window.addEventListener('pointermove',e=>{if(press&&e.pointerId===press.id&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>8){suppress=true;cancel();}});
 window.addEventListener('pointerup',cancel);
 for(const event of ['pointercancel','blur'])window.addEventListener(event,()=>{if(press)suppress=true;cancel();});
 button.addEventListener('pointerleave',()=>{if(press){suppress=true;cancel();}});
 button.addEventListener('click',e=>{if(suppress){suppress=false;e.preventDefault();return;}activate();});
 button.addEventListener('contextmenu',e=>e.preventDefault());
 button.addEventListener('keydown',e=>{if((e.shiftKey&&e.key==='Enter')||e.key==='Delete'||e.key==='Backspace'){e.preventDefault();if(!e.repeat)clear();}});
}
const api={measures,at,range,point,position,cycle,bindPoint};
root.MeleteFullPracticeLoop=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
