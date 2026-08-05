"""A named stretch of play, and a receipt for what it collected.

NOT a recorder. Capture is already running 24 hours a day: dumpcap writes
every packet, the reader takes every file, sync pushes everything. Nothing
here makes the collector see more than it already sees, and a button that
implied otherwise would be lying about the machine.

What it adds is the two things always-on collection cannot give you:

  * an answer. Browsing the game produces data, and until now there was no
    way to tell whether opening six profiles had accomplished anything. The
    counts below are per command, so "I opened three alliances" is checkable.
  * an ending. Normally a capture reaches Supabase in about 110 seconds — 60s
    for the ring to close a file, 20s of settling, up to 30s of polling. On
    Stop that wait is spent on purpose, once, with a progress line, instead of
    being wondered about.

Read-only throughout. The journal belongs to the ingest process; this opens
it with `mode=ro` for the same reason `state.py` does, and the flush is a
subprocess rather than an in-process ingest so there is never a second writer.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

# The capture ring's period plus slack. Stop has to wait for dumpcap to close
# the file it is writing, because a file still being written is the one thing
# the reader deliberately skips.
ROLL_TIMEOUT_SECONDS = 90.0
DRAIN_TIMEOUT_SECONDS = 120.0
POLL_SECONDS = 2.0


@dataclass(frozen=True)
class Session:
    """Where the journal stood when Start was pressed.

    Both marks, for the reason the UI worker needs both: rowid answers "written
    since", `started_at` answers "could have been caused by what I did next".
    A capture from before the session arrives in the journal during it.
    """

    mark: int
    started_at: datetime
    journal_path: Path

    @property
    def elapsed(self) -> float:
        return (datetime.now(tz=UTC) - self.started_at).total_seconds()


@dataclass
class FinishReport:
    """What actually reached the cloud, not what was journalled."""

    commands: dict[str, int] = field(default_factory=dict)
    observations: int = 0
    files_ingested: int = 0
    outbox_pending: int = 0
    sent: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def delivered(self) -> bool:
        """Everything the session produced is in Supabase, not just on disk."""
        return self.outbox_pending == 0


def _read_only(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5.0)


def start(journal_path: Path) -> Session | None:
    """Mark the journal's position. None when there is no journal yet — a
    session over a collector that has never run would count nothing and
    report success for it."""
    if not journal_path.exists():
        return None
    conn = _read_only(journal_path)
    try:
        mark = int(
            conn.execute("select coalesce(max(rowid), 0) from raw_observations").fetchone()[0]
        )
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    return Session(mark=mark, started_at=datetime.now(tz=UTC), journal_path=journal_path)


def counts(session: Session) -> dict[str, int]:
    """Observations per command since the session began, newest work first.

    Both bounds, and `captured_at` is the one that matters here: with a 60s
    ring, packets from before Start land in the journal after it, and counting
    those would credit this session with the last minute of somebody else's.
    """
    try:
        conn = _read_only(session.journal_path)
    except sqlite3.Error:
        return {}
    try:
        rows = conn.execute(
            "select source_command, count(1) from raw_observations "
            "where rowid > ? and captured_at >= ? group by 1 order by 2 desc",
            (session.mark, session.started_at.isoformat()),
        ).fetchall()
    except sqlite3.Error:
        return {}
    finally:
        conn.close()
    return {str(command): int(n) for command, n in rows}


def _outbox(session: Session) -> tuple[int, int]:
    try:
        conn = _read_only(session.journal_path)
    except sqlite3.Error:
        return 0, 0
    try:
        rows = dict(conn.execute("select status, count(1) from sync_outbox group by 1").fetchall())
    except sqlite3.Error:
        return 0, 0
    finally:
        conn.close()
    return int(rows.get("pending", 0)), int(rows.get("sent", 0))


def _newest_capture(directory: Path) -> str | None:
    files = sorted(directory.glob("*.pcapng"), key=lambda p: p.stat().st_mtime)
    return files[-1].name if files else None


def _wait_for_roll(directory: Path, progress: Callable[[str], None]) -> bool:
    """Wait until dumpcap starts a new file, so the one holding this session's
    last packets is closed and readable.

    Waiting rather than restarting the capture task. Rolling the ring by force
    means killing dumpcap and its orphaned children — `schtasks /end` does not
    reach them — and stopping collection to make a receipt arrive sooner is a
    bad trade for a 24-hour collector.
    """
    if not directory.exists():
        progress(f"no capture directory at {directory}")
        return False
    before = _newest_capture(directory)
    if before is None:
        progress("no capture files yet")
        return False
    deadline = time.monotonic() + ROLL_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if _newest_capture(directory) != before:
            return True
        remaining = int(deadline - time.monotonic())
        progress(f"waiting for the capture file to close ({remaining}s left)")
        time.sleep(POLL_SECONDS)
    progress("the capture file did not roll — is dumpcap running?")
    return False


def finish(
    session: Session,
    *,
    capture_dir: Path,
    collector_dir: Path,
    progress: Callable[[str], None] = lambda _m: None,
) -> FinishReport:
    """Close the session: roll, read, sync, then report what landed.

    The order is the pipeline's own. Reporting before the outbox drains would
    describe the journal and call it the dashboard, which is the mistake this
    project keeps having to correct.
    """
    report = FinishReport()

    if _wait_for_roll(capture_dir, progress):
        progress("reading the new capture files")
        # A subprocess, not an in-process ingest: the journal has one writer
        # and it is the ingest task. min-age 0 because the roll already proved
        # the file is closed, and interval 0 so this returns instead of
        # becoming a second poller.
        result = subprocess.run(
            [
                "uv",
                "run",
                "dw-collector",
                "ingest-dir",
                "--dir",
                str(capture_dir),
                "--min-age-seconds",
                "0",
                "--interval-seconds",
                "0",
            ],
            cwd=collector_dir,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
            creationflags=0x08000000 if os.name == "nt" else 0,
        )
        report.files_ingested = sum(1 for line in result.stdout.splitlines() if "ingested=" in line)
        if result.returncode != 0:
            report.notes.append(f"ingest exited {result.returncode}: {result.stderr.strip()[:200]}")

    progress("waiting for sync to drain the outbox")
    deadline = time.monotonic() + DRAIN_TIMEOUT_SECONDS
    pending, sent = _outbox(session)
    while pending > 0 and time.monotonic() < deadline:
        time.sleep(POLL_SECONDS)
        pending, sent = _outbox(session)
        progress(f"{pending:,} rows still to send")

    report.commands = counts(session)
    report.observations = sum(report.commands.values())
    report.outbox_pending = pending
    report.sent = sent
    if pending > 0:
        # Said plainly rather than folded into a success line: the rows are on
        # disk and will go when sync next runs, but they are not in the
        # dashboard yet and the receipt must not imply they are.
        report.notes.append(
            f"{pending:,} rows are still queued — they will sync, but are not in the cloud yet"
        )
    return report
