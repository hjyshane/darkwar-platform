"""Restart the game client on the cloud emulator and prove it logged in again.

`relaunch` is force-stop then launch, both through `AdbClient`, so the target
guard (FR-COL-001 / FR-COL-010) sits in front of every call. `relogin` does NOT
tap anything: on 2026-11-04 a relaunched client logged itself in from the saved
session with nobody touching the screen, so the only honest check is the
login response arriving. That is what the cold-start routine documents too.

The journal is written by `ingest-dir`, which only sees a chunk once the
capture has rotated, so the login can take up to a chunk plus ingest delay to
appear. `login_timeout_seconds` has to cover that.
"""

from __future__ import annotations

import time
from collections.abc import Callable

import structlog

from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.adb import AdbClient, AdbError
from dw_collector.ui_worker.guard import AdbGuardError

log = structlog.get_logger()

LOGIN_COMMAND = "init"


class AdbGameClient:
    def __init__(
        self,
        adb: AdbClient,
        package: str,
        journal: Journal,
        *,
        login_timeout_seconds: float = 360.0,
        settle_seconds: float = 3.0,
        poll_seconds: float = 5.0,
        devices: Callable[[], list[str]] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._adb = adb
        self._package = package
        self._journal = journal
        self._timeout = login_timeout_seconds
        self._settle = settle_seconds
        self._poll = poll_seconds
        self._sleep = sleep
        self._clock = clock
        self._devices = devices
        self._mark = journal.watermark()

    def _only_ours_is_visible(self) -> bool:
        """False when our emulator is down; raises when it is not alone.

        The VM must hold the collector's emulator and nothing else. A second
        device is exactly the ambiguity the guard exists to refuse, so it is an
        AdbGuardError (never retried) rather than a failed attempt.
        """
        if self._devices is None:
            return True
        seen = self._devices()
        others = [d for d in seen if d != self._adb.serial]
        if others:
            msg = f"adb sees devices other than {self._adb.serial}: {others}; refusing"
            raise AdbGuardError(msg)
        return self._adb.serial in seen

    def relaunch(self) -> bool:
        if not self._only_ours_is_visible():
            log.warning("cloud.emulator_missing", serial=self._adb.serial)
            return False
        # Taken BEFORE the stop: a login is only ours if it was journalled after.
        self._mark = self._journal.watermark()
        try:
            self._adb.force_stop(self._package)
            self._sleep(self._settle)
            self._adb.launch(self._package)
        except AdbError as exc:
            log.warning("cloud.relaunch_failed", error=str(exc))
            return False
        return True

    def stop(self) -> None:
        """Close the game (a person is about to log in by hand)."""
        try:
            self._adb.force_stop(self._package)
        except AdbError as exc:
            log.warning("cloud.stop_failed", error=str(exc))

    def relogin(self) -> bool:
        deadline = self._clock() + self._timeout
        while True:
            if LOGIN_COMMAND in self._journal.commands_after(self._mark):
                return True
            if self._clock() >= deadline:
                log.warning("cloud.login_not_seen", seconds=self._timeout)
                return False
            self._sleep(self._poll)
