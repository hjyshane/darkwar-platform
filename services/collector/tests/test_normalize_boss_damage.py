"""alliance.boss.damage.rank.new -- the Frankie damage board (0277)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import boss_damage
from tests.conftest import load_observation

BOARD = "alliance.boss.damage.rank.new/board_v1.json"


def test_registered() -> None:
    assert registry.get("alliance.boss.damage.rank.new") is boss_damage.normalize


def test_every_member_on_the_board_is_a_row() -> None:
    rows = boss_damage.normalize(load_observation(BOARD))

    assert [r.row["game_uid"] for r in rows] == [
        1000000001000580,
        1000000002000580,
        1000000003000581,
    ]
    assert [r.row["damage"] for r in rows] == [64059759378, 49036082730, 0]
    assert [r.row["rank"] for r in rows] == [1, 2, 3]
    assert {r.target_table for r in rows} == {"boss_damage_scores"}
    # The member's own server, from the uid.
    assert rows[2].row["server_id"] == 581
    assert rows[0].entity_refs["player"]["name"] == "Alpha"
    assert "alliance" not in rows[0].entity_refs


def test_a_member_with_zero_damage_is_still_a_row() -> None:
    """On the board is on the board: a zero is a reading, not a gap."""
    rows = boss_damage.normalize(load_observation(BOARD))

    assert rows[2].row["damage"] == 0


def test_the_read_day_is_the_game_day_it_was_read_on() -> None:
    """18:15 UTC on the 11th is 16:15 server time the same day."""
    rows = boss_damage.normalize(load_observation(BOARD))

    assert {r.row["held_on"] for r in rows} == {"2026-10-11"}


def test_an_early_morning_read_belongs_to_the_previous_game_day() -> None:
    observation = load_observation(BOARD)
    observation = observation.model_copy(
        update={"captured_at": observation.captured_at.replace(day=12, hour=1, minute=30)}
    )

    assert {r.row["held_on"] for r in boss_damage.normalize(observation)} == {"2026-10-11"}


def test_a_board_with_no_members_writes_nothing() -> None:
    assert (
        boss_damage.normalize(load_observation("alliance.boss.damage.rank.new/board_empty_v1.json"))
        == []
    )


def test_a_malformed_uid_is_refused() -> None:
    with pytest.raises(ValidationError):
        boss_damage.normalize(
            load_observation("alliance.boss.damage.rank.new/board_malformed_v1.json")
        )


def test_reading_the_same_board_twice_keeps_the_same_keys() -> None:
    """The key hashes each raw entry: an unchanged re-read dedupes, and more
    damage is a new row (damage only grows inside an event)."""
    first = load_observation(BOARD)
    again = first.model_copy(
        update={
            "observation_id": "00000000-0000-4000-8000-00000000f109",
            "captured_at": first.captured_at.replace(minute=40),
        }
    )
    changed = first.model_copy(deep=True)
    changed.payload["rankList"][0]["damage"] = 70000000000

    keys = [r.idempotency_key for r in boss_damage.normalize(first)]
    assert keys == [r.idempotency_key for r in boss_damage.normalize(again)]
    assert keys[0] != boss_damage.normalize(changed)[0].idempotency_key
    assert keys[1:] == [r.idempotency_key for r in boss_damage.normalize(changed)][1:]
