"""al.battle.rank.info → alliance_contribution_snapshots (battle scores).

Real payload (discovery sweep): `rankInfo` holds {uid, name, score, alName,
abbr, serverId} per player, ordered by score descending, with a top-level
`type` that selects between two different rankings — both were captured, with
different leaders and scores an order of magnitude apart. What `type` means
is unknown, so it is stored as `variant` and not interpreted.

Two things this response teaches:

- It attributes by UID, unlike al.battle.week.result.info which gives only a
  display name. That is what makes it usable as a per-player fact.
- The daily and weekly rankings name BOTH alliances in the duel — 165 rows
  where our roster is 94 — so `alName` is what tells our players' scores from
  the opponent's. The round total (type 2) lists only ours.
- It spans servers outside the tracked group (586 appeared alongside 580), so
  the sync worker has to register unknown servers rather than assume the
  group is closed.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key, stable_uuid
from dw_collector.registry import register
from dw_collector.resetweek import reset_week_start

PARSER_VERSION = "1.1.0"
CONTRIBUTION_TYPE = "alliance_battle"

_UID_SERVER_SUFFIX = 6


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    score: int | None = None
    server_id: int | None = Field(default=None, alias="serverId")
    # A duel ranking names both alliances. Without these, an opponent's score
    # is indistinguishable from ours.
    alliance_name: str | None = Field(default=None, alias="alName")
    alliance_code: str | None = Field(default=None, alias="abbr")

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    entries: list[_Entry] = Field(alias="rankInfo")
    variant: int | None = Field(default=None, alias="type")


@register("al.battle.rank.info")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    raw_entries: list[dict[str, Any]] = observation.payload.get("rankInfo", [])
    # The variant belongs in the key: the two rankings are different data and
    # must not collide on the same member in the same week.
    bucket = f"{reset_week_start(observation.captured_at).isoformat()}:v{payload.variant}"

    rows: list[NormalizedRow] = []
    for position, (entry, raw_entry) in enumerate(
        zip(payload.entries, raw_entries, strict=True), start=1
    ):
        game_uid = int(entry.uid)
        if entry.server_id is not None:
            server_id = entry.server_id
        elif len(entry.uid) > _UID_SERVER_SUFFIX:
            server_id = int(entry.uid[-_UID_SERVER_SUFFIX:])
        else:
            server_id = observation.collected_from_server_id
        key = idempotency_key(observation, f"battle:{game_uid}", bucket)
        rows.append(
            NormalizedRow(
                target_table="alliance_contribution_snapshots",
                idempotency_key=key,
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_entry,
                    "snapshot_id": str(stable_uuid(key)),
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "alliance_id": None,
                    # Empty string means "no alliance" in this payload, and an
                    # empty tag must not read as a tag.
                    "alliance_name": entry.alliance_name or None,
                    "alliance_code": entry.alliance_code or None,
                    "contribution_type": CONTRIBUTION_TYPE,
                    "score": entry.score,
                    "rank": position,
                    "score_updated_at": None,
                    "variant": payload.variant,
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
