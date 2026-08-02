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
    assert {len(army.units) for army in lineups} == {LINEUP_SIZE}


def test_slots_are_one_to_five_exactly_once() -> None:
    for army in (decode_army(entry["army"]) for entry in _entries()):
        assert sorted(unit.slot for unit in army.units) == [1, 2, 3, 4, 5]


def test_troop_class_is_a_property_of_the_hero() -> None:
    """The class axis careerType was expected to carry and does not. It is
    constant per hero, which is why it can be labelled at all — a per-player
    choice could not be."""
    by_hero: dict[int, set[int | None]] = {}
    for entry in _entries():
        for unit in decode_army(entry["army"]).units:
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
    lineup_heroes = {
        unit.hero_id for entry in _entries() for unit in decode_army(entry["army"]).units
    }

    assert board_heroes
    assert board_heroes <= lineup_heroes


def test_level_is_the_hero_level_not_the_cap() -> None:
    """Both are in the blob. army.info reports heroLevel 103 and maxLv 200 for
    the collector's own five, and reading the wrong one stores 200 for
    everybody — which is exactly what it did until this was checked."""
    units = decode_army(_entries()[0]["army"]).units

    assert all(unit.max_level == 200 for unit in units)
    assert all(unit.level is not None and unit.level < 200 for unit in units)
    assert {unit.level for unit in units} != {unit.max_level for unit in units}


def test_a_synced_hero_reports_the_level_the_game_shows() -> None:
    """A hero in the training centre is synced to another level, and the blob
    carries both. Reading only its own level reports 1 for a hero the screen
    shows at 120 — which is what a labelled capture of arena rank 1 caught."""
    synced = [
        unit
        for entry in _entries()
        for unit in decode_army(entry["army"]).units
        if unit.level_synced
    ]

    assert synced, "the fixture should contain training-centre heroes"
    # The displayed level is never the stale own level, and the own level is
    # kept rather than overwritten — the two facts are different.
    assert all(unit.level != unit.base_level for unit in synced)
    assert all(unit.level is not None and unit.base_level is not None for unit in synced)
    assert any(unit.base_level == 1 for unit in synced)
    # An unsynced hero reports its own level unchanged.
    plain = [
        unit
        for entry in _entries()
        for unit in decode_army(entry["army"]).units
        if not unit.level_synced
    ]
    assert all(unit.level == unit.base_level for unit in plain)


def test_skills_come_back_in_the_order_the_game_lists_them() -> None:
    """Checked against a labelled capture: five lineups, twenty skills, every
    level matching once sorted by id."""
    for army in (decode_army(entry["army"]) for entry in _entries()):
        for unit in army.units:
            ids = [skill.skill_id for skill in unit.skills]
            assert ids == sorted(ids)


def test_unit_carries_star_power_and_instance_id() -> None:
    units = decode_army(_entries()[0]["army"]).units

    assert all(unit.star in (3, 4, 5, 6) for unit in units)
    assert all(unit.power and unit.power > 0 for unit in units)
    assert all(unit.hero_uuid and unit.hero_uuid > 0 for unit in units)


def test_equipment_carries_level_and_step_not_just_an_id() -> None:
    units = decode_army(_entries()[0]["army"]).units

    for unit in units:
        assert len(unit.equipment) == 4
        for item in unit.equipment:
            assert item.equipment_id > 0
            # Level and step are both optional, and observed to be: 15,885 of
            # 16,112 equipment records carry a level and 13,325 a step. An
            # unlevelled piece is a real state, so neither may read as 0.
            assert item.level is None or 1 <= item.level <= 100
            assert item.step is None or item.step >= 1
    assert any(item.step is not None for unit in units for item in unit.equipment)
    assert any(item.level is not None for unit in units for item in unit.equipment)


def test_skills_are_three_to_five_with_levels() -> None:
    for army in (decode_army(entry["army"]) for entry in _entries()):
        for unit in army.units:
            assert 3 <= len(unit.skills) <= 5
            assert all(skill.level is not None and 1 <= skill.level <= 30 for skill in unit.skills)


def test_exclusive_weapon_belongs_to_its_own_hero() -> None:
    """The weapon submessage names a hero id, and it is always the unit's own
    — 1730 of 1730. That is what identifies it as the exclusive weapon rather
    than some other hero reference."""
    with_weapon = [
        unit
        for entry in _entries()
        for unit in decode_army(entry["army"]).units
        if unit.weapon_level is not None
    ]

    assert with_weapon, "the fixture should contain unlocked weapons"
    assert all(1 <= unit.weapon_level <= 60 for unit in with_weapon)
    # Not every hero has one unlocked, and null has to mean that rather than 0.
    assert len(with_weapon) < 500


def test_the_defending_stack_is_read_once_per_lineup() -> None:
    army = decode_army(_entries()[0]["army"])

    assert army.troop_type_id is not None
    assert army.troop_type_id.startswith("107")
    assert army.troop_count is not None and army.troop_count > 0


def test_the_stack_carries_class_and_industry() -> None:
    """1.2 and 1.9 were unread until a user said what they are.

    A unit levels 1-10 — the tier digit in the type id — and only then takes
    industry levels 1-3. The data says exactly that: across 800 real lineups
    industry is non-zero ONLY at tier 9, never at 7 or 8. 1.2 turned out to
    carry nothing new, being the type id's own class digit plus one in every
    lineup, which is why it had looked like an unexplained 1-3.

    Industry is a plain integer rather than a checked 1-3 because the game is
    due to extend it to 10.
    """
    armies = [decode_army(entry["army"]) for entry in _entries()]

    assert armies
    for army in armies:
        assert army.troop_type_id is not None
        assert army.troop_class == int(army.troop_type_id[3]) + 1
        assert army.troop_industry >= 0
        if army.troop_type_id[-1] != "9":
            assert army.troop_industry == 0, "industry only exists at top tier"


def test_stage_is_zero_at_max_star_and_absent_means_zero() -> None:
    """2.9 is the step within the current star.

    push.hero.data returns the collector's own heroes as plain JSON and names
    the field `stage`: 0 for all nine at rankLv 6, 1 for the one at rankLv 4.
    The arena blob has the same shape — omitted at max star every time, 1-4
    below it — and proto3 omits a field equal to its default, so an absent
    2.9 is a zero rather than an unknown. Reading it as None would have made
    "no next star to work towards" indistinguishable from "not observed".
    """
    units = [unit for entry in _entries() for unit in decode_army(entry["army"]).units]

    assert units, "fixture has lineups"
    assert all(unit.stage is not None for unit in units)
    assert all(0 <= (unit.stage or 0) <= 4 for unit in units)
    at_max = [unit for unit in units if unit.star == 6]
    assert at_max, "fixture has heroes at max star"
    assert all(unit.stage == 0 for unit in at_max), "a maxed hero has no step in progress"


def test_uninterpreted_fields_are_kept_rather_than_dropped() -> None:
    """One field is still unread — 2.3, which is 1 on every unit observed.

    A field with a single value carries nothing, but the schema convention is
    that unrecognised values survive in `raw` rather than being dropped, so
    the decoder still hands it over."""
    extras = [unit.extra for entry in _entries() for unit in decode_army(entry["army"]).units]

    assert any(extra for extra in extras), "some units carry fields we do not read"
    assert all(key.startswith("field_") for extra in extras for key in extra)


def test_lineup_power_is_not_the_account_power() -> None:
    """Summing the five is a fraction of the entry's `power`, so the two must
    never be conflated — the entry figure covers the whole account."""
    entry = _entries()[0]
    lineup_total = sum(unit.power or 0 for unit in decode_army(entry["army"]).units)

    assert lineup_total < entry["power"]


def test_empty_army_is_not_an_error() -> None:
    """Older fixtures were sanitized to a blank, and an entry can carry none."""
    assert decode_army("").units == ()


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
