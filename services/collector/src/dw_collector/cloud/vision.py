"""Find a known icon on the emulator's screen.

The home city scrolls, so an icon is not at a fixed coordinate; and a tap on
the wrong thing in this game can spend money (a price button sits next to most
panels). So the rule for every automated tap is: look first, and tap only what
was matched against a named template.

Matching is zero-mean normalised cross-correlation, computed with FFTs, so a
320x640 screen against a 40x40 icon takes a few milliseconds and a score does
not depend on brightness. Scores run -1..1; real hits on the emulator's
screenshots were ~1.0 and misses well under 0.6, so 0.9 is the default bar.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

DEFAULT_THRESHOLD = 0.9
#: Area of a window with no texture at all (flat colour): its correlation is
#: noise, so it never matches.
_FLAT = 1e-3


@dataclass(frozen=True)
class Match:
    x: int
    y: int
    w: int
    h: int
    score: float

    @property
    def center(self) -> tuple[int, int]:
        return self.x + self.w // 2, self.y + self.h // 2


@dataclass(frozen=True)
class Frame:
    """One screenshot: grey levels for matching, colour for what grey cannot tell.

    A disabled button is the enabled one in grey, and in grey levels they match
    at 0.99, so `mean_saturation` is how "can I press this" is decided.
    """

    gray: np.ndarray
    rgb: np.ndarray | None = None

    @classmethod
    def from_png(cls, data: bytes) -> Frame:
        return cls.from_image(Image.open(io.BytesIO(data)))

    @classmethod
    def from_image(cls, image: Image.Image) -> Frame:
        rgb = np.asarray(image.convert("RGB"), dtype=np.float64)
        return cls(np.asarray(image.convert("L"), dtype=np.float64), rgb)

    def mean_saturation(self, match: Match) -> float:
        """0 (grey) .. 1 (pure colour), averaged over the matched rectangle."""
        if self.rgb is None:
            msg = "frame has no colour data"
            raise ValueError(msg)
        part = self.rgb[match.y : match.y + match.h, match.x : match.x + match.w]
        top = part.max(axis=2)
        sat = np.where(top > 0, (top - part.min(axis=2)) / np.maximum(top, 1.0), 0.0)
        return float(sat.mean())

    @property
    def size(self) -> tuple[int, int]:
        """(width, height)"""
        return self.gray.shape[1], self.gray.shape[0]


@dataclass(frozen=True)
class Template:
    name: str
    gray: np.ndarray
    threshold: float = DEFAULT_THRESHOLD

    @classmethod
    def from_file(cls, path: Path, threshold: float = DEFAULT_THRESHOLD) -> Template:
        image = Image.open(path)
        return cls(path.stem, np.asarray(image.convert("L"), dtype=np.float64), threshold)


def score_map(image: np.ndarray, template: np.ndarray) -> np.ndarray:
    """ZNCC of `template` at every position it fits inside `image`."""
    ih, iw = image.shape
    th, tw = template.shape
    if th > ih or tw > iw:
        return np.zeros((0, 0))
    centred = template - template.mean()
    norm = float(np.sqrt((centred**2).sum()))
    out_h, out_w = ih - th + 1, iw - tw + 1
    if norm < _FLAT:
        return np.zeros((out_h, out_w))
    spectrum = np.fft.rfft2(image) * np.conj(np.fft.rfft2(centred, s=image.shape))
    corr = np.fft.irfft2(spectrum, s=image.shape)[:out_h, :out_w]

    def window_sum(a: np.ndarray) -> np.ndarray:
        c = np.zeros((ih + 1, iw + 1))
        c[1:, 1:] = a.cumsum(0).cumsum(1)
        return (
            c[th:, tw:][:out_h, :out_w]
            - c[:out_h, tw:][:, :out_w]
            - c[th:, :out_w][:out_h]
            + c[:out_h, :out_w]
        )

    n = th * tw
    s1 = window_sum(image)
    s2 = window_sum(image * image)
    var = np.maximum(s2 - s1 * s1 / n, 0.0)
    denom = np.sqrt(var) * norm
    scores = np.zeros_like(corr)
    ok = denom > _FLAT
    scores[ok] = corr[ok] / denom[ok]
    return scores


def find(
    frame: Frame,
    template: Template,
    *,
    region: tuple[int, int, int, int] | None = None,
    threshold: float | None = None,
) -> Match | None:
    """The best match of `template` in `frame` (inside `region`), or None.

    `region` is (x0, y0, x1, y1) in screen pixels. A match is reported in
    screen coordinates either way.
    """
    x0, y0, x1, y1 = region if region is not None else (0, 0, *frame.size)
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, frame.size[0]), min(y1, frame.size[1])
    sub = frame.gray[y0:y1, x0:x1]
    scores = score_map(sub, template.gray)
    if scores.size == 0:
        return None
    iy, ix = np.unravel_index(int(np.argmax(scores)), scores.shape)
    best = float(scores[iy, ix])
    if best < (template.threshold if threshold is None else threshold):
        return None
    th, tw = template.gray.shape
    return Match(x0 + int(ix), y0 + int(iy), tw, th, best)
