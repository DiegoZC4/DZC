#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import re
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path("/Users/diego/Desktop/Read/YouTube Channel Transcripts/refresh")
CONFIG = ROOT / "channels.json"
BLACKLIST = ROOT / "blacklist.json"
RUNS = ROOT / "runs"
APP_ROOT = ROOT.parent
DB = APP_ROOT / "data" / "transcripts.sqlite3"
IMPORTER = APP_ROOT / "import.php"
STATIC_CHANNELS_JSON = APP_ROOT / "channels.json"

LANG_PRIORITY = {"en": 0, "en-en": 1, "en-orig": 2}
SUBTITLE_EXT_PRIORITY = {"json3": 0, "vtt": 1, "srt": 2}
CHANNEL_CATEGORIES = {
    "80,000 Hours": "AI",
    "3Blue1Brown": "Math",
    "12tone": "Music",
    "Adam Neely": "Music",
    "Adam Ragusea": "Food",
    "BarryHarrisVideos": "Music",
    "Binging with Babish": "Food",
    "Bill Burr": "Comedy",
    "Bo Burnham": "Comedy",
    "Bret Weinstein": "Philosophy",
    "BroScienceLife": "Comedy",
    "Cape Falcon Kayak": "Engineering",
    "Destiny": "Philosophy",
    "Dwarkesh Patel": "AI",
    "Ear Biscuits": "Comedy",
    "Eric Weinstein": "Philosophy",
    "Henry Segerman": "Math",
    "Robert Sapolsky": "Science",
    "Jacob Collier": "Music",
    "Jake and Amir": "Comedy",
    "JennaMarbles": "Comedy",
    "JREG": "Comedy",
    "Jordan B Peterson": "Philosophy",
    "Jonathan Pageau": "Philosophy",
    "June Lee": "Music",
    "Key & Peele": "Comedy",
    "Lex Fridman": "AI",
    "LifeAccordingToJimmy": "Comedy",
    "Lil Dicky": "Music",
    "Mathologer": "Math",
    "Matan Even": "Comedy",
    "mrgirlreturns Twitch Archive": "Philosophy",
    "Numberphile": "Math",
    "Peter Attia MD": "Health",
    "Practical Engineering": "Engineering",
    "Rick & Esther Have A Time": "Comedy",
    "Rick Beato": "Music",
    "Rick Glassman": "Comedy",
    "Robert Miles AI Safety": "AI",
    "Sam Harris": "Philosophy",
    "SmarterEveryDay": "Science",
    "Starting Strength": "Fitness",
    "Stand-up Maths": "Math",
    "Steve Mould": "Engineering",
    "Stromae": "Music",
    "Supergood": "Comedy",
    "Tech Ingredients": "Engineering",
    "Technology Connections": "Engineering",
    "The Fighter and The Kid": "Comedy",
    "The Tim Dillon Show": "Comedy",
    "Theo Von": "Comedy",
    "TigerBelly": "Comedy",
    "Veritasium": "Science",
}


def run(cmd: list[str], *, dry_run: bool = False) -> subprocess.CompletedProcess[str]:
    print("$ " + " ".join(cmd), file=sys.stderr)
    if dry_run:
        return subprocess.CompletedProcess(cmd, 0, "", "")
    return subprocess.run(cmd, text=True, capture_output=True, check=False)


def load_config() -> list[dict]:
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def load_blacklist() -> set[str]:
    if not BLACKLIST.exists():
        return set()
    payload = json.loads(BLACKLIST.read_text(encoding="utf-8"))
    videos = payload.get("videos", payload if isinstance(payload, list) else [])
    if not isinstance(videos, list):
        return set()
    ids = set()
    for item in videos:
        if isinstance(item, str):
            ids.add(item)
        elif isinstance(item, dict) and item.get("youtube_id"):
            ids.add(str(item["youtube_id"]))
    return ids


def existing_ids(channel: str) -> set[str]:
    with sqlite3.connect(DB) as conn:
        rows = conn.execute(
            "SELECT v.youtube_id FROM videos v JOIN channels c ON c.id = v.channel_id "
            "WHERE c.name = ?",
            (channel,),
        ).fetchall()
    return {row[0] for row in rows}


def all_db_channels() -> set[str]:
    with sqlite3.connect(DB) as conn:
        rows = conn.execute(
            "SELECT DISTINCT c.name "
            "FROM videos v JOIN channels c ON c.id = v.channel_id"
        ).fetchall()
    return {row[0] for row in rows}


def videos_url(url: str) -> str:
    url = url.rstrip("/")
    return url if url.endswith("/videos") else url + "/videos"


def safe_path(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or "channel"


def cookie_args(args: argparse.Namespace) -> list[str]:
    return ["--cookies-from-browser", args.cookies_from_browser] if args.cookies_from_browser else []


def fetch_latest_entries(url: str, scan_limit: int, args: argparse.Namespace) -> list[dict]:
    cmd = [
        "/opt/homebrew/bin/yt-dlp",
        *cookie_args(args),
        "--flat-playlist",
        "--ignore-errors",
        "--dump-single-json",
        "--playlist-end",
        str(scan_limit),
        videos_url(url),
    ]
    proc = run(cmd)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip())
    payload = json.loads(proc.stdout)
    return [entry for entry in payload.get("entries", []) if isinstance(entry, dict) and entry.get("id")]


def new_entries(entries: list[dict], known: set[str], continue_after_known: bool) -> list[dict]:
    fresh = []
    for entry in entries:
        video_id = str(entry["id"])
        if video_id in known:
            if not continue_after_known:
                break
            continue
        fresh.append(entry)
    return list(reversed(fresh))


def filter_entries_by_title(entries: list[dict], include_title_regex: str) -> list[dict]:
    if not include_title_regex:
        return entries
    pattern = re.compile(include_title_regex)
    return [entry for entry in entries if pattern.search(str(entry.get("title", "")))]


def subtitle_languages(row: dict) -> str:
    value = str(row.get("sub_langs", "")).strip()
    return value or "en,en-en,en-orig"


def download_subtitles(channel: str, entries: list[dict], out_dir: Path, args: argparse.Namespace, sub_langs: str) -> None:
    if not entries:
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    urls = [f"https://www.youtube.com/watch?v={entry['id']}" for entry in entries]
    cmd = [
        "/opt/homebrew/bin/yt-dlp",
        *cookie_args(args),
        "--ignore-errors",
        "--ignore-no-formats-error",
        "--skip-download",
        "--write-auto-subs",
        "--write-subs",
        "--sub-langs",
        sub_langs,
        "--sub-format",
        "json3/vtt/srt",
        "-o",
        str(out_dir / "%(upload_date>%Y-%m-%d)s - %(title).180B [%(id)s].%(ext)s"),
        *urls,
    ]
    proc = run(cmd, dry_run=args.dry_run)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        raise RuntimeError(f"subtitle download failed for {channel}")


def clean_text(text: str) -> str:
    text = html.unescape(text)
    text = text.replace(r"\h", " ")
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\{\\[^}]+\}", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def ms_to_srt_time(ms: int) -> str:
    hours, remainder = divmod(max(0, ms), 3600000)
    minutes, remainder = divmod(remainder, 60000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def vtt_time_to_srt(value: str) -> str:
    value = value.strip().replace(".", ",")
    if re.match(r"^\d{2}:\d{2},\d{3}$", value):
        return "00:" + value
    if re.match(r"^\d{2}:\d{2}:\d{2},\d{3}$", value):
        return value
    return value


def clean_caption_text(previous_text: str, text: str) -> str:
    text = clean_text(text)
    text = strip_overlapping_caption_prefix(previous_text, text)
    return collapse_repeated_caption_phrases(text)


def parse_json3(path: Path) -> list[tuple[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig", errors="replace"))
    cues = []
    for event in payload.get("events", []):
        segs = event.get("segs")
        if not isinstance(segs, list):
            continue
        raw_text = "".join(str(seg.get("utf8", "")) for seg in segs if isinstance(seg, dict))
        text = clean_text(raw_text)
        if not text:
            continue
        cues.append((ms_to_srt_time(int(event.get("tStartMs", 0))), text))
    return cues


def parse_srt(path: Path) -> list[tuple[str, str]]:
    cues = []
    previous_text = ""
    lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if re.fullmatch(r"\d+", line):
            i += 1
            if i >= len(lines):
                break
            line = lines[i].strip()
        match = re.match(r"(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+", line)
        if not match:
            i += 1
            continue
        start = match.group(1).replace(".", ",")
        i += 1
        text_lines = []
        while i < len(lines) and lines[i].strip() != "":
            text_lines.append(lines[i])
            i += 1
        raw_text = " ".join(text_lines)
        text = clean_caption_text(previous_text, raw_text)
        if text:
            cues.append((start, text))
        previous_text = clean_text(raw_text)
        i += 1
    return cues


def parse_vtt(path: Path) -> list[tuple[str, str]]:
    cues = []
    previous_text = ""
    lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        match = re.match(r"((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})\s+-->\s+", line)
        if not match:
            i += 1
            continue
        start = vtt_time_to_srt(match.group(1))
        i += 1
        text_lines = []
        while i < len(lines) and lines[i].strip() != "":
            text_lines.append(lines[i])
            i += 1
        raw_text = " ".join(text_lines)
        text = clean_caption_text(previous_text, raw_text)
        if text:
            cues.append((start, text))
        previous_text = clean_text(raw_text)
        i += 1
    return cues


def parse_subtitle(path: Path) -> list[tuple[str, str]]:
    if path.suffix == ".json3":
        return parse_json3(path)
    if path.suffix == ".vtt":
        return parse_vtt(path)
    return parse_srt(path)


def strip_overlapping_caption_prefix(previous: str, current: str) -> str:
    previous_words = word_spans(previous)
    current_words = word_spans(current)
    max_overlap = min(len(previous_words), len(current_words))
    for size in range(max_overlap, 0, -1):
        previous_suffix = [word for word, _start, _end in previous_words[-size:]]
        current_prefix = [word for word, _start, _end in current_words[:size]]
        if previous_suffix == current_prefix:
            return current[current_words[size - 1][2]:].lstrip()
    return current


def collapse_repeated_caption_phrases(text: str, min_words: int = 1, max_words: int = 16) -> str:
    words = word_spans(text)
    if len(words) < min_words * 2:
        return text

    cuts: list[tuple[int, int]] = []
    index = 0
    while index < len(words):
        best_size = 0
        best_count = 1
        limit = min(max_words, (len(words) - index) // 2)
        for size in range(limit, min_words - 1, -1):
            phrase = [word for word, _start, _end in words[index:index + size]]
            count = 1
            while index + ((count + 1) * size) <= len(words):
                start = index + (count * size)
                candidate = [word for word, _start, _end in words[start:start + size]]
                if candidate != phrase:
                    break
                count += 1
            if count > 1:
                best_size = size
                best_count = count
                break
        if best_size:
            cut_start = words[index + best_size][1]
            cut_end = words[index + (best_size * best_count) - 1][2]
            cuts.append((cut_start, cut_end))
            index += best_size * best_count
        else:
            index += 1

    if not cuts:
        return text

    parts: list[str] = []
    cursor = 0
    for cut_start, cut_end in cuts:
        parts.append(text[cursor:cut_start])
        cursor = cut_end
    parts.append(text[cursor:])
    return clean_text("".join(parts))


def word_spans(text: str) -> list[tuple[str, int, int]]:
    return [(match.group(0).casefold(), match.start(), match.end()) for match in re.finditer(r"\w+", text, flags=re.UNICODE)]


def subtitle_key(path: Path) -> tuple[str, str, str]:
    match = re.match(r"(.+)\.([A-Za-z-]+)\.(json3|vtt|srt)$", path.name)
    stem = match.group(1) if match else path.stem
    lang = match.group(2) if match else ""
    ext = match.group(3) if match else path.suffix.lstrip(".")
    id_match = re.search(r"\[([A-Za-z0-9_-]{11})\]$", stem)
    return (id_match.group(1) if id_match else stem[-11:], lang, ext)


def title_from_subtitle(path: Path) -> str:
    match = re.match(r"(.+)\.[A-Za-z-]+\.(json3|vtt|srt)$", path.name)
    stem = match.group(1) if match else path.stem
    stem = re.sub(r"\s+\[[A-Za-z0-9_-]{11}\]$", "", stem)
    stem = re.sub(r"^\d{4}-\d{2}-\d{2}\s+-\s+", "", stem)
    return stem.strip() or "Untitled"


def best_subtitles(channel_dir: Path) -> list[Path]:
    best: dict[str, tuple[tuple[int, int], Path]] = {}
    for path in channel_dir.rglob("*"):
        if path.suffix.lstrip(".") not in SUBTITLE_EXT_PRIORITY:
            continue
        video_id, lang, ext = subtitle_key(path)
        priority = (SUBTITLE_EXT_PRIORITY.get(ext, 99), LANG_PRIORITY.get(lang, 99))
        current = best.get(video_id)
        if current is None or priority < current[0]:
            best[video_id] = (priority, path)
    return [item[1] for item in sorted(best.values(), key=lambda item: item[1].name)]


def write_markdown(channel: str, channel_dir: Path, markdown_dir: Path) -> tuple[Path, int, int]:
    markdown_dir.mkdir(parents=True, exist_ok=True)
    out = markdown_dir / f"{channel} - Transcripts.md"
    videos = 0
    segments = 0
    with out.open("w", encoding="utf-8") as handle:
        for subtitle in best_subtitles(channel_dir):
            video_id, _lang, _ext = subtitle_key(subtitle)
            cues = parse_subtitle(subtitle)
            if not cues:
                continue
            videos += 1
            segments += len(cues)
            handle.write(f"# {title_from_subtitle(subtitle)} ({video_id})\n\n")
            for index, (start, text) in enumerate(cues, 1):
                handle.write(f"{index}\n{start} --> {start}\n{text}\n\n")
    return out, videos, segments


def import_markdown(markdown_dir: Path, dry_run: bool) -> None:
    if dry_run:
        return
    proc = run(["/opt/homebrew/bin/php", str(IMPORTER), f"--source={markdown_dir}"])
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        raise RuntimeError("PHP transcript import failed")
    print(proc.stdout.strip())


def update_static_channels_json() -> None:
    configured_by_name = {row["channel"]: row for row in load_config()}
    with sqlite3.connect(DB) as conn:
        channel_rows = conn.execute(
            "SELECT c.name, COUNT(v.youtube_id) AS video_count, c.category, c.url, c.avatar_url "
            "FROM channels c JOIN videos v ON v.channel_id = c.id "
            "GROUP BY c.id ORDER BY c.name COLLATE NOCASE"
        ).fetchall()
        stats = conn.execute("SELECT COUNT(*), COUNT(DISTINCT channel) FROM videos").fetchone()
        segments = conn.execute("SELECT COUNT(*) FROM segments").fetchone()[0]
    channel_payload = []
    for channel, video_count, category, url, avatar_url in channel_rows:
        configured = configured_by_name.get(channel, {})
        item = {
            "channel": channel,
            "video_count": video_count,
            "category": category or CHANNEL_CATEGORIES.get(channel, "Other"),
        }
        item_url = url or configured.get("url") or ""
        item_avatar = avatar_url or configured.get("avatar_url") or ""
        if item_url:
            item["url"] = item_url
        if item_avatar:
            item["avatar_url"] = item_avatar
        channel_payload.append(item)
    payload = {
        "ok": True,
        "version": "1",
        "channels": channel_payload,
        "stats": {
            "videos": stats[0],
            "segments": segments,
            "channels": stats[1],
        },
    }
    STATIC_CHANNELS_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def refresh_channels(args: argparse.Namespace) -> int:
    configured = load_config()
    blacklist = load_blacklist()
    configured_by_name = {row["channel"]: row for row in configured}
    wanted = set(args.channel or [])
    db_channels = all_db_channels()
    rows = []
    imported_any = False
    for row in configured:
        if wanted and row["channel"] not in wanted:
            continue
        if not row.get("enabled", True) and not wanted:
            continue
        rows.append(row)
    missing = sorted((wanted or db_channels) - set(configured_by_name))
    for channel in missing:
        print(f"[skip] {channel}: no URL in {CONFIG}", file=sys.stderr)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = RUNS / stamp
    subs_dir = run_dir / "subs"
    markdown_dir = run_dir / "markdown"
    report = []
    for row in rows:
        channel = row["channel"]
        url = row.get("url", "")
        try:
            if not url:
                report.append({"channel": channel, "status": "skipped", "reason": "missing url"})
                continue
            known = existing_ids(channel) | blacklist
            print(f"\n== {channel} ({len(known)} known) ==", file=sys.stderr)
            entries = fetch_latest_entries(url, args.scan_limit, args)
            fresh = new_entries(entries, known, args.continue_after_known)
            fresh = filter_entries_by_title(fresh, str(row.get("include_title_regex", "")))
            if args.max_new is not None:
                fresh = fresh[: args.max_new]
            print(f"{len(fresh)} new video(s)", file=sys.stderr)
            if not fresh:
                report.append({"channel": channel, "status": "up-to-date", "new_videos": 0})
                continue
            sub_langs = subtitle_languages(row)
            print(f"subtitle languages: {sub_langs}", file=sys.stderr)
            channel_subs = subs_dir / channel
            channel_markdown_dir = markdown_dir / safe_path(channel)
            download_subtitles(channel, fresh, channel_subs, args, sub_langs)
            md_path, videos, segments = write_markdown(channel, channel_subs, channel_markdown_dir) if not args.dry_run else (Path(""), 0, 0)
            if videos:
                import_markdown(channel_markdown_dir, args.dry_run)
                imported_any = imported_any or not args.dry_run
            report.append({
                "channel": channel,
                "status": "downloaded",
                "new_videos_detected": len(fresh),
                "videos_with_captions": videos,
                "segments": segments,
                "markdown": str(md_path),
            })
        except Exception as exc:
            report.append({"channel": channel, "status": "error", "error": str(exc)})
            print(f"[error] {channel}: {exc}", file=sys.stderr)
            continue

    if not args.dry_run:
        if imported_any:
            run(["/opt/homebrew/bin/php", "-r", f"require {json.dumps(str(APP_ROOT / 'lib.php'))}; yt_refresh_channel_stats(yt_db());"])
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"report: {run_dir / 'report.json'}")
    else:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh transcript DB with new videos from previously scraped YouTube channels.")
    parser.add_argument("--update-channel-json-only", action="store_true", help="Legacy: regenerate the old static channels.json from the SQLite DB and exit.")
    parser.add_argument("--channel", action="append", help="Refresh one channel name from refresh/channels.json. Repeat for multiple.")
    parser.add_argument("--scan-limit", type=int, default=30, help="Newest videos to inspect per channel before giving up.")
    parser.add_argument("--max-new", type=int, default=None, help="Maximum new videos to fetch per channel.")
    parser.add_argument("--continue-after-known", action="store_true", help="Keep scanning after known videos instead of stopping at the first known ID.")
    parser.add_argument("--dry-run", action="store_true", help="Detect new videos without downloading/importing.")
    parser.add_argument("--no-update-channel-json", action="store_true", help="Deprecated; the website now reads channels from SQLite.")
    parser.add_argument("--cookies-from-browser", default="chrome", help="Browser profile for yt-dlp cookies, or empty string to disable. Default: chrome.")
    args = parser.parse_args()
    if args.update_channel_json_only:
        update_static_channels_json()
        return 0
    return refresh_channels(args)


if __name__ == "__main__":
    raise SystemExit(main())
