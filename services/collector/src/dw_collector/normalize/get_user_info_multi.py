"""get.user.info.multi → player_snapshots rows (public player summaries).

Real payload (S14-PR7, fixture from darkwar_player_profile_cp.pcapng): a
`uids` list of summary cards. Unlike server.rank this response DOES carry
`allianceId`, so it is the one summary source that can populate
`alliance_external_id` without a second lookup.

Two fields deliberately not mapped:

- `rank` reads 0 in every captured response — neither a leaderboard
  position nor an R1-R5 alliance grade — so it stays in `raw` rather than
  becoming a guessed column value.
- `level` is 1 while `mainBuildingLevel` is 35-45; the latter is the HQ
  level the product means.
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
    power: int | None = None
    main_building_level: int | None = Field(default=None, alias="mainBuildingLevel")
    army_kill: int | None = Field(default=None, alias="armyKill")
    alliance_id: str | None = Field(default=None, alias="allianceId")
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

    entries: list[_Entry] = Field(alias="uids")


@register("get.user.info.multi")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    raw_entries: list[dict[str, Any]] = observation.payload.get("uids", [])

    rows: list[NormalizedRow] = []
    for entry, raw_entry in zip(payload.entries, raw_entries, strict=True):
        game_uid = int(entry.uid)
        if entry.server_id is not None:
            server_id = entry.server_id
        elif len(entry.uid) > _UID_SERVER_SUFFIX:
            server_id = int(entry.uid[-_UID_SERVER_SUFFIX:])
        else:
            server_id = observation.collected_from_server_id
        rows.append(
            NormalizedRow(
                target_table="player_snapshots",
                idempotency_key=idempotency_key(
                    observation, f"get.user.info.multi:{game_uid}", bucket
                ),
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_entry,
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "name": entry.name,
                    "alliance_external_id": entry.alliance_id,
                    "hq_level": entry.main_building_level,
                    "power": entry.power,
                    "kills": entry.army_kill,
                    "rank": None,
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
