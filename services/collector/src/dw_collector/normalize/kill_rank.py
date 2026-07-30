"""kill.rank → player_snapshots (cross-server kill ranking).

Real payload (discovery sweep): `serverRanking` holds {uid, name, armyKill,
rank, serverId, allianceName, abbr} for 150 players across all eight tracked
servers. It carries no power and no level, which is exactly why it is worth
having — server.rank gives power without kills, and this gives kills without
power. The summary triggers coalesce, so neither response erases what the
other observed.

`player_snapshots.rank` means "position in the ranking this row came from",
and `source_command` is what disambiguates: 'server.rank' is a power
position, 'kill.rank' a kill position. No extra column is needed to say so,
since every snapshot row already records its command.
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
    army_kill: int | None = Field(default=None, alias="armyKill")
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


@register("kill.rank")
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
                idempotency_key=idempotency_key(observation, f"kill.rank:{game_uid}", bucket),
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
                    # This response names the alliance without identifying it.
                    "alliance_external_id": None,
                    "hq_level": None,
                    "power": None,
                    "kills": entry.army_kill,
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
