"""dw-gift: claim queued gift codes for the alliance's members, slowly."""

from __future__ import annotations

import os
import time
from pathlib import Path

import httpx
import structlog

from dw_collector.envfile import load_env_file
from dw_collector.gift.redeemer import Redeemer
from dw_collector.gift.worker import GiftConfig, GiftWorker

log = structlog.get_logger()

POLL_SECONDS = 10.0


def load_redeemer(name: str) -> Redeemer | None:
    """The redeemer called `name`, or None if there is no such thing."""
    if name == "official":
        raise SystemExit(
            "dw-gift is retired: since 2026-10-10 the Gift Center needs each player's own "
            "key (uuid), which this worker does not have. The database sender (Sender "
            "panel on the Gift codes screen) sends from the keys saved there."
        )
    return None


def main() -> None:
    load_env_file()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SECRET_KEY are required")

    name = os.environ.get("DW_GIFT_REDEEMER", "").strip()
    redeemer = load_redeemer(name) if name else None
    if redeemer is None:
        raise SystemExit(
            "dw-gift needs DW_GIFT_REDEEMER=official to send anything "
            f"(got {name!r}); nothing is sent."
        )

    kill_file = os.environ.get("DW_GIFT_KILL_SWITCH_FILE") or None

    def killed() -> bool:
        return kill_file is not None and Path(kill_file).exists()

    config = GiftConfig(
        supabase_url=url,
        secret_key=key,
        min_interval_seconds=float(os.environ.get("DW_GIFT_MIN_INTERVAL_SECONDS", "6")),
    )
    worker = GiftWorker(config, redeemer, kill_switch=killed)
    log.info("gift.start", interval=config.min_interval_seconds, kill_switch=kill_file)
    while True:
        try:
            stats = worker.run_once()
        except httpx.HTTPError as exc:
            log.warning("gift.supabase_unreachable", error=str(exc))
            time.sleep(POLL_SECONDS * 3)
            continue
        if stats.processed:
            log.info("gift.pass", **{k: v for k, v in vars(stats).items() if v})
        if stats.halted == "circuit breaker":
            log.warning("gift.breaker", cooldown=config.breaker_cooldown_seconds)
            time.sleep(config.breaker_cooldown_seconds)
            worker.reset_breaker()
        elif stats.halted == "kill switch":
            time.sleep(POLL_SECONDS)
        elif stats.halted:
            log.error("gift.halted", reason=stats.halted)
            raise SystemExit(f"halted: {stats.halted}")
        else:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
