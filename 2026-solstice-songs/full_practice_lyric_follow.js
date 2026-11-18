/* Follow the source clock, never infer lyric timing from scroll distance. */
(function(root){
'use strict';
function activeRow(rows,time){return rows.findLast(row=>row.at<=time)||rows[0]||null;}
function scrollDelta(rect,top,bottom,center=false){
 const height=bottom-top;
 if(height<=0)return 0;
 if(!center&&rect.top>=top+8&&rect.bottom<=bottom-Math.min(48,height*.15))return 0;
 return rect.top-(top+Math.max(0,height-rect.height)*(center ? .5 : .28));
}
class Follower{
 constructor(body,button){
  this.body=body;this.button=button;this.win=body.ownerDocument.defaultView;
  this.rows=[];this.active=false;this.detached=false;this.target=null;this.automaticUntil=0;this.manualUntil=0;this.lastCheck=0;
  const now=()=>this.win.performance.now();
  this.intent=()=>{
   if(!this.active)return;
   this.detached=true;this.automaticUntil=0;this.manualUntil=now()+180;
   // A real gesture interrupts an in-flight programmatic scroll immediately.
   body.scrollTo({top:body.scrollTop,behavior:'instant'});
   this.win.scrollTo({top:this.win.scrollY,behavior:'instant'});
  };
  const scroll=()=>{
   if(!this.active||now()<this.automaticUntil)return;
   this.manualUntil=now()+180;this.detached=!!this.direction();this.updateReturn();
  };
  body.addEventListener('scroll',scroll,{passive:true});
  this.win.addEventListener('scroll',scroll,{passive:true});
  this.win.addEventListener('wheel',e=>{
   if(e.deltaY&&!e.defaultPrevented&&!e.ctrlKey)this.intent();
  },{passive:true});
  let pointer=null;
  this.win.addEventListener('pointerdown',e=>{
   pointer=body.contains(e.target)||!e.target.closest('button,input,select,a,[role=spinbutton]')?{x:e.clientX,y:e.clientY}:null;
   if(e.target===body&&e.clientX>body.getBoundingClientRect().right-16)this.intent();
  },{passive:true});
  this.win.addEventListener('pointermove',e=>{
   if(pointer&&Math.abs(e.clientY-pointer.y)>8){this.intent();pointer={x:e.clientX,y:e.clientY};}
  },{passive:true});
  for(const name of ['pointerup','pointercancel'])this.win.addEventListener(name,()=>{pointer=null;},{passive:true});
  button.onclick=()=>{if(this.active&&this.target){this.detached=false;this.manualUntil=0;this.pan(true,true);this.hideReturn();}};
 }
 nested(){return /auto|scroll/.test(this.win.getComputedStyle(this.body).overflowY)&&this.body.scrollHeight>this.body.clientHeight+1;}
 bounds(){
  const box=this.body.getBoundingClientRect();
  return this.nested()?{top:Math.max(12,box.top),bottom:Math.min(this.win.innerHeight-12,box.bottom)}:
   {top:12,bottom:this.win.innerHeight-12};
 }
 direction(){
  if(!this.target)return null;
  const rect=this.target.getBoundingClientRect(),{top,bottom}=this.bounds();
  if(rect.top<top)return 'up';if(rect.bottom>bottom)return 'down';return null;
 }
 hideReturn(){this.button.hidden=true;this.button.tabIndex=-1;this.button.setAttribute('aria-hidden','true');}
 updateReturn(){
  const direction=this.active&&this.detached&&this.direction();
  if(!direction){this.hideReturn();return;}
  const where=direction==='up'?'above':'below',box=this.body.getBoundingClientRect();
  this.button.hidden=false;this.button.tabIndex=0;this.button.setAttribute('aria-hidden','false');
  this.button.dataset.direction=direction;
  this.button.title='Return to current lyrics '+where;this.button.setAttribute('aria-label',this.button.title);
  this.button.style.left=Math.max(24,Math.min(this.win.innerWidth-24,(box.left+box.right)/2))+'px';
 }
 pan(center=false,explicit=false){
  if(!this.target)return;
  const rect=this.target.getBoundingClientRect();let {top,bottom}=this.bounds();
  const nested=this.nested(),box=this.body.getBoundingClientRect();
  // Listening should follow inside the lyric pane without pulling the mixer offscreen.
  if(!rect.height||this.paneOnly&&!explicit&&(!nested||bottom-top<80))return;
  const behavior=this.win.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
  if(nested&&bottom-top<80){
   this.automaticUntil=this.win.performance.now()+800;
   this.win.scrollBy({top:box.top-24,behavior});top=box.top;bottom=box.bottom;
  }
  const amount=scrollDelta(rect,top,bottom,center);
  if(Math.abs(amount)>1){
   this.automaticUntil=this.win.performance.now()+800;
   (nested?this.body:this.win).scrollBy({top:amount,behavior});
  }
 }
 reset(rows=[]){
  this.target?.classList.remove('is-recording-line');this.target=null;this.rows=rows;
  this.active=false;this.detached=false;this.automaticUntil=0;this.manualUntil=0;this.lastCheck=0;this.hideReturn();
 }
 update(time,running,paneOnly=false){
  this.paneOnly=paneOnly;
  if(!running||!this.rows.length){
   this.target?.classList.remove('is-recording-line');this.target=null;this.active=false;this.hideReturn();return;
  }
  const start=!this.active;this.active=true;
  if(start){this.detached=false;this.manualUntil=0;}
  const target=activeRow(this.rows,time)?.el;
  const changed=target!==this.target;
  if(changed){this.target?.classList.remove('is-recording-line');this.target=target;target?.classList.add('is-recording-line');}
  const now=this.win.performance.now();
  if(!start&&!changed&&now-this.lastCheck<100)return;
  this.lastCheck=now;
  if(this.detached||now<this.manualUntil){this.updateReturn();return;}
  this.hideReturn();
  if(start||now>=this.automaticUntil)this.pan(start);
 }
}
root.MeleteFullPracticeLyricFollow={Follower,activeRow,scrollDelta};
if(typeof module!=='undefined')module.exports=root.MeleteFullPracticeLyricFollow;
})(globalThis);
