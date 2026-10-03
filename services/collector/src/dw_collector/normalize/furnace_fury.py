"""al.fight.act.member.score → furnace_fury_scores (who fought, 0212).

Furnace Fury: two alliances attack each other's alliance centres (the event
text: destroy the opponent's centre 1 to 3). Its member board lists every
member of the viewing alliance who fought, with their score — the
participation list itself. Matched to the game on 2026-10-03: the user named
the event days (09-08, 09-15, 09-22, 09-29) and the board was captured on
exactly 09-15, 09-22 and 09-29; 09-29's `al.fight.act.info` says
`fightMember` 23, `crashtc` 3 (three centres destroyed), and this board holds
23 members.

Real payload: `alInfo` {allianceId, abbr, alName, serverId, attack} for the
alliance whose board it is, and `memberScores` [{uid, name, score, ...}].
No battle id and no time: the battle is the game day the board was read on.
A board opened again after a later score change is a new row; the report
takes the newest per member per day.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

_UID_SERVER_SUFFIX = 6
# The game day turns over at 02:00 UTC (midnight server time, UTC-2).
_DAY_TURNS = timedelta(hours=2)


class _Alliance(BaseModel):
    model_config = ConfigDict(extra="allow")

    alliance_id: str = Field(alias="allianceId")
    abbr: str | None = None
    name: str | None = Field(default=None, alias="alName")
    server_id: int | None = Field(default=None, alias="serverId")
    attack: int | None = None


class _Member(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    score: int | None = None

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    alliance: _Alliance = Field(alias="alInfo")
    members: list[_Member] = Field(default_factory=list, alias="memberScores")


def _game_day(captured_at: datetime) -> date:
    return (captured_at.astimezone(UTC) - _DAY_TURNS).date()


@register("al.fight.act.member.score")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    raw_members: list[dict[str, Any]] = observation.payload.get("memberScores") or []
    held_on = _game_day(observation.captured_at)
    alliance = payload.alliance
    alliance_server = alliance.server_id or observation.collected_from_server_id

    rows: list[NormalizedRow] = []
    for member, raw_member in zip(payload.members, raw_members, strict=True):
        game_uid = int(member.uid)
        server_id = (
            int(member.uid[-_UID_SERVER_SUFFIX:])
            if len(member.uid) > _UID_SERVER_SUFFIX
            else observation.collected_from_server_id
        )
        key = entry_idempotency_key(
            observation,
            f"furnace:{alliance.alliance_id}:{game_uid}",
            held_on.isoformat(),
            raw_member,
        )
        rows.append(
            NormalizedRow(
                target_table="furnace_fury_scores",
                idempotency_key=key,
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_member,
                    "snapshot_id": str(stable_uuid(key)),
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "held_on": held_on.isoformat(),
                    "alliance_external_id": alliance.alliance_id,
                    "attacker": None if alliance.attack is None else alliance.attack == 1,
                    "score": member.score,
                },
                entity_refs={
                    "player": {"game_uid": game_uid, "server_id": server_id, "name": member.name},
                    "alliance": {
                        "server_id": alliance_server,
                        "external_id": alliance.alliance_id,
                        "name": alliance.name,
                        "code": alliance.abbr,
                    },
                },
            )
        )
    return rows
