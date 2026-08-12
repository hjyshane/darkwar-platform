"""get.new.user.info → one player_detail_snapshots row + component rows.

Real payload (S14-PR6, fixture from darkwar_player_profile_cp.pcapng): a
full profile card. Its six power components —

    armyPower + heroPower + buildingPower + sciencePower + petPower
    + modCarPower

— sum to `power` EXACTLY in the captured profile, confirming the spec's
"6종 power 합계가 total과 일치" (FR-CORE-004). The parser records the
verification result instead of assuming it: `components_sum_matches` is
false when a future response disagrees, and null when a component is
missing, so a silent protocol change surfaces as data rather than a crash.

SIX COMPONENT ROWS PROMOTED IN 1.1.0. Until then the components only sat in
`player_detail_snapshots.power_components` as jsonb, which the component
trend chart never reads — the cloud only ever knew hero and pet figures,
from the boards. Re-verified before promotion (capture-sweep runbook,
2026-08-11): 97/97 recent journal profiles carry all six as ints, and on a
20-player sample the six sum to `power` on 20 of 20. heroPower and petPower
write the EXISTING hero_power_total / pet_power_total metrics — 0018
established selfPower == the profile's value exactly for boards 45 and 79,
so this is the same fact by another route, told apart by source_command
(the hero_power_best precedent). The other four are registry rows in 0109.

Battle stats (battleWin/battleLose/armyKill/armyDead) ride in `raw` until
they have been observed consistently enough to earn typed columns.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.1.0"

_UID_SERVER_SUFFIX = 6

POWER_COMPONENTS = (
    "armyPower",
    "heroPower",
    "buildingPower",
    "sciencePower",
    "petPower",
    "modCarPower",
)

# payload field -> registry metric. heroPower/petPower map onto the board
# metrics (equality pinned by 0018); the rest are 0109's account family.
COMPONENT_METRICS: dict[str, str] = {
    "heroPower": "hero_power_total",
    "petPower": "pet_power_total",
    "buildingPower": "building_power",
    "sciencePower": "science_power",
    "armyPower": "army_power",
    "modCarPower": "mod_car_power",
}


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

    rows = [
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
    rows.extend(
        _component_rows(
            observation,
            components,
            name=payload.name,
            bucket=bucket,
            game_uid=game_uid,
            server_id=server_id,
        )
    )
    return rows


def _component_rows(
    observation: Observation,
    components: dict[str, int],
    *,
    name: str | None,
    bucket: str,
    game_uid: int,
    server_id: int,
) -> list[NormalizedRow]:
    """The six component figures, one snapshot row each (1.1.0).

    Each metric gets its own idempotency discriminator — they hash the same
    observation, so without one the second row would collide with the first
    and be dropped as a duplicate, and the figure would silently never exist
    (the get.user.info.multi lesson, verbatim).

    A missing or non-int field yields no row rather than a null-power row:
    "we did not observe this" and "this is zero" are different claims. That
    is also why a sum mismatch does not suppress these rows — each figure is
    the game's own, and the mismatch is already recorded on the detail row.
    """
    rows: list[NormalizedRow] = []
    for field, metric in COMPONENT_METRICS.items():
        power = components.get(field)
        if power is None:
            continue
        rows.append(
            NormalizedRow(
                target_table="player_component_power_snapshots",
                idempotency_key=idempotency_key(
                    observation, f"get.new.user.info:{metric}:{game_uid}", bucket
                ),
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
                    "metric": metric,
                    "power": power,
                    # A profile open has no ranking behind it and no board.
                    "rank": None,
                    "board_type": None,
                    "name": name,
                    "unit_id": None,
                },
                entity_refs={
                    "player": {
                        "game_uid": game_uid,
                        "server_id": server_id,
                        "name": name,
                    },
                },
            )
        )
    return rows
