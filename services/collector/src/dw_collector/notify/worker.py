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
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx
import structlog

from dw_collector.notify.compose import (
    Message,
    attachment_name,
    claim_message,
    departure_message,
    discord_payload,
    guide_message,
    notice_message,
    rank_period_message,
    reminder_message,
    resumed_message,
    silence_message,
    waiting_message,
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
# Events this process no longer owns, because 0130 composes and delivers them
# inside Postgres instead.
#
# `sync_stalled` says "nothing has checked in for ten minutes", and it ran HERE
# — on the collector. Whatever kills the collector kills this process with it,
# so the one event that matters most when the machine is down was the one
# guaranteed not to fire. It now runs on a cron inside the database, where the
# collector's power supply cannot reach it.
#
# BOTH HALVES MOVE, and they have to move together. The unique idempotency key
# stops a duplicate compose, and nothing stops a duplicate POST except deciding
# who sends: two deliverers draining one outbox row is two Discord messages.
# `internal.database_owned_events()` is the same list on the other side.
DATABASE_OWNED = ("sync_stalled",)
# How long a collector may go without checking in before it is announced.
#
# `dw-sync` beats every DW_SYNC_INTERVAL_SECONDS, default 10, and 0060 calls the
# board stale after one minute of silence. This is deliberately much longer than
# that: the dashboard badge is for somebody already looking at the screen, and it
# can flicker without costing anything. A Discord message cannot. Ten minutes is
# sixty missed beats — past any reboot, Windows update, or router blip, and still
# inside the hour it takes to care.
SYNC_SILENCE = timedelta(minutes=10)
# How late a schedule reminder may be and still be worth sending.
#
# CANNOT BE ZERO, which is the whole subtlety. This process wakes every
# DW_NOTIFY_INTERVAL_SECONDS, default 300, so a reminder due at 20:00 is
# discovered somewhere between 20:00 and 20:05 — by which time it is, strictly,
# late. A window of zero sends nothing, ever, and looks like a broken feature
# rather than a policy.
#
# Fifteen minutes lets ordinary polling lag through and stops nothing else. The
# case it deliberately drops is the machine having been off: coming back from a
# week away must not empty a week of missed reminders into the channel at once,
# announcing bear hunts that finished on Tuesday. That was the explicit choice —
# a missed reminder is discarded, not deferred.
REMINDER_GRACE = timedelta(minutes=15)
# The same question asked about DATA rather than about the process.
#
# This is the failure the capture runbook records and the heartbeat cannot see:
# the interface name was wrong, dumpcap collected nothing at all, and everything
# that reports health went on reporting health. `last_packet_at` is the only
# figure that moved — or rather, the only one that stopped.
#
# Two hours, not ten minutes. Game traffic is not a metronome; the client goes
# quiet when nothing is happening, and the routine only opens screens every so
# often. Under an hour this alerts on ordinary quiet. The failure it is for
# lasted overnight.
PACKET_SILENCE = timedelta(hours=2)
# How far back a newly switched-on notice event will reach.
#
# The outbox has no memory of the time before an event was enabled, so without a
# bound the first run posts every standing notice the alliance ever wrote. A week:
# long enough that switching it on announces what is actually current, short enough
# that it cannot dump a season of history into the channel.
NOTICE_BACKLOG = timedelta(days=7)
# The same bound for guides, and it is not a copy-paste.
#
# A guide outlives a notice — that is why they are separate tables — but this
# window is not about how long a guide stays useful. It is about what counts as
# NEWS the first time the event is switched on, and by that measure they are the
# same thing.
#
# Without it the first pass posts the twenty most recently published guides at
# once: `enqueue` dedupes against the outbox, and an outbox that has never seen
# them treats every one as new. That was not hypothetical — `dw-notify` was never
# registered as a scheduled task, so the outbox stayed empty while the board
# filled up, and the flood would have fired on whichever day the task was finally
# added. The notice side had this guard from the start; the guide side did not,
# because whoever wrote it assumed the worker had been running all along.
GUIDE_BACKLOG = timedelta(days=7)


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

        AND RECENT, for the reason `notice_candidates` already carried and this
        did not: the outbox has no memory of the time before the event was
        switched on, so an unbounded query announces the whole board on the first
        pass. See `GUIDE_BACKLOG`.
        """
        channel = self._target(routing, "guides")
        if channel is None:
            return []
        cutoff = filter_value((datetime.now(UTC) - GUIDE_BACKLOG).isoformat())
        rows = self._get(
            "guides?select=guide_id,title,body,category,published_at,channel"
            # A draft is not a guide yet. Its own filter rather than left to the
            # window below — `gte` excludes nulls as a side effect, and the rule
            # that drafts stay private should not rest on a side effect of a
            # constant somebody may want to tune.
            "&published_at=not.is.null"
            f"&published_at=gte.{cutoff}"
            "&order=published_at.desc&limit=20"
        )
        return [
            guide_message(
                # The guide's own channel wins; the settings one is the
                # fallback. 0127 put the column there so a war plan and a
                # patch note need not share a room.
                channel=row.get("channel") or channel,
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
            "announcements?select=announcement_id,title,body,starts_at,ends_at,published_at,channel"
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
                    channel=row.get("channel") or channel,
                    announcement_id=row["announcement_id"],
                    title=row["title"],
                    body=row["body"] or "",
                    live_at=live_at,
                    dashboard_url=self.dashboard_url,
                )
            )
        return out

    def claim_candidates(self, routing: dict[str, Row]) -> list[Message]:
        """Player links waiting on an admin's decision.

        NO BACKLOG WINDOW, unlike guides and notices, and the difference is not an
        oversight. Those two ask "is this news?", and a fortnight-old notice is
        not. A claim asks "is this still waiting?" — and one that has been waiting
        a fortnight is the most overdue thing on the list, not the least. The
        `status=eq.pending` filter is the window: deciding it removes it.

        `app_users` is fetched separately rather than embedded. `player_claims`
        points at `auth.users`, not at `app_users`, so there is no foreign key for
        PostgREST to embed across and asking for one answers 400. `players` IS a
        real reference and embeds normally.
        """
        channel = self._target(routing, "player_claim")
        if channel is None:
            return []
        rows = self._get(
            "player_claims?select=user_id,player_id,created_at,note,"
            "players(current_name,game_uid)"
            "&status=eq.pending&order=created_at&limit=20"
        )
        if not rows:
            return []
        ids = ",".join(row["user_id"] for row in rows)
        names = {
            row["user_id"]: row["display_name"]
            for row in self._get(f"app_users?select=user_id,display_name&user_id=in.({ids})")
        }
        out: list[Message] = []
        for row in rows:
            player = row.get("players") or {}
            out.append(
                claim_message(
                    channel=channel,
                    user_id=row["user_id"],
                    display_name=names.get(row["user_id"]),
                    player_name=player.get("current_name"),
                    game_uid=player.get("game_uid"),
                    created_at=row["created_at"],
                    note=row.get("note"),
                    dashboard_url=self.dashboard_url,
                )
            )
        return out

    def reminder_candidates(self, routing: dict[str, Row]) -> list[Message]:
        """Calendar reminders whose moment has just arrived.

        A WINDOW, not "everything overdue". Every other event here asks the
        database for all the rows that qualify and lets the outbox decide which
        are new; that works because their facts stay true. A reminder's does not.
        Asked without a lower bound, the first pass after the machine comes back
        from a week off would announce every reminder that fell in that week.

        The channel is the CATEGORY's, and the routing entry's channel is only
        the fallback. The user keeps one webhook per board in Discord, so the
        choice belongs to the kind of entry rather than to whoever typed it —
        and an entry whose category has no channel deliberately says nothing.
        """
        default = self._target(routing, "schedule_reminder")
        if default is None:
            return []
        now = datetime.now(tz=UTC)
        rows = self._get(
            "schedule_reminders_due?select=reminder_id,title,starts_at,minutes_before,"
            "category_label,channel"
            f"&fire_at=lte.{filter_value(now.isoformat())}"
            f"&fire_at=gte.{filter_value((now - REMINDER_GRACE).isoformat())}"
            "&order=fire_at&limit=50"
        )
        return [
            reminder_message(
                channel=row.get("channel") or default,
                reminder_id=row["reminder_id"],
                title=row["title"],
                starts_at=row["starts_at"],
                minutes_before=row["minutes_before"],
                category_label=row.get("category_label"),
            )
            for row in rows
        ]

    def signup_candidates(self, routing: dict[str, Row]) -> list[Message]:
        """Accounts that signed in and never got a role.

        Reads 0123's view rather than `app_users`, because the row this is looking
        for does not exist there — `redeem_join_code` is what creates an
        `app_users` row, so somebody who never redeemed a code is absent from the
        table rather than present with `role = 'viewer'`. A filter on that role
        finds nobody, always, and looks like it worked.

        Keyed on the uid ALONE, with no timestamp. Signing out and back in should
        not re-announce the same stranger, and neither should anything else that
        touches the row: there is one decision to make about this person, so there
        is one message. Once they redeem a code they leave the view for good.
        """
        channel = self._target(routing, "new_signup")
        if channel is None:
            return []
        rows = self._get(
            "pending_access?select=user_id,created_at,last_sign_in_at&order=created_at&limit=20"
        )
        return [
            waiting_message(
                channel=channel,
                user_id=row["user_id"],
                created_at=row["created_at"],
                last_sign_in_at=row.get("last_sign_in_at"),
                dashboard_url=self.dashboard_url,
            )
            for row in rows
        ]

    def sync_stall_candidates(self, routing: dict[str, Row]) -> list[Message]:
        """The collector stopped checking in at all."""
        return self._silence_candidates(
            routing,
            event="sync_stalled",
            column="last_heartbeat_at",
            threshold=SYNC_SILENCE,
            what="has stopped checking in.",
            consequence="Nothing is being collected or synced until it comes back.",
        )

    def data_stall_candidates(self, routing: dict[str, Row]) -> list[Message]:
        """The collector is checking in but no longer seeing packets."""
        return self._silence_candidates(
            routing,
            event="data_stalled",
            column="last_packet_at",
            threshold=PACKET_SILENCE,
            what="is running, but has not seen a packet in a long time.",
            consequence=(
                "The dashboard will keep showing the last figures it received, "
                "so this does not look like a fault from the board."
            ),
        )

    def _silence_candidates(
        self,
        routing: dict[str, Row],
        *,
        event: str,
        column: str,
        threshold: timedelta,
        what: str,
        consequence: str,
    ) -> list[Message]:
        """One alarm per outage, one all-clear per alarm.

        THE TWO SILENCES ARE THE SAME SHAPE and differ only in which column stopped
        moving, so they share this. Keeping them as two events rather than one is
        about what the reader can do: a dead process needs the machine restarting,
        a live process seeing nothing needs the capture interface checked. Told as
        one event, the second reads as the first and gets the wrong fix.

        A collector whose column is NULL is skipped rather than announced. Null
        means it has never reported — a row registered by a `dw-sync` that has not
        finished starting, or one left behind by a machine that was retired. That
        is a configuration state, and an alarm that fires forever about it trains
        the reader to ignore the channel.
        """
        channel = self._target(routing, event)
        if channel is None:
            return []
        now = datetime.now(tz=UTC)
        out: list[Message] = []
        for row in self._get(
            "collectors?select=collector_id,name,last_heartbeat_at,last_packet_at"
        ):
            since = row.get(column)
            if not since:
                continue
            collector_id = row["collector_id"]
            name = row.get("name") or collector_id[:8]
            if now - datetime.fromisoformat(since) > threshold:
                out.append(
                    silence_message(
                        channel=channel,
                        event=event,
                        collector_name=name,
                        collector_id=collector_id,
                        since=since,
                        what=what,
                        consequence=consequence,
                    )
                )
                continue
            # Healthy now. If it was ever announced as silent, close that episode.
            # Re-enqueued on every pass and swallowed by the unique key after the
            # first — the same bargain `departure_candidates` makes, and for the
            # same reason: remembering here would need state this process does not
            # have, and would go wrong exactly once, silently.
            opened = self._last_silence_since(event, collector_id)
            if opened is not None:
                out.append(
                    resumed_message(
                        channel=channel,
                        event=event,
                        collector_name=name,
                        collector_id=collector_id,
                        since=opened,
                    )
                )
        return out

    def _last_silence_since(self, event: str, collector_id: str) -> str | None:
        """The `since` of the most recent alarm for this collector, if any.

        Read back out of the key rather than kept in a column: the key is already
        the episode's identity, and a second place to store it is a second place
        for the two to disagree.

        The prefix is escaped but the trailing `*` is not — that is the wildcard,
        and encoding it would search for a literal asterisk. Nothing else can match
        it: an all-clear's key reads `{event}:resumed:…`, so it never begins with
        `{event}:{uuid}:`.
        """
        prefix = f"{event}:{collector_id}:"
        rows = self._get(
            "notification_outbox?select=idempotency_key"
            f"&idempotency_key=like.{filter_value(prefix)}*"
            "&order=notification_id.desc&limit=1"
        )
        if not rows:
            return None
        return str(rows[0]["idempotency_key"])[len(prefix) :]

    # --------------------------------------------------------------- delivering

    def pending(self) -> list[Row]:
        owned = ",".join(DATABASE_OWNED)
        return self._get(
            "notification_outbox?delivered_at=is.null"
            f"&attempts=lt.{MAX_ATTEMPTS}&event=not.in.({owned})"
            "&select=*&order=created_at&limit=20"
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

    def sources(self) -> tuple[Callable[[dict[str, Row]], list[Message]], ...]:
        """Every event this process still composes.

        A METHOD RATHER THAN A LOCAL, since 0130 started moving events into the
        database: which side owns what is now a fact worth asserting in a test,
        and a tuple buried in the loop could only be checked by running it.

        ADDING AN EVENT IS THREE LINES, and this is one of them: a name in
        `EVENTS` in the settings screen so an admin can switch it on, a
        `*_candidates` method, and its entry here. Nothing else in the worker
        changes — enqueue, delivery, retries and the outbox are all
        event-agnostic already.

        Bound methods rather than method NAMES: a typo in a string is found at
        run time by an event quietly never sending, and a typo here does not
        compile.
        """
        return (
            self.rank_period_candidates,
            self.departure_candidates,
            self.guide_candidates,
            self.notice_candidates,
            self.claim_candidates,
            self.signup_candidates,
            self.reminder_candidates,
            # sync_stall_candidates is absent: 0130 owns that event. The method
            # stays, with its tests, because `data_stalled` still runs here and
            # the two share `_silence_candidates` — and because the next event
            # to move will want the same shape to copy.
            self.data_stall_candidates,
        )

    def run_once(self) -> NotifyStats:
        stats = NotifyStats()
        routing = self.routing()
        sources = self.sources()
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
