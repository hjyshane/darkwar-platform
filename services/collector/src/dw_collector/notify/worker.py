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

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx
import structlog

from dw_collector.notify.compose import (
    Message,
    departure_message,
    discord_payload,
    rank_period_message,
)

log = structlog.get_logger()

# One PostgREST row. `dict[str, Any]` everywhere it appears, named once so the
# signatures below read as intent rather than as a repeated type argument.
Row = dict[str, Any]

# A fortnight, in the units the period grid uses.
PERIOD_DAYS = 14
# How many failures before a row is left alone. Discord answers 429 with a
# Retry-After and 404 when a webhook has been deleted in Discord; retrying the
# second forever writes an error to the row every interval and never succeeds.
MAX_ATTEMPTS = 5


@dataclass(frozen=True)
class NotifyConfig:
    supabase_url: str
    secret_key: str


@dataclass
class NotifyStats:
    enqueued: int = 0
    delivered: int = 0
    failed: int = 0


class NotifyWorker:
    def __init__(self, config: NotifyConfig) -> None:
        self.config = config
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
        """Everyone `alliance_departures` currently lists.

        Every one, every pass — the outbox decides which are new. Filtering by a
        remembered high-water mark here would need state this process does not
        have, and would go wrong exactly once, silently.
        """
        channel = self._target(routing, "departures")
        if channel is None:
            return []
        rows = self._get(
            "alliance_departures?select=alliance_id,game_uid,name,power,"
            "last_seen_in_alliance_at,snapshot_complete&limit=200"
        )
        alliances = {
            row["alliance_id"]: row["current_name"]
            for row in self._get("alliances?is_own=is.true&select=alliance_id,current_name")
        }
        return [
            departure_message(
                channel=channel, alliance_name=alliances.get(row["alliance_id"]), row=row
            )
            for row in rows
        ]

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
        )
        try:
            response = httpx.post(url, json=discord_payload(message), timeout=30.0)
            response.raise_for_status()
        except httpx.HTTPError as error:
            self._mark(row, error=str(error)[:400])
            self._touch_channel(row["channel"], error=str(error)[:400])
            return False
        self._mark(row, error=None)
        self._touch_channel(row["channel"], error=None)
        return True

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
        messages = self.rank_period_candidates(routing) + self.departure_candidates(routing)
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
