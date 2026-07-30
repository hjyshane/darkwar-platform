"""A routine is a list of screens to open, written down.

Coordinates are device-specific, so routines are data, not code: one JSON
file per emulator layout, kept next to the collector's config rather than
in the repo. `dw-ui-worker screenshot` exists to read coordinates off a
real screen.

Every step that is supposed to produce data declares WHICH command it
expects. That declaration is what makes the runner safe — see runner.py.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Step(BaseModel):
    name: str
    action: Literal["tap", "swipe", "back", "wait"]
    x: int | None = None
    y: int | None = None
    to_x: int | None = None
    to_y: int | None = None
    duration_ms: int = 400
    # Commands whose arrival proves this step landed on the screen we meant.
    expect: list[str] = Field(default_factory=list)
    # How long to wait for `expect` before giving up on the whole routine.
    timeout_seconds: float = 20.0
    # Pause after the action, before checking. Menus animate.
    settle_seconds: float = 1.5

    @model_validator(mode="after")
    def _coordinates_match_action(self) -> Step:
        if self.action == "tap" and (self.x is None or self.y is None):
            msg = f"step {self.name!r}: tap needs x and y"
            raise ValueError(msg)
        if self.action == "swipe" and None in (self.x, self.y, self.to_x, self.to_y):
            msg = f"step {self.name!r}: swipe needs x, y, to_x and to_y"
            raise ValueError(msg)
        if self.action in ("back", "wait") and self.expect:
            # Backing out of a screen produces no response; expecting one
            # would abort every run on a step that cannot succeed.
            msg = f"step {self.name!r}: {self.action} cannot expect a command"
            raise ValueError(msg)
        return self


class Routine(BaseModel):
    name: str
    description: str = ""
    steps: list[Step]

    @classmethod
    def load(cls, path: Path) -> Routine:
        return cls.model_validate(json.loads(path.read_text(encoding="utf-8")))
