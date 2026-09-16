# Feedback for `straight_line_resampler.py`

Self-contained review notes consolidating two rounds of feedback (code-quality / robustness review and GPU-acceleration plan). The script generates Straight Line Mission land-crossing heatmaps from GSHHG by sampling great circles, vectorized within a circle and parallelized across circles via `ProcessPoolExecutor`.

The remaining wins fall into three buckets:

1. **Inner-loop performance** (batching, optional GPU)
2. **Correctness around NaN and polygon-closure heuristics**
3. **Robustness of the HTML inlining step**

Items are ranked by priority within each bucket.

---

## Bucket 1 — Performance

### 1A. Batched great-circle vectorization (biggest CPU-only win)

Currently `render_row_chunk` iterates `(lat_a, lat_b)` pairs in Python and calls `land_km_for_great_circle` for each — one circle = one Python call. The per-call NumPy/Python dispatch overhead dominates more than expected.

Refactor `land_km_for_great_circle` to take batches:

- Stack `e1`, `e2` into `(B, 3)` arrays.
- Expand once to `(B, SAMPLE_COUNT, 3)`.
- Flatten lat/lon to length `B * SAMPLE_COUNT` and run a single `land_mask_for_points` call.
- `.mean(axis=1)` for the per-route fraction.

**Memory cost at B=100, SAMPLE_COUNT≈20 000:** ~50 MB for the xyz tensor. Comfortable.

**Expected speedup:** 5–15× per process. A/B test against the existing `profile` subcommand.

### 1B. Optional GPU port (PyTorch MPS on Apple Silicon)

If 1A is not enough, the workload is a textbook GPU job: ~29 billion point queries (1.44M routes × ~20k samples) at the default 1200×1200 / 0.1° / 2 km settings. Pure parallel trig + scattered 2D-mask lookup.

**Recommended path:** PyTorch with `device="mps"`. Unified memory keeps the 640 MB land mask in one place.

Sketch of the inner kernel that replaces `land_km_for_great_circle` for a *batch* of N circles:

```python
import torch

device = torch.device("mps")

# One-time setup (in worker_init equivalent):
LAND_MASK_T = torch.from_numpy(land_mask).to(device)                       # (rows, cols) uint8
ANGLE_COS_T = torch.from_numpy(ANGLE_COS).to(device, dtype=torch.float32)  # (S,)
ANGLE_SIN_T = torch.from_numpy(ANGLE_SIN).to(device, dtype=torch.float32)  # (S,)

def land_km_batch(lat_a, lon_a, lat_b, lon_b, lat_step, lon_step, rows, cols):
    # All inputs (N,) float32 tensors on MPS
    la, oa = torch.deg2rad(lat_a), torch.deg2rad(lon_a)
    lb, ob = torch.deg2rad(lat_b), torch.deg2rad(lon_b)

    a = torch.stack([torch.cos(la)*torch.cos(oa), torch.cos(la)*torch.sin(oa), torch.sin(la)], -1)
    b = torch.stack([torch.cos(lb)*torch.cos(ob), torch.cos(lb)*torch.sin(ob), torch.sin(lb)], -1)

    n = torch.linalg.cross(a, b)
    n_norm = torch.linalg.norm(n, dim=-1, keepdim=True)
    valid = (n_norm.squeeze(-1) >= 1e-9)
    n = n / n_norm.clamp_min(1e-12)
    e1 = a
    e2 = torch.linalg.cross(n, e1)
    e2 = e2 / torch.linalg.norm(e2, dim=-1, keepdim=True).clamp_min(1e-12)

    cos_t = ANGLE_COS_T.unsqueeze(0).unsqueeze(-1)   # (1, S, 1)
    sin_t = ANGLE_SIN_T.unsqueeze(0).unsqueeze(-1)
    xyz = e1.unsqueeze(1) * cos_t + e2.unsqueeze(1) * sin_t   # (N, S, 3)

    lat = torch.rad2deg(torch.asin(xyz[..., 2].clamp(-1, 1)))
    lon = torch.rad2deg(torch.atan2(xyz[..., 1], xyz[..., 0]))

    lat_idx = (((lat + 90.0) / lat_step).long()).clamp(0, rows - 1)
    lon_idx = (((lon + 180.0) / lon_step).long()).clamp(0, cols - 1)

    km = LAND_MASK_T[lat_idx, lon_idx].float().mean(dim=1) * CIRCUMFERENCE_KM
    # Antipodal pairs -> NaN
    km = torch.where(valid, km, torch.full_like(km, float("nan")))
    return km
```

**Batch-size guidance:** the limiting tensor is `xyz` at `(N, S, 3)` float32 = `N × 240 KB` for S = 20 000.

- 16 GB unified memory: N ≈ 1000 (~240 MB) is comfortable.
- 32 GB+: N ≈ 10 000 (~2.4 GB) is fine.

Tune with the `profile` subcommand.

**Estimated total render time at 1200×1200 on M-series MPS:** 15 seconds to 2 minutes. Roughly 30–100× faster than the current implementation.

#### Caveats

- **Multiprocessing + MPS is awkward.** With a single GPU as the bottleneck, prefer **one Python process** that batches everything, instead of `ProcessPoolExecutor`. The current CPU parallelism stops helping once the GPU is saturated.
- **Move the mask once at startup**, not per call.
- **FP16 is tempting** for ~2× more throughput but adds risk to the trig; ship FP32 first and only switch after a sanity-check render against the FP32 output.
- Use **PyTorch ≥ 2.1** for stable MPS long-tensor indexing.

#### Paths *not* recommended

- Custom Metal shaders (~1000 lines, weeks of work).
- CuPy / Numba CUDA (NVIDIA only).
- JAX `jax-metal` (experimental).
- PyOpenCL (Apple deprecated OpenCL).

### 1C. Don't touch the index/mask build stages

Only the render loop benefits from batching or GPU. Index construction and mask rasterization are one-time setup; leave them as-is.

---

## Bucket 2 — Correctness

### 2A. NaN safety in `palette`

`land_km_for_great_circle` returns NaN for antipodal point pairs. In `render_heatmap`:

```python
normalized = (matrix - low) / max(high - low, 1e-9)
rgb = palette(normalized)
```

`palette` does `np.clip(values, 0, 1)` and `np.floor(scaled).astype(np.int32)`. NaN survives the clip; casting NaN → int32 is undefined behavior in NumPy and produces garbage palette indices (typically min-int → clipped to 0, but it's UB and brittle).

**Fix:** at the top of `palette`, mask NaN and either substitute a sentinel value before indexing, or assign a fixed "no-data" color to those cells before processing the rest through the gradient. The output should have an obvious distinct color for unreachable cells, not silently corrupt RGB.

### 2B. Document the polygon-closure heuristics

Two places paper over messy real-world GSHHG data and could systematically bias rare cases (Antarctica is the textbook problem):

- Line ~173: `dateline_crossings = dateline_crossings[:-1]` discards an odd crossing.
- Lines ~187–192: the "odd row" fallback adds a boundary at whichever edge is closer.

Both already write `odd_rows_after_scanline_fill` to metadata, which is good. Add:

- An inline comment on each heuristic explaining the assumption it's making.
- If per-polygon dateline-odd-count is nonzero, warn to stderr with the polygon ID. A small number = numerical artifact; a large number = a real polygon issue worth investigating.

### 2C. Magic epsilons

`1e-12` (lines ~78, ~264) and `1e-14` (line ~75) are uncommented. Each guards a specific edge case (lat range below precision, zero-length edges, etc.). One-word comments on each clarify intent without changing behavior.

---

## Bucket 3 — Robustness

### 3A. `inline_png_in_html` is fragile and fails silently

The function does two `re.sub` calls with `count=1`. If the HTML changes (someone renames the `<img>` id, refactors the click handler), the regex misses, no exception is raised, the file is written looking "fine" — but the JS hover coordinates are now stale relative to the new heatmap dimensions. The failure mode is: user clicks the heatmap and sees wrong values, with no script-level signal.

Two fixes, in order of preference:

1. **Better: emit a sidecar JSON.** Write `heatmap-config.json` next to the PNG containing `{span, step, mode, dimensions, …}`. Have the HTML `fetch()` it at load time. The HTML never needs to be edited; the script just writes the PNG and the JSON. Removes the brittlest part of the script entirely.

2. **Minimum: assert on regex hits.** Use `re.subn` (returns `(text, n_subs)`) and raise `RuntimeError` if `n_subs != 1` on each substitution. Don't silently overwrite a file that no longer matches.

### 3B. Environment-overridable paths

All defaults point at `/private/tmp/gshhg-straightline/...`. Add a `GSHHG_CACHE_DIR` env-var override (and equivalent for the gshhg source path). Default still applies if unset.

### 3C. Confirm workers load `land_mask` after `build-mask`

`load_index` re-checks `mask_path.exists()`, so workers should pick up the mask. But the `worker_init` happens in subprocesses with their own filesystem view at process start. Add a small smoke test: log `INDEX.has("land_mask")` in `worker_init` to confirm the fast path is being taken in workers.

---

## Bucket 4 — Polish (lower priority)

### 4A. Custom PNG writer

Lines ~385–399 hand-roll PNG output. Works, but no comment explains why Pillow isn't being used. Either:

- Add a one-line comment: `# avoid Pillow dependency`.
- Or switch to `PIL.Image.fromarray(rgb).save(path)` — saves ~15 lines and gets better compression for free, if Pillow is acceptable as a dep.

### 4B. Multi-arg helper signatures

`add_scanline_edge(row_crossings, lon1, lat1, lon2, lat2, center0, step, rows)` is 8 positional args. A small `Edge` dataclass and a `ScanlineGrid` config object would cut these signatures in half and improve readability of the dateline-split code.

### 4C. Memory note for `--build-mask`

At 0.01° lat/lon defaults the mask is ~648 MB. At 0.1° it's ~6.5 MB. Surface this trade-off in the `build-mask --help` text or the module docstring; otherwise users will accidentally produce half-gig files.

### 4D. Tests for the pure functions

None currently. Easy candidates:

- `normalize_lon` — 360° wrap, ±180° handling
- `row_range_for_edge` — pole edge cases, infinitesimal segments
- `make_lat_values` — `"centers"` vs `"endpoints"` differ subtly, easy to confuse
- `palette` — monotonic interpolation, clipping, NaN safety (once fixed per 2A)
- `parse_levels`
- `add_edge_with_dateline_split` — synthetic edge crossing ±180°

One integration test worth writing: a small synthetic GSHHG with one known polygon, build the index, and assert `land_mask_for_points` correctly classifies a handful of hand-picked points. ~40 lines of test code, catches every future refactor that breaks the algorithm.

### 4E. `--row-chunk 4` default

Seems low for a 1200+ row image. Probably tuned by experiment; if so, note in `--help` what to vary it for (load balance vs progress-feedback granularity).

---

## Suggested order of work

If the goal is "make the render fast at 1200×1200 / 0.1°":

1. **1A (batched NumPy)** — 1 hour of work, 5–15× speedup, no new deps. Re-run `profile`. If the new wall-clock is acceptable, stop here.
2. **2A (NaN in palette)** — small fix, prevents silently-corrupt output cells.
3. **3A (HTML inline → sidecar JSON)** — removes the worst silent-failure mode in the script.
4. **1B (GPU via PyTorch MPS)** — only if step 1 didn't reach the target speed. Day-scale work, including replacing the multiprocessing layout with a single-process MPS pipeline. Expected 30–100× over baseline.
5. Everything else is incremental polish — add as time allows.

The algorithmic core (scanline index, mask lookup, multi-process render) is solid; none of this rewrites the algorithm.
