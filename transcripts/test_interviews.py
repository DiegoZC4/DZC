import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

from build_interviews import compatible_titles, source_identity, text_evidence
from build_snapshot import fold, packed_anchors
from test_search import HERE, PHP, fixture


class InterviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='interview-test-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'fixture.sqlite3'
        fixture(self.path)
        self.groups = Path(self.temp.name) / 'groups.json'
        # Two editions with separate native timelines, and a separate episode
        # deliberately sharing the same title. No title-only grouping is safe.
        text = 'The beginning of this answer sets out the detailed context. We discussed monarchy and responsibility. The explanation continues with a whole range of reasons and substantial evidence.'
        with sqlite3.connect(self.path) as db:
            for rid, key, platform, url, seconds, content in [
                (2, 'yarvin:one', 'rumble', 'https://rumble.com/v123-test.html', 125.5, text),
                (5, 'youtube:edition', 'youtube', 'https://www.youtube.com/watch?v=edition1234', 140.5, text),
                (6, 'yarvin:different', 'podcast', 'https://example.com/episode2', 33, 'A completely different interview with unrelated statements about monarchy.')]:
                anchors, _ = packed_anchors([(0, seconds)], len(content))
                db.execute('INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                    (rid, key, 'youtube' if rid == 5 else 'yarvin', 'Test channel' if rid == 5 else 'Curtis Yarvin / Moldbug',
                     'Original host', 'Interview about monarchy', fold('Interview about monarchy'), content, url, platform, anchors, 'test'))
            db.execute("INSERT INTO records_fts(records_fts) VALUES('rebuild')")
            members = [dict(zip(['key','corpus','channel','source_channel','title','url','platform'], row))
                       for row in db.execute('SELECT key,corpus,channel,source_channel,title,url,platform FROM records WHERE id IN (2,5)')]
            # Fixture manifest stays deliberately fixed; the file is bound to it.
        self.groups.write_text(json.dumps({'format':1, 'snapshot':{'records':4,'built_at':'2026-11-05T00:00:00Z'},
            'unique_interviews':5, 'groups':[{'id':'interview:test','members':members}]}))

    def query(self, q='', title='', channels=None, corpus='', rid='', limit=60, categories=None):
        cmd = 'require $argv[1]; $a=json_decode($argv[2],true); echo json_encode(corpus_search(corpus_db(),...$a));'
        out = subprocess.check_output([PHP, '-r', cmd, str(HERE/'search.php'), json.dumps([q,title,channels or [],corpus,rid,limit,categories or []])],
            env={**os.environ, 'TRANSCRIPTS_DB':str(self.path), 'TRANSCRIPTS_INTERVIEWS':str(self.groups)}, timeout=10)
        return json.loads(out)

    def test_title_dedup_keeps_different_episode(self):
        results = self.query(title='monarchy')['results']
        self.assertEqual(len(results), 2)
        self.assertEqual(len({r['interview_id'] for r in results}), 2)
        same = next(r for r in results if r['interview_id'] == 'interview:test')
        self.assertEqual(same['platform'], 'youtube')
        self.assertEqual(len(same['source_versions']), 2)

    def test_passage_dedup_preserves_native_times(self):
        results = self.query('responsibility', title='monarchy')['results']
        self.assertEqual(len(results), 1)
        item = results[0]
        self.assertEqual(item['platform'], 'youtube')
        self.assertEqual(item['start_seconds'], 140.5)
        self.assertIn('t=140s', item['url'])
        self.assertEqual({s['start_seconds'] for s in item['matched_sources']}, {125.5, 140.5})
        self.assertTrue(any('start=125' in s['url'] for s in item['matched_sources']))

    def test_title_dedup_before_limit(self):
        result = self.query(title='monarchy', limit=2)
        self.assertEqual(len(result['results']), 2)
        self.assertFalse(result['truncated'])

    def test_group_does_not_override_scope(self):
        item = self.query('responsibility', title='monarchy', corpus='yarvin')['results'][0]
        self.assertEqual(item['recording_id'], 'yarvin:one')
        self.assertEqual(item['start_seconds'], 125.5)

    def test_unique_alternate_passage_remains_searchable(self):
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE records SET text=text || ' A unique extended answer about marmalade.' WHERE id=2")
            db.execute("INSERT INTO records_fts(records_fts) VALUES('rebuild')")
        result = self.query('marmalade')['results']
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['recording_id'], 'yarvin:one')
        self.assertEqual(result[0]['interview_id'], 'interview:test')

    def test_repeated_occurrences_in_same_source_are_kept(self):
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE records SET text=text || ? || text WHERE id IN (2,5)", (' silent context ' * 50,))
            db.execute("INSERT INTO records_fts(records_fts) VALUES('rebuild')")
        results = self.query('responsibility', title='monarchy')['results']
        self.assertEqual(len(results), 2)
        self.assertEqual(len({r['interview_id'] for r in results}), 1)

    def test_stale_group_file_is_ignored(self):
        groups = json.loads(self.groups.read_text())
        groups['snapshot']['records'] = 999
        self.groups.write_text(json.dumps(groups))
        self.assertEqual(len(self.query(title='monarchy')['results']), 3)


class EvidenceTests(unittest.TestCase):
    def test_conflicting_episode_metadata_stays_separate(self):
        self.assertFalse(compatible_titles('Binary, Hanoi and Sierpinski, part 1', 'Binary, Hanoi, and Sierpinski, part 2'))
        self.assertFalse(compatible_titles('Monday Morning Podcast 4-23-20', 'Monday Morning Podcast 2-20-20'))
        self.assertFalse(compatible_titles('Guest interview #71', 'Guest interview #72'))
        self.assertFalse(compatible_titles('Penn Jillette on Placebo Prayer', 'Penn Jillette on raising children'))
        self.assertTrue(compatible_titles('What happens if we lose? - Curtis Yarvin, Ron Dodson | #71', 'What happens if we lose? - Curtis Yarvin, Ron Dodson | #71'))

    def test_canonical_url(self):
        self.assertEqual(source_identity('https://youtu.be/abcdefghijk?t=125'), source_identity('https://www.youtube.com/watch?v=abcdefghijk'))

    def test_content_not_title_is_required(self):
        a = ' '.join(f'alpha{i} beta{i} gamma{i}' for i in range(200))
        b = ' '.join(f'delta{i} epsilon{i} zeta{i}' for i in range(200))
        self.assertIsNone(text_evidence(a, b, same_title=True))
        self.assertIsNotNone(text_evidence(a, a, same_title=True))
        self.assertIsNone(text_evidence(a, ' '.join(a.split()[:220]), same_title=True))
        self.assertIsNone(text_evidence('short phrase', 'short phrase', same_title=True))


if __name__ == '__main__':
    unittest.main()
