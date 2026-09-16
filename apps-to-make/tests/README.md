# Apps to Make tests

Every drafted idea in `status.json` is covered. `test_coverage.js` fails when a new drafted source path is added without a corresponding test.

## Command-line tests

Run:

```sh
./apps-to-make/tests/run_non_browser_tests.sh
```

This validates the coverage ledger and inline JavaScript, exercises the reading-question parser and history flow, tests the Spaced Omission selection and persistence logic with an Obsidian mock, and compiles/runs C++ timing-engine unit tests.

## Browser tests

Open this page through the personal-site server:

```text
http://127.0.0.1:8793/apps-to-make/tests/browser-tests.html
```

The page automatically runs tailored tests against all 25 HTML drafts in isolated same-origin iframes. It snapshots and restores every `localStorage` key touched by a test. It does not request geolocation, accelerometer, MIDI, or audio permissions; those hardware boundaries still need a short manual smoke test on a compatible device.
