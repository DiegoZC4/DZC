<?php
declare(strict_types=1);

// Listing never widens access: each collection retains its existing email ACL.
function meleteRehearsalDates(string $directory, array $user): array {
    if (($user['email_verified'] ?? false) !== true || empty($user['email'])) return [];
    $dates = [];
    foreach (glob($directory . '/rehearsals/*/access.json') ?: [] as $file) {
        $date = basename(dirname($file));
        if (!preg_match('/^\d{4}-\d\d-\d\d$/D', $date)) continue;
        $acl = json_decode((string)file_get_contents($file), true);
        if (in_array(strtolower($user['email']), $acl['viewers'] ?? [], true)) $dates[] = $date;
    }
    rsort($dates);
    return $dates;
}

function meleteRehearsalList(string $directory, array $user, string $song): array {
    $items = [];
    foreach (meleteRehearsalDates($directory, $user) as $date) {
        $file = $directory . '/rehearsals/' . $date . '/catalog.json';
        if (!is_file($file)) continue;
        $catalog = json_decode((string)file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        foreach ($catalog['items'] ?? [] as $item) {
            if (($item['song'] ?? '') !== $song || ($item['kind'] ?? '') !== 'performance') continue;
            $items[] = ['rehearsalDate' => $date, 'id' => $item['id'], 'name' => $item['singer'],
                'owner' => 'rehearsal:' . hash('sha256', $item['singer']), 'label' => $item['part'],
                'uploaded' => ($item['createdAt'] ?? strtotime($date . 'T12:00:00Z') * 1000),
                'tracked' => ($item['raw']['coverage'] ?? 0) * 100,
                'mean' => $item['raw']['mean'] ?? null, 'median' => $item['raw']['median'] ?? null,
                'takes' => count(array_unique(array_column($item['segments'], 2))),
                'origin' => $item['origin'], 'end' => $item['end'], 'segments' => $item['segments']];
        }
    }
    return $items;
}
