"""The pinch gesture, as a string rather than as a device.

Protocol A is easy to get subtly wrong in ways that read as a tap instead of
a pinch, and a tap on the world map opens whatever was under it. So the frame
structure is asserted directly.
"""

from __future__ import annotations

import pytest

from dw_collector.ui_worker import zoom
from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy

SCREEN = zoom.Screen(width=1080, height=1920)


def test_a_frame_reports_two_fingers_then_closes() -> None:
    """Protocol A: each finger's position ends with SYN_MT_REPORT, and one
    SYN_REPORT closes the frame. Miss the second SYN_MT_REPORT and the game
    sees one finger — a drag, not a pinch."""
    script = zoom.pinch_script(SCREEN, (540, 900), 300, 60, steps=1)

    frames = [f for f in script.split("sendevent /dev/input/event4 0 0 0;") if f]
    # steps=1 means two frames, plus the release.
    assert len(frames) == 3
    first = frames[0]
    assert first.count("sendevent /dev/input/event4 0 2 0;") == 2


def test_the_release_carries_no_position() -> None:
    """All fingers up is an EMPTY multitouch report. Repeating the last
    position instead leaves a finger down forever."""
    script = zoom.pinch_script(SCREEN, (540, 900), 300, 60, steps=1)

    tail = script[script.rindex("sendevent /dev/input/event4 0 2 0;") :]

    assert "53" not in tail
    assert "54" not in tail


def test_positions_are_device_units_not_pixels() -> None:
    """The touchscreen reports 0..32767 whatever the resolution is. Sending
    pixels puts every touch in the top-left corner of a 1080-wide screen."""
    script = zoom.pinch_script(SCREEN, (540, 960), 0, 0, steps=0)

    # Dead centre of the screen is the middle of the range, twice over.
    assert script.count("53 16383") == 2
    assert script.count("54 16383") == 2


def test_a_touch_outside_the_screen_is_clamped() -> None:
    """A pinch centred near an edge would otherwise ask for a negative
    coordinate, which the device reads as a huge positive one."""
    script = zoom.pinch_script(SCREEN, (50, 50), 300, 300, steps=0)

    assert "-" not in script


def test_out_brings_the_fingers_together_and_in_pushes_them_apart() -> None:
    def spread(script: str) -> tuple[int, int]:
        xs = [
            int(p.split()[-1])
            for p in script.split(";")
            if p.strip().endswith(tuple("0123456789")) and " 53 " in p
        ]
        return abs(xs[1] - xs[0]), abs(xs[-2] - xs[-1])

    start_out, end_out = spread(zoom.out_script(SCREEN, (540, 900), 300))
    start_in, end_in = spread(zoom.in_script(SCREEN, (540, 900), 300))

    assert start_out > end_out
    assert start_in < end_in


def test_the_whole_gesture_is_one_command() -> None:
    """Assembled from one adb call per event, a pinch arrives as a slideshow
    the game reads as taps. ~90 spawns at tens of ms each is the difference."""
    script = zoom.pinch_script(SCREEN, (540, 900), 300, 60)

    assert "\n" not in script
    assert script.count("sendevent") > 50


def test_sending_a_gesture_goes_through_the_guard() -> None:
    """This module writes raw touch events to a screen, which is the worst
    thing this codebase could aim at the main account."""
    policy = AdbPolicy(
        collector_serial="127.0.0.1:5585",
        denylist=frozenset({"127.0.0.1:5557"}),
        enumerated=True,
    )

    with pytest.raises(AdbGuardError, match="denylisted"):
        zoom.send("adb", policy, "127.0.0.1:5557", "sendevent x")
