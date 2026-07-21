#!/usr/bin/env python3
"""Generate a lightweight Mercator world-map SVG icon with tunable coastlines.

The main simplification knob is --ruler: a Douglas-Peucker tolerance measured in
the final SVG coordinate system. With the default 72x72 icon, the map square is
54 units wide, so:

  --ruler 0.25   detailed for an icon, larger SVG
  --ruler 0.60   balanced
  --ruler 1.20   chunky/symbolic

The input is GSHHG binary coastline data. The script reads land polygons
(level 1), unwraps antimeridian-crossing polygons, clips them to the requested
Mercator window, projects them into the icon square, simplifies them, drops
tiny polygons, then emits a single SVG.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path
from typing import Iterable

import numpy as np


HEADER_STRUCT = struct.Struct(">11i")
POINT_DTYPE = np.dtype(">i4")
DEFAULT_GSHHG_CANDIDATES = (
    Path("/private/tmp/gshhg-straightline/gshhs_h.b"),
    Path("/private/tmp/gshhg-straightline/gshhs_f.b"),
)


def normalize_lon(lon: np.ndarray | float) -> np.ndarray | float:
    return ((lon + 180.0) % 360.0) - 180.0


def iter_gshhg_land_polygons(path: Path) -> Iterable[tuple[np.ndarray, np.ndarray]]:
    with path.open("rb") as fp:
        while True:
            header = fp.read(HEADER_STRUCT.size)
            if not header:
                return
            if len(header) != HEADER_STRUCT.size:
                raise ValueError(f"Truncated GSHHG header in {path}")
            _polygon_id, n_points, flag, *_ = HEADER_STRUCT.unpack(header)
            raw_points = fp.read(n_points * 8)
            if len(raw_points) != n_points * 8:
                raise ValueError(f"Truncated GSHHG polygon in {path}")
            level = flag & 255
            if level != 1:
                continue
            points = np.frombuffer(raw_points, dtype=POINT_DTYPE).astype(np.float64).reshape(-1, 2)
            lon = normalize_lon(points[:, 0] / 1_000_000.0)
            lat = points[:, 1] / 1_000_000.0
            yield lon, lat


def clip_edge(poly: list[tuple[float, float]], inside, intersect) -> list[tuple[float, float]]:
    if not poly:
        return []
    output: list[tuple[float, float]] = []
    previous = poly[-1]
    previous_inside = inside(previous)
    for current in poly:
        current_inside = inside(current)
        if current_inside:
            if not previous_inside:
                output.append(intersect(previous, current))
            output.append(current)
        elif previous_inside:
            output.append(intersect(previous, current))
        previous = current
        previous_inside = current_inside
    return output


def clip_lon_lat_rect(
    poly: list[tuple[float, float]],
    lat_min: float,
    lat_max: float,
) -> list[tuple[float, float]]:
    def interp(p: tuple[float, float], q: tuple[float, float], axis: int, value: float) -> tuple[float, float]:
        denom = q[axis] - p[axis]
        t = 0.0 if abs(denom) < 1e-12 else (value - p[axis]) / denom
        return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))

    poly = clip_edge(poly, lambda p: p[0] >= -180.0, lambda p, q: interp(p, q, 0, -180.0))
    poly = clip_edge(poly, lambda p: p[0] <= 180.0, lambda p, q: interp(p, q, 0, 180.0))
    poly = clip_edge(poly, lambda p: p[1] >= lat_min, lambda p, q: interp(p, q, 1, lat_min))
    poly = clip_edge(poly, lambda p: p[1] <= lat_max, lambda p, q: interp(p, q, 1, lat_max))
    return poly


def polygon_area(points: list[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    return abs(
        sum(
            points[i][0] * points[(i + 1) % len(points)][1]
            - points[(i + 1) % len(points)][0] * points[i][1]
            for i in range(len(points))
        )
        / 2.0
    )


def perpendicular_distance(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    sx, sy = start
    ex, ey = end
    px, py = point
    dx = ex - sx
    dy = ey - sy
    if dx * dx + dy * dy < 1e-12:
        return math.hypot(px - sx, py - sy)
    return abs(dy * px - dx * py + ex * sy - ey * sx) / math.hypot(dx, dy)


def simplify_polyline(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points
    best_index = 0
    best_distance = -1.0
    start = points[0]
    end = points[-1]
    for index in range(1, len(points) - 1):
        distance = perpendicular_distance(points[index], start, end)
        if distance > best_distance:
            best_index = index
            best_distance = distance
    if best_distance <= tolerance:
        return [start, end]
    return (
        simplify_polyline(points[: best_index + 1], tolerance)[:-1]
        + simplify_polyline(points[best_index:], tolerance)
    )


def path_from_points(points: list[tuple[float, float]], close: bool = True, digits: int = 2) -> str:
    if not points:
        return ""
    fmt = f"{{:.{digits}f}}"
    commands = [f"M{fmt.format(points[0][0])} {fmt.format(points[0][1])}"]
    commands.extend(f"L{fmt.format(x)} {fmt.format(y)}" for x, y in points[1:])
    if close:
        commands.append("Z")
    return "".join(commands)


class MercatorProjector:
    def __init__(
        self,
        *,
        x: float,
        y: float,
        width: float,
        height: float,
        lat_min: float,
        lat_max: float,
    ) -> None:
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.lat_min = lat_min
        self.lat_max = lat_max
        self.top = self.mercator(lat_max)
        self.bottom = self.mercator(lat_min)

    def mercator(self, lat_deg: float) -> float:
        lat_deg = max(self.lat_min, min(self.lat_max, lat_deg))
        lat = math.radians(lat_deg)
        return math.log(math.tan(math.pi / 4.0 + lat / 2.0))

    def project(self, lon_deg: float, lat_deg: float) -> tuple[float, float]:
        px = self.x + (lon_deg + 180.0) / 360.0 * self.width
        py = self.y + (self.top - self.mercator(lat_deg)) / (self.top - self.bottom) * self.height
        return (px, py)


def build_land_path(args: argparse.Namespace, projector: MercatorProjector) -> tuple[str, int, int]:
    polygons: list[tuple[float, str]] = []
    for lon, lat in iter_gshhg_land_polygons(args.gshhg):
        if len(lon) < 4:
            continue

        # Work in unwrapped longitude, then test three shifted copies so
        # antimeridian-crossing continents are clipped cleanly at both edges.
        unwrapped_lon = np.degrees(np.unwrap(np.radians(lon), discont=math.pi))
        for shift in (-360.0, 0.0, 360.0):
            coords = list(zip((unwrapped_lon + shift).tolist(), lat.tolist()))
            if max(x for x, _ in coords) < -180.0 or min(x for x, _ in coords) > 180.0:
                continue

            clipped = clip_lon_lat_rect(coords, args.lat_min, args.lat_max)
            if len(clipped) < 4:
                continue

            projected = [projector.project(x, y) for x, y in clipped]
            if polygon_area(projected) < args.min_area:
                continue

            closed = projected + [projected[0]]
            simplified = simplify_polyline(closed, args.ruler)[:-1]
            area = polygon_area(simplified)
            if len(simplified) < 3 or area < args.min_area:
                continue
            polygons.append((area, path_from_points(simplified, digits=args.digits)))

    polygons.sort(reverse=True, key=lambda item: item[0])
    kept = polygons[: args.max_polygons] if args.max_polygons else polygons
    return ("".join(path for _area, path in kept), len(kept), len(polygons))


def route_from_heatmap(args: argparse.Namespace) -> tuple[float, float, float, float, int | None]:
    if args.lat_a is not None and args.lat_b is not None:
        return args.lat_a, args.lon_a, args.lat_b, args.lon_b, None

    config = json.loads(args.heatmap_config.read_text())
    data = np.fromfile(args.heatmap_data, dtype="<u2").reshape(config["height"], config["width"])
    sentinel = config.get("landKmNanSentinel", 65535)
    masked = np.ma.masked_equal(data, sentinel)
    row, col = np.unravel_index(masked.argmin(), masked.shape)
    lat_a = -config["span"] + col * config["step"]
    lat_b = config["span"] - row * config["step"]
    return float(lat_a), float(config["lonA"]), float(lat_b), float(config["lonB"]), int(data[row, col])


def xyz(lat_deg: float, lon_deg: float) -> np.ndarray:
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    cos_lat = math.cos(lat)
    return np.array([cos_lat * math.cos(lon), cos_lat * math.sin(lon), math.sin(lat)], dtype=np.float64)


def build_route_path(args: argparse.Namespace, projector: MercatorProjector) -> tuple[str, dict]:
    lat_a, lon_a, lat_b, lon_b, land_km = route_from_heatmap(args)
    a = xyz(lat_a, lon_a)
    b = xyz(lat_b, lon_b)
    normal = np.cross(a, b)
    normal /= np.linalg.norm(normal)
    e1 = a
    e2 = np.cross(normal, e1)
    e2 /= np.linalg.norm(e2)

    segments: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    last_lon: float | None = None
    for theta in np.linspace(0.0, 2.0 * math.pi, args.route_samples, endpoint=False):
        point = math.cos(theta) * e1 + math.sin(theta) * e2
        lat = math.degrees(math.asin(float(np.clip(point[2], -1.0, 1.0))))
        lon = math.degrees(math.atan2(point[1], point[0]))
        clipped = lat < args.lat_min or lat > args.lat_max
        wrapped = last_lon is not None and abs(lon - last_lon) > 180.0
        if clipped or wrapped:
            if len(current) > 1:
                segments.append(current)
            current = []
            last_lon = lon
            continue
        current.append(projector.project(lon, lat))
        last_lon = lon
    if len(current) > 1:
        segments.append(current)

    tolerance = max(args.ruler * args.route_ruler_scale, 0.01)
    route_path = "".join(
        path_from_points(simplify_polyline(segment, tolerance), close=False, digits=args.digits)
        for segment in segments
    )
    metadata = {
        "latA": round(lat_a, 3),
        "lonA": lon_a,
        "latB": round(lat_b, 3),
        "lonB": lon_b,
        "landKmRounded": land_km,
        "routeSegments": len(segments),
    }
    return route_path, metadata


def resolve_default_gshhg() -> Path:
    for candidate in DEFAULT_GSHHG_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "Could not find GSHHG data. Pass --gshhg /path/to/gshhs_h.b or gshhs_f.b."
    )


def write_svg(args: argparse.Namespace) -> dict:
    if args.gshhg is None:
        args.gshhg = resolve_default_gshhg()

    projector = MercatorProjector(
        x=args.map_x,
        y=args.map_y,
        width=args.map_size,
        height=args.map_size,
        lat_min=args.lat_min,
        lat_max=args.lat_max,
    )
    land_path, kept_polygons, candidate_polygons = build_land_path(args, projector)
    route_path, route_metadata = build_route_path(args, projector)

    clip_id = "slm-map"
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {args.viewbox:g} {args.viewbox:g}" aria-hidden="true">
  <defs>
    <clipPath id="{clip_id}"><rect x="{args.map_x:g}" y="{args.map_y:g}" width="{args.map_size:g}" height="{args.map_size:g}" rx="{args.radius:g}"/></clipPath>
  </defs>
  <rect x="{args.map_x:g}" y="{args.map_y:g}" width="{args.map_size:g}" height="{args.map_size:g}" rx="{args.radius:g}" fill="{args.water}"/>
  <g clip-path="url(#{clip_id})">
    <path d="{land_path}" fill="{args.land}" stroke="{args.coast}" stroke-width="{args.coast_width:g}" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="{route_path}" fill="none" stroke="{args.route}" stroke-width="{args.route_width:g}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
"""
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(svg)
    return {
        "output": str(args.output),
        "bytes": len(svg.encode("utf-8")),
        "gshhg": str(args.gshhg),
        "ruler": args.ruler,
        "latMin": args.lat_min,
        "latMax": args.lat_max,
        "keptPolygons": kept_polygons,
        "candidatePolygons": candidate_polygons,
        **route_metadata,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gshhg", type=Path, help="Path to gshhs_h.b, gshhs_f.b, etc.")
    parser.add_argument("--output", type=Path, default=Path("assets/icons/homepage/straight-line-mission.svg"))
    parser.add_argument("--ruler", type=float, default=0.6, help="Douglas-Peucker tolerance in final SVG units.")
    parser.add_argument("--route-ruler-scale", type=float, default=0.25)
    parser.add_argument("--min-area", type=float, default=0.14, help="Drop projected polygons below this SVG-unit area.")
    parser.add_argument("--max-polygons", type=int, default=35, help="Keep largest N polygons after simplification; 0 keeps all.")
    parser.add_argument("--digits", type=int, default=2, help="Decimal digits to keep in path coordinates.")
    parser.add_argument("--lat-min", type=float, default=-68.0)
    parser.add_argument("--lat-max", type=float, default=84.0)
    parser.add_argument("--viewbox", type=float, default=72.0)
    parser.add_argument("--map-x", type=float, default=9.0)
    parser.add_argument("--map-y", type=float, default=9.0)
    parser.add_argument("--map-size", type=float, default=54.0)
    parser.add_argument("--radius", type=float, default=10.0)
    parser.add_argument("--water", default="#a6d7ee")
    parser.add_argument("--land", default="#b9dd99")
    parser.add_argument("--coast", default="#111")
    parser.add_argument("--route", default="#d9232e")
    parser.add_argument("--coast-width", type=float, default=0.72)
    parser.add_argument("--route-width", type=float, default=1.45)
    parser.add_argument("--route-samples", type=int, default=900)
    parser.add_argument("--heatmap-config", type=Path, default=Path("tools/straight-line-heatmap-1km-1200.json"))
    parser.add_argument("--heatmap-data", type=Path, default=Path("tools/straight-line-heatmap-1km-1200.u16"))
    parser.add_argument("--lat-a", type=float)
    parser.add_argument("--lat-b", type=float)
    parser.add_argument("--lon-a", type=float, default=-30.0)
    parser.add_argument("--lon-b", type=float, default=30.0)
    return parser.parse_args()


def main() -> None:
    summary = write_svg(parse_args())
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
