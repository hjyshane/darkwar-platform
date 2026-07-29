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

    assert len(rows) == 1
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


def test_disagreeing_components_are_recorded_not_raised() -> None:
    rows = get_new_user_info.normalize(
        load_observation("get.new.user.info/profile_mismatch_v1.json")
    )
    assert rows[0].row["components_sum_matches"] is False


def test_malformed_payload_rejected() -> None:
    with pytest.raises(ValidationError):
        get_new_user_info.normalize(load_observation("get.new.user.info/profile_malformed_v1.json"))
