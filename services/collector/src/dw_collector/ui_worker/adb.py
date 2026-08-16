"""ADB adapter. Every call goes through AdbPolicy first — there is no path
to a device that skips the guard.

Deliberately small: tap, swipe, back, screenshot, launch, and a device
listing. Nothing here stops, clears, or installs anything.

`launch` is the one that starts something, and it was added for a cold
start after a power cut — a machine that boots with nobody in front of it
has to open the game before any routine can touch it. It is safe for the
same reason every other call here is: `AdbPolicy.check_target` has already
refused any serial that is not the configured collector instance, so a
launch cannot reach the main account's emulator. `monkey` is named in
`DISRUPTIVE_COMMANDS` alongside `am start` so it takes the audited path
rather than slipping past a list that exists on purpose.

An earlier version of this docstring said DISRUPTIVE_COMMANDS "would
reject" a start. It does not — it checks which serial the command is
aimed at and records it. The guarantee is the target, not the verb.
"""

from __future__ import annotations

import subprocess
import time
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

    def launch(self, package: str) -> None:
        """Bring an app to the foreground by package name.

        `monkey` rather than `am start`, because `am start` needs the launcher
        ACTIVITY and the activity name is the part that changes between game
        updates. The package does not. Resolving the activity first would work
        and would be one more thing to be stale on the morning it matters.

        Returns as soon as the intent is delivered — not when the game is ready.
        Nothing here can tell the difference, which is why the cold-start routine
        proves the launch worked by waiting for the login response to arrive on
        the wire instead of by trusting this call.
        """
        self._run(["shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"])


class AdbError(RuntimeError):
    """An adb invocation failed. Not retried: the screen state is unknown."""


def wait_for_serial(
    serial: str,
    *,
    timeout_seconds: float = 300.0,
    executable: str = "adb",
    sleep: float = 5.0,
) -> bool:
    """Block until adb can see `serial`, or give up. True when it appeared.

    For the cold start only. BlueStacks takes a minute or two to come up on a
    machine that has just booted, and every ADB call before then fails with
    "device not found" — which reads in the log exactly like a denylisted
    target, and sent the first version of this looking at the guard.

    `adb wait-for-device` is not used: it waits for ANY device, which is the
    auto-detection `AdbPolicy` exists to refuse. Polling by serial keeps the
    rule that automation names its target.

    Five minutes by default. A cold boot that has not produced an emulator in
    five minutes has a problem no amount of further waiting fixes, and the
    alert events added alongside this are what should be telling somebody.
    """
    deadline = time.monotonic() + timeout_seconds
    while True:
        if serial in list_devices(executable):
            return True
        if time.monotonic() >= deadline:
            log.warning("adb.wait_timeout", serial=serial, seconds=timeout_seconds)
            return False
        time.sleep(sleep)


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
