"""Plan a sweep of the world map as a list of swipes.

A sweep is a routine like any other, so this generates one rather than
inventing a second execution path: the runner already knows how to swipe,
wait for `world.get.new` to prove the pan landed, and abandon the run if the
kill switch trips or the operator touches the machine.

WHY GENERATED AND NOT HAND-WRITTEN. Routines are JSON a person edits, which
works for "open the alliance screen" — six steps. Covering a 1000x1000 map
takes about a hundred pans, and a hundred hand-written swipe coordinates is
not a file anybody will keep correct.

WHY IT ZOOMS OUT FIRST. Measured over 560 real viewports: at the zoom the
game opens on, one screen covers about 38x22 tiles, which needs roughly 1,180
pans for the world. One step out covers 116x141, which needs about a hundred.
That single step is the difference between a sweep that is worth automating
and one that is not. `viewLvl` 2 returns no points at all, so 1 is the widest
useful zoom and there is nothing further to gain.

WHAT THIS CANNOT DO is know where the map is looking when it starts. A swipe
moves the view by a distance in PIXELS; the game reports position in TILES,
and the ratio between them is a property of the device and the zoom. So the
plan is expressed in swipes-from-here, and `tiles_per_swipe` has to be
measured once on the machine that runs it — `dw-ui-worker sweep --calibrate`
does that by panning once and reading how far the world moved.
"""

from __future__ import annotations

from dataclasses import dataclass

from dw_collector.ui_worker.routine import Routine, Step

#: The command a pan produces. Nothing else proves the swipe landed on the
#: map rather than on a menu that happened to be open.
MAP_COMMAND = "world.get.new"

#: Tiles per side of the world.
MAP_SIZE = 1000

#: What one screen covers at viewLvl 1, from 560 observed viewports: the
#: widest were 141 x 138 and the p90 was 116 x 70. The conservative pair is
#: used deliberately — planning with the widest seen would leave unswept
#: strips wherever a viewport came back smaller than its best case.
VIEW_TILES_X = 100
VIEW_TILES_Y = 60

#: Fraction of a screen to leave overlapping between neighbouring pans.
#: Swipes have momentum and do not travel exactly the same distance twice, so
#: planning edge-to-edge guarantees gaps. A fifth is cheap insurance: it costs
#: about a quarter more pans and removes the failure that is invisible until
#: somebody cannot find a player who was there all along.
OVERLAP = 0.2


@dataclass(frozen=True)
class Swipe:
    """One pan, in screen pixels."""

    from_x: int
    from_y: int
    to_x: int
    to_y: int


@dataclass(frozen=True)
class Calibration:
    """What one swipe does on this device, measured rather than assumed."""

    #: Where a swipe starts and how far it may travel without leaving the
    #: screen. Device pixels.
    centre_x: int
    centre_y: int
    reach_x: int
    reach_y: int
    #: How many map tiles one full-reach swipe moves the view.
    tiles_per_swipe_x: float
    tiles_per_swipe_y: float

    def swipe_for(self, tiles_x: float, tiles_y: float) -> Swipe:
        """A swipe that moves the view by roughly this many tiles.

        INVERTED, because dragging is the opposite of walking: pulling the
        map left moves the viewpoint right. Getting this backwards produces a
        sweep that runs off the edge of the world on its first row and never
        recovers, which looks exactly like a sweep that is working until you
        check the coordinates.
        """
        dx = -_clamp(tiles_x / self.tiles_per_swipe_x, 1.0) * self.reach_x
        dy = _clamp(tiles_y / self.tiles_per_swipe_y, 1.0) * self.reach_y
        return Swipe(
            from_x=self.centre_x,
            from_y=self.centre_y,
            to_x=self.centre_x + int(dx),
            to_y=self.centre_y + int(dy),
        )


def _clamp(value: float, limit: float) -> float:
    return max(-limit, min(limit, value))


def tiles_between_pans() -> tuple[int, int]:
    """How far to move between pans, after the overlap is taken out."""
    return (
        int(VIEW_TILES_X * (1 - OVERLAP)),
        int(VIEW_TILES_Y * (1 - OVERLAP)),
    )


def plan_columns_rows(
    region: tuple[int, int, int, int] | None = None,
) -> tuple[int, int]:
    """How many pans across and down a region needs.

    `region` is (x0, x1, y0, y1) inclusive; None means the whole world.
    """
    x0, x1, y0, y1 = region or (0, MAP_SIZE - 1, 0, MAP_SIZE - 1)
    step_x, step_y = tiles_between_pans()
    # A region narrower than one screen still needs one pan, not zero.
    across = max(1, -(-(x1 - x0 + 1) // step_x))
    down = max(1, -(-(y1 - y0 + 1) // step_y))
    return across, down


def serpentine(
    region: tuple[int, int, int, int] | None = None,
) -> list[tuple[int, int]]:
    """The order to visit each pan, as (column, row) indices.

    BOUSTROPHEDON — every other row runs backwards, the way a field is
    ploughed. A raster order would carry the view all the way back across the
    map at the end of each row: one extra full-width traverse per row, which
    at fifteen rows is more travel than the sweep itself.
    """
    across, down = plan_columns_rows(region)
    order: list[tuple[int, int]] = []
    for row in range(down):
        columns = range(across) if row % 2 == 0 else reversed(range(across))
        order.extend((column, row) for column in columns)
    return order


def build_routine(
    calibration: Calibration,
    *,
    region: tuple[int, int, int, int] | None = None,
    settle_seconds: float = 1.2,
    timeout_seconds: float = 15.0,
    name: str = "map-sweep",
) -> Routine:
    """The whole sweep, as a routine the existing runner can execute.

    Every pan EXPECTS `world.get.new`. That is what separates this from a
    hundred blind swipes: if the map is not open, or a dialog has taken the
    screen, the response never arrives and the run stops on the step that
    failed instead of dragging a finger across a menu ninety more times.
    """
    step_x, step_y = tiles_between_pans()
    order = serpentine(region)
    steps: list[Step] = []
    previous: tuple[int, int] | None = None

    for column, row in order:
        if previous is None:
            # The first cell is wherever the map already is. Moving to an
            # absolute position is not possible with swipes alone, so the
            # sweep covers a region RELATIVE to where it began, and the
            # caller positions the map first.
            previous = (column, row)
            continue
        move_x = (column - previous[0]) * step_x
        move_y = (row - previous[1]) * step_y
        swipe = calibration.swipe_for(move_x, move_y)
        steps.append(
            Step(
                name=f"pan-{column}-{row}",
                action="swipe",
                x=swipe.from_x,
                y=swipe.from_y,
                to_x=swipe.to_x,
                to_y=swipe.to_y,
                duration_ms=250,
                expect=[MAP_COMMAND],
                settle_seconds=settle_seconds,
                timeout_seconds=timeout_seconds,
            )
        )
        previous = (column, row)

    return Routine(
        name=name,
        description=(
            f"{len(steps)} pans at viewLvl 1, "
            f"{step_x}x{step_y} tiles apart with {int(OVERLAP * 100)}% overlap"
        ),
        steps=steps,
    )


def covered(seen: list[tuple[int, int]]) -> tuple[int, int, int, int] | None:
    """The box a set of observed tiles actually covers.

    Reported after a run rather than assumed from the plan, because a plan is
    a hope: a swipe that hit a UI element, or one the game swallowed, leaves a
    hole the step count cannot see.
    """
    if not seen:
        return None
    xs = [x for x, _ in seen]
    ys = [y for _, y in seen]
    return (min(xs), max(xs), min(ys), max(ys))
