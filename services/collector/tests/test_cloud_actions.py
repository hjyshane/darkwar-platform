from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from dw_collector.cloud import actions, templates
from dw_collector.cloud.routines import run_due
from dw_collector.cloud.schedule import Schedule
from dw_collector.cloud.vision import Frame


def _paste(canvas: np.ndarray, name: str, x: int, y: int, *, grey: bool = False) -> None:
    img = Image.open(templates.DIRECTORY / f"{name}.png").convert("RGB")
    if grey:
        img = img.convert("L").convert("RGB")
    arr = np.asarray(img, dtype=np.uint8)
    h, w = arr.shape[:2]
    canvas[y : y + h, x : x + w] = arr


def _screen(*items: tuple[str, int, int]) -> Frame:
    rng = np.random.default_rng(3)
    canvas = rng.integers(0, 255, size=(640, 320, 3)).astype(np.uint8)
    for name, x, y in items:
        _paste(canvas, name, x, y)
    return Frame.from_image(Image.fromarray(canvas))


HOME = (("home_heroes", 5, 570), ("home_world", 110, 570), ("alliance_icon", 270, 420))


class FakeGame:
    """Three screens: home -> alliance -> (help | techs | gifts)."""

    def __init__(self, *, help_button: bool = True, donates: int = 3) -> None:
        self.where = "home"
        self.taps: list[tuple[int, int]] = []
        self.help_button = help_button
        self.donates_left = donates
        self.donated = 0
        self.helped = 0

    def screenshot(self) -> Frame:
        w = self.where
        if w == "home":
            return _screen(*HOME)
        if w == "alliance":
            return _screen(("alliance_title", 100, 10), ("back_arrow", 8, 590))
        if w == "help":
            extra = (("help_all", 100, 565),) if self.help_button else ()
            return _screen(("help_title", 100, 10), ("back_arrow", 8, 590), *extra)
        if w == "techs":
            return _screen(
                ("techs_title", 100, 10), ("tech_thumb", 20, 200), ("back_arrow", 8, 590)
            )
        if w == "donate":
            canvas = _screen(("donate_x", 270, 150)).rgb
            assert canvas is not None
            arr = canvas.astype(np.uint8)
            _paste(arr, "donate_teal", 180, 450, grey=self.donates_left == 0)
            return Frame.from_image(Image.fromarray(arr))
        return _screen()

    def tap(self, x: int, y: int) -> None:
        self.taps.append((x, y))
        w = self.where
        if w == "home" and abs(x - 296) < 20 and abs(y - 442) < 30:
            self.where = "alliance"
        elif w == "alliance" and y < 500:
            self.where = {233: "help", 80: "techs"}.get(x, self.where)
        elif w == "help" and y > 570 and x > 60:
            self.helped += 1
        elif w == "techs" and x < 100 and 200 < y < 260:
            self.where = "donate"
        elif w == "donate" and x > 260 and y < 200:
            self.where = "techs"
        elif w == "donate" and self.donates_left > 0:
            self.donates_left -= 1
            self.donated += 1
        elif x < 40 and y > 590:
            self.where = {"help": "alliance", "techs": "alliance", "alliance": "home"}.get(
                self.where, self.where
            )

    def drag(self, x1: int, y1: int, x2: int, y2: int) -> None:
        pass

    def back(self) -> None:
        self.where = "home"


def _ctx(game: FakeGame) -> actions.Context:
    return actions.Context(game, sleep=lambda _s: None)


def test_help_taps_the_matched_button_and_returns_home() -> None:
    game = FakeGame()
    ctx = _ctx(game)
    result = actions.AllianceHelp().run(ctx)
    assert result.ok and result.detail == "helped"
    assert game.helped == 1
    assert actions.go_home(ctx)
    assert game.where == "home"


def test_help_with_no_button_is_a_quiet_success() -> None:
    game = FakeGame(help_button=False)
    result = actions.AllianceHelp().run(_ctx(game))
    assert result.ok and result.detail == "nothing to help"
    assert game.helped == 0


def test_donate_stops_when_the_button_goes_grey() -> None:
    game = FakeGame(donates=3)
    result = actions.TechDonate().run(_ctx(game))
    assert result.ok and result.detail == "donated 3"
    assert game.donated == 3
    # Never the gem button.
    assert (98, 466) not in game.taps


def test_wrong_screen_fails_without_tapping_further() -> None:
    game = FakeGame()
    game.where = "somewhere_else"
    result = actions.AllianceHelp().run(_ctx(game))
    assert not result.ok
    assert game.taps == []


def test_schedule_backs_off_and_disables_after_three_failures(tmp_path: Path) -> None:
    sched = Schedule(tmp_path / "s.db")
    assert sched.is_due("a", 0)
    assert not sched.failed("a", 100, "x")
    assert not sched.is_due("a", 101)
    assert not sched.failed("a", 1000, "x")
    assert sched.failed("a", 5000, "x")
    assert not sched.is_due("a", 10**9)
    sched.enable("a")
    assert sched.is_due("a", 0)
    sched.succeeded("a", 10, 60)
    assert not sched.is_due("a", 69) and sched.is_due("a", 70)


def test_schedule_survives_reopen(tmp_path: Path) -> None:
    Schedule(tmp_path / "s.db").succeeded("a", 0, 500)
    assert not Schedule(tmp_path / "s.db").is_due("a", 100)


def test_run_due_runs_each_once_then_waits(tmp_path: Path) -> None:
    game = FakeGame(donates=0)
    sched = Schedule(tmp_path / "s.db")
    now = [1000.0]
    kw = {"clock": lambda: now[0], "sleep": lambda _s: None}
    first = run_due(game, sched, actions=[actions.AllianceHelp()], **kw)  # type: ignore[arg-type]
    assert first == ["alliance_help"]
    assert run_due(game, sched, actions=[actions.AllianceHelp()], **kw) == []  # type: ignore[arg-type]
    now[0] += 200
    assert run_due(game, sched, actions=[actions.AllianceHelp()], **kw) == ["alliance_help"]  # type: ignore[arg-type]
    assert game.where == "home"


def test_run_due_disables_a_failing_action_and_alerts(tmp_path: Path) -> None:
    game = FakeGame()
    sched = Schedule(tmp_path / "s.db")
    now = [0.0]
    alerts: list[tuple[str, str]] = []

    class Broken:
        name = "broken"

        def run(self, ctx: actions.Context) -> actions.Result:
            return actions.Result(False, "no")

    for _ in range(3):
        now[0] += 10**5
        run_due(
            game,
            sched,
            actions=[Broken()],
            clock=lambda: now[0],
            sleep=lambda _s: None,
            alert=lambda k, d: alerts.append((k, d)),
        )
    assert sched.is_disabled("broken")
    assert alerts == [("action_disabled", "broken: no")]
