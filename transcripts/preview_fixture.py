"""Disposable four-record preview for interaction tests during a large export."""
import os
from pathlib import Path
import subprocess
import tempfile
from test_search import fixture, PHP, HERE

with tempfile.TemporaryDirectory(prefix='transcript-preview-') as directory:
    path = Path(directory) / 'fixture.sqlite3'
    fixture(path)
    print('Fixture-only preview: http://127.0.0.1:8896/transcripts/', flush=True)
    subprocess.run([PHP, '-S', '127.0.0.1:8896', '-t', str(HERE.parent)],
        env={**os.environ, 'TRANSCRIPTS_DB':str(path)}, check=True)
