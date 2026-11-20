// This node has silent output. The mic signal is transferred on its audio clock,
// independently of drawing, tab timers, or the diagnostic WAV recorder.
class VowelTrackingCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(Math.max(128, Math.round(sampleRate / 60)));
    this.used = 0;
  }
  process(inputs) {
    const mono = inputs[0][0];
    if (!mono) { this.used = 0; return true; }
    for (let i = 0; i < mono.length; i++) {
      if (!this.used) this.first = currentFrame + i;
      this.buffer[this.used++] = mono[i];
      if (this.used === this.buffer.length) {
        this.port.postMessage({first:this.first, samples:this.buffer}, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.used);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor('vowel-tracking-capture', VowelTrackingCapture);
