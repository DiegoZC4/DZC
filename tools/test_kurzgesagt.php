<?php
declare(strict_types=1);
require dirname(__DIR__) . '/kurzgesagt/engine.php';
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
function puzzle(string $question, string $answer, array $clicked = []): array {
    $draft = kg_draft($question, $answer);
    return [
        'id' => 'K7M2QX', 'question' => $draft['question'], 'answer' => $draft['answer'], 'words' => $draft['words'],
        'order' => kg_order($draft['words'], $clicked, $draft['answer']), 'author' => 'author-hash', 'created' => 1000,
    ];
}

// --- Writing ---------------------------------------------------------------------------
denied(fn() => kg_draft('Saturn', 'Saturn'), 400, 'one-word question rejected');
denied(fn() => kg_draft(implode(' ', array_fill(0, 41, 'word')), 'Yes'), 400, '41-word question rejected');
denied(fn() => kg_draft('Which planet has rings', '?'), 400, 'punctuation-only answer rejected');
denied(fn() => kg_draft('Which planet has rings', 'a|Saturn'), 400, 'one-character alternative rejected');
check(kg_draft('Which  planet   has rings', ' Saturn ')['words'] === ['Which', 'planet', 'has', 'rings'], 'question splits on any run of spaces');

// --- Answer normalisation ---------------------------------------------------------------
check(kg_normalize('  SATURN!! ') === 'saturn', 'case, punctuation and padding folded away');
check(kg_normalize('Crème Brûlée') === 'creme brulee', 'accents folded');
check(kg_normalize("the   dog's   bone") === 'the dogs bone', 'inner whitespace collapsed');
check(kg_normalize('The Who') === 'the who', 'leading articles are kept');
foreach (['Crème Brûlée' => 'creme brulee', 'Straße' => 'strasse', 'Ångström' => 'angstrom', 'Œuvre' => 'oeuvre'] as $raw => $want) {
    check(kg_normalize($raw, false) === $want, "strtr fallback folds $raw without ext-intl");
    check(kg_normalize($raw, true) === $want, "Normalizer path folds $raw the same way");
}
check(kg_alternatives('Saturn | the ringed one |') === ['saturn', 'the ringed one'], 'alternatives split on the pipe');
check(kg_answer_shown('Saturn|the ringed one') === 'Saturn', 'only the first alternative is ever shown');
check(kg_matches('  saturn ', 'Saturn|the ringed one'), 'padded lowercase guess matches');
check(kg_matches('THE RINGED ONE.', 'Saturn|the ringed one'), 'later alternative matches');
check(!kg_matches('rings', 'Saturn|the ringed one'), 'near miss does not match');

// --- Reveal order -----------------------------------------------------------------------
$words = kg_words('Which planet is famous for its rings');
denied(fn() => kg_order($words, [0, 0], 'Saturn'), 400, 'duplicate click rejected');
denied(fn() => kg_order($words, [99], 'Saturn'), 400, 'out-of-range click rejected');
denied(fn() => kg_order($words, ['1'], 'Saturn'), 400, 'non-integer click rejected');
denied(fn() => kg_order($words, ['a' => 1], 'Saturn'), 400, 'keyed array rejected');
denied(fn() => kg_order($words, 'nope', 'Saturn'), 400, 'non-array reveal order rejected');
check(kg_order($words, [], 'Saturn') === [0, 1, 2, 3, 4, 5, 6], 'zero clicks publishes in sentence order');
check(kg_order($words, [2, 5], 'Saturn') === [2, 5, 0, 1, 3, 4, 6], 'clicked words first, the rest in sentence order');
check(kg_is_order(kg_order($words, [4, 1], 'Saturn'), 7), 'the result is always a permutation');
check(!kg_is_order([0, 1, 2, 3, 4, 5], 7) && !kg_is_order([0, 0, 1, 2, 3, 4, 5], 7), 'short and duplicated orders are not permutations');
$spoiler = kg_order($words, [6, 1], 'rings');
check($spoiler[count($spoiler) - 1] === 6 && $spoiler[0] === 1, 'a word that gives the answer away is silently moved last');

// --- Round economy ----------------------------------------------------------------------
$p = puzzle('Which planet is famous for its rings', 'Saturn|the ringed one', [2, 5]);
$run = kg_new_run($p);
check(kg_round_zero(7) === 2 && kg_round_zero(4) === 1 && kg_round_zero(1) === 1, 'round 0 uncovers a quarter, at least one word');
check($run['rounds'] === 0 && $run['steps'] === 2, 'round 0 is free');
$view = kg_view($p, $run);
check($view['words'] === [null, null, 'is', null, null, 'its', null], 'covered words are literal null, not a placeholder of the right length');
$json = json_encode($view);
check(str_contains($json, 'null'), 'the payload really carries JSON null');
foreach (['Saturn', 'ringed', 'planet', 'famous', 'rings', 'Which'] as $secret) {
    check(!str_contains($json, $secret), "an unsolved player never receives \"$secret\"");
}
check(!isset($view['answer']) && !isset($view['question']) && !isset($view['order']), 'answer, full question and reveal order are absent before the end');
check($view['hidden'] === 5 && $view['total'] === 7 && $view['free'] === 2, 'counts describe the board without describing the words');

check(kg_guess($run, $p, 'mars') === 'wrong', 'a wrong guess is a wrong guess');
check($run['rounds'] === 1, 'a wrong guess costs one round');
check(kg_view($p, $run)['words'] === [null, null, 'is', null, null, 'its', null], 'a wrong guess uncovers nothing at all');
check(kg_guess($run, $p, ' MARS! ') === 'repeat', 'a repeat guess is refused after normalising');
check($run['rounds'] === 1 && count($run['tried']) === 1, 'a repeat guess is free and is not recorded twice');
check(kg_pass($run, $p) === 'pass' && $run['rounds'] === 2, 'pass costs one round');
check(kg_view($p, $run)['words'] === ['Which', null, 'is', null, null, 'its', null], 'pass uncovers the next word in the reveal order');
kg_pass($run, $p);
kg_pass($run, $p);
check(kg_view($p, $run)['words'] === ['Which', 'planet', 'is', 'famous', null, 'its', null], 'the reveal order is the writer\'s, not the sentence\'s');
check(kg_guess($run, $p, 'the ringed one') === 'correct', 'any alternative wins');
check($run['solved'] === true && $run['score'] === 5, 'the score is the round counter at the moment of solving');
$view = kg_view($p, $run);
check($view['words'] === $p['words'] && $view['answer'] === 'Saturn' && $view['question'] === 'Which planet is famous for its rings', 'solving reveals the question and the first alternative');
check($view['tried'] === ['mars', 'the ringed one'], 'the tried list keeps what was typed, once each');
denied(function () use (&$run, $p) { kg_pass($run, $p); }, 409, 'a solved run cannot spend another round');

// --- One word, every copy ----------------------------------------------------------------
$dup = puzzle('the cat sat on the mat', 'furniture', [1, 2, 0]);
check($dup['order'] === [1, 2, 0, 3, 4, 5], 'clicked order kept');
$run = kg_new_run($dup);
check(kg_view($dup, $run)['words'] === [null, 'cat', 'sat', null, null, null], 'round 0 uncovers two steps');
kg_pass($run, $dup);
check(kg_view($dup, $run)['words'] === ['the', 'cat', 'sat', null, 'the', null], 'uncovering a word uncovers every copy of it');
kg_pass($run, $dup);
check(kg_view($dup, $run)['words'] === ['the', 'cat', 'sat', 'on', 'the', null], 'the fourth word follows');
check($run['rounds'] === 2, 'two passes so far');
kg_pass($run, $dup);
check(kg_view($dup, $run)['words'] === ['the', 'cat', 'sat', 'on', 'the', 'mat'], 'the already-shown duplicate is skipped, so nobody pays twice for "the"');
check($run['rounds'] === 3, 'three passes uncovered six words');

// --- End of the ladder ---------------------------------------------------------------------
check(kg_complete($dup['words'], $dup['order'], $run['steps']), 'the board is complete');
check(kg_view($dup, $run)['complete'] === true, 'the view says so, so Pass can be relabelled');
denied(function () use (&$run, $dup) { kg_pass($run, $dup); }, 409, 'pass is refused once everything is showing');
check(!isset(kg_view($dup, $run)['answer']), 'running out of words is not a loss and does not reveal the answer');
check(kg_guess($run, $dup, 'chairs') === 'wrong' && $run['rounds'] === 4, 'guessing still costs 1 at the end of the ladder');
check(kg_guess($run, $dup, 'Furniture!') === 'correct' && $run['score'] === 5, 'and still wins');

// --- Show the answer -------------------------------------------------------------------------
$run = kg_new_run($p);
kg_pass($run, $p);
check(kg_give_up($run) === 'ended', 'show the answer ends the run');
$view = kg_view($p, $run);
check($view['ended'] === true && $view['score'] === null && $view['answer'] === 'Saturn', 'giving up reveals the answer and records no score');
check($view['visible'] === [true, false, true, false, false, true, false], 'the view still shows which words had been bought');
denied(function () use (&$run, $p) { kg_guess($run, $p, 'Saturn'); }, 409, 'an ended run cannot be resumed');
denied(function () use (&$run) { kg_name($run, 'ben'); }, 409, 'only a solver takes a place on the board');

// --- Reloading a stored run -------------------------------------------------------------------
$run = kg_new_run($p);
kg_pass($run, $p);
kg_guess($run, $p, 'mars');
$reloaded = kg_load_run(json_decode(json_encode($run), true), $p);
check($reloaded === $run, 'a run survives a round trip through the database');
check(kg_load_run(['rounds' => 'lots', 'tried' => ['mars', 5], 'steps' => 999], $p)['steps'] === 7, 'a damaged row degrades to something playable');

// --- The board -----------------------------------------------------------------------------------
$board = kg_board([
    ['name' => 'tomás', 'score' => 7, 'you' => false, 'author' => false],
    ['name' => 'ben', 'score' => 5, 'you' => true, 'author' => false],
    ['name' => 'mara', 'score' => 3, 'you' => false, 'author' => false],
    ['name' => 'Ana', 'score' => 5, 'you' => false, 'author' => false],
    ['name' => '', 'score' => 2, 'you' => false, 'author' => true],
]);
check(array_column($board, 'name') === ['mara', 'Ana', 'ben', 'tomás', 'anonymous'], 'lower is better, ties sort alphabetically, the author never ranks');
check(array_column($board, 'rank') === [1, 2, 2, 4, null], 'equal scores share a rank and the next rank skips');
check($board[2]['you'] === true, 'your own row is marked');

echo "$checks rules checks passed.\n";
