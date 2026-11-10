"""A listed truck's escort squad becomes a player_squad_power_snapshots row (0317).

What this pins: the squad number, power and five heroes come out of
``marchInfo``; an entry that names no squad writes only its truck; and the
idempotency key moves when the squad does and stays put when only the truck
does. Payloads are hand-authored from the shape captured on 2026-11-09 with
invented people.
"""

from __future__ import annotations

import copy
import uuid
from datetime import UTC, datetime
from typing import Any

from dw_collector.models import NormalizedRow, Observation
from dw_collector.normalize import world_trucks
from tests.conftest import load_observation

COLLECTOR = uuid.UUID("00000000-0000-0000-0000-000000000001")
CAPTURED = datetime(2026, 11, 9, 21, 1, tzinfo=UTC)
OWNER = "1000000001000568"

TRUCK: dict[str, Any] = {
    "uuid": 1420304700000000011,
    "ownerId": OWNER,
    "serverId": 568,
    "quality": 3,
    "cfgId": 90,
    "completeness": 1,
    "marchInfo": {
        "heroInfo": {
            "1": {"id": 1006, "level": 99, "power": 3941100, "rankLv": 26, "studentLv": 0},
            "2": {"id": 40001, "level": 98, "power": 4902400, "rankLv": 26, "studentLv": 0},
        },
        "lastPosIndex": 36,
        "power": 122937533,
        "robTimes": 0,
        "squadNo": 1,
    },
}


def command(name: str, payload: dict[str, Any], at: datetime = CAPTURED) -> Observation:
    return Observation(
        observation_id=uuid.uuid4(),
        collector_id=COLLECTOR,
        source_command=name,
        captured_at=at,
        collected_from_server_id=580,
        payload=payload,
    )


def listed(*trucks: dict[str, Any], at: datetime = CAPTURED) -> list[NormalizedRow]:
    return world_trucks.normalize_list(command("train.list", {"ls": list(trucks)}, at))


def squads(rows: list[NormalizedRow]) -> list[NormalizedRow]:
    return [r for r in rows if r.target_table == "player_squad_power_snapshots"]


def test_a_listed_truck_gives_its_escort_squad() -> None:
    rows = listed(TRUCK)
    (squad,) = squads(rows)

    assert [r.target_table for r in rows] == [
        "world_truck_snapshots",
        "player_squad_power_snapshots",
    ]
    assert squad.row["game_uid"] == int(OWNER)
    # The owner's server, not the one the list was captured on.
    assert squad.row["server_id"] == 568
    assert squad.row["collected_from_server_id"] == 580
    assert (squad.row["squad_no"], squad.row["power"]) == (1, 122937533)
    assert squad.row["truck_uuid"] == "1420304700000000011"
    assert squad.row["parser_version"] == world_trucks.PARSER_VERSION
    assert squad.row["heroes"] == [
        {"slot": 1, "hero_id": 1006, "level": 99, "power": 3941100, "rank_lv": 26},
        {"slot": 2, "hero_id": 40001, "level": 98, "power": 4902400, "rank_lv": 26},
    ]


def test_an_opened_truck_gives_the_same_squad_as_a_listed_one() -> None:
    (listed_squad,) = squads(listed(TRUCK))
    opened = world_trucks.normalize_info(command("get.train.info", {"train": TRUCK}))
    (opened_squad,) = squads(opened)

    assert opened_squad.row["power"] == listed_squad.row["power"]
    assert opened_squad.row["heroes"] == listed_squad.row["heroes"]


def test_the_heroes_come_back_in_slot_order_whatever_the_payload_order() -> None:
    truck = copy.deepcopy(TRUCK)
    truck["marchInfo"]["heroInfo"] = dict(reversed(list(truck["marchInfo"]["heroInfo"].items())))
    (squad,) = squads(listed(truck))

    assert [h["slot"] for h in squad.row["heroes"]] == [1, 2]


def test_an_entry_with_no_squad_writes_only_its_truck() -> None:
    plain = copy.deepcopy(TRUCK)
    plain["marchInfo"] = {"robTimes": 1}
    rows = listed(plain)

    assert [r.target_table for r in rows] == ["world_truck_snapshots"]


def test_missing_or_unusable_squad_fields_write_no_squad() -> None:
    def without(key: str) -> dict[str, Any]:
        truck = copy.deepcopy(TRUCK)
        del truck["marchInfo"][key]
        return truck

    def with_info(**changes: Any) -> dict[str, Any]:
        truck = copy.deepcopy(TRUCK)
        truck["marchInfo"].update(changes)
        return truck

    for broken in (
        without("power"),
        without("squadNo"),
        without("heroInfo"),
        with_info(power=0),
        with_info(power="122937533"),
        with_info(power=True),
        with_info(squadNo=0),
        with_info(squadNo="1"),
        with_info(heroInfo=[]),
    ):
        rows = listed(broken)
        assert squads(rows) == [], broken["marchInfo"]
        assert len(rows) == 1  # the truck itself is still written


def test_a_truck_with_no_owner_writes_no_squad() -> None:
    nobody = copy.deepcopy(TRUCK)
    nobody["ownerId"] = ""
    nobody["serverId"] = 568

    assert squads(listed(nobody)) == []


def test_a_malformed_hero_is_skipped_and_a_missing_number_is_null() -> None:
    truck = copy.deepcopy(TRUCK)
    truck["marchInfo"]["heroInfo"] = {
        "1": {"id": 1006, "power": 3941100},
        "2": {"level": 98},
        "3": "junk",
        "x": {"id": 1, "power": 1},
        "4": {"id": True, "power": 5},
    }
    (squad,) = squads(listed(truck))

    assert squad.row["heroes"] == [
        {"slot": 1, "hero_id": 1006, "level": None, "power": 3941100, "rank_lv": None}
    ]


def test_a_squad_with_no_readable_hero_keeps_its_power() -> None:
    truck = copy.deepcopy(TRUCK)
    truck["marchInfo"]["heroInfo"] = {}
    (squad,) = squads(listed(truck))

    assert squad.row["heroes"] == []
    assert squad.row["power"] == 122937533


def test_the_same_squad_seen_at_another_place_on_the_road_is_one_key() -> None:
    moved = copy.deepcopy(TRUCK)
    moved["marchInfo"]["lastPosIndex"] = 37
    moved["marchInfo"]["nextEndTime"] = 1794258999999

    (a,) = squads(listed(TRUCK))
    (b,) = squads(listed(moved))

    assert a.idempotency_key == b.idempotency_key


def test_a_new_power_or_a_new_hero_is_a_new_key() -> None:
    stronger = copy.deepcopy(TRUCK)
    stronger["marchInfo"]["power"] += 1
    swapped = copy.deepcopy(TRUCK)
    swapped["marchInfo"]["heroInfo"]["2"]["id"] = 40002

    keys = {squads(listed(t))[0].idempotency_key for t in (TRUCK, stronger, swapped)}

    assert len(keys) == 3


def test_the_key_does_not_depend_on_the_parser() -> None:
    """Hashing the normalized row would mint new keys on every version bump.

    The key is built from the raw entry, so changing what the parser DOES with
    a hero (say it starts keeping ``studentLv``) leaves every key it had.
    """
    (squad,) = squads(listed(TRUCK))

    assert squad.idempotency_key.startswith(f"{COLLECTOR}:train.list:squad:{OWNER}:1:2026-11-09:")


def test_one_owner_with_two_trucks_on_one_squad_is_one_row_in_a_batch() -> None:
    second = copy.deepcopy(TRUCK)
    second["uuid"] = 1420304700000000099
    second["marchInfo"]["lastPosIndex"] = 2

    rows = listed(TRUCK, second)

    assert len(squads(rows)) == 1
    assert len([r for r in rows if r.target_table == "world_truck_snapshots"]) == 2


def test_two_squads_of_one_owner_are_two_rows() -> None:
    other = copy.deepcopy(TRUCK)
    other["uuid"] = 1420304700000000098
    other["marchInfo"]["squadNo"] = 2
    other["marchInfo"]["power"] = 98000000

    assert sorted(r.row["squad_no"] for r in squads(listed(TRUCK, other))) == [1, 2]


def test_the_same_squad_on_another_day_is_another_key() -> None:
    tomorrow = datetime(2026, 11, 10, 21, 1, tzinfo=UTC)

    (a,) = squads(listed(TRUCK))
    (b,) = squads(listed(TRUCK, at=tomorrow))

    assert a.idempotency_key != b.idempotency_key


def test_the_committed_fixture_parses() -> None:
    rows = world_trucks.normalize_list(load_observation("train.list/squads_v1.json"))
    found = squads(rows)

    # Two trucks, one of which names a squad (squadNo 4 with no power does not).
    assert len([r for r in rows if r.target_table == "world_truck_snapshots"]) == 2
    assert [(r.row["squad_no"], r.row["power"], len(r.row["heroes"])) for r in found] == [
        (1, 122937533, 5)
    ]
