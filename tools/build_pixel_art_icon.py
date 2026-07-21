#!/usr/bin/env python3
"""Build the animated Vailur homepage icon from pixel-art JSON sources."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "raw": ROOT / "assets/pixel-art/vailur-raw.json",
    "rags": ROOT / "assets/pixel-art/vailur-rags.json",
    "rogue": ROOT / "assets/pixel-art/vailur-rogue.json",
}
OUTPUT = ROOT / "assets/icons/homepage/pixel-art.svg"
STATE_STOPS = [
    (0, "rogue"),
    (12, "rogue"),
    (22, "rags"),
    (34, "rags"),
    (44, "raw"),
    (56, "raw"),
    (66, "rags"),
    (78, "rags"),
    (88, "rogue"),
    (100, "rogue"),
]
VARIANT_ORDER = ("raw", "rags", "rogue")
PIXEL_OVERLAP = 0.02


def svg_number(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def load_art(path: Path) -> list[list[str | None]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    pixels = data["pixels"]
    if len(pixels) != 32 or any(len(row) != 32 for row in pixels):
        raise ValueError(f"{path} must be 32x32 pixels.")
    palette = data["palette"]
    return [[None if value == 0 else palette[value - 1] for value in row] for row in pixels]


def pixel_path(coords: list[tuple[int, int]]) -> str:
    # Keep a tiny overlap for SVG fallback rendering without visibly fattening the sprite.
    size = 1 + 2 * PIXEL_OVERLAP
    size_text = svg_number(size)
    return "".join(
        f"M{svg_number(x - PIXEL_OVERLAP)} {svg_number(y - PIXEL_OVERLAP)}"
        f"h{size_text}v{size_text}h-{size_text}z"
        for x, y in coords
    )


def default_color(sequence: tuple[str | None, ...]) -> str:
    for color in sequence:
        if color is not None:
            return color
    raise ValueError("Animated pixel sequence has no visible color.")


def fill_for_stop(sequence: tuple[str | None, ...], index: int) -> str:
    if sequence[index] is not None:
        return sequence[index] or "#000000"
    for offset in range(1, len(sequence)):
        for candidate_index in (index - offset, index + offset):
            if 0 <= candidate_index < len(sequence) and sequence[candidate_index] is not None:
                return sequence[candidate_index] or "#000000"
    return "#000000"


def keyframe_css(name: str, sequence: tuple[str | None, ...]) -> str:
    frames = []
    for index, (percent, _) in enumerate(STATE_STOPS):
        color = fill_for_stop(sequence, index)
        opacity = 0 if sequence[index] is None else 1
        frames.append(f"{percent}%{{fill:{color};opacity:{opacity}}}")
    return f"    @keyframes {name}{{{''.join(frames)}}}"


def main() -> None:
    art = {name: load_art(path) for name, path in SOURCES.items()}
    static_paths: dict[str, list[tuple[int, int]]] = defaultdict(list)
    animated_paths: dict[tuple[str | None, ...], list[tuple[int, int]]] = defaultdict(list)

    for y in range(32):
        for x in range(32):
            variant_colors = tuple(art[name][y][x] for name in VARIANT_ORDER)
            if all(color is None for color in variant_colors):
                continue
            if len(set(variant_colors)) == 1:
                static_paths[variant_colors[0] or "#000000"].append((x, y))
                continue
            animated_sequence = tuple(art[state][y][x] for _, state in STATE_STOPS)
            animated_paths[animated_sequence].append((x, y))

    dynamic_rules: list[str] = []
    dynamic_keyframes: list[str] = []
    dynamic_paths: list[str] = []
    for index, (sequence, coords) in enumerate(animated_paths.items()):
        class_name = f"vailur-seq-{index}"
        keyframe_name = f"vailur-fill-{index}"
        dynamic_rules.append(
            f"    .{class_name}{{fill:{default_color(sequence)};opacity:{0 if sequence[0] is None else 1};--vailur-keyframes:{keyframe_name}}}"
        )
        dynamic_keyframes.append(keyframe_css(keyframe_name, sequence))
        dynamic_paths.append(f'    <path class="vailur-pixel {class_name}" d="{pixel_path(coords)}"/>')

    static_paths_svg = [
        f'    <path fill="{color}" d="{pixel_path(coords)}"/>'
        for color, coords in sorted(static_paths.items())
    ]
    OUTPUT.write_text(f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" shape-rendering="crispEdges">
  <title>Vailur pixel art outfit cycle</title>
  <style>
    svg{{--vailur-cycle-duration:5.8s}}
    .back{{fill:#f1e6d2;stroke:#d7c7ad;stroke-width:1.4;shape-rendering:geometricPrecision}}
    .vailur-stage{{shape-rendering:crispEdges}}
    .vailur-stage path{{stroke:none;stroke-width:0;shape-rendering:crispEdges}}
    .vailur-pixel{{animation-duration:var(--vailur-cycle-duration);animation-timing-function:linear;animation-iteration-count:infinite}}
{chr(10).join(dynamic_rules)}
    svg:hover .vailur-pixel{{animation-name:var(--vailur-keyframes)}}
    @media (prefers-reduced-motion:reduce){{svg:hover .vailur-pixel{{animation-name:none}}}}
{chr(10).join(dynamic_keyframes)}
  </style>
  <rect class="back" x="9" y="9" width="54" height="54" rx="10"/>
  <g class="vailur-stage" transform="translate(24 10.7) scale(1.58) translate(-8 0)">
{chr(10).join(static_paths_svg + dynamic_paths)}
  </g>
</svg>
""", encoding="utf-8")
    print(
        f"Built {OUTPUT} with {sum(len(v) for v in static_paths.values())} static pixels "
        f"and {sum(len(v) for v in animated_paths.values())} animated pixels."
    )


if __name__ == "__main__":
    main()
