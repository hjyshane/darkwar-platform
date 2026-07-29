"""The capture engine, driven by hand-built TCP segments.

No scapy, no Npcap, no BlueStacks: the Observation seam means the live
path is a packet source, and this is everything below it.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

from dw_collector.capture.session import CaptureSession
from dw_collector.protocol.pcapng import TcpSegment
from dw_collector.storage.journal import Journal
from tests.conftest import FIXTURES
from tests.test_protocol import frame

COLLECTOR = uuid.UUID("00000000-0000-4000-8000-00000000c777")
NOW = datetime(2026, 7, 28, 12, tzinfo=UTC)


def segment(payload: bytes, *, sport: int = 8680, dport: int = 50000, seq: int = 1) -> TcpSegment:
    return TcpSegment(
        source_ip="10.0.0.1" if sport == 8680 else "10.0.0.2",
        destination_ip="10.0.0.2" if sport == 8680 else "10.0.0.1",
        source_port=sport,
        destination_port=dport,
        sequence=seq,
        payload=payload,
    )


def envelope(command: str, payload: dict[str, object]) -> dict[str, object]:
    return {"p": {"c": command, "p": payload}}


def real_payload(relative: str) -> dict[str, object]:
    raw = json.loads((FIXTURES / "decoded" / relative).read_text())
    return dict(raw["payload"])


@pytest.fixture
def session(journal: Journal) -> CaptureSession:
    return CaptureSession(journal, collector_id=COLLECTOR, collected_from_server_id=580)


def test_known_command_is_ingested(session: CaptureSession, journal: Journal) -> None:
    payload = real_payload("al.rank/cbfw_roster_v1.json")
    session.feed(segment(frame(envelope("al.rank", payload))), now=NOW)

    assert session.stats.ingested == 1
    assert session.stats.rows == 93
    rows = journal.conn.execute(
        "select count(*) from normalized_rows where target_table = 'alliance_member_snapshots'"
    ).fetchone()
    assert rows[0] == 93
    # Journalled, so the sync worker picks it up with no extra plumbing.
    assert len(journal.pending_outbox(limit=200)) == 93


def test_unknown_command_becomes_discovery(session: CaptureSession, journal: Journal) -> None:
    session.feed(segment(frame(envelope("get.battlepass.info", {"season": 3}))), now=NOW)

    assert session.stats.discovered == 1
    assert session.stats.ingested == 0
    item = journal.pending_outbox()[0]
    assert item.payload.target_table == "schema_observations"
    assert item.payload.row["sample"] == {"season": "integer"}


def test_malformed_payload_is_counted_not_raised(session: CaptureSession, journal: Journal) -> None:
    """FR-COL-003: a collector that dies on a surprise stops collecting."""
    session.feed(segment(frame(envelope("al.rank", {"allianceId": "x", "list": "nope"}))), now=NOW)
    assert session.stats.rejected == 1
    assert journal.pending_outbox() == []

    # ...and the session keeps working afterwards (new stream, so the
    # reassembler is not waiting on a sequence gap).
    session.feed(segment(frame(envelope("get.battlepass.info", {"a": 1})), dport=50001), now=NOW)
    assert session.stats.discovered == 1


def test_outbound_requests_are_ignored(session: CaptureSession) -> None:
    """Our own requests travel TO the game port and are not observations."""
    session.feed(segment(frame(envelope("al.rank", {"x": 1})), sport=50000, dport=8680), now=NOW)
    assert session.stats.frames == 1
    assert session.stats.ingested == session.stats.discovered == 0


def test_traffic_on_other_ports_is_dropped(session: CaptureSession) -> None:
    session.feed(segment(frame(envelope("al.rank", {"x": 1})), sport=443, dport=50000), now=NOW)
    assert session.stats.segments == 0


def test_response_split_across_segments_is_reassembled(
    session: CaptureSession, journal: Journal
) -> None:
    data = frame(envelope("get.battlepass.info", {"season": 3, "tiers": [{"id": 1}]}))
    session.feed(segment(data[:5], seq=1000), now=NOW)
    assert session.stats.frames == 0
    session.feed(segment(data[5:], seq=1000 + 5), now=NOW)
    assert session.stats.frames == 1
    assert session.stats.discovered == 1


def test_repeated_capture_of_the_same_response_is_deduped(
    session: CaptureSession, journal: Journal
) -> None:
    payload = real_payload("user.get.arena.info/top100_580v582_v1.json")
    data = frame(envelope("user.get.arena.info", payload))
    session.feed(segment(data), now=NOW)
    first = len(journal.pending_outbox(limit=500))

    # Same bytes again (retransmit on a new stream) at the same instant:
    # idempotency keys collide, so nothing new is journalled.
    other = CaptureSession(journal, collector_id=COLLECTOR, collected_from_server_id=580)
    other.feed(segment(data, dport=50001), now=NOW)
    assert len(journal.pending_outbox(limit=500)) == first


def test_live_module_imports_without_scapy() -> None:
    """The pipeline must stay installable without the capture extra."""
    from dw_collector.capture import live

    assert live.DEFAULT_PORT == 8680
    if Path("/nonexistent-scapy-marker").exists():  # pragma: no cover
        pytest.skip("unreachable")
