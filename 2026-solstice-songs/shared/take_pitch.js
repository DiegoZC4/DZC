/* Local, reference-preserving pitch assessment of microphone takes. */
((root, factory) => {
  const api = factory(typeof module === "object" && module.exports ? require("./vocal_pitch.js") : root.MeleteVocalPitch);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteTakePitch = api;
})(globalThis, function takePitchTools(vocal) {
  "use strict";
  // References stay immutable. Bump only analysis when detector behavior changes.
  const VERSION = 1;
  const ANALYSIS_VERSION = 2;
  const SCORING_VERSION = 9;
  const REST_POLICY_VERSION = 2;
  const CONTOUR_VERSION = 1;
  const BEST_COVERAGE_WINDOW = 0.05;
  const DOMINANCE_CENTS_MARGIN = 2;
  const DOMINANCE_COVERAGE_MARGIN = 0.02;
  const TIME_EPSILON = 1e-6;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  // Clipping floating-point boundaries can leave fragments far below one audio sample.
  const nonzeroNotes = notes => notes.filter(([from, to]) => to - from > TIME_EPSILON);

  function octaveError(cents) {
    return cents - 1200 * Math.round(cents / 1200);
  }

  function currentScore(score) {
    return hasMedian(score) && score.scoringVersion === SCORING_VERSION;
  }

  function mergeRanges(ranges) {
    return ranges.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]).reduce((out, r) => {
      if (out.length && r[0] <= out.at(-1)[1] + 1e-7) out.at(-1)[1] = Math.max(out.at(-1)[1], r[1]);
      else out.push([...r]);
      return out;
    }, []);
  }

  function subtractRanges(ranges, holes) {
    return holes.reduce((remaining, [a, b]) => remaining.flatMap(([x, y]) => b <= x || a >= y ? [[x, y]]
      : [[x, Math.min(y, a)], [Math.max(x, b), y]].filter(([l, r]) => r > l)), ranges);
  }

  function containsTime(ranges, seconds) {
    let low = 0, high = ranges.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (ranges[mid][1] <= seconds) low = mid + 1; else high = mid;
    }
    return low < ranges.length && ranges[low][0] <= seconds;
  }

  function reference({spans, secondsAtTick, start, end, rate, fingerprint, part, line, latency = 0, captureStart = start, measures = [], division}) {
    const origin = secondsAtTick(captureStart);
    const notes = nonzeroNotes(spans.filter(span => span.end > start && span.start < end).map(span => [
      (secondsAtTick(Math.max(start, span.start)) - origin) / rate,
      (secondsAtTick(Math.min(end, span.end)) - origin) / rate,
      [...span.pitches],
    ]));
    const chapters = measures.flatMap(([tick], index) => tick >= captureStart && tick < end
      ? [{measure: index + 1, seconds: (secondsAtTick(tick) - origin) / rate}] : []);
    const ref = {version: VERSION, fingerprint, part, line, start, end, rate, notes, captureStart, chapters,
      leadInSeconds: (secondsAtTick(start) - origin) / rate,
      seconds: (secondsAtTick(end) - origin) / rate, latency: Math.max(0, latency)};
    if (division > 0 && measures.length) {
      // Walk one notated beat, including fractional boundaries and meter changes.
      const moveBeat = (tick, direction) => {
        let at = tick, remaining = 1;
        while (remaining > 1e-7) {
          let i = measures.findLastIndex(m => m[0] <= at + (direction > 0 ? 1e-7 : -1e-7));
          i = Math.max(0, i);
          const m = measures[i], unit = division * 4 / (m[3] || 4);
          const boundary = direction > 0 ? (measures[i + 1]?.[0] ?? Infinity) : (i ? m[0] : -Infinity);
          const distance = Math.abs(boundary - at) / unit;
          const step = Math.min(remaining, distance);
          at += direction * step * unit;
          remaining -= step;
        }
        return at;
      };
      const seconds = tick => clamp((secondsAtTick(tick) - origin) / rate, 0, ref.seconds);
      const keep = mergeRanges(spans.map(s => [
        Math.max(seconds(moveBeat(s.start, -1)), seconds(s.start) - 1),
        Math.min(seconds(moveBeat(s.end, 1)), seconds(s.end) + 1),
      ]));
      const sounding = mergeRanges(spans.map(s => [seconds(s.start), seconds(s.end)]));
      ref.restPolicy = {version: REST_POLICY_VERSION, keep,
        guards: subtractRanges(keep, sounding)};
    }
    return ref;
  }

  function restPolicyValid(ref) {
    const p = ref?.restPolicy;
    return p?.version === REST_POLICY_VERSION && [p.keep, p.guards].every(ranges => Array.isArray(ranges)
      && ranges.every((r, i) => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1])
        && r[0] >= 0 && r[1] > r[0] && r[1] <= ref.seconds + 1e-6 && (!i || r[0] >= ranges[i - 1][1] - 1e-7)));
  }

  function trimReference(ref, end, seconds) {
    const clip = ranges => ranges.filter(r => r[0] < seconds).map(([a, b]) => [a, Math.min(b, seconds)]);
    return {...ref, end, seconds,
      notes: nonzeroNotes(ref.notes.filter(n => n[0] < seconds).map(([a, b, p]) => [a, Math.min(b, seconds), p])),
      chapters: (ref.chapters || []).filter(c => c.seconds < seconds),
      ...(restPolicyValid(ref) ? {restPolicy: {...ref.restPolicy, keep: clip(ref.restPolicy.keep), guards: clip(ref.restPolicy.guards)}} : {})};
  }

  // Destructive by design: ignored rest audio is never retained in a hidden raw
  // recording. A 5 ms fade inside the kept margin prevents a hard gate click.
  function discardRestAudio(samples, sampleRate, ref, offset = 0) {
    if (!restPolicyValid(ref)) return samples;
    const ranges = ref.restPolicy.keep;
    let index = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = (offset + i) / sampleRate - ref.latency;
      while (index < ranges.length && ranges[index][1] <= t) index++;
      const r = ranges[index];
      if (!r || t < r[0]) samples[i] = 0;
      else {
        const gain = Math.min(1, r[0] > 0 ? (t - r[0]) / .005 : 1,
          r[1] < ref.seconds ? (r[1] - t) / .005 : 1);
        samples[i] *= Math.max(0, gain);
      }
    }
    return samples;
  }

  function cleanRestFrames(frames, ref) {
    return restPolicyValid(ref) ? frames.map(f => containsTime(ref.restPolicy.keep, (f.start + f.end) / 2)
      ? f : {...f, cents: null}) : frames;
  }

  function playbackRestReference(ref, origin, seconds) {
    if (!restPolicyValid(ref)) return null;
    const keep=ref.restPolicy.keep.map(r=>r.slice());
    if(origin<0 && keep.length && ref.notes[0]?.[0]===0)keep[0][0]=Math.max(origin,-1);
    const shift=ranges=>mergeRanges(ranges.map(([a,b])=>[Math.max(0,a-origin),Math.min(seconds,b-origin)]));
    return {seconds,latency:0,restPolicy:{version:REST_POLICY_VERSION,keep:shift(keep),guards:shift(ref.restPolicy.guards)}};
  }

  function stopNoiseCut(pcm, sampleRate, frames, latency = 0) {
    const seconds = pcm.length / sampleRate, step = Math.max(1, Math.round(sampleRate * .005));
    if (seconds < .3 || !frames.length) return null;
    const first = Math.max(0, pcm.length - Math.round(.5 * sampleRate)), blocks = [];
    for (let a = first; a < pcm.length; a += step) {
      let energy = 0;
      const end = Math.min(pcm.length, a + step);
      for (let i = a; i < end; i++) energy += (pcm[i] / 32768) ** 2;
      blocks.push({start: a / sampleRate, end: end / sampleRate, rms: Math.sqrt(energy / (end - a))});
    }
    const sorted = blocks.map(b => b.rms).sort((a, b) => a - b);
    const threshold = Math.max(.008, sorted[Math.floor(sorted.length / 2)] * 6);
    const last = blocks.findLastIndex(b => b.rms > threshold);
    if (last < 0 || seconds - blocks[last].end > .12) return null;
    let begin = last;
    while (begin > 0 && blocks[begin - 1].rms > threshold / 3) begin--;
    const onset = blocks[begin].start;
    if (blocks[last].end - onset > .08 || onset < .16) return null;
    // Protect sung releases, consonants next to them, and every reliable pitch,
    // including wrong notes. Missing evidence is not evidence of keyboard noise.
    if (frames.some(f => Number.isFinite(f.cents) && f.end + latency > onset - .15)) return null;
    const quiet = blocks.filter(b => b.start >= onset - .08 && b.end <= onset);
    if (quiet.length < 12 || quiet.some(b => b.rms > threshold / 3)) return null;
    const observed = frames.reduce((n, f) => n + Math.max(0, Math.min(onset, f.end + latency)
      - Math.max(onset - .1, f.start + latency)), 0);
    if (observed < .07) return null;
    return Math.max(seconds - .5, onset - .005);
  }

  function muteStopTail(pcm, sampleRate, from, offset = 0) {
    if (!Number.isFinite(from)) return pcm;
    const start = Math.round(from * sampleRate), fade = Math.max(1, Math.round(.005 * sampleRate));
    for (let i = Math.max(0, start - offset); i < pcm.length; i++) pcm[i] *= Math.max(0, 1 - (offset + i - start) / fade);
    return pcm;
  }

  function restStats(frames, ref, duration) {
    if (!restPolicyValid(ref)) return {restObservedSeconds: 0, restVoicedSeconds: null};
    const observed = [], voiced = [];
    let index = 0;
    for (const [from, to] of ref.restPolicy.guards) {
      while (index < frames.length && frames[index].end <= from) index++;
      for (let i = index; i < frames.length && frames[i].start < to; i++) {
        const f = frames[i], r = [Math.max(0, from, f.start), Math.min(duration, to, f.end)];
        if (r[1] <= r[0]) continue;
        observed.push(r);
        if (Number.isFinite(f.cents)) voiced.push(r);
      }
    }
    const length = ranges => mergeRanges(ranges).reduce((sum, [a, b]) => sum + b - a, 0);
    const total = length(observed);
    return {restObservedSeconds: total, restVoicedSeconds: total > 0 ? length(voiced) : null};
  }

  function restLabel(score) {
    return Number.isFinite(score?.restVoicedSeconds)
      ? `${score.restVoicedSeconds.toFixed(2)} s voiced during entrance/release rests (${score.restObservedSeconds.toFixed(2)} s observed). Separate from pitch error.` : "";
  }

  function validReference(ref) {
    return ref?.version === VERSION && typeof ref.fingerprint === "string" && ref.fingerprint.length > 0
      && Number.isInteger(ref.part) && Number.isFinite(ref.rate) && ref.rate > 0
      && Number.isFinite(ref.seconds) && ref.seconds > 0 && ref.seconds <= 3600
      && (ref.leadInSeconds === undefined || (Number.isFinite(ref.leadInSeconds)
        && ref.leadInSeconds >= 0 && ref.leadInSeconds < ref.seconds))
      && Number.isFinite(ref.latency) && ref.latency >= 0 && ref.latency < 2
      && Array.isArray(ref.notes) && ref.notes.every((note, i) => Array.isArray(note) && note.length === 3
        && Number.isFinite(note[0]) && Number.isFinite(note[1]) && note[0] >= 0 && note[1] > note[0]
        && note[1] <= ref.seconds + 1e-6 && (!i || note[0] >= ref.notes[i - 1][1] - 1e-7)
        && Array.isArray(note[2]) && note[2].length > 0
        && note[2].every(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127));
  }

  // Integrate absolute error over tracked singing time. Untracked written
  // singing lowers coverage, not cents error; rests affect neither metric.
  function scoreFrames(frames, ref, duration) {
    if (!validReference(ref)) throw new Error("Missing or invalid take pitch reference");
    const end = Math.min(duration, ref.seconds);
    let expected = 0, tracked = 0, errorSum = 0, within50 = 0, frameIndex = 0;
    const errors = [];
    for (const [from, to, pitches] of ref.notes) {
      const stop = Math.min(to, end);
      if (stop <= from) continue;
      expected += stop - from;
      while (frameIndex < frames.length && frames[frameIndex].end <= from) frameIndex += 1;
      for (let index = frameIndex; index < frames.length && frames[index].start < stop; index += 1) {
        const frame = frames[index];
        const weight = Math.min(stop, frame.end) - Math.max(from, frame.start);
        if (weight <= 0 || !Number.isFinite(frame.cents)) continue;
        const error = Math.min(...pitches.map(pitch => Math.abs(octaveError(frame.cents - pitch * 100))));
        tracked += weight;
        errorSum += weight * error;
        if (error <= 50) within50 += weight;
        errors.push({error, weight});
      }
    }
    let median = null;
    if (tracked > 0) {
      errors.sort((a, b) => a.error - b.error);
      const half = tracked / 2, tolerance = Math.max(1, tracked) * 1e-10;
      let cumulative = 0;
      for (let index = 0; index < errors.length; index += 1) {
        cumulative += errors[index].weight;
        if (cumulative < half - tolerance) continue;
        // At an exact halfway boundary, average the two bounding errors, as
        // for the ordinary even-sample median. Otherwise use the weighted one.
        median = Math.abs(cumulative - half) <= tolerance && index + 1 < errors.length
          ? (errors[index].error + errors[index + 1].error) / 2 : errors[index].error;
        break;
      }
    }
    return {version: ANALYSIS_VERSION, scoringVersion: SCORING_VERSION,
      coverage: expected > 0 ? clamp(tracked / expected, 0, 1) : 0,
      meanAbsCents: tracked > 0 ? errorSum / tracked : null,
      medianAbsCents: median,
      within50CentsSeconds: within50,
      expectedSeconds: expected, trackedSeconds: tracked, ...restStats(frames, ref, end)};
  }

  function validScore(pitch) {
    return pitch?.version === ANALYSIS_VERSION
      && Number.isFinite(pitch.coverage) && pitch.coverage >= 0 && pitch.coverage <= 1
      && Number.isFinite(pitch.expectedSeconds) && pitch.expectedSeconds >= 0
      && Number.isFinite(pitch.trackedSeconds) && pitch.trackedSeconds >= 0
      && pitch.trackedSeconds <= pitch.expectedSeconds + 1e-6
      && (pitch.trackedSeconds > 0
        ? Number.isFinite(pitch.meanAbsCents) && pitch.meanAbsCents >= 0
        : pitch.meanAbsCents === null)
      && Math.abs(pitch.coverage - (pitch.expectedSeconds > 0 ? pitch.trackedSeconds / pitch.expectedSeconds : 0)) < 1e-6;
  }

  // Main-playbar geometry uses nominal score seconds, not pixels or the current
  // playback speed. Merge adjacent detector frames but retain source boundaries.
  function reviewTimeline(review, duration) {
    if (!review || !validReference(review.ref) || !Number.isFinite(duration) || duration <= 0) return null;
    const {start, rate, ref} = review;
    if (!Number.isFinite(start) || !Number.isFinite(review.end) || !Number.isFinite(rate) || rate <= 0) return null;
    const clip = ([a, b]) => [clamp(a, 0, duration), clamp(b, 0, duration)];
    const positive = ([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b - a > 1e-7;
    const merge = ranges => ranges.filter(positive).sort((a, b) => a[0] - b[0]).reduce((out, r) => {
      const last = out.at(-1);
      if (last && r[0] <= last[1] + 1e-7) last[1] = Math.max(last[1], r[1]);
      else out.push([...r]);
      return out;
    }, []);
    const intersect = (left, right) => {
      const out = [];
      let i = 0, j = 0;
      while (i < left.length && j < right.length) {
        const range = [Math.max(left[i][0], right[j][0]), Math.min(left[i][1], right[j][1])];
        if (positive(range)) out.push(range);
        if (left[i][1] < right[j][1]) i++; else j++;
      }
      return merge(out);
    };
    const subtract = (left, right) => {
      const out = [];
      let index = 0;
      for (const [from, to] of left) {
        let cursor = from;
        while (index < right.length && right[index][1] <= cursor) index++;
        for (let i = index; i < right.length && right[i][0] < to; i++) {
          if (right[i][0] > cursor) out.push([cursor, right[i][0]]);
          cursor = Math.max(cursor, right[i][1]);
        }
        if (cursor < to) out.push([cursor, to]);
      }
      return out;
    };
    const end = Math.min(review.end, Number.isFinite(review.buffer?.duration)
      ? start + review.buffer.duration * rate : review.end);
    const segments = (review.timelineSegments || [{from: start + (ref.leadInSeconds || 0) * rate,
      to: end, label: review.label, takeId: review.id}]).map(s => {
      const [from, to] = clip([s.from, s.to]);
      return {...s, from, to};
    }).filter(s => positive([s.from, s.to])).sort((a, b) => a.from - b.from);
    const scope = clip([start + (ref.leadInSeconds || 0) * rate, end]);
    const allExpected = intersect(merge(ref.notes.map(n => clip([start + n[0] * rate, start + n[1] * rate]))),
      positive(scope) ? [scope] : []);
    const recorded = merge(segments.map(s => [s.from, s.to]));
    const expected = intersect(allExpected, recorded);
    const tracked = intersect(merge(review.frames.filter(f => Number.isFinite(f.cents))
      .map(f => clip([start + f.start * rate, start + f.end * rate]))), expected);
    const missing = subtract(expected, tracked);
    // The transport is a phrase-level overview, not a second detector trace.
    // Union with rests and close breath-sized holes; never change grades/frames.
    const gapSeconds = 2;
    const gaps = subtract(allExpected, tracked).filter(([a, b]) => (b - a) / rate >= gapSeconds - 1e-7);
    const covered = subtract(positive(scope) ? [scope] : [], gaps);
    const seams = segments.slice(1).filter((s, i) => s.takeId !== segments[i].takeId).map(s => s.from);
    const seconds = ranges => ranges.reduce((sum, [a, b]) => sum + b - a, 0);
    return {segments, expected, tracked, missing, scope, covered, gaps, seams, gapSeconds,
      coverage: seconds(expected) ? seconds(tracked) / seconds(expected) : null};
  }

  function hasMedian(pitch) {
    return validScore(pitch) && (pitch.trackedSeconds > 0
      ? Number.isFinite(pitch.medianAbsCents) && pitch.medianAbsCents >= 0
      : pitch.medianAbsCents === null);
  }

  function hasPitchBand(pitch) {
    return validScore(pitch) && Number.isFinite(pitch.within50CentsSeconds)
      && pitch.within50CentsSeconds >= 0 && pitch.within50CentsSeconds <= pitch.trackedSeconds;
  }

  function analyse(pcm, sampleRate, ref, PitchDetector, {includeFrames = false} = {}) {
    if (!validReference(ref) || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000
      || !(pcm instanceof Int16Array) || pcm.length > sampleRate * 300 + 1) {
      throw new Error("Invalid recording for pitch assessment");
    }
    const size = 4096, hop = Math.max(1, Math.round(sampleRate / 100));
    const detector = vocal.createDetector(PitchDetector, size);
    const buffer = new Float32Array(size), frames = [];
    for (let offset = 0; offset < pcm.length; offset += hop) {
      const count = Math.min(hop, pcm.length - offset);
      const center = offset + count / 2;
      const left = Math.floor(center - size / 2);
      let energy = 0;
      for (let i = 0; i < size; i += 1) {
        const index = left + i;
        const value = index >= 0 && index < pcm.length ? pcm[index] / 32768 : 0;
        buffer[i] = value;
        energy += value * value;
      }
      let cents = null;
      if (Math.sqrt(energy / size) >= 0.002) {
        const [frequency, clarity] = detector.findPitch(buffer, sampleRate);
        if (clarity >= 0.85 && frequency >= 55 && frequency <= 1200) {
          cents = (69 + 12 * Math.log2(frequency / 440)) * 100;
        }
      }
      frames.push({start: offset / sampleRate - ref.latency,
        end: (offset + count) / sampleRate - ref.latency, cents});
    }
    const cleaned = vocal.cleanPitchFrames(cleanRestFrames(frames, ref));
    const result = scoreFrames(cleaned, ref, pcm.length / sampleRate);
    return includeFrames ? {...result, frames: cleaned} : result;
  }

  function packContour(frames, take) {
    if (take.pitchContour?.version === 2) return packLiveContour(frames, take);
    const {sampleRate, pitchReference: ref} = take;
    const hop = Math.max(1, Math.round(sampleRate / 100));
    if (!validReference(ref) || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000
      || !Number.isInteger(take.frames) || take.frames <= 0 || take.frames > sampleRate * 300 + 1
      || frames.length !== Math.ceil(take.frames / hop)) throw new Error("Invalid take contour");
    const pitches = new Float64Array(frames.length);
    frames.forEach((frame, index) => {
      const offset = index * hop;
      if (frame.start !== offset / sampleRate - ref.latency
        || frame.end !== Math.min(offset + hop, take.frames) / sampleRate - ref.latency
        || (frame.cents !== null && !Number.isFinite(frame.cents))) throw new Error("Invalid take contour frame");
      if (frame.rawCents !== undefined && !Number.isFinite(frame.rawCents)) throw new Error("Invalid raw take pitch");
      pitches[index] = frame.rawCents ?? (frame.cents === null ? NaN : frame.cents);
    });
    // The detector has a fixed sample hop. Store pitches only; reconstruct its
    // exact intervals, including the final partial frame and latency, on read.
    // Retain raw estimates so octave cleanup is reproducible and reversible.
    return {version: CONTOUR_VERSION, analysisVersion: ANALYSIS_VERSION, sampleRate,
      audioFrames: take.frames, reference: JSON.stringify(ref), pitches};
  }

  // Live observations have real, irregular timestamps. Keep gaps rather than
  // expanding them onto a fictitious 100 Hz grid or detecting the audio twice.
  function packLiveContour(frames, take) {
    const pitches = new Float64Array(frames.length * 3), ref = take.pitchReference;
    if (!validReference(ref) || !Number.isInteger(take.frames) || take.frames <= 0
      || !(take.sampleRate >= 8000 && take.sampleRate <= 192000)) throw new Error("Invalid live contour");
    let end = -ref.latency;
    frames.forEach((f, i) => {
      if (!Number.isFinite(f.start) || !Number.isFinite(f.end) || f.start < end - 1e-8 || f.end <= f.start
        || f.end > take.frames / take.sampleRate - ref.latency + 1e-8
        || f.cents !== null && !Number.isFinite(f.cents)) throw new Error("Invalid live contour frame");
      pitches.set([f.start, f.end, f.rawCents ?? (f.cents ?? NaN)], i * 3); end = f.end;
    });
    return {version: 2, analysisVersion: ANALYSIS_VERSION, sampleRate: take.sampleRate,
      audioFrames: take.frames, reference: JSON.stringify(ref), pitches};
  }

  function readContour(take) {
    const saved = take.pitchContour, ref = take.pitchReference, sampleRate = take.sampleRate;
    if (!saved || ![CONTOUR_VERSION, 2].includes(saved.version) || saved.analysisVersion !== ANALYSIS_VERSION
      || !validReference(ref) || saved.reference !== JSON.stringify(ref)
      || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000
      || saved.sampleRate !== sampleRate || !Number.isInteger(take.frames) || take.frames <= 0
      || take.frames > sampleRate * 300 + 1 || saved.audioFrames !== take.frames
      || !(saved.pitches instanceof Float64Array)) return null;
    if (saved.version === 2) {
      if (saved.pitches.length % 3) return null;
      const frames = [];
      let end = -ref.latency;
      for (let i = 0; i < saved.pitches.length; i += 3) {
        const [start, stop, cents] = saved.pitches.subarray(i, i + 3);
        if (!Number.isFinite(start) || !Number.isFinite(stop) || start < end - 1e-8 || stop <= start
          || stop > take.frames / sampleRate - ref.latency + 1e-8 || !Number.isFinite(cents) && !Number.isNaN(cents)) return null;
        frames.push({start, end: stop, cents: Number.isNaN(cents) ? null : cents, live: true}); end = stop;
      }
      return vocal.cleanPitchFrames(cleanRestFrames(frames, ref));
    }
    const hop = Math.max(1, Math.round(sampleRate / 100));
    if (saved.pitches.length !== Math.ceil(take.frames / hop)) return null;
    const frames = [];
    for (let index = 0; index < saved.pitches.length; index += 1) {
      const cents = saved.pitches[index], offset = index * hop;
      if (!Number.isFinite(cents) && !Number.isNaN(cents)) return null;
      frames.push({start: offset / sampleRate - ref.latency,
        end: Math.min(offset + hop, take.frames) / sampleRate - ref.latency,
        cents: Number.isNaN(cents) ? null : cents});
    }
    return vocal.cleanPitchFrames(cleanRestFrames(frames, ref));
  }

  function samePassage(saved, current) {
    if (!validReference(saved) || !validReference(current) || saved.part !== current.part
      || saved.line !== current.line || saved.start !== current.start || saved.end !== current.end
      || Math.abs(saved.seconds - current.seconds) > 1e-5) return false;
    const a = nonzeroNotes(saved.notes), b = nonzeroNotes(current.notes);
    return a.length === b.length && a.every((note, i) => Math.abs(note[0] - b[i][0]) < 1e-5
      && Math.abs(note[1] - b[i][1]) < 1e-5
      && JSON.stringify(note[2]) === JSON.stringify(b[i][2]));
  }

  // Regrade corrections, not a different performance clock or voice assignment.
  function sameTimeline(saved, current) {
    if (!validReference(saved) || !validReference(current)) return false;
    for (const field of ["part", "line", "rate", "start", "end", "latency"]) {
      if ((saved[field] ?? null) !== (current[field] ?? null)) return false;
    }
    if ((saved.captureStart ?? saved.start) !== (current.captureStart ?? current.start)
      || Math.abs(saved.seconds - current.seconds) > 1e-5
      || Math.abs((saved.leadInSeconds || 0) - (current.leadInSeconds || 0)) > 1e-5) return false;
    const a = saved.chapters, b = current.chapters;
    if (!Array.isArray(a) || !Array.isArray(b)) return samePassage(saved, current);
    return a.length === b.length && a.every((chapter, i) => chapter.measure === b[i].measure
      && Math.abs(chapter.seconds - b[i].seconds) < 1e-5);
  }

  function rebaseTake(take, reference, now = Date.now()) {
    if (!take.finalized || take.active || take.unsaved || take.deleteAfter
      || !sameTimeline(take.pitchReference, reference)) return null;
    if (JSON.stringify(take.pitchReference) === JSON.stringify(reference)) return take;
    if (take.previousReferenceFingerprints?.includes(reference.fingerprint)) return null;
    const frames = readContour(take);
    const next = {...take, pitchReference: reference, referenceUpdatedAt: now, updatedAt: now,
      originalPitchReference: take.originalPitchReference || take.pitchReference,
      originalPitchScore: take.originalPitchScore || take.pitchScore || null,
      previousReferenceFingerprints: [...new Set([...(take.previousReferenceFingerprints || []), take.pitchReference.fingerprint])]};
    if (frames) {
      // Keep the detector observations and audio bytes; only their target changes.
      next.pitchContour = {...take.pitchContour, reference: JSON.stringify(reference)};
      next.pitchScore = scoreFrames(frames, reference, take.frames / take.sampleRate);
    } else {
      delete next.pitchContour;
      delete next.pitchScore;
    }
    return next;
  }

  function takeBounds(take) {
    const ref = take?.pitchReference;
    const start = ref?.captureStart ?? take?.start ?? ref?.start;
    const end = ref?.end ?? take?.end;
    return {start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null};
  }

  function measureAddress(tick, measures, division) {
    if (!Number.isFinite(tick) || !measures.length || !(division > 0)) return "\u2014";
    if (tick < 0) return "Count-in";
    const i = Math.max(0, measures.findLastIndex(m => m[0] <= tick));
    const [start, duration, , denominator = 4] = measures[i], unit = division * 4 / denominator;
    const offset = Math.round((tick - start) / unit * 1000) / 1000;
    if (offset * unit >= duration - 1e-7) return String(i + 2);
    const beat = Math.floor(offset) + 1, fraction = (offset % 1).toFixed(3).slice(2).replace(/0+$/u, "");
    return fraction ? `${i + 1}.${beat}.${fraction}` : beat > 1 ? `${i + 1}.${beat}` : String(i + 1);
  }

  function comparisonKey(take) {
    const ref = take.pitchReference;
    if (!validReference(ref)) return null;
    const offset = ref.leadInSeconds || 0;
    const notes = ref.notes.map(([from, to, pitches]) => [
      Math.round((from - offset) * 1e6) / 1e6, Math.round((to - offset) * 1e6) / 1e6, pitches]);
    return JSON.stringify([ref.fingerprint, ref.part, ref.line, ref.start, ref.end, ref.rate, notes]);
  }

  const SORT_COLUMNS = {
    number: {label: "Take", direction: "ascending"},
    singer: {label: "Singer", direction: "ascending"},
    part: {label: "Part", direction: "ascending"},
    start: {label: "Start", direction: "ascending"},
    end: {label: "End", direction: "ascending"},
    segments: {label: "Segments", direction: "ascending"},
    tracked: {label: "Tracked (%)", direction: "descending"},
    mean: {label: "Mean (cents)", direction: "ascending"},
    median: {label: "Median (cents)", direction: "ascending"},
    within: {label: "Within 50 cents (%)", direction: "descending"},
    created: {label: "Created", direction: "descending"},
    modified: {label: "Modified", direction: "descending"},
  };

  function takeSort(value) {
    const column = Object.hasOwn(SORT_COLUMNS, value?.column) ? value.column : "mean";
    return {column, direction: ["ascending", "descending"].includes(value?.direction)
      ? value.direction : SORT_COLUMNS[column].direction};
  }

  function nextTakeSort(current, column) {
    const next = takeSort({column});
    if (current.column === next.column) next.direction = current.direction === "ascending" ? "descending" : "ascending";
    return next;
  }

  function takeSortValue(take, column) {
    if (column === "number") return Number.isFinite(take.number) ? take.number : null;
    if (column === "part") return take.part || null;
    if (column === "singer") return take.singer || null;
    if (column === "segments") return take.metrics ? take.segmentCount ?? null
      : take.segmentCount ?? take.pitchScore?.segmentCount ?? 1;
    if (column === "start" || column === "end") return takeBounds(take)[column];
    if (column === "created") return Number.isFinite(take.createdAt) ? take.createdAt : null;
    if (column === "modified") {
      const value = take.editedAt ?? take.updatedAt ?? take.createdAt;
      return Number.isFinite(value) ? value : null;
    }
    // Cloud summaries carry display metrics, not full analysis durations.
    if (take.metrics) return Number.isFinite(take.metrics[column])
      ? take.metrics[column] / (["tracked","within"].includes(column) ? 100 : 1) : null;
    const score = take.pitchScore;
    if (!validScore(score)) return null;
    if (column === "tracked") return score.expectedSeconds > 0 ? score.coverage : null;
    if (column === "mean") return score.meanAbsCents;
    if (column === "median") return hasMedian(score) ? score.medianAbsCents : null;
    return hasPitchBand(score) && score.trackedSeconds > 0 ? score.within50CentsSeconds / score.trackedSeconds : null;
  }

  function compareParts(a, b) {
    const rank = value => {
      const text = String(value || "").trim();
      const match = /^(soprano|alto|tenor|bass|[satb])\s*(\d*)\b/i.exec(text);
      return match ? ["satb".indexOf(match[1][0].toLowerCase()), Number(match[2] || 0), /solo/i.test(text) ? 1 : 0]
        : [4, 0, 0];
    };
    const x = rank(a), y = rank(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
      || String(a || "").localeCompare(String(b || ""), undefined, {numeric: true});
  }

  function compareTakes(a, b, order) {
    const {column, direction} = takeSort(order);
    const x = takeSortValue(a, column), y = takeSortValue(b, column);
    // Missing values always stay last, including when the direction reverses.
    if ((x === null) !== (y === null)) return x === null ? 1 : -1;
    const primary = column === "part" ? compareParts(x, y) : typeof x === "string" && typeof y === "string"
      ? x.localeCompare(y, undefined, {numeric: true}) : x === y ? 0 : x < y ? -1 : 1;
    return primary * (direction === "descending" ? -1 : 1)
      || (a.createdAt || 0) - (b.createdAt || 0) || (a.number || 0) - (b.number || 0);
  }

  function dominatedBy(takes) {
    const groups = new Map(), result = new Map();
    for (const take of takes) {
      const score = take.pitchScore;
      if (!take.complete || !take.finalized || take.active || take.unsaved || take.gap || take.deleteAfter
        || !hasMedian(score) || !Number.isFinite(score.meanAbsCents) || !Number.isFinite(score.medianAbsCents)) continue;
      const key = comparisonKey(take);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(take);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => compareTakes(a, b) || String(a.id).localeCompare(String(b.id)));
      for (const take of group) {
        const score = take.pitchScore;
        const better = group.find(candidate => {
          if (candidate.id === take.id) return false;
          const other = candidate.pitchScore;
          // Keep "no worse" strict; tolerances here could mark both takes as dominated.
          return other.meanAbsCents <= score.meanAbsCents && other.medianAbsCents <= score.medianAbsCents
            && other.coverage >= score.coverage
            && (score.meanAbsCents - other.meanAbsCents + 1e-9 >= DOMINANCE_CENTS_MARGIN
              || score.medianAbsCents - other.medianAbsCents + 1e-9 >= DOMINANCE_CENTS_MARGIN
              || other.coverage - score.coverage + 1e-9 >= DOMINANCE_COVERAGE_MARGIN);
        });
        if (better) result.set(take.id, better);
      }
    }
    return result;
  }

  function bestIds(takes) {
    const groups = new Map(), result = new Set();
    for (const take of takes) {
      const pitch = take.pitchScore;
      if (!take.complete || !take.finalized || take.active || take.unsaved || take.gap || take.deleteAfter
        || !validScore(pitch) || !Number.isFinite(pitch.meanAbsCents)) continue;
      const key = comparisonKey(take);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(take);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const mostTracked = Math.max(...group.map(take => take.pitchScore.coverage));
      const eligible = group.filter(take => take.pitchScore.coverage + 1e-9
        >= mostTracked - BEST_COVERAGE_WINDOW);
      if (eligible.length < 2) continue;
      const best = Math.min(...eligible.map(take => Math.round(take.pitchScore.meanAbsCents * 10)));
      eligible.filter(take => Math.round(take.pitchScore.meanAbsCents * 10) === best)
        .forEach(take => result.add(take.id));
    }
    return result;
  }

  function source() { return `${vocal.source()}\nglobalThis.MeleteTakePitch = (${takePitchTools.toString()})(MeleteVocalPitch);`; }
  function workerSource(pitchy) {
    return `self.window = self;\n${pitchy}\n${vocal.source()}\nconst assessment = (${takePitchTools.toString()})(MeleteVocalPitch);
      self.onmessage = event => {
        try {
          const {wav, reference, sampleRate, frames, includeFrames = false} = event.data;
          if (frames) { self.postMessage({result:{...assessment.scoreFrames(frames, reference, event.data.seconds), frames}}); return; }
          const view = new DataView(wav);
          if (view.byteLength < 44 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
            || view.getUint32(24, true) !== sampleRate || view.getUint16(34, true) !== 16
            || view.getUint32(40, true) !== wav.byteLength - 44) throw new Error('Invalid microphone WAV');
          const pcm = new Int16Array((wav.byteLength - 44) / 2);
          for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(44 + i * 2, true);
          self.postMessage({result: assessment.analyse(pcm, sampleRate, reference, Pitchy.PitchDetector, {includeFrames})});
        } catch (error) { self.postMessage({error: error.message}); }
      };`;
  }

  return {VERSION, ANALYSIS_VERSION, SCORING_VERSION, REST_POLICY_VERSION, TIME_EPSILON, nonzeroNotes, mergeRanges, subtractRanges, containsTime,
    restPolicyValid, trimReference, discardRestAudio, cleanRestFrames, playbackRestReference, restStats, restLabel,
    octaveError, currentScore, BEST_COVERAGE_WINDOW, DOMINANCE_CENTS_MARGIN, DOMINANCE_COVERAGE_MARGIN,
    reference, validReference, validScore, hasMedian, hasPitchBand, scoreFrames, reviewTimeline, analyse, packContour, packLiveContour, readContour,
    stopNoiseCut, muteStopTail,
    samePassage, sameTimeline, rebaseTake, takeBounds, measureAddress, comparisonKey, SORT_COLUMNS, takeSort, nextTakeSort, compareParts, compareTakes, dominatedBy, bestIds, source, workerSource};
});
