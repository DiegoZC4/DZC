'use strict';
const $=id=>document.getElementById(id), A=RehearsalAnalysis;
const audio=$('audio'), COLORS=['#ec8f9f','#e2ba68','#69bdcd','#a8a0e6','#72c598','#d99ec5','#e7a57a','#88b4d0','#e2ba68'];
const LIGHT_COLORS=['#a22a4a','#866000','#087488','#6551a5','#197648','#944b85','#a05219','#356c98','#866000'];
function partColor(index,light=matchMedia('(prefers-color-scheme:light)').matches){
  const short=manifest.parts[index]?.short,roles={S:0,S1:0,S2:1,S2sol:1,A:2,A1:2,A2:3,T:4,T1:4,T2:5,B:6,B1:6,B2:7};
  return (light?LIGHT_COLORS:COLORS)[roles[short]??index%COLORS.length];
}
const fmt=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const icons=()=>window.lucide?.createIcons();
let manifest, original, anchors, selected=0, viewStart=0, viewSpan=24, follow=true;
let curves, worker, workerReady=false, busy=false, revision=0, completedRevision=-1, pending=false;
let drag=null, undoStack=[], redoStack=[], images=[], visibleParts=new Set(), lastMetrics=-1;
let paintQueued=false, overviewQueued=false, resetArmed=false, lastError='';
let storageKey, waveformScale=1, catalog, currentRecording, currentChannel, loadRevision=0;
const uiKey='melete-rehearsal-display:v2', DEFAULT_PITCH_PIXELS=18, MAX_PITCH_PIXELS=144;
let preferences={bands:true,drift:false,mismatch:false,settings:!matchMedia('(pointer:coarse), (max-width:760px)').matches,pitchPixels:DEFAULT_PITCH_PIXELS};
try{
  const saved=JSON.parse(localStorage.getItem(uiKey));
  for(const key of ['bands','drift','mismatch','settings'])if(typeof saved?.[key]==='boolean')preferences[key]=saved[key];
  if(Number.isFinite(saved?.pitchPixels))preferences.pitchPixels=A.clamp(saved.pitchPixels,4,MAX_PITCH_PIXELS);
}catch{}
function savePreferences(){try{localStorage.setItem(uiKey,JSON.stringify(preferences));}catch{}}
function syncPreferences(){
  for(const key of ['bands','drift','mismatch'])$(key).setAttribute('aria-pressed',String(preferences[key]));
  $('settings').setAttribute('aria-expanded',String(preferences.settings));$('settingsPanel').hidden=!preferences.settings;requestPaint();
}
function fullPitchRange(){
  const full=manifest.spectrum;
  if(!visibleParts.size||visibleParts.size===manifest.parts.length)return [full.low,full.high];
  const pitches=manifest.notes.filter(n=>visibleParts.has(n.part)).map(n=>n.pitch);
  if(!pitches.length)return [full.low,full.high];
  let lo=Math.floor(Math.min(...pitches)-2),hi=Math.ceil(Math.max(...pitches)+2);
  if(hi-lo<12){const mid=(lo+hi)/2;lo=Math.floor(mid-6);hi=lo+12;}
  return [Math.max(full.low,lo),Math.min(full.high,hi)];
}
function pitchRange(g=geometry()){
  const [lo,hi]=fullPitchRange(),span=Math.min(hi-lo,(g.specBottom-g.top)/preferences.pitchPixels);
  const high=hi-Math.min($('pitchScroll').scrollTop/preferences.pitchPixels,hi-lo-span);
  return [high-span,high];
}
function syncPitchScroll(g){
  const [lo,hi]=fullPitchRange(),scroll=$('pitchScroll');
  scroll.style.height=(g.specBottom-g.top)+'px';$('pitchExtent').style.height=((hi-lo)*preferences.pitchPixels)+'px';
}
function zoomPitch(delta,clientY,g=geometry()){
  const height=g.specBottom-g.top,[low,high]=pitchRange(g),[fullLow,fullHigh]=fullPitchRange();
  const fraction=A.clamp((clientY-$('chart').getBoundingClientRect().top-g.top)/height,0,1);
  const anchor=high-fraction*(high-low),fit=height/(fullHigh-fullLow);
  preferences.pitchPixels=A.clamp(height/(high-low)*Math.exp(-A.clamp(delta,-400,400)*.003),Math.max(4,fit),Math.max(MAX_PITCH_PIXELS,fit));
  syncPitchScroll(g);
  $('pitchScroll').scrollTop=(fullHigh-anchor)*preferences.pitchPixels-fraction*height;
  savePreferences();requestPaint();
}
function centerPitches(){
  if(!manifest)return;const g=geometry();syncPitchScroll(g);
  const notes=manifest.notes.filter(n=>visibleParts.has(n.part)).map(n=>n.pitch).sort((a,b)=>a-b);
  const center=notes.length?notes[Math.floor(notes.length/2)]:(manifest.spectrum.high+manifest.spectrum.low)/2;
  $('pitchScroll').scrollTop=(fullPitchRange()[1]-center)*preferences.pitchPixels-(g.specBottom-g.top)/2;
  requestPaint();
}
function partReason(flags){return [flags&1?'No ridge':null,flags&2?'Shared pitch':null,flags&4?'Competing path':null,flags&8?'Weak harmonics':null,flags&16?'Overlapping harmonics':null,flags&32?'Note boundary':null].filter(Boolean).join('; ')||'Distinct ridge';}
function signed(value){return (value>0?'+':'')+value.toFixed(0);}
function noteName(cents){const midi=Math.round(cents/100);return ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][(midi%12+12)%12]+(Math.floor(midi/12)-1);}
function palette(){const s=getComputedStyle(document.documentElement);return Object.fromEntries(['bg','text','muted','line','accent','warm','trace'].map(k=>[k,s.getPropertyValue('--'+k).trim()]));}
function geometry(){
  const w=$('plot').clientWidth,h=$('plot').clientHeight,top=35,bottom=h-26;
  const count=Number(preferences.drift)+Number(preferences.mismatch),panel=Math.min(105,Math.max(50,(h-200)/Math.max(1,count)));
  const specBottom=bottom-count*panel;let next=specBottom;
  const g={w,h,left:50,right:w-18,top,specBottom,bottom};
  if(preferences.drift){g.driftTop=next+25;g.driftBottom=next+panel-6;next+=panel;}
  if(preferences.mismatch){g.costTop=next+25;g.costBottom=next+panel-6;}
  return g;
}
function xAt(t,g=geometry()){return g.left+(t-viewStart)/viewSpan*(g.right-g.left);}
function timeAt(x,g=geometry()){return viewStart+(x-g.left)/(g.right-g.left)*viewSpan;}
function chartTime(e){return manifest?A.clamp(timeAt(e.clientX-$('chart').getBoundingClientRect().left),0,manifest.duration):0;}
function setView(start,span=viewSpan){if(!manifest)return;viewSpan=A.clamp(span,1,manifest.duration);viewStart=A.clamp(start,0,Math.max(0,manifest.duration-viewSpan));$('windowSize').textContent=`${Number(viewSpan.toFixed(1))} s`;requestPaint();}
function setFollow(value){follow=value;$('follow').setAttribute('aria-pressed',String(follow));}
function seek(t,center=false){if(!manifest)return;audio.currentTime=A.clamp(t,0,manifest.duration);if(center||t<viewStart||t>viewStart+viewSpan)setView(t-viewSpan*.25);renderPosition();}
function sizeCanvas(canvas){const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return [ctx,rect.width,rect.height];}
function requestPaint(){if(paintQueued)return;paintQueued=true;requestAnimationFrame(()=>{paintQueued=false;draw();drawOverview();drawBoundaries();renderPosition();});}
function drawOverview(){if(!manifest)return;const [ctx,w,h]=sizeCanvas($('overview')),p=palette();ctx.fillStyle=p.bg;ctx.fillRect(0,0,w,h);ctx.strokeStyle=p.muted;ctx.globalAlpha=.6;ctx.beginPath();const wave=manifest.waveform;for(let x=0;x<w;x++){const a=Math.floor(x/w*wave.length),b=Math.max(a+1,Math.floor((x+1)/w*wave.length));let v=0;for(let i=a;i<b;i++)v=Math.max(v,wave[i]);const height=Math.min(25,Math.sqrt(v)*waveformScale);ctx.moveTo(x,h/2-height);ctx.lineTo(x,h/2+height);}ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=p.accent;ctx.globalAlpha=.12;ctx.fillRect(viewStart/manifest.duration*w,0,viewSpan/manifest.duration*w,h);ctx.globalAlpha=1;ctx.strokeStyle=p.accent;ctx.strokeRect(viewStart/manifest.duration*w,.5,viewSpan/manifest.duration*w,h-1);ctx.strokeStyle=p.line;for(let i=0;i<anchors.length;i++){const x=anchors[i]/manifest.duration*w;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,8);ctx.stroke();}ctx.fillStyle=p.warm;ctx.fillRect(audio.currentTime/manifest.duration*w,0,2,h);}
function draw(){if(!manifest)return;const [ctx]=sizeCanvas($('chart')),g=geometry(),p=palette();syncPitchScroll(g);ctx.fillStyle=p.bg;ctx.fillRect(0,0,g.w,g.h);ctx.font='11px system-ui';ctx.textBaseline='middle';const map=A.mapper(original,anchors),[low,high]=pitchRange(g);
  const yAt=pitch=>g.specBottom-(pitch-low)/(high-low)*(g.specBottom-g.top);
  ctx.save();ctx.beginPath();ctx.rect(g.left,g.top,g.right-g.left,g.specBottom-g.top);ctx.clip();
  const light=matchMedia('(prefers-color-scheme:light)').matches;ctx.globalAlpha=light?.72:.86;ctx.filter=light?'invert(1)':'none';
  for(const tile of images){if(!tile.image.complete||!tile.image.naturalWidth||tile.end<viewStart||tile.start>viewStart+viewSpan)continue;const sy=(manifest.spectrum.high-high)/(manifest.spectrum.high-manifest.spectrum.low)*tile.image.naturalHeight,sh=(high-low)/(manifest.spectrum.high-manifest.spectrum.low)*tile.image.naturalHeight;ctx.drawImage(tile.image,0,sy,tile.image.naturalWidth,sh,xAt(tile.start,g),g.top,(tile.end-tile.start)/viewSpan*(g.right-g.left),g.specBottom-g.top);}
  ctx.filter='none';ctx.globalAlpha=1;
  for(let pitch=Math.ceil(low);pitch<=high;pitch++){ctx.strokeStyle=p.line;ctx.globalAlpha=pitch%12===0?.7:.22;ctx.beginPath();ctx.moveTo(g.left,yAt(pitch));ctx.lineTo(g.right,yAt(pitch));ctx.stroke();}ctx.globalAlpha=1;
  for(const n of manifest.notes){
    if(!visibleParts.has(n.part))continue;const a=map(n.onset),b=map(n.offset);
    if(b<viewStart||a>viewStart+viewSpan||n.pitch+.5<low||n.pitch-.5>high)continue;
    const x1=Math.max(g.left,xAt(a,g)),x2=Math.min(g.right,xAt(b,g)),color=partColor(n.part,light);
    ctx.strokeStyle=ctx.fillStyle=color;ctx.lineWidth=1;
    if(preferences.bands){
      const top=yAt(n.pitch+.5),height=yAt(n.pitch-.5)-top;
      ctx.globalAlpha=light?.17:.2;ctx.fillRect(x1,top,x2-x1,height);
      ctx.globalAlpha=.65;ctx.strokeRect(x1,top,x2-x1,height);
    }else{
      ctx.globalAlpha=.7;ctx.beginPath();ctx.moveTo(x1,yAt(n.pitch));ctx.lineTo(x2,yAt(n.pitch));ctx.moveTo(x1,yAt(n.pitch)-3);ctx.lineTo(x1,yAt(n.pitch)+3);ctx.stroke();
    }
  }
  ctx.globalAlpha=1;drawParts(ctx,g,yAt,light);
  ctx.restore();ctx.fillStyle=p.muted;ctx.textAlign='right';for(let pitch=Math.ceil(low);pitch<=high;pitch++){if(pitch%12!==0&&pitch%12!==5)continue;ctx.fillText(noteName(pitch*100),g.left-9,yAt(pitch));}
  const panels=[];
  if(preferences.drift)panels.push([g.driftTop,g.driftBottom,-80,80,'cents',p.warm]);
  if(preferences.mismatch)panels.push([g.costTop,g.costBottom,0,1,'index',p.trace]);
  for(const [top,bottom,lo,hi,label,color] of panels){ctx.fillStyle=p.muted;ctx.textAlign='left';ctx.fillText(label,4,top-13);for(const v of [lo,(lo+hi)/2,hi]){const y=bottom-(v-lo)/(hi-lo)*(bottom-top);ctx.strokeStyle=p.line;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(g.left,y);ctx.lineTo(g.right,y);ctx.stroke();ctx.textAlign='right';ctx.fillText(v===0?'0':String(v),g.left-9,y);}ctx.fillStyle=color;ctx.textAlign='left';ctx.fillText(label==='cents'?'Tuning drift':'Chord mismatch',g.left,top-13);}
  ctx.lineWidth=1;for(let i=0;i<anchors.length;i++){const x=xAt(anchors[i],g);if(x<g.left||x>g.right)continue;ctx.strokeStyle=i===selected?p.warm:p.line;ctx.globalAlpha=i===selected?.7:.4;ctx.beginPath();ctx.moveTo(x,34);ctx.lineTo(x,g.bottom);ctx.stroke();}ctx.globalAlpha=1;
  if(curves&&preferences.drift)drawCurve(ctx,curves.drift,g.driftTop,g.driftBottom,-80,80,p.warm,g,p);
  if(curves&&preferences.mismatch)drawCurve(ctx,curves.mismatch,g.costTop,g.costBottom,0,1,p.trace,g,p);
  ctx.textAlign='center';ctx.fillStyle=p.muted;const step=[1,2,5,10,20,30,60].find(s=>s/viewSpan*(g.right-g.left)>=56)||60;for(let t=Math.ceil(viewStart/step)*step;t<=viewStart+viewSpan;t+=step){const x=xAt(t,g);if(x<g.left+16||x>g.right-16)continue;ctx.fillText(fmt(t),x,g.h-11);}
}
function drawParts(ctx,g,yAt,light){
  if(!curves?.partPitch)return;
  const count=curves.times.length,first=Math.max(0,nearestFrame(viewStart)-1),last=nearestFrame(viewStart+viewSpan),stale=!!drag||completedRevision!==revision;
  for(const part of visibleParts)for(let level=0;level<3;level++){
    ctx.beginPath();let connected=false;
    for(let i=first;i<=last;i++){
      const ix=part*count+i,pitch=curves.partPitch[ix],confidence=curves.partConfidence[ix],bucket=confidence>=.65?2:confidence>=.4?1:0;
      if(!Number.isFinite(pitch)||bucket!==level){connected=false;continue;}
      const x=xAt(curves.times[i],g),y=yAt(pitch/100);
      if(connected&&Math.abs(pitch-curves.partPitch[ix-1])<180)ctx.lineTo(x,y);else ctx.moveTo(x,y);
      connected=true;
    }
    ctx.strokeStyle=partColor(part,light);ctx.lineWidth=2.2;
    ctx.globalAlpha=stale?.18:level===2?1:level===1?.8:.6;
    ctx.setLineDash(level===0?[3,3]:level===1?[7,2]:[]);ctx.stroke();
  }
  ctx.setLineDash([]);ctx.globalAlpha=1;ctx.lineWidth=1;
}
function drawCurve(ctx,values,top,bottom,lo,hi,color,g,p){ctx.lineWidth=1.7;const pendingStyle=!!drag||completedRevision!==revision;for(let i=1;i<curves.times.length;i++){const t=curves.times[i];if(t<viewStart||t>viewStart+viewSpan||!Number.isFinite(values[i])||!Number.isFinite(values[i-1]))continue;const uncertain=curves.flags[i]>0||curves.flags[i-1]>0;ctx.strokeStyle=pendingStyle||uncertain?p.muted:color;ctx.globalAlpha=pendingStyle?.28:uncertain?.5:1;ctx.beginPath();ctx.moveTo(xAt(curves.times[i-1],g),bottom-(values[i-1]-lo)/(hi-lo)*(bottom-top));ctx.lineTo(xAt(t,g),bottom-(values[i]-lo)/(hi-lo)*(bottom-top));ctx.stroke();}ctx.globalAlpha=1;}
function drawBoundaries(){if(!manifest||drag)return;const host=$('boundaries'),g=geometry();host.replaceChildren();let last=-100;const chosenX=xAt(anchors[selected],g);for(let i=0;i<anchors.length;i++){const x=xAt(anchors[i],g);if(x<g.left||x>g.right)continue;if(i!==selected&&(x-last<32||Math.abs(x-chosenX)<32))continue;const b=document.createElement('button');b.className='boundary'+(i===selected?' selected':'');b.dataset.index=i;b.style.left=x+'px';b.textContent=i===anchors.length-1?'End':String(i+1);b.setAttribute('aria-label',`${i===anchors.length-1?'Music end':'Measure '+(i+1)} boundary, ${anchors[i].toFixed(2)} seconds`);b.title='Drag to align; arrow keys nudge';host.append(b);last=x;}}
function updateBoundaryPositions(){const g=geometry();for(const b of $('boundaries').children)b.style.left=xAt(anchors[Number(b.dataset.index)],g)+'px';}
function select(index,center=false){selected=index;$('measure').value=index;$('boundaryTime').value=anchors[index].toFixed(3);for(const b of $('boundaries').children)b.classList.toggle('selected',Number(b.dataset.index)===index);if(center)setView(anchors[index]-viewSpan*.2);requestPaint();}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify({version:1,sourceSha256:manifest.sourceSha256,scoreSha256:manifest.scoreSha256,anchors}));$('saveStatus').textContent='Saved';}catch{$('saveStatus').textContent='Not saved';$('saveStatus').title='Browser storage unavailable. Export alignment to keep these edits.';}}
function alignmentStorageKey(m){return `melete-rehearsal:${m.alignmentSourceSha256||m.sourceSha256}:${m.scoreSha256}:v1${m.alignmentSha256?':'+m.alignmentSha256:''}`;}
function shiftedPreviousAnchors(values){
  const previous=manifest.previousTimeline;
  if(!previous||!A.validateAnchors(values,original.map(t=>t+previous.offsetSeconds),manifest.duration+previous.offsetSeconds))return null;
  const shifted=values.map(t=>t-previous.offsetSeconds);
  return A.validateAnchors(shifted,original,manifest.duration)?shifted:null;
}
function importedAnchors(saved){
  if(saved.scoreSha256!==manifest.scoreSha256)return null;
  const matches=source=>!!source&&(saved.sourceSha256===source||
    (saved.alignmentId===manifest.alignmentId&&saved.alignmentSourceSha256===source));
  if(matches(manifest.sourceSha256)||matches(manifest.alignmentSourceSha256))
    return A.validateAnchors(saved.anchors,original,manifest.duration)?saved.anchors.slice():null;
  if(manifest.previousTimeline&&matches(manifest.previousTimeline.alignmentSourceSha256))return shiftedPreviousAnchors(saved.anchors);
  return null;
}
function updateHistory(){ $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length; }
function commit(before){if(before.every((v,i)=>Math.abs(v-anchors[i])<1e-7))return;undoStack.push(before);if(undoStack.length>100)undoStack.shift();redoStack=[];updateHistory();persist();revision++;requestAnalysis();select(selected);}
function editBoundary(index,value){if(!manifest||!Number.isFinite(value))return;const before=anchors.slice();anchors=A.moveAnchor(anchors,index,value,manifest.duration);commit(before);}
function alignmentHistory(redo){if(!manifest)return;const from=redo?redoStack:undoStack,to=redo?undoStack:redoStack;if(!from.length)return;to.push(anchors.slice());anchors=from.pop();persist();updateHistory();revision++;requestAnalysis();select(selected);}
function requestAnalysis(){pending=true;document.body.classList.add('pending');$('analysisStatus').textContent='Updating curves...';requestPaint();dispatchAnalysis();}
function dispatchAnalysis(){if(!workerReady||busy||!pending)return;busy=true;pending=false;worker.postMessage({type:'analyze',revision,anchors});}
function nearestFrame(t){let lo=0,hi=curves.times.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(curves.times[mid]<t)lo=mid+1;else hi=mid;}return lo>0&&Math.abs(t-curves.times[lo-1])<=Math.abs(curves.times[lo]-t)?lo-1:lo;}
function renderMetrics(t){
  if(!curves||drag||completedRevision!==revision)return;
  const i=nearestFrame(t),d=curves.drift[i],m=curves.mismatch[i];
  $('drift').title=`Slow tuning drift relative to A440${Number.isFinite(d)?': '+signed(d)+' cents':''}. 90-second reference, limited to 10 cents/min.`;
  $('mismatch').title=`Spectral chord mismatch${Number.isFinite(m)?': '+m.toFixed(3):''}. A vowel-sensitive index, not a grade or cents error.`;
}
function renderPosition(){if(!manifest)return;const t=audio.currentTime,g=geometry(),x=xAt(t,g);$('seek').value=t;$('clock').textContent=`${fmt(t)} / ${fmt(manifest.duration)}`;$('playhead').style.left=x+'px';$('playhead').hidden=x<g.left||x>g.right;$('overview').setAttribute('aria-valuenow',t.toFixed(2));if(Math.abs(t-lastMetrics)>.075||audio.paused){renderMetrics(t);lastMetrics=t;}}
function animate(){if(manifest&&!audio.paused){if(follow&&(audio.currentTime>viewStart+viewSpan*.88||audio.currentTime<viewStart))setView(audio.currentTime-viewSpan*.18);renderPosition();if(!overviewQueued){overviewQueued=true;setTimeout(()=>{overviewQueued=false;drawOverview();},100);}}requestAnimationFrame(animate);}
async function toggle(){if(!manifest)return;try{if(audio.paused){if(audio.currentTime>=manifest.duration-.05)seek(0,true);await audio.play();}else audio.pause();}catch(error){$('analysisStatus').textContent='Playback unavailable';$('analysisStatus').title=error.message;}}
function playbackIcon(){ $('play').innerHTML=`<i data-lucide="${audio.paused?'play':'pause'}"></i>`;$('play').setAttribute('aria-label',audio.paused?'Play':'Pause');icons(); }

$('play').onclick=toggle;
audio.addEventListener('play',playbackIcon);audio.addEventListener('pause',()=>{playbackIcon();renderPosition();drawOverview();});audio.addEventListener('seeked',()=>{renderPosition();drawOverview();});
audio.addEventListener('error',()=>{$('analysisStatus').textContent='Recording unavailable';});
$('seek').oninput=()=>seek(Number($('seek').value));
$('speed').onchange=()=>{audio.playbackRate=Number($('speed').value);};
$('volume').oninput=()=>{audio.volume=Number($('volume').value);};
$('mute').onclick=()=>{audio.muted=!audio.muted;$('mute').setAttribute('aria-pressed',String(audio.muted));};
$('measure').onchange=()=>select(Number($('measure').value),true);
$('boundaryTime').onchange=()=>editBoundary(selected,Number($('boundaryTime').value));
$('place').onclick=()=>editBoundary(selected,audio.currentTime);
$('undo').onclick=()=>alignmentHistory(false);$('redo').onclick=()=>alignmentHistory(true);
$('zoomIn').onclick=()=>{const c=viewStart+viewSpan/2;setView(c-viewSpan/3,viewSpan/1.5);};
$('zoomOut').onclick=()=>{const c=viewStart+viewSpan/2;setView(c-viewSpan*.75,viewSpan*1.5);};
$('previous').onclick=()=>{setFollow(false);setView(viewStart-viewSpan*.8);};
$('next').onclick=()=>{setFollow(false);setView(viewStart+viewSpan*.8);};
$('follow').onclick=()=>{setFollow(!follow);if(follow)setView(audio.currentTime-viewSpan*.2);};
for(const key of ['bands','drift','mismatch','settings'])$(key).onclick=()=>{preferences[key]=!preferences[key];savePreferences();syncPreferences();};
$('pitchScroll').addEventListener('scroll',requestPaint);
$('plot').addEventListener('wheel',e=>{
  if(!manifest)return;
  const g=geometry(),unit=e.deltaMode===1?16:e.deltaMode===2?g.specBottom-g.top:1;
  const delta=(Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY)*unit;
  if(e.altKey){
    e.preventDefault();setFollow(false);
    const fraction=A.clamp((e.clientX-$('chart').getBoundingClientRect().left-g.left)/(g.right-g.left),0,1);
    const anchor=viewStart+fraction*viewSpan,span=A.clamp(viewSpan*Math.exp(A.clamp(delta,-400,400)*.003),1,manifest.duration);
    setView(anchor-fraction*span,span);
  }else if(e.metaKey){
    e.preventDefault();setFollow(false);setView(viewStart+delta/(g.right-g.left)*viewSpan);
  }else if(e.shiftKey&&!e.ctrlKey){
    e.preventDefault();zoomPitch(delta,e.clientY,g);
  }else if(!e.ctrlKey&&e.target!==$('pitchScroll')){
    e.preventDefault();$('pitchScroll').scrollTop+=e.deltaY*unit;
  }
},{passive:false});
$('reset').onclick=()=>{if(!resetArmed){resetArmed=true;$('reset').style.color='var(--warn)';$('reset').title='Click again to restore automatic alignment';setTimeout(()=>{resetArmed=false;$('reset').style.color='';$('reset').title='Restore automatic alignment';},4000);return;}resetArmed=false;const before=anchors.slice();anchors=original.slice();commit(before);$('reset').style.color='';};
$('export').onclick=()=>{const payload={version:1,id:manifest.id,alignmentId:manifest.alignmentId,alignmentSourceSha256:manifest.alignmentSourceSha256,sourceSha256:manifest.sourceSha256,scoreSha256:manifest.scoreSha256,anchors,measures:manifest.measures.map((m,i)=>({measure:m.measure,start:anchors[i],end:anchors[i+1]}))};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=(manifest.alignmentId||manifest.id)+'-alignment.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onclick=()=>$('importFile').click();
$('importFile').onchange=async()=>{try{const file=$('importFile').files[0];if(!file)return;if(file.size>200000)throw Error('Alignment file is too large');const token=loadRevision,saved=JSON.parse(await file.text());if(token!==loadRevision)return;const restored=importedAnchors(saved);if(!restored)throw Error('Alignment does not match this recording and score');const before=anchors.slice();anchors=restored;commit(before);}catch(error){$('saveStatus').textContent='Import rejected';$('saveStatus').title=error.message;}finally{$('importFile').value='';}};

$('boundaries').addEventListener('pointerdown',e=>{const b=e.target.closest('.boundary');if(!b||e.button>0)return;e.preventDefault();selected=Number(b.dataset.index);select(selected);drag={index:selected,before:anchors.slice(),x:e.clientX,time:anchors[selected],target:b};b.setPointerCapture(e.pointerId);setFollow(false);});
$('boundaries').addEventListener('pointermove',e=>{if(!drag)return;const g=geometry(),delta=(e.clientX-drag.x)/(g.right-g.left)*viewSpan;anchors=A.moveAnchor(drag.before,drag.index,drag.time+delta,manifest.duration);$('boundaryTime').value=anchors[selected].toFixed(3);updateBoundaryPositions();draw();renderPosition();});
function endDrag(e){if(!drag)return;const before=drag.before;if(e.type==='pointercancel')anchors=before.slice();drag=null;commit(before);requestPaint();}
$('boundaries').addEventListener('pointerup',endDrag);$('boundaries').addEventListener('pointercancel',endDrag);
$('boundaries').addEventListener('lostpointercapture',e=>{if(drag)endDrag({type:'pointercancel'});});
$('boundaries').addEventListener('keydown',e=>{const b=e.target.closest('.boundary');if(!b)return;const i=Number(b.dataset.index);if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();selected=i;editBoundary(i,anchors[i]+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?.1:.01));requestAnimationFrame(()=>$('boundaries').querySelector(`[data-index="${i}"]`)?.focus());}});
let chartPress;
$('chart').addEventListener('pointerdown',e=>{if(e.button===0&&manifest){chartPress={x:e.clientX,y:e.clientY,start:viewStart,scroll:$('pitchScroll').scrollTop};$('chart').setPointerCapture(e.pointerId);}});
$('chart').addEventListener('pointerup',e=>{if(chartPress&&!chartPress.moved&&Math.hypot(e.clientX-chartPress.x,e.clientY-chartPress.y)<8)seek(chartTime(e));chartPress=null;});
$('chart').addEventListener('pointercancel',()=>{chartPress=null;});
$('chart').addEventListener('pointermove',e=>{
  if(!manifest)return;const t=chartTime(e),g=geometry(),y=e.clientY-$('chart').getBoundingClientRect().top;
  if(chartPress&&e.buttons){
    const dx=e.clientX-chartPress.x,dy=e.clientY-chartPress.y;
    if(Math.hypot(dx,dy)>=8){chartPress.moved=true;setFollow(false);setView(chartPress.start-dx/(g.right-g.left)*viewSpan);$('pitchScroll').scrollTop=chartPress.scroll-dy;}
    if(chartPress.moved)return;
  }
  let text=t.toFixed(2)+' s';
  if(curves?.partPitch&&!drag&&completedRevision===revision&&y>=g.top&&y<=g.specBottom){
    const i=nearestFrame(t),[low,high]=pitchRange();let closest=null,distance=Infinity;
    for(const part of visibleParts){const ix=part*curves.times.length+i,pitch=curves.partPitch[ix];if(!Number.isFinite(pitch))continue;const dy=Math.abs(y-(g.specBottom-(pitch/100-low)/(high-low)*(g.specBottom-g.top)));if(dy<distance){distance=dy;closest={part,ix,pitch};}}
    if(closest&&distance<35){const {part,ix,pitch}=closest;text+=` | ${manifest.parts[part].short} ${noteName(pitch)} | ${signed(curves.partError[ix])} cents | confidence ${curves.partConfidence[ix].toFixed(2)} | ${partReason(curves.partFlags[ix])}`;}
  }
  if(curves&&!drag&&completedRevision===revision){const i=nearestFrame(t);if(preferences.drift&&y>=g.driftTop&&y<=g.driftBottom&&Number.isFinite(curves.drift[i]))text+=` | Tuning drift ${signed(curves.drift[i])} cents`;if(preferences.mismatch&&y>=g.costTop&&y<=g.costBottom&&Number.isFinite(curves.mismatch[i]))text+=` | Chord mismatch ${curves.mismatch[i].toFixed(3)}`;}
  $('hover').textContent=text;$('hover').hidden=false;
});
$('chart').addEventListener('pointerleave',()=>{$('hover').hidden=true;});
let overviewDrag=false;
function overviewSeek(e){if(!manifest)return;const r=$('overview').getBoundingClientRect();seek((e.clientX-r.left)/r.width*manifest.duration,true);}
$('overview').addEventListener('pointerdown',e=>{if(!manifest||e.button>0)return;overviewDrag=true;$('overview').setPointerCapture(e.pointerId);overviewSeek(e);});
$('overview').addEventListener('pointermove',e=>{if(overviewDrag)overviewSeek(e);});
for(const type of ['pointerup','pointercancel'])$('overview').addEventListener(type,()=>{overviewDrag=false;});
document.addEventListener('keydown',e=>{if(!manifest||e.target.isContentEditable||e.target.matches('textarea,input:not([type=range])'))return;if(e.target.matches('.boundary')&&['ArrowLeft','ArrowRight'].includes(e.key))return;const command=e.metaKey||e.ctrlKey;if(command&&e.key.toLowerCase()==='z'){e.preventDefault();alignmentHistory(e.shiftKey);return;}if(command)return;const key=e.key.toLowerCase();if(e.code==='Space'||key==='k'){e.preventDefault();e.stopPropagation();if(!e.repeat)toggle();}else if(['arrowleft','arrowright','j','l'].includes(key)){e.preventDefault();seek(audio.currentTime+(key==='j'?-10:key==='l'?10:key==='arrowleft'?-5:5));}else if(key==='home'||key==='end'){e.preventDefault();seek(key==='home'?0:manifest.duration,true);}else if(key==='m')$('mute').click();else if(key==='arrowup'||key==='arrowdown'){e.preventDefault();audio.volume=A.clamp(audio.volume+(key==='arrowup'?.05:-.05),0,1);$('volume').value=audio.volume;}else if(key==='>'||key==='<'){const options=[.5,.75,1,1.25,1.5],i=options.indexOf(audio.playbackRate);audio.playbackRate=options[A.clamp(i+(key==='>'?1:-1),0,4)];$('speed').value=audio.playbackRate;}else if((key===','||key==='.')&&audio.paused){e.preventDefault();seek(audio.currentTime+(key===','?-1:1)/30);}else if(/^[0-9]$/.test(key)){e.preventDefault();seek(Number(key)/10*manifest.duration,true);}else if(key==='f'){e.preventDefault();if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen?.();}},true);
document.addEventListener('click',e=>{if(e.detail>0)e.target.closest('button')?.blur();});
document.addEventListener('keyup',e=>{if(e.code==='Space'&&!e.target.isContentEditable&&!e.target.matches('textarea,input:not([type=range])')){e.preventDefault();e.stopPropagation();}},true);
new ResizeObserver(()=>requestPaint()).observe($('plot'));
function updatePartColors(){if(!manifest)return;for(const b of $('parts').querySelectorAll('button'))b.style.setProperty('--part',partColor(Number(b.dataset.part)));requestPaint();}
matchMedia('(prefers-color-scheme:light)').addEventListener('change',updatePartColors);

async function loadRecording(recording,channel){
  const token=++loadRevision,sameRecording=currentRecording?.id===recording.id;
  const keep={time:audio.currentTime,start:viewStart,span:viewSpan,parts:new Set(visibleParts),scroll:$('pitchScroll').scrollTop,undo:undoStack,redo:redoStack};
  const resume=sameRecording&&!audio.paused;
  audio.pause();worker?.terminate();worker=null;workerReady=busy=pending=false;curves=null;manifest=null;images=[];drag=null;
  currentRecording=recording;currentChannel=channel;lastError='';revision=0;completedRevision=-1;selected=0;
  undoStack=sameRecording?keep.undo:[];redoStack=sameRecording?keep.redo:[];updateHistory();resetArmed=false;$('reset').style.color='';
  $('play').disabled=true;$('saveStatus').textContent='Loading...';$('analysisStatus').textContent='Loading recording...';
  $('parts').replaceChildren();$('measure').replaceChildren();$('boundaries').replaceChildren();$('hover').hidden=true;$('playhead').hidden=true;
  for(const key of ['place','export','import','reset'])$(key).disabled=true;
  try{
  const response=await fetch(channel.manifest);if(!response.ok)throw Error('Analysis assets unavailable');
  const next=await response.json();if(token!==loadRevision)return;
  manifest=next;original=[...manifest.measures.map(m=>m.start),manifest.measures.at(-1).end];anchors=original.slice();
  // Synchronized microphones share one alignment, but unrelated recordings never do.
  storageKey=alignmentStorageKey(manifest);
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if(saved&&A.validateAnchors(saved.anchors,original,manifest.duration))anchors=saved.anchors;
    else if(manifest.previousTimeline){
      const old=JSON.parse(localStorage.getItem(alignmentStorageKey(manifest.previousTimeline)));
      const migrated=old?.scoreSha256===manifest.scoreSha256?shiftedPreviousAnchors(old.anchors):null;
      if(migrated){anchors=migrated;persist();}
    }
  }catch{/* Keep the source alignment if browser storage is unavailable. */}
  const sortedWave=manifest.waveform.slice().sort((a,b)=>a-b);waveformScale=23/Math.sqrt(Math.max(.001,sortedWave[Math.floor(sortedWave.length*.99)]));
  audio.src='audio.php?recording='+encodeURIComponent(channel.recordingId)+'&v='+manifest.sourceSha256;audio.playbackRate=Number($('speed').value);
  const initialTime=Math.max(0,original[0]-2);
  audio.onloadedmetadata=()=>{if(token!==loadRevision)return;audio.currentTime=sameRecording?Math.min(keep.time,manifest.duration):initialTime;if(resume)audio.play().catch(()=>{});};
  $('seek').max=manifest.duration;$('overview').setAttribute('aria-valuemax',manifest.duration);$('boundaryTime').max=manifest.duration;
  $('back').href=(document.body.dataset.practiceUrl||'../')+'#'+recording.song;document.title=`${recording.title} / ${recording.date} - Rehearsal Spectrogram`;
  visibleParts=sameRecording?keep.parts:new Set(manifest.parts.map(p=>p.index));
  for(let i=0;i<anchors.length;i++){const o=new Option(i===anchors.length-1?'End':'m'+(i+1),i);$('measure').add(o);}
  for(const part of [...manifest.parts].sort((a,b)=>{const rank=p=>p.short==='S2sol'?1.5:p.index;return rank(a)-rank(b);})){
    const b=document.createElement('button');
    b.dataset.part=part.index;b.textContent=part.short==='S2sol'?'S2 solo':part.short;b.setAttribute('aria-pressed',String(visibleParts.has(part.index)));
    b.title=`${part.name}: score and detected contour. Solid: stronger evidence; dashed: uncertain. Right-click or hold to isolate. Analysis always includes all parts.`;
    let held=false,timer;
    const sync=()=>{for(const button of $('parts').querySelectorAll('button'))button.setAttribute('aria-pressed',String(visibleParts.has(Number(button.dataset.part))));centerPitches();requestPaint();};
    const isolate=()=>{if(visibleParts.size===1&&visibleParts.has(part.index))visibleParts=new Set(manifest.parts.map(p=>p.index));else visibleParts=new Set([part.index]);sync();};
    b.onclick=()=>{if(held){held=false;return;}if(visibleParts.has(part.index))visibleParts.delete(part.index);else visibleParts.add(part.index);sync();};
    b.oncontextmenu=e=>{e.preventDefault();clearTimeout(timer);if(!held)isolate();};
    b.onpointerdown=e=>{clearTimeout(timer);held=false;if(e.button!==0)return;timer=setTimeout(()=>{if(token!==loadRevision)return;held=true;isolate();},500);};
    for(const event of ['pointerup','pointercancel','pointerleave'])b.addEventListener(event,()=>clearTimeout(timer));
    $('parts').append(b);
  }updatePartColors();
  images=manifest.spectrum.tiles.map(tile=>{const image=new Image();image.onload=requestPaint;image.src=tile.url;return {...tile,image};});
  worker=new Worker('analysis-worker.js?v=recordings-2');worker.onmessage=({data:r})=>{if(token!==loadRevision)return;if(r.type==='ready'){workerReady=true;dispatchAnalysis();}else if(r.type==='result'){busy=false;if(r.revision===revision){curves=r;completedRevision=r.revision;document.body.classList.remove('pending');$('analysisStatus').textContent='';$('analysisStatus').title=`Last calculation ${(r.elapsed/1000).toFixed(2)} seconds. Drift uses centered ${A.DRIFT.windowSeconds}-second medians. Confidence is heuristic, not a probability.`;requestPaint();}dispatchAnalysis();}else if(r.type==='error'){busy=false;lastError=r.message;$('analysisStatus').textContent='Analysis unavailable';$('analysisStatus').title=r.message;}};worker.onerror=e=>{if(token!==loadRevision)return;lastError=e.message;$('analysisStatus').textContent='Analysis unavailable';};worker.postMessage({type:'init',manifest});
  for(const key of ['place','export','import','reset'])$(key).disabled=false;
  $('play').disabled=false;$('saveStatus').textContent=anchors.some((a,i)=>a!==original[i])?'Saved alignment':'Automatic alignment';
  setView(sameRecording?keep.start:initialTime,sameRecording?keep.span:24);select(0);syncPitchScroll(geometry());
  if(sameRecording)$('pitchScroll').scrollTop=keep.scroll;else centerPitches();
  requestAnalysis();icons();
  }catch(error){if(token!==loadRevision)return;lastError=error.message;$('saveStatus').textContent='Could not load analysis';$('analysisStatus').textContent=error.message;}
}
function routeSelection(){
  let selection;
  try{selection=RehearsalRoute.resolve(catalog.recordings,location.href);}
  catch(error){lastError=error.message;$('saveStatus').textContent=error.message;return;}
  const {recording,channel}=selection,url=RehearsalRoute.urlFor(location.href,recording,channel);
  if(url!==location.href)window.history.replaceState(null,'',url);
  $('recording').value=recording.id;$('channel').replaceChildren(...recording.channels.map(c=>new Option(c.label,c.id)));
  $('channel').value=channel.id;$('channel').hidden=recording.channels.length<2;
  if(currentRecording?.id!==recording.id||currentChannel?.id!==channel.id)loadRecording(recording,channel);
}
function chooseRecording(record,channel){window.history.pushState(null,'',RehearsalRoute.urlFor(location.href,record,channel));routeSelection();}
$('recording').onchange=()=>{const record=catalog.recordings.find(r=>r.id===$('recording').value);chooseRecording(record,record.channels[0]);};
$('channel').onchange=()=>chooseRecording(currentRecording,currentRecording.channels.find(c=>c.id===$('channel').value));
window.addEventListener('hashchange',()=>{if(catalog)routeSelection();});
window.addEventListener('popstate',()=>{if(catalog)routeSelection();});
async function init(){
  syncPreferences();icons();animate();
  const response=await fetch('recordings.json');if(!response.ok)throw Error('Recording catalog unavailable');catalog=await response.json();
  if(!catalog.recordings?.length)throw Error('No recordings available');
  $('recording').replaceChildren(...catalog.recordings.map(r=>new Option(`${r.title} / ${r.date}`,r.id)));$('recording').disabled=false;routeSelection();
}
window.rehearsalState=()=>({ready:!!manifest,recording:currentRecording?.id,channel:currentChannel?.id,revision,completedRevision,busy,pending,selected,anchors:anchors?.slice(),original:original?.slice(),viewStart,viewSpan,playing:!audio.paused,time:audio.currentTime,error:lastError,curveFrames:curves?.times.length,partFrames:curves?.partPitch.length,undo:undoStack.length,redo:redoStack.length,visibleParts:[...visibleParts],source:audio.currentSrc,preferences:{...preferences},geometry:geometry(),pitchRange:manifest?pitchRange():[],pitchScroll:$('pitchScroll').scrollTop});
init().catch(error=>{lastError=error.message;$('saveStatus').textContent='Could not load analysis';$('analysisStatus').textContent=error.message;});
