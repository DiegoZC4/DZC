/* Full-song practice shares the audition UI controls, capture store and DSP modules. */
(function(){
'use strict';
const $=id=>document.getElementById(id),KEY='melete-full-song-mix-v1',PREF=KEY+'-controls';
let catalog,song,ctx,master,deck,buffers=[],peaks=[],mix=[],current=0,started=0,playing=false,playRate=1,playEnd=0,playLoop=false;
let recordEndAt=0,clickTrack=null,beatCatalog={},leadIn=null,cueGain=null;
let bars=[],loopState={},playLoopStart=0;
let harmonyRequest,singInput=null,singGeneration=0;
const P=MeleteFullPracticePitch,I=MeleteFullPracticeInput;
const L=MeleteFullPracticeLoop;
const T=MeleteFullPracticeTracks;
let loading=false,busy=false,recording=false,finishing=false,revision=0,playToken=0,abort,checkInput=null;
let lanes=[],layerAudio=null,targetId=null,soloId=null,libraryReady=false,libraryError='',loadEpoch=0,undoTimer=null,downloadSelection=null;
let pendingTrackEdits=0;
let lyricRequest,referenceCueRequest,pendingLyric=null,lyricSections=[],currentStanza=null;
let lyricChart=null,updateChord=null;
const C=MeleteFullPracticeChart;
const lyricFollow=new MeleteFullPracticeLyricFollow.Follower($('lyricBody'),$('lyricReturn'));
const pitchDisplay=key=>C.pitchDisplay(song.id,key,shift(),prefs.concertPitch!==false);
function transposeLyrics(){
 if(lyricChart){const d=pitchDisplay(lyricChart.key);C.transpose($('lyricBody'),d.shift,lyricChart.key,d.label);C.transpose($('lyricLegend'),d.shift,lyricChart.key,d.label);}
 transposeSheet();if(lyricView==='tabs'&&tabPart)drawTab();
}
function transposeSheet(){const sheet=$('chartBody');if(sheet.dataset.key){const d=pitchDisplay(sheet.dataset.key);C.sheetTranspose(sheet,d.shift,sheet.dataset.key,d.label);}}
function syncLyricDisplay(){
 const harmony=prefs.lyricHarmony!==false,chords=prefs.lyricChords!==false;
 $('lyricHarmony').checked=harmony;$('lyricChords').checked=chords;
 const hasRoles=C.hasRoles(lyricChart);
 $('lyricHarmony').closest('label').hidden=!hasRoles;
 $('lyricDisplay').hidden=!lyricChart;$('lyricLegend').hidden=!lyricChart||(!(harmony&&hasRoles)&&!chords);
 C.display($('lyricSheet'),{harmony,chords});
}
/* Lyrics / Chord chart view. Charts come from full-practice-charts.json, bound to the recording
   each was checked against; any other recording shows an honest "no chart" state. */
let lyricView=null,sheetRequest=null,sheetRun=0;
const reader=$('chartReader');
const loopHome=document.createComment('practice loop controls');$('loopDock').before(loopHome);
let readerReturnView='lyrics',readerNative=false,deferredAudio=null,readerExitUrl=null;
const sheetKey=s=>s.id+'/'+(s.referenceId||'playlist');
function chartData(){
 return sheetRequest??=fetch('full-practice-charts.json',{cache:'no-store'})
  .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
  .catch(e=>{sheetRequest=null;throw e;});
}
async function showChart(selected,token){
 const body=$('chartBody'),run=++sheetRun;
 body.dataset.for=sheetKey(selected);delete body.dataset.key;
 body.setAttribute('aria-label',selected.title+' chord chart');body.setAttribute('aria-busy','true');body.textContent='Loading chord chart…';
 try{
  const data=await chartData();if(run!==sheetRun||token!==revision)return;
  const select=$('referenceRecording'),recordings=Object.fromEntries([...select.options].map(o=>[o.value,o.text]));
  C.sheet(body,C.sheetFor(data,selected.id,selected.referenceId||'playlist'),{recordings,disabled:select.disabled,
   choose:ref=>{if(!select.disabled)void choose(selected.id,ref);}});
  body.scrollTop=0;transposeSheet();
 }catch{
  if(run===sheetRun){body.textContent='Chord charts unavailable.';delete body.dataset.for;}
 }finally{if(run===sheetRun)body.removeAttribute('aria-busy');}
}
function resetChart(selected,token){
 const body=$('chartBody');sheetRun++;delete body.dataset.for;delete body.dataset.key;body.replaceChildren();body.removeAttribute('aria-busy');
 const params=new URL(location.href).searchParams;
 const asked=token===1?(params.get('view')||(params.get('part')==='guitar'?'tabs':null)):null;
 if(asked)preferredView=asked;
 setLyricView(reader.open?'chart':preferredView||prefs.lyricView||(prefs.tabSongs?.[selected.id]?'tabs':'lyrics'));
 if(token===1&&params.get('reader')==='1')openReader(false);
}
let preferredView=null;
function viewOptions(){return tabPart?['lyrics','chart','tabs']:['lyrics','chart'];}
function setLyricView(view,remember=false){
 const was=lyricView;lyricView=viewOptions().includes(view)?view:'lyrics';
 const chart=lyricView==='chart',tabs=lyricView==='tabs',name=chart?'Chord chart':tabs?'Tabs':'Lyrics';
 $('lyricSheet').dataset.view=lyricView;$('lyricBody').hidden=chart||tabs;$('chartBody').hidden=!chart;$('guitarTab').hidden=!tabs;
 $('lyricHeading').textContent=name;
 for(const button of $('lyricView').querySelectorAll('button')){
  button.hidden=!viewOptions().includes(button.dataset.view);
  const on=button.dataset.view===lyricView;
  button.setAttribute('aria-selected',String(on));button.classList.toggle('is-active',on);button.tabIndex=on?0:-1;
 }
 syncViewPill();
 const jump=$('jumpLyrics'),label=[...jump.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
 if(label)label.textContent=chart?'Chart':name;jump.title='Jump to '+name.toLowerCase();
 if(chart){
  if(song&&$('chartBody').dataset.for!==sheetKey(song))void showChart(song,revision);else C.sheetFit($('chartBody'));
 }else if(tabs)drawTab();else if(was!=='lyrics')highlightLyrics(position());
 if(remember){preferredView=prefs.lyricView=lyricView;persist();}
 const url=new URL(location.href);
 url.searchParams.delete('part');if(lyricView!=='lyrics')url.searchParams.set('view',lyricView);else url.searchParams.delete('view');
 if(url.href!==location.href)history.replaceState(history.state,'',url);
}
function syncViewPill(){
 const pill=$('lyricView'),active=pill.querySelector('[aria-selected="true"]'),thumb=pill.querySelector('.pill-thumb');
 if(!active||!pill.offsetParent)return;
 thumb.style.width=`${active.offsetWidth}px`;thumb.style.transform=`translateX(${active.offsetLeft}px)`;
}
$('lyricView').onclick=e=>{const views=viewOptions(),next=views.length===2?views[1-views.indexOf(lyricView)]:e.target.closest('button')?.dataset.view;if(next)setLyricView(next,true);};
$('lyricView').onkeydown=e=>{
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();const views=viewOptions(),i=views.indexOf(lyricView);
 setLyricView(e.key==='End'?views.at(-1):e.key==='Home'?views[0]:views[(i+(e.key==='ArrowRight'?1:-1)+views.length)%views.length],true);
 $('lyricView').querySelector('[aria-selected="true"]').focus({preventScroll:true});
};
new ResizeObserver(syncViewPill).observe($('lyricView'));
new ResizeObserver(()=>{if(lyricView==='chart')C.sheetFit($('chartBody'));}).observe($('chartBody'));
function readerControls(){
 if(!reader.open||!song)return;
 const pick=$('readerSong'),ref=$('readerRef'),original=$('referenceRecording');
 if(!pick.length)for(const s of catalog.songs)pick.add(new Option(s.title,s.id));
 pick.value=song.id;
 if(ref.dataset.song!==song.id){
  ref.replaceChildren(...Array.from(original.options,o=>new Option(o.text,o.value)));ref.dataset.song=song.id;
 }
 ref.value=original.value;ref.hidden=!ref.length;
 for(const id of ['readerPrev','readerNext','readerSong','readerRef'])$(id).disabled=locked();
 const b=$('readerPlay'),label=playing?'Pause recording':'Play recording';
 b.disabled=locked()||(!deferredAudio&&(loading||!buffers.length));
 b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-busy',String(loading));
 if(b.dataset.playing!==String(playing)){b.dataset.playing=String(playing);b.innerHTML='<i data-lucide="'+(playing?'pause':'play')+'"></i>';icons();}
 $('readerTransport').hidden=!buffers.length||loading;
 $('readerSeek').max=duration()||1;$('readerSeek').disabled=locked();
}
function openReader(native){
 if(reader.open||!song)return;
 if(native)history.pushState({...history.state,chartReaderEntry:true},'',location.href);
 readerReturnView=lyricView;setLyricView('chart');
 $('readerContent').append($('chartBody'));$('readerTransport').append($('loopDock'));reader.showModal();readerControls();
 $('readerError').textContent=$('status').classList.contains('error')?$('status').textContent:'';
 $('readerError').hidden=!$('readerError').textContent;
 const url=new URL(location.href);url.searchParams.set('reader','1');history.replaceState(history.state,'',url);
 $('readerClose').focus({preventScroll:true});C.sheetFit($('chartBody'));
 if(native&&document.fullscreenEnabled&&!document.fullscreenElement)
  $('readerPanel').requestFullscreen?.().catch(()=>{}); // The dialog also fills the viewport on iOS.
}
function resumeAudioLoad(){const load=deferredAudio;deferredAudio=null;return load?.();}
async function readerPlayback(){
 if($('readerPlay').disabled)return;
 const token=revision;
 if(deferredAudio){
  try{const resumed=ensureAudio();await Promise.all([resumed,resumeAudioLoad()]);}
  catch(e){setError(e);return;}
 }
 if(token===revision&&reader.open)await play();
}
$('openChartReader').onclick=()=>openReader(true);
function closeReader(){if(reader.open)reader.close();finishReaderClose();}
$('readerClose').onclick=closeReader;
reader.oncancel=e=>{e.preventDefault();closeReader();};
reader.onclose=()=>{if(!reader.open)finishReaderClose();};
function finishReaderClose(){
 if($('chartBody').parentElement!==$('readerContent'))return;
 if(document.fullscreenElement===$('readerPanel'))void document.exitFullscreen().catch(()=>{});
 readerNative=false;$('lyricSheet').insertBefore($('chartBody'),$('lyricReturn'));
 loopHome.after($('loopDock'));
 setLyricView(readerReturnView);$('openChartReader').focus({preventScroll:true});
 const url=new URL(location.href),pop=history.state?.chartReaderEntry&&url.searchParams.has('reader');
 url.searchParams.delete('reader');url.hash=song.id;
 if(song.referenceId)url.searchParams.set('ref',song.referenceId);else url.searchParams.delete('ref');
 if(pop){readerExitUrl=url.href;history.back();}else history.replaceState(history.state,'',url);
 void resumeAudioLoad();
}
window.addEventListener('popstate',()=>{
 if(readerExitUrl){history.replaceState(history.state,'',readerExitUrl);readerExitUrl=null;return;}
 const url=new URL(location.href);
 if(reader.open&&!url.searchParams.has('reader'))closeReader();
 else if(!reader.open&&url.searchParams.get('reader')==='1'&&song){
  openReader(false);
  if(url.hash.slice(1)!==song.id||(url.searchParams.get('ref')||'playlist')!==(song.referenceId||'playlist'))
   void choose(url.hash.slice(1),url.searchParams.get('ref')||'playlist');
 }
});
document.addEventListener('fullscreenchange',()=>{
 if(document.fullscreenElement===$('readerPanel'))readerNative=true;
 else if(readerNative&&reader.open)closeReader();
});
function stepReader(d){const s=catalog.songs,i=s.findIndex(v=>v.id===song.id);void choose(s[(i+d+s.length)%s.length].id);}
$('readerPrev').onclick=()=>stepReader(-1);$('readerNext').onclick=()=>stepReader(1);
$('readerSong').onchange=e=>void choose(e.target.value);$('readerRef').onchange=e=>void choose(song.id,e.target.value);
$('readerPlay').onclick=()=>void readerPlayback();
$('readerSeek').oninput=e=>{$('readerTime').textContent=clock(Number(e.target.value));};
$('readerSeek').onchange=e=>seek(Number(e.target.value));
function cueSecond(t){return Math.max(0,t-.15);} // Leave the singer's first consonant intact.
function lyricJump(t,token){
 if(token!==revision||locked())return;
 if(loading){pendingLyric={token,t};return;}
 if(duration())seek(t);
}
function highlightLyrics(t){
 if(!$('guitarTab').hidden||lyricView==='chart')return;
 updateChord?.(t);
 lyricFollow.update(t,playing&&(recording||!!lyricChart?.clocked),!recording);
 const active=lyricSections.findLast(row=>row.at<=t)?.el||null;
 if(active===currentStanza)return;
 currentStanza?.removeAttribute('aria-current');active?.setAttribute('aria-current','location');currentStanza=active;
}
function cueButton(text,t,label,token){
 const button=document.createElement('button');button.type='button';button.className='lyric-seek';
 button.dataset.time=String(t);button.textContent=text;button.title='Jump to '+label+' at '+clock(t);
 button.setAttribute('aria-label',text+'; '+button.title);
 button.onclick=()=>lyricJump(t,token);return button;
}
function referenceCues(selected){
 referenceCueRequest??=fetch('full-practice-reference-cues.json').then(r=>{
  if(!r.ok)throw Error('Recording cues unavailable');return r.json();
 }).catch(e=>{referenceCueRequest=null;throw e;});
 return referenceCueRequest.then(rows=>{
  const cues=rows[selected.id+'/'+selected.referenceId];
  if(!cues)throw Error('No cues for the selected recording');return cues;
 });
}
function lyricsFor(selected){
 if(selected.referenceId)return referenceCues(selected).then(c=>c.lyrics);
 lyricRequest??=fetch('full-practice-lyrics.json').then(r=>{
  if(!r.ok)throw Error('Lyrics unavailable');return r.json();
 }).catch(e=>{lyricRequest=null;throw e;});
 return lyricRequest.then(rows=>rows[selected.id]);
}
async function showLyrics(selected, token){
 const body=$('lyricBody'),source=$('lyricSource');
 pendingLyric=null;lyricSections=[];currentStanza=null;
 lyricFollow.reset();updateChord=null;
 lyricChart=null;C.legend($('lyricLegend'),null);syncLyricDisplay();
 body.textContent='Loading lyrics...';body.setAttribute('aria-busy','true');source.replaceChildren();
 body.setAttribute('aria-label',selected.title+' lyrics');
 try{
  const entry=await lyricsFor(selected);
  if(token!==revision)return;
  if(!entry?.sections?.length)throw new Error('No lyrics');
  const content=document.createDocumentFragment(),stem=selected.tracks.find(t=>t.id==='vocals'),followRows=[];
  const cues=stem?.playback?.sha256&&entry.timing?.vocalSha256===stem.playback.sha256?entry.timing.lines:null;
  lyricChart=entry.performance||null;C.legend($('lyricLegend'),lyricChart);
  const makeSeek=(text,t,label)=>cueButton(text,t,label,token);
  if(lyricChart)C.bars(content,lyricChart.before,makeSeek);
  for(const [i,{label,lines}] of entry.sections.entries()){
   const stanza=document.createElement('section'),heading=document.createElement('h3');
   const chart=lyricChart?.sections[i];if(chart?.noteTitle)heading.title=chart.noteTitle;
   stanza.className='lyric-stanza';const row=cues?.[i],timed=row?.length===lines.length&&Number.isFinite(row[0]);
   if(timed){
    const at=cueSecond(row[0]),button=cueButton(label,at,label,token),time=document.createElement('span');
    time.textContent=clock(at);time.className='lyric-stamp';button.append(time);heading.append(button);
    lyricSections.push({at,el:stanza});
   }else heading.textContent=label;
   stanza.append(heading);
   C.bars(stanza,chart?.before,makeSeek);
   for(const [j,line] of lines.entries()){
    const p=document.createElement('p');p.dataset.lyric=line;const detail=chart?.lines[j];
    if(timed){
     const exact=Number.isFinite(row[j]),at=cueSecond(exact?row[j]:row[0]);
     const button=cueButton(line,at,exact?label+', line '+(j+1):'start of '+label,token);
     C.line(button,line,detail);p.append(button);
     if(exact)followRows.push({at:lyricChart?.clocked?row[j]:at,el:p});
    }else C.line(p,line,detail);
    stanza.append(p);
    C.bars(stanza,detail?.after,makeSeek);
   }
   C.bars(stanza,chart?.after,makeSeek);
   content.append(stanza);
  }
  if(entry.url){
   const a=document.createElement('a');a.href=entry.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=entry.source;source.append(a);
  }else source.textContent=entry.source;
  if(lyricChart?.clocked){
   for(const row of content.querySelectorAll('.lyric-bars')){
    const first=row.querySelector('[data-chord-time]');if(first)followRows.push({at:Number(first.dataset.chordTime),el:row});
   }
   followRows.sort((a,b)=>a.at-b.at);
   updateChord=C.chordClock(content);
  }
  body.replaceChildren(content);body.scrollTop=0;lyricFollow.reset(followRows);transposeLyrics();syncLyricDisplay();syncLyricLock();highlightLyrics(position());
 }catch{
  if(token===revision)body.textContent='Lyrics unavailable for this song.';
 }finally{if(token===revision)body.removeAttribute('aria-busy');}
}
$('jumpLyrics').onclick=()=>{$('lyricSheet').scrollIntoView({block:'start'});$(lyricView==='chart'?'chartBody':lyricView==='tabs'?'tabBody':'lyricBody').focus({preventScroll:true});};
let lyricTouch=null,lyricDragged=false;
$('lyricBody').addEventListener('pointerdown',e=>{lyricTouch=[e.clientX,e.clientY];lyricDragged=false;});
$('lyricBody').addEventListener('pointermove',e=>{
 if(lyricTouch&&Math.hypot(e.clientX-lyricTouch[0],e.clientY-lyricTouch[1])>8)lyricDragged=true;
});
$('lyricBody').addEventListener('pointerup',()=>{lyricTouch=null;});
$('lyricBody').addEventListener('pointercancel',()=>{lyricTouch=null;lyricDragged=true;});
$('lyricBody').addEventListener('click',e=>{
 if(e.detail&&lyricDragged){e.preventDefault();e.stopPropagation();}
 lyricDragged=false;
},true);
function syncLyricLock(){$('lyricBody').querySelectorAll('button').forEach(b=>b.disabled=locked()||(!loading&&!duration()));}
const localRows=new Map();
const audibleStems=()=>soloId?mix.map(m=>({...m,on:soloId==='stem:'+m.id})):mix;
const audibleLanes=()=>soloId?lanes.map(l=>({...l,on:soloId===l.id})):lanes;
const sourceVersion=()=>song?.tracks.map(t=>t.sha256||t.file).join(':')||'';
const tuningCents=()=>song?.tuning?.sourceVersion===sourceVersion()?song.tuning.correctionCents:0;
const activeLane=()=>lanes.find(l=>l.id===targetId);
const locked=()=>busy||recording||finishing||!!recorder.recovery();
const setError=e=>status(e.message||String(e),true);
let saved={},prefs={songs:{},device:'',deviceExplicit:false,sing:false,loop:false,click:true,clickLevel:50,countInBeats:4,scale:100,stretch:100,lyricHarmony:true,lyricChords:true};
try{saved=JSON.parse(localStorage.getItem(KEY)||'{}');prefs={...prefs,...JSON.parse(localStorage.getItem(PREF)||'{}')};}catch{}
if(![0,2,3,4,8].includes(prefs.countInBeats))prefs.countInBeats=4;
$('countInBeats').value=String(prefs.countInBeats);
const audioLoader=new MeleteFullPracticeLoader.Loader();
const icons=()=>window.lucide?.createIcons(),clock=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const duration=()=>buffers.length?Math.min(...buffers.map(b=>b.duration)):0;
const config=()=>prefs.songs[song?.id]||{};
const rate=()=>speed.value(),shift=()=>transpose.value();
const position=()=>playing?L.position(current+Math.max(0,ctx.currentTime-started)*playRate,playLoopStart,playEnd,playLoop):current;
const loopRange=()=>L.range(loopState,bars,duration());
const activeLoop=()=>loopState.enabled?loopRange():null;
function saveLoop(){
 if(song){const c=config(),loop={...loopState,sourceVersion:sourceVersion()};
  prefs.songs[song.id]=song.referenceId?{...c,referenceLoops:{...c.referenceLoops,[song.referenceId]:loop}}:{...c,loop};
 }
 persist();
}
function syncLoop(){
 const selected=loopRange(),active=!!activeLoop();
 const unit=L.mode(loopState,bars),timed=unit==='time';
 $('loopControls').dataset.unit=unit;$('loopUnit').hidden=!bars.length;
 $('loopUnit').setAttribute('aria-checked',String(timed));
 for(const side of ['start','end']){
  const button=$('loop'+(side==='start'?'Start':'End')),n=loopState[side];
  const value=Number.isFinite(n)?(timed?L.timeLabel(n):String(n)):'';
  button.textContent=value||(side==='start'?'Start':'End');
  button.classList.toggle('is-set',!!value);
  const text=`Set loop ${side} to ${timed?'playhead time':'selected measure'+(side==='end'?' (inclusive)':'')}${value?`; currently ${value}`:''}. Hold to clear; ${side==='start'?'[':']'} sets this endpoint.`;
  button.title=text;button.dataset.help=text;button.setAttribute('aria-label',text);
  button.disabled=locked()||loading||!duration();
 }
 $('loop').setAttribute('aria-pressed',String(active));
 $('loop').setAttribute('aria-label',active?'Disable loop; keep endpoints':'Enable loop');
 pitchView.setLoop(selected,active);renderRuler();
}
function editLoop(edit){
 if(locked()||loading||!duration())return;
 const resume=playing,t=presentationPosition();stop();loopState=edit(loopState,t);saveLoop();syncLoop();
 if(resume)void play();
}
function setLoopPoint(side){editLoop((s,t)=>L.mode(s,bars)==='time'?L.timePoint(s,side,t,duration()):L.point(s,side,L.at(bars,t).number));}
function clearLoop(){editLoop(s=>({mode:L.mode(s,bars),start:null,end:null,enabled:false}));}
function toggleLoop(){editLoop(s=>loopRange()?{...s,enabled:!s.enabled}:L.whole(s,bars,duration()));}
$('loopUnit').onclick=()=>editLoop(s=>L.switchMode(s,bars,duration()));
function renderRuler(){
 const row=$('measureRulerRow'),svg=$('measureRuler'),d=duration();row.hidden=!d;
 if(!d){svg.replaceChildren();return;}
 const timed=L.mode(loopState,bars)==='time';row.firstElementChild.textContent=timed?'Time':'Measures';
 svg.setAttribute('aria-label',timed?'Recording time in minutes and seconds':'Recording measure map');
 row.style.minWidth=`${Math.max(100,prefs.stretch)}%`;
 const width=svg.clientWidth||600,ns='http://www.w3.org/2000/svg',frag=document.createDocumentFragment(),x=t=>t/duration()*width;
 svg.setAttribute('viewBox',`0 0 ${width} 24`);
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;frag.append(e);};
 const selected=loopRange();if(selected)add('rect',{x:x(selected.start),y:0,width:x(selected.end-selected.start),height:24,class:'practice-loop-band'+(loopState.enabled?'':' is-disabled')});
 let previous=-Infinity;
 if(timed){
  const step=[1,2,5,10,15,30,60,120,300].find(s=>x(s)>=48)||600;
  for(let t=0;t<d;t+=step){const left=x(t);add('line',{x1:left,x2:left,y1:18,y2:24});if(left+36<width)add('text',{x:left+2,y:13},clock(t));}
 }else for(const b of bars){const left=x(b.start);add('line',{x1:left,x2:left,y1:18,y2:24});if(left-previous>=30&&left+4+String(b.number).length*7<width){add('text',{x:left+2,y:13},b.number);previous=left;}}
 svg.replaceChildren(frag);
}
function status(text='',error=false){$('status').textContent=text;$('status').classList.toggle('error',error);
 $('readerError').textContent=error?text:'';$('readerError').hidden=!error;}
function persist(){if(song)saved[song.id]=[...mix,...(saved[song.id]||[]).filter(s=>!mix.some(v=>v.id===s.id))];try{localStorage.setItem(KEY,JSON.stringify(saved));localStorage.setItem(PREF,JSON.stringify(prefs));}catch{}}
for(const id of ['lyricHarmony','lyricChords'])$(id).onchange=()=>{prefs[id]=$(id).checked;syncLyricDisplay();persist();};
$('concertPitch').checked=prefs.concertPitch!==false;
$('concertPitch').onchange=()=>{prefs.concertPitch=$('concertPitch').checked;persist();transposeLyrics();};
const speed=MeleteDragNumber($('speed'),{values:Array.from({length:31},(_,i)=>(50+i*5)/100),defaultValue:1,clickStep:.05,wrapOnClick:true,pixelsPerStep:8,format:v=>`${Math.round(v*100)}%`,aria:v=>`${Math.round(v*100)}%`});
const transpose=new MeleteInfinitePager($('transpose'),{options:Array.from({length:25},(_,i)=>({value:12-i,label:i===12?'0':`${i<12?'+':''}${12-i}`})),value:0});
const axes=Object.fromEntries(['scale','stretch'].map(id=>[id,MeleteDragNumber($(id),{values:Array.from({length:21},(_,i)=>50+i*10),defaultValue:100,clickStep:10,pixelsPerStep:8,format:v=>`${v}%`,aria:v=>`${v}%`})]));
axes.scale.setValue(prefs.scale,false);axes.stretch.setValue(prefs.stretch,false);
const clickLevel=MeleteDragNumber($('clickLevel'),{values:Array.from({length:21},(_,i)=>i*5),defaultValue:50,clickStep:5,pixelsPerStep:8,format:v=>`${v}%`,aria:v=>`${v}%`});
clickLevel.setValue(prefs.clickLevel,false);
let notePreview=null,notePreviewSerial=0;
async function previewPitch(note){
 const serial=++notePreviewSerial;
 if(notePreview){const {osc,gain}=notePreview;notePreview=null;gain.gain.cancelScheduledValues(ctx.currentTime);gain.gain.setTargetAtTime(0,ctx.currentTime,.003);osc.stop(ctx.currentTime+.018);}
 if(!note)return;
 stop();
 try{await ensureAudio();if(serial!==notePreviewSerial)return;
  const osc=ctx.createOscillator(),gain=ctx.createGain();osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(6),new Float32Array([0,1,.44,.20,.10,.04])));
  osc.frequency.value=440*2**((note.pitch-69)/12);gain.gain.setValueAtTime(0,ctx.currentTime);gain.gain.linearRampToValueAtTime(.09,ctx.currentTime+.005);
  osc.connect(gain).connect(master);osc.onended=()=>{osc.disconnect();gain.disconnect();};osc.start();notePreview={osc,gain};
 }catch(e){setError(e);}
}
const pitchView=new P.View({root:$('harmonyPractice'),viewport:$('harmonyViewport'),stage:$('harmonyStage'),score:$('harmonyScore'),canvas:$('harmonyTrace'),cursor:$('harmonyCursor'),phrases:$('harmonyPhrase'),stats:$('harmonyStats'),seek,preview:previewPitch,canPreview:()=>!locked()&&!loading});
const sampler=new P.Sampler({observe:f=>pitchView.observe(f),wrap:()=>pitchView.begin(playLoopStart),fail:e=>{stopPitch();micCheck.fail(e.message);setError(e);}});
$('harmonySing').checked=prefs.sing;
$('harmonySing').dataset.help='Trace your microphone against your harmony while playing. No microphone monitoring. Record saves audio to the selected track; Sing alone does not.';
$('harmonyStats').dataset.help='Current pass only, excluding gaps between targets. Mean and median absolute error in cents; octaves count as the same pitch class. Tracked is separate from accuracy. Attack times are approximate, so transitions can contribute error.';
async function loadHarmony(selected,token){
 pitchView.setData(null);$('harmonySing').disabled=true;
 try{
  harmonyRequest??=fetch('full-practice-harmonies.json').then(r=>{if(!r.ok)throw Error('Harmony targets unavailable');return r.json();}).catch(e=>{harmonyRequest=null;throw e;});
  const data=(await harmonyRequest).songs?.[selected.id];if(!data||token!==revision)return;
  const lyrics=await lyricsFor(selected);if(token!==revision)return;
  pitchView.setData(data,selected.tracks.find(t=>t.id==='vocals')?.playback?.sha256,lyrics?.performance);
  if(pitchView.notes.length)$('note').textContent=(selected.note||'').replace(' No full-song notation or pitch scoring.','');
  pitchView.settings(prefs.scale,prefs.stretch,shift());pitchView.move(current,false,true);syncLoop();update();
 }catch(e){if(token===revision&&selected.id==='here-comes-the-sun')setError(e);}
}
function pitchTransport(){return {anchor:started,from:current,rate:playRate,end:playEnd,loop:playLoop,loopStart:playLoopStart};}
function presentationPosition(){return playing&&ctx?P.sourceTime(P.outputTime(ctx),pitchTransport()):current;}
function stopPitch(){
 ++singGeneration;
 if(singInput||sampler.input||checkInput?.borrowed)micCheck.close();
 sampler.detach();
 const input=singInput;singInput=null;
 input?.source?.disconnect();input?.stream?.getTracks().forEach(t=>t.stop());
 if(input?.context&&input.context.state!=='closed')void input.context.close().catch(()=>{});
}
async function selectedInput(constraints){
 try{return await I.acquire(navigator.mediaDevices,constraints,{device:prefs.device,explicit:prefs.deviceExplicit,allowOther:catalog?.microphone==='auto',selected:id=>{prefs.device=id;persist();}});}
 finally{void refreshMicrophones().catch(()=>{});}
}
async function preparePitch(borrowed=null){
 if(!prefs.sing||!pitchView.notes.length)return;
 const token=++singGeneration;
 try{
  let input=borrowed;
  if(!input){
   micCheck.close();input={context:new AudioContext({latencyHint:'interactive',sampleRate:48000})};singInput=input;
   await input.context.resume();input.stream=await selectedInput(MeleteMicrophoneCheck.rawAudioConstraints(prefs.device));
   if(token!==singGeneration){input.stream.getTracks().forEach(t=>t.stop());return;}
   MeleteMicrophoneCheck.verifyRawInput(input.stream);input.source=input.context.createMediaStreamSource(input.stream);input.track=input.stream.getAudioTracks()[0];input.track.contentHint='music';
  }
  await sampler.prepare(input,ctx);if(token!==singGeneration)return;
  await micCheck.start();
 }catch(e){if(token===singGeneration){stopPitch();micCheck.fail(e.message);setError(e);}throw e;}
}
$('harmonySing').onchange=async()=>{
 prefs.sing=$('harmonySing').checked;persist();
 if(!prefs.sing){stopPitch();update();return;}
 if(playing){try{const o=recorder.owned;await preparePitch(o?{source:o.source,context:o.context,track:o.stream.getAudioTracks()[0]}:null);
  if(playing&&prefs.sing){pitchView.begin(presentationPosition());sampler.start(pitchTransport());}
 }catch{}update();}
};
$('clearHarmony').onclick=()=>{sampler.channel?.invalidate();pitchView.clear(presentationPosition());};
$('followHarmony').onclick=()=>pitchView.move(presentationPosition(),playing,true);
function update(){
 const ready=buffers.length>0,blocked=loading||busy||finishing,hold=blocked||recording||!!recorder.recovery();
 $('play').disabled=!ready||blocked;$('play').setAttribute('aria-label',playing?'Pause':'Play');$('play').innerHTML=`<i data-lucide="${playing?'pause':'play'}"></i>`;
 const recDisabled=!ready||!libraryReady||blocked||!!recorder.recovery();
 $('record').disabled=recDisabled;$('record').classList.toggle('recording',recording);$('record').innerHTML=`<i data-lucide="${recording?'square':'circle'}"></i><span>${leadIn?'Cancel':recording?'Stop':'Record'}</span>`;
 $('record').title=(leadIn?'Cancel count-in':recording?'Stop recording':'Record '+(activeLane()?.name||T.spec[$('trackKind').value].name))+' (R)';
 $('player').classList.toggle('counting-in',!!leadIn);$('countInBeats').disabled=hold||!ready;
 $('addTrack').disabled=hold||!ready||!libraryReady;$('trackKind').disabled=$('addTrack').disabled;
 $('rewind').disabled=hold||!ready;$('speed').disabled=hold;$('transpose').setAttribute('aria-disabled',String(hold));$('loop').disabled=hold||!ready;$('micDevice').disabled=hold;
 for(const id of ['loopStart','loopEnd','loopUnit'])$(id).disabled=hold||!ready;
 readerControls();
 $('checkMicrophone').disabled=hold;document.querySelectorAll('#songList button').forEach(b=>b.disabled=locked());
 $('referenceRecording').disabled=hold;$('referenceRecording').setAttribute('aria-busy',String(loading));
 for(const button of $('chartBody').querySelectorAll('.sheet-switch'))button.disabled=hold;
 $('harmonySing').disabled=blocked||!ready||!pitchView.notes.length;
 $('harmonyPhrase').disabled=hold||!ready;$('micDevice').disabled=hold||!!singInput;
 for(const id of ['all','reharm','noVocals'])$(id).disabled=loading||!ready;
 $('metronome').disabled=loading||!clickTrack?.times.length||clickTrack.unavailable;$('metronome').setAttribute('aria-pressed',String(prefs.click));$('clickLevel').disabled=loading||!ready;
 $('undoDelete').disabled=hold;$('recovery').hidden=!recorder.recovery();
 syncLyricLock();
 for(const [id,row] of localRows){
  const target=id===targetId,rolling=recording&&target;
  row.classList.toggle('is-target',target);row.classList.toggle('is-recording',rolling);
  const rec=row.querySelector('.lane-record');rec.disabled=recDisabled||(recording&&!target);
  const name=row.querySelector('.track-name');name.disabled=hold;
  rec.title=rolling?(leadIn?'Cancel count-in':'Stop recording'):'Record '+name.value;rec.setAttribute('aria-label',rec.title);
  if(rec.dataset.rolling!==String(rolling)){rec.dataset.rolling=String(rolling);rec.innerHTML=`<i data-lucide="${rolling?'square':'circle'}"></i>`;}
  row.querySelector('.delete-track').disabled=hold;row.querySelector('.clip-gain').disabled=hold||!lanes.find(l=>l.id===id)?.clips.length;row.querySelector('.solo').disabled=loading||!ready;
 }
 icons();
}
function clearLead(cancel=true){const lead=leadIn;leadIn=null;if(cancel)lead?.cue?.cancel();$('count').textContent='';}
function stop(){playToken++;current=position();clearLead();playing=false;playLoop=false;stopPitch();deck?.stop();layerAudio?.stop();clickTrack?.stop();update();drawCursor();}
function volumes(){deck?.mix(audibleStems());persist();document.querySelectorAll('.mixer-stem').forEach((row,i)=>{
 const solo=soloId==='stem:'+mix[i].id;row.classList.toggle('solo-muted',!!soloId&&!solo);
 row.querySelector('.mute').setAttribute('aria-pressed',String(mix[i].on));row.querySelector('.solo').setAttribute('aria-pressed',String(solo));
});}
async function ensureAudio(resume=true){if(!ctx){ctx=new AudioContext({sampleRate:24000});master=ctx.createDynamicsCompressor();master.threshold.value=-1;master.knee.value=0;master.ratio.value=20;master.attack.value=.003;master.release.value=.1;master.connect(ctx.destination);deck=new MeleteFullPracticeAudio.Deck(ctx,master);clickTrack=new MeleteFullPracticeClick.Click(ctx,master);cueGain=ctx.createGain();cueGain.connect(master);layerAudio=new T.Mixer(ctx,master,id=>recorder.wav(id),setError);}if(resume)await ctx.resume();}
async function prepareClick(){if(!clickTrack?.times.length)return;try{await clickTrack.prepare();clickTrack.unavailable=false;}catch(e){clickTrack.unavailable=true;$('clickQuality').textContent='Click unavailable';$('clickQuality').title=e.message;update();}}
async function prepareMix(loop,exclude=null,end=duration(),loopStart=0){
 await deck.prepare(rate(),shift(),false,tuningCents());await prepareClick();
 await layerAudio.prepare(audibleLanes(),{version:sourceVersion(),rate:rate(),shift:shift(),end,loop,loopStart,exclude});
}
function startMix(at,loop,from=current,clickAt=at,clickFrom=from,end=duration(),loopStart=0){
 current=from;started=at;playRate=rate();playEnd=end;playLoop=loop;playLoopStart=loopStart;
 deck.start(at,current,playEnd,audibleStems(),loop,loopStart);clickTrack.mix(prefs.click,clickLevel.value()/100);clickTrack.start(clickAt,clickFrom,playEnd,playRate,loop,loopStart);
 layerAudio.start(at,current,audibleLanes());playing=true;
 pitchView.begin(current);if(prefs.sing)sampler.start(pitchTransport());
}
async function play(){
 if(recording){await finishRecord(false);return;}if(playing){stop();return;}if(loading||busy||finishing||!buffers.length)return;
 pitchView.cancelPreview();
 const token=revision,intent=++playToken;busy=true;update();
 try{const region=activeLoop(),end=region?.end??duration(),start=region?.start??0;
  await ensureAudio();await prepareMix(!!region,null,end,start);await preparePitch();if(token!==revision||intent!==playToken||document.hidden){stopPitch();return;}
  if(current>=end-.01)current=start;const at=ctx.currentTime+.15;startMix(at,!!region,current,at,current,end,start);status(libraryError,!!libraryError);
 }catch(e){stop();if(e.name!=='AbortError')setError(e);}finally{busy=false;update();}
}
function seek(t){if(recording||busy||loading||finishing)return;const resume=playing;stop();current=Math.max(0,Math.min(t,duration()));playEnd=duration();drawCursor();pitchView.move(current,false,true);if(resume)void play();}
function seekBeats(amount){
 if(locked()||loading||!duration()||!clickTrack?.grid)return;
 seek(MeleteFullPracticeClick.stepBeats(clickTrack.grid,position(),amount,duration()));
}
function restoreControls(){speed.setValue(config().rate??1,false);transpose.setValue(C.recordingShift(config(),song));}
function changed(e){if(recording||busy||finishing||!song){if(song)restoreControls();return;}const resume=playing;stop();const cfg=config();
 prefs.songs[song.id]=e?.target.id==='transpose'?{...cfg,shifts:{...cfg.shifts,[song.url]:transpose.value()}}:{...cfg,rate:speed.value()};
 persist();transposeLyrics();pitchView.settings(prefs.scale,prefs.stretch,shift());if(resume)void play();}
$('speed').oninput=changed;$('transpose').oninput=changed;
for(const id of ['scale','stretch'])$(id).oninput=()=>{prefs[id]=axes[id].value();persist();draw();pitchView.settings(prefs.scale,prefs.stretch,shift());};
function waveBed(canvas){const bed=document.createElement('div');bed.className='wave-bed';bed.append(canvas);return bed;}
function sizeWave(row,canvas){row.style.minWidth=`${Math.max(100,prefs.stretch)}%`;canvas.style.height=`${40*prefs.scale/100}px`;}
function drawCursor(){const d=duration(),t=presentationPosition();$('mixer').style.setProperty('--cursor',`${d?t/d*100:0}%`);highlightLyrics(t);pitchView.move(t,playing);}
function drawLane(l,live=false){
 const row=localRows.get(l.id);if(!row)return;
 const canvas=row.querySelector('canvas'),c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
 if(!live)sizeWave(row,canvas);
 c.clearRect(0,0,w,h);c.fillStyle=getComputedStyle(row).getPropertyValue('--lane').trim()||'#4c897d';
 let spans=row.spans||[];const writer=recording&&l.id===targetId&&recorder.owned?.writer;
 if(writer){const clip={...writer.record,frames:writer.frames,envelope:writer.envelope};spans=T.punch(spans,clip,duration());}
 T.wave(c,spans,duration(),w,h);
}
function draw(){
 renderRuler();
 document.querySelectorAll('.mixer-stem').forEach((row,i)=>{
  const canvas=row.querySelector('canvas'),c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,data=peaks[i];sizeWave(row,canvas);
  const guide=row.classList.contains('arrangement-stem');c.clearRect(0,0,w,h);c.fillStyle=guide?'#69a587':'#7795ad';if(data)for(let x=0;x<w;x++){const p=data[x];if(p||!guide)c.fillRect(x,h/2-p*h/2,1,Math.max(1,p*h));}
 });
 lanes.forEach(l=>drawLane(l));drawCursor();
}
function renderSongs(){const groups=new Map();$('songList').replaceChildren();for(const item of catalog.songs){const season=item.season||'Other';if(!groups.has(season)){const group=document.createElement('section'),h=document.createElement('h2');group.className='season-group';group.dataset.season=season.toLowerCase();group.setAttribute('aria-label',season+' songs');h.className='season-heading';h.textContent=season;group.append(h);$('songList').append(group);groups.set(season,group);}const b=document.createElement('button');b.className='song-choice';b.dataset.id=item.id;b.dataset.season=season.toLowerCase();b.classList.toggle('selected',item.id===song?.id);b.classList.toggle('pending',!item.tracks.length);b.setAttribute('aria-pressed',String(item.id===song?.id));b.setAttribute('aria-label',`${item.title} (${season})`);const name=document.createElement('span');name.className='song-name';name.textContent=item.title;b.append(name);b.onclick=()=>void choose(item.id);groups.get(season).append(b);}}
function selectRecording(base,requested){
 const group=catalog.references?.[base.id],alts=group?.alternatives||{},ref=requested??prefs.songs[base.id]?.referenceId;
 const old=prefs.songs[base.id];if(old){const migrated=C.migrateShift(old,base,alts);if(migrated!==old){prefs.songs[base.id]=migrated;persist();}}
 const alt=Object.hasOwn(alts,ref)?alts[ref]:null,select=$('referenceRecording');
 const selected=alt?{id:base.id,title:base.title,...alt,referenceId:ref}:base;
 if(select.dataset.song!==base.id){
  select.replaceChildren();
  if(group){select.add(new Option(group.defaultLabel,'playlist'));
   for(const [value,r] of Object.entries(alts))select.add(new Option(r.label,value));}
  select.dataset.song=base.id;
 }
 select.value=alt?ref:'playlist';$('referenceChoice').hidden=!select.length;
 const url=new URL(location.href);url.hash=base.id;
 if(alt)url.searchParams.set('ref',ref);
 else if(group&&requested==='playlist')url.searchParams.set('ref','playlist');
 else url.searchParams.delete('ref');
 history.replaceState(history.state,'',url);
 return selected;
}
let tabPart=null;
function drawTab(){
 if(!tabPart)return;
 const fingers=prefs.tabFingers!==false;
 $('tabFingers').checked=fingers;
 $('tabFingers').closest('label').hidden=tabPart.hasFingers===false;
 const d=pitchDisplay(lyricChart?.key||tabPart.recordingKeys?.[song.referenceId||'playlist']||tabPart.key);
 $('tabTuning').textContent='Standard tuning · '+tabPart.key+' shapes · '+(d.fret?'Capo '+d.fret:'No capo');
 MeleteFullPracticeTab.render($('tabBody'),tabPart,fingers&&tabPart.hasFingers!==false,name=>C.transposeChord(name,d.tabShift,tabPart.key));
}
$('tabFingers').onchange=()=>{
 if(!tabPart)return;prefs.tabFingers=$('tabFingers').checked;persist();drawTab();
};
function showParts(){
 const box=$('songParts'),parts=catalog.parts?.[song.id]||[];
 tabPart=parts.find(p=>p.kind==='guitar-tab'&&p.sections?.some(s=>s.bars?.length))||null;
 $('tabBody').replaceChildren();$('tabBody').scrollTop=0;
 const pdf=$('tabPdf');pdf.hidden=!tabPart?.href;pdf.removeAttribute('href');if(tabPart?.href)pdf.href=tabPart.href;
 box.replaceChildren();
 for(const part of parts){
  if(part.kind==='guitar-tab'||!part.href)continue;
  const link=document.createElement('a'),icon=document.createElement('i');
  link.href=part.href;link.target='_blank';link.rel='noopener';icon.dataset.lucide='file-text';
  link.append(icon,document.createTextNode(part.label));box.append(link);
 }
 box.hidden=!box.childElementCount;
}
$('referenceRecording').onchange=e=>void choose(song.id,e.target.value);
function showSongbook(id,title){
 const directory=catalog.songbook,page=directory?.pages?.[id],other=directory?.otherSources?.[id];
 const book=$('songbook'),fallback=$('songReference');
 book.hidden=!directory;
 if(directory){
  book.href=page||directory.index;
  book.querySelector('span').textContent=page?'Solstice songbook':'Solstice index';
  book.setAttribute('aria-label',page?'Secular Solstice songbook: '+title:'Secular Solstice song index');
 }else book.removeAttribute('href');
 fallback.hidden=!other;fallback.textContent=other?.label||'';
 if(other){fallback.href=other.url;fallback.setAttribute('aria-label',other.label+': '+title);}
 else {fallback.removeAttribute('href');fallback.removeAttribute('aria-label');}
}
async function choose(id,requested){
 if(locked())return;
 deferredAudio=null;
 const token=++revision;abort?.abort();const controller=abort=new AbortController();
 stop();micCheck.close();current=0;playEnd=0;lanes=[];localRows.clear();targetId=null;soloId=null;
 libraryReady=false;libraryError='';clearTimeout(undoTimer);$('undoDelete').hidden=true;
 buffers=[];peaks=[];deck?.clear();layerAudio?.clear();clickTrack?.setMap(null,0);$('clickQuality').textContent='';
 const selected=song=selectRecording(catalog.songs.find(s=>s.id===id)||catalog.songs[0],requested);
 const mixerTracks=[...song.tracks,...(song.guides||[])];
 mix=mixerTracks.map(t=>{const old=saved[song.id]?.find(m=>m.id===t.id);return{id:t.id,on:old?.on??true,level:Number.isFinite(old?.level)?Math.min(2,Math.max(0,old.level)):1};});
 if(catalog.references?.[song.id]){prefs.songs[song.id]={...config(),referenceId:song.referenceId||'playlist'};persist();}
 $('excerpts').href=(catalog.auditionBase||'./')+'#'+song.id;showParts();document.title=song.title+' - '+(catalog.title||'Solstice practice');
 const source=$('source');source.href=song.url;source.hidden=!song.url;source.setAttribute('aria-label','Open recording source');
 showSongbook(song.id,song.title);
 source.classList.toggle('youtube',/^(?:https?:\/\/)(?:www\.)?(?:youtube\.com|youtu\.be)\//.test(song.url));
 $('note').textContent=song.note||'';$('stems').replaceChildren();$('layers').replaceChildren();
 restoreControls();renderSongs();loading=true;status('Loading '+($('referenceRecording').selectedOptions[0]?.text||song.title)+'…');update();const library=loadTracks();
 bars=[];loopState={};pitchView.setMeasures([]);syncLoop();
 void showLyrics(song,token);resetChart(song,token);
 void loadHarmony(song,token);
 if(!song.tracks.length){loading=false;status('No intended full recording found yet.');update();await library;return;}
 // A musician browsing charts need not download six stems on every swipe through the songs.
 if(reader.open){deferredAudio=loadChosenAudio;loading=false;status();update();return;}
 return loadChosenAudio();
 async function loadChosenAudio(){
 if(token!==revision)return;loading=true;update();
 try{await ensureAudio(false);if(token!==revision)return;
 const [entry,beatMap]=await Promise.all([
  audioLoader.load({...selected,tracks:mixerTracks},ctx,{signal:controller.signal,onProgress:(n,cached)=>{if(token===revision&&!cached)status(`Loading ${n}/${mixerTracks.length}…`);}}),
  selected.referenceId?referenceCues(selected).then(c=>c.beats):beatCatalog.songs?.[selected.id],
 ]);
 if(token!==revision)return;buffers=entry.buffers;peaks=entry.peaks;playEnd=duration();deck.setBuffers(buffers,mixerTracks.map(t=>t.id),mixerTracks.filter(t=>t.concertPitch).map(t=>t.id));const version=sourceVersion(),matchedMap=beatMap?.sourceVersion===version?beatMap:null;
 clickTrack.setMap(matchedMap,duration());bars=L.measures(matchedMap,duration());pitchView.setMeasures(bars,clickTrack.grid.times);
 const stored=song.referenceId?(config().referenceLoops?.[song.referenceId]??(config().loop?.sourceVersion===version?config().loop:null)):config().loop;
 loopState=L.restore(stored,bars,duration(),version)||(!stored&&prefs.loop?L.whole({},bars,duration()):{});
 if(activeLoop())current=activeLoop().start;
 syncLoop();pitchView.move(current,false,true);
 $('clickQuality').textContent=clickTrack.grid.aligned?(beatMap.label||'Estimated recording pulse'):'100 BPM guide (unaligned)';$('clickQuality').title=clickTrack.grid.aligned?beatMap.notes||'':'No matching beat map for this recording.';
 mixerTracks.forEach((t,i)=>{const row=document.createElement('div');row.className='mixer-stem '+(t.audioUrl?'arrangement-stem':'full-stem');const controls=document.createElement('div');controls.className='track-controls';const mute=document.createElement('button');mute.className='mute';mute.innerHTML='<i data-lucide="volume-2"></i>';const label=document.createElement('span');label.textContent=t.label;mute.append(label);mute.onclick=()=>{mix[i].on=!mix[i].on;volumes();};const level=document.createElement('button');level.className='track-level';level.setAttribute('aria-label',t.label+' volume');const number=MeleteDragNumber(level,{values:Array.from({length:41},(_,i)=>i*5),defaultValue:100,clickStep:10,pixelsPerStep:5,format:v=>`${v}%`,aria:v=>`${v}%`,onHold:()=>{soloStem(i);}});number.setValue(mix[i].level*100,false);level.oninput=()=>{mix[i].level=number.value()/100;volumes();};const solo=document.createElement('button');solo.className='solo';solo.textContent='S';solo.setAttribute('aria-label','Solo '+t.label);solo.onclick=()=>{soloStem(i);};const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=50;canvas.tabIndex=0;canvas.setAttribute('role','slider');canvas.setAttribute('aria-label',t.label+' position');canvas.setAttribute('aria-valuemin','0');canvas.setAttribute('aria-valuemax',String(duration()));canvas.onclick=e=>{const b=canvas.getBoundingClientRect();seek((e.clientX-b.left)/b.width*duration());};controls.append(mute,level,solo);row.append(controls,waveBed(canvas));$('stems').append(row);});await library;if(token!==revision)return;volumes();renderTracks();draw();status(libraryError,!!libraryError);
 }catch(e){if(token===revision&&e.name!=='AbortError'){status(e.message,true);buffers=[];}}finally{
  if(token===revision){loading=false;update();if(pendingLyric?.token===token&&duration())seek(pendingLyric.t);pendingLyric=null;}
 }
 }
}
const recorder=new MeleteFullPracticeRecording.Recorder({
 mediaDevices:{getUserMedia:selectedInput,enumerateDevices:()=>navigator.mediaDevices.enumerateDevices()},
 onState:state=>queueMicrotask(()=>{if(recording&&!finishing&&['saving','idle','recovery'].includes(state))void finishRecord(false);update();}),
 onError:e=>{lastRecordError=e.message;setError(e);}
});
let lastRecordError='';
async function addTrack(){
 const lane=T.createTrack(song.id,$('trackKind').value,lanes),id=song.id;
 await recorder.saveTrack(lane);if(song.id!==id)return null;
 lanes.push(lane);targetId=lane.id;renderTracks();return lane;
}
async function startRecord(id=null){
 if(recording){if(!id||id===targetId)await finishRecord(false);return;}
 if(locked()||loading||!buffers.length||!libraryReady)return;
 pitchView.cancelPreview();
 if(id)targetId=id;
 stop();micCheck.close();busy=true;lastRecordError='';update();const token=revision,intent=playToken;
 try{
  // Resume on the gesture, before IDB and the device prompt.
  await ensureAudio();const lane=activeLane()||await addTrack();if(!lane)return;
  const region=activeLoop(),end=region?.end??duration();
  await prepareMix(false,lane.id,end);if(current>=end-.1)current=region?.start??0;
  const sourcePosition=current,options={songId:song.id,sourceVersion:sourceVersion(),sourcePosition,rate:rate(),shift:shift(),
   trackId:lane.id,trackName:lane.name,instrument:lane.instrument,mix:audibleStems().map(m=>({...m})),deviceId:prefs.device,playbackContext:ctx};
  const prepared=await recorder.prepare(options);if(token!==revision||intent!==playToken||document.hidden){await recorder.cancel();return;}
  if(prefs.sing)await preparePitch(prepared);
  const plan=MeleteFullPracticeClick.countPlan(clickTrack.grid,sourcePosition,rate(),prefs.countInBeats);
  const leadAt=ctx.currentTime+.2,punchAt=leadAt+plan.duration,from=Math.max(0,plan.from);
  const maxSeconds=(end-sourcePosition)/rate()+prepared.latency;
  recorder.startAt({playbackAt:punchAt,sourcePosition,maxSeconds,pickupSeconds:Math.min(.18,plan.duration)});
  recordEndAt=punchAt+maxSeconds;
  // Cue, stems, previous tracks, and punch are scheduled once on the same clock.
  // Before source zero there is only a count; at an interior punch the preceding music plays too.
  startMix(leadAt+(from-plan.from)/rate(),false,from,punchAt,sourcePosition,end);
  if(plan.beats.length){
   const lead={target:sourcePosition,punchAt};leadIn=lead;cueGain.gain.value=2*clickLevel.value()/100;
   const total=plan.beats.length;$('count').textContent='Count-in';
   lead.cue=new MeleteRecording.CountIn(ctx,cueGain,plan,b=>{if(leadIn===lead)$('count').textContent=b.label+' / '+total;},globalThis,leadAt);
   void lead.cue.done.then(ok=>{
    if(leadIn!==lead)return;if(!ok){void finishRecord(false);return;}
    clearLead(false);status('Recording '+lane.name);update();
   });
  }
  recording=true;status(leadIn?'Count-in: '+lane.name:'Recording '+lane.name);
  void refreshMicrophones().catch(()=>{});
 }catch(e){stop();await recorder.cancel();if(e.name!=='AbortError')setError(e);}finally{busy=false;update();}
}
async function finishRecord(complete){
 if(!recording||finishing)return;finishing=true;
 const cancel=leadIn&&ctx.currentTime<leadIn.punchAt?leadIn:null;stop();
 if(cancel){current=cancel.target;drawCursor();}
 try{await recorder.stop({complete,cancelLead:!!cancel});status(lastRecordError,!!lastRecordError);}
 catch(e){setError(e);}finally{
  recording=false;layerAudio.forget(targetId);await loadTracks();finishing=false;update();
 }
}
async function loadTracks(){
 if(!song)return;const id=song.id,epoch=++loadEpoch;
 try{
  const rows=await recorder.load(id);if(epoch!==loadEpoch||id!==song.id)return;
  lanes=T.collect(rows);libraryReady=true;libraryError='';
  if(!activeLane())targetId=null;if(soloId&&!soloId.startsWith('stem:')&&!lanes.some(l=>l.id===soloId)){soloId=null;volumes();}
  const until=Math.max(0,...rows.map(t=>t.deleteAfter||0));clearTimeout(undoTimer);$('undoDelete').hidden=until<=Date.now();
  if(until>Date.now())undoTimer=setTimeout(()=>{$('undoDelete').hidden=true;void recorder.store.purgeDeleted(id).catch(setError);},until-Date.now()+5);
  renderTracks();
  // Old takes have no envelope. Read them one at a time without acquiring an input or blocking the transport.
  void (async()=>{for(const l of lanes)for(const c of l.clips){if(epoch!==loadEpoch||song.id!==id)return;
   if(!c.envelope){c.envelope=await recorder.readEnvelope(c);if(epoch===loadEpoch)drawLane(l);}
  }})().catch(e=>{if(epoch===loadEpoch)setError(e);});
 }catch(e){if(epoch===loadEpoch){libraryReady=false;libraryError='Local tracks unavailable: '+e.message;status(libraryError,true);}}
 update();
}
function saveLane(l,patch){
 const before=Object.fromEntries(Object.keys(patch).map(k=>[k,l[k]]));Object.assign(l,patch);pendingTrackEdits++;
 return recorder.saveTrack(l,patch).then(()=>true,error=>{
  for(const key of Object.keys(patch))if(l[key]===patch[key])l[key]=before[key];
  if(lanes.includes(l))renderTracks();setError(error);return false;
 }).finally(()=>{pendingTrackEdits--;});
}
function soloStem(i){
 toggleSolo('stem:'+mix[i].id);
}
function soloLane(id){
 toggleSolo(id);
}
function toggleSolo(id){soloId=soloId===id?null:id;volumes();updateLaneMix();}
function updateLaneMix(){
 for(const l of lanes){const r=localRows.get(l.id);if(!r)continue;r.classList.toggle('solo-muted',!!soloId&&soloId!==l.id);
  r.querySelector('.mute').setAttribute('aria-pressed',String(l.on));r.querySelector('.solo').setAttribute('aria-pressed',String(soloId===l.id));}
 layerAudio?.mix(audibleLanes());
}
function iconButton(cls,icon,title,fn){
 const b=document.createElement('button');b.type='button';b.className=cls;b.title=title;b.setAttribute('aria-label',title);
 b.innerHTML=`<i data-lucide="${icon}"></i>`;b.onclick=()=>{void Promise.resolve(fn()).catch(setError);};return b;
}
function selectTarget(l){if(!locked()){targetId=l.id;update();}}
function renderTracks(){
 $('layers').replaceChildren();localRows.clear();
 for(const l of lanes){
  const row=document.createElement('div');row.className='local-track';row.dataset.id=l.id;row.dataset.kind=l.instrument;
  row.setAttribute('role','group');row.setAttribute('aria-label',l.name+' track');localRows.set(l.id,row);
  const controls=document.createElement('div');controls.className='local-controls';
  const hear=iconButton('mute',T.spec[l.instrument]?.icon||'audio-lines','Hear '+l.name,()=>{saveLane(l,{on:!l.on});updateLaneMix();});hear.setAttribute('aria-pressed',String(l.on));
  const name=document.createElement('input');name.className='track-name';name.value=l.name;name.maxLength=48;name.setAttribute('aria-label','Track name');name.title='Rename or select track';
  name.onfocus=()=>selectTarget(l);name.onchange=async()=>{
   const val=name.value.trim();if(!val||val===l.name){name.value=l.name;return;}
   if(!await saveLane(l,{name:val})||l.name!==val||!row.isConnected)return;
   name.value=val;row.setAttribute('aria-label',val+' track');
   for(const [button,label] of [[hear,'Hear '+val],[solo,'Solo '+val],[dl,'Download '+val+' recording'],[trim,'Adjust '+val+' clip gain'],[del,'Delete '+val+' track']]){
    button.title=label;button.setAttribute('aria-label',label);
   }
   level.setAttribute('aria-label',val+' volume');canvas.setAttribute('aria-label',val+' position');update();
  };
  name.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();name.blur();}else if(e.key==='Escape'){name.value=l.name;name.blur();}};
  const level=document.createElement('button');level.className='track-level';level.setAttribute('aria-label',l.name+' volume');
  const num=MeleteDragNumber(level,{values:Array.from({length:41},(_,i)=>i*5),defaultValue:100,clickStep:10,pixelsPerStep:5,format:v=>v+'%',aria:v=>v+'%',onHold:()=>soloLane(l.id)});
  num.setValue(l.level*100,false);level.oninput=()=>{saveLane(l,{level:num.value()/100});updateLaneMix();};
  const actions=document.createElement('div');actions.className='track-actions';
  const rec=iconButton('lane-record','circle','Record '+l.name,()=>startRecord(l.id));
  rec.dataset.help='Count in, then record from the cursor. A new pass replaces only the overlapping audio on this track.';
  const solo=iconButton('solo','headphones','Solo '+l.name,()=>soloLane(l.id));solo.textContent='S';
  const dl=iconButton('download-track','download','Download '+l.name+' recording',()=>downloadLane(l));dl.disabled=!l.clips.length;
  const trim=iconButton('clip-gain','sliders-horizontal','Adjust '+l.name+' clip gain',()=>openClips(l,true));
  trim.dataset.help='Set playback gain for one saved take. Its original WAV is unchanged.';
  const del=iconButton('delete-track','trash-2','Delete '+l.name+' track',async()=>{
   if(locked())return;if(playing)stop();busy=true;update();
   try{await recorder.deleteTrack(song.id,l.id);layerAudio.forget(l.id);await loadTracks();}finally{busy=false;update();}
  });
  actions.append(rec,solo,trim,dl,del);controls.append(hear,name,level,actions);
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=50;canvas.tabIndex=0;canvas.setAttribute('role','slider');
  canvas.setAttribute('aria-label',l.name+' position');canvas.setAttribute('aria-valuemin','0');canvas.setAttribute('aria-valuemax',String(duration()));
  canvas.onclick=e=>{if(locked())return;selectTarget(l);const b=canvas.getBoundingClientRect();seek((e.clientX-b.left)/b.width*duration());};
  row.spans=T.segments(l,sourceVersion(),duration());
  const older=l.clips.some(c=>c.sourceVersion!==sourceVersion());
  if(older){const warn=document.createElement('span');warn.className='clip-warning';warn.textContent='Other source';warn.title='Clips made with a different recording stay available to download. Switch back to their recording to play them in sync.';actions.insertBefore(warn,del);}
  row.append(controls,waveBed(canvas));$('layers').append(row);drawLane(l);
 }
 updateLaneMix();update();
}
function downloadClip(l,c){return recorder.wav(c.id).then(w=>download(w,`${l.song}-${l.name.replace(/[^\w-]+/g,'-')}-${c.number||c.createdAt}.wav`));}
function downloadLane(l){
 if(l.clips.length===1)return downloadClip(l,l.clips[0]);
 openClips(l,false);
}
function openClips(l,editing){
 if(!l.clips.length||editing&&locked())return;
 if(editing&&playing)stop();
 downloadSelection=l;
 const refs=catalog.references?.[song.id],base=catalog.songs.find(s=>s.id===song.id);
 const versions=new Map([[base.tracks.map(t=>t.sha256||t.file).join(':'),refs?.defaultLabel||'']]);
 for(const r of Object.values(refs?.alternatives||{}))versions.set(r.tracks.map(t=>t.sha256||t.file).join(':'),r.label);
 $('clipFile').replaceChildren(...l.clips.map(c=>{
  const label=versions.get(c.sourceVersion)??'Other source';
  return new Option(`#${c.number} · ${clock(c.sourcePosition)} · ${clock(c.frames/c.sampleRate)}${label?' · '+label:''}`,c.id);
 }));
 $('clipFile').value=(l.clips.findLast(c=>c.sourceVersion===sourceVersion())||l.clips.at(-1)).id;
 $('clipDialogLabel').textContent=editing?'Recording to adjust':'Original recording';
 $('clipGainField').hidden=$('applyClipGain').hidden=!editing;$('rawClipWav').hidden=editing;$('clipGain').disabled=!editing;
 $('clipFile').onchange();$('clipDownload').returnValue='';$('clipDownload').showModal();
}
$('clipFile').onchange=()=>{$('clipGain').value=String(downloadSelection?.clips.find(c=>c.id===$('clipFile').value)?.gainDb??0);};
$('clipDownload').onclose=async()=>{
 const l=downloadSelection,c=l?.clips.find(c=>c.id===$('clipFile').value),action=$('clipDownload').returnValue;downloadSelection=null;
 if(!c)return;
 if(action==='download'){void downloadClip(l,c).catch(setError);return;}
 if(action!=='apply'||locked()||!lanes.includes(l))return;
 const db=$('clipGain').valueAsNumber;busy=true;update();
 try{
  await recorder.setClipGain(c,db);c.gainDb=db;layerAudio?.forget(l.id);drawLane(l);
  status(l.name+' #'+c.number+': '+(db>0?'+':'')+db+' dB');
 }catch(e){setError(e);}finally{busy=false;update();}
};
$('addTrack').onclick=async()=>{if(locked())return;busy=true;update();try{await addTrack();}catch(e){setError(e);}finally{busy=false;update();}};
$('trackKind').onchange=()=>update();
$('countInBeats').onchange=()=>{if(locked())return;prefs.countInBeats=Number($('countInBeats').value);persist();};
$('countInBeats').dataset.help='Preparatory beats before Record. Count-in is audible even when Click is off.';
$('metronome').dataset.help='Keep clicking after the count-in, including during ordinary playback.';
$('undoDelete').onclick=async()=>{if(locked())return;if(playing)stop();busy=true;update();try{await recorder.undo(song.id);await loadTracks();}catch(e){setError(e);}finally{busy=false;update();}};
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
let deviceRead=0;
async function refreshMicrophones(){
 if(!navigator.mediaDevices)return;const request=++deviceRead,ds=await navigator.mediaDevices.enumerateDevices();if(request!==deviceRead)return;
 const allowOther=catalog?.microphone==='auto',preferred=I.preferred(ds,prefs.device,prefs.deviceExplicit,allowOther);
 if(!prefs.deviceExplicit&&preferred?.deviceId)prefs.device=preferred.deviceId;
 const sel=$('micDevice');sel.replaceChildren(new Option(allowOther?'Automatic microphone':'Samson / G-Track (preferred)',''));
 ds.filter(d=>d.kind==='audioinput'&&d.deviceId).forEach((d,i)=>sel.append(new Option(d.label||`Input ${i+1}`,d.deviceId)));
 if(prefs.device&&!Array.from(sel.options).some(o=>o.value===prefs.device))sel.append(new Option('Unavailable input',prefs.device));
 sel.value=prefs.device;
}
navigator.mediaDevices?.addEventListener?.('devicechange',()=>void refreshMicrophones().catch(()=>{}));
function releaseCheck(){const o=checkInput;checkInput=null;if(o?.borrowed)return;o?.source?.disconnect();o?.stream?.getTracks().forEach(t=>t.stop());void o?.context?.close().catch(()=>{});}
async function acquireCheck(){
 const shared=singInput?.source?singInput:recorder.owned?.source?recorder.owned:null;
 if(shared){checkInput={borrowed:true};return{source:shared.source,context:shared.context,track:shared.track||shared.stream.getAudioTracks()[0]};}
 const o={context:new AudioContext()};checkInput=o;await o.context.resume();try{o.stream=await selectedInput(MeleteMicrophoneCheck.rawAudioConstraints(prefs.device));if(checkInput!==o){o.stream.getTracks().forEach(t=>t.stop());throw new DOMException('Canceled','AbortError');}o.source=o.context.createMediaStreamSource(o.stream);await refreshMicrophones();return{source:o.source,context:o.context,track:o.stream.getAudioTracks()[0]};}catch(e){releaseCheck();throw e;}
}
const micCheck=new MeleteMicrophoneCheck.Check({dialog:$('microphoneCheck'),trigger:$('checkMicrophone'),select:$('micDevice'),inline:true,acquire:acquireCheck,release:releaseCheck,refresh:refreshMicrophones,busy:()=>recording||busy||!!singInput,choose:id=>{prefs.device=id;prefs.deviceExplicit=!!id;persist();},failureMessage:e=>e.message});
$('play').onclick=()=>void play();$('record').onclick=()=>void startRecord();$('rewind').onclick=()=>seek(0);$('loop').onclick=toggleLoop;
for(const side of ['start','end'])L.bindPoint($('loop'+(side==='start'?'Start':'End')),()=>setLoopPoint(side),clearLoop);
$('measureRuler').onclick=e=>{const r=e.currentTarget.getBoundingClientRect(),t=(e.clientX-r.left)/r.width*duration();seek(L.mode(loopState,bars)==='time'?t:L.at(bars,t).start);};
new ResizeObserver(renderRuler).observe($('measureRuler'));
function preset(kind){if(loading)return;soloId=null;updateLaneMix();mix.forEach(m=>m.on=kind==='all'||(kind==='reharm'?['vocal','vocals','drums'].includes(m.id):!['vocal','vocals'].includes(m.id)));volumes();}
$('metronome').onclick=()=>{prefs.click=!prefs.click;clickTrack?.mix(prefs.click,clickLevel.value()/100);persist();update();};$('clickLevel').oninput=()=>{prefs.clickLevel=clickLevel.value();clickTrack?.mix(prefs.click,prefs.clickLevel/100);if(cueGain)cueGain.gain.setTargetAtTime(2*prefs.clickLevel/100,ctx.currentTime,.005);persist();};
$('all').onclick=()=>preset('all');$('reharm').onclick=()=>preset('reharm');$('noVocals').onclick=()=>preset('band');
$('fullscreen').onclick=()=>{void(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(e=>status(e.message,true));};
$('record').setAttribute('aria-keyshortcuts','R');$('rewind').setAttribute('aria-keyshortcuts','ArrowUp Home');$('rewind').title='Return to beginning (Up / Home)';
const help={speed:'Change tempo without changing pitch. Click +5%; drag vertically.',transpose:'Change key by semitone; vocals retain formants. Drums retain their pitch.',record:'R: start or stop recording to the selected track. Captures one pass through the selected loop or to the song end. Headphones keep the backing out.',rewind:'Up or Home: return to the beginning.',loop:'Repeat the selected bars or time range. Turning off keeps endpoints. Without a range, selects the whole recording.',scale:'Resize waveform and pitchbar height; lyrics keep their size.',stretch:'Change waveform and pitchbar horizontal scale.',play:'Space/K: play or pause. Left/Right: four estimated beats.',source:'Open the selected full recording source.'};for(const [id,text]of Object.entries(help))$(id).dataset.help=text;MeleteSettingsHelp($('player'),$('settingsHelp'),$('settingsTooltip'));
$('downloadRecovery').onclick=async()=>{const r=recorder.recovery();if(r)download(await recorder.recoveryWav(),`${song.id}-recovery.wav`);};$('retryRecovery').onclick=async()=>{try{await recorder.retry();await loadTracks();update();}catch(e){status(e.message,true);}};
function playbackKey(e){
 const target=e.target,key=e.key.toLowerCase(),choice=target.matches('input[type=checkbox],input[type=radio]');
 if(reader.open){
  if(e.metaKey||e.ctrlKey||e.altKey||e.isComposing||['SELECT','INPUT'].includes(target.tagName))return;
  if(e.key==='['||e.key===']'){e.preventDefault();if(!e.repeat)setLoopPoint(e.key==='['?'start':'end');return;}
  if((key==='k'||(e.code==='Space'&&!target.closest('button')))&&!e.repeat){e.preventDefault();void readerPlayback();}
  return; // Keep dialog buttons and scrolling native; never record behind the chart.
 }
 if(e.defaultPrevented||e.isComposing||e.metaKey||e.ctrlKey||e.altKey||$('clipDownload').open||target.isContentEditable||
  ['TEXTAREA','SELECT'].includes(target.tagName)||(target.tagName==='INPUT'&&!choice))return;
 const consume=()=>{e.preventDefault();e.stopPropagation();};
 if(e.code==='Space'||key==='k'){
  if(choice&&e.code==='Space')return;
  consume();if(!e.repeat)void play();return;
 }
 if(key==='r'){consume();if(!e.repeat&&!$('record').disabled)void startRecord();return;}
 if(e.key==='['||e.key===']'){consume();if(!e.repeat)setLoopPoint(e.key==='['?'start':'end');return;}
 // Deliberately keyboard-focused numeric controls retain their own arrow keys.
 if(target.closest('#transpose,#speed,.track-level,.scale-number,#lyricView'))return;
 if(e.key==='ArrowUp'||e.key==='Home'){consume();if(!e.repeat)seek(0);return;}
 if(e.key==='ArrowLeft'||e.key==='ArrowRight'){consume();seekBeats(e.key==='ArrowLeft'?-4:4);return;}
 if(e.key==='<'||e.key==='>'){
  if(!recording&&!busy&&!finishing){consume();speed.setValue(Math.max(.5,Math.min(2,rate()+(e.key==='<'?-.25:.25))),false);changed();}return;
 }
 const jump={j:-10,l:10}[key];
 if(jump!==undefined){consume();seek(position()+jump);}
 else if(/^[0-9]$/.test(key)){consume();seek(duration()*Number(key)/10);}
 else if(e.key==='End'){consume();seek(duration());}
 else if(key==='f')$('fullscreen').click();
}
document.addEventListener('keydown',playbackKey,true);
document.addEventListener('pointerup',e=>{
 const control=e.target.closest('button,[role=spinbutton]');
 if(control)queueMicrotask(()=>{if(control.contains(document.activeElement))document.activeElement.blur();});
},true);
window.addEventListener('beforeunload',e=>{if(recording||finishing||pendingTrackEdits||recorder.recovery()){e.preventDefault();e.returnValue='';}});document.addEventListener('visibilitychange',()=>{if(document.hidden){stopPitch();micCheck.close();if(recording)void finishRecord(false);else if(recorder.state==='preparing')void recorder.cancel();}});window.addEventListener('pagehide',()=>{revision++;abort?.abort();stop();micCheck.close();});
let frames=0;function tick(){$('time').textContent=`${clock(position())} / ${clock(duration())}`;
 if(reader.open&&!$('readerTransport').hidden&&!$('readerSeek').matches(':active')){
  const t=position();$('readerSeek').value=String(t);$('readerTime').textContent=clock(t);
 }
 if(playing){drawCursor();if(recording&&frames++%6===0&&activeLane())drawLane(activeLane(),true);}if(playing&&!playLoop&&position()>=playEnd){if(recording){if(ctx.currentTime>=recordEndAt)void finishRecord(true);}else stop();}requestAnimationFrame(tick);}tick();
Promise.all([fetch('full-practice.json',{cache:'no-store'}).then(r=>r.json()),fetch('full-practice-beats.json',{cache:'no-store'}).then(r=>r.ok?r.json():{}).catch(()=>({}))]).then(([data,beats])=>{catalog=data;beatCatalog=beats;const id=location.hash.slice(1);void choose(data.songs.some(s=>s.id===id)?id:data.songs[0].id,new URLSearchParams(location.search).get('ref'));}).catch(e=>status(e.message,true));void refreshMicrophones().catch(()=>{});
})();
