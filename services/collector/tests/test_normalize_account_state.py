"""init — the logged-in account's own inventory and levels.

What this pins: one row per login, keyed on the account in `user`, holding
the five lists the planner reads as compact maps — and nothing else from the
login response, because the rest of it is a whole account's private state.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import pipeline, registry
from dw_collector.normalize import account_state
from dw_collector.sanitize import sanitize_init
from tests.conftest import load_observation

LOGIN = "init/login_v1.json"


def test_registered() -> None:
    assert registry.get("init") is account_state.normalize


def test_one_row_for_the_account_that_logged_in() -> None:
    (row,) = account_state.normalize(load_observation(LOGIN))

    assert row.target_table == "account_state_snapshots"
    assert row.row["game_uid"] == 9473022442000580
    assert row.row["server_id"] == 580
    assert row.entity_refs["player"] == {
        "game_uid": 9473022442000580,
        "server_id": 580,
        "name": "Player01",
    }


def test_inventory_is_a_map_of_item_to_count() -> None:
    (row,) = account_state.normalize(load_observation(LOGIN))
    items = row.row["items"]

    assert len(items) == 8
    assert items["200202"] == 11
    assert items["300001"] == 1398
    assert all(isinstance(count, int) for count in items.values())


def test_levels_are_maps_of_id_to_level() -> None:
    (row,) = account_state.normalize(load_observation(LOGIN))

    assert len(row.row["buildings"]) == 8
    assert len(row.row["hero_intensify"]) == 8
    assert len(row.row["mod_car_equips"]) == 6
    for field in ("buildings", "hero_intensify", "mod_car_equips"):
        assert all(key.isdigit() for key in row.row[field])
        assert all(isinstance(level, int) for level in row.row[field].values())


def test_research_tree_is_a_map_of_research_to_level() -> None:
    (row,) = account_state.normalize(load_observation(LOGIN))
    science = row.row["science"]

    assert len(science) == 8
    assert science["1409300"] == 1
    assert science["1810200"] == 10


def test_hero_gear_keeps_who_wears_it() -> None:
    (row,) = account_state.normalize(load_observation(LOGIN))

    assert row.row["hero_equips"][0] == {
        "equipId": 410400,
        "heroId": 11001,
        "level": 100,
        "promote": 7,
    }


def test_raw_is_only_what_the_parser_reads() -> None:
    """The full login response holds linked sign-in names, mail and purchase
    state. None of it may reach the cloud, so `raw` is the parsed subset."""
    observation = load_observation(LOGIN)
    private = {
        **observation.payload,
        "bind_account_name": {"appleName": "someone@example.com"},
        "playerName": "Someone",
    }
    (row,) = account_state.normalize(observation.model_copy(update={"payload": private}))

    assert set(row.row["raw"]) == {
        "user",
        "items",
        "buildings",
        "hero_equips",
        "hero_intensify",
        "mod_car_equips",
        "science",
    }
    assert row.row["raw"]["user"] == {"uid": "9473022442000580", "serverId": 580}
    assert "someone@example.com" not in str(row.row)


def test_optional_lists_may_be_missing() -> None:
    """A login that carries only the account yields empty maps, not nulls:
    "the account owns nothing" and "we did not see" are told apart by the
    row existing at all."""
    observation = load_observation(LOGIN)
    bare = observation.model_copy(
        update={"payload": {"user": {"uid": "9123456789000581", "serverId": 581}}}
    )

    (row,) = account_state.normalize(bare)

    assert row.row["server_id"] == 581
    assert row.row["items"] == {}
    assert row.row["buildings"] == {}
    assert row.row["hero_equips"] == []


def test_unworn_gear_has_no_hero() -> None:
    observation = load_observation(LOGIN)
    payload = {
        **observation.payload,
        "heroEquips": [{"equipId": 410400, "level": 5, "promote": 0}],
    }

    (row,) = account_state.normalize(observation.model_copy(update={"payload": payload}))

    assert row.row["hero_equips"] == [{"equipId": 410400, "heroId": None, "level": 5, "promote": 0}]


def test_entries_without_numbers_are_skipped() -> None:
    observation = load_observation(LOGIN)
    payload = {
        **observation.payload,
        "items": [{"itemId": "x", "count": 1}, {"itemId": "7", "count": True}, "junk"],
        "building_new": [{"bId": 1001, "lv": "9"}],
    }

    (row,) = account_state.normalize(observation.model_copy(update={"payload": payload}))

    assert row.row["items"] == {}
    assert row.row["buildings"] == {"1001": 9}


def test_malformed_uid_rejected() -> None:
    with pytest.raises(ValidationError):
        account_state.normalize(load_observation("init/login_malformed_v1.json"))


def test_replay_is_idempotent_and_logins_are_distinct() -> None:
    observation = load_observation(LOGIN)
    (first,) = account_state.normalize(observation)
    (again,) = account_state.normalize(observation)
    later = observation.model_copy(
        update={
            "captured_at": observation.captured_at.replace(minute=59),
            "payload": {**observation.payload, "items": [{"itemId": "200202", "count": 12}]},
        }
    )
    (next_login,) = account_state.normalize(later)

    assert first.idempotency_key == again.idempotency_key
    assert first.idempotency_key != next_login.idempotency_key


def test_the_sanitizer_keeps_exactly_what_the_parser_reads() -> None:
    """A fixture cut by sanitize_init must parse to the same state as the
    payload it came from, for every entry it kept."""
    observation = load_observation(LOGIN)
    resanitized = sanitize_init(observation.payload)

    assert account_state.account_state(resanitized) == account_state.account_state(
        observation.payload
    )
    assert resanitized["user"]["name"] == "Player01"


def test_no_activity_facts() -> None:
    rows = pipeline.process(load_observation(LOGIN))

    assert {r.target_table for r in rows} == {"account_state_snapshots"}
