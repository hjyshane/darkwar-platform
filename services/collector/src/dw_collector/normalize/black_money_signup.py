"""dragon.assign.player.info → black_money_signup_snapshots.

Black Money is the event's name on screen; on the wire it is `dragon`. It
runs every other Sunday as two teams, A and B, each fielding 20 starters and
up to 20 substitutes against a different opponent.

Real payload (journal, 2026-09-14 .. 09-27): `users` lists EVERY member of
the collector's alliance — 71 of them — not only those who signed up. Read
against today's screen and the counts it gave:

- `teamIndex` 1 is team A and 2 is team B. Absent on the 16 members who are
  on neither team.
- `state` 1 is a starter, 2 a substitute, 0 unassigned. Exactly 20 members
  per team held state 1, which is the starter cap; state 2 held 6 and 9.
- `timeIndexRecord` lists the time slots a member offered, `;`-separated
  ("2;3"), against the three periods get.dragon.battle.times defines.
  Unconfirmed against the screen, so it is stored as the wire string.
- `battleWillingness` and `battleWillingness2` take 0, 1 and 2 and are not
  understood yet. Stored as sent.

The rows carry no event id. Which event a signup belongs to is decided by
reading the snapshot against the battles, in SQL, rather than guessed here.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key, stable_uuid
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

_UID_SERVER_SUFFIX = 6


class _Member(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    abbr: str | None = None
    server_id: int | None = Field(default=None, alias="serverId")
    power: int | None = None
    level: int | None = None
    state: int | None = None
    team_index: int | None = Field(default=None, alias="teamIndex")
    time_index_record: str | None = Field(default=None, alias="timeIndexRecord")
    battle_willingness: int | None = Field(default=None, alias="battleWillingness")
    battle_willingness2: int | None = Field(default=None, alias="battleWillingness2")

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    users: list[_Member]


def home_server(uid: str, reported: int | None, fallback: int) -> int:
    """The payload's serverId when it has one, else the uid's trailing six
    digits (D-1), else where the observation was made."""
    if reported is not None:
        return reported
    if len(uid) > _UID_SERVER_SUFFIX:
        return int(uid[-_UID_SERVER_SUFFIX:])
    return fallback


@register("dragon.assign.player.info")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    raw_users: list[dict[str, Any]] = observation.payload.get("users", [])
    # One bucket per snapshot: the list is a state that changes as officers
    # move people, and every reading of it is worth keeping.
    bucket = observation.captured_at.isoformat()

    rows: list[NormalizedRow] = []
    for member, raw in zip(payload.users, raw_users, strict=True):
        game_uid = int(member.uid)
        server_id = home_server(member.uid, member.server_id, observation.collected_from_server_id)
        key = idempotency_key(observation, f"signup:{game_uid}", bucket)
        rows.append(
            NormalizedRow(
                target_table="black_money_signup_snapshots",
                idempotency_key=key,
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw,
                    "snapshot_id": str(stable_uuid(key)),
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "name": member.name,
                    "alliance_abbr": member.abbr or None,
                    "power": member.power,
                    "level": member.level,
                    "state": member.state,
                    "team_index": member.team_index,
                    # Empty string is "offered no slot", which is not a slot.
                    "time_index_record": member.time_index_record or None,
                    "battle_willingness": member.battle_willingness,
                    "battle_willingness2": member.battle_willingness2,
                },
                entity_refs={
                    "player": {
                        "game_uid": game_uid,
                        "server_id": server_id,
                        "name": member.name,
                    },
                },
            )
        )
    return rows
