#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v brew >/dev/null 2>&1; then
  printf 'Homebrew is required for a source build: https://brew.sh/\n' >&2
  exit 1
fi

brew install cmake pkg-config portaudio aubio
rubberband_source="$($root/scripts/fetch_rubberband.sh)"
build="$root/build-macos"
dist="$root/dist/Harmonizer-macOS"

cmake -S "$root" -B "$build" -DCMAKE_BUILD_TYPE=Release \
  -DFETCHCONTENT_SOURCE_DIR_RUBBERBAND="$rubberband_source"
cmake --build "$build" --parallel
cmake --install "$build" --prefix "$dist"
cp "$root/packaging/linux/Harmonizer" "$dist/Harmonizer"
chmod +x "$dist/Harmonizer" "$dist/harmonizer_web"

printf '\nInstalled to %s\n' "$dist"
if [[ "${1:-}" != "--no-launch" ]]; then
  exec "$dist/Harmonizer"
fi
