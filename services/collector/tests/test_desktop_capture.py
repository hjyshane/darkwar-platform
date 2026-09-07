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

import subprocess
import sys
import time
from pathlib import Path

import pytest

from dw_collector.desktop import capture

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
