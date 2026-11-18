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
  const LIVE_GAP_SECONDS = 0.04;
  const timed = f => f && Number.isFinite(f.start) && Number.isFinite(f.end) && f.end > f.start;
  // Live windows have scheduler gaps. They can supply neighbouring evidence,
  // but the unobserved interval is never filled or counted as tracked singing.
  const connected = (a, b) => timed(a) && timed(b) && b.start > a.start
    && b.start >= a.end - 1e-8
    && b.start - a.end <= (a.live && b.live ? LIVE_GAP_SECONDS : 1e-6);

  // A periodic consonant/noise burst can have high detector clarity but no
  // musical support. Omit it, rather than inventing its intended octave.
  // This uses only neighbouring observations, never the score's target pitch.
  function cleanPitchFrames(frames, {livePreview = false} = {}) {
    const repaired = repairOctaveIslands(frames);
    let result = repaired;
    const voiced = f => f && Number.isFinite(f.cents);
    const silent = f => timed(f) && f.cents === null && !f.omitted;
    const omit = (from, to) => {
      if (result === repaired) result = repaired.slice();
      for (let j = from; j < to; j++) if (voiced(repaired[j])) result[j] = {
        ...repaired[j], cents: null, rawCents: repaired[j].rawCents ?? repaired[j].cents, omitted: true,
      };
    };
    for (let i = 0; i < repaired.length;) {
      if (!voiced(repaired[i])) { i++; continue; }
      let end = i + 1;
      while (end < repaired.length && connected(repaired[end-1], repaired[end]) && voiced(repaired[end])
        && Math.abs(repaired[end].cents - repaired[i].cents) < 400) end++;
      const duration = repaired[end-1].end - repaired[i].start;
      const before = repaired[i-1], after = repaired[end];
      if (duration <= .08 + 1e-6 && silent(before) && silent(after)) {
        let left = i-1, right = end;
        while (left > 0 && silent(repaired[left-1]) && connected(repaired[left-1], repaired[left])) left--;
        while (right+1 < repaired.length && silent(repaired[right+1]) && connected(repaired[right], repaired[right+1])) right++;
        if (repaired[i].start - repaired[left].start >= .04 - 1e-6
          && repaired[right].end - repaired[end-1].end >= .04 - 1e-6) omit(i, end);
      } else if (duration <= .02 + 1e-6 && voiced(before) && silent(after)
        && connected(before, repaired[i]) && connected(repaired[end-1], after)
        && Math.abs(repaired[i].cents - before.cents) > 650) {
        let left = i - 1, right = end;
        while (left > 0 && voiced(repaired[left-1]) && connected(repaired[left-1], repaired[left])
          && Math.abs(repaired[left-1].cents - before.cents) < 200) left--;
        while (right + 1 < repaired.length && silent(repaired[right+1]) && connected(repaired[right], repaired[right+1])) right++;
        if (before.end - repaired[left].start >= .04 - 1e-6
          && repaired[right].end - after.start >= .04 - 1e-6) omit(i,end);
      } else if (duration <= .16 + 1e-6 && voiced(before) && voiced(after)
        && connected(before, repaired[i]) && connected(repaired[end-1], after)
        && Math.abs(before.cents-after.cents) < 250
        && Math.abs(repaired[i].cents-before.cents) > 650
        && Math.abs(repaired[end-1].cents-after.cents) > 650) {
        let left = i-1, right = end;
        while (left > 0 && voiced(repaired[left-1]) && connected(repaired[left-1], repaired[left])
          && Math.abs(repaired[left-1].cents-before.cents) < 200) left--;
        while (right+1 < repaired.length && voiced(repaired[right+1]) && connected(repaired[right], repaired[right+1])
          && Math.abs(repaired[right+1].cents-after.cents) < 200) right++;
        if (before.end-repaired[left].start >= .04-1e-6 && repaired[right].end-after.start >= .04-1e-6) omit(i,end);
      }
      i = end;
    }
    return omitDetachedBursts(omitUnsupportedExcursions(result, livePreview), livePreview);
  }

  function omitDetachedBursts(frames, livePreview) {
    let result = frames;
    const voiced = f => timed(f) && Number.isFinite(f.cents);
    // Quiet recordings can alternate voiced/unvoiced windows inside one alias.
    // Use explicitly observed null frames, never bridge missing timestamps.
    for (let i = 0; i < frames.length; i++) {
      if (!voiced(frames[i])) continue;
      const base = frames[i].cents;
      let end = i, observed = frames[i].end - frames[i].start;
      for (let j = i + 1; j < frames.length; j++) {
        if (!connected(frames[j - 1], frames[j]) || frames[j].start - frames[end].end > .04 + 1e-6) break;
        if (!voiced(frames[j])) continue;
        if (Math.abs(frames[j].cents - base) > 250) break;
        end = j; observed += frames[j].end - frames[j].start;
      }
      if (observed > .08 + 1e-6 || frames[end].end - frames[i].start > .12 + 1e-6) { i=end; continue; }
      const neighbour = (from, direction) => {
        let previous = from;
        for (let k = from + direction; k >= 0 && k < frames.length; k += direction) {
          if (!(direction < 0 ? connected(frames[k],frames[previous]) : connected(frames[previous],frames[k]))
            || Math.abs(frames[k].start - frames[from].start) > .5) break;
          if (voiced(frames[k])) return k;
          previous=k;
        }
        return -1;
      };
      const left=neighbour(i,-1), right=neighbour(end,1);
      const support = (from,direction) => {
        if(from<0)return 0;
        let seconds=0, previous=from, last=from;
        for(let k=from;k>=0&&k<frames.length;k+=direction){
          if(k!==from && !(direction<0?connected(frames[k],frames[previous]):connected(frames[previous],frames[k])))break;
          if(Math.abs(frames[k].start-frames[from].start)>.2 || Math.abs(frames[k].start-frames[last].start)>.05)break;
          previous=k;
          if(!voiced(frames[k]))continue;
          if(Math.abs(frames[k].cents-frames[from].cents)>250)break;
          seconds+=frames[k].end-frames[k].start;last=k;
          if(seconds>=.08)break;
        }
        return seconds;
      };
      const distant = k => k>=0 && Math.abs(frames[k].cents-base)>650;
      const flank = (k,direction) => support(k,direction)>=.04-1e-6;
      const both = distant(left)&&distant(right)&&Math.abs(frames[left].cents-frames[right].cents)<250
        && flank(left,-1)&&flank(right,1);
      // A genuine note change can straddle an alias. Neither flank needs to
      // have the same pitch, but both must strongly contradict the brief burst.
      const transition = observed<=.04+1e-6 && frames[end].end-frames[i].start<=.06+1e-6
        && left>=0 && right>=0 && Math.abs(frames[left].cents-frames[right].cents)<=700
        && Math.abs(frames[left].cents-base)>1000 && Math.abs(frames[right].cents-base)>1000
        && support(left,-1)>=.08-1e-6 && support(right,1)>=.08-1e-6;
      // One unsupported frame at an onset/release is not a reliable note. Do
      // not erase longer one-sided notes or act on a still-growing live ending.
      const edge = !livePreview && observed<=.02+1e-6
        && (distant(left)&&flank(left,-1)||distant(right)&&flank(right,1));
      // Several 10-ms windows can lock onto a high harmonic at a release.
      // Require strong neighbouring singing and 80 ms of observed unvoiced
      // audio. Bursts longer than 40 ms need a larger, >15-semitone discrepancy.
      const quiet = (from,direction) => {
        let seconds=0, previous=from;
        for(let k=from+direction;k>=0&&k<frames.length;k+=direction){
          if(!(direction<0?connected(frames[k],frames[previous]):connected(frames[previous],frames[k]))
            || frames[k].cents!==null || frames[k].omitted)break;
          seconds+=frames[k].end-frames[k].start;previous=k;
          if(seconds>=.08-1e-6)return true;
        }
        return false;
      };
      const isolated = k => k>=0 && Math.abs(frames[k].cents-base)>
        (observed<=.04+1e-6 && frames[end].end-frames[i].start<=.06+1e-6 ? 1000 : 1500);
      const detached = (isolated(left) && support(left,-1)>=.08-1e-6 && quiet(end,1))
        || (isolated(right) && support(right,1)>=.08-1e-6 && quiet(i,-1));
      if(both||transition||edge||detached){
        if(result===frames)result=frames.slice();
        for(let k=i;k<=end;k++)if(voiced(frames[k]))result[k]={...frames[k],cents:null,
          rawCents:frames[k].rawCents??frames[k].cents,omitted:true};
      }
      i=end;
    }
    return result;
  }

  function omitUnsupportedExcursions(frames, livePreview) {
    let result = frames;
    const voiced = f => timed(f) && Number.isFinite(f.cents);
    // Omission needs less evidence than octave correction. A brief burst may
    // include several unrelated pitches or a dropout before the voice returns.
    for (let i = 1; i < frames.length - 1; i++) {
      const before = frames[i - 1], first = frames[i];
      if (!voiced(before) || !voiced(first) || !connected(before, first)
        || Math.abs(first.cents - before.cents) <= 650) continue;
      let observed = 0;
      for (let j = i; j < frames.length; j++) {
        const frame = frames[j];
        if (!connected(frames[j - 1], frame) || frame.start - first.start > .16 + 1e-6) break;
        if (!voiced(frame)) continue;
        if (Math.abs(frame.cents - before.cents) < 250) {
          let left = i - 1, right = j, rightSupport = frame.end - frame.start;
          let support = before.end - before.start + rightSupport;
          while (left > 0 && connected(frames[left - 1], frames[left]) && voiced(frames[left - 1])
            && Math.abs(frames[left - 1].cents - before.cents) < 200) {
            left--; support += frames[left].end - frames[left].start;
            if (support >= .08) break;
          }
          while (right + 1 < frames.length && connected(frames[right], frames[right + 1]) && voiced(frames[right + 1])
            && Math.abs(frames[right + 1].cents - frame.cents) < 200) {
            right++; const duration = frames[right].end - frames[right].start;
            support += duration; rightSupport += duration;
            if (rightSupport >= .08) break;
          }
          const settled = !livePreview || right - j >= 2 && rightSupport >= OCTAVE_FLANK_SECONDS - 1e-6;
          if (settled && support >= .04 - 1e-6 && i - left + right - j >= 2 && observed <= .16 + 1e-6) {
            if (result === frames) result = frames.slice();
            for (let k = i; k < j; k++) if (voiced(frames[k])) result[k] = {
              ...frames[k], cents: null, rawCents: frames[k].rawCents ?? frames[k].cents, omitted: true,
            };
            i = j - 1;
          }
          break;
        }
        // Preserve genuine small intervals, bends and continuous glides.
        if (Math.abs(frame.cents - before.cents) <= 650) break;
        observed += frame.end - frame.start;
      }
    }
    return result;
  }

  function repairMovingOctaves(frames) {
    let result = frames;
    const voiced = f => timed(f) && Number.isFinite(f.cents);
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
    const voiced = frame => timed(frame) && Number.isFinite(frame.cents);
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
    const cleaned = cleanPitchFrames(frames), rawOctaves = new Map();
    let output = pitches;
    cleaned.forEach((frame, i) => {
      if (frame.cents === frames[i].cents) return;
      if (output === pitches) output = pitches.slice();
      output[i] = frame.cents ?? 0;
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
        || before !== pitches[bin] || after !== 0 && (after < 2000 || after > 11000
          || Math.abs(after - before) !== 1200) || rawOctaves.has(bin)) continue;
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
    OCTAVE_TOLERANCE_CENTS, OCTAVE_DROPOUT_SECONDS, OCTAVE_CONTEXT_SECONDS,LIVE_GAP_SECONDS,
    cleanPitchFrames, repairOctaveIslands, repairPitchGrid, restorePitchGrid, rawPitchGrid, createDetector, source};
});
