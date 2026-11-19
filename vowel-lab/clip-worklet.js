// Capture the same mono Web Audio signal as the analyser, including the time
// between analysis requests. The output stays silent.
class ClipCapture extends AudioWorkletProcessor {
  constructor({processorOptions}) {
    super();
    this.remaining = Math.round(sampleRate * processorOptions.maxSeconds);
    this.buffer = new Float32Array(4096);
    this.used = 0;
    this.done = false;
    this.port.onmessage = () => this.finish('stopped');
  }

  flush() {
    if (!this.used) return;
    const samples = this.buffer.subarray(0, this.used);
    this.port.postMessage({startFrame: this.blockStart, samples}, [samples.buffer]);
    this.buffer = new Float32Array(4096);
    this.used = 0;
  }

  finish(reason) {
    if (this.done) return;
    this.done = true;
    this.flush();
    this.port.postMessage({done: reason});
  }

  process(inputs, outputs) {
    if (this.done) return false;
    const input = inputs[0][0];
    const size = Math.min(this.remaining, outputs[0][0].length);
    let offset = 0;
    while (offset < size) {
      if (!this.used) this.blockStart = currentFrame + offset;
      const count = Math.min(size - offset, this.buffer.length - this.used);
      if (input) this.buffer.set(input.subarray(offset, offset + count), this.used);
      this.used += count;
      offset += count;
      if (this.used === this.buffer.length) this.flush();
    }
    this.remaining -= size;
    if (!this.remaining) this.finish('time limit');
    return !this.done;
  }
}
registerProcessor('vowel-clip-capture', ClipCapture);
