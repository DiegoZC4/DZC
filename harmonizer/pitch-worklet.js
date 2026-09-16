import { RealtimePitchTracker } from "./pitch.js?v=20260726-2";

class HarmonizerPitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    const warmupTracker = new RealtimePitchTracker(sampleRate, options.processorOptions);
    const warmup = new Float32Array(128);
    let phase = 0;
    for (let quantum = 0; quantum < 20; quantum += 1) {
      for (let sample = 0; sample < warmup.length; sample += 1) {
        warmup[sample] = 0.08 * Math.sin(phase);
        phase += 2 * Math.PI * 220 / sampleRate;
      }
      warmupTracker.push(warmup);
    }
    this.tracker = new RealtimePitchTracker(sampleRate, options.processorOptions);
    this.intervalCalls = 0;
    this.intervalTotalMs = 0;
    this.intervalMaxMs = 0;
    this.overruns = 0;
    this.warmupCalls = 32;
    this.port.onmessage = (event) => {
      if (event.data?.type === "controls") this.tracker.configure(event.data);
    };
  }

  process(inputs, outputs) {
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) {
      if (input) output.set(input);
      else output.fill(0);
    }

    const analyzed = input ? this.tracker.push(input) : false;
    const elapsedMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
    const quantumMs = 1000 * (output?.length || 128) / sampleRate;
    if (this.warmupCalls > 0) {
      this.warmupCalls -= 1;
    } else {
      this.intervalCalls += 1;
      this.intervalTotalMs += elapsedMs;
      this.intervalMaxMs = Math.max(this.intervalMaxMs, elapsedMs);
      if (elapsedMs > quantumMs) this.overruns += 1;
    }

    if (analyzed && this.intervalCalls > 0) {
      const snapshot = this.tracker.snapshot(currentTime);
      snapshot.renderMs = elapsedMs;
      snapshot.renderAverageMs = this.intervalTotalMs / this.intervalCalls;
      snapshot.renderMaxMs = this.intervalMaxMs;
      snapshot.overruns = this.overruns;
      snapshot.quantumMs = quantumMs;
      this.port.postMessage(snapshot);
      this.intervalCalls = 0;
      this.intervalTotalMs = 0;
      this.intervalMaxMs = 0;
    }
    return true;
  }
}

registerProcessor("harmonizer-pitch-control", HarmonizerPitchProcessor);
