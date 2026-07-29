"""get.user.info.multi normalizer against the REAL payload shape (S14-PR7)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import get_new_user_info, get_user_info_multi, server_rank
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("get.user.info.multi") is get_user_info_multi.normalize


def test_public_summary() -> None:
    observation = load_observation("get.user.info.multi/summary_578_v1.json")
    rows = get_user_info_multi.normalize(observation)

    assert len(rows) == 1
    row = rows[0].row
    assert rows[0].target_table == "player_snapshots"
    assert row["game_uid"] == 9629347793000578
    assert row["server_id"] == 578
    assert row["power"] == 1125927821
    assert row["kills"] == 5879342
    # mainBuildingLevel is the HQ level; `level` (1) is something else.
    assert row["hq_level"] == 45
    # The one summary response that carries the alliance id.
    assert row["alliance_external_id"] == "177d4c89c4b1d22f9f6b742ba2d30c01"
    # rank reads 0 in every capture — not a position, not an R-grade.
    assert row["rank"] is None
    assert row["raw"]["rank"] == 0


def test_same_player_across_three_fixtures() -> None:
    """This capture ranked, profiled, and summarized one player; the uid and
    alliance mappings keep that identity intact across all three fixtures."""
    summary = get_user_info_multi.normalize(
        load_observation("get.user.info.multi/summary_578_v1.json")
    )[0].row
    profile = get_new_user_info.normalize(
        load_observation("get.new.user.info/profile_578_v1.json")
    )[0].row
    top = server_rank.normalize(load_observation("server.rank/group_top150_v1.json"))[0].row

    assert summary["game_uid"] == profile["game_uid"] == top["game_uid"]
    assert summary["power"] == profile["power_total"] == top["power"]
    assert summary["alliance_external_id"] == profile["raw"]["allianceId"]


def test_null_and_missing_optionals() -> None:
    rows = get_user_info_multi.normalize(
        load_observation("get.user.info.multi/summary_nulls_v1.json")
    )
    assert len(rows) == 2
    bare = rows[0].row
    assert bare["name"] is None
    assert bare["power"] is None
    assert bare["alliance_external_id"] is None
    # No serverId → derived from the uid's embedded server suffix (D-1).
    assert bare["server_id"] == 584


def test_malformed_payload_rejected() -> None:
    with pytest.raises(ValidationError):
        get_user_info_multi.normalize(
            load_observation("get.user.info.multi/summary_malformed_v1.json")
        )
