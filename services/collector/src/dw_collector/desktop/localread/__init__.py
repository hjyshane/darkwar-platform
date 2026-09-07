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
- `_shared.py` — the SQL and cache plumbing all three of the above share.
"""

from __future__ import annotations

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
from .tiles import (
    _FOLD_CACHE,
    WORLD_CITY,
    Tile,
    newest_per_player,
    search,
    tiles,
)

__all__ = [
    "PLAYER_DETAIL",
    "PLAYER_SNAPSHOTS",
    "WORLD_CITY",
    # The two fold caches are re-exported for the same reason the flat module
    # exposed `_FOLD_CACHE`: tests reach in to clear or count entries in it
    # directly, to pin cache behaviour the return value of `search` alone
    # cannot distinguish (see test_desktop_localread.py).
    "_FOLD_CACHE",
    "_PLAYER_FOLD_CACHE",
    "PlayerDetail",
    "PlayerProfile",
    "PlayerSnapshot",
    "Tile",
    "merge_player_snapshots",
    "newest_detail_per_player",
    "newest_per_player",
    "player_details",
    "player_snapshots",
    "search",
    "search_players",
    "tiles",
]
