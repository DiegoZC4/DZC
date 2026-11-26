/* Read-only guitar parts. The horizontal coordinate is a musical slot, not a text column. */
(function(root){
'use strict';
const ns='http://www.w3.org/2000/svg',y=string=>42+string*13;
const layouts=new WeakMap(),baseSize=15,left=31,tail=10,gap=8;
function svgNode(doc,tag,attrs,text){
 const node=doc.createElementNS(ns,tag);
 for(const [name,value] of Object.entries(attrs))node.setAttribute(name,String(value));
 if(text!=null)node.textContent=text;
 return node;
}
function cuePositions(bar,width,widths,free=false){
 const step=(width-left-tail)/16,slack=free?Infinity:Math.min(10,step/2);
 const ideal=bar.cues.map(([slot])=>left-4+slot*step),latest=[];let end=width-3;
 // Lyrics may borrow half a sixteenth locally; frets and chord onsets never move.
 for(let i=ideal.length-1;i>=0;i--){
  latest[i]=Math.min(ideal[i]+slack,end-widths[i]);
  if(latest[i]<Math.max(2,ideal[i]-slack))return null;
  end=latest[i]-4;
 }
 let next=2;
 return ideal.map((x,i)=>{const start=Math.max(next,Math.min(x,latest[i]));next=start+widths[i]+4;return start;});
}
function measure(doc,bar,number,strings,depth,hasCues,showFingers,nameFor,width,cueWidths){
 const x=slot=>left+slot*(width-left-tail)/16;
 const fingerY=125,cueY=depth?fingerY+(depth-1)*13+20:127;
 const height=hasCues?cueY+6:depth?fingerY+(depth-1)*13+5:115;
 const svg=svgNode(doc,'svg',{viewBox:`0 -4 ${width} ${height+4}`,
  role:'img','aria-labelledby':`tab-title-${number} tab-desc-${number}`,'data-bar':number});
 const add=(tag,attrs,text)=>svg.append(svgNode(doc,tag,attrs,text));
 add('title',{id:'tab-title-'+number},'Bar '+number+(bar.chords.length?': '+bar.chords.map(c=>nameFor(c[1])).join(', '):''));
 const notes=Array.from({length:16},(_,slot)=>{
  const items=bar.notes.filter(n=>n[0]===slot).map(([,s,f,optional])=>
   `${s===0?'high E':s===5?'low E':strings[s]} ${f===0?'open':'fret '+f}${optional?' (optional)':''}`);
  const fingers=showFingers&&bar.fingers[slot];
  return items.length?`Step ${slot+1}: ${items.join(' + ')}${bar.accents.includes(slot)?', accent':''}${fingers?', picking '+[...fingers].join(' '):''}.`:'';
 }).filter(Boolean);
 add('desc',{id:'tab-desc-'+number},notes.concat(bar.cues.map(c=>c[1])).join(' '));
 add('text',{x:2,y:16,class:'tab-number'},number);
 for(const [slot,chord] of bar.chords)add('text',{x:x(slot),y:16,class:'tab-chord'},nameFor(chord));
 for(const slot of bar.accents)add('path',{d:`M${x(slot)-3.5} 25l7 2.2-7 2.2`,class:'tab-accent'});
 for(const [s,label] of strings.entries()){
  add('text',{x:10,y:y(s)+4,class:'tab-string-label'},label);
  add('line',{x1:19,x2:width-4,y1:y(s),y2:y(s),class:'tab-rule'});
 }
 for(const edge of [19,width-4])add('line',{x1:edge,x2:edge,y1:y(0),y2:y(5),class:'tab-barline'});
 for(const slot of [4,8,12])add('line',{x1:x(slot)-9,x2:x(slot)-9,y1:y(0)-2,y2:y(5)+2,class:'tab-beat'});
 for(const [slot,string,fret,optional] of bar.notes){
  add('text',{x:x(slot),y:y(string)+4.9,class:'tab-fret'+(optional?' tab-optional':''),'data-slot':slot,'data-string':string},
   optional?'('+fret+')':fret);
 }
 if(showFingers)bar.fingers.forEach((stack,slot)=>[...stack].forEach((f,k)=>
  add('text',{x:x(slot),y:fingerY+k*13,class:'tab-finger','data-slot':slot},f)));
 const cueX=cuePositions(bar,width,cueWidths)||cuePositions(bar,width,cueWidths,true);
 bar.cues.forEach(([,text],i)=>add('text',{x:cueX[i],y:cueY,class:'tab-cue'},text));
 return svg;
}
function measurePart(doc,part,nameFor){
 // Reserve space for actual transposed chord names, lyric cues and adjacent frets.
 // All bars share the same sixteenth-note spacing, including short final rows.
 const ctx=doc.createElement('canvas').getContext('2d'),cues=new Map();let step=15.5;
 for(const section of part.sections)for(const bar of section.bars){
  ctx.font='650 17px system-ui';
  bar.chords.forEach(([at,name],i)=>{
   const w=ctx.measureText(nameFor(name)).width,next=bar.chords[i+1]?.[0];
   step=Math.max(step,next==null?(w+3-tail)/(16-at):(w+4)/(next-at));
  });
  ctx.font='italic 15px Georgia,serif';
  cues.set(bar,bar.cues.map(([,text])=>{const m=ctx.measureText(text);return Math.ceil(Math.max(m.width,m.actualBoundingBoxRight)+1);}));
  ctx.font='650 15px system-ui';
  const prev=new Map();
  for(const [at,s,f,optional] of bar.notes){
   const half=ctx.measureText(optional?'('+f+')':String(f)).width/2,old=prev.get(s);
   if(old&&at>old.at)step=Math.max(step,(half+old.half+4)/(at-old.at));
   step=Math.max(step,(half+3-tail)/(16-at));prev.set(s,{at,half});
  }
 }
 let min=Math.ceil(left+16*step+tail);
 for(const [bar,widths] of cues){
  if(cuePositions(bar,min,widths))continue;
  let lo=min,hi=Math.max(lo+1,left+tail+16*(8+widths.reduce((sum,w)=>sum+w+4,0)));
  const free=!cuePositions(bar,hi,widths); // Simultaneous cues may share a slot.
  while(hi-lo>1){
   const mid=Math.floor((lo+hi)/2);
   if(cuePositions(bar,mid,widths,free))hi=mid;else lo=mid;
  }
  min=hi;
 }
 return {min,cues};
}
function fit(body,size){
 const state=layouts.get(body);if(!state)return;
 if(size!=null)state.size=size;
 if(!body.clientWidth)return;
 const css=getComputedStyle(body),available=body.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight);
 if(available<=0)return;
 const {part,showFingers,nameFor}=state,scale=state.size/baseSize,min=state.min*scale;
 const cols=Math.max(1,Math.floor((available+gap)/(min+gap)));
 const cell=Math.max(min,(available-(cols-1)*gap)/cols),width=cell/scale;
 const sig=[available,state.size].join(':');if(state.fit===sig)return;state.fit=sig;
 const doc=body.ownerDocument,fragment=doc.createDocumentFragment();let number=(part.firstBar||1)-1;
 body.style.setProperty('--tab-cols',cols);body.style.setProperty('--tab-cell',cell+'px');
 body.style.setProperty('--tab-gap',gap+'px');
 for(const section of part.sections){
  const group=doc.createElement('section'),heading=doc.createElement('h3'),grid=doc.createElement('div');
  heading.textContent=section.label;grid.className='tab-systems';
  const depth=showFingers?Math.max(...section.bars.flatMap(b=>b.fingers.map(f=>f.length))):0;
  const cues=section.bars.some(b=>b.cues.length);
  for(const bar of section.bars)grid.append(measure(doc,bar,++number,part.strings,depth,cues,showFingers,nameFor,width,state.cues.get(bar)));
  group.append(heading,grid);fragment.append(group);
 }
 body.replaceChildren(fragment);
}
function render(body,part,showFingers,nameFor=name=>name,size=baseSize){
 layouts.set(body,{part,showFingers,nameFor,size,...measurePart(body.ownerDocument,part,nameFor)});
 fit(body);
}
root.MeleteFullPracticeTab={render,fit};
})(globalThis);
