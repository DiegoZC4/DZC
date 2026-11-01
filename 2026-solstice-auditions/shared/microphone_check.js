(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteMicrophoneCheck = api;
})(typeof window === "object" ? window : globalThis, function() {
  "use strict";

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
    constructor({dialog, trigger, acquire, release, choose, busy, failureMessage, refresh}) {
      Object.assign(this, {dialog, trigger, acquire, release, choose, busy, failureMessage, refresh});
      this.select = dialog.querySelector("select");
      this.status = dialog.querySelector("[role=status]");
      this.meter = dialog.querySelector("[role=meter]");
      this.fill = dialog.querySelector(".mic-check-fill");
      this.readout = dialog.querySelector("output");
      this.device = dialog.querySelector(".mic-check-device");
      this.retry = dialog.querySelector(".mic-check-retry");
      this.generation = 0;
      this.active = false;
      trigger.addEventListener("click", () => {
        dialog.showModal();
        void this.start();
      });
      dialog.querySelector(".mic-check-close").addEventListener("click", () => this.close());
      dialog.addEventListener("close", () => { if (!dialog.open) this.stop(); });
      this.retry.addEventListener("click", () => { void this.start(); });
      this.select.addEventListener("change", () => {
        if (this.busy() || this.requesting) return;
        const selected = this.select.value;
        this.stop();
        this.choose(selected);
        void this.start();
      });
    }
    syncSelector(original) {
      this.select.replaceChildren(...Array.from(original.options, option => option.cloneNode(true)));
      this.select.value = original.value;
      this.select.disabled = this.busy() || this.requesting;
      this.select.title = this.busy() ? "Stop Sing and recording to change microphone" : "Microphone input";
    }
    paint(state, text = labels[state], db = -60, percent = 0) {
      this.dialog.dataset.state = state;
      if (this.status.textContent !== text) this.status.textContent = text;
      this.meter.setAttribute("aria-valuenow", String(Math.round(db)));
      this.meter.setAttribute("aria-valuetext", `${text}; ${db <= -60 ? "below -60" : db.toFixed(0)} dBFS`);
      this.fill.style.transform = `scaleX(${percent / 100})`;
      this.readout.textContent = db <= -60 ? "< -60 dBFS" : `${db.toFixed(0)} dBFS`;
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
      if (this.dialog.open) this.dialog.close();
    }
    fail(message) {
      this.stop();
      this.select.disabled = this.busy();
      this.paint("error", message);
      this.retry.hidden = false;
    }
    async start() {
      this.stop();
      const generation = this.generation;
      this.active = this.requesting = true;
      this.select.disabled = true;
      this.retry.hidden = true;
      this.device.textContent = "";
      this.paint("requesting", "Waiting for microphone...");
      try {
        if (this.refresh) await this.refresh();
        if (generation !== this.generation) return;
        const {source, context, track} = await this.acquire();
        if (generation !== this.generation) { this.release(); return; }
        this.requesting = false;
        this.select.disabled = this.busy();
        this.device.textContent = track.label || "Microphone";
        this.source = source;
        this.analyser = context.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0;
        source.connect(this.analyser);
        const samples = new Float32Array(this.analyser.fftSize), level = new Level(performance.now());
        const tick = () => {
          if (generation !== this.generation) return;
          if (track.readyState !== "live") { this.fail("Microphone disconnected"); return; }
          if (context.state !== "running") { this.fail("Microphone audio interrupted"); return; }
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
  return {Level, Check};
});
