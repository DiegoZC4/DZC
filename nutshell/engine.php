<?php
declare(strict_types=1);

// Pure room rules. Time is supplied by the server, never by a player.
function nk_require(bool $ok, string $message, int $status = 400): void {
    if (!$ok) throw new DomainException($message, $status);
}
function nk_text(mixed $value, int $max, string $label): string {
    nk_require(is_string($value) && preg_match('//u', $value) === 1, "$label must be text.");
    $value = trim(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u', '', $value));
    nk_require(mb_strlen($value) <= $max, "$label is too long (maximum $max characters).");
    return $value;
}
function nk_words(string $question): array {
    return $question === '' ? [] : preg_split('/\s+/u', trim($question));
}
function nk_player(string $name): array {
    $name = nk_text($name, 24, 'Name');
    nk_require($name !== '', 'Enter your name.');
    $token = bin2hex(random_bytes(32));
    return [['id' => bin2hex(random_bytes(8)), 'name' => $name, 'secret' => hash('sha256', $token)], $token];
}
function nk_new(string $code, string $name, float $now): array {
    [$player, $token] = nk_player($name);
    return [[
        'code' => $code, 'version' => 1, 'players' => [$player], 'host' => $player['id'],
        'phase' => 'lobby', 'round' => 0, 'roles' => [], 'deadline' => null,
        'settings' => ['write' => 60, 'mask' => 30, 'guess' => 30],
        'durations' => ['write' => 60, 'mask' => 30, 'guess' => 30],
        'question' => '', 'answer' => '', 'words' => [], 'visible' => [], 'guess' => '',
        'outcome' => null, 'reason' => '', 'created' => $now,
    ], $token];
}
function nk_identity(array $room, string $token): string {
    nk_require(preg_match('/^[a-f0-9]{64}$/D', $token) === 1, 'Join this room first.', 401);
    foreach ($room['players'] as $player) {
        if (hash_equals($player['secret'], hash('sha256', $token))) return $player['id'];
    }
    throw new DomainException('Your seat is no longer in this room. Please join again.', 401);
}
function nk_role(array $room, string $id): string {
    return (string)(array_search($id, $room['roles'], true) ?: 'waiting');
}
function nk_finish(array &$room, string $reason, ?bool $outcome = null): void {
    $room['phase'] = 'reveal';
    $room['deadline'] = null;
    $room['reason'] = $reason;
    $room['outcome'] = $outcome;
}
function nk_advance(array &$room, float $at, bool $expired = false): void {
    if ($room['phase'] === 'write') {
        $words = nk_words($room['question']);
        if (count($words) < 2 || count($words) > 40 || $room['answer'] === '') {
            nk_finish($room, 'The writer ran out of time before finishing a question and answer.', false);
        } else {
            $room['words'] = $words;
            $room['visible'] = array_fill(0, count($words), false);
            $room['phase'] = 'mask';
            $room['deadline'] = $at + $room['durations']['mask'];
        }
    } elseif ($room['phase'] === 'mask') {
        if (!in_array(true, $room['visible'], true)) {
            nk_finish($room, 'The masker ran out of time without keeping any words.', false);
        } else {
            $room['phase'] = 'guess';
            $room['deadline'] = $at + $room['durations']['guess'];
        }
    } elseif ($room['phase'] === 'guess') {
        nk_finish($room, $expired ? 'Time’s up.' : 'Guess locked in.', $room['guess'] === '' ? false : null);
    }
    $room['version']++;
}
function nk_tick(array &$room, float $now): void {
    // A sleeping browser cannot extend a deadline. Catch up across all phases.
    for ($i = 0; $i < 3 && $room['deadline'] !== null && $now >= $room['deadline']; $i++) {
        nk_advance($room, (float)$room['deadline'], true);
    }
}
function nk_join(array &$room, string $name): array {
    nk_require(count($room['players']) < 3, 'This room already has three players.', 409);
    nk_require(in_array($room['phase'], ['lobby', 'reveal'], true), 'Wait until this round ends to join.', 409);
    [$player, $token] = nk_player($name);
    foreach ($room['players'] as $existing) {
        nk_require(mb_strtolower($existing['name']) !== mb_strtolower($player['name']), 'That name is already in the room. Try a nickname.', 409);
    }
    $room['players'][] = $player;
    $room['version']++;
    return [$player['id'], $token];
}
function nk_action(array &$room, string $id, string $action, array $body, float $now): void {
    $host = $room['host'] === $id;
    $role = nk_role($room, $id);
    if ($action === 'settings') {
        nk_require($host, 'Only the host can change the timers.', 403);
        $values = $body['settings'] ?? [];
        nk_require(is_array($values), 'Invalid timers.');
        foreach (['write', 'mask', 'guess'] as $phase) {
            $value = $values[$phase] ?? null;
            nk_require(is_int($value) && $value >= 5 && $value <= 300 && $value % 5 === 0, 'Timers must be 5–300 seconds, in steps of 5.');
            $room['settings'][$phase] = $value;
        }
    } elseif ($action === 'leave') {
        $room['players'] = array_values(array_filter($room['players'], fn($p) => $p['id'] !== $id));
        if ($host) $room['host'] = $room['players'][0]['id'] ?? '';
        if (in_array($room['phase'], ['write', 'mask', 'guess'], true)) nk_finish($room, 'A player left the room.', false);
    } else {
        nk_require(($body['round'] ?? null) === $room['round'] && ($body['phase'] ?? null) === $room['phase'], 'The phase changed. Your room is refreshing.', 409);
        if ($action === 'start') {
            nk_require($host || $role === 'write', 'The host or writer starts the next round.', 403);
            nk_require(in_array($room['phase'], ['lobby', 'reveal'], true), 'A round is already running.', 409);
            nk_require(count($room['players']) === 3, 'Three players need to join first.', 409);
            nk_require($room['phase'] === 'lobby' || $room['outcome'] !== null, 'Mark the guess correct or missed first.', 409);
            $offset = $room['round'] % 3;
            $room['roles'] = [];
            foreach (['write', 'mask', 'guess'] as $i => $phase) $room['roles'][$phase] = $room['players'][($offset + $i) % 3]['id'];
            $room['round']++;
            $room['phase'] = 'write';
            $room['durations'] = $room['settings'];
            $room['deadline'] = $now + $room['durations']['write'];
            $room['question'] = $room['answer'] = $room['guess'] = $room['reason'] = '';
            $room['words'] = $room['visible'] = [];
            $room['outcome'] = null;
        } elseif ($action === 'draft' || $action === 'submit') {
            nk_require($role === $room['phase'] && in_array($role, ['write', 'mask', 'guess'], true), 'It is another player’s turn.', 403);
            if ($role === 'write') {
                $room['question'] = nk_text($body['question'] ?? '', 400, 'Question');
                $room['answer'] = nk_text($body['answer'] ?? '', 200, 'Answer');
                nk_require(count(nk_words($room['question'])) <= 40, 'Keep the question to 40 words or fewer.');
                if ($action === 'submit') nk_require(count(nk_words($room['question'])) >= 2 && $room['answer'] !== '', 'Write a question (at least two words) and an answer.');
            } elseif ($role === 'mask') {
                $visible = $body['visible'] ?? null;
                // PHP 8.0-compatible list check; array_is_list was added in 8.1.
                nk_require(is_array($visible) && array_values($visible) === $visible && count($visible) === count($room['words']), 'Invalid word selection.');
                foreach ($visible as $flag) nk_require(is_bool($flag), 'Invalid word selection.');
                $room['visible'] = $visible;
                if ($action === 'submit') nk_require(in_array(true, $visible, true), 'Keep at least one word visible.');
            } else {
                $room['guess'] = nk_text($body['guess'] ?? '', 200, 'Guess');
                if ($action === 'submit') nk_require($room['guess'] !== '', 'Enter a guess first.');
            }
            if ($action === 'submit') nk_advance($room, $now);
        } elseif ($action === 'judge') {
            nk_require($room['phase'] === 'reveal' && ($host || $role === 'write'), 'Only the writer or host can mark the answer.', 403);
            nk_require(is_bool($body['correct'] ?? null), 'Choose correct or missed.');
            $room['outcome'] = $body['correct'];
        } else throw new DomainException('Unknown action.', 400);
    }
    $room['version']++;
}
function nk_view(array $room, string $id, float $now): array {
    $phase = $room['phase'];
    $role = nk_role($room, $id);
    $full = $phase === 'reveal' || (in_array($phase, ['mask', 'guess'], true) && in_array($role, ['write', 'mask'], true));
    $words = [];
    if ($full) $words = $room['words'];
    elseif ($phase === 'guess') foreach ($room['words'] as $i => $word) $words[] = $room['visible'][$i] ? $word : null;
    $view = [
        'code' => $room['code'], 'version' => $room['version'], 'you' => $id,
        'players' => array_map(fn($p) => ['id' => $p['id'], 'name' => $p['name']], $room['players']),
        'host' => $room['host'], 'role' => $role, 'roles' => $room['roles'],
        'phase' => $phase, 'round' => $room['round'], 'deadline' => $room['deadline'],
        'settings' => $room['settings'], 'durations' => $room['durations'], 'serverTime' => $now,
        'words' => $words, 'visible' => $full || $phase === 'guess' ? $room['visible'] : [],
        'outcome' => $phase === 'reveal' ? $room['outcome'] : null,
        'reason' => $phase === 'reveal' ? $room['reason'] : '',
    ];
    if ($full || ($phase === 'write' && $role === 'write')) {
        $view['question'] = $room['question'];
        $view['answer'] = $room['answer'];
    }
    if ($phase === 'reveal' || ($phase === 'guess' && $role === 'guess')) $view['guess'] = $room['guess'];
    return $view;
}
