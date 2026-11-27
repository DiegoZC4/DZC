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
function displaySheet(source,compact){
 const edition=(compact&&source.compactEdition)||source.bandEdition;
 if(!edition)return source;
 const view={...source,...edition};
 if(edition.firstBar!=null)view.bars=source.bars.filter(b=>b.number>=edition.firstBar);
 return view;
}
const barSeek=b=>b.seekAt??b.start+(b.pickupAt??0)/b.beats*(b.end-b.start);
function numberList(ns){
 return ns.length>2&&ns.every((n,i)=>n===ns[0]+i)?ns[0]+'–'+ns.at(-1):ns.join(', ');
}
function printedCues(bars,indices,endingStart=false){
 const cues=new Map();
 indices.forEach((i,k)=>{for(const cue of bars[i].cues||[]){
  if(endingStart&&/^\d+\.$/.test(cue))continue;
  if(!cues.has(cue))cues.set(cue,[]);cues.get(cue).push(k+1);
 }});
 return [...cues].map(([cue,ns])=>(ns.length===indices.length?'':numberList(ns)+': ')+cue).join(' · ');
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
// Corresponding phrases can change meter halfway through a strophic song.
// Print only the different paths through that phrase, then rejoin the common music.
function phraseForm(sections,sigs,slots){
 const blocks=[];
 for(const [family,rows] of Object.entries(slots)){
  const passes=sections.filter(s=>s.family===family),heads=passes.map((s,i)=>{s.verseLane=i;return 0;});
  for(const row of rows){
   if(row.length!==passes.length)throw Error('Invalid phrase passes');
   const variants=new Map();
   row.forEach((length,i)=>{
    const pass=passes[i],ids=pass.indices.slice(heads[i],heads[i]+length);heads[i]+=length;
    if(ids.length!==length)throw Error('Incomplete printed phrase');
    if(!length)return;
    const key=JSON.stringify(ids.map(id=>sigs[id]));
    if(!variants.has(key))variants.set(key,[]);
    variants.get(key).push({pass,ids,ordinal:i+1});
   });
   for(const v of variants.values()){
    const tag=v.length===passes.length?'':(family==='verse'?'V':'C')+numberList(v.map(x=>x.ordinal));
    blocks.push({label:repeatedTitle(passes),inline:family,tag,passes:v.map(x=>x.pass),
     columns:v[0].ids.map((_,i)=>v.map(x=>x.ids[i]))});
   }
  }
  if(heads.some((n,i)=>n!==passes[i].indices.length))throw Error('Missing bars in printed phrase');
 }
 if(blocks.flatMap(b=>b.columns.flat()).length!==sigs.length)throw Error('Unprinted section');
 return {sections,blocks};
}
// Align chord attacks by written beat, not by array index: an extra passing
// chord on one pass must not turn into a chord change on the other passes.
function chordChoices(bars,indices){
 const beats=new Map();
 indices.forEach((i,k)=>{
  for(const [raw,beat] of writtenChords(bars[i])){
   if(!beats.has(beat))beats.set(beat,new Map());
   const names=beats.get(beat);if(!names.has(raw))names.set(raw,[]);
   names.get(raw).push(k+1);
  }
 });
 return [...beats].sort(([a],[b])=>a-b).map(([beat,names])=>({beat,choices:[...names].map(([raw,passes])=>({raw,passes}))}));
}
function roadmapForm(sheet,sections,sigs,rulers){
 const blocks=[],stops=[],used=new Set(),byNumber=new Map(sheet.bars.map((b,i)=>[b.number,i]));
 let parent;
 for(const spec of sheet.printRoadmap){
  const passes=spec.starts.map((number,k)=>{
   const i=byNumber.get(number),start=byNumber.get(spec.fromBars?.[k]??number);
   if(i==null||start==null||start>i||spec.length<1||i+spec.length>sheet.bars.length)throw Error('Invalid printed range: '+number);
   const section=sections.findLast(s=>s.indices[0]<=i);
   const label=spec.names?.[k]||(section.display||section.label)+(spec.wholeSectionGrid?' '+(k+1):'');
   const indices=Array.from({length:spec.length},(_,j)=>i+j);
   if(!spec.ending&&!spec.resume&&(!spec.wholeSectionGrid||k===0))stops.push({label:spec.wholeSectionGrid?section.label:label,indices});
   return {label,indices,at:sheet.bars[start].start,short:spec.starts.length>1?String(k+1):null,...(spec.wholeSectionGrid?{verseLane:0}:{})};
  });
  const columns=passes[0].indices.map((_,j)=>passes.map(p=>p.indices[j]));
  for(const [j,col] of columns.entries())for(const i of col){
   const exact=spec.chordVariants?.includes(j+1)?rulers:sigs;
   if(used.has(i)||exact[i]!==exact[col[0]])throw Error('Duplicate or musically different bar in printed repeat: '+sheet.bars[i].number);
   used.add(i);
  }
  if(spec.ending||spec.resume){
   for(const p of passes){
    const owner=parent?.find(v=>v.gridIndices.at(-1)+1===p.indices[0]);
    if(!owner)throw Error('No contiguous parent pass for ending: '+spec.ending);
    owner.gridIndices.push(...p.indices);
   }
  }else{
   parent=passes;for(const p of passes)p.gridIndices=[...p.indices];
  }
  const gridSection=spec.wholeSectionGrid?sections.find(s=>s.indices[0]===passes[0].indices[0]):null;
  blocks.push({label:spec.label||spec.ending,passes,columns,gridSection,phraseAt:spec.phraseAt,inheritPlayers:spec.inheritPlayers,volta:!!spec.ending,attached:!!(spec.ending||spec.resume)});
 }
 if(used.size!==sheet.bars.length)throw Error('Unprinted bars in roadmap');
 return {sections,blocks,stops:stops.sort((a,b)=>a.indices[0]-b.indices[0])};
}
function printedForm(sheet,entry,compact=false){
 const sections=[],sigs=[],rulers=[];let meter='4/4',held=null;
 const voltas=compact&&sheet.bars.some(b=>b.cues?.includes('1.'));
 const names=new Map();
 if(!compact)for(const spec of sheet.printRoadmap||[])if(!spec.ending)
  spec.names?.forEach((name,k)=>names.set(spec.starts[k],name));
 for(const [i,b] of sheet.bars.entries()){
  meter=b.meter||meter;
  const label=names.get(b.number)||b.sections?.map(s=>sheet.songbook?.labels?.[s]??entry.sections[s].label).join(' / ')||b.label||'';
  if(!i||label){
   const name=label||(!i&&b.pickupAt==null?'Intro':'');
   const family=voltas&&/^(Verse \d+|Bridge)$/.test(name)?'volta body':
    name.toLowerCase().replace(/^final /,'').replace(/ \d+$/,'');
   sections.push({label:name,family,indices:[],at:b.start});
  }
  sections.at(-1).indices.push(i);
  if(!compact)continue;
  const chords=writtenChords(b);
  // An authored repeat may print pass-specific cues explicitly; automatic folds require identical cues.
  const ruler=JSON.stringify([meter,b.beats,b.pickupAt??null,chords[0]?.[1]===0?null:held]);
  rulers.push(ruler);sigs.push(JSON.stringify([ruler,chords,sheet.printRoadmap?null:b.cues||[]]));
  held=chords.at(-1)?.[0]??held;
 }
 const groups=[];
 const totals=new Map(),ordinals=new Map();
 for(const s of sections)totals.set(s.label,1+(totals.get(s.label)||0));
 for(const s of sections){
  const ord=(ordinals.get(s.label)||0)+1;ordinals.set(s.label,ord);
  if(totals.get(s.label)>1)s.display=s.label+' '+ord;
 }
 if(!compact)return {sections,stops:sections.map(s=>({label:s.display||s.label,indices:s.indices})),
  blocks:sections.map(s=>({label:s.display||s.label||'Pickup',passes:[s],columns:s.indices.map(i=>[i])}))};
 if(sheet.printRoadmap)return roadmapForm(sheet,sections,sigs,rulers);
 if(sheet.foldSlots)return phraseForm(sections,sigs,sheet.foldSlots);
 for(const s of sections){
  // Don't fragment a whole verse just to save two bars. Short matching forms
  // may still collapse in full; authored voltas keep their exact boundaries.
  const group=s.family&&groups.find(g=>g[0].family===s.family&&g.every(p=>{
   const n=Math.min(s.indices.length,p.indices.length);
   for(let i=0;i<Math.min(4,n);i++)if(sigs[s.indices[i]]!==sigs[p.indices[i]])return false;
   return n>=4||n===s.indices.length&&n===p.indices.length;
  }));
  if(group)group.push(s);else groups.push([s]);
 }
 const blocks=[];
 function block(label,passes,offset,count,volta=false){
  blocks.push({label,passes,volta,tail:offset>0,columns:Array.from({length:count},(_,k)=>passes.map(p=>p.indices[offset+k]))});
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
 const active=form.items.findLast(item=>item.at<=time),pass=form.starts.findLast(t=>t<=time);
 if(active===form.active&&pass===form.pass&&form.initialized)return;
 form.initialized=true;form.pass=pass;
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
 let used=0,fill=Infinity,lines=0,parent=null;
 for(const b of layout){
  if(b.bar.parentNode!==parent){used=0;parent=b.bar.parentNode;}
  if(used&&(used+b.quarters)*quarter>available)used=0;
  if(!used)lines++;
  used+=b.quarters;fill=Math.min(fill,available/used);
 }
 return {fill:fill>=quarter&&Number.isFinite(fill)?fill:0,lines};
}
function wrapPhrases(layout,quarter,available){
 const groups=new Map();
 for(const b of layout){
  const grid=b.bar.parentNode;if(!grid.dataset.phraseAt)continue;
  if(!groups.has(grid))groups.set(grid,[]);groups.get(grid).push(b);
 }
 for(const [grid,bars] of groups){
  const split=+grid.dataset.phraseAt,tail=bars[split-1].bar;
  const flow=bs=>{
   let lines=1,used=0;
   for(const b of bs){const w=b.quarters*quarter;
    if(used&&used+w>available){lines++;used=0;}used+=w;
   }
   return {lines,used};
  };
  const first=flow(bars.slice(0,split)),second=flow(bars.slice(split));
  // Keep the phrase boundary even on a narrow screen when it costs no additional lines.
  tail.style.marginInlineEnd=first.lines+second.lines===flow(bars).lines?Math.max(0,available-first.used-.1)+'px':'';
 }
}
function verticalLanes(layout){
 // Read the browser's actual flex lines before changing any row heights.
 const lines=[];let line,previous=null,y;
 for(const b of layout){
  const top=b.bar.offsetTop;
  if(!previous||b.bar.parentNode!==previous.bar.parentNode||top!==y){
   line={bars:[],ranks:new Set(),hasWords:false,cueHeight:0,chordRows:1,ending:false};lines.push(line);
  }
  line.bars.push(b);
  line.chordRows=Math.max(line.chordRows,b.chordRows);
  if(b.ending)line.ending=true;
  for(const lane of b.lanes)if(lane.words.length)line.hasWords=true;
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
  previous=b;y=top;
 }
 for(const row of lines)for(const b of row.bars)for(const lane of b.lanes)row.ranks.add(lane.rank);
 for(const row of lines)for(const b of row.bars){
  const bar=b.bar,ranks=[...row.ranks].sort((a,b)=>a-b);
  bar.toggleAttribute('data-ending-space',row.ending&&!b.ending);
  bar.toggleAttribute('data-instrumental-row',!row.hasWords);
  for(const lane of b.lanes){
   lane.line.style.gridRow=String(1+Math.max(0,ranks.indexOf(lane.rank)));
  }
  bar.style.setProperty('--lead-chord-rows',row.chordRows);
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
  if(b.scoreTimed)for(const w of b.words)w.el.style.removeProperty('transform');
  if(b.words.length===1)b.words[0].el.style.removeProperty('width');
 }
 const gap=font*.26,trimLimit=Math.max(0,Math.min(gap-2,font*.105)),scaleFloor=.95;
 let minimum=12,tightMinimum=12,densest=0;
 const scoreScaleFloor=.8,longest=Math.max(...layout.map(b=>b.quarters)),available=pane-.06;
 let scoreMinimum=0,scoreTight=0;
 for(const b of lanes){
  b.left=b.scoreTimed?3:b.joinLeft?0:edge;b.right=b.joinRight?0:edge;
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
   if(b.scoreTimed)for(const [i,w] of b.words.entries()){
    // A written attack stays on its beat even when a long word precedes a short note.
    const next=b.words[i+1],span=((next?.fraction??1)-w.fraction)*b.quarters;
    w.after=next?next.gap:b.left+b.right;w.span=span;
    scoreMinimum=Math.max(scoreMinimum,(w.ink+w.after)/span);
    scoreTight=Math.max(scoreTight,(w.ink*scoreScaleFloor+w.after)/span);
   }
  }
 }
 if(chords)for(const b of layout)for(const [i,c] of b.chords.entries()){
   const span=(b.chords[i+1]?.fraction??1)-c.fraction;
   const needed=(c.el.getBoundingClientRect().width+1)/(span*b.quarters);
   minimum=Math.max(minimum,needed);tightMinimum=Math.max(tightMinimum,needed);
 }
 // Only narrow individual syllables if a whole measure otherwise won't fit the viewport.
 const barCap=available/longest;
 const scoreWidth=Math.max(scoreTight,Math.min(scoreMinimum,barCap-.08));
 minimum=Math.max(minimum,scoreWidth);tightMinimum=Math.max(tightMinimum,scoreWidth);
 const rounded=n=>Math.ceil((n+.05)*64)/64,base=rounded(minimum);
 const natural=wrap(layout,base,available),compact=wrap(layout,rounded(tightMinimum),available);
 const snapped=natural.fill||base;
 const fillWidth=css.getPropertyValue('--lead-fill-lines').trim()==='1'&&base*longest<=available;
 let ppq=snapped>=base&&(fillWidth||(snapped-base)*longest<=4)?snapped:base;
 // Tightening the lyrics can save a whole line.
 if(compact.fill&&(compact.lines<natural.lines||!natural.fill)){
  ppq=compact.fill;
  for(const b of lanes){
   const width=ppq*b.quarters;
   if(!lyrics||b.scoreTimed||!b.words.length||b.density*b.quarters<=width)continue;
   const loss=b.density*b.quarters-width+.06,spaces=b.gaps+b.innerSpaces;
   const trim=spaces?Math.min(trimLimit,loss/spaces):0;
   const scale=Math.max(scaleFloor,Math.min(1,(width-b.left-b.right-b.gaps*(gap-trim)-.06)/(b.ink-b.innerSpaces*trim)));
   b.line.dataset.fitLyrics='';b.line.style.setProperty('--lead-word-spacing',-trim+'px');
   b.line.style.setProperty('--lead-ink-scale',scale);
   for(const w of b.words)if(w.gap)w.gap=gap-trim;
  }
 }
 body.style.setProperty('--lead-quarter',ppq+'px');
 wrapPhrases(layout,ppq,available);
 if(lyrics)for(const b of lanes){
  const fitted=b.line.hasAttribute('data-fit-lyrics'),fill=fitted||b.density>=densest-.01,width=ppq*b.quarters;
  if(fitted)for(const w of b.words)w.ink=w.el.getBoundingClientRect().width;
  const xs=b.scoreTimed?b.words.map(w=>b.left+w.fraction*width):pack(b.words,width,b.left,b.right,fill);
  b.words.forEach((w,i)=>{
   w.el.style.left=xs[i]+'px';
   if(b.scoreTimed&&w.ink+w.after>ppq*w.span){
    const scale=Math.max(scoreScaleFloor,(ppq*w.span-w.after)/w.ink);
    w.el.style.transform='scaleX('+scale+')';w.ink*=scale;
   }
  });
  for(let i=1;i<b.words.length;i++){
   const w=b.words[i],prev=b.words[i-1];
   prev.el.toggleAttribute('data-syllable-gap',w.continuation&&xs[i]-xs[i-1]-prev.ink>=font*.45);
  }
  if(!b.scoreTimed&&b.words.length===1&&(b.joinLeft&&b.joinRight||fill&&/\S\s+\S/.test(b.words[0].el.textContent))){
   const el=b.words[0].el,scale=fitted?Number(b.line.style.getPropertyValue('--lead-ink-scale')):1;
   el.style.left=b.left+'px';el.style.width=(width-b.left-b.right)/scale+'px';
  }
 }
 verticalLanes(layout);
}
function render(body,sheet,entry,seek,seekSection=seek,compact=false){
 const doc=body.ownerDocument,frag=doc.createDocumentFragment(),rows=[],layout=[],bindings=[];
 const songbook=sheet.songbook,beatSeek=new Set(songbook?.beatSeek),extraByMeasure=new Map();
 for(const note of songbook?.inserts||[]){
  if(!extraByMeasure.has(note.measure))extraByMeasure.set(note.measure,[]);
  extraByMeasure.get(note.measure).push(note);
 }
 const el=(name,cls,text)=>{const n=doc.createElement(name);n.className=cls;if(text!=null)n.textContent=text;return n;};
 const button=(text,cls,t,label)=>{
  const b=el('button',cls,text);b.type='button';b.dataset.time=t;b.title=label;b.setAttribute('aria-label',label);b.onclick=()=>seek(t);return b;
 };
 function addMusic(box,indices){
  const bar=sheet.bars[indices[0]],first=bar.pickupAt??0,duration=bar.beats-first;
  const music=el('div','lead-music'),events=new Map(chordChoices(sheet.bars,indices).map(e=>[e.beat,e.choices]));
  const columns=[...new Set([first,bar.beats,...events.keys()])].sort((a,b)=>a-b);
  const lengths=columns.slice(1).map((end,k)=>end-columns[k]),unit=Math.min(...lengths);
  music.style.gridTemplateColumns=lengths.map(n=>'minmax(0,'+(n/unit)+'fr)').join(' ');
  box.chordRows=1;
  for(const [k,length] of lengths.entries()){
   const beat=columns[k],slot=el('div','lead-slot');slot.dataset.beat=beat;
   for(let tick=Math.ceil(beat);tick<beat+length;tick++){
    const mark=el('i','lead-tick');mark.setAttribute('aria-hidden','true');
    mark.style.insetInlineStart=(tick-beat)/length*100+'%';slot.append(mark);
   }
   const choices=events.get(beat);
   if(choices){
    const group=el('div','lead-harmony');box.chordRows=Math.max(box.chordRows,choices.length);
    for(const {raw,passes} of choices){
     const chord=el('span','lead-chord');chord.dataset.sheetChord=raw;
     if(passes.length!==indices.length){
      const badge=el('small','lead-chord-pass',passes.join(',')+':');
      badge.title=(passes.length===1?'Pass ':'Passes ')+passes.join(', ');chord.append(badge);
     }
     chord.append(el('span','sheet-name',raw));group.append(chord);
    }
    slot.append(group);box.chords.push({el:group,fraction:(beat-first)/duration});
   }
   music.append(slot);
  }
  box.bar.append(music);
 }
 let meter=null,den=4,previous=null;
 const overview=el('div','lead-overview'),key=el('span','',sheet.key);key.dataset.sheetKey=sheet.key;key.hidden=true;
 const nav=el('nav','lead-form'),list=el('ol',''),items=[];nav.setAttribute('aria-label','Song form');nav.append(list);
 overview.append(nav,key);frag.append(overview);
 const form=printedForm(sheet,entry,compact),boxes=[],headings=new Map();
 const stage=root.MeleteFullPracticeEntrances,playing=stage?.playingChart(sheet);
 for(const [i,bar] of sheet.bars.entries()){
  const first=bar.pickupAt??0,duration=bar.beats-first;
  if(bar.meter)den=Number(bar.meter.split('/')[1]);
  const quarters=duration*4/den;
  const label=bar.pickupAt!=null?'Pickup':String(bar.number),m=el('div','lead-bar'),head=el('div','lead-meta'),num=button(bar.pickupAt!=null?'PU':label,'lead-number',barSeek(bar),'Jump to '+(bar.pickupAt!=null?'pickup':'measure '+label));
  num.dataset.sourceTime=num.dataset.time;num.dataset.sourceLabel=num.title;
  m.dataset.pickup=String(bar.pickupAt!=null);m.style.setProperty('--bar-quarters',quarters);
  const box={bar:m,quarters,meter:bar.meter||meter||'4/4',words:[],chords:[],num,scoreTimed:Array.isArray(bar.bandLyricTimes)};boxes.push(box);
  m.dataset.measure=bar.number;m.setAttribute('role','group');m.setAttribute('aria-label',bar.pickupAt!=null?'Pickup':'Measure '+label);head.append(num);
  if(bar.meter&&bar.meter!==meter){head.append(el('span','lead-meter',bar.meter));meter=bar.meter;}
  const cueLane=el('div','lead-entrance-lane');box.cueItems=el('div','lead-entrance-items');
  cueLane.append(box.cueItems);m.append(head,cueLane);
  const lyricLine=el('div','lead-lyrics');box.line=lyricLine;
  if(box.scoreTimed)lyricLine.dataset.scoreTimed='';
  for(const [j,[beat,s,l,from,to]] of (bar.bandText??bar.text??[]).entries()){
   const id=s+':'+l,text=songbook?.lines?.[id]??entry.sections[s].lines[l];
   const recorded=entry.performance?.sections[s]?.lines[l],overrides=songbook?.spans?.[id];
   const detail=overrides?{...recorded,spans:overrides}:recorded;
   if(!text.slice(from,to).trim())continue;
   const lineTime=sheet.lineTimes?.[id]??entry.timing.lines[s][l];
   const t=bar.bandLyricTimes?.[j]??(from===0&&!beatSeek.has(id)&&Number.isFinite(lineTime)?
    lineTime:bar.start+beat/bar.beats*(bar.end-bar.start));
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
  rows.push({at:bar.start,number:bar.number,el:m});
 }
 function select(choices,fn){
  const update=time=>fn(choices.findLast(c=>c.pass.at<=time)||choices[0]);
  update(-Infinity);if(choices.length>1)bindings.push(update);
 }
 let endingRow=null,inlineRow=null,previousRow=null,printedMeter=null;
 for(const block of form.blocks){
  const reuse=(block.attached&&previousRow)||(block.volta&&endingRow)||(block.inline&&inlineRow?.family===block.inline&&inlineRow);
  const grid=reuse?reuse.grid:el('div','lead-bars'),heading=reuse?reuse.heading:el('h3','lead-section',block.volta?'Endings':block.label);
  if(!reuse){
   if(block.label){heading.tabIndex=-1;frag.append(heading);}
   frag.append(grid);
  }
  if(block.phraseAt)grid.dataset.phraseAt=block.phraseAt;
  endingRow=block.volta?{grid,heading}:null;
  previousRow={grid,heading};
  inlineRow=block.inline?{grid,heading,family:block.inline}:null;
  const matrixPasses=block.gridSection?[block.gridSection]:block.inline?form.sections.filter(s=>s.family===block.inline):block.passes;
  const endingOnly=matrixPasses.length===1&&/^(?:(?:closing |ending )?tag|outro|ending)\b/i.test(block.label)&&
   !playing?.directions(matrixPasses[0].indices).length;
  const ids=matrixPasses[0].indices,first=ids[0];
  const showGrid=playing?.parts.length&&(compact
   ?block.label&&!block.attached&&!block.volta&&!block.tail&&!endingOnly&&(!block.inline||!reuse)&&
     (!block.inheritPlayers||matrixPasses.some(p=>playing.directions(p.indices).length))
   :!first||playing.directions(ids).length||playing.isSkipped(first)!==playing.isSkipped(first-1));
  const passRows=showGrid&&matrixPasses.map((p,k)=>{
   const label=p.display||p.label||block.label,short=p.short||label.match(/ (\d+)$/)?.[1]||({Bridge:'Br',Intro:'In',Outro:'Out'}[label])||(matrixPasses.length===1?'·':String(k+1));
   return {label,short,indices:p.gridIndices||p.indices};
  });
  if(showGrid)grid.before(stage.passGrid(doc,playing,passRows,block.label));
  block.columns.forEach((indices,col)=>{
   const b=boxes[indices[0]],m=b.bar,under=el('div','lead-underlay'),choices=indices.map((i,k)=>({i,pass:block.passes[k]}));
   const aliases=indices.map(i=>sheet.bars[i].number);
   addMusic(b,indices);
   if(printedMeter!==b.meter&&!m.querySelector('.lead-meter'))b.num.after(el('span','lead-meter',b.meter));
   printedMeter=b.meter;
   if(playing)m.querySelector('.lead-meta').append(stage.barEntrances(doc,playing,choices));
   const cueText=printedCues(sheet.bars,indices,!compact||!col&&block.volta);
   if(cueText){
    const cue=el('span','lead-cue',cueText);cue.title=cueText;
    if(sheet.printRoadmap&&indices.length>1&&cueText!==printedCues(sheet.bars,indices.slice(0,1)))cue.dataset.byPass='';
    m.querySelector('.lead-meta').append(cue);
   }
   if(block.tag){
    const pass=el('small','lead-variant',block.tag);
    pass.title=block.passes.map(s=>s.display||s.label).join(', ');
    m.querySelector('.lead-meta').append(pass);
   }
   if(block.volta){
    b.ending=true;
    const rule=el('div','lead-ending-rule');
    if(!col)rule.append(el('span','lead-volta',block.tag||block.label));
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
   for(const group of variants.sort((a,c)=>indices.indexOf(a[0].i)-indices.indexOf(c[0].i))){
    const {i}=group[0],lane=boxes[i],slot=Math.min(...group.map(c=>c.pass.verseLane??indices.indexOf(c.i)));
    lane.rank=variants.length===1?0:slot;lane.line.title=group.map(c=>c.pass.display||c.pass.label).join(' / ');
    lane.line.dataset.passes=group.map(c=>sheet.bars[c.i].number).join(' ');
    lane.words.forEach((w,j)=>{
     const targets=group.filter(c=>boxes[c.i].words[j]).map(c=>({...c,t:Number(boxes[c.i].words[j].el.dataset.time)})).sort((a,c)=>a.i-c.i);
     if(targets.length<group.length)w.el.title=targets.map(c=>c.pass.display||c.pass.label).join(' / ')+': '+w.el.title;
     select(targets,c=>{w.el.dataset.time=c.t;w.el.dataset.performanceMeasure=sheet.bars[c.i].number;w.el.onclick=()=>seek(c.t);});
    });
    under.append(lane.line);b.lanes.push(lane);
   }
   if(variants.length>1)select(choices,c=>{
    const n=String(sheet.bars[c.i].number);
    for(const lane of b.lanes)lane.line.classList.toggle('current-stanza',lane.line.dataset.passes.split(' ').includes(n));
   });
   if(!variants.length)under.append(el('div','lead-lyrics'));
   m.append(under);grid.append(m);
  });
  for(const i of block.columns.flat())for(const note of extraByMeasure.get(sheet.bars[i].number)||[]){
   const insert=el('div','lead-unsynced');insert.setAttribute('role','note');
   insert.append(el('strong','',note.label),...note.lines.map(line=>el('div','',line)));
   frag.append(insert);
  }
 }
 for(const section of form.stops||form.sections){
  if(!section.label)continue;
  const i=section.indices[0],bar=sheet.bars[i],heading=headings.get(i),at=barSeek(bar);
  const item=el('li',''),b=button(section.label,'lead-form-step',at,section.label+', measure '+bar.number);
  b.onclick=()=>{
   heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
   seekSection(at);
  };
  item.append(b);list.append(item);items.push({at,button:b});
 }
 body.dataset.key=sheet.key;body.dataset.quality=sheet.status;body.dataset.compact=String(compact);
 body.toggleAttribute('data-roadmap',compact&&!!sheet.printRoadmap);
 const starts=[...new Set(form.blocks.flatMap(b=>b.passes.length>1?b.passes.map(p=>p.at):[]))].sort((a,b)=>a-b);
 nav.hidden=items.length===0;songForms.set(body,{items,bindings,starts});
 body.replaceChildren(frag);body.scrollTop=0;body.scrollLeft=0;
 if(rows.length)measurements.set(body,layout);else measurements.delete(body);
 return rows;
}
const api={matches,textId,spans,render,fit,pack,markForm,printedForm,printedCues,chordChoices,displaySheet};
root.MeleteFullPracticeLead=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
