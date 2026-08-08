"""Reading a capture directory, which is how continuous collection runs.

dw-capture keeps one reassembler for the life of the process, and when a
stream wedges it goes quiet while still looking healthy — measured: the
journal stopped at the second login and stayed there for 253 seconds while
18KB crossed the wire. Reading files gives every file a fresh reassembler,
so that failure is bounded to one file.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from typer.testing import CliRunner

from dw_collector.cli import _ready_captures, app
from dw_collector.storage.journal import Journal

runner = CliRunner()

REAL_CAPTURE = Path(r"C:\darkwar-adb\darkwar_alrank.pcapng")


def _touch(path: Path, *, age_seconds: float) -> Path:
    path.write_bytes(b"not a real capture")
    when = time.time() - age_seconds
    os.utime(path, (when, when))
    return path


def test_the_file_still_being_written_is_left_alone(tmp_path: Path) -> None:
    # dumpcap's newest ring file is open. Reading it would ingest a
    # truncated tail and then mark it done, losing the rest for good.
    _touch(tmp_path / "old.pcapng", age_seconds=600)
    _touch(tmp_path / "current.pcapng", age_seconds=1)

    ready = _ready_captures(tmp_path, minimum_age_seconds=30)

    assert [p.name for p in ready] == ["old.pcapng"]


def test_a_file_deleted_mid_scan_does_not_kill_the_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The ring deletes its oldest file on every rotation once it is full,
    and this directory is rescanned every 30 seconds, so a file vanishing
    between the listing and the stat is normal rather than exceptional.

    It used to raise FileNotFoundError, and `_ready_captures` runs OUTSIDE
    the per-file `try` in the loop — so the whole process died. A collector
    that goes quiet once its ring fills is the failure `ingest-dir` exists
    to avoid. Found by a manual cleanup; the ring would have got there on
    its own about a day later.
    """
    _touch(tmp_path / "keep-a.pcapng", age_seconds=300)
    doomed = _touch(tmp_path / "doomed.pcapng", age_seconds=200)
    _touch(tmp_path / "keep-b.pcapng", age_seconds=100)

    real_stat = Path.stat

    def vanishing(self: Path, *args: object, **kwargs: object) -> os.stat_result:
        if self.name == doomed.name:
            raise FileNotFoundError(2, "The system cannot find the file specified")
        return real_stat(self, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(Path, "stat", vanishing)

    ready = _ready_captures(tmp_path, minimum_age_seconds=30)

    # The survivors are still returned, still in order. Skipping the whole
    # scan would be almost as bad as crashing: the files that are there go
    # unread until the next poll, every poll.
    assert [p.name for p in ready] == ["keep-a.pcapng", "keep-b.pcapng"]


def test_files_are_offered_oldest_first(tmp_path: Path) -> None:
    # Order matters for reassembly across nothing, but it does matter for
    # captured_at ordering in the journal and for reading a ring in the
    # order it was written.
    _touch(tmp_path / "c.pcapng", age_seconds=100)
    _touch(tmp_path / "a.pcapng", age_seconds=300)
    _touch(tmp_path / "b.pcapng", age_seconds=200)

    ready = _ready_captures(tmp_path, minimum_age_seconds=30)

    assert [p.name for p in ready] == ["a.pcapng", "b.pcapng", "c.pcapng"]


def test_non_captures_are_ignored(tmp_path: Path) -> None:
    _touch(tmp_path / "keep.pcapng", age_seconds=600)
    _touch(tmp_path / "notes.txt", age_seconds=600)
    _touch(tmp_path / "old-style.pcap", age_seconds=600)

    ready = _ready_captures(tmp_path, minimum_age_seconds=30)

    assert [p.name for p in ready] == ["keep.pcapng"]


def test_a_second_run_does_not_re_read_the_ring(tmp_path: Path) -> None:
    # A 24-hour ring is 288 files. Re-reading them every poll would be most
    # of the work, even though re-ingesting is harmless in itself.
    directory = tmp_path / "captures"
    directory.mkdir()
    _touch(directory / "cap_00001.pcapng", age_seconds=600)
    db = tmp_path / "journal.db"

    first = runner.invoke(app, ["ingest-dir", "--dir", str(directory), "--db", str(db)])
    second = runner.invoke(app, ["ingest-dir", "--dir", str(directory), "--db", str(db)])

    assert first.exit_code == 0, first.output
    assert second.exit_code == 0, second.output
    assert "done: 1 file(s)" in first.output
    assert "done: 0 file(s)" in second.output
    assert "cap_00001.pcapng" in first.output


def test_one_unreadable_file_does_not_stop_the_others(tmp_path: Path) -> None:
    # A collector that stops on the first bad capture is exactly the failure
    # this command exists to escape, so the bad file has to cost one window
    # and nothing more.
    directory = tmp_path / "captures"
    directory.mkdir()
    _touch(directory / "a_junk.pcapng", age_seconds=600)
    _touch(directory / "b_junk.pcapng", age_seconds=500)
    db = tmp_path / "journal.db"

    result = runner.invoke(app, ["ingest-dir", "--dir", str(directory), "--db", str(db)])

    assert result.exit_code == 0, result.output
    assert "UNREADABLE" in result.output
    assert "done: 2 file(s)" in result.output


def test_an_unreadable_file_is_not_retried_forever(tmp_path: Path) -> None:
    # A truncated file never becomes valid. Retrying it every poll would
    # lose everything after it rather than just that window.
    directory = tmp_path / "captures"
    directory.mkdir()
    _touch(directory / "junk.pcapng", age_seconds=600)
    db = tmp_path / "journal.db"

    runner.invoke(app, ["ingest-dir", "--dir", str(directory), "--db", str(db)])
    second = runner.invoke(app, ["ingest-dir", "--dir", str(directory), "--db", str(db)])

    assert "done: 0 file(s)" in second.output


def test_a_real_capture_yields_its_roster(tmp_path: Path) -> None:
    # The value this whole path exists to produce. Skipped where the capture
    # is absent, because it holds a UID and session signature and stays out
    # of the repo.
    if not REAL_CAPTURE.exists():
        return

    directory = tmp_path / "captures"
    directory.mkdir()
    target = directory / REAL_CAPTURE.name
    target.write_bytes(REAL_CAPTURE.read_bytes())
    when = time.time() - 600
    os.utime(target, (when, when))
    db = tmp_path / "journal.db"

    result = runner.invoke(app, ["ingest-dir", "--dir", str(directory), "--db", str(db)])

    assert result.exit_code == 0, result.output
    journal = Journal(db)
    tables = dict(
        journal.conn.execute(
            "select target_table, count(1) from normalized_rows group by 1"
        ).fetchall()
    )
    journal.close()
    assert tables.get("alliance_member_snapshots") == 93
