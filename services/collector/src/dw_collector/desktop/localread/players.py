"""Player profiles: `player_snapshots`, folded across THREE different writers.

THE TRAP THIS MODULE EXISTS TO NOT FALL INTO. The task that specified this
module said four normalizers write `player_snapshots` with incompatible
nulls; reading the actual source (not the summary) turned up three that
write this table, plus a fourth (`get_new_user_info.py`) that writes a
DIFFERENT table entirely — see below. The trap is the same either way: three
writers of one table, each leaving different columns null, is already enough
for a whole-row fold to erase real data.

Three normalizers write `player_snapshots` today (verified against source,
not assumed):

- `kill_rank.py` (`kill.rank`): `name`, `kills`, `rank` (a real cross-server
  kill-ranking position). `alliance_external_id`, `hq_level` and `power` are
  ALWAYS None — the response this parser reads never carries them, not
  because a player lost them.
- `server_rank.py` (`server.rank`): `name`, `hq_level`, `power`, `rank` (a
  real cross-server power-ranking position). `alliance_external_id` and
  `kills` are ALWAYS None, for the same reason — structurally absent from
  this response, not observed-and-empty.
- `get_user_info_multi.py` (`get.user.info.multi`): `name`,
  `alliance_external_id`, `hq_level`, `power`, `kills`. `rank` is ALWAYS
  None here — deliberately unmapped, because the field reads 0 in every
  captured response (see that module's docstring): not a real rank of zero,
  not "no rank", just a field this command never actually answers.

(`get_new_user_info.py`, `get.new.user.info`, writes `player_detail_snapshots`
and `player_component_power_snapshots` instead — see `player_detail.py` — so
it contributes no `player_snapshots` row and is not part of this fold.)

A NAIVE "NEWEST ROW WINS, WHOLE" FOLD — the fold `tiles.newest_per_player`
uses — WOULD BE WRONG HERE, and not in a theoretical way: a player last seen
through `kill.rank` would show null `power` and null `hq_level`, having had
both a minute earlier from `server.rank`. Tiles can get away with whole-row
replacement because one base has one writer's shape; a player here can be
described by three different shapes in the same minute, each shape silent
about what the others said.

THE MERGE RULE: newest NON-NULL value wins, per field, independently. A
player's `power` is whatever the most recent row that actually reported a
power said, even if a more recent row (from a command that never reports
power) arrived after it and would otherwise have looked "newer".

THE HONEST LIMITATION THIS RULE ACCEPTS: it cannot tell "this command never
supplies alliance" apart from "this player really has no alliance right now
because they left it". A structural null (kill.rank's `alliance_external_id`)
and a real null (get.user.info.multi reporting no alliance because the
player left one) look identical once they've reached this module — both are
`None` on a `player_snapshots` row. Newest-non-null-wins means an
alliance-left signal from a fresh `get.user.info.multi` row would be
SKIPPED, and the profile would keep showing the last alliance we actually
saw them in, stale, until some other positive fact overwrites it — there is
no way from this data alone to write "confirmed no alliance" as opposed to
"unknown". A newest-ROW-wins fold does not fix this either: it would
correctly clear the alliance on a `get.user.info.multi` row that reports
none, but would ALSO incorrectly clear it (along with power and hq_level)
on the very next `kill.rank` row, which is strictly worse. Given a choice
between two failure modes, this module accepts the quieter one.

This is not a new tradeoff invented for this module — it is the existing
house rule, made explicit. `players.current_alliance_id` in the cloud schema
(see repo `CLAUDE.md`, "Membership comes from alliance_roster_latest, never
from players.current_alliance_id") is written the same way: a LAST KNOWN
value that nothing ever clears, specifically because clearing on an
ambiguous absence has already been shown to erase real membership. Newest-
non-null-per-field is that same "last known, never quietly cleared" idea
applied one level down, to a single row instead of a whole roster.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from dw_collector.console.find import matches

from ._shared import SELECT_BY_TARGET_TABLE, cached_fold

#: The one target table this module reads. All three contributing
#: normalizers write to the same table — the merge trap is about which
#: FIELDS a row carries, not which table it lands in.
PLAYER_SNAPSHOTS = "player_snapshots"


@dataclass(frozen=True)
class PlayerSnapshot:
    """One `player_snapshots` row, as one command reported it.

    UNFOLDED, LIKE `tiles.Tile`: this is a single sighting from a single
    command, and most of its fields are legitimately null depending on which
    command produced it (see the module docstring). Do not treat a
    `PlayerSnapshot` as "the" profile — that is what `PlayerProfile` is for.
    """

    game_uid: int
    server_id: int
    name: str | None
    alliance_external_id: str | None
    hq_level: int | None
    power: int | None
    kills: int | None
    rank: int | None
    #: Same string-comparable shape as `Tile.captured_at` — see that
    #: docstring for why sorting it as a string is safe.
    captured_at: str


@dataclass(frozen=True)
class PlayerProfile:
    """One player, folded from every `player_snapshots` sighting of them.

    Each field is the newest NON-NULL value any contributing command
    reported for it, independently of the others — see the module docstring
    for why, and for the limitation this accepts. `captured_at` is the
    newest of ANY contributing sighting, whether or not that particular
    sighting updated any field shown here: it answers "when did we last see
    this player at all", not "when was this exact combination of fields
    true together" — no such single moment necessarily exists once fields
    are sourced from different commands.
    """

    game_uid: int
    server_id: int
    name: str | None
    alliance_external_id: str | None
    hq_level: int | None
    power: int | None
    kills: int | None
    rank: int | None
    captured_at: str


def player_snapshots(conn: sqlite3.Connection) -> list[PlayerSnapshot]:
    """Every `player_snapshots` sighting in the journal, one entry per row written.

    DELIBERATELY NOT FOLDED, matching `tiles.tiles`: a caller assembling
    profiles wants the merge in `merge_player_snapshots`, but a caller
    counting how many times a roster command has fired wants every row.
    """
    found: list[PlayerSnapshot] = []
    for raw, captured_at in conn.execute(SELECT_BY_TARGET_TABLE, (PLAYER_SNAPSHOTS,)).fetchall():
        snapshot = _player_snapshot(raw, captured_at)
        if snapshot is not None:
            found.append(snapshot)
    return found


def _player_snapshot(raw: str, captured_at: str) -> PlayerSnapshot | None:
    """One journal row as a `PlayerSnapshot`, or None when it cannot be read as one.

    THE WHOLE PARSE IS GUARDED, not merely the JSON decode — same reasoning
    as `tiles._tile`. A `row_json` that holds valid JSON but something other
    than an object gets past `json.loads` and raises `AttributeError` on
    `.get`; a value stored as a non-numeric string gets past the None checks
    and raises `ValueError` on `int()`. Either one must drop this one row,
    not the whole read.
    """
    try:
        row = json.loads(raw)["row"]
        uid, server_id = row.get("game_uid"), row.get("server_id")
        if uid is None or server_id is None:
            # Dropped rather than coerced: a profile filed under uid 0 would
            # silently merge with every other row missing its own uid.
            return None
        return PlayerSnapshot(
            game_uid=int(uid),
            server_id=int(server_id),
            name=row.get("name"),
            alliance_external_id=row.get("alliance_external_id"),
            hq_level=_maybe_int(row.get("hq_level")),
            power=_maybe_int(row.get("power")),
            kills=_maybe_int(row.get("kills")),
            rank=_maybe_int(row.get("rank")),
            captured_at=captured_at,
        )
    except (ValueError, KeyError, TypeError, AttributeError):
        # A journal is written by a parser that changes over time, and by
        # parsers not yet written. One unreadable row must not take out the
        # whole read.
        return None


def _maybe_int(value: Any) -> int | None:
    """`int(value)`, except a legitimate null stays null instead of raising.

    `None` is the ordinary "this command doesn't report this field" case and
    must not be treated as malformed. Anything else that cannot become an
    `int` (a list, a non-numeric string) IS malformed, and is left to raise
    into `_player_snapshot`'s guard, which drops the whole row. `value` is
    typed `Any` because it comes straight out of `json.loads`, same as every
    `row.get(...)` call in `tiles._tile`.
    """
    return None if value is None else int(value)


class _FieldTimeline[V]:
    """The newest non-null value offered so far, for one field.

    ON AN EXACT TIE the first offer wins, matching `tiles.newest_per_player`:
    only a STRICTLY greater `captured_at` replaces the current value, so
    callers that offer values in the shared SELECT's ascending-`n.id` order
    get the same "first entry wins a tie" behaviour tiles already documents.
    """

    def __init__(self) -> None:
        self._value: V | None = None
        self._at: str = ""

    def offer(self, value: V | None, captured_at: str) -> None:
        if value is None:
            # A structural null (this command never reports the field) and a
            # real one (the fact really is absent right now) are
            # indistinguishable here — see the module docstring. Either way,
            # nothing is learned, so nothing is overwritten.
            return
        if captured_at > self._at:
            self._value = value
            self._at = captured_at

    @property
    def value(self) -> V | None:
        return self._value


class _ProfileBuilder:
    """Mutable accumulator for one (server_id, game_uid) while folding.

    Not exported: `PlayerProfile` is the only shape callers should hold once
    the fold is done, so this stays private to `merge_player_snapshots`.
    """

    def __init__(self, server_id: int, game_uid: int) -> None:
        self.server_id = server_id
        self.game_uid = game_uid
        self.name: _FieldTimeline[str] = _FieldTimeline()
        self.alliance_external_id: _FieldTimeline[str] = _FieldTimeline()
        self.hq_level: _FieldTimeline[int] = _FieldTimeline()
        self.power: _FieldTimeline[int] = _FieldTimeline()
        self.kills: _FieldTimeline[int] = _FieldTimeline()
        self.rank: _FieldTimeline[int] = _FieldTimeline()
        #: Newest sighting overall, regardless of which fields it updated —
        #: see `PlayerProfile.captured_at`.
        self.captured_at = ""

    def absorb(self, snapshot: PlayerSnapshot) -> None:
        if snapshot.captured_at > self.captured_at:
            self.captured_at = snapshot.captured_at
        self.name.offer(snapshot.name, snapshot.captured_at)
        self.alliance_external_id.offer(snapshot.alliance_external_id, snapshot.captured_at)
        self.hq_level.offer(snapshot.hq_level, snapshot.captured_at)
        self.power.offer(snapshot.power, snapshot.captured_at)
        self.kills.offer(snapshot.kills, snapshot.captured_at)
        self.rank.offer(snapshot.rank, snapshot.captured_at)

    def build(self) -> PlayerProfile:
        return PlayerProfile(
            game_uid=self.game_uid,
            server_id=self.server_id,
            name=self.name.value,
            alliance_external_id=self.alliance_external_id.value,
            hq_level=self.hq_level.value,
            power=self.power.value,
            kills=self.kills.value,
            rank=self.rank.value,
            captured_at=self.captured_at,
        )


def merge_player_snapshots(found: list[PlayerSnapshot]) -> list[PlayerProfile]:
    """One `PlayerProfile` per player, folded per field — see the module docstring.

    KEYED ON (server_id, game_uid), NOT uid alone, matching
    `tiles.newest_per_player`: the same uid can be a real, distinct player on
    two different servers.

    RETURNS NEWEST FIRST, by the merged `captured_at`, matching
    `tiles.newest_per_player`'s documented order.
    """
    builders: dict[tuple[int, int], _ProfileBuilder] = {}
    for snapshot in found:
        key = (snapshot.server_id, snapshot.game_uid)
        builder = builders.get(key)
        if builder is None:
            builder = _ProfileBuilder(snapshot.server_id, snapshot.game_uid)
            builders[key] = builder
        builder.absorb(snapshot)
    profiles = [builder.build() for builder in builders.values()]
    return sorted(profiles, key=lambda profile: profile.captured_at, reverse=True)


#: One folded roster per journal file. See `_shared.cached_fold` for the
#: file-keying and outside-the-lock-fold reasoning; it is identical here.
_PLAYER_FOLD_CACHE: dict[str, tuple[tuple[int, int], list[PlayerProfile]]] = {}


def _player_folded(conn: sqlite3.Connection) -> list[PlayerProfile]:
    """`merge_player_snapshots(player_snapshots(conn))`, recomputed only when the journal grew."""
    return cached_fold(
        conn,
        _PLAYER_FOLD_CACHE,
        PLAYER_SNAPSHOTS,
        lambda: merge_player_snapshots(player_snapshots(conn)),
    )


def search_players(
    conn: sqlite3.Connection, needle: str, *, limit: int = 25
) -> list[PlayerProfile]:
    """Profiles matching `needle`, newest-touched first — the player analogue of `tiles.search`.

    Folding happens before the limit, for the same reason `tiles.search`
    folds before limiting: a name shared by many rows must not let one noisy
    contributor spend the whole budget while the rest silently never arrive.
    """
    if limit <= 0:
        return []
    return [
        profile
        for profile in _player_folded(conn)
        if matches(needle, profile.name, profile.game_uid)
    ][:limit]
