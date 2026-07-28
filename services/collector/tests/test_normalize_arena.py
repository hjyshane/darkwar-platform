from __future__ import annotations

from datetime import UTC, datetime

from dw_collector.normalize import arena
from tests.conftest import load_observation


def test_header_and_entries() -> None:
    observation = load_observation("user.get.arena.info/synthetic_week_v1.json")
    rows = arena.normalize(observation)

    header = rows[0]
    entries = rows[1:]
    assert header.target_table == "arena_snapshots"
    assert len(entries) == 20
    assert {r.target_table for r in entries} == {"arena_entries"}

    week_start = datetime.fromisoformat(header.row["week_start"])
    assert week_start == datetime(2026, 7, 27, 2, tzinfo=UTC)
    assert header.row["entry_count"] == 20
    # Header raw keeps unpromoted payload fields but not the entry list.
    assert header.row["raw"]["season_flag"] == "synthetic"
    assert "entries" not in header.row["raw"]

    # Children point at the deterministic parent PK.
    parent_id = header.row["snapshot_id"]
    assert all(e.row["arena_snapshot_id"] == parent_id for e in entries)

    top = entries[0].row
    assert top["rank"] == 1
    assert top["score"] == 1175
    assert top["raw"]["banner_id"] == 301


def test_replay_regenerates_identical_parent_pk() -> None:
    observation = load_observation("user.get.arena.info/synthetic_week_v1.json")
    first = arena.normalize(observation)[0].row["snapshot_id"]
    second = arena.normalize(observation)[0].row["snapshot_id"]
    assert first == second
