"""Offline capture reading + minimal TCP parsing + directional reassembly.

Pure stdlib (no scapy): this is the offline path for fixture extraction and
capture replay. Reads pcapng and classic pcap, any link type in
`linklayer.SUPPORTED_LINKTYPES`, IPv4 or IPv6, TCP only. BlueStacks on
Windows is always Ethernet + IPv4; the rest exists for captures taken on a
Mac (docs/runbooks/mac-capture.md).
"""

from __future__ import annotations

import ipaddress
import struct
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dw_collector.protocol.frames import (
    SmartFoxFrame,
    SmartFoxStreamDecoder,
    extract_extension_event,
)
from dw_collector.protocol.linklayer import (
    LINKTYPE_ETHERNET,
    SUPPORTED_LINKTYPES,
    network_packet,
)
from dw_collector.protocol.sfs import SfsValue


class PcapError(RuntimeError):
    pass


# pcapng option code for if_tsresol, and its default when the option is
# absent: 10^-6, i.e. microseconds (pcapng spec 4.2).
_IF_TSRESOL = 9
_DEFAULT_TSRESOL = 6


def _timestamp_divisor(raw: int) -> float:
    """if_tsresol encodes 10^-n, or 2^-n when the high bit is set."""
    if raw & 0x80:
        return float(2 ** (raw & 0x7F))
    return float(10**raw)


def _parse_idb(body: bytes, endian: str) -> tuple[int, float]:
    """(linktype, timestamp divisor) for one interface description block."""
    linktype = int(struct.unpack_from(endian + "H", body, 0)[0])
    divisor = _timestamp_divisor(_DEFAULT_TSRESOL)
    # Options follow linktype(2) + reserved(2) + snaplen(4).
    offset = 8
    while offset + 4 <= len(body):
        code, length = struct.unpack_from(endian + "HH", body, offset)
        if code == 0:  # opt_endofopt
            break
        if code == _IF_TSRESOL and length >= 1:
            divisor = _timestamp_divisor(body[offset + 4])
        # Option values are padded to a 4-byte boundary.
        offset += 4 + ((length + 3) // 4) * 4
    return linktype, divisor


@dataclass(frozen=True)
class PcapngPacket:
    """A link-layer packet with the time the capture engine saw it.

    The timestamp matters because a pcap replayed later must not be
    labelled with the replay's wall clock: `captured_at` is meant to say
    when the data was observed, and observation happened when the packet
    was recorded.
    """

    captured_at: datetime
    data: bytes
    linktype: int = LINKTYPE_ETHERNET


# Classic pcap magic, as the first four bytes appear on disk:
# (byte order, divisor for the fractional-seconds field).
_CLASSIC_MAGIC: dict[bytes, tuple[str, int]] = {
    b"\xd4\xc3\xb2\xa1": ("<", 1_000_000),
    b"\xa1\xb2\xc3\xd4": (">", 1_000_000),
    b"\x4d\x3c\xb2\xa1": ("<", 1_000_000_000),
    b"\xa1\xb2\x3c\x4d": (">", 1_000_000_000),
}


def read_pcapng_records(path: Path) -> list[PcapngPacket]:
    """Packets with their capture timestamps and link types.

    Despite the name, classic pcap is read too: `tcpdump -w` on macOS writes
    it by default, and nothing about a capture's contents depends on which
    of the two containers it came in.

    Packets on an interface whose link type is not supported are skipped
    rather than fatal — a Mac `-i any` capture mixes interfaces, and one
    unusual one should not cost the rest. A file in which EVERY packet was
    skipped raises instead, naming the link types, because "0 events" from a
    capture someone took by hand would otherwise look like a quiet session.
    """
    data = path.read_bytes()
    classic = _CLASSIC_MAGIC.get(data[:4])
    packets = _read_classic(data, *classic) if classic else _read_pcapng(data)
    supported = [p for p in packets if p.linktype in SUPPORTED_LINKTYPES]
    if packets and not supported:
        types = ", ".join(str(t) for t in sorted({p.linktype for p in packets}))
        raise PcapError(f"unsupported link type {types}")
    return supported


def _read_classic(data: bytes, endian: str, divisor: int) -> list[PcapngPacket]:
    """Classic pcap: a 24-byte global header, then (16-byte header + frame)*.

    A truncated final record ends the read instead of failing it. A capture
    taken by hand is stopped by hand, and losing a whole session to the
    last few bytes of a killed tcpdump is the worse outcome.
    """
    if len(data) < 24:
        raise PcapError("truncated pcap header")
    # The upper bits of the link-type field carry FCS flags (pcap spec 4).
    linktype = int(struct.unpack_from(endian + "I", data, 20)[0]) & 0xFFFF
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    packets: list[PcapngPacket] = []
    offset = 24
    while offset + 16 <= len(data):
        seconds, fraction, captured_length, _ = struct.unpack_from(endian + "IIII", data, offset)
        start = offset + 16
        if start + captured_length > len(data):
            break
        micros = fraction * 1_000_000 // divisor
        packets.append(
            PcapngPacket(
                captured_at=epoch + timedelta(seconds=seconds, microseconds=micros),
                data=data[start : start + captured_length],
                linktype=linktype,
            )
        )
        offset = start + captured_length
    return packets


def _read_pcapng(data: bytes) -> list[PcapngPacket]:
    offset = 0
    endian = "<"
    interfaces: list[tuple[int, float]] = []
    packets: list[PcapngPacket] = []

    while offset + 12 <= len(data):
        raw_type = data[offset : offset + 4]

        if raw_type == b"\x0a\x0d\x0d\x0a":  # section header
            magic = data[offset + 8 : offset + 12]
            if magic == b"\x4d\x3c\x2b\x1a":
                endian = "<"
            elif magic == b"\x1a\x2b\x3c\x4d":
                endian = ">"
            else:
                raise PcapError("invalid pcapng byte-order magic")
            interfaces = []
            block_length = int(struct.unpack_from(endian + "I", data, offset + 4)[0])
            offset += block_length
            continue

        block_type, block_length = struct.unpack_from(endian + "II", data, offset)
        if block_length < 12 or offset + block_length > len(data):
            raise PcapError(f"invalid block at offset {offset}")

        body = data[offset + 8 : offset + block_length - 4]
        if block_type == 1:  # interface description
            interfaces.append(_parse_idb(body, endian))
        elif block_type == 6:  # enhanced packet
            interface_id, ts_high, ts_low, captured_length, _ = struct.unpack_from(
                endian + "IIIII", body, 0
            )
            if interface_id >= len(interfaces):
                raise PcapError("unknown pcapng interface")
            linktype, divisor = interfaces[interface_id]
            ticks = (ts_high << 32) | ts_low
            packets.append(
                PcapngPacket(
                    captured_at=datetime.fromtimestamp(ticks / divisor, tz=UTC),
                    data=body[20 : 20 + captured_length],
                    linktype=linktype,
                )
            )

        offset += block_length

    return packets


def read_pcapng_packets(path: Path) -> list[bytes]:
    """Raw link-layer packets, without their timestamps."""
    return [record.data for record in read_pcapng_records(path)]


@dataclass(frozen=True)
class TcpSegment:
    source_ip: str
    destination_ip: str
    source_port: int
    destination_port: int
    sequence: int
    payload: bytes


_IPPROTO_TCP = 6
# IPv6 extension headers that can sit between the fixed header and TCP and
# are safe to walk past. Fragments (44) are not: a fragment is not a whole
# segment, and the game's traffic never fragments anyway.
_IPV6_SKIPPABLE = frozenset({0, 43, 60})
_IPV6_AH = 51


def parse_tcp(packet: bytes, linktype: int = LINKTYPE_ETHERNET) -> TcpSegment | None:
    """Link layer → IPv4 or IPv6 → TCP, else None."""
    ip_data = network_packet(packet, linktype)
    if ip_data is None:
        return None
    version = ip_data[0] >> 4
    if version == 4:
        return _tcp_over_ipv4(ip_data)
    if version == 6:
        return _tcp_over_ipv6(ip_data)
    return None


def _tcp_over_ipv4(ip_data: bytes) -> TcpSegment | None:
    if len(ip_data) < 20:
        return None
    ihl = (ip_data[0] & 0x0F) * 4
    total_length = int(struct.unpack("!H", ip_data[2:4])[0])
    if ip_data[9] != _IPPROTO_TCP or len(ip_data) < ihl + 20:
        return None
    # Zero means the capture saw the packet before segmentation offload
    # filled the length in; the bytes on hand are then the whole packet.
    end = total_length if total_length else len(ip_data)
    return _tcp_segment(
        ip_data[ihl:end],
        str(ipaddress.IPv4Address(ip_data[12:16])),
        str(ipaddress.IPv4Address(ip_data[16:20])),
    )


def _tcp_over_ipv6(ip_data: bytes) -> TcpSegment | None:
    if len(ip_data) < 40:
        return None
    payload_length = int(struct.unpack("!H", ip_data[4:6])[0])
    next_header = ip_data[6]
    offset = 40
    while next_header != _IPPROTO_TCP:
        if len(ip_data) < offset + 8:
            return None
        if next_header in _IPV6_SKIPPABLE:
            length = (ip_data[offset + 1] + 1) * 8
        elif next_header == _IPV6_AH:
            length = (ip_data[offset + 1] + 2) * 4
        else:
            return None
        next_header = ip_data[offset]
        offset += length
    end = 40 + payload_length if payload_length else len(ip_data)
    return _tcp_segment(
        ip_data[offset:end],
        str(ipaddress.IPv6Address(ip_data[8:24])),
        str(ipaddress.IPv6Address(ip_data[24:40])),
    )


def _tcp_segment(tcp_data: bytes, source_ip: str, destination_ip: str) -> TcpSegment | None:
    if len(tcp_data) < 20:
        return None
    source_port, destination_port, sequence = struct.unpack("!HHI", tcp_data[:8])
    tcp_header_length = ((tcp_data[12] >> 4) & 0x0F) * 4
    payload = tcp_data[tcp_header_length:]

    return TcpSegment(
        source_ip=source_ip,
        destination_ip=destination_ip,
        source_port=int(source_port),
        destination_port=int(destination_port),
        sequence=int(sequence),
        payload=payload,
    )


# A 47KB al.rank response arrives in roughly 32 segments, so this leaves
# headroom for legitimate reordering while still recovering quickly when a
# segment is genuinely lost. The old 512 meant one dropped packet could stall
# a stream for the best part of a megabyte.
MAX_PENDING_SEGMENTS = 64

# How long a gap may stay unresolved before the stream gives up on it. Ten
# seconds is far beyond any real retransmit on a loopback-to-emulator path, and
# far below the "silent until restarted" this replaced.
GAP_TIMEOUT_SECONDS = 10.0


@dataclass
class TCPDirectionReassembler:
    """Directional in-order reassembly for one long game session."""

    decoder: SmartFoxStreamDecoder = field(default_factory=SmartFoxStreamDecoder)
    next_sequence: int | None = None
    pending: dict[int, bytes] = field(default_factory=dict)
    # Times a lost segment forced a jump past the gap. Live capture only;
    # a pcap replay has every byte.
    gap_skips: int = 0
    # When the current gap first appeared. None while nothing is waiting.
    gap_since: datetime | None = None

    def feed(
        self, sequence: int, payload: bytes, *, now: datetime | None = None
    ) -> list[SmartFoxFrame]:
        if not payload:
            return []
        if self.next_sequence is None:
            self.next_sequence = sequence

        end_sequence = sequence + len(payload)
        if end_sequence <= self.next_sequence:
            return []  # pure retransmission

        if sequence < self.next_sequence:
            payload = payload[self.next_sequence - sequence :]
            sequence = self.next_sequence

        existing = self.pending.get(sequence)
        if existing is None or len(payload) > len(existing):
            self.pending[sequence] = payload

        frames: list[SmartFoxFrame] = []
        while self.next_sequence in self.pending:
            chunk = self.pending.pop(self.next_sequence)
            self.next_sequence += len(chunk)
            frames.extend(self.decoder.feed(chunk))

        # A lost segment would otherwise buffer forever; jump past the gap to
        # the lowest offset we do have and let the decoder resync.
        #
        # TWO BOUNDS, and the second is the one that matters. A count alone
        # only fires while traffic keeps coming, and the case that wedged this
        # collector is the opposite: a reconnect burst overruns the capture
        # buffer, a gap opens, and then the game goes quiet. Seven segments
        # arrive over the next minute, 64 is never reached, and the stream is
        # silent for as long as the process runs. Reproduced offline — three
        # consecutive capture files fed through one reassembler produced 0
        # frames from 51 segments, with buffered=0 and resync=0 because the
        # bytes were sitting here rather than in the decoder.
        stalled_too_long = (
            now is not None
            and self.gap_since is not None
            and (now - self.gap_since).total_seconds() > GAP_TIMEOUT_SECONDS
        )
        if self.pending and (len(self.pending) > MAX_PENDING_SEGMENTS or stalled_too_long):
            self.next_sequence = min(self.pending)
            self.gap_skips += 1
            self.gap_since = None
            # Drain whatever the jump made contiguous, or the caller sees the
            # skip counted and still gets no frames until the next segment.
            while self.next_sequence in self.pending:
                chunk = self.pending.pop(self.next_sequence)
                self.next_sequence += len(chunk)
                frames.extend(self.decoder.feed(chunk))

        # Tracked after the skip so a fresh gap starts its own clock.
        if not self.pending:
            self.gap_since = None
        elif self.gap_since is None:
            self.gap_since = now
        return frames


@dataclass(frozen=True)
class ExtensionEvent:
    direction: str  # "inbound" = server → client
    command: str
    payload: dict[str, SfsValue]
    request_id: int | None
    # When the capture engine recorded the packet that completed this frame.
    captured_at: datetime | None = None


def iter_extension_events(path: Path, port: int = 8680) -> Iterator[ExtensionEvent]:
    """Every SmartFox extension event in a capture, in stream order."""
    streams: dict[tuple[str, int, str, int], TCPDirectionReassembler] = defaultdict(
        TCPDirectionReassembler
    )
    for record in read_pcapng_records(path):
        segment = parse_tcp(record.data, record.linktype)
        if segment is None or not segment.payload:
            continue
        if port not in (segment.source_port, segment.destination_port):
            continue
        key = (
            segment.source_ip,
            segment.source_port,
            segment.destination_ip,
            segment.destination_port,
        )
        direction = "inbound" if segment.source_port == port else "outbound"
        for frame in streams[key].feed(segment.sequence, segment.payload):
            event = extract_extension_event(frame.object)
            if event is None:
                continue
            command, payload, request_id = event
            yield ExtensionEvent(direction, command, payload, request_id, record.captured_at)
