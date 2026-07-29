"""SmartFox TCP frame extraction from a byte stream.

Captured game traffic uses flag byte 0x80 (plain) or 0xA0 (zlib); 0x08 set
means a four-byte body length. The decoder may attach mid-stream, so on any
undecodable candidate it shifts one byte and rescans until a valid frame
boundary is found (FR-COL-003: garbage must not stop the collector).
"""

from __future__ import annotations

import zlib
from dataclasses import dataclass

from dw_collector.protocol.sfs import ParseError, Reader, SfsValue, parse_sfs_value

MAX_FRAME_SIZE = 32 * 1024 * 1024


@dataclass(frozen=True)
class SmartFoxFrame:
    flags: int
    compressed: bool
    encoded_length: int
    decoded_length: int
    object: SfsValue


class SmartFoxStreamDecoder:
    """Incremental decoder; feed() returns every complete frame so far."""

    def __init__(self) -> None:
        self.buffer = bytearray()

    def feed(self, data: bytes) -> list[SmartFoxFrame]:
        if data:
            self.buffer.extend(data)

        frames: list[SmartFoxFrame] = []
        while True:
            if len(self.buffer) < 3:
                break

            flags = self.buffer[0]
            if not flags & 0x80:
                del self.buffer[0]
                continue

            header_length = 5 if flags & 0x08 else 3
            if len(self.buffer) < header_length:
                break

            body_length = int.from_bytes(self.buffer[1:header_length], "big")
            if body_length <= 0 or body_length > MAX_FRAME_SIZE:
                del self.buffer[0]
                continue

            frame_length = header_length + body_length
            if len(self.buffer) < frame_length:
                break

            encoded = bytes(self.buffer[header_length:frame_length])
            try:
                decoded_bytes = zlib.decompress(encoded) if flags & 0x20 else encoded
                reader = Reader(decoded_bytes)
                decoded_object = parse_sfs_value(reader)
                if reader.pos != len(decoded_bytes):
                    raise ParseError(f"{len(decoded_bytes) - reader.pos} unparsed bytes")
            except (ParseError, zlib.error):
                del self.buffer[0]
                continue

            del self.buffer[:frame_length]
            frames.append(
                SmartFoxFrame(
                    flags=flags,
                    compressed=bool(flags & 0x20),
                    encoded_length=body_length,
                    decoded_length=len(decoded_bytes),
                    object=decoded_object,
                )
            )
        return frames


def extract_extension_event(
    decoded_object: SfsValue,
) -> tuple[str, dict[str, SfsValue], int | None] | None:
    """(command, payload, request_id) from an extension event, else None."""
    if not isinstance(decoded_object, dict):
        return None
    envelope = decoded_object.get("p")
    if not isinstance(envelope, dict):
        return None
    command = envelope.get("c")
    payload = envelope.get("p", {})
    if not isinstance(command, str) or not isinstance(payload, dict):
        return None

    request_id = payload.get("_id")
    return command, payload, request_id if isinstance(request_id, int) else None
