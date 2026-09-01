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
    'chapter',
    'feedinfo',
    'milestone',
    'page',
    'play',
    'rate',
    'reader',
    'readerjump',
    'return',
    'search',
    'searchnav',
    'searchopen',
    'share',
    'skip',
    'subscribe',
    'subscribemenu',
    'timelineseek',
    'volume',
    'weekopen',
    'wordseek',
];

$version = $_GET['v'] ?? '';
$event = $_GET['e'] ?? '';
if ($version !== '1' || !is_string($event) || !in_array($event, $allowedEvents, true)) {
    http_response_code(400);
    exit;
}

// Hostinger's access log records the validated query string; no database,
// cookie, request body, or persistent visitor identifier is needed.
http_response_code(204);
