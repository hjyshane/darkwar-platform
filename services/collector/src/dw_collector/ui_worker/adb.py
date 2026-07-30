"""ADB adapter. Every call goes through AdbPolicy first — there is no path
to a device that skips the guard.

Deliberately small: tap, swipe, back, screenshot, and a device listing.
Nothing here starts, stops, or installs anything; `DISRUPTIVE_COMMANDS`
would reject those anyway, and this module gives them no shortcut.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import structlog

from dw_collector.ui_worker.guard import AdbPolicy

log = structlog.get_logger()

KEYCODE_BACK = "4"


@dataclass
class AdbClient:
    policy: AdbPolicy
    serial: str
    executable: str = "adb"
    timeout_seconds: float = 20.0
    # Recorded rather than executed when true, so a routine can be checked
    # against a live device without touching it.
    dry_run: bool = False
    performed: list[list[str]] = field(default_factory=list)

    def _run(self, argv: list[str], *, capture: bool = False) -> bytes:
        target = self.policy.check_command(self.serial, argv)
        full = [self.executable, "-s", target, *argv]
        self.performed.append(argv)
        if self.dry_run:
            log.info("adb.dry_run", argv=" ".join(argv))
            return b""
        # argv is assembled here from typed fields and never goes through a shell.
        completed = subprocess.run(
            full,
            capture_output=True,
            timeout=self.timeout_seconds,
            check=False,
        )
        if completed.returncode != 0:
            stderr = completed.stderr.decode("utf-8", "replace").strip()
            msg = f"adb {' '.join(argv)} failed: {stderr or completed.returncode}"
            raise AdbError(msg)
        return completed.stdout if capture else b""

    def tap(self, x: int, y: int) -> None:
        self._run(["shell", "input", "tap", str(x), str(y)])

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 400) -> None:
        self._run(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration_ms)])

    def back(self) -> None:
        self._run(["shell", "input", "keyevent", KEYCODE_BACK])

    def screenshot(self, out: Path) -> None:
        """Pull a PNG so routine coordinates can be read off a real screen."""
        png = self._run(["exec-out", "screencap", "-p"], capture=True)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(png)


class AdbError(RuntimeError):
    """An adb invocation failed. Not retried: the screen state is unknown."""


def list_devices(executable: str = "adb") -> list[str]:
    """Serials adb can see. Informational only — the guard still decides."""
    completed = subprocess.run(
        [executable, "devices"], capture_output=True, timeout=20.0, check=False
    )
    serials = []
    for line in completed.stdout.decode("utf-8", "replace").splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            serials.append(parts[0])
    return serials
