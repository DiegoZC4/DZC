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

// Weekly unique counting, deliberately minimal. For `page` and `play` only, a
// SHA-256 of (weekly salt | client address | user agent) is appended to a per-
// week file outside the web root. No address, agent, cookie or timestamp is
// stored; the salt is derived from a server-side secret and the ISO week, so
// the same visitor hashes identically within a week (which is what makes the
// weekly count unique) and to something unrelated the next week.
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
    // The site sits behind Hostinger's CDN, so REMOTE_ADDR is usually an edge
    // node; the visitor is the first hop of the forwarded chain when present.
    foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'HTTP_CF_CONNECTING_IP'] as $key) {
        $value = trim((string) ($_SERVER[$key] ?? ''));
        if ($value !== '') {
            return trim(explode(',', $value)[0]);
        }
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

function recordWeeklyUnique(string $event): void
{
    $root = statsRoot();
    if ($root === null) {
        return;
    }
    $secretFile = $root . '/secret';
    if (!is_file($secretFile)) {
        @file_put_contents($secretFile, bin2hex(random_bytes(32)), LOCK_EX);
        @chmod($secretFile, 0600);
    }
    $secret = (string) @file_get_contents($secretFile);
    if ($secret === '') {
        return;
    }
    $week = gmdate('o-\WW');
    $salt = hash('sha256', $secret . '|' . $week);
    $id = hash('sha256', $salt . '|' . clientAddress() . '|' . (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $weeks = $root . '/weeks';
    if (!is_dir($weeks) && !@mkdir($weeks, 0700, true)) {
        return;
    }
    $handle = @fopen($weeks . '/' . $week . '.' . $event, 'c+');
    if ($handle === false) {
        return;
    }
    if (flock($handle, LOCK_EX)) {
        $existing = (string) stream_get_contents($handle);
        if (strpos($existing, $id . "\n") === false) {
            fseek($handle, 0, SEEK_END);
            fwrite($handle, $id . "\n");
        }
        flock($handle, LOCK_UN);
    }
    fclose($handle);
}

if ($event === 'page' || $event === 'play') {
    recordWeeklyUnique($event);
}

// Hostinger's access log still records the validated query string; nothing
// else about the request is kept.
http_response_code(204);
