<?php
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
function reply(array $data): never { echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES); exit; }
function readJson(): array {
    if (($_SERVER['CONTENT_TYPE'] ?? '') !== 'application/json') throw new MeleteHttpError(415, 'JSON required');
    $raw = file_get_contents('php://input', false, null, 0, 4 * 1024 * 1024 + 1);
    if (strlen($raw) > 4 * 1024 * 1024) throw new MeleteHttpError(413, 'Backup metadata too large');
    $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($data)) throw new MeleteHttpError(400, 'Invalid request');
    return $data;
}
try {
    $config = require is_file(__DIR__ . '/config.local.php') ? __DIR__ . '/config.local.php' : __DIR__ . '/config.example.php';
    $directory = $config['data_dir'] ?? '';
    if (!$directory || $directory[0] !== '/') throw new MeleteHttpError(503, 'Private backup storage is not configured');
    umask(0077);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new MeleteHttpError(503, 'Private backup storage unavailable');
    $directory = realpath($directory); $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if ($root && ($directory === $root || str_starts_with($directory, $root . '/'))) throw new MeleteHttpError(503, 'Backup storage must be outside the public web directory');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if ($origin !== null && !in_array($origin, $config['origins'], true)) throw new MeleteHttpError(403, 'Origin not allowed');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['GET', 'POST'], true)) throw new MeleteHttpError(405, 'Method not allowed');
    if ($method === 'POST' && !$origin) throw new MeleteHttpError(403, 'Origin required');
    if (!is_dir($directory . '/sessions')) mkdir($directory . '/sessions', 0700);
    session_save_path($directory . '/sessions');
    session_name('melete_session');
    session_start(['use_strict_mode' => true, 'cookie_httponly' => true, 'cookie_samesite' => 'Lax',
        'cookie_secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'cookie_path' => '/', 'gc_maxlifetime' => 604800]);
    if (($_SESSION['expires'] ?? PHP_INT_MAX) < time()) $_SESSION = [];
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    $_SESSION['nonce'] ??= bin2hex(random_bytes(32));
    $action = (string)($_GET['action'] ?? 'status');
    if ($method === 'POST' && !hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_MELETE_CSRF'] ?? '')) throw new MeleteHttpError(403, 'Session expired; sign in again');
    if ($action === 'status' && $method === 'GET') reply(['configured' => (bool)($config['client_id'] ?? ''), 'clientId' => $config['client_id'] ?? '',
        'csrf' => $_SESSION['csrf'], 'nonce' => $_SESSION['nonce'], 'user' => $_SESSION['user'] ?? null]);
    if ($action === 'login' && $method === 'POST') {
        if (($_SESSION['login_at'] ?? 0) > time() - 2) throw new MeleteHttpError(429, 'Please wait before retrying sign-in');
        $_SESSION['login_at'] = time(); $body = readJson();
        $claims = meleteVerify((string)($body['credential'] ?? ''), $config['client_id'] ?? '', $_SESSION['nonce'], meleteCerts($directory));
        session_regenerate_id(true);
        $_SESSION['owner'] = hash('sha256', $claims['sub']);
        $_SESSION['user'] = ['id' => $_SESSION['owner'], 'name' => substr((string)($claims['name'] ?? 'Signed in'), 0, 120)];
        $_SESSION['expires'] = time() + 604800; $_SESSION['nonce'] = bin2hex(random_bytes(32)); $_SESSION['csrf'] = bin2hex(random_bytes(32));
        reply(['user' => $_SESSION['user'], 'csrf' => $_SESSION['csrf']]);
    }
    if ($action === 'logout' && $method === 'POST') {
        $_SESSION = []; session_destroy(); setcookie('melete_session', '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']); reply(['ok' => true]);
    }
    $owner = $_SESSION['owner'] ?? null;
    if (!$owner) throw new MeleteHttpError(401, 'Sign in before accessing backups');
    session_write_close();
    $db = meleteDatabase($directory);
    if ($action === 'load' && $method === 'GET') reply(['profile' => meleteProfile($db, $owner, meleteId($_GET['key'] ?? null))]);
    if ($action === 'blob') {
        $hash = meleteId($_GET['hash'] ?? null);
        if ($method === 'GET') {
            $q = $db->prepare('SELECT data FROM blobs WHERE owner=? AND hash=?'); $q->execute([$owner, $hash]); $raw = $q->fetchColumn();
            if ($raw === false) throw new MeleteHttpError(404, 'Recording not found');
            header('Content-Type: application/octet-stream'); echo $raw; exit;
        }
        if (($_SERVER['CONTENT_TYPE'] ?? '') !== 'application/octet-stream') throw new MeleteHttpError(415, 'Binary recording block required');
        $raw = file_get_contents('php://input', false, null, 0, 1048577);
        if (!strlen($raw) || strlen($raw) > 1048576 || !hash_equals($hash, hash('sha256', $raw))) throw new MeleteHttpError(400, 'Invalid recording block');
        $db->exec('BEGIN IMMEDIATE');
        meleteCollect($db, $owner);
        $q = $db->prepare('SELECT 1 FROM blobs WHERE owner=? AND hash=?'); $q->execute([$owner, $hash]);
        if (!$q->fetchColumn()) {
            $q = $db->prepare('SELECT COALESCE(SUM(bytes),0) FROM blobs WHERE owner=?'); $q->execute([$owner]);
            if ((int)$q->fetchColumn() + strlen($raw) > ($config['quota_bytes'] ?? 268435456)) throw new MeleteHttpError(413, 'Cloud quota reached. Local recordings were kept.');
            $q = $db->prepare('INSERT INTO blobs VALUES (?,?,?,?,?)');
            $q->bindValue(1, $owner); $q->bindValue(2, $hash); $q->bindValue(3, $raw, PDO::PARAM_LOB); $q->bindValue(4, strlen($raw), PDO::PARAM_INT); $q->bindValue(5, time(), PDO::PARAM_INT); $q->execute();
        }
        $db->exec('COMMIT'); reply(['ok' => true]);
    }
    if (in_array($action, ['save', 'delete'], true) && $method === 'POST') {
        $body = readJson(); $key = meleteId($body['key'] ?? null);
        if (!is_int($body['revision'] ?? null) || $body['revision'] < 0) throw new MeleteHttpError(400, 'Revision required');
        if ($action === 'save') meleteValidatePayload($body['payload'] ?? [], $key);
        $db->exec('BEGIN IMMEDIATE');
        $old = meleteProfile($db, $owner, $key);
        if (($old['revision'] ?? 0) !== $body['revision']) throw new MeleteHttpError(409, 'Cloud revision changed');
        if ($action === 'delete') {
            $q = $db->prepare('DELETE FROM profiles WHERE owner=? AND slot=?'); $q->execute([$owner, $key]);
            meleteCollect($db, $owner); $db->exec('COMMIT'); reply(['ok' => true]);
        }
        foreach ($body['payload']['records'] as $entry) foreach (['audio', 'pitches'] as $type) {
            $bytes = 0;
            foreach ($entry[$type]['chunks'] as $hash) {
                $q = $db->prepare('SELECT bytes FROM blobs WHERE owner=? AND hash=?'); $q->execute([$owner, $hash]); $size = $q->fetchColumn();
                if ($size === false) throw new MeleteHttpError(400, 'Upload all recording blocks before saving');
                $bytes += (int)$size;
            }
            if ($bytes !== $entry[$type]['bytes']) throw new MeleteHttpError(400, 'Incomplete recording');
        }
        $q = $db->prepare('SELECT COUNT(*) FROM profiles WHERE owner=?'); $q->execute([$owner]);
        if (!$old && $q->fetchColumn() >= 256) throw new MeleteHttpError(413, 'Cloud profile limit reached');
        $q = $db->prepare('INSERT OR REPLACE INTO profiles VALUES (?,?,?,?,?)');
        $q->execute([$owner, $key, $body['revision'] + 1, json_encode($body['payload'], JSON_THROW_ON_ERROR), time()]);
        meleteCollect($db, $owner); $db->exec('COMMIT'); reply(['profile' => meleteProfile($db, $owner, $key)]);
    }
    throw new MeleteHttpError(404, 'Unknown backup action');
} catch (Throwable $error) {
    // SQLite rolls back the connection on failure; never expose private paths or token details.
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    $status = $error instanceof MeleteHttpError ? $error->status : ($error instanceof JsonException ? 400 : 500);
    http_response_code($status);
    reply(['error' => $error instanceof MeleteHttpError ? $error->getMessage() : 'Backup could not be completed; local recordings were kept']);
}
