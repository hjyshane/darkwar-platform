"""al.fight.act.member.score — the Furnace Fury member board (0212)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import furnace_fury
from tests.conftest import load_observation


def test_registered() -> None:
    assert registry.get("al.fight.act.member.score") is furnace_fury.normalize


def test_every_member_on_the_board_is_a_row() -> None:
    rows = furnace_fury.normalize(load_observation("al.fight.act.member.score/board_v1.json"))

    assert [r.row["game_uid"] for r in rows] == [
        1000000001000580,
        1000000002000580,
        1000000003000581,
    ]
    assert [r.row["score"] for r in rows] == [4455500, 29164800, 0]
    assert {r.target_table for r in rows} == {"furnace_fury_scores"}
    # The member's own server, from the uid; the alliance is the board's.
    assert rows[2].row["server_id"] == 581
    assert rows[0].row["alliance_external_id"] == "0000000000000000000000000000a580"
    assert rows[0].row["attacker"] is True
    assert rows[0].entity_refs["alliance"]["code"] == "TST"


def test_the_battle_is_the_game_day_it_was_read_on() -> None:
    """22:10 UTC is 20:10 server time on the 29th."""
    rows = furnace_fury.normalize(load_observation("al.fight.act.member.score/board_v1.json"))

    assert {r.row["held_on"] for r in rows} == {"2026-09-29"}


def test_an_early_morning_read_belongs_to_the_previous_game_day() -> None:
    observation = load_observation("al.fight.act.member.score/board_v1.json")
    observation = observation.model_copy(
        update={"captured_at": observation.captured_at.replace(day=30, hour=1)}
    )

    assert {r.row["held_on"] for r in furnace_fury.normalize(observation)} == {"2026-09-29"}


def test_a_board_with_no_members_writes_nothing() -> None:
    assert (
        furnace_fury.normalize(load_observation("al.fight.act.member.score/board_empty_v1.json"))
        == []
    )


def test_a_malformed_uid_is_refused() -> None:
    with pytest.raises(ValidationError):
        furnace_fury.normalize(
            load_observation("al.fight.act.member.score/board_malformed_v1.json")
        )


def test_reading_the_same_board_twice_keeps_the_same_keys() -> None:
    """The key hashes each raw member entry, so a second read of an unchanged
    board dedupes, and a changed score is a new row."""
    first = load_observation("al.fight.act.member.score/board_v1.json")
    again = first.model_copy(
        update={
            "observation_id": "00000000-0000-4000-8000-00000000f009",
            "captured_at": first.captured_at.replace(minute=40),
        }
    )
    changed = first.model_copy(deep=True)
    changed.payload["memberScores"][0]["score"] = 5000000

    keys = [r.idempotency_key for r in furnace_fury.normalize(first)]
    assert keys == [r.idempotency_key for r in furnace_fury.normalize(again)]
    assert keys[0] != furnace_fury.normalize(changed)[0].idempotency_key
    assert keys[1:] == [r.idempotency_key for r in furnace_fury.normalize(changed)][1:]
