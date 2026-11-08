"""What the watchdog reads from the journal: proof of life and update signals."""

from __future__ import annotations

import json
from datetime import datetime

from dw_collector.storage.journal import Journal
from dw_collector.watchdog.update_signal import UpdateObserver, UpdateSignal

#: A login bundle is ~0.5 MB; nothing legitimate is parsed past this.
MAX_PAYLOAD_CHARS = 4_000_000
BATCH = 500


def last_packet_at(journal: Journal) -> datetime | None:
    """Newest journalled observation, by rowid (see `sync.__main__._last_packet_at`)."""
    row = journal.conn.execute(
        "select captured_at from raw_observations order by rowid desc limit 1"
    ).fetchone()
    return datetime.fromisoformat(row[0]) if row and row[0] else None


class SignalFeed:
    """Feeds rows journalled since it started into an `UpdateObserver`.

    Starts at the journal's current end: history is not a new signal.
    """

    def __init__(self, journal: Journal, observer: UpdateObserver) -> None:
        self._journal = journal
        self._observer = observer
        self._mark = journal.watermark()

    def poll(self) -> list[UpdateSignal]:
        found: list[UpdateSignal] = []
        while True:
            rows = self._journal.conn.execute(
                "select rowid, source_command, payload_json from raw_observations"
                " where rowid > ? order by rowid limit ?",
                (self._mark, BATCH),
            ).fetchall()
            for rowid, command, payload_json in rows:
                self._mark = int(rowid)
                payload = None
                if len(payload_json) <= MAX_PAYLOAD_CHARS:
                    try:
                        payload = json.loads(payload_json)
                    except ValueError:
                        payload = None
                found.extend(self._observer.observe(str(command), payload))
            if len(rows) < BATCH:
                return found
