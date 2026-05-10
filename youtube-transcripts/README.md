# YouTube Transcript Search

This app searches YouTube transcript markdown files with PHP and SQLite FTS.

## Schema

- `videos.youtube_id` is the primary key.
- `videos.transcript` stores the full concatenated transcript for each video.
- `segments` maps `(video_id, start_seconds)` to the character index where that SRT chunk starts in the full transcript.
- Search runs against full video transcripts, then maps each match offset to the closest preceding segment timestamp.

## Import

From a machine that can read the transcript markdown files:

```bash
/opt/homebrew/bin/php /Users/diego/Desktop/Ego/public_html/youtube-transcripts/import.php --rebuild
```

The generated database is:

```text
youtube-transcripts/data/transcripts.sqlite3
```

The database is ignored by git. The current full import is about 928 MB, which is too large for normal GitHub tracking. Upload it to the same path on Hostinger when deploying transcript data:

```text
public_html/youtube-transcripts/data/transcripts.sqlite3
```

## Test

```bash
/opt/homebrew/bin/php -l youtube-transcripts/lib.php
/opt/homebrew/bin/php -l youtube-transcripts/api.php
/opt/homebrew/bin/php -l youtube-transcripts/import.php
sqlite3 youtube-transcripts/data/transcripts.sqlite3 ".schema videos"
sqlite3 youtube-transcripts/data/transcripts.sqlite3 ".schema segments"
```

## Direct API

The `/ytscripts` route is JSON-first, so you can test without opening the UI:

```text
/ytscripts
/ytscripts?action=channels
/ytscripts?q=bro%20science
/ytscripts?q=physics&video_id=-t1_ffaFXao
/ytscripts?action=search&q=movement&channel=Lex%20Fridman&limit=10
```

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
