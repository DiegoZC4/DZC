# Nutshell

Three-player, bring-your-own-question party game. No accounts, commercial question deck,
Discord bot, external API, build step, or permanently running game process required.

## Runtime

Serve this directory at `https://diegozc.com/nutshell/` using PHP 8.1+ with
`pdo_sqlite` and `mbstring`. The existing website hosting supports the PHP/SQLite stack.
Only `index.html`, `style.css`, `app.js`, `api.php`, and `engine.php` are required.

The server creates `.nutshell-private/rooms.sqlite3` **beside**, never inside, the
website document root. It fails closed if private storage is not writable or is inside
the public root. `NUTSHELL_DATA_DIR` can point to a different private directory.
Keep that directory out of Git, public downloads, and website backups intended for sharing.

Rooms expire after 24 hours without activity. There is a 300-room bound, IP-bucketed
creation/request limits, and a 10 KB request limit. IP addresses are not saved in the game
database; only time-bucketed hashes are used by the rate limiter. The web host may maintain
its usual access logs independently. Each guest has a random bearer token saved locally
for reconnecting; other players only receive public IDs and names. Invite URLs contain
only the room code, never a player's token. Whoever has the invite can claim an open seat.

## Rules

- Exactly three players; roles rotate writer → guesser → masker → writer per round.
- Defaults: write 60 s, mask 30 s, guess 30 s. Host controls are vertical draggable numbers,
  5–300 s in 5-second steps, with arrows/Page Up/Page Down/Home/End keyboard alternatives.
- Timer changes take effect on the **next round**, not partway through a live countdown.
- The writer supplies 2–40 question words and an answer. The masker sees both and clicks
  the words to leave visible. The guesser sees only those words plus equal-sized blanks.
- Explicit submission advances immediately. On timeout, a saved writer draft advances if
  complete; a saved mask advances if it retains any words; the guesser’s saved draft is
  submitted. Incomplete writing, an empty mask, or an empty guess misses the round.
- The writer or host judges a submitted answer, allowing synonyms. Next round is manual.
- Deadlines are absolute server times. Reloading, backgrounding, or an idle room never
  adds time. Clients poll once per second (2.5 s in background); no scheduled worker needed.
- Guesser API responses contain `null`, not concealed strings, for masked words. The full
  question/answer is never sent to the guesser until the reveal. Content is inserted as text.

## Development and checks

Use the existing local PHP service, or a separate supervised PHP server for an isolated
checkout. Do not start a second instance on the same port.

Run `php tools/test_nutshell.php` from the website repository root for deterministic rules,
timeouts, role permissions, reconnect, and secret-filtering checks. Run
`node tools/test_nutshell_http.mjs http://127.0.0.1:8798/nutshell/` for the three-client API
workflow. Its temporary rooms are removed on completion. No browser UI testing is implied.
`node tools/test_nutshell_controls.mjs` checks the real draggable-number implementation
against pointer and keyboard events without launching a browser.

The optional WebMCP integration is feature-detected and shares the normal authorization
path. No supported WebMCP browser context was available during initial development, so
that optional integration should not be considered browser-verified.

## Publishing safely

Use a fresh detached release worktree from `origin/main`. Publish only this directory and
its three named test files; do not stage the dirty personal-website checkout wholesale. Test
the exact public API after deployment. Preserve the private room database across updates.
Credit/link the original game, but do not redistribute its proprietary questions or art.
