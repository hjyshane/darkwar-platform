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

    def _rows(self, table: str) -> dict[str, Row]:
        return decode(datatable_bytes(self._assets, table), table).rows

    def _names(self, key: Any) -> tuple[str | None, str | None]:
        k = str(key).strip() if key not in (None, "") else ""
        en, ko = self.en.get(k), self.ko.get(k)
        return (en.strip() or None) if en else None, (ko.strip() or None) if ko else None

    def items(self) -> list[Row]:
        out = []
        for item_id, row in self._rows("goods").items():
            if not item_id.isdigit():
                continue
            name, name_ko = self._names(row.get("name"))
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
        """hero id → English name, from `aps_new_heroes` (12001 → Barnett)."""
        out: dict[int, str] = {}
        for hero_id, row in self._rows("aps_new_heroes").items():
            hid = _int(hero_id)
            name, _ = self._names(row.get("name"))
            if hid is not None and name:
                out[hid] = name
        return out

    def steps(self) -> Iterator[Row]:
        yield from self._building_steps()
        yield from self._research_steps()
        yield from self._vehicle_steps()
        yield from self._pet_steps()

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
