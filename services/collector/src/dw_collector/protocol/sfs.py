"""SmartFox SFSObject/SFSArray binary decoding.

Promoted from legacy/v0.4.1 protocol.py. Type IDs follow the SmartFoxServer
2X binary protocol; 19 (class) is unused by the game and stays unsupported.
"""

from __future__ import annotations

import struct

type SfsValue = bool | int | float | str | bytes | list["SfsValue"] | dict[str, "SfsValue"] | None


class ParseError(RuntimeError):
    """A SmartFox value or frame cannot be decoded."""


class Reader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    def take(self, size: int) -> bytes:
        if size < 0 or self.pos + size > len(self.data):
            raise ParseError(
                f"unexpected end at {self.pos}: requested {size}, total {len(self.data)}"
            )
        value = self.data[self.pos : self.pos + size]
        self.pos += size
        return value

    def u8(self) -> int:
        return self.take(1)[0]

    def i8(self) -> int:
        return int(struct.unpack("!b", self.take(1))[0])

    def u16(self) -> int:
        return int(struct.unpack("!H", self.take(2))[0])

    def i16(self) -> int:
        return int(struct.unpack("!h", self.take(2))[0])

    def i32(self) -> int:
        return int(struct.unpack("!i", self.take(4))[0])

    def u32(self) -> int:
        return int(struct.unpack("!I", self.take(4))[0])

    def i64(self) -> int:
        return int(struct.unpack("!q", self.take(8))[0])

    def f32(self) -> float:
        return float(struct.unpack("!f", self.take(4))[0])

    def f64(self) -> float:
        return float(struct.unpack("!d", self.take(8))[0])

    def utf(self) -> str:
        return self.take(self.u16()).decode("utf-8", errors="replace")

    def text(self) -> str:
        return self.take(self.u32()).decode("utf-8", errors="replace")


def parse_sfs_value(reader: Reader, type_id: int | None = None) -> SfsValue:
    """Decode one SmartFox value; recurses for arrays (17) and objects (18)."""
    if type_id is None:
        type_id = reader.u8()

    match type_id:
        case 0:
            return None
        case 1:
            return bool(reader.u8())
        case 2:
            return reader.i8()
        case 3:
            return reader.i16()
        case 4:
            return reader.i32()
        case 5:
            return reader.i64()
        case 6:
            return reader.f32()
        case 7:
            return reader.f64()
        case 8:
            return reader.utf()
        case 9:
            return [bool(reader.u8()) for _ in range(reader.u16())]
        case 10:
            return reader.take(reader.u32())
        case 11:
            return [reader.i16() for _ in range(reader.u16())]
        case 12:
            return [reader.i32() for _ in range(reader.u16())]
        case 13:
            return [reader.i64() for _ in range(reader.u16())]
        case 14:
            return [reader.f32() for _ in range(reader.u16())]
        case 15:
            return [reader.f64() for _ in range(reader.u16())]
        case 16:
            return [reader.utf() for _ in range(reader.u16())]
        case 17:
            return [parse_sfs_value(reader) for _ in range(reader.u16())]
        case 18:
            output: dict[str, SfsValue] = {}
            for _ in range(reader.u16()):
                key = reader.utf()
                output[key] = parse_sfs_value(reader)
            return output
        case 20:
            return reader.text()
        case _:
            raise ParseError(f"unsupported SFS type ID {type_id}")
