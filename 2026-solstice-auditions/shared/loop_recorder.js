/* Microphone-only takes with device-local storage. No network or guide-audio input. */
((root, factory) => {
  const api = factory(() => typeof module === "object" && module.exports ? require("./take_pitch.js") : root.MeleteTakePitch);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteRecording = api;
})(globalThis, getPitch => {
  "use strict";

  const MAX_LOOP_SECONDS = 300;
  const DELETE_UNDO_MS = 10000;
  const STORAGE_WARNING_BYTES = 250 * 1024 * 1024;

  // A fixed review gain, not AGC: quiet microphone files need a comparable
  // listening level to the guide. Ignore pauses and retain the original WAV.
  function takePlaybackGain(samples, sampleRate) {
    const blockSize = Math.max(1, Math.round(sampleRate * 0.05));
    const levels = [];
    let peak = 0;
    for (let start = 0; start < samples.length; start += blockSize) {
      const end = Math.min(samples.length, start + blockSize);
      let energy = 0;
      for (let i = start; i < end; i += 1) {
        const sample = Number.isFinite(samples[i]) ? samples[i] : 0;
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
      }
      const rms = Math.sqrt(energy / (end - start));
      if (rms >= 0.002) levels.push(rms);
    }
    if (!levels.length) return 1;
    levels.sort((a, b) => a - b);
    const voicedLevel = levels[Math.floor((levels.length - 1) * 0.75)];
    return Math.min(16, 0.1 / voicedLevel, 0.85 / peak);
  }

  // Score seconds and recorded seconds use different scales when practice speed
  // differs from the saved take. Latency belongs to the original recording.
  function takePlaybackWindow(take, position, rate, limit, lead = 0) {
    const ratio = rate / take.rate;
    const offset = (position - take.start) / take.rate + take.latency;
    const delay = Math.max(lead, -offset / ratio);
    const from = Math.max(0, offset + delay * ratio);
    const until = Math.min(take.buffer.duration,
      (Math.min(take.end, limit) - take.start) / take.rate + take.latency);
    return until > from ? {ratio, delay, from, until} : null;
  }

  function takeBytes(takes) {
    return takes.reduce((total, take) => total + Math.max(0, take.length ?? take.frames ?? 0) * 2
      + (take.pitchContour?.pitches?.byteLength || 0), 0);
  }

  function takeFilename(song, take) {
    const safe = value => String(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "");
    return `${safe(song)}-${safe(take.part)}-m${safe(take.label)}-${Math.round(take.rate * 100)}pct-take-${take.number || take.createdAt}${take.complete ? "" : "-partial"}.wav`;
  }

  async function takeArchive(takes, song, readWav, zipApi, onProgress = () => {}) {
    if (!takes.length) throw new Error("No takes to download");
    // ZIP32 bounds; refuse an oversized archive rather than returning corrupt data.
    if (takes.length >= 65535 || takeBytes(takes) + takes.length * 2048 >= 0xffffffff) {
      throw new Error("Favorites are too large for one ZIP; download takes individually");
    }
    const chunks = [];
    let result, failure;
    const zip = new zipApi.Zip((error, chunk, final) => {
      if (error) { failure = error; return; }
      chunks.push(new Blob([chunk]));
      if (final) result = new Blob(chunks, {type: "application/zip"});
    });
    try {
      for (const [index, take] of takes.entries()) {
        const wav = await readWav(take);
        const file = new zipApi.ZipPassThrough(takeFilename(song, take));
        zip.add(file);
        const reader = wav.stream().getReader();
        try {
          while (true) {
            const {value, done} = await reader.read();
            file.push(value || new Uint8Array(0), done);
            if (failure) throw failure;
            if (done) break;
          }
        } finally { reader.releaseLock(); }
        onProgress(index + 1, takes.length);
      }
      zip.end();
      if (failure) throw failure;
      if (!result) throw new Error("ZIP could not be completed");
      return result;
    } catch (error) { zip.terminate(); throw error; }
  }

  function countInPlan(measures, division, start, secondsAtTick, rate = 1) {
    const index = measures.findLastIndex(measure => measure[0] <= start + 1e-6);
    const measure = measures[Math.max(0, index)];
    if (!measure || !(division > 0) || !(rate > 0)) throw new Error("Invalid count-in timing");
    const [barStart, , numerator = 4, denominator = 4] = measure;
    const beatTicks = division * 4 / denominator;
    // An interior beat is itself the entry cue (1, 2, enter on 3).
    // A downbeat gets three preceding beats; fractional pickups keep their offset.
    const includeEntry = start > barStart + 1e-6;
    const beats = [];
    for (let i = Math.max(0, index - 3); i <= Math.max(0, index); i++) {
      const [tick, duration, count = 4, unit = 4] = measures[i];
      for (let beat = 0; beat < count; beat++) {
        const at = tick + beat * division * 4 / unit;
        if (at >= tick + duration - 1e-6) break;
        if (at < start - 1e-6 || (includeEntry && Math.abs(at - start) < 1e-6)) {
          beats.push({tick: at, label: beat + 1});
        }
      }
    }
    // At the beginning of a piece, supply an imaginary preceding bar.
    while (beats.length < 3) {
      const first = beats[0] || {tick: barStart, label: 1};
      beats.unshift({tick: first.tick - beatTicks, label: first.label === 1 ? numerator : first.label - 1});
    }
    const selected = beats.slice(-3);
    const origin = secondsAtTick(selected[0].tick);
    const duration = (secondsAtTick(start) - origin) / rate;
    return {start: selected[0].tick, duration, beats: selected.map(beat => ({label: beat.label,
      seconds: (secondsAtTick(beat.tick) - origin) / rate}))};
  }

  function recordingEntrance(rules, range, part, addressTick, fallback = range.start) {
    for (const rule of rules || []) {
      const endpoints = String(rule.loop || "").split("-");
      if (endpoints.length !== 2 || !rule.parts?.[part]) continue;
      const start = addressTick(endpoints[0]), end = addressTick(endpoints[1], true);
      const entry = addressTick(rule.parts[part]);
      const starts = [start, ...Object.values(rule.parts).map(value => addressTick(value))];
      if (entry !== null && end !== null && entry < end && Math.abs(range.end - end) < 1e-6
        && starts.some(tick => tick !== null && Math.abs(range.start - tick) < 1e-6)) return entry;
    }
    return fallback;
  }

  function auditionEntrances(config) {
    // Older builds used the top-level field. An explicit audition config wins.
    return config.audition ? (config.audition.enabled ? config.audition.recordingEntrances || [] : [])
      : config.recordingEntrances || [];
  }

  class CountIn {
    constructor(context, destination, plan, onBeat, timers = globalThis, startTime = context.currentTime + 0.12) {
      this.context = context;
      this.timers = timers;
      this.nodes = new Set();
      this.settled = false;
      this.done = new Promise(resolve => { this.resolve = resolve; });
      const start = startTime;
      this.startTime = start;
      this.endTime = start + plan.duration;
      plan.beats.forEach(beat => {
        const at = start + beat.seconds;
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.value = beat.label === 1 ? 1320 : 880;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.16, at + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
        oscillator.connect(gain).connect(destination);
        const node = {oscillator, gain};
        this.nodes.add(node);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.nodes.delete(node); };
        oscillator.start(at);
        oscillator.stop(at + 0.05);
      });
      let displayed = -1;
      const update = () => {
        if (this.settled) return;
        if (context.state !== "running") { this.cancel(); return; }
        const elapsed = context.currentTime - start;
        const next = plan.beats.findLastIndex(beat => beat.seconds <= elapsed + 1e-6);
        if (next >= 0 && next !== displayed) {
          displayed = next;
          onBeat(plan.beats[next]);
        }
        if (context.currentTime >= this.endTime) {
          this.settled = true;
          this.resolve(true);
        } else this.timer = timers.setTimeout(update, 10);
      };
      update();
    }

    cancel() {
      this.timers.clearTimeout(this.timer);
      for (const {oscillator, gain} of this.nodes) {
        try { oscillator.stop(); } catch {}
        oscillator.disconnect();
        gain.disconnect();
      }
      this.nodes.clear();
      this.settled = true;
      this.resolve(false);
    }
  }

  class TakeBuffer {
    constructor(sampleRate, seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_LOOP_SECONDS
        || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Invalid recording length");
      this.sampleRate = sampleRate;
      this.passFrames = Math.ceil(sampleRate * seconds);
      this.takes = [];
      this.current = null;
      this.nextId = 1;
      this.recentChunks = [];
    }

    begin(frame, reference = null) {
      this.finish(frame, true);
      // Only working audio is bounded. Saved takes are released, never evicted.
      if (this.takes.length >= 3) throw new Error("Local storage is not keeping up");
      const take = {id: this.nextId++, start: Math.round(frame), end: null, reference,
        pcm: new Int16Array(this.passFrames), written: 0, gap: false, firstGap: null, completed: false, peak: 0};
      this.takes.push(take);
      this.current = take;
      // Audio can lead a main-thread transport notification by more than one
      // block. Replay actual recent samples, never silence or interpolation.
      for (const chunk of this.recentChunks) this.write(take, chunk.frame, chunk.samples);
      return take;
    }

    finish(frame, completed = false) {
      if (!this.current) return;
      this.current.end = Math.max(this.current.start,
        Math.min(Math.round(frame), this.current.start + this.passFrames));
      this.current.completed = completed;
      this.current = null;
    }

    write(take, frame, samples) {
      const from = Math.max(frame, take.start + take.written);
      const to = Math.min(frame + samples.length, take.end ?? take.start + this.passFrames);
      if (to <= from) return;
      if (from > take.start + take.written) {
        take.gap = true;
        take.firstGap ||= {offset: take.written, frames: from - take.start - take.written};
      }
      for (let cursor = from; cursor < to; cursor += 1) {
        const value = Math.max(-1, Math.min(1, Number(samples[cursor - frame]) || 0));
        take.pcm[cursor - take.start] = Math.round(value * (value < 0 ? 32768 : 32767));
      }
      const written = take.pcm.subarray(from - take.start, to - take.start);
      getPitch()?.discardRestAudio(written, this.sampleRate, take.reference, from - take.start);
      for (const value of written) take.peak = Math.max(take.peak, Math.abs(value) / 32768);
      take.written = to - take.start;
    }

    append(frame, samples) {
      if (!samples.length) return;
      this.takes.forEach(take => this.write(take, frame, samples));
      this.recentChunks.push({frame, samples});
      const cutoff = frame + samples.length - Math.ceil(this.sampleRate / 4);
      while (this.recentChunks.length > 1
        && this.recentChunks[0].frame + this.recentChunks[0].samples.length <= cutoff) this.recentChunks.shift();
    }

    info(take) {
      const length = Math.min(take.written, take.end === null ? this.passFrames : take.end - take.start);
      const complete = take.completed && !take.gap && take.end !== null
        && take.written >= take.end - take.start;
      return {id: take.id, length, seconds: length / this.sampleRate,
        active: take === this.current, complete, gap: take.gap, firstGap: take.firstGap, peak: take.peak};
    }

    samples(take) { return take.pcm.subarray(0, this.info(take).length); }
    release(take) { this.takes = this.takes.filter(item => item !== take); }
  }

  class TakeStore {
    constructor(factory, name = "melete-audio-takes-v1") {
      this.factory = factory;
      this.name = name;
      this.opening = null;
    }

    open() {
      if (this.opening) return this.opening;
      this.opening = new Promise((resolve, reject) => {
        // Some restricted origins throw even when reading window.indexedDB.
        // Storage failures must not prevent the practice player from starting.
        const factory = this.factory === undefined ? globalThis.indexedDB : this.factory;
        if (!factory) { reject(new Error("Local recording storage is unavailable")); return; }
        const request = factory.open(this.name, 2);
        let expired = false;
        const timer = setTimeout(() => { expired = true; reject(new Error("Local storage did not open")); }, 5000);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("takes")) db.createObjectStore("takes", {keyPath: "id"}).createIndex("song", "song");
          if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", {keyPath: ["takeId", "offset"]}).createIndex("takeId", "takeId");
          if (!db.objectStoreNames.contains("counters")) db.createObjectStore("counters");
          if (!db.objectStoreNames.contains("comps")) db.createObjectStore("comps", {keyPath: "key"}).createIndex("song", "song");
        };
        request.onsuccess = () => {
          clearTimeout(timer);
          const db = request.result;
          if (expired) { db.close(); return; }
          db.onversionchange = () => { db.close(); this.opening = null; };
          resolve(db);
        };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error("Close other recording tabs and retry")); };
      }).catch(error => { this.opening = null; throw error; });
      return this.opening;
    }

    async transaction(names, mode, action) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(names, mode);
        let result, failure;
        const timer = setTimeout(() => {
          failure = new Error("Local storage is not responding");
          try { tx.abort(); } catch {}
        }, 10000);
        tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
        tx.onabort = () => { clearTimeout(timer); reject(failure || tx.error || new Error("Local save failed")); };
        const fail = error => { failure = error; tx.abort(); };
        try { action(tx, value => { result = value; }, fail); }
        catch (error) { fail(error); }
      });
    }

    list(song) {
      return this.transaction(["takes"], "readonly", (tx, done) => {
        tx.objectStore("takes").index("song").getAll(song).onsuccess = event => done(event.target.result);
      });
    }

    usage() {
      return this.transaction(["takes"], "readonly", (tx, done) => {
        tx.objectStore("takes").getAll().onsuccess = event => done(event.target.result);
      });
    }

    comps(song) {
      return this.transaction(["comps"], "readonly", (tx, done) => {
        tx.objectStore("comps").index("song").getAll(song).onsuccess = e => done(e.target.result);
      });
    }

    saveComp(state, expectedRevision = state.revision) {
      return this.transaction(["comps", "takes"], "readwrite", (tx, done, fail) => {
        const store = tx.objectStore("comps");
        store.get(state.key).onsuccess = e => {
          if ((e.target.result?.revision || 0) !== expectedRevision) { fail(new Error("Comp changed in another tab. Reload and try again.")); return; }
          tx.objectStore("takes").getAll().onsuccess = result => {
            const records = new Map(result.target.result.map(t => [t.id, t]));
            const ids = [...state.segments, ...(state.undo || [])].map(s => s.takeId);
            if (ids.some(id => !records.has(id) || records.get(id).deleteAfter)) { fail(new Error("A comp source was deleted. Reload before editing.")); return; }
            const next = {...state, revision: expectedRevision + 1, updatedAt: Date.now()};
            store.put(next); done(next);
          };
        };
      });
    }

    protectedTakes(tx, callback) {
      tx.objectStore("comps").getAll().onsuccess = e => callback(new Set(e.target.result.flatMap(s =>
        [...s.segments, ...(s.undo || [])].map(p => p.takeId))));
    }

    importComp(state, sources, expectedRevision) {
      return this.transaction(["comps", "takes", "chunks", "counters"], "readwrite", (tx, done, fail) => {
        tx.objectStore("comps").get(state.key).onsuccess = e => {
          if ((e.target.result?.revision || 0) !== expectedRevision) { fail(new Error("Local comp changed during download. Try again.")); return; }
          tx.objectStore("counters").get(state.song).onsuccess = counter => {
            let number = counter.target.result || 0;
            for (const {record, pcm} of sources) {
              if (!(pcm instanceof Int16Array) || pcm.length !== record.frames) { fail(new Error("Invalid cloud recording")); return; }
              tx.objectStore("takes").add({...record, song: state.song, number: ++number});
              tx.objectStore("chunks").add({takeId: record.id, offset: 0, pcm});
            }
            const next = {...state, revision: expectedRevision + 1, updatedAt: Date.now()};
            tx.objectStore("counters").put(number, state.song);
            tx.objectStore("comps").put(next); done(next);
          };
        };
      });
    }

    append(record, offset, pcm, status) {
      return this.transaction(["takes", "chunks", "counters"], "readwrite", (tx, done, fail) => {
        const takes = tx.objectStore("takes");
        takes.get(record.id).onsuccess = event => {
          const previous = event.target.result;
          if (previous?.deleteAfter) { fail(new Error("This take is pending deletion")); return; }
          if ((previous?.frames || 0) !== offset) { fail(new Error("The take changed in another tab")); return; }
          const write = number => {
            const next = {...record, ...previous, ...status, number, frames: offset + pcm.length, updatedAt: Date.now()};
            if (pcm.length) tx.objectStore("chunks").add({takeId: record.id, offset, pcm});
            takes.put(next);
            done(next);
          };
          if (previous) write(previous.number);
          else {
            const counters = tx.objectStore("counters");
            counters.get(record.song).onsuccess = counter => {
              const number = (counter.target.result || 0) + 1;
              counters.put(number, record.song);
              write(number);
            };
          }
        };
      });
    }

    discardLongRests(take, reference) {
      const pitch = getPitch();
      if (!pitch.restPolicyValid(reference)) throw new Error("Missing rest timing");
      return this.transaction(["takes", "chunks"], "readwrite", (tx, done, fail) => {
        const takes = tx.objectStore("takes");
        takes.get(take.id).onsuccess = event => {
          const record = event.target.result;
          if (!record || !record.finalized || record.deleteAfter || record.frames !== take.frames
            || JSON.stringify(record.pitchReference) !== JSON.stringify(take.pitchReference)) {
            fail(new Error("Recording changed during rest cleanup")); return;
          }
          const frames = pitch.readContour(record);
          record.pitchReference = reference;
          record.restAudioVersion = pitch.REST_POLICY_VERSION;
          record.updatedAt = Date.now();
          if (frames) {
            const clean = pitch.cleanRestFrames(frames, reference);
            record.pitchContour = pitch.packContour(clean, record);
            record.pitchScore = pitch.scoreFrames(clean, reference, record.frames / record.sampleRate);
          } else { delete record.pitchContour; delete record.pitchScore; }
          const cursor = tx.objectStore("chunks").index("takeId").openCursor(take.id);
          cursor.onsuccess = e => {
            const item = e.target.result;
            if (!item) { takes.put(record); done(record); return; }
            const chunk = item.value;
            pitch.discardRestAudio(chunk.pcm, record.sampleRate, reference, chunk.offset);
            item.update(chunk);
            item.continue();
          };
        };
      });
    }

    rebaseReference(take, reference) {
      return this.transaction(["takes"], "readwrite", (tx, done) => {
        const takes = tx.objectStore("takes");
        takes.get(take.id).onsuccess = event => {
          const record = event.target.result;
          if (!record || record.frames !== take.frames || record.updatedAt !== take.updatedAt
            || JSON.stringify(record.pitchReference) !== JSON.stringify(take.pitchReference)) { done(null); return; }
          const next = getPitch().rebaseTake(record, reference);
          if (next && next !== record) takes.put(next);
          done(next);
        };
      });
    }

    pitchScore(id, frames, reference, result, contour) {
      return this.transaction(["takes"], "readwrite", (tx, done) => {
        const takes = tx.objectStore("takes");
        takes.get(id).onsuccess = event => {
          const record = event.target.result;
          // Never resurrect a deleted take, grade a growing checkpoint, or
          // overwrite a concurrent favorite/deletion edit with stale metadata.
          if (!record || !record.finalized || record.deleteAfter || record.frames !== frames
            || JSON.stringify(record.pitchReference) !== JSON.stringify(reference)) { done(null); return; }
          if (contour && (contour.audioFrames !== record.frames || contour.sampleRate !== record.sampleRate
            || contour.reference !== JSON.stringify(reference) || contour.analysisVersion !== result.version)) { done(null); return; }
          record.pitchScore = result;
          if (contour) record.pitchContour = contour;
          else if (record.pitchContour?.analysisVersion !== result.version) delete record.pitchContour;
          takes.put(record);
          done(record);
        };
      });
    }

    favorite(id, favorite) {
      return this.transaction(["takes"], "readwrite", (tx, done, fail) => {
        const takes = tx.objectStore("takes");
        takes.get(id).onsuccess = event => {
          const record = event.target.result;
          if (!record) { fail(new Error("This take was deleted in another tab")); return; }
          if (record.deleteAfter) { fail(new Error("Undo deletion before starring this take")); return; }
          record.favorite = favorite;
          takes.put(record);
          done(record);
        };
      });
    }

    stageDelete(song, id, now = Date.now(), {includeFavorites = false} = {}) {
      return this.transaction(["takes", "comps"], "readwrite", (tx, done, fail) => {
        const takes = tx.objectStore("takes");
        this.protectedTakes(tx, protectedIds => {
        if (protectedIds.has(id)) { fail(new Error("This recording is used by a track or its Undo. It has been kept.")); return; }
        takes.get(id).onsuccess = event => {
          const record = event.target.result;
          if (!record || record.song !== song || (record.favorite && !includeFavorites) || record.deleteAfter) { done(null); return; }
          if (includeFavorites) record.deleteFavorite = true;
          record.deleteAfter = now + DELETE_UNDO_MS;
          takes.put(record);
          done(record);
        };
        });
      });
    }

    undoDeletes(song, now = Date.now()) {
      return this.transaction(["takes"], "readwrite", (tx, done) => {
        const restored = [];
        done(restored);
        tx.objectStore("takes").index("song").openCursor(song).onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) return;
          const record = cursor.value;
          if (record.deleteAfter > now) {
            delete record.deleteAfter;
            delete record.deleteFavorite;
            cursor.update(record);
            restored.push(record);
          }
          cursor.continue();
        };
      });
    }

    purgeDeleted(song, now = Date.now()) {
      return this.transaction(["takes", "chunks", "comps"], "readwrite", (tx, done) => {
        const deleted = [];
        done(deleted);
        this.protectedTakes(tx, protectedIds => {
        tx.objectStore("takes").index("song").openCursor(song).onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) return;
          const record = cursor.value;
          if (!protectedIds.has(record.id) && record.deleteAfter && record.deleteAfter <= now && (!record.favorite || record.deleteFavorite)) {
            deleted.push(record.id);
            cursor.delete();
            tx.objectStore("chunks").index("takeId").openCursor(record.id).onsuccess = event => {
              const chunk = event.target.result;
              if (chunk) { chunk.delete(); chunk.continue(); }
            };
          }
          cursor.continue();
        };
        });
      });
    }

    deleteUnstarred(song, ids) {
      return this.deleteTakes(song, ids, {protectFavorites: true});
    }

    deleteTakes(song, ids, {protectFavorites = false} = {}) {
      return this.transaction(["takes", "chunks", "comps"], "readwrite", (tx, done) => {
        const takes = tx.objectStore("takes");
        const deleted = [];
        done(deleted);
        this.protectedTakes(tx, protectedIds => {
        for (const id of new Set(ids)) {
          if (protectedIds.has(id)) continue;
          takes.get(id).onsuccess = event => {
            const record = event.target.result;
            if (record && (record.song !== song || (protectFavorites && record.favorite))) return;
            deleted.push(id);
            takes.delete(id);
            tx.objectStore("chunks").index("takeId").openCursor(id).onsuccess = chunk => {
              const cursor = chunk.target.result;
              if (cursor) { cursor.delete(); cursor.continue(); }
            };
          };
        }
        });
      });
    }

    async wav(id) {
      return this.transaction(["takes", "chunks"], "readonly", (tx, done, fail) => {
        tx.objectStore("takes").get(id).onsuccess = event => {
          const record = event.target.result;
          if (!record) { fail(new Error("This take is no longer stored")); return; }
          const chunks = [], header = wavBytes(new Int16Array(0), record.sampleRate);
          const view = new DataView(header);
          view.setUint32(4, 36 + record.frames * 2, true);
          view.setUint32(40, record.frames * 2, true);
          let frames = 0;
          tx.objectStore("chunks").index("takeId").openCursor(id).onsuccess = chunk => {
            const cursor = chunk.target.result;
            if (cursor) {
              const {offset, pcm} = cursor.value;
              if (offset !== frames) { fail(new Error("Stored recording is incomplete")); return; }
              chunks.push(wavBytes(pcm, record.sampleRate).slice(44));
              frames += pcm.length;
              cursor.continue();
            } else if (frames !== record.frames) fail(new Error("Stored recording is incomplete"));
            else done(new Blob([header, ...chunks], {type: "audio/wav"}));
          };
        };
      });
    }
  }

  class TakeJournal {
    constructor(store, song, spec, sampleRate, {onSaved = () => {}, onDiscard = () => {}, onError = () => {}} = {}) {
      this.store = store;
      this.song = song;
      this.spec = spec;
      this.buffer = new TakeBuffer(sampleRate, Math.max(spec.seconds, spec.initial?.seconds || 0));
      this.entries = new Map();
      this.onSaved = onSaved;
      this.onDiscard = onDiscard;
      this.onError = onError;
      this.failed = null;
      this.closed = false;
    }

    fail(error) {
      if (this.failed) return;
      this.failed = error;
      for (const entry of this.entries.values()) entry.discardShortTail = false;
      this.onError(error);
    }

    begin(frame) {
      if (this.failed || this.closed) return;
      try {
        const {initial, ...loop} = this.spec;
        const spec = this.buffer.nextId === 1 && initial ? {...loop, ...initial} : loop;
        const take = this.buffer.begin(frame, spec.pitchReference);
        const record = {id: globalThis.crypto.randomUUID(), song: this.song, createdAt: Date.now(),
          sampleRate: this.buffer.sampleRate, frames: 0, favorite: false, finalized: false,
          complete: false, ...spec,
          ...(getPitch()?.restPolicyValid(spec.pitchReference) ? {restAudioVersion: getPitch().REST_POLICY_VERSION} : {})};
        this.entries.set(take, {take, record, savedFrames: 0, saving: null});
        this.pump();
      } catch (error) { this.fail(error); }
    }

    append(frame, samples) { this.buffer.append(frame, samples); this.pump(); }
    finish(frame, {discardShortTail = false, segment = null} = {}) {
      const take = this.buffer.current;
      this.buffer.finish(frame);
      this.closed = true;
      const entry = this.entries.get(take);
      if (entry && take.end - take.start >= Math.round(entry.record.seconds * this.buffer.sampleRate)) take.completed = true;
      if (entry && !this.failed && this.spec.mode === "segment" && segment
        && take.end - take.start > (entry.record.leadInSeconds || 0) * this.buffer.sampleRate) {
        const seconds = Math.min(entry.record.seconds, (take.end - take.start) / this.buffer.sampleRate);
        entry.finalMetadata = {...segment(entry.record, seconds), seconds};
        take.completed = true;
        return;
      }
      if (!entry || this.failed || !discardShortTail) return;
      const leadIn = Math.round((entry.record.leadInSeconds || 0) * this.buffer.sampleRate);
      const passage = Math.round(entry.record.seconds * this.buffer.sampleRate) - leadIn;
      // Count-in is retained in the audio, but cannot make a short attempt qualify.
      entry.discardShortTail = passage > 0 && take.end - take.start - leadIn < passage;
    }

    views() {
      return [...this.entries.values()].map(({take, record, savedFrames, saving}) => {
        const info = this.buffer.info(take);
        return {...record, ...info, id: record.id, number: record.number,
          frames: info.length, savedFrames, saving: Boolean(saving),
          unsaved: info.length > savedFrames || (!info.active && !record.finalized)};
      });
    }

    pump(force = false) {
      if (this.failed) return;
      for (const entry of this.entries.values()) {
        if (entry.saving) continue;
        const {take} = entry, info = this.buffer.info(take);
        const finalized = take.end !== null && (take.written >= take.end - take.start || force);
        if (!finalized && info.length - entry.savedFrames < this.buffer.sampleRate) continue;
        if (!info.length && finalized) { this.entries.delete(take); this.buffer.release(take); continue; }
        if (finalized && entry.discardShortTail && !info.gap && take.written >= take.end - take.start) {
          // Delete only this unfinished pass, after its pending checkpoints.
          entry.saving = this.store.deleteTakes(this.song, [entry.record.id]).then(deleted => {
            entry.discardShortTail = false;
            if (deleted.includes(entry.record.id)) {
              this.entries.delete(take);
              this.buffer.release(take);
              this.onDiscard(entry.record.id);
            }
          }).catch(error => this.fail(error)).finally(() => {
            entry.saving = null;
            this.pump(force);
          });
          continue;
        }
        const end = info.length;
        const pcm = take.pcm.slice(entry.savedFrames, end);
        entry.saving = this.store.append(entry.record, entry.savedFrames, pcm,
          {...(finalized ? entry.finalMetadata : {}), complete: finalized && info.complete, finalized, gap: info.gap, peak: info.peak})
          .then(record => {
            entry.record = record;
            entry.savedFrames = end;
            this.onSaved(record);
            if (finalized) { this.entries.delete(take); this.buffer.release(take); }
          }).catch(error => this.fail(error)).finally(() => {
            entry.saving = null;
            this.pump(force);
          });
      }
    }

    async flush() {
      this.pump(true);
      while ([...this.entries.values()].some(entry => entry.saving)) {
        await Promise.all([...this.entries.values()].map(entry => entry.saving));
        this.pump(true);
      }
      this.buffer.recentChunks.length = 0;
    }

    async retry() { this.failed = null; await this.flush(); }

    drop(ids) {
      for (const [take, entry] of this.entries) {
        if (ids.includes(entry.record.id)) { this.entries.delete(take); this.buffer.release(take); }
      }
    }

    wav(id) {
      const entry = [...this.entries.values()].find(item => item.record.id === id);
      return entry ? new Blob([wavBytes(this.buffer.samples(entry.take), this.buffer.sampleRate)], {type: "audio/wav"}) : null;
    }
  }

  function wavBytes(samples, sampleRate) {
    const bytes = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(bytes);
    const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true);
    text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
    return bytes;
  }

  // The audio thread supplies frame timestamps; timer jitter does not stretch
  // or concatenate the recorded signal. Output is always silent, not mic monitor.
  const WORKLET_SOURCE = `
    class MeleteMicCapture extends AudioWorkletProcessor {
      constructor() {
        super();
        this.samples = new Float32Array(2048);
        this.used = 0;
        this.start = 0;
        this.hasInput = false;
        this.stopped = false;
        this.port.onmessage = event => {
          if (event.data === 'stop') {
            this.flush();
            this.stopped = true;
            this.port.postMessage({stopped: true});
          }
        };
      }
      flush() {
        if (!this.used) return;
        const samples = this.samples.slice(0, this.used);
        this.port.postMessage({frame: this.start, samples, hasInput: this.hasInput}, [samples.buffer]);
        this.used = 0;
        this.hasInput = false;
      }
      process(inputs, outputs) {
        if (this.stopped) return false;
        const channels = inputs[0];
        const length = outputs[0][0].length;
        if (this.used && currentFrame !== this.start + this.used) this.flush();
        for (let i = 0; i < length; i++) {
          if (!this.used) this.start = currentFrame + i;
          let value = 0;
          if (channels?.length) {
            this.hasInput = true;
            for (const channel of channels) value += channel[i] || 0;
            value /= channels.length;
          }
          this.samples[this.used++] = value;
          if (this.used === this.samples.length) this.flush();
        }
        return true;
      }
    }
    registerProcessor('melete-mic-capture', MeleteMicCapture);
  `;
  const installed = new WeakMap();
  class PcmCapture {
    static async create(context, source, onSamples, onError) {
      if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
        throw new Error("Loop recording needs a browser with AudioWorklet support");
      }
      if (!installed.has(context)) {
        // A data module also works in standalone file:// pages, where Chrome
        // rejects a blob:null module as cross-origin. This source has no imports.
        const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(WORKLET_SOURCE)}`;
        installed.set(context, context.audioWorklet.addModule(url));
      }
      try { await installed.get(context); }
      catch (error) { installed.delete(context); throw error; }
      const capture = new PcmCapture();
      capture.context = context;
      capture.source = source;
      capture.node = new AudioWorkletNode(context, "melete-mic-capture", {outputChannelCount: [1]});
      let resolveReady, rejectReady;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const timeout = setTimeout(() => rejectReady(new Error("No microphone samples arrived")), 3000);
      capture.node.port.onmessage = ({data}) => {
        if (data.samples) {
          onSamples(data.frame, data.samples);
          if (data.hasInput) resolveReady();
        }
        if (data.stopped) capture.resolveStop?.();
      };
      capture.node.onprocessorerror = () => {
        const error = new Error("Microphone recording was interrupted");
        rejectReady(error);
        onError(error);
      };
      capture.node.connect(context.destination);
      source.connect(capture.node);
      // Permission can resolve before a cold input starts delivering blocks.
      // Wait for actual frames (silence is valid) before starting the score.
      try { await ready; return capture; }
      catch (error) { await capture.stop(); throw error; }
      finally { clearTimeout(timeout); }
    }

    stop() {
      if (this.stopping) return this.stopping;
      this.stopping = new Promise(resolve => {
        const finish = () => {
          clearTimeout(timeout);
          try { this.source.disconnect(this.node); } catch {}
          this.node.disconnect();
          this.node.port.close();
          resolve();
        };
        const timeout = setTimeout(finish, 500);
        this.resolveStop = finish;
        this.node.port.postMessage("stop");
      });
      return this.stopping;
    }
  }

  return {TakeBuffer, TakeStore, TakeJournal, wavBytes, PcmCapture, CountIn, countInPlan,
    recordingEntrance, auditionEntrances, takeBytes, takeFilename, takeArchive, takePlaybackWindow, takePlaybackGain, DELETE_UNDO_MS, STORAGE_WARNING_BYTES,
    MAX_LOOP_SECONDS, WORKLET_SOURCE};
});
