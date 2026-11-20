/* An isolated voice's spectral envelope and short, session-only vowel examples. */
((root, factory) => {
  const tools = factory();
  if (typeof module === "object" && module.exports) module.exports = tools;
  else root.VowelLab = tools;
})(globalThis, function vowelTools() {
  "use strict";
  const RATE = 10000, ORDER = 12, GAP_MS = 225;
  const F1 = Object.freeze([175, 1250]), F2 = Object.freeze([500, 3500]);
  const f1Bark = F1.map(hzToBark), f2Bark = F2.map(hzToBark);
  const TAU = 2 * Math.PI;
  const median = values => {
    const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  };

  // Low-pass before downsampling. Reuse the fractional-delay filters for each input rate.
  function resampler(inputRate, outputRate = RATE, frameSize = 900) {
    const radius = Math.ceil(5 * inputRate / outputRate), cutoff = .46 * Math.min(1, outputRate / inputRate);
    const phases = Array.from({length: 64}, (_, phase) => {
      const weights = Float64Array.from({length: 2 * radius + 1}, (_, i) => {
        const x = i - radius - phase / 64;
        const sinc = Math.abs(x) < 1e-9 ? 2 * cutoff : Math.sin(TAU * cutoff * x) / (Math.PI * x);
        return sinc * (.5 + .5 * Math.cos(Math.PI * x / (radius + 1)));
      });
      const sum = weights.reduce((a,b) => a+b);
      return weights.map(weight => weight/sum);
    });
    return input => {
      const count = Math.min(frameSize, Math.floor((input.length - 2 * radius - 2) * outputRate / inputRate));
      if (count < 300) return null;
      const wave = new Float64Array(count);
      const start = input.length - radius - 1 - count * inputRate / outputRate;
      for (let i = 0; i < count; ++i) {
        const position = start + i * inputRate / outputRate, whole = Math.floor(position);
        const weights = phases[Math.floor((position-whole) * 64)];
        for (let j = 0; j < weights.length; ++j) wave[i] += weights[j] * input[whole-radius+j];
      }
      return wave;
    };
  }

  // First minimum of the cumulative normalized difference. Pitch gates evidence only.
  function fundamental(wave) {
    const maxLag = Math.ceil(RATE / 65), span = wave.length - maxLag;
    let total = 0;
    const difference = new Float64Array(maxLag+1);
    for (let lag = 1; lag <= maxLag; ++lag) {
      let sum = 0;
      for (let i = 0; i < span; ++i) sum += (wave[i] - wave[i+lag]) ** 2;
      total += sum;
      difference[lag] = total > 0 ? sum * lag / total : 1;
      const k = lag-1;
      if (k >= 6 && difference[k] < .16 && difference[k] <= difference[k-1] && difference[k] < difference[lag]) {
        const curvature = difference[k-1] + difference[lag] - 2*difference[k];
        return RATE / (k + .5 * (difference[k-1]-difference[lag]) / curvature);
      }
    }
    return null;
  }

  // Iteratively reweighted covariance LPC. Downweight large prediction residuals
  // (including glottal closure impulses) while retaining the resonance decay.
  // Coefficients stay constant within each 90 ms analysis window.
  function prediction(frame, order = ORDER) {
    const weights = new Float64Array(frame.length).fill(1);
    let coefficients;
    for (let pass = 0; pass < 4; ++pass) {
      const matrix = Array.from({length: order}, () => new Float64Array(order));
      const rhs = new Float64Array(order);
      for (let i = order; i < frame.length; ++i) {
        for (let j = 0; j < order; ++j) {
          const weighted = weights[i] * frame[i-j-1];
          rhs[j] -= weighted * frame[i];
          for (let k = 0; k <= j; ++k) matrix[j][k] += weighted * frame[i-k-1];
        }
      }
      const ridge = matrix.reduce((sum, row, i) => sum + row[i], 0) / order * 1e-8;
      for (let j = 0; j < order; ++j) {
        for (let k = 0; k <= j; ++k) {
          let value = matrix[j][k] + (j === k ? ridge : 0);
          for (let p = 0; p < k; ++p) value -= matrix[j][p] * matrix[k][p];
          if (j === k) {
            if (!(value > 0)) return null;
            matrix[j][k] = Math.sqrt(value);
          } else matrix[j][k] = value / matrix[k][k];
        }
      }
      for (let j = 0; j < order; ++j) {
        for (let k = 0; k < j; ++k) rhs[j] -= matrix[j][k] * rhs[k];
        rhs[j] /= matrix[j][j];
      }
      coefficients = new Float64Array(order + 1);
      coefficients[0] = 1;
      for (let j = order-1; j >= 0; --j) {
        let value = rhs[j];
        for (let k = j+1; k < order; ++k) value -= matrix[k][j] * coefficients[k+1];
        coefficients[j+1] = value / matrix[j][j];
      }
      if (pass === 3) break;
      const residuals = new Float64Array(frame.length);
      for (let i = order; i < frame.length; ++i) {
        let residual = frame[i];
        for (let j = 1; j <= order; ++j) residual += coefficients[j] * frame[i-j];
        residuals[i] = Math.abs(residual);
      }
      const scale = Math.max(1e-8, median(residuals.subarray(order)) * 1.4826);
      for (let i = order; i < frame.length; ++i) weights[i] = Math.max(.02, Math.min(1, scale / Math.max(residuals[i], 1e-12)));
    }
    return coefficients;
  }

  function hasHarmonics(frame, pitch) {
    // A sine or two narrow components can be periodic and still carry no vowel envelope.
    const powers = [];
    for (let f=pitch; f<=3800; f+=pitch) {
      const coefficient = 2 * Math.cos(TAU * f / RATE);
      let prev=0, older=0;
      for (const value of frame) {
        const next = value + coefficient*prev - older;
        older=prev; prev=next;
      }
      powers.push(prev*prev + older*older - coefficient*prev*older);
    }
    const floor = Math.max(...powers) * .001;
    return powers.filter(power => power > floor).length >= 5;
  }

  function makeEstimator() {
    let lastRate, sample;
    const step = 10, bins = 391;
    const cos = new Float64Array(bins*(ORDER+1)), sin = new Float64Array(cos.length);
    for (let i=0; i<bins; ++i) for (let j=1; j<=ORDER; ++j) {
      const phase = TAU * i * step * j / RATE, index = i*(ORDER+1)+j;
      cos[index] = Math.cos(phase); sin[index] = Math.sin(phase);
    }
    function resonances(a, f0) {
      const db = new Float64Array(bins);
      for (let i=0; i<bins; ++i) {
        let re=1, im=0;
        for (let j=1; j<a.length; ++j) { re+=a[j]*cos[i*(ORDER+1)+j]; im+=a[j]*sin[i*(ORDER+1)+j]; }
        db[i] = -10*Math.log10(re*re+im*im);
      }
      const peaks = [];
      for (let i=1; i<bins-1; ++i) if (db[i]>db[i-1] && db[i]>=db[i+1]) peaks.push(i);
      // Both resonances must rise above their shared valley and their outer shoulders.
      const [first, second] = peaks.filter((i,n) => {
        if (i*step < 120) return false;
        const left=Math.min(...db.subarray(peaks[n-1] ?? 0,i+1));
        const right=Math.min(...db.subarray(i,(peaks[n+1] ?? bins-1)+1));
        return db[i]-Math.max(left,right)>1.2;
      });
      if (second === undefined) return null;
      const f1=first*step, f2=second*step;
      if (f1 < Math.max(F1[0],1.2*f0) || f1>F1[1] || f2<F2[0] || f2>F2[1] || f2-f1<200) return null;
      const valley = Math.min(...db.subarray(first,second+1));
      if (Math.min(db[first],db[second])-valley < 2 || db[first]-Math.min(...db.subarray(0,first)) < 2
        || db[second]-Math.min(...db.subarray(second,Math.min(bins,second+46))) < 2) return null;
      return {f1, f2};
    }
    return (input, sampleRate) => {
      if (!Number.isFinite(sampleRate) || sampleRate < RATE || sampleRate > 192000) return null;
      if (lastRate !== sampleRate) { sample = resampler(sampleRate); lastRate = sampleRate; }
      const wave = sample(input);
      if (!wave) return null;
      const mean = wave.reduce((a,b) => a+b) / wave.length;
      for (let i=0; i<wave.length; ++i) wave[i] -= mean;
      const power = wave.reduce((sum, value) => sum + value*value, 0) / wave.length;
      if (!(power > .0025 ** 2)) return null;
      const f0 = fundamental(wave);
      if (!f0 || f0 < 65) return null;
      const frame = Float64Array.from(wave, (value,i) => value - .97*(wave[i-1] ?? value));
      if (!hasHarmonics(frame, f0)) return null;
      const candidates = [8,10,12].map(order => {
        const coefficients = prediction(frame, order);
        return coefficients ? resonances(coefficients, f0) : null;
      }).filter(Boolean);
      // At least two model orders must resolve the same pair. Never fill in a
      // missing resonance from a vowel landmark or the note being sung.
      const agrees = (a,b) => Math.abs(a.f1-b.f1) <= 70 && Math.abs(a.f2-b.f2) <= 120;
      const groups = candidates.map(a => candidates.filter(b => agrees(a,b)));
      const group = groups.sort((a,b) => b.length-a.length)[0];
      if (!group || group.length < 2) return null;
      return {f1: median(group.map(p => p.f1)), f2: median(group.map(p => p.f2))};
    };
  }

  // Zwicker & Terhardt (1980), eq. 1. The argument is absolute frequency in Hz.
  function hzToBark(hz) {
    return 13 * Math.atan(0.00076 * hz) + 3.5 * Math.atan((hz / 7500) ** 2);
  }

  function chartPoint({f1, f2}) {
    return {
      x: (f2Bark[1] - hzToBark(f2)) / (f2Bark[1] - f2Bark[0]),
      y: (hzToBark(f1) - f1Bark[0]) / (f1Bark[1] - f1Bark[0]),
    };
  }

  function chartFormants({x, y}) {
    function invert(fraction, limits, barks) {
      if (fraction <= 0) return limits[0];
      if (fraction >= 1) return limits[1];
      const target = barks[0] + fraction * (barks[1] - barks[0]);
      let [low, high] = limits;
      for (let i = 0; i < 28; i++) {
        const mid = (low + high) / 2;
        if (hzToBark(mid) < target) low = mid;
        else high = mid;
      }
      return (low + high) / 2;
    }
    return {f1: invert(y, F1, f1Bark), f2: invert(1 - x, F2, f2Bark)};
  }

  // Adapted from VocalTrack's MIT-licensed Smoother.py (see THIRD-PARTY-NOTICES.txt).
  // Filter log(Hz + 1), then return absolute Hz before the fixed Bark projection.
  // Pitch is deliberately absent: an octave change must not move a fixed vowel.
  const SMOOTHING = Object.freeze({
    memory: 3, stability: .15, skipTolerance: 2,
    minCutoff: .05, beta: 1.5, derivativeCutoff: .5, velocityPower: 1.5,
    maxGapMs: GAP_MS,
  });
  function makeFormantSmoother() {
    let history, candidates, position, velocity, lastInput, lastAccepted, skipped;
    function reset() {
      history = []; candidates = []; position = null; velocity = [0, 0];
      lastInput = lastAccepted = null; skipped = 0;
    }
    reset();
    const stable = values => values.length === SMOOTHING.memory && values.every((v, i) =>
      i === 0 || v.every((x, channel) => Math.abs(x-values[i-1][channel]) <= SMOOTHING.stability));
    function push(formants, timeMs) {
      if (!formants || !Number.isFinite(timeMs) ||
          !Number.isFinite(formants.f1) || !Number.isFinite(formants.f2) ||
          formants.f1 < F1[0] || formants.f1 > F1[1] ||
          formants.f2 < F2[0] || formants.f2 > F2[1] || formants.f2 <= formants.f1) {
        reset(); return null;
      }
      if (lastInput !== null && timeMs <= lastInput) { reset(); return null; }
      if (lastInput !== null && timeMs-lastInput > SMOOTHING.maxGapMs) reset();
      lastInput = timeMs;
      const values = [Math.log1p(formants.f1), Math.log1p(formants.f2)];
      candidates = [...candidates, values].slice(-SMOOTHING.memory);
      let next = [...history, values].slice(-SMOOTHING.memory);
      if (!position) {
        history = candidates;
        if (!stable(history)) return null;
      } else if (!stable(next)) {
        // Reject a brief spike without feeding it into the filter. Three new,
        // mutually consistent estimates may start a new vowel immediately;
        // unlike rollback-only history, this cannot lock onto the old vowel.
        if (++skipped <= SMOOTHING.skipTolerance) return null;
        position = null; velocity = [0, 0]; lastAccepted = null;
        history = candidates;
        if (!stable(history)) return null;
      } else history = next;
      if (!position) position = values;
      else {
        const dt = (timeMs-lastAccepted)/1000;
        const alpha = cutoff => 1/(1 + 1/(2*Math.PI*cutoff*dt));
        position = values.map((x, channel) => {
          const speed = (x-position[channel])/dt;
          const aD = alpha(SMOOTHING.derivativeCutoff);
          velocity[channel] = aD*speed + (1-aD)*velocity[channel];
          const cutoff = Math.max(1e-6, SMOOTHING.minCutoff +
            SMOOTHING.beta*Math.abs(velocity[channel])**SMOOTHING.velocityPower);
          const a = alpha(cutoff);
          return a*x + (1-a)*position[channel];
        });
      }
      lastAccepted = timeMs; skipped = 0;
      return {f1: Math.expm1(position[0]), f2: Math.expm1(position[1])};
    }
    return {push, reset};
  }

  // Disconnected runs retain their real onset times for diphthong comparisons.
  function strokes(frames) {
    const result = [];
    let previous;
    for (const frame of frames) {
      if (frame.f1 != null) {
        if (!previous || previous.f1 == null || frame.t-previous.t > GAP_MS) result.push([]);
        result.at(-1).push(frame);
      }
      previous = frame;
    }
    return result;
  }

  function referenceExample(frames) {
    const runs = strokes(frames);
    if (!runs.length) return null;
    const onset=runs[0][0].t, end=runs.at(-1).at(-1).t;
    // Drop attacks/releases and find a steady, central 300 ms from a single voiced run.
    // Keep the whole demonstrator's path separately, including the vowel closure.
    let middle, best=Infinity;
    for (const run of runs) {
      const trim = Math.min(140, (run.at(-1).t-run[0].t)*.12);
      const interior = run.filter(p => p.t>=run[0].t+trim && p.t<=run.at(-1).t-trim);
      for (let i=0; i<interior.length; ++i) {
        const group = interior.slice(i).filter(p => p.t-interior[i].t<=360);
        if (group.length<4 || group.at(-1).t-group[0].t<250) continue;
        const one=group.map(p=>p.f1), two=group.map(p=>p.f2);
        const spread1=Math.max(...one)-Math.min(...one), spread2=Math.max(...two)-Math.min(...two);
        if (spread1>105 || spread2>175) continue;
        const center=(group[0].t+group.at(-1).t)/2;
        const cost=spread1/105+spread2/175+.25*Math.abs(2*center-end-onset)/(end-onset);
        if (cost<best) { best=cost; middle={f1:median(one), f2:median(two)}; }
      }
    }
    return middle ? {middle, runs:runs.map(run=>run.map(({f1,f2,t})=>({f1,f2,t:t-onset})))} : null;
  }

  return {makeEstimator, makeFormantSmoother, SMOOTHING, hzToBark, chartPoint, chartFormants, F1, F2, strokes, referenceExample, resampler, fundamental, RATE};
});
