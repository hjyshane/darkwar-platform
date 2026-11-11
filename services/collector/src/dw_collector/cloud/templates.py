"""The icons the cloud routines look for, cropped from the emulator's own screen.

Each PNG in `templates/` was cut from a 320x640 screenshot of the emulator
(160 dpi). They only match at that size: change the AVD's resolution and they
all have to be cut again. Pieces that change from login to login (a red badge,
a countdown) are deliberately left out of the crop.

Thresholds were set by matching every template against every screenshot taken
on 2026-11-11: a real hit scored 0.90-1.00, and the worst false positive for
each name is noted. A name that is looked for next to a look-alike (the two
green buttons) keeps a high bar.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

from dw_collector.cloud.vision import DEFAULT_THRESHOLD, Template

DIRECTORY = Path(__file__).parent / "templates"

THRESHOLDS: dict[str, float] = {
    # Looks like other tickets/scrolls on neighbouring buildings (0.83 seen).
    "radio_ticket": 0.88,
    # Same icon, scored 0.87 on a home view where the camera sat differently.
    "scroll_icon": 0.84,
    # The two green buttons score 0.78-0.79 on each other.
    "help_all": 0.9,
    "gift_quick_claim": 0.9,
    # 0.99+ where the arrow is, up to 0.79 on city views.
    "back_arrow": 0.88,
}

#: Home is where both bottom-bar buttons are visible and undimmed.
HOME = ("home_heroes", "home_world")


@cache
def load(name: str) -> Template:
    path = DIRECTORY / f"{name}.png"
    if not path.is_file():
        msg = f"no template named {name!r} in {DIRECTORY}"
        raise KeyError(msg)
    return Template.from_file(path, THRESHOLDS.get(name, DEFAULT_THRESHOLD))


def names() -> list[str]:
    return sorted(p.stem for p in DIRECTORY.glob("*.png"))
