"""get.al.info → one alliance_snapshots row (alliance detail).

Real payload (S14-PR4, fixtures from darkwar_alliance_rank_580_T2.pcapng
and darkwar_player_alliance_profile_cp.pcapng): a single alliance's detail
card — uid (32-hex), name, abbr, fightPower, curMember/maxMember,
createServer/createTime, giftLevel, country, and crucially `leaderUid`,
the only confirmed response that gives the leader as a UID rather than a
display name. That fills alliance_snapshots.leader_game_uid, which
alliance.rank cannot.

`rank` stays null: a detail card carries no ranking position.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    abbr: str | None = None
    fight_power: int | None = Field(default=None, alias="fightPower")
    cur_member: int | None = Field(default=None, alias="curMember")
    leader_uid: str | None = Field(default=None, alias="leaderUid")
    # The server the alliance was founded on. Post-merge this can differ
    # from where it currently fights (`crossFightSrcServerId`, kept in raw).
    create_server: int | None = Field(default=None, alias="createServer")

    @field_validator("leader_uid")
    @classmethod
    def _numeric_leader(cls, value: str | None) -> str | None:
        if value is not None and not value.isdigit():
            msg = f"leaderUid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


@register("get.al.info")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    server_id = (
        payload.create_server
        if payload.create_server is not None
        else observation.collected_from_server_id
    )

    return [
        NormalizedRow(
            target_table="alliance_snapshots",
            idempotency_key=idempotency_key(observation, f"get.al.info:{payload.uid}", bucket),
            row={
                "observation_id": str(observation.observation_id),
                "source_command": observation.source_command,
                "parser_version": PARSER_VERSION,
                "captured_at": observation.captured_at.isoformat(),
                "collector_id": str(observation.collector_id),
                "collected_from_server_id": observation.collected_from_server_id,
                "raw": dict(observation.payload),
                "server_id": server_id,
                "external_id": payload.uid,
                "name": payload.name,
                "code": payload.abbr,
                "power": payload.fight_power,
                "member_count": payload.cur_member,
                "leader_game_uid": int(payload.leader_uid) if payload.leader_uid else None,
                "rank": None,
            },
            entity_refs={
                "alliance": {
                    "server_id": server_id,
                    "external_id": payload.uid,
                    "name": payload.name,
                    "code": payload.abbr,
                },
            },
        )
    ]
