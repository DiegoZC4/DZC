import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from build_snapshot import SCHEMA, fold, packed_anchors, public_url

HERE = Path(__file__).resolve().parent
PHP = '/opt/homebrew/bin/php'


def fixture(path):
    db = sqlite3.connect(path)
    db.executescript(SCHEMA)
    texts = [
        ('mrgirl', 'mrgirl', 'Your Orgasm Is Not My Responsibility: mrgirl & Shaelin', 'youtube', 'https://www.youtube.com/watch?v=abc12345678', "Préface 😊. My least favorite word is responsibility. It doesn’t mean that."),
        ('yarvin', 'Curtis Yarvin / Moldbug', 'Interview about monarchy', 'rumble', 'https://rumble.com/v123-test.html', 'We discussed monarchy and responsibility.'),
        ('barry-harris', 'Barry Harris', 'Café masterclass', 'youtube', 'https://www.youtube.com/watch?v=barry123456', 'Play the diminished scale. Music is beautiful.'),
        ('youtube', 'Test channel', 'Physics class', 'youtube', 'https://www.youtube.com/watch?v=physics1234', 'Quantum physics is beautiful. There is responsibility.'),
    ]
    for i, (corpus, channel, title, platform, url, text) in enumerate(texts):
        marker = 'My least' if i == 0 else 'responsibility'
        at = text.find(marker)
        anchors, _ = packed_anchors([(0, 0), (max(at, 1), 125.5)], len(text))
        db.execute('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                   (i+1, corpus+':one', corpus, channel, 'Original host', title, fold(title), text, url, platform, anchors, 'test'))
        db.execute('INSERT INTO channels VALUES(?,?,?,?,?,?)', (channel, 'Other', '', '', corpus, 1))
    manifest = {'records':4,'channels':4,'built_at':'2026-11-05T00:00:00Z','collections':{c:{'published':1} for c,*_ in texts}}
    db.execute('INSERT INTO metadata VALUES(?,?)', ('manifest', json.dumps(manifest)))
    db.execute("INSERT INTO records_fts(records_fts) VALUES('rebuild')")
    db.commit(); db.close()


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='transcript-test-')
        self.path = Path(self.temp.name) / 'fixture.sqlite3'
        fixture(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def query(self, q='', title='', channels=None, corpus='', rid='', limit=60, categories=None):
        cmd = 'require $argv[1]; $a=json_decode($argv[2],true); echo json_encode(corpus_search(corpus_db(),...$a));'
        out = subprocess.check_output([PHP, '-r', cmd, str(HERE/'search.php'), json.dumps([q,title,channels or [],corpus,rid,limit,categories or []])],
                env={**os.environ,'TRANSCRIPTS_DB':str(self.path)}, timeout=10)
        return json.loads(out)

    def test_all_collections(self):
        self.assertEqual({x['collection'] for x in self.query('responsibility')['results']}, {'mrgirl','yarvin','youtube'})

    def test_collection_and_channel_filters(self):
        self.assertEqual(len(self.query('responsibility',corpus='mrgirl')['results']), 1)
        self.assertEqual(len(self.query('responsibility',channels=['Test channel'])['results']), 1)
        self.assertFalse(self.query('responsibility',corpus='barry-harris')['results'])

    def test_unicode_character_timestamp(self):
        r = self.query('least favorite')['results'][0]
        self.assertEqual(r['start_seconds'], 125.5)
        self.assertIn('t=125s', r['url'])
        self.assertEqual(next(p['text'] for p in r['snippet_parts'] if p['match']), 'least favorite')

    def test_category_filters(self):
        self.assertEqual(len(self.query('responsibility',categories=['Other'])['results']),3)
        self.assertEqual(len(self.query('responsibility',categories=['Other'],corpus='mrgirl')['results']),1)
        self.assertFalse(self.query('responsibility',categories=['Missing'])['results'])

    def test_apostrophe(self):
        self.assertEqual(len(self.query("doesn't")['results']), 1)

    def test_or(self):
        self.assertEqual(len(self.query('diminished scale OR monarchy')['results']), 2)

    def test_title_scope(self):
        self.assertEqual(len(self.query('responsibility',title='orgasm')['results']), 1)
        self.assertFalse(self.query('monarchy',title='orgasm')['results'])
        self.assertEqual(len(self.query(title='cafe')['results']), 1)

    def test_id_and_limit(self):
        self.assertEqual(len(self.query('responsibility',rid='mrgirl:one')['results']),1)
        self.assertEqual(len(self.query('responsibility',limit=1)['results']),1)
        self.assertTrue(self.query('responsibility',limit=1)['truncated'])

    def test_injection_literal(self):
        self.assertFalse(self.query('" UNION SELECT * --')['results'])
        self.assertFalse(self.query('responsibility',channels=["' OR 1=1 --"])['results'])

    def test_safe_export_url(self):
        self.assertEqual(public_url('https://youtube.com/watch?v=x&token=secret&signature=private'), 'https://youtube.com/watch?v=x')
        with self.assertRaises(ValueError): public_url('file:///private/secret')
        with self.assertRaises(ValueError): public_url('https://u:p@example.com/')

    def test_php_database_is_readonly(self):
        cmd = 'require $argv[1]; try {corpus_db()->exec("CREATE TABLE forbidden(x)"); exit(2);} catch (PDOException $e) {echo "readonly";}'
        out = subprocess.check_output([PHP,'-r',cmd,str(HERE/'search.php')],
                env={**os.environ,'TRANSCRIPTS_DB':str(self.path)}, timeout=10)
        self.assertEqual(out.decode(), 'readonly')


if __name__ == '__main__':
    unittest.main()
