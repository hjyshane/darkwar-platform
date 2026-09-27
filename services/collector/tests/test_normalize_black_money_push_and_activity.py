"""push.mail and dragon.activity.info — the two routes team A's 2026-09-27
result actually arrived by, when nobody opened the inbox or the history."""

from __future__ import annotations

from collections import Counter

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import black_money_activity, black_money_history, black_money_report
from tests.conftest import load_observation

PUSHED = "push.mail/report_team_a_pushed_v1.json"
FOUGHT = "dragon.activity.info/both_teams_fought_v1.json"
NOT_YET = "dragon.activity.info/team_a_not_yet_fought_v1.json"


def test_registered() -> None:
    assert registry.get("push.mail") is black_money_report.normalize_pushed
    assert registry.get("dragon.activity.info") is black_money_activity.normalize


# --- push.mail ------------------------------------------------------------


def test_a_pushed_report_is_read_like_one_from_the_inbox() -> None:
    rows = black_money_report.normalize_pushed(load_observation(PUSHED))
    sides = Counter((r.row["side"], r.row["win"], r.row["server_id"]) for r in rows)

    assert {r.target_table for r in rows} == {"black_money_score_snapshots"}
    assert sides == {(0, 1, 580): 17, (1, 0, 588): 17}
    assert max(r.row["score"] for r in rows if r.row["side"] == 0) == 836376


def test_a_pushed_and_a_fetched_copy_share_one_key() -> None:
    """The same report can arrive pushed and later with the inbox. Both must
    land on the same key, or every score in the battle is stored twice."""
    pushed = load_observation(PUSHED)
    fetched = pushed.model_copy(
        update={"source_command": "chat.get.system.mails", "payload": {"msg": [pushed.payload]}}
    )

    pushed_keys = [r.idempotency_key for r in black_money_report.normalize_pushed(pushed)]
    fetched_keys = [r.idempotency_key for r in black_money_report.normalize(fetched)]

    assert pushed_keys == fetched_keys
    assert all(key.split(":")[1] == "chat.get.system.mails" for key in pushed_keys)


def test_other_pushed_mail_writes_nothing() -> None:
    """push.mail also carries player-to-player mail. None of it is read."""
    observation = load_observation(PUSHED)
    personal = observation.model_copy(
        update={"payload": {"uid": "2", "type": 1, "contentsLocal": "hello"}}
    )

    assert black_money_report.normalize_pushed(personal) == []


def test_a_malformed_pushed_report_is_skipped_not_raised() -> None:
    rows = black_money_report.normalize_pushed(
        load_observation("push.mail/report_malformed_v1.json")
    )

    assert rows == []


# --- dragon.activity.info --------------------------------------------------


def test_both_teams_once_both_have_fought() -> None:
    rows = black_money_activity.normalize(load_observation(FOUGHT))
    by_team = {r.row["team_index"]: r.row for r in rows}

    assert {r.target_table for r in rows} == {"black_money_battle_snapshots"}
    assert set(by_team) == {1, 2}
    a = by_team[1]
    assert a["battle_ended_at"] == "2026-09-27T21:50:00+00:00"
    assert (a["score"], a["enemy_score"]) == (615634, 148607)
    assert (a["user_num"], a["enemy_user_num"], a["max_user_num"]) == (17, 17, 20)
    assert a["state"] == 2


def test_a_battle_not_yet_fought_writes_nothing() -> None:
    """At 13:07 team B had fought and team A had not."""
    rows = black_money_activity.normalize(load_observation(NOT_YET))

    assert [r.row["team_index"] for r in rows] == [2]


def test_it_agrees_with_the_history_field_for_field() -> None:
    """Team B's 09-27 battle is in both responses. Every column the view
    reads must say the same thing whichever one wrote the row."""
    from_activity = next(
        r.row
        for r in black_money_activity.normalize(load_observation(FOUGHT))
        if r.row["team_index"] == 2
    )
    from_history = black_money_history.normalize(
        load_observation("dragon.battle.history/history_v1.json")
    )[0].row

    for column in (
        "battle_ended_at",
        "team_index",
        "state",
        "score",
        "user_num",
        "max_user_num",
        "enemy_score",
        "enemy_user_num",
    ):
        assert from_activity[column] == from_history[column], column


def test_ours_is_the_alliance_in_every_matchup() -> None:
    rows = black_money_activity.normalize(load_observation(FOUGHT))

    assert len({r.row["alliance_external_id"] for r in rows}) == 1
    # And it is not either opponent.
    for r in rows:
        opponents = {s["allianceId"] for s in r.row["raw"]["vsInfoArr"]} - {
            r.row["alliance_external_id"]
        }
        assert len(opponents) == 1


def test_one_team_cannot_say_which_alliance_is_ours() -> None:
    observation = load_observation(FOUGHT)
    one_team = observation.model_copy(
        update={"payload": {**observation.payload, "teamArr": observation.payload["teamArr"][:1]}}
    )

    assert black_money_activity.normalize(one_team) == []


def test_a_battle_keeps_its_key_across_logins() -> None:
    observation = load_observation(FOUGHT)
    again = observation.model_copy(update={"payload": {**observation.payload, "_id": 999}})

    first = [r.idempotency_key for r in black_money_activity.normalize(observation)]
    second = [r.idempotency_key for r in black_money_activity.normalize(again)]

    assert first == second


def test_malformed_activity_rejected() -> None:
    with pytest.raises(ValidationError):
        black_money_activity.normalize(
            load_observation("dragon.activity.info/activity_malformed_v1.json")
        )
