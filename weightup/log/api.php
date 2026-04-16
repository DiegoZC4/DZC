<?php
declare(strict_types=1);

session_start([
    'cookie_httponly' => true,
    'cookie_samesite' => 'Lax',
    'use_strict_mode' => true,
]);

const MAX_REQUEST_BYTES = 2_000_000;
const API_VERSION = '4';
const CSV_HEADER = "date,time,name,exercise,weight,reps\n";

$config = require __DIR__ . '/config.php';

$dataDir = __DIR__ . '/data';
$backupDir = $dataDir . '/backups';
$dbPath = $dataDir . '/weightup.sqlite3';
$legacyCsvPath = $dataDir . '/weightup.csv';

ensureDir($dataDir);
ensureDir($backupDir);

$db = openDatabase($dbPath);
initializeDatabase($db);
seedDatabaseIfEmpty($db, $legacyCsvPath);

$action = strtolower((string)($_GET['action'] ?? 'status'));

try {
    switch ($action) {
        case 'status':
            requireMethod('GET');
            $session = currentSessionUser();
            jsonResponse([
                'ok' => true,
                'version' => API_VERSION,
                'googleConfigured' => googleConfigured($config),
                'googleClientId' => (string)($config['google_client_id'] ?? ''),
                'signedIn' => $session !== null,
                'authenticatedUser' => $session['email'] ?? null,
                'savedAt' => latestSavedAt($db),
                'backupCount' => countMonthlyBackups($backupDir),
            ]);
            break;

        case 'google_login':
            requireMethod('POST');
            requireGoogleConfigured($config);
            $body = readJsonBody();
            $credential = (string)($body['credential'] ?? '');
            if ($credential === '') {
                throw new InvalidArgumentException('Missing Google credential.');
            }
            $claims = verifyGoogleIdToken($credential, (string)$config['google_client_id']);
            $email = strtolower((string)($claims['email'] ?? ''));
            if (!emailAllowed($email, $config['allowed_emails'] ?? [])) {
                throw new RuntimeException('That Google account is not allowed.');
            }
            $_SESSION['weightup_user'] = [
                'email' => $email,
                'name' => (string)($claims['name'] ?? $email),
                'picture' => (string)($claims['picture'] ?? ''),
                'sub' => (string)($claims['sub'] ?? ''),
            ];
            session_regenerate_id(true);
            jsonResponse([
                'ok' => true,
                'version' => API_VERSION,
                'signedIn' => true,
                'authenticatedUser' => $email,
                'savedAt' => latestSavedAt($db),
            ]);
            break;

        case 'logout':
            requireMethod('POST');
            $_SESSION = [];
            if (ini_get('session.use_cookies')) {
                $params = session_get_cookie_params();
                setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], (bool)$params['secure'], (bool)$params['httponly']);
            }
            session_destroy();
            jsonResponse([
                'ok' => true,
                'version' => API_VERSION,
                'signedIn' => false,
            ]);
            break;

        case 'load':
            requireMethod('GET');
            $session = requireSignedInUser();
            jsonResponse([
                'ok' => true,
                'version' => API_VERSION,
                'authenticatedUser' => $session['email'],
                'savedAt' => latestSavedAt($db),
                'setsCsv' => encodeCsvFromDatabase($db),
            ]);
            break;

        case 'save':
            requireMethod('POST');
            requireSameOriginIfPresent();
            $session = requireSignedInUser();
            $body = readJsonBody();
            $rows = parseSetsCsv(extractSetsCsv($body));
            createMonthlyBackupIfNeeded($db, $dbPath, $backupDir);
            saveRowsToDatabase($db, $rows, $session['email'], normalizeClientMetadata($body['client'] ?? null));
            jsonResponse([
                'ok' => true,
                'version' => API_VERSION,
                'authenticatedUser' => $session['email'],
                'savedAt' => latestSavedAt($db),
            ]);
            break;

        case 'download':
            requireMethod('GET');
            requireSignedInUser();
            header('Content-Type: text/csv; charset=utf-8');
            header('Cache-Control: no-store');
            echo encodeCsvFromDatabase($db);
            exit;

        default:
            jsonResponse(['ok' => false, 'error' => 'Unknown action.'], 404);
    }
} catch (Throwable $e) {
    jsonResponse([
        'ok' => false,
        'error' => $e->getMessage(),
    ], 400);
}

function openDatabase(string $dbPath): PDO
{
    if (!extension_loaded('pdo_sqlite')) {
        throw new RuntimeException('SQLite support is not enabled on this server.');
    }
    $db = new PDO('sqlite:' . $dbPath, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $db->exec('PRAGMA journal_mode = DELETE');
    $db->exec('PRAGMA busy_timeout = 5000');
    return $db;
}

function initializeDatabase(PDO $db): void
{
    $db->exec(
        'CREATE TABLE IF NOT EXISTS sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            time TEXT NOT NULL DEFAULT \'\',
            name TEXT NOT NULL,
            exercise TEXT NOT NULL,
            weight REAL NOT NULL,
            reps INTEGER NOT NULL
        )'
    );
    $db->exec(
        'CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )'
    );
}

function seedDatabaseIfEmpty(PDO $db, string $legacyCsvPath): void
{
    $count = (int)$db->query('SELECT COUNT(*) FROM sets')->fetchColumn();
    if ($count > 0 || !is_file($legacyCsvPath)) {
        return;
    }
    $rows = parseSetsCsv((string)file_get_contents($legacyCsvPath));
    if (!$rows) {
        return;
    }
    $db->beginTransaction();
    try {
        $stmt = $db->prepare('INSERT INTO sets (date, time, name, exercise, weight, reps) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($rows as $row) {
            $stmt->execute([$row['date'], $row['time'], $row['name'], $row['exercise'], $row['weight'], $row['reps']]);
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function encodeCsvFromDatabase(PDO $db): string
{
    $lines = [rtrim(CSV_HEADER, "\n")];
    $stmt = $db->query('SELECT date, time, name, exercise, weight, reps FROM sets ORDER BY date ASC, time ASC, id ASC');
    while ($row = $stmt->fetch()) {
        $lines[] = implode(',', [
            (string)$row['date'],
            (string)$row['time'],
            csvCell((string)$row['name']),
            csvCell((string)$row['exercise']),
            formatWeight((float)$row['weight']),
            (string)((int)$row['reps']),
        ]);
    }
    return implode("\n", $lines) . "\n";
}

function csvCell(string $value): string
{
    if (!str_contains($value, ',') && !str_contains($value, '"') && !str_contains($value, "\n") && !str_contains($value, "\r")) {
        return $value;
    }
    return '"' . str_replace('"', '""', $value) . '"';
}

function formatWeight(float $value): string
{
    $text = rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
    return $text === '' ? '0' : $text;
}

function parseSetsCsv(string $csv): array
{
    $normalized = str_replace(["\r\n", "\r"], "\n", trim($csv));
    if ($normalized === '') {
        return [];
    }
    $handle = fopen('php://temp', 'r+');
    if ($handle === false) {
        throw new RuntimeException('Could not open temporary CSV buffer.');
    }
    fwrite($handle, $normalized . "\n");
    rewind($handle);
    $header = fgetcsv($handle);
    $expected = ['date', 'time', 'name', 'exercise', 'weight', 'reps'];
    if (!is_array($header) || array_map('strtolower', $header) !== $expected) {
        fclose($handle);
        throw new InvalidArgumentException('CSV header must be date,time,name,exercise,weight,reps.');
    }
    $rows = [];
    while (($row = fgetcsv($handle)) !== false) {
        if ($row === [null] || $row === false) {
            continue;
        }
        $row = array_pad($row, 6, '');
        $date = trim((string)$row[0]);
        $time = trim((string)$row[1]);
        $name = trim((string)$row[2]);
        $exercise = trim((string)$row[3]);
        if ($date === '' || $name === '' || $exercise === '') {
            continue;
        }
        $rows[] = [
            'date' => $date,
            'time' => $time,
            'name' => $name,
            'exercise' => $exercise,
            'weight' => (float)$row[4],
            'reps' => (int)round((float)$row[5]),
        ];
    }
    fclose($handle);
    return $rows;
}

function saveRowsToDatabase(PDO $db, array $rows, string $email, ?array $client): void
{
    $savedAt = gmdate('c');
    $db->beginTransaction();
    try {
        $db->exec('DELETE FROM sets');
        $stmt = $db->prepare('INSERT INTO sets (date, time, name, exercise, weight, reps) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($rows as $row) {
            $stmt->execute([$row['date'], $row['time'], $row['name'], $row['exercise'], $row['weight'], $row['reps']]);
        }
        writeMetaValue($db, 'savedAt', $savedAt);
        writeMetaValue($db, 'authenticatedUser', $email);
        writeMetaValue($db, 'remoteAddr', (string)($_SERVER['REMOTE_ADDR'] ?? ''));
        writeMetaValue($db, 'userAgent', (string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
        writeMetaValue($db, 'apiVersion', API_VERSION);
        writeMetaValue($db, 'client', json_encode($client, JSON_UNESCAPED_SLASHES) ?: '');
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function writeMetaValue(PDO $db, string $key, string $value): void
{
    $stmt = $db->prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    $stmt->execute([$key, $value]);
}

function latestSavedAt(PDO $db): ?string
{
    $stmt = $db->prepare('SELECT value FROM meta WHERE key = ?');
    $stmt->execute(['savedAt']);
    $value = $stmt->fetchColumn();
    return is_string($value) && $value !== '' ? $value : null;
}

function createMonthlyBackupIfNeeded(PDO $db, string $dbPath, string $backupDir): void
{
    $monthKey = gmdate('Y-m');
    $sqliteBackupPath = $backupDir . '/weightup-' . $monthKey . '.sqlite3';
    $csvBackupPath = $backupDir . '/weightup-' . $monthKey . '.csv';
    if (!is_file($sqliteBackupPath) && is_file($dbPath)) {
        if (!copy($dbPath, $sqliteBackupPath)) {
            throw new RuntimeException('Could not create SQLite backup.');
        }
    }
    if (!is_file($csvBackupPath)) {
        writeAtomically($csvBackupPath, encodeCsvFromDatabase($db));
    }
}

function countMonthlyBackups(string $backupDir): int
{
    $files = glob($backupDir . '/weightup-*.sqlite3');
    return is_array($files) ? count($files) : 0;
}

function requireMethod(string $method): void
{
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== strtoupper($method)) {
        header('Allow: ' . strtoupper($method));
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
}

function requireSameOriginIfPresent(): void
{
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin === '') {
        return;
    }
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = (string)($_SERVER['HTTP_HOST'] ?? '');
    if ($host === '') {
        return;
    }
    $expected = $scheme . '://' . $host;
    if ($origin !== $expected) {
        throw new RuntimeException('Origin not allowed.');
    }
}

function googleConfigured(array $config): bool
{
    return !empty($config['google_client_id']) && !empty($config['allowed_emails']) && is_array($config['allowed_emails']);
}

function requireGoogleConfigured(array $config): void
{
    if (!googleConfigured($config)) {
        throw new RuntimeException('Google sign-in is not configured yet.');
    }
}

function currentSessionUser(): ?array
{
    return isset($_SESSION['weightup_user']) && is_array($_SESSION['weightup_user']) ? $_SESSION['weightup_user'] : null;
}

function requireSignedInUser(): array
{
    $user = currentSessionUser();
    if ($user === null || empty($user['email'])) {
        throw new RuntimeException('Please sign in with an allowed Google account first.');
    }
    return $user;
}

function verifyGoogleIdToken(string $credential, string $clientId): array
{
    $url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . rawurlencode($credential);
    $response = fetchUrl($url);
    $claims = json_decode($response, true);
    if (!is_array($claims)) {
        throw new RuntimeException('Google token verification failed.');
    }
    $aud = (string)($claims['aud'] ?? '');
    $iss = (string)($claims['iss'] ?? '');
    $exp = (int)($claims['exp'] ?? 0);
    $emailVerified = (string)($claims['email_verified'] ?? '');
    if ($aud !== $clientId) {
        throw new RuntimeException('Google token audience mismatch.');
    }
    if (!in_array($iss, ['accounts.google.com', 'https://accounts.google.com'], true)) {
        throw new RuntimeException('Google token issuer mismatch.');
    }
    if ($exp !== 0 && $exp < time()) {
        throw new RuntimeException('Google token is expired.');
    }
    if ($emailVerified !== 'true' && $emailVerified !== '1') {
        throw new RuntimeException('Google email is not verified.');
    }
    return $claims;
}

function fetchUrl(string $url): string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if (!is_string($body) || $status < 200 || $status >= 300) {
            throw new RuntimeException('Could not reach Google token verification service.');
        }
        return $body;
    }
    $body = @file_get_contents($url);
    if (!is_string($body) || $body === '') {
        throw new RuntimeException('Could not reach Google token verification service.');
    }
    return $body;
}

function emailAllowed(string $email, array $allowedEmails): bool
{
    $normalized = array_map(static fn($value) => strtolower(trim((string)$value)), $allowedEmails);
    return in_array($email, $normalized, true);
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        throw new InvalidArgumentException('Request body is empty.');
    }
    if (strlen($raw) > MAX_REQUEST_BYTES) {
        throw new InvalidArgumentException('Request body is too large.');
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        throw new InvalidArgumentException('Request body must be valid JSON.');
    }
    return $decoded;
}

function extractSetsCsv(array $body): string
{
    $state = $body['state'] ?? $body;
    if (!is_array($state) && !isset($body['setsCsv'])) {
        throw new InvalidArgumentException('Request must include setsCsv.');
    }
    $setsCsv = $body['setsCsv'] ?? ($state['setsCsv'] ?? null);
    if (!is_string($setsCsv) || trim($setsCsv) === '') {
        throw new InvalidArgumentException('setsCsv must be a non-empty string.');
    }
    return $setsCsv;
}

function normalizeClientMetadata($value): ?array
{
    if (!is_array($value)) {
        return null;
    }
    return [
        'name' => normalizeOptionalString($value['name'] ?? null),
        'version' => normalizeOptionalString($value['version'] ?? null),
        'origin' => normalizeOptionalString($value['origin'] ?? null),
    ];
}

function normalizeOptionalString($value): ?string
{
    if ($value === null) {
        return null;
    }
    return is_scalar($value) ? (string)$value : null;
}

function ensureDir(string $path): void
{
    if (is_dir($path)) {
        return;
    }
    if (!mkdir($path, 0775, true) && !is_dir($path)) {
        throw new RuntimeException('Could not create directory.');
    }
}

function writeAtomically(string $path, string $contents): void
{
    $tempPath = $path . '.tmp';
    if (file_put_contents($tempPath, $contents, LOCK_EX) === false) {
        throw new RuntimeException('Could not write temp file.');
    }
    if (!rename($tempPath, $path)) {
        @unlink($tempPath);
        throw new RuntimeException('Could not replace target file.');
    }
}

function jsonResponse(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}
