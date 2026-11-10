"""Type-29 tiles: the floating lantern and the site it reveals.

Built from the wire format, as test_protocol_worldmap does, with the field
values read off the two tiles the operator matched to in-game share links on
2026-11-10: an unlit lantern at tile (454, 276) the game called (453, 275), and
an open Large Treasure Spot at (457, 262) the game called (456, 261).
"""

from __future__ import annotations

import base64

from dw_collector.protocol.worldmap import (
    B64_PREFIX,
    SEASON_SITE_TYPE,
    SITE_OPEN,
    SITE_UNLIT,
    decode_point,
    mask_people,
)

EXPIRES_MS = 1794277500000
REVEALED_MS = 1794268874000
PLAYER_A = "1190060554000580"
PLAYER_B = "1264742586000580"


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _v(number: int, value: int) -> bytes:
    return _varint(number << 3) + _varint(value)


def _b(number: int, payload: bytes) -> bytes:
    return _varint((number << 3) | 2) + _varint(len(payload)) + payload


def site_point(
    *,
    x: int,
    y: int,
    cat_id: int,
    status: int,
    uuid: int = 1435887707426538645,
    participants: tuple[str, ...] = (),
    revealed: bool = False,
) -> bytes:
    inner = _v(1, uuid) + _v(2, cat_id) + _v(3, EXPIRES_MS)
    if revealed:
        inner += _v(4, REVEALED_MS) + _v(5, 3600)
    if participants:
        inner += _b(7, ";".join(participants).encode())
    inner += _v(8, status)
    point = _v(1, y * 1000 + x + 1) + _v(2, SEASON_SITE_TYPE) + _v(100, uuid)
    return point + _b(101, inner) + _v(102, 580) + _v(103, 580)


def test_an_unlit_lantern_decodes_with_its_content_already_named() -> None:
    tile = decode_point(site_point(x=454, y=276, cat_id=1440, status=SITE_UNLIT))

    assert tile.object_type == SEASON_SITE_TYPE
    assert (tile.x, tile.y, tile.server_id) == (454, 276, 580)
    assert tile.site is not None
    assert tile.site.uuid == 1435887707426538645
    assert tile.site.cat_id == 1440
    assert tile.site.status == SITE_UNLIT
    assert tile.site.expires_ms == EXPIRES_MS
    assert tile.site.revealed_ms is None
    assert tile.site.limit_s is None
    assert tile.site.participants == ()


def test_an_open_site_carries_when_it_opened_and_who_is_there() -> None:
    tile = decode_point(
        site_point(
            x=457,
            y=262,
            cat_id=1530,
            status=SITE_OPEN,
            participants=(PLAYER_A, PLAYER_B),
            revealed=True,
        )
    )

    assert tile.site is not None
    assert tile.site.status == SITE_OPEN
    assert tile.site.revealed_ms == REVEALED_MS
    assert tile.site.limit_s == 3600
    assert tile.site.participants == (PLAYER_A, PLAYER_B)


def test_a_tile_of_another_type_is_not_given_a_site() -> None:
    body = _v(1, 276455) + _v(2, 21) + _b(101, _v(1, 7) + _v(2, 1500504)) + _v(103, 580)

    assert decode_point(body).site is None


def test_the_participant_list_is_masked_as_people() -> None:
    """Twelve uids in one string are twelve people. A fixture over an open site
    must not carry them."""
    body = site_point(
        x=457, y=262, cat_id=1530, status=SITE_OPEN, participants=(PLAYER_A, PLAYER_B)
    )

    masked = mask_people(body, uid_for=lambda _: "9" * 16, name_for=lambda _: "x")

    assert isinstance(masked, bytes)
    assert PLAYER_A.encode() not in masked
    assert PLAYER_B.encode() not in masked
    tile = decode_point(masked)
    assert tile.site is not None
    assert tile.site.participants == ("9" * 16, "9" * 16)
    # Everything that is not a person survives the masking.
    assert tile.site.cat_id == 1530
    assert tile.site.expires_ms == EXPIRES_MS


def test_a_lantern_with_nobody_at_it_is_returned_unchanged_by_the_masker() -> None:
    body = site_point(x=454, y=276, cat_id=1440, status=SITE_UNLIT)
    as_text = B64_PREFIX + base64.b64encode(body).decode()

    assert mask_people(body, uid_for=lambda _: "0", name_for=lambda _: "x") is body
    assert mask_people(as_text, uid_for=lambda _: "0", name_for=lambda _: "x") == as_text
