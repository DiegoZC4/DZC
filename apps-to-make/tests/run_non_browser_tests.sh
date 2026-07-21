#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node apps-to-make/tests/test_coverage.js
node apps-to-make/tests/test_spaced_omission.js
PYTHONDONTWRITEBYTECODE=1 python3 apps-to-make/tests/test_reading_questions.py

CXX_BIN="${TMPDIR:-/tmp}/apps-to-make-rhythm-tests"
c++ -std=c++20 -Wall -Wextra -pedantic apps-to-make/tests/test_rhythm_practice.cpp -o "$CXX_BIN"
"$CXX_BIN"

printf '\nNon-browser tests passed. Browser component tests run automatically at:\n'
printf 'http://127.0.0.1:8793/apps-to-make/tests/browser-tests.html\n'
