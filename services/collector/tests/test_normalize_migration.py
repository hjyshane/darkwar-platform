"""The state-migration offer and the rules behind it (0250).

What this pins:

  * `init`'s migration config is read the way it stands on 2026-10-08: four
    power cutoffs 10M / 15M / 25M / 35M, four bracket groups, and the screen's
    switch off. The fixture is the real `init` with only those blocks kept.
  * `get.migrate.servers` is read from a HAND-WRITTEN response. The screen was
    not live when the parser was written; the envelope (`list`) and the shape of
    each field are inferred from MigrateServerData.ParseServerData. These tests
    prove the parser is forgiving about shape and loses nothing, not that the
    guesses are right. Replace the fixture with the first real capture.
"""

from __future__ import annotations

from dw_collector import registry
from dw_collector.normalize import account_state, migration_config, migration_servers
from tests.conftest import load_observation

CONFIG = "init/migration_config_v1.json"
SERVERS = "get.migrate.servers/servers_synthetic_v1.json"


def test_registered() -> None:
    assert registry.get("get.migrate.servers") is migration_servers.normalize_servers


def test_the_login_response_carries_the_migration_config() -> None:
    rows = account_state.normalize(load_observation(CONFIG))

    assert [r.target_table for r in rows].count("migration_config_snapshots") == 1


def test_the_four_power_cutoffs_and_their_brackets() -> None:
    (row,) = migration_config.config_rows(load_observation(CONFIG))

    assert row.target_table == "migration_config_snapshots"
    assert row.row["power_tier_floors"] == [10_000_000, 15_000_000, 25_000_000, 35_000_000]
    assert row.row["power_brackets"] == [
        [2_000_000, 4_000_000, 6_000_000, 8_000_000, 10_000_000, 9_999_999_999],
        [3_000_000, 6_000_000, 9_000_000, 12_000_000, 15_000_000, 9_999_999_999],
        [10_000_000, 14_000_000, 18_000_000, 22_000_000, 25_000_000, 9_999_999_999],
        [15_000_000, 20_000_000, 25_000_000, 30_000_000, 35_000_000, 9_999_999_999],
    ]
    # The screen is not live yet; the day it is, this flips and a new row is written.
    assert row.row["new_migrate_on"] is False


def test_the_whole_blocks_survive_in_raw() -> None:
    (row,) = migration_config.config_rows(load_observation(CONFIG))

    assert row.row["raw"]["migration_quota"]["k1"].startswith("1-88;0.6,1.5,12")
    assert row.row["raw"]["aps_migrate_server"]["k6"] == "10000000;15000000;25000000;35000000"


def test_a_login_with_no_migration_config_writes_nothing() -> None:
    observation = load_observation(CONFIG)
    bare = observation.model_copy(update={"payload": {"user": observation.payload["user"]}})

    assert migration_config.config_rows(bare) == []


def test_an_unchanged_config_is_one_row_a_day_and_a_change_is_a_new_one() -> None:
    observation = load_observation(CONFIG)
    (a,) = migration_config.config_rows(observation)
    (same,) = migration_config.config_rows(observation)
    flipped_payload = {**observation.payload, "function_on_config": {"immigration_new": 1}}
    (on,) = migration_config.config_rows(
        observation.model_copy(update={"payload": flipped_payload})
    )

    assert a.idempotency_key == same.idempotency_key
    assert on.idempotency_key != a.idempotency_key
    assert on.row["new_migrate_on"] is True


def test_every_server_in_the_list_is_a_row() -> None:
    rows = migration_servers.normalize_servers(load_observation(SERVERS))

    assert [r.row["server_id"] for r in rows] == [581, 584, 587]
    assert {r.target_table for r in rows} == {"migration_server_snapshots"}


def test_a_servers_seats_and_floors() -> None:
    first = migration_servers.normalize_servers(load_observation(SERVERS))[0].row

    assert first["migrate_left"] == {"1": 20, "2": 15, "3": 8, "4": 5}
    assert first["special_left"] == {"4": 2}
    assert first["power_low_limit"] == [10_000_000, 15_000_000, 25_000_000, 35_000_000]
    assert (first["total_count"], first["use_count"]) == (60, 12)
    assert (first["power_limit"], first["special_power_limit"]) == (30_000_000, 60_000_000)
    assert first["king_uid"] == "1000000000000581"
    # 00:07:21 on the server clock (UTC-2), which is how the game printed it.
    assert first["target_open_at"] == "2026-04-16T02:07:21+00:00"
    # The offering server, not the one the capture was made from.
    assert first["collected_from_server_id"] == 580


def test_shapes_are_read_whichever_way_the_game_sent_them() -> None:
    second = migration_servers.normalize_servers(load_observation(SERVERS))[1].row

    # A string serverId, a list for the floors, empty seat lists, no king.
    assert second["server_id"] == 584
    assert second["power_low_limit"] == [5_000_000, 8_000_000, 12_000_000, 20_000_000]
    assert second["special_left"] == {}
    assert second["king_name"] is None
    assert second["king_uid"] is None


def test_a_field_that_is_not_what_we_expected_is_null_and_still_in_raw() -> None:
    third = migration_servers.normalize_servers(load_observation(SERVERS))[2]

    assert third.row["power_low_limit"] is None
    assert third.row["migrate_left"] is None
    assert third.row["raw"]["powerLowLimit"] == "not;a;list"
    assert third.row["raw"]["migrateLeft"] == "unexpected"


def test_the_list_is_found_wherever_the_envelope_puts_it() -> None:
    observation = load_observation(SERVERS)
    entry = observation.payload["list"][0]

    for payload in (
        {"servers": [entry]},
        {"data": {"serverList": [entry]}},
        entry,
    ):
        rows = migration_servers.normalize_servers(
            observation.model_copy(update={"payload": payload})
        )
        assert [r.row["server_id"] for r in rows] == [581]


def test_a_response_with_no_servers_writes_nothing() -> None:
    observation = load_observation(SERVERS)

    for payload in ({}, {"list": []}, {"list": [{"name": "no id"}]}):
        assert (
            migration_servers.normalize_servers(observation.model_copy(update={"payload": payload}))
            == []
        )


def test_the_same_screen_twice_is_one_row_and_a_moved_seat_is_another() -> None:
    observation = load_observation(SERVERS)
    (a,) = migration_servers.normalize_servers(
        observation.model_copy(update={"payload": {"list": [observation.payload["list"][0]]}})
    )
    again = observation.model_copy(
        update={
            "payload": {"list": [observation.payload["list"][0]]},
            "observation_id": "00000000-0000-4000-8000-00000000f399",
        }
    )
    (b,) = migration_servers.normalize_servers(again)
    moved_entry = {**observation.payload["list"][0], "useCount": 13}
    (c,) = migration_servers.normalize_servers(
        observation.model_copy(update={"payload": {"list": [moved_entry]}})
    )

    assert a.idempotency_key == b.idempotency_key
    assert c.idempotency_key != a.idempotency_key
