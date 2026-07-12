# Harmonizer

A live, MIDI-controlled vocal harmonizer with formant-preserving pitch shifting.
The microphone and DSP run locally; the browser is the control surface.

## Fastest option: use the website

The hosted browser edition works without installing anything on current
Chrome or Edge for macOS, Windows, Linux, and ChromeOS. Audio never leaves the
browser. Use headphones, press **Start audio**, choose the microphone/output,
and play harmony notes with MIDI or the computer keyboard.

The native edition uses PortAudio, aubio, and Rubber Band 4 for lower-level
audio routing and the same browser GUI.

## Native setup

Download and extract the source package, open a terminal in the folder, then
run the installer for the operating system:

### macOS

Apple Silicon users can use the prebuilt `Harmonizer-macOS-arm64.zip`.
For Intel Macs or a local rebuild:

```bash
./scripts/install-macos.sh
```

The source installer requires [Homebrew](https://brew.sh/) and installs the
remaining build dependencies automatically.

### Ubuntu or Debian Linux

```bash
./scripts/install-linux.sh
```

The script installs the apt dependencies, builds the native executable, and
opens the control surface. Other distributions can use `CMakeLists.txt` with
their PortAudio and aubio development packages.

### Windows 10 or 11

Right-click `scripts/install-windows.ps1`, choose **Run with PowerShell**, or
run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

The script installs MSYS2 with WinGet when needed, installs the UCRT64 build
dependencies, compiles the app, and starts it. Later launches use
`dist\Harmonizer-Windows-x64\Harmonizer.cmd`.

## Manual build

Install PortAudio, aubio, CMake, a C++17 compiler, and pkg-config. Then:

```bash
rubberband_source="$(./scripts/fetch_rubberband.sh)"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
  -DFETCHCONTENT_SOURCE_DIR_RUBBERBAND="$rubberband_source"
cmake --build build --parallel
```

Rubber Band 4.0.0 is fetched from its official repository and verified by
SHA-256 because older operating-system packages do not include the
`RubberBandLiveShifter` API used here.

## Keyboard layout

The physical computer-keyboard map begins at F3 on Left Shift, reaches B4 on
Slash, continues at C5 on Tab, and reaches B6 on Backslash. Web MIDI devices
can be selected independently from the MIDI input menu.

## Testing

```bash
STRICT=1 make test-pitch
node public/test-pitch.mjs
```

The native fixture suite uses annotated monophonic singing recordings. The
public test checks the browser pitch detector without microphone input.

## License

Harmonizer is distributed under GPL-3.0-or-later. Rubber Band is
GPL-2.0-or-later, aubio is GPL-3.0-or-later, PortAudio uses its permissive
license, and the browser build of Signalsmith Stretch is MIT-licensed. The
corresponding source is included so the downloadable native build remains
redistributable under those terms.
