<?php
declare(strict_types=1);

header('Content-Type: application/json');

$remote = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($remote, ['127.0.0.1', '::1'], true)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Homepage rebuild is only available from localhost.']);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'POST homepage-manifest.json to rebuild index.html.']);
    exit;
}

$root = __DIR__;
$manifestPath = $root . '/homepage-manifest.json';
$builderPath = $root . '/tools/build_homepage.py';
$body = file_get_contents('php://input');
$manifest = json_decode($body, true);

if (!is_array($manifest) || !isset($manifest['pages']) || !is_array($manifest['pages'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Request body must be a homepage manifest with a pages array.']);
    exit;
}

$encodedManifest = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
$encodedManifest = preg_replace_callback('/^( +)/m', fn ($match) => str_repeat(' ', intdiv(strlen($match[1]), 2)), $encodedManifest) . "\n";
if (file_put_contents($manifestPath, $encodedManifest) === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write homepage-manifest.json.']);
    exit;
}

if (!function_exists('exec')) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'PHP exec() is disabled; run python3 tools/build_homepage.py manually.']);
    exit;
}

$command = 'python3 ' . escapeshellarg($builderPath) . ' 2>&1';
$output = [];
$exitCode = 0;
exec($command, $output, $exitCode);

if ($exitCode !== 0) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Homepage builder failed.',
        'output' => implode("\n", $output),
    ]);
    exit;
}

echo json_encode([
    'ok' => true,
    'output' => implode("\n", $output),
    'visibleCards' => count(array_filter($manifest['pages'], fn ($page) => ($page['visible'] ?? true) !== false)),
]);
