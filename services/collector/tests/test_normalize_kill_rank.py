"""kill.rank — the kills that server.rank does not report."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import kill_rank, server_rank
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("kill.rank") is kill_rank.normalize


def test_cross_server_kill_ranking() -> None:
    observation = load_observation("kill.rank/group_kills_v1.json")
    rows = kill_rank.normalize(observation)

    assert len(rows) == 150
    assert {r.target_table for r in rows} == {"player_snapshots"}
    assert {r.row["server_id"] for r in rows} == {577, 578, 579, 580, 581, 582, 583, 584}

    top = rows[0].row
    assert top["rank"] == 1
    assert top["kills"] == 11430164
    assert top["server_id"] == 578
    # This response reports no power and no level; leaving them null is what
    # lets the summary trigger coalesce rather than erase.
    assert top["power"] is None
    assert top["hq_level"] is None
    # It names the alliance without identifying it.
    assert top["alliance_external_id"] is None
    assert top["raw"]["allianceName"]

    kills = [r.row["kills"] for r in rows]
    assert kills == sorted(kills, reverse=True)


def test_source_command_disambiguates_the_rank_column() -> None:
    """Both rankings write player_snapshots.rank; only source_command says
    which ranking a position belongs to."""
    kills = kill_rank.normalize(load_observation("kill.rank/group_kills_v1.json"))
    power = server_rank.normalize(load_observation("server.rank/group_top150_v1.json"))

    assert kills[0].row["source_command"] == "kill.rank"
    assert power[0].row["source_command"] == "server.rank"
    assert kills[0].row["rank"] == power[0].row["rank"] == 1
    # Same position, different meaning, and different leaders.
    assert kills[0].row["game_uid"] != power[0].row["game_uid"]
    # Keys cannot collide even for a player in both rankings on the same day.
    assert {r.idempotency_key for r in kills}.isdisjoint({r.idempotency_key for r in power})


def test_null_kills_and_missing_server() -> None:
    rows = kill_rank.normalize(load_observation("kill.rank/kills_nulls_v1.json"))
    assert len(rows) == 2
    assert rows[0].row["kills"] is None
    # serverId absent → derived from the uid suffix (D-1).
    assert rows[0].row["server_id"] == 583


def test_malformed_uid_rejected() -> None:
    with pytest.raises(ValidationError):
        kill_rank.normalize(load_observation("kill.rank/kills_malformed_v1.json"))
