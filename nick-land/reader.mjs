import {clamp, formatTime, nextNick, nickRemaining, wordAt, searchPassages, audioCandidates} from './core.mjs?v=20260907-opus';

const $ = id => document.getElementById(id);
const audio = $('audio');
const store = {
  get(key, fallback = null) { try { return JSON.parse(localStorage.getItem('nickAudio.' + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('nickAudio.' + key, JSON.stringify(value)); } catch {} }
};
const state = {catalog: [], index: null, data: null, row: null, words: [], current: -1,
  query: '', nickSearch: false, nickOnly: false, follow: true, loading: 0, seekTime: null, saveAt: 0,
  sources: [], sourceIndex: 0, mediaAttached: false, playIntent: false, indexPromise: null, indexError: false};
const currentTime = () => state.seekTime ?? (audio.currentTime || 0);
const icons = () => window.lucide?.createIcons();
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
function notice(message) {
  $('notice').textContent = message; $('notice').classList.add('show');
  clearTimeout(notice.timer); notice.timer = setTimeout(() => $('notice').classList.remove('show'), 3000);
}
function setIcon(button, name) {
  button.replaceChildren(); const icon = el('i'); icon.dataset.lucide = name;
  button.append(icon); icons();
}
function marked(node, text, query) {
  if (!query) { node.textContent = text; return; }
  const lower = text.toLocaleLowerCase(), q = query.toLocaleLowerCase();
  let cursor = 0, at;
  while ((at = lower.indexOf(q, cursor)) !== -1) {
    node.append(document.createTextNode(text.slice(cursor, at)), el('mark', '', text.slice(at, at + q.length)));
    cursor = at + q.length;
  }
  node.append(document.createTextNode(text.slice(cursor)));
}
function dateLabel(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
}
function library(open) {
  document.body.classList.toggle('library-open', open);
  $('library-toggle').setAttribute('aria-expanded', String(open));
}
function renderLibrary() {
  const root = $('recordings'); root.replaceChildren();
  const query = state.query;
  let rows = [...state.catalog];
  const sort = $('sort').value;
  rows.sort((a, b) => sort === 'old' ? a.date.localeCompare(b.date) : sort === 'short'
    ? (a.duration ?? Infinity) - (b.duration ?? Infinity) : b.date.localeCompare(a.date));
  const matches = query && state.index ? searchPassages(state.index, query, state.nickSearch) : [];
  let count = 0;
  for (const row of rows) {
    const hits = matches.filter(match => match[0] === row.id);
    const titleMatch = !state.nickSearch && `${row.title} ${row.channel} ${row.date}`.toLowerCase().includes(query.toLowerCase());
    if (query && !hits.length && !titleMatch) continue;
    for (const hit of query && hits.length ? hits.slice(0, 60) : [null]) {
      const button = el('button', 'recording' + (state.row?.id === row.id ? ' selected' : ''));
      button.dataset.id = row.id;
      button.setAttribute('aria-current', String(state.row?.id === row.id));
      const top = el('span', 'recording-top');
      top.append(el('span', '', dateLabel(row.date)), el('span', '', hit ? formatTime(hit[1]) : row.duration ? formatTime(row.duration) : ''));
      const title = el('strong'); marked(title, row.title, query);
      button.append(top, title, el('div', 'channel', row.channel));
      if (hit) {
        const at = hit[3].toLowerCase().indexOf(query.toLowerCase());
        const start = Math.max(0, at - 65), end = Math.min(hit[3].length, at + query.length + 105);
        const excerpt = el('span', 'excerpt');
        marked(excerpt, (start ? '... ' : '') + hit[3].slice(start, end) + (end < hit[3].length ? ' ...' : ''), query);
        button.append(excerpt);
      } else if (row.status !== 'ready') button.append(el('div', 'processing', row.audio ? 'Audio ready · Transcript processing' : 'Processing'));
      button.addEventListener('click', () => { openRecording(row.id, hit?.[1], Boolean(hit)); library(false); });
      root.append(button); count++;
    }
  }
  const ready = state.catalog.filter(row => row.status === 'ready').length;
  $('search-status').textContent = query
    ? state.indexError ? 'Search unavailable. Type again to retry.' : state.index === null
      ? 'Searching transcripts...' : `${matches.length} transcript matches`
    : `${state.catalog.length} recordings · ${ready} transcripts ready`;
  if (!count) root.append(el('div', 'empty', query ? 'No matches found.' : 'No recordings available.'));
}
async function json(url) {
  const response = await fetch(url, {cache:'no-cache'});
  if (!response.ok) throw new Error(`Could not load ${url.split('/').pop()} (${response.status})`);
  return response.json();
}
function loadSearch() {
  if (state.index !== null || state.indexPromise) return;
  state.indexError = false;
  state.indexPromise = json('nick-land/search.json').then(index => { state.index = index; })
    .catch(() => { state.indexError = true; })
    .finally(() => { state.indexPromise = null; renderLibrary(); });
}
function savePosition(force = false) {
  if (!state.row || !Number.isFinite(currentTime())) return;
  if (!force && Date.now() - state.saveAt < 2000) return;
  store.set('position.' + state.row.id, currentTime()); state.saveAt = Date.now();
}
function updateLink() {
  if (!state.row) return;
  const url = new URL(location.href);
  url.searchParams.set('id', state.row.id);
  url.searchParams.set('t', currentTime().toFixed(2));
  if (state.nickOnly) url.searchParams.set('nick', '1'); else url.searchParams.delete('nick');
  return url;
}
function setNickMode(enabled, jump = true) {
  state.nickOnly = Boolean(enabled && state.data?.nickSpeaker && state.data.nickIntervals.length);
  $('nick-only').setAttribute('aria-pressed', String(state.nickOnly));
  store.set('nickOnly', state.nickOnly);
  if (jump && state.nickOnly) enforceNick(true);
  sync();
}
function enforceNick(force = false) {
  if (!state.nickOnly || !state.data || audio.seeking || (!force && audio.paused)) return;
  const target = nextNick(state.data.nickIntervals, currentTime());
  if (target === null) {
    state.playIntent = false; audio.pause(); notice('End of Nick Land\'s turns');
    return;
  }
  if (target - currentTime() > .025) setTime(target);
}
function setTime(target) {
  if (state.mediaAttached && audio.readyState >= 1) { state.seekTime = null; audio.currentTime = target; }
  else state.seekTime = target;
}
function updateDownload() {
  const source = state.sources[state.sourceIndex];
  $('download').hidden = !source;
  if (!source) { $('download').removeAttribute('href'); return; }
  $('download').href = source.src;
  const format = source.type.includes('opus') ? 'Opus' : 'AAC';
  $('download').title = `Download ${format} audio${source.bytes ? ' (' + (source.bytes / 1e6).toFixed(1) + ' MB)' : ''}`;
}
function attachAudio() {
  if (state.mediaAttached) return;
  const source = state.sources[state.sourceIndex];
  if (!source) return;
  state.mediaAttached = true;
  audio.src = source.src;
  audio.playbackRate = store.get('rate', 1);
}
function seek(time, play = false, context = false) {
  if (!state.row?.audio) return;
  const target = clamp(Number(time) || 0, 0, state.row.duration || 0);
  if (context && state.nickOnly && state.data && nextNick(state.data.nickIntervals, target) !== target) {
    setNickMode(false, false); notice('Full conversation');
  }
  setTime(target);
  $('seek').value = String(target); $('elapsed').textContent = formatTime(target);
  savePosition(true); if (play) requestPlay(); sync(true);
}
async function requestPlay() {
  if (!state.row?.audio) { notice('Audio is still processing'); return; }
  if (state.nickOnly && nextNick(state.data.nickIntervals, currentTime()) === null) {
    seek(state.data.nickIntervals[0][0]);
  }
  enforceNick(true);
  state.playIntent = true; attachAudio();
  const token = state.loading, sourceIndex = state.sourceIndex;
  try { await audio.play(); }
  catch (error) {
    if (error.name !== 'AbortError' && token === state.loading && sourceIndex === state.sourceIndex) {
      notice('Playback failed. Try the play button again.');
    }
  }
}
function jumpTurn(direction) {
  const intervals = state.data?.nickIntervals || [];
  const time = currentTime();
  const target = direction > 0 ? intervals.find(([start]) => start > time + .3)
    : [...intervals].reverse().find(([start]) => start < time - 1.5);
  if (target) seek(target[0], !audio.paused);
  else notice(direction > 0 ? 'No later Nick Land turn' : 'First Nick Land turn');
}
function renderTranscript() {
  const root = $('transcript'); root.replaceChildren(); state.words = []; state.current = -1;
  if (!state.data) return;
  const data = state.data;
  const fragment = document.createDocumentFragment();
  for (const passage of data.passages) {
    const section = el('section', 'passage' + (passage.speaker === data.nickSpeaker ? ' nick' : ''));
    section.dataset.start = passage.start;
    const label = el('div', 'speaker-label');
    const stamp = el('button', 'timestamp', formatTime(passage.start));
    stamp.title = 'Play this passage'; stamp.addEventListener('click', () => seek(passage.start, true, true));
    label.append(stamp, el('span', '', data.speakers[passage.speaker] || 'Unassigned'));
    const paragraph = el('p');
    for (let i = passage.first; i <= passage.last; i++) {
      const word = data.words[i];
      const button = el('button', 'word', word[2]);
      button.dataset.index = i; button.tabIndex = i === passage.first ? 0 : -1;
      button.title = `${formatTime(word[0])} · ${data.speakers[word[3]] || 'Unassigned'}`;
      button.addEventListener('click', () => seek(word[0], true, true));
      paragraph.append(button, document.createTextNode(' ')); state.words.push(button);
    }
    section.append(label, paragraph); fragment.append(section);
  }
  root.append(fragment); highlightSearch();
}
function highlightSearch() {
  const q = state.query.toLowerCase();
  for (const word of state.words) word.classList.remove('match');
  if (!q || !state.data) return;
  for (const passage of state.data.passages) {
    const words = state.data.words.slice(passage.first, passage.last + 1);
    const text = words.map(w => w[2]).join(' ').toLowerCase();
    let offset = 0;
    const ranges = []; let start = 0;
    while ((start = text.indexOf(q, start)) !== -1) { ranges.push([start, start + q.length]); start += q.length; }
    words.forEach((word, index) => {
      if (ranges.some(([a, b]) => a < offset + word[2].length && b > offset)) state.words[passage.first + index].classList.add('match');
      offset += word[2].length + 1;
    });
  }
}
function drawTurns() {
  const canvas = $('speaker-track'), bounds = canvas.getBoundingClientRect();
  if (!bounds.width) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * ratio); canvas.height = Math.round(bounds.height * ratio);
  const context = canvas.getContext('2d'); context.scale(ratio, ratio);
  const colors = getComputedStyle(document.body);
  for (const [start, end, speaker] of state.data?.turns || []) {
    context.fillStyle = colors.getPropertyValue(speaker === state.data.nickSpeaker ? '--nick' : '--other');
    context.globalAlpha = speaker === state.data.nickSpeaker ? .8 : .3;
    context.fillRect(start / state.data.duration * bounds.width, 0, Math.max(.4, (end - start) / state.data.duration * bounds.width), bounds.height);
  }
}
async function openRecording(id, time, play = false) {
  const row = state.catalog.find(candidate => candidate.id === id);
  if (!row) return;
  if (state.row?.id === id && state.data) { if (time != null) seek(time, play, true); return; }
  savePosition(true); audio.pause();
  const token = ++state.loading;
  state.row = row; state.data = null; state.current = -1; state.words = [];
  const wantedNick = store.get('nickOnly', false);
  state.nickOnly = false; $('nick-only').disabled = true; $('nick-only').setAttribute('aria-pressed', 'false');
  $('previous').disabled = $('next').disabled = true;
  $('title').textContent = row.title;
  $('recording-meta').textContent = `${dateLabel(row.date)} · ${row.channel}`;
  $('source').href = row.sourceUrl;
  state.sources = audioCandidates(row, type => audio.canPlayType(type));
  state.sourceIndex = 0; state.playIntent = false; updateDownload();
  $('save-transcript').disabled = row.status !== 'ready';
  $('transcript-status').textContent = row.status === 'ready' ? 'Loading transcript...' : 'Transcript processing';
  $('transcript').replaceChildren(el('div', 'empty', row.status === 'ready' ? 'Loading transcript...' : 'Transcript processing'));
  $('seek').max = String(row.duration || 1);
  $('duration').textContent = formatTime(row.duration);
  $('play').disabled = !row.audio;
  $('back').disabled = $('forward').disabled = $('seek').disabled = !row.audio;
  state.seekTime = clamp(Number(time ?? store.get('position.' + id, 0)) || 0, 0, row.duration || 0);
  state.mediaAttached = false;
  // No source is attached until an explicit play action, even for deep links.
  audio.removeAttribute('src'); audio.load(); audio.playbackRate = store.get('rate', 1); sync();
  store.set('lastId', id); renderLibrary(); drawTurns();
  const url = new URL(location.href); url.searchParams.set('id', id); url.searchParams.delete('t');
  history.replaceState(null, '', url);
  try {
    if (row.data) {
      const data = await json(row.data);
      if (token !== state.loading) return;
      state.data = data; renderTranscript();
      const speakers = new Set(data.words.map(w => w[3]).filter(key => !['unassigned','intro'].includes(key))).size;
      $('transcript-status').textContent = data.nickSpeaker
        ? `Auto transcript · ${speakers} speakers · ${data.words.length.toLocaleString()} timed cues`
        : `Auto transcript · Speaker identity review pending`;
      $('transcript-status').title = `${data.transcription || ''}. Speaker labels and word timings are machine-estimated. Overlapping voices remain in the original audio.`;
      $('nick-only').disabled = !data.nickSpeaker;
      $('previous').disabled = $('next').disabled = !data.nickIntervals.length;
      setNickMode(wantedNick, false); drawTurns();
      if (time != null) seek(time, play, true); else sync(true);
    }
    if (play && !row.data) seek(time || 0, true);
    setMedia();
  } catch (error) {
    if (token !== state.loading) return;
    $('transcript-status').textContent = 'Transcript unavailable';
    const message = el('div', 'empty', error.message);
    const retry = el('button', 'toggle', 'Retry'); retry.addEventListener('click', () => openRecording(id, currentTime()));
    message.append(document.createElement('br'), retry); $('transcript').replaceChildren(message);
  }
}
function sync(force = false) {
  enforceNick();
  const current = currentTime();
  if (document.activeElement !== $('seek')) $('seek').value = current;
  $('elapsed').textContent = formatTime(current);
  $('seek').setAttribute('aria-valuetext', `${formatTime(current)} of ${formatTime(state.row?.duration)}`);
  const index = state.data ? wordAt(state.data.words, current) : -1;
  if (index !== state.current) {
    const old = state.words[state.current]; old?.classList.remove('current'); old?.closest('.passage').classList.remove('current-passage');
    state.current = index;
    const active = state.words[index]; active?.classList.add('current'); active?.closest('.passage').classList.add('current-passage');
    if (active && state.follow && !audio.paused) followWord(active, force);
  } else if (force && index >= 0 && state.follow) followWord(state.words[index], true);
  const label = index >= 0 ? state.data.speakers[state.data.words[index][3]] : '';
  $('speaker-now').textContent = state.nickOnly
    ? `Nick · ${formatTime(nickRemaining(state.data.nickIntervals, current) / audio.playbackRate)} left`
    : label || '';
  savePosition();
  if (navigator.mediaSession && audio.duration && Number.isFinite(audio.duration)) {
    try { navigator.mediaSession.setPositionState({duration:audio.duration, playbackRate:audio.playbackRate, position:clamp(current, 0, audio.duration)}); } catch {}
  }
}
let manualUntil = 0;
function followWord(word, force) {
  if (!word || (!force && Date.now() < manualUntil)) return;
  const rect = word.getBoundingClientRect(), box = $('transcript').getBoundingClientRect();
  if (force || rect.top < box.top + 40 || rect.bottom > box.bottom - 50) {
    $('transcript').scrollTo({top:$('transcript').scrollTop + rect.top - box.top - box.height * .35, behavior:force ? 'instant' : 'smooth'});
  }
}
function setRate(value) {
  const rate = Math.round(clamp(value, .5, 3) * 20) / 20;
  audio.playbackRate = rate; store.set('rate', rate);
  $('rate').textContent = rate.toFixed(2) + 'x'; $('rate').setAttribute('aria-valuenow', rate); sync();
}
function setMedia() {
  if (!navigator.mediaSession || !state.row) return;
  navigator.mediaSession.metadata = new MediaMetadata({title:state.row.title, artist:state.row.channel,
    album:'Nick Land Interview Archive', artwork:[{src:new URL('nick-land/portrait.jpg', location.href).href, type:'image/jpeg'}]});
  for (const [action, handler] of Object.entries({play:requestPlay, pause:() => audio.pause(),
    seekbackward:details => seek(currentTime() - (details.seekOffset || 10)),
    seekforward:details => seek(currentTime() + (details.seekOffset || 10)),
    seekto:details => seek(details.seekTime), previoustrack:() => jumpTurn(-1), nexttrack:() => jumpTurn(1)})) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  }
}
function downloadTranscript() {
  if (!state.data) return;
  const d = state.data;
  const lines = [`# ${d.title}`, '', `Source: ${d.sourceUrl}`, `Date: ${d.date}`, '',
    'Automatic transcript and acoustic speaker diarization. Word times and speaker labels may contain errors.', ''];
  for (const p of d.passages) {
    const url = new URL(location.href); url.search = new URLSearchParams({id:d.id, t:String(p.start)});
    lines.push(`### [${formatTime(p.start)}](${url}) - ${d.speakers[p.speaker]}`, '',
      d.words.slice(p.first, p.last + 1).map(w => w[2]).join(' '), '');
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], {type:'text/markdown'}));
  const link = el('a'); link.href = url; link.download = `${d.id}-transcript.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let searchTimer;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer); searchTimer = setTimeout(() => {
    state.query = $('search').value.trim();
    if (state.query) loadSearch();
    renderLibrary(); highlightSearch();
  }, 150);
});
$('sort').addEventListener('change', renderLibrary);
$('nick-search').addEventListener('click', () => {
  state.nickSearch = !state.nickSearch; $('nick-search').setAttribute('aria-pressed', state.nickSearch); renderLibrary();
});
$('library-toggle').addEventListener('click', () => library(!document.body.classList.contains('library-open')));
$('main').addEventListener('click', event => { if (!event.target.closest('#library-toggle')) library(false); });
$('play').addEventListener('click', () => audio.paused ? requestPlay() : audio.pause());
$('back').addEventListener('click', () => seek(currentTime() - 10 * audio.playbackRate));
$('forward').addEventListener('click', () => seek(currentTime() + 10 * audio.playbackRate));
$('previous').addEventListener('click', () => jumpTurn(-1));
$('next').addEventListener('click', () => jumpTurn(1));
$('seek').addEventListener('input', event => seek(Number(event.target.value)));
$('nick-only').addEventListener('click', () => setNickMode(!state.nickOnly));
$('mute').addEventListener('click', () => {
  audio.muted = !audio.muted; setIcon($('mute'), audio.muted ? 'volume-x' : 'volume-2');
  $('mute').setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
});
$('follow').addEventListener('click', () => {
  state.follow = !state.follow; $('follow').setAttribute('aria-pressed', state.follow); manualUntil = 0; sync(true);
});
$('copy').addEventListener('click', async () => {
  const url = updateLink(); if (!url) return;
  try { await navigator.clipboard.writeText(url.href); notice('Timestamp link copied'); }
  catch { const input = el('input'); input.value = url.href; $('notice').append(input); input.select(); document.execCommand('copy'); input.remove(); notice('Timestamp link copied'); }
});
$('save-transcript').addEventListener('click', downloadTranscript);
$('theme').addEventListener('click', () => {
  document.body.classList.toggle('dark'); store.set('dark', document.body.classList.contains('dark')); drawTurns();
});
document.body.classList.toggle('dark', store.get('dark', matchMedia('(prefers-color-scheme: dark)').matches));
let drag = null;
$('rate').addEventListener('pointerdown', event => {
  if (event.button !== 0) return; drag = {y:event.clientY, rate:audio.playbackRate};
  $('rate').setPointerCapture(event.pointerId);
});
$('rate').addEventListener('pointermove', event => {
  if (drag) setRate(drag.rate + Math.round((drag.y - event.clientY) / 16) * .05);
});
for (const name of ['pointerup','pointercancel','lostpointercapture']) $('rate').addEventListener(name, () => { drag = null; });
$('rate').addEventListener('keydown', event => {
  if (['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
    event.preventDefault(); setRate(event.key === 'Home' ? 1 : event.key === 'End' ? 3 : audio.playbackRate + (event.key === 'ArrowUp' ? .05 : -.05));
  }
});
$('transcript').addEventListener('wheel', () => { manualUntil = Date.now() + 8000; }, {passive:true});
$('transcript').addEventListener('touchstart', () => { manualUntil = Date.now() + 8000; }, {passive:true});
$('transcript').addEventListener('keydown', event => {
  if (!event.target.matches('.word') || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const next = state.words[Number(event.target.dataset.index) + (event.key === 'ArrowRight' ? 1 : -1)];
  if (next) { event.target.tabIndex = -1; next.tabIndex = 0; next.focus(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') library(false);
  if (event.metaKey || event.ctrlKey || event.altKey || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); audio.paused ? requestPlay() : audio.pause(); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); seek(currentTime() - 10); }
  if (event.key === 'ArrowRight') { event.preventDefault(); seek(currentTime() + 10); }
});
audio.addEventListener('loadedmetadata', () => {
  if (!state.mediaAttached) return;
  audio.playbackRate = store.get('rate', 1);
  if (state.seekTime !== null) { audio.currentTime = clamp(state.seekTime, 0, audio.duration); state.seekTime = null; }
  sync(true);
});
let timer;
audio.addEventListener('play', () => {
  state.playIntent = true;
  setIcon($('play'), 'pause'); $('play').setAttribute('aria-label', 'Pause'); $('play').title = 'Pause';
  clearInterval(timer); timer = setInterval(sync, 50);
  if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
});
audio.addEventListener('pause', () => {
  if (!audio.error) state.playIntent = false;
  setIcon($('play'), 'play'); $('play').setAttribute('aria-label', 'Play'); $('play').title = 'Play';
  clearInterval(timer); savePosition(true);
  if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
});
audio.addEventListener('timeupdate', () => sync());
audio.addEventListener('seeked', () => { enforceNick(); sync(true); });
audio.addEventListener('ended', () => { state.playIntent = false; savePosition(true); notice('End of recording'); });
audio.addEventListener('error', () => {
  if (!state.mediaAttached || !audio.error) return;
  const resume = state.playIntent;
  state.seekTime = currentTime();
  if (state.sourceIndex + 1 < state.sources.length) {
    state.sourceIndex++; state.mediaAttached = false; updateDownload();
    if (resume) requestPlay();
    else { audio.removeAttribute('src'); audio.load(); }
  } else { state.playIntent = false; notice('Audio unavailable. Reload to retry, or open the original recording.'); }
});
audio.addEventListener('waiting', () => notice('Buffering audio...'));
window.addEventListener('resize', drawTurns);
window.addEventListener('pagehide', () => savePosition(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(true); });
window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search); openRecording(params.get('id'), Number(params.get('t')) || 0);
});
async function init() {
  icons(); setRate(store.get('rate', 1));
  try {
    const catalog = await json('nick-land/catalog.json'); state.catalog = catalog.recordings;
    const hours = state.catalog.reduce((sum, row) => sum + (row.duration || 0), 0) / 3600;
    $('archive-count').textContent = `${state.catalog.length} recordings${hours ? ' · ' + hours.toFixed(1) + ' hours' : ''}`;
    renderLibrary();
    const params = new URLSearchParams(location.search);
    if (params.get('nick') === '1') store.set('nickOnly', true);
    const candidate = params.get('id') || store.get('lastId');
    const id = state.catalog.some(r => r.id === candidate) ? candidate : state.catalog[0]?.id;
    if (id) await openRecording(id, params.has('t') ? Number(params.get('t')) : undefined);
  } catch (error) { $('search-status').textContent = 'Archive unavailable'; $('transcript').replaceChildren(el('div', 'empty', error.message)); }
}
init();
