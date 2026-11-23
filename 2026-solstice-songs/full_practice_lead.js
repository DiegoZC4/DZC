/* A performed lead sheet. All systems of a recording share one quarter-note ruler. */
(function(root){
'use strict';
function textId(entry){
 let h=2166136261;
 for(const b of new TextEncoder().encode(JSON.stringify(entry.sections.map(s=>s.lines))))h=Math.imul(h^b,16777619)>>>0;
 return h.toString(16).padStart(8,'0');
}
function matches(sheet,recording,entry){
 return !!(sheet&&entry?.sections&&entry?.timing?.vocalSha256===sheet.vocalSha256&&
  sheet.vocalSha256===recording.tracks.find(t=>t.id==='vocals')?.playback?.sha256&&
  sheet.sourceVersion===recording.tracks.map(t=>t.sha256).join(':')&&sheet.lyricTextId===textId(entry));
}
function spans(text,detail,from,to){
 const roles=detail?.spans||[],bounds=[...new Set([from,to,...roles.flatMap(s=>[s.from,s.to]).filter(n=>n>from&&n<to)])].sort((a,b)=>a-b);
 return bounds.slice(0,-1).map((n,i)=>[text.slice(n,bounds[i+1]),roles.find(s=>s.from<=n&&n<s.to)?.role||detail?.role]);
}
const measurements=new WeakMap();
const partial=(text,at)=>at>0&&at<text.length&&/[\p{L}\p{N}]/u.test(text[at-1])&&/[\p{L}\p{N}]/u.test(text[at]);
function pack(words,width,left,right,fill=false){
 // Leave the remaining words enough room before moving any fragment toward its beat.
 let end=width-right;
 for(let i=words.length-1;i>=0;i--){const w=words[i];w.latest=end-w.ink;end=w.latest-w.gap;}
 let cursor=left;
 return words.map((w,i)=>{
  const ideal=i===0&&left===0?0:i===words.length-1&&(right===0||fill)?width-right-w.ink:i===0&&fill?left:w.fraction*width+left;
  const x=Math.max(cursor+w.gap,Math.min(ideal,w.latest));cursor=x+w.ink;return x;
 });
}
function fit(body){
 const layout=measurements.get(body);
 if(!layout||!body.contains(layout[0].bar)||!body.clientWidth)return;
 const css=getComputedStyle(body),pane=body.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight);
 const lyrics=body.dataset.lyrics!=='false',chords=body.dataset.chords!=='false';
 const font=parseFloat(css.getPropertyValue('--lead-lyric-size'))||13,edge=Math.max(2.5,font*.17);
 // A whole bar like “vives, no one sur” must join a word at both edges.
 // Measure it at natural width before asking the browser to justify its spaces.
 for(const b of layout)if(b.words.length===1)b.words[0].el.style.removeProperty('width');
 let minimum=12,densest=0;
 for(const b of layout){
  b.left=b.joinLeft?0:edge;b.right=b.joinRight?0:edge;
  if(lyrics&&b.words.length){
   let ink=b.left+b.right;
   for(const [i,w] of b.words.entries()){
    w.ink=w.el.getBoundingClientRect().width;w.gap=i&&!w.continuation?font*.26:0;ink+=w.ink+w.gap;
   }
   b.density=ink/b.quarters;densest=Math.max(densest,b.density);minimum=Math.max(minimum,b.density);
  }
  if(chords)for(const [i,c] of b.chords.entries()){
   const span=(b.chords[i+1]?.fraction??1)-c.fraction;
   minimum=Math.max(minimum,(c.el.getBoundingClientRect().width+1)/(span*b.quarters));
  }
 }
 // Fill a complete line when it costs at most a few pixels of extra white per bar.
 // Otherwise wrap at the last complete bar, without justifying individual systems.
 const base=Math.ceil((minimum+.05)*64)/64;
 let used=0,fullest=0,parent=null,wrapped=false;
 for(const b of layout){
  if(b.bar.parentNode!==parent){used=0;parent=b.bar.parentNode;}
  if(used&&(used+b.quarters)*base>pane){used=0;wrapped=true;}
  used+=b.quarters;if(used*base<=pane)fullest=Math.max(fullest,used);
 }
 const snapped=fullest?(pane-.05)/fullest:base,wideReader=pane>=650&&body.closest('#readerContent');
 const ppq=snapped>=base&&(wideReader&&wrapped||(snapped-base)*Math.max(...layout.map(b=>b.quarters))<=4)?snapped:base;
 body.style.setProperty('--lead-quarter',ppq+'px');
 if(lyrics)for(const b of layout){
  const fill=b.density>=densest-.01,width=ppq*b.quarters;
  const xs=pack(b.words,width,b.left,b.right,fill);
  b.words.forEach((w,i)=>w.el.style.left=xs[i]+'px');
  for(let i=1;i<b.words.length;i++){
   const w=b.words[i],prev=b.words[i-1];
   prev.el.toggleAttribute('data-syllable-gap',w.continuation&&xs[i]-xs[i-1]-prev.ink>=font*.45);
  }
  if(b.words.length===1&&(b.joinLeft&&b.joinRight||fill&&/\S\s+\S/.test(b.words[0].el.textContent))){
   const el=b.words[0].el;el.style.left=b.left+'px';el.style.width=(width-b.left-b.right)+'px';
  }
 }
}
function render(body,sheet,entry,seek){
 const doc=body.ownerDocument,frag=doc.createDocumentFragment(),rows=[],layout=[];
 const el=(name,cls,text)=>{const n=doc.createElement(name);n.className=cls;if(text!=null)n.textContent=text;return n;};
 const button=(text,cls,t,label)=>{
  const b=el('button',cls,text);b.type='button';b.dataset.time=t;b.title=label;b.setAttribute('aria-label',label);b.onclick=()=>seek(t);return b;
 };
 let grid,meter=null,den=4,previous=null;
 const caption=el('div','lead-caption'),key=el('span','',sheet.key);key.dataset.sheetKey=sheet.key;
 caption.append(key,el('span','',sheet.status));frag.append(caption);
 function section(label){
  if(label)frag.append(el('h3','lead-section',label));
  grid=el('div','lead-bars');frag.append(grid);
 }
 for(const [i,bar] of sheet.bars.entries()){
  if(bar.sections?.length)section(bar.sections.map(s=>entry.sections[s].label).join(' / '));
  else if(bar.label)section(bar.label);
  else if(!grid)section(bar.pickupAt==null&&sheet.bars.some(b=>b.sections?.length)?'Intro':'');
  const first=bar.pickupAt??0,duration=bar.beats-first;
  if(bar.meter)den=Number(bar.meter.split('/')[1]);
  const quarters=duration*4/den;
  const label=bar.pickupAt!=null?'Pickup':String(bar.number),m=el('div','lead-bar'),head=el('div','lead-meta'),num=button(bar.pickupAt!=null?'PU':label,'lead-number',bar.start+first/bar.beats*(bar.end-bar.start),'Jump to '+(bar.pickupAt!=null?'pickup':'measure '+label));
  m.dataset.pickup=String(bar.pickupAt!=null);m.style.setProperty('--bar-quarters',quarters);
  const box={bar:m,quarters,words:[],chords:[]};layout.push(box);
  m.dataset.measure=bar.number;m.setAttribute('role','group');m.setAttribute('aria-label',bar.pickupAt!=null?'Pickup':'Measure '+label);head.append(num);
  if(bar.meter&&bar.meter!==meter){head.append(el('span','lead-meter',bar.meter));meter=bar.meter;}
  if(bar.cues?.length){
   const text=bar.cues.join(' · '),cue=el('span','lead-cue',text);cue.title=text;head.append(cue);
  }
  m.append(head);const music=el('div','lead-music');
  const columns=[...new Set([first,bar.beats,...bar.chords.map(c=>c[1])])].sort((a,b)=>a-b);
  const lengths=columns.slice(1).map((end,k)=>end-columns[k]),unit=Math.min(...lengths);
  music.style.gridTemplateColumns=lengths.map(n=>'minmax(0,'+(n/unit)+'fr)').join(' ');
  const slots=new Map();
  for(const [k,length] of lengths.entries()){
   const beat=columns[k],slot=el('div','lead-slot');slot.dataset.beat=beat;
   for(let tick=Math.ceil(beat);tick<beat+length;tick++){
    const mark=el('i','lead-tick');mark.setAttribute('aria-hidden','true');
    mark.style.insetInlineStart=(tick-beat)/length*100+'%';slot.append(mark);
   }
   slots.set(beat,slot);music.append(slot);
  }
  for(const [raw,beat] of bar.chords){
   const chord=el('span','lead-chord');chord.dataset.sheetChord=raw;
   chord.append(el('span','sheet-name',raw));slots.get(beat).append(chord);box.chords.push({el:chord,fraction:(beat-first)/duration});
  }
  const lyricLine=el('div','lead-lyrics');
  for(const [beat,s,l,from,to] of bar.text||[]){
   const text=entry.sections[s].lines[l],detail=entry.performance?.sections[s]?.lines[l];
   const t=from===0&&Number.isFinite(entry.timing.lines[s][l])?entry.timing.lines[s][l]:bar.start+beat/bar.beats*(bar.end-bar.start);
   const b=button(null,'lead-words',Math.max(0,t-.15),text+'; jump to this phrase');
   b.dataset.beat=beat;
   const continuation=previous?.s===s&&previous.l===l&&previous.to===from&&partial(text,from);
   if(continuation&&previous.box!==box&&previous.index===i-1){
    previous.box.joinRight=box.joinLeft=true;previous.el.dataset.joinRight='';b.dataset.joinLeft='';
   }
   for(const [slice,role] of spans(text,detail,from,to)){
    const part=el('span','lead-word',slice);
    if(root.MeleteFullPracticeChart.roles[role])part.dataset.role=role;
    b.append(part);
   }
   lyricLine.append(b);box.words.push({el:b,fraction:(beat-first)/duration,continuation});
   previous={s,l,to,box,index:i,el:b};
  }
  m.append(music,lyricLine);grid.append(m);rows.push({at:bar.start,el:m});
 }
 body.dataset.key=sheet.key;body.dataset.quality=sheet.status;
 body.replaceChildren(frag);body.scrollTop=0;body.scrollLeft=0;
 if(rows.length)measurements.set(body,layout);else measurements.delete(body);
 return rows;
}
const api={matches,textId,spans,render,fit,pack};
root.MeleteFullPracticeLead=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
