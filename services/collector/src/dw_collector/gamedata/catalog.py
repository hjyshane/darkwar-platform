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

- hero          `heroes_levelup`: Food per level
- hero_gear     `ds_equip_upgrade` / `ds_equip_promote`: subject = cost list
- exclusive     `heroes_exclusive_equip`: hero id + level, fragments

Buildings carry `tier` (industry tier, Watchtower 35+) and research
`category` (the research screen's tab).
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
# Hero gear levels are bought with Boost Ore ("a powerful crystal, used to
# enhance hero equipment").
BOOST_ORE = "230104"


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


def _requirements(value: Any) -> list[Row]:
    """`building` column: [[402000, 30], ...] -> [{"subject": "402000",
    "level": 30}]. The level is the one the other building must be at."""
    out: list[Row] = []
    for pair in value if isinstance(value, list) else []:
        if isinstance(pair, list) and len(pair) >= 2:
            subject, level = _int(pair[0]), _int(pair[1])
            if subject is not None and level is not None:
                out.append({"subject": str(subject), "level": level})
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

    def hero_gear(self) -> list[Row]:
        """Hero gear by equipId (`ds_equip`): 410100 D5-Slayer, quality 5.
        An account's gear is an equipId; the quality picks its cost list."""
        out = []
        for equip_id, row in self._rows("ds_equip").items():
            eid = _int(equip_id)
            if eid is None:
                continue
            name, name_ko = self._names(row.get("name"))
            out.append(
                {
                    "equip_id": eid,
                    "name": name,
                    "name_ko": name_ko,
                    "quality": _int(row.get("quality")),
                    "slot": _int(row.get("slot")),
                }
            )
        return out

    def research_tabs(self) -> list[Row]:
        """The research screen's tabs (`aps_science_tab`): name, order, and
        the servers that see each. Servers 1-564 and 565+ have different
        trees (Develop / Economy vs New Home / Shelter Building); a tab with
        no server range is shown everywhere."""
        out = []
        for tab_id, row in self._rows("aps_science_tab").items():
            tid = _int(tab_id)
            if tid is None:
                continue
            name, name_ko = self._names(row.get("name"))
            ranges = row.get("server")
            servers = [
                [_int(r[0]), _int(r[1])]
                for r in (ranges if isinstance(ranges, list) else [])
                if isinstance(r, list) and len(r) >= 2
            ]
            out.append(
                {
                    "tab_id": tid,
                    "name": name,
                    "name_ko": name_ko,
                    "sort_order": _int(row.get("order")),
                    "servers": servers,
                }
            )
        return out

    def effects(self) -> list[Row]:
        """Effect ids the server sums per account (init.effect) and the names
        the client shows for them: 30070 Construction Speed, 30421 Reduce
        Construction Cost. From `effect_num_des`."""
        out = []
        for effect_id, row in self._rows("effect_num_des").items():
            eid = _int(effect_id)
            if eid is None:
                continue
            name, name_ko = self._names(row.get("des"))
            out.append(
                {
                    "effect_id": eid,
                    "name": name,
                    "name_ko": name_ko,
                    "is_minus": bool(_int(row.get("is_minus"))),
                }
            )
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

    def hero_rarity(self) -> list[Row]:
        """hero id → rarity, from `aps_new_heroes`: 1 is the top tier the game
        shows in yellow (Katrina, Francis, Selwyn), larger numbers lower. The
        planner lists heroes by it, newest first within a rarity (0229)."""
        out = []
        for hero_id, row in self._rows("aps_new_heroes").items():
            hid, rarity = _int(hero_id), _int(row.get("rarity"))
            if (
                hid is not None
                and rarity is not None
                and PLAYABLE_HEROES[0] <= hid <= PLAYABLE_HEROES[1]
            ):
                out.append({"hero_id": hid, "rarity": rarity})
        return out

    def steps(self) -> Iterator[Row]:
        yield from self._building_steps()
        yield from self._research_steps()
        yield from self._vehicle_steps()
        yield from self._pet_steps()
        yield from self._hero_steps()
        yield from self._hero_gear_steps()
        yield from self._exclusive_steps()

    def _step(
        self,
        kind: str,
        subject: Any,
        level: Any,
        costs: list[Row],
        name_key: Any = None,
        seconds: Any = None,
        power: Any = None,
        requires: list[Row] | None = None,
        tier: Any = None,
        category: Any = None,
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
            "requires": requires or [],
            "tier": _int(tier),
            "category": _int(category),
        }

    def _building_steps(self) -> Iterator[Row]:
        """By the level REACHED, like every other step. A `building` row is
        the building at level L and what it takes to go on to L+1: its
        cost_consume, item, time and the buildings it needs (`building`,
        [[402000, 30], ...] — Watchtower 30 needs Alliance Hall 30 and Fighter
        Camp 30, as the user's table says). So the step to L+1 carries row L's
        cost and requirements and row L+1's name and power, and the top row,
        with nothing after it, is no step."""
        rows = self._rows("building")
        for row_id, row in rows.items():
            full = _int(row_id)
            following = rows.get(str(full + 1)) if full is not None else None
            if full is None or following is None:
                continue
            step = self._step(
                "building",
                full // 1000 * 1000,
                full % 1000 + 1,
                _pairs(row.get("cost_consume"), "resource") + _pairs(row.get("item"), "item"),
                following.get("name"),
                row.get("time"),
                following.get("power"),
                _requirements(row.get("building")),
                # Industry tier of the level reached: Watchtower 35-39 is
                # "Industry Lv.1", 40-44 Lv.2 ... 80 Lv.10. Only it has one.
                following.get("industry_level"),
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
                # The research screen's tab (aps_science_tab).
                category=row.get("tab"),
            )
            if step:
                yield step

    def _vehicle_steps(self) -> Iterator[Row]:
        """Level reached: a `car_equip` row is the part at level L (from 0)
        and the cost to go on to L+1; the top row has none."""
        rows = self._rows("car_equip")
        by_level = {(_int(r.get("slot")), _int(r.get("level"))): r for r in rows.values()}
        for (slot, level), row in by_level.items():
            following = by_level.get((slot, (level or 0) + 1)) if level is not None else None
            costs = _spec(row.get("cost"))
            if following is None or not costs:
                continue
            step = self._step(
                "vehicle_part",
                slot,
                (level or 0) + 1,
                costs,
                following.get("name"),
                None,
                following.get("power"),
            )
            if step:
                yield step

    def _pet_steps(self) -> Iterator[Row]:
        """Level reached: a `pet_levelup` row is the pet at level L and the
        cost to go on to L+1; the top row (100) has none."""
        rows = self._rows("pet_levelup")
        by_level = {(_int(r.get("rarity")), _int(r.get("level"))): r for r in rows.values()}
        for (rarity, level), row in by_level.items():
            following = by_level.get((rarity, (level or 0) + 1)) if level is not None else None
            costs = _spec(row.get("cost_levelup"))
            if following is None or not costs:
                continue
            step = self._step(
                "pet",
                rarity,
                (level or 0) + 1,
                costs,
                None,
                None,
                following.get("power_levelup"),
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

    def _hero_gear_steps(self) -> Iterator[Row]:
        """Hero gear, in the two tracks the game runs (user, 2026-10-03).

        LEVELS (`ds_equip_upgrade`): one Boost Ore cost per level in
        `stone_upgrade_cost`, as many as the quality's highest level (60 for
        purple, 100 for orange). Every slot of a quality has the same list, so
        the subject is the quality: "level:q5". Entry i takes level i to i+1.

        STAGES (`ds_equip_promote`), after level 100: rows at levels 0-9 are
        the ten stage-ups (Power Core only), and from level 10 the awakening —
        Power Core and Boost Ore, with DX-Blueprint every fifth step. A row's
        level is where it starts; the top row is empty. Subject "promote".

        Both are stored by the level reached, like every other step.
        """
        seen: set[str] = set()
        for row in self._rows("ds_equip_upgrade").values():
            quality = _int(row.get("quality"))
            ore = [_int(v) for v in str(row.get("stone_upgrade_cost", "")).split(";")]
            subject = f"level:q{quality}"
            if quality is None or subject in seen:
                continue
            seen.add(subject)
            for index, amount in enumerate(ore):
                if amount:
                    step = self._step(
                        "hero_gear",
                        subject,
                        index + 1,
                        [{"type": "item", "id": BOOST_ORE, "amount": amount}],
                    )
                    if step:
                        yield step
        for row in self._rows("ds_equip_promote").values():
            costs = _spec(row.get("cost_goods"))
            if not costs:
                continue
            step = self._step("hero_gear", "promote", (_int(row.get("level")) or 0) + 1, costs)
            if step:
                yield step

    def _exclusive_steps(self) -> Iterator[Row]:
        """Exclusive weapons (`heroes_exclusive_equip`): one row per hero
        (`group`) and level 0-52, each holding the fragments to go on to the
        next level (`cost_item` x `cost_num`; the top row is empty). Stored by
        the level reached, subject the hero id — Pyro Pup (hero 40002) level
        1 costs row 0's 10 fragments."""
        for row in self._rows("heroes_exclusive_equip").values():
            item, amount = _int(row.get("cost_item")), _int(row.get("cost_num"))
            level = _int(row.get("level"))
            if item is None or not amount or level is None:
                continue
            step = self._step(
                "exclusive",
                row.get("group"),
                level + 1,
                [{"type": "item", "id": str(item), "amount": amount}],
                row.get("name"),
            )
            if step:
                yield step
