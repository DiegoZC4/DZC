"""Add the compact filter index to this publication only, retaining its receipt.

The initial November 5 build passed full SQLite/FTS integrity before this index
was introduced. Future builds include it in SCHEMA. This never opens a source
archive for writing; production must recheck integrity after upload.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

path = Path(sys.argv[1]).resolve()
root = Path('/Volumes/mybook 2tb/Archive/YouTube Channel Transcripts/publication').resolve()
if path.parent != root or not os.path.ismount('/Volumes/mybook 2tb'):
    raise RuntimeError('Only the mounted, separate publication directory is allowed')
receipt_path = path.with_suffix('.manifest.json')
receipt = json.loads(receipt_path.read_text())
with path.open('rb') as stream:
    before = hashlib.file_digest(stream, 'sha256').hexdigest()
assert before == receipt['sha256'], 'Snapshot changed since its integrity receipt'
db = sqlite3.connect(path)
db.execute('CREATE INDEX IF NOT EXISTS records_filter_metadata ON records(corpus,title_fold,channel,key)')
db.commit()
assert db.execute('SELECT COUNT(*) FROM records INDEXED BY records_filter_metadata').fetchone()[0] == receipt['records']
assert [r[2] for r in db.execute('PRAGMA index_info(records_filter_metadata)')] == ['corpus','title_fold','channel','key']
db.close()
receipt['pre_filter_index_sha256'] = before
receipt['metadata_filter_index_added_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
receipt['database_bytes'] = path.stat().st_size
with path.open('rb') as stream:
    receipt['sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt), flush=True)
