"""al.rank → alliance_member_snapshots rows.

Consumes the REAL decoded payload shape (promoted at S14 from
legacy/v0.4.1 database.py; fixture extracted from darkwar_alrank.pcapng):
`allianceId` is the game's 32-hex alliance id, `list` holds members with
uid/name/rank/power/mainCityLv/armyKill/online/offLineTime/pointId/
serverId. Unpromoted fields ride along in each row's `raw`.

Redaction heuristic (legacy-verified, FR-CORE-003): the server hides other
alliances' presence by reporting everyone online with offLineTime 0 and
pointId 0 — that pattern marks the whole snapshot presence_redacted, and
online_state stays null rather than pretending everyone is online.

`offLineTime` is promoted to `offline_since` as of 1.1.0. It had been read
for the redaction heuristic and then left in `raw`, so the one field that
says when a member was actually last playing was never queryable — while the
dashboard's Last Seen column showed players.last_seen_at, which is when the
collector observed them.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.fields import month_card_expires_at
from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.1.0"

# The uid embeds the home server id as its trailing digits (D-1).
_UID_SERVER_SUFFIX = 6


class _Member(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    rank: int | None = None
    power: int | None = None
    main_city_lv: int | None = Field(default=None, alias="mainCityLv")
    army_kill: int | None = Field(default=None, alias="armyKill")
    online: bool | None = None
    off_line_time: int | None = Field(default=None, alias="offLineTime")
    point_id: int | str | None = Field(default=None, alias="pointId")
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

    alliance_id: str = Field(alias="allianceId")
    members: list[_Member] = Field(alias="list")


def _presence_redacted(members: list[_Member]) -> bool:
    return bool(members) and (
        all(member.online is True for member in members)
        and all(int(member.off_line_time or 0) == 0 for member in members)
        and all(str(member.point_id or 0) == "0" for member in members)
    )


def _offline_since(member: _Member, redacted: bool) -> str | None:
    """`offLineTime` as a timestamp, or null when it says nothing.

    Three different questions share that answer: the snapshot is redacted (the
    server withheld presence), the member was online (the field is 0 by
    definition — measured over a real roster, online is true exactly when
    offLineTime is 0), or the field is absent.
    """
    if redacted or not member.off_line_time:
        return None
    return datetime.fromtimestamp(member.off_line_time / 1000, tz=UTC).isoformat()


def _member_server(member: _Member, fallback: int) -> int:
    if member.server_id is not None:
        return member.server_id
    if len(member.uid) > _UID_SERVER_SUFFIX:
        return int(member.uid[-_UID_SERVER_SUFFIX:])
    return fallback


@register("al.rank")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    raw_members: list[dict[str, Any]] = observation.payload.get("list", [])

    redacted = _presence_redacted(payload.members)
    servers = Counter(
        _member_server(m, observation.collected_from_server_id) for m in payload.members
    )
    alliance_server = (
        servers.most_common(1)[0][0] if servers else observation.collected_from_server_id
    )

    rows: list[NormalizedRow] = []
    for member, raw_member in zip(payload.members, raw_members, strict=True):
        game_uid = int(member.uid)
        server_id = _member_server(member, observation.collected_from_server_id)
        if redacted or member.online is None:
            online_state = None
        else:
            online_state = "online" if member.online else "offline"
        scope = f"al:{payload.alliance_id}:{game_uid}"
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
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "name": member.name,
                    "member_rank": member.rank,
                    "hq_level": member.main_city_lv,
                    "power": member.power,
                    "kills": member.army_kill,
                    "presence_redacted": redacted,
                    "month_card_expires_at": month_card_expires_at(
                        raw_member.get("monthCardEndTime")
                    ),
                    "online_state": online_state,
                    "offline_since": _offline_since(member, redacted),
                },
                entity_refs={
                    "alliance": {
                        "server_id": alliance_server,
                        "external_id": payload.alliance_id,
                        "name": None,
                        "code": None,
                    },
                    "player": {
                        "game_uid": game_uid,
                        "server_id": server_id,
                        "name": member.name,
                    },
                },
            )
        )
    return rows
