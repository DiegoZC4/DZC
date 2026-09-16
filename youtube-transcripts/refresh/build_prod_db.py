#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


ROOT = Path("/Users/diego/Desktop/Read/YouTube Channel Transcripts")
DEFAULT_SOURCE_DB = ROOT / "data" / "transcripts.sqlite3"
DEFAULT_OUTPUT_DB = ROOT / "data" / "transcripts.prod.sqlite3"
STATS_CACHE_VERSION = 2


@dataclass
class SegmentSummary:
    source_rows: int = 0
    kept_rows: int = 0
    removed_rows: int = 0
    videos: int = 0

    @property
    def removed_percent(self) -> float:
        if self.source_rows == 0:
            return 0.0
        return self.removed_rows / self.source_rows * 100.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build a production SQLite copy by preserving the source DB contents, "
            "rewriting only the segments table, and compacting the copy. The source DB is never modified."
        )
    )
    parser.add_argument("--source-db", type=Path, default=DEFAULT_SOURCE_DB, help=f"Source dev DB. Default: {DEFAULT_SOURCE_DB}")
    parser.add_argument("--output-db", type=Path, default=DEFAULT_OUTPUT_DB, help=f"Output prod DB. Default: {DEFAULT_OUTPUT_DB}")
    parser.add_argument(
        "--min-spacing-seconds",
        "--min-cue-spacing",
        dest="min_spacing_seconds",
        type=float,
        default=5.0,
        help="Minimum seconds between kept segment anchors per video. Use 0 to keep every segment. Default: 5.",
    )
    parser.add_argument("--overwrite", action="store_true", help="Replace an existing output DB.")
    parser.add_argument("--dry-run", action="store_true", help="Only count kept/removed segments; do not write an output DB.")
    parser.add_argument(
        "--stats-cache",
        type=Path,
        default=None,
        help="Optional stats-cache.json path to write for the output DB after build.",
    )
    parser.add_argument("--batch-size", type=int, default=50_000, help="Rows per bulk insert batch. Default: 50000.")
    parser.add_argument("--progress-every", type=int, default=1_000_000, help="Print progress every N source segment rows. Default: 1000000.")
    return parser.parse_args()


def connect(path: Path, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        uri = path.resolve().as_uri() + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
    else:
        conn = sqlite3.connect(path)
    conn.execute("PRAGMA busy_timeout = 60000")
    return conn


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def reduce_segments(
    src: sqlite3.Connection,
    dst: sqlite3.Connection | None,
    min_spacing_seconds: float,
    batch_size: int,
    progress_every: int,
) -> SegmentSummary:
    summary = SegmentSummary()
    cursor = src.execute(
        """
        SELECT video_id, start_seconds, char_index
        FROM segments
        ORDER BY video_id, start_seconds
        """
    )
    last_video_id = ""
    last_kept_seconds: float | None = None
    batch: list[tuple[str, int, int]] = []

    def flush() -> None:
        if dst is not None and batch:
            dst.executemany(
                "INSERT INTO segments (video_id, start_seconds, char_index) VALUES (?, ?, ?)",
                batch,
            )
            batch.clear()

    for video_id, start_seconds, char_index in cursor:
        video_id = str(video_id)
        start_seconds = int(start_seconds)
        char_index = int(char_index)
        summary.source_rows += 1
        if video_id != last_video_id:
            summary.videos += 1
            last_video_id = video_id
            last_kept_seconds = None

        keep = (
            last_kept_seconds is None
            or min_spacing_seconds <= 0
            or (start_seconds - last_kept_seconds) >= min_spacing_seconds
        )
        if keep:
            summary.kept_rows += 1
            last_kept_seconds = float(start_seconds)
            if dst is not None:
                batch.append((video_id, start_seconds, char_index))
                if len(batch) >= batch_size:
                    flush()
        else:
            summary.removed_rows += 1

        if progress_every > 0 and summary.source_rows % progress_every == 0:
            print(
                f"segments: scanned={summary.source_rows:,} kept={summary.kept_rows:,} "
                f"removed={summary.removed_rows:,} ({summary.removed_percent:.1f}%)",
                file=sys.stderr,
            )

    flush()
    return summary


def compute_stats_cache(conn: sqlite3.Connection, db_path: Path) -> dict:
    db_bytes = db_path.stat().st_size if db_path.exists() else 0
    rows = conn.execute(
        """
        SELECT
            c.id,
            c.name AS channel,
            c.url,
            c.avatar_url,
            c.category,
            c.enabled,
            COUNT(p.youtube_id) AS video_count,
            COALESCE(SUM(p.runtime_seconds), 0) AS runtime_seconds,
            COALESCE(SUM(p.transcript_chars), 0) AS transcript_chars,
            COALESCE(SUM(p.payload_bytes), 0) AS payload_bytes,
            COALESCE(SUM(p.segment_count), 0) AS segment_count,
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS updated_at
        FROM channels c
        JOIN (
            SELECT
                v.youtube_id,
                v.channel_id,
                LENGTH(v.transcript) AS transcript_chars,
                LENGTH(v.transcript)
                    + LENGTH(v.title)
                    + LENGTH(v.youtube_id)
                    + LENGTH(v.source_file)
                    + LENGTH(v.imported_at)
                    + 32 AS payload_bytes,
                COALESCE(MAX(s.start_seconds), 0) AS runtime_seconds,
                COUNT(s.start_seconds) AS segment_count
            FROM videos v
            LEFT JOIN segments s ON s.video_id = v.youtube_id
            WHERE v.channel_id IS NOT NULL
            GROUP BY v.youtube_id
        ) p ON p.channel_id = c.id
        GROUP BY c.id
        HAVING COUNT(p.youtube_id) > 0
        ORDER BY c.name COLLATE NOCASE
        """
    ).fetchall()
    total_payload_bytes = sum(int(row[9]) for row in rows)
    channels = []
    for row in rows:
        payload_bytes = int(row[9])
        estimated_db_bytes = round(db_bytes * (payload_bytes / total_payload_bytes)) if total_payload_bytes else 0
        channels.append(
            {
                "id": int(row[0]),
                "channel": str(row[1]),
                "url": str(row[2]),
                "avatar_url": str(row[3]),
                "category": str(row[4]),
                "enabled": bool(row[5]),
                "video_count": int(row[6]),
                "runtime_seconds": int(row[7]),
                "transcript_chars": int(row[8]),
                "payload_bytes": payload_bytes,
                "estimated_db_bytes": estimated_db_bytes,
                "segment_count": int(row[10]),
                "updated_at": str(row[11]),
            }
        )
    return {
        "database_bytes": db_bytes,
        "totals": {
            "channels": len(channels),
            "video_count": sum(row["video_count"] for row in channels),
            "runtime_seconds": sum(row["runtime_seconds"] for row in channels),
            "transcript_chars": sum(row["transcript_chars"] for row in channels),
            "payload_bytes": sum(row["payload_bytes"] for row in channels),
            "estimated_db_bytes": db_bytes,
            "segment_count": sum(row["segment_count"] for row in channels),
        },
        "notes": {
            "runtime_seconds": "Approximate: summed from each video's latest transcript timestamp, not exact YouTube duration.",
            "payload_bytes": "Approximate raw row payload: transcript/title/id/source/import text, not SQLite page usage.",
            "estimated_db_bytes": "Approximate: total DB file size apportioned by each channel's raw payload bytes.",
        },
        "channels": channels,
    }


def write_stats_cache(conn: sqlite3.Connection, db_path: Path, stats_cache_path: Path) -> None:
    payload = {
        "cache_version": STATS_CACHE_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stats": compute_stats_cache(conn, db_path),
    }
    stats_cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = stats_cache_path.with_suffix(stats_cache_path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, stats_cache_path)


def file_size(path: Path) -> int:
    return path.stat().st_size if path.exists() else 0


def remove_if_exists(paths: Iterable[Path]) -> None:
    for path in paths:
        if path.exists():
            path.unlink()


def backup_source_to_work(source: sqlite3.Connection, work_db: Path) -> None:
    dst = connect(work_db)
    try:
        dst.execute("PRAGMA journal_mode = OFF")
        source.backup(dst, pages=10_000)
    finally:
        dst.close()


def rewrite_segments_in_copy(
    source: sqlite3.Connection,
    work_db: Path,
    min_spacing_seconds: float,
    batch_size: int,
    progress_every: int,
) -> SegmentSummary:
    dst = connect(work_db)
    try:
        dst.execute("PRAGMA foreign_keys = OFF")
        dst.execute("PRAGMA journal_mode = OFF")
        dst.execute("PRAGMA synchronous = OFF")
        dst.execute("PRAGMA temp_store = MEMORY")
        dst.execute("PRAGMA cache_size = -200000")
        dst.execute("BEGIN")
        dst.execute("DELETE FROM segments")
        summary = reduce_segments(source, dst, min_spacing_seconds, batch_size, progress_every)
        dst.execute("COMMIT")
        dst.execute("PRAGMA foreign_keys = ON")
        problems = dst.execute("PRAGMA foreign_key_check").fetchall()
        if problems:
            raise RuntimeError(f"foreign_key_check failed: {problems[:5]}")
        dst.execute("VACUUM")
        return summary
    except Exception:
        try:
            dst.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise
    finally:
        dst.close()


def main() -> int:
    args = parse_args()
    source_db = args.source_db.expanduser().resolve()
    output_db = args.output_db.expanduser().resolve()
    if not source_db.exists():
        raise SystemExit(f"Source DB does not exist: {source_db}")
    if source_db == output_db:
        raise SystemExit("Refusing to write output over the source DB.")
    if args.min_spacing_seconds < 0:
        raise SystemExit("--min-spacing-seconds must be >= 0")
    if args.batch_size <= 0:
        raise SystemExit("--batch-size must be > 0")
    if output_db.exists() and not args.overwrite and not args.dry_run:
        raise SystemExit(f"Output DB already exists; pass --overwrite to replace it: {output_db}")

    started = time.time()
    with connect(source_db, readonly=True) as src:
        if not table_exists(src, "segments"):
            raise SystemExit("Source DB does not have a segments table.")
        if args.dry_run:
            summary = reduce_segments(src, None, args.min_spacing_seconds, args.batch_size, args.progress_every)
            print(json.dumps({
                "ok": True,
                "dry_run": True,
                "source_db": str(source_db),
                "min_spacing_seconds": args.min_spacing_seconds,
                "segments": {
                    "source_rows": summary.source_rows,
                    "kept_rows": summary.kept_rows,
                    "removed_rows": summary.removed_rows,
                    "removed_percent": round(summary.removed_percent, 2),
                    "videos": summary.videos,
                },
                "elapsed_seconds": round(time.time() - started, 2),
            }, indent=2))
            return 0

        output_db.parent.mkdir(parents=True, exist_ok=True)
        tmp_db = output_db.with_suffix(output_db.suffix + ".tmp")
        remove_if_exists([tmp_db, Path(str(tmp_db) + "-wal"), Path(str(tmp_db) + "-shm")])
        try:
            print(f"copying source DB to temporary build copy: {tmp_db}", file=sys.stderr)
            backup_source_to_work(src, tmp_db)
            print("rewriting only the segments table", file=sys.stderr)
            summary = rewrite_segments_in_copy(
                src,
                tmp_db,
                args.min_spacing_seconds,
                args.batch_size,
                args.progress_every,
            )
        except Exception:
            remove_if_exists([tmp_db, Path(str(tmp_db) + "-wal"), Path(str(tmp_db) + "-shm")])
            raise

    if output_db.exists() and args.overwrite:
        remove_if_exists([output_db, Path(str(output_db) + "-wal"), Path(str(output_db) + "-shm")])
    os.replace(tmp_db, output_db)

    if args.stats_cache is not None:
        with connect(output_db, readonly=True) as prod:
            write_stats_cache(prod, output_db, args.stats_cache.expanduser().resolve())

    print(json.dumps({
        "ok": True,
        "source_db": str(source_db),
        "output_db": str(output_db),
        "min_spacing_seconds": args.min_spacing_seconds,
        "fts_preserved": True,
        "stats_cache": str(args.stats_cache.expanduser().resolve()) if args.stats_cache else "",
        "segments": {
            "source_rows": summary.source_rows,
            "kept_rows": summary.kept_rows,
            "removed_rows": summary.removed_rows,
            "removed_percent": round(summary.removed_percent, 2),
            "videos": summary.videos,
        },
        "bytes": {
            "source_db": file_size(source_db),
            "output_db": file_size(output_db),
        },
        "elapsed_seconds": round(time.time() - started, 2),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
