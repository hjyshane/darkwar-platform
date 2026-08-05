"""A session counts what it caused, not what happened to be written during it.

The interesting case is the same one that made the routine runner report eight
alliances when it had opened two: the capture ring closes a file every 60s, so
packets from before a session reach the journal while it is open. Counting
those would credit the session with the previous minute of somebody else's
play — and the whole point of the receipt is that its numbers can be trusted.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dw_collector.console import session
from dw_collector.models import Observation
from dw_collector.storage.journal import Journal


def _journal(tmp_path: Path) -> Journal:
    j = Journal(tmp_path / "j.db")
    j.init_db()
    return j


def _record(journal: Journal, command: str, captured_at: datetime) -> None:
    journal.record(
        Observation(
            observation_id=uuid.uuid4(),
            collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c777"),
            source_command=command,
            captured_at=captured_at,
            collected_from_server_id=580,
            payload={},
        ),
        [],
    )


def test_no_journal_means_no_session(tmp_path: Path) -> None:
    """Starting against a collector that has never run would count nothing and
    then report success for it."""
    assert session.start(tmp_path / "missing.db") is None


def test_counts_group_by_command(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    started = session.start(tmp_path / "j.db")
    assert started is not None

    now = datetime.now(tz=UTC)
    _record(journal, "al.rank", now)
    _record(journal, "al.rank", now)
    _record(journal, "get.new.user.info", now)

    assert session.counts(started) == {"al.rank": 2, "get.new.user.info": 1}


def test_a_capture_from_before_the_session_is_not_counted(tmp_path: Path) -> None:
    """Written during, sent before. The ring's delay makes this ordinary
    rather than exotic: at 60s rotation, every session's first minute of rows
    is somebody else's."""
    journal = _journal(tmp_path)
    started = session.start(tmp_path / "j.db")
    assert started is not None

    _record(journal, "stale.command", started.started_at - timedelta(minutes=5))
    _record(journal, "mine.command", datetime.now(tz=UTC))

    counted = session.counts(started)
    assert counted == {"mine.command": 1}
    assert "stale.command" not in counted


def test_rows_written_before_the_session_are_not_counted(tmp_path: Path) -> None:
    """The other bound. Both are needed: this row is old by rowid, the one
    above is old by wire time, and neither test catches the other's case."""
    journal = _journal(tmp_path)
    _record(journal, "earlier.command", datetime.now(tz=UTC))

    started = session.start(tmp_path / "j.db")
    assert started is not None
    _record(journal, "later.command", datetime.now(tz=UTC))

    assert session.counts(started) == {"later.command": 1}
