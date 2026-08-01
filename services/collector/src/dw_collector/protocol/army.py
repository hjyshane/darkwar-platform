"""The arena `army` blob: a base64 protobuf carrying a defence lineup.

There is no `.proto` for this. The APK ships none and the payload carries no
descriptor, which is the same wall `battleContent` hit — but unlike that one,
this message parses completely from the wire format alone, so it is decoded
rather than stored raw.

Field meanings were established from 806 real lineups plus a cross-check that
does not depend on the arena at all: `army.info` is a separate command that
returns the collector's own five heroes as plain JSON, with `heroId` and
`heroUuid`. All five uuids match this blob's field 2.6 exactly, which pins
2.1 as the hero id and 2.6 as the instance id without any inference.

    1        soldier/troop block
    1.1      troop type id, e.g. "107009" — the only string in the message
    2 (rep)  one per deployed hero, always exactly five
    2.1      heroId, same id space as rank.get.by.range type 49's heroId
    2.4      slot, 1-5, each appearing exactly once per lineup
    2.6      heroUuid, matching army.info for the collector's own account
    2.7      level (200 across every unit observed — the cap)
    2.8      star
    2.12     troop class: 1 fighter, 2 shooter, 3 rider
    2.13     equipment, four entries
    2.16     the hero's power

2.12 is the one the game screen was needed for. It takes exactly three values
and is completely constant per hero across 21 heroes, which is what makes it
the class axis rather than a per-player choice; which number means which class
came from the user reading it in game. `careerType` was expected to carry this
and does not — it is 0 for every player in every capture.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, field

# Wire types we expect. Anything else means we are not looking at this message.
_WIRE_VARINT = 0
_WIRE_F64 = 1
_WIRE_BYTES = 2
_WIRE_F32 = 5

LINEUP_SIZE = 5


class ArmyDecodeError(ValueError):
    """The blob is not a lineup we recognise."""


@dataclass(frozen=True)
class ArmyUnit:
    """One deployed hero. Every field is optional except the ones every unit
    in every observed lineup carried, because a field that is merely usual is
    not a field we can require."""

    hero_id: int
    slot: int | None = None
    troop_class: int | None = None
    hero_level: int | None = None
    star: int | None = None
    hero_power: int | None = None
    hero_uuid: int | None = None
    equipment: tuple[int, ...] = field(default=())


def _read_varint(buf: bytes, i: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if i >= len(buf):
            msg = "truncated varint"
            raise ArmyDecodeError(msg)
        byte = buf[i]
        i += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, i
        shift += 7
        if shift > 63:
            msg = "varint longer than 64 bits"
            raise ArmyDecodeError(msg)


def _fields(buf: bytes) -> dict[int, list[int | bytes]]:
    """One level of the wire format, repeated fields kept as lists.

    Bounds are checked on every branch: a fixed64 that runs off the end has to
    fail here, or a blob that is not this message at all decodes to plausible
    nonsense instead of raising.
    """
    out: dict[int, list[int | bytes]] = {}
    i = 0
    while i < len(buf):
        key, i = _read_varint(buf, i)
        number, wire = key >> 3, key & 7
        if number == 0:
            msg = "field number 0"
            raise ArmyDecodeError(msg)
        value: int | bytes
        if wire == _WIRE_VARINT:
            value, i = _read_varint(buf, i)
        elif wire == _WIRE_BYTES:
            length, i = _read_varint(buf, i)
            if i + length > len(buf):
                msg = "length-delimited field runs past the end"
                raise ArmyDecodeError(msg)
            value = buf[i : i + length]
            i += length
        elif wire in (_WIRE_F32, _WIRE_F64):
            width = 4 if wire == _WIRE_F32 else 8
            if i + width > len(buf):
                msg = "fixed-width field runs past the end"
                raise ArmyDecodeError(msg)
            value = buf[i : i + width]
            i += width
        else:
            msg = f"unsupported wire type {wire}"
            raise ArmyDecodeError(msg)
        out.setdefault(number, []).append(value)
    return out


def _varint(values: dict[int, list[int | bytes]], number: int) -> int | None:
    found = values.get(number)
    if not found or not isinstance(found[0], int):
        return None
    return found[0]


def decode_army(blob: str) -> list[ArmyUnit]:
    """Decode a lineup. An empty blob is not an error — the sanitizer used to
    blank this field, and an entry can legitimately carry no lineup."""
    if not blob:
        return []
    try:
        raw = base64.b64decode(blob, validate=True)
    except (binascii.Error, ValueError) as exc:
        msg = f"army is not valid base64: {exc}"
        raise ArmyDecodeError(msg) from exc

    units = []
    for encoded in _fields(raw).get(2, []):
        if not isinstance(encoded, bytes):
            msg = "unit field is not length-delimited"
            raise ArmyDecodeError(msg)
        values = _fields(encoded)
        hero_id = _varint(values, 1)
        if hero_id is None:
            msg = "unit carries no hero id"
            raise ArmyDecodeError(msg)
        equipment = tuple(
            gear
            for item in values.get(13, [])
            if isinstance(item, bytes)
            for gear in (_varint(_fields(item), 1),)
            if gear is not None
        )
        units.append(
            ArmyUnit(
                hero_id=hero_id,
                slot=_varint(values, 4),
                troop_class=_varint(values, 12),
                hero_level=_varint(values, 7),
                star=_varint(values, 8),
                hero_power=_varint(values, 16),
                hero_uuid=_varint(values, 6),
                equipment=equipment,
            )
        )
    return units
