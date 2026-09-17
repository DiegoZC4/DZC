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
DEFAULT_MLX_MODEL = "mlx-community/whisper-large-v3-mlx"


@dataclass
class Segment:
    start_seconds: int
    char_index: int


@dataclass
class Cue:
    index: int
    start_seconds: float
    end_seconds: float
    char_start: int
    char_end: int
    text: str


@dataclass
class Marker:
    index: int
    char_start: int
    char_end: int
    start_seconds: float
    end_seconds: float
    cue_index: int = 0
    cue_char_start: int = 0
    cue_char_end: int = 0
    cue_text: str = ""
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
        CREATE TABLE IF NOT EXISTS uncensored (
            video_id TEXT NOT NULL,
            start_char INTEGER NOT NULL,
            end_char INTEGER NOT NULL,
            replacement TEXT NOT NULL,
            PRIMARY KEY (video_id, start_char, end_char, replacement),
            FOREIGN KEY(video_id) REFERENCES videos(youtube_id) ON DELETE CASCADE
        )
        """
    )


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


def build_cues(transcript: str, segments: list[Segment]) -> list[Cue]:
    cues: list[Cue] = []
    for index, segment in enumerate(segments):
        char_end = segments[index + 1].char_index if index + 1 < len(segments) else len(transcript)
        end_seconds = float(segments[index + 1].start_seconds) if index + 1 < len(segments) else float(segment.start_seconds + 8)
        cues.append(
            Cue(
                index=index,
                start_seconds=float(segment.start_seconds),
                end_seconds=max(float(segment.start_seconds) + 0.5, end_seconds),
                char_start=segment.char_index,
                char_end=max(segment.char_index, char_end),
                text=transcript[segment.char_index:char_end],
            )
        )
    return cues


def find_markers(transcript: str, segments: list[Segment], context_chars: int) -> list[Marker]:
    return find_markers_by_cue(transcript, segments)


def find_markers_by_cue(transcript: str, segments: list[Segment]) -> list[Marker]:
    markers = []
    for cue in build_cues(transcript, segments):
        pos = 0
        while True:
            offset = cue.text.find(MARKER, pos)
            if offset < 0:
                break
            char_start = cue.char_start + offset
            previous_marker = cue.text.rfind(MARKER, 0, offset)
            before_start = previous_marker + len(MARKER) if previous_marker >= 0 else 0
            next_marker = cue.text.find(MARKER, offset + len(MARKER))
            after_end = next_marker if next_marker >= 0 else len(cue.text)
            markers.append(
                Marker(
                    index=len(markers),
                    char_start=char_start,
                    char_end=char_start + len(MARKER),
                    start_seconds=cue.start_seconds,
                    end_seconds=cue.end_seconds,
                    cue_index=cue.index,
                    cue_char_start=cue.char_start,
                    cue_char_end=cue.char_end,
                    cue_text=cue.text,
                    youtube_before=cue.text[before_start:offset],
                    youtube_after=cue.text[offset + len(MARKER):after_end],
                    youtube_excerpt=cue.text,
                )
            )
            pos = offset + len(MARKER)
    return markers


def build_windows(markers: list[Marker], duration: float, pad: float, merge_gap: float) -> list[tuple[float, float, list[Marker]]]:
    by_cue: dict[int, list[Marker]] = {}
    for marker in markers:
        by_cue.setdefault(marker.cue_index, []).append(marker)
    raw_windows: list[list[Any]] = []
    for cue_index in sorted(by_cue):
        window_markers = by_cue[cue_index]
        cue_start = min(marker.start_seconds for marker in window_markers)
        cue_end = max(marker.end_seconds for marker in window_markers)
        start = max(0.0, cue_start - pad)
        end = min(duration, max(cue_end, cue_start + 0.5) + pad)
        raw_windows.append([float(start), float(end), sorted(window_markers, key=lambda marker: marker.char_start)])

    windows: list[list[Any]] = []
    for start, end, window_markers in raw_windows:
        if windows and float(start) <= float(windows[-1][1]) + merge_gap:
            windows[-1][1] = max(float(windows[-1][1]), float(end))
            windows[-1][2].extend(window_markers)
            windows[-1][2].sort(key=lambda marker: marker.char_start)
        else:
            windows.append([float(start), float(end), window_markers])

    out: list[tuple[float, float, list[Marker]]] = []
    for index, (start, end, window_markers) in enumerate(windows):
        for marker in window_markers:
            marker.window_index = index
            marker.window_start = float(start)
            marker.window_end = float(end)
        out.append((float(start), float(end), window_markers))
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
        "--js-runtimes",
        "node",
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
    if args.backend == "mlx":
        return transcribe_window_mlx(wav_path, out_dir, args)
    return transcribe_window_openai(wav_path, out_dir, args)


def transcribe_window_openai(wav_path: Path, out_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
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
        str(args.word_timestamps),
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


def transcribe_window_mlx(wav_path: Path, out_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    try:
        import mlx_whisper
    except ImportError as exc:
        raise RuntimeError(
            "mlx-whisper is not importable. Run this backend with "
            f"{WHISPER.parent / 'python'} refresh/stt_patch_censored.py --backend mlx ..."
        ) from exc

    result = mlx_whisper.transcribe(
        str(wav_path),
        path_or_hf_repo=args.mlx_model,
        language="en",
        word_timestamps=args.word_timestamps,
        condition_on_previous_text=False,
        verbose=False,
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / (wav_path.stem + ".json")
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


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


def words_inside_cue(marker: Marker, words: list[Word], args: argparse.Namespace) -> list[Word]:
    if not args.word_timestamps:
        return words
    start = marker.start_seconds - args.cue_time_tolerance
    end = marker.end_seconds + args.cue_time_tolerance
    bounded = []
    for word in words:
        word_start = min(word.start, word.end)
        word_end = max(word.start, word.end)
        if word_start == word_end:
            midpoint = word_start
            if start <= midpoint <= end:
                bounded.append(word)
        elif word_end >= start and word_start <= end:
            bounded.append(word)
    return bounded


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


def choose_replacement(marker: Marker, words: list[Word], stt_text: str, args: argparse.Namespace) -> tuple[str, float, str, str]:
    words = words_inside_cue(marker, words, args)
    tokens = word_tokens(words)
    before_all = context_tokens(marker.youtube_before, from_right=True, max_tokens=args.context_tokens)
    after_all = context_tokens(marker.youtube_after, from_right=False, max_tokens=args.context_tokens)
    if not words or not tokens:
        if args.word_timestamps:
            return "", 0.0, "skipped", "no STT words inside cue time bounds"
        return "", 0.0, "skipped", "empty STT output"

    best: tuple[float, str, int, int, str] | None = None
    for before_len in range(min(args.context_tokens, len(before_all)), -1, -1):
        before = before_all[-before_len:]
        before_matches = find_subsequence(tokens, before) if before_len else [0]
        for before_index in before_matches:
            candidate_start = before_index + before_len
            max_after_len = min(args.context_tokens, len(after_all))
            after_lengths = range(max_after_len, -1, -1) if max_after_len else [0]
            for after_len in after_lengths:
                if before_len == 0 and after_len == 0:
                    continue
                after = after_all[:after_len]
                after_matches = find_subsequence(tokens, after, start=candidate_start) if after_len else [
                    min(len(tokens), candidate_start + args.max_replacement_tokens)
                ]
                for after_index in after_matches:
                    candidate_end = after_index
                    candidate_words = words[candidate_start:candidate_end]
                    if not candidate_words:
                        continue
                    if len(candidate_words) > args.max_replacement_tokens:
                        continue
                    replacement = clean_replacement(" ".join(word.text for word in candidate_words))
                    if not replacement or len(replacement) > args.max_replacement_chars:
                        continue
                    has_left_boundary = before_len > 0
                    has_right_boundary = after_len > 0
                    if not (has_left_boundary and has_right_boundary) and len(candidate_words) > 1:
                        continue
                    score = before_len + after_len - (0.15 * max(0, len(candidate_words) - 1))
                    if not (has_left_boundary and has_right_boundary):
                        score = min(score, args.context_tokens)
                    reason = f"cue/time bounded; matched {before_len} before token(s), {after_len} after token(s)"
                    if best is None or score > best[0]:
                        best = (score, replacement, candidate_start, candidate_end, reason)

    if best is not None:
        score, replacement, start, end, reason = best
        available_context = min(args.context_tokens, len(before_all)) + min(args.context_tokens, len(after_all))
        confidence = max(0.0, min(1.0, score / max(1, available_context)))
        return replacement, confidence, "proposed", reason

    cue_text = clean_replacement(stt_text)
    reason = "cue alignment failed"
    if cue_text:
        reason += f"; STT cue was {len(cue_text)} chars"
    return "", 0.0, "skipped", reason


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
    return 0


def model_label(args: argparse.Namespace) -> str:
    model_name = args.mlx_model if args.backend == "mlx" else args.model
    return f"{args.backend}:{model_name}"


def insert_marker(conn: sqlite3.Connection, run_id: int, video_id: str, marker: Marker, payload: dict[str, Any]) -> bool:
    candidate = str(payload.get("candidate_text", "")).strip()
    if not candidate:
        return False
    before = conn.total_changes
    conn.execute(
        """
        INSERT OR IGNORE INTO uncensored (video_id, start_char, end_char, replacement)
        VALUES (?, ?, ?, ?)
        """,
        (
            video_id,
            marker.char_start,
            marker.char_end,
            candidate,
        ),
    )
    return conn.total_changes > before


def clear_existing_candidates(conn: sqlite3.Connection, video_id: str, markers: list[Marker]) -> None:
    conn.executemany(
        "DELETE FROM uncensored WHERE video_id = ? AND start_char = ? AND end_char = ?",
        [(video_id, marker.char_start, marker.char_end) for marker in markers],
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


def restore_run(conn: sqlite3.Connection, run_id: int, *, delete_run: bool = False) -> dict[str, Any]:
    run = conn.execute(
        "SELECT video_id, status FROM stt_patch_runs WHERE id = ?",
        (run_id,),
    ).fetchone()
    if not run:
        raise SystemExit(f"Run not found: {run_id}")
    video_id = str(run[0])
    video = fetch_video(conn, video_id)
    segments = fetch_segments(conn, video_id)
    rows = conn.execute(
        """
        SELECT marker_char_start, marker_char_end, replacement_text
        FROM stt_patch_markers
        WHERE run_id = ? AND applied = 1 AND replacement_text <> ''
        ORDER BY marker_char_start
        """,
        (run_id,),
    ).fetchall()
    transcript = str(video["transcript"])
    positions: list[tuple[int, int, str]] = []
    current_delta = 0
    for original_start, original_end, replacement in rows:
        replacement = str(replacement)
        current_start = int(original_start) + current_delta
        current_end = current_start + len(replacement)
        actual = transcript[current_start:current_end]
        if actual != replacement:
            raise RuntimeError(
                f"Cannot safely restore run {run_id}: expected {replacement!r} at current offset "
                f"{current_start}, found {actual!r}"
            )
        positions.append((current_start, current_end, replacement))
        current_delta += len(replacement) - (int(original_end) - int(original_start))

    if positions:
        parts = []
        cursor = 0
        for current_start, current_end, replacement in positions:
            parts.append(transcript[cursor:current_start])
            parts.append(MARKER)
            cursor = current_end
        parts.append(transcript[cursor:])
        restored_transcript = "".join(parts)

        shifted_segments = []
        restore_delta = 0
        position_index = 0
        for segment in segments:
            while position_index < len(positions) and segment.char_index > positions[position_index][1]:
                replacement = positions[position_index][2]
                restore_delta += len(MARKER) - len(replacement)
                position_index += 1
            shifted_segments.append((segment.start_seconds, segment.char_index + restore_delta))

        conn.execute(
            "UPDATE videos SET transcript = ?, imported_at = ? WHERE youtube_id = ?",
            (restored_transcript, datetime.now(timezone.utc).isoformat(), video_id),
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

    if delete_run:
        conn.execute("DELETE FROM stt_patch_runs WHERE id = ?", (run_id,))
    conn.commit()
    return {
        "run_id": run_id,
        "video_id": video_id,
        "restored_replacements": len(positions),
        "deleted_run": delete_run,
    }


def censored_video_ids(conn: sqlite3.Connection, args: argparse.Namespace) -> list[str]:
    sql = "SELECT v.youtube_id FROM videos v WHERE instr(v.transcript, ?) > 0"
    params: list[Any] = [MARKER]
    if args.start_after:
        sql += " AND v.youtube_id > ?"
        params.append(args.start_after)
    if args.skip_successful:
        sql += """
            AND NOT EXISTS (
                SELECT 1
                FROM uncensored u
                WHERE u.video_id = v.youtube_id
            )
        """
    sql += " ORDER BY v.youtube_id"
    if args.limit_videos:
        sql += " LIMIT ?"
        params.append(args.limit_videos)
    return [str(row[0]) for row in conn.execute(sql, params).fetchall()]


def process_video(conn: sqlite3.Connection, video_id: str, args: argparse.Namespace) -> dict[str, Any]:
    video = fetch_video(conn, video_id)
    segments = fetch_segments(conn, video_id)
    if not segments:
        raise RuntimeError("Video has no segment anchors")
    markers = find_markers(video["transcript"], segments, args.context_chars)
    if not markers:
        raise RuntimeError("Video has no [ __ ] markers")
    windows = build_windows(markers, video_duration(segments), args.pad_seconds, args.merge_gap_seconds)
    if args.limit_windows:
        keep_window_indexes = set(range(args.limit_windows))
        windows = [window for index, window in enumerate(windows) if index in keep_window_indexes]
        markers = [marker for marker in markers if marker.window_index in keep_window_indexes]

    run_id = create_run(conn, video_id, args)
    if not args.keep_existing_candidates:
        clear_existing_candidates(conn, video_id, markers)
        conn.commit()
    run_dir = RUNS / f"stt-patch-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{video_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    audio_seconds = 0.0
    processed_markers = 0
    stored_count = 0
    status = "success"
    error = ""

    try:
        audio_url = get_audio_url(video_id, args)
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
                    candidate, confidence, marker_status, reason = choose_replacement(marker, words, text, args)
                    stored = insert_marker(
                        conn,
                        run_id,
                        video_id,
                        marker,
                        {
                            "stt_text": text,
                            "stt_excerpt": stt_excerpt(words, marker, text),
                            "candidate_text": candidate,
                            "replacement_text": candidate,
                            "status": marker_status,
                            "confidence": confidence,
                            "reason": reason,
                            "applied": False,
                        },
                    )
                    if stored:
                        stored_count += 1
                    processed_markers += 1
                conn.commit()
    except Exception as exc:
        status = "error"
        error = str(exc)
        if not args.all_censored:
            raise
    finally:
        conn.commit()

    summary = {
        "run_id": run_id,
        "video_id": video_id,
        "channel": video["channel"],
        "title": video["title"],
        "status": status,
        "windows": len(windows),
        "markers": processed_markers,
        "stored": stored_count,
        "applied": 0,
        "audio_seconds": round(audio_seconds, 3),
        "apply": False,
        "run_dir": str(run_dir),
    }
    if error:
        summary["error"] = error
    report_path = run_dir / "summary.json"
    report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    if not args.keep_workdir:
        shutil.rmtree(run_dir, ignore_errors=True)
    print(json.dumps(summary, indent=2))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch YouTube '[ __ ]' caption censor markers using local STT on cue-bounded audio windows.")
    parser.add_argument("--video-id")
    parser.add_argument("--all-censored", action="store_true", help="Process every video whose current transcript still contains a censor marker.")
    parser.add_argument("--limit-videos", type=int, default=0, help="Limit --all-censored to the first N videos.")
    parser.add_argument("--start-after", default="", help="Resume --all-censored after this YouTube video id.")
    parser.add_argument("--skip-successful", action="store_true", help="Skip videos that already have rows in uncensored.")
    parser.add_argument("--restore-run-id", type=int, action="append", default=[], help="Legacy: restore applied markers from old stt_patch tables, when those tables still exist.")
    parser.add_argument("--delete-restored-run", action="store_true", help="Delete restored audit runs after reversing their applied replacements.")
    parser.add_argument("--apply", action="store_true", help="Ignored. This script now only stages candidates in uncensored.")
    parser.add_argument("--apply-threshold", type=float, default=0.55)
    parser.add_argument("--pad-seconds", type=float, default=5.0)
    parser.add_argument("--merge-gap-seconds", type=float, default=0.0, help="Merge padded cue windows separated by at most this many seconds.")
    parser.add_argument("--context-chars", type=int, default=220)
    parser.add_argument("--context-tokens", type=int, default=4)
    parser.add_argument("--cue-time-tolerance", type=float, default=0.25, help="Seconds of tolerance around the original cue bounds when filtering word timestamps.")
    parser.add_argument("--max-replacement-chars", type=int, default=20)
    parser.add_argument(
        "--max-replacement-tokens",
        type=int,
        default=1,
        help="Stage only short censored spans by default; raise this for phrase-level review.",
    )
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--backend", choices=["openai", "mlx"], default="mlx")
    parser.add_argument("--mlx-model", default=DEFAULT_MLX_MODEL)
    parser.add_argument("--word-timestamps", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--model-dir", type=Path, default=Path.home() / ".cache" / "whisper")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--cookies-from-browser", default="chrome")
    parser.add_argument("--whisper-bin", type=Path, default=WHISPER)
    parser.add_argument("--limit-windows", type=int, help="Process only the first N merged windows for a quick smoke test.")
    parser.add_argument("--keep-existing-candidates", action="store_true", help="Keep existing uncensored rows for processed markers instead of replacing them.")
    parser.add_argument("--keep-workdir", action="store_true", help="Keep non-audio JSON/report files. Audio is always deleted.")
    args = parser.parse_args()

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 60000")
    conn.execute("PRAGMA journal_mode = WAL")
    ensure_tables(conn)
    conn.commit()

    if args.restore_run_id:
        restored = []
        for run_id in args.restore_run_id:
            restored.append(restore_run(conn, run_id, delete_run=args.delete_restored_run))
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()
        print(json.dumps({"restored": restored}, indent=2))
        return 0

    if args.all_censored:
        video_ids = censored_video_ids(conn, args)
        print(json.dumps({"mode": "all_censored", "videos": len(video_ids), "model": model_label(args)}, indent=2))
    elif args.video_id:
        video_ids = [args.video_id]
    else:
        raise SystemExit("--video-id or --all-censored is required unless --restore-run-id is used")

    summaries = []
    try:
        for video_id in video_ids:
            try:
                summaries.append(process_video(conn, video_id, args))
            except Exception as exc:
                if not args.all_censored:
                    raise
                summary = {
                    "video_id": video_id,
                    "status": "error",
                    "windows": 0,
                    "markers": 0,
                    "stored": 0,
                    "applied": 0,
                    "audio_seconds": 0.0,
                    "error": str(exc),
                }
                summaries.append(summary)
                print(json.dumps(summary, indent=2))
    finally:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()

    if args.all_censored:
        print(json.dumps({
            "mode": "all_censored",
            "videos": len(summaries),
            "success": sum(1 for item in summaries if item["status"] == "success"),
            "errors": sum(1 for item in summaries if item["status"] == "error"),
            "markers": sum(int(item["markers"]) for item in summaries),
            "stored": sum(int(item.get("stored", 0)) for item in summaries),
            "applied": sum(int(item["applied"]) for item in summaries),
            "audio_seconds": round(sum(float(item["audio_seconds"]) for item in summaries), 3),
        }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
