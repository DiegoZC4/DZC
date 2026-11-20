(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const {chartPoint, strokes, referenceExample} = VowelLab;
  const smoothingMethod = VoiceSuLab.algorithm;
  const canvas = $('chart'), context = canvas.getContext('2d');
  const clips = createClipRecorder();
  const snrMeter = $('snr-meter');
  const pinKey = 'vowel-lab-pins-v1', inputKey = 'vowel-lab-input-v1';
  const statuses = {
    tracking: 'Tracking vowel', limited: 'High note · formant resolution is limited.', silent: 'Sing louder or move closer to the mic.',
    low_snr: 'Sing louder or move closer to the mic.',
    settling: 'Hold the vowel.', no_vowel: 'Hold a vowel sound.',
    clipping: 'Clipping · lower the mic gain.',
    error: 'VoiceSu analysis is unavailable.'
  };
  let stream, audioContext, source, capture, worker;
  let generation = 0, current = null, lpc = null, frames = [], lpcFrames = [], pins = [], width = 0, height = 0;
  let inputChoice = '', pinCandidate = null, analysisEpoch = 0, inputMuted = false;
  let connecting = false, wantMicrophone = true;
  const trailSetting=$('trail-duration');
  let trailMs=500, limited=false,expiryTimer;
  try {
    const savedTrail=localStorage.getItem('vowel-lab-trail-ms');
    if([...trailSetting.options].some(o=>o.value===savedTrail)){trailSetting.value=savedTrail;trailMs=Number(savedTrail);}
    inputChoice = localStorage.getItem(inputKey) || '';
    const saved = JSON.parse(localStorage.getItem(pinKey) || '[]');
    const valid = p => p && Number.isFinite(p.f1) && Number.isFinite(p.f2) && p.f1 >= 175 && p.f1 <= 1250 && p.f2 >= 500 && p.f2 <= 3500;
    if (Array.isArray(saved)) pins = saved.filter(p => valid(p.middle) && typeof p.label === 'string' && Array.isArray(p.runs) && p.runs.every(run => Array.isArray(run) && run.every(valid)));
  } catch {}

  const preview = VowelSynth.attach(canvas, plotBounds, draw, $('audition-hint'), () => trailMs);
  const songMap = VowelSongMap.attach(draw);
  const review = createClipTrackingReview($('clip-audio'), {
    worker: createWorker, clear: clearLive, display: displayReading, status,
    resume: () => status(stream ? 'Listening · sustain a vowel' : 'Microphone paused.')
  });

  function createWorker() {
    const engine = new Worker('worker.js?v=4');
    const config=document.documentElement.dataset;
    engine.postMessage({type:'init', station:config.clipStore === 'station' || config.voicesu === 'local'});
    return engine;
  }

  function status(text, state = '') {
    if ($('status').textContent !== text) $('status').textContent = text;
    $('status').dataset.state = state;
  }
  function configureSnr({thresholdDb, meterMaxDb}) {
    if (!(thresholdDb > 0 && meterMaxDb > thresholdDb)) return;
    if (snrMeter.dataset.cutoff === String(thresholdDb) && snrMeter.ariaValueMax === String(meterMaxDb)) return;
    snrMeter.parentElement.style.setProperty('--cutoff', (100 * thresholdDb / meterMaxDb) + '%');
    snrMeter.dataset.cutoff = thresholdDb;
    snrMeter.dataset.ready = '';
    snrMeter.ariaValueMax = String(meterMaxDb);
    $('snr-cutoff').textContent = 'Track at ' + thresholdDb + ' dB';
  }
  function showSnr(reading) {
    if (!reading) {
      $('snr-value').textContent = '—';
      snrMeter.removeAttribute('aria-valuenow');
      snrMeter.ariaValueText = 'No microphone reading';
      snrMeter.dataset.open = 'false';
      snrMeter.style.setProperty('--fill', '0%');
      return;
    }
    configureSnr(reading);
    const value = Math.min(reading.db, reading.meterMaxDb);
    const text = reading.db === 0 ? '≤0 dB' : reading.db.toFixed(1) + ' dB';
    $('snr-value').textContent = text;
    snrMeter.style.setProperty('--fill', (100 * value / reading.meterMaxDb) + '%');
    snrMeter.ariaValueNow = String(value);
    snrMeter.ariaValueText = text + ', tracking threshold ' + reading.thresholdDb + ' dB';
    snrMeter.dataset.open = String(reading.db >= reading.thresholdDb);
  }
  function clearLive() {
    clearTimeout(expiryTimer);
    ++analysisEpoch;
    current = lpc = null; frames = []; lpcFrames = []; pinCandidate = null;
    writeFormants();
    showSnr(null); $('pin').disabled = true;
    draw();
  }
  function writeFormants() {
    for (const [key, reading] of [['',current], ['lpc-',lpc]]) {
      for (const axis of ['f1','f2']) $(key+axis).textContent = reading ? Math.round(reading[axis]) : '—';
    }
  }
  function displayReading(data, now, fromClip) {
    showSnr(data.snr);
    current = data.mfcc; lpc = data.result;
    limited = data.state === 'limited';
    frames.push({t:now, ...current});
    lpcFrames.push({t:now, ...lpc});
    frames = frames.filter(frame => now - frame.t < 3000);
    lpcFrames = lpcFrames.filter(frame => now - frame.t < 3000);
    writeFormants();
    const label = fromClip && (data.state === 'silent' || data.state === 'low_snr')
      ? 'Below tracking threshold' : statuses[data.state] || 'Hold a vowel sound.';
    status(fromClip ? 'Recording · ' + label : label, data.state);
    pinCandidate = current && !limited ? referenceExample(frames) : null;
    $('pin').disabled = !pinCandidate;
    draw();
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(function expire() {
      current=lpc=null; pinCandidate=null; $('pin').disabled=true;
      writeFormants(); draw();
      if (frames.some(p=>p.f1 && performance.now()-p.t<trailMs) || lpcFrames.some(p=>p.f1 && performance.now()-p.t<trailMs)) expiryTimer=setTimeout(expire,50);
    },250);
  }
  function updatePinControls(message) {
    $('export').disabled = $('clear').disabled = !pins.length;
    $('pin-status').textContent = message || (pins.length ? `${pins.length} pinned ${pins.length === 1 ? 'example' : 'examples'} · saved here` : 'Pins save in this browser.');
  }
  function savePins() {
    try { localStorage.setItem(pinKey, JSON.stringify(pins)); updatePinControls(); }
    catch { updatePinControls('Browser storage full. Export pins to keep them.'); }
    draw();
  }

  async function listInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const selected = inputChoice || '';
    $('input').replaceChildren(new Option('System default', ''));
    for (const device of devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')) {
      $('input').add(new Option(device.label || 'Microphone', device.deviceId));
    }
    if (selected && ![...$('input').options].some(o => o.value === selected)) $('input').add(new Option('Selected microphone unavailable', selected));
    $('input').value = selected;
  }
  function stop(message = 'Microphone stopped.') {
    const drained = clips.disconnect(message);
    ++generation;
    connecting = false;
    worker?.terminate(); worker = null; inputMuted = false;
    if(capture){capture.port.close();capture.disconnect();capture=null;}
    source?.disconnect(); source = null;
    const tracks = stream?.getTracks() || [];
    stream = null;
    for (const track of tracks) { track.onended = track.onmute = track.onunmute = null; track.stop(); }
    const previousContext = audioContext; audioContext = null;
    if (previousContext) void drained.then(() => previousContext.close()).catch(() => {});
    $('start').textContent = 'Resume microphone'; $('start').disabled = false;
    if(!review.active()){clearLive(); status(message);}
  }
  async function start() {
    if (connecting || !wantMicrophone) return;
    stop('Connecting microphone…');
    connecting = true;
    const session = generation;
    $('start').disabled = true;
    let acquired, opened;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({audio: {
        deviceId: inputChoice ? {exact: inputChoice} : undefined,
        channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false
      }});
      if (session !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
      // Chrome's silent sink runs analysis without opening a speaker for monitoring.
      opened = new AudioContext({latencyHint: 'interactive', sinkId: {type: 'none'}});
      await opened.resume();
      if (session !== generation) { acquired.getTracks().forEach(t => t.stop()); await opened.close(); return; }
      stream = acquired; audioContext = opened;
      source = audioContext.createMediaStreamSource(stream);
      await audioContext.audioWorklet.addModule('tracking-worklet.js?v=4');
      if(session !== generation) return;
      capture = new AudioWorkletNode(audioContext, 'vowel-tracking-capture', {channelCount:1, channelCountMode:'explicit', outputChannelCount:[1]});
      worker = createWorker();
      worker.onerror = event => stop(statuses.error + ' ' + event.message);
      worker.onmessage = ({data}) => {
        if(session !== generation) return;
        if(data.type === 'failure'){stop(statuses.error + ' ' + data.error);return;}
        if(data.type === 'ready'){
          source.connect(capture);capture.connect(audioContext.destination);
          clips.connect(audioContext, source, stream.getAudioTracks()[0]);
          if(!review.active())status('Listening · sustain a vowel');
          return;
        }
        if(data.epoch !== analysisEpoch || inputMuted || review.active()) return;
        preview.heard(!songMap.auditioning() ? data.pitchHz : null, data.timeMs);
        displayReading(data, data.timeMs, false);
        clips.displayed(data);
      };
      capture.port.onmessage = ({data}) => {
        if(session !== generation || inputMuted || review.active()) return;
        const rate = audioContext.sampleRate, end = data.first + data.samples.length;
        const stamp = performance.now() - (audioContext.currentTime - end / rate)*1000;
        worker.postMessage({...data, type:'samples', rate, epoch:analysisEpoch, stamp, clip:clips.tag(end/rate)}, [data.samples.buffer]);
      };
      capture.onprocessorerror = () => stop('Audio capture interrupted. Resume the microphone to retry.');
      for (const track of stream.getAudioTracks()) {
        track.onended = () => stop('Microphone disconnected. Reconnect it or choose another input.');
        track.onmute = () => { clips.event('mute'); inputMuted = true; if(!review.active()){clearLive(); status('Microphone input interrupted.');} };
        track.onunmute = () => { clips.event('unmute'); inputMuted = false; if(!review.active()){clearLive(); status('Listening · sustain a vowel');} };
      }
      $('start').textContent = 'Pause microphone'; $('start').disabled = false;
      if(!review.active())status('Loading VoiceSu LPC and MFCC…');
      await listInputs();
    } catch (error) {
      acquired?.getTracks().forEach(t => t.stop());
      if (opened && opened !== audioContext) void opened.close().catch(() => {});
      if (session !== generation) return;
      const messages = {
        NotAllowedError: 'Microphone access is blocked. Allow this site in Chrome; it will connect automatically.',
        NotFoundError: 'Microphone unavailable. Connect it and choose an input.',
        OverconstrainedError: 'Selected microphone unavailable. Reconnect it or choose another input.',
        NotReadableError: 'Microphone could not open. Check its connection and whether another app has exclusive access.'
      };
      stop(messages[error.name] || `Microphone could not start (${error.message}).`);
      $('status').dataset.state = 'error';
    } finally { if (session === generation) connecting = false; }
  }

  function plotBounds() {
    return {x:66, y:24, width:Math.max(1,width-106), height:Math.max(1,height-78)};
  }
  function plotPoint(formants) {
    const p = chartPoint(formants), box = plotBounds();
    return {x:box.x+p.x*box.width, y:box.y+p.y*box.height};
  }
  function line(a, b) { context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); }
  function trace(runs, color, lineWidth) {
    context.strokeStyle = color; context.lineWidth = lineWidth;
    for (const run of runs) {
      context.beginPath();
      run.forEach((frame, i) => {
        const p = plotPoint(frame);
        if (i) context.lineTo(p.x, p.y); else context.moveTo(p.x, p.y);
      });
      context.stroke();
    }
  }
  function draw() {
    if (!width || !height) return;
    const ctx = context;
    ctx.clearRect(0, 0, width, height);
    const topLeft = plotPoint({f1:175, f2:3500}), bottomRight = plotPoint({f1:1250, f2:500});
    ctx.fillStyle = '#141d29'; ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x-topLeft.x, bottomRight.y-topLeft.y);
    ctx.font = '12px "Segoe UI", sans-serif'; ctx.fillStyle = '#abb9cc'; ctx.lineWidth = 1; ctx.strokeStyle = '#293649';
    for (const hz of [175,250,400,600,800,1000,1250]) {
      const p = plotPoint({f1:hz, f2:3500});
      line(p, {x:bottomRight.x, y:p.y});
      ctx.textAlign = 'right'; ctx.fillText(hz, p.x-10, p.y+4);
    }
    for (const hz of [3500,3000,2500,2000,1500,1000,500]) {
      if (width < 500 && [3000,2000,1000].includes(hz)) continue;
      const p = plotPoint({f1:1250, f2:hz});
      line({x:p.x, y:topLeft.y}, p);
      ctx.textAlign = 'center'; ctx.fillText(hz, p.x, p.y+20);
    }
    ctx.textAlign = 'center'; ctx.fillText('← F2 (Hz)', (topLeft.x+bottomRight.x)/2, height-10);
    ctx.save(); ctx.translate(16, (topLeft.y+bottomRight.y)/2); ctx.rotate(-Math.PI/2); ctx.fillText('F1 (Hz) ←', 0, 0); ctx.restore();
    const group = $('landmarks').value;
    if (group !== 'none') {
      ctx.font = '16px "Segoe UI", sans-serif'; ctx.fillStyle = '#7789a5'; ctx.textAlign = 'center';
      for (const vowel of VowelLandmarks) {
        const p = plotPoint(vowel[group]);
        ctx.fillText(vowel.symbol, p.x, p.y+5);
      }
    }
    ctx.save(); ctx.beginPath(); ctx.rect(topLeft.x, topLeft.y, bottomRight.x-topLeft.x, bottomRight.y-topLeft.y); ctx.clip();
    songMap.draw(ctx, plotPoint, plotBounds());
    pins.forEach((pin, index) => {
      const color = ['#eebd75','#d4a4ed','#98bfff','#f19da7'][index%4];
      trace(pin.runs, color+'60', 1.5);
      const p = plotPoint(pin.middle);
      ctx.beginPath(); ctx.arc(p.x,p.y,8,0,2*Math.PI); ctx.lineWidth=2; ctx.strokeStyle=color; ctx.stroke();
      ctx.fillStyle=color; ctx.font='12px "Segoe UI", sans-serif'; ctx.textAlign=p.x>width*.7?'right':'left';
      ctx.fillText(pin.label,p.x+(p.x>width*.7?-12:12),p.y-10);
    });
    const since=performance.now()-trailMs;
    if(trailMs)trace(strokes(lpcFrames.filter(p=>p.t>=since)), '#cdb4ff88', 2);
    if(trailMs)trace(strokes(frames.filter(p=>p.t>=since)), '#8be9d270', 3);
    if(trailMs)trace(strokes(preview.trail.filter(p=>p.t>=since)), '#ffd08aab', 2);
    if (current) {
      const p = plotPoint(current);
      ctx.beginPath(); ctx.arc(p.x,p.y,17,0,2*Math.PI); ctx.fillStyle='#8be9d21a'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x,p.y,8,0,2*Math.PI); ctx.fillStyle='#8be9d2'; if(!limited)ctx.fill();
      ctx.strokeStyle='#d9fff4'; ctx.lineWidth=2; ctx.stroke();
    }
    if (lpc) {
      const p = plotPoint(lpc);
      ctx.strokeStyle='#cdb4ff'; ctx.lineWidth=2;
      ctx.strokeRect(p.x-6,p.y-6,12,12);
    }
    if (preview.marker) {
      const {f1, f2} = preview.marker, p = plotPoint(preview.marker);
      ctx.strokeStyle='#ffd08a'; ctx.lineWidth=2; ctx.beginPath();
      ctx.moveTo(p.x,p.y-9); ctx.lineTo(p.x+9,p.y); ctx.lineTo(p.x,p.y+9);
      ctx.lineTo(p.x-9,p.y); ctx.closePath(); ctx.stroke();
      ctx.font='12px "Segoe UI", sans-serif'; ctx.fillStyle='#ffd08a';
      const left=p.x>(topLeft.x+bottomRight.x)/2;
      ctx.textAlign=left?'right':'left';
      const label=Math.round(f1)+' / '+Math.round(f2)+' Hz';
      ctx.fillText(label,p.x+(left?-14:14),Math.max(topLeft.y+15,Math.min(bottomRight.y-5,p.y+4)));
    }
    ctx.restore();
  }

  trailSetting.addEventListener('change',()=>{
    trailMs=Number(trailSetting.value);
    try{localStorage.setItem('vowel-lab-trail-ms',trailSetting.value);}catch{}
    draw();
  });
  $('start').addEventListener('click', () => {
    wantMicrophone = !stream;
    if (wantMicrophone) void start(); else stop();
  });
  $('input').addEventListener('change', () => {
    inputChoice = $('input').value;
    try { localStorage.setItem(inputKey, inputChoice); } catch {}
    wantMicrophone = true; stop('Microphone changed.'); void start();
  });
  $('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { status('Full screen unavailable in this window.'); }
  });
  document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
  // Browser-native Escape exits fullscreen. The first Escape preserves About.
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !document.fullscreenElement) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void document.exitFullscreen();
  }, {capture:true});
  $('landmarks').addEventListener('change', () => {
    draw();
  });
  $('pin-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!pinCandidate) return;
    pins.push({...pinCandidate, smoothing: smoothingMethod, label: $('label').value.trim() || `Example ${pins.length+1}`, capturedAt:new Date().toISOString()});
    savePins();
  });
  $('clear').addEventListener('click', () => { pins = []; savePins(); });
  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({schema:1, app:'Vowel Lab', algorithm:smoothingMethod, units:'Hz', pins},null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'vowel-lab-examples.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  navigator.mediaDevices?.addEventListener('devicechange', () => {
    void listInputs().catch(() => {});
    if (wantMicrophone && !stream && !connecting) void start();
  });
  navigator.permissions?.query({name:'microphone'}).then(permission=>{
    permission.onchange=()=>{if(permission.state==='granted' && wantMicrophone && !stream && !connecting)void start();};
  }).catch(()=>{});
  window.addEventListener('pagehide', () => {wantMicrophone=false;stop();});
  new ResizeObserver(() => {
    const box = canvas.getBoundingClientRect(), scale = window.devicePixelRatio || 1;
    width = box.width; height = box.height;
    canvas.width = Math.round(width*scale); canvas.height = Math.round(height*scale);
    context.setTransform(scale,0,0,scale,0,0); draw();
  }).observe($('plot'));
  updatePinControls();
  configureSnr({thresholdDb:15,meterMaxDb:40});
  if (navigator.mediaDevices) void start();
  else { $('start').disabled = true; status('Open Vowel Lab from its localhost launcher to enable the microphone.', 'error'); }
})();
