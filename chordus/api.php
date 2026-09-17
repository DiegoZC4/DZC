<?php
declare(strict_types=1);
require_once __DIR__ . '/server.php';
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');

function chordus_response(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG);
    exit;
}
function chordus_cookie(string $token, int $expires, bool $secure): void {
    $path = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/') . '/';
    setcookie('chordus_conductor', $token, ['expires' => $expires, 'path' => $path, 'secure' => $secure, 'httponly' => true, 'samesite' => 'Strict']);
}
try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    chordus_require(in_array($method, ['GET','POST'], true), 'Use GET or POST.', 405);
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $peer = $_SERVER['REMOTE_ADDR'] ?? '';
    $local = in_array($peer, ['127.0.0.1','::1'], true) && in_array(parse_url('http://' . $host, PHP_URL_HOST), ['127.0.0.1','localhost','[::1]'], true);
    $directory = chordus_data_dir();
    $config = is_file($directory . '/admin.json') ? json_decode(file_get_contents($directory . '/admin.json'), true, 8, JSON_THROW_ON_ERROR) : [];
    // Three ways in, in order of precedence env var, then admin.json, then the
    // password default:
    //   password  a conductor signs in; everyone else reads. Opt in by writing
    //             access_mode into the config; nothing needs a password by default.
    //   open      whoever has the URL may conduct. Knowing the address is the
    //             whole gate. This is the default: a fresh deployment works with
    //             no configuration, and a director can try the app without being
    //             handed a credential first.
    //   url       the local preview. Unlike open it also waives HTTPS, so it is
    //             for 127.0.0.1 and never for a published host.
    $mode = (string)(getenv('CHORDUS_ACCESS_MODE') ?: ($config['access_mode'] ?? 'open'));
    if (!in_array($mode, ['password', 'open', 'url'], true)) $mode = 'password';
    $urlMode = $mode === 'url';
    $openMode = $mode === 'open';
    if ($method === 'POST') {
        // Open mode still demands HTTPS and a same-origin request. Neither asks
        // who you are; they stop the score being written over a tapped
        // connection or by a page the choir is not looking at.
        chordus_require($urlMode || $secure || $local, 'Use HTTPS to edit.', 403);
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        chordus_require($origin === ($secure ? 'https://' : 'http://') . $host, 'Use Chordus from its own website.', 403);
        chordus_require(str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json'), 'Send JSON.', 415);
        chordus_require((int)($_SERVER['CONTENT_LENGTH'] ?? 0) <= 1048576, 'Request too large.', 413);
    }
    $seed = chordus_validate_score(json_decode(file_get_contents(__DIR__ . '/score-seed.json'), true, 32, JSON_THROW_ON_ERROR));
    if ($mode === 'password' && !is_string($config['password_hash'] ?? null)) {
        chordus_require($method === 'GET', 'A conductor password has not been configured.', 503);
        chordus_response(['ok' => true, 'configured' => false, 'accessMode' => 'password', 'conductor' => false, 'revision' => 0, 'score' => $seed]);
    }
    $db = chordus_database($directory);
    // Devices identify themselves. In url mode there is no login, so the id is
    // self-asserted; that is enough to keep one conductor at a time apart from
    // the rest, which is all the reins need to mean.
    $client = chordus_client((string)($_SERVER['HTTP_X_CHORDUS_CLIENT'] ?? 'unknown'));
    $label = chordus_label((string)($_SERVER['HTTP_X_CHORDUS_LABEL'] ?? ''));
    $token = (string)($_COOKIE['chordus_conductor'] ?? '');
    // In open and url mode there is no login, so everyone arrives a conductor and
    // the self-asserted client id is all the reins need: it keeps one holder
    // apart from the rest, which is the only distinction they draw.
    $identity = ($openMode || $urlMode)
        ? (($_SERVER['HTTP_X_CHORDUS_ROLE'] ?? '') === 'conduct' ? ['csrf' => ''] : null)
        : chordus_identity($db, $token);
    if ($method === 'POST') {
        $raw = file_get_contents('php://input', false, null, 0, 1048577);
        chordus_require(strlen($raw) <= 1048576, 'Request too large.', 413);
        $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        chordus_require(is_array($body), 'Invalid request.');
        $action = $body['action'] ?? '';
        if ($action === 'login') {
            chordus_require($mode === 'password', 'This session needs no password.');
            chordus_require(is_string($body['password'] ?? null), 'Enter the conductor password.');
            $identity = chordus_login($db, $body['password'], $config['password_hash'], $peer);
            chordus_cookie($identity['token'], $identity['expires'], $secure);
        } else {
            chordus_require($identity !== null, $mode === 'password' ? 'Sign in as conductor first.' : 'Reload Chordus to edit.', $mode === 'password' ? 401 : 403);
            // The CSRF token guards a signed-in session. Without a login there is
            // no session to ride on, and the same-origin check above is what
            // stands in its place.
            if ($mode === 'password') chordus_require(hash_equals($identity['csrf'], $_SERVER['HTTP_X_CHORDUS_CSRF'] ?? ''), 'Sign in again before editing.', 403);
            if ($action === 'publish') {
                chordus_require(is_int($body['baseRevision'] ?? null) && is_array($body['score'] ?? null), 'Invalid revision or score.');
                chordus_publish($db, $body['score'], $body['baseRevision'], $seed, $body['cue']??null, $client);
            } elseif ($action === 'seize') {
                // Taking the reins is unconditional. This is a room of people who
                // can see each other; the previous holder simply sees it move.
                chordus_seize_reins($db, $client, (string)($body['label'] ?? ''));
            } elseif ($action === 'return') {
                chordus_return_reins($db, $client);
            } elseif ($action === 'cue') {
                chordus_require(is_int($body['baseRevision']??null)&&array_key_exists('cue',$body),'Invalid cue request.');
                chordus_point($db,$body['cue'],$body['baseRevision'],$seed,$client);
            } elseif ($action === 'logout') {
                chordus_require($mode === 'password', 'This session has no sign-in to leave.');
                $db->prepare('DELETE FROM sessions WHERE token_hash=?')->execute([hash('sha256', $token)]);
                chordus_cookie('', time()-3600, $secure); $identity = null;
            } else throw new RuntimeException('Unknown action.', 400);
        }
    }
    // Read the score and cue from one SQLite snapshot: never pair a new cue
    // with an older score during simultaneous publishing and polling.
    // Only a conductor claims an unheld session; a plain viewer never does.
    chordus_hold_reins($db, $client, $label, $identity !== null);
    $db->beginTransaction();
    $current = chordus_current($db, $seed);
    $cue=chordus_current_cue($db,$current['revision']);
    $db->commit();
    $since = filter_var($_GET['since'] ?? -1, FILTER_VALIDATE_INT);
    $cueSince=filter_var($_GET['cueSince']??-1,FILTER_VALIDATE_INT);
    chordus_response(['ok' => true, 'configured' => true, 'accessMode' => $mode, 'conductor' => $identity !== null, 'csrf' => $identity['csrf'] ?? '',
        'revision' => $current['revision'], 'score' => $method === 'GET' && $since === $current['revision'] ? null : $current['score'],
        'cue'=>$method==='GET'&&$since===$current['revision']&&$cueSince===$cue['serial']?null:$cue,
        'reins'=>chordus_reins($db),'client'=>$client,'now'=>time()]);
} catch (JsonException $error) { chordus_response(['ok' => false, 'error' => 'Invalid JSON.'], 400); }
catch (Throwable $error) {
    $code = $error instanceof RuntimeException && in_array($error->getCode(), [400,401,403,405,409,413,415,429,503], true) ? $error->getCode() : 503;
    chordus_response(['ok' => false, 'error' => $code === 503 ? 'Live service is unavailable or not configured.' : $error->getMessage()], $code);
}
