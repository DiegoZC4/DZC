<?php
// OwnTracks HTTP-mode endpoint.
//
// The phone POSTs a location here; we store it and answer with the OTHER
// household member's latest position. OwnTracks renders whatever location and
// card objects come back in the response as Friends, which is how two phones
// see each other without an MQTT broker — the part that matters on shared
// hosting, where no long-running process is allowed.
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit('[]');
}
$user = ot_authenticate();
if ($user === null) {
    header('WWW-Authenticate: Basic realm="owntracks"');
    http_response_code(401);
    exit('[]');
}

$body = (string)file_get_contents('php://input');
// A zero-length body is normal: the app sends one when a friend is removed.
$message = $body === '' ? null : json_decode($body, true);
$device = $_SERVER['HTTP_X_LIMIT_D'] ?? ($message['topic'] ?? '') ?: 'phone';
$device = preg_replace('/[^A-Za-z0-9_.-]/', '', (string)$device) ?: 'phone';

if (is_array($message) && ($message['_type'] ?? '') === 'location'
    && isset($message['lat'], $message['lon'])) {
    $statement = ot_db()->prepare(
        'INSERT OR IGNORE INTO locations
         (user, device, tid, tst, lat, lon, acc, alt, batt, vel, cog, conn, trigger, raw, received)
         VALUES (:u,:d,:tid,:tst,:lat,:lon,:acc,:alt,:batt,:vel,:cog,:conn,:t,:raw,:now)');
    $statement->execute([
        ':u' => $user, ':d' => $device,
        ':tid' => (string)($message['tid'] ?? ''),
        ':tst' => (int)($message['tst'] ?? time()),
        ':lat' => (float)$message['lat'], ':lon' => (float)$message['lon'],
        ':acc' => isset($message['acc']) ? (float)$message['acc'] : null,
        ':alt' => isset($message['alt']) ? (float)$message['alt'] : null,
        ':batt' => isset($message['batt']) ? (int)$message['batt'] : null,
        ':vel' => isset($message['vel']) ? (float)$message['vel'] : null,
        ':cog' => isset($message['cog']) ? (float)$message['cog'] : null,
        ':conn' => (string)($message['conn'] ?? ''),
        ':t' => (string)($message['t'] ?? ''),
        ':raw' => $body, ':now' => time(),
    ]);
}

// Answer with everyone else's most recent fix.
$config = ot_config();
$friends = [];
$latest = ot_db()->prepare(
    'SELECT user, device, tid, tst, lat, lon, acc, batt
     FROM locations WHERE user = :u ORDER BY tst DESC LIMIT 1');
foreach (array_keys($config['users'] ?? []) as $other) {
    if ($other === $user) continue;
    $latest->execute([':u' => $other]);
    $row = $latest->fetch(PDO::FETCH_ASSOC);
    if (!$row) continue;
    $topic = 'owntracks/' . $other . '/' . ($row['device'] ?: 'phone');
    $friends[] = array_filter([
        '_type' => 'location', 'topic' => $topic,
        'tid' => $row['tid'] ?: substr($other, -2),
        'lat' => (float)$row['lat'], 'lon' => (float)$row['lon'],
        'tst' => (int)$row['tst'],
        'acc' => $row['acc'] !== null ? (float)$row['acc'] : null,
        'batt' => $row['batt'] !== null ? (int)$row['batt'] : null,
    ], fn($v) => $v !== null);
    $friends[] = [
        '_type' => 'card', 'topic' => $topic,
        'name' => $config['users'][$other]['name'] ?? $other,
        'tid' => $row['tid'] ?: substr($other, -2),
    ];
}
echo json_encode($friends);
