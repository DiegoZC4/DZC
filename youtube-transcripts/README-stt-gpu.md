# STT GPU Notes For Censored Caption Patching

These notes are for replacing YouTube's `[ __ ]` caption markers with local STT while keeping YouTube's transcript as the source of truth.

## Hardware And Sandbox Finding

Machine tested:

- Mac mini, Apple M2 Pro
- 10 CPU cores, 16 GPU cores
- 16 GB memory
- macOS 15.6.1
- Metal 3

Codex sandboxing hides or breaks Metal device discovery:

- Inside the sandbox, PyTorch reported `torch.backends.mps.is_available() == False`.
- Inside the sandbox, MLX aborted while trying to construct a Metal device.
- Outside the sandbox, PyTorch saw `mps:0` correctly and MLX ran normally.

For any GPU/Metal STT run, request an outside-sandbox command and use the Whisper venv's Python:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
"/Users/diego/Desktop/Read/YouTube Channel Transcripts/Whisper/.venv/bin/python" \
  -c "import torch; print(torch.backends.mps.is_available()); print(torch.ones(1, device='mps').device)"
```

Expected outside-sandbox result:

```text
True
mps:0
```

## What Worked

`mlx-whisper` is already installed in `Whisper/.venv` and is the best local path tested so far for Apple Silicon. It uses Apple's MLX stack and Metal.

Cached CLI test on a 4.4 second cue:

```bash
"/Users/diego/Desktop/Read/YouTube Channel Transcripts/Whisper/.venv/bin/mlx_whisper" \
  /path/to/cue.wav \
  --model mlx-community/whisper-tiny \
  --language en \
  --condition-on-previous-text False \
  --word-timestamps False \
  --output-format json \
  --output-dir /private/tmp/yt-whisper-bench-mlx \
  --verbose False
```

More importantly, MLX is fast when used inside one long-lived Python process because the model stays loaded:

```python
import time
import mlx_whisper

audio = "/path/to/cue.wav"
model = "mlx-community/whisper-tiny"

for i in range(6):
    t0 = time.perf_counter()
    result = mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=model,
        language="en",
        word_timestamps=False,
        condition_on_previous_text=False,
        verbose=False,
    )
    print(i, round(time.perf_counter() - t0, 3), result["text"])
```

Observed on the 4.4 second sample:

| Backend | Mode | Wall Time | Notes |
| --- | --- | ---: | --- |
| OpenAI Whisper | CLI, CPU, `tiny.en`, no word timestamps | 3.63s | CPU was faster than PyTorch MPS for tiny clips. |
| OpenAI Whisper | CLI, MPS, `tiny.en`, no word timestamps | 6.20s | Metal overhead dominated the short cue. |
| OpenAI Whisper | CLI, MPS, word timestamps | failed | No JSON output; see below. |
| MLX Whisper | CLI, cached, `mlx-community/whisper-tiny` | 2.45s | Still pays CLI/process overhead. |
| MLX Whisper | in-process, first call | 0.78s | Model load/cache warmup. |
| MLX Whisper | in-process, later calls | 0.10s to 0.12s | Roughly 35x to 45x realtime on this tiny cue. |

## What Did Not Work

OpenAI Whisper on PyTorch MPS is not the right backend for this patcher:

- `--device mps --word_timestamps False` works, but was slower than CPU on a tiny cue.
- `--device mps --word_timestamps True` fails in OpenAI Whisper's timestamp alignment:

```text
TypeError: Cannot convert a MPS Tensor to float64 dtype as the MPS framework doesn't support float64.
```

The CLI catches that error, prints `Skipping ...`, exits successfully, and writes no JSON. That is why the patcher saw "Whisper did not write ...json" when trying `--device mps` with word timestamps.

The cue-bounded censor patcher maps `[ __ ]` to YouTube cue times through `segments.char_index`; local STT only needs to recover the replacement text inside that cue. Word timestamps stay enabled by default because they let the script ignore spillover when a chunk contains multiple nearby cues.

## Current Patcher Usage

The patcher now has an opt-in MLX backend:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
"/Users/diego/Desktop/Read/YouTube Channel Transcripts/Whisper/.venv/bin/python" \
  refresh/stt_patch_censored.py \
  --backend mlx \
  --mlx-model mlx-community/whisper-large-v3-mlx \
  --pad-seconds 0 \
  --audio-mode auto \
  --word-timestamps \
  --video-id VIDEO_ID \
  --cookies-from-browser ''
```

Bulk MLX run, keeping the model warm across videos:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
"/Users/diego/Desktop/Read/YouTube Channel Transcripts/Whisper/.venv/bin/python" \
  refresh/stt_patch_censored.py \
  --backend mlx \
  --mlx-model mlx-community/whisper-large-v3-mlx \
  --pad-seconds 0 \
  --audio-mode auto \
  --word-timestamps \
  --all-censored \
  --limit-videos 25 \
  --skip-successful \
  --cookies-from-browser ''
```

The default model is now `mlx-community/whisper-large-v3-mlx`, the largest cached MLX Whisper model tested for this M2 Pro Mac mini with 16 GB memory. `mlx-community/whisper-large-v3-turbo` is also cached and is the speed fallback if full large-v3 proves too slow for bulk runs.

Important:

- Run this outside the Codex sandbox for Metal access.
- Use the venv Python path above, not plain `./refresh/stt_patch_censored.py`, so `mlx_whisper` imports from `Whisper/.venv`.
- Do not force `yt-dlp --js-runtimes node`; current `yt-dlp` defaults work better here.
- `--audio-mode auto` streams tiny jobs, but downloads the full source audio once for marker-heavy videos and then seeks locally for each cue. This avoids re-streaming the YouTube URL for every window.
- Keep `--word-timestamps` on. The patcher uses timestamps to limit candidate extraction back to the original YouTube cue bounds when chunks contain adjacent cues.
- Keep `--max-replacement-tokens 1` for conservative candidate generation. Multi-word replacements should stay review-only until proven safe.
- Reruns replace existing `decensor_candidates` rows for the same processed marker unless `--keep-existing-candidates` is passed.
- Use `--all-censored --limit-videos N` for incremental bulk passes. `--start-after VIDEO_ID` can resume by YouTube id, and `--skip-successful` skips videos that already have rows in `decensor_candidates`.

## Scale Estimate

Current DB estimate for censored captions:

- 6,712 videos contain `[ __ ]`
- 675,418 censored markers
- 643,818 unique cue windows
- About 431 hours of cue-bounded audio before optional padding
- Average cue window: 2.41 seconds before optional padding

At 40x realtime, the raw transcription work is still about 12.5 hours. The current CLI-per-cue architecture would be much slower because hundreds of thousands of separate model and process startups would dominate.

## Recommended Bulk Architecture

For fixing thousands of videos:

1. Use MLX, not OpenAI Whisper MPS.
2. Keep one Python worker process alive so the model stays loaded.
3. Download audio once per video, not once per cue.
4. Cut or pass all censored cue windows for that video through the loaded MLX model. Defaults use cue-bounded windows with no extra context; overlapping windows are merged up to 30 seconds so they do not duplicate audio.
5. Keep word timestamps enabled and filter candidate words back to the original YouTube cue time bounds before aligning against the YouTube cue text.
6. Delete downloaded audio immediately after the video's cues finish.
7. Commit replacement rows in batches to `decensor_candidates(video_id, start_char, replacement, confidence)`. `start_char` points at the six-character `[ __ ]` marker and `confidence` is the normalized alignment score. Do not apply them to `videos.transcript` until the pipeline is trusted.

The patcher supports a bulk MLX pass with `--all-censored`, so one Python process can keep MLX imported and reuse the model across videos. The next optimization beyond that is avoiding a separate `ffmpeg` cut per cue by cutting one per-video audio file and slicing in-process.
