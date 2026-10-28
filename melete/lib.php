<?php
declare(strict_types=1);

spl_autoload_register(function (string $class): void {
    $prefix = 'Firebase\\JWT\\';
    if (str_starts_with($class, $prefix)) {
        $name = substr($class, strlen($prefix));
        if (preg_match('/^[A-Za-z]+$/D', $name)) require_once __DIR__ . '/vendor/php-jwt/src/' . $name . '.php';
    }
});

final class MeleteHttpError extends RuntimeException {
    public function __construct(public int $status, string $message) { parent::__construct($message); }
}
function meleteId(mixed $value): string {
    if (!is_string($value) || !preg_match('/^[a-f0-9]{64}$/D', $value)) throw new MeleteHttpError(400, 'Invalid storage key');
    return $value;
}
function meleteVerify(string $token, string $client, string $nonce, array $certs): array {
    if (!$client || !$nonce || strlen($token) > 16384) throw new MeleteHttpError(401, 'Invalid Google sign-in');
    $keys = [];
    foreach ($certs as $kid => $cert) $keys[$kid] = new Firebase\JWT\Key($cert, 'RS256');
    try { $claims = (array)Firebase\JWT\JWT::decode($token, $keys); }
    catch (Throwable $e) { throw new MeleteHttpError(401, 'Google sign-in could not be verified'); }
    if (($claims['aud'] ?? null) !== $client || !in_array($claims['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)
        || !is_string($claims['sub'] ?? null) || !preg_match('/^[a-zA-Z0-9_-]{1,255}$/D', $claims['sub'])
        || !is_int($claims['exp'] ?? null) || $claims['exp'] <= time()
        || !is_string($claims['nonce'] ?? null) || !hash_equals($nonce, $claims['nonce'])) {
        throw new MeleteHttpError(401, 'Google sign-in does not match this session');
    }
    return $claims;
}
function meleteCerts(string $directory): array {
    $file = $directory . '/google-certs.json';
    $cache = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    if (($cache['expires'] ?? 0) > time()) return $cache['certs'];
    $curl = curl_init('https://www.googleapis.com/oauth2/v1/certs');
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_FOLLOWLOCATION => false]);
    $raw = curl_exec($curl); $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $certs = is_string($raw) ? json_decode($raw, true) : null;
    if ($status !== 200 || !is_array($certs) || !$certs) throw new MeleteHttpError(503, 'Google verification temporarily unavailable');
    $cache = json_encode(['expires' => time() + 1800, 'certs' => $certs], JSON_THROW_ON_ERROR);
    $temp = $file . '.' . bin2hex(random_bytes(8));
    file_put_contents($temp, $cache, LOCK_EX); rename($temp, $file);
    return $certs;
}
function meleteDatabase(string $directory): PDO {
    $db = new PDO('sqlite:' . $directory . '/melete.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout=5000');
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('CREATE TABLE IF NOT EXISTS profiles (owner TEXT NOT NULL, slot TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(owner,slot))');
    $db->exec('CREATE TABLE IF NOT EXISTS blobs (owner TEXT NOT NULL, hash TEXT NOT NULL, data BLOB NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(owner,hash))');
    return $db;
}
function meleteProfile(PDO $db, string $owner, string $key): ?array {
    $q = $db->prepare('SELECT revision,payload,updated FROM profiles WHERE owner=? AND slot=?'); $q->execute([$owner, $key]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    return $row ? ['revision' => (int)$row['revision'], 'payload' => json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR), 'updated' => (int)$row['updated']] : null;
}
function meleteBlobRefs(array $payload): array {
    $refs = [];
    foreach ($payload['records'] ?? [] as $entry) foreach (['audio', 'pitches'] as $type) {
        $part = $entry[$type] ?? null;
        if (!is_array($part) || !is_int($part['bytes'] ?? null) || $part['bytes'] <= 0 || $part['bytes'] > 128 * 1024 * 1024
            || !is_array($part['chunks'] ?? null) || !$part['chunks'] || count($part['chunks']) > 512) throw new MeleteHttpError(400, 'Invalid recording blocks');
        foreach ($part['chunks'] as $hash) $refs[] = meleteId($hash);
    }
    return array_values(array_unique($refs));
}
function meleteValidatePayload(array $payload, string $key): void {
    $s = $payload['state'] ?? null;
    if (($payload['version'] ?? null) !== 1 || !is_array($s) || !is_string($s['key'] ?? null)
        || !hash_equals($key, hash('sha256', $s['key'])) || !is_array($s['descriptor'] ?? null)
        || !is_array($s['segments'] ?? null) || count($s['segments']) > 4096
        || !is_array($payload['records'] ?? null) || count($payload['records']) > 256) throw new MeleteHttpError(400, 'Invalid backup manifest');
    $ids = []; $needed = [];
    foreach ($payload['records'] as $entry) {
        $r = $entry['record'] ?? null;
        if (!is_array($r) || !is_string($r['id'] ?? null) || strlen($r['id']) > 128 || isset($ids[$r['id']])
            || !is_int($r['frames'] ?? null) || $r['frames'] <= 0 || !is_int($r['sampleRate'] ?? null)
            || $r['sampleRate'] < 8000 || $r['sampleRate'] > 192000 || $r['frames'] > $r['sampleRate'] * 300 + 1
            || ($entry['audio']['bytes'] ?? 0) !== 44 + $r['frames'] * 2
            || !is_array($r['pitchReference'] ?? null) || !is_array($r['pitchContour'] ?? null)) throw new MeleteHttpError(400, 'Invalid recording metadata');
        $ids[$r['id']] = true;
    }
    $last = 0;
    foreach ($s['segments'] as $segment) {
        if (!isset($ids[$segment['takeId'] ?? '']) || !is_numeric($segment['from'] ?? null) || !is_numeric($segment['to'] ?? null)
            || $segment['from'] < $last || $segment['to'] <= $segment['from'] || $segment['to'] > 3600) throw new MeleteHttpError(400, 'Invalid comp segments');
        $last = $segment['to']; $needed[$segment['takeId']] = true;
    }
    if ($s['bestId'] ?? null) { if (!isset($ids[$s['bestId']])) throw new MeleteHttpError(400, 'Missing continuous recording'); $needed[$s['bestId']] = true; }
    if (array_diff_key($ids, $needed)) throw new MeleteHttpError(400, 'Only comp and best-take recordings may be backed up');
    meleteBlobRefs($payload);
}
function meleteCollect(PDO $db, string $owner): void {
    $q = $db->prepare('SELECT payload FROM profiles WHERE owner=?'); $q->execute([$owner]);
    $keep = [];
    foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $raw) foreach (meleteBlobRefs(json_decode($raw, true)) as $hash) $keep[$hash] = true;
    $q = $db->prepare('SELECT hash FROM blobs WHERE owner=? AND created<?'); $q->execute([$owner, time() - 3600]);
    $delete = $db->prepare('DELETE FROM blobs WHERE owner=? AND hash=?');
    foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $hash) if (!isset($keep[$hash])) $delete->execute([$owner, $hash]);
}
