from __future__ import annotations

import pytest

from dw_collector import pipeline
from dw_collector.normalize import arena
from tests.conftest import load_observation


def test_arena_pipeline_emits_participation_facts() -> None:
    observation = load_observation("user.get.arena.info/synthetic_week_v1.json")
    rows = pipeline.process(observation)

    facts = [r for r in rows if r.target_table == "activity_facts"]
    entries = {r.row["snapshot_id"]: r for r in rows if r.target_table == "arena_entries"}
    assert len(rows) == 41  # header + 20 entries + 20 facts
    assert len(facts) == 20

    fact = facts[0].row
    assert fact["metric_key"] == "arena_participation"
    assert fact["value_numeric"] == 1
    assert fact["unit"] == "boolean"
    assert fact["measurement_type"] == "observed"
    assert fact["confidence"] == 1.0

    # FR-ACT-008: every fact points at the exact entry row it came from,
    # and both agree on the player.
    for row in facts:
        source = entries[row.row["source_snapshot_id"]]
        assert row.entity_refs["player"]["game_uid"] == source.entity_refs["player"]["game_uid"]
        assert row.row["occurred_at"] == source.row["captured_at"]


def test_fact_keys_survive_parser_version_bump(monkeypatch: pytest.MonkeyPatch) -> None:
    observation = load_observation("user.get.arena.info/synthetic_week_v1.json")
    before = sorted(
        r.idempotency_key
        for r in pipeline.process(observation)
        if r.target_table == "activity_facts"
    )
    monkeypatch.setattr(arena, "PARSER_VERSION", "9.9.9-bumped")
    after = sorted(
        r.idempotency_key
        for r in pipeline.process(observation)
        if r.target_table == "activity_facts"
    )
    assert before == after


def test_roster_pipeline_emits_no_facts() -> None:
    observation = load_observation("al.rank/synthetic_roster_v1.json")
    rows = pipeline.process(observation)
    assert len(rows) == 20
    assert all(r.target_table == "alliance_member_snapshots" for r in rows)


def test_unknown_command_raises() -> None:
    observation = load_observation("al.rank/synthetic_roster_v1.json").model_copy(
        update={"source_command": "battle.report.share"}
    )
    with pytest.raises(pipeline.UnknownCommandError):
        pipeline.process(observation)
