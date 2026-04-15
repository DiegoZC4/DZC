<?php
declare(strict_types=1);

session_start([
    'cookie_httponly' => true,
    'cookie_samesite' => 'Lax',
    'use_strict_mode' => true,
]);

const MAX_REQUEST_BYTES = 2_000_000;
const API_VERSION = '3';
const CSV_HEADER = "date,time,name,exercise,weight,reps\n";

$config = require __DIR__ . '/config.php';

$dataDir = __DIR__ . '/data';
$backupDir = $dataDir . '/backups';
$csvPath = $dataDir . '/weightup.csv';
$metaPath = $dataDir . '/meta.json';

ensureDir($dataDir);
ensureDir($backupDir);
ensureCsvExists($csvPath);

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
                'savedAt' => latestSavedAt($metaPath),
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
                'savedAt' => latestSavedAt($metaPath),
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
                'savedAt' => latestSavedAt($metaPath),
                'setsCsv' => readCsv($csvPath),
            ]);
            break;

        case 'save':
            requireMethod('POST');
            requireSameOriginIfPresent();
            $session = requireSignedInUser();
            $body = readJsonBody();
            $setsCsv = extractSetsCsv($body);
            $normalizedCsv = normalizeCsv($setsCsv);
            createMonthlyBackupIfNeeded($csvPath, $backupDir);
            writeAtomically($csvPath, $normalizedCsv);
            writeMeta($metaPath, [
                'savedAt' => gmdate('c'),
                'authenticatedUser' => $session['email'],
                'remoteAddr' => $_SERVER['REMOTE_ADDR'] ?? '',
                'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
                'client' => normalizeClientMetadata($body['client'] ?? null),
                'apiVersion' => API_VERSION,
            ]);
            jsonResponse([
                'ok' => true,
                'version' => API_VERSION,
                'authenticatedUser' => $session['email'],
                'savedAt' => latestSavedAt($metaPath),
            ]);
            break;

        case 'download':
            requireMethod('GET');
            requireSignedInUser();
            header('Content-Type: text/csv; charset=utf-8');
            header('Cache-Control: no-store');
            echo readCsv($csvPath);
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

function normalizeCsv(string $csv): string
{
    $normalized = str_replace(["\r\n", "\r"], "\n", trim($csv));
    if ($normalized === '') {
        return CSV_HEADER;
    }
    if (!str_starts_with(strtolower($normalized), 'date,time,name,exercise,weight,reps')) {
        throw new InvalidArgumentException('CSV header must be date,time,name,exercise,weight,reps.');
    }
    return $normalized . "\n";
}

function readCsv(string $path): string
{
    ensureCsvExists($path);
    $contents = file_get_contents($path);
    if ($contents === false) {
        throw new RuntimeException('Could not read CSV file.');
    }
    return $contents;
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

function ensureCsvExists(string $path): void
{
    if (is_file($path)) {
        return;
    }
    writeAtomically($path, CSV_HEADER);
}

function createMonthlyBackupIfNeeded(string $csvPath, string $backupDir): void
{
    if (!is_file($csvPath)) {
        return;
    }
    $monthKey = gmdate('Y-m');
    $backupPath = $backupDir . '/weightup-' . $monthKey . '.csv';
    if (is_file($backupPath)) {
        return;
    }
    $current = file_get_contents($csvPath);
    if ($current === false || trim($current) === '') {
        return;
    }
    writeAtomically($backupPath, $current);
}

function countMonthlyBackups(string $backupDir): int
{
    $files = glob($backupDir . '/weightup-*.csv');
    return is_array($files) ? count($files) : 0;
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

function writeMeta(string $path, array $meta): void
{
    $json = json_encode($meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        throw new RuntimeException('Could not encode metadata.');
    }
    writeAtomically($path, $json . PHP_EOL);
}

function latestSavedAt(string $metaPath): ?string
{
    if (!is_file($metaPath)) {
        return null;
    }
    $decoded = json_decode((string)file_get_contents($metaPath), true);
    return is_array($decoded) ? ($decoded['savedAt'] ?? null) : null;
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
