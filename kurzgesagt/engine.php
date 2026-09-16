<?php
declare(strict_types=1);

// Pure puzzle rules. No database, no clock, no HTTP. Everything here is a function of
// its arguments so tools/test_kurzgesagt.php can drive the whole game without a server.
//
// PHP 8.0 target (production is 8.0.30 on LiteSpeed, this laptop is newer): no enums,
// no readonly, no never, no array_is_list(), no json_validate(), no first-class callable
// syntax, no new in initializers, no string-keyed array unpacking.

function kg_require(bool $ok, string $message, int $status = 400): void {
    if (!$ok) throw new DomainException($message, $status);
}
function kg_text(mixed $value, int $max, string $label): string {
    kg_require(is_string($value) && preg_match('//u', $value) === 1, "$label must be text.");
    $value = trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u', '', $value));
    kg_require(mb_strlen($value) <= $max, "$label is too long (maximum $max characters).");
    return $value;
}
function kg_words(string $question): array {
    $question = trim($question);
    return $question === '' ? [] : preg_split('/\s+/u', $question);
}

// --- Answer normalisation -------------------------------------------------------------
// ext-intl is not guaranteed on the host, so Normalizer is feature-detected and a plain
// substitution table covers the Latin range either way. Characters that NFD never
// decomposes (ø, æ, ß, œ, ð, þ) are handled by the table in both paths, so the two
// code paths agree on every letter this game is likely to meet.
function kg_fold_table(): array {
    // Expects casefolded input; only lowercase keys are listed.
    static $table = null;
    if ($table === null) $table = [
        'à' => 'a', 'á' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'ā' => 'a', 'ă' => 'a', 'ą' => 'a', 'æ' => 'ae',
        'ç' => 'c', 'ć' => 'c', 'ĉ' => 'c', 'ċ' => 'c', 'č' => 'c', 'ď' => 'd', 'đ' => 'd', 'ð' => 'd',
        'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e', 'ē' => 'e', 'ĕ' => 'e', 'ė' => 'e', 'ę' => 'e', 'ě' => 'e',
        'ĝ' => 'g', 'ğ' => 'g', 'ġ' => 'g', 'ģ' => 'g', 'ĥ' => 'h', 'ħ' => 'h',
        'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ĩ' => 'i', 'ī' => 'i', 'ĭ' => 'i', 'į' => 'i', 'ı' => 'i',
        'ĵ' => 'j', 'ķ' => 'k', 'ĺ' => 'l', 'ļ' => 'l', 'ľ' => 'l', 'ł' => 'l',
        'ñ' => 'n', 'ń' => 'n', 'ņ' => 'n', 'ň' => 'n', 'ŉ' => 'n',
        'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o', 'ø' => 'o', 'ō' => 'o', 'ŏ' => 'o', 'ő' => 'o', 'œ' => 'oe',
        'ŕ' => 'r', 'ŗ' => 'r', 'ř' => 'r', 'ś' => 's', 'ŝ' => 's', 'ş' => 's', 'š' => 's', 'ș' => 's', 'ß' => 'ss',
        'ţ' => 't', 'ť' => 't', 'ŧ' => 't', 'ț' => 't', 'þ' => 'th',
        'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'ũ' => 'u', 'ū' => 'u', 'ŭ' => 'u', 'ů' => 'u', 'ű' => 'u', 'ų' => 'u',
        'ŵ' => 'w', 'ý' => 'y', 'ÿ' => 'y', 'ŷ' => 'y', 'ź' => 'z', 'ż' => 'z', 'ž' => 'z',
    ];
    return $table;
}
function kg_strip_accents(string $value, ?bool $intl = null): string {
    if ($intl === null) $intl = class_exists('Normalizer');
    if ($intl && class_exists('Normalizer')) {
        $decomposed = Normalizer::normalize($value, Normalizer::FORM_D);
        if (is_string($decomposed)) $value = preg_replace('/\p{Mn}+/u', '', $decomposed);
    }
    return strtr($value, kg_fold_table());
}
function kg_normalize(string $value, ?bool $intl = null): string {
    if (preg_match('//u', $value) !== 1) return '';
    $value = kg_strip_accents(mb_strtolower(trim($value), 'UTF-8'), $intl);
    // Apostrophes close up ("dog's" -> "dogs"); every other mark becomes a space so
    // "well-known" stays two words.
    $value = preg_replace('/[\'\x{2018}\x{2019}\x{02BC}\x{0060}\x{00B4}]+/u', '', $value);
    $value = preg_replace('/[^\p{L}\p{N}\s]+/u', ' ', $value);
    return trim(preg_replace('/\s+/u', ' ', $value));
}
// "Saturn|the ringed one" accepts either. Only the first alternative is ever shown.
function kg_alternatives(string $answer): array {
    $out = [];
    foreach (explode('|', $answer) as $part) {
        $normalized = kg_normalize($part);
        if ($normalized !== '' && !in_array($normalized, $out, true)) $out[] = $normalized;
    }
    return $out;
}
function kg_answer_shown(string $answer): string {
    $parts = explode('|', $answer);
    return trim($parts[0]);
}
function kg_matches(string $guess, string $answer): bool {
    $normalized = kg_normalize($guess);
    return $normalized !== '' && in_array($normalized, kg_alternatives($answer), true);
}

// --- Writing --------------------------------------------------------------------------
function kg_draft(mixed $question, mixed $answer): array {
    $question = kg_text($question, 400, 'Question');
    $answer = kg_text($answer, 200, 'Answer');
    $words = kg_words($question);
    kg_require(count($words) >= 2, 'Write a question of at least two words.');
    kg_require(count($words) <= 40, 'Keep the question to 40 words or fewer.');
    $alternatives = kg_alternatives($answer);
    kg_require(count($alternatives) > 0, 'Write an answer.');
    // Without this an answer of "?" normalises to nothing useful and any punctuation wins.
    foreach ($alternatives as $alternative) {
        kg_require(mb_strlen($alternative) >= 2, 'Every answer needs at least two letters or digits.');
    }
    return ['question' => $question, 'answer' => $answer, 'words' => $words];
}

// --- Reveal order ---------------------------------------------------------------------
// The masker clicks the words to uncover first. Everything unclicked follows in sentence
// order, so Publish works after zero clicks. Words that give the answer away are pushed to
// the very end, silently, whatever the masker clicked.
function kg_spoiler(string $word, array $alternatives): bool {
    $normalized = kg_normalize($word);
    if ($normalized === '') return false;
    foreach ($alternatives as $alternative) {
        if (in_array($normalized, explode(' ', $alternative), true)) return true;
    }
    return false;
}
function kg_order(array $words, mixed $clicked, string $answer): array {
    $count = count($words);
    kg_require($count >= 2, 'A puzzle needs at least two words.');
    // PHP 8.0-compatible list check; array_is_list() was added in 8.1.
    kg_require(is_array($clicked) && array_values($clicked) === $clicked, 'Invalid reveal order.');
    kg_require(count($clicked) <= $count, 'Invalid reveal order.');
    $order = [];
    foreach ($clicked as $index) {
        kg_require(is_int($index) && $index >= 0 && $index < $count, 'Invalid reveal order.');
        kg_require(!in_array($index, $order, true), 'A word can only be placed once.');
        $order[] = $index;
    }
    for ($i = 0; $i < $count; $i++) if (!in_array($i, $order, true)) $order[] = $i;
    $alternatives = kg_alternatives($answer);
    $keep = [];
    $last = [];
    foreach ($order as $index) {
        if (kg_spoiler($words[$index], $alternatives)) $last[] = $index;
        else $keep[] = $index;
    }
    return array_merge($keep, $last);
}
function kg_is_order(mixed $order, int $count): bool {
    if (!is_array($order) || array_values($order) !== $order || count($order) !== $count) return false;
    $seen = [];
    foreach ($order as $index) {
        if (!is_int($index) || $index < 0 || $index >= $count || isset($seen[$index])) return false;
        $seen[$index] = true;
    }
    return true;
}

// --- Uncovering -------------------------------------------------------------------------
// Uncovering a word uncovers every position holding the same word, so nobody pays twice
// for "the". Words that normalise to nothing (stray punctuation) stay tied to their index.
function kg_word_key(array $words, int $index): string {
    $key = kg_normalize($words[$index]);
    return $key === '' ? "\0" . $index : $key;
}
function kg_visible(array $words, array $order, int $steps): array {
    $count = count($words);
    $visible = array_fill(0, $count, false);
    $steps = max(0, min($steps, count($order)));
    $shown = [];
    for ($i = 0; $i < $steps; $i++) $shown[kg_word_key($words, $order[$i])] = true;
    for ($i = 0; $i < $count; $i++) if (isset($shown[kg_word_key($words, $i)])) $visible[$i] = true;
    return $visible;
}
function kg_round_zero(int $count): int {
    return max(1, (int)ceil($count / 4));
}
function kg_next_steps(array $words, array $order, int $steps): int {
    $total = count($order);
    $visible = kg_visible($words, $order, $steps);
    while ($steps < $total && $visible[$order[$steps]]) $steps++; // already uncovered as a duplicate
    if ($steps < $total) $steps++;
    return $steps;
}
function kg_complete(array $words, array $order, int $steps): bool {
    return !in_array(false, kg_visible($words, $order, $steps), true);
}

// --- Runs (one per player, per puzzle) ---------------------------------------------------
function kg_new_run(array $puzzle): array {
    return [
        'rounds' => 0, 'steps' => kg_round_zero(count($puzzle['words'])), 'tried' => [],
        'guesses' => [], 'solved' => false, 'ended' => false, 'score' => null, 'name' => '',
    ];
}
function kg_load_run(mixed $stored, array $puzzle): array {
    $run = kg_new_run($puzzle);
    if (!is_array($stored)) return $run;
    foreach (['rounds', 'steps'] as $key) if (isset($stored[$key]) && is_int($stored[$key])) $run[$key] = max(0, $stored[$key]);
    foreach (['tried', 'guesses'] as $key) {
        if (isset($stored[$key]) && is_array($stored[$key]) && array_values($stored[$key]) === $stored[$key]) {
            $run[$key] = array_values(array_filter($stored[$key], 'is_string'));
        }
    }
    foreach (['solved', 'ended'] as $key) if (isset($stored[$key])) $run[$key] = (bool)$stored[$key];
    if (isset($stored['score']) && is_int($stored['score'])) $run['score'] = $stored['score'];
    if (isset($stored['name']) && is_string($stored['name'])) $run['name'] = $stored['name'];
    $run['steps'] = min($run['steps'], count($puzzle['words']));
    return $run;
}
function kg_open(array $run): bool {
    return $run['solved'] || $run['ended'];
}
function kg_pass(array &$run, array $puzzle): string {
    kg_require(!kg_open($run), 'This run is already finished.', 409);
    kg_require(!kg_complete($puzzle['words'], $puzzle['order'], $run['steps']), 'Everything is already showing.', 409);
    $run['rounds']++;
    $run['steps'] = kg_next_steps($puzzle['words'], $puzzle['order'], $run['steps']);
    return 'pass';
}
// A repeat of an already-tried guess is free and refused. A wrong guess costs a round and
// uncovers nothing at all.
function kg_guess(array &$run, array $puzzle, mixed $guess): string {
    kg_require(!kg_open($run), 'This run is already finished.', 409);
    $text = kg_text($guess, 200, 'Guess');
    $normalized = kg_normalize($text);
    kg_require($normalized !== '', 'Type a guess first.');
    if (in_array($normalized, $run['tried'], true)) return 'repeat';
    $run['rounds']++;
    $run['tried'][] = $normalized;
    $run['guesses'][] = $text;
    if (in_array($normalized, kg_alternatives($puzzle['answer']), true)) {
        $run['solved'] = true;
        $run['score'] = $run['rounds'];
        return 'correct';
    }
    return 'wrong';
}
function kg_give_up(array &$run): string {
    kg_require(!kg_open($run), 'This run is already finished.', 409);
    $run['ended'] = true;
    return 'ended';
}
function kg_name(array &$run, mixed $name): void {
    kg_require($run['solved'], 'Solve it first.', 409);
    $run['name'] = kg_text($name, 24, 'Name');
}

// --- The one view a player is allowed to see ---------------------------------------------
// An uncovered word is a string. A covered word is literal null: never the word, never a
// placeholder whose length gives the word away. The answer, the full question and the
// reveal order are absent until the player has solved it or given up.
function kg_view(array $puzzle, ?array $run): array {
    $words = $puzzle['words'];
    $order = $puzzle['order'];
    $run = $run === null ? kg_new_run($puzzle) : $run;
    $open = kg_open($run);
    $visible = kg_visible($words, $order, $run['steps']);
    $shown = [];
    foreach ($words as $index => $word) $shown[] = ($open || $visible[$index]) ? $word : null;
    $hidden = 0;
    foreach ($shown as $word) if ($word === null) $hidden++;
    $view = [
        'id' => $puzzle['id'],
        'words' => $shown,
        'visible' => $visible,
        'total' => count($words),
        'hidden' => $hidden,
        'free' => kg_round_zero(count($words)),
        'rounds' => $run['rounds'],
        'complete' => kg_complete($words, $order, $run['steps']),
        'solved' => $run['solved'],
        'ended' => $run['ended'],
        'score' => $run['score'],
        'tried' => $run['guesses'],
        'name' => $run['name'],
        'created' => $puzzle['created'],
    ];
    if ($open) {
        $view['question'] = implode(' ', $words);
        $view['answer'] = kg_answer_shown($puzzle['answer']);
    }
    return $view;
}

// Lower is better. Equal scores share a rank and sort alphabetically; no clock tiebreak,
// because everybody plays whenever they feel like it. The publisher never takes a rank.
function kg_board(array $rows): array {
    $ranked = [];
    $authors = [];
    foreach ($rows as $row) {
        $row['name'] = isset($row['name']) && is_string($row['name']) && trim($row['name']) !== '' ? trim($row['name']) : 'anonymous';
        $row['you'] = !empty($row['you']);
        $row['author'] = !empty($row['author']);
        $row['rank'] = null;
        if ($row['author']) $authors[] = $row;
        else $ranked[] = $row;
    }
    usort($ranked, function (array $a, array $b): int {
        if ($a['score'] !== $b['score']) return $a['score'] <=> $b['score'];
        return strcmp(mb_strtolower($a['name'], 'UTF-8'), mb_strtolower($b['name'], 'UTF-8'));
    });
    $rank = 0;
    $previous = null;
    foreach ($ranked as $index => $row) {
        if ($previous === null || $row['score'] !== $previous) {
            $rank = $index + 1;
            $previous = $row['score'];
        }
        $ranked[$index]['rank'] = $rank;
    }
    return array_merge($ranked, $authors);
}
