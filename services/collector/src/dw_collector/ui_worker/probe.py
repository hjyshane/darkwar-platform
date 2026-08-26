"""Work out what a swipe does to this map, on this device, right now.

A sweep has to turn "cover the next patch of ground" into a drag in screen
pixels, which needs to know which map axis a horizontal drag moves, in which
direction, and roughly how far. NONE OF THAT IS A CONSTANT WORTH WRITING
DOWN, and this module exists because trying to write it down failed.

WHAT FAILED. Two careful runs against the live collector, minutes apart,
disagreed about something as basic as which axis a horizontal swipe moves —
the first said map Y, the second said map X. Not a noisy magnitude; the
mapping itself. Two things caused it and both are permanent:

  `world.get.new` is emitted when the camera has drifted far enough that the
  client wants more tiles, not as it moves. Across 117 consecutive viewLvl 1
  pairs the nonzero jumps cluster on 19-22 tiles, and a 300px swipe and a
  700px swipe both report "19".

  Setting the zoom moves the camera. Pinch is two fingers about a centre and
  the game takes the residual as a drag; clamping to max zoom and stepping
  back in moved the camera from (566,341) to (956,86). So a displacement
  measured across a zoom change is the swipe plus an unknown pan.

So the mapping is MEASURED AT THE START OF EVERY SWEEP, after the zoom is
already set and with nothing else touching the device. The coarse signal
stops mattering once several swipes are averaged: the quantum is noise
against four swipes' worth of travel, and only the axis and the sign have to
be right. Magnitude only has to be close enough for the planner's overlap to
absorb, and the coverage view is what says afterwards whether it was.

Re-measuring per run also means the sweep survives things a constant would
not: a different emulator, a resolution change, a zoom the operator set by
hand, a device slow enough to swallow part of a fling.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime

from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.sweep import MAP_COMMAND

#: How many swipes to average over. One is inside the ~19-tile quantum and
#: says almost nothing.
#:
#: FOUR WAS NOT ENOUGH. Three consecutive live runs agreed on both axes and
#: both signs — the thing a plan cannot be wrong about — but their magnitudes
#: ranged over a factor of two: horizontal 0.0238, 0.0238, 0.0356; vertical
#: -0.0375, -0.0238, -0.0488. That is the quantum, not the device: four
#: swipes travel about 80 tiles, so a 19-tile step in or out of the last
#: request is a quarter of the measurement.
#:
#: Eight travels about 160 and halves that to an eighth. It matters in one
#: direction in particular: an over-estimate plans FEWER swipes per row than
#: the row needs, and the shortfall lands as an unswept strip at the far end
#: — 0.0356 planned 34 swipes per row where 0.0238 planned 50.
PROBE_SWIPES = 8

#: The zoom the sweep runs at. 0 returns ~76 tiles per pan and 2 returns
#: NOTHING, so this is the only useful one and a probe that finds anything
#: else has found a reason to stop rather than a number to use.
SWEEP_VIEW_LEVEL = 1

#: The step the pan signal moves in. `world.get.new` fires when the camera has
#: drifted far enough to want more tiles, and across 117 consecutive viewLvl 1
#: pairs the nonzero jumps cluster on 19-22.
PAN_QUANTUM = 19

#: How many of those steps a probe must actually travel before its ratio means
#: anything.
#:
#: A LIVE PROBE ONCE RETURNED 0.0059 tiles/px — a fifth of every other
#: measurement — because the camera moved 19 tiles over eight swipes. That is
#: exactly one quantum: the reading is the resolution floor, indistinguishable
#: from "barely moved", and a ratio computed from it is not a small number but
#: an absent one. It was believed anyway, and planned a route of 2,332 swipes
#: and 140 minutes where a real measurement plans about 700.
#:
#: Three is enough to tell a measurement from a floor without rejecting a
#: genuinely slow device: eight swipes that move anything at all clear it.
MIN_TRAVEL_QUANTA = 3


class ProbeError(RuntimeError):
    """The device did not answer well enough to plan a sweep from."""


@dataclass(frozen=True)
class Viewport:
    """One `world.get.new` as the sweep cares about it."""

    at: datetime
    x: int
    y: int
    view_lvl: int | None
    objects: int


@dataclass(frozen=True)
class AxisEffect:
    """What one screen axis does to the map, as measured."""

    #: "x" or "y" — which MAP axis this screen axis drives.
    axis: str
    #: Tiles per pixel of drag, signed: positive means the map coordinate
    #: rises as the drag's end point rises.
    tiles_per_pixel: float
    #: Tiles moved on the OTHER map axis, per pixel. Near zero when the
    #: screen and map axes line up. Kept because a value that is not near
    #: zero means this model is wrong for this device, and silently planning
    #: with it would produce a sweep that drifts diagonally off its rows.
    cross_tiles_per_pixel: float
    #: Total tiles the camera moved on the dominant axis over the whole probe.
    #: Kept because a RATIO cannot say whether it was measured from anything:
    #: 19 tiles over eight swipes and 160 over eight are both a number, and
    #: only one of them means something. See `MIN_TRAVEL_QUANTA`.
    tiles_moved: float = 0.0

    @property
    def clean(self) -> bool:
        """Whether the cross term is small enough to plan on one axis."""
        if self.tiles_per_pixel == 0:
            return False
        return abs(self.cross_tiles_per_pixel / self.tiles_per_pixel) < 0.35


def parse_viewports(payloads: list[tuple[datetime, str]]) -> list[Viewport]:
    """Decode what the journal holds into positions, skipping what it cannot.

    A payload missing `x` or `y` is not an error to raise — the game sends
    the odd malformed frame and one of them must not abort a sweep — but it
    is also not a position, so it is dropped rather than defaulted. A
    defaulted 0,0 would read as an enormous pan to the map's corner.
    """
    out: list[Viewport] = []
    for at, raw in payloads:
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            continue
        x, y = body.get("x"), body.get("y")
        if not isinstance(x, int) or not isinstance(y, int):
            continue
        points = body.get("points")
        view_lvl = body.get("viewLvl")
        out.append(
            Viewport(
                at=at,
                x=x,
                y=y,
                view_lvl=view_lvl if isinstance(view_lvl, int) else None,
                objects=len(points) if isinstance(points, list) else 0,
            )
        )
    return out


def effect_of(first: Viewport, last: Viewport, pixels: int, swipes: int) -> AxisEffect:
    """Reduce a probe's start and end into one axis's behaviour.

    The dominant axis wins outright rather than being blended: the sweep pans
    along one map axis at a time, and a model that spreads each swipe over
    both would plan rows that drift.
    """
    travelled = pixels * swipes
    dx = (last.x - first.x) / travelled
    dy = (last.y - first.y) / travelled
    if abs(last.x - first.x) >= abs(last.y - first.y):
        return AxisEffect(
            axis="x",
            tiles_per_pixel=dx,
            cross_tiles_per_pixel=dy,
            tiles_moved=abs(last.x - first.x),
        )
    return AxisEffect(
        axis="y",
        tiles_per_pixel=dy,
        cross_tiles_per_pixel=dx,
        tiles_moved=abs(last.y - first.y),
    )


@dataclass(frozen=True)
class Probe:
    """Both screen axes, measured on the device this sweep will run on."""

    horizontal: AxisEffect
    vertical: AxisEffect
    view_lvl: int
    #: The camera when the probe finished, so the planner knows where it is
    #: starting from rather than assuming the map opens centred.
    at_x: int
    at_y: int

    def check(self) -> None:
        """Refuse to plan from a probe that does not describe a sweepable map.

        Every one of these is a way a sweep could run to completion and
        collect nothing while reporting success, which is the failure this
        whole path exists to make impossible.
        """
        if self.view_lvl != SWEEP_VIEW_LEVEL:
            msg = (
                f"map is at viewLvl {self.view_lvl}, not {SWEEP_VIEW_LEVEL};"
                " 0 returns a tenth of the tiles and 2 returns none at all"
            )
            raise ProbeError(msg)
        if self.horizontal.axis == self.vertical.axis:
            msg = (
                f"both screen axes appear to move map {self.horizontal.axis};"
                " a sweep planned from this would cover a line, not a map"
            )
            raise ProbeError(msg)
        for name, effect in (("horizontal", self.horizontal), ("vertical", self.vertical)):
            if effect.tiles_per_pixel == 0:
                msg = f"{name} swipes moved the map not at all; is the map on screen?"
                raise ProbeError(msg)
            if effect.tiles_moved < PAN_QUANTUM * MIN_TRAVEL_QUANTA:
                msg = (
                    f"{name} swipes moved the map only {effect.tiles_moved:.0f} tiles,"
                    f" within {PAN_QUANTUM * MIN_TRAVEL_QUANTA} of the pan signal's own"
                    f" {PAN_QUANTUM}-tile step; that is the resolution floor, not a"
                    " measurement. Is the camera against an edge?"
                )
                raise ProbeError(msg)
            if not effect.clean:
                msg = (
                    f"{name} swipes move map {effect.axis} by"
                    f" {effect.tiles_per_pixel:.4f} tiles/px but also move the other axis by"
                    f" {effect.cross_tiles_per_pixel:.4f}; the screen and map axes are not"
                    " aligned on this device and the planner assumes they are"
                )
                raise ProbeError(msg)


def settled(
    journal: Journal, mark: int, since: datetime, want: int, timeout: float
) -> list[Viewport]:
    """Wait for the journal to show the pans a probe just caused.

    NOT INSTANT, and the delay is structural rather than a tuning problem:
    dumpcap closes a capture file on a timer and the reader follows it, so a
    packet is journalled some tens of seconds after it was on the wire. The
    probe waits that out once per sweep instead of pretending the journal is
    live.
    """
    deadline = time.monotonic() + timeout
    seen: list[Viewport] = []
    while time.monotonic() < deadline:
        seen = parse_viewports(journal.payloads_after(mark, MAP_COMMAND, since))
        if len(seen) >= want:
            return seen
        time.sleep(2.0)
    return seen
