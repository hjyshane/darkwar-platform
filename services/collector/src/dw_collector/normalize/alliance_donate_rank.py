"""The two donation rankings → alliance_contribution_snapshots.

Real payload (fixture extracted from a discovery sweep): `rankList` holds
{uid, score, updateTime} per member, ordered by score descending. The uid is
a real UID, which is what makes this usable — the alternatives found in the
same sweep attribute by display name or report an alliance total, and
neither can honestly become a per-player fact.

`updateTime` is when the server last changed that member's score, which is
strictly better provenance than captured_at (when we happened to look).

The daily and weekly boards are two SEPARATE commands, not a `type` field on
one — the shape the duel ranking has. Confirmed from re-capture.pcapng, where
they arrive 37s apart and their top three match the two lists written down off
the screen. Only the period differs, so one parser serves both and the command
picks the contribution_type; the period is never derived from a score.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key, stable_uuid
from dw_collector.registry import register
from dw_collector.resetweek import reset_week_start

PARSER_VERSION = "1.1.0"

CONTRIBUTION_TYPES = {
    "get.daily.alliance.donate.rank": "daily_donation",
    "get.week.alliance.donate.rank": "weekly_donation",
}

_UID_SERVER_SUFFIX = 6


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    score: int | None = None
    update_time: int | None = Field(default=None, alias="updateTime")

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    entries: list[_Entry] = Field(alias="rankList")


@register("get.daily.alliance.donate.rank")
@register("get.week.alliance.donate.rank")
def normalize(observation: Observation) -> list[NormalizedRow]:
    contribution_type = CONTRIBUTION_TYPES[observation.source_command]
    payload = _Payload.model_validate(observation.payload)
    raw_entries: list[dict[str, Any]] = observation.payload.get("rankList", [])
    # Both rankings reset with the game week; bucketing by week start keeps
    # one key per member per week while the raw payload hash still separates
    # genuinely different readings. The two cannot collide despite sharing a
    # bucket: §11.2 puts source_command in the key ahead of the scope.
    bucket = reset_week_start(observation.captured_at).isoformat()

    rows: list[NormalizedRow] = []
    for position, (entry, raw_entry) in enumerate(
        zip(payload.entries, raw_entries, strict=True), start=1
    ):
        game_uid = int(entry.uid)
        if len(entry.uid) > _UID_SERVER_SUFFIX:
            server_id = int(entry.uid[-_UID_SERVER_SUFFIX:])
        else:
            server_id = observation.collected_from_server_id
        scope = f"donate:{game_uid}"
        key = idempotency_key(observation, scope, bucket)
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
                    # Deterministic so activity facts can reference it across
                    # replays (FR-ACT-008).
                    "snapshot_id": str(stable_uuid(key)),
                    "server_id": server_id,
                    "game_uid": game_uid,
                    "alliance_id": None,
                    "contribution_type": contribution_type,
                    "score": entry.score,
                    "rank": position,
                    "score_updated_at": (
                        datetime.fromtimestamp(entry.update_time / 1000, tz=UTC).isoformat()
                        if entry.update_time
                        else None
                    ),
                },
                entity_refs={
                    "player": {
                        "game_uid": game_uid,
                        "server_id": server_id,
                        "name": None,
                    },
                },
            )
        )
    return rows
