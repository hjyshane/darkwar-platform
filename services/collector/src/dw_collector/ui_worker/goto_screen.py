"""Drive the game's position box: look at the screen, then tap.

The flow, measured on the collector's BlueStacks (1080x1920, game 1.250.672,
2026-11-18):

  1. Zoomed out to viewLvl 1 the world map shows a bar at the bottom:
     a magnifier, "#580 (492,929)", a bookmark star. The bar is NOT there at
     the zoom the map opens on, and every jump drops back to that zoom.
  2. The magnifier opens "World" (`UIPositionTip`): State, X and Y, prefilled
     with where the camera is, and a Go button.
  3. Tapping a field opens Android's text bar at the bottom with the old value
     selected, so typing replaces it; its OK commits.
  4. Go moves the camera there - other servers too, inside the cluster - and
     the client sends `world.get.new` for exactly that x,y. At viewLvl 0.
  5. Twelve wheel notches put it back at viewLvl 1. Seven are enough from the
     opening zoom and nineteen still were, so twelve sits in the middle.

EVERY TAP IS PRECEDED BY A LOOK. The fields and the Go button are fixed
coordinates inside the window, so a tap is only sent once a screenshot shows
that window (or that text bar). The map around it is full of things one tap
from an action: a tile opens Build / Teleport / March, a monster Rally, a
truck Loot, and all three were opened by stray input while this was being
measured.

POPUPS ARE CLOSED THE WAY cloud/popups.py CLOSES THEM: only with something
known to close. A run is hours long and the game throws up event panels and
dialogs on its own, so `ready` does not give up on the first strange screen.
It works down a ladder - an X button (the common popup frame's, which the
World window uses too), a full-screen window's bottom-left back arrow, the
Android text bar, the zoom, then waiting for a transient screen - looking
again after every rung. If the ladder runs out, the screenshot is saved and
the caller decides whether to wait and try again.

NOT THE BACK KEY, except for Android's own text bar. In the game it does not
close windows (the operator, 2026-11-18; cloud/popups.py found the same), and
on a bare map it is a quit dialog waiting to happen.

NOT "TAP EMPTY GROUND" EITHER, though that is how the game closes a tile or
monster menu. At sweep zoom the map is covered in cities, monsters and trucks,
so no fixed point is empty, and a tap that lands on something opens the next
menu. Tap-away belongs to a popup this module has a template for, with a spot
measured for it - added as real popups turn up in the saved screenshots, the
way cloud/popups.py grew its CLOSERS. Nothing unrecognised is tapped: panels
in this game put a price button beside their close button.

The star beside the magnifier adds a bookmark; it is never tapped.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from dw_collector.cloud.vision import Frame, Template, find
from dw_collector.ui_worker.adb import AdbClient
from dw_collector.ui_worker.goto import Target

TEMPLATES = Path(__file__).parent / "templates"

#: The screen the coordinates below were read from. A different size means a
#: different layout, and tapping these numbers on it would be tapping blind.
SCREEN = (1080, 1920)

#: Every template scored 0.99-1.00 on the screens it was cut from and at most
#: 0.50 on the 33 others taken while measuring, so the bar sits well clear of
#: both.
THRESHOLD = 0.85


@dataclass(frozen=True)
class Look:
    """A template and where on the screen it is looked for: (x0, y0, x1, y1)."""

    template: str
    region: tuple[int, int, int, int]


BAR = Look("goto_bar_magnifier", (300, 1660, 480, 1800))
WINDOW = Look("goto_window_title", (400, 690, 680, 820))
GO_BUTTON = Look("goto_window_go", (400, 1100, 680, 1260))
ENTRY = Look("goto_entry_ok", (900, 1800, 1080, 1920))
#: The X of the World window, and of other windows drawn the same way. Looked
#: for anywhere; on the 33 measuring screens it scored 1.00 only on the World
#: window and at most 0.53 elsewhere.
CLOSE_X = Look("goto_close_x", (0, 0, 1080, 1920))
#: The back arrow full-screen windows carry bottom-left (bookmarks, event
#: panels): 1.00 on both seen, at most 0.55 elsewhere.
BACK_ARROW = Look("goto_back_arrow", (0, 1720, 260, 1920))

MAGNIFIER = (390, 1735)
STATE_FIELD = (634, 887)
X_FIELD = (634, 956)
Y_FIELD = (634, 1025)
GO = (540, 1185)
CLOSE = (875, 755)
ENTRY_OK = (998, 1868)

#: Where the wheel turns: open map above the window's footprint. The pointer
#: only hovers there; nothing is pressed.
WHEEL_AT = (540, 700)
WHEEL_NOTCHES = -12


class ScreenError(RuntimeError):
    """The screen is not one this module knows how to touch. Not retried."""

    def __init__(self, message: str, shot: Path | None = None) -> None:
        super().__init__(message if shot is None else f"{message} (screenshot: {shot})")
        self.shot = shot


@dataclass(frozen=True)
class Timing:
    """Pauses, in seconds, and how many looks a screen gets to appear.

    Waiting for a window is done by LOOKING AGAIN, not by sleeping long
    enough: a look costs about 0.9s anyway, so a screen that is already up is
    used at once and a slow one gets `looks` chances. Fixed sleeps sized for
    the slowest case made a jump 14.6s, which is 6.5 hours a cluster.
    """

    after_type: float = 0.2
    after_ok: float = 0.3
    after_go: float = 1.5
    after_wheel: float = 0.5
    between_looks: float = 0.2
    looks: int = 3
    #: After closing something, and while waiting out a screen that may be
    #: loading: long enough for a panel to animate away.
    settle: float = 3.0
    #: How many times `ready` waits out an unknown screen before giving up.
    waits: int = 2


class GotoScreen:
    def __init__(
        self,
        client: AdbClient,
        *,
        shots: Path | None = None,
        timing: Timing | None = None,
        sleep: Callable[[float], None] = time.sleep,
        capture: Callable[[], Frame] | None = None,
    ) -> None:
        self.client = client
        self.shots = shots
        self.timing = timing or Timing()
        self._sleep = sleep
        self._capture = capture or self._screencap
        self._templates: dict[str, Template] = {}
        self.last_frame: Frame | None = None

    # -- looking ---------------------------------------------------------

    def _screencap(self) -> Frame:
        width, height, pixels = self.client.screencap_raw()
        rgb = np.frombuffer(pixels, dtype=np.uint8).reshape(height, width, 4)[:, :, :3]
        # The weights PIL's "L" uses, so templates cut with PIL score the same.
        gray = rgb @ np.array([0.299, 0.587, 0.114])
        return Frame(gray, rgb)

    def frame(self) -> Frame:
        frame = self._capture()
        if frame.size != SCREEN:
            msg = f"screen is {frame.size[0]}x{frame.size[1]}, layout was measured on {SCREEN}"
            raise ScreenError(msg)
        self.last_frame = frame
        return frame

    def _template(self, name: str) -> Template:
        if name not in self._templates:
            self._templates[name] = Template.from_file(TEMPLATES / f"{name}.png", THRESHOLD)
        return self._templates[name]

    def sees(self, frame: Frame, look: Look) -> bool:
        return find(frame, self._template(look.template), region=look.region) is not None

    def expect(self, *looks: Look) -> Frame | None:
        """Look until every one of `looks` is on screen; None if they never are."""
        for attempt in range(self.timing.looks):
            if attempt:
                self._sleep(self.timing.between_looks)
            frame = self.frame()
            if all(self.sees(frame, look) for look in looks):
                return frame
        return None

    def _fail(self, message: str) -> ScreenError:
        shot = None
        if self.shots is not None and self.last_frame is not None:
            from PIL import Image

            self.shots.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            shot = self.shots / f"goto-{stamp}.png"
            rgb = self.last_frame.rgb
            if rgb is not None:
                Image.fromarray(rgb.astype("uint8")).save(shot)
            else:  # pragma: no cover - frames from screencap always carry colour
                shot = None
        return ScreenError(message, shot)

    # -- acting ----------------------------------------------------------

    def zoom_out(self) -> None:
        self.client.wheel(*WHEEL_AT, WHEEL_NOTCHES, width=SCREEN[0], height=SCREEN[1])
        self._sleep(self.timing.after_wheel)

    def ready(self) -> None:
        """Get to the map with the magnifier bar showing, or fail.

        One rung of the ladder (module docstring) per look, so every action is
        decided on a fresh screenshot, and each rung that cannot repeat
        harmlessly is used once.
        """
        zoomed = False
        waited = 0
        for _ in range(12):
            frame = self.frame()
            if self.sees(frame, BAR):
                return
            closer = find(frame, self._template(CLOSE_X.template), region=CLOSE_X.region)
            if closer is None:
                closer = find(frame, self._template(BACK_ARROW.template), region=BACK_ARROW.region)
            if closer is not None:
                self.client.tap(*closer.center)
                self._sleep(self.timing.settle)
                continue
            if self.sees(frame, ENTRY):
                # Android's own text bar, not a game window: Back dismisses it
                # and presses nothing.
                self.client.back()
                self._sleep(self.timing.after_ok)
                continue
            if not zoomed:
                zoomed = True
                self.zoom_out()
                continue
            if waited < self.timing.waits:
                waited += 1
                self._sleep(self.timing.settle)
                continue
            break
        raise self._fail("no magnifier bar, and nothing on screen this knows how to close")

    def _type(self, field: tuple[int, int], value: int) -> None:
        self.client.tap(*field)
        if self.expect(ENTRY) is None:
            raise self._fail(f"tapped a field at {field} and no text bar opened")
        self.client.text(str(value))
        self._sleep(self.timing.after_type)
        self.client.tap(*ENTRY_OK)
        self._sleep(self.timing.after_ok)

    def jump(self, target: Target, *, current_server: int | None) -> bool:
        """Move the camera to `target` and zoom back out.

        Returns False when the client would not go - Go pressed and the window
        still up, which is what a server outside the cluster looks like - and
        closes the window so the next jump starts clean.

        FOUR LOOKS A JUMP, not seven. Each costs most of a second, and a run is
        1,610 jumps. The ones kept are the ones a wrong tap hangs on: the map
        before the magnifier, the window before its fields, and the text bar
        before each number is typed. Whether Go was refused is only asked on a
        server's first jump - refusal is per server - and a window Go left open
        anyway is closed by the next jump's `ready`.
        """
        self.ready()
        self.client.tap(*MAGNIFIER)
        if self.expect(WINDOW, GO_BUTTON) is None:
            raise self._fail("tapped the magnifier and the World window did not open")
        if target.server != current_server:
            self._type(STATE_FIELD, target.server)
        self._type(X_FIELD, target.x)
        self._type(Y_FIELD, target.y)
        self.client.tap(*GO)
        self._sleep(self.timing.after_go)
        if target.server != current_server and self.sees(self.frame(), WINDOW):
            self.client.tap(*CLOSE)
            self._sleep(self.timing.after_ok)
            return False
        self.zoom_out()
        return True
