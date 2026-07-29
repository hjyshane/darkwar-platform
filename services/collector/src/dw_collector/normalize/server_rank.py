"""server.rank → player_snapshots rows (cross-server player ranking).

Real payload (S14-PR5, fixture from darkwar_player_profile_cp.pcapng):
`serverRanking` holds 150 players spread across ALL eight servers of the
group, captured from a single server. This is the response the schema's
subject-vs-provenance rule was written for — each row's `server_id` is the
player's own server, while `collected_from_server_id` records where we
watched.

`lv` is the main-city (HQ) level: values cluster in the 29-45 range,
matching al.rank's mainCityLv, not an account level. The response names
the player's alliance but never its id, so `alliance_external_id` stays
null and the names ride along in `raw`.
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
    rank: int
    name: str | None = None
    power: int | None = None
    lv: int | None = None
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

    entries: list[_Entry] = Field(alias="serverRanking")


@register("server.rank")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    raw_entries: list[dict[str, Any]] = observation.payload.get("serverRanking", [])

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
                idempotency_key=idempotency_key(observation, f"server.rank:{game_uid}", bucket),
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
                    "alliance_external_id": None,
                    "hq_level": entry.lv,
                    "power": entry.power,
                    "kills": None,
                    "rank": entry.rank,
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
