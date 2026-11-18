"""APS zstd v1, the compressed-frame codec from game build 1.250.672 on.

The bodies here are built with a made-up key. The real key is extracted
from the APK and never enters the repo (aps_zstd.py says where it lives),
so these pin the construction rather than one key: a body built the way
the client builds it, one AES-ECB block per counter, must come back through
the decoder's CTR path. Real captures were checked against the real key by
hand (11,306 frames, none rejected) when this landed.
"""

from __future__ import annotations

import hashlib
import struct
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
import zstandard
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from dw_collector.protocol import aps_zstd
from dw_collector.protocol.aps_zstd import (
    MAX_DECODED_SIZE,
    ApsZstdError,
    ApsZstdV1,
    _frame_header_ok,
)
from dw_collector.protocol.frames import SmartFoxStreamDecoder
from dw_collector.protocol.pcapng import TCPDirectionReassembler
from tests.test_capture_session import envelope
from tests.test_protocol import encode_sfs, frame

TEST_KEY = "not-the-game-key/only-for-tests="
NONCE = bytes.fromhex("00000000075bcd15")
RANK = envelope("al.rank", {"allianceId": "abc", "list": [{"uid": "1000580", "power": 12345}]})


def aps_body(raw: bytes, *, key: str = TEST_KEY, nonce: bytes = NONCE) -> bytes:
    """`raw` the way the client masks it: zstd minus its magic, the first
    128 bytes XORed with AES(key, nonce || be64(i)) block by block."""
    frame_bytes = zstandard.ZstdCompressor().compress(raw)[4:]
    ecb = Cipher(algorithms.AES(hashlib.sha256(key.encode()).digest()), modes.ECB()).encryptor()
    n = min(128, len(frame_bytes))
    stream = b"".join(ecb.update(nonce + i.to_bytes(8, "big")) for i in range((n + 15) // 16))
    masked = bytes(b ^ k for b, k in zip(frame_bytes[:n], stream, strict=False))
    return nonce + masked + frame_bytes[n:]


def aps_frame(obj: dict[str, object], *, key: str = TEST_KEY, nonce: bytes = NONCE) -> bytes:
    body = aps_body(encode_sfs(obj), key=key, nonce=nonce)
    if len(body) > 0xFFFF:
        return bytes([0xA8]) + struct.pack("!I", len(body)) + body
    return bytes([0xA0]) + struct.pack("!H", len(body)) + body


def decoder() -> SmartFoxStreamDecoder:
    return SmartFoxStreamDecoder(aps=ApsZstdV1(TEST_KEY))


# --- normal -------------------------------------------------------------------


def test_a_masked_frame_decodes_to_its_envelope() -> None:
    frames = decoder().feed(aps_frame(RANK))

    assert [f.object for f in frames] == [RANK]
    assert frames[0].compressed is True


def test_a_body_longer_than_the_masked_prefix_decodes() -> None:
    """Only 128 bytes are masked; the rest is plain zstd and must be left alone."""
    roster = envelope(
        "al.rank",
        {"allianceId": "abc", "list": [{"uid": str(1000000 + i), "power": i} for i in range(400)]},
    )
    wire = aps_frame(roster)
    assert len(wire) > 3 + 8 + 128

    assert [f.object for f in decoder().feed(wire)] == [roster]


def test_a_four_byte_length_frame_decodes() -> None:
    """The login response is the one frame big enough for flag 0xA8."""
    noise = [hashlib.sha256(i.to_bytes(4, "big")).hexdigest() for i in range(3000)]
    big = envelope("init", {"noise": noise})  # hex compresses only so far: ~100KB on the wire
    wire = aps_frame(big)
    assert wire[0] == 0xA8

    assert [f.object for f in decoder().feed(wire)] == [big]


def test_old_zlib_frames_still_decode_beside_new_ones() -> None:
    """Captures from before the update replay through the same decoder."""
    frames = decoder().feed(frame(RANK, compressed=True) + aps_frame(RANK) + frame(RANK))

    assert [f.object for f in frames] == [RANK, RANK, RANK]


def test_a_frame_split_across_segments_decodes() -> None:
    wire = aps_frame(RANK)
    d = decoder()

    assert d.feed(wire[:5]) == []
    assert d.feed(wire[5:20]) == []
    assert [f.object for f in d.feed(wire[20:])] == [RANK]
    assert d.resync_bytes == 0


def test_a_nonce_that_looks_like_zlib_still_decodes() -> None:
    """78 9c is a valid zlib header; an APS nonce opens with one now and then."""
    nonce = b"\x78\x9c" + bytes(6)
    frames = decoder().feed(aps_frame(RANK, nonce=nonce))

    assert [f.object for f in frames] == [RANK]


def test_the_reassembler_uses_the_key_file_named_in_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fresh_config: None
) -> None:
    """Every capture path builds its streams through TCPDirectionReassembler."""
    key_file = tmp_path / "key.txt"
    key_file.write_text(TEST_KEY + "\n", encoding="utf-8")
    monkeypatch.setenv(aps_zstd.KEY_FILE_ENV, str(key_file))

    frames = TCPDirectionReassembler().feed(1, aps_frame(RANK))

    assert [f.object for f in frames] == [RANK]


# --- null / optional ----------------------------------------------------------


@pytest.fixture
def fresh_config() -> Iterator[None]:
    aps_zstd.configured.cache_clear()
    yield
    aps_zstd.configured.cache_clear()


def test_without_a_key_the_frame_is_skipped_and_the_stream_goes_on() -> None:
    """The behaviour before this codec existed, minus the silence: plain
    frames still decode, and the masked one costs resync bytes, not a stall."""
    wire = aps_frame(RANK)
    plain = envelope("get.battlepass.info", {"season": 3})
    d = SmartFoxStreamDecoder()

    frames = d.feed(wire + frame(plain))

    assert [f.object for f in frames] == [plain]
    assert d.resync_bytes == len(wire)


def test_an_unset_key_file_means_no_codec(
    monkeypatch: pytest.MonkeyPatch, fresh_config: None
) -> None:
    monkeypatch.delenv(aps_zstd.KEY_FILE_ENV, raising=False)

    assert aps_zstd.configured() is None


def test_a_missing_or_empty_key_file_means_no_codec(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fresh_config: None
) -> None:
    monkeypatch.setenv(aps_zstd.KEY_FILE_ENV, str(tmp_path / "absent.txt"))
    assert aps_zstd.configured() is None

    aps_zstd.configured.cache_clear()
    empty = tmp_path / "empty.txt"
    empty.write_text("\n", encoding="utf-8")
    monkeypatch.setenv(aps_zstd.KEY_FILE_ENV, str(empty))
    assert aps_zstd.configured() is None


def test_the_key_file_is_read_once_per_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fresh_config: None
) -> None:
    key_file = tmp_path / "key.txt"
    key_file.write_text(TEST_KEY, encoding="utf-8")
    monkeypatch.setenv(aps_zstd.KEY_FILE_ENV, str(key_file))

    first = aps_zstd.configured()
    key_file.unlink()

    assert first is not None
    assert aps_zstd.configured() is first


# --- malformed ----------------------------------------------------------------


def test_a_frame_under_another_key_is_rejected_and_the_next_one_decodes() -> None:
    """What a game update that changes the key looks like: resync, no crash."""
    foreign = aps_frame(RANK, key="some-other-build")
    d = decoder()

    frames = d.feed(foreign + aps_frame(RANK))

    assert [f.object for f in frames] == [RANK]
    assert d.resync_bytes == len(foreign)


def _reframed(body: bytes) -> bytes:
    return bytes([0xA0]) + struct.pack("!H", len(body)) + body


@pytest.mark.parametrize(
    ("damage", "why"),
    [
        (lambda body: body + b"\x00\x00", "bytes after the zstd frame"),
        (lambda body: body[:-2], "a zstd frame cut short"),
    ],
)
def test_a_body_that_is_not_exactly_one_frame_is_rejected(
    damage: Callable[[bytes], bytes], why: str
) -> None:
    damaged = _reframed(damage(aps_body(encode_sfs(RANK))))
    following = envelope("get.battlepass.info", {"season": 3})

    frames = decoder().feed(damaged + frame(following))

    assert [f.object for f in frames] == [following], why


def test_a_body_too_short_for_a_nonce_raises() -> None:
    codec = ApsZstdV1(TEST_KEY)

    with pytest.raises(ApsZstdError):
        codec.decode(NONCE)
    assert codec.plausible_start(NONCE, len(NONCE)) is False


def test_a_false_header_is_refused_without_waiting_for_its_length() -> None:
    """The stall the zlib check exists to prevent, on the new codec: a false
    0xA0 header claiming 60,000 bytes must not park the frames behind it."""
    false_header = bytes([0xA0]) + struct.pack("!H", 60_000) + bytes(range(24))
    d = decoder()

    frames = d.feed(false_header + aps_frame(RANK))

    assert [f.object for f in frames] == [RANK]
    assert d.resync_bytes == len(false_header)


@pytest.mark.parametrize(
    ("header", "why"),
    [
        (bytes([0x68, 0x10, 0x00, 0x00, 0x00, 0x00]), "reserved descriptor bit"),
        (bytes([0x61, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00]), "dictionary id"),
        (bytes([0x00, 0x58, 0x00, 0x00, 0x00]), "no content size"),
        (bytes([0xA0]) + (MAX_DECODED_SIZE + 1).to_bytes(4, "little") + bytes(3), "too large"),
        (bytes([0x20, 0x10]) + (3 << 1 | 5 << 3).to_bytes(3, "little"), "reserved block"),
        (bytes([0x20, 0x10]) + (2 << 1 | 500 << 3).to_bytes(3, "little"), "block past the end"),
        (bytes([0x20, 0x00]) + bytes(3), "empty content"),
    ],
)
def test_frame_headers_the_game_never_writes_are_refused(header: bytes, why: str) -> None:
    assert _frame_header_ok(header, frame_length=100) is False, why


def test_the_frame_shapes_the_game_writes_are_accepted() -> None:
    """Descriptors 0x60 and 0xA0 are the only two seen across a day of capture."""
    two_byte_size = bytes([0x60]) + (1000 - 256).to_bytes(2, "little")
    four_byte_size = bytes([0xA0]) + (470_895).to_bytes(4, "little")
    compressed_block = (2 << 1 | 40 << 3).to_bytes(3, "little")

    assert _frame_header_ok(two_byte_size + compressed_block, frame_length=100)
    assert _frame_header_ok(four_byte_size + compressed_block, frame_length=100)


# --- duplicate ----------------------------------------------------------------


def test_the_same_frame_twice_decodes_twice() -> None:
    """The decoder does not deduplicate; the journal's idempotency key does."""
    wire = aps_frame(RANK)

    frames = decoder().feed(wire + wire)

    assert [f.object for f in frames] == [RANK, RANK]


def test_two_frames_differing_only_in_nonce_decode_alike() -> None:
    """The nonce counts up per frame; it changes the mask, never the payload."""
    a = aps_frame(RANK, nonce=(1).to_bytes(8, "big"))
    b = aps_frame(RANK, nonce=(2).to_bytes(8, "big"))
    assert a != b

    assert [f.object for f in decoder().feed(a + b)] == [RANK, RANK]
