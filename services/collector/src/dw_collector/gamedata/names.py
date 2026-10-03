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


@dataclass(frozen=True)
class EventName:
    name: str
    activity_type: int | None
    category: str  # 'event' | 'shop'


def _int(value: Any) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def event_names(assets: Mapping[str, bytes], language: str = "English") -> dict[str, EventName]:
    """activity id → the name the game shows, its type, and event-or-shop."""
    strings = localisation(assets, language)
    table = decode(datatable_bytes(assets, "activity_panel"), "activity_panel")
    names: dict[str, EventName] = {}
    for activity_id, row in table.rows.items():
        name = strings.get(str(row.get("name", "")).strip())
        if activity_id.isdigit() and name and name.strip():
            kind = _int(row.get("type"))
            names[activity_id] = EventName(
                name.strip(), kind, "shop" if kind in SHOP_TYPES else "event"
            )
    return names
