"""alliance.rank normalizer against the REAL payload shape (S14-PR3)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import alliance_rank
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("alliance.rank") is alliance_rank.normalize


def test_local_ranking() -> None:
    observation = load_observation("alliance.rank/local_580_v1.json")
    rows = alliance_rank.normalize(observation)

    assert len(rows) == 41
    assert {r.target_table for r in rows} == {"alliance_snapshots"}
    assert len({r.idempotency_key for r in rows}) == 41
    assert {r.row["server_id"] for r in rows} == {580}

    top = rows[0].row
    assert top["rank"] == 1
    assert top["name"] == "Alliance01"
    assert top["code"] == "A001"
    assert top["power"] == 15981622619
    assert top["member_count"] == 93
    # leader is a display name in this response, never a uid.
    assert "leader" in top["raw"]

    # Cross-fixture identity: the local #1 is the same alliance as the
    # al.rank roster fixture (93 members there too).
    roster = load_observation("al.rank/cbfw_roster_v1.json")
    assert top["external_id"] == roster.payload["allianceId"]
    assert rows[0].entity_refs["alliance"]["name"] == "Alliance01"


def test_cross_server_ranking() -> None:
    observation = load_observation("alliance.rank/cross_group_v1.json")
    rows = alliance_rank.normalize(observation)

    assert len(rows) == 100
    # Subject server comes from each entry, spanning the whole group —
    # provenance stays collected_from_server_id (spec 11.2).
    servers = {r.row["server_id"] for r in rows}
    assert servers == {577, 578, 579, 580, 581, 582, 583, 584}
    assert all(r.row["collected_from_server_id"] == 580 for r in rows)


def test_null_and_missing_optionals() -> None:
    rows = alliance_rank.normalize(load_observation("alliance.rank/ranking_nulls_v1.json"))
    assert len(rows) == 2
    bare = rows[0].row
    assert bare["name"] is None
    assert bare["power"] is None
    # No serverId → falls back to the observing server.
    assert bare["server_id"] == 580


def test_malformed_payload_rejected() -> None:
    with pytest.raises(ValidationError):
        alliance_rank.normalize(load_observation("alliance.rank/ranking_malformed_v1.json"))


def test_keys_deterministic_across_calls() -> None:
    observation = load_observation("alliance.rank/local_580_v1.json")
    first = [r.idempotency_key for r in alliance_rank.normalize(observation)]
    second = [r.idempotency_key for r in alliance_rank.normalize(observation)]
    assert first == second
