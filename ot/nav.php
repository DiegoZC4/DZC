<?php
// One-tap navigation toward a moving person.
//
// Life360 (and Google Maps, and every other app) freezes the destination at the
// moment navigation starts, which is why following someone on the move means
// reopening the app and pressing Directions again. This is a stable URL that
// resolves to wherever that person is *right now* and bounces straight into
// Google Maps navigation, so a home-screen shortcut is a single tap, and
// tapping it again re-aims at their new position.
//
// The token in the URL is the credential (a "capability URL"): anyone holding
// it can see the position, so it is long, random, and revocable from
// config.json. Referrer-Policy stops the token leaking to Google in Referer.
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

$token = (string)($_GET['t'] ?? '');
$config = ot_config();
$target = null;
foreach (($config['nav_tokens'] ?? []) as $candidate => $who) {
    // Constant-time compare so the token cannot be guessed a character at a time.
    if (hash_equals((string)$candidate, $token)) { $target = $who; break; }
}
if ($target === null) {
    http_response_code(404);
    exit('Not found');
}

$statement = ot_db()->prepare(
    'SELECT lat, lon, tst FROM locations WHERE user = :u ORDER BY tst DESC LIMIT 1');
$statement->execute([':u' => $target]);
$row = $statement->fetch(PDO::FETCH_ASSOC);
if (!$row) {
    http_response_code(404);
    exit('No position recorded yet for that person.');
}

$mode = in_array($_GET['mode'] ?? '', ['walking', 'driving', 'bicycling', 'transit'], true)
    ? $_GET['mode'] : 'driving';
$destination = rawurlencode($row['lat'] . ',' . $row['lon']);
$maps = "https://www.google.com/maps/dir/?api=1&destination={$destination}&travelmode={$mode}";
$age = time() - (int)$row['tst'];

// Fresh fix: go straight there, so the common case stays one tap. A stale fix
// is worth a word of warning rather than silently navigating somewhere they
// left an hour ago.
if ($age <= 900 || isset($_GET['anyway'])) {
    header('Location: ' . $maps, true, 302);
    exit;
}
$name = htmlspecialchars($config['users'][$target]['name'] ?? $target, ENT_QUOTES);
$minutes = intdiv($age, 60);
$when = $minutes < 120 ? "{$minutes} minutes ago" : intdiv($minutes, 60) . ' hours ago';
$link = htmlspecialchars($_SERVER['REQUEST_URI'] . '&anyway=1', ENT_QUOTES);
echo "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
   . "<style>body{font:17px -apple-system,system-ui,sans-serif;margin:3rem 1.5rem;line-height:1.5}"
   . "a{display:inline-block;margin-top:1.5rem;padding:.9rem 1.4rem;background:#0a7;color:#fff;"
   . "border-radius:.6rem;text-decoration:none}</style>"
   . "<p>{$name}'s last known position is <b>{$when}</b>, so it may be out of date.</p>"
   . "<a href='{$link}'>Navigate there anyway</a>";
