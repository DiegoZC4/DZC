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
 const names=[0,1,3,5,8,10].includes(rootPc)?flat:sharp;
 return symbol.replace(/(^|\/)([A-G])([#b]?)/g,(_,prefix,n,acc)=>
  prefix+names[(pc[n]+(acc==='#'?1:acc==='b'?-1:0)+shift+120)%12]);
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
function transpose(el,shift,key){
 for(const chord of el.querySelectorAll('[data-chord]'))chord.textContent=transposeChord(chord.dataset.chord,shift,key);
 for(const label of el.querySelectorAll('[data-chart-key]'))label.textContent='Concert '+transposeChord(label.dataset.chartKey,shift,key);
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
root.MeleteFullPracticeChart={roles,words,hasRoles,transposeChord,line,bars,legend,transpose,display,chordClock};
if(typeof module!=='undefined')module.exports=root.MeleteFullPracticeChart;
})(globalThis);
