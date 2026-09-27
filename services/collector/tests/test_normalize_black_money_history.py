"""dragon.battle.history — Black Money team results back to April."""

from __future__ import annotations

import uuid
from collections import Counter

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import black_money_history
from tests.conftest import load_observation

HISTORY = "dragon.battle.history/history_v1.json"


def test_registered() -> None:
    assert registry.get("dragon.battle.history") is black_money_history.normalize


def test_one_row_per_team_per_event() -> None:
    rows = black_money_history.normalize(load_observation(HISTORY))

    assert len(rows) == 25
    assert {r.target_table for r in rows} == {"black_money_battle_snapshots"}
    assert rows[0].row["battle_ended_at"] == "2026-09-27T12:50:00+00:00"
    assert rows[-1].row["battle_ended_at"] == "2026-04-19T21:50:00+00:00"
    assert {r.row["team_index"] for r in rows} == {1, 2}


def test_todays_team_b_result() -> None:
    """Read off the screen on 09-27: B beat RENS 382,529 to 284,451, 21 of
    ours entered against 22 of theirs — one more than the 20 starters."""
    latest = black_money_history.normalize(load_observation(HISTORY))[0].row

    assert latest["team_index"] == 2
    assert (latest["score"], latest["enemy_score"]) == (382529, 284451)
    assert (latest["user_num"], latest["enemy_user_num"]) == (21, 22)
    assert latest["max_user_num"] == 20
    assert latest["state"] == 2


def test_state_two_is_a_win() -> None:
    """state 2 on exactly the entries where our score beats theirs."""
    rows = black_money_history.normalize(load_observation(HISTORY))

    assert Counter(r.row["state"] for r in rows) == {2: 14, 3: 11}
    for r in rows:
        assert (r.row["state"] == 2) == (r.row["score"] > r.row["enemy_score"])


def test_enemy_alliance_id_is_not_trusted() -> None:
    """The wire's enemyAllianceId repeats OUR id on every entry that carries
    it, so it is neither stored nor used as the opponent."""
    rows = black_money_history.normalize(load_observation(HISTORY))

    carrying = [r for r in rows if "enemyAllianceId" in r.row["raw"]]
    assert len(carrying) == 24
    for r in carrying:
        assert r.row["raw"]["enemyAllianceId"] == r.row["alliance_external_id"]
    for r in rows:
        assert "enemy_alliance_external_id" not in r.row
        assert r.entity_refs["alliance"]["external_id"] == r.row["alliance_external_id"]


def test_a_missing_enemy_name_is_kept_as_null() -> None:
    rows = black_money_history.normalize(load_observation(HISTORY))
    nameless = [r.row for r in rows if r.row["enemy_name"] is None]

    assert len(nameless) == 1
    assert nameless[0]["battle_ended_at"] == "2026-05-03T12:50:00+00:00"
    assert nameless[0]["enemy_score"] is not None


def test_subject_server_is_where_it_was_observed() -> None:
    rows = black_money_history.normalize(load_observation(HISTORY))

    assert {r.row["server_id"] for r in rows} == {580}


def test_a_battle_keeps_its_key_across_screen_opens() -> None:
    """A finished battle repeats unchanged in every response. A new envelope
    around the same entries must not mint new keys, or each open of the
    screen would store the whole history again."""
    observation = load_observation(HISTORY)
    reopened = observation.model_copy(
        update={
            "observation_id": uuid.UUID(int=1),
            "captured_at": observation.captured_at.replace(hour=20),
            "payload": {**observation.payload, "_id": 999, "_time": 7},
        }
    )

    first = [r.idempotency_key for r in black_money_history.normalize(observation)]
    second = [r.idempotency_key for r in black_money_history.normalize(reopened)]

    assert first == second
    assert len(set(first)) == 25


def test_a_changed_entry_is_a_new_fact() -> None:
    observation = load_observation(HISTORY)
    entries = [dict(e) for e in observation.payload["historyArr"]]
    entries[0]["score"] += 1
    changed = observation.model_copy(update={"payload": {"historyArr": entries}})

    before = black_money_history.normalize(observation)
    after = black_money_history.normalize(changed)

    assert before[0].idempotency_key != after[0].idempotency_key
    assert [r.idempotency_key for r in before[1:]] == [r.idempotency_key for r in after[1:]]


def test_missing_battle_time_rejected() -> None:
    with pytest.raises(ValidationError):
        black_money_history.normalize(
            load_observation("dragon.battle.history/history_malformed_v1.json")
        )
