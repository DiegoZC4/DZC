#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/harmonizer-unvoiced.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

printf 'time,event,note\n0.0,on,60\n0.0,on,64\n0.0,on,67\n2.2,off,60\n2.2,off,64\n2.2,off,67\n' > "$TMP_DIR/midi.csv"
printf '{"mix":1.0,"gainDb":0.0,"gate":0.01,"stableWindow":1.0}\n' > "$TMP_DIR/meta.json"

# One second of an A3-like vowel establishes F0, followed by a one-second
# high-frequency noise consonant and one second of silence.
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'aevalsrc=0.18*sin(2*PI*220*t)+0.09*sin(4*PI*220*t)+0.045*sin(6*PI*220*t):s=44100:d=1' \
  -f lavfi -i 'anoisesrc=color=white:amplitude=0.08:sample_rate=44100:d=1' \
  -f lavfi -i 'anullsrc=r=44100:cl=mono:d=1' \
  -filter_complex '[1:a]highpass=f=4000[n];[0:a][n][2:a]concat=n=3:v=0:a=1[out]' \
  -map '[out]' -ar 44100 -ac 1 -c:a pcm_f32le "$TMP_DIR/mic.wav" -y

"$ROOT/harmonizer_web" --render "$TMP_DIR" >/dev/null

mean_volume() {
  local start="$1"
  local duration="$2"
  ffmpeg -hide_banner -nostats -ss "$start" -t "$duration" \
    -i "$TMP_DIR/render.wav" -af volumedetect -f null - 2>&1 |
    awk '/mean_volume:/ { print $(NF - 1) }'
}

SIBILANT_DB="$(mean_volume 1.45 0.40)"
SILENCE_DB="$(mean_volume 2.70 0.20)"

awk -v sibilant="$SIBILANT_DB" -v silence="$SILENCE_DB" '
  BEGIN {
    pass = sibilant > -45.0 && silence < -70.0
    printf "unvoiced hold: sibilant %.1f dB, silence %.1f dB: %s\n",
           sibilant, silence, pass ? "PASS" : "FAIL"
    exit(pass ? 0 : 1)
  }
'
