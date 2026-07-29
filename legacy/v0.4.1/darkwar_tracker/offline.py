from __future__ import annotations

import argparse
import ipaddress
import struct
from collections import defaultdict
from pathlib import Path
from typing import Any

from .config import load_config
from .database import Database
from .protocol import SmartFoxStreamDecoder, extract_extension_event
from .reassembly import TCPDirectionReassembler


class PcapError(RuntimeError):
    pass


def read_pcapng_packets(path: Path) -> list[bytes]:
    data = path.read_bytes()
    offset = 0
    endian = "<"
    interfaces: list[int] = []
    packets: list[bytes] = []

    while offset + 12 <= len(data):
        raw_type = data[offset : offset + 4]

        if raw_type == b"\x0a\x0d\x0d\x0a":
            magic = data[offset + 8 : offset + 12]
            if magic == b"\x4d\x3c\x2b\x1a":
                endian = "<"
            elif magic == b"\x1a\x2b\x3c\x4d":
                endian = ">"
            else:
                raise PcapError("Invalid PCAPNG byte-order magic")

            block_length = struct.unpack_from(
                endian + "I", data, offset + 4
            )[0]
            offset += block_length
            continue

        block_type, block_length = struct.unpack_from(
            endian + "II", data, offset
        )
        if block_length < 12 or offset + block_length > len(data):
            raise PcapError(f"Invalid block at offset {offset}")

        body = data[offset + 8 : offset + block_length - 4]

        if block_type == 1:
            interfaces.append(struct.unpack_from(endian + "H", body, 0)[0])
        elif block_type == 6:
            interface_id, _, _, captured_length, _ = struct.unpack_from(
                endian + "IIIII", body, 0
            )
            if interface_id >= len(interfaces):
                raise PcapError("Unknown PCAPNG interface")
            if interfaces[interface_id] != 1:
                raise PcapError("Only Ethernet PCAPNG is supported")
            packets.append(body[20 : 20 + captured_length])

        offset += block_length

    return packets


def parse_tcp(packet: bytes) -> dict[str, Any] | None:
    if len(packet) < 14:
        return None

    ether_type = struct.unpack("!H", packet[12:14])[0]
    offset = 14

    if ether_type in (0x8100, 0x88A8):
        if len(packet) < 18:
            return None
        ether_type = struct.unpack("!H", packet[16:18])[0]
        offset = 18

    if ether_type != 0x0800 or len(packet) < offset + 20:
        return None

    ip_data = packet[offset:]
    ihl = (ip_data[0] & 0x0F) * 4
    total_length = struct.unpack("!H", ip_data[2:4])[0]
    if ip_data[9] != 6 or len(ip_data) < ihl + 20:
        return None

    tcp_data = ip_data[ihl:]
    source_port, destination_port, sequence = struct.unpack(
        "!HHI", tcp_data[:8]
    )
    tcp_header_length = ((tcp_data[12] >> 4) & 0x0F) * 4
    payload = tcp_data[tcp_header_length : total_length - ihl]

    return {
        "source_ip": str(ipaddress.IPv4Address(ip_data[12:16])),
        "destination_ip": str(ipaddress.IPv4Address(ip_data[16:20])),
        "source_port": source_port,
        "destination_port": destination_port,
        "sequence": sequence,
        "payload": payload,
    }


def import_capture(
    capture: Path,
    database: Database,
    port: int = 8680,
) -> int:
    streams: dict[
        tuple[str, int, str, int], TCPDirectionReassembler
    ] = defaultdict(TCPDirectionReassembler)
    saved = 0

    for raw_packet in read_pcapng_packets(capture):
        packet = parse_tcp(raw_packet)
        if not packet or not packet["payload"]:
            continue
        if port not in (
            packet["source_port"],
            packet["destination_port"],
        ):
            continue

        key = (
            packet["source_ip"],
            packet["source_port"],
            packet["destination_ip"],
            packet["destination_port"],
        )
        direction = (
            "inbound" if packet["source_port"] == port else "outbound"
        )

        for frame in streams[key].feed(
            packet["sequence"], packet["payload"]
        ):
            event = extract_extension_event(frame.object)
            if event is None:
                continue
            command, payload, request_id = event
            result = database.handle_event(
                direction, command, payload, request_id
            )
            if result:
                saved += 1
                print(result)

    return saved


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("capture", type=Path)
    parser.add_argument("--config", default="config.toml")
    parser.add_argument("--db")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()

    config = load_config(args.config)
    database = Database(
        args.db or config.database.path,
        top_n=config.tracking.top_n,
    )
    try:
        saved = import_capture(
            args.capture,
            database,
            port=args.port or config.capture.port,
        )
    finally:
        database.close()

    print(f"saved snapshot events: {saved}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
