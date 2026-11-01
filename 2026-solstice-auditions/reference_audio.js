/* Recordings, stems and notation share the media clock through a checked tick map. */
(function(root) {
  "use strict";
  class Timeline {
    constructor(anchors) {
      if (!Array.isArray(anchors) || anchors.length < 2 || anchors[0][0] !== 0 ||
          anchors.some((p, i) => p.length !== 2 || !p.every(Number.isFinite) || p[0] < 0 ||
            i && (p[0] <= anchors[i - 1][0] || p[1] <= anchors[i - 1][1]))) {
        throw new Error("Invalid recording alignment");
      }
      this.anchors = anchors.map(p => [...p]);
      this.start = anchors[0][1]; this.end = anchors.at(-1)[1]; this.endTick = anchors.at(-1)[0];
      this.playStart = Math.max(0, this.start - .15);
    }
    interpolate(value, from, to) {
      const a = this.anchors;
      if (value <= a[0][from]) return a[0][to];
      if (value >= a.at(-1)[from]) return a.at(-1)[to];
      let low = 0, high = a.length - 1;
      while (high - low > 1) { const mid = (low + high) >> 1; if (a[mid][from] <= value) low = mid; else high = mid; }
      return a[low][to] + (value - a[low][from]) / (a[high][from] - a[low][from]) * (a[high][to] - a[low][to]);
    }
    seconds(tick) { return this.interpolate(tick, 0, 1); }
    tick(seconds) { return this.interpolate(seconds, 1, 0); }
  }
  function selectTrack(entry, vocal, backing) {
    const tracks = entry?.tracks || [], find = id => tracks.find(t => t.id === id);
    if (vocal && backing) return find("original") || find("backing") || find("instrumental");
    if (vocal) return find("vocal");
    if (backing) return find("backing") || find("instrumental");
    return null;
  }
  function sourceLink(source, seconds) {
    if(!source)return null;
    const url=new URL(source),youtube=['youtu.be','youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname);
    if(youtube&&Number.isFinite(seconds))url.searchParams.set('t',`${Math.floor(Math.max(0,seconds))}s`);
    const at=Math.max(0,seconds),time=Number.isFinite(at)?`${Math.floor(at/60)}:${String(Math.floor(at%60)).padStart(2,'0')}`:null;
    return {url:url.href,label:youtube?`YouTube${time?' '+time:''}`:url.hostname.endsWith('.bandcamp.com')?'Original (Bandcamp)':'Original recording'};
  }
  class Player {
    constructor(audio, {onError = () => {}, onChange = () => {}, buffered=false} = {}) {
      this.audio = audio; this.onError = onError; this.onChange = onChange;
      this.buffered=buffered;this.position=0;
      this.entry = null; this.vocal = true; this.backing = true; this.pending = null;
      this.timeline = null;
      this.playGeneration = 0;
      audio.addEventListener("loadedmetadata", () => this.restorePosition());
      audio.addEventListener("error", () => {
        this.pending = null;
        if (audio.getAttribute("src")) this.onError("Reference audio is unavailable. Check that Mac-Windows is connected.");
        this.onChange();
      });
    }
    setTimeline(timeline) {
      this.timeline = timeline;
      if (timeline) this.seek(timeline.playStart);
    }
    setEntry(entry) {
      const original = e => e?.tracks?.find(t => t.id === "original")?.file;
      const changed = this.entry?.id !== entry?.id || original(this.entry) !== original(entry);
      this.entry = entry;
      if (changed) { this.pause(); this.pending = null; this.timeline = null; }
      this.route(changed);
    }
    setMix(vocal, backing) {
      this.vocal = !!vocal; this.backing = !!backing; this.route(false);
    }
    route(reset) {
      // The Web Audio deck owns buffered playback; do not also request full
      // original files through a hidden HTMLAudioElement during navigation.
      if(this.buffered){if(reset)this.position=0;this.onChange();return;}
      const audio = this.audio;
      const track = selectTrack(this.entry, this.vocal, this.backing);
      const silent = !this.vocal && !this.backing;
      // All-on uses the untouched download. Stem solos keep its elapsed position.
      const source = track || selectTrack(this.entry, true, true);
      audio.muted = silent;
      if (silent && !reset && audio.getAttribute("src")) { this.onChange(); return; }
      if (!reset && source?.src === audio.getAttribute("src")) { this.onChange(); return; }
      const time = reset ? this.timeline?.playStart || 0 : this.pending?.time ?? audio.currentTime ?? 0;
      const rate = this.pending?.rate ?? audio.playbackRate;
      const resume = !reset && (this.pending?.resume ?? !audio.paused);
      this.playGeneration++;audio.pause(); this.pending = null;
      if (source) {
        this.pending = {time, resume, rate, src: source.src};
        audio.setAttribute("src", source.src);
      } else audio.removeAttribute("src");
      audio.preload = resume ? "auto" : "metadata";
      audio.load(); this.onChange();
    }
    restorePosition() {
      const pending = this.pending, audio = this.audio;
      if (!pending || audio.getAttribute("src") !== pending.src) return;
      this.pending = null;
      const duration = Number.isFinite(audio.duration) ? audio.duration : pending.time;
      audio.currentTime = Math.max(0, Math.min(pending.time, duration));
      audio.playbackRate = pending.rate;
      if (pending.resume) void this.play();
      this.onChange();
    }
    pause() {
      this.playGeneration++;
      if (this.pending) this.pending.resume = false;
      this.audio.pause();
    }
    play() {
      if (this.pending) { this.pending.resume = true; this.onChange(); return; }
      const generation = ++this.playGeneration;
      return this.audio.play().catch(error => {
        if(generation!==this.playGeneration)return;
        this.pause();this.onError(error.message);
      });
    }
    get currentTime() { return this.buffered?this.position:this.pending?.time ?? this.audio.currentTime; }
    setRate(rate) {
      this.audio.playbackRate = rate; this.audio.defaultPlaybackRate = rate;
      if (this.pending) this.pending.rate = rate;
    }
    get tick() { return this.timeline?.tick(this.currentTime) ?? 0; }
    seekTick(tick) { if (this.timeline) this.seek(tick <= 0 ? this.timeline.playStart : this.timeline.seconds(tick)); }
    toggle() {
      if (this.pending) { this.pending.resume = !this.pending.resume; this.onChange(); return; }
      if (this.audio.paused) void this.play();
      else this.pause();
    }
    seek(seconds) {
      const time = this.timeline ? Math.max(this.timeline.playStart, Math.min(this.timeline.end, seconds)) : Math.max(0, seconds);
      if(this.buffered){this.position=time;return;}
      if (this.pending) this.pending.time = time;
      else this.audio.currentTime = Math.min(this.audio.duration || time, time);
    }
  }
  const api = {Player, selectTrack, Timeline, sourceLink};
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteReferenceAudio = api;
})(typeof window === "object" ? window : globalThis);
