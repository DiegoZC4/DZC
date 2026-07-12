# Vocal Harmonizer — Architecture & Notes

## Goal
Recreate Jacob Collier's harmonizer using free/open libraries.
Mono mic in → pitch detection + MIDI-controlled pitch shifting → stereo out.

## Libraries
| Library | Purpose |
|---------|---------|
| **PortAudio** | Low-latency audio I/O (wraps CoreAudio on macOS) |
| **Rubber Band** (LiveShifter) | Real-time formant-preserving pitch shift |
| **aubio** (yinfft) | Live pitch detection of input voice |
| **Web MIDI** | Browser keyboard input forwarded to the native server |
| **RtMidi** | MIDI keyboard input for the legacy terminal-only build |

## Build (macOS, Homebrew)
```bash
brew install portaudio rubberband aubio rtmidi
cd /Users/diego/Desktop/Music/harmonizer
make harmonizer_web
```

## Canonical Browser-Controlled Native App

`harmonizer_web` is the canonical live application. Despite the name, the
browser handles only controls, MIDI forwarding, and visualization. The native
C++ process owns separate PortAudio input/output streams, aubio pitch tracking, 16 Rubber Band
LiveShifters, formant preservation, envelopes, panning, capture, and mixing.

```bash
cd /Users/diego/Desktop/Music/harmonizer
make harmonizer_web
./harmonizer_web --port 8794
```

Then open:

```text
http://127.0.0.1:8794/
```

The active DSP lives in `harmonizer_rubberband_engine.hpp`. It uses
`RubberBandLiveShifter` with `OptionFormantPreserved | OptionWindowShort` and
locks each shifted voice to its held MIDI pitch. A fast three-frame median drives
the inverse correction ratio every 512 samples so input vibrato is removed;
one additional hop aligns that control with Rubber Band's buffered audio, and
1.25x deviation compensation offsets the shifter's internal ratio smoothing.
A small, clamped one-block flutter compensator suppresses the doubled-rate
ripple created by fast ratio changes without reacting to genuine note jumps.
The slower nine-frame median remains separate for the displayed contour and
voiced-state gate. The server reports the active
backend and measured DSP latency through `/api/state`; the browser diagnostics
show both values. A lock-free stereo ring joins the USB-mic input stream to the
selected output stream, avoiding fragile cross-device CoreAudio duplex units.
The Output menu switches the native PortAudio playback stream between
available stereo devices without restarting the server; audio never enters the
browser. The selected output is saved in `.harmonizer_output_device` and reused
after automatic rebuilds or later launches. A preferred native input can be
pinned by device name in `.harmonizer_input_device`; this machine uses
`Samson G-Track Pro`, with the current macOS default used only while that USB
device is unavailable. `test output` sends a one-second
440 Hz tone through the same PortAudio stream while bypassing mic gain, pitch
detection, MIDI, Rubber Band, and Blend.

## Computer Keyboard

The browser can play harmony notes without a MIDI device. It maps physical key
positions, so the layout remains piano-shaped even if the operating-system
keyboard layout changes:

| Row | White notes | Black notes |
|---|---|---|
| F3-B4 | `Left Shift Z X C V B N M , . /` | `A S D G H K L ;` |
| C5-B6 | `Tab Q W E R T Y U I O P [ ] Backslash` | `1 2 4 5 6 8 9 - = Delete` |

Mapped keydown/keyup events use the same native MIDI-note endpoint as Web MIDI,
support chords, ignore key repeat, and release every held note when the window
loses focus.

## Rehearsal Mac App

Build the self-contained Apple Silicon app and transfer ZIP with:

```bash
make app-macos
```

This writes `dist/Harmonizer.app` and `dist/Harmonizer-macOS-arm64.zip`. The packaged
backend statically links PortAudio, aubio, Rubber Band, and libsamplerate, so the
destination Mac does not need Homebrew. On launch it stores preferences, logs,
and captures in `~/Library/Application Support/Harmonizer`, starts the native
server, and opens the browser GUI. Select the plugged-in microphone and playback
device in the GUI. The rehearsal build is ad-hoc signed and ARM64-only.

For a public one-click release, publish the source and ZIP together under a
GPL-compatible project license: [aubio is GPL-3.0-or-later](https://aubio.org/)
and [Rubber Band is GPL-2.0-or-later](https://breakfastquay.com/rubberband/license.html).
Build separate ARM64 and Intel artifacts (or a universal binary), then sign with
an Apple Developer ID and submit the ZIP/DMG for
[notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
There is no Tauri project in this repository; Tauri can later wrap this same C++
backend as an [external sidecar](https://v2.tauri.app/develop/sidecar/), but it is
not required for the first public release.

The older targets remain as references:

```bash
make harmonizer        # terminal/RtMidi Rubber Band prototype
make harmonizer_world  # legacy SDL/additive-vocoder experiment
```

## Fast Launch / Reload Loop

When launched from DevHub, `scripts/run_harmonizer_web.sh` keeps a small
supervisor running. It uses macOS file-system events, not a polling loop. Edits
to `harmonizer_web.cpp`, `harmonizer_rubberband_engine.hpp`, `web/index.html`,
or the `Makefile` trigger a rebuild and server restart automatically. After C++
edits, wait for the DevHub log to show the relaunch, then refresh the page.

The web target has no SDL2 window. It serves `web/index.html`, streams live
pitch/MIDI state over `/events`, accepts slider changes at `/api/control`, and
reports readiness at `/health`.

The browser roll draws smoothed/held pitch in cyan and raw pre-stability pitch
in amber. If the status says `holding`, a short voiced-release window is
bridging a dropped aubio frame so the wet harmony does not stutter. If the status
says `below gate`, PortAudio is receiving mic signal but the current RMS is
still below the Gate slider, so lower the gate or raise the input level before
debugging the pitch algorithm itself. The Blend slider is a constant-amplitude
wet/dry crossfade: wet is `blend`, dry is `1 - blend`, so the derived gains sum
to 1. At `100% wet`, hearing no dry voice is therefore expected. Monitor gain is
a separate post-analysis preamp applied equally to the dry and Rubber Band paths;
the `+18 dB` default matches the measured difference between the live mic and the
audible output-test reference without changing the wet/dry ratio. The side panel
shows the active PortAudio route, live input/output peak meters, and callback
xrun counts. If the input meter moves but the output meter does not, inspect the
blend, MIDI notes, Gate, and voiced state. If both meters move but nothing is
audible, choose the physical output jack being monitored and check its system
or hardware volume.

## Offline Pitch Detection Testing

The live mic loop is useful for feel, but it is a rough way to debug pitch
detection. Use the offline analyzer against known singing fixtures first:

```bash
cd /Users/diego/Desktop/Music/harmonizer
make pitch_analyzer
./pitch_analyzer \
  fixtures/vocadito/Audio/vocadito_1.wav \
  fixtures/vocadito/Annotations/F0/vocadito_1_f0.csv \
  --csv fixtures/pitch_reports/vocadito_1.csv
```

Run a small fixture suite:

```bash
make test-pitch
```

The analyzer defaults to the same RMS pitch gate now used by the live builds
(`0.01`). To sweep the main pitch-stability knobs:

```bash
GATE_RMS=0.015 make test-pitch
STABLE_WINDOW=0.4 make test-pitch
```

To turn the diagnostic suite into a pass/fail gate:

```bash
STRICT=1 make test-pitch
```

The fixture set is `Vocadito`: 40 short solo, monophonic singing excerpts with
frame-level F0 annotations. It lives in `fixtures/vocadito`; see
`fixtures/README.md` for source, license, and refresh commands.

To add your own singing sample, normalize it first:

```bash
ffmpeg -i input.ext -ac 1 -ar 44100 -sample_fmt s16 fixtures/custom/my_voice.wav
./pitch_analyzer fixtures/custom/my_voice.wav --csv fixtures/pitch_reports/my_voice.csv
```

## Diagnostic Capture (live takes)

When a live take sounds bad, hit **record** in the browser GUI (or
`curl 'http://127.0.0.1:8794/api/capture?action=start'`), sing with MIDI as
usual, then hit **stop**. Up to 120 s lands in `captures/cap_<stamp>/`:

- `mic.wav` — raw dry mic (mono float32; feed straight into `pitch_analyzer`)
- `output.wav` — the processed stereo output you actually heard
- `frames.csv` — per-11.6 ms engine pitch state: `time,rms,raw_hz,folded_hz,median_hz,smoothed_midi,correction_midi,stable,voiced`
- `midi.csv` — timestamped note on/off events
- `meta.json` — devices and control settings at stop time

Note the rough timestamp of anything that sounded wrong. The capture replays
deterministically: `mic.wav` + `midi.csv` reproduce the take, `output.wav`
shows what the engine did to it, and `frames.csv` says what the engine
believed at that moment. Sustain-pedal CC is not captured.

Replay a capture offline through the exact live engine (same per-sample code
path) after changing the DSP — no re-singing needed:

```bash
./harmonizer_web --render captures/cap_<stamp>   # writes render.wav next to mic.wav
```

It restores the mix/gate/stability settings from `meta.json`; edit that file
(e.g. `"mix":1.0` for wet-only) to render variants.

## Features (v2 rewrite)
- [x] 16-voice polyphonic harmonizer (up from 4)
- [x] Stereo output with M/S-style panning (low=center, high=wide)
- [x] Per-voice attack/release envelope (MIDI-gated, 5ms/80ms)
- [x] MIDI sustain pedal (CC 64)
- [x] MIDI pitch bend (±2 semitones)
- [x] Flat MIDI pitch locking with stabilized input-pitch compensation
- [x] Voice stealing (release → oldest priority)
- [x] Soft clipping (tanh) to prevent output overload
- [x] Decoupled pitch detection and RubberBand block sizes

## Quality vs. Original (honest assessment)

The original used **Antares Harmony Engine** (commercial) in Reaper with custom scripting.

| Scenario | Our quality vs Antares |
|----------|----------------------|
| Small intervals (3rds, 5ths) | ~85% — RubberBand formant preservation is solid |
| Octave shifts | ~65% — artifacts become noticeable |
| Bass (2+ octaves down) | ~50% — Antares excels at fundamental reinforcement |
| Fast passages | ~70% — latency + pitch tracking limits agility |
| Overall "choir" feel | ~75% — very usable, clearly not Antares |

### Where we lose
- **Low end**: Antares generates strong fundamentals even for huge downward shifts. RubberBand thins out.
- **Latency**: Rubber Band 4 currently reports a 512-sample block and 2142-sample start delay. Including the native block pipeline and 256-frame cross-device bridge prime, the DSP path is about 66.0 ms before audio-device latency. Bloomberg noted latency was their biggest struggle too.
- **Artifact quality**: Antares' proprietary algorithm handles transients and formants more gracefully.

### Where we're competitive
- **High harmony voices**: RubberBand with formant preservation sounds very natural for upward shifts.
- **Responsiveness**: Custom envelope + voice allocation gives tight MIDI feel.
- **Flexibility**: 16 voices, sustain, pitch bend, stereo panning — all customizable.

## Future improvements (if needed)
- **WORLD vocoder** instead of RubberBand — better voice-specific quality, used in singing synthesis
- **TD-PSOLA** for lower latency on small shifts
- **Sub-harmonic synthesis** to boost bass fundamentals (like Antares does)
- **ML pitch detection** (CREPE) for more stable tracking
- **JUCE port** for GUI, plugin format (VST/AU), better buffer management
- **Per-voice EQ** (Bloomberg had custom EQ per voice)
- **Freeze mode** (hold current sound indefinitely)

## Architecture
```
USB Mic → PortAudio (mono in)
                ↓
        ┌── Pitch Detector (aubio) ── detectedMidi
        │
        ├── Voice 0: RubberBand shift → envelope → pan → mix
        ├── Voice 1: ...
        ├── ...
        └── Voice 15: ...
                ↓
        Constant-amplitude dry/wet blend → tanh soft clip
                ↓
        PortAudio (stereo out) → speakers/headphones

MIDI Keyboard → Browser Web MIDI → `/api/midi` → native voice allocation
                                           → CC 64 → sustain
                                           → pitch bend → global detune
```
