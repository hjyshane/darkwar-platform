"""One capture supervisor per phone, for however many are plugged in.

Without this the first phone usbmux lists is the only one captured and a
second is ignored without a word, so which phone feeds the dashboard would
depend on listing order. Here every UDID that ever shows up gets its own
supervisor thread, and that thread then owns the phone for good: it waits
through unplugs and picks the phone up again, so the fleet itself only has to
notice NEW phones.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

import structlog

from dw_collector.iphone.supervisor import Supervisor

log = structlog.get_logger()


IDLE_LOG_EVERY = 30  # scans; at the default 10 s, one line every five minutes


def short_tag(udid: str) -> str:
    """The last eight characters: enough to tell phones apart in a file name."""
    return "".join(c for c in udid if c.isalnum())[-8:]


class Fleet:
    def __init__(
        self,
        discover: Callable[[], list[str]],
        make_supervisor: Callable[[str], Supervisor],
        *,
        scan_seconds: float = 10.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._discover = discover
        self._make = make_supervisor
        self._scan = scan_seconds
        self._sleep = sleep
        self._threads: dict[str, threading.Thread] = {}

    @property
    def udids(self) -> list[str]:
        return sorted(self._threads)

    def _work(self, udid: str, should_stop: Callable[[], bool]) -> None:
        try:
            self._make(udid).run(should_stop)
        except Exception:
            log.exception("iphone.device_crashed", udid=udid)

    def scan_once(self, should_stop: Callable[[], bool]) -> None:
        for udid in self._discover():
            existing = self._threads.get(udid)
            if existing is not None and existing.is_alive():
                continue
            # New, or its supervisor crashed: start (again).
            log.info("iphone.device_seen", udid=udid, known=len(self._threads))
            thread = threading.Thread(
                target=self._work, args=(udid, should_stop), name=f"iphone-{short_tag(udid)}"
            )
            thread.daemon = True
            self._threads[udid] = thread
            thread.start()

    def run(self, should_stop: Callable[[], bool]) -> None:
        scans = 0
        while not should_stop():
            self.scan_once(should_stop)
            scans += 1
            # A log that says nothing for hours looks the same whether the
            # chain is waiting for a phone or has died.
            if not self._threads and scans % IDLE_LOG_EVERY == 1:
                log.info("iphone.no_phone_yet", scans=scans)
            self._sleep(self._scan)
        for thread in self._threads.values():
            thread.join(timeout=30)
