"""Reading the local journal the app's own collector fills.

Split into a package (Task 2 of the calculator plan) once a second
projection — player profiles — needed real explanation of its own merge
rule; a single `localread.py` was heading well past readable. This
`__init__` re-exports everything a caller (or a test reaching into a private
cache) previously imported from the flat module, so
`from dw_collector.desktop import localread` and `localread.search(...)`,
`localread.tiles(...)`, `localread._FOLD_CACHE`, etc. all still work exactly
as before.

- `tiles.py` — the original world-city projection.
- `players.py` — `player_snapshots`, folded across three normalizers with
  incompatible null fields. Start there for the merge-rule reasoning.
- `player_detail.py` — the single-writer `player_detail_snapshots` power
  breakdown, kept separate from `players.py` on purpose (see its docstring).
- `roster.py` — `alliance_member_snapshots`, folded to the newest COMPLETE
  snapshot (grouped by `observation_id`, not by member) so a departed member
  is absent rather than carried over forever. Start there for why this fold
  is shaped differently from every other projection in this package.
- `arena.py` — `arena_snapshots` + `arena_entries` + `arena_entry_heroes`,
  joined in Python because `normalized_rows` has no foreign keys, folded to
  the newest snapshot PER LEAGUE (Gold and Silver are independent boards).
  Start there for exactly which fields link the three tables — they are not
  named consistently across them.
- `_shared.py` — the SQL and cache plumbing all of the above share.
"""

from __future__ import annotations

from .arena import (
    _ARENA_FOLD_CACHE,
    ARENA_ENTRIES,
    ARENA_ENTRY_HEROES,
    ARENA_SNAPSHOTS,
    ArenaBoard,
    ArenaEntry,
    ArenaEntryRow,
    ArenaHeaderRow,
    ArenaHero,
    arena,
    arena_boards,
    arena_entry_rows,
    arena_header_rows,
    arena_hero_rows,
    newest_header_per_league,
)
from .player_detail import (
    PLAYER_DETAIL,
    PlayerDetail,
    newest_detail_per_player,
    player_details,
)
from .players import (
    _PLAYER_FOLD_CACHE,
    PLAYER_SNAPSHOTS,
    PlayerProfile,
    PlayerSnapshot,
    merge_player_snapshots,
    player_snapshots,
    search_players,
)
from .roster import (
    _ROSTER_FOLD_CACHE,
    ALLIANCE_MEMBER_SNAPSHOTS,
    RosterEntry,
    newest_roster,
    roster,
    roster_entries,
)
from .tiles import (
    _FOLD_CACHE,
    WORLD_CITY,
    Tile,
    newest_per_player,
    search,
    tiles,
)

__all__ = [
    "ALLIANCE_MEMBER_SNAPSHOTS",
    "ARENA_ENTRIES",
    "ARENA_ENTRY_HEROES",
    "ARENA_SNAPSHOTS",
    "PLAYER_DETAIL",
    "PLAYER_SNAPSHOTS",
    "WORLD_CITY",
    # The fold caches are re-exported for the same reason the flat module
    # exposed `_FOLD_CACHE`: tests reach in to clear or count entries in them
    # directly, to pin cache behaviour the return value of `search` alone
    # cannot distinguish (see test_desktop_localread.py).
    "_ARENA_FOLD_CACHE",
    "_FOLD_CACHE",
    "_PLAYER_FOLD_CACHE",
    "_ROSTER_FOLD_CACHE",
    "ArenaBoard",
    "ArenaEntry",
    "ArenaEntryRow",
    "ArenaHeaderRow",
    "ArenaHero",
    "PlayerDetail",
    "PlayerProfile",
    "PlayerSnapshot",
    "RosterEntry",
    "Tile",
    "arena",
    "arena_boards",
    "arena_entry_rows",
    "arena_header_rows",
    "arena_hero_rows",
    "merge_player_snapshots",
    "newest_detail_per_player",
    "newest_header_per_league",
    "newest_per_player",
    "newest_roster",
    "player_details",
    "player_snapshots",
    "roster",
    "roster_entries",
    "search",
    "search_players",
    "tiles",
]
