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
const minTime=.05;
function mode(state,bars){return !bars.length||state?.mode==='time'?'time':'bars';}
function range(state,bars,duration){
 if(mode(state,bars)==='time'){
  const start=state?.start??0,end=state?.end;
  return Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end<=duration&&end-start>=minTime?{start,end}:null;
 }
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
function timePoint(state,kind,time,duration){
 const n=Math.min(duration,Math.max(0,time));
 if(!Number.isFinite(n)||(kind==='end'?n<minTime:duration-n<minTime))return state;
 const next={...state,mode:'time',[kind]:n,enabled:true};
 if(kind==='start'&&Number.isFinite(next.end)&&next.end-n<minTime)next.end=null;
 if(kind==='end'&&n-(next.start??0)<minTime)next.start=null;
 return next;
}
function whole(state,bars,duration){
 return mode(state,bars)==='time'?{...state,mode:'time',start:0,end:duration,enabled:true}:
  {...state,start:1,end:bars.length,enabled:true};
}
// Taylor's former numbered bars were dotted beats. Preserve the recording
// interval, using time mode only when an old endpoint bisects a new bar.
function pairLegacyBars(stored,pulses,duration){
 if(!stored||stored.barRevision===2)return stored;
 const seconds=(n,end)=>n==null?null:(end&&n===pulses.length?duration:pulses[n-(end?0:1)]);
 function convert(s){
  if([s.start,s.end].some(n=>n!=null&&(!Number.isInteger(n)||n<1||n>pulses.length)))return null;
  if((s.start==null||s.start%2===1)&&(s.end==null||s.end%2===0))
   return {mode:'bars',start:s.start==null?null:(s.start+1)/2,end:s.end==null?null:s.end/2};
  return {mode:'time',start:seconds(s.start,false),end:seconds(s.end,true)};
 }
 const saved={...stored.saved},alt=saved.bars&&convert(saved.bars);
 if(alt?.mode==='bars')saved.bars={start:alt.start,end:alt.end};else delete saved.bars;
 const current=stored.mode==='time'?stored:convert(stored);
 return current?{...stored,...current,saved,barRevision:2}:null;
}
function restore(stored,bars,duration,sourceVersion){
 if(!stored||stored.sourceVersion!==sourceVersion||!(duration>0))return null;
 const unit=mode(stored,bars);
 if(!['time','bars',undefined].includes(stored.mode)||(!bars.length&&stored.mode!=='time'&&(stored.start!=null||stored.end!=null)))return null;
 const valid=n=>n==null||(unit==='time'?Number.isFinite(n)&&n>=0&&n<=duration:Number.isInteger(n)&&n>=1&&n<=bars.length);
 if(!valid(stored.start)||!valid(stored.end))return null;
 if(!bars.length&&!stored.mode&&stored.enabled)return whole({},bars,duration); // Old full-recording loop.
 return {...stored,mode:unit};
}
function switchMode(state,bars,duration){
 if(!bars.length)return state;
 const old=mode(state,bars),unit=old==='bars'?'time':'bars';
 const previous={start:state.start??null,end:state.end??null};
 const saved={...state.saved,[old]:previous};
 const converted=unit==='time'?{start:bars[state.start-1]?.start??null,end:bars[state.end-1]?.end??null}:
  {start:state.start==null?null:at(bars,state.start).number,end:state.end==null?null:at(bars,Math.max(0,state.end-1e-6)).number};
 return {...state,mode:unit,saved,...(saved[unit]||converted)};
}
function timeLabel(t){const n=Math.round(t*100);return Math.floor(n/6000)+':'+String(Math.floor(n/100)%60).padStart(2,'0')+'.'+String(n%100).padStart(2,'0');}
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
const api={measures,at,range,point,mode,timePoint,whole,restore,pairLegacyBars,switchMode,timeLabel,position,cycle,bindPoint};
root.MeleteFullPracticeLoop=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
