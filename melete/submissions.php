<?php
declare(strict_types=1);

// Submitted renders have their own ACL and lifetime, independent of editable backups.
function meleteSubmissionTables(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS submissions (owner TEXT NOT NULL, id TEXT NOT NULL, song TEXT NOT NULL, name TEXT NOT NULL, uploaded INTEGER NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY(owner,id))');
    $db->exec('CREATE INDEX IF NOT EXISTS submission_song_time ON submissions(song,uploaded)');
    $db->exec('CREATE TABLE IF NOT EXISTS submission_chunks (owner TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(owner,id,hash))');
    $db->exec('CREATE INDEX IF NOT EXISTS submission_chunk_ref ON submission_chunks(owner,hash)');
}
function meleteSubmissionReviewer(array $user,array $config,string $song): bool {
    if(!isset($config['submission_reviewers'][$song]) && !isset($config['submission_reviewer_hashes'][$song]))return meleteCanReview($user,$config);
    return meleteCanReview($user,['reviewers'=>$config['submission_reviewers'][$song] ?? []]) ||
        (($user['email_verified']??false)===true && !empty($user['email']) &&
        in_array(hash('sha256',strtolower($user['email'])),$config['submission_reviewer_hashes'][$song]??[],true));
}
function meleteSubmission(array $m): array {
    $invalid=static function(): never {throw new MeleteHttpError(400,'Invalid comp submission');};
    $num=static fn($v)=>is_int($v)||is_float($v) && is_finite($v);
    if (($m['version']??null)!==1 || !is_string($m['song']??null) || !$m['song'] || strlen($m['song'])>255 ||
        !is_string($m['label']??null) || !$m['label'] || strlen($m['label'])>120 || !is_string($m['fingerprint']??null) ||
        strlen($m['fingerprint'])>256 || !is_int($m['part']??null) || $m['part']<0 || $m['part']>255 ||
        (isset($m['line']) && (!is_int($m['line']) || $m['line']<0 || $m['line']>63)) || !$num($m['rate']??null) || $m['rate']<=0 ||
        !$num($m['origin']??null) || $m['origin']>0 || $m['origin']< -300 || !$num($m['seconds']??null) || $m['seconds']<=0 || $m['seconds']>3600 ||
        $m['fingerprint']==='' || $m['rate']>8 || !is_array($m['seams']??null) || !$m['seams'] || count($m['seams'])>4096) $invalid();
    $last=$m['origin'];$sources=[];
    foreach($m['seams'] as $s){
        if(!is_array($s) || count($s)!==3 || !$num($s[0]??null) || !$num($s[1]??null) ||
            $s[0]<$last-.000001 || $s[1]<=$s[0] || $s[1]>$m['seconds']+.000001 || !is_int($s[2]??null) || $s[2]<1 || $s[2]>4096)$invalid();
        $last=$s[1];$sources[$s[2]]=true;
    }
    $stats=$m['stats']??null;
    if(!is_array($stats) || !$num($stats['tracked']??null) || $stats['tracked']<0 || $stats['tracked']>100)$invalid();
    foreach(['mean','median'] as $k)if(!array_key_exists($k,$stats) || ($stats[$k]!==null && (!$num($stats[$k]) || $stats[$k]<0)))$invalid();
    if(isset($stats['within']) && (!$num($stats['within']) || $stats['within']<0 || $stats['within']>100))$invalid();
    if(!is_array($m['audio']??null)||!is_array($m['pitches']??null))$invalid();
    foreach(['audio','pitches'] as $k) {
        $p=$m[$k];
        if(!is_int($p['bytes']??null)||$p['bytes']<($k==='audio'?46:0)||$p['bytes']>128*1024*1024 ||
            !is_array($p['chunks']??null)||count($p['chunks'])!==(int)ceil($p['bytes']/1048576))$invalid();
        foreach($p['chunks'] as $hash)meleteId($hash);
        $m[$k]=['bytes'=>$p['bytes'],'chunks'=>array_values($p['chunks'])];
    }
    if($m['pitches']['bytes']%12!==0 || $m['pitches']['bytes']>12*(ceil(($m['seconds']-$m['origin'])*1000)+4096))$invalid();
    return ['version'=>1,'song'=>$m['song'],'track'=>meleteId($m['track']??null),'label'=>$m['label'],'fingerprint'=>$m['fingerprint'],
        'part'=>$m['part'],'line'=>$m['line']??null,'rate'=>$m['rate'],'seconds'=>$m['seconds'],'origin'=>$m['origin'],
        'seams'=>$m['seams'],'stats'=>['tracked'=>$stats['tracked'],'mean'=>$stats['mean'],'median'=>$stats['median'],
            'within'=>$stats['within']??null,'takes'=>count($sources)],
        'audio'=>$m['audio'],'pitches'=>$m['pitches']];
}
function meleteSubmit(PDO $db,string $owner,string $name,array $body): array {
    $m=meleteSubmission($body);$json=json_encode($m,JSON_THROW_ON_ERROR);$id=hash('sha256',$json);
    $db->exec('BEGIN IMMEDIATE');
    $q=$db->prepare('SELECT uploaded FROM submissions WHERE owner=? AND id=?');$q->execute([$owner,$id]);
    if(($when=$q->fetchColumn())!==false){$db->exec('COMMIT');return ['id'=>$id,'uploaded'=>(int)$when,'unchanged'=>true];}
    $q=$db->prepare('SELECT COUNT(*) FROM submissions WHERE owner=?');$q->execute([$owner]);
    if($q->fetchColumn()>=512)throw new MeleteHttpError(413,'Submission limit reached. Withdraw an old upload first.');
    $size=$db->prepare('SELECT bytes FROM blobs WHERE owner=? AND hash=?');
    $link=$db->prepare('INSERT OR IGNORE INTO submission_chunks VALUES (?,?,?)');
    foreach(['audio','pitches'] as $k){
        $left=$m[$k]['bytes'];
        foreach($m[$k]['chunks'] as $hash){
            $size->execute([$owner,$hash]);$n=$size->fetchColumn();
            if($n===false || (int)$n!==min(1048576,$left))throw new MeleteHttpError(400,'Incomplete comp upload');
            $left-=(int)$n;$link->execute([$owner,$id,$hash]);
        }
    }
    $q=$db->prepare('SELECT substr(data,1,44) FROM blobs WHERE owner=? AND hash=?');
    $q->execute([$owner,$m['audio']['chunks'][0]]);$h=$q->fetchColumn();
    $fmt=strlen($h)===44?unpack('vformat/vchannels/Vrate/VbyteRate/valign/vbits',substr($h,20,16)):null;
    if(!$fmt || substr($h,0,4)!=='RIFF' || substr($h,8,8)!=='WAVEfmt ' || substr($h,36,4)!=='data' ||
        $fmt['format']!==1 || $fmt['channels']!==1 || $fmt['bits']!==16 || $fmt['rate']<8000 || $fmt['rate']>192000 ||
        unpack('V',substr($h,40,4))[1]!==$m['audio']['bytes']-44 ||
        abs(($m['audio']['bytes']-44)/2-($m['seconds']-$m['origin'])*$fmt['rate'])>1.01)
        throw new MeleteHttpError(400,'Comp audio must match the submitted duration');
    $when=(int)round(microtime(true)*1000);
    $q=$db->prepare('INSERT INTO submissions VALUES (?,?,?,?,?,?)');$q->execute([$owner,$id,$m['song'],$name,$when,$json]);
    $db->exec('COMMIT');return ['id'=>$id,'uploaded'=>$when,'unchanged'=>false];
}
function meleteSubmissionList(PDO $db,string $owner,string $song,bool $review,int $offset): array {
    $q=$db->prepare('SELECT owner,id,name,uploaded,json_extract(manifest,\'$.label\') label,json_extract(manifest,\'$.stats\') stats FROM submissions WHERE song=?'.
        ($review?'':' AND owner=?').' ORDER BY uploaded DESC,owner,id LIMIT 51 OFFSET ?');
    $args=$review?[$song,$offset]:[$song,$owner,$offset];
    foreach($args as $i=>$v)$q->bindValue($i+1,$v,is_int($v)?PDO::PARAM_INT:PDO::PARAM_STR);
    $q->execute();$rows=$q->fetchAll(PDO::FETCH_ASSOC);$items=[];
    foreach(array_slice($rows,0,50) as $r){$stats=json_decode($r['stats'],true,512,JSON_THROW_ON_ERROR);unset($r['stats']);$items[]=$r+$stats;}
    return ['items'=>$items,'next'=>count($rows)>50?$offset+50:null];
}
function meleteReadSubmission(PDO $db,string $owner,string $id,string $reader,array $user,array $config): array {
    $q=$db->prepare('SELECT song,manifest FROM submissions WHERE owner=? AND id=?');$q->execute([$owner,$id]);$r=$q->fetch(PDO::FETCH_ASSOC);
    if(!$r || ($owner!==$reader && !meleteSubmissionReviewer($user,$config,$r['song'])))throw new MeleteHttpError(404,'Submission not available');
    return json_decode($r['manifest'],true,512,JSON_THROW_ON_ERROR);
}
