"""server.rank normalizer against the REAL payload shape (S14-PR5)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import server_rank
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("server.rank") is server_rank.normalize


def test_cross_server_ranking() -> None:
    observation = load_observation("server.rank/group_top150_v1.json")
    rows = server_rank.normalize(observation)

    assert len(rows) == 150
    assert {r.target_table for r in rows} == {"player_snapshots"}
    assert len({r.idempotency_key for r in rows}) == 150

    # The response the subject-vs-provenance rule exists for: one capture
    # from 580 carrying players from every server in the group.
    assert {r.row["server_id"] for r in rows} == {577, 578, 579, 580, 581, 582, 583, 584}
    assert all(r.row["collected_from_server_id"] == 580 for r in rows)

    top = rows[0].row
    assert top["rank"] == 1
    assert top["game_uid"] == 9629347793000578
    assert top["server_id"] == 578
    assert top["power"] == 1125927821
    assert top["hq_level"] == 45
    # This response names the alliance but never gives its id.
    assert top["alliance_external_id"] is None
    assert top["raw"]["allianceName"] == "Alliance01"
    # No kill counts in a power ranking — missing stays missing (FR-ACT-004).
    assert top["kills"] is None


def test_hq_levels_are_main_city_not_account_level() -> None:
    rows = server_rank.normalize(load_observation("server.rank/group_top150_v1.json"))
    levels = {r.row["hq_level"] for r in rows}
    assert min(levels) >= 25
    assert max(levels) <= 50


def test_null_and_missing_optionals() -> None:
    rows = server_rank.normalize(load_observation("server.rank/ranking_nulls_v1.json"))
    assert len(rows) == 2
    bare = rows[0].row
    assert bare["name"] is None
    assert bare["power"] is None
    # No serverId → derived from the uid's embedded server suffix (D-1).
    assert bare["server_id"] == 583


def test_malformed_payload_rejected() -> None:
    with pytest.raises(ValidationError):
        server_rank.normalize(load_observation("server.rank/ranking_malformed_v1.json"))
