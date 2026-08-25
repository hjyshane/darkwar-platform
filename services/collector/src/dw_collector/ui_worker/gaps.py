"""Which ground a sweep missed, and the smallest regions that would fix it.

THE FIRST FULL SWEEP REACHED 91%. Its 37 uncovered cells were not an
unfinished tail: they sat at low x on some rows and high x on others,
alternating, which is rows falling short at whichever end they were running
towards. The measured tiles-per-swipe is only good to about the ~19-tile
quantum of the pan request, and an over-estimate turns straight into a strip
at the end of every row.

THE OBVIOUS FIX IS THE WRONG ONE. Planning each row as if every swipe fell
short covers the error, but the margin has to span the whole spread of the
measurement — observed at 0.0238 to 0.0356 across four runs, a factor of 1.5
— and paying for that up front costs a margin of 0.5, about 1,900 swipes, and
close to two hours per server. That is brute force against noise.

So the sweep stays cheap and converges instead: run it, ask what it missed,
run again over just that. A second pass over 37 cells is minutes, and the
question "what did it miss" is one the journal can already answer because
every pan writes where the camera looked.

This computes the answer LOCALLY, from `world_viewport_snapshots` rows in the
journal, using the same grid and the same half-extents as the
`world_sweep_coverage` view. Locally because the sweep should not need the
network or wait for sync to decide what to do next, and because the journal
is ahead of Supabase by exactly the backlog.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

#: Grid the coverage view uses. Must match migration 0148: 50-tile cells over
#: a 1000-tile map, and the measured half-extents of one viewLvl 1 viewport.
CELL = 50
GRID = 20
HALF_X = 35
HALF_Y = 70


@dataclass(frozen=True)
class Region:
    """An inclusive tile box a sweep can be pointed at."""

    x0: int
    x1: int
    y0: int
    y1: int

    @property
    def cells(self) -> int:
        return ((self.x1 - self.x0 + 1) // CELL) * ((self.y1 - self.y0 + 1) // CELL)


def seen_cells(conn: sqlite3.Connection, server_id: int) -> set[tuple[int, int]]:
    """Grid cells some pan's viewport covered, from the journal's own rows.

    A cell counts as read when a viewport covered its CENTRE, matching the
    view. Cell centres rather than corners: a cell clipped by the edge of a
    pan is half-read, and calling that covered is how a sweep reports success
    over ground it only grazed.
    """
    rows = conn.execute(
        "select row_json from normalized_rows where target_table = 'world_viewport_snapshots'"
    ).fetchall()
    centres: list[tuple[int, int]] = []
    for (raw,) in rows:
        try:
            row = json.loads(raw)["row"]
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
        if row.get("server_id") != server_id:
            continue
        # A viewport that returned nothing covered nothing. viewLvl 2 answers
        # every pan with zero points while the game draws a normal map.
        if not row.get("object_count"):
            continue
        x, y = row.get("center_x"), row.get("center_y")
        if isinstance(x, int) and isinstance(y, int):
            centres.append((x, y))

    seen: set[tuple[int, int]] = set()
    for gx in range(GRID):
        for gy in range(GRID):
            cx, cy = gx * CELL + CELL // 2, gy * CELL + CELL // 2
            if any(abs(cx - px) <= HALF_X and abs(cy - py) <= HALF_Y for px, py in centres):
                seen.add((gx, gy))
    return seen


def missing_cells(conn: sqlite3.Connection, server_id: int) -> set[tuple[int, int]]:
    seen = seen_cells(conn, server_id)
    return {(gx, gy) for gx in range(GRID) for gy in range(GRID)} - seen


def clusters(cells: set[tuple[int, int]]) -> list[set[tuple[int, int]]]:
    """Split missed cells into touching groups.

    ONE BOUNDING BOX AROUND EVERYTHING WOULD BE USELESS. The 37 cells of the
    first sweep spanned x 50..900 and y 100..850 — almost the whole map — while
    being three small clusters plus a handful of singles. Grouping first is
    what makes the second pass short.

    Eight-connected, so a diagonal touch joins: two cells that close together
    are covered by one region more cheaply than by two.
    """
    remaining = set(cells)
    found: list[set[tuple[int, int]]] = []
    while remaining:
        stack = [remaining.pop()]
        group = set(stack)
        while stack:
            gx, gy = stack.pop()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    neighbour = (gx + dx, gy + dy)
                    if neighbour in remaining:
                        remaining.discard(neighbour)
                        group.add(neighbour)
                        stack.append(neighbour)
        found.append(group)
    return sorted(found, key=len, reverse=True)


def regions(cells: set[tuple[int, int]], *, pad: int = 1) -> list[Region]:
    """One tile box per cluster, padded outwards.

    Padded because a cell was missed by a margin, not by a mile: aiming the
    second pass at exactly the cells that failed would ask the same swipes to
    land in the same places, and they would fall short the same way.
    """
    out: list[Region] = []
    for group in clusters(cells):
        xs = [gx for gx, _ in group]
        ys = [gy for _, gy in group]
        out.append(
            Region(
                x0=max(0, (min(xs) - pad) * CELL),
                x1=min(GRID * CELL - 1, (max(xs) + 1 + pad) * CELL - 1),
                y0=max(0, (min(ys) - pad) * CELL),
                y1=min(GRID * CELL - 1, (max(ys) + 1 + pad) * CELL - 1),
            )
        )
    return out
