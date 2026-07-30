"""rank.get.by.range → player_component_power_snapshots.

Four cross-server boards behind one command, told apart by `type`. The
mapping is established, not guessed — see migration 0018:

    45  hero_power_total   selfPower == the profile's heroPower, exactly
    79  pet_power_total    selfPower == the profile's petPower, exactly
    49  hero_power_best    entries carry heroId, so the board is one hero
    80  pet_power_best     entries carry petId

Deliberately NOT written to player_snapshots.power. A component is not the
player's power: the collector's total is 344,948,617 while these read
70.8M / 7.9M / 7.0M / 3.1M and do not sum to it. Filing any of them as
"power" would report every ranked player at a fraction of their strength.

An unknown `type` is skipped rather than stored under a guessed name. It
still reaches schema_observations through the discovery path, which is
where a new board should show up first.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

_UID_SERVER_SUFFIX = 6

# type id -> metric name. Keys are ints because the payload sends ints.
BOARD_METRICS: dict[int, str] = {
    45: "hero_power_total",
    79: "pet_power_total",
    49: "hero_power_best",
    80: "pet_power_best",
}

# The field naming the single unit a "best" board ranks.
_UNIT_ID_FIELDS = ("heroId", "petId")


class _Entry(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    power: int | None = None
    rank: int | None = None
    server_id: int | None = Field(default=None, alias="serverId")
    alliance_name: str | None = Field(default=None, alias="allianceName")
    abbr: str | None = None

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    board_type: int = Field(alias="type")
    entries: list[_Entry] = Field(default_factory=list, alias="serverRanking")


def _server_from_uid(uid: str) -> int:
    """D-1: the uid's trailing six digits are the player's home server."""
    return int(uid[-_UID_SERVER_SUFFIX:])


def _unit_id(raw_entry: dict[str, Any]) -> int | None:
    for field in _UNIT_ID_FIELDS:
        value = raw_entry.get(field)
        if isinstance(value, int):
            return value
    return None


@register("rank.get.by.range")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    metric = BOARD_METRICS.get(payload.board_type)
    if metric is None:
        # A board we cannot name is a board we must not label.
        return []

    bucket = observation.captured_at.date().isoformat()
    raw_entries: list[dict[str, Any]] = observation.payload.get("serverRanking", [])

    rows: list[NormalizedRow] = []
    for entry, raw_entry in zip(payload.entries, raw_entries, strict=True):
        server_id = entry.server_id or _server_from_uid(entry.uid)
        rows.append(
            NormalizedRow(
                target_table="player_component_power_snapshots",
                idempotency_key=idempotency_key(observation, f"{metric}:{entry.uid}", bucket),
                row={
                    "observation_id": str(observation.observation_id),
                    "source_command": observation.source_command,
                    "parser_version": PARSER_VERSION,
                    "captured_at": observation.captured_at.isoformat(),
                    "collector_id": str(observation.collector_id),
                    "collected_from_server_id": observation.collected_from_server_id,
                    "raw": raw_entry,
                    "server_id": server_id,
                    "game_uid": int(entry.uid),
                    "metric": metric,
                    "power": entry.power,
                    "rank": entry.rank,
                    "board_type": payload.board_type,
                    "name": entry.name,
                    "alliance_name": entry.alliance_name,
                    "alliance_abbr": entry.abbr,
                    "unit_id": _unit_id(raw_entry),
                },
                entity_refs={
                    "player": {
                        "game_uid": int(entry.uid),
                        "server_id": server_id,
                        "name": entry.name,
                    }
                },
            )
        )
    return rows
