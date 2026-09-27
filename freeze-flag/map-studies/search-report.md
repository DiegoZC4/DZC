# 10hex search benchmark: fixed-count slice descent versus greedy growth

Generated 2026-09-13 22:08 by `python3 tools/benchmark_report.py` from the JSON files in `data/map-studies/benchmarks/`. Board: 10hex, 271 tiles, full hex symmetry (30° slice), 28 candidate slice positions with orbit costs 1, 6 and 12; endzones reserved; field connectivity and the two-route check mandatory unless stated.

## Recommendation

# Recommendation: slice descent with cost-neutral exchanges, scored by the original formula with dashed walls counted as walls

- Algorithm: the proposed fixed-count descent (random slice placement, best single-obstacle same-cost relocation until no legal move improves) outperforms the default greedy search and its larger-budget variant: on the 16 fully enumerated counts (≤ 48 barriers) its median gap to the certified optimum is 0.21 tiles and it hits 15 of 16 optima in 4.5 s, against 14.28 tiles and 6 of 16 for the greedy search at default settings (0.7 s) and 3.92 tiles and 10 of 16 with 4× restarts and 10× relocation attempts (12 s). Every kept layout is a certified one-move local minimum, which is not a global optimum.
- Cost-neutral exchanges (one 12-tile obstacle ↔ two 6-tile ones at the same board count) close the rest: certified gap 0.00, 16 of 16 optima, and 29 of 32 compared counts at the best known layout in 19 s; with only 2 restarts (7 s) exchanges still beat plain descent with 6 restarts, while 20 restarts or a wider slice-count range without exchanges do not. Shake rounds change little (0.05 versus 0.08 with exchanges) at twice the time, so they stay optional and off.
- Fixed slice count is not fixed board count (orbit costs 1, 6 or 12), so the search runs every orbit mix separately, relocates only between same-cost positions, and reports both counts; comparisons are made per board count. Above 48 barriers the exhaustive certificate covers at most 8 slice obstacles, so exchange results there can beat it legitimately.
- Scoring failure found: under mean visibility plus the adjacency wall penalty, the checked optima at 36, 48, 60 and 72 barriers form a connected network of dashed walls containing all the barriers and dividing the board into sectors; many sightings offer no one-step escape (escapable visible tiles per viewpoint 25, 17, 9 and 12 at 36, 48, 60 and 72 barriers). Without any wall penalty the optimizer builds solid walls up to 11 tiles long. The route constraint never bound at these counts and stays on as a guard.
- Recommended score: keep the original formula but count barriers one gap apart along a straight line as the same wall (Gap-linked walls on, cluster size 4, weight 1). The selected maps at these four budgets have scattered clusters of at most 4 or 5 tiles with no dead ends; about half of visible ordered tile pairs offer a one-step escape (escapable share 0.49 to 0.57). The honest price is visibility: mean visible tiles rise from 47 to 72 at 48 barriers and from 35 to 60 at 60, so each barrier hides less, and beyond about 60 barriers the wall limit binds (72 barriers score worse than 60; raise the unpenalized cluster size or turn the option off for denser maps).
- Breakaway weight 1 is too strong: it produces pillar fields (largest cluster 1, mean visibility 93 to 95 at 36 barriers, 54 at 72). Weights of 0.25 to 0.5 only nudge results at 48 and 60 barriers (more escapable sight for a few more visible tiles) and cost 10× per evaluation, so they stay optional. Corridor and open-view penalties never bind at 36 or 48 barriers; corridor 0.5 removes 12 corridor tiles at 60 for +0.8 mean visibility, and the open-view cap trims one 163-tile lane at 48 to 101 for +1; both stay available at zero. None of this is a measure of strategic balance.

## Exhaustive ground truth

`tools/exhaustive_visibility.py --max-n 8` scored every layout with at most 8 slice obstacles (4,791,322 layouts, 308 s) under the current objective and kept the best legal layout per board count. Optima are complete for counts up to 48 barriers (every orbit mix of those counts fits within 8 slice obstacles); above that only mixes with at most 8 slice obstacles were enumerated, so those values are upper bounds on the true optimum.

| barriers | optimum | slice mix | greedy study | greedy gap |
|---:|---:|:---|---:|---:|
| 1 | 262.78 | 1 slice: centre | 262.78 | 0.00 |
| 6 | 219.51 | 1 slice: 1×6 | 219.51 | 0.00 |
| 7 | 208.18 | 2 slice: 1×6 + centre | 208.18 | 0.00 |
| 12 | 172.66 | 2 slice: 2×6 | 192.00 | 19.34 |
| 13 | 169.00 | 2 slice: 1×12 + centre | 171.84 | 2.84 |
| 18 | 130.82 | 3 slice: 3×6 | 204.72 | 73.90 |
| 19 | 129.81 | 4 slice: 3×6 + centre | 129.81 | 0.00 |
| 24 | 101.42 | 4 slice: 4×6 | 164.82 | 63.40 |
| 25 | 100.27 | 5 slice: 4×6 + centre | 100.27 | 0.00 |
| 30 | 79.32 | 5 slice: 5×6 | 93.07 | 13.74 |
| 31 | 78.05 | 6 slice: 5×6 + centre | 78.05 | 0.00 |
| 36 | 67.49 | 5 slice: 1×12 + 4×6 | 76.88 | 9.40 |
| 37 | 66.18 | 6 slice: 1×12 + 4×6 + centre | 67.41 | 1.23 |
| 42 | 56.83 | 6 slice: 1×12 + 5×6 | 56.83 | 0.00 |
| 43 | 53.26 | 7 slice: 1×12 + 5×6 + centre | 53.26 | 0.00 |
| 48 | 47.39 | 7 slice: 1×12 + 6×6 | 47.74 | 0.35 |
| 49* | 47.00 | 8 slice: 1×12 + 6×6 + centre | 47.86 | 0.86 |
| 54* | 39.93 | 8 slice: 1×12 + 7×6 | 40.07 | 0.14 |
| 55* | 39.39 | 8 slice: 2×12 + 5×6 + centre | 39.39 | 0.00 |
| 60* | 34.73 | 8 slice: 2×12 + 6×6 | 38.93 | 4.21 |
| 61* | 35.06 | 7 slice: 4×12 + 2×6 + centre | 37.91 | 2.86 |
| 66* | 28.92 | 7 slice: 4×12 + 3×6 | — | — |
| 67* | 28.12 | 8 slice: 4×12 + 3×6 + centre | 28.12 | 0.00 |
| 72* | 27.05 | 8 slice: 4×12 + 4×6 | — | — |
| 73* | 27.79 | 8 slice: 5×12 + 2×6 + centre | 29.91 | 2.12 |
| 78* | 21.64 | 8 slice: 5×12 + 3×6 | — | — |
| 79* | 23.19 | 8 slice: 6×12 + 1×6 + centre | 20.75 | -2.44 |
| 84* | 22.79 | 8 slice: 6×12 + 2×6 | — | — |
| 85* | 25.71 | 8 slice: 7×12 + centre | 19.06 | -6.65 |
| 90* | 22.31 | 8 slice: 7×12 + 1×6 | — | — |
| 96* | 29.73 | 8 slice: 8×12 | — | — |

\* optimum among layouts with at most 8 slice obstacles only.

## Algorithm comparison under the current objective

`tools/benchmark_search.py` ran every condition with seeds [173, 1, 2, 3, 4] on the same packed geometry; all conditions use the original score (mean visible + wall penalty, cluster size 4, weight 1) and the same legality rules. The search spaces are not identical: the greedy search stops at its 90-barrier cap, the plain descent covers slice counts up to its limit (8, or 14 for descent-wide), and exchange conditions can drift to more than 8 slice obstacles at the same board count. The overall gap (score minus the best layout known for that count across every run and the exhaustive optimum) therefore averages, for each run, only over the counts that run actually produced (up to 96 barriers; denser layouts are dominated by wall penalties), and "counts covered" shows how many of the 32 counts each condition reached. The clean like-for-like comparison is the "certified" pair of columns: the 16 counts ≤ 48 barriers where the exhaustive optimum is exact for every orbit mix.

| condition | settings | median gap | best-seed gap | counts at best-known (median) | counts covered (median) | certified gap | certified optima hit | median seconds | median evaluations | converged | distinct minima |
|:--|:--|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| greedy-default | defaults | 9.71 | 5.38 | 9 / 32 | 25 / 32 | 14.28 | 6 / 16 | 0.7 | 4,074 | —% | — |
| greedy-heavy | restarts=24, swaps=2000 | 2.70 | 1.94 | 17 / 32 | 28 / 32 | 3.92 | 10 / 16 | 12.2 | 65,854 | —% | — |
| descent | sliceObstacles=8, restarts=6, perturbations=0, exchanges=0 | 1.55 | 1.53 | 19 / 32 | 31 / 32 | 0.21 | 15 / 16 | 4.5 | 65,081 | 100% | 270 |
| descent-exchange | sliceObstacles=8, restarts=6, perturbations=0, exchanges=1 | 0.08 | 0.04 | 29 / 32 | 31 / 32 | 0.00 | 16 / 16 | 19.0 | 272,772 | 100% | 188 |
| descent-ils | sliceObstacles=8, restarts=6, perturbations=4, perturbStrength=2, exchanges=0 | 1.30 | 1.23 | 20 / 32 | 31 / 32 | 0.08 | 15 / 16 | 9.6 | 136,391 | 100% | 433 |
| descent-ils-exchange | sliceObstacles=8, restarts=6, perturbations=4, perturbStrength=2, exchanges=1 | 0.05 | 0.00 | 30 / 32 | 31 / 32 | 0.00 | 16 / 16 | 34.7 | 481,397 | 100% | 247 |
| descent-heavy | sliceObstacles=8, restarts=20, perturbations=0, exchanges=0 | 1.20 | 1.17 | 21 / 32 | 31 / 32 | 0.08 | 15 / 16 | 12.6 | 176,092 | 100% | 541 |
| descent-wide | sliceObstacles=14, restarts=6, perturbations=0, exchanges=0 | 0.64 | 0.45 | 21 / 32 | 32 / 32 | 0.21 | 15 / 16 | 18.4 | 240,576 | 100% | 716 |
| descent-exchange-r2 | sliceObstacles=8, restarts=2, perturbations=0, exchanges=1 | 0.44 | 0.28 | 24 / 32 | 31 / 32 | 0.00 | 16 / 16 | 7.3 | 109,003 | 100% | 99 |

### Per-count scores (median over seeds; best seed in parentheses)

A dash means the condition produced no layout at that count. Above 48 barriers the exhaustive optimum (*) covers at most 8 slice obstacles, so exchange conditions can legitimately score below it by using more slice obstacles.

| barriers | exhaustive optimum | best known | greedy-default | greedy-heavy | descent | descent-exchange | descent-ils | descent-ils-exchange | descent-heavy | descent-wide | descent-exchange-r2 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 12 | 172.66 | 172.66 | 209.24 (192.00) | 177.43 (172.66) | 172.66 (172.66) | 172.66 (172.66) | 172.66 (172.66) | 172.66 (172.66) | 172.66 (172.66) | 172.66 (172.66) | 172.66 (172.66) |
| 18 | 130.82 | 130.82 | 177.89 (142.01) | 147.44 (142.34) | 130.82 (130.82) | 130.82 (130.82) | 130.82 (130.82) | 130.82 (130.82) | 130.82 (130.82) | 130.82 (130.82) | 130.82 (130.82) |
| 24 | 101.42 | 101.42 | 164.82 (159.84) | 121.56 (101.42) | 101.42 (101.42) | 101.42 (101.42) | 101.42 (101.42) | 101.42 (101.42) | 101.42 (101.42) | 101.42 (101.42) | 101.42 (101.42) |
| 30 | 79.32 | 79.32 | 111.81 (90.05) | 82.16 (79.32) | 79.32 (79.32) | 79.32 (79.32) | 79.32 (79.32) | 79.32 (79.32) | 79.32 (79.32) | 79.32 (79.32) | 79.32 (79.32) |
| 36 | 67.49 | 67.49 | 77.77 (74.05) | 74.05 (67.49) | 67.49 (67.49) | 67.49 (67.49) | 67.49 (67.49) | 67.49 (67.49) | 67.49 (67.49) | 67.49 (67.49) | 67.49 (67.49) |
| 42 | 56.83 | 56.83 | 63.04 (56.83) | 56.83 (56.83) | 56.83 (56.83) | 56.83 (56.83) | 56.83 (56.83) | 56.83 (56.83) | 56.83 (56.83) | 56.83 (56.83) | 56.83 (56.83) |
| 48 | 47.39 | 47.39 | 49.58 (47.39) | 47.39 (47.39) | 47.39 (47.39) | 47.39 (47.39) | 47.39 (47.39) | 47.39 (47.39) | 47.39 (47.39) | 47.39 (47.39) | 47.39 (47.39) |
| 54 | 39.93* | 39.93 | 40.07 (39.93) | 39.93 (39.93) | 40.07 (39.93) | 39.93 (39.93) | 39.93 (39.93) | 39.93 (39.93) | 39.93 (39.93) | 40.07 (39.93) | 39.93 (39.93) |
| 60 | 34.73* | 34.73 | 37.88 (35.52) | 37.23 (34.73) | 34.73 (34.73) | 34.73 (34.73) | 34.73 (34.73) | 34.73 (34.73) | 34.73 (34.73) | 34.73 (34.73) | 34.73 (34.73) |
| 66 | 28.92* | 28.63 | 28.92 (28.63) | 28.63 (28.63) | 28.92 (28.92) | 28.63 (28.63) | 28.92 (28.92) | 28.63 (28.63) | 28.92 (28.92) | 28.92 (28.63) | 28.63 (28.63) |
| 72 | 27.05* | 26.39 | 28.65 (28.65) | 27.41 (27.11) | 27.05 (27.05) | 26.39 (26.39) | 27.05 (27.05) | 26.39 (26.39) | 27.05 (27.05) | 27.05 (26.87) | 26.39 (26.39) |
| 78 | 21.64* | 21.64 | 21.64 (21.64) | — | 21.64 (21.64) | 21.64 (21.64) | 21.64 (21.64) | 21.64 (21.64) | 21.64 (21.64) | 21.64 (21.64) | 21.64 (21.64) |
| 84 | 22.79* | 19.80 | — | 19.80 (19.80) | 24.04 (22.79) | 19.80 (19.80) | 22.79 (22.79) | 19.80 (19.80) | 24.04 (22.79) | 19.99 (19.80) | 19.99 (19.80) |
| 90 | 22.31* | 17.31 | — | — | 22.85 (22.31) | 17.31 (17.31) | 22.31 (22.31) | 17.31 (17.31) | 22.58 (22.31) | 18.50 (17.31) | 18.83 (17.31) |
| 96 | 29.73* | 16.22 | — | — | 29.73 (29.73) | 18.01 (16.22) | 29.73 (29.73) | 16.22 (16.22) | 29.73 (29.73) | 17.80 (16.22) | 18.66 (18.66) |

## Scoring study

`tools/scoring_study.py` optimised barrier counts [36, 48, 60, 72] under each objective with the slice descent (exchanges on, 2 shake rounds, 4 restarts per mix, seeds [173, 1, 2]) and measured every result with the same component metrics. Values are medians over seeds. currentScore is the original objective evaluated on the map, whatever objective produced it; escapesPerTile counts visible tiles per viewpoint whose occupant can step out of sight in one move.

### 36 barriers

| objective | currentScore | meanVisible | escapesPerTile | breakawayShare | visibilityMedian | visibilityMax | corridorTiles | deadEnds | articulationPoints | endzoneDistance | largestCluster | largestWall | wallPenalty | cyclomatic |
|:--|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gap-walls | 85.3 | 85.3 | 43.4 | 0.514 | 76.0 | 175.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 324.0 |
| gap-walls+breakaway-0.25 | 85.3 | 85.3 | 43.4 | 0.514 | 76.0 | 175.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 324.0 |
| gap-walls+breakaway-0.5 | 85.3 | 85.3 | 43.4 | 0.514 | 76.0 | 175.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 324.0 |
| gap-walls+breakaway-1 | 94.5 | 94.5 | 58.1 | 0.621 | 93.0 | 175.0 | 0.0 | 0.0 | 0.0 | 18.0 | 2.0 | 6.0 | 0.0 | 312.0 |
| gap-walls+breakaway-0.5+open | 85.3 | 85.3 | 43.4 | 0.514 | 76.0 | 175.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 324.0 |
| gap-walls+breakaway-0.5+corridor | 85.3 | 85.3 | 43.4 | 0.514 | 76.0 | 175.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 324.0 |
| corridor-0.5 | 67.5 | 67.5 | 25.4 | 0.382 | 63.0 | 113.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 36.0 | 0.0 | 330.0 |
| current | 67.5 | 67.5 | 25.4 | 0.382 | 63.0 | 113.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 36.0 | 0.0 | 330.0 |
| mean-only | 70.8 | 64.8 | 20.8 | 0.326 | 60.0 | 133.0 | 0.0 | 0.0 | 0.0 | 18.0 | 5.0 | 36.0 | 6.0 | 330.0 |
| no-routes | 67.5 | 67.5 | 25.4 | 0.382 | 63.0 | 113.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 36.0 | 0.0 | 330.0 |
| breakaway-0.5 | 67.5 | 67.5 | 25.4 | 0.382 | 63.0 | 113.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 36.0 | 0.0 | 330.0 |
| combined | 83.3 | 83.3 | 50.5 | 0.614 | 80.0 | 133.0 | 0.0 | 0.0 | 0.0 | 19.0 | 1.0 | 36.0 | 0.0 | 306.0 |
| breakaway-1 | 92.7 | 92.7 | 59.9 | 0.654 | 91.0 | 181.0 | 0.0 | 0.0 | 0.0 | 18.0 | 1.0 | 24.0 | 0.0 | 306.0 |
| open-cap100-0.02 | 67.5 | 67.5 | 25.4 | 0.382 | 63.0 | 113.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 36.0 | 0.0 | 330.0 |

### 48 barriers

| objective | currentScore | meanVisible | escapesPerTile | breakawayShare | visibilityMedian | visibilityMax | corridorTiles | deadEnds | articulationPoints | endzoneDistance | largestCluster | largestWall | wallPenalty | cyclomatic |
|:--|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gap-walls | 71.8 | 71.8 | 35.0 | 0.494 | 66.0 | 163.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 282.0 |
| gap-walls+breakaway-0.25 | 72.2 | 72.2 | 37.9 | 0.532 | 67.0 | 163.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 282.0 |
| gap-walls+breakaway-0.5 | 75.7 | 75.7 | 45.6 | 0.611 | 69.0 | 151.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 264.0 |
| gap-walls+breakaway-1 | 75.7 | 75.7 | 45.6 | 0.611 | 69.0 | 151.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 264.0 |
| gap-walls+breakaway-0.5+open | 72.8 | 72.8 | 39.9 | 0.555 | 68.0 | 101.0 | 0.0 | 0.0 | 0.0 | 19.0 | 3.0 | 6.0 | 0.0 | 276.0 |
| gap-walls+breakaway-0.5+corridor | 75.7 | 75.7 | 45.6 | 0.611 | 69.0 | 151.0 | 0.0 | 0.0 | 0.0 | 18.0 | 4.0 | 6.0 | 0.0 | 264.0 |
| corridor-0.5 | 47.4 | 47.4 | 16.8 | 0.363 | 44.0 | 68.0 | 0.0 | 0.0 | 0.0 | 19.0 | 3.0 | 48.0 | 0.0 | 270.0 |
| current | 47.4 | 47.4 | 16.8 | 0.363 | 44.0 | 68.0 | 0.0 | 0.0 | 0.0 | 19.0 | 3.0 | 48.0 | 0.0 | 270.0 |
| mean-only | 100.6 | 46.6 | 13.5 | 0.297 | 41.0 | 75.0 | 6.0 | 0.0 | 0.0 | 19.0 | 7.0 | 48.0 | 54.0 | 282.0 |
| no-routes | 47.4 | 47.4 | 16.8 | 0.363 | 44.0 | 68.0 | 0.0 | 0.0 | 0.0 | 19.0 | 3.0 | 48.0 | 0.0 | 270.0 |
| breakaway-0.5 | 56.0 | 56.0 | 35.6 | 0.647 | 53.0 | 103.0 | 0.0 | 0.0 | 0.0 | 19.0 | 1.0 | 48.0 | 0.0 | 246.0 |
| combined | 67.5 | 67.5 | 47.4 | 0.713 | 67.0 | 93.0 | 0.0 | 0.0 | 0.0 | 18.0 | 1.0 | 48.0 | 0.0 | 246.0 |
| breakaway-1 | 67.5 | 67.5 | 47.4 | 0.713 | 67.0 | 93.0 | 0.0 | 0.0 | 0.0 | 18.0 | 1.0 | 48.0 | 0.0 | 246.0 |
| open-cap100-0.02 | 47.4 | 47.4 | 16.8 | 0.363 | 44.0 | 68.0 | 0.0 | 0.0 | 0.0 | 19.0 | 3.0 | 48.0 | 0.0 | 270.0 |

### 60 barriers

| objective | currentScore | meanVisible | escapesPerTile | breakawayShare | visibilityMedian | visibilityMax | corridorTiles | deadEnds | articulationPoints | endzoneDistance | largestCluster | largestWall | wallPenalty | cyclomatic |
|:--|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gap-walls | 66.0 | 60.0 | 33.4 | 0.567 | 59.0 | 127.0 | 0.0 | 0.0 | 0.0 | 19.0 | 5.0 | 6.0 | 6.0 | 252.0 |
| gap-walls+breakaway-0.25 | 66.0 | 60.0 | 33.4 | 0.567 | 59.0 | 127.0 | 0.0 | 0.0 | 0.0 | 19.0 | 5.0 | 6.0 | 6.0 | 252.0 |
| gap-walls+breakaway-0.5 | 67.6 | 67.6 | 38.2 | 0.573 | 64.0 | 139.0 | 18.0 | 0.0 | 0.0 | 19.0 | 4.0 | 6.0 | 0.0 | 234.0 |
| gap-walls+breakaway-1 | 67.6 | 67.6 | 38.2 | 0.573 | 64.0 | 139.0 | 18.0 | 0.0 | 0.0 | 19.0 | 4.0 | 6.0 | 0.0 | 234.0 |
| gap-walls+breakaway-0.5+open | 67.6 | 67.6 | 38.2 | 0.573 | 64.0 | 139.0 | 18.0 | 0.0 | 0.0 | 19.0 | 4.0 | 6.0 | 0.0 | 234.0 |
| gap-walls+breakaway-0.5+corridor | 66.0 | 60.0 | 33.4 | 0.567 | 59.0 | 127.0 | 0.0 | 0.0 | 0.0 | 19.0 | 5.0 | 6.0 | 6.0 | 252.0 |
| corridor-0.5 | 35.5 | 35.5 | 15.5 | 0.448 | 39.0 | 53.0 | 0.0 | 0.0 | 0.0 | 19.0 | 3.0 | 60.0 | 0.0 | 222.0 |
| current | 34.7 | 34.7 | 8.8 | 0.260 | 29.0 | 53.0 | 12.0 | 0.0 | 0.0 | 18.0 | 4.0 | 60.0 | 0.0 | 228.0 |
| mean-only | 130.2 | 34.2 | 14.0 | 0.421 | 33.0 | 65.0 | 0.0 | 0.0 | 0.0 | 22.0 | 8.0 | 60.0 | 96.0 | 234.0 |
| no-routes | 34.7 | 34.7 | 8.8 | 0.260 | 29.0 | 53.0 | 12.0 | 0.0 | 0.0 | 18.0 | 4.0 | 60.0 | 0.0 | 228.0 |
| breakaway-0.5 | 38.6 | 38.6 | 22.6 | 0.601 | 37.0 | 50.0 | 0.0 | 0.0 | 0.0 | 19.0 | 3.0 | 60.0 | 0.0 | 198.0 |
| combined | 44.6 | 44.6 | 30.5 | 0.700 | 44.0 | 63.0 | 0.0 | 0.0 | 0.0 | 18.0 | 1.0 | 60.0 | 0.0 | 186.0 |
| breakaway-1 | 44.6 | 44.6 | 30.5 | 0.700 | 44.0 | 63.0 | 0.0 | 0.0 | 0.0 | 18.0 | 1.0 | 60.0 | 0.0 | 186.0 |
| open-cap100-0.02 | 34.7 | 34.7 | 8.8 | 0.260 | 29.0 | 53.0 | 12.0 | 0.0 | 0.0 | 18.0 | 4.0 | 60.0 | 0.0 | 228.0 |

### 72 barriers

| objective | currentScore | meanVisible | escapesPerTile | breakawayShare | visibilityMedian | visibilityMax | corridorTiles | deadEnds | articulationPoints | endzoneDistance | largestCluster | largestWall | wallPenalty | cyclomatic |
|:--|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gap-walls | 79.8 | 73.8 | 38.0 | 0.522 | 78.0 | 107.0 | 18.0 | 0.0 | 0.0 | 19.0 | 5.0 | 6.0 | 6.0 | 228.0 |
| gap-walls+breakaway-0.25 | 79.8 | 73.8 | 38.0 | 0.522 | 78.0 | 107.0 | 18.0 | 0.0 | 0.0 | 19.0 | 5.0 | 6.0 | 6.0 | 228.0 |
| gap-walls+breakaway-0.5 | 79.8 | 73.8 | 38.0 | 0.522 | 78.0 | 107.0 | 18.0 | 0.0 | 0.0 | 19.0 | 5.0 | 6.0 | 6.0 | 228.0 |
| gap-walls+breakaway-1 | 79.8 | 73.8 | 38.0 | 0.522 | 78.0 | 107.0 | 18.0 | 0.0 | 0.0 | 19.0 | 5.0 | 6.0 | 6.0 | 228.0 |
| gap-walls+breakaway-0.5+open | 79.8 | 73.8 | 38.0 | 0.522 | 78.0 | 107.0 | 18.0 | 0.0 | 0.0 | 19.0 | 5.0 | 6.0 | 6.0 | 228.0 |
| gap-walls+breakaway-0.5+corridor | 79.8 | 73.8 | 38.0 | 0.522 | 78.0 | 107.0 | 18.0 | 0.0 | 0.0 | 19.0 | 5.0 | 6.0 | 6.0 | 228.0 |
| corridor-0.5 | 27.3 | 27.3 | 13.7 | 0.521 | 28.0 | 40.0 | 0.0 | 0.0 | 0.0 | 19.0 | 3.0 | 72.0 | 0.0 | 162.0 |
| current | 26.4 | 26.4 | 11.7 | 0.461 | 24.0 | 51.0 | 12.0 | 0.0 | 0.0 | 19.0 | 4.0 | 72.0 | 0.0 | 168.0 |
| mean-only | 318.9 | 24.9 | 8.0 | 0.332 | 22.0 | 41.0 | 18.0 | 0.0 | 0.0 | 19.0 | 11.0 | 72.0 | 294.0 | 186.0 |
| no-routes | 26.4 | 26.4 | 11.7 | 0.461 | 24.0 | 51.0 | 12.0 | 0.0 | 0.0 | 19.0 | 4.0 | 72.0 | 0.0 | 168.0 |
| breakaway-0.5 | 27.3 | 27.3 | 13.7 | 0.521 | 28.0 | 40.0 | 0.0 | 0.0 | 0.0 | 19.0 | 3.0 | 72.0 | 0.0 | 162.0 |
| combined | 54.3 | 54.3 | 44.6 | 0.836 | 54.0 | 63.0 | 0.0 | 0.0 | 0.0 | 22.0 | 1.0 | 72.0 | 0.0 | 126.0 |
| breakaway-1 | 54.3 | 54.3 | 44.6 | 0.836 | 54.0 | 63.0 | 0.0 | 0.0 | 0.0 | 22.0 | 1.0 | 72.0 | 0.0 | 126.0 |
| open-cap100-0.02 | 26.4 | 26.4 | 11.7 | 0.461 | 24.0 | 51.0 | 12.0 | 0.0 | 0.0 | 19.0 | 4.0 | 72.0 | 0.0 | 168.0 |

### Maps at 48 barriers (seed 173)

Barrier `#`, field `.`, endzone `E`: each objective's best layout at this count.

**current** · mean 47.4 · escapable 16.8 per viewpoint · largest cluster 3 · largest gap-linked wall 48 · view median 44, max 68

```
. . . . . . . . . .
 . . . . . . . . . . .
  . . # . . . . . . # . .
   . . . # . . # . . # . . .
    . . . . # . . . . # . . . .
     . . . . . . # # # . . . . . .
      . . . # . # . . . . # . # . . .
       . . . . . # . # . # . # . . . . .
        E . . . . # . . . . . . # . . . . E
         E . # # # . . # . . . # . . # # # . E
          E . . . . # . . . . . . # . . . . E
           . . . . . # . # . # . # . . . . .
            . . . # . # . . . . # . # . . .
             . . . . . . # # # . . . . . .
              . . . . # . . . . # . . . .
               . . . # . . # . . # . . .
                . . # . . . . . . # . .
                 . . . . . . . . . . .
                  . . . . . . . . . .
```

**gap-walls** · mean 71.8 · escapable 35.0 per viewpoint · largest cluster 4 · largest gap-linked wall 6 · view median 66, max 163

```
. . . . . . . . . .
 . . . . . . . . . . .
  . . # . . # # . . # . .
   . . . # . . # . . # . . .
    . . . . # . . . . # . . . .
     . . # . . # . . . # . . # . .
      . . # # . . . . . . . . # # . .
       . . . . . . . . # . . . . . . . .
        E . . . . . . # . . # . . . . . . E
         E . # # # # . . . . . . . # # # # . E
          E . . . . . . # . . # . . . . . . E
           . . . . . . . . # . . . . . . . .
            . . # # . . . . . . . . # # . .
             . . # . . # . . . # . . # . .
              . . . . # . . . . # . . . .
               . . . # . . # . . # . . .
                . . # . . # # . . # . .
                 . . . . . . . . . . .
                  . . . . . . . . . .
```

**gap-walls+breakaway-0.5** · mean 75.7 · escapable 45.6 per viewpoint · largest cluster 4 · largest gap-linked wall 6 · view median 69, max 151

```
. . . . . . . . . .
 . . . . # . # . . . .
  . . # . . . . . . # . .
   . . . # . . # . . # . . .
    . # . . # . . . . # . . # .
     . . . . . # . . . # . . . . .
      . # . # . . . . . . . . # . # .
       . . . . . . . . # . . . . . . . .
        E . . . . . . # . . # . . . . . . E
         E . # # # # . . . . . . . # # # # . E
          E . . . . . . # . . # . . . . . . E
           . . . . . . . . # . . . . . . . .
            . # . # . . . . . . . . # . # .
             . . . . . # . . . # . . . . .
              . # . . # . . . . # . . # .
               . . . # . . # . . # . . .
                . . # . . . . . . # . .
                 . . . . # . # . . . .
                  . . . . . . . . . .
```

**breakaway-1** · mean 67.5 · escapable 47.4 per viewpoint · largest cluster 1 · largest gap-linked wall 48 · view median 67, max 93

```
. . . . . . . . . .
 . . . . # . # . . . .
  . . # . . . . . . # . .
   . . . . . # . # . . . . .
    . # . . # . . . . # . . # .
     . . . # . . . . . . . # . . .
      . # . . . . # . . # . . . . # .
       . . . # . . . . # . . . . # . . .
        E . . . . . . # . . # . . . . . . E
         E . # . # . # . . . . . # . # . # . E
          E . . . . . . # . . # . . . . . . E
           . . . # . . . . # . . . . # . . .
            . # . . . . # . . # . . . . # .
             . . . # . . . . . . . # . . .
              . # . . # . . . . # . . # .
               . . . . . # . # . . . . .
                . . # . . . . . . # . .
                 . . . . # . # . . . .
                  . . . . . . . . . .
```

## Reproduction

```
python3 tools/exhaustive_visibility.py --max-n 8
python3 tools/benchmark_search.py
python3 tools/scoring_study.py --restarts 4
python3 tools/benchmark_report.py
```
