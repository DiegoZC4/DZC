<?php
declare(strict_types=1);

require dirname(__DIR__) . '/youtube-transcripts/lib.php';

try {
    $db = yt_db(false);
    $action = strtolower((string)($_GET['action'] ?? ''));
    $query = trim((string)($_GET['q'] ?? ''));

    if ($action === '') {
        $action = $query === '' ? 'status' : 'search';
    }

    if ($action === 'status') {
        ytscripts_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'route' => '/ytscripts',
            'database' => yt_database_info($db),
            'stats' => yt_stats($db),
            'examples' => [
                '/ytscripts?action=channels',
                '/ytscripts?q=movement&channel=Lex%20Fridman',
                '/ytscripts?q=physics&video_id=-t1_ffaFXao',
                '/ytscripts?action=search&q=bro%20science&limit=10',
            ],
        ]);
    }

    if ($action === 'channels') {
        $channels = yt_channels($db);
        $videoCount = array_sum(array_map(static fn (array $row): int => (int)$row['video_count'], $channels));
        ytscripts_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'channels' => $channels,
            'database' => [
                'path' => yt_db_path(),
                'exists' => is_file(yt_db_path()),
                'bytes' => is_file(yt_db_path()) ? filesize(yt_db_path()) : 0,
                'ready' => $videoCount > 0,
            ],
            'stats' => [
                'videos' => $videoCount,
                'segments' => null,
                'channels' => count($channels),
            ],
        ]);
    }

    if ($action === 'search') {
        yt_require_data($db);
        $channels = ytscripts_request_channels();
        $titleFilter = (string)($_GET['title_filter'] ?? ($_GET['title'] ?? ''));
        $timings = [];
        $results = trim($query) === ''
            ? yt_title_search($db, $titleFilter, $channels, (int)($_GET['limit'] ?? 50), $timings)
            : yt_search(
                $db,
                $query,
                $channels,
                (int)($_GET['limit'] ?? 50),
                (string)($_GET['video_id'] ?? ''),
                $titleFilter,
                $timings
            );
        ytscripts_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'query' => $query,
            'title_filter' => $titleFilter,
            'channel' => count($channels) === 1 ? $channels[0] : '',
            'channels' => $channels,
            'video_id' => (string)($_GET['video_id'] ?? ''),
            'timing' => $timings,
            'results' => $results,
        ]);
    }

    ytscripts_json(['ok' => false, 'error' => 'Unknown action.'], 404);
} catch (Throwable $e) {
    ytscripts_json(['ok' => false, 'error' => $e->getMessage()], 400);
}

function ytscripts_request_channels(): array
{
    $channels = $_GET['channels'] ?? [];
    if (is_string($channels)) {
        $channels = $channels === '' ? [] : explode(',', $channels);
    }
    if (!is_array($channels)) {
        $channels = [];
    }
    $legacy = (string)($_GET['channel'] ?? '');
    if ($legacy !== '') {
        $channels[] = $legacy;
    }
    return yt_normalize_channels($channels);
}

function ytscripts_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
