"""The arena `army` blob: a base64 protobuf carrying a defence lineup.

There is no `.proto` for this. The APK ships none and the payload carries no
descriptor, which is the same wall `battleContent` hit — but unlike that one,
this message parses completely from the wire format alone, so it is decoded
rather than stored raw.

Meanings come from 4,028 real units plus a cross-check the arena payload
cannot provide on its own: `army.info` is a separate command returning the
collector's own five heroes as plain JSON, with heroId, heroUuid, heroLevel
and maxLv. That is what pins the identity and level fields.

    1        the defending troop stack, once per lineup
    1.1      troop type id, e.g. "107009" — the only string in the message.
             `107` + class digit (0/1/2) + `0` + tier digit (7/8/9)
    1.3      troop count. 4,677-14,665 observed, correlating 0.85 with the
             entry's power, which is what identifies it
    2 (rep)  one per deployed hero, always exactly five
    2.1      heroId, same id space as rank.get.by.range type 49's heroId
    2.2      the level the hero reached on its own. Not its actual level when
             2.14 is present — see below
    2.4      slot, 1-5, each appearing exactly once per lineup
    2.5 (rep) skills, 3-5 per hero: id then level (1-30). The ids group by
             hero — 40001 owns 100421xx/100422xx, 1004 owns 100131xx
    2.6      heroUuid, matching army.info for the collector's own account
    2.7      level cap. 200 everywhere, matching army.info's maxLv
    2.8      star
    2.12     troop class: 1 fighter, 2 shooter, 3 rider
    2.13 (rep) equipment, always four: id, level (1-100), step (1-36)
    2.15     the hero's exclusive weapon: its id is the hero's own id in
             1730 of 1730 cases, and the second value is its level (3-41).
             Absent for a hero whose weapon is not unlocked
    2.14     the level the training centre raises a hero to, which IS that
             hero's level — the effect applies, it is not a display trick.
             Guaplee's lineup pinned this: all five are level 120, 2.2 reads
             120/90/1/70/1, and exactly the four in the training centre carry
             2.14 = 120. Reading 2.2 alone reports 1 for a level-120 hero
    2.16     the hero's power

2.12 is the one the game screen was needed for. It takes exactly three values
and is constant per hero across 21 heroes, which is what makes it the class
axis rather than a per-player choice; which number means which class came from
the user reading it in game. `careerType` was expected to carry this and does
not — it is 0 for every player in every capture.

Skills come back in id order once sorted, and that is the order the game
lists them in — checked against five lineups, twenty skills, every level
matching.

Field 2.9 (1-4) is still NOT interpreted. It is absent at max star, so it
looks like progress toward the next one, but the lineup that would have
settled it had every hero at max. The trailing block 12 is unread too. Both
ride along in `extra` and land in the row's `raw`.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, field
from typing import Any

_WIRE_VARINT = 0
_WIRE_F64 = 1
_WIRE_BYTES = 2
_WIRE_F32 = 5

LINEUP_SIZE = 5

# Field numbers, named so the mapping above and the code cannot drift apart.
_TROOPS = 1
_UNITS = 2
_TROOP_TYPE = 1
_TROOP_COUNT = 3
_HERO_ID = 1
_LEVEL = 2
_SLOT = 4
_SKILLS = 5
_HERO_UUID = 6
_MAX_LEVEL = 7
_STAR = 8
_TROOP_CLASS = 12
_EQUIPMENT = 13
_SYNCED_LEVEL = 14
_EXCLUSIVE_WEAPON = 15
_POWER = 16

_INTERPRETED_UNIT_FIELDS = frozenset(
    {
        _HERO_ID,
        _LEVEL,
        _SLOT,
        _SKILLS,
        _HERO_UUID,
        _MAX_LEVEL,
        _STAR,
        _TROOP_CLASS,
        _EQUIPMENT,
        _EXCLUSIVE_WEAPON,
        _POWER,
        _SYNCED_LEVEL,
    }
)


class ArmyDecodeError(ValueError):
    """The blob is not a lineup we recognise."""


@dataclass(frozen=True)
class Skill:
    skill_id: int
    level: int | None = None


@dataclass(frozen=True)
class Equipment:
    equipment_id: int
    level: int | None = None
    step: int | None = None


@dataclass(frozen=True)
class ArmyUnit:
    """One deployed hero."""

    hero_id: int
    slot: int | None = None
    troop_class: int | None = None
    #: The hero's actual level, whether it got there on its own or through
    #: the training centre.
    level: int | None = None
    #: The level it reached on its own. Often 1 for a hero raised entirely by
    #: the training centre; kept because the payload distinguishes them.
    base_level: int | None = None
    #: Whether the level comes from the training centre.
    level_synced: bool = False
    max_level: int | None = None
    star: int | None = None
    power: int | None = None
    hero_uuid: int | None = None
    weapon_level: int | None = None
    skills: tuple[Skill, ...] = field(default=())
    equipment: tuple[Equipment, ...] = field(default=())
    #: Fields this decoder does not interpret, kept so nothing is silently
    #: dropped — the schema convention is that unrecognised values survive in
    #: `raw` until they are understood.
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Army:
    units: tuple[ArmyUnit, ...] = field(default=())
    troop_type_id: str | None = None
    troop_count: int | None = None


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

    Bounds are checked on every branch: a fixed-width field running off the
    end has to fail here, or a blob that is not this message decodes to
    plausible nonsense instead of raising.
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


def _submessages(
    values: dict[int, list[int | bytes]], number: int
) -> list[dict[int, list[int | bytes]]]:
    out = []
    for item in values.get(number, []):
        if not isinstance(item, bytes):
            msg = f"field {number} is not length-delimited"
            raise ArmyDecodeError(msg)
        out.append(_fields(item))
    return out


def _jsonable(value: int | bytes) -> int | str:
    """`raw` is jsonb, so bytes have to become something JSON can hold."""
    return value if isinstance(value, int) else value.hex()


def _unit(values: dict[int, list[int | bytes]]) -> ArmyUnit:
    hero_id = _varint(values, _HERO_ID)
    if hero_id is None:
        msg = "unit carries no hero id"
        raise ArmyDecodeError(msg)

    # Sorted by id, which is the order the game lists them in.
    skills = tuple(
        sorted(
            (
                Skill(skill_id=sid, level=_varint(sub, 2))
                for sub in _submessages(values, _SKILLS)
                for sid in (_varint(sub, 1),)
                if sid is not None
            ),
            key=lambda skill: skill.skill_id,
        )
    )
    equipment = tuple(
        Equipment(equipment_id=eid, level=_varint(sub, 2), step=_varint(sub, 3))
        for sub in _submessages(values, _EQUIPMENT)
        for eid in (_varint(sub, 1),)
        if eid is not None
    )
    weapon = _submessages(values, _EXCLUSIVE_WEAPON)
    base_level = _varint(values, _LEVEL)
    synced = _varint(values, _SYNCED_LEVEL)
    return ArmyUnit(
        hero_id=hero_id,
        slot=_varint(values, _SLOT),
        troop_class=_varint(values, _TROOP_CLASS),
        level=synced if synced is not None else base_level,
        base_level=base_level,
        level_synced=synced is not None,
        max_level=_varint(values, _MAX_LEVEL),
        star=_varint(values, _STAR),
        power=_varint(values, _POWER),
        hero_uuid=_varint(values, _HERO_UUID),
        weapon_level=_varint(weapon[0], 2) if weapon else None,
        skills=skills,
        equipment=equipment,
        extra={
            f"field_{number}": [_jsonable(v) for v in items]
            for number, items in sorted(values.items())
            if number not in _INTERPRETED_UNIT_FIELDS
        },
    )


def decode_army(blob: str) -> Army:
    """Decode a lineup. An empty blob is not an error — an entry can carry no
    lineup, and older fixtures were sanitized to a blank."""
    if not blob:
        return Army()
    try:
        raw = base64.b64decode(blob, validate=True)
    except (binascii.Error, ValueError) as exc:
        msg = f"army is not valid base64: {exc}"
        raise ArmyDecodeError(msg) from exc

    top = _fields(raw)
    troops = _submessages(top, _TROOPS)
    troop_type = troops[0].get(_TROOP_TYPE, [None])[0] if troops else None
    return Army(
        units=tuple(_unit(sub) for sub in _submessages(top, _UNITS)),
        troop_type_id=troop_type.decode() if isinstance(troop_type, bytes) else None,
        troop_count=_varint(troops[0], _TROOP_COUNT) if troops else None,
    )
