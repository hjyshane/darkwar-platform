"""Planning a map sweep, without a device.

The whole plan is arithmetic, so all of it can be checked here — which
matters because the alternative is finding out by dragging a finger across a
phone a hundred times and reading coordinates afterwards.
"""

from __future__ import annotations

from dw_collector.ui_worker import sweep


def _calibration(**over: float) -> sweep.Calibration:
    values: dict[str, float] = {
        "centre_x": 540,
        "centre_y": 960,
        "reach_x": 400,
        "reach_y": 300,
        "tiles_per_swipe_x": 80,
        "tiles_per_swipe_y": 50,
    }
    values.update(over)
    return sweep.Calibration(
        centre_x=int(values["centre_x"]),
        centre_y=int(values["centre_y"]),
        reach_x=int(values["reach_x"]),
        reach_y=int(values["reach_y"]),
        tiles_per_swipe_x=values["tiles_per_swipe_x"],
        tiles_per_swipe_y=values["tiles_per_swipe_y"],
    )


def test_dragging_is_the_opposite_of_walking() -> None:
    """THE ERROR THAT LOOKS LIKE IT IS WORKING.

    Pulling the map to the LEFT moves the viewpoint RIGHT. Get it backwards
    and the sweep leaves the map on its first row and never comes back, while
    the step count, the timings and the expect-checks all still look healthy.
    """
    east = _calibration().swipe_for(40, 0)

    # To see ground further east, the finger travels west.
    assert east.to_x < east.from_x


def test_a_vertical_move_goes_the_other_way_too() -> None:
    north = _calibration().swipe_for(0, 25)

    assert north.to_y != north.from_y


def test_a_swipe_never_leaves_the_screen() -> None:
    # Asking for half the map in one pan must not produce a coordinate off
    # the device; adb would take it and the gesture would do something
    # unpredictable.
    huge = _calibration().swipe_for(10_000, 10_000)

    assert abs(huge.to_x - huge.from_x) <= 400
    assert abs(huge.to_y - huge.from_y) <= 300


def test_pans_overlap_rather_than_meeting_edge_to_edge() -> None:
    """Swipes have momentum and do not repeat exactly, so edge-to-edge
    planning guarantees unswept strips — and a strip is invisible until
    somebody cannot find a player who never moved."""
    step_x, step_y = sweep.tiles_between_pans()

    assert step_x < sweep.VIEW_TILES_X
    assert step_y < sweep.VIEW_TILES_Y


def test_the_whole_world_is_about_a_hundred_pans() -> None:
    # The number that decides whether this is worth automating at all. At the
    # zoom the game opens on it would be roughly 1,180.
    across, down = sweep.plan_columns_rows()

    assert across * down < 300
    assert across * down > 50


def test_a_region_smaller_than_one_screen_still_gets_one_pan() -> None:
    # Not zero. A caller asking about a corner of the map should get a look
    # at it rather than an empty routine that reports success.
    across, down = sweep.plan_columns_rows((500, 510, 500, 510))

    assert (across, down) == (1, 1)


def test_rows_alternate_direction() -> None:
    """Ploughed, not rastered: a raster order drags the view back across the
    whole map at the end of every row, which at fifteen rows is more travel
    than the sweep itself."""
    order = sweep.serpentine((0, 299, 0, 199))
    across, _ = sweep.plan_columns_rows((0, 299, 0, 199))

    first = [column for column, row in order if row == 0]
    second = [column for column, row in order if row == 1]

    assert first == sorted(first)
    assert second == sorted(second, reverse=True)
    assert len(first) == across


def test_every_cell_is_visited_exactly_once() -> None:
    order = sweep.serpentine((0, 499, 0, 499))
    across, down = sweep.plan_columns_rows((0, 499, 0, 499))

    assert len(order) == across * down
    assert len(set(order)) == len(order)


def test_every_pan_waits_for_the_map_to_answer() -> None:
    """What separates this from a hundred blind swipes. With no expect, a
    dialog over the map means ninety more drags across a menu."""
    routine = sweep.build_routine(_calibration(), region=(0, 299, 0, 199))

    assert routine.steps
    assert all(step.expect == [sweep.MAP_COMMAND] for step in routine.steps)
    assert all(step.action == "swipe" for step in routine.steps)


def test_the_first_cell_costs_no_swipe() -> None:
    # The sweep starts wherever the map already is; panning before reading
    # would skip the ground under the opening view.
    across, down = sweep.plan_columns_rows((0, 299, 0, 199))
    routine = sweep.build_routine(_calibration(), region=(0, 299, 0, 199))

    assert len(routine.steps) == across * down - 1


def test_covered_reports_the_real_box_not_the_planned_one() -> None:
    # A plan is a hope. A swipe that hit a UI element leaves a hole the step
    # count cannot see, so coverage is read back from what arrived.
    assert sweep.covered([]) is None
    assert sweep.covered([(10, 20), (30, 5), (25, 40)]) == (10, 30, 5, 40)
