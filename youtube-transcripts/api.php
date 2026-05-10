<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

try {
    $db = yt_db();
    $action = strtolower((string)($_GET['action'] ?? 'search'));
    if ($action === 'channels') {
        yt_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'channels' => yt_channels($db),
            'stats' => yt_stats($db),
        ]);
    }
    if ($action === 'search') {
        $query = (string)($_GET['q'] ?? '');
        $channel = (string)($_GET['channel'] ?? '');
        $limit = (int)($_GET['limit'] ?? 50);
        yt_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'query' => $query,
            'channel' => $channel,
            'results' => yt_search($db, $query, $channel, $limit),
        ]);
    }
    yt_json(['ok' => false, 'error' => 'Unknown action.'], 404);
} catch (Throwable $e) {
    yt_json(['ok' => false, 'error' => $e->getMessage()], 400);
}

function yt_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

