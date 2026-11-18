(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteMicrophoneCheck = api;
})(typeof window === "object" ? window : globalThis, function() {
  "use strict";

  function microphoneNavigator(view) {
    // Firefox Android rejects microphone requests from about:srcdoc. Let our
    // same-origin collection page request permission; the player owns the stream.
    try {
      if (view.frameElement?.hasAttribute("data-melete-collection-player")
        && view.parent !== view && view.parent.origin === view.origin) {
        return view.parent.navigator;
      }
    } catch { /* Unrelated cross-origin embeds use their own permission policy. */ }
    return view.navigator;
  }
  const mediaDevicesFor = view => microphoneNavigator(view).mediaDevices;

  const processingKeys = ["echoCancellation", "noiseSuppression", "autoGainControl"];
  function rawAudioConstraints(deviceId = "") {
    return {audio: {...(deviceId ? {deviceId: {exact: deviceId}} : {}),
      channelCount: {ideal: 1}, latency: {ideal: 0},
      ...Object.fromEntries(processingKeys.map(key => [key, {exact: false}]))}};
  }
  function captureProfile(track) {
    const settings = track?.getSettings?.() || {};
    return {version: 1, policy: "unprocessed", ...Object.fromEntries(processingKeys.map(key =>
      [key, typeof settings[key] === "boolean" || typeof settings[key] === "string" ? settings[key] : null])),
      sampleRate: settings.sampleRate ?? null, channelCount: settings.channelCount ?? null};
  }
  function verifyRawInput(stream) {
    const tracks = stream.getAudioTracks(), profile = captureProfile(tracks[0]);
    if (!tracks.length || processingKeys.some(key => profile[key] !== false && profile[key] !== null)) {
      stream.getAudioTracks().forEach(track => track.stop());
      const error = new Error("This input still applies voice processing. Recording was blocked; choose an unprocessed microphone input.");
      error.name = "RawAudioUnavailableError";
      throw error;
    }
    return profile;
  }

  class Level {
    constructor(now = 0) {
      this.started = now;
      this.last = now;
      this.db = -60;
      this.clipUntil = -Infinity;
    }
    sample(samples, now, {muted = false} = {}) {
      let power = 0, sum = 0, peak = 0;
      for (const value of samples) {
        const sample = Number.isFinite(value) ? value : 0;
        sum += sample; power += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const n = Math.max(1, samples.length);
      const rms = Math.sqrt(Math.max(0, power / n - (sum / n) ** 2));
      const db = muted ? -60 : Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(rms, 1e-6))));
      // Fast attack, short release, and a one-second clipping hold keep brief
      // syllables and overloads visible without treating pauses as failures.
      this.db = muted ? -60 : Math.max(db, this.db - Math.max(0, now - this.last) * 0.06);
      if (!muted && peak >= 0.999) this.clipUntil = now + 1000;
      this.last = now;
      const state = muted ? "muted" : now < this.clipUntil ? "clipping"
        : this.db > -45 ? "signal" : this.db > -60 ? "quiet"
          : now - this.started < 1200 ? "listening" : "silent";
      return {state, db: this.db, percent: (this.db + 60) / 60 * 100};
    }
  }

  const labels = {listening: "Listening...", silent: "No signal", quiet: "Quiet input",
    signal: "Input detected", clipping: "Clipping", muted: "Input muted"};

  class Check {
    constructor({dialog, trigger, acquire, release, choose, busy, failureMessage, refresh, inline = false, select, passive = false}) {
      Object.assign(this, {dialog, trigger, acquire, release, choose, busy, failureMessage, refresh, inline, passive});
      this.select = select || dialog.querySelector("select");
      this.status = dialog.querySelector("[role=status]");
      this.meter = dialog.querySelector("[role=meter]");
      this.fill = dialog.querySelector(".mic-check-fill");
      this.readout = dialog.querySelector("output");
      this.device = dialog.querySelector(".mic-check-device");
      this.retry = dialog.querySelector(".mic-check-retry");
      this.generation = 0;
      this.active = false;
      trigger.addEventListener("click", () => {
        if (this.passive) return;
        if (this.inline) {
          if (this.busy()) return;
          if (this.active) { this.close(); return; }
        } else dialog.showModal();
        void this.start();
      });
      dialog.querySelector(".mic-check-close")?.addEventListener("click", () => this.close());
      if (!inline) dialog.addEventListener("close", () => { if (!dialog.open) this.stop(); });
      this.retry?.addEventListener("click", () => { void this.start(); });
      this.select.addEventListener("change", () => {
        if (this.busy() || this.requesting) return;
        const selected = this.select.value;
        const restart = !this.passive && (!this.inline || this.active || this.dialog.dataset.state === "error");
        this.stop();
        this.choose(selected);
        if (restart) void this.start();
      });
      if (inline) this.paint("idle", passive ? "Mic off" : "Test input");
    }
    syncSelector(original) {
      if (this.select !== original) {
        this.select.replaceChildren(...Array.from(original.options, option => option.cloneNode(true)));
        this.select.value = original.value;
      }
      this.select.disabled = this.busy() || this.requesting;
      this.select.title = this.busy() ? "Stop Sing and recording to change microphone" : "Microphone input";
    }
    paint(state, text = labels[state], db = -60, percent = 0) {
      this.dialog.dataset.state = state;
      const visible = this.inline && state === "error" ? "Input unavailable"
        : this.inline && state === "requesting" ? "Connecting..." : text;
      if (this.status.textContent !== visible) this.status.textContent = visible;
      this.meter.setAttribute("aria-valuenow", String(Math.round(db)));
      this.meter.setAttribute("aria-valuetext", `${text}; ${db <= -60 ? "below -60" : db.toFixed(0)} dBFS`);
      this.fill.style.transform = `scaleX(${percent / 100})`;
      this.readout.textContent = this.inline && ["idle", "error", "requesting"].includes(state) ? ""
        : db <= -60 ? "< -60 dBFS" : `${db.toFixed(0)} dBFS`;
      if (this.inline) {
        if (this.passive) {
          this.trigger.title = [this.inputLabel, text].filter(Boolean).join("; ");
          return;
        }
        const action = this.active ? "Stop microphone check" : state === "error" ? "Retry microphone check" : "Test microphone input";
        this.trigger.setAttribute("aria-pressed", String(this.active));
        this.trigger.setAttribute("aria-label", action);
        this.trigger.title = [this.inputLabel, text, this.busy() ? "Recording input" : action].filter(Boolean).join("; ");
      }
    }
    stop() {
      this.generation++;
      this.active = false;
      this.requesting = false;
      clearTimeout(this.timer);
      try { this.source?.disconnect(this.analyser); } catch {}
      this.source = this.analyser = null;
      this.release();
    }
    close() {
      this.stop();
      if (this.inline) {
        this.select.disabled = this.busy();
        this.inputLabel = "";
        this.paint("idle", this.passive ? "Mic off" : "Test input");
      } else if (this.dialog.open) this.dialog.close();
    }
    fail(message) {
      this.stop();
      this.select.disabled = this.busy();
      this.paint("error", message);
      if (this.retry) this.retry.hidden = false;
    }
    async start() {
      // Recording and metering share one live source. Starting recording must
      // not tear down a running meter (and release that source underneath it).
      if (this.active && (this.requesting || this.source)) return;
      this.stop();
      const generation = this.generation;
      this.active = this.requesting = true;
      this.select.disabled = true;
      if (this.retry) this.retry.hidden = true;
      if (this.device) this.device.textContent = "";
      this.inputLabel = "";
      this.paint("requesting", "Waiting for microphone...");
      try {
        if (this.refresh) await this.refresh();
        if (generation !== this.generation) return;
        const {source, context, track} = await this.acquire();
        if (generation !== this.generation) { this.release(); return; }
        this.requesting = false;
        this.select.disabled = this.busy();
        this.inputLabel = track.label || "Microphone";
        if (this.device) this.device.textContent = this.inputLabel;
        this.source = source;
        this.analyser = context.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0;
        source.connect(this.analyser);
        const samples = new Float32Array(this.analyser.fftSize), level = new Level(performance.now());
        const tick = () => {
          if (generation !== this.generation) return;
          if (track.readyState !== "live") { this.fail("Microphone disconnected"); return; }
          if (context.state !== "running") {
            if (!this.passive) { this.fail("Microphone audio interrupted"); return; }
            this.paint("idle", "Paused");
            this.timer = setTimeout(tick, 100);
            return;
          }
          this.analyser.getFloatTimeDomainData(samples);
          const result = level.sample(samples, performance.now(), {muted: track.muted});
          this.paint(result.state, labels[result.state], result.db, result.percent);
          this.timer = setTimeout(tick, 50);
        };
        tick();
      } catch (error) {
        if (generation === this.generation) {
          this.fail(this.failureMessage(error));
          try { if (this.refresh) await this.refresh(); } catch {}
          this.select.disabled = this.busy();
        }
      }
    }
  }
  // Long, tapered sweeps buy processing gain without changing device volume.
  function timingChirp(rate, descending=false, phase=0) {
    const duration=.144, data=new Float32Array(Math.round(duration*rate));
    const from=descending?3000:900, to=descending?900:3000;
    for(let i=0;i<data.length;i++){const t=i/rate;data[i]=.10*Math.sin(Math.PI*i/data.length)**2*
      Math.sin(phase+2*Math.PI*(from*t+.5*(to-from)/duration*t*t));}
    return data;
  }
  function chirpReadings(samples,rate,starts,directions=[]) {
    const hz=8000, input=new Float32Array(Math.floor(samples.length*hz/rate));
    let previous=0;
    for(let i=0;i<input.length;i++){
      const lo=Math.floor(i*rate/hz), hi=Math.max(lo+1,Math.floor((i+1)*rate/hz));
      let sum=0;for(let j=lo;j<hi;j++)sum+=samples[j]||0;
      const mean=sum/(hi-lo);input[i]=mean-previous;previous=mean;
    }
    return starts.map((time,k)=>{
      const sin=timingChirp(hz,directions[k]), cos=timingChirp(hz,directions[k],Math.PI/2);
      const energy=sin.reduce((s,v)=>s+v*v,0), first=Math.round(time*hz);
      const n=Math.min(Math.round(.55*hz)+1,input.length-first-sin.length+1);
      if(first<0||n<2)return {accepted:false,reason:"capture too short"};
      const scores=new Float32Array(n);let power=0,best=0,second=0;
      for(let i=0;i<sin.length;i++)power+=input[first+i]**2;
      for(let j=0;j<n;j++){
        let a=0,b=0;for(let i=0;i<sin.length;i++){const v=input[first+j+i];a+=sin[i]*v;b+=cos[i]*v;}
        scores[j]=power>1e-14?Math.hypot(a,b)/Math.sqrt(energy*power):0;
        if(scores[j]>scores[best])best=j;
        if(j+1<n)power+=input[first+j+sin.length]**2-input[first+j]**2;
      }
      for(let j=0;j<n;j++)if(Math.abs(j-best)>hz*.012)second=Math.max(second,scores[j]);
      const floor=new Float32Array(scores).sort()[Math.floor(n/2)], peak=scores[best];
      const distinct=peak>second*1.45, audible=peak>.12 && peak>6*floor;
      return {seconds:best/hz,peak,accepted:audible && distinct,
        reason:!audible?"chirp not distinguishable from noise":!distinct?"ambiguous echo":""};
    });
  }
  function measuredLatency(samples,rate,starts) {
    const peaks=chirpReadings(samples,rate,starts).filter(p=>p.accepted).map(p=>p.seconds);
    if(peaks.length<2)return null;
    const consistent=peaks.map(p=>peaks.filter(q=>Math.abs(p-q)<=.012)).sort((a,b)=>b.length-a.length)[0];
    if(consistent.length<2)return null;
    return Math.round(1000*consistent.reduce((s,v)=>s+v,0)/consistent.length)/1000;
  }
  function calibration(samples,rate,starts,now=Date.now()){
    return fitChirps(chirpReadings(samples,rate,starts),now);
  }
  function fitChirps(readings,now=Date.now()){
    if(![3,4].includes(readings.length) || readings.some(p=>!p.accepted))return null;
    const peaks=readings.slice(0,3).map(p=>p.seconds).sort((a,b)=>a-b);
    if(peaks[2]-peaks[0]>.012)return null;
    if(readings.length===4){
      const residualMs=Math.round((readings[3].seconds-peaks[1])*1000);
      if(Math.abs(readings[3].seconds-peaks[1])>.012)return null;
      return {seconds:peaks[1],spreadMs:Math.round((peaks[2]-peaks[0])*1000),residualMs,measuredAt:now};
    }
    return {seconds:peaks[1],spreadMs:Math.round((peaks[2]-peaks[0])*1000),measuredAt:now};
  }
  // A group ID can rotate on reload. Use it only to join the default alias to
  // an unambiguous physical device in this enumeration, never as a saved ID.
  function physicalEndpoint(devices,kind,requested) {
    if(requested!=null && typeof requested!=="string")return "";
    const id=requested || "default", alias=id==="default" || id==="communications";
    if(!alias)return id;
    const list=devices.filter(d=>d.kind===kind), proxy=list.find(d=>d.deviceId===id);
    if(!proxy)return "";
    const physical=list.filter(d=>d.deviceId && !["default","communications"].includes(d.deviceId));
    const group=physical.filter(d=>proxy.groupId && d.groupId===proxy.groupId);
    if(group.length===1)return group[0].deviceId;
    const named=(group.length?group:physical).filter(d=>d.label &&
      (proxy.label===d.label || proxy.label?.endsWith(" - "+d.label)));
    return named.length===1 ? named[0].deviceId : "";
  }
  function timingRouteKey(devices,input,sink,rates,epoch,liveId) {
    if(!input || !rates.every(v=>v>0) || sink!=null && typeof sink!=="string")return null;
    const mic=physicalEndpoint(devices,"audioinput",input.deviceId);
    const output=physicalEndpoint(devices,"audiooutput",sink);
    if(mic && output)return "melete:roundtrip:v3:"+JSON.stringify([mic,output,...rates]);
    const group=(kind,id)=>devices.find(d=>d.kind===kind && d.deviceId===(id||"default"))?.groupId;
    const source=mic || input.groupId || group("audioinput",input.deviceId) || liveId;
    if(!source)return null;
    // Browsers need not enumerate the active system output. Never persist a
    // correction for that anonymous route or reuse it after a device change.
    return "session:"+JSON.stringify([source,output || group("audiooutput",sink) || null,...rates,epoch]);
  }
  function isQc35II(label) {return /\b(?:quietcomfort|qc)[\s-]*35[\s-]*(?:ii|2)\b/i.test(label||"");}
  function timingHint(labels,seconds,previouslyMeasured) {
    if(previouslyMeasured)return "Audio setup changed. Use the stopwatch to measure it before judging entrances.";
    if(labels.some(s=>isQc35II(s) || /bluetooth|airpods|galaxy buds|pixel buds|hands[- ]free/i.test(s||"")))
      return "Headset timing is estimated. Pause and use the stopwatch before judging entrances.";
    if(seconds>=.08)return "Audio timing is estimated. Pause and use the stopwatch before judging entrances.";
    return "";
  }
  function timingProfile(settings,input,output) {
    const numeric=v=>Number.isFinite(v) && v>=0 ? v : null;
    const flag=v=>typeof v==="boolean" || typeof v==="string" ? v : null;
    return {version:1,rates:[numeric(input?.sampleRate),numeric(output?.sampleRate),numeric(settings?.sampleRate)],
      channels:numeric(settings?.channelCount),processing:[settings?.echoCancellation,settings?.noiseSuppression,settings?.autoGainControl].map(flag),
      latency:[settings?.latency,output?.baseLatency,output?.outputLatency].map(numeric)};
  }
  function sameProfile(a,b) {
    return a?.version===1 && b?.version===1 &&
      a.rates?.[0]>0 && a.rates?.[1]>0 && JSON.stringify(a.rates)===JSON.stringify(b.rates) &&
      a.channels===b.channels && JSON.stringify(a.processing)===JSON.stringify(b.processing) &&
      a.latency?.length===3 && b.latency?.length===3 &&
      a.latency.every((v,i)=>v===b.latency[i] || Number.isFinite(v) && Number.isFinite(b.latency[i]) && Math.abs(v-b.latency[i])<=.012);
  }
  function freshCalibration(r,now=Date.now(),profile=null){
    if(!r || !Number.isFinite(r.seconds) || r.seconds<0 || r.seconds>.55 ||
      !Number.isFinite(r.spreadMs) || r.spreadMs<0 || r.spreadMs>12 ||
      !Number.isFinite(r.measuredAt) || now<r.measuredAt)return null;
    if(r.profile || profile)return Number.isFinite(r.residualMs) && Math.abs(r.residualMs)<=12 &&
      sameProfile(r.profile,profile || r.profile) ? r : null;
    return now-r.measuredAt<12*3600000 ? r : null;
  }
  // Compare elapsed audio time, not callback arrival time or sung notes.
  // Requiring consecutive observations rejects block jitter and single stalls.
  function watchClocks(mic,output) {return {mic,output,last:output,deltas:[],warned:false};}
  function clockDivergence(w,mic,output) {
    if(!w || w.warned || !Number.isFinite(mic) || !Number.isFinite(output))return null;
    const step=output-w.last;
    if(step<0 || step>3 || mic<w.mic){Object.assign(w,watchClocks(mic,output));return null;}
    if(step<.9)return null;
    w.last=output;
    const delta=(mic-w.mic)-(output-w.output);
    if(Math.abs(delta)<.030 || Math.sign(delta)!==Math.sign(w.deltas.at(-1)))w.deltas=[];
    if(Math.abs(delta)>=.030)w.deltas.push(delta);
    if(w.deltas.length<5)return null;
    w.warned=true;
    return Math.round([...w.deltas].sort((a,b)=>a-b)[2]*1000);
  }
  // Both clocks are sampled together; a late JS callback must not move score zero.
  function passClock(micNow,outputNow,anchor,base,position,rate,sampleRate,latency) {
    const frame=Math.round((micNow+(anchor-outputNow)+(position-base)/rate)*sampleRate);
    return {frame,position,rate,sampleRate,latency};
  }
  function sampleScoreTime(clock,micTime,analysisLatency) {
    return clock.position+(micTime-clock.frame/clock.sampleRate-analysisLatency-clock.latency)*clock.rate;
  }
  const logKey="melete:audio-diagnostics:v1";
  function deviceEvents(store) {
    try {const rows=JSON.parse(store.getItem(logKey));return Array.isArray(rows)?rows.slice(-40):[];} catch{return [];}
  }
  function deviceEvent(store,event,details) {
    try {store.setItem(logKey,JSON.stringify([...deviceEvents(store),{at:new Date().toISOString(),event,...details}].slice(-40)));}catch{}
  }
  return {Level, Check, mediaDevicesFor, microphoneNavigator, rawAudioConstraints,captureProfile,verifyRawInput,
    timingChirp, measuredLatency, calibration,chirpReadings,fitChirps,timingRouteKey,timingHint,isQc35II,
    physicalEndpoint,timingProfile,freshCalibration,watchClocks,clockDivergence,passClock,sampleScoreTime,deviceEvents,deviceEvent};
});
