"""APS zstd v1: how the game compresses server -> client frames since build 1.250.672.

The 2026-11-17 update replaced zlib for compressed (0x20) inbound frames.
Requests and plain (0x80) frames did not change. The decoder kept rejecting
the new bodies on their first two bytes, which are not a zlib header, so every
compressed response (`al.rank`, `world.get.new`, `get.al.info`, the login
response) was dropped as resync bytes while the collector looked healthy.

Wire body, read from the client (`Sfs2X.Util.ApsZstdCodec`, `ApsZstdV1`):

    nonce (8 bytes) || a zstd frame without its 4-byte magic

and the first min(128, len - 8) bytes after the nonce are XORed with
AES-256(key, nonce || be64(i)) for blocks i = 0..7. That keystream is exactly
AES-CTR with the initial counter block nonce || 0, so CTR undoes it. The AES
key is SHA-256 of a key string that is a constant in the APK, the same for
every account and session: not a session key, and nothing is read from the
running game. `C:\\DW_data\\aps\\README.md` says how to extract it again after a
game update, and the key stays out of this repo; `DW_APS_ZSTD_KEY_FILE` names
the file that holds it.

Decode only. The collector is passive (ADR-0002/0003) and nothing here
builds a frame.
"""

from __future__ import annotations

import hashlib
import os
from functools import cache
from pathlib import Path

import structlog
import zstandard
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

log = structlog.get_logger()

KEY_FILE_ENV = "DW_APS_ZSTD_KEY_FILE"

NONCE_SIZE = 8
# Bytes after the nonce that the keystream covers.
MASKED_PREFIX_SIZE = 128
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"

# How much body `plausible_start` needs: the nonce plus one AES block, which
# holds the whole zstd frame header (at most 1 + 1 + 8 bytes here, no
# dictionary) and the first block header (3 bytes) after it.
CHECK_PREFIX_SIZE = NONCE_SIZE + 16

# Every frame the game wrote across a day of live capture (11,306) declared
# its content size, and the largest was 470,895 bytes (the login response).
# Checked before decompressing, because zstandard allocates whatever a frame
# header declares: a false header could otherwise ask for gigabytes.
MAX_DECODED_SIZE = 8 * 1024 * 1024

# zstd's Block_Maximum_Size: no block is ever larger than 128 KB.
_MAX_BLOCK_SIZE = 128 * 1024
_RLE_BLOCK = 1
_RESERVED_BLOCK = 3


class ApsZstdError(ValueError):
    """A body that is not an APS zstd v1 frame under this key."""


def _frame_header_ok(header: bytes, frame_length: int) -> bool:
    """Could `header` (the unmasked bytes after the missing magic) open a
    frame this game writes, `frame_length` bytes long?

    Rejects a false frame boundary from its first 16 bytes, the way the zlib
    path does from two: one AES block instead of waiting for a length that
    may never arrive. Every real frame has descriptor 0x60 or 0xA0 (single
    segment, 2- or 4-byte content size, no checksum, no dictionary); this
    accepts any frame shape the decoder below could actually decode.
    """
    if not header:
        return False
    descriptor = header[0]
    # Bit 4 is unused and bit 3 reserved, so both are zero in a valid frame.
    # Bits 0-1 name a dictionary, which the game does not use and this
    # decoder could not supply.
    if descriptor & 0x1B:
        return False
    single_segment = bool(descriptor & 0x20)
    size_bytes = (1 if single_segment else 0, 2, 4, 8)[descriptor >> 6]
    if size_bytes == 0:
        return False  # no content size: never seen, and the output could not be bounded
    start = 1 if single_segment else 2  # a window descriptor byte when not single segment
    end = start + size_bytes
    if len(header) < end + 3:
        return False
    content_size = int.from_bytes(header[start:end], "little") + (256 if size_bytes == 2 else 0)
    if not 0 < content_size <= MAX_DECODED_SIZE:
        return False

    block = int.from_bytes(header[end : end + 3], "little")
    block_type, block_size = (block >> 1) & 3, block >> 3
    if block_type == _RESERVED_BLOCK or block_size > _MAX_BLOCK_SIZE:
        return False
    # A raw or compressed block's size counts bytes that must follow inside
    # this frame. An RLE block's counts its output and is one byte on the wire.
    stored = 1 if block_type == _RLE_BLOCK else block_size
    return end + 3 + stored <= frame_length


class ApsZstdV1:
    """Decoder for one key. Stateless after construction, so one instance is
    shared by every stream (and thread) in the process."""

    def __init__(self, key: str) -> None:
        self._aes_key = hashlib.sha256(key.encode("utf-8")).digest()
        # Logged instead of the key, so two machines can be compared.
        self.fingerprint = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]

    def _unmask(self, nonce: bytes, data: bytes) -> bytes:
        decryptor = Cipher(algorithms.AES(self._aes_key), modes.CTR(nonce + bytes(8))).decryptor()
        return decryptor.update(data)

    def plausible_start(self, prefix: bytes, body_length: int) -> bool:
        """Could a body of `body_length` bytes that begins with `prefix` be
        one of these frames? `prefix` is the first min(CHECK_PREFIX_SIZE,
        body_length) bytes of it."""
        if body_length <= NONCE_SIZE or len(prefix) < min(CHECK_PREFIX_SIZE, body_length):
            return False
        header = self._unmask(prefix[:NONCE_SIZE], prefix[NONCE_SIZE:CHECK_PREFIX_SIZE])
        return _frame_header_ok(header, body_length - NONCE_SIZE)

    def decode(self, body: bytes) -> bytes:
        """The decompressed frame payload. Raises ApsZstdError otherwise."""
        if len(body) <= NONCE_SIZE:
            raise ApsZstdError("body is too short to hold a nonce and a frame")
        nonce, frame = body[:NONCE_SIZE], body[NONCE_SIZE:]
        head = self._unmask(nonce, frame[:MASKED_PREFIX_SIZE])
        if not _frame_header_ok(head[:16], len(frame)):
            raise ApsZstdError("not a zstd frame under this key")
        try:
            # A decompressor per call: zstandard's are not safe to share
            # across threads, and one costs microseconds.
            return zstandard.ZstdDecompressor().decompress(
                ZSTD_MAGIC + head + frame[MASKED_PREFIX_SIZE:],
                max_output_size=MAX_DECODED_SIZE,
                allow_extra_data=False,
            )
        except zstandard.ZstdError as exc:
            raise ApsZstdError(str(exc)) from exc


@cache
def configured() -> ApsZstdV1 | None:
    """The decoder for this machine's key, or None when there is none.

    Read once per process, on first use rather than at import, so it sees the
    `.env` that each entrypoint loads at startup. A missing key is a warning,
    not a failure (FR-COL-003): plain frames still decode, and the warning
    says why the compressed ones do not.
    """
    path = os.environ.get(KEY_FILE_ENV)
    if not path:
        log.warning(
            "aps_zstd_key_unset",
            hint=f"set {KEY_FILE_ENV}; compressed responses from game builds"
            " 1.250.672 and later will not decode",
        )
        return None
    try:
        key = Path(path).read_text(encoding="utf-8").strip()
    except OSError as exc:
        log.warning("aps_zstd_key_unreadable", path=path, error=str(exc))
        return None
    if not key:
        log.warning("aps_zstd_key_empty", path=path)
        return None
    codec = ApsZstdV1(key)
    log.info("aps_zstd_key_loaded", sha256=codec.fingerprint)
    return codec
