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
- `userHero[]`: the heroes and their real level, `lev`. Not
  `heroIntensifys[].lv` — that is another figure, which the planner showed as
  the level until 2026-10-04 (hero 1006: lev 96, intensify 10). A hero with
  no `lev` is in the Training Center, which holds it at the lowest level of
  the five highest heroes outside it: Katrina, with no `lev`, reads 130 in
  game beside top fives of 131/131/130/130/130; Eddie, `lev` 40, reads 40
  (user, 2026-10-04).
- `heroEquipUniques[]`: exclusive weapons, `heroId` and `level` ints (9 on
  the main account, 2026-10-04); `equipId` equals `heroId`.

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

PARSER_VERSION = "1.7.0"

# A saved march squad is a full line of heroes. A formation with fewer in
# `tempHeroes` is a leftover (2026-10-08: the collector account's squad 4 holds
# three heroes it was never deployed with; the game shows it three squads).
_SQUAD_SIZE = 5


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
        **_hero_levels(_entries(payload, "userHero")),
        "hero_squads": _squads(payload),
        "vehicle": _vehicle(payload),
        "pets": _pets(payload),
        # Exclusive weapons, one per hero that has one: heroId -> level.
        "hero_exclusives": _pairs(_entries(payload, "heroEquipUniques"), "heroId", "level"),
        "effects": _effects(payload.get("effect")),
        "timed_effects": _timed(payload.get("status")),
        "resources": _resources(payload.get("resource")),
    }


# The Training Center holds a hero at the lowest level among the five highest
# heroes outside it (see the module docstring).
TRAINING_CENTER_TOP = 5


def _hero_levels(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """`hero_levels` {heroId: level} for every hero, and `hero_trained`, the
    ids the Training Center holds — those without a `lev` — at the synced
    level. With no hero carrying a `lev` there is nothing to sync to, and
    those heroes are left out rather than given a guess."""
    own: dict[str, int] = {}
    trained: list[str] = []
    for entry in entries:
        hero = _int(entry.get("heroId"))
        if hero is None:
            continue
        level = _int(entry.get("lev"))
        if level is None:
            trained.append(str(hero))
        else:
            own[str(hero)] = level
    top = sorted(own.values(), reverse=True)[:TRAINING_CENTER_TOP]
    levels = dict(own)
    if top:
        for hero_id in trained:
            levels[hero_id] = top[-1]
    return {
        "hero_levels": levels,
        "hero_trained": sorted(trained, key=int) if top else [],
    }


# `resource` keys -> the game's resource ids (aps_resources), which is what
# every cost in game_upgrade_steps names. `coal` is what the game shows as
# Wood: it sits beside iron and electricity at ~7.1B and grows at their rate,
# while `wood` reads 0 (confirmed by the user in game, 2026-10-04). The rest
# of the block — flint, oil, water, people, pvePoint — no cost uses.
def _squads(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """`army_formation`: the account's march squads, 1-4, each its heroes in
    slot order, as hero ids (0236). A formation names heroes by `heroUuid`,
    the hero's instance id, which `userHero[].uuid` maps to its `heroId`.
    `heroes` is the squad as DEPLOYED: it is filled only while the squad is
    marching and reads `[]` at home (state 0), when the same line sits in
    `tempHeroes`. So `heroes` wins when it has anyone, and otherwise a
    `tempHeroes` line of a full 5 is the saved squad (2026-10-08, 0244 follow-up:
    every login since 10-05 had empty `heroes` and the squads read empty). A
    shorter `tempHeroes` is a leftover, not a squad (squad 4 on 2026-10-05 held
    three, two of them already in squads 1 and 3), and an empty squad stays empty.
    A uuid no hero carries is skipped rather than guessed."""
    by_uuid: dict[str, int] = {}
    for entry in _entries(payload, "userHero"):
        hero, uuid = _int(entry.get("heroId")), entry.get("uuid")
        if hero is not None and uuid is not None:
            by_uuid[str(uuid)] = hero
    squads = []
    for formation in _entries(payload, "army_formation"):
        index = _int(formation.get("index"))
        if index is None:
            continue
        slots = [s for s in formation.get("heroes") or [] if isinstance(s, dict)]
        if not slots:
            saved = [s for s in formation.get("tempHeroes") or [] if isinstance(s, dict)]
            slots = saved if len(saved) >= _SQUAD_SIZE else []
        slots.sort(key=lambda s: _int(s.get("index")) or 0)
        heroes = [
            by_uuid[str(s.get("heroUuid"))] for s in slots if str(s.get("heroUuid")) in by_uuid
        ]
        squads.append({"index": index, "heroes": heroes})
    return sorted(squads, key=lambda s: s["index"])


def _vehicle(payload: dict[str, Any]) -> dict[str, int]:
    """The vehicle (0237): `userModCar` level and the exp toward the next,
    and `modCarEquipSuit` level, the parts' set bonus. Part levels are
    `mod_car_equips`."""
    out: dict[str, int] = {}
    car = payload.get("userModCar")
    if isinstance(car, dict):
        for key in ("level", "exp"):
            value = _int(car.get(key))
            if value is not None:
                out[key] = value
    suit = payload.get("modCarEquipSuit")
    if isinstance(suit, dict) and _int(suit.get("level")) is not None:
        out["suit_level"] = _int(suit.get("level"))  # type: ignore[assignment]
    return out


def _pets(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Each pet (0237): level, the breakthrough reached, and the training
    (`refiningAttrs`, attribute id -> value). Skills and timestamps stay
    behind."""
    pets = []
    for entry in _entries(payload, "petsArr"):
        pet_id, level = _int(entry.get("petId")), _int(entry.get("level"))
        if pet_id is None or level is None:
            continue
        refining = entry.get("refiningAttrs")
        pets.append(
            {
                "pet_id": pet_id,
                "level": level,
                "breakthrough": _int(entry.get("breakthroughLevel")) or 0,
                "training": _pairs(
                    [r for r in refining if isinstance(r, dict)]
                    if isinstance(refining, list)
                    else [],
                    "attrId",
                    "value",
                ),
            }
        )
    return sorted(pets, key=lambda p: p["pet_id"])


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
