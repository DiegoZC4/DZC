// Only a key event or a changed pitch wheel value can start a new bar.
export class MidiRoll {
  constructor(historySeconds) {
    this.historySeconds = historySeconds;
    this.bars = [];
    this.open = new Map();
    this.lastRelease = new Map();
    this.bend = 0;
    this.nextPrune = 0;
  }

  add(note, time, attack) {
    const pitch = note + this.bend;
    const previous = this.lastRelease.get(note);
    const bar = {
      pitch, start: time, end: Infinity, attack,
      previousEnd: attack && previous?.pitch === pitch ? previous.end : -Infinity,
    };
    this.bars.push(bar);
    this.open.set(note, bar);
    if (time >= this.nextPrune) {
      const oldest = time - this.historySeconds;
      this.bars = this.bars.filter((entry) => entry.end >= oldest);
      this.nextPrune = time + 1;
    }
  }

  press(note, time) {
    this.release(note, time);
    this.add(note, time, true);
  }

  release(note, time) {
    const bar = this.open.get(note);
    if (!bar) return;
    bar.end = Math.max(bar.start, time);
    this.lastRelease.set(note, bar);
    this.open.delete(note);
  }

  setBend(bend, time) {
    if (bend === this.bend) return;
    this.bend = bend;
    for (const [note, bar] of this.open) {
      bar.end = Math.max(bar.start, time);
      this.add(note, bar.end, false);
    }
  }

  releaseAll(time) {
    for (const note of this.open.keys()) this.release(note, time);
  }
}

export function drawMidiBars(ctx, bars, { now, seconds, horizontal, timeSize, pitchSize, minPitch, pitchSpan, dpr }) {
  const oldest = now - seconds;
  const maxTimePixel = Math.round(timeSize * dpr);
  const timePixel = (time) => Math.round((time - oldest) * timeSize * dpr / seconds);
  const pitchPixel = (note) => Math.round(
    (horizontal ? minPitch + pitchSpan - note : note - minPitch) * pitchSize * dpr / pitchSpan,
  );
  if (maxTimePixel <= 0) return;
  ctx.fillStyle = "#77d36a";
  for (const bar of bars) {
    if (bar.end <= oldest || bar.start > now || bar.pitch < minPitch - 0.5 || bar.pitch > minPitch + pitchSpan + 0.5) continue;
    let start = Math.max(0, timePixel(bar.start));
    let end = Math.min(maxTimePixel, timePixel(Math.min(now, bar.end)));
    // A new strike at the same pixel gets a one-pixel break. A wheel move never does.
    if (bar.start >= oldest && start === timePixel(bar.previousEnd) && end > start + 1) start++;
    if (end <= start) {
      if (!bar.attack || !Number.isFinite(bar.end)) continue;
      start = Math.min(start, maxTimePixel - 1);
      end = start + 1;
    }
    const a = pitchPixel(bar.pitch + (horizontal ? 0.45 : -0.45));
    const b = pitchPixel(bar.pitch + (horizontal ? -0.45 : 0.45));
    const duration = (end - start) / dpr;
    const thickness = Math.max(1, b - a) / dpr;
    if (horizontal) ctx.fillRect(start / dpr, a / dpr, duration, thickness);
    else ctx.fillRect(a / dpr, start / dpr, thickness, duration);
  }
}
