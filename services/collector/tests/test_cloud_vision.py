from __future__ import annotations

import io

import numpy as np
from PIL import Image

from dw_collector.cloud.vision import Frame, Match, Template, find


def _screen(seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 255, size=(640, 320)).astype(np.float64)


def _icon(seed: int = 7, size: int = 30) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 255, size=(size, size)).astype(np.float64)


def test_finds_an_embedded_icon_at_the_right_place() -> None:
    screen = _screen()
    icon = _icon()
    screen[200:230, 150:180] = icon
    hit = find(Frame(screen), Template("icon", icon))
    assert hit is not None
    assert (hit.x, hit.y) == (150, 200)
    assert hit.center == (165, 215)
    assert hit.score > 0.99


def test_match_survives_a_brightness_change() -> None:
    screen = _screen()
    icon = _icon()
    screen[100:130, 40:70] = icon * 0.5 + 20
    hit = find(Frame(screen), Template("icon", icon))
    assert hit is not None
    assert (hit.x, hit.y) == (40, 100)


def test_absent_icon_is_not_found() -> None:
    assert find(Frame(_screen()), Template("icon", _icon())) is None


def test_region_limits_the_search_and_keeps_screen_coordinates() -> None:
    screen = _screen()
    icon = _icon()
    screen[500:530, 250:280] = icon
    template = Template("icon", icon)
    assert find(Frame(screen), template, region=(0, 0, 320, 300)) is None
    hit = find(Frame(screen), template, region=(200, 450, 320, 640))
    assert hit == Match(250, 500, 30, 30, hit.score if hit else 0.0)


def test_flat_template_never_matches() -> None:
    flat = np.full((20, 20), 128.0)
    assert find(Frame(_screen()), Template("flat", flat)) is None


def test_template_larger_than_the_screen_is_not_found() -> None:
    assert find(Frame(np.zeros((10, 10))), Template("big", _icon(size=30))) is None


def test_frame_from_png_roundtrip() -> None:
    img = Image.fromarray(_screen().astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    frame = Frame.from_png(buf.getvalue())
    assert frame.size == (320, 640)


def test_saturation_tells_a_grey_button_from_a_coloured_one() -> None:
    rgb = np.zeros((40, 60, 3))
    rgb[:, :30] = (60, 180, 170)  # teal
    rgb[:, 30:] = (120, 120, 120)  # the same button, disabled
    frame = Frame(rgb.mean(axis=2), rgb)
    assert frame.mean_saturation(Match(0, 0, 30, 40, 1.0)) > 0.5
    assert frame.mean_saturation(Match(30, 0, 30, 40, 1.0)) < 0.05


def test_every_template_loads_and_has_texture() -> None:
    from dw_collector.cloud import templates

    found = templates.names()
    assert {"home_heroes", "home_world", "help_all", "donate_teal", "camp_chest"} <= set(found)
    for name in found:
        t = templates.load(name)
        assert t.gray.std() > 5, name
        assert t.threshold >= 0.8
