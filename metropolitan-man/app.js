/* Buildless reader. No third-party requests, telemetry, accounts or idle animation loop. */
'use strict';
const $ = id => document.getElementById(id);
const audio = $('audio');
const local = false;
const storageKey = 'readalong-metropolitan-man-seven-v1';
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
// Advance the existing player, not a second player or a merged recording.
let continuousPlayback = saved.continuousPlayback !== false;
let continuationSerial = 0, transitioning = false, warmedNext = '';

function nextReleasedReading() {
  const index = catalog?.weeks.findIndex(item => item.id === week?.id) ?? -1;
  const next = index >= 0 ? catalog.weeks[index + 1] : null;
  return next?.available && next.audio?.[codec] ? next : null;
}
function cancelContinuation() { ++continuationSerial; }
function syncContinuousPlayback() {
  syncPill('continuous-pill', continuousPlayback ? 'on' : 'off', 'continuous');
  if (!week) return;
  $('finish-detail').textContent = continuousPlayback
    ? nextReleasedReading() ? 'The next released reading plays automatically.' : 'Playback stops at the end of the published chapters.'
    : 'Playback stops at the end of this reading.';
}
function chooseContinuousPlayback(value) {
  continuousPlayback = value;saved.continuousPlayback = value;persist();
  if (!value) { cancelContinuation();if (transitioning) pausePlayback(); }
  syncContinuousPlayback();
}
async function advanceReleasedReading() {
  const next = nextReleasedReading();
  if (!continuousPlayback || !audioControls || !next) return;
  transitioning = true;
  try { await loadWeek(next.id, 0, {autoplay: true}); }
  catch (error) {
    pausePlayback();
    $('status').textContent = 'Next reading could not load. Reconnect and choose it from Readings.';
    console.warn('Continuous playback stopped:', error.message);
  } finally { transitioning = false; }
}
function preloadNextReading() {
  if (!continuousPlayback || !audioControls || !playbackIntent || audio.paused || navigator.onLine === false) return;
  if (expectedAudioDuration() - audio.currentTime > 45) return;
  const next = nextReleasedReading();
  if (!next) return;
  const key = resource(next.packet), audioKey = offlineAudioUrl(next.audio[codec]).href;
  if (warmedNext === audioKey) return;
  warmedNext = audioKey;
  if (!packetCache.has(next.packet)) {
    safeFetch(key, {signal: AbortSignal.timeout(15000)}).then(data => {
      if (data.id === next.id) packetCache.set(next.packet, data);
    }).catch(() => {});
  }
  if (offlineCopy.worker) offlineMessage('metro-preload', {week: next.id, codec}).catch(() => {});
}
$('continuous-pill').addEventListener('click', () => chooseContinuousPlayback(!continuousPlayback));
$('continuous-pill').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();chooseContinuousPlayback(event.key === 'ArrowLeft');
  }
});
$('settings-open').addEventListener('click', () => requestAnimationFrame(syncContinuousPlayback));
window.addEventListener('resize', () => { if ($('settings-dialog').open) syncContinuousPlayback(); });
audio.addEventListener('timeupdate', preloadNextReading);
audio.addEventListener('playing', preloadNextReading);
syncContinuousPlayback();

// Explicit, resumable offline save. Percentages count committed IndexedDB bytes.
const offlineCopy = {status: null, running: false, clearing: false, refresh: 0, job: 0, error: '', worker: null, targetUrl: '', mode: 'single', targetCodec: ''};
const downloadPaths = {
  save: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  done: '<path d="m20 6-11 11-5-5"/>'
};

function offlineAudioUrl(media) {
  const url = new URL(resource(media.path), location.href);
  url.searchParams.set('mc', media.sha256);
  url.searchParams.set('bytes', String(media.bytes));
  return url;
}
function hasOfflineCopy() {
  return week?.audio[codec] && offlineCopy.status?.eligible && offlineCopy.status?.received > 0
    && offlineCopy.status.url === offlineAudioUrl(week.audio[codec]).href;
}
function hasSelectedOfflineAudio() {
  const url = week?.audio[codec] && offlineAudioUrl(week.audio[codec]).href;
  return hasOfflineCopy() || !!offlineCopy.status?.queue?.entries.some(item => item.url === url && item.eligible);
}
function offlineMessage(type, data = {}, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker || !offlineCopy.worker) { reject(new Error('Offline storage is not ready')); return; }
    const channel = new MessageChannel();
    const finish = () => { clearTimeout(timer); channel.port1.close(); };
    const timer = setTimeout(() => { finish(); reject(new Error('Download interrupted; tap to resume')); }, timeout);
    channel.port1.onmessage = event => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.protocol !== 2) reject(new Error('Offline reader updated; reload before downloading'));
      else resolve(event.data);
    };
    worker.postMessage({type, protocol: 2, page: new URL(resource(''), location.href).href, ...data}, [channel.port2]);
  });
}
function paintOffline() {
  const button = $('offline-download'), media = week?.audio[codec], status = offlineCopy.status;
  const current = media && status?.url === offlineAudioUrl(media).href && status.eligible;
  const queue = status?.queue;
  const all = current && queue?.mode === 'all' && queue.codec === codec;
  const bytes = all ? queue.received : current ? status.received : 0;
  const total = all ? queue.total : media?.bytes || 0;
  const complete = all ? queue.complete : current && status.shellReady && bytes === status.total && status.chunks.length === Math.ceil(status.total/status.chunkBytes);
  const percent = complete ? 100 : total ? Math.min(99, Math.floor(100 * bytes/total)) : 0;
  const subject = all ? 'published chapters' : 'this reading';
  const action = offlineCopy.running ? 'Pause download' : complete ? 'Downloaded ' + subject : bytes ? 'Resume offline download' : 'Download for offline listening';
  button.disabled = !media || !offlineCopy.worker || offlineCopy.clearing;
  button.dataset.state = complete ? 'complete' : offlineCopy.running ? 'saving' : bytes ? 'partial' : 'empty';
  button.querySelector('svg').innerHTML = downloadPaths[complete ? 'done' : offlineCopy.running ? 'pause' : 'save'];
  $('offline-percent').textContent = percent + '%';
  button.title = offlineCopy.error || action + ' (' + percent + '% saved)';
  button.setAttribute('aria-label', action + ', ' + percent + '% saved');
  $('offline-remove').hidden = !status?.policy?.url;
  $('offline-detail').textContent = offlineCopy.error || (status?.policy && !current
    ? 'Other audio is saved. A new download replaces it; reading progress is kept.'
    : complete ? 'Available offline: ' + subject + '. ' + (bytes/1e6).toFixed(1) + ' MB saved.'
    : bytes ? (bytes/1e6).toFixed(1) + ' / ' + (total/1e6).toFixed(1) + ' MB saved. ' + (offlineCopy.running ? 'Downloading...' : 'Partial download; tap the arrow to resume.')
    : 'Downloads start only when you choose. Pause or resume with the download arrow.');
  const published = catalog?.weeks.filter(item => item.available && item.audio[codec]) || [];
  const allDone = all && queue.complete && published.every(item => queue.entries.some(entry => entry.url === offlineAudioUrl(item.audio[codec]).href));
  const allButton = $('offline-all');
  allButton.disabled = !media || !offlineCopy.worker || offlineCopy.clearing;
  allButton.textContent = offlineCopy.running && offlineCopy.mode === 'all' ? 'Pause published-chapter download'
    : allDone ? 'All published chapters downloaded' : 'Download all published chapters (' + (published.reduce((sum, item) => sum + item.audio[codec].bytes, 0)/1e6).toFixed(1) + ' MB)';
}

function selectOfflineStatus(status) {
  const url = week?.audio[codec] && offlineAudioUrl(week.audio[codec]).href;
  const entry = status.queue?.entries.find(item => item.url === url);
  return entry ? {...status, ...entry} : {...status, url, received: 0, eligible: false};
}
async function refreshOffline() {
  if (!week?.audio[codec] || offlineCopy.clearing) return;
  const refresh = ++offlineCopy.refresh;
  const url = offlineAudioUrl(week.audio[codec]).href;
  if (offlineCopy.running && (offlineCopy.targetCodec !== codec || (offlineCopy.mode !== 'all' && offlineCopy.targetUrl !== url))) stopOffline();
  if (!offlineCopy.worker) { paintOffline(); return; }
  try {
    const status = await offlineMessage('metro-status', {url});
    if (refresh === offlineCopy.refresh && week?.audio[codec] && url === offlineAudioUrl(week.audio[codec]).href) offlineCopy.status = status;
  } catch (error) { if (refresh === offlineCopy.refresh) offlineCopy.error = error.message; }
  paintOffline();
}
function stopOffline() {
  ++offlineCopy.job;
  offlineCopy.running = false;
  paintOffline();
}
async function toggleOffline(mode = null) {
  if (offlineCopy.clearing) return;
  if (offlineCopy.running) { stopOffline(); return; }
  if (!week?.audio[codec]) return;
  mode ||= offlineCopy.status?.queue?.mode === 'all' && offlineCopy.status.queue.codec === codec ? 'all' : 'single';
  const queue = offlineCopy.status?.queue;
  const allDone = queue?.mode === 'all' && queue.codec === codec && queue.complete
    && catalog.weeks.filter(item => item.available).every(item => item.audio?.[codec] && queue.entries.some(entry => entry.url === offlineAudioUrl(item.audio[codec]).href));
  if (mode === 'all' ? allDone : hasOfflineCopy() && offlineCopy.status.shellReady && offlineCopy.status.received === offlineCopy.status.total) {
    toast('This reading is available offline. Manage it in Settings.');return;
  }
  const id = week.id, format = codec, job = ++offlineCopy.job;
  offlineCopy.mode = mode;offlineCopy.targetCodec = format;
  offlineCopy.targetUrl = offlineAudioUrl(week.audio[codec]).href;
  offlineCopy.running = true;offlineCopy.error = '';paintOffline();
  try {
    await offlineReady;
    if (job !== offlineCopy.job) return;
    // Negotiate before any mutation if an older worker still controls this tab.
    await offlineMessage('metro-status');
    const status = await offlineMessage('metro-prepare', {week: id, codec: format, mode});
    if (job !== offlineCopy.job) return;
    ++offlineCopy.refresh;offlineCopy.status = selectOfflineStatus(status);paintOffline();
    // Fully save sessions in reading order; each gets both Ogg tail chunks first.
    for (const entry of status.queue.entries) {
      const total = Math.ceil(entry.total/entry.chunkBytes);
      const order = [...new Set([0, Math.max(0,total-1), Math.max(0,total-2), ...Array.from({length:total},(_,i)=>i)])];
      const have = new Set(entry.chunks);
      for (const index of order) {
        if (job !== offlineCopy.job || (mode === 'single' && week.id !== id) || codec !== format) break;
        if (have.has(index)) continue;
        const updated = await offlineMessage('metro-chunk', {url: entry.url, index});
        if (job !== offlineCopy.job) break;
        ++offlineCopy.refresh;offlineCopy.status = selectOfflineStatus(updated);
        paintOffline();
      }
      if (job !== offlineCopy.job || codec !== format) break;
    }
    // The initial native stream may predate service-worker control. Rebind only
    // after its metadata has been saved, without changing play/pause intent.
    if (job === offlineCopy.job && audioControls && audio.error) {
      setAudio(playbackPosition());
    }
  } catch (error) {
    if (job === offlineCopy.job) {
      offlineCopy.error = 'Download paused: ' + error.message;
      toast('Partial download kept. Tap the download arrow to resume.');
    }
  } finally {
    if (job === offlineCopy.job) { offlineCopy.running = false; await refreshOffline(); }
  }
}
async function initializeOffline() {
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    offlineCopy.error = 'Offline listening requires HTTPS (or localhost).';return;
  }
  try {
    const registration = await navigator.serviceWorker.register('offline-worker.js', {scope: './', updateViaCache: 'none'});
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('Reload to enable offline listening')); }, 10000);
      function changed() { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); }
      navigator.serviceWorker.addEventListener('controllerchange', changed);
      if (navigator.serviceWorker.controller) changed();
    });
    const expected = new URL('offline-worker.js', location.href).href;
    if (navigator.serviceWorker.controller.scriptURL !== expected) throw new Error('Reader worker is not controlling this page yet');
    offlineCopy.worker = registration.active;
    await refreshOffline();
  } catch (error) { offlineCopy.error = 'Offline listening unavailable: ' + error.message; }
  paintOffline();
}
const offlineReady = initializeOffline();
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => {
  const controller = navigator.serviceWorker.controller;
  if (controller?.scriptURL === new URL('offline-worker.js', location.href).href) {
    offlineCopy.worker = controller;offlineCopy.error = '';refreshOffline();
  }
});
$('offline-download').addEventListener('click', () => toggleOffline());
$('offline-all').addEventListener('click', () => toggleOffline('all'));
$('offline-remove').addEventListener('click', async () => {
  if (offlineCopy.clearing) return;
  stopOffline();
  // Invalidate earlier status reads before mutation; never resurrect a removed
  // queue when an old worker response arrives after the clear response.
  ++offlineCopy.refresh;offlineCopy.clearing = true;paintOffline();
  try { offlineCopy.status = await offlineMessage('metro-clear');offlineCopy.error = ''; }
  catch (error) { offlineCopy.error = error.message; }
  finally { offlineCopy.clearing = false;await refreshOffline();paintOffline(); }
});
let offlineRefreshTimer;
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
  if (!['audio-cache-event','audio-cache-current'].includes(event.data?.type)) return;
  clearTimeout(offlineRefreshTimer);
  offlineRefreshTimer = setTimeout(refreshOffline, 150);
});
window.addEventListener('pagehide', stopOffline);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshOffline(); });
async function refreshOfflineCatalog() {
  if (!catalog?.offlineReading) return;
  const path = resource('data/catalog.json');
  const data = await safeFetch(path).catch(() => null);
  if (data && !data.offlineReading && path === resource('data/catalog.json')) { catalog = data;renderSchedule();updateSearchScope(); }
}
window.addEventListener('online', refreshOfflineCatalog);
$('schedule-open').addEventListener('click', refreshOfflineCatalog);

// The catalog describes the verified full recording. A partial Ogg response
// can look like a shorter, successfully ended file to the browser demuxer.
let lastGoodAudioTime = 0, requestedAudioTime = null, resumeRequested = false;
let recoveryAttempts = 0, recoveryPending = false, playbackFailed = false;
let playbackIntent = false;

function expectedAudioDuration() { return week?.audio[codec]?.duration || week?.duration || 0; }
function boundedAudioTime(value) {
  return Math.max(0, Math.min(Number(value) || 0, expectedAudioDuration()));
}
function audioDurationMatches() {
  return Number.isFinite(audio.duration) && Math.abs(audio.duration - expectedAudioDuration()) <= 1;
}
function playbackPosition() {
  if (deferredAudioTime !== null) return boundedAudioTime(deferredAudioTime);
  if (requestedAudioTime !== null) return boundedAudioTime(requestedAudioTime);
  if (playbackFailed || recoveryPending || !audioDurationMatches()) return lastGoodAudioTime;
  // An erroneous ended event must not replace a useful bookmark with EOF.
  if (audio.ended && lastGoodAudioTime < expectedAudioDuration() - 2) return lastGoodAudioTime;
  return boundedAudioTime(audio.currentTime);
}
function pausePlayback() { cancelContinuation();resumeRequested = false;playbackIntent = false;audio.pause();syncPlay(); }

function recoverAudio(reason, resume = resumeRequested || playbackIntent || !audio.paused) {
  if (!audioControls || !week?.audio[codec] || recoveryPending || playbackFailed) return;
  const position = playbackPosition(), token = mediaToken;
  deferredAudioTime = position;
  requestedAudioTime = position;
  audio.pause();
  resumeRequested = resume;
  if (hasSelectedOfflineAudio() && navigator.onLine === false) {
    playbackFailed = true;
    resumeRequested = false;playbackIntent = false;
    $('status').textContent = 'This part is not downloaded yet. Saved audio is still available; reconnect to finish downloading.';
    syncPlay();savePosition();return;
  }
  if (recoveryAttempts >= 2) {
    playbackFailed = true;
    resumeRequested = false;playbackIntent = false;
    $('status').textContent = 'Audio download interrupted. Press Play to retry from your position.';
    syncPlay();savePosition();return;
  }
  recoveryAttempts++;
  recoveryPending = true;
  $('status').textContent = 'Reconnecting audio at your position…';
  console.warn('Recovering incomplete audio stream:', reason);
  queueMicrotask(() => {
    if (token !== mediaToken || !audioControls) return;
    // First bypass a damaged cached response, then use the independent codec.
    if (recoveryAttempts === 2 && !hasSelectedOfflineAudio()) {
      const other = codec === 'opus' ? 'mp3' : 'opus';
      if (week.audio[other]) { codec = other;syncPill('codec-pill',codec,'codec'); }
    }
    setAudio(position, {resume:resumeRequested});
  });
}

function setAudio(time = 0, recovery = null, autoplay = false) {
  const token = ++mediaToken;
  audio.pause();
  recoveryPending = false;playbackFailed = false;
  resumeRequested = autoplay || !!recovery?.resume;
  playbackIntent = resumeRequested;
  if (!recovery) recoveryAttempts = 0;
  const desired = boundedAudioTime(time);
  deferredAudioTime = desired;requestedAudioTime = desired;lastGoodAudioTime = desired;
  if (!audioControls) {
    resumeRequested = false;audio.removeAttribute('src');delete audio.dataset.week;audio.load();return;
  }
  const media = week.audio[codec];
  $('play').disabled = !media;
  if (!media) { audio.removeAttribute('src');audio.load();return; }
  const url = offlineAudioUrl(media);
  if (recovery) url.searchParams.set('audio-retry',Date.now()+'-'+token);
  audio.dataset.week = week.id;audio.src = url.href;audio.playbackRate = rate;
  audio.addEventListener('loadedmetadata', () => {
    if (token !== mediaToken || audio.src !== url.href) return;
    if (!audioDurationMatches()) { recoverAudio('duration differs from verified recording');return; }
    audio.currentTime = requestedAudioTime ?? desired;
    deferredAudioTime = null;audio.playbackRate = rate;updatePlayback();
    $('status').textContent = '';
    if (resumeRequested) audio.play().catch(error => {
      if (token !== mediaToken) return;
      resumeRequested = false;displayPlaybackError(error);syncPlay();
    });
  }, {once:true});
  audio.load();$('seek').max = media.duration;$('seek').value = desired;$('chapter-ticks').replaceChildren();
  for (const chapter of week.chapters.slice(1)) {
    const tick = document.createElement('i');tick.style.left = (100*chapter.start/media.duration)+'%';$('chapter-ticks').append(tick);
  }
  updateStats();updatePlayback();syncPlay();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({title:week.label,artist:'Eneasz Brodski · Alexander Wales',album:'The Metropolitan Man'});
}

function seek(value) {
  if (!audioControls || !week?.audio[codec]) return;
  const desired = boundedAudioTime(value);
  requestedAudioTime = desired;lastGoodAudioTime = desired;
  if (deferredAudioTime !== null) deferredAudioTime = desired;
  if (playbackFailed || audio.error) {
    const resume = resumeRequested || !audio.paused;
    recoveryAttempts = 0;setAudio(desired,{resume});
  } else if (audio.readyState >= 1 && !audioDurationMatches()) {
    recoverAudio('seek against an incomplete recording');
  } else if (audio.readyState >= 1) audio.currentTime = desired;
  updatePlayback();savePosition();
}

async function togglePlay() {
  if (!audioControls || !week || $('play').disabled) return;
  if (resumeRequested || !audio.paused) { pausePlayback();return; }
  resumeRequested = true;
  if (playbackFailed || audio.error) {
    recoveryAttempts = 0;setAudio(playbackPosition(),{resume:true});return;
  }
  if (audio.readyState < 1) { syncPlay();return; }
  if (!audioDurationMatches()) { recoverAudio('play against an incomplete recording',true);return; }
  try { await audio.play(); } catch (error) { resumeRequested = false;displayPlaybackError(error);syncPlay(); }
}
function startPlayback() {
  if (audioControls && audio.paused && !resumeRequested) return togglePlay();
}

audio.addEventListener('timeupdate', () => {
  if (!audioControls || recoveryPending || playbackFailed || audio.seeking || audio.ended || !audioDurationMatches()) return;
  if (requestedAudioTime !== null && Math.abs(audio.currentTime-requestedAudioTime)>1) return;
  requestedAudioTime = null;lastGoodAudioTime = audio.currentTime;
});
audio.addEventListener('seeked', () => {
  if (recoveryPending || playbackFailed || requestedAudioTime === null || !audioDurationMatches()) return;
  if (Math.abs(audio.currentTime-requestedAudioTime)>1) { recoverAudio('seek did not reach its target');return; }
  lastGoodAudioTime = audio.currentTime;requestedAudioTime = null;
});
audio.addEventListener('playing', () => { resumeRequested = false;playbackIntent = true; });
audio.addEventListener('durationchange', () => {
  if (audio.readyState >= 1 && Number.isFinite(audio.duration) && !audioDurationMatches()) recoverAudio('recording duration changed');
});
audio.addEventListener('ended', () => {
  if (lastGoodAudioTime < expectedAudioDuration()-2 || !audioDurationMatches()) { recoverAudio('premature end of recording');return; }
  const continuePlaying = playbackIntent && continuousPlayback && audioControls && nextReleasedReading();
  resumeRequested = false;playbackIntent = false;syncPlay();savePosition();
  if (continuePlaying) { advanceReleasedReading();return; }
  toast(continuousPlayback ? 'End of the published chapters.' : 'Reading finished. Audio stopped here.');
});
audio.addEventListener('error', () => {
  if (audio.getAttribute('src')) recoverAudio(audio.error?.message || 'media download error');
});

// Some mobile demuxers stall indefinitely instead of emitting a media error
// when an offline seek needs a missing range. Keep the saved target intact.
let audioStallTimer = null, audioStallToken = null;
function watchAudioStall() {
  // Repeated waiting/stalled events must not keep postponing the deadline.
  if (audioStallTimer !== null && audioStallToken === mediaToken) return;
  clearTimeout(audioStallTimer);
  const token = mediaToken, position = audio.currentTime;
  audioStallToken = token;
  audioStallTimer = setTimeout(() => {
    audioStallTimer = null;
    if (token !== mediaToken || !audioControls || playbackFailed || recoveryPending) return;
    if (!audio.seeking && audio.readyState >= 2 && (audio.paused || audio.currentTime > position + .1)) return;
    if (audio.seeking || audio.readyState < 1 || playbackIntent || resumeRequested) recoverAudio('audio request stalled');
  }, navigator.onLine === false ? 1500 : 10000);
}
for (const event of ['loadstart','waiting','stalled','seeking']) audio.addEventListener(event, watchAudioStall);
audio.addEventListener('playing', () => { clearTimeout(audioStallTimer);audioStallTimer = null; });

// Inlined by the Metropolitan adapter; the shared Unsong template is unchanged.
let audioControls = saved.audioControls !== false;
let deferredAudioTime = null;

function syncAudioControls() {
  document.documentElement.dataset.audioControls = audioControls ? 'on' : 'off';
  const transport = document.querySelector('.transport');
  transport.hidden = !audioControls;
  $('audio-settings').hidden = !audioControls;
  syncPill('audio-controls-pill', audioControls ? 'on' : 'off', 'controls');
  document.documentElement.style.setProperty('--player-height',
    (audioControls ? transport.getBoundingClientRect().height : 0) + 'px');
  if (!audioControls) $('return-audio').hidden = true;
}

function chooseAudioControls(visible) {
  if (visible === audioControls) return;
  pausePlayback();
  savePosition();
  const position = deferredAudioTime ?? (week && audio.dataset.week === week.id ? audio.currentTime : 0);
  audioControls = visible;
  saved.audioControls = visible;
  syncAudioControls();
  if (week) setAudio(position);
  updatePlayback();
  persist();
}

// The entire two-option capsule toggles once, including its selected half.
$('audio-controls-pill').addEventListener('click', () => chooseAudioControls(!audioControls));
$('audio-controls-pill').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    chooseAudioControls(event.key === 'ArrowLeft');
  }
});
$('settings-open').addEventListener('click', () => {
  requestAnimationFrame(syncAudioControls);
});
window.addEventListener('resize', () => {
  if ($('settings-dialog').open) syncAudioControls();
});
syncAudioControls();

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
function scope() { const through=new URLSearchParams(location.search).get('through'); if(local&&through)return '?'+new URLSearchParams({through}); return !local ? '' : '?' + new URLSearchParams(previewMode === 'all' ? {preview:'all'} : {asOf:asOf}); }
function resource(path) { return path + scope(); }
function duration(s) { s = Math.max(0, Math.round(s || 0)); return s >= 3600 ? Math.floor(s/3600)+':'+String(Math.floor(s%3600/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0') : Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function dateLabel(value, time=false) { return new Intl.DateTimeFormat(undefined, {timeZone:catalog.timeZone,month:'short',day:'numeric', ...(time?{weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}:{})}).format(new Date(value)); }
function discussionDateLabel(value, number) { if(!value)return number?'Reading '+number:'Date not set'; return new Intl.DateTimeFormat(undefined, {timeZone:catalog.timeZone,weekday:'short',month:'short',day:'numeric'}).format(new Date(value)); }
function syncPill(id, value, attr) { const parent = $(id), buttons = [...parent.querySelectorAll('button')]; for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset[attr] === value)); const selected=buttons.find(b=>b.dataset[attr]===value); if(!selected) return; const thumb=parent.querySelector('.thumb'); thumb.style.width=selected.offsetWidth+'px'; thumb.style.height=selected.offsetHeight+'px'; thumb.style.transform='translateX('+(selected.offsetLeft-3)+'px)'; }
function safeFetch(path,options) { return fetch(path,options).then(r=>{if(!r.ok) throw Error('Could not load '+path.split('?')[0]+' ('+r.status+').'); return r.json();}); }
function progress() { return saved.weeks[week.id] ||= {}; }
function savePosition() { if (!week) return; const p=progress(); if (audio.dataset.week===week.id && audio.src && Number.isFinite(audio.currentTime)) p.time=playbackPosition(); if(readingBlock) p.block=readingBlock; saved.lastWeek=week.id; persist(); }
function displayError(error) { $('status').textContent = error.message || String(error); }
// Pausing, scrubbing or switching files may cancel a queued play request normally.
function displayPlaybackError(error) { if(error?.name !== 'AbortError') displayError(error); }
function currentChapter(t) { if(!week) return null; return week.chapters.findLast(c=>c.start<=t) || week.chapters[0]; }
function updateStats() { if(!week) return; const media=week.audio[codec]; $('codec-detail').textContent=media ? (codec==='opus'?'Opus, 32 kbps mono':'MP3, 96 kbps mono')+' · '+(media.bytes/1e6).toFixed(1)+' MB' : 'This format is still being prepared. Reload when encoding finishes.'; refreshOffline(); }
function setRate(value) { rate=Number(Math.max(.5,Math.min(3,value)).toFixed(2)); audio.playbackRate=rate; saved.rate=rate; const el=$('speed'); el.textContent=rate+'×';el.dataset.value=rate;el.setAttribute('aria-valuenow',rate);persist();updateStats(); }
function setFont(value) { fontSize=Math.max(14,Math.min(28,Math.round(value))); saved.fontSize=fontSize; document.documentElement.style.setProperty('--reader-size',fontSize+'px'); $('font-size').textContent=fontSize;$('font-size').dataset.value=fontSize;$('font-size').setAttribute('aria-valuenow',fontSize);persist(); }
function bindDrag(id, get, set, step, pixels, min, max, clickStep) {
  const el = $(id);
  let gesture = null;
  const commit = value => {
    value = Math.min(max, Math.max(min, value));
    if (Math.abs(value - get()) > .00001) {
      set(value);
      el.dispatchEvent(new Event('input', {bubbles: true}));
    }
  };
  const inside = event => {
    const box = el.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX < box.right &&
      event.clientY >= box.top && event.clientY < box.bottom;
  };
  const release = () => {
    const previous = gesture;
    gesture = null;
    if (previous && el.hasPointerCapture(previous.id)) {
      el.releasePointerCapture(previous.id);
    }
    return previous;
  };
  const cancel = event => {
    if (!gesture || (event?.pointerId !== undefined && event.pointerId !== gesture.id)) return;
    const previous = release();
    // OS navigation gestures can cancel a captured touch after several moves.
    // Restore both the displayed rate and its persisted preference in that case.
    commit(previous.value);
  };
  const move = event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (el.disabled || (event.type === 'pointermove' && gesture.pointerType === 'mouse' && !(event.buttons & 1))) {
      cancel(event);
      return;
    }
    const dx = event.clientX - gesture.x;
    const dy = gesture.y - event.clientY;
    gesture.moved ||= Math.hypot(dx, dy) >= gesture.threshold;
    if (gesture.moved) commit(gesture.value + Math.round(dy / pixels) * step);
  };
  el.addEventListener('pointerdown', event => {
    if (gesture || el.disabled || event.button !== 0 || event.isPrimary === false || !inside(event)) return;
    gesture = {
      id: event.pointerId, pointerType: event.pointerType,
      x: event.clientX, y: event.clientY, value: get(), moved: false,
      threshold: event.pointerType === 'mouse' ? 2 : 8
    };
    try { el.setPointerCapture(event.pointerId); }
    catch { gesture = null; return; }
    event.preventDefault();
  });
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    move(event);
    const previous = release();
    if (previous && !previous.moved && !el.disabled && inside(event)) commit(previous.value + clickStep);
    event.preventDefault();
  });
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('lostpointercapture', cancel);
  window.addEventListener('blur', cancel);
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  el.addEventListener('click', event => {
    // Pointer activation is handled on release; only keyboard/AT clicks act here.
    if (!gesture && !el.disabled && event.detail === 0 && !event.pointerType) commit(get() + clickStep);
  });
  el.addEventListener('keydown', event => {
    const delta = {ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step}[event.key];
    if (el.disabled || (!delta && !['Home', 'End'].includes(event.key))) return;
    event.preventDefault();
    cancel();
    commit(event.key === 'Home' ? min : event.key === 'End' ? max : get() + delta);
  });
}

function renderSchedule() {
  $('schedule-status').textContent=catalog.scheduleStatus;
  const list=$('schedule-list');list.replaceChildren();
  catalog.weeks.forEach(w=>{
    const button=document.createElement('button');button.className='schedule-week'+(week?.id===w.id?' current':'');button.disabled=!w.available;button.type='button';button.dataset.week=w.id;
    if(week?.id===w.id)button.setAttribute('aria-current','true');
    const left=document.createElement('span'),strong=document.createElement('strong'),date=document.createElement('time'),small=document.createElement('small'),right=document.createElement('span');
    if(w.discussionAt)date.dateTime=w.discussionAt;date.textContent=discussionDateLabel(w.discussionAt,w.number);strong.append(date);small.textContent=w.label;left.append(strong,small);
    right.className='date';
    const words=document.createElement('small'),minutes=document.createElement('small');
    words.textContent=w.words.toLocaleString()+' words';
    minutes.textContent=Math.round(w.readingMinutes)+' min read'+(Number.isFinite(w.duration)?' · '+Math.round(w.duration/60)+' min listen':'');
    right.append(words,minutes);
    if(!w.available){const unlock=document.createElement('small');unlock.textContent=catalog.offlineReading?'Not saved offline':w.releaseAt?'Unlocks '+dateLabel(w.releaseAt):'Not released yet';right.append(unlock);}
    if(saved.weeks[w.id]?.done){const done=document.createElement('small');done.textContent='Finished';right.append(done);}
    button.append(left);if(right.childElementCount)button.append(right);button.addEventListener('click',()=>{$('schedule-dialog').close();loadWeek(w.id).catch(displayError);});list.append(button);
  });
  $('release-count').textContent=catalog.weeks.filter(w=>w.available).length+'/'+catalog.weeks.length+' available';
}
async function loadCatalog(preferred) {
  resetSearch();$('search-open').disabled=true;
  savePosition();pausePlayback();const token=++loading;const data=await safeFetch(resource('data/catalog.json'));if(token!==loading)return;
  catalog=data;$('preview').hidden=!(local&&catalog.localOnly);$('clock-label').hidden=!catalog.scheduleConfigured||previewMode==='all';$('preview-date').value=asOf;syncPill('visibility-pill',previewMode,'mode');
  const hash=location.hash.slice(1).match(/^(week-\d\d)(?:@([\d.]+))?$/);const requested=preferred||hash?.[1];
  let target=catalog.weeks.find(w=>w.id===requested&&w.available);
  target ||= catalog.weeks.findLast(w=>w.available);
  renderSchedule();updateSearchScope();$('search-open').disabled=false;
  if(target){await loadWeek(target.id,hash?.[1]===target.id&&hash[2]!==undefined?Number(hash[2]):null);}
  else{
    packet=null;mountReferences();
    week=null;$('reader').replaceChildren();$('week-title').textContent='First packet has not been released';$('week-number').textContent='Metropolitan Man';$('week-number').removeAttribute('datetime');$('finish').hidden=true;$('play').disabled=true;$('share').disabled=true;audio.removeAttribute('src');audio.load();$('chapter-list').replaceChildren();$('status').textContent='Opens '+dateLabel(catalog.weeks[0].releaseAt,true)+'.';
  }
}
async function loadWeek(id, explicitTime=null, options={}) {
  const next=catalog.weeks.find(w=>w.id===id&&w.available);if(!next)throw Error('This reading is not yet available.');
  clearTimeout(toastTimer);$('toast').hidden=true;
  savePosition();pausePlayback();const token=++loading, continuation=continuationSerial;if(options.autoplay){resumeRequested=true;playbackIntent=true;syncPlay();}$('status').textContent='Loading reading…';$('play').disabled=!options.autoplay;$('share').disabled=true;
  const key=next.packet;let data=packetCache.get(key);if(!data){data=await safeFetch(resource(key));packetCache.set(key,data);}if(token!==loading)return;
  week=next;packet=data;readingBlock=null;activeWord=null;attached=true;wordNodes.clear();times=packet.timings;
  $('reader').innerHTML=packet.html;
  let annotationSection;
  for(const child of [...$('reader').children]){
    if(child.matches('h2[id^="section-"]')){
      annotationSection=document.createElement('section');
      annotationSection.dataset.annotationDocument='metropolitan-man-'+child.id.slice(8);
      annotationSection.dataset.annotationTitle=child.textContent;
      child.before(annotationSection);
    }
    if(annotationSection)annotationSection.append(child);
  }

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
  $('week-number').textContent=discussionDateLabel(week.discussionAt,week.number);if(week.discussionAt)$('week-number').dateTime=week.discussionAt;else $('week-number').removeAttribute('datetime');$('week-title').textContent=week.label;$('share').disabled=false;
  $('chapter-summary').textContent='Chapters';$('chapter-list').replaceChildren();
  week.chapters.forEach(c=>{const li=document.createElement('li'),button=document.createElement('button'),time=document.createElement('small');button.textContent=c.label;time.textContent=duration(c.start);button.append(time);button.addEventListener('click',()=>{seek(c.start);$('chapter-details').open=false;$('schedule-dialog').close();scrollToNode($(c.id));});li.append(button);$('chapter-list').append(li);});
  $('chapter-details').open=false;$('finish').hidden=false;syncContinuousPlayback();
  const nextWeek=catalog.weeks[week.number];$('next-week').hidden=!nextWeek;$('next-week').disabled=!nextWeek?.available;$('next-week').textContent=nextWeek?.available?'Next assignment':nextWeek?(nextWeek.releaseAt?'Next unlocks '+dateLabel(nextWeek.releaseAt):'Next reading not released'):'';
  updateDone();$('alignment-detail').textContent='Word timing coverage: '+(100*week.alignmentCoverage).toFixed(1)+'%. '+(week.addedAlignedWords?week.addedAlignedWords.toLocaleString()+' verified gap fills included. ':'')+'Untimed words are readable but not highlighted or seekable. No interpolated timings.';
  const restoreBlock=explicitTime===null?progress().block:null;
  setAudio(explicitTime??progress().time??0,null,!!options.autoplay&&continuation===continuationSerial&&continuousPlayback&&audioControls);updateStats();renderSchedule();$('status').textContent=!audioControls||week.audio[codec]?'':'Audio is being prepared; all text is ready.';
  history.replaceState(null,'',location.pathname+location.search+'#'+week.id+(explicitTime!==null?'@'+explicitTime.toFixed(2):''));
  requestAnimationFrame(()=>{if(restoreBlock&&$(restoreBlock))scrollToNode($(restoreBlock),'instant');else window.scrollTo({top:0,behavior:'instant'});});
}
function scrollToNode(node, behavior='smooth') { if(!node)return;programmaticUntil=performance.now()+900;node.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':behavior}); }
function findWord(t) { let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid][1]<=t*1000)lo=mid+1;else hi=mid;}const row=times[lo-1];return row&&t*1000-row[1]<1800?wordNodes.get(row[0]):null; }
function readingBottom() { return audioControls?document.querySelector('.transport').getBoundingClientRect().top-16:innerHeight-16; }
function returnControl() { if(!audioControls||!activeWord||!follow){$('return-audio').hidden=true;return;}const rect=activeWord.getBoundingClientRect();const outside=rect.top<65||rect.bottom>readingBottom();$('return-audio').hidden=!outside||attached;$('return-audio').setAttribute('aria-label',rect.top<65?'Return up to narration':'Return down to narration');$('return-audio').querySelector('svg').style.transform=rect.top<65?'':'rotate(180deg)'; }
function updatePlayback() {
  if(!week)return;const t=playbackPosition(),d=week.audio[codec]?.duration||week.duration;
  $('seek').value=t;$('elapsed').textContent=duration(t);
  $('time').textContent=showRemaining?'−'+duration((d-t)/rate):duration(d);
  $('time').setAttribute('aria-label',showRemaining?'Show total audio duration':'Show remaining listening time at '+rate+'×');
  $('time').title=showRemaining?'Remaining at '+rate+'× · tap for total duration':'Total duration · tap for remaining listening time';
  $('seek').setAttribute('aria-valuetext',duration(t)+' of '+duration(d));
  $('seek-progress').style.width=(d>0?100*Math.min(t,d)/d:0)+'%';
  const chapter=currentChapter(t);$('playing-chapter').textContent=chapter?.label||week.label;
  const current=audioControls?findWord(t):null;if(current!==activeWord){activeWord?.classList.remove('active');activeWord=current;activeWord?.classList.add('active');if(activeWord&&!audio.paused&&follow&&attached&&!document.hidden){const rect=activeWord.getBoundingClientRect();if(rect.top<70||rect.bottom>readingBottom())scrollToNode(activeWord);}}
  returnControl();if(!audio.paused&&Math.abs(t-lastSave)>5){lastSave=t;savePosition();}
  if('mediaSession'in navigator&&navigator.mediaSession.setPositionState&&d>0){try{navigator.mediaSession.setPositionState({duration:d,position:Math.min(t,d),playbackRate:rate});}catch{}}
}
function updateDone(){if(!week)return;const done=!!progress().done;$('mark-done').textContent=done?'Finished':'Mark finished';$('mark-done').setAttribute('aria-pressed',String(done));}
function syncPlay(){if(!audioControls&&!audio.paused){pausePlayback();return;}const playing=resumeRequested||!audio.paused;$('play').innerHTML=playing?pauseIcon:playIcon;$('play').setAttribute('aria-label',playing?'Pause':'Play');if('mediaSession'in navigator)navigator.mediaSession.playbackState=playing?'playing':'paused';}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Link copied.');}catch{window.prompt('Copy this link:',text);}}

/* Reviewed references travel with each released packet, never with a global spoiler index. */
let referenceNotes = new Map(), referenceFocusNodes = [], referenceOrigin = null;
let referenceSection = null, selectedLookup = '', selectionTimer;
// Retired display preferences must not hide any reference markers.
for(const key of ['referenceDensity','referenceConfidence','referenceUsefulness','references','hiddenReferences'])delete saved[key];
const referenceKinds = {philosophy:'Philosophy',history:'History / real people',scripture:'Biblical text',tradition:'Religious tradition',literature:'Literature',science:'Science / mathematics',fiction:'Superman / comics'};
const referenceStatuses = {canon:'Other Superman versions',real:'Real-world source',adapted:'Adapted in The Metropolitan Man',invented:'The Metropolitan Man invention',allusion:'Source allusion',uncertain:'Connection uncertain'};
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
  referenceSection=occurrence?.sectionId || null;setReferencePanel(true,marker);$('reference-panel').scrollTop=0;
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
    marker.setAttribute('aria-label','Reference: '+note.title);marker.title=note.title+' — preview; Ctrl/Cmd-click opens source';
    marker.setAttribute('aria-controls','reference-panel');
    if(occurrence.lastWord===null)target.append(marker);else target.after(marker);
  });
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
  $('search-scope').textContent=released.length+' '+label+(last?' · through '+discussionDateLabel(last.discussionAt,last.number):'');
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
    button.append(referenceElement('span','search-result-location',discussionDateLabel(reading.discussionAt,reading.number)+' · '+entry.chapter+(entry.kind==='reference'?' · Reference':'')));
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
  if(!needle){$('search-status').textContent='Search the text and references of all available readings.';$('search-status').dataset.state='idle';return;}
  $('search-results').setAttribute('aria-busy','true');$('search-status').textContent='Searching released readings…';$('search-status').dataset.state='loading';
  try{
    const entries=await getSearchIndex();if(run!==searchRun||!$('search-dialog').open)return;
    searchNeedle=needle;searchMatches=entries.filter(entry=>entry.folded.includes(needle));
    const passages=searchMatches.filter(entry=>entry.kind==='text').length,references=searchMatches.length-passages;
    $('search-status').textContent=searchMatches.length?passages+' passage'+(passages===1?'':'s')+(references?' · '+references+' references':''):'No matches in these readings.';
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
  const hiddenNotes=block.closest('details');if(hiddenNotes)hiddenNotes.open=true;const target=entry.kind==='text'?highlightSearchPassage(block,needle):block;
  scrollToNode(target,'instant');readingBlock=block.id;savePosition();
  if(entry.kind==='reference')showReference(entry.referenceId,packet.referenceOccurrences[entry.occurrence]);
  else{$('reader').focus({preventScroll:true});clearReferenceFocus();}
}
$('search-open').addEventListener('click',()=>openSearch());
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
function chooseCodec(value){if(codec===value)return;const time=playbackPosition(),playing=audioControls&&!audio.paused;codec=value;saved.codec=codec;persist();syncPill('codec-pill',codec,'codec');if(week){setAudio(time);if(playing)startPlayback();}}
$('codec-pill').addEventListener('click',()=>chooseCodec(codec==='opus'?'mp3':'opus'));
$('codec-pill').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();chooseCodec(e.key==='ArrowLeft'?'opus':'mp3');}});
$('follow').addEventListener('click',()=>{follow=!follow;saved.follow=follow;persist();$('follow').textContent=follow?'On':'Off';$('follow').setAttribute('aria-pressed',String(follow));attached=follow;returnControl();});
$('play').addEventListener('click',togglePlay);$('back').addEventListener('click',()=>seek(playbackPosition()-15));$('forward').addEventListener('click',()=>seek(playbackPosition()+15));$('time').addEventListener('click',()=>{showRemaining=!showRemaining;updatePlayback();});
let wasPlaying=false;$('seek').addEventListener('pointerdown',()=>{wasPlaying=!audio.paused;pausePlayback();});$('seek').addEventListener('input',()=>seek(Number($('seek').value)));$('seek').addEventListener('change',()=>{if(wasPlaying)startPlayback();wasPlaying=false;});$('seek').addEventListener('pointercancel',()=>{wasPlaying=false;});
$('return-audio').addEventListener('click',()=>{attached=true;scrollToNode(activeWord);$('return-audio').hidden=true;});
$('mark-done').addEventListener('click',()=>{progress().done=!progress().done;persist();updateDone();renderSchedule();});
$('next-week').addEventListener('click',()=>{const next=catalog.weeks[week.number];if(next?.available)loadWeek(next.id).catch(displayError);});
$('share').addEventListener('click',()=>{if(week)copy(new URL(location.pathname+location.search+'#'+week.id+'@'+audio.currentTime.toFixed(2),location.origin).href);});
$('copy-feed').addEventListener('click',()=>copy(new URL(resource('feed.xml'),location.href).href));
let textDown=null;
$('reader').addEventListener('pointerdown',e=>{textDown={x:e.clientX,y:e.clientY};});
$('reader').addEventListener('click',e=>{const word=e.target.closest('.timed');if(!audioControls||!word||!textDown||Math.hypot(e.clientX-textDown.x,e.clientY-textDown.y)>8||window.getSelection()?.toString())return;const timing=times.find(row=>row[0]===Number(word.dataset.w));if(timing){attached=true;seek(timing[1]/1000);}});
for(const event of ['wheel','touchmove'])window.addEventListener(event,()=>{userScrollIntent=performance.now()+600;if(follow)attached=false;},{passive:true});
window.addEventListener('scroll',()=>{if(performance.now()>programmaticUntil&&performance.now()<userScrollIntent)attached=false;returnControl();clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{const el=document.elementFromPoint(Math.min(innerWidth-20,Math.max(20,innerWidth/2)),Math.min(innerHeight/2,200));const block=el?.closest('#reader [id]');if(block){readingBlock=block.id;savePosition();}},300);},{passive:true});
window.addEventListener('keydown',e=>{const editing=e.target.closest('button.drag-number,textarea,[contenteditable=true],input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button])');if(!audioControls||editing||document.querySelector('dialog[open]'))return;if(e.code==='Space'){e.preventDefault();e.stopPropagation();if(!e.repeat)togglePlay();}else if(e.target===document.body&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();seek(audio.currentTime+(e.key==='ArrowLeft'?-15:15));}},{capture:true});
document.addEventListener('pointerup',e=>{const b=e.target.closest('button');if(b)queueMicrotask(()=>b.blur());});
audio.addEventListener('timeupdate',()=>{if(!document.hidden)updatePlayback();});
audio.addEventListener('play',syncPlay);audio.addEventListener('pause',()=>{syncPlay();savePosition();});
document.addEventListener('visibilitychange',()=>{savePosition();if(!document.hidden)updatePlayback();});window.addEventListener('pagehide',savePosition);
window.addEventListener('hashchange',()=>{const m=location.hash.match(/^#(week-\d\d)(?:@([\d.]+))?$/);if(m&&catalog)loadWeek(m[1],m[2]===undefined?null:Number(m[2])).catch(displayError);});
window.addEventListener('resize',()=>{syncPill('visibility-pill',previewMode,'mode');if($('settings-dialog').open)syncPill('codec-pill',codec,'codec');});
if('mediaSession'in navigator){for(const[action,handler]of Object.entries({play:()=>{if(audioControls)startPlayback();},pause:()=>pausePlayback(),seekbackward:d=>seek(playbackPosition()-(d.seekOffset||15)),seekforward:d=>seek(playbackPosition()+(d.seekOffset||15)),seekto:d=>seek(d.seekTime)})){try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}}
bindDrag('speed',()=>rate,setRate,.05,6,.5,3,.05);bindDrag('font-size',()=>fontSize,setFont,1,8,14,28,1);setRate(rate);setFont(fontSize);$('follow').textContent=follow?'On':'Off';$('follow').setAttribute('aria-pressed',String(follow));
new ResizeObserver(entries=>{document.documentElement.style.setProperty('--player-height',entries[0].target.getBoundingClientRect().height+'px');}).observe(document.querySelector('.transport'));
loadCatalog().then(()=>{
  const q=new URLSearchParams(location.search);
  if(q.get('schedule')==='1'){
    $('schedule-dialog').showModal();syncPill('visibility-pill',previewMode,'mode');
    q.delete('schedule');history.replaceState(null,'',location.pathname+(q.size?'?'+q:'')+location.hash);
  }
}).catch(displayError);

for(const name of ['dzc:annotations-open','dzc:annotation-jump'])document.addEventListener(name,()=>{attached=false;});
