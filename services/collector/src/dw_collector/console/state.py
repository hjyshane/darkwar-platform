"""What is running, and is anything arriving.

Kept apart from the window so it can be tested without a display, and so
the answers stay honest: every field here is read from the machine or the
journal. Nothing is inferred from "we started it earlier".
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import webbrowser
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

TASKS = ("DarkWar-Capture", "DarkWar-Ingest", "DarkWar-Sync")

# The collector's own BlueStacks instance. Named, never guessed — the ADB
# guard refuses to pick a device for the same reason (FR-COL-001).
COLLECTOR_INSTANCE = "Pie64_3"
# The title BlueStacks puts on this instance's window. It is what the
# operator sees, and unlike the port it does not move.
COLLECTOR_WINDOW = "collector"
GAME_PACKAGE = "com.readygo.dark.gp"

# BlueStacks REASSIGNS adb ports between instances. This was pinned to
# emulator-5584 / 127.0.0.1:5585 and the collector's instance moved to 5586,
# after which every reading said the game was stopped while it was in fact
# running - the one failure this module exists to prevent. Both odd ports
# still LISTEN and still answer `adb connect` with "connected", so neither a
# port check nor a connect proves anything; only the handshake does.
#
# The instance is resolved by window title, its ports by owning PID, and the
# right one by asking it a question. Nothing here is a remembered number.
ADB_PORTS = range(5555, 5700)

BLUESTACKS_DIR = Path(r"C:\Program Files\BlueStacks_nxt")
HD_PLAYER = BLUESTACKS_DIR / "HD-Player.exe"
HD_ADB = BLUESTACKS_DIR / "HD-Adb.exe"
DOCKER_DESKTOP = Path(r"C:\Program Files\Docker\Docker\Docker Desktop.exe")

_NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW; keeps console flashes off the GUI


def _run(argv: list[str], timeout: float = 20.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        creationflags=_NO_WINDOW if os.name == "nt" else 0,
    )


@dataclass(frozen=True)
class TaskState:
    name: str
    status: str  # "Running" | "Ready" | "Unknown" | "Missing"

    @property
    def healthy(self) -> bool:
        return self.status == "Running"


def task_state(name: str) -> TaskState:
    """schtasks rather than PowerShell: one process, no shell, parseable."""
    if shutil.which("schtasks") is None:  # pragma: no cover - Windows only
        return TaskState(name, "Unknown")
    result = _run(["schtasks", "/query", "/tn", name, "/fo", "csv", "/nh"])
    if result.returncode != 0:
        return TaskState(name, "Missing")
    # "TaskName","Next Run Time","Status"
    parts = [p.strip('" ') for p in result.stdout.strip().splitlines()[-1].split('","')]
    return TaskState(name, parts[-1].strip('"') if parts else "Unknown")


def all_task_states() -> list[TaskState]:
    return [task_state(name) for name in TASKS]


@dataclass(frozen=True)
class JournalState:
    path: Path
    exists: bool
    observations: int = 0
    commands: int = 0
    pending_outbox: int = 0
    sent_outbox: int = 0
    last_observation: datetime | None = None

    @property
    def seconds_since_last(self) -> float | None:
        if self.last_observation is None:
            return None
        return (datetime.now(tz=UTC) - self.last_observation).total_seconds()


def journal_state(path: Path) -> JournalState:
    """Read-only, and tolerant: the journal may not exist yet, and it is
    being written by another process while this reads it."""
    if not path.exists():
        return JournalState(path, exists=False)
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
    except sqlite3.Error:
        return JournalState(path, exists=True)
    try:
        observations = conn.execute("select count(1) from raw_observations").fetchone()[0]
        commands = conn.execute(
            "select count(distinct source_command) from raw_observations"
        ).fetchone()[0]
        outbox = dict(
            conn.execute("select status, count(1) from sync_outbox group by 1").fetchall()
        )
        latest = conn.execute("select max(created_at) from raw_observations").fetchone()[0]
    except sqlite3.Error:
        # A table that does not exist yet is not an error worth showing; an
        # empty journal reads the same as a fresh one.
        return JournalState(path, exists=True)
    finally:
        conn.close()

    last = None
    if latest:
        try:
            last = datetime.fromisoformat(latest)
        except ValueError:
            last = None
    return JournalState(
        path=path,
        exists=True,
        observations=int(observations),
        commands=int(commands),
        pending_outbox=int(outbox.get("pending", 0)),
        sent_outbox=int(outbox.get("sent", 0)),
        last_observation=last,
    )


def emulator_running(title: str = "collector") -> bool:
    """Is the collector's own instance up? Title, because that is what the
    operator sees, and because the port mapping has been confusing enough."""
    if shutil.which("tasklist") is None:  # pragma: no cover - Windows only
        return False
    result = _run(["tasklist", "/fi", "IMAGENAME eq HD-Player.exe", "/v", "/fo", "csv"])
    return title.lower() in result.stdout.lower()


def _hd_player_pid(title: str = COLLECTOR_WINDOW) -> int | None:
    """The PID of the HD-Player window with this title.

    Title, not instance name: the launcher takes `--instance Pie64_3` but the
    running process does not carry it anywhere readable, while the title is
    both readable and the thing the operator recognises.
    """
    if shutil.which("tasklist") is None:  # pragma: no cover - Windows only
        return None
    result = _run(["tasklist", "/fi", "IMAGENAME eq HD-Player.exe", "/v", "/fo", "csv"])
    for line in result.stdout.splitlines():
        if title.lower() not in line.lower():
            continue
        # "Image Name","PID","Session Name",...,"Window Title"
        parts = [p.strip('" ') for p in line.split('","')]
        if len(parts) > 1 and parts[1].isdigit():
            return int(parts[1])
    return None


def _listening_ports(pid: int) -> list[int]:
    """TCP ports this PID is listening on, lowest first."""
    if shutil.which("netstat") is None:  # pragma: no cover - Windows only
        return []
    result = _run(["netstat", "-ano", "-p", "TCP"])
    ports: list[int] = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) < 5 or fields[-1] != str(pid) or "LISTENING" not in fields:
            continue
        _, _, port = fields[1].rpartition(":")
        if port.isdigit():
            ports.append(int(port))
    return sorted(ports)


# One resolved endpoint, kept so the 3s refresh does not run tasklist and
# netstat every tick. Cleared the moment adb stops answering on it, which is
# what makes a moved port self-correcting rather than sticky.
_adb_target: str | None = None


def collector_adb_target(refresh: bool = False) -> str | None:
    """`127.0.0.1:PORT` for the collector instance, PROVEN to answer.

    Every step is verified rather than assumed. `adb connect` says
    "connected" to a port that then reports the device offline forever, so
    the endpoint is only accepted once a shell command has come back from
    it.
    """
    global _adb_target
    if not HD_ADB.exists():
        return None
    if not refresh and _adb_target is not None:
        return _adb_target
    _adb_target = None
    pid = _hd_player_pid()
    if pid is None:
        return None
    for port in _listening_ports(pid):
        if port not in ADB_PORTS:
            continue
        target = f"127.0.0.1:{port}"
        _run([str(HD_ADB), "connect", target], timeout=15.0)
        probe = _run([str(HD_ADB), "-s", target, "shell", "echo", "ok"], timeout=15.0)
        if probe.returncode == 0 and "ok" in probe.stdout:
            _adb_target = target
            return target
    return None


def game_state() -> str:
    """ "running" | "stopped" | "unreachable".

    THREE ANSWERS, NOT TWO, and the third one is the whole point. This
    returned a bool, so "the game is not running" and "I could not ask"
    printed the same word - and when the adb port moved the window said
    STOPPED for as long as that lasted, while the game was up and being
    captured the entire time. A status that cannot distinguish those two is
    worse than no status, because it is believed.
    """
    for refresh in (False, True):
        target = collector_adb_target(refresh=refresh)
        if target is None:
            return "unreachable"
        result = _run([str(HD_ADB), "-s", target, "shell", "pidof", GAME_PACKAGE])
        if result.returncode == 0:
            return "running" if result.stdout.strip() else "stopped"
        # pidof exits nonzero for BOTH "no such process" and "no such
        # device". Only adb prefixes its own failures with "error:", so that
        # is what separates a stopped game from an endpoint that has moved.
        if "error:" not in (result.stderr + result.stdout).lower():
            return "stopped"
        # Endpoint went stale - resolve once more, then give up.
        _clear_adb_target()
    return "unreachable"


def _clear_adb_target() -> None:
    global _adb_target
    _adb_target = None


def start_tasks() -> list[str]:
    return [_run(["schtasks", "/run", "/tn", name]).stdout.strip() for name in TASKS]


def stop_tasks() -> list[str]:
    return [_run(["schtasks", "/end", "/tn", name]).stdout.strip() for name in TASKS]


DASHBOARD_URL = "https://darkwar-platform.hjyshane.workers.dev"


def open_dashboard() -> str:
    """Open the deployed dashboard in the default browser.

    The URL lives here rather than in the window because it is deployment
    state, not layout — and because the badge on that page was the only
    thing that noticed collection had been down for 18.7 hours, so getting
    to it should not require remembering the address.
    """
    webbrowser.open(DASHBOARD_URL)
    return f"opening {DASHBOARD_URL}"


def start_docker() -> str:
    """Only the local Supabase stack needs this; cloud operation does not."""
    if not DOCKER_DESKTOP.exists():
        return f"not found: {DOCKER_DESKTOP}"
    subprocess.Popen([str(DOCKER_DESKTOP)])
    return "Docker Desktop launch requested"


def start_emulator() -> str:
    """Launch the collector instance BY NAME.

    Never "the first instance" or "the only one running" — four are
    installed here and one of them is the main account. That is the same
    rule guard.py enforces for automation, and it applies just as much to
    a button a person clicks at 2am.
    """
    if not HD_PLAYER.exists():
        return f"not found: {HD_PLAYER}"
    subprocess.Popen([str(HD_PLAYER), "--instance", COLLECTOR_INSTANCE])
    return f"BlueStacks {COLLECTOR_INSTANCE} (collector) launch requested"


def start_game() -> str:
    """Start Dark War inside the collector instance only."""
    if not HD_ADB.exists():
        return f"not found: {HD_ADB}"
    # Resolved, not hardcoded - and refreshed, because this is the button
    # somebody presses when things are already not as expected.
    target = collector_adb_target(refresh=True)
    if target is None:
        return f"no adb endpoint answering for the '{COLLECTOR_WINDOW}' instance"
    result = _run(
        [
            str(HD_ADB),
            "-s",
            target,
            "shell",
            "monkey",
            "-p",
            GAME_PACKAGE,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ],
        timeout=30.0,
    )
    if result.returncode != 0:
        return f"failed: {result.stderr.strip() or result.stdout.strip()}"
    return f"{GAME_PACKAGE} launch requested"


# --- pipeline timings -------------------------------------------------
#
# How long a sighting takes to reach the dashboard. The three numbers live in
# the scheduled tasks' arguments, so this reads them out of the wrappers
# register-tasks.ps1 generated rather than repeating them here — a number
# repeated in two places is a number that will disagree with itself.

#: Where register-tasks.ps1 writes the .cmd wrappers it registers ($ScriptDir).
SCRIPT_DIR = Path(os.environ.get("DW_SCRIPT_DIR", r"C:\DW_data"))


@dataclass(frozen=True)
class Timings:
    """The timings actually registered, not the ones we last asked for."""

    rotation: int | None = None
    min_age: int | None = None
    poll: int | None = None

    @property
    def known(self) -> bool:
        return self.rotation is not None

    @property
    def worst_case(self) -> int | None:
        """Rotation plus min-age plus poll. The sync loop is on top of this."""
        if self.rotation is None or self.min_age is None or self.poll is None:
            return None
        return self.rotation + self.min_age + self.poll


def _number_after(text: str, marker: str) -> int | None:
    """The integer following `marker`, or None. Deliberately forgiving: an
    unreadable wrapper means "unknown", never a wrong number."""
    _, separator, tail = text.partition(marker)
    if not separator:
        return None
    digits = ""
    for char in tail.lstrip():
        if not char.isdigit():
            break
        digits += char
    return int(digits) if digits else None


def pipeline_timings(script_dir: Path | None = None, registered: bool | None = None) -> Timings:
    """The registered timings — if anything is registered.

    THE WRAPPER OUTLIVES THE TASK. `register-tasks.ps1` writes these .cmd
    files and then registers tasks that run them; unregister the tasks and the
    files stay exactly as they were. On 22 August a failed re-registration
    left all four tasks gone and this still reported a worst case off a stale
    wrapper, which is the most misleading thing it could have said: the
    latency of a pipeline that was not running at all.

    So the wrappers answer "at what timings", never "is it running". The task
    states answer that, and without them there is no latency to report.
    """
    directory = script_dir or SCRIPT_DIR
    if registered is None:
        registered = any(task_state(name).status != "Missing" for name in TASKS)
    if not registered:
        return Timings()
    rotation = min_age = poll = None
    try:
        capture = (directory / "run-Capture.cmd").read_text(encoding="utf-8", errors="replace")
        rotation = _number_after(capture, "duration:")
    except OSError:
        pass
    try:
        ingest = (directory / "run-Ingest.cmd").read_text(encoding="utf-8", errors="replace")
        min_age = _number_after(ingest, "--min-age-seconds")
        poll = _number_after(ingest, "--interval-seconds")
    except OSError:
        pass
    return Timings(rotation=rotation, min_age=min_age, poll=poll)
