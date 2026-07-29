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


ENVELOPE: dict[str, SfsValue] = {
    "p": {"c": "al.rank", "p": {"_id": 7, "allianceId": "abc", "list": [{"uid": "1000580"}]}}
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
