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

    # Three rows since 1.1.0: the summary, and the two component figures a profile
    # open turns out to carry.
    assert len(rows) == 3
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


def test_the_profile_carries_the_strongest_hero_and_the_migration_power() -> None:
    """1.1.0. These are the fields that take a hero figure from 8 of our members to
    about 50: the boards only list the top 150, a profile is per player.

    `hero_power_best` is the SAME metric the board writes, on purpose. For the 14
    players present in both sources, maxPower equalled hero_power_best and maxHeroId
    equalled unit_id on 14 of 14 — one fact seen by two routes, and
    `source_command` already records which route this row came by.
    """
    rows = get_user_info_multi.normalize(
        load_observation("get.user.info.multi/summary_578_v1.json")
    )
    components = {row.row["metric"]: row for row in rows[1:]}
    assert set(components) == {"hero_power_best", "migrate_power"}

    hero = components["hero_power_best"].row
    assert components["hero_power_best"].target_table == "player_component_power_snapshots"
    assert hero["power"] == 11658300
    # The hero's id, which resolves to a name and grade through the catalogue.
    assert hero["unit_id"] == 40002
    # No ranking behind a profile open, and no board it came from. 0086 made
    # board_type nullable to say so rather than inventing a board.
    assert hero["rank"] is None
    assert hero["board_type"] is None

    migrate = components["migrate_power"].row
    assert migrate["power"] == 33758958
    # Admin-only lives in the registry (0086), not here: the parser's job is to
    # record the figure, and who may read it is a property of the metric.
    assert migrate["unit_id"] is None


def test_each_component_metric_gets_its_own_key() -> None:
    """Both rows hash the same observation, so without a per-metric discriminator
    the second collides with the first and is dropped as a duplicate — the unique
    index keeps whichever arrived first and the other figure silently never
    exists."""
    rows = get_user_info_multi.normalize(
        load_observation("get.user.info.multi/summary_578_v1.json")
    )
    keys = [row.idempotency_key for row in rows]
    assert len(set(keys)) == len(keys)


def test_a_second_pass_over_one_capture_repeats_its_keys() -> None:
    """Replay must be idempotent: the key hashes the raw payload, so normalising the
    same observation twice produces the same keys and the sync layer updates rather
    than duplicating."""
    observation = load_observation("get.user.info.multi/summary_578_v1.json")
    first = [row.idempotency_key for row in get_user_info_multi.normalize(observation)]
    second = [row.idempotency_key for row in get_user_info_multi.normalize(observation)]
    assert first == second


def test_null_and_missing_optionals() -> None:
    rows = get_user_info_multi.normalize(
        load_observation("get.user.info.multi/summary_nulls_v1.json")
    )
    # Still two: both entries carry maxPower, maxHeroId and migratePower as null, so
    # no component row is emitted for either. "We did not observe this" and "this is
    # zero" are different claims, and a row with a null power would assert the
    # second one.
    assert len(rows) == 2
    assert all(row.target_table == "player_snapshots" for row in rows)
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
