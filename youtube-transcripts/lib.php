<?php
declare(strict_types=1);

const YT_API_VERSION = '1';
const YT_DEFAULT_SOURCE_DIR = '/Users/diego/Desktop/Read/YouTube Channel Transcripts';

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
    $db->exec('PRAGMA busy_timeout = 5000');
    if ($create) {
        yt_init_schema($db);
    }
    return $db;
}

function yt_init_schema(PDO $db): void
{
    $db->exec(
        'CREATE TABLE IF NOT EXISTS videos (
            youtube_id TEXT PRIMARY KEY,
            channel TEXT NOT NULL,
            title TEXT NOT NULL,
            transcript TEXT NOT NULL,
            source_file TEXT NOT NULL,
            imported_at TEXT NOT NULL
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
        "CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
            youtube_id UNINDEXED,
            channel UNINDEXED,
            title,
            transcript,
            tokenize = 'unicode61'
        )"
    );
}

function yt_import_dir(PDO $db, string $sourceDir, bool $rebuild = false, int $limitFiles = 0): array
{
    if (!is_dir($sourceDir)) {
        throw new InvalidArgumentException('Transcript source directory not found.');
    }
    if ($rebuild) {
        $db->exec('DELETE FROM videos_fts');
        $db->exec('DELETE FROM segments');
        $db->exec('DELETE FROM videos');
    }
    $files = glob(rtrim($sourceDir, '/') . '/*.md');
    sort($files);
    if ($limitFiles > 0) {
        $files = array_slice($files, 0, $limitFiles);
    }
    $stats = ['files' => 0, 'videos' => 0, 'segments' => 0];
    foreach ($files as $file) {
        $channel = yt_channel_from_filename((string)$file);
        $fileStats = yt_import_file($db, (string)$file, $channel);
        $stats['files']++;
        $stats['videos'] += $fileStats['videos'];
        $stats['segments'] += $fileStats['segments'];
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

function yt_import_file(PDO $db, string $file, string $channel): array
{
    $handle = fopen($file, 'rb');
    if ($handle === false) {
        throw new RuntimeException('Could not open transcript file: ' . $file);
    }

    $stats = ['videos' => 0, 'segments' => 0];
    $video = null;
    $cueStart = null;
    $cueText = [];

    $flushCue = static function () use (&$video, &$cueStart, &$cueText): void {
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
        $video['segments'][] = [
            'start_seconds' => $cueStart,
            'char_index' => $charIndex,
        ];
        $video['transcript'] .= $text;
        $cueStart = null;
        $cueText = [];
    };

    $flushVideo = function () use (&$video, &$stats, $db, $file, $channel, $flushCue): void {
        $flushCue();
        if ($video === null || trim($video['transcript']) === '') {
            $video = null;
            return;
        }
        yt_save_video($db, $video['youtube_id'], $channel, $video['title'], $video['transcript'], $file, $video['segments']);
        $stats['videos']++;
        $stats['segments'] += count($video['segments']);
        $video = null;
    };

    while (($line = fgets($handle)) !== false) {
        $line = rtrim($line, "\r\n");
        if (preg_match('/^#\s+(.+)\s+\(([A-Za-z0-9_-]{11})\)\s*$/', $line, $m)) {
            $flushVideo();
            $video = [
                'youtube_id' => $m[2],
                'title' => trim($m[1]),
                'transcript' => '',
                'segments' => [],
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
    fclose($handle);
    return $stats;
}

function yt_time_to_seconds(string $time): int
{
    if (!preg_match('/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/', $time, $m)) {
        return 0;
    }
    return ((int)$m[1] * 3600) + ((int)$m[2] * 60) + (int)$m[3];
}

function yt_save_video(PDO $db, string $youtubeId, string $channel, string $title, string $transcript, string $sourceFile, array $segments): void
{
    $db->beginTransaction();
    try {
        $stmt = $db->prepare(
            'INSERT INTO videos (youtube_id, channel, title, transcript, source_file, imported_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(youtube_id) DO UPDATE SET
                channel = excluded.channel,
                title = excluded.title,
                transcript = excluded.transcript,
                source_file = excluded.source_file,
                imported_at = excluded.imported_at'
        );
        $stmt->execute([$youtubeId, $channel, $title, $transcript, $sourceFile, gmdate('c')]);
        $db->prepare('DELETE FROM segments WHERE video_id = ?')->execute([$youtubeId]);
        $segmentStmt = $db->prepare('INSERT OR IGNORE INTO segments (video_id, start_seconds, char_index) VALUES (?, ?, ?)');
        foreach ($segments as $segment) {
            $segmentStmt->execute([$youtubeId, $segment['start_seconds'], $segment['char_index']]);
        }
        $db->prepare('DELETE FROM videos_fts WHERE youtube_id = ?')->execute([$youtubeId]);
        $db->prepare('INSERT INTO videos_fts (youtube_id, channel, title, transcript) VALUES (?, ?, ?, ?)')
            ->execute([$youtubeId, $channel, $title, $transcript]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function yt_channels(PDO $db): array
{
    $stmt = $db->query('SELECT channel, COUNT(*) AS video_count FROM videos GROUP BY channel ORDER BY channel COLLATE NOCASE');
    return $stmt->fetchAll();
}

function yt_search(PDO $db, string $query, string $channel = '', int $limit = 50, string $videoId = ''): array
{
    $query = trim(preg_replace('/\s+/', ' ', $query) ?? '');
    if ($query === '') {
        return [];
    }
    $limit = max(1, min(200, $limit));
    $match = yt_fts_query($query);
    if ($match === '') {
        return [];
    }

    $sql = 'SELECT v.youtube_id, v.channel, v.title, v.transcript
            FROM videos_fts
            JOIN videos v ON v.youtube_id = videos_fts.youtube_id
            WHERE videos_fts MATCH :match';
    $params = [':match' => $match];
    if ($channel !== '') {
        $sql .= ' AND v.channel = :channel';
        $params[':channel'] = $channel;
    }
    if ($videoId !== '') {
        $sql .= ' AND v.youtube_id = :video_id';
        $params[':video_id'] = $videoId;
    }
    $sql .= ' ORDER BY rank LIMIT 200';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $results = [];
    while (($row = $stmt->fetch()) && count($results) < $limit) {
        foreach (yt_find_occurrences((string)$row['transcript'], $query) as $offset) {
            $seconds = yt_seconds_for_char_index($db, (string)$row['youtube_id'], $offset);
            $results[] = [
                'youtube_id' => $row['youtube_id'],
                'channel' => $row['channel'],
                'title' => $row['title'],
                'start_seconds' => $seconds,
                'timestamp' => yt_format_timestamp($seconds),
                'url' => 'https://www.youtube.com/watch?v=' . rawurlencode((string)$row['youtube_id']) . '&t=' . $seconds . 's',
                'snippet' => yt_snippet((string)$row['transcript'], $offset, strlen($query)),
            ];
            if (count($results) >= $limit) {
                break;
            }
        }
    }
    return $results;
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
    return array_map(static fn(array $match): int => (int)$match[1], $matches[0] ?? []);
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

function yt_snippet(string $transcript, int $offset, int $length): string
{
    $start = max(0, $offset - 110);
    $end = min(strlen($transcript), $offset + max($length, 1) + 150);
    $snippet = trim(substr($transcript, $start, $end - $start));
    $snippet = preg_replace('/\s+/', ' ', $snippet) ?? $snippet;
    if ($start > 0) {
        $snippet = '...' . $snippet;
    }
    if ($end < strlen($transcript)) {
        $snippet .= '...';
    }
    return $snippet;
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
        'channels' => (int)$db->query('SELECT COUNT(DISTINCT channel) FROM videos')->fetchColumn(),
    ];
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
    if (yt_stats($db)['videos'] === 0) {
        throw new RuntimeException('Transcript database is empty. Upload the populated transcripts.sqlite3 file to youtube-transcripts/data/.');
    }
}
