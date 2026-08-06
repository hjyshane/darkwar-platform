"""What gets said, and what stops it being said twice.

Every assertion here is about something that fails without an error: a key that
varies when it should not posts the same thing to 94 people again, a body over
Discord's cap takes the whole request down with a 400, and announcing an
unmeasured member as promoted is a false statement about somebody's conduct.
"""

from __future__ import annotations

import pytest

from dw_collector.notify.compose import (
    BODY_LIMIT,
    TITLE_LIMIT,
    attachment_name,
    clamp,
    departure_message,
    discord_payload,
    guide_message,
    notice_message,
    rank_period_message,
    split_images,
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


def test_an_unconfirmed_departure_cannot_be_composed_at_all() -> None:
    """0067's comment is an instruction, and the first version disobeyed it.

    "An unscrolled capture looks exactly like a departure and must not be reported
    as one." The first version read that, posted anyway, and appended a warning
    line — and 20 present members were announced as having left the alliance.

    So it raises now. A message that cannot be safely sent should not be
    constructible, which puts the rule somewhere a caller cannot forget it.
    """
    row_data = {
        "channel": "reports",
        "alliance_name": "HELLBOUND",
        "alliance_id": "a1",
        "game_uid": 1,
        "last_known_name": "StillHere",
        "last_power": None,
        "last_seen_in_alliance_at": "2026-08-01T00:00:00+00:00",
    }
    with pytest.raises(ValueError, match="unconfirmed"):
        departure_message(**row_data, confirmed=False)
    # Null is not "fine either" — the view returns null when it has no member
    # count to measure against, which is the same absence of evidence.
    with pytest.raises(ValueError, match="unconfirmed"):
        departure_message(**row_data, confirmed=None)

    ok = departure_message(**row_data, confirmed=True)
    assert "StillHere" in ok.body


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


# --- guides ----------------------------------------------------------------


def test_a_guide_is_keyed_on_when_it_was_published() -> None:
    """Editing a published guide must not announce it again.

    A typo fix leaves `published_at` alone, so the key is unchanged and the outbox
    swallows it. Unpublishing and publishing again sets a new timestamp, which is
    a new publication and worth saying — that distinction is the whole reason the
    key carries the date rather than only the id.
    """
    base = {
        "channel": "reports",
        "guide_id": "g1",
        "title": "Arena line-ups",
        "category": "strategy",
    }
    first = guide_message(**base, body="Tanks first.", published_at="2026-08-06T10:00:00+00:00")
    edited = guide_message(
        **base, body="Tanks first, always.", published_at="2026-08-06T10:00:00+00:00"
    )
    republished = guide_message(
        **base, body="Tanks first.", published_at="2026-08-07T10:00:00+00:00"
    )

    assert first.idempotency_key == edited.idempotency_key
    assert first.idempotency_key != republished.idempotency_key


def test_a_guide_body_goes_through_unchanged() -> None:
    """The subset was chosen so it survives the trip.

    Discord reads `**bold**`, backtick code, `[text](url)`, `- bullets` and `##`
    headings the same way `lib/richText` does. Nothing here rewrites the text, so
    the board and the channel show the same words — which is why tables and images
    were left out of the subset rather than translated.
    """
    body = "## Setup\n\n- **tanks** first\n- see [the board](https://example.com)\n\n`al.rank`"
    message = guide_message(
        channel="reports",
        guide_id="g1",
        title="T",
        body=body,
        category="tip",
        published_at="2026-08-06T10:00:00+00:00",
    )
    assert body in message.body


def test_the_dashboard_link_is_left_out_when_there_is_no_url() -> None:
    """A link to nowhere is worse than no link.

    It exists because a long guide's body is clamped to Discord's embed limit and
    the reader who hits the cut needs somewhere to go. With no configured URL there
    is nowhere, so the line is absent rather than broken.
    """
    args = {
        "channel": "reports",
        "guide_id": "g1",
        "title": "T",
        "body": "x",
        "category": "tip",
        "published_at": "2026-08-06T10:00:00+00:00",
    }
    assert "dashboard" not in guide_message(**args).body
    linked = guide_message(**args, dashboard_url="https://example.com/")
    assert "https://example.com/#/guides" in linked.body


def test_the_kind_is_spelled_out() -> None:
    """`strategy` is a database value; "Strategy" is what a reader wants."""
    message = guide_message(
        channel="reports",
        guide_id="g1",
        title="T",
        body="x",
        category="strategy",
        published_at="2026-08-06T10:00:00+00:00",
    )
    assert "Strategy" in message.body


# --------------------------------------------------------------------- images
#
# The dashboard renders `![alt](url)` as a picture; Discord prints those
# characters. So the channel gets the image on the embed and the text without it,
# and the two places show a guide that reads the same rather than one carrying
# stray markup.

OURS = "http://127.0.0.1:54321/storage/v1/object/public/post-images/u/1.png"


def test_split_images_lifts_the_line_out_of_the_text() -> None:
    text, images = split_images(f"before\n![a map]({OURS})\nafter")
    assert images == [OURS]
    assert "![" not in text
    assert "before" in text and "after" in text


def test_split_images_keeps_the_order_it_found_them() -> None:
    body = f"![one]({OURS}?a)\n\n![two]({OURS}?b)"
    _, images = split_images(body)
    assert images == [f"{OURS}?a", f"{OURS}?b"]


def test_split_images_leaves_an_inline_image_alone() -> None:
    """Only a line that is ONLY an image counts, matching lib/richText's rule.

    Half a sentence around a picture is a layout question the subset does not
    answer, and lifting the URL out would leave the sentence with a hole in it.
    """
    body = f"see this ![x]({OURS}) here"
    text, images = split_images(body)
    assert images == []
    assert text == body


def test_split_images_does_not_leave_a_paragraph_gap_behind() -> None:
    text, _ = split_images(f"one\n\n![x]({OURS})\n\ntwo")
    assert "\n\n\n" not in text


def test_a_guide_with_a_picture_carries_it_on_the_embed() -> None:
    message = guide_message(
        channel="reports",
        guide_id="g1",
        title="T",
        body=f"Tanks first.\n\n![line-up]({OURS})",
        category="strategy",
        published_at="2026-08-06T10:00:00+00:00",
    )
    assert message.image_url == OURS
    # Not in the text as well: Discord would print the markup verbatim.
    assert "![" not in message.body
    payload = discord_payload(message)
    embed = payload["embeds"][0]  # type: ignore[index]
    # `attachment://`, NOT the object's URL. The bucket is private (0083), so a URL
    # here would be unfetchable by Discord and a signed one would expire in the
    # channel — the worker uploads the file beside this payload instead.
    assert embed["image"] == {"url": "attachment://picture.png"}  # type: ignore[index]


def test_the_attachment_name_matches_what_the_embed_refers_to() -> None:
    """The one contract that fails silently. A mismatch renders an embed with no
    picture and no error, so both sides come from one function."""
    for url, expected in [
        (f"{OURS}", "picture.png"),
        ("http://h/storage/v1/object/public/post-images/u/a.jpg", "picture.jpg"),
        ("http://h/storage/v1/object/public/post-images/u/a.webp", "picture.webp"),
        ("http://h/storage/v1/object/public/post-images/u/a.gif", "picture.gif"),
    ]:
        assert attachment_name(url) == expected
        message = guide_message(
            channel="c",
            guide_id="g",
            title="T",
            body=f"![x]({url})",
            category="tip",
            published_at="2026-08-06T10:00:00+00:00",
        )
        embed = discord_payload(message)["embeds"][0]  # type: ignore[index]
        assert embed["image"] == {"url": f"attachment://{expected}"}  # type: ignore[index]


def test_an_odd_extension_is_not_carried_into_the_filename() -> None:
    """An allowlist, not the string. A URL ending `.php` must not become a filename
    Discord serves under that name."""
    assert attachment_name("http://h/storage/v1/object/public/post-images/u/a.php") == "picture.png"
    assert attachment_name("http://h/storage/v1/object/public/post-images/u/noext") == "picture.png"


def test_a_guide_with_several_says_so_rather_than_posting_a_wall() -> None:
    message = guide_message(
        channel="reports",
        guide_id="g1",
        title="T",
        body=f"![a]({OURS}?a)\n\n![b]({OURS}?b)\n\n![c]({OURS}?c)",
        category="tip",
        published_at="2026-08-06T10:00:00+00:00",
    )
    assert message.image_url == f"{OURS}?a"
    assert "3 pictures" in message.body


def test_a_guide_with_no_picture_has_no_image_key() -> None:
    """An embed carrying `image: null` is a 400 from Discord, not an embed
    without a picture."""
    message = guide_message(
        channel="reports",
        guide_id="g1",
        title="T",
        body="just words",
        category="tip",
        published_at="2026-08-06T10:00:00+00:00",
    )
    assert message.image_url is None
    embed = discord_payload(message)["embeds"][0]  # type: ignore[index]
    assert "image" not in embed


def test_the_link_points_at_the_guide_rather_than_the_board() -> None:
    message = guide_message(
        channel="reports",
        guide_id="abc-123",
        title="T",
        body="words",
        category="tip",
        published_at="2026-08-06T10:00:00+00:00",
        dashboard_url="https://example.invalid/",
    )
    assert "#/guides/abc-123" in message.body


# ---------------------------------------------------------------------- notices
#
# A notice travels exactly like a guide, and the assertions worth having are the
# two that fail silently: a key that changes when it should not posts the same
# notice to 94 people twice, and one that does not change when it should leaves a
# rescheduled event unannounced.


def test_a_typo_fix_does_not_re_announce_a_notice() -> None:
    """Keyed on when it goes LIVE, not on when it was last edited.

    `updated_at` would make every correction a fresh post.
    """
    base = {
        "channel": "reports",
        "announcement_id": "n1",
        "title": "Bear hunt Saturday",
        "live_at": "2026-08-06T10:00:00+00:00",
    }
    first = notice_message(**base, body="At 20:00 UTC")
    fixed = notice_message(**base, body="At 21:00 UTC — corrected")
    assert first.idempotency_key == fixed.idempotency_key


def test_moving_the_start_date_is_a_new_announcement() -> None:
    base = {
        "channel": "reports",
        "announcement_id": "n1",
        "title": "Bear hunt",
        "body": "x",
    }
    saturday = notice_message(**base, live_at="2026-08-08T10:00:00+00:00")
    sunday = notice_message(**base, live_at="2026-08-09T10:00:00+00:00")
    assert saturday.idempotency_key != sunday.idempotency_key


def test_a_notice_links_to_itself_and_is_labelled() -> None:
    message = notice_message(
        channel="reports",
        announcement_id="abc-1",
        title="T",
        body="words",
        live_at="2026-08-06T10:00:00+00:00",
        dashboard_url="https://example.invalid/",
    )
    assert message.event == "notices"
    assert "_Notice_" in message.body
    assert "#/notices/abc-1" in message.body


def test_a_notice_carries_a_picture_the_same_way_a_guide_does() -> None:
    """The board renders `![alt](url)` and Discord prints it verbatim, so the same
    lifting applies — a notice with a picture must not arrive as markup."""
    message = notice_message(
        channel="reports",
        announcement_id="n1",
        title="T",
        body=f"Look at this.\n\n![map]({OURS})",
        live_at="2026-08-06T10:00:00+00:00",
    )
    assert message.image_url == OURS
    assert "![" not in message.body
