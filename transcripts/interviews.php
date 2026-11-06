<?php
declare(strict_types=1);

// Search-only grouping. The publication snapshot and source archives stay intact.
function corpus_interviews(PDO $db): array {
    $path = getenv('TRANSCRIPTS_INTERVIEWS') ?: __DIR__ . '/interviews.json';
    $empty = ['by_key'=>[], 'unique_interviews'=>null];
    if (!is_file($path)) return $empty;
    $data = json_decode((string)file_get_contents($path), true);
    $manifest = json_decode((string)$db->query("SELECT value FROM metadata WHERE key='manifest'")->fetchColumn(), true);
    // Never apply an old grouping receipt to a different publication snapshot.
    if (($data['format'] ?? null) !== 1 || ($data['snapshot']['built_at'] ?? null) !== ($manifest['built_at'] ?? null)
        || ($data['snapshot']['records'] ?? null) !== ($manifest['records'] ?? null)) return $empty;
    $index = [];
    foreach ($data['groups'] ?? [] as $group) {
        foreach ($group['members'] as $member) $index[$member['key']] = $group;
    }
    return ['by_key'=>$index, 'unique_interviews'=>$data['unique_interviews']];
}

function corpus_source_identity(string $url): string {
    $p = parse_url($url);
    $host = preg_replace('/^www\./', '', strtolower($p['host'] ?? ''));
    parse_str($p['query'] ?? '', $q);
    $path = $p['path'] ?? '';
    if ($host === 'youtu.be') return 'youtube:' . explode('/', trim($path, '/'))[0];
    if (in_array($host, ['youtube.com','m.youtube.com'], true)) {
        if (!empty($q['v'])) return 'youtube:' . $q['v'];
        if (preg_match('~^/(?:shorts|live|embed)/([^/]+)~', $path, $m)) return 'youtube:' . $m[1];
    }
    return $host . rtrim($path, '/') . (!empty($p['query']) ? '?' . $p['query'] : '');
}

function corpus_group_payload(array $payload, array $index): array {
    $group = $index[$payload['recording_id']] ?? null;
    $payload['interview_id'] = $group['id'] ?? $payload['recording_id'];
    $sources = [];
    foreach ($group['members'] ?? [] as $member) {
        $identity = corpus_source_identity($member['url']);
        if (isset($sources[$identity])) continue;
        $sources[$identity] = $member;
    }
    $payload['source_versions'] = array_values($sources);
    return $payload;
}

function corpus_source_rank(array $item): int {
    return ['youtube'=>0,'odysee'=>1,'vimeo'=>1,'rumble'=>2,'substack'=>3,'twitch'=>4][$item['platform']] ?? 8;
}

function corpus_passage_shingles(string $text): array {
    preg_match_all('/[\p{L}\p{N}]+/u', corpus_fold($text), $m);
    $out = [];
    for ($i = 0; $i + 2 < count($m[0]); $i++) $out[implode(' ', array_slice($m[0], $i, 3))] = true;
    return $out;
}

function corpus_same_passage(array $a, array $b): bool {
    $sa = corpus_passage_shingles($a['snippet']);
    $sb = corpus_passage_shingles($b['snippet']);
    // The search word alone is not evidence; require substantial shared context.
    $shorter = min(count($sa), count($sb));
    return $shorter >= 8 && count(array_intersect_key($sa, $sb)) / $shorter >= .65;
}

function corpus_hit_source(array $item): array {
    return array_intersect_key($item, array_flip(['recording_id','platform','url','start_seconds','timestamp','timestamp_supported']));
}

function corpus_add_result(array &$results, array &$byInterview, array $item, bool $titleOnly, int $limit): bool {
    $gid = $item['interview_id'];
    foreach ($byInterview[$gid] ?? [] as $i) {
        $old = $results[$i];
        $sources = $old['matched_sources'] ?? [corpus_hit_source($old)];
        // Do not collapse two separate occurrences in the same recording.
        if (!$titleOnly && (in_array($item['recording_id'], array_column($sources, 'recording_id'), true)
            || !corpus_same_passage($old, $item))) continue;
        $sources[] = corpus_hit_source($item);
        if (corpus_source_rank($item) < corpus_source_rank($old)) $results[$i] = $item;
        if (!$titleOnly) $results[$i]['matched_sources'] = $sources;
        return true;
    }
    if (count($results) >= $limit) return false;
    $byInterview[$gid][] = count($results);
    $results[] = $item;
    return true;
}
