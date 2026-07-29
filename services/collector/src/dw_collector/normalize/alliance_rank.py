"""alliance.rank → alliance_snapshots rows.

Real payload (S14-PR3, fixtures from darkwar_alliance_rank_local*.pcapng):
`allianceRanking` entries carry uid (32-hex alliance id), alliancename,
abbr, leader (a NAME, not a uid — leader_game_uid stays null), fightpower,
curMember/maxMember, rank, serverId, country, icon.

The request's rangeType (0=local, 1=cross-server) is not echoed in the
response, so scope is not stored as fact. Local and cross responses taken
the same day still get distinct idempotency keys because the key hashes
the raw payload. Consumers can recover the scope from the stored rows
(single- vs mixed-server snapshot batch).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    rank: int
    server_id: int | None = Field(default=None, alias="serverId")
    alliancename: str | None = None
    abbr: str | None = None
    fightpower: int | None = None
    cur_member: int | None = Field(default=None, alias="curMember")


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    entries: list[_Entry] = Field(alias="allianceRanking")


@register("alliance.rank")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    raw_entries: list[dict[str, Any]] = observation.payload.get("allianceRanking", [])

    rows: list[NormalizedRow] = []
    for entry, raw_entry in zip(payload.entries, raw_entries, strict=True):
        server_id = (
            entry.server_id if entry.server_id is not None else observation.collected_from_server_id
        )
        scope = f"alliance.rank:{entry.uid}"
        rows.append(
            NormalizedRow(
                target_table="alliance_snapshots",
                idempotency_key=idempotency_key(observation, scope, bucket),
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_entry,
                    "server_id": server_id,
                    "external_id": entry.uid,
                    "name": entry.alliancename,
                    "code": entry.abbr,
                    "power": entry.fightpower,
                    "member_count": entry.cur_member,
                    "rank": entry.rank,
                },
                entity_refs={
                    "alliance": {
                        "server_id": server_id,
                        "external_id": entry.uid,
                        "name": entry.alliancename,
                        "code": entry.abbr,
                    },
                },
            )
        )
    return rows
