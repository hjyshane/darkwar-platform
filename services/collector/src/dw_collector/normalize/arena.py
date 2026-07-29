"""user.get.arena.info → arena_snapshots header + arena_entries rows.

Consumes the REAL decoded payload (S14-PR2, fixture extracted from
darkwar_arena_match.pcapng): `rankArr` holds the Top100 with
uid/name/rank/score/power/serverId per entry, `startTime`/`endTime` are the
week bounds in epoch ms — startTime lands exactly on Monday 02:00 UTC,
independently confirming the reset rule — and `fightServers` names the
cross-server matchup ("580;582"). Entry `power` is the defense lineup
power (Appendix A: "weekly match, Top100, defense power").

The header's snapshot_id is deterministic so replays keep entries pointing
at the same parent (FR-CORE-005 keeps ranking snapshots apart from weekly
matches).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key, stable_uuid
from dw_collector.registry import register
from dw_collector.resetweek import reset_week_start

PARSER_VERSION = "1.0.0"

_UID_SERVER_SUFFIX = 6


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    rank: int
    name: str | None = None
    score: int | None = None
    power: int | None = None
    server_id: int | None = Field(default=None, alias="serverId")

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    entries: list[_Entry] = Field(alias="rankArr")
    start_time_ms: int | None = Field(default=None, alias="startTime")


def _entry_server(entry: _Entry, fallback: int) -> int:
    if entry.server_id is not None:
        return entry.server_id
    if len(entry.uid) > _UID_SERVER_SUFFIX:
        return int(entry.uid[-_UID_SERVER_SUFFIX:])
    return fallback


@register("user.get.arena.info")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    raw_entries: list[dict[str, Any]] = observation.payload.get("rankArr", [])

    # The server's own week bound beats deriving it from capture time.
    if payload.start_time_ms:
        week_start = datetime.fromtimestamp(payload.start_time_ms / 1000, tz=UTC)
    else:
        week_start = reset_week_start(observation.captured_at)
    bucket = week_start.isoformat()

    common = {
        "observation_id": str(observation.observation_id),
        "source_command": observation.source_command,
        "parser_version": PARSER_VERSION,
        "captured_at": observation.captured_at.isoformat(),
        "collector_id": str(observation.collector_id),
        "collected_from_server_id": observation.collected_from_server_id,
    }

    # The header describes the collector account's bracket.
    header_server = observation.collected_from_server_id
    header_key = idempotency_key(observation, f"arena:{header_server}", bucket)
    header_id = str(stable_uuid(header_key))
    rows = [
        NormalizedRow(
            target_table="arena_snapshots",
            idempotency_key=header_key,
            row={
                **common,
                "snapshot_id": header_id,
                "raw": {k: v for k, v in observation.payload.items() if k != "rankArr"},
                "server_id": header_server,
                "week_start": week_start.isoformat(),
                "entry_count": len(payload.entries),
            },
        )
    ]
    for entry, raw_entry in zip(payload.entries, raw_entries, strict=True):
        game_uid = int(entry.uid)
        server_id = _entry_server(entry, observation.collected_from_server_id)
        scope = f"arena:{header_server}:{game_uid}"
        entry_key = idempotency_key(observation, scope, bucket)
        rows.append(
            NormalizedRow(
                target_table="arena_entries",
                idempotency_key=entry_key,
                row={
                    **common,
                    # Deterministic PK: activity facts reference this row via
                    # source_snapshot_id (FR-ACT-008), so the id must survive
                    # replays.
                    "snapshot_id": str(stable_uuid(entry_key)),
                    "raw": raw_entry,
                    "arena_snapshot_id": header_id,
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "name": entry.name,
                    "rank": entry.rank,
                    "score": entry.score,
                    "defense_power": entry.power,
                },
                entity_refs={
                    "player": {
                        "game_uid": game_uid,
                        "server_id": server_id,
                        "name": entry.name,
                    },
                },
            )
        )
    return rows
