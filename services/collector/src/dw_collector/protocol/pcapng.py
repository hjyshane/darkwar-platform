"""Offline pcapng reading + minimal TCP parsing + directional reassembly.

Pure stdlib (no scapy): this is the offline path for fixture extraction and
capture replay. Ethernet + IPv4 + TCP only — exactly what BlueStacks
traffic looks like.
"""

from __future__ import annotations

import ipaddress
import struct
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from dw_collector.protocol.frames import (
    SmartFoxFrame,
    SmartFoxStreamDecoder,
    extract_extension_event,
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


def read_pcapng_records(path: Path) -> list[PcapngPacket]:
    """Packets with their capture timestamps, from every Ethernet interface."""
    data = path.read_bytes()
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
            if linktype != 1:
                raise PcapError("only Ethernet pcapng is supported")
            ticks = (ts_high << 32) | ts_low
            packets.append(
                PcapngPacket(
                    captured_at=datetime.fromtimestamp(ticks / divisor, tz=UTC),
                    data=body[20 : 20 + captured_length],
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


def parse_tcp(packet: bytes) -> TcpSegment | None:
    """Ethernet (optionally VLAN-tagged) → IPv4 → TCP, else None."""
    if len(packet) < 14:
        return None

    ether_type = int(struct.unpack("!H", packet[12:14])[0])
    offset = 14
    if ether_type in (0x8100, 0x88A8):
        if len(packet) < 18:
            return None
        ether_type = int(struct.unpack("!H", packet[16:18])[0])
        offset = 18

    if ether_type != 0x0800 or len(packet) < offset + 20:
        return None

    ip_data = packet[offset:]
    ihl = (ip_data[0] & 0x0F) * 4
    total_length = int(struct.unpack("!H", ip_data[2:4])[0])
    if ip_data[9] != 6 or len(ip_data) < ihl + 20:
        return None

    tcp_data = ip_data[ihl:]
    source_port, destination_port, sequence = struct.unpack("!HHI", tcp_data[:8])
    tcp_header_length = ((tcp_data[12] >> 4) & 0x0F) * 4
    payload = tcp_data[tcp_header_length : total_length - ihl]

    return TcpSegment(
        source_ip=str(ipaddress.IPv4Address(ip_data[12:16])),
        destination_ip=str(ipaddress.IPv4Address(ip_data[16:20])),
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
        segment = parse_tcp(record.data)
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
