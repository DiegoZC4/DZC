<?php
declare(strict_types=1);
require_once __DIR__ . '/hex-game.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function reply(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}
function lock_file(string $path) {
    $handle = fopen($path, 'c+');
    if ($handle === false) throw new RuntimeException('Cannot open room lock.');
    chmod($path, 0600);
    for ($i = 0; $i < 40; $i++) {
        if (flock($handle, LOCK_EX | LOCK_NB)) return $handle;
        usleep(25000);
    }
    fclose($handle);
    header('Retry-After: 1');
    reply(['ok' => false, 'error' => 'Room is busy. Try again.'], 503);
}
function save_json(string $path, array $value): void {
    $json = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    $temporary = tempnam(dirname($path), '.write-');
    if ($temporary === false) throw new RuntimeException('Cannot save room.');
    try {
        if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $path)) throw new RuntimeException('Cannot save room.');
    } finally { if (is_file($temporary)) unlink($temporary); }
}
function read_json(string $path): array {
    $value = json_decode((string)file_get_contents($path), true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($value)) throw new RuntimeException('Invalid stored room.');
    return $value;
}
function room_snapshot(array $room, HexGame $game, int $team): array {
    return ['id' => $room['id'], 'revision' => $room['revision'], 'setup' => $room['setup'], 'joined' => $room['joined'],
        'online' => array_map(fn($seen) => $seen > time() - 12, $room['seen']), 'expiresAt' => $room['expiresAt'], 'view' => $game->view($team)];
}

try {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $ownOrigin = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '');
    if ($origin !== '') {
        if (!in_array($origin, [$ownOrigin, 'https://diegozc.com', 'https://www.diegozc.com', 'http://127.0.0.1:5184', 'http://localhost:5184'], true)) reply(['ok' => false, 'error' => 'Origin not allowed.'], 403);
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-Quantum-Key');
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') { http_response_code(204); exit; }
    if (!in_array($method, ['GET', 'POST'], true)) reply(['ok' => false, 'error' => 'Use GET or POST.'], 405);
    if ($method === 'GET' && ($_GET['action'] ?? '') === 'health') reply(['ok' => true, 'version' => 1, 'service' => 'quantum-tag-rooms']);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 131072) reply(['ok' => false, 'error' => 'Request is too large.'], 413);
    $request = [];
    if ($method === 'POST') {
        if (strpos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) reply(['ok' => false, 'error' => 'Send JSON.'], 415);
        $body = file_get_contents('php://input', false, null, 0, 131073);
        if ($body === false || strlen($body) > 131072) reply(['ok' => false, 'error' => 'Request is too large.'], 413);
        $request = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($request)) reply(['ok' => false, 'error' => 'Invalid request.'], 400);
    }
    $directory = getenv('QUANTUM_TAG_DATA_DIR') ?: dirname(__DIR__, 2) . '/.quantum-tag-rooms';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Cannot initialize storage.');
    $action = $method === 'GET' ? 'read' : ($request['action'] ?? '');
    if ($action === 'create') {
        $setup = HexGame::validateSetup($request['setup'] ?? null);
        if ($setup['version'] < 2) reply(['ok' => false, 'error' => 'New rooms use symmetric boards. Reload the board editor and create the room again.'], 400);
        $creationLock = lock_file($directory . '/creation.lock');
        $ratesPath = $directory . '/creation-rates.json';
        $rates = is_file($ratesPath) ? read_json($ratesPath) : [];
        $rates = array_filter($rates, fn($record) => $record['since'] > time() - 3600);
        $ip = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
        if (($rates[$ip]['count'] ?? 0) >= 30) reply(['ok' => false, 'error' => 'Room creation limit reached. Try again later.'], 429);
        $rates[$ip] = ['since' => $rates[$ip]['since'] ?? time(), 'count' => ($rates[$ip]['count'] ?? 0) + 1];
        save_json($ratesPath, $rates);
        $roomFiles = glob($directory . '/room-*.json') ?: [];
        $live = 0;
        foreach ($roomFiles as $path) {
            $old = read_json($path);
            if (($old['expiresAt'] ?? 0) < time()) {
                $oldLockPath = substr($path, 0, -5) . '.lock';
                $oldLock = fopen($oldLockPath, 'c+');
                if ($oldLock && flock($oldLock, LOCK_EX | LOCK_NB)) {
                    $old = read_json($path);
                    if (($old['expiresAt'] ?? 0) < time()) unlink($path);
                    else $live++;
                    flock($oldLock, LOCK_UN);
                } else $live++;
                if ($oldLock) fclose($oldLock);
            } else $live++;
        }
        if ($live >= 300) reply(['ok' => false, 'error' => 'The room server is full. Try again later.'], 503);
        $game = new HexGame($setup);
        $id = bin2hex(random_bytes(12));
        $keys = array_map(fn($_) => rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='), [0, 1]);
        $room = ['id' => $id, 'revision' => 0, 'setup' => $setup, 'state' => $game->state,
            'keys' => array_map(fn($key) => hash('sha256', $key), $keys), 'joined' => [true, false], 'seen' => [time(), 0],
            'expiresAt' => time() + 7 * 86400, 'processed' => [], 'closed' => false];
        save_json($directory . '/room-' . $id . '.json', $room);
        flock($creationLock, LOCK_UN); fclose($creationLock);
        reply(['ok' => true, 'key' => $keys[0], 'inviteKey' => $keys[1], 'snapshot' => room_snapshot($room, $game, 0)], 201);
    }
    $id = $request['room'] ?? ($_GET['room'] ?? '');
    $key = $_SERVER['HTTP_X_QUANTUM_KEY'] ?? '';
    if (!is_string($id) || !preg_match('/^[a-f0-9]{24}$/D', $id) || !preg_match('/^[A-Za-z0-9_-]{43}$/D', $key)) reply(['ok' => false, 'error' => 'Room link is invalid.'], 403);
    $path = $directory . '/room-' . $id . '.json';
    if (!is_file($path)) reply(['ok' => false, 'error' => 'Room not found or expired.'], 404);
    $lock = lock_file($directory . '/room-' . $id . '.lock');
    if (!is_file($path)) reply(['ok' => false, 'error' => 'Room not found or expired.'], 404);
    $room = read_json($path); $team = null;
    foreach ([0, 1] as $candidate) if (hash_equals($room['keys'][$candidate], hash('sha256', $key))) $team = $candidate;
    if ($team === null) reply(['ok' => false, 'error' => 'Room link is invalid.'], 403);
    if ($room['closed'] || $room['expiresAt'] < time()) reply(['ok' => false, 'error' => 'This room has ended or expired.'], 410);
    $game = new HexGame($room['setup'], $room['state']);
    $room['seen'][$team] = time();
    $accepted = true;
    if ($action === 'join') {
        if (!$room['joined'][$team]) { $room['joined'][$team] = true; $room['revision']++; }
    } elseif ($action === 'command') {
        if (!is_array($request['command'] ?? null) || !valid_integer($request['revision'] ?? null, 0, 1000000000) || !is_string($request['requestId'] ?? null) || !preg_match('/^[A-Za-z0-9_-]{16,80}$/D', $request['requestId'])) reply(['ok' => false, 'error' => 'Invalid command request.'], 400);
        $receipt = $team . ':' . $request['requestId'];
        $fingerprint = hash('sha256', json_encode($request['command'], JSON_THROW_ON_ERROR));
        if (array_key_exists($receipt, $room['processed'])) {
            if ($room['processed'][$receipt]['fingerprint'] !== $fingerprint) reply(['ok' => false, 'error' => 'Request ID was already used for another command.'], 409);
            $accepted = $room['processed'][$receipt]['accepted'];
        }
        else {
            if ((int)$request['revision'] !== $room['revision']) reply(['ok' => false, 'error' => 'The board changed. Check the updated position and try again.', 'snapshot' => room_snapshot($room, $game, $team)], 409);
            if ((!($game->state['ready'] ?? null) || !in_array($request['command']['kind'] ?? '', ['deploy', 'ready'], true)) && (!$room['joined'][0] || !$room['joined'][1])) reply(['ok' => false, 'error' => 'Wait for the other team to join.'], 409);
            $accepted = $game->command($team, $request['command']);
            if ($accepted) { $room['revision']++; $room['expiresAt'] = time() + 7 * 86400; }
            $room['processed'][$receipt] = ['accepted' => $accepted, 'fingerprint' => $fingerprint];
            $room['processed'] = array_slice($room['processed'], -128, null, true);
            $room['state'] = $game->state;
        }
    } elseif ($action === 'close') {
        if ($team !== 0) reply(['ok' => false, 'error' => 'Only the room creator can close it.'], 403);
        $room['closed'] = true;
    } elseif ($action !== 'read') reply(['ok' => false, 'error' => 'Unknown room action.'], 400);
    save_json($path, $room);
    flock($lock, LOCK_UN); fclose($lock);
    reply(['ok' => true, 'accepted' => $accepted, 'snapshot' => room_snapshot($room, $game, $team)]);
} catch (JsonException $error) {
    reply(['ok' => false, 'error' => 'Invalid JSON.'], 400);
} catch (InvalidArgumentException $error) {
    reply(['ok' => false, 'error' => $error->getMessage()], 400);
} catch (Throwable $error) {
    error_log('Quantum Tag room error: ' . $error->getMessage());
    reply(['ok' => false, 'error' => 'The room server could not complete this request. Try again shortly.'], 503);
}
