"""dw-jobs: pull refresh jobs from Supabase and run them on this PC.

Outbound only (§4 principle 10). The cloud queues work; this polls for it.
Nothing listens on a port.

Runs alongside `dw-capture`, not instead of it: a routine opens screens so
the game sends data, and something has to be recording when it arrives.
Without capture running, every step fails verification and the routine stops
at step one — correctly, since it would otherwise be tapping through screens
nobody is reading.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import httpx
import structlog

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector.envfile import load_env_file
from dw_collector.jobs.executor import RoutineExecutor
from dw_collector.jobs.worker import JobsConfig, JobWorker
from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.guard import AdbPolicy
from dw_collector.ui_worker.idle import IdlePolicy

log = structlog.get_logger()

DEFAULT_INTERVAL_SECONDS = 30.0


def main() -> None:
    load_env_file()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    collector_id = os.environ.get("DW_COLLECTOR_ID")
    if not url or not key or not collector_id:
        raise SystemExit("SUPABASE_URL, SUPABASE_SECRET_KEY and DW_COLLECTOR_ID are required")

    interval = float(os.environ.get("DW_JOBS_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS))
    routines_dir = Path(os.environ.get("DW_ROUTINES_DIR", "./routines"))
    policy = AdbPolicy.from_env()
    idle = IdlePolicy.from_env()

    journal = Journal(Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db")))
    journal.init_db()

    executor = RoutineExecutor(
        routines_dir=routines_dir,
        journal=journal,
        policy=policy,
        idle=idle,
        adb=os.environ.get("DW_ADB_EXECUTABLE", "adb"),
    )
    worker = JobWorker(
        JobsConfig(supabase_url=url, secret_key=key, collector_id=collector_id),
        executor,
    )

    log.info("jobs.start", interval=interval, routines_dir=str(routines_dir))
    try:
        while True:
            # Checked before claiming, not only before tapping. Claiming a job
            # just to abort it would count an attempt and eventually
            # dead-letter work the operator merely paused (FR-OPS-006).
            if policy.kill_switch_engaged():
                log.info("jobs.paused", reason="kill switch engaged")
                time.sleep(interval)
                continue
            try:
                stats = worker.poll_once()
                if stats.claimed:
                    log.info(
                        "jobs.poll",
                        claimed=stats.claimed,
                        succeeded=stats.succeeded,
                        failed=stats.failed,
                        dead_lettered=stats.dead_lettered,
                    )
            except httpx.HTTPError as exc:
                # Supabase being unreachable is the normal condition this has
                # to survive: jobs stay queued and the next tick retries.
                log.warning("jobs.poll_failed", error=str(exc))
            time.sleep(interval)
    except KeyboardInterrupt:
        log.info("jobs.stop")
    finally:
        journal.close()


if __name__ == "__main__":
    main()
