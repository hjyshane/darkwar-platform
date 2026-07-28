"""al.rank → alliance_member_snapshots rows.

Field names are provisional until the v0.4.1 parser is promoted (S14); the
per-member `raw` jsonb absorbs whatever the real decoder emits, so renames
need no migration. Validation is strict about structure (members must be a
list of objects with a game_uid) and lenient about everything else.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "0.1.0-synthetic"


class _Alliance(BaseModel):
    model_config = ConfigDict(extra="allow")

    external_id: int
    server_id: int
    name: str | None = None
    code: str | None = None
    power: int | None = None
    member_count: int | None = None


class _Member(BaseModel):
    model_config = ConfigDict(extra="allow")

    game_uid: int
    name: str | None = None
    member_rank: int | None = None
    hq_level: int | None = None
    power: int | None = None
    kills: int | None = None
    online_state: str | None = None
    presence_redacted: bool = False


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    alliance: _Alliance
    members: list[_Member]


@register("al.rank")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    alliance = payload.alliance
    bucket = observation.captured_at.date().isoformat()
    raw_members: list[dict[str, Any]] = observation.payload.get("members", [])

    rows: list[NormalizedRow] = []
    for member, raw_member in zip(payload.members, raw_members, strict=True):
        scope = f"al:{alliance.server_id}:{alliance.external_id}:{member.game_uid}"
        rows.append(
            NormalizedRow(
                target_table="alliance_member_snapshots",
                idempotency_key=idempotency_key(observation, scope, bucket),
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_member,
                    "server_id": alliance.server_id,
                    "game_uid": member.game_uid,
                    "name": member.name,
                    "member_rank": member.member_rank,
                    "hq_level": member.hq_level,
                    "power": member.power,
                    "kills": member.kills,
                    "presence_redacted": member.presence_redacted,
                    "online_state": member.online_state,
                },
                entity_refs={
                    "alliance": {
                        "server_id": alliance.server_id,
                        "external_id": alliance.external_id,
                        "name": alliance.name,
                        "code": alliance.code,
                    },
                    "player": {
                        "game_uid": member.game_uid,
                        "server_id": alliance.server_id,
                        "name": member.name,
                    },
                },
            )
        )
    return rows
