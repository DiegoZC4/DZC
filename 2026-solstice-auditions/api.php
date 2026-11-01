<?php
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/lib.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private'); header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
function auditionReply(array $value): never { echo json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES); exit; }
function auditionJson(): array {
    if (($_SERVER['CONTENT_TYPE'] ?? '') !== 'application/json') throw new MeleteHttpError(415, 'JSON required');
    $raw = file_get_contents('php://input', false, null, 0, 1048577);
    if (strlen($raw) > 1048576) throw new MeleteHttpError(413, 'Request too large');
    $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($data)) throw new MeleteHttpError(400, 'Invalid request');
    return $data;
}
try {
    $shared = is_dir(__DIR__ . '/server') ? __DIR__ . '/server' : __DIR__ . '/../cloud';
    $configFile = $shared . '/config.local.php';
    $config = require is_file($configFile) ? $configFile : $shared . '/config.example.php';
    $config['admins'] = ['zamalloachion.diego@gmail.com', 'me@leilaclark.io'];
    if (is_file(__DIR__ . '/config.local.php')) $config = array_replace($config, require __DIR__ . '/config.local.php');
    $directory = $config['data_dir'] ?? '';
    if (!$directory || $directory[0] !== '/') throw new MeleteHttpError(503, 'Private storage is not configured');
    umask(0077);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new MeleteHttpError(503, 'Private storage unavailable');
    $directory = realpath($directory); $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if ($root && ($directory === $root || str_starts_with($directory, $root.'/'))) throw new MeleteHttpError(503, 'Audition storage must not be publicly served');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null; $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (($origin !== null && !in_array($origin, $config['origins'], true)) || ($method === 'POST' && !$origin)) throw new MeleteHttpError(403, 'Origin not allowed');
    if (!in_array($method, ['GET','POST'], true)) throw new MeleteHttpError(405, 'Method not allowed');
    if (!is_dir($directory.'/sessions')) mkdir($directory.'/sessions', 0700);
    session_save_path($directory.'/sessions'); session_name('melete_auditions');
    session_start(['use_strict_mode'=>true,'cookie_httponly'=>true,'cookie_samesite'=>'Lax',
        'cookie_secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off','cookie_path'=>$config['cookie_path'] ?? '/auditions/','gc_maxlifetime'=>604800]);
    if (($_SESSION['expires'] ?? PHP_INT_MAX) < time()) $_SESSION = [];
    if (isset($_SESSION['user'])) $_SESSION['user']['admin'] = auditionAdmin($_SESSION['identity'] ?? [],$config);
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32)); $_SESSION['nonce'] ??= bin2hex(random_bytes(32));
    $action = (string)($_GET['action'] ?? 'status');
    if ($method === 'POST' && !hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_MELETE_CSRF'] ?? '')) throw new MeleteHttpError(403, 'Session expired; sign in again');
    if ($action === 'status' && $method === 'GET') auditionReply(['clientId'=>$config['client_id'] ?? '', 'csrf'=>$_SESSION['csrf'], 'nonce'=>$_SESSION['nonce'], 'user'=>$_SESSION['user'] ?? null]);
    if ($action === 'login' && $method === 'POST') {
        if (($_SESSION['login_at'] ?? 0) > time()-2) throw new MeleteHttpError(429, 'Please wait before retrying');
        $_SESSION['login_at'] = time(); $body = auditionJson();
        $claims = meleteVerify((string)($body['credential'] ?? ''), $config['client_id'] ?? '', $_SESSION['nonce'], meleteCerts($directory));
        if (($claims['email_verified'] ?? false) !== true || !filter_var($claims['email'] ?? '', FILTER_VALIDATE_EMAIL)) throw new MeleteHttpError(403, 'A verified Google account email is required');
        session_regenerate_id(true);
        $_SESSION['identity'] = array_intersect_key($claims,array_flip(['sub','email','email_verified','hd']));
        $_SESSION['user'] = ['id'=>hash('sha256',$claims['sub']), 'name'=>substr((string)($claims['name'] ?? 'Singer'),0,120),
            'email'=>strtolower($claims['email']), 'picture'=>auditionPicture($claims['picture'] ?? null), 'admin'=>auditionAdmin($claims,$config)];
        $_SESSION['expires'] = time()+604800; $_SESSION['csrf'] = bin2hex(random_bytes(32)); $_SESSION['nonce'] = bin2hex(random_bytes(32));
        auditionReply(['user'=>$_SESSION['user'],'csrf'=>$_SESSION['csrf']]);
    }
    if ($action === 'logout' && $method === 'POST') { $_SESSION = []; session_destroy(); auditionReply(['ok'=>true]); }
    $user = $_SESSION['user'] ?? null;
    if (!$user) throw new MeleteHttpError(401, 'Sign in with Google first');
    $owner = $user['id']; session_write_close(); $db = auditionDb($directory);
    if ($action === 'list' && $method === 'GET') auditionReply(['submissions'=>auditionRows($db,$owner)]);
    if ($action === 'review' && $method === 'GET') {
        if (!$user['admin']) throw new MeleteHttpError(403, 'Only audition reviewers can access this list');
        auditionReply(['submissions'=>auditionRows($db,$owner,true)]);
    }
    if ($action === 'detail' && $method === 'GET') auditionReply(auditionDetail($db,$owner,$user['admin'],(string)($_GET['owner'] ?? $owner),(string)($_GET['song'] ?? ''),(int)($_GET['revision'] ?? 0)));
    if ($action === 'audio' && $method === 'GET') auditionAudio($db,$owner,$user['admin'],(string)($_GET['owner'] ?? $owner),(string)($_GET['song'] ?? ''),isset($_GET['revision']) ? (int)$_GET['revision'] : null);
    if ($action === 'chunk' && $method === 'POST') {
        if (($_SERVER['CONTENT_TYPE'] ?? '') !== 'application/octet-stream') throw new MeleteHttpError(415, 'Binary audio required');
        $hash = meleteId($_GET['hash'] ?? null); $raw = file_get_contents('php://input',false,null,0,1048577);
        if (!strlen($raw) || strlen($raw)>1048576 || !hash_equals($hash,hash('sha256',$raw))) throw new MeleteHttpError(400, 'Invalid recording block');
        $db->exec('BEGIN IMMEDIATE');
        try {
            $q=$db->prepare('DELETE FROM uploads WHERE created<?'); $q->execute([time()-3600]);
            $q=$db->prepare('SELECT COALESCE(SUM(length(data)),0) FROM uploads WHERE owner=? AND hash!=?'); $q->execute([$owner,$hash]);
            if ((int)$q->fetchColumn()+strlen($raw)>33554432 || (int)$db->query('SELECT COALESCE(SUM(length(data)),0) FROM uploads')->fetchColumn()+strlen($raw)>268435456)
                throw new MeleteHttpError(413,'Upload storage limit reached; keep your local recording and retry later');
            $q=$db->prepare('INSERT OR REPLACE INTO uploads VALUES (?,?,?,?)');
            $q->bindValue(1,$owner); $q->bindValue(2,$hash); $q->bindValue(3,$raw,PDO::PARAM_LOB); $q->bindValue(4,time(),PDO::PARAM_INT); $q->execute();
            $db->exec('COMMIT');
        } catch(Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
        auditionReply(['ok'=>true]);
    }
    if ($action === 'submit' && $method === 'POST') auditionReply(auditionCommit($db,$owner,$user,auditionJson(),$config));
    if ($action === 'withdraw' && $method === 'POST') {
        $body=auditionJson();
        if (!is_int($body['revision'] ?? null)) throw new MeleteHttpError(400,'Revision required');
        $q=$db->prepare('DELETE FROM submissions WHERE owner=? AND song=? AND revision=?'); $q->execute([$owner,(string)($body['song'] ?? ''),$body['revision']]);
        if (!$q->rowCount()) throw new MeleteHttpError(409,'Submission changed; reload before withdrawing');
        auditionReply(['ok'=>true]);
    }
    throw new MeleteHttpError(404,'Unknown audition action');
} catch (Throwable $error) {
    http_response_code($error instanceof MeleteHttpError ? $error->status : ($error instanceof JsonException ? 400 : 500));
    auditionReply(['error'=>$error instanceof MeleteHttpError ? $error->getMessage() : 'Could not save your audition; local takes and the previous submission were kept']);
}
