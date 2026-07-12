import SignalsmithStretch from "./vendor/SignalsmithStretch.mjs";
import {
  clamp,
  detectPitch,
  frequencyToMidi,
  median,
  midiName,
} from "./pitch.js";

const MAX_VOICES = 8;
const PIANO_WIDTH = 64;
const HISTORY_SECONDS = 62;
const NOTE_RELEASE_SECONDS = 0.09;
const $ = (selector) => document.querySelector(selector);

const ui = {
  canvas: $("#roll"),
  pitchChip: $("#pitch-chip"),
  midiChip: $("#midi-chip"),
  engineChip: $("#engine-chip"),
  startButton: $("#start-button"),
  stopButton: $("#stop-button"),
  startOverlay: $("#start-overlay"),
  startOverlayButton: $("#start-overlay-button"),
  inputDevice: $("#input-device"),
  inputStatus: $("#input-status"),
  inputLevelFill: $("#input-level-fill"),
  outputLevelFill: $("#output-level-fill"),
  inputLevelText: $("#input-level-text"),
  outputLevelText: $("#output-level-text"),
  testToneButton: $("#test-tone-button"),
  rmsText: $("#rms-text"),
  stableText: $("#stable-text"),
  meter: $("#meter"),
  keyboard: $("#keyboard"),
  midiStatus: $("#midi-status"),
  formants: $("#formants"),
};

const controls = {
  blend: { input: $("#blend"), min: 0, max: 100, step: 1, value: 56, suffix: "%" },
  gain: { input: $("#gain"), min: 0, max: 24, step: 1, value: 6, suffix: " dB" },
  gate: { input: $("#gate"), min: 0.001, max: 0.04, step: 0.0005, value: 0.01, digits: 4 },
  stability: { input: $("#stability"), min: 0.2, max: 2, step: 0.05, value: 1, suffix: " st", digits: 2 },
  timeSpan: { input: $("#time-span"), min: 1, max: 60, step: 0.5, value: 12, suffix: " s", digits: 1 },
  pitchSpan: { input: $("#pitch-span"), min: 12, max: 96, step: 1, value: 48, suffix: " st" },
};

const canvasContext = ui.canvas.getContext("2d");
const history = [];
const detectorHistory = [];
const correctionHistory = [];
const pressedComputerKeys = new Map();
const heldNotes = new Set();
const sustainedNotes = new Set();
let sustainOn = false;
let pitchBend = 0;
let audio = null;
let voices = [];
let lastPitchRun = 0;
let frameHandle = 0;
let pianoDrag = null;

const pitchState = {
  rawMidi: -1,
  detectedMidi: -1,
  correctionMidi: -1,
  rms: 0,
  clarity: 0,
  stable: false,
  voiced: false,
  holdFrames: 0,
};

const view = {
  centerMidi: Number(localStorage.getItem("harmonizer.public.centerMidi")) || 60,
};

function controlValue(name) {
  return controls[name].value;
}

function formatControl(control) {
  const digits = control.digits ?? (Number.isInteger(control.step) ? 0 : 1);
  return `${control.value.toFixed(digits)}${control.suffix ?? ""}`;
}

function commitControl(name, rawValue, emit = true) {
  const control = controls[name];
  const numeric = Number(String(rawValue).replace(/[^0-9.+-]/g, ""));
  if (!Number.isFinite(numeric)) {
    control.input.value = formatControl(control);
    return;
  }
  const steps = Math.round((numeric - control.min) / control.step);
  control.value = clamp(control.min + steps * control.step, control.min, control.max);
  control.input.value = formatControl(control);
  control.input.setAttribute("aria-valuenow", String(control.value));
  try { localStorage.setItem(`harmonizer.public.v1.${name}`, String(control.value)); } catch {}
  if (emit) applyControls();
}

function bindDraggableNumber(name) {
  const control = controls[name];
  const storedText = localStorage.getItem(`harmonizer.public.v1.${name}`);
  const stored = storedText === null ? NaN : Number(storedText);
  if (Number.isFinite(stored)) control.value = clamp(stored, control.min, control.max);
  commitControl(name, control.value, false);

  let drag = null;
  control.input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, start: control.value, moved: false };
    control.input.setPointerCapture(event.pointerId);
  });
  control.input.addEventListener("pointermove", (event) => {
    if (!drag || !control.input.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientX - drag.x;
    if (Math.abs(delta) > 2) drag.moved = true;
    if (!drag.moved) return;
    const accelerated = event.shiftKey ? 5 : event.altKey ? 0.2 : 1;
    commitControl(name, drag.start + Math.round(delta / 5) * control.step * accelerated);
  });
  control.input.addEventListener("pointerup", (event) => {
    if (control.input.hasPointerCapture(event.pointerId)) control.input.releasePointerCapture(event.pointerId);
    if (drag?.moved) control.input.blur();
    drag = null;
  });
  control.input.addEventListener("focus", () => control.input.select());
  control.input.addEventListener("change", () => commitControl(name, control.input.value));
  control.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      commitControl(name, control.input.value);
      control.input.blur();
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      commitControl(name, control.value + (event.key === "ArrowUp" ? control.step : -control.step));
    }
  });
}

function setAudioParam(parameter, value, smoothing = 0.02) {
  if (!audio) return;
  parameter.cancelScheduledValues(audio.context.currentTime);
  parameter.setTargetAtTime(value, audio.context.currentTime, smoothing);
}

function applyControls() {
  if (!audio) return;
  const blend = controlValue("blend") / 100;
  setAudioParam(audio.dryGain.gain, 1 - blend);
  setAudioParam(audio.wetGain.gain, blend);
  setAudioParam(audio.inputGain.gain, 10 ** (controlValue("gain") / 20));
}

async function buildVoice(index) {
  const stretch = await SignalsmithStretch(audio.context, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
  });
  await stretch.configure({ blockMs: 48, intervalMs: 12, splitComputation: true });
  await stretch.start();
  const latency = await stretch.latency();
  const gain = audio.context.createGain();
  gain.gain.value = 0;
  const panner = audio.context.createStereoPanner();
  stretch.connect(gain).connect(panner).connect(audio.wetBus);
  audio.inputGain.connect(stretch);
  return {
    index,
    stretch,
    gain,
    panner,
    latency,
    note: null,
    stamp: 0,
    lastShift: NaN,
  };
}

async function enumerateInputs(selectedId = "") {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
  ui.inputDevice.replaceChildren();
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${index + 1}`;
    ui.inputDevice.append(option);
  });
  if (selectedId && devices.some((device) => device.deviceId === selectedId)) ui.inputDevice.value = selectedId;
  ui.inputStatus.textContent = devices.length ? "ready" : "none";
}

async function openMicrophone(deviceId = "") {
  if (audio?.stream) audio.stream.getTracks().forEach((track) => track.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const source = audio.context.createMediaStreamSource(stream);
  source.connect(audio.inputMeter);
  source.connect(audio.inputGain);
  audio.stream = stream;
  audio.source = source;
  await enumerateInputs(stream.getAudioTracks()[0]?.getSettings().deviceId || deviceId);
}

async function startAudio() {
  if (audio) {
    await audio.context.resume();
    ui.startOverlay.hidden = true;
    return;
  }
  ui.startOverlayButton.disabled = true;
  ui.startOverlayButton.textContent = "Starting...";
  ui.engineChip.textContent = "loading DSP";
  try {
    const context = new AudioContext({ latencyHint: "interactive" });
    const inputGain = context.createGain();
    const inputMeter = context.createAnalyser();
    inputMeter.fftSize = 2048;
    inputMeter.smoothingTimeConstant = 0;
    const dryDelay = context.createDelay(1);
    const dryGain = context.createGain();
    const wetBus = context.createGain();
    const wetGain = context.createGain();
    const master = context.createGain();
    master.gain.value = 0.78;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -5;
    limiter.knee.value = 4;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;
    const outputMeter = context.createAnalyser();
    outputMeter.fftSize = 512;
    inputGain.connect(dryDelay).connect(dryGain).connect(master);
    wetBus.connect(wetGain).connect(master);
    master.connect(limiter).connect(outputMeter).connect(context.destination);
    audio = {
      context,
      inputGain,
      inputMeter,
      inputSamples: new Float32Array(inputMeter.fftSize),
      inputMeterSamples: new Float32Array(inputMeter.fftSize),
      dryDelay,
      dryGain,
      wetBus,
      wetGain,
      master,
      limiter,
      outputMeter,
      outputSamples: new Float32Array(outputMeter.fftSize),
      stream: null,
      source: null,
    };
    await openMicrophone(ui.inputDevice.value);
    voices = await Promise.all(Array.from({ length: MAX_VOICES }, (_, index) => buildVoice(index)));
    const latency = Math.max(...voices.map((voice) => voice.latency));
    audio.dryDelay.delayTime.value = latency;
    applyControls();
    ui.engineChip.textContent = `Signalsmith ${Math.round(latency * 1000)} ms`;
    ui.engineChip.classList.add("good");
    ui.startOverlay.hidden = true;
    ui.startButton.hidden = true;
    ui.stopButton.hidden = false;
    await context.resume();
  } catch (error) {
    console.error(error);
    if (audio?.context) await audio.context.close().catch(() => {});
    audio = null;
    voices = [];
    ui.engineChip.textContent = "audio unavailable";
    ui.engineChip.classList.remove("good");
    ui.startOverlayButton.textContent = "Try again";
    ui.startOverlayButton.disabled = false;
    return;
  }
  ui.startOverlayButton.textContent = "Start audio";
  ui.startOverlayButton.disabled = false;
}

async function stopAudio() {
  if (!audio) return;
  heldNotes.clear();
  sustainedNotes.clear();
  audio.stream?.getTracks().forEach((track) => track.stop());
  await audio.context.close();
  audio = null;
  voices = [];
  ui.engineChip.textContent = "stopped";
  ui.engineChip.classList.remove("good");
  ui.startButton.hidden = false;
  ui.stopButton.hidden = true;
  ui.startOverlay.hidden = false;
  refreshKeyboard();
}

function activeVoices() {
  return voices.filter((voice) => voice.note !== null && (heldNotes.has(voice.note) || sustainedNotes.has(voice.note)));
}

function voiceForNote(note) {
  const existing = voices.find((voice) => voice.note === note);
  if (existing) return existing;
  const free = voices.find((voice) => voice.note === null);
  if (free) return free;
  return voices.reduce((oldest, voice) => voice.stamp < oldest.stamp ? voice : oldest, voices[0]);
}

function updateVoiceLevels() {
  if (!audio) return;
  const active = activeVoices();
  const level = pitchState.voiced && active.length ? 1 / Math.sqrt(active.length) : 0;
  for (const voice of voices) {
    const shouldSound = active.includes(voice);
    setAudioParam(voice.gain.gain, shouldSound ? level : 0, shouldSound ? 0.008 : NOTE_RELEASE_SECONDS / 3);
  }
}

function noteOn(note, velocity = 1) {
  if (!Number.isFinite(note) || note < 0 || note > 127) return;
  heldNotes.add(note);
  sustainedNotes.delete(note);
  if (audio && voices.length) {
    const voice = voiceForNote(note);
    voice.note = note;
    voice.stamp = performance.now();
    voice.gain.gain.value = Math.max(voice.gain.gain.value, 0.001 * velocity);
    const spread = clamp((note - 48) / 24, 0, 1);
    const side = note % 2 === 0 ? -1 : 1;
    voice.panner.pan.setTargetAtTime(side * spread, audio.context.currentTime, 0.02);
    updateVoiceShifts(true);
  }
  refreshKeyboard();
}

function releaseVoiceNote(note) {
  const voice = voices.find((candidate) => candidate.note === note);
  if (!voice || !audio) return;
  setAudioParam(voice.gain.gain, 0, NOTE_RELEASE_SECONDS / 3);
  window.setTimeout(() => {
    if (voice.note === note && !heldNotes.has(note) && !sustainedNotes.has(note)) {
      voice.note = null;
      voice.lastShift = NaN;
    }
  }, NOTE_RELEASE_SECONDS * 1200);
}

function noteOff(note) {
  heldNotes.delete(note);
  if (sustainOn) sustainedNotes.add(note);
  else {
    sustainedNotes.delete(note);
    releaseVoiceNote(note);
  }
  updateVoiceLevels();
  refreshKeyboard();
}

function setSustain(enabled) {
  sustainOn = enabled;
  if (!enabled) {
    for (const note of sustainedNotes) {
      if (!heldNotes.has(note)) releaseVoiceNote(note);
    }
    sustainedNotes.clear();
  }
  refreshKeyboard();
}

function updateVoiceShifts(force = false) {
  if (!audio || !pitchState.voiced || !Number.isFinite(pitchState.correctionMidi)) {
    updateVoiceLevels();
    return;
  }
  const formantCompensation = ui.formants.checked;
  for (const voice of activeVoices()) {
    const semitones = clamp(voice.note + pitchBend - pitchState.correctionMidi, -24, 24);
    if (!force && Math.abs(semitones - voice.lastShift) < 0.035) continue;
    voice.lastShift = semitones;
    voice.stretch.schedule({
      output: audio.context.currentTime + voice.latency,
      semitones,
      formantCompensation,
      formantBaseHz: 0,
    });
  }
  updateVoiceLevels();
}

function updatePitch(now) {
  if (!audio || now - lastPitchRun < 38) return;
  lastPitchRun = now;
  audio.inputMeter.getFloatTimeDomainData(audio.inputSamples);
  const result = detectPitch(audio.inputSamples, audio.context.sampleRate, {
    gate: controlValue("gate") * (pitchState.voiced ? 0.55 : 1),
  });
  pitchState.rms = result.rms;
  pitchState.clarity = result.clarity;
  const rawMidi = result.frequency > 0 ? frequencyToMidi(result.frequency) : NaN;
  pitchState.rawMidi = Number.isFinite(rawMidi) ? rawMidi : -1;

  correctionHistory.push(rawMidi);
  if (correctionHistory.length > 3) correctionHistory.shift();
  const correction = median(correctionHistory);
  pitchState.correctionMidi = Number.isFinite(correction) ? correction : -1;

  detectorHistory.push(rawMidi);
  if (detectorHistory.length > 9) detectorHistory.shift();
  const detected = median(detectorHistory);
  const valid = detectorHistory.filter(Number.isFinite);
  const agree = Number.isFinite(detected)
    ? valid.filter((value) => Math.abs(value - detected) < controlValue("stability")).length
    : 0;
  const stable = valid.length >= 3 && agree * 2 > valid.length && result.rms >= controlValue("gate") * 0.55;
  if (stable) {
    pitchState.detectedMidi = detected;
    pitchState.stable = true;
    pitchState.voiced = true;
    pitchState.holdFrames = 8;
  } else if (pitchState.voiced && pitchState.holdFrames > 0 && result.rms >= controlValue("gate") * 0.55) {
    pitchState.stable = false;
    pitchState.holdFrames -= 1;
  } else {
    pitchState.detectedMidi = -1;
    pitchState.stable = false;
    pitchState.voiced = false;
    pitchState.holdFrames = 0;
  }

  history.push({
    receivedAt: now / 1000,
    rawMidi: pitchState.rawMidi,
    detectedMidi: pitchState.detectedMidi,
    stable: pitchState.stable,
    voiced: pitchState.voiced,
    notes: [...heldNotes, ...sustainedNotes],
  });
  const oldest = now / 1000 - HISTORY_SECONDS;
  while (history.length && history[0].receivedAt < oldest) history.shift();
  updateVoiceShifts();
}

function meterDb(samples) {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

function updateMeters() {
  if (!audio) {
    ui.inputLevelFill.style.width = "0%";
    ui.outputLevelFill.style.width = "0%";
    ui.inputLevelText.textContent = "-inf";
    ui.outputLevelText.textContent = "-inf";
    return;
  }
  audio.inputMeter.getFloatTimeDomainData(audio.inputMeterSamples);
  audio.outputMeter.getFloatTimeDomainData(audio.outputSamples);
  const inputDb = meterDb(audio.inputMeterSamples);
  const outputDb = meterDb(audio.outputSamples);
  const width = (db) => `${clamp((db + 60) / 60, 0, 1) * 100}%`;
  ui.inputLevelFill.style.width = width(inputDb);
  ui.outputLevelFill.style.width = width(outputDb);
  ui.inputLevelText.textContent = Number.isFinite(inputDb) ? `${inputDb.toFixed(0)}` : "-inf";
  ui.outputLevelText.textContent = Number.isFinite(outputDb) ? `${outputDb.toFixed(0)}` : "-inf";
}

function visiblePitchMin() {
  return view.centerMidi - controlValue("pitchSpan") / 2;
}

function visiblePitchMax() {
  return view.centerMidi + controlValue("pitchSpan") / 2;
}

function noteY(note, height) {
  return (visiblePitchMax() - note) * height / controlValue("pitchSpan");
}

function fitCanvas() {
  const rect = ui.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (ui.canvas.width !== width || ui.canvas.height !== height) {
    ui.canvas.width = width;
    ui.canvas.height = height;
  }
  canvasContext.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function timeX(timestamp, now, width) {
  const rollWidth = width - PIANO_WIDTH;
  return PIANO_WIDTH + rollWidth * (timestamp - (now - controlValue("timeSpan"))) / controlValue("timeSpan");
}

function drawGrid(width, height, now) {
  const pitchMin = visiblePitchMin();
  const pitchMax = visiblePitchMax();
  for (let note = Math.ceil(pitchMin); note <= Math.floor(pitchMax); note += 1) {
    const octave = note % 12 === 0;
    if (!octave && controlValue("pitchSpan") > 24) continue;
    const y = noteY(note, height);
    canvasContext.strokeStyle = octave ? "rgba(242,240,232,0.15)" : "rgba(242,240,232,0.045)";
    canvasContext.beginPath();
    canvasContext.moveTo(PIANO_WIDTH, y);
    canvasContext.lineTo(width, y);
    canvasContext.stroke();
  }
  const seconds = controlValue("timeSpan");
  const roughStep = seconds / Math.max(2, Math.floor((width - PIANO_WIDTH) / 90));
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / power;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
  for (let age = 0; age <= seconds + step * 0.25; age += step) {
    const x = timeX(now - age, now, width);
    canvasContext.strokeStyle = age === 0 ? "rgba(242,240,232,0.14)" : "rgba(242,240,232,0.07)";
    canvasContext.beginPath();
    canvasContext.moveTo(x, 0);
    canvasContext.lineTo(x, height);
    canvasContext.stroke();
  }
}

function drawMidi(frames, now, width, height) {
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const nextTime = index + 1 < frames.length ? frames[index + 1].receivedAt : now;
    const x = clamp(timeX(frame.receivedAt, now, width), PIANO_WIDTH, width);
    const x2 = clamp(timeX(nextTime, now, width), PIANO_WIDTH, width);
    for (const note of frame.notes) {
      if (note < visiblePitchMin() || note >= visiblePitchMax()) continue;
      canvasContext.fillStyle = "#77d36a";
      canvasContext.fillRect(x, noteY(note + 1, height), Math.max(1, x2 - x), Math.max(2, noteY(note, height) - noteY(note + 1, height)));
    }
  }
}

function drawContour(frames, now, width, height, value, style) {
  let previous = null;
  for (const frame of frames) {
    const midi = value(frame);
    if (!Number.isFinite(midi) || midi <= 0) {
      previous = null;
      continue;
    }
    const point = { x: timeX(frame.receivedAt, now, width), y: noteY(midi, height), time: frame.receivedAt };
    const currentStyle = style(frame);
    if (previous && point.time - previous.time < 0.16) {
      canvasContext.strokeStyle = currentStyle.color;
      canvasContext.lineWidth = currentStyle.width;
      canvasContext.beginPath();
      canvasContext.moveTo(previous.x, previous.y);
      canvasContext.lineTo(point.x, point.y);
      canvasContext.stroke();
    }
    previous = point;
  }
  canvasContext.lineWidth = 1;
}

function drawPiano(height) {
  canvasContext.fillStyle = "#d8d4c8";
  canvasContext.fillRect(0, 0, PIANO_WIDTH, height);
  for (let note = Math.floor(visiblePitchMin()); note < Math.ceil(visiblePitchMax()); note += 1) {
    const top = clamp(noteY(note + 1, height), 0, height);
    const bottom = clamp(noteY(note, height), 0, height);
    const black = [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12);
    canvasContext.fillStyle = black ? "#31332d" : "#d8d4c8";
    canvasContext.fillRect(0, top, PIANO_WIDTH - 1, Math.max(1, bottom - top));
    canvasContext.strokeStyle = "rgba(0,0,0,0.24)";
    canvasContext.beginPath();
    canvasContext.moveTo(0, top);
    canvasContext.lineTo(PIANO_WIDTH, top);
    canvasContext.stroke();
    if (note % 12 === 0 && bottom - top >= 4) {
      canvasContext.fillStyle = "#151613";
      canvasContext.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      canvasContext.textAlign = "right";
      canvasContext.textBaseline = "middle";
      canvasContext.fillText(midiName(note), PIANO_WIDTH - 7, clamp((top + bottom) / 2, 7, height - 7));
    }
  }
}

function draw(nowMilliseconds) {
  frameHandle = requestAnimationFrame(draw);
  updatePitch(nowMilliseconds);
  updateMeters();
  fitCanvas();
  const rect = ui.canvas.getBoundingClientRect();
  const now = nowMilliseconds / 1000;
  canvasContext.fillStyle = "#12130f";
  canvasContext.fillRect(0, 0, rect.width, rect.height);
  drawGrid(rect.width, rect.height, now);
  const windowStart = now - controlValue("timeSpan");
  const start = Math.max(0, history.findIndex((frame) => frame.receivedAt >= windowStart) - 1);
  const frames = history.slice(start);
  drawMidi(frames, now, rect.width, rect.height);
  drawContour(frames, now, rect.width, rect.height, (frame) => frame.rawMidi, () => ({ color: "rgba(245,194,87,0.54)", width: 1 }));
  drawContour(
    frames,
    now,
    rect.width,
    rect.height,
    (frame) => frame.voiced ? frame.detectedMidi : NaN,
    (frame) => ({ color: frame.stable ? "#22d3c5" : "rgba(34,211,197,0.55)", width: frame.stable ? 2 : 1 }),
  );
  drawPiano(rect.height);
  ui.pitchChip.textContent = pitchState.voiced ? `${midiName(pitchState.detectedMidi)} ${pitchState.detectedMidi.toFixed(1)}` : "pitch --";
  ui.pitchChip.classList.toggle("good", pitchState.voiced);
  ui.midiChip.textContent = `notes ${new Set([...heldNotes, ...sustainedNotes]).size}`;
  ui.rmsText.textContent = `rms ${pitchState.rms.toFixed(4)}`;
  ui.stableText.textContent = pitchState.stable ? "stable" : pitchState.voiced ? "held" : "unvoiced";
  ui.meter.textContent = [
    `engine ${audio ? "browser WASM" : "stopped"}`,
    `pitch ${pitchState.voiced ? `${midiName(pitchState.detectedMidi)} ${pitchState.detectedMidi.toFixed(2)}` : "--"}`,
    `raw ${pitchState.rawMidi > 0 ? `${midiName(pitchState.rawMidi)} ${pitchState.rawMidi.toFixed(2)}` : "--"}`,
    `clarity ${Math.round(pitchState.clarity * 100)}%`,
    `voices ${activeVoices().length}/${MAX_VOICES}`,
  ].join("\n");
}

function buildKeyboard() {
  for (let note = 48; note <= 72; note += 1) {
    const black = [1, 3, 6, 8, 10].includes(note % 12);
    const key = document.createElement("button");
    key.type = "button";
    key.className = `piano-key ${black ? "black" : "white"}`;
    key.dataset.note = String(note);
    key.setAttribute("aria-label", midiName(note));
    key.title = midiName(note);
    key.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      key.setPointerCapture(event.pointerId);
      noteOn(note);
    });
    const release = () => noteOff(note);
    key.addEventListener("pointerup", release);
    key.addEventListener("pointercancel", release);
    ui.keyboard.append(key);
  }
}

function refreshKeyboard() {
  const sounding = new Set([...heldNotes, ...sustainedNotes]);
  ui.keyboard.querySelectorAll(".piano-key").forEach((key) => {
    key.classList.toggle("active", sounding.has(Number(key.dataset.note)));
  });
}

const computerKeyNotes = new Map([
  ["a", 60], ["w", 61], ["s", 62], ["e", 63], ["d", 64], ["f", 65],
  ["t", 66], ["g", 67], ["y", 68], ["h", 69], ["u", 70], ["j", 71], ["k", 72],
]);

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    ui.midiStatus.textContent = "unavailable";
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const attach = () => {
      let count = 0;
      for (const input of access.inputs.values()) {
        input.onmidimessage = (event) => {
          const [status, data1, data2] = event.data;
          const command = status & 0xf0;
          if (command === 0x90 && data2 > 0) noteOn(data1, data2 / 127);
          else if (command === 0x80 || (command === 0x90 && data2 === 0)) noteOff(data1);
          else if (command === 0xb0 && data1 === 64) setSustain(data2 >= 64);
          else if (command === 0xe0) pitchBend = ((((data2 << 7) | data1) - 8192) / 8192) * 2;
          updateVoiceShifts(true);
        };
        count += 1;
      }
      ui.midiStatus.textContent = count ? `${count} connected` : "no devices";
    };
    attach();
    access.onstatechange = attach;
  } catch {
    ui.midiStatus.textContent = "permission denied";
  }
}

window.addEventListener("keydown", (event) => {
  if (event.repeat || isTypingTarget(event.target)) return;
  const note = computerKeyNotes.get(event.key.toLowerCase());
  if (note === undefined) return;
  event.preventDefault();
  pressedComputerKeys.set(event.code, note);
  noteOn(note);
});

window.addEventListener("keyup", (event) => {
  const note = pressedComputerKeys.get(event.code);
  if (note === undefined) return;
  pressedComputerKeys.delete(event.code);
  noteOff(note);
});

ui.canvas.addEventListener("pointerdown", (event) => {
  if (event.clientX - ui.canvas.getBoundingClientRect().left <= PIANO_WIDTH) return;
  pianoDrag = { y: event.clientY, center: view.centerMidi };
  ui.canvas.setPointerCapture(event.pointerId);
  ui.canvas.classList.add("panning");
});
ui.canvas.addEventListener("pointermove", (event) => {
  if (!pianoDrag || !ui.canvas.hasPointerCapture(event.pointerId)) return;
  const semitonePixels = ui.canvas.getBoundingClientRect().height / controlValue("pitchSpan");
  view.centerMidi = clamp(pianoDrag.center + (event.clientY - pianoDrag.y) / semitonePixels, 24, 108);
  localStorage.setItem("harmonizer.public.centerMidi", String(view.centerMidi));
});
ui.canvas.addEventListener("pointerup", (event) => {
  if (ui.canvas.hasPointerCapture(event.pointerId)) ui.canvas.releasePointerCapture(event.pointerId);
  pianoDrag = null;
  ui.canvas.classList.remove("panning");
});

ui.startOverlayButton.addEventListener("click", startAudio);
ui.startButton.addEventListener("click", startAudio);
ui.stopButton.addEventListener("click", stopAudio);
ui.inputDevice.addEventListener("change", async () => {
  if (!audio) return;
  ui.inputDevice.disabled = true;
  ui.inputStatus.textContent = "switching";
  try { await openMicrophone(ui.inputDevice.value); }
  catch { ui.inputStatus.textContent = "error"; }
  finally { ui.inputDevice.disabled = false; }
});
ui.formants.addEventListener("change", () => updateVoiceShifts(true));
ui.testToneButton.addEventListener("click", () => {
  if (!audio) return;
  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  oscillator.frequency.value = 440;
  gain.gain.setValueAtTime(0.08, audio.context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.context.currentTime + 0.35);
  oscillator.connect(gain).connect(audio.context.destination);
  oscillator.start();
  oscillator.stop(audio.context.currentTime + 0.36);
});

Object.keys(controls).forEach(bindDraggableNumber);
buildKeyboard();
initMidi();
enumerateInputs().catch(() => { ui.inputStatus.textContent = "permission needed"; });
frameHandle = requestAnimationFrame(draw);

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(frameHandle);
  audio?.stream?.getTracks().forEach((track) => track.stop());
});
