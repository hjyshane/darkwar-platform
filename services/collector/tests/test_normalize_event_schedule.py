"""init.activity — the server's event calendar.

What this pins: the calendar rides the same login as the account state but
is a separate row, keyed by its own content so repeated logins with the same
calendar are one row, and with the per-account fields (purchases, task
progress, completion) stripped before anything leaves the collector.
"""

from __future__ import annotations

from dw_collector.normalize import account_state, event_schedule
from tests.conftest import load_observation

SCHEDULE = "init/schedule_v1.json"


def _schedule_row(observation):  # type: ignore[no-untyped-def]
    rows = [
        r
        for r in account_state.normalize(observation)
        if r.target_table == "event_schedule_snapshots"
    ]
    assert len(rows) == 1
    return rows[0]


def test_a_login_yields_the_account_and_the_calendar() -> None:
    rows = account_state.normalize(load_observation(SCHEDULE))

    assert sorted(r.target_table for r in rows) == [
        "account_state_snapshots",
        "event_schedule_snapshots",
    ]


def test_every_event_is_kept_with_its_server() -> None:
    row = _schedule_row(load_observation(SCHEDULE))

    assert row.row["server_id"] == 580
    assert [e["id"] for e in row.row["events"]] == ["30000", "40739", "41101", "4009603", "80002"]


def test_personal_fields_are_stripped() -> None:
    """What this account bought, its task progress and whether it finished
    are not the server's calendar."""
    row = _schedule_row(load_observation(SCHEDULE))
    keys = {k for e in row.row["events"] for k in e}

    assert keys.isdisjoint({"exchangeRecord", "taskList", "taskConfigStr", "finish", "finishTime"})
    assert row.row["raw"] == {"activity": row.row["events"]}


def test_timing_extras_are_kept() -> None:
    row = _schedule_row(load_observation(SCHEDULE))
    by_id = {e["id"]: e for e in row.row["events"]}

    assert by_id["80002"]["battleOpenTime"] == 1791684000000
    assert by_id["41101"]["icecave_opentime"] == "1;1;720|2;3;720|3;5;720"
    assert by_id["40739"]["subType"] == 5


def test_the_same_calendar_from_another_login_is_one_row() -> None:
    """Logins that see the same calendar are one row — even from a different
    account, at a different time, listed in another order."""
    observation = load_observation(SCHEDULE)
    other = observation.model_copy(
        update={
            "captured_at": observation.captured_at.replace(hour=23),
            "payload": {
                **observation.payload,
                "user": {"uid": "9123456789000580", "serverId": 580},
                "activity": list(reversed(observation.payload["activity"])),
            },
        }
    )

    assert _schedule_row(observation).idempotency_key == _schedule_row(other).idempotency_key


def test_a_changed_calendar_is_a_new_row() -> None:
    observation = load_observation(SCHEDULE)
    changed = observation.model_copy(
        update={
            "payload": {
                **observation.payload,
                "activity": [
                    *observation.payload["activity"],
                    {"id": "104000", "startTime": 1791511200000},
                ],
            }
        }
    )

    assert _schedule_row(observation).idempotency_key != _schedule_row(changed).idempotency_key


def test_purchases_alone_do_not_make_a_new_calendar() -> None:
    """Buying something changes exchangeRecord, not the calendar."""
    observation = load_observation(SCHEDULE)
    activity = [dict(e) for e in observation.payload["activity"]]
    activity[2]["exchangeRecord"] = [{"id": 7, "num": 4}]
    bought = observation.model_copy(
        update={"payload": {**observation.payload, "activity": activity}}
    )

    assert _schedule_row(observation).idempotency_key == _schedule_row(bought).idempotency_key


def test_entries_without_a_numeric_id_are_dropped() -> None:
    assert event_schedule.schedule(
        {"activity": [{"id": "x"}, {"startTime": 1}, "junk", {"id": "7", "startTime": 5}]}
    ) == [{"id": "7", "startTime": 5}]


def test_a_login_without_a_calendar_writes_only_the_account() -> None:
    rows = account_state.normalize(load_observation("init/login_v1.json"))

    assert [r.target_table for r in rows] == ["account_state_snapshots"]
