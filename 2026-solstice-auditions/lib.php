<?php
declare(strict_types=1);
require_once is_file(__DIR__ . '/server/lib.php') ? __DIR__ . '/server/lib.php' : __DIR__ . '/../cloud/lib.php';

function auditionCatalog(): array {
    $path = __DIR__ . '/catalog.json';
    return is_file($path) ? json_decode((string)file_get_contents($path), true, 64, JSON_THROW_ON_ERROR) : ['songs' => []];
}
function auditionSong(string $id): array {
    foreach (auditionCatalog()['songs'] as $song) if ($song['id'] === $id && !empty($song['ready'])) return $song;
    throw new MeleteHttpError(400, 'This song does not yet have a checked audition excerpt');
}
function auditionAdmin(array $claims, array $config): bool {
    $email = strtolower((string)($claims['email'] ?? ''));
    if (($claims['email_verified'] ?? false) !== true || !in_array($email, $config['admins'], true)) return false;
    // A verified third-party email alone is not authoritative Google ownership.
    // Such accounts need an explicitly approved Google subject ID in private config.
    $domain = substr(strrchr($email, '@') ?: '', 1);
    return $domain === 'gmail.com' || ($claims['hd'] ?? null) === $domain
        || ($config['admin_subjects'][$email] ?? null) === ($claims['sub'] ?? null);
}
function auditionPicture(mixed $value): ?string {
    if (!is_string($value) || strlen($value) > 2048) return null;
    $url = parse_url($value); $host = strtolower($url['host'] ?? '');
    return ($url['scheme'] ?? '') === 'https' && !isset($url['user']) && !isset($url['pass'])
        && ($host === 'googleusercontent.com' || str_ends_with($host, '.googleusercontent.com')) ? $value : null;
}
function auditionDb(string $directory): PDO {
    $db = new PDO('sqlite:' . $directory . '/auditions.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL');
    $db->exec('CREATE TABLE IF NOT EXISTS submissions (owner TEXT NOT NULL, song TEXT NOT NULL, revision INTEGER NOT NULL,
        name TEXT NOT NULL, email TEXT NOT NULL, updated INTEGER NOT NULL, metadata TEXT NOT NULL, audio BLOB NOT NULL,
        PRIMARY KEY(owner,song))');
    $db->exec('CREATE TABLE IF NOT EXISTS uploads (owner TEXT NOT NULL, hash TEXT NOT NULL, data BLOB NOT NULL,
        created INTEGER NOT NULL, PRIMARY KEY(owner,hash))');
    return $db;
}
function auditionRows(PDO $db, string $owner, bool $admin = false): array {
    $q = $db->prepare('SELECT owner,song,revision,name,email,updated,metadata FROM submissions' . ($admin ? '' : ' WHERE owner=?') . ' ORDER BY song,updated DESC');
    $q->execute($admin ? [] : [$owner]);
    return array_map(function ($row) {
        $row['revision'] = (int)$row['revision']; $row['updated'] = (int)$row['updated'];
        $row['metadata'] = json_decode($row['metadata'], true);
        // Load only the selected singer's contour, not every audition's frames.
        unset($row['metadata']['review']);
        return $row;
    }, $q->fetchAll(PDO::FETCH_ASSOC));
}
function auditionDetail(PDO $db, string $owner, bool $admin, string $requestedOwner, string $song, int $revision): array {
    if (!$admin && $owner !== $requestedOwner) throw new MeleteHttpError(404, 'Recording not found');
    $q = $db->prepare('SELECT revision,metadata FROM submissions WHERE owner=? AND song=?'); $q->execute([$requestedOwner,$song]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new MeleteHttpError(404, 'Recording not found');
    if ((int)$row['revision'] !== $revision) throw new MeleteHttpError(409, 'Submission changed; refresh Takes');
    return ['review' => json_decode($row['metadata'], true)['review'] ?? null];
}
function auditionReview(mixed $saved, array $song, array $wav, array $m): ?array {
    if ($saved === null) return null; // Older clients can still submit audio.
    $fail = fn() => throw new MeleteHttpError(400, 'Invalid saved pitch contour or timing');
    if (!is_array($saved) || !is_array($saved['reference'] ?? null) || !is_array($saved['pitches'] ?? null)) $fail();
    $ref = $saved['reference']; $timing = $ref['timing'] ?? [];
    $number = fn($n, $lo, $hi) => (is_int($n) || is_float($n)) && is_finite((float)$n) && $n >= $lo && $n <= $hi;
    if (strlen(json_encode($ref)) > 65536 || ($ref['version'] ?? null) !== 1 || ($ref['fingerprint'] ?? null) !== $song['version']
        || ($ref['rate'] ?? null) != $m['rate'] || !$number($ref['seconds'] ?? null, .1, 300)
        || abs($ref['seconds'] - $wav['seconds']) > 1.5 || !$number($ref['latency'] ?? null, 0, 1.999)
        || !$number($ref['leadInSeconds'] ?? null, 0, $ref['seconds']) || ($ref['part'] ?? null) !== 0
        || !$number($ref['start'] ?? null, 0, 10000000) || !$number($ref['end'] ?? null, 1, 10000000)
        || !is_array($ref['notes'] ?? null) || count($ref['notes']) > 1024
        || ($timing['kind'] ?? null) !== ($m['sourceMode'] ?? 'guide')
        || !$number($timing['origin'] ?? null, -300, 86400)
        || ($timing['pitchShift'] ?? null) !== ($m['transpose'] ?? $m['octave'])) $fail();
    $end = 0;
    foreach ($ref['notes'] as $note) {
        if (!is_array($note) || count($note) !== 3 || !$number($note[0] ?? null, max(0,$end-1e-7), $ref['seconds'])
            || !$number($note[1] ?? null, $note[0]+1e-9, $ref['seconds']+1e-6) || !is_array($note[2]) || count($note[2]) !== 1
            || !is_int($note[2][0]) || !$number($note[2][0],0,127)) $fail();
        $end = $note[1];
    }
    foreach (['anchors','beatAnchors'] as $key) {
        $a = $timing[$key] ?? null; if ($key === 'beatAnchors' && $a === null) continue;
        if (!is_array($a) || count($a) < 2 || count($a) > 4096) $fail();
        $last = [-1,-1];
        foreach ($a as $p) {
            if (!is_array($p) || count($p) !== 2 || !$number($p[0],0,10000000) || !$number($p[1],0,86400)
                || $p[0] <= $last[0] || $p[1] <= $last[1]) $fail();
            $last = $p;
        }
    }
    $beats = $timing['countInBeats'] ?? null;
    if (!is_array($beats) || count($beats) > 64) $fail();
    foreach ($beats as $beat) if (!$number($beat['seconds'] ?? null,-10,300) || !$number($beat['label'] ?? null,1,32)) $fail();
    if (isset($timing['loop']) && (!$number($timing['loop']['endTick'] ?? null,1,10000000)
        || !$number($timing['loop']['end'] ?? null,0,86400))) $fail();
    if (($saved['version'] ?? null) !== 1 || !is_int($saved['analysisVersion'] ?? null) || $saved['analysisVersion'] < 1
        || $saved['analysisVersion'] > 100 || count($saved['pitches']) !== (int)ceil($wav['frames']/round($wav['sampleRate']/100))) $fail();
    foreach ($saved['pitches'] as $p) if ($p !== null && !$number($p,-2400,20000)) $fail();
    return array_intersect_key($saved,array_flip(['reference','version','analysisVersion','pitches']));
}
function auditionWav(string $raw): array {
    $size = strlen($raw);
    if ($size < 46 || substr($raw, 0, 4) !== 'RIFF' || substr($raw, 8, 4) !== 'WAVE'
        || substr($raw, 12, 4) !== 'fmt ' || substr($raw, 36, 4) !== 'data') throw new MeleteHttpError(400, 'A continuous Melete WAV recording is required');
    $header = unpack('Vriff/a4wave/a4fmt/VfmtSize/vformat/vchannels/Vrate/VbyteRate/valign/vbits/a4data/Vbytes', substr($raw, 4, 40));
    if ($header['riff'] !== $size - 8 || $header['fmtSize'] !== 16 || $header['format'] !== 1 || $header['channels'] !== 1
        || $header['bits'] !== 16 || $header['align'] !== 2 || $header['rate'] < 8000 || $header['rate'] > 96000
        || $header['byteRate'] !== $header['rate'] * 2 || $header['bytes'] !== $size - 44 || ($size - 44) % 2 !== 0)
        throw new MeleteHttpError(400, 'Invalid recording format');
    return ['frames' => ($size - 44) / 2, 'sampleRate' => $header['rate'], 'seconds' => ($size - 44) / 2 / $header['rate']];
}
function auditionTiming(array $song): ?array {
    $alignments = json_decode((string)file_get_contents(__DIR__ . '/reference-alignment.json'), true, 64, JSON_THROW_ON_ERROR)['songs'];
    foreach ($alignments as $entry) if ($entry['id'] === $song['id'] && $entry['scoreVersion'] === $song['version']) return $entry;
    return null;
}
// Score ticks of one seamless loop pass, as MeleteRecordingTiming.loopRegion chooses them.
function auditionLoopTicks(array $song, ?array $timing): array {
    $sequence = json_decode((string)file_get_contents(__DIR__ . '/' . $song['playback']), true, 64, JSON_THROW_ON_ERROR);
    if (isset($timing['loop']['endTick'])) return [$timing['loop']['endTick'], $sequence['endTick']];
    $full = fn(array $m) => $m[2] * $sequence['division'] * 4 / $m[3];
    $first = $sequence['measures'][0];
    $last = $sequence['measures'][count($sequence['measures']) - 1];
    $pickup = $first[1] < $full($first) - 1e-7 ? $first[1] : 0;
    return [$sequence['endTick'] - max(0, $pickup - ($full($last) - $last[1])), $sequence['endTick']];
}
function auditionMetadata(array $body, array $song, array $wav): array {
    $m = $body['metadata'] ?? null;
    if (!is_array($m) || ($m['songVersion'] ?? null) !== $song['version'] || !in_array($m['octave'] ?? null, [-12,0,12], true)
        || !is_numeric($m['rate'] ?? null) || $m['rate'] < 0.5 || $m['rate'] > 2
        || ($m['continuous'] ?? null) !== true) throw new MeleteHttpError(400, 'The excerpt changed; record a new continuous take');
    $mode = $m['sourceMode'] ?? 'guide';
    if (!in_array($mode, ['guide', 'recording'], true)) throw new MeleteHttpError(400, 'Invalid playback source');
    $shift = $m['octave'];
    $transpose = $m['transpose'] ?? $shift;
    if (!is_int($transpose) || $transpose < -12 || $transpose > 12)
        throw new MeleteHttpError(400, 'Invalid transposition');
    $shift = $transpose;
    $loopPass = $m['loopPass'] ?? false;
    $seamless = $m['seamlessLoop'] ?? false;
    if (!is_bool($loopPass) || !is_bool($seamless)) throw new MeleteHttpError(400, 'Invalid loop pass');
    $duration = $song['duration'];
    if ($seamless) {
        [$loopTick, $endTick] = auditionLoopTicks($song, auditionTiming($song));
        $duration *= $loopTick / $endTick;
    }
    $expected = ($duration + ($loopPass ? 0 : ($song['countIn']['seconds'] ?? 4 * 60 / $song['tempo']))) / $m['rate'];
    $sourceHash = null;
    if ($mode === 'recording') {
        $path = __DIR__ . '/recording-clips.json';
        $entries = is_file($path) ? json_decode((string)file_get_contents($path), true, 64, JSON_THROW_ON_ERROR)['songs'] : [];
        $reference = null;
        foreach ($entries as $entry) if ($entry['id'] === $song['id'] && $entry['scoreVersion'] === $song['version']) $reference = $entry;
        if (!$reference || ($m['recordingSha256'] ?? null) !== $reference['originalSha256'])
            throw new MeleteHttpError(400, 'The reference recording changed; record a new take');
        $expected = $reference['takeSeconds'] / $m['rate'];
        if ($seamless) {
            if (!isset($reference['loop'])) throw new MeleteHttpError(400, 'The loop timing changed; record a new take');
            $expected = $reference['loop'][$loopPass ? 'passSeconds' : 'firstSeconds'] / $m['rate'];
        } elseif ($loopPass) {
            $alignments = json_decode((string)file_get_contents(__DIR__ . '/reference-alignment.json'), true, 64, JSON_THROW_ON_ERROR)['songs'];
            $timing = null;
            foreach ($alignments as $entry) if ($entry['id'] === $song['id'] && $entry['scoreVersion'] === $song['version']
                && $entry['originalSha256'] === $reference['originalSha256']) $timing = $entry;
            if (!$timing) throw new MeleteHttpError(400, 'The loop timing changed; record a new take');
            $anchors = $timing['anchors'];
            $expected = ($anchors[count($anchors) - 1][1] - $anchors[0][1]) / $m['rate'];
        }
        $shift = $transpose;
        $sourceHash = $reference['originalSha256'];
    }
    if ($wav['seconds'] < $expected - 0.15 || $wav['seconds'] > $expected + 1.5)
        throw new MeleteHttpError(400, 'The recording must include the complete excerpt and its initial count-in');
    $stats = $m['stats'] ?? [];
    foreach (['coverage', 'meanAbsCents', 'medianAbsCents', 'within50Percent'] as $key) {
        $v = $stats[$key] ?? null;
        if ($v !== null && (!is_numeric($v) || !is_finite((float)$v) || $v < 0 || $v > ($key === 'coverage' ? 1 : ($key === 'within50Percent' ? 100 : 12800))))
            throw new MeleteHttpError(400, 'Invalid pitch statistics');
        $stats[$key] = $v;
    }
    return ['songVersion' => $song['version'], 'octave' => $m['octave'], 'rate' => $m['rate'], 'continuous' => true,
        'sourceMode' => $mode, 'pitchShift' => $shift, 'transpose' => $transpose, 'recordingSha256' => $sourceHash, 'loopPass' => $loopPass, 'seamlessLoop' => $seamless,
        'stats' => array_intersect_key($stats, array_flip(['coverage','meanAbsCents','medianAbsCents','within50Percent'])),
        'seconds' => $wav['seconds'], 'sampleRate' => $wav['sampleRate'], 'metricsSource' => 'client-practice-feedback',
        'review' => auditionReview($m['review'] ?? null, $song, $wav, $m)];
}
function auditionCommit(PDO $db, string $owner, array $user, array $body, array $config): array {
    $song = auditionSong((string)($body['song'] ?? ''));
    $revision = $body['revision'] ?? null;
    if (!is_int($revision) || $revision < 0 || !is_array($body['chunks'] ?? null) || count($body['chunks']) > 32 || !$body['chunks'])
        throw new MeleteHttpError(400, 'Invalid submission');
    $db->exec('BEGIN IMMEDIATE');
    try {
        $q = $db->prepare('SELECT revision,length(audio) AS bytes FROM submissions WHERE owner=? AND song=?'); $q->execute([$owner, $song['id']]);
        $old = $q->fetch(PDO::FETCH_ASSOC);
        if ((int)($old['revision'] ?? 0) !== $revision) throw new MeleteHttpError(409, 'This submission changed in another tab; reload before replacing it');
        $raw = '';
        $q = $db->prepare('SELECT data FROM uploads WHERE owner=? AND hash=?');
        foreach ($body['chunks'] as $hash) {
            $q->execute([$owner, meleteId($hash)]); $chunk = $q->fetchColumn();
            if ($chunk === false) throw new MeleteHttpError(400, 'Recording upload is incomplete; your previous submission was kept');
            $raw .= $chunk;
        }
        $metadata = auditionMetadata($body, $song, auditionWav($raw));
        $metadata['picture'] = auditionPicture($user['picture'] ?? null);
        $q = $db->prepare('SELECT COALESCE(SUM(length(audio)),0) FROM submissions WHERE owner=? AND song!=?'); $q->execute([$owner,$song['id']]);
        if ((int)$q->fetchColumn() + strlen($raw) > ($config['audition_user_bytes'] ?? 134217728)) throw new MeleteHttpError(413, 'Your audition storage limit is reached');
        $total = (int)$db->query('SELECT COALESCE(SUM(length(audio)),0) FROM submissions')->fetchColumn();
        if ($total - (int)($old['bytes'] ?? 0) + strlen($raw) > ($config['audition_total_bytes'] ?? 2147483648)) throw new MeleteHttpError(507, 'Audition storage is full; please keep your local take');
        $q = $db->prepare('INSERT OR REPLACE INTO submissions VALUES (?,?,?,?,?,?,?,?)');
        $values = [$owner,$song['id'],$revision+1,$user['name'],$user['email'],time(),json_encode($metadata, JSON_THROW_ON_ERROR),$raw];
        foreach ($values as $i => $value) $q->bindValue($i+1, $value, $i === 7 ? PDO::PARAM_LOB : (is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR));
        $q->execute();
        $db->exec('COMMIT');
        return ['revision' => $revision+1, 'song' => $song['id']];
    } catch (Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
}
function auditionAudio(PDO $db, string $owner, bool $admin, string $requestedOwner, string $song, ?int $revision = null): never {
    if (!$admin && $owner !== $requestedOwner) throw new MeleteHttpError(404, 'Recording not found');
    $q = $db->prepare('SELECT audio,revision FROM submissions WHERE owner=? AND song=?'); $q->execute([$requestedOwner,$song]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new MeleteHttpError(404, 'Recording not found');
    if ($revision !== null && $revision !== (int)$row['revision']) throw new MeleteHttpError(409, 'Submission changed; refresh Takes');
    $raw = $row['audio'];
    $length = strlen($raw); $start = 0; $end = $length - 1;
    if (isset($_SERVER['HTTP_RANGE'])) {
        if (!preg_match('/^bytes=(\d+)-(\d*)$/D', $_SERVER['HTTP_RANGE'], $m)) throw new MeleteHttpError(416, 'Invalid audio range');
        $start = (int)$m[1]; $end = $m[2] === '' ? $end : min($end, (int)$m[2]);
        if ($start > $end || $start >= $length) throw new MeleteHttpError(416, 'Invalid audio range');
        http_response_code(206); header("Content-Range: bytes $start-$end/$length");
    }
    header('Content-Type: audio/wav'); header('Accept-Ranges: bytes');
    header('Content-Disposition: inline; filename="audition.wav"'); header('Content-Length: '.($end-$start+1));
    echo substr($raw, $start, $end-$start+1); exit;
}
