"""dw-sync entrypoint: drain the outbox on an interval."""

from __future__ import annotations

import os
import time
from pathlib import Path

import structlog

from dw_collector.storage.journal import Journal
from dw_collector.sync.worker import SyncConfig, SyncWorker

log = structlog.get_logger()


def main() -> None:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    interval = float(os.environ.get("DW_SYNC_INTERVAL_SECONDS", "10"))
    journal = Journal(Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db")))
    journal.init_db()
    worker = SyncWorker(journal, SyncConfig(supabase_url=url, secret_key=key))
    log.info("sync.start", interval=interval)
    try:
        while True:
            stats = worker.drain_once()
            if stats.sent or stats.failed:
                log.info("sync.drain", sent=stats.sent, failed=stats.failed)
            time.sleep(interval)
    except KeyboardInterrupt:
        log.info("sync.stop")


if __name__ == "__main__":
    main()
