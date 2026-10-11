"""alliance.boss.damage.rank.new -> boss_damage_scores (Frankie, 0276).

The alliance's Frankie (Bio-Mutant) damage board: every member who hit the
boss in the event, with the damage they did. Matched to the game on
2026-10-11: the 10-05 board summed to 830,655,667,504 and the alliance's best
event (`dmgRecordArr` in get.alliance.boss.activity.info.new) became exactly
that number the same day, so a board is ONE event's total and a new event
starts it over. 39 and 45 members on the two days it was read.

Real payload: `rankList` [{uid, name, abbr, damage, rank, ...}]. No event id,
no time, no alliance id: the event is the game day / Frankie start the read
followed (decided in boss_damage_by_event), and the alliance is the viewer's.

NOT used: `alliance.boss.personal.damage`. It lists the rallies the
collector's account saw (24 rallies, 85B of the 10-11 event's 564B), so a
member's total from it is a floor of unknown tightness.
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


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    damage: int = Field(ge=0)
    rank: int | None = Field(default=None, gt=0)

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    entries: list[_Entry] = Field(default_factory=list, alias="rankList")


def _game_day(captured_at: datetime) -> date:
    return (captured_at.astimezone(UTC) - _DAY_TURNS).date()


@register("alliance.boss.damage.rank.new")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    raw_entries: list[dict[str, Any]] = observation.payload.get("rankList") or []
    held_on = _game_day(observation.captured_at)

    rows: list[NormalizedRow] = []
    for entry, raw_entry in zip(payload.entries, raw_entries, strict=True):
        game_uid = int(entry.uid)
        server_id = (
            int(entry.uid[-_UID_SERVER_SUFFIX:])
            if len(entry.uid) > _UID_SERVER_SUFFIX
            else observation.collected_from_server_id
        )
        # The key hashes the raw entry, so a re-read with the same damage is
        # one row and a read after more damage is a new one.
        key = entry_idempotency_key(
            observation,
            f"boss_damage:{game_uid}",
            held_on.isoformat(),
            raw_entry,
        )
        rows.append(
            NormalizedRow(
                target_table="boss_damage_scores",
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
                    "held_on": held_on.isoformat(),
                    "rank": entry.rank,
                    "damage": entry.damage,
                },
                entity_refs={
                    "player": {"game_uid": game_uid, "server_id": server_id, "name": entry.name},
                },
            )
        )
    return rows
