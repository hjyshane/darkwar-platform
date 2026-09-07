"""Tests for the capture supervisor: the desktop app running `dumpcap` as its
own child instead of relying on a pre-registered scheduled task.

The `ring_argv` tests below assert the WHOLE argv list, element by element.
A silently wrong `-f` filter captures nothing and dumpcap still looks
healthy — that is exactly the `check_interface` incident `desktop/adapters.py`
already documents, one layer up the stack, so a loose assertion here would
let the same shape of bug back in through a different door.

The `Supervisor` tests spawn a REAL child process, but never `dumpcap` and
never Npcap: `dumpcap` is a constructor parameter, and `build_argv` is
injected, so tests point both at `sys.executable -c "<sleep>"` instead. That
proves genuine spawn/status/stop behaviour — not a mock standing in for one —
without needing a capture-capable machine to run the suite. These tests are
skipped on non-Windows because `Supervisor.stop()` shells out to `taskkill`
and verifying a real kill here uses `tasklist`; the pure `ring_argv` tests
above run everywhere, including Linux CI.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

import pytest

from dw_collector.desktop import capture
from dw_collector.storage.journal import Journal
from tests.test_protocol import ENVELOPE, _pcapng, _tcp_packet, frame

_WINDOWS_ONLY = pytest.mark.skipif(
    sys.platform != "win32",
    reason="Supervisor spawns a real process and stops it via taskkill/tasklist",
)

# A script this test suite fully controls: sleeps long enough to observe
# "running" and "stop ends it" without racing the test, and does nothing that
# could be mistaken for real capture.
_SLEEP_SCRIPT = "import time; time.sleep(30)"


def _stub_argv(dumpcap: str, interface: str, capture_dir: Path, game_port: int) -> list[str]:
    # Ignores interface/capture_dir/game_port on purpose: this proves the
    # supervisor's spawn/status/stop mechanics, not dumpcap's own argument
    # parsing, which `test_ring_argv_*` below already covers directly.
    return [dumpcap, "-c", _SLEEP_SCRIPT]


def _stub_supervisor() -> capture.Supervisor:
    return capture.Supervisor(dumpcap=sys.executable, build_argv=_stub_argv)


def _stderr_flood_argv(marker_path: Path) -> Callable[[str, str, Path, int], list[str]]:
    """A `build_argv` whose stub writes ~320 KB to stderr — comfortably past
    a typical 64 KiB OS pipe buffer — then touches `marker_path` and sleeps.

    The marker only appears if the child's stderr writes actually complete,
    which only happens if something is draining the pipe as it fills. That
    turns "did the fix work" into a file-existence check instead of
    something that can only be observed by hanging forever.
    """
    marker = marker_path.as_posix()
    script = (
        "import sys, time\n"
        "for _ in range(8000):\n"
        "    sys.stderr.write('x' * 40 + chr(10))\n"
        "sys.stderr.flush()\n"
        f"open({marker!r}, 'w').close()\n"
        "time.sleep(30)\n"
    )

    def build_argv(dumpcap: str, interface: str, capture_dir: Path, game_port: int) -> list[str]:
        return [dumpcap, "-c", script]

    return build_argv


def _pid_alive(pid: int) -> bool:
    """Whether `pid` still exists, via `tasklist` rather than psutil."""
    result = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}"],
        capture_output=True,
        text=True,
        check=False,
    )
    return str(pid) in result.stdout


# --- ring_argv: pure, run everywhere -----------------------------------


def test_ring_argv_produces_exactly_the_expected_list() -> None:
    argv = capture.ring_argv(
        r"C:\Program Files\Wireshark\dumpcap.exe",
        r"\Device\NPF_{AAAAAAAA-0000-0000-0000-000000000001}",
        Path(r"C:\DW_data\live"),
        game_port=8680,
    )
    assert argv == [
        r"C:\Program Files\Wireshark\dumpcap.exe",
        "-i",
        r"\Device\NPF_{AAAAAAAA-0000-0000-0000-000000000001}",
        "-f",
        "tcp port 8680",
        "-w",
        r"C:\DW_data\live\cap.pcapng",
        "-b",
        "duration:15",
        "-b",
        "files:5760",
        "-B",
        "64",
    ]


def test_ring_argv_uses_the_configured_game_port_not_a_hardcoded_8680() -> None:
    argv = capture.ring_argv(
        "dumpcap.exe",
        r"\Device\NPF_test",
        Path("C:/DW_data/live"),
        game_port=9999,
    )
    assert "-f" in argv
    filter_index = argv.index("-f") + 1
    assert argv[filter_index] == "tcp port 9999"
    assert "tcp port 8680" not in argv


# --- Supervisor: real spawn, stub executable ----------------------------


@_WINDOWS_ONLY
def test_start_reports_running_and_status_agrees(tmp_path: Path) -> None:
    supervisor = _stub_supervisor()
    try:
        status = supervisor.start(r"\Device\NPF_test", tmp_path, game_port=8680)
        assert status.state == "running"
        assert status.pid is not None
        assert supervisor.status().state == "running"
        assert supervisor.status().pid == status.pid
    finally:
        supervisor.stop()


@_WINDOWS_ONLY
def test_stop_ends_it_and_the_process_is_really_gone(tmp_path: Path) -> None:
    supervisor = _stub_supervisor()
    status = supervisor.start(r"\Device\NPF_test", tmp_path, game_port=8680)
    pid = status.pid
    assert pid is not None
    assert _pid_alive(pid)

    supervisor.stop()

    assert supervisor.status().state == "stopped"
    # Poll briefly: taskkill returns before Windows has necessarily finished
    # tearing the process down.
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and _pid_alive(pid):
        time.sleep(0.2)
    assert not _pid_alive(pid)


@_WINDOWS_ONLY
def test_start_twice_does_not_spawn_a_second_process(tmp_path: Path) -> None:
    supervisor = _stub_supervisor()
    try:
        first = supervisor.start(r"\Device\NPF_test", tmp_path, game_port=8680)
        second = supervisor.start(r"\Device\NPF_test", tmp_path, game_port=8680)
        assert first.pid is not None
        assert second.pid == first.pid
    finally:
        supervisor.stop()


@_WINDOWS_ONLY
def test_start_creates_the_capture_directory_when_missing(tmp_path: Path) -> None:
    capture_dir = tmp_path / "a-player-named-this" / "live"
    assert not capture_dir.exists()
    supervisor = _stub_supervisor()
    try:
        supervisor.start(r"\Device\NPF_test", capture_dir, game_port=8680)
        assert capture_dir.is_dir()
    finally:
        supervisor.stop()


def test_stop_when_nothing_is_running_is_a_noop_not_an_error() -> None:
    supervisor = _stub_supervisor()
    supervisor.stop()  # must not raise
    assert supervisor.status().state == "stopped"


def test_start_refuses_an_empty_interface_without_spawning(tmp_path: Path) -> None:
    def fail_if_called(
        dumpcap: str, interface: str, capture_dir: Path, game_port: int
    ) -> list[str]:
        raise AssertionError("argv must never be built for an empty interface")

    supervisor = capture.Supervisor(
        dumpcap=sys.executable,
        build_argv=fail_if_called,
    )
    capture_dir = tmp_path / "unused"
    with pytest.raises(ValueError, match="interface"):
        supervisor.start("", capture_dir, game_port=8680)
    # Refusing before spawning means refusing before creating the directory
    # too - nothing about starting should have happened.
    assert not capture_dir.exists()
    assert supervisor.status().state == "stopped"


# --- Findings 1-4: stderr deadlock, concurrent start, stale/lost reason --


@_WINDOWS_ONLY
def test_start_drains_stderr_so_a_chatty_child_never_wedges(tmp_path: Path) -> None:
    """Finding 1 (CRITICAL): an unread `subprocess.PIPE` has a small OS
    buffer (~64 KiB typical); once a child fills it, the child's own
    `write()` call blocks until someone reads the other end. Before the fix,
    nothing read `stderr` until the process exited, so a child writing
    enough would block forever mid-write - never reaching the marker file
    below - while `poll()` kept returning `None` and `status()` kept saying
    "running". That is silent, permanent capture loss dressed up as health.

    Polling for the marker with a bounded deadline (not an unbounded wait)
    means a regression fails this test loudly instead of hanging the suite.
    """
    marker = tmp_path / "wrote-all-of-it"
    supervisor = capture.Supervisor(dumpcap=sys.executable, build_argv=_stderr_flood_argv(marker))
    try:
        status = supervisor.start(r"\Device\NPF_test", tmp_path, game_port=8680)
        pid = status.pid
        assert pid is not None

        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline and not marker.exists():
            time.sleep(0.2)
        assert marker.exists(), (
            "child never finished writing its stderr volume - it is wedged "
            "on a full pipe buffer, exactly the Finding 1 deadlock"
        )

        # Still alive and still reported as running: the volume did not
        # wedge the process, and status() never touched the live pipe.
        assert _pid_alive(pid)
        assert supervisor.status().state == "running"
    finally:
        supervisor.stop()


@_WINDOWS_ONLY
def test_concurrent_start_spawns_exactly_one_process(tmp_path: Path) -> None:
    """Finding 2 (CRITICAL): the check-then-act in `start()` had no lock.
    Reproduced at 8 threads calling `start()` -> 7 distinct PIDs, all
    writing to the same ring directory. Task 6 puts this Supervisor behind a
    `ThreadingHTTPServer`, where two overlapping Start requests are exactly
    this race.
    """
    supervisor = _stub_supervisor()
    thread_count = 8
    pids: list[int | None] = [None] * thread_count
    barrier = threading.Barrier(thread_count)

    def call_start(index: int) -> None:
        barrier.wait(timeout=10)
        result = supervisor.start(r"\Device\NPF_test", tmp_path, game_port=8680)
        pids[index] = result.pid

    threads = [threading.Thread(target=call_start, args=(i,)) for i in range(thread_count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)
        assert not thread.is_alive(), "a start() call never returned - possible lock deadlock"

    try:
        assert all(pid is not None for pid in pids), pids
        assert len({pid for pid in pids}) == 1, f"expected exactly one pid, got {pids}"
    finally:
        supervisor.stop()
        assert supervisor.status().state == "stopped"


@_WINDOWS_ONLY
def test_status_reports_stderr_on_every_call_after_exit(tmp_path: Path) -> None:
    """Finding 3: `status()` used to drain the live pipe itself
    (`self._process.stderr.read()`), so a second call after exit saw an
    already-empty pipe and returned "". A UI polling on a timer would watch
    the failure reason disappear on its next tick.
    """

    def build_argv(dumpcap: str, interface: str, capture_dir: Path, game_port: int) -> list[str]:
        return [dumpcap, "-c", "import sys; sys.stderr.write('boom'); sys.exit(1)"]

    supervisor = capture.Supervisor(dumpcap=sys.executable, build_argv=build_argv)
    try:
        supervisor.start(r"\Device\NPF_test", tmp_path, game_port=8680)
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline and supervisor.status().state == "running":
            time.sleep(0.1)

        first = supervisor.status()
        second = supervisor.status()
        assert first.state == "failed"
        assert "boom" in first.stderr
        assert second.state == "failed"
        assert "boom" in second.stderr
    finally:
        supervisor.stop()


@_WINDOWS_ONLY
def test_stop_after_a_crash_still_reports_failed(tmp_path: Path) -> None:
    """Finding 4: if the child already died before Stop was pressed,
    `stop()` used to clear the process reference unconditionally, so a
    following `status()` (with no intervening `status()` call - exactly a
    player pressing Stop after a crash) reported a plain "stopped" and the
    crash detail was gone.
    """

    def build_argv(dumpcap: str, interface: str, capture_dir: Path, game_port: int) -> list[str]:
        return [
            dumpcap,
            "-c",
            "import sys, time\ntime.sleep(0.3)\nsys.stderr.write('dumpcap died')\nsys.exit(1)\n",
        ]

    supervisor = capture.Supervisor(dumpcap=sys.executable, build_argv=build_argv)
    status = supervisor.start(r"\Device\NPF_test", tmp_path, game_port=8680)
    assert status.state == "running"
    pid = status.pid
    assert pid is not None

    # Let the child actually crash, with NO status() call in between - that
    # is the exact sequence Finding 4 is about.
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline and _pid_alive(pid):
        time.sleep(0.1)
    assert not _pid_alive(pid), "child never exited - test script is wrong, not the fix"

    supervisor.stop()

    final = supervisor.status()
    assert final.state == "failed"
    assert "dumpcap died" in final.stderr


# --- ingest loop: closed capture files -> journal -----------------------
#
# These exercise `_start_ingest_loop` / `_stop_ingest_loop` / `status().ingest`
# directly rather than through a real `dumpcap` child: the ingest mechanism
# itself needs no subprocess, no Windows, and no `taskkill`, so — unlike most
# of the `Supervisor` tests above — it runs on Linux CI too. One end-to-end
# test below (`test_start_and_stop_drive_the_ingest_loop_end_to_end`) proves
# the wiring through the real `start()`/`stop()` entrypoints as well, the
# same way the Finding 1-4 tests above prove their own fixes end-to-end.

_GAME_PORT = 8680


def _write_capture(path: Path, *, age_seconds: float, valid: bool) -> None:
    """A capture file `_ready_captures` will consider closed once
    `age_seconds` has elapsed. `valid=True` builds one real inbound
    `al.rank` event with the same machinery `test_protocol.py` uses to
    prove pcapng decoding — reused here rather than inventing bytes, so a
    "good" fixture in this file is provably decodable the same way theirs
    is. `valid=False` writes the same garbage `test_ingest_dir.py` already
    uses for its own "unreadable file" tests.
    """
    if valid:
        packet = _tcp_packet(frame(ENVELOPE), sport=_GAME_PORT, dport=50000, seq=1)
        path.write_bytes(_pcapng([packet]))
    else:
        path.write_bytes(b"not a real capture")
    when = time.time() - age_seconds
    os.utime(path, (when, when))


def _ingest_supervisor(
    journal_path: Path, *, poll_seconds: float = 0.05, min_age_seconds: float = 30.0
) -> capture.Supervisor:
    """A `Supervisor` configured for the ingest loop but never actually
    spawning `dumpcap` — tests call `_start_ingest_loop`/`_stop_ingest_loop`
    directly rather than `start()`/`stop()`."""
    return capture.Supervisor(
        dumpcap=sys.executable,
        build_argv=_stub_argv,
        journal_path=journal_path,
        ingest_min_age_seconds=min_age_seconds,
        ingest_poll_seconds=poll_seconds,
    )


def _wait_until(predicate: Callable[[], bool], *, timeout: float = 10.0) -> bool:
    """Poll `predicate` until it is true or `timeout` elapses. Bounded, so a
    stalled loop fails this assertion loudly instead of hanging the suite."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


def test_status_without_a_journal_path_reports_zeroed_ingest_counts() -> None:
    # Every caller of `Supervisor` before this task never passes
    # `journal_path` — the ingest loop must stay entirely inert for them.
    supervisor = _stub_supervisor()
    assert supervisor.status().ingest == capture.IngestStatus()


def test_a_ready_file_is_ingested_and_recorded(tmp_path: Path) -> None:
    capture_dir = tmp_path / "captures"
    capture_dir.mkdir()
    _write_capture(capture_dir / "cap_00001.pcapng", age_seconds=600, valid=True)
    journal_path = tmp_path / "journal.db"

    supervisor = _ingest_supervisor(journal_path)
    supervisor._start_ingest_loop(capture_dir, _GAME_PORT)
    try:
        assert _wait_until(lambda: supervisor.status().ingest.files_ingested == 1)
        status = supervisor.status()
        assert status.ingest.files_seen == 1
        assert status.ingest.files_ingested == 1
        assert status.ingest.rows_written == 1
    finally:
        supervisor._stop_ingest_loop()

    journal = Journal(journal_path)
    try:
        assert journal.ingested_captures() == {"cap_00001.pcapng"}
        rows = journal.conn.execute("select count(1) from raw_observations").fetchone()
        assert rows == (1,)
    finally:
        journal.close()


def test_running_the_loop_twice_does_not_double_count(tmp_path: Path) -> None:
    # Mirrors `test_ingest_dir.py`'s `test_a_second_run_does_not_re_read_the_ring`,
    # but for two separate ingest-loop sessions against the same journal
    # rather than two `ingest-dir` invocations.
    capture_dir = tmp_path / "captures"
    capture_dir.mkdir()
    _write_capture(capture_dir / "cap_00001.pcapng", age_seconds=600, valid=True)
    journal_path = tmp_path / "journal.db"

    first = _ingest_supervisor(journal_path)
    first._start_ingest_loop(capture_dir, _GAME_PORT)
    try:
        assert _wait_until(lambda: first.status().ingest.files_ingested == 1)
    finally:
        first._stop_ingest_loop()

    second = _ingest_supervisor(journal_path)
    second._start_ingest_loop(capture_dir, _GAME_PORT)
    try:
        # Nothing pending this time — give it several poll cycles to prove
        # that, rather than a single instantaneous check.
        time.sleep(0.3)
        assert second.status().ingest.files_ingested == 0
        assert second.status().ingest.files_seen == 0
    finally:
        second._stop_ingest_loop()

    journal = Journal(journal_path)
    try:
        rows = journal.conn.execute("select count(1) from raw_observations").fetchone()
        assert rows == (1,), "the same file must not be ingested twice across separate runs"
    finally:
        journal.close()


def test_a_file_younger_than_min_age_is_skipped(tmp_path: Path) -> None:
    capture_dir = tmp_path / "captures"
    capture_dir.mkdir()
    _write_capture(capture_dir / "current.pcapng", age_seconds=1, valid=True)
    journal_path = tmp_path / "journal.db"

    supervisor = _ingest_supervisor(journal_path, min_age_seconds=30.0)
    supervisor._start_ingest_loop(capture_dir, _GAME_PORT)
    try:
        time.sleep(0.3)  # several poll cycles at ingest_poll_seconds=0.05
        status = supervisor.status()
        assert status.ingest.files_seen == 0
        assert status.ingest.files_ingested == 0
    finally:
        supervisor._stop_ingest_loop()


def test_a_corrupt_file_does_not_stop_the_loop_and_a_good_file_still_lands(
    tmp_path: Path,
) -> None:
    capture_dir = tmp_path / "captures"
    capture_dir.mkdir()
    _write_capture(capture_dir / "a_junk.pcapng", age_seconds=600, valid=False)
    _write_capture(capture_dir / "b_good.pcapng", age_seconds=500, valid=True)
    journal_path = tmp_path / "journal.db"

    supervisor = _ingest_supervisor(journal_path)
    supervisor._start_ingest_loop(capture_dir, _GAME_PORT)
    try:
        assert _wait_until(lambda: supervisor.status().ingest.files_ingested == 1)
        status = supervisor.status()
        assert status.ingest.files_seen == 2
        assert status.ingest.files_ingested == 1
    finally:
        supervisor._stop_ingest_loop()

    journal = Journal(journal_path)
    try:
        # Both marked done — the junk file is never retried (see
        # `Supervisor._ingest_once`), and the good one landed for real.
        assert journal.ingested_captures() == {"a_junk.pcapng", "b_good.pcapng"}
        rows = journal.conn.execute("select count(1) from raw_observations").fetchone()
        assert rows == (1,)
    finally:
        journal.close()


@_WINDOWS_ONLY
def test_start_and_stop_drive_the_ingest_loop_end_to_end(tmp_path: Path) -> None:
    """The tests above call `_start_ingest_loop`/`_stop_ingest_loop`
    directly, which needs no subprocess and runs on Linux CI too. This one
    proves the same mechanism through the real public `start()`/`stop()`
    entrypoints — `start()` spawns dumpcap (stubbed) AND starts the ingest
    thread together; `stop()` ends both — the same way the Finding 1-4
    tests above prove their fixes end-to-end rather than unit-by-unit.
    """
    capture_dir = tmp_path / "captures"
    capture_dir.mkdir()
    _write_capture(capture_dir / "cap_00001.pcapng", age_seconds=600, valid=True)
    journal_path = tmp_path / "journal.db"

    supervisor = capture.Supervisor(
        dumpcap=sys.executable,
        build_argv=_stub_argv,
        journal_path=journal_path,
        ingest_poll_seconds=0.05,
    )
    try:
        status = supervisor.start(r"\Device\NPF_test", capture_dir, game_port=_GAME_PORT)
        assert status.state == "running"
        assert _wait_until(lambda: supervisor.status().ingest.files_ingested == 1)
    finally:
        supervisor.stop()

    assert supervisor.status().state == "stopped"
    assert supervisor.status().ingest.files_ingested == 1
