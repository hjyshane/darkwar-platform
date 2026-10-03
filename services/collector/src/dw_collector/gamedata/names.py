"""Names the game sends as numbers, resolved from the client's own tables.

The server never sends a name. An event is `{"id": "41101", ...}`; the client
looks 41101 up in its `activity_panel` datatable, finds a localisation key in
the `name` column, and looks that up in the language it is set to. This
module does the same two lookups with the client's files.

Localisation is plain `key=value` lines, sliced across six bundles per
language (`.../localization/<language>/dictionaries/dialog_N.txt`).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from dw_collector.gamedata.luatable import decode

_DATATABLE_SUFFIX = "/luadatatable/{name}.bytes"


def localisation(assets: Mapping[str, bytes], language: str = "English") -> dict[str, str]:
    """Every `key=value` string for one language, across all its slices."""
    marker = f"/localization/{language.lower()}/dictionaries/"
    out: dict[str, str] = {}
    for path in sorted(p for p in assets if marker in p):
        for line in assets[path].decode("utf-8", "replace").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip().isdigit():
                out[key.strip()] = value
    return out


def datatable_bytes(assets: Mapping[str, bytes], name: str) -> bytes:
    suffix = _DATATABLE_SUFFIX.format(name=name.lower())
    for path, data in assets.items():
        if path.endswith(suffix):
            return data
    raise KeyError(f"no datatable {name!r} in these bundles")


# activity_panel.type values that are something to BUY, not something to play
# (0210): passes and gifts 27/288/45/46, packs 274/998/257, shops and markets
# 20/240/250/93, gacha draws 36/43/205. Read off the 2026-10-03 calendar's 67
# named events; the in-game tabs ("Hot", "Regular") do not separate them.
SHOP_TYPES = frozenset({20, 27, 36, 43, 45, 46, 93, 205, 240, 250, 257, 274, 288, 998})

# The calendar's categories (0211), first match wins. Types are the client's
# activity_panel.type; several are shared by unrelated events (18 is both a
# Tyrant and every King Scorpion, 20 is every exchange shop), so those are
# matched by id instead.
MAJOR_TYPES = frozenset({54, 71, 210})  # Capital Clash, Black Gold, Bio-Mutant
RECURRING_TYPES = frozenset({12, 14, 23, 111, 119})  # Survival Prep, Duel, Tyrant
RECURRING_IDS = frozenset({"4009603"})  # Tyrant-V Comes on the shared type 18
# The season's own events (Ice Pit 126, Endless Night and the earlier
# Catastrophes 239, Frozen Rescue 1008, Snowman Mania 1009, the Season 38,
# its building queue 225 and rebates 130) and its finale (Season Celebration
# 131). The season passes 45/46 are season, not pass: they end with it.
SEASON_TYPES = frozenset({38, 45, 46, 126, 130, 131, 225, 239, 1008, 1009})
SEASON_IDS = frozenset({"40735"})  # Arctic Veins, type 25
# Each season's finale is numbered from its Celebration (103000, 104000, ...):
# Celebration Trial, Celebration Shop, Survivor Market and Allied Power sit in
# the thousand ids after it.
SEASON_FINALES = (103000, 104000, 105000, 106000)
PASS_TYPES = frozenset({109, 288})  # Event Monthly Pass, Custom Weekly Pass
# The other passes share their types with gifts and shops — 27 holds Hero
# Battle Pass next to Catherine's Gift, 20 holds Industrial Surge next to every
# exchange shop — so among things to buy, a pass is told by its name.
PASS_WORDS = ("pass", "rise of industry", "industrial surge")


def classify(activity_id: str, kind: int | None, name: str) -> str:
    """The calendar category for one activity."""
    number = int(activity_id) if activity_id.isdigit() else -1
    if kind in MAJOR_TYPES:
        return "major"
    if kind in RECURRING_TYPES or activity_id in RECURRING_IDS:
        return "recurring"
    if (
        kind in SEASON_TYPES
        or activity_id in SEASON_IDS
        or any(start <= number < start + 1000 for start in SEASON_FINALES)
    ):
        return "season"
    lowered = name.lower()
    if (
        kind in PASS_TYPES
        or (kind in SHOP_TYPES and any(word in lowered for word in PASS_WORDS))
    ):
        return "pass"
    if kind in SHOP_TYPES:
        return "premium"
    return "event"


@dataclass(frozen=True)
class EventName:
    name: str
    activity_type: int | None
    category: str  # 'major' | 'recurring' | 'season' | 'event' | 'pass' | 'premium'


def _int(value: Any) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def event_names(assets: Mapping[str, bytes], language: str = "English") -> dict[str, EventName]:
    """activity id → the name the game shows, its type, and its category.

    The category is read from the English name whatever `language` is: the
    pass words are English."""
    strings = localisation(assets, language)
    english = strings if language == "English" else localisation(assets, "English")
    table = decode(datatable_bytes(assets, "activity_panel"), "activity_panel")
    names: dict[str, EventName] = {}
    for activity_id, row in table.rows.items():
        key = str(row.get("name", "")).strip()
        name = strings.get(key)
        if activity_id.isdigit() and name and name.strip():
            kind = _int(row.get("type"))
            names[activity_id] = EventName(
                name.strip(), kind, classify(activity_id, kind, english.get(key, name))
            )
    return names
