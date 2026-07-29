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
from pathlib import Path

from dw_collector.protocol.frames import (
    SmartFoxFrame,
    SmartFoxStreamDecoder,
    extract_extension_event,
)
from dw_collector.protocol.sfs import SfsValue


class PcapError(RuntimeError):
    pass


def read_pcapng_packets(path: Path) -> list[bytes]:
    """Raw link-layer packets from every Ethernet interface in the file."""
    data = path.read_bytes()
    offset = 0
    endian = "<"
    interfaces: list[int] = []
    packets: list[bytes] = []

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
            interfaces.append(int(struct.unpack_from(endian + "H", body, 0)[0]))
        elif block_type == 6:  # enhanced packet
            interface_id, _, _, captured_length, _ = struct.unpack_from(endian + "IIIII", body, 0)
            if interface_id >= len(interfaces):
                raise PcapError("unknown pcapng interface")
            if interfaces[interface_id] != 1:
                raise PcapError("only Ethernet pcapng is supported")
            packets.append(body[20 : 20 + captured_length])

        offset += block_length

    return packets


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


@dataclass
class TCPDirectionReassembler:
    """Directional in-order reassembly for one long game session."""

    decoder: SmartFoxStreamDecoder = field(default_factory=SmartFoxStreamDecoder)
    next_sequence: int | None = None
    pending: dict[int, bytes] = field(default_factory=dict)

    def feed(self, sequence: int, payload: bytes) -> list[SmartFoxFrame]:
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

        # A capture that starts on a lost segment would otherwise buffer
        # forever; jump to the lowest pending offset.
        if len(self.pending) > 512:
            self.next_sequence = min(self.pending)
        return frames


@dataclass(frozen=True)
class ExtensionEvent:
    direction: str  # "inbound" = server → client
    command: str
    payload: dict[str, SfsValue]
    request_id: int | None


def iter_extension_events(path: Path, port: int = 8680) -> Iterator[ExtensionEvent]:
    """Every SmartFox extension event in a capture, in stream order."""
    streams: dict[tuple[str, int, str, int], TCPDirectionReassembler] = defaultdict(
        TCPDirectionReassembler
    )
    for raw_packet in read_pcapng_packets(path):
        segment = parse_tcp(raw_packet)
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
            yield ExtensionEvent(direction, command, payload, request_id)
