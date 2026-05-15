<?php
declare(strict_types=1);

const YT_API_VERSION = '1';
const YT_DEFAULT_SOURCE_DIR = '/Users/diego/Desktop/Read/YouTube Channel Transcripts';
const YT_SNIPPET_CONTEXT_CHARS = 120;
const YT_IMPORT_TRANSACTION_BATCH_SIZE = 25;

function yt_data_dir(): string
{
    return __DIR__ . '/data';
}

function yt_db_path(): string
{
    return yt_data_dir() . '/transcripts.sqlite3';
}

function yt_db(bool $create = true): PDO
{
    if (!extension_loaded('pdo_sqlite')) {
        throw new RuntimeException('SQLite support is not enabled.');
    }
    if (!$create && !is_file(yt_db_path())) {
        throw new RuntimeException('Transcript database is missing. Upload transcripts.sqlite3 to youtube-transcripts/data/.');
    }
    if (!is_dir(yt_data_dir()) && !mkdir(yt_data_dir(), 0775, true) && !is_dir(yt_data_dir())) {
        throw new RuntimeException('Could not create data directory.');
    }
    $db = new PDO('sqlite:' . yt_db_path(), null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('PRAGMA busy_timeout = 60000');
    if ($create) {
        yt_init_schema($db);
    }
    return $db;
}

function yt_init_schema(PDO $db): void
{
    $db->exec(
        'CREATE TABLE IF NOT EXISTS channels (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            url TEXT NOT NULL DEFAULT \'\',
            avatar_url TEXT NOT NULL DEFAULT \'\',
            category TEXT NOT NULL DEFAULT \'Other\',
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT \'\'
        )'
    );
    $db->exec(
        'CREATE TABLE IF NOT EXISTS videos (
            youtube_id TEXT PRIMARY KEY,
            channel_id INTEGER,
            title TEXT NOT NULL,
            transcript TEXT NOT NULL,
            source_file TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            FOREIGN KEY (channel_id) REFERENCES channels(id)
        )'
    );
    $db->exec(
        'CREATE TABLE IF NOT EXISTS segments (
            video_id TEXT NOT NULL,
            start_seconds INTEGER NOT NULL,
            char_index INTEGER NOT NULL,
            PRIMARY KEY (video_id, start_seconds),
            FOREIGN KEY (video_id) REFERENCES videos(youtube_id) ON DELETE CASCADE
        )'
    );
    $db->exec(
        'CREATE TABLE IF NOT EXISTS channel_stats (
            channel_id INTEGER PRIMARY KEY,
            video_count INTEGER NOT NULL DEFAULT 0,
            runtime_seconds INTEGER NOT NULL DEFAULT 0,
            transcript_chars INTEGER NOT NULL DEFAULT 0,
            payload_bytes INTEGER NOT NULL DEFAULT 0,
            segment_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT \'\',
            FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
        )'
    );
    $db->exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
            youtube_id UNINDEXED,
            channel UNINDEXED,
            title,
            transcript,
            tokenize = 'unicode61'
        )"
    );
    $db->exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS video_titles_fts USING fts5(
            youtube_id UNINDEXED,
            channel UNINDEXED,
            title,
            tokenize = 'trigram'
        )"
    );
    yt_migrate_channel_schema($db);
}

function yt_migrate_channel_schema(PDO $db): void
{
    if (!yt_column_exists($db, 'videos', 'channel_id')) {
        $db->exec('ALTER TABLE videos ADD COLUMN channel_id INTEGER REFERENCES channels(id)');
    }
    yt_seed_channels_from_config($db);
    $hasLegacyChannel = yt_column_exists($db, 'videos', 'channel');
    if ($hasLegacyChannel) {
        $db->exec(
            "INSERT OR IGNORE INTO channels (name, category, updated_at)
             SELECT DISTINCT channel, 'Other', ''
             FROM videos
             WHERE channel IS NOT NULL AND channel <> ''"
        );
    }
    $stmt = $db->query("SELECT id, name, category FROM channels WHERE category = '' OR category = 'Other'");
    while ($row = $stmt->fetch()) {
        $category = yt_channel_category((string)$row['name']);
        if ($category !== (string)$row['category']) {
            $update = $db->prepare('UPDATE channels SET category = ? WHERE id = ?');
            $update->execute([$category, (int)$row['id']]);
        }
    }
    if ($hasLegacyChannel) {
        $db->exec(
            'UPDATE videos
             SET channel_id = (SELECT id FROM channels WHERE channels.name = videos.channel)
             WHERE channel_id IS NULL'
        );
        $missing = (int)$db->query('SELECT COUNT(*) FROM videos WHERE channel_id IS NULL')->fetchColumn();
        if ($missing === 0) {
            $db->exec('ALTER TABLE videos DROP COLUMN channel');
        }
    }
    $db->exec('CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id)');
}

function yt_column_exists(PDO $db, string $table, string $column): bool
{
    $stmt = $db->query('PRAGMA table_info(' . $table . ')');
    while ($row = $stmt->fetch()) {
        if (($row['name'] ?? '') === $column) {
            return true;
        }
    }
    return false;
}

function yt_seed_channels_from_config(PDO $db): void
{
    $configPath = __DIR__ . '/refresh/channels.json';
    if (!is_file($configPath)) {
        return;
    }
    $rows = json_decode((string)file_get_contents($configPath), true);
    if (!is_array($rows)) {
        return;
    }
    foreach ($rows as $row) {
        if (!is_array($row) || trim((string)($row['channel'] ?? '')) === '') {
            continue;
        }
        $name = trim((string)$row['channel']);
        yt_upsert_channel(
            $db,
            $name,
            (string)($row['url'] ?? ''),
            (string)($row['avatar_url'] ?? ''),
            yt_channel_category($name),
            (bool)($row['enabled'] ?? true)
        );
    }
}

function yt_import_dir(PDO $db, string $sourceDir, bool $rebuild = false, int $limitFiles = 0, bool $skipExisting = false, int $segmentIntervalSeconds = 0, bool $deferFts = false): array
{
    if (!is_dir($sourceDir)) {
        throw new InvalidArgumentException('Transcript source directory not found.');
    }
    if ($rebuild) {
        $db->exec('DELETE FROM videos_fts');
        $db->exec('DELETE FROM video_titles_fts');
        $db->exec('DELETE FROM segments');
        $db->exec('DELETE FROM videos');
    }
    $files = glob(rtrim($sourceDir, '/') . '/*.md');
    sort($files);
    if ($limitFiles > 0) {
        $files = array_slice($files, 0, $limitFiles);
    }
    $stats = ['files' => 0, 'videos' => 0, 'segments' => 0, 'skipped' => 0];
    foreach ($files as $file) {
        $channel = yt_channel_from_filename((string)$file);
        $fileStats = yt_import_file($db, (string)$file, $channel, $skipExisting, $segmentIntervalSeconds, $deferFts);
        $stats['files']++;
        $stats['videos'] += $fileStats['videos'];
        $stats['segments'] += $fileStats['segments'];
        $stats['skipped'] += $fileStats['skipped'];
    }
    return $stats;
}

function yt_channel_from_filename(string $file): string
{
    $name = pathinfo($file, PATHINFO_FILENAME);
    $name = preg_replace('/\s*-\s*Videos\s*-\s*Transcripts$/i', '', $name);
    $name = preg_replace('/\s*-\s*Transcripts$/i', '', (string)$name);
    $name = preg_replace('/^\[Complete\]\s*/i', '', (string)$name);
    return trim((string)$name) ?: 'Unknown Channel';
}

function yt_import_file(PDO $db, string $file, string $channel, bool $skipExisting = false, int $segmentIntervalSeconds = 0, bool $deferFts = false): array
{
    $handle = fopen($file, 'rb');
    if ($handle === false) {
        throw new RuntimeException('Could not open transcript file: ' . $file);
    }

    $stats = ['videos' => 0, 'segments' => 0, 'skipped' => 0];
    $video = null;
    $cueStart = null;
    $cueText = [];
    $existingStmt = $skipExisting ? $db->prepare('SELECT 1 FROM videos WHERE youtube_id = ? LIMIT 1') : null;
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) {
        $db->beginTransaction();
    }

    $flushCue = static function () use (&$video, &$cueStart, &$cueText, $segmentIntervalSeconds): void {
        if ($video === null || $cueStart === null || !$cueText) {
            $cueStart = null;
            $cueText = [];
            return;
        }
        $text = trim(preg_replace('/\s+/', ' ', implode(' ', $cueText)) ?? '');
        if ($text === '') {
            $cueStart = null;
            $cueText = [];
            return;
        }
        if ($video['transcript'] !== '') {
            $video['transcript'] .= ' ';
        }
        $charIndex = strlen($video['transcript']);
        $lastSegmentSeconds = $video['last_segment_seconds'];
        if ($segmentIntervalSeconds <= 0 || $lastSegmentSeconds === null || $cueStart >= $lastSegmentSeconds + $segmentIntervalSeconds) {
            $video['segments'][] = [
                'start_seconds' => $cueStart,
                'char_index' => $charIndex,
            ];
            $video['last_segment_seconds'] = $cueStart;
        }
        $video['transcript'] .= $text;
        $cueStart = null;
        $cueText = [];
    };

    $flushVideo = function () use (&$video, &$stats, $db, $file, $channel, $flushCue, $ownsTransaction, $skipExisting, $existingStmt, $deferFts): void {
        $flushCue();
        if ($video === null || trim($video['transcript']) === '') {
            $video = null;
            return;
        }
        if ($skipExisting && $existingStmt !== null) {
            $existingStmt->execute([$video['youtube_id']]);
            if ($existingStmt->fetchColumn()) {
                $stats['skipped']++;
                $video = null;
                return;
            }
        }
        yt_save_video($db, $video['youtube_id'], $channel, $video['title'], $video['transcript'], $file, $video['segments'], $deferFts);
        $stats['videos']++;
        $stats['segments'] += count($video['segments']);
        $video = null;
        if ($ownsTransaction && $db->inTransaction() && $stats['videos'] % YT_IMPORT_TRANSACTION_BATCH_SIZE === 0) {
            $db->commit();
            $db->beginTransaction();
        }
    };

    try {
        while (($line = fgets($handle)) !== false) {
            $line = rtrim($line, "\r\n");
            if (preg_match('/^#\s+(.+)\s+\(([A-Za-z0-9_-]{11})\)\s*$/', $line, $m)) {
                $flushVideo();
                if ($skipExisting && $existingStmt !== null) {
                    $existingStmt->execute([$m[2]]);
                    if ($existingStmt->fetchColumn()) {
                        $stats['skipped']++;
                        $video = null;
                        $cueStart = null;
                        $cueText = [];
                        continue;
                    }
                }
                $video = [
                    'youtube_id' => $m[2],
                    'title' => trim($m[1]),
                    'transcript' => '',
                    'segments' => [],
                    'last_segment_seconds' => null,
                ];
                continue;
            }
            if ($video === null) {
                continue;
            }
            if (preg_match('/^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+/', $line, $m)) {
                $flushCue();
                $cueStart = yt_time_to_seconds($m[1]);
                continue;
            }
            if (trim($line) === '') {
                $flushCue();
                continue;
            }
            if ($cueStart !== null && !preg_match('/^\d+$/', trim($line))) {
                $cueText[] = $line;
            }
        }
        $flushVideo();
        if ($ownsTransaction) {
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($ownsTransaction && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    } finally {
        fclose($handle);
    }
    return $stats;
}

function yt_time_to_seconds(string $time): int
{
    if (!preg_match('/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/', $time, $m)) {
        return 0;
    }
    return ((int)$m[1] * 3600) + ((int)$m[2] * 60) + (int)$m[3];
}

function yt_upsert_channel(PDO $db, string $name, string $url = '', string $avatarUrl = '', string $category = '', bool $enabled = true): int
{
    $name = trim($name);
    if ($name === '') {
        throw new InvalidArgumentException('Channel name is required.');
    }
    $category = $category !== '' ? $category : yt_channel_category($name);
    $stmt = $db->prepare(
        'INSERT INTO channels (name, url, avatar_url, category, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
            url = CASE WHEN excluded.url <> \'\' THEN excluded.url ELSE channels.url END,
            avatar_url = CASE WHEN excluded.avatar_url <> \'\' THEN excluded.avatar_url ELSE channels.avatar_url END,
            category = CASE WHEN excluded.category <> \'\' THEN excluded.category ELSE channels.category END,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at'
    );
    $stmt->execute([$name, $url, $avatarUrl, $category, $enabled ? 1 : 0, gmdate('c')]);
    $id = $db->prepare('SELECT id FROM channels WHERE name = ?');
    $id->execute([$name]);
    return (int)$id->fetchColumn();
}

function yt_save_video(PDO $db, string $youtubeId, string $channel, string $title, string $transcript, string $sourceFile, array $segments, bool $deferFts = false): void
{
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) {
        $db->beginTransaction();
    }
    try {
        $channelId = yt_upsert_channel($db, $channel);
        $stmt = $db->prepare(
            'INSERT INTO videos (youtube_id, channel_id, title, transcript, source_file, imported_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(youtube_id) DO UPDATE SET
                channel_id = excluded.channel_id,
                title = excluded.title,
                transcript = excluded.transcript,
                source_file = excluded.source_file,
                imported_at = excluded.imported_at'
        );
        $stmt->execute([$youtubeId, $channelId, $title, $transcript, $sourceFile, gmdate('c')]);
        $db->prepare('DELETE FROM segments WHERE video_id = ?')->execute([$youtubeId]);
        foreach (array_chunk($segments, 500) as $chunk) {
            $placeholders = [];
            $params = [];
            foreach ($chunk as $segment) {
                $placeholders[] = '(?, ?, ?)';
                $params[] = $youtubeId;
                $params[] = $segment['start_seconds'];
                $params[] = $segment['char_index'];
            }
            if ($placeholders) {
                $db->prepare('INSERT OR IGNORE INTO segments (video_id, start_seconds, char_index) VALUES ' . implode(', ', $placeholders))
                    ->execute($params);
            }
        }
        if (!$deferFts) {
            $db->prepare('DELETE FROM videos_fts WHERE youtube_id = ?')->execute([$youtubeId]);
            $db->prepare('INSERT INTO videos_fts (youtube_id, channel, title, transcript) VALUES (?, ?, ?, ?)')
                ->execute([$youtubeId, $channel, $title, $transcript]);
        }
        $db->prepare('DELETE FROM video_titles_fts WHERE youtube_id = ?')->execute([$youtubeId]);
        $db->prepare('INSERT INTO video_titles_fts (youtube_id, channel, title) VALUES (?, ?, ?)')
            ->execute([$youtubeId, $channel, $title]);
        if ($ownsTransaction) {
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($ownsTransaction && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function yt_channels(PDO $db): array
{
    $stmt = $db->query(
        'SELECT
            c.id,
            c.name AS channel,
            c.url,
            c.avatar_url,
            c.category,
            c.enabled,
            COUNT(v.youtube_id) AS video_count
         FROM channels c
         JOIN videos v ON v.channel_id = c.id
         GROUP BY c.id
         ORDER BY c.name COLLATE NOCASE'
    );
    $channels = $stmt->fetchAll();
    foreach ($channels as &$row) {
        if (($row['category'] ?? '') === '') {
            $row['category'] = yt_channel_category((string)$row['channel']);
        }
        $row['id'] = (int)$row['id'];
        $row['video_count'] = (int)$row['video_count'];
        $row['enabled'] = (bool)$row['enabled'];
    }
    return $channels;
}

function yt_channel_category(string $channel): string
{
    static $categories = [
        '80,000 Hours' => 'AI',
        '3Blue1Brown' => 'Math',
        '12tone' => 'Music',
        'Adam Neely' => 'Music',
        'Adam Ragusea' => 'Food',
        'BarryHarrisVideos' => 'Music',
        'Binging with Babish' => 'Food',
        'Bill Burr' => 'Comedy',
        'Bret Weinstein' => 'Philosophy',
        'BroScienceLife' => 'Comedy',
        'Cape Falcon Kayak' => 'Engineering',
        'Destiny' => 'Philosophy',
        'Dwarkesh Patel' => 'AI',
        'Ear Biscuits' => 'Comedy',
        'Eric Weinstein' => 'Philosophy',
        'Henry Segerman' => 'Math',
        'Robert Sapolsky' => 'Science',
        'Jacob Collier' => 'Music',
        'Jake and Amir' => 'Comedy',
        'JennaMarbles' => 'Comedy',
        'Jordan B Peterson' => 'Philosophy',
        'Jonathan Pageau' => 'Philosophy',
        'June Lee' => 'Music',
        'Key & Peele' => 'Comedy',
        'Lex Fridman' => 'AI',
        'Mathologer' => 'Math',
        'Numberphile' => 'Math',
        'Peter Attia MD' => 'Health',
        'Practical Engineering' => 'Engineering',
        'Rick & Esther Have A Time' => 'Comedy',
        'Rick Beato' => 'Music',
        'Rick Glassman' => 'Comedy',
        'Robert Miles AI Safety' => 'AI',
        'Sam Harris' => 'Philosophy',
        'SmarterEveryDay' => 'Science',
        'Starting Strength' => 'Fitness',
        'Stand-up Maths' => 'Math',
        'Steve Mould' => 'Engineering',
        'Supergood' => 'Comedy',
        'Tech Ingredients' => 'Engineering',
        'Technology Connections' => 'Engineering',
        'The Fighter and The Kid' => 'Comedy',
        'The Tim Dillon Show' => 'Comedy',
        'Theo Von' => 'Comedy',
        'TigerBelly' => 'Comedy',
        'Veritasium' => 'Science',
    ];
    return $categories[$channel] ?? 'Other';
}

function yt_search(PDO $db, string $query, array|string $channel = '', int $limit = 50, string $videoId = '', string $titleFilter = '', ?array &$timings = null): array
{
    $started = microtime(true);
    $query = trim(preg_replace('/\s+/', ' ', $query) ?? '');
    if ($query === '') {
        $timings = ['total_ms' => 0.0, 'sqlite_ms' => 0.0, 'snippet_ms' => 0.0, 'candidate_videos' => 0];
        return [];
    }
    $limit = max(1, min(200, $limit));
    $match = yt_fts_query($query);
    if ($match === '') {
        return [];
    }

    $sql = 'SELECT v.youtube_id, c.name AS channel, v.title, v.transcript
            FROM videos_fts
            JOIN videos v ON v.youtube_id = videos_fts.youtube_id
            JOIN channels c ON c.id = v.channel_id
            WHERE videos_fts MATCH :match';
    $params = [':match' => $match];
    $channels = yt_normalize_channels($channel);
    if ($channels) {
        $placeholders = [];
        foreach ($channels as $index => $channelName) {
            $key = ':channel_' . $index;
            $placeholders[] = $key;
            $params[$key] = $channelName;
        }
        $sql .= ' AND c.name IN (' . implode(', ', $placeholders) . ')';
    }
    if ($videoId !== '') {
        $sql .= ' AND v.youtube_id = :video_id';
        $params[':video_id'] = $videoId;
    }
    $titleFilter = trim(preg_replace('/\s+/', ' ', $titleFilter) ?? '');
    if ($titleFilter !== '') {
        $sql .= " AND v.title LIKE :title_filter ESCAPE '\\'";
        $params[':title_filter'] = '%' . yt_like_escape($titleFilter) . '%';
    }
    $sql .= ' ORDER BY rank LIMIT 200';
    $sqliteStarted = microtime(true);
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $sqliteMs = (microtime(true) - $sqliteStarted) * 1000;

    $results = [];
    $candidateVideos = 0;
    $snippetStarted = microtime(true);
    while (($row = $stmt->fetch()) && count($results) < $limit) {
        $candidateVideos++;
        foreach (yt_group_occurrences(yt_find_occurrences((string)$row['transcript'], $query)) as $group) {
            $firstMatch = $group[0];
            $seconds = yt_seconds_for_char_index($db, (string)$row['youtube_id'], (int)$firstMatch['offset']);
            $snippet = yt_snippet((string)$row['transcript'], $group);
            $results[] = [
                'youtube_id' => $row['youtube_id'],
                'channel' => $row['channel'],
                'title' => $row['title'],
                'start_seconds' => $seconds,
                'timestamp' => yt_format_timestamp($seconds),
                'url' => 'https://www.youtube.com/watch?v=' . rawurlencode((string)$row['youtube_id']) . '&t=' . $seconds . 's',
                'snippet' => $snippet['text'],
                'snippet_parts' => $snippet['parts'],
                'match_count' => count($group),
            ];
            if (count($results) >= $limit) {
                break;
            }
        }
    }
    $snippetMs = (microtime(true) - $snippetStarted) * 1000;
    $timings = [
        'total_ms' => round((microtime(true) - $started) * 1000, 1),
        'sqlite_ms' => round($sqliteMs, 1),
        'snippet_ms' => round($snippetMs, 1),
        'candidate_videos' => $candidateVideos,
    ];
    return $results;
}

function yt_title_search(PDO $db, string $titleFilter, array|string $channel = '', int $limit = 50, ?array &$timings = null): array
{
    $started = microtime(true);
    $titleFilter = trim(preg_replace('/\s+/', ' ', $titleFilter) ?? '');
    if ($titleFilter === '') {
        $timings = ['total_ms' => 0.0, 'sqlite_ms' => 0.0, 'snippet_ms' => 0.0, 'candidate_videos' => 0];
        return [];
    }
    $limit = max(1, min(200, $limit));
    yt_ensure_title_index($db);
    if (strlen($titleFilter) >= 3) {
        $sql = 'SELECT video_titles_fts.youtube_id, c.name AS channel, video_titles_fts.title
                FROM video_titles_fts
                JOIN videos v ON v.youtube_id = video_titles_fts.youtube_id
                JOIN channels c ON c.id = v.channel_id
                WHERE video_titles_fts MATCH :title_match';
        $params = [':title_match' => '"' . str_replace('"', '""', $titleFilter) . '"'];
    } else {
        $sql = 'SELECT video_titles_fts.youtube_id, c.name AS channel, video_titles_fts.title
                FROM video_titles_fts
                JOIN videos v ON v.youtube_id = video_titles_fts.youtube_id
                JOIN channels c ON c.id = v.channel_id
                WHERE video_titles_fts.title LIKE :title_filter ESCAPE \'\\\'';
        $params = [':title_filter' => '%' . yt_like_escape($titleFilter) . '%'];
    }
    $channels = yt_normalize_channels($channel);
    if ($channels) {
        $placeholders = [];
        foreach ($channels as $index => $channelName) {
            $key = ':channel_' . $index;
            $placeholders[] = $key;
            $params[$key] = $channelName;
        }
        $sql .= ' AND c.name IN (' . implode(', ', $placeholders) . ')';
    }
    $sql .= ' ORDER BY video_titles_fts.title COLLATE NOCASE LIMIT :limit';
    $stmt = $db->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, PDO::PARAM_STR);
    }
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $sqliteStarted = microtime(true);
    $stmt->execute();
    $sqliteMs = (microtime(true) - $sqliteStarted) * 1000;

    $results = [];
    while ($row = $stmt->fetch()) {
        $results[] = [
            'youtube_id' => $row['youtube_id'],
            'channel' => $row['channel'],
            'title' => $row['title'],
            'start_seconds' => 0,
            'timestamp' => '0:00',
            'url' => 'https://www.youtube.com/watch?v=' . rawurlencode((string)$row['youtube_id']),
            'snippet' => '',
            'snippet_parts' => [],
            'match_count' => 0,
            'title_only' => true,
        ];
    }
    $timings = [
        'total_ms' => round((microtime(true) - $started) * 1000, 1),
        'sqlite_ms' => round($sqliteMs, 1),
        'snippet_ms' => 0.0,
        'candidate_videos' => count($results),
    ];
    return $results;
}

function yt_ensure_title_index(PDO $db): void
{
    static $checked = false;
    if ($checked) {
        return;
    }
    $db->exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS video_titles_fts USING fts5(
            youtube_id UNINDEXED,
            channel UNINDEXED,
            title,
            tokenize = 'trigram'
        )"
    );
    $hasTitleRows = (bool)$db->query('SELECT 1 FROM video_titles_fts LIMIT 1')->fetchColumn();
    if (!$hasTitleRows) {
        $db->beginTransaction();
        try {
            $db->exec('DELETE FROM video_titles_fts');
            $db->exec(
                'INSERT INTO video_titles_fts (youtube_id, channel, title)
                 SELECT v.youtube_id, c.name, v.title
                 FROM videos v
                 JOIN channels c ON c.id = v.channel_id'
            );
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $e;
        }
    }
    $checked = true;
}

function yt_like_escape(string $value): string
{
    return strtr($value, [
        '\\' => '\\\\',
        '%' => '\\%',
        '_' => '\\_',
    ]);
}

function yt_normalize_channels(array|string $channels): array
{
    if (is_string($channels)) {
        $channels = $channels === '' ? [] : [$channels];
    }
    $clean = [];
    foreach ($channels as $channel) {
        $channel = trim((string)$channel);
        if ($channel !== '') {
            $clean[$channel] = true;
        }
    }
    return array_keys($clean);
}

function yt_fts_query(string $query): string
{
    preg_match_all('/[\p{L}\p{N}_]+/u', $query, $matches);
    $tokens = $matches[0] ?? [];
    if (!$tokens) {
        return '';
    }
    return '"' . str_replace('"', '""', implode(' ', $tokens)) . '"';
}

function yt_find_occurrences(string $transcript, string $query): array
{
    $pattern = preg_quote($query, '/');
    $pattern = preg_replace('/\s+/', '\\s+', $pattern) ?? $pattern;
    if (@preg_match('/' . $pattern . '/iu', '') === false) {
        return [];
    }
    preg_match_all('/' . $pattern . '/iu', $transcript, $matches, PREG_OFFSET_CAPTURE);
    return array_map(
        static fn(array $match): array => [
            'offset' => (int)$match[1],
            'length' => strlen((string)$match[0]),
        ],
        $matches[0] ?? []
    );
}

function yt_group_occurrences(array $occurrences, int $maxGap = YT_SNIPPET_CONTEXT_CHARS): array
{
    if (!$occurrences) {
        return [];
    }
    $groups = [];
    $current = [];
    $previousEnd = null;
    foreach ($occurrences as $occurrence) {
        $offset = (int)$occurrence['offset'];
        $length = max(1, (int)$occurrence['length']);
        if ($previousEnd !== null && $offset - $previousEnd > $maxGap) {
            $groups[] = $current;
            $current = [];
        }
        $current[] = ['offset' => $offset, 'length' => $length];
        $previousEnd = $offset + $length;
    }
    if ($current) {
        $groups[] = $current;
    }
    return $groups;
}

function yt_seconds_for_char_index(PDO $db, string $youtubeId, int $charIndex): int
{
    $stmt = $db->prepare(
        'SELECT start_seconds FROM segments
         WHERE video_id = ? AND char_index <= ?
         ORDER BY char_index DESC
         LIMIT 1'
    );
    $stmt->execute([$youtubeId, $charIndex]);
    $value = $stmt->fetchColumn();
    return $value === false ? 0 : (int)$value;
}

function yt_snippet(string $transcript, array $matches): array
{
    $first = $matches[0];
    $last = $matches[count($matches) - 1];
    $start = max(0, (int)$first['offset'] - YT_SNIPPET_CONTEXT_CHARS);
    $end = min(strlen($transcript), (int)$last['offset'] + max(1, (int)$last['length']) + YT_SNIPPET_CONTEXT_CHARS);
    $parts = [];
    if ($start > 0) {
        $parts[] = ['text' => '...', 'match' => false];
    }
    $cursor = $start;
    foreach ($matches as $match) {
        $offset = max($start, (int)$match['offset']);
        $matchEnd = min($end, (int)$match['offset'] + max(1, (int)$match['length']));
        if ($offset > $cursor) {
            yt_add_snippet_part($parts, substr($transcript, $cursor, $offset - $cursor), false);
        }
        if ($matchEnd > $offset) {
            yt_add_snippet_part($parts, substr($transcript, $offset, $matchEnd - $offset), true);
        }
        $cursor = max($cursor, $matchEnd);
    }
    if ($cursor < $end) {
        yt_add_snippet_part($parts, substr($transcript, $cursor, $end - $cursor), false);
    }
    if ($end < strlen($transcript)) {
        $parts[] = ['text' => '...', 'match' => false];
    }
    return [
        'text' => implode('', array_column($parts, 'text')),
        'parts' => $parts,
    ];
}

function yt_add_snippet_part(array &$parts, string $text, bool $match): void
{
    $text = preg_replace('/\s+/', ' ', $text) ?? $text;
    if ($text === '') {
        return;
    }
    $lastIndex = count($parts) - 1;
    if ($lastIndex >= 0 && ($parts[$lastIndex]['match'] ?? false) === $match) {
        $parts[$lastIndex]['text'] .= $text;
        return;
    }
    $parts[] = ['text' => $text, 'match' => $match];
}

function yt_format_timestamp(int $seconds): string
{
    $hours = intdiv($seconds, 3600);
    $minutes = intdiv($seconds % 3600, 60);
    $secs = $seconds % 60;
    return $hours > 0 ? sprintf('%d:%02d:%02d', $hours, $minutes, $secs) : sprintf('%d:%02d', $minutes, $secs);
}

function yt_stats(PDO $db): array
{
    return [
        'videos' => (int)$db->query('SELECT COUNT(*) FROM videos')->fetchColumn(),
        'segments' => (int)$db->query('SELECT COUNT(*) FROM segments')->fetchColumn(),
        'channels' => (int)$db->query('SELECT COUNT(*) FROM channels')->fetchColumn(),
    ];
}

function yt_channel_stats(PDO $db): array
{
    if (!yt_channel_stats_cache_ready($db)) {
        yt_refresh_channel_stats($db);
    }
    $dbBytes = is_file(yt_db_path()) ? filesize(yt_db_path()) : 0;
    $sql = "SELECT
                c.id,
                c.name AS channel,
                c.url,
                c.avatar_url,
                c.category,
                c.enabled,
                cs.video_count,
                cs.runtime_seconds,
                cs.transcript_chars,
                cs.payload_bytes,
                cs.segment_count,
                cs.updated_at
            FROM channels c
            JOIN channel_stats cs ON cs.channel_id = c.id
            WHERE cs.video_count > 0
            ORDER BY c.name COLLATE NOCASE";
    $rows = $db->query($sql)->fetchAll();
    $totalPayloadBytes = array_sum(array_map(static fn(array $row): int => (int)$row['payload_bytes'], $rows));
    $channels = [];
    foreach ($rows as $row) {
        $payloadBytes = (int)$row['payload_bytes'];
        $estimatedDbBytes = $totalPayloadBytes > 0 ? (int)round($dbBytes * ($payloadBytes / $totalPayloadBytes)) : 0;
        $channels[] = [
            'id' => (int)$row['id'],
            'channel' => (string)$row['channel'],
            'url' => (string)$row['url'],
            'avatar_url' => (string)$row['avatar_url'],
            'category' => (string)$row['category'],
            'enabled' => (bool)$row['enabled'],
            'video_count' => (int)$row['video_count'],
            'runtime_seconds' => (int)$row['runtime_seconds'],
            'transcript_chars' => (int)$row['transcript_chars'],
            'payload_bytes' => $payloadBytes,
            'estimated_db_bytes' => $estimatedDbBytes,
            'segment_count' => (int)$row['segment_count'],
            'updated_at' => (string)$row['updated_at'],
        ];
    }
    return [
        'database_bytes' => $dbBytes,
        'totals' => [
            'channels' => count($channels),
            'video_count' => array_sum(array_column($channels, 'video_count')),
            'runtime_seconds' => array_sum(array_column($channels, 'runtime_seconds')),
            'transcript_chars' => array_sum(array_column($channels, 'transcript_chars')),
            'payload_bytes' => array_sum(array_column($channels, 'payload_bytes')),
            'estimated_db_bytes' => $dbBytes,
            'segment_count' => array_sum(array_column($channels, 'segment_count')),
        ],
        'notes' => [
            'runtime_seconds' => 'Approximate: summed from each video\'s latest transcript timestamp, not exact YouTube duration.',
            'payload_bytes' => 'Approximate raw row payload: transcript/title/id/source/import text, not SQLite page usage.',
            'estimated_db_bytes' => 'Approximate: total DB file size apportioned by each channel\'s raw payload bytes.',
        ],
        'channels' => $channels,
    ];
}

function yt_channel_stats_cache_ready(PDO $db): bool
{
    $channelCount = (int)$db->query('SELECT COUNT(DISTINCT channel_id) FROM videos WHERE channel_id IS NOT NULL')->fetchColumn();
    if ($channelCount === 0) {
        return false;
    }
    $statsCount = (int)$db->query('SELECT COUNT(*) FROM channel_stats WHERE video_count > 0')->fetchColumn();
    return $statsCount >= $channelCount;
}

function yt_refresh_channel_stats(PDO $db): void
{
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) {
        $db->beginTransaction();
    }
    try {
        $db->exec('DELETE FROM channel_stats');
        $db->exec(
            "INSERT INTO channel_stats (
                channel_id,
                video_count,
                runtime_seconds,
                transcript_chars,
                payload_bytes,
                segment_count,
                updated_at
            )
            WITH per_video AS (
                SELECT
                    v.youtube_id,
                    v.channel_id,
                    LENGTH(v.transcript) AS transcript_chars,
                    LENGTH(v.transcript)
                        + LENGTH(v.title)
                        + LENGTH(v.youtube_id)
                        + LENGTH(v.source_file)
                        + LENGTH(v.imported_at)
                        + 32 AS payload_bytes,
                    COALESCE(MAX(s.start_seconds), 0) AS runtime_seconds,
                    COUNT(s.start_seconds) AS segment_count
                FROM videos v
                LEFT JOIN segments s ON s.video_id = v.youtube_id
                WHERE v.channel_id IS NOT NULL
                GROUP BY v.youtube_id
            )
            SELECT
                channel_id,
                COUNT(youtube_id),
                COALESCE(SUM(runtime_seconds), 0),
                COALESCE(SUM(transcript_chars), 0),
                COALESCE(SUM(payload_bytes), 0),
                COALESCE(SUM(segment_count), 0),
                strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
            FROM per_video
            GROUP BY channel_id"
        );
        if ($ownsTransaction) {
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($ownsTransaction && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function yt_database_info(PDO $db): array
{
    $stats = yt_stats($db);
    return [
        'path' => yt_db_path(),
        'exists' => is_file(yt_db_path()),
        'bytes' => is_file(yt_db_path()) ? filesize(yt_db_path()) : 0,
        'ready' => $stats['videos'] > 0,
        'stats' => $stats,
    ];
}

function yt_require_data(PDO $db): void
{
    $stmt = $db->query('SELECT 1 FROM videos LIMIT 1');
    if (!$stmt->fetchColumn()) {
        throw new RuntimeException('Transcript database is empty. Upload the populated transcripts.sqlite3 file to youtube-transcripts/data/.');
    }
}
