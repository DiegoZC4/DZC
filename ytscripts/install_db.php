<?php
declare(strict_types=1);

set_time_limit(0);
ignore_user_abort(true);

const DB_GZ_URL = 'https://github.com/DiegoZC4/DZC/releases/download/ytscripts-db/transcripts.sqlite3.gz';
const EXPECTED_GZ_SHA256 = '9228d2333dcb5746ac76531c1fe25225727f073e06b84f903146919ee9c4c453';
const EXPECTED_DB_SHA256 = '2d75d0ab475d5af576d5458cf4f6246af2df8c753d24e56526d4c97bbd5d90dc';

$dataDir = dirname(__DIR__) . '/youtube-transcripts/data';
$dbPath = $dataDir . '/transcripts.sqlite3';
$gzPath = $dataDir . '/transcripts.sqlite3.gz.download';
$tmpDbPath = $dataDir . '/transcripts.sqlite3.tmp';

try {
    if (!is_dir($dataDir) && !mkdir($dataDir, 0775, true) && !is_dir($dataDir)) {
        throw new RuntimeException('Could not create data directory.');
    }

    download_file(DB_GZ_URL, $gzPath);
    $gzHash = hash_file('sha256', $gzPath);
    if ($gzHash !== EXPECTED_GZ_SHA256) {
        throw new RuntimeException('Downloaded gzip hash mismatch: ' . $gzHash);
    }

    decompress_gzip($gzPath, $tmpDbPath);
    $dbHash = hash_file('sha256', $tmpDbPath);
    if ($dbHash !== EXPECTED_DB_SHA256) {
        throw new RuntimeException('Decompressed database hash mismatch: ' . $dbHash);
    }

    if (!rename($tmpDbPath, $dbPath)) {
        throw new RuntimeException('Could not replace transcript database.');
    }
    @unlink($gzPath);

    json_response([
        'ok' => true,
        'path' => $dbPath,
        'bytes' => filesize($dbPath),
        'sha256' => $dbHash,
    ]);
} catch (Throwable $e) {
    @unlink($tmpDbPath);
    json_response(['ok' => false, 'error' => $e->getMessage()], 500);
}

function download_file(string $url, string $path): void
{
    $fp = fopen($path, 'wb');
    if ($fp === false) {
        throw new RuntimeException('Could not open download target.');
    }
    $ch = curl_init($url);
    if ($ch === false) {
        fclose($fp);
        throw new RuntimeException('Could not initialize curl.');
    }
    curl_setopt_array($ch, [
        CURLOPT_FILE => $fp,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_FAILONERROR => true,
        CURLOPT_USERAGENT => 'YTScripts-Installer/1.0',
    ]);
    $ok = curl_exec($ch);
    $error = curl_error($ch);
    curl_close($ch);
    fclose($fp);
    if (!$ok) {
        throw new RuntimeException('Download failed: ' . $error);
    }
}

function decompress_gzip(string $gzPath, string $outPath): void
{
    $in = gzopen($gzPath, 'rb');
    if ($in === false) {
        throw new RuntimeException('Could not open gzip file.');
    }
    $out = fopen($outPath, 'wb');
    if ($out === false) {
        gzclose($in);
        throw new RuntimeException('Could not open database temp file.');
    }
    while (!gzeof($in)) {
        $chunk = gzread($in, 1024 * 1024);
        if ($chunk === false) {
            fclose($out);
            gzclose($in);
            throw new RuntimeException('Could not read gzip chunk.');
        }
        if (fwrite($out, $chunk) === false) {
            fclose($out);
            gzclose($in);
            throw new RuntimeException('Could not write database chunk.');
        }
    }
    fclose($out);
    gzclose($in);
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}
