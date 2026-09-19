<?php
declare(strict_types=1);
require_once __DIR__ . '/chords.php';

function chordus_require(bool $condition, string $message, int $code = 400): void {
    if (!$condition) throw new RuntimeException($message, $code);
}
function chordus_data_dir(): string {
    $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? __DIR__);
    chordus_require($root !== false, 'Storage is unavailable.', 503);
    $directory = getenv('CHORDUS_DATA_DIR') ?: dirname($root) . '/.chordus-private';
    umask(0077);
    if (!is_dir($directory)) chordus_require(mkdir($directory, 0700, true), 'Storage is unavailable.', 503);
    $path = realpath($directory);
    chordus_require($path !== false && $path !== $root && !str_starts_with($path . '/', $root . '/'), 'Private storage must be outside the website.', 503);
    return $path;
}
// One definition of the schema, so a test database cannot drift away from the
// real one and pass against tables the server does not actually have.
function chordus_schema(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS score (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS cue (id INTEGER PRIMARY KEY CHECK(id=1), serial INTEGER NOT NULL, score_revision INTEGER NOT NULL, body TEXT NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
    // Exactly one device conducts at a time. The lease never expires: anyone may
    // take it whenever they like, and an expiry would only add a second way to
    // lose control unexpectedly.
    $db->exec('CREATE TABLE IF NOT EXISTS reins (id INTEGER PRIMARY KEY CHECK(id=1), holder TEXT NOT NULL, label TEXT NOT NULL, since INTEGER NOT NULL, seen INTEGER NOT NULL, prior TEXT NOT NULL DEFAULT \'\', prior_label TEXT NOT NULL DEFAULT \'\')');
    // A session already running when this shipped has the row but not the two
    // columns, and CREATE TABLE IF NOT EXISTS will not add them. Dropping the
    // row instead would evict whoever is conducting right now.
    $columns = array_column($db->query('PRAGMA table_info(reins)')->fetchAll(PDO::FETCH_ASSOC), 'name');
    foreach (['prior', 'prior_label'] as $column) {
        if (!in_array($column, $columns, true)) $db->exec('ALTER TABLE reins ADD COLUMN ' . $column . ' TEXT NOT NULL DEFAULT \'\'');
    }
    // What the choir actually saw, and who put it there. Only published state is
    // recorded: an arrangement being polished before Krimpatul never reaches the
    // Sing tab, so it is nobody's business but its author's. Cues are left out
    // too — pointing is transient and would swamp the table.
    $db->exec('CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, client TEXT NOT NULL, label TEXT NOT NULL, revision INTEGER, summary TEXT NOT NULL, changes TEXT, body TEXT)');
    $db->exec('CREATE INDEX IF NOT EXISTS history_at ON history(at)');
    // One row is one device saying yes to one song. Nothing here is ever tallied
    // or closed: a vote simply stops counting once it is old, so a round of
    // voting ends by itself and nobody has to clear it before the next.
    $db->exec('CREATE TABLE IF NOT EXISTS votes (song TEXT NOT NULL, voter TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(song, voter))');
}
function chordus_database(string $directory): PDO {
    $db = new PDO('sqlite:' . $directory . '/rehearsal.sqlite3', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout = 4000');
    $db->exec('PRAGMA journal_mode = WAL');
    chordus_schema($db);
    return $db;
}
function chordus_pcs(string $symbol, int $key): array {
    return chordus_chord_spec($symbol,$key)['pcs'];
}
function chordus_meter_length(mixed $meter): int {
    chordus_require(in_array($meter, ['2/4','3/4','4/4','5/4','6/8','7/8','9/8','12/8'], true), 'Invalid time signature.');
    [$count,$unit]=array_map('intval',explode('/',$meter));return (int)($count*16/$unit);
}
function chordus_rhythm(mixed $pattern, string $meter): array {
    $length=chordus_meter_length($meter);
    chordus_require(is_string($pattern) && strlen($pattern)<=180,'Invalid rhythm.');
    $text=strtolower(trim($pattern)) ?: 'bar';
    if($text==='bar'){
        $events=[];$start=0;$left=$length;
        while($left){foreach([[1,1],[1,0],[2,1],[2,0],[4,1],[4,0],[8,1],[8,0],[16,0]] as [$denom,$dot]){
            $duration=(int)(16/$denom*($dot?1.5:1));if($duration>$left)continue;
            $left-=$duration;$events[]=['rest'=>false,'tie'=>$left>0,'start'=>$start,'duration'=>$duration];$start+=$duration;break;
        }}return $events;
    }
    $tokens=preg_split('/\s+/',$text);chordus_require(count($tokens)<=32,'Too many rhythm events.');
    $events=[];$start=0;
    foreach($tokens as $token){
        chordus_require(preg_match('/^(r?)(1|2|4|8|16)(\.?)(~?)$/D',$token,$m)===1,'Invalid rhythm token.');
        $duration=16/(int)$m[2]*($m[3]?1.5:1);$rest=$m[1]!=='';$tie=$m[4]!=='';
        chordus_require(floor($duration)==$duration && !($rest&&$tie),'Invalid rhythm subdivision or rest tie.');
        $events[]=['rest'=>$rest,'tie'=>$tie,'start'=>$start,'duration'=>(int)$duration];$start+=(int)$duration;
    }
    chordus_require($start===$length,'Rhythm must fill the measure.');
    foreach($events as $i=>$event)if($event['tie'])chordus_require(isset($events[$i+1])&&!$events[$i+1]['rest'],'A tie needs another note in this measure.');
    return $events;
}
function chordus_imported_song(mixed $value,int $chordCount): array {
    $length=static fn(string $s): int => intdiv(strlen(iconv('UTF-8','UTF-16LE',$s)),2);
    $text=static function(mixed $s,int $max) use($length): string {
        chordus_require(is_string($s)&&$length($s)<=$max&&!preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/',$s),'Invalid imported song text.');return $s;
    };
    chordus_require(is_array($value)&&($value['version']??null)===1&&is_array($value['blocks']??null)&&array_is_list($value['blocks'])&&count($value['blocks'])<=256&&is_array($value['warnings']??null)&&array_is_list($value['warnings'])&&count($value['warnings'])<=16,'Invalid imported song.');
    $blocks=[];$characters=0;$lineCount=0;$markCount=0;
    foreach($value['blocks'] as $block){
        chordus_require(is_array($block)&&is_array($block['lines']??null)&&array_is_list($block['lines']),'Invalid imported stanza.');
        $label=$text($block['label']??null,160);$lines=[];
        foreach($block['lines'] as $line){
            chordus_require(is_array($line)&&is_array($line['marks']??null)&&array_is_list($line['marks']),'Invalid imported lyric line.');
            $body=$text($line['text']??null,4096);$size=$length($body);$characters+=$size;$lineCount++;$marks=[];$previous=-1;
            foreach($line['marks'] as $mark){
                chordus_require(is_array($mark),'Invalid lyric chord anchor.');
                $at=$mark['at']??null;$measure=$mark['measure']??null;$pass=$mark['pass']??null;
                chordus_require(is_int($at)&&$at>=$previous&&$at>=0&&$at<=$size&&is_int($measure)&&$measure>=0&&$measure<$chordCount&&is_int($pass)&&$pass>=1&&$pass<=999,'Invalid lyric chord anchor.');
                $previous=$at;$markCount++;$marks[]=['at'=>$at,'measure'=>$measure,'pass'=>$pass];
            }
            $lines[]=['text'=>$body,'marks'=>$marks];
        }
        $blocks[]=['label'=>$label,'lines'=>$lines];
    }
    chordus_require($characters<=131072&&$lineCount<=2048&&$markCount<=2048,'Imported song is too large.');
    return ['version'=>1,'title'=>$text($value['title']??null,160),'artist'=>$text($value['artist']??null,160),'notice'=>$text($value['notice']??null,512),'warnings'=>array_map(static fn($s)=>$text($s,512),$value['warnings']),'blocks'=>$blocks];
}
function chordus_validate_score(mixed $score): array {
    chordus_require(is_array($score) && ($score['version'] ?? null) === 1, 'Invalid score.');
    $key = $score['key'] ?? null;
    chordus_require(is_int($key) && $key >= 0 && $key < 12, 'Invalid key.');
    $meter=$score['meter']??'4/4';chordus_meter_length($meter);
    $text = $score['progression'] ?? null;
    chordus_require(is_string($text) && strlen($text) <= 4096, 'Invalid progression.');
    $tokens = preg_split('/[\s,|–—]+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY);
    chordus_require(count($tokens) > 0 && count($tokens) <= 48, 'Use one to 48 chords.');
    $entries = $score['chords'] ?? null;
    chordus_require(is_array($entries) && array_is_list($entries) && count($entries) === count($tokens), 'Score and progression differ.');
    $clean = [];
    foreach ($entries as $index => $entry) {
        chordus_require(is_array($entry) && ($entry['symbol'] ?? null) === $tokens[$index], 'Invalid chord.');
        $pcs = chordus_pcs($tokens[$index], $key); $notes = $entry['notes'] ?? null;
        chordus_require(is_array($notes) && array_is_list($notes) && count($notes) === 4, 'Each chord needs four pitches.');
        // Matches cleanRehearsalScore in rehearsal.mjs: a hand-arranged voicing may
        // share a pitch between voices or leave a chord tone out, and the parts
        // read top to bottom. Crossed voices are restacked rather than refused —
        // a score stored before that rule must still be readable, or every poll
        // that touches it fails instead of the one edit that caused it.
        foreach ($notes as $note) chordus_require(is_int($note) && $note >= 36 && $note <= 84 && in_array($note % 12, $pcs, true), 'Every pitch must be a chord tone in singable range.');
        rsort($notes);
        // The bass never goes below low D. Checked after restacking, so it is the
        // bottom voice that is measured however the four pitches arrived.
        chordus_require($notes[3] >= 38, 'The bass never goes below low D.');
        $rhythms=$entry['rhythms']??['bar','bar','bar','bar'];
        chordus_require(is_array($rhythms)&&array_is_list($rhythms)&&count($rhythms)===4,'Four rhythms required.');
        foreach($rhythms as &$pattern){chordus_rhythm($pattern,$meter);$pattern=preg_replace('/\s+/',' ',strtolower(trim($pattern))) ?: 'bar';}unset($pattern);
        $section=$entry['section']??'';
        chordus_require(is_string($section)&&($section===''||preg_match('/^[A-Z0-9][A-Z0-9 .-]{0,7}$/D',$section)===1),'Invalid section label.');
        foreach(['repeatStart','repeatEnd'] as $flag)chordus_require(!array_key_exists($flag,$entry)||is_bool($entry[$flag]),'Invalid repeat sign.');
        chordus_require(!array_key_exists('systemBreak',$entry)||is_bool($entry['systemBreak']),'Invalid system break.');
        if(array_key_exists('repeatTimes',$entry))chordus_require(is_int($entry['repeatTimes'])&&$entry['repeatTimes']>=2&&$entry['repeatTimes']<=999,'Invalid repeat count.');
        $lyrics=array_key_exists('lyrics',$entry)?$entry['lyrics']:'';chordus_require(is_string($lyrics),'Lyrics must be text.');
        $lyrics=str_replace(["\r\n","\r","\t"],["\n","\n"," "],$lyrics);
        chordus_require(preg_match_all('/./us',$lyrics)<=512&&substr_count($lyrics,"\n")<8&&!preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/',$lyrics),'Use up to 512 characters and eight lines per chord.');
        $clean[] = ['symbol' => $tokens[$index], 'notes' => $notes, 'edited' => ($entry['edited'] ?? false) === true, 'rhythms'=>$rhythms,'section'=>$section,'repeatStart'=>($entry['repeatStart']??false)===true,'repeatEnd'=>($entry['repeatEnd']??false)===true,'systemBreak'=>($entry['systemBreak']??false)===true];
        if(($entry['repeatEnd']??false)&&array_key_exists('repeatTimes',$entry))$clean[array_key_last($clean)]['repeatTimes']=$entry['repeatTimes'];
        $clean[array_key_last($clean)]['lyrics']=$lyrics;
    }
    $dynamics=array_key_exists('dynamics',$score)?$score['dynamics']:[];
    chordus_require(is_array($dynamics)&&array_is_list($dynamics)&&count($dynamics)<=1152,'Invalid dynamics envelope.');
    $points=[];$seen=[];$onsets=[];
    foreach($dynamics as $point){
        chordus_require(is_array($point),'Invalid dynamics point.');
        $measure=$point['measure']??null;$offset=$point['offset']??null;$level=$point['level']??null;
        chordus_require(is_int($measure)&&$measure>=0&&isset($clean[$measure]),'Dynamics need an existing measure.');
        if(!isset($onsets[$measure])){
            $onsets[$measure]=[];foreach($clean[$measure]['rhythms'] as $pattern)foreach(chordus_rhythm($pattern,$meter) as $event)if(!$event['rest'])$onsets[$measure][$event['start']]=true;
        }
        chordus_require(is_int($offset)&&isset($onsets[$measure][$offset]),'Place dynamics on a note onset.');
        chordus_require(is_int($level)&&$level>=0&&$level<=100,'Dynamics range from pp to ff.');
        $id=$measure.':'.$offset;chordus_require(!isset($seen[$id]),'Only one dynamics point at each onset.');$seen[$id]=true;
        $points[]=['measure'=>$measure,'offset'=>$offset,'level'=>$level];
    }
    usort($points,static fn($a,$b)=>($a['measure']<=>$b['measure'])?:($a['offset']<=>$b['offset']));
    // Matches cleanRehearsalDisplay in rehearsal.mjs: what the choir reads above
    // each measure. A score stored before the setting existed read numerals and
    // chord names, so that stays the answer when it is missing.
    $display=is_array($score['display']??null)?$score['display']:[];
    $rows=['hand'=>($display['hand']??false)===true,'roman'=>($display['roman']??true)!==false,'name'=>($display['name']??true)!==false];
    $result=['version' => 1, 'key' => $key, 'meter'=>$meter,'progression' => implode(' ', $tokens), 'chords' => $clean,'display'=>$rows,'dynamics'=>$points];
    if(array_key_exists('song',$score))$result['song']=chordus_imported_song($score['song'],count($clean));
    return $result;
}
function chordus_client(string $raw): string {
    $id = trim($raw);
    chordus_require($id !== '' && strlen($id) <= 64 && preg_match('/^[A-Za-z0-9_-]+$/', $id) === 1, 'Invalid device id.');
    return $id;
}
function chordus_reins(PDO $db): ?array {
    $row = $db->query('SELECT holder,label,since,seen,prior,prior_label FROM reins WHERE id=1')->fetch(PDO::FETCH_ASSOC);
    return $row === false ? null : ['holder' => (string)$row['holder'], 'label' => (string)$row['label'],
        'since' => (int)$row['since'], 'seen' => (int)$row['seen'],
        'prior' => (string)$row['prior'], 'priorLabel' => (string)$row['prior_label']];
}
// Whoever had them immediately before the current holder, so a mistaken takeover
// can be handed straight back instead of the conductor having to watch for it.
// One step only: after a hand-back the person who gave them up is the one to
// hand them to, which is all this has to remember.
// What changed between one published score and the next, in the terms the choir
// would have noticed: the chords, the key, which labels were showing, and any
// measure whose voicing moved.
function chordus_score_changes(?array $before, array $after): array {
    $changes = [];
    if ($before === null) return [['field' => 'published', 'to' => $after['progression'] ?? '']];
    foreach (['progression' => 'progression', 'key' => 'key', 'meter' => 'meter'] as $field => $name) {
        $was = $before[$field] ?? null; $now = $after[$field] ?? null;
        if ($was !== $now) $changes[] = ['field' => $name, 'from' => $was, 'to' => $now];
    }
    foreach (['hand', 'roman', 'name'] as $row) {
        $was = $before['display'][$row] ?? null; $now = $after['display'][$row] ?? null;
        if ($was !== $now) $changes[] = ['field' => 'show ' . $row, 'from' => $was, 'to' => $now];
    }
    $old = $before['chords'] ?? []; $new = $after['chords'] ?? [];
    foreach ($new as $index => $chord) {
        $previous = $old[$index] ?? null;
        if ($previous === null) continue;
        if (($previous['notes'] ?? null) !== ($chord['notes'] ?? null)) {
            $changes[] = ['field' => 'voicing', 'measure' => $index + 1,
                'symbol' => $chord['symbol'] ?? '',
                'from' => $previous['notes'] ?? [], 'to' => $chord['notes'] ?? []];
        }
    }
    return $changes;
}
// One line a person could read, so the table is useful without a tool.
function chordus_change_summary(array $changes): string {
    if (!$changes) return 'republished unchanged';
    $parts = [];
    foreach ($changes as $change) {
        if ($change['field'] === 'voicing') { $parts[] = 'voicing in bar ' . $change['measure']; continue; }
        if ($change['field'] === 'published') { $parts[] = 'first publish: ' . $change['to']; continue; }
        $parts[] = $change['field'] . ' ' . json_encode($change['from']) . ' to ' . json_encode($change['to']);
    }
    $parts = array_values(array_unique($parts));
    $shown = array_slice($parts, 0, 4);
    if (count($parts) > count($shown)) $shown[] = '+' . (count($parts) - count($shown)) . ' more';
    return implode('; ', $shown);
}
function chordus_record(PDO $db, string $action, string $client, string $label,
                        ?int $revision, string $summary, ?array $changes = null, ?array $body = null): void {
    $q = $db->prepare('INSERT INTO history(at,action,client,label,revision,summary,changes,body) VALUES(?,?,?,?,?,?,?,?)');
    $q->execute([time(), $action, $client, $label, $revision, $summary,
        $changes === null ? null : json_encode($changes, JSON_UNESCAPED_UNICODE),
        $body === null ? null : json_encode($body, JSON_UNESCAPED_UNICODE)]);
}
function chordus_seize_reins(PDO $db, string $holder, string $label, string $action = 'seize'): array {
    $label = trim($label) === '' ? 'A device' : mb_substr(trim($label), 0, 40);
    chordus_require(preg_match('/^[\p{L}\p{N} .·-]+$/u', $label) === 1, 'Invalid device name.');
    $now = time();
    $held = chordus_reins($db);
    $prior = $held !== null && $held['holder'] !== $holder ? $held : null;
    $q = $db->prepare('INSERT INTO reins(id,holder,label,since,seen,prior,prior_label) VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET holder=excluded.holder, label=excluded.label, since=excluded.since, seen=excluded.seen, prior=excluded.prior, prior_label=excluded.prior_label');
    $q->execute([$holder, $label, $now, $now, $prior['holder'] ?? '', $prior['label'] ?? '']);
    chordus_record($db, $action, $holder, $label, null,
        $prior === null ? 'took the reins' : 'took the reins from ' . $prior['label']);
    return chordus_reins($db);
}
// Handing them back. Only the current holder may, and only when somebody had
// them before; the giver becomes the one to hand them to next.
function chordus_return_reins(PDO $db, string $holder): array {
    $held = chordus_reins($db);
    chordus_require($held !== null && $held['holder'] === $holder, 'Only the device conducting can hand the reins back.', 409);
    chordus_require($held['prior'] !== '', 'Nobody had the reins before this device.');
    return chordus_seize_reins($db, $held['prior'], $held['priorLabel'], 'return');
}
// A device names itself on every request. Anything that is not a name falls back
// rather than failing the request it rode in on.
function chordus_label(string $raw): string {
    $label = mb_substr(trim($raw), 0, 40);
    return $label !== '' && preg_match('/^[\p{L}\p{N} .\x{00b7}-]+$/u', $label) === 1 ? $label : 'A device';
}
// Somebody is always conducting. Whoever reaches an unclaimed session first
// takes it, so a room never sits in the state where nobody holds the reins and
// there is nothing for anyone to take. The holder's own polling is also what
// keeps the idle time honest for everyone else.
function chordus_hold_reins(PDO $db, string $holder, string $label='A device', bool $mayClaim=true): void {
    $touch = $db->prepare('UPDATE reins SET seen=? WHERE id=1 AND holder=?');
    $touch->execute([time(), $holder]);
    if ($touch->rowCount() === 0 && $mayClaim && chordus_reins($db) === null) chordus_seize_reins($db, $holder, $label);
}
// Everything the choir reads — the score and the pointer — belongs to one device
// at a time. An empty reins table means nobody has claimed them yet, so the
// first writer takes them rather than being locked out.
function chordus_require_reins(PDO $db, string $holder): void {
    $reins = chordus_reins($db);
    chordus_require($reins === null || $reins['holder'] === $holder, 'Another device has the reins.', 409);
    if ($reins === null) chordus_seize_reins($db, $holder, 'A device');
}
function chordus_current(PDO $db, array $seed): array {
    $row = $db->query('SELECT revision, body FROM score WHERE id=1')->fetch(PDO::FETCH_ASSOC);
    return $row ? ['revision' => (int)$row['revision'], 'score' => chordus_validate_score(json_decode($row['body'], true, 32, JSON_THROW_ON_ERROR))] : ['revision' => 0, 'score' => $seed];
}
// Matches cleanRehearsalCue in rhythm.mjs: a measure, and in it one voice or all
// of them. An `event` from an older page is accepted and dropped rather than
// refused, so a cue stored before the field went away stays readable.
function chordus_validate_cue(mixed $cue,array $score): ?array {
    if($cue===null)return null;
    chordus_require(is_array($cue)&&array_key_exists('measure',$cue)&&array_key_exists('part',$cue),'Invalid cue.');
    ['measure'=>$measure,'part'=>$part]=$cue;
    chordus_require(is_int($measure)&&$measure>=0&&isset($score['chords'][$measure]),'Choose an existing measure.');
    chordus_require($part===null||(is_int($part)&&$part>=0&&$part<4),'Invalid cue voice.');
    return ['measure'=>$measure,'part'=>$part];
}
function chordus_current_cue(PDO $db,int $revision): array {
    $row=$db->query('SELECT serial,score_revision,body FROM cue WHERE id=1')->fetch(PDO::FETCH_ASSOC);
    return ['serial'=>$row?(int)$row['serial']:0,'scoreRevision'=>$revision,'value'=>$row&&(int)$row['score_revision']===$revision?json_decode($row['body'],true,8,JSON_THROW_ON_ERROR):null];
}
function chordus_store_cue(PDO $db,mixed $cue,int $revision): void {
    $q=$db->prepare('INSERT INTO cue(id,serial,score_revision,body) VALUES(1,1,?,?) ON CONFLICT(id) DO UPDATE SET serial=cue.serial+1,score_revision=excluded.score_revision,body=excluded.body');
    $q->execute([$revision,json_encode($cue,JSON_THROW_ON_ERROR)]);
}
function chordus_point(PDO $db,mixed $cue,int $expected,array $seed,string $holder): void {
    chordus_require_reins($db, $holder);
    $db->exec('BEGIN IMMEDIATE');
    try{
        $current=chordus_current($db,$seed);
        chordus_require($current['revision']===$expected,'The score changed while this was sending.',409);
        $value=chordus_validate_cue($cue,$current['score']);$before=chordus_current_cue($db,$expected);
        if($before['value']!==$value)chordus_store_cue($db,$value,$expected);
        $db->exec('COMMIT');
    }catch(Throwable $error){$db->exec('ROLLBACK');throw $error;}
}
function chordus_publish(PDO $db, array $score, int $expected, array $seed, mixed $cue, string $holder): array {
    chordus_require_reins($db, $holder);
    $score = chordus_validate_score($score);
    $cue=chordus_validate_cue($cue,$score);
    $db->exec('BEGIN IMMEDIATE');
    try {
        $current = chordus_current($db, $seed);
        chordus_require($current['revision'] === $expected, 'The live progression changed while this was sending.', 409);
        $revision = $expected + 1;
        $q = $db->prepare('INSERT INTO score(id,revision,body) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, body=excluded.body');
        $q->execute([$revision, json_encode($score, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)]);
        chordus_store_cue($db,$cue,$revision);
        $changes = chordus_score_changes($current['score'] ?? null, $score);
        $held = chordus_reins($db);
        chordus_record($db, 'publish', $holder, $held['label'] ?? 'A device', $revision,
            chordus_change_summary($changes), $changes, $score);
        $db->exec('COMMIT');
        return ['revision' => $revision, 'score' => $score];
    } catch (Throwable $error) { $db->exec('ROLLBACK'); throw $error; }
}
// Approval voting for what to sing next: say yes to as many songs as you like.
// A vote lasts five minutes from when it was cast, which is about one song, so
// the wishes on the page are always the room's recent ones.
const CHORDUS_VOTE_TTL = 300;
// The server has no catalog to check a song against, so it holds the id to the
// shape every catalog id has and caps what one device, and the table, can hold.
function chordus_song_id(mixed $raw): string {
    chordus_require(is_string($raw) && preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/D', $raw) === 1, 'Unknown song.');
    return $raw;
}
function chordus_vote(PDO $db, string $voter, string $song, bool $on, ?int $now = null): void {
    $now ??= time();
    $db->prepare('DELETE FROM votes WHERE at<=?')->execute([$now - CHORDUS_VOTE_TTL]);
    if (!$on) { $db->prepare('DELETE FROM votes WHERE song=? AND voter=?')->execute([$song, $voter]); return; }
    $held = $db->prepare('SELECT COUNT(*) FROM votes WHERE voter=? AND song<>?'); $held->execute([$voter, $song]);
    chordus_require((int)$held->fetchColumn() < 64, 'Too many votes from this device.', 429);
    chordus_require((int)$db->query('SELECT COUNT(*) FROM votes')->fetchColumn() < 4096, 'Too many votes right now.', 429);
    // Voting again for the same song renews it rather than counting twice.
    $db->prepare('INSERT INTO votes(song,voter,at) VALUES(?,?,?) ON CONFLICT(song,voter) DO UPDATE SET at=excluded.at')->execute([$song, $voter, $now]);
}
// What every device is told: how many live votes each song has, which of them
// are this device's own and when each of those lapses. Reading never deletes,
// so a poll stays a read; the age filter is what makes an old vote not count.
function chordus_votes(PDO $db, string $voter, ?int $now = null): array {
    $now ??= time(); $floor = $now - CHORDUS_VOTE_TTL;
    $counts = []; $mine = [];
    $q = $db->prepare('SELECT song, COUNT(*) AS votes FROM votes WHERE at>? GROUP BY song'); $q->execute([$floor]);
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) $counts[(string)$row['song']] = (int)$row['votes'];
    $q = $db->prepare('SELECT song, at FROM votes WHERE voter=? AND at>?'); $q->execute([$voter, $floor]);
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) $mine[(string)$row['song']] = (int)$row['at'] + CHORDUS_VOTE_TTL;
    // Cast to objects so an empty ballot is {} and not [] on the wire.
    return ['ttl' => CHORDUS_VOTE_TTL, 'counts' => (object)$counts, 'mine' => (object)$mine];
}
function chordus_identity(PDO $db, string $token): ?array {
    if (preg_match('/^[a-f0-9]{64}$/D', $token) !== 1) return null;
    $q = $db->prepare('SELECT csrf, expires FROM sessions WHERE token_hash=? AND expires>?');
    $q->execute([hash('sha256', $token), time()]);
    return $q->fetch(PDO::FETCH_ASSOC) ?: null;
}
function chordus_login(PDO $db, string $password, string $hash, string $peer): array {
    $bucket = hash_hmac('sha256', $peer . ':' . intdiv(time(), 900), $hash);
    $db->prepare('INSERT INTO attempts(bucket,count,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1')->execute([$bucket, time()+900]);
    $q = $db->prepare('SELECT count FROM attempts WHERE bucket=?'); $q->execute([$bucket]);
    chordus_require((int)$q->fetchColumn() <= 8, 'Too many sign-in attempts. Try again in 15 minutes.', 429);
    chordus_require(strlen($password) <= 256 && password_verify($password, $hash), 'Incorrect conductor password.', 401);
    $token = bin2hex(random_bytes(32)); $csrf = bin2hex(random_bytes(24)); $expires = time()+30*86400;
    $db->prepare('INSERT INTO sessions(token_hash,csrf,expires) VALUES(?,?,?)')->execute([hash('sha256', $token), $csrf, $expires]);
    $db->prepare('DELETE FROM sessions WHERE expires<?')->execute([time()]);
    $db->prepare('DELETE FROM attempts WHERE expires<?')->execute([time()]);
    return ['token' => $token, 'csrf' => $csrf, 'expires' => $expires];
}
