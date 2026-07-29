from __future__ import annotations

from dataclasses import dataclass
import datetime as dt
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterable

from .config import AppConfig
from .database import safe_json_dumps, utc_now

UTC = dt.timezone.utc


WORKFLOW_LABELS: dict[str, str] = {
    "arena": "Arena",
    "rankings": "Player + alliance rankings",
    "my_alliance": "My alliance members",
    "tracked_alliances": "Tracked alliance members",
    "full_weekly_ui": "Weekly core screens",
}

JOB_STEPS: dict[str, tuple[str, ...]] = {
    "arena": ("arena",),
    "rankings": ("rankings",),
    "my_alliance": ("my_alliance",),
    "tracked_alliances": ("tracked_alliances",),
    "full_weekly": (
        "arena",
        "full_weekly_ui",
    ),
}

ACTIVE_JOB_STATUSES = (
    "queued",
    "waiting_idle",
    "running",
    "waiting_setup",
    "partial",
)


@dataclass(frozen=True)
class WeekWindow:
    key: str
    reset_at: dt.datetime
    scheduled_at: dt.datetime
    next_reset_at: dt.datetime


@dataclass(frozen=True)
class WorkflowFreshness:
    workflow_id: str
    latest_at: dt.datetime | None
    current: bool
    coverage_current: int | None = None
    coverage_total: int | None = None
    detail: str = ""


def parse_time(value: Any) -> dt.datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def current_week_window(
    now: dt.datetime,
    config: AppConfig,
) -> WeekWindow:
    refresh = config.refresh_automation
    now = now.astimezone(UTC)
    weekday = refresh.weekly_weekday_utc
    days_since = (now.weekday() - weekday) % 7
    candidate_date = now.date() - dt.timedelta(days=days_since)
    candidate = dt.datetime(
        candidate_date.year,
        candidate_date.month,
        candidate_date.day,
        refresh.reset_hour_utc,
        refresh.reset_minute_utc,
        tzinfo=UTC,
    )
    if now < candidate:
        candidate -= dt.timedelta(days=7)
    scheduled = candidate + dt.timedelta(
        seconds=refresh.weekly_delay_seconds
    )
    return WeekWindow(
        key=candidate.strftime("%Y-%m-%dT%H:%MZ"),
        reset_at=candidate,
        scheduled_at=scheduled,
        next_reset_at=candidate + dt.timedelta(days=7),
    )


def next_weekly_target(
    now: dt.datetime,
    config: AppConfig,
) -> dt.datetime:
    window = current_week_window(now, config)
    if now.astimezone(UTC) < window.scheduled_at:
        return window.scheduled_at
    return window.scheduled_at + dt.timedelta(days=7)


def _open_connection(path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _own_alliance_id(
    connection: sqlite3.Connection,
    config: AppConfig,
) -> str | None:
    code = config.activity.own_alliance_code
    if code:
        row = connection.execute(
            """
            SELECT alliance_id
            FROM alliances
            WHERE UPPER(code) = UPPER(?)
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (code,),
        ).fetchone()
        if row:
            return str(row[0])

    row = connection.execute(
        """
        SELECT alliance_id
        FROM member_snapshots
        WHERE presence_redacted = 0
        ORDER BY snapshot_id DESC
        LIMIT 1
        """
    ).fetchone()
    return str(row[0]) if row else None


def _max_time(
    connection: sqlite3.Connection,
    sql: str,
    params: tuple[Any, ...] = (),
) -> dt.datetime | None:
    row = connection.execute(sql, params).fetchone()
    return parse_time(row[0]) if row else None


def workflow_freshness(
    connection: sqlite3.Connection,
    workflow_id: str,
    fresh_after: dt.datetime,
    config: AppConfig,
) -> WorkflowFreshness:
    threshold = fresh_after.astimezone(UTC)

    if workflow_id == "arena":
        latest = _max_time(
            connection,
            "SELECT MAX(captured_at) FROM arena_snapshots",
        )
        return WorkflowFreshness(
            workflow_id,
            latest,
            bool(latest and latest >= threshold),
        )

    if workflow_id == "rankings":
        player_latest = _max_time(
            connection,
            "SELECT MAX(captured_at) FROM player_ranking_snapshots",
        )
        alliance_latest = _max_time(
            connection,
            "SELECT MAX(captured_at) FROM ranking_snapshots",
        )
        candidates = [
            value for value in (player_latest, alliance_latest) if value
        ]
        latest = min(candidates) if len(candidates) == 2 else None
        current = bool(
            player_latest
            and alliance_latest
            and player_latest >= threshold
            and alliance_latest >= threshold
        )
        detail = (
            f"player={player_latest.isoformat() if player_latest else 'none'}, "
            f"alliance={alliance_latest.isoformat() if alliance_latest else 'none'}"
        )
        return WorkflowFreshness(
            workflow_id,
            latest,
            current,
            detail=detail,
        )

    if workflow_id == "my_alliance":
        alliance_id = _own_alliance_id(connection, config)
        if not alliance_id:
            return WorkflowFreshness(
                workflow_id,
                None,
                False,
                detail="own alliance not resolved",
            )
        latest = _max_time(
            connection,
            """
            SELECT MAX(captured_at)
            FROM member_snapshots
            WHERE alliance_id = ? AND presence_redacted = 0
            """,
            (alliance_id,),
        )
        return WorkflowFreshness(
            workflow_id,
            latest,
            bool(latest and latest >= threshold),
            detail=f"alliance_id={alliance_id}",
        )

    if workflow_id == "tracked_alliances":
        tracked = connection.execute(
            """
            SELECT alliance_id
            FROM tracked_alliances
            WHERE enabled = 1
            ORDER BY server_id, server_rank
            """
        ).fetchall()
        alliance_ids = [str(row[0]) for row in tracked]
        if not alliance_ids:
            return WorkflowFreshness(
                workflow_id,
                None,
                True,
                coverage_current=0,
                coverage_total=0,
                detail="no tracked alliances enabled",
            )

        placeholders = ",".join("?" for _ in alliance_ids)
        rows = connection.execute(
            f"""
            SELECT alliance_id, MAX(captured_at) AS latest_at
            FROM member_snapshots
            WHERE alliance_id IN ({placeholders})
            GROUP BY alliance_id
            """,
            alliance_ids,
        ).fetchall()
        latest_by_id = {
            str(row["alliance_id"]): parse_time(row["latest_at"])
            for row in rows
        }
        current_values = [
            latest_by_id.get(alliance_id)
            for alliance_id in alliance_ids
            if latest_by_id.get(alliance_id)
            and latest_by_id[alliance_id] >= threshold
        ]
        current_count = len(current_values)
        all_values = [
            value for value in latest_by_id.values() if value is not None
        ]
        latest = min(all_values) if len(all_values) == len(alliance_ids) else None
        return WorkflowFreshness(
            workflow_id,
            latest,
            current_count == len(alliance_ids),
            coverage_current=current_count,
            coverage_total=len(alliance_ids),
            detail=f"{current_count}/{len(alliance_ids)} current",
        )

    if workflow_id == "full_weekly_ui":
        parts = [
            workflow_freshness(
                connection, child, threshold, config
            )
            for child in (
                "rankings",
                "my_alliance",
                "tracked_alliances",
            )
        ]
        latest_values = [part.latest_at for part in parts if part.latest_at]
        latest = min(latest_values) if len(latest_values) == 3 else None
        return WorkflowFreshness(
            workflow_id,
            latest,
            all(part.current for part in parts),
            detail="; ".join(
                f"{part.workflow_id}={part.detail or part.current}"
                for part in parts
            ),
        )

    raise ValueError(f"Unknown refresh workflow: {workflow_id}")


def all_freshness(
    connection: sqlite3.Connection,
    fresh_after: dt.datetime,
    config: AppConfig,
) -> dict[str, WorkflowFreshness]:
    return {
        workflow_id: workflow_freshness(
            connection,
            workflow_id,
            fresh_after,
            config,
        )
        for workflow_id in (
            "arena", "rankings", "my_alliance", "tracked_alliances"
        )
    }


def queue_job(
    database_path: str | Path,
    job_type: str,
    *,
    config: AppConfig,
    trigger_type: str = "manual",
    scheduled_for: dt.datetime | None = None,
    fresh_after: dt.datetime | None = None,
    week_key: str | None = None,
    priority: int = 100,
    idle_required: bool = True,
    details: dict[str, Any] | None = None,
) -> int:
    if job_type not in JOB_STEPS:
        raise ValueError(f"Unknown refresh job type: {job_type}")

    now = dt.datetime.now(UTC)
    requested_at = now.isoformat()
    scheduled = (scheduled_for or now).astimezone(UTC).isoformat()
    threshold = (fresh_after or now).astimezone(UTC).isoformat()
    payload = dict(details or {})
    payload["fresh_after"] = threshold

    connection = _open_connection(database_path)
    try:
        active_placeholders = ",".join("?" for _ in ACTIVE_JOB_STATUSES)
        existing = connection.execute(
            f"""
            SELECT job_id
            FROM refresh_jobs
            WHERE job_type = ?
              AND status IN ({active_placeholders})
              AND (
                    (? IS NULL AND trigger_type = 'manual')
                    OR week_key = ?
                  )
            ORDER BY job_id DESC
            LIMIT 1
            """,
            (job_type, *ACTIVE_JOB_STATUSES, week_key, week_key),
        ).fetchone()
        if existing:
            return int(existing[0])

        with connection:
            cursor = connection.execute(
                """
                INSERT INTO refresh_jobs (
                    job_type, trigger_type, week_key, requested_at,
                    scheduled_for, not_before, status, priority,
                    idle_required, attempt_count, details_json,
                    last_activity_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?)
                """,
                (
                    job_type,
                    trigger_type,
                    week_key,
                    requested_at,
                    scheduled,
                    scheduled,
                    int(priority),
                    1 if idle_required else 0,
                    safe_json_dumps(payload, compact=True),
                    requested_at,
                ),
            )
            job_id = int(cursor.lastrowid)
            for order, workflow_id in enumerate(JOB_STEPS[job_type], start=1):
                connection.execute(
                    """
                    INSERT INTO refresh_job_steps (
                        job_id, workflow_id, step_order, status,
                        details_json
                    )
                    VALUES (?, ?, ?, 'queued', '{}')
                    """,
                    (job_id, workflow_id, order),
                )
        return job_id
    finally:
        connection.close()


def ensure_weekly_job(
    database_path: str | Path,
    config: AppConfig,
    *,
    now: dt.datetime | None = None,
) -> int | None:
    refresh = config.refresh_automation
    if not refresh.enabled or not refresh.weekly_enabled:
        return None

    now = (now or dt.datetime.now(UTC)).astimezone(UTC)
    window = current_week_window(now, config)
    if now < window.scheduled_at:
        return None

    connection = _open_connection(database_path)
    try:
        existing = connection.execute(
            """
            SELECT job_id
            FROM refresh_jobs
            WHERE trigger_type = 'weekly'
              AND week_key = ?
              AND job_type = 'full_weekly'
            ORDER BY job_id DESC
            LIMIT 1
            """,
            (window.key,),
        ).fetchone()
        if existing:
            return int(existing[0])
    finally:
        connection.close()

    return queue_job(
        database_path,
        "full_weekly",
        config=config,
        trigger_type="weekly",
        scheduled_for=window.scheduled_at,
        fresh_after=window.reset_at,
        week_key=window.key,
        priority=10,
        idle_required=True,
        details={"policy": "Monday reset + 5 minutes; idle-aware"},
    )


def cancel_job(database_path: str | Path, job_id: int) -> bool:
    connection = _open_connection(database_path)
    try:
        with connection:
            cursor = connection.execute(
                """
                UPDATE refresh_jobs
                SET status = 'cancelled', finished_at = ?,
                    last_activity_at = ?
                WHERE job_id = ?
                  AND status IN (
                    'queued', 'waiting_idle', 'waiting_setup', 'partial'
                  )
                """,
                (utc_now(), utc_now(), int(job_id)),
            )
            connection.execute(
                """
                UPDATE refresh_job_steps
                SET status = 'cancelled', finished_at = ?
                WHERE job_id = ? AND status IN ('queued', 'waiting_setup')
                """,
                (utc_now(), int(job_id)),
            )
        return cursor.rowcount > 0
    finally:
        connection.close()


def load_job_details(row: sqlite3.Row) -> dict[str, Any]:
    try:
        return json.loads(str(row["details_json"] or "{}"))
    except (TypeError, json.JSONDecodeError):
        return {}


def active_jobs(
    connection: sqlite3.Connection,
) -> list[sqlite3.Row]:
    placeholders = ",".join("?" for _ in ACTIVE_JOB_STATUSES)
    return connection.execute(
        f"""
        SELECT *
        FROM refresh_jobs
        WHERE status IN ({placeholders})
        ORDER BY priority, scheduled_for, job_id
        """,
        ACTIVE_JOB_STATUSES,
    ).fetchall()
