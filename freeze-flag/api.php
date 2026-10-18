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
    save_text($path, json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
}
function save_text(string $path, string $json): void {
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
function archive_room(string $directory, array $room): string {
    $path = $directory . '/table-archive-' . $room['id'] . '-' . $room['match'] . '-' . $room['revision'] . '.json';
    if (!is_file($path)) {
        $original = file_get_contents($directory . '/room-' . $room['id'] . '.json');
        if ($original === false) throw new RuntimeException('Cannot read the previous game for backup.');
        save_text($path, $original);
    }
    return $path;
}
function archive_summary(array $room, string $path): array {
    return ['match' => $room['match'], 'revision' => $room['revision'], 'savedAt' => filemtime($path),
        'turn' => $room['state']['turn'], 'time' => $room['state']['time'], 'playersPerTeam' => $room['setup']['config']['playersPerTeam']];
}
function room_snapshot(array $room, HexGame $game, int $team, array $aliases): array {
    $snapshot = ['id' => $aliases[$room['id']] ?? $room['id'], 'revision' => $room['revision'], 'setup' => $room['setup'], 'joined' => $room['joined'],
        'online' => array_map(fn($seen) => $seen > time() - 12, $room['seen']), 'expiresAt' => $room['expiresAt'], 'view' => $game->view($team)];
    if (isset($room['match'])) $snapshot['match'] = $room['match'];
    return $snapshot;
}
function shared_table_id(): string { return substr(hash('sha256', 'freeze-flag-shared-table-v1'), 0, 24); }
function room_id($value): ?string {
    return is_string($value) && preg_match('/^(?:[a-z0-9]{1,8}|[a-f0-9]{24})$/iD', $value) ? strtolower($value) : null;
}
function public_room(array $room): bool {
    return isset($room['match'], $room['id'], $room['setup']['config']['playersPerTeam'], $room['joined'], $room['seen'], $room['keys'], $room['revision']) && !($room['closed'] ?? false);
}
function allocate_room_id(string $directory, array &$index): string {
    $reserved = array_fill_keys(array_merge(array_values($index['aliases']), array_column($index['requests'], 'id')), true);
    do {
        $id = base_convert((string)$index['next']++, 10, 36);
        if (strlen($id) > 8) throw new RuntimeException('Room IDs exhausted.');
    } while (isset($reserved[$id]) || is_file($directory . '/room-' . $id . '.json'));
    return $id;
}
// Call with creation.lock held: aliases and new games share one ID allocator.
function room_index(string $directory): array {
    $path = $directory . '/public-room-index.json';
    if (is_file($path)) {
        $index = read_json($path);
        if (!is_int($index['next'] ?? null) || $index['next'] < 1 || !is_array($index['requests'] ?? null)) throw new RuntimeException('Invalid room index.');
    } else {
        // Start above every existing short ID, never replace a saved game.
        $next = 1;
        foreach (glob($directory . '/room-*.json') ?: [] as $file) {
            if (preg_match('/^room-([a-z0-9]{1,8})[.]json$/D', basename($file), $match)) $next = max($next, (int)base_convert($match[1], 36, 10) + 1);
        }
        $index = ['next' => $next, 'requests' => []];
    }
    $index['aliases'] ??= [];
    if (!is_array($index['aliases'])) throw new RuntimeException('Invalid room aliases.');
    $changed = false;
    foreach (glob($directory . '/room-*.json') ?: [] as $file) {
        if (!preg_match('/^room-([a-f0-9]{24})[.]json$/D', basename($file), $match) || isset($index['aliases'][$match[1]])) continue;
        try { $room = read_json($file); } catch (Throwable $error) { continue; }
        if (!public_room($room) || $room['id'] !== $match[1]) continue;
        // Keep the original file and lock, so old links and active clients use
        // exactly the same board, seats and command receipts as the short link.
        $index['aliases'][$room['id']] = allocate_room_id($directory, $index);
        $changed = true;
    }
    if ($changed) save_json($path, $index);
    return $index;
}
function room_aliases(string $directory): array {
    $lock = lock_file($directory . '/creation.lock');
    try { return room_index($directory)['aliases']; }
    finally { flock($lock, LOCK_UN); fclose($lock); }
}
function room_storage_id(string $id, array $aliases): string {
    $legacy = array_search($id, $aliases, true);
    return $legacy === false ? $id : $legacy;
}
const SEAT_RESERVATION_SECONDS = 120;
function table_status(array $room, array $aliases): array {
    return ['id' => $aliases[$room['id']] ?? $room['id'],
        ...(isset($aliases[$room['id']]) ? ['legacyId' => $room['id']] : []),
        'revision' => $room['revision'], 'match' => $room['match'], 'setup' => $room['setup'],
        'seats' => array_map(fn($team) => ['claimed' => $room['joined'][$team],
            'online' => $room['joined'][$team] && $room['seen'][$team] > time() - 12,
            'reservedUntil' => $room['joined'][$team] ? $room['seen'][$team] + SEAT_RESERVATION_SECONDS : null], [0, 1])];
}
function expire_table_seats(array &$room): bool {
    $changed = false;
    foreach ([0, 1] as $team) if ($room['joined'][$team] && $room['seen'][$team] <= time() - SEAT_RESERVATION_SECONDS) {
        $room['keys'][$team] = null;
        $room['joined'][$team] = false;
        $room['seen'][$team] = 0;
        $room['revision']++;
        $changed = true;
    }
    return $changed;
}
function managed_room(array $room, array $aliases): array {
    $revision = $room['revision'];
    expire_table_seats($room); // Derive occupancy without writing during a listing.
    return ['id' => $aliases[$room['id']] ?? $room['id'], 'revision' => $revision,
        'seats' => table_status($room, $aliases)['seats'],
        'playersPerTeam' => $room['setup']['config']['playersPerTeam'],
        'updatedAt' => $room['updatedAt'] ?? ($room['expiresAt'] - 7 * 86400),
        'turn' => $room['state']['turn'] ?? null,
        'deletedAt' => $room['deletedAt'] ?? null];
}

try {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $ownOrigin = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '');
    $lan = getenv('QUANTUM_TAG_LAN_HOSTS') !== false;
    if ($origin !== '') {
        $allowedOrigins = $lan ? [$ownOrigin] : [$ownOrigin, 'https://diegozc.com', 'https://www.diegozc.com', 'http://127.0.0.1:5184', 'http://localhost:5184'];
        if (!in_array($origin, $allowedOrigins, true)) reply(['ok' => false, 'error' => 'Origin not allowed.'], 403);
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-Quantum-Key');
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') { http_response_code(204); exit; }
    if (!in_array($method, ['GET', 'POST'], true)) reply(['ok' => false, 'error' => 'Use GET or POST.'], 405);
    if ($method === 'GET' && ($_GET['action'] ?? '') === 'health') {
        $urls = $lan ? json_decode(getenv('QUANTUM_TAG_LAN_URLS') ?: '[]', true) : [];
        $host = parse_url($ownOrigin, PHP_URL_HOST);
        $shareUrl = $lan ? (in_array($host, ['localhost', '127.0.0.1'], true) ? ($urls[0] ?? $ownOrigin . '/') : $ownOrigin . '/') : null;
        reply(['ok' => true, 'version' => 1, 'service' => 'quantum-tag-rooms', 'sharedTable' => true, 'publicRooms' => true, 'hosting' => $lan ? 'lan' : 'website', 'shareUrl' => $shareUrl, 'urls' => $urls]);
    }
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
    if ($method === 'GET' && ($_GET['action'] ?? '') === 'room_backup') $request = $_GET;
    $action = $method === 'GET' ? (($request['action'] ?? '') === 'room_backup' ? 'room_backup' : 'read') : ($request['action'] ?? '');
    $aliases = room_aliases($directory);
    // Public, high-trust map replacement. A revision check prevents racing a player's move;
    // a request receipt makes a lost-response retry safe. Seats and rules stay with the room.
    if (in_array($action, ['table_import_map', 'room_backups', 'room_backup'], true)) {
        $publicId = room_id($request['room'] ?? null);
        if ($publicId === null) reply(['ok' => false, 'error' => 'Choose an existing game.'], 400);
        $id = room_storage_id($publicId, $aliases);
        $path = $directory . '/room-' . $id . '.json';
        $lock = lock_file($directory . '/room-' . $id . '.lock');
        if (!is_file($path)) reply(['ok' => false, 'error' => 'Game not found.'], 404);
        $room = read_json($path);
        if (!isset($room['match'])) reply(['ok' => false, 'error' => 'Choose a public game.'], 404);
        if ($action === 'room_backups') {
            $backups = [];
            foreach (glob($directory . '/table-archive-' . $id . '-*.json') ?: [] as $archivePath) {
                $archive = read_json($archivePath);
                $backups[] = archive_summary($archive, $archivePath);
            }
            usort($backups, fn($a, $b) => $b['match'] <=> $a['match'] ?: $b['revision'] <=> $a['revision']);
            reply(['ok' => true, 'backups' => $backups]);
        }
        if ($action === 'room_backup') {
            $match = $request['match'] ?? null; $revision = $request['revision'] ?? null;
            if ($method === 'GET') {
                $match = is_string($match) && ctype_digit($match) ? (int)$match : null;
                $revision = is_string($revision) && ctype_digit($revision) ? (int)$revision : null;
            }
            if (!valid_integer($match, 1, 1000000000) || !valid_integer($revision, 0, 1000000000)) reply(['ok' => false, 'error' => 'Invalid backup.'], 400);
            $archivePath = $directory . '/table-archive-' . $id . '-' . $match . '-' . $revision . '.json';
            if (!is_file($archivePath)) reply(['ok' => false, 'error' => 'Backup not found.'], 404);
            $archive = read_json($archivePath);
            $exact = json_decode((string)file_get_contents($archivePath), false, 64, JSON_THROW_ON_ERROR);
            $name = 'freeze-flag-game-' . ($aliases[$id] ?? $id) . '-match-' . $match . '-revision-' . $revision . '.json';
            header('Content-Disposition: attachment; filename="' . $name . '"');
            // Export the complete position and observations, never room credentials or request receipts.
            reply(['format' => 'freeze-flag-online-backup', 'version' => 1, 'room' => $aliases[$id] ?? $id,
                ...archive_summary($archive, $archivePath), 'setup' => $exact->setup, 'state' => $exact->state]);
        }
        if (!public_room($room)) reply(['ok' => false, 'error' => 'Restore this game before replacing its map.'], 410);
        if (!valid_integer($request['revision'] ?? null, 0, 1000000000) || !is_string($request['requestId'] ?? null)
            || !preg_match('/^[A-Za-z0-9_-]{16,80}$/D', $request['requestId']) || !is_array($request['setup'] ?? null)) reply(['ok' => false, 'error' => 'Invalid map import.'], 400);
        $receipt = 'map:' . $request['requestId'];
        $fingerprint = hash('sha256', json_encode($request['setup'], JSON_THROW_ON_ERROR));
        if (isset($room['processed'][$receipt])) {
            $previous = $room['processed'][$receipt];
            if ($previous['fingerprint'] !== $fingerprint) reply(['ok' => false, 'error' => 'Import ID was already used for another map.'], 409);
            reply(['ok' => true, 'table' => table_status($room, $aliases), 'backup' => $previous['backup']]);
        }
        if ($request['revision'] !== $room['revision']) reply(['ok' => false, 'error' => 'The game changed during import. Try again.'], 409);
        $setup = $request['setup'];
        if (($setup['version'] ?? null) !== 10) reply(['ok' => false, 'error' => 'Use the current map editor.'], 400);
        if (!is_array($setup['config'] ?? null)) reply(['ok' => false, 'error' => 'Invalid map settings.'], 400);
        foreach (['turnDuration', 'freezeRounds', 'allowVoluntaryDrops', 'postThawTouches', 'fog', 'sightRule', 'frozenFog', 'hideUnseenObstacles'] as $rule) {
            if (array_key_exists($rule, $room['setup']['config'])) $setup['config'][$rule] = $room['setup']['config'][$rule];
            else unset($setup['config'][$rule]);
        }
        $setup = HexGame::validateSetup($setup);
        $target = HexGame::endzoneTarget($room['setup']);
        if ($target !== null && HexGame::endzoneTarget($setup) !== $target) $setup['endzones'] = [$setup['endzones'][1], $setup['endzones'][0]];
        $game = new HexGame($setup);
        // Save the old match first. A backup failure must abort the replacement.
        $archivePath = archive_room($directory, $room);
        $backup = archive_summary($room, $archivePath);
        $room['match']++; $room['revision']++; $room['updatedAt'] = time(); $room['expiresAt'] = time() + 7 * 86400;
        $room['setup'] = $game->state['setup']; $room['state'] = $game->state;
        $room['processed'][$receipt] = ['fingerprint' => $fingerprint, 'backup' => $backup];
        $room['processed'] = array_slice($room['processed'], -128, null, true);
        save_json($path, $room);
        reply(['ok' => true, 'table' => table_status($room, $aliases), 'backup' => $backup]);
    }
    // High-trust public-room cleanup: no admin account, but never remove occupied
    // or reserved games. The complete save stays on disk for Undo/Restore.
    if ($action === 'rooms_manage') {
        $rooms = [];
        foreach (glob($directory . '/room-*.json') ?: [] as $path) {
            try {
                $room = read_json($path);
                if (public_room($room) || (isset($room['match'], $room['deletedAt']) && ($room['closed'] ?? false))) $rooms[] = managed_room($room, $aliases);
            } catch (Throwable $error) { error_log('Freeze Flag skipped managed room: ' . basename($path)); }
        }
        usort($rooms, fn($a, $b) => ($b['deletedAt'] ?? $b['updatedAt']) <=> ($a['deletedAt'] ?? $a['updatedAt']) ?: strcmp($a['id'], $b['id']));
        reply(['ok' => true, 'rooms' => $rooms]);
    }
    if (in_array($action, ['room_delete', 'room_restore'], true)) {
        $id = room_id($request['room'] ?? null);
        if ($id === null || !valid_integer($request['revision'] ?? null, 0, 1000000000)) reply(['ok' => false, 'error' => 'Choose a game from the current dashboard.'], 400);
        $id = room_storage_id($id, $aliases);
        $path = $directory . '/room-' . $id . '.json';
        $lock = lock_file($directory . '/room-' . $id . '.lock');
        if (!is_file($path)) reply(['ok' => false, 'error' => 'Game not found.'], 404);
        $room = read_json($path);
        $deleted = isset($room['match'], $room['deletedAt']) && ($room['closed'] ?? false);
        if (!public_room($room) && !$deleted) reply(['ok' => false, 'error' => 'Only public games can be managed here.'], 404);
        // An interrupted request can be retried without deleting a restored game.
        if ($room['revision'] !== $request['revision']) reply(['ok' => false, 'error' => 'This game changed. Refresh and try again.'], 409);
        if ($action === 'room_delete') {
            if (!$deleted) {
                expire_table_seats($room);
                if (in_array(true, $room['joined'], true)) reply(['ok' => false, 'error' => 'A player is connected or their seat is reserved. Wait until both seats are empty.'], 409);
                $room['closed'] = true;
                $room['deletedAt'] = time();
                // Retire old credentials; restoration always offers two open seats.
                $room['keys'] = [null, null]; $room['joined'] = [false, false]; $room['seen'] = [0, 0];
                $room['revision']++;
                save_json($path, $room);
            }
        } elseif ($deleted) {
            unset($room['deletedAt']);
            $room['closed'] = false; $room['revision']++;
            save_json($path, $room);
        }
        reply(['ok' => true, 'room' => managed_room($room, $aliases)]);
    }
    if ($action === 'rooms_list') {
        $rooms = [];
        foreach (glob($directory . '/room-*.json') ?: [] as $path) {
            try {
                $room = read_json($path);
                if (!public_room($room)) continue;
                // List only public metadata; never expose live state or player credentials.
                expire_table_seats($room);
                $rooms[] = ['id' => $aliases[$room['id']] ?? $room['id'], 'match' => $room['match'], 'seats' => table_status($room, $aliases)['seats'],
                    'playersPerTeam' => $room['setup']['config']['playersPerTeam'],
                    'updatedAt' => $room['updatedAt'] ?? ($room['expiresAt'] - 7 * 86400)];
            } catch (Throwable $error) {
                // A damaged old game must not block other games. Preserve its file for recovery.
                error_log('Freeze Flag skipped room listing: ' . basename($path));
            }
        }
        usort($rooms, fn($a, $b) => $b['updatedAt'] <=> $a['updatedAt'] ?: strcmp($a['id'], $b['id']));
        reply(['ok' => true, 'rooms' => $rooms]);
    }
    if ($action === 'spectate') {
        $id = room_id($request['room'] ?? null);
        if ($id === null) reply(['ok' => false, 'error' => 'Invalid game link.'], 400);
        $id = room_storage_id($id, $aliases);
        $path = $directory . '/room-' . $id . '.json';
        $lock = lock_file($directory . '/room-' . $id . '.lock');
        if (!is_file($path)) reply(['ok' => false, 'error' => 'Game not found.'], 404);
        $room = read_json($path);
        if (!public_room($room)) reply(['ok' => false, 'error' => 'This game is not available in the public lobby.'], 404);
        $game = new HexGame($room['setup'], $room['state']);
        $snapshot = room_snapshot($room, $game, $game->team(), $aliases);
        $snapshot['view'] = $game->spectatorView();
        $snapshot['perspectives'] = [$game->view(0), $game->view(1)];
        // No seat, heartbeat, command, observation or save: watching cannot affect play.
        reply(['ok' => true, 'snapshot' => $snapshot]);
    }
    if (in_array($action, ['table_status', 'table_claim'], true)) {
        $id = room_id($request['room'] ?? shared_table_id());
        if ($id === null) reply(['ok' => false, 'error' => 'Invalid room link.'], 400);
        $id = room_storage_id($id, $aliases);
        $path = $directory . '/room-' . $id . '.json';
        $lock = lock_file($directory . '/room-' . $id . '.lock');
        if (is_file($path)) $room = read_json($path);
        else {
            if (isset($request['room'])) reply(['ok' => false, 'error' => 'Game not found. Create a new game or choose another room.'], 404);
            $setup = HexGame::validateSetup(read_json(__DIR__ . '/table-setup.json'));
            $game = new HexGame($setup);
            $room = ['id' => $id, 'match' => 1, 'revision' => 0, 'setup' => $setup, 'state' => $game->state,
                'keys' => [null, null], 'joined' => [false, false], 'seen' => [0, 0],
                'expiresAt' => time() + 7 * 86400, 'processed' => [], 'closed' => false];
            save_json($path, $room);
            $aliases = room_aliases($directory);
        }
        if (!isset($room['match']) || $room['closed']) reply(['ok' => false, 'error' => 'This game is not available in the public lobby.'], 404);
        if (expire_table_seats($room)) save_json($path, $room);
        if ($action === 'table_status') reply(['ok' => true, 'table' => table_status($room, $aliases)]);
        $team = $request['team'] ?? null;
        $key = $_SERVER['HTTP_X_QUANTUM_KEY'] ?? '';
        if (!valid_integer($team, 0, 1) || !preg_match('/^[A-Za-z0-9_-]{43}$/D', $key)) reply(['ok' => false, 'error' => 'Choose Player 1 or Player 2.'], 400);
        $hash = hash('sha256', $key);
        if ($room['keys'][1 - $team] === $hash) reply(['ok' => false, 'error' => 'This browser already has the other player. Leave that seat first.'], 409);
        if ($room['keys'][$team] !== null && !hash_equals($room['keys'][$team], $hash)) reply(['ok' => false, 'error' => 'That player has just been claimed. Choose the other player.', 'table' => table_status($room, $aliases)], 409);
        if (!$room['joined'][$team]) {
            $room['keys'][$team] = $hash;
            $room['joined'][$team] = true;
            $room['revision']++;
        }
        $room['seen'][$team] = time();
        $room['expiresAt'] = time() + 7 * 86400;
        save_json($path, $room);
        reply(['ok' => true, 'table' => table_status($room, $aliases), 'snapshot' => room_snapshot($room, new HexGame($room['setup'], $room['state']), $team, $aliases)]);
    }
    if (in_array($action, ['create', 'table_create'], true)) {
        $public = $action === 'table_create';
        $setup = HexGame::validateSetup($request['setup'] ?? ($public ? read_json(__DIR__ . '/table-setup.json') : null));
        if ($setup['version'] < 2) reply(['ok' => false, 'error' => 'New rooms use symmetric boards. Reload the board editor and create the room again.'], 400);
        if ($public && $setup['version'] !== 10) reply(['ok' => false, 'error' => 'Reload the current board editor to create a game.'], 400);
        if ($public) {
            $key = $_SERVER['HTTP_X_QUANTUM_KEY'] ?? '';
            if (!preg_match('/^[A-Za-z0-9_-]{43}$/D', $key) || !is_string($request['requestId'] ?? null) || !preg_match('/^[A-Za-z0-9_-]{16,80}$/D', $request['requestId'])) reply(['ok' => false, 'error' => 'Invalid game creation request.'], 400);
            $creationToken = substr(hash('sha256', 'public-room-v1:' . $key . ':' . $request['requestId']), 0, 24);
            $creationFingerprint = hash('sha256', json_encode($setup, JSON_THROW_ON_ERROR));
        }
        $creationLock = lock_file($directory . '/creation.lock');
        if ($public) {
            $index = room_index($directory);
            $aliases = $index['aliases'];
            $reservation = $index['requests'][$creationToken] ?? null;
            if ($reservation && ($reservation['fingerprint'] ?? '') !== $creationFingerprint) reply(['ok' => false, 'error' => 'Creation request already used for another map.'], 409);
            // Also recognize retries from the previous long-ID implementation.
            $id = $reservation['id'] ?? $creationToken;
            if (room_id($id) === null) throw new RuntimeException('Invalid reserved room ID.');
            $id = room_storage_id($id, $aliases);
        }
        if ($public && is_file($directory . '/room-' . $id . '.json')) {
            $room = read_json($directory . '/room-' . $id . '.json');
            if ($room['closed'] ?? false) reply(['ok' => false, 'error' => 'That game was deleted. Restore it from Manage games or create a new game.'], 410);
            if (($room['creationFingerprint'] ?? '') !== $creationFingerprint) reply(['ok' => false, 'error' => 'Creation request already used for another map.'], 409);
            if ($room['keys'][0] !== hash('sha256', $key)) reply(['ok' => false, 'error' => 'This game already exists. Open its room to choose a player.'], 409);
            reply(['ok' => true, 'table' => table_status($room, $aliases), 'snapshot' => room_snapshot($room, new HexGame($room['setup'], $room['state']), 0, $aliases)]);
        }
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
            try { $old = read_json($path); }
            catch (Throwable $error) { $live++; continue; }
            if (isset($old['match'], $old['deletedAt']) && ($old['closed'] ?? false)) continue;
            if (!isset($old['match']) && ($old['expiresAt'] ?? 0) < time()) {
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
        if ($public && !$reservation) {
            $id = allocate_room_id($directory, $index);
            $index['requests'][$creationToken] = ['id' => $id, 'fingerprint' => $creationFingerprint];
            // Reserve before writing the room. A retry after an interrupted save uses this same ID.
            save_json($directory . '/public-room-index.json', $index);
        } elseif (!$public) $id = bin2hex(random_bytes(12));
        $keys = $public ? [$key, null] : array_map(fn($_) => rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='), [0, 1]);
        $room = ['id' => $id, 'revision' => 0, 'setup' => $setup, 'state' => $game->state,
            'keys' => array_map(fn($key) => $key === null ? null : hash('sha256', $key), $keys), 'joined' => [true, false], 'seen' => [time(), 0],
            'expiresAt' => time() + 7 * 86400, 'processed' => [], 'closed' => false];
        if ($public) { $room['match'] = 1; $room['updatedAt'] = time(); $room['creationFingerprint'] = $creationFingerprint; }
        save_json($directory . '/room-' . $id . '.json', $room);
        flock($creationLock, LOCK_UN); fclose($creationLock);
        if ($public) reply(['ok' => true, 'table' => table_status($room, $aliases), 'snapshot' => room_snapshot($room, $game, 0, $aliases)], 201);
        reply(['ok' => true, 'key' => $keys[0], 'inviteKey' => $keys[1], 'snapshot' => room_snapshot($room, $game, 0, $aliases)], 201);
    }
    $id = room_id($request['room'] ?? ($_GET['room'] ?? ''));
    $key = $_SERVER['HTTP_X_QUANTUM_KEY'] ?? '';
    if ($id === null || !preg_match('/^[A-Za-z0-9_-]{43}$/D', $key)) reply(['ok' => false, 'error' => 'Room link is invalid.'], 403);
    $id = room_storage_id($id, $aliases);
    $path = $directory . '/room-' . $id . '.json';
    if (!is_file($path)) reply(['ok' => false, 'error' => 'Room not found or expired.'], 404);
    $lock = lock_file($directory . '/room-' . $id . '.lock');
    if (!is_file($path)) reply(['ok' => false, 'error' => 'Room not found or expired.'], 404);
    $room = read_json($path); $team = null;
    if (isset($room['match']) && expire_table_seats($room)) save_json($path, $room);
    foreach ([0, 1] as $candidate) if (is_string($room['keys'][$candidate]) && hash_equals($room['keys'][$candidate], hash('sha256', $key))) $team = $candidate;
    if ($team === null) reply(['ok' => false, 'error' => 'Room link is invalid.'], 403);
    if ($room['closed'] || (!isset($room['match']) && $room['expiresAt'] < time())) reply(['ok' => false, 'error' => 'This room has ended or expired.'], 410);
    $game = new HexGame($room['setup'], $room['state']);
    $room['setup'] = $game->state['setup'];
    $room['state'] = $game->state;
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
            if ((int)$request['revision'] !== $room['revision']) reply(['ok' => false, 'error' => 'The board changed. Check the updated position and try again.', 'snapshot' => room_snapshot($room, $game, $team, $aliases)], 409);
            if (($request['command']['kind'] ?? '') === 'new_game' && isset($room['match'])) {
                $setup = HexGame::validateSetup($request['command']['setup'] ?? $room['setup']);
                if ($setup['version'] !== 10) reply(['ok' => false, 'error' => 'Use the current board editor for a new online game.'], 400);
                $nextGame = new HexGame($setup);
                archive_room($directory, $room);
                $game = $nextGame;
                $room['match']++;
                $accepted = true;
            } else {
                if ((!($game->state['ready'] ?? null) || !in_array($request['command']['kind'] ?? '', ['deploy', 'ready', 'configure'], true)) && (!$room['joined'][0] || !$room['joined'][1])) reply(['ok' => false, 'error' => 'Wait for the other team to join.'], 409);
                $accepted = $game->command($team, $request['command']);
            }
            if ($accepted) { $room['revision']++; $room['expiresAt'] = time() + 7 * 86400; $room['updatedAt'] = time(); }
            $room['processed'][$receipt] = ['accepted' => $accepted, 'fingerprint' => $fingerprint];
            $room['processed'] = array_slice($room['processed'], -128, null, true);
            $room['state'] = $game->state;
            $room['setup'] = $game->state['setup'];
        }
    } elseif ($action === 'table_leave' && isset($room['match'])) {
        $room['keys'][$team] = null; $room['joined'][$team] = false; $room['seen'][$team] = 0; $room['revision']++;
        save_json($path, $room);
        reply(['ok' => true, 'table' => table_status($room, $aliases)]);
    } elseif ($action === 'close') {
        if (isset($room['match'])) reply(['ok' => false, 'error' => 'Leave your seat or start a new game instead.'], 400);
        if ($team !== 0) reply(['ok' => false, 'error' => 'Only the room creator can close it.'], 403);
        $room['closed'] = true;
    } elseif ($action !== 'read') reply(['ok' => false, 'error' => 'Unknown room action.'], 400);
    save_json($path, $room);
    flock($lock, LOCK_UN); fclose($lock);
    reply(['ok' => true, 'accepted' => $accepted, 'snapshot' => room_snapshot($room, $game, $team, $aliases)]);
} catch (JsonException $error) {
    reply(['ok' => false, 'error' => 'Invalid JSON.'], 400);
} catch (InvalidArgumentException $error) {
    reply(['ok' => false, 'error' => $error->getMessage()], 400);
} catch (Throwable $error) {
    error_log('Quantum Tag room error: ' . $error->getMessage());
    reply(['ok' => false, 'error' => 'The room server could not complete this request. Try again shortly.'], 503);
}
