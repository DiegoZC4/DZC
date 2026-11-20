// VoiceSu supplies both estimators and the trained MFCC readout. The Lab owns the
// audio clock, SNR meter and presentation. Live capture and clip replay use this same path.
((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./analysis.js'), require('./live_tracker.js'));
  else root.VoiceSuLab = factory(root.VowelLab, root.VowelTracker);
})(globalThis, (lab, legacy) => {
  'use strict';
  const revision = 'cc54abd3887eca90a3c096e0bfc8ca446c0d4e1e';
  const algorithm = 'voicesu-lpc-mfcc-v1';
  const settings = Object.freeze({revision, analysisRate:11025, frameSamples:512, hopHz:60, smoothing:0.94, lpcMedianFrames:13, mfccMedianFrames:5});
  const cdn = 'https://cdn.jsdelivr.net/gh/brentenjackson/voicesu@' + revision + '/';

  async function load(base, getWeights) {
    const url = name => new URL(name, base).href;
    const weights = getWeights || (async address => {
      const response = await fetch(address);
      if (!response.ok) throw Error('MFCC model returned HTTP ' + response.status);
      return response.json();
    });
    const [{Analyzer}, {ENGINES}, framer, model, {LpcEngine}] = await Promise.all([
      import(url('js/analysis.js')), import(url('js/engines/registry.js')), import(url('js/framer.js')),
      weights(url('models/mfcc_readout.json')), import(url('js/engines/lpc.js'))
    ]);
    const engines = ENGINES.filter(e => e.name === 'lpc' || e.name === 'mfcc');
    return (sampleRate, smoothing = settings.smoothing, lpcMedian = settings.lpcMedianFrames) => {
      const analyzer = new Analyzer(framer.TARGET_SR);
      for (const engine of engines) analyzer.add(engine, engine.name === 'lpc'
        ? new LpcEngine(framer.TARGET_SR, {medianSize:lpcMedian}) : engine.create(framer.TARGET_SR, model));
      analyzer.configure({enabled:['lpc', 'mfcc'], smoothing});
      return new Stream(sampleRate, framer, analyzer);
    };
  }

  class Stream {
    constructor(sampleRate, framer, analyzer) {
      this.rate = sampleRate;
      this.analyzer = analyzer;
      this.meter = new legacy.SignalMeter();
      // Include 23 ms of filter warm-up ahead of the upstream 512-sample frame.
      // The polyphase low-pass runs before downsampling for every hardware rate.
      const rate = framer.TARGET_SR, size = framer.FRAME + 256;
      const radius = Math.ceil(5 * sampleRate / rate);
      const inputSize = Math.ceil((size + 1) * sampleRate / rate) + 2 * radius + 2;
      this.resample = lab.resampler(sampleRate, rate, size);
      this.frames = new framer.Framer(1, sampleRate * framer.HOP_SECONDS, inputSize);
      this.endDelay = radius + 1 + sampleRate / rate;
      const w = 2 * Math.PI * framer.HIGHPASS_HZ / rate, cos = Math.cos(w), a0 = 1 + Math.sin(w) / Math.SQRT2;
      this.b = (1 + cos) / (2 * a0);
      this.a1 = -2 * cos / a0;
      this.a2 = (2 - a0) / a0;
      this.lastVoiced = null;
    }
    modelFrame(native) {
      const filtered = this.resample(native);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < filtered.length; i++) {
        const x = filtered[i];
        const y = this.b * (x - 2*x1 + x2) - this.a1*y1 - this.a2*y2;
        x2=x1; x1=x; y2=y1; y1=y; filtered[i]=y;
      }
      return filtered.subarray(filtered.length - settings.frameSamples);
    }
    push(samples, emit) {
      this.frames.push(samples, native => {
        const endSample = Math.round(this.frames.count - this.endDelay);
        const timeMs = 1000 * endSample / this.rate;
        const meterWindow = native.subarray(-Math.round(this.rate * 0.05));
        const {state:gate, pitchHz, rms, snr} = this.meter.measure(meterWindow, this.rate, timeMs);
        let state = gate, lpc = null, mfcc = null, raw = null;
        if (gate === 'tracking') {
          const {results, voicing} = this.analyzer.analyze(this.modelFrame(native));
          const point = r => r.updated && Number.isFinite(r.f1) && Number.isFinite(r.f2) ? {f1:r.f1, f2:r.f2} : null;
          lpc = point(results.lpc);
          mfcc = point(results.mfcc);
          const poles = results.lpc.formants;
          if (poles?.length >= 2) raw = {f1:poles[0].freq, f2:poles[1].freq};
          state = lpc || mfcc ? (pitchHz > 350 ? 'limited' : 'tracking') : voicing.voiced ? 'settling' : 'no_vowel';
        }
        if (lpc || mfcc) this.lastVoiced = timeMs;
        // Blank unsupported frames immediately. A single weak frame inside a
        // vowel needn't throw away the filters' history on the next good frame.
        else if (this.lastVoiced !== null && (gate === 'silent' || gate === 'clipping' || timeMs-this.lastVoiced >= 90)) {
          for (const {engine} of this.analyzer.engines.values()) engine.reset();
          this.lastVoiced = null;
        }
        emit({endSample, timeMs, state, result:lpc, mfcc, raw, pitchHz, rms, snr}, meterWindow);
      });
    }
  }
  return {algorithm, settings, cdn, load};
});
