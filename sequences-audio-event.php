<?php
declare(strict_types=1);
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
if (($_SERVER['REQUEST_METHOD']??'')!=='POST') {header('Allow: POST');http_response_code(405);exit;}
if (($_GET['v']??'')!=='1'||!is_string($_GET['e']??null)||$_GET['e']==='podcast') {http_response_code(400);exit;}
$origin=parse_url($_SERVER['HTTP_ORIGIN']??'',PHP_URL_HOST);
if ($origin&&!in_array($origin,['diegozc.com','www.diegozc.com','127.0.0.1','localhost'],true)) {http_response_code(403);exit;}
// Existing legacy logs remain readable; no new raw IP/agent records are written.
try {
    require_once __DIR__.'/sequences-audio-metrics.php';
    if (audioMetricsRecord($_GET['e'],$_GET)) http_response_code(204);
    else http_response_code(400);
} catch(Throwable $e) {error_log('Sequences usage metrics unavailable');http_response_code(503);}
