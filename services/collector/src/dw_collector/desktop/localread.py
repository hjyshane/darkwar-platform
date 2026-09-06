"""Reading the local journal the app's own collector fills.

WHY THIS IS NOT THE DASHBOARD'S QUERY LAYER. `apps/dashboard` talks to
PostgREST against typed tables and views. Nothing of that exists here: the
journal is a staging format, one JSON blob per row in `normalized_rows`
tagged by `target_table`, waiting to be synced somewhere it never goes in
this app. So every screen the desktop app grows needs its own projection,
and they all start here.

`captured_at` is deliberately taken from `raw_observations` rather than from
inside `row_json`. The observation is what has a time; the normalized row is
a derived thing that may or may not carry one, depending on the parser.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

#: The one target table this module reads so far.
WORLD_CITY = "world_city_snapshots"


@dataclass(frozen=True)
class Tile:
    """One sighting of one base."""

    game_uid: int
    server_id: int
    name: str | None
    x: int
    y: int
    hq_level: int | None
    captured_at: str


_SELECT = """
select n.row_json, r.captured_at
from normalized_rows n
join raw_observations r on r.observation_id = n.observation_id
where n.target_table = ?
"""


def tiles(conn: sqlite3.Connection) -> list[Tile]:
    """Every world-city sighting in the journal, one entry per row written.

    DELIBERATELY NOT FOLDED to one row per player. A caller drawing pins
    wants the newest sighting per base and should say so; a caller measuring
    what ground was covered wants every sighting there is. Folding here
    would quietly deny the second caller its answer.
    """
    found: list[Tile] = []
    for raw, captured_at in conn.execute(_SELECT, (WORLD_CITY,)).fetchall():
        tile = _tile(raw, captured_at)
        if tile is not None:
            found.append(tile)
    return found


def _tile(raw: str, captured_at: str) -> Tile | None:
    """One journal row as a `Tile`, or None when it cannot be read as one.

    THE WHOLE PARSE IS GUARDED, not merely the JSON decode, and the
    difference is not theoretical. A `row_json` that holds valid JSON but
    something other than an object gets past `json.loads` and raises
    `AttributeError` on `.get`; a coordinate stored as a non-numeric string
    gets past the None checks and raises `ValueError` on `int()`. Either
    one, left unguarded, takes every other row in the journal down with it —
    which is precisely what this module exists to promise it will not do.
    """
    try:
        row = json.loads(raw)["row"]
        x, y = row.get("x"), row.get("y")
        uid, server_id = row.get("game_uid"), row.get("server_id")
        if x is None or y is None or uid is None or server_id is None:
            # Dropped rather than coerced: a pin drawn from a null lands at
            # 0,0 and looks like a real answer.
            return None
        return Tile(
            game_uid=int(uid),
            server_id=int(server_id),
            name=row.get("name"),
            x=int(x),
            y=int(y),
            hq_level=row.get("hq_level"),
            captured_at=captured_at,
        )
    except (ValueError, KeyError, TypeError, AttributeError):
        # A journal is written by a parser that changes over time, and by
        # parsers not yet written. One unreadable row must not take out the
        # whole screen.
        return None
