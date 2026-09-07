"""Runs packet capture as a child of the desktop app, not a scheduled task.

`scripts/windows/register-tasks.ps1` registers `DarkWar-Capture` as a Task
Scheduler entry that survives logoff and restarts itself on failure — right
for a machine collecting around the clock, wrong for something handed to
another player. Registering a scheduled task needs an elevated PowerShell
(`register-tasks.ps1` refuses to run without it), leaves the task behind
after the app is uninstalled, and makes "run this PowerShell script first"
step one of setup for someone who just wants to open an app. None of that is
acceptable for a desktop tool other people install.

So here capture is `dumpcap` spawned directly by this process and supervised
for the life of the app: it starts when a player asks it to, and it stops
when the app does. This trades the scheduled task's self-healing (it used to
restart a crashed `dumpcap` every five minutes, see `register-tasks.ps1`'s
`$trigger.Repetition`) for something much simpler to install and reason
about. That is a real behaviour difference, not a simplification with no
cost — a crashed capture on the always-on collector machine used to come
back on its own; here it does not, and the settings screen has to make a
stalled capture visible instead.

`ring_argv` reproduces the exact dumpcap invocation `register-tasks.ps1`
registers (see its `$tasks` entry for `DarkWar-Capture`, line ~250), as a
`list[str]` handed straight to `Popen` — no shell, no `cmd.exe`, so there is
no quoting to get wrong (`register-tasks.ps1` itself has a comment about
single quotes breaking dumpcap's arguments inside its `.cmd` wrapper; a
`list[str]` argv sidesteps that class of bug entirely).

`Supervisor` owns at most one `dumpcap` child. Stopping it kills by process
tree, not by PID alone, guarded by the same "is this PID still ours" check
`apps/desktop/src-tauri/src/main.rs` uses before its own `kill_tree` — see
that file and `docs/runbooks/desktop-sidecar-lifecycle.md` for why: a
PyInstaller bootloader re-exec in this repo's other sidecar process left an
inner process orphaned and still running after `Child::kill` reached only
the outer one. Nothing here has measured whether `dumpcap.exe` re-execs the
same way, but the cost of wrongly assuming it does not is a capture process
still writing files to disk after the app has closed — worse than the cost
of an unnecessary `/T`.
"""

from __future__ import annotations

import contextlib
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

#: register-tasks.ps1's ring buffer for `DarkWar-Capture`, read out of
#: `$timings` and the literal `-B 64` on its `$tasks` entry (line ~250)
#: rather than guessed: `Rotation = 15`, `Files = 5760`. 5760 files at a
#: 15-second rotation is a day of history — see the comment beside
#: `$timings` in that script for why a faster rotation does not mean less
#: data, only smaller files.
_ROTATION_SECONDS = 15
_RING_FILES = 5760
#: The libpcap ring-buffer size in MiB (`-B`). Not driven by `$timings` at
#: all in register-tasks.ps1 — it is the literal `-B 64` there, reproduced
#: as-is.
_RING_BUFFER_MIB = 64

#: The file dumpcap writes inside the capture directory — also literal from
#: register-tasks.ps1 (`$CaptureDir\cap.pcapng`).
_CAPTURE_FILENAME = "cap.pcapng"


def ring_argv(dumpcap: str, interface: str, capture_dir: Path, *, game_port: int) -> list[str]:
    """The dumpcap argv for a rotating ring-buffer capture.

    Reproduces the shape at register-tasks.ps1's `DarkWar-Capture` entry
    (`dumpcap.exe -i "<iface>" -f "tcp port <port>" -w "<dir>\\cap.pcapng"
    -b duration:15 -b files:5760 -B 64`) as a list of argv elements rather
    than a quoted command string, since this is handed straight to `Popen`
    with no shell in between.

    `game_port` is `Settings.game_port`, never the `8680` hardcoded in
    register-tasks.ps1 — that number is this repo's server group's port, not
    a universal constant, and a player on a different port capturing nothing
    while the process looks healthy is exactly the silent-failure shape this
    repo has hit before (see `capture/live.py::check_interface`).
    """
    return [
        dumpcap,
        "-i",
        interface,
        "-f",
        f"tcp port {game_port}",
        "-w",
        str(capture_dir / _CAPTURE_FILENAME),
        "-b",
        f"duration:{_ROTATION_SECONDS}",
        "-b",
        f"files:{_RING_FILES}",
        "-B",
        str(_RING_BUFFER_MIB),
    ]


def _default_argv(dumpcap: str, interface: str, capture_dir: Path, game_port: int) -> list[str]:
    return ring_argv(dumpcap, interface, capture_dir, game_port=game_port)


# CREATE_NO_WINDOW, matching apps/desktop/src-tauri/src/main.rs's
# `creation_flags(CREATE_NO_WINDOW)` and `console/state.py`'s `_NO_WINDOW`.
# `subprocess.Popen`/`subprocess.run` raise on POSIX for a truthy
# `creationflags` ("creationflags is only supported on Windows platforms"),
# so this is 0 (a harmless no-op value there) off Windows — a plain `int`
# rather than a `**kwargs` dict, since unpacking a `dict[str, int]` into
# `subprocess.run`'s overloaded signature defeats mypy's overload resolution.
_CREATION_FLAGS: int = 0x0800_0000 if sys.platform == "win32" else 0


def _kill_tree(pid: int) -> None:
    """Kill `pid` by process tree, mirroring `main.rs`'s `kill_tree`
    (`taskkill /F /T /PID <pid>`).

    See the module docstring: this repo has already measured a PyInstaller
    bootloader that `Child::kill`/a plain `taskkill` (no `/T`) does not fully
    reach, and dumpcap has not been checked either way. `/T` costs nothing
    when dumpcap really is one process; it is only insurance for the case
    where it is not.
    """
    if sys.platform != "win32":
        # No POSIX build of this app exists. This branch exists only so the
        # module imports and its pure functions run under Linux CI.
        subprocess.run(["kill", "-9", str(pid)], check=False)  # pragma: no cover
        return
    subprocess.run(
        ["taskkill", "/F", "/T", "/PID", str(pid)],
        check=False,
        creationflags=_CREATION_FLAGS,
    )


@dataclass(frozen=True)
class CaptureStatus:
    """What asking the supervisor for capture state actually produced."""

    #: "stopped" | "running" | "failed"
    state: str
    pid: int | None = None
    returncode: int | None = None
    #: dumpcap's own stderr, verbatim, once the process has exited. WE DO NOT
    #: GUESS AT THE CAUSE, same reasoning as `adapters.Probe.detail`: a bad
    #: interface, a missing Npcap driver, and a permissions refusal all fail
    #: differently, and dumpcap's own words are the only thing that tells a
    #: player which one happened.
    stderr: str = ""


class Supervisor:
    """Owns at most one `dumpcap` child process, spawned as a child of this app.

    `dumpcap` is the path to the executable, taken as a constructor
    parameter rather than resolved here — `desktop/adapters.find_dumpcap`
    already owns finding it, and this class only needs to run it. `popen`
    and `build_argv` are injected the same way `desktop/adapters.probe`
    injects `run`: the real defaults call `subprocess.Popen` and `ring_argv`,
    and tests can point `dumpcap` at `sys.executable` with a `build_argv`
    that returns a small sleeping script — proving real spawn/status/stop
    behaviour without Npcap, without a real `dumpcap`, and without a live
    interface anywhere near the test.
    """

    def __init__(
        self,
        dumpcap: str,
        *,
        popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen,
        build_argv: Callable[[str, str, Path, int], list[str]] = _default_argv,
        kill_tree: Callable[[int], None] = _kill_tree,
    ) -> None:
        self._dumpcap = dumpcap
        self._popen = popen
        self._build_argv = build_argv
        self._kill_tree = kill_tree
        self._process: subprocess.Popen[bytes] | None = None

    def start(self, interface: str, capture_dir: Path, *, game_port: int) -> CaptureStatus:
        """Start capture, creating `capture_dir` if it does not exist yet.

        Refuses an empty `interface` outright rather than spawning
        `dumpcap -i ""` — an empty interface is exactly what a fresh install
        has before a player picks an adapter in settings, and a `dumpcap`
        that fails on a bad argument looks, from here, identical to one that
        fails for any other reason unless this is caught before spawning.

        Calling this while already running is a no-op that returns the
        existing status — it must never spawn a second `dumpcap` writing to
        the same ring buffer.
        """
        if not interface:
            raise ValueError(
                "no capture interface configured — pick one in settings before starting capture"
            )
        if self._process is not None and self._process.poll() is None:
            return self.status()

        capture_dir.mkdir(parents=True, exist_ok=True)
        argv = self._build_argv(self._dumpcap, interface, capture_dir, game_port)
        # stdout is discarded (dumpcap's ordinary progress goes nowhere
        # useful for a player), but stderr is piped and kept — see
        # `CaptureStatus.stderr` and the module docstring's "do not swallow
        # dumpcap's stderr" reasoning.
        self._process = self._popen(
            argv,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=_CREATION_FLAGS,
        )
        return self.status()

    def stop(self) -> None:
        """Stop capture. A no-op, not an error, when nothing is running."""
        if self._process is None:
            return
        # GUARD: only kill while this PID is still known to be ours.
        # `main.rs`'s `ExitRequested` handler calls `child.try_wait()` before
        # `kill_tree` and kills only on `Ok(None)` (still running), because
        # Windows recycles process ids and a PID killed on the strength of a
        # stale reference can reach whatever the OS has since handed that
        # number to. `Popen.poll()` is the Python equivalent: `None` means
        # still running; anything else means it already exited on its own,
        # and this PID must not be acted on again.
        if self._process.poll() is not None:
            self._process = None
            return
        pid = self._process.pid
        self._kill_tree(pid)
        # Best-effort beyond this point: the tree kill was already issued,
        # and a stop button must not hang the app waiting on a process that
        # refuses to die.
        with contextlib.suppress(subprocess.TimeoutExpired):
            self._process.wait(timeout=5)
        self._process = None

    def status(self) -> CaptureStatus:
        """The current state, including dumpcap's stderr once it has exited.

        Reading `stderr` only after the process has exited (`poll()` is not
        `None`) is deliberate: reading a live pipe with nothing written to it
        yet would block, and this call must never do that while capture is
        healthy and running.
        """
        if self._process is None:
            return CaptureStatus(state="stopped")
        returncode = self._process.poll()
        if returncode is None:
            return CaptureStatus(state="running", pid=self._process.pid)
        raw_stderr = self._process.stderr.read() if self._process.stderr is not None else b""
        text = raw_stderr.decode("utf-8", errors="replace").strip()
        state = "stopped" if returncode == 0 else "failed"
        return CaptureStatus(state=state, returncode=returncode, stderr=text)
