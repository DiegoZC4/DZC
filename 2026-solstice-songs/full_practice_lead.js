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
const songForms=new WeakMap();
const writtenChords=bar=>bar.bandChords||bar.chords;
function numberList(ns){
 return ns.length>2&&ns.every((n,i)=>n===ns[0]+i)?ns[0]+'–'+ns.at(-1):ns.join(', ');
}
function repeatedTitle(passes){
 const titles=passes.map(p=>p.display||p.label),first=titles[0]||'';
 const numbered=titles.map(t=>t.match(/^(.*) (\d+)$/));
 if(titles.length>1&&numbered.every(m=>m&&m[1]===numbered[0][1])){
  const name=numbered[0][1],ns=numbered.map(m=>+m[2]);
  return (name==='Chorus'?'Choruses':name+'s')+' '+numberList(ns);
 }
 return [...new Set(titles)].join(' / ')+(titles.length>1&&titles.every(t=>t===first)?' ×'+titles.length:'');
}
function printedForm(sheet,entry,compact=true){
 const sections=[],sigs=[];let meter='4/4',held=null;
 const voltas=sheet.bars.some(b=>b.cues?.includes('1.'));
 for(const [i,b] of sheet.bars.entries()){
  meter=b.meter||meter;
  const label=b.sections?.map(s=>entry.sections[s].label).join(' / ')||b.label||'';
  if(!i||label){
   const name=label||(!i&&b.pickupAt==null?'Intro':'');
   const family=voltas&&/^(Verse \d+|Bridge)$/.test(name)?'volta body':
    name.toLowerCase().replace(/^final /,'').replace(/ \d+$/,'');
   sections.push({label:name,family,indices:[],at:b.start});
  }
  sections.at(-1).indices.push(i);
  const chords=writtenChords(b);
  sigs.push(JSON.stringify([meter,b.beats,b.pickupAt??null,chords[0]?.[1]===0?null:held,chords,b.cues||[]]));
  held=chords.at(-1)?.[0]??held;
 }
 const groups=[];
 const totals=new Map(),ordinals=new Map();
 for(const s of sections)totals.set(s.label,1+(totals.get(s.label)||0));
 for(const s of sections){
  const ord=(ordinals.get(s.label)||0)+1;ordinals.set(s.label,ord);
  if(compact&&totals.get(s.label)>1)s.display=s.label+' '+ord;
  // Don't fragment a whole verse just to save two bars. Short matching forms
  // may still collapse in full; authored voltas keep their exact boundaries.
  const group=compact&&s.family&&groups.find(g=>g[0].family===s.family&&g.every(p=>{
   const n=Math.min(s.indices.length,p.indices.length);
   for(let i=0;i<Math.min(4,n);i++)if(sigs[s.indices[i]]!==sigs[p.indices[i]])return false;
   return n>=4||n===s.indices.length&&n===p.indices.length;
  }));
  if(group)group.push(s);else groups.push([s]);
 }
 const blocks=[];
 function block(label,passes,offset,count,volta=false){
  blocks.push({label,passes,volta,columns:Array.from({length:count},(_,k)=>passes.map(p=>p.indices[offset+k]))});
 }
 for(const passes of groups){
  let n=0;
  while(passes.every(p=>p.indices[n]!=null&&sigs[p.indices[n]]===sigs[passes[0].indices[n]]))n++;
  const breaks=passes.every(s=>s.family==='break')?passes.map(s=>sections[sections.indexOf(s)-1]):[];
  const title=breaks.length>1&&breaks.every(s=>s?.family==='verse')?'Break after '+repeatedTitle(breaks).toLowerCase():
   passes[0].family==='volta body'&&passes.some(s=>s.label==='Bridge')?repeatedTitle(passes).replace('Bridge','instrumental bridge'):repeatedTitle(passes);
  block(title,passes,0,n);
  const tails=new Map();
  for(const p of passes){
   const rest=p.indices.slice(n);if(!rest.length)continue;
   const key=JSON.stringify(rest.map(i=>sigs[i]));if(!tails.has(key))tails.set(key,[]);tails.get(key).push(p);
  }
  for(const ps of tails.values()){
   const ending=sheet.bars[ps[0].indices[n]].cues?.find(t=>/^\d+\.$/.test(t));
   const ordinal=ending&&(['1st','2nd','3rd'][parseInt(ending)-1]||parseInt(ending)+'th');
   block(ending?ordinal+' ending':repeatedTitle(ps)+' · continuation',ps,n,ps[0].indices.length-n,!!ending);
  }
 }
 return {sections,blocks};
}
function markForm(body,time){
 const form=songForms.get(body);if(!form)return;
 const active=form.items.findLast(item=>item.at<=time);
 if(active===form.active&&form.initialized)return;
 form.initialized=true;
 form.active?.button.removeAttribute('aria-current');
 active?.button.setAttribute('aria-current','location');form.active=active;
 for(const update of form.bindings||[])update(time);
}
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
function wrap(layout,quarter,available){
 let used=0,fullest=0,lines=0,parent=null;
 for(const b of layout){
  if(b.bar.parentNode!==parent){used=0;parent=b.bar.parentNode;}
  if(used&&(used+b.quarters)*quarter>available)used=0;
  if(!used)lines++;
  used+=b.quarters;if(used*quarter<=available)fullest=Math.max(fullest,used);
 }
 return {fullest,lines};
}
function verticalLanes(layout){
 // Read horizontal positions first: flex wrapping (including rounding and section
 // breaks) is authoritative. Changing row heights cannot change these positions.
 const lines=[];let line,previous=null,x;
 for(const b of layout){
  const left=b.bar.offsetLeft;
  if(!previous||b.bar.parentNode!==previous.bar.parentNode||left<=x){
   line={bars:[],ranks:new Set(),cueHeight:0};lines.push(line);
  }
  line.bars.push(b);
  for(const lane of b.lanes)if(lane.words.length)line.ranks.add(lane.rank);
  if(b.cueItems?.childElementCount){
   const width=b.cueItems.clientWidth,ends=[],heights=[],placed=[];
   for(const cue of b.cueItems.children){
    const left=Math.max(0,Math.min(width-cue.offsetWidth-2,2+Number(cue.dataset.fraction)*width));
    let lane=ends.findIndex(end=>end+3<=left);if(lane<0)lane=ends.length;
    ends[lane]=left+cue.offsetWidth;heights[lane]=Math.max(heights[lane]||0,cue.offsetHeight+1);
    cue.style.left=left+'px';placed.push([cue,lane]);
   }
   const tops=[0];for(const h of heights)tops.push(tops[tops.length-1]+h);
   for(const [cue,lane] of placed)cue.style.top=tops[lane]+'px';
   line.cueHeight=Math.max(line.cueHeight,tops[tops.length-1]);
  }
  previous=b;x=left;
 }
 for(const row of lines)for(const b of row.bars){
  const bar=b.bar,ranks=[...row.ranks].sort((a,b)=>a-b);
  bar.toggleAttribute('data-instrumental-row',!ranks.length);
  for(const lane of b.lanes)lane.line.style.gridRow=String(1+Math.max(0,ranks.indexOf(lane.rank)));
  b.under.style.setProperty('--lead-stanzas',ranks.length);
  if(row.cueHeight)bar.style.setProperty('--lead-entrance-height',row.cueHeight+'px');
  else bar.style.removeProperty('--lead-entrance-height');
 }
}
function fit(body){
 const layout=measurements.get(body);
 if(!layout||!body.contains(layout[0].bar)||!body.clientWidth)return;
 const css=getComputedStyle(body),pane=layout[0].bar.parentNode.getBoundingClientRect().width;
 const lyrics=body.dataset.lyrics!=='false',chords=body.dataset.chords!=='false';
 const font=parseFloat(css.getPropertyValue('--lead-lyric-size'))||13,edge=Math.max(2.5,font*.17);
 // A whole bar like “vives, no one sur” must join a word at both edges.
 // Measure it at natural width before asking the browser to justify its spaces.
 const lanes=layout.flatMap(b=>b.lanes);
 for(const b of lanes){
  b.line.removeAttribute('data-fit-lyrics');
  if(b.words.length===1)b.words[0].el.style.removeProperty('width');
 }
 const gap=font*.26,trimLimit=Math.max(0,Math.min(gap-2,font*.105)),scaleFloor=.95;
 let minimum=12,tightMinimum=12,densest=0;
 for(const b of lanes){
  b.left=b.joinLeft?0:edge;b.right=b.joinRight?0:edge;
  if(lyrics&&b.words.length){
   b.ink=0;b.innerSpaces=0;b.gaps=0;
   for(const [i,w] of b.words.entries()){
    w.ink=w.el.getBoundingClientRect().width;w.gap=i&&!w.continuation?gap:0;
    b.ink+=w.ink;b.innerSpaces+=w.spaces;if(w.gap)b.gaps++;
   }
   const ink=b.left+b.right+b.ink+b.gaps*gap;
   const tight=b.left+b.right+(b.ink-b.innerSpaces*trimLimit)*scaleFloor+b.gaps*(gap-trimLimit);
   b.density=ink/b.quarters;densest=Math.max(densest,b.density);minimum=Math.max(minimum,b.density);
   tightMinimum=Math.max(tightMinimum,tight/b.quarters);
  }
 }
 if(chords)for(const b of layout)for(const [i,c] of b.chords.entries()){
   const span=(b.chords[i+1]?.fraction??1)-c.fraction;
   const needed=(c.el.getBoundingClientRect().width+1)/(span*b.quarters);
   minimum=Math.max(minimum,needed);tightMinimum=Math.max(tightMinimum,needed);
 }
 const rounded=n=>Math.ceil((n+.05)*64)/64,available=pane-.06,base=rounded(minimum);
 const natural=wrap(layout,base,available),compact=wrap(layout,rounded(tightMinimum),available);
 const snapped=natural.fullest?available/natural.fullest:base,longest=Math.max(...layout.map(b=>b.quarters));
 const fillWidth=css.getPropertyValue('--lead-fill-lines').trim()==='1'&&base*longest<=available;
 let ppq=snapped>=base&&(fillWidth||(snapped-base)*longest<=4)?snapped:base;
 // Only fit ink more tightly when another complete measure really fits, respecting section starts.
 if(compact.lines<natural.lines&&compact.fullest){
  ppq=available/compact.fullest;
  for(const b of lanes){
   const width=ppq*b.quarters;
   if(!lyrics||!b.words.length||b.density*b.quarters<=width)continue;
   const loss=b.density*b.quarters-width+.06,spaces=b.gaps+b.innerSpaces;
   const trim=spaces?Math.min(trimLimit,loss/spaces):0;
   const scale=Math.max(scaleFloor,Math.min(1,(width-b.left-b.right-b.gaps*(gap-trim)-.06)/(b.ink-b.innerSpaces*trim)));
   b.line.dataset.fitLyrics='';b.line.style.setProperty('--lead-word-spacing',-trim+'px');
   b.line.style.setProperty('--lead-ink-scale',scale);
   for(const w of b.words)if(w.gap)w.gap=gap-trim;
  }
 }
 body.style.setProperty('--lead-quarter',ppq+'px');
 if(lyrics)for(const b of lanes){
  const fitted=b.line.hasAttribute('data-fit-lyrics'),fill=fitted||b.density>=densest-.01,width=ppq*b.quarters;
  if(fitted)for(const w of b.words)w.ink=w.el.getBoundingClientRect().width;
  const xs=pack(b.words,width,b.left,b.right,fill);
  b.words.forEach((w,i)=>w.el.style.left=xs[i]+'px');
  for(let i=1;i<b.words.length;i++){
   const w=b.words[i],prev=b.words[i-1];
   prev.el.toggleAttribute('data-syllable-gap',w.continuation&&xs[i]-xs[i-1]-prev.ink>=font*.45);
  }
  if(b.words.length===1&&(b.joinLeft&&b.joinRight||fill&&/\S\s+\S/.test(b.words[0].el.textContent))){
   const el=b.words[0].el,scale=fitted?Number(b.line.style.getPropertyValue('--lead-ink-scale')):1;
   el.style.left=b.left+'px';el.style.width=(width-b.left-b.right)/scale+'px';
  }
 }
 verticalLanes(layout);
}
function render(body,sheet,entry,seek,seekSection=seek,compact=true){
 const doc=body.ownerDocument,frag=doc.createDocumentFragment(),rows=[],layout=[],bindings=[];
 const el=(name,cls,text)=>{const n=doc.createElement(name);n.className=cls;if(text!=null)n.textContent=text;return n;};
 const button=(text,cls,t,label)=>{
  const b=el('button',cls,text);b.type='button';b.dataset.time=t;b.title=label;b.setAttribute('aria-label',label);b.onclick=()=>seek(t);return b;
 };
 let meter=null,den=4,previous=null;
 const overview=el('div','lead-overview'),caption=el('div','lead-caption'),key=el('span','',sheet.key);key.dataset.sheetKey=sheet.key;
 const nav=el('nav','lead-form'),list=el('ol',''),items=[];nav.setAttribute('aria-label','Song form');nav.append(list);
 caption.append(key,el('span','',sheet.bars.some(b=>b.bandChords)?'Band arrangement':sheet.status));overview.append(nav,caption);frag.append(overview);
 const form=printedForm(sheet,entry,compact),boxes=[],headings=new Map();
 for(const [i,bar] of sheet.bars.entries()){
  const first=bar.pickupAt??0,duration=bar.beats-first;
  if(bar.meter)den=Number(bar.meter.split('/')[1]);
  const quarters=duration*4/den;
  const label=bar.pickupAt!=null?'Pickup':String(bar.number),m=el('div','lead-bar'),head=el('div','lead-meta'),num=button(bar.pickupAt!=null?'PU':label,'lead-number',bar.start+first/bar.beats*(bar.end-bar.start),'Jump to '+(bar.pickupAt!=null?'pickup':'measure '+label));
  num.dataset.sourceTime=num.dataset.time;num.dataset.sourceLabel=num.title;
  m.dataset.pickup=String(bar.pickupAt!=null);m.style.setProperty('--bar-quarters',quarters);
  const box={bar:m,quarters,words:[],chords:[],num};boxes.push(box);
  m.dataset.measure=bar.number;m.setAttribute('role','group');m.setAttribute('aria-label',bar.pickupAt!=null?'Pickup':'Measure '+label);head.append(num);
  if(bar.meter&&bar.meter!==meter){head.append(el('span','lead-meter',bar.meter));meter=bar.meter;}
  if(bar.cues?.length){
   const text=bar.cues.join(' · '),cue=el('span','lead-cue',text);cue.title=text;head.append(cue);
  }
  const cueLane=el('div','lead-entrance-lane');box.cueItems=el('div','lead-entrance-items');
  cueLane.append(box.cueItems);m.append(head,cueLane);const music=el('div','lead-music');
  const chords=writtenChords(bar),columns=[...new Set([first,bar.beats,...chords.map(c=>c[1])])].sort((a,b)=>a-b);
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
  for(const [raw,beat] of chords){
   const chord=el('span','lead-chord');chord.dataset.sheetChord=raw;
   chord.append(el('span','sheet-name',raw));slots.get(beat).append(chord);box.chords.push({el:chord,fraction:(beat-first)/duration});
  }
  const lyricLine=el('div','lead-lyrics');box.line=lyricLine;
  for(const [beat,s,l,from,to] of bar.text||[]){
   const text=entry.sections[s].lines[l],detail=entry.performance?.sections[s]?.lines[l];
   if(!text.slice(from,to).trim())continue;
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
   const spaces=(b.textContent.trim().match(/\s+/g)||[]).length;
   lyricLine.append(b);box.words.push({el:b,fraction:(beat-first)/duration,continuation,spaces});
   previous={s,l,to,box,index:i,el:b};
  }
  m.append(music);rows.push({at:bar.start,el:m});
 }
 function select(choices,fn){
  const update=time=>fn(choices.findLast(c=>c.pass.at<=time)||choices[0]);
  update(-Infinity);if(choices.length>1)bindings.push(update);
 }
 let endingRow=null;
 for(const block of form.blocks){
  const reuse=block.volta&&endingRow;
  const grid=reuse?endingRow.grid:el('div','lead-bars'),heading=reuse?endingRow.heading:el('h3','lead-section',block.volta?'Endings':block.label);
  if(!reuse){
   if(block.label){heading.tabIndex=-1;frag.append(heading);}
   frag.append(grid);
  }
  endingRow=block.volta?{grid,heading}:null;
  let previousStanzas='';
  block.columns.forEach((indices,col)=>{
   const b=boxes[indices[0]],m=b.bar,under=el('div','lead-underlay'),choices=indices.map((i,k)=>({i,pass:block.passes[k]}));
   const aliases=indices.map(i=>sheet.bars[i].number);
   if(block.volta){
    const rule=el('div','lead-ending-rule');
    if(!col){rule.append(el('span','lead-volta',block.label));
     const cue=m.querySelector('.lead-cue');
     if(cue){const other=sheet.bars[indices[0]].cues.filter(c=>!/^\d+\.$/.test(c));if(other.length)cue.textContent=other.join(' · ');else cue.remove();}
    }
    m.prepend(rule);
   }
   m.dataset.measures=aliases.join(' ');
   if(aliases.length>1)m.dataset.passes=JSON.stringify(choices.map(c=>(c.pass.display||c.pass.label).replace(/^Verse /,'V')));
   b.under=under;b.lanes=[];layout.push(b);
   for(const i of indices){rows[i].el=m;headings.set(i,heading);}
   select(choices,({i})=>{
    const n=boxes[i].num,number=sheet.bars[i].number,t=Number(n.dataset.sourceTime??n.dataset.time);
    m.dataset.currentMeasure=number;b.num.dataset.time=t;
    b.num.textContent=sheet.bars[i].pickupAt!=null?'PU':String(number);b.num.title=n.dataset.sourceLabel||('Jump to measure '+number);
    b.num.setAttribute('aria-label',b.num.title);b.num.onclick=()=>seek(t);
   });
   const variants=[],sung=choices.filter(({i})=>boxes[i].words.length);
   const signatures=new Map(sung.map(({i})=>[i,boxes[i].words.map(w=>JSON.stringify([
    w.fraction,w.continuation||false,w.el.hasAttribute('data-join-left'),w.el.hasAttribute('data-join-right'),
    ...Array.from(w.el.children,s=>[s.textContent,s.dataset.role||''])
   ]))]));
   // A shared response sometimes has a pickup attached on just one verse.
   // Keep one line and give that last fragment only its actual seek target.
   for(const choice of [...sung].sort((a,c)=>boxes[c.i].words.length-boxes[a.i].words.length)){
    const sig=signatures.get(choice.i);
    const existing=variants.find(g=>sig.every((v,j)=>v===signatures.get(g[0].i)[j]));
    if(existing)existing.push(choice);else variants.push([choice]);
   }
   const laneOrder=variants.map(g=>g.map(c=>indices.indexOf(c.i)).sort((a,b)=>a-b).join(',')).sort().join(';');
   for(const group of variants.sort((a,c)=>indices.indexOf(a[0].i)-indices.indexOf(c[0].i))){
    const {i}=group[0],lane=boxes[i],slot=Math.min(...group.map(c=>indices.indexOf(c.i)));
    lane.rank=variants.length===1?0:slot;lane.line.title=group.map(c=>c.pass.display||c.pass.label).join(' / ');
    lane.line.dataset.passes=group.map(c=>sheet.bars[c.i].number).join(' ');
    if(variants.length>1&&laneOrder!==previousStanzas&&!lane.joinLeft){
     const labels=group.map(c=>c.pass.display||c.pass.label),ns=labels.map(t=>t.match(/ (\d+)$/)?.[1]).map(Number);
     const label=ns.every(Number.isFinite)?numberList(ns.sort((a,b)=>a-b)):labels.join('/');
     lane.words[0].el.prepend(el('small','lead-stanza',label+' '));
    }
    lane.words.forEach((w,j)=>{
     const targets=group.filter(c=>boxes[c.i].words[j]).map(c=>({...c,t:Number(boxes[c.i].words[j].el.dataset.time)})).sort((a,c)=>a.i-c.i);
     if(targets.length<group.length){
      const badge=el('small','lead-stanza',targets.map(c=>c.pass.label.replace(/^Verse /,'')).join(',')+': ');
      w.el.prepend(badge);
     }
     select(targets,c=>{w.el.dataset.time=c.t;w.el.dataset.performanceMeasure=sheet.bars[c.i].number;w.el.onclick=()=>seek(c.t);});
    });
    under.append(lane.line);b.lanes.push(lane);
   }
   if(variants.length>1)select(choices,c=>{
    const n=String(sheet.bars[c.i].number);
    for(const lane of b.lanes)lane.line.classList.toggle('current-stanza',lane.line.dataset.passes.split(' ').includes(n));
   });
   if(!variants.length)under.append(el('div','lead-lyrics'));
   previousStanzas=laneOrder;m.append(under);grid.append(m);
  });
 }
 for(const section of form.sections){
  if(!section.label)continue;
  const i=section.indices[0],bar=sheet.bars[i],heading=headings.get(i),at=bar.start+(bar.pickupAt??0)/bar.beats*(bar.end-bar.start);
  const item=el('li',''),b=button(section.label,'lead-form-step',at,section.label+', measure '+bar.number);
  b.onclick=()=>{
   heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
   seekSection(at);
  };
  item.append(b);list.append(item);items.push({at,button:b});
 }
 body.dataset.key=sheet.key;body.dataset.quality=sheet.status;
 nav.hidden=items.length===0;songForms.set(body,{items,bindings});
 body.replaceChildren(frag);body.scrollTop=0;body.scrollLeft=0;
 if(rows.length)measurements.set(body,layout);else measurements.delete(body);
 return rows;
}
const api={matches,textId,spans,render,fit,pack,markForm,printedForm};
root.MeleteFullPracticeLead=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
