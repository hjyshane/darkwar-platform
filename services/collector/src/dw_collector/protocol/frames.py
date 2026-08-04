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

# The cap is what bounds a stall, not just what rejects nonsense. A false
# header claiming a length UNDER the cap is not rejected — the decoder waits
# for that many bytes, and everything arriving meanwhile is swallowed as that
# frame's body. At 32MB that wait never ended: dw-capture went silent after a
# reconnect and stayed silent for the rest of the run, alive and heartbeating.
#
# 4,906 frames across twelve real captures (login, roster, arena, alliance
# ranking, player profile, and two days of live traffic) put the largest at
# 83,549 bytes — the login response. 4,126 are under 1KB and nothing reaches
# 256KB. 1MiB is twelve times the largest ever seen, and it caps the stall at
# 1MiB of traffic rather than 32MB.
MAX_FRAME_SIZE = 1024 * 1024

# Requiring the type byte turns a resync from "does this parse?" into "does
# this parse AS A FRAME?" — a mis-synced window can otherwise read a
# string-length prefix that swallows the next command name, producing a
# plausible-looking frame such as "push.world.march." + "world.get.new" glued
# together. That check alone proved insufficient live: the glued command
# reappeared, because a false window can still begin with 0x12 and parse.
SFS_OBJECT_TYPE = 0x12

# All 520 frames across five real captures (login, roster, arena, alliance
# ranking, player profile) carry exactly this top-level key set — the
# SmartFox2X envelope. Requiring the keys to be present, rather than the set
# to match exactly, keeps a future field from silently dropping real frames.
ENVELOPE_KEYS = frozenset({"a", "c", "p"})


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
        # Bytes discarded while hunting for a frame boundary. Non-zero after
        # startup means packets were dropped or reordered — surfaced in the
        # capture stats so silent loss becomes a visible number.
        self.resync_bytes = 0

    def _skip_byte(self) -> None:
        del self.buffer[0]
        self.resync_bytes += 1

    def feed(self, data: bytes) -> list[SmartFoxFrame]:
        if data:
            self.buffer.extend(data)

        frames: list[SmartFoxFrame] = []
        while True:
            if len(self.buffer) < 3:
                break

            flags = self.buffer[0]
            if not flags & 0x80:
                self._skip_byte()
                continue

            header_length = 5 if flags & 0x08 else 3
            if len(self.buffer) < header_length:
                break

            body_length = int.from_bytes(self.buffer[1:header_length], "big")
            if body_length <= 0 or body_length > MAX_FRAME_SIZE:
                self._skip_byte()
                continue

            frame_length = header_length + body_length
            if len(self.buffer) < frame_length:
                break

            encoded = bytes(self.buffer[header_length:frame_length])
            try:
                decoded_bytes = zlib.decompress(encoded) if flags & 0x20 else encoded
                if decoded_bytes[:1] != bytes([SFS_OBJECT_TYPE]):
                    raise ParseError("frame payload is not a top-level SFSObject")
                reader = Reader(decoded_bytes)
                decoded_object = parse_sfs_value(reader)
                if reader.pos != len(decoded_bytes):
                    raise ParseError(f"{len(decoded_bytes) - reader.pos} unparsed bytes")
                if not isinstance(decoded_object, dict) or not set(decoded_object) >= ENVELOPE_KEYS:
                    raise ParseError("frame is not a SmartFox envelope")
            except (ParseError, zlib.error):
                self._skip_byte()
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
