<?php
declare(strict_types=1);
ini_set('display_errors', '0');
require __DIR__ . '/search.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
try {
    $db = corpus_db();
    $action = (string)($_GET['action'] ?? 'search');
    if (in_array($action, ['channels','status'], true)) {
        $manifest = json_decode((string)$db->query("SELECT value FROM metadata WHERE key='manifest'")->fetchColumn(), true);
        $channels = $db->query('SELECT * FROM channels ORDER BY CASE WHEN corpus="youtube" THEN 1 ELSE 0 END, channel COLLATE NOCASE')->fetchAll();
        $payload = ['ok'=>true, 'channels'=>$channels, 'manifest'=>$manifest,
            'stats'=>['videos'=>$manifest['records'], 'channels'=>$manifest['channels']]];
    } elseif ($action === 'search') {
        $channels = $_GET['channels'] ?? [];
        if (is_string($channels)) $channels = $channels === '' ? [] : explode(',', $channels);
        if (!is_array($channels) || array_filter($channels, 'is_array')) throw new InvalidArgumentException('Invalid channel filter.');
        $categories = $_GET['categories'] ?? [];
        if (!is_array($categories) || array_filter($categories, 'is_array')) throw new InvalidArgumentException('Invalid category filter.');
        if (!empty($_GET['channel'])) $channels[] = (string)$_GET['channel'];
        $payload = ['ok'=>true] + corpus_search($db, trim((string)($_GET['q'] ?? '')), trim((string)($_GET['title_filter'] ?? $_GET['title'] ?? '')),
            $channels, (string)($_GET['collection'] ?? ''), (string)($_GET['video_id'] ?? ''), (int)($_GET['limit'] ?? 60), $categories);
    } else { http_response_code(404); $payload = ['ok'=>false,'error'=>'Unknown action.']; }
} catch (InvalidArgumentException $e) {
    http_response_code(400); $payload = ['ok'=>false,'error'=>$e->getMessage()];
} catch (Throwable $e) {
    error_log('Transcript search: ' . $e->getMessage());
    http_response_code(503); $payload = ['ok'=>false,'error'=>'Transcript search is temporarily unavailable. Please try again.'];
}
echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
