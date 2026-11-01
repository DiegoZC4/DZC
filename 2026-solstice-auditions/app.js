/* Audition workflow; recording, storage, detector and metrics are shared Melete modules. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const R = window.MeleteRecording, P = window.MeleteTakePitch, T = window.MeleteRecordingTiming;
  const M = window.MeleteMelody;
  const V = window.MeleteAuditionReviews;
  const store = new R.TakeStore(undefined, "melete-audition-takes-v1");
  let catalog, song, sequence, xml, api, session, takes = [], submissions = [], reviews = [];
  let selected = null, audio = null, playing = null, recording = null, busy = false, generation = 0, loading = 0;
  let showAllTakes = false;
  let live = [], liveChannel = null, analysisQueue = Promise.resolve(), timer = 0, statusTimer = 0;
  let pitchySource = null, context = null, guide = null, nodes = [], playbackBuffer = null;
  let geometry = null, current = 0, sourceReady = false, recovery = null, preferredDevice = "";
  let backingCatalog = {songs:[]}, alignmentCatalog = {songs:[]}, alignment = null, referenceXml = null;
  let playbackMode = "recording", playRevision = 0, referenceEndTimer = 0, scoreGeometry = [], recordSetup = false;
  let compactNotation = false, scoreNotes=[], scoreNoteIds=new Map();
  let clipCatalog={songs:[]}, deck=null, master=null, metroGain=null, metronome=false, metro=null, lastMetroTick=-Infinity;
  let waveformCatalog={songs:[]};
  let melody=false, melodyPlayer=null;
  let transposeBySong={},notationRevision=0;
  // Highest first, so higher keys are on the pages above (Arrow Up / drag down raise; a tap steps down).
  const transposePager=new MeleteInfinitePager($("transpose"),{options:Array.from({length:25},(_,i)=>({value:12-i,label:i===12?"0":`${i<12?"+":""}${12-i}`})),value:0});
  const speedPager=new MeleteInfinitePager($("speed"),{options:Array.from({length:7},(_,i)=>({value:.5+i*.25,label:`${50+i*25}%`})),value:1});
  const assetCache=new Map();
  const clipCache=new T.ClipCache();
  const reviewAudio=new T.ByteCache(32*1048576);
  function asset(path,json=false){
    if(!assetCache.has(path))assetCache.set(path,fetch(path).then(r=>{if(!r.ok)throw new Error('Excerpt could not load.');return json?r.json():r.text();}).catch(e=>{assetCache.delete(path);throw e;}));
    return assetCache.get(path);
  }
  const waveforms=new MeleteWaveformLanes.View($("waveformTimeline"),$("waveformCanvas"),$("waveformPlayhead"),f=>{
    if(!sequence)return;
    seekPosition(waveforms.tick(f)/sequence.endTick*song.duration);
  });
  // The local build loads the editor; the public package omits it entirely.
  let beatPreview=null,beatEditing=false;
  const beatEditor=window.MeleteBeatEditor?new MeleteBeatEditor.Editor(()=>beatGridChanged()):null;
  waveforms.editable((tick,seconds,done)=>{
    if(!beatEditing||!beatEditor.alignment||recording||busy)return;
    beatPreview=done||seconds===null?null:beatEditor.preview(tick,seconds);
    if(done&&seconds!==null)beatEditor.commit(tick,seconds);else renderWaveforms();
  });
  // Bar lines and beats through the last grid anchor, past the music where a loop's tail runs on.
  function beatGrid(){
    const end=Math.max(sequence.endTick,alignment?.beatAnchors?.at(-1)[0]??0),measures=T.measuresTo(sequence,end),last=measures.at(-1);
    return {measures,bars:[...measures.map(m=>m[0]),last[0]+last[1]],beats:T.measureBeats(sequence,end).map(b=>b.tick)};
  }
  function beatGridChanged(){
    beatPreview=null;renderWaveforms();moveCursor(current);
    if(playing?.kind==="timed"&&!recording&&!currentTake()){stopPlayback();void play();}
  }
  let holdCancel=null, previewVoice=null, pendingClicks=new Set();
  let takeOrder=P.takeSort(), pendingDeletes=[], deleteTimer=0, checkInput=null;
  const takeContours=new WeakMap();
  const colourScheme=matchMedia('(prefers-color-scheme: dark)');
  const referenceAudio = new MeleteReferenceAudio.Player($("backingAudio"), {
    buffered:true,onError: message => {stopPlayback();status(message,true);}, onChange: () => updateReferenceControls()
  });
  let trackLevels=[100,100,100,100],loopEnabled=true;
  const levelControls=['vocalLevel','backingLevel','clickLevel','melodyLevel'].map((id,index)=>{
    const control=MeleteDragNumber($(id),{values:Array.from({length:41},(_,i)=>i*5),defaultValue:100,pixelsPerStep:5,
      format:v=>`${v}%`,aria:v=>`${v}%`,onHold:()=>emphasizeTrack(index)});
    $(id).oninput=()=>{trackLevels[index]=control.value();applyTrackLevels();settings();};
    return control;
  });
  const scaleControls=Object.fromEntries([['scale',80,160],['stretch',100,250]].map(([id,min,max])=>[
    id,MeleteDragNumber($(id),{values:Array.from({length:(max-min)/10+1},(_,i)=>min+i*10),defaultValue:100,
      pixelsPerStep:8,stepOnClick:true,format:v=>`${v}%`,aria:v=>`${v}%`})
  ]));
  function applyTrackLevels(){
    deck?.trackLevels(trackLevels[0]/100,trackLevels[1]/100);
    if(metroGain)metroGain.gain.setTargetAtTime(metronome?trackLevels[2]/100*CLICK_LEVEL:0,context.currentTime,.005);
    melodyPlayer?.mix(melody,trackLevels[3]/100);
  }
  function emphasizeTrack(index){
    trackLevels=M.emphasized(trackLevels,index);
    levelControls.forEach((c,i)=>c.setValue(trackLevels[i],false));
    metronome=true;melody=melody||index===3;setMix(true,true);applyTrackLevels();settings();
  }
  const icons = () => window.lucide?.createIcons();
  // Levels match Melete at 100% (solstice-auditions/review/2026-10-31/loudness): the
  // stems through their clip gains, the click CountIn at 1.438x. Melete's limiter
  // keeps 200% from clipping; LIMITER_TRIM cancels its +0.57 dB makeup and
  // LIMITER_DELAY is its fixed 6 ms look-ahead (288 frames at 48 kHz).
  const CLICK_LEVEL=1.438,LIMITER_TRIM=10**(-.57/20),LIMITER_DELAY=.006;
  const format = x => Number.isFinite(x) ? x.toFixed(1) : "\u2014";
  const clock = x => `${Math.floor(Math.max(0,x)/60)}:${String(Math.floor(Math.max(0,x)%60)).padStart(2,"0")}`;
  const currentTake = () => [...takes,...reviews].find(t => t.id === selected);
  const rate = () => speedPager.value();
  const transposition = () => Number(transposeBySong[song?.id]) || 0;
  const key = () => `solstice-auditions:${song.id}:${song.version}`;
  const usingReference = () => currentTake() ? currentTake().pitchReference?.timing?.kind==="recording" : playbackMode === "recording" && !!referenceAudio.timeline;
  const activeMap = () => currentTake()?.pitchReference?.timing?.kind==="recording" ? new MeleteReferenceAudio.Timeline(currentTake().pitchReference.timing.anchors) : referenceAudio.timeline;
  const maxPosition = () => usingReference() ? (currentTake()?.pitchReference?.end??loopRegion()?.endTick??activeMap().endTick) / sequence.endTick * song.duration : song.duration;
  const displayShift = () => currentTake()?.pitchReference?.timing?.pitchShift ?? currentTake()?.transpose ?? currentTake()?.octave ?? transposition();
  async function loadBackings(){
    try{const response=await fetch("backings.json",{cache:"no-store"});if(!response.ok)return;
      backingCatalog=await response.json();renderBacking();
    }catch{$("backingStatus").textContent="Backing status unavailable";}
  }
  function renderBacking(){
    const entry=backingCatalog.songs.find(s=>s.id===song?.id);
    referenceAudio.setEntry(entry);
  }
  function updateReferenceControls(){
    const entry=referenceAudio.entry, tracks=entry?.tracks||[];
    const ready=tracks.some(t=>t.id==="original")&&tracks.some(t=>t.id==="vocal")&&tracks.some(t=>["backing","instrumental"].includes(t.id));
    for(const [id,enabled,label] of [["referenceVocal",referenceAudio.vocal,"vocal"],["referenceBacking",referenceAudio.backing,"backing"]]){
      const button=$(id);button.disabled=busy||!ready||!usingReference();
      button.setAttribute("aria-pressed",String(enabled));button.title=`${enabled?"Mute":"Unmute"} ${label}; hold to solo or restore all tracks`;
      button.setAttribute("aria-label",button.title);
      const icon=document.createElement("i");icon.setAttribute("data-lucide",enabled?"volume-2":"volume-x");
      button.querySelector("svg, i")?.replaceWith(icon);
    }
    $("backingStatus").textContent=!usingReference()?"Guide":busy?"Preparing":!tracks.length?"Unavailable":
      !referenceAudio.vocal&&!referenceAudio.backing?"Muted":referenceAudio.vocal&&referenceAudio.backing?"Original":referenceAudio.vocal?"Vocal only":"Backing only";
    if(usingReference()&&tracks.length&&!ready)$("backingStatus").textContent="Original / stems pending";
    $("backingNote").textContent="";
    $("record").title=$("auditionGuidance").textContent;
    $("metronome").setAttribute("aria-pressed",String(metronome));
    $("metronome").title=metronome?"Mute metronome":"Enable metronome";$("metronome").setAttribute("aria-label",$("metronome").title);
    $("melody").setAttribute("aria-pressed",String(melody));$("melody").disabled=busy||!sourceReady;
    $("melody").title=`${melody?'Mute':'Unmute'} synthesized melody; hold to solo or restore all tracks`;
    $("melody").setAttribute("aria-label",$("melody").title);
    for(const [i,id] of ['vocalLevel','backingLevel','clickLevel','melodyLevel'].entries()){
      $(id).disabled=busy;$(id).title=`${['Vocal','Backing','Click','Melody'][i]} volume; drag to adjust, hold to emphasize / reduce / restore`;
    }
    const transposeLocked=!!recording||busy||!!selected;
    $("transpose").inert=transposeLocked;$("transpose").setAttribute("aria-disabled",String(transposeLocked));$("transpose").tabIndex=transposeLocked?-1:0;
    if(!transposePager.drag&&transposePager.pendingIndex===null)transposePager.setValue(displayShift());
    $("speed").inert=transposeLocked;$("speed").setAttribute("aria-disabled",String(transposeLocked));$("speed").tabIndex=transposeLocked?-1:0;
    icons();
    renderWaveforms();
  }
  function renderWaveforms(){
    if(!sourceReady||!sequence){waveforms.set(null);return;}
    const map=usingReference()?activeMap():null;
    const entry=waveformCatalog.songs.find(s=>s.id===song.id&&s.originalSha256===alignment?.originalSha256&&s.scoreVersion===song.version);
    const beats=currentTake()?.pitchReference?.timing?.beatAnchors||alignment?.beatAnchors;
    const beatMap=map&&beats?new MeleteReferenceAudio.Timeline(beatPreview||beats):map;
    const count=map?countInLane(map):{start:null,beats:[]},grid=beatGrid();
    const clip=clipCatalog.songs.find(s=>s.id===song.id),take=currentTake(),saved=take?.pitchReference,region=saved?.timing?.loop||alignment?.loop;
    const playbackEnd=saved?.timing?.kind==='recording'?saved.timing.origin+saved.seconds*saved.rate:clip?.end;
    const cut=map&&clip?{start:clip.start,end:Math.min(clip.end,playbackEnd),fadeOut:clip.fadeOut||alignment?.loop?.fadeOut,
      fadeIn:T.entranceFade(clip,count.start,take?.rate||rate()),loopStart:region?.start}:null;
    // A loop that runs past the music clicks on to its seam.
    const clicks=map?Math.max(map.endTick,alignment?.loop?.endTick??0):undefined;
    waveforms.set({map,beatMap,start:count.start,count:count.beats,endTick:sequence.endTick,measures:map?grid.measures:sequence.measures,beats:T.measureBeats(sequence,clicks),grid,
      cut,playbackEnd,envelopes:entry?.tracks,notes:sequence.notes,active:[!!map&&referenceAudio.vocal,!!map&&referenceAudio.backing,metronome,melody],
      edit:beatEditing&&!!map&&!!alignment?.beatAnchors&&!currentTake()&&!recording});
    waveforms.seekable(!recording&&!busy&&sourceReady);
  }
  function countInLane(map){
    // Recording playback starts at the count-in downbeat; show that bar and its clicks.
    const ref=currentTake()?.pitchReference;
    if(ref?.timing?.kind==="recording")return {start:ref.timing.origin,
      beats:(ref.timing.countInBeats||[]).map(b=>({label:b.label,seconds:ref.timing.origin+b.seconds*ref.rate}))};
    return {start:alignment?.countInStart??map.start,beats:alignment?.countInBeats||[]};
  }
  function revealCurrentSong(){
    const list=$("songList"),selected=list.querySelector(".selected");
    if(!selected||list.scrollWidth<=list.clientWidth)return;
    const box=list.getBoundingClientRect(),item=selected.getBoundingClientRect();
    if(item.left<box.left)list.scrollLeft-=box.left-item.left;
    else if(item.right>box.right)list.scrollLeft+=item.right-box.right;
  }
  function pauseBacking(){ clearTimeout(referenceEndTimer);referenceAudio.pause(); }
  async function detectorSource(){
    if(pitchySource)return pitchySource;
    const response=await fetch("vendor/pitchy-browser.js");
    if(!response.ok)throw new Error("Pitch detector could not load. Your saved recordings are unchanged.");
    pitchySource=await response.text();return pitchySource;
  }
  function status(message = "", error = false) {
    clearTimeout(statusTimer); $("status").textContent = message; $("status").classList.toggle("error",error);
    if (message && !error) statusTimer = setTimeout(() => {$("status").textContent="";},6500);
  }
  function settings() { try { localStorage.setItem("melete-audition-settings",JSON.stringify({speed:rate(),transposeBySong,device:preferredDevice,latency:$("latency").value,vocal:referenceAudio.vocal,backing:referenceAudio.backing,metronome,melody,trackLevels,loopEnabled,takeOrder,showAllTakes,scale:scaleControls.scale.value(),stretch:scaleControls.stretch.value(),micExpanded:!$("micSettings").hidden,displayExpanded:!$("displaySettings").hidden})); } catch {} }
  async function request(action, body, binary = false) {
    const response = await fetch(`api.php?action=${action}`, {method:body === undefined?"GET":"POST",credentials:"same-origin",cache:"no-store",
      headers:body === undefined?{}:{"Content-Type":binary?"application/octet-stream":"application/json","X-Melete-CSRF":session.csrf},
      body:body === undefined?undefined:binary?body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    const data = await response.json(); if(!response.ok) throw new Error(data.error || "Audition request failed"); return data;
  }
  async function refreshSession() {
    session = await request("status");
    $("accountName").textContent=session.user?.name || "";
    $("googleButton").hidden=!!session.user; $("signOut").hidden=!session.user; $("refreshReview").hidden=!session.user;
    if(session.user)$("signIn").hidden=true;else void showGoogleButton();
    submissions=session.user?(await request("list")).submissions:[];
    await loadReview();renderSongs(); updateControls();
  }
  function renderSongs() {
    const groups=new Map();$("songList").replaceChildren();
    for(const item of catalog.songs){
      if(!groups.has(item.season)){
        const group=document.createElement("section"),heading=document.createElement("h2");
        group.className="season-group";group.dataset.season=item.season.toLowerCase();group.setAttribute("aria-label",`${item.season} songs`);
        heading.className="season-heading";heading.textContent=item.season;group.append(heading);$("songList").append(group);groups.set(item.season,group);
      }
      const button=document.createElement("button"); button.className="song-choice";
      button.classList.toggle("selected",item.id===song?.id);button.classList.toggle("pending",!item.ready);
      button.setAttribute("aria-pressed",String(item.id===song?.id));
      const submitted=submissions.find(s=>s.song===item.id), label=`${item.title} (${item.season})${submitted?`, submitted v${submitted.revision}`:!item.ready?", melody pending":""}`;
      button.dataset.season=item.season.toLowerCase();button.title=label;button.setAttribute("aria-label",label);
      const title=document.createElement("span");title.className="song-name";title.textContent=item.title;
      button.append(title);
      if(submitted||!item.ready){const badge=document.createElement("i");badge.setAttribute("data-lucide",submitted?"check":"clock");badge.setAttribute("aria-hidden","true");button.append(badge);}
      button.onclick=()=>{void chooseSong(item.id);};groups.get(item.season).append(button);
    }
    icons();revealCurrentSong();
  }
  // Keep the page height while a song loads, so the browser never clamps the reader to the bottom.
  let layoutHold=null;
  function holdLayout(){
    const player=$("player"),notation=$("notation");layoutHold={notation:false,takes:false};
    player.style.minHeight=`${player.getBoundingClientRect().height}px`;notation.style.minHeight=`${Math.max(130,notation.getBoundingClientRect().height)}px`;
  }
  function releaseLayout(part){
    if(!layoutHold)return;if(part)layoutHold[part]=true;
    if(!part||layoutHold.notation&&layoutHold.takes){layoutHold=null;$("player").style.minHeight="";}
  }
  async function chooseSong(id) {
    if(recording || busy || recovery) return;
    micCheck.close();
    holdCancel?.();
    const next=catalog.songs.find(s=>s.id===id) || catalog.songs[0];
    holdLayout();stopPlayback();pauseBacking(); selected=null; takes=[]; live=[];current=0;sourceReady=false;
    referenceAudio.setTimeline(null);referenceXml=null;scoreGeometry=[];$("scorePlayhead").hidden=true;
    song=next;transposePager.setValue(transposition());const token=++loading;history.replaceState(null,"",`${location.pathname}${location.search}#${encodeURIComponent(song.id)}`);
    alignment=alignmentCatalog.songs.find(s=>s.id===song.id&&s.scoreVersion===song.version)||null;
    document.title=`${song.title} - Solstice Auditions`;
    $("cutLabel").hidden=!song.cutLabel;$("cutLabel").textContent=song.cutLabel||"";
    const original=backingCatalog.songs.find(s=>s.id===song.id),video=alignment?.referenceVideo;
    const start=(alignment?.vocalOnset??alignment?.anchors?.[0]?.[1])+(video?.offsetSeconds||0);
    const sourceLink=MeleteReferenceAudio.sourceLink(video?.url||original?.url||song.sourceUrl,start);
    const link=$("source");link.hidden=!sourceLink;
    if(sourceLink){const youtube=sourceLink.label.startsWith("YouTube");link.href=sourceLink.url;link.classList.toggle("youtube",youtube);
      link.title=`${youtube?`Original on YouTube${Number.isFinite(start)?`, from ${clock(start)}`:""}`:sourceLink.label}${song.sourceLabel?` (${song.sourceLabel})`:""}`;
      link.setAttribute("aria-label",link.title);}
    $("pending").hidden=song.ready;$("pending").textContent="The program entry is here; a verified melody excerpt has not been added yet.";
    $("player").hidden=!song.ready;api?.destroy();api=null;
    $("notation").replaceChildren();$("pitchbar").replaceChildren();renderSongs();renderTakes();renderBacking();updateControls();
    if(!song.ready){releaseLayout();return;}
    try {
      const [data,source]=await Promise.all([asset(song.playback,true),asset(song.score)]);if(token!==loading)return;
      if(alignment?.score){referenceXml=await asset(alignment.score);if(token!==loading)return;}
      sequence=data;xml=source;sourceReady=true;
      if(alignment && referenceAudio.entry?.tracks?.find(t=>t.id==='original')?.file!==alignment.originalFile)alignment=null;
      if(alignment)referenceAudio.setTimeline(new MeleteReferenceAudio.Timeline(alignment.anchors));
      beatEditor?.attach(alignment,alignment&&beatGrid());
      renderNotation();renderPitch();await loadTakes();updateControls();releaseLayout("takes");
      const clip=clipCatalog.songs.find(s=>s.id===song.id&&s.scoreVersion===song.version);
      if(clip)void clipCache.prefetch(clip,rate()).catch(()=>{});
    }catch(e){if(token===loading){releaseLayout();status(e.message,true);}}
  }
  async function renderNotation(){
    const revision=++notationRevision,id=song.id,shift=displayShift();
    let source=xml;
    try{if(shift){const path=song.transpositions?.[String(shift)];if(!path)throw new Error("Transposed notation needs rebuilding.");
      source=await asset(path);}
    }catch(error){if(revision===notationRevision){releaseLayout();status(error.message,true);}return;}
    if(revision!==notationRevision||song.id!==id)return;
    const notation=$("notation");notation.style.minHeight=`${Math.max(130,notation.getBoundingClientRect().height)}px`;
    api?.destroy();notation.replaceChildren();scoreGeometry=[];scoreNotes=[];scoreNoteIds.clear();$("scorePlayhead").hidden=true;
    const settings=new alphaTab.Settings(); settings.core.useWorkers=false;settings.core.enableLazyLoading=false;
    settings.core.smuflFontSources=new Map([[alphaTab.FontFileFormat.Woff2,"vendor/Bravura.woff2"]]);
    compactNotation=window.innerWidth<600;
    settings.display.layoutMode=compactNotation?alphaTab.LayoutMode.Horizontal:alphaTab.LayoutMode.Page;settings.display.scale=.85*scaleControls.scale.value()/100;settings.display.barsPerRow=-1;
    settings.display.stretchForce=1.4*scaleControls.stretch.value()/100;
    settings.display.padding=[12,0,12,0];settings.importer.mergePartGroupsInMusicXml=false;
    for (const name of ["ScoreTitle","ScoreSubTitle","ScoreArtist","ScoreAlbum","ScoreMusic","ScoreWords","ScoreWordsAndMusic","TrackNames"]) {
      settings.notation.elements.set(alphaTab.NotationElement[name],false);
    }
    if(usingReference())settings.notation.elements.set(alphaTab.NotationElement.EffectTempo,false);
    // As in Melete: alphaTab must never scroll the page to its cursor after a render.
    settings.player.enablePlayer=false;settings.player.scrollMode=alphaTab.ScrollMode.Off; settings.display.resources.mainGlyphColor=colourScheme.matches?new alphaTab.model.Color(225,233,228):new alphaTab.model.Color(35,44,39);
    if(colourScheme.matches){
      for(const name of ['secondaryGlyphColor','scoreInfoColor'])settings.display.resources[name]=new alphaTab.model.Color(181,196,187);
      for(const name of ['staffLineColor','barSeparatorColor'])settings.display.resources[name]=new alphaTab.model.Color(126,145,134);
      settings.display.resources.barNumberColor=new alphaTab.model.Color(239,165,188);
    }
    api=new alphaTab.AlphaTabApi($("notation"),settings);
    api.scoreLoaded.on(score=>{
      for(const bar of score.masterBars)if(bar.section&&[bar.section.marker,bar.section.text].includes(song.title))bar.section=null;
    });
    api.error.on(e=>{releaseLayout();status(`Notation: ${e.message || e}`,true);});
    api.renderFinished.on(()=>{if(revision!==notationRevision)return;
      // Keep the bundled licenses/notices; omit the renderer's visual footer.
      for(const text of notation.querySelectorAll('svg text'))if(text.textContent.trim()==='rendered by alphaTab')text.remove();
      buildScoreGeometry();moveCursor(current);notation.style.minHeight='130px';releaseLayout("notation");});
    api.load(new TextEncoder().encode(source));
  }
  function buildScoreGeometry(){
    const lookup=api?.boundsLookup||api?.renderer?.boundsLookup;
    scoreNotes=[];scoreNoteIds.clear();
    scoreGeometry=sequence.measures.flatMap(([start,duration],i)=>{
      const master=lookup?.findMasterBarByIndex(i),box=master?.realBounds;
      if(!box)return [];
      const columns=new Map();
      for(const bar of master.bars||[])for(const beat of bar.beats||[]){
        const tick=beat.beat?.absolutePlaybackStart,heads=(beat.notes||[]).map(n=>n.noteHeadBounds?.x).filter(Number.isFinite);
        const x=heads.length?Math.min(...heads):beat.realBounds?.x;
        const target=sequence.notes.find(n=>n[1]<=tick&&n[2]>tick);
        if(target)scoreNoteIds.set(String(beat.beat.id),target);
        if(target)for(const head of beat.notes||[])if(head.noteHeadBounds)scoreNotes.push({box:head.noteHeadBounds,note:target});
        if(Number.isFinite(tick)&&Number.isFinite(x))columns.set(tick,{tick,x});
      }
      const anchors=[...columns.values()].sort((a,b)=>a.tick-b.tick);
      if(!anchors.length)anchors.push({tick:start,x:box.x});
      anchors.push({tick:start+duration,x:box.x+box.w});
      const staff=master.bars?.[0]?.visualBounds||box;
      return [{start,end:start+duration,anchors,box,top:staff.y-8,height:staff.h+16}];
    });
  }
  function scorePoint(tick){
    const bar=scoreGeometry.find(b=>tick>=b.start&&tick<b.end)||scoreGeometry.at(-1);
    if(!bar)return null;
    const points=bar.anchors;let x=points[0].x;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];if(tick<a.tick)break;
      x=a.x+Math.max(0,Math.min(1,(tick-a.tick)/(b.tick-a.tick)))*(b.x-a.x);
      if(tick<=b.tick)break;
    }
    return {...bar,x};
  }
  function reference(takeRate=rate(),shift=transposition(),latency=Number($("latency").value)/1000,loop=loopRegion()){
    return T.plan(song,sequence,usingReference()?alignment:null,takeRate,shift,latency,loop).ref;
  }
  // Seamless repeats: every pass covers the same bars, so the click keeps its meter at the wrap.
  function loopRegion(){return usingReference()||loopEnabled?T.loopRegion(sequence,alignment,usingReference()):null;}
  function svg(tag,attrs={},text){const n=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;}
  function takeContour(take){
    if(!takeContours.has(take))takeContours.set(take,P.readContour(take));
    return takeContours.get(take);
  }
  function traceFrames(){return currentTake()?takeContour(currentTake())||[]:usingReference()&&!recording?[]:live;}
  function traceRef(){return currentTake()?.pitchReference || recording?.ref || reference();}
  // More forgiving than Melete (Diego, 2026-10-31): a sung pitch is drawn on its target's pitch
  // bar, folded to the octave nearest it, and graded "on" when it is that note at any octave
  // (within 50 cents, the scorer's test). Between notes nothing is scored, so a pitch is folded
  // onto the nearest note and left ungraded. Saved contours keep the pitch actually sung.
  function foldedTrace(frames,ref,shift){
    const notes=ref.notes||[];
    return frames.map(f=>{
      if(!Number.isFinite(f.cents))return null;
      const stamp=(f.start+f.end)/2;let low=0,high=notes.length;
      while(low<high){const middle=(low+high)>>1;if(notes[middle][0]<=stamp)low=middle+1;else high=middle;}
      const before=notes[low-1],after=notes[low],inside=!!before&&stamp<before[1];
      const note=inside||!after||before&&stamp-before[1]<=after[0]-stamp?before:after;
      if(!note)return null;
      const [target]=note[2].map(p=>({p,error:P.octaveError(f.cents-p*100)}))
        .sort((a,b)=>Math.abs(a.error)-Math.abs(b.error)||Math.abs(f.cents-a.p*100)-Math.abs(f.cents-b.p*100));
      return {start:f.start,end:f.end,stamp,pitch:target.p-shift+target.error/100,grade:inside?(Math.abs(target.error)<=50?"on":"off"):"rest"};
    });
  }
  function renderPitch(){
    if(!sequence || !sourceReady)return;
    const ref=currentTake()?.pitchReference || reference(),shift=displayShift();
    const measure=document.createElement("canvas").getContext("2d");measure.font="11px system-ui";
    let width=Math.max($("pitchScroll").clientWidth,sequence.endTick/sequence.division*32+64);
    for(let i=0;i<sequence.lyrics.length-1;i++){
      const delta=sequence.lyrics[i+1][1]-sequence.lyrics[i][1];
      if(delta>0)width=Math.max(width,55+(measure.measureText(sequence.lyrics[i][3]).width+9)*sequence.endTick/delta);
    }
    width*=scaleControls.stretch.value()/100;
    const height=200*scaleControls.scale.value()/100;
    $("pitchbar").style.width=`${width}px`;
    $("pitchbar").style.height=`${height}px`;
    const pitches=sequence.notes.map(n=>n[3]);
    let low=Math.min(...pitches)-2,high=Math.max(...pitches)+2;
    // A wrong note can sit up to a tritone off its bar; widen the range rather than clip it.
    for(const p of foldedTrace(traceFrames(),traceRef(),shift))if(p){low=Math.min(low,Math.floor(p.pitch)-2);high=Math.max(high,Math.ceil(p.pitch)+2);}
    const x=t=>36+t/sequence.endTick*(width-55),y=p=>160-(p-low)/(high-low)*130;
    const root=svg("svg",{viewBox:`0 0 ${width} 200`,preserveAspectRatio:"none",role:"img","aria-label":"Expected notes and recorded pitch contour"});
    for(let p=low;p<=high;p++)root.append(svg("line",{x1:36,x2:width-19,y1:y(p),y2:y(p),class:"pitch-grid"}));
    sequence.measures.forEach((m,i)=>{root.append(svg("line",{x1:x(m[0]),x2:x(m[0]),y1:20,y2:165,class:"barline"}),svg("text",{x:x(m[0])+3,y:12,class:"pitch-label"},String(i+1)));});
    sequence.notes.forEach((n,i)=>root.append(svg("rect",{x:x(n[1]),y:y(n[3])-3.5,width:Math.max(1,x(n[2])-x(n[1])-1),height:7,class:"target-note","data-note":i})));
    sequence.lyrics.forEach(l=>root.append(svg("text",{x:x(l[1]),y:185,class:"note-lyric"},l[3])));
    const trace=svg("g",{class:"trace",id:"trace"});trace.append(...["halo","rest","off","on"].map(grade=>svg("path",{class:`trace-${grade}`,"data-grade":grade})));
    root.append(trace,svg("line",{x1:36,x2:36,y1:18,y2:168,class:"playhead",id:"playhead"}));
    $("pitchbar").replaceChildren(root);geometry={x,y,ref,width,low,high,shift};drawTrace();moveCursor(current);
    root.onpointerdown=e=>beginHold(e,ev=>{const rect=root.getBoundingClientRect(),px=(ev.clientX-rect.left)*width/rect.width,py=(ev.clientY-rect.top)*200/rect.height;
      return sequence.notes.find(n=>px>=x(n[1])-2&&px<x(n[2])+2&&Math.abs(py-y(n[3]))<10);},ev=>{const rect=root.getBoundingClientRect();return ((ev.clientX-rect.left)*width/rect.width-36)/(width-55)*song.duration;});
  }
  function drawTrace(){
    if(!geometry)return;const ref=traceRef(),points=foldedTrace(traceFrames(),ref,geometry.shift);
    if(points.some(p=>p&&(p.pitch<geometry.low||p.pitch>geometry.high))){renderPitch();return;}
    // One path per grade, under a halo of the whole line. A change of grade restarts at the
    // previous point, so the line stays joined while its color changes.
    const d={halo:"",rest:"",off:"",on:""};let last=-Infinity,previous=null;
    for(const p of points){if(!p){last=-Infinity;continue;}
      const seconds=p.stamp-ref.leadInSeconds;if(seconds<0 || p.stamp>ref.seconds)continue;
      const x=geometry.x(ref.timing?T.tickAt(ref,p.stamp):seconds*ref.rate*song.tempo/60*sequence.division),y=geometry.y(p.pitch);
      if(y<18 || y>168){last=-Infinity;continue;}
      // A pause breaks the line, and so does a fold that flips octave where the target changes.
      const at=`${x.toFixed(2)},${y.toFixed(2)} `,joined=p.start-last<=.18&&Math.abs(p.pitch-previous.pitch)<=6;
      if(!joined){d.halo+="M"+at;d[p.grade]+="M"+at;}
      else{d.halo+="L"+at;if(previous.grade!==p.grade)d[p.grade]+="M"+previous.at;d[p.grade]+="L"+at;}
      last=p.end;previous={...p,at};
    }
    for(const path of $("trace")?.children||[])path.setAttribute("d",d[path.dataset.grade]);
  }
  function moveCursor(seconds,media){
    if(!geometry)return;const tick=seconds/song.duration*sequence.endTick,x=geometry.x(tick);
    $("playhead")?.setAttribute("x1",x);$("playhead")?.setAttribute("x2",x);
    const map=activeMap();
    const elapsed=usingReference()?(Number.isFinite(media)?media:map.seconds(tick))-map.start:seconds;
    const cutoff=currentTake()?.pitchReference?.timing?.loop?.end??(currentTake()?map?.end:alignment?.loop?.end)??map?.end;
    const duration=usingReference()?cutoff-map.start:song.duration;
    $("time").textContent=`${clock(elapsed)} / ${clock(duration)}`;
    waveforms.move(waveforms.at(tick,media),$("time").textContent);
    const staffTick=staffCursorTick(tick,media),point=scorePoint(staffTick),cursor=$("scorePlayhead");cursor.hidden=!point;
    if(point){cursor.style.transform=`translate(${point.x-$("notation").scrollLeft}px,${point.top}px)`;cursor.style.height=`${point.height}px`;cursor.dataset.tick=String(staffTick);}
  }
  function staffCursorTick(tick,media){
    if(!usingReference())return tick;
    const timing=playing?.ref?.timing||currentTake()?.pitchReference?.timing||alignment;
    const anchors=timing?.beatAnchors||timing?.anchors;
    return anchors?new MeleteReferenceAudio.Timeline(anchors).tick(media??activeMap().seconds(tick)):tick;
  }
  function seekPosition(position){
    if(recording||busy||!sourceReady)return;
    const resume=!!playing;stopPlayback();current=Math.max(0,Math.min(maxPosition(),position));
    if(usingReference())referenceAudio.seekTick(current/song.duration*sequence.endTick);
    followPosition();moveCursor(current);if(resume)void play();
  }
  function followPosition(){
    const tick=current/song.duration*sequence.endTick;
    for(const [scroller,x] of [[$("pitchScroll"),geometry?.x(tick)],[$("notation"),scorePoint(staffCursorTick(tick))?.x]]){
      if(!Number.isFinite(x))continue;
      if(x<scroller.scrollLeft+15||x>scroller.scrollLeft+scroller.clientWidth-40)scroller.scrollLeft=Math.max(0,x-scroller.clientWidth/2);
    }
  }
  function setPlaybackMode(mode){
    if(recording||busy||selected||!alignment)return;
    holdCancel?.();
    const resume=!!playing;stopPlayback();playbackMode=mode;
    current=Math.min(current,maxPosition());settings();renderNotation();renderPitch();updateControls();
    if(resume)void play();
  }
  async function ensureAudio(){
    if(!context){context=new AudioContext({latencyHint:"interactive",sampleRate:48000});
      master=context.createGain();master.gain.value=LIMITER_TRIM;const limiter=context.createDynamicsCompressor();
      Object.entries({threshold:-1,knee:0,ratio:20,attack:.001,release:.08}).forEach(([k,v])=>{limiter[k].value=v;});
      master.connect(limiter).connect(context.destination);
      melodyPlayer=new M.Player(context,master,1/LIMITER_TRIM);
      guide=context.createGain();guide.connect(master);metroGain=context.createGain();metroGain.connect(master);deck=new T.Deck(context,master,clipCache);context.onstatechange=()=>{if(recording && context.state!=="running")void finishRecord(false,"Recording interrupted; this partial take cannot be submitted");};}
    await context.resume();guide.gain.value=.072;
    applyTrackLevels();
  }
  async function prepareClips(r,shift=displayShift()){
    const entry=clipCatalog.songs.find(s=>s.id===song.id&&s.scoreVersion===song.version);
    if(!entry)throw new Error("This recording's prepared excerpt needs rebuilding.");
    await deck.load(entry,r,shift);
  }
  function scheduleClicks(ref, at, from=0){
    metro?.cancel();
    const beats=[...(!recording?ref.timing.countInBeats||[]:[]),...T.clickBeats(sequence,ref)].map(b=>({...b,seconds:b.seconds-from})).filter(b=>b.seconds>=0);
    metro=new R.CountIn(context,metroGain,{duration:ref.seconds-from,beats},()=>{},globalThis,at);
  }
  function scheduleNextPass(){
    if(!playing?.repeat)return;
    const ref=playing.repeat;
    // Keep one complete pass scheduled ahead on the audio clock, not at an RAF boundary.
    while(playing.nextAt<context.currentTime+ref.seconds){
      const at=playing.nextAt;
      const click=new R.CountIn(context,metroGain,{duration:ref.seconds,beats:T.clickBeats(sequence,ref)},()=>{},globalThis,at);
      pendingClicks.add(click);click.done.then(()=>pendingClicks.delete(click));
      if(ref.timing.kind==='guide')scheduleGuide(at,0,ref.rate,ref.timing.pitchShift,ref.end);
      else melodyPlayer.schedule(sequence,ref,at);
      playing.nextAt+=ref.seconds;
    }
  }
  function updateLiveClicks(){
    if(playing?.kind!=="reference"||!metronome||!context)return;
    const map=activeMap(),seconds=referenceAudio.currentTime,r=rate();
    for(const {tick:t,label} of T.measureBeats(sequence,map.endTick)){
        const delay=(map.seconds(t)-seconds)/r;
        if(t<=lastMetroTick||delay<-.035||delay>.1)continue;
        lastMetroTick=t;
        const click=new R.CountIn(context,metroGain,{duration:Math.max(0,delay)+.06,beats:[{label,seconds:Math.max(0,delay)}]},()=>{},globalThis,context.currentTime);
        pendingClicks.add(click);click.done.then(()=>pendingClicks.delete(click));
    }
  }
  function beginHold(event,noteAt,positionAt){
    if(event.button!==0||recording||busy||!sourceReady)return;
    holdCancel?.();const surface=event.currentTarget,initial=noteAt(event),started=event.timeStamp,x=event.clientX,y=event.clientY;
    const controller=new AbortController();let moved=false,held=initial,serial=0;
    const release=()=>{if(!previewVoice)return;const {osc,gain}=previewVoice;previewVoice=null;
      gain.gain.cancelScheduledValues(context.currentTime);gain.gain.setTargetAtTime(0,context.currentTime,.003);osc.stop(context.currentTime+.018);};
    const sound=async note=>{const version=++serial;release();if(!note)return;
      await ensureAudio();if(controller.signal.aborted||serial!==version)return;
      const osc=context.createOscillator(),gain=context.createGain();osc.setPeriodicWave(context.createPeriodicWave(new Float32Array(6),new Float32Array([0,1,.44,.20,.10,.04])));
      osc.frequency.value=440*2**((note[3]+displayShift()-69)/12);gain.gain.setValueAtTime(0,context.currentTime);gain.gain.linearRampToValueAtTime(.09,context.currentTime+.005);
      osc.connect(gain).connect(context.destination);osc.onended=()=>{osc.disconnect();gain.disconnect();};osc.start();previewVoice={osc,gain};};
    const finish=()=>{controller.abort();serial++;release();holdCancel=null;};holdCancel=finish;
    if(initial){stopPlayback();void sound(initial).catch(e=>{finish();status(e.message,true);});}
    window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;
      if(Math.hypot(e.clientX-x,e.clientY-y)>8)moved=true;
      if(moved&&event.pointerType==='touch'){finish();return;}
      if(initial){const next=noteAt(e);if(next!==held){held=next;void sound(next).catch(()=>finish());}}
    },{signal:controller.signal});
    window.addEventListener('pointerup',e=>{if(e.pointerId!==event.pointerId)return;
      const tap=!moved&&e.timeStamp-started<250;finish();if(tap)seekPosition(initial?initial[1]/sequence.endTick*song.duration:positionAt(e));
    },{signal:controller.signal});
    for(const name of ['pointercancel','lostpointercapture','blur'])window.addEventListener(name,finish,{signal:controller.signal});
    surface.addEventListener('contextmenu',e=>e.preventDefault(),{signal:controller.signal});
  }
  function audioTime(){
    const stamp=context.getOutputTimestamp?.();const age=performance.now()-(stamp?.performanceTime||0);
    return stamp?.contextTime>0 && age>=0 && age<250?Math.min(context.currentTime,stamp.contextTime+age/1000)-LIMITER_DELAY:context.currentTime-(context.outputLatency||0)-(context.baseLatency||0)-LIMITER_DELAY;
  }
  function scheduleGuide(at,from,takeRate,shift,endTick=sequence.endTick){
    const linked=new Set((sequence.legato||[]).map(pair=>pair[1]));const groups=[];
    sequence.notes.forEach((n,i)=>{if(n[2]/sequence.division*60/song.tempo<=from||n[1]>=endTick)return;
      if(linked.has(i)&&groups.length)groups.at(-1).push(n);else groups.push([n]);});
    const wave=context.createPeriodicWave(new Float32Array(6),new Float32Array([0,1,.44,.20,.10,.04]));
    for(const group of groups){const first=group[0],last=group.at(-1),start=at+Math.max(0,first[1]/sequence.division*60/song.tempo-from)/takeRate,end=at+(Math.min(last[2],endTick)/sequence.division*60/song.tempo-from)/takeRate;
      const osc=context.createOscillator(),gain=context.createGain();osc.setPeriodicWave(wave);osc.connect(gain).connect(guide);
      group.forEach((n,i)=>{const t=at+Math.max(0,n[1]/sequence.division*60/song.tempo-from)/takeRate,f=440*2**((n[3]+shift-69)/12);if(!i)osc.frequency.setValueAtTime(f,start);else{osc.frequency.setValueAtTime(440*2**((group[i-1][3]+shift-69)/12),t);osc.frequency.exponentialRampToValueAtTime(f,t+.003);}});
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(1,start+.008);gain.gain.setValueAtTime(1,Math.max(start+.008,end-.025));gain.gain.linearRampToValueAtTime(0,end);osc.start(start);osc.stop(end+.01);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};nodes.push(osc);
    }
  }
  function stopPlayback(){
    melodyPlayer?.cancel();
    for(const click of pendingClicks)click.cancel();pendingClicks.clear();
    playRevision++;pauseBacking();deck?.cancel();metro?.cancel();metro=null;lastMetroTick=-Infinity;cancelAnimationFrame(timer);for(const n of nodes){try{n.stop();}catch{}}nodes=[];playing=null;playbackBuffer=null;updateControls();
  }
  function animate(){
    if(!playing)return;
    let media=null;
    if(playing.kind==="reference"){current=referenceAudio.tick/sequence.endTick*song.duration;updateLiveClicks();}
    else if(playing.ref?.timing){
      const elapsed=Math.max(0,playing.from+audioTime()-playing.at);
      const pass=T.passAt(playing.ref,playing.repeat,elapsed);
      current=T.tickAt(pass.ref,pass.seconds)/sequence.endTick*song.duration;
      if(pass.ref.timing.kind==="recording")media=pass.ref.timing.origin+pass.seconds*pass.ref.rate;
      scheduleNextPass();
    }else current=Math.max(0,Math.min(song.duration,playing.from+(audioTime()-playing.at)*playing.rate));
    followPosition();moveCursor(current,media);
    if(!recording&&(playing.kind==="reference"?referenceAudio.currentTime>=referenceAudio.timeline.end:context.currentTime>=playing.end)){stopPlayback();return;}
    timer=requestAnimationFrame(animate);
  }
  async function play(){
    if(recording || busy || !sourceReady)return;if(playing){stopPlayback();moveCursor(current);return;}
    pauseBacking();
    const songId=song.id,takeId=selected,revision=++playRevision;
    try{busy=true;updateControls();await ensureAudio();const take=currentTake(),r=take?.rate||rate(),shift=displayShift();
      let buffer;if(take){buffer=await context.decodeAudioData(await(await takeWav(take)).arrayBuffer());}
      const loop=take?null:loopRegion(),ref=take?.pitchReference||reference(r,shift,undefined,loop);
      const repeat=loopEnabled&&loop?T.repeatPlan(song,sequence,usingReference()?alignment:null,r,shift,loop).ref:null;
      if(ref.timing?.kind==="recording")await prepareClips(r,shift);
      if(song.id!==songId||selected!==takeId||recording||revision!==playRevision)return;
      const at=context.currentTime+.15;let from=current>=maxPosition()-.01?0:current;
      let offset=from===0?0:ref.timing?T.secondsAt(ref,from/song.duration*sequence.endTick):ref.leadInSeconds+from/r;
      // The cursor may sit in bars a loop skips; start that loop from the top.
      if(offset>=ref.seconds-.05){from=0;offset=0;}
      if(buffer){const node=context.createBufferSource();node.buffer=buffer;node.connect(master);node.start(at,offset+ref.latency);nodes.push(node);playbackBuffer=buffer;}
      if(ref.timing?.kind==="recording")deck.start(at,ref.timing.origin+offset*r,ref.timing.loop?.end??ref.timing.anchors.at(-1)[1],referenceAudio.vocal,referenceAudio.backing,repeat?.timing.origin??null);
      else scheduleGuide(at+(from===0?ref.leadInSeconds:0),from,r,shift,ref.end??sequence.endTick);
      if(ref.timing?.kind==="recording")melodyPlayer.schedule(sequence,ref,at,offset);
      if(ref.timing)scheduleClicks(ref,at,offset);
      playing=ref.timing?{kind:"timed",ref,repeat,nextAt:at+ref.seconds-offset,at,from:offset,rate:r,end:repeat?Infinity:at+ref.seconds-offset}:{at,from,rate:r,end:at+(song.duration-from)/r};updateControls();animate();
    }catch(e){status(e.message,true);}finally{busy=false;updateControls();}
  }
  async function loadTakes(){
    const songKey=key();await store.purgeDeleted(songKey);
    const loaded=await store.list(songKey);if(songKey!==key())return;
    pendingDeletes=loaded.filter(t=>t.deleteAfter>Date.now());clearTimeout(deleteTimer);
    if(pendingDeletes.length)deleteTimer=setTimeout(()=>void loadTakes().catch(e=>status(e.message,true)),Math.max(50,Math.min(...pendingDeletes.map(t=>t.deleteAfter))-Date.now()+30));
    takes=loaded.filter(t=>t.finalized && !t.deleteAfter).sort((a,b)=>b.number-a.number);renderTakes();
    for(const t of takes)if(t.complete && (!P.currentScore(t.pitchScore)||!takeContour(t)))queueAnalysis(t);
  }
  function renderTakes(){
    syncTakeScope();
    const remote=V.visible(reviews,session?.user,showAllTakes,song?.id),count=takes.length+remote.length;
    $("takes").replaceChildren();$("takeCount").textContent=count?`(${count})`:"";$("takeEmpty").hidden=!!count;
    $("localStorageSize").textContent=takes.length?`${(takes.reduce((sum,t)=>sum+t.frames*2,0)/1048576).toFixed(1)} MB local`:"";
    $("undoDelete").hidden=!pendingDeletes.length;$("undoDelete").disabled=!!recording||busy;
    document.querySelectorAll('[data-sort]').forEach(button=>{
      const column=button.dataset.sort,active=takeOrder.column===column,next=P.nextTakeSort(takeOrder,column);
      button.parentElement.setAttribute('aria-sort',active?takeOrder.direction:'none');
      button.setAttribute('aria-label',`${active?`Sorted ${takeOrder.direction}. `:''}Sort by ${P.SORT_COLUMNS[column].label}, ${next.direction}`);
    });
    const comparable=takes.map(t=>P.currentScore(t.pitchScore)?t:{...t,pitchScore:null});
    const dominated=P.dominatedBy(comparable);
    for(const t of [...comparable,...remote].sort((a,b)=>V.compare(a,b,takeOrder))){const row=document.createElement("tr");row.dataset.id=t.id;row.tabIndex=0;row.classList.toggle("selected",t.id===selected);row.setAttribute("aria-selected",String(t.id===selected));
      const better=dominated.get(t.id);row.classList.toggle('is-dominated',!!better);
      row.title=t.remote?`${t.email}; submitted ${new Date(t.createdAt).toLocaleString()}; ${t.rate*100}% speed; transpose ${t.transpose}. Client-reported pitch feedback, not an audition-quality ranking.`:better?`Outscored by take ${better.number}`:t.complete?'':'Interrupted recording; cannot submit';
      row.setAttribute('aria-label',`Review take ${t.number}${row.title?`. ${row.title}`:''}`);
      const score=t.pitchScore,values=[t.remote?t.name:`Take ${t.number}`,score?format(score.coverage*100):"\u2014",format(score?.meanAbsCents),format(score?.medianAbsCents),format(V.within(t))];
      for(const [i,v] of values.entries()){const td=document.createElement("td");td.textContent=v;
        if(i===0&&t.remote){td.textContent='';const identity=document.createElement('span'),avatar=document.createElement('span'),name=document.createElement('span');
          identity.className='take-singer';avatar.className='take-avatar';avatar.textContent=t.name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
          if(t.picture){const img=document.createElement('img');img.src=t.picture;img.alt='';img.referrerPolicy='no-referrer';img.loading='lazy';img.onerror=()=>img.remove();avatar.append(img);}
          name.textContent=t.name;identity.append(avatar,name);td.append(identity);}
        if(i===1)td.title='Written singing time with reliable pitch detection';
        if(i===2||i===3){const value=i===2?score?.meanAbsCents:score?.medianAbsCents;td.title=Number.isFinite(value)?`${value.toFixed(3)} cents absolute pitch-class error; octaves count as the same note`:t.analysing?'Analyzing saved audio':'Not scored';}
        if(i===4)td.title='Tracked singing within 50 cents; not a measure of musical quality';
        row.append(td);}
      const actions=document.createElement("td");const download=document.createElement("button"),del=document.createElement("button");
      download.innerHTML='<i data-lucide="download"></i>';download.title="Download original microphone recording";download.setAttribute("aria-label",`Download take ${t.number}`);
      download.onclick=async e=>{e.stopPropagation();try{const url=URL.createObjectURL(await takeWav(t)),a=document.createElement("a");a.href=url;a.download=`${song.id}-${t.remote?'audition':'take-'+t.number}.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){status(e.message,true);}};
      del.innerHTML='<i data-lucide="trash-2"></i>';del.title="Delete local take; undo for 10 seconds";del.setAttribute("aria-label",`Delete take ${t.number}`);del.disabled=!!recording||busy;
      del.onclick=async e=>{e.stopPropagation();if(recording || busy)return;try{await store.stageDelete(t.song,t.id,Date.now(),{includeFavorites:true});if(t.id===selected){selected=null;stopPlayback();}await loadTakes();renderNotation();renderPitch();updateControls();}catch(err){status(err.message,true);}};
      if(!t.remote){
        const upload=document.createElement('button');upload.dataset.submitTake=t.id;
        upload.innerHTML='<i data-lucide="upload"></i>';
        upload.onclick=e=>{e.stopPropagation();void submit(t.id);};
        actions.append(upload,download,del);
      }else{
        actions.append(download);
        if(t.remote.owner===session?.user?.id){
          const withdraw=document.createElement('button');withdraw.dataset.withdrawTake=t.id;
          withdraw.innerHTML='<i data-lucide="trash-2"></i>';withdraw.title='Withdraw submitted audition';withdraw.setAttribute('aria-label','Withdraw submitted audition');
          withdraw.onclick=e=>{e.stopPropagation();void withdrawSubmission(t);};actions.append(withdraw);
        }
      }
      row.append(actions);
      const choose=()=>void chooseTake(t);row.onclick=choose;row.onkeydown=e=>{if(e.target===row&&(e.key==="Enter"||e.key===" ")){e.preventDefault();choose();}};$("takes").append(row);
    }updateTakeActions();icons();
  }
  const submissionQuery=t=>`owner=${encodeURIComponent(t.remote.owner)}&song=${encodeURIComponent(t.remote.song)}&revision=${t.remote.revision}`;
  async function takeWav(take){
    if(!take.remote)return store.wav(take.id);
    const cached=reviewAudio.get(take.id);if(cached)return cached;
    const response=await fetch(`api.php?action=audio&${submissionQuery(take)}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error('This submission changed or is no longer available. Refresh Takes.');
    const wav=await response.blob();reviewAudio.set(take.id,wav,wav.size);return wav;
  }
  async function chooseTake(take){
    if(recording||busy)return;stopPlayback();
    if(selected===take.id)selected=null;
    else try{
      busy=true;updateControls();
      if(take.remote&&!take.pitchReference){
        if(take.songVersion!==song.version)throw new Error('This audition uses an older excerpt; download it to review the original recording.');
        const data=await request(`detail&${submissionQuery(take)}`),saved=data.review;
        if(saved){if(!V.attach(take,saved))queueAnalysis(take);}
        else{const m=take.remote.metadata,a=m.sourceMode==='recording'?alignment:null,loop=m.seamlessLoop?T.loopRegion(sequence,a,!!a):null;
          take.pitchReference=(m.loopPass?T.repeatPlan(song,sequence,a,m.rate,take.transpose,loop):T.plan(song,sequence,a,m.rate,take.transpose,0,loop)).ref;
          queueAnalysis(take);status('Older submission: rebuilding its pitch contour from audio.');}
      }
      selected=take.id;
    }catch(e){status(e.message,true);}finally{busy=false;}
    renderTakes();renderNotation();renderPitch();updateControls();
  }
  function queueAnalysis(take){
    if(take.analysing)return;take.analysing=true;
    analysisQueue=analysisQueue.then(async()=>{let worker,url;
      try{const cached=takeContour(take);let result;
        if(cached)result={...P.scoreFrames(cached,take.pitchReference,take.frames/take.sampleRate),frames:cached};
        else{await detectorSource();url=URL.createObjectURL(new Blob([P.workerSource(pitchySource)],{type:"text/javascript"}));worker=new Worker(url);
          const wav=await(await takeWav(take)).arrayBuffer();
          result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Pitch analysis timed out; your audio is saved")),60000);worker.onmessage=({data})=>{clearTimeout(timeout);data.error?reject(new Error(data.error)):resolve(data.result);};worker.onerror=e=>{clearTimeout(timeout);reject(new Error(e.message));};worker.postMessage({wav,reference:take.pitchReference,sampleRate:take.sampleRate,includeFrames:true},[wav]);});
        }
        const {frames,...metrics}=result,contour=P.packContour(frames,take);
        if(take.remote){take.pitchScore=metrics;take.pitchContour=contour;takeContours.delete(take);}
        else await store.pitchScore(take.id,take.frames,take.pitchReference,metrics,contour);
        if(take.song===key()||take.remote?.song===song.id){if(!take.remote)takes=takes.map(t=>t.id===take.id?{...t,pitchScore:metrics,pitchContour:contour}:t);renderTakes();drawTrace();updateControls();}
      }catch(e){status(e.message,true);}finally{worker?.terminate();if(url)URL.revokeObjectURL(url);take.analysing=false;}
    });
  }
  async function microphone(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access requires HTTPS or localhost.');
    const devices=await navigator.mediaDevices.enumerateDevices();
    let gtrack=devices.find(d=>d.kind==='audioinput'&&/g[ -]?track/i.test(d.label));
    const device=preferredDevice||gtrack?.deviceId||'';
    const acquire=id=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:{ideal:1},...(id?{deviceId:{exact:id}}:{})},video:false});
    let stream=await acquire(device);
    // Device labels are normally hidden until the first permission grant.
    // Honor an explicit choice; otherwise prefer the requested hardware once visible.
    if(!device){
      gtrack=(await navigator.mediaDevices.enumerateDevices()).find(d=>d.kind==='audioinput'&&/g[ -]?track/i.test(d.label));
      if(gtrack&&stream.getAudioTracks()[0]?.getSettings().deviceId!==gtrack.deviceId){
        stream.getTracks().forEach(t=>t.stop());stream=await acquire(gtrack.deviceId);
      }
    }
    return stream;
  }
  function microphoneFailure(error){
    if(error?.name==='NotAllowedError')return 'Microphone blocked. Allow access in browser settings, then retry.';
    if(['NotFoundError','OverconstrainedError'].includes(error?.name))return 'Microphone unavailable. Choose another input or reconnect it.';
    return 'Microphone could not start. Check its connection and browser permissions.';
  }
  async function refreshMicrophones(){
    const devices=await navigator.mediaDevices.enumerateDevices();
    $("micDevice").replaceChildren(new Option('System default',''));
    devices.filter(d=>d.kind==='audioinput').forEach((d,i)=>$("micDevice").append(new Option(d.label||`Microphone ${i+1}`,d.deviceId)));
    if(preferredDevice&&!Array.from($("micDevice").options).some(o=>o.value===preferredDevice))$("micDevice").append(new Option('Previously selected input (unavailable)',preferredDevice));
    $("micDevice").value=preferredDevice;micCheck.syncSelector($("micDevice"));
  }
  function releaseCheckInput(){
    const owned=checkInput;checkInput=null;
    owned?.source?.disconnect();owned?.stream?.getTracks().forEach(t=>t.stop());
    if(owned?.context.state!=='closed')void owned?.context.close().catch(()=>{});
  }
  async function acquireCheckInput(){
    if(recording)return {source:recording.source,context:recording.micContext,track:recording.stream.getAudioTracks()[0]};
    const owned={context:new AudioContext({latencyHint:'interactive'})};checkInput=owned;
    try{
      await owned.context.resume();owned.stream=await microphone();
      if(checkInput!==owned){owned.stream.getTracks().forEach(t=>t.stop());throw new DOMException('Microphone check closed','AbortError');}
      owned.source=owned.context.createMediaStreamSource(owned.stream);
      const track=owned.stream.getAudioTracks()[0];track.contentHint='music';
      await refreshMicrophones();
      if(checkInput!==owned)throw new DOMException('Microphone check closed','AbortError');
      return {source:owned.source,context:owned.context,track};
    }catch(error){if(checkInput===owned)releaseCheckInput();throw error;}
  }
  async function startRecord(){
    if(recording){await finishRecord(false);return;}if(busy || !sourceReady || recovery)return;
    micCheck.close();
    holdCancel?.();
    pauseBacking();
    busy=true;recordSetup=true;const token=++generation;stopPlayback();selected=null;live=[];current=0;renderNotation();renderPitch();updateControls();
    let stream,capture,journal,source,analyser,micContext,lastCapturedFrame=0;
    try{
      const estimate=await navigator.storage?.estimate?.(),need=reference().seconds*96000*2;
      if(estimate?.quota-estimate?.usage<need+1048576)throw new Error("Browser storage is nearly full. Download or delete unwanted takes first.");
      // Ask for input before downloading/decoding audio. Record needs no prior mic toggle.
      stream=await microphone();
      await refreshMicrophones();
      await store.open();await ensureAudio();
      await detectorSource();
      if(usingReference())await prepareClips(rate());
      // Like the shared player, keep mic capture independent of synth graph churn.
      micContext=new AudioContext({latencyHint:"interactive",sampleRate:48000});await micContext.resume();
      if(token!==generation){stream.getTracks().forEach(t=>t.stop());busy=false;recordSetup=false;updateControls();return;}
      const latency=Math.max(0,Number(stream.getAudioTracks()[0]?.getSettings?.().latency)||0)+(context.baseLatency||0)+(context.outputLatency||0)+LIMITER_DELAY+Number($("latency").value)/1000;
      const r=rate(),shift=transposition();
      const loop=loopRegion(),prepared=T.plan(song,sequence,usingReference()?alignment:null,r,shift,latency,loop),ref=prepared.ref;
      const repeat=loopEnabled&&loop?T.repeatPlan(song,sequence,usingReference()?alignment:null,r,shift,loop).ref:null;
      source=micContext.createMediaStreamSource(stream);
      analyser=micContext.createAnalyser();analyser.fftSize=4096;source.connect(analyser);
      capture=await R.PcmCapture.create(micContext,source,(frame,samples)=>{
        lastCapturedFrame=frame+samples.length;
        const rec=recording;
        if(rec&&rec.journal===journal&&rec.repeat){
          while(lastCapturedFrame>=rec.endFrame){
            const boundary=rec.endFrame;journal.begin(boundary);rec.passIndex++;
            rec.ref=rec.repeat;rec.captureAt=boundary/micContext.sampleRate;
            rec.endFrame=rec.startFrame+Math.round((rec.firstSeconds+rec.passIndex*rec.repeat.seconds)*micContext.sampleRate);
            live=[];
          }
        }
        journal?.append(frame,samples);
      },e=>void finishRecord(false,e.message));
      const at=context.currentTime+.15,captureAt=micContext.currentTime+.15,seconds=ref.seconds+ref.latency+(repeat?0:.15);
      const startFrame=Math.round(captureAt*micContext.sampleRate),endFrame=startFrame+Math.round(seconds*micContext.sampleRate);
      const spec={seconds,rate:r,part:"Melody",label:"Excerpt",pitchReference:ref,leadInSeconds:ref.leadInSeconds,transpose:shift,octave:0,songVersion:song.version};
      journal=new R.TakeJournal(store,key(),repeat?{...spec,seconds:repeat.seconds,pitchReference:repeat,leadInSeconds:repeat.leadInSeconds,initial:spec}:spec,micContext.sampleRate,{
        onError:e=>void finishRecord(false,e.message),onSaved:t=>{if(t.finalized)void loadTakes().catch(e=>status(e.message,true));}});
      recording={stream,capture,journal,ref,repeat,passIndex:0,firstSeconds:seconds,at,captureAt,startFrame,endFrame,source,analyser,micContext,token,captureEnd:()=>lastCapturedFrame};journal.begin(startFrame);
      micContext.onstatechange=()=>{if(recording?.micContext===micContext&&micContext.state!=="running")void finishRecord(false,"Microphone interrupted; please record again.");};
      recording.countIn=new R.CountIn(context,metroGain,prepared.count,b=>{$("count").textContent=String(b.label);},globalThis,at);
      recording.countIn.done.then(()=>{$("count").textContent="";});
      if(usingReference())deck.start(at,prepared.origin,ref.timing.loop?.end??prepared.map.end,referenceAudio.vocal,referenceAudio.backing,repeat?.timing.origin??null);
      else scheduleGuide(at+ref.leadInSeconds,0,r,shift,ref.end);
      if(usingReference())melodyPlayer.schedule(sequence,ref,at);
      scheduleClicks(ref,at);playing={kind:"timed",ref,repeat,nextAt:at+ref.seconds,at,from:0,rate:r,end:repeat?Infinity:at+seconds};
      stream.getAudioTracks().forEach(t=>{t.contentHint="music";t.onended=()=>void finishRecord(false,"Microphone disconnected; the partial take was not submitted");});
      const url=URL.createObjectURL(new Blob([MeleteLivePitch.workerSource(pitchySource)],{type:"text/javascript"}));const worker=new Worker(url);URL.revokeObjectURL(url);
      liveChannel=new MeleteLivePitch.Channel(worker,([freq,clarity],m)=>{if(m.pass!==recording?.passIndex)return;live.push({start:m.time-.02,end:m.time+.02,cents:clarity>.85&&freq>=55&&freq<=1200?(69+12*Math.log2(freq/440))*100:null});drawTrace();},e=>status(e.message,true));
      const input=new Float32Array(4096);
      recording.interval=setInterval(()=>{const rec=recording;if(!rec)return;analyser.getFloatTimeDomainData(input);liveChannel?.submit(input,{sampleRate:micContext.sampleRate,minimum:55,maximum:1200,previous:null},{pass:rec.passIndex,time:micContext.currentTime-rec.captureAt-2048/micContext.sampleRate-rec.ref.latency});scheduleNextPass();if(!rec.repeat&&micContext.currentTime>captureAt+seconds+.06)void finishRecord(true);},30);
      busy=false;renderTakes();renderPitch();updateControls();animate();
    }catch(e){
      if(recording){await finishRecord(false,e.message);return;}
      try{await capture?.stop();}catch{}source?.disconnect();analyser?.disconnect();
      stream?.getTracks().forEach(t=>t.stop());await micContext?.close();busy=false;recordSetup=false;renderNotation();renderPitch();
      const micError=['NotAllowedError','NotFoundError','OverconstrainedError','NotReadableError'].includes(e.name);
      status(micError?microphoneFailure(e):e.message,true);updateControls();
      if(micError){try{await refreshMicrophones();}catch{}if(!$("microphoneCheck").open)$("microphoneCheck").showModal();micCheck.fail(microphoneFailure(e));}
    }
  }
  async function finishRecord(complete,error=""){
    if(!recording)return;const rec=recording;recording=null;busy=true;
    micCheck.close();
    clearInterval(rec.interval);liveChannel?.close();liveChannel=null;rec.countIn.cancel();$("count").textContent="";stopPlayback();updateControls();
    try{await rec.capture.stop();
      const frame=complete?rec.endFrame:Math.max(rec.startFrame,Math.min(rec.endFrame,rec.captureEnd()));
      rec.journal.finish(frame,{discardShortTail:true});await rec.journal.flush();
      if(rec.journal.failed)throw rec.journal.failed;
      await loadTakes();if(complete){selected=takes[0]?.id || null;status(takes[0]?.complete?"Take saved on this device.":"Audio was interrupted. The recoverable recording is saved, but please record a new take to submit.",!takes[0]?.complete);}if(error)status(error,true);
    }catch(e){
      recovery={journal:rec.journal,songId:song.id};$("recovery").hidden=false;
      status(`Local save failed: ${e.message}. Download the recovery recording before reloading.`,true);
    }
    finally{rec.source.disconnect();rec.analyser.disconnect();rec.stream.getTracks().forEach(t=>{t.onended=null;t.stop();});await rec.micContext.close();busy=false;recordSetup=false;renderTakes();renderNotation();renderPitch();updateControls();}
  }
  function updateControls(){
    const active=!!recording,locked=busy||active,valid=!!sourceReady&&!!song?.ready;
    document.querySelectorAll(".song-choice").forEach(button=>{button.disabled=locked||!!recovery;});
    $("play").disabled=locked||!valid;$("rewind").disabled=locked||!valid;$("record").disabled=busy||!valid||!!recovery;
    $("checkMicrophone").disabled=busy;
    $("undoDelete").disabled=locked;
    $("loop").disabled=locked;$("loop").setAttribute('aria-pressed',String(loopEnabled));
    $("record").classList.toggle("recording",active);$("record").querySelector("span").textContent=active?"Stop":"Record";
    $("play").setAttribute("aria-label",playing?"Pause":"Play");$("play").innerHTML=`<i data-lucide="${playing?"pause":"play"}"></i>`;
    for(const id of ["latency","micDevice"])$(id).disabled=locked;
    updateReferenceControls();
    updateTakeActions();
    $("refreshReview").disabled=locked;
    $("signOut").disabled=locked;icons();
  }
  function updateTakeActions(){
    syncTakeScope();
    const locked=busy||!!recording,replace=submissions.some(s=>s.song===song?.id);
    document.querySelectorAll('[data-submit-take]').forEach(button=>{
      const t=takes.find(t=>t.id===button.dataset.submitTake);
      button.disabled=locked||!t?.complete||!P.currentScore(t.pitchScore)||!takeContour(t);
      button.title=replace?`Replace audition with take ${t?.number}`:`Submit take ${t?.number}`;
      button.setAttribute('aria-label',button.title);
    });
    document.querySelectorAll('[data-withdraw-take]').forEach(button=>{button.disabled=locked;});
  }
  function syncTakeScope(){
    const pill=$("takeScope"),locked=busy||!!recording;
    pill.hidden=!session?.user?.admin;pill.setAttribute('aria-disabled',String(locked));
    for(const button of pill.querySelectorAll('button')){
      const active=(button.dataset.scope==='all')===showAllTakes;
      button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;button.disabled=locked;
      if(active&&!pill.hidden){const thumb=pill.querySelector('.pill-thumb');thumb.style.width=`${button.offsetWidth}px`;thumb.style.transform=`translateX(${button.offsetLeft}px)`;}
    }
  }
  function clearHiddenReview(){
    if(selected?.startsWith('submitted:')&&!V.visible(reviews,session?.user,showAllTakes,song?.id).some(t=>t.id===selected)){
      stopPlayback();selected=null;if(sourceReady){renderNotation();renderPitch();}
    }
  }
  function setTakeScope(all){
    if(!session?.user?.admin||busy||recording||showAllTakes===all)return;
    showAllTakes=all;settings();clearHiddenReview();renderTakes();updateControls();
  }
  $("takeScope").onclick=()=>setTakeScope(!showAllTakes);
  $("takeScope").onkeydown=e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();setTakeScope(e.key==='ArrowRight'||e.key==='End');
    $("takeScope").querySelector('[aria-selected="true"]').focus({preventScroll:true});
  };
  function confirmAction(title,text){$("confirmTitle").textContent=title;$("confirmText").textContent=text;$("confirmDialog").showModal();return new Promise(resolve=>{const finish=v=>{$("confirmDialog").close();resolve(v);};$("cancelConfirm").onclick=()=>finish(false);$("acceptConfirm").onclick=()=>finish(true);$("confirmDialog").oncancel=()=>resolve(false);});}
  async function submit(id){
    const take=takes.find(t=>t.id===id);if(!take?.complete||take.remote||busy||recording||!P.currentScore(take.pitchScore)||!takeContour(take))return;if(!session?.user){status("Sign in with Google beside the playback controls to submit.",true);document.querySelector(".account").animate([{boxShadow:"0 0 0 3px var(--accent)"},{boxShadow:"0 0 0 3px transparent"}],{duration:1600,easing:"ease-in"});return;}
    const old=submissions.find(s=>s.song===song.id);
    if(!await confirmAction(old?"Replace this audition?":"Submit this audition?",`Share take ${take.number} for ${song.title} with Diego and Leila. ${old?"It replaces your previous submission only after upload succeeds.":"Other singers cannot hear it."}`))return;
    busy=true;updateControls();stopPlayback();
    try{const wav=new Uint8Array(await(await store.wav(take.id)).arrayBuffer()),chunks=[];
      for(let offset=0;offset<wav.length;offset+=1048576){const block=wav.slice(offset,offset+1048576),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",block))).map(b=>b.toString(16).padStart(2,"0")).join("");await request(`chunk&hash=${hash}`,block,true);chunks.push(hash);status(`Uploading ${Math.min(100,Math.round((offset+block.length)/wav.length*100))}%`);}
      const s=take.pitchScore;await request("submit",{song:song.id,revision:old?.revision||0,chunks,metadata:{songVersion:take.songVersion,rate:take.rate,octave:take.octave,transpose:take.transpose??take.octave??0,sourceMode:take.pitchReference?.timing?.kind||"guide",recordingSha256:take.pitchReference?.timing?.originalSha256||null,loopPass:take.pitchReference?.timing?.loopPass===true,seamlessLoop:!!take.pitchReference?.timing?.loop,continuous:true,review:V.wire(take),stats:{coverage:s.coverage,meanAbsCents:s.meanAbsCents,medianAbsCents:s.medianAbsCents,within50Percent:s.trackedSeconds?s.within50CentsSeconds/s.trackedSeconds*100:null}}});
      await refreshSession();status("Audition submitted. Your local takes are kept.");
    }catch(e){status(e.message,true);}finally{busy=false;updateControls();}
  }
  async function withdrawSubmission(take){
    if(busy||recording||take.remote?.owner!==session?.user?.id)return;
    const old=submissions.find(s=>s.song===take.remote.song);
    if(!old||!await confirmAction('Withdraw audition?','Remove your submitted recording. Your local takes stay on this device.'))return;
    busy=true;updateControls();
    try{await request('withdraw',{song:take.remote.song,revision:old.revision});await refreshSession();}
    catch(e){status(e.message,true);}finally{busy=false;updateControls();}
  }
  // Google's own button sits beside playback, so one click signs in (no dialog). It is
  // initialized again whenever the server issues a new nonce: first load and after sign-out.
  let googleScript=null,googleNonce=null;
  async function showGoogleButton(report=false){
    try{if(!session.clientId)throw new Error("Google sign-in needs server configuration");
      googleScript??=window.google?.accounts?.id?Promise.resolve():new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://accounts.google.com/gsi/client";s.onload=resolve;s.onerror=()=>{s.remove();reject(new Error("Google sign-in could not load"));};document.head.append(s);});
      await googleScript;if(session.user||googleNonce===session.nonce)return;googleNonce=session.nonce;
      google.accounts.id.initialize({client_id:session.clientId,nonce:session.nonce,auto_select:false,callback:async response=>{try{await request("login",{credential:response.credential});await refreshSession();status("Signed in.");}catch(e){status(e.message,true);}}});
      $("googleButton").replaceChildren();google.accounts.id.renderButton($("googleButton"),{type:"icon",theme:"outline",size:"medium",shape:"circle"});
      $("signIn").hidden=true;
    }catch(e){googleScript=googleNonce=null;$("signIn").hidden=!!session.user;$("signIn").title=e.message;if(report)status(e.message,true);}
  }
  async function loadReview(){
    try{const rows=session?.user?(await request(session.user.admin?'review':'list')).submissions:[];
      const previous=new Map(reviews.map(t=>[t.id,t]));
      reviews=rows.map(row=>{const t=V.take(row);return previous.get(t.id)||t;});
      clearHiddenReview();
      renderTakes();updateControls();
    }catch(e){status(e.message,true);}
  }
  $("play").onclick=()=>void play();$("record").onclick=()=>void startRecord();$("rewind").onclick=()=>{seekPosition(0);$("pitchScroll").scrollLeft=0;};
  $("loop").onclick=()=>{if(recording||busy)return;stopPlayback();loopEnabled=!loopEnabled;settings();updateControls();};
  // Local-only script and control are also available through authenticated phone preview.
  if($("beatEdit"))$("beatEdit").hidden=!beatEditor;
  if($("beatExport")){
    $("beatExport").hidden=!beatEditor;
    $("beatExport").onclick=()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify(beatEditor.export(),null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='solstice-beat-edits.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
    };
  }
  if(beatEditor&&$("beatEdit"))$("beatEdit").onclick=()=>{
    beatEditing=beatEditor.enabled=!beatEditing;const label=beatEditing?"Stop editing downbeats":"Edit downbeats";
    $("beatEdit").setAttribute("aria-pressed",String(beatEditing));$("beatEdit").setAttribute("aria-label",label);$("beatEdit").title=label;renderWaveforms();
  };
  $("notation").onscroll=()=>moveCursor(current);
  function staffPosition(e){
    const rect=$("notation").getBoundingClientRect(),x=e.clientX-rect.left+$("notation").scrollLeft,y=e.clientY-rect.top;
    const bar=scoreGeometry.find(b=>x>=b.box.x&&x<=b.box.x+b.box.w&&y>=b.box.y&&y<=b.box.y+b.box.h);
    if(!bar)return current;let tick=bar.anchors[0].tick;
    for(let i=1;i<bar.anchors.length;i++){const a=bar.anchors[i-1],b=bar.anchors[i];if(x<a.x)break;tick=a.tick+Math.max(0,Math.min(1,(x-a.x)/Math.max(1,b.x-a.x)))*(b.tick-a.tick);if(x<=b.x)break;}
    return tick/sequence.endTick*song.duration;
  }
  $("notation").onpointerdown=e=>beginHold(e,ev=>{
    const group=ev.target.closest?.('g[class^="b"]'),id=Array.from(group?.classList||[]).find(c=>/^b\d+$/.test(c))?.slice(1);
    if(id&&scoreNoteIds.has(id))return scoreNoteIds.get(id);
    const rect=$("notation").getBoundingClientRect(),x=ev.clientX-rect.left+$("notation").scrollLeft,y=ev.clientY-rect.top;
    return scoreNotes.find(({box})=>x>=box.x-4&&x<=box.x+box.w+4&&y>=box.y-6&&y<=box.y+box.h+6)?.note;
  },staffPosition);
  $("speed").oninput=()=>{const resume=!!playing;stopPlayback();settings();renderPitch();updateControls();if(resume)void play();};
  $("transpose").oninput=()=>{if(recording||busy||selected){transposePager.setValue(displayShift());return;}
    const next=transposePager.value(),resume=!!playing;stopPlayback();holdCancel?.();transposeBySong[song.id]=next;settings();renderNotation();renderPitch();updateControls();if(resume)void play();};
  $("latency").onchange=settings;$("micDevice").onchange=()=>{preferredDevice=$("micDevice").value;settings();};
  $("mic").onclick=async()=>{$("micSettings").hidden=!$("micSettings").hidden;$("mic").setAttribute('aria-expanded',String(!$("micSettings").hidden));settings();try{await refreshMicrophones();}catch(e){status(e.message,true);}};
  const micCheck=new MeleteMicrophoneCheck.Check({dialog:$("microphoneCheck"),trigger:$("checkMicrophone"),
    acquire:acquireCheckInput,release:releaseCheckInput,refresh:refreshMicrophones,busy:()=>!!recording||busy,
    choose:device=>{preferredDevice=device;$("micDevice").value=device;settings();},failureMessage:microphoneFailure});
  $("display").onclick=()=>{$("displaySettings").hidden=!$("displaySettings").hidden;$("display").setAttribute('aria-expanded',String(!$("displaySettings").hidden));settings();};
  let scaleTimer=0;
  for(const id of ['scale','stretch'])$(id).oninput=()=>{
    settings();holdCancel?.();clearTimeout(scaleTimer);
    scaleTimer=setTimeout(()=>{if(sourceReady){renderNotation();renderPitch();followPosition();}},60);
  };
  async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){status('Full screen is unavailable in this browser.',true);}}
  $("fullscreen").onclick=()=>void toggleFullscreen();$("fullscreen").hidden=!document.fullscreenEnabled;
  document.addEventListener('fullscreenchange',()=>{
    $("fullscreen").setAttribute('aria-label',document.fullscreenElement?'Exit full screen':'Enter full screen');
    $("fullscreen").innerHTML=`<i data-lucide="${document.fullscreenElement?'minimize':'maximize'}"></i>`;icons();
  });
  colourScheme.addEventListener('change',()=>{if(sourceReady){renderNotation();renderWaveforms();}});
  document.querySelectorAll('[data-sort]').forEach(button=>button.onclick=()=>{takeOrder=P.nextTakeSort(takeOrder,button.dataset.sort);settings();renderTakes();});
  $("undoDelete").onclick=async()=>{if(recording||busy)return;try{await store.undoDeletes(key());await loadTakes();updateControls();}catch(e){status(e.message,true);}};
  $("signIn").onclick=()=>void showGoogleButton(true);$("signOut").onclick=async()=>{try{stopPlayback();await request("logout",{});reviewAudio.items.clear();reviewAudio.bytes=0;await refreshSession();}catch(e){status(e.message,true);}};
  $("refreshReview").onclick=()=>void loadReview();
  function setMix(vocal,backing){
    if(playing?.kind==="timed"&&usingReference()){
      referenceAudio.vocal=vocal;referenceAudio.backing=backing;deck.mix(vocal,backing);updateReferenceControls();
    }else referenceAudio.setMix(vocal,backing);
    settings();
  }
  function toggleTrack(index,solo=false){
    const next=M.toggled([referenceAudio.vocal,referenceAudio.backing,metronome,melody],index,solo);
    metronome=next[2];melody=next[3];setMix(next[0],next[1]);applyTrackLevels();settings();
  }
  for(const [index,id] of ['referenceVocal','referenceBacking','metronome','melody'].entries()){
    const button=$(id);let gesture=null;
    const cancel=()=>{if(gesture)clearTimeout(gesture.timer);gesture=null;};
    button.addEventListener('pointerdown',e=>{
      if(e.button!==0||button.disabled)return;cancel();
      gesture={id:e.pointerId,x:e.clientX,y:e.clientY,held:false};button.setPointerCapture(e.pointerId);
      gesture.timer=setTimeout(()=>{gesture.held=true;toggleTrack(index,true);},600);e.preventDefault();
    });
    button.addEventListener('pointermove',e=>{if(gesture&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>8)cancel();});
    button.addEventListener('pointerup',e=>{if(!gesture||gesture.id!==e.pointerId)return;const held=gesture.held;cancel();if(!held)toggleTrack(index);});
    for(const name of ['pointercancel','lostpointercapture'])button.addEventListener(name,cancel);
    window.addEventListener('blur',cancel);
    button.addEventListener('contextmenu',e=>e.preventDefault());
    button.addEventListener('click',e=>{if(e.detail===0)toggleTrack(index,e.shiftKey);});
  }
  function armReferenceEnd(){
    clearTimeout(referenceEndTimer);
    if(playing?.kind!=="reference"||referenceAudio.pending||$("backingAudio").paused)return;
    const remaining=referenceAudio.timeline.end-referenceAudio.currentTime;
    if(remaining<=.01){current=maxPosition();stopPlayback();moveCursor(current);return;}
    referenceEndTimer=setTimeout(armReferenceEnd,Math.max(10,remaining/$("backingAudio").playbackRate*1000));
  }
  for(const event of ["playing","seeked","ratechange"])$("backingAudio").addEventListener(event,armReferenceEnd);
  for(const event of ["pause","waiting"])$("backingAudio").addEventListener(event,()=>clearTimeout(referenceEndTimer));
  $("backingAudio").addEventListener("timeupdate",()=>{if(playing?.kind==="reference"&&referenceAudio.currentTime>=referenceAudio.timeline.end)armReferenceEnd();});
  $("backingAudio").addEventListener("ended",()=>{if(playing?.kind==="reference")stopPlayback();});
  document.addEventListener("keydown",e=>{
    if(e.target.isContentEditable||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT"||
      (e.target.tagName==="INPUT"&&e.target.type!=="range")||document.querySelector("dialog[open]"))return;
    if(e.target.closest("#transpose, #speed, .track-level, .scale-number, #takeScope")&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Enter','0'].includes(e.key))return;
    if(e.key==='Enter'&&e.target.closest('button, #takes tr'))return;
    const el=$("backingAudio");
    if(e.code==="Space"||e.key.toLowerCase()==="k"){e.preventDefault();e.stopPropagation();if(e.repeat)return;
      if(recording)void finishRecord(false);else void play();return;}
    if(e.target.tagName==="INPUT")return;
    if(recording||busy||!sourceReady)return;
    const jump={j:-10,l:10,ArrowLeft:-5,ArrowRight:5}[e.key];
    if(jump!==undefined){e.preventDefault();const map=referenceAudio.timeline;seekPosition(usingReference()?map.tick(map.seconds(current/song.duration*sequence.endTick)+jump)/sequence.endTick*song.duration:current+jump);}
    else if((e.key==="<"||e.key===">")&&!selected){e.preventDefault();speedPager.setValue(Math.max(.5,Math.min(2,rate()+(e.key==="<"?-.25:.25))));$("speed").oninput();}
    else if(e.key==='f'){e.preventDefault();void toggleFullscreen();}
    else if(e.key==="m"){e.preventDefault();setMix(!referenceAudio.vocal&&!referenceAudio.backing,!referenceAudio.vocal&&!referenceAudio.backing);}
    else if(e.key==="ArrowUp"||e.key==="ArrowDown"){e.preventDefault();deck?.volume(Math.max(0,Math.min(1,(deck.level??1)+(e.key==="ArrowUp"?.05:-.05))));}
    else if(/^[0-9]$/.test(e.key)){e.preventDefault();seekPosition(maxPosition()*Number(e.key)/10);}
  },true);
  $("downloadRecovery").onclick=()=>{
    for(const t of recovery?.journal.views()||[]){const wav=recovery.journal.wav(t.id);if(!wav)continue;const url=URL.createObjectURL(wav),a=document.createElement("a");a.href=url;a.download=`${recovery.songId}-recovery.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  };
  $("retryRecovery").onclick=async()=>{if(!recovery)return;try{await recovery.journal.retry();if(recovery.journal.failed)throw recovery.journal.failed;recovery=null;$("recovery").hidden=true;await loadTakes();updateControls();status("Recovered recording saved on this device.");}catch(e){status(e.message,true);}};
  window.addEventListener("beforeunload",e=>{if(recording||busy||recovery){e.preventDefault();e.returnValue="";}});
  window.addEventListener("resize",()=>{revealCurrentSong();updateReferenceControls();if(sourceReady){if(compactNotation!==(window.innerWidth<600))renderNotation();renderPitch();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){holdCancel?.();micCheck.close();if(recording)void finishRecord(false,"Recording interrupted; this partial take cannot be submitted.");}});
  navigator.mediaDevices?.addEventListener('devicechange',()=>void refreshMicrophones().catch(()=>{}));
  async function init(){try{const saved=JSON.parse(localStorage.getItem("melete-audition-settings")||"{}");transposeBySong=Object.fromEntries(Object.entries(saved.transposeBySong||{}).filter(([_,v])=>Number.isInteger(v)&&v>=-12&&v<=12));takeOrder=P.takeSort(saved.takeOrder);metronome=saved.metronome===true;preferredDevice=typeof saved.device==="string"?saved.device:"";if([.5,.75,1,1.25,1.5,1.75,2].includes(saved.speed))speedPager.setValue(saved.speed);if(saved.latency!==undefined)$("latency").value=saved.latency;referenceAudio.vocal=saved.vocal!==false;referenceAudio.backing=saved.backing!==false;
      for(const id of ['scale','stretch'])if(Number.isFinite(Number(saved[id])))scaleControls[id].setValue(Number(saved[id]),false);
      $("micSettings").hidden=saved.micExpanded===false;$("displaySettings").hidden=saved.displayExpanded===false;
      $("mic").setAttribute('aria-expanded',String(!$("micSettings").hidden));$("display").setAttribute('aria-expanded',String(!$("displaySettings").hidden));
    }catch{}
    try{const saved=JSON.parse(localStorage.getItem("melete-audition-settings")||"{}");
      loopEnabled=saved.loopEnabled!==false;
      showAllTakes=saved.showAllTakes===true;
      melody=saved.melody===true;
      trackLevels=M.savedLevels(saved.trackLevels);
      levelControls.forEach((c,i)=>c.setValue(trackLevels[i],false));}catch{}
    void refreshMicrophones().catch(()=>{});
    try{
      [catalog,alignmentCatalog,clipCatalog,waveformCatalog]=await Promise.all(
        ['catalog.json','reference-alignment.json','recording-clips.json','waveforms.json'].map(path=>asset(path,true)));
      await Promise.all([refreshSession(),loadBackings()]);await chooseSong(decodeURIComponent(location.hash.slice(1)));
    }catch(e){status(e.message,true);}icons();}
  setInterval(()=>{if(!document.hidden&&!recording&&!busy)void loadBackings();},45000);
  void init();
})();
