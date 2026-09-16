<?php
declare(strict_types=1);
require dirname(__DIR__) . '/nutshell/engine.php';
$checks = 0;
function check(bool $value, string $label): void {
    global $checks;
    if (!$value) throw new RuntimeException("FAIL: $label");
    $checks++;
}
function denied(callable $operation, int $status, string $label): void {
    try { $operation(); } catch (DomainException $e) { check($e->getCode() === $status, $label); return; }
    throw new RuntimeException("FAIL: $label was allowed");
}
function act(array &$r, string $id, string $action, array $body = [], float $now = 1000): void {
    nk_action($r, $id, $action, ['round' => $r['round'], 'phase' => $r['phase'], ...$body], $now);
}
[$r, $t1] = nk_new('ABCDEFGH', 'Writer', 1000);
$p1 = nk_identity($r, $t1);
[$p2, $t2] = nk_join($r, 'Masker');
[$p3, $t3] = nk_join($r, 'Guesser');
check(nk_identity($r, $t3) === $p3, 'reconnect identity');
denied(fn() => nk_identity($r, str_repeat('0', 64)), 401, 'forged token rejected');
denied(function() use (&$r) { nk_join($r, 'Fourth'); }, 409, 'three seat limit');
denied(function() use (&$r, $p3) { act($r, $p3, 'settings', ['settings' => ['write'=>5,'mask'=>5,'guess'=>5]]); }, 403, 'only host sets timers');
act($r, $p1, 'settings', ['settings' => ['write'=>5,'mask'=>10,'guess'=>15]]);
act($r, $p1, 'start');
check($r['deadline'] === 1005.0, 'server writer deadline');
check($r['roles'] === ['write'=>$p1,'mask'=>$p2,'guess'=>$p3], 'initial roles');
act($r, $p1, 'draft', ['question'=>'Which planet has spectacular rings?', 'answer'=>'Saturn']);
check(!isset(nk_view($r, $p2, 1001)['question']), 'writer draft private from masker');
check(!isset(nk_view($r, $p3, 1001)['answer']), 'writer draft private from guesser');
act($r, $p1, 'settings', ['settings'=>['write'=>60,'mask'=>30,'guess'=>30]], 1002);
check($r['deadline'] === 1005.0 && $r['durations']['mask'] === 10, 'settings do not change current round');
nk_tick($r, 1005);
check($r['phase'] === 'mask' && $r['deadline'] === 1015.0, 'timeout advances saved question');
check(nk_view($r, $p2, 1005)['answer'] === 'Saturn', 'masker sees answer');
check(nk_view($r, $p3, 1005)['words'] === [], 'guesser gets nothing during masking');
denied(function() use (&$r, $p3) { act($r, $p3, 'draft', ['visible'=>[true,false,false,false,true]], 1006); }, 403, 'guesser cannot set mask');
act($r, $p2, 'draft', ['visible'=>[false,true,false,false,true]], 1006);
nk_tick($r, 1015);
$view = nk_view($r, $p3, 1015);
check($view['words'] === [null,'planet',null,null,'rings?'], 'hidden words are removed, not CSS-hidden');
check(!isset($view['answer']) && !isset($view['question']), 'answer absent in guess phase');
check(!str_contains(json_encode($view), 'secret'), 'other player tokens omitted');
act($r, $p3, 'draft', ['guess'=>'Saturn'], 1019);
nk_tick($r, 1030);
check($r['phase'] === 'reveal' && $r['guess'] === 'Saturn' && $r['outcome'] === null, 'timed guess submitted for human judgement');
check(nk_view($r, $p3, 1030)['answer'] === 'Saturn', 'answer revealed after guess');
denied(function() use (&$r, $p3) { act($r, $p3, 'judge', ['correct'=>true]); }, 403, 'guesser cannot self-judge');
act($r, $p1, 'judge', ['correct'=>true]);
act($r, $p1, 'start', [], 1040);
check($r['roles'] === ['write'=>$p2,'mask'=>$p3,'guess'=>$p1], 'roles rotate');
check($r['deadline'] === 1100.0, 'next round picks updated duration');
denied(function() use (&$r, $p2) { nk_action($r, $p2, 'submit', ['round'=>1,'phase'=>'write','question'=>'Old old question','answer'=>'no'], 1041); }, 409, 'late previous-round submit rejected');
nk_tick($r, 2000);
check($r['phase'] === 'reveal' && $r['outcome'] === false, 'empty writer timeout misses round');
act($r, $p1, 'start', [], 2100);
act($r, $p3, 'submit', ['question'=>'Question with enough words?', 'answer'=>'Yes'], 2101);
nk_tick($r, 2131);
check($r['phase'] === 'reveal' && $r['outcome'] === false, 'empty mask timeout misses round');
act($r, $p1, 'start', [], 2200);
act($r, $p1, 'submit', ['question'=>'Which sea is salty?', 'answer'=>'All'], 2201);
act($r, $p2, 'draft', ['visible'=>[true,false,false,false]], 2202);
nk_tick($r, 9999);
check($r['phase'] === 'reveal' && $r['outcome'] === false, 'sleep catches up, never extends timer');
act($r, $p1, 'start', [], 10000);
act($r, $p1, 'leave');
check($r['host'] === $p2 && count($r['players']) === 2 && $r['phase'] === 'reveal', 'leaving transfers host and safely ends round');
echo "$checks rules checks passed.\n";
