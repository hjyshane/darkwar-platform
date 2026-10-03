"""init.activity → event_schedule_snapshots: the server's event calendar.

The login response lists every event the server has scheduled — running now
and coming up, a few weeks ahead — as `activity[]`: an `id`, `startTime` /
`endTime` in epoch ms, the HQ level it needs, and per-event timing extras
(sign-up windows, battle windows, Ice Pit opening rules). Verified on all 62
logins in the live journal (2026-10-02): every login carries the list (58 to
70 entries), `id` is always a numeric string, the times always ints.

It is the same calendar for everyone on a server, so it is alliance-readable
(0208), unlike the account state that rides in the same response. What makes
it personal is stripped here: `exchangeRecord` (what this account bought),
`taskList` / `taskConfigStr` (its task progress) and `finish` / `finishTime`
(whether it finished). Everything else is timing and identification.

The entries carry no names — `id` is all there is, and `name` when present is
another id. Names come from people, in event_names (0208).

One row per distinct calendar, not per login: the key hashes the cleaned
list, so logins that see the same calendar are one row. That collapses less
than it sounds: daily events roll their start and end every day, and two
accounts see slightly different lists (HQ-level gates, personal events) —
the 62 journalled logins made 50 calendars. At ~10KB each that is fine.
"""

from __future__ import annotations

from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid

PARSER_VERSION = "1.0.0"
KEY_COMMAND = "init.activity"

# Per-account fields: purchases, task progress, completion.
_PERSONAL = frozenset({"exchangeRecord", "taskList", "taskConfigStr", "finish", "finishTime"})


def _clean(entry: dict[str, Any]) -> dict[str, Any] | None:
    event_id = entry.get("id")
    if not isinstance(event_id, str) or not event_id.isdigit():
        return None
    return {key: value for key, value in entry.items() if key not in _PERSONAL}


def schedule(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """The cleaned calendar, ordered by start then id so equal calendars hash
    equal whatever order the server listed them in."""
    activity = payload.get("activity")
    if not isinstance(activity, list):
        return []
    cleaned = [c for e in activity if isinstance(e, dict) and (c := _clean(e)) is not None]
    return sorted(
        cleaned,
        key=lambda e: (e.get("startTime") if isinstance(e.get("startTime"), int) else 0, e["id"]),
    )


def schedule_rows(observation: Observation, server_id: int) -> list[NormalizedRow]:
    events = schedule(observation.payload)
    if not events:
        return []
    key = entry_idempotency_key(
        observation,
        f"schedule:{server_id}",
        "-",
        {"activity": events},
        key_command=KEY_COMMAND,
    )
    return [
        NormalizedRow(
            target_table="event_schedule_snapshots",
            idempotency_key=key,
            row={
                "observation_id": str(observation.observation_id),
                "source_command": observation.source_command,
                "parser_version": PARSER_VERSION,
                "captured_at": observation.captured_at.isoformat(),
                "collector_id": str(observation.collector_id),
                "collected_from_server_id": observation.collected_from_server_id,
                "raw": {"activity": events},
                "snapshot_id": str(stable_uuid(key)),
                "server_id": server_id,
                "events": events,
            },
        )
    ]
