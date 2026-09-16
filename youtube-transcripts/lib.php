<?php
declare(strict_types=1);

const YT_API_VERSION = '2';
const YT_DEFAULT_SOURCE_DIR = '/Users/diego/Desktop/Read/YouTube Channel Transcripts';
const YT_LOCAL_CANONICAL_DB = '/Users/diego/Desktop/Read/YouTube Channel Transcripts/data/transcripts.sqlite3';
const YT_STATS_CACHE_VERSION = 2;
const YT_SNIPPET_CONTEXT_CHARS = 120;
const YT_IMPORT_TRANSACTION_BATCH_SIZE = 25;

function yt_text_length(string $text): int
{
    return mb_strlen($text, 'UTF-8');
}

function yt_text_slice(string $text, int $start, ?int $length = null): string
{
    return $length === null
        ? mb_substr($text, $start, null, 'UTF-8')
        : mb_substr($text, $start, $length, 'UTF-8');
}

function yt_byte_to_char_offset(string $text, int $byteOffset): int
{
    return yt_text_length(substr($text, 0, max(0, $byteOffset)));
}

function yt_search_fold(string $text): string
{
    if ($text === '') {
        return '';
    }
    if (class_exists('Normalizer')) {
        $normalized = Normalizer::normalize($text, Normalizer::FORM_D);
        if (is_string($normalized)) {
            $text = $normalized;
        }
        $text = preg_replace('/[\p{Mn}\p{Mc}\p{Me}]+/u', '', $text) ?? $text;
    }
    $text = strtr($text, yt_search_fold_map());
    return mb_strtolower($text, 'UTF-8');
}

function yt_search_fold_map(): array
{
    static $map = null;
    if ($map !== null) {
        return $map;
    }
    $map = [
        'À' => 'A', 'Á' => 'A', 'Â' => 'A', 'Ã' => 'A', 'Ä' => 'A', 'Å' => 'A', 'Ā' => 'A', 'Ă' => 'A', 'Ą' => 'A',
        'à' => 'a', 'á' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'ā' => 'a', 'ă' => 'a', 'ą' => 'a',
        'Ç' => 'C', 'Ć' => 'C', 'Ĉ' => 'C', 'Ċ' => 'C', 'Č' => 'C',
        'ç' => 'c', 'ć' => 'c', 'ĉ' => 'c', 'ċ' => 'c', 'č' => 'c',
        'Ð' => 'D', 'Ď' => 'D', 'Đ' => 'D',
        'ð' => 'd', 'ď' => 'd', 'đ' => 'd',
        'È' => 'E', 'É' => 'E', 'Ê' => 'E', 'Ë' => 'E', 'Ē' => 'E', 'Ĕ' => 'E', 'Ė' => 'E', 'Ę' => 'E', 'Ě' => 'E',
        'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e', 'ē' => 'e', 'ĕ' => 'e', 'ė' => 'e', 'ę' => 'e', 'ě' => 'e',
        'Ĝ' => 'G', 'Ğ' => 'G', 'Ġ' => 'G', 'Ģ' => 'G',
        'ĝ' => 'g', 'ğ' => 'g', 'ġ' => 'g', 'ģ' => 'g',
        'Ĥ' => 'H', 'Ħ' => 'H',
        'ĥ' => 'h', 'ħ' => 'h',
        'Ì' => 'I', 'Í' => 'I', 'Î' => 'I', 'Ï' => 'I', 'Ĩ' => 'I', 'Ī' => 'I', 'Ĭ' => 'I', 'Į' => 'I', 'İ' => 'I',
        'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ĩ' => 'i', 'ī' => 'i', 'ĭ' => 'i', 'į' => 'i', 'ı' => 'i',
        'Ĵ' => 'J', 'ĵ' => 'j',
        'Ķ' => 'K', 'ķ' => 'k',
        'Ĺ' => 'L', 'Ļ' => 'L', 'Ľ' => 'L', 'Ŀ' => 'L', 'Ł' => 'L',
        'ĺ' => 'l', 'ļ' => 'l', 'ľ' => 'l', 'ŀ' => 'l', 'ł' => 'l',
        'Ñ' => 'N', 'Ń' => 'N', 'Ņ' => 'N', 'Ň' => 'N',
        'ñ' => 'n', 'ń' => 'n', 'ņ' => 'n', 'ň' => 'n',
        'Ò' => 'O', 'Ó' => 'O', 'Ô' => 'O', 'Õ' => 'O', 'Ö' => 'O', 'Ø' => 'O', 'Ō' => 'O', 'Ŏ' => 'O', 'Ő' => 'O',
        'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o', 'ø' => 'o', 'ō' => 'o', 'ŏ' => 'o', 'ő' => 'o',
        'Ŕ' => 'R', 'Ŗ' => 'R', 'Ř' => 'R',
        'ŕ' => 'r', 'ŗ' => 'r', 'ř' => 'r',
        'Ś' => 'S', 'Ŝ' => 'S', 'Ş' => 'S', 'Š' => 'S',
        'ś' => 's', 'ŝ' => 's', 'ş' => 's', 'š' => 's',
        'Ţ' => 'T', 'Ť' => 'T', 'Ŧ' => 'T',
        'ţ' => 't', 'ť' => 't', 'ŧ' => 't',
        'Ù' => 'U', 'Ú' => 'U', 'Û' => 'U', 'Ü' => 'U', 'Ũ' => 'U', 'Ū' => 'U', 'Ŭ' => 'U', 'Ů' => 'U', 'Ű' => 'U', 'Ų' => 'U',
        'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'ũ' => 'u', 'ū' => 'u', 'ŭ' => 'u', 'ů' => 'u', 'ű' => 'u', 'ų' => 'u',
        'Ŵ' => 'W', 'Ẁ' => 'W', 'Ẃ' => 'W', 'Ẅ' => 'W',
        'ŵ' => 'w', 'ẁ' => 'w', 'ẃ' => 'w', 'ẅ' => 'w',
        'Ý' => 'Y', 'Ÿ' => 'Y', 'Ŷ' => 'Y',
        'ý' => 'y', 'ÿ' => 'y', 'ŷ' => 'y',
        'Ź' => 'Z', 'Ż' => 'Z', 'Ž' => 'Z',
        'ź' => 'z', 'ż' => 'z', 'ž' => 'z',
        'Æ' => 'AE', 'æ' => 'ae', 'Œ' => 'OE', 'œ' => 'oe',
        'Þ' => 'TH', 'þ' => 'th', 'ß' => 'ss',
        '‘' => '\'', '’' => '\'', '‚' => '\'', '‛' => '\'', 'ʼ' => '\'', '´' => '\'', '`' => '\'',
    ];
    return $map;
}

function yt_search_fold_with_offsets(string $text): array
{
    if ($text === '') {
        return ['', []];
    }
    preg_match_all('/./us', $text, $matches);
    $folded = '';
    $offsets = [];
    foreach ($matches[0] ?? [] as $index => $char) {
        $piece = yt_search_fold($char);
        if ($piece === '') {
            continue;
        }
        preg_match_all('/./us', $piece, $pieceChars);
        foreach ($pieceChars[0] ?? [] as $_) {
            $offsets[] = $index;
        }
        $folded .= $piece;
    }
    return [$folded, $offsets];
}

function yt_data_dir(): string
{
    return __DIR__ . '/data';
}

function yt_stats_cache_path(): string
{
    return yt_data_dir() . '/stats-cache.json';
}

function yt_stt_patch_metrics_path(): string
{
    $webPath = yt_data_dir() . '/stt-patch-metrics.json';
    $localMirror = '/Users/diego/Desktop/Ego/public_html/youtube-transcripts';
    $canonicalPath = YT_DEFAULT_SOURCE_DIR . '/data/stt-patch-metrics.json';
    if (strncmp(__DIR__, $localMirror, strlen($localMirror)) === 0 && is_file($canonicalPath)) {
        return $canonicalPath;
    }
    return $webPath;
}

function yt_db_path(): string
{
    $override = getenv('YT_TRANSCRIPTS_DB');
    if (is_string($override) && $override !== '') {
        return $override;
    }

    $webDb = yt_data_dir() . '/transcripts.sqlite3';
    $localMirror = '/Users/diego/Desktop/Ego/public_html/youtube-transcripts';
    if (strncmp(__DIR__, $localMirror, strlen($localMirror)) === 0 && is_file(YT_LOCAL_CANONICAL_DB)) {
        return YT_LOCAL_CANONICAL_DB;
    }

    if (is_file($webDb) && filesize($webDb) > 0) {
        return $webDb;
    }

    return $webDb;
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
    $pdoOptions = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ];
    $db = class_exists('\Pdo\Sqlite')
        ? new \Pdo\Sqlite('sqlite:' . yt_db_path(), null, null, $pdoOptions)
        : new PDO('sqlite:' . yt_db_path(), null, null, $pdoOptions);
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('PRAGMA busy_timeout = 60000');
    yt_register_sqlite_functions($db);
    if ($create) {
        yt_init_schema($db);
    }
    yt_migrate_decensor_candidates($db);
    return $db;
}

function yt_register_sqlite_functions(PDO $db): void
{
    if (!method_exists($db, 'createFunction') && !method_exists($db, 'sqliteCreateFunction')) {
        return;
    }
    $flags = defined('Pdo\Sqlite::DETERMINISTIC')
        ? constant('Pdo\Sqlite::DETERMINISTIC')
        : (defined('PDO::SQLITE_DETERMINISTIC') ? constant('PDO::SQLITE_DETERMINISTIC') : 0);
    $callback = static fn($value): string => yt_search_fold((string)($value ?? ''));
    if (method_exists($db, 'createFunction')) {
        $db->createFunction('yt_search_fold', $callback, 1, $flags);
        return;
    }
    $db->sqliteCreateFunction('yt_search_fold', $callback, 1, $flags);
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
        'CREATE TABLE IF NOT EXISTS decensor_candidates (
            video_id TEXT NOT NULL,
            start_char INTEGER NOT NULL,
            replacement TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0.0,
            PRIMARY KEY (video_id, start_char, replacement),
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
    $db->exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS video_titles_fts USING fts5(
            youtube_id UNINDEXED,
            channel UNINDEXED,
            title,
            tokenize = 'trigram'
        )"
    );
    yt_migrate_decensor_candidates($db);
    yt_migrate_channel_schema($db);
}

function yt_migrate_decensor_candidates(PDO $db): void
{
    $oldExists = yt_table_exists($db, 'uncensored');
    $newExists = yt_table_exists($db, 'decensor_candidates');
    if ($oldExists && !$newExists) {
        $db->exec('ALTER TABLE uncensored RENAME TO decensor_candidates');
        $oldExists = false;
        $newExists = true;
    }
    if ($newExists && !yt_column_exists($db, 'decensor_candidates', 'confidence')) {
        $db->exec('ALTER TABLE decensor_candidates ADD COLUMN confidence REAL NOT NULL DEFAULT 0.0');
    }
    if ($oldExists && $newExists) {
        $confidenceExpr = yt_column_exists($db, 'uncensored', 'confidence') ? 'confidence' : '0.0';
        $db->exec(
            'INSERT OR IGNORE INTO decensor_candidates (video_id, start_char, replacement, confidence)
             SELECT video_id, start_char, replacement, ' . $confidenceExpr . '
             FROM uncensored'
        );
        $db->exec('DROP TABLE uncensored');
    }
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

function yt_table_exists(PDO $db, string $table): bool
{
    $stmt = $db->prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1");
    $stmt->execute([$table]);
    return (bool)$stmt->fetchColumn();
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
        $charIndex = yt_text_length($video['transcript']);
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
        'Bo Burnham' => 'Comedy',
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
        'JREG' => 'Comedy',
        'Jordan B Peterson' => 'Philosophy',
        'Jonathan Pageau' => 'Philosophy',
        'June Lee' => 'Music',
        'Key & Peele' => 'Comedy',
        'Lex Fridman' => 'AI',
        'LifeAccordingToJimmy' => 'Comedy',
        'Lil Dicky' => 'Music',
        'Mathologer' => 'Math',
        'Matan Even' => 'Comedy',
        'mrgirlreturns Twitch Archive' => 'Philosophy',
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
        'Stromae' => 'Music',
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

function yt_search(PDO $db, string $query, array|string $channel = '', int $limit = 50, string $videoId = '', string $titleFilter = '', ?array &$timings = null, array|string $videoIds = []): array
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
    } else {
        $videoIds = yt_normalize_video_ids($videoIds);
        if ($videoIds) {
            $placeholders = [];
            foreach ($videoIds as $index => $id) {
                $key = ':video_id_' . $index;
                $placeholders[] = $key;
                $params[$key] = $id;
            }
            $sql .= ' AND v.youtube_id IN (' . implode(', ', $placeholders) . ')';
        }
    }
    $titleFilter = trim(preg_replace('/\s+/', ' ', $titleFilter) ?? '');
    if ($titleFilter !== '') {
        $sql .= " AND yt_search_fold(v.title) LIKE :title_filter ESCAPE '\\'";
        $params[':title_filter'] = '%' . yt_like_escape(yt_search_fold($titleFilter)) . '%';
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

function yt_title_search(PDO $db, string $titleFilter, array|string $channel = '', int $limit = 50, ?array &$timings = null, array|string $videoIds = []): array
{
    $started = microtime(true);
    $titleFilter = trim(preg_replace('/\s+/', ' ', $titleFilter) ?? '');
    if ($titleFilter === '') {
        $timings = ['total_ms' => 0.0, 'sqlite_ms' => 0.0, 'snippet_ms' => 0.0, 'candidate_videos' => 0];
        return [];
    }
    $limit = max(1, min(200, $limit));
    $foldedTitleFilter = yt_search_fold($titleFilter);
    if ($foldedTitleFilter === '') {
        $timings = ['total_ms' => 0.0, 'sqlite_ms' => 0.0, 'snippet_ms' => 0.0, 'candidate_videos' => 0];
        return [];
    }
    $sql = 'SELECT v.youtube_id, c.name AS channel, v.title
            FROM videos v
            JOIN channels c ON c.id = v.channel_id
            WHERE yt_search_fold(v.title) LIKE :title_filter ESCAPE \'\\\'';
    $params = [':title_filter' => '%' . yt_like_escape($foldedTitleFilter) . '%'];
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
    $videoIds = yt_normalize_video_ids($videoIds);
    if ($videoIds) {
        $placeholders = [];
        foreach ($videoIds as $index => $id) {
            $key = ':video_id_' . $index;
            $placeholders[] = $key;
            $params[$key] = $id;
        }
        $sql .= ' AND v.youtube_id IN (' . implode(', ', $placeholders) . ')';
    }
    $sql .= ' ORDER BY v.title COLLATE NOCASE LIMIT :limit';
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

function yt_decensor_candidates(PDO $db, int $limit = 200, string $videoId = '', ?array &$timings = null): array
{
    $started = microtime(true);
    $videoQueryMs = 0.0;
    $proposalMs = 0.0;
    $markerOffsetMs = 0.0;
    $payloadMs = 0.0;
    $videoRows = [];
    $markerCount = 0;
    if (!yt_table_exists($db, 'decensor_candidates')) {
        $timings = [
            'total_ms' => round((microtime(true) - $started) * 1000, 1),
            'video_query_ms' => 0.0,
            'proposal_query_ms' => 0.0,
            'marker_offset_ms' => 0.0,
            'payload_ms' => 0.0,
            'videos' => 0,
            'markers' => 0,
        ];
        return [
            'runs' => [],
            'markers' => [],
        ];
    }

    $limit = max(1, min(500, $limit));
    $where = [];
    $params = [];
    if ($videoId !== '') {
        $where[] = 'v.youtube_id = :video_id';
        $params[':video_id'] = $videoId;
    }

    $sql = 'SELECT
                pc.patch_count,
                pc.suggested_count,
                pc.censor_count,
                v.youtube_id AS video_id,
                v.transcript,
                v.title,
                c.name AS channel,
                c.avatar_url,
                c.category
            FROM videos v
            JOIN (
                SELECT
                    u2.video_id,
                    COUNT(*) AS patch_count,
                    COUNT(DISTINCT u2.start_char) AS suggested_count,
                    CAST((LENGTH(v2.transcript) - LENGTH(REPLACE(v2.transcript, \'[ __ ]\', \'\'))) / LENGTH(\'[ __ ]\') AS INTEGER) AS censor_count
                FROM decensor_candidates u2
                JOIN videos v2 ON v2.youtube_id = u2.video_id
                GROUP BY u2.video_id
            ) pc ON pc.video_id = v.youtube_id
            JOIN channels c ON c.id = v.channel_id';
    if ($where) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY pc.censor_count ASC, pc.suggested_count ASC, c.name COLLATE NOCASE, v.title COLLATE NOCASE, v.youtube_id LIMIT :limit';

    $stmt = $db->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, PDO::PARAM_STR);
    }
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stageStarted = microtime(true);
    $stmt->execute();

    $videoRows = $stmt->fetchAll();
    $videoQueryMs = (microtime(true) - $stageStarted) * 1000;
    $stageStarted = microtime(true);
    $proposalsByVideo = yt_decensor_proposals_by_video($db, array_map(
        static fn(array $row): string => (string)$row['video_id'],
        $videoRows
    ));
    $proposalMs = (microtime(true) - $stageStarted) * 1000;

    $markers = [];
    foreach ($videoRows as $row) {
        $videoId = (string)$row['video_id'];
        $transcript = (string)$row['transcript'];
        $stageStarted = microtime(true);
        $markerOffsets = yt_marker_offsets($transcript, '[ __ ]');
        $markerOffsetMs += (microtime(true) - $stageStarted) * 1000;
        $markerCount += count($markerOffsets);
        foreach ($markerOffsets as $startChar) {
            $proposals = $proposalsByVideo[$videoId][$startChar] ?? [['replacement' => '', 'confidence' => 0.0]];
            foreach ($proposals as $proposal) {
                $stageStarted = microtime(true);
                $markers[] = yt_decensor_marker_payload(
                    $db,
                    $row,
                    $startChar,
                    (string)$proposal['replacement'],
                    (float)$proposal['confidence'],
                    count($markers)
                );
                $payloadMs += (microtime(true) - $stageStarted) * 1000;
            }
        }
    }

    $timings = [
        'total_ms' => round((microtime(true) - $started) * 1000, 1),
        'video_query_ms' => round($videoQueryMs, 1),
        'proposal_query_ms' => round($proposalMs, 1),
        'marker_offset_ms' => round($markerOffsetMs, 1),
        'payload_ms' => round($payloadMs, 1),
        'videos' => count($videoRows),
        'markers' => $markerCount,
        'returned_markers' => count($markers),
    ];

    return [
        'runs' => [],
        'markers' => $markers,
    ];
}

function yt_decensor_proposals_by_video(PDO $db, array $videoIds): array
{
    $videoIds = yt_normalize_video_ids($videoIds);
    if (!$videoIds) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($videoIds), '?'));
    $confidenceExpr = yt_column_exists($db, 'decensor_candidates', 'confidence') ? 'confidence' : '0.0 AS confidence';
    $stmt = $db->prepare(
        'SELECT video_id, start_char, replacement, ' . $confidenceExpr . '
         FROM decensor_candidates
         WHERE video_id IN (' . $placeholders . ')
         ORDER BY video_id, start_char, replacement COLLATE NOCASE'
    );
    $stmt->execute($videoIds);

    $byVideo = [];
    foreach ($stmt->fetchAll() as $row) {
        $videoId = (string)$row['video_id'];
        $startChar = (int)$row['start_char'];
        $byVideo[$videoId][$startChar][] = [
            'replacement' => (string)$row['replacement'],
            'confidence' => (float)$row['confidence'],
        ];
    }
    return $byVideo;
}

function yt_marker_offsets(string $text, string $marker): array
{
    $offsets = [];
    $cursor = 0;
    while (($position = strpos($text, $marker, $cursor)) !== false) {
        $offsets[] = yt_byte_to_char_offset($text, $position);
        $cursor = $position + strlen($marker);
    }
    return $offsets;
}

function yt_decensor_marker_payload(PDO $db, array $row, int $startChar, string $replacement, float $confidence, int $markerIndex): array
{
    $videoId = (string)$row['video_id'];
    $transcript = (string)$row['transcript'];
    $endChar = $startChar + yt_text_length('[ __ ]');
    $cue = yt_cue_for_char_index($db, $videoId, $startChar, yt_text_length($transcript));
    $seconds = (int)$cue['start_seconds'];
    $cueStart = (int)$cue['start_char'];
    $cueEnd = (int)$cue['end_char'];
    $before = yt_text_slice($transcript, $cueStart, max(0, $startChar - $cueStart));
    $after = yt_text_slice($transcript, $endChar, max(0, $cueEnd - $endChar));
    $cueText = yt_text_slice($transcript, $cueStart, $cueEnd - $cueStart);
    $youtubeExcerpt = trim(preg_replace('/\s+/', ' ', $cueText) ?? '');
    $hasProposal = $replacement !== '';
    $candidateExcerpt = $hasProposal
        ? trim(preg_replace('/\s+/', ' ', $before . "\u{E000}" . $replacement . "\u{E001}" . $after) ?? '')
        : $youtubeExcerpt;

    return [
        'id' => $hasProposal ? crc32($videoId . ':' . $startChar . ':' . $replacement) : 0,
        'run_id' => 0,
        'video_id' => $videoId,
        'youtube_id' => $videoId,
        'channel' => (string)$row['channel'],
        'avatar_url' => (string)$row['avatar_url'],
        'category' => (string)$row['category'],
        'title' => (string)$row['title'],
        'video_patch_count' => (int)$row['patch_count'],
        'video_suggested_count' => (int)$row['suggested_count'],
        'video_censor_count' => (int)$row['censor_count'],
        'marker_index' => $markerIndex,
        'marker_char_start' => $startChar,
        'marker_char_end' => $endChar,
        'marker_start_seconds' => $seconds,
        'marker_end_seconds' => (float)$cue['end_seconds'],
        'marker_timestamp' => yt_format_timestamp($seconds),
        'cue_start_char' => $cueStart,
        'cue_end_char' => $cueEnd,
        'cue_text' => $cueText,
        'window_index' => $cueStart,
        'window_start_seconds' => $seconds,
        'window_end_seconds' => (float)$cue['end_seconds'],
        'window_start_timestamp' => yt_format_timestamp($seconds),
        'window_end_timestamp' => yt_format_timestamp(max($seconds, (int)ceil((float)$cue['end_seconds']))),
        'youtube_before' => $before,
        'youtube_after' => $after,
        'youtube_excerpt' => $youtubeExcerpt,
        'stt_text' => $candidateExcerpt,
        'stt_excerpt' => $candidateExcerpt,
        'candidate_text' => $replacement,
        'replacement_text' => $replacement,
        'status' => $hasProposal ? 'candidate' : 'skipped',
        'confidence' => $hasProposal ? $confidence : 0.0,
        'reason' => $hasProposal
            ? 'Stored in decensor_candidates table; not applied to transcript.'
            : 'No staged replacement for this censored marker.',
        'applied' => false,
        'model' => '',
        'run_status' => '',
        'created_at' => '',
        'url' => 'https://www.youtube.com/watch?v=' . rawurlencode($videoId) . '&t=' . $seconds . 's',
    ];
}

function yt_cue_for_char_index(PDO $db, string $youtubeId, int $charIndex, int $transcriptLength): array
{
    $fallback = [
        'start_char' => max(0, $charIndex),
        'end_char' => min($transcriptLength, max(0, $charIndex) + yt_text_length('[ __ ]')),
        'start_seconds' => yt_seconds_for_char_index($db, $youtubeId, $charIndex),
        'end_seconds' => yt_seconds_for_char_index($db, $youtubeId, $charIndex) + 8,
    ];
    if (!yt_table_exists($db, 'segments')) {
        return $fallback;
    }

    $previous = $db->prepare(
        'SELECT char_index, start_seconds
         FROM segments
         WHERE video_id = ? AND char_index <= ?
         ORDER BY char_index DESC, start_seconds DESC
         LIMIT 1'
    );
    $previous->execute([$youtubeId, $charIndex]);
    $start = $previous->fetch();
    if (!$start) {
        return $fallback;
    }

    $next = $db->prepare(
        'SELECT char_index, start_seconds
         FROM segments
         WHERE video_id = ? AND char_index > ?
         ORDER BY char_index ASC, start_seconds ASC
         LIMIT 1'
    );
    $next->execute([$youtubeId, (int)$start['char_index']]);
    $end = $next->fetch();

    $startChar = max(0, min($transcriptLength, (int)$start['char_index']));
    $endChar = $end ? max($startChar, min($transcriptLength, (int)$end['char_index'])) : $transcriptLength;
    $startSeconds = max(0, (int)$start['start_seconds']);
    $endSeconds = $end ? max($startSeconds, (int)$end['start_seconds']) : $startSeconds + 8;
    return [
        'start_char' => $startChar,
        'end_char' => $endChar,
        'start_seconds' => $startSeconds,
        'end_seconds' => $endSeconds,
    ];
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

function yt_normalize_video_ids(array|string $videoIds): array
{
    if (is_string($videoIds)) {
        $videoIds = $videoIds === '' ? [] : [$videoIds];
    }
    $clean = [];
    foreach ($videoIds as $videoId) {
        $videoId = trim((string)$videoId);
        if ($videoId !== '' && preg_match('/^[A-Za-z0-9_-]{6,32}$/', $videoId)) {
            $clean[$videoId] = true;
        }
    }
    return array_slice(array_keys($clean), 0, 200);
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
    $foldedQuery = yt_search_fold($query);
    if ($foldedQuery === '' || $transcript === '') {
        return [];
    }
    [$foldedTranscript, $offsetMap] = yt_search_fold_with_offsets($transcript);
    if ($foldedTranscript === '' || !$offsetMap) {
        return [];
    }
    $pattern = preg_quote($foldedQuery, '/');
    $pattern = preg_replace('/\s+/', '\\s+', $pattern) ?? $pattern;
    if (@preg_match('/' . $pattern . '/iu', '') === false) {
        return [];
    }
    preg_match_all('/' . $pattern . '/iu', $foldedTranscript, $matches, PREG_OFFSET_CAPTURE);
    $occurrences = [];
    foreach ($matches[0] ?? [] as $match) {
        $foldedStart = yt_byte_to_char_offset($foldedTranscript, (int)$match[1]);
        $foldedLength = yt_text_length((string)$match[0]);
        $foldedEnd = $foldedStart + max(1, $foldedLength) - 1;
        if (!isset($offsetMap[$foldedStart], $offsetMap[$foldedEnd])) {
            continue;
        }
        $start = (int)$offsetMap[$foldedStart];
        $end = (int)$offsetMap[$foldedEnd] + 1;
        $occurrences[] = [
            'offset' => $start,
            'length' => max(1, $end - $start),
        ];
    }
    return $occurrences;
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
    if (!yt_table_exists($db, 'segments')) {
        return 0;
    }
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
    $transcriptLength = yt_text_length($transcript);
    $end = min($transcriptLength, (int)$last['offset'] + max(1, (int)$last['length']) + YT_SNIPPET_CONTEXT_CHARS);
    $parts = [];
    if ($start > 0) {
        $parts[] = ['text' => '...', 'match' => false];
    }
    $cursor = $start;
    foreach ($matches as $match) {
        $offset = max($start, (int)$match['offset']);
        $matchEnd = min($end, (int)$match['offset'] + max(1, (int)$match['length']));
        if ($offset > $cursor) {
            yt_add_snippet_part($parts, yt_text_slice($transcript, $cursor, $offset - $cursor), false);
        }
        if ($matchEnd > $offset) {
            yt_add_snippet_part($parts, yt_text_slice($transcript, $offset, $matchEnd - $offset), true);
        }
        $cursor = max($cursor, $matchEnd);
    }
    if ($cursor < $end) {
        yt_add_snippet_part($parts, yt_text_slice($transcript, $cursor, $end - $cursor), false);
    }
    if ($end < $transcriptLength) {
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
        'segments' => yt_table_exists($db, 'segments') ? (int)$db->query('SELECT COUNT(*) FROM segments')->fetchColumn() : null,
        'channels' => (int)$db->query('SELECT COUNT(*) FROM channels')->fetchColumn(),
    ];
}

function yt_channel_stats(PDO $db): array
{
    $cached = yt_read_channel_stats_cache(true);
    if ($cached !== null) {
        return $cached;
    }
    return yt_missing_channel_stats_cache($db);
}

function yt_missing_channel_stats_cache(PDO $db): array
{
    $dbBytes = is_file(yt_db_path()) ? filesize(yt_db_path()) : 0;
    $videoCount = (int)$db->query('SELECT COUNT(*) FROM videos')->fetchColumn();
    $channelCount = (int)$db->query('SELECT COUNT(*) FROM channels')->fetchColumn();
    return [
        'database_bytes' => $dbBytes,
        'totals' => [
            'channels' => $channelCount,
            'video_count' => $videoCount,
            'runtime_seconds' => 0,
            'transcript_chars' => 0,
            'payload_bytes' => 0,
            'estimated_db_bytes' => $dbBytes,
            'segment_count' => 0,
            'censored_markers' => 0,
            'proposed_decensor_markers' => 0,
            'unpatched_censored_markers' => 0,
        ],
        'notes' => [
            'cache' => 'Stats cache is missing or unreadable. Click Refresh Stats to rebuild it.',
        ],
        'channels' => [],
        'censored' => null,
        'cache' => [
            'generated_at' => '',
            'path' => yt_stats_cache_path(),
            'cache_version' => 0,
            'expected_cache_version' => YT_STATS_CACHE_VERSION,
            'missing' => true,
            'stale' => true,
            'database_bytes_at_generation' => 0,
            'current_database_bytes' => $dbBytes,
        ],
    ];
}

function yt_compute_channel_stats(PDO $db): array
{
    $dbBytes = is_file(yt_db_path()) ? filesize(yt_db_path()) : 0;
    $sql = "SELECT
                c.id,
                c.name AS channel,
                c.url,
                c.avatar_url,
                c.category,
                c.enabled,
                COUNT(p.youtube_id) AS video_count,
                COALESCE(SUM(p.runtime_seconds), 0) AS runtime_seconds,
                COALESCE(SUM(p.transcript_chars), 0) AS transcript_chars,
                COALESCE(SUM(p.payload_bytes), 0) AS payload_bytes,
                COALESCE(SUM(p.segment_count), 0) AS segment_count,
                strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS updated_at
            FROM channels c
            JOIN (
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
            ) p ON p.channel_id = c.id
            GROUP BY c.id
            HAVING COUNT(p.youtube_id) > 0
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
    $censored = yt_censored_word_stats($db);
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
            'censored_markers' => $censored['total_markers'],
            'proposed_decensor_markers' => $censored['proposed_markers'],
            'unpatched_censored_markers' => $censored['unpatched_markers'],
        ],
        'notes' => [
            'runtime_seconds' => 'Approximate: summed from each video\'s latest transcript timestamp, not exact YouTube duration.',
            'payload_bytes' => 'Approximate raw row payload: transcript/title/id/source/import text, not SQLite page usage.',
            'estimated_db_bytes' => 'Approximate: total DB file size apportioned by each channel\'s raw payload bytes.',
            'censored_words' => 'Counts [ __ ] markers in transcripts and groups staged decensor replacement candidates case-insensitively.',
        ],
        'channels' => $channels,
        'censored' => $censored,
    ];
}

function yt_censored_word_stats(PDO $db): array
{
    $marker = '[ __ ]';
    $markerStmt = $db->prepare(
        'SELECT COALESCE(SUM((LENGTH(transcript) - LENGTH(REPLACE(transcript, :marker, \'\'))) / :marker_len), 0)
         FROM videos'
    );
    $markerStmt->bindValue(':marker', $marker, PDO::PARAM_STR);
    $markerStmt->bindValue(':marker_len', strlen($marker), PDO::PARAM_INT);
    $markerStmt->execute();
    $totalMarkers = (int)$markerStmt->fetchColumn();

    $words = [];
    if (yt_table_exists($db, 'decensor_candidates')) {
        $wordRows = $db->query(
            "WITH per_marker AS (
                SELECT video_id, start_char, MIN(LOWER(TRIM(replacement))) AS word
                FROM decensor_candidates
                WHERE TRIM(replacement) <> ''
                GROUP BY video_id, start_char
            )
            SELECT word, COUNT(*) AS count
            FROM per_marker
            WHERE word <> ''
            GROUP BY word
            ORDER BY count DESC, word COLLATE NOCASE"
        )->fetchAll();
        foreach ($wordRows as $row) {
            $words[] = [
                'word' => (string)$row['word'],
                'count' => (int)$row['count'],
            ];
        }
    }

    $proposedMarkers = array_sum(array_column($words, 'count'));
    $unpatchedMarkers = max(0, $totalMarkers - $proposedMarkers);
    foreach ($words as &$word) {
        $word['share_of_censored'] = $totalMarkers > 0 ? $word['count'] / $totalMarkers : 0.0;
        $word['share_of_proposed'] = $proposedMarkers > 0 ? $word['count'] / $proposedMarkers : 0.0;
    }
    unset($word);

    $leastFrequent = $words;
    usort($leastFrequent, static function (array $a, array $b): int {
        return ((int)$a['count'] <=> (int)$b['count'])
            ?: strcasecmp((string)$a['word'], (string)$b['word']);
    });

    return [
        'total_markers' => $totalMarkers,
        'proposed_markers' => $proposedMarkers,
        'unpatched_markers' => $unpatchedMarkers,
        'distinct_words' => count($words),
        'words' => $words,
        'least_frequent' => array_slice($leastFrequent, 0, 50),
        'consecutive_runs' => yt_censored_marker_run_stats($db, $marker),
        'stt' => yt_read_stt_patch_metrics(),
    ];
}

function yt_read_stt_patch_metrics(): ?array
{
    $path = yt_stt_patch_metrics_path();
    if (!is_file($path)) {
        return null;
    }
    $payload = json_decode((string)file_get_contents($path), true);
    if (!is_array($payload)) {
        return null;
    }
    $payload['path'] = $path;
    return $payload;
}

function yt_censored_marker_run_stats(PDO $db, string $marker = '[ __ ]'): array
{
    $stmt = $db->prepare(
        'SELECT v.youtube_id, v.title, v.transcript, c.name AS channel
         FROM videos v
         JOIN channels c ON c.id = v.channel_id
         WHERE instr(v.transcript, :marker) > 0'
    );
    $stmt->execute([':marker' => $marker]);
    $histogram = [];
    $longRunsByLength = [];
    $videosWithRuns = 0;
    $totalRuns = 0;
    $markersInRuns = 0;
    $maxLength = 0;
    while ($row = $stmt->fetch()) {
        $videoId = (string)$row['youtube_id'];
        $runs = yt_censored_marker_runs((string)$row['transcript'], $marker);
        if (!$runs) {
            continue;
        }
        $videosWithRuns++;
        foreach ($runs as $run) {
            $length = (int)$run['length'];
            $histogram[$length] = ($histogram[$length] ?? 0) + 1;
            $totalRuns++;
            $markersInRuns += $length;
            $maxLength = max($maxLength, $length);
            if ($length >= 5) {
                $seconds = yt_seconds_for_char_index($db, $videoId, (int)$run['start_char']);
                $longRunsByLength[$length][] = [
                    'video_id' => $videoId,
                    'title' => (string)$row['title'],
                    'channel' => (string)$row['channel'],
                    'length' => $length,
                    'start_char' => (int)$run['start_char'],
                    'start_seconds' => $seconds,
                    'timestamp' => yt_format_timestamp($seconds),
                    'url' => 'https://www.youtube.com/watch?v=' . rawurlencode($videoId) . '&t=' . $seconds . 's',
                ];
            }
        }
    }
    ksort($histogram, SORT_NUMERIC);
    $rows = [];
    foreach ($histogram as $length => $count) {
        $rows[] = [
            'length' => (int)$length,
            'count' => (int)$count,
            'markers' => (int)$length * (int)$count,
            'runs' => $longRunsByLength[$length] ?? [],
        ];
    }
    return [
        'total_runs' => $totalRuns,
        'markers_in_runs' => $markersInRuns,
        'videos_with_runs' => $videosWithRuns,
        'max_run_length' => $maxLength,
        'histogram' => $rows,
    ];
}

function yt_censored_marker_run_histogram(string $transcript, string $marker = '[ __ ]'): array
{
    $histogram = [];
    foreach (yt_censored_marker_runs($transcript, $marker) as $run) {
        $length = (int)$run['length'];
        $histogram[$length] = ($histogram[$length] ?? 0) + 1;
    }
    ksort($histogram, SORT_NUMERIC);
    return $histogram;
}

function yt_censored_marker_runs(string $transcript, string $marker = '[ __ ]'): array
{
    $markerLength = yt_text_length($marker);
    $markerOffsets = yt_marker_offsets($transcript, $marker);
    $runs = [];
    $runLength = 0;
    $runStart = null;
    $runEnd = null;
    $previousEnd = null;
    foreach ($markerOffsets as $position) {
        $continuesRun = $runLength > 0
            && $previousEnd !== null
            && yt_censored_marker_run_separator(yt_text_slice($transcript, $previousEnd, $position - $previousEnd));
        if ($continuesRun) {
            $runLength++;
            $runEnd = $position + $markerLength;
        } else {
            if ($runLength >= 2) {
                $runs[] = [
                    'length' => $runLength,
                    'start_char' => (int)$runStart,
                    'end_char' => (int)$runEnd,
                ];
            }
            $runLength = 1;
            $runStart = $position;
            $runEnd = $position + $markerLength;
        }
        $previousEnd = $position + $markerLength;
    }
    if ($runLength >= 2) {
        $runs[] = [
            'length' => $runLength,
            'start_char' => (int)$runStart,
            'end_char' => (int)$runEnd,
        ];
    }
    return $runs;
}

function yt_censored_marker_run_separator(string $text): bool
{
    return preg_match('/^[\s[:punct:]]*$/u', $text) === 1;
}

function yt_read_channel_stats_cache(bool $allowStale = false): ?array
{
    $path = yt_stats_cache_path();
    if (!is_file($path)) {
        return null;
    }
    $payload = json_decode((string)file_get_contents($path), true);
    if (!is_array($payload)) {
        return null;
    }
    $cacheVersion = (int)($payload['cache_version'] ?? 0);
    $stats = $payload['stats'] ?? null;
    if (!is_array($stats)) {
        return null;
    }
    if ($cacheVersion !== YT_STATS_CACHE_VERSION && !$allowStale) {
        return null;
    }
    if (isset($stats['censored']) && is_array($stats['censored'])) {
        $stats['censored']['stt'] = yt_read_stt_patch_metrics();
    }
    $stats['cache'] = [
        'generated_at' => (string)($payload['generated_at'] ?? ''),
        'path' => $path,
        'cache_version' => $cacheVersion,
        'expected_cache_version' => YT_STATS_CACHE_VERSION,
        'stale' => $cacheVersion !== YT_STATS_CACHE_VERSION,
        'missing' => false,
        'database_bytes_at_generation' => (int)($stats['database_bytes'] ?? 0),
        'current_database_bytes' => is_file(yt_db_path()) ? filesize(yt_db_path()) : 0,
    ];
    return $stats;
}

function yt_write_channel_stats_cache(PDO $db): array
{
    @set_time_limit(0);
    @ini_set('max_execution_time', '0');
    $stats = yt_compute_channel_stats($db);
    $payload = [
        'cache_version' => YT_STATS_CACHE_VERSION,
        'generated_at' => gmdate('c'),
        'stats' => $stats,
    ];
    $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json !== false) {
        $dir = yt_data_dir();
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $path = yt_stats_cache_path();
        $tmp = $path . '.tmp';
        if (@file_put_contents($tmp, $json, LOCK_EX) !== false) {
            @rename($tmp, $path);
        }
        if (is_file($tmp)) {
            @unlink($tmp);
        }
    }
    $stats['cache'] = [
        'generated_at' => (string)$payload['generated_at'],
        'path' => yt_stats_cache_path(),
        'cache_version' => YT_STATS_CACHE_VERSION,
        'expected_cache_version' => YT_STATS_CACHE_VERSION,
        'stale' => false,
        'missing' => false,
        'database_bytes_at_generation' => (int)$stats['database_bytes'],
        'current_database_bytes' => (int)$stats['database_bytes'],
    ];
    return $stats;
}

function yt_channel_stats_cache_ready(PDO $db): bool
{
    return yt_read_channel_stats_cache() !== null;
}

function yt_refresh_channel_stats(PDO $db): array
{
    return yt_write_channel_stats_cache($db);
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
