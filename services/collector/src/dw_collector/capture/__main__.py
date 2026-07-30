"""dw-capture: passive live capture (Windows + Npcap, S15).

Runs as its own process so a UI-automation or sync failure cannot take
capture down (§10.1). Everything below the packet source is the same code
the fixture and pcap tests drive, so scapy is the only part that first
runs for real on Windows.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import structlog

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector.capture.live import DEFAULT_PORT, sniff_segments
from dw_collector.capture.session import CaptureSession
from dw_collector.storage.journal import Journal

log = structlog.get_logger()


def main() -> None:
    collector_id = os.environ.get("DW_COLLECTOR_ID")
    if not collector_id:
        raise SystemExit("DW_COLLECTOR_ID is required")
    server_id = int(os.environ.get("DW_COLLECTOR_SERVER_ID", "580"))
    interface = os.environ.get("DW_CAPTURE_INTERFACE") or None
    port = int(os.environ.get("DW_CAPTURE_PORT", str(DEFAULT_PORT)))

    journal = Journal(Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db")))
    journal.init_db()
    session = CaptureSession(
        journal,
        collector_id=uuid.UUID(collector_id),
        collected_from_server_id=server_id,
        port=port,
    )

    log.info("capture.start", interface=interface or "default", port=port, server_id=server_id)
    try:
        for segment in sniff_segments(interface, port):
            session.feed(segment)
    except KeyboardInterrupt:
        pass
    finally:
        journal.close()
        session.refresh_loss_counters()
        log.info(
            "capture.stop",
            segments=session.stats.segments,
            ingested=session.stats.ingested,
            discovered=session.stats.discovered,
            rejected=session.stats.rejected,
            rows=session.stats.rows,
            resync_bytes=session.stats.resync_bytes,
            gap_skips=session.stats.gap_skips,
        )


if __name__ == "__main__":
    main()
