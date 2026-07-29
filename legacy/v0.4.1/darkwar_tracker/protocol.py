from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass
from typing import Any


class ParseError(RuntimeError):
    """Raised when a SmartFox value or frame cannot be decoded."""


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def take(self, size: int) -> bytes:
        if size < 0 or self.pos + size > len(self.data):
            raise ParseError(
                f"Unexpected end at {self.pos}: requested {size}, "
                f"total {len(self.data)}"
            )
        value = self.data[self.pos : self.pos + size]
        self.pos += size
        return value

    def u8(self) -> int:
        return self.take(1)[0]

    def i8(self) -> int:
        return struct.unpack("!b", self.take(1))[0]

    def u16(self) -> int:
        return struct.unpack("!H", self.take(2))[0]

    def i16(self) -> int:
        return struct.unpack("!h", self.take(2))[0]

    def i32(self) -> int:
        return struct.unpack("!i", self.take(4))[0]

    def u32(self) -> int:
        return struct.unpack("!I", self.take(4))[0]

    def i64(self) -> int:
        return struct.unpack("!q", self.take(8))[0]

    def f32(self) -> float:
        return struct.unpack("!f", self.take(4))[0]

    def f64(self) -> float:
        return struct.unpack("!d", self.take(8))[0]

    def utf(self) -> str:
        return self.take(self.u16()).decode("utf-8", errors="replace")

    def text(self) -> str:
        return self.take(self.u32()).decode("utf-8", errors="replace")


def parse_sfs_value(reader: Reader, type_id: int | None = None) -> Any:
    """Decode one SmartFox SFSObject/SFSArray value."""
    if type_id is None:
        type_id = reader.u8()

    if type_id == 0:
        return None
    if type_id == 1:
        return bool(reader.u8())
    if type_id == 2:
        return reader.i8()
    if type_id == 3:
        return reader.i16()
    if type_id == 4:
        return reader.i32()
    if type_id == 5:
        return reader.i64()
    if type_id == 6:
        return reader.f32()
    if type_id == 7:
        return reader.f64()
    if type_id == 8:
        return reader.utf()
    if type_id == 9:
        return [bool(reader.u8()) for _ in range(reader.u16())]
    if type_id == 10:
        return reader.take(reader.u32())
    if type_id == 11:
        return [reader.i16() for _ in range(reader.u16())]
    if type_id == 12:
        return [reader.i32() for _ in range(reader.u16())]
    if type_id == 13:
        return [reader.i64() for _ in range(reader.u16())]
    if type_id == 14:
        return [reader.f32() for _ in range(reader.u16())]
    if type_id == 15:
        return [reader.f64() for _ in range(reader.u16())]
    if type_id == 16:
        return [reader.utf() for _ in range(reader.u16())]
    if type_id == 17:
        return [parse_sfs_value(reader) for _ in range(reader.u16())]
    if type_id == 18:
        output: dict[str, Any] = {}
        for _ in range(reader.u16()):
            key = reader.utf()
            output[key] = parse_sfs_value(reader)
        return output
    if type_id == 20:
        return reader.text()

    raise ParseError(f"Unsupported SFS type ID {type_id}")


@dataclass(frozen=True)
class SmartFoxFrame:
    flags: int
    compressed: bool
    encoded_length: int
    decoded_length: int
    object: Any


class SmartFoxStreamDecoder:
    """Incremental decoder for SmartFox TCP frames."""

    MAX_FRAME_SIZE = 32 * 1024 * 1024

    def __init__(self) -> None:
        self.buffer = bytearray()

    @staticmethod
    def _plausible_flag(value: int) -> bool:
        # The captured game traffic uses 0x80 (plain) and 0xA0 (zlib).
        # 0x08 indicates a four-byte length field.
        return bool(value & 0x80)

    def feed(self, data: bytes) -> list[SmartFoxFrame]:
        if data:
            self.buffer.extend(data)

        frames: list[SmartFoxFrame] = []

        while True:
            if len(self.buffer) < 3:
                break

            if not self._plausible_flag(self.buffer[0]):
                del self.buffer[0]
                continue

            flags = self.buffer[0]
            header_length = 5 if flags & 0x08 else 3

            if len(self.buffer) < header_length:
                break

            if header_length == 5:
                body_length = int.from_bytes(self.buffer[1:5], "big")
            else:
                body_length = int.from_bytes(self.buffer[1:3], "big")

            if body_length <= 0 or body_length > self.MAX_FRAME_SIZE:
                del self.buffer[0]
                continue

            frame_length = header_length + body_length
            if len(self.buffer) < frame_length:
                break

            encoded = bytes(self.buffer[header_length:frame_length])

            try:
                decoded_bytes = (
                    zlib.decompress(encoded) if flags & 0x20 else encoded
                )
                reader = Reader(decoded_bytes)
                decoded_object = parse_sfs_value(reader)
                if reader.pos != len(decoded_bytes):
                    raise ParseError(
                        f"{len(decoded_bytes) - reader.pos} unparsed bytes"
                    )
            except (ParseError, zlib.error):
                # The collector may start in the middle of an existing TCP
                # stream. Shift by one byte until a valid frame boundary is
                # located.
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
    decoded_object: Any,
) -> tuple[str, dict[str, Any], int | None] | None:
    """Return (command, payload, request_id) from a SmartFox extension event."""
    try:
        envelope = decoded_object["p"]
        command = envelope["c"]
        payload = envelope.get("p", {})
    except (KeyError, TypeError):
        return None

    if not isinstance(command, str) or not isinstance(payload, dict):
        return None

    request_id = payload.get("_id")
    if not isinstance(request_id, int):
        request_id = None

    return command, payload, request_id
