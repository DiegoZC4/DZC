/* Analysis-only vocal pitch cleanup, shared by live Sing and saved takes. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteVocalPitch = api;
})(globalThis, function vocalPitchTools() {
  "use strict";
  const HIGH_PASS_HZ = 40;
  const OCTAVE_ISLAND_SECONDS = 0.08;
  const OCTAVE_FLANK_SECONDS = 0.04;
  const OCTAVE_TOLERANCE_CENTS = 80;
  const OCTAVE_DROPOUT_SECONDS = 0.25;
  const OCTAVE_CONTEXT_SECONDS = 0.4;

  function repairMovingOctaves(frames) {
    let result = frames;
    const timed = f => f && Number.isFinite(f.start) && Number.isFinite(f.end) && f.end > f.start;
    const voiced = f => timed(f) && Number.isFinite(f.cents);
    const connected = (a, b) => timed(a) && timed(b) && b.start > a.start && Math.abs(b.start - a.end) < 1e-6;
    const near = (a, b) => Math.abs(a - b) <= OCTAVE_TOLERANCE_CENTS;
    // Onsets can move while the detector briefly chooses the wrong octave.
    // Require continuous local context at BOTH edges, not a flat target note.
    function supported(edge, direction) {
      let previous = frames[edge], observed = 0, count = 0, gaps = 0;
      for (let j = edge; j >= 0 && j < frames.length; j += direction) {
        const frame = frames[j];
        if (!timed(frame) || Math.abs(frame.start - frames[edge].start) > .12) return false;
        if (j !== edge && !(direction > 0 ? connected(frames[j - 1], frame) : connected(frame, frames[j + 1]))) return false;
        if (frame.cents === null) {
          gaps += frame.end - frame.start;
          if (gaps > .05 + 1e-6) return false;
          continue;
        }
        if (!voiced(frame) || Math.abs(frame.cents - frames[edge].cents) > 200
          || Math.abs(frame.cents - previous.cents) > 120) return false;
        observed += frame.end - frame.start;
        previous = frame;
        if (++count >= 3 && observed >= OCTAVE_FLANK_SECONDS - 1e-6) return true;
      }
      return false;
    }
    for (let i = 1; i < frames.length - 1; i++) {
      const before = frames[i - 1], first = frames[i];
      if (!voiced(before) || !voiced(first) || !connected(before, first)) continue;
      const shift = 1200 * Math.round((first.cents - before.cents) / 1200);
      if (Math.abs(shift) !== 1200 || !near(first.cents - shift, before.cents) || !supported(i - 1, -1)) continue;
      const suspect = [i];
      let previous = first.cents - shift, observed = first.end - first.start, gaps = 0;
      for (let j = i + 1; j < frames.length && observed <= OCTAVE_ISLAND_SECONDS + 1e-6; j++) {
        const frame = frames[j];
        if (!connected(frames[j - 1], frame) || frame.end - first.start > .2) break;
        if (frame.cents === null) {
          gaps += frame.end - frame.start;
          if (gaps > .05 + 1e-6) break;
          continue;
        }
        if (!voiced(frame)) break;
        if (near(frame.cents, previous)) {
          if (frame.start - first.start > OCTAVE_ISLAND_SECONDS + 1e-6) break;
          if (!supported(j, 1)) break;
          if (result === frames) result = frames.slice();
          for (const index of suspect) result[index] = {...frames[index],
            rawCents: frames[index].rawCents ?? frames[index].cents, cents: frames[index].cents - shift};
          i = j - 1;
          break;
        }
        const corrected = frame.cents - shift;
        if (!near(corrected, previous) || Math.abs(corrected - before.cents) > 200) break;
        previous = corrected;
        observed += frame.end - frame.start;
        suspect.push(j);
      }
    }
    return result;
  }

  function repairOctaveIslands(frames) {
    let result = frames;
    const timed = frame => frame && Number.isFinite(frame.start)
      && Number.isFinite(frame.end) && frame.end > frame.start;
    const voiced = frame => timed(frame) && Number.isFinite(frame.cents);
    const connected = (a, b) => timed(a) && timed(b)
      && b.start > a.start && Math.abs(b.start - a.end) < 1e-6;
    const near = (a, b) => Math.abs(a - b) <= OCTAVE_TOLERANCE_CENTS;
    for (let i = 1; i < frames.length - 1; i++) {
      const before = frames[i - 1], first = frames[i];
      if (!voiced(before) || !connected(before, first)) continue;
      const base = before.cents;
      if (voiced(first) && near(first.cents, base)) continue;
      let left = i - 1;
      while (left > 0 && (i - left < 3 || first.start - frames[left].start < OCTAVE_FLANK_SECONDS - 1e-6)
        && connected(frames[left - 1], frames[left]) && voiced(frames[left - 1])
        && near(frames[left - 1].cents, base)) left--;
      if (i - left < 3 || first.start - frames[left].start < OCTAVE_FLANK_SECONDS - 1e-6) continue;
      let shift = 0, octaveSeconds = 0, dropoutSeconds = 0, right = -1;
      const suspect = [];
      for (let j = i; j < frames.length; j++) {
        const frame = frames[j];
        if (!connected(frames[j - 1], frame)
          || frame.end - first.start > OCTAVE_CONTEXT_SECONDS + 1e-6) break;
        const duration = frame.end - frame.start;
        if (frame.cents === null) {
          dropoutSeconds += duration;
          if (dropoutSeconds > OCTAVE_DROPOUT_SECONDS + 1e-6) break;
          right = -1;
        } else if (voiced(frame) && near(frame.cents, base)) {
          if (right < 0) right = j;
          if (j - right + 1 < 3 || frame.end - frames[right].start < OCTAVE_FLANK_SECONDS - 1e-6) continue;
          if (suspect.length) {
            // Look through a short dropout for stable context, but never fill
            // it. Correct only actual octave observations, from raw evidence.
            if (result === frames) result = frames.slice();
            for (const index of suspect) result[index] = {...frames[index],
              rawCents: frames[index].rawCents ?? frames[index].cents, cents: frames[index].cents - shift};
            i = right - 1;
          }
          break;
        } else {
          const offset = 1200 * Math.round((frame.cents - base) / 1200);
          if (!voiced(frame) || Math.abs(offset) !== 1200 || (shift && offset !== shift)
            || !near(frame.cents - offset, base)) break;
          shift = offset;
          octaveSeconds += duration;
          if (octaveSeconds > OCTAVE_ISLAND_SECONDS + 1e-6) break;
          suspect.push(j);
          right = -1;
        }
      }
    }
    return repairMovingOctaves(result);
  }

  function repairPitchGrid(pitches, secondsAtBin) {
    // A legacy score-tick grid alone does not establish elapsed audio time.
    if (typeof secondsAtBin !== "function") return {pitches, rawOctaves: new Map()};
    const frames = Array.from(pitches, (cents, i) => ({
      start: secondsAtBin(i), end: secondsAtBin(i + 1), cents: cents || null,
    }));
    const cleaned = repairOctaveIslands(frames), rawOctaves = new Map();
    let output = pitches;
    cleaned.forEach((frame, i) => {
      if (frame.cents === frames[i].cents) return;
      if (output === pitches) output = pitches.slice();
      output[i] = frame.cents;
      rawOctaves.set(i, {before: pitches[i], after: output[i]});
    });
    return {pitches: output, rawOctaves};
  }

  function restorePitchGrid(pitches, repairs = []) {
    let output = pitches;
    const rawOctaves = new Map();
    if (!Array.isArray(repairs)) return {pitches, rawOctaves};
    for (const repair of repairs) {
      if (!Array.isArray(repair) || repair.length !== 3) continue;
      const [bin, before, after] = repair;
      if (![bin, before, after].every(Number.isInteger) || bin < 0 || bin >= pitches.length
        || before !== pitches[bin] || after < 2000 || after > 11000
        || Math.abs(after - before) !== 1200 || rawOctaves.has(bin)) continue;
      if (output === pitches) output = pitches.slice();
      output[bin] = after;
      rawOctaves.set(bin, {before, after});
    }
    return {pitches: output, rawOctaves};
  }

  function rawPitchGrid(pitches, rawOctaves) {
    if (!rawOctaves?.size) return pitches;
    const output = pitches.slice();
    for (const [i, {before, after}] of rawOctaves) if (output[i] === after) output[i] = before;
    return output;
  }

  function createDetector(PitchDetector, size) {
    const detector = PitchDetector.forFloat32Array(size);
    detector.minVolumeAbsolute = 0;
    const filtered = new Float32Array(size);
    let rate = 0, a1, a2, b0;
    return {
      set clarityThreshold(value) { detector.clarityThreshold = value; },
      findPitch(input, sampleRate) {
        const primary = detector.findPitch(input, sampleRate);
        const usable = ([frequency, clarity]) => frequency >= 55 && frequency <= 1200 && clarity >= 0.85;
        // Leave confident raw estimates untouched, including genuine wrong notes.
        if (usable(primary)) return primary;
        if (sampleRate !== rate) {
          rate = sampleRate;
          const w = 2 * Math.PI * HIGH_PASS_HZ / rate;
          const c = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2;
          a1 = -2 * c / (1 + alpha);
          a2 = (1 - alpha) / (1 + alpha);
          b0 = (1 + c) / (2 * (1 + alpha));
        }
        // Windows can overlap or skip, so start each at its initial DC level.
        // This second-order Butterworth cutoff stays below the 55 Hz vocal floor.
        let x1 = input[0] || 0, x2 = x1, y1 = 0, y2 = 0;
        for (let i = 0; i < size; i++) {
          const x = input[i];
          const y = b0 * (x - 2 * x1 + x2) - a1 * y1 - a2 * y2;
          filtered[i] = y;
          x2 = x1; x1 = x; y2 = y1; y1 = y;
        }
        // A reverse pass removes filter phase delay from the pitch window.
        x1 = x2 = filtered[size - 1]; y1 = y2 = 0;
        for (let i = size - 1; i >= 0; i--) {
          const x = filtered[i];
          const y = b0 * (x - 2 * x1 + x2) - a1 * y1 - a2 * y2;
          filtered[i] = y;
          x2 = x1; x1 = x; y2 = y1; y1 = y;
        }
        const alternate = detector.findPitch(filtered, sampleRate);
        return usable(alternate) ? alternate : primary;
      },
    };
  }

  function source() { return `globalThis.MeleteVocalPitch = (${vocalPitchTools.toString()})();`; }
  return {HIGH_PASS_HZ, OCTAVE_ISLAND_SECONDS, OCTAVE_FLANK_SECONDS,
    OCTAVE_TOLERANCE_CENTS, OCTAVE_DROPOUT_SECONDS, OCTAVE_CONTEXT_SECONDS,
    repairOctaveIslands, repairPitchGrid, restorePitchGrid, rawPitchGrid, createDetector, source};
});
