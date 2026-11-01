/* Melete's voice on the recording's performed clock, not a second transport. */
(function(root) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const T = common ? require('./recording_timing.js') : root.MeleteRecordingTiming;
  const synth = common ? require('./vendor/melete-synth.js') : root.MeleteSynth;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const COMPRESSOR_DELAY = .006;

  function notes(sequence, ref) {
    // Keep the written rhythm on the edited click grid. Vocal-onset estimates
    // remain scoring targets, not instructions to shorten a written syllable.
    const clock = ref.timing.beatAnchors ? {...ref, timing:{...ref.timing, anchors:ref.timing.beatAnchors}} : ref;
    return sequence.notes.map(n => ({track:0, key:n[3] + (ref.timing.pitchShift || 0), velocity:n[4] || 84,
      start:Math.max(0, T.secondsAt(clock, n[1])),
      end:Math.min(ref.seconds, T.secondsAt(clock, Math.min(n[2], ref.end)))}));
  }
  function phrases(sequence, ref) {
    const mapped = notes(sequence, ref), consumed = new Set(), result = [];
    for (const chain of sequence.legato || []) {
      if (chain.length < 2 || new Set(chain).size !== chain.length) continue;
      const segments = chain.map(i => mapped[i]);
      if (segments.some((s, i) => !s || consumed.has(chain[i]) || (i &&
        (sequence.notes[chain[i]][0] !== sequence.notes[chain[i - 1]][0] ||
         Math.abs(sequence.notes[chain[i]][1] - sequence.notes[chain[i - 1]][2]) > 1e-6)))) continue;
      const audible = segments.filter(n => n.end - n.start > .001);
      if (!audible.length) continue;
      chain.forEach(i => consumed.add(i));
      result.push({...audible[0], end:audible.at(-1).end, segments:audible});
    }
    mapped.forEach((n, i) => { if (!consumed.has(i) && n.end - n.start > .001) result.push(n); });
    return result.sort((a, b) => a.start - b.start);
  }
  function savedLevels(value) {
    return Array.from({length:4}, (_, i) => Number.isFinite(value?.[i]) && value[i] >= 0 && value[i] <= 200 ? value[i] : 100);
  }
  function toggled(on, index, solo = false) {
    const alone = on.every((v, i) => v === (i === index));
    // Restoring human tracks must not unexpectedly add a synthesized singer.
    return solo ? (alone ? [true, true, true, index === 3] : on.map((_, i) => i === index))
      : on.map((v, i) => i === index ? !v : v);
  }
  function emphasized(levels, index) {
    const matches = (mine, others) => levels.every((v, i) => v === (i === index ? mine : others));
    const pair = matches(100, 20) ? [20, 100] : matches(20, 100) ? [100, 100] : [100, 20];
    return levels.map((_, i) => pair[i === index ? 0 : 1]);
  }
  class Player extends synth.Voice {
    constructor(context, output, outputTrim = 1) {
      super();
      this.context = context; this.rate = 1; this.scheduled = new Set();
      this.wave = synth.createWave(context);
      this.master = context.createGain(); this.master.gain.value = synth.masterGain;
      this.level = context.createGain();
      this.panner = context.createStereoPanner?.();
      if (this.panner) this.level.connect(this.panner).connect(this.master);
      else this.level.connect(this.master);
      this.trackStrips = [{gain:this.level}];
      this.compressor = synth.createCompressor(context);
      this.gate = context.createGain(); this.gate.gain.value = 0;
      this.outputTrim = outputTrim;
      this.master.connect(this.compressor).connect(this.gate).connect(output);
    }
    playbackEndSeconds() { return this.end; }
    mix(enabled, level) {
      this.level.gain.setTargetAtTime(clamp(level, 0, 2), this.context.currentTime, .005);
      this.gate.gain.setTargetAtTime(enabled ? this.outputTrim : 0, this.context.currentTime, .005);
    }
    schedule(sequence, ref, at, from = 0) {
      this.end = ref.seconds;
      // Match the stems after the voice compressor's extra look-ahead. The
      // shared output limiter's delay is already included in the player's clock.
      const anchor = at - COMPRESSOR_DELAY;
      for (const note of phrases(sequence, ref)) {
        const now = this.context.currentTime;
        super.scheduleNote(note, from + now - anchor, Math.max(0, anchor - now));
      }
      for (const voice of this.scheduled) {
        if (voice.cleanup) continue;
        voice.cleanup = true;
        voice.oscillator.addEventListener('ended', () => {
          voice.oscillator.disconnect(); voice.vibrato.disconnect(); voice.envelope.disconnect();
        }, {once:true});
      }
    }
    cancel() {
      const now = this.context.currentTime;
      for (const {oscillator, vibrato, envelope} of this.scheduled) {
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setTargetAtTime(.0001, now, .003);
        oscillator.stop(now + .018); vibrato.stop(now + .018);
      }
      this.scheduled.clear();
    }
  }
  const api = {notes, phrases, savedLevels, toggled, emphasized, Player, COMPRESSOR_DELAY};
  if (common) module.exports = api; else root.MeleteMelody = api;
})(globalThis);
