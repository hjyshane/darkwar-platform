"""Work the gift-code claim queue, one pair at a time, slowly.

Direction as in jobs/worker.py (§4 principle 10): this PC makes the outbound
connections; nothing reaches in. The queue is `gift_code_claims`, written by the
officer-gated RPCs of 0251, and claiming is the same conditional PATCH as there
(`status=eq.queued`), so two workers cannot take the same pair.

Three things set this apart from the other workers, because this one sends
requests to somebody else's web page under members' player ids:

* PACING. One request, then a pause (`min_interval_seconds`). Never a burst.
* A CIRCUIT BREAKER. A run of results that are not answers (`retry`, or an
  exception) stops the worker for a cool-down instead of hammering a page that
  is already telling it something. A `stop` result halts it until a person
  restarts it: a challenge or a refusal is not something to retry around.
* A KILL SWITCH, checked before every request, that a person can create with
  `New-Item` and remove again without touching the process.

A claim left `running` by a crash is put back to `queued` after
`stale_running_seconds`. The worst case is one pair claimed twice, which the
page answers with "already redeemed" - not a second reward.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import structlog

from dw_collector.gift.redeemer import Redeemer, RedeemResult

log = structlog.get_logger()

CLAIMS = "gift_code_claims"
CODES = "gift_codes"

#: Codes that are not worth a request.
DEAD_CODE_STATUSES = frozenset({"expired", "invalid"})


@dataclass(frozen=True)
class GiftConfig:
    supabase_url: str
    secret_key: str
    batch_size: int = 10
    max_attempts: int = 4
    base_backoff_seconds: float = 300.0
    max_backoff_seconds: float = 3600.0
    #: Pause after every request. The page is somebody else's.
    min_interval_seconds: float = 6.0
    #: This many non-answers in a row stops the worker for the cool-down.
    breaker_threshold: int = 5
    breaker_cooldown_seconds: float = 900.0
    stale_running_seconds: float = 600.0


@dataclass
class PollStats:
    processed: int = 0
    done: int = 0
    already: int = 0
    retried: int = 0
    failed: int = 0
    cancelled: int = 0
    halted: str | None = None


class GiftWorker:
    def __init__(
        self,
        config: GiftConfig,
        redeemer: Redeemer,
        *,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        kill_switch: Callable[[], bool] = lambda: False,
    ) -> None:
        self.config = config
        self.redeemer = redeemer
        self._sleep = sleep
        self._kill = kill_switch
        self.client = client or httpx.Client(
            base_url=config.supabase_url,
            headers={
                "apikey": config.secret_key,
                "Authorization": f"Bearer {config.secret_key}",
            },
            timeout=30.0,
        )
        self.consecutive_non_answers = 0

    # -- queue access --------------------------------------------------------

    def recover_stale(self, now: datetime) -> None:
        cutoff = now - timedelta(seconds=self.config.stale_running_seconds)
        resp = self.client.patch(
            f"/rest/v1/{CLAIMS}",
            params={"status": "eq.running", "started_at": f"lt.{cutoff.isoformat()}"},
            json={"status": "queued"},
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()

    def candidates(self, now: datetime) -> list[dict[str, Any]]:
        resp = self.client.get(
            f"/rest/v1/{CLAIMS}",
            params={
                "status": "eq.queued",
                "next_attempt_at": f"lte.{now.isoformat()}",
                "order": "created_at.asc",
                "limit": str(self.config.batch_size),
                "select": "claim_id,code_id,game_uid,attempt_count,gift_codes(code,status)",
            },
        )
        resp.raise_for_status()
        rows: list[dict[str, Any]] = resp.json()
        return rows

    def claim(self, row: dict[str, Any], now: datetime) -> bool:
        """Take the pair, or report that someone else already did."""
        resp = self.client.patch(
            f"/rest/v1/{CLAIMS}",
            params={"claim_id": f"eq.{row['claim_id']}", "status": "eq.queued"},
            json={
                "status": "running",
                "started_at": now.isoformat(),
                "attempt_count": int(row.get("attempt_count") or 0) + 1,
            },
            headers={"Prefer": "return=representation"},
        )
        resp.raise_for_status()
        claimed: list[dict[str, Any]] = resp.json()
        return bool(claimed)

    def _patch_claim(self, claim_id: str, body: dict[str, Any]) -> None:
        resp = self.client.patch(
            f"/rest/v1/{CLAIMS}",
            params={"claim_id": f"eq.{claim_id}"},
            json=body,
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()

    def _patch_code(self, code_id: str, body: dict[str, Any]) -> None:
        resp = self.client.patch(
            f"/rest/v1/{CODES}",
            params={"code_id": f"eq.{code_id}"},
            json=body,
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()

    def _cancel_waiting(self, code_id: str, now: datetime) -> None:
        """A dead code: nothing still queued for it is worth a request."""
        resp = self.client.patch(
            f"/rest/v1/{CLAIMS}",
            params={"code_id": f"eq.{code_id}", "status": "eq.queued"},
            json={"status": "cancelled", "finished_at": now.isoformat()},
            headers={"Prefer": "return=minimal"},
        )
        resp.raise_for_status()

    def backoff_seconds(self, attempt: int) -> float:
        growth = float(2 ** max(0, attempt - 1))
        return min(self.config.base_backoff_seconds * growth, self.config.max_backoff_seconds)

    # -- one pair ------------------------------------------------------------

    def _settle(
        self,
        row: dict[str, Any],
        attempt: int,
        result: RedeemResult,
        now: datetime,
        stats: PollStats,
    ) -> None:
        claim_id = str(row["claim_id"])
        code_id = str(row["code_id"])
        finished = now.isoformat()

        if result.kind in ("done", "already"):
            self._patch_claim(
                claim_id,
                {
                    "status": result.kind,
                    "finished_at": finished,
                    "result": result.raw,
                    "last_error": None,
                },
            )
            if result.kind == "done":
                self._patch_code(code_id, {"status": "working", "checked_at": finished})
                stats.done += 1
            else:
                stats.already += 1
            self.consecutive_non_answers = 0
        elif result.kind in ("expired", "invalid"):
            self._patch_claim(
                claim_id,
                {"status": result.kind, "finished_at": finished, "result": result.raw},
            )
            self._patch_code(code_id, {"status": result.kind, "checked_at": finished})
            self._cancel_waiting(code_id, now)
            stats.cancelled += 1
            self.consecutive_non_answers = 0
        elif result.kind == "stop":
            # Not an attempt: put it back untouched, and halt.
            self._patch_claim(
                claim_id,
                {
                    "status": "queued",
                    "attempt_count": attempt - 1,
                    "result": result.raw,
                    "last_error": result.error,
                },
            )
            stats.halted = result.error or "the redeemer asked to stop"
        else:  # retry
            self.consecutive_non_answers += 1
            if attempt >= self.config.max_attempts:
                self._patch_claim(
                    claim_id,
                    {
                        "status": "failed",
                        "finished_at": finished,
                        "result": result.raw,
                        "last_error": result.error,
                    },
                )
                stats.failed += 1
            else:
                due = now + timedelta(seconds=self.backoff_seconds(attempt))
                self._patch_claim(
                    claim_id,
                    {
                        "status": "queued",
                        "next_attempt_at": due.isoformat(),
                        "result": result.raw,
                        "last_error": result.error,
                    },
                )
                stats.retried += 1

    def process(self, row: dict[str, Any], now: datetime, stats: PollStats) -> None:
        attempt = int(row.get("attempt_count") or 0) + 1
        code = row.get("gift_codes") or {}

        if code.get("status") in DEAD_CODE_STATUSES:
            self._patch_claim(
                str(row["claim_id"]),
                {"status": "cancelled", "finished_at": now.isoformat()},
            )
            stats.cancelled += 1
            return

        try:
            result = self.redeemer.redeem(int(row["game_uid"]), str(code["code"]))
        except Exception as exc:
            # A redeemer bug is a pair that did not get an answer, not a dead
            # worker. Recorded with its type so the cause is not flattened.
            log.exception("gift.redeemer_raised", claim_id=row["claim_id"])
            result = RedeemResult("retry", error=f"{type(exc).__name__}: {exc}")
        self._settle(row, attempt, result, now, stats)
        stats.processed += 1

    # -- a pass --------------------------------------------------------------

    def run_once(self, now: datetime | None = None) -> PollStats:
        """One pass over what is due. Returns early, with `halted` set, on a stop."""
        stats = PollStats()
        now = now or datetime.now(tz=UTC)
        self.recover_stale(now)

        for row in self.candidates(now):
            if self._kill():
                stats.halted = "kill switch"
                return stats
            if self.consecutive_non_answers >= self.config.breaker_threshold:
                stats.halted = "circuit breaker"
                return stats
            if not self.claim(row, now):
                continue
            self.process(row, now, stats)
            if stats.halted:
                return stats
            self._sleep(self.config.min_interval_seconds)
        return stats

    def reset_breaker(self) -> None:
        """After the cool-down: try again from a clean count."""
        self.consecutive_non_answers = 0
