"""Player power breakdown: `player_detail_snapshots`.

WHY THIS IS A SEPARATE PROJECTION FROM `players.PlayerProfile`, NOT A FIELD
ON IT. `player_detail_snapshots` has exactly ONE writer —
`get_new_user_info.py` (`get.new.user.info`) — so none of `players.py`'s
per-field merge trap applies here: there is no second command supplying
`power_total` under a different shape to reconcile against. A plain
newest-ROW-wins fold, the same shape as `tiles.newest_per_player`, is
already correct for a single-writer table. Folding it into `PlayerProfile`
would force every OTHER caller of that profile (which is populated by three
different commands, none of which is this one) to carry three always-null
fields for the sake of one. Keeping it separate also keeps this table's own
trap in view instead of buried in a bigger merge: `components_sum_matches`
must be surfaced, not silently dropped — a profile whose six power
components do not sum to its `power_total` is telling you something (a
protocol change, a component this parser has not learned yet), and hiding
that behind a single `power_total` number would present an unverified figure
as if it were exact.

`player_component_power_snapshots` (the six-metric breakdown: `metric`,
`power`, `name`, `unit_id`) is DELIBERATELY NOT projected here either. It is
shaped nothing like a profile field — it is MANY rows per player (one per
metric, written by `get_new_user_info.py`, `get_user_info_multi.py` AND
`rank_by_range.py`, each under its own metric name), so "a player's power
breakdown" is a small table, not a scalar. It carries no field-per-command
merge trap of its own — each metric already has a name and its own
idempotency key — but building a correct list-shaped projection is its own
piece of work, and nothing in this plan's scope needs the six-way chart yet.
Add it as its own module when a screen actually needs it, following this
same pattern: raw rows, a guarded per-row parse, and — if it turns out to
need folding at all — the newest-per-(player, metric) rule, not the
per-field merge this module's sibling `players.py` needed.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

from ._shared import SELECT_BY_TARGET_TABLE

#: The one target table this module reads.
PLAYER_DETAIL = "player_detail_snapshots"


@dataclass(frozen=True)
class PlayerDetail:
    """One `player_detail_snapshots` row: a profile-open power breakdown."""

    game_uid: int
    server_id: int
    power_total: int | None
    #: Whatever components this capture actually carried, by payload field
    #: name (e.g. `armyPower`). Empty rather than absent keys for anything
    #: the capture did not report — "we did not observe this component" and
    #: "it is zero" are different claims, so a missing component is simply
    #: not a key here, never a zero.
    power_components: dict[str, int]
    #: None means "too few components were present to check"; the caller
    #: must not read a missing check as a passing one. False means the six
    #: components were all present and did NOT sum to `power_total` — surface
    #: this, do not hide it behind `power_total` alone.
    components_sum_matches: bool | None
    captured_at: str


def player_details(conn: sqlite3.Connection) -> list[PlayerDetail]:
    """Every profile-open power breakdown in the journal, one entry per row written.

    DELIBERATELY NOT FOLDED, matching `tiles.tiles` and `players.player_snapshots`:
    see `newest_detail_per_player` for the one-per-player view.
    """
    found: list[PlayerDetail] = []
    for raw, captured_at in conn.execute(SELECT_BY_TARGET_TABLE, (PLAYER_DETAIL,)).fetchall():
        detail = _player_detail(raw, captured_at)
        if detail is not None:
            found.append(detail)
    return found


def _player_detail(raw: str, captured_at: str) -> PlayerDetail | None:
    """One journal row as a `PlayerDetail`, or None when it cannot be read as one.

    THE WHOLE PARSE IS GUARDED, not merely the JSON decode — same reasoning
    as `tiles._tile` and `players._player_snapshot`.
    """
    try:
        row = json.loads(raw)["row"]
        uid, server_id = row.get("game_uid"), row.get("server_id")
        if uid is None or server_id is None:
            return None
        components_raw = row.get("power_components")
        if components_raw is None:
            components_raw = {}
        if not isinstance(components_raw, dict):
            msg = "power_components must be an object"
            raise TypeError(msg)
        components = {str(key): int(value) for key, value in components_raw.items()}
        power_total = row.get("power_total")
        matches_check = row.get("components_sum_matches")
        if matches_check is not None and not isinstance(matches_check, bool):
            msg = "components_sum_matches must be a bool or null"
            raise TypeError(msg)
        return PlayerDetail(
            game_uid=int(uid),
            server_id=int(server_id),
            power_total=None if power_total is None else int(power_total),
            power_components=components,
            components_sum_matches=matches_check,
            captured_at=captured_at,
        )
    except (ValueError, KeyError, TypeError, AttributeError):
        # A journal is written by a parser that changes over time, and by
        # parsers not yet written. One unreadable row must not take out the
        # whole read.
        return None


def newest_detail_per_player(found: list[PlayerDetail]) -> list[PlayerDetail]:
    """One entry per player per server, at the newest profile open.

    WHOLE-ROW NEWEST WINS, unlike `players.merge_player_snapshots`: this
    table has exactly one writer, so there is no second command's shape to
    reconcile against, and a per-field merge here would just be more code for
    the same answer a plain replacement already gives.

    KEYED ON (server_id, game_uid) and NEWEST-FIRST, matching
    `tiles.newest_per_player` and `players.merge_player_snapshots`, for the
    same reasons: the same uid can be two different players on two servers,
    and a caller listing profiles wants the most recently touched one first.
    ON AN EXACT TIE the first entry (by the shared SELECT's ascending `n.id`
    order) wins, for the same reason tiles' tie-break is deterministic.
    """
    newest: dict[tuple[int, int], PlayerDetail] = {}
    for detail in found:
        key = (detail.server_id, detail.game_uid)
        seen = newest.get(key)
        if seen is not None and seen.captured_at >= detail.captured_at:
            continue
        newest[key] = detail
    return sorted(newest.values(), key=lambda detail: detail.captured_at, reverse=True)
