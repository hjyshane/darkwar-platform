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

import collections
import contextlib
import logging
import sqlite3
import subprocess
import sys
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import IO

from dw_collector.ingest import ScanResult, _ingest_capture, _ready_captures
from dw_collector.protocol.pcapng import PcapError
from dw_collector.storage.journal import Journal

log = logging.getLogger(__name__)

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

#: Maximum stderr lines retained from the running child. THIS IS NOT A LOG
#: FILE, it is a crash note — dumpcap runs for hours, and a child that is
#: chatty or endlessly re-erroring must never be allowed to grow this
#: process's memory without bound just because we chose to keep its stderr
#: around. `collections.deque(maxlen=...)` evicts the oldest lines once full,
#: which is the right trade here: the message that actually explains a
#: failure is almost always the last thing the child wrote before it gave
#: up, not the first. A few thousand lines is generous for that and still
#: bounded regardless of how long the process runs or how much it writes.
_STDERR_BUFFER_LINES = 4000

#: Fallback collector id used only when nothing configures a real one via
#: `Supervisor`'s `collector_id` parameter — mirrors the same fallback
#: `cli.py`'s commands fall back to via `DW_COLLECTOR_ID`. Not a credential:
#: see `desktop/settings.ensure_collector_id`.
_DEFAULT_COLLECTOR_ID = uuid.UUID("00000000-0000-4000-8000-00000000c777")

#: How long a capture file must sit untouched before the ingest loop reads
#: it. `_ready_captures`' own threshold, reused here so both paths agree on
#: what "closed" means — matches `cli.py`'s `ingest-dir` command default.
_INGEST_MIN_AGE_SECONDS = 30.0

#: How often the ingest loop rescans the capture directory. Independent of
#: dumpcap's own rotation (`_ROTATION_SECONDS` above) — a slower poll only
#: means a closed file sits a little longer before it is read, never that
#: one is missed, because "pending" is decided by `_ready_captures` plus
#: `journal.ingested_captures()`, not by how recently the loop last looked.
_INGEST_POLL_SECONDS = 5.0

#: How long `_stop_ingest_loop` waits for the ingest thread to end on its
#: own before giving up and treating it as still-running. A module-level
#: constant (rather than a literal inline) purely so tests can monkeypatch
#: it down to make a "the join times out" test fast instead of waiting out
#: the real five seconds — production behaviour is unchanged either way.
_INGEST_STOP_JOIN_TIMEOUT_SECONDS = 5.0


def _default_journal_factory(path: Path) -> Journal:
    """The real journal factory `Supervisor` uses.

    `single_writer_thread=True`: every read and write against the Journal
    this opens happens on the ingest thread (`Supervisor._ingest_loop`) and
    NOWHERE ELSE — not `status()`, not `start()`/`stop()`. See
    `Journal.__init__`'s own docstring on why a second writer is exactly
    the failure this must avoid, and `capture/__main__.py` for the
    precedent it follows (that Journal is opened on the main thread and
    written from `SegmentPump`'s one worker thread; this one is simpler —
    opened and used entirely on the one ingest thread instead).

    `init_db()` runs here too — same as `cli.py`'s own `_open_journal` — so
    a first-run journal that does not exist yet (or one missing the
    `ingested_captures` table) is created before anything tries to query
    it, rather than failing the first `_ingest_once` with "no such table".
    """
    journal = Journal(path, single_writer_thread=True)
    journal.init_db()
    return journal


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
class IngestStatus:
    """What the ingest loop has read into the journal so far this run.

    Reported separately from `CaptureStatus.state` on purpose: "dumpcap is
    running" and "data is actually arriving" are different questions, and a
    player watching the settings screen only cares about the second one — a
    wedged reassembler, a wrong capture filter, or a full disk can all leave
    dumpcap looking perfectly healthy while nothing new ever lands in the
    journal.

    `state` is the second half of that same problem (Finding 2): before
    this, a dead ingest thread and a live one with nothing new to ingest
    were indistinguishable — both just left the counters below unchanged.
    A frozen `files_seen`/`files_ingested` no longer has to mean "nothing
    to do"; it can now mean "nobody is looking anymore", and `state` plus
    `error` say which.
    """

    #: - "idle": no `journal_path` configured, or a session has not started
    #:   (this run's counters are meaningless in either case)
    #: - "running": the ingest thread is alive and looping — whether or not
    #:   the current pass has found anything new is visible from whether
    #:   `files_seen`/`files_ingested` are still moving between polls
    #: - "stopping": `stop()`'s join timed out and the previous thread is
    #:   still winding down (Finding 1's guard) — a new `start()` will keep
    #:   refusing to spawn a second ingest thread until it actually exits
    #: - "stopped": `stop()` completed and the thread was reaped normally
    #: - "died": the thread ended from an exception `_ingest_once` does not
    #:   already treat as a per-file failure — see `error` for what it was
    state: str = "idle"
    files_seen: int = 0
    files_ingested: int = 0
    rows_written: int = 0
    #: `f"{type(exc).__name__}: {exc}"` for the exception that produced
    #: `state == "died"`. Empty for every other state.
    error: str = ""


@dataclass(frozen=True)
class CaptureStatus:
    """What asking the supervisor for capture state actually produced."""

    #: "stopped" | "running" | "failed"
    state: str
    pid: int | None = None
    returncode: int | None = None
    #: dumpcap's own stderr, verbatim (subject to `_STDERR_BUFFER_LINES`),
    #: once the process has exited. WE DO NOT GUESS AT THE CAUSE, same
    #: reasoning as `adapters.Probe.detail`: a bad interface, a missing
    #: Npcap driver, and a permissions refusal all fail differently, and
    #: dumpcap's own words are the only thing that tells a player which one
    #: happened. This is read from a background-drained buffer, never from
    #: the live pipe, and is cached so a second call sees the same text —
    #: see `Supervisor._drain_stderr` and `Supervisor.status`.
    stderr: str = ""
    #: See `IngestStatus`. Always present; stays all zeros when no
    #: `journal_path` was configured on `Supervisor` — every caller before
    #: this task.
    ingest: IngestStatus = field(default_factory=IngestStatus)


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
        # INGEST LOOP (opt-in). `journal_path is None` — the default, and
        # every caller of `Supervisor` before this task — means the ingest
        # thread never starts and `status().ingest` stays all zeros.
        journal_path: Path | None = None,
        collector_id: uuid.UUID = _DEFAULT_COLLECTOR_ID,
        collected_from_server: int = 580,
        ingest_min_age_seconds: float = _INGEST_MIN_AGE_SECONDS,
        ingest_poll_seconds: float = _INGEST_POLL_SECONDS,
        journal_factory: Callable[[Path], Journal] = _default_journal_factory,
        ingest_capture: Callable[..., ScanResult] = _ingest_capture,
        ready_captures: Callable[[Path, float], list[Path]] = _ready_captures,
    ) -> None:
        self._dumpcap = dumpcap
        self._popen = popen
        self._build_argv = build_argv
        self._kill_tree = kill_tree
        self._process: subprocess.Popen[bytes] | None = None
        # GUARD (Finding 2): serializes the check-then-act in `start()` and
        # the whole of `stop()`. The window used to be "one client today",
        # but Task 6 puts this Supervisor behind a `ThreadingHTTPServer`,
        # where two overlapping Start requests hit this exact race —
        # reproduced at 8 threads calling `start()` concurrently producing 7
        # distinct PIDs, all writing to the same ring directory. A second
        # `dumpcap` on that directory does not queue behind the first, it
        # corrupts the capture. RLock (not Lock) because `start()` calls
        # `self.status()` while still holding it, and `status()` itself does
        # NOT take this lock — see the comment in `status()` for why that is
        # safe.
        self._lock = threading.RLock()
        # Finding 1's buffer: filled by a background thread (`_drain_stderr`,
        # started in `start()`), read by `status()`. Never read from the
        # live pipe outside that thread again.
        self._stderr_buffer: collections.deque[str] = collections.deque(maxlen=_STDERR_BUFFER_LINES)
        # Guards `_stderr_buffer` only — separate from `_lock` because the
        # drain thread appends to it continuously for the life of the child,
        # independent of whatever `start()`/`stop()` are doing.
        self._stderr_buffer_lock = threading.Lock()
        # Finding 4: the terminal status (state="failed"/"stopped" with
        # returncode/stderr) of the last process, captured by `stop()` when
        # it finds the child already dead — see `stop()`. `None` means "no
        # captured terminal status", in which case `status()` falls back to
        # the plain default of "stopped".
        self._last_status: CaptureStatus | None = None

        # INGEST LOOP state. `self._journal_path` gates everything below —
        # see `_start_ingest_loop`.
        self._journal_path = journal_path
        self._collector_id = collector_id
        self._collected_from_server = collected_from_server
        self._ingest_min_age_seconds = ingest_min_age_seconds
        self._ingest_poll_seconds = ingest_poll_seconds
        self._journal_factory = journal_factory
        self._ingest_capture = ingest_capture
        self._ready_captures = ready_captures
        self._ingest_thread: threading.Thread | None = None
        self._ingest_stop = threading.Event()
        # Guards the three counters only — same split as
        # `_stderr_buffer_lock` versus `self._lock`: the ingest thread
        # updates these continuously for the life of a capture session,
        # independent of whatever `start()`/`stop()` are doing.
        self._ingest_status_lock = threading.Lock()
        self._ingest_files_seen = 0
        self._ingest_files_ingested = 0
        self._ingest_rows_written = 0
        # Finding 2: same lock as the counters above. "idle" until the
        # first `_start_ingest_loop` — see `IngestStatus.state`.
        self._ingest_state = "idle"
        self._ingest_error = ""

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
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                return self.status()

            capture_dir.mkdir(parents=True, exist_ok=True)
            argv = self._build_argv(self._dumpcap, interface, capture_dir, game_port)
            # stdout is discarded (dumpcap's ordinary progress goes nowhere
            # useful for a player), but stderr is piped and kept — see
            # `CaptureStatus.stderr` and the module docstring's "do not
            # swallow dumpcap's stderr" reasoning.
            process = self._popen(
                argv,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                creationflags=_CREATION_FLAGS,
            )
            self._process = process
            self._last_status = None
            with self._stderr_buffer_lock:
                self._stderr_buffer.clear()
            if process.stderr is not None:
                # DAEMON THREAD (Finding 1): an undrained `subprocess.PIPE`
                # is not a diagnostic channel, it is a deadlock with a
                # plausible excuse. The OS pipe buffer is small (~64 KiB is
                # typical); once dumpcap fills it, dumpcap's own `write()`
                # call to stderr blocks until someone reads the other end —
                # and nothing did, since `status()` used to read `stderr`
                # only after the process had already exited. A stub writing
                # a few hundred KB reproduced this: it wedged for the whole
                # observation window while `poll()` kept returning `None`
                # and `status()` kept saying `state="running"`. dumpcap runs
                # for hours; it will get there. Draining continuously here
                # means the pipe is never allowed to fill, so the child can
                # never block on it, and `status()`/`stop()` read the
                # buffer this fills, never the pipe.
                threading.Thread(
                    target=self._drain_stderr,
                    args=(process.stderr,),
                    daemon=True,
                    name="dw-capture-stderr-drain",
                ).start()
            self._start_ingest_loop(capture_dir, game_port)
            return self.status()

    def stop(self) -> None:
        """Stop capture. A no-op, not an error, when nothing is running.

        Holds `self._lock` for the same reason `start()` does: this must not
        interleave with a concurrent `start()` deciding whether a process is
        already running.
        """
        with self._lock:
            # Stopped alongside dumpcap regardless of which branch below is
            # taken — including the "nothing running" one, where this is a
            # safe no-op. See `_stop_ingest_loop`.
            self._stop_ingest_loop()
            if self._process is None:
                return
            # GUARD: only kill while this PID is still known to be ours.
            # `main.rs`'s `ExitRequested` handler calls `child.try_wait()`
            # before `kill_tree` and kills only on `Ok(None)` (still
            # running), because Windows recycles process ids and a PID
            # killed on the strength of a stale reference can reach whatever
            # the OS has since handed that number to. `Popen.poll()` is the
            # Python equivalent: `None` means still running; anything else
            # means it already exited on its own, and this PID must not be
            # acted on again.
            returncode = self._process.poll()
            if returncode is not None:
                # Finding 4: the child already failed before Stop was ever
                # pressed. Capture its terminal status BEFORE clearing
                # `self._process` — the old code cleared it here with no
                # record kept, so a following `status()` call (with no
                # `status()` call having happened in between, exactly the
                # "press Stop after a crash" sequence) fell through to the
                # `self._process is None` branch and reported a plain
                # "stopped", silently discarding the crash and telling the
                # player capture ended normally.
                self._last_status = self._status_from_buffer(returncode)
                self._process = None
                return
            pid = self._process.pid
            self._kill_tree(pid)
            # Best-effort beyond this point: the tree kill was already
            # issued, and a stop button must not hang the app waiting on a
            # process that refuses to die.
            with contextlib.suppress(subprocess.TimeoutExpired):
                self._process.wait(timeout=5)
            self._process = None
            # This was a deliberate stop, not a crash — leave `_last_status`
            # unset (rather than recording the kill's own returncode, which
            # can look failure-shaped) so a following `status()` reports the
            # plain "stopped" default.
            self._last_status = None

    def status(self) -> CaptureStatus:
        """The current state, including dumpcap's stderr once it has exited.

        Does NOT take `self._lock`. This is deliberately a plain, wait-free
        read: the harm a concurrent `start()`/`stop()` could do to a racing
        `status()` call is a stale snapshot for one poll cycle (still
        running vs. just stopped) — cosmetic, and self-correcting on the
        next poll. That is a completely different order of problem from
        Finding 2, where a torn check-then-act spawns a second `dumpcap`
        onto the same ring directory and corrupts the capture. Serializing
        every UI status poll behind `start()`/`stop()` would buy nothing
        here and cost latency on what is meant to be a cheap, frequent call.

        Never reads `self._process.stderr` directly (Finding 1) — that pipe
        is drained continuously by a background thread into
        `self._stderr_buffer`, which this reads instead. See
        `_drain_stderr` and `_status_from_buffer`.

        `ingest` is layered on afterward via `dataclasses.replace`, read
        under its own lock (`_ingest_status`) the same wait-free way as
        everything else here — it never touches the ingest thread's journal
        connection.
        """
        ingest = self._ingest_status()
        if self._process is None:
            if self._last_status is not None:
                return replace(self._last_status, ingest=ingest)
            return CaptureStatus(state="stopped", ingest=ingest)
        returncode = self._process.poll()
        if returncode is None:
            return CaptureStatus(state="running", pid=self._process.pid, ingest=ingest)
        return replace(self._status_from_buffer(returncode), ingest=ingest)

    def _status_from_buffer(self, returncode: int) -> CaptureStatus:
        """Build the terminal `CaptureStatus` for an exited process.

        Finding 3: reads `self._stderr_buffer`, never the pipe, and never
        drains or clears anything it reads — the buffer is cleared only by
        the next `start()` (see there). That makes this idempotent: calling
        `status()` twice after exit, or calling it from `stop()`'s
        already-dead branch and then again from a following `status()`,
        both see the same text instead of the second call finding an
        already-drained pipe and reporting an empty reason.
        """
        with self._stderr_buffer_lock:
            text = "\n".join(self._stderr_buffer).strip()
        state = "stopped" if returncode == 0 else "failed"
        return CaptureStatus(state=state, returncode=returncode, stderr=text)

    def _drain_stderr(self, pipe: IO[bytes]) -> None:
        """Continuously read `pipe` into `self._stderr_buffer` so the child
        can never block on a full stderr pipe.

        THIS IS THE FIX FOR FINDING 1: an undrained pipe is not a
        diagnostic channel, it is a deadlock with a plausible excuse. Runs
        as a daemon thread for the life of the child (started once per
        `start()`), reading line by line until the pipe closes (the child
        exiting closes its end, which makes `readline()` return `b""` and
        ends this loop on its own — no explicit stop signal needed).
        """
        try:
            for raw_line in iter(pipe.readline, b""):
                line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                with self._stderr_buffer_lock:
                    self._stderr_buffer.append(line)
        except (ValueError, OSError):
            # The pipe was torn down out from under us — e.g. `stop()`
            # killed the process while this thread was mid-read. Not this
            # thread's job to report that; `stop()`/`status()` already
            # handle the process's exit from their own side.
            pass

    # --- ingest loop --------------------------------------------------

    def _start_ingest_loop(self, capture_dir: Path, game_port: int) -> None:
        """Start the ingest daemon thread for this capture session, if a
        journal path is configured and one is not already running.

        Called from inside `start()`'s `self._lock` — the same guard that
        already serializes the stderr-drain thread's own start against a
        concurrent `start()` call (Finding 2). Counters reset here: each
        freshly spawned `dumpcap` session gets its own "seen this run"
        answer, the same way `self._stderr_buffer` is cleared on every
        `start()`.
        """
        journal_path = self._journal_path
        if journal_path is None:
            return
        if self._ingest_thread is not None and self._ingest_thread.is_alive():
            return
        with self._ingest_status_lock:
            self._ingest_files_seen = 0
            self._ingest_files_ingested = 0
            self._ingest_rows_written = 0
            self._ingest_state = "running"
            self._ingest_error = ""
        self._ingest_stop.clear()
        self._ingest_thread = threading.Thread(
            target=self._ingest_loop,
            args=(journal_path, capture_dir, game_port),
            daemon=True,
            name="dw-capture-ingest",
        )
        self._ingest_thread.start()

    def _stop_ingest_loop(self) -> None:
        """Stop the ingest thread, best-effort — the same "signal, wait
        briefly, move on" shape `stop()` already uses for the dumpcap child
        itself. Safe to call when nothing is running.

        CRITICAL (Finding 1): `self._ingest_thread` is cleared ONLY when
        `join` actually reaped the thread. Clearing it unconditionally — the
        old code did exactly that — is an invitation to start a second
        writer: `_start_ingest_loop`'s only guard against spawning twice is
        `self._ingest_thread is not None and self._ingest_thread.is_alive()`,
        so wiping the reference while the thread is still running makes that
        guard see nothing, and a following `start()` (a slow first pass over
        a full ring easily outlasts this join's timeout — `_ingest_stop` used
        to only be checked between whole passes, never mid-backlog, see
        `_ingest_once`) spawns a SECOND `Journal(..., single_writer_thread=
        True)` against the very file the first thread is still writing.
        There is no crash to announce this: WAL mode is on but nothing here
        sets a `busy_timeout` (see `Journal.__init__`), so the new writer's
        first colliding write raises `sqlite3.OperationalError` — silently,
        inside a background thread, in a case `_ingest_once` used to not
        even catch (Finding 1 also widens that to `sqlite3.DatabaseError`,
        `OperationalError`'s parent — it is NOT an `OSError`, despite
        sounding like one). Meanwhile both threads share and stomp on the
        same `_ingest_files_seen`/`_ingest_files_ingested`/
        `_ingest_rows_written` counters, which the new `_start_ingest_loop`
        call has just reset to zero out from under the straggler. Keeping
        the reference here — reporting `state="stopping"` instead of
        quietly forgetting the old thread — is what keeps that guard
        working; see `IngestStatus.state`.
        """
        self._ingest_stop.set()
        if self._ingest_thread is None:
            return
        self._ingest_thread.join(timeout=_INGEST_STOP_JOIN_TIMEOUT_SECONDS)
        if self._ingest_thread.is_alive():
            # Still running after the timeout. Leave `self._ingest_thread`
            # set — see the docstring above for why clearing it here is the
            # bug, not a simplification of it.
            with self._ingest_status_lock:
                self._ingest_state = "stopping"
            return
        self._ingest_thread = None

    def _ingest_status(self) -> IngestStatus:
        """The ingest counters, read under their own lock — never through
        the journal connection itself, which only the ingest thread ever
        touches (see `_ingest_loop`)."""
        with self._ingest_status_lock:
            return IngestStatus(
                state=self._ingest_state,
                files_seen=self._ingest_files_seen,
                files_ingested=self._ingest_files_ingested,
                rows_written=self._ingest_rows_written,
                error=self._ingest_error,
            )

    def _ingest_loop(self, journal_path: Path, capture_dir: Path, game_port: int) -> None:
        """The ingest thread's entire body.

        THE ONE JOURNAL WRITER. `journal_path` is opened here, ON THIS
        THREAD, by `self._journal_factory` (`single_writer_thread=True` by
        default — see `_default_journal_factory`), and every call into it —
        `journal.ingested_captures()`, `_ingest_capture`'s own
        `journal.record()`, `journal.mark_capture_ingested()` — happens on
        this same thread for the rest of its life. `status()` never reads
        this connection; it reads `self._ingest_files_seen` and friends
        under `self._ingest_status_lock` instead (`_ingest_status`), the
        same split `_drain_stderr`/`_status_from_buffer` already use for
        dumpcap's stderr. If a second writer is ever added to this journal,
        it must open its own connection or take on this same lock
        discipline — see `Journal.__init__`'s own warning about exactly
        this failure mode.

        Finding 2: `_ingest_once` already handles the failure modes it
        knows about (a corrupt capture, a locked journal — see there)
        without raising past this point. The `except Exception` below is
        the catch-all for everything it does not: before this, anything
        else killed the thread with nothing recorded anywhere, and
        `status()` could not tell that apart from "nothing new to ingest
        yet" — both just left the counters unchanged. Recording
        `state="died"` plus the exception text BEFORE returning is what
        makes that visible instead of a permanently frozen, unexplained
        counter. Deliberately broad: this is an unattended background
        thread meant to run for a multi-hour capture session, and there is
        no way to enumerate every failure it might hit over that time.
        """
        journal = self._journal_factory(journal_path)
        try:
            while True:
                try:
                    self._ingest_once(journal, capture_dir, game_port)
                except Exception as exc:
                    with self._ingest_status_lock:
                        self._ingest_state = "died"
                        self._ingest_error = f"{type(exc).__name__}: {exc}"
                    log.exception("dw_capture.ingest_loop_died")
                    return
                if self._ingest_stop.wait(self._ingest_poll_seconds):
                    with self._ingest_status_lock:
                        self._ingest_state = "stopped"
                    return
        finally:
            journal.close()

    def _ingest_once(self, journal: Journal, capture_dir: Path, game_port: int) -> None:
        """One scan-and-ingest pass over `capture_dir`.

        A file that fails to parse must not end the session — exactly
        `ingest-dir`'s own reasoning (see `dw_collector.ingest`): one
        corrupt ring file is allowed to cost that one file, never the rest
        of a night's collection. Marked ingested with zero events either
        way, so it is never retried — a truncated file never becomes valid,
        and retrying it every poll would lose everything after it instead
        of costing just this one.

        Checks `self._ingest_stop` between files, not only between whole
        passes (Finding 1): `_ingest_loop` used to only look at
        `_ingest_stop` once this whole method returned, so a real backlog —
        the first run against an already-full ring — could take far longer
        than `_stop_ingest_loop`'s join timeout, and a stop request would
        sit unanswered for the entire pass instead of landing between files.
        """
        try:
            done = journal.ingested_captures()
        except sqlite3.DatabaseError:
            log.warning("dw_capture.ingest_journal_unavailable", exc_info=True)
            return
        pending = [
            path
            for path in self._ready_captures(capture_dir, self._ingest_min_age_seconds)
            if path.name not in done
        ]
        for pcap in pending:
            if self._ingest_stop.is_set():
                return
            with self._ingest_status_lock:
                self._ingest_files_seen += 1
            fallback = datetime.now(tz=UTC)
            try:
                result = self._ingest_capture(
                    journal,
                    pcap,
                    collector_id=self._collector_id,
                    collected_from_server=self._collected_from_server,
                    port=game_port,
                    discover_only=False,
                    fallback=fallback,
                )
            except (PcapError, OSError, ValueError, sqlite3.DatabaseError):
                # `sqlite3.DatabaseError` added for Finding 1:
                # `sqlite3.OperationalError` (e.g. "database is locked") is
                # a `DatabaseError` subclass, NOT an `OSError`, despite
                # sounding like one — an `except OSError` alone lets it
                # right past this handler and into `_ingest_loop`'s
                # catch-all, which would kill this entire ingest session
                # over what should cost, at most, this one file. Catching
                # the parent class also covers disk-full and corruption for
                # the same reason.
                journal.mark_capture_ingested(pcap.name, 0)
                log.warning(f"dw_capture.unreadable_capture: {pcap.name}", exc_info=True)
                continue
            journal.mark_capture_ingested(pcap.name, result.events)
            with self._ingest_status_lock:
                self._ingest_files_ingested += 1
                self._ingest_rows_written += result.events
