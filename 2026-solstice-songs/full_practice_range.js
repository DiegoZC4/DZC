/* Sounding lead ranges, not guitar shapes or the extrema of a polyphonic stem.
   Evidence and timestamp checks: Solstice/band-charts/soloist-ranges.md. */
(function(root){
'use strict';
const yt=id=>'https://www.youtube.com/watch?v='+id,bc=id=>'https://humanistculture.bandcamp.com/track/'+id;
// The exact performance URL is intentional: a new recording must not inherit the previous singer's octave.
const ranges=new Map([
 [yt('iYCkm3HdLzU'),['E','B2','C#4','Core tune','Excludes a possible short upper ornament.']],
 [bc('hymn-to-breaking-strain'),['Bm','G2','D4','Estimate','Recurring low and high pitches on the 2019 vocal stem; the lead changes register.']],
 [yt('pEwxguHUi_U'),['Bbm','Gb3','F4','Opening','Edited Fish opening, not the higher harmony.']],
 [bc('bold-orion'),['Em','D4','E5','Working','Maia holds the upper note in the refrain.']],
 [yt('b9BGaKkQEEw'),['Dm','C3','D4','Lead','Leo’s verse and full vocal stem agree.']],
 [yt('ilGahIwQEQ0'),['Am','E2','E3','Low voice','Cohen’s lower register; the audition guide is one octave higher.']],
 [yt('RlOxHjqRQOo'),['Fm','Ab2','C4','Lead','Edited line and full vocal stem agree.']],
 [yt('Wo60qDIX27M'),['B','F#2','G#3','Core tune','Traditional tune in Nathan Evans’s lower register.']],
 [yt('TzprCXKLBiY'),['D','A2','B3','Core tune','Traditional tune in Taylor’s register; excludes upper embellishments.']],
 ['https://windborne.bandcamp.com/track/songs-stay-sung',['Am','E3','A4','Main line','Opening lead; the later tenor handoff can go lower.']],
 [yt('DOFvpmay3jk'),['Dm','C4','C5','Lead','Sea of Dreams: the low is on “is” in measure 1; the high is on “plague” in measure 2.']],
 [yt('32yPWJcq2AI'),['Cm','A3','Bb4','Opening','Edited Ohio Valley opening, including the short pickup.']],
 [yt('xUNqsfFUwhY'),['A','E3','C#4','Lead','Plain lead in the audition-guide octave; excludes upper harmony.']],
 [yt('VqHy11zWZA4'),['Gm','F3','Bb4','Estimate','Skybound vocal-stem endpoints; the top may include harmony.']],
 [yt('zc8tCd4uAF0'),['Am','G3','B4','Working','Solar Sailors: the low recurs; the top is brief.']],
 [bc('brighter-than-today'),['D','A3','D5','Score guide','Soprano in the D score; not a verified 2014 solo line.']],
 [yt('RGVZdk5hIG0'),['D','B3','B4','Opening','Edited Bay 2024 audition opening, not the whole song.']]
]);
const letters='CDEFGAB',natural=[0,2,4,5,7,9,11];
function endpoint(name,shift,key,transposeChord){
 const pc=name.slice(0,-1),octave=Number(name.at(-1)),acc=(pc[1]==='#')-(pc[1]==='b');
 const midi=12*(octave+1)+natural[letters.indexOf(pc[0])]+acc+shift;
 const spelled=transposeChord(pc,shift,key),oct=Math.floor(midi/12)-1;
 return {midi,step:oct*7+letters.indexOf(spelled[0]),acc:spelled[1]||'',name:spelled.replace('#','♯').replace('b','♭')+oct};
}
function resolve(url,shift,transposeChord){
 const row=ranges.get(url);
 if(!row)return null;
 const [key,low,high,scope,detail]=row;
 return {low:endpoint(low,shift,key,transposeChord),high:endpoint(high,shift,key,transposeChord),scope,detail};
}
const evidence={
 'reviewed lyric':'Pitch confirmed for this lyric; its onset is approximate.',
 'score+stem':'Aligned melody score, supported by the vocal stem.',
 score:'Aligned melody score.',
 'draft+stem':'Estimated from a draft melody transcription and the vocal stem.',
 'octave guide':'Estimated from the guide melody an octave above the low voice.',
 stem:'Estimated from the vocal stem; the detected note could be a harmony.',
 'stem+AnthemScore':'Two pitch methods agree on the vocal stem; the note could still be a harmony.'
};
function cuesFor(row,vocal,data,shift){
 const result={low:null,high:null};
 if(!data||!row?.vocalSha256||row.vocalSha256!==vocal?.playback?.sha256)return result;
 for(const side of ['low','high']){
  const cue=row[side];
  if(cue&&cue.midi===data[side].midi-shift&&Number.isFinite(cue.seconds)&&cue.seconds>=0&&cue.seconds<vocal.seconds&&Object.hasOwn(evidence,cue.evidence))result[side]=cue;
 }
 return result;
}
function cueTime(seconds){
 const t=Math.round(seconds*10);
 return Math.floor(t/600)+':'+String(Math.floor(t%600/10)).padStart(2,'0')+'.'+t%10;
}
// Compare ledger lines at sounding pitch. The tenor clef's written E4 sounds E3.
const treble={bottom:30,glyph:'\uE050',name:'Treble clef',octave:0};
const tenor={bottom:23,glyph:'\uE052',name:'Treble clef, sounding one octave lower',octave:-1};
function rangeClef(r){
 const ledger=(step,bottom)=>Math.floor(Math.max(0,bottom-step,step-bottom-8)/2);
 function cost({bottom}){
  const low=ledger(r.low.step,bottom),high=ledger(r.high.step,bottom);
  return [Math.max(low,high),low+high];
 }
 const a=cost(treble),b=cost(tenor);
 return b[0]<a[0]||(b[0]===a[0]&&b[1]<a[1])?tenor:treble;
}
function staff(svg,r){
 const clef=rangeClef(r),atlas=root.MeleteSoloRangeArt,art=atlas?.ranges[r.low.name+':'+r.high.name];
 svg.replaceChildren();svg.toggleAttribute('hidden',!art);
 if(art){
  const [view,split,ink]=art;
  svg.setAttribute('viewBox',view);svg.dataset.clef=clef.octave?'treble-8vb':'treble';
  // Both strings are local build artifacts from alphaTab, never user or recording metadata.
  svg.innerHTML=atlas.defs+ink;
  svg.closest('.solo-range').style.setProperty('--range-split',split+'%');
 }
 return clef;
}
// Also used by the harmony pitchbar. stop() releases immediately unless a tap needs a short audible cue.
function tone(ctx,out,pitch){
 const start=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();
 osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(6),new Float32Array([0,1,.44,.20,.10,.04])));
 osc.frequency.value=440*2**((pitch-69)/12);
 gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.09,start+.005);
 osc.connect(gain).connect(out);let ended=false;
 osc.onended=()=>{ended=true;osc.disconnect();gain.disconnect();};osc.start();
 return {osc,stop(minimum=0){
  if(ended)return;
  const at=Math.max(ctx.currentTime,start+minimum);
  gain.gain.cancelScheduledValues(at);gain.gain.setTargetAtTime(0,at,.004);osc.stop(at+.024);
 }};
}
function bind(box,{openAudio,transposeChord,onError,playFromCue}){
 const stage=box.querySelector('.range-pitches'),svg=stage.querySelector('svg');
 const buttons=[...stage.querySelectorAll('button')],times=box.querySelector('.range-times'),jumps=[...times.querySelectorAll('button')];
 let data=null,active=null,voice=null,disabled=false,seekDisabled=true,cues={};
 function availability(){
  for(const b of buttons)b.disabled=disabled;
  for(const b of jumps)b.disabled=disabled||seekDisabled||!cues[b.dataset.rangeCue];
 }
 for(const b of jumps)b.addEventListener('click',()=>{
  const cue=cues[b.dataset.rangeCue];if(!cue||b.disabled)return;
  cancel();playFromCue(cue.seconds);
 });
 function paintHeld(side){if(side)box.dataset.held=side;else delete box.dataset.held;}
 function cancel(){active=null;voice?.stop();voice=null;paintHeld(null);}
 function press(b,id){
  if(disabled||!data||active?.held)return;
  cancel();
  const side=b.dataset.edge,req=active={id,held:true};paintHeld(side);
  // Resume inside the user gesture. A quick release while resume is pending still gets one short cue.
  openAudio().then(({ctx,output})=>{
   if(active!==req)return;
   voice=tone(ctx,output,data[side].midi);
   if(!req.held)voice.stop(.20);
  }).catch(e=>{if(active===req){cancel();onError(e);}});
 }
 function release(id){
  if(!active?.held||active.id!==id)return;
  active.held=false;paintHeld(null);
  if(voice)voice.stop(.20);
  // On a fresh touch-only browser, the first activating gesture can be touch-up rather than down.
  else openAudio().catch(()=>{}); // The pending press owns error reporting and oscillator creation.
 }
 for(const b of buttons){
  b.addEventListener('pointerdown',e=>{
   if(e.button!==0||!e.isPrimary||disabled||active?.held)return;
   b.setPointerCapture(e.pointerId);press(b,e.pointerId);
  });
  b.addEventListener('pointerup',e=>release(e.pointerId));
  b.addEventListener('pointercancel',e=>{if(active?.id===e.pointerId)cancel();});
  b.addEventListener('lostpointercapture',e=>{if(active?.held&&active.id===e.pointerId)cancel();});
  b.addEventListener('contextmenu',e=>e.preventDefault());
  b.addEventListener('keydown',e=>{
   if(e.key!==' '&&e.key!=='Enter')return;e.preventDefault();e.stopPropagation();
   if(!e.repeat)press(b,e.key);
  });
  b.addEventListener('keyup',e=>{
   if(e.key!==' '&&e.key!=='Enter')return;e.preventDefault();e.stopPropagation();release(e.key);
  });
  b.addEventListener('blur',()=>{if(active?.held&&typeof active.id==='string')cancel();});
  b.addEventListener('click',e=>{if(!e.detail&&!active?.held){press(b,'activate');release('activate');}});
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
 window.addEventListener('blur',cancel);window.addEventListener('pagehide',cancel);
 return {cancel,show(url,shift,row,vocal){
  cancel();data=resolve(url,shift,transposeChord);
  cues=cuesFor(row,vocal,data,shift);
  box.hidden=false;stage.hidden=times.hidden=!data;availability();
  box.querySelector('.range-scope').textContent=data?.scope||'Not assessed';
  if(!data)return;
  const clef=staff(svg,data);
  for(const b of buttons){
   const side=b.dataset.edge,n=data[side];b.textContent=n.name;b.dataset.midi=n.midi;
   b.setAttribute('aria-label',`Preview ${side} note ${n.name}, sounding pitch. ${clef.name}. ${data.scope}. ${data.detail}`);
   b.dataset.help=data.detail+' Tap to hear; hold to sustain.';
  }
  for(const b of jumps){
   const side=b.dataset.rangeCue,cue=cues[side],name=data[side].name;
   const approx=cue&&!['score','score+stem'].includes(cue.evidence);
   const time=cue?cueTime(cue.seconds):'';
   b.textContent=cue?(approx?'≈':'')+time:'—';
   b.setAttribute('aria-label',cue?`Play recording near ${side} note ${name} at ${approx?'about ':''}${time}`:`No reliable timestamp for ${side} note ${name}`);
   b.title=b.dataset.help=cue?'Play just before '+(cue.location||'this note')+'. '+evidence[cue.evidence]:'No reliable solo timestamp for this note.';
  }
 },setDisabled(value,blockSeek=false){if(value&&!disabled)cancel();disabled=value;seekDisabled=blockSeek;availability();}};
}
const api={resolve,bind,tone,cuesFor,cueTime,rangeClef};
if(typeof module!=='undefined')module.exports=api;
root.MeleteFullPracticeRange=api;
})(typeof window==='undefined'?globalThis:window);
