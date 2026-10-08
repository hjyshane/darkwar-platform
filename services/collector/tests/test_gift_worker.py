"""The gift-code claim worker, against a scripted PostgREST and a scripted redeemer."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from dw_collector.gift.redeemer import Kind, RedeemResult
from dw_collector.gift.worker import GiftConfig, GiftWorker

NOW = datetime(2026, 10, 9, 12, 0, 0, tzinfo=UTC)


class FakeSupabase:
    """Just enough PostgREST: filtered GET and PATCH on the two gift tables."""

    def __init__(self) -> None:
        self.codes: dict[str, dict[str, Any]] = {}
        self.claims: dict[str, dict[str, Any]] = {}
        self.steal: set[str] = set()  # claims another worker takes just before ours

    def add_code(self, code_id: str, code: str, status: str = "unverified") -> None:
        self.codes[code_id] = {"code_id": code_id, "code": code, "status": status}

    def add_claim(self, claim_id: str, code_id: str, uid: int, **extra: Any) -> None:
        self.claims[claim_id] = {
            "claim_id": claim_id,
            "code_id": code_id,
            "game_uid": uid,
            "status": "queued",
            "attempt_count": 0,
            "next_attempt_at": (NOW - timedelta(minutes=1)).isoformat(),
            "started_at": None,
            "finished_at": None,
            "last_error": None,
            "result": None,
            **extra,
        }

    @staticmethod
    def _matches(row: dict[str, Any], params: dict[str, str]) -> bool:
        for key, raw in params.items():
            if key in {"select", "order", "limit"}:
                continue
            op, _, value = raw.partition(".")
            have = row.get(key)
            if op == "eq" and str(have) != value:
                return False
            if op == "lt" and not (have is not None and str(have) < value):
                return False
            if op == "lte" and not (have is not None and str(have) <= value):
                return False
        return True

    def handler(self, request: httpx.Request) -> httpx.Response:
        table = request.url.path.removeprefix("/rest/v1/")
        params = dict(request.url.params)
        store = self.claims if table == "gift_code_claims" else self.codes

        if request.method == "GET":
            rows = [r for r in store.values() if self._matches(r, params)]
            rows.sort(key=lambda r: r.get("created", ""))
            rows = rows[: int(params.get("limit", "1000"))]
            out = []
            for r in rows:
                embedded = dict(r)
                embedded["gift_codes"] = {
                    k: self.codes[r["code_id"]][k] for k in ("code", "status")
                }
                out.append(embedded)
            return httpx.Response(200, json=out)

        assert request.method == "PATCH"
        body = json.loads(request.content)
        if table == "gift_code_claims":
            wanted = params.get("claim_id", "").removeprefix("eq.")
            if wanted in self.steal and wanted in self.claims:
                self.claims[wanted]["status"] = "running"
                self.steal.discard(wanted)
        hit = [r for r in store.values() if self._matches(r, params)]
        for row in hit:
            row.update(body)
        want_rows = "return=representation" in request.headers.get("prefer", "")
        return httpx.Response(200, json=[dict(r) for r in hit] if want_rows else [])


class ScriptedRedeemer:
    def __init__(self, *results: RedeemResult | Exception) -> None:
        self.results = list(results)
        self.calls: list[tuple[int, str]] = []

    def redeem(self, game_uid: int, code: str) -> RedeemResult:
        self.calls.append((game_uid, code))
        result = self.results.pop(0) if self.results else RedeemResult("done")
        if isinstance(result, Exception):
            raise result
        return result


def _worker(
    db: FakeSupabase,
    redeemer: ScriptedRedeemer,
    *,
    kill: bool = False,
    **config: Any,
) -> tuple[GiftWorker, list[float]]:
    sleeps: list[float] = []
    worker = GiftWorker(
        GiftConfig(supabase_url="http://x", secret_key="k", **config),
        redeemer,
        client=httpx.Client(transport=httpx.MockTransport(db.handler), base_url="http://x"),
        sleep=sleeps.append,
        kill_switch=lambda: kill,
    )
    return worker, sleeps


def _one(kind: Kind, **raw: Any) -> tuple[FakeSupabase, ScriptedRedeemer]:
    db = FakeSupabase()
    db.add_code("c1", "MAPLE3")
    db.add_claim("p1", "c1", 111)
    return db, ScriptedRedeemer(RedeemResult(kind, raw))


def test_a_done_claim_is_recorded_with_the_answer_and_the_code_marked_working() -> None:
    db, redeemer = _one("done", msg="ok")
    worker, sleeps = _worker(db, redeemer)

    stats = worker.run_once(NOW)

    assert redeemer.calls == [(111, "MAPLE3")]
    assert db.claims["p1"]["status"] == "done"
    assert db.claims["p1"]["result"] == {"msg": "ok"}
    assert db.claims["p1"]["attempt_count"] == 1
    assert db.codes["c1"]["status"] == "working"
    assert stats.done == 1
    assert sleeps == [6.0], "one pause after the request"


def test_already_redeemed_is_a_finished_pair_and_does_not_touch_the_code() -> None:
    db, redeemer = _one("already")
    worker, _ = _worker(db, redeemer)

    worker.run_once(NOW)

    assert db.claims["p1"]["status"] == "already"
    assert db.codes["c1"]["status"] == "unverified"


def test_an_expired_code_retires_the_code_and_cancels_everyone_still_waiting() -> None:
    db, redeemer = _one("expired")
    db.add_claim("p2", "c1", 222)
    db.add_claim("p3", "c1", 333)
    worker, _ = _worker(db, redeemer)

    worker.run_once(NOW)

    assert db.codes["c1"]["status"] == "expired"
    assert db.claims["p1"]["status"] == "expired"
    assert db.claims["p2"]["status"] == "cancelled"
    assert db.claims["p3"]["status"] == "cancelled"
    assert len(redeemer.calls) == 1, "nobody else was sent a request for a dead code"


def test_a_code_already_dead_when_its_turn_comes_costs_no_request() -> None:
    db, redeemer = _one("done")
    db.codes["c1"]["status"] = "invalid"
    worker, _ = _worker(db, redeemer)

    worker.run_once(NOW)

    assert redeemer.calls == []
    assert db.claims["p1"]["status"] == "cancelled"


def test_a_retry_goes_back_in_the_queue_later_with_backoff() -> None:
    db, redeemer = _one("retry")
    worker, _ = _worker(db, redeemer, base_backoff_seconds=300.0)

    stats = worker.run_once(NOW)

    row = db.claims["p1"]
    assert row["status"] == "queued"
    assert row["attempt_count"] == 1
    assert row["next_attempt_at"] == (NOW + timedelta(seconds=300)).isoformat()
    assert stats.retried == 1
    # Not due yet, so a second pass sends nothing.
    worker.run_once(NOW + timedelta(seconds=10))
    assert len(redeemer.calls) == 1


def test_the_last_attempt_fails_the_pair_instead_of_queueing_it_again() -> None:
    db, redeemer = _one("retry")
    db.claims["p1"]["attempt_count"] = 3
    worker, _ = _worker(db, redeemer, max_attempts=4)

    stats = worker.run_once(NOW)

    assert db.claims["p1"]["status"] == "failed"
    assert stats.failed == 1


def test_a_redeemer_that_raises_is_a_retry_not_a_dead_worker() -> None:
    db = FakeSupabase()
    db.add_code("c1", "MAPLE3")
    db.add_claim("p1", "c1", 111)
    db.add_claim("p2", "c1", 222)
    redeemer = ScriptedRedeemer(RuntimeError("boom"), RedeemResult("done"))
    worker, _ = _worker(db, redeemer)

    worker.run_once(NOW)

    assert db.claims["p1"]["status"] == "queued"
    assert "RuntimeError: boom" in db.claims["p1"]["last_error"]
    assert db.claims["p2"]["status"] == "done", "the next pair was still worked"


def test_a_stop_halts_at_once_and_gives_the_pair_back_untouched() -> None:
    db = FakeSupabase()
    db.add_code("c1", "MAPLE3")
    for i, uid in enumerate((111, 222, 333), start=1):
        db.add_claim(f"p{i}", "c1", uid)
    redeemer = ScriptedRedeemer(RedeemResult("stop", {"why": "challenge"}, error="challenge shown"))
    worker, _ = _worker(db, redeemer)

    stats = worker.run_once(NOW)

    assert stats.halted == "challenge shown"
    assert len(redeemer.calls) == 1, "nothing is sent after a stop"
    assert db.claims["p1"]["status"] == "queued"
    assert db.claims["p1"]["attempt_count"] == 0, "a stop is not an attempt"
    assert db.claims["p2"]["status"] == "queued"


def test_a_run_of_non_answers_trips_the_breaker_before_the_rest_are_sent() -> None:
    db = FakeSupabase()
    db.add_code("c1", "MAPLE3")
    for i in range(1, 9):
        db.add_claim(f"p{i}", "c1", 100 + i)
    redeemer = ScriptedRedeemer(*[RedeemResult("retry") for _ in range(8)])
    worker, _ = _worker(db, redeemer, breaker_threshold=5)

    stats = worker.run_once(NOW)

    assert stats.halted == "circuit breaker"
    assert len(redeemer.calls) == 5
    worker.reset_breaker()
    assert worker.consecutive_non_answers == 0


def test_an_answer_resets_the_run_of_non_answers() -> None:
    db = FakeSupabase()
    db.add_code("c1", "MAPLE3")
    for i in range(1, 7):
        db.add_claim(f"p{i}", "c1", 100 + i)
    results = [RedeemResult("retry")] * 4 + [RedeemResult("done")] + [RedeemResult("retry")] * 1
    worker, _ = _worker(db, ScriptedRedeemer(*results), breaker_threshold=5)

    stats = worker.run_once(NOW)

    assert stats.halted is None, "four non-answers, one answer, one more: never five in a row"


def test_the_kill_switch_stops_everything_before_any_request() -> None:
    db, redeemer = _one("done")
    worker, _ = _worker(db, redeemer, kill=True)

    stats = worker.run_once(NOW)

    assert stats.halted == "kill switch"
    assert redeemer.calls == []
    assert db.claims["p1"]["status"] == "queued"


def test_a_pair_another_worker_took_first_is_skipped_without_a_request() -> None:
    db, redeemer = _one("done")
    db.steal.add("p1")
    worker, _ = _worker(db, redeemer)

    worker.run_once(NOW)

    assert redeemer.calls == []
    assert db.claims["p1"]["status"] == "running"


def test_a_pair_left_running_by_a_crash_is_put_back_after_a_while() -> None:
    db, redeemer = _one("done")
    db.claims["p1"]["status"] = "running"
    db.claims["p1"]["started_at"] = (NOW - timedelta(minutes=30)).isoformat()
    db.add_claim("p2", "c1", 222)
    db.claims["p2"]["status"] = "running"
    db.claims["p2"]["started_at"] = (NOW - timedelta(seconds=30)).isoformat()
    worker, _ = _worker(db, redeemer, stale_running_seconds=600.0)

    worker.run_once(NOW)

    assert db.claims["p1"]["status"] == "done", "the old one was recovered and worked"
    assert db.claims["p2"]["status"] == "running", "a recent one is somebody's live claim"
