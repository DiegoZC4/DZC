<?php
declare(strict_types=1);

// Aggregate counts only: no raw addresses, agents, account IDs or free text.
function audioMetricsDb(): PDO {
    umask(0077);
    $docroot=rtrim((string)($_SERVER['DOCUMENT_ROOT']??''),'/');
    if ($docroot==='') throw new RuntimeException('No document root');
    $root=dirname($docroot).'/sequences-audio-stats';
    if (!is_dir($root) && !mkdir($root,0700,true) && !is_dir($root)) throw new RuntimeException('Storage unavailable');
    $db=new PDO('sqlite:'.$root.'/metrics-v3.sqlite',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout=500; PRAGMA journal_mode=WAL');
    $db->exec('CREATE TABLE IF NOT EXISTS totals (day TEXT, week TEXT, event TEXT, chapter INTEGER, action TEXT,
        device TEXT, client TEXT, network TEXT, bucket TEXT, count INTEGER DEFAULT 0, total REAL DEFAULT 0, maximum REAL DEFAULT 0,
        PRIMARY KEY(day,week,event,chapter,action,device,client,network,bucket))');
    $db->exec('CREATE TABLE IF NOT EXISTS seen (period TEXT, week TEXT, kind TEXT, visitor TEXT, n INTEGER DEFAULT 0,
        PRIMARY KEY(period,week,kind,visitor))');
    $db->exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
    $db->exec('CREATE TABLE IF NOT EXISTS audience_weekly (period TEXT PRIMARY KEY,
        visitors INTEGER NOT NULL DEFAULT 0, listeners INTEGER NOT NULL DEFAULT 0)');
    $s=$db->prepare('INSERT OR IGNORE INTO settings VALUES (?,?)');
    $s->execute(['secret',bin2hex(random_bytes(32))]); $s->execute(['started',gmdate('c')]);
    $s->execute(['audience_started',gmdate('c')]);
    return $db;
}
function audioMetricsDevice(string $ua): string {
    if (preg_match('/ipad|tablet/i',$ua)) return 'tablet';
    return preg_match('/iphone|android|mobile/i',$ua)?'phone':'desktop-other';
}
function audioMetricsClient(string $ua): string {
    foreach (['pocketcasts'=>'pocket-casts','podcastaddict'=>'podcast-addict','overcast'=>'overcast','antennapod'=>'antennapod',
        'applecoremedia'=>'apple','itunes'=>'apple','podcasts/'=>'apple','youtube'=>'youtube','spotify'=>'spotify',
        'castbox'=>'castbox','edg/'=>'edge','firefox'=>'firefox','fxios'=>'firefox','chrome'=>'chrome','crios'=>'chrome','safari'=>'safari'] as $token=>$name)
        if (stripos($ua,$token)!==false) return $name;
    return 'other';
}
function audioMetricsAddress(): string {
    // Hostinger CDN convention retained from the existing visitor counter.
    return trim(explode(',',(string)($_SERVER['HTTP_X_FORWARDED_FOR']??$_SERVER['HTTP_X_REAL_IP']??$_SERVER['HTTP_CF_CONNECTING_IP']??$_SERVER['REMOTE_ADDR']??''))[0]);
}
function audioMetricsVisitor(PDO $db,string $period): string {
    $secret=$db->query("SELECT value FROM settings WHERE key='secret'")->fetchColumn();
    return hash_hmac('sha256',$period.'|'.audioMetricsAddress().'|'.substr((string)($_SERVER['HTTP_USER_AGENT']??''),0,512),$secret);
}
function audioMetricsAudienceAdd(PDO $db,string $period,string $kind,string $address): void {
    if ($address==='' || !in_array($kind,['page','play'],true)) return;
    $secret=$db->query("SELECT value FROM settings WHERE key='secret'")->fetchColumn();
    $hash=hash_hmac('sha256','address|'.$period.'|'.$address,$secret);
    $s=$db->prepare("INSERT OR IGNORE INTO seen(period,week,kind,visitor) VALUES (?,'all',?,?)");
    $s->execute([$period,'address-'.$kind,$hash]);
    if ($s->rowCount()===1) {
        $column=$kind==='page'?'visitors':'listeners';
        $db->prepare("UPDATE audience_weekly SET $column=$column+1 WHERE period=?")->execute([$period]);
    }
}
function audioMetricsAudienceInit(PDO $db,string $period): void {
    // Called under a transaction. Seed the transition week's old addresses once,
    // so a returning reader counts once across both collectors and all episodes.
    $s=$db->prepare('INSERT OR IGNORE INTO audience_weekly(period) VALUES (?)');
    $s->execute([$period]);
    if ($s->rowCount()!==1) return;
    $iso=(new DateTimeImmutable($period,new DateTimeZone('UTC')))->format('o-\WW');
    $root=dirname(rtrim((string)$_SERVER['DOCUMENT_ROOT'],'/')).'/sequences-audio-stats/weeks';
    if (!is_dir($root)) return;
    foreach (scandir($root) ?: [] as $name) {
        if (!preg_match('/^'.preg_quote($iso,'/').'__(?:lsrg-\d+|none)\.(page|play)$/D',$name,$match)) continue;
        $file=fopen($root.'/'.$name,'rb');
        if ($file===false) throw new RuntimeException('Legacy audience unavailable');
        try {
            while (($line=fgets($file))!==false) {
                audioMetricsAudienceAdd($db,$period,$match[1],trim(explode("\t",$line,2)[0]));
            }
        } finally {fclose($file);}
    }
}
function audioMetricsUnique(PDO $db,string $period,string $week,string $kind): bool {
    $s=$db->prepare('INSERT OR IGNORE INTO seen(period,week,kind,visitor) VALUES (?,?,?,?)');
    $s->execute([$period,$week,$kind,audioMetricsVisitor($db,$period)]); return $s->rowCount()===1;
}
function audioMetricsRecord(string $event,array $input): bool {
    $events=['chapter','feedinfo','milestone','page','play','rate','reader','readerjump','return','search','searchnav','searchopen',
        'share','skip','subscribe','subscribemenu','timelineseek','volume','weekopen','wordseek','listen','startup','buffer',
        'mediaerror','retry','offline','annotation','connectivity','podcast'];
    if (!in_array($event,$events,true)) return false;
    $week=is_string($input['w']??null)&&preg_match('/^lsrg-\d{1,4}$/',$input['w'])?$input['w']:'none';
    if ($event==='podcast'&&$week==='none') return false;
    $ua=substr((string)($_SERVER['HTTP_USER_AGENT']??''),0,512);
    if ($ua===''||preg_match('/bot\b|crawler|spider|monitor|curl|Sequences-QA/i',$ua)) return true;
    $actions=['copy-rss','apple','apple-podcasts','youtube','youtube-music','pocket-casts','podcast-addict','overcast','castro','castbox','rss',
        'forward','back','backward','next','previous','open','close','new','marker','save','save-error','delete','start','pause','resume','complete','partial','error','remove','online','offline','playing','seek'];
    $requestedAction=$input['a']??$input['d']??'';
    $action=in_array($requestedAction,$actions,true)?$requestedAction:'';
    $chapter=max(0,min(50,is_numeric($input['c']??null)?(int)$input['c']:0));
    $network=in_array($input['net']??'',['offline','slow-2g','2g','3g','4g','unknown'],true)?$input['net']:'unknown';
    $number=is_numeric($input['n']??null)?max(0,min(300000,(float)$input['n'])):0;
    if ($event==='listen') $number=min(60,$number);
    $bucket='';
    if (in_array($event,['startup','buffer'],true)) $bucket=$number<1000?'<1s':($number<3000?'1-3s':($number<10000?'3-10s':($number<30000?'10-30s':'>=30s')));
    elseif ($event==='rate') $bucket=(string)(max(.75,min(3,round((float)($input['r']??1)*4)/4)));
    elseif ($event==='volume') $bucket=(string)(round(min(100,$number)/10)*10);
    elseif ($event==='mediaerror') $bucket=(string)min(4,(int)$number);
    elseif ($event==='search') $bucket=$number===0.0?'0':($number<=5?'1-5':($number<=20?'6-20':'>20'));
    elseif ($event==='milestone') $bucket=(string)(max(0,min(100,round((float)($input['m']??0)/25)*25)));
    $db=audioMetricsDb(); $day=gmdate('Y-m-d'); $db->beginTransaction();
    try {
        $db->prepare('DELETE FROM seen WHERE period < ?')->execute([gmdate('Y-m-d',time()-8*86400)]);
        $visitor=audioMetricsVisitor($db,$day);
        $s=$db->prepare("INSERT INTO seen(period,week,kind,visitor,n) VALUES (?,'all','limit',?,1) ON CONFLICT DO UPDATE SET n=n+1");
        $s->execute([$day,$visitor]);
        $s=$db->prepare("SELECT n FROM seen WHERE period=? AND week='all' AND kind='limit' AND visitor=?");
        $s->execute([$day,$visitor]); $count=(int)$s->fetchColumn(); $s->closeCursor();
        if ($count>6000) {$db->commit();return true;}
        $row=[$day,$week,$event,$chapter,$action,audioMetricsDevice($ua),audioMetricsClient($ua),$network,$bucket];
        $insert=$db->prepare('INSERT INTO totals VALUES (?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT DO UPDATE SET count=count+1,total=total+excluded.total,maximum=MAX(maximum,excluded.maximum)');
        if ($event==='podcast') {
            if (audioMetricsUnique($db,$day,$week,'podcast')) $insert->execute([...$row,0,0]);
            $row[2]='podcast-requests';
        }
        $insert->execute([...$row,$number,$number]);
        if (in_array($event,['page','play'],true)&&audioMetricsUnique($db,gmdate('Y-m-d',strtotime('monday this week UTC')),$week,$event)) {
            $row[2]='unique-'.$event; $insert->execute([...$row,0,0]);
        }
        if (in_array($event,['page','play'],true)) {
            $period=gmdate('Y-m-d',strtotime('monday this week UTC'));
            audioMetricsAudienceInit($db,$period);
            audioMetricsAudienceAdd($db,$period,$event,audioMetricsAddress());
        }
        $db->commit();return true;
    } catch(Throwable $e) {if($db->inTransaction())$db->rollBack();throw $e;}
}
function audioMetricsReport(): array {
    $db=audioMetricsDb();
    $db->beginTransaction();
    try {
        audioMetricsAudienceInit($db,gmdate('Y-m-d',strtotime('monday this week UTC')));
        $db->commit();
    } catch(Throwable $error) {if($db->inTransaction())$db->rollBack();throw $error;}
    $audience=[];
    foreach ($db->query('SELECT * FROM audience_weekly')->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $iso=(new DateTimeImmutable($row['period'],new DateTimeZone('UTC')))->format('o-\WW');
        $audience[$iso]=['visitors'=>(int)$row['visitors'],'listeners'=>(int)$row['listeners']];
    }
    $daily=$db->query('SELECT * FROM totals ORDER BY day,week,event')->fetchAll(PDO::FETCH_ASSOC);
    $weekly=[];
    foreach($daily as $row) {
        $iso=(new DateTimeImmutable($row['day'],new DateTimeZone('UTC')))->format('o-\WW');
        $event=$row['event'];$week=$row['week'];
        $weekly[$iso][$week][$event]['count']=($weekly[$iso][$week][$event]['count']??0)+(int)$row['count'];
        $weekly[$iso][$week][$event]['total']=($weekly[$iso][$week][$event]['total']??0)+(float)$row['total'];
    }
    return ['started'=>$db->query("SELECT value FROM settings WHERE key='started'")->fetchColumn(),
        'audience_started'=>$db->query("SELECT value FROM settings WHERE key='audience_started'")->fetchColumn(),
        'audience'=>$audience,
        'definitions'=>['podcast'=>'GET download requests deduplicated per UTC day / episode / address+agent hash; not completed downloads or listens',
            'listen'=>'Observed progressing playback wall seconds, excluding stalls/seeks; timer throttling can undercount',
            'audience'=>'Weekly unique network addresses across all webpage episodes; same definition as legacy visitor/listener counts, not people',
            'unique-page'=>'Estimated weekly devices, not people; no account identity'],
        'weekly'=>$weekly,'daily'=>$daily];
}
