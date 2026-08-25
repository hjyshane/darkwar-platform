"""Plan a sweep of the world map as a list of swipes.

A sweep is a routine like any other, so this generates one rather than
inventing a second execution path: the runner already knows how to swipe,
wait for `world.get.new` to prove the pan landed, and abandon the run if the
kill switch trips or the operator touches the machine.

WHY GENERATED AND NOT HAND-WRITTEN. Routines are JSON a person edits, which
works for "open the alliance screen" — six steps. Covering a 1000x1000 map
takes about a hundred pans, and a hundred hand-written swipe coordinates is
not a file anybody will keep correct.

WHY IT ZOOMS OUT FIRST. Measured across 92 request/response pairs: at the
zoom the game opens on (`viewLvl` 0) one screen returns 23x40 tiles and about
76 of them, which needs roughly 1,100 pans for the world. `viewLvl` 1 returns
71x141 and about 647, which needs 162. That single step is the difference
between a sweep worth automating and one that is not.

`viewLvl` 2 RETURNS NOTHING — 15 requests, zero points every time. The game
still draws a map, so an operator zoomed all the way out sees a normal screen
while the server sends no tiles at all. A sweep that ran there would report
success and collect nothing, which is why the routine sets the zoom rather
than trusting where it was left.

A swipe moves the view by a distance in PIXELS while the game reports
position in TILES, and the ratio cannot be derived from the resolution: the
viewport is 71x141 tiles on a 1080x1920 screen, 1:1.99 against the screen's
1:1.78. So it has to be measured on the machine.

THAT MEASUREMENT WAS ATTEMPTED ON THE LIVE COLLECTOR AND DOES NOT WORK.
Recorded here because the obvious approach — "pan once, read how far the
world moved" — looks correct and fails quietly, so the next person to try it
should know what they are walking into.

Two things defeat it, and they compound:

  THE POSITION SIGNAL IS COARSE. `world.get.new` is not emitted as the
  camera moves; it is emitted when the camera has drifted far enough that
  the client wants more tiles. Across 117 consecutive viewLvl 1 pairs the
  nonzero jumps cluster hard on 19-22 tiles, and in a clean run of eight
  graded swipes EVERY delta was a multiple of about 19: +19,-2 / +19,0 /
  +19,0 / +17,-19 / 0,-21 / 0,-19. A 300px swipe and a 700px swipe both
  report "19". The signal cannot resolve a swipe.

  THE ZOOM GESTURE PANS. Pinch is two fingers moving symmetrically about a
  centre, but the game takes the residual as a drag: clamping to max zoom
  and stepping back in moved the camera from (566,341) to (956,86). So the
  displacement being measured is the swipe plus however far setting the zoom
  dragged, and the two cannot be separated after the fact.

The consequence is that two consecutive careful runs disagreed about
something as basic as WHICH AXIS a horizontal swipe moves — one said map Y,
the next said map X. Not noise in a constant; the sign of the mapping was
unresolved.

SO DO NOT PLAN COVERAGE ON A MEASURED CONSTANT. Verify it instead. The
sweep already stores every tile it sees, which makes coverage a question the
database can answer: swipe with generous overlap, then ask which regions
have no fresh tiles and sweep those. That needs neither the pixel ratio nor
the axis mapping, is immune to fling and momentum and emulator lag, and
turns this repo's recurring failure — reporting success while silently
missing rows — into a number somebody can look at.

WHAT DID CALIBRATE, and is worth keeping:

  The request's `x,y` IS the centre of the returned tiles, exactly: median
  error 0.0 tiles over 72 viewports. So a stored viewport needs no separate
  record of where the camera was.

  Zoom can be driven without root. `/dev/input/event4` is "BlueStacks
  Virtual Touch", crw-rw---- root:input, and adb's `shell` user is in group
  input. It reports ABS_MT_POSITION_X/Y but no ABS_MT_SLOT, so multitouch is
  protocol A: per finger a position pair then SYN_MT_REPORT, and SYN_REPORT
  to close the frame. A pinch built that way reliably changes viewLvl.
"""

from __future__ import annotations

from dataclasses import dataclass

from dw_collector.ui_worker.routine import Routine, Step

#: The command a pan produces. Nothing else proves the swipe landed on the
#: map rather than on a menu that happened to be open.
MAP_COMMAND = "world.get.new"

#: Tiles per side of the world.
MAP_SIZE = 1000

#: What one viewport covers at viewLvl 1, measured from 47 responses decoded
#: with the current decoder: X was 71 in every single one — median, p90 and
#: max alike — and Y was 140 or 141. This is a fixed window the server
#: chooses, not something that varies with what is on screen, which is why
#: there is no spread to be conservative about.
#:
#: THESE READ 100 x 60 AND BOTH WERE WRONG. They came from viewports decoded
#: before the coordinate fix, when the packing was believed to be
#: `x * 1000 + y`, so the axes were transposed: the old "116 x 70" is this
#: 71 x 141 seen sideways. The shape mattered more than the size. Planning a
#: 100-wide window against a 71-wide one leaves 29% of every row unobserved
#: while the sweep reports success — the same silent-gap failure OVERLAP
#: exists to prevent, introduced by the constant meant to prevent it.
VIEW_TILES_X = 71
VIEW_TILES_Y = 140

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


@dataclass(frozen=True)
class SweepPlan:
    """A sweep as the swipes it actually takes, not as the pans it wants.

    THE DISTINCTION IS THE POINT. `build_routine` above plans one swipe per
    pan, which assumes a swipe can travel a whole step. On the real device it
    cannot: the step between pans is 56 tiles and the longest swipe that fits
    on a 1080-wide screen moves about 21. Planning one-to-one would leave two
    thirds of every step uncovered while the routine reported every step
    verified — the silent-gap failure again, one level up from the constants
    that caused it last time.

    So the unit here is the swipe, and a step is however many of them it
    takes.
    """

    swipes: list[Swipe]
    rows: int
    per_row: int
    #: Which map axis the rows run along, and which one they step down.
    along_axis: str
    down_axis: str
    tiles_per_swipe_along: float
    tiles_per_swipe_down: float
    #: Swipes spent getting to the corner the route starts from, before any
    #: sweeping happens. Reported so a run that spends most of its budget
    #: travelling is visible rather than merely slow.
    homing: int


def plan_from_probe(
    horizontal_tiles_per_pixel: float,
    vertical_tiles_per_pixel: float,
    along_axis: str,
    *,
    screen_width: int = 1080,
    screen_height: int = 1920,
    start: tuple[int, int],
    centre: tuple[int, int] | None = None,
    reach: float = 0.8,
    region: tuple[int, int, int, int] | None = None,
) -> SweepPlan:
    """Turn a measured device into the swipes that cover a region.

    Rows run along whichever map axis the HORIZONTAL screen swipe drives,
    because that is measured rather than assumed — a device where it drives
    the other one gets its rows the other way round and nothing else changes.

    Rows step down by a viewport's worth less the overlap. Along a row the
    step is simply as far as one swipe goes: at ~21 tiles against a 71-tile
    viewport, consecutive pans overlap by two thirds. That is far more overlap
    than needed and it is not worth optimising away — the swipe length is the
    hard limit, and the alternative to redundant coverage here is no coverage.

    `start` IS WHERE THE CAMERA ACTUALLY IS, and this function had no such
    parameter until somebody asked what it assumed. It assumed the camera
    began in the corner the sweep marches away from. The rows only ever run
    one way and the steps only ever go one way, so from anywhere else the
    route reaches the far corner early and spends the rest of its swipes
    pushing against the edge. Walked from the position the last live probe
    reported, 466 swipes covered 72 of 400 cells; from dead centre, 200; only
    from that one corner, all 400.

    Nothing caught it because the assumption was not written down anywhere to
    be disagreed with — the planner had no notion of position at all, and the
    tests agreed with it about a map whose origin was wherever the sweep
    happened to begin. The same shape as the coordinate bug: self-consistent,
    and consistently wrong.

    So the route now begins by driving to that corner from where the camera
    is. The probe already measures the position; this just stops throwing it
    away.
    """
    cx = screen_width // 2 if centre is None else centre[0]
    cy = int(screen_height * 0.47) if centre is None else centre[1]
    reach_x = int(screen_width * reach / 2)
    reach_y = int(screen_height * reach / 2)

    down_axis = "y" if along_axis == "x" else "x"
    view_down = VIEW_TILES_Y if down_axis == "y" else VIEW_TILES_X

    per_swipe_along = abs(horizontal_tiles_per_pixel) * reach_x * 2
    per_swipe_down = abs(vertical_tiles_per_pixel) * reach_y * 2
    if per_swipe_along <= 0 or per_swipe_down <= 0:
        msg = "a measured swipe that moves nothing cannot be planned from"
        raise ValueError(msg)

    x0, x1, y0, y1 = region or (0, MAP_SIZE - 1, 0, MAP_SIZE - 1)
    along_span = (x1 - x0 + 1) if along_axis == "x" else (y1 - y0 + 1)
    down_span = (y1 - y0 + 1) if down_axis == "y" else (x1 - x0 + 1)

    step_down = view_down * (1 - OVERLAP)
    rows = max(1, -(-down_span // int(step_down)))
    per_row = max(1, -(-along_span // int(per_swipe_along)))
    down_swipes = max(1, round(step_down / per_swipe_down))

    # Dragging is the opposite of walking: to move the VIEW forward the finger
    # travels backward. Getting this inverted produces a sweep that runs off
    # the edge of the world on its first row and never recovers, which looks
    # exactly like a sweep that is working.
    forward = Swipe(cx + reach_x, cy, cx - reach_x, cy)
    backward = Swipe(cx - reach_x, cy, cx + reach_x, cy)
    downward = Swipe(cx, cy + reach_y, cx, cy - reach_y)
    upward = Swipe(cx, cy - reach_y, cx, cy + reach_y)

    # DRIVE TO THE CORNER THE ROUTE STARTS FROM. The rows run one way and the
    # steps go one way, so the route is only a sweep of the map when it begins
    # where the map does. From anywhere else it reaches the far corner early
    # and pushes against the edge for the rest of its swipes.
    #
    # A quarter more than the arithmetic says, because the edge is a hard stop:
    # arriving early costs a few no-op swipes, arriving short leaves a strip
    # nothing ever reads. The measured tiles-per-swipe is only good to about
    # the ~19-tile quantum anyway, which is most of one swipe.
    start_along, start_down = start if along_axis == "x" else (start[1], start[0])
    along_origin = x0 if along_axis == "x" else y0
    down_end = y1 if down_axis == "y" else x1
    homing: list[Swipe] = []
    homing += [backward] * int(max(0.0, start_along - along_origin) / per_swipe_along * 1.25 + 1)
    homing += [upward] * int(max(0.0, down_end - start_down) / per_swipe_down * 1.25 + 1)

    swipes: list[Swipe] = list(homing)
    for row in range(rows):
        # BOUSTROPHEDON: every other row runs back the way it came. A raster
        # order would carry the view the full width of the map between rows,
        # which at nine rows is more travel than the sweep itself.
        swipes.extend([forward if row % 2 == 0 else backward] * per_row)
        if row < rows - 1:
            swipes.extend([downward] * down_swipes)

    return SweepPlan(
        swipes=swipes,
        rows=rows,
        per_row=per_row,
        along_axis=along_axis,
        down_axis=down_axis,
        tiles_per_swipe_along=per_swipe_along,
        tiles_per_swipe_down=per_swipe_down,
        homing=len(homing),
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
