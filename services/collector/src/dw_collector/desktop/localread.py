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
import threading
from dataclasses import dataclass

from dw_collector.console.find import matches

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


# ORDERED SO THE FOLD IS DETERMINISTIC — by `n.id` ALONE, not by
# `r.captured_at`. `id` is autoincrement, so it is already a total,
# monotonic, insertion order: sorting by it settles every tie
# `newest_per_player` can face, including two sightings sharing a
# `captured_at`, without needing a second sort key. Ordering on a column from
# the *joined* table (`r.captured_at`) would force SQLite into a TEMP B-TREE
# sort on the whole result; ordering on `n.id`, which leads the
# `normalized_rows_target_table_idx (target_table, id)` index, lets the index
# itself hand rows back in this order — measured on a 300k-row benchmark
# journal, this removed the `USE TEMP B-TREE FOR ORDER BY` step from `EXPLAIN
# QUERY PLAN` entirely. This is NOT "sorted by capture time" — a caller that
# wants chronological order must sort the result itself.
_SELECT = """
select n.row_json, r.captured_at
from normalized_rows n
join raw_observations r on r.observation_id = n.observation_id
where n.target_table = ?
order by n.id
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

    ON AN EXACT TIE the first entry wins, and `_SELECT` orders by `n.id`
    alone (insertion order) so "first" is a defined thing rather than
    whatever the join plan felt like. Among rows sharing a `captured_at`,
    ordering by `n.id` still puts them in ascending-`id` relative order —
    the same tie-break `(captured_at, n.id)` used to give explicitly — so the
    winner of a tie is unchanged from before; only the ordering of
    *non-tied* rows (which never mattered for this fold) is different now.
    Two sightings sharing a timestamp are the same sweep seeing one base
    twice, so either is correct — but it must be the same one every run, or
    a base appears to jitter between two coordinates.
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
#: from.
#:
#: KEYED ON THE FILE, NOT THE CONNECTION, and that is the whole point. The
#: sidecar opens a fresh connection for every request and closes it again —
#: which is deliberate, because it is how the collector's newest writes get
#: seen and how a lock stays short (Task 8) — so a cache keyed on the
#: connection object would miss every single time while still growing a
#: dictionary entry per request that nothing ever removes: a guaranteed cache
#: miss on every real search, and an unbounded leak of dead connections and
#: their folded lists, in the same dict. Keying on the file the connection is
#: attached to survives exactly the churn that broke the old key.
_FOLD_CACHE: dict[str, tuple[tuple[int, int], list[Tile]]] = {}

#: `ThreadingHTTPServer` (`sidecar.py`) means two searches can land at once.
#: The dict itself is not the risk — CPython's GIL makes single dict
#: operations atomic — but the read-compare-fold-store sequence below is not
#: a single operation, and without a lock two requests racing a cold cache
#: could both decide to fold and then stomp each other's store.
_FOLD_LOCK = threading.Lock()


def _journal_file(conn: sqlite3.Connection) -> str:
    """The path this connection is reading, as SQLite itself reports it.

    Asking the connection rather than taking a path argument keeps `search`'s
    signature honest: it reads whatever it was handed, and the cache key
    follows from that rather than from something a caller could get wrong by
    passing a different path than the one the connection actually opened.
    """
    for _, name, file in conn.execute("pragma database_list").fetchall():
        if name == "main":
            return str(file)
    return ""


def _freshness_key(conn: sqlite3.Connection) -> tuple[int, int]:
    """Cheap stand-in for "has anything changed since the last fold".

    `(max(id), count(*))` over the `world_city_snapshots` rows is a
    COVERING INDEX read against `normalized_rows_target_table_idx
    (target_table, id)` — measured at ~25ms against a 300k-row benchmark
    journal, two orders of magnitude under the ~4s full fold it guards, so
    running it on every keystroke is cheap. A new sighting always bumps at
    least one of `max(id)` or `count(*)`; nothing in this codebase deletes or
    rewrites a `normalized_rows` row in place, so this pair cannot go stale
    while looking unchanged — there is no writer this cache would miss.
    """
    row = conn.execute(
        "select coalesce(max(id), 0), count(*) from normalized_rows where target_table = ?",
        (WORLD_CITY,),
    ).fetchone()
    return (int(row[0]), int(row[1]))


def _folded(conn: sqlite3.Connection) -> list[Tile]:
    """`newest_per_player(tiles(conn))`, recomputed only when the journal grew.

    A DESKTOP SEARCH BOX, NOT A REPORT: `search` exists to sit behind a
    keystroke (Task 8), and the journal between two keystrokes is overwhelmingly
    likely to be exactly what it was a moment ago. Folding is the expensive
    step (a full scan-and-parse of every sighting), so it is the step this
    caches — `tiles`/`newest_per_player` themselves stay uncached and are
    still called fresh by anyone using them directly.
    """
    path = _journal_file(conn)
    if not path:
        # AN IN-MEMORY DATABASE REPORTS AN EMPTY FILE PATH. Every `:memory:`
        # connection would then collide on the same `""` key and serve each
        # other's folded list — a test database answering with another
        # test's rows. Skip the cache entirely rather than risk that; the
        # desktop app this cache exists for always reads a real file on disk.
        return newest_per_player(tiles(conn))

    key = _freshness_key(conn)
    with _FOLD_LOCK:
        cached = _FOLD_CACHE.get(path)
        if cached is not None and cached[0] == key:
            return cached[1]

    # FOLDED OUTSIDE THE LOCK. The fold is seconds long on a cold cache, and
    # holding the lock across it would serialise every concurrent search
    # behind whichever request got there first. Two requests racing a cold
    # cache can both decide to fold — that duplicates the work, it does not
    # produce a wrong answer, since both are folding the same journal.
    folded = newest_per_player(tiles(conn))
    with _FOLD_LOCK:
        _FOLD_CACHE[path] = (key, folded)
    return folded


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
