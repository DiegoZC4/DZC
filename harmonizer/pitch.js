export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function frequencyToMidi(frequency) {
  return frequency > 0 ? 69 + 12 * Math.log2(frequency / 440) : -1;
}

export function midiToFrequency(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

export function midiName(note) {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const rounded = Math.round(note);
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

export function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return NaN;
  return valid[Math.floor(valid.length / 2)];
}

export function rmsOf(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

// YIN's cumulative mean normalized difference function is robust enough for
// live monophonic voice tracking without adding another runtime dependency.
export function detectPitch(samples, sampleRate, options = {}) {
  const minHz = options.minHz ?? midiToFrequency(33);
  const maxHz = options.maxHz ?? midiToFrequency(84);
  const threshold = options.threshold ?? 0.13;
  const rms = rmsOf(samples);
  if (rms < (options.gate ?? 0)) return { frequency: -1, clarity: 0, rms };

  const maxTau = Math.min(Math.floor(samples.length / 2), Math.floor(sampleRate / minHz));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxTau <= minTau + 2) return { frequency: -1, clarity: 0, rms };

  const difference = new Float64Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    const limit = samples.length - tau;
    for (let index = 0; index < limit; index += 1) {
      const delta = samples[index] - samples[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  let runningSum = 0;
  difference[0] = 1;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    difference[tau] = runningSum > 0 ? difference[tau] * tau / runningSum : 1;
  }

  let tau = -1;
  for (let candidate = minTau; candidate < maxTau; candidate += 1) {
    if (difference[candidate] < threshold) {
      tau = candidate;
      while (tau + 1 <= maxTau && difference[tau + 1] < difference[tau]) tau += 1;
      break;
    }
  }
  if (tau < 0) {
    let best = minTau;
    for (let candidate = minTau + 1; candidate <= maxTau; candidate += 1) {
      if (difference[candidate] < difference[best]) best = candidate;
    }
    if (difference[best] > 0.28) return { frequency: -1, clarity: 0, rms };
    tau = best;
  }

  const left = difference[Math.max(1, tau - 1)];
  const center = difference[tau];
  const right = difference[Math.min(maxTau, tau + 1)];
  const denominator = left - 2 * center + right;
  const refinedTau = Math.abs(denominator) > 1e-12
    ? tau + 0.5 * (left - right) / denominator
    : tau;
  const frequency = sampleRate / refinedTau;
  if (!Number.isFinite(frequency) || frequency < minHz || frequency > maxHz) {
    return { frequency: -1, clarity: 0, rms };
  }
  return { frequency, clarity: clamp(1 - center, 0, 1), rms };
}

const insertSorted = (values, length) => {
  for (let index = 1; index < length; index += 1) {
    const value = values[index];
    let destination = index - 1;
    while (destination >= 0 && values[destination] > value) {
      values[destination + 1] = values[destination];
      destination -= 1;
    }
    values[destination + 1] = value;
  }
};

// Allocation-free, streaming YIN control tracker for AudioWorklet use.
export class RealtimePitchTracker {
  constructor(sampleRate, options = {}) {
    this.sampleRate = sampleRate;
    this.windowSize = options.windowSize ?? 2048;
    this.hopSize = options.hopSize ?? 512;
    this.decimation = options.decimation ?? 2;
    this.analysisSize = Math.floor(this.windowSize / this.decimation);
    this.analysisRate = sampleRate / this.decimation;
    this.minHz = options.minHz ?? midiToFrequency(32);
    this.maxHz = options.maxHz ?? midiToFrequency(84);
    this.threshold = options.threshold ?? 0.13;
    this.gate = options.gate ?? 0.01;
    this.stability = options.stability ?? 1;

    this.ring = new Float32Array(this.windowSize);
    this.analysis = new Float32Array(this.analysisSize);
    this.difference = new Float32Array(
      Math.min(
        Math.floor(this.analysisSize / 2),
        Math.floor(this.analysisRate / this.minHz),
      ) + 1,
    );
    this.pitchHistory = new Float32Array(9);
    this.pitchHistory.fill(-1);
    this.sortedPitch = new Float32Array(this.pitchHistory.length);
    this.correctionHistory = new Float32Array(16);
    this.correctionHistory.fill(-1);

    this.ringWrite = 0;
    this.ringFill = 0;
    this.hopCounter = 0;
    this.sampleClock = 0;
    this.hopEnergy = 0;
    this.hopHighEnergy = 0;
    this.hopCrossings = 0;
    this.lowpass = 0;
    this.previousHighSign = 0;
    this.pitchHistoryWrite = 0;
    this.correctionHistoryWrite = 0;
    this.holdFrames = 0;
    this.heldSourceMidi = -1;
    this.heldSilenceSamples = 0;

    this.rawMidi = -1;
    this.detectedMidi = -1;
    this.correctionMidi = -1;
    this.rms = 0;
    this.clarity = 0;
    this.stable = false;
    this.voiced = false;
    this.energetic = false;
    this.unvoiced = false;
    this.sibilance = 0;
  }

  configure(options = {}) {
    if (Number.isFinite(options.gate)) this.gate = Math.max(0, options.gate);
    if (Number.isFinite(options.stability)) {
      this.stability = clamp(options.stability, 0.05, 12);
    }
  }

  push(samples) {
    let analyzed = false;
    const lowpassCoefficient = 1 - Math.exp(-2 * Math.PI * 3000 / this.sampleRate);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      this.ring[this.ringWrite] = sample;
      this.ringWrite = (this.ringWrite + 1) % this.windowSize;
      this.ringFill = Math.min(this.ringFill + 1, this.windowSize);
      this.sampleClock += 1;
      this.hopCounter += 1;
      this.hopEnergy += sample * sample;

      this.lowpass += lowpassCoefficient * (sample - this.lowpass);
      const high = sample - this.lowpass;
      this.hopHighEnergy += high * high;
      const sign = high > 0.0005 ? 1 : high < -0.0005 ? -1 : 0;
      if (sign !== 0) {
        if (this.previousHighSign !== 0 && sign !== this.previousHighSign) {
          this.hopCrossings += 1;
        }
        this.previousHighSign = sign;
      }

      if (this.hopCounter >= this.hopSize) {
        this.analyze();
        analyzed = true;
      }
    }
    return analyzed;
  }

  analyze() {
    this.rms = Math.sqrt(this.hopEnergy / Math.max(1, this.hopCounter));
    const highBandRatio = this.hopHighEnergy / Math.max(this.hopEnergy, 1e-12);
    const crossingsPer8ms = this.hopCrossings
      * (0.008 * this.sampleRate / Math.max(1, this.hopCounter));
    this.sibilance = clamp(
      Math.min(highBandRatio / 0.4, crossingsPer8ms / 16),
      0,
      4,
    );
    const sibilant = highBandRatio >= 0.4 && crossingsPer8ms >= 16;
    this.hopCounter = 0;
    this.hopEnergy = 0;
    this.hopHighEnergy = 0;
    this.hopCrossings = 0;
    this.previousHighSign = 0;

    const detectorGate = this.gate * (this.voiced ? 0.55 : 1);
    let frequency = -1;
    this.clarity = 0;
    if (this.ringFill >= this.windowSize && this.rms >= detectorGate) {
      const result = this.detectWindow();
      frequency = result.frequency;
      this.clarity = result.clarity;
    }
    let rawMidi = frequency > 0 ? frequencyToMidi(frequency) : -1;
    if (sibilant && highBandRatio >= 0.65) rawMidi = -1;
    this.rawMidi = rawMidi;

    this.correctionHistory[this.correctionHistoryWrite] = rawMidi;
    this.correctionHistoryWrite =
      (this.correctionHistoryWrite + 1) % this.correctionHistory.length;
    const delayedIndex =
      (this.correctionHistoryWrite - 2 + this.correctionHistory.length)
      % this.correctionHistory.length;
    const delayedCorrection = this.correctionHistory[delayedIndex];
    if (rawMidi > 0) {
      this.correctionMidi = delayedCorrection > 0 ? delayedCorrection : rawMidi;
    } else if (this.holdFrames <= 0) {
      this.correctionMidi = -1;
    }

    this.pitchHistory[this.pitchHistoryWrite] = rawMidi;
    this.pitchHistoryWrite =
      (this.pitchHistoryWrite + 1) % this.pitchHistory.length;
    let validCount = 0;
    for (let index = 0; index < this.pitchHistory.length; index += 1) {
      const value = this.pitchHistory[index];
      if (value > 0) this.sortedPitch[validCount++] = value;
    }
    insertSorted(this.sortedPitch, validCount);
    const detected = validCount > 0
      ? this.sortedPitch[Math.floor(validCount / 2)]
      : -1;
    let agree = 0;
    for (let index = 0; index < validCount; index += 1) {
      if (Math.abs(this.sortedPitch[index] - detected) < this.stability) agree += 1;
    }

    const releaseGate = this.gate * 0.55;
    const stable = validCount >= 3
      && agree * 2 > validCount
      && this.rms >= releaseGate;
    const articulationGate = Math.max(0.0005, this.gate * 0.2);
    this.energetic = this.rms >= articulationGate;
    if (stable) {
      if (this.detectedMidi < 0 || Math.abs(detected - this.detectedMidi) > 1.5) {
        this.detectedMidi = detected;
      } else {
        this.detectedMidi += clamp(detected - this.detectedMidi, -2, 2) * 0.3;
      }
      this.stable = true;
      this.voiced = true;
      this.holdFrames = 10;
    } else if (this.voiced && this.holdFrames > 0 && this.energetic) {
      this.stable = false;
      this.holdFrames -= 1;
    } else {
      this.detectedMidi = -1;
      this.stable = false;
      this.voiced = false;
      this.holdFrames = 0;
    }

    if (this.stable && this.correctionMidi > 0 && this.energetic) {
      this.heldSourceMidi = this.correctionMidi;
      this.heldSilenceSamples = 0;
    } else if (this.energetic) {
      this.heldSilenceSamples = 0;
    } else if (this.heldSourceMidi > 0) {
      this.heldSilenceSamples += this.hopSize;
      if (this.heldSilenceSamples >= this.sampleRate * 0.8) {
        this.heldSourceMidi = -1;
        this.heldSilenceSamples = 0;
      }
    }

    this.unvoiced = this.energetic
      && this.heldSourceMidi > 0
      && (sibilant || !this.stable);
    if (this.unvoiced) {
      this.voiced = true;
      this.correctionMidi = this.heldSourceMidi;
    } else if (!this.voiced && !this.energetic) {
      this.correctionMidi = -1;
    }
  }

  detectWindow() {
    for (let index = 0; index < this.analysisSize; index += 1) {
      let source = (this.ringWrite + index * this.decimation) % this.windowSize;
      let sum = 0;
      for (let offset = 0; offset < this.decimation; offset += 1) {
        sum += this.ring[source];
        source = (source + 1) % this.windowSize;
      }
      this.analysis[index] = sum / this.decimation;
    }

    const maxTau = Math.min(
      this.difference.length - 1,
      Math.floor(this.analysisRate / this.minHz),
    );
    const minTau = Math.max(2, Math.floor(this.analysisRate / this.maxHz));
    for (let tau = 1; tau <= maxTau; tau += 1) {
      let sum = 0;
      const limit = this.analysisSize - tau;
      for (let index = 0; index < limit; index += 1) {
        const delta = this.analysis[index] - this.analysis[index + tau];
        sum += delta * delta;
      }
      this.difference[tau] = sum;
    }

    let runningSum = 0;
    this.difference[0] = 1;
    for (let tau = 1; tau <= maxTau; tau += 1) {
      runningSum += this.difference[tau];
      this.difference[tau] = runningSum > 0
        ? this.difference[tau] * tau / runningSum
        : 1;
    }

    let tau = -1;
    for (let candidate = minTau; candidate < maxTau; candidate += 1) {
      if (this.difference[candidate] < this.threshold) {
        tau = candidate;
        while (
          tau + 1 <= maxTau
          && this.difference[tau + 1] < this.difference[tau]
        ) {
          tau += 1;
        }
        break;
      }
    }
    if (tau < 0) {
      let best = minTau;
      for (let candidate = minTau + 1; candidate <= maxTau; candidate += 1) {
        if (this.difference[candidate] < this.difference[best]) best = candidate;
      }
      if (this.difference[best] > 0.28) {
        return { frequency: -1, clarity: 0 };
      }
      tau = best;
    }

    const left = this.difference[Math.max(1, tau - 1)];
    const center = this.difference[tau];
    const right = this.difference[Math.min(maxTau, tau + 1)];
    const denominator = left - 2 * center + right;
    const refinedTau = Math.abs(denominator) > 1e-12
      ? tau + 0.5 * (left - right) / denominator
      : tau;
    const frequency = this.analysisRate / refinedTau;
    if (!Number.isFinite(frequency) || frequency < this.minHz || frequency > this.maxHz) {
      return { frequency: -1, clarity: 0 };
    }
    return { frequency, clarity: clamp(1 - center, 0, 1) };
  }

  snapshot(audioTime = 0) {
    return {
      type: "pitch",
      audioTime,
      sampleClock: this.sampleClock,
      rawMidi: this.rawMidi,
      detectedMidi: this.detectedMidi,
      correctionMidi: this.correctionMidi,
      rms: this.rms,
      clarity: this.clarity,
      stable: this.stable,
      voiced: this.voiced,
      energetic: this.energetic,
      unvoiced: this.unvoiced,
      sibilance: this.sibilance,
    };
  }
}
