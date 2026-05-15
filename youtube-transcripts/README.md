# YouTube Transcript Search

This app searches YouTube transcript markdown files with PHP and SQLite FTS.

## Project Locations

- Source project: `/Users/diego/Desktop/Read/YouTube Channel Transcripts`
- Website mirror: `/Users/diego/Desktop/Ego/public_html/youtube-transcripts`
- Public route: `https://diegozc.com/ytscripts/`
- Local SQLite DB: `/Users/diego/Desktop/Read/YouTube Channel Transcripts/data/transcripts.sqlite3`
- Website mirror SQLite DB: `/Users/diego/Desktop/Ego/public_html/youtube-transcripts/data/transcripts.sqlite3`
- Live Hostinger SQLite DB: `/home/u506224278/domains/diegozc.com/public_html/youtube-transcripts/data/transcripts.sqlite3`

The SQLite DB is ignored by git because it is multi-GB. Git/GitHub deploys update PHP, HTML, and JSON, but they do not upload `data/transcripts.sqlite3`.

## Schema

- `channels.id` is the primary key for channel metadata.
- `channels.name` stores the display name used in filters and results.
- `channels.url`, `channels.avatar_url`, `channels.category`, and `channels.enabled` store channel metadata that used to live only in JSON config.
- `videos.youtube_id` is the primary key.
- `videos.channel_id` references `channels.id`.
- `videos.transcript` stores the full concatenated transcript for each video.
- `segments` maps `(video_id, start_seconds)` to the character index where that timed subtitle cue starts in the full transcript.
- Search runs against full video transcripts, then maps each match offset to the closest preceding segment timestamp.

## Refresh Existing Channels

Use the refresh script for normal incremental updates. It reads channel URLs from `refresh/channels.json`, compares newest YouTube video IDs against the local DB, downloads English subtitles with `yt-dlp`, preferring raw `json3` cues before `vtt` or `srt`, writes per-run markdown under `refresh/runs/`, imports those markdown files into SQLite, and keeps the DB-backed `channels` table current.

Refresh all enabled channels:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
./refresh/refresh_transcripts.py
```

Refresh one channel:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
./refresh/refresh_transcripts.py --channel "Theo Von" --scan-limit 100 --continue-after-known
```

Useful flags:

- `--channel "Name"` can be repeated for several channels.
- `--scan-limit 100` checks more recent videos before stopping.
- `--continue-after-known` keeps scanning after known videos; use this when a channel has holes or older videos were missed.
- `--max-new 20` limits import size for a cautious pass.
- `--dry-run` detects new videos without downloading or importing.
- `--cookies-from-browser chrome` is the default and helps `yt-dlp` access YouTube reliably.

After a run, inspect:

```text
/Users/diego/Desktop/Read/YouTube Channel Transcripts/refresh/runs/<timestamp>/report.json
```

Do not run more than one import into SQLite at the same time. Parallel `yt-dlp` downloads are fine, but SQLite only allows one writer. If two refresh processes reach `import.php` together, one can fail with `SQLSTATE[HY000]: General error: 5 database is locked`. The downloaded markdown is still usable; replay the failed import after the current writer finishes:

```bash
/opt/homebrew/bin/php "/Users/diego/Desktop/Read/YouTube Channel Transcripts/import.php" \
  --source="/Users/diego/Desktop/Read/YouTube Channel Transcripts/refresh/runs/<timestamp>/markdown/<Channel_Name>"
```

The importer wraps each markdown file in a single transaction, so replaying a failed channel is safe: existing videos are upserted and missing videos are added. If a run hits the `--scan-limit`, it only scraped the newest videos visible within that cap; rerun with a larger cap for a deeper backfill.

For very large podcast channels, use the resumable bulk path instead of replaying normal per-video FTS writes. This skips videos already committed, stores sparser timestamp anchors, defers FTS, then rebuilds that channel's FTS entries in one SQLite pass:

```bash
/opt/homebrew/bin/php "/Users/diego/Desktop/Read/YouTube Channel Transcripts/import.php" \
  --source="/Users/diego/Desktop/Read/YouTube Channel Transcripts/refresh/runs/<timestamp>/markdown/<Channel_Name>" \
  --skip-existing --bulk --segment-interval=30 --defer-fts

sqlite3 "/Users/diego/Desktop/Read/YouTube Channel Transcripts/data/transcripts.sqlite3" \
  "DELETE FROM videos_fts WHERE channel='<Channel Name>'; INSERT INTO videos_fts (youtube_id, channel, title, transcript) SELECT v.youtube_id, c.name, v.title, v.transcript FROM videos v JOIN channels c ON c.id = v.channel_id WHERE c.name='<Channel Name>';"
```

After a manual replay, make sure the stats cache is refreshed if you need the stats page to reflect the new import immediately:

```bash
/opt/homebrew/bin/php -r 'require "/Users/diego/Desktop/Read/YouTube Channel Transcripts/lib.php"; yt_refresh_channel_stats(yt_db());'
```

## Refresh Existing Rows From JSON3

Use this when existing transcript text was imported from bad rolling captions or converted SRT cues and needs to be repaired without rebuilding the whole database. The script downloads YouTube `json3` subtitles for videos already in SQLite, parses the clean timed cues, replaces `videos.transcript`, deletes and reinserts `segments`, and records resumable status in `json3_refresh_status`.

Single-worker cautious run:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
./refresh/refresh_existing_json3.py --batch-size 50 --cookies-from-browser '' --fts-mode none
```

Four-way resumable run:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
./refresh/refresh_existing_json3.py --batch-size 50 --cookies-from-browser '' --fts-mode none --retry-failed --shard-count 4 --shard-index 0
./refresh/refresh_existing_json3.py --batch-size 50 --cookies-from-browser '' --fts-mode none --retry-failed --shard-count 4 --shard-index 1
./refresh/refresh_existing_json3.py --batch-size 50 --cookies-from-browser '' --fts-mode none --retry-failed --shard-count 4 --shard-index 2
./refresh/refresh_existing_json3.py --batch-size 50 --cookies-from-browser '' --fts-mode none --retry-failed --shard-count 4 --shard-index 3
```

Each successful row stores `old_transcript_hash`, `new_transcript_hash`, and `transcript_changed` when old-hash tracking is available. Check how much work mattered:

```bash
sqlite3 -cmd ".timeout 60000" data/transcripts.sqlite3 "
  SELECT status, COUNT(*) FROM json3_refresh_status GROUP BY status;
  SELECT transcript_changed, COUNT(*)
  FROM json3_refresh_status
  WHERE status='success' AND old_transcript_hash != ''
  GROUP BY transcript_changed;
  SELECT COUNT(*)
  FROM json3_refresh_status
  WHERE status='success' AND old_transcript_hash = '';
"
```

When using `--fts-mode none`, rebuild search indexes after all shards finish:

```bash
sqlite3 -cmd ".timeout 600000" data/transcripts.sqlite3 "
  DELETE FROM videos_fts;
  INSERT INTO videos_fts (youtube_id, channel, title, transcript)
  SELECT v.youtube_id, c.name, v.title, v.transcript
  FROM videos v JOIN channels c ON c.id = v.channel_id;
  DELETE FROM video_titles_fts;
  INSERT INTO video_titles_fts (youtube_id, channel, title)
  SELECT v.youtube_id, c.name, v.title
  FROM videos v JOIN channels c ON c.id = v.channel_id;
  PRAGMA wal_checkpoint(TRUNCATE);
"
/opt/homebrew/bin/php -r 'require "/Users/diego/Desktop/Read/YouTube Channel Transcripts/lib.php"; yt_refresh_channel_stats(yt_db());'
```

`videos.transcript` remains the full concatenated clean transcript. `segments` remains the timestamp-to-character-index map used by snippets and YouTube timestamp links. Rows marked `no_subtitles` keep their existing transcript because `yt-dlp` did not return an English JSON3 subtitle for that video.

## Patch Censored Captions With Local STT

Use this only for videos whose YouTube transcript contains `[ __ ]`. The patcher keeps the YouTube transcript as the source of truth, finds each censored marker, maps it to the exact subtitle cue through `segments.char_index`, cuts audio from that cue only, runs local Whisper, and replaces a marker only when the local STT aligns with the surrounding YouTube words inside that cue. By default it auto-applies one-token replacements only; use `--max-replacement-tokens` for phrase-level review.

For Apple Silicon GPU notes and the faster MLX path, see `README-stt-gpu.md`.

Trial on one known short video:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
./refresh/stt_patch_censored.py \
  --video-id M4d8jWOOaCI \
  --apply \
  --model small.en \
  --pad-seconds 0.2 \
  --keep-workdir \
  --cookies-from-browser ''
```

MLX/Metal test run:

```bash
"/Users/diego/Desktop/Read/YouTube Channel Transcripts/Whisper/.venv/bin/python" \
  refresh/stt_patch_censored.py \
  --backend mlx \
  --mlx-model mlx-community/whisper-tiny \
  --video-id M4d8jWOOaCI \
  --apply \
  --cookies-from-browser ''
```

Important behavior:

- Each cut audio file is deleted in a `finally` block immediately after its Whisper pass finishes.
- `--keep-workdir` keeps `summary.json` and Whisper JSON/report files, but not audio.
- `--apply` updates `videos.transcript`, shifts later `segments.char_index` values when replacements change text length, and refreshes `videos_fts` for that video.
- Without `--apply`, it records candidates for review but does not mutate transcript rows.
- `--restore-run-id RUN_ID --delete-restored-run` reverses previously applied replacements from that audit run back to `[ __ ]`, then deletes the stale run.
- The audit tables are `stt_patch_runs` and `stt_patch_markers`.
- The UI has an `STT Patches` tab backed by `api.php?action=patches`, showing timestamped YouTube links, original YouTube excerpts, local STT excerpts, candidates, confidence, and apply status.

Inspect the latest run directly:

```bash
sqlite3 -cmd ".timeout 5000" data/transcripts.sqlite3 "
  SELECT id, video_id, status, markers, applied, audio_seconds, error
  FROM stt_patch_runs
  ORDER BY id DESC
  LIMIT 5;

  SELECT marker_index, marker_start_seconds, status, confidence, candidate_text, replacement_text, reason
  FROM stt_patch_markers
  WHERE run_id = (SELECT max(id) FROM stt_patch_runs)
  ORDER BY marker_index;
"
```

Default windowing is cue-bounded and intentionally strict: `--pad-seconds 0.2`, no cross-cue merging, and `--max-replacement-tokens 1`. This avoids long low-confidence candidates that merely duplicate surrounding transcript text. Raise `--max-replacement-tokens` only when you want to review possible multi-word censor spans.

## Dedupe Rolling Transcript Overlaps

The JSON3 refresh path above is preferred for overlap repair because it goes back to YouTube's timed subtitle source instead of guessing. Use this heuristic cleanup only as a fallback for rows that cannot be refreshed from JSON3. Some YouTube subtitle exports repeat the trailing words from one caption chunk at the start of the next chunk. Bulk imports with sparse segment anchors can also leave exact repeated phrases inside one segment. Both patterns create duplicate phrases in snippets even when the video is only imported once. Clean those overlaps with:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
python3 refresh/dedupe_transcript_overlaps.py
```

The default run is a dry run. It writes a JSON report under `refresh/dedupe_reports/` and does not change the DB. If the report has reasonable `removed_ratio` values and `videos_skipped` is acceptable, apply it:

```bash
python3 refresh/dedupe_transcript_overlaps.py --apply --commit-every 500
```

The apply pass updates `videos.transcript`, rebuilds `segments.char_index`, collapses exact repeated phrases of 4 or more words, and rebuilds `videos_fts` in one bulk pass after the transcript rows are clean. After applying, refresh cached stats, checkpoint, optionally vacuum, and verify:

```bash
/opt/homebrew/bin/php -r 'require "/Users/diego/Desktop/Read/YouTube Channel Transcripts/lib.php"; yt_refresh_channel_stats(yt_db());'
sqlite3 -cmd ".timeout 60000" data/transcripts.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 -cmd ".timeout 60000" data/transcripts.sqlite3 "VACUUM; PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 data/transcripts.sqlite3 "PRAGMA integrity_check;"
sqlite3 data/transcripts.sqlite3 "PRAGMA foreign_key_check; SELECT COUNT(*) FROM videos WHERE channel_id IS NULL; SELECT COUNT(*) FROM videos; SELECT COUNT(*) FROM videos_fts;"
```

Then copy the compacted DB back to the website mirror and upload it to Hostinger if the live site should use the cleaned transcripts.

## Scrape New Channels

To add a new channel:

1. Add it to `refresh/channels.json`:

```json
{ "channel": "The Tim Dillon Show", "url": "https://www.youtube.com/@TimDillonShow", "enabled": true }
```

2. Add or verify its category in `CHANNEL_CATEGORIES` inside `refresh/refresh_transcripts.py`. Comedy channels should use `"Comedy"`.

3. Run the refresh script with a larger scan limit:

```bash
cd "/Users/diego/Desktop/Read/YouTube Channel Transcripts"
./refresh/refresh_transcripts.py --channel "The Tim Dillon Show" --scan-limit 1000 --continue-after-known
```

4. Verify the new channel count:

```bash
sqlite3 "/Users/diego/Desktop/Read/YouTube Channel Transcripts/data/transcripts.sqlite3" \
  "select c.name, count(*) from videos v join channels c on c.id = v.channel_id where c.name = 'The Tim Dillon Show' group by c.name;"
```

5. If the channel needs dedupe rules, add known-bad YouTube IDs to `refresh/blacklist.json` and rerun. Use this for compilations, duplicate uploads, or videos that should never be imported.

6. If a channel should only import selected topics, add `include_title_regex` to its row in `refresh/channels.json`. The regex is applied to YouTube titles after the scan and before subtitle download. Example:

```json
{ "channel": "Destiny", "url": "https://www.youtube.com/@destiny", "enabled": true, "include_title_regex": "(?i)(mrgirl|israel)" }
```

Recently added examples:

```text
Sam Harris|222|Philosophy
The Tim Dillon Show|290|Comedy
Theo Von|830|Comedy
Practical Engineering|219|Engineering
SmarterEveryDay|367|Science
Adam Ragusea|673|Food
Binging with Babish|662|Food
Technology Connections|228|Engineering
Tech Ingredients|23|Engineering
Rick Beato|780|Music
Ear Biscuits|513|Comedy
80,000 Hours|348|AI
Destiny|45|Philosophy|title filter: (?i)(mrgirl|israel)
Jordan B Peterson|981|Philosophy
```

## Full Import

From a machine that can read the transcript markdown files:

```bash
/opt/homebrew/bin/php "/Users/diego/Desktop/Read/YouTube Channel Transcripts/import.php" --rebuild
```

The generated database is:

```text
/Users/diego/Desktop/Read/YouTube Channel Transcripts/data/transcripts.sqlite3
```

The database is ignored by git. The current full import is about 4.0 GB, which is too large for normal GitHub tracking. Upload it to the same path on Hostinger when deploying transcript data:

```text
public_html/youtube-transcripts/data/transcripts.sqlite3
```

Prefer the incremental refresh script over `--rebuild` unless the whole corpus needs to be regenerated.

## Sync To Website Mirror

After updating the source project, copy the app files and DB into the local website mirror:

```bash
cp "/Users/diego/Desktop/Read/YouTube Channel Transcripts/api.php" \
  "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/api.php"
cp "/Users/diego/Desktop/Read/YouTube Channel Transcripts/import.php" \
  "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/import.php"
cp "/Users/diego/Desktop/Read/YouTube Channel Transcripts/lib.php" \
  "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/lib.php"
cp "/Users/diego/Desktop/Read/YouTube Channel Transcripts/index.html" \
  "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/index.html"
mkdir -p "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/refresh"
cp "/Users/diego/Desktop/Read/YouTube Channel Transcripts/refresh/stt_patch_censored.py" \
  "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/refresh/stt_patch_censored.py"
cp "/Users/diego/Desktop/Read/YouTube Channel Transcripts/data/transcripts.sqlite3" \
  "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/data/transcripts.sqlite3"
```

Commit and push only the tracked small files from `/Users/diego/Desktop/Ego/public_html`. The DB is ignored and must be uploaded separately.

```bash
git -C "/Users/diego/Desktop/Ego/public_html" status --short -- youtube-transcripts
git -C "/Users/diego/Desktop/Ego/public_html" add \
  youtube-transcripts/api.php \
  youtube-transcripts/import.php \
  youtube-transcripts/lib.php \
  youtube-transcripts/index.html \
  youtube-transcripts/refresh/stt_patch_censored.py \
  youtube-transcripts/stats.html \
  youtube-transcripts/README.md
git -C "/Users/diego/Desktop/Ego/public_html" commit -m "Update YouTube transcript search"
git -C "/Users/diego/Desktop/Ego/public_html" push
```

There are often unrelated dirty files in `/Users/diego/Desktop/Ego/public_html`; do not stage or revert them unless the user explicitly asks.

## Upload DB To Hostinger

The live DB path is:

```text
/home/u506224278/domains/diegozc.com/public_html/youtube-transcripts/data/transcripts.sqlite3
```

Hostinger SSH/SFTP for this account is:

```text
host: 145.223.105.221
domain alias: diegozc.com
user: u506224278
port: 65002
```

This Mac did not have a usable SSH key when checked on 2026-05-11:

```text
u506224278@diegozc.com: Permission denied (publickey,password).
```

If credentials or an SSH key are available, upload with `rsync`:

```bash
rsync -av --progress -e "ssh -p 65002" \
  "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/data/transcripts.sqlite3" \
  "u506224278@145.223.105.221:/home/u506224278/domains/diegozc.com/public_html/youtube-transcripts/data/transcripts.sqlite3"
```

If only SFTP is available, connect to port `65002` and upload the local DB to:

```text
/home/u506224278/domains/diegozc.com/public_html/youtube-transcripts/data/transcripts.sqlite3
```

Upload only `transcripts.sqlite3`. The local `transcripts.sqlite3-wal` should usually be `0B`, and `transcripts.sqlite3-shm` does not need to be uploaded.

## Test

```bash
/opt/homebrew/bin/php -l "/Users/diego/Desktop/Read/YouTube Channel Transcripts/lib.php"
/opt/homebrew/bin/php -l "/Users/diego/Desktop/Read/YouTube Channel Transcripts/api.php"
/opt/homebrew/bin/php -l "/Users/diego/Desktop/Read/YouTube Channel Transcripts/import.php"
sqlite3 "/Users/diego/Desktop/Read/YouTube Channel Transcripts/data/transcripts.sqlite3" ".schema videos"
sqlite3 "/Users/diego/Desktop/Read/YouTube Channel Transcripts/data/transcripts.sqlite3" ".schema segments"
```

Before uploading a DB:

```bash
sqlite3 "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/data/transcripts.sqlite3" "PRAGMA integrity_check;"
sqlite3 "/Users/diego/Desktop/Ego/public_html/youtube-transcripts/data/transcripts.sqlite3" \
  "select count(*) from videos; select count(*) from channels; select count(*) from videos where channel_id is null; select count(*) from segments;"
```

After uploading, verify live state:

```bash
curl -sSL 'https://diegozc.com/ytscripts/?action=channels'
curl -sSL 'https://diegozc.com/ytscripts/?q=theo%20von&limit=1'
```

The API reports both the live DB path and live DB stats. If local searches show new channels but `/ytscripts/?action=channels` does not, the SQLite DB was not uploaded.

## Direct API

The `/ytscripts` route is JSON-first, so you can test without opening the UI:

```text
/ytscripts
/ytscripts?action=channels
/ytscripts?q=bro%20science
/ytscripts?q=physics&video_id=-t1_ffaFXao
/ytscripts?action=search&q=movement&channel=Lex%20Fridman&limit=10
```

## Hosting Notes

Slow first searches on Hostinger are probably cold filesystem cache against a multi-GB SQLite FTS DB, not a PHP worker "sleep" problem. Later searches are faster because the OS has warmed the DB pages.

Avoid warming the API with `action=channels` from the frontend. The PHP development server is single-worker, so an expensive background request can block the user's next visible search. Search requests should also avoid calling full DB stats; `yt_require_data()` intentionally uses a cheap `SELECT 1 FROM videos LIMIT 1` check instead of counting `segments`.

Title-only substring search uses `video_titles_fts`, a small FTS5 trigram index containing `youtube_id`, `channel`, and `title`. This avoids scanning the multi-GB `videos` table just to filter titles. Imports maintain it automatically through `yt_save_video()`. If an older DB is missing or stale, rebuild it locally before upload:

```bash
sqlite3 "/Users/diego/Desktop/Read/YouTube Channel Transcripts/data/transcripts.sqlite3" \
  "CREATE VIRTUAL TABLE IF NOT EXISTS video_titles_fts USING fts5(youtube_id UNINDEXED, channel UNINDEXED, title, tokenize='trigram'); DELETE FROM video_titles_fts; INSERT INTO video_titles_fts (youtube_id, channel, title) SELECT v.youtube_id, c.name, v.title FROM videos v JOIN channels c ON c.id = v.channel_id;"
```

When evaluating Hostinger plans, check:

- I/O throughput
- RAM
- CPU cores
- PHP workers
- OPcache limits
- Whether the plan is shared hosting, cloud hosting, or VPS

For this workload, a small VPS is usually a better fit than shared hosting because it gives predictable disk cache, direct SSH deploys, and control over a persistent PHP or app server. Hostinger VPS KVM 1/KVM 2, DigitalOcean Basic Droplets, or Fly.io can all work; VPS is simplest operationally for SQLite.

## Local Full-DB Benchmark

Full import tested locally:

- Source markdown: 13 files, 464 MB
- SQLite DB: 928 MB
- Videos: 5,806
- Timestamp anchors: 6,814,641
- Indexed transcript text: 241,566,206 characters
- Import time: about 3 minutes

Representative local search timings, 5 runs each:

| Scope | Query | Chars in scope | Results | Median |
| --- | --- | ---: | ---: | ---: |
| Single large video | `physics` | 259,331 | 20 | 17.2 ms |
| Small channel | `number` | 688,593 | 50 | 3.9 ms |
| Medium channel | `bro science` | 1,277,042 | 50 | 3.0 ms |
| Large channel | `fighter` | 89,804,623 | 50 | 3.1 ms |
| All channels common | `the` | 241,566,206 | 50 | 20.8 ms |
| All channels phrase | `machine learning` | 241,566,206 | 50 | 10.7 ms |

These timings are local CLI timings against SQLite FTS. Hostinger will add web/PHP overhead and may be slower depending on plan I/O.
