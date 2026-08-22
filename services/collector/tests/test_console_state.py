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
    assert state.COLLECTOR_WINDOW == "collector"

    import inspect

    source = inspect.getsource(state.start_emulator)
    assert "COLLECTOR_INSTANCE" in source
    assert "--instance" in source


def test_no_adb_endpoint_is_hardcoded_anywhere() -> None:
    # The bug this replaced: emulator-5584 / 127.0.0.1:5585 were written down,
    # BlueStacks moved the instance to 5586, and every reading said the game
    # was stopped while it was running and being captured.
    #
    # String LITERALS only, via the AST. The comments deliberately name those
    # ports to explain the failure, and a grep would fail on the explanation
    # rather than on a relapse.
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(state))
    literals = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant)]
    literals = [v for v in literals if isinstance(v, str)]
    for text in literals:
        assert "emulator-55" not in text, f"a serial is pinned again: {text!r}"
        assert "127.0.0.1:55" not in text, f"a port is pinned again: {text!r}"


class _Adb:
    """Stands in for HD-Adb.exe. Records what was asked, answers as told."""

    def __init__(self, answers: dict[tuple[str, ...], tuple[int, str, str]]) -> None:
        self.answers = answers
        self.calls: list[tuple[str, ...]] = []

    def __call__(self, argv: list[str], timeout: float = 20.0):  # type: ignore[no-untyped-def]
        import subprocess

        key = tuple(a for a in argv[1:] if not a.endswith(".exe"))
        self.calls.append(key)
        code, out, err = self.answers.get(key, (0, "", ""))
        return subprocess.CompletedProcess(argv, code, out, err)


def _install(monkeypatch, tmp_path, adb: _Adb, ports: list[int], pid: int | None = 4242) -> None:  # type: ignore[no-untyped-def]
    fake_adb = tmp_path / "HD-Adb.exe"
    fake_adb.write_text("", encoding="utf-8")
    monkeypatch.setattr(state, "HD_ADB", fake_adb)
    monkeypatch.setattr(state, "_run", adb)
    monkeypatch.setattr(state, "_hd_player_pid", lambda title=None: pid)
    monkeypatch.setattr(state, "_listening_ports", lambda _pid: ports)
    state._clear_adb_target()


def test_the_endpoint_is_the_port_that_answers_not_the_first_one(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    # The real failure: 5585 LISTENS and reports "connected to 127.0.0.1:5585"
    # while staying offline forever. Only the handshake separates them.
    adb = _Adb(
        {
            ("connect", "127.0.0.1:5585"): (0, "connected to 127.0.0.1:5585", ""),
            ("-s", "127.0.0.1:5585", "shell", "echo", "ok"): (1, "", "error: device offline"),
            ("connect", "127.0.0.1:5586"): (0, "connected to 127.0.0.1:5586", ""),
            ("-s", "127.0.0.1:5586", "shell", "echo", "ok"): (0, "ok", ""),
        }
    )
    _install(monkeypatch, tmp_path, adb, ports=[5585, 5586])

    assert state.collector_adb_target() == "127.0.0.1:5586"


def test_a_running_game_reads_as_running(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    adb = _Adb(
        {
            ("-s", "127.0.0.1:5586", "shell", "echo", "ok"): (0, "ok", ""),
            ("-s", "127.0.0.1:5586", "shell", "pidof", state.GAME_PACKAGE): (0, "4143", ""),
        }
    )
    _install(monkeypatch, tmp_path, adb, ports=[5586])

    assert state.game_state() == "running"


def test_a_genuinely_closed_game_reads_as_stopped(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    # pidof exits 1 with no output when the process is simply not there.
    adb = _Adb(
        {
            ("-s", "127.0.0.1:5586", "shell", "echo", "ok"): (0, "ok", ""),
            ("-s", "127.0.0.1:5586", "shell", "pidof", state.GAME_PACKAGE): (1, "", ""),
        }
    )
    _install(monkeypatch, tmp_path, adb, ports=[5586])

    assert state.game_state() == "stopped"


def test_an_unreachable_emulator_does_not_read_as_stopped(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    # THE BUG, as a test. Every port refuses the handshake; the answer must
    # be "I could not ask", never "the game is not running".
    adb = _Adb(
        {
            ("connect", "127.0.0.1:5585"): (0, "connected to 127.0.0.1:5585", ""),
            ("-s", "127.0.0.1:5585", "shell", "echo", "ok"): (1, "", "error: device offline"),
        }
    )
    _install(monkeypatch, tmp_path, adb, ports=[5585])

    assert state.game_state() == "unreachable"


def test_a_moved_port_is_picked_up_without_a_restart(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    # Cache the old endpoint, then move the instance. The next reading has to
    # re-resolve on its own - a console that needs restarting to notice is
    # how the stale port went unseen for so long.
    adb = _Adb(
        {
            ("connect", "127.0.0.1:5586"): (0, "connected", ""),
            ("-s", "127.0.0.1:5586", "shell", "echo", "ok"): (0, "ok", ""),
            ("-s", "127.0.0.1:5586", "shell", "pidof", state.GAME_PACKAGE): (0, "4143", ""),
        }
    )
    _install(monkeypatch, tmp_path, adb, ports=[5586])
    assert state.game_state() == "running"

    moved = _Adb(
        {
            ("-s", "127.0.0.1:5586", "shell", "pidof", state.GAME_PACKAGE): (
                1,
                "",
                "error: device '127.0.0.1:5586' not found",
            ),
            ("connect", "127.0.0.1:5590"): (0, "connected", ""),
            ("-s", "127.0.0.1:5590", "shell", "echo", "ok"): (0, "ok", ""),
            ("-s", "127.0.0.1:5590", "shell", "pidof", state.GAME_PACKAGE): (0, "4143", ""),
        }
    )
    monkeypatch.setattr(state, "_run", moved)
    monkeypatch.setattr(state, "_listening_ports", lambda _pid: [5590])

    assert state.game_state() == "running"
    assert state.collector_adb_target() == "127.0.0.1:5590"


# --- pipeline timings -------------------------------------------------------


def _wrappers(directory: Path, rotation: int, min_age: int, poll: int) -> None:
    """What register-tasks.ps1 leaves in $ScriptDir, near enough to parse."""
    (directory / "run-Capture.cmd").write_text(
        "@echo off\n"
        + r'"C:\Program Files\Wireshark\dumpcap.exe" -i "\Device\NPF_{X}" -f "tcp port 8680" '
        + r'-w "C:\DW_data\live\cap.pcapng" '
        + f"-b duration:{rotation} -b files:1440 -B 64 "
        + r'>> "C:\DW_data\logs\capture.log" 2>&1'
        + "\n",
        encoding="utf-8",
    )
    (directory / "run-Ingest.cmd").write_text(
        "@echo off\n"
        + r'"uv.exe" run --no-sync dw-collector ingest-dir --dir "C:\DW_data\live" '
        + f"--min-age-seconds {min_age} --interval-seconds {poll}\n",
        encoding="utf-8",
    )


def test_the_everyday_timings_read_back_as_not_sweeping(tmp_path: Path) -> None:
    _wrappers(tmp_path, rotation=60, min_age=20, poll=30)

    reading = state.pipeline_timings(tmp_path, registered=True)

    assert reading.known is True
    assert reading.rotation != 15
    assert reading.worst_case == 110


def test_the_sweep_timings_read_back_as_sweeping(tmp_path: Path) -> None:
    _wrappers(tmp_path, rotation=15, min_age=5, poll=10)

    reading = state.pipeline_timings(tmp_path, registered=True)

    assert reading.rotation == 15
    assert reading.worst_case == 30


def test_no_registered_tasks_reads_as_unknown_not_as_everyday(tmp_path: Path) -> None:
    # The distinction the window depends on. An absent wrapper means nobody
    # has registered the tasks on this machine; reporting that as the default
    # mode would put a latency figure on screen for a collector that is not
    # running at all.
    reading = state.pipeline_timings(tmp_path, registered=True)

    assert reading.known is False
    assert reading.rotation != 15
    assert reading.worst_case is None


def test_a_half_written_wrapper_pair_does_not_invent_a_worst_case(tmp_path: Path) -> None:
    (tmp_path / "run-Capture.cmd").write_text("-b duration:15 -b files:5760", encoding="utf-8")

    reading = state.pipeline_timings(tmp_path, registered=True)

    assert reading.rotation == 15
    # Rotation alone is not the answer, and printing it as one would be wrong
    # by the two terms that are missing.
    assert reading.worst_case is None


def test_a_stale_wrapper_is_not_a_running_pipeline(tmp_path: Path) -> None:
    # 22 August: a failed sweep toggle unregistered all four tasks and left the
    # wrappers untouched, so the window went on reporting "sweep, ~30s worst
    # case" for a pipeline that was not running at all. The wrappers say at
    # what timings, never whether anything is running.
    _wrappers(tmp_path, rotation=15, min_age=5, poll=10)

    reading = state.pipeline_timings(tmp_path, registered=False)

    assert reading.known is False
    assert reading.rotation != 15
    assert reading.worst_case is None


def test_registered_tasks_do_read_their_wrappers(tmp_path: Path) -> None:
    _wrappers(tmp_path, rotation=15, min_age=5, poll=10)

    reading = state.pipeline_timings(tmp_path, registered=True)

    assert reading.rotation == 15
    assert reading.worst_case == 30
