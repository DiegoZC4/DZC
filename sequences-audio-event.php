<?php

declare(strict_types=1);

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Robots-Tag: noindex, nofollow');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit;
}

$allowedEvents = [
    'chapter', 'feedinfo', 'milestone', 'page', 'play', 'rate', 'reader',
    'readerjump', 'return', 'search', 'searchnav', 'searchopen', 'share',
    'skip', 'subscribe', 'subscribemenu', 'timelineseek', 'volume',
    'weekopen', 'wordseek',
];

$version = $_GET['v'] ?? '';
$event = $_GET['e'] ?? '';
if ($version !== '1' || !is_string($event) || !in_array($event, $allowedEvents, true)) {
    http_response_code(400);
    exit;
}

// Visitor log. For `page` and `play`, the client IP address and user agent are
// recorded once per (ISO week, reading week) in a file outside the web root,
// so that unique visitors and listeners per week of readings can be counted
// later. Nothing is ever pruned. See docs/ANALYTICS.md.
function statsRoot(): ?string
{
    $docroot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
    if ($docroot === '') {
        return null;
    }
    $dir = dirname($docroot) . '/sequences-audio-stats';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        return null;
    }
    return is_writable($dir) ? $dir : null;
}

function clientAddress(): string
{
    // Behind Hostinger's CDN the visitor is the first forwarded hop
    // (verified 2026-09-14); REMOTE_ADDR alone would be an edge node.
    foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'HTTP_CF_CONNECTING_IP'] as $key) {
        $value = trim((string) ($_SERVER[$key] ?? ''));
        if ($value !== '') {
            return trim(explode(',', $value)[0]);
        }
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

function recordVisitor(string $event): void
{
    $root = statsRoot();
    if ($root === null) {
        return;
    }
    $ip = clientAddress();
    if ($ip === '') {
        return;
    }
    $reading = (string) ($_GET['w'] ?? '');
    if (!preg_match('/^lsrg-\d{1,4}$/', $reading)) {
        $reading = 'none';
    }
    $agent = str_replace(["\t", "\n", "\r"], ' ', (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $line = $ip . "\t" . $agent . "\n";
    $weeks = $root . '/weeks';
    if (!is_dir($weeks) && !@mkdir($weeks, 0700, true)) {
        return;
    }
    $handle = @fopen($weeks . '/' . gmdate('o-\WW') . '__' . $reading . '.' . $event, 'c+');
    if ($handle === false) {
        return;
    }
    if (flock($handle, LOCK_EX)) {
        // Prefix with a newline so a line can only match another whole line.
        if (strpos("\n" . (string) stream_get_contents($handle), "\n" . $line) === false) {
            fseek($handle, 0, SEEK_END);
            fwrite($handle, $line);
        }
        flock($handle, LOCK_UN);
    }
    fclose($handle);
}

if ($event === 'page' || $event === 'play') {
    recordVisitor($event);
}

http_response_code(204);
