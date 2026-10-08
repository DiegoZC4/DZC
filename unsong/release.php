<?php
declare(strict_types=1);

// Assets live OUTSIDE public_html. The server clock, never a query parameter,
// decides which pre-validated weekly snapshot and assets may be served.
function unsong_selection(string $uri, array $plan, int $now): ?array {
    $path = rawurldecode((string) parse_url($uri, PHP_URL_PATH));
    if (substr($path, 0, 8) !== '/unsong/') return null;
    $name = substr($path, 8);
    if (in_array($name, ['data/catalog.json', 'feed.xml', 'feed-opus.xml'], true)) {
        $snapshot = null;
        foreach ($plan['snapshots'] as $candidate) {
            if ($candidate['at'] <= $now) $snapshot = $candidate;
        }
        if ($snapshot === null) return null;
        return $snapshot['files'][$name] ?? null;
    }
    $asset = $plan['assets'][$name] ?? null;
    return $asset !== null && $asset['at'] <= $now ? $asset : null;
}

function unsong_range(?string $range, int $size): ?array {
    if ($size < 1) return null;
    if ($range === null) return [0, $size - 1, 200];
    if (!preg_match('/\Abytes=(\d*)-(\d*)\z/', $range, $m) || ($m[1] === '' && $m[2] === '')) return null;
    if ($m[1] === '') {
        $length = (int) $m[2];
        if ($length < 1) return null;
        return [max(0, $size - $length), $size - 1, 206];
    }
    $start = (int) $m[1];
    $end = $m[2] === '' ? $size - 1 : min((int) $m[2], $size - 1);
    return $start >= $size || $end < $start ? null : [$start, $end, 206];
}

function unsong_error(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-LiteSpeed-Cache-Control: no-cache');
    header('X-Content-Type-Options: nosniff');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo $message . "\n";
}

function unsong_serve(string $root): void {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        header('Allow: GET, HEAD');
        unsong_error(405, 'Method not allowed');
        return;
    }
    $raw = @file_get_contents($root . '/release-plan.json');
    $plan = $raw === false ? null : json_decode($raw, true);
    if (!is_array($plan) || ($plan['edition'] ?? '') !== 'unsong-ten-v1') {
        unsong_error(503, 'Reading assets are being prepared. Please try again shortly.');
        return;
    }
    $entry = unsong_selection($_SERVER['REQUEST_URI'] ?? '', $plan, time());
    if ($entry === null) {
        unsong_error(404, 'Not released or unknown asset');
        return;
    }
    $file = $root . '/' . $entry['file'];
    $actual = realpath($file);
    $base = realpath($root);
    if ($actual === false || $base === false || substr($actual, 0, strlen($base) + 1) !== $base . '/' || !is_file($actual) || filesize($actual) !== $entry['bytes']) {
        unsong_error(503, 'Reading asset unavailable. Please try again shortly.');
        return;
    }
    $size = $entry['bytes'];
    $range = unsong_range($_SERVER['HTTP_RANGE'] ?? null, $size);
    if ($range === null) {
        header('Content-Range: bytes */' . $size);
        unsong_error(416, 'Requested range not satisfiable');
        return;
    }
    [$start, $end, $status] = $range;
    $handle = @fopen($actual, 'rb');
    if ($handle === false) {
        unsong_error(503, 'Reading asset unavailable. Please try again shortly.');
        return;
    }
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) ob_end_clean();
    http_response_code($status);
    header('Content-Type: ' . $entry['type']);
    header('Content-Length: ' . ($end - $start + 1));
    header('Accept-Ranges: bytes');
    header('X-Content-Type-Options: nosniff');
    header('ETag: "' . $entry['sha256'] . '"');
    // Already-released audio is immutable and safe to cache. Catalog/RSS and
    // unreleased-asset errors stay uncached, so a cache cannot postpone Monday.
    $audio = substr($entry['type'], 0, 6) === 'audio/';
    header($audio ? 'Cache-Control: public, max-age=604800, immutable' : 'Cache-Control: no-store');
    header($audio ? 'X-LiteSpeed-Cache-Control: public, max-age=604800' : 'X-LiteSpeed-Cache-Control: no-cache');
    if ($status === 206) header("Content-Range: bytes $start-$end/$size");
    if ($method !== 'HEAD') {
        fseek($handle, $start);
        $remaining = $end - $start + 1;
        while ($remaining > 0 && !connection_aborted()) {
            $block = fread($handle, min(262144, $remaining));
            if ($block === false || $block === '') break;
            echo $block;
            $remaining -= strlen($block);
        }
    }
    fclose($handle);
}

if (!defined('UNSONG_LIBRARY_ONLY')) {
    unsong_serve(dirname(__DIR__, 2) . '/.unsong-private/unsong-ten-v1');
}
