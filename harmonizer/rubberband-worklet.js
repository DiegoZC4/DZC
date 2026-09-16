import createRubberBandLiveModule from "./vendor/RubberBandLive.js?v=20260726-2";

class RubberBandHarmonizerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.module = null;
    this.ready = false;
    this.quantumSize = 128;
    this.inputPointer = 0;
    this.outputLeftPointer = 0;
    this.outputRightPointer = 0;
    this.pendingMessages = [];
    this.intervalCalls = 0;
    this.intervalTotalMs = 0;
    this.intervalMaxMs = 0;
    this.overruns = 0;
    this.warmupCalls = 64;

    this.port.onmessage = (event) => {
      if (this.ready) this.applyMessage(event.data);
      else this.pendingMessages.push(event.data);
    };

    createRubberBandLiveModule({
      print: () => {},
      printErr: () => {},
    }).then((module) => {
      this.module = module;
      module._rb_init(sampleRate, this.quantumSize);
      this.inputPointer = module._rb_input_ptr();
      this.outputLeftPointer = module._rb_output_left_ptr();
      this.outputRightPointer = module._rb_output_right_ptr();
      this.ready = true;
      for (const message of this.pendingMessages) this.applyMessage(message);
      this.pendingMessages = [];
      this.port.postMessage({
        type: "ready",
        blockSize: module._rb_block_size(),
        startDelay: module._rb_start_delay(),
        latencySamples: module._rb_latency_samples(),
        sampleRate,
        maxVoices: 4,
      });
    }).catch((error) => {
      this.port.postMessage({
        type: "error",
        message: error?.message || String(error),
      });
    });
  }

  applyMessage(message) {
    if (!this.module || !message) return;
    if (message.type === "controls") {
      this.module._rb_configure(
        Number(message.gate) || 0,
        Number(message.stability) || 1,
        Number(message.pitchBend) || 0,
        message.formants === false ? 0 : 1,
      );
    } else if (message.type === "voice") {
      this.module._rb_set_voice(
        Number(message.index) || 0,
        Number(message.note) || -1,
        message.gate ? 1 : 0,
        Number.isFinite(message.velocity) ? message.velocity : 1,
      );
    } else if (message.type === "destroy") {
      this.module._rb_destroy();
      this.ready = false;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] || left;
    if (!left) return true;
    left.fill(0);
    if (right !== left) right.fill(0);
    if (!this.ready || left.length !== this.quantumSize) return true;

    const heap = this.module.HEAPF32;
    const inputOffset = this.inputPointer >> 2;
    const leftOffset = this.outputLeftPointer >> 2;
    const rightOffset = this.outputRightPointer >> 2;
    const input = inputs[0]?.[0];
    const inputView = heap.subarray(inputOffset, inputOffset + this.quantumSize);
    if (input) inputView.set(input);
    else inputView.fill(0);

    this.module._rb_process(this.quantumSize);
    const elapsedMs = this.module._rb_process_ms();
    left.set(heap.subarray(leftOffset, leftOffset + this.quantumSize));
    if (right !== left) {
      right.set(heap.subarray(rightOffset, rightOffset + this.quantumSize));
    }

    const quantumMs = 1000 * this.quantumSize / sampleRate;
    if (this.warmupCalls > 0) {
      this.warmupCalls -= 1;
    } else {
      this.intervalCalls += 1;
      this.intervalTotalMs += elapsedMs;
      this.intervalMaxMs = Math.max(this.intervalMaxMs, elapsedMs);
      if (elapsedMs > quantumMs) this.overruns += 1;
    }
    if (this.intervalCalls >= 8) {
      this.port.postMessage({
        type: "pitch",
        audioTime: currentTime,
        sampleClock: this.module._rb_sample_clock(),
        rawMidi: this.module._rb_telemetry(0),
        detectedMidi: this.module._rb_telemetry(1),
        correctionMidi: this.module._rb_telemetry(2),
        rms: this.module._rb_telemetry(3),
        clarity: this.module._rb_telemetry(4),
        stable: this.module._rb_telemetry(5) > 0.5,
        voiced: this.module._rb_telemetry(6) > 0.5,
        energetic: this.module._rb_telemetry(7) > 0.5,
        unvoiced: this.module._rb_telemetry(8) > 0.5,
        sibilance: this.module._rb_telemetry(9),
        dspVoices: this.module._rb_telemetry(10),
        renderAverageMs: this.intervalTotalMs / this.intervalCalls,
        renderMaxMs: this.intervalMaxMs,
        overruns: this.overruns,
        quantumMs,
      });
      this.intervalCalls = 0;
      this.intervalTotalMs = 0;
      this.intervalMaxMs = 0;
    }
    return true;
  }
}

registerProcessor("rubberband-harmonizer", RubberBandHarmonizerProcessor);
