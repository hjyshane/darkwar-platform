"""alliance.boss.damage.rank.new -- the Frankie damage board (0277)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import boss_damage
from tests.conftest import load_observation

BOARD = "alliance.boss.damage.rank.new/board_v1.json"


def _members(observation):  # type: ignore[no-untyped-def]
    """The per-member rows; every read also leaves one read row (0288)."""
    return [r for r in boss_damage.normalize(observation) if r.target_table == "boss_damage_scores"]


def test_registered() -> None:
    assert registry.get("alliance.boss.damage.rank.new") is boss_damage.normalize


def test_every_member_on_the_board_is_a_row() -> None:
    rows = _members(load_observation(BOARD))

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
    rows = _members(load_observation(BOARD))

    assert rows[2].row["damage"] == 0


def test_the_read_day_is_the_game_day_it_was_read_on() -> None:
    """18:15 UTC on the 11th is 16:15 server time the same day."""
    rows = _members(load_observation(BOARD))

    assert {r.row["held_on"] for r in rows} == {"2026-10-11"}


def test_an_early_morning_read_belongs_to_the_previous_game_day() -> None:
    observation = load_observation(BOARD)
    observation = observation.model_copy(
        update={"captured_at": observation.captured_at.replace(day=12, hour=1, minute=30)}
    )

    assert {r.row["held_on"] for r in _members(observation)} == {"2026-10-11"}


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

    keys = [r.idempotency_key for r in _members(first)]
    assert keys == [r.idempotency_key for r in _members(again)]
    assert keys[0] != _members(changed)[0].idempotency_key
    assert keys[1:] == [r.idempotency_key for r in _members(changed)][1:]


def test_every_read_leaves_a_read_row_even_when_no_member_changed() -> None:
    """The member rows dedupe an unchanged re-read; the read row is how the
    report knows the board was opened at that moment (0288)."""
    first = load_observation(BOARD)
    again = first.model_copy(
        update={
            "observation_id": "00000000-0000-4000-8000-00000000f110",
            "captured_at": first.captured_at.replace(minute=50),
        }
    )

    def read(observation):  # type: ignore[no-untyped-def]
        return [
            r for r in boss_damage.normalize(observation) if r.target_table == "boss_damage_reads"
        ]

    one, two = read(first), read(again)
    assert len(one) == len(two) == 1
    assert one[0].idempotency_key != two[0].idempotency_key
    assert one[0].row["entries"] == 3
    assert one[0].row["hitters"] == 2
    assert one[0].row["total_damage"] == 64059759378 + 49036082730
    assert one[0].row["captured_at"] == first.captured_at.isoformat()
    # The same observation replayed is the same row.
    assert read(first)[0].idempotency_key == one[0].idempotency_key
    assert one[0].entity_refs == {}
