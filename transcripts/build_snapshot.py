#!/usr/bin/env python3
"""Publishable text-only snapshot; authoritative archives are opened read-only.

Build on the external archive, then upload outside the webroot. No audio,
cookies, signed media URLs, local paths, notes or worker state are exported.
Namespaced keys deliberately retain overlapping editions across collections.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import unicodedata
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
import zlib

ARCHIVE = Path('/Volumes/mybook 2tb/Archive/YouTube Channel Transcripts')
CORPORA = [('mrgirl', 'mrgirl', 'Philosophy'),
           ('yarvin', 'Curtis Yarvin / Moldbug', 'Philosophy'),
           ('barry-harris', 'Barry Harris', 'Music')]
SCHEMA = """
CREATE TABLE records (
 id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, corpus TEXT NOT NULL,
 channel TEXT NOT NULL, source_channel TEXT NOT NULL, title TEXT NOT NULL,
 title_fold TEXT NOT NULL, text TEXT NOT NULL, url TEXT NOT NULL,
 platform TEXT NOT NULL, anchors BLOB NOT NULL, transcript_origin TEXT NOT NULL);
CREATE INDEX records_channel ON records(channel);
CREATE INDEX records_corpus ON records(corpus);
CREATE VIRTUAL TABLE records_fts USING fts5(title, text, content='records',
 content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TABLE channels (channel TEXT PRIMARY KEY, category TEXT NOT NULL,
 avatar_url TEXT NOT NULL, url TEXT NOT NULL, corpus TEXT NOT NULL, video_count INTEGER NOT NULL);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text)
                   if not unicodedata.combining(c)).lower().replace('’', "'")


def public_url(url):
    p = urlsplit(url or '')
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('Not a public source-page URL')
    # Only page identity parameters; never carry an access token or signed CDN URL.
    safe = [(k, v) for k, v in parse_qsl(p.query) if k in ('v', 'p', 'id')]
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(safe), ''))


def readonly(path):
    if not path.is_file():
        raise FileNotFoundError(path)
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    db.execute('BEGIN')  # consistent source snapshot, including committed WAL
    return db


def packed_anchors(rows, text_len):
    # Character offsets, not UTF-8 bytes. Keep fractional segment timestamps.
    anchors = sorted({(int(char), max(0., float(seconds))) for char, seconds in rows
                      if 0 <= int(char) <= text_len})
    return sqlite3.Binary(zlib.compress(json.dumps(anchors, separators=(',', ':')).encode(), 6)), len(anchors)


def build(root, output):
    if not os.path.ismount('/Volumes/mybook 2tb'):
        raise RuntimeError('Actual mybook 2tb mount is required')
    if output.exists():
        raise FileExistsError('Refusing to replace a snapshot; choose a new output path')
    output.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(output)
    db.executescript(SCHEMA)
    db.execute('PRAGMA journal_mode=DELETE')
    db.execute('PRAGMA cache_size=-32768')
    manifest = {'format': 1, 'built_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                'audio_published': False, 'cross_collection_deduplication': False,
                'collections': {}, 'timestamp_anchors': 0}
    started = time.monotonic()

    def add(key, corpus, channel, source_channel, title, text, url, platform, rows, origin):
        anchors, count = packed_anchors(rows, len(text))
        if not count:
            raise ValueError('Missing timestamp anchors: ' + key)
        db.execute('INSERT INTO records(key,corpus,channel,source_channel,title,title_fold,text,url,platform,anchors,transcript_origin) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                   (key,corpus,channel,source_channel,title,fold(title),text,public_url(url),platform,anchors,origin))
        manifest['timestamp_anchors'] += count

    src = readonly(root / 'data/transcripts.sqlite3')
    expected = src.execute('SELECT COUNT(*) FROM videos').fetchone()[0]
    n = 0
    for r in src.execute('SELECT v.youtube_id,v.title,v.transcript,c.name FROM videos v JOIN channels c ON c.id=v.channel_id ORDER BY v.youtube_id'):
        if not r['transcript'].strip():
            continue
        vid = r['youtube_id']
        rows = src.execute('SELECT char_index,start_seconds FROM segments WHERE video_id=? ORDER BY char_index', (vid,))
        add('yt:' + vid, 'youtube', r['name'], r['name'], r['title'], r['transcript'],
            'https://www.youtube.com/watch?v=' + vid, 'youtube', rows, 'existing YouTube captions')
        n += 1
        if n % 500 == 0:
            db.commit()
            print(json.dumps({'collection': 'youtube', 'copied': n, 'catalogued': expected}), flush=True)
    manifest['collections']['youtube'] = {'published': n, 'catalogued': expected, 'empty_or_unmatched': expected - n}
    for r in src.execute('SELECT name,category,avatar_url,url FROM channels'):
        count = db.execute('SELECT COUNT(*) FROM records WHERE channel=?', (r['name'],)).fetchone()[0]
        if count:
            db.execute('INSERT INTO channels VALUES(?,?,?,?,?,?)', (r['name'], r['category'] or 'Other', r['avatar_url'] or '', r['url'] or '', 'youtube', count))
    src.close()
    for corpus, label, category in CORPORA:
        src = readonly(root / corpus / 'corpus.sqlite3')
        catalogued = src.execute('SELECT COUNT(*) FROM recordings').fetchone()[0]
        n = empty = 0
        for r in src.execute('SELECT r.id,r.url,r.title,r.channel,r.platform,t.id tid,t.text,t.origin FROM recordings r JOIN transcripts t ON t.recording_id=r.id WHERE t.preferred=1 AND t.complete=1 ORDER BY r.id'):
            if not r['text'].strip():
                empty += 1
                continue
            rows = src.execute('SELECT char_start,start FROM segments WHERE transcript_id=? ORDER BY ordinal', (r['tid'],))
            add(corpus + ':' + r['id'], corpus, label, r['channel'] or '', r['title'], r['text'],
                r['url'], r['platform'], rows, r['origin'])
            n += 1
            if n % 100 == 0:
                db.commit()
                print(json.dumps({'collection': corpus, 'copied': n}), flush=True)
        db.execute('INSERT INTO channels VALUES(?,?,?,?,?,?)', (label, category, '', '', corpus, n))
        manifest['collections'][corpus] = {'published': n, 'catalogued': catalogued,
            'empty_completed': empty, 'without_published_text': catalogued - n}
        src.close()
        db.commit()
    manifest['records'] = db.execute('SELECT COUNT(*) FROM records').fetchone()[0]
    manifest['channels'] = db.execute('SELECT COUNT(*) FROM channels').fetchone()[0]
    print('Building full-text index', flush=True)
    db.execute("INSERT INTO records_fts(records_fts) VALUES('rebuild')")
    db.execute("INSERT INTO records_fts(records_fts) VALUES('optimize')")
    db.execute('INSERT INTO metadata VALUES(?,?)', ('manifest', json.dumps(manifest)))
    db.commit()
    print('Validating snapshot', flush=True)
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    db.execute("INSERT INTO records_fts(records_fts,rank) VALUES('integrity-check',1)")
    db.commit()
    db.close()
    manifest['database_bytes'] = output.stat().st_size
    with output.open('rb') as f:
        manifest['sha256'] = hashlib.file_digest(f, 'sha256').hexdigest()
    manifest['elapsed_seconds'] = round(time.monotonic() - started, 1)
    output.with_suffix('.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest), flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=Path, default=ARCHIVE)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    build(args.root, args.output)
