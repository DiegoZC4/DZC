# Sequences Audio Deployment

Canonical source directory:

`/Users/diego/Desktop/Read/Eliezer Yudkowsky/Sequences`

Website repository:

`/Users/diego/Desktop/Ego/public_html`

## Public Runtime Files

The current episode requires exactly these five public files:

- `sequences-audio.html`
- `sequences-audio.xml`
- `sequences-audio-cover.png`
- `audio/lsrg-90-j4.mp3`
- `audio/lsrg-90-j4-chapters.json`

For future weeks, add the new weekly MP3 and chapter JSON to this list. The
HTML contains the reading text and alignment data inline, so it does not fetch
the reader JSON at runtime.

## Source And Build Files

These stay in the canonical source directory and are not public runtime
dependencies:

- `audio_feed.json`
- `build_audio_feed.py`
- `build_audio_reader.py`
- `transcribe_audio_words.py`
- `web/sequences-audio-cover.svg`
- `web/assets/et-book-roman-line-figures.ttf`
- `web/assets/ET-BOOK-LICENSE`
- `web/audio/lsrg-90-j4-reader.json`
- `web/audio/cargo-cult-science-richard-feynman.mp3`

The reader JSON is a resumable build artifact. The standalone Feynman MP3 is a
source recording; its relevant audio is already included in the weekly MP3.

## Build And Verify

```bash
cd "/Users/diego/Desktop/Read/Eliezer Yudkowsky/Sequences"
python3 build_audio_feed.py
xmllint --noout web/sequences-audio.xml
rsvg-convert -w 1400 -h 1400 web/sequences-audio-cover.svg \
  -o web/sequences-audio-cover.png
```

Copy only changed runtime files into `public_html`. Before committing, compare
their hashes to `origin/main` and stage explicit paths. Never use `git add -A`
in the website repository because its working tree commonly contains unrelated
changes. If the checkout is behind remote, publish from a clean temporary
worktree based on `origin/main`.
