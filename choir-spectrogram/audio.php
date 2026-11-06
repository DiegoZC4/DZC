<?php
// The PHP development server does not serve byte ranges for static MP3 files.
// Resolve only catalog IDs, never a caller-supplied filesystem path.
declare(strict_types=1);
$id = $_GET['recording'] ?? 'the-seed-2026-10-25';
$catalog = json_decode(file_get_contents(__DIR__ . '/recordings.json'), true);
$file = null;
foreach ($catalog['recordings'] ?? [] as $recording) {
    foreach ($recording['channels'] as $channel) {
        if ($channel['recordingId'] !== $id) { continue; }
        $candidate = realpath(__DIR__ . '/' . $channel['audio']);
        if ($candidate && str_starts_with($candidate, __DIR__ . '/data/') &&
            pathinfo($candidate, PATHINFO_EXTENSION) === 'mp3') { $file = $candidate; }
    }
}
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'HEAD'], true)) {
    header('Allow: GET, HEAD'); http_response_code(405); exit;
}
if (!$file || !is_file($file)) { http_response_code(404); exit; }
$size = filesize($file);
$start = 0;
$end = $size - 1;
$range = $_SERVER['HTTP_RANGE'] ?? '';
header('Content-Type: audio/mpeg');
header('Accept-Ranges: bytes');
header('Cache-Control: private, max-age=3600');
header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');
if ($range !== '') {
    if (!preg_match('/^bytes=(\d*)-(\d*)$/D', trim($range), $match) ||
        ($match[1] === '' && $match[2] === '')) {
        http_response_code(416); header("Content-Range: bytes */$size"); exit;
    }
    if ($match[1] === '') {
        $suffix = (int) $match[2];
        if ($suffix <= 0) { http_response_code(416); header("Content-Range: bytes */$size"); exit; }
        $start = max(0, $size - $suffix);
    } else {
        $start = (int) $match[1];
        if ($match[2] !== '') { $end = min($end, (int) $match[2]); }
    }
    if ($start >= $size || $end < $start) {
        http_response_code(416); header("Content-Range: bytes */$size"); exit;
    }
    // A paused browser must not occupy PHP's single worker with an open-ended request.
    $end = min($end, $start + 65536 - 1);
    http_response_code(206);
    header("Content-Range: bytes $start-$end/$size");
}
header('Content-Length: ' . ($end - $start + 1));
if ($method === 'HEAD') { exit; }
$handle = fopen($file, 'rb');
fseek($handle, $start);
$remaining = $end - $start + 1;
while ($remaining > 0 && !feof($handle) && !connection_aborted()) {
    $chunk = fread($handle, min(65536, $remaining));
    if ($chunk === false || $chunk === '') { break; }
    echo $chunk;
    $remaining -= strlen($chunk);
}
fclose($handle);
