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

import structlog
from pydantic import ValidationError

from dw_collector import pipeline
from dw_collector.models import Observation
from dw_collector.protocol.frames import extract_extension_event
from dw_collector.protocol.pcapng import ExtensionEvent, TCPDirectionReassembler, TcpSegment
from dw_collector.storage.journal import Journal

log = structlog.get_logger()

DEFAULT_PORT = 8680


@dataclass
class CaptureStats:
    segments: int = 0
    frames: int = 0
    ingested: int = 0
    discovered: int = 0
    rejected: int = 0
    rows: int = 0
    commands: dict[str, int] = field(default_factory=dict)


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

        for frame in self._streams[key].feed(segment.sequence, segment.payload):
            self.stats.frames += 1
            if not inbound:
                continue
            event = extract_extension_event(frame.object)
            if event is None:
                continue
            command, payload, request_id = event
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
