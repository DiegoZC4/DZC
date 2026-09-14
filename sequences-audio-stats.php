<?php

declare(strict_types=1);

// Weekly unique visitors and listeners of the readalong, as JSON. Gated by a
// token whose SHA-256 is embedded here; the token itself lives only on Diego's
// Mac. A wrong or missing token answers 404 so the endpoint is not advertised.

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

const TOKEN_SHA256 = 'be79b50c12d2b00c4c8d0c31cf8e8bc877aed58dfb27b13821e5631d91cd09b4';
const KEEP_WEEKS = 26;

if (!hash_equals(TOKEN_SHA256, hash('sha256', (string) ($_GET['k'] ?? '')))) {
    http_response_code(404);
    exit;
}
header('Content-Type: application/json; charset=utf-8');

$docroot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
$root = $docroot === '' ? '' : dirname($docroot) . '/sequences-audio-stats';
$weeksDir = $root . '/weeks';
$historyFile = $root . '/history.json';
$history = is_file($historyFile) ? (json_decode((string) file_get_contents($historyFile), true) ?: []) : [];

$weeks = [];
if (is_dir($weeksDir)) {
    foreach (scandir($weeksDir) ?: [] as $name) {
        if (!preg_match('/^(\d{4}-W\d{2})\.(page|play)$/', $name, $m)) {
            continue;
        }
        $lines = file($weeksDir . '/' . $name, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        $weeks[$m[1]][$m[2] === 'page' ? 'visitors' : 'listeners'] = count(array_unique($lines));
    }
}
ksort($weeks);

// Fold weeks older than the retention window into history and drop their hashes.
$cutoff = gmdate('o-\WW', strtotime('-' . KEEP_WEEKS . ' weeks'));
foreach ($weeks as $week => $counts) {
    if (strcmp($week, $cutoff) < 0) {
        $history[$week] = $counts;
        foreach (['page', 'play'] as $kind) {
            @unlink($weeksDir . '/' . $week . '.' . $kind);
        }
        unset($weeks[$week]);
    }
}
if ($history) {
    ksort($history);
    @file_put_contents($historyFile, json_encode($history), LOCK_EX);
}

$forwarded = 'none';
foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'HTTP_CF_CONNECTING_IP'] as $key) {
    if (trim((string) ($_SERVER[$key] ?? '')) !== '') {
        $forwarded = $key;
        break;
    }
}

// Diagnostic for the token holder only: 8-char hashes of each address
// candidate, never the values, so stability across two requests can be
// checked without exposing anything.
$short = static fn (string $v): string => $v === '' ? '' : substr(hash('sha256', $v), 0, 8);
$xff = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
$hops = $xff === '' ? [] : array_map('trim', explode(',', $xff));
$probe = [
    'xff_hops' => count($hops),
    'xff_first' => $short($hops[0] ?? ''),
    'xff_last' => $short($hops[count($hops) - 1] ?? ''),
    'x_real_ip' => $short((string) ($_SERVER['HTTP_X_REAL_IP'] ?? '')),
    'cf_connecting_ip' => $short((string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? '')),
    'remote_addr' => $short((string) ($_SERVER['REMOTE_ADDR'] ?? '')),
    'user_agent' => $short((string) ($_SERVER['HTTP_USER_AGENT'] ?? '')),
];

echo json_encode([
    'generated' => gmdate('c'),
    'this_week' => gmdate('o-\WW'),
    'weeks' => (object) $weeks,
    'history' => (object) $history,
    'probe' => $probe,
    'storage' => [
        'exists' => $root !== '' && is_dir($root),
        'writable' => $root !== '' && is_dir($root) && is_writable($root),
        'client_address_source' => $forwarded,
    ],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
