"""Pull refresh jobs from Supabase and run them here.

Direction matters (§4 principle 10): the cloud never reaches into this PC.
The worker makes an outbound connection, claims work, and reports back. There
is no inbound port and nothing to expose.

The queue is *data*, not instructions. A job says which routine to run by
name; it does not carry steps, coordinates, or paths. `executor.py` resolves
that name against a local directory and refuses anything that escapes it, so
a bad row in the database cannot make the collector open an arbitrary file
or tap arbitrary coordinates.

Claiming is a conditional update — `PATCH ...&status=eq.queued` — so the row
only moves if it was still queued when the write landed. Two workers racing
means one gets an empty response and moves on, without needing an RPC or a
lock. That is enough here, and it degrades correctly if a second collector
is ever added.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import structlog

log = structlog.get_logger()

TABLE = "refresh_jobs"
RUNS_TABLE = "workflow_runs"


@dataclass(frozen=True)
class JobsConfig:
    supabase_url: str
    secret_key: str
    collector_id: str
    batch_size: int = 5
    max_attempts: int = 5
    base_backoff_seconds: float = 30.0
    max_backoff_seconds: float = 3600.0


@dataclass(frozen=True)
class Job:
    job_id: str
    job_type: str
    payload: dict[str, Any]
    attempt_count: int


@dataclass
class JobOutcome:
    ok: bool
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    #: Retrying cannot help — an unknown job type, a routine name that does
    #: not exist. Dead-letters immediately instead of burning five attempts
    #: over an hour to reach the same conclusion.
    permanent: bool = False


#: (job) -> outcome. Injected so the worker's state machine is testable
#: without ADB, an emulator, or a running capture.
Executor = Callable[[Job], JobOutcome]


@dataclass
class PollStats:
    claimed: int = 0
    succeeded: int = 0
    failed: int = 0
    dead_lettered: int = 0


class JobWorker:
    def __init__(
        self,
        config: JobsConfig,
        execute: Executor,
        client: httpx.Client | None = None,
    ) -> None:
        self.config = config
        self.execute = execute
        self.client = client or httpx.Client(
            base_url=config.supabase_url,
            headers={
                "apikey": config.secret_key,
                "Authorization": f"Bearer {config.secret_key}",
            },
            timeout=30.0,
        )

    # -- queue access --------------------------------------------------------

    def candidates(self, now: datetime) -> list[Job]:
        """Queued, due, and either unassigned or addressed to this collector."""
        resp = self.client.get(
            f"/rest/v1/{TABLE}",
            params={
                "status": "eq.queued",
                "next_attempt_at": f"lte.{now.isoformat()}",
                "or": f"(collector_id.is.null,collector_id.eq.{self.config.collector_id})",
                "order": "priority.asc,created_at.asc",
                "limit": str(self.config.batch_size),
                "select": "job_id,job_type,payload,attempt_count",
            },
        )
        resp.raise_for_status()
        rows: list[dict[str, Any]] = resp.json()
        return [
            Job(
                job_id=str(row["job_id"]),
                job_type=str(row["job_type"]),
                payload=dict(row.get("payload") or {}),
                attempt_count=int(row.get("attempt_count") or 0),
            )
            for row in rows
        ]

    def claim(self, job: Job, now: datetime) -> bool:
        """Take the job, or report that someone else already did.

        The `status=eq.queued` filter is the whole mechanism: PostgREST turns
        it into `UPDATE ... WHERE job_id = ? AND status = 'queued' RETURNING`,
        which either matches a row or does not.
        """
        resp = self.client.patch(
            f"/rest/v1/{TABLE}",
            params={"job_id": f"eq.{job.job_id}", "status": "eq.queued"},
            json={
                "status": "claimed",
                "collector_id": self.config.collector_id,
                "claimed_at": now.isoformat(),
                "attempt_count": job.attempt_count + 1,
            },
            headers={"Prefer": "return=representation"},
        )
        resp.raise_for_status()
        claimed: list[dict[str, Any]] = resp.json()
        return bool(claimed)

    def _patch(self, job_id: str, body: dict[str, Any]) -> None:
        resp = self.client.patch(
            f"/rest/v1/{TABLE}",
            params={"job_id": f"eq.{job_id}"},
            json=body,
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()

    def _record_run(
        self,
        job: Job,
        *,
        status: str,
        started_at: datetime,
        finished_at: datetime,
        outcome: JobOutcome,
    ) -> None:
        """One row per attempt, so a job that failed twice shows both.

        Never fatal: losing the audit trail is bad, but losing it is not a
        reason to leave the job itself stuck in `running`.
        """
        try:
            resp = self.client.post(
                f"/rest/v1/{RUNS_TABLE}",
                json={
                    "run_id": str(uuid.uuid4()),
                    "collector_id": self.config.collector_id,
                    "refresh_job_id": job.job_id,
                    "workflow": job.job_type,
                    "status": status,
                    "started_at": started_at.isoformat(),
                    "finished_at": finished_at.isoformat(),
                    "result": outcome.result,
                    "error": outcome.error,
                },
                headers={"Prefer": "return=minimal"},
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            log.warning("jobs.run_not_recorded", job_id=job.job_id, error=str(exc))

    def backoff_seconds(self, attempt: int) -> float:
        return min(
            self.config.base_backoff_seconds * (2 ** max(0, attempt - 1)),
            self.config.max_backoff_seconds,
        )

    # -- execution -----------------------------------------------------------

    def run_claimed(self, job: Job, now: datetime, stats: PollStats) -> None:
        started = now
        self._patch(job.job_id, {"status": "running", "started_at": started.isoformat()})

        try:
            outcome = self.execute(job)
        except Exception as exc:
            # Deliberately broad. FR-COL-003 applied to jobs: an unexpected
            # executor error is a failed job, not a dead collector. Recorded
            # with its type so the cause is not flattened to a bare message.
            outcome = JobOutcome(ok=False, error=f"{type(exc).__name__}: {exc}")
            log.exception("jobs.executor_raised", job_id=job.job_id, job_type=job.job_type)

        finished = datetime.now(tz=UTC)
        attempt = job.attempt_count + 1

        if outcome.ok:
            self._patch(
                job.job_id,
                {"status": "succeeded", "finished_at": finished.isoformat(), "last_error": None},
            )
            self._record_run(
                job,
                status="succeeded",
                started_at=started,
                finished_at=finished,
                outcome=outcome,
            )
            stats.succeeded += 1
            log.info("jobs.succeeded", job_id=job.job_id, job_type=job.job_type)
            return

        exhausted = outcome.permanent or attempt >= self.config.max_attempts
        if exhausted:
            self._patch(
                job.job_id,
                {
                    "status": "dead_letter",
                    "finished_at": finished.isoformat(),
                    "last_error": outcome.error,
                },
            )
            stats.dead_lettered += 1
            log.error(
                "jobs.dead_letter",
                job_id=job.job_id,
                job_type=job.job_type,
                attempts=attempt,
                reason="permanent" if outcome.permanent else "attempts exhausted",
                error=outcome.error,
            )
        else:
            retry_at = finished + timedelta(seconds=self.backoff_seconds(attempt))
            self._patch(
                job.job_id,
                {
                    "status": "queued",
                    "next_attempt_at": retry_at.isoformat(),
                    "last_error": outcome.error,
                },
            )
            stats.failed += 1
            log.warning(
                "jobs.retry",
                job_id=job.job_id,
                job_type=job.job_type,
                attempt=attempt,
                retry_at=retry_at.isoformat(),
                error=outcome.error,
            )

        self._record_run(
            job,
            status="dead_letter" if exhausted else "failed",
            started_at=started,
            finished_at=finished,
            outcome=outcome,
        )

    def poll_once(self, now: datetime | None = None) -> PollStats:
        moment = now or datetime.now(tz=UTC)
        stats = PollStats()
        for job in self.candidates(moment):
            if not self.claim(job, moment):
                continue
            stats.claimed += 1
            self.run_claimed(job, datetime.now(tz=UTC), stats)
        return stats
