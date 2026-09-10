<?php
declare(strict_types=1);

function hex_key(array $h): string { return $h['q'] . ',' . $h['r']; }
function hex_offset(int $column, int $row): array { return ['q' => $column - (int)floor($row / 2), 'r' => $row]; }
function hex_mirror(array $cell, int $columns): array { return ['q' => $columns - 1 - $cell['r'] - $cell['q'], 'r' => $cell['r']]; }
function hex_distance(array $a, array $b): int { return (int)((abs($a['q'] - $b['q']) + abs($a['r'] - $b['r']) + abs($a['q'] + $a['r'] - $b['q'] - $b['r'])) / 2); }
function hex_center(array $h): array { return ['x' => $h['q'] + $h['r'] / 2 + .5, 'y' => $h['r'] * sqrt(3) / 2 + 1 / sqrt(3)]; }
function player_key(array $p): string { return $p['team'] . ':' . $p['index']; }
function player_label(array $p): string { return ($p['team'] === 0 ? 'C' : 'O') . ($p['index'] + 1); }
function valid_integer($value, int $min, int $max): bool { return (is_int($value) || is_float($value)) && is_finite((float)$value) && floor((float)$value) === (float)$value && $value >= $min && $value <= $max; }

final class HexGrid {
    public array $cells = [];
    public array $blocked = [];
    public array $outOfBounds = [];
    private array $lookup = [];
    private array $polygons = [];
    private array $sight = [];
    private const DIRECTIONS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

    public function __construct(int $columns, int $rows, array $obstacles, array $outOfBounds = [], int $left = 0, int $top = 0) {
        for ($r = $top; $r < $top + $rows; $r++) for ($c = $left; $c < $left + $columns - (($r % 2 + 2) % 2); $c++) {
            $h = hex_offset($c, $r);
            $this->cells[] = $h;
            $this->lookup[hex_key($h)] = true;
        }
        foreach ($outOfBounds as $h) {
            if (!$this->contains($h)) throw new InvalidArgumentException('Out-of-bounds tiles must be inside the editor canvas.');
            $this->outOfBounds[hex_key($h)] = true;
        }
        $this->cells = array_values(array_filter($this->cells, fn($h) => !isset($this->outOfBounds[hex_key($h)])));
        foreach ($obstacles as $h) {
            if (!$this->has($h)) throw new InvalidArgumentException('Obstacle tiles must be inside the board.');
            $key = hex_key($h);
            $this->blocked[$key] = true;
            $center = hex_center($h);
            $polygon = [];
            for ($i = 0; $i < 6; $i++) {
                $angle = -M_PI / 2 + $i * M_PI / 3;
                $polygon[] = ['x' => $center['x'] + cos($angle) / sqrt(3), 'y' => $center['y'] + sin($angle) / sqrt(3)];
            }
            $this->polygons[$key] = $polygon;
        }
    }
    public function contains($h): bool {
        return is_array($h) && valid_integer($h['q'] ?? null, -2000, 2000) && valid_integer($h['r'] ?? null, -1000, 1040) && isset($this->lookup[hex_key($h)]);
    }
    public function has($h): bool { return $this->contains($h) && !isset($this->outOfBounds[hex_key($h)]); }
    public function open(array $h): bool { return $this->has($h) && !isset($this->blocked[hex_key($h)]); }
    private function neighbors(array $h): array {
        $neighbors = [];
        foreach (self::DIRECTIONS as [$q, $r]) {
            $next = ['q' => $h['q'] + $q, 'r' => $h['r'] + $r];
            if ($this->open($next)) $neighbors[] = $next;
        }
        return $neighbors;
    }
    private static function cross(array $a, array $b, array $c): float { return ($b['x'] - $a['x']) * ($c['y'] - $a['y']) - ($b['y'] - $a['y']) * ($c['x'] - $a['x']); }
    private static function segmentDistance(array $p, array $a, array $b): float {
        $dx = $b['x'] - $a['x']; $dy = $b['y'] - $a['y'];
        $t = max(0, min(1, (($p['x'] - $a['x']) * $dx + ($p['y'] - $a['y']) * $dy) / (($dx * $dx + $dy * $dy) ?: 1)));
        return hypot($p['x'] - $a['x'] - $dx * $t, $p['y'] - $a['y'] - $dy * $t);
    }
    private static function segmentsIntersect(array $a, array $b, array $c, array $d): bool {
        $abc = self::cross($a, $b, $c); $abd = self::cross($a, $b, $d); $cda = self::cross($c, $d, $a); $cdb = self::cross($c, $d, $b);
        return ($abc * $abd < 0 && $cda * $cdb < 0)
            || (abs($abc) < 1e-8 && self::segmentDistance($c, $a, $b) < 1e-7)
            || (abs($abd) < 1e-8 && self::segmentDistance($d, $a, $b) < 1e-7)
            || (abs($cda) < 1e-8 && self::segmentDistance($a, $c, $d) < 1e-7)
            || (abs($cdb) < 1e-8 && self::segmentDistance($b, $c, $d) < 1e-7);
    }
    private static function inside(array $p, array $polygon): bool {
        $inside = false;
        for ($i = 0, $j = count($polygon) - 1; $i < count($polygon); $j = $i++) {
            $a = $polygon[$i]; $b = $polygon[$j];
            if (self::segmentDistance($p, $a, $b) < 1e-8) return true;
            if (($a['y'] > $p['y']) !== ($b['y'] > $p['y']) && $p['x'] < ($b['x'] - $a['x']) * ($p['y'] - $a['y']) / ($b['y'] - $a['y']) + $a['x']) $inside = !$inside;
        }
        return $inside;
    }
    public function clearSight(array $a, array $b, bool $revealWall = false): bool {
        $start = hex_center($a); $end = hex_center($b);
        foreach ($this->polygons as $key => $polygon) {
            if ($revealWall && $key === hex_key($b)) continue;
            if (self::inside($start, $polygon) || self::inside($end, $polygon)) return false;
            for ($i = 0; $i < 6; $i++) if (self::segmentsIntersect($start, $end, $polygon[$i], $polygon[($i + 1) % 6])) return false;
        }
        return true;
    }
    public function visible(array $start, int $peekRadius = 0): array {
        $key = hex_key($start) . ':' . $peekRadius;
        if (isset($this->sight[$key])) return $this->sight[$key];
        $views = array_filter($this->cells, fn($cell) => hex_distance($start, $cell) <= $peekRadius && $this->open($cell) && $this->clearSight($start, $cell));
        $visible = [];
        foreach ($this->cells as $cell) foreach ($views as $view) if ($this->clearSight($view, $cell, true)) { $visible[hex_key($cell)] = true; break; }
        return $this->sight[$key] = $visible;
    }
    public function path(array $start, array $goal, int $limit): ?array {
        if (!$this->open($start) || !$this->open($goal)) return null;
        if ($start === $goal) return [];
        $queue = [$start]; $previous = [hex_key($start) => null]; $lengths = [hex_key($start) => 0];
        for ($i = 0; $i < count($queue); $i++) {
            $current = $queue[$i]; $length = $lengths[hex_key($current)];
            if ($length >= $limit) continue;
            foreach ($this->neighbors($current) as $next) {
                $key = hex_key($next);
                if (array_key_exists($key, $previous)) continue;
                $previous[$key] = $current; $lengths[$key] = $length + 1;
                if ($next === $goal) {
                    $path = [$next]; $cursor = $current;
                    while ($cursor !== $start) { array_unshift($path, $cursor); $cursor = $previous[hex_key($cursor)]; }
                    return $path;
                }
                $queue[] = $next;
            }
        }
        return null;
    }
}

final class HexGame {
    public array $state;
    public HexGrid $grid;

    public static function validateSetup($setup): array {
        if (!is_array($setup) || !in_array($setup['version'] ?? null, [1, 2, 3, 4, 5], true) || !is_array($setup['config'] ?? null) || !is_array($setup['obstacles'] ?? null) || count($setup['obstacles']) > 2080 || !is_array($setup['roles'] ?? null) || count($setup['roles']) !== 2 || !is_array($setup['carriers'] ?? null) || count($setup['carriers']) !== 2) throw new InvalidArgumentException('Invalid board setup.');
        $config = [];
        foreach (['columns' => $setup['version'] >= 4 ? [1, 52] : [9, 26], 'rows' => $setup['version'] >= 4 ? [1, 40] : [7, 21], 'playersPerTeam' => [1, 10], 'turnDuration' => [1, 30], 'freezeRounds' => [0, 12], 'peekDiameter' => [0, 6]] as $key => [$lo, $hi]) {
            if (!valid_integer($setup['config'][$key] ?? null, $lo, $hi)) throw new InvalidArgumentException('Invalid ' . $key . '.');
            $config[$key] = (int)$setup['config'][$key];
        }
        if ($setup['version'] < 5) {
            if (!valid_integer($setup['config']['goalDiameter'] ?? null, 1, 7)) throw new InvalidArgumentException('Invalid goalDiameter.');
            $config['goalDiameter'] = (int)$setup['config']['goalDiameter'];
        }
        if ($setup['version'] >= 4) foreach (['left', 'top'] as $name) {
            if (!valid_integer($setup['config'][$name] ?? null, -1000, 1000)) throw new InvalidArgumentException('Invalid board origin.');
            $config[$name] = (int)$setup['config'][$name];
        }
        $explicit = $setup['version'] >= 3;
        if ($explicit && (!is_array($setup['outOfBounds'] ?? null) || count($setup['outOfBounds']) > 2080 || !is_array($setup['positions'] ?? null) || count($setup['positions']) !== 2)) throw new InvalidArgumentException('Invalid board terrain or player positions.');
        $grid = new HexGrid($config['columns'], $config['rows'], $setup['obstacles'], $explicit ? $setup['outOfBounds'] : [], $config['left'] ?? 0, $config['top'] ?? 0);
        $obstacles = array_values(array_filter($grid->cells, fn($h) => isset($grid->blocked[hex_key($h)])));
        if ($setup['version'] >= 2) foreach ($obstacles as $cell) {
            if (!isset($grid->blocked[hex_key(hex_mirror($cell, $config['columns'] + 2 * ($config['left'] ?? 0)))])) throw new InvalidArgumentException('Board obstacles must mirror left to right.');
        }
        if ($explicit) foreach ($setup['outOfBounds'] as $cell) {
            if (!isset($grid->outOfBounds[hex_key(hex_mirror($cell, $config['columns'] + 2 * ($config['left'] ?? 0)))])) throw new InvalidArgumentException('Board terrain must mirror left to right.');
        }
        $endzones = [[], []];
        if ($setup['version'] >= 5) {
            if (!is_array($setup['endzones'] ?? null) || array_values($setup['endzones']) !== $setup['endzones'] || count($setup['endzones']) !== 2) throw new InvalidArgumentException('Invalid endzone tiles.');
            foreach ([0, 1] as $team) {
                $zone = $setup['endzones'][$team]; $seen = [];
                if (!is_array($zone) || array_values($zone) !== $zone || count($zone) > 2080) throw new InvalidArgumentException('Invalid endzone tiles.');
                foreach ($zone as $cell) {
                    if (!is_array($cell) || !valid_integer($cell['q'] ?? null, -2000, 2000) || !valid_integer($cell['r'] ?? null, -2000, 2000) || isset($seen[hex_key($cell)])) throw new InvalidArgumentException('Invalid endzone tiles.');
                    $seen[hex_key($cell)] = true; $endzones[$team][] = ['q' => (int)$cell['q'], 'r' => (int)$cell['r']];
                }
            }
        }
        $roles = []; $carriers = [];
        $positions = [[], []]; $occupied = [];
        foreach ([0, 1] as $team) {
            $list = $setup['roles'][$team] ?? null;
            if (!is_array($list) || count($list) !== $config['playersPerTeam']) throw new InvalidArgumentException('Place the same number of players on both teams (1–10 each) before playing.');
            foreach ($list as $role) if (!in_array($role, ['standard', 'seer', 'medic', 'samurai'], true)) throw new InvalidArgumentException('Invalid role.');
            if (!valid_integer($setup['carriers'][$team] ?? null, 0, $config['playersPerTeam'] - 1)) throw new InvalidArgumentException('Invalid flag carrier.');
            $roles[] = array_values($list); $carriers[] = (int)$setup['carriers'][$team];
            if ($explicit) {
                $cells = $setup['positions'][$team] ?? null;
                if (!is_array($cells) || count($cells) !== count($list)) throw new InvalidArgumentException('Every piece needs a starting tile.');
                foreach ($cells as $cell) {
                    if (!$grid->has($cell) || !$grid->open($cell)) throw new InvalidArgumentException('Place players on empty field tiles.');
                    if (isset($occupied[hex_key($cell)])) throw new InvalidArgumentException('Place only one player on each starting tile.');
                    $occupied[hex_key($cell)] = true;
                    $positions[$team][] = ['q' => (int)$cell['q'], 'r' => (int)$cell['r']];
                }
            }
        }
        $result = ['version' => $setup['version'], 'config' => $config, 'obstacles' => $obstacles, 'roles' => $roles, 'carriers' => $carriers];
        if ($explicit) {
            $canvas = new HexGrid($config['columns'], $config['rows'], [], [], $config['left'] ?? 0, $config['top'] ?? 0);
            $result['outOfBounds'] = array_values(array_filter($canvas->cells, fn($h) => isset($grid->outOfBounds[hex_key($h)])));
            $result['positions'] = $positions;
        }
        if ($setup['version'] >= 5) {
            $result['endzones'] = $endzones;
            $issues = self::mapIssues($result, $grid);
            if ($issues) throw new InvalidArgumentException($issues[0]['message']);
        }
        return $result;
    }
    public static function connectedRegions(array $cells): array {
        $remaining = []; $regions = [];
        foreach ($cells as $cell) $remaining[hex_key($cell)] = $cell;
        while ($remaining) {
            $first = reset($remaining); $region = [$first]; unset($remaining[hex_key($first)]);
            for ($i = 0; $i < count($region); $i++) foreach ([[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as [$q, $r]) {
                $key = hex_key(['q' => $region[$i]['q'] + $q, 'r' => $region[$i]['r'] + $r]);
                if (isset($remaining[$key])) { $region[] = $remaining[$key]; unset($remaining[$key]); }
            }
            $regions[] = $region;
        }
        usort($regions, fn($a, $b) => count($b) <=> count($a));
        return $regions;
    }
    public static function mapIssues(array $setup, HexGrid $grid): array {
        $zones = $setup['endzones']; $issues = [];
        $keys = array_map(fn($zone) => array_fill_keys(array_map('hex_key', $zone), true), $zones);
        $add = function(string $id, string $message, array $cells = []) use (&$issues) { $issues[] = ['id' => $id, 'message' => $message, 'cells' => array_values($cells)]; };
        foreach ([0, 1] as $team) {
            $name = ['Cyan', 'Orange'][$team]; $zone = $zones[$team]; $count = count($setup['roles'][$team]);
            if (!$zone) $add("missing-endzone-$team", "$name endzone is missing. Paint it with 3.");
            else {
                if (count($zone) < max(1, $count)) $add("small-endzone-$team", "$name endzone has " . count($zone) . ' tiles; needs at least ' . max(1, $count) . '.', $zone);
                $blocked = array_filter($zone, fn($cell) => !$grid->open($cell));
                if ($blocked) $add("blocked-endzone-$team", "$name endzone includes blocked or off-board tiles.", $blocked);
                if (count(self::connectedRegions($zone)) > 1) $add("split-endzone-$team", "$name endzone must be one connected region.", $zone);
            }
            if (!$count) $add("empty-team-$team", "Place at least one $name player.");
            $positions = $setup['positions'][$team];
            $invalid = array_filter($positions, fn($cell) => !$grid->open($cell));
            if ($invalid) $add("invalid-start-$team", "$name players must start on open tiles.", $invalid);
            $outside = array_filter($positions, fn($cell) => $grid->open($cell) && !isset($keys[$team][hex_key($cell)]));
            if ($zone && $outside) $add("outside-endzone-$team", count($outside) . " $name player" . (count($outside) === 1 ? '' : 's') . ' outside their endzone.', $outside);
        }
        if (count($setup['roles'][0]) !== count($setup['roles'][1])) $add('unequal-teams', 'Teams must have the same number of players.');
        $overlap = array_filter($zones[0], fn($cell) => isset($keys[1][hex_key($cell)]));
        if ($overlap) $add('overlapping-endzones', 'Endzones overlap. Keep them off the vertical symmetry line.', $overlap);
        $asymmetric = []; $width = $setup['config']['columns'] + 2 * $setup['config']['left'];
        foreach ([0, 1] as $team) foreach ($zones[$team] as $cell) if (!isset($keys[1 - $team][hex_key(hex_mirror($cell, $width))])) $asymmetric[] = $cell;
        if ($asymmetric) $add('asymmetric-endzones', 'Endzones must mirror left to right.', $asymmetric);
        $occupied = []; $duplicates = [];
        foreach (array_merge(...$setup['positions']) as $cell) { $key = hex_key($cell); if (isset($occupied[$key])) $duplicates[] = $cell; else $occupied[$key] = true; }
        if ($duplicates) $add('overlapping-starts', 'Starting players share a tile.', $duplicates);
        $regions = self::connectedRegions(array_values(array_filter($grid->cells, fn($cell) => $grid->open($cell))));
        if (!$regions) $add('no-field', 'The map has no open field tiles.');
        elseif (count($regions) > 1) $add('disconnected-field', 'Field splits into ' . count($regions) . ' unreachable regions. Every open tile must connect.', array_merge(...array_slice($regions, 1)));
        return $issues;
    }
    public function __construct(array $setup, ?array $state = null) {
        $setup = self::validateSetup($setup); $c = $setup['config'];
        $this->grid = new HexGrid($c['columns'], $c['rows'], $setup['obstacles'], $setup['outOfBounds'] ?? [], $c['left'] ?? 0, $c['top'] ?? 0);
        if ($state !== null) { $this->state = $state; return; }
        $this->state = ['setup' => $setup, 'players' => [], 'flags' => [], 'turn' => 0, 'time' => 0, 'turnEndsAt' => $c['turnDuration'], 'winner' => null, 'knowledge' => [['players' => [], 'flags' => []], ['players' => [], 'flags' => []]], 'visibility' => [[], []], 'observation' => ['awake', 'sleep'], 'events' => [[], []]];
        foreach ([0, 1] as $team) for ($index = 0; $index < $c['playersPerTeam']; $index++) {
            $row = (int)round(($index + 1) * ($c['rows'] - 1) / ($c['playersPerTeam'] + 1));
            $desired = hex_offset($team === 0 ? 1 : $c['columns'] - 2 - $row % 2, $row);
            $occupied = array_column(array_map(fn($p) => [hex_key($p['cell']), true], $this->state['players']), 1, 0);
            $candidates = isset($setup['positions']) ? [$setup['positions'][$team][$index]] : array_values(array_filter($this->grid->cells, function($cell) use ($team, $c, $setup, $occupied) {
                $column = $cell['q'] + (int)floor($cell['r'] / 2);
                $relative = $team === 0 ? $cell : hex_mirror($cell, $c['columns']);
                $inStart = $setup['version'] === 1 ? ($team === 0 ? $column < 3 : $column >= $c['columns'] - 4) : $relative['q'] + (int)floor($relative['r'] / 2) < 3;
                return $this->grid->open($cell) && $inStart && !isset($occupied[hex_key($cell)]);
            }));
            usort($candidates, fn($a, $b) => (hex_distance($a, $desired) <=> hex_distance($b, $desired)) ?: (($a['r'] <=> $b['r']) ?: ($a['q'] <=> $b['q'])));
            if (!$candidates) throw new InvalidArgumentException('Leave enough open starting tiles for both teams.');
            $role = $setup['roles'][$team][$index];
            $this->state['players'][] = ['team' => $team, 'index' => $index, 'cell' => $candidates[0], 'role' => $role, 'frozen' => 0, 'carrying' => $setup['carriers'][$team] === $index ? $team : null, 'touches' => $this->magazine($role), 'route' => []];
        }
        foreach ([0, 1] as $team) {
            $carrier = $this->state['players'][$this->slot($team, $setup['carriers'][$team])];
            $this->state['flags'][] = ['id' => $team, 'cell' => $carrier['cell'], 'carrier' => player_key($carrier), 'delivered' => null];
            if (!array_filter($this->grid->cells, fn($cell) => $this->grid->open($cell) && $this->inGoal($cell, $team))) throw new InvalidArgumentException('Leave an open tile in each goal.');
        }
        $this->observe('awake');
    }
    public function team(): int { return $this->state['turn'] % 2; }
    public function remaining(): int { return max(0, $this->state['turnEndsAt'] - $this->state['time']); }
    private function slot(int $team, int $index): int { return $team * $this->state['setup']['config']['playersPerTeam'] + $index; }
    private function magazine(string $role): array {
        $count = $this->state['setup']['config']['playersPerTeam'];
        return $role === 'medic' ? array_fill(0, $count - 1, 'hot') : ($role === 'samurai' ? array_fill(0, $count, 'cold') : ['hotcold']);
    }
    private function actions(array $player, ?string $phase = null): array {
        $phase = $phase ?? ($player['team'] === $this->team() ? 'active' : 'sleep');
        $actions = ['sleep' => [], 'awake' => ['vision', 'peek'], 'active' => ['vision', 'movement', 'touch']];
        if ($player['role'] === 'seer') $actions = ['sleep' => ['vision'], 'awake' => ['peek'], 'active' => ['movement', 'touch']];
        if ($player['role'] === 'samurai') $actions['awake'] = ['peek'];
        return $player['frozen'] > 0 ? array_values(array_intersect($actions[$phase], ['vision', 'peek'])) : $actions[$phase];
    }
    private function goal(int $team): array {
        $c = $this->state['setup']['config']; $row = ($c['top'] ?? 0) + (int)floor($c['rows'] / 2);
        $left = hex_offset(($c['left'] ?? 0) + max(0, min(1, $c['columns'] - 2)), $row);
        return $team === 0 ? hex_mirror($left, $c['columns'] + 2 * ($c['left'] ?? 0)) : $left;
    }
    private function inGoal(array $cell, int $team): bool {
        if ($this->state['setup']['version'] >= 5) return in_array($cell, $this->state['setup']['endzones'][1 - $team], true);
        $a = hex_center($cell); $b = hex_center($this->goal($team));
        return hypot($a['x'] - $b['x'], $a['y'] - $b['y']) <= ($this->state['setup']['config']['goalDiameter'] - 1) / 2 + 1e-8;
    }
    private function log(int $team, string $text): void {
        array_unshift($this->state['events'][$team], ['text' => $text, 'time' => $this->state['time']]);
        $this->state['events'][$team] = array_slice($this->state['events'][$team], 0, 32);
    }
    private function flagState(array $flag): array {
        $carrier = null;
        foreach ($this->state['players'] as $player) if ($player['carrying'] === $flag['id']) { $carrier = $player; break; }
        $flag['cell'] = $carrier['cell'] ?? $flag['cell'];
        $flag['carrier'] = $carrier === null ? null : player_key($carrier);
        return $flag;
    }
    private function ownCarrier(int $team, int $flag): bool {
        foreach ($this->state['players'] as $p) if ($p['team'] === $team && $p['carrying'] === $flag) return true;
        return false;
    }
    public function observe(string $activePhase = 'active'): void {
        foreach ([0, 1] as $team) {
            $phase = $team === $this->team() ? $activePhase : 'sleep';
            $this->state['observation'][$team] = $phase; $visible = [];
            foreach ($this->state['players'] as $p) if ($p['team'] === $team) {
                $actions = $this->actions($p, $phase);
                if (in_array('vision', $actions, true)) $visible += $this->grid->visible($p['cell'], in_array('peek', $actions, true) ? (int)floor($this->state['setup']['config']['peekDiameter'] / 2) : 0);
                if ($phase === 'awake' && in_array('vision', $this->actions($p, 'active'), true)) $visible += $this->grid->visible($p['cell']);
            }
            $this->state['visibility'][$team] = $visible;
            $known =& $this->state['knowledge'][$team];
            foreach ($this->state['players'] as $p) if ($p['team'] !== $team) {
                $id = player_key($p); $old = $known['players'][$id] ?? null;
                if (isset($visible[hex_key($p['cell'])])) {
                    unset($p['route'], $p['touches']); $p['observedAt'] = $this->state['time']; $known['players'][$id] = $p;
                } elseif ($old !== null && isset($visible[hex_key($old['cell'])])) unset($known['players'][$id]);
            }
            foreach ($this->state['flags'] as $flag) {
                $current = $this->flagState($flag); $old = $known['flags'][$flag['id']] ?? null;
                if (isset($visible[hex_key($current['cell'])]) || $this->ownCarrier($team, $flag['id'])) {
                    $current['observedAt'] = $this->state['time']; $known['flags'][$flag['id']] = $current;
                } elseif ($old !== null && isset($visible[hex_key($old['cell'])])) unset($known['flags'][$flag['id']]);
            }
            unset($known);
        }
    }
    private function collectAndScore(): void {
        foreach ($this->state['players'] as &$p) if ($p['team'] === $this->team() && !$p['frozen']) {
            if ($p['carrying'] === null) foreach ($this->state['flags'] as &$flag) {
                if ($this->ownCarrier(0, $flag['id']) || $this->ownCarrier(1, $flag['id']) || $flag['delivered'] === $p['team'] || $flag['cell'] !== $p['cell']) continue;
                $p['carrying'] = $flag['id']; $flag['carrier'] = player_key($p); $flag['delivered'] = null;
                $this->log($p['team'], player_label($p) . ' collected F' . ($flag['id'] + 1) . '.');
                break;
            }
            unset($flag);
            if ($p['carrying'] !== null && $this->inGoal($p['cell'], $p['team'])) {
                $flag =& $this->state['flags'][$p['carrying']];
                $flag['cell'] = $p['cell']; $flag['carrier'] = null; $flag['delivered'] = $p['team']; $p['carrying'] = null;
                $this->log($p['team'], player_label($p) . ' delivered F' . ($flag['id'] + 1) . '.');
                unset($flag);
            }
        }
        unset($p);
        foreach ([0, 1] as $team) if (count(array_filter($this->state['flags'], fn($flag) => $flag['delivered'] === $team)) === 2) $this->state['winner'] = $team;
    }
    public function command(int $team, array $command): bool {
        if ($this->state['winner'] !== null || $team !== $this->team()) return false;
        $kind = $command['kind'] ?? '';
        if (in_array($kind, ['order', 'hold', 'touch'], true)) {
            if (!valid_integer($command['index'] ?? null, 0, $this->state['setup']['config']['playersPerTeam'] - 1)) throw new InvalidArgumentException('Invalid piece.');
            $slot = $this->slot($team, (int)$command['index']); $p =& $this->state['players'][$slot];
        }
        if ($kind === 'order') {
            if (!in_array('movement', $this->actions($p), true) || !$this->grid->has($command['destination'] ?? null)) return false;
            $destination = ['q' => (int)$command['destination']['q'], 'r' => (int)$command['destination']['r']];
            $route = $this->grid->path($p['cell'], $destination, $this->remaining());
            if ($route === null) return false;
            $p['route'] = $route; return true;
        }
        if ($kind === 'hold') { $p['route'] = []; return true; }
        if ($kind === 'step') {
            if ($this->remaining() <= 0) return false;
            foreach ($this->state['players'] as &$mover) if ($mover['team'] === $team && in_array('movement', $this->actions($mover), true)) {
                $next = $mover['route'][0] ?? null;
                if ($next !== null && $this->grid->open($next) && hex_distance($mover['cell'], $next) === 1) $mover['cell'] = array_shift($mover['route']);
            }
            unset($mover);
            $this->state['time']++; $this->collectAndScore(); $this->observe(); return true;
        }
        if ($kind === 'end_turn') {
            foreach ($this->state['players'] as &$player) $player['route'] = [];
            unset($player);
            $this->state['time'] = $this->state['turnEndsAt']; $this->observe(); $this->state['turn']++;
            $this->state['turnEndsAt'] = $this->state['time'] + $this->state['setup']['config']['turnDuration'];
            foreach ($this->state['players'] as &$player) if ($player['team'] === $this->team()) {
                if ($player['frozen'] > 0) { $player['frozen']--; if (!$player['frozen']) $this->log($player['team'], player_label($player) . ' thawed.'); }
                $player['touches'] = $this->magazine($player['role']);
            }
            unset($player);
            $this->observe('awake'); return true;
        }
        if ($kind === 'touch') {
            if (!valid_integer($command['targetTeam'] ?? null, 0, 1) || !valid_integer($command['targetIndex'] ?? null, 0, $this->state['setup']['config']['playersPerTeam'] - 1) || !in_array($command['touch'] ?? null, ['hot', 'cold', 'hotcold'], true)) throw new InvalidArgumentException('Invalid touch.');
            $targetSlot = $this->slot((int)$command['targetTeam'], (int)$command['targetIndex']);
            if ($targetSlot === $slot) return false;
            $other =& $this->state['players'][$targetSlot]; $touch = $command['touch'];
            if (!in_array('touch', $this->actions($p), true) || !in_array($touch, $p['touches'], true) || hex_distance($p['cell'], $other['cell']) > 1 || !$this->grid->clearSight($p['cell'], $other['cell'])) return false;
            $friendly = $team === $other['team'];
            if ($friendly ? !$other['frozen'] || $touch === 'cold' : $other['frozen'] > 0 || $touch === 'hot') return false;
            array_splice($p['touches'], array_search($touch, $p['touches'], true), 1);
            if ($friendly) { $other['frozen'] = 0; $this->log($team, player_label($p) . ' revived ' . player_label($other) . '. ' . $this->remaining() . ' t left.'); }
            else {
                $other['frozen'] = $this->state['setup']['config']['freezeRounds']; $other['route'] = [];
                if ($other['carrying'] !== null) {
                    $flag =& $this->state['flags'][$other['carrying']]; $flag['cell'] = $other['cell']; $flag['carrier'] = null; $flag['delivered'] = null; $other['carrying'] = null; unset($flag);
                }
                $this->log($team, player_label($p) . ' froze ' . player_label($other) . '.'); $this->log($other['team'], player_label($other) . ' was tagged.');
            }
            unset($p, $other);
            $this->collectAndScore(); $this->observe($this->state['observation'][$team] === 'awake' ? 'awake' : 'active'); return true;
        }
        throw new InvalidArgumentException('Unknown command.');
    }
    public function view(int $team): array {
        $known = $this->state['knowledge'][$team]; $visible = $this->state['visibility'][$team];
        ksort($known['flags']);
        return ['team' => $team, 'activeTeam' => $this->team(), 'turn' => $this->state['turn'], 'time' => $this->state['time'], 'remaining' => $this->remaining(),
            'observation' => $this->state['observation'][$team], 'config' => $this->state['setup']['config'], 'visible' => array_keys($visible),
            'own' => array_values(array_filter($this->state['players'], fn($p) => $p['team'] === $team)),
            'enemies' => array_values(array_map(fn($p) => $p + ['visible' => isset($visible[hex_key($p['cell'])])], $known['players'])),
            'flags' => array_values(array_map(fn($flag) => $flag + ['visible' => isset($visible[hex_key($flag['cell'])]) || $this->ownCarrier($team, $flag['id'])], $known['flags'])),
            'scores' => array_map(fn($t) => count(array_filter($this->state['flags'], fn($f) => $f['delivered'] === $t)), [0, 1]),
            'events' => $this->state['events'][$team], 'winner' => $this->state['winner']];
    }
}
