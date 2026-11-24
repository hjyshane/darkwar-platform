"""A response that straddles two capture files is still one response.

dumpcap rotates the ring every 15 seconds and knows nothing about SmartFox
frames, so a response in flight at the rotation is split across two files:
its first bytes close one file and the rest open the next. `ingest-dir`
used to give every file a fresh reassembler, which threw away the first
half with the old file and could not make sense of the second half in the
new one. Measured on 2026-11-24 (cap_01363..01366, four flip responses in
the Lucky Magic House event): per-file reading found 74 frames in the four
files, one continuous stream over the same bytes found 165.

The fix keeps the reassembly state across consecutive files. The failure
that fresh-per-file was bounding — a wedged stream staying wedged for the
rest of the run — is bounded instead by the reassembler's gap timeout
(`GAP_TIMEOUT_SECONDS`, needs the packet clock) and by dropping streams that
have gone quiet (`prune_idle_streams`).
"""

from __future__ import annotations

import os
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from typer.testing import CliRunner

from dw_collector import cli
from dw_collector.cli import app
from dw_collector.protocol.pcapng import (
    StreamTable,
    TCPDirectionReassembler,
    iter_extension_events,
    prune_idle_streams,
)
from dw_collector.storage.journal import Journal
from tests.test_protocol import ENVELOPE, _pcapng, _tcp_packet, frame

runner = CliRunner()

SECOND = 1_000_000  # pcapng ticks at the default 10^-6 resolution


def _split_response(directory: Path, *, at_seconds: int = 0) -> tuple[Path, Path]:
    """One inbound frame, cut in two, each half in its own capture file."""
    wire = frame(ENVELOPE)
    cut = len(wire) // 2
    head = _tcp_packet(wire[:cut], sport=8680, dport=50000, seq=1)
    tail = _tcp_packet(wire[cut:], sport=8680, dport=50000, seq=1 + cut)
    first = directory / "cap_00001.pcapng"
    second = directory / "cap_00002.pcapng"
    first.write_bytes(_pcapng([head], ticks=at_seconds * SECOND))
    second.write_bytes(_pcapng([tail], ticks=(at_seconds + 1) * SECOND))
    for path in (first, second):
        when = time.time() - 600
        os.utime(path, (when, when))
    return first, second


def test_a_frame_cut_by_the_rotation_completes_in_the_next_file(tmp_path: Path) -> None:
    first, second = _split_response(tmp_path)

    # Fresh per file — the old behaviour — sees nothing in either half.
    assert list(iter_extension_events(first)) == []
    assert list(iter_extension_events(second)) == []

    # One table across both files: the frame completes in the second.
    streams: StreamTable = {}
    assert list(iter_extension_events(first, streams=streams)) == []
    events = list(iter_extension_events(second, streams=streams))
    assert [e.command for e in events] == ["al.rank"]
    assert events[0].direction == "inbound"


def test_ingest_dir_journals_a_response_split_across_files(tmp_path: Path) -> None:
    directory = tmp_path / "captures"
    directory.mkdir()
    _split_response(directory)
    db = tmp_path / "journal.db"

    result = runner.invoke(
        app, ["ingest-dir", "--dir", str(directory), "--db", str(db), "--min-age-seconds", "0"]
    )

    assert result.exit_code == 0, result.output
    journal = Journal(db)
    commands = journal.conn.execute(
        "select source_command, count(1) from raw_observations group by 1"
    ).fetchall()
    journal.close()
    assert dict(commands) == {"al.rank": 1}
    # Attributed to the file in which it completed, like any other event there.
    assert "cap_00002.pcapng  ingested=1" in result.output


def test_a_retried_file_is_read_as_if_for_the_first_time(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A locked journal makes `ingest-dir` re-read the whole file once the
    lock clears. The table had already consumed that file's segments, so
    without restoring it the re-read saw only retransmissions, found nothing,
    and marked the file done with zero events — the straddling response
    would be lost exactly when a lock happened to land on its file."""
    directory = tmp_path / "captures"
    directory.mkdir()
    _split_response(directory)
    db = tmp_path / "journal.db"
    real_mark = Journal.mark_capture_ingested
    attempts: list[str] = []

    def mark_second_file_once_locked(self: Journal, name: str, events: int) -> None:
        attempts.append(name)
        if name == "cap_00002.pcapng" and attempts.count(name) == 1:
            raise sqlite3.OperationalError("database is locked")
        real_mark(self, name, events)

    monkeypatch.setattr(Journal, "mark_capture_ingested", mark_second_file_once_locked)
    monkeypatch.setattr(cli.time, "sleep", lambda seconds: None)

    result = runner.invoke(
        app, ["ingest-dir", "--dir", str(directory), "--db", str(db), "--min-age-seconds", "0"]
    )

    assert result.exit_code == 0, result.output
    assert attempts == ["cap_00001.pcapng", "cap_00002.pcapng", "cap_00002.pcapng"]
    journal = Journal(db)
    marked = dict(journal.conn.execute("select name, events from ingested_captures").fetchall())
    commands = dict(
        journal.conn.execute(
            "select source_command, count(1) from raw_observations group by 1"
        ).fetchall()
    )
    journal.close()
    assert marked == {"cap_00001.pcapng": 0, "cap_00002.pcapng": 1}
    assert commands == {"al.rank": 1}


def test_a_reconnect_on_the_same_port_is_not_mistaken_for_a_retransmission() -> None:
    """A table that outlives files also outlives connections. When the client
    reconnects and reuses its port, the new connection's sequence numbers
    start wherever its ISN fell; below the old position, every segment used
    to read as a retransmission and be dropped — for good, since each one
    still counted as traffic and kept the stream from being pruned."""
    wire = frame(ENVELOPE)
    stream = TCPDirectionReassembler()
    assert len(stream.feed(50_000_000, wire)) == 1
    # Same bytes again, just behind: a retransmission, and ignored.
    assert stream.feed(50_000_000, wire) == []
    # Far behind: a new connection. Its first frame decodes.
    assert len(stream.feed(1_000, wire)) == 1
    assert stream.next_sequence == 1_000 + len(wire)


def test_streams_quiet_for_too_long_are_dropped(tmp_path: Path) -> None:
    """The table must not grow with every connection the machine ever
    opened, and a stream that has stopped must not keep a half-frame
    buffered forever. The packet clock, not the wall clock, decides —
    a backlog replayed at speed is still consecutive traffic."""
    first, second = _split_response(tmp_path, at_seconds=1_000)
    streams: StreamTable = {}
    list(iter_extension_events(first, streams=streams))
    assert len(streams) == 1

    # Not yet idle: the half-frame is kept and completes.
    dropped = prune_idle_streams(
        streams, now=datetime.fromtimestamp(1_000 + 60, tz=UTC), idle_seconds=300
    )
    assert dropped == 0
    assert [e.command for e in iter_extension_events(second, streams=streams)] == ["al.rank"]

    # Idle past the window: gone, and a later file starts that stream afresh.
    dropped = prune_idle_streams(
        streams, now=datetime.fromtimestamp(1_000 + 1 + 301, tz=UTC), idle_seconds=300
    )
    assert dropped == 1
    assert streams == {}
