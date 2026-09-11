<?php
declare(strict_types=1);
require_once __DIR__ . '/engine.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
ini_set('display_errors', '0');

function nk_response(array $body, int $status = 200): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}
function nk_database(): PDO {
    $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__));
    nk_require($root !== false, 'Storage is unavailable.', 503);
    $directory = getenv('NUTSHELL_DATA_DIR') ?: dirname($root) . '/.nutshell-private';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Cannot create private game storage.');
    $path = realpath($directory);
    nk_require($path !== false && $path !== $root && !str_starts_with($path . '/', $root . '/'), 'Game storage must be outside the public website.', 503);
    $db = new PDO('sqlite:' . $path . '/rooms.sqlite3', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout = 4000');
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, updated INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, amount INTEGER NOT NULL, expires INTEGER NOT NULL)');
    return $db;
}
function nk_limit(PDO $db, string $label, int $maximum, int $period): void {
    $time = time();
    // Store only a bucketed hash, not visitors’ raw IP addresses.
    $key = hash('sha256', $label . ':' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . ':' . intdiv($time, $period));
    $q = $db->prepare('INSERT INTO limits(bucket, amount, expires) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET amount = amount + 1');
    $q->execute([$key, $time + $period]);
    $q = $db->prepare('SELECT amount FROM limits WHERE bucket = ?');
    $q->execute([$key]);
    nk_require((int)$q->fetchColumn() <= $maximum, 'Too many requests. Give it a moment and try again.', 429);
}

$db = null;
$locked = false;
try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    nk_require(in_array($method, ['GET', 'POST'], true), 'Use GET or POST.', 405);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') nk_require(parse_url($origin, PHP_URL_HOST) === parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST), 'Use this game from its own website.', 403);
    nk_require((int)($_SERVER['CONTENT_LENGTH'] ?? 0) <= 10000, 'Request too large.', 413);
    $body = [];
    if ($method === 'POST') {
        nk_require(str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json'), 'Send JSON.', 415);
        $raw = file_get_contents('php://input', false, null, 0, 10001);
        nk_require(strlen($raw) <= 10000, 'Request too large.', 413);
        $body = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
        nk_require(is_array($body), 'Invalid request.');
    }
    $action = $method === 'GET' ? 'state' : ($body['action'] ?? '');
    nk_require(is_string($action), 'Invalid action.');
    $code = strtoupper((string)($method === 'GET' ? ($_GET['room'] ?? '') : ($body['room'] ?? '')));
    if ($action !== 'create') nk_require(preg_match('/^[A-HJ-NP-Z2-9]{8}$/D', $code) === 1, 'Enter the eight-character room code.');
    $db = nk_database();
    $db->exec('BEGIN IMMEDIATE');
    $locked = true;
    $now = microtime(true);
    $expired = $db->prepare('DELETE FROM rooms WHERE updated < ?');
    $expired->execute([time() - 86400]);
    $db->prepare('DELETE FROM limits WHERE expires < ?')->execute([time()]);
    nk_limit($db, 'request', 1200, 60);
    $token = (string)($_SERVER['HTTP_X_NUTSHELL_TOKEN'] ?? '');
    $newToken = null;
    if ($action === 'create') {
        nk_limit($db, 'create', 20, 3600);
        nk_require((int)$db->query('SELECT COUNT(*) FROM rooms')->fetchColumn() < 300, 'All rooms are busy. Please try again later.', 503);
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        do {
            $code = '';
            for ($i = 0; $i < 8; $i++) $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            $q = $db->prepare('SELECT code FROM rooms WHERE code = ?');
            $q->execute([$code]);
        } while ($q->fetchColumn());
        [$room, $newToken] = nk_new($code, nk_text($body['name'] ?? '', 24, 'Name'), $now);
        $id = nk_identity($room, $newToken);
        $oldVersion = 0;
        $updated = 0;
    } else {
        $q = $db->prepare('SELECT state, updated FROM rooms WHERE code = ?');
        $q->execute([$code]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        nk_require($row !== false, 'That room does not exist or has expired. Rooms expire after a day without activity.', 404);
        $room = json_decode($row['state'], true, 64, JSON_THROW_ON_ERROR);
        $oldVersion = $room['version'];
        $updated = (int)$row['updated'];
        nk_tick($room, $now);
        if ($action === 'join') {
            nk_limit($db, 'join', 100, 3600);
            [$id, $newToken] = nk_join($room, nk_text($body['name'] ?? '', 24, 'Name'));
        } else {
            $id = nk_identity($room, $token);
            if ($action !== 'state') nk_action($room, $id, $action, $body, $now);
        }
    }
    if (count($room['players']) === 0) {
        $db->prepare('DELETE FROM rooms WHERE code = ?')->execute([$code]);
    } elseif ($room['version'] !== $oldVersion || $updated < time() - 60) {
        $q = $db->prepare('INSERT INTO rooms(code, state, updated) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET state = excluded.state, updated = excluded.updated');
        $q->execute([$code, json_encode($room, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), time()]);
    }
    $db->exec('COMMIT');
    $locked = false;
    $result = $action === 'leave' ? ['left' => true] : ['room' => nk_view($room, $id, microtime(true))];
    if ($newToken !== null) $result['token'] = $newToken;
    nk_response($result);
} catch (DomainException $error) {
    if ($locked) $db->exec('ROLLBACK');
    nk_response(['error' => $error->getMessage()], $error->getCode() ?: 400);
} catch (JsonException $error) {
    if ($locked) $db->exec('ROLLBACK');
    nk_response(['error' => 'Invalid request data.'], 400);
} catch (Throwable $error) {
    if ($locked) $db->exec('ROLLBACK');
    error_log('Nutshell: ' . $error->getMessage());
    nk_response(['error' => 'The room server is temporarily unavailable. Your input is still here; try again.'], 503);
}
