#!/usr/bin/env python3
"""Read-only interview grouping for search, never media deletion or intake dedup.

Canonical source URLs, substantial identical text, or verified whole-transcript
overlap establish groups. Titles nominate candidates; titles alone never merge.
Short excerpts/compilations are not joined to full interviews by containment.
"""
import argparse
from collections import defaultdict
import datetime as dt
from functools import lru_cache
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit, urlunsplit
import zlib

from build_snapshot import fold, readonly


def words(text):
    return re.findall(r'[^\W_]+', fold(text))


def shingles(tokens):
    return {zlib.crc32(' '.join(tokens[i:i+7]).encode())
            for i in range(max(0, len(tokens)-6))}


def source_identity(url):
    p = urlsplit(url)
    host = (p.hostname or '').lower().removeprefix('www.')
    if host == 'youtu.be':
        return 'youtube:' + p.path.strip('/').split('/')[0]
    if host in ('youtube.com', 'm.youtube.com'):
        vid = parse_qs(p.query).get('v', [''])[0]
        if not vid and p.path.startswith(('/shorts/', '/embed/', '/live/')):
            vid = p.path.split('/')[2]
        if vid:
            return 'youtube:' + vid
    return urlunsplit(('https', host, p.path.rstrip('/'), p.query, ''))


def text_evidence(a, b, same_title=False):
    wa, wb = words(a), words(b)
    sa, sb = shingles(wa), shingles(wb)
    if min(len(wa), len(wb)) < 200 or min(len(sa), len(sb)) < 100:
        return None
    common = len(sa & sb)
    ca, cb = common / len(sa), common / len(sb)
    length_ratio = min(len(wa), len(wb)) / max(len(wa), len(wb))
    threshold = .65 if same_title else .85
    if min(ca, cb) >= threshold and length_ratio >= .85:
        return {'reason': 'same-title-and-content' if same_title else 'whole-transcript-overlap',
                'coverage_a': round(ca, 5), 'coverage_b': round(cb, 5),
                'word_count_a': len(wa), 'word_count_b': len(wb)}
    return None


def compatible_titles(a, b):
    """Transcript reuse can also be bad source data; reject conflicting metadata.

    In particular, identical captions are NOT enough to merge Part 1/Part 2,
    different episode numbers/dates, or unrelated titles. Ambiguity stays visible.
    """
    a, b = fold(a), fold(b)
    for pattern in (r'\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b',
                    r'\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b',
                    r'(?:\bpart\s+)(\d+|[ivx]+)\b',
                    r'(?:#|\bepisode\s*|\bep\.?\s*)(\d+)\b'):
        na, nb = set(re.findall(pattern, a)), set(re.findall(pattern, b))
        if na and nb and na != nb:
            return False
    wa, wb = set(words(a)), set(words(b))
    if not wa or not wb:
        return False
    return len(wa & wb) / len(wa | wb) >= .5


def build(snapshot, output, audit_path):
    if not os.path.ismount('/Volumes/mybook 2tb'):
        raise RuntimeError('Actual external archive mount required')
    db = readonly(snapshot)
    manifest = json.loads(db.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
    rows = {}
    sketches = {}
    parent = {}
    evidence = []
    ambiguous = []
    by_url, by_digest, by_title = defaultdict(list), defaultdict(list), defaultdict(list)

    def root(key):
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    def join(a, b, receipt):
        ra, rb = root(a), root(b)
        if ra != rb:
            if receipt['reason'] != 'same-canonical-source' and not compatible_titles(rows[a]['title'], rows[b]['title']):
                ambiguous.append({'a': a, 'b': b, **receipt, 'disposition': 'kept separate: conflicting or ambiguous titles'})
                return
            parent[rb] = ra
            evidence.append({'a': a, 'b': b, **receipt})

    for n, row in enumerate(db.execute('SELECT id,key,corpus,channel,source_channel,title,title_fold,url,platform,text FROM records ORDER BY id'), 1):
        r = dict(row)
        text = r.pop('text')
        tokens = words(text)
        title_key = ' '.join(words(r['title']))
        r['word_count'] = len(tokens)
        rows[r['key']] = r
        parent[r['key']] = r['key']
        by_url[source_identity(r['url'])].append(r['key'])
        if len(tokens) >= 200:
            hs = shingles(tokens)
            if len(hs) >= 100:
                digest = hashlib.sha256(' '.join(tokens).encode()).hexdigest()
                by_digest[digest].append(r['key'])
                sketch = [2**32] * 64
                for h in hs:
                    bucket = h & 63
                    if h < sketch[bucket]:
                        sketch[bucket] = h
                sketches[r['key']] = sketch
                if len(title_key) >= 24 and len(title_key.split()) >= 4:
                    by_title[title_key].append(r['key'])
        if n % 1000 == 0:
            print(json.dumps({'fingerprinted': n, 'total': manifest['records']}), flush=True)

    for keys in by_url.values():
        for key in keys[1:]:
            join(keys[0], key, {'reason': 'same-canonical-source'})
    for keys in by_digest.values():
        for key in keys[1:]:
            join(keys[0], key, {'reason': 'identical-substantial-transcript'})

    pairs = set()
    for keys in by_title.values():
        if len(keys) <= 80:
            pairs.update(itertools.combinations(sorted(keys), 2))
    # LSH nominates pairs; exact full-shingle coverage decides, never a title or
    # probabilistic sketch alone. Ignore ubiquitous boilerplate bands.
    bands = defaultdict(list)
    for key, sketch in sketches.items():
        for band in range(16):
            sig = (band, *sketch[4*band:4*band+4])
            bands[sig].append(key)
    for keys in bands.values():
        if 1 < len(keys) <= 80:
            pairs.update(itertools.combinations(sorted(keys), 2))
    del bands

    @lru_cache(maxsize=8)
    def transcript(key):
        return db.execute('SELECT text FROM records WHERE key=?', (key,)).fetchone()[0]

    considered = 0
    for a, b in sorted(pairs):
        if root(a) == root(b):
            continue
        same_title = words(rows[a]['title']) == words(rows[b]['title'])
        approx = sum(x == y for x, y in zip(sketches[a], sketches[b])) / 64
        if not same_title and approx < .65:
            continue
        considered += 1
        receipt = text_evidence(transcript(a), transcript(b), same_title)
        if receipt:
            join(a, b, receipt)
    grouped = defaultdict(list)
    for key in rows:
        grouped[root(key)].append(key)

    platform_order = {'youtube': 0, 'odysee': 1, 'vimeo': 1, 'rumble': 2, 'substack': 3, 'twitch': 4}
    groups = []
    for keys in grouped.values():
        if len(keys) < 2:
            continue
        keys.sort(key=lambda k: (platform_order.get(rows[k]['platform'], 8), -rows[k]['word_count'], k))
        members = [{name: rows[k][name] for name in ('key','corpus','channel','source_channel','title','url','platform')}
                   for k in keys]
        gid = 'interview:' + hashlib.sha256('\n'.join(sorted(keys)).encode()).hexdigest()[:20]
        groups.append({'id': gid, 'members': members})
    result = {'format': 1, 'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'snapshot': {'built_at': manifest['built_at'], 'records': manifest['records']},
              'policy': 'Search grouping only; all media, transcripts and source timelines retained. No title-only or partial-containment merging. Conflicting dates/episode numbers and ambiguous titles stay separate.',
              'unique_interviews': manifest['records'] - sum(len(g['members'])-1 for g in groups),
              'groups': groups}
    output.parent.mkdir(parents=True, exist_ok=True)
    pending = output.with_suffix(output.suffix + '.tmp')
    pending.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    pending.replace(output)
    audit_path.write_text(json.dumps({'snapshot': result['snapshot'], 'groups': len(groups),
                          'unique_interviews': result['unique_interviews'], 'verified_candidate_pairs': considered,
                          'evidence': evidence, 'kept_separate': ambiguous}, indent=2, ensure_ascii=False) + '\n')
    db.close()
    print(json.dumps({'groups': len(groups), 'unique_interviews': result['unique_interviews'],
                      'source_recordings': manifest['records'], 'verified_pairs': considered}), flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--snapshot', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--audit', required=True, type=Path)
    a = p.parse_args()
    build(a.snapshot, a.output, a.audit)
