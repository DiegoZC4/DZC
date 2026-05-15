<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$source = YT_DEFAULT_SOURCE_DIR;
$rebuild = false;
$limitFiles = 0;
$skipExisting = false;
$bulk = false;
$segmentIntervalSeconds = 0;
$deferFts = false;

foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--rebuild') {
        $rebuild = true;
    } elseif ($arg === '--skip-existing') {
        $skipExisting = true;
    } elseif ($arg === '--bulk') {
        $bulk = true;
    } elseif ($arg === '--defer-fts') {
        $deferFts = true;
    } elseif (str_starts_with($arg, '--source=')) {
        $source = substr($arg, strlen('--source='));
    } elseif (str_starts_with($arg, '--limit-files=')) {
        $limitFiles = max(0, (int)substr($arg, strlen('--limit-files=')));
    } elseif (str_starts_with($arg, '--segment-interval=')) {
        $segmentIntervalSeconds = max(0, (int)substr($arg, strlen('--segment-interval=')));
    }
}

$db = yt_db();
if ($bulk) {
    $db->exec('PRAGMA synchronous = OFF');
    $db->exec('PRAGMA temp_store = MEMORY');
    $db->exec('PRAGMA cache_size = -200000');
}
$stats = yt_import_dir($db, $source, $rebuild, $limitFiles, $skipExisting, $segmentIntervalSeconds, $deferFts);
$total = yt_stats($db);

echo json_encode([
    'ok' => true,
    'imported' => $stats,
    'database' => yt_db_path(),
    'total' => $total,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
