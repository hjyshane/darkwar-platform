"""user.get.arena.info → arena_snapshots header + arena_entries rows.

The header's snapshot_id is generated deterministically from its
idempotency_key so replays regenerate the same parent PK and entries keep
pointing at it (FR-CORE-005 separates weekly matches from ranking
snapshots; this handles the ranking side).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from dw_collector.models import NormalizedRow, Observation, idempotency_key, stable_uuid
from dw_collector.registry import register
from dw_collector.resetweek import reset_week_start

PARSER_VERSION = "0.1.0-synthetic"


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    game_uid: int
    rank: int
    name: str | None = None
    score: int | None = None
    defense_power: int | None = None


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    server_id: int
    entries: list[_Entry]


@register("user.get.arena.info")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    week_start = reset_week_start(observation.captured_at)
    bucket = week_start.isoformat()
    raw_entries: list[dict[str, Any]] = observation.payload.get("entries", [])

    common = {
        "observation_id": str(observation.observation_id),
        "source_command": observation.source_command,
        "parser_version": PARSER_VERSION,
        "captured_at": observation.captured_at.isoformat(),
        "collector_id": str(observation.collector_id),
        "collected_from_server_id": observation.collected_from_server_id,
        "server_id": payload.server_id,
    }

    header_key = idempotency_key(observation, f"arena:{payload.server_id}", bucket)
    header_id = str(stable_uuid(header_key))
    rows = [
        NormalizedRow(
            target_table="arena_snapshots",
            idempotency_key=header_key,
            row={
                **common,
                "snapshot_id": header_id,
                "raw": {k: v for k, v in observation.payload.items() if k != "entries"},
                "week_start": week_start.isoformat(),
                "entry_count": len(payload.entries),
            },
        )
    ]
    for entry, raw_entry in zip(payload.entries, raw_entries, strict=True):
        scope = f"arena:{payload.server_id}:{entry.game_uid}"
        rows.append(
            NormalizedRow(
                target_table="arena_entries",
                idempotency_key=idempotency_key(observation, scope, bucket),
                row={
                    **common,
                    "raw": raw_entry,
                    "arena_snapshot_id": header_id,
                    "game_uid": entry.game_uid,
                    "name": entry.name,
                    "rank": entry.rank,
                    "score": entry.score,
                    "defense_power": entry.defense_power,
                },
                entity_refs={
                    "player": {
                        "game_uid": entry.game_uid,
                        "server_id": payload.server_id,
                        "name": entry.name,
                    },
                },
            )
        )
    return rows
