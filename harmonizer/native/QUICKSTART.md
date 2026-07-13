# Harmonizer Rehearsal Quick Start

Rubber Band Live 512 is the default and recommended native backend.

## Today

Use the already-tested Mac mini for the performance. Bring the microphone,
audio interface, headphones, MIDI controller, power supplies, and a USB copy
of the downloads. Treat another computer as a backup until it passes an audio
check with the exact interface and output route.

## Apple Silicon macOS

1. Download and unzip `Harmonizer-macOS-arm64.zip`.
2. Right-click `Harmonizer.app` and choose **Open** on the first launch.
3. Choose the microphone, headphones, and MIDI input in the browser GUI.
4. Confirm **Rubber Band Live 512**, **100% wet**, and test the output.

This is the only no-compiler native download currently provided.

## Ubuntu or Debian Linux

Extract `Harmonizer-source.zip`, open a terminal in the extracted folder, and
run:

```bash
./scripts/install-linux.sh
```

The script installs packages with `sudo`, builds only Live 512, and launches
the GUI. It requires working internet access.

## Windows 10 or 11

Extract `Harmonizer-source.zip`, open PowerShell in the extracted folder, and
run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

The first run installs MSYS2 and audio build dependencies, then compiles Live
512. It requires WinGet, internet access, and administrator permission. Do not
make a time-critical rehearsal depend on an untested first Windows build.

## Intel macOS

Extract the source package and run:

```bash
./scripts/install-macos.sh
```

This requires Homebrew and internet access.

## Audio Check

Use headphones. Confirm the input meter moves, **Test output** is audible, MIDI
or computer-key notes illuminate the piano, and singing produces wet output.
Use the same sample-rate and physical audio devices for the whole rehearsal.

To include the experimental comparison engines in a source build, add
`--all-backends` to the installer command.
