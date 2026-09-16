# YouTube Transcript Search

Local source for the YouTube transcript search UI, API, scrape/refresh scripts, and STT decensoring workflow.

## What Belongs In Git

Track source files and instructions:

- `index.html`, `patches.html`, `stats.html`, `api.php`, `lib.php`
- `refresh/*.py`, `refresh/*.json`
- `subscriptions/*.py`, exported subscription inputs/reports, and browser UI files
- `README*.md`

Do not track generated data:

- SQLite databases in `data/`
- legacy `*Transcripts.md` transcript dumps
- `refresh/runs/`, `refresh/dedupe_reports/`, and cache folders
- Whisper audio, model environments, and transcription output

The production database is copied/uploaded separately because it is too large for normal git history.

## Conservative Uncensoring Policy

`refresh/stt_patch_censored.py` only stages proposed replacements in the `decensor_candidates` table. It does not apply them to `videos.transcript`.
Each staged row stores `(video_id, start_char, replacement, confidence)`, where `confidence` is the normalized alignment score for review sorting.

A suggested replacement is accepted only when one of these is true:

- the replacement is a single token in `refresh/decensor_allowlist.txt`
- Whisper output matches YouTube transcript context on both sides of the `[ __ ]` marker

This rejects ordinary one-sided alignment mistakes such as selecting the next normal word after a missed censor marker.
Edit `refresh/decensor_allowlist.txt` to add or remove words from the one-sided-context policy without changing code.
