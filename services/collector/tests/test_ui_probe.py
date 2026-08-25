"""Measuring what a swipe does, and refusing to guess when it cannot.

The probe exists because two careful live runs disagreed about which map axis
a horizontal swipe moves. So these tests are mostly about the REFUSALS: every
condition below is a way a sweep could run to completion, report success, and
have collected nothing.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from dw_collector.ui_worker.probe import (
    SWEEP_VIEW_LEVEL,
    AxisEffect,
    Probe,
    ProbeError,
    Viewport,
    effect_of,
    parse_viewports,
)

AT = datetime(2026, 8, 25, 18, 0, tzinfo=UTC)


def _payload(**kwargs: object) -> tuple[datetime, str]:
    body = {"x": 500, "y": 500, "viewLvl": 1, "points": ["a", "b"], **kwargs}
    return (AT, json.dumps(body))


def _clean(axis: str, tpp: float) -> AxisEffect:
    return AxisEffect(axis=axis, tiles_per_pixel=tpp, cross_tiles_per_pixel=0.0)


def test_a_payload_without_a_centre_is_dropped_not_defaulted() -> None:
    """A defaulted 0,0 reads as an enormous pan to the map's corner, and the
    probe would derive its whole scale from it."""
    got = parse_viewports([_payload(), (AT, json.dumps({"viewLvl": 1})), _payload(x=600)])

    assert [v.x for v in got] == [500, 600]


def test_unreadable_json_does_not_abort_the_probe() -> None:
    got = parse_viewports([_payload(), (AT, "{not json"), _payload(x=600)])

    assert len(got) == 2


def test_the_dominant_axis_wins_outright() -> None:
    """The sweep pans along one map axis at a time. A model that spread each
    swipe across both would plan rows that drift diagonally."""
    first = Viewport(at=AT, x=500, y=500, view_lvl=1, objects=600)
    last = Viewport(at=AT, x=502, y=580, view_lvl=1, objects=600)

    effect = effect_of(first, last, pixels=400, swipes=4)

    assert effect.axis == "y"
    assert effect.tiles_per_pixel == pytest.approx(80 / 1600)
    assert effect.cross_tiles_per_pixel == pytest.approx(2 / 1600)


def test_the_sign_is_kept() -> None:
    """Dragging is the opposite of walking. A sweep that has this backwards
    runs off the edge of the world on its first row and never recovers, which
    looks exactly like a sweep that is working."""
    first = Viewport(at=AT, x=500, y=500, view_lvl=1, objects=600)
    last = Viewport(at=AT, x=420, y=500, view_lvl=1, objects=600)

    assert effect_of(first, last, pixels=400, swipes=4).tiles_per_pixel < 0


def test_a_probe_at_the_wrong_zoom_refuses() -> None:
    """viewLvl 2 returns NO tiles while the game still draws a normal map, so
    a sweep there covers nothing and looks fine doing it."""
    probe = Probe(
        horizontal=_clean("y", 0.05), vertical=_clean("x", 0.05), view_lvl=2, at_x=500, at_y=500
    )

    with pytest.raises(ProbeError, match="viewLvl 2"):
        probe.check()


def test_a_probe_at_the_opening_zoom_refuses() -> None:
    probe = Probe(
        horizontal=_clean("y", 0.05), vertical=_clean("x", 0.05), view_lvl=0, at_x=500, at_y=500
    )

    with pytest.raises(ProbeError, match="not 1"):
        probe.check()


def test_both_axes_driving_one_map_axis_refuses() -> None:
    """This is what a probe taken while something else was panning looks
    like. Planning from it sweeps a line and calls it a map."""
    probe = Probe(
        horizontal=_clean("x", 0.05),
        vertical=_clean("x", 0.05),
        view_lvl=SWEEP_VIEW_LEVEL,
        at_x=500,
        at_y=500,
    )

    with pytest.raises(ProbeError, match="cover a line"):
        probe.check()


def test_a_map_that_did_not_move_refuses() -> None:
    probe = Probe(
        horizontal=_clean("y", 0.0),
        vertical=_clean("x", 0.05),
        view_lvl=SWEEP_VIEW_LEVEL,
        at_x=500,
        at_y=500,
    )

    with pytest.raises(ProbeError, match="moved the map not at all"):
        probe.check()


def test_axes_that_are_not_aligned_refuse_rather_than_drift() -> None:
    """The planner assumes a screen axis drives one map axis. If a device
    ever disagrees — an isometric projection, a rotated map — the sweep must
    say so, not plan rows that wander off their line."""
    probe = Probe(
        horizontal=AxisEffect(axis="y", tiles_per_pixel=0.05, cross_tiles_per_pixel=0.04),
        vertical=_clean("x", 0.05),
        view_lvl=SWEEP_VIEW_LEVEL,
        at_x=500,
        at_y=500,
    )

    with pytest.raises(ProbeError, match="not aligned"):
        probe.check()


def test_a_well_behaved_probe_passes() -> None:
    probe = Probe(
        horizontal=AxisEffect(axis="y", tiles_per_pixel=0.05, cross_tiles_per_pixel=0.002),
        vertical=AxisEffect(axis="x", tiles_per_pixel=-0.05, cross_tiles_per_pixel=-0.001),
        view_lvl=SWEEP_VIEW_LEVEL,
        at_x=446,
        at_y=494,
    )

    probe.check()


def test_the_probe_reports_where_the_camera_ended_up() -> None:
    """The planner starts from where the map IS, not from where a fresh map
    opens — the zoom gesture pans, so by the time a sweep begins the camera
    can be anywhere. It moved (566,341) -> (956,86) once."""
    probe = Probe(
        horizontal=_clean("y", 0.05),
        vertical=_clean("x", 0.05),
        view_lvl=SWEEP_VIEW_LEVEL,
        at_x=956,
        at_y=86,
    )

    probe.check()
    assert (probe.at_x, probe.at_y) == (956, 86)
