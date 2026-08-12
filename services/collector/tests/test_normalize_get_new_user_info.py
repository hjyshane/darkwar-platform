"""get.new.user.info normalizer against the REAL payload shape (S14-PR6)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import get_new_user_info, server_rank
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("get.new.user.info") is get_new_user_info.normalize


def test_profile_with_verified_six_power_sum() -> None:
    observation = load_observation("get.new.user.info/profile_578_v1.json")
    rows = get_new_user_info.normalize(observation)

    assert len(rows) == 7
    row = rows[0].row
    assert rows[0].target_table == "player_detail_snapshots"
    assert row["game_uid"] == 9629347793000578
    assert row["server_id"] == 578
    assert row["power_total"] == 1125927821

    # FR-CORE-004 verified against a real profile, not assumed.
    assert set(row["power_components"]) == set(get_new_user_info.POWER_COMPONENTS)
    assert sum(row["power_components"].values()) == row["power_total"]
    assert row["components_sum_matches"] is True

    # Battle stats stay in raw until they earn typed columns.
    assert row["raw"]["battleWin"] == 21940
    assert row["raw"]["armyKill"] == 5879342


def test_six_component_rows_one_per_metric() -> None:
    """1.1.0: the decomposition reaches the table the trend chart reads."""
    observation = load_observation("get.new.user.info/profile_578_v1.json")
    rows = get_new_user_info.normalize(observation)
    components = [r for r in rows if r.target_table == "player_component_power_snapshots"]

    by_metric = {r.row["metric"]: r.row for r in components}
    assert set(by_metric) == set(get_new_user_info.COMPONENT_METRICS.values())

    # heroPower/petPower land on the BOARD metrics — same fact, another route
    # (0018 pinned the equality), told apart by source_command.
    assert by_metric["hero_power_total"]["power"] == 103477400
    assert by_metric["pet_power_total"]["power"] == 17943772
    assert by_metric["building_power"]["power"] == 79726100
    assert by_metric["science_power"]["power"] == 110529309
    assert by_metric["army_power"]["power"] == 775623540
    assert by_metric["mod_car_power"]["power"] == 38627700

    for row in by_metric.values():
        # A profile open has no ranking behind it and no board.
        assert row["rank"] is None
        assert row["board_type"] is None
        assert row["unit_id"] is None
        assert row["game_uid"] == 9629347793000578
        assert row["source_command"] == "get.new.user.info"


def test_component_rows_do_not_collide() -> None:
    """Each metric carries its own idempotency discriminator. They hash the
    same observation, so without one the unique index would keep whichever
    row arrived first and the other five figures would silently never exist."""
    rows = get_new_user_info.normalize(load_observation("get.new.user.info/profile_578_v1.json"))
    keys = [r.idempotency_key for r in rows]
    assert len(keys) == len(set(keys))

    # And a replay of the same observation produces the same keys, so the
    # sync path updates rather than duplicates.
    again = get_new_user_info.normalize(load_observation("get.new.user.info/profile_578_v1.json"))
    assert keys == [r.idempotency_key for r in again]


def test_profile_is_the_same_player_as_the_top_ranked_entry() -> None:
    """Cross-fixture identity: this capture profiled the #1 ranked player,
    and the uid mapping preserves that across both fixtures."""
    profile = get_new_user_info.normalize(
        load_observation("get.new.user.info/profile_578_v1.json")
    )[0].row
    ranking = server_rank.normalize(load_observation("server.rank/group_top150_v1.json"))
    top = ranking[0].row
    assert profile["game_uid"] == top["game_uid"]
    assert profile["power_total"] == top["power"]
    assert profile["server_id"] == top["server_id"]


def test_missing_component_leaves_verification_unknown() -> None:
    rows = get_new_user_info.normalize(
        load_observation("get.new.user.info/profile_partial_v1.json")
    )
    row = rows[0].row
    assert len(row["power_components"]) == 3
    # Unknown, not False: we cannot verify a sum we did not fully observe.
    assert row["components_sum_matches"] is None

    # A missing field yields NO row, not a null-power row — "we did not
    # observe this" and "this is zero" are different claims.
    metrics = {
        r.row["metric"] for r in rows if r.target_table == "player_component_power_snapshots"
    }
    assert metrics == {"army_power", "hero_power_total", "building_power"}


def test_disagreeing_components_are_recorded_not_raised() -> None:
    rows = get_new_user_info.normalize(
        load_observation("get.new.user.info/profile_mismatch_v1.json")
    )
    assert rows[0].row["components_sum_matches"] is False
    # The mismatch is recorded on the detail row; it does not suppress the
    # component rows, because each figure is the game's own claim.
    assert sum(r.target_table == "player_component_power_snapshots" for r in rows) == 6


def test_malformed_payload_rejected() -> None:
    with pytest.raises(ValidationError):
        get_new_user_info.normalize(load_observation("get.new.user.info/profile_malformed_v1.json"))
