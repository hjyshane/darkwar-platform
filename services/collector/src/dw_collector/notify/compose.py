"""Turning facts into Discord messages.

Pure functions, because everything that can be wrong here is wrong in the text
rather than in the plumbing: an idempotency key that varies when it should not
posts the same thing twice to 94 people, and a body that runs past Discord's
limit fails the whole request with a 400 that says nothing useful.

Nothing in this module talks to the network or to a database.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

# One PostgREST row. `dict[str, Any]` everywhere it appears, named once so the
# signatures below read as intent rather than as a repeated type argument.
Row = dict[str, Any]

# Discord's own caps. An embed description over 4096 characters, or a title over
# 256, is rejected with a 400 — so this truncates rather than letting a busy
# fortnight take the whole message down.
TITLE_LIMIT = 256
BODY_LIMIT = 4096
# Left for the marker that says text was cut. Truncating silently would leave a
# report that looks complete and is not.
ELLIPSIS = "\n… (truncated)"


@dataclass(frozen=True)
class Message:
    """One thing to say, and the key that stops it being said twice."""

    channel: str
    event: str
    idempotency_key: str
    title: str
    body: str
    # One picture for the embed, when the guide carried any. Discord renders an
    # embed's `image` but does NOT understand `![alt](url)` in a description — it
    # prints the markup verbatim — so an image has to be lifted out of the text and
    # attached here, or it arrives as clutter instead of a picture.
    image_url: str | None = None


def clamp(text: str, limit: int) -> str:
    """Cut to `limit`, saying so when it cuts."""
    if len(text) <= limit:
        return text
    if limit <= len(ELLIPSIS):
        return text[:limit]
    return text[: limit - len(ELLIPSIS)] + ELLIPSIS


# An image line, matching `lib/richText`'s block rule: alone on its line. A
# comment rather than a string above the assignment, which would look like a
# docstring and is not one.
IMAGE_LINE = re.compile(r"^!\[([^\]]*)\]\((\S+?)\)(\{wide\})?$")

# `[text]{red}` on the board is text in a colour. Discord has no colours in an
# embed description, so the markers come off and the WORDS stay: a channel
# reading "[Rally at 9]{red}" is worse than one reading "Rally at 9", and the
# emphasis was never the message.
#
# Same for `{wide}` above — a width the board honours and Discord has no notion
# of. Both are stripped here rather than being kept out of the subset, because
# the board is where these posts are read and the channel is the copy.
COLOUR_SPAN = re.compile(r"\[([^\]]+)\]\{[a-z]+\}")


def strip_board_only_markup(text: str) -> str:
    """Take out the markers Discord cannot render, keeping the text."""
    return COLOUR_SPAN.sub(r"\1", text)


ALLOWED_IMAGE_EXTENSIONS = frozenset({"png", "jpg", "jpeg", "webp", "gif"})


def attachment_name(image_url: str) -> str:
    """The filename Discord sees, which `attachment://` in the embed must match.

    The two agreeing is the whole contract — a mismatch renders an embed with no
    picture and no error at all, which is the kind of failure that gets shipped.
    Hence one function, used by both the payload and the upload.

    `picture.<ext>` rather than the object's own name: that name is a uuid and tells
    a reader nothing when they save the file. The extension is carried across
    because Discord decides whether to render an attachment inline partly from it,
    and it is taken from an ALLOWLIST rather than from the string — a URL ending
    `.php` or `.html` must not become a filename Discord serves under that name.
    """
    tail = image_url.rsplit(".", 1)[-1].split("?")[0].lower()
    extension = tail if tail in ALLOWED_IMAGE_EXTENSIONS else "png"
    return f"picture.{extension}"


def split_images(body: str) -> tuple[str, list[str]]:
    """The body without its image lines, and the image URLs in order.

    The dashboard and the channel disagree about images and this is where the
    disagreement is handled: the board renders them in place, Discord cannot, so
    they come out of the text here rather than being printed as `![…](…)`.

    URLS ARE NOT VALIDATED against the bucket. The collector is downstream of a
    body that the dashboard already refused to render as an image unless it came
    from `post-images` — checking again here would put the rule in two places, and
    the two would drift. What arrives is whatever an author typed; the worst case is
    an embed Discord declines to render, not something unsafe.

    The alt text is dropped. Discord has nowhere to put it — an embed image has no
    caption — and repeating it as a line of body text would read as a stray phrase.
    """
    kept: list[str] = []
    images: list[str] = []
    for line in body.replace("\r\n", "\n").split("\n"):
        match = IMAGE_LINE.match(line.strip())
        if match is None:
            kept.append(line)
            continue
        images.append(match.group(2))
    # Collapse the blank run an extracted image leaves behind, so the channel does
    # not get a paragraph gap where the picture used to be.
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(kept))
    return text, images


def discord_payload(message: Message) -> dict[str, object]:
    """The request body for a webhook.

    An embed rather than plain `content`: the description cap is 4096 against
    content's 2000, and a rank report for 95 members does not fit in 2000.
    """
    # Stripped at the boundary, not at the source: the row in the database is
    # what the board renders, and rewriting it on the way out is the only place
    # that knows Discord is the audience. An embed TITLE renders no markdown at
    # all, so it loses the colour markers here too — bold asterisks in a title
    # are Discord's own business and it prints them as typed either way.
    embed: dict[str, object] = {
        "title": clamp(strip_board_only_markup(message.title), TITLE_LIMIT),
        "description": clamp(strip_board_only_markup(message.body), BODY_LIMIT),
    }
    if message.image_url is not None:
        # `attachment://`, NOT the object's own URL.
        #
        # 0082 pointed Discord at a public bucket, which meant every picture the
        # alliance uploaded was readable by anybody holding the URL. 0083 closed the
        # bucket, and this is what replaces it: the worker uploads the FILE beside
        # this payload and the embed refers to its own attachment by name. Discord
        # keeps its own copy, the channel shows the picture, and nothing of ours is
        # left fetchable.
        #
        # A signed URL would not serve instead — it expires, and the channel would be
        # left with a dead thumbnail weeks later.
        embed["image"] = {"url": f"attachment://{attachment_name(message.image_url)}"}
    return {"embeds": [embed]}


def rank_period_message(
    *,
    channel: str,
    period_start: str,
    period_end: str,
    scoring_version: int,
    rows: list[Row],
    previous: list[Row] | None = None,
) -> Message:
    """A summary of one built rank period.

    The key carries the scoring VERSION as well as the period. Rebuilding a period
    under the same version produces the same answer, so it must not post again;
    building it under a new version produces a different answer, so it must. That
    distinction is the whole reason `scoring_version` exists (0071).
    """
    tiers = Counter(str(row.get("tier")) for row in rows)
    reasons = Counter(str(row.get("tier_reason")) for row in rows)

    lines = [
        f"**{period_start[:10]} → {period_end[:10]}**  ·  scoring v{scoring_version}",
        "",
        "  ".join(f"{tier} {count}" for tier, count in sorted(tiers.items()) if tier != "None")
        or "no tiers assigned",
    ]

    ungraded = tiers.get("None", 0)
    if ungraded:
        lines.append(f"ungraded {ungraded}")

    # Why anybody is ungraded, because "12 have no tier" invites the wrong
    # conclusion. An R4 without a tier is deliberate; a member with nothing
    # captured is a schedule failure and reads the same on a count alone.
    interesting = {
        reason: count for reason, count in reasons.items() if reason not in {"score", "None"}
    }
    if interesting:
        lines.append("")
        for reason, count in sorted(interesting.items()):
            lines.append(f"· {count} — {reason}")

    moved = tier_changes(rows, previous or [])
    if moved:
        lines.append("")
        lines.append(f"**Rank changes ({len(moved)})**")
        for name, was, now in moved[:25]:
            lines.append(f"· {name}: {was} → {now}")
        if len(moved) > 25:
            lines.append(f"… and {len(moved) - 25} more")
    elif previous:
        lines.append("")
        lines.append("Nobody changed rank.")

    return Message(
        channel=channel,
        event="rank_period",
        idempotency_key=f"rank_period:{period_start[:10]}:{scoring_version}",
        title="Rank period built",
        body="\n".join(lines),
    )


def tier_changes(rows: list[Row], previous: list[Row]) -> list[tuple[str, str, str]]:
    """Members whose tier differs from the previous period.

    Only where BOTH periods graded them. A member who was ungraded and now has a
    tier has not been promoted — they have been measured for the first time, and
    announcing that as a promotion would be a lie about somebody's conduct.
    """
    before = {row["player_id"]: row for row in previous}
    out: list[tuple[str, str, str]] = []
    for row in rows:
        was = before.get(row["player_id"], {}).get("tier")
        now = row.get("tier")
        if was is None or now is None or was == now:
            continue
        out.append((str(row.get("name") or row["player_id"][:8]), str(was), str(now)))
    return sorted(out)


def departure_message(
    *,
    channel: str,
    alliance_name: str | None,
    alliance_id: str,
    game_uid: int,
    last_known_name: str | None,
    last_power: int | None,
    last_seen_in_alliance_at: str,
    confirmed: bool | None,
) -> Message:
    """One member seen leaving.

    EXPLICIT ARGUMENTS, not the row dict this used to take. Taking the row meant
    this module carried its own guess at `alliance_departures`'s column names —
    and the guess was wrong: the view calls them `last_known_name`, `last_power`
    and `confirmed`, not `name`, `power` and `snapshot_complete`. Every test
    passed, because the tests handed it the same invented keys. The first live run
    answered 400.

    With named parameters the mapping lives in exactly one place — the caller's
    `select` — and a wrong column is a TypeError here rather than a message with
    "UID None" in it.

    Keyed on the last sighting, not on the uid: somebody who leaves, rejoins and
    leaves again is two departures and worth saying twice. Keyed on the uid alone,
    the second one would be swallowed.

    RAISES on an unconfirmed departure, rather than posting it with a caveat.
    0067's comment says it outright: an unscrolled capture looks exactly like a
    departure "and must not be reported as one". The first version read that,
    posted anyway, and added a warning line — and 20 present members were
    announced as having left. A message that cannot be safely sent should not be
    constructible, so the check is here as well as in the caller's filter.
    """
    if confirmed is not True:
        raise ValueError(
            f"refusing to compose an unconfirmed departure for {game_uid}: the "
            "newest roster capture did not cover the whole alliance, so absence "
            "from it is not evidence of leaving (0067)"
        )
    name = last_known_name or f"UID {game_uid}"
    last_seen = last_seen_in_alliance_at or ""
    lines = [
        f"**{name}** is no longer in the alliance roster.",
        "",
        f"Last seen in {alliance_name or 'the alliance'}: {last_seen[:16].replace('T', ' ')}Z",
    ]
    if last_power is not None:
        lines.append(f"Power at the time: {int(last_power):,}")
    return Message(
        channel=channel,
        event="departures",
        idempotency_key=f"departure:{alliance_id}:{game_uid}:{last_seen}",
        title="Member left the alliance",
        body="\n".join(lines),
    )


def guide_message(
    *,
    channel: str,
    guide_id: str,
    title: str,
    body: str,
    category: str,
    published_at: str,
    dashboard_url: str | None = None,
) -> Message:
    """A guide the alliance just published.

    THE BODY GOES THROUGH ALMOST VERBATIM, and that is why the markup subset was
    chosen the way it was. Discord understands `**bold**`, `*italic*`, backtick
    code, `[text](url)`, `- bullets` and `##` headings, and treats a single
    newline as a line break — the same reading `lib/richText` gives them. Nothing
    here rewrites the text, so what a member sees on the board and what the
    channel shows are the same words.

    Tables were left out of the subset for this reason: they do not survive the
    trip, and a guide that renders one way in two places is worse than one that
    renders plainly in both.

    IMAGES ARE THE EXCEPTION, and they need lifting rather than passing through.
    Discord does not understand `![alt](url)` — it prints those characters — so
    every image line is taken out of the text and the first URL is attached to the
    embed, where Discord shows it as a picture. When a guide carries more than one,
    the channel says so and points at the dashboard rather than posting a wall.

    KEYED ON `published_at`, not on the guide id alone. Editing a published guide
    leaves that timestamp alone, so a typo fix does not re-announce. Unpublishing
    and publishing again sets a new one, which is a new publication and worth
    saying — that is the distinction the key exists to make.
    """
    kind = {"info": "Information", "strategy": "Strategy", "tip": "Tip"}.get(category, category)
    text, images = split_images(body)
    lines = [f"_{kind}_", "", text.strip()]
    if len(images) > 1:
        lines += ["", f"_{len(images)} pictures — the rest are on the dashboard._"]
    if dashboard_url is not None:
        # Because the body is clamped to Discord's embed limit and a long guide
        # will lose its tail. A reader who hits the cut needs somewhere to go.
        # The guide's OWN address, not the board's. Somebody following this from the
        # channel wants the thing that was announced, and 0079 gave every post a
        # link worth sending.
        link = f"{dashboard_url.rstrip('/')}/#/guides/{guide_id}"
        lines += ["", f"[Read it on the dashboard]({link})"]
    return Message(
        channel=channel,
        event="guides",
        idempotency_key=f"guide:{guide_id}:{published_at}",
        title=title,
        body="\n".join(lines),
        image_url=images[0] if images else None,
    )


def notice_message(
    *,
    channel: str,
    announcement_id: str,
    title: str,
    body: str,
    live_at: str,
    dashboard_url: str | None = None,
) -> Message:
    """A notice the alliance just posted.

    The same shape as a guide, deliberately: same markup subset, same image
    handling, same "read it on the dashboard" tail. A notice and a guide differ in
    what they are FOR, not in how they travel.

    KEYED ON `live_at` — the notice's own start time, or when it was written if it
    has none. Fixing a typo leaves that alone, so it does not re-announce; moving
    the start window is a different announcement and should say so, which is the
    same distinction `published_at` draws for guides.

    NOT keyed on `updated_at`, which would make every correction a fresh post to 94
    people.
    """
    text, images = split_images(body)
    lines = ["_Notice_", "", text.strip()]
    if len(images) > 1:
        lines += ["", f"_{len(images)} pictures — the rest are on the dashboard._"]
    if dashboard_url is not None:
        link = f"{dashboard_url.rstrip('/')}/#/notices/{announcement_id}"
        lines += ["", f"[Read it on the dashboard]({link})"]
    return Message(
        channel=channel,
        event="notices",
        idempotency_key=f"notice:{announcement_id}:{live_at}",
        title=title,
        body="\n".join(lines),
        image_url=images[0] if images else None,
    )


def wiring_check_message(channel: str) -> Message:
    """What the settings screen's "Send test" button sends.

    Not named `test_*`: pytest collects anything so named from any imported
    module and then fails trying to inject `channel` as a fixture. It did.

    The key carries no timestamp, deliberately: pressing the button twice should
    post once, so a reader who is not sure whether it worked cannot spam the
    channel finding out. Rows can be deleted by an admin to test again.
    """
    return Message(
        channel=channel,
        event="test",
        idempotency_key=f"test:{channel}",
        title="Dark War dashboard",
        body=f"Notifications for **{channel}** are wired up.",
    )
