"""Turning "what did the sweep miss" into "where to point the next one".

The first full sweep reached 91%. These tests are about the step that makes
the remaining 9% cheap to fix rather than expensive to prevent.
"""

from __future__ import annotations

from dw_collector.ui_worker import gaps


def test_touching_cells_are_one_cluster() -> None:
    found = gaps.clusters({(3, 3), (3, 4), (4, 4)})

    assert len(found) == 1


def test_a_diagonal_touch_joins() -> None:
    """Two cells that close together are covered by one region more cheaply
    than by two."""
    assert len(gaps.clusters({(3, 3), (4, 4)})) == 1


def test_separate_patches_stay_separate() -> None:
    """ONE BOX AROUND EVERYTHING WOULD BE USELESS. The first sweep's 37 cells
    spanned x 50..900 and y 100..850 — almost the whole map — while being a
    few small clusters plus singles."""
    found = gaps.clusters({(1, 2), (2, 2), (17, 15), (18, 15)})

    assert len(found) == 2


def test_the_biggest_cluster_comes_first() -> None:
    found = gaps.clusters({(0, 0), (5, 5), (5, 6), (5, 7)})

    assert len(found[0]) == 3


def test_a_region_is_padded_past_the_cells_that_failed() -> None:
    """A cell was missed by a margin, not by a mile. Aiming the second pass at
    exactly the cells that failed asks the same swipes to land in the same
    places, and they fall short the same way."""
    region = gaps.regions({(5, 5)})[0]

    assert region.x0 < 5 * gaps.CELL
    assert region.x1 > 6 * gaps.CELL - 1


def test_a_region_stays_inside_the_world() -> None:
    for cell in [(0, 0), (gaps.GRID - 1, gaps.GRID - 1)]:
        region = gaps.regions({cell})[0]

        assert region.x0 >= 0
        assert region.y0 >= 0
        assert region.x1 <= gaps.GRID * gaps.CELL - 1
        assert region.y1 <= gaps.GRID * gaps.CELL - 1


def test_the_first_sweeps_real_gaps_become_a_handful_of_short_passes() -> None:
    """The actual 37 cells left uncovered by the first full sweep of 580.

    Their bounding box is 18 x 16 cells; grouped, they are small enough that
    a second pass is minutes rather than another half hour.
    """
    missed = {
        (1, 2),
        (2, 2),
        (3, 2),
        (4, 2),
        (7, 2),
        (8, 2),
        (9, 2),
        (10, 2),
        (11, 2),
        (12, 2),
        (16, 6),
        (17, 6),
        (18, 6),
        (16, 7),
        (17, 7),
        (18, 7),
        (16, 12),
        (17, 12),
        (18, 12),
        (18, 11),
        (16, 13),
        (17, 13),
        (18, 13),
        (14, 17),
        (13, 16),
        (14, 16),
        (14, 15),
        (15, 15),
        (17, 15),
        (18, 15),
        (1, 15),
        (5, 15),
        (1, 14),
        (3, 14),
        (3, 13),
        (17, 14),
        (18, 14),
    }
    every_cell = gaps.GRID * gaps.GRID

    found = gaps.regions(missed)

    assert sum(r.cells for r in found) < every_cell // 2
