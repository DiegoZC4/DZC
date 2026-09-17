<?php
declare(strict_types=1);

// Server-side counterpart of chord-parser.mjs. The browser sends compact,
// normalized symbols, not an unchecked client-supplied pitch-class dictionary.
// The shared JS/PHP fixture suite tests the full grammar and four-voice reduction.
function chordus_mod(int $n): int { return (($n % 12) + 12) % 12; }
function chordus_chord_spec(string $symbol, int $key): array {
    chordus_require(strlen($symbol)<=512,'Chord name is too long.');
    $symbol=str_replace(['♭','♯','º','6/9'],['b','#','°','69'],$symbol);
    $romans=['I','II','III','IV','V','VI','VII'];$scale=[0,2,4,5,7,9,11];$letters='CDEFGAB';
    $alter=static fn(string $s): int=>substr_count($s,'#')-substr_count($s,'b');
    if(preg_match('/^([b#]{0,2})(VII|III|VI|IV|II|V|I)/i',$symbol,$m)){
        $roman=true;$minor=$m[2]===strtolower($m[2]);
        $root=$key+$scale[array_search(strtoupper($m[2]),$romans,true)]+$alter($m[1]);
    }else{
        chordus_require(preg_match('/^([A-Ga-g])([b#]{0,2})/',$symbol,$m)===1,'Invalid chord root.');
        $roman=false;$minor=false;$root=$scale[strpos($letters,strtoupper($m[1]))]+$alter($m[2]);
    }
    $tail=substr($symbol,strlen($m[0]));$bass=null;$inversion=0;
    if(str_contains($tail,'/')){
        $slash=strrpos($tail,'/');$target=substr($tail,$slash+1);$tail=substr($tail,0,$slash);
        // Matches readChord in chord-parser.mjs: a number after the slash names
        // the chord tone put in the bass, so ii/3 is the first inversion and a
        // plain 6 is free to mean an added sixth.
        if($roman&&preg_match('/^[357]$/D',$target)===1)$inversion=(int)$target;
        elseif(preg_match('/^([A-Ga-g])([b#]{0,2})$/D',$target,$m))$bass=chordus_mod($scale[strpos($letters,strtoupper($m[1]))]+$alter($m[2]));
        else{
            chordus_require($roman&&preg_match('/^([b#]{0,2})(VII|III|VI|IV|II|V|I)$/iD',$target,$m)===1,'Invalid slash bass or Roman target.');
            $root+=$scale[array_search(strtoupper($m[2]),$romans,true)]+$alter($m[1]);
        }
        chordus_require(!str_contains($tail,'/'),'Invalid nested slash.');
    }
    $quality=$minor?'minor':'major';$explicitMinor=false;$major=false;$half=false;$sus=0;$extension=null;$implicit=false;
    $additions=[];$alterations=[];$omissions=[];$rest=$tail;
    while($rest!==''){
        if(preg_match('/^(maj|ma|min|mi|dim|aug|dom|sus(?:24|2|4)?|add|no|alt)/i',$rest,$m)){
            $word=strtolower($m[1]);$rest=substr($rest,strlen($m[0]));
            if(in_array($word,['maj','ma'],true)){$major=true;continue;}
            if(in_array($word,['min','mi'],true)){$quality='minor';$explicitMinor=true;continue;}
            if($word==='dim'){$quality='diminished';continue;}
            if($word==='aug'){$quality='augmented';continue;}
            if($word==='dom'){$quality='major';if($extension===null){$extension=7;$implicit=true;}continue;}
            if($word==='alt'){if($extension===null){$extension=7;$implicit=true;}$alterations[]=[5,1];$alterations[]=[9,1];continue;}
            if(str_starts_with($word,'sus')){$sus=(int)(substr($word,3)?:4);continue;}
            chordus_require(preg_match('/^([b#]?)(13|11|9|7|6|5|4|3|2|1)/',$rest,$m)===1,'Missing added/omitted chord degree.');
            $rest=substr($rest,strlen($m[0]));$degree=(int)$m[2];
            if($word==='no'){chordus_require($m[1]==='','Invalid omitted degree.');$omissions[]=$degree;}
            else $additions[]=[$degree,$alter($m[1])];
            continue;
        }
        if(preg_match('/^(M|m|-|°|o|O|ø|Ø|h|H)/u',$rest,$m)){
            $c=$m[0];$rest=substr($rest,strlen($c));
            if($c==='M'){$major=true;continue;}
            if($c==='m'||$c==='-'){$quality='minor';$explicitMinor=true;continue;}
            $quality='diminished';$half=in_array($c,['ø','Ø','h','H'],true);
            if($half&&$extension===null){$extension=7;$implicit=true;}continue;
        }
        if($rest[0]==='+'&&($extension===null||!preg_match('/^\+(?:13|11|9|7|6|5|4|3|2|1)/',$rest))){$quality='augmented';$rest=substr($rest,1);if($rest==='5')$rest='';continue;}
        if(preg_match('/^([b#+])(13|11|9|7|6|5|4|3|2|1)/',$rest,$m)){$alterations[]=[(int)$m[2],$m[1]==='b'?-1:1];$rest=substr($rest,strlen($m[0]));continue;}
        if(preg_match('/^(69|64|65|43|42|13|11|9|7|6|5|4|2)/',$rest,$m)){
            $n=(int)$m[0];if($extension===null||$implicit){$extension=$n;$implicit=false;}elseif($n!==$extension)$additions[]=[$n,0];
            $rest=substr($rest,strlen($m[0]));continue;
        }
        throw new RuntimeException('Unrecognized chord syntax.',400);
    }
    if($major&&!$explicitMinor&&!in_array($quality,['diminished','augmented'],true)&&!($minor&&$extension>=7))$quality='major';
    $figured=$roman&&in_array($extension,[64,65,43,42],true)&&!$sus&&!$additions&&!$alterations&&!$omissions;
    chordus_require(!in_array($extension,[64,65,43,42],true)||$figured,'Invalid figured bass.');
    $figure=$figured?$extension:null;
    if($figured)$extension=in_array($figure,[65,43,42],true)?7:null;
    $tones=[];
    $put=static function(int $degree,int $interval)use(&$tones): void{$tones[$degree]=['degree'=>$degree,'interval'=>chordus_mod($interval)];};
    $put(1,0);
    if($extension!==5){
        if($sus){if(in_array($sus,[2,24],true))$put(2,2);if(in_array($sus,[4,24],true))$put(4,5);}
        else $put(3,in_array($quality,['minor','diminished'],true)?3:4);
    }
    $put(5,$quality==='diminished'?6:($quality==='augmented'?8:7));
    if(in_array($extension,[7,9,11,13],true)){
        $put(7,$major?11:($quality==='diminished'&&!$half?9:10));
        if($extension>=9)$put(9,2);if($extension===11)$put(11,5);if($extension===13)$put(13,9);
    }
    if(in_array($extension,[6,69],true))$put(6,9);
    if(in_array($extension,[69,2],true))$put(9,2);if($extension===4)$put(4,5);
    $modified=[];
    foreach(array_merge($additions,$alterations)as[$degree,$accidental]){
        chordus_require(in_array($degree,[1,2,3,4,5,6,7,9,11,13],true),'Invalid chord degree.');
        if(!isset($modified[$degree])){unset($tones[$degree]);$modified[$degree]=true;}
        $tones[$degree.':'.$accidental]=['degree'=>$degree,'interval'=>chordus_mod($scale[($degree-1)%7]+$accidental)];
    }
    foreach($omissions as $degree)foreach($tones as $id=>$tone)if(($tone['degree']-1)%7===($degree-1)%7)unset($tones[$id]);
    $tones=array_values($tones);usort($tones,static fn($a,$b)=>$a['degree']<=>$b['degree']);
    chordus_require(count($tones)>=2,'Keep at least two chord tones.');
    $intervals=array_values(array_unique(array_column($tones,'interval')));
    $degrees=array_column($tones,'degree');
    chordus_require(!$inversion||in_array($inversion,$degrees,true),'This chord has no '.$inversion.' to put in the bass.');
    $seat=$inversion?array_search($inversion,$degrees,true):false;
    $bassTone=$seat!==false?$seat:($figured?[64=>2,65=>1,43=>2,42=>3][$figure]:0);
    $defaultBass=$seat!==false?$tones[$seat]['interval']:($figured?$intervals[$bassTone]:(in_array(1,$degrees,true)?0:$tones[0]['interval']));
    $bass??=chordus_mod($root+$defaultBass);
    $rank=static fn($t)=>$t['degree']===3?100:($t['degree']===7?98:(in_array($t['degree'],[2,4],true)?96:($t['degree']>=6?90+$t['degree']/100:($t['degree']===1?70:($t['interval']===7?10:94)))));
    usort($tones,static fn($a,$b)=>($rank($b)<=>$rank($a))?:($a['degree']<=>$b['degree']));
    $pcs=[$bass];foreach($tones as $tone){$pc=chordus_mod($root+$tone['interval']);if(!in_array($pc,$pcs,true)&&count($pcs)<4)$pcs[]=$pc;}
    return ['pcs'=>$pcs,'bass'=>$bass];
}
