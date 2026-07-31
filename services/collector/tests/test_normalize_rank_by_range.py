"""rank.get.by.range — four boards, one command, and the mapping that was
nearly recorded backwards.

The type ids were first inferred from the order the tabs were opened, which
put 49 and 79 the wrong way round. These tests pin the evidence that
overruled it: an exact match against the collector's own profile for the
totals, and the presence of heroId/petId on the "best" boards.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import rank_by_range
from tests.conftest import load_observation

HERO_TOTAL = "rank.get.by.range/hero_total_45_v1.json"
HERO_BEST = "rank.get.by.range/hero_best_49_v1.json"
PET_TOTAL = "rank.get.by.range/pet_total_79_v1.json"
PET_BEST = "rank.get.by.range/pet_best_80_v1.json"


def test_registered() -> None:
    assert registry.get("rank.get.by.range") is rank_by_range.normalize


@pytest.mark.parametrize(
    ("fixture", "metric", "board_type"),
    [
        (HERO_TOTAL, "hero_power_total", 45),
        (HERO_BEST, "hero_power_best", 49),
        (PET_TOTAL, "pet_power_total", 79),
        (PET_BEST, "pet_power_best", 80),
    ],
)
def test_each_board_is_named_by_its_type(fixture: str, metric: str, board_type: int) -> None:
    rows = rank_by_range.normalize(load_observation(fixture))

    assert len(rows) == 150
    assert {r.target_table for r in rows} == {"player_component_power_snapshots"}
    assert {r.row["metric"] for r in rows} == {metric}
    # The raw id travels with the row so a future fifth board stays traceable.
    assert {r.row["board_type"] for r in rows} == {board_type}


def test_only_the_best_boards_name_a_unit() -> None:
    """heroId / petId is what proves those two boards rank ONE unit; the
    totals aggregate and name nothing."""
    assert rank_by_range.normalize(load_observation(HERO_BEST))[0].row["unit_id"] == 40002
    assert rank_by_range.normalize(load_observation(PET_BEST))[0].row["unit_id"] == 106
    assert rank_by_range.normalize(load_observation(HERO_TOTAL))[0].row["unit_id"] is None
    assert rank_by_range.normalize(load_observation(PET_TOTAL))[0].row["unit_id"] is None


def test_a_component_never_lands_in_the_roster_power_column() -> None:
    """The collector's total power is 344,948,617; these boards read 70.8M
    and below and do not sum to it. Writing one as `power` would report
    every ranked player at a fraction of their strength."""
    rows = rank_by_range.normalize(load_observation(HERO_TOTAL))

    assert all(r.target_table != "player_snapshots" for r in rows)
    assert "power" in rows[0].row  # the component itself, on its own table
    assert rows[0].row["metric"] == "hero_power_total"


def test_boards_are_ordered_and_cross_server() -> None:
    rows = rank_by_range.normalize(load_observation(HERO_TOTAL))

    powers = [r.row["power"] for r in rows]
    assert powers == sorted(powers, reverse=True)
    assert rows[0].row["rank"] == 1
    # A cross-server board: the group's eight servers, from the uid suffix.
    assert len({r.row["server_id"] for r in rows}) > 1


def test_server_id_is_the_subjects_not_the_collectors() -> None:
    rows = rank_by_range.normalize(load_observation(HERO_TOTAL))

    for row in rows:
        assert row.row["server_id"] == int(str(row.row["game_uid"])[-6:])
    assert {r.row["collected_from_server_id"] for r in rows} == {580}


def test_an_unknown_board_is_skipped_not_guessed() -> None:
    """A fifth type must reach schema_observations for a human to look at,
    not this table under a made-up metric name."""
    observation = load_observation(HERO_TOTAL)
    unknown = observation.model_copy(update={"payload": {**observation.payload, "type": 999}})

    assert rank_by_range.normalize(unknown) == []


def test_empty_board_yields_no_rows() -> None:
    observation = load_observation(HERO_TOTAL)
    empty = observation.model_copy(update={"payload": {"type": 45, "serverRanking": []}})

    assert rank_by_range.normalize(empty) == []


def test_malformed_uid_is_rejected() -> None:
    observation = load_observation(HERO_TOTAL)
    broken = observation.model_copy(
        update={"payload": {"type": 45, "serverRanking": [{"uid": "not-a-number"}]}}
    )

    with pytest.raises(ValidationError):
        rank_by_range.normalize(broken)


def test_the_four_boards_do_not_collide_on_one_player() -> None:
    """One player appears on several boards with different values; the key
    must separate them or three of the four readings vanish."""
    keys = [
        rank_by_range.normalize(load_observation(f))[0].idempotency_key
        for f in (HERO_TOTAL, HERO_BEST, PET_TOTAL, PET_BEST)
    ]

    assert len(set(keys)) == 4


def test_replay_is_idempotent() -> None:
    observation = load_observation(HERO_TOTAL)
    first = [r.idempotency_key for r in rank_by_range.normalize(observation)]
    second = [r.idempotency_key for r in rank_by_range.normalize(observation)]

    assert first == second


def test_key_survives_a_parser_version_bump() -> None:
    observation = load_observation(HERO_TOTAL)
    before = rank_by_range.normalize(observation)[0].idempotency_key

    original = rank_by_range.PARSER_VERSION
    rank_by_range.PARSER_VERSION = "9.9.9"
    try:
        after = rank_by_range.normalize(observation)[0].idempotency_key
    finally:
        rank_by_range.PARSER_VERSION = original

    assert before == after
