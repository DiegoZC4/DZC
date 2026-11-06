#!/usr/bin/env python3
"""Compare deployed searches and timestamp links with the exact local snapshot."""
import argparse
import datetime as dt
import json
from pathlib import Path
import sqlite3
import urllib.parse
import urllib.request
import zlib


def verify(url, snapshot):
    db = sqlite3.connect(snapshot.as_uri() + '?mode=ro', uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    manifest = json.loads(db.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])

    def api(**params):
        req = urllib.request.Request(url.rstrip('/') + '/api.php?' + urllib.parse.urlencode(params),
                                     headers={'User-Agent':'DiegoTranscriptVerification/1.0'})
        with urllib.request.urlopen(req, timeout=45) as r:
            assert r.status == 200
            payload = json.load(r)
        assert payload.get('ok'), payload
        return payload

    status = api(action='status')
    assert status['manifest'] == manifest, 'Publication manifest mismatch'
    assert status['stats']['videos'] == db.execute('SELECT COUNT(*) FROM records').fetchone()[0]
    assert sum(c['video_count'] for c in status['channels']) == manifest['records']
    receipts = []
    for corpus, query in [('mrgirl','responsibility'),('yarvin','monarchy'),('barry-harris','diminished'),('youtube','physics')]:
        found = api(action='search', collection=corpus, q=query, limit=8)
        assert found['results'], (corpus, 'no results')
        assert all(r['collection'] == corpus for r in found['results'])
        for r in found['results']:
            row = db.execute('SELECT * FROM records WHERE key=?', (r['recording_id'],)).fetchone()
            assert row and row['title'] == r['title'] and row['corpus'] == corpus
            assert r['snippet_parts'] and any(p['match'] for p in r['snippet_parts'])
            anchors = json.loads(zlib.decompress(row['anchors']))
            assert any(abs(a[1] - r['start_seconds']) < 0.001 for a in anchors), 'Timestamp not in source anchors'
            assert urllib.parse.urlsplit(r['url']).hostname == urllib.parse.urlsplit(row['url']).hostname
            assert '/Users/' not in json.dumps(r) and 'direct_audio' not in r
        receipts.append({'collection':corpus, 'query':query, 'matches':len(found['results']),
                         'sample_id':found['results'][0]['recording_id'], 'sample_url':found['results'][0]['url'],
                         'search_ms':found['timing']['total_ms']})
    title = api(action='search',collection='mrgirl',q='responsibility',title_filter='Your Orgasm')
    assert title['results'] and all('your orgasm' in r['title'].lower() for r in title['results'])
    alternatives = api(action='search',q='Hermione OR Emma Watson',collection='mrgirl')
    assert alternatives['results']
    report = {'verified_at':dt.datetime.now(dt.timezone.utc).isoformat(), 'url':url,
              'records':manifest['records'], 'channels':manifest['channels'], 'collections':receipts,
              'title_filter_matches':len(title['results']), 'or_matches':len(alternatives['results'])}
    db.close()
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--url', required=True)
    p.add_argument('--snapshot', type=Path, required=True)
    p.add_argument('--report', type=Path)
    a = p.parse_args()
    report = verify(a.url, a.snapshot)
    text = json.dumps(report, indent=2) + '\n'
    if a.report: a.report.write_text(text)
    print(text)
