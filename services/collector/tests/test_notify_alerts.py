"""The three events that fire when something is wrong rather than when something happened.

These differ from the content events in one way that matters: nobody is reading the
dashboard when they arrive. That makes the KEY the whole design. A content event
keyed badly posts a guide twice and somebody rolls their eyes. A silence keyed on
"now" instead of on the outage posts every interval for as long as the outage lasts
— which, for the case the event exists to cover, is the whole time somebody is away.

So most of what is pinned here is that the same fault composes the same key twice.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx

from dw_collector.notify.worker import NotifyConfig, NotifyWorker, Row

CLAIMS: dict[str, Row] = {"player_claim": {"enabled": True, "channel": "alerts"}}
SIGNUP: dict[str, Row] = {"new_signup": {"enabled": True, "channel": "alerts"}}
SYNC: dict[str, Row] = {"sync_stalled": {"enabled": True, "channel": "alerts"}}
DATA: dict[str, Row] = {"data_stalled": {"enabled": True, "channel": "alerts"}}


def _worker(tables: dict[str, list[Row]], seen: list[httpx.URL] | None = None) -> NotifyWorker:
    """A worker whose Supabase answers per table.

    The shared helper in `test_notify_worker` answers every path with one canned
    list, which is enough for an event that reads one table. These read two or
    three, and handing `app_users` a list of collectors is a test that passes for
    the wrong reason.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request.url)
        table = request.url.path.rsplit("/", 1)[-1]
        return httpx.Response(200, json=tables.get(table, []))

    worker = NotifyWorker(NotifyConfig(supabase_url="http://supabase.test", secret_key="k"))
    worker.client.close()
    worker.client = httpx.Client(transport=httpx.MockTransport(handler))
    return worker


def _ago(**delta: float) -> str:
    return (datetime.now(UTC) - timedelta(**delta)).isoformat()


def _collector(**overrides: object) -> Row:
    row: Row = {
        "collector_id": "c0ffee00-0000-4000-8000-000000000001",
        "name": "windows-desktop",
        "last_heartbeat_at": _ago(seconds=20),
        "last_packet_at": _ago(minutes=3),
    }
    row.update(overrides)
    return row


# ------------------------------------------------------------------ switched off


def test_nothing_is_asked_of_supabase_while_an_event_is_off() -> None:
    """Off means silent, not "composed and then discarded".

    Worth its own test because these run every interval forever. An event that
    queries before checking its switch turns a disabled feature into steady load
    against the smallest Supabase instance there is.
    """
    seen: list[httpx.URL] = []
    worker = _worker({}, seen)
    assert worker.claim_candidates({}) == []
    assert worker.signup_candidates({}) == []
    assert worker.sync_stall_candidates({}) == []
    assert worker.data_stall_candidates({}) == []
    assert seen == []


# ------------------------------------------------------------------ new signups


def test_somebody_waiting_for_access_is_announced_from_the_view() -> None:
    """0123's view, not `app_users`.

    The row this is looking for is not in `app_users` at all: 0021 creates that
    row when a join code is redeemed, so an account with no code is ABSENT rather
    than present with `role = 'viewer'`.
    """
    messages = _worker(
        {
            "pending_access": [
                {
                    "user_id": "22222222-2222-4222-8222-222222222222",
                    "created_at": "2026-08-16T04:05:00+00:00",
                    "last_sign_in_at": "2026-08-16T04:06:00+00:00",
                }
            ]
        }
    ).signup_candidates(SIGNUP)
    assert len(messages) == 1
    assert "22222222" in messages[0].body


def test_signing_in_again_does_not_announce_the_same_stranger_twice() -> None:
    """Keyed on the uid alone, with no timestamp anywhere in it.

    `last_sign_in_at` moves every time they open the site hoping it works now.
    In the key, that is one message per attempt from somebody who is already
    waiting — the reader learns nothing new and stops reading.
    """

    def key_for(last_sign_in: str) -> str:
        rows = {
            "pending_access": [
                {
                    "user_id": "22222222-2222-4222-8222-222222222222",
                    "created_at": "2026-08-16T04:05:00+00:00",
                    "last_sign_in_at": last_sign_in,
                }
            ]
        }
        return _worker(rows).signup_candidates(SIGNUP)[0].idempotency_key

    assert key_for("2026-08-16T04:06:00+00:00") == key_for("2026-08-18T22:00:00+00:00")


def test_a_waiting_stranger_is_named_by_uid_and_nothing_else() -> None:
    """No email, and 0123 does not even expose one.

    They have not proved they belong to the alliance. An alert about them should
    not be the thing that publishes their address into a Discord channel that the
    officers can scroll back through forever.
    """
    body = (
        _worker(
            {
                "pending_access": [
                    {
                        "user_id": "22222222-2222-4222-8222-222222222222",
                        "created_at": "2026-08-16T04:05:00+00:00",
                        "last_sign_in_at": None,
                    }
                ]
            }
        )
        .signup_candidates(SIGNUP)[0]
        .body
    )
    assert "@" not in body


# ----------------------------------------------------------------- player claims


def test_a_pending_claim_names_the_member_and_the_player() -> None:
    messages = _worker(
        {
            "player_claims": [
                {
                    "user_id": "11111111-1111-4111-8111-111111111111",
                    "player_id": "p1",
                    "created_at": "2026-08-16T04:05:00+00:00",
                    "note": "this is me",
                    "players": {"current_name": "Shane", "game_uid": 700123},
                }
            ],
            "app_users": [
                {"user_id": "11111111-1111-4111-8111-111111111111", "display_name": "hjy"}
            ],
        }
    ).claim_candidates(CLAIMS)
    assert len(messages) == 1
    assert "hjy" in messages[0].body
    assert "Shane" in messages[0].body


def test_a_second_claim_to_a_different_player_is_not_a_duplicate() -> None:
    """`player_claims` is keyed by user, so both claims are the same ROW.

    A member claims the wrong player, is rejected, and claims the right one. Keyed
    on the user alone the second claim carries the first's key, `enqueue` treats it
    as already announced, and the admin is never told. The uid is in the key for
    this case and no other.
    """

    def key_for(uid: int) -> str:
        rows = {
            "player_claims": [
                {
                    "user_id": "11111111-1111-4111-8111-111111111111",
                    "player_id": "p1",
                    "created_at": "2026-08-16T04:05:00+00:00",
                    "note": None,
                    "players": {"current_name": None, "game_uid": uid},
                }
            ],
            "app_users": [],
        }
        return _worker(rows).claim_candidates(CLAIMS)[0].idempotency_key

    assert key_for(700123) != key_for(700999)


def test_a_claim_survives_an_unknown_player_and_an_unknown_member() -> None:
    """Both embeds can come back empty, and neither is worth dropping the alarm for.

    A claim to a player row that has since been deleted still needs deciding, and a
    member who never set a display name is most of them.
    """
    messages = _worker(
        {
            "player_claims": [
                {
                    "user_id": "11111111-1111-4111-8111-111111111111",
                    "player_id": "p1",
                    "created_at": "2026-08-16T04:05:00+00:00",
                    "note": None,
                    "players": None,
                }
            ],
            "app_users": [],
        }
    ).claim_candidates(CLAIMS)
    assert len(messages) == 1
    assert "11111111" in messages[0].body


# --------------------------------------------------------------------- silences


def test_a_live_collector_raises_nothing() -> None:
    assert _worker({"collectors": [_collector()]}).sync_stall_candidates(SYNC) == []
    assert _worker({"collectors": [_collector()]}).data_stall_candidates(DATA) == []


def test_a_silent_collector_is_announced_once_however_long_it_stays_silent() -> None:
    """THE POINT OF THE WHOLE FILE.

    Two passes an hour apart, one outage. The key is built from the last heartbeat,
    which does not move while nothing is beating, so both passes compose the same
    key and `enqueue` writes one row. Built from `now`, this would be one message
    per interval for as long as nobody is home.
    """
    rows = {"collectors": [_collector(last_heartbeat_at="2026-08-16T04:05:00+00:00")]}
    first = _worker(rows).sync_stall_candidates(SYNC)
    second = _worker(rows).sync_stall_candidates(SYNC)
    assert len(first) == 1
    assert first[0].idempotency_key == second[0].idempotency_key


def test_the_two_silences_do_not_share_a_key() -> None:
    """A dead process and a live process seeing nothing are different faults.

    Same collector, same instant, and they need different fixes — restart the
    machine, or check the capture interface. Sharing a key would let whichever
    fired first silence the other.
    """
    stalled = _collector(
        last_heartbeat_at="2026-08-16T04:05:00+00:00",
        last_packet_at="2026-08-16T04:05:00+00:00",
    )
    sync = _worker({"collectors": [stalled]}).sync_stall_candidates(SYNC)
    data = _worker({"collectors": [stalled]}).data_stall_candidates(DATA)
    assert sync[0].idempotency_key != data[0].idempotency_key


def test_a_collector_that_has_never_reported_is_not_an_outage() -> None:
    """Null is a collector that has not started, not one that stopped.

    Announced, it would fire every interval forever for a row somebody registered
    and abandoned — and an alert channel that cries wolf nightly is worse than no
    channel, because the real one arrives in a list of ignored ones.
    """
    rows = {"collectors": [_collector(last_heartbeat_at=None, last_packet_at=None)]}
    assert _worker(rows).sync_stall_candidates(SYNC) == []
    assert _worker(rows).data_stall_candidates(DATA) == []


def test_recovery_closes_the_episode_it_was_told_about() -> None:
    """The all-clear is keyed on the outage's start, not on the recovery's time.

    So it posts once. Keyed on when it recovered, a collector that flaps would
    announce a recovery per flap while the original alarm stayed keyed to one
    moment — the reader gets all-clears for an alarm they were told about once.
    """
    opened = "2026-08-16T04:05:00+00:00"
    messages = _worker(
        {
            "collectors": [_collector()],
            "notification_outbox": [
                {"idempotency_key": (f"sync_stalled:c0ffee00-0000-4000-8000-000000000001:{opened}")}
            ],
        }
    ).sync_stall_candidates(SYNC)
    assert len(messages) == 1
    assert messages[0].idempotency_key.endswith(opened)
    assert "resumed" in messages[0].idempotency_key


def test_no_recovery_is_sent_for_an_outage_that_was_never_announced() -> None:
    """A healthy collector with an empty outbox says nothing.

    Otherwise switching the event on posts an all-clear for an outage nobody was
    told about, which reads as an outage that just ended.
    """
    messages = _worker(
        {"collectors": [_collector()], "notification_outbox": []}
    ).sync_stall_candidates(SYNC)
    assert messages == []


# ------------------------------------------------------------------- reminders


REMINDERS: dict[str, Row] = {"schedule_reminder": {"enabled": True, "channel": "general"}}


def _due(**overrides: object) -> Row:
    row: Row = {
        "reminder_id": "33333333-3333-4333-8333-333333333333",
        "title": "Bear 20:00",
        "starts_at": "2026-08-20T20:00:00+00:00",
        "minutes_before": 30,
        "category_label": "Bear hunt",
        "channel": "alarm",
    }
    row.update(overrides)
    return row


def test_a_reminder_goes_to_its_category_channel_not_the_default() -> None:
    """One webhook per board is the point of the category carrying a channel.

    The routing entry says 'general'; the bear board says 'alarm'. Falling back
    when there is nothing to fall back FROM would put every board's reminders in
    one channel, which is the arrangement the categories exist to replace.
    """
    messages = _worker({"schedule_reminders_due": [_due()]}).reminder_candidates(REMINDERS)
    assert messages[0].channel == "alarm"


def test_an_uncategorised_entry_falls_back_to_the_settings_channel() -> None:
    messages = _worker({"schedule_reminders_due": [_due(channel=None)]}).reminder_candidates(
        REMINDERS
    )
    assert messages[0].channel == "general"


def test_the_query_asks_for_a_window_and_not_for_everything_overdue() -> None:
    """THE ONE THAT KEEPS A WEEK AWAY FROM EMPTYING INTO THE CHANNEL.

    Without the lower bound, the first pass after the machine comes back
    announces every reminder that fell while it was off — bear hunts that ended
    on Tuesday, arriving on Friday. A reminder is about a moment, and a missed
    moment is discarded rather than deferred.
    """
    seen: list[httpx.URL] = []
    _worker({"schedule_reminders_due": []}, seen).reminder_candidates(REMINDERS)
    assert seen[0].params.get("fire_at") is not None
    assert "gte." in str(seen[0])
    assert "lte." in str(seen[0])


def test_moving_the_entry_makes_the_reminder_sayable_again() -> None:
    """`starts_at` is in the key on purpose.

    An entry pushed back an hour has already had its old time announced. Keyed on
    the reminder alone, the correction would be swallowed as a duplicate and the
    channel would be left holding the wrong time.
    """
    first = _worker({"schedule_reminders_due": [_due()]}).reminder_candidates(REMINDERS)
    moved = _worker(
        {"schedule_reminders_due": [_due(starts_at="2026-08-20T22:00:00+00:00")]}
    ).reminder_candidates(REMINDERS)
    assert first[0].idempotency_key != moved[0].idempotency_key
