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
    #: COMPARED AND SORTED AS A STRING, which is safe only because there is
    #: exactly one writer: `Journal.record` stores `isoformat()` of a value a
    #: pydantic validator has already forced to tz-aware UTC, so every row is
    #: `...+00:00` and never `...Z`. A second writer emitting a different
    #: shape would break every fold in this module without raising anything.
    captured_at: str


# ORDERED SO THE FOLD IS DETERMINISTIC. Without it, two sightings sharing a
# timestamp come back in whatever order the join plan produces, and
# `newest_per_player` breaks that tie by keeping whichever it saw first —
# which would make the answer depend on a decision SQLite never promised to
# make the same way twice. `n.id` settles the case where even the timestamps
# match.
_SELECT = """
select n.row_json, r.captured_at
from normalized_rows n
join raw_observations r on r.observation_id = n.observation_id
where n.target_table = ?
order by r.captured_at, n.id
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


def newest_per_player(found: list[Tile]) -> list[Tile]:
    """One entry per player per server, at the newest sighting.

    The local equivalent of the `latest_world_cities` view. A sweep writes a
    row per tile per pan and pans overlap, so a single base arrives many
    times; and a base that was destroyed or lost its shield is teleported, so
    the OLDEST sighting is an address the player has left.

    KEYED ON (server_id, game_uid), NOT uid alone. A viewport of one server's
    map contains players from eight servers, and the same uid can appear on
    two of them — folding on uid alone would silently discard one of two real
    players.

    ON AN EXACT TIE the first entry wins, and `_SELECT` orders by
    `(captured_at, n.id)` so "first" is a defined thing rather than whatever
    the join plan felt like. Two sightings sharing a timestamp are the same
    sweep seeing one base twice, so either is correct — but it must be the
    same one every run, or a base appears to jitter between two coordinates.
    """
    newest: dict[tuple[int, int], Tile] = {}
    for tile in found:
        key = (tile.server_id, tile.game_uid)
        seen = newest.get(key)
        if seen is not None and seen.captured_at >= tile.captured_at:
            continue
        newest[key] = tile
    return sorted(newest.values(), key=lambda t: t.captured_at, reverse=True)
