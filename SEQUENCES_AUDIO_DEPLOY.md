# Sequences Audio Deployment

Canonical source directory:

`/Users/diego/Desktop/Read/Eliezer Yudkowsky/Sequences`

Website repository:

`/Users/diego/Desktop/Ego/public_html`

## Public Runtime Files

The current two-episode archive requires exactly these seven public files:

- `sequences-audio.html`
- `sequences-audio.xml`
- `sequences-audio-cover.png`
- `audio/lsrg-90-j4.mp3`
- `audio/lsrg-90-j4-chapters.json`
- `audio/lsrg-92-j5.mp3`
- `audio/lsrg-92-j5-chapters.json`

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
- `web/audio/lsrg-92-j5-reader.json`
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

`python3 build_audio_feed.py` is the publication build. It includes only weeks
whose `audio_feed.json` status is `published`. `python3 build_audio_feed.py
--preview` writes only `web/sequences-audio-preview.html` and must not modify the
publication HTML or RSS.

Before publishing, verify the RSS and explicitly search the publication files
for every draft week ID, date, title, and media filename:

```bash
xmllint --noout web/sequences-audio.xml
rg -n 'DRAFT_WEEK_ID|DRAFT_DATE|DRAFT_TITLE|DRAFT_MP3' \
  web/sequences-audio.html web/sequences-audio.xml
```

The `rg` command must return no matches. For the July 28, 2026 release, the
publication HTML and RSS must contain `lsrg-92` followed by `lsrg-90`, with
exactly two RSS items.

## Safe Push Procedure

Never publish from the normal website checkout: it commonly contains unrelated
changes and may be behind `origin/main`. Never use `git add -A`, `git add .`, a
force push, or a wildcard when staging a release.

1. Fetch the current remote and create a new, uniquely named detached worktree:

```bash
SITE="/Users/diego/Desktop/Ego/public_html"
RELEASE="/private/tmp/dzc-sequences-publish-UNIQUE"
git -C "$SITE" fetch origin
git -C "$SITE" worktree add --detach "$RELEASE" origin/main
```

2. Copy only the changed public runtime files from the canonical build. For a
UI/RSS-only release, do not copy an unchanged MP3 or cover image:

```bash
SOURCE="/Users/diego/Desktop/Read/Eliezer Yudkowsky/Sequences/web"
cp "$SOURCE/sequences-audio.html" "$RELEASE/sequences-audio.html"
cp "$SOURCE/sequences-audio.xml" "$RELEASE/sequences-audio.xml"
cp "$SOURCE/audio/lsrg-92-j5-chapters.json" \
  "$RELEASE/audio/lsrg-92-j5-chapters.json"
```

3. Review and stage exact paths only:

```bash
git -C "$RELEASE" status --short
git -C "$RELEASE" diff --check
git -C "$RELEASE" add -- \
  sequences-audio.html \
  sequences-audio.xml \
  audio/lsrg-92-j5-chapters.json \
  SEQUENCES_AUDIO_DEPLOY.md
git -C "$RELEASE" diff --cached --name-only
git -C "$RELEASE" diff --cached --check
```

The staged file list must contain only the intended runtime files and this guide
when it was intentionally edited. In particular, do not stage
`sequences-audio-preview.html`,
`sequences-audio-candidate.xml`, any draft-week MP3 or chapter JSON, reader JSON,
source scripts, or `serve_local.php`.

4. Commit and push without force. A rejected push means `origin/main` changed;
fetch again and recreate the release from the new remote head.

```bash
git -C "$RELEASE" commit -m "Refine Sequences audio interface"
git -C "$RELEASE" push origin HEAD:main
```

5. After deployment, verify the public HTML, RSS item count, enclosure URLs, and
audio seeking. Confirm again that draft identifiers do not appear in either
public file.
