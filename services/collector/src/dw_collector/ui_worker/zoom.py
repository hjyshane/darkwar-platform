"""Pinch-zoom, because the sweep's zoom cannot be left to whoever used it last.

`viewLvl` 1 is the only zoom worth sweeping at: 0 returns about 76 tiles per
pan and 2 RETURNS NONE AT ALL — 15 requests, zero points every time, while
the game goes on drawing a perfectly normal map. A sweep that started at 2
would swipe its whole route, see every step succeed, and collect nothing.

`input swipe` is single-touch and cannot express a pinch, so this writes the
touchscreen directly. On BlueStacks that needs no root: `/dev/input/event4`
is "BlueStacks Virtual Touch", `crw-rw---- root:input`, and adb's `shell`
user is in group `input`. It reports ABS_MT_POSITION_X/Y and NO ABS_MT_SLOT,
which makes it multitouch protocol A — per finger a position pair followed by
SYN_MT_REPORT, then one SYN_REPORT to close the frame. Verified against the
live collector: a pinch built this way moved it from viewLvl 0 to 1 to 2.

TWO THINGS THIS DOES NOT DO.

It does not count zoom steps. The operator's own procedure is "six out, three
back in", but those are the game's UI steps and one gesture here is worth an
unknown number of them — a single pinch took the collector from 0 to 1. So
the way back to a known zoom is to clamp (zoom out until it stops changing,
which is free because it stops) and then step in and CHECK, never to count.

It does not preserve position. Two fingers about a centre still leave a
residual the game takes as a drag: clamping to max and stepping back in moved
the camera from (566,341) to (956,86). Anything that needs to know where the
camera is must ask after the zoom is finished, not before.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass

from dw_collector.ui_worker.guard import AdbPolicy

#: The multitouch device BlueStacks exposes. Named rather than discovered
#: because writing to the wrong input device is not a thing to do on a guess.
TOUCH_DEVICE = "/dev/input/event4"

#: Linux input constants. EV_ABS/EV_SYN and the protocol A reports.
_EV_ABS = 3
_EV_SYN = 0
_ABS_MT_POSITION_X = 53
_ABS_MT_POSITION_Y = 54
_SYN_MT_REPORT = 2
_SYN_REPORT = 0

#: The device reports positions in this range regardless of resolution.
_TOUCH_MAX = 32767

_NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW


@dataclass(frozen=True)
class Screen:
    width: int
    height: int

    def to_touch(self, x: float, y: float) -> tuple[int, int]:
        tx = int(max(0.0, min(1.0, x / self.width)) * _TOUCH_MAX)
        ty = int(max(0.0, min(1.0, y / self.height)) * _TOUCH_MAX)
        return tx, ty


def _frame(screen: Screen, one: tuple[float, float], two: tuple[float, float]) -> str:
    """One multitouch frame: two fingers, protocol A."""
    ax, ay = screen.to_touch(*one)
    bx, by = screen.to_touch(*two)
    dev = TOUCH_DEVICE
    return (
        f"sendevent {dev} {_EV_ABS} {_ABS_MT_POSITION_X} {ax};"
        f"sendevent {dev} {_EV_ABS} {_ABS_MT_POSITION_Y} {ay};"
        f"sendevent {dev} {_EV_SYN} {_SYN_MT_REPORT} 0;"
        f"sendevent {dev} {_EV_ABS} {_ABS_MT_POSITION_X} {bx};"
        f"sendevent {dev} {_EV_ABS} {_ABS_MT_POSITION_Y} {by};"
        f"sendevent {dev} {_EV_SYN} {_SYN_MT_REPORT} 0;"
        f"sendevent {dev} {_EV_SYN} {_SYN_REPORT} 0;"
    )


def _release() -> str:
    """All fingers up: an empty frame, then close it.

    In protocol A "no fingers" is a SYN_MT_REPORT carrying no position, which
    is why this is not simply the last frame repeated.
    """
    return (
        f"sendevent {TOUCH_DEVICE} {_EV_SYN} {_SYN_MT_REPORT} 0;"
        f"sendevent {TOUCH_DEVICE} {_EV_SYN} {_SYN_REPORT} 0;"
    )


def pinch_script(
    screen: Screen,
    centre: tuple[float, float],
    from_radius: float,
    to_radius: float,
    steps: int = 12,
) -> str:
    """The whole gesture as ONE shell command.

    One command rather than one per event on purpose: each `adb shell` costs
    tens of milliseconds to spawn, and a gesture assembled from ~90 of them
    arrives as a slideshow the game reads as a series of taps rather than a
    drag.
    """
    cx, cy = centre
    parts = []
    # steps=0 is one frame at from_radius — a two-finger touch that does not
    # travel. Not useful as a gesture, but it is the shape the geometry
    # assertions want, and dividing by it is a crash rather than a no-op.
    span = max(steps, 1)
    for index in range(steps + 1):
        radius = from_radius + (to_radius - from_radius) * index / span
        parts.append(_frame(screen, (cx - radius, cy - radius), (cx + radius, cy + radius)))
    parts.append(_release())
    return "".join(parts)


def out_script(screen: Screen, centre: tuple[float, float], spread: float) -> str:
    """Fingers together: zoom out."""
    return pinch_script(screen, centre, spread, spread * 0.2)


def in_script(screen: Screen, centre: tuple[float, float], spread: float) -> str:
    """Fingers apart: zoom in."""
    return pinch_script(screen, centre, spread * 0.2, spread)


def send(adb: str, policy: AdbPolicy, serial: str, script: str, timeout: float = 120.0) -> None:
    """Run a gesture, through the guard.

    The guard is not decoration here. This module writes raw touch events to
    a device's screen, which is the single most damaging thing this codebase
    can do to the wrong emulator, and `check_target` is what keeps it off the
    main account.
    """
    target = policy.check_target(serial)
    subprocess.run(
        [adb, "-s", target, "shell", script],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        creationflags=_NO_WINDOW,
    )
