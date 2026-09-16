<?php

declare(strict_types=1);

// Visitor log as JSON, for the token holder. The token exists only on Diego's
// Mac; this file embeds its SHA-256 and answers 404 to anything else.

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

const TOKEN_SHA256 = 'be79b50c12d2b00c4c8d0c31cf8e8bc877aed58dfb27b13821e5631d91cd09b4';

if (!hash_equals(TOKEN_SHA256, hash('sha256', (string) ($_GET['k'] ?? '')))) {
    http_response_code(404);
    exit;
}
header('Content-Type: application/json; charset=utf-8');

$docroot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
$root = $docroot === '' ? '' : dirname($docroot) . '/sequences-audio-stats';
$weeksDir = $root . '/weeks';

// Remove artifacts of the earlier hashed counter (format 1).
foreach (['secret', 'history.json'] as $legacy) {
    @unlink($root . '/' . $legacy);
}

$weeks = [];
if (is_dir($weeksDir)) {
    foreach (scandir($weeksDir) ?: [] as $name) {
        if (preg_match('/^\d{4}-W\d{2}\.(page|play)$/', $name)) {
            @unlink($weeksDir . '/' . $name);
            continue;
        }
        if (!preg_match('/^(\d{4}-W\d{2})__(lsrg-\d+|none)\.(page|play)$/', $name, $m)) {
            continue;
        }
        [$_, $week, $reading, $kind] = $m;
        $ips = [];
        $devices = 0;
        foreach (file($weeksDir . '/' . $name, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $ip = explode("\t", $line, 2)[0];
            if ($ip !== '') {
                $ips[$ip] = true;
                $devices++;
            }
        }
        ksort($ips);
        $weeks[$week][$reading][$kind === 'page' ? 'visitors' : 'listeners'] = [
            'unique_ips' => count($ips),
            'unique_devices' => $devices,
            'ips' => array_keys($ips),
        ];
        $weeks[$week]['all_readings']['ips_' . ($kind === 'page' ? 'visitors' : 'listeners')] =
            array_merge($weeks[$week]['all_readings']['ips_' . ($kind === 'page' ? 'visitors' : 'listeners')] ?? [], array_keys($ips));
    }
}
ksort($weeks);
foreach ($weeks as $week => &$entry) {
    foreach (['visitors', 'listeners'] as $kind) {
        $list = array_values(array_unique($entry['all_readings']['ips_' . $kind] ?? []));
        $entry['all_readings'][$kind . '_unique_ips'] = count($list);
        unset($entry['all_readings']['ips_' . $kind]);
    }
}
unset($entry);

echo json_encode([
    'format' => 2,
    'generated' => gmdate('c'),
    'this_week' => gmdate('o-\WW'),
    'weeks' => (object) $weeks,
    'storage' => [
        'exists' => $root !== '' && is_dir($root),
        'writable' => $root !== '' && is_dir($root) && is_writable($root),
    ],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
