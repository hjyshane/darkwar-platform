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
COLLECTOR_SERIAL = "emulator-5584"
GAME_PACKAGE = "com.readygo.dark.gp"

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


def game_running() -> bool:
    """Whether the game process exists inside the collector instance."""
    if not HD_ADB.exists():
        return False
    result = _run([str(HD_ADB), "-s", COLLECTOR_SERIAL, "shell", "pidof", GAME_PACKAGE])
    return result.returncode == 0 and result.stdout.strip() != ""


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
    _run([str(HD_ADB), "connect", "127.0.0.1:5585"])
    result = _run(
        [
            str(HD_ADB),
            "-s",
            COLLECTOR_SERIAL,
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


# --- sweep mode -------------------------------------------------------
#
# The three timings that decide how long a sighting takes to reach the
# dashboard live in the scheduled tasks' arguments, which is why changing
# them means re-registering rather than editing a setting. That is also why
# this needs elevation: everything else in this window runs as the operator.

SWEEP_ROTATION = 15
NORMAL_ROTATION = 60

# Where register-tasks.ps1 writes the .cmd wrappers it registers ($ScriptDir).
SCRIPT_DIR = Path(os.environ.get("DW_SCRIPT_DIR", r"C:\DW_data"))
REGISTER_SCRIPT = Path(
    os.environ.get("DW_REGISTER_SCRIPT", r"C:\darkwar-platform\scripts\windows\register-tasks.ps1")
)


@dataclass(frozen=True)
class SweepState:
    """The timings actually registered, not the ones we last asked for.

    Read from the generated wrappers rather than kept in memory, for the
    same reason every other reading here is: the window is opened when
    something is already wrong, and a mode remembered from a click that
    silently failed would be the one thing it must not report.
    """

    rotation: int | None = None
    min_age: int | None = None
    poll: int | None = None

    @property
    def known(self) -> bool:
        return self.rotation is not None

    @property
    def sweeping(self) -> bool:
        return self.rotation == SWEEP_ROTATION

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


def sweep_state(script_dir: Path | None = None) -> SweepState:
    directory = script_dir or SCRIPT_DIR
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
    return SweepState(rotation=rotation, min_age=min_age, poll=poll)


def sweep_command(enabled: bool, script: Path | None = None) -> list[str]:
    """The argv that re-registers the tasks in the requested mode.

    Two levels of PowerShell because this window is NOT elevated and
    registering tasks is: the outer one only exists to raise the UAC prompt
    that the inner, elevated one runs behind. `-Wait` so the caller learns
    the outcome rather than guessing from a process that has already exited.
    """
    path = str(script or REGISTER_SCRIPT).replace("'", "''")
    inner = ["'-NoProfile'", "'-ExecutionPolicy'", "'Bypass'", "'-File'", f"'{path}'"]
    if enabled:
        inner.append("'-Sweep'")
    return [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Start-Process -FilePath powershell -Verb RunAs -Wait -WindowStyle Hidden "
        "-ArgumentList " + ",".join(inner),
    ]


def set_sweep(enabled: bool, script: Path | None = None) -> str:
    """Re-register the three tasks at the sweep or the everyday timings.

    COLLECTION STOPS FOR A FEW SECONDS. The script tears the tasks down and
    builds them back, which is the only way to change arguments that live in
    a registered action. That is acceptable for a deliberate mode change and
    is why this is a button somebody presses, not something that happens on
    a schedule.
    """
    target = script or REGISTER_SCRIPT
    if not target.exists():
        return f"not found: {target}"
    wanted = "sweep" if enabled else "normal"
    result = _run(sweep_command(enabled, target), timeout=300.0)
    if result.returncode != 0:
        # A refused UAC prompt lands here, and is the likeliest cause.
        detail = result.stderr.strip() or result.stdout.strip() or "cancelled at the UAC prompt"
        return f"{wanted} mode failed: {detail}"
    now = sweep_state()
    if now.sweeping != enabled:
        # The script verifies its own work and can report FAIL per task while
        # still exiting 0, so trust the wrappers on disk over the exit code.
        return f"{wanted} mode did not take effect - check the register output"
    return f"{wanted} mode active - worst case {now.worst_case}s plus the sync loop"
