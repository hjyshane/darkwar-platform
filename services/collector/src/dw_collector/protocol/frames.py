"""SmartFox TCP frame extraction from a byte stream.

Captured game traffic uses flag byte 0x80 (plain) or 0xA0 (compressed); 0x08
set means a four-byte body length. A compressed body is zlib before game build
1.250.672 and APS zstd v1 from it on (aps_zstd.py); both are tried, so old
captures still replay. The decoder may attach mid-stream, so on any
undecodable candidate it shifts one byte and rescans until a valid frame
boundary is found (FR-COL-003: garbage must not stop the collector).
"""

from __future__ import annotations

import zlib
from dataclasses import dataclass

from dw_collector.protocol.aps_zstd import CHECK_PREFIX_SIZE, ApsZstdError, ApsZstdV1
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
# 1MiB of traffic rather than 32MB. Under APS zstd v1 the largest of 11,306
# compressed frames was 85,870 bytes, so the margin still holds.
MAX_FRAME_SIZE = 1024 * 1024

# Requiring the type byte turns a resync from "does this parse?" into "does
# this parse AS A FRAME?" — a mis-synced window can otherwise read a
# string-length prefix that swallows the next command name and still parse.
#
# `push.world.march.world.get.new` is NOT such a glued name, though it was
# taken for one when this check was added (2026-07). It is a real push: the
# marches (`marchInfos`, `lines`, `monsterInfos`) for the viewport a
# `world.get.new` just loaded, about one per viewport (28 and 28 in a 150 s
# dumpcap window; 511 and 510 on the 2026-11-17 ring). Since game build
# 1.250.672 it arrives in APS zstd frames, which a mis-synced window cannot
# decode, and every one of the 672 journalled by 2026-11-18 has that key set.
SFS_OBJECT_TYPE = 0x12

# All 520 frames across five real captures (login, roster, arena, alliance
# ranking, player profile) carry exactly this top-level key set — the
# SmartFox2X envelope. Requiring the keys to be present, rather than the set
# to match exactly, keeps a future field from silently dropping real frames.
ENVELOPE_KEYS = frozenset({"a", "c", "p"})


def _plausible_body_start(flags: int, prefix: bytes) -> bool:
    """Could `prefix` be the first bytes of a plain or zlib body with these flags?

    A zlib body opens with a zlib header: compression method 8, a window
    size no larger than 32KB, and a check value that makes the 16-bit header a
    multiple of 31. A plain body opens with the SFSObject type byte. This
    rejects most false headers on sight; whatever it lets through is still
    fully validated once the body arrives. An APS zstd v1 body is judged by
    its codec instead (`SmartFoxStreamDecoder._plausible_start`).
    """
    if flags & 0x20:
        if len(prefix) < 2:
            return False
        cmf, flg = prefix[0], prefix[1]
        return (cmf & 0x0F) == 8 and (cmf >> 4) <= 7 and ((cmf << 8) | flg) % 31 == 0
    return prefix[:1] == bytes([SFS_OBJECT_TYPE])


@dataclass(frozen=True)
class SmartFoxFrame:
    flags: int
    compressed: bool
    encoded_length: int
    decoded_length: int
    object: SfsValue


class SmartFoxStreamDecoder:
    """Incremental decoder; feed() returns every complete frame so far.

    `aps` decodes compressed frames from game build 1.250.672 on. Without it
    those frames are skipped as resync bytes, which is what every decoder did
    before this existed; the capture paths pass `aps_zstd.configured()`.
    """

    def __init__(self, aps: ApsZstdV1 | None = None) -> None:
        self.aps = aps
        self.buffer = bytearray()
        # Bytes discarded while hunting for a frame boundary. Non-zero after
        # startup means packets were dropped or reordered — surfaced in the
        # capture stats so silent loss becomes a visible number.
        self.resync_bytes = 0

    def _skip_byte(self) -> None:
        del self.buffer[0]
        self.resync_bytes += 1

    def _prefix_length(self, flags: int) -> int:
        if not flags & 0x20:
            return 1
        return CHECK_PREFIX_SIZE if self.aps is not None else 2

    def _plausible_start(self, flags: int, prefix: bytes, body_length: int) -> bool:
        if _plausible_body_start(flags, prefix[:2]):
            return True
        return (
            bool(flags & 0x20)
            and self.aps is not None
            and self.aps.plausible_start(prefix, body_length)
        )

    def _decompress(self, encoded: bytes) -> bytes:
        """zlib if it opens like zlib and inflates, else APS zstd v1."""
        if _plausible_body_start(0x20, encoded[:2]):
            try:
                return zlib.decompress(encoded)
            except zlib.error:
                # An APS nonce opens like a zlib header about once in 1,000
                # frames; that frame is still APS.
                if self.aps is None:
                    raise
        if self.aps is None:
            raise ParseError("compressed body is not zlib and no APS zstd key is configured")
        return self.aps.decode(encoded)

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

            # Judge the header by the first bytes of its body BEFORE waiting
            # for the rest. Attaching mid-stream means scanning through the
            # tail of some other frame, and compressed bytes look like a
            # header about once in 128 positions with a length up to 64KB.
            # Waiting for that length parks every real frame behind it — on a
            # quiet account (a few KB a second) for the whole capture file.
            # Measured on a real 60 s window: 5 frames decoded with 74,630
            # bytes parked; with this check, 21 frames and 2 bytes parked.
            prefix_length = min(self._prefix_length(flags), body_length)
            if len(self.buffer) < header_length + prefix_length:
                break
            if not self._plausible_start(
                flags,
                bytes(self.buffer[header_length : header_length + prefix_length]),
                body_length,
            ):
                self._skip_byte()
                continue

            frame_length = header_length + body_length
            if len(self.buffer) < frame_length:
                break

            encoded = bytes(self.buffer[header_length:frame_length])
            try:
                decoded_bytes = self._decompress(encoded) if flags & 0x20 else encoded
                if decoded_bytes[:1] != bytes([SFS_OBJECT_TYPE]):
                    raise ParseError("frame payload is not a top-level SFSObject")
                reader = Reader(decoded_bytes)
                decoded_object = parse_sfs_value(reader)
                if reader.pos != len(decoded_bytes):
                    raise ParseError(f"{len(decoded_bytes) - reader.pos} unparsed bytes")
                if not isinstance(decoded_object, dict) or not set(decoded_object) >= ENVELOPE_KEYS:
                    raise ParseError("frame is not a SmartFox envelope")
            except (ParseError, zlib.error, ApsZstdError):
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
