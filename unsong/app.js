/* Buildless reader. No third-party requests, telemetry, accounts or idle animation loop. */
'use strict';
const $ = id => document.getElementById(id);
const audio = $('audio');
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const storageKey = 'tachylexics-unsong-ten-v1';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch {}
saved.weeks ||= {};
let catalog, week, packet, loading = 0, activeWord = null, times = [], wordNodes = new Map();
let attached = true, programmaticUntil = 0, showRemaining = false, lastSave = 0;
let readingBlock = null, scrollTimer, toastTimer, userScrollIntent = 0, mediaToken = 0;
let codec = saved.codec || (audio.canPlayType('audio/ogg; codecs="opus"') ? 'opus' : 'mp3');
let rate = Number(saved.rate) || 1, fontSize = Number(saved.fontSize) || 19, follow = saved.follow !== false;
let previewMode = new URLSearchParams(location.search).get('preview') === 'released' ? 'released' : 'all';
let asOf = new URLSearchParams(location.search).get('asOf') || new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const packetCache = new Map();
// Reuse the Sequences player's glyphs; the legacy storage key preserves saved progress.
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"/></svg>';
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
// Canonical Lucide sun/moon artwork, inlined for offline use.
const themeIcons = {
  light:'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2M20 12h2m-15.66 5.66-1.41 1.41m14.14-14.14-1.41 1.41"/></svg>',
  dark:'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>'
};
const deviceTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const preference = ['light','dark'].includes(saved.theme) ? saved.theme : 'system';
  const theme = preference === 'system' ? (deviceTheme.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#181c1b' : '#f7f5ef';
  const target = theme === 'dark' ? 'light' : 'dark';
  $('theme-toggle').innerHTML = themeIcons[target];
  $('theme-toggle').setAttribute('aria-label','Switch to '+target+' theme');
  $('theme-toggle').title = 'Switch to '+target+' theme';
  $('theme-mode').value = preference;
}
function chooseTheme(theme) { saved.theme = theme; applyTheme(); persist(); }
$('theme-toggle').addEventListener('click',()=>chooseTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('theme-mode').addEventListener('change',()=>chooseTheme($('theme-mode').value));
deviceTheme.addEventListener('change',applyTheme);
applyTheme();
function persist() { try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { toast('Device storage unavailable; progress cannot be saved.'); } }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
function scope() { return !local ? '' : '?' + new URLSearchParams(previewMode === 'all' ? {preview:'all'} : {asOf:asOf}); }
function resource(path) { return path + scope(); }
function duration(s) { s = Math.max(0, Math.round(s || 0)); return s >= 3600 ? Math.floor(s/3600)+':'+String(Math.floor(s%3600/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0') : Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function dateLabel(value, time=false) { return new Intl.DateTimeFormat(undefined, {timeZone:catalog.timeZone,month:'short',day:'numeric', ...(time?{weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}:{})}).format(new Date(value)); }
function discussionDateLabel(value) { return new Intl.DateTimeFormat(undefined, {timeZone:catalog.timeZone,weekday:'short',month:'short',day:'numeric'}).format(new Date(value)); }
function syncPill(id, value, attr) { const parent = $(id), buttons = [...parent.querySelectorAll('button')]; for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset[attr] === value)); const selected=buttons.find(b=>b.dataset[attr]===value); if(!selected) return; const thumb=parent.querySelector('.thumb'); thumb.style.width=selected.offsetWidth+'px'; thumb.style.height=selected.offsetHeight+'px'; thumb.style.transform='translateX('+(selected.offsetLeft-3)+'px)'; }
function safeFetch(path,options) { return fetch(path,options).then(r=>{if(!r.ok) throw Error('Could not load '+path.split('?')[0]+' ('+r.status+').'); return r.json();}); }
function progress() { return saved.weeks[week.id] ||= {}; }
function savePosition() { if (!week) return; const p=progress(); if (audio.src && Number.isFinite(audio.currentTime)) p.time=audio.currentTime; if(readingBlock) p.block=readingBlock; saved.lastWeek=week.id; persist(); }
function displayError(error) { $('status').textContent = error.message || String(error); }
// Pausing, scrubbing or switching files may cancel a queued play request normally.
function displayPlaybackError(error) { if(error?.name !== 'AbortError') displayError(error); }
function currentChapter(t) { if(!week) return null; return week.chapters.findLast(c=>c.start<=t) || week.chapters[0]; }
function updateStats() { if(!week) return; const media=week.audio[codec]; $('codec-detail').textContent=media ? (codec==='opus'?'Opus, 32 kbps mono':'Original-quality MP3 packet')+' · '+(media.bytes/1e6).toFixed(1)+' MB' : 'This format is still being prepared. Reload when encoding finishes.'; $('download').href=media?resource(media.path):'#'; $('download').hidden=!media; }
function setRate(value) { rate=Number(Math.max(.5,Math.min(3,value)).toFixed(2)); audio.playbackRate=rate; saved.rate=rate; const el=$('speed'); el.textContent=rate+'×';el.dataset.value=rate;el.setAttribute('aria-valuenow',rate);persist();updateStats(); }
function setFont(value) { fontSize=Math.max(14,Math.min(28,Math.round(value))); saved.fontSize=fontSize; document.documentElement.style.setProperty('--reader-size',fontSize+'px'); $('font-size').textContent=fontSize;$('font-size').dataset.value=fontSize;$('font-size').setAttribute('aria-valuenow',fontSize);persist(); }
function bindDrag(id, get, set, step, pixels, min, max) {
  const el=$(id);let start=null;
  const commit=v=>{v=Math.min(max,Math.max(min,v));if(Math.abs(v-get())>.00001){set(v);el.dispatchEvent(new Event('input',{bubbles:true}));}};
  el.addEventListener('pointerdown',e=>{if(e.button!==0)return;start={y:e.clientY,v:get(),id:e.pointerId};el.setPointerCapture(e.pointerId);e.preventDefault();});
  el.addEventListener('pointermove',e=>{if(!start)return;commit(start.v+Math.round((start.y-e.clientY)/pixels)*step);});
  const stop=()=>{start=null;};el.addEventListener('pointerup',stop);el.addEventListener('pointercancel',stop);el.addEventListener('lostpointercapture',stop);window.addEventListener('blur',stop);
  el.addEventListener('keydown',e=>{const delta=({ArrowUp:step,ArrowRight:step,ArrowDown:-step,ArrowLeft:-step})[e.key];if(delta){e.preventDefault();commit(get()+delta);}else if(e.key==='Home'){e.preventDefault();commit(min);}else if(e.key==='End'){e.preventDefault();commit(max);}});
}
function renderSchedule() {
  const list=$('schedule-list');list.replaceChildren();
  catalog.weeks.forEach(w=>{
    const button=document.createElement('button');button.className='schedule-week'+(week?.id===w.id?' current':'');button.disabled=!w.available;button.type='button';button.dataset.week=w.id;
    if(week?.id===w.id)button.setAttribute('aria-current','true');
    const left=document.createElement('span'),strong=document.createElement('strong'),date=document.createElement('time'),small=document.createElement('small'),right=document.createElement('span');
    date.dateTime=w.discussionAt;date.textContent=discussionDateLabel(w.discussionAt);strong.append(date);small.textContent=w.label;left.append(strong,small);
    right.className='date';
    if(!w.available){const unlock=document.createElement('small');unlock.textContent='Unlocks '+dateLabel(w.releaseAt);right.append(unlock);}
    if(saved.weeks[w.id]?.done){const done=document.createElement('small');done.textContent='Finished';right.append(done);}
    button.append(left);if(right.childElementCount)button.append(right);button.addEventListener('click',()=>{$('schedule-dialog').close();loadWeek(w.id).catch(displayError);});list.append(button);
  });
  $('release-count').textContent=catalog.weeks.filter(w=>w.available).length+'/10 available';
}
async function loadCatalog(preferred) {
  resetSearch();$('search-open').disabled=true;
  savePosition();audio.pause();const token=++loading;const data=await safeFetch(resource('data/catalog.json'));if(token!==loading)return;
  catalog=data;$('preview').hidden=!(local&&catalog.localOnly);$('clock-label').hidden=previewMode==='all';$('preview-date').value=asOf;syncPill('visibility-pill',previewMode,'mode');
  const hash=location.hash.slice(1).match(/^(week-\d\d)(?:@([\d.]+))?$/);const requested=preferred||hash?.[1]||saved.lastWeek;
  let target=catalog.weeks.find(w=>w.id===requested&&w.available);
  target ||= [...catalog.weeks].reverse().find(w=>w.available&&new Date(w.releaseAt)<=new Date(catalog.clock)) || catalog.weeks.find(w=>w.available);
  renderSchedule();updateSearchScope();$('search-open').disabled=false;
  if(target){await loadWeek(target.id,hash?.[1]===target.id&&hash[2]!==undefined?Number(hash[2]):null);}
  else{
    packet=null;mountReferences();
    week=null;$('reader').replaceChildren();$('week-title').textContent='First packet has not been released';$('week-number').textContent='UNSONG';$('week-number').removeAttribute('datetime');$('finish').hidden=true;$('play').disabled=true;$('share').disabled=true;audio.removeAttribute('src');audio.load();$('chapter-list').replaceChildren();$('status').textContent='Opens '+dateLabel(catalog.weeks[0].releaseAt,true)+'.';
  }
}
async function loadWeek(id, explicitTime=null) {
  const next=catalog.weeks.find(w=>w.id===id&&w.available);if(!next)throw Error('This assignment is not released.');
  clearTimeout(toastTimer);$('toast').hidden=true;
  savePosition();audio.pause();const token=++loading;$('status').textContent='Loading reading…';$('play').disabled=true;$('share').disabled=true;
  const key=next.packet;let data=packetCache.get(key);if(!data){data=await safeFetch(resource(key));packetCache.set(key,data);}if(token!==loading)return;
  week=next;packet=data;readingBlock=null;activeWord=null;attached=true;wordNodes.clear();times=packet.timings;
  $('reader').innerHTML=packet.html;
  // Use the existing source URL on the title itself, keeping packet text and
  // timing anchors intact while removing the separate "Original" row.
  for(const source of $('reader').querySelectorAll('a.source-link')){
    const heading=source.previousElementSibling;if(!heading?.matches('h2[id^="section-"]'))continue;
    source.className='chapter-source';source.title='Read the original chapter (opens in a new tab)';
    source.replaceChildren(...heading.childNodes);heading.append(source);
  }
  for(const node of $('reader').querySelectorAll('[data-w]'))wordNodes.set(Number(node.dataset.w),node);
  for(const [idx] of times)wordNodes.get(idx)?.classList.add('timed');
  mountReferences();
  $('week-number').textContent=discussionDateLabel(week.discussionAt);$('week-number').dateTime=week.discussionAt;$('week-title').textContent=week.label;$('share').disabled=false;
  $('chapter-summary').textContent='Chapters & interludes';$('chapter-list').replaceChildren();
  week.chapters.forEach(c=>{const li=document.createElement('li'),button=document.createElement('button'),time=document.createElement('small');button.textContent=c.label;time.textContent=duration(c.start);button.append(time);button.addEventListener('click',()=>{seek(c.start);$('chapter-details').open=false;$('schedule-dialog').close();scrollToNode($(c.id));});li.append(button);$('chapter-list').append(li);});
  $('chapter-details').open=false;$('finish').hidden=false;$('finish-detail').textContent='The next assignment never starts automatically.';
  const nextWeek=catalog.weeks[week.number];$('next-week').hidden=!nextWeek;$('next-week').disabled=!nextWeek?.available;$('next-week').textContent=nextWeek?.available?'Next assignment':nextWeek?'Next unlocks '+dateLabel(nextWeek.releaseAt):'';
  updateDone();$('alignment-detail').textContent='Word timing coverage: '+(100*week.alignmentCoverage).toFixed(1)+'%. '+(week.addedAlignedWords?week.addedAlignedWords.toLocaleString()+' large-v3 gap fills included. ':'')+'Untimed words are readable but not highlighted or seekable. No interpolated timings.';
  const restoreBlock=explicitTime===null?progress().block:null;
  setAudio(explicitTime??progress().time??0);updateStats();renderSchedule();$('status').textContent=week.audio[codec]?'':'Audio is being prepared; all text is ready.';
  history.replaceState(null,'',location.pathname+location.search+'#'+week.id+(explicitTime!==null?'@'+explicitTime.toFixed(2):''));
  requestAnimationFrame(()=>{if(restoreBlock&&$(restoreBlock))scrollToNode($(restoreBlock),'instant');else window.scrollTo({top:0,behavior:'instant'});});
}
function setAudio(time=0) {
  const media=week.audio[codec];const token=++mediaToken;audio.pause();$('play').disabled=!media;
  if(!media){audio.removeAttribute('src');audio.load();return;}
  const desired=Math.max(0,Math.min(time,media.duration)), url=new URL(resource(media.path),location.href).href;
  audio.src=url;audio.playbackRate=rate;
  const once=()=>{if(token===mediaToken&&audio.src===url){audio.currentTime=desired;audio.playbackRate=rate;updatePlayback();}audio.removeEventListener('loadedmetadata',once);};
  audio.addEventListener('loadedmetadata',once);audio.load();$('seek').max=media.duration;$('seek').value=desired;$('chapter-ticks').replaceChildren();
  for(const c of week.chapters.slice(1)){const tick=document.createElement('i');tick.style.left=(100*c.start/media.duration)+'%';$('chapter-ticks').append(tick);}
  updateStats();updatePlayback();
  if('mediaSession'in navigator){navigator.mediaSession.metadata=new MediaMetadata({title:week.label,artist:'Matt Arnold · Scott Alexander',album:'UNSONG Reading Group'});}
}
function seek(value) { if(!week||!week.audio[codec])return;audio.currentTime=Math.max(0,Math.min(value,Number.isFinite(audio.duration)?audio.duration:week.duration));updatePlayback();savePosition(); }
async function togglePlay() { if(!week||$('play').disabled)return;if(audio.paused){try{await audio.play();}catch(e){displayPlaybackError(e);}}else audio.pause(); }
function scrollToNode(node, behavior='smooth') { if(!node)return;programmaticUntil=performance.now()+900;node.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':behavior}); }
function findWord(t) { let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid][1]<=t*1000)lo=mid+1;else hi=mid;}const row=times[lo-1];return row&&t*1000-row[1]<1800?wordNodes.get(row[0]):null; }
function readingBottom() { return document.querySelector('.transport').getBoundingClientRect().top-16; }
function returnControl() { if(!activeWord||!follow){$('return-audio').hidden=true;return;}const rect=activeWord.getBoundingClientRect();const outside=rect.top<65||rect.bottom>readingBottom();$('return-audio').hidden=!outside||attached;$('return-audio').setAttribute('aria-label',rect.top<65?'Return up to narration':'Return down to narration');$('return-audio').querySelector('svg').style.transform=rect.top<65?'':'rotate(180deg)'; }
function updatePlayback() {
  if(!week)return;const t=audio.currentTime||0,d=week.audio[codec]?.duration||week.duration;
  $('seek').value=t;$('elapsed').textContent=duration(t);
  $('time').textContent=showRemaining?'−'+duration((d-t)/rate):duration(d);
  $('time').setAttribute('aria-label',showRemaining?'Show total audio duration':'Show remaining listening time at '+rate+'×');
  $('time').title=showRemaining?'Remaining at '+rate+'× · tap for total duration':'Total duration · tap for remaining listening time';
  $('seek').setAttribute('aria-valuetext',duration(t)+' of '+duration(d));
  $('seek-progress').style.width=(d>0?100*Math.min(t,d)/d:0)+'%';
  const chapter=currentChapter(t);$('playing-chapter').textContent=chapter?.label||week.label;
  const current=findWord(t);if(current!==activeWord){activeWord?.classList.remove('active');activeWord=current;activeWord?.classList.add('active');if(activeWord&&!audio.paused&&follow&&attached&&!document.hidden){const rect=activeWord.getBoundingClientRect();if(rect.top<70||rect.bottom>readingBottom())scrollToNode(activeWord);}}
  returnControl();if(!audio.paused&&Math.abs(t-lastSave)>5){lastSave=t;savePosition();}
  if('mediaSession'in navigator&&navigator.mediaSession.setPositionState&&d>0){try{navigator.mediaSession.setPositionState({duration:d,position:Math.min(t,d),playbackRate:rate});}catch{}}
}
function updateDone(){if(!week)return;const done=!!progress().done;$('mark-done').textContent=done?'Finished':'Mark finished';$('mark-done').setAttribute('aria-pressed',String(done));}
function syncPlay(){const playing=!audio.paused;$('play').innerHTML=playing?pauseIcon:playIcon;$('play').setAttribute('aria-label',playing?'Pause':'Play');if('mediaSession'in navigator)navigator.mediaSession.playbackState=playing?'playing':'paused';}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Link copied.');}catch{window.prompt('Copy this link:',text);}}

/* Reviewed references travel with each released packet, never with a global spoiler index. */
let referenceNotes = new Map(), referenceFocusNodes = [], referenceOrigin = null;
let referenceSection = null, selectedLookup = '', selectionTimer;
const boundedScore=(value,fallback)=>Number.isInteger(value)&&value>=0&&value<=10?value:fallback;
// Present the meaningful 6–10 source range as 1–5; group the rare lower scores
// at 1 without changing the original, auditable reference records.
const referenceImportance=note=>Math.max(1,Math.min(5,note.usefulness-5));
const referenceDensityLevels=[
  {label:'None',minimumImportance:null},
  {label:'Few',minimumImportance:4},
  {label:'More',minimumImportance:3},
  {label:'All',minimumImportance:1}
];
const legacyUsefulness=boundedScore(saved.referenceUsefulness,8);
let referenceDensity=referenceDensityLevels.findIndex(level=>level.label.toLowerCase()===saved.referenceDensity);
if(referenceDensity<0)referenceDensity=saved.references===false?0:legacyUsefulness>=9?1:legacyUsefulness>=8?2:3;
// One control owns reference density. Retire individual hiding without changing
// reading progress or unrelated settings; old hidden markers reappear normally.
delete saved.referenceConfidence;
delete saved.referenceUsefulness;
delete saved.references;
delete saved.hiddenReferences;
saved.referenceDensity=referenceDensityLevels[referenceDensity].label.toLowerCase();
const referenceKinds = {history:'History / real people',scripture:'Biblical text',tradition:'Religious tradition',literature:'Literature',science:'Science / mathematics',fiction:'Fictional worldbuilding'};
const referenceStatuses = {real:'Real-world source',adapted:'Adapted in Unsong',invented:'Unsong invention',allusion:'Source allusion',uncertain:'Connection uncertain'};
const referenceIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>';
function referenceElement(tag, className, text) {
  const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
function sourceAnchor(source) {
  const url=source.locatorUrl || source.url;
  if(!url || new URL(url).protocol!=='https:')return null;
  const a=referenceElement('a','',source.title);a.href=url;a.target='_blank';a.rel='noopener noreferrer';
  a.dataset.canonicalUrl=source.url;a.dataset.sourceTitle=source.title;a.dataset.passageLocator=source.locator;a.dataset.locatorUrl=url;
  return a;
}
function clearReferenceFocus() {
  referenceFocusNodes.forEach(n=>n.classList.remove('reference-focus'));referenceFocusNodes=[];
  $('reader').querySelector('[aria-current="true"].reference-mark')?.removeAttribute('aria-current');
}
function sectionAtReadingPosition() {
  const headings=[...$('reader').querySelectorAll('h2[id^="section-"]')];
  return (headings.findLast(h=>h.getBoundingClientRect().top<Math.min(innerHeight*.3,240)) || headings[0])?.id;
}
function renderNearby(sectionId) {
  referenceSection=sectionId;
  const chapter=week?.chapters.find(c=>c.id===sectionId);
  $('reference-nearby-label').textContent=chapter?'References · '+chapter.label:'References in this chapter';
  const list=$('reference-nearby-list');list.replaceChildren();
  const seen=new Set();
  const ordered=[...(packet?.referenceOccurrences || [])].sort((a,b)=>{
    const x=referenceNotes.get(a.referenceId),y=referenceNotes.get(b.referenceId);
    return referenceImportance(y)-referenceImportance(x);
  });
  for(const occurrence of ordered){
    if(occurrence.sectionId!==sectionId || seen.has(occurrence.referenceId))continue;
    const note=referenceNotes.get(occurrence.referenceId);if(!note||!referencePasses(note))continue;
    seen.add(occurrence.referenceId);
    const button=referenceElement('button','',note.title);button.type='button';button.dataset.referenceId=note.id;
    button.append(referenceElement('span','reference-list-score',' · Importance '+referenceImportance(note)+'/5'));
    button.addEventListener('click',()=>showReference(note.id,occurrence));list.append(button);
  }
  if(!seen.size)list.append(referenceElement('p','muted small','No references at this level here. Drag Refs upward in the player to show more, or look up a selection.'));
}
function referencePasses(note) {
  return referenceDensity>0 && referenceImportance(note)>=referenceDensityLevels[referenceDensity].minimumImportance;
}
function applyReferenceFilters() {
  for(const marker of $('reader').querySelectorAll('.reference-mark'))marker.hidden=!referencePasses(referenceNotes.get(marker.dataset.referenceId));
  const level=referenceDensityLevels[referenceDensity],control=$('notes-density');
  $('notes-density-value').textContent=level.label;
  control.dataset.value=referenceDensity;control.dataset.importance=level.minimumImportance??'none';
  control.setAttribute('aria-valuenow',referenceDensity);control.setAttribute('aria-valuetext',referenceDensity===0?'No references':level.label+' references');
  if(referenceSection)renderNearby(referenceSection);
}
function setReferenceDensity(value) {
  referenceDensity=Math.max(0,Math.min(3,Math.round(value)));
  saved.referenceDensity=referenceDensityLevels[referenceDensity].label.toLowerCase();
  persist();applyReferenceFilters();
}
function setReferencePanel(open, origin=null) {
  const wasOpen=!$('reference-panel').hidden;
  const anchor=origin?.closest('#reader [id]') || referenceOrigin?.closest('#reader [id]');
  const before=anchor?.isConnected?anchor.getBoundingClientRect().top:null;
  if(origin)referenceOrigin=origin;
  $('reference-panel').hidden=!open;document.body.classList.toggle('references-open',open);
  if(open){attached=false;$('lookup-selection').hidden=true;}
  if(open!==wasOpen && before!==null){
    programmaticUntil=performance.now()+400;
    requestAnimationFrame(()=>{if(anchor?.isConnected)window.scrollBy({top:anchor.getBoundingClientRect().top-before,behavior:'instant'});});
  }
  if(open){$('reference-heading').focus({preventScroll:true});}
  else{
    clearReferenceFocus();
    (referenceOrigin?.isConnected&&!referenceOrigin.hidden?referenceOrigin:$('search-open')).focus({preventScroll:true});
  }
}
function showReference(id, occurrence=null, trigger=null) {
  const note=referenceNotes.get(id);if(!note)return;
  occurrence ||= packet.referenceOccurrences.find(o=>o.referenceId===id && o.sectionId===referenceSection) || packet.referenceOccurrences.find(o=>o.referenceId===id);
  const marker=trigger || $('reader').querySelector('.reference-mark[data-occurrence="'+packet.referenceOccurrences.indexOf(occurrence)+'"]');
  clearReferenceFocus();marker?.setAttribute('aria-current','true');
  if(occurrence && occurrence.firstWord!==null){
    for(let i=occurrence.firstWord;i<=occurrence.lastWord;i++){const n=wordNodes.get(i);if(n){n.classList.add('reference-focus');referenceFocusNodes.push(n);}}
  }
  const detail=$('reference-detail');detail.replaceChildren();detail.dataset.referenceId=id;
  $('reference-heading').textContent=note.title;
  $('reference-heading-scores').hidden=false;
  const importance=referenceImportance(note),value=$('reference-note-importance');
  value.textContent=importance+'/5';value.setAttribute('aria-label',importance+' out of 5');
  const badges=referenceElement('div','reference-badges');
  badges.append(referenceElement('span','reference-badge',referenceKinds[note.kind]));
  const status=referenceElement('span','reference-badge',referenceStatuses[note.status]);status.dataset.status=note.status;badges.append(status);
  detail.append(badges,referenceElement('p','reference-summary',note.summary));
  if(note.inStory){const here=referenceElement('p','reference-story');here.append(referenceElement('strong','','In this passage: '),document.createTextNode(note.inStory));detail.append(here);}
  const sources=referenceElement('ul','reference-source-list');
  for(const source of note.sources){
    const a=sourceAnchor(source);if(!a)continue;
    const url=new URL(a.href),pageLevel=!url.hash && !/biblehub\.com$/.test(url.hostname);
    const locator=(pageLevel?'Full-page link · ':'')+source.locator;
    const li=document.createElement('li');li.append(a,referenceElement('small','',locator));sources.append(li);
  }
  detail.append(sources);
  detail.append(referenceElement('p','reference-footnote','Editorial annotation, not Scott’s. '+(note.verifiedOn?'Source check '+note.verifiedOn:'Suggested reference; source check incomplete')+'. Links open separately; external pages may contain spoilers.'));
  renderNearby(occurrence?.sectionId || sectionAtReadingPosition());setReferencePanel(true,marker);$('reference-panel').scrollTop=0;
}
function mountReferences() {
  clearReferenceFocus();referenceNotes=new Map((packet?.references || []).map(n=>[n.id,n]));referenceOrigin=null;referenceSection=null;
  $('reference-panel').hidden=true;document.body.classList.remove('references-open');
  $('reader').querySelectorAll('.reference-mark').forEach(n=>n.remove());
  (packet?.referenceOccurrences || []).forEach((occurrence,index)=>{
    const note=referenceNotes.get(occurrence.referenceId);if(!note)return;
    const target=occurrence.lastWord===null?$(occurrence.blockId):wordNodes.get(occurrence.lastWord);if(!target)return;
    const marker=sourceAnchor(note.sources[0]);if(!marker)return;
    marker.className='reference-mark';marker.innerHTML=referenceIcon;marker.dataset.referenceId=note.id;marker.dataset.occurrence=index;
    const importance=referenceImportance(note);marker.dataset.importance=importance;
    marker.dataset.tier=importance>=3?'high':importance===1?'low':'medium';
    marker.setAttribute('aria-label','Reference: '+note.title);marker.title=note.title+' · Importance '+importance+'/5 — preview; Ctrl/Cmd-click opens source';
    marker.setAttribute('aria-controls','reference-panel');
    if(occurrence.lastWord===null)target.append(marker);else target.after(marker);
  });
  applyReferenceFilters();
  $('reference-provenance').textContent=JSON.stringify(packet?.references || []);
  selectedLookup='';$('lookup-selection').hidden=true;
}

/* Build the search index only on demand, from the same release-gated packets
   the reader can open. Never fetch a novel-wide index containing future text. */
let searchGeneration=0,searchRun=0,searchBuild=null,searchTimer=null;
let searchMatches=[],searchLimit=40,searchNeedle='';
const searchIndexes=new Map();
function searchFold(text) {
  return text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/ς/g,'σ').replace(/[‘’]/g,"'").replace(/[‐‑‒–—]/g,'-').replace(/\s+/g,' ');
}
// Keep original character offsets for highlighting smart quotes/diacritics
// without replacing the novel's text or altering any word-timing anchors.
function searchProjection(text) {
  let folded='',offset=0;const starts=[],ends=[];
  for(const character of text){
    const value=searchFold(character);
    for(let i=0;i<value.length;i++){
      if(value[i]===' '&&folded.endsWith(' '))continue;
      folded+=value[i];starts.push(offset);ends.push(offset+character.length);
    }
    offset+=character.length;
  }
  return {text:folded,starts,ends};
}
function searchTextSegments(block) {
  const segments=[],walker=document.createTreeWalker(block,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){
    if(node.nodeType===Node.TEXT_NODE)segments.push({node,text:node.textContent});
    else if(node.tagName==='BR')segments.push({node,text:'\n'});
  }
  return segments;
}
function updateSearchScope() {
  const released=catalog?.weeks.filter(w=>w.available)||[],last=released.at(-1);
  const label=local&&catalog?.preview?'readings · all-reading preview':'released reading'+(released.length===1?'':'s');
  $('search-scope').textContent=released.length+' '+label+(last?' · through '+discussionDateLabel(last.discussionAt):'');
}
function cancelSearchWork() {
  clearTimeout(searchTimer);searchRun++;searchBuild?.controller.abort();searchBuild=null;
  $('search-results').setAttribute('aria-busy','false');
}
function resetSearch() {
  cancelSearchWork();searchGeneration++;searchIndexes.clear();searchMatches=[];
  $('search-results').replaceChildren();$('search-more').hidden=true;$('search-retry').hidden=true;
  $('search-status').textContent='';$('search-status').dataset.state='idle';
}
function indexSearchPacket(reading,data) {
  const template=document.createElement('template');template.innerHTML=data.html;
  const entries=[],locations=new Map(),chapters=new Map(reading.chapters.map(c=>[c.id,c]));
  let chapter=null,order=0;
  for(const block of template.content.querySelectorAll('h2[id^="section-"],[id^="block-"]')){
    if(chapters.has(block.id))chapter=chapters.get(block.id);
    if(!chapter)continue;
    const text=searchTextSegments(block).map(part=>part.text).join(''),entry={kind:'text',weekId:reading.id,chapter:chapter.label,sectionId:chapter.id,blockId:block.id,text,order:order++};
    entry.folded=searchFold(text);entries.push(entry);locations.set(block.id,entry);
  }
  const notes=new Map((data.references||[]).map(note=>[note.id,note])),seen=new Set();
  (data.referenceOccurrences||[]).forEach((occurrence,index)=>{
    const note=notes.get(occurrence.referenceId),place=locations.get(occurrence.blockId)||locations.get(occurrence.sectionId);
    const key=occurrence.sectionId+'|'+occurrence.referenceId;
    if(!note||!place||seen.has(key))return;
    seen.add(key);
    const fields=[note.summary,note.inStory,referenceKinds[note.kind],referenceStatuses[note.status],...(note.terms||[]),...(note.sources||[]).flatMap(source=>[source.title,source.locator])].filter(Boolean);
    const text=[note.title,...fields].join('\n');
    entries.push({...place,kind:'reference',referenceId:note.id,occurrence:index,title:note.title,fields,text,folded:searchFold(text)});
  });
  return entries.sort((a,b)=>a.order-b.order||Number(a.kind==='reference')-Number(b.kind==='reference'));
}
function getSearchIndex() {
  if(searchBuild)return searchBuild.promise;
  const readings=catalog.weeks.filter(w=>w.available),generation=searchGeneration,suffix=scope();
  const job={controller:new AbortController()};searchBuild=job;
  job.promise=(async()=>{
    for(const reading of readings){
      if(!searchIndexes.has(reading.id)){
        const data=packetCache.get(reading.packet)||await safeFetch(reading.packet+suffix,{signal:job.controller.signal});
        if(job.controller.signal.aborted||generation!==searchGeneration)throw new DOMException('Search cancelled','AbortError');
        searchIndexes.set(reading.id,indexSearchPacket(reading,data));
        // Yield between packets so typing/closing stays responsive on phones.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(job.controller.signal.aborted||generation!==searchGeneration)throw new DOMException('Search cancelled','AbortError');
    }
    return readings.flatMap(reading=>searchIndexes.get(reading.id));
  })().finally(()=>{if(searchBuild===job)searchBuild=null;});
  return job.promise;
}
function searchSnippet(text,needle) {
  const projection=searchProjection(text),at=projection.text.indexOf(needle),fragment=document.createDocumentFragment();
  const first=at<0?0:projection.starts[at],last=at<0?0:projection.ends[at+needle.length-1];
  const start=Math.max(0,first-75),end=Math.min(text.length,Math.max(last+100,start+190));
  if(start)fragment.append(document.createTextNode('…'));
  let cursor=start,match=at;
  while(match>=0){
    const from=projection.starts[match],to=projection.ends[match+needle.length-1];
    if(from>=end)break;
    if(from>=cursor){fragment.append(document.createTextNode(text.slice(cursor,from)),referenceElement('mark','',text.slice(from,to)));cursor=to;}
    match=projection.text.indexOf(needle,match+needle.length);
  }
  fragment.append(document.createTextNode(text.slice(cursor,end)));
  if(end<text.length)fragment.append(document.createTextNode('…'));
  return fragment;
}
function renderSearchResults() {
  const list=$('search-results');list.replaceChildren();
  for(const entry of searchMatches.slice(0,searchLimit)){
    const reading=catalog.weeks.find(w=>w.id===entry.weekId&&w.available);if(!reading)continue;
    const li=document.createElement('li'),button=referenceElement('button','search-result');button.type='button';
    button.dataset.searchKind=entry.kind;button.dataset.searchWeek=entry.weekId;button.dataset.searchBlock=entry.blockId;
    if(entry.referenceId)button.dataset.searchReference=entry.referenceId;
    button.append(referenceElement('span','search-result-location',discussionDateLabel(reading.discussionAt)+' · '+entry.chapter+(entry.kind==='reference'?' · Reference':'')));
    if(entry.title){const title=referenceElement('span','search-result-title');title.append(searchSnippet(entry.title,searchNeedle));button.append(title);}
    // A title/alias-only match still needs explanatory context, not a repeated
    // keyword. Prefer matching prose; otherwise show the annotation's summary.
    const context=entry.fields?.slice(0,2).find(field=>field.length>40&&searchFold(field).includes(searchNeedle))||entry.fields?.[0]||entry.text;
    const snippet=referenceElement('span','search-result-snippet');snippet.append(searchSnippet(context,searchNeedle));button.append(snippet);
    button.addEventListener('click',()=>openSearchResult(entry).catch(error=>toast(error.message)));
    li.append(button);list.append(li);
  }
  const remaining=searchMatches.length-searchLimit;
  $('search-more').hidden=remaining<=0;$('search-more').textContent='Show '+Math.min(40,remaining)+' more';
}
async function runSearch() {
  clearTimeout(searchTimer);const run=++searchRun,query=$('search-query').value.trim(),needle=searchFold(query).trim();
  $('search-external').hidden=!query;
  $('search-wikipedia').href='https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(query);
  $('search-biblehub').href='https://biblehub.com/biblemenus/search.php?q='+encodeURIComponent(query);
  $('search-results').replaceChildren();$('search-more').hidden=true;$('search-retry').hidden=true;searchLimit=40;
  if(!needle){$('search-status').textContent='Search book text and all reference annotations.';$('search-status').dataset.state='idle';return;}
  $('search-results').setAttribute('aria-busy','true');$('search-status').textContent='Searching released readings…';$('search-status').dataset.state='loading';
  try{
    const entries=await getSearchIndex();if(run!==searchRun||!$('search-dialog').open)return;
    searchNeedle=needle;searchMatches=entries.filter(entry=>entry.folded.includes(needle));
    const passages=searchMatches.filter(entry=>entry.kind==='text').length,references=searchMatches.length-passages;
    $('search-status').textContent=searchMatches.length?passages+' passage'+(passages===1?'':'s')+' · '+references+' reference'+(references===1?'':'s'):'No matches in these readings.';
    $('search-status').dataset.state='ready';renderSearchResults();
  }catch(error){
    if(run!==searchRun||error.name==='AbortError')return;
    $('search-status').textContent='Couldn’t load every released reading. Retry to search the complete set.';
    $('search-status').dataset.state='error';$('search-retry').hidden=false;
  }finally{if(run===searchRun)$('search-results').setAttribute('aria-busy','false');}
}
function openSearch(query) {
  if(!catalog)return;
  if(!$('reference-panel').hidden)setReferencePanel(false);
  attached=false;$('lookup-selection').hidden=true;
  if(query!==undefined)$('search-query').value=query;
  updateSearchScope();$('search-dialog').showModal();$('search-open').setAttribute('aria-expanded','true');
  $('search-query').focus({preventScroll:true});runSearch();
}
function highlightSearchPassage(block,needle) {
  for(const node of $('reader').querySelectorAll('.search-hit'))node.classList.remove('search-hit');
  const segments=searchTextSegments(block),projection=searchProjection(segments.map(part=>part.text).join('')),index=projection.text.indexOf(needle);
  if(index<0)return block;
  const start=projection.starts[index],end=projection.ends[index+needle.length-1];
  let offset=0,target=null;
  for(const {node,text} of segments){
    const next=offset+text.length;
    if(node.nodeType===Node.TEXT_NODE&&offset<end&&next>start){const word=node.parentElement.closest('[data-w]');if(word){word.classList.add('search-hit');target ||= word;}}
    offset=next;
  }
  return target||block;
}
async function openSearchResult(entry) {
  if(!catalog.weeks.some(w=>w.id===entry.weekId&&w.available))return;
  const needle=searchNeedle;$('search-dialog').close();
  if(week?.id!==entry.weekId)await loadWeek(entry.weekId);
  if(week?.id!==entry.weekId)return;
  await new Promise(requestAnimationFrame);attached=false;
  const block=$(entry.blockId)||$(entry.sectionId);if(!block)return;
  const target=entry.kind==='text'?highlightSearchPassage(block,needle):block;
  scrollToNode(target,'instant');readingBlock=block.id;savePosition();
  if(entry.kind==='reference')showReference(entry.referenceId,packet.referenceOccurrences[entry.occurrence]);
  else{$('reader').focus({preventScroll:true});clearReferenceFocus();}
}
$('search-open').addEventListener('click',()=>openSearch());
$('search-from-reference').addEventListener('click',()=>openSearch());
$('search-dialog').addEventListener('close',()=>{cancelSearchWork();$('search-open').setAttribute('aria-expanded','false');});
$('search-query').addEventListener('input',()=>{
  clearTimeout(searchTimer);searchRun++;$('search-results').replaceChildren();$('search-more').hidden=true;
  $('search-status').textContent='';$('search-status').dataset.state='pending';searchTimer=setTimeout(runSearch,140);
});
$('search-form').addEventListener('submit',e=>{e.preventDefault();runSearch();});
$('search-query').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();$('search-dialog').close();}});
$('search-more').addEventListener('click',()=>{searchLimit+=40;renderSearchResults();});
$('search-retry').addEventListener('click',runSearch);
$('reader').addEventListener('click',e=>{
  const marker=e.target.closest('.reference-mark');if(!marker || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button!==0)return;
  e.preventDefault();if(window.getSelection()?.toString())return;
  showReference(marker.dataset.referenceId,packet.referenceOccurrences[Number(marker.dataset.occurrence)],marker);
});
$('references-close').addEventListener('click',()=>setReferencePanel(false));
$('lookup-selection').addEventListener('pointerdown',e=>e.preventDefault());
$('lookup-selection').addEventListener('click',()=>openSearch(selectedLookup));
document.addEventListener('selectionchange',()=>{
  clearTimeout(selectionTimer);selectionTimer=setTimeout(()=>{
    const selection=window.getSelection(),text=selection?.toString().trim() || '';
    const inReader=selection?.anchorNode&&selection?.focusNode&&$('reader').contains(selection.anchorNode)&&$('reader').contains(selection.focusNode);
    if(inReader&&text&&text.length<=180){selectedLookup=text;$('lookup-selection').hidden=false;}
    else $('lookup-selection').hidden=true;
  },120);
});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')&&!$('reference-panel').hidden){e.preventDefault();setReferencePanel(false);}});
for(const name of ['schedule','settings','subscribe']){$(name+'-open').addEventListener('click',()=>{if(name==='schedule')renderSchedule();$(name+'-dialog').showModal();if(name==='schedule')syncPill('visibility-pill',previewMode,'mode');if(name==='settings')syncPill('codec-pill',codec,'codec');});}
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
function chooseVisibility(mode){if(mode===previewMode)return;previewMode=mode;const q=new URLSearchParams({preview:previewMode,...(previewMode==='released'?{asOf}: {})});history.replaceState(null,'','?'+q+location.hash);loadCatalog().catch(displayError);}
$('visibility-pill').addEventListener('click',()=>chooseVisibility(previewMode==='all'?'released':'all'));
$('visibility-pill').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();chooseVisibility(e.key==='ArrowLeft'?'all':'released');}});
$('preview-date').addEventListener('change',()=>{if(!$('preview-date').value)return;asOf=$('preview-date').value;history.replaceState(null,'','?'+new URLSearchParams({preview:'released',asOf})+location.hash);loadCatalog().catch(displayError);});
function chooseCodec(value){if(codec===value)return;const time=audio.currentTime,playing=!audio.paused;codec=value;saved.codec=codec;persist();syncPill('codec-pill',codec,'codec');if(week){setAudio(time);if(playing)audio.play().catch(displayPlaybackError);}}
$('codec-pill').addEventListener('click',()=>chooseCodec(codec==='opus'?'mp3':'opus'));
$('codec-pill').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();chooseCodec(e.key==='ArrowLeft'?'opus':'mp3');}});
$('follow').addEventListener('click',()=>{follow=!follow;saved.follow=follow;persist();$('follow').textContent=follow?'On':'Off';$('follow').setAttribute('aria-pressed',String(follow));attached=follow;returnControl();});
$('play').addEventListener('click',togglePlay);$('back').addEventListener('click',()=>seek(audio.currentTime-15));$('forward').addEventListener('click',()=>seek(audio.currentTime+15));$('time').addEventListener('click',()=>{showRemaining=!showRemaining;updatePlayback();});
let wasPlaying=false;$('seek').addEventListener('pointerdown',()=>{wasPlaying=!audio.paused;audio.pause();});$('seek').addEventListener('input',()=>seek(Number($('seek').value)));$('seek').addEventListener('change',()=>{if(wasPlaying)audio.play().catch(displayPlaybackError);wasPlaying=false;});$('seek').addEventListener('pointercancel',()=>{wasPlaying=false;});
$('return-audio').addEventListener('click',()=>{attached=true;scrollToNode(activeWord);$('return-audio').hidden=true;});
$('mark-done').addEventListener('click',()=>{progress().done=!progress().done;persist();updateDone();renderSchedule();});
$('next-week').addEventListener('click',()=>{const next=catalog.weeks[week.number];if(next?.available)loadWeek(next.id).catch(displayError);});
$('share').addEventListener('click',()=>{if(week)copy(new URL(location.pathname+location.search+'#'+week.id+'@'+audio.currentTime.toFixed(2),location.origin).href);});
$('copy-feed').addEventListener('click',()=>copy($('copy-feed').dataset.feed));
let textDown=null;
$('reader').addEventListener('pointerdown',e=>{textDown={x:e.clientX,y:e.clientY};});
$('reader').addEventListener('click',e=>{const word=e.target.closest('.timed');if(!word||!textDown||Math.hypot(e.clientX-textDown.x,e.clientY-textDown.y)>8||window.getSelection()?.toString())return;const timing=times.find(row=>row[0]===Number(word.dataset.w));if(timing){attached=true;seek(timing[1]/1000);}});
for(const event of ['wheel','touchmove'])window.addEventListener(event,()=>{userScrollIntent=performance.now()+600;if(follow)attached=false;},{passive:true});
window.addEventListener('scroll',()=>{if(performance.now()>programmaticUntil&&performance.now()<userScrollIntent)attached=false;returnControl();clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{const el=document.elementFromPoint(Math.min(innerWidth-20,Math.max(20,innerWidth/2)),Math.min(innerHeight/2,200));const block=el?.closest('#reader [id]');if(block){readingBlock=block.id;savePosition();}},300);},{passive:true});
window.addEventListener('keydown',e=>{const editing=e.target.closest('textarea,[contenteditable=true],input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button])');if(editing||document.querySelector('dialog[open]'))return;if(e.code==='Space'){e.preventDefault();e.stopPropagation();if(!e.repeat)togglePlay();}else if(e.target===document.body&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();seek(audio.currentTime+(e.key==='ArrowLeft'?-15:15));}},{capture:true});
document.addEventListener('pointerup',e=>{const b=e.target.closest('button');if(b)queueMicrotask(()=>b.blur());});
audio.addEventListener('timeupdate',()=>{if(!document.hidden)updatePlayback();});
audio.addEventListener('play',syncPlay);audio.addEventListener('pause',()=>{syncPlay();savePosition();});
audio.addEventListener('ended',()=>{syncPlay();savePosition();toast('Assignment finished. Audio stopped here.');});
audio.addEventListener('error',()=>{if(audio.getAttribute('src')){$('status').textContent='Audio could not load. Try the other format in Reader settings, or reload after encoding finishes.';syncPlay();}});
document.addEventListener('visibilitychange',()=>{savePosition();if(!document.hidden)updatePlayback();});window.addEventListener('pagehide',savePosition);
window.addEventListener('hashchange',()=>{const m=location.hash.match(/^#(week-\d\d)(?:@([\d.]+))?$/);if(m&&catalog)loadWeek(m[1],m[2]===undefined?null:Number(m[2])).catch(displayError);});
window.addEventListener('resize',()=>{syncPill('visibility-pill',previewMode,'mode');if($('settings-dialog').open)syncPill('codec-pill',codec,'codec');});
if('mediaSession'in navigator){for(const[action,handler]of Object.entries({play:()=>audio.play().catch(displayPlaybackError),pause:()=>audio.pause(),seekbackward:d=>seek(audio.currentTime-(d.seekOffset||15)),seekforward:d=>seek(audio.currentTime+(d.seekOffset||15)),seekto:d=>seek(d.seekTime)})){try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}}
bindDrag('speed',()=>rate,setRate,.05,6,.5,3);bindDrag('font-size',()=>fontSize,setFont,1,8,14,28);setRate(rate);setFont(fontSize);$('follow').textContent=follow?'On':'Off';$('follow').setAttribute('aria-pressed',String(follow));
// Keep all four stops reachable downward from the bottom toolbar on a phone.
bindDrag('notes-density',()=>referenceDensity,setReferenceDensity,1,10,0,3);
new ResizeObserver(entries=>{document.documentElement.style.setProperty('--player-height',entries[0].target.getBoundingClientRect().height+'px');}).observe(document.querySelector('.transport'));
loadCatalog().catch(displayError);
