/* Independent recording-aligned pulse with sample-clock scheduling. */
(function(root){'use strict';
function validTimes(data,duration){if(!data||!Array.isArray(data.times))return [];let last=-1;return data.times.filter(t=>{if(!Number.isFinite(t)||t<0||t>=duration||t<=last)return false;last=t;return true;});}
const GUIDE_PERIOD=.6;
function edgePeriod(beats){
 const gaps=beats.slice(1).map((v,i)=>v-beats[i]).sort((a,b)=>a-b),mid=gaps.length>>1;
 return gaps.length?Math.max(.18,Math.min(2,(gaps[mid]+gaps[(gaps.length-1)>>1])/2)):GUIDE_PERIOD;
}
function pulseGrid(map,duration){
 const measured=validTimes(map,duration),aligned=measured.length>=2;
 const head=edgePeriod(measured.slice(0,5)),tail=edgePeriod(measured.slice(-5));
 const times=[];
 if(duration>0){
  if(aligned){
   // Carry the edge tempo through unmarked intros/outros without moving any measured beat.
   if(map.extendHead!==false)for(let n=Math.floor((measured[0]+1e-8)/head);n>0;n--)times.push(Math.max(0,measured[0]-n*head));
   times.push(...measured);
   if(map.extendTail!==false)for(let n=1;measured.at(-1)+n*tail<duration;n++)times.push(measured.at(-1)+n*tail);
  }else for(let n=0;n*GUIDE_PERIOD<duration;n++)times.push(n*GUIDE_PERIOD);
 }
 const downbeats=new Set((map?.downbeats||[]).filter(Number.isFinite).map(t=>Math.round(t*100000)));
 return {times,head,tail,aligned,accents:times.map(t=>downbeats.has(Math.round(t*100000)))};
}
function countPlan(grid,target,rate,count){
 if(!Number.isFinite(target)||target<0||!Number.isFinite(rate)||rate<=0||!Number.isInteger(count)||count<0||count>8)throw Error('Invalid recording count-in');
 if(!count)return {from:target,duration:0,beats:[]};
 const {times,head,tail}=grid,first=times[0]??0;
 let next=times.findIndex(t=>t>=target-1e-8);
 if(target<first)next=Math.ceil((target-first-1e-8)/head);
 else if(next<0)next=times.length?times.length-1+Math.ceil((target-times.at(-1)-1e-8)/tail):Math.ceil(target/head);
 const stamp=i=>!times.length?i*head:i<0?first+i*head:i<times.length?times[i]:times.at(-1)+(i-times.length+1)*tail;
 const from=stamp(next-count);
 return {from,duration:(target-from)/rate,beats:Array.from({length:count},(_,i)=>({label:i+1,seconds:(stamp(next-count+i)-from)/rate}))};
}
function stepBeats(grid,position,amount,duration){
 const {times,head,tail}=grid;
 if(!times.length)return Math.max(0,Math.min(duration,position));
 let index;
 if(position<=times[0])index=(position-times[0])/head;
 else if(position>=times.at(-1))index=times.length-1+(position-times.at(-1))/tail;
 else{
  let lo=0,hi=times.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(times[mid]<=position)lo=mid;else hi=mid;}
  index=lo+(position-times[lo])/(times[hi]-times[lo]);
 }
 const at=i=>i<0?times[0]+i*head:i<times.length?times[i]:times.at(-1)+(i-times.length+1)*tail;
 const target=index+amount,whole=Math.floor(target),fraction=target-whole;
 return Math.max(0,Math.min(duration,at(whole)+(at(whole+1)-at(whole))*fraction));
}
class Click{
 constructor(context,output){this.context=context;this.output=output;this.gain=context.createGain();this.gain.gain.value=0;this.gain.connect(output);this.node=null;this.times=[];this.enabled=false;this.level=.5;}
 async prepare(){if(!this.module)this.module=this.context.audioWorklet.addModule('full_practice_click_worklet.js').catch(e=>{this.module=null;throw e;});await this.module;}
 setMap(data,duration){this.stop();this.grid=pulseGrid(data,duration);this.times=this.grid.aligned?this.grid.times:[];this.unavailable=false;}
 mix(enabled,level){this.enabled=enabled;this.level=level;this.gain.gain.setTargetAtTime(enabled?level:0,this.context.currentTime,.005);}
 start(at,offset,end,rate,loop,loopStart=0){this.stop();if(!this.times.length||this.unavailable)return;this.node=new AudioWorkletNode(this.context,'recording-click',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{times:this.times,accents:this.grid.accents,at,offset,end,rate,loop,loopStart}});this.node.connect(this.gain);}
 stop(){if(this.node){this.node.port.postMessage('stop');this.node.disconnect();this.node.port.close();this.node=null;}}
}
root.MeleteFullPracticeClick={Click,validTimes,pulseGrid,countPlan,stepBeats};if(typeof module!=='undefined')module.exports=root.MeleteFullPracticeClick;
})(globalThis);
