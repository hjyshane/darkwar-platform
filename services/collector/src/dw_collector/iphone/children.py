"""The two processes that turn captured chunks into uploaded rows.

`dw-iphone` runs them itself so that ONE scheduled task (or launchd job) is
the whole chain. Both are the existing commands, unchanged: `ingest-dir`
reads and deletes chunks, `dw-sync` drains the journal to Supabase.

A child that exits is restarted after a pause. A child that outlives its
parent is the thing to prevent: on Windows, ending a scheduled task kills
only the process it started, and a leftover `ingest-dir` keeps writing the
journal that the next run is about to open. So on Windows the children are
put in a job object that is told to kill everything in it when the parent's
handle to it closes - which is also what happens when the parent is killed.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import structlog

log = structlog.get_logger()

RESTART_PAUSE_SECONDS = 10.0


@dataclass
class ChildSpec:
    name: str
    argv: Sequence[str]
    env: Mapping[str, str] = field(default_factory=dict)


class _WindowsJob:
    """A job object that kills its members when the last handle to it closes."""

    def __init__(self) -> None:
        import ctypes
        from ctypes import wintypes

        self._k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._k32.CreateJobObjectW.restype = wintypes.HANDLE
        self._k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]

        class _Basic(ctypes.Structure):
            _fields_ = (
                ("PerProcessUserTimeLimit", ctypes.c_int64),
                ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            )

        class _Io(ctypes.Structure):
            _fields_ = tuple((n, ctypes.c_uint64) for n in ("a", "b", "c", "d", "e", "f"))

        class _Extended(ctypes.Structure):
            _fields_ = (
                ("BasicLimitInformation", _Basic),
                ("IoInfo", _Io),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            )

        self._job = self._k32.CreateJobObjectW(None, None)
        if not self._job:
            raise OSError(ctypes.get_last_error(), "CreateJobObject failed")
        info = _Extended()
        info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        ok = self._k32.SetInformationJobObject(
            self._job, 9, ctypes.byref(info), ctypes.sizeof(info)
        )  # 9 = JobObjectExtendedLimitInformation
        if not ok:
            raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")

    def add(self, process: subprocess.Popen[bytes]) -> None:
        handle = getattr(process, "_handle", None)
        if handle is None or not self._k32.AssignProcessToJobObject(self._job, int(handle)):
            log.warning("iphone.child_not_in_job", pid=process.pid)


def _make_job() -> _WindowsJob | None:
    if sys.platform != "win32":
        return None
    try:
        return _WindowsJob()
    except OSError as exc:
        log.warning("iphone.job_object_failed", error=str(exc))
        return None


class ChildGroup:
    def __init__(
        self,
        specs: Sequence[ChildSpec],
        *,
        popen: Callable[..., Any] = subprocess.Popen,
        clock: Callable[[], float] = time.monotonic,
        job: _WindowsJob | bool | None = True,
    ) -> None:
        self._specs = list(specs)
        self._popen = popen
        self._clock = clock
        self._job = _make_job() if job is True else (job or None)
        self._procs: dict[str, Any] = {}
        self._restart_at: dict[str, float] = {}

    def _start(self, spec: ChildSpec) -> None:
        env = {**os.environ, **spec.env, "PYTHONIOENCODING": "utf-8"}
        proc = self._popen(list(spec.argv), env=env)
        self._procs[spec.name] = proc
        if self._job is not None:
            self._job.add(proc)
        log.info("iphone.child_started", name=spec.name, pid=proc.pid)

    def start(self) -> None:
        for spec in self._specs:
            self._start(spec)

    def tick(self) -> None:
        """Restart any child that has exited, after a pause."""
        now = self._clock()
        for spec in self._specs:
            proc = self._procs.get(spec.name)
            if proc is None or proc.poll() is None:
                continue
            due = self._restart_at.setdefault(spec.name, now + RESTART_PAUSE_SECONDS)
            if now < due:
                continue
            log.warning("iphone.child_exited", name=spec.name, code=proc.returncode)
            del self._restart_at[spec.name]
            self._start(spec)

    def stop(self) -> None:
        for proc in self._procs.values():
            if proc.poll() is None:
                proc.terminate()
        for proc in self._procs.values():
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
