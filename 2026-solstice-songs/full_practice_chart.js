/* Performance cues are separate from lyric text, seek timing, and the audio mix. */
(function(root){
'use strict';
const roles={harmony:'Harmony',unison:'Unison',solo:'Soloist only'};
const sharp=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const flat=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const pc={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
function transposeChord(symbol,shift,key='A'){
 if(shift%12===0)return symbol;
 const rootPc=(pc[key[0]]+(key[1]==='#'?1:key[1]==='b'?-1:0)+shift+120)%12;
 const flatKeys=key.endsWith('m')?[0,2,3,5,7,10]:[0,1,3,5,8,10];
 const names=flatKeys.includes(rootPc)?flat:sharp;
 return symbol.replace(/(^|\/)([A-G])([#b]?)/g,(_,prefix,n,acc)=>
  prefix+names[(pc[n]+(acc==='#'?1:acc==='b'?-1:0)+shift+120)%12]);
}
function keyNumber(key){return pc[key[0]]+(key[1]==='#'?1:key[1]==='b'?-1:0);}
const shapeKeys={'the-circle':'D','bold-orion':'Dm','hymn-to-breaking-strain':'Bm','here-comes-the-sun':'D'};
const fretClass=n=>((n%12)+12)%12;
// Store a capo at the recording's native pitch so later audio transposes keep the same shapes.
function capoAtNativePitch(fret,audioShift){return fretClass(fret-audioShift);}
function pitchDisplay(song,key,shift,concert=true,chosenCapo){
 const writtenKey=shapeKeys[song]||key,authored=fretClass(keyNumber(key)-keyNumber(writtenKey));
 const baseCapo=Number.isInteger(chosenCapo)&&chosenCapo>=0&&chosenCapo<12?chosenCapo:authored;
 const shapeKey=baseCapo===authored?writtenKey:transposeChord(key,-baseCapo,key);
 const fret=fretClass(baseCapo+shift);
 return {shift:concert?shift:-baseCapo,shapeKey,fret,tabShift:concert?authored+shift:0,
  label:concert?'Concert '+transposeChord(key,shift,key):shapeKey+' shapes · '+(fret?'Capo '+fret:'No capo')};
}
function migrateShift(cfg,base,alternatives){
 if(!Object.hasOwn(cfg,'shift'))return cfg;
 const {shift,...updated}=cfg,old=alternatives?.[cfg.referenceId]||base;
 // Zero was also written by ordinary speed edits; do not shadow a new recording default with it.
 if(old?.url&&Number.isInteger(shift)&&shift!==0&&Math.abs(shift)<=12&&!Object.hasOwn(cfg.shifts||{},old.url))
  updated.shifts={...cfg.shifts,[old.url]:shift};
 return updated;
}
function recordingShift(cfg,rec){
 const value=cfg.shifts?.[rec.url]??rec.defaultShift??0;
 return Number.isInteger(value)&&Math.abs(value)<=12?value:0;
}
function words(text,cue){
 const groups=[...text.matchAll(/\S+\s*/g)].map(match=>{
  const a=match.index,b=a+match[0].length,cuts=new Set([a,b]);
  for(const chord of cue.chords||[])if(chord.at>a&&chord.at<b)cuts.add(chord.at);
  for(const span of cue.spans||[])for(const i of [span.from,span.to])if(i>a&&i<b)cuts.add(i);
  const points=[...cuts].sort((x,y)=>x-y);
  return points.slice(0,-1).map((from,i)=>({text:text.slice(from,points[i+1]),
   role:cue.spans?.find(s=>from>=s.from&&from<s.to)?.role||cue.role,
   chord:cue.chords?.find(c=>c.at===from)?.symbol||'',time:cue.chords?.find(c=>c.at===from)?.time}));
 });
 for(const chord of cue.chords||[])if(chord.at===text.length)groups.push([{text:'',chord:chord.symbol,time:chord.time}]);
 return groups;
}
function hasRoles(chart){return !!chart?.sections?.some(s=>s.lines.some(l=>l.role||l.spans?.length));}
function chordNode(doc,symbol,time){const el=doc.createElement('span');el.className='lyric-chord';el.dataset.chord=symbol;el.textContent=symbol;
 if(Number.isFinite(time))el.dataset.chordTime=time;return el;}
function chordClock(body){
 const rows=[...body.querySelectorAll('[data-chord-time]')].map(el=>({at:Number(el.dataset.chordTime),el})).sort((a,b)=>a.at-b.at);
 let previous=null;
 return time=>{
  let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].at<=time)lo=mid+1;else hi=mid;}
  const next=rows[lo-1]?.el||null;if(next===previous)return;
  previous?.classList.remove('is-playing-chord');next?.classList.add('is-playing-chord');previous=next;
 };
}
function line(el,text,cue){
 el.dataset.lyric=text;
 if(!cue){el.textContent=text;return;}
 el.classList.add('charted-line');el.replaceChildren();const doc=el.ownerDocument;
 for(const bits of words(text,cue)){
  const word=doc.createElement('span');word.className='lyric-wordbox';
  for(const bit of bits){
   const cell=doc.createElement('span');cell.className='lyric-bit';
   const chord=chordNode(doc,bit.chord,bit.time);chord.setAttribute('aria-hidden','true');
   const lyric=doc.createElement('span');lyric.className='lyric-word';
   if(roles[bit.role]){lyric.dataset.role=bit.role;lyric.title=roles[bit.role];}lyric.textContent=bit.text;
   cell.append(chord,lyric);word.append(cell);
  }
  el.append(word);
 }
 const description=[...new Set(words(text,cue).flat().map(b=>roles[b.role]).filter(Boolean))].join(' / ');
 el.dataset.singing=description;
 el.dataset.baseLabel=el.getAttribute('aria-label')||text;
}
function bars(parent,groups,makeSeek){
 const doc=parent.ownerDocument;
 for(const group of groups||[]){
  const row=doc.createElement('div');row.className='lyric-bars';if(group.note)row.title=group.note;
  if(group.label){const label=doc.createElement('span');label.className='lyric-bar-label';label.textContent=group.label;row.append(label);}
  for(const value of group.bars){
   const bar=typeof value==='string'?{chords:value}:value,t=bar.times?.[0];
   const box=Number.isFinite(t)&&makeSeek?makeSeek(bar.chords,t,group.label):doc.createElement('span');
   box.replaceChildren();box.classList.add('lyric-bar');
   if(bar.meter){const meter=doc.createElement('span');meter.className='lyric-meter';meter.textContent=bar.meter;box.append(meter);}
   for(const [i,symbol] of bar.chords.split(' ').entries())box.append(chordNode(doc,symbol,bar.times?.[i]));
   if(bar.note){const note=doc.createElement('span');note.className='lyric-bar-note';note.textContent=bar.note;box.append(note);}
   row.append(box);
  }
  parent.append(row);
 }
}
function legend(el,chart){
 el.replaceChildren();el.hidden=!chart;if(!chart)return;
 const doc=el.ownerDocument;
 for(const [role,label] of hasRoles(chart)?Object.entries(roles):[]){
  const span=doc.createElement('span');span.dataset.role=role;span.textContent=label;el.append(span);
 }
 if(chart.status){const status=doc.createElement('span');status.className='lyric-chart-status';status.textContent=chart.status;status.title=chart.note||chart.source||'';el.append(status);}
 const key=doc.createElement('span');key.className='lyric-concert-key';key.dataset.chartKey=chart.key;el.append(key);
}
function transpose(el,shift,key,keyLabel){
 for(const chord of el.querySelectorAll('[data-chord]'))chord.textContent=transposeChord(chord.dataset.chord,shift,key);
 for(const label of el.querySelectorAll('[data-chart-key]'))label.textContent=keyLabel||'Concert '+transposeChord(label.dataset.chartKey,shift,key);
 describe(el);
}
function describe(el){
 for(const line of el.querySelectorAll('.charted-line')){
  const chords=[...line.querySelectorAll('[data-chord]')].map(c=>c.textContent).filter(Boolean);
  const labels=[line.dataset.baseLabel];
  if(el.dataset.harmony!=='false'&&line.dataset.singing)labels.push(line.dataset.singing);
  if(el.dataset.chords!=='false'&&chords.length)labels.push('chords '+chords.join(', '));
  line.setAttribute('aria-label',labels.join('; '));
 }
}
function display(el,{harmony=true,chords=true}={}){
 el.dataset.harmony=String(harmony);el.dataset.chords=String(chords);
 for(const word of el.querySelectorAll('.lyric-word')){
  if(harmony&&roles[word.dataset.role])word.title=roles[word.dataset.role];else word.removeAttribute('title');
 }
 describe(el);
}
/* Chord chart view: written bars, barlines and repeats from full-practice-charts.json.
   Bars come only from a source chart; they are never inferred from lyric timing.
   iReal-sourced bars carry their width in source cells (16 per line) and the source's line breaks. */
const accidental={'#':'♯',b:'♭'},markNames={In:'intro',V:'verse'},barOf=new WeakMap();
function chordParts(symbol){
 const m=/^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(symbol||'');
 if(!m)return{root:symbol||'',quality:'',bass:''};
 return{root:m[1]+(accidental[m[2]]||''),quality:m[3].replace(/([#b])(?=\d)/g,(_,a)=>accidental[a]),
  bass:m[4]?m[4]+(accidental[m[5]]||''):''};
}
function sheetFor(data,song,reference='playlist'){
 const id=data?.recordings?.[song+'/'+reference];
 if(id&&data.charts?.[id])return{chart:data.charts[id]};
 const others=Object.keys(data?.recordings||{}).filter(k=>k.startsWith(song+'/')&&k!==song+'/'+reference)
  .map(k=>k.slice(song.length+1));
 return{chart:null,reason:data?.unavailable?.[song]||'',others};
}
function sheetRows(bars){
 const rows=[],layout=bars.some(b=>b.cells);let row=null,ending=0;
 bars.forEach((bar,i)=>{
  if(!row||bar.label||(layout?bar.row:(row.bars.length===4||bar.mark))){row={label:bar.label||'',bars:[],cells:0};rows.push(row);}
  if(bar.ending)ending=bar.ending;
  row.bars.push({bar,number:i+1,cells:bar.cells||4,ending:bar.ending||(ending?-ending:0)});
  row.cells+=bar.cells||4;
  // An ending runs to its closing barline, or up to the next ending or section.
  const next=bars[i+1];
  if(ending&&(bar.end||!next||next.ending||next.mark||next.label||next.start==='repeat'))ending=0;
 });
 for(const r of rows)r.columns=Math.max(16,r.cells);
 return rows;
}
function timesOf(text){return /^(\d+)x$/.exec(text)?.[1]||'';}
function amount(n){
 const whole=Math.floor(n),part={0.25:'¼',0.5:'½',0.75:'¾'}[n-whole]||'';
 return (whole||!part?String(whole):'')+part;
}
function pickupText(beats){return beats?'Pickup: '+amount(beats)+' '+(beats>1?'beats':'beat')+' before bar 1':'';}
function barLabel({bar,number,ending=0},symbols=bar.chords.map(([s])=>s)){
 const chords=bar.chords.map(([,at],i)=>{
  const length=(bar.chords[i+1]?.[1]??bar.beats)-at;
  return symbols[i]+(length===bar.beats?' for the whole bar':
   ' on beat '+amount(at+1)+' for '+amount(length)+(length===1?' beat':' beats'));
 });
 const before=[],after=[];
 if(bar.mark)before.push('section '+(markNames[bar.mark]||bar.mark));
 if(ending>0)before.push('ending '+ending);
 if(bar.start==='repeat')before.push('repeat starts');
 if(bar.segno)before.push('segno');
 if(bar.coda)before.push('coda');
 if(bar.fermata?.length)after.push('fermata');
 if(bar.end==='repeat')after.push('repeat ends');
 const times=(bar.texts||[]).map(timesOf).find(Boolean);
 if(times)after.push('played '+times+' times');
 if(bar.end==='final')after.push('end');
 return ['Bar '+number+(bar.meter?', '+bar.meter+' time':''),...before].join(', ')+': '+chords.join(', ')+
  (after.length?'; '+after.join(', '):'')+'.';
}
function paintChord(el,symbol){
 const doc=el.ownerDocument,{root,quality,bass}=chordParts(symbol),add=(cls,text)=>{
  const span=doc.createElement('span');span.className=cls;span.textContent=text;el.append(span);};
 el.replaceChildren();add('sheet-root',root);if(quality)add('sheet-quality',quality);if(bass)add('sheet-bass','/'+bass);
}
const icons={
 segno:'<path d="M11 4.6c-.9-1.5-4.6-1.7-5 .5s5.6 3.6 5 6.1-4.6 2.4-5.4.6"/><path d="M4 13.5 12 2.5"/><circle class="dot" cx="4.4" cy="7.4" r="1.1"/><circle class="dot" cx="11.6" cy="8.6" r="1.1"/>',
 coda:'<circle cx="8" cy="8" r="4.6"/><path d="M8 1v14M1 8h14"/>',
 fermata:'<path d="M2.5 9.5a5.5 5.5 0 0 1 11 0"/><circle class="dot" cx="8" cy="8.4" r="1.1"/>'};
function icon(doc,name){
 const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 16 16');
 svg.setAttribute('class','sheet-icon sheet-'+name);svg.setAttribute('aria-hidden','true');svg.innerHTML=icons[name];return svg;
}
function sheetBar(doc,cell,previous){
 const {bar,number}=cell,el=doc.createElement('div'),say=doc.createElement('span'),head=doc.createElement('div'),beats=doc.createElement('div');
 el.className='sheet-bar';el.dataset.bar=String(number);el.dataset.cells=String(cell.cells);el.style.setProperty('--cells',String(cell.cells));
 if(bar.start)el.dataset.start=bar.start;if(bar.end)el.dataset.end=bar.end;if(previous?.end)el.classList.add('joined');
 say.className='sr-only sheet-say';say.textContent=barLabel(cell);el.append(say);
 head.className='sheet-head';beats.className='sheet-beats';beats.setAttribute('aria-hidden','true');
 if(bar.mark){const mark=doc.createElement('span');mark.className='sheet-mark';mark.textContent=bar.mark;mark.setAttribute('aria-hidden','true');head.append(mark);}
 if(bar.segno)head.append(icon(doc,'segno'));if(bar.coda)head.append(icon(doc,'coda'));
 for(const text of bar.texts||[]){
  const times=timesOf(text),note=doc.createElement('span');
  note.className=times?'sheet-times':'sheet-text';note.textContent=times?times+'×':text;
  (times?beats:head).append(note);  // a repeat count sits by its closing barline
 }
 if(head.childNodes.length)el.append(head);
 if(cell.ending){
  const ending=doc.createElement('span');ending.className='sheet-ending'+(cell.ending>0?' first':'');ending.setAttribute('aria-hidden','true');
  if(cell.ending>0)ending.textContent=cell.ending+'.';el.append(ending);
 }
 for(const side of ['start','end'])if(bar[side]){const edge=doc.createElement('span');edge.className=`sheet-edge ${side} ${bar[side]}`;beats.append(edge);}
 if(bar.meter){
  const meter=doc.createElement('span');meter.className='sheet-meter';
  for(const n of bar.meter.split('/')){const b=doc.createElement('b');b.textContent=n;meter.append(b);}beats.append(meter);
 }
 // Each chord's share of the bar follows its beats; a name too long for its share takes the room it needs,
 // and that minimum widens the bar rather than spilling into the next one.
 const grid=doc.createElement('div'),first=bar.chords[0]?.[1]||0;
 grid.className='sheet-grid';
 if(first>0){const rest=doc.createElement('span');rest.className='sheet-rest';rest.style.flexGrow=String(first);grid.append(rest);}
 bar.chords.forEach(([symbol,at],i)=>{
  const chord=doc.createElement('span'),end=bar.chords[i+1]?.[1]??bar.beats,name=doc.createElement('span');
  chord.className='sheet-chord';chord.dataset.sheetChord=symbol;chord.style.flexGrow=String(Math.max(end-at,0.25));
  if(bar.fermata?.includes(at))chord.append(icon(doc,'fermata'));
  name.className='sheet-name';paintChord(name,symbol);chord.append(name);grid.append(chord);
 });
 beats.append(grid);el.append(beats);
 barOf.set(el,cell);return el;
}
function sheet(body,found,{recordings={},choose,disabled=false}={}){
 const doc=body.ownerDocument,chart=found?.chart;
 body.replaceChildren();delete body.dataset.key;
 if(!chart){
  const box=doc.createElement('div'),title=doc.createElement('p'),why=doc.createElement('p'),others=found?.others||[];
  box.className='sheet-empty';title.className='sheet-empty-title';
  title.textContent=others.length?'No chord chart for this recording':'No chord chart for this song';
  why.textContent=found?.reason||(others.length?'Charts are matched to the recording they were checked against.':
   'No source chart with its bars is set up, so this view won’t guess them.');
  box.append(title,why);
  for(const ref of others){
   const p=doc.createElement('p'),button=doc.createElement('button');
   button.type='button';button.className='sheet-switch';button.dataset.reference=ref;button.disabled=disabled;
   button.textContent=recordings[ref]||ref;button.onclick=()=>choose?.(ref);
   p.append('Chart available for ',button);box.append(p);
  }
  body.append(box);return;
 }
 body.dataset.key=chart.key;
 const meta=doc.createElement('div'),add=(cls,text,title)=>{
  const s=doc.createElement('span');s.className=cls;s.textContent=text;if(title)s.title=title;meta.append(s);return s;};
 meta.className='sheet-meta';
 add('sheet-status',chart.status,chart.source?.file?'Source: '+chart.source.file:'');
 add('sheet-key','Concert '+chart.key).dataset.sheetKey=chart.key;
 add('sheet-count',chart.played!==chart.written?chart.written+' bars · '+chart.played+' with repeats':chart.written+' bars');
 if(chart.pickup)add('sheet-pickup',pickupText(chart.pickup));
 const note=doc.createElement('p');note.className='sheet-note';note.textContent=chart.note;
 const list=doc.createElement('div');list.className='sheet-rows';
 for(const row of sheetRows(chart.bars)){
  if(row.label){const h=doc.createElement('h3');h.className='sheet-label';h.textContent=row.label;list.append(h);}
  const line=doc.createElement('div'),num=doc.createElement('span'),cells=doc.createElement('div');
  line.className='sheet-row';num.className='sheet-number';num.textContent=row.bars[0].number;num.setAttribute('aria-hidden','true');
  // Widths follow the source cells, but no bar gets narrower than its chords; a short line keeps blank space.
  cells.className='sheet-line';cells.style.gridTemplateColumns=row.bars.map(c=>`minmax(min-content,${c.cells}fr)`)
   .concat(row.cells<16?[`${16-row.cells}fr`]:[]).join(' ');
  let previous=null;
  for(const cell of row.bars){cells.append(sheetBar(doc,cell,previous));previous=cell.bar;}
  line.append(num,cells);list.append(line);
 }
 body.append(meta,note,list);
}
function sheetTranspose(el,shift,key,keyLabel){
 for(const chord of el.querySelectorAll('[data-sheet-chord]'))paintChord(chord.querySelector('.sheet-name'),transposeChord(chord.dataset.sheetChord,shift,key));
 for(const label of el.querySelectorAll('[data-sheet-key]'))label.textContent=keyLabel||'Concert '+transposeChord(label.dataset.sheetKey,shift,key);
 for(const bar of el.querySelectorAll('.sheet-bar')){
  const cell=barOf.get(bar),say=bar.querySelector('.sheet-say');
  if(cell&&say)say.textContent=barLabel(cell,cell.bar.chords.map(([s])=>transposeChord(s,shift,key)));
 }
 sheetFit(el);
}
/* Shrink the type of a line only when its bars can't fit the pane (narrow phones, busy lines);
   as a last resort the line's bars wrap onto a second row instead of running off the pane.
   Lines are measured together at each step, so a refit costs a few layouts, not a few per line. */
function sheetFit(el){
 const lines=[...el.querySelectorAll('.sheet-line')],over=l=>l.clientWidth>0&&l.scrollWidth>l.clientWidth+1;
 for(const l of lines)l.classList.remove('tight','tighter','wrap');
 let todo=lines.filter(over);
 for(const step of ['tight','tighter','wrap']){
  if(!todo.length)break;
  for(const l of todo){if(step==='tighter')l.classList.remove('tight');l.classList.add(step);}
  todo=todo.filter(over);
 }
 if(el.parentElement?.id==='readerContent'&&el.clientWidth<=650){
  for(const l of lines){
   const left=l.getBoundingClientRect().left;
   for(const bar of l.children)bar.toggleAttribute('data-reader-line-start',Math.abs(bar.getBoundingClientRect().left-left)<1);
  }
 }
}
root.MeleteFullPracticeChart={roles,words,hasRoles,transposeChord,pitchDisplay,capoAtNativePitch,migrateShift,recordingShift,line,bars,legend,transpose,display,chordClock,
 chordParts,sheetFor,sheetRows,pickupText,barLabel,sheet,sheetTranspose,sheetFit};
if(typeof module!=='undefined')module.exports=root.MeleteFullPracticeChart;
})(globalThis);
