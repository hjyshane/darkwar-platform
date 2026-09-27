"""dragon.assign.player.info — the Black Money signup list.

What this pins is the encoding the officers' assignments arrive in: team by
`teamIndex`, starter or substitute by `state`, and the whole alliance listed
whether or not they signed up.
"""

from __future__ import annotations

from collections import Counter

import pytest
from pydantic import ValidationError

from dw_collector import pipeline, registry
from dw_collector.normalize import black_money_signup
from tests.conftest import load_observation

SIGNUP = "dragon.assign.player.info/signup_v1.json"


def test_registered() -> None:
    assert registry.get("dragon.assign.player.info") is black_money_signup.normalize


def test_the_whole_alliance_is_listed() -> None:
    """71 members, not only the signed-up ones: 16 are on neither team."""
    rows = black_money_signup.normalize(load_observation(SIGNUP))

    assert len(rows) == 71
    assert {r.target_table for r in rows} == {"black_money_signup_snapshots"}
    assert sum(r.row["team_index"] is None for r in rows) == 16


def test_each_team_fields_twenty_starters() -> None:
    """state 1 is a starter and the cap is 20 per team, which is what the
    screen showed for both A (teamIndex 1) and B (teamIndex 2) on 09-27."""
    rows = black_money_signup.normalize(load_observation(SIGNUP))
    slots = Counter((r.row["team_index"], r.row["state"]) for r in rows)

    assert slots[(1, 1)] == 20
    assert slots[(2, 1)] == 20
    assert slots[(1, 2)] == 6
    assert slots[(2, 2)] == 9
    # Nobody unassigned holds a team, and nobody on a team is unassigned.
    assert slots[(None, 0)] == 16
    assert not any(team is None and state != 0 for team, state in slots)


def test_an_empty_slot_list_is_null_not_a_slot() -> None:
    rows = black_money_signup.normalize(load_observation(SIGNUP))

    assert sum(r.row["time_index_record"] is None for r in rows) == 13
    assert "" not in {r.row["time_index_record"] for r in rows}
    assert "2;3" in {r.row["time_index_record"] for r in rows}


def test_home_server_comes_from_the_uid() -> None:
    """The list carries serverId, and it agrees with the uid suffix."""
    rows = black_money_signup.normalize(load_observation(SIGNUP))

    assert {r.row["server_id"] for r in rows} == {580}
    assert all(str(r.row["game_uid"]).endswith("000580") for r in rows)
    assert all(r.entity_refs["player"]["game_uid"] == r.row["game_uid"] for r in rows)


def test_optional_fields_may_be_missing() -> None:
    observation = load_observation(SIGNUP)
    sparse = observation.model_copy(update={"payload": {"users": [{"uid": "9123456789000581"}]}})

    (row,) = black_money_signup.normalize(sparse)

    assert row.row["server_id"] == 581
    assert row.row["state"] is None
    assert row.row["team_index"] is None
    assert row.row["time_index_record"] is None


def test_malformed_uid_rejected() -> None:
    with pytest.raises(ValidationError):
        black_money_signup.normalize(
            load_observation("dragon.assign.player.info/signup_malformed_v1.json")
        )


def test_replay_is_idempotent_and_readings_are_distinct() -> None:
    """Replaying one reading reproduces its keys. A second reading of the
    list is a new snapshot — assignments move between readings."""
    observation = load_observation(SIGNUP)
    first = {r.idempotency_key for r in black_money_signup.normalize(observation)}
    again = {r.idempotency_key for r in black_money_signup.normalize(observation)}
    later = observation.model_copy(
        update={
            "captured_at": observation.captured_at.replace(minute=59),
            "payload": {**observation.payload, "_id": 999},
        }
    )

    assert first == again
    assert first.isdisjoint({r.idempotency_key for r in black_money_signup.normalize(later)})


def test_no_activity_facts() -> None:
    """A signup is not activity. Nothing but the snapshot rows comes out."""
    rows = pipeline.process(load_observation(SIGNUP))

    assert {r.target_table for r in rows} == {"black_money_signup_snapshots"}
