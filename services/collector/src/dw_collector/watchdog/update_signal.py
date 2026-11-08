"""Observe packet-level hints that the game client needs a restart.

OBSERVE ONLY. Nothing here restarts anything. No fixture in the repo carries a
client version, a maintenance push or a kick, so every rule below is a guess
about field names, not a confirmed protocol. The watchdog therefore alerts on
these signals and restarts on them only when `auto_restart_on_signal` is set,
which should wait until a real signal has been seen and matched to a rule.

Three kinds, in order of how much is guessed:

* `version_changed` - a key that looks like a client/resource version holds a
  different value than the last time it was seen. The first sighting is a
  baseline, not a change.
* `push_signal` - a command whose NAME says kick, maintenance, shutdown or
  forced update. Names only; the payload is never read for these.
* `login_repeated` - `init` (the login bundle) arrived again with no
  restart by us in between. A kicked-and-reconnected client does this.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, Literal

Kind = Literal["version_changed", "push_signal", "login_repeated"]

#: Keys that probably name a client or resource version. Matched on the whole
#: key, case-insensitively, anywhere in the first MAX_DEPTH levels.
VERSION_KEY = re.compile(
    r"^(app|client|game|res|resource|data|config)?_?(version|ver|ver_?code|version_?code)$",
    re.IGNORECASE,
)
#: Command names that suggest the server is ending or refusing the session.
PUSH_NAME = re.compile(r"(kick|maintenance|maintain|shutdown|force\.?update|server\.?close)", re.I)
MAX_DEPTH = 4
LOGIN_COMMAND = "init"


@dataclass(frozen=True)
class UpdateSignal:
    kind: Kind
    #: Stable identity of the sighting, so an alert is raised once per change.
    key: str
    detail: str


def _walk(value: Any, depth: int = 0) -> Iterator[tuple[str, Any]]:
    if depth > MAX_DEPTH or not isinstance(value, dict):
        return
    for name, item in value.items():
        if isinstance(item, dict):
            yield from _walk(item, depth + 1)
        elif isinstance(item, (str, int)) and not isinstance(item, bool):
            yield str(name), item


class UpdateObserver:
    """Feed it `(command, payload)` in arrival order; it returns new signals."""

    def __init__(self) -> None:
        self._versions: dict[str, str] = {}
        self._logins_since_restart = 0

    def restarted(self) -> None:
        """Our own relaunch is the reason for the next login; do not flag it."""
        self._logins_since_restart = 0

    def observe(self, command: str, payload: Any) -> list[UpdateSignal]:
        found: list[UpdateSignal] = []
        if PUSH_NAME.search(command):
            found.append(UpdateSignal("push_signal", f"push:{command}", command))
        if command == LOGIN_COMMAND:
            self._logins_since_restart += 1
            if self._logins_since_restart > 1:
                found.append(
                    UpdateSignal(
                        "login_repeated",
                        f"login:{self._logins_since_restart}",
                        "login bundle arrived again without a restart from us",
                    )
                )
        for name, value in _walk(payload):
            if not VERSION_KEY.match(name):
                continue
            current = str(value)
            previous = self._versions.get(name)
            self._versions[name] = current
            if previous is not None and previous != current:
                found.append(
                    UpdateSignal(
                        "version_changed", f"{name}:{current}", f"{name} {previous} -> {current}"
                    )
                )
        return found
