<?php
if (!extension_loaded('pdo_sqlite') || !extension_loaded('curl') || !extension_loaded('openssl')) {
    throw new RuntimeException('Private audition dependencies unavailable');
}
$root = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
return [
    'client_id' => '141810089581-odm9adgmkico2mne2ocpfjgg9imagggp.apps.googleusercontent.com',
    'origins' => ['https://diegozc.com'],
    'cookie_path' => '/2026-solstice-auditions/',
    'data_dir' => $root ? dirname($root) . '/private/solstice-auditions' : '',
];
