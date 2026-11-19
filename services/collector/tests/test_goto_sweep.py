"""The map sweep that jumps by typing server, X and Y into the game's own box.

Nothing here touches a device: plans and landings are pure, and the screen
driver runs against an AdbClient in dry-run with synthetic screenshots built
from the same templates it looks for.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from dw_collector.cloud.vision import Frame
from dw_collector.ui_worker import goto
from dw_collector.ui_worker import goto_screen as gs
from dw_collector.ui_worker.__main__ import _parse_servers
from dw_collector.ui_worker.adb import AdbClient, AdbError
from dw_collector.ui_worker.gaps import CELL, GRID, HALF_X, HALF_Y
from dw_collector.ui_worker.guard import AdbPolicy

NOW = datetime(2026, 11, 18, 23, 40, tzinfo=UTC)


# --- the plan ------------------------------------------------------------


def _centres() -> list[tuple[int, int]]:
    return [
        (gx * CELL + CELL // 2, gy * CELL + CELL // 2) for gx in range(GRID) for gy in range(GRID)
    ]


def test_a_server_is_seventy_jumps_and_the_cluster_is_1610() -> None:
    assert goto.X_POSITIONS == [50, 150, 250, 350, 450, 550, 650, 750, 850, 950]
    assert goto.Y_POSITIONS == [75, 225, 375, 525, 675, 825, 950]
    assert len(goto.plan_server(580)) == 70
    assert tuple(range(566, 589)) == goto.DEFAULT_SERVERS
    assert len(goto.plan(goto.DEFAULT_SERVERS)) == 1610


@pytest.mark.parametrize("dx", [-goto.TOLERANCE_X, 0, goto.TOLERANCE_X])
@pytest.mark.parametrize("dy", [-goto.TOLERANCE_Y, 0, goto.TOLERANCE_Y])
def test_every_cell_is_covered_even_when_each_landing_misses_by_the_tolerance(
    dx: int, dy: int
) -> None:
    """The coverage rule (gaps.py) is a viewport centre within HALF_X/HALF_Y of a cell
    centre. Landings anywhere inside the tolerance must still read every cell, or
    `covers` would credit a jump with ground it did not see."""
    landed = [(t.x + dx, t.y + dy) for t in goto.plan_server(580)]
    for cx, cy in _centres():
        assert any(abs(cx - x) <= HALF_X and abs(cy - y) <= HALF_Y for x, y in landed), (cx, cy)


def test_plan_cells_picks_the_one_jump_that_covers_each_missing_cell() -> None:
    # (0,0) and (1,0) share a column group and a row group: one jump.
    targets = goto.plan_cells(581, {(0, 0), (1, 0), (19, 19), (5, 10)})
    assert targets == [
        goto.Target(581, 50, 75),
        goto.Target(581, 250, 525),
        goto.Target(581, 950, 950),
    ]
    full = set(goto.plan_server(581))
    assert set(targets) <= full


# --- landings --------------------------------------------------------------


def _payload(server: int = 580, x: int = 450, y: int = 525, lvl: int = 1, points: int = 3) -> str:
    return json.dumps({"serverId": server, "x": x, "y": y, "viewLvl": lvl, "points": [{}] * points})


def test_parse_landings_reads_server_position_zoom_and_tiles_and_drops_the_rest() -> None:
    rows = [
        (NOW, _payload()),
        (NOW, "not json"),
        (NOW, json.dumps([1, 2])),
        (NOW, json.dumps({"x": 1, "y": 2})),  # no server: dropped, not defaulted
        (NOW, json.dumps({"serverId": 580, "x": "1", "y": 2})),
    ]
    landed = goto.parse_landings(rows)
    assert landed == [goto.Landing(NOW, 580, 450, 525, 1, 3)]


@pytest.mark.parametrize(
    ("landing", "ok"),
    [
        (goto.Landing(NOW, 580, 450, 525, 1, 5), True),
        (goto.Landing(NOW, 580, 460, 545, 1, 5), True),  # at the tolerance
        (goto.Landing(NOW, 580, 461, 525, 1, 5), False),
        (goto.Landing(NOW, 580, 450, 546, 1, 5), False),
        (goto.Landing(NOW, 581, 450, 525, 1, 5), False),  # another server
        (goto.Landing(NOW, 580, 450, 525, 0, 5), False),  # the zoom every jump lands at
        (goto.Landing(NOW, 580, 450, 525, None, 5), False),
        (goto.Landing(NOW, 580, 450, 525, 1, 0), False),  # came back empty
    ],
)
def test_covers(landing: goto.Landing, ok: bool) -> None:
    assert goto.covers(landing, goto.Target(580, 450, 525)) is ok


def test_unreached_keeps_plan_order() -> None:
    plan = [goto.Target(580, 50, 75), goto.Target(580, 150, 75), goto.Target(581, 50, 75)]
    landed = [goto.Landing(NOW, 580, 150, 75, 1, 9)]
    assert goto.unreached(plan, landed) == [plan[0], plan[2]]


def test_wrong_zoom_needs_landings_and_none_at_viewlvl_1() -> None:
    at0 = goto.Landing(NOW, 580, 1, 1, 0, 5)
    at1 = goto.Landing(NOW, 580, 1, 1, 1, 5)
    assert goto.wrong_zoom([], 580) is False
    assert goto.wrong_zoom([at0, at0], 580) is True
    assert goto.wrong_zoom([at0, at1], 580) is False
    assert goto.wrong_zoom([at0], 581) is False


def test_parse_servers() -> None:
    assert _parse_servers("566-568") == [566, 567, 568]
    assert _parse_servers("580, 581,590-591,580") == [580, 581, 590, 591]
    with pytest.raises(ValueError, match="backwards"):
        _parse_servers("590-580")


# --- the adb verbs ---------------------------------------------------------


def _client() -> AdbClient:
    policy = AdbPolicy(collector_serial="127.0.0.1:5555", denylist=frozenset(), enumerated=True)
    return AdbClient(policy=policy, serial="127.0.0.1:5555", dry_run=True)


def test_text_types_digits_and_refuses_anything_else() -> None:
    client = _client()
    client.text("581")
    assert client.performed == [["shell", "input", "text", "581"]]
    for bad in ("", "58 1", "1;reboot", "-1"):
        with pytest.raises(ValueError, match="digits only"):
            client.text(bad)


def test_wheel_writes_the_mouse_device_not_the_touch_device() -> None:
    client = _client()
    client.wheel(540, 960, -2)
    (argv,) = client.performed
    line = argv[1]
    assert "/dev/input/event4" not in line
    assert line.count("sendevent /dev/input/event5 2 8 -1;") == 2
    assert "sendevent /dev/input/event5 3 0 32767;" in line
    assert "sendevent /dev/input/event5 3 1 32767;" in line


# --- the screen driver -----------------------------------------------------

_BACKGROUND = np.random.default_rng(7).integers(40, 90, size=(1920, 1080, 3), dtype=np.uint8)


def _screen(*looks: gs.Look, size: tuple[int, int] = gs.SCREEN) -> Frame:
    """A screenshot with each look's template pasted at its region's corner."""
    image = (
        Image.fromarray(_BACKGROUND).resize(size)
        if size != gs.SCREEN
        else Image.fromarray(_BACKGROUND)
    )
    for look in looks:
        tile = Image.open(gs.TEMPLATES / f"{look.template}.png").convert("RGB")
        image.paste(tile, (look.region[0] + 10, look.region[1] + 10))
    return Frame.from_image(image)


MAP = _screen(gs.BAR)
WINDOW = _screen(gs.WINDOW, gs.GO_BUTTON)
TYPING = _screen(gs.WINDOW, gs.GO_BUTTON, gs.ENTRY)
NOTHING = _screen()


def _driver(frames: list[Frame], shots: Path | None = None) -> tuple[gs.GotoScreen, AdbClient]:
    client = _client()
    queue = list(frames)

    def capture() -> Frame:
        assert queue, "the driver looked at the screen more often than the test expected"
        return queue.pop(0)

    return gs.GotoScreen(client, shots=shots, sleep=lambda _s: None, capture=capture), client


def _taps(client: AdbClient) -> list[tuple[int, int]]:
    return [(int(a[3]), int(a[4])) for a in client.performed if a[:3] == ["shell", "input", "tap"]]


def _typed(client: AdbClient) -> list[str]:
    return [a[3] for a in client.performed if a[:3] == ["shell", "input", "text"]]


def _wheels(client: AdbClient) -> int:
    return sum(1 for a in client.performed if a[0] == "shell" and "event5" in a[1])


def test_a_jump_to_another_server_types_all_three_and_zooms_back_out() -> None:
    screen, client = _driver([MAP, WINDOW, TYPING, TYPING, TYPING, MAP])
    assert screen.jump(goto.Target(582, 250, 75), current_server=581) is True
    assert _taps(client) == [
        gs.MAGNIFIER,
        gs.STATE_FIELD,
        gs.ENTRY_OK,
        gs.X_FIELD,
        gs.ENTRY_OK,
        gs.Y_FIELD,
        gs.ENTRY_OK,
        gs.GO,
    ]
    assert _typed(client) == ["582", "250", "75"]
    assert _wheels(client) == 1


def test_a_jump_on_the_same_server_leaves_state_alone() -> None:
    # Four looks: the map, the window, and the text bar twice. Nothing after Go.
    screen, client = _driver([MAP, WINDOW, TYPING, TYPING])
    assert screen.jump(goto.Target(582, 350, 75), current_server=582) is True
    assert gs.STATE_FIELD not in _taps(client)
    assert _typed(client) == ["350", "75"]
    assert _wheels(client) == 1


def test_go_that_leaves_the_window_up_is_a_refusal_and_the_window_is_closed() -> None:
    screen, client = _driver([MAP, WINDOW, TYPING, TYPING, TYPING, WINDOW])
    assert screen.jump(goto.Target(999, 50, 75), current_server=580) is False
    assert _taps(client)[-1] == gs.CLOSE
    assert _wheels(client) == 0


def test_no_text_bar_after_a_field_tap_stops_before_typing(tmp_path: Path) -> None:
    # Three looks for the text bar, then stop.
    screen, client = _driver([MAP, WINDOW, WINDOW, WINDOW, WINDOW], shots=tmp_path)
    with pytest.raises(gs.ScreenError, match="no text bar") as caught:
        screen.jump(goto.Target(582, 50, 75), current_server=582)
    assert _typed(client) == []
    assert caught.value.shot is not None and caught.value.shot.is_file()


def test_the_magnifier_not_opening_the_window_stops_before_any_field_tap() -> None:
    screen, client = _driver([MAP, NOTHING, NOTHING, NOTHING])
    with pytest.raises(gs.ScreenError, match="did not open"):
        screen.jump(goto.Target(582, 50, 75), current_server=582)
    assert _taps(client) == [gs.MAGNIFIER]


def test_ready_zooms_out_when_the_bar_is_missing_and_never_taps_the_map() -> None:
    screen, client = _driver([NOTHING, MAP])
    screen.ready()
    assert _taps(client) == []
    assert _wheels(client) == 1


def test_ready_closes_a_window_left_open_with_its_x() -> None:
    # CLOSE_X is looked for anywhere; _screen pastes it at (10, 10).
    screen, client = _driver([_screen(gs.WINDOW, gs.GO_BUTTON, gs.CLOSE_X), MAP])
    screen.ready()
    (tap,) = _taps(client)
    assert abs(tap[0] - 34) <= 2 and abs(tap[1] - 34) <= 2


def test_an_unknown_screen_is_waited_out_then_given_up_without_a_tap_or_back() -> None:
    # Look, zoom, look, wait, look, wait, look - then give up.
    screen, client = _driver([NOTHING] * 4)
    with pytest.raises(gs.ScreenError, match="nothing on screen this knows how to close"):
        screen.ready()
    assert _taps(client) == []
    assert _wheels(client) == 1
    assert ["shell", "input", "keyevent", "4"] not in client.performed


def test_a_popup_that_clears_by_itself_is_waited_for() -> None:
    screen, client = _driver([NOTHING, NOTHING, MAP])
    screen.ready()
    assert _taps(client) == []


def test_a_popup_with_an_x_is_closed_by_its_x_wherever_it_is() -> None:
    popup = Image.fromarray(_BACKGROUND.copy())
    popup.paste(Image.open(gs.TEMPLATES / "goto_close_x.png").convert("RGB"), (700, 300))
    screen, client = _driver([Frame.from_image(popup), MAP])
    screen.ready()
    (tap,) = _taps(client)
    assert abs(tap[0] - 724) <= 2 and abs(tap[1] - 324) <= 2


def test_a_full_screen_window_is_left_by_its_back_arrow() -> None:
    screen, client = _driver([_screen(gs.BACK_ARROW), MAP])
    screen.ready()
    (tap,) = _taps(client)
    assert gs.BACK_ARROW.region[0] <= tap[0] <= gs.BACK_ARROW.region[2]
    assert gs.BACK_ARROW.region[1] <= tap[1] <= gs.BACK_ARROW.region[3]


def test_a_stray_text_bar_is_dismissed_with_back_not_a_tap() -> None:
    screen, client = _driver([_screen(gs.ENTRY), MAP])
    screen.ready()
    assert client.performed == [["shell", "input", "keyevent", "4"]]


def test_a_different_screen_size_is_refused() -> None:
    screen, _ = _driver([_screen(gs.BAR, size=(720, 1280))])
    with pytest.raises(gs.ScreenError, match="720x1280"):
        screen.ready()


def test_screencap_raw_strips_either_header_and_refuses_a_short_read() -> None:
    import struct

    class Raw(AdbClient):
        payload = b""

        def _run(self, argv: list[str], *, capture: bool = False) -> bytes:
            return self.payload

    client = Raw(policy=_client().policy, serial="127.0.0.1:5555")
    pixels = bytes(range(16)) * 2  # 2x4 RGBA
    for header in (struct.pack("<III", 2, 4, 1), struct.pack("<IIII", 2, 4, 1, 0)):
        client.payload = header + pixels
        assert client.screencap_raw() == (2, 4, pixels)
    client.payload = struct.pack("<III", 2, 4, 1) + pixels[:-4]
    with pytest.raises(AdbError, match="does not hold"):
        client.screencap_raw()
    client.payload = b"short"
    with pytest.raises(AdbError, match="5 bytes"):
        client.screencap_raw()


def test_a_raw_capture_scores_the_templates_like_the_png_they_were_cut_from() -> None:
    rgb = np.asarray(Image.open(gs.TEMPLATES / "goto_window_go.png").convert("RGB"))
    canvas = _BACKGROUND.copy()
    canvas[1160 : 1160 + rgb.shape[0], 410 : 410 + rgb.shape[1]] = rgb
    rgba = np.dstack([canvas, np.full(canvas.shape[:2], 255, np.uint8)])

    class Raw(AdbClient):
        def screencap_raw(self) -> tuple[int, int, bytes]:
            return 1080, 1920, rgba.tobytes()

    screen = gs.GotoScreen(Raw(policy=_client().policy, serial="x"), sleep=lambda _s: None)
    assert screen.sees(screen.frame(), gs.GO_BUTTON)


def test_a_slow_window_is_waited_for_by_looking_again() -> None:
    screen, client = _driver([MAP, NOTHING, WINDOW, MAP, TYPING, TYPING])
    assert screen.jump(goto.Target(582, 350, 75), current_server=582) is True
    assert _typed(client) == ["350", "75"]
