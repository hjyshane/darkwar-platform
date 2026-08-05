"""Run a routine, verifying each step against the data it should produce.

The safety property worth stating plainly: this never taps blind. A step
that declares `expect` is only considered done once the journal shows that
command arriving after the tap. If it does not arrive, the run STOPS.

That matters because the failure mode of screen automation is not "nothing
happens" — it is "the layout moved and the taps now land on whatever is
under those coordinates". Continuing through a routine whose position is
unknown is how automation sends messages, spends resources, or leaves an
alliance. Aborting on the first unverified step bounds the damage to one
tap on a screen we can name.

It also means capture must be running. If it is not, step one times out
and says so, which is the correct outcome: a routine that opens screens
nobody is recording accomplishes nothing.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field

import structlog

from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.adb import AdbClient, AdbError
from dw_collector.ui_worker.idle import IdlePolicy
from dw_collector.ui_worker.routine import Routine, Step

log = structlog.get_logger()

POLL_SECONDS = 1.0


def _coord(step: Step, field: str) -> int:
    """Step.model_validator already guarantees these; this narrows the type
    without an assert and keeps the message useful if that ever changes."""
    value: int | None = getattr(step, field)
    if value is None:  # pragma: no cover - unreachable via Routine.load
        msg = f"step {step.name!r} is missing {field}"
        raise ValueError(msg)
    return value


class _Interrupted(Exception):  # noqa: N818 - not an error, a stop request
    """The operator asked for the run to end while it was waiting.

    Carried as an exception rather than a third return value because the
    wait can be interrupted several frames down and every caller of
    `_await_commands` would otherwise have to remember to check.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class StepResult:
    name: str
    status: str  # "ok" | "unverified" | "skipped"
    observed: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)


@dataclass
class RunReport:
    routine: str
    steps: list[StepResult] = field(default_factory=list)
    aborted_at: str | None = None
    abort_reason: str | None = None

    @property
    def ok(self) -> bool:
        return self.aborted_at is None


class RoutineRunner:
    def __init__(
        self,
        client: AdbClient,
        journal: Journal,
        *,
        idle: IdlePolicy | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.client = client
        self.journal = journal
        self.idle = idle
        self._sleep = sleep

    def _perform(self, step: Step) -> None:
        if step.action == "tap":
            self.client.tap(_coord(step, "x"), _coord(step, "y"))
        elif step.action == "swipe":
            self.client.swipe(
                _coord(step, "x"),
                _coord(step, "y"),
                _coord(step, "to_x"),
                _coord(step, "to_y"),
                step.duration_ms,
            )
        elif step.action == "back":
            self.client.back()
        # "wait" performs nothing; settle_seconds is the whole point of it.

    def _stop_requested(self) -> str | None:
        """The two reasons to abandon a run, in the order they are cheap."""
        if self.client.policy.kill_switch_engaged():
            return "kill switch engaged"
        if self.idle is not None and not self.client.dry_run:
            state = self.idle.evaluate()
            if not state.is_idle:
                return f"operator is active — {state.reason}"
        return None

    def _await_commands(self, step: Step, mark: int) -> tuple[list[str], list[str]]:
        """Poll the journal until every expected command has been seen.

        Checked inside the loop, not only between steps. A wait is up to
        `timeout_seconds` long — 150s in the routines that sweep the
        cross-server board — and the kill switch existing to stop automation
        (FR-OPS-006) is worth very little if engaging it does nothing for two
        and a half minutes. That is not hypothetical: an operator sat down
        mid-run, the switch was engaged, and the run had to be killed by pid
        because it was in the middle of a wait.
        """
        wanted = set(step.expect)
        seen: set[str] = set()
        deadline = time.monotonic() + step.timeout_seconds
        while True:
            seen |= {c for c in self.journal.commands_after(mark) if c in wanted}
            if wanted <= seen:
                return sorted(seen), []
            if time.monotonic() >= deadline:
                return sorted(seen), sorted(wanted - seen)
            reason = self._stop_requested()
            if reason is not None:
                raise _Interrupted(reason)
            self._sleep(POLL_SECONDS)

    def run(self, routine: Routine) -> RunReport:
        report = RunReport(routine=routine.name)
        for step in routine.steps:
            # Re-checked every step, not once at the start: the operator must
            # be able to stop a running routine mid-way (FR-OPS-006). The same
            # check runs inside the wait — see _await_commands.
            #
            # Stopping leaves the emulator on some inner screen, which is
            # untidy but harmless; the alternative is fighting the operator
            # for the mouse. Dry runs skip the idle half because they touch
            # nothing to begin with (FR-COL-009).
            reason = self._stop_requested()
            if reason is not None:
                report.aborted_at = step.name
                report.abort_reason = reason
                log.warning("ui_worker.stopped", step=step.name, reason=reason)
                return report

            # Taken before the tap, so anything journalled from here on is
            # this step's doing. A timestamp cannot draw that line on Windows
            # — see Journal.watermark.
            mark = self.journal.watermark()
            try:
                self._perform(step)
            # AdbGuardError is NOT caught: "never caught to continue" is the
            # guard's stated contract, and a guard failure mid-routine means
            # the target changed under us. That must be loud, not a line in
            # a report the caller might not read. Device faults are different
            # — those are expected operationally and belong in the report.
            except (AdbError, OSError) as exc:
                report.aborted_at = step.name
                report.abort_reason = str(exc)
                log.error("ui_worker.step_failed", step=step.name, error=str(exc))
                return report

            self._sleep(step.settle_seconds)

            if not step.expect:
                report.steps.append(StepResult(step.name, "skipped"))
                continue
            # dry-run performs no taps, so nothing can arrive; verifying
            # would fail every step for the wrong reason.
            if self.client.dry_run:
                report.steps.append(StepResult(step.name, "skipped"))
                continue

            try:
                observed, missing = self._await_commands(step, mark)
            except _Interrupted as stop:
                report.aborted_at = step.name
                report.abort_reason = stop.reason
                log.warning("ui_worker.stopped", step=step.name, reason=stop.reason)
                return report
            if missing:
                report.steps.append(StepResult(step.name, "unverified", observed, missing))
                report.aborted_at = step.name
                report.abort_reason = (
                    f"expected {missing} after {step.timeout_seconds}s but saw {observed or 'none'}"
                    " — screen state is unknown, so no further taps"
                )
                log.error("ui_worker.unverified", step=step.name, missing=missing)
                return report
            report.steps.append(StepResult(step.name, "ok", observed))
            log.info("ui_worker.step_ok", step=step.name, observed=observed)
        return report
