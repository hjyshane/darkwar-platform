"""A locked journal is waited out, never skipped.

On 2026-11-19 ingest-dir was seven minutes behind under a map sweep while
dw-sync drained 1,000-row batches into the same journal. One write waited
sqlite3's default five seconds for dw-sync's lock, raised `database is
locked` out of `Journal.record`, out of the poll loop and out of the
process, and the scheduled task never restarted it: sixteen hours of a
Frankie event never reached the dashboard.

Two layers, tested separately. The connection waits a minute instead of
five seconds; and a lock that outlasts even that is retried on the SAME
file, which is never marked done or deleted while it is unrecorded.
"""

from __future__ import annotations

import sqlite3
import struct
import threading
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from typer.testing import CliRunner, Result

from dw_collector import cli
from dw_collector.cli import app
from dw_collector.models import Observation
from dw_collector.normalize import al_rank
from dw_collector.protocol.linklayer import LINKTYPE_NULL
from dw_collector.storage import journal as journal_module
from dw_collector.storage.journal import BUSY_TIMEOUT_SECONDS, Journal, is_locked
from dw_collector.sync.__main__ import CATCH_UP_DELAY, drain_step
from tests.conftest import load_observation
from tests.test_capture_formats import _classic, _game_ipv4
from tests.test_sync_worker import FakeSupabase, _worker

runner = CliRunner()


def _observation() -> Observation:
    return Observation(
        observation_id=uuid.uuid4(),
        collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c001"),
        source_command="al.rank",
        captured_at=datetime(2026, 11, 19, 1, 45, tzinfo=UTC),
        collected_from_server_id=580,
        payload={},
    )


@pytest.fixture
def db(tmp_path: Path) -> Path:
    path = tmp_path / "journal.db"
    journal = Journal(path)
    journal.init_db()
    journal.close()
    return path


@pytest.fixture
def blocker(db: Path) -> Iterator[sqlite3.Connection]:
    """A second connection holding the journal's write lock, the way dw-sync
    holds it while it marks a batch sent. Usable from a timer thread."""
    conn = sqlite3.connect(db, isolation_level=None, check_same_thread=False)
    conn.execute("begin immediate")
    yield conn
    if conn.in_transaction:
        conn.execute("rollback")
    conn.close()


# --- the connection ------------------------------------------------------------


def test_the_journal_waits_a_minute_for_a_lock_not_five_seconds(db: Path) -> None:
    # sqlite3's own default is 5s, which is what ran out on 11-19.
    journal = Journal(db)
    try:
        waits_ms = journal.conn.execute("pragma busy_timeout").fetchone()[0]
    finally:
        journal.close()

    assert BUSY_TIMEOUT_SECONDS >= 30
    assert waits_ms == int(BUSY_TIMEOUT_SECONDS * 1000)


def test_a_write_waits_for_another_connections_lock_to_clear(
    db: Path, blocker: sqlite3.Connection
) -> None:
    journal = Journal(db, busy_timeout=10)
    release = threading.Timer(0.3, lambda: blocker.execute("commit"))
    try:
        started = time.monotonic()
        release.start()
        result = journal.record(_observation(), [])
        waited = time.monotonic() - started
        release.join()

        assert result.raw_inserted
        # It really was held up, and then went through rather than raising.
        assert waited >= 0.2
        assert journal.command_counts() == [("al.rank", 1)]
    finally:
        release.cancel()
        journal.close()


def test_a_lock_outlasting_the_wait_raises_a_lock_and_writes_nothing(
    db: Path, blocker: sqlite3.Connection
) -> None:
    journal = Journal(db, busy_timeout=0.05)
    observation = _observation()
    try:
        with pytest.raises(sqlite3.OperationalError) as caught:
            journal.record(observation, [])

        assert is_locked(caught.value)
        blocker.execute("commit")
        # All or nothing (FR-COL-004), so the retry has nothing to undo...
        assert journal.command_counts() == []
        # ...and the same write goes through once the other writer is done.
        assert journal.record(observation, []).raw_inserted
        assert journal.command_counts() == [("al.rank", 1)]
    finally:
        journal.close()


def test_only_a_lock_counts_as_locked() -> None:
    # Retrying a full disk or a missing table forever would hide it.
    conn = sqlite3.connect(":memory:")
    with pytest.raises(sqlite3.OperationalError) as missing:
        conn.execute("select * from nowhere")
    conn.close()

    assert not is_locked(missing.value)
    assert not is_locked(sqlite3.OperationalError("disk I/O error"))
    assert not is_locked(ValueError("database is locked"))
    assert is_locked(sqlite3.OperationalError("database is locked"))
    assert is_locked(sqlite3.OperationalError("database table is locked"))


# --- ingest-dir ------------------------------------------------------------------


def _capture(path: Path) -> Path:
    """One readable file holding one game response."""
    path.write_bytes(_classic([struct.pack("<I", 2) + _game_ipv4()], LINKTYPE_NULL))
    return path


def _ingest(directory: Path, db: Path, *extra: str) -> Result:
    return runner.invoke(
        app,
        ["ingest-dir", "--dir", str(directory), "--db", str(db), "--min-age-seconds", "0", *extra],
    )


def _marked(db: Path) -> dict[str, int]:
    conn = sqlite3.connect(db)
    try:
        return dict(conn.execute("select name, events from ingested_captures").fetchall())
    finally:
        conn.close()


def test_ingest_dir_waits_out_a_lock_and_then_ingests_the_same_file(
    tmp_path: Path, db: Path, blocker: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The incident, with a real lock: another connection holds the journal,
    the write gives up, and the loop must neither exit nor move on."""
    directory = tmp_path / "live"
    directory.mkdir()
    first = _capture(directory / "cap_06135_20261118203842.pcap")
    _capture(directory / "cap_06136_20261118203857.pcap")
    monkeypatch.setattr(journal_module, "BUSY_TIMEOUT_SECONDS", 0.05)

    waits: list[float] = []
    seen_while_locked: list[tuple[dict[str, int], bool]] = []

    def backoff(seconds: float) -> None:
        waits.append(seconds)
        seen_while_locked.append((_marked(db), first.exists()))
        if len(waits) == 2:
            blocker.execute("commit")  # dw-sync finishes its batch

    monkeypatch.setattr(cli.time, "sleep", backoff)

    result = _ingest(directory, db, "--delete-ingested")

    assert result.exit_code == 0, result.output
    assert "LOCKED" in result.output
    assert "done: 2 file(s)" in result.output
    # Retried, with a growing wait, until the lock cleared.
    assert waits == [1.0, 2.0]
    # While it was locked, nothing was marked done and nothing was deleted:
    # that is the difference between a late file and a lost one.
    assert seen_while_locked == [({}, True), ({}, True)]
    # Then both went in with their events — not marked with 0, not skipped.
    assert _marked(db) == {
        "cap_06135_20261118203842.pcap": 1,
        "cap_06136_20261118203857.pcap": 1,
    }
    assert not first.exists()


def test_a_lock_on_the_mark_itself_is_retried_too(
    tmp_path: Path, db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The mark used to sit outside every `try` in the loop.
    directory = tmp_path / "live"
    directory.mkdir()
    _capture(directory / "cap_00001.pcap")
    real_mark = Journal.mark_capture_ingested
    attempts: list[str] = []

    def mark_once_locked(self: Journal, name: str, events: int) -> None:
        attempts.append(name)
        if len(attempts) == 1:
            raise sqlite3.OperationalError("database is locked")
        real_mark(self, name, events)

    monkeypatch.setattr(Journal, "mark_capture_ingested", mark_once_locked)
    monkeypatch.setattr(cli.time, "sleep", lambda seconds: None)

    result = _ingest(directory, db)

    assert result.exit_code == 0, result.output
    assert attempts == ["cap_00001.pcap", "cap_00001.pcap"]
    assert _marked(db) == {"cap_00001.pcap": 1}


def test_a_database_error_that_is_not_a_lock_exits_and_leaves_the_file_unmarked(
    tmp_path: Path, db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Waiting does not cure a full disk, so this one exits for the scheduled
    # task to restart — but the file is not the problem either, and it must
    # still be there, unmarked, for the next start to read.
    directory = tmp_path / "live"
    directory.mkdir()
    capture = _capture(directory / "cap_00001.pcap")

    def broken(self: Journal, *args: object) -> None:
        raise sqlite3.OperationalError("database or disk is full")

    monkeypatch.setattr(Journal, "record", broken)

    result = _ingest(directory, db, "--delete-ingested")

    assert result.exit_code != 0
    assert isinstance(result.exception, sqlite3.OperationalError)
    assert _marked(db) == {}
    assert capture.exists()


# --- dw-sync ---------------------------------------------------------------------


def test_dw_sync_skips_a_locked_drain_and_resends_on_the_next(
    db: Path, blocker: sqlite3.Connection
) -> None:
    """The same lock with the roles swapped: ingest holds it while sync tries
    to mark a batch sent. The rows already went up, so the drain must not
    die and must not lose them — they stay pending and go again."""
    journal = Journal(db, busy_timeout=0.05)
    blocker.execute("commit")  # the fixture's lock is taken mid-drain below
    roster = load_observation("al.rank/cbfw_roster_v1.json")
    journal.record(roster, al_rank.normalize(roster))
    fake = FakeSupabase()
    snapshot_posts: list[int] = []
    real_handler = fake.handler

    def ingest_grabs_the_lock(request: httpx.Request) -> httpx.Response:
        response = real_handler(request)
        if request.method == "POST" and "alliance_member_snapshots" in request.url.path:
            snapshot_posts.append(1)
            if len(snapshot_posts) == 1:
                blocker.execute("begin immediate")  # ingest writes a file
        return response

    fake.handler = ingest_grabs_the_lock  # type: ignore[method-assign]
    worker = _worker(journal, fake)
    try:
        # batch=93 is exactly the roster, so a drain that got through would
        # ask to go again at once; only the lock path waits the interval.
        first = drain_step(worker, batch=93, interval=10.0)

        assert first == 10.0
        assert len(fake.upserted["alliance_member_snapshots"]) == 93
        blocker.execute("commit")  # ingest's file is in
        assert journal.outbox_counts() == {"pending": 93}

        second = drain_step(worker, batch=93, interval=10.0)

        # Sent again, and this time recorded as sent. The second copy is what
        # `ignore-duplicates` on the cloud side is for.
        assert second == CATCH_UP_DELAY
        assert len(snapshot_posts) == 2
        assert journal.outbox_counts() == {"sent": 93}
    finally:
        journal.close()


def test_dw_sync_still_stops_on_a_database_error_that_is_not_a_lock() -> None:
    class Broken:
        def drain_once(self) -> object:
            raise sqlite3.OperationalError("database disk image is malformed")

    with pytest.raises(sqlite3.OperationalError):
        drain_step(Broken(), batch=10, interval=10.0)  # type: ignore[arg-type]
