<?php
declare(strict_types=1);

// A read-only publication artifact, outside the public webroot in production.
function corpus_db(): PDO {
    $path = getenv('TRANSCRIPTS_DB');
    if (!$path) {
        $path = dirname(__DIR__, 2) . '/transcript-data/current.sqlite3';
    }
    if (!is_file($path)) throw new RuntimeException('The transcript index is not available.');
    $flags = class_exists('Pdo\\Sqlite') ? Pdo\Sqlite::ATTR_OPEN_FLAGS : PDO::SQLITE_ATTR_OPEN_FLAGS;
    $readOnly = class_exists('Pdo\\Sqlite') ? Pdo\Sqlite::OPEN_READONLY : PDO::SQLITE_OPEN_READONLY;
    $db = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        $flags => $readOnly,
    ]);
    $db->exec('PRAGMA query_only=ON');
    $db->exec('PRAGMA busy_timeout=3000');
    return $db;
}

function corpus_fold(string $s): string {
    if (class_exists('Normalizer')) $s = Normalizer::normalize($s, Normalizer::FORM_KD) ?: $s;
    $s = preg_replace('/\p{M}/u', '', $s) ?? $s;
    return str_replace('’', "'", mb_strtolower($s, 'UTF-8'));
}

function corpus_terms(string $q): array {
    if (mb_strlen($q, 'UTF-8') > 300) throw new InvalidArgumentException('Use a search phrase of at most 300 characters.');
    $parts = preg_split('/\s+OR\s+|\|/iu', trim($q)) ?: [];
    $terms = array_values(array_filter(array_map(static fn($s) => trim(trim($s), '"'), $parts)));
    if (count($terms) > 8) throw new InvalidArgumentException('Use at most eight phrases joined by OR.');
    return $terms;
}

function corpus_match(array $terms): string {
    $out = [];
    foreach ($terms as $term) {
        preg_match_all('/[\p{L}\p{N}_]+/u', $term, $m);
        if ($m[0]) $out[] = 'text : "' . implode(' ', $m[0]) . '"';
    }
    return implode(' OR ', $out);
}

function corpus_occurrences(string $text, array $terms): array {
    // PCRE byte offsets are converted before looking up character-based anchors.
    $patterns = [];
    foreach ($terms as $term) {
        $p = preg_quote($term, '~');
        $p = preg_replace('/\s+/u', '\\s+', $p) ?? $p;
        $p = preg_replace("/['’]/u", "['’]", $p) ?? $p;
        $patterns[] = $p;
    }
    if (!$patterns) return [];
    preg_match_all('~(?:' . implode('|', $patterns) . ')~iu', $text, $matches, PREG_OFFSET_CAPTURE);
    $out = [];
    foreach (array_slice($matches[0] ?? [], 0, 1000) as [$match, $byte]) {
        $out[] = [mb_strlen(substr($text, 0, $byte), 'UTF-8'), mb_strlen($match, 'UTF-8')];
    }
    return $out;
}

function corpus_time(array $anchors, int $char): float {
    $lo = 0; $hi = count($anchors) - 1; $seconds = 0.;
    while ($lo <= $hi) {
        $mid = intdiv($lo + $hi, 2);
        if ($anchors[$mid][0] <= $char) { $seconds = (float)$anchors[$mid][1]; $lo = $mid + 1; }
        else $hi = $mid - 1;
    }
    return max(0., $seconds);
}

function corpus_url(string $url, string $platform, float $time): string {
    $seconds = (int)floor(max(0, $time));
    $parts = parse_url($url);
    if (!$parts || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)) return '';
    $base = $parts['scheme'] . '://' . $parts['host'] . ($parts['path'] ?? '');
    parse_str($parts['query'] ?? '', $q);
    if ($platform === 'youtube') $q['t'] = $seconds . 's';
    elseif ($platform === 'rumble') $q['start'] = (string)$seconds;
    elseif ($platform === 'odysee') $q['t'] = (string)$seconds;
    elseif ($platform === 'substack') $q['timestamp'] = (string)$seconds;
    elseif ($platform === 'twitch') $q['t'] = sprintf('%dh%dm%ds', intdiv($seconds,3600), intdiv($seconds%3600,60), $seconds%60);
    $base .= $q ? '?' . http_build_query($q) : '';
    if (in_array($platform, ['vimeo', 'podcast', 'website', 'bandcamp'], true)) $base .= '#t=' . $seconds;
    return $base;
}

function corpus_timestamp(float $time): string {
    $s = (int)floor(max(0, $time));
    return $s >= 3600 ? sprintf('%d:%02d:%02d', intdiv($s,3600), intdiv($s%3600,60), $s%60)
                      : sprintf('%d:%02d', intdiv($s,60), $s%60);
}

function corpus_payload(array $row, float $seconds = 0, array $parts = [], int $matches = 0): array {
    return [
        'youtube_id' => $row['key'], // stable namespaced ID; UI history compatibility
        'recording_id' => $row['key'], 'collection' => $row['corpus'],
        'channel' => $row['channel'], 'source_channel' => $row['source_channel'],
        'platform' => $row['platform'], 'title' => $row['title'],
        'start_seconds' => $seconds, 'timestamp' => corpus_timestamp($seconds),
        'url' => corpus_url($row['url'], $row['platform'], $seconds),
        'timestamp_supported' => in_array($row['platform'], ['youtube','odysee','rumble','substack','vimeo','twitch'], true),
        'snippet' => implode('', array_column($parts, 'text')), 'snippet_parts' => $parts,
        'match_count' => $matches, 'transcript_origin' => $row['transcript_origin'],
    ];
}

function corpus_search(PDO $db, string $q, string $title, array $channels, string $corpus, string $id, int $limit, array $categories = []): array {
    $started = microtime(true);
    $limit = max(1, min(200, $limit));
    $terms = corpus_terms($q);
    $match = corpus_match($terms);
    $where = []; $params = [];
    if ($q !== '' && $match === '') throw new InvalidArgumentException('Search for at least one word.');
    if (mb_strlen($title) > 300) throw new InvalidArgumentException('Use a shorter title filter.');
    $from = 'records r';
    if ($match !== '') {
        $from = 'records_fts f JOIN records r ON r.id=f.rowid';
        $where[] = 'records_fts MATCH :q'; $params[':q'] = $match;
    }
    if ($title !== '') {
        $where[] = "r.title_fold LIKE :title ESCAPE '\\'";
        $params[':title'] = '%' . strtr(corpus_fold($title), ['\\'=>'\\\\','%'=>'\\%','_'=>'\\_']) . '%';
    }
    $scope = [];
    if ($channels) {
        $keys = [];
        foreach (array_slice(array_unique($channels), 0, 1200) as $i => $channel) {
            $key = ':ch' . $i; $keys[] = $key; $params[$key] = (string)$channel;
        }
        $scope[] = 'r.channel IN (' . implode(',', $keys) . ')';
    }
    if ($categories) {
        $keys = [];
        foreach (array_slice(array_unique($categories), 0, 30) as $i => $category) {
            $key = ':cat' . $i; $keys[] = $key; $params[$key] = (string)$category;
        }
        $scope[] = 'r.channel IN (SELECT channel FROM channels WHERE category IN (' . implode(',', $keys) . '))';
    }
    if ($scope) $where[] = '(' . implode(' OR ', $scope) . ')';
    if ($corpus !== '') { $where[] = 'r.corpus=:corpus'; $params[':corpus'] = $corpus; }
    if ($id !== '') { $where[] = 'r.key=:id'; $params[':id'] = $id; }
    if (!$where) return ['results'=>[], 'timing'=>['total_ms'=>0], 'truncated'=>false];
    $order = $match !== '' ? 'rank' : 'r.title_fold';
    // Filtered title-only searches may browse the index without loading transcript text.
    $columns = $match !== '' ? 'r.*' : 'r.key,r.corpus,r.channel,r.source_channel,r.platform,r.title,r.url,r.transcript_origin';
    $sql = 'SELECT ' . $columns . ' FROM ' . $from . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY ' . $order . ' LIMIT 301';
    $stmt = $db->prepare($sql); $stmt->execute($params);
    $results = []; $candidates = 0; $truncated = false;
    while ($row = $stmt->fetch()) {
        $candidates++;
        if ($candidates > 300 || count($results) >= $limit) { $truncated = true; break; }
        if (!$terms) { $results[] = corpus_payload($row); continue; }
        $occurrences = corpus_occurrences($row['text'], $terms);
        if (!$occurrences) continue;
        $decoded = gzuncompress($row['anchors']);
        $anchors = $decoded === false ? null : json_decode($decoded, true);
        if (!is_array($anchors)) throw new RuntimeException('Invalid timestamp index.');
        $groups = [];
        foreach ($occurrences as $hit) {
            $last = count($groups) - 1;
            $prev = $last >= 0 ? end($groups[$last]) : null;
            if ($prev === null || $hit[0] - ($prev[0] + $prev[1]) > 120) $groups[] = [$hit];
            else $groups[$last][] = $hit;
        }
        foreach ($groups as $group) {
            if (count($results) >= $limit) { $truncated = true; break; }
            $start = max(0, $group[0][0] - 120); $last = end($group);
            $end = min(mb_strlen($row['text'], 'UTF-8'), $last[0] + $last[1] + 120);
            $parts = $start > 0 ? [['text'=>'…', 'match'=>false]] : [];
            $cursor = $start;
            foreach ($group as [$at, $length]) {
                if ($at > $cursor) $parts[] = ['text'=>mb_substr($row['text'],$cursor,$at-$cursor,'UTF-8'), 'match'=>false];
                $parts[] = ['text'=>mb_substr($row['text'],$at,$length,'UTF-8'), 'match'=>true];
                $cursor = $at + $length;
            }
            $parts[] = ['text'=>mb_substr($row['text'],$cursor,$end-$cursor,'UTF-8') . ($end < mb_strlen($row['text'],'UTF-8') ? '…' : ''), 'match'=>false];
            $results[] = corpus_payload($row, corpus_time($anchors, $group[0][0]), $parts, count($group));
        }
    }
    return ['results'=>$results, 'timing'=>['total_ms'=>round((microtime(true)-$started)*1000,1), 'candidate_videos'=>$candidates], 'truncated'=>$truncated];
}
