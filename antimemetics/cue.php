<?php
declare(strict_types=1);

// A high-trust discussion room: no identity, session, or participant tracking.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store, max-age=0');
header('X-LiteSpeed-Cache-Control: no-cache');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function reply(int $status, array $value): never {
    http_response_code($status);
    echo json_encode((object)$value, JSON_THROW_ON_ERROR);
    exit;
}
try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['GET', 'POST'], true)) { header('Allow: GET, POST'); reply(405, ['error'=>'Method not allowed']); }
    $site = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
    $limits = json_decode(file_get_contents(__DIR__ . '/release.json'), true, 8, JSON_THROW_ON_ERROR)['weeks'];
    $week = $_GET['week'] ?? '1';
    if (!is_string($week) || !preg_match('/^[1-9][0-9]?$/D', $week) || !isset($limits[$week])) reply(404, ['error'=>'Week not released']);
    $dir = getenv('AM_DISCUSSION_DIR') ?: dirname($site) . '/antimemetics-discussion';
    $path = $dir . '/pointers.sqlite';
    if ($method === 'POST') {
        // Non-simple header + no CORS preflight grant also protects LAN preview
        // browsers without Fetch Metadata. This is not an authentication gate.
        if (($_SERVER['HTTP_X_DISCUSSION_ACTION'] ?? '') !== 'point' ||
            ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? 'same-origin') !== 'same-origin') reply(403, ['error'=>'Use the reader to point']);
        if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) reply(415, ['error'=>'Expected JSON']);
        $raw = file_get_contents('php://input', false, null, 0, 513);
        if (strlen($raw) > 512) reply(413, ['error'=>'Request too large']);
        $body = json_decode($raw, true);
        $chapter = $body['chapter'] ?? null; $word = $body['word'] ?? null; $nonce = $body['nonce'] ?? null;
        if (!is_int($chapter) || !is_int($word) || !isset($limits[$week][$chapter-1]) ||
            $word < 1 || $word > $limits[$week][$chapter-1] ||
            !is_string($nonce) || !preg_match('/^[0-9a-f]{32}$/D', $nonce)) reply(422, ['error'=>'Invalid released passage']);
        umask(0077);
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('Storage unavailable');
        $db = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $db->exec('PRAGMA busy_timeout=2000; CREATE TABLE IF NOT EXISTS cues
          (id INTEGER PRIMARY KEY AUTOINCREMENT, week INTEGER NOT NULL, ch INTEGER NOT NULL,
           word INTEGER NOT NULL, nonce TEXT NOT NULL UNIQUE, sent INTEGER NOT NULL)');
        $db->exec('BEGIN IMMEDIATE');
        $prior = $db->prepare('SELECT id FROM cues WHERE nonce=? AND week=? AND ch=? AND word=?');
        $prior->execute([$nonce,(int)$week,$chapter,$word]); $old = $prior->fetchColumn(); $prior->closeCursor();
        if ($old !== false) { $db->exec('ROLLBACK'); reply(200,['id'=>(int)$old]); }
        $now = time();
        $recent = $db->prepare('SELECT COUNT(*), MAX(sent) FROM cues WHERE week=? AND sent>=?');
        $recent->execute([(int)$week,$now-30]); [$count,$latest] = $recent->fetch(PDO::FETCH_NUM); $recent->closeCursor();
        if ($count >= 12 || ($latest !== null && (int)$latest >= $now)) {
            $db->exec('ROLLBACK'); header('Retry-After: 3'); reply(429,['error'=>'Someone just pointed. Try again in a moment.']);
        }
        $db->prepare('DELETE FROM cues WHERE sent < ?')->execute([time() - 120]);
        $db->prepare('INSERT INTO cues(week,ch,word,nonce,sent) VALUES (?,?,?,?,?)')
            ->execute([(int)$week, $chapter, $word, $nonce, time()]);
        $get = $db->prepare('SELECT id FROM cues WHERE nonce=?'); $get->execute([$nonce]);
        $id = (int)$get->fetchColumn(); $get->closeCursor();
        $db->exec('COMMIT');
        reply(200, ['id'=>$id]);
    }
    $after = $_GET['after'] ?? null;
    if ($after !== null && (!is_string($after) || !preg_match('/^[0-9]{1,15}$/D', $after))) reply(400, ['error'=>'Invalid cursor']);
    if (!is_file($path)) reply(200, ['cursor'=>0, 'events'=>[]]);
    $db = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500');
    $db->beginTransaction();
    $get = $db->prepare('SELECT COALESCE(MAX(id),0) FROM cues WHERE week=?');
    $get->execute([(int)$week]); $cursor = (int)$get->fetchColumn(); $get->closeCursor();
    $events = [];
    // A new/reopened tab establishes a baseline. Do not replay a previous meeting.
    if ($after !== null && (int)$after < $cursor) {
        $get = $db->prepare('SELECT id,ch,word,nonce FROM cues WHERE week=? AND id>? AND sent>=? ORDER BY id');
        $get->execute([(int)$week, (int)$after, time() - 15]);
        foreach ($get as $e) $events[] = ['id'=>(int)$e['id'], 'chapter'=>(int)$e['ch'], 'word'=>(int)$e['word'], 'nonce'=>$e['nonce']];
    }
    $db->commit();
    reply(200, ['cursor'=>$cursor, 'events'=>$events]);
} catch (Throwable $e) {
    reply(503, ['error'=>'Discussion controls temporarily unavailable']);
}
