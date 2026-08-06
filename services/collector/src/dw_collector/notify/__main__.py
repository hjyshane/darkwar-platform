"""dw-notify entrypoint: work out what to announce, then announce it.

A separate process from `dw-sync` on purpose. Sync is the path data takes to the
cloud and must not be blocked by an outward-facing HTTP call to a third party —
a Discord outage would otherwise stall the pipeline behind it.

The interval is minutes, not seconds. Nothing here is urgent: a rank period is
built every fortnight and a departure is discovered when a roster capture lands.
Polling every ten seconds would only add requests.
"""

from __future__ import annotations

import os
import time

import structlog

from dw_collector.envfile import load_env_file
from dw_collector.notify.worker import NotifyConfig, NotifyWorker

log = structlog.get_logger()


def main() -> None:
    load_env_file()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    interval = float(os.environ.get("DW_NOTIFY_INTERVAL_SECONDS", "300"))

    worker = NotifyWorker(NotifyConfig(supabase_url=url, secret_key=key))
    log.info("notify.start", interval=interval)
    once = os.environ.get("DW_NOTIFY_ONCE") == "1"
    while True:
        try:
            stats = worker.run_once()
            if stats.enqueued or stats.delivered or stats.failed:
                log.info(
                    "notify.pass",
                    enqueued=stats.enqueued,
                    delivered=stats.delivered,
                    failed=stats.failed,
                )
        except Exception as error:
            # Logged and swallowed. This process exists to send messages; if it
            # dies on one malformed row nobody hears about anything afterwards,
            # and the failure is invisible because its whole job is telling
            # people things.
            log.error("notify.pass_failed", error=str(error))
        if once:
            return
        time.sleep(interval)


if __name__ == "__main__":
    main()
