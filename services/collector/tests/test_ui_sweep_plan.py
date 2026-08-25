"""Planning a sweep in SWIPES rather than in pans.

The older planner assumed one swipe per pan step. Measured on the device, a
step between pans is 56 tiles and the longest swipe that fits on the screen
moves about 21 — so one-to-one would leave two thirds of every step unswept
while every step reported verified. These tests are about that gap and about
the directions, which are the two things a plan cannot be quietly wrong
about.
"""

from __future__ import annotations

import pytest

from dw_collector.ui_worker import sweep

# What the live collector measured: horizontal drives map x, vertical drives
# map y and is negative, cross terms exactly zero.
H = 0.0238
V = -0.0375


#: The map's corner the route marches away from. A plan that begins here
#: needs no homing, which is what every assertion about the route shape
#: wants to look at on its own.
ORIGIN = (0, 999)


def _plan(**kwargs: object) -> sweep.SweepPlan:
    args: dict[str, object] = {"along_axis": "x", "start": ORIGIN}
    args.update(kwargs)
    return sweep.plan_from_probe(H, V, **args)  # type: ignore[arg-type]


def _walk(plan: sweep.SweepPlan, start: tuple[int, int]) -> list[tuple[float, float]]:
    """Where the camera goes, clamped by the edges of the world."""
    x, y = float(start[0]), float(start[1])
    path = []
    for step in plan.swipes:
        x = min(999.0, max(0.0, x + (step.to_x - step.from_x) * H * -1))
        y = min(999.0, max(0.0, y + (step.to_y - step.from_y) * V * -1))
        path.append((x, y))
    return path


def _cells_covered(path: list[tuple[float, float]]) -> int:
    """Cells whose centre some viewport covered — the same test
    world_sweep_coverage applies, with the same measured half-extents."""
    return sum(
        1
        for cx in range(20)
        for cy in range(20)
        if any(abs(cx * 50 + 25 - px) <= 35 and abs(cy * 50 + 25 - py) <= 70 for px, py in path)
    )


def test_a_row_takes_many_swipes_not_one() -> None:
    """THE BUG THIS REPLACES. One swipe per pan would cover 21 tiles of a
    56-tile step and report the step done."""
    plan = _plan()

    # 1000 tiles at ~20 per swipe.
    assert plan.per_row > 40


def test_the_whole_map_is_covered_along_the_row() -> None:
    plan = _plan()

    assert plan.per_row * plan.tiles_per_swipe_along >= sweep.MAP_SIZE


def test_there_are_more_rows_than_the_step_arithmetic_needs() -> None:
    """Down the rows the limit is how tall a viewport is — 1000 / (140 * 0.8)
    is nine — but the step is measured, and a step that lands short costs
    REACH: nine rows each falling a quarter short cover 756 tiles of a
    1000-tile map and never visit the last 250.

    Widening the step instead would push neighbouring rows further apart than
    a viewport is tall and open horizontal bands, which is what OVERLAP exists
    to prevent. So the step stays as measured and the COUNT takes the margin.
    """
    plan = _plan()

    assert plan.rows > 9
    assert plan.rows * sweep.VIEW_TILES_Y * (1 - sweep.OVERLAP) * (1 - sweep.ROW_MARGIN) >= (
        sweep.MAP_SIZE
    )


def test_every_other_row_runs_backwards() -> None:
    """A raster order carries the view the full width of the map between
    rows — at nine rows, more travel than the sweep itself."""
    plan = _plan()

    # Rows are separated by a run of vertical swipes, so the next row starts
    # at the first horizontal one after them, not at per_row + 1.
    horizontal = [s for s in plan.swipes[plan.homing :] if s.from_x != s.to_x]
    first = horizontal[0]
    second_row_start = horizontal[plan.per_row]

    assert (first.to_x - first.from_x) * (second_row_start.to_x - second_row_start.from_x) < 0


def test_a_swipe_stays_on_the_screen() -> None:
    plan = _plan(screen_width=1080, screen_height=1920)

    for swipe_ in plan.swipes:
        for value in (swipe_.from_x, swipe_.to_x):
            assert 0 <= value <= 1080
        for value in (swipe_.from_y, swipe_.to_y):
            assert 0 <= value <= 1920


def test_the_axis_the_probe_measured_is_the_axis_the_rows_follow() -> None:
    """Not assumed. A device where a horizontal swipe drives map y gets its
    rows the other way round, and nothing else about the plan changes."""
    along_x = sweep.plan_from_probe(H, V, "x", start=ORIGIN)
    along_y = sweep.plan_from_probe(H, V, "y", start=ORIGIN)

    assert (along_x.along_axis, along_x.down_axis) == ("x", "y")
    assert (along_y.along_axis, along_y.down_axis) == ("y", "x")
    # The viewport is 71 x 140, so stepping down x needs far more rows than
    # stepping down y.
    assert along_y.rows > along_x.rows


def test_a_region_smaller_than_a_swipe_still_gets_one() -> None:
    plan = _plan(start=(500, 505), region=(500, 505, 500, 505))

    assert plan.rows == 1
    assert plan.per_row == 1
    # One sweeping swipe. The homing swipes in front of it are the cost of
    # not assuming where the camera was.
    assert len(plan.swipes) - plan.homing == 1


def test_a_device_that_does_not_move_cannot_be_planned_from() -> None:
    with pytest.raises(ValueError, match="moves nothing"):
        sweep.plan_from_probe(0.0, V, "x", start=ORIGIN)


def test_the_row_direction_is_inverted_because_dragging_is_not_walking() -> None:
    """Backwards here runs off the edge of the world on the first row and
    never recovers, while looking exactly like a sweep that works."""
    plan = _plan()
    first = plan.swipes[plan.homing]

    # To carry the VIEW towards larger x, the finger travels towards smaller.
    assert first.to_x < first.from_x


def test_a_sweep_covers_the_map_from_wherever_the_camera_is() -> None:
    """THE BUG THIS PINS, and it took somebody asking what the planner
    assumed to find it.

    The rows run one way and the steps go one way, so the route is a sweep of
    the map only when it begins where the map does. It had no notion of
    position at all, so it silently assumed the corner it marches away from.
    Walked from the position the last live probe reported, 466 swipes covered
    72 of 400 cells; from dead centre, 200.
    """
    for start in [(690, 188), (500, 500), (0, 999), (999, 0), (999, 999)]:
        plan = sweep.plan_from_probe(H, V, "x", start=start)

        assert _cells_covered(_walk(plan, start)) == 400, f"missed ground starting from {start}"


def test_homing_costs_what_the_distance_costs() -> None:
    """Not free, and not hidden. A run that spends most of its budget
    travelling should be visible as that rather than merely slow."""
    near = sweep.plan_from_probe(H, V, "x", start=(0, 999))
    far = sweep.plan_from_probe(H, V, "x", start=(999, 0))

    assert near.homing < far.homing
    assert far.homing == len(far.swipes) - len(near.swipes) + near.homing


def test_the_route_after_homing_does_not_depend_on_where_it_started() -> None:
    """Only the approach differs. If the sweep itself changed shape with the
    start, a partial run would cover different ground each night."""
    a = sweep.plan_from_probe(H, V, "x", start=(690, 188))
    b = sweep.plan_from_probe(H, V, "x", start=(500, 500))

    assert a.swipes[a.homing :] == b.swipes[b.homing :]
