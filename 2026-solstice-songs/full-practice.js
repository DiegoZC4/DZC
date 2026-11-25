/* Full-song practice shares the audition UI controls, capture store and DSP modules. */
(function(){
'use strict';
const $=id=>document.getElementById(id),KEY='melete-full-song-mix-v1',PREF=KEY+'-controls';
function setPressed(id,on){$(id).setAttribute('aria-pressed',String(!!on));}
function bindToggle(id,change){$(id).onclick=()=>{const on=$(id).getAttribute('aria-pressed')!=='true';setPressed(id,on);return change(on);};}
let catalog,song,ctx,master,deck,buffers=[],peaks=[],mix=[],current=0,started=0,playing=false,playRate=1,playEnd=0,playLoop=false;
let streamEntry,streamUnlisten,waitingPlay,transportBus,retryAudio,previewDuration=0;
const streamBooks=new Map();
async function waveformIndex(s,signal){
 const key=s.id+'/'+(s.referenceId||'playlist');if(streamBooks.has(key))return streamBooks.get(key);
 try{const book=await MeleteFullPracticeLoader.bounded(signal,6000,async s=>{const r=await fetch('stream-index/'+key+'.json',{signal:s});return r.ok?r.json():null;});
  if(!MeletePracticeStream.match(s,book))return null;streamBooks.set(key,book);return book;
 }catch(e){if(e.name==='AbortError')throw e;return null;}
}
let recordEndAt=0,clickTrack=null,beatCatalog={},rangeCueBook={},leadIn=null,cueGain=null,normalListeningEnd=0;
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
const taylorShapes=()=>song?.id==='auld-lang-syne'&&song.referenceId==='james-taylor';
const shapeFormatter=()=>taylorShapes()&&prefs.concertPitch===false?MeleteFullPracticeVoicings.taylorDisplaySymbol:undefined;
const pitchDisplay=(key,concert=prefs.concertPitch!==false)=>C.pitchDisplay(song.id,key,shift(),concert,config().guitarCapos?.[song.url],song.referenceId);
const voicings=MeleteFullPracticeVoicings.bind({tip:$('chordShapeTip'),enabled:taylorShapes,shapeFor(raw,el){
 const key=el.closest('#chartBody,#leadBody')?.dataset.key||lyricChart?.key||'D',d=pitchDisplay(key,false);
 return {symbol:C.transposeChord(raw,d.shift,key),capo:d.fret};
}});
const lyricFollow=new MeleteFullPracticeLyricFollow.Follower($('lyricBody'),$('lyricReturn'));
const leadFollow=new MeleteFullPracticeLyricFollow.Follower($('leadBody'),$('leadReturn'));
const entrances=MeleteFullPracticeEntrances.bind({body:$('leadBody'),position:()=>position(),fit:()=>MeleteFullPracticeLead.fit($('leadBody'))});
let leadRequest,leadRun=0,readerView='chart';
function displayedChartKey(){
 return lyricView==='lead'?$('leadBody').dataset.key:lyricView==='chart'?$('chartBody').dataset.key:lyricChart?.key;
}
function syncCapo(){
 const key=displayedChartKey(),d=song&&key?pitchDisplay(key):null,keep=$('keepShapes');
 $('capoChoice').hidden=lyricView==='tabs';
 $('capoFret').disabled=keep.disabled=!d;
 capo.setValue(d?.fret??0,false);keep.setAttribute('aria-pressed',String(!!d?.keepShapes));
 const info=d?.keepShapes?'On: transposing moves the capo to keep your guitar shapes.':'Off: transposing changes the guitar chords and leaves the capo in place.';
 keep.dataset.help=keep.title=info+(d?.atLimit?' At the fret limit, chord shapes change instead.':'');
}
function transposeLyrics(){
 voicings.hide();
 if(lyricChart){const d=pitchDisplay(lyricChart.key),format=shapeFormatter();C.transpose($('lyricBody'),d.shift,lyricChart.key,d.label,format);C.transpose($('lyricLegend'),d.shift,lyricChart.key,d.label,format);}
 transposeSheet();transposeLead();syncCapo();if(lyricView==='tabs'&&tabPart)drawTab();
}
function transposeSheet(){const sheet=$('chartBody');if(sheet.dataset.key){const d=pitchDisplay(sheet.dataset.key);C.sheetTranspose(sheet,d.shift,sheet.dataset.key,d.label,shapeFormatter());}}
function transposeLead(){const body=$('leadBody');if(body.dataset.key){const d=pitchDisplay(body.dataset.key);C.sheetTranspose(body,d.shift,body.dataset.key,d.label,shapeFormatter());MeleteFullPracticeLead.fit(body);}}
function syncLyricDisplay(){
 const harmony=prefs.lyricHarmony!==false,chords=prefs.lyricChords!==false;
 setPressed('lyricHarmony',harmony);setPressed('lyricChords',chords);
 const hasRoles=C.hasRoles(lyricChart);
 $('lyricHarmony').hidden=!hasRoles;
 $('lyricDisplay').hidden=!lyricChart;$('lyricLegend').hidden=!lyricChart||(!(harmony&&hasRoles)&&!chords);
 C.display($('lyricSheet'),{harmony,chords});
 const lead=$('leadBody');
 const lyrics=prefs.leadLyrics!==false,numbers=prefs.leadNumbers!==false;
 setPressed('leadCompact',prefs.leadCompact!==false);
 setPressed('leadNumbers',numbers);setPressed('leadLyrics',lyrics);setPressed('leadChords',chords);setPressed('leadHarmony',harmony);
 $('leadChordSize').disabled=!chords;$('leadLyricSize').disabled=!lyrics;$('leadHarmony').disabled=!lyrics;
 $('leadHarmony').hidden=!hasRoles;
 Object.assign(lead.dataset,{harmony:String(harmony),chords:String(chords),lyrics:String(lyrics),numbers:String(numbers)});
 MeleteFullPracticeLead.fit(lead);
}
/* Lyrics / Chord chart view. Charts come from full-practice-charts.json, bound to the recording
   each was checked against; any other recording shows an honest "no chart" state. */
let lyricView=null,sheetRequest=null,sheetRun=0;
const reader=$('chartReader');
const loopHome=document.createComment('practice loop controls');$('loopDock').before(loopHome);
const countHome=document.createComment('count-in controls');$('countInControls').before(countHome);
const edgesHome=document.createComment('arrangement cues');$('vocalEdges').before(edgesHome);
const pitchHome=document.createComment('written chord controls');$('chordPitchControls').before(pitchHome);
const leadDisplayHome=document.createComment('lead sheet display');$('leadDisplay').before(leadDisplayHome);
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
  body.scrollTop=0;transposeSheet();voicings.focusable(body);
 }catch{
  if(run===sheetRun){body.textContent='Chord charts unavailable.';delete body.dataset.for;}
 }finally{if(run===sheetRun){body.removeAttribute('aria-busy');syncCapo();}}
}
async function showLead(selected,token){
 const body=$('leadBody'),run=++leadRun;
 body.dataset.for=sheetKey(selected);body.setAttribute('aria-busy','true');body.textContent='Loading lead sheet…';
 leadRequest??=fetch('full-practice-lead-sheets.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).catch(e=>{leadRequest=null;throw e;});
 try{
  const [book,entry]=await Promise.all([leadRequest,lyricsFor(selected)]);
  if(run!==leadRun||token!==revision)return;
  const sheet=book.version===1&&book.recordings?.[sheetKey(selected)];
  if(!MeleteFullPracticeLead.matches(sheet,selected,entry))throw Error();
  leadFollow.reset(MeleteFullPracticeLead.render(body,sheet,entry,t=>lyricJump(t,token,{preload:!reader.open}),t=>lyricJump(t,token,{preload:false}),prefs.leadCompact!==false));
  entrances.mount(sheet,sheetKey(selected));
  body.setAttribute('aria-label',selected.title+' lead sheet, '+sheet.status);
  transposeLead();voicings.focusable(body);syncCapo();highlightLyrics(position());
 }catch{if(run===leadRun){body.textContent='No matching lead sheet for this recording.';delete body.dataset.for;}}
 finally{if(run===leadRun)body.removeAttribute('aria-busy');}
}
function resetChart(selected,token){
 const body=$('chartBody');sheetRun++;delete body.dataset.for;delete body.dataset.key;body.replaceChildren();body.removeAttribute('aria-busy');
 const params=new URL(location.href).searchParams;
 const lead=$('leadBody');leadRun++;entrances.clear();leadFollow.reset();lead.replaceChildren();delete lead.dataset.for;delete lead.dataset.key;lead.removeAttribute('aria-busy');
 const asked=token===1?(params.get('view')||(params.get('part')==='guitar'?'tabs':params.get('reader')==='1'?'chart':null)):null;
 if(asked)preferredView=asked;
 setLyricView(reader.open?readerView:preferredView||prefs.lyricView||(prefs.tabSongs?.[selected.id]?'tabs':'lead'));
 if(token===1&&params.get('reader')==='1')openReader(false);
}
let preferredView=null;
function viewOptions(){return tabPart?['lead','lyrics','chart','tabs']:['lead','lyrics','chart'];}
function setLyricView(view,remember=false){
 voicings.hide();
 const was=lyricView;lyricView=viewOptions().includes(view)?view:'lyrics';
 const chart=lyricView==='chart',tabs=lyricView==='tabs',lead=lyricView==='lead',name=lead?'Lead sheet':chart?'Chord chart':tabs?'Tabs':'Lyrics';
 $('lyricSheet').dataset.view=lyricView;$('lyricBody').hidden=lyricView!=='lyrics';$('leadBody').hidden=!lead;$('chartBody').hidden=!chart;$('guitarTab').hidden=!tabs;
 $('leadDisplay').hidden=!lead;
 if(was==='lead'&&!lead)leadFollow.update(0,false);
 if(was==='lyrics'&&lyricView!=='lyrics')lyricFollow.update(0,false);
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
 }else if(lead){if(song&&$('leadBody').dataset.for!==sheetKey(song))void showLead(song,revision);else{MeleteFullPracticeLead.fit($('leadBody'));highlightLyrics(position());}}
 else if(tabs)drawTab();else if(was!=='lyrics')highlightLyrics(position());
 syncCapo();
 if(remember){preferredView=prefs.lyricView=lyricView;persist();}
 const url=new URL(location.href);
 url.searchParams.delete('part');url.searchParams.set('view',lyricView);
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
const leadBody=$('leadBody'),refitLead=()=>MeleteFullPracticeLead.fit(leadBody);
let leadPaneWidth=-1;
new ResizeObserver(([entry])=>{
 const width=entry.contentRect.width;if(width===leadPaneWidth)return;
 leadPaneWidth=width;if(width>0)refitLead();
}).observe(leadBody);
document.fonts?.addEventListener('loadingdone',refitLead);
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
 const b=$('readerPlay'),label=waitingPlay?'Cancel buffering':leadIn&&!recording?'Cancel count-in':playing?'Pause recording':'Play recording';
 b.disabled=locked()||loading||(!deferredAudio&&!retryAudio&&!buffers.length);
 b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-busy',String(loading));
 if(b.dataset.playing!==String(playing||!!waitingPlay)){b.dataset.playing=String(playing||!!waitingPlay);b.innerHTML='<i data-lucide="'+(playing||waitingPlay?'pause':'play')+'"></i>';icons();}
 $('readerTransport').hidden=false;$('readerTransport').classList.toggle('count-only',!buffers.length||loading);
 $('readerSeek').max=duration()||1;$('readerSeek').disabled=locked();
}
function openReader(native){
 if(reader.open||!song)return;
 rangeControl.cancel();
 if(native)history.pushState({...history.state,chartReaderEntry:true},'',location.href);
 readerReturnView=lyricView;readerView=lyricView==='lead'?'lead':'chart';setLyricView(readerView);
 $('readerContent').append($(readerView==='lead'?'leadBody':'chartBody'));if(readerView==='lead')$('readerContent').append($('leadReturn'));
 if(readerView==='lead')$('readerContent').before($('leadDisplay'));
 $('readerTransport').append($('loopDock'),$('countInControls'),$('vocalEdges'));$('readerOptions').append($('chordPitchControls'));reader.showModal();readerControls();
 $('readerError').textContent=$('status').classList.contains('error')?$('status').textContent:'';
 $('readerError').hidden=!$('readerError').textContent;
 const url=new URL(location.href);url.searchParams.set('reader','1');history.replaceState(history.state,'',url);
 $('readerClose').focus({preventScroll:true});if(readerView==='lead')refitLead();else C.sheetFit($('chartBody'));
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
 if(token===revision&&reader.open)await play({countIn:true});
}
$('openChartReader').onclick=()=>openReader(true);
function closeReader(){if(reader.open)reader.close();finishReaderClose();}
$('readerClose').onclick=closeReader;
reader.oncancel=e=>{e.preventDefault();closeReader();};
reader.onclose=()=>{if(!reader.open)finishReaderClose();};
function finishReaderClose(){
 if(!$('readerContent').childElementCount)return;
 if(document.fullscreenElement===$('readerPanel'))void document.exitFullscreen().catch(()=>{});
 readerNative=false;if(readerView==='lead')$('lyricBody').after($('leadBody'),$('leadReturn'));else $('lyricSheet').insertBefore($('chartBody'),$('lyricReturn'));
 loopHome.after($('loopDock'));countHome.after($('countInControls'));edgesHome.after($('vocalEdges'));pitchHome.after($('chordPitchControls'));
 leadDisplayHome.after($('leadDisplay'));
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
function lyricJump(t,token,{preload=true}={}){
 if(token!==revision||locked())return;
 if(deferredAudio||loading){
  pendingLyric={token,t};
  if(lyricView==='lead')MeleteFullPracticeLead.markForm($('leadBody'),t);
  if(deferredAudio&&preload)void resumeAudioLoad();
  return;
 }
 if(duration())seek(t);
}
function highlightLyrics(t){
 if(lyricView==='lead'){
  MeleteFullPracticeLead.markForm($('leadBody'),pendingLyric?.token===revision?pendingLyric.t:t);
  leadFollow.update(t,playing,!recording);return;
 }
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
$('jumpLyrics').onclick=()=>{$('lyricSheet').scrollIntoView({block:'start'});$(lyricView==='lead'?'leadBody':lyricView==='chart'?'chartBody':lyricView==='tabs'?'tabBody':'lyricBody').focus({preventScroll:true});};
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
// The old length menu stored Off as zero. Keep that choice on upgrade.
if(typeof prefs.countIn!=='boolean')prefs.countIn=prefs.countInBeats!==0;
delete prefs.countInBeats;
setPressed('countIn',prefs.countIn);
const defaultCount=()=>song?.id==='auld-lang-syne'?2:4;
const beatLabel=n=>n+(n===1?' beat':' beats');
const beatCount=MeleteDragNumber($('countInBeats'),{values:[1,2,3,4,5,6,7,8],defaultValue:defaultCount,clickStep:1,pixelsPerStep:10,format:beatLabel,aria:beatLabel});
const audioLoader=new MeleteFullPracticeLoader.Loader();
const icons=()=>window.lucide?.createIcons(),clock=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const duration=()=>buffers.length?Math.min(...buffers.map(b=>b.duration)):previewDuration;
const config=()=>prefs.songs[song?.id]||{};
const keys=MeleteFullPracticeKeys.bind({route:$('keysRoute'),patch:$('keysPatch'),preview:$('keysPreview'),connect:$('keysConnect'),input:$('keysInput'),message:$('keysStatus'),
 saved:id=>prefs.songs[id]?.keyboardPatch,save:(id,n)=>{prefs.songs[id]={...prefs.songs[id],keyboardPatch:n};persist();}});
const rate=()=>speed.value(),shift=()=>transpose.value();
const position=()=>playing?L.position(Math.min(deck?.job&&!deck.job.finished?deck.job.next:Infinity,current+Math.max(0,ctx.currentTime-started)*playRate),playLoopStart,playEnd,playLoop):current;
const loopRange=()=>L.range(loopState,bars,duration());
const activeLoop=()=>loopState.enabled?loopRange():null;
function edgeSettings(){
 const cues=MeleteFullPracticeAudio.vocalEdges(song);
 if(!cues)return null;
 const saved=config().edges?.[song.url],options=saved?.vocalSha256===cues.vocalSha256?saved:{};
 return {cues,intro:options.muteIntro&&cues.onset>0?cues.onset:null,
  outro:(options.cutOutro??cues.cutOutro)&&cues.basis!=='end'?cues.outro:null};
}
function listeningEnd(region){
 const cut=edgeSettings()?.outro,d=duration();
 if(cut==null)return region?.end??d;
 const whole=!!region&&region.end>=d-.002&&region.start<=(bars[0]?.start??0)+.002;
 const lastDub=audibleLanes().reduce((end,l)=>l.on&&l.level>0?Math.max(end,T.segments(l,sourceVersion(),d).at(-1)?.to??0):end,0);
 return MeleteFullPracticeAudio.listenEnd(d,cut,region,whole,lastDub);
}
function syncEdges(disabled){
 const e=edgeSettings(),el=$('vocalEdges');el.hidden=!e;
 const d=duration(),style=$('mixer').style;
 normalListeningEnd=d?listeningEnd(null):0;
 style.setProperty('--intro-mask',d&&e?.intro!=null?100*e.intro/d+'%':'0%');
 style.setProperty('--outro-mask',d&&e?.outro!=null?100*e.outro/d+'%':'100%');
 if(!e)return;
 const {cues}=e;
 for(const [id,t,exists,included,description] of [
  ['includeIntro',cues.onset,cues.onset>0,e.intro==null,e.intro==null?'Mute the reference band until the first sung syllable.':'Play the reference band before the first sung syllable.'],
  ['includeOutro',cues.outro,cues.basis!=='end',e.outro==null,e.outro==null?'Skip the reference outro, keeping any later overdub.':'Play the full reference outro.']]){
  const b=$(id);b.textContent=(id==='includeIntro'?'Intro ':'Outro ')+clock(t);b.disabled=disabled||!exists;
  setPressed(id,exists&&included);b.dataset.help=b.title=exists?description:(id==='includeIntro'?'Singing starts at the beginning.':'Singing continues to the end.');
 }
}
for(const [button,setting] of [['includeIntro','muteIntro'],['includeOutro','cutOutro']])bindToggle(button,include=>{
 const e=edgeSettings();if(!e||locked()||loading)return;
 const resume=playing;stop();
 const cfg=config(),value={vocalSha256:e.cues.vocalSha256,muteIntro:e.intro!=null,cutOutro:e.outro!=null,[setting]:!include};
 prefs.songs[song.id]={...cfg,edges:{...cfg.edges,[song.url]:value}};persist();update();renderRuler();
 if(resume){const end=listeningEnd(activeLoop());if(current>=end)seek(end,{startPlayback:false});else void play();}
});
function saveLoop(){
 if(song){const c=config(),loop={...loopState,sourceVersion:sourceVersion()};
  if(taylorShapes())loop.barRevision=2;
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
 const e=edgeSettings();if(e){
  for(const at of [e.cues.onset,e.cues.outro])add('line',{x1:x(at),x2:x(at),y1:15,y2:24,class:'vocal-edge'});
 }
 svg.replaceChildren(frag);
}
function status(text='',error=false){$('status').textContent=text;$('status').classList.toggle('error',error);
 $('readerError').textContent=error?text:'';$('readerError').hidden=!error;}
function persist(){if(song)saved[song.id]=[...mix,...(saved[song.id]||[]).filter(s=>!mix.some(v=>v.id===s.id))];try{localStorage.setItem(KEY,JSON.stringify(saved));localStorage.setItem(PREF,JSON.stringify(prefs));}catch{}}
bindToggle('leadCompact',on=>{prefs.leadCompact=on;persist();if(song)void showLead(song,revision);});
for(const [id,key] of Object.entries({lyricHarmony:'lyricHarmony',lyricChords:'lyricChords',leadNumbers:'leadNumbers',leadChords:'lyricChords',leadLyrics:'leadLyrics',leadHarmony:'lyricHarmony'}))
 bindToggle(id,on=>{prefs[key]=on;syncLyricDisplay();persist();});
for(const [id,css,initial] of [['leadChordSize','--lead-chord-size',16],['leadLyricSize','--lead-lyric-size',13]]){
 const number=MeleteDragNumber($(id),{values:Array.from({length:31},(_,i)=>10+i),defaultValue:initial,clickStep:1,pixelsPerStep:6,format:v=>v+' px',aria:v=>v+' pixels'});
 number.setValue(Number(prefs[id])||initial,false);
 const apply=()=>leadBody.style.setProperty(css,number.value()+'px');
 apply();$(id).oninput=()=>{apply();prefs[id]=number.value();refitLead();persist();};
}
setPressed('concertPitch',prefs.concertPitch!==false);
bindToggle('concertPitch',on=>{prefs.concertPitch=on;persist();transposeLyrics();});
const capo=MeleteDragNumber($('capoFret'),{values:Array.from({length:12},(_,i)=>i),clickStep:1,pixelsPerStep:12,format:String,
 defaultValue:()=>song&&displayedChartKey()?C.pitchDisplay(song.id,displayedChartKey(),shift(),true,undefined,song.referenceId).fret:0,aria:v=>v?'Fret '+v:'No capo'});
function saveCapo(fret,keepShapes){
 const cfg=config();
 prefs.songs[song.id]={...cfg,guitarCapos:{...cfg.guitarCapos,[song.url]:{fret,atShift:shift(),keepShapes}}};
}
$('capoFret').oninput=()=>{
 const key=displayedChartKey();if(!song||!key)return;
 saveCapo(capo.value(),pitchDisplay(key).keepShapes);
 prefs.concertPitch=false;setPressed('concertPitch',false);persist();transposeLyrics();
};
$('keepShapes').onclick=()=>{
 const key=displayedChartKey();if(!song||!key)return;
 const d=pitchDisplay(key);saveCapo(d.fret,!d.keepShapes);persist();syncCapo();
};
const speed=MeleteDragNumber($('speed'),{values:Array.from({length:31},(_,i)=>(50+i*5)/100),defaultValue:1,clickStep:.05,wrapOnClick:true,pixelsPerStep:8,format:v=>`${Math.round(v*100)}%`,aria:v=>`${Math.round(v*100)}%`});
const transpose=new MeleteInfinitePager($('transpose'),{options:Array.from({length:25},(_,i)=>({value:12-i,label:i===12?'0':`${i<12?'+':''}${12-i}`})),value:0});
const axes=Object.fromEntries(['scale','stretch'].map(id=>[id,MeleteDragNumber($(id),{values:Array.from({length:21},(_,i)=>50+i*10),defaultValue:100,clickStep:10,pixelsPerStep:8,format:v=>`${v}%`,aria:v=>`${v}%`})]));
axes.scale.setValue(prefs.scale,false);axes.stretch.setValue(prefs.stretch,false);
const clickLevel=MeleteDragNumber($('clickLevel'),{values:Array.from({length:21},(_,i)=>i*5),defaultValue:50,clickStep:5,pixelsPerStep:8,format:v=>`${v}%`,aria:v=>`${v}%`});
clickLevel.setValue(prefs.clickLevel,false);
let notePreview=null,notePreviewSerial=0;
const rangeControl=MeleteFullPracticeRange.bind($('soloRange'),{
 transposeChord:C.transposeChord,openAudio:async()=>{await ensureAudio();return {ctx,output:master};},onError:setError,playFromCue
});
async function previewPitch(note){
 const serial=++notePreviewSerial;
 notePreview?.stop();notePreview=null;
 if(!note)return;
 rangeControl.cancel();stop();
 try{await ensureAudio();if(serial!==notePreviewSerial)return;
  notePreview=MeleteFullPracticeRange.tone(ctx,master,note.pitch);
 }catch(e){setError(e);}
}
const pitchView=new P.View({root:$('harmonyPractice'),viewport:$('harmonyViewport'),stage:$('harmonyStage'),score:$('harmonyScore'),canvas:$('harmonyTrace'),cursor:$('harmonyCursor'),phrases:$('harmonyPhrase'),stats:$('harmonyStats'),seek,preview:previewPitch,canPreview:()=>!locked()&&!loading});
const sampler=new P.Sampler({observe:f=>pitchView.observe(f),wrap:()=>pitchView.begin(playLoopStart),fail:e=>{stopPitch();micCheck.fail(e.message);setError(e);}});
setPressed('harmonySing',prefs.sing);
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
   await input.context.resume();if(token!==singGeneration)return;input.stream=await selectedInput(MeleteMicrophoneCheck.rawAudioConstraints(prefs.device));
   if(token!==singGeneration){input.stream.getTracks().forEach(t=>t.stop());return;}
   MeleteMicrophoneCheck.verifyRawInput(input.stream);input.source=input.context.createMediaStreamSource(input.stream);input.track=input.stream.getAudioTracks()[0];input.track.contentHint='music';
  }
  await sampler.prepare(input,ctx);if(token!==singGeneration)return;
  await micCheck.start();
 }catch(e){if(token===singGeneration){stopPitch();micCheck.fail(e.message);setError(e);}throw e;}
}
bindToggle('harmonySing',async on=>{
 prefs.sing=on;persist();
 if(!prefs.sing){stopPitch();update();return;}
 if(playing){try{const o=recorder.owned;await preparePitch(o?{source:o.source,context:o.context,track:o.stream.getAudioTracks()[0]}:null);
  if(playing&&prefs.sing){pitchView.begin(presentationPosition());sampler.start(pitchTransport());}
 }catch{}update();}
});
$('clearHarmony').onclick=()=>{sampler.channel?.invalidate();pitchView.clear(presentationPosition());};
$('followHarmony').onclick=()=>pitchView.move(presentationPosition(),playing,true);
function update(){
 const ready=buffers.length>0,blocked=loading||busy||finishing,hold=blocked||recording||!!recorder.recovery();
 syncEdges(hold||!ready);
 rangeControl.setDisabled(locked(),loading||!ready);
 $('play').disabled=(!ready&&!retryAudio)||blocked;$('play').setAttribute('aria-label',waitingPlay?'Cancel buffering':leadIn&&!recording?'Cancel count-in':playing?'Pause':retryAudio?'Retry playback':'Play');$('play').innerHTML=`<i data-lucide="${playing||waitingPlay?'pause':'play'}"></i>`;
 const recDisabled=!ready||!libraryReady||blocked||!!recorder.recovery()||!recordBuffered();
 $('record').disabled=recDisabled;$('record').classList.toggle('recording',recording);$('record').innerHTML=`<i data-lucide="${recording?'square':'circle'}"></i><span>${recording?(leadIn?'Cancel':'Stop'):'Record'}</span>`;
 $('record').title=(recording?(leadIn?'Cancel count-in':'Stop recording'):'Record '+(activeLane()?.name||T.spec[$('trackKind').value].name))+' (R)';
 if(!recordBuffered())$('record').title='Buffering the backing for an uninterrupted recording';
 $('player').classList.toggle('counting-in',!!leadIn);$('countIn').disabled=busy||recording||finishing||!!leadIn;$('countInBeats').disabled=$('countIn').disabled||!prefs.countIn;
 $('countIn').title=(prefs.countIn?'Disable':'Enable')+' preparatory beats before Play and Record';
 $('addTrack').disabled=hold||!ready||!libraryReady;$('trackKind').disabled=$('addTrack').disabled;
 $('rewind').disabled=hold||!ready;$('speed').disabled=hold;$('transpose').setAttribute('aria-disabled',String(hold));$('loop').disabled=hold||!ready;$('micDevice').disabled=hold;
 for(const id of ['loopStart','loopEnd','loopUnit'])$(id).disabled=hold||!ready;
 readerControls();
 $('checkMicrophone').disabled=hold;document.querySelectorAll('#songList button').forEach(b=>b.disabled=locked());
 $('referenceRecording').disabled=locked();$('referenceRecording').setAttribute('aria-busy',String(loading));
 for(const button of $('chartBody').querySelectorAll('.sheet-switch'))button.disabled=locked();
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
function recordBuffered(){return !streamEntry||streamEntry.complete||streamEntry.available/streamEntry.rate>=(activeLoop()?.end??duration())+.5;}
function stop(){playToken++;if(waitingPlay){waitingPlay.abort();waitingPlay=null;status(libraryError,!!libraryError);}current=leadIn&&ctx.currentTime<leadIn.punchAt?leadIn.target:position();clearLead();playing=false;playLoop=false;stopPitch();deck?.stop();layerAudio?.stop();clickTrack?.stop();update();drawCursor();}
function volumes(){deck?.mix(audibleStems());persist();document.querySelectorAll('.mixer-stem').forEach((row,i)=>{
 row.classList.toggle('reference-band',!['vocals','vocal'].includes(mix[i].id));
 const solo=soloId==='stem:'+mix[i].id;row.classList.toggle('solo-muted',!!soloId&&!solo);
 row.querySelector('.mute').setAttribute('aria-pressed',String(mix[i].on));row.querySelector('.solo').setAttribute('aria-pressed',String(solo));
});}
async function ensureAudio(resume=true){if(!ctx){ctx=new AudioContext({sampleRate:24000});master=ctx.createDynamicsCompressor();master.threshold.value=-1;master.knee.value=0;master.ratio.value=20;master.attack.value=.003;master.release.value=.1;master.connect(ctx.destination);
 transportBus=ctx.createGain();transportBus.connect(master);deck=new MeleteFullPracticeAudio.Deck(ctx,transportBus);
 deck.onHorizon=when=>{const g=transportBus.gain,now=ctx.currentTime;g.cancelScheduledValues(now);g.setValueAtTime(1,now);if(Number.isFinite(when))g.setValueAtTime(0,Math.max(now,when));};
 deck.onStarve=t=>{if(!playing)return;const bypassLoop=!playLoop;stop();current=t;drawCursor();void play({bypassLoop});};
 deck.onStreamError=e=>{stop();setError(e);};
 clickTrack=new MeleteFullPracticeClick.Click(ctx,transportBus);cueGain=ctx.createGain();cueGain.connect(transportBus);layerAudio=new T.Mixer(ctx,transportBus,id=>recorder.wav(id),setError);}if(resume)await ctx.resume();}
async function prepareClick(){if(!clickTrack?.times.length)return;try{await clickTrack.prepare();clickTrack.unavailable=false;}catch(e){clickTrack.unavailable=true;$('clickQuality').textContent='Click unavailable';$('clickQuality').title=e.message;update();}}
async function prepareMix(loop,exclude=null,end=duration(),loopStart=0){
 await deck.prepare(rate(),shift(),false,tuningCents());await prepareClick();
 await layerAudio.prepare(audibleLanes(),{version:sourceVersion(),rate:rate(),shift:shift(),end,loop,loopStart,exclude});
}
function startMix(at,loop,from=current,clickAt=at,clickFrom=from,end=duration(),loopStart=0){
 current=from;started=at;playRate=rate();playEnd=end;playLoop=loop;playLoopStart=loopStart;
 deck.start(at,current,playEnd,audibleStems(),loop,loopStart,edgeSettings());clickTrack.mix(prefs.click,clickLevel.value()/100);clickTrack.start(clickAt,clickFrom,playEnd,playRate,loop,loopStart);
 layerAudio.start(at,current,audibleLanes());playing=true;
 pitchView.begin(current);if(prefs.sing)sampler.start(pitchTransport());
}
function entryTiming(target,countIn,lookahead){
 const plan=MeleteFullPracticeClick.countPlan(clickTrack.grid,target,rate(),countIn&&prefs.countIn?beatCount.value():0);
 const leadAt=ctx.currentTime+lookahead,from=Math.max(0,plan.from);
 return {target,plan,leadAt,from,mixAt:leadAt+(from-plan.from)/rate(),punchAt:leadAt+plan.duration};
}
function startWithEntry(entry,loop,end,loopStart=0){
 const {target,plan,leadAt,from,mixAt,punchAt}=entry;
 // Only the first pass has prep beats. The regular click starts at the target;
 // the stems can already be playing when counting into an interior measure.
 startMix(mixAt,loop,from,punchAt,target,end,loopStart);
 if(!plan.beats.length)return;
 const lead={target,punchAt};leadIn=lead;cueGain.gain.value=2*clickLevel.value()/100;
 $('count').textContent='Count-in';
 lead.cue=new MeleteRecording.CountIn(ctx,cueGain,plan,b=>{if(leadIn===lead)$('count').textContent=b.label+' / '+plan.beats.length;},globalThis,leadAt);
 void lead.cue.done.then(ok=>{
  if(leadIn!==lead)return;
  if(!ok){if(recording)void finishRecord(false);else stop();return;}
  clearLead(false);if(recording)status('Recording '+activeLane().name);update();
 });
}
// Only deliberate transport starts request a count. Seeks and mix/speed edits resume directly.
async function play({bypassLoop=false,countIn=false}={}){
 if(!catalog){if(!booting){const resumed=ensureAudio();await Promise.all([resumed,boot()]).catch(setError);if(song&&!loading&&buffers.length)await play({bypassLoop,countIn});}return;}
 if(recording){await finishRecord(false);return;}if(playing||waitingPlay){stop();return;}if(loading||busy||finishing)return;
 if(retryAudio){const token=revision,reload=retryAudio;try{await Promise.all([ensureAudio(),reload()]);}catch(e){if(token===revision)setError(e);return;}if(token!==revision||retryAudio)return;}
 if(!buffers.length)return;
 pitchView.cancelPreview();
 const token=revision,intent=++playToken,pending=waitingPlay=new AbortController();let ownsBusy=false;update();
 try{const region=bypassLoop?null:activeLoop(),end=listeningEnd(region),start=region?.start??0;
  await ensureAudio();
  const need=Math.min(duration(),Math.min(end,(current>=end-.01?start:current)+1.25)+.5);
  if(streamEntry&&!streamEntry.complete&&streamEntry.available/streamEntry.rate<need){
   status('Buffering audio…');await streamEntry.wait(need,pending.signal);
  }
  if(pending.signal.aborted||token!==revision||intent!==playToken)return;
  waitingPlay=null;ownsBusy=busy=true;update();await prepareMix(!!region,null,end,start);if(token!==revision||intent!==playToken||document.hidden)return;
  if(current>=end-.01)current=start;
  startWithEntry(entryTiming(current,countIn,.15),!!region,end,start);status(libraryError,!!libraryError);
  // Listening must not wait for a microphone permission prompt or a missing input.
  if(prefs.sing&&pitchView.notes.length)void preparePitch().then(()=>{
   if(intent===playToken&&playing&&prefs.sing&&sampler.input)sampler.start(pitchTransport());
  }).catch(()=>{}); // preparePitch reports the input error, without stopping playback.
 }catch(e){if(token===revision&&intent===playToken){stop();if(e.name!=='AbortError')status(e.message+(retryAudio?' Press Play to retry.':''),true);}}finally{if(waitingPlay===pending)waitingPlay=null;if(token===revision){if(ownsBusy)busy=false;update();}}
}
function seek(t,{startPlayback=playing||!!waitingPlay,bypassLoop=false}={}){if(recording||busy||loading||finishing)return;stop();current=Math.max(0,Math.min(t,duration()));playEnd=duration();drawCursor();pitchView.move(current,false,true);if(startPlayback)void play({bypassLoop});}
function playFromCue(seconds){
 if(locked()||loading||!duration())return;
 const region=activeLoop(),inside=region&&seconds>=region.start&&seconds<region.end;
 // Audition outside the practice loop without changing either saved endpoint.
 seek(Math.max(inside?region.start:0,seconds-1.25),{startPlayback:true,bypassLoop:!!region&&!inside});
}
function seekBeats(amount){
 if(locked()||loading||!duration()||!clickTrack?.grid)return;
 seek(MeleteFullPracticeClick.stepBeats(clickTrack.grid,position(),amount,duration()));
}
function showSoloRange(){rangeControl.show(song.url,shift(),rangeCueBook[song.url],song.tracks.find(t=>t.id==='vocals'));}
function restoreControls(){speed.setValue(config().rate??1,false);transpose.setValue(C.recordingShift(config(),song));beatCount.setValue(config().countInBeats??defaultCount(),false);showSoloRange();}
function changed(e){if(recording||busy||finishing||!song){if(song)restoreControls();return;}const resume=playing||!!waitingPlay;stop();const cfg=config();
 prefs.songs[song.id]=e?.target.id==='transpose'?{...cfg,shifts:{...cfg.shifts,[song.url]:transpose.value()}}:{...cfg,rate:speed.value()};
 if(e?.target.id==='transpose')showSoloRange();
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
const rehearsalNames={
 'the-circle':'Circle','hymn-to-breaking-strain':'Strain','bold-orion':'Orion','who-by-fire':'Fire',
 'no-one-survives':'Survives','auld-lang-syne':'Auld','songs-stay-sung':'Stay','ballad-of-smallpox-gone':'Smallpox',
 'here-comes-the-sun':'Sun','a-toast-for-unknown-heroes':'Heroes','brighter-than-today':'Brighter','song-of-the-artesian-water':'Artesian'
};
function songListTitle({id,title}){
 const name=document.createElement('span');name.className='song-name';
 const cue=rehearsalNames[id],at=cue?title.indexOf(cue):-1;
 if(at<0){name.textContent=title;return name;}
 const strong=document.createElement('strong');strong.textContent=cue;
 name.append(title.slice(0,at),strong,title.slice(at+cue.length));return name;
}
function renderSongs(){
 const groups=new Map();$('songList').replaceChildren();
 for(const item of catalog.songs){
  const season=item.season||'Other';
  if(!groups.has(season)){
   const group=document.createElement('section'),h=document.createElement('h2');group.className='season-group';
   group.dataset.season=season.toLowerCase();group.setAttribute('aria-label',season+' songs');h.className='season-heading';
   h.textContent=season;group.append(h);$('songList').append(group);groups.set(season,group);
  }
  const b=document.createElement('button');b.className='song-choice';b.dataset.id=item.id;b.dataset.season=season.toLowerCase();
  b.classList.toggle('selected',item.id===song?.id);b.classList.toggle('pending',!item.tracks.length);
  b.setAttribute('aria-pressed',String(item.id===song?.id));b.setAttribute('aria-label',`${item.title} (${season})`);
  b.append(songListTitle(item));b.onclick=()=>void choose(item.id);groups.get(season).append(b);
 }
}
function selectRecording(base,requested){
 const group=catalog.references?.[base.id],alts=group?.alternatives||{},ref=requested??prefs.songs[base.id]?.referenceId;
 const alt=Object.hasOwn(alts,ref)?alts[ref]:null,select=$('referenceRecording');
 const selected=alt?{id:base.id,title:base.title,...alt,referenceId:ref}:base;
 const old=prefs.songs[base.id];
 if(old){const migrated=C.migrateCapo(C.migrateShift(old,base,alts),selected);if(migrated!==old){prefs.songs[base.id]=migrated;persist();}}
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
 setPressed('tabFingers',fingers);
 $('tabFingers').hidden=tabPart.hasFingers===false;
 // This tab is an authored fingering, not a chord sheet that can be revoiced for another capo.
 const d=C.tabPitch(lyricChart?.key||tabPart.recordingKeys?.[song.referenceId||'playlist']||tabPart.key,tabPart.key,shift(),prefs.concertPitch!==false);
 $('tabTuning').textContent=d.label;
 MeleteFullPracticeTab.render($('tabBody'),tabPart,fingers&&tabPart.hasFingers!==false,name=>C.transposeChord(name,d.shift,tabPart.key));
}
bindToggle('tabFingers',on=>{
 if(!tabPart)return;prefs.tabFingers=on;persist();drawTab();
});
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
function renderStemRows(mixerTracks){
 $('stems').replaceChildren();
 mixerTracks.forEach((t,i)=>{
  const row=document.createElement('div');row.className='mixer-stem '+(t.audioUrl?'arrangement-stem':'full-stem');
  const controls=document.createElement('div');controls.className='track-controls';const mute=document.createElement('button');mute.className='mute';mute.innerHTML='<i data-lucide="volume-2"></i>';
  const label=document.createElement('span');label.textContent=t.label;mute.append(label);mute.onclick=()=>{mix[i].on=!mix[i].on;volumes();};
  const level=document.createElement('button');level.className='track-level';level.setAttribute('aria-label',t.label+' volume');
  const number=MeleteDragNumber(level,{values:Array.from({length:41},(_,i)=>i*5),defaultValue:100,clickStep:10,pixelsPerStep:5,format:v=>`${v}%`,aria:v=>`${v}%`,onHold:()=>{soloStem(i);}});
  number.setValue(mix[i].level*100,false);level.oninput=()=>{mix[i].level=number.value()/100;volumes();};
  const solo=document.createElement('button');solo.className='solo';solo.textContent='S';solo.setAttribute('aria-label','Solo '+t.label);solo.onclick=()=>{soloStem(i);};
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=50;canvas.tabIndex=0;canvas.setAttribute('role','slider');canvas.setAttribute('aria-label',t.label+' position');canvas.setAttribute('aria-valuemin','0');canvas.setAttribute('aria-valuemax',String(duration()));
  canvas.onclick=e=>{const b=canvas.getBoundingClientRect();seek((e.clientX-b.left)/b.width*duration());};
  controls.append(mute,level,solo);row.append(controls,waveBed(canvas));$('stems').append(row);
 });
}
async function choose(id,requested){
 if(locked())return;
 deferredAudio=null;retryAudio=null;
 const token=++revision;streamUnlisten?.();streamUnlisten=null;streamEntry=null;abort?.abort();const controller=abort=new AbortController();
 stop();micCheck.close();current=0;playEnd=0;lanes=[];localRows.clear();targetId=null;soloId=null;
 libraryReady=false;libraryError='';clearTimeout(undoTimer);$('undoDelete').hidden=true;
 buffers=[];peaks=[];previewDuration=0;$('mixer').classList.remove('streaming');deck?.clear();layerAudio?.clear();clickTrack?.setMap(null,0);$('clickQuality').textContent='';
 const selected=song=selectRecording(catalog.songs.find(s=>s.id===id)||catalog.songs[0],requested);
 keys.choose(song.id);
 voicings.hide();document.body.toggleAttribute('data-chord-shapes',taylorShapes());
 const mixerTracks=[...song.tracks,...(song.guides||[])];
 mix=mixerTracks.map(t=>{const old=saved[song.id]?.find(m=>m.id===t.id);return{id:t.id,on:old?.on??true,level:Number.isFinite(old?.level)?Math.min(2,Math.max(0,old.level)):1};});
 if(catalog.references?.[song.id]){prefs.songs[song.id]={...config(),referenceId:song.referenceId||'playlist'};persist();}
 $('excerpts').href=(catalog.auditionBase||'./')+'#'+song.id;$('excerpts').hidden=song.season==='Reserve';showParts();document.title=song.title+' - '+(catalog.title||'Solstice practice');
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
 function failed(e){
  retryAudio=()=>loadChosenAudio(true);status(e.message+' Press Play to retry.',true);update();
 }
 async function loadChosenAudio(completeFile=false){
 if(token!==revision)return;retryAudio=null;loading=true;update();
 try{await ensureAudio(false);if(token!==revision)return;
 const withGuides={...selected,tracks:mixerTracks},index=completeFile?null:await waveformIndex(withGuides,controller.signal);
 if(token!==revision)return;
 const early=audioLoader.open(withGuides,ctx,index,controller.signal);
 const meta=MeletePracticeStream.match(withGuides,index),earlyDraw=!!meta;
 if(earlyDraw){previewDuration=meta.frames/meta.rate;peaks=early?.peaks||MeletePracticeStream.previews(meta);renderStemRows(mixerTracks);draw();}
 const [entry,beatMap]=await Promise.all([
  early||audioLoader.load(withGuides,ctx,{signal:controller.signal,onProgress:(n,cached)=>{if(token===revision&&!cached)status(`Loading ${n}/${mixerTracks.length}…`);}}),
  selected.rehearsalPulse??(selected.referenceId?referenceCues(selected).then(c=>c.beats):beatCatalog.songs?.[selected.id]),
 ]);
 if(token!==revision)return;streamUnlisten?.();buffers=entry.buffers;peaks=entry.peaks;streamEntry=entry.listen?entry:null;
 playEnd=duration();deck.setBuffers(buffers,mixerTracks.map(t=>t.id),mixerTracks.filter(t=>t.concertPitch).map(t=>t.id),streamEntry);
 const bufferMark=()=>{const s=streamEntry,el=$('mixer');el.classList.toggle('streaming',!!s&&!s.complete&&!s.error);
  if(s&&!s.complete)el.style.setProperty('--buffered',(100*s.available/s.frames)+'%');};
 bufferMark();let lastReady=recordBuffered();streamUnlisten=streamEntry?.listen(()=>{
  if(token!==revision)return;if(streamEntry.error&&streamEntry.error.name!=='AbortError')failed(streamEntry.error);
  bufferMark();
  if(recordBuffered()!==lastReady){lastReady=recordBuffered();update();}
 });
 const version=sourceVersion(),matchedMap=beatMap?.sourceVersion===version?beatMap:null;
 clickTrack.setMap(matchedMap,duration());bars=L.measures(matchedMap,duration());pitchView.setMeasures(bars,clickTrack.grid.times);
 const stored=song.referenceId?(config().referenceLoops?.[song.referenceId]??(config().loop?.sourceVersion===version?config().loop:null)):config().loop;
 const compatible=taylorShapes()&&stored?.sourceVersion===version&&matchedMap?L.pairLegacyBars(stored,matchedMap.times,duration()):stored;
 loopState=L.restore(compatible,bars,duration(),version)||(!stored&&prefs.loop?L.whole({},bars,duration()):{});
 if(activeLoop())current=activeLoop().start;
 syncLoop();pitchView.move(current,false,true);
 $('clickQuality').textContent=clickTrack.grid.aligned?(beatMap.label||'Estimated recording pulse'):'Count-in only';$('clickQuality').title=clickTrack.grid.aligned?beatMap.notes||'':'No matching beat map for this recording.';
 if(!earlyDraw)renderStemRows(mixerTracks);volumes();renderTracks();draw();status(libraryError,!!libraryError);
 }catch(e){if(token===revision&&e.name!=='AbortError'){buffers=[];failed(e);}}finally{
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
 if(locked()||loading||!buffers.length||!libraryReady||!recordBuffered())return;
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
  const entry=entryTiming(sourcePosition,true,.2),{plan,punchAt}=entry;
  const maxSeconds=(end-sourcePosition)/rate()+prepared.latency;
  recorder.startAt({playbackAt:punchAt,sourcePosition,maxSeconds,pickupSeconds:Math.min(.18,plan.duration)});
  recordEndAt=punchAt+maxSeconds;
  startWithEntry(entry,false,end);
  recording=true;status(leadIn?'Count-in: '+lane.name:'Recording '+lane.name);
  void refreshMicrophones().catch(()=>{});
 }catch(e){stop();await recorder.cancel();if(e.name!=='AbortError')setError(e);}finally{busy=false;update();}
}
async function finishRecord(complete){
 if(!recording||finishing)return;finishing=true;
 const cancel=leadIn&&ctx.currentTime<leadIn.punchAt?leadIn:null;stop();
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
 if(!duration()||edgeSettings()?.outro==null)return;
 normalListeningEnd=listeningEnd(null);
 if(!playing||locked()||loading)return;
 const region=playLoop?activeLoop():null,end=region?listeningEnd(region):normalListeningEnd;
 if(Math.abs(end-playEnd)<.002)return;
 const pos=position(),past=pos>=end-.01;
 seek(past?(region?.start??end):pos,{startPlayback:!past||!!region,bypassLoop:!region});
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
bindToggle('countIn',on=>{prefs.countIn=on;persist();update();});
$('countIn').dataset.help='Count before Play or Record, even with the metronome off. Loops repeat without another count.';
$('countInBeats').oninput=()=>{if(!song||locked()||leadIn)return;prefs.songs[song.id]={...config(),countInBeats:beatCount.value()};persist();};
$('countInBeats').dataset.help='Preparatory beats for this song. Click to add one, or drag to adjust.';
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
$('play').onclick=()=>void play({countIn:true});$('record').onclick=()=>void startRecord();$('rewind').onclick=()=>seek(0);$('loop').onclick=toggleLoop;
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
 if($('entranceEditor').open||(e.code==='Space'&&target.closest('.lead-entrance,.lead-band-cue')))return;
 if(target.closest('#soloRange')&&(e.key===' '||e.key==='Enter'))return;
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
  if((choice||target.closest('.setting-toggle,#countInBeats,#keepShapes,#leadDisplay,.lead-form-step'))&&e.code==='Space')return;
  consume();if(!e.repeat)void play({countIn:true});return;
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
let frames=0;function tick(){const pos=position(),displayEnd=recording||playLoop||pos>normalListeningEnd+.02?duration():normalListeningEnd;
 $('time').textContent=`${clock(pos)} / ${clock(displayEnd)}`;
 if(reader.open&&!$('readerTransport').hidden&&!$('readerSeek').matches(':active')){
  const t=position();$('readerSeek').value=String(t);$('readerTime').textContent=leadIn?$('count').textContent:clock(t);
 }
 if(playing){drawCursor();if(recording&&frames++%6===0&&activeLane())drawLane(activeLane(),true);}if(playing&&!playLoop&&position()>=playEnd){if(recording){if(ctx.currentTime>=recordEndAt)void finishRecord(true);}else stop();}requestAnimationFrame(tick);}tick();
const readBook=(name,ms)=>MeleteFullPracticeLoader.bounded(null,ms,async signal=>{
 const r=await fetch(name,{cache:'no-store',signal});if(!r.ok)throw Error('Could not load '+name);return r.json();
});
let booting=false;
async function boot(){
 booting=true;$('play').disabled=true;
 try{
  // Every current recording carries its own pulse. Neither range art nor legacy maps should delay audio.
  const data=await readBook('full-practice.json',12000);
  if(!data.songs?.length)throw Error('No practice songs available.');catalog=data;
  if(data.songs.some(s=>!s.rehearsalPulse))beatCatalog=await readBook('full-practice-beats.json',6000).catch(()=>({}));
  void readBook('full-practice-range-cues.json',6000).then(r=>{rangeCueBook=r.version===1?r.recordings||{}:{};if(song)showSoloRange();}).catch(()=>{});
  const id=location.hash.slice(1);await choose(data.songs.some(s=>s.id===id)?id:data.songs[0].id,new URLSearchParams(location.search).get('ref'));
 }catch(e){status(e.message+' Press Play to retry.',true);$('play').disabled=false;}
 finally{booting=false;}
}
window.addEventListener('pageshow',e=>{
 if(e.persisted&&song&&!recording&&!finishing&&!recorder.recovery()){busy=false;void choose(song.id,song.referenceId||'playlist');}
});
void boot();void refreshMicrophones().catch(()=>{});
})();
