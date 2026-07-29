"""user.get.arena.info normalizer against the REAL payload shape (S14-PR2).

top100_580v582_v1.json is extracted from darkwar_arena_match.pcapng by
`dw-collector extract-fixture` (sanitized; see protocol-fixtures/manifests).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from dw_collector.normalize import arena
from tests.conftest import load_observation


def test_header_and_entries() -> None:
    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
    rows = arena.normalize(observation)

    header = rows[0]
    entries = rows[1:]
    assert header.target_table == "arena_snapshots"
    assert len(entries) == 100
    assert {r.target_table for r in entries} == {"arena_entries"}

    # The game's own startTime IS Monday 02:00 UTC — the third independent
    # confirmation of the reset rule.
    week_start = datetime.fromisoformat(header.row["week_start"])
    assert week_start == datetime(2026, 7, 27, 2, tzinfo=UTC)
    assert header.row["entry_count"] == 100
    assert header.row["server_id"] == 580
    # Header raw keeps the unpromoted fields but never the entry list.
    assert header.row["raw"]["fightServers"] == "580;582"
    assert "rankArr" not in header.row["raw"]

    parent_id = header.row["snapshot_id"]
    assert all(e.row["arena_snapshot_id"] == parent_id for e in entries)

    top = entries[0].row
    assert top["rank"] == 1
    assert top["game_uid"] == 9409201957000580
    assert top["score"] == 1213
    assert top["defense_power"] == 296837700
    assert top["server_id"] == 580
    # Cross-server matchup: entries carry their own subject server.
    assert {e.row["server_id"] for e in entries} == {580, 582}
    assert "alName" in top["raw"]


def test_null_and_missing_optionals() -> None:
    observation = load_observation("user.get.arena.info/arena_nulls_v1.json")
    rows = arena.normalize(observation)

    header, entries = rows[0], rows[1:]
    assert len(entries) == 3
    # No startTime → week derived from capture time.
    assert datetime.fromisoformat(header.row["week_start"]) == datetime(2026, 7, 27, 2, tzinfo=UTC)
    bare = entries[0].row
    assert bare["score"] is None
    assert bare["defense_power"] is None
    # serverId missing → derived from the uid's embedded server suffix.
    assert bare["server_id"] == 582


def test_malformed_payload_rejected() -> None:
    observation = load_observation("user.get.arena.info/arena_malformed_v1.json")
    with pytest.raises(ValidationError):
        arena.normalize(observation)


def test_replay_regenerates_identical_parent_pk() -> None:
    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
    first = arena.normalize(observation)[0].row["snapshot_id"]
    second = arena.normalize(observation)[0].row["snapshot_id"]
    assert first == second
