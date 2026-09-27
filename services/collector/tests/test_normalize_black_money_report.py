"""chat.get.system.mails — Black Money battle reports, the only source of
per-player scores and of who actually entered."""

from __future__ import annotations

import json
from collections import Counter

import pytest
from pydantic import ValidationError

from dw_collector import pipeline, registry
from dw_collector.normalize import black_money_report
from tests.conftest import load_observation

TEAM_B = "chat.get.system.mails/report_team_b_v1.json"
TEAM_A = "chat.get.system.mails/report_team_a_v1.json"
TEAM_A_OTHER = "chat.get.system.mails/report_team_a_other_recipient_v1.json"


def test_registered() -> None:
    assert registry.get("chat.get.system.mails") is black_money_report.normalize


def test_both_sides_of_the_battle() -> None:
    """21 of ours entered today, as dragon.battle.history's userNum said,
    against 22 from RENS on 581."""
    rows = black_money_report.normalize(load_observation(TEAM_B))
    sides = Counter((r.row["side"], r.row["win"], r.row["server_id"]) for r in rows)

    assert {r.target_table for r in rows} == {"black_money_score_snapshots"}
    assert sides == {(0, 1, 580): 21, (1, 0, 581): 22}
    assert len({r.row["alliance_external_id"] for r in rows}) == 2


def test_a_score_and_its_five_parts() -> None:
    rows = black_money_report.normalize(load_observation(TEAM_B))
    ours = [r.row for r in rows if r.row["side"] == 0]
    top = max(ours, key=lambda r: r["score"])

    assert top["score"] == 578571
    assert top["kill_score"] == 375371
    parts = ("kill_score", "occupy_score", "first_occupy_score", "collect_score", "escort_score")
    # The parts add up to the total for every player in the report.
    for r in rows:
        assert sum(r.row[p] for p in parts) == r.row["score"]


def test_player_scores_are_not_the_team_score() -> None:
    """The team's 382,529 is battle points. The players' scores sum to
    something an order of magnitude larger and must not be compared."""
    rows = black_money_report.normalize(load_observation(TEAM_B))

    assert sum(r.row["score"] for r in rows if r.row["side"] == 0) == 4978293


def test_other_mail_is_ignored() -> None:
    observation = load_observation(TEAM_B)
    other = {"uid": "2", "type": 109, "sendTime": 1, "contentsLocal": "not a report"}
    mixed = observation.model_copy(
        update={"payload": {**observation.payload, "msg": [other, *observation.payload["msg"]]}}
    )

    assert len(black_money_report.normalize(mixed)) == 43
    assert (
        black_money_report.normalize(mixed.model_copy(update={"payload": {"msg": [other]}})) == []
    )


def test_a_page_with_no_mail_list_yields_nothing() -> None:
    observation = load_observation(TEAM_B)

    assert (
        black_money_report.normalize(observation.model_copy(update={"payload": {"more": False}}))
        == []
    )


def test_one_report_two_recipients_one_set_of_keys() -> None:
    """Two of our accounts opened the 09-13 team A report under different
    mail uids. Both copies must land on the same keys, or every score in
    the battle is stored once per inbox."""
    a = load_observation(TEAM_A)
    b = load_observation(TEAM_A_OTHER)
    assert a.payload["msg"][0]["uid"] != b.payload["msg"][0]["uid"]
    assert a.payload["msg"][0]["toUser"] != b.payload["msg"][0]["toUser"]

    keys_a = [r.idempotency_key for r in black_money_report.normalize(a)]
    keys_b = [r.idempotency_key for r in black_money_report.normalize(b)]

    assert keys_a == keys_b
    assert len(set(keys_a)) == 39


def test_different_battles_do_not_collide() -> None:
    a = {r.idempotency_key for r in black_money_report.normalize(load_observation(TEAM_A))}
    b = {r.idempotency_key for r in black_money_report.normalize(load_observation(TEAM_B))}

    assert a.isdisjoint(b)


def test_the_opponent_is_named_by_its_real_id() -> None:
    """Unlike the history's enemyAllianceId, the report names the opponent by
    its own id, and resolves it as an alliance on the opponent's server."""
    rows = black_money_report.normalize(load_observation(TEAM_B))
    theirs = {r.row["alliance_external_id"] for r in rows if r.row["side"] == 1}
    ours = {r.row["alliance_external_id"] for r in rows if r.row["side"] == 0}

    assert len(theirs) == 1
    assert theirs.isdisjoint(ours)
    assert {r.entity_refs["alliance"]["server_id"] for r in rows if r.row["side"] == 1} == {581}


def test_optional_score_parts_may_be_missing() -> None:
    observation = load_observation(TEAM_B)
    body = {
        "obj": {"scoreInfo": [{"allianceId": "a" * 32, "userArr": [{"uid": "9123456789000580"}]}]}
    }
    mail = {"uid": "3", "type": 147, "sendTime": 1790513645900, "contentsLocal": json.dumps(body)}

    (row,) = black_money_report.normalize(
        observation.model_copy(update={"payload": {"msg": [mail]}})
    )

    assert row.row["server_id"] == 580
    assert row.row["score"] is None
    assert row.row["win"] is None


def test_malformed_report_yields_no_rows() -> None:
    """A malformed report is skipped rather than raised: raising would make
    ingest drop the whole inbox page, raw payload included."""
    rows = black_money_report.normalize(
        load_observation("chat.get.system.mails/report_malformed_v1.json")
    )

    assert rows == []


def test_a_bad_report_does_not_take_the_good_ones_with_it() -> None:
    observation = load_observation(TEAM_B)
    broken = {"uid": "4", "type": 147, "sendTime": 1, "contentsLocal": "{not json"}
    page = {**observation.payload, "msg": [broken, *observation.payload["msg"]]}

    rows = black_money_report.normalize(observation.model_copy(update={"payload": page}))

    assert len(rows) == 43


def test_a_page_that_is_not_a_mail_list_is_rejected() -> None:
    """The page itself is still validated: a `msg` that is not a list is a
    different command shape, not a bad mail, and fails loudly."""
    observation = load_observation(TEAM_B)

    with pytest.raises(ValidationError):
        black_money_report.normalize(
            observation.model_copy(update={"payload": {"msg": "not a list"}})
        )


def test_no_activity_facts() -> None:
    rows = pipeline.process(load_observation(TEAM_B))

    assert {r.target_table for r in rows} == {"black_money_score_snapshots"}
