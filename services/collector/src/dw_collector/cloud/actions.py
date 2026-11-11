"""The three alliance routines: help, tech donate, gift claim.

Every one starts at the home city and ends there. Every tap follows a look:
a button is pressed only after a named template matched it on the CURRENT
screen, and a screen is entered only after its title template is seen. If a
step does not see what it expects, the action returns a failure and taps
nothing more; the caller backs off and, after repeated failures, switches the
action off. The coordinates for the fixed navigation taps are in
docs/runbooks/cloud-actions.md, with the buttons that must never be pressed.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from dw_collector.cloud import templates
from dw_collector.cloud.device import Device
from dw_collector.cloud.popups import BOTTOM_BAR, ensure_home, is_home
from dw_collector.cloud.vision import Frame, Match, find

ALLIANCE_ICON = (296, 442)
MENU_HELP = (233, 327)
MENU_TECHS = (80, 382)
MENU_GIFTS = (232, 382)
#: The grey (disabled) button is the coloured one desaturated; 0.4 vs ~0.1.
ENABLED_SATURATION = 0.25
MAX_DONATES = 25


@dataclass(frozen=True)
class Result:
    ok: bool
    detail: str = ""
    #: Seconds until this should run again.
    next_in: float = 300.0


@dataclass
class Context:
    device: Device
    sleep: Callable[[float], None] = time.sleep
    settle: float = 2.0
    #: Pause between repeated presses of one button.
    pace: float = 1.5

    def look(self) -> Frame:
        self.sleep(self.settle)
        return self.device.screenshot()

    def seen(self, name: str, frame: Frame | None = None) -> Match | None:
        return find(frame if frame is not None else self.look(), templates.load(name))


class Action(Protocol):
    name: str

    def run(self, ctx: Context) -> Result: ...


def go_home(ctx: Context) -> bool:
    for _ in range(4):
        frame = ctx.device.screenshot()
        if is_home(frame):
            return True
        # Only a back arrow that is actually on screen: on the home city the
        # same spot is the Heroes button.
        arrow = find(frame, templates.load("back_arrow"), region=BOTTOM_BAR)
        if arrow is not None:
            ctx.device.tap(*arrow.center)
        ctx.sleep(ctx.settle)
    return ensure_home(ctx.device, sleep=ctx.sleep).ok


def _open_alliance(ctx: Context, menu: tuple[int, int], title: str) -> str | None:
    """None on success, otherwise why not."""
    home = ctx.device.screenshot()
    if find(home, templates.load("alliance_icon")) is None:
        return "alliance icon not on screen"
    ctx.device.tap(*ALLIANCE_ICON)
    if ctx.seen("alliance_title") is None:
        return "alliance screen did not open"
    ctx.device.tap(*menu)
    if ctx.seen(title) is None:
        return f"{title} did not open"
    return None


class AllianceHelp:
    name = "alliance_help"

    def run(self, ctx: Context) -> Result:
        if (why := _open_alliance(ctx, MENU_HELP, "help_title")) is not None:
            return Result(False, why)
        frame = ctx.look()
        hit = find(frame, templates.load("help_all"), region=BOTTOM_BAR)
        if hit is None:
            # No button means nothing to help; that is the normal case.
            return Result(True, "nothing to help", next_in=180)
        ctx.device.tap(*hit.center)
        ctx.sleep(ctx.settle)
        return Result(True, "helped", next_in=180)


class TechDonate:
    name = "alliance_tech_donate"

    def run(self, ctx: Context) -> Result:
        if (why := _open_alliance(ctx, MENU_TECHS, "techs_title")) is not None:
            return Result(False, why)
        frame = ctx.look()
        thumb = find(frame, templates.load("tech_thumb"))
        if thumb is None:
            return Result(False, "no recommended tech visible")
        ctx.device.tap(*thumb.center)
        pressed = 0
        for _ in range(MAX_DONATES):
            frame = ctx.look()
            button = find(frame, templates.load("donate_teal"))
            if button is None:
                return Result(False, f"donate dialog not showing after {pressed} presses")
            if frame.mean_saturation(button) < ENABLED_SATURATION:
                break
            ctx.device.tap(*button.center)
            pressed += 1
            ctx.sleep(ctx.pace)
        close = find(ctx.look(), templates.load("donate_x"))
        if close is not None:
            ctx.device.tap(*close.center)
        # Out of donations: one comes back every 10 minutes, so look again then.
        return Result(True, f"donated {pressed}", next_in=3600 if pressed else 600)


class GiftClaim:
    name = "alliance_gift_claim"

    def run(self, ctx: Context) -> Result:
        if (why := _open_alliance(ctx, MENU_GIFTS, "gifts_title")) is not None:
            return Result(False, why)
        hit = find(ctx.look(), templates.load("gift_quick_claim"), region=BOTTOM_BAR)
        if hit is None:
            return Result(True, "nothing to claim", next_in=6 * 3600)
        ctx.device.tap(*hit.center)
        # The "Congrats" window closes on a tap of empty ground; Back does too.
        ctx.sleep(ctx.settle)
        return Result(True, "claimed", next_in=6 * 3600)


DEFAULT_ACTIONS: tuple[Action, ...] = (AllianceHelp(), TechDonate(), GiftClaim())
