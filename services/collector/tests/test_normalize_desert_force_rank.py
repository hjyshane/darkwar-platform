"""desert.force.server.rank — the season player force board.

The two things worth pinning: force must never be mistaken for power, and
the home server has to be decoded from the uid because the entries do not
carry one.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import desert_force_rank
from tests.conftest import load_observation

BOARD = "desert.force.server.rank/season3_force_v1.json"


def test_registered() -> None:
    assert registry.get("desert.force.server.rank") is desert_force_rank.normalize


def test_the_whole_board_lands_on_one_table() -> None:
    rows = desert_force_rank.normalize(load_observation(BOARD))

    assert len(rows) == 149
    assert {r.target_table for r in rows} == {"player_season_force_snapshots"}


def test_force_never_lands_in_a_power_column() -> None:
    """Nothing observed relates force to power, and the scales differ by two
    orders of magnitude from the alliance board's score. Filing it as power
    is the corruption 0018 describes for the component boards."""
    rows = desert_force_rank.normalize(load_observation(BOARD))

    assert all(r.target_table != "player_snapshots" for r in rows)
    assert all("power" not in r.row for r in rows)
    assert rows[0].row["force"] is not None


def test_server_is_decoded_from_the_uid() -> None:
    """No entry carries a serverId — 0 of 149 in the real response — so the
    D-1 suffix rule is the only source. The sanitizer preserves the suffix
    precisely so this still holds on the fixture."""
    rows = desert_force_rank.normalize(load_observation(BOARD))

    for row in rows:
        assert row.row["server_id"] == int(str(row.row["game_uid"])[-6:])
    # Server-local, unlike the alliance board for the same season.
    assert {r.row["server_id"] for r in rows} == {580}


def test_server_id_is_the_subjects_not_the_collectors() -> None:
    rows = desert_force_rank.normalize(load_observation(BOARD))

    assert {r.row["collected_from_server_id"] for r in rows} == {580}
    assert all("collector_id" in r.row for r in rows)


def test_the_board_is_ordered_by_rank() -> None:
    rows = desert_force_rank.normalize(load_observation(BOARD))

    assert [r.row["rank"] for r in rows] == list(range(1, 150))
    forces = [r.row["force"] for r in rows]
    assert forces == sorted(forces, reverse=True)


def test_each_row_carries_the_player_ref_sync_needs() -> None:
    rows = desert_force_rank.normalize(load_observation(BOARD))

    ref = rows[0].entity_refs["player"]
    assert ref["game_uid"] == rows[0].row["game_uid"]
    assert ref["server_id"] == rows[0].row["server_id"]
    # player_id is resolved cloud-side, never invented here.
    assert "player_id" not in rows[0].row


def test_a_player_without_an_alliance_still_lands() -> None:
    """Alliance fields are optional on this board — a ranked player need not
    be in one, and dropping the row would silently shorten the board."""
    observation = load_observation(BOARD)
    sparse = observation.model_copy(
        update={"payload": {"serverRanking": [{"uid": "1234567890000580", "force": 10}]}}
    )

    row = desert_force_rank.normalize(sparse)[0].row
    assert row["alliance_external_id"] is None
    assert row["alliance_name"] is None
    assert row["name"] is None
    assert row["rank"] is None
    assert row["force"] == 10


def test_empty_board_yields_no_rows() -> None:
    observation = load_observation(BOARD)
    empty = observation.model_copy(update={"payload": {"serverRanking": []}})

    assert desert_force_rank.normalize(empty) == []


def test_malformed_uid_is_rejected() -> None:
    """A non-numeric uid cannot be decoded to a server or stored as a
    bigint, so it must fail loudly rather than land as a guess."""
    observation = load_observation(BOARD)
    broken = observation.model_copy(
        update={"payload": {"serverRanking": [{"uid": "not-a-number", "force": 1}]}}
    )

    with pytest.raises(ValidationError):
        desert_force_rank.normalize(broken)


def test_two_players_do_not_collide_on_one_key() -> None:
    rows = desert_force_rank.normalize(load_observation(BOARD))

    assert len({r.idempotency_key for r in rows}) == 149


def test_replay_is_idempotent() -> None:
    observation = load_observation(BOARD)
    first = [r.idempotency_key for r in desert_force_rank.normalize(observation)]
    second = [r.idempotency_key for r in desert_force_rank.normalize(observation)]

    assert first == second


def test_key_survives_a_parser_version_bump() -> None:
    observation = load_observation(BOARD)
    before = desert_force_rank.normalize(observation)[0].idempotency_key

    original = desert_force_rank.PARSER_VERSION
    desert_force_rank.PARSER_VERSION = "9.9.9"
    try:
        after = desert_force_rank.normalize(observation)[0].idempotency_key
    finally:
        desert_force_rank.PARSER_VERSION = original

    assert before == after
