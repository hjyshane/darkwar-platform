"""Alliance roster: `alliance_member_snapshots`, folded to one snapshot.

THE TRAP THIS MODULE EXISTS TO NOT FALL INTO — the same one CLAUDE.md already
records at the cloud layer for `players.current_alliance_id`: "membership is
recorded on joining and never cleared on leaving". `al_rank.py` writes one row
per member, per `al.rank` call — see that module's docstring. A member who
leaves the alliance simply stops appearing in the NEXT call's rows; their
earlier rows are never deleted, so a fold across "every member ever seen,
newest row each" (the `players.py` style, keyed on `game_uid`) would show
every departed member forever. That is exactly the bug `CLAUDE.md` says
"named 94 players for a roster of 84" for `players.current_alliance_id`, and
the exact bug `member_roster`/0102 already fixed at the cloud layer by joining
through `alliance_roster_latest` instead of a per-player last-known column.

THE FIX HERE IS THE SAME SHAPE: a roster is the membership of ONE snapshot,
not a union across many. What ties every member row from a single `al.rank`
call together is `observation_id` — verified against `al_rank.py`, which
stamps every row from one response with the same
`str(observation.observation_id)` (see its `normalize()`) and nothing else
shared across two different calls. Grouping by `observation_id`, then keeping
only the newest such group, means a member who dropped out of the newest
call's response is simply absent from the roster this module reports — the
same way they would be absent from the game's own roster screen.

`PRESENCE_REDACTED` — READ BEFORE SURFACING IT. Per `al_rank.py`'s
`_presence_redacted`: the game hides another alliance's true online/offline
state by reporting every member online with `offLineTime` 0 and `pointId` 0.
`presence_redacted=True` on a snapshot means exactly that pattern was seen —
the roster's online/offline data for THIS capture cannot be trusted, and
`online_state`/`offline_since` are already null on every row of it (see
`_offline_since`). It is a property of the SNAPSHOT (every row in one
`observation_id` group shares the same value, because `al_rank.normalize`
computes it once per response), not of any one member, so this module
surfaces it once, at the roster level, rather than repeating an
uninterpreted boolean on every row.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from ._shared import SELECT_BY_TARGET_TABLE, cached_fold

#: The one target table this module reads.
ALLIANCE_MEMBER_SNAPSHOTS = "alliance_member_snapshots"


@dataclass(frozen=True)
class RosterEntry:
    """One `alliance_member_snapshots` row, as one `al.rank` call reported it.

    UNFOLDED, LIKE `tiles.Tile` and `players.PlayerSnapshot`: this is a single
    member sighting from a single response. `observation_id` is what a
    "snapshot" is grouped by — see the module docstring — and is carried here
    rather than looked up separately so `newest_roster` never has to
    rejoin anything to find it.
    """

    observation_id: str
    server_id: int
    game_uid: int
    name: str | None
    member_rank: int | None
    hq_level: int | None
    power: int | None
    kills: int | None
    #: See the module docstring. Read this before deciding whether to trust
    #: `online_state`/`offline_since` on this same entry.
    presence_redacted: bool
    online_state: str | None
    offline_since: str | None
    month_card_expires_at: str | None
    #: Same string-comparable shape as `Tile.captured_at` — see that
    #: docstring for why sorting/comparing it as a string is safe.
    captured_at: str


def roster_entries(conn: sqlite3.Connection) -> list[RosterEntry]:
    """Every `alliance_member_snapshots` sighting in the journal, one entry per row written.

    DELIBERATELY NOT FOLDED, matching `tiles.tiles` and `players.player_snapshots`:
    a caller assembling the current roster wants `newest_roster`'s fold, but a
    caller counting how many roster calls have fired wants every row.
    """
    found: list[RosterEntry] = []
    for raw, captured_at in conn.execute(
        SELECT_BY_TARGET_TABLE, (ALLIANCE_MEMBER_SNAPSHOTS,)
    ).fetchall():
        entry = _roster_entry(raw, captured_at)
        if entry is not None:
            found.append(entry)
    return found


def _roster_entry(raw: str, captured_at: str) -> RosterEntry | None:
    """One journal row as a `RosterEntry`, or None when it cannot be read as one.

    THE WHOLE PARSE IS GUARDED, not merely the JSON decode — same reasoning as
    `tiles._tile` and `players._player_snapshot`: a `row_json` that decodes
    fine but holds the wrong shape must drop this one row, not the whole read.
    """
    try:
        row = json.loads(raw)["row"]
        uid, server_id = row.get("game_uid"), row.get("server_id")
        observation_id = row.get("observation_id")
        if uid is None or server_id is None or observation_id is None:
            # Dropped rather than coerced: a row with no observation_id could
            # not be grouped into any snapshot, and one filed under uid 0
            # would silently merge with every other row missing its own uid.
            return None
        presence_redacted = row.get("presence_redacted")
        if not isinstance(presence_redacted, bool):
            # al_rank.normalize always writes a real bool here. A row where
            # this is missing or the wrong type is unreadable in the one way
            # that matters most for this module (see the docstring) — drop
            # it rather than guess.
            msg = "presence_redacted must be a bool"
            raise TypeError(msg)
        return RosterEntry(
            observation_id=str(observation_id),
            server_id=int(server_id),
            game_uid=int(uid),
            name=row.get("name"),
            member_rank=_maybe_int(row.get("member_rank")),
            hq_level=_maybe_int(row.get("hq_level")),
            power=_maybe_int(row.get("power")),
            kills=_maybe_int(row.get("kills")),
            presence_redacted=presence_redacted,
            online_state=row.get("online_state"),
            offline_since=row.get("offline_since"),
            month_card_expires_at=row.get("month_card_expires_at"),
            captured_at=captured_at,
        )
    except (ValueError, KeyError, TypeError, AttributeError):
        # A journal is written by a parser that changes over time, and by
        # parsers not yet written. One unreadable row must not take out the
        # whole read.
        return None


def _maybe_int(value: Any) -> int | None:
    """`int(value)`, except a legitimate null stays null instead of raising.

    Same helper as `players._maybe_int` — `value` is typed `Any` because it
    comes straight out of `json.loads`.
    """
    return None if value is None else int(value)


def newest_roster(found: list[RosterEntry]) -> list[RosterEntry]:
    """The alliance roster as of its newest COMPLETE snapshot — see the module docstring.

    GROUPED BY `observation_id`, NOT BY `(server_id, game_uid)`. Grouping by
    the member key (the `players.py`/`tiles.py` style) is exactly the fold
    that would keep every departed member forever; grouping by the shared
    `observation_id` instead means "the roster" is always exactly the set of
    rows one `al.rank` call actually returned, and a member missing from the
    newest call is simply absent — never carried over from an older one.

    TIE-BREAK: `found` arrives ordered by `n.id` ascending (see `_shared.
    SELECT_BY_TARGET_TABLE`). Every row in one snapshot shares one
    `captured_at` (it is joined from `raw_observations`, one row per
    `observation_id`), so snapshots are compared by that string first; ties
    are broken by which snapshot's rows were inserted LAST — i.e. the group
    whose highest-`n.id` row is greatest — which keeps this deterministic
    without a second sort key from any caller, and matches "newest" even when
    two snapshots' `captured_at` values happen to collide.

    Returns the winning snapshot's rows in their original (SQL) order, empty
    when the journal holds no roster rows at all.
    """
    if not found:
        return []
    groups: dict[str, list[RosterEntry]] = {}
    last_index: dict[str, int] = {}
    for index, entry in enumerate(found):
        groups.setdefault(entry.observation_id, []).append(entry)
        last_index[entry.observation_id] = index
    newest_id = max(groups, key=lambda oid: (groups[oid][0].captured_at, last_index[oid]))
    return groups[newest_id]


#: One folded roster per journal file. See `_shared.cached_fold` for the
#: file-keying and outside-the-lock-fold reasoning; it is identical here.
_ROSTER_FOLD_CACHE: dict[str, tuple[tuple[int, int], list[RosterEntry]]] = {}


def roster(conn: sqlite3.Connection) -> list[RosterEntry]:
    """`newest_roster(roster_entries(conn))`, recomputed only when the journal grew.

    THIS IS THE ONE FUNCTION THE ROSTER SCREEN SHOULD CALL. It always answers
    with the newest complete snapshot's membership — never a union across
    every roster call the journal has ever recorded.
    """
    return cached_fold(
        conn,
        _ROSTER_FOLD_CACHE,
        ALLIANCE_MEMBER_SNAPSHOTS,
        lambda: newest_roster(roster_entries(conn)),
    )
