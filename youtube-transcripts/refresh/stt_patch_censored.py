#!/usr/bin/env python3
"""Stage candidate replacements for YouTube caption censor markers.

The script finds ``[ __ ]`` markers in stored transcripts, cuts only the cue
audio containing those markers, runs local STT, and writes proposed replacements
to the ``decensor_candidates(video_id, start_char, replacement)`` table.
Replacements are not applied to ``videos`` or FTS tables here.

Policy: stage a candidate when it has two-sided transcript context alignment,
or when it is one allowlisted censored word with enough one-sided context.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


APP_ROOT = Path("/Users/diego/Desktop/Read/YouTube Channel Transcripts")
DB = APP_ROOT / "data" / "transcripts.sqlite3"
DATA = APP_ROOT / "data"
STT_METRICS = DATA / "stt-patch-metrics.json"
RUNS = APP_ROOT / "refresh" / "runs"
WHISPER = APP_ROOT / "Whisper" / ".venv" / "bin" / "whisper"
ALLOWLIST = APP_ROOT / "refresh" / "decensor_allowlist.txt"
YTDLP = Path("/opt/homebrew/bin/yt-dlp")
FFMPEG = Path("ffmpeg")
MARKER = "[ __ ]"
MARKER_LEN = len(MARKER)
DEFAULT_MLX_MODEL = "mlx-community/whisper-large-v3-mlx"
END_PADDING_SECONDS = 8.0
EXCERPT_CONTEXT_SECONDS = 6.0
LENGTH_PENALTY_PER_TOKEN = 0.15
ONE_SIDED_SCORE_PENALTY = 0.5
DEFAULT_DOWNLOAD_AUDIO_MIN_WINDOWS = 4
STT_METRICS_VERSION = 1
MAX_STT_METRIC_RECORDS = 500


class SttPatchError(RuntimeError):
    """Expected script-level error that should print cleanly from main()."""


class VideoNotFound(SttPatchError):
    pass


class AudioSourceError(SttPatchError):
    pass


class TranscriptDataError(SttPatchError):
    pass


class WhisperError(SttPatchError):
    pass


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
    youtube_before: str = ""
    youtube_after: str = ""


@dataclass
class Word:
    text: str
    start: float
    end: float


def run(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    capture_stdout: bool = False,
    stderr_path: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    print("$ " + summarize_cmd(cmd), file=sys.stderr)
    if stderr_path is not None:
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        with stderr_path.open("w", encoding="utf-8") as stderr_file:
            return subprocess.run(
                cmd,
                cwd=cwd,
                text=True,
                stdout=subprocess.PIPE if capture_stdout else None,
                stderr=stderr_file,
                check=False,
            )
    return subprocess.run(cmd, cwd=cwd, text=True, stdout=subprocess.PIPE if capture_stdout else None, stderr=None, check=False)


def run_with_retries(
    cmd: list[str],
    *,
    label: str,
    cwd: Path | None = None,
    attempts: int = 3,
    capture_stdout: bool = False,
) -> subprocess.CompletedProcess[str]:
    last: subprocess.CompletedProcess[str] | None = None
    for attempt in range(1, attempts + 1):
        last = run(cmd, cwd=cwd, capture_stdout=capture_stdout)
        if last.returncode == 0:
            return last
        if attempt < attempts:
            delay = min(8.0, 1.5 * attempt)
            print(f"{label} failed on attempt {attempt}/{attempts}; retrying in {delay:.1f}s", file=sys.stderr)
            time.sleep(delay)
    assert last is not None
    output = str(last.stdout or "").strip()
    raise SttPatchError(output or f"{label} failed after {attempts} attempts with exit code {last.returncode}")


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


def tail_text(path: Path, lines: int = 50) -> str:
    if not path.exists():
        return ""
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(content[-lines:]).strip()


def ensure_tables(conn: sqlite3.Connection) -> None:
    old_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'uncensored'"
    ).fetchone() is not None
    new_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'decensor_candidates'"
    ).fetchone() is not None
    if old_exists and not new_exists:
        columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(uncensored)").fetchall()}
        if "end_char" not in columns:
            conn.execute("ALTER TABLE uncensored RENAME TO decensor_candidates")
        else:
            conn.execute("ALTER TABLE uncensored RENAME TO uncensored_with_end_char")
            conn.execute(
                """
                CREATE TABLE decensor_candidates (
                    video_id TEXT NOT NULL,
                    start_char INTEGER NOT NULL,
                    replacement TEXT NOT NULL,
                    confidence REAL NOT NULL DEFAULT 0.0,
                    PRIMARY KEY (video_id, start_char, replacement),
                    FOREIGN KEY(video_id) REFERENCES videos(youtube_id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO decensor_candidates (video_id, start_char, replacement, confidence)
                SELECT video_id, start_char, replacement, 0.0
                FROM uncensored_with_end_char
                """
            )
            conn.execute("DROP TABLE uncensored_with_end_char")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS decensor_candidates (
            video_id TEXT NOT NULL,
            start_char INTEGER NOT NULL,
            replacement TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0.0,
            PRIMARY KEY (video_id, start_char, replacement),
            FOREIGN KEY(video_id) REFERENCES videos(youtube_id) ON DELETE CASCADE
        )
        """
    )
    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(decensor_candidates)").fetchall()}
    if "confidence" not in columns:
        conn.execute("ALTER TABLE decensor_candidates ADD COLUMN confidence REAL NOT NULL DEFAULT 0.0")
    if old_exists and new_exists:
        conn.execute(
            """
            INSERT OR IGNORE INTO decensor_candidates (video_id, start_char, replacement, confidence)
            SELECT video_id, start_char, replacement, 0.0
            FROM uncensored
            """
        )
        conn.execute("DROP TABLE uncensored")


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
        raise VideoNotFound(f"Video not found: {video_id}")
    return {"youtube_id": row[0], "title": row[1], "transcript": row[2], "channel": row[3]}


def fetch_segments(conn: sqlite3.Connection, video_id: str) -> list[Segment]:
    rows = conn.execute(
        "SELECT start_seconds, char_index FROM segments WHERE video_id = ? ORDER BY char_index",
        (video_id,),
    ).fetchall()
    return [Segment(int(row[0]), int(row[1])) for row in rows]


def build_cues(transcript: str, segments: list[Segment]) -> list[Cue]:
    cues: list[Cue] = []
    for index, segment in enumerate(segments):
        char_end = segments[index + 1].char_index if index + 1 < len(segments) else len(transcript)
        end_seconds = float(segments[index + 1].start_seconds) if index + 1 < len(segments) else float(segment.start_seconds + END_PADDING_SECONDS)
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
            before_start = previous_marker + MARKER_LEN if previous_marker >= 0 else 0
            next_marker = cue.text.find(MARKER, offset + MARKER_LEN)
            after_end = next_marker if next_marker >= 0 else len(cue.text)
            markers.append(
                Marker(
                    index=len(markers),
                    char_start=char_start,
                    char_end=char_start + MARKER_LEN,
                    start_seconds=cue.start_seconds,
                    end_seconds=cue.end_seconds,
                    cue_index=cue.index,
                    youtube_before=cue.text[before_start:offset],
                    youtube_after=cue.text[offset + MARKER_LEN:after_end],
                )
            )
            pos = offset + MARKER_LEN
    return markers


def build_windows(
    markers: list[Marker],
    duration: float,
    pad: float,
    merge_gap: float,
    merge_overlapping: bool,
    max_chunk_seconds: float,
) -> list[tuple[float, float, list[Marker]]]:
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
        can_merge = False
        if merge_overlapping and windows and float(start) <= float(windows[-1][1]) + merge_gap:
            merged_start = float(windows[-1][0])
            merged_end = max(float(windows[-1][1]), float(end))
            can_merge = max_chunk_seconds <= 0 or merged_end - merged_start <= max_chunk_seconds
        if can_merge:
            windows[-1][1] = max(float(windows[-1][1]), float(end))
            windows[-1][2].extend(window_markers)
            windows[-1][2].sort(key=lambda marker: marker.char_start)
        else:
            windows.append([float(start), float(end), window_markers])

    return [(float(start), float(end), window_markers) for start, end, window_markers in windows]


def video_duration(segments: list[Segment]) -> float:
    return float(max((segment.start_seconds for segment in segments), default=0) + END_PADDING_SECONDS)


def ytdlp_cookie_args(args: argparse.Namespace) -> list[str]:
    if args.cookies_from_browser == "":
        return []
    return ["--cookies-from-browser", args.cookies_from_browser]


def add_timing(timings: dict[str, float], key: str, started: float) -> None:
    timings[key] = timings.get(key, 0.0) + (time.perf_counter() - started)


def stage_started() -> float:
    return time.perf_counter()


def youtube_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def get_audio_url(video_id: str, args: argparse.Namespace) -> str:
    proc = run_with_retries([
        str(YTDLP),
        *ytdlp_cookie_args(args),
        "--no-playlist",
        "-f",
        "ba",
        "-g",
        youtube_url(video_id),
    ], label="yt-dlp audio URL", capture_stdout=True)
    urls = [line.strip() for line in str(proc.stdout or "").splitlines() if line.strip().startswith("http")]
    if not urls:
        raise AudioSourceError("yt-dlp did not return a direct audio URL")
    return urls[-1]


def download_source_audio(video_id: str, args: argparse.Namespace, temp_dir: Path) -> Path:
    output_template = temp_dir / "source_audio.%(ext)s"
    run_with_retries([
        str(YTDLP),
        *ytdlp_cookie_args(args),
        "--no-playlist",
        "--no-part",
        "--force-overwrites",
        "-f",
        "ba",
        "-o",
        str(output_template),
        youtube_url(video_id),
    ], label="yt-dlp audio download")
    files = [
        path for path in temp_dir.glob("source_audio.*")
        if path.is_file() and not path.name.endswith(".part")
    ]
    if not files:
        raise AudioSourceError("yt-dlp did not write a source audio file")
    return max(files, key=lambda path: path.stat().st_mtime)


def prepare_audio_source(
    video_id: str,
    args: argparse.Namespace,
    temp_dir: Path,
    window_count: int,
    timings: dict[str, float],
) -> tuple[str | Path, str]:
    mode = args.audio_mode
    if mode == "auto":
        mode = "download" if window_count >= args.download_audio_min_windows else "stream"
    started = stage_started()
    if mode == "download":
        source = download_source_audio(video_id, args, temp_dir)
    else:
        source = get_audio_url(video_id, args)
    add_timing(timings, "audio_source_seconds", started)
    return source, mode


def cut_audio(audio_source: str | Path, start: float, end: float, out_path: Path) -> None:
    duration = max(0.5, end - start)
    run_with_retries([
        str(FFMPEG),
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(audio_source),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-y",
        str(out_path),
    ], label="ffmpeg audio cut")


def transcribe_window(wav_path: Path, out_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    if args.backend == "mlx":
        return transcribe_window_mlx(wav_path, out_dir, args)
    return transcribe_window_openai(wav_path, out_dir, args)


def transcribe_window_openai(wav_path: Path, out_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    stderr_path = out_dir / "whisper.stderr.log"
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
    ], stderr_path=stderr_path)
    if proc.returncode != 0:
        stderr_tail = tail_text(stderr_path)
        detail = f"\n\nLast 50 stderr lines from {stderr_path}:\n{stderr_tail}" if stderr_tail else ""
        raise WhisperError(f"Whisper failed with exit code {proc.returncode}.{detail}")
    json_path = out_dir / (wav_path.stem + ".json")
    if not json_path.exists():
        raise WhisperError(f"Whisper did not write {json_path}")
    return json.loads(json_path.read_text(encoding="utf-8"))


def transcribe_window_mlx(wav_path: Path, out_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    try:
        import mlx_whisper
    except ImportError as exc:
        raise WhisperError(
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


def load_censored_word_allowlist(path: Path) -> set[str]:
    words: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        token = re.sub(r"^[^a-z0-9']+|[^a-z0-9']+$", "", line.lower().strip())
        if token:
            words.add(token)
    return words


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


def normalized_replacement_tokens(replacement: str) -> list[str]:
    tokens = [normalize_token(match.group(0)) for match in TOKEN_RE.finditer(replacement)]
    return [token for token in tokens if token]


def replacement_is_known_censored_word(replacement: str, allowlist: set[str]) -> bool:
    tokens = normalized_replacement_tokens(replacement)
    return len(tokens) == 1 and tokens[0] in allowlist


def replacement_allowed_by_policy(
    replacement: str,
    has_left_boundary: bool,
    has_right_boundary: bool,
    allowlist: set[str],
) -> tuple[bool, str]:
    if replacement_is_known_censored_word(replacement, allowlist):
        return True, "known censored word allowlist"
    if has_left_boundary and has_right_boundary:
        return True, "two-sided context alignment"
    return False, "requires known censored word or two-sided context alignment"


def words_inside_cue(marker: Marker, words: list[Word], args: argparse.Namespace) -> list[Word]:
    return words_inside_time_range(
        words,
        marker.start_seconds - args.cue_time_tolerance,
        marker.end_seconds + args.cue_time_tolerance,
        args,
    )


def words_inside_marker_span(markers: list[Marker], words: list[Word], args: argparse.Namespace) -> list[Word]:
    if not markers:
        return []
    return words_inside_time_range(
        words,
        min(marker.start_seconds for marker in markers) - args.cue_time_tolerance,
        max(marker.end_seconds for marker in markers) + args.cue_time_tolerance,
        args,
    )


def words_inside_time_range(words: list[Word], start: float, end: float, args: argparse.Namespace) -> list[Word]:
    if not args.word_timestamps:
        return words
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


def marker_run_separator(text: str) -> bool:
    return TOKEN_RE.search(text) is None


def adjacent_marker_runs(transcript: str, markers: list[Marker]) -> list[list[Marker]]:
    runs: list[list[Marker]] = []
    current: list[Marker] = []
    for marker in sorted(markers, key=lambda item: item.char_start):
        if current and marker_run_separator(transcript[current[-1].char_end:marker.char_start]):
            current.append(marker)
            continue
        if len(current) >= 2:
            runs.append(current)
        current = [marker]
    if len(current) >= 2:
        runs.append(current)
    return runs


def choose_adjacent_run_replacements(
    run_markers: list[Marker],
    transcript: str,
    words: list[Word],
    args: argparse.Namespace,
) -> dict[int, tuple[str, float, str, str]]:
    run_markers = sorted(run_markers, key=lambda marker: marker.char_start)
    if len(run_markers) < 2:
        return {}
    bounded_words = words_inside_marker_span(run_markers, words, args)
    tokens = word_tokens(bounded_words)
    if not bounded_words or not tokens:
        return {}

    first = run_markers[0]
    last = run_markers[-1]
    before_text = transcript[max(0, first.char_start - args.context_chars):first.char_start]
    after_text = transcript[last.char_end:min(len(transcript), last.char_end + args.context_chars)]
    before_all = context_tokens(before_text, from_right=True, max_tokens=args.context_tokens)
    after_all = context_tokens(after_text, from_right=False, max_tokens=args.context_tokens)
    allowlist = args.censored_word_allowlist
    run_length = len(run_markers)
    best: tuple[float, int, int, int, int, str] | None = None

    for before_len in range(min(args.context_tokens, len(before_all)), -1, -1):
        before = before_all[-before_len:]
        before_matches = find_subsequence(tokens, before) if before_len else [0]
        for before_index in before_matches:
            after_search_start = before_index + before_len
            max_after_len = min(args.context_tokens, len(after_all))
            after_lengths = range(max_after_len, -1, -1) if max_after_len else [0]
            for after_len in after_lengths:
                if before_len == 0 and after_len == 0:
                    continue
                after = after_all[:after_len]
                after_matches = find_subsequence(tokens, after, start=after_search_start) if after_len else [
                    min(len(tokens), after_search_start + run_length)
                ]
                for after_index in after_matches:
                    if before_len > 0 and after_len > 0:
                        candidate_start = after_search_start
                        candidate_end = after_index
                    elif before_len > 0:
                        candidate_start = after_search_start
                        candidate_end = candidate_start + run_length
                    else:
                        candidate_end = after_index
                        candidate_start = candidate_end - run_length
                    if candidate_start < 0 or candidate_end > len(bounded_words):
                        continue
                    if candidate_end - candidate_start != run_length:
                        continue
                    replacements = [clean_replacement(word.text) for word in bounded_words[candidate_start:candidate_end]]
                    if not all(replacement and len(replacement) <= args.max_replacement_chars for replacement in replacements):
                        continue
                    has_two_boundaries = before_len > 0 and after_len > 0
                    all_allowlisted = all(replacement_is_known_censored_word(replacement, allowlist) for replacement in replacements)
                    if not has_two_boundaries and not all_allowlisted:
                        continue
                    if not has_two_boundaries and max(before_len, after_len) < args.one_sided_context_tokens:
                        continue
                    score = before_len + after_len
                    if not has_two_boundaries:
                        score -= ONE_SIDED_SCORE_PENALTY
                    policy_reason = "two-sided context alignment" if has_two_boundaries else "one-sided tail alignment; all words allowlisted"
                    reason = (
                        f"adjacent {run_length}-marker run; matched {before_len} before token(s), "
                        f"{after_len} after token(s); {policy_reason}"
                    )
                    if best is None or score > best[0]:
                        best = (score, candidate_start, candidate_end, before_len, after_len, reason)

    if best is None:
        return {}

    score, candidate_start, candidate_end, before_len, after_len, reason = best
    available_context = len(before_all) + len(after_all)
    confidence = max(0.0, min(1.0, score / max(1, available_context)))
    replacements = [clean_replacement(word.text) for word in bounded_words[candidate_start:candidate_end]]
    return {
        marker.index: (replacement, confidence, "proposed", reason)
        for marker, replacement in zip(run_markers, replacements, strict=True)
    }


def choose_replacement(marker: Marker, words: list[Word], stt_text: str, args: argparse.Namespace) -> tuple[str, float, str, str]:
    words = words_inside_cue(marker, words, args)
    tokens = word_tokens(words)
    before_all = context_tokens(marker.youtube_before, from_right=True, max_tokens=args.context_tokens)
    after_all = context_tokens(marker.youtube_after, from_right=False, max_tokens=args.context_tokens)
    allowlist = args.censored_word_allowlist
    if not words or not tokens:
        if args.word_timestamps:
            return "", 0.0, "skipped", "no STT words inside cue time bounds"
        return "", 0.0, "skipped", "empty STT output"

    best: tuple[float, str, int, int, str] | None = None
    for before_len in range(min(args.context_tokens, len(before_all)), -1, -1):
        before = before_all[-before_len:]
        before_matches = find_subsequence(tokens, before) if before_len else [0]
        for before_index in before_matches:
            anchor_start = before_index + before_len
            max_after_len = min(args.context_tokens, len(after_all))
            after_lengths = range(max_after_len, -1, -1) if max_after_len else [0]
            for after_len in after_lengths:
                if before_len == 0 and after_len == 0:
                    continue
                after = after_all[:after_len]
                after_matches = find_subsequence(tokens, after, start=anchor_start) if after_len else [
                    min(len(tokens), anchor_start + args.max_replacement_tokens)
                ]
                for after_index in after_matches:
                    if before_len == 0 and after_len > 0:
                        candidate_end = after_index
                        candidate_start = max(0, candidate_end - args.max_replacement_tokens)
                    elif before_len > 0 and after_len == 0:
                        candidate_start = anchor_start
                        candidate_end = min(len(words), candidate_start + args.max_replacement_tokens)
                    else:
                        candidate_start = anchor_start
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
                    has_two_boundaries = has_left_boundary and has_right_boundary
                    allowed_by_policy, policy_reason = replacement_allowed_by_policy(
                        replacement,
                        has_left_boundary,
                        has_right_boundary,
                        allowlist,
                    )
                    if not allowed_by_policy:
                        continue
                    if not has_two_boundaries and len(candidate_words) > 1:
                        continue
                    if not has_two_boundaries and max(before_len, after_len) < args.one_sided_context_tokens:
                        continue
                    score = before_len + after_len - (LENGTH_PENALTY_PER_TOKEN * max(0, len(candidate_words) - 1))
                    if not has_two_boundaries:
                        score = min(score, args.context_tokens) - ONE_SIDED_SCORE_PENALTY
                    reason = (
                        f"cue/time bounded; matched {before_len} before token(s), "
                        f"{after_len} after token(s); {policy_reason}"
                    )
                    if best is None or score > best[0]:
                        best = (score, replacement, candidate_start, candidate_end, reason)

    if best is not None:
        score, replacement, start, end, reason = best
        available_context = len(before_all) + len(after_all)
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
        if marker.start_seconds - EXCERPT_CONTEXT_SECONDS <= word.start <= marker.end_seconds + EXCERPT_CONTEXT_SECONDS
    ]
    excerpt = " ".join(nearby).strip()
    return excerpt if excerpt else text[:500]


def insert_marker(conn: sqlite3.Connection, video_id: str, marker: Marker, payload: dict[str, Any]) -> bool:
    candidate = str(payload.get("candidate_text", "")).strip()
    if not candidate:
        return False
    confidence = float(payload.get("confidence", 0.0) or 0.0)
    before = conn.total_changes
    conn.execute(
        """
        INSERT INTO decensor_candidates (video_id, start_char, replacement, confidence)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(video_id, start_char, replacement) DO UPDATE SET
            confidence = excluded.confidence
        """,
        (
            video_id,
            marker.char_start,
            candidate,
            confidence,
        ),
    )
    return conn.total_changes > before


def clear_existing_candidates(conn: sqlite3.Connection, video_id: str, markers: list[Marker]) -> None:
    conn.executemany(
        "DELETE FROM decensor_candidates WHERE video_id = ? AND start_char = ?",
        [(video_id, marker.char_start) for marker in markers],
    )


def censored_video_ids(conn: sqlite3.Connection, args: argparse.Namespace) -> list[str]:
    sql = "SELECT v.youtube_id FROM videos v WHERE instr(v.transcript, ?) > 0"
    params: list[Any] = [MARKER]
    if args.start_after:
        sql += " AND v.youtube_id > ?"
        params.append(args.start_after)
    sql += " ORDER BY v.youtube_id"
    if args.limit_videos:
        sql += " LIMIT ?"
        params.append(args.limit_videos)
    return [str(row[0]) for row in conn.execute(sql, params).fetchall()]


def existing_candidate_video_ids(conn: sqlite3.Connection, args: argparse.Namespace) -> list[str]:
    sql = """
        SELECT u.video_id
        FROM decensor_candidates u
        JOIN videos v ON v.youtube_id = u.video_id
        WHERE instr(v.transcript, ?) > 0
    """
    params: list[Any] = [MARKER]
    if args.start_after:
        sql += " AND u.video_id > ?"
        params.append(args.start_after)
    sql += """
        GROUP BY u.video_id
        -- Reruns start with the quickest videos, which makes reviewable progress visible sooner.
        ORDER BY COUNT(*) ASC, u.video_id
    """
    if args.limit_videos:
        sql += " LIMIT ?"
        params.append(args.limit_videos)
    return [str(row[0]) for row in conn.execute(sql, params).fetchall()]


def existing_candidate_starts(conn: sqlite3.Connection, video_id: str) -> set[int]:
    rows = conn.execute(
        "SELECT DISTINCT start_char FROM decensor_candidates WHERE video_id = ?",
        (video_id,),
    ).fetchall()
    return {int(row[0]) for row in rows}


def filter_markers_by_min_run_length(transcript: str, markers: list[Marker], min_run_length: int) -> list[Marker]:
    if min_run_length <= 1:
        return markers
    keep_indexes = {
        marker.index
        for run in adjacent_marker_runs(transcript, markers)
        if len(run) >= min_run_length
        for marker in run
    }
    return [marker for marker in markers if marker.index in keep_indexes]


def unique_video_ids(video_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for video_id in video_ids:
        if video_id in seen:
            continue
        seen.add(video_id)
        unique.append(video_id)
    return unique


def rate_metrics(total_seconds: float, markers: int, windows: int, whisper_seconds: float, audio_seconds: float) -> dict[str, float]:
    return {
        "seconds_per_marker": round(total_seconds / max(1, markers), 3),
        "seconds_per_window": round(total_seconds / max(1, windows), 3),
        "whisper_rtf": round(whisper_seconds / max(0.001, audio_seconds), 3),
    }


def format_duration(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:d}:{seconds:02d}"


def add_progress_estimate(summary: dict[str, Any], progress: dict[str, float | int] | None) -> None:
    if progress is None:
        return
    completed = int(progress["completed_before"]) + 1
    total = int(progress["total_videos"])
    remaining = max(0, total - completed)
    timings = summary.get("timings", {})
    running_seconds = float(progress["prior_total_seconds"]) + float(timings.get("total_seconds", 0.0))
    running_markers = int(progress["prior_markers"]) + int(summary.get("markers", 0))
    running_seconds_per_marker = running_seconds / max(1, running_markers)
    running_markers_per_video = running_markers / max(1, completed)
    eta_seconds = running_seconds_per_marker * running_markers_per_video * remaining
    summary["progress"] = {
        "videos_done": completed,
        "videos_total": total,
        "videos_remaining": remaining,
        "running_seconds_per_marker": round(running_seconds_per_marker, 3),
        "running_markers_per_video": round(running_markers_per_video, 3),
        "eta_seconds": round(eta_seconds, 1),
        "eta": format_duration(eta_seconds),
    }


def aggregate_run_summary(mode: str, summaries: list[dict[str, Any]]) -> dict[str, Any]:
    total_timings = {
        key: sum(float(item.get("timings", {}).get(key, 0.0)) for item in summaries)
        for key in sorted({key for item in summaries for key in item.get("timings", {})})
    }
    total_markers = sum(int(item.get("markers", 0)) for item in summaries)
    total_windows = sum(int(item.get("windows", 0)) for item in summaries)
    total_audio_seconds = sum(float(item.get("audio_seconds", 0.0)) for item in summaries)
    summary = {
        "mode": mode,
        "videos": len(summaries),
        "success": sum(1 for item in summaries if item["status"] == "success"),
        "errors": sum(1 for item in summaries if item["status"] == "error"),
        "markers": total_markers,
        "windows": total_windows,
        "stored": sum(int(item.get("stored", 0)) for item in summaries),
        "audio_seconds": round(total_audio_seconds, 3),
        "timings": {key: round(value, 3) for key, value in total_timings.items()},
    }
    summary.update(
        rate_metrics(
            total_timings.get("total_seconds", 0.0),
            total_markers,
            total_windows,
            total_timings.get("whisper_seconds", 0.0),
            total_audio_seconds,
        )
    )
    return summary


def stt_model_label(args: argparse.Namespace) -> str:
    selected_model = args.mlx_model if args.backend == "mlx" else args.model
    return f"{args.backend}:{selected_model}"


def compact_stt_metric_record(summary: dict[str, Any]) -> dict[str, Any]:
    timings = summary.get("timings", {})
    if not isinstance(timings, dict):
        timings = {}
    keys = [
        "video_id",
        "channel",
        "title",
        "status",
        "model",
        "audio_mode",
        "dry_run",
        "windows",
        "markers",
        "stored",
        "audio_seconds",
        "seconds_per_marker",
        "seconds_per_window",
        "whisper_rtf",
    ]
    record = {key: summary.get(key) for key in keys if key in summary}
    record["recorded_at"] = datetime.now().astimezone().isoformat()
    record["timings"] = {
        str(key): round(float(value), 3)
        for key, value in timings.items()
        if isinstance(value, (int, float)) or (isinstance(value, str) and value.replace(".", "", 1).isdigit())
    }
    return record


def aggregate_stt_metric_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    measured = [
        record for record in records
        if int(record.get("markers", 0) or 0) > 0
        and int(record.get("windows", 0) or 0) > 0
        and float(record.get("audio_seconds", 0.0) or 0.0) > 0.0
    ]
    total_timings = {
        key: sum(float(record.get("timings", {}).get(key, 0.0)) for record in measured)
        for key in sorted({key for record in measured for key in record.get("timings", {})})
    }
    markers = sum(int(record.get("markers", 0) or 0) for record in measured)
    windows = sum(int(record.get("windows", 0) or 0) for record in measured)
    audio_seconds = sum(float(record.get("audio_seconds", 0.0) or 0.0) for record in measured)
    aggregate = {
        "records": len(records),
        "measured_records": len(measured),
        "success": sum(1 for record in records if record.get("status") == "success"),
        "errors": sum(1 for record in records if record.get("status") == "error"),
        "markers": markers,
        "windows": windows,
        "stored": sum(int(record.get("stored", 0) or 0) for record in measured),
        "audio_seconds": round(audio_seconds, 3),
        "timings": {key: round(value, 3) for key, value in total_timings.items()},
    }
    aggregate.update(
        rate_metrics(
            total_timings.get("total_seconds", 0.0),
            markers,
            windows,
            total_timings.get("whisper_seconds", 0.0),
            audio_seconds,
        )
    )
    return aggregate


def record_stt_metrics(summary: dict[str, Any]) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    if STT_METRICS.exists():
        try:
            payload = json.loads(STT_METRICS.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and isinstance(payload.get("records"), list):
                records = [record for record in payload["records"] if isinstance(record, dict)]
        except (OSError, json.JSONDecodeError):
            records = []
    records.append(compact_stt_metric_record(summary))
    records = records[-MAX_STT_METRIC_RECORDS:]
    payload = {
        "version": STT_METRICS_VERSION,
        "updated_at": datetime.now().astimezone().isoformat(),
        "latest": records[-1] if records else None,
        "aggregate": aggregate_stt_metric_records(records),
        "records": records,
    }
    tmp = STT_METRICS.with_suffix(STT_METRICS.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STT_METRICS)


def process_video(
    conn: sqlite3.Connection,
    video_id: str,
    args: argparse.Namespace,
    chunk_limit: int | None = None,
    progress: dict[str, float | int] | None = None,
) -> dict[str, Any]:
    total_started = stage_started()
    timings: dict[str, float] = {}
    video = fetch_video(conn, video_id)
    segments = fetch_segments(conn, video_id)
    if not segments:
        raise TranscriptDataError("Video has no segment anchors")
    markers = find_markers_by_cue(video["transcript"], segments)
    if not markers:
        raise TranscriptDataError("Video has no [ __ ] markers")
    total_markers = len(markers)
    if args.only_existing_candidate_markers:
        existing_starts = existing_candidate_starts(conn, video_id)
        markers = [marker for marker in markers if marker.char_start in existing_starts]
    if args.min_run_length > 1:
        markers = filter_markers_by_min_run_length(video["transcript"], markers, args.min_run_length)
    skipped_existing = 0
    if args.skip_successful:
        existing_starts = existing_candidate_starts(conn, video_id)
        if existing_starts:
            markers = [marker for marker in markers if marker.char_start not in existing_starts]
            skipped_existing = total_markers - len(markers)
    if not markers:
        total_seconds = time.perf_counter() - total_started
        filter_notes = []
        if args.only_existing_candidate_markers:
            filter_notes.append("existing candidate markers only")
        if args.min_run_length > 1:
            filter_notes.append(f"adjacent runs >= {args.min_run_length}")
        summary = {
            "video_id": video_id,
            "channel": video["channel"],
            "title": video["title"],
            "status": "skipped",
            "model": stt_model_label(args),
            "windows": 0,
            "markers": 0,
            "stored": 0,
            "audio_seconds": 0.0,
            "audio_mode": "",
            "dry_run": bool(args.dry_run),
            "skipped_existing": skipped_existing,
            "filter": ", ".join(filter_notes),
            "total_video_markers": total_markers,
            "run_dir": "",
            "timings": {"total_seconds": round(total_seconds, 3)},
        }
        summary.update(rate_metrics(total_seconds, 0, 0, 0.0, 0.0))
        add_progress_estimate(summary, progress)
        record_stt_metrics(summary)
        print(json.dumps(summary, indent=2))
        return summary
    windows = build_windows(
        markers,
        video_duration(segments),
        args.pad_seconds,
        args.merge_gap_seconds,
        args.merge_overlapping_windows,
        args.max_chunk_seconds,
    )
    if args.limit_windows:
        windows = windows[:args.limit_windows]
    if chunk_limit is not None and chunk_limit > 0:
        windows = windows[:chunk_limit]
    if args.max_window_seconds:
        long_windows = [(start, end) for start, end, _ in windows if end - start > args.max_window_seconds]
        if long_windows:
            longest = max(end - start for start, end in long_windows)
            raise SttPatchError(
                f"safety stop: {len(long_windows)} cue window(s) exceed "
                f"--max-window-seconds={args.max_window_seconds:g}; longest is {longest:.1f}s"
            )
    planned_audio_seconds = sum(max(0.0, end - start) for start, end, _ in windows)
    if args.max_video_audio_seconds and planned_audio_seconds > args.max_video_audio_seconds:
        raise SttPatchError(
            f"safety stop: planned cue audio is {planned_audio_seconds:.1f}s, "
            f"above --max-video-audio-seconds={args.max_video_audio_seconds:g}"
        )

    run_dir = RUNS / f"stt-patch-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{video_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    audio_seconds = 0.0
    processed_markers = 0
    stored_count = 0
    status = "success"
    error = ""
    audio_mode = ""

    try:
        with tempfile.TemporaryDirectory(prefix="yt-stt-patch-") as temp_name:
            temp_dir = Path(temp_name)
            audio_source, audio_mode = prepare_audio_source(video_id, args, temp_dir, len(windows), timings)
            for window_index, (start, end, window_markers) in enumerate(windows):
                wav_path = temp_dir / f"window_{window_index:04d}_{int(start)}-{int(end)}.wav"
                out_dir = run_dir / f"window_{window_index:04d}"
                out_dir.mkdir(parents=True, exist_ok=True)
                try:
                    started = stage_started()
                    cut_audio(audio_source, start, end, wav_path)
                    add_timing(timings, "ffmpeg_cut_seconds", started)
                    audio_seconds += max(0.0, end - start)
                    started = stage_started()
                    whisper_payload = transcribe_window(wav_path, out_dir, args)
                    add_timing(timings, "whisper_seconds", started)
                finally:
                    if wav_path.exists():
                        wav_path.unlink()
                text = stt_text(whisper_payload)
                words = whisper_words(whisper_payload, start)
                started = stage_started()
                run_replacements: dict[int, tuple[str, float, str, str]] = {}
                for marker_run in adjacent_marker_runs(video["transcript"], window_markers):
                    run_replacements.update(
                        choose_adjacent_run_replacements(marker_run, video["transcript"], words, args)
                    )
                marker_payloads: list[tuple[Marker, dict[str, Any]]] = []
                for marker in window_markers:
                    if marker.index in run_replacements:
                        candidate, confidence, marker_status, reason = run_replacements[marker.index]
                    else:
                        candidate, confidence, marker_status, reason = choose_replacement(marker, words, text, args)
                    marker_payloads.append((
                        marker,
                        {
                            "stt_text": text,
                            "stt_excerpt": stt_excerpt(words, marker, text),
                            "candidate_text": candidate,
                            "replacement_text": candidate,
                            "status": marker_status,
                            "confidence": confidence,
                            "reason": reason,
                        },
                    ))
                    processed_markers += 1
                add_timing(timings, "alignment_seconds", started)
                if not args.dry_run:
                    started = stage_started()
                    for marker, marker_payload in marker_payloads:
                        if not args.keep_existing_candidates:
                            clear_existing_candidates(conn, video_id, [marker])
                        if insert_marker(conn, video_id, marker, marker_payload):
                            stored_count += 1
                    conn.commit()
                    add_timing(timings, "db_seconds", started)
    except Exception as exc:
        status = "error"
        error = str(exc)
        if not args.all_censored and not args.existing_candidates:
            raise
    finally:
        if not args.dry_run:
            conn.commit()

    timings["total_seconds"] = time.perf_counter() - total_started
    summary = {
        "video_id": video_id,
        "channel": video["channel"],
        "title": video["title"],
        "status": status,
        "model": stt_model_label(args),
        "windows": len(windows),
        "markers": processed_markers,
        "stored": stored_count,
        "audio_seconds": round(audio_seconds, 3),
        "audio_mode": audio_mode,
        "dry_run": bool(args.dry_run),
        "skipped_existing": skipped_existing,
        "filter": ", ".join(filter_notes for filter_notes in [
            "existing candidate markers only" if args.only_existing_candidate_markers else "",
            f"adjacent runs >= {args.min_run_length}" if args.min_run_length > 1 else "",
        ] if filter_notes),
        "total_video_markers": total_markers,
        "run_dir": str(run_dir),
        "timings": {key: round(value, 3) for key, value in sorted(timings.items())},
    }
    summary.update(
        rate_metrics(
            timings["total_seconds"],
            processed_markers,
            len(windows),
            timings.get("whisper_seconds", 0.0),
            audio_seconds,
        )
    )
    add_progress_estimate(summary, progress)
    if error:
        summary["error"] = error
    if args.keep_workdir or status == "error":
        report_path = run_dir / "summary.json"
        report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    if not args.keep_workdir and status != "error":
        shutil.rmtree(run_dir, ignore_errors=True)
    record_stt_metrics(summary)
    print(json.dumps(summary, indent=2))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch YouTube '[ __ ]' caption censor markers using local STT on cue-bounded audio windows.")
    parser.add_argument("--video-id", action="append", default=[], help="YouTube video id to process. Can be passed multiple times.")
    parser.add_argument("--all-censored", action="store_true", help="Process every video whose current transcript still contains a censor marker.")
    parser.add_argument("--existing-candidates", action="store_true", help="Process videos that already have staged rows in decensor_candidates.")
    parser.add_argument("--limit-videos", type=int, default=0, help="Limit --all-censored to the first N videos.")
    parser.add_argument("--limit-chunks", type=int, default=0, help="Limit --all-censored to this many STT chunks total across videos.")
    parser.add_argument(
        "--allow-unbounded-all-censored",
        action="store_true",
        help="Allow --all-censored without --limit-videos. This is intentionally opt-in.",
    )
    parser.add_argument("--start-after", default="", help="Resume --all-censored after this YouTube video id.")
    parser.add_argument("--skip-successful", action="store_true", help="Skip videos that already have rows in decensor_candidates.")
    parser.add_argument("--only-existing-candidate-markers", action="store_true", help="For selected videos, rerun only markers that already have staged decensor_candidates rows.")
    parser.add_argument("--min-run-length", type=int, default=1, help="Only process markers that belong to adjacent [ __ ] runs at least this long. Use 5 for the hardest curse-string cases.")
    parser.add_argument("--dry-run", action="store_true", help="Run STT and alignment without writing decensor_candidates rows.")
    parser.add_argument("--allowlist", type=Path, default=ALLOWLIST, help="One-word-per-line allowlist for one-sided censored-word proposals.")
    parser.add_argument("--audio-mode", choices=["auto", "stream", "download"], default="auto", help="How to provide source audio to ffmpeg windows.")
    parser.add_argument(
        "--download-audio-min-windows",
        type=int,
        default=DEFAULT_DOWNLOAD_AUDIO_MIN_WINDOWS,
        help="In --audio-mode=auto, download the full source audio when a video has at least this many STT windows.",
    )
    parser.add_argument("--pad-seconds", type=float, default=0.0, help="Seconds of audio context to add before and after each cue before merging.")
    parser.add_argument("--merge-gap-seconds", type=float, default=0.0, help="Merge padded cue windows separated by at most this many seconds.")
    parser.add_argument(
        "--merge-overlapping-windows",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Merge overlapping cue windows, capped by --max-chunk-seconds.",
    )
    parser.add_argument(
        "--max-chunk-seconds",
        type=float,
        default=30.0,
        help="Never merge cue windows into STT chunks longer than this. Use 0 to disable.",
    )
    parser.add_argument(
        "--max-window-seconds",
        type=float,
        default=30.0,
        help="Safety stop for any single STT excerpt. Use 0 to disable.",
    )
    parser.add_argument(
        "--max-video-audio-seconds",
        type=float,
        default=600.0,
        help="Safety stop for total planned STT excerpt audio per video. Use 0 to disable.",
    )
    parser.add_argument("--context-chars", type=int, default=220, help="Transcript characters to inspect around each marker for alignment context.")
    parser.add_argument("--context-tokens", type=int, default=4, help="Maximum before/after transcript tokens to match against STT output.")
    parser.add_argument(
        "--one-sided-context-tokens",
        type=int,
        default=2,
        help="Minimum matched context tokens required when only one side of a censored marker is alignable.",
    )
    parser.add_argument("--cue-time-tolerance", type=float, default=0.25, help="Seconds of tolerance around the original cue bounds when filtering word timestamps.")
    parser.add_argument("--max-replacement-chars", type=int, default=20, help="Maximum characters allowed in one staged replacement.")
    parser.add_argument(
        "--max-replacement-tokens",
        type=int,
        default=1,
        help="Stage only short censored spans by default; raise this for phrase-level review.",
    )
    parser.add_argument("--model", default="small.en", help="OpenAI Whisper model name when --backend=openai.")
    parser.add_argument("--backend", choices=["openai", "mlx"], default="mlx")
    parser.add_argument("--mlx-model", default=DEFAULT_MLX_MODEL, help="MLX Whisper model repo/name when --backend=mlx.")
    parser.add_argument("--word-timestamps", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--model-dir", type=Path, default=Path.home() / ".cache" / "whisper", help="OpenAI Whisper model cache directory.")
    parser.add_argument("--device", default="cpu", help="OpenAI Whisper device, for example cpu or mps.")
    parser.add_argument("--cookies-from-browser", default="chrome", help="Browser profile for yt-dlp cookies. Pass '' to disable cookies.")
    parser.add_argument("--whisper-bin", type=Path, default=WHISPER, help="OpenAI Whisper executable path for --backend=openai.")
    parser.add_argument("--limit-windows", type=int, help="Process only the first N merged windows for a quick smoke test.")
    parser.add_argument("--keep-existing-candidates", action="store_true", help="Keep existing decensor_candidates rows for processed markers instead of replacing them.")
    parser.add_argument("--keep-workdir", action="store_true", help="Keep non-audio JSON/report files. Audio is always deleted.")
    args = parser.parse_args()

    args.censored_word_allowlist = load_censored_word_allowlist(args.allowlist)
    selected_model = args.mlx_model if args.backend == "mlx" else args.model

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 60000")
    conn.execute("PRAGMA journal_mode = WAL")
    ensure_tables(conn)
    conn.commit()

    if args.existing_candidates:
        video_ids = existing_candidate_video_ids(conn, args)
        print(json.dumps({"mode": "existing_candidates", "videos": len(video_ids), "model": f"{args.backend}:{selected_model}"}, indent=2))
    elif args.all_censored:
        if not args.limit_videos and not args.limit_chunks and not args.allow_unbounded_all_censored:
            raise SystemExit("--all-censored now requires --limit-videos or --limit-chunks unless --allow-unbounded-all-censored is set")
        video_ids = censored_video_ids(conn, args)
        print(json.dumps({"mode": "all_censored", "videos": len(video_ids), "model": f"{args.backend}:{selected_model}"}, indent=2))
    elif args.video_id:
        video_ids = unique_video_ids([str(video_id) for video_id in args.video_id])
    else:
        raise SystemExit("--video-id, --existing-candidates, or --all-censored is required")

    summaries = []
    remaining_chunks = args.limit_chunks if args.limit_chunks > 0 else None
    try:
        for video_index, video_id in enumerate(video_ids):
            if remaining_chunks is not None and remaining_chunks <= 0:
                break
            progress = {
                "completed_before": len(summaries),
                "total_videos": len(video_ids),
                "prior_total_seconds": sum(float(item.get("timings", {}).get("total_seconds", 0.0)) for item in summaries),
                "prior_markers": sum(int(item.get("markers", 0)) for item in summaries),
            }
            try:
                summary = process_video(conn, video_id, args, chunk_limit=remaining_chunks, progress=progress)
                summaries.append(summary)
                if remaining_chunks is not None:
                    remaining_chunks -= int(summary.get("windows", 0))
            except Exception as exc:
                if not args.all_censored and not args.existing_candidates:
                    raise
                total_seconds = 0.0
                summary = {
                    "video_id": video_id,
                    "status": "error",
                    "model": stt_model_label(args),
                    "windows": 0,
                    "markers": 0,
                    "stored": 0,
                    "audio_seconds": 0.0,
                    "seconds_per_marker": 0.0,
                    "seconds_per_window": 0.0,
                    "whisper_rtf": 0.0,
                    "timings": {"total_seconds": total_seconds},
                    "error": str(exc),
                }
                add_progress_estimate(summary, progress)
                summaries.append(summary)
                record_stt_metrics(summary)
                print(json.dumps(summary, indent=2))
    finally:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()

    if args.all_censored or args.existing_candidates:
        mode = "existing_candidates" if args.existing_candidates else "all_censored"
        print(json.dumps(aggregate_run_summary(mode, summaries), indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SttPatchError as exc:
        raise SystemExit(str(exc)) from None
