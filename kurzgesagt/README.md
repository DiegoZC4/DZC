# Kurzgesagt

One question, mostly blanks. Pass to uncover a word, or guess. Both cost a round, and your
score is the round counter at the moment you solve it. Lower is better. No clock, no lobby,
no turns: a puzzle is frozen when it is published and everyone runs at it alone.

Sibling of `../nutshell/`. Same house style, same security discipline, same `nk_` → `kg_`
shapes, but a **separate database file**, so a bug here can never touch a live nutshell room.

## Runtime

Serve this directory at `https://diegozc.com/kurzgesagt/` on PHP 8.0+ with `pdo_sqlite` and
`mbstring`. `ext-intl` is optional: accent folding feature-detects `Normalizer` and falls
back to a substitution table that agrees with it. Only `index.html`, `style.css`, `app.js`,
`api.php` and `engine.php` are required. No build step, no npm, no framework, no CDN.

**Production is PHP 8.0.30** (Hostinger/LiteSpeed) while this laptop is newer, so the PHP
here is 8.0-compatible on purpose: no enums, no `readonly`, no `never`, no
`array_is_list()`, no `json_validate()`, no first-class callable syntax, no `new` in
initializers, no string-keyed array unpacking. `engine.php` line ~115 is the list check that
would otherwise be `array_is_list()`. Keep it that way; `php -l` on 8.5 will not catch this.

Three screens, reached by hash routing only — no `.htaccess`, no rewrites:

| Hash | Who | What |
|---|---|---|
| `#write` | anyone | Question + answer into the shared pool |
| `#mask` | anyone | Browse the pool, pick one, set the reveal order, publish |
| `#guess/<id>` | everyone | Play. `#guess`, `#<id>` and a bare `/kurzgesagt/` land here too |

## Storage, and the one rule that matters

The database is created at `.kurzgesagt-private/puzzles.sqlite3` **beside**, never inside,
the document root — `dirname(DOCUMENT_ROOT)`, which resolves the same locally and in
production because both serve `public_html` as the root. `KURZGESAGT_DATA_DIR` overrides the
location. The directory is made `0700`, the connection uses WAL and a busy timeout.

`kg_database()` **fails closed with HTTP 503** if the resolved path is the document root or
sits inside it, rather than quietly creating a downloadable SQLite file in a public
directory. Verify after any deploy or hosting change:

```
curl -s https://diegozc.com/kurzgesagt/api.php?do=version
ls -la /path/to/.kurzgesagt-private        # outside public_html
```

Keep that directory out of Git, public downloads and shared backups. Published puzzles are
permanent, so preserve the file across updates. Only never-published pool drafts expire,
after 7 days. There are 10 KB request limits, IP-bucketed rate limits (the limiter stores
time-bucketed hashes, never raw addresses), a 2000-question pool bound and a 5000-puzzle
bound.

## Rules

- A question is 2–40 words. An answer is at least two letters or digits after normalising,
  so an answer of `?` cannot make any punctuation an instant win.
- Alternatives are split on `|`. Players only ever see the first one.
- Matching casefolds, strips accents, closes up apostrophes (`dog's` → `dogs`), turns other
  punctuation into spaces (`well-known` → two words) and collapses whitespace. Leading
  articles are kept, so *The Who* stays *The Who*.
- The masker clicks words in the order they should be uncovered; a tile shows its 1-based
  position, clicking it again removes it and the rest renumber. Words never clicked are
  appended in sentence order at publish, so **Publish works after zero clicks**. Words that
  appear in the answer are pushed silently to the end so the masker cannot spoil it.
- Round 0 uncovers the first `ceil(n/4)` words of the reveal order, minimum 1, free.
- **Pass** costs 1 and uncovers the next word. **Guess** costs 1 and, if wrong, uncovers
  nothing. **A repeat guess is free and refused** — the server holds the normalised tried
  list, so reloading does not buy a retry.
- Uncovering a word uncovers every position holding the same word, so nobody pays twice for
  "the", and a pass never spends a round on a word that is already showing.
- When everything is showing, Pass is disabled and relabelled *Everything's showing*. The run
  stays open and guessing still costs 1. Running out of words is never a loss.
- **Show the answer** ends the run unsolved, behind a confirm. No score, no board row.
- Score = rounds used at the solve. Equal scores share a rank and sort alphabetically; no
  clock tiebreak, because everyone plays whenever they like. The publisher's own run is
  shown as `author` and never takes a rank.
- Progress is per player, server side, against a token. Names appear only once you finish;
  before that all you see is *N solved, best M*. No accounts, so no anti-cheat.

## Word length is hidden, on all three layers

1. **Server** — `kg_view()` sends literal JSON `null` for a covered word, never the string
   and never a placeholder whose length matches. The answer, the full question and the
   reveal order are absent from every payload until that player has solved it or given up.
2. **DOM** — a blank tile is built with an empty text content, so it holds no text node.
3. **CSS** — `.word.blank{width:62px}`, and `48px` under the 720px breakpoint. Every blank is
   identical, so a masked row is a row of identical squares, not a skyline.

Check it in DevTools → Network → `api.php`: the payload must read
`"words":["Which",null,null,…]`. Search the raw response for the answer: zero hits until the
run ends. In Elements a blank has no text node; in Computed it is `62px` and
`color: rgba(0, 0, 0, 0)`.

## Development and checks

The existing local PHP service already serves `public_html` on port 8793, so files dropped in
`public_html/kurzgesagt/` are live immediately. Do not start a second instance on that port.

```
php -l kurzgesagt/engine.php && php -l kurzgesagt/api.php
php tools/test_kurzgesagt.php        # from public_html; prints a passing count
```

The test file covers reveal-order permutation validation, the round economy, the score at
solve, answer normalisation (accents, punctuation, case, `|` alternatives, both the
`Normalizer` and the fallback path), the duplicate-word rule, end-of-ladder behaviour, and
that an unsolved player's view carries `null` and never the answer or a hidden word.

### Four tabs, four players

`localStorage` is shared per origin, so the player token is namespaced by a slot taken from
an `@N` suffix on the hash: `kurzgesagt:<slot>:player`. `#guess/K7M2QX@2` is a different
human from `#guess/K7M2QX`; default slot is 0. This ships to production ungated, because a
hostname check would mean the identity path tested locally is not the one that runs live.
It is not a security boundary: the server only ever trusts the token, and the slot just picks
which key holds it. Every internal navigation re-appends the suffix through `href()`, and
**Copy link** deliberately builds a slot-free URL.

1. Tab 1: `#write` a question, then `#mask`, click a couple of words, **Publish**. The hash
   flips to `#guess/<id>`.
2. Tabs 2–4: open `#guess/<id>@2`, `@3`, `@4`. All three show Round 0 with the same free
   words. Act in one and the others must not move.
3. `@2`: Pass, then the answer. `@3`: a wrong guess, the same wrong guess again (refused,
   free, counter unmoved), then Pass twice and answer. `@4`: Pass until Pass goes disabled,
   then guess anyway — it must still work.
4. Reload tab 2: still solved. Open `#guess/<id>` with no suffix in tab 1: a fresh Round 0.
   Same browser, different player.
5. With `#mask` open in one tab, submit a question from another. The list must pick it up
   within ~3 seconds without a page reload, without clearing the search box and without
   moving the selection. Backgrounding the tab backs the poll off to ~10 s.

## Publishing safely

Upload only this directory plus `tools/test_kurzgesagt.php`; do not stage the dirty personal
website checkout wholesale. Test the real public API after deployment (`?do=version` is the
cheapest smoke test), confirm `.kurzgesagt-private` exists outside the public root and is not
downloadable, and preserve the existing database file across updates.
