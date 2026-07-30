"""get.daily.alliance.donate.rank — the first per-member contribution source.

Extracted from a discovery sweep. The command matters because it attributes
by UID: the alternatives found in the same sweep give a display name
(al.battle.week.result.info) or an alliance total with no player identifier
(get.alliance.boss.activity.info.new), and neither can honestly become a
per-player fact.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from dw_collector import pipeline, registry
from dw_collector.normalize import alliance_donate_rank
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("get.daily.alliance.donate.rank") is alliance_donate_rank.normalize


def test_real_daily_ranking() -> None:
    observation = load_observation("get.daily.alliance.donate.rank/daily_580_v1.json")
    rows = alliance_donate_rank.normalize(observation)

    assert len(rows) == 53
    assert {r.target_table for r in rows} == {"alliance_contribution_snapshots"}
    assert len({r.idempotency_key for r in rows}) == 53

    top = rows[0].row
    assert top["game_uid"] == 9105284188000580
    assert top["score"] == 5860
    assert top["rank"] == 1
    assert top["contribution_type"] == "daily_donation"
    assert top["server_id"] == 580
    # The response names no alliance, so we do not invent one.
    assert top["alliance_id"] is None
    # score_updated_at comes from the server's own updateTime, not from when
    # we happened to look. (No ordering is asserted between the two: the
    # sweep's newest updateTime ran ahead of the capture timestamp recorded
    # for it, and whether the game clock is UTC-aligned is unverified —
    # push.utc.time exists in the discovery inbox for a reason.)
    assert datetime.fromisoformat(top["score_updated_at"]) != observation.captured_at
    assert top["raw"]["updateTime"] == 1785386291955

    # The list arrives ordered by score, so rank tracks position.
    scores = [r.row["score"] for r in rows]
    assert scores == sorted(scores, reverse=True)
    assert [r.row["rank"] for r in rows] == list(range(1, 54))


def test_fact_is_the_measured_score_not_a_flag() -> None:
    observation = load_observation("get.daily.alliance.donate.rank/daily_580_v1.json")
    rows = pipeline.process(observation)

    snapshots = {r.row["snapshot_id"]: r for r in rows if r.target_table != "activity_facts"}
    facts = [r for r in rows if r.target_table == "activity_facts"]
    assert len(facts) == 53

    fact = facts[0].row
    assert fact["metric_key"] == "alliance_donation_score"
    assert fact["value_numeric"] == 5860
    assert fact["unit"] == "points"
    assert fact["measurement_type"] == "observed"
    assert fact["activity_type"] == "alliance_contribution"
    # FR-ACT-008: every fact points at the snapshot row it came from.
    for row in facts:
        source = snapshots[row.row["source_snapshot_id"]]
        assert row.row["value_numeric"] == source.row["score"]
        assert row.entity_refs["player"]["game_uid"] == source.entity_refs["player"]["game_uid"]
        # occurred_at is when the score changed, not when we captured it.
        assert row.row["occurred_at"] == source.row["score_updated_at"]


def test_null_score_and_missing_update_time() -> None:
    rows = alliance_donate_rank.normalize(
        load_observation("get.daily.alliance.donate.rank/daily_nulls_v1.json")
    )
    assert len(rows) == 2
    bare = rows[0].row
    assert bare["score"] is None
    assert bare["score_updated_at"] is None
    # serverId is absent from this response entirely; the uid carries it (D-1).
    assert bare["server_id"] == 584


def test_missing_update_time_falls_back_to_capture_time() -> None:
    observation = load_observation("get.daily.alliance.donate.rank/daily_nulls_v1.json")
    facts = [r for r in pipeline.process(observation) if r.target_table == "activity_facts"]
    assert facts[0].row["occurred_at"] == observation.captured_at.isoformat()
    # A missing score is not a zero contribution; it is an unknown one, but the
    # fact contract requires a number, so this is the one place we coerce.
    assert facts[0].row["value_numeric"] == 0


def test_malformed_uid_rejected() -> None:
    with pytest.raises(ValidationError):
        alliance_donate_rank.normalize(
            load_observation("get.daily.alliance.donate.rank/daily_malformed_v1.json")
        )


def test_keys_survive_parser_version_bump(monkeypatch: pytest.MonkeyPatch) -> None:
    observation = load_observation("get.daily.alliance.donate.rank/daily_580_v1.json")
    before = [r.idempotency_key for r in alliance_donate_rank.normalize(observation)]
    monkeypatch.setattr(alliance_donate_rank, "PARSER_VERSION", "9.9.9")
    assert [r.idempotency_key for r in alliance_donate_rank.normalize(observation)] == before


def test_utc_conversion_of_update_time() -> None:
    rows = alliance_donate_rank.normalize(
        load_observation("get.daily.alliance.donate.rank/daily_580_v1.json")
    )
    when = datetime.fromisoformat(rows[0].row["score_updated_at"])
    assert when.tzinfo == UTC
    assert when == datetime.fromtimestamp(1785386291955 / 1000, tz=UTC)
