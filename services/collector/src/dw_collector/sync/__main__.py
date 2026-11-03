"""dw-sync entrypoint: drain the outbox and report health on an interval."""

from __future__ import annotations

import os
import threading
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

# How long to wait before the next drain while the queue is deep and the database is keeping
# up: long enough to breathe, short enough that a backlog is a matter of minutes, not hours.
CATCH_UP_DELAY = 0.2

# One drain sends this many rows unless DW_SYNC_BATCH_SIZE says otherwise. The cost of a drain
# is the round trips (one per table), not the rows, so a bigger batch moves a backlog faster;
# the worker splits a batch that times out, and a failing drain backs off to `interval` below.
DEFAULT_BATCH = 250


def next_delay(sent: int, failed: int, batch: int, interval: float) -> float:
    """How long to wait before the next drain.

    A drain that filled its batch with nothing failing means more is probably waiting and the
    database is keeping up: go again almost at once. Anything else - a short batch (the queue is
    empty), or any failure (the database is struggling; hammering it makes timeouts worse) -
    waits the usual interval. Before this the loop slept `interval` after every drain of 100
    rows, which is 7 rows a second however deep the queue was.
    """
    if failed == 0 and sent >= batch:
        return CATCH_UP_DELAY
    return interval


def _last_packet_at(journal: Journal) -> datetime | None:
    """Newest journalled observation — the collector's proof of life.

    By rowid, not `max(captured_at)`: captured_at is unindexed, so the max
    was a full scan of the journal's biggest table EVERY heartbeat — a third
    of a core, forever, once the table reached a few million rows. The last
    row WRITTEN is also the more honest proof of life: a replay of old
    traffic writes old captured_at values, and what the heartbeat is really
    asserting is that the journal is still being written, which is the same
    rowid reasoning `watermark()` documents.
    """
    row = journal.conn.execute(
        "select captured_at from raw_observations order by rowid desc limit 1"
    ).fetchone()
    return datetime.fromisoformat(row[0]) if row and row[0] else None


HEARTBEAT_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)


def heartbeat_loop(
    db_path: Path,
    client: httpx.Client,
    collector_id: str,
    interval: float,
    stop: threading.Event,
) -> None:
    """Report health on its own clock, apart from the drain.

    A drain can spend minutes in a chain of split requests against a slow
    database; a beat queued behind it makes a working collector look silent.
    sqlite3 connections are bound to their thread, so this opens its own.
    """
    journal = Journal(db_path)
    while not stop.is_set():
        try:
            health = assess(journal, last_packet_at=_last_packet_at(journal))
            report(client, collector_id, health, version=__version__)
        except httpx.HTTPError as exc:
            log.warning("sync.heartbeat_failed", error=str(exc))
        stop.wait(interval)


def main() -> None:
    load_env_file()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    interval = float(os.environ.get("DW_SYNC_INTERVAL_SECONDS", "10"))
    batch = int(os.environ.get("DW_SYNC_BATCH_SIZE", str(DEFAULT_BATCH)))
    db_path = Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db"))
    journal = Journal(db_path)
    journal.init_db()
    worker = SyncWorker(journal, SyncConfig(supabase_url=url, secret_key=key, batch_size=batch))
    # The batch size is logged, not just read: a drain that is keeping up and
    # a drain that is eleven hours behind produce the same `sent=` lines, and
    # the only difference visible in the log is how many rows each one moved.
    log.info("sync.start", interval=interval, batch_size=batch)
    # FR-COL-007: health is reported even when there is nothing to send. Own
    # thread, own client, own journal connection - see heartbeat_loop.
    stop = threading.Event()
    collector_id = os.environ.get("DW_COLLECTOR_ID")
    if collector_id:
        beat_client = httpx.Client(
            base_url=url,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=HEARTBEAT_TIMEOUT,
        )
        threading.Thread(
            target=heartbeat_loop,
            args=(db_path, beat_client, collector_id, interval, stop),
            name="heartbeat",
            daemon=True,
        ).start()
    else:
        log.warning("sync.heartbeat_failed", error="DW_COLLECTOR_ID is not set")
    try:
        while True:
            stats = worker.drain_once()
            if stats.sent or stats.failed:
                log.info("sync.drain", sent=stats.sent, failed=stats.failed)
            time.sleep(next_delay(stats.sent, stats.failed, batch, interval))
    except KeyboardInterrupt:
        log.info("sync.stop")
    finally:
        stop.set()


if __name__ == "__main__":
    main()
