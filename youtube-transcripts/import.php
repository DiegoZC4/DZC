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

foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--rebuild') {
        $rebuild = true;
    } elseif (str_starts_with($arg, '--source=')) {
        $source = substr($arg, strlen('--source='));
    } elseif (str_starts_with($arg, '--limit-files=')) {
        $limitFiles = max(0, (int)substr($arg, strlen('--limit-files=')));
    }
}

$db = yt_db();
$stats = yt_import_dir($db, $source, $rebuild, $limitFiles);
$total = yt_stats($db);

echo json_encode([
    'ok' => true,
    'imported' => $stats,
    'database' => yt_db_path(),
    'total' => $total,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;

