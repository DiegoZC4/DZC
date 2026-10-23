<?php
declare(strict_types=1);

// Reusable reporting; the browser dashboard never receives legacy addresses.
function audioUsageReport(bool $includeAddresses = false): array {
    $docroot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
    $root = $docroot === '' ? '' : dirname($docroot) . '/sequences-audio-stats';
    $weeksDir = $root . '/weeks';
    $weeks = [];
    if (is_dir($weeksDir)) {
        foreach (scandir($weeksDir) ?: [] as $name) {
            if (!preg_match('/^(\d{4}-W\d{2})__(lsrg-\d+|none)\.(page|play)$/D', $name, $m)) continue;
            [$_, $week, $reading, $kind] = $m;
            $ips = []; $devices = 0;
            foreach (file($weeksDir . '/' . $name, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                $ip = explode("\t", $line, 2)[0];
                if ($ip !== '') { $ips[$ip] = true; $devices++; }
            }
            ksort($ips);
            $key = $kind === 'page' ? 'visitors' : 'listeners';
            $entry = ['unique_ips' => count($ips), 'unique_devices' => $devices];
            if ($includeAddresses) $entry['ips'] = array_keys($ips);
            $weeks[$week][$reading][$key] = $entry;
            $weeks[$week]['all_readings']['ips_' . $key] = array_merge(
                $weeks[$week]['all_readings']['ips_' . $key] ?? [], array_keys($ips));
        }
    }
    ksort($weeks);
    foreach ($weeks as &$entry) {
        foreach (['visitors', 'listeners'] as $kind) {
            $entry['all_readings'][$kind . '_unique_ips'] = count(array_unique($entry['all_readings']['ips_' . $kind] ?? []));
            unset($entry['all_readings']['ips_' . $kind]);
        }
    }
    unset($entry);
    try { require_once __DIR__ . '/sequences-audio-metrics.php'; $metrics = audioMetricsReport(); }
    catch (Throwable $error) { $metrics = ['error' => 'Metrics storage unavailable']; }
    return ['format' => 3, 'metrics' => $metrics, 'generated' => gmdate('c'), 'this_week' => gmdate('o-\WW'),
        'weeks' => (object) $weeks, 'storage' => ['exists' => $root !== '' && is_dir($root),
            'writable' => $root !== '' && is_dir($root) && is_writable($root)]];
}

function audioDashboardEpisodes(string $path): array {
    if (!is_file($path)) return [];
    $xml = simplexml_load_string(file_get_contents($path), SimpleXMLElement::class, LIBXML_NONET);
    if (!$xml) return [];
    $episodes = [];
    foreach ($xml->channel->item as $item) {
        $id = parse_url((string)$item->link, PHP_URL_FRAGMENT);
        if (is_string($id) && preg_match('/^lsrg-\d+$/D', $id)) $episodes[$id] = (string)$item->title;
    }
    return $episodes;
}

function audioDashboardWeekStart(string $week): string {
    if (!preg_match('/^(\d{4})-W(\d{2})$/D', $week, $m)) throw new InvalidArgumentException('Invalid week');
    $date = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->setISODate((int)$m[1], (int)$m[2], 1);
    if ($date->format('o-\WW') !== $week) throw new InvalidArgumentException('Invalid week');
    return $date->format('Y-m-d');
}

function audioDashboardTotals(array $rows): array {
    $out = ['page' => 0, 'play' => 0, 'listen' => 0, 'podcast' => 0, 'podcast-requests' => 0,
        'mediaerror' => 0, 'retry' => 0, 'buffer' => 0, 'buffer_ms' => 0, 'startup' => 0, 'startup_ms' => 0,
        'offline-error' => 0, 'annotation-save' => 0, 'annotation-save-error' => 0];
    foreach ($rows as $row) {
        $event = $row['event']; $n = (int)$row['count'];
        if (array_key_exists($event, $out)) $out[$event] += $event === 'listen' ? (float)$row['total'] : $n;
        if ($event === 'buffer' || $event === 'startup') $out[$event . '_ms'] += (float)$row['total'];
        $action = $event . '-' . $row['action'];
        if (array_key_exists($action, $out)) $out[$action] += $n;
    }
    return $out;
}

function audioDashboardData(array $report, array $episodes, string $selected): array {
    $metrics = $report['metrics'] ?? []; $rows = $metrics['daily'] ?? []; $byWeek = [];
    foreach ($rows as $row) {
        $iso = (new DateTimeImmutable($row['day'], new DateTimeZone('UTC')))->format('o-\WW');
        $byWeek[$iso][] = $row;
    }
    // Zero-activity weeks only since collection began, never invented history.
    $started = !empty($metrics['started']) ? new DateTimeImmutable($metrics['started']) : null;
    if ($started && !isset($metrics['error'])) {
        $first = audioDashboardWeekStart($started->setTimezone(new DateTimeZone('UTC'))->format('o-\WW'));
        $last = audioDashboardWeekStart($report['this_week']);
        for ($date = new DateTimeImmutable($first, new DateTimeZone('UTC')); $date->format('Y-m-d') <= $last; $date = $date->modify('+1 week')) {
            $byWeek[$date->format('o-\WW')] ??= [];
        }
    }
    krsort($byWeek);
    if ($selected !== 'all' && !isset($byWeek[$selected])) $selected = array_key_first($byWeek) ?? 'all';
    $selectedRows = $selected === 'all' ? $rows : ($byWeek[$selected] ?? []);
    $weekly = [];
    foreach ($byWeek as $iso => $values) $weekly[$iso] = audioDashboardTotals($values);
    $episodeRows = []; $errors = []; $clients = []; $actions = []; $latency = [];
    $errorNames = ['0' => 'Unknown media error', '1' => 'Playback aborted', '2' => 'Network error', '3' => 'Decode error', '4' => 'Unsupported source'];
    foreach ($selectedRows as $r) {
        $episodeRows[$r['week']][] = $r;
        $n = (int)$r['count']; $e = $r['event']; $action = $r['action'];
        if ($e === 'mediaerror' || ($e === 'offline' && $action === 'error') || ($e === 'annotation' && $action === 'save-error')) {
            $reason = $e === 'mediaerror' ? ($errorNames[$r['bucket']] ?? 'Unknown media error') : ($e === 'offline' ? 'Offline download failed' : 'Note save failed');
            $key = json_encode([$r['week'], $reason, $r['client'], $r['device'], $r['network']]);
            $errors[$key] ??= ['episode' => $r['week'], 'reason' => $reason, 'client' => $r['client'],
                'device' => $r['device'], 'network' => $r['network'], 'count' => 0, 'last_day' => $r['day']];
            $errors[$key]['count'] += $n; $errors[$key]['last_day'] = max($errors[$key]['last_day'], $r['day']);
        }
        if ($e === 'podcast') $clients[$r['client']] = ($clients[$r['client']] ?? 0) + $n;
        if (in_array($e, ['annotation', 'offline', 'subscribe', 'search', 'wordseek', 'timelineseek', 'reader', 'retry'], true)) {
            $label = $e . ($action !== '' ? ' / ' . $action : ''); $actions[$label] = ($actions[$label] ?? 0) + $n;
        }
        if ($e === 'startup' || $e === 'buffer') $latency[$r['bucket']][$e] = ($latency[$r['bucket']][$e] ?? 0) + $n;
    }
    $perEpisode = [];
    foreach ($episodeRows as $id => $values) {
        $totals = audioDashboardTotals($values);
        // Meaningful for one calendar week; never sum uniques across weeks.
        $totals['devices'] = $selected === 'all' ? null : array_sum(array_map(
            fn($r) => $r['event'] === 'unique-page' ? (int)$r['count'] : 0, $values));
        $perEpisode[$id] = $totals;
    }
    uksort($perEpisode, fn($a, $b) => strnatcmp($b, $a));
    usort($errors, fn($a, $b) => $b['count'] <=> $a['count']); arsort($clients); arsort($actions);
    $legacy = [];
    foreach ((array)($report['weeks'] ?? []) as $iso => $week) {
        $legacy[$iso] = ['visitors' => (int)($week['all_readings']['visitors_unique_ips'] ?? 0),
            'listeners' => (int)($week['all_readings']['listeners_unique_ips'] ?? 0)];
    }
    krsort($legacy);
    return ['selected' => $selected, 'weekly' => $weekly, 'totals' => audioDashboardTotals($selectedRows),
        'episodes' => $perEpisode, 'titles' => $episodes, 'errors' => $errors, 'clients' => $clients, 'actions' => $actions,
        'latency' => $latency, 'legacy' => $legacy, 'started' => $metrics['started'] ?? null,
        'unavailable' => isset($metrics['error']), 'generated' => $report['generated'], 'current_week' => $report['this_week']];
}
