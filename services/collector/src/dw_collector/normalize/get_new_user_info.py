"""get.new.user.info → one player_detail_snapshots row.

Real payload (S14-PR6, fixture from darkwar_player_profile_cp.pcapng): a
full profile card. Its six power components —

    armyPower + heroPower + buildingPower + sciencePower + petPower
    + modCarPower

— sum to `power` EXACTLY in the captured profile, confirming the spec's
"6종 power 합계가 total과 일치" (FR-CORE-004). The parser records the
verification result instead of assuming it: `components_sum_matches` is
false when a future response disagrees, and null when a component is
missing, so a silent protocol change surfaces as data rather than a crash.

Battle stats (battleWin/battleLose/armyKill/armyDead) ride in `raw` until
they have been observed consistently enough to earn typed columns.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"

_UID_SERVER_SUFFIX = 6

POWER_COMPONENTS = (
    "armyPower",
    "heroPower",
    "buildingPower",
    "sciencePower",
    "petPower",
    "modCarPower",
)


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    power: int | None = None
    server_id: int | None = Field(default=None, alias="serverId")

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


@register("get.new.user.info")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    bucket = observation.captured_at.date().isoformat()
    game_uid = int(payload.uid)

    if payload.server_id is not None:
        server_id = payload.server_id
    elif len(payload.uid) > _UID_SERVER_SUFFIX:
        server_id = int(payload.uid[-_UID_SERVER_SUFFIX:])
    else:
        server_id = observation.collected_from_server_id

    components = {
        key: observation.payload[key]
        for key in POWER_COMPONENTS
        if isinstance(observation.payload.get(key), int)
    }
    complete = len(components) == len(POWER_COMPONENTS)
    matches = (
        sum(components.values()) == payload.power
        if complete and payload.power is not None
        else None
    )

    return [
        NormalizedRow(
            target_table="player_detail_snapshots",
            idempotency_key=idempotency_key(observation, f"get.new.user.info:{game_uid}", bucket),
            row={
                "observation_id": str(observation.observation_id),
                "source_command": observation.source_command,
                "parser_version": PARSER_VERSION,
                "captured_at": observation.captured_at.isoformat(),
                "collector_id": str(observation.collector_id),
                "collected_from_server_id": observation.collected_from_server_id,
                "raw": dict(observation.payload),
                "server_id": server_id,
                "game_uid": game_uid,
                "power_total": payload.power,
                "power_components": components,
                "components_sum_matches": matches,
            },
            entity_refs={
                "player": {
                    "game_uid": game_uid,
                    "server_id": server_id,
                    "name": payload.name,
                },
            },
        )
    ]
