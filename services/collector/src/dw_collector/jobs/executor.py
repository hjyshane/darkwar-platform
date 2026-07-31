"""Turn a queued job into taps on the collector's emulator.

This is the boundary where a database row becomes physical action, so it is
the place to be suspicious. A job names a routine; it does not supply one.
The name is matched against a strict pattern and resolved inside a local
directory, and the resolved path is checked to still be inside it — so a
`payload.routine` of `../../../etc/passwd` or an absolute path fails as a
permanent error rather than reading anything.

Everything downstream is the same code `dw-ui-worker` runs, deliberately:
the ADB guard (FR-COL-001/010), the idle gate (FR-COL-009), and the
runner's rule that a step is done only when the command it expects arrives.
A job cannot reach a screen by a route a human operator could not.
"""

from __future__ import annotations

import re
from pathlib import Path

from dw_collector.jobs.worker import Job, JobOutcome
from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.adb import AdbClient, AdbError
from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy
from dw_collector.ui_worker.idle import IdlePolicy
from dw_collector.ui_worker.routine import Routine
from dw_collector.ui_worker.runner import RoutineRunner

RUN_ROUTINE = "run_routine"

#: No dots, no separators. Rejecting traversal by construction beats
#: sanitising it, and the containment check below is the second line.
SAFE_ROUTINE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


class RoutineExecutor:
    """Runs `run_routine` jobs; refuses everything else."""

    def __init__(
        self,
        *,
        routines_dir: Path,
        journal: Journal,
        policy: AdbPolicy,
        idle: IdlePolicy | None = None,
        adb: str = "adb",
    ) -> None:
        self.routines_dir = routines_dir
        self.journal = journal
        self.policy = policy
        self.idle = idle
        self.adb = adb

    def resolve_routine(self, name: object) -> Path:
        """Name → path inside `routines_dir`, or ValueError."""
        if not isinstance(name, str) or not SAFE_ROUTINE_NAME.match(name):
            msg = f"payload.routine is not a plain routine name: {name!r}"
            raise ValueError(msg)
        base = self.routines_dir.resolve()
        path = (base / f"{name}.json").resolve()
        # Belt and braces: the pattern already excludes separators, but a
        # symlink inside routines_dir could still point outside it.
        if not path.is_relative_to(base):
            msg = f"routine {name!r} resolves outside {base}"
            raise ValueError(msg)
        if not path.is_file():
            msg = f"no routine named {name!r} in {base}"
            raise ValueError(msg)
        return path

    def __call__(self, job: Job) -> JobOutcome:
        if job.job_type != RUN_ROUTINE:
            # Permanent: a collector that does not know this verb today will
            # not learn it by retrying. It surfaces in the dead-letter list,
            # which is where an unrecognised job type should be looked at.
            return JobOutcome(
                ok=False,
                error=f"unknown job_type {job.job_type!r}",
                permanent=True,
            )

        # Before check_target, which also raises on the kill switch — and a
        # kill switch is an operator pausing things, not a broken job. Left
        # to fall through it would dead-letter the whole queue, so that
        # flipping the switch back on would require requeuing by hand.
        if self.policy.kill_switch_engaged():
            return JobOutcome(ok=False, error="UI automation kill switch is engaged")

        try:
            path = self.resolve_routine(job.payload.get("routine"))
            plan = Routine.load(path)
        except (ValueError, OSError) as exc:
            return JobOutcome(ok=False, error=str(exc), permanent=True)

        try:
            # check_target, not collector_serial directly: it is the call that
            # rejects an unset serial, an empty denylist, and the kill switch.
            target = self.policy.check_target(self.policy.collector_serial)
            client = AdbClient(policy=self.policy, serial=target, executable=self.adb)
            report = RoutineRunner(client, self.journal, idle=self.idle).run(plan)
        except AdbGuardError as exc:
            # Misconfiguration, not a flaky device: retrying every 30s until
            # dead-letter would just repeat the same refusal.
            return JobOutcome(ok=False, error=f"guard refused: {exc}", permanent=True)
        except (AdbError, OSError) as exc:
            # The emulator being down or adb being restarted is exactly what
            # backoff is for.
            return JobOutcome(ok=False, error=str(exc))

        result = {
            "routine": plan.name,
            "steps": [
                {"name": s.name, "status": s.status, "observed": s.observed, "missing": s.missing}
                for s in report.steps
            ],
        }
        if report.ok:
            return JobOutcome(ok=True, result=result)
        return JobOutcome(
            ok=False,
            result=result | {"aborted_at": report.aborted_at},
            error=report.abort_reason,
        )
