"""The console's readings, without a display.

Everything the window shows comes from here, and the rule is that it is
read rather than remembered: collection was down for 18.7 hours while
three scheduled tasks sat in Ready, and any status derived from "we
started it earlier" would have said healthy the whole time.
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dw_collector.console import state
from dw_collector.models import Observation
from dw_collector.storage.journal import Journal


def _observation(command: str = "al.rank") -> Observation:
    return Observation(
        observation_id=uuid.uuid4(),
        collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c001"),
        source_command=command,
        captured_at=datetime.now(tz=UTC),
        collected_from_server_id=580,
        payload={},
    )


def test_a_missing_journal_is_reported_not_raised(tmp_path: Path) -> None:
    reading = state.journal_state(tmp_path / "nope.db")

    assert reading.exists is False
    assert reading.observations == 0
    assert reading.seconds_since_last is None


def test_a_journal_that_is_not_ours_does_not_crash_the_window(tmp_path: Path) -> None:
    # An empty or foreign SQLite file has no raw_observations. The console
    # has to keep running: it is the thing you open when something is wrong.
    path = tmp_path / "other.db"
    sqlite3.connect(path).close()

    reading = state.journal_state(path)

    assert reading.exists is True
    assert reading.observations == 0


def test_counts_and_freshness_come_from_the_journal(tmp_path: Path) -> None:
    path = tmp_path / "journal.db"
    journal = Journal(path)
    journal.init_db()
    journal.record(_observation("al.rank"), [])
    journal.record(_observation("server.rank"), [])
    journal.close()

    reading = state.journal_state(path)

    assert reading.observations == 2
    assert reading.commands == 2
    age = reading.seconds_since_last
    assert age is not None and age < 60


def test_freshness_is_none_rather_than_zero_when_nothing_arrived(tmp_path: Path) -> None:
    # Zero would read as "just now", which is the opposite of the truth and
    # exactly the reading that would have hidden the 18.7 hours.
    path = tmp_path / "empty.db"
    journal = Journal(path)
    journal.init_db()
    journal.close()

    assert state.journal_state(path).seconds_since_last is None


def test_seconds_since_last_grows_with_a_stale_journal(tmp_path: Path) -> None:
    path = tmp_path / "stale.db"
    journal = Journal(path)
    journal.init_db()
    journal.record(_observation(), [])
    long_ago = (datetime.now(tz=UTC) - timedelta(hours=3)).isoformat()
    journal.conn.execute("update raw_observations set created_at = ?", (long_ago,))
    journal.conn.commit()
    journal.close()

    age = state.journal_state(path).seconds_since_last

    assert age is not None and age > 3 * 3600 - 60


def test_the_collector_instance_is_named_not_guessed() -> None:
    # Four BlueStacks instances are installed on this machine and one is the
    # main account. guard.py refuses to pick a device for automation; a
    # button a person clicks has the same obligation.
    assert state.COLLECTOR_INSTANCE == "Pie64_3"
    assert state.COLLECTOR_SERIAL == "emulator-5584"

    import inspect

    source = inspect.getsource(state.start_emulator)
    assert "COLLECTOR_INSTANCE" in source
    assert "--instance" in source
