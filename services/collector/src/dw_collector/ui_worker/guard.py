"""ADB target guard: automation may only ever touch the collector instance.

FR-COL-001 and FR-COL-010, plus the "본계정 오조작" row of the threat model
(§17.2). This is not a port — legacy/v0.4.1 `adb_control.py` has no
denylist at all and falls back to `devices[0]` when no serial is
configured, which is precisely how automation ends up driving the main
account's emulator.

The policy here is deliberately unhelpful: no auto-detection, no
single-device convenience, no "probably fine". A target is allowed only
when it was named explicitly, it is not on the denylist, and the kill
switch is off.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Commands that stop, restart, or otherwise disrupt whatever is running.
# Aiming one of these at the main account is the failure this module exists
# to prevent, so they are named rather than pattern-matched.
DISRUPTIVE_COMMANDS = frozenset(
    {
        "am force-stop",
        "am kill",
        "am start",
        "monkey",
        "reboot",
        "emu kill",
        "pm clear",
        "pm uninstall",
    }
)


class AdbGuardError(RuntimeError):
    """A requested ADB action is not permitted. Never caught to continue."""


@dataclass(frozen=True)
class AdbPolicy:
    collector_serial: str | None
    denylist: frozenset[str]
    kill_switch_file: Path | None = None

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> AdbPolicy:
        source = env if env is not None else dict(os.environ)
        raw_denylist = source.get("DW_ADB_DENYLIST_SERIALS", "")
        kill_file = source.get("DW_UI_KILL_SWITCH_FILE")
        return cls(
            collector_serial=(source.get("DW_ADB_COLLECTOR_SERIAL") or "").strip() or None,
            denylist=frozenset(item.strip() for item in raw_denylist.split(",") if item.strip()),
            kill_switch_file=Path(kill_file) if kill_file else None,
        )

    def kill_switch_engaged(self) -> bool:
        """FR-OPS-006: one file stops every UI automation immediately."""
        return self.kill_switch_file is not None and self.kill_switch_file.exists()

    def check_target(self, serial: str | None) -> str:
        """Return the serial automation may drive, or raise.

        `serial=None` is a request to "just use the connected device"; that
        is exactly the legacy behaviour this refuses.
        """
        if self.kill_switch_engaged():
            msg = f"UI automation kill switch is engaged ({self.kill_switch_file})"
            raise AdbGuardError(msg)

        if self.collector_serial is None:
            msg = (
                "DW_ADB_COLLECTOR_SERIAL is not set; automation refuses to pick a device"
                " (FR-COL-001)"
            )
            raise AdbGuardError(msg)

        if not self.denylist:
            msg = (
                "DW_ADB_DENYLIST_SERIALS is empty; the main account's serials must be"
                " listed before any automation runs (FR-COL-010)"
            )
            raise AdbGuardError(msg)

        if self.collector_serial in self.denylist:
            msg = (
                f"collector serial {self.collector_serial} is also on the denylist;"
                " refusing to run against an ambiguous target"
            )
            raise AdbGuardError(msg)

        if serial is None:
            msg = "automation must name its target serial explicitly; auto-detection is disabled"
            raise AdbGuardError(msg)

        if serial in self.denylist:
            msg = f"serial {serial} is denylisted (main account); refusing"
            raise AdbGuardError(msg)

        if serial != self.collector_serial:
            msg = (
                f"serial {serial} is not the configured collector instance"
                f" ({self.collector_serial}); refusing"
            )
            raise AdbGuardError(msg)

        return serial

    def check_command(self, serial: str | None, argv: list[str]) -> str:
        """check_target plus a second look at disruptive commands."""
        target = self.check_target(serial)
        joined = " ".join(argv)
        for disruptive in DISRUPTIVE_COMMANDS:
            if disruptive in joined:
                # Reaching here means the target already passed, so this is
                # belt-and-braces: it makes the audit trail explicit about
                # which serial a stop/start was aimed at.
                if target != self.collector_serial:  # pragma: no cover - unreachable
                    msg = f"disruptive command {disruptive!r} aimed at {target}"
                    raise AdbGuardError(msg)
                break
        return target
