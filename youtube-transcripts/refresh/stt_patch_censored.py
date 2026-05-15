#!/usr/bin/env python3
from __future__ import annotations

import argparse
import bisect
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


APP_ROOT = Path("/Users/diego/Desktop/Read/YouTube Channel Transcripts")
DB = APP_ROOT / "data" / "transcripts.sqlite3"
RUNS = APP_ROOT / "refresh" / "runs"
WHISPER = APP_ROOT / "Whisper" / ".venv" / "bin" / "whisper"
YTDLP = "/opt/homebrew/bin/yt-dlp"
FFMPEG = "ffmpeg"
MARKER = "[ __ ]"


@dataclass
class Segment:
    start_seconds: int
    char_index: int


@dataclass
class Marker:
    index: int
    char_start: int
    char_end: int
    start_seconds: float
    end_seconds: float
    window_index: int = 0
    window_start: float = 0.0
    window_end: float = 0.0
    youtube_before: str = ""
    youtube_after: str = ""
    youtube_excerpt: str = ""


@dataclass
class Word:
    text: str
    start: float
    end: float


def run(cmd: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    print("$ " + summarize_cmd(cmd), file=sys.stderr)
    return subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, check=False)


def summarize_cmd(cmd: list[str]) -> str:
    safe = []
    for item in cmd:
        if len(item) > 180:
            safe.append(item[:177] + "...")
        else:
            safe.append(item)
    if len(safe) <= 18:
        return " ".join(safe)
    return " ".join(safe[:18]) + f" ... [{len(safe) - 18} more args]"


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS stt_patch_runs (
            id INTEGER PRIMARY KEY,
            created_at TEXT NOT NULL,
            video_id TEXT NOT NULL,
            model TEXT NOT NULL,
            pad_seconds REAL NOT NULL,
            merge_gap_seconds REAL NOT NULL,
            apply_mode INTEGER NOT NULL,
            status TEXT NOT NULL,
            windows INTEGER NOT NULL DEFAULT 0,
            markers INTEGER NOT NULL DEFAULT 0,
            applied INTEGER NOT NULL DEFAULT 0,
            audio_seconds REAL NOT NULL DEFAULT 0,
            error TEXT NOT NULL DEFAULT '',
            FOREIGN KEY(video_id) REFERENCES videos(youtube_id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS stt_patch_markers (
            id INTEGER PRIMARY KEY,
            run_id INTEGER NOT NULL,
            video_id TEXT NOT NULL,
            marker_index INTEGER NOT NULL,
            marker_char_start INTEGER NOT NULL,
            marker_char_end INTEGER NOT NULL,
            marker_start_seconds REAL NOT NULL,
            marker_end_seconds REAL NOT NULL,
            window_index INTEGER NOT NULL,
            window_start_seconds REAL NOT NULL,
            window_end_seconds REAL NOT NULL,
            youtube_before TEXT NOT NULL DEFAULT '',
            youtube_after TEXT NOT NULL DEFAULT '',
            youtube_excerpt TEXT NOT NULL DEFAULT '',
            stt_text TEXT NOT NULL DEFAULT '',
            stt_excerpt TEXT NOT NULL DEFAULT '',
            candidate_text TEXT NOT NULL DEFAULT '',
            replacement_text TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0,
            reason TEXT NOT NULL DEFAULT '',
            applied INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES stt_patch_runs(id) ON DELETE CASCADE,
            FOREIGN KEY(video_id) REFERENCES videos(youtube_id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_stt_patch_markers_video ON stt_patch_markers(video_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_stt_patch_markers_run ON stt_patch_markers(run_id)")


def fetch_video(conn: sqlite3.Connection, video_id: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT v.youtube_id, v.title, v.transcript, c.name AS channel
        FROM videos v
        JOIN channels c ON c.id = v.channel_id
        WHERE v.youtube_id = ?
        """,
        (video_id,),
    ).fetchone()
    if not row:
        raise SystemExit(f"Video not found: {video_id}")
    return {"youtube_id": row[0], "title": row[1], "transcript": row[2], "channel": row[3]}


def fetch_segments(conn: sqlite3.Connection, video_id: str) -> list[Segment]:
    rows = conn.execute(
        "SELECT start_seconds, char_index FROM segments WHERE video_id = ? ORDER BY char_index",
        (video_id,),
    ).fetchall()
    return [Segment(int(row[0]), int(row[1])) for row in rows]


def seconds_for_char(segments: list[Segment], offset: int) -> tuple[float, float]:
    indexes = [segment.char_index for segment in segments]
    position = bisect.bisect_right(indexes, offset) - 1
    if position < 0:
        position = 0
    start = float(segments[position].start_seconds)
    if position + 1 < len(segments):
        end = float(segments[position + 1].start_seconds)
    else:
        end = start + 8.0
    return start, max(start + 0.5, end)


def find_markers(transcript: str, segments: list[Segment], context_chars: int) -> list[Marker]:
    markers = []
    pos = 0
    while True:
        offset = transcript.find(MARKER, pos)
        if offset < 0:
            break
        start_seconds, end_seconds = seconds_for_char(segments, offset)
        before_start = max(0, offset - context_chars)
        after_end = min(len(transcript), offset + len(MARKER) + context_chars)
        markers.append(
            Marker(
                index=len(markers),
                char_start=offset,
                char_end=offset + len(MARKER),
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                youtube_before=transcript[before_start:offset],
                youtube_after=transcript[offset + len(MARKER):after_end],
                youtube_excerpt=transcript[before_start:after_end],
            )
        )
        pos = offset + len(MARKER)
    return markers


def build_windows(markers: list[Marker], duration: float, pad: float, merge_gap: float) -> list[tuple[float, float, list[Marker]]]:
    intervals = []
    for marker in markers:
        start = max(0.0, marker.start_seconds - pad)
        end = min(duration, max(marker.end_seconds, marker.start_seconds + 0.5) + pad)
        intervals.append((start, end, marker))
    intervals.sort(key=lambda item: item[0])
    windows: list[list[Any]] = []
    for start, end, marker in intervals:
        if not windows or start > float(windows[-1][1]) + merge_gap:
            windows.append([start, end, [marker]])
        else:
            windows[-1][1] = max(float(windows[-1][1]), end)
            windows[-1][2].append(marker)
    out = []
    for index, (start, end, window_markers) in enumerate(windows):
        for marker in window_markers:
            marker.window_index = index
            marker.window_start = float(start)
            marker.window_end = float(end)
        out.append((float(start), float(end), list(window_markers)))
    return out


def video_duration(segments: list[Segment]) -> float:
    return float(max((segment.start_seconds for segment in segments), default=0) + 8)


def ytdlp_cookie_args(args: argparse.Namespace) -> list[str]:
    if args.cookies_from_browser == "":
        return []
    return ["--cookies-from-browser", args.cookies_from_browser]


def get_audio_url(video_id: str, args: argparse.Namespace) -> str:
    proc = run([
        YTDLP,
        *ytdlp_cookie_args(args),
        "--no-playlist",
        "-f",
        "ba",
        "-g",
        f"https://www.youtube.com/watch?v={video_id}",
    ])
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip())
    urls = [line.strip() for line in proc.stdout.splitlines() if line.strip().startswith("http")]
    if not urls:
        raise RuntimeError("yt-dlp did not return a direct audio URL")
    return urls[-1]


def cut_audio(audio_url: str, start: float, end: float, out_path: Path) -> None:
    duration = max(0.5, end - start)
    proc = run([
        FFMPEG,
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        audio_url,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-y",
        str(out_path),
    ])
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip())


def transcribe_window(wav_path: Path, out_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    proc = run([
        str(args.whisper_bin),
        str(wav_path),
        "--model",
        args.model,
        "--model_dir",
        str(args.model_dir),
        "--device",
        args.device,
        "--language",
        "en",
        "--fp16",
        "False",
        "--word_timestamps",
        "True",
        "--condition_on_previous_text",
        "False",
        "--output_format",
        "json",
        "--output_dir",
        str(out_dir),
        "--verbose",
        "False",
    ])
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip())
    json_path = out_dir / (wav_path.stem + ".json")
    if not json_path.exists():
        raise RuntimeError(f"Whisper did not write {json_path}")
    return json.loads(json_path.read_text(encoding="utf-8"))


TOKEN_RE = re.compile(r"[A-Za-z0-9']+")


def normalize_token(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"^[^a-z0-9']+|[^a-z0-9']+$", "", text)
    return text


def context_tokens(text: str, *, from_right: bool, max_tokens: int = 5) -> list[str]:
    tokens = [normalize_token(match.group(0)) for match in TOKEN_RE.finditer(text)]
    tokens = [token for token in tokens if token]
    return tokens[-max_tokens:] if from_right else tokens[:max_tokens]


def whisper_words(payload: dict[str, Any], window_start: float) -> list[Word]:
    words: list[Word] = []
    for segment in payload.get("segments", []):
        for word in segment.get("words", []) or []:
            text = str(word.get("word", "")).strip()
            if not text:
                continue
            words.append(
                Word(
                    text=text,
                    start=window_start + float(word.get("start", segment.get("start", 0.0))),
                    end=window_start + float(word.get("end", segment.get("end", 0.0))),
                )
            )
    if words:
        return words
    text = str(payload.get("text", "")).strip()
    if not text:
        return []
    tokens = text.split()
    return [Word(token, window_start, window_start) for token in tokens]


def word_tokens(words: list[Word]) -> list[str]:
    return [normalize_token(word.text) for word in words]


def find_subsequence(tokens: list[str], needle: list[str], *, start: int = 0, end: int | None = None) -> list[int]:
    if not needle:
        return []
    if end is None:
        end = len(tokens)
    matches = []
    last = end - len(needle)
    for index in range(start, last + 1):
        if tokens[index:index + len(needle)] == needle:
            matches.append(index)
    return matches


def choose_replacement(marker: Marker, words: list[Word], stt_text: str) -> tuple[str, float, str, str]:
    tokens = word_tokens(words)
    before_all = context_tokens(marker.youtube_before, from_right=True)
    after_all = context_tokens(marker.youtube_after, from_right=False)
    if not words or not tokens:
        return "", 0.0, "skipped", "empty STT output"

    best: tuple[float, str, int, int, str] | None = None
    for before_len in range(min(5, len(before_all)), 0, -1):
        before = before_all[-before_len:]
        before_matches = find_subsequence(tokens, before)
        for before_index in before_matches:
            candidate_start = before_index + before_len
            for after_len in range(min(5, len(after_all)), 0, -1):
                after = after_all[:after_len]
                after_matches = find_subsequence(tokens, after, start=candidate_start)
                for after_index in after_matches:
                    candidate_end = after_index
                    candidate_words = words[candidate_start:candidate_end]
                    if not candidate_words or len(candidate_words) > 6:
                        continue
                    midpoint = (candidate_words[0].start + candidate_words[-1].end) / 2
                    distance = abs(midpoint - marker.start_seconds)
                    if distance > 6:
                        continue
                    replacement = clean_replacement(" ".join(word.text for word in candidate_words))
                    if not replacement:
                        continue
                    score = before_len + after_len - (distance / 10)
                    reason = f"matched {before_len} before token(s), {after_len} after token(s), {distance:.1f}s from cue"
                    if best is None or score > best[0]:
                        best = (score, replacement, candidate_start, candidate_end, reason)

    if best is not None:
        score, replacement, start, end, reason = best
        confidence = max(0.0, min(1.0, score / 10.0))
        return replacement, confidence, "proposed", reason

    # Conservative fallback: keep a record but do not auto-apply.
    nearby = [
        word for word in words
        if marker.start_seconds - 1.0 <= word.start <= marker.end_seconds + 1.0
    ]
    nearby_text = clean_replacement(" ".join(word.text for word in nearby))
    if nearby_text:
        return nearby_text, 0.25, "review", "nearby words only; context alignment failed"
    return "", 0.0, "skipped", "context alignment failed"


def clean_replacement(text: str) -> str:
    text = re.sub(r"\s+", " ", text.strip())
    text = text.strip(" ,.;:!?\"“”")
    if text == "" or text == MARKER:
        return ""
    if re.search(r"\[[^\]]*\]", text):
        return ""
    return text


def stt_text(payload: dict[str, Any]) -> str:
    text = str(payload.get("text", "")).strip()
    if text:
        return re.sub(r"\s+", " ", text)
    parts = [str(segment.get("text", "")).strip() for segment in payload.get("segments", [])]
    return re.sub(r"\s+", " ", " ".join(part for part in parts if part)).strip()


def stt_excerpt(words: list[Word], marker: Marker, text: str) -> str:
    nearby = [
        word.text for word in words
        if marker.start_seconds - 6 <= word.start <= marker.end_seconds + 6
    ]
    excerpt = " ".join(nearby).strip()
    return excerpt if excerpt else text[:500]


def create_run(conn: sqlite3.Connection, video_id: str, args: argparse.Namespace) -> int:
    cursor = conn.execute(
        """
        INSERT INTO stt_patch_runs (
            created_at, video_id, model, pad_seconds, merge_gap_seconds, apply_mode, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            datetime.now(timezone.utc).isoformat(),
            video_id,
            args.model,
            args.pad_seconds,
            args.merge_gap_seconds,
            1 if args.apply else 0,
            "running",
        ),
    )
    conn.commit()
    return int(cursor.lastrowid)


def insert_marker(conn: sqlite3.Connection, run_id: int, video_id: str, marker: Marker, payload: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO stt_patch_markers (
            run_id, video_id, marker_index, marker_char_start, marker_char_end,
            marker_start_seconds, marker_end_seconds, window_index,
            window_start_seconds, window_end_seconds, youtube_before, youtube_after,
            youtube_excerpt, stt_text, stt_excerpt, candidate_text, replacement_text,
            status, confidence, reason, applied, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            video_id,
            marker.index,
            marker.char_start,
            marker.char_end,
            marker.start_seconds,
            marker.end_seconds,
            marker.window_index,
            marker.window_start,
            marker.window_end,
            marker.youtube_before[-500:],
            marker.youtube_after[:500],
            marker.youtube_excerpt,
            payload["stt_text"],
            payload["stt_excerpt"],
            payload["candidate_text"],
            payload["replacement_text"],
            payload["status"],
            payload["confidence"],
            payload["reason"],
            1 if payload["applied"] else 0,
            datetime.now(timezone.utc).isoformat(),
        ),
    )


def apply_replacements(
    conn: sqlite3.Connection,
    video_id: str,
    transcript: str,
    segments: list[Segment],
    replacements: list[tuple[Marker, str]],
) -> str:
    replacements = sorted(replacements, key=lambda item: item[0].char_start)
    parts = []
    cursor = 0
    for marker, replacement in replacements:
        parts.append(transcript[cursor:marker.char_start])
        parts.append(replacement)
        cursor = marker.char_end
    parts.append(transcript[cursor:])
    new_transcript = "".join(parts)

    shifted_segments = []
    cumulative = 0
    replacement_index = 0
    for segment in segments:
        while replacement_index < len(replacements) and segment.char_index > replacements[replacement_index][0].char_end:
            marker, replacement = replacements[replacement_index]
            cumulative += len(replacement) - (marker.char_end - marker.char_start)
            replacement_index += 1
        shifted_segments.append((segment.start_seconds, segment.char_index + cumulative))

    conn.execute(
        "UPDATE videos SET transcript = ?, imported_at = ? WHERE youtube_id = ?",
        (new_transcript, datetime.now(timezone.utc).isoformat(), video_id),
    )
    conn.execute("DELETE FROM segments WHERE video_id = ?", (video_id,))
    conn.executemany(
        "INSERT INTO segments (video_id, start_seconds, char_index) VALUES (?, ?, ?)",
        [(video_id, start, index) for start, index in shifted_segments],
    )
    conn.execute("DELETE FROM videos_fts WHERE youtube_id = ?", (video_id,))
    conn.execute(
        """
        INSERT INTO videos_fts (youtube_id, channel, title, transcript)
        SELECT v.youtube_id, c.name, v.title, v.transcript
        FROM videos v
        JOIN channels c ON c.id = v.channel_id
        WHERE v.youtube_id = ?
        """,
        (video_id,),
    )
    return new_transcript


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch YouTube '[ __ ]' caption censor markers using local STT on tiny audio windows.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--apply", action="store_true", help="Apply high-confidence replacements to videos.transcript and videos_fts.")
    parser.add_argument("--apply-threshold", type=float, default=0.55)
    parser.add_argument("--pad-seconds", type=float, default=2.0)
    parser.add_argument("--merge-gap-seconds", type=float, default=15.0)
    parser.add_argument("--context-chars", type=int, default=220)
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--model-dir", type=Path, default=Path.home() / ".cache" / "whisper")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--cookies-from-browser", default="chrome")
    parser.add_argument("--whisper-bin", type=Path, default=WHISPER)
    parser.add_argument("--limit-windows", type=int, help="Process only the first N merged windows for a quick smoke test.")
    parser.add_argument("--keep-workdir", action="store_true", help="Keep non-audio JSON/report files. Audio is always deleted.")
    args = parser.parse_args()

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 60000")
    conn.execute("PRAGMA journal_mode = WAL")
    ensure_tables(conn)
    conn.commit()

    video = fetch_video(conn, args.video_id)
    segments = fetch_segments(conn, args.video_id)
    if not segments:
        raise SystemExit("Video has no segment anchors")
    markers = find_markers(video["transcript"], segments, args.context_chars)
    if not markers:
        raise SystemExit("Video has no [ __ ] markers")
    windows = build_windows(markers, video_duration(segments), args.pad_seconds, args.merge_gap_seconds)
    if args.limit_windows:
        keep_window_indexes = set(range(args.limit_windows))
        windows = [window for index, window in enumerate(windows) if index in keep_window_indexes]
        markers = [marker for marker in markers if marker.window_index in keep_window_indexes]

    run_id = create_run(conn, args.video_id, args)
    run_dir = RUNS / f"stt-patch-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{args.video_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    replacements: list[tuple[Marker, str]] = []
    audio_seconds = 0.0
    processed_markers = 0
    applied_count = 0
    status = "success"
    error = ""

    try:
        audio_url = get_audio_url(args.video_id, args)
        with tempfile.TemporaryDirectory(prefix="yt-stt-patch-") as temp_name:
            temp_dir = Path(temp_name)
            for window_index, (start, end, window_markers) in enumerate(windows):
                wav_path = temp_dir / f"window_{window_index:04d}_{int(start)}-{int(end)}.wav"
                out_dir = run_dir / f"window_{window_index:04d}"
                out_dir.mkdir(parents=True, exist_ok=True)
                try:
                    cut_audio(audio_url, start, end, wav_path)
                    audio_seconds += max(0.0, end - start)
                    payload = transcribe_window(wav_path, out_dir, args)
                finally:
                    if wav_path.exists():
                        wav_path.unlink()
                text = stt_text(payload)
                words = whisper_words(payload, start)
                for marker in window_markers:
                    candidate, confidence, marker_status, reason = choose_replacement(marker, words, text)
                    apply_marker = bool(args.apply and marker_status == "proposed" and confidence >= args.apply_threshold)
                    replacement_text = candidate if apply_marker else ""
                    if apply_marker:
                        replacements.append((marker, replacement_text))
                        applied_count += 1
                    insert_marker(
                        conn,
                        run_id,
                        args.video_id,
                        marker,
                        {
                            "stt_text": text,
                            "stt_excerpt": stt_excerpt(words, marker, text),
                            "candidate_text": candidate,
                            "replacement_text": replacement_text,
                            "status": "applied" if apply_marker else marker_status,
                            "confidence": confidence,
                            "reason": reason,
                            "applied": apply_marker,
                        },
                    )
                    processed_markers += 1
                conn.commit()
        if replacements:
            apply_replacements(conn, args.video_id, video["transcript"], segments, replacements)
    except Exception as exc:
        status = "error"
        error = str(exc)
        raise
    finally:
        conn.execute(
            """
            UPDATE stt_patch_runs
            SET status = ?, windows = ?, markers = ?, applied = ?, audio_seconds = ?, error = ?
            WHERE id = ?
            """,
            (status, len(windows), processed_markers, applied_count, audio_seconds, error[:1000], run_id),
        )
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()
        if not args.keep_workdir and status == "error":
            shutil.rmtree(run_dir, ignore_errors=True)

    summary = {
        "run_id": run_id,
        "video_id": args.video_id,
        "channel": video["channel"],
        "title": video["title"],
        "windows": len(windows),
        "markers": processed_markers,
        "applied": applied_count,
        "audio_seconds": round(audio_seconds, 3),
        "apply": args.apply,
        "run_dir": str(run_dir),
    }
    report_path = run_dir / "summary.json"
    report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
