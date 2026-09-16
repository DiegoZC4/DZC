<?php
declare(strict_types=1);
require_once __DIR__ . '/engine.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
ini_set('display_errors', '0');

function kg_response(array $body, int $status = 200): void {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}
// The puzzle database lives beside the document root, never inside it, and this fails
// closed with a 503 rather than serving a downloadable SQLite file. Separate filename
// from nutshell's rooms.sqlite3 so a bug in this game cannot reach a live nutshell room.
function kg_database(): PDO {
    $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__));
    kg_require($root !== false, 'Storage is unavailable.', 503);
    $directory = getenv('KURZGESAGT_DATA_DIR') ?: dirname($root) . '/.kurzgesagt-private';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Cannot create private game storage.');
    $path = realpath($directory);
    kg_require($path !== false && $path !== $root && !str_starts_with($path . '/', $root . '/'), 'Puzzle storage must be outside the public website.', 503);
    $db = new PDO('sqlite:' . $path . '/puzzles.sqlite3', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout = 4000');
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('CREATE TABLE IF NOT EXISTS pool (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, question TEXT NOT NULL, answer TEXT NOT NULL, created INTEGER NOT NULL, puzzle TEXT)');
    $db->exec('CREATE TABLE IF NOT EXISTS puzzles (id TEXT PRIMARY KEY, pool TEXT, question TEXT NOT NULL, answer TEXT NOT NULL, reveal TEXT NOT NULL, author TEXT NOT NULL, created INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS runs (puzzle TEXT NOT NULL, player TEXT NOT NULL, state TEXT NOT NULL, score INTEGER, name TEXT NOT NULL DEFAULT \'\', updated INTEGER NOT NULL, PRIMARY KEY (puzzle, player))');
    $db->exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, amount INTEGER NOT NULL, expires INTEGER NOT NULL)');
    $db->exec('CREATE INDEX IF NOT EXISTS runs_board ON runs(puzzle, score)');
    return $db;
}
function kg_limit(PDO $db, string $label, int $maximum, int $period): void {
    $time = time();
    // Store only a bucketed hash, not visitors' raw IP addresses.
    $key = hash('sha256', $label . ':' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . ':' . intdiv($time, $period));
    $q = $db->prepare('INSERT INTO limits(bucket, amount, expires) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET amount = amount + 1');
    $q->execute([$key, $time + $period]);
    $q = $db->prepare('SELECT amount FROM limits WHERE bucket = ?');
    $q->execute([$key]);
    kg_require((int)$q->fetchColumn() <= $maximum, 'Too many requests. Give it a moment and try again.', 429);
}
// One integer the mask screen can poll cheaply: it changes whenever the pool changes.
function kg_version(PDO $db): int {
    $q = $db->query('SELECT value FROM meta WHERE key = \'pool\'');
    return (int)$q->fetchColumn();
}
function kg_bump(PDO $db): int {
    $db->exec('INSERT INTO meta(key, value) VALUES (\'pool\', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1');
    return kg_version($db);
}
// $table is always an internal literal, never anything a request can influence.
function kg_new_id(PDO $db, string $table): string {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $id = '';
        for ($i = 0; $i < 6; $i++) $id .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        $q = $db->prepare("SELECT id FROM $table WHERE id = ?");
        $q->execute([$id]);
    } while ($q->fetchColumn());
    return $id;
}
function kg_read_id(mixed $value): string {
    $value = strtoupper(trim((string)$value));
    kg_require(preg_match('/^[A-HJ-NP-Z2-9]{6}$/D', $value) === 1, 'That is not a puzzle code.', 404);
    return $value;
}
function kg_load_puzzle(PDO $db, string $id): array {
    $q = $db->prepare('SELECT * FROM puzzles WHERE id = ?');
    $q->execute([$id]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    kg_require($row !== false, 'That puzzle does not exist.', 404);
    $words = kg_words($row['question']);
    $order = json_decode((string)$row['reveal'], true, 4, JSON_THROW_ON_ERROR);
    kg_require(kg_is_order($order, count($words)), 'That puzzle is damaged.', 500);
    return [
        'id' => $row['id'], 'question' => $row['question'], 'answer' => $row['answer'],
        'words' => $words, 'order' => $order, 'author' => $row['author'], 'created' => (int)$row['created'],
    ];
}
function kg_board_for(PDO $db, array $puzzle, string $player, bool $open): array {
    $q = $db->prepare('SELECT player, name, score FROM runs WHERE puzzle = ? AND score IS NOT NULL ORDER BY score ASC LIMIT 200');
    $q->execute([$puzzle['id']]);
    $rows = [];
    $best = null;
    $solved = 0;
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $score = (int)$row['score'];
        $solved++;
        if ($best === null || $score < $best) $best = $score;
        $rows[] = [
            'name' => (string)$row['name'], 'score' => $score,
            'you' => hash_equals($row['player'], $player), 'author' => hash_equals($row['player'], $puzzle['author']),
        ];
    }
    // Before you finish, all you get is the shape of the field. Nobody watches you flail.
    return ['solved' => $solved, 'best' => $best, 'rows' => $open ? kg_board($rows) : null];
}

$db = null;
$locked = false;
try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    kg_require(in_array($method, ['GET', 'POST'], true), 'Use GET or POST.', 405);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') kg_require(parse_url($origin, PHP_URL_HOST) === parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST), 'Use this game from its own website.', 403);
    kg_require((int)($_SERVER['CONTENT_LENGTH'] ?? 0) <= 10000, 'Request too large.', 413);
    $body = [];
    if ($method === 'POST') {
        kg_require(str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json'), 'Send JSON.', 415);
        $raw = file_get_contents('php://input', false, null, 0, 10001);
        kg_require(strlen($raw) <= 10000, 'Request too large.', 413);
        $body = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
        kg_require(is_array($body), 'Invalid request.');
    }
    $action = $method === 'GET' ? (string)($_GET['do'] ?? 'puzzle') : ($body['action'] ?? '');
    kg_require(is_string($action), 'Invalid action.');

    $db = kg_database();
    $db->exec('BEGIN IMMEDIATE');
    $locked = true;
    $now = time();
    if ($action !== 'version') {
        // Published puzzles are permanent: only never-published drafts age out.
        $db->prepare('DELETE FROM pool WHERE puzzle IS NULL AND created < ?')->execute([$now - 604800]);
        $db->prepare('DELETE FROM limits WHERE expires < ?')->execute([$now]);
    }
    kg_limit($db, 'request', 1800, 60);

    // The player token is minted by the server, stored only as a hash, and handed back once.
    // The browser keeps it per slot so several tabs can be several players on one machine.
    $token = (string)($_SERVER['HTTP_X_KURZGESAGT_TOKEN'] ?? '');
    $newToken = null;
    if (preg_match('/^[a-f0-9]{64}$/D', $token) !== 1) {
        $token = bin2hex(random_bytes(32));
        $newToken = $token;
    }
    $player = hash('sha256', $token);
    $result = [];

    if ($action === 'version') {
        $result = ['version' => kg_version($db)];
    } elseif ($action === 'pool') {
        // Oldest first: the masker sees questions in the order they were added. Published
        // questions leave the pool, so this response never carries a live puzzle's words.
        $rows = $db->query('SELECT id, question, created FROM pool WHERE puzzle IS NULL ORDER BY seq ASC LIMIT 500')->fetchAll(PDO::FETCH_ASSOC);
        $questions = [];
        foreach ($rows as $row) {
            $questions[] = ['id' => $row['id'], 'question' => $row['question'], 'words' => count(kg_words($row['question'])), 'created' => (int)$row['created']];
        }
        $recent = [];
        foreach ($db->query('SELECT id, created FROM puzzles ORDER BY created DESC, rowid DESC LIMIT 12')->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $recent[] = ['id' => $row['id'], 'created' => (int)$row['created']];
        }
        $result = [
            'version' => kg_version($db), 'questions' => $questions, 'recent' => $recent,
            'published' => (int)$db->query('SELECT COUNT(*) FROM puzzles')->fetchColumn(),
        ];
    } elseif ($action === 'question') {
        // The masker needs the answer to set an order that does not give it away.
        $q = $db->prepare('SELECT id, question, answer, puzzle FROM pool WHERE id = ?');
        $q->execute([kg_read_id($_GET['id'] ?? '')]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        kg_require($row !== false, 'That question is no longer in the pool.', 404);
        kg_require($row['puzzle'] === null, 'That question has already been published.', 409);
        $result = ['id' => $row['id'], 'question' => $row['question'], 'answer' => $row['answer'], 'words' => kg_words($row['question'])];
    } elseif ($action === 'puzzles') {
        // Ids only. Nothing here hints at a word of any puzzle.
        $rows = $db->query('SELECT id, created FROM puzzles ORDER BY created DESC, rowid DESC LIMIT 40')->fetchAll(PDO::FETCH_ASSOC);
        $puzzles = [];
        foreach ($rows as $row) $puzzles[] = ['id' => $row['id'], 'created' => (int)$row['created']];
        $result = ['puzzles' => $puzzles];
    } elseif ($action === 'puzzle') {
        $id = trim((string)($_GET['id'] ?? ''));
        if ($id === '') {
            $id = (string)$db->query('SELECT id FROM puzzles ORDER BY created DESC, rowid DESC LIMIT 1')->fetchColumn();
            if ($id === '') {
                $db->exec('COMMIT');
                $locked = false;
                $empty = ['empty' => true];
                if ($newToken !== null) $empty['token'] = $newToken;
                kg_response($empty);
            }
        }
        $puzzle = kg_load_puzzle($db, kg_read_id($id));
        $q = $db->prepare('SELECT state FROM runs WHERE puzzle = ? AND player = ?');
        $q->execute([$puzzle['id'], $player]);
        $stored = $q->fetchColumn();
        $run = $stored === false ? null : kg_load_run(json_decode((string)$stored, true, 8, JSON_THROW_ON_ERROR), $puzzle);
        $result = ['puzzle' => kg_view($puzzle, $run), 'board' => kg_board_for($db, $puzzle, $player, $run !== null && kg_open($run))];
    } elseif ($action === 'write') {
        kg_limit($db, 'write', 120, 3600);
        kg_require((int)$db->query('SELECT COUNT(*) FROM pool')->fetchColumn() < 2000, 'The question pool is full.', 503);
        $draft = kg_draft($body['question'] ?? '', $body['answer'] ?? '');
        $id = kg_new_id($db, 'pool');
        $q = $db->prepare('INSERT INTO pool(id, question, answer, created, puzzle) VALUES (?, ?, ?, ?, NULL)');
        $q->execute([$id, $draft['question'], $draft['answer'], $now]);
        $result = ['id' => $id, 'version' => kg_bump($db)];
    } elseif ($action === 'publish') {
        kg_limit($db, 'publish', 120, 3600);
        kg_require((int)$db->query('SELECT COUNT(*) FROM puzzles')->fetchColumn() < 5000, 'The puzzle shelf is full.', 503);
        $q = $db->prepare('SELECT id, question, answer, puzzle FROM pool WHERE id = ?');
        $q->execute([kg_read_id($body['question'] ?? '')]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        kg_require($row !== false, 'That question is no longer in the pool.', 404);
        kg_require($row['puzzle'] === null, 'That question has already been published.', 409);
        $words = kg_words($row['question']);
        $order = kg_order($words, $body['clicked'] ?? [], $row['answer']);
        $id = kg_new_id($db, 'puzzles');
        $q = $db->prepare('INSERT INTO puzzles(id, pool, question, answer, reveal, author, created) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $q->execute([$id, $row['id'], $row['question'], $row['answer'], json_encode($order, JSON_THROW_ON_ERROR), $player, $now]);
        $db->prepare('UPDATE pool SET puzzle = ? WHERE id = ?')->execute([$id, $row['id']]);
        $result = ['id' => $id, 'version' => kg_bump($db)];
    } elseif (in_array($action, ['pass', 'guess', 'reveal', 'name'], true)) {
        $puzzle = kg_load_puzzle($db, kg_read_id($body['id'] ?? ''));
        $q = $db->prepare('SELECT state FROM runs WHERE puzzle = ? AND player = ?');
        $q->execute([$puzzle['id'], $player]);
        $stored = $q->fetchColumn();
        $run = $stored === false ? kg_new_run($puzzle) : kg_load_run(json_decode((string)$stored, true, 8, JSON_THROW_ON_ERROR), $puzzle);
        $outcome = 'stale';
        // A double tap on a laggy phone must not spend two rounds: the client says which
        // round it is acting in, and anything else is a no-op that returns the true state.
        $round = $body['round'] ?? null;
        if (!is_int($round) || $round === $run['rounds']) {
            if ($action === 'pass') $outcome = kg_pass($run, $puzzle);
            elseif ($action === 'guess') $outcome = kg_guess($run, $puzzle, $body['guess'] ?? '');
            elseif ($action === 'reveal') $outcome = kg_give_up($run);
            else {
                kg_name($run, $body['name'] ?? '');
                $outcome = 'named';
            }
            $q = $db->prepare('INSERT INTO runs(puzzle, player, state, score, name, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(puzzle, player) DO UPDATE SET state = excluded.state, score = excluded.score, name = excluded.name, updated = excluded.updated');
            $q->execute([$puzzle['id'], $player, json_encode($run, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $run['score'], $run['name'], $now]);
        }
        $result = ['outcome' => $outcome, 'puzzle' => kg_view($puzzle, $run), 'board' => kg_board_for($db, $puzzle, $player, kg_open($run))];
    } else {
        throw new DomainException('Unknown action.', 400);
    }

    $db->exec('COMMIT');
    $locked = false;
    if ($newToken !== null) $result['token'] = $newToken;
    kg_response($result);
} catch (DomainException $error) {
    if ($locked) $db->exec('ROLLBACK');
    kg_response(['error' => $error->getMessage()], $error->getCode() ?: 400);
} catch (JsonException $error) {
    if ($locked) $db->exec('ROLLBACK');
    kg_response(['error' => 'Invalid request data.'], 400);
} catch (Throwable $error) {
    if ($locked) $db->exec('ROLLBACK');
    error_log('Kurzgesagt: ' . $error->getMessage());
    kg_response(['error' => 'The puzzle server is temporarily unavailable. Your words are still here; try again.'], 503);
}
