<?php
declare(strict_types=1);

const AUDIO_STATS_TOKEN_SHA256 = 'be79b50c12d2b00c4c8d0c31cf8e8bc877aed58dfb27b13821e5631d91cd09b4';

function audioStatsTokenValid(bool $allowLegacyQuery = true): bool {
    $header = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    $token = preg_match('/^Bearer ([^\s]+)$/iD', $header, $m) ? $m[1] : '';
    if ($token === '' && $allowLegacyQuery && is_string($_GET['k'] ?? null)) $token = $_GET['k'];
    return $token !== '' && hash_equals(AUDIO_STATS_TOKEN_SHA256, hash('sha256', $token));
}

function audioDashboardOwner(PDO $db): ?string {
    $value = $db->query("SELECT value FROM settings WHERE key='dashboard_owner'")->fetchColumn();
    return is_string($value) && preg_match('/^[a-f0-9]{64}$/D', $value) ? $value : null;
}

// A verified Google account produces a pairing code, never automatic access.
// The existing Mac-only admin key must approve it; identities stay on server.
function audioDashboardClaim(PDO $db, string $owner): string {
    $db->exec('CREATE TABLE IF NOT EXISTS dashboard_claims (owner TEXT PRIMARY KEY, code_hash TEXT UNIQUE, expires INTEGER)');
    $db->prepare('DELETE FROM dashboard_claims WHERE expires < ?')->execute([time()]);
    if ((int)$db->query('SELECT COUNT(*) FROM dashboard_claims')->fetchColumn() >= 100) throw new RuntimeException('Too many pending claims');
    $code = bin2hex(random_bytes(12));
    $db->prepare('INSERT INTO dashboard_claims VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET code_hash=excluded.code_hash,expires=excluded.expires')
        ->execute([$owner, hash('sha256', $code), time() + 900]);
    return $code;
}

function audioDashboardApprove(PDO $db, string $code): bool {
    if (!preg_match('/^[a-f0-9]{24}$/D', $code)) return false;
    $db->exec('CREATE TABLE IF NOT EXISTS dashboard_claims (owner TEXT PRIMARY KEY, code_hash TEXT UNIQUE, expires INTEGER)');
    $db->beginTransaction();
    try {
        $s = $db->prepare('SELECT owner FROM dashboard_claims WHERE code_hash=? AND expires>=?');
        $s->execute([hash('sha256', $code), time()]); $owner = $s->fetchColumn(); $s->closeCursor();
        if (!is_string($owner) || !preg_match('/^[a-f0-9]{64}$/D', $owner) || audioDashboardOwner($db) !== null) {
            $db->rollBack(); return false;
        }
        $db->prepare("INSERT INTO settings(key,value) VALUES ('dashboard_owner',?)")->execute([$owner]);
        $db->exec('DELETE FROM dashboard_claims'); $db->commit(); return true;
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}
