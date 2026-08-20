"""desert.force.server.rank → player_season_force_snapshots.

The season 3 player "force" board. 149 players in the observed response,
every field below present in 149/149 rows
(season_tab_map_building.pcapng, 2026-08-20).

`force` is NOT power. The response carries no power column, nothing observed
relates the two, and the two boards for this season disagree even in scale —
alliance `score` runs in the hundreds of thousands while `force` runs in the
thousands. Writing it into any power column would be the same corruption
migration 0018 describes for the component boards.

No entry carries a serverId (0 of 149 did), so the home server is decoded
from the uid's trailing six digits — the D-1 rule rank_by_range.py already
relies on. Every uid observed was 16 digits and decoded to 580, i.e. this
board is server-local even though the alliance board for the same season is
not. The decode is applied rather than assumed constant, because "every uid
in one capture said 580" is not the same claim as "this board is always
server-local".
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

_UID_SERVER_SUFFIX = 6


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    # All lower case, unlike the alliance board's `allianceName`.
    alliance_name: str | None = Field(default=None, alias="alliancename")
    alliance_id: str | None = Field(default=None, alias="allianceId")
    abbr: str | None = None
    country: str | None = None
    force: int | None = None
    rank: int | None = None

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    entries: list[_Entry] = Field(default_factory=list, alias="serverRanking")


def _server_from_uid(uid: str) -> int:
    """D-1: the uid's trailing six digits are the player's home server."""
    return int(uid[-_UID_SERVER_SUFFIX:])


@register("desert.force.server.rank")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    raw_entries: list[dict[str, Any]] = observation.payload.get("serverRanking", [])

    rows: list[NormalizedRow] = []
    for entry, raw_entry in zip(payload.entries, raw_entries, strict=True):
        server_id = _server_from_uid(entry.uid)
        rows.append(
            NormalizedRow(
                target_table="player_season_force_snapshots",
                idempotency_key=idempotency_key(observation, f"player:{entry.uid}", bucket),
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_entry,
                    "server_id": server_id,
                    "game_uid": int(entry.uid),
                    "name": entry.name,
                    "alliance_external_id": entry.alliance_id,
                    "alliance_name": entry.alliance_name,
                    "alliance_abbr": entry.abbr,
                    "country": entry.country,
                    "force": entry.force,
                    "rank": entry.rank,
                },
                entity_refs={
                    "player": {
                        "game_uid": int(entry.uid),
                        "server_id": server_id,
                        "name": entry.name,
                    },
                },
            )
        )
    return rows
