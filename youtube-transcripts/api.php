<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

try {
    $db = yt_db(false);
    $action = strtolower((string)($_GET['action'] ?? 'search'));
    if ($action === 'channels') {
        $channels = yt_channels($db);
        $videoCount = array_sum(array_map(static fn (array $row): int => (int)$row['video_count'], $channels));
        yt_json([
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
    if ($action === 'stats') {
        yt_require_data($db);
        if ((string)($_GET['refresh'] ?? '') === '1') {
            yt_refresh_channel_stats($db);
        }
        yt_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'stats' => yt_channel_stats($db),
        ]);
    }
    if ($action === 'patches') {
        yt_require_data($db);
        yt_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'patches' => yt_uncensored_candidates(
                $db,
                (int)($_GET['limit'] ?? 200),
                (string)($_GET['video_id'] ?? '')
            ),
        ]);
    }
    if ($action === 'search') {
        yt_require_data($db);
        $query = (string)($_GET['q'] ?? '');
        $channels = yt_request_channels();
        $videoId = (string)($_GET['video_id'] ?? '');
        $videoIds = yt_request_video_ids();
        $titleFilter = (string)($_GET['title_filter'] ?? ($_GET['title'] ?? ''));
        $limit = (int)($_GET['limit'] ?? 50);
        $timings = [];
        $results = trim($query) === ''
            ? yt_title_search($db, $titleFilter, $channels, $limit, $timings, $videoIds)
            : yt_search($db, $query, $channels, $limit, $videoId, $titleFilter, $timings, $videoIds);
        yt_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'query' => $query,
            'title_filter' => $titleFilter,
            'channel' => count($channels) === 1 ? $channels[0] : '',
            'channels' => $channels,
            'video_id' => $videoId,
            'videos' => $videoIds,
            'timing' => $timings,
            'results' => $results,
        ]);
    }
    yt_json(['ok' => false, 'error' => 'Unknown action.'], 404);
} catch (Throwable $e) {
    yt_json(['ok' => false, 'error' => $e->getMessage()], 400);
}

function yt_request_channels(): array
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

function yt_request_video_ids(): array
{
    $videos = $_GET['videos'] ?? [];
    if (is_string($videos)) {
        $videos = $videos === '' ? [] : explode(',', $videos);
    }
    if (!is_array($videos)) {
        $videos = [];
    }
    return yt_normalize_video_ids($videos);
}

function yt_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
