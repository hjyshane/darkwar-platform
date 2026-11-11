"""Get from wherever the game is to the home city, closing what is in the way.

A login can throw up no popups or seven, and which ones changes from day to
day (on 2026-11-11 alone: an "isn't responding" dialog, two paid-offer panels,
an event alert, a notification prompt). So this is a loop, not a script: look,
do ONE safe thing for a screen it knows, look again, until the home city is on
screen.

"Safe" is the whole design. Panels in this game put a price button next to the
close button, and the dismiss that works differs per popup: some take a corner
X, one ignores both X and Back and closes on a tap of empty ground. So each
known popup is matched by a template and gets its own dismissal, and nothing
that is not a known popup is ever tapped. A screen the loop does not know gets
the Back key at most, then the loop gives up and keeps the screenshot so a
person can teach it the new popup.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import structlog

from dw_collector.cloud import templates
from dw_collector.cloud.device import Device
from dw_collector.cloud.vision import Frame, find

log = structlog.get_logger()

#: Where the bottom bar sits; searching only there is faster and cannot be
#: fooled by anything in the city.
BOTTOM_BAR = (0, 560, 320, 640)
#: Empty ground that closes the "tap anywhere" popups. Nothing sits here on a
#: popup, and it is NOT safe on a normal screen (it is next to Combat/Claim).
TAP_AWAY = (160, 610)


@dataclass(frozen=True)
class Closer:
    template: str
    #: "tap" the match, "tap_away", or "back".
    how: str = "tap"


#: Order matters: the first template that matches wins.
CLOSERS = (
    Closer("anr_wait"),
    Closer("selena_cancel"),
    Closer("shop_x"),
    Closer("miasma_title", "tap_away"),
    # The tech donate dialog, left open if a run died between its presses.
    Closer("donate_x"),
)


def is_home(frame: Frame) -> bool:
    # Either button: the Heroes icon animates and drops below the bar on some
    # frames, and a false "not home" here made go_home tap that very spot.
    return any(
        find(frame, templates.load(n), region=BOTTOM_BAR) is not None for n in templates.HOME
    )


@dataclass
class HomeResult:
    ok: bool
    steps: int = 0
    closed: list[str] = field(default_factory=list)
    saved: list[Path] = field(default_factory=list)


def ensure_home(
    device: Device,
    *,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    max_steps: int = 20,
    max_seconds: float = 240.0,
    settle_seconds: float = 4.0,
    unknown_dir: Path | None = None,
) -> HomeResult:
    """Close known popups until home is showing. `ok` False means it gave up."""
    result = HomeResult(ok=False)
    deadline = clock() + max_seconds
    unknown_streak = 0
    backed = False
    while result.steps < max_steps and clock() < deadline:
        frame = device.screenshot()
        if is_home(frame):
            result.ok = True
            return result
        result.steps += 1
        closer = next(
            (c for c in CLOSERS if find(frame, templates.load(c.template)) is not None), None
        )
        if closer is not None:
            unknown_streak, backed = 0, False
            result.closed.append(closer.template)
            if closer.how == "tap_away":
                device.tap(*TAP_AWAY)
            else:
                match = find(frame, templates.load(closer.template))
                if match is not None:
                    device.tap(*match.center)
            sleep(settle_seconds)
            continue
        arrow = find(frame, templates.load("back_arrow"), region=BOTTOM_BAR)
        if arrow is not None:
            # An inner screen (alliance, heroes, ...): its own back arrow leaves
            # it. The Android Back key does not in this game.
            unknown_streak, backed = 0, False
            result.closed.append("back_arrow")
            device.tap(*arrow.center)
            sleep(settle_seconds)
            continue
        unknown_streak += 1
        if unknown_dir is not None:
            result.saved.append(_save(unknown_dir, frame, result.steps))
        # First an unknown screen may just be loading: wait. Then Back, once.
        # Then it is not something this loop understands.
        if unknown_streak <= 2:
            sleep(settle_seconds)
            continue
        if not backed:
            backed = True
            device.back()
            sleep(settle_seconds)
            continue
        log.warning("cloud.home_unreachable", steps=result.steps, closed=result.closed)
        return result
    log.warning("cloud.home_timeout", steps=result.steps, closed=result.closed)
    return result


def _save(directory: Path, frame: Frame, step: int) -> Path:
    from PIL import Image

    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"unknown_{int(time.time())}_{step}.png"
    if frame.rgb is not None:
        Image.fromarray(frame.rgb.astype("uint8")).save(path)
    return path
