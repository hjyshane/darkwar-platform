"""Turning facts into Discord messages.

Pure functions, because everything that can be wrong here is wrong in the text
rather than in the plumbing: an idempotency key that varies when it should not
posts the same thing twice to 94 people, and a body that runs past Discord's
limit fails the whole request with a 400 that says nothing useful.

Nothing in this module talks to the network or to a database.
"""

from __future__ import annotations

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


def clamp(text: str, limit: int) -> str:
    """Cut to `limit`, saying so when it cuts."""
    if len(text) <= limit:
        return text
    if limit <= len(ELLIPSIS):
        return text[:limit]
    return text[: limit - len(ELLIPSIS)] + ELLIPSIS


def discord_payload(message: Message) -> dict[str, object]:
    """The request body for a webhook.

    An embed rather than plain `content`: the description cap is 4096 against
    content's 2000, and a rank report for 95 members does not fit in 2000.
    """
    return {
        "embeds": [
            {
                "title": clamp(message.title, TITLE_LIMIT),
                "description": clamp(message.body, BODY_LIMIT),
            }
        ]
    }


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
