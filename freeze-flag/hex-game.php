<?php
declare(strict_types=1);

function hex_key(array $h): string { return $h['q'] . ',' . $h['r']; }
function hex_offset(int $column, int $row): array { return ['q' => $column - (int)floor($row / 2), 'r' => $row]; }
function hex_mirror(array $cell, int $columns): array { return ['q' => $columns - 1 - $cell['r'] - $cell['q'], 'r' => $cell['r']]; }
function hex_distance(array $a, array $b): int { return (int)((abs($a['q'] - $b['q']) + abs($a['r'] - $b['r']) + abs($a['q'] + $a['r'] - $b['q'] - $b['r'])) / 2); }
function hex_center(array $h): array { return ['x' => $h['q'] + $h['r'] / 2 + .5, 'y' => $h['r'] * sqrt(3) / 2 + 1 / sqrt(3)]; }
function player_key(array $p): string { return $p['team'] . ':' . $p['index']; }
function player_label(array $p): string { return ($p['team'] === 0 ? 'R' : 'B') . ($p['index'] + 1); }
function valid_integer($value, int $min, int $max): bool { return (is_int($value) || is_float($value)) && is_finite((float)$value) && floor((float)$value) === (float)$value && $value >= $min && $value <= $max; }
function sector_name(int $angle): string { return $angle === 30 ? 'twelve mirrored sectors' : 'six reflected sectors'; }

final class HexGrid {
    public array $cells = [];
    public array $blocked = [];
    public array $outOfBounds = [];
    private array $lookup = [];
    private array $walls = [];
    private array $seams = [];
    private array $sight = [];
    private const DIRECTIONS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
    private const SIDES = [[1, 0, 1], [1, 1, 2], [-1, 1, 2], [-1, 0, 1], [-1, -1, 2], [1, -1, 2]];
    private const SIGHT_CORNERS = [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]];

    public string $sightRule = 'centers';
    public function __construct(int $columns, int $rows, array $obstacles, array $outOfBounds = [], int $left = 0, int $top = 0, string $sightRule = 'centers') {
        // Centres is the rule the game is played under; 'area' is kept for scripts that ask for it by name.
        $this->sightRule = $sightRule === 'area' ? 'area' : 'centers';
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
            $this->walls[$key] = $h;
        }
        // One bit per side saying whether the obstacle across it is an obstacle too, so the seam test costs a lookup.
        foreach ($this->walls as $key => $wall) {
            $mask = 0;
            foreach (self::DIRECTIONS as $side => [$dq, $dr]) {
                if (isset($this->blocked[hex_key(['q' => $wall['q'] + $dq, 'r' => $wall['r'] + $dr])])) $mask |= 1 << $side;
            }
            $this->seams[$key] = $mask;
        }
    }
    public function contains($h): bool {
        return is_array($h) && valid_integer($h['q'] ?? null, -2000, 2000) && valid_integer($h['r'] ?? null, -1000, 1040) && isset($this->lookup[hex_key($h)]);
    }
    public function has($h): bool { return $this->contains($h) && !isset($this->outOfBounds[hex_key($h)]); }
    public function open(array $h): bool { return $this->has($h) && !isset($this->blocked[hex_key($h)]); }
    /** Terrain invariance under the horizontal mirror plus the 11 o'clock (60°, six sectors) or 10 o'clock (30°, twelve sectors) mirror through $center.
     *  $exempt is keyed by the cells an endzone covers: an endzone overrides the mirrored terrain on its own tile,
     *  so a pair with one of those on either end may differ. */
    public function sectorSymmetric(array $center, int $angle = 60, array $exempt = []): bool {
        foreach ($this->cells as $cell) {
            $copies = [
                ['q' => $cell['q'] + $cell['r'] - $center['r'], 'r' => 2 * $center['r'] - $cell['r']],
                $angle === 30 ? ['q' => $center['q'] + $cell['r'] - $center['r'], 'r' => $center['r'] + $cell['q'] - $center['q']] : ['q' => 2 * $center['q'] - $cell['q'], 'r' => $cell['q'] + $cell['r'] - $center['q']],
            ];
            foreach ($copies as $copy) {
                if ($this->has($copy) && isset($this->blocked[hex_key($cell)]) === isset($this->blocked[hex_key($copy)])) continue;
                if (!isset($exempt[hex_key($cell)]) && !isset($exempt[hex_key($copy)])) return false;
            }
        }
        return true;
    }
    private function neighbors(array $h): array {
        $neighbors = [];
        foreach (self::DIRECTIONS as [$q, $r]) {
            $next = ['q' => $h['q'] + $q, 'r' => $h['r'] + $r];
            if ($this->open($next)) $neighbors[] = $next;
        }
        return $neighbors;
    }
    private function blocksSight(array $a, array $b, array $wall, ?string $ignored): bool {
        $ax = 2 * ($a['q'] - $wall['q']) + $a['r'] - $wall['r']; $ay = 3 * ($a['r'] - $wall['r']);
        $bx = 2 * ($b['q'] - $wall['q']) + $b['r'] - $wall['r']; $by = 3 * ($b['r'] - $wall['r']);
        $enter = 0; $exit = 1;
        foreach (self::SIDES as $i => [$x, $y, $limit]) {
            $start = $limit - $x * $ax - $y * $ay; $end = $limit - $x * $bx - $y * $by;
            if ($start == 0 && $end == 0) {
                [$q, $r] = self::DIRECTIONS[$i];
                $neighbor = hex_key(['q' => $wall['q'] + $q, 'r' => $wall['r'] + $r]);
                if ($neighbor === $ignored || !isset($this->blocked[$neighbor])) return false;
                continue;
            }
            if ($start <= 0 && $end <= 0) return false;
            if ($start < 0) $enter = max($enter, $start / ($start - $end));
            if ($end < 0) $exit = min($exit, $start / ($start - $end));
            if ($enter >= $exit) return false;
        }
        return $enter < $exit;
    }
    public function clearSight(array $a, array $b, bool $revealWall = false): bool {
        $ignored = $revealWall ? hex_key($b) : null;
        foreach ($this->walls as $key => $wall) if ($key !== $ignored && $this->blocksSight($a, $b, $wall, $ignored)) return false;
        return true;
    }
    private function shadowFrom(array $view, array $wall): array {
        $cx = 2 * ($wall['q'] - $view['q']) + $wall['r'] - $view['r']; $cy = 3 * ($wall['r'] - $view['r']);
        $corners = array_map(fn($corner) => [$corner[0] + $cx, $corner[1] + $cy], self::SIGHT_CORNERS);
        $planes = [];
        foreach (self::SIDES as [$x, $y, $limit]) {
            $limit += $x * $cx + $y * $cy;
            if ($limit < 0) $planes[] = [$x, $y, $limit];
        }
        foreach ($corners as [$x, $y]) {
            $crosses = array_map(fn($point) => $x * $point[1] - $y * $point[0], $corners);
            if (min($crosses) >= 0) $planes[] = [$y, -$x, 0];
            if (max($crosses) <= 0) $planes[] = [-$y, $x, 0];
        }
        return ['key' => hex_key($wall), 'planes' => $planes, 'wx' => $cx, 'wy' => $cy, 'joined' => $this->seams[hex_key($wall)] ?? 0];
    }
    private function exposedEdge(int $ax, int $ay, int $bx, int $by, array $shadows, string $target): bool {
        $exposed = [[0, 1]];
        foreach ($shadows as $shadow) {
            if ($shadow['key'] === $target) continue;
            $enter = 0; $exit = 1;
            foreach ($shadow['planes'] as [$x, $y, $limit]) {
                $start = $limit - $x * $ax - $y * $ay; $end = $limit - $x * $bx - $y * $by;
                if ($start < 0 && $end < 0) { $exit = -1; break; }
                if ($start < 0) $enter = max($enter, $start / ($start - $end));
                if ($end < 0) $exit = min($exit, $start / ($start - $end));
                if ($enter >= $exit) break;
            }
            if ($enter >= $exit) continue;
            $parts = [];
            foreach ($exposed as [$from, $to]) {
                if ($enter >= $to || $exit <= $from) { $parts[] = [$from, $to]; continue; }
                if ($enter - $from > 1e-10) $parts[] = [$from, $enter];
                if ($to - $exit > 1e-10) $parts[] = [$exit, $to];
            }
            $exposed = $parts;
            if (!$exposed) return false;
        }
        return true;
    }
    private function visibleArea(array $view, array $cell, array $shadows): bool {
        if ($view['q'] === $cell['q'] && $view['r'] === $cell['r']) return true;
        $cx = 2 * ($cell['q'] - $view['q']) + $cell['r'] - $view['r']; $cy = 3 * ($cell['r'] - $view['r']);
        foreach (self::SIDES as $i => [$x, $y, $limit]) {
            if ($limit + $x * $cx + $y * $cy >= 0) continue;
            [$ax, $ay] = self::SIGHT_CORNERS[($i + 1) % 6]; [$bx, $by] = self::SIGHT_CORNERS[($i + 2) % 6];
            if ($this->exposedEdge($ax + $cx, $ay + $cy, $bx + $cx, $by + $cy, $shadows, hex_key($cell))) return true;
        }
        return false;
    }
    public function visible(array $start): array {
        $key = hex_key($start);
        if (isset($this->sight[$key])) return $this->sight[$key];
        $visible = [];
        if ($this->open($start)) {
            $shadows = array_map(fn($wall) => $this->shadowFrom($start, $wall), $this->walls);
            foreach ($this->cells as $cell) {
                $cellKey = hex_key($cell); $open = $this->open($cell);
                // Center to center is already the same test from either end, so it needs no reciprocal retry.
                $seen = $open && isset($this->sight[$cellKey]) ? isset($this->sight[$cellKey][$key])
                    : ($this->sightRule === 'centers' ? $this->visibleCenter($start, $cell, $shadows)
                        : $this->visibleArea($start, $cell, $shadows) || $open && $this->visibleArea($cell, $start, array_map(fn($wall) => $this->shadowFrom($cell, $wall), $this->walls)));
                if ($seen) $visible[$cellKey] = true;
            }
        }
        return $this->sight[$key] = $visible;
    }
    /** Clips the sight line against one obstacle in exact integer ratios. Blocked means the line reaches the inside of
     *  the obstacles taken together: the interior of a run of obstacles includes the edges they share, so a line down
     *  the seam of a wall is stopped while the same line along a lone obstacle's edge is not. A segment can only
     *  overlap a convex tile without entering it by lying along one of its sides, so that is the only case to separate,
     *  and there one bit answers it: the shared edge is interior exactly when the tile across it is an obstacle too. */
    private function cutsThrough(int $cx, int $cy, int $wx, int $wy, int $joined): bool {
        $enterUp = 0; $enterDown = 1; $exitUp = 1; $exitDown = 1; $along = -1;
        foreach (self::SIDES as $side => [$x, $y, $limit]) {
            $start = -$x * $wx - $y * $wy - $limit; $end = $x * ($cx - $wx) + $y * ($cy - $wy) - $limit;
            if ($start > 0 && $end > 0) return false;
            if ($start === 0 && $end === 0) $along = $side;
            elseif ($start > 0) { $down = $start - $end; if ($start * $enterDown > $enterUp * $down) { $enterUp = $start; $enterDown = $down; } }
            elseif ($end > 0) { $down = $end - $start; if (-$start * $exitDown < $exitUp * $down) { $exitUp = -$start; $exitDown = $down; } }
        }
        if ($enterUp * $exitDown >= $exitUp * $enterDown) return false;
        return $along < 0 || ($joined & (1 << $along)) !== 0;
    }
    /** The target's own center rather than any part of it: hidden only when the line between the two centers runs through an obstacle. */
    private function visibleCenter(array $view, array $cell, array $shadows): bool {
        if ($view === $cell) return true;
        $cx = 2 * ($cell['q'] - $view['q']) + $cell['r'] - $view['r']; $cy = 3 * ($cell['r'] - $view['r']);
        $key = hex_key($cell);
        foreach ($shadows as $shadow) {
            if ($shadow['key'] !== $key && $this->cutsThrough($cx, $cy, $shadow['wx'], $shadow['wy'], $shadow['joined'])) return false;
        }
        return true;
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
    private bool $resolving = false;

    public static function validateSetup($setup): array {
        if (!is_array($setup) || !in_array($setup['version'] ?? null, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], true) || !is_array($setup['config'] ?? null) || !is_array($setup['obstacles'] ?? null) || count($setup['obstacles']) > 2080 || !is_array($setup['roles'] ?? null) || count($setup['roles']) !== 2 || !is_array($setup['carriers'] ?? null) || count($setup['carriers']) !== 2) throw new InvalidArgumentException('Invalid board setup.');
        $config = [];
        foreach (['columns' => $setup['version'] >= 4 ? [1, 52] : [9, 26], 'rows' => $setup['version'] >= 4 ? [1, 40] : [7, 21], 'playersPerTeam' => [1, 2080], 'turnDuration' => [1, 30], 'freezeRounds' => [2, 6]] as $key => [$lo, $hi]) {
            if (!valid_integer($setup['config'][$key] ?? null, $lo, $hi)) throw new InvalidArgumentException('Invalid ' . $key . '.');
            $config[$key] = (int)$setup['config'][$key];
        }
        if (array_key_exists('allowVoluntaryDrops', $setup['config'])) {
            if (!is_bool($setup['config']['allowVoluntaryDrops'])) throw new InvalidArgumentException('Invalid allowVoluntaryDrops.');
            $config['allowVoluntaryDrops'] = $setup['config']['allowVoluntaryDrops'];
        }
        if (array_key_exists('postThawTouches', $setup['config'])) {
            if (!is_bool($setup['config']['postThawTouches'])) throw new InvalidArgumentException('Invalid postThawTouches.');
            $config['postThawTouches'] = $setup['config']['postThawTouches'];
        }
        if (array_key_exists('trajectoryLock', $setup['config'])) {
            if (!is_bool($setup['config']['trajectoryLock'])) throw new InvalidArgumentException('Invalid trajectoryLock.');
            $config['trajectoryLock'] = $setup['config']['trajectoryLock'];
        }
        if (array_key_exists('fog', $setup['config'])) {
            if (!is_bool($setup['config']['fog'])) throw new InvalidArgumentException('Invalid fog.');
            $config['fog'] = $setup['config']['fog'];
        }
        if (array_key_exists('frozenFog', $setup['config'])) {
            if (!is_bool($setup['config']['frozenFog'])) throw new InvalidArgumentException('Invalid frozenFog.');
            $config['frozenFog'] = $setup['config']['frozenFog'];
        }
        if (array_key_exists('sightRule', $setup['config'])) {
            if (!in_array($setup['config']['sightRule'], ['area', 'centers'], true)) throw new InvalidArgumentException('Invalid sightRule.');
            $config['sightRule'] = $setup['config']['sightRule'];
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
        if ($explicit && (!is_array($setup['outOfBounds'] ?? null) || count($setup['outOfBounds']) > 2080 || ($setup['version'] < 6 && (!is_array($setup['positions'] ?? null) || count($setup['positions']) !== 2)))) throw new InvalidArgumentException('Invalid board terrain or player positions.');
        $grid = new HexGrid($config['columns'], $config['rows'], $setup['obstacles'], $explicit ? $setup['outOfBounds'] : [], $config['left'] ?? 0, $config['top'] ?? 0, $config['sightRule'] ?? 'centers');
        $obstacles = array_values(array_filter($grid->cells, fn($h) => isset($grid->blocked[hex_key($h)])));
        $symmetry = null;
        if (array_key_exists('symmetry', $setup)) {
            $s = $setup['symmetry'];
            if (!is_array($s) || !in_array($s['angle'] ?? null, [60, 30], true) || !is_array($s['center'] ?? null) || !valid_integer($s['center']['q'] ?? null, -2000, 2000) || !valid_integer($s['center']['r'] ?? null, -2000, 2000)) throw new InvalidArgumentException('Invalid board symmetry.');
            $symmetry = ['angle' => (int)$s['angle'], 'center' => ['q' => (int)$s['center']['q'], 'r' => (int)$s['center']['r']]];
            // Endzone cells are read before they are validated below, only to exempt them from the terrain mirrors.
            $exempt = [];
            foreach (is_array($setup['endzones'] ?? null) ? $setup['endzones'] : [] as $zone) {
                foreach (is_array($zone) ? $zone : [] as $cell) if (is_array($cell) && isset($cell['q'], $cell['r'])) $exempt[hex_key($cell)] = true;
            }
            if (!$grid->sectorSymmetric($symmetry['center'], $symmetry['angle'], $exempt)) throw new InvalidArgumentException('Board terrain must match its ' . sector_name($symmetry['angle']) . '.');
        }
        if (!$symmetry && $setup['version'] >= 2) foreach ($obstacles as $cell) {
            if (!isset($grid->blocked[hex_key(hex_mirror($cell, $config['columns'] + 2 * ($config['left'] ?? 0)))])) throw new InvalidArgumentException('Board obstacles must mirror left to right.');
        }
        if (!$symmetry && $explicit) foreach ($setup['outOfBounds'] as $cell) {
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
            if (!is_array($list) || count($list) !== $config['playersPerTeam']) throw new InvalidArgumentException('Both teams need the same nonzero number of pawns before playing.');
            foreach ($list as $role) if (!in_array($role, ['standard', 'scout', 'freezer', 'heater', 'courier', 'seer', 'medic', 'samurai'], true)) throw new InvalidArgumentException('Invalid role.');
            if (!valid_integer($setup['carriers'][$team] ?? null, 0, $config['playersPerTeam'] - 1)) throw new InvalidArgumentException('Invalid flag carrier.');
            $roles[] = array_values($list); $carriers[] = (int)$setup['carriers'][$team];
            if ($explicit && $setup['version'] < 6) {
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
        if ($symmetry) $result['symmetry'] = $symmetry;
        if ($explicit) {
            $canvas = new HexGrid($config['columns'], $config['rows'], [], [], $config['left'] ?? 0, $config['top'] ?? 0);
            $result['outOfBounds'] = array_values(array_filter($canvas->cells, fn($h) => isset($grid->outOfBounds[hex_key($h)])));
            if ($setup['version'] < 6) $result['positions'] = $positions;
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
        $sectorAngle = (int)($setup['symmetry']['angle'] ?? 60);
        $covered = array_fill_keys(array_map('hex_key', array_merge(...$zones)), true);
        if (isset($setup['symmetry']) && !$grid->sectorSymmetric($setup['symmetry']['center'], $sectorAngle, $covered)) $add('asymmetric-terrain', 'Field and obstacles must match the ' . sector_name($sectorAngle) . '.');
        foreach ([0, 1] as $team) {
            $name = ['Red', 'Blue'][$team]; $zone = $zones[$team]; $count = count($setup['roles'][$team]);
            if (!$zone) $add("missing-endzone-$team", "$name endzone is missing. Paint it with 3.");
            else {
                if (count($zone) < max(1, $count)) $add("small-endzone-$team", "$name endzone has " . count($zone) . ' tiles; needs at least ' . max(1, $count) . '.', $zone);
                $blocked = array_filter($zone, fn($cell) => !$grid->open($cell));
                if ($blocked) $add("blocked-endzone-$team", "$name endzone includes blocked or off-board tiles.", $blocked);
                if (count(self::connectedRegions($zone)) > 1) $add("split-endzone-$team", "$name endzone must be one connected region.", $zone);
            }
            if (!$count) $add("empty-team-$team", "Place at least one $name player.");
            $positions = $setup['version'] < 6 ? $setup['positions'][$team] : [];
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
        foreach (array_merge(...($setup['positions'] ?? [[], []])) as $cell) { $key = hex_key($cell); if (isset($occupied[$key])) $duplicates[] = $cell; else $occupied[$key] = true; }
        if ($duplicates) $add('overlapping-starts', 'Starting players share a tile.', $duplicates);
        $regions = self::connectedRegions(array_values(array_filter($grid->cells, fn($cell) => $grid->open($cell))));
        if (!$regions) $add('no-field', 'The map has no open field tiles.');
        elseif (count($regions) > 1) $add('disconnected-field', 'Field splits into ' . count($regions) . ' unreachable regions. Every open tile must connect.', array_merge(...array_slice($regions, 1)));
        return $issues;
    }
    /** Which endzone each team scores in, or null when the two zones are not a clean self/other pair. */
    private static function endzoneTarget(array $setup): ?string {
        $homes = self::deploymentEndzones($setup);
        if (!$homes[0] || !$homes[1]) return null;
        $scoring = ($setup['version'] ?? 0) >= 7 ? $setup['endzones'] : [$setup['endzones'][1], $setup['endzones'][0]];
        foreach (['self', 'other'] as $mode) {
            $match = true;
            foreach ([0, 1] as $team) {
                $home = $homes[$mode === 'self' ? $team : 1 - $team];
                $keys = array_fill_keys(array_map('hex_key', $home), true);
                $match = $match && count($scoring[$team]) === count($home) && !array_filter($scoring[$team], fn($cell) => !isset($keys[hex_key($cell)]));
            }
            if ($match) return $mode;
        }
        return null;
    }
    private static function deploymentEndzones(array $setup): array {
        if ($setup['version'] < 7) return $setup['endzones'];
        $middle = ($setup['config']['left'] ?? 0) + $setup['config']['columns'] / 2;
        $cells = array_merge(...$setup['endzones']);
        return [array_values(array_filter($cells, fn($cell) => hex_center($cell)['x'] < $middle)), array_values(array_filter($cells, fn($cell) => hex_center($cell)['x'] > $middle))];
    }
    private static function startingPositions(array $setup): array {
        $c = $setup['config'];
        $centerX2 = 2 * ($c['left'] ?? 0) + $c['columns'];
        $centerRow2 = 2 * ($c['top'] ?? 0) + $c['rows'] - 1;
        $distance = fn($cell) => 4 * (2 * $cell['q'] + $cell['r'] + 1 - $centerX2) ** 2 + 3 * (2 * $cell['r'] - $centerRow2) ** 2;
        $positions = [];
        foreach ([0, 1] as $team) {
            $cells = self::deploymentEndzones($setup)[$team];
            usort($cells, fn($a, $b) => ($distance($a) <=> $distance($b)) ?: ($a['r'] <=> $b['r']) ?: ($team === 0 ? $b['q'] <=> $a['q'] : $a['q'] <=> $b['q']));
            $positions[] = array_slice($cells, 0, count($setup['roles'][$team]));
        }
        return $positions;
    }
    public function __construct(array $setup, ?array $state = null) {
        if ($state !== null && valid_integer($setup['config']['freezeRounds'] ?? null, 0, 12)) $setup['config']['freezeRounds'] = max(2, min(6, $setup['config']['freezeRounds']));
        $setup = self::validateSetup($setup); $c = $setup['config'];
        $this->grid = new HexGrid($c['columns'], $c['rows'], $setup['obstacles'], $setup['outOfBounds'] ?? [], $c['left'] ?? 0, $c['top'] ?? 0, $c['sightRule'] ?? 'centers');
        if ($state !== null) {
            $this->state = $state; $this->state['setup'] = $setup; $this->upgradeFlags();
            $this->state['turnStartedAt'] ??= max(0, $this->state['turnEndsAt'] - $this->turnDuration());
            foreach ($this->state['knowledge'] as &$known) {
                if (!isset($known['history'])) {
                    $known['history'] = self::historyFromPlayers($known['players']);
                    unset($known['historyUnit']);
                }
                if (($known['historyUnit'] ?? null) !== 'turn') $known['history'] = self::historyByTurn((array)$known['history'], $c['turnDuration']);
                $known['historyUnit'] = 'turn';
            }
            unset($known);
            if (isset($this->state['waitingView'])) {
                $waiting =& $this->state['waitingView'];
                if (valid_integer($waiting['config']['freezeRounds'] ?? null, 0, 12)) $waiting['config']['freezeRounds'] = max(2, min(6, $waiting['config']['freezeRounds']));
                unset($waiting['config']['peekDiameter']);
                if ($waiting['observation'] === 'awake') $waiting['observation'] = 'active';
                if (!isset($waiting['enemyHistory'])) {
                    $waiting['enemyHistory'] = self::historyFromPlayers($waiting['enemies']);
                    unset($waiting['enemyHistoryUnit']);
                }
                if (($waiting['enemyHistoryUnit'] ?? null) !== 'turn') $waiting['enemyHistory'] = self::historyByTurn((array)$waiting['enemyHistory'], $c['turnDuration']);
                $waiting['enemyHistory'] = (object)$waiting['enemyHistory'];
                $waiting['enemyHistoryUnit'] = 'turn';
                $waiting['enemyIndices'] ??= array_column(array_filter($this->state['players'], fn($p) => $p['team'] !== $waiting['team']), 'index');
                unset($waiting);
            }
            $atTurnStart = $this->state['observation'][$this->team()] === 'awake';
            $this->state['observation'] = array_map(fn($phase) => $phase === 'awake' ? 'active' : $phase, $this->state['observation']);
            if (($this->state['visibilityVersion'] ?? null) !== 4) {
                $this->observeTeam($this->team(), 'active', $atTurnStart && $this->state['turn'] > 0 ? $this->state['turn'] - 1 : null);
                $this->state['visibilityVersion'] = 4;
            }
            return;
        }
        $positions = $setup['version'] >= 6 ? self::startingPositions($setup) : ($setup['positions'] ?? null);
        $this->state = ['setup' => $setup, 'players' => [], 'flags' => [], 'turn' => 0, 'time' => 0, 'turnEndsAt' => $c['turnDuration'], 'winner' => null, 'ready' => $setup['version'] >= 6 && $setup['version'] < 10 ? [false, false] : null, 'knowledge' => [['players' => [], 'flags' => [], 'history' => [], 'historyUnit' => 'turn'], ['players' => [], 'flags' => [], 'history' => [], 'historyUnit' => 'turn']], 'visibility' => [[], []], 'observation' => ['active', 'sleep'], 'events' => [[], []]];
        $this->state['visibilityVersion'] = 4;
        $this->state['turnStartedAt'] = 0;
        foreach ([0, 1] as $team) for ($index = 0; $index < $c['playersPerTeam']; $index++) {
            $row = (int)round(($index + 1) * ($c['rows'] - 1) / ($c['playersPerTeam'] + 1));
            $desired = hex_offset($team === 0 ? 1 : $c['columns'] - 2 - $row % 2, $row);
            $occupied = array_column(array_map(fn($p) => [hex_key($p['cell']), true], $this->state['players']), 1, 0);
            $candidates = $positions !== null ? [$positions[$team][$index]] : array_values(array_filter($this->grid->cells, function($cell) use ($team, $c, $setup, $occupied) {
                $column = $cell['q'] + (int)floor($cell['r'] / 2);
                $relative = $team === 0 ? $cell : hex_mirror($cell, $c['columns']);
                $inStart = $setup['version'] === 1 ? ($team === 0 ? $column < 3 : $column >= $c['columns'] - 4) : $relative['q'] + (int)floor($relative['r'] / 2) < 3;
                return $this->grid->open($cell) && $inStart && !isset($occupied[hex_key($cell)]);
            }));
            usort($candidates, fn($a, $b) => (hex_distance($a, $desired) <=> hex_distance($b, $desired)) ?: (($a['r'] <=> $b['r']) ?: ($a['q'] <=> $b['q'])));
            if (!$candidates) throw new InvalidArgumentException('Leave enough open starting tiles for both teams.');
            $role = $setup['roles'][$team][$index];
            $this->state['players'][] = ['team' => $team, 'index' => $index, 'cell' => $candidates[0], 'role' => $role, 'frozen' => 0, 'flags' => $setup['carriers'][$team] === $index ? [['team' => $team, 'cell' => null, 'delivered' => null]] : [], 'touches' => $this->role($role)['touches'], 'route' => []];
        }
        foreach ([0, 1] as $team) {
            if (!array_filter($this->grid->cells, fn($cell) => $this->grid->open($cell) && $this->inGoal($cell, $team))) throw new InvalidArgumentException('Leave an open tile in each goal.');
        }
        $this->state['turnEndsAt'] = $this->turnDuration();
        $this->observe();
    }
    public function team(): int { return $this->state['turn'] % 2; }
    public function remaining(): int { return max(0, $this->state['turnEndsAt'] - $this->state['time']); }
    private function turnDuration(): int {
        return $this->state['setup']['config']['turnDuration'] + max(0, ...array_map(fn($p) => $this->role($p['role'])['movement'], array_filter($this->state['players'], fn($p) => $p['team'] === $this->team())));
    }
    private function movementRemaining(array $player): int {
        return max(0, min($this->remaining(), $this->state['turnStartedAt'] + $this->state['setup']['config']['turnDuration'] + $this->role($player['role'])['movement'] - $this->state['time']));
    }
    private function slot(int $team, int $index): int { return $team * $this->state['setup']['config']['playersPerTeam'] + $index; }
    private function role(string $role): array {
        $count = $this->state['setup']['config']['playersPerTeam'];
        $actions = ['sleep' => [], 'active' => ['vision', 'movement', 'touch']];
        if ($role === 'seer') $actions = ['sleep' => ['vision'], 'active' => ['movement', 'touch']];
        $touches = match ($role) {
            'scout', 'courier' => [],
            'heater' => array_fill(0, $count, 'hot'),
            'freezer', 'samurai' => array_fill(0, $count, 'cold'),
            'medic' => array_fill(0, $count - 1, 'hot'),
            default => ['hotcold'],
        };
        return ['name' => $role, 'carry' => $role === 'courier' ? 2 : 1, 'movement' => $role === 'scout' ? 2 : ($role === 'courier' ? -2 : 0), 'actions' => $actions, 'touches' => $touches];
    }
    private function actions(array $player, ?string $phase = null): array {
        $phase = $phase ?? ($player['team'] === $this->team() ? 'active' : 'sleep');
        $actions = $this->role($player['role'])['actions'];
        return $player['frozen'] > 0 ? array_values(array_intersect($actions[$phase], ['vision'])) : $actions[$phase];
    }
    private function canGrabFlag(array $player, array $flag): bool {
        $canCarry = fn($p) => !$p['frozen'] && count($p['flags']) < $this->role($p['role'])['carry'];
        if (!$canCarry($player) || $flag['carrier'] === player_key($player)) return false;
        $eligible = array_filter($this->state['players'], fn($p) => $p['team'] === $player['team'] && $canCarry($p));
        $connected = [$player]; $visited = [player_key($player) => true];
        for ($i = 0; $i < count($connected); $i++) {
            $from = $connected[$i];
            if (hex_distance($from['cell'], $flag['cell']) <= 1 && $this->grid->clearSight($from['cell'], $flag['cell'])) return true;
            foreach ($eligible as $to) {
                $key = player_key($to);
                if (isset($visited[$key]) || hex_distance($from['cell'], $to['cell']) > 1 || !$this->grid->clearSight($from['cell'], $to['cell'])) continue;
                $visited[$key] = true;
                $connected[] = $to;
            }
        }
        return false;
    }
    private function goal(int $team): array {
        $c = $this->state['setup']['config']; $row = ($c['top'] ?? 0) + (int)floor($c['rows'] / 2);
        $left = hex_offset(($c['left'] ?? 0) + max(0, min(1, $c['columns'] - 2)), $row);
        return $team === 0 ? hex_mirror($left, $c['columns'] + 2 * ($c['left'] ?? 0)) : $left;
    }
    private function inGoal(array $cell, int $team): bool {
        if ($this->state['setup']['version'] >= 5) return in_array($cell, $this->state['setup']['endzones'][$this->state['setup']['version'] >= 7 ? $team : 1 - $team], true);
        $a = hex_center($cell); $b = hex_center($this->goal($team));
        return hypot($a['x'] - $b['x'], $a['y'] - $b['y']) <= ($this->state['setup']['config']['goalDiameter'] - 1) / 2 + 1e-8;
    }
    private function log(int $team, string $text): void {
        array_unshift($this->state['events'][$team], ['text' => $text, 'time' => $this->state['time']]);
        $this->state['events'][$team] = array_slice($this->state['events'][$team], 0, 32);
    }
    private function upgradeFlags(): void {
        if (!array_key_exists('carrying', $this->state['players'][0])) return;
        $upgradePlayer = static function(array $player): array {
            $player['flags'] = $player['carrying'] === null ? [] : [['team' => $player['carrying'], 'cell' => null, 'delivered' => null]];
            unset($player['carrying']);
            return $player;
        };
        $this->state['players'] = array_map($upgradePlayer, $this->state['players']);
        $flags = [];
        foreach ($this->state['flags'] as $flag) if (!$this->ownCarrier(0, $flag['id']) && !$this->ownCarrier(1, $flag['id'])) {
            $flag['team'] = $flag['id']; unset($flag['id'], $flag['carrier']); $flags[] = $flag;
        }
        $this->state['flags'] = $flags;
        foreach ($this->state['knowledge'] as &$known) {
            $known['players'] = array_map($upgradePlayer, $known['players']);
            foreach ($known['flags'] as &$flag) { $flag['team'] = $flag['id']; unset($flag['id']); }
            unset($flag);
        }
        unset($known);
    }
    private static function historyFromPlayers(array $players): array {
        $history = [];
        foreach ($players as $player) {
            unset($player['clearedAt'], $player['visible']);
            $history[$player['observedAt']][player_key($player)] = $player;
        }
        return $history;
    }
    private static function historyByTurn(array $history, int $duration): array {
        ksort($history, SORT_NUMERIC);
        $turns = [];
        foreach ($history as $time => $pawns) {
            $turn = max(0, (int)ceil((int)$time / $duration) - 1);
            $turns[$turn] = array_replace($turns[$turn] ?? [], (array)$pawns);
        }
        return $turns;
    }
    private function flagState(array $flag, ?array $carrier = null): array {
        unset($flag['droppedBy']);
        $flag['cell'] = $carrier['cell'] ?? $flag['cell'];
        $flag['carrier'] = $carrier === null ? null : player_key($carrier);
        return $flag;
    }
    private function dropFlags(array &$player, bool $voluntary = false, ?int $flagTeam = null): array {
        $dropped = [];
        foreach ($player['flags'] as $flag) if ($flagTeam === null || $flag['team'] === $flagTeam) {
            $flag['cell'] = $player['cell']; $flag['delivered'] = $this->inGoal($player['cell'], $player['team']) ? $player['team'] : null;
            if ($voluntary) $flag['droppedBy'] = player_key($player); else unset($flag['droppedBy']);
            $this->state['flags'][] = $flag; $dropped[] = $flag;
            $this->state['knowledge'][$player['team']]['flags'][$flag['team']] = $this->flagState($flag) + ['observedAt' => $this->state['time']];
        }
        $player['flags'] = array_values(array_filter($player['flags'], fn($flag) => $flagTeam !== null && $flag['team'] !== $flagTeam));
        return $dropped;
    }
    private function ownCarrier(int $team, int $flag): bool {
        foreach ($this->state['players'] as $p) if ($p['team'] === $team) foreach ($p['flags'] as $held) if ($held['team'] === $flag) return true;
        return false;
    }
    public function observe(?int $completedTurn = null): void {
        foreach ([0, 1] as $team) $this->observeTeam($team, $team === $this->team() ? 'active' : 'sleep', $completedTurn);
    }
    private function observeTeam(int $team, string $phase, ?int $completedTurn = null): void {
        if (($this->state['ready'] ?? null) || $this->resolving) return;
        $this->state['observation'][$team] = $phase; $visible = [];
        // With fog off every piece is on show, so each team simply sees the whole board and nothing is ever an old sighting.
        if (($this->state['setup']['config']['fog'] ?? true) === false) {
            $visible = array_fill_keys(array_map('hex_key', $this->grid->cells), true);
        } else foreach ($this->state['players'] as $p) if ($p['team'] === $team) {
            $actions = $this->actions($p, $phase);
            // Frozen fog takes the vantage away with the pawn: it holds its tile but reports nothing until it thaws.
            $blind = ($this->state['setup']['config']['frozenFog'] ?? false) === true && ($p['frozen'] ?? 0) > 0;
            if (in_array('vision', $actions, true) && !$blind) $visible += $this->grid->visible($p['cell']);
        }
        $this->state['visibility'][$team] = $visible;
        $known =& $this->state['knowledge'][$team];
        $historyTurn = $phase === 'active' && $completedTurn !== null ? $completedTurn : $this->state['turn'];
        foreach ($this->state['players'] as $p) if ($p['team'] !== $team) {
            $id = player_key($p); $old = $known['players'][$id] ?? null;
            if (isset($visible[hex_key($p['cell'])])) {
                unset($p['route'], $p['touches']); $p['observedAt'] = $this->state['time']; $known['players'][$id] = $p;
                $known['history'][$historyTurn][$id] = $p;
            } elseif ($old !== null && isset($visible[hex_key($old['cell'])])) $known['players'][$id]['clearedAt'] = $this->state['time'];
        }
        $flags = array_map(fn($flag) => $this->flagState($flag), $this->state['flags']);
        foreach ($this->state['players'] as $p) foreach ($p['flags'] as $flag) $flags[] = $this->flagState($flag, $p);
        foreach ($flags as $current) {
            $old = $known['flags'][$current['team']] ?? null;
            if (isset($visible[hex_key($current['cell'])]) || $this->ownCarrier($team, $current['team'])) {
                $current['observedAt'] = $this->state['time']; $known['flags'][$current['team']] = $current;
            } elseif ($old !== null && isset($visible[hex_key($old['cell'])])) unset($known['flags'][$current['team']]);
        }
        unset($known);
    }
    private function unstacked(?array $cells = null): bool {
        $cells ??= array_column($this->state['players'], 'cell');
        return count(array_unique(array_map('hex_key', $cells))) === count($cells);
    }
    private function scoredFlags(int $team): array {
        $flags = array_values(array_filter($this->state['flags'], fn($flag) => $flag['cell'] !== null && $this->inGoal($flag['cell'], $team)));
        foreach ($this->state['players'] as $p) if ($p['team'] === $team && $this->inGoal($p['cell'], $team)) array_push($flags, ...$p['flags']);
        return $flags;
    }
    private function collectAndScore(): void {
        foreach ($this->state['flags'] as &$flag) if (isset($flag['droppedBy'])) {
            $stayed = false;
            foreach ($this->state['players'] as $player) if (player_key($player) === $flag['droppedBy'] && $player['cell'] === $flag['cell']) { $stayed = true; break; }
            if (!$stayed) unset($flag['droppedBy']);
        }
        unset($flag);
        foreach ($this->state['players'] as &$p) if ($p['team'] === $this->team() && !$p['frozen']) {
            usort($this->state['flags'], fn($a, $b) => $a['team'] <=> $b['team']);
            foreach ($this->state['flags'] as $index => $flag) {
                if (count($p['flags']) >= $this->role($p['role'])['carry']) break;
                if (($flag['droppedBy'] ?? null) === player_key($p) || $flag['cell'] !== $p['cell']) continue;
                unset($this->state['flags'][$index]);
                $flag['cell'] = null; $flag['delivered'] = null;
                unset($flag['droppedBy']);
                $p['flags'][] = $flag;
                $this->log($p['team'], player_label($p) . ' collected F' . ($flag['team'] + 1) . '.');
            }
            $this->state['flags'] = array_values($this->state['flags']);
        }
        unset($p);
        $this->checkVictory();
    }
    private function checkVictory(): void {
        if (!$this->resolving && $this->unstacked()) foreach ([0, 1] as $team) if (count($this->scoredFlags($team)) === 2) $this->state['winner'] = $team;
    }
    private function previewTurn(int $team, $plan, bool $stepping = false): ?array {
        $view = $this->view($team);
        if (!is_array($plan) || !is_array($plan['players'] ?? null) || array_values($plan['players']) !== $plan['players'] || count($plan['players']) !== count($view['own'])) return null;
        $visible = array_fill_keys($view['visible'], true);
        $locked = (bool)($view['config']['trajectoryLock'] ?? false); $started = $view['time'] > $view['turnStartedAt'];
        $board = []; $owners = [];
        foreach ($view['own'] as $p) { $board[player_key($p)] = $p; $owners[$p['index']] = player_key($p); }
        foreach ($view['enemies'] as $p) if ($p['visible']) $board[player_key($p)] = $p;
        $plans = []; $pending = []; $used = [];
        foreach ($plan['players'] as $input) {
            if (!is_array($input) || !valid_integer($input['index'] ?? null, 0, 9)) return null;
            $index = (int)$input['index'];
            if (!isset($owners[$index]) || isset($plans[$index])) return null;
            $p = $board[$owners[$index]];
            foreach (['route' => $this->movementRemaining($p), 'contacts' => count($p['touches']), 'drops' => count($p['flags'])] as $key => $limit) {
                if (!is_array($input[$key] ?? null) || array_values($input[$key]) !== $input[$key] || count($input[$key]) > $limit) return null;
            }
            $previous = $p['cell']; $route = [];
            foreach ($input['route'] as $cell) {
                if (!$this->grid->has($cell) || !$this->grid->open($cell) || hex_distance($previous, $cell) > 1) return null;
                $previous = ['q' => (int)$cell['q'], 'r' => (int)$cell['r']]; $route[] = $previous;
            }
            if ($locked && $started && $route !== $p['route']) return null;
            if ($locked && !$started && $route && !isset($visible[hex_key($previous)])) return null;
            if (!$stepping && !($locked && $started) && $route && !isset($visible[hex_key($previous)])) return null;
            if ($route && array_filter($view['enemies'], fn($enemy) => $enemy['visible'] && $enemy['cell'] === $previous)) return null;
            $ammo = $p['touches'];
            foreach ($input['contacts'] as $contact) {
                if (!is_array($contact) || !valid_integer($contact['team'] ?? null, 0, 1) || !valid_integer($contact['index'] ?? null, 0, 9) || !in_array($contact['touch'] ?? null, ['hot', 'cold', 'hotcold'], true)) return null;
                $targetKey = (int)$contact['team'] . ':' . (int)$contact['index'];
                $target = $board[$targetKey] ?? null;
                $slot = array_search($contact['touch'], $ammo, true);
                if (!$target || $targetKey === $owners[$index] || $slot === false) return null;
                if ($target['team'] === $team ? !$target['frozen'] || $contact['touch'] === 'cold' : $target['frozen'] > 0 || $contact['touch'] === 'hot') return null;
                array_splice($ammo, $slot, 1);
                $pending[] = ['index' => $index, 'target' => ['team' => (int)$contact['team'], 'index' => (int)$contact['index'], 'touch' => $contact['touch']], 'done' => false];
            }
            $drops = [];
            foreach ($input['drops'] as $flagTeam) {
                if (!valid_integer($flagTeam, 0, 1) || !($view['config']['allowVoluntaryDrops'] ?? false) || in_array((int)$flagTeam, $drops, true) || !array_filter($p['flags'], fn($flag) => $flag['team'] === (int)$flagTeam)) return null;
                $drops[] = (int)$flagTeam;
            }
            $plans[$index] = ['index' => $index, 'route' => $route, 'drops' => $drops]; $used[$index] = 0;
        }
        // Where a teammate stands now is free to finish on as long as it is leaving; a pawn that cannot move
        // is standing where it stands whatever route the plan holds for it, and two pawns cannot stop on one tile.
        $endpoints = [];
        foreach ($owners as $index => $key) {
            $p = $board[$key]; $route = $plans[$index]['route'];
            $moves = !$p['frozen'] && $this->movementRemaining($p) > 0 && in_array('movement', $this->role($p['role'])['actions']['active'], true);
            $endpoint = hex_key($moves && $route ? $route[count($route) - 1] : $p['cell']);
            if (isset($endpoints[$endpoint])) return null;
            $endpoints[$endpoint] = true;
        }
        $result = ['players' => array_values($plans), 'contacts' => [], 'drops' => []]; $dropped = [];
        $available = fn($p, $action) => !$p['frozen'] && in_array($action, $this->role($p['role'])['actions']['active'], true);
        $settle = function(int $at) use (&$board, $owners, &$pending, &$result, &$dropped, &$used, $plans, $available, $team, $view): void {
            do {
                $changed = false;
                foreach ($pending as &$contact) {
                    if ($contact['done']) continue;
                    $p =& $board[$owners[$contact['index']]];
                    $target =& $board[$contact['target']['team'] . ':' . $contact['target']['index']];
                    if ($available($p, 'touch') && hex_distance($p['cell'], $target['cell']) <= 1 && $this->grid->clearSight($p['cell'], $target['cell']) && ($target['team'] === $team ? $target['frozen'] > 0 : !$target['frozen'])) {
                        $target['frozen'] = $target['team'] === $team ? 0 : $view['config']['freezeRounds'];
                        array_splice($p['touches'], array_search($contact['target']['touch'], $p['touches'], true), 1);
                        $contact['done'] = true; $changed = true;
                        $result['contacts'][] = ['at' => $at, 'index' => $contact['index'], 'target' => $contact['target']];
                    }
                    unset($p, $target);
                }
                unset($contact);
            } while ($changed);
            foreach ($owners as $index => $key) if (!$board[$key]['frozen'] && $used[$index] === count($plans[$index]['route'])) {
                foreach ($plans[$index]['drops'] as $flagTeam) {
                    $dropKey = $index . ':' . $flagTeam;
                    if (!isset($dropped[$dropKey])) { $dropped[$dropKey] = true; $result['drops'][] = ['at' => $at, 'index' => $index, 'team' => $flagTeam]; }
                }
            }
        };
        $settle(0);
        for ($at = 1; $at <= ($stepping ? min(1, $view['remaining']) : $view['remaining']); $at++) {
            foreach ($owners as $index => $key) {
                $next = $plans[$index]['route'][$used[$index]] ?? null;
                if ($next !== null && $available($board[$key], 'movement') && $at <= $this->movementRemaining($board[$key])) { $board[$key]['cell'] = $next; $used[$index]++; }
            }
            $settle($at);
        }
        if (!$stepping) {
            foreach ($plans as $index => $p) if ($used[$index] !== count($p['route'])) return null;
            foreach ($pending as $contact) if (!$contact['done']) return null;
            if (count($result['drops']) !== array_sum(array_map(fn($p) => count($p['drops']), $plans))) return null;
        }
        if (!$stepping || $view['remaining'] === 1) {
            $cells = array_map(fn($p) => hex_key($p['cell']), $board);
            if (count(array_unique($cells)) !== count($cells)) return null;
            if ($stepping) foreach ($view['own'] as $p) if (!isset($visible[hex_key($board[player_key($p)]['cell'])]) && $board[player_key($p)]['cell'] !== $p['cell']) return null;
        }
        return $result;
    }
    private function commit(int $team, $plan): bool {
        if ($this->state['setup']['version'] >= 9 || $this->resolving) return false;
        $preview = $this->previewTurn($team, $plan);
        if ($preview === null) return false;
        $before = $this->state; $duration = $this->remaining();
        $this->resolving = true;
        try {
            foreach ($preview['players'] as $p) $this->state['players'][$this->slot($team, $p['index'])]['route'] = $p['route'];
            for ($at = 0; $at <= $duration; $at++) {
                if ($at && !$this->command($team, ['kind' => 'step'])) throw new RuntimeException('Invalid resolution.');
                foreach ($preview['contacts'] as $event) if ($event['at'] === $at) {
                    if (!$this->command($team, ['kind' => 'touch', 'index' => $event['index'], 'targetTeam' => $event['target']['team'], 'targetIndex' => $event['target']['index'], 'touch' => $event['target']['touch']])) throw new RuntimeException('Invalid contact resolution.');
                }
                foreach ($preview['drops'] as $event) if ($event['at'] === $at) {
                    $p = $this->state['players'][$this->slot($team, $event['index'])];
                    if (array_filter($p['flags'], fn($flag) => $flag['team'] === $event['team'])) $this->command($team, ['kind' => 'drop', 'index' => $event['index'], 'flagTeam' => $event['team']]);
                }
            }
        } catch (Throwable $error) { $this->state = $before; return false; }
        finally { $this->resolving = false; }
        $this->collectAndScore(); $this->observe();
        if ($this->state['winner'] === null) $this->nextTurn();
        return true;
    }
    private function nextTurn(): void {
        unset($this->state['waitingView']);
        $this->state['turn']++;
        $this->state['turnStartedAt'] = $this->state['time'];
        $this->state['turnEndsAt'] = $this->state['time'] + $this->turnDuration();
        foreach ($this->state['players'] as &$player) {
            $player['route'] = [];
            if ($player['team'] !== $this->team()) continue;
            if ($player['frozen'] > 0) { $player['frozen']--; if (!$player['frozen']) $this->log($player['team'], player_label($player) . ' thawed.'); }
            $player['touches'] = $player['frozen'] && !($this->state['setup']['config']['postThawTouches'] ?? false) ? [] : $this->role($player['role'])['touches'];
        }
        unset($player);
        $this->observe($this->state['turn'] - 1);
    }
    private function advance(int $team, $plan): bool {
        if ($this->state['setup']['version'] < 9 || $this->resolving || $this->remaining() <= 0) return false;
        $preview = $this->previewTurn($team, $plan, true);
        if ($preview === null) return false;
        $before = $this->state;
        if (!isset($this->state['waitingView'])) $this->state['waitingView'] = unserialize(serialize($this->view(1 - $team)));
        $this->resolving = true;
        try {
            foreach ($preview['players'] as $p) $this->state['players'][$this->slot($team, $p['index'])]['route'] = $p['route'];
            for ($at = 0; $at <= 1; $at++) {
                if ($at && !$this->command($team, ['kind' => 'step'])) throw new RuntimeException('Invalid step.');
                foreach ($preview['contacts'] as $event) if ($event['at'] === $at) {
                    if (!$this->command($team, ['kind' => 'touch', 'index' => $event['index'], 'targetTeam' => $event['target']['team'], 'targetIndex' => $event['target']['index'], 'touch' => $event['target']['touch']])) throw new RuntimeException('Invalid contact.');
                }
                foreach ($preview['drops'] as $event) if ($event['at'] === $at) {
                    $p = $this->state['players'][$this->slot($team, $event['index'])];
                    if (array_filter($p['flags'], fn($flag) => $flag['team'] === $event['team'])) $this->command($team, ['kind' => 'drop', 'index' => $event['index'], 'flagTeam' => $event['team']]);
                }
            }
        } catch (Throwable $error) { $this->state = $before; return false; }
        finally { $this->resolving = false; }
        $this->collectAndScore(); $this->observe();
        if ($this->state['winner'] !== null) unset($this->state['waitingView']);
        return true;
    }
    private function run(int $team, $plan): bool {
        if ($this->state['setup']['version'] < 9 || $this->resolving || $this->remaining() <= 0 || $this->previewTurn($team, $plan) === null) return false;
        $startedAt = $this->state['time'];
        $hasOrders = fn($plan) => count(array_filter($plan['players'], fn($p) => count($p['route']) || count($p['contacts']) || count($p['drops']))) > 0;
        while ($this->remaining() > 0 && $this->team() === $team && $this->state['winner'] === null && $hasOrders($plan)) {
            if (!$this->advance($team, $plan)) break;
            $view = $this->view($team); $next = [];
            foreach ($view['own'] as $p) {
                $prior = array_values(array_filter($plan['players'], fn($entry) => $entry['index'] === $p['index']))[0];
                $ammo = $p['touches']; $contacts = [];
                foreach ($prior['contacts'] as $contact) {
                    $targets = $contact['team'] === $team ? array_filter($view['own'], fn($q) => $q['index'] === $contact['index'] && $q['frozen']) : array_filter($view['enemies'], fn($q) => $q['team'] === $contact['team'] && $q['index'] === $contact['index'] && $q['visible'] && !$q['frozen']);
                    $slot = array_search($contact['touch'], $ammo, true);
                    if (!$targets || $slot === false) continue;
                    array_splice($ammo, $slot, 1); $contacts[] = $contact;
                }
                $drops = array_values(array_filter($prior['drops'], fn($flagTeam) => count(array_filter($p['flags'], fn($flag) => $flag['team'] === $flagTeam)) > 0));
                $next[] = ['index' => $p['index'], 'route' => $p['route'], 'contacts' => $contacts, 'drops' => $drops];
            }
            $plan = ['players' => $next];
        }
        return $this->state['time'] > $startedAt;
    }
    private function finishTurn(int $team): bool {
        if ($this->state['setup']['version'] < 9 || $this->resolving || !$this->unstacked()) return false;
        while ($this->remaining() > 0 && $this->state['winner'] === null) {
            $locked = (bool)($this->state['setup']['config']['trajectoryLock'] ?? false);
            $players = array_values(array_map(fn($p) => ['index' => $p['index'], 'route' => $locked ? $p['route'] : [], 'contacts' => [], 'drops' => []], array_filter($this->state['players'], fn($p) => $p['team'] === $team)));
            if (!$this->advance($team, ['players' => $players])) return false;
        }
        if ($this->state['winner'] === null) $this->nextTurn();
        return true;
    }
    public function command(int $team, array $command): bool {
        $kind = $command['kind'] ?? '';
        if ($kind === 'configure') {
            $config = $command['config'] ?? null;
            $invalid = fn() => new InvalidArgumentException('Invalid game settings.');
            if (!is_array($config) || !valid_integer($config['turnDuration'] ?? null, 1, 30) || !valid_integer($config['freezeRounds'] ?? null, 2, 6) || !is_bool($config['allowVoluntaryDrops'] ?? null)) throw $invalid();
            foreach (['postThawTouches', 'trajectoryLock', 'fog', 'frozenFog'] as $name) if (array_key_exists($name, $config) && !is_bool($config[$name])) throw $invalid();
            if (array_key_exists('sightRule', $config) && !in_array($config['sightRule'], ['area', 'centers'], true)) throw $invalid();
            $current = self::endzoneTarget($this->state['setup']);
            $target = $config['targetEndzone'] ?? null;
            if ($target !== null && (!in_array($target, ['self', 'other'], true) || $current === null)) throw $invalid();
            $target ??= $current;
            $before = $this->state['setup']['config'];
            $rules = ['turnDuration' => (int)$config['turnDuration'], 'freezeRounds' => (int)$config['freezeRounds'], 'allowVoluntaryDrops' => $config['allowVoluntaryDrops'],
                'postThawTouches' => $config['postThawTouches'] ?? false, 'trajectoryLock' => $config['trajectoryLock'] ?? false, 'fog' => $config['fog'] ?? true,
                'sightRule' => $config['sightRule'] ?? 'centers', 'frozenFog' => $config['frozenFog'] ?? false];
            $now = ['turnDuration' => $before['turnDuration'], 'freezeRounds' => $before['freezeRounds'], 'allowVoluntaryDrops' => $before['allowVoluntaryDrops'] ?? false,
                'postThawTouches' => $before['postThawTouches'] ?? false, 'trajectoryLock' => $before['trajectoryLock'] ?? false, 'fog' => $before['fog'] ?? true,
                'sightRule' => $before['sightRule'] ?? 'centers', 'frozenFog' => $before['frozenFog'] ?? false];
            if ($rules === $now && $target === $current) return false;
            // The flag target moves the scoring zones, which can hand the match to whoever is already standing in one.
            if ($target !== null && $target !== $current) {
                $homes = self::deploymentEndzones($this->state['setup']);
                $this->state['setup']['endzones'] = $target === 'self' ? $homes : [$homes[1], $homes[0]];
                $this->state['winner'] = null;
            }
            $this->state['setup']['config'] = array_merge($before, $rules);
            // The grid holds the sight rule and caches every sight set it has computed, so a new rule needs a new grid.
            if ($rules['sightRule'] !== $now['sightRule']) {
                $c = $this->state['setup']['config'];
                $this->grid = new HexGrid($c['columns'], $c['rows'], $this->state['setup']['obstacles'], $this->state['setup']['outOfBounds'] ?? [], $c['left'] ?? 0, $c['top'] ?? 0, $c['sightRule']);
            }
            if ($target !== null && $target !== $current) $this->checkVictory();
            if ($rules['postThawTouches'] !== $now['postThawTouches']) foreach ($this->state['players'] as &$frozen) {
                if ($frozen['frozen']) $frozen['touches'] = $rules['postThawTouches'] ? array_values($this->role($frozen['role'])['touches']) : [];
            }
            unset($frozen);
            $this->state['turnEndsAt'] = max($this->state['time'], ($this->state['turnStartedAt'] ?? 0) + $this->turnDuration());
            foreach ($this->state['players'] as &$player) if ($player['team'] === $this->team()) $player['route'] = array_slice($player['route'], 0, $this->movementRemaining($player));
            unset($player);
            unset($this->state['waitingView']);
            $this->observe();
            return true;
        }
        if ($kind === 'ready') {
            if (!is_bool($command['ready'] ?? null)) throw new InvalidArgumentException('Invalid readiness.');
            if (!($this->state['ready'] ?? null)) return false;
            $this->state['ready'][$team] = $command['ready'];
            if ($this->state['ready'][0] && $this->state['ready'][1]) { $this->state['ready'] = null; $this->observe(); }
            return true;
        }
        if ($kind === 'deploy') {
            if (!valid_integer($command['index'] ?? null, 0, $this->state['setup']['config']['playersPerTeam'] - 1)) throw new InvalidArgumentException('Invalid piece.');
            if (!($this->state['ready'] ?? null) || $this->state['ready'][$team] || !$this->grid->has($command['destination'] ?? null)) return false;
            $destination = ['q' => (int)$command['destination']['q'], 'r' => (int)$command['destination']['r']];
            if (!$this->grid->open($destination) || !in_array($destination, self::deploymentEndzones($this->state['setup'])[$team], true)) return false;
            $slot = $this->slot($team, (int)$command['index']);
            $old = $this->state['players'][$slot]['cell'];
            foreach ($this->state['players'] as &$player) if ($player['team'] === $team && $player['cell'] === $destination) $player['cell'] = $old;
            unset($player);
            $this->state['players'][$slot]['cell'] = $destination;
            return true;
        }
        if (($this->state['ready'] ?? null) || $this->state['winner'] !== null || $team !== $this->team()) return false;
        if ($kind === 'commit') return $this->commit($team, $command['plan'] ?? null);
        if ($kind === 'advance') return $this->advance($team, $command['plan'] ?? null);
        if ($kind === 'run') return $this->run($team, $command['plan'] ?? null);
        if ($kind === 'finish_turn') return $this->finishTurn($team);
        if ($kind === 'grab') {
            if ($this->state['setup']['version'] < 10 || $this->resolving) return false;
            $count = $this->state['setup']['config']['playersPerTeam'];
            if (!valid_integer($command['index'] ?? null, 0, $count - 1) || !valid_integer($command['flagTeam'] ?? null, 0, 1)) throw new InvalidArgumentException('Invalid flag grab.');
            $slot = $this->slot($team, (int)$command['index']);
            $p =& $this->state['players'][$slot];
            $flagTeam = (int)$command['flagTeam'];
            $visible = array_values(array_filter($this->view($team)['flags'], fn($flag) => $flag['team'] === $flagTeam && $flag['visible']))[0] ?? null;
            if (!$visible || !$this->canGrabFlag($p, $visible)) return false;
            $carrier = null;
            foreach ($this->state['players'] as $i => $candidate) if (in_array($flagTeam, array_column($candidate['flags'], 'team'), true)) { $carrier = $i; break; }
            $at = array_search($flagTeam, array_column($carrier === null ? $this->state['flags'] : $this->state['players'][$carrier]['flags'], 'team'), true);
            if ($at === false) return false;
            if (!isset($this->state['waitingView'])) $this->state['waitingView'] = unserialize(serialize($this->view(1 - $team)));
            $flag = $carrier === null ? array_splice($this->state['flags'], $at, 1)[0] : array_splice($this->state['players'][$carrier]['flags'], $at, 1)[0];
            $flag['cell'] = null; $flag['delivered'] = null; unset($flag['droppedBy']);
            $p['flags'][] = $flag;
            $this->log($team, player_label($p) . ' grabbed F' . ($flagTeam + 1) . ($carrier === null ? '' : ' from ' . player_label($this->state['players'][$carrier])) . '.');
            unset($p);
            $this->collectAndScore();
            $this->observe();
            return true;
        }
        if ($kind === 'pass') {
            if ($this->state['setup']['version'] < 10 || $this->resolving) return false;
            $count = $this->state['setup']['config']['playersPerTeam'];
            if (!valid_integer($command['index'] ?? null, 0, $count - 1) || !valid_integer($command['targetIndex'] ?? null, 0, $count - 1) || !valid_integer($command['flagTeam'] ?? null, 0, 1)) throw new InvalidArgumentException('Invalid flag pass.');
            $slot = $this->slot($team, (int)$command['index']);
            $targetSlot = $this->slot($team, (int)$command['targetIndex']);
            $p =& $this->state['players'][$slot];
            $other =& $this->state['players'][$targetSlot];
            $flagTeam = (int)$command['flagTeam'];
            $flagIndex = array_search($flagTeam, array_column($p['flags'], 'team'), true);
            if ($slot === $targetSlot || $p['frozen'] || $other['frozen'] || $flagIndex === false || count($other['flags']) >= $this->role($other['role'])['carry'] || hex_distance($p['cell'], $other['cell']) > 1 || !$this->grid->clearSight($p['cell'], $other['cell'])) return false;
            if (!isset($this->state['waitingView'])) $this->state['waitingView'] = unserialize(serialize($this->view(1 - $team)));
            $other['flags'][] = array_splice($p['flags'], $flagIndex, 1)[0];
            $this->log($team, player_label($p) . ' passed F' . ($flagTeam + 1) . ' to ' . player_label($other) . '.');
            unset($p, $other);
            $this->collectAndScore();
            $this->observe();
            return true;
        }
        if ($this->state['setup']['version'] >= 8 && !$this->resolving && ($this->state['setup']['version'] < 9 || ($kind !== 'touch' && !($this->state['setup']['version'] >= 10 && $kind === 'drop')))) return false;
        if (in_array($kind, ['order', 'hold', 'touch', 'drop'], true)) {
            if (!valid_integer($command['index'] ?? null, 0, $this->state['setup']['config']['playersPerTeam'] - 1)) throw new InvalidArgumentException('Invalid piece.');
            $slot = $this->slot($team, (int)$command['index']); $p =& $this->state['players'][$slot];
        }
        if ($kind === 'order') {
            if (!in_array('movement', $this->actions($p), true) || !$this->grid->has($command['destination'] ?? null)) return false;
            $destination = ['q' => (int)$command['destination']['q'], 'r' => (int)$command['destination']['r']];
            $route = $this->grid->path($p['cell'], $destination, $this->movementRemaining($p));
            if ($route === null) return false;
            $p['route'] = $route; return true;
        }
        if ($kind === 'hold') { $p['route'] = []; return true; }
        if ($kind === 'drop') {
            if (array_key_exists('flagTeam', $command) && !valid_integer($command['flagTeam'], 0, 1)) throw new InvalidArgumentException('Invalid flag.');
            $flagTeam = isset($command['flagTeam']) ? (int)$command['flagTeam'] : null;
            if (!($this->state['setup']['config']['allowVoluntaryDrops'] ?? false) || $p['frozen'] || !array_filter($p['flags'], fn($flag) => $flagTeam === null || $flag['team'] === $flagTeam)) return false;
            if ($this->state['setup']['version'] >= 9 && !$this->resolving && !isset($this->state['waitingView'])) $this->state['waitingView'] = unserialize(serialize($this->view(1 - $team)));
            foreach ($this->dropFlags($p, true, $flagTeam) as $flag) $this->log($team, player_label($p) . ' dropped F' . ($flag['team'] + 1) . '.');
            unset($p);
            $this->collectAndScore(); $this->observe(); return true;
        }
        if ($kind === 'step') {
            if ($this->remaining() <= 0) return false;
            $destinations = []; $steps = [];
            foreach ($this->state['players'] as $mover) {
                $next = $mover['route'][0] ?? null;
                $step = $mover['team'] === $team && $this->movementRemaining($mover) > 0 && in_array('movement', $this->actions($mover), true) && $next !== null && $this->grid->open($next) && hex_distance($mover['cell'], $next) <= 1;
                $steps[] = $step;
                $destinations[] = $step ? $next : $mover['cell'];
            }
            if ($this->remaining() === 1 && !$this->unstacked($destinations)) return false;
            foreach ($this->state['players'] as $i => &$mover) {
                if ($steps[$i]) $mover['cell'] = array_shift($mover['route']);
            }
            unset($mover);
            $this->state['time']++;
            foreach ($this->state['players'] as &$mover) if ($mover['team'] === $team) $mover['route'] = array_slice($mover['route'], 0, $this->movementRemaining($mover));
            unset($mover);
            $this->collectAndScore(); $this->observe(); return true;
        }
        if ($kind === 'end_turn') {
            if (!$this->unstacked()) return false;
            foreach ($this->state['players'] as &$player) $player['route'] = [];
            unset($player);
            $this->state['time'] = $this->state['turnEndsAt']; $this->observe(); $this->nextTurn(); return true;
        }
        if ($kind === 'touch') {
            if (!valid_integer($command['targetTeam'] ?? null, 0, 1) || !valid_integer($command['targetIndex'] ?? null, 0, $this->state['setup']['config']['playersPerTeam'] - 1) || !in_array($command['touch'] ?? null, ['hot', 'cold', 'hotcold'], true)) throw new InvalidArgumentException('Invalid touch.');
            $targetSlot = $this->slot((int)$command['targetTeam'], (int)$command['targetIndex']);
            if ($targetSlot === $slot) return false;
            $other =& $this->state['players'][$targetSlot]; $touch = $command['touch'];
            if (!in_array('touch', $this->actions($p), true) || !in_array($touch, $p['touches'], true) || hex_distance($p['cell'], $other['cell']) > 1 || !$this->grid->clearSight($p['cell'], $other['cell'])) return false;
            $friendly = $team === $other['team'];
            if ($friendly ? !$other['frozen'] || $touch === 'cold' : $other['frozen'] > 0 || $touch === 'hot') return false;
            if ($this->state['setup']['version'] >= 9 && !$this->resolving) {
                if (!$friendly && !isset($this->state['visibility'][$team][hex_key($other['cell'])])) return false;
                if (!isset($this->state['waitingView'])) $this->state['waitingView'] = unserialize(serialize($this->view(1 - $team)));
            }
            array_splice($p['touches'], array_search($touch, $p['touches'], true), 1);
            if ($friendly) { $other['frozen'] = 0; $this->log($team, player_label($p) . ' revived ' . player_label($other) . '. ' . $this->movementRemaining($other) . ' t left.'); }
            else {
                $other['frozen'] = $this->state['setup']['config']['freezeRounds']; $other['route'] = [];
                $this->log($team, player_label($p) . ' froze ' . player_label($other) . '.'); $this->log($other['team'], player_label($other) . ' was tagged.');
            }
            unset($p, $other);
            $this->collectAndScore(); $this->observe(); return true;
        }
        throw new InvalidArgumentException('Unknown command.');
    }
    public function view(int $team): array {
        if ($this->state['setup']['version'] >= 9 && ($this->state['waitingView']['team'] ?? null) === $team && $this->team() !== $team && $this->state['winner'] === null) return $this->state['waitingView'];
        $known = $this->state['knowledge'][$team]; $visible = $this->state['visibility'][$team];
        ksort($known['flags']);
        return ['team' => $team, 'activeTeam' => $this->team(), 'turn' => $this->state['turn'], 'time' => $this->state['time'], 'turnStartedAt' => $this->state['turnStartedAt'], 'remaining' => $this->remaining(), 'ready' => $this->state['ready'] ?? null,
            'observation' => $this->state['observation'][$team], 'config' => $this->state['setup']['config'], 'visible' => array_keys($visible),
            'own' => array_values(array_filter($this->state['players'], fn($p) => $p['team'] === $team)),
            'enemies' => array_values(array_map(fn($p) => $p + ['visible' => !isset($p['clearedAt']) && isset($visible[hex_key($p['cell'])])], $known['players'])),
            'enemyIndices' => array_column(array_filter($this->state['players'], fn($p) => $p['team'] !== $team), 'index'),
            'enemyHistory' => (object)$known['history'], 'enemyHistoryUnit' => 'turn',
            'flags' => array_values(array_map(fn($flag) => $flag + ['visible' => isset($visible[hex_key($flag['cell'])]) || $this->ownCarrier($team, $flag['team'])], $known['flags'])),
            'scores' => array_map(fn($t) => count($this->scoredFlags($t)), [0, 1]),
            'events' => $this->state['events'][$team], 'winner' => $this->state['winner']];
    }
}
