"""The journal's thread rule, both halves of it.

dw-capture writes from SegmentPump's worker while the connection is opened
on the thread that starts the process. sqlite3 rejects that by default,
and the first version of the pump hit exactly this — loudly, which was the
design working, but it still meant zero observations for a whole run.
"""

from __future__ import annotations

import sqlite3
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

from dw_collector.models import Observation
from dw_collector.storage.journal import Journal


def _observation() -> Observation:
    return Observation(
        observation_id=uuid.uuid4(),
        collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c001"),
        source_command="al.rank",
        captured_at=datetime(2026, 8, 4, tzinfo=UTC),
        collected_from_server_id=580,
        payload={},
    )


def test_another_thread_is_refused_by_default(tmp_path: Path) -> None:
    # The default has to stay strict: anything that grows a second writer
    # should get the error rather than a corrupt database.
    journal = Journal(tmp_path / "strict.db")
    journal.init_db()
    caught: list[BaseException] = []

    def write() -> None:
        try:
            journal.conn.execute("select count(1) from raw_observations")
        except BaseException as exc:
            caught.append(exc)

    worker = threading.Thread(target=write)
    worker.start()
    worker.join(timeout=5)
    journal.close()

    assert caught and isinstance(caught[0], sqlite3.ProgrammingError)


def test_the_opt_in_allows_the_worker_that_actually_writes(tmp_path: Path) -> None:
    journal = Journal(tmp_path / "pumped.db", single_writer_thread=True)
    journal.init_db()
    errors: list[BaseException] = []

    def write() -> None:
        try:
            journal.record(_observation(), [])
        except BaseException as exc:
            errors.append(exc)

    worker = threading.Thread(target=write)
    worker.start()
    worker.join(timeout=5)

    assert not errors
    assert journal.command_counts() == [("al.rank", 1)]
    journal.close()


def test_the_capture_entrypoint_opts_in(tmp_path: Path) -> None:
    # A regression guard with a specific failure in mind: if dw-capture ever
    # goes back to the default, it journals nothing and says so only in a
    # traceback nobody reads until the data is missing.
    source = (
        Path(__file__).resolve().parents[1] / "src" / "dw_collector" / "capture" / "__main__.py"
    ).read_text(encoding="utf-8")

    assert "single_writer_thread=True" in source


@pytest.mark.parametrize("opt_in", [False, True])
def test_the_owning_thread_always_works(tmp_path: Path, opt_in: bool) -> None:
    journal = Journal(tmp_path / f"same-{opt_in}.db", single_writer_thread=opt_in)
    journal.init_db()
    journal.record(_observation(), [])

    assert journal.command_counts() == [("al.rank", 1)]
    journal.close()
