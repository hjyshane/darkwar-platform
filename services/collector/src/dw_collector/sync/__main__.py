"""dw-sync entrypoint: drain the outbox and report health on an interval."""

from __future__ import annotations

import os
import time
from datetime import datetime
from pathlib import Path

import httpx
import structlog

from dw_collector import __version__
from dw_collector.envfile import load_env_file
from dw_collector.storage.journal import Journal
from dw_collector.sync.heartbeat import assess, report
from dw_collector.sync.worker import SyncConfig, SyncWorker

log = structlog.get_logger()


def _last_packet_at(journal: Journal) -> datetime | None:
    """Newest journalled observation — the collector's proof of life."""
    row = journal.conn.execute("select max(captured_at) from raw_observations").fetchone()
    return datetime.fromisoformat(row[0]) if row and row[0] else None


def main() -> None:
    load_env_file()
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
            # FR-COL-007: the same loop reports health, so a stalled sync
            # is visible even when it has nothing to send.
            try:
                health = assess(journal, last_packet_at=_last_packet_at(journal))
                report(worker.client, os.environ["DW_COLLECTOR_ID"], health, version=__version__)
            except (httpx.HTTPError, KeyError) as exc:
                log.warning("sync.heartbeat_failed", error=str(exc))
            time.sleep(interval)
    except KeyboardInterrupt:
        log.info("sync.stop")


if __name__ == "__main__":
    main()
