"""The viewport tile decoder.

Tiles are built here from the wire format rather than pasted as base64, so
a failure names the field that broke instead of a blob nobody can read.
"""

from __future__ import annotations

import base64

import pytest

from dw_collector.protocol.worldmap import (
    CITY_TYPE,
    MAP_WIDTH,
    POINT_KEY,
    WorldMapDecodeError,
    decode_point,
    decode_viewport,
)


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _tag(number: int, wire: int) -> bytes:
    return _varint((number << 3) | wire)


def _vfield(number: int, value: int) -> bytes:
    return _tag(number, 0) + _varint(value)


def _bfield(number: int, payload: bytes) -> bytes:
    return _tag(number, 2) + _varint(len(payload)) + payload


def _city(uid: str, name: str, hq: int) -> bytes:
    return _bfield(1, uid.encode()) + _vfield(4, hq) + _bfield(14, name.encode())


def _point(point_id: int, object_type: int, city: bytes | None = None, server: int = 580) -> str:
    body = _vfield(1, point_id) + _vfield(2, object_type)
    if city is not None:
        body += _bfield(3, city)
    body += _vfield(103, server)
    return f"{POINT_KEY}:{base64.b64encode(body).decode()}"


def test_the_coordinate_unpacks_as_x_times_width_plus_y() -> None:
    # 610381 was the largest seen in a real sweep; maxAreaSize is 1000 on
    # every viewport, which is what makes this packing the right reading.
    tile = decode_point(_point(610381, 7))

    assert tile.point_id == 610381
    assert (tile.x, tile.y) == (610, 381)
    assert MAP_WIDTH == 1000


def test_a_city_carries_uid_name_and_hq_level() -> None:
    tile = decode_point(_point(491444, CITY_TYPE, _city("1190060554000580", "Ranger", 35)))

    assert tile.object_type == CITY_TYPE
    assert tile.city is not None
    assert tile.city.uid == "1190060554000580"
    assert tile.city.name == "Ranger"
    assert tile.city.hq_level == 35
    assert (tile.x, tile.y) == (491, 444)


def test_a_non_city_type_is_not_given_city_fields() -> None:
    """Type 21 looks like a levelled building and is not one. Interpreting
    its fields here is exactly the guess the decoder must not make."""
    tile = decode_point(_point(4004, 21))

    assert tile.object_type == 21
    assert tile.city is None
    # The fields are still there for whoever confirms what they mean.
    assert "1" in tile.raw and "2" in tile.raw


def test_missing_optional_city_fields_stay_none() -> None:
    tile = decode_point(_point(7009, CITY_TYPE, _bfield(1, b"1190060554000580")))

    assert tile.city is not None
    assert tile.city.uid == "1190060554000580"
    assert tile.city.name is None
    assert tile.city.hq_level is None


def test_server_id_is_read_when_present_and_optional_when_not() -> None:
    assert decode_point(_point(1, 3, server=584)).server_id == 584
    body = _vfield(1, 1) + _vfield(2, 3)
    bare = f"{POINT_KEY}:{base64.b64encode(body).decode()}"
    assert decode_point(bare).server_id is None


def test_a_point_with_no_coordinate_is_refused() -> None:
    """A tile that cannot say where it is would land at (0, 0) and put a
    stranger's city on the corner of the map."""
    body = _vfield(2, 3)
    entry = f"{POINT_KEY}:{base64.b64encode(body).decode()}"

    with pytest.raises(WorldMapDecodeError):
        decode_point(entry)


def test_an_unexpected_key_is_refused_rather_than_decoded() -> None:
    """Every observed point carries `b64`. A second key means a second
    message shape, and decoding it as this one yields plausible nonsense."""
    body = _vfield(1, 4004) + _vfield(2, 3)
    with pytest.raises(WorldMapDecodeError):
        decode_point(f"99z:{base64.b64encode(body).decode()}")


@pytest.mark.parametrize(
    "entry",
    [
        "",
        "b64:",
        "not-a-point",
        "b64:!!!!not-base64!!!!",
        # A length-delimited field claiming more bytes than remain.
        f"b64:{base64.b64encode(_tag(3, 2) + _varint(50) + b'short').decode()}",
        # Field number zero is illegal in the wire format.
        f"b64:{base64.b64encode(_varint(0) + b'x').decode()}",
    ],
)
def test_malformed_points_raise_rather_than_decoding_to_nonsense(entry: str) -> None:
    with pytest.raises(WorldMapDecodeError):
        decode_point(entry)


def test_a_viewport_keeps_its_good_tiles_when_one_point_is_bad() -> None:
    """657 tiles is a normal viewport. Losing all of them to one bad entry
    would turn a decoder gap into a hole in the map."""
    payload = {
        "points": [
            _point(1001, CITY_TYPE, _city("1190060554000580", "Ranger", 35)),
            "b64:!!!broken!!!",
            _point(1002, 7),
        ]
    }
    tiles = decode_viewport(payload)

    assert [t.point_id for t in tiles] == [1001, 1002]


def test_a_viewport_without_points_yields_nothing() -> None:
    assert decode_viewport({}) == []
    assert decode_viewport({"points": None}) == []
    assert decode_viewport({"points": []}) == []


def test_decoding_is_deterministic() -> None:
    entry = _point(491444, CITY_TYPE, _city("1190060554000580", "Ranger", 35))

    assert decode_point(entry) == decode_point(entry)
