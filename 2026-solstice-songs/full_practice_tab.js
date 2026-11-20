/* Read-only guitar parts. The horizontal coordinate is a musical slot, not a text column. */
(function(root){
'use strict';
const ns='http://www.w3.org/2000/svg',x=slot=>31+slot*22,y=string=>42+string*13;
function svgNode(doc,tag,attrs,text){
 const node=doc.createElementNS(ns,tag);
 for(const [name,value] of Object.entries(attrs))node.setAttribute(name,String(value));
 if(text!=null)node.textContent=text;
 return node;
}
function measure(doc,bar,number,strings,depth,hasCues,showFingers,nameFor){
 const fingerY=125,cueY=depth?fingerY+(depth-1)*13+20:127;
 const height=hasCues?cueY+6:depth?fingerY+(depth-1)*13+5:115;
 const svg=svgNode(doc,'svg',{viewBox:`0 -4 389 ${height+4}`,
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
  add('line',{x1:19,x2:385,y1:y(s),y2:y(s),class:'tab-rule'});
 }
 for(const edge of [19,385])add('line',{x1:edge,x2:edge,y1:y(0),y2:y(5),class:'tab-barline'});
 for(const slot of [4,8,12])add('line',{x1:x(slot)-9,x2:x(slot)-9,y1:y(0)-2,y2:y(5)+2,class:'tab-beat'});
 for(const [slot,string,fret,optional] of bar.notes){
  add('text',{x:x(slot),y:y(string)+4.9,class:'tab-fret'+(optional?' tab-optional':''),'data-slot':slot,'data-string':string},
   optional?'('+fret+')':fret);
 }
 if(showFingers)bar.fingers.forEach((stack,slot)=>[...stack].forEach((f,k)=>
  add('text',{x:x(slot),y:fingerY+k*13,class:'tab-finger','data-slot':slot},f)));
 for(const [slot,text] of bar.cues)add('text',{x:x(slot)-4,y:cueY,class:'tab-cue'},text);
 return svg;
}
function render(body,part,showFingers,nameFor=name=>name){
 const doc=body.ownerDocument,fragment=doc.createDocumentFragment();let number=(part.firstBar||1)-1;
 for(const section of part.sections){
  const group=doc.createElement('section'),heading=doc.createElement('h3'),grid=doc.createElement('div');
  heading.textContent=section.label;grid.className='tab-systems';
  const depth=showFingers?Math.max(...section.bars.flatMap(b=>b.fingers.map(f=>f.length))):0;
  const cues=section.bars.some(b=>b.cues.length);
  for(const bar of section.bars)grid.append(measure(doc,bar,++number,part.strings,depth,cues,showFingers,nameFor));
  group.append(heading,grid);fragment.append(group);
 }
 body.replaceChildren(fragment);
}
root.MeleteFullPracticeTab={render};
})(globalThis);
