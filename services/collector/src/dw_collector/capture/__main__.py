"""dw-capture: passive live capture (Windows + Npcap, S15).

Runs as its own process so a UI-automation or sync failure cannot take
capture down (§10.1). Everything below the packet source is the same code
the fixture and pcap tests drive, so scapy is the only part that first
runs for real on Windows.
"""

from __future__ import annotations

import os
import threading
import uuid
from pathlib import Path

import structlog

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector.capture.live import DEFAULT_PORT, sniff_into
from dw_collector.capture.pump import SegmentPump
from dw_collector.capture.session import CaptureSession
from dw_collector.envfile import load_env_file
from dw_collector.storage.journal import Journal

log = structlog.get_logger()


def main() -> None:
    load_env_file()
    collector_id = os.environ.get("DW_COLLECTOR_ID")
    if not collector_id:
        raise SystemExit("DW_COLLECTOR_ID is required")
    server_id = int(os.environ.get("DW_COLLECTOR_SERVER_ID", "580"))
    interface = os.environ.get("DW_CAPTURE_INTERFACE") or None
    port = int(os.environ.get("DW_CAPTURE_PORT", str(DEFAULT_PORT)))

    # single_writer_thread: every write below happens on the pump's worker,
    # never on the sniffer's thread. See Journal.__init__.
    journal = Journal(
        Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db")),
        single_writer_thread=True,
    )
    journal.init_db()
    session = CaptureSession(
        journal,
        collector_id=uuid.UUID(collector_id),
        collected_from_server_id=server_id,
        port=port,
    )

    log.info("capture.start", interface=interface or "default", port=port, server_id=server_id)

    # Periodic health, because the interesting failures are all silent. This
    # process has gone quiet three separate ways — a wrong interface, a
    # pump that stalled the capture loop, and a decoder waiting on a length
    # that never arrived — and every one of them looked the same from
    # outside: alive, no error, heartbeat still written, journal frozen.
    # Stats only existed at shutdown, and Task Scheduler kills rather than
    # interrupts, so nobody ever saw them.
    health_seconds = float(os.environ.get("DW_CAPTURE_HEALTH_SECONDS", "60"))
    stop_health = threading.Event()

    def _health() -> None:
        while not stop_health.wait(health_seconds):
            log.info("capture.health", **session.diagnostics(), pump_pending=pump.pending)

    health_thread = threading.Thread(target=_health, name="dw-capture-health", daemon=True)
    # Through a pump, so scapy's capture loop only enqueues. Journalling from
    # the callback let Npcap's ring overflow during bursts: dumpcap saw 45
    # command types over a window where this process journalled 27.
    pump = SegmentPump(session.feed)
    try:
        pump.start()
        if health_seconds > 0:
            health_thread.start()
        # Blocking; Ctrl+C is the normal way to stop.
        sniff_into(pump.submit, interface, port)
    except KeyboardInterrupt:
        pass
    finally:
        stop_health.set()
        # Before the journal closes, or the queued tail is written into a
        # closed database — which would put the loss back by another route.
        pump.close()
        journal.close()
        session.refresh_loss_counters()
        log.info(
            "capture.stop",
            segments=session.stats.segments,
            ingested=session.stats.ingested,
            discovered=session.stats.discovered,
            rejected=session.stats.rejected,
            clock_skew_seconds=session.stats.clock_skew_seconds,
            rows=session.stats.rows,
            resync_bytes=session.stats.resync_bytes,
            gap_skips=session.stats.gap_skips,
            pump_blocked=pump.blocked,
        )


if __name__ == "__main__":
    main()
