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

The cue-bounded censor patcher does not need STT word timestamps. It already maps `[ __ ]` to YouTube cue times through `segments.char_index`; local STT only needs to recover the replacement text inside that cue.

## Current Patcher Usage

The patcher now has an opt-in MLX backend:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
"/Users/diego/Desktop/Read/YouTube Channel Transcripts/Whisper/.venv/bin/python" \
  refresh/stt_patch_censored.py \
  --backend mlx \
  --mlx-model mlx-community/whisper-tiny \
  --video-id VIDEO_ID \
  --apply \
  --cookies-from-browser ''
```

Use `--mlx-model mlx-community/whisper-base` or a larger MLX model only if `tiny` is not accurate enough on review samples.

Important:

- Run this outside the Codex sandbox for Metal access.
- Use the venv Python path above, not plain `./refresh/stt_patch_censored.py`, so `mlx_whisper` imports from `Whisper/.venv`.
- Keep `--word-timestamps` off unless there is a specific reason to test it.
- Keep `--max-replacement-tokens 1` for automatic application. Multi-word replacements should be review-only until proven safe.

## Scale Estimate

Current DB estimate for censored captions:

- 6,712 videos contain `[ __ ]`
- 675,418 censored markers
- 643,818 unique cue windows
- About 503 hours of cue-bounded audio with 0.2s padding
- Average cue window: 2.81 seconds

At 40x realtime, the raw transcription work is still about 12.5 hours. The current CLI-per-cue architecture would be much slower because hundreds of thousands of separate model and process startups would dominate.

## Recommended Bulk Architecture

For fixing thousands of videos:

1. Use MLX, not OpenAI Whisper MPS.
2. Keep one Python worker process alive so the model stays loaded.
3. Download audio once per video, not once per cue.
4. Cut or pass all censored cue windows for that video through the loaded MLX model.
5. Keep word timestamps disabled and align the returned cue text against the YouTube cue text.
6. Delete downloaded audio immediately after the video's cues finish.
7. Commit replacement rows in batches and keep `stt_patch_runs` / `stt_patch_markers` as the audit trail.

The next implementation step is a bulk MLX worker that processes many videos in one process. The single-video patcher can now use MLX, but a full 6,000+ video repair pass should not be done by launching one command per video or one command per cue.
