"""al.battle.rank.info — per-member battle scores, and the first response
that reaches outside the tracked server group."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import pipeline, registry
from dw_collector.normalize import alliance_battle_rank
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("al.battle.rank.info") is alliance_battle_rank.normalize


def test_both_variants_are_distinct_rankings() -> None:
    """`type` selects between two different rankings. Both were captured, with
    different leaders and scores an order of magnitude apart, so they must not
    collide on the same member in the same week."""
    v0 = alliance_battle_rank.normalize(
        load_observation("al.battle.rank.info/battle_type0_v1.json")
    )
    v1 = alliance_battle_rank.normalize(
        load_observation("al.battle.rank.info/battle_type1_v1.json")
    )

    assert len(v0) == len(v1) == 165
    assert v0[0].row["variant"] == 0
    assert v1[0].row["variant"] == 1
    # Labelled against the game screen: type 0 is the daily board, type 1 the
    # weekly one, and the top scores are the ones that were read off it.
    assert v0[0].row["score"] == 5658634
    assert v1[0].row["score"] == 26865932
    assert {r.idempotency_key for r in v0}.isdisjoint({r.idempotency_key for r in v1})


def test_daily_and_weekly_name_both_alliances() -> None:
    """A duel has two sides and the daily/weekly boards list both. Without the
    alliance on the row, an opponent's score is indistinguishable from ours —
    165 rows against a roster of 94."""
    rows = alliance_battle_rank.normalize(
        load_observation("al.battle.rank.info/battle_type0_v1.json")
    )
    by_alliance: dict[str | None, int] = {}
    for row in rows:
        name = row.row["alliance_name"]
        by_alliance[name] = by_alliance.get(name, 0) + 1

    assert len(by_alliance) == 2, "the daily board carries both sides of the duel"
    assert sorted(by_alliance.values()) == [72, 93]
    assert all(row.row["alliance_code"] for row in rows)


def test_the_round_total_is_our_alliance_only() -> None:
    """type 2 sums the duel's four rounds and, unlike daily and weekly, lists
    only our own members — which is what the row count pins."""
    rows = alliance_battle_rank.normalize(
        load_observation("al.battle.rank.info/battle_round_v1.json")
    )

    assert len(rows) == 94
    assert len({row.row["alliance_name"] for row in rows}) == 1
    assert rows[0].row["variant"] == 2


def test_spans_servers_outside_the_tracked_group() -> None:
    """Server 586 is not in 577-584. Snapshot rows FK to servers, so this is
    what forces sync to register unknown servers (NFR-007)."""
    rows = alliance_battle_rank.normalize(
        load_observation("al.battle.rank.info/battle_type0_v1.json")
    )
    servers = {r.row["server_id"] for r in rows}
    assert servers == {580, 586}
    assert not servers <= set(range(577, 585))
    # Provenance stays the observing server regardless.
    assert all(r.row["collected_from_server_id"] == 580 for r in rows)


def test_scores_ordered_and_ranked() -> None:
    rows = alliance_battle_rank.normalize(
        load_observation("al.battle.rank.info/battle_type1_v1.json")
    )
    scores = [r.row["score"] for r in rows]
    assert scores == sorted(scores, reverse=True)
    assert [r.row["rank"] for r in rows] == list(range(1, 166))
    # This response reports no per-entry update time, unlike the donation rank.
    assert all(r.row["score_updated_at"] is None for r in rows)


def test_facts_use_the_battle_metric() -> None:
    observation = load_observation("al.battle.rank.info/battle_type1_v1.json")
    rows = pipeline.process(observation)
    facts = [r for r in rows if r.target_table == "activity_facts"]
    snapshots = {r.row["snapshot_id"]: r for r in rows if r.target_table != "activity_facts"}

    assert len(facts) == 165
    assert facts[0].row["metric_key"] == "alliance_battle_score"
    assert facts[0].row["value_numeric"] == 26865932
    # No server update time, so the fact falls back to when we observed it.
    assert facts[0].row["occurred_at"] == observation.captured_at.isoformat()
    for row in facts:
        assert row.row["source_snapshot_id"] in snapshots


def test_malformed_uid_rejected() -> None:
    with pytest.raises(ValidationError):
        alliance_battle_rank.normalize(
            load_observation("al.battle.rank.info/battle_malformed_v1.json")
        )


def test_missing_score_and_server_are_kept_optional() -> None:
    """An entry that reports neither score nor serverId still names a player.
    The server falls back to the uid suffix, which is where it lives anyway."""
    observation = load_observation("al.battle.rank.info/battle_type0_v1.json")
    sparse = observation.model_copy(
        update={"payload": {"type": 0, "rankInfo": [{"uid": "9162481630000586"}]}}
    )

    rows = alliance_battle_rank.normalize(sparse)

    assert len(rows) == 1
    assert rows[0].row["score"] is None
    assert rows[0].row["server_id"] == 586
    assert rows[0].entity_refs["player"]["name"] is None


def test_empty_ranking_yields_no_rows() -> None:
    observation = load_observation("al.battle.rank.info/battle_type0_v1.json")
    empty = observation.model_copy(update={"payload": {"type": 0, "rankInfo": []}})

    assert alliance_battle_rank.normalize(empty) == []


def test_replay_is_idempotent() -> None:
    observation = load_observation("al.battle.rank.info/battle_type0_v1.json")
    first = [r.idempotency_key for r in alliance_battle_rank.normalize(observation)]
    second = [r.idempotency_key for r in alliance_battle_rank.normalize(observation)]

    assert first == second


def test_key_survives_a_parser_version_bump() -> None:
    observation = load_observation("al.battle.rank.info/battle_type0_v1.json")
    before = alliance_battle_rank.normalize(observation)[0].idempotency_key

    original = alliance_battle_rank.PARSER_VERSION
    alliance_battle_rank.PARSER_VERSION = "9.9.9"
    try:
        after = alliance_battle_rank.normalize(observation)[0].idempotency_key
    finally:
        alliance_battle_rank.PARSER_VERSION = original

    assert before == after
