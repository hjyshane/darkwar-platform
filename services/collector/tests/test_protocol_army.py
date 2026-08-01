"""The `army` lineup decoder.

Field meanings are pinned against a cross-check the arena payload cannot
provide on its own: `army.info` returns the collector's own five heroes as
plain JSON, and its heroUuid values must match the blob's. That is what makes
this a decoding rather than a guess.
"""

from __future__ import annotations

import base64

import pytest

from dw_collector.protocol.army import LINEUP_SIZE, ArmyDecodeError, decode_army
from tests.conftest import load_observation

FIXTURE = "user.get.arena.info/top100_580v582_v1.json"

# 1 fighter, 2 shooter, 3 rider — read off the game screen, since the payload
# carries the number only.
FIGHTER, SHOOTER, RIDER = 1, 2, 3


def _entries() -> list[dict]:
    return load_observation(FIXTURE).payload["rankArr"]


def test_every_lineup_is_five_heroes() -> None:
    lineups = [decode_army(entry["army"]) for entry in _entries()]

    assert len(lineups) == 100
    assert {len(units) for units in lineups} == {LINEUP_SIZE}


def test_slots_are_one_to_five_exactly_once() -> None:
    for units in (decode_army(entry["army"]) for entry in _entries()):
        assert sorted(unit.slot for unit in units) == [1, 2, 3, 4, 5]


def test_troop_class_is_a_property_of_the_hero() -> None:
    """The class axis careerType was expected to carry and does not. It is
    constant per hero, which is why it can be labelled at all — a per-player
    choice could not be."""
    by_hero: dict[int, set[int | None]] = {}
    for entry in _entries():
        for unit in decode_army(entry["army"]):
            by_hero.setdefault(unit.hero_id, set()).add(unit.troop_class)

    ambiguous = {hero: classes for hero, classes in by_hero.items() if len(classes) > 1}
    assert ambiguous == {}
    assert {c for classes in by_hero.values() for c in classes} == {FIGHTER, SHOOTER, RIDER}
    # The 4000x family is one hero per class, which is the tell that made this
    # field worth looking at.
    assert by_hero[40001] == {FIGHTER}
    assert by_hero[40002] == {SHOOTER}
    assert by_hero[40003] == {RIDER}


def test_hero_ids_share_the_rank_board_id_space() -> None:
    """rank.get.by.range type 49 ranks a single hero and names it via heroId.
    If these were different id spaces, one of the two readings would be wrong."""
    board = load_observation("rank.get.by.range/hero_best_49_v1.json")
    board_heroes = {int(e["heroId"]) for e in board.payload["serverRanking"] if e.get("heroId")}
    lineup_heroes = {unit.hero_id for entry in _entries() for unit in decode_army(entry["army"])}

    assert board_heroes
    assert board_heroes <= lineup_heroes


def test_unit_carries_level_star_power_and_instance_id() -> None:
    units = decode_army(_entries()[0]["army"])

    assert all(unit.hero_level == 200 for unit in units)  # the cap
    assert all(unit.star in (3, 4, 5, 6) for unit in units)
    assert all(unit.hero_power and unit.hero_power > 0 for unit in units)
    assert all(unit.hero_uuid and unit.hero_uuid > 0 for unit in units)
    assert all(len(unit.equipment) == 4 for unit in units)


def test_lineup_power_is_not_the_account_power() -> None:
    """Summing the five is a fraction of the entry's `power`, so the two must
    never be conflated — the entry figure covers the whole account."""
    entry = _entries()[0]
    lineup_total = sum(unit.hero_power or 0 for unit in decode_army(entry["army"]))

    assert lineup_total < entry["power"]


def test_empty_army_is_not_an_error() -> None:
    """Older fixtures were sanitized to a blank, and an entry can carry none."""
    assert decode_army("") == []


@pytest.mark.parametrize(
    "blob",
    [
        "not base64 at all!",
        base64.b64encode(b"\xff\xff\xff\xff").decode(),  # field 0 / bad wire type
        base64.b64encode(b"\x12\x7f").decode(),  # length runs past the end
        base64.b64encode(b"\x11\x01\x02").decode(),  # fixed64 with 2 bytes left
    ],
)
def test_garbage_is_rejected_rather_than_guessed(blob: str) -> None:
    with pytest.raises(ArmyDecodeError):
        decode_army(blob)


def test_a_unit_without_a_hero_id_is_rejected() -> None:
    # field 2 (a unit) holding only field 4 (slot).
    blob = base64.b64encode(b"\x12\x02\x20\x01").decode()

    with pytest.raises(ArmyDecodeError):
        decode_army(blob)
