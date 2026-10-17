"""When a Capital Clash starts and ends (0291)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import capital_clash_times
from tests.conftest import load_observation

KING = "get.king.info"
FINISH = "push.kingdom.fight.finish"


def test_both_commands_are_registered() -> None:
    assert registry.get(KING) is capital_clash_times.normalize_king_info
    assert registry.get(FINISH) is capital_clash_times.normalize_fight_finish


def test_the_term_end_is_the_next_start_and_the_finish_time_the_last_end() -> None:
    rows = capital_clash_times.normalize_king_info(load_observation(f"{KING}/king_v1.json"))

    by_kind = {r.row["kind"]: r.row for r in rows}
    assert by_kind["start"]["at"] == "2026-10-17T14:00:00+00:00"
    assert by_kind["finish"]["at"] == "2026-10-03T15:23:34.896000+00:00"
    assert {r.target_table for r in rows} == {"capital_clash_times"}
    # The game day it belongs to turns over at 02:00 UTC.
    assert by_kind["start"]["held_on"] == "2026-10-17"
    assert by_kind["finish"]["occupy_alliance_external_id"] == "0000000000000000000000000000a580"


def test_after_the_battle_the_same_payload_reports_the_next_term_and_this_finish() -> None:
    rows = capital_clash_times.normalize_king_info(load_observation(f"{KING}/king_after_v1.json"))

    by_kind = {r.row["kind"]: r.row for r in rows}
    assert by_kind["start"]["at"] == "2026-10-31T14:00:00+00:00"
    assert by_kind["finish"]["at"] == "2026-10-17T15:20:04.744000+00:00"
    assert by_kind["finish"]["held_on"] == "2026-10-17"


def test_a_server_with_no_king_writes_nothing() -> None:
    assert (
        capital_clash_times.normalize_king_info(load_observation(f"{KING}/king_none_v1.json")) == []
    )


def test_the_finish_push_is_the_same_fact_as_the_king_info_after_it() -> None:
    """The push and the later king info say the same instant; they must land on
    one row, or every battle ends twice."""
    push = capital_clash_times.normalize_fight_finish(load_observation(f"{FINISH}/finish_v1.json"))
    king = capital_clash_times.normalize_king_info(load_observation(f"{KING}/king_after_v1.json"))

    assert len(push) == 1
    king_finish = next(r for r in king if r.row["kind"] == "finish")
    assert push[0].row["at"] == king_finish.row["at"]
    assert push[0].idempotency_key == king_finish.idempotency_key


def test_a_finish_push_without_a_time_is_refused() -> None:
    with pytest.raises(ValidationError):
        capital_clash_times.normalize_fight_finish(
            load_observation(f"{FINISH}/finish_malformed_v1.json")
        )


def test_seeing_the_same_fact_again_keeps_the_key_and_a_moved_start_is_a_new_row() -> None:
    first = load_observation(f"{KING}/king_v1.json")
    again = first.model_copy(
        update={
            "observation_id": "00000000-0000-4000-8000-00000000cd99",
            "captured_at": first.captured_at.replace(day=9),
        }
    )
    moved = first.model_copy(deep=True)
    moved.payload["kingInfo"]["termEndTime"] = 1792249200000

    def start_key(observation):  # type: ignore[no-untyped-def]
        rows = capital_clash_times.normalize_king_info(observation)
        return next(r for r in rows if r.row["kind"] == "start").idempotency_key

    assert start_key(first) == start_key(again)
    assert start_key(first) != start_key(moved)


def test_a_payload_handed_over_as_the_live_path_does_parses_the_same() -> None:
    """The live path hands the parser the decoded payload, not the journal's
    JSON text. These fields are plain numbers either way."""
    observation = load_observation(f"{FINISH}/finish_v1.json")
    assert isinstance(observation.payload["finishTime"], int)
