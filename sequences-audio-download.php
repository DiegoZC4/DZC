<?php
declare(strict_types=1);
header('Cache-Control: no-store');header('X-Robots-Tag: noindex, nofollow');
$method=$_SERVER['REQUEST_METHOD']??'';
if (!in_array($method,['GET','HEAD'],true)) {header('Allow: GET, HEAD');http_response_code(405);exit;}
$file=$_GET['file']??'';
$catalog=json_decode((string)@file_get_contents(__DIR__.'/sequences-audio-catalog.json'),true);
$entry=is_string($file)&&is_array($catalog)?($catalog[$file]??null):null;
if (!$entry||!preg_match('~^https://diegozc\.com/audio/[a-zA-Z0-9._-]+\.(mp3|m4a)$~D',$entry['url']??'')) {http_response_code(404);exit;}
// Never proxy audio. Seeking and resumed downloads go straight to static media.
if ($method==='GET'&&(!isset($_SERVER['HTTP_RANGE'])||preg_match('/^bytes=0-/',$_SERVER['HTTP_RANGE']))) {
    try {require_once __DIR__.'/sequences-audio-metrics.php';audioMetricsRecord('podcast',['w'=>$entry['week']]);}
    catch(Throwable $e) {error_log('Sequences podcast metrics unavailable');}
}
header('Location: '.$entry['url'],true,302);exit;
