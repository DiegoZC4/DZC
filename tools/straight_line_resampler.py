#!/usr/bin/env python3
"""Generate Straight Line Mission land-crossing heatmaps from GSHHG.

The expensive part is split in two:
1. Build a scanline index from GSHHG polygons. Each latitude row stores
   land intervals in longitude, so point queries are binary searches.
2. Sample many great circles. Samples within each circle are vectorized
   with NumPy; circles are parallelized across worker processes.

Benchmark notes from 2026-05-31 on an Apple M2 Pro with the full GSHHG
0.01 degree raster mask (`/private/tmp/gshhg-straightline/full-scanline-index-001c`):
- 2 km route sampling, 1200x1200 grid profile, 10 workers, batch 128:
  5,122 great circles/second, 102.5M point samples/second, ~4.7 min estimated
  for a full 1.44M-route render.
- 5 km route sampling, same grid/settings:
  9,120 great circles/second, 73.0M point samples/second, ~2.6 min estimated
  for a full 1.44M-route render.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import json
import math
import os
import re
import struct
import sys
import time
import zlib
from pathlib import Path
from typing import Iterable

import numpy as np


EARTH_RADIUS_KM = 6371.0088
CIRCUMFERENCE_KM = 2 * math.pi * EARTH_RADIUS_KM
HEADER_STRUCT = struct.Struct(">11i")
POINT_DTYPE = np.dtype(">i4")
DEFAULT_CACHE_DIR = Path(
    os.environ.get("GSHHG_CACHE_DIR")
    or os.environ.get("STRAIGHT_LINE_CACHE_DIR")
    or "/private/tmp/gshhg-straightline/full-scanline-index"
).expanduser()
DEFAULT_GSHHG_PATH = Path(
    os.environ.get("GSHHG_PATH")
    or os.environ.get("GSHHG_SOURCE_PATH")
    or "/private/tmp/gshhg-straightline/gshhs_f.b"
).expanduser()

INDEX = None
ANGLE_COS = None
ANGLE_SIN = None
SAMPLE_COUNT = None
BATCH_SIZE = None
BACKEND = None
TORCH = None
DEVICE = None
LAND_MASK_T = None
ANGLE_COS_T = None
ANGLE_SIN_T = None


def normalize_lon(lon: np.ndarray | float) -> np.ndarray | float:
    return ((lon + 180.0) % 360.0) - 180.0


def lat_lon_to_xyz(lat_deg: float, lon_deg: float) -> np.ndarray:
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    c = math.cos(lat)
    return np.array([c * math.cos(lon), c * math.sin(lon), math.sin(lat)], dtype=np.float64)


def lat_lon_to_xyz_batch(lat_deg: np.ndarray, lon_deg: np.ndarray | float) -> np.ndarray:
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    cos_lat = np.cos(lat)
    return np.column_stack((cos_lat * np.cos(lon), cos_lat * np.sin(lon), np.sin(lat)))


def iter_gshhg_polygons(path: Path, levels: set[int]) -> Iterable[tuple[int, int, np.ndarray, np.ndarray]]:
    with path.open("rb") as fp:
        while True:
            header = fp.read(HEADER_STRUCT.size)
            if not header:
                return
            if len(header) != HEADER_STRUCT.size:
                raise ValueError(f"Truncated GSHHG header in {path}")
            polygon_id, n_points, flag, *_ = HEADER_STRUCT.unpack(header)
            level = flag & 255
            raw_points = fp.read(n_points * 8)
            if len(raw_points) != n_points * 8:
                raise ValueError(f"Truncated GSHHG polygon {polygon_id} in {path}")
            if level not in levels:
                continue
            points = np.frombuffer(raw_points, dtype=POINT_DTYPE).astype(np.float64).reshape(-1, 2)
            lon = normalize_lon(points[:, 0] / 1_000_000.0)
            lat = points[:, 1] / 1_000_000.0
            yield polygon_id, level, lon, lat


def row_range_for_edge(lat1: float, lat2: float, center0: float, step: float, rows: int) -> tuple[int, int] | None:
    low = min(lat1, lat2)
    high = max(lat1, lat2)
    # Treat nearly horizontal edges as non-crossings to avoid unstable division.
    if high <= -90.0 or low >= 90.0 or abs(high - low) < 1e-14:
        return None
    start = math.ceil((low - center0) / step)
    # Exclude the upper endpoint so shared polygon vertices are not double-counted.
    end = math.floor((high - center0 - 1e-12) / step)
    start = max(start, 0)
    end = min(end, rows - 1)
    if end < start:
        return None
    return start, end


def add_scanline_edge(
    row_crossings: list[list[float]],
    lon1: float,
    lat1: float,
    lon2: float,
    lat2: float,
    center0: float,
    step: float,
    rows: int,
) -> int:
    row_range = row_range_for_edge(lat1, lat2, center0, step, rows)
    if row_range is None:
        return 0
    start, end = row_range
    denom = lat2 - lat1
    count = 0
    for row in range(start, end + 1):
        y = center0 + row * step
        x = lon1 + (y - lat1) * (lon2 - lon1) / denom
        row_crossings[row].append(float(np.clip(x, -180.0, 180.0)))
        count += 1
    return count


def add_edge_with_dateline_split(
    row_crossings: list[list[float]],
    lon1: float,
    lat1: float,
    lon2: float,
    lat2: float,
    center0: float,
    step: float,
    rows: int,
    dateline_crossings: list[float] | None = None,
) -> int:
    delta = lon2 - lon1
    if delta > 180.0:
        lon2_unwrapped = lon2 - 360.0
        t = (-180.0 - lon1) / (lon2_unwrapped - lon1)
        lat_cross = lat1 + t * (lat2 - lat1)
        if dateline_crossings is not None:
            dateline_crossings.append(lat_cross)
        return add_scanline_edge(row_crossings, lon1, lat1, -180.0, lat_cross, center0, step, rows) + add_scanline_edge(
            row_crossings, 180.0, lat_cross, lon2, lat2, center0, step, rows
        )
    if delta < -180.0:
        lon2_unwrapped = lon2 + 360.0
        t = (180.0 - lon1) / (lon2_unwrapped - lon1)
        lat_cross = lat1 + t * (lat2 - lat1)
        if dateline_crossings is not None:
            dateline_crossings.append(lat_cross)
        return add_scanline_edge(row_crossings, lon1, lat1, 180.0, lat_cross, center0, step, rows) + add_scanline_edge(
            row_crossings, -180.0, lat_cross, lon2, lat2, center0, step, rows
        )
    return add_scanline_edge(row_crossings, lon1, lat1, lon2, lat2, center0, step, rows)


def build_scanline_index(gshhg_path: Path, cache_dir: Path, lat_step_deg: float, levels: set[int]) -> dict:
    cache_dir.mkdir(parents=True, exist_ok=True)
    rows = int(round(180.0 / lat_step_deg))
    center0 = -90.0 + lat_step_deg / 2.0
    row_crossings: list[list[float]] = [[] for _ in range(rows)]
    edge_count = 0
    crossing_count = 0
    point_count = 0
    polygon_count = 0
    dateline_odd_polygon_count = 0
    start_time = time.perf_counter()

    for polygon_id, _level, lon, lat in iter_gshhg_polygons(gshhg_path, levels):
        polygon_count += 1
        point_count += len(lon)
        if len(lon) < 2:
            continue
        dateline_crossings: list[float] = []
        closed = bool(lon[0] == lon[-1] and lat[0] == lat[-1])
        stop = len(lon) - 1 if closed else len(lon)
        for i in range(stop):
            j = i + 1
            if j == len(lon):
                j = 0
            edge_count += 1
            crossing_count += add_edge_with_dateline_split(
                row_crossings, lon[i], lat[i], lon[j], lat[j], center0, lat_step_deg, rows, dateline_crossings
            )
        if dateline_crossings:
            dateline_crossings.sort()
            if len(dateline_crossings) % 2:
                dateline_odd_polygon_count += 1
                print(
                    f"warning: GSHHG polygon {polygon_id} has odd dateline crossing count "
                    f"({len(dateline_crossings)}); dropping the unmatched crossing",
                    file=sys.stderr,
                )
                # Assume the final crossing is a numerical or closure artifact.
                dateline_crossings = dateline_crossings[:-1]
            for lat0, lat1 in zip(dateline_crossings[0::2], dateline_crossings[1::2]):
                crossing_count += add_scanline_edge(row_crossings, -180.0, lat0, -180.0, lat1, center0, lat_step_deg, rows)
                crossing_count += add_scanline_edge(row_crossings, 180.0, lat0, 180.0, lat1, center0, lat_step_deg, rows)

    offsets = np.zeros(rows + 1, dtype=np.int64)
    starts_parts: list[np.ndarray] = []
    ends_parts: list[np.ndarray] = []
    odd_rows = 0
    interval_count = 0

    for row, crossings in enumerate(row_crossings):
        if crossings:
            xs = np.array(sorted(crossings), dtype=np.float32)
            if len(xs) % 2:
                odd_rows += 1
                # If a row still has odd parity, close it against the nearest world edge.
                # This favors tiny boundary-touch artifacts over inventing a transoceanic interval.
                if abs(float(xs[0]) + 180.0) < abs(180.0 - float(xs[-1])):
                    xs = np.insert(xs, 0, -180.0)
                else:
                    xs = np.append(xs, 180.0)
            starts = xs[0::2]
            ends = xs[1::2]
            valid = ends > starts
            starts = starts[valid]
            ends = ends[valid]
        else:
            starts = np.array([], dtype=np.float32)
            ends = np.array([], dtype=np.float32)
        starts_parts.append(starts)
        ends_parts.append(ends)
        interval_count += len(starts)
        offsets[row + 1] = interval_count

    starts_flat = np.concatenate(starts_parts) if starts_parts else np.array([], dtype=np.float32)
    ends_flat = np.concatenate(ends_parts) if ends_parts else np.array([], dtype=np.float32)

    np.save(cache_dir / "offsets.npy", offsets)
    np.save(cache_dir / "starts.npy", starts_flat)
    np.save(cache_dir / "ends.npy", ends_flat)

    metadata = {
        "source": str(gshhg_path),
        "lat_step_deg": lat_step_deg,
        "lat_resolution_m": lat_step_deg * 111_320.0,
        "levels": sorted(levels),
        "rows": rows,
        "intervals": int(interval_count),
        "polygons": int(polygon_count),
        "points": int(point_count),
        "edges": int(edge_count),
        "scanline_crossings": int(crossing_count),
        "dateline_odd_polygons": int(dateline_odd_polygon_count),
        "boundary_adjusted_rows": int(odd_rows),
        "odd_rows_after_scanline_fill": int(odd_rows),
        "build_seconds": time.perf_counter() - start_time,
    }
    (cache_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata


def load_index(cache_dir: Path, mmap: bool = True) -> dict:
    mode = "r" if mmap else None
    metadata = json.loads((cache_dir / "metadata.json").read_text())
    index = {
        "metadata": metadata,
        "offsets": np.load(cache_dir / "offsets.npy", mmap_mode=mode),
        "starts": np.load(cache_dir / "starts.npy", mmap_mode=mode),
        "ends": np.load(cache_dir / "ends.npy", mmap_mode=mode),
    }
    mask_path = cache_dir / "land_mask.npy"
    if mask_path.exists():
        index["land_mask"] = np.load(mask_path, mmap_mode=mode)
    return index


def build_land_mask(cache_dir: Path, lon_step_deg: float) -> dict:
    index = load_index(cache_dir, mmap=True)
    metadata = dict(index["metadata"])
    rows = metadata["rows"]
    cols = int(round(360.0 / lon_step_deg))
    lon_center0 = -180.0 + lon_step_deg / 2.0
    mask_path = cache_dir / "land_mask.npy"
    land_mask = np.lib.format.open_memmap(mask_path, mode="w+", dtype=np.uint8, shape=(rows, cols))
    land_mask[:] = 0

    offsets = index["offsets"]
    starts = index["starts"]
    ends = index["ends"]
    start_time = time.perf_counter()
    for row in range(rows):
        start = int(offsets[row])
        end = int(offsets[row + 1])
        for lon0, lon1 in zip(starts[start:end], ends[start:end]):
            col0 = math.ceil((float(lon0) - lon_center0) / lon_step_deg)
            # Exclude the upper interval edge so adjacent intervals do not double-fill cells.
            col1 = math.floor((float(lon1) - lon_center0 - 1e-12) / lon_step_deg)
            col0 = max(col0, 0)
            col1 = min(col1, cols - 1)
            if col1 >= col0:
                land_mask[row, col0 : col1 + 1] = 1
    land_mask.flush()

    metadata["lon_step_deg"] = lon_step_deg
    metadata["lon_resolution_m_at_equator"] = lon_step_deg * 111_320.0
    metadata["mask_cols"] = cols
    metadata["mask_bytes"] = int(rows * cols)
    metadata["mask_build_seconds"] = time.perf_counter() - start_time
    (cache_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata


def land_mask_for_points(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    metadata = INDEX["metadata"]
    step = metadata["lat_step_deg"]
    rows = metadata["rows"]
    if "land_mask" in INDEX:
        lon_step = metadata["lon_step_deg"]
        cols = metadata["mask_cols"]
        lat_idx = np.floor((lat + 90.0) / step).astype(np.int32)
        lon_idx = np.floor((normalize_lon(lon) + 180.0) / lon_step).astype(np.int32)
        lat_idx = np.clip(lat_idx, 0, rows - 1)
        lon_idx = np.clip(lon_idx, 0, cols - 1)
        return INDEX["land_mask"][lat_idx, lon_idx] != 0

    offsets = INDEX["offsets"]
    starts = INDEX["starts"]
    ends = INDEX["ends"]

    lon = normalize_lon(lon)
    row_ids = np.floor((lat + 90.0) / step).astype(np.int32)
    row_ids = np.clip(row_ids, 0, rows - 1)
    result = np.zeros(lat.shape, dtype=bool)

    for row in np.unique(row_ids):
        mask = row_ids == row
        start = int(offsets[row])
        end = int(offsets[row + 1])
        if end <= start:
            continue
        row_starts = starts[start:end]
        row_ends = ends[start:end]
        query_lon = lon[mask]
        interval_idx = np.searchsorted(row_starts, query_lon, side="right") - 1
        valid = interval_idx >= 0
        if np.any(valid):
            result_indices = np.flatnonzero(mask)
            result[result_indices[valid]] = query_lon[valid] < row_ends[interval_idx[valid]]
    return result


def land_km_for_great_circle(lat_a: float, lat_b: float, lon_a: float, lon_b: float) -> float:
    return float(land_km_for_great_circles(np.array([lat_a]), np.array([lat_b]), lon_a, lon_b)[0])


def land_km_for_great_circles(lat_a: np.ndarray, lat_b: np.ndarray, lon_a: float, lon_b: float) -> np.ndarray:
    if BACKEND == "mps":
        return land_km_for_great_circles_mps(lat_a, lat_b, lon_a, lon_b)

    return land_km_for_great_circles_numpy(lat_a, lat_b, lon_a, lon_b)


def land_km_for_great_circles_numpy(lat_a: np.ndarray, lat_b: np.ndarray, lon_a: float, lon_b: float) -> np.ndarray:
    """Sample a batch of great circles in one NumPy call."""
    lat_a = np.asarray(lat_a, dtype=np.float64)
    lat_b = np.asarray(lat_b, dtype=np.float64)
    results = np.full(lat_a.shape, np.nan, dtype=np.float32)
    if lat_a.size == 0:
        return results

    a = lat_lon_to_xyz_batch(lat_a, lon_a)
    b = lat_lon_to_xyz_batch(lat_b, lon_b)
    normal = np.cross(a, b)
    normal_norm = np.linalg.norm(normal, axis=1)
    # Zero normals mean identical or antipodal endpoint pairs, which do not define a unique great circle.
    valid = normal_norm >= 1e-12
    if not np.any(valid):
        return results

    normal = normal[valid] / normal_norm[valid, None]
    e1 = a[valid]
    e2 = np.cross(normal, e1)
    e2 /= np.linalg.norm(e2, axis=1)[:, None]

    x = ANGLE_COS[None, :] * e1[:, 0, None] + ANGLE_SIN[None, :] * e2[:, 0, None]
    y = ANGLE_COS[None, :] * e1[:, 1, None] + ANGLE_SIN[None, :] * e2[:, 1, None]
    z = ANGLE_COS[None, :] * e1[:, 2, None] + ANGLE_SIN[None, :] * e2[:, 2, None]
    sample_lat = np.degrees(np.arcsin(np.clip(z, -1.0, 1.0)))
    sample_lon = np.degrees(np.arctan2(y, x))
    land = land_mask_for_points(sample_lat.ravel(), sample_lon.ravel()).reshape(e1.shape[0], SAMPLE_COUNT)
    results[valid] = (land.mean(axis=1) * CIRCUMFERENCE_KM).astype(np.float32)
    return results


def require_torch_mps():
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("PyTorch is required for --backend mps; install torch or use --backend cpu") from exc
    if not torch.backends.mps.is_available():
        raise RuntimeError("PyTorch MPS is not available on this machine; use --backend cpu")
    return torch


def land_km_for_great_circles_mps(lat_a: np.ndarray, lat_b: np.ndarray, lon_a: float, lon_b: float) -> np.ndarray:
    """Sample a batch of great circles on Apple Silicon MPS via PyTorch."""
    torch = TORCH
    lat_a = np.asarray(lat_a, dtype=np.float32)
    lat_b = np.asarray(lat_b, dtype=np.float32)
    results = np.full(lat_a.shape, np.nan, dtype=np.float32)
    if lat_a.size == 0:
        return results

    lat_a_t = torch.as_tensor(lat_a, dtype=torch.float32, device=DEVICE)
    lat_b_t = torch.as_tensor(lat_b, dtype=torch.float32, device=DEVICE)
    lon_a_t = torch.full_like(lat_a_t, float(lon_a))
    lon_b_t = torch.full_like(lat_b_t, float(lon_b))

    la = torch.deg2rad(lat_a_t)
    oa = torch.deg2rad(lon_a_t)
    lb = torch.deg2rad(lat_b_t)
    ob = torch.deg2rad(lon_b_t)
    a = torch.stack((torch.cos(la) * torch.cos(oa), torch.cos(la) * torch.sin(oa), torch.sin(la)), dim=-1)
    b = torch.stack((torch.cos(lb) * torch.cos(ob), torch.cos(lb) * torch.sin(ob), torch.sin(lb)), dim=-1)

    normal = torch.cross(a, b, dim=-1)
    normal_norm = torch.linalg.norm(normal, dim=-1, keepdim=True)
    valid = normal_norm.squeeze(-1) >= 1e-9
    normal = normal / normal_norm.clamp_min(1e-12)
    e1 = a
    e2 = torch.cross(normal, e1, dim=-1)
    e2 = e2 / torch.linalg.norm(e2, dim=-1, keepdim=True).clamp_min(1e-12)

    x = ANGLE_COS_T.unsqueeze(0) * e1[:, 0:1] + ANGLE_SIN_T.unsqueeze(0) * e2[:, 0:1]
    y = ANGLE_COS_T.unsqueeze(0) * e1[:, 1:2] + ANGLE_SIN_T.unsqueeze(0) * e2[:, 1:2]
    z = ANGLE_COS_T.unsqueeze(0) * e1[:, 2:3] + ANGLE_SIN_T.unsqueeze(0) * e2[:, 2:3]
    sample_lat = torch.rad2deg(torch.asin(z.clamp(-1.0, 1.0)))
    sample_lon = torch.rad2deg(torch.atan2(y, x))

    metadata = INDEX["metadata"]
    rows = metadata["rows"]
    cols = metadata["mask_cols"]
    lat_idx = torch.floor((sample_lat + 90.0) / metadata["lat_step_deg"]).to(torch.long).clamp(0, rows - 1)
    lon_norm = torch.remainder(sample_lon + 180.0, 360.0)
    lon_idx = torch.floor(lon_norm / metadata["lon_step_deg"]).to(torch.long).clamp(0, cols - 1)
    km = LAND_MASK_T[lat_idx, lon_idx].to(torch.float32).mean(dim=1) * CIRCUMFERENCE_KM
    km = torch.where(valid, km, torch.full_like(km, float("nan")))
    results[:] = km.detach().cpu().numpy().astype(np.float32)
    return results


def worker_init(cache_dir: str, sample_km: float, batch_size: int, backend: str = "cpu", log_worker_mask: bool = False) -> None:
    global INDEX, ANGLE_COS, ANGLE_SIN, SAMPLE_COUNT, BATCH_SIZE, BACKEND
    global TORCH, DEVICE, LAND_MASK_T, ANGLE_COS_T, ANGLE_SIN_T
    INDEX = load_index(Path(cache_dir), mmap=True)
    SAMPLE_COUNT = int(math.ceil(CIRCUMFERENCE_KM / sample_km))
    BATCH_SIZE = batch_size
    BACKEND = backend
    theta = (np.arange(SAMPLE_COUNT, dtype=np.float64) + 0.5) * (2.0 * math.pi / SAMPLE_COUNT)
    ANGLE_COS = np.cos(theta)
    ANGLE_SIN = np.sin(theta)
    if log_worker_mask:
        print(f"worker {os.getpid()}: land_mask={'land_mask' in INDEX}, backend={backend}", file=sys.stderr, flush=True)
    if backend == "mps":
        if "land_mask" not in INDEX:
            raise RuntimeError("--backend mps requires build-mask output in the cache directory")
        TORCH = require_torch_mps()
        DEVICE = TORCH.device("mps")
        LAND_MASK_T = TORCH.as_tensor(np.asarray(INDEX["land_mask"]), dtype=TORCH.uint8, device=DEVICE)
        ANGLE_COS_T = TORCH.as_tensor(ANGLE_COS.astype(np.float32), dtype=TORCH.float32, device=DEVICE)
        ANGLE_SIN_T = TORCH.as_tensor(ANGLE_SIN.astype(np.float32), dtype=TORCH.float32, device=DEVICE)


def render_row_chunk(args: tuple[int, int, np.ndarray, np.ndarray, float, float]) -> tuple[int, np.ndarray]:
    row_start, row_end, lat_a_values, lat_b_values, lon_a, lon_b = args
    lat_b_chunk = lat_b_values[row_start:row_end]
    width = len(lat_a_values)
    route_lat_a = np.tile(lat_a_values, len(lat_b_chunk))
    route_lat_b = np.repeat(lat_b_chunk, width)
    output = render_route_batch(route_lat_a, route_lat_b, lon_a, lon_b)
    return row_start, output.reshape(len(lat_b_chunk), width)


def render_route_batch(lat_a: np.ndarray, lat_b: np.ndarray, lon_a: float, lon_b: float) -> np.ndarray:
    output = np.empty(len(lat_a), dtype=np.float32)
    for start in range(0, len(lat_a), BATCH_SIZE):
        end = min(start + BATCH_SIZE, len(lat_a))
        output[start:end] = land_km_for_great_circles(lat_a[start:end], lat_b[start:end], lon_a, lon_b)
    return output


def render_route_chunk(args: tuple[int, np.ndarray, np.ndarray, float, float]) -> tuple[int, np.ndarray]:
    start, lat_a, lat_b, lon_a, lon_b = args
    return start, render_route_batch(lat_a, lat_b, lon_a, lon_b)


def make_lat_values(span: float, degree_step: float, mode: str) -> np.ndarray:
    if mode == "centers":
        count = int(round((2.0 * span) / degree_step))
        return np.linspace(-span + degree_step / 2.0, span - degree_step / 2.0, count, dtype=np.float64)
    return np.arange(-span, span + degree_step / 2.0, degree_step, dtype=np.float64)


def palette(values: np.ndarray) -> np.ndarray:
    stops = np.array(
        [
            [10, 12, 24],
            [25, 38, 92],
            [32, 92, 130],
            [52, 145, 134],
            [159, 190, 87],
            [255, 221, 91],
        ],
        dtype=np.float32,
    )
    finite = np.isfinite(values)
    safe_values = np.nan_to_num(values, nan=0.0, posinf=1.0, neginf=0.0)
    safe_values = np.clip(safe_values, 0.0, 1.0)
    scaled = safe_values * (len(stops) - 1)
    idx = np.floor(scaled).astype(np.int32)
    idx = np.clip(idx, 0, len(stops) - 2)
    frac = scaled - idx
    rgb = stops[idx] * (1.0 - frac[..., None]) + stops[idx + 1] * frac[..., None]
    output = np.round(rgb).astype(np.uint8)
    output[~finite] = np.array([8, 8, 12], dtype=np.uint8)
    return output


def write_png(path: Path, rgb: np.ndarray) -> None:
    # Keep the resampler dependency-free; the target Mac may not have Pillow.
    height, width, channels = rgb.shape
    if channels != 3:
        raise ValueError("write_png expects an RGB uint8 array")
    raw_rows = [b"\x00" + rgb[row].tobytes() for row in range(height)]
    raw = b"".join(raw_rows)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk("IHDR".encode(), struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk("IDAT".encode(), zlib.compress(raw, level=9))
    png += chunk("IEND".encode(), b"")
    path.write_bytes(png)


def png_size(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG file")
    return struct.unpack(">II", header[16:24])


def heatmap_config(
    *,
    image: str | None,
    span: float,
    degree_step: float,
    grid_mode: str,
    width: int,
    height: int,
    lon_a: float,
    lon_b: float,
    sample_km: float | None = None,
    low_km: float | None = None,
    high_km: float | None = None,
    land_km_data: str | None = None,
) -> dict:
    config = {
        "image": image,
        "span": span,
        "step": degree_step,
        "mode": grid_mode,
        "width": width,
        "height": height,
        "lonA": lon_a,
        "lonB": lon_b,
    }
    if sample_km is not None:
        config["sampleKm"] = sample_km
        config["samplesPerRoute"] = int(math.ceil(CIRCUMFERENCE_KM / sample_km))
    if low_km is not None:
        config["lowKm"] = low_km
    if high_km is not None:
        config["highKm"] = high_km
    if land_km_data is not None:
        config["landKmData"] = land_km_data
        config["landKmDataType"] = "uint16-le"
        config["landKmDataUnitKm"] = 1
        config["landKmNanSentinel"] = 65535
    return config


def write_heatmap_config(path: Path, config: dict) -> None:
    path.write_text(json.dumps(config, indent=2) + "\n")


def write_land_km_matrix(path: Path, matrix: np.ndarray) -> None:
    """Write the land-km matrix as little-endian uint16 (km precision).

    Encoding:
      - Finite values are rounded to integer km and stored as uint16.
      - NaN cells (antipodal pairs) and out-of-range values use sentinel 65535.
      - Earth circumference is ~40,030 km so 65,535 leaves comfortable headroom.
      - 1 km precision matches the inherent sampling-step quantization of
        the underlying data; float32 would just store noise in the trailing bits.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    NAN_SENTINEL = np.uint16(65535)
    encoded = np.full(matrix.shape, NAN_SENTINEL, dtype=np.uint16)
    finite = np.isfinite(matrix)
    if finite.any():
        encoded[finite] = np.round(np.clip(matrix[finite], 0.0, 65534.0)).astype(np.uint16)
    encoded.astype("<u2", copy=False).tofile(path)


def write_land_km_histogram(path: Path, values: np.ndarray, bucket_km: float) -> dict:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        raise RuntimeError("Cannot histogram land-km data with no finite values")
    upper = math.ceil(float(np.max(finite)) / bucket_km) * bucket_km
    edges = np.arange(0.0, upper + bucket_km, bucket_km)
    counts, edges = np.histogram(finite, bins=edges)
    summary = {
        "bucketSizeKm": bucket_km,
        "finiteCount": int(finite.size),
        "nanCount": int(values.size - finite.size),
        "minKm": float(np.min(finite)),
        "maxKm": float(np.max(finite)),
        "meanKm": float(np.mean(finite)),
        "medianKm": float(np.median(finite)),
        "percentilesKm": {
            str(percentile): float(np.percentile(finite, percentile))
            for percentile in (1, 5, 10, 25, 50, 75, 90, 95, 99)
        },
        "buckets": [
            {
                "fromKm": float(edges[index]),
                "toKm": float(edges[index + 1]),
                "count": int(count),
                "fraction": float(count / finite.size),
            }
            for index, count in enumerate(counts)
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def render_heatmap(args: argparse.Namespace) -> None:
    lat_a_values = make_lat_values(args.span, args.degree_step, args.grid_mode)
    lat_b_values = make_lat_values(args.span, args.degree_step, args.grid_mode)[::-1]
    height = len(lat_b_values)
    width = len(lat_a_values)
    matrix = np.empty((height, width), dtype=np.float32)
    row_chunks = [
        (start, min(start + args.row_chunk, height), lat_a_values, lat_b_values, args.lon_a, args.lon_b)
        for start in range(0, height, args.row_chunk)
    ]
    start_time = time.perf_counter()
    if args.backend == "mps":
        worker_init(str(args.cache_dir), args.sample_km, args.batch_size, args.backend, args.log_worker_mask)
        for row_chunk in row_chunks:
            row_start, chunk = render_row_chunk(row_chunk)
            matrix[row_start : row_start + len(chunk)] = chunk
            done = row_start + len(chunk)
            print(f"rendered {done}/{height} rows", flush=True)
    else:
        with concurrent.futures.ProcessPoolExecutor(
            max_workers=args.workers,
            initializer=worker_init,
            initargs=(str(args.cache_dir), args.sample_km, args.batch_size, args.backend, args.log_worker_mask),
        ) as pool:
            for row_start, chunk in pool.map(render_row_chunk, row_chunks):
                matrix[row_start : row_start + len(chunk)] = chunk
                done = row_start + len(chunk)
                print(f"rendered {done}/{height} rows", flush=True)

    elapsed = time.perf_counter() - start_time
    finite = matrix[np.isfinite(matrix)]
    if finite.size == 0:
        raise RuntimeError("All routes produced NaN; cannot colorize heatmap")
    histogram = None
    if args.raw_u16:
        write_land_km_matrix(args.raw_u16, matrix)
    if args.histogram_json:
        histogram = write_land_km_histogram(args.histogram_json, matrix, args.histogram_bin_km)
    low, high = np.percentile(finite, [1, 99])
    normalized = (matrix - low) / max(high - low, 1e-9)
    rgb = palette(normalized)
    write_png(args.output, rgb)
    config_path = args.config or args.output.with_suffix(".json")
    write_heatmap_config(
        config_path,
        heatmap_config(
            image=args.output.name,
            span=args.span,
            degree_step=args.degree_step,
            grid_mode=args.grid_mode,
            width=width,
            height=height,
            lon_a=args.lon_a,
            lon_b=args.lon_b,
            sample_km=args.sample_km,
            low_km=float(low),
            high_km=float(high),
            land_km_data=args.raw_u16.name if args.raw_u16 else None,
        ),
    )
    if args.csv:
        np.savetxt(args.csv, matrix, delimiter=",", fmt="%.3f")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "config": str(config_path),
                "width": width,
                "height": height,
                "routes": int(width * height),
                "sample_km": args.sample_km,
                "backend": args.backend,
                "batch_size": args.batch_size,
                "samples_per_route": int(math.ceil(CIRCUMFERENCE_KM / args.sample_km)),
                "elapsed_seconds": elapsed,
                "routes_per_second": (width * height) / elapsed,
                "raw_u16": str(args.raw_u16) if args.raw_u16 else None,
                "histogram": str(args.histogram_json) if args.histogram_json else None,
                "histogram_summary": {
                    "minKm": histogram["minKm"],
                    "maxKm": histogram["maxKm"],
                    "medianKm": histogram["medianKm"],
                }
                if histogram
                else None,
            },
            indent=2,
        )
    )


def profile(args: argparse.Namespace) -> None:
    lat_a_values = make_lat_values(args.span, args.degree_step, args.grid_mode)
    lat_b_values = make_lat_values(args.span, args.degree_step, args.grid_mode)
    route_ids = np.arange(args.routes)
    route_lat_a = lat_a_values[(route_ids * 37) % len(lat_a_values)]
    route_lat_b = lat_b_values[(route_ids * 91 + 17) % len(lat_b_values)]
    task_size = max(1, min(args.batch_size * 4, math.ceil(args.routes / max(args.workers * 4, 1))))
    tasks = [
        (start, route_lat_a[start : start + task_size], route_lat_b[start : start + task_size], args.lon_a, args.lon_b)
        for start in range(0, args.routes, task_size)
    ]
    results = np.empty(args.routes, dtype=np.float32)

    start_time = time.perf_counter()
    if args.backend == "mps":
        worker_init(str(args.cache_dir), args.sample_km, args.batch_size, args.backend, args.log_worker_mask)
        for task in tasks:
            start, chunk = render_route_chunk(task)
            results[start : start + len(chunk)] = chunk
    else:
        with concurrent.futures.ProcessPoolExecutor(
            max_workers=args.workers,
            initializer=worker_init,
            initargs=(str(args.cache_dir), args.sample_km, args.batch_size, args.backend, args.log_worker_mask),
        ) as pool:
            for start, chunk in pool.map(render_route_chunk, tasks, chunksize=1):
                results[start : start + len(chunk)] = chunk
    elapsed = time.perf_counter() - start_time
    samples_per_route = int(math.ceil(CIRCUMFERENCE_KM / args.sample_km))
    routes_per_second = args.routes / elapsed
    full_routes = len(lat_a_values) * len(lat_b_values)
    print(
        json.dumps(
            {
                "profiled_routes": args.routes,
                "workers": args.workers,
                "sample_km": args.sample_km,
                "backend": args.backend,
                "batch_size": args.batch_size,
                "samples_per_route": samples_per_route,
                "nan_routes": int(np.count_nonzero(~np.isfinite(results))),
                "elapsed_seconds": elapsed,
                "routes_per_second": routes_per_second,
                "samples_per_second": routes_per_second * samples_per_route,
                "grid_width": len(lat_a_values),
                "grid_height": len(lat_b_values),
                "full_routes": int(full_routes),
                "estimated_full_seconds": full_routes / routes_per_second,
                "estimated_full_minutes": full_routes / routes_per_second / 60.0,
            },
            indent=2,
        )
    )


def inline_png_in_html(
    html_path: Path,
    png_path: Path,
    config_path: Path,
    span: float,
    degree_step: float,
    grid_mode: str,
    lon_a: float,
    lon_b: float,
) -> None:
    encoded = base64.b64encode(png_path.read_bytes()).decode("ascii")
    html = html_path.read_text()
    html, replacements = re.subn(
        r'(<img id="LatLat" src=")[^"]+(")',
        rf"\1data:image/png;base64,{encoded}\2",
        html,
        count=1,
    )
    if replacements != 1:
        raise RuntimeError(f"Expected exactly one inline LatLat PNG in {html_path}, found {replacements}")
    width, height = png_size(png_path)
    write_heatmap_config(
        config_path,
        heatmap_config(
            image="inline",
            span=span,
            degree_step=degree_step,
            grid_mode=grid_mode,
            width=width,
            height=height,
            lon_a=lon_a,
            lon_b=lon_b,
        ),
    )
    html_path.write_text(html)


def parse_levels(text: str) -> set[int]:
    return {int(part) for part in text.split(",") if part.strip()}


def add_shared_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--sample-km", type=float, default=2.0)
    parser.add_argument(
        "--batch-size",
        type=int,
        default=128,
        help="Routes per inner batch; lower this if memory pressure appears; 128 profiled best on M2 Pro CPU.",
    )
    parser.add_argument("--workers", type=int, default=max(1, min(10, os.cpu_count() or 1)))
    parser.add_argument(
        "--backend",
        choices=["cpu", "mps"],
        default="cpu",
        help="cpu uses multiprocessing NumPy; mps uses single-process PyTorch on Apple Silicon.",
    )
    parser.add_argument(
        "--log-worker-mask",
        action="store_true",
        help="Print whether each worker loaded land_mask, confirming the fast lookup path.",
    )
    parser.add_argument("--span", type=float, default=60.0)
    parser.add_argument("--degree-step", type=float, default=0.1)
    parser.add_argument("--grid-mode", choices=["centers", "endpoints"], default="centers")
    parser.add_argument("--lon-a", type=float, default=-30.0)
    parser.add_argument("--lon-b", type=float, default=30.0)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build-index")
    build.add_argument("--gshhg", type=Path, default=DEFAULT_GSHHG_PATH)
    build.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    build.add_argument("--lat-step-deg", type=float, default=0.01)
    build.add_argument("--levels", default="1,2,3,4,6")

    mask = sub.add_parser("build-mask")
    mask.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    mask.add_argument(
        "--lon-step-deg",
        type=float,
        default=0.01,
        help="Longitude raster step. 0.01 deg makes a ~648 MB mask; 0.1 deg makes ~6.5 MB.",
    )

    prof = sub.add_parser("profile")
    add_shared_args(prof)
    prof.add_argument("--routes", type=int, default=64)

    render = sub.add_parser("render")
    add_shared_args(render)
    render.add_argument(
        "--row-chunk",
        type=int,
        default=4,
        help="Rows per task: lower values improve progress/load balance; higher values reduce task overhead.",
    )
    render.add_argument("--output", type=Path, default=Path("straight-line-heatmap.png"))
    render.add_argument("--config", type=Path)
    render.add_argument("--csv", type=Path)
    render.add_argument("--raw-u16", type=Path, help="Write the raw land-km matrix as little-endian uint16 (km precision, 65535 = NaN).")
    render.add_argument("--histogram-json", type=Path, help="Write a JSON histogram/summary of the raw land-km matrix.")
    render.add_argument("--histogram-bin-km", type=float, default=1000.0)

    inline = sub.add_parser("inline-html")
    inline.add_argument("--html", type=Path, default=Path("StraightLineMission.html"))
    inline.add_argument("--png", type=Path, required=True)
    inline.add_argument("--config", type=Path, default=Path("StraightLineMission.heatmap.json"))
    inline.add_argument("--span", type=float, default=60.0)
    inline.add_argument("--degree-step", type=float, default=0.1)
    inline.add_argument("--grid-mode", choices=["centers", "endpoints"], default="centers")
    inline.add_argument("--lon-a", type=float, default=-30.0)
    inline.add_argument("--lon-b", type=float, default=30.0)

    args = parser.parse_args()
    if getattr(args, "batch_size", 1) < 1:
        parser.error("--batch-size must be at least 1")
    if args.command == "build-index":
        metadata = build_scanline_index(args.gshhg, args.cache_dir, args.lat_step_deg, parse_levels(args.levels))
        print(json.dumps(metadata, indent=2))
    elif args.command == "build-mask":
        metadata = build_land_mask(args.cache_dir, args.lon_step_deg)
        print(json.dumps(metadata, indent=2))
    elif args.command == "profile":
        profile(args)
    elif args.command == "render":
        render_heatmap(args)
    elif args.command == "inline-html":
        inline_png_in_html(args.html, args.png, args.config, args.span, args.degree_step, args.grid_mode, args.lon_a, args.lon_b)


if __name__ == "__main__":
    main()
