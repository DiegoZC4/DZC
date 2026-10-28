<?php
if (!extension_loaded('pdo_sqlite') || !extension_loaded('curl') || !extension_loaded('openssl')) {
    throw new RuntimeException('Private backup dependencies unavailable');
}
$root = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
return [
    'client_id' => '141810089581-odm9adgmkico2mne2ocpfjgg9imagggp.apps.googleusercontent.com',
    'origins' => ['https://diegozc.com'],
    'data_dir' => $root ? dirname($root) . '/private/melete' : '',
    'quota_bytes' => 256 * 1024 * 1024,
];
