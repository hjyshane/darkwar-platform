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


def _plan(**kwargs: object) -> sweep.SweepPlan:
    args: dict[str, object] = {"along_axis": "x"}
    args.update(kwargs)
    return sweep.plan_from_probe(H, V, **args)  # type: ignore[arg-type]


def test_a_row_takes_many_swipes_not_one() -> None:
    """THE BUG THIS REPLACES. One swipe per pan would cover 21 tiles of a
    56-tile step and report the step done."""
    plan = _plan()

    # 1000 tiles at ~20 per swipe.
    assert plan.per_row > 40


def test_the_whole_map_is_covered_along_the_row() -> None:
    plan = _plan()

    assert plan.per_row * plan.tiles_per_swipe_along >= sweep.MAP_SIZE


def test_rows_step_by_a_viewport_less_the_overlap() -> None:
    """Along a row the limit is how far a swipe goes; DOWN the rows it is how
    tall a viewport is, which is the only place the overlap matters."""
    plan = _plan()

    assert plan.rows == 9  # 1000 / (140 * 0.8)


def test_every_other_row_runs_backwards() -> None:
    """A raster order carries the view the full width of the map between
    rows — at nine rows, more travel than the sweep itself."""
    plan = _plan()

    # Rows are separated by a run of vertical swipes, so the next row starts
    # at the first horizontal one after them, not at per_row + 1.
    horizontal = [s for s in plan.swipes if s.from_x != s.to_x]
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
    along_x = sweep.plan_from_probe(H, V, "x")
    along_y = sweep.plan_from_probe(H, V, "y")

    assert (along_x.along_axis, along_x.down_axis) == ("x", "y")
    assert (along_y.along_axis, along_y.down_axis) == ("y", "x")
    # The viewport is 71 x 140, so stepping down x needs far more rows than
    # stepping down y.
    assert along_y.rows > along_x.rows


def test_a_region_smaller_than_a_swipe_still_gets_one() -> None:
    plan = _plan(region=(500, 505, 500, 505))

    assert plan.rows == 1
    assert plan.per_row == 1
    assert len(plan.swipes) == 1


def test_a_device_that_does_not_move_cannot_be_planned_from() -> None:
    with pytest.raises(ValueError, match="moves nothing"):
        sweep.plan_from_probe(0.0, V, "x")


def test_the_row_direction_is_inverted_because_dragging_is_not_walking() -> None:
    """Backwards here runs off the edge of the world on the first row and
    never recovers, while looking exactly like a sweep that works."""
    plan = _plan()
    first = plan.swipes[0]

    # To carry the VIEW towards larger x, the finger travels towards smaller.
    assert first.to_x < first.from_x
