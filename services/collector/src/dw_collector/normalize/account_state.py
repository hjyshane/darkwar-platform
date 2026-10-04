"""init → one account_state_snapshots row: the logged-in account's own state.

`init` is the login response. Unlike every other command this collector
parses, it describes ONE account — whichever one logged in on the capture
machine — and it describes it completely: inventory, every building's level,
hero gear, hero enhancement, vehicle gear. That is what the material planner
needs, and nothing else carries it.

Verified before promotion (capture-sweep runbook, 2026-10-02) on all 62
logins in the live journal, 23 of them the main account and 39 the
collector's:

- `user.uid` (numeric string) and `user.serverId` (int) name the account.
- `items[]`: `itemId` a numeric string, `count` an int, itemId unique within
  a login. `para1..5` / `use` / `uuid` vary per stack and mean nothing to the
  planner yet; they are not kept.
- `building_new[]`: 53 entries every time, `bId` unique, `lv` an int. `pId`
  is the plot and repeats, so it is not the key.
- `heroEquips[]`: `equipId`, `level`, `promote` always ints; `heroId` absent
  on gear nobody is wearing (5,335 of 5,927 carry it) — absence kept as null.
- `heroIntensifys[]` and `modCarEquipArr[]`: always int pairs.
- `science_new[]`: the research tree, `{itemId, level}` int pairs, itemId
  unique within a login (136 to 248 entries as research opens up).

PRIVACY. The rest of `init` is a whole account: linked sign-in names, mail
state, chat shields, formations, purchase history. `raw` here is therefore
NOT the full payload — it is exactly the subset this parser reads, so the
cloud never holds more than the planner shows. The idempotency key still
hashes the full decoded payload (§11.2), which never leaves the journal.
The table is readable by the member who claimed the character and by
admins (0205). The event calendar in the same response is a separate,
alliance-readable row (event_schedule.py).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.normalize.event_schedule import schedule_rows
from dw_collector.registry import register

PARSER_VERSION = "1.2.0"


class _User(BaseModel):
    model_config = ConfigDict(extra="ignore")

    uid: str
    server_id: int = Field(alias="serverId")
    name: str | None = None

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Payload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    user: _User


def _int(value: Any) -> int | None:
    """An int, or a numeric string as one; anything else is not a value."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.lstrip("-").isdigit():
        return int(value)
    return None


def _entries(payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, list):
        return []
    return [entry for entry in value if isinstance(entry, dict)]


def _pairs(entries: list[dict[str, Any]], key: str, value: str) -> dict[str, int]:
    """`{key: value}` over entries where both are ints. Keys are strings
    because they become jsonb object keys."""
    out: dict[str, int] = {}
    for entry in entries:
        k, v = _int(entry.get(key)), _int(entry.get(value))
        if k is not None and v is not None:
            out[str(k)] = v
    return out


def account_state(payload: dict[str, Any]) -> dict[str, Any]:
    """The planner's view of one login: what is kept, and the whole of `raw`.

    Shared with the fixture sanitizer so a committed fixture can never carry
    a field the parser would not.
    """
    hero_equips = []
    for entry in _entries(payload, "heroEquips"):
        equip_id, level = _int(entry.get("equipId")), _int(entry.get("level"))
        if equip_id is None or level is None:
            continue
        hero_equips.append(
            {
                "equipId": equip_id,
                "heroId": _int(entry.get("heroId")),
                "level": level,
                "promote": _int(entry.get("promote")),
            }
        )
    return {
        "items": _pairs(_entries(payload, "items"), "itemId", "count"),
        "buildings": _pairs(_entries(payload, "building_new"), "bId", "lv"),
        "hero_equips": hero_equips,
        "hero_intensify": _pairs(_entries(payload, "heroIntensifys"), "heroId", "lv"),
        "mod_car_equips": _pairs(_entries(payload, "modCarEquipArr"), "equipId", "lv"),
        "science": _pairs(_entries(payload, "science_new"), "itemId", "level"),
        "effects": _effects(payload.get("effect")),
        "timed_effects": _timed(payload.get("status")),
        "resources": _resources(payload.get("resource")),
    }


# `resource` keys -> the game's resource ids (aps_resources), which is what
# every cost in game_upgrade_steps names. `coal` is what the game shows as
# Wood: it sits beside iron and electricity at ~7.1B and grows at their rate,
# while `wood` reads 0 (confirmed by the user in game, 2026-10-04). The rest
# of the block — flint, oil, water, people, pvePoint — no cost uses.
RESOURCE_IDS: dict[str, str] = {
    "coal": "25",
    "iron": "12",
    "electricity": "26",
    "food": "24",
    "money": "14",
}


def _resources(value: Any) -> dict[str, int]:
    """`resource`: the account's stock at login, by game resource id."""
    if not isinstance(value, dict):
        return {}
    out: dict[str, int] = {}
    for key, resource_id in RESOURCE_IDS.items():
        amount = _int(value.get(key))
        if amount is not None:
            out[resource_id] = amount
    return out


def _effects(value: Any) -> dict[str, float]:
    """`effect`: the server's own totals per effect id — research, buildings,
    pets and the rest already added up (30070 Construction Speed 73.14,
    30421 Reduce Construction Cost 14.5). Timed buffs are NOT in it: healing
    speed read 90 here while a +200 timed buff was running (2026-10-03)."""
    if not isinstance(value, dict):
        return {}
    out: dict[str, float] = {}
    for key, amount in value.items():
        if str(key).isdigit() and isinstance(amount, int | float) and not isinstance(amount, bool):
            out[str(key)] = float(amount)
    return out


def _timed(value: Any) -> list[dict[str, Any]]:
    """`status`: buffs with a window (presidential, emergency projects,
    event boosts) — effect id, value and start/end in epoch ms. A status
    without an end is a flag, not a buff, and is left out."""
    out: list[dict[str, Any]] = []
    for entry in value if isinstance(value, list) else []:
        if not isinstance(entry, dict):
            continue
        effect, amount, end = (
            _int(entry.get("effNum")),
            entry.get("effVal"),
            _int(entry.get("endTime")),
        )
        if effect is None or end is None or not isinstance(amount, int | float):
            continue
        out.append(
            {
                "state": _int(entry.get("stateId")),
                "effect": effect,
                "value": float(amount),
                "start": _int(entry.get("startTime")),
                "end": end,
            }
        )
    return out


@register("init")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    game_uid = int(payload.user.uid)
    server_id = payload.user.server_id
    state = account_state(observation.payload)

    rows = [
        NormalizedRow(
            target_table="account_state_snapshots",
            idempotency_key=idempotency_key(
                observation, f"init:{game_uid}", observation.captured_at.date().isoformat()
            ),
            row={
                "observation_id": str(observation.observation_id),
                "source_command": observation.source_command,
                "parser_version": PARSER_VERSION,
                "captured_at": observation.captured_at.isoformat(),
                "collector_id": str(observation.collector_id),
                "collected_from_server_id": observation.collected_from_server_id,
                "raw": {"user": {"uid": payload.user.uid, "serverId": server_id}, **state},
                "server_id": server_id,
                "game_uid": game_uid,
                **state,
            },
            entity_refs={
                "player": {
                    "game_uid": game_uid,
                    "server_id": server_id,
                    "name": payload.user.name,
                },
            },
        )
    ]
    # The same response carries the server's event calendar (event_schedule.py).
    rows.extend(schedule_rows(observation, server_id))
    return rows
