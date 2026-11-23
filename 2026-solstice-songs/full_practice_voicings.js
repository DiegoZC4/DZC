/* Optional rehearsal voicings, not a transcription of the pianist's fingering. */
(function(root){
'use strict';
const letters='CDEFGAB',natural=[0,2,4,5,7,9,11],mod=n=>((n%12)+12)%12;
const pc=n=>mod(natural[letters.indexOf(n[0])]+(n[1]==='#'?1:n[1]==='b'?-1:0));
const pretty=s=>s.replace(/#/g,'♯').replace(/b/g,'♭');
// Scale degree and semitones: an added ninth has a third; a sus2 does not.
const formulas={'':[[1,0],[3,4],[5,7]],m:[[1,0],[3,3],[5,7]],5:[[1,0],[5,7]],
 sus2:[[1,0],[2,2],[5,7]],sus4:[[1,0],[4,5],[5,7]],add9:[[1,0],[3,4],[5,7],[9,14]],
 7:[[1,0],[3,4],[5,7],[7,10]],maj7:[[1,0],[3,4],[5,7],[7,11]],m7:[[1,0],[3,3],[5,7],[7,10]],
 '7sus4':[[1,0],[4,5],[5,7],[7,10]],m9:[[1,0],[3,3],[5,7],[7,10],[9,14]],
 maj9:[[1,0],[3,4],[5,7],[7,11],[9,14]]};
const tuning=[40,45,50,55,59,64];
const shapes={'':[['D','xx0232'],['C','x32010'],['G','320003'],['A','x02220'],['E','022100']],
 m:[['Am','x02210'],['Em','022000']],5:[['A','x022xx'],['E','022xxx']],
 sus4:[['A','x02230'],['D','xx0233'],['G','3x0013']],sus2:[['D','xx0230'],['A','x02200'],['G','3x0233'],['F','xx3011']],
 add9:[['C','x32033'],['D','xx0252'],['G','3x0203'],['D','x5425x'],['F','xx3213'],['Bb','x10311']],
 7:[['A','x02020'],['D','xx0212'],['E','020100'],['B','x21202'],['G','320001']],
 maj7:[['D','xx0222'],['C','x32000'],['G','3x443x']],
 m7:[['A','x02010'],['E','020000'],['D','xx0211'],['B','x20202']],
 '7sus4':[['A','x02030'],['D','xx0213'],['E','020200'],['G','3x0011']],
 m9:[['E','020002'],['B','x20222'],['D','x5355x'],['F#','202120'],['A','x05500']],
 'maj9/4':[['D','242232']],'/4':[['D','200232'],['A','x42220'],['C','032010'],['G','x20003']],
 '/2':[['G','x0000x'],['F','3xx211']]};
function parse(symbol){
 const m=/^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(symbol);
 if(!m||!Object.hasOwn(formulas,m[2]))return null;
 const tonic=pc(m[1]),bass=m[3]||m[1];
 const tones=formulas[m[2]].map(([degree,interval])=>{
  const i=(letters.indexOf(m[1][0])+degree-1)%7,pitch=mod(tonic+interval),d=mod(pitch-natural[i]);
  const name=letters[i]+(d<=2?'#'.repeat(d):'b'.repeat(12-d));
  return {degree,pc:pitch,name};
 });
 return {symbol,tonic,bass,quality:m[2],tones,slash:mod(pc(bass)-tonic)};
}
function frettingHand(frets){
 // Count one barre only when the strings between its ends may all sound at this fret or higher.
 let fingers=0,barreWidth=0;
 for(const fret of new Set(frets.filter(f=>f>0))){
  let first=-1,last=-1;
  for(let i=0;i<=frets.length;i++){
   if(frets[i]==null||frets[i]<fret){
    if(first>=0){fingers++;barreWidth+=last-first;first=-1;}
   }else if(frets[i]===fret){if(first<0)first=i;last=i;}
  }
 }
 return {fingers,barreWidth};
}
function guitar(chord){
 const choices=shapes[chord.quality+(chord.slash?'/'+chord.slash:'')]||[];
 const allowed=new Set([...chord.tones.map(t=>t.pc),pc(chord.bass)]);
 const required=chord.tones.filter(t=>t.degree!==5||chord.tones.length<=3).map(t=>t.pc);
 let best=null,rank=Infinity;
 for(const [key,shape] of choices)for(const delta of [mod(chord.tonic-pc(key))-12,mod(chord.tonic-pc(key))]){
  const frets=[...shape].map(n=>n==='x'?null:Number(n)+delta);
  if(frets.some(f=>f!==null&&(f<0||f>16)))continue;
  const held=frets.filter(f=>f>0),hi=Math.max(0,...held),lo=Math.min(hi,...held);
  if(hi-lo>4)continue;
  const hand=frettingHand(frets);if(hand.fingers>4)continue;
  const notes=frets.flatMap((f,i)=>f===null?[]:[tuning[i]+f]),used=new Set(notes.map(mod));
  if(mod(Math.min(...notes))!==pc(chord.bass)||notes.some(n=>!allowed.has(mod(n)))||required.some(n=>!used.has(n)))continue;
  const cost=hi*.7+(hi-lo)*.6+hand.fingers*.4+hand.barreWidth*.3+held.length*.1;
  if(cost<rank){rank=cost;best=frets;}
 }
 return best;
}
// Keys refer to physical shapes, not concert chords. The tag keeps its open-string major ninth.
const taylorNames={Am9:'Am7',Dm9:'Dm7/A',Bbadd9:'Bb',G5:'G'};
const taylorGuitarSymbol=(symbol,intro=false)=>intro&&symbol==='Cmaj9/E'?'Cmaj7/E':taylorNames[symbol]||symbol;
const taylorFrets={
 Am7:[null,0,2,2,1,3],'Dm7/A':[null,0,0,2,1,1],Dm7:[null,null,0,2,1,1],
 F:[null,null,3,2,1,1],'C/E':[null,null,2,0,1,0],'Cmaj7/E':[null,null,2,5,0,0],
 Fmaj7:[1,0,2,2,1,0],Cadd9:[null,3,2,0,3,0],'F/G':[3,3,3,2,1,1],
 Bb:[null,1,3,3,3,null]
};
const taylorFingers={Am7:[0,0,2,3,1,4],'Dm7/A':[0,0,0,2,1,1],Dm7:[0,0,0,2,1,1],
 'Cmaj7/E':[0,0,1,4,0,0],'F/G':[3,3,4,2,1,1],Bb:[0,1,3,3,3,0]};
function taylorGrip(chord,intro=false){
 const name=taylorGuitarSymbol(chord.symbol,intro);
 // The intro walks F3-E3-D3 on the fourth string; the tag starts on the low F2.
 if(intro&&name==='Fmaj7')return [null,null,3,2,1,0];
 return taylorFrets[name]||guitar(name===chord.symbol?chord:parse(name));
}
function taylorIntro(target){
 const bar=target.closest('.sheet-bar');
 return bar?Number(bar.dataset.bar)<=8:target.closest('.lyric-bars')?.dataset.barGroup==='Intro';
}
const taylorDisplaySymbol=(s,target)=>s?taylorGuitarSymbol(s,taylorIntro(target)):s;
function piano(chord){
 const bass=pc(chord.bass),ninth=chord.tones.some(t=>t.degree===9);
 const left=[{name:chord.bass,midi:40+mod(bass-4)}];
 const splitRoot=chord.slash===4&&chord.quality==='maj9';
 if(splitRoot)left.push({name:chord.tones[0].name,midi:left[0].midi+mod(chord.tonic-bass)});
 const voices=chord.tones.filter(t=>!(chord.tones.length>2&&left.some(n=>mod(n.midi)===t.pc))&&
   !(t.degree===5&&ninth&&chord.tones.length===5&&!splitRoot));
 // Choose a close right-hand inversion around middle C; keep an available ninth on top.
 let best,rank=Infinity;
 for(const first of voices){
  const offset=first.pc,order=[...voices].sort((a,b)=>mod(a.pc-offset)-mod(b.pc-offset));
  for(let start=55;start<=72;start++)if(mod(start)===offset){
   const notes=order.map(t=>({...t,midi:start+mod(t.pc-offset)})),span=notes.at(-1).midi-start;
   if(start<=left.at(-1).midi)continue;
   const cost=span+.5*Math.abs(start+span/2-65)+(ninth&&order.at(-1).degree!==9?14:0);
   if(cost<rank){rank=cost;best=notes;}
  }
 }
 return {left,right:best};
}
const NS='http://www.w3.org/2000/svg';
function svg(tag,attr){const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attr))e.setAttribute(k,v);return e;}
const stringNames=['Low E','A','D','G','B','High E'];
function fretboard(frets,fingers,capo){
 // Fret zero is always the physical capo (or nut). Higher grips add rows below it.
 const rows=Math.max(4,...frets),x=i=>20+i*18,y=f=>16+f*14;
 const notes=frets.map((f,i)=>stringNames[i]+' '+(f===null?'muted':f===0?'open':'fret '+f)+(fingers?.[i]?', finger '+fingers[i]:''));
 const out=svg('svg',{viewBox:'0 0 130 '+(y(rows)+20),role:'img',
  'aria-label':(capo?'Relative to capo '+capo:'From the nut')+': '+notes.join('; ')+'.'});
 const label=(cls,a,b,s)=>{
  const e=svg('text',{class:cls,x:a,y:b,'text-anchor':'middle'});e.textContent=s;out.append(e);
 };
 for(let i=0;i<6;i++)out.append(svg('line',{class:'grip-string',x1:x(i),x2:x(i),y1:y(0),y2:y(rows)}));
 for(let f=0;f<=rows;f++){
  out.append(svg('line',{class:f?'grip-fret':'grip-zero',x1:x(0),x2:x(5),y1:y(f),y2:y(f)}));
  if(f&&f%5===0)label('grip-guide',8,y(f-.5)+3,f);
 }
 frets.forEach((f,i)=>{
  const cy=f?y(f-.5):7;
  if(f===null)label('grip-mute',x(i),11,'×');
  else out.append(svg('circle',{class:f?'grip-dot':'grip-open',cx:x(i),cy,r:f?5.8:3}));
  if(fingers?.[i])label('grip-finger',x(i),cy+3.2,fingers[i]);
  label('grip-number',x(i),y(rows)+15,f===null?'×':f);
 });
 return out;
}
function bind({tip,enabled,shapeFor}){
 const selector='.lyric-chord[data-chord]:not([data-chord=""]),.sheet-name';
 let active=null,lastPointer='';
 const hide=()=>{if(active)active.removeAttribute('aria-describedby');active=null;tip.hidden=true;};
 const node=(name,text)=>{const e=document.createElement(name);if(text)e.textContent=text;return e;};
 function show(target){
  if(!enabled()||!target)return hide();
  const raw=target.dataset.chord??target.closest('[data-sheet-chord]')?.dataset.sheetChord;
  if(!raw)return hide();
  const {symbol,capo}=shapeFor(raw,target),intro=taylorIntro(target),chord=parse(symbol);
  const grip=chord&&taylorGrip(chord,intro);if(!grip)return hide();
  const name=taylorGuitarSymbol(symbol,intro);
  hide();active=target;target.setAttribute('aria-describedby',tip.id);
  const header=node('div');header.className='grip-heading';
  header.append(node('strong',pretty(name)),node('small',capo?'Capo '+capo:'Nut'));
  tip.replaceChildren(header,fretboard(grip,taylorFingers[name],capo));
  (target.closest('#readerPanel')||document.body).append(tip);tip.hidden=false;
  const r=target.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
  tip.style.left=Math.max(5,Math.min(innerWidth-w-5,r.left+r.width/2-w/2))+'px';
  tip.style.top=Math.max(5,r.top>=h+12?r.top-h-7:Math.min(innerHeight-h-5,r.bottom+7))+'px';
 }
 const hit=e=>e.target.closest?.(selector);
 document.addEventListener('pointerover',e=>{const el=hit(e);if(e.pointerType!=='touch'&&el&&el!==active)show(el);});
 document.addEventListener('pointerout',e=>{if(e.pointerType!=='touch'&&active?.contains(e.target)&&!active.contains(e.relatedTarget))hide();});
 document.addEventListener('pointerdown',e=>{lastPointer=e.pointerType;},true);
 document.addEventListener('keydown',()=>{lastPointer='';},true);
 document.addEventListener('focusin',e=>{if(!enabled()||lastPointer==='touch')return;const el=hit(e)||e.target.closest('.lyric-seek')?.querySelector(selector);if(el)show(el);});
 document.addEventListener('focusout',hide);
 document.addEventListener('click',e=>{
  if(!enabled())return;
  const el=hit(e);if(!el){hide();return;}
  if(e.pointerType==='touch'||(lastPointer==='touch'&&e.detail)){e.preventDefault();e.stopPropagation();if(active===el)hide();else show(el);}
 },true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!tip.hidden){e.preventDefault();e.stopPropagation();hide();}},true);
 document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
 return {hide,focusable(body){
  if(!enabled())return;
  const seen=new Set();
  for(const name of body.querySelectorAll('.sheet-name')){
   const s=name.textContent;if(seen.has(s))continue;seen.add(s);name.tabIndex=0;
   name.closest('.sheet-beats')?.removeAttribute('aria-hidden');
  }
 }};
}
const api={parse,guitar,frettingHand,taylorGuitarSymbol,taylorDisplaySymbol,taylorGrip,piano,bind};root.MeleteFullPracticeVoicings=api;
if(typeof module!=='undefined')module.exports=api;
})(globalThis);
