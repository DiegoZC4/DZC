<?php
declare(strict_types=1);

function meleteDirectoryPaths(string $directory, array $user, string $song): array {
    if (!$song || ($user['email_verified'] ?? false) !== true || empty($user['email'])) return [];
    $paths = [];
    foreach (glob($directory . '/directories/*/access.json') ?: [] as $file) {
        $access = json_decode((string)file_get_contents($file), true);
        if (in_array(strtolower($user['email']), $access['viewers'] ?? [], true)
            && in_array($song, $access['songs'] ?? [], true)) $paths[] = dirname($file);
    }
    return $paths;
}

function meleteDirectory(string $directory, array $user, string $song): array {
    $paths = meleteDirectoryPaths($directory, $user, $song);
    if (!$paths) throw new MeleteHttpError(403, 'Singer directory access required');
    $result = ['singers' => [], 'assignments' => [], 'sectionFrom' => []];
    foreach ($paths as $path) {
        $data = json_decode((string)file_get_contents($path . '/roster.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($data['singers'] ?? [] as $person) {
            $result['singers'][] = array_intersect_key($person, array_flip(['name', 'voice', 'guide', 'discord']));
        }
        $access = json_decode((string)file_get_contents($path . '/access.json'), true);
        foreach ($access['songs'] as $allowed) {
            if (isset($data['assignments'][$allowed])) $result['assignments'][$allowed] = $data['assignments'][$allowed];
            $from = $data['sectionFrom'][$allowed] ?? null;
            if (in_array($from, $access['songs'], true)) $result['sectionFrom'][$allowed] = $from;
        }
    }
    return $result;
}
