"""Protocol decode tests: synthetic frames end-to-end, plus a replay of the
real capture when it is present on this machine (it lives outside the repo).
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import pytest

from dw_collector.protocol.frames import SmartFoxStreamDecoder, extract_extension_event
from dw_collector.protocol.pcapng import (
    TCPDirectionReassembler,
    iter_extension_events,
    parse_tcp,
)
from dw_collector.protocol.sfs import ParseError, Reader, SfsValue, parse_sfs_value

REAL_PCAP = Path("/mnt/c/darkwar-adb/darkwar_alrank.pcapng")

# --- minimal SFS encoder (tests only) ---------------------------------------


def _utf(value: str) -> bytes:
    raw = value.encode()
    return struct.pack("!H", len(raw)) + raw


def encode_sfs(value: SfsValue) -> bytes:
    if value is None:
        return b"\x00"
    if isinstance(value, bool):
        return b"\x01" + bytes([int(value)])
    if isinstance(value, int):
        return b"\x05" + struct.pack("!q", value)
    if isinstance(value, str):
        return b"\x08" + _utf(value)
    if isinstance(value, list):
        return (
            b"\x11" + struct.pack("!H", len(value)) + b"".join(encode_sfs(item) for item in value)
        )
    if isinstance(value, dict):
        body = b"".join(_utf(k) + encode_sfs(v) for k, v in value.items())
        return b"\x12" + struct.pack("!H", len(value)) + body
    raise AssertionError(f"unencodable test value: {value!r}")


def frame(obj: SfsValue, *, compressed: bool = False) -> bytes:
    body = encode_sfs(obj)
    if compressed:
        body = zlib.compress(body)
        return bytes([0xA0]) + struct.pack("!H", len(body)) + body
    return bytes([0x80]) + struct.pack("!H", len(body)) + body


# The a/c/p shape every real frame carries (SmartFox2X extension response).
ENVELOPE: dict[str, SfsValue] = {
    "a": 13,
    "c": 1,
    "p": {"c": "al.rank", "p": {"_id": 7, "allianceId": "abc", "list": [{"uid": "1000580"}]}},
}


# --- sfs ---------------------------------------------------------------------


def test_sfs_roundtrip() -> None:
    reader = Reader(encode_sfs(ENVELOPE))
    assert parse_sfs_value(reader) == ENVELOPE
    assert reader.pos == len(reader.data)


def test_sfs_truncated_raises() -> None:
    data = encode_sfs(ENVELOPE)[:-3]
    with pytest.raises(ParseError):
        parse_sfs_value(Reader(data))


def test_sfs_unsupported_type_raises() -> None:
    with pytest.raises(ParseError, match="type ID 19"):
        parse_sfs_value(Reader(b"\x13"))


# --- frames ------------------------------------------------------------------


def test_plain_and_compressed_frames() -> None:
    decoder = SmartFoxStreamDecoder()
    frames = decoder.feed(frame(ENVELOPE) + frame(ENVELOPE, compressed=True))
    assert len(frames) == 2
    assert frames[0].compressed is False
    assert frames[1].compressed is True
    assert frames[0].object == frames[1].object == ENVELOPE


def test_partial_feed_and_midstream_attach() -> None:
    payload = frame(ENVELOPE)
    decoder = SmartFoxStreamDecoder()
    # Attach mid-stream: garbage first, then a frame split across feeds.
    assert decoder.feed(b"\x77\x01\x02" + payload[:5]) == []
    frames = decoder.feed(payload[5:])
    assert len(frames) == 1
    assert frames[0].object == ENVELOPE


def test_extension_event_extraction() -> None:
    event = extract_extension_event(ENVELOPE)
    assert event is not None
    command, payload, request_id = event
    assert command == "al.rank"
    assert request_id == 7
    assert payload["allianceId"] == "abc"
    assert extract_extension_event({"no": "envelope"}) is None
    assert extract_extension_event(b"bytes") is None


# --- tcp reassembly ----------------------------------------------------------


def test_reassembler_reorders_and_dedupes() -> None:
    # The first observed segment sets the stream base (mid-stream attach);
    # after that, later segments may arrive out of order and must wait for
    # the gap to fill.
    data = frame(ENVELOPE)
    reassembler = TCPDirectionReassembler()
    assert reassembler.feed(1000, data[:3]) == []  # base, incomplete frame
    assert reassembler.feed(1007, data[7:]) == []  # out of order: gap at 1003
    frames = reassembler.feed(1003, data[3:7])  # gap fills, frame completes
    assert len(frames) == 1
    assert frames[0].object == ENVELOPE
    assert reassembler.feed(1000, data) == []  # pure retransmission


# --- pcapng ------------------------------------------------------------------


def _block(block_type: int, body: bytes) -> bytes:
    length = 12 + len(body) + (-len(body) % 4)
    return (
        struct.pack("<II", block_type, length)
        + body
        + b"\x00" * (-len(body) % 4)
        + struct.pack("<I", length)
    )


def _pcapng(packets: list[bytes]) -> bytes:
    shb_body = struct.pack("<IHHq", 0x1A2B3C4D, 1, 0, -1)
    out = _block(0x0A0D0D0A, shb_body)
    out += _block(1, struct.pack("<HHI", 1, 0, 0x40000))
    for packet in packets:
        epb_body = struct.pack("<IIIII", 0, 0, 0, len(packet), len(packet)) + packet
        out += _block(6, epb_body)
    return out


def _tcp_packet(payload: bytes, *, sport: int, dport: int, seq: int) -> bytes:
    eth = b"\x02" * 6 + b"\x04" * 6 + struct.pack("!H", 0x0800)
    total = 20 + 20 + len(payload)
    ip = struct.pack(
        "!BBHHHBBH4s4s",
        0x45,
        0,
        total,
        1,
        0,
        64,
        6,
        0,
        bytes([10, 0, 0, 1]),
        bytes([10, 0, 0, 2]),
    )
    tcp = struct.pack("!HHIIBBHHH", sport, dport, seq, 0, 0x50, 0x18, 8192, 0, 0)
    return eth + ip + tcp + payload


def test_pcapng_to_extension_events(tmp_path: Path) -> None:
    packet = _tcp_packet(frame(ENVELOPE), sport=8680, dport=50000, seq=1)
    capture = tmp_path / "tiny.pcapng"
    capture.write_bytes(_pcapng([packet]))

    events = list(iter_extension_events(capture))
    assert len(events) == 1
    assert events[0].direction == "inbound"
    assert events[0].command == "al.rank"
    assert events[0].request_id == 7


def test_parse_tcp_ignores_non_tcp() -> None:
    assert parse_tcp(b"\x00" * 13) is None
    arp = b"\x02" * 12 + struct.pack("!H", 0x0806) + b"\x00" * 28
    assert parse_tcp(arp) is None


# --- real capture (outside the repo; skipped where absent) -------------------


@pytest.mark.skipif(not REAL_PCAP.exists(), reason="real capture not on this machine")
def test_real_capture_decodes() -> None:
    inbound = [
        event
        for event in iter_extension_events(REAL_PCAP)
        if event.direction == "inbound" and event.command == "al.rank"
    ]
    assert len(inbound) == 1
    members = inbound[0].payload["list"]
    assert isinstance(members, list)
    assert len(members) == 93


@pytest.mark.skipif(not REAL_PCAP.exists(), reason="real capture not on this machine")
def test_committed_fixture_matches_sanitized_capture() -> None:
    """Provenance pin: the committed fixture is exactly sanitize(real capture)."""
    from dw_collector.sanitize import sanitize_al_rank
    from tests.conftest import load_observation

    inbound = next(
        event
        for event in iter_extension_events(REAL_PCAP)
        if event.direction == "inbound" and event.command == "al.rank"
    )
    committed = load_observation("al.rank/cbfw_roster_v1.json")
    assert committed.payload == sanitize_al_rank(dict(inbound.payload))


ARENA_PCAP = Path("/mnt/c/darkwar-adb/darkwar_arena_match.pcapng")


@pytest.mark.skipif(not ARENA_PCAP.exists(), reason="real capture not on this machine")
def test_committed_arena_fixture_matches_sanitized_capture() -> None:
    from dw_collector.sanitize import sanitize_user_get_arena_info
    from tests.conftest import load_observation

    inbound = next(
        event
        for event in iter_extension_events(ARENA_PCAP)
        if event.direction == "inbound" and event.command == "user.get.arena.info"
    )
    committed = load_observation("user.get.arena.info/top100_580v582_v1.json")
    assert committed.payload == sanitize_user_get_arena_info(dict(inbound.payload))


ALLIANCE_RANK_PCAPS = [
    ("darkwar_alliance_rank_local.pcapng", "alliance.rank/local_580_v1.json"),
    ("darkwar_alliance_rank_local_try2.pcapng", "alliance.rank/cross_group_v1.json"),
]


@pytest.mark.parametrize(("pcap_name", "fixture"), ALLIANCE_RANK_PCAPS)
def test_committed_alliance_rank_fixtures_match_sanitized_captures(
    pcap_name: str, fixture: str
) -> None:
    pcap = Path("/mnt/c/darkwar-adb") / pcap_name
    if not pcap.exists():
        pytest.skip("real capture not on this machine")
    from dw_collector.sanitize import sanitize_alliance_rank
    from tests.conftest import load_observation

    inbound = next(
        event
        for event in iter_extension_events(pcap)
        if event.direction == "inbound" and event.command == "alliance.rank"
    )
    committed = load_observation(fixture)
    assert committed.payload == sanitize_alliance_rank(dict(inbound.payload))


def test_committed_get_al_info_fixture_matches_sanitized_capture() -> None:
    pcap = Path("/mnt/c/darkwar-adb/darkwar_alliance_rank_580_T2.pcapng")
    if not pcap.exists():
        pytest.skip("real capture not on this machine")
    from dw_collector.sanitize import sanitize_get_al_info
    from tests.conftest import load_observation

    inbound = next(
        event
        for event in iter_extension_events(pcap)
        if event.direction == "inbound" and event.command == "get.al.info"
    )
    committed = load_observation("get.al.info/love_580_v1.json")
    assert committed.payload == sanitize_get_al_info(dict(inbound.payload))


def test_committed_server_rank_fixture_matches_sanitized_capture() -> None:
    pcap = Path("/mnt/c/darkwar-adb/darkwar_player_profile_cp.pcapng")
    if not pcap.exists():
        pytest.skip("real capture not on this machine")
    from dw_collector.sanitize import sanitize_server_rank
    from tests.conftest import load_observation

    inbound = next(
        event
        for event in iter_extension_events(pcap)
        if event.direction == "inbound" and event.command == "server.rank"
    )
    committed = load_observation("server.rank/group_top150_v1.json")
    assert committed.payload == sanitize_server_rank(dict(inbound.payload))


def test_committed_profile_fixture_matches_sanitized_capture() -> None:
    pcap = Path("/mnt/c/darkwar-adb/darkwar_player_profile_cp.pcapng")
    if not pcap.exists():
        pytest.skip("real capture not on this machine")
    from dw_collector.sanitize import sanitize_get_new_user_info
    from tests.conftest import load_observation

    inbound = next(
        event
        for event in iter_extension_events(pcap)
        if event.direction == "inbound" and event.command == "get.new.user.info"
    )
    committed = load_observation("get.new.user.info/profile_578_v1.json")
    assert committed.payload == sanitize_get_new_user_info(dict(inbound.payload))


def test_committed_multi_fixture_matches_sanitized_capture() -> None:
    pcap = Path("/mnt/c/darkwar-adb/darkwar_player_profile_cp.pcapng")
    if not pcap.exists():
        pytest.skip("real capture not on this machine")
    from dw_collector.sanitize import sanitize_get_user_info_multi
    from tests.conftest import load_observation

    inbound = next(
        event
        for event in iter_extension_events(pcap)
        if event.direction == "inbound" and event.command == "get.user.info.multi"
    )
    committed = load_observation("get.user.info.multi/summary_578_v1.json")
    assert committed.payload == sanitize_get_user_info_multi(dict(inbound.payload))


def test_every_confirmed_command_has_a_parser() -> None:
    """Appendix B registry vs what the collector can actually normalize.
    user.arena.save.defend.army is the collector's own outbound write and
    has no product table, so it is deliberately unparsed."""
    from dw_collector import normalize as _normalize  # noqa: F401
    from dw_collector import registry

    confirmed = {
        "alliance.rank",
        "get.al.info",
        "al.rank",
        "server.rank",
        "get.new.user.info",
        "get.user.info.multi",
        "user.get.arena.info",
    }
    assert confirmed <= registry.known_commands()


def test_binary_payload_survives_the_journal_and_hashing(tmp_path: Path) -> None:
    """SFS type 10 decodes to bytes (defense lineups carry them). Legacy had
    a dedicated bytes-payload test; this is its promoted form."""
    import uuid
    from datetime import UTC, datetime

    from dw_collector.models import Observation, payload_hash
    from dw_collector.normalize import al_rank
    from dw_collector.storage.journal import Journal

    observation = Observation(
        observation_id=uuid.uuid4(),
        collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c777"),
        source_command="al.rank",
        captured_at=datetime.now(tz=UTC),
        collected_from_server_id=580,
        payload={
            "allianceId": "f" * 32,
            "list": [{"uid": "9000000901000580", "name": "Bin", "blob": b"\x00\xff\x10raw"}],
        },
    )
    # Hashing must not raise, and must stay stable across calls.
    assert payload_hash(observation.payload) == payload_hash(observation.payload)

    journal = Journal(tmp_path / "bytes.db")
    journal.init_db()
    try:
        result = journal.record(observation, al_rank.normalize(observation))
        assert result.rows_inserted == 1
        # Round-tripped rows carry the blob as base64 text, never raw bytes,
        # so the sync worker can hand them to an HTTP client.
        item = journal.pending_outbox()[0]
        assert isinstance(item.payload.row["raw"]["blob"], str)
    finally:
        journal.close()


def test_committed_donation_fixture_matches_sanitized_capture() -> None:
    pcap = Path("/mnt/c/DW_data/probe.pcapng")
    if not pcap.exists():
        pytest.skip("sweep capture not on this machine")
    from dw_collector.sanitize import sanitize_daily_alliance_donate_rank
    from tests.conftest import load_observation

    inbound = next(
        event
        for event in iter_extension_events(pcap)
        if event.direction == "inbound" and event.command == "get.daily.alliance.donate.rank"
    )
    committed = load_observation("get.daily.alliance.donate.rank/daily_580_v1.json")
    assert committed.payload == sanitize_daily_alliance_donate_rank(dict(inbound.payload))


def test_committed_kill_rank_fixture_matches_sanitized_capture() -> None:
    pcap = Path("/mnt/c/DW_data/probe.pcapng")
    if not pcap.exists():
        pytest.skip("sweep capture not on this machine")
    from dw_collector.sanitize import sanitize_kill_rank
    from tests.conftest import load_observation

    inbound = next(
        event
        for event in iter_extension_events(pcap)
        if event.direction == "inbound" and event.command == "kill.rank"
    )
    committed = load_observation("kill.rank/group_kills_v1.json")
    assert committed.payload == sanitize_kill_rank(dict(inbound.payload))


def test_packets_carry_their_capture_time() -> None:
    """A pcap replayed weeks later must not be labelled with the replay's
    clock. The timestamps were being read and discarded."""
    from dw_collector.protocol.pcapng import read_pcapng_records

    records = read_pcapng_records(REAL_PCAP)

    assert records
    assert all(r.captured_at is not None for r in records)
    # Monotonic within a capture, and every packet inside the session.
    times = [r.captured_at for r in records]
    assert times == sorted(times)
    assert (times[-1] - times[0]).total_seconds() < 60 * 60 * 24


def test_extension_events_inherit_the_packet_time() -> None:
    events = [e for e in iter_extension_events(REAL_PCAP) if e.direction == "inbound"]

    assert events
    assert all(e.captured_at is not None for e in events)


def test_timestamp_resolution_defaults_to_microseconds() -> None:
    """if_tsresol is optional; absent means 10^-6 (pcapng 4.2). Getting the
    default wrong scales every timestamp by a million."""
    from dw_collector.protocol.pcapng import _timestamp_divisor

    assert _timestamp_divisor(6) == 1_000_000
    assert _timestamp_divisor(9) == 1_000_000_000
    assert _timestamp_divisor(3) == 1_000
    # High bit set means 2^-n rather than 10^-n.
    assert _timestamp_divisor(0x80 | 10) == 1024
