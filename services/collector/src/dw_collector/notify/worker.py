"""Deciding what to post, and posting it.

Two halves, kept apart because they fail differently:

  ENQUEUE reads Supabase, works out what has not been announced, and writes rows
  to `notification_outbox`. Idempotent by construction — it asks the database
  whether a key exists rather than remembering, so a restart changes nothing.

  DELIVER takes undelivered rows and POSTs them to a webhook. This is the half
  that touches the outside world, so it records every attempt on the row: a
  failed post that leaves no trace is indistinguishable from a message nobody
  decided to send.

Runs with the service key, like `dw-sync`. That is what lets it read
`notification_channels`, which is admin-only to everybody else — the URL is a
credential, and nothing in the browser should hold it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx
import structlog

from dw_collector.notify.compose import (
    Message,
    attachment_name,
    departure_message,
    discord_payload,
    guide_message,
    notice_message,
    rank_period_message,
)

log = structlog.get_logger()

# One PostgREST row. `dict[str, Any]` everywhere it appears, named once so the
# signatures below read as intent rather than as a repeated type argument.
Row = dict[str, Any]

# A fortnight, in the units the period grid uses.
PERIOD_DAYS = 14
# How long a member has to have been missing before their absence is announced.
#
# Six hours, and it is not politeness — it is the difference between a departure
# and a roster sweep in progress. Each scroll page of a sweep lands as its own
# batch, so for a few minutes "the newest batch" holds 69 of 94 members and the
# other 25 look gone. A real departure's last sighting is hours or days old.
SETTLE = timedelta(hours=6)
# How many failures before a row is left alone. Discord answers 429 with a
# Retry-After and 404 when a webhook has been deleted in Discord; retrying the
# second forever writes an error to the row every interval and never succeeds.
MAX_ATTEMPTS = 5
# How far back a newly switched-on notice event will reach.
#
# The outbox has no memory of the time before an event was enabled, so without a
# bound the first run posts every standing notice the alliance ever wrote. A week:
# long enough that switching it on announces what is actually current, short enough
# that it cannot dump a season of history into the channel.
NOTICE_BACKLOG = timedelta(days=7)


@dataclass(frozen=True)
class NotifyConfig:
    supabase_url: str
    secret_key: str
    # Optional. Only used to add a "read it on the dashboard" link to a
    # published guide, whose body may have been clamped to Discord's limit.
    # Absent means the line is left out rather than pointing nowhere.
    dashboard_url: str | None = None


@dataclass
class NotifyStats:
    enqueued: int = 0
    delivered: int = 0
    failed: int = 0


class NotifyWorker:
    def __init__(self, config: NotifyConfig) -> None:
        self.config = config
        self.dashboard_url = config.dashboard_url
        self.rest = f"{config.supabase_url.rstrip('/')}/rest/v1"
        self.client = httpx.Client(
            timeout=30.0,
            headers={
                "apikey": config.secret_key,
                "Authorization": f"Bearer {config.secret_key}",
                "Content-Type": "application/json",
            },
        )

    # ------------------------------------------------------------------ reading

    def _get(self, path: str) -> list[Row]:
        response = self.client.get(f"{self.rest}/{path}")
        response.raise_for_status()
        # Narrowed rather than returned straight: `json()` is Any, and letting
        # that escape means every caller below type-checks against nothing.
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def routing(self) -> dict[str, Row]:
        """Which events are on, and which channel each goes to.

        From `app_settings`, which is world-readable and holds no URL. Absent or
        malformed is treated as "nothing enabled" rather than a crash: a missing
        settings row should not stop the collector.
        """
        rows = self._get("app_settings?key=eq.discord_notifications&select=value")
        value = rows[0]["value"] if rows else {}
        return value if isinstance(value, dict) else {}

    def channels(self) -> dict[str, str]:
        """Enabled channel name → webhook URL."""
        rows = self._get("notification_channels?enabled=is.true&select=channel,webhook_url")
        return {row["channel"]: row["webhook_url"] for row in rows}

    def _target(self, routing: dict[str, Row], event: str) -> str | None:
        """The channel an event should go to, or None when it is switched off."""
        entry = routing.get(event) or {}
        if not entry.get("enabled"):
            return None
        channel = entry.get("channel")
        return channel if isinstance(channel, str) and channel else None

    # ---------------------------------------------------------------- enqueuing

    def enqueue(self, messages: list[Message]) -> int:
        """Insert, ignoring anything already announced.

        `resolution=ignore-duplicates` against the unique idempotency key, so this
        is the dedupe — not a select-then-insert, which two collectors running at
        once would both pass before either wrote.
        """
        if not messages:
            return 0
        payload = [
            {
                "channel": message.channel,
                "event": message.event,
                "idempotency_key": message.idempotency_key,
                "title": message.title,
                "body": message.body,
                # 0083. Carried on the row because `guide_message` has already taken
                # the image lines OUT of the body — the URL is known here and would
                # otherwise be gone by the time anything posted it.
                "image_url": message.image_url,
            }
            for message in messages
        ]
        response = self.client.post(
            f"{self.rest}/notification_outbox?on_conflict=idempotency_key",
            json=payload,
            headers={"Prefer": "resolution=ignore-duplicates,return=representation"},
        )
        response.raise_for_status()
        written = response.json()
        return len(written) if isinstance(written, list) else 0

    def rank_period_candidates(self, routing: dict[str, Row]) -> list[Message]:
        """The newest built period, if its version has not been announced.

        Reads `rank_period_snapshots` rather than `rank_period_latest`, because the
        version is the thing being keyed on and the view hides all but the newest.
        """
        channel = self._target(routing, "rank_period")
        if channel is None:
            return []

        newest = self._get(
            "rank_period_snapshots?select=period_start,scoring_version"
            "&order=period_start.desc,scoring_version.desc&limit=1"
        )
        if not newest:
            return []
        period_start = newest[0]["period_start"]
        version = newest[0]["scoring_version"]

        rows = self._get(
            "rank_period_snapshots?select=player_id,name,tier,tier_reason"
            f"&period_start=eq.{filter_value(period_start)}"
            f"&scoring_version=eq.{version}&limit=500"
        )
        # The previous period at ITS newest version, which is what the dashboard
        # compares against too.
        previous_rows = self._get(
            "rank_period_latest?select=player_id,name,tier"
            f"&period_start=lt.{filter_value(period_start)}"
            "&order=period_start.desc&limit=500"
        )
        period_end = _add_days(period_start, PERIOD_DAYS)
        return [
            rank_period_message(
                channel=channel,
                period_start=period_start,
                period_end=period_end,
                scoring_version=version,
                rows=rows,
                previous=previous_rows,
            )
        ]

    def departure_candidates(self, routing: dict[str, Row]) -> list[Message]:
        """Departures from OUR alliance that a complete capture confirms.

        THREE FILTERS, and the first version had none of them. It enqueued 45
        messages and posted 20, almost all about members who had not left.

        1. OUR ALLIANCE ONLY. `alliance_departures` spans every alliance it has
           ever seen a roster for, and for a stranger's alliance that roster is a
           one-row capture from browsing the cross-server board. One row means
           everybody else is "absent"; a null `member_count` means the view calls
           that capture complete. That produced most of the 45.

        2. CONFIRMED ONLY. 0067's own comment says an unscrolled capture looks
           exactly like a departure "and must not be reported as one". Posting it
           with a warning attached is still reporting it.

        3. SETTLED ONLY. While a roster sweep is running, each scroll page lands
           as its own batch — 69, 88, 96, 85 rows seconds apart — so "the newest
           batch" is whatever page arrived last and half the alliance is missing
           from it. A real departure's last sighting is hours or days old; a blip
           from live capture is minutes old. So the last sighting has to be older
           than SETTLE before it counts.

        Every surviving row goes in every pass — the outbox decides which are new.
        Filtering on a remembered high-water mark would need state this process
        does not have, and would go wrong exactly once, silently.
        """
        channel = self._target(routing, "departures")
        if channel is None:
            return []
        # THE COLUMN NAMES ARE 0067's, not invented ones. It asked for `name`,
        # `power` and `snapshot_complete` at first — the view calls them
        # `last_known_name`, `last_power` and `confirmed`, and PostgREST answers
        # 400 for a column that does not exist. `44_discord_notifications_test`
        # now asserts this exact list against the view, so the next rename fails
        # in CI rather than on the first live run.
        alliances = {
            row["alliance_id"]: row["current_name"]
            for row in self._get("alliances?is_own=is.true&select=alliance_id,current_name")
        }
        if not alliances:
            return []

        settled_before = filter_value((datetime.now(tz=UTC) - SETTLE).isoformat())
        ours = ",".join(alliances)
        rows = self._get(
            "alliance_departures?select=alliance_id,game_uid,last_known_name,last_power,"
            "last_seen_in_alliance_at,confirmed"
            f"&alliance_id=in.({ours})"
            "&confirmed=is.true"
            f"&last_seen_in_alliance_at=lt.{settled_before}"
            "&limit=200"
        )
        return [
            departure_message(
                channel=channel,
                alliance_name=alliances.get(row["alliance_id"]),
                alliance_id=row["alliance_id"],
                game_uid=row["game_uid"],
                last_known_name=row["last_known_name"],
                last_power=row["last_power"],
                last_seen_in_alliance_at=row["last_seen_in_alliance_at"],
                confirmed=row["confirmed"],
            )
            for row in rows
        ]

    def guide_candidates(self, routing: dict[str, Row]) -> list[Message]:
        """Guides that have been published and not yet announced.

        No completeness or settling problem here, unlike departures: publishing is
        a deliberate act by a person, not something inferred from a capture that
        might have stopped early. The outbox alone decides which are new.

        `guides` is member-gated by an RLS POLICY, which the service key bypasses —
        so unlike 0077's four views, this needed no migration. The difference is
        worth remembering: a role check in a view's WHERE clause stops the
        collector, a policy on a table does not.
        """
        channel = self._target(routing, "guides")
        if channel is None:
            return []
        rows = self._get(
            "guides?select=guide_id,title,body,category,published_at"
            "&published_at=not.is.null"
            "&order=published_at.desc&limit=20"
        )
        return [
            guide_message(
                channel=channel,
                guide_id=row["guide_id"],
                title=row["title"],
                body=row["body"],
                category=row["category"],
                published_at=row["published_at"],
                dashboard_url=self.dashboard_url,
            )
            for row in rows
        ]

    def notice_candidates(self, routing: dict[str, Row]) -> list[Message]:
        """Notices that are live and not yet announced.

        PUBLISHED, first of all. 0108 gave notices the drafts guides have had since
        0078, and a draft is somebody thinking aloud — the whole point of the feature
        is that saving it does not tell 94 people. The filter is in the QUERY rather
        than in a policy because the collector holds the service key and the service
        key bypasses RLS; on this path the `not.is.null` below is the only gate there
        is.

        LIVE, not merely written. A notice whose `starts_at` is next Saturday is
        deliberately not current yet, and announcing it today would have the channel
        disagreeing with the dashboard about when something happens. Expired ones are
        skipped for the same reason in reverse.

        AND RECENT, which is the part that needed thought. The outbox has no memory
        of the time before this event was switched on, so without a window the first
        run after an admin enables it posts every standing notice the alliance has
        ever had. `NOTICE_BACKLOG` bounds it: a notice that went live a month ago is
        not news, and the dashboard is where it still lives.

        No settling delay, unlike departures. A notice is a deliberate act by a
        person; there is nothing to confirm.
        """
        channel = self._target(routing, "notices")
        if channel is None:
            return []
        now = datetime.now(UTC)
        current = filter_value(now.isoformat())
        cutoff = (now - NOTICE_BACKLOG).isoformat()
        rows = self._get(
            "announcements?select=announcement_id,title,body,starts_at,ends_at,published_at"
            # A draft is not news.
            "&published_at=not.is.null"
            # Live: started, or with no start at all; and not yet finished.
            f"&or=(starts_at.is.null,starts_at.lte.{current})"
            f"&or=(ends_at.is.null,ends_at.gte.{current})"
            # By publication rather than by writing: the twenty most recently
            # announced are the twenty this is deciding about, and since 0108
            # those are not the same twenty as the most recently created.
            "&order=published_at.desc&limit=20"
        )
        out: list[Message] = []
        for row in rows:
            # When it became news: published AND started, so whichever of the two
            # happened last. A notice drafted a fortnight ago and published this
            # morning is news this morning — before 0108 it read as a fortnight
            # old and the backlog window below would have dropped it. One
            # published in advance for Saturday is news on Saturday.
            #
            # Applied HERE rather than in the query because PostgREST cannot
            # express "the later of two columns, either of which may be null" —
            # and doing it once in Python beats two filters that can disagree.
            # ISO strings compare correctly: PostgREST returns every timestamptz
            # in the same UTC shape.
            live_at = max(
                (value for value in (row.get("starts_at"), row.get("published_at")) if value),
                default=None,
            )
            if live_at is None or live_at < cutoff:
                continue
            out.append(
                notice_message(
                    channel=channel,
                    announcement_id=row["announcement_id"],
                    title=row["title"],
                    body=row["body"] or "",
                    live_at=live_at,
                    dashboard_url=self.dashboard_url,
                )
            )
        return out

    # --------------------------------------------------------------- delivering

    def pending(self) -> list[Row]:
        return self._get(
            "notification_outbox?delivered_at=is.null"
            f"&attempts=lt.{MAX_ATTEMPTS}&select=*&order=created_at&limit=20"
        )

    def deliver(self, row: Row, channels: dict[str, str]) -> bool:
        """Post one row. Returns whether it left."""
        url = channels.get(row["channel"])
        if url is None:
            # Not an attempt: the channel being off or absent is a configuration
            # state, not a failed send, and counting it would burn the retry
            # budget while an admin is still setting things up.
            return False

        message = Message(
            channel=row["channel"],
            event=row["event"],
            idempotency_key=row["idempotency_key"],
            title=row["title"],
            body=row["body"],
            image_url=row.get("image_url"),
        )
        # THE PICTURE IS UPLOADED, NOT LINKED (0083). The bucket is private, so a URL
        # in the embed would be unfetchable by Discord and a signed one would expire
        # in the channel. Downloading it here with the service key and posting the
        # bytes leaves nothing of ours readable by URL.
        picture = self._fetch_picture(message.image_url)
        if message.image_url is not None and picture is None:
            # The download failed, so the attachment will not be there. Take the
            # image off the MESSAGE rather than posting an embed that points at an
            # attachment nobody sent — that renders as a picture-shaped blank. The
            # words are worth more than the picture, so the post still goes.
            message = replace(message, image_url=None)
        payload = discord_payload(message)
        try:
            if picture is None:
                response = httpx.post(url, json=payload, timeout=30.0)
            else:
                # multipart: `payload_json` carries what would have been the JSON
                # body, and the file rides beside it under the name the embed's
                # `attachment://` refers to.
                response = httpx.post(
                    url,
                    data={"payload_json": json.dumps(payload)},
                    files={"files[0]": (picture[0], picture[1], picture[2])},
                    timeout=60.0,
                )
            response.raise_for_status()
        except httpx.HTTPError as error:
            self._mark(row, error=str(error)[:400])
            self._touch_channel(row["channel"], error=str(error)[:400])
            return False
        self._mark(row, error=None)
        self._touch_channel(row["channel"], error=None)
        return True

    def _fetch_picture(self, image_url: str | None) -> tuple[str, bytes, str] | None:
        """The bytes of one post image, as (filename, bytes, content type).

        Read with the SERVICE KEY, which is why this is the collector's job and not
        the dashboard's: the bucket is private (0083) and only a server-side caller
        has a credential that bypasses the need for a session.
        `/object/<bucket>/<path>` rather than `/object/public/...` — the public
        endpoint is exactly what 0083 turned off.

        RETURNS NONE ON ANY FAILURE, and the caller then posts without the picture.
        A missing image must not lose the announcement: the words are the message and
        the picture is decoration, so a 404 on one object cannot be allowed to burn
        the row's retry budget on text that was ready to send.
        """
        if image_url is None:
            return None
        marker = "/object/public/post-images/"
        if marker not in image_url:
            log.warning("notify.picture.unrecognised", url=image_url[:200])
            return None
        path = image_url.split(marker, 1)[1]
        try:
            response = self.client.get(
                f"{self.config.supabase_url.rstrip('/')}/storage/v1/object/post-images/{path}",
                # The client sets a JSON content type for PostgREST; asking for an
                # image with it is harmless, but the response is bytes and must not
                # be parsed as JSON anywhere below.
                headers={"Accept": "*/*"},
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            log.warning("notify.picture.failed", path=path, error=str(error)[:200])
            return None
        content_type = response.headers.get("content-type", "application/octet-stream")
        return attachment_name(image_url), response.content, content_type

    def _mark(self, row: Row, *, error: str | None) -> None:
        patch: dict[str, object] = {"attempts": row["attempts"] + 1, "last_error": error}
        if error is None:
            # An ISO timestamp, not the string "now()" — PostgREST sends JSON
            # values as literals, so "now()" arrives as eight characters and the
            # PATCH fails on the column type.
            patch["delivered_at"] = _now()
        self.client.patch(
            f"{self.rest}/notification_outbox?notification_id=eq.{row['notification_id']}",
            json=patch,
        ).raise_for_status()

    def _touch_channel(self, channel: str, *, error: str | None) -> None:
        """What happened last, on the channel row, for the settings screen.

        Without it a channel that has never worked and one nobody has used look
        the same — which is the state an admin is in immediately after pasting a
        URL, and the one moment they most need to be told.
        """
        patch: dict[str, object] = {"last_error": error}
        if error is None:
            patch["last_delivered_at"] = _now()
        self.client.patch(
            # Escaped for the same reason as the timestamps: a channel name is
            # whatever an admin typed, and a space or an ampersand in it would
            # otherwise change which rows this PATCH matched.
            f"{self.rest}/notification_channels?channel=eq.{filter_value(channel)}",
            json=patch,
        ).raise_for_status()

    # --------------------------------------------------------------------- loop

    def run_once(self) -> NotifyStats:
        stats = NotifyStats()
        routing = self.routing()
        # ADDING AN EVENT IS THREE LINES, and this is one of them: a name in
        # `EVENTS` in the settings screen so an admin can switch it on, a
        # `*_candidates` method here, and its entry in this tuple. Nothing else in
        # the worker changes — enqueue, delivery, retries and the outbox are all
        # event-agnostic already.
        #
        # A tuple of bound methods rather than method NAMES: a typo in a string is
        # found at run time by an event quietly never sending, and a typo here does
        # not compile.
        sources = (
            self.rank_period_candidates,
            self.departure_candidates,
            self.guide_candidates,
            self.notice_candidates,
        )
        messages = [message for source in sources for message in source(routing)]
        stats.enqueued = self.enqueue(messages)

        channels = self.channels()
        for row in self.pending():
            if self.deliver(row, channels):
                stats.delivered += 1
            else:
                stats.failed += 1
        return stats


def filter_value(value: str) -> str:
    """Escape a value going into a PostgREST filter.

    `+` is the reason this exists. A timestamptz from PostgREST reads
    `2026-08-03T02:00:00+00:00`, and interpolated raw into a query string the `+`
    is decoded as a SPACE — so the server received `02:00:00 00:00` and answered
    400. Nothing about the failure pointed at the plus sign.

    `safe=''` so `:` is escaped too. PostgREST accepts either form, and encoding
    everything means no second character surprises this later.
    """
    return quote(value, safe="")


def _add_days(timestamp: str, days: int) -> str:
    """Period end from period start. Only the date part is ever shown."""
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    return (parsed + timedelta(days=days)).isoformat()


def _now() -> str:
    return datetime.now(tz=UTC).isoformat()
