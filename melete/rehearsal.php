<?php
declare(strict_types=1);
// Read-only scoped rehearsal collections. No uploads and no general backup-review privileges.
ini_set('display_errors', '0');
header('Cache-Control: private, no-store, max-age=0');
header('Vary: Cookie');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header('Cross-Origin-Resource-Policy: same-origin');
header("Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
header('X-Robots-Tag: noindex, nofollow');
function stopReview(int $code, string $message): never {
    http_response_code($code); header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error'=>$message]); exit;
}
function signInPage(bool $wrong): never {
    http_response_code($wrong ? 403 : 401);
    header('Content-Type: text/html; charset=utf-8');
    $message=$wrong?'This account does not have access.':'Sign in with the Google account invited to review this rehearsal.';
    $label=$wrong?'Switch Google account':'Sign in with Google';
    echo '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rehearsal review - Melete</title><style>html{color-scheme:light dark}body{font:16px/1.5 system-ui;max-width:32rem;margin:12vh auto;padding:1rem}button{font:inherit;padding:.55em .85em;cursor:pointer}</style><main><h1>Rehearsal review</h1><p id="message">'.$message.'</p><button id="login">'.$label.'</button></main><script>
    const wrong='.($wrong?'true':'false').';
    const login=document.getElementById("login"), message=document.getElementById("message");
    login.onclick=async()=>{const w=window.open("about:blank","melete-review-login","popup,width=460,height=640");if(!w){message.textContent="Allow the sign-in window and try again.";return}try{if(wrong){const s=await (await fetch("api.php?action=status",{cache:"no-store"})).json();const r=await fetch("api.php?action=logout",{method:"POST",headers:{"X-Melete-CSRF":s.csrf,"Content-Type":"application/json"},body:"{}"});if(!r.ok)throw Error()}w.location.replace(new URL("signin.html?direct=1",location.href).href)}catch{w.close();message.textContent="Sign-in could not start. Try again."}};
    addEventListener("message",e=>{if(e.origin===location.origin && e.data?.type==="melete-cloud-signed-in")location.reload()});
    </script></html>'; exit;
}
try {
    if (!in_array($_SERVER['REQUEST_METHOD']??'', ['GET','HEAD'], true)) stopReview(405,'Read only');
    $date=$_GET['date']??''; $action=$_GET['action']??'player';
    if (!is_string($date) || !preg_match('/^\d{4}-\d\d-\d\d$/D',$date) ||
        !in_array($action,['player','catalog','audio','pitch'],true)) stopReview(404,'Not found');
    $config=require __DIR__.'/config.local.php';
    $private=realpath($config['data_dir']??''); $public=realpath($_SERVER['DOCUMENT_ROOT']??'');
    if (!$private || !$public || $private===$public || str_starts_with($private,$public.'/')) stopReview(503,'Private storage unavailable');
    $origin=$_SERVER['HTTP_ORIGIN']??null;
    if ($origin!==null && !in_array($origin,$config['origins']??[],true)) stopReview(403,'Origin not allowed');
    $user=[]; $authorizedSession=false;
    if (!empty($_COOKIE['melete_session'])) {
        session_name('melete_session'); session_save_path($private.'/sessions');
        session_start(['read_and_close'=>true,'use_strict_mode'=>true,'cookie_httponly'=>true,
            'cookie_secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS']!=='off','cookie_samesite'=>'Lax','cookie_path'=>'/','gc_maxlifetime'=>604800]);
        $user=$_SESSION['user']??[];
        $authorizedSession=($_SESSION['expires']??0)>time() && is_string($_SESSION['owner']??null) &&
            hash_equals($_SESSION['owner'],(string)($user['id']??'')) && ($user['email_verified']??false)===true;
    }
    if (!$authorizedSession) {
        if ($action==='player') signInPage(false); stopReview(401,'Sign in required');
    }
    $dir=$private.'/rehearsals/'.$date;
    $acl=@file_get_contents($dir.'/access.json');
    $allowed=$acl===false?[]:(json_decode($acl,true,16,JSON_THROW_ON_ERROR)['viewers']??[]);
    if (!in_array(strtolower($user['email']??''),$allowed,true)) {
        if ($action==='player') signInPage(true); stopReview(403,'No access to this rehearsal');
    }
    if ($action==='player') { $file=$dir.'/player.html'; $type='text/html; charset=utf-8'; }
    elseif ($action==='catalog') { $file=$dir.'/catalog.json'; $type='application/json'; }
    else {
        $id=$_GET['id']??'';
        if (!is_string($id) || !preg_match('/^[a-f0-9]{24}$/D',$id)) stopReview(404,'Not found');
        $file=$dir.'/assets/'.$id.($action==='audio'?'.mp3':'.json');
        $type=$action==='audio'?'audio/mpeg':'application/json';
    }
    $resolved=realpath($file);
    if (!$resolved || !str_starts_with($resolved,$dir.'/') || !is_file($resolved)) stopReview(404,'Not found');
    header('Content-Type: '.$type); header('Content-Length: '.filesize($resolved));
    if ($_SERVER['REQUEST_METHOD']==='GET') readfile($resolved);
} catch (Throwable $e) { stopReview(503,'Rehearsal review unavailable'); }
