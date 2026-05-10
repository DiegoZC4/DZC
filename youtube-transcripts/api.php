<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

try {
    $db = yt_db(false);
    $action = strtolower((string)($_GET['action'] ?? 'search'));
    if ($action === 'channels') {
        yt_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'channels' => yt_channels($db),
            'database' => yt_database_info($db),
            'stats' => yt_stats($db),
        ]);
    }
    if ($action === 'search') {
        yt_require_data($db);
        $query = (string)($_GET['q'] ?? '');
        $channels = yt_request_channels();
        $videoId = (string)($_GET['video_id'] ?? '');
        $limit = (int)($_GET['limit'] ?? 50);
        yt_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'query' => $query,
            'channel' => count($channels) === 1 ? $channels[0] : '',
            'channels' => $channels,
            'video_id' => $videoId,
            'results' => yt_search($db, $query, $channels, $limit, $videoId),
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

function yt_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
