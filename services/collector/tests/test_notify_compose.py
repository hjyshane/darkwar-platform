"""What gets said, and what stops it being said twice.

Every assertion here is about something that fails without an error: a key that
varies when it should not posts the same thing to 94 people again, a body over
Discord's cap takes the whole request down with a 400, and announcing an
unmeasured member as promoted is a false statement about somebody's conduct.
"""

from __future__ import annotations

from dw_collector.notify.compose import (
    BODY_LIMIT,
    TITLE_LIMIT,
    clamp,
    departure_message,
    discord_payload,
    rank_period_message,
    tier_changes,
    wiring_check_message,
)
from dw_collector.notify.worker import filter_value


def row(player_id: str, name: str, tier: str | None, reason: str = "score") -> dict:
    return {"player_id": player_id, "name": name, "tier": tier, "tier_reason": reason}


def test_rank_period_key_carries_the_scoring_version() -> None:
    """A rebuild under the same version must not post again; a new version must.

    Rebuilding produces the same answer, so announcing it twice is noise.
    Rebuilding under a NEW version produces a different answer — that is the whole
    reason scoring_version exists — and staying quiet would leave the alliance
    acting on the superseded one.
    """
    args = {
        "channel": "reports",
        "period_start": "2026-08-03T02:00:00+00:00",
        "period_end": "2026-08-17T02:00:00+00:00",
        "rows": [row("p1", "A", "R2")],
    }
    same = rank_period_message(scoring_version=4, **args)
    again = rank_period_message(scoring_version=4, **args)
    newer = rank_period_message(scoring_version=5, **args)

    assert same.idempotency_key == again.idempotency_key
    assert same.idempotency_key != newer.idempotency_key
    assert same.idempotency_key == "rank_period:2026-08-03:4"


def test_rank_period_body_names_why_anybody_is_ungraded() -> None:
    """ "12 have no tier" invites the wrong conclusion.

    An R4 without a tier is deliberate. A member with nothing captured is a
    schedule failure. On a count alone the two read identically, and only one of
    them is anybody's fault.
    """
    rows = [
        row("p1", "Worker", "R3"),
        row("p2", "Officer", None, "measured but not ranked: R4 and above"),
        row("p3", "Missing", None, "nothing was captured for this member in this period"),
    ]
    message = rank_period_message(
        channel="reports",
        period_start="2026-08-03T02:00:00+00:00",
        period_end="2026-08-17T02:00:00+00:00",
        scoring_version=4,
        rows=rows,
    )
    assert "R4 and above" in message.body
    assert "nothing was captured" in message.body
    assert "ungraded 2" in message.body


def test_tier_changes_needs_a_tier_at_both_ends() -> None:
    """First measurement is not a promotion.

    A member who was ungraded and now has R2 has not risen — they have been
    measured for the first time. Announcing that as a change would be a claim
    about their conduct that nothing supports.
    """
    previous = [row("p1", "A", "R1"), row("p2", "B", None), row("p3", "C", "R2")]
    current = [row("p1", "A", "R2"), row("p2", "B", "R2"), row("p3", "C", "R2")]
    assert tier_changes(current, previous) == [("A", "R1", "R2")]


def test_tier_changes_is_empty_without_a_previous_period() -> None:
    assert tier_changes([row("p1", "A", "R2")], []) == []


def test_departure_key_is_per_sighting_not_per_member() -> None:
    """Leaving twice is two announcements.

    Keyed on the uid alone, somebody who leaves, rejoins and leaves again would
    have the second departure swallowed by the first one's key.
    """
    base = {
        "channel": "reports",
        "alliance_name": "HELLBOUND",
        "alliance_id": "a1",
        "game_uid": 1,
        "last_known_name": "Gone",
        "last_power": 100,
        "confirmed": True,
    }
    first = departure_message(**base, last_seen_in_alliance_at="2026-07-28T00:00:00+00:00")
    later = departure_message(**base, last_seen_in_alliance_at="2026-08-20T00:00:00+00:00")
    assert first.idempotency_key != later.idempotency_key


def test_an_unconfirmed_departure_says_so() -> None:
    """0067's trap, where somebody might act on it.

    A roster capture that stopped early is short, and a short capture looks exactly
    like a departure. Announcing one as certain would have an officer asking a
    member who never left why they left.
    """
    row_data = {
        "channel": "reports",
        "alliance_name": "HELLBOUND",
        "alliance_id": "a1",
        "game_uid": 1,
        "last_known_name": "Maybe",
        "last_power": None,
        "last_seen_in_alliance_at": "2026-08-01T00:00:00+00:00",
    }
    message = departure_message(**row_data, confirmed=False)
    assert "Unconfirmed" in message.body

    confirmed = departure_message(**row_data, confirmed=True)
    assert "Unconfirmed" not in confirmed.body


def test_the_send_test_button_posts_once_however_often_it_is_pressed() -> None:
    """No timestamp in the key, deliberately.

    Somebody unsure whether it worked will press it again. Twice is a question;
    ten times is the alliance channel full of test messages.
    """
    assert (
        wiring_check_message("reports").idempotency_key
        == wiring_check_message("reports").idempotency_key
    )
    assert (
        wiring_check_message("reports").idempotency_key
        != wiring_check_message("alerts").idempotency_key
    )


def test_clamp_says_that_it_cut() -> None:
    """Truncating silently leaves a report that looks complete and is not."""
    assert clamp("short", 100) == "short"
    cut = clamp("x" * 500, 100)
    assert len(cut) == 100
    assert cut.endswith("(truncated)")


def test_payload_stays_inside_discords_caps() -> None:
    """A body over 4096 fails the request with a 400 that explains nothing.

    So the cap is enforced here rather than discovered in production on the one
    fortnight where 40 people changed rank.
    """
    rows = [row(f"p{index}", f"Member{index:03d}", "R1") for index in range(300)]
    previous = [row(f"p{index}", f"Member{index:03d}", "R3") for index in range(300)]
    message = rank_period_message(
        channel="reports",
        period_start="2026-08-03T02:00:00+00:00",
        period_end="2026-08-17T02:00:00+00:00",
        scoring_version=4,
        rows=rows,
        previous=previous,
    )
    embed = discord_payload(message)["embeds"][0]  # type: ignore[index]
    assert len(embed["title"]) <= TITLE_LIMIT
    assert len(embed["description"]) <= BODY_LIMIT
    # And it says how many it left out rather than just stopping.
    assert "more" in message.body


def test_a_quiet_period_says_nobody_moved() -> None:
    """Silence and "nothing happened" are different messages.

    With a previous period to compare against, no changes is a finding. Without
    one, there is nothing to say — and the body must not claim there was.
    """
    rows = [row("p1", "A", "R2")]
    quiet = rank_period_message(
        channel="reports",
        period_start="2026-08-03T02:00:00+00:00",
        period_end="2026-08-17T02:00:00+00:00",
        scoring_version=4,
        rows=rows,
        previous=[row("p1", "A", "R2")],
    )
    assert "Nobody changed rank" in quiet.body

    first_ever = rank_period_message(
        channel="reports",
        period_start="2026-08-03T02:00:00+00:00",
        period_end="2026-08-17T02:00:00+00:00",
        scoring_version=4,
        rows=rows,
    )
    assert "Nobody changed rank" not in first_ever.body


# --- PostgREST filter escaping ---------------------------------------------
#
# Not composition, but it belongs with the other things that fail without an
# error. This one DID fail: the first live run of dw-notify answered 400, and
# nothing in the message pointed at the cause.


def test_filter_value_escapes_the_plus_in_a_timestamp() -> None:
    """`+` in a query string decodes as a SPACE.

    A timestamptz from PostgREST reads `2026-08-03T02:00:00+00:00`. Interpolated
    raw, the server received `02:00:00 00:00` and rejected it as a bad timestamp —
    a 400 whose text mentioned neither the plus sign nor the column.
    """
    assert "%2B" in filter_value("2026-08-03T02:00:00+00:00")
    assert "+" not in filter_value("2026-08-03T02:00:00+00:00")


def test_filter_value_escapes_what_would_change_the_query() -> None:
    """A channel name is whatever an admin typed.

    `&` would end the filter and start another parameter, which is a PATCH
    matching different rows than intended rather than an error.
    """
    assert "&" not in filter_value("reports&all")
    assert " " not in filter_value("my channel")
