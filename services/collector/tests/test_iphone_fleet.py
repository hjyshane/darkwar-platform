"""The fleet starts one supervisor per phone, once, and survives a crash."""

from __future__ import annotations

import threading
from collections.abc import Callable

from dw_collector.iphone.fleet import Fleet, short_tag


class StubSupervisor:
    def __init__(self, udid: str, log: list[str], *, crash: bool = False) -> None:
        self._udid = udid
        self._log = log
        self._crash = crash
        self.done = threading.Event()

    def run(self, should_stop: Callable[[], bool]) -> None:
        self._log.append(self._udid)
        if self._crash:
            self.done.set()
            raise RuntimeError("boom")
        while not should_stop():
            self.done.wait(0.01)


def _wait(predicate: Callable[[], bool], seconds: float = 2.0) -> bool:
    pause = threading.Event()
    for _ in range(int(seconds / 0.01)):
        if predicate():
            return True
        pause.wait(0.01)
    return False


def test_every_new_phone_gets_exactly_one_supervisor() -> None:
    started: list[str] = []
    stop = threading.Event()
    fleet = Fleet(
        lambda: ["A-1111", "B-2222"],
        lambda u: StubSupervisor(u, started),  # type: ignore[arg-type,return-value]
        sleep=lambda _s: None,
    )

    fleet.scan_once(stop.is_set)
    fleet.scan_once(stop.is_set)
    assert _wait(lambda: sorted(started) == ["A-1111", "B-2222"])
    stop.set()

    assert sorted(started) == ["A-1111", "B-2222"], "a rescan must not start a second one"
    assert fleet.udids == ["A-1111", "B-2222"]


def test_a_phone_that_appears_later_is_picked_up() -> None:
    started: list[str] = []
    stop = threading.Event()
    seen = [["A-1111"], ["A-1111", "C-3333"]]
    fleet = Fleet(
        lambda: seen.pop(0) if len(seen) > 1 else seen[0],
        lambda u: StubSupervisor(u, started),  # type: ignore[arg-type,return-value]
        sleep=lambda _s: None,
    )

    fleet.scan_once(stop.is_set)
    fleet.scan_once(stop.is_set)
    assert _wait(lambda: len(started) == 2)
    stop.set()

    assert sorted(started) == ["A-1111", "C-3333"]


def test_a_crashed_supervisor_is_restarted_on_the_next_scan_and_spares_the_others() -> None:
    started: list[str] = []
    stop = threading.Event()
    made: list[StubSupervisor] = []

    def make(udid: str) -> StubSupervisor:
        sup = StubSupervisor(udid, started, crash=(udid == "BAD-0000" and not made))
        made.append(sup)
        return sup

    fleet = Fleet(
        lambda: ["BAD-0000", "OK-1111"],
        make,  # type: ignore[arg-type]
        sleep=lambda _s: None,
    )
    fleet.scan_once(stop.is_set)
    assert _wait(lambda: made[0].done.is_set())
    assert _wait(lambda: not fleet._threads["BAD-0000"].is_alive())
    fleet.scan_once(stop.is_set)
    assert _wait(lambda: started.count("BAD-0000") == 2)
    stop.set()

    assert started.count("OK-1111") == 1


def test_the_tag_is_the_last_eight_alphanumerics() -> None:
    assert short_tag("00008150-001E31590C52401C") == "0C52401C"
    assert short_tag("00008110-00197039360A801E") == "360A801E"
