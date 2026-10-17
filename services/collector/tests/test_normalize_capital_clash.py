"""Capital Clash: the score board and the relocations (0287)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import capital_clash
from tests.conftest import load_observation

BOARD = "get.kingdom.act.score.rank"
MOVES = "push.world.point.update"


def test_both_commands_are_registered() -> None:
    assert registry.get(BOARD) is capital_clash.normalize_scores
    assert registry.get(MOVES) is capital_clash.normalize_relocations


# --- the score board --------------------------------------------------------


def test_every_entry_on_the_board_is_a_row() -> None:
    rows = capital_clash.normalize_scores(load_observation(f"{BOARD}/board_v1.json"))

    assert [r.row["game_uid"] for r in rows] == [
        1000000001000580,
        1000000002000580,
        1000000003000581,
    ]
    assert [r.row["score"] for r in rows] == [19066151, 17248635, 9000000]
    assert [r.row["rank"] for r in rows] == [1, 2, 3]
    assert {r.target_table for r in rows} == {"capital_clash_scores"}
    # The board mixes alliances; each row says whose it is, and the member's
    # own server comes from the uid, not from where it was read.
    assert [r.row["alliance_code"] for r in rows] == ["TST", "TST", "OTH"]
    assert rows[2].row["server_id"] == 581
    assert rows[0].entity_refs["player"]["name"] == "Alpha"


def test_the_event_is_the_game_day_it_was_read_on() -> None:
    rows = capital_clash.normalize_scores(load_observation(f"{BOARD}/board_v1.json"))

    assert {r.row["held_on"] for r in rows} == {"2026-10-17"}


def test_a_read_after_midnight_utc_but_before_the_turnover_is_the_day_before() -> None:
    observation = load_observation(f"{BOARD}/board_v1.json")
    observation = observation.model_copy(
        update={"captured_at": observation.captured_at.replace(day=18, hour=1)}
    )

    rows = capital_clash.normalize_scores(observation)
    assert {r.row["held_on"] for r in rows} == {"2026-10-17"}


def test_an_empty_board_writes_nothing() -> None:
    assert capital_clash.normalize_scores(load_observation(f"{BOARD}/board_empty_v1.json")) == []


def test_a_malformed_uid_is_refused() -> None:
    with pytest.raises(ValidationError):
        capital_clash.normalize_scores(load_observation(f"{BOARD}/board_malformed_v1.json"))


def test_reading_the_same_board_twice_keeps_the_keys_and_a_new_score_is_a_new_row() -> None:
    first = load_observation(f"{BOARD}/board_v1.json")
    again = first.model_copy(
        update={
            "observation_id": "00000000-0000-4000-8000-00000000cc99",
            "captured_at": first.captured_at.replace(minute=31),
        }
    )
    changed = first.model_copy(deep=True)
    changed.payload["rankList"][0]["score"] = 20000000

    keys = [r.idempotency_key for r in capital_clash.normalize_scores(first)]
    assert keys == [r.idempotency_key for r in capital_clash.normalize_scores(again)]
    after = [r.idempotency_key for r in capital_clash.normalize_scores(changed)]
    assert keys[0] != after[0]
    assert keys[1:] == after[1:]


# --- relocations ------------------------------------------------------------


def test_a_relocation_names_the_player_and_where_they_went() -> None:
    rows = capital_clash.normalize_relocations(load_observation(f"{MOVES}/relocate_v1.json"))

    assert len(rows) == 1
    row = rows[0]
    assert row.target_table == "player_relocations"
    assert row.row["game_uid"] == 1000000001000580
    assert row.row["server_id"] == 580
    assert row.row["point_id"] == 502481
    assert row.row["alliance_code"] == "TST"
    assert row.row["alliance_external_id"] == "0000000000000000000000000000a580"
    assert row.entity_refs["player"] == {
        "game_uid": 1000000001000580,
        "server_id": 580,
        "name": "Alpha",
    }
    # The raw message stays, so a field promoted later needs no re-capture.
    assert row.row["raw"]["point"].startswith("b64:")


def test_several_relocations_in_one_push_are_several_rows() -> None:
    rows = capital_clash.normalize_relocations(load_observation(f"{MOVES}/relocate_two_v1.json"))

    assert [(r.row["game_uid"], r.row["point_id"]) for r in rows] == [
        (1000000001000580, 502481),
        (1000000003000581, 514494),
    ]
    assert rows[1].row["server_id"] == 581


@pytest.mark.parametrize("fixture", ["remove_v1.json"])
def test_the_other_kinds_of_tile_update_write_nothing(fixture: str) -> None:
    """change, remove, foldUp and create redraw a tile; only relocate is a move."""
    assert capital_clash.normalize_relocations(load_observation(f"{MOVES}/{fixture}")) == []


def test_a_malformed_message_is_refused() -> None:
    with pytest.raises(ValueError):
        capital_clash.normalize_relocations(load_observation(f"{MOVES}/relocate_malformed_v1.json"))


def test_the_same_push_twice_dedupes_and_a_second_move_does_not() -> None:
    """Overlapping capture chunks deliver one packet twice; the key is the raw
    message at its capture instant. The same player moving again later is a
    new fact."""
    first = load_observation(f"{MOVES}/relocate_v1.json")
    twice = first.model_copy(update={"observation_id": "00000000-0000-4000-8000-00000000cc98"})
    later = first.model_copy(update={"captured_at": first.captured_at.replace(minute=40)})

    key = capital_clash.normalize_relocations(first)[0].idempotency_key
    assert key == capital_clash.normalize_relocations(twice)[0].idempotency_key
    assert key != capital_clash.normalize_relocations(later)[0].idempotency_key
