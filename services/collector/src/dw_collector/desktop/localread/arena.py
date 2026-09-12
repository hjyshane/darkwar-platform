"""Arena bracket: `arena_snapshots` + `arena_entries` + `arena_entry_heroes`.

THREE TABLES, NO FOREIGN KEYS. `normalized_rows` has no join columns at all —
every target table is a `row_json` blob keyed only by its own
`idempotency_key` (see `_shared.SELECT_BY_TARGET_TABLE`'s docstring). The
three tables `user.get.arena.info` writes (`dw_collector.normalize.arena`)
are related only through fields INSIDE `row_json`, so the join this module
exists to do happens here, in Python, after each row has already been read
back out as JSON.

THE LINKING FIELDS, VERIFIED AGAINST `normalize.arena`, NOT ASSUMED FROM
NAMES:

- `arena_entries.arena_snapshot_id` == the HEADER row's `snapshot_id`
  (`header_id` in `normalize()` — the header's own deterministic id, built
  from `idempotency_key(observation, f"arena:{header_server}", bucket)`).
  This is the obvious one and it is named for it.

- `arena_entry_heroes.arena_entry_id` == the ENTRY row's OWN `snapshot_id`
  field, NOT a separate id anybody assigns to "which entry this hero
  belongs to". Read `normalize()` and `_lineup_rows()` together: the entry
  row is built with `"snapshot_id": str(stable_uuid(entry_key))`, and
  `_lineup_rows(entry, common, entry_key, ...)` is called with that SAME
  `entry_key` and in turn writes every hero row with
  `"arena_entry_id": str(stable_uuid(entry_key))` — the identical
  expression. So one entry row's `snapshot_id` column doubles as that row's
  own primary key AND as the value every one of its hero rows carries as
  `arena_entry_id`. The `snapshot_id` column name is a schema convention (see
  CLAUDE.md: "every snapshot table carries ... a typed idempotency key")
  that means "this row's own id" on `arena_entries` and `arena_entry_heroes`,
  and means something different — "the header this belongs to" — nowhere;
  the header's OWN id is what `arena_snapshot_id` matches, and the header's
  `snapshot_id` is never repeated on any other table's rows. Nothing below
  this docstring joins on a guessed name; every join key traces back to one
  of the two paragraphs above.

THE LEAGUE DIMENSION. `league` lives only on the header row
(`arena_snapshots.league` — 1 = Gold, cross-server; 2 = Silver, own server;
see `apps/dashboard/src/lib/arenaLeague.ts` for the dashboard's mapping,
not duplicated here beyond the label shown on screen). The same command
answers for both boards on separate calls, so the journal holds two
independent header lineages that must each be folded to their OWN newest
snapshot — folding across leagues the way `roster.newest_roster` folds
across `observation_id` groups would let Gold's newest silently replace
Silver's, or vice versa, depending only on capture order. `arena_boards`
groups headers BY LEAGUE first and picks the newest header within each
group, so Gold and Silver each keep their own newest snapshot no matter
which was captured last.

A HEROLESS ENTRY STILL APPEARS. `arena.py`'s `_lineup_rows` writes zero rows
when `decode_army` finds nothing to decode (a blank or unparseable `army`
blob) — that is a real, expected shape (see `arena.py`'s `_Entry.army`
docstring: "an entry can carry none"), not a parse failure. This module
attaches whatever hero rows exist for an entry and leaves `heroes` empty
otherwise; nothing here drops the entry itself for lack of a lineup. Hiding
a player from the bracket because their lineup did not decode would be
worse than showing them without one.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from ._shared import FOLD_LOCK, SELECT_BY_TARGET_TABLE, freshness_key, journal_file

#: The three target tables this module reads and joins.
ARENA_SNAPSHOTS = "arena_snapshots"
ARENA_ENTRIES = "arena_entries"
ARENA_ENTRY_HEROES = "arena_entry_heroes"


@dataclass(frozen=True)
class ArenaHeaderRow:
    """One `arena_snapshots` row, UNFOLDED — one weekly bracket header for
    one league, as one `user.get.arena.info` call reported it."""

    snapshot_id: str
    server_id: int
    week_start: str
    entry_count: int | None
    #: 1 = Gold (cross-server), 2 = Silver (own server). None for a capture
    #: taken before the field was understood (see `normalize.arena`) — kept
    #: as null rather than guessed into a league it may not be.
    league: int | None
    captured_at: str


@dataclass(frozen=True)
class ArenaHero:
    """One `arena_entry_heroes` row: one hero in one entry's defence lineup.

    `arena_entry_id` is the join key back to `ArenaEntryRow.entry_id` — see
    the module docstring for why that is the entry's OWN `snapshot_id`
    column, not a separate reference.
    """

    arena_entry_id: str
    slot: int | None
    hero_id: int
    troop_class: int | None
    hero_level: int | None
    #: Whether `hero_level` comes from the training centre rather than the
    #: hero's own progress — see `army.py`'s field 2.14 note. Always a real
    #: bool (the normalizer defaults it to False), never null.
    level_synced: bool
    #: One higher than the game's own star count (army.py's 2.8 note) — kept
    #: as observed, same as the dashboard's `arena_entry_heroes.star`.
    star: int | None
    stage: int | None
    hero_power: int | None
    #: Null means the exclusive weapon is not unlocked, a real state.
    weapon_level: int | None
    captured_at: str


@dataclass(frozen=True)
class ArenaEntryRow:
    """One `arena_entries` row, UNFOLDED — one player's placement in one
    snapshot, before its heroes are attached.

    `entry_id` is this row's OWN primary key (the `snapshot_id` column on
    `arena_entries`). `arena_snapshot_id` is the FK to the HEADER row's
    `snapshot_id`. See the module docstring for why these two same-shaped
    ids point at different things.
    """

    entry_id: str
    arena_snapshot_id: str
    server_id: int
    game_uid: int
    name: str | None
    rank: int
    score: int | None
    defense_power: int | None
    alliance_name: str | None
    alliance_code: str | None
    captured_at: str


@dataclass(frozen=True)
class ArenaEntry:
    """One `ArenaEntryRow` with its defence lineup attached.

    `heroes` IS EMPTY, NOT ABSENT, for an entry whose `army` blob never
    decoded — see the module docstring. An empty tuple here means "no
    lineup was captured", never "this entry does not exist".
    """

    entry_id: str
    server_id: int
    game_uid: int
    name: str | None
    rank: int
    score: int | None
    defense_power: int | None
    alliance_name: str | None
    alliance_code: str | None
    heroes: tuple[ArenaHero, ...]
    captured_at: str


@dataclass(frozen=True)
class ArenaBoard:
    """One league's bracket, at its own newest snapshot — the header plus
    every entry whose `arena_snapshot_id` matches it, each with its heroes
    already attached. See the module docstring for why this is folded per
    league rather than once across the whole table."""

    header: ArenaHeaderRow
    entries: tuple[ArenaEntry, ...]


def arena_header_rows(conn: sqlite3.Connection) -> list[ArenaHeaderRow]:
    """Every `arena_snapshots` sighting in the journal, one entry per row written.

    DELIBERATELY NOT FOLDED, matching every other `*_rows`/`*_entries`
    function in this package — see `arena_boards` for the per-league fold.
    """
    found: list[ArenaHeaderRow] = []
    for raw, captured_at in conn.execute(SELECT_BY_TARGET_TABLE, (ARENA_SNAPSHOTS,)).fetchall():
        header = _arena_header(raw, captured_at)
        if header is not None:
            found.append(header)
    return found


def arena_entry_rows(conn: sqlite3.Connection) -> list[ArenaEntryRow]:
    """Every `arena_entries` sighting in the journal, one entry per row written,
    heroes NOT yet attached — see `arena_boards`."""
    found: list[ArenaEntryRow] = []
    for raw, captured_at in conn.execute(SELECT_BY_TARGET_TABLE, (ARENA_ENTRIES,)).fetchall():
        entry = _arena_entry_row(raw, captured_at)
        if entry is not None:
            found.append(entry)
    return found


def arena_hero_rows(conn: sqlite3.Connection) -> list[ArenaHero]:
    """Every `arena_entry_heroes` sighting in the journal, one entry per row written."""
    found: list[ArenaHero] = []
    for raw, captured_at in conn.execute(SELECT_BY_TARGET_TABLE, (ARENA_ENTRY_HEROES,)).fetchall():
        hero = _arena_hero(raw, captured_at)
        if hero is not None:
            found.append(hero)
    return found


def _arena_header(raw: str, captured_at: str) -> ArenaHeaderRow | None:
    """One journal row as an `ArenaHeaderRow`, or None when it cannot be read as one.

    THE WHOLE PARSE IS GUARDED, not merely the JSON decode — same reasoning
    as every other `_*` row parser in this package (see `roster._roster_entry`).
    """
    try:
        row = json.loads(raw)["row"]
        snapshot_id, server_id = row.get("snapshot_id"), row.get("server_id")
        week_start = row.get("week_start")
        if snapshot_id is None or server_id is None or week_start is None:
            # Dropped rather than coerced: a header with no id could not be
            # matched by any entry, and one filed under a guessed server
            # would silently misattribute the whole board.
            return None
        return ArenaHeaderRow(
            snapshot_id=str(snapshot_id),
            server_id=int(server_id),
            week_start=str(week_start),
            entry_count=_maybe_int(row.get("entry_count")),
            league=_maybe_int(row.get("league")),
            captured_at=captured_at,
        )
    except (ValueError, KeyError, TypeError, AttributeError):
        # A journal is written by a parser that changes over time, and by
        # parsers not yet written. One unreadable row must not take out the
        # whole read.
        return None


def _arena_entry_row(raw: str, captured_at: str) -> ArenaEntryRow | None:
    """One journal row as an `ArenaEntryRow`, or None when it cannot be read as one."""
    try:
        row = json.loads(raw)["row"]
        entry_id = row.get("snapshot_id")
        arena_snapshot_id = row.get("arena_snapshot_id")
        server_id, uid, rank = row.get("server_id"), row.get("game_uid"), row.get("rank")
        if entry_id is None or arena_snapshot_id is None:
            # Cannot be matched to its header, nor be a target for a hero
            # row's own `arena_entry_id` — dropped rather than guessed.
            return None
        if server_id is None or uid is None or rank is None:
            return None
        return ArenaEntryRow(
            entry_id=str(entry_id),
            arena_snapshot_id=str(arena_snapshot_id),
            server_id=int(server_id),
            game_uid=int(uid),
            name=row.get("name"),
            rank=int(rank),
            score=_maybe_int(row.get("score")),
            defense_power=_maybe_int(row.get("defense_power")),
            alliance_name=row.get("alliance_name"),
            alliance_code=row.get("alliance_code"),
            captured_at=captured_at,
        )
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def _arena_hero(raw: str, captured_at: str) -> ArenaHero | None:
    """One journal row as an `ArenaHero`, or None when it cannot be read as one."""
    try:
        row = json.loads(raw)["row"]
        arena_entry_id = row.get("arena_entry_id")
        hero_id = row.get("hero_id")
        if arena_entry_id is None or hero_id is None:
            # Cannot be attached to any entry, or is not really a hero row —
            # dropped rather than guessed under uid 0 / entry "".
            return None
        level_synced = row.get("level_synced")
        if not isinstance(level_synced, bool):
            # `normalize.arena` always writes a real bool here (defaults to
            # False rather than omitting it) — a row where this is missing
            # or the wrong type is unreadable in a way that matters, same
            # reasoning as `roster._roster_entry`'s `presence_redacted` guard.
            msg = "level_synced must be a bool"
            raise TypeError(msg)
        return ArenaHero(
            arena_entry_id=str(arena_entry_id),
            slot=_maybe_int(row.get("slot")),
            hero_id=int(hero_id),
            troop_class=_maybe_int(row.get("troop_class")),
            hero_level=_maybe_int(row.get("hero_level")),
            level_synced=level_synced,
            star=_maybe_int(row.get("star")),
            stage=_maybe_int(row.get("stage")),
            hero_power=_maybe_int(row.get("hero_power")),
            weapon_level=_maybe_int(row.get("weapon_level")),
            captured_at=captured_at,
        )
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def _maybe_int(value: Any) -> int | None:
    """`int(value)`, except a legitimate null stays null instead of raising.

    Same helper as `roster._maybe_int`/`players._maybe_int` — `value` is
    typed `Any` because it comes straight out of `json.loads`.
    """
    return None if value is None else int(value)


def _league_sort_key(league: int | None) -> tuple[int, int]:
    """Known leagues first, by value; an unknown/null league last.

    Matches `arenaLeague.ts`'s `compareLeagues` reasoning (a two-part key, so
    a null league cannot overflow past a sentinel and land in the wrong
    place) without needing that file's full league table — this module only
    orders boards for display, it does not name them.
    """
    return (1, 0) if league is None else (0, league)


def newest_header_per_league(
    headers: list[ArenaHeaderRow],
) -> dict[int | None, ArenaHeaderRow]:
    """The newest header row for each distinct `league` value.

    GROUPED BY LEAGUE, NOT FOLDED ACROSS THE WHOLE TABLE — see the module
    docstring: Gold and Silver are two independent lineups of header rows,
    and the newest Gold snapshot is not the newest Silver one. Each header
    row already stands for exactly one snapshot (unlike roster's per-member
    rows), so there is no group-of-rows to compare here — only "the newest
    row for this league wins".

    TIE-BREAK: `headers` arrives ordered by `n.id` ascending (see
    `_shared.SELECT_BY_TARGET_TABLE`). Rows are compared by `captured_at`
    first, then by that ascending position — the same two-key order
    `roster.newest_roster` uses — so two headers sharing a `captured_at`
    still resolve deterministically to whichever was inserted last.
    """
    winners: dict[int | None, tuple[int, ArenaHeaderRow]] = {}
    for index, header in enumerate(headers):
        current = winners.get(header.league)
        if current is None or (header.captured_at, index) > (
            current[1].captured_at,
            current[0],
        ):
            winners[header.league] = (index, header)
    return {league: header for league, (index, header) in winners.items()}


def arena_boards(
    headers: list[ArenaHeaderRow],
    entries: list[ArenaEntryRow],
    heroes: list[ArenaHero],
) -> list[ArenaBoard]:
    """Every league's bracket, each at its own newest snapshot, entries and
    heroes joined in.

    THE JOIN, SPELLED OUT: `entries` are grouped by `arena_snapshot_id` and
    matched against each winning header's `snapshot_id`; `heroes` are
    grouped by `arena_entry_id` and matched against each entry's own
    `entry_id`. An entry with no matching heroes group still becomes an
    `ArenaEntry` with `heroes=()` — see the module docstring on why a
    heroless entry must still appear.

    Boards are returned known leagues first (by value), then any league not
    yet named — see `_league_sort_key`.
    """
    winners = newest_header_per_league(headers)

    heroes_by_entry: dict[str, list[ArenaHero]] = {}
    for hero in heroes:
        heroes_by_entry.setdefault(hero.arena_entry_id, []).append(hero)

    entries_by_snapshot: dict[str, list[ArenaEntryRow]] = {}
    for entry in entries:
        entries_by_snapshot.setdefault(entry.arena_snapshot_id, []).append(entry)

    boards: list[ArenaBoard] = []
    for league in sorted(winners, key=_league_sort_key):
        header = winners[league]
        built_entries = tuple(
            ArenaEntry(
                entry_id=row.entry_id,
                server_id=row.server_id,
                game_uid=row.game_uid,
                name=row.name,
                rank=row.rank,
                score=row.score,
                defense_power=row.defense_power,
                alliance_name=row.alliance_name,
                alliance_code=row.alliance_code,
                heroes=tuple(heroes_by_entry.get(row.entry_id, [])),
                captured_at=row.captured_at,
            )
            for row in entries_by_snapshot.get(header.snapshot_id, [])
        )
        boards.append(ArenaBoard(header=header, entries=built_entries))
    return boards


#: One folded set of boards per journal file. UNLIKE `_shared.cached_fold`,
#: this cannot use that helper directly: freshness here depends on THREE
#: target tables, not one, so the cache key is a tuple of all three tables'
#: `_shared.freshness_key` results rather than a single one. The file-keying,
#: lock, and "fold outside the lock" reasoning are otherwise identical — see
#: `_shared.cached_fold`'s own docstring.
_ArenaFreshness = tuple[tuple[int, int], tuple[int, int], tuple[int, int]]
_ARENA_FOLD_CACHE: dict[str, tuple[_ArenaFreshness, list[ArenaBoard]]] = {}


def _fold_arena(conn: sqlite3.Connection) -> list[ArenaBoard]:
    return arena_boards(
        arena_header_rows(conn),
        arena_entry_rows(conn),
        arena_hero_rows(conn),
    )


def arena(conn: sqlite3.Connection) -> list[ArenaBoard]:
    """`arena_boards(...)` over the journal's current rows, recomputed only
    when any of the three target tables has grown. THIS IS THE ONE FUNCTION
    THE ARENA SCREEN SHOULD CALL.
    """
    path = journal_file(conn)
    if not path:
        # See `_shared.cached_fold`: an in-memory database reports an empty
        # file path, and every `:memory:` connection would collide on it.
        return _fold_arena(conn)

    key: _ArenaFreshness = (
        freshness_key(conn, ARENA_SNAPSHOTS),
        freshness_key(conn, ARENA_ENTRIES),
        freshness_key(conn, ARENA_ENTRY_HEROES),
    )
    with FOLD_LOCK:
        cached = _ARENA_FOLD_CACHE.get(path)
        if cached is not None and cached[0] == key:
            return cached[1]

    # FOLDED OUTSIDE THE LOCK — see `_shared.cached_fold`'s own reasoning.
    folded = _fold_arena(conn)
    with FOLD_LOCK:
        _ARENA_FOLD_CACHE[path] = (key, folded)
    return folded
