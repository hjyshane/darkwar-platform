"""Run the due actions one at a time, from home, with a pause switch.

Pause is a file. While it exists nothing here touches the game, so a person
can log in by hand; the service closes the game when the pause starts and
relaunches it when the file is removed.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from pathlib import Path

import structlog

from dw_collector.cloud.actions import DEFAULT_ACTIONS, Action, Context, Result, go_home
from dw_collector.cloud.device import Device
from dw_collector.cloud.popups import ensure_home
from dw_collector.cloud.schedule import Schedule
from dw_collector.ui_worker.guard import AdbGuardError

log = structlog.get_logger()


def is_paused(pause_file: Path) -> bool:
    return pause_file.exists()


def run_due(
    device: Device,
    schedule: Schedule,
    *,
    actions: Sequence[Action] = DEFAULT_ACTIONS,
    clock: Callable[[], float] = time.time,
    sleep: Callable[[float], None] = time.sleep,
    alert: Callable[[str, str], None] = lambda kind, detail: None,
    unknown_dir: Path | None = None,
) -> list[str]:
    """Run every action that is due. Returns the names that ran."""
    ran: list[str] = []
    ctx = Context(device, sleep=sleep)
    for action in actions:
        now = clock()
        if not schedule.is_due(action.name, now):
            continue
        if not ensure_home(device, sleep=sleep, unknown_dir=unknown_dir).ok:
            if schedule.failed("_home", now, "home unreachable"):
                alert("routines_disabled", "home unreachable repeatedly")
            return ran
        schedule.succeeded("_home", now, 0)
        ran.append(action.name)
        try:
            result = action.run(ctx)
        except AdbGuardError:
            raise
        except Exception as exc:
            result = Result(False, f"{type(exc).__name__}: {exc}")
        if result.ok:
            schedule.succeeded(action.name, clock(), result.next_in)
            log.info("cloud.action", name=action.name, detail=result.detail)
        else:
            log.warning("cloud.action_failed", name=action.name, detail=result.detail)
            if schedule.failed(action.name, clock(), result.detail):
                alert("action_disabled", f"{action.name}: {result.detail}")
        go_home(ctx)
    return ran
