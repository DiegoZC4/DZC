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

The database is ignored by git. Upload it to the same path on Hostinger when deploying transcript data.

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
/ytscripts?action=search&q=movement&channel=Lex%20Fridman&limit=10
```
