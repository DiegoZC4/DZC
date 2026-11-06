# Unified transcript search

Published UI: `https://diegozc.com/transcripts/`. The legacy
`/youtube-transcripts/` UI redirects here; its API, patches and stats are kept.
No dependency on the Mac or its mounted drives after publication.

## Collections and boundaries

`build_snapshot.py` opens the canonical YouTube database and the mrgirl,
Yarvin/Moldbug and Barry Harris databases **read-only**, in source transactions.
It copies complete preferred, nonempty transcripts from the individual
archives, and all nonempty YouTube transcripts. The manifest records omitted
catalogued entries rather than claiming missing/restricted work is complete.
Namespaced keys intentionally retain cross-collection overlaps.

Only text, source-page URLs, channel/title/provenance and timestamp anchors are
exported. No audio, worker metadata, local-source paths, credentials, cookies,
signed media URLs, or private archive notes are copied. Production SQLite lives
outside `public_html` at `domains/diegozc.com/transcript-data/current.sqlite3`.
The PHP connection is read-only. Existing archive DBs are never modified.

All segment anchors are retained (including fractional seconds); compressed
per-recording anchor arrays use Unicode character offsets, not byte offsets.
External-content FTS avoids storing a second full copy of the transcript text.
Scope filtering uses a compact covering metadata index before fetching large
transcript rows. Keep the documented unary `+f.rowid` in the search query: a
plain rowid `IN` can make SQLite rerun FTS for every selected recording.

The November 5 publication contains 25,030 nonempty transcripts: 23,464 YouTube,
920 mrgirl, 359 Yarvin and 287 Barry Harris, across 1,039 YouTube channels plus
three archive groups. Six empty completed mrgirl transcripts and eight empty
Barry Harris transcripts are not searchable; other untranscribed catalogued
entries remain accounted for in the manifest. This is a publication snapshot,
not a claim that the download/transcription queues are finished.

## Refresh / publish

Run the builder under the shared `heavy-run`, with collision key equal to the
external archive's `publication` directory. Use a new output filename; existing
snapshots are never overwritten. The real `mybook 2tb` mount is required. A
successful build checks SQLite and FTS integrity and writes a SHA-256 manifest.

Upload the new artifact into the existing private `transcript-data` directory,
verify SHA-256 and SQLite integrity on the host, then atomically repoint
`current.sqlite3`. Keep the previous version for rollback. Never upload any of
the original corpus databases or replace the old YouTube production database.
Deploy only this route and the legacy UI redirect from an isolated worktree;
leave unrelated website changes alone. No new recurring automation is added.
`finalize_search_index.py` records the one-time addition of the filter index
to the initial verified snapshot; future builds include that index directly.
Maintenance scripts, Markdown and database/archive file extensions are denied
by the route's `.htaccess`, in addition to keeping the data outside webroot.

For local preview set `TRANSCRIPTS_DB` to the publication snapshot and run PHP
bound to localhost. All browser assets and requests are same-origin, so the
normal authenticated DevHub preview proxy can serve the page without API URL
rewriting. This task uses a disposable development preview and verifies the
actual public HTTPS route; it does not register or change a DevHub service.

## Search

- A literal phrase searches the transcript, case-insensitively.
- Join alternatives with `OR` or `|`; double quotes around phrases are optional.
- The title box is a separate substring filter (accent-insensitive).
- The collection buttons and channel/category picker restrict scope.
- Timestamp links use each source platform's supported URL convention. A
  source without a known timestamp convention is labelled for manual seeking.
- Query URLs preserve collection, title and channel/category filters.
- Search history stays in the browser, not on the server.
- Results are bounded (up to 200); the UI indicates when to narrow a search.
- Word timestamps and automatic speaker identity labels are not part of this
  public snapshot. Recognition errors and inaccessible source links may remain.

## Mobile behavior

Channel selection closes after a choice. There is a persistent, large Done
button, an open/close toggle, outside-pointer dismissal, focus-away dismissal
and Escape. Option selection uses `click`, not `pointerdown`, so scrolling the
list does not select a channel accidentally. History uses a bounded mobile
panel with a sticky Done header. Search blurs inputs; mobile also has an
explicit “Done editing · hide keyboard” control. Inputs are at least 16px.

## Tests

`python3 -B -m unittest -v test_search.py` uses disposable four-collection
fixtures and PHP. It checks scope, title search, OR, Unicode timestamp mapping,
apostrophes, limits and literal/injection handling. `preview_fixture.py` is a
temporary fixture-only local server; do not confuse its four records with live
coverage. Stop it after browser QA. Recheck the deployed API, all collections,
timestamp links, search and mobile dismissal after every publication.
`verify_publication.py` checks all four collections against the exact snapshot,
including source timestamp anchors, title/OR filters and bounded query latency.
Publication receipts are retained in the external archive's `publication/`
directory and the host's private `transcript-data/` directory.
