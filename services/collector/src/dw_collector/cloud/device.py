"""The emulator as the routines see it: look, tap, drag, go back."""

from __future__ import annotations

from typing import Protocol

from dw_collector.cloud.vision import Frame
from dw_collector.ui_worker.adb import AdbClient


class Device(Protocol):
    def screenshot(self) -> Frame: ...
    def tap(self, x: int, y: int) -> None: ...
    def drag(self, x1: int, y1: int, x2: int, y2: int) -> None: ...
    def back(self) -> None: ...


class AdbDevice:
    """`Device` over `AdbClient`, so every call still passes the target guard."""

    #: Slow on purpose. A quick flick is a fling in this game and the camera
    #: coasts past where the finger stopped; 1.8 s moved it by the drag distance.
    DRAG_MS = 1800

    def __init__(self, client: AdbClient) -> None:
        self._client = client

    def screenshot(self) -> Frame:
        return Frame.from_png(self._client.screencap())

    def tap(self, x: int, y: int) -> None:
        self._client.tap(x, y)

    def drag(self, x1: int, y1: int, x2: int, y2: int) -> None:
        self._client.swipe(x1, y1, x2, y2, self.DRAG_MS)

    def back(self) -> None:
        self._client.back()
