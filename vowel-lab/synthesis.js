/* A periodic voice source sampled through a vocal-tract resonance envelope. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VowelSynth = api;
})(globalThis, () => {
  'use strict';
  const pitchKey = 'vowel-lab-last-sung-pitch-v1';
  const validPitch = hz => Number.isFinite(hz) && hz >= 55 && hz <= 1700;

  function harmonicLevels(pitch, {f1, f2}, count) {
    const resonances = [[f1, 70], [f2, 100], [3800, 220], [4800, 320]];
    const levels = Array.from({length: count}, (_, i) => {
      const harmonic = i + 1, frequency = harmonic * pitch;
      let level = 1 / harmonic; // Radiated glottal source, about -6 dB/octave.
      for (const [center, bandwidth] of resonances) {
        const ratio = frequency / center;
        level /= Math.hypot(1 - ratio * ratio, ratio * bandwidth / center);
      }
      return level;
    });
    const sum = levels.reduce((a, b) => a + b, 0);
    const scale = Math.min(.25 / sum, .075 * Math.SQRT2 / Math.hypot(...levels));
    return levels.map(level => level * scale);
  }

  function createVoice(context, pitch, formants) {
    const start = context.currentTime;
    const count = Math.min(96, Math.floor(Math.min(6500, context.sampleRate / 2 - 1) / pitch));
    const master = context.createGain();
    master.gain.setValueAtTime(0, start);
    master.gain.linearRampToValueAtTime(1, start + .015);
    master.connect(context.destination);
    let remaining = count, stopAt = Infinity;
    const bank = harmonicLevels(pitch, formants, count).map((level, i) => {
      const source = context.createOscillator(), gain = context.createGain();
      source.frequency.value = (i + 1) * pitch;
      gain.gain.value = level;
      source.connect(gain).connect(master);
      source.onended = () => {
        source.disconnect(); gain.disconnect();
        if (--remaining === 0) master.disconnect();
      };
      source.start(start);
      return {source, gain};
    });
    return {
      move(point) {
        const now = context.currentTime;
        harmonicLevels(pitch, point, count).forEach((level, i) => {
          bank[i].gain.gain.setTargetAtTime(level, now, .012);
        });
      },
      release(immediate = false) {
        const now = context.currentTime;
        const off = immediate ? now : Math.max(now, start + .26);
        if (off + .045 >= stopAt || !remaining) return stopAt;
        stopAt = off + .045;
        if (master.gain.cancelAndHoldAtTime) master.gain.cancelAndHoldAtTime(off);
        else {
          master.gain.cancelScheduledValues(off);
          master.gain.setValueAtTime(Math.min(1, (off - start) / .015), off);
        }
        master.gain.setTargetAtTime(0, off, .007);
        for (const {source} of bank) source.stop(stopAt);
        return stopAt;
      }
    };
  }

  function attach(canvas, bounds, redraw, hint, trailDuration) {
    const defaultHint = hint.textContent;
    let pitch = null, pitches = [], lastSample = -Infinity, ignoreUntil = -Infinity;
    let output, voice, held = null, marker = null, cursor = {x: .5, y: .5};
    let clearTimer, idleTimer, saveTimer, trailTimer, trail = [];
    try { const saved = Number(localStorage.getItem(pitchKey)); if (validPitch(saved)) pitch = saved; } catch {}
    function save() {
      clearTimeout(saveTimer); saveTimer = null;
      if (pitch !== null) try { localStorage.setItem(pitchKey, String(pitch)); } catch {}
    }
    function heard(hz, time) {
      if (!validPitch(hz) || held !== null || time <= ignoreUntil) { pitches = []; return; }
      if (time - lastSample > 100) pitches = [];
      lastSample = time;
      pitches.push(hz);
      if (pitches.length > 3) pitches.shift();
      if (pitches.length !== 3) return;
      const [lo, mid, hi] = [...pitches].sort((a,b) => a-b);
      if (Math.min(Math.log2(mid / lo), Math.log2(hi / mid)) > .06) return;
      pitch = mid;
      if (!saveTimer) saveTimer = setTimeout(save, 1000);
    }
    function pick(event, clamp) {
      const rect = canvas.getBoundingClientRect(), box = bounds();
      const x = (event.clientX - rect.left - box.x) / box.width;
      const y = (event.clientY - rect.top - box.y) / box.height;
      if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
      return {x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y))};
    }
    function addTrailPoint() {
      const t = performance.now();
      trail = trail.filter(p => t - p.t < 3000);
      trail.push({...marker, t});
      clearTimeout(trailTimer);
      function expire() {
        redraw();
        if (trail.length && performance.now()-trail.at(-1).t < trailDuration()) trailTimer=setTimeout(expire, 50);
      }
      if (trailDuration()) trailTimer=setTimeout(expire, 50);
    }
    function move(position) {
      cursor = position; marker = VowelLab.chartFormants(cursor);
      if (held !== null) { voice?.move(marker); addTrailPoint(); }
      redraw();
    }
    function release(key, immediate = false) {
      if (key !== held || held === null) return;
      held = null;
      const tail = voice ? Math.max(0, (voice.release(immediate) - output.currentTime) * 1000) : 0;
      ignoreUntil = performance.now() + tail + 200;
      clearTimer = setTimeout(() => { marker = null; redraw(); }, tail);
      idleTimer = setTimeout(() => { if (held === null && output?.state === 'running') void output.suspend().catch(() => {}); }, tail + 500);
    }
    function begin(key, position) {
      if (held !== null) return;
      clearTimeout(clearTimer); clearTimeout(idleTimer);
      try {
        output ||= new AudioContext({latencyHint: 'interactive'});
        voice?.release(true);
        cursor = position; marker = VowelLab.chartFormants(position);
        // Analysis uses a silent device. Only this user gesture opens the normal audio output.
        const resumed = output.resume();
        const next = createVoice(output, pitch ?? 220, marker);
        voice = next; held = key; pitches = [];
        trail = []; addTrailPoint();
        hint.textContent = defaultHint; redraw();
        void resumed.catch(() => {
          if (voice !== next) return;
          release(held, true); hint.textContent = 'Audio output unavailable. Click the chart to retry.';
        });
      } catch {
        held = null; marker = null; redraw();
        hint.textContent = 'Audio output unavailable. Click the chart to retry.';
      }
    }
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || held !== null) return;
      const position = pick(event, false);
      if (!position) return;
      event.preventDefault(); canvas.focus({preventScroll:true});
      canvas.setPointerCapture(event.pointerId); begin(event.pointerId, position);
    });
    canvas.addEventListener('pointermove', event => {
      if (event.pointerId === held) move(pick(event, true));
    });
    canvas.addEventListener('pointerup', event => release(event.pointerId));
    for (const type of ['pointercancel','lostpointercapture']) {
      canvas.addEventListener(type, event => release(event.pointerId, true));
    }
    canvas.addEventListener('keydown', event => {
      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault(); if (!event.repeat) begin('keyboard', cursor);
        return;
      }
      if (event.key === 'Escape') { release(held, true); return; }
      const direction = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]}[event.key];
      if (!direction || (held !== null && held !== 'keyboard')) return;
      event.preventDefault(); clearTimeout(clearTimer);
      const step = event.shiftKey ? .05 : .01;
      move({x:Math.max(0,Math.min(1,cursor.x+direction[0]*step)), y:Math.max(0,Math.min(1,cursor.y+direction[1]*step))});
    });
    canvas.addEventListener('keyup', event => {
      if (event.code === 'Space' || event.key === 'Enter') { event.preventDefault(); release('keyboard'); }
    });
    function cancel() {
      if (held !== null) release(held, true);
      else voice?.release(true);
      marker = null; redraw();
    }
    canvas.addEventListener('blur', cancel);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
    window.addEventListener('pagehide', () => {
      cancel(); save(); clearTimeout(clearTimer); clearTimeout(idleTimer); clearTimeout(trailTimer);
      if (output) void output.close().catch(() => {});
      output = null; voice = null;
    });
    return {heard, get marker() { return marker; }, get trail() { return trail; }};
  }
  return {harmonicLevels, createVoice, attach};
});
