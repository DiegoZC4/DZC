<?php
declare(strict_types=1);

header('Cache-Control: private, no-store, max-age=0');
header('Pragma: no-cache');
header('X-LiteSpeed-Cache-Control: no-cache');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
// no-referrer makes native form POSTs send Origin:null, failing our CSRF check.
// Preserve same-site form origins without sending referrers to other sites.
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
require_once __DIR__ . '/sequences-audio-stats-auth.php';
require_once __DIR__ . '/sequences-audio-report.php';
require_once __DIR__ . '/sequences-audio-metrics.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : '';
$status = 'signed-out'; $message = ''; $claim = null; $data = null; $csrf = '';
try {
    if (!in_array($method, ['GET', 'HEAD', 'POST'], true)) { http_response_code(405); exit; }
    if ($action === 'approve') {
        // Machine-only setup endpoint: no cookie/query-key authorization.
        if ($method !== 'POST') { http_response_code(405); exit; }
        if (!audioStatsTokenValid(false)) { http_response_code(404); exit; }
        $input = json_decode(file_get_contents('php://input', false, null, 0, 1024), true);
        $ok = is_string($input['code'] ?? null) && audioDashboardApprove(audioMetricsDb(), $input['code']);
        header('Content-Type: application/json'); http_response_code($ok ? 200 : 409);
        echo json_encode(['approved' => $ok]); exit;
    }
    $private = getenv('DZC_ACCOUNT_PRIVATE') ?: dirname(__DIR__) . '/.site-account';
    if (!is_file($private . '/app/runtime.php') || !is_file($private . '/config.json')) {
        throw new RuntimeException('Account runtime unavailable');
    }
    require_once $private . '/app/runtime.php';
    $config = \DiegoZC\settings($private);
    $session = \DiegoZC\readSession($config);
    $owner = $session['owner'] ?? null;
    $owner = is_string($owner) && preg_match('/^[a-f0-9]{64}$/D', $owner) ? $owner : null;
    $csrf = $session['csrf'] ?? '';
    if ($method === 'POST') {
        if ($owner === null) throw new \DiegoZC\HttpError(401, 'Sign in first.');
        \DiegoZC\requireCsrf($config['origin'], $_SERVER['HTTP_ORIGIN'] ?? null,
            is_string($_POST['csrf'] ?? null) ? $_POST['csrf'] : null, $csrf);
        if ($action === 'logout') {
            \DiegoZC\clearSession($config); header('Location: sequences-audio-dashboard.php', true, 303); exit;
        }
        if ($action !== 'claim') throw new \DiegoZC\HttpError(400, 'Unknown request.');
    }
    if ($owner !== null) {
        $db = audioMetricsDb(); $allowed = audioDashboardOwner($db);
        if ($allowed !== null && hash_equals($allowed, $owner)) {
            $status = 'owner';
            $selected = is_string($_GET['week'] ?? null) ? $_GET['week'] : '';
            $data = audioDashboardData(audioUsageReport(), audioDashboardEpisodes(__DIR__ . '/sequences-audio.xml'), $selected);
        } elseif ($allowed === null) {
            $status = 'setup';
            if ($method === 'POST' && $action === 'claim') $claim = audioDashboardClaim($db, $owner);
        } else { $status = 'denied'; http_response_code(403); }
    }
} catch (\DiegoZC\HttpError $error) {
    $status = 'error'; $message = $error->getMessage(); http_response_code($error->status);
} catch (Throwable $error) {
    $status = 'error'; $message = 'Reporting is temporarily unavailable. No usage data has been exposed.'; http_response_code(503);
}
header('Content-Type: text/html; charset=utf-8');
function esc(mixed $s): string { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function number(mixed $n, int $digits = 0): string { return number_format((float)$n, $digits); }
function dashboardTime(string $iso): string { return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('America/Los_Angeles'))->format('M j, Y, g:i a T'); }
function weekLabel(string $iso): string { return (new DateTimeImmutable(audioDashboardWeekStart($iso)))->format('M j, Y'); }
function episodeLink(string $id, array $titles): string {
    if ($id === 'none') return 'Unattributed';
    return '<a href="sequences-audio.html#' . esc($id) . '">' . esc($titles[$id] ?? $id) . '</a>';
}
function durationMean(array $t, string $e): string { return $t[$e] > 0 ? number($t[$e . '_ms'] / $t[$e] / 1000, 1) . 's' : 'Not observed'; }
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow,noarchive">
  <title>Sequences usage | Private</title>
  <link rel="stylesheet" href="sequences-audio-dashboard.css?v=1">
</head>
<body>
<main>
<header><h1>Sequences usage <span class="badge">Private</span></h1><nav aria-label="Dashboard"><a href="sequences-audio.html">Reader</a>
<?php if (in_array($status, ['owner', 'setup', 'denied'], true)): ?>
<form method="post" action="?action=logout"><input type="hidden" name="csrf" value="<?=esc($csrf)?>"><button type="submit">Sign out</button></form>
<?php endif; ?></nav></header>
<?php if ($status === 'signed-out'): ?>
<section class="gate"><h2>Owner sign-in</h2><p>This dashboard is only available to Diego. Reader accounts do not grant access.</p>
<a class="button" href="account/login.php?return=%2Fsequences-audio-dashboard.php">Sign in with Google</a>
<p class="note">Uses the same sign-in as annotations. No email or profile permission is requested.</p></section>
<?php elseif ($status === 'denied'): ?>
<section class="gate"><h2>This account does not have access</h2><p>Sign out, then use the Google account verified as the site owner.</p></section>
<?php elseif ($status === 'setup'): ?>
<section class="gate"><h2>Verify the owner once</h2><p>Your Google account is signed in. Approval from Diego's Mac is required before any statistics are shown.</p>
<?php if ($claim !== null): ?>
<p>Use this code with the dashboard authorization helper on your Mac. It expires in 15 minutes.</p><code id="pairing-code"><?=esc($claim)?></code>
<p><a class="button" href="sequences-audio-dashboard.php">Check access</a></p>
<?php else: ?>
<form method="post" action="?action=claim"><input type="hidden" name="csrf" value="<?=esc($csrf)?>"><button type="submit">Get verification code</button></form>
<?php endif; ?>
<p class="note">Future visits only need your Google sign-in. There is no first-visitor or email-based shortcut.</p></section>
<?php elseif ($status === 'error'): ?>
<section class="gate" role="alert"><h2>Cannot load dashboard</h2><p><?=esc($message)?></p><a href="sequences-audio-dashboard.php">Try again</a></section>
<?php else: $t = $data['totals']; ?>
<div class="toolbar"><form method="get"><label for="week">Details for</label> <select id="week" name="week">
<option value="all" <?=$data['selected']==='all'?'selected':''?>>All measured weeks</option>
<?php foreach ($data['weekly'] as $iso => $_): ?><option value="<?=esc($iso)?>" <?=$iso===$data['selected']?'selected':''?>>Week of <?=weekLabel($iso)?><?=$iso===$data['current_week']?' (in progress)':''?></option><?php endforeach; ?>
</select><button type="submit">Show / refresh</button></form><small>Updated <?=esc(dashboardTime($data['generated']))?></small></div>
<?php if ($data['unavailable']): ?><p class="warning" role="alert">Current counters could not be loaded. Missing data is not zero usage. Historical counts remain below.</p><?php else: ?>
<dl class="totals" aria-label="Selected period totals">
<?php foreach ([['Page loads',number($t['page'])],['Play starts',number($t['play'])],['Listening minutes',number($t['listen']/60,1)],['Podcast requests',number($t['podcast'])],['Playback errors',number($t['mediaerror'])]] as [$name,$value]): ?>
<div><dt><?=esc($name)?></dt><dd><?=esc($value)?></dd></div><?php endforeach; ?></dl>
<p class="note">Podcast requests are daily-deduplicated estimates, not completed downloads or listens. Listening time is observed webpage playback only.</p>
<section><h2>Weekly usage</h2><p class="note">Calendar weeks start Monday at 00:00 UTC. Click a week to inspect its episodes and errors.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Weekly usage table"><table><thead><tr><th>Week of</th><th>Page loads</th><th>Play starts</th><th>Listening min</th><th>Podcast requests</th><th>Playback errors</th></tr></thead><tbody>
<?php foreach ($data['weekly'] as $iso => $w): ?><tr <?=$data['selected']===$iso?'class="selected"':''?>><th scope="row"><a href="?week=<?=esc($iso)?>"><?=weekLabel($iso)?></a><?=$iso===$data['current_week']?' <span class="badge">Partial</span>':''?></th>
<?php foreach ([$w['page'],$w['play'],round($w['listen']/60,1),$w['podcast'],$w['mediaerror']] as $n): ?><td><?=number($n, is_float($n)?1:0)?></td><?php endforeach; ?></tr><?php endforeach; ?>
</tbody></table></div>
<p class="note">Detailed collection began <?= $data['started'] ? esc(dashboardTime($data['started'])) : 'not yet' ?>; the first week is incomplete. Historical podcast downloads were not collected.</p></section>
<section><h2>By episode <small><?= $data['selected']==='all'?'all measured weeks':'week of '.weekLabel($data['selected']) ?></small></h2>
<?php if (!$data['episodes']): ?><p class="empty">No recorded activity in this period yet.</p><?php else: ?>
<div class="table-wrap" tabindex="0" role="region" aria-label="Episode usage table"><table><thead><tr><th>Episode</th><th>Page loads</th><th>Est. devices</th><th>Play starts</th><th>Listening min</th><th>Podcast requests</th><th>Errors</th></tr></thead><tbody>
<?php foreach ($data['episodes'] as $id => $w): ?><tr><th scope="row"><?=episodeLink($id,$data['titles'])?></th><td><?=number($w['page'])?></td><td><?=$w['devices']===null?'n/a':number($w['devices'])?></td><td><?=number($w['play'])?></td><td><?=number($w['listen']/60,1)?></td><td><?=number($w['podcast'])?></td><td><?=number($w['mediaerror'])?></td></tr><?php endforeach; ?>
</tbody></table></div><p class="note">Estimated devices are deduplicated per calendar week and episode, not people. They are not added across episodes or weeks.</p><?php endif; ?></section>
<section><h2>Playback health</h2><p class="health-summary">Average start <?=durationMean($t,'startup')?> <span>/</span> <?=number($t['buffer'])?> buffering events, average <?=durationMean($t,'buffer')?> <span>/</span> <?=number($t['retry'])?> retries <span>/</span> <?=number($t['offline-error'])?> offline-download failures</p>
<?php if (!$data['errors']): ?><p class="empty">No errors were reported in this period. Offline failures or blocked telemetry can still go unreported.</p><?php else: ?>
<div class="table-wrap" tabindex="0" role="region" aria-label="Reported error breakdown"><table><thead><tr><th>Episode / error</th><th>Browser or app</th><th>Device</th><th>Connection</th><th>Count</th><th>Last UTC day</th></tr></thead><tbody>
<?php foreach ($data['errors'] as $e): ?><tr><th scope="row"><?=episodeLink($e['episode'],$data['titles'])?><small class="error-label"><?=esc($e['reason'])?></small></th><td><?=esc($e['client'])?></td><td><?=esc($e['device'])?></td><td><?=esc($e['network'])?></td><td><?=number($e['count'])?></td><td><?=esc($e['last_day'])?></td></tr><?php endforeach; ?>
</tbody></table></div><?php endif; ?>
<p class="note">Counts are events, not affected people. Browser-reported errors do not include podcast-app playback. Aborted playback can be intentional. Startup and buffering averages use reported durations only.</p>
<details><summary>Startup and buffering distribution</summary><div class="table-wrap"><table><thead><tr><th>Duration</th><th>Startup events</th><th>Buffering events</th></tr></thead><tbody>
<?php foreach (['<1s','1-3s','3-10s','10-30s','>=30s'] as $bucket): ?><tr><th scope="row"><?=esc($bucket)?></th><td><?=number($data['latency'][$bucket]['startup']??0)?></td><td><?=number($data['latency'][$bucket]['buffer']??0)?></td></tr><?php endforeach; ?>
</tbody></table></div></details></section>
<div class="columns"><section><h2>Podcast apps</h2><p class="note"><?=number($t['podcast'])?> daily-deduplicated / <?=number($t['podcast-requests'])?> raw start requests. App names are inferred, not verified.</p>
<?php if (!$data['clients']): ?><p class="empty">No podcast requests recorded for this period.</p><?php else: ?><dl class="breakdown"><?php foreach ($data['clients'] as $name=>$n): ?><div><dt><?=esc($name)?></dt><dd><?=number($n)?></dd></div><?php endforeach; ?></dl><?php endif; ?></section>
<section><h2>Reader actions</h2><p class="note">No note contents, selected quotations, or search terms are collected.</p>
<?php if (!$data['actions']): ?><p class="empty">No actions recorded for this period.</p><?php else: ?><dl class="breakdown"><?php foreach ($data['actions'] as $name=>$n): ?><div><dt><?=esc($name)?></dt><dd><?=number($n)?></dd></div><?php endforeach; ?></dl><?php endif; ?></section></div>
<?php endif; ?>
<?php if ($data['legacy']): ?><section><h2>Earlier webpage usage</h2><p class="note">Legacy estimates count distinct network addresses, not page loads or people. These are a different measure from the new counters; migration-week estimates are not combined. Podcast counts and detailed errors were not collected.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Historical webpage usage"><table><thead><tr><th>Week of</th><th>Visitor addresses</th><th>Listener addresses</th><th>Podcast requests</th></tr></thead><tbody>
<?php foreach ($data['legacy'] as $iso=>$w): ?><tr><th scope="row"><?=weekLabel($iso)?></th><td><?=number($w['visitors'])?></td><td><?=number($w['listeners'])?></td><td class="muted">Not collected</td></tr><?php endforeach; ?>
</tbody></table></div></section><?php endif; ?>
<footer>Private aggregate report. Refresh to fetch current counts; no background polling, tracking script, or offline copy of this dashboard.</footer>
<?php endif; ?>
</main></body></html>
