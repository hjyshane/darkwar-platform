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


def event_names(assets: Mapping[str, bytes], language: str = "English") -> dict[str, str]:
    """activity id → the name the game shows, for every event it names."""
    strings = localisation(assets, language)
    table = decode(datatable_bytes(assets, "activity_panel"), "activity_panel")
    names: dict[str, str] = {}
    for activity_id, row in table.rows.items():
        name = strings.get(str(row.get("name", "")).strip())
        if activity_id.isdigit() and name and name.strip():
            names[activity_id] = name.strip()
    return names
