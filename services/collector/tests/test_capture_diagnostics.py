"""Telling "no packets" apart from "packets, no output".

Both look identical from outside: the journal stops growing, the process
stays up, dw-sync keeps heartbeating. Distinguishing them has needed a
side-by-side dumpcap run every single time — three separate silent
failures so far, and each one cost a session to localise.

`segments` answers the first question. `buffered_bytes` answers the
second: a decoder waiting on a length that never arrives keeps the bytes
and never returns a frame.
"""

from __future__ import annotations

import struct
import uuid
from datetime import UTC, datetime, timedelta

from dw_collector.capture.session import CaptureSession
from dw_collector.protocol.pcapng import (
    MAX_PENDING_SEGMENTS,
    TCPDirectionReassembler,
    TcpSegment,
)
from dw_collector.storage.journal import Journal
from tests.test_capture_session import envelope, frame

COLLECTOR = uuid.UUID("00000000-0000-4000-8000-00000000c001")


def _session(journal: Journal) -> CaptureSession:
    return CaptureSession(journal, collector_id=COLLECTOR, collected_from_server_id=580)


def _inbound(payload: bytes, sequence: int = 0) -> TcpSegment:
    return TcpSegment(
        source_ip="47.0.0.1",
        destination_ip="192.168.0.2",
        source_port=8680,
        destination_port=50000,
        sequence=sequence,
        payload=payload,
    )


def test_a_quiet_wire_and_a_quiet_decoder_read_differently(journal: Journal) -> None:
    session = _session(journal)

    idle = session.diagnostics()
    assert idle["segments"] == 0
    assert idle["buffered_bytes"] == 0
    assert idle["last_frame_at"] is None

    # A header claiming bytes that will never arrive: packets ARE coming in,
    # and nothing comes out. That is the shape of the wedge.
    session.feed(_inbound(bytes([0x88]) + struct.pack("!I", 500_000) + b"\x12\x00"))
    wedged = session.diagnostics()

    assert wedged["segments"] == 1, "the segment arrived"
    assert wedged["frames"] == 0, "and produced nothing"
    assert int(wedged["buffered_bytes"]) > 0, "because it is being held, not dropped"
    assert wedged["last_frame_at"] is None


def test_a_healthy_session_reports_progress(journal: Journal) -> None:
    session = _session(journal)

    session.feed(_inbound(frame(envelope("al.rank", {"allianceId": "x", "list": []}))))
    healthy = session.diagnostics()

    assert healthy["frames"] == 1
    assert healthy["buffered_bytes"] == 0, "a complete frame leaves nothing behind"
    assert healthy["last_frame_at"] is not None
    assert healthy["streams"] == 1


def test_last_frame_at_does_not_move_when_nothing_decodes(journal: Journal) -> None:
    # The field has to mean "when a frame last completed", not "when a
    # packet last arrived" — otherwise it reports healthy for exactly the
    # failure it exists to expose.
    session = _session(journal)
    session.feed(_inbound(frame(envelope("al.rank", {"allianceId": "x", "list": []}))))
    first = session.diagnostics()["last_frame_at"]

    session.feed(_inbound(b"\x88" + struct.pack("!I", 500_000) + b"\x12\x00", sequence=9_000))

    assert session.diagnostics()["last_frame_at"] == first


def test_the_entrypoint_logs_health_periodically() -> None:
    # A regression guard aimed at a specific way of losing this: stats used
    # to exist only at shutdown, and Task Scheduler kills rather than
    # interrupts, so they were never once seen in production.
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[1] / "src" / "dw_collector" / "capture" / "__main__.py"
    ).read_text(encoding="utf-8")

    assert "capture.health" in source
    assert "DW_CAPTURE_HEALTH_SECONDS" in source


def test_a_gap_is_abandoned_after_a_timeout_not_only_after_64_segments() -> None:
    """The wedge, in one test.

    A reconnect burst overruns the capture buffer and opens a gap. Then the
    game goes quiet, so the count-based escape never fires: seven segments
    arrive over the next minute and 64 is never reached. Reproduced offline
    from three consecutive capture files fed through one reassembler - 51
    segments in, 0 frames out, with buffered=0 and resync=0 because the bytes
    were held here rather than in the decoder.
    """
    blob = frame(envelope("al.rank", {"allianceId": "x", "list": []}))
    stream = TCPDirectionReassembler()
    start = datetime(2026, 8, 5, 12, 0, 0, tzinfo=UTC)

    # In order, so the cursor is established.
    assert stream.feed(1000, blob, now=start) != []

    # A gap: the next 200 bytes were never captured. One segment behind it.
    stalled_at = 1000 + len(blob) + 200
    assert stream.feed(stalled_at, blob, now=start) == []
    assert stream.pending

    # Traffic stays light. Nine seconds later, still waiting — a real
    # retransmit would have arrived, but this is well inside the window.
    assert stream.feed(stalled_at, blob, now=start + timedelta(seconds=9)) == []
    assert stream.gap_skips == 0

    # Past the window: give up on the missing bytes and decode what is here.
    frames = stream.feed(stalled_at, blob, now=start + timedelta(seconds=11))
    assert stream.gap_skips == 1
    assert frames != [], "the jump must also drain what it made contiguous"
    assert not stream.pending


def test_a_replay_with_no_clock_still_uses_the_count() -> None:
    """`now` is optional because a pcap replay has every byte and no wall
    clock worth trusting. The old bound has to keep working there."""
    blob = frame(envelope("al.rank", {"allianceId": "x", "list": []}))
    stream = TCPDirectionReassembler()
    stream.feed(1000, blob)
    for i in range(MAX_PENDING_SEGMENTS + 2):
        stream.feed(50_000 + i * len(blob), blob)
    assert stream.gap_skips >= 1
