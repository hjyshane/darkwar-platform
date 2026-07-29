from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import sqlite3
import time
from typing import Any

from .adb_control import (
    AdbClient,
    AdbError,
    load_tap_sequence,
    resolve_adb_path,
    scaled_tap,
)
from .config import AppConfig, load_config
from .database import Database, safe_json_dumps, utc_now
from .idle_detection import get_idle_state, interruptible_sleep
from .refresh_control import (
    ACTIVE_JOB_STATUSES,
    WORKFLOW_LABELS,
    all_freshness,
    ensure_weekly_job,
    load_job_details,
    parse_time,
    workflow_freshness,
)

UTC = dt.timezone.utc


class UserBecameActive(RuntimeError):
    pass


class WorkflowSetupRequired(RuntimeError):
    pass


def setup_logging(verbose: bool = False) -> logging.Logger:
    Path("logs").mkdir(exist_ok=True)
    logger = logging.getLogger("darkwar.refresh_worker")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s"
    )
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    logger.addHandler(console)
    handler = RotatingFileHandler(
        "logs/refresh_worker.log",
        maxBytes=5_000_000,
        backupCount=4,
        encoding="utf-8",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    return logger


def _connect(path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _status_update(
    connection: sqlite3.Connection,
    job_id: int,
    *,
    status: str,
    error: str | None = None,
    current_step: str | None = None,
    started: bool = False,
    finished: bool = False,
    increment_attempt: bool = False,
) -> None:
    now = utc_now()
    fields = ["status = ?", "last_activity_at = ?"]
    values: list[Any] = [status, now]
    if error is not None:
        fields.append("last_error = ?")
        values.append(error)
    if current_step is not None:
        fields.append("current_step = ?")
        values.append(current_step)
    if started:
        fields.append("started_at = COALESCE(started_at, ?)")
        values.append(now)
    if finished:
        fields.append("finished_at = ?")
        values.append(now)
    if increment_attempt:
        fields.append("attempt_count = attempt_count + 1")
    values.append(job_id)
    with connection:
        connection.execute(
            f"UPDATE refresh_jobs SET {', '.join(fields)} WHERE job_id = ?",
            values,
        )


def _step_update(
    connection: sqlite3.Connection,
    step_id: int,
    *,
    status: str,
    error: str | None = None,
    started: bool = False,
    finished: bool = False,
    details: dict[str, Any] | None = None,
) -> None:
    now = utc_now()
    fields = ["status = ?"]
    values: list[Any] = [status]
    if error is not None:
        fields.append("last_error = ?")
        values.append(error)
    if started:
        fields.append("started_at = COALESCE(started_at, ?)")
        values.append(now)
    if finished:
        fields.append("finished_at = ?")
        values.append(now)
    if details is not None:
        fields.append("details_json = ?")
        values.append(safe_json_dumps(details, compact=True))
    values.append(step_id)
    with connection:
        connection.execute(
            f"UPDATE refresh_job_steps SET {', '.join(fields)} WHERE step_id = ?",
            values,
        )


def _sequence_path(config: AppConfig, workflow_id: str) -> Path:
    return config.refresh_automation.sequence_dir / f"{workflow_id}.json"


class RefreshWorker:
    def __init__(self, config: AppConfig, logger: logging.Logger) -> None:
        self.config = config
        self.logger = logger
        refresh = config.refresh_automation
        self._adb: AdbClient | None = None


    @property
    def adb(self) -> AdbClient:
        if self._adb is None:
            refresh = self.config.refresh_automation
            adb_path = resolve_adb_path(refresh.adb_path)
            self._adb = AdbClient(adb_path, refresh.device_serial)
        return self._adb

    def idle_or_raise(self) -> None:
        refresh = self.config.refresh_automation
        state = get_idle_state(refresh.idle_seconds_required)
        if not state.is_idle:
            raise UserBecameActive(state.reason)

    def _wait(self, seconds: float) -> None:
        refresh = self.config.refresh_automation
        if not interruptible_sleep(
            seconds,
            refresh.idle_seconds_required,
            check_interval_seconds=refresh.interrupt_check_seconds,
        ):
            raise UserBecameActive("user activity detected during automation")

    def _verify_until(
        self,
        workflow_id: str,
        fresh_after: dt.datetime,
    ) -> bool:
        refresh = self.config.refresh_automation
        deadline = time.monotonic() + refresh.verification_timeout_seconds
        while time.monotonic() < deadline:
            self.idle_or_raise()
            connection = _connect(self.config.database.path)
            try:
                freshness = workflow_freshness(
                    connection,
                    workflow_id,
                    fresh_after,
                    self.config,
                )
            finally:
                connection.close()
            if freshness.current:
                return True
            time.sleep(1.0)
        return False

    def _restart_and_wait_for_arena(
        self,
        fresh_after: dt.datetime,
    ) -> None:
        refresh = self.config.refresh_automation
        serial = self.adb.ensure_device()
        self.logger.info("ADB device: %s", serial)
        self.idle_or_raise()
        self.logger.info(
            "Restarting Dark War during idle time; startup should request arena info"
        )
        self.adb.launch_package(refresh.package, force_stop=True)
        self._wait(refresh.launch_wait_seconds)
        if not self._verify_until("arena", fresh_after):
            raise RuntimeError(
                "No new arena snapshot arrived after game startup. "
                "Confirm collector and game login state."
            )

    def _run_sequence(
        self,
        workflow_id: str,
        fresh_after: dt.datetime,
    ) -> None:
        refresh = self.config.refresh_automation
        sequence_path = _sequence_path(self.config, workflow_id)
        if not sequence_path.is_file():
            raise WorkflowSetupRequired(
                f"Missing calibration: {sequence_path}. "
                f"Run calibrate_refresh.bat and choose {workflow_id}."
            )

        sequence = load_tap_sequence(sequence_path)
        serial = self.adb.ensure_device()
        self.logger.info("ADB device: %s", serial)
        self.idle_or_raise()

        self.logger.info(
            "Restarting Dark War before workflow %s for deterministic navigation",
            workflow_id,
        )
        self.adb.launch_package(refresh.package, force_stop=True)
        self._wait(refresh.launch_wait_seconds)

        current_width, current_height = self.adb.screen_size()
        for index, step in enumerate(sequence.steps, start=1):
            self.idle_or_raise()
            x, y = scaled_tap(
                step,
                sequence,
                current_width,
                current_height,
            )
            self.logger.info(
                "%s step %s/%s: %s at (%s, %s)",
                workflow_id,
                index,
                len(sequence.steps),
                step.label,
                x,
                y,
            )
            self.adb.tap(x, y)
            self._wait(
                step.wait_seconds
                if step.wait_seconds is not None
                else refresh.tap_wait_seconds
            )

        if not self._verify_until(workflow_id, fresh_after):
            raise RuntimeError(
                f"Workflow {workflow_id} finished but required snapshot(s) "
                "were not captured. Confirm the collector is running and "
                "recalibrate the sequence if the UI changed."
            )

    def run_workflow(
        self,
        workflow_id: str,
        fresh_after: dt.datetime,
    ) -> None:
        if workflow_id == "arena":
            self._restart_and_wait_for_arena(fresh_after)
        else:
            self._run_sequence(workflow_id, fresh_after)

    def _reconcile_steps(
        self,
        connection: sqlite3.Connection,
        job: sqlite3.Row,
        fresh_after: dt.datetime,
    ) -> list[sqlite3.Row]:
        steps = connection.execute(
            """
            SELECT * FROM refresh_job_steps
            WHERE job_id = ?
            ORDER BY step_order
            """,
            (job["job_id"],),
        ).fetchall()
        for step in steps:
            if step["status"] in ("succeeded", "cancelled"):
                continue
            freshness = workflow_freshness(
                connection,
                str(step["workflow_id"]),
                fresh_after,
                self.config,
            )
            if freshness.current:
                _step_update(
                    connection,
                    int(step["step_id"]),
                    status="succeeded",
                    finished=True,
                    details={
                        "completion": "passive_or_previous_capture",
                        "latest_at": (
                            freshness.latest_at.isoformat()
                            if freshness.latest_at
                            else None
                        ),
                        "detail": freshness.detail,
                    },
                )
        return connection.execute(
            """
            SELECT * FROM refresh_job_steps
            WHERE job_id = ?
            ORDER BY step_order
            """,
            (job["job_id"],),
        ).fetchall()

    def process_job(self, job_id: int) -> bool:
        connection = _connect(self.config.database.path)
        try:
            job = connection.execute(
                "SELECT * FROM refresh_jobs WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            if not job or job["status"] == "cancelled":
                return False

            details = load_job_details(job)
            fresh_after = parse_time(details.get("fresh_after"))
            if fresh_after is None:
                fresh_after = parse_time(job["requested_at"]) or dt.datetime.now(UTC)

            steps = self._reconcile_steps(connection, job, fresh_after)
            remaining = [step for step in steps if step["status"] != "succeeded"]
            if not remaining:
                _status_update(
                    connection,
                    job_id,
                    status="succeeded",
                    current_step="complete",
                    finished=True,
                )
                self.logger.info("Refresh job %s already satisfied passively", job_id)
                return True

            self.idle_or_raise()
            _status_update(
                connection,
                job_id,
                status="running",
                current_step=str(remaining[0]["workflow_id"]),
                started=True,
                increment_attempt=True,
                error="",
            )

            for step in remaining:
                step_id = int(step["step_id"])
                workflow_id = str(step["workflow_id"])
                _status_update(
                    connection,
                    job_id,
                    status="running",
                    current_step=workflow_id,
                )
                _step_update(
                    connection,
                    step_id,
                    status="running",
                    started=True,
                    error="",
                )
                self.logger.info(
                    "Refresh job %s: %s",
                    job_id,
                    WORKFLOW_LABELS.get(workflow_id, workflow_id),
                )
                try:
                    self.run_workflow(workflow_id, fresh_after)
                except UserBecameActive:
                    _step_update(connection, step_id, status="queued")
                    raise
                except WorkflowSetupRequired as exc:
                    _step_update(
                        connection,
                        step_id,
                        status="waiting_setup",
                        error=str(exc),
                    )
                    _status_update(
                        connection,
                        job_id,
                        status="waiting_setup",
                        error=str(exc),
                        current_step=workflow_id,
                    )
                    self.logger.warning("%s", exc)
                    return False
                except Exception as exc:
                    _step_update(
                        connection,
                        step_id,
                        status="failed",
                        error=str(exc),
                        finished=True,
                    )
                    _status_update(
                        connection,
                        job_id,
                        status="partial",
                        error=str(exc),
                        current_step=workflow_id,
                    )
                    self.logger.exception(
                        "Refresh job %s workflow %s failed",
                        job_id,
                        workflow_id,
                    )
                    return False
                else:
                    _step_update(
                        connection,
                        step_id,
                        status="succeeded",
                        finished=True,
                        details={"completion": "automation"},
                    )

            _status_update(
                connection,
                job_id,
                status="succeeded",
                current_step="complete",
                finished=True,
                error="",
            )
            self.logger.info("Refresh job %s completed", job_id)
            return True
        except UserBecameActive as exc:
            _status_update(
                connection,
                job_id,
                status="waiting_idle",
                error=str(exc),
            )
            self.logger.info("Refresh job %s paused: %s", job_id, exc)
            return False
        finally:
            connection.close()


def next_runnable_job(
    database_path: str | Path,
) -> int | None:
    connection = _connect(database_path)
    try:
        now = utc_now()
        placeholders = ",".join("?" for _ in ACTIVE_JOB_STATUSES)
        row = connection.execute(
            f"""
            SELECT job_id
            FROM refresh_jobs
            WHERE status IN ({placeholders})
              AND status <> 'waiting_setup'
              AND datetime(not_before) <= datetime(?)
            ORDER BY priority, datetime(scheduled_for), job_id
            LIMIT 1
            """,
            (*ACTIVE_JOB_STATUSES, now),
        ).fetchone()
        return int(row[0]) if row else None
    finally:
        connection.close()


def requeue_ready_setup_jobs(
    database_path: str | Path,
    config: AppConfig,
) -> int:
    connection = _connect(database_path)
    changed = 0
    try:
        rows = connection.execute(
            """
            SELECT DISTINCT j.job_id
            FROM refresh_jobs j
            JOIN refresh_job_steps s ON s.job_id = j.job_id
            WHERE j.status = 'waiting_setup'
              AND s.status = 'waiting_setup'
            """
        ).fetchall()
        for row in rows:
            job_id = int(row["job_id"])
            steps = connection.execute(
                """
                SELECT step_id, workflow_id
                FROM refresh_job_steps
                WHERE job_id = ? AND status = 'waiting_setup'
                """,
                (job_id,),
            ).fetchall()
            ready = all(
                _sequence_path(config, str(step["workflow_id"])).is_file()
                for step in steps
            )
            if ready:
                with connection:
                    connection.execute(
                        """
                        UPDATE refresh_job_steps
                        SET status = 'queued', last_error = NULL
                        WHERE job_id = ? AND status = 'waiting_setup'
                        """,
                        (job_id,),
                    )
                    connection.execute(
                        """
                        UPDATE refresh_jobs
                        SET status = 'queued', last_error = NULL,
                            last_activity_at = ?
                        WHERE job_id = ?
                        """,
                        (utc_now(), job_id),
                    )
                changed += 1
        return changed
    finally:
        connection.close()


def run_loop(config: AppConfig, logger: logging.Logger) -> int:
    refresh = config.refresh_automation
    if not refresh.enabled:
        logger.error(
            "Refresh automation is disabled. Add [refresh_automation] to "
            "config.toml and set enabled = true."
        )
        return 2

    # Ensure the schema exists even when the worker starts before dashboard.
    database = Database(config.database.path, top_n=config.tracking.top_n)
    database.close()
    worker = RefreshWorker(config, logger)

    while True:
        try:
            ensure_weekly_job(config.database.path, config)
            requeue_ready_setup_jobs(config.database.path, config)
            job_id = next_runnable_job(config.database.path)
            if job_id is None:
                time.sleep(refresh.poll_seconds)
                continue
            worker.process_job(job_id)
        except KeyboardInterrupt:
            logger.info("Refresh worker stopped")
            return 0
        except (AdbError, OSError, sqlite3.Error):
            logger.exception("Refresh worker loop error")
            time.sleep(refresh.poll_seconds)


def print_status(config: AppConfig) -> None:
    ensure_weekly_job(config.database.path, config)
    connection = _connect(config.database.path)
    try:
        jobs = connection.execute(
            """
            SELECT job_id, job_type, trigger_type, status, current_step,
                   requested_at, scheduled_for, last_error
            FROM refresh_jobs
            ORDER BY job_id DESC
            LIMIT 20
            """
        ).fetchall()
        print(f"enabled={config.refresh_automation.enabled}")
        print(f"weekly_enabled={config.refresh_automation.weekly_enabled}")
        print(f"idle_seconds_required={config.refresh_automation.idle_seconds_required}")
        print(f"jobs={len(jobs)}")
        for row in jobs:
            print(
                f"#{row['job_id']} {row['job_type']} {row['status']} "
                f"step={row['current_step'] or '-'} "
                f"scheduled={row['scheduled_for']} "
                f"error={row['last_error'] or '-'}"
            )
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Idle-aware Dark War refresh queue. Weekly full refresh is "
            "scheduled for Monday server reset + 5 minutes."
        )
    )
    parser.add_argument("--config", default="config.toml")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    config = load_config(args.config)
    logger = setup_logging(args.verbose)

    database = Database(config.database.path, top_n=config.tracking.top_n)
    database.close()

    if args.status:
        print_status(config)
        return 0

    if args.once:
        ensure_weekly_job(config.database.path, config)
        job_id = next_runnable_job(config.database.path)
        if job_id is None:
            logger.info("No runnable refresh job")
            return 0
        try:
            return 0 if RefreshWorker(config, logger).process_job(job_id) else 1
        except (AdbError, OSError, sqlite3.Error):
            logger.exception("Refresh worker failed")
            return 1

    return run_loop(config, logger)


if __name__ == "__main__":
    raise SystemExit(main())
