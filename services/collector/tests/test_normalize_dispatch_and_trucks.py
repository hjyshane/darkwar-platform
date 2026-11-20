"""Hero dispatch missions on the map, and Dark Syndicate trucks (0254).

What this pins: a started mission tile (object type 21) becomes one row with the
game's own start and finish instants, an unstarted one becomes nothing, and the
three truck commands each give the fields the view joins on. The payloads are
hand-authored from the shapes captured on 2026-10-09, with invented people.
"""

from __future__ import annotations

import base64
import uuid
from datetime import UTC, datetime
from typing import Any

from dw_collector import registry
from dw_collector.gamedata.dispatch import ORANGE_SKILL_BOOK, _books, _spec
from dw_collector.models import Observation
from dw_collector.normalize import world_map, world_trucks
from dw_collector.protocol.worldmap import B64_PREFIX
from tests.conftest import load_observation

COLLECTOR = uuid.UUID("00000000-0000-0000-0000-000000000001")
CAPTURED = datetime(2026, 10, 9, 4, 25, tzinfo=UTC)
OWNER = "1177855891000580"
ALLIANCE = "95deb37d1a0b4b8ba575ba3a3f324dac"
STARTED_MS = 1791519212576
FINISH_MS = 1791526412576


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


def mission_point(
    *, x: int = 446, y: int = 393, started: bool = True, mission_id: int = 1500504
) -> str:
    inner = _v(1, 1420304694173123724) + _v(2, mission_id)
    inner += _b(3, OWNER.encode()) + _b(4, ALLIANCE.encode())
    if started:
        inner += _v(5, STARTED_MS) + _v(6, FINISH_MS)
    point = _v(1, y * 1000 + x + 1) + _v(2, 21) + _b(101, inner) + _v(103, 580)
    return B64_PREFIX + base64.b64encode(point).decode()


def viewport(*points: str) -> Observation:
    return Observation(
        observation_id=uuid.uuid4(),
        collector_id=COLLECTOR,
        source_command="world.get.new",
        captured_at=CAPTURED,
        collected_from_server_id=580,
        payload={"x": 450, "y": 390, "viewLvl": 1, "serverId": 580, "points": list(points)},
    )


def command(name: str, payload: dict[str, Any]) -> Observation:
    return Observation(
        observation_id=uuid.uuid4(),
        collector_id=COLLECTOR,
        source_command=name,
        captured_at=CAPTURED,
        collected_from_server_id=580,
        payload=payload,
    )


def mission_rows(observation: Observation) -> list[Any]:
    return [
        r
        for r in world_map.normalize(observation)
        if r.target_table == "dispatch_mission_snapshots"
    ]


def test_a_started_mission_keeps_the_games_own_instants() -> None:
    (row,) = mission_rows(viewport(mission_point()))

    assert row.row["mission_id"] == 1500504
    assert row.row["mission_uuid"] == "1420304694173123724"
    assert row.row["owner_game_uid"] == int(OWNER)
    assert row.row["alliance_external_id"] == ALLIANCE
    assert (row.row["x"], row.row["y"], row.row["server_id"]) == (446, 393, 580)
    assert datetime.fromisoformat(row.row["started_at"]).timestamp() * 1000 == STARTED_MS
    assert datetime.fromisoformat(row.row["ends_at"]).timestamp() * 1000 == FINISH_MS


def test_an_unstarted_mission_cannot_be_plundered_so_it_is_not_written() -> None:
    assert mission_rows(viewport(mission_point(started=False))) == []


def test_the_same_mission_from_two_different_viewports_is_one_key() -> None:
    """Overlapping pans re-list the mission; the key hashes its own tile, not
    the viewport, so the row is stored once a day."""
    first = mission_rows(viewport(mission_point()))[0].idempotency_key
    again = mission_rows(viewport(mission_point(x=447, y=394), mission_point()))
    keys = {r.idempotency_key for r in again}

    assert first in keys


def test_reward_specs_count_orange_skill_books() -> None:
    steal = _spec("252071;7;2|230101;7;6|24;3;81600")

    assert _books(steal) == 6
    assert _books(_spec("252071;7;1|24;3;106800")) == 0
    # A resource with the same id number is not the book.
    assert _books(_spec(f"{ORANGE_SKILL_BOOK};3;5")) == 0
    assert _spec("garbage|;;") == []


TRUCK = {
    "abbr": "HDVB",
    "allianceId": "51ddc9f2980b46499713d646e38cb052",
    "arriveTime": 1791517221235,
    "sendTime": 1791500858683,
    "cfgId": 83,
    "completeness": 0.75,
    "extraGoods": {
        "cur": [
            {"type": 7, "value": {"id": "210454", "num": 1}},
            {"type": 7, "value": {"id": "200034", "num": 50}},
        ]
    },
    "marchInfo": {
        "robTimes": 1,
        "lastPosIndex": 2,
        "lastSendTime": 1791500900000,
        "nextEndTime": 1791501300000,
    },
    "stationList": [43, 56, 60, 54],
    "name": "Anne Example",
    "ownerId": "1651854724000581",
    "quality": 5,
    "serverId": 581,
    "startPos": 706119,
    "uuid": 1420304722757305705,
}


def test_registered() -> None:
    assert registry.get("train.list") is world_trucks.normalize_list
    assert registry.get("get.train.info") is world_trucks.normalize_info
    assert registry.get("push.world.march.new") is world_trucks.normalize_march


def test_a_listed_truck_carries_its_cargo_and_hero_fragments() -> None:
    (row,) = world_trucks.normalize_list(command("train.list", {"ls": [TRUCK]}))

    assert row.target_table == "world_truck_snapshots"
    assert row.row["truck_uuid"] == "1420304722757305705"
    assert row.row["server_id"] == 581
    assert (row.row["quality"], row.row["rob_times"], row.row["hero_fragments"]) == (5, 1, 1)
    assert row.row["goods"] == [{"id": "210454", "num": 1}, {"id": "200034", "num": 50}]
    # A list says nothing about where the truck is.
    assert "segment_end_at" not in row.row


def test_a_truck_with_no_hero_fragment_says_zero_not_unknown() -> None:
    plain = {**TRUCK, "extraGoods": {"cur": [{"type": 7, "value": {"id": "200034", "num": 5}}]}}
    (row,) = world_trucks.normalize_list(command("train.list", {"ls": [plain]}))

    assert row.row["hero_fragments"] == 0


def test_an_opened_truck_is_the_same_row_as_a_listed_one() -> None:
    (listed,) = world_trucks.normalize_list(command("train.list", {"ls": [TRUCK]}))
    (opened,) = world_trucks.normalize_info(command("get.train.info", {"train": TRUCK}))

    assert {k: v for k, v in listed.row.items() if k in ("truck_uuid", "goods", "quality")} == {
        k: v for k, v in opened.row.items() if k in ("truck_uuid", "goods", "quality")
    }


def march(kind: int = 15) -> dict[str, Any]:
    return {
        "type": kind,
        "uuid": 1420304694261204186,
        "ownerName": "Anne Example",
        "ownerUid": "1651854724000581",
        "allianceAbbr": "HDVB",
        "startPos": 395436,
        "targetPos": 485422,
        "startTime": 1791520098184,
        "endTime": 1791520462513,
        "train": {
            "uuid": 1420304722757305705,
            "quality": 5,
            "cfgId": 83,
            "completeness": 1.0,
            "arriveTime": 1791536854299,
            "sendTime": 1791520098184,
            "serverId": 581,
            "marchInfo": {"robTimes": 0},
        },
    }


def test_a_truck_march_gives_the_leg_and_no_cargo() -> None:
    (row,) = world_trucks.normalize_march(command("push.world.march.new", march()))

    assert row.row["truck_uuid"] == "1420304722757305705"
    assert (row.row["start_pos"], row.row["target_pos"]) == (395436, 485422)
    assert row.row["segment_end_at"] is not None
    assert row.row["goods"] is None
    assert row.row["hero_fragments"] is None


def test_other_marches_are_not_trucks() -> None:
    assert world_trucks.normalize_march(command("push.world.march.new", march(kind=3))) == []
    bare = {k: v for k, v in march().items() if k != "train"}
    assert world_trucks.normalize_march(command("push.world.march.new", bare)) == []


def test_a_list_with_a_broken_entry_keeps_the_good_ones() -> None:
    rows = world_trucks.normalize_list(
        command("train.list", {"ls": [{"uuid": "nope"}, TRUCK, "junk"]})
    )

    assert len(rows) == 1


def test_the_committed_fixtures_parse() -> None:
    listed = world_trucks.normalize_list(load_observation("train.list/trucks_v1.json"))
    opened = world_trucks.normalize_info(load_observation("get.train.info/truck_v1.json"))
    leg = world_trucks.normalize_march(load_observation("push.world.march.new/truck_march_v1.json"))

    assert [r.row["hero_fragments"] for r in listed] == [1, 0]
    assert opened[0].row["server_id"] == 585
    assert leg[0].row["target_pos"] == 485422


def test_a_listed_truck_carries_its_route_and_current_leg() -> None:
    (row,) = world_trucks.normalize_list(command("train.list", {"ls": [TRUCK]}))

    assert row.row["stations"] == [43, 56, 60, 54]
    assert row.row["station_index"] == 2
    assert datetime.fromisoformat(row.row["leg_end_at"]).timestamp() * 1000 == 1791501300000
    assert datetime.fromisoformat(row.row["leg_start_at"]) < datetime.fromisoformat(
        row.row["leg_end_at"]
    )


def test_a_truck_without_a_route_writes_null_route_columns() -> None:
    bare = {k: v for k, v in TRUCK.items() if k != "stationList"}
    (listed,) = world_trucks.normalize_list(command("train.list", {"ls": [bare]}))
    (leg,) = world_trucks.normalize_march(command("push.world.march.new", march()))
    route = {"stations", "station_index", "leg_start_at", "leg_end_at"}

    assert listed.row["stations"] is None
    assert route <= set(listed.row)
    assert route <= set(leg.row)


# --- 0334 / parser 1.7.0: a mission is on the map it stands on --------------


def test_a_migrants_mission_is_on_the_map_not_the_server_they_left() -> None:
    """The owner's uid ends in 571; the mission stands on 580's map. 1.6.0
    filed it under 571, so 580's plunder list never showed it."""
    point = mission_point()
    # Same tile, an owner born elsewhere.
    raw = base64.b64decode(point[len(B64_PREFIX) :])
    raw = raw.replace(OWNER.encode(), b"1177855891000571")
    migrant = B64_PREFIX + base64.b64encode(raw).decode()

    (row,) = mission_rows(viewport(migrant))

    assert row.row["server_id"] == 580
    assert row.row["owner_game_uid"] == 1177855891000571


# --- parser 1.2.0: trucks in the marches drawn on whatever map is open -------

VIEWPORT_MARCHES = "push.world.march.world.get.new/truck_marches_v1.json"


def test_the_viewport_march_push_is_registered() -> None:
    assert registry.get("push.world.march.world.get.new") is world_trucks.normalize_viewport_marches


def test_every_truck_in_a_viewport_push_gives_its_leg() -> None:
    rows = world_trucks.normalize_viewport_marches(load_observation(VIEWPORT_MARCHES))

    # Two trucks; the ordinary march is not one, and the truck listed twice is
    # one row.
    assert sorted(r.row["truck_uuid"] for r in rows) == [
        "1438426303605916704",
        "1438426303605916799",
    ]
    driver = next(r for r in rows if r.row["truck_uuid"] == "1438426303605916704")
    assert driver.row["server_id"] == 566
    assert (driver.row["start_pos"], driver.row["target_pos"]) == (946502, 928389)
    assert driver.row["segment_end_at"] is not None
    assert driver.row["owner_game_uid"] == "1000000003000571"
    assert driver.row["rob_times"] == 1
    assert driver.row["goods"] is None
    assert driver.row["source_command"] == "push.world.march.world.get.new"


def test_a_leg_seen_by_both_pushes_is_one_key() -> None:
    """The same leg of the same truck, pushed alone and inside a viewport's
    list: the view joins on the truck, and two rows of one fact are noise."""
    observation = load_observation(VIEWPORT_MARCHES)
    entry = observation.payload["marchInfos"][1]
    (alone,) = world_trucks.normalize_march(
        command("push.world.march.new", entry).model_copy(
            update={"captured_at": observation.captured_at}
        )
    )
    listed = world_trucks.normalize_viewport_marches(
        observation.model_copy(update={"collector_id": COLLECTOR})
    )

    assert alone.idempotency_key in {r.idempotency_key for r in listed}


def test_a_viewport_push_with_no_list_gives_nothing() -> None:
    malformed = load_observation("push.world.march.world.get.new/truck_marches_malformed_v1.json")
    assert world_trucks.normalize_viewport_marches(malformed) == []
    assert world_trucks.normalize_viewport_marches(command("x", {"marchInfos": [None, 3]})) == []


def test_the_viewport_push_replays_to_the_same_keys() -> None:
    observation = load_observation(VIEWPORT_MARCHES)
    first = [r.idempotency_key for r in world_trucks.normalize_viewport_marches(observation)]
    second = [r.idempotency_key for r in world_trucks.normalize_viewport_marches(observation)]

    assert first == second


# --- 0338 / parser 1.8.0: a viewport says which missions were in it ---------


def viewport_row(observation: Observation) -> Any:
    (row,) = [
        r for r in world_map.normalize(observation) if r.target_table == "world_viewport_snapshots"
    ]
    return row


def test_the_viewport_names_the_missions_in_its_window() -> None:
    """A mission row is written once a day, so a later pan says nothing new
    through it. The viewport row is what records that the mission was still
    there - started or not, since an unstarted one is still standing."""
    row = viewport_row(viewport(mission_point(), mission_point(x=447, y=394, started=False)))

    assert row.row["raw"] == {"missions": ["1420304694173123724"] * 2}


def test_a_viewport_with_no_mission_says_so() -> None:
    """An empty list, not a missing key: "looked here, none" is what lets a
    mission that has gone be dropped (0338)."""
    assert viewport_row(viewport()).row["raw"] == {"missions": []}
