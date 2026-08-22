"""The `world.get.new` viewport: map tiles as base64 protobuf.

A viewport response carries `points`, and each point is a protobuf with no
`.proto` anywhere, decoded from the wire format the same way `army.py`
decodes a lineup.

A POINT ARRIVES AS BYTES AND IS STORED AS TEXT, and both forms reach this
module. The game sends SFS type 10, which decodes to `bytes` — that is what
live capture and a pcap replay hand over. Writing an observation to the
journal or to a fixture serializes it through `models.json_default`, which
prefixes `b64:` and base64-encodes, so anything read back out of a journal
or a fixture is a string.

The prefix is OURS, not the game's. An earlier version of this module took
it for a key the protocol sends and accepted only the string form, which
decoded every stored observation and nothing at all from a live socket —
the one path that matters in production.

Meanings come from 8,016 viewports and 41,298 distinct tiles in a real
journal, cross-checked against two things the viewport cannot say on its
own — `world.get.detail.new`, which returns an opened object as plain JSON,
and the roster's own `hq_level`.

    1        THE COORDINATE, packed `x * 1000 + y`. `world.get.detail.new`
             returns `point` and `pointId` and they are equal in 543/543;
             both equal this field for every opened tile (27/27). Decoded y
             never reached 1000 in 543 samples and every viewport reports
             `maxAreaSize` 1000
    2        object type. 14 seen: 3, 4, 6, 7, 11, 13, 14, 15, 21, 22, 23,
             25, 28, 29
    3        the CITY sub-message, present on type 3 only
    3.1      player uid, 16 digits
    3.4      HQ LEVEL. Equals the roster's `hq_level` exactly in 349/394
             players; the remainder differ by 1-2, which is a player
             levelling between the roster snapshot and the pan
    3.14     PLAYER NAME. Equals the opened detail's `name` in 288/294 and
             its `afn` (the alliance tag) in 0/294. An earlier note in the
             runbook called this the alliance tag, from a small sample where
             the values happened to be short
    102,103  server id, 580 on every tile of the sweep

WHAT IS DELIBERATELY NOT INTERPRETED. Type 21 carries an owner uid and a
spec whose trailing digits run 1-4, and it looks like a levelled building.
It is not: keyed on object id the spec never changed across days (0 of
19,983 re-observed), and keyed on coordinate with the owner held fixed the
transitions were symmetric (457 up, 396 down) where an upgrade is
monotonic. 563 of those objects also move. Its fields stay raw until
something opens one.

Type 6 is marches, not cities — one uid appears at one type-3 coordinate
and at many scattered type-6 ones at the same moment.

The wire-format primitives below mirror `army.py` rather than importing
its private helpers. Thirty lines of duplication is the cheaper of the two:
the alternative is refactoring a decoder that is finished and tested to
share a base that only these two callers want.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, field
from typing import Any

#: The marker `models.json_default` writes in front of base64-encoded bytes.
#: Points read back from a journal or a fixture carry it; points off the
#: wire do not exist as strings at all.
B64_PREFIX = "b64:"

# `maxAreaSize` on every observed viewport. The coordinate packing depends
# on it, so it is named here rather than written as a bare 1000.
MAP_WIDTH = 1000

_WIRE_VARINT = 0
_WIRE_F64 = 1
_WIRE_BYTES = 2
_WIRE_F32 = 5

_COORDINATE = 1
_OBJECT_TYPE = 2
_CITY = 3
_SERVER_ID = 103

_CITY_UID = 1
_CITY_HQ_LEVEL = 4
_CITY_NAME = 14

#: `f2` of a player's city tile — the only type whose fields are interpreted.
CITY_TYPE = 3


class WorldMapDecodeError(ValueError):
    """A point string that is not a viewport tile."""


@dataclass(frozen=True)
class City:
    """The interpreted part of a type-3 tile."""

    uid: str | None = None
    name: str | None = None
    hq_level: int | None = None


@dataclass(frozen=True)
class Tile:
    """One map object at one coordinate.

    `raw` keeps every top-level field as decoded, including the ones no
    reader understands yet, so a type promoted later needs no re-capture —
    the same reason the snapshot tables carry a `raw` column.
    """

    point_id: int
    object_type: int | None
    x: int
    y: int
    server_id: int | None = None
    city: City | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def _read_varint(buf: bytes, i: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if i >= len(buf):
            msg = "truncated varint"
            raise WorldMapDecodeError(msg)
        byte = buf[i]
        i += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, i
        shift += 7
        if shift > 63:
            msg = "varint longer than 64 bits"
            raise WorldMapDecodeError(msg)


def _fields(buf: bytes) -> dict[int, list[int | bytes]]:
    """One level of the wire format, repeated fields kept as lists.

    Every branch checks bounds: a fixed-width field running off the end has
    to raise here, or a blob that is not this message decodes to something
    that looks like a tile.
    """
    out: dict[int, list[int | bytes]] = {}
    i = 0
    while i < len(buf):
        key, i = _read_varint(buf, i)
        number, wire = key >> 3, key & 7
        if number == 0:
            msg = "field number 0"
            raise WorldMapDecodeError(msg)
        value: int | bytes
        if wire == _WIRE_VARINT:
            value, i = _read_varint(buf, i)
        elif wire == _WIRE_BYTES:
            length, i = _read_varint(buf, i)
            if i + length > len(buf):
                msg = "length-delimited field runs past the end"
                raise WorldMapDecodeError(msg)
            value = buf[i : i + length]
            i += length
        elif wire == _WIRE_F32:
            if i + 4 > len(buf):
                msg = "32-bit field runs past the end"
                raise WorldMapDecodeError(msg)
            value = int.from_bytes(buf[i : i + 4], "little")
            i += 4
        elif wire == _WIRE_F64:
            if i + 8 > len(buf):
                msg = "64-bit field runs past the end"
                raise WorldMapDecodeError(msg)
            value = int.from_bytes(buf[i : i + 8], "little")
            i += 8
        else:
            msg = f"unsupported wire type {wire}"
            raise WorldMapDecodeError(msg)
        out.setdefault(number, []).append(value)
    return out


def _varint(values: dict[int, list[int | bytes]], number: int) -> int | None:
    got = values.get(number)
    if not got or not isinstance(got[0], int):
        return None
    return got[0]


def _text(values: dict[int, list[int | bytes]], number: int) -> str | None:
    got = values.get(number)
    if not got or not isinstance(got[0], bytes):
        return None
    try:
        return got[0].decode("utf-8")
    except UnicodeDecodeError:
        # Not every length-delimited field is text. A name that will not
        # decode is dropped rather than guessed at with errors="replace",
        # which would store mojibake as if it were somebody's name.
        return None


def _jsonable(value: int | bytes) -> int | str:
    return value if isinstance(value, int) else value.hex()


def _city(values: dict[int, list[int | bytes]]) -> City | None:
    got = values.get(_CITY)
    if not got or not isinstance(got[0], bytes):
        return None
    sub = _fields(got[0])
    return City(
        uid=_text(sub, _CITY_UID),
        name=_text(sub, _CITY_NAME),
        hq_level=_varint(sub, _CITY_HQ_LEVEL),
    )


def _emit_varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _split(buf: bytes) -> list[tuple[int, int, bytes]]:
    """Fields in wire order, each with its value bytes exactly as they came.

    `_fields` loses order and the distinction between two encodings of the
    same number. Rewriting a payload needs both back, or a re-encoded point
    stops being byte-comparable with the original and the round-trip test
    below cannot mean anything.
    """
    out: list[tuple[int, int, bytes]] = []
    i = 0
    while i < len(buf):
        start = i
        key, i = _read_varint(buf, i)
        number, wire = key >> 3, key & 7
        if number == 0:
            msg = "field number 0"
            raise WorldMapDecodeError(msg)
        if wire == _WIRE_VARINT:
            _, i = _read_varint(buf, i)
        elif wire == _WIRE_BYTES:
            length, i = _read_varint(buf, i)
            i += length
        elif wire == _WIRE_F32:
            i += 4
        elif wire == _WIRE_F64:
            i += 8
        else:
            msg = f"unsupported wire type {wire}"
            raise WorldMapDecodeError(msg)
        if i > len(buf):
            msg = "field runs past the end"
            raise WorldMapDecodeError(msg)
        out.append((number, wire, buf[start:i]))
    return out


def _replace_text(buf: bytes, replacements: dict[int, str]) -> bytes:
    """Rewrite named length-delimited fields, leaving every other byte alone."""
    out = bytearray()
    for number, wire, chunk in _split(buf):
        if wire == _WIRE_BYTES and number in replacements:
            payload = replacements[number].encode("utf-8")
            out += _emit_varint((number << 3) | _WIRE_BYTES)
            out += _emit_varint(len(payload))
            out += payload
        else:
            out += chunk
    return bytes(out)


def rewrite_city(entry: str | bytes, *, uid: str, name: str) -> str | bytes:
    """A point with the city's uid and name replaced, everything else intact.

    This exists for the fixture sanitizer. The alternative was dropping the
    `points` list from the fixture, which would leave the parser's whole
    reason for existing untested against a real payload — the coordinates,
    the type ids and the field numbering are exactly what a fixture is for,
    and none of them identify anybody.

    A non-city point comes back unchanged rather than raising: a viewport is
    mostly terrain and resources, and the caller should not have to know
    which entries carry a person.
    """
    raw = point_bytes(entry)
    out = bytearray()
    changed = False
    for number, wire, chunk in _split(raw):
        if number == _CITY and wire == _WIRE_BYTES:
            body = _fields_body(chunk)
            masked = _replace_text(body, {_CITY_UID: uid, _CITY_NAME: name})
            out += _emit_varint((_CITY << 3) | _WIRE_BYTES)
            out += _emit_varint(len(masked))
            out += masked
            changed = True
        else:
            out += chunk
    if not changed:
        return entry
    # Same form in as out. A sanitizer works on whichever the caller had,
    # and handing back a string where bytes went in would quietly change
    # what the fixture writer serializes.
    if isinstance(entry, bytes):
        return bytes(out)
    return B64_PREFIX + base64.b64encode(bytes(out)).decode()


def _fields_body(chunk: bytes) -> bytes:
    """The value bytes of a single length-delimited field's raw chunk."""
    i = 0
    _, i = _read_varint(chunk, i)
    length, i = _read_varint(chunk, i)
    return chunk[i : i + length]


def point_bytes(entry: str | bytes) -> bytes:
    """The protobuf behind a point, in any of the three forms it arrives in.

    THIS PROJECT SERIALIZES THE SAME BYTES TWO DIFFERENT WAYS, and a reader
    that knows only one of them silently handles half the corpus:

      bytes            off the wire — live capture and pcap replay. SFS type
                       10 decodes to bytes and never becomes a string
      "b64:<standard>" the JOURNAL, via `models.json_default`
      "<base64url>"    a FIXTURE, via `Observation.model_dump_json` and
                       pydantic's `ser_json_bytes="base64"`, which uses the
                       URL-safe alphabet and writes no prefix

    The bare form is accepted rather than refused because both string forms
    are ours; there is no third-party string a point could be confused with.
    """
    if isinstance(entry, bytes):
        return entry
    blob = entry[len(B64_PREFIX) :] if entry.startswith(B64_PREFIX) else entry
    if not blob:
        msg = "point carries no payload"
        raise WorldMapDecodeError(msg)
    # URL-safe first: it is what the fixture writer emits, and a payload
    # containing `-` or `_` is only valid under that alphabet.
    for decode in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            return decode(blob)
        except (binascii.Error, ValueError):
            continue
    msg = "point is not valid base64"
    raise WorldMapDecodeError(msg)


def decode_point(entry: str | bytes) -> Tile:
    """Decode one `points` entry into a tile.

    The coordinate is required: a tile that cannot say where it is has
    nothing the map can use, and accepting it would put a row at (0, 0).
    """
    raw = point_bytes(entry)
    top = _fields(raw)
    point_id = _varint(top, _COORDINATE)
    if point_id is None:
        msg = "point carries no coordinate"
        raise WorldMapDecodeError(msg)

    object_type = _varint(top, _OBJECT_TYPE)
    return Tile(
        point_id=point_id,
        object_type=object_type,
        x=point_id // MAP_WIDTH,
        y=point_id % MAP_WIDTH,
        server_id=_varint(top, _SERVER_ID),
        city=_city(top) if object_type == CITY_TYPE else None,
        raw={str(n): [_jsonable(v) for v in vs] for n, vs in top.items()},
    )


def decode_viewport(payload: dict[str, Any]) -> list[Tile]:
    """Every decodable tile in one `world.get.new` response.

    A single bad point does not lose the viewport. One malformed entry among
    657 is a decoder gap worth finding, not a reason to drop 656 good tiles
    — and the count of what was skipped is what makes the gap visible, so
    callers get the tiles and the caller's own logging reports the rest.
    """
    points = payload.get("points")
    if not isinstance(points, list):
        return []
    tiles: list[Tile] = []
    for entry in points:
        if not isinstance(entry, (str, bytes)):
            continue
        try:
            tiles.append(decode_point(entry))
        except WorldMapDecodeError:
            continue
    return tiles
