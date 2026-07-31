"""Job worker state machine, against a scripted PostgREST double.

The executor is injected, so none of this needs ADB, an emulator, or a
running capture — the same seam that makes the rest of the pipeline
testable off Windows.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from dw_collector.jobs.worker import Job, JobOutcome, JobsConfig, JobWorker

COLLECTOR = "00000000-0000-4000-8000-00000000c777"


class FakeQueue:
    """refresh_jobs + workflow_runs, with the conditional claim honoured."""

    def __init__(self, jobs: list[dict[str, Any]]) -> None:
        self.jobs = {row["job_id"]: row for row in jobs}
        self.runs: list[dict[str, Any]] = []
        self.runs_fail = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        table = request.url.path.removeprefix("/rest/v1/")
        if table == "workflow_runs":
            if self.runs_fail:
                return httpx.Response(500, json={"message": "injected"})
            self.runs.append(json.loads(request.content))
            return httpx.Response(201, json=[])

        assert table == "refresh_jobs"
        if request.method == "GET":
            due = [j for j in self.jobs.values() if j["status"] == "queued"]
            return httpx.Response(200, json=due)

        assert request.method == "PATCH"
        params = dict(request.url.params)
        job_id = params["job_id"].removeprefix("eq.")
        row = self.jobs[job_id]
        # The claim carries status=eq.queued; honouring it is the point of
        # this double, since that filter is the whole locking story.
        required = params.get("status")
        if required is not None and row["status"] != required.removeprefix("eq."):
            return httpx.Response(200, json=[])
        row.update(json.loads(request.content))
        return httpx.Response(200, json=[row])


def _job(**over: Any) -> dict[str, Any]:
    row = {
        "job_id": str(uuid.uuid4()),
        "job_type": "run_routine",
        "payload": {"routine": "alliance-daily"},
        "attempt_count": 0,
        "status": "queued",
        "priority": 100,
    }
    row.update(over)
    return row


def _worker(queue: FakeQueue, execute: Any, **cfg: Any) -> JobWorker:
    client = httpx.Client(
        transport=httpx.MockTransport(queue.handler), base_url="http://supabase.test"
    )
    config = JobsConfig(
        supabase_url="http://supabase.test",
        secret_key="secret",
        collector_id=COLLECTOR,
        **cfg,
    )
    return JobWorker(config, execute, client=client)


def test_a_successful_job_is_marked_succeeded_and_recorded() -> None:
    row = _job()
    queue = FakeQueue([row])
    worker = _worker(queue, lambda _job: JobOutcome(ok=True, result={"routine": "x"}))

    stats = worker.poll_once()

    assert (stats.claimed, stats.succeeded) == (1, 1)
    assert queue.jobs[row["job_id"]]["status"] == "succeeded"
    assert queue.jobs[row["job_id"]]["attempt_count"] == 1
    assert [r["status"] for r in queue.runs] == ["succeeded"]
    assert queue.runs[0]["refresh_job_id"] == row["job_id"]


def test_failure_requeues_with_backoff_rather_than_dropping_the_job() -> None:
    row = _job()
    queue = FakeQueue([row])
    worker = _worker(queue, lambda _job: JobOutcome(ok=False, error="emulator asleep"))

    stats = worker.poll_once()

    stored = queue.jobs[row["job_id"]]
    assert (stats.failed, stats.dead_lettered) == (1, 0)
    assert stored["status"] == "queued"
    assert stored["last_error"] == "emulator asleep"
    assert datetime.fromisoformat(stored["next_attempt_at"]) > datetime.now(tz=UTC)


def test_the_last_attempt_dead_letters() -> None:
    row = _job(attempt_count=2)
    queue = FakeQueue([row])
    worker = _worker(queue, lambda _job: JobOutcome(ok=False, error="still broken"), max_attempts=3)

    stats = worker.poll_once()

    assert stats.dead_lettered == 1
    assert queue.jobs[row["job_id"]]["status"] == "dead_letter"
    assert [r["status"] for r in queue.runs] == ["dead_letter"]


def test_a_permanent_failure_skips_the_retries() -> None:
    """An unknown job type will not become known by waiting an hour."""
    row = _job()
    queue = FakeQueue([row])
    worker = _worker(
        queue,
        lambda _job: JobOutcome(ok=False, error="unknown job_type", permanent=True),
        max_attempts=5,
    )

    stats = worker.poll_once()

    assert stats.dead_lettered == 1
    assert queue.jobs[row["job_id"]]["status"] == "dead_letter"


def test_an_executor_that_raises_fails_the_job_not_the_worker() -> None:
    """FR-COL-003 for jobs: one bad row must not stop the loop."""
    row = _job()
    queue = FakeQueue([row])

    def boom(_job: Job) -> JobOutcome:
        raise RuntimeError("adb vanished")

    stats = _worker(queue, boom).poll_once()

    assert stats.failed == 1
    stored = queue.jobs[row["job_id"]]
    assert stored["status"] == "queued"
    assert "RuntimeError: adb vanished" in stored["last_error"]


def test_a_job_claimed_by_someone_else_is_skipped() -> None:
    row = _job()
    queue = FakeQueue([row])
    calls: list[Job] = []

    def record(job: Job) -> JobOutcome:  # pragma: no cover - must not run
        calls.append(job)
        return JobOutcome(ok=True)

    worker = _worker(queue, record)
    # Between the worker listing candidates and claiming them, the row moves.
    original = queue.handler

    def steal_then_delegate(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            response = original(request)
            row["status"] = "claimed"
            return response
        return original(request)

    worker.client = httpx.Client(
        transport=httpx.MockTransport(steal_then_delegate), base_url="http://supabase.test"
    )

    stats = worker.poll_once()

    assert stats.claimed == 0
    assert calls == []


def test_backoff_grows_and_is_capped() -> None:
    worker = _worker(
        FakeQueue([]),
        lambda _j: JobOutcome(ok=True),
        base_backoff_seconds=30.0,
        max_backoff_seconds=300.0,
    )
    assert worker.backoff_seconds(1) == 30.0
    assert worker.backoff_seconds(2) == 60.0
    assert worker.backoff_seconds(3) == 120.0
    assert worker.backoff_seconds(9) == 300.0


def test_losing_the_audit_row_does_not_strand_the_job() -> None:
    """workflow_runs is the trace, not the state. A 500 there must not leave
    the job stuck in `running` forever."""
    row = _job()
    queue = FakeQueue([row])
    queue.runs_fail = True
    worker = _worker(queue, lambda _job: JobOutcome(ok=True))

    stats = worker.poll_once()

    assert stats.succeeded == 1
    assert queue.jobs[row["job_id"]]["status"] == "succeeded"


def test_candidates_asks_only_for_work_addressed_here() -> None:
    seen: dict[str, str] = {}

    def capture(request: httpx.Request) -> httpx.Response:
        seen.update(request.url.params)
        return httpx.Response(200, json=[])

    client = httpx.Client(transport=httpx.MockTransport(capture), base_url="http://supabase.test")
    worker = JobWorker(
        JobsConfig(supabase_url="http://supabase.test", secret_key="k", collector_id=COLLECTOR),
        lambda _j: JobOutcome(ok=True),
        client=client,
    )

    worker.candidates(datetime.now(tz=UTC) + timedelta(seconds=1))

    assert seen["status"] == "eq.queued"
    assert seen["next_attempt_at"].startswith("lte.")
    assert COLLECTOR in seen["or"]
    assert "collector_id.is.null" in seen["or"]
