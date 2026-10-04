"""The game's item, resource and upgrade-cost tables, as rows for 0209.

What the material planner needs from the client: what every item and
resource is called, and what each level of each upgradeable thing costs.
Verified against the main account's captured login (2026-10-02): all 53 of
its buildings join `building` as id = type + level, 247 of 248 research
entries join `aps_science`, and all 159 inventory items are in `goods`.

Costs come out in one shape whatever table they came from:

    [{"type": "resource" | "item", "id": "25", "amount": 11400}, ...]

`type` matters: resource 25 (Wood) and item 25 are different things.

Kinds, and how each table names a step:

- building      `building`: id = type*1000 + level, cost_consume (resources)
                + item (items)
- research      `aps_science`: science_id + level, research_need (resources)
                + goods_need (items)
- vehicle_part  `car_equip`: slot + level, cost "item;amount|..."
- pet           `pet_levelup`: rarity + level, cost_levelup "item;amount|..."

Hero gear is not here yet: its costs are keyed by slot and quality, and the
captured gear is keyed by equipment id, so it needs a mapping verified first.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

from dw_collector.gamedata.luatable import decode
from dw_collector.gamedata.names import datatable_bytes, localisation

Row = dict[str, Any]

# Hero ids that are playable heroes, inclusive (see Catalog.hero_names).
PLAYABLE_HEROES = (1000, 89999)
# goods.type of an exclusive equipment's fragments: para1 is the equipment.
EXCLUSIVE_EQUIP_FRAGMENT = 215
# Hero experience is bought with Food, one for one.
FOOD_RESOURCE = "24"


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def _pairs(value: Any, kind: str) -> list[Row]:
    """[[id, amount], ...] → cost entries; anything malformed is skipped."""
    out: list[Row] = []
    for pair in value if isinstance(value, list) else []:
        if not isinstance(pair, list) or len(pair) < 2:
            continue
        cost_id, amount = _int(pair[0]), _int(pair[1])
        if cost_id is not None and amount:
            out.append({"type": kind, "id": str(cost_id), "amount": amount})
    return out


def _spec(value: Any, kind: str = "item") -> list[Row]:
    """ "id;amount|id;amount" → cost entries."""
    out: list[Row] = []
    for part in value.split("|") if isinstance(value, str) else []:
        cost_id, _, amount = part.partition(";")
        cid, amt = _int(cost_id), _int(amount)
        if cid is not None and amt:
            out.append({"type": kind, "id": str(cid), "amount": amt})
    return out


class Catalog:
    """Rows for game_items, game_resources and game_upgrade_steps."""

    def __init__(self, assets: Mapping[str, bytes]) -> None:
        self._assets = assets
        self.en = localisation(assets, "English")
        self.ko = localisation(assets, "Korean")
        self._tables: dict[str, dict[str, Row]] = {}

    def _rows(self, table: str) -> dict[str, Row]:
        return decode(datatable_bytes(self._assets, table), table).rows

    def _names(self, key: Any) -> tuple[str | None, str | None]:
        k = str(key).strip() if key not in (None, "") else ""
        en, ko = self.en.get(k), self.ko.get(k)
        return (en.strip() or None) if en else None, (ko.strip() or None) if ko else None

    def _templated(self, row: Mapping[str, Any]) -> tuple[str | None, str | None]:
        """Names the client builds from a template and a number.

        About 200 goods — resource crates, speedups, VIP points — have no
        `name`, or a name with a "{0}" in it, and carry `name_value` instead:
        {"180101": "10,000"} is the template key and the number to put in it,
        which the client shows as "10,000 Coins" / "코인 10,000"."""
        filled = row.get("name_value")
        if not isinstance(filled, dict) or not filled:
            return None, None
        key, value = next(iter(filled.items()))
        en, ko = self._names(key)
        return (
            en.replace("{0}", str(value)) if en else None,
            ko.replace("{0}", str(value)) if ko else None,
        )

    def _lookup(self, table: str, row_id: Any) -> tuple[str | None, str | None]:
        """A row's name in both languages, the table read once. A client
        without the table names nothing from it rather than failing."""
        if table not in self._tables:
            try:
                self._tables[table] = self._rows(table)
            except KeyError:
                self._tables[table] = {}
        row = self._tables[table].get(str(row_id).strip())
        return self._names(row.get("name")) if row else (None, None)

    def items(self) -> list[Row]:
        out = []
        for item_id, row in self._rows("goods").items():
            if not item_id.isdigit():
                continue
            name, name_ko = self._names(row.get("name"))
            if name is None or "{0}" in name:
                templated, templated_ko = self._templated(row)
                name = templated or name
                name_ko = templated_ko or name_ko
            if name is not None and "{0}" in name:
                # Fragments name their owner by id: a hero in para2 (type 93),
                # an exclusive equipment in para1 (type 215).
                if _int(row.get("type")) == EXCLUSIVE_EQUIP_FRAGMENT:
                    owner_en, owner_ko = self._lookup("heroes_exclusive_equip", row.get("para1"))
                else:
                    owner_en, owner_ko = self._lookup("aps_new_heroes", row.get("para2"))
                if owner_en:
                    name = name.replace("{0}", owner_en)
                    name_ko = name_ko.replace("{0}", owner_ko or owner_en) if name_ko else None
            out.append(
                {
                    "item_id": item_id,
                    "name": name,
                    "name_ko": name_ko,
                    "item_type": _int(row.get("type")),
                    "quality": _int(row.get("color")),
                    "icon": row.get("icon") or None,
                }
            )
        return out

    def resources(self) -> list[Row]:
        out = []
        for resource_id, row in self._rows("aps_resources").items():
            rid = _int(resource_id)
            if rid is None:
                continue
            name, name_ko = self._names(row.get("name"))
            out.append({"resource_id": rid, "name": name, "name_ko": name_ko})
        return out

    def hero_names(self) -> dict[int, str]:
        """hero id → English name, from `aps_new_heroes` (12001 → Barnett).

        The table also holds monsters and NPC units — Zombie, Elite Zombie,
        Judy, one row per tier, all under 1000 — and test copies above 90000
        (Bob 99998, Selena 99999). Playable heroes are 1000..89999. A name the
        game gives to more than one of those is left out rather than guessed:
        the catalogue keeps one hero per name (heroes_name_key).
        """
        found: dict[int, str] = {}
        for hero_id, row in self._rows("aps_new_heroes").items():
            hid = _int(hero_id)
            name, _ = self._names(row.get("name"))
            if hid is not None and name and PLAYABLE_HEROES[0] <= hid <= PLAYABLE_HEROES[1]:
                found[hid] = name
        uses: dict[str, int] = {}
        for name in found.values():
            uses[name.lower()] = uses.get(name.lower(), 0) + 1
        return {hid: name for hid, name in found.items() if uses[name.lower()] == 1}

    def steps(self) -> Iterator[Row]:
        yield from self._building_steps()
        yield from self._research_steps()
        yield from self._vehicle_steps()
        yield from self._pet_steps()
        yield from self._hero_steps()

    def _step(
        self,
        kind: str,
        subject: Any,
        level: Any,
        costs: list[Row],
        name_key: Any = None,
        seconds: Any = None,
        power: Any = None,
    ) -> Row | None:
        lvl = _int(level)
        if lvl is None or subject in (None, ""):
            return None
        name, name_ko = self._names(name_key)
        return {
            "kind": kind,
            "subject_id": str(subject),
            "level": lvl,
            "name": name,
            "name_ko": name_ko,
            "costs": costs,
            "seconds": _int(seconds),
            "power": _int(power),
        }

    def _building_steps(self) -> Iterator[Row]:
        for row_id, row in self._rows("building").items():
            full = _int(row_id)
            if full is None:
                continue
            step = self._step(
                "building",
                full // 1000 * 1000,
                full % 1000,
                _pairs(row.get("cost_consume"), "resource") + _pairs(row.get("item"), "item"),
                row.get("name"),
                row.get("time"),
                row.get("power"),
            )
            if step:
                yield step

    def _research_steps(self) -> Iterator[Row]:
        for row in self._rows("aps_science").values():
            step = self._step(
                "research",
                row.get("science_id"),
                row.get("level"),
                _pairs(row.get("research_need"), "resource")
                + _pairs(row.get("goods_need"), "item"),
                row.get("name"),
                row.get("time"),
                row.get("power"),
            )
            if step:
                yield step

    def _vehicle_steps(self) -> Iterator[Row]:
        for row in self._rows("car_equip").values():
            step = self._step(
                "vehicle_part",
                row.get("slot"),
                row.get("level"),
                _spec(row.get("cost")),
                row.get("name"),
                None,
                row.get("power"),
            )
            if step:
                yield step

    def _pet_steps(self) -> Iterator[Row]:
        for row in self._rows("pet_levelup").values():
            step = self._step(
                "pet",
                row.get("rarity"),
                row.get("level"),
                _spec(row.get("cost_levelup")),
                None,
                None,
                row.get("power_levelup"),
            )
            if step:
                yield step

    def _hero_steps(self) -> Iterator[Row]:
        """Hero levels, paid in Food (resource 24): `heroes_levelup` row L
        holds the experience from L to L+1, and a hero's experience is
        Food one for one. Stored by the level reached, like every other step:
        level 21 costs row 20's 45,000. Matched against the user's own table
        on 2026-10-03 — exact from level 2 to 170, except where theirs rounds
        (level 38: 4.2M against the game's 4,270,000)."""
        rows = self._rows("heroes_levelup")
        for level_id, row in rows.items():
            level = _int(level_id)
            exp = _int(row.get("exp"))
            if level is None or not exp or str(level + 1) not in rows:
                continue
            step = self._step(
                "hero",
                "hero",
                level + 1,
                [{"type": "resource", "id": FOOD_RESOURCE, "amount": exp}],
            )
            if step:
                yield step
