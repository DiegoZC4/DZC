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
        ytscripts_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'channels' => yt_channels($db),
            'database' => yt_database_info($db),
            'stats' => yt_stats($db),
        ]);
    }

    if ($action === 'search') {
        yt_require_data($db);
        ytscripts_json([
            'ok' => true,
            'version' => YT_API_VERSION,
            'query' => $query,
            'channel' => (string)($_GET['channel'] ?? ''),
            'video_id' => (string)($_GET['video_id'] ?? ''),
            'results' => yt_search(
                $db,
                $query,
                (string)($_GET['channel'] ?? ''),
                (int)($_GET['limit'] ?? 50),
                (string)($_GET['video_id'] ?? '')
            ),
        ]);
    }

    ytscripts_json(['ok' => false, 'error' => 'Unknown action.'], 404);
} catch (Throwable $e) {
    ytscripts_json(['ok' => false, 'error' => $e->getMessage()], 400);
}

function ytscripts_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}
