"""get.alliance.season.score.rank — the season alliance board.

Two properties of this board are unlike every other ranking the collector
reads, and both are pinned here: it names servers outside the tracked group,
and it carries the previous rank itself instead of leaving movement to be
derived.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import season_score_rank
from tests.conftest import load_observation

BOARD = "get.alliance.season.score.rank/season3_board_v1.json"


def test_registered() -> None:
    assert registry.get("get.alliance.season.score.rank") is season_score_rank.normalize


def test_the_whole_board_lands_on_one_table() -> None:
    rows = season_score_rank.normalize(load_observation(BOARD))

    assert len(rows) == 89
    assert {r.target_table for r in rows} == {"alliance_season_score_snapshots"}


def test_the_board_reaches_outside_the_tracked_group() -> None:
    """580 and 584 are in the seeded 577-584; 586 and 588 are not. This is
    the fact that makes sync's ensure_servers() load-bearing for this parser
    rather than incidental — the FK would reject the row otherwise."""
    rows = season_score_rank.normalize(load_observation(BOARD))

    assert {r.row["server_id"] for r in rows} == {580, 584, 586, 588}
    # Provenance stays separate from the subject's server.
    assert {r.row["collected_from_server_id"] for r in rows} == {580}


def test_previous_rank_is_the_servers_own_number() -> None:
    """oldRank is `observed` in §14.4 terms. Recomputing it from a preceding
    snapshot would turn a gap in capture into a rank that did not move."""
    rows = season_score_rank.normalize(load_observation(BOARD))

    assert rows[0].row["rank"] == 1
    assert rows[0].row["previous_rank"] is not None
    assert any(r.row["rank"] != r.row["previous_rank"] for r in rows)


def test_the_board_is_ordered_by_rank() -> None:
    rows = season_score_rank.normalize(load_observation(BOARD))

    assert [r.row["rank"] for r in rows] == list(range(1, 90))
    scores = [r.row["score"] for r in rows]
    assert scores == sorted(scores, reverse=True)


def test_each_row_carries_the_alliance_ref_sync_needs() -> None:
    rows = season_score_rank.normalize(load_observation(BOARD))

    ref = rows[0].entity_refs["alliance"]
    assert ref["external_id"] == rows[0].row["alliance_external_id"]
    assert ref["server_id"] == rows[0].row["server_id"]
    # alliance_id is resolved cloud-side, never invented here.
    assert "alliance_id" not in rows[0].row


def test_optional_fields_stay_null_rather_than_defaulting() -> None:
    observation = load_observation(BOARD)
    sparse = observation.model_copy(
        update={
            "payload": {
                "rankList": [{"allianceId": "a" * 32, "serverId": 580}],
            }
        }
    )

    row = season_score_rank.normalize(sparse)[0].row
    assert row["score"] is None
    assert row["power"] is None
    assert row["rank"] is None
    assert row["previous_rank"] is None
    assert row["alliance_name"] is None


def test_empty_board_yields_no_rows() -> None:
    observation = load_observation(BOARD)
    empty = observation.model_copy(update={"payload": {"rankList": []}})

    assert season_score_rank.normalize(empty) == []


def test_malformed_entry_is_rejected() -> None:
    """allianceId and serverId are the two the row cannot be built without —
    one is the natural key, the other is a real foreign key."""
    observation = load_observation(BOARD)
    broken = observation.model_copy(
        update={"payload": {"rankList": [{"allianceName": "no id here"}]}}
    )

    with pytest.raises(ValidationError):
        season_score_rank.normalize(broken)


def test_two_alliances_do_not_collide_on_one_key() -> None:
    rows = season_score_rank.normalize(load_observation(BOARD))

    assert len({r.idempotency_key for r in rows}) == 89


def test_replay_is_idempotent() -> None:
    observation = load_observation(BOARD)
    first = [r.idempotency_key for r in season_score_rank.normalize(observation)]
    second = [r.idempotency_key for r in season_score_rank.normalize(observation)]

    assert first == second


def test_key_survives_a_parser_version_bump() -> None:
    """The key hashes the RAW payload, so a version bump must not remint it
    and duplicate all history on replay (CLAUDE.md, pinned repo-wide)."""
    observation = load_observation(BOARD)
    before = season_score_rank.normalize(observation)[0].idempotency_key

    original = season_score_rank.PARSER_VERSION
    season_score_rank.PARSER_VERSION = "9.9.9"
    try:
        after = season_score_rank.normalize(observation)[0].idempotency_key
    finally:
        season_score_rank.PARSER_VERSION = original

    assert before == after
