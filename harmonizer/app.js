import SignalsmithStretch from "./vendor/SignalsmithStretch.js?v=20260712-2";
import {
  clamp,
  midiName,
} from "./pitch.js?v=20260726-2";

const SIGNALSMITH_VOICES = 8;
const RUBBERBAND_VOICES = 4;
const PIANO_WIDTH = 64;
const PIANO_HEIGHT = 72;
const HISTORY_SECONDS = 62;
const NOTE_RELEASE_SECONDS = 0.09;
const testParameters = new URLSearchParams(window.location.search);
const SYNTHETIC_INPUT = testParameters.get("testInput") === "sine";
const SYNTHETIC_NOTE = Number(testParameters.get("testNote"));
const embeddedWorkletUrls = globalThis.__HARMONIZER_WORKLET_URLS__ || {};
const $ = (selector) => document.querySelector(selector);

const ui = {
  canvas: $("#roll"),
  pitchChip: $("#pitch-chip"),
  midiChip: $("#midi-chip"),
  engineChip: $("#engine-chip"),
  downloadButton: $("#download-button"),
  downloadOverlay: $("#download-overlay"),
  downloadCloseButton: $("#download-close-button"),
  startButton: $("#start-button"),
  stopButton: $("#stop-button"),
  startOverlay: $("#start-overlay"),
  startOverlayButton: $("#start-overlay-button"),
  startDownloadButton: $("#start-download-button"),
  inputDevice: $("#input-device"),
  inputStatus: $("#input-status"),
  outputDevice: $("#output-device"),
  outputStatus: $("#output-status"),
  engineSelect: $("#engine-select"),
  engineStatus: $("#engine-status"),
  midiInput: $("#midi-input"),
  inputLevelFill: $("#input-level-fill"),
  outputLevelFill: $("#output-level-fill"),
  inputLevelText: $("#input-level-text"),
  outputLevelText: $("#output-level-text"),
  testToneButton: $("#test-tone-button"),
  rmsText: $("#rms-text"),
  stableText: $("#stable-text"),
  meter: $("#meter"),
  midiStatus: $("#midi-status"),
  formants: $("#formants"),
  keyboardOctave: $("#keyboard-octave"),
  orientationGroup: $("#orientation-group"),
  horizontalFlow: $("#horizontal-flow"),
  verticalFlow: $("#vertical-flow"),
};

const controls = {
  blend: { input: $("#blend"), min: 0, max: 100, step: 1, value: 100, suffix: "%" },
  gain: { input: $("#gain"), min: 0, max: 24, step: 1, value: 6, suffix: " dB" },
  gate: { input: $("#gate"), min: 0.001, max: 0.04, step: 0.0005, value: 0.01, digits: 4 },
  stability: { input: $("#stability"), min: 0.2, max: 2, step: 0.05, value: 1, suffix: " st", digits: 2 },
  keyboardOctave: { input: $("#keyboard-octave"), min: 0, max: 5, step: 1, value: 3 },
  timeSpan: { input: $("#time-span"), min: 1, max: 60, step: 0.5, value: 12, suffix: " s", digits: 1 },
  pitchSpan: { input: $("#pitch-span"), min: 12, max: 96, step: 1, value: 48, suffix: " st" },
};

const canvasContext = ui.canvas.getContext("2d");
const history = [];
const renderDurations = [];
const pressedComputerKeys = new Map();
const heldNotes = new Set();
const sustainedNotes = new Set();
let sustainOn = false;
let pitchBend = 0;
let midiAccess = null;
let audio = null;
let voices = [];
let frameHandle = 0;
let pianoDrag = null;
let engineRestarting = false;

const pitchState = {
  rawMidi: -1,
  detectedMidi: -1,
  correctionMidi: -1,
  rms: 0,
  clarity: 0,
  stable: false,
  voiced: false,
  energetic: false,
  unvoiced: false,
  sibilance: 0,
  renderAverageMs: 0,
  renderMaxMs: 0,
  overruns: 0,
  quantumMs: 0,
};

const view = {
  centerMidi: Number(localStorage.getItem("harmonizer.public.centerMidi")) || 60,
  orientation: storedSetting("orientation", "horizontal") === "vertical" ? "vertical" : "horizontal",
};

function storedSetting(key, fallback = "") {
  try { return localStorage.getItem(`harmonizer.public.v1.${key}`) ?? fallback; }
  catch { return fallback; }
}

function storeSetting(key, value) {
  try { localStorage.setItem(`harmonizer.public.v1.${key}`, String(value)); }
  catch {}
}

function migrateStoredSettings() {
  try {
    const migrationKey = "harmonizer.public.v2.fullWetDefault";
    if (localStorage.getItem(migrationKey)) return;
    const blendKey = "harmonizer.public.v1.blend";
    if (localStorage.getItem(blendKey) === "56") localStorage.setItem(blendKey, "100");
    localStorage.setItem(migrationKey, "1");
  } catch {}
}

migrateStoredSettings();

function controlValue(name) {
  return controls[name].value;
}

function formatControl(control) {
  const digits = control.digits ?? (Number.isInteger(control.step) ? 0 : 1);
  return `${control.value.toFixed(digits)}${control.suffix ?? ""}`;
}

function commitControl(name, rawValue, emit = true) {
  const control = controls[name];
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    control.input.textContent = formatControl(control);
    return;
  }
  const steps = Math.round((numeric - control.min) / control.step);
  control.value = clamp(control.min + steps * control.step, control.min, control.max);
  control.input.dataset.value = String(control.value);
  control.input.textContent = formatControl(control);
  control.input.setAttribute("aria-valuenow", String(control.value));
  if (name === "keyboardOctave") rebuildComputerKeyboardMap(control.value);
  storeSetting(name, control.value);
  if (emit) applyControls();
}

function bindDraggableNumber(name) {
  const control = controls[name];
  const storedText = storedSetting(name, "");
  const stored = storedText === "" ? NaN : Number(storedText);
  if (Number.isFinite(stored)) control.value = clamp(stored, control.min, control.max);
  commitControl(name, control.value, false);

  let drag = null;
  control.input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { x: event.clientX, y: event.clientY, start: control.value };
    control.input.setPointerCapture(event.pointerId);
  });
  control.input.addEventListener("pointermove", (event) => {
    if (!drag || !control.input.hasPointerCapture(event.pointerId)) return;
    const axisDelta = ((event.clientX - drag.x) - (event.clientY - drag.y)) / Math.SQRT2;
    const accelerated = event.shiftKey ? 5 : event.altKey ? 0.2 : 1;
    commitControl(name, drag.start + Math.round(axisDelta / 5 * accelerated) * control.step);
  });
  control.input.addEventListener("pointerup", (event) => {
    if (control.input.hasPointerCapture(event.pointerId)) control.input.releasePointerCapture(event.pointerId);
    drag = null;
  });
  control.input.addEventListener("pointercancel", () => { drag = null; });
  control.input.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : -1;
      commitControl(name, control.value + direction * control.step);
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
  syncEngineControls();
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
  const latency = await stretch.latency();
  const gain = audio.context.createGain();
  gain.gain.value = 0;
  const panner = audio.context.createStereoPanner();
  stretch.connect(gain).connect(panner);
  return {
    index,
    stretch,
    gain,
    panner,
    latency,
    note: null,
    stamp: 0,
    lastShift: NaN,
    connected: false,
    velocity: 1,
  };
}

function currentEngineKey() {
  return ui.engineSelect?.value === "signalsmith" ? "signalsmith" : "rubberband";
}

function voiceCapacity() {
  return audio?.engine?.maxVoices
    ?? (currentEngineKey() === "signalsmith" ? SIGNALSMITH_VOICES : RUBBERBAND_VOICES);
}

function syncEngineControls() {
  if (!audio?.engine) return;
  const message = {
    type: "controls",
    gate: controlValue("gate"),
    stability: controlValue("stability"),
    pitchBend,
    formants: ui.formants.checked,
  };
  audio.engine.controlNode?.port.postMessage(message);
}

function recordRenderDuration(value) {
  if (!Number.isFinite(value)) return;
  renderDurations.push(value);
  if (renderDurations.length > 256) renderDurations.shift();
}

function renderPercentile(percentile) {
  if (!renderDurations.length) return 0;
  const sorted = [...renderDurations].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))];
}

function handlePitchTelemetry(message) {
  if (!message || message.type !== "pitch") return;
  pitchState.rawMidi = Number.isFinite(message.rawMidi) ? message.rawMidi : -1;
  pitchState.detectedMidi = Number.isFinite(message.detectedMidi) ? message.detectedMidi : -1;
  pitchState.correctionMidi = Number.isFinite(message.correctionMidi)
    ? message.correctionMidi
    : -1;
  pitchState.rms = Number(message.rms) || 0;
  pitchState.clarity = Number(message.clarity) || 0;
  pitchState.stable = Boolean(message.stable);
  pitchState.voiced = Boolean(message.voiced);
  pitchState.energetic = Boolean(message.energetic);
  pitchState.unvoiced = Boolean(message.unvoiced);
  pitchState.sibilance = Number(message.sibilance) || 0;
  pitchState.renderAverageMs = Number(message.renderAverageMs) || 0;
  pitchState.renderMaxMs = Number(message.renderMaxMs) || 0;
  pitchState.overruns = Number(message.overruns) || 0;
  pitchState.quantumMs = Number(message.quantumMs) || 0;
  recordRenderDuration(message.renderMaxMs);

  const receivedNow = performance.now() / 1000;
  const receivedAt = audio && Number.isFinite(message.audioTime)
    ? receivedNow + message.audioTime - audio.context.currentTime
    : receivedNow;
  history.push({
    receivedAt,
    rawMidi: pitchState.rawMidi,
    detectedMidi: pitchState.detectedMidi,
    correctionMidi: pitchState.correctionMidi,
    stable: pitchState.stable,
    voiced: pitchState.voiced,
    pitchBend,
    notes: [...heldNotes, ...sustainedNotes],
  });
  const oldest = receivedNow - HISTORY_SECONDS;
  while (history.length && history[0].receivedAt < oldest) history.shift();
  if (audio?.engine?.key === "signalsmith") updateVoiceShifts();
  else updateVoiceLevels();
}

async function buildSignalsmithEngine() {
  await audio.context.audioWorklet.addModule(
    embeddedWorkletUrls.pitch || "./pitch-worklet.js?v=20260726-2",
  );
  const pitchNode = new AudioWorkletNode(audio.context, "harmonizer-pitch-control", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
    processorOptions: {
      gate: controlValue("gate"),
      stability: controlValue("stability"),
    },
  });
  pitchNode.port.onmessage = (event) => handlePitchTelemetry(event.data);
  audio.inputGain.connect(pitchNode);
  pitchNode.connect(audio.dryDelay);
  audio.pitchNode = pitchNode;
  voices = await Promise.all(
    Array.from({ length: SIGNALSMITH_VOICES }, (_, index) => buildVoice(index)),
  );
  const latency = Math.max(...voices.map((voice) => voice.latency));
  return {
    key: "signalsmith",
    name: "Signalsmith",
    latency,
    maxVoices: SIGNALSMITH_VOICES,
    controlNode: pitchNode,
  };
}

async function buildRubberBandEngine() {
  await audio.context.audioWorklet.addModule(
    embeddedWorkletUrls.rubberband || "./rubberband-worklet.js?v=20260726-2",
  );
  const node = new AudioWorkletNode(audio.context, "rubberband-harmonizer", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 1,
    channelCountMode: "explicit",
  });
  const ready = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Rubber Band worklet timed out")),
      12000,
    );
    node.port.onmessage = (event) => {
      if (event.data?.type === "ready") {
        window.clearTimeout(timeout);
        resolve(event.data);
      } else if (event.data?.type === "error") {
        window.clearTimeout(timeout);
        reject(new Error(event.data.message));
      } else {
        handlePitchTelemetry(event.data);
      }
    };
  });
  audio.inputGain.connect(audio.dryDelay);
  audio.inputGain.connect(node);
  node.connect(audio.wetBus);
  const details = await ready;
  voices = Array.from({ length: details.maxVoices }, (_, index) => ({
    index,
    note: null,
    stamp: 0,
    velocity: 1,
  }));
  return {
    key: "rubberband",
    name: "Rubber Band Live",
    latency: details.latencySamples / details.sampleRate,
    maxVoices: details.maxVoices,
    blockSize: details.blockSize,
    startDelay: details.startDelay,
    controlNode: node,
  };
}

async function enumerateAudioDevices(
  selectedInputId = storedSetting("audioInput"),
  selectedOutputId = storedSetting("audioOutput"),
) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const outputs = devices.filter((device) => device.kind === "audiooutput");
  ui.inputDevice.replaceChildren();
  inputs.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${index + 1}`;
    ui.inputDevice.append(option);
  });
  if (selectedInputId && inputs.some((device) => device.deviceId === selectedInputId)) {
    ui.inputDevice.value = selectedInputId;
  }
  if (!storedSetting("audioInput") && ui.inputDevice.value) storeSetting("audioInput", ui.inputDevice.value);
  ui.inputStatus.textContent = inputs.length ? "ready" : "none";

  ui.outputDevice.replaceChildren();
  if (!outputs.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "System default";
    ui.outputDevice.append(option);
  }
  outputs.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || (device.deviceId === "default" ? "System default" : `Output ${index + 1}`);
    ui.outputDevice.append(option);
  });
  if (outputs.some((device) => device.deviceId === selectedOutputId)) {
    ui.outputDevice.value = selectedOutputId;
  }
  if (!storedSetting("audioOutput") && ui.outputDevice.value) storeSetting("audioOutput", ui.outputDevice.value);
  ui.outputStatus.textContent = typeof AudioContext.prototype.setSinkId === "function" ? "ready" : "system default";
}

async function applyOutputDevice(deviceId = "") {
  storeSetting("audioOutput", deviceId);
  if (!audio) return;
  if (typeof audio.context.setSinkId !== "function") {
    ui.outputStatus.textContent = "system default";
    return;
  }
  ui.outputStatus.textContent = "switching";
  try {
    await audio.context.setSinkId(deviceId);
    ui.outputStatus.textContent = "ready";
  } catch {
    ui.outputStatus.textContent = "unavailable";
  }
}

async function openMicrophone(deviceId = "") {
  if (audio?.stream) audio.stream.getTracks().forEach((track) => track.stop());
  if (SYNTHETIC_INPUT) {
    audio.syntheticOscillator?.stop();
    const oscillator = audio.context.createOscillator();
    const gain = audio.context.createGain();
    oscillator.frequency.value = 220;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(audio.inputMeter);
    gain.connect(audio.inputGain);
    oscillator.start();
    audio.syntheticOscillator = oscillator;
    audio.source = gain;
    audio.stream = null;
    ui.inputStatus.textContent = "test 220 Hz";
    return;
  }
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
  const activeDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId || deviceId;
  storeSetting("audioInput", activeDeviceId);
  await enumerateAudioDevices(activeDeviceId, ui.outputDevice.value);
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
  renderDurations.length = 0;
  pitchState.renderAverageMs = 0;
  pitchState.renderMaxMs = 0;
  pitchState.overruns = 0;
  pitchState.quantumMs = 0;
  try {
    const contextOptions = { latencyHint: "interactive" };
    if (currentEngineKey() === "rubberband") contextOptions.sampleRate = 44100;
    const context = new AudioContext(contextOptions);
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
    dryDelay.connect(dryGain).connect(master);
    wetBus.connect(wetGain).connect(master);
    master.connect(limiter).connect(outputMeter).connect(context.destination);
    audio = {
      context,
      inputGain,
      inputMeter,
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
      syntheticOscillator: null,
      pitchNode: null,
      engine: null,
    };
    await applyOutputDevice(ui.outputDevice.value);
    await openMicrophone(ui.inputDevice.value);
    let engine;
    if (currentEngineKey() === "rubberband") {
      try {
        engine = await buildRubberBandEngine();
      } catch (error) {
        console.warn("Rubber Band WASM unavailable; using Signalsmith", error);
        ui.engineSelect.value = "signalsmith";
        storeSetting("engine", "signalsmith");
        ui.engineStatus.textContent = "fallback";
        engine = await buildSignalsmithEngine();
      }
    } else {
      engine = await buildSignalsmithEngine();
    }
    audio.engine = engine;
    audio.dryDelay.delayTime.value = engine.latency;
    applyControls();
    if (SYNTHETIC_INPUT && Number.isFinite(SYNTHETIC_NOTE)) {
      noteOn(clamp(Math.round(SYNTHETIC_NOTE), 0, 127));
    }
    ui.engineChip.textContent = `${engine.name} ${Math.round(engine.latency * 1000)} ms`;
    ui.engineChip.classList.add("good");
    ui.engineStatus.textContent = `${engine.maxVoices} voices`;
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

async function stopAudio({ showOverlay = true } = {}) {
  if (!audio) return;
  heldNotes.clear();
  sustainedNotes.clear();
  audio.stream?.getTracks().forEach((track) => track.stop());
  try { audio.syntheticOscillator?.stop(); } catch {}
  audio.engine?.controlNode?.port.postMessage({ type: "destroy" });
  await audio.context.close();
  audio = null;
  voices = [];
  ui.engineChip.textContent = "stopped";
  ui.engineChip.classList.remove("good");
  ui.engineStatus.textContent = "stopped";
  ui.startButton.hidden = false;
  ui.stopButton.hidden = true;
  ui.startOverlay.hidden = !showOverlay;
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

function isRubberBandEngine() {
  return audio?.engine?.key === "rubberband";
}

function sendRubberBandVoice(voice, gate = true) {
  if (!isRubberBandEngine() || !voice) return;
  audio.engine.controlNode.port.postMessage({
    type: "voice",
    index: voice.index,
    note: voice.note ?? -1,
    gate,
    velocity: voice.velocity ?? 1,
  });
}

function connectSignalsmithVoice(voice) {
  if (!audio?.pitchNode || !voice?.stretch || voice.connected) return;
  audio.pitchNode.connect(voice.stretch);
  voice.panner.connect(audio.wetBus);
  voice.connected = true;
  voice.stretch.start({
    output: audio.context.currentTime + voice.latency,
    semitones: Number.isFinite(voice.lastShift) ? voice.lastShift : 0,
    formantCompensation: ui.formants.checked,
    formantBaseHz: 0,
  }).catch(() => {});
}

function disconnectSignalsmithVoice(voice) {
  if (!audio?.pitchNode || !voice?.stretch || !voice.connected) return;
  try { audio.pitchNode.disconnect(voice.stretch); } catch {}
  try { voice.panner.disconnect(audio.wetBus); } catch {}
  voice.connected = false;
}

function updateVoiceLevels() {
  if (!audio) return;
  if (isRubberBandEngine()) return;
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
    voice.velocity = velocity;
    voice.stamp = performance.now();
    if (isRubberBandEngine()) {
      sendRubberBandVoice(voice, true);
    } else {
      connectSignalsmithVoice(voice);
      voice.gain.gain.value = Math.max(voice.gain.gain.value, 0.001 * velocity);
      const spread = clamp((note - 48) / 24, 0, 1);
      const side = note % 2 === 0 ? -1 : 1;
      voice.panner.pan.setTargetAtTime(side * spread, audio.context.currentTime, 0.02);
    }
    updateVoiceShifts(true);
  }
}

function releaseVoiceNote(note) {
  const voice = voices.find((candidate) => candidate.note === note);
  if (!voice || !audio) return;
  if (isRubberBandEngine()) sendRubberBandVoice(voice, false);
  else {
    setAudioParam(voice.gain.gain, 0, NOTE_RELEASE_SECONDS / 3);
    voice.stretch.stop(audio.context.currentTime + NOTE_RELEASE_SECONDS).catch(() => {});
  }
  window.setTimeout(() => {
    if (voice.note === note && !heldNotes.has(note) && !sustainedNotes.has(note)) {
      voice.note = null;
      voice.lastShift = NaN;
      if (isRubberBandEngine()) sendRubberBandVoice(voice, false);
      else disconnectSignalsmithVoice(voice);
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
}

function setSustain(enabled) {
  sustainOn = enabled;
  if (!enabled) {
    for (const note of sustainedNotes) {
      if (!heldNotes.has(note)) releaseVoiceNote(note);
    }
    sustainedNotes.clear();
  }
}

function updateVoiceShifts(force = false) {
  if (isRubberBandEngine()) {
    syncEngineControls();
    return;
  }
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

function noteX(note, width) {
  return (note - visiblePitchMin()) * width / controlValue("pitchSpan");
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
  const rollWidth = Math.max(1, width - PIANO_WIDTH);
  return rollWidth * (timestamp - (now - controlValue("timeSpan"))) / controlValue("timeSpan");
}

function timeY(timestamp, now, height) {
  const rollHeight = Math.max(1, height - PIANO_HEIGHT);
  return rollHeight * (timestamp - (now - controlValue("timeSpan"))) / controlValue("timeSpan");
}

function drawGrid(width, height, now) {
  const horizontal = view.orientation === "horizontal";
  const rollWidth = horizontal ? Math.max(1, width - PIANO_WIDTH) : width;
  const rollHeight = horizontal ? height : Math.max(1, height - PIANO_HEIGHT);
  const pitchMin = visiblePitchMin();
  const pitchMax = visiblePitchMax();
  for (let note = Math.ceil(pitchMin); note <= Math.floor(pitchMax); note += 1) {
    const octave = note % 12 === 0;
    if (!octave && controlValue("pitchSpan") > 24) continue;
    canvasContext.strokeStyle = octave ? "rgba(242,240,232,0.15)" : "rgba(242,240,232,0.045)";
    canvasContext.beginPath();
    if (horizontal) {
      const y = noteY(note, height);
      canvasContext.moveTo(0, y);
      canvasContext.lineTo(rollWidth, y);
    } else {
      const x = noteX(note, width);
      canvasContext.moveTo(x, 0);
      canvasContext.lineTo(x, rollHeight);
    }
    canvasContext.stroke();
  }
  const seconds = controlValue("timeSpan");
  const timePixels = horizontal ? rollWidth : rollHeight;
  const roughStep = seconds / Math.max(2, Math.floor(timePixels / 90));
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / power;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
  for (let age = 0; age <= seconds + step * 0.25; age += step) {
    canvasContext.strokeStyle = age === 0 ? "rgba(242,240,232,0.14)" : "rgba(242,240,232,0.07)";
    canvasContext.beginPath();
    if (horizontal) {
      const x = timeX(now - age, now, width);
      canvasContext.moveTo(x, 0);
      canvasContext.lineTo(x, rollHeight);
    } else {
      const y = timeY(now - age, now, height);
      canvasContext.moveTo(0, y);
      canvasContext.lineTo(rollWidth, y);
    }
    canvasContext.stroke();
  }
}

function drawMidi(frames, now, width, height) {
  const horizontal = view.orientation === "horizontal";
  const rollWidth = horizontal ? Math.max(1, width - PIANO_WIDTH) : width;
  const rollHeight = horizontal ? height : Math.max(1, height - PIANO_HEIGHT);
  canvasContext.save();
  canvasContext.beginPath();
  canvasContext.rect(0, 0, rollWidth, rollHeight);
  canvasContext.clip();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const nextTime = index + 1 < frames.length ? frames[index + 1].receivedAt : now;
    for (const note of frame.notes || []) {
      const bentNote = Number(note) + Number(frame.pitchBend || 0);
      if (bentNote < visiblePitchMin() - 1 || bentNote >= visiblePitchMax() + 1) continue;
      canvasContext.fillStyle = "#77d36a";
      if (horizontal) {
        const x = clamp(timeX(frame.receivedAt, now, width), 0, rollWidth);
        const x2 = clamp(timeX(nextTime, now, width), 0, rollWidth);
        const top = noteY(bentNote + 0.45, height);
        const bottom = noteY(bentNote - 0.45, height);
        canvasContext.fillRect(x, top, Math.max(1, x2 - x), Math.max(2, bottom - top));
      } else {
        const y = clamp(timeY(frame.receivedAt, now, height), 0, rollHeight);
        const y2 = clamp(timeY(nextTime, now, height), 0, rollHeight);
        const left = noteX(bentNote - 0.45, width);
        const right = noteX(bentNote + 0.45, width);
        canvasContext.fillRect(left, y, Math.max(2, right - left), Math.max(1, y2 - y));
      }
    }
  }
  canvasContext.restore();
}

function drawContour(frames, now, width, height, value, style) {
  const horizontal = view.orientation === "horizontal";
  const rollWidth = horizontal ? Math.max(1, width - PIANO_WIDTH) : width;
  const rollHeight = horizontal ? height : Math.max(1, height - PIANO_HEIGHT);
  canvasContext.save();
  canvasContext.beginPath();
  canvasContext.rect(0, 0, rollWidth, rollHeight);
  canvasContext.clip();
  let previous = null;
  for (const frame of frames) {
    const midi = value(frame);
    if (!Number.isFinite(midi) || midi <= 0) {
      previous = null;
      continue;
    }
    const point = horizontal
      ? { x: timeX(frame.receivedAt, now, width), y: noteY(midi, height), time: frame.receivedAt }
      : { x: noteX(midi, width), y: timeY(frame.receivedAt, now, height), time: frame.receivedAt };
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
  canvasContext.restore();
}

function drawPiano(width, height) {
  const horizontal = view.orientation === "horizontal";
  const rollWidth = horizontal ? Math.max(1, width - PIANO_WIDTH) : width;
  const rollHeight = horizontal ? height : Math.max(1, height - PIANO_HEIGHT);
  const sounding = new Set([...heldNotes, ...sustainedNotes].map((note) => Math.round(note + pitchBend)));
  canvasContext.fillStyle = "#d8d4c8";
  if (horizontal) canvasContext.fillRect(rollWidth, 0, PIANO_WIDTH, height);
  else canvasContext.fillRect(0, rollHeight, width, PIANO_HEIGHT);
  for (let note = Math.floor(visiblePitchMin()); note < Math.ceil(visiblePitchMax()); note += 1) {
    const black = [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12);
    const active = sounding.has(note);
    const keyLabel = computerKeyboardLabels.get(note);
    canvasContext.fillStyle = active ? "#76a7ff" : black ? "#31332d" : "#d8d4c8";
    canvasContext.strokeStyle = "rgba(0,0,0,0.24)";
    if (horizontal) {
      const top = clamp(noteY(note + 1, height), 0, height);
      const bottom = clamp(noteY(note, height), 0, height);
      canvasContext.fillRect(rollWidth + 1, top, PIANO_WIDTH - 1, Math.max(1, bottom - top));
      canvasContext.beginPath();
      canvasContext.moveTo(rollWidth, top);
      canvasContext.lineTo(width, top);
      canvasContext.stroke();
      if (note % 12 === 0 && bottom - top >= 4) {
        canvasContext.fillStyle = "#151613";
        canvasContext.font = "600 10px ui-sans-serif, system-ui, sans-serif";
        canvasContext.textAlign = "left";
        canvasContext.textBaseline = "middle";
        canvasContext.fillText(midiName(note), rollWidth + 7, clamp((top + bottom) / 2, 7, height - 7));
      }
      if (keyLabel && bottom - top >= 6) {
        canvasContext.fillStyle = active || black ? "#f2f0e8" : "#151613";
        canvasContext.font = `700 ${clamp(Math.floor((bottom - top) * 0.62), 6, 10)}px ui-sans-serif, system-ui, sans-serif`;
        canvasContext.textAlign = "right";
        canvasContext.textBaseline = "middle";
        canvasContext.fillText(keyLabel, width - 5, clamp((top + bottom) / 2, 5, height - 5));
      }
    } else {
      const left = clamp(noteX(note, width), 0, width);
      const right = clamp(noteX(note + 1, width), 0, width);
      canvasContext.fillRect(left, rollHeight + 1, Math.max(1, right - left), PIANO_HEIGHT - 1);
      canvasContext.beginPath();
      canvasContext.moveTo(left, rollHeight);
      canvasContext.lineTo(left, height);
      canvasContext.stroke();
      if (note % 12 === 0 && right - left >= 13) {
        canvasContext.fillStyle = "#151613";
        canvasContext.font = "600 10px ui-sans-serif, system-ui, sans-serif";
        canvasContext.textAlign = "center";
        canvasContext.textBaseline = "bottom";
        canvasContext.fillText(midiName(note), (left + right) / 2, height - 6);
      }
      if (keyLabel && right - left >= 4) {
        canvasContext.fillStyle = active || black ? "#f2f0e8" : "#151613";
        canvasContext.font = `700 ${clamp(Math.floor((right - left) * 0.58), 5, 10)}px ui-sans-serif, system-ui, sans-serif`;
        canvasContext.textAlign = "center";
        canvasContext.textBaseline = "top";
        canvasContext.fillText(keyLabel, clamp((left + right) / 2, 3, width - 3), rollHeight + 6);
      }
    }
  }
  canvasContext.fillStyle = "rgba(0,0,0,0.48)";
  if (horizontal) canvasContext.fillRect(rollWidth, 0, 1, height);
  else canvasContext.fillRect(0, rollHeight, width, 1);
}

function draw(nowMilliseconds) {
  frameHandle = requestAnimationFrame(draw);
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
  drawPiano(rect.width, rect.height);
  ui.pitchChip.textContent = pitchState.voiced ? `${midiName(pitchState.detectedMidi)} ${pitchState.detectedMidi.toFixed(1)}` : "pitch --";
  ui.pitchChip.classList.toggle("good", pitchState.voiced);
  ui.midiChip.textContent = `notes ${new Set([...heldNotes, ...sustainedNotes]).size}`;
  ui.rmsText.textContent = `rms ${pitchState.rms.toFixed(4)}`;
  ui.stableText.textContent = pitchState.stable
    ? "stable"
    : pitchState.unvoiced
      ? "unvoiced hold"
      : pitchState.voiced
        ? "held"
        : "unvoiced";
  const baseLatencyMs = audio ? Number(audio.context.baseLatency || 0) * 1000 : 0;
  const outputLatencyMs = audio ? Number(audio.context.outputLatency || 0) * 1000 : 0;
  const renderP99 = renderPercentile(0.99);
  const renderHeadroom = pitchState.quantumMs > 0
    ? Math.max(0, 100 * (1 - renderP99 / pitchState.quantumMs))
    : 0;
  ui.meter.textContent = [
    `engine ${audio?.engine?.name ?? "stopped"}`,
    `DSP path ${audio?.engine ? `${(audio.engine.latency * 1000).toFixed(1)} ms` : "--"}`,
    `browser I/O ${baseLatencyMs.toFixed(1)} + ${outputLatencyMs.toFixed(1)} ms`,
    `pitch ${pitchState.voiced ? `${midiName(pitchState.detectedMidi)} ${pitchState.detectedMidi.toFixed(2)}` : "--"}`,
    `raw ${pitchState.rawMidi > 0 ? `${midiName(pitchState.rawMidi)} ${pitchState.rawMidi.toFixed(2)}` : "--"}`,
    `clarity ${Math.round(pitchState.clarity * 100)}%`,
    `voices ${activeVoices().length}/${voiceCapacity()}`,
    `render avg ${pitchState.renderAverageMs.toFixed(2)} ms max ${pitchState.renderMaxMs.toFixed(2)} ms`,
    `render p99 ${renderP99.toFixed(2)} / ${pitchState.quantumMs.toFixed(2)} ms`,
    `headroom ${renderHeadroom.toFixed(0)}% overruns ${pitchState.overruns}`,
    `unvoiced ${pitchState.unvoiced ? "hold" : "off"} sibilance ${pitchState.sibilance.toFixed(2)}`,
  ].join("\n");
}

const computerKeyboardLayout = [
  ["ShiftLeft", 0, "\u21e7"],
  ["KeyA", 1, "A"], ["KeyZ", 2, "Z"], ["KeyS", 3, "S"], ["KeyX", 4, "X"], ["KeyD", 5, "D"],
  ["KeyC", 6, "C"], ["KeyV", 7, "V"], ["KeyG", 8, "G"], ["KeyB", 9, "B"], ["KeyH", 10, "H"],
  ["KeyN", 11, "N"], ["KeyM", 12, "M"], ["KeyK", 13, "K"], ["Comma", 14, ","], ["KeyL", 15, "L"],
  ["Period", 16, "."], ["Semicolon", 17, ";"], ["Slash", 18, "/"],
  ["Tab", 19, "\u21b9"],
  ["Digit1", 20, "1"], ["KeyQ", 21, "Q"], ["Digit2", 22, "2"], ["KeyW", 23, "W"], ["KeyE", 24, "E"],
  ["Digit4", 25, "4"], ["KeyR", 26, "R"], ["Digit5", 27, "5"], ["KeyT", 28, "T"], ["Digit6", 29, "6"],
  ["KeyY", 30, "Y"], ["KeyU", 31, "U"], ["Digit8", 32, "8"], ["KeyI", 33, "I"], ["Digit9", 34, "9"],
  ["KeyO", 35, "O"], ["KeyP", 36, "P"], ["Minus", 37, "-"], ["BracketLeft", 38, "["],
  ["Equal", 39, "="], ["BracketRight", 40, "]"], ["Backspace", 41, "\u232b"], ["Backslash", 42, "\\"],
];
let computerKeyNotes = new Map();
let computerKeyboardLabels = new Map();

function releaseComputerKeys() {
  for (const note of pressedComputerKeys.values()) noteOff(note);
  pressedComputerKeys.clear();
}

function rebuildComputerKeyboardMap(octave = 3) {
  if (computerKeyNotes.size > 0) releaseComputerKeys();
  const startNote = (Math.round(octave) + 1) * 12 + 5;
  computerKeyNotes = new Map();
  computerKeyboardLabels = new Map();
  for (const [code, semitone, label] of computerKeyboardLayout) {
    const note = startNote + semitone;
    if (note < 0 || note > 127) continue;
    computerKeyNotes.set(code, note);
    computerKeyboardLabels.set(note, label);
  }
}

function isTypingTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, select, button, textarea, [contenteditable='true']"));
}

function handleMidiMessage(event) {
  const [status, data1, data2] = event.data;
  const command = status & 0xf0;
  if (command === 0x90 && data2 > 0) noteOn(data1, data2 / 127);
  else if (command === 0x80 || (command === 0x90 && data2 === 0)) noteOff(data1);
  else if (command === 0xb0 && data1 === 64) setSustain(data2 >= 64);
  else if (command === 0xe0) pitchBend = ((((data2 << 7) | data1) - 8192) / 8192) * 2;
  updateVoiceShifts(true);
}

function attachMidiInputs() {
  if (!midiAccess) return;
  const inputs = [...midiAccess.inputs.values()];
  const savedId = storedSetting("midiInput", "all");
  const savedName = storedSetting("midiInputName");
  ui.midiInput.replaceChildren();
  for (const [value, label] of [["all", "All MIDI devices"], ["none", "None"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    ui.midiInput.append(option);
  }
  for (const input of inputs) {
    const option = document.createElement("option");
    option.value = input.id;
    option.textContent = input.name || input.manufacturer || "MIDI input";
    ui.midiInput.append(option);
  }
  const savedOption = [...ui.midiInput.options].find((option) => option.value === savedId)
    || [...ui.midiInput.options].find((option) => option.textContent === savedName);
  ui.midiInput.value = savedOption ? savedOption.value : "all";

  let count = 0;
  for (const input of inputs) {
    const enabled = ui.midiInput.value === "all" || ui.midiInput.value === input.id;
    input.onmidimessage = enabled ? handleMidiMessage : null;
    if (enabled) count += 1;
  }
  ui.midiStatus.textContent = ui.midiInput.value === "none" ? "off" : count ? `${count} active` : "no devices";
}

async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    ui.midiStatus.textContent = "unavailable";
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    attachMidiInputs();
    midiAccess.onstatechange = attachMidiInputs;
  } catch {
    ui.midiStatus.textContent = "permission denied";
  }
}

window.addEventListener("keydown", (event) => {
  if (event.repeat || isTypingTarget(event.target)) return;
  const note = computerKeyNotes.get(event.code);
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
window.addEventListener("blur", releaseComputerKeys);
window.addEventListener("pagehide", releaseComputerKeys);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseComputerKeys();
});

function pointerInPiano(event) {
  const rect = ui.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return view.orientation === "horizontal" ? x >= rect.width - PIANO_WIDTH : y >= rect.height - PIANO_HEIGHT;
}

function updatePianoCursor(event) {
  ui.canvas.style.cursor = pointerInPiano(event)
    ? view.orientation === "horizontal" ? "ns-resize" : "ew-resize"
    : "default";
}

ui.canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !pointerInPiano(event)) return;
  event.preventDefault();
  pianoDrag = { y: event.clientY, center: view.centerMidi };
  pianoDrag.x = event.clientX;
  ui.canvas.setPointerCapture(event.pointerId);
  ui.canvas.classList.add("panning");
  ui.canvas.style.cursor = view.orientation === "horizontal" ? "ns-resize" : "ew-resize";
});
ui.canvas.addEventListener("pointermove", (event) => {
  if (!pianoDrag || !ui.canvas.hasPointerCapture(event.pointerId)) {
    updatePianoCursor(event);
    return;
  }
  const rect = ui.canvas.getBoundingClientRect();
  const semitonePixels = (view.orientation === "horizontal" ? rect.height : rect.width) / controlValue("pitchSpan");
  const delta = view.orientation === "horizontal"
    ? (event.clientY - pianoDrag.y) / semitonePixels
    : -(event.clientX - pianoDrag.x) / semitonePixels;
  const halfSpan = controlValue("pitchSpan") / 2;
  view.centerMidi = clamp(pianoDrag.center + delta, 12 + halfSpan, 120 - halfSpan);
  localStorage.setItem("harmonizer.public.centerMidi", String(view.centerMidi));
});
ui.canvas.addEventListener("pointerup", (event) => {
  if (ui.canvas.hasPointerCapture(event.pointerId)) ui.canvas.releasePointerCapture(event.pointerId);
  pianoDrag = null;
  ui.canvas.classList.remove("panning");
  updatePianoCursor(event);
});
ui.canvas.addEventListener("pointercancel", () => {
  pianoDrag = null;
  ui.canvas.classList.remove("panning");
  ui.canvas.style.cursor = "default";
});
ui.canvas.addEventListener("pointerleave", () => { if (!pianoDrag) ui.canvas.style.cursor = "default"; });

ui.startOverlayButton.addEventListener("click", startAudio);
ui.startButton.addEventListener("click", startAudio);
ui.stopButton.addEventListener("click", stopAudio);
let downloadOpener = ui.downloadButton;
function openDownloadDialog(event) {
  downloadOpener = event.currentTarget;
  ui.downloadOverlay.hidden = false;
  ui.downloadCloseButton.focus();
}
ui.downloadButton.addEventListener("click", openDownloadDialog);
ui.startDownloadButton.addEventListener("click", openDownloadDialog);
ui.downloadCloseButton.addEventListener("click", () => {
  ui.downloadOverlay.hidden = true;
  downloadOpener.focus();
});
ui.downloadOverlay.addEventListener("pointerdown", (event) => {
  if (event.target === ui.downloadOverlay) ui.downloadCloseButton.click();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !ui.downloadOverlay.hidden) ui.downloadCloseButton.click();
});
ui.inputDevice.addEventListener("change", async () => {
  storeSetting("audioInput", ui.inputDevice.value);
  if (!audio) return;
  ui.inputDevice.disabled = true;
  ui.inputStatus.textContent = "switching";
  try { await openMicrophone(ui.inputDevice.value); }
  catch { ui.inputStatus.textContent = "error"; }
  finally { ui.inputDevice.disabled = false; }
});
ui.outputDevice.addEventListener("change", async () => {
  await applyOutputDevice(ui.outputDevice.value);
});
const savedEngine = storedSetting("engine", "rubberband");
ui.engineSelect.value = [...ui.engineSelect.options].some(
  (option) => option.value === savedEngine,
) ? savedEngine : "rubberband";
ui.engineSelect.addEventListener("change", async () => {
  storeSetting("engine", ui.engineSelect.value);
  if (!audio || engineRestarting) return;
  engineRestarting = true;
  ui.engineSelect.disabled = true;
  ui.engineStatus.textContent = "switching";
  try {
    await stopAudio({ showOverlay: false });
    await startAudio();
  } finally {
    ui.engineSelect.disabled = false;
    engineRestarting = false;
  }
});
ui.midiInput.addEventListener("change", () => {
  storeSetting("midiInput", ui.midiInput.value);
  if (ui.midiInput.selectedOptions[0]) storeSetting("midiInputName", ui.midiInput.selectedOptions[0].textContent);
  attachMidiInputs();
});
ui.formants.checked = storedSetting("formants", "true") !== "false";
ui.formants.addEventListener("change", () => {
  storeSetting("formants", ui.formants.checked);
  updateVoiceShifts(true);
});
function syncPillThumb(groupEl, activeButton) {
  if (!groupEl || !activeButton) return;
  const thumb = groupEl.querySelector(".pill-thumb");
  if (!thumb) return;
  const inset = 4;
  const left = activeButton.offsetLeft - inset;
  const top = activeButton.offsetTop - inset;
  const thumbRadius = activeButton.offsetHeight / 2;
  thumb.style.width = `${activeButton.offsetWidth}px`;
  thumb.style.height = `${activeButton.offsetHeight}px`;
  thumb.style.borderRadius = `${thumbRadius}px`;
  thumb.style.transform = `translate(${left}px, ${top}px)`;
  groupEl.style.borderRadius = `${thumbRadius + inset}px`;
}

function animatePillGroup(groupEl, updateFn) {
  groupEl.classList.add("is-animating");
  updateFn();
  window.setTimeout(() => groupEl.classList.remove("is-animating"), 220);
}

function setOrientation(orientation, persist = true, animate = true) {
  const update = () => {
    view.orientation = orientation === "vertical" ? "vertical" : "horizontal";
    const vertical = view.orientation === "vertical";
    ui.horizontalFlow.classList.toggle("is-active", !vertical);
    ui.verticalFlow.classList.toggle("is-active", vertical);
    ui.horizontalFlow.setAttribute("aria-selected", String(!vertical));
    ui.verticalFlow.setAttribute("aria-selected", String(vertical));
    syncPillThumb(ui.orientationGroup, vertical ? ui.verticalFlow : ui.horizontalFlow);
  };
  if (animate) animatePillGroup(ui.orientationGroup, update);
  else update();
  if (persist) storeSetting("orientation", view.orientation);
  ui.canvas.title = view.orientation === "horizontal"
    ? "Drag the right piano vertically to change the visible pitch range."
    : "Drag the bottom piano horizontally to change the visible pitch range.";
  ui.canvas.style.cursor = "default";
}
ui.horizontalFlow.addEventListener("click", () => setOrientation("horizontal"));
ui.verticalFlow.addEventListener("click", () => setOrientation("vertical"));
setOrientation(view.orientation, false, false);
window.addEventListener("resize", () => {
  syncPillThumb(ui.orientationGroup, view.orientation === "vertical" ? ui.verticalFlow : ui.horizontalFlow);
});
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
const initialMidiInput = storedSetting("midiInput", "all");
if ([...ui.midiInput.options].some((option) => option.value === initialMidiInput)) {
  ui.midiInput.value = initialMidiInput;
}
enumerateAudioDevices().catch(() => { ui.inputStatus.textContent = "permission needed"; });
initMidi();
if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    enumerateAudioDevices(ui.inputDevice.value, ui.outputDevice.value).catch(() => {});
  });
}
frameHandle = requestAnimationFrame(draw);

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(frameHandle);
  audio?.stream?.getTracks().forEach((track) => track.stop());
});
