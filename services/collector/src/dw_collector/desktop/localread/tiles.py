"""World-city tiles: the original `localread` projection (Task 3b).

WHY THIS IS NOT THE DASHBOARD'S QUERY LAYER. `apps/dashboard` talks to
PostgREST against typed tables and views. Nothing of that exists here: the
journal is a staging format, one JSON blob per row in `normalized_rows`
tagged by `target_table`, waiting to be synced somewhere it never goes in
this app. So every screen the desktop app grows needs its own projection.

`captured_at` is deliberately taken from `raw_observations` rather than from
inside `row_json`. The observation is what has a time; the normalized row is
a derived thing that may or may not carry one, depending on the parser.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

from dw_collector.console.find import matches

from ._shared import SELECT_BY_TARGET_TABLE, cached_fold

#: The one target table this module reads.
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


def tiles(conn: sqlite3.Connection) -> list[Tile]:
    """Every world-city sighting in the journal, one entry per row written.

    DELIBERATELY NOT FOLDED to one row per player. A caller drawing pins
    wants the newest sighting per base and should say so; a caller measuring
    what ground was covered wants every sighting there is. Folding here
    would quietly deny the second caller its answer.
    """
    found: list[Tile] = []
    for raw, captured_at in conn.execute(SELECT_BY_TARGET_TABLE, (WORLD_CITY,)).fetchall():
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

    ON AN EXACT TIE the first entry wins, and the shared SELECT orders by
    `n.id` alone (insertion order) so "first" is a defined thing rather than
    whatever the join plan felt like. Among rows sharing a `captured_at`,
    ordering by `n.id` still puts them in ascending-`id` relative order — the
    same tie-break `(captured_at, n.id)` used to give explicitly — so the
    winner of a tie is unchanged from before; only the ordering of *non-tied*
    rows (which never mattered for this fold) is different now. Two
    sightings sharing a timestamp are the same sweep seeing one base twice,
    so either is correct — but it must be the same one every run, or a base
    appears to jitter between two coordinates.
    """
    newest: dict[tuple[int, int], Tile] = {}
    for tile in found:
        key = (tile.server_id, tile.game_uid)
        seen = newest.get(key)
        if seen is not None and seen.captured_at >= tile.captured_at:
            continue
        newest[key] = tile
    return sorted(newest.values(), key=lambda t: t.captured_at, reverse=True)


#: One folded snapshot per journal file, and the freshness key it was built
#: from. See `_shared.cached_fold` for why it is keyed on the file rather
#: than the connection, and why the fold that fills it runs outside the lock.
_FOLD_CACHE: dict[str, tuple[tuple[int, int], list[Tile]]] = {}


def _folded(conn: sqlite3.Connection) -> list[Tile]:
    """`newest_per_player(tiles(conn))`, recomputed only when the journal grew."""
    return cached_fold(conn, _FOLD_CACHE, WORLD_CITY, lambda: newest_per_player(tiles(conn)))


def search(conn: sqlite3.Connection, needle: str, *, limit: int = 25) -> list[Tile]:
    """Players matching `needle`, newest sighting first.

    THE ORDER OF OPERATIONS IS THE POINT, and this repo has already paid for
    getting it wrong one layer up: a row-per-detail query behind a limit
    showed 67 of 84 members and looked complete. Folding happens before the
    limit, because limiting first lets one heavily-swept base spend the whole
    budget and the players behind it do not arrive stale — they do not
    arrive, and nothing on screen says so.

    Matching is `console.find.matches` rather than a second copy of the rule,
    so the app and the console cannot disagree about whether six digits of a
    uid are a match. They are not: the last six are the server, so a
    substring match on them returns everybody on that server.
    """
    if limit <= 0:
        # A negative limit slices from the end and returns "all but the last
        # few" — a plausible-looking answer to a question nobody asked. Zero
        # and below mean "no room for results", which is an empty list.
        return []
    return [tile for tile in _folded(conn) if matches(needle, tile.name, tile.game_uid)][:limit]
