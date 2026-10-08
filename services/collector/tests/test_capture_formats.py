"""Captures taken on a Mac: classic pcap, non-Ethernet link types, IPv6.

The Windows collector only ever reads dumpcap's Ethernet pcapng. A capture
taken by hand on a Mac can arrive in any of the shapes below, and every one
of them used to fail the whole file with "only Ethernet pcapng is
supported" — or, for classic pcap, with a byte-order error that named
nothing. Each test builds the same game response and wraps it differently;
the event that comes out must not depend on the wrapping.
"""

from __future__ import annotations

import struct
from datetime import UTC, datetime
from pathlib import Path

import pytest
from typer.testing import CliRunner

from dw_collector.cli import app
from dw_collector.protocol.linklayer import (
    LINKTYPE_ETHERNET,
    LINKTYPE_IPV4,
    LINKTYPE_LINUX_SLL,
    LINKTYPE_LINUX_SLL2,
    LINKTYPE_LOOP,
    LINKTYPE_NULL,
    LINKTYPE_PKTAP,
    LINKTYPE_RAW,
)
from dw_collector.protocol.pcapng import (
    PcapError,
    iter_extension_events,
    parse_tcp,
    read_pcapng_records,
)
from tests.test_protocol import ENVELOPE, frame

PORT = 8680
WHEN = datetime(2026, 7, 30, 18, 33, 47, 776080, tzinfo=UTC)
WHEN_MICROS = 1_785_436_427_776_080

# --- packet builders ---------------------------------------------------------


def _tcp(payload: bytes, *, sport: int = PORT, dport: int = 50000, seq: int = 1) -> bytes:
    return struct.pack("!HHIIBBHHH", sport, dport, seq, 0, 0x50, 0x18, 8192, 0, 0) + payload


def _ipv4(segment: bytes, *, total_length: int | None = None) -> bytes:
    length = 20 + len(segment) if total_length is None else total_length
    header = struct.pack(
        "!BBHHHBBH4s4s", 0x45, 0, length, 1, 0, 64, 6, 0, bytes([10, 0, 0, 1]), bytes([10, 0, 0, 2])
    )
    return header + segment


def _ipv6(segment: bytes, *, extension: bytes = b"", first_header: int = 6) -> bytes:
    header = struct.pack("!IHBB", 6 << 28, len(extension) + len(segment), first_header, 64)
    source = bytes.fromhex("20010db8000000000000000000000001")
    destination = bytes.fromhex("20010db8000000000000000000000002")
    return header + source + destination + extension + segment


def _ethernet(ip: bytes) -> bytes:
    ether_type = 0x86DD if ip[0] >> 4 == 6 else 0x0800
    return b"\x02" * 6 + b"\x04" * 6 + struct.pack("!H", ether_type) + ip


def _game_ipv4() -> bytes:
    return _ipv4(_tcp(frame(ENVELOPE)))


# --- container builders ------------------------------------------------------


def _block(block_type: int, body: bytes) -> bytes:
    pad = -len(body) % 4
    length = 12 + len(body) + pad
    return struct.pack("<II", block_type, length) + body + b"\x00" * pad + struct.pack("<I", length)


def _pcapng(packets: list[tuple[int, bytes]], linktypes: list[int]) -> bytes:
    """packets are (interface index, frame); one IDB per entry in linktypes."""
    out = _block(0x0A0D0D0A, struct.pack("<IHHq", 0x1A2B3C4D, 1, 0, -1))
    for linktype in linktypes:
        out += _block(1, struct.pack("<HHI", linktype, 0, 0x40000))
    for interface, packet in packets:
        header = struct.pack(
            "<IIIII",
            interface,
            WHEN_MICROS >> 32,
            WHEN_MICROS & 0xFFFFFFFF,
            len(packet),
            len(packet),
        )
        out += _block(6, header + packet)
    return out


def _classic(
    packets: list[bytes], linktype: int, *, endian: str = "<", nanos: bool = False
) -> bytes:
    magic = 0xA1B23C4D if nanos else 0xA1B2C3D4
    out = struct.pack(endian + "IHHiIII", magic, 2, 4, 0, 0, 0x40000, linktype)
    seconds, micros = divmod(WHEN_MICROS, 1_000_000)
    fraction = micros * 1000 if nanos else micros
    for packet in packets:
        out += struct.pack(endian + "IIII", seconds, fraction, len(packet), len(packet)) + packet
    return out


def _events(path: Path) -> list[tuple[str, str]]:
    return [(e.direction, e.command) for e in iter_extension_events(path, port=PORT)]


# --- classic pcap ------------------------------------------------------------


@pytest.mark.parametrize(
    ("endian", "nanos"),
    [("<", False), (">", False), ("<", True), (">", True)],
    ids=["little-micro", "big-micro", "little-nano", "big-nano"],
)
def test_classic_pcap_in_every_byte_order_and_resolution(
    tmp_path: Path, endian: str, nanos: bool
) -> None:
    path = tmp_path / "trip.pcap"
    path.write_bytes(
        _classic([_ethernet(_game_ipv4())], LINKTYPE_ETHERNET, endian=endian, nanos=nanos)
    )

    records = read_pcapng_records(path)

    assert [r.captured_at for r in records] == [WHEN]
    assert _events(path) == [("inbound", "al.rank")]


def test_a_truncated_classic_tail_keeps_what_came_before(tmp_path: Path) -> None:
    """A capture stopped by hand can end mid-record. Failing the file would
    lose the whole session for the last few bytes of it."""
    whole = _classic([_ethernet(_game_ipv4())], LINKTYPE_ETHERNET)
    tail = struct.pack("<IIII", 0, 0, 500, 500) + b"\x00" * 10
    path = tmp_path / "cut.pcap"
    path.write_bytes(whole + tail)

    assert _events(path) == [("inbound", "al.rank")]


def test_a_truncated_pcapng_tail_keeps_what_came_before(tmp_path: Path) -> None:
    """A capture process that is ended mid-write leaves a cut-off last block.
    On 2026-10-08 that failed a whole 4.4 MB phone chunk with "invalid block"
    and cost the login response in it."""
    whole = _pcapng([(0, _ethernet(_game_ipv4()))], [LINKTYPE_ETHERNET])
    # A packet block that claims 4096 bytes and carries 10.
    cut = struct.pack("<II", 6, 4096) + b"\x00" * 10
    path = tmp_path / "cut.pcapng"
    path.write_bytes(whole + cut)

    assert _events(path) == [("inbound", "al.rank")]


def test_a_pcapng_block_shorter_than_its_own_header_is_still_an_error(tmp_path: Path) -> None:
    whole = _pcapng([(0, _ethernet(_game_ipv4()))], [LINKTYPE_ETHERNET])
    path = tmp_path / "garbage.pcapng"
    path.write_bytes(whole + struct.pack("<II", 6, 4) + b"\x00" * 8)

    with pytest.raises(PcapError, match="invalid block"):
        read_pcapng_records(path)


def test_a_classic_file_with_no_header_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / "stub.pcap"
    path.write_bytes(b"\xd4\xc3\xb2\xa1" + b"\x00" * 8)

    with pytest.raises(PcapError, match="truncated pcap header"):
        read_pcapng_records(path)


# --- link types --------------------------------------------------------------


def _pktap(inner_dlt: int, inner: bytes) -> bytes:
    # Apple's header: its own length, then the DLT of what follows, then
    # fields this reader does not need. 108 bytes is what macOS writes.
    return struct.pack("<II", 108, inner_dlt) + b"\x00" * 100 + inner


LINK_FRAMES = {
    "ethernet": (LINKTYPE_ETHERNET, lambda ip: _ethernet(ip)),
    "bsd-null-little": (LINKTYPE_NULL, lambda ip: struct.pack("<I", 2) + ip),
    "bsd-null-big": (LINKTYPE_NULL, lambda ip: struct.pack(">I", 2) + ip),
    "bsd-loop": (LINKTYPE_LOOP, lambda ip: struct.pack("!I", 2) + ip),
    "raw": (LINKTYPE_RAW, lambda ip: ip),
    "ipv4": (LINKTYPE_IPV4, lambda ip: ip),
    "linux-sll": (LINKTYPE_LINUX_SLL, lambda ip: b"\x00" * 14 + b"\x08\x00" + ip),
    "linux-sll2": (LINKTYPE_LINUX_SLL2, lambda ip: b"\x08\x00" + b"\x00" * 18 + ip),
    "pktap-ethernet": (LINKTYPE_PKTAP, lambda ip: _pktap(1, _ethernet(ip))),
    "pktap-raw": (LINKTYPE_PKTAP, lambda ip: _pktap(12, ip)),
}


@pytest.mark.parametrize("name", list(LINK_FRAMES))
def test_every_supported_link_type_yields_the_event(tmp_path: Path, name: str) -> None:
    linktype, wrap = LINK_FRAMES[name]
    path = tmp_path / f"{name}.pcapng"
    path.write_bytes(_pcapng([(0, wrap(_game_ipv4()))], [linktype]))

    assert _events(path) == [("inbound", "al.rank")]


def test_an_unsupported_interface_does_not_cost_the_rest(tmp_path: Path) -> None:
    """`-i any` on a Mac writes one interface per adapter. One link type this
    reader cannot open must skip that interface's packets, not the file."""
    path = tmp_path / "mixed.pcapng"
    path.write_bytes(
        _pcapng([(0, b"\xff" * 40), (1, _ethernet(_game_ipv4()))], [147, LINKTYPE_ETHERNET])
    )

    assert _events(path) == [("inbound", "al.rank")]


def test_a_file_of_only_unsupported_link_types_says_so(tmp_path: Path) -> None:
    """Silence would read as "nothing happened in that session"."""
    path = tmp_path / "usb.pcapng"
    path.write_bytes(_pcapng([(0, b"\xff" * 40)], [147]))

    with pytest.raises(PcapError, match="unsupported link type 147"):
        read_pcapng_records(path)


def test_a_loopback_frame_of_another_family_is_not_ip() -> None:
    assert parse_tcp(struct.pack("<I", 99) + _game_ipv4(), LINKTYPE_NULL) is None


def test_pktap_cannot_nest_pktap() -> None:
    nested = _pktap(LINKTYPE_PKTAP, _pktap(1, _ethernet(_game_ipv4())))
    assert parse_tcp(nested, LINKTYPE_PKTAP) is None


# --- IP versions -------------------------------------------------------------


def test_ipv6_over_ethernet(tmp_path: Path) -> None:
    path = tmp_path / "v6.pcapng"
    path.write_bytes(_pcapng([(0, _ethernet(_ipv6(_tcp(frame(ENVELOPE)))))], [LINKTYPE_ETHERNET]))

    assert _events(path) == [("inbound", "al.rank")]


def test_ipv6_over_macos_loopback(tmp_path: Path) -> None:
    # AF_INET6 is 30 on macOS — not the 10 Linux uses, and not 24 or 28.
    packet = struct.pack("<I", 30) + _ipv6(_tcp(frame(ENVELOPE)))
    path = tmp_path / "lo0.pcap"
    path.write_bytes(_classic([packet], LINKTYPE_NULL))

    assert _events(path) == [("inbound", "al.rank")]


def test_ipv6_walks_past_a_hop_by_hop_header() -> None:
    hop_by_hop = bytes([6, 0]) + b"\x00" * 6  # next=TCP, length 0 → 8 bytes
    segment = parse_tcp(_ipv6(_tcp(b"hello"), extension=hop_by_hop, first_header=0), LINKTYPE_RAW)

    assert segment is not None
    assert segment.payload == b"hello"
    assert segment.source_ip == "2001:db8::1"


def test_an_ipv6_fragment_is_not_a_segment() -> None:
    fragment = bytes([6, 0]) + b"\x00" * 6
    assert parse_tcp(_ipv6(_tcp(b"x"), extension=fragment, first_header=44), LINKTYPE_RAW) is None


def test_an_ipv4_length_of_zero_means_the_bytes_on_hand() -> None:
    """Segmentation offload leaves total length 0 in what the capture saw.
    Trusting it would cut every payload to nothing."""
    segment = parse_tcp(_ipv4(_tcp(b"hello"), total_length=0), LINKTYPE_RAW)

    assert segment is not None
    assert segment.payload == b"hello"


# --- end to end --------------------------------------------------------------


def test_ingest_dir_reads_a_folder_of_classic_captures(tmp_path: Path) -> None:
    directory = tmp_path / "captures"
    directory.mkdir()
    (directory / "trip_00001_20261002120000.pcap").write_bytes(
        _classic([struct.pack("<I", 2) + _game_ipv4()], LINKTYPE_NULL)
    )

    result = CliRunner().invoke(
        app,
        [
            "ingest-dir",
            "--dir",
            str(directory),
            "--db",
            str(tmp_path / "journal.db"),
            "--min-age-seconds",
            "0",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "UNREADABLE" not in result.output
    assert "trip_00001_20261002120000.pcap" in result.output
    assert "done: 1 file(s)" in result.output
