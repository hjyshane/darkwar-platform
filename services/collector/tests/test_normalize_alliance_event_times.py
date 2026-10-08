"""The times the alliance chose for the siege, Frankie and Black Gold.

What this pins: the numbers the alliance set on 2026-10-08 come out as the
server-time clock the members read (server time is UTC-2, so the game's
"00:30" is 02:30 UTC). The siege fixture is the real response of that day,
the boss one has the members' own damage removed.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from dw_collector import registry
from dw_collector.normalize import alliance_event_times, black_money_activity
from tests.conftest import load_observation

SIEGE = "monster.siege.activity.info/siege_v1.json"
BOSS = "get.alliance.boss.activity.info.new/boss_v1.json"
BLACK_GOLD = "dragon.activity.info/team_a_not_yet_fought_v1.json"
SERVER = timedelta(hours=-2)


def server_clock(iso: str) -> str:
    """`MM-DD HH:MM` on the clock the members read."""
    return (datetime.fromisoformat(iso).astimezone(UTC) + SERVER).strftime("%m-%d %H:%M")


def test_registered() -> None:
    assert registry.get("monster.siege.activity.info") is alliance_event_times.normalize_siege
    assert (
        registry.get("get.alliance.boss.activity.info.new") is alliance_event_times.normalize_boss
    )


def test_the_siege_starts_when_the_alliance_said() -> None:
    (row,) = alliance_event_times.normalize_siege(load_observation(SIEGE))

    assert row.target_table == "alliance_event_times"
    assert (row.row["event_key"], row.row["slot"]) == ("zombie_siege", 1)
    assert server_clock(row.row["starts_at"]) == "10-08 11:30"
    # An open siege has no end yet.
    assert row.row["ends_at"] is None
    # Nothing in the response names the alliance: the database resolves it.
    assert row.entity_refs == {}


def test_frankie_has_two_battles_a_day() -> None:
    rows = alliance_event_times.normalize_boss(load_observation(BOSS))

    assert [(r.row["event_key"], r.row["slot"]) for r in rows] == [
        ("bio_mutant", 1),
        ("bio_mutant", 2),
    ]
    assert [server_clock(r.row["starts_at"]) for r in rows] == ["10-08 00:30", "10-08 13:00"]
    assert all(r.row["ends_at"] is not None for r in rows)


def test_a_boss_response_without_battles_writes_nothing() -> None:
    observation = load_observation(BOSS)
    bare = observation.model_copy(update={"payload": {"lastChangeTime": 0}})

    assert alliance_event_times.normalize_boss(bare) == []


def test_a_start_that_is_not_a_date_the_game_meant_writes_nothing() -> None:
    observation = load_observation(SIEGE)
    for value in (0, -5, True, "1791466200000", 17914662):
        payload = {**observation.payload, "siegeST": value}
        assert (
            alliance_event_times.normalize_siege(
                observation.model_copy(update={"payload": payload})
            )
            == []
        )


def test_the_same_pick_is_one_key_however_often_it_is_seen() -> None:
    observation = load_observation(SIEGE)
    later = observation.model_copy(
        update={"captured_at": observation.captured_at + timedelta(hours=1)}
    )
    (a,) = alliance_event_times.normalize_siege(observation)
    (b,) = alliance_event_times.normalize_siege(later)
    moved = {**observation.payload, "siegeST": observation.payload["siegeST"] + 1_800_000}
    (c,) = alliance_event_times.normalize_siege(observation.model_copy(update={"payload": moved}))

    assert a.idempotency_key == b.idempotency_key
    assert c.idempotency_key != a.idempotency_key


def test_black_gold_teams_come_with_the_alliance_that_fields_them() -> None:
    rows = [
        r
        for r in black_money_activity.normalize(load_observation(BLACK_GOLD))
        if r.target_table == "alliance_event_times"
    ]

    assert {r.row["slot"] for r in rows} == {1, 2}
    assert all(r.row["event_key"] == "black_gold" for r in rows)
    assert all(r.entity_refs["alliance"]["external_id"] for r in rows)
    assert all(r.row["prep_at"] is not None and r.row["ends_at"] is not None for r in rows)
    # The battle opens five minutes after the preparation hour.
    for r in rows:
        opens = datetime.fromisoformat(r.row["starts_at"])
        prep = datetime.fromisoformat(r.row["prep_at"])
        assert opens - prep == timedelta(minutes=5)


def test_teams_whose_opponent_is_not_drawn_yet_still_give_their_times() -> None:
    """The response before the match-up names only our alliance; the opponent is
    `""` in both teams. That used to read as two alliances in common and wrote
    nothing, so the times were missing exactly when they are announced."""
    observation = load_observation("dragon.activity.info/teams_not_matched_yet_v1.json")

    rows = black_money_activity.normalize(observation)

    schedule = [r for r in rows if r.target_table == "alliance_event_times"]
    assert {r.row["slot"] for r in schedule} == {1, 2}
    # Nothing has been fought: no battle row.
    assert [r for r in rows if r.target_table == "black_money_battle_snapshots"] == []
