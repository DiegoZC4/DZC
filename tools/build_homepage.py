#!/usr/bin/env python3
"""Build index.html from homepage-manifest.json.

The homepage should not paint hidden/low-priority cards and then filter them
with JavaScript. This script treats homepage-manifest.json as the source of
truth and writes only the currently visible pages into index.html.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from textwrap import indent


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "homepage-manifest.json"
DEFAULT_INDEX = ROOT / "index.html"
INLINE_ICON_IDS = {"amino-acid-dag", "upper-bounds-on-tolerable-risk", "soroban", "toddle-time"}
PIXEL_ART_SOURCES = {
    "raw": ROOT / "assets/pixel-art/vailur-raw.json",
    "rags": ROOT / "assets/pixel-art/vailur-rags.json",
    "rogue": ROOT / "assets/pixel-art/vailur-rogue.json",
}
PIXEL_ART_REST_MS = 725
PIXEL_ART_TRANSITION_MS = 725
PIXEL_ART_STOPS = [
    {"pct": 0, "state": "rogue"},
    {"pct": 25, "state": "rags"},
    {"pct": 50, "state": "raw"},
    {"pct": 75, "state": "rags"},
    {"pct": 100, "state": "rogue"},
]

SHOWCASE_RE = re.compile(
    r"(?P<open>\n    <ol class=\"showcase\" aria-label=\"Most impressive work\">\n)"
    r"(?P<body>.*?)"
    r"(?P<close>\n    </ol>)",
    re.S,
)


def escape_attr(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def escape_text(value: object) -> str:
    return html.escape(str(value or ""), quote=False)


def is_external_href(href: str) -> bool:
    return href.startswith(("http://", "https://"))


def visible_pages(manifest: dict) -> list[dict]:
    indexed_pages = list(enumerate(manifest.get("pages") or []))
    indexed_pages.sort(key=lambda item: (float(item[1].get("priority") or 10_000), item[0]))
    return [page for _, page in indexed_pages if page.get("visible") is not False]


def render_icon(page: dict) -> str:
    icon = str(page.get("icon") or "")
    page_id = str(page.get("id") or "")
    video_icon = page.get("videoIcon") or {}
    if video_icon:
        webm = str(video_icon.get("webm") or "")
        mp4 = str(video_icon.get("mp4") or "")
        sources = []
        if webm:
            sources.append(f'              <source src="{escape_attr(webm)}" type="video/webm">')
        if mp4:
            sources.append(f'              <source src="{escape_attr(mp4)}" type="video/mp4">')
        return (
            '<span class="mark mark-video" aria-hidden="true">\n'
            f'            <img class="homepage-video-poster" src="{escape_attr(icon)}" alt="">\n'
            f'            <video class="homepage-hover-video" data-hover-video muted loop playsinline preload="metadata" poster="{escape_attr(icon)}">\n'
            f"{chr(10).join(sources)}\n"
            f'              <img src="{escape_attr(icon)}" alt="">\n'
            "            </video>\n"
            "          </span>"
        )
    if page_id == "pixel-art":
        sprite_data = {
            "durationMs": (len(PIXEL_ART_STOPS) - 1) * (PIXEL_ART_REST_MS + PIXEL_ART_TRANSITION_MS),
            "restMs": PIXEL_ART_REST_MS,
            "transitionMs": PIXEL_ART_TRANSITION_MS,
            "stops": PIXEL_ART_STOPS,
            "sprites": {
                name: json.loads(path.read_text(encoding="utf-8"))
                for name, path in PIXEL_ART_SOURCES.items()
            },
        }
        return (
            '<span class="mark mark-inline vailur-canvas-icon" aria-hidden="true">\n'
            '            <canvas class="vailur-canvas" width="96" height="96" '
            f"data-vailur-sprites=\"{escape_attr(json.dumps(sprite_data, separators=(',', ':')))}\"></canvas>\n"
            "          </span>"
        )
    if page_id in INLINE_ICON_IDS:
        svg_path = ROOT / icon
        svg = svg_path.read_text(encoding="utf-8").strip()
        return (
            '<span class="mark mark-inline" aria-hidden="true">\n'
            f"{indent(svg, '            ')}\n"
            "          </span>"
        )
    return f'<img class="mark" src="{escape_attr(icon)}" alt="" aria-hidden="true">'


def render_regular_card(page: dict) -> str:
    href = str(page.get("href") or "")
    attrs = f'class="showcase-link" href="{escape_attr(href)}"'
    if is_external_href(href):
        attrs += ' target="_blank" rel="noopener noreferrer"'
    return f"""      <li class="showcase-card" data-page-id="{escape_attr(page.get("id"))}">
        <a {attrs}>
          {render_icon(page)}
          <span>
            <span class="title">{escape_text(page.get("title"))}</span>
          </span>
        </a>
      </li>"""


def render_audio_title(page: dict) -> str:
    if page.get("id") == "the-bohemian-end":
        return (
            'The <a href="https://youtu.be/fJ9rUzIMcZQ?t=53" target="_blank" rel="noopener">'
            'Bohemian</a> <a href="https://youtu.be/12R4FzIhdoQ?t=90" target="_blank" rel="noopener">'
            "End</a>"
        )
    return escape_text(page.get("title"))


def render_audio_card(page: dict) -> str:
    title_text = escape_attr(page.get("title") or "Audio")
    src = escape_attr(page.get("href"))
    return f"""      <li class="showcase-card audio-card" data-page-id="{escape_attr(page.get("id"))}">
        <article class="showcase-player" aria-label="{title_text} audio player">
          <button class="audio-icon-button" type="button" data-audio-toggle aria-label="Play {title_text}" aria-pressed="false">
            {render_icon(page)}
            <span class="audio-icon-state" aria-hidden="true">
              <span class="audio-play-disc"></span>
              <span class="audio-play-shape"></span>
              <span class="audio-pause-shape"></span>
            </span>
            <span class="sr-only" data-audio-toggle-label>Play</span>
          </button>
          <span class="audio-copy">
            <span class="title">{render_audio_title(page)}</span>
            <span class="audio-controls">
              <span class="audio-timeline">
                <span class="audio-scrub" data-audio-scrub role="slider" tabindex="0" aria-label="Scrub {title_text}" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-disabled="true">
                  <span class="audio-scrub-track" aria-hidden="true">
                    <span class="audio-scrub-fill"></span>
                    <span class="audio-scrub-thumb"></span>
                  </span>
                </span>
              </span>
              <span class="audio-meta">
                <span class="audio-time" data-audio-time>0:00</span>
                <span class="audio-volume">
                  <span class="audio-volume-icon" data-audio-volume-icon data-level="2" aria-hidden="true">
                    <span class="audio-speaker-box"></span>
                    <span class="audio-speaker-cone"></span>
                    <span class="audio-volume-wave"></span>
                    <span class="audio-volume-wave"></span>
                    <span class="audio-volume-wave"></span>
                    <span class="audio-volume-x"></span>
                  </span>
                  <span class="audio-volume-value" data-audio-volume role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="65" aria-valuetext="65 percent">65</span>
                </span>
              </span>
            </span>
            <audio data-homepage-audio preload="auto" src="{src}"></audio>
          </span>
        </article>
      </li>"""


def render_card(page: dict) -> str:
    if page.get("type") == "audio":
        return render_audio_card(page)
    return render_regular_card(page)


def build_index(manifest_path: Path, index_path: Path) -> int:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    index_html = index_path.read_text(encoding="utf-8")
    cards = "\n\n".join(render_card(page) for page in visible_pages(manifest))
    replacement = (
        r"\g<open>"
        "      <!-- homepage-cards:start generated by tools/build_homepage.py -->\n"
        f"{cards}\n"
        "      <!-- homepage-cards:end -->"
        r"\g<close>"
    )
    next_html, replacements = SHOWCASE_RE.subn(replacement, index_html, count=1)
    if replacements != 1:
        raise RuntimeError("Could not find the homepage showcase <ol> in index.html.")
    index_path.write_text(next_html, encoding="utf-8")
    return len(visible_pages(manifest))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    args = parser.parse_args()
    count = build_index(args.manifest, args.index)
    print(f"Built {args.index} with {count} visible homepage cards.")


if __name__ == "__main__":
    main()
