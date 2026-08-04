"""Capture engine: TCP segments in, journalled Observations out.

The engine takes an iterable of `TcpSegment` and knows nothing about where
they came from. That is the whole point of the Observation seam — the live
Npcap/scapy source (capture/live.py, Windows only) is a thin adapter that
produces segments, and everything below it is exercised here with
hand-built packets and, in `scan-capture`, with pcap files.

Unknown commands become discovery rows and malformed payloads are counted,
never raised: a collector that stops on a surprise stops collecting
(FR-COL-003).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import structlog
from pydantic import ValidationError

from dw_collector import clock, pipeline
from dw_collector.models import Observation
from dw_collector.protocol.frames import extract_extension_event
from dw_collector.protocol.pcapng import ExtensionEvent, TCPDirectionReassembler, TcpSegment
from dw_collector.storage.journal import Journal

log = structlog.get_logger()

DEFAULT_PORT = 8680

# Above this, the machine's clock is wrong in a way that matters rather than
# merely imprecise. captured_at decides three things that fail silently: the
# idempotency key's date bucket, which game week a row belongs to (the reset
# is Monday 02:00 UTC), and how stale the dashboard thinks data is. A few
# seconds moves none of them; a few minutes can, near a boundary.
CLOCK_SKEW_WARN_SECONDS = 60.0


@dataclass
class CaptureStats:
    segments: int = 0
    frames: int = 0
    ingested: int = 0
    discovered: int = 0
    rejected: int = 0
    rows: int = 0
    commands: dict[str, int] = field(default_factory=dict)
    # Loss indicators. Non-zero means Npcap dropped or reordered packets, so
    # a large response may have been missed — worth knowing before concluding
    # "the game never sent it".
    resync_bytes: int = 0
    gap_skips: int = 0
    # Server clock minus ours, when the game told us (push.utc.time, on
    # login). None means the session never saw one.
    clock_skew_seconds: float | None = None


class CaptureSession:
    """Reassembles one or more TCP streams and journals what it decodes."""

    def __init__(
        self,
        journal: Journal,
        *,
        collector_id: uuid.UUID,
        collected_from_server_id: int,
        port: int = DEFAULT_PORT,
    ) -> None:
        self.journal = journal
        self.collector_id = collector_id
        self.collected_from_server_id = collected_from_server_id
        self.port = port
        self.stats = CaptureStats()
        self._streams: dict[tuple[str, int, str, int], TCPDirectionReassembler] = defaultdict(
            TCPDirectionReassembler
        )
        self._sequence = 0
        # When a frame last completed. A capture that has gone quiet cannot
        # otherwise be told apart from a game that has gone quiet, and this
        # process has twice been believed dead when it was idle, and once
        # believed idle when it was dead.
        self.last_frame_at: datetime | None = None

    def diagnostics(self) -> dict[str, object]:
        """A snapshot that separates "no packets arrive" from "packets arrive
        and nothing comes out".

        Those two look identical from outside — the journal stops growing
        either way — and telling them apart took a side-by-side dumpcap run
        every time. `segments` answers the first; `buffered_bytes` answers
        the second, because a decoder waiting on a length that never arrives
        grows its buffer and never returns a frame.
        """
        self.refresh_loss_counters()
        buffered = sum(len(s.decoder.buffer) for s in self._streams.values())
        pending = sum(len(s.pending) for s in self._streams.values())
        return {
            "streams": len(self._streams),
            "segments": self.stats.segments,
            "frames": self.stats.frames,
            "ingested": self.stats.ingested,
            "discovered": self.stats.discovered,
            "rejected": self.stats.rejected,
            "buffered_bytes": buffered,
            "pending_segments": pending,
            "resync_bytes": self.stats.resync_bytes,
            "gap_skips": self.stats.gap_skips,
            "last_frame_at": self.last_frame_at.isoformat() if self.last_frame_at else None,
        }

    def feed(self, segment: TcpSegment, *, now: datetime | None = None) -> None:
        """Absorb one TCP segment; journals whatever completes because of it."""
        if not segment.payload:
            return
        if self.port not in (segment.source_port, segment.destination_port):
            return

        self.stats.segments += 1
        key = (
            segment.source_ip,
            segment.source_port,
            segment.destination_ip,
            segment.destination_port,
        )
        # Responses come FROM the game port; our own requests are not data.
        inbound = segment.source_port == self.port

        stream = self._streams[key]
        for frame in stream.feed(segment.sequence, segment.payload):
            self.stats.frames += 1
            self.last_frame_at = now or datetime.now(tz=UTC)
            if not inbound:
                continue
            event = extract_extension_event(frame.object)
            if event is None:
                continue
            command, payload, request_id = event
            self._check_clock(command, dict(payload), now or datetime.now(tz=UTC))
            self._record(
                ExtensionEvent("inbound", command, payload, request_id),
                now=now or datetime.now(tz=UTC),
            )

    def feed_all(
        self, segments: Iterable[TcpSegment], *, now: datetime | None = None
    ) -> CaptureStats:
        for segment in segments:
            self.feed(segment, now=now)
        return self.stats

    def _check_clock(self, command: str, payload: dict[str, Any], now: datetime) -> None:
        """Compare our clock against the server's when it volunteers one.

        Checking beats correcting: this process has no business setting the
        system clock, and a session that ran with a wrong one needs to be
        recognisable afterwards, not silently adjusted.
        """
        if command != clock.SOURCE_COMMAND:
            return
        skew = clock.skew_seconds(payload, now)
        if skew is None:
            log.warning("capture.clock_unreadable", payload=payload)
            return
        self.stats.clock_skew_seconds = skew
        if abs(skew) > CLOCK_SKEW_WARN_SECONDS:
            log.warning(
                "capture.clock_skew",
                skew_seconds=round(skew, 1),
                detail="this machine's clock disagrees with the game server;"
                " captured_at on this session is off by the same amount",
            )
        else:
            log.info("capture.clock_checked", skew_seconds=round(skew, 1))

    def refresh_loss_counters(self) -> None:
        """Roll per-stream loss counters up into the reported stats."""
        self.stats.resync_bytes = sum(s.decoder.resync_bytes for s in self._streams.values())
        self.stats.gap_skips = sum(s.gap_skips for s in self._streams.values())

    def _record(self, event: ExtensionEvent, *, now: datetime) -> None:
        self._sequence += 1
        observation = Observation(
            observation_id=uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"dw-capture:{self.collector_id}:{now.isoformat()}:{self._sequence}",
            ),
            collector_id=self.collector_id,
            source_command=event.command,
            captured_at=now,
            collected_from_server_id=self.collected_from_server_id,
            payload=dict(event.payload),
        )
        try:
            rows = pipeline.observe(observation)
        except ValidationError as exc:
            # A payload we recognise but cannot parse: count it, keep going,
            # and leave a log line with the command for the parser author.
            self.stats.rejected += 1
            log.warning("capture.payload_rejected", command=event.command, error=str(exc))
            return

        result = self.journal.record(observation, rows)
        self.stats.rows += result.rows_inserted
        self.stats.commands[event.command] = self.stats.commands.get(event.command, 0) + 1
        if rows and rows[0].target_table == "schema_observations":
            self.stats.discovered += 1
        else:
            self.stats.ingested += 1
