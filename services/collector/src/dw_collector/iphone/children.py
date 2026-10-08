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
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import structlog

from dw_collector.iphone.jobobject import KillOnCloseJob

log = structlog.get_logger()

RESTART_PAUSE_SECONDS = 10.0


@dataclass
class ChildSpec:
    name: str
    argv: Sequence[str]
    env: Mapping[str, str] = field(default_factory=dict)


def _make_job() -> KillOnCloseJob | None:
    if not KillOnCloseJob.supported:
        return None
    try:
        return KillOnCloseJob()
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
        job: KillOnCloseJob | bool | None = True,
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
