// Diagnostic clips use the existing mic graph and the results actually drawn.
// Keep the completed payload until the local server acknowledges the save.
function createClipRecorder() {
  'use strict';
  const el = id => document.getElementById(id);
  const button = el('record-clip'), clock = el('clip-clock'), message = el('clip-status');
  const library = el('clip-library'), picker = el('clip-picker'), audio = el('clip-audio');
  const maxSeconds = 120;
  const loadedContexts = new WeakSet();
  let input = null, opening = false, active = null, unsaved = null, saving = false;
  let listRequest = 0, lastSaved = null;
  const browserStore=document.documentElement.dataset.clipStore==='browser' ? browserClipStorage() : null;
  let reviewUrls=[],selectionVersion=0;

  function controls() {
    button.textContent = saving ? 'Saving…' : unsaved ? 'Retry save' : active ? 'Stop & save' : 'Record clip';
    button.disabled = opening || saving || Boolean(active?.stopping) || (!active && !unsaved && !input);
    button.setAttribute('aria-pressed', String(Boolean(active)));
    clock.hidden = !active;
  }
  function clipLabel(id) {
    const stamp = id.slice(0, 16).replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z');
    return new Date(stamp).toLocaleString();
  }
  async function selectClip() {
    const version=++selectionVersion;
    audio.pause();
    for(const url of reviewUrls) URL.revokeObjectURL(url);
    reviewUrls=[];
    const id = picker.value;
    el('clip-review').hidden = !id;
    if (!id) { audio.removeAttribute('src'); audio.load(); return; }
    const base = 'clips/' + encodeURIComponent(id) + '/';
    let paths=[base+'audio.wav',base+'trace.json'];
    if(browserStore){
      try{
        const clip=await browserStore.get(id);
        if(selectionVersion!==version)return;
        if(!clip)throw Error();
        paths=reviewUrls=[URL.createObjectURL(clip.wav),URL.createObjectURL(clip.trace)];
      }catch{if(selectionVersion===version){el('clip-review').hidden=true;message.textContent='Could not open this clip.';}return;}
    }
    audio.src = paths[0];
    audio.dispatchEvent(new Event('clipselected'));
    for (const [link, file] of [['clip-wav', 'audio.wav'], ['clip-trace', 'trace.json']]) {
      el(link).href = paths[file==='audio.wav'?0:1];
      el(link).download = id + '-' + file;
    }
  }
  async function listClips(preferred) {
    const request = ++listRequest;
    try {
      let clips;
      if(browserStore) clips=await browserStore.ids();
      else{
        const response=await fetch('clips');
        if(!response.ok)throw Error();
        ({clips}=await response.json());
      }
      if (request !== listRequest) return;
      const selected = preferred || lastSaved || picker.value || location.hash.slice(6);
      picker.replaceChildren(...clips.map(id => new Option(clipLabel(id), id)));
      if (clips.includes(selected)) picker.value = selected;
      picker.hidden = !clips.length;
      el('clip-empty').textContent = clips.length ? '' : 'No recordings yet.';
      selectClip();
      lastSaved = null;
    } catch { if (request === listRequest) el('clip-empty').textContent = 'Could not load saved recordings.'; }
  }
  library.addEventListener('toggle', () => {
    if (library.open) void listClips();
    else audio.pause();
  });
  picker.addEventListener('change', selectClip);
  if (/^#clip=[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/.test(location.hash)) library.open=true;
  audio.addEventListener('play', () => { if (active || opening) audio.pause(); });

  async function save() {
    if (saving || !unsaved) return;
    saving = true;
    controls();
    message.textContent = 'Saving clip…';
    try {
      const {id, body, traceBytes} = unsaved;
      let ack;
      if(browserStore) ack=await browserStore.save(id,body,traceBytes);
      else {
        const response = await fetch('clips/' + id, {method: 'POST', body,
          headers: {'X-Trace-Bytes': String(traceBytes)}, signal: AbortSignal.timeout(45000)});
        ack = await response.json();
        if (!response.ok || ack.id !== id) throw Error(ack.error || 'Save was not confirmed.');
      }
      unsaved = null;
      lastSaved = id;
      message.textContent = 'Saved ' + ack.seconds.toFixed(1) + ' s · ' + clipLabel(id);
      if (library.open) void listClips(id);
    } catch (error) {
      message.textContent = 'Clip kept in this tab. Retry save. ' + error.message;
    } finally { saving = false; controls(); }
  }

  function finish(clip, reason) {
    if (active !== clip) return;
    clearTimeout(clip.flushTimer);
    try { clip.input.source.disconnect(clip.node); } catch {}
    clip.node.disconnect();
    clip.node.port.close();
    active = null;
    clip.resolveDrain();
    if (!clip.sampleCount) {
      message.textContent = 'No audio frames arrived. Try recording again.';
      controls();
      return;
    }
    const first = clip.firstFrame;
    for (const frame of clip.frames) frame.clockEndSample -= first;
    for (const event of clip.events) event.sample -= first;
    const track = clip.input.settings;
    const trace = new Blob([JSON.stringify({
      startedAt: clip.startedAt, sampleRate: clip.rate, sampleCount: clip.sampleCount,
      algorithm:VoiceSuLab.algorithm,settings:{...VoiceSuLab.settings,primary:'mfcc',windowHash:'native 50 ms SNR window'},
      snrGate:{thresholdDb:15,meterMaxDb:40},trailMs:Number(el('trail-duration').value),
      input: {label: clip.input.label, sampleRate: track.sampleRate, channelCount: track.channelCount,
        echoCancellation: track.echoCancellation, noiseSuppression: track.noiseSuppression, autoGainControl: track.autoGainControl},
      audioStartAfterButtonMs: (first - clip.buttonFrame) * 1000 / clip.rate,
      stopReason: reason, frames: clip.frames, events: clip.events
    })]);
    unsaved = {id: clip.id, body: new Blob([trace, ...clip.chunks], {type: 'application/octet-stream'}), traceBytes: trace.size};
    void save();
  }

  function stop(reason = 'stopped') {
    const clip = active;
    if (!clip) return Promise.resolve();
    if (!clip.stopping) {
      clip.stopping = reason;
      clip.node.port.postMessage('stop');
      // If the device vanished, the audio thread may no longer acknowledge a
      // flush. Preserve every complete block already received.
      clip.flushTimer = setTimeout(() => finish(clip, reason + ' (last audio block unavailable)'), 700);
      controls();
    }
    return clip.drained;
  }
  async function begin() {
    const device = input;
    if (!device || opening || active || unsaved) return;
    opening = true;
    controls();
    audio.pause();
    try {
      const ctx = device.context;
      if (!loadedContexts.has(ctx)) {
        await ctx.audioWorklet.addModule('clip-worklet.js');
        loadedContexts.add(ctx);
      }
      if (device !== input) return;
      const node = new AudioWorkletNode(ctx, 'vowel-clip-capture', {
        channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
        processorOptions: {maxSeconds}
      });
      const startedAt = new Date().toISOString();
      const clip = {id: startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') + '-' + crypto.randomUUID().slice(0, 8),
        startedAt, node, input: device, rate: ctx.sampleRate, originMs: performance.now(),
        buttonFrame: Math.round(ctx.currentTime * ctx.sampleRate), firstFrame: null,
        sampleCount: 0, chunks: [], frames: [], events: []};
      clip.drained = new Promise(resolve => { clip.resolveDrain = resolve; });
      active = clip;
      node.port.onmessage = ({data}) => {
        if (active !== clip) return;
        if (data.done) { finish(clip, clip.stopping || data.done); return; }
        clip.firstFrame ??= data.startFrame;
        if (data.startFrame !== clip.firstFrame + clip.sampleCount) {
          finish(clip, 'Audio clock interrupted');
          return;
        }
        clip.chunks.push(data.samples);
        clip.sampleCount += data.samples.length;
        const seconds = Math.floor(clip.sampleCount / clip.rate);
        const time = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' / 2:00';
        if (time !== clock.textContent) clock.textContent = time;
      };
      node.onprocessorerror = () => finish(clip, 'Audio capture interrupted');
      device.source.connect(node);
      node.connect(ctx.destination); // The processor only writes to its recording buffer.
      clock.textContent = '0:00 / 2:00';
      message.textContent = 'Recording clip';
    } catch (error) {
      if (active) finish(active, 'Capture could not start');
      message.textContent = 'Could not start recording. ' + error.message;
    } finally { opening = false; controls(); }
  }
  button.addEventListener('click', () => {
    if (unsaved) void save();
    else if (active) void stop();
    else void begin();
  });
  window.addEventListener('beforeunload', event => {
    if (active || unsaved) { event.preventDefault(); event.returnValue = ''; }
  });
  controls();
  return {
    connect(context, source, track) {
      input = {context, source, settings: track.getSettings(), label: track.label};
      controls();
    },
    disconnect(reason) { input = null; const drained = stop(reason); controls(); return drained; },
    tag(audioTime) {
      if (active && !active.stopping) return {id: active.id, endFrame: Math.round(audioTime * active.rate)};
    },
    displayed(data) {
      if (!active || active.stopping || data.clip?.id !== active.id) return;
      active.frames.push({clockEndSample: data.clip.endFrame, sampledMs: data.timeMs - active.originMs,
        displayedMs: performance.now() - active.originMs, epoch: data.epoch, state: data.state,
        raw: data.raw, rawSource:'lpc', displayed: data.mfcc, lpc: data.result, mfcc: data.mfcc,
        rms: data.rms, snr: data.snr, analysisMs: data.analysisMs,
        windowSha256: data.windowSha256, windowTail: data.windowTail});
    },
    event(kind) {
      if (active && !active.stopping) active.events.push({kind,
        sample: Math.round(active.input.context.currentTime * active.rate), timeMs: performance.now() - active.originMs});
    }
  };
}
