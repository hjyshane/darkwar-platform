"""Sweep server maps by typing coordinates into the game's own position box.

WHY NOT SWIPES. `sweep.py` pans the map one swipe at a time, and most of its
length is the record of why that is hard: a swipe's travel cannot be resolved
from the pan signal, a pinch drags the camera, and the error compounds along
a row. It also reaches only the map the camera is already on — moving to
another server was "a separate UI flow that does not exist yet".

The game has that flow. Zoomed out one step, a magnifier appears at the
bottom of the world map, and it opens `UIPositionTip`: three fields — server
(shown as "State"), X and Y — and a Go button. The client then moves the
camera there and sends `world.get.new` for that spot, signed and paced like
any other request, because it IS the client's own request. Nothing here
sends anything to the game server; it types into the client's own UI.

So a sweep becomes a list of (server, x, y) and every landing can be checked
exactly: a `world.get.new` request's `x,y` is the centre of the tiles it
returns (median error 0.0 over 72 viewports, see sweep.py), so the journal
says where the camera arrived and on which server.

THE PLAN COVERS CELLS, NOT A LATTICE. Coverage is `world_sweep_coverage`'s
rule (gaps.py): a 50-tile cell is read when some viewLvl 1 viewport's centre
lies within 35 tiles across and 70 down of the cell's centre. Grouping the
cell centres greedily under that reach gives 10 columns x 7 rows — 70 jumps a
server, where the swipe route needed 162 pans at the same zoom — and placing
each jump at its group's middle leaves the rest of the reach as tolerance for
where the camera actually lands.

This module is pure planning and checking; the screen work is in
`goto_screen.py` and the loop in `__main__.goto_sweep`.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from dw_collector.ui_worker.gaps import CELL, GRID, HALF_X, HALF_Y

#: The command whose arrival proves a jump landed, and says where.
MAP_COMMAND = "world.get.new"

#: The servers a scheduled sweep visits: the collector's cluster. The client
#: refuses a server outside it (`CheckIsInServerList`), which shows up here as
#: a server whose first jump never lands.
DEFAULT_SERVERS = tuple(range(566, 589))

#: The zoom every landing must be at. 0 returns ~76 tiles a viewport and 2
#: returns none at all (probe.py); only 1 matches the coverage rule's extents.
VIEW_LEVEL = 1


@dataclass(frozen=True)
class Target:
    server: int
    x: int
    y: int


@dataclass(frozen=True)
class Landing:
    """One `world.get.new` response, as far as a jump is concerned."""

    at: datetime
    server: int
    x: int
    y: int
    view_lvl: int | None
    objects: int


def _groups(reach: int) -> list[tuple[int, int]]:
    """Cell centres on one axis, grouped so one position covers each group.

    Greedy from the low end: a group takes every centre within `2 * reach` of
    its first, which is the most one viewport can hold with the first centre
    still inside it.
    """
    centres = [i * CELL + CELL // 2 for i in range(GRID)]
    groups: list[tuple[int, int]] = []
    start = 0
    while start < len(centres):
        end = start
        while end + 1 < len(centres) and centres[end + 1] - centres[start] <= 2 * reach:
            end += 1
        groups.append((centres[start], centres[end]))
        start = end + 1
    return groups


def axis_positions(reach: int) -> list[int]:
    """Where to put the camera on one axis: the middle of each group."""
    return [(first + last) // 2 for first, last in _groups(reach)]


def axis_tolerance(reach: int) -> int:
    """How far a landing may miss on this axis and still cover its group.

    The reach minus the widest group's half-span: a camera that far off still
    has every centre of that group inside its viewport.
    """
    widest = max(last - first for first, last in _groups(reach))
    return reach - (widest + 1) // 2


#: Columns and rows of one server's plan, and how far a landing may miss.
X_POSITIONS = axis_positions(HALF_X)
Y_POSITIONS = axis_positions(HALF_Y)
TOLERANCE_X = axis_tolerance(HALF_X)
TOLERANCE_Y = axis_tolerance(HALF_Y)


def plan_server(server: int) -> list[Target]:
    """Every jump one server needs, row by row."""
    return [Target(server, x, y) for y in Y_POSITIONS for x in X_POSITIONS]


def plan(servers: Iterable[int]) -> list[Target]:
    return [target for server in servers for target in plan_server(server)]


def plan_cells(server: int, cells: Iterable[tuple[int, int]]) -> list[Target]:
    """Only the jumps that cover these grid cells (gaps.missing_cells).

    Each cell belongs to exactly one column group and one row group, so its
    jump is the full plan's jump for that pair; several missing cells under
    one viewport cost one jump.
    """
    columns = _groups(HALF_X)
    rows = _groups(HALF_Y)
    wanted: set[tuple[int, int]] = set()
    for gx, gy in cells:
        cx, cy = gx * CELL + CELL // 2, gy * CELL + CELL // 2
        col = next(i for i, (a, b) in enumerate(columns) if a <= cx <= b)
        row = next(i for i, (a, b) in enumerate(rows) if a <= cy <= b)
        wanted.add((col, row))
    ordered = sorted((row, col) for col, row in wanted)
    return [Target(server, X_POSITIONS[col], Y_POSITIONS[row]) for row, col in ordered]


def parse_landings(payloads: list[tuple[datetime, str]]) -> list[Landing]:
    """`world.get.new` payloads from the journal, as landings.

    A payload without a server or a position is dropped, not defaulted: a 0
    would read as a landing on a server or a corner nobody asked for.
    """
    out: list[Landing] = []
    for at, raw in payloads:
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(body, dict):
            continue
        server, x, y = body.get("serverId"), body.get("x"), body.get("y")
        if not (isinstance(server, int) and isinstance(x, int) and isinstance(y, int)):
            continue
        view_lvl = body.get("viewLvl")
        points = body.get("points")
        out.append(
            Landing(
                at=at,
                server=server,
                x=x,
                y=y,
                view_lvl=view_lvl if isinstance(view_lvl, int) else None,
                objects=len(points) if isinstance(points, list) else 0,
            )
        )
    return out


def covers(landing: Landing, target: Target) -> bool:
    """Whether this landing reads everything `target` was planned to read.

    Right server, close enough on both axes, at the sweep's zoom, and with
    tiles in it: a viewport that came back empty covered nothing.
    """
    return (
        landing.server == target.server
        and abs(landing.x - target.x) <= TOLERANCE_X
        and abs(landing.y - target.y) <= TOLERANCE_Y
        and landing.view_lvl == VIEW_LEVEL
        and landing.objects > 0
    )


def unreached(targets: Iterable[Target], landings: list[Landing]) -> list[Target]:
    """The targets no landing covered, in plan order."""
    return [t for t in targets if not any(covers(landing, t) for landing in landings)]


def wrong_zoom(landings: list[Landing], server: int) -> bool:
    """Whether this server's recent landings are at a zoom that is not the sweep's.

    True only when there are landings and none is at VIEW_LEVEL, so one stray
    pan from an animation does not trigger a re-zoom.
    """
    mine = [landing for landing in landings if landing.server == server][-5:]
    return bool(mine) and all(landing.view_lvl != VIEW_LEVEL for landing in mine)
