"""The times an alliance chose for its weekly events -> alliance_event_times.

Three events let the alliance pick when they happen, and the game tells every
logged-in member the pick:

  zombie_siege  monster.siege.activity.info    `siegeST`, the siege's start
  bio_mutant    get.alliance.boss.activity.info.new   two battles a day,
                `battleStartTime`..`battleEndTime` and `battle2StartTime`..
  black_gold    dragon.activity.info           one entry per team in `teamArr`
                (teamIndex 1 = A, 2 = B), `timeInfo` prep / battleOpenTime / end

Verified against what the alliance set on 2026-10-08 (server time, UTC-2): the
siege at 11:30 (13:30 UTC), Frankie (bio_mutant) at 00:30 and 13:00, Black Gold
team A on 10/11 at 19:00 and team B at 10:00 (21:05 and 12:05 UTC; the battle
opens five minutes after the preparation hour). The server's own three Black
Gold slots (`get.dragon.battle.times`) are the same for everyone and are not
read: the teams in `teamArr` are the alliance's choice.

Only the siege and Frankie payloads say nothing about WHICH alliance; the
collector's account is the only link, so the database resolves it from the
account that was logged in (0247). Black Gold's payload names both alliances,
and our own is the one in every team's matchup (black_money_activity).

Times are epoch ms. One row per distinct time: the key hashes the event, slot
and instants, so every login that sees the same pick is one row, and a moved
event is a new row.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"
KEY_COMMAND = "alliance.event.time"

# An event further from the capture than this is not one the response meant to
# announce, whatever the number says.
_HORIZON = timedelta(days=14)


def _ms(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def _at(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat()


def time_row(
    observation: Observation,
    event_key: str,
    slot: int,
    starts_ms: int | None,
    ends_ms: int | None = None,
    prep_ms: int | None = None,
    *,
    alliance: dict[str, Any] | None = None,
) -> list[NormalizedRow]:
    """One row, or none when the start is missing, absurd or far from now."""
    if starts_ms is None:
        return []
    captured = observation.captured_at
    if abs(datetime.fromtimestamp(starts_ms / 1000, tz=UTC) - captured) > _HORIZON:
        return []
    if ends_ms is not None and ends_ms <= starts_ms:
        ends_ms = None
    raw = {"event": event_key, "slot": slot, "start": starts_ms, "end": ends_ms, "prep": prep_ms}
    key = entry_idempotency_key(
        observation, f"time:{event_key}:{slot}", str(starts_ms), raw, key_command=KEY_COMMAND
    )
    return [
        NormalizedRow(
            target_table="alliance_event_times",
            idempotency_key=key,
            row={
                "observation_id": str(observation.observation_id),
                "source_command": observation.source_command,
                "parser_version": PARSER_VERSION,
                "captured_at": captured.isoformat(),
                "collector_id": str(observation.collector_id),
                "collected_from_server_id": observation.collected_from_server_id,
                "raw": raw,
                "snapshot_id": str(stable_uuid(key)),
                "event_key": event_key,
                "slot": slot,
                "prep_at": None if prep_ms is None else _at(prep_ms),
                "starts_at": _at(starts_ms),
                "ends_at": None if ends_ms is None else _at(ends_ms),
                "alliance_external_id": None if alliance is None else alliance.get("external_id"),
            },
            entity_refs={} if alliance is None else {"alliance": alliance},
        )
    ]


@register("monster.siege.activity.info")
def normalize_siege(observation: Observation) -> list[NormalizedRow]:
    payload = observation.payload
    return time_row(
        observation, "zombie_siege", 1, _ms(payload.get("siegeST")), _ms(payload.get("siegeET"))
    )


@register("get.alliance.boss.activity.info.new")
def normalize_boss(observation: Observation) -> list[NormalizedRow]:
    info = observation.payload.get("bossInfo")
    if not isinstance(info, dict):
        return []
    return time_row(
        observation,
        "bio_mutant",
        1,
        _ms(info.get("battleStartTime")),
        _ms(info.get("battleEndTime")),
    ) + time_row(
        observation,
        "bio_mutant",
        2,
        _ms(info.get("battle2StartTime")),
        _ms(info.get("battle2EndTime")),
    )


def black_gold_rows(
    observation: Observation,
    teams: list[dict[str, Any]],
    alliance: dict[str, Any],
) -> list[NormalizedRow]:
    """Our teams' battles from `teamArr`: slot is the team (1 = A, 2 = B)."""
    out: list[NormalizedRow] = []
    for team in teams:
        info = team.get("timeInfo")
        index = team.get("teamIndex")
        if not isinstance(info, dict) or isinstance(index, bool) or not isinstance(index, int):
            continue
        out.extend(
            time_row(
                observation,
                "black_gold",
                index,
                _ms(info.get("battleOpenTime")),
                _ms(info.get("endTime")),
                _ms(info.get("prepTime")),
                alliance=alliance,
            )
        )
    return out
