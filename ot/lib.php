<?php
// Shared helpers for the OwnTracks endpoint.
//
// Config and database live OUTSIDE public_html so neither is ever served:
//   ~/owntracks/config.json    credentials + nav tokens
//   ~/owntracks/track.sqlite3  location history
declare(strict_types=1);

// /home/<user>/owntracks — four levels up from
// <home>/domains/<domain>/public_html/ot. Falls back to a sibling of the
// docroot so a different layout degrades to something findable rather than 500.
function ot_home(): string {
    foreach ([dirname(__DIR__, 4), dirname(__DIR__, 3), dirname(__DIR__, 2)] as $base) {
        if (is_dir($base . '/owntracks')) return $base . '/owntracks';
    }
    return dirname(__DIR__, 4) . '/owntracks';
}

function ot_config(): array {
    static $config = null;
    if ($config === null) {
        $path = ot_home() . '/config.json';
        if (!is_readable($path)) {
            http_response_code(500);
            exit('server not configured');
        }
        $config = json_decode((string)file_get_contents($path), true);
        if (!is_array($config)) {
            http_response_code(500);
            exit('bad configuration');
        }
    }
    return $config;
}

function ot_db(): PDO {
    static $db = null;
    if ($db === null) {
        if (!is_dir(ot_home())) {
            mkdir(ot_home(), 0700, true);
        }
        $db = new PDO('sqlite:' . ot_home() . '/track.sqlite3');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->exec('PRAGMA journal_mode=WAL');
        $db->exec('CREATE TABLE IF NOT EXISTS locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user TEXT NOT NULL, device TEXT, tid TEXT,
            tst INTEGER NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
            acc REAL, alt REAL, batt INTEGER, vel REAL, cog REAL,
            conn TEXT, trigger TEXT, raw TEXT, received INTEGER NOT NULL)');
        $db->exec('CREATE INDEX IF NOT EXISTS locations_user_tst
                   ON locations(user, tst DESC)');
        // One row per (user, tst) keeps replays and retries from duplicating.
        $db->exec('CREATE UNIQUE INDEX IF NOT EXISTS locations_unique
                   ON locations(user, device, tst)');
    }
    return $db;
}

/** Verify HTTP Basic credentials; returns the username or null. */
function ot_authenticate(): ?string {
    $user = $_SERVER['PHP_AUTH_USER'] ?? null;
    $pass = $_SERVER['PHP_AUTH_PW'] ?? null;
    // Hostinger's PHP-FPM does not always populate PHP_AUTH_*; fall back to
    // the raw header, which .htaccess forwards as HTTP_AUTHORIZATION.
    if ($user === null) {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (stripos($header, 'basic ') === 0) {
            $decoded = base64_decode(substr($header, 6), true);
            if ($decoded !== false && strpos($decoded, ':') !== false) {
                [$user, $pass] = explode(':', $decoded, 2);
            }
        }
    }
    if (!is_string($user) || !is_string($pass)) return null;
    $users = ot_config()['users'] ?? [];
    if (!isset($users[$user]['password_hash'])) {
        // Hash anyway so a wrong username costs the same time as a wrong password.
        password_verify($pass, '$2y$10$usesomesillystringforsalt0000000000000000000000000000000');
        return null;
    }
    return password_verify($pass, $users[$user]['password_hash']) ? $user : null;
}
