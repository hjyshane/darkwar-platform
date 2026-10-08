"""The iPhone capture supervisor, driven by a fake phone and a fake clock."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from dw_collector.iphone.supervisor import (
    EMPTY_PCAP_BYTES,
    IphoneConfig,
    Supervisor,
    chunk_path,
)


class World:
    """One clock shared by the fake process, the supervisor and its sleeps."""

    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += seconds

    def now(self) -> datetime:
        return datetime(2026, 10, 8, 20, 0, 0, tzinfo=UTC) + timedelta(seconds=self.t)


class FakeProcess:
    def __init__(self, world: World, out: Path, *, grow: int, dies_after: float | None) -> None:
        self._world = world
        self._out = out
        self._grow = grow
        self._dies_after = dies_after
        self._born = world.t
        self._last = world.t
        self.terminated = False
        self._out.write_bytes(b"\0" * EMPTY_PCAP_BYTES)

    def poll(self) -> int | None:
        if self.terminated:
            return -15
        elapsed = self._world.t - self._last
        self._last = self._world.t
        if self._dies_after is not None and self._world.t - self._born >= self._dies_after:
            return 1
        if self._grow and elapsed > 0:
            with self._out.open("ab") as handle:
                handle.write(b"\1" * self._grow)
        return None

    def terminate(self) -> None:
        self.terminated = True

    def stderr_tail(self) -> str:
        return "ERROR Device is not connected"


class FakeBackend:
    def __init__(self, world: World, script: list[tuple[bool, int, float | None]]) -> None:
        """Each entry: (device present, bytes grown per second, dies after s)."""
        self._world = world
        self._script = script
        self._i = -1
        self.processes: list[FakeProcess] = []
        self.checks = 0

    def devices(self) -> list[str]:
        self.checks += 1
        self._i = min(self._i + 1, len(self._script) - 1)
        return ["UDID-1"] if self._script[self._i][0] else []

    def start(self, out: Path) -> FakeProcess:
        _, grow, dies = self._script[self._i]
        proc = FakeProcess(self._world, out, grow=grow, dies_after=dies)
        self.processes.append(proc)
        return proc


def _run(
    tmp_path: Path,
    script: list[tuple[bool, int, float | None]],
    *,
    stop_after_devices: int,
    chunk: float = 30.0,
    stall: float = 10.0,
) -> tuple[World, FakeBackend, list[str]]:
    world = World()
    backend = FakeBackend(world, script)
    connects: list[str] = []
    config = IphoneConfig(
        directory=tmp_path / "iphone",
        chunk_seconds=chunk,
        stall_seconds=stall,
        poll_seconds=1.0,
        backoff_min_seconds=5.0,
        backoff_max_seconds=20.0,
    )
    Supervisor(
        config, backend, clock=lambda: world.t, sleep=world.sleep, now=world.now,
        on_connect=connects.append,
    ).run(lambda: backend.checks >= stop_after_devices)  # fmt: skip
    return world, backend, connects


def _chunks(tmp_path: Path) -> list[Path]:
    return sorted((tmp_path / "iphone").glob("*.pcap"))


def test_waits_with_a_doubling_capped_backoff_until_the_phone_appears(tmp_path: Path) -> None:
    script = [(False, 0, None)] * 5 + [(True, 100, None)]
    world, backend, connects = _run(tmp_path, script, stop_after_devices=6)

    assert world.sleeps[:5] == [5.0, 10.0, 20.0, 20.0, 20.0]
    assert connects == ["UDID-1"]
    assert len(backend.processes) == 1


def test_a_healthy_chunk_rotates_is_kept_and_the_next_one_starts(tmp_path: Path) -> None:
    script = [(True, 100, None)]
    _, backend, connects = _run(tmp_path, script, stop_after_devices=4)

    # Three full chunks, then the stop request lands on a fourth that is
    # empty and therefore not kept.
    assert len(backend.processes) == 4
    assert all(p.terminated for p in backend.processes)
    assert len(_chunks(tmp_path)) == 3
    assert connects == ["UDID-1"], "rotation is not a reconnect"


def test_a_dying_capture_keeps_its_data_backs_off_and_reports_a_reconnect(tmp_path: Path) -> None:
    script = [(True, 100, 8.0), (False, 0, None), (True, 100, None)]
    world, backend, connects = _run(tmp_path, script, stop_after_devices=4)

    assert connects == ["UDID-1", "UDID-1"], "the game must be relaunched after a drop"
    assert backend.processes[0].stderr_tail().endswith("not connected")
    assert any(s >= 5.0 for s in world.sleeps)
    assert _chunks(tmp_path), "the packets captured before the drop are not thrown away"


def test_a_chunk_with_no_packets_is_deleted(tmp_path: Path) -> None:
    script = [(True, 0, 5.0), (False, 0, None)]
    _run(tmp_path, script, stop_after_devices=2)

    assert _chunks(tmp_path) == []


def test_a_capture_that_stops_growing_is_killed_as_stalled(tmp_path: Path) -> None:
    script = [(True, 100, None)]
    world = World()
    backend = FakeBackend(world, script)
    config = IphoneConfig(directory=tmp_path, chunk_seconds=1000, stall_seconds=10, poll_seconds=1)
    backend.devices()
    proc_stop = {"n": 0}

    def freeze_after_ten_seconds() -> bool:
        proc_stop["n"] += 1
        if backend.processes and world.t > 3:
            backend.processes[0]._grow = 0
        return False

    result = Supervisor(
        config, backend, clock=lambda: world.t, sleep=world.sleep, now=world.now
    ).run_chunk(freeze_after_ten_seconds)

    assert result.outcome == "stalled"
    assert backend.processes[0].terminated


def test_stop_terminates_the_capture_and_returns(tmp_path: Path) -> None:
    world = World()
    backend = FakeBackend(world, [(True, 100, None)])
    config = IphoneConfig(directory=tmp_path / "iphone", chunk_seconds=1000)
    stop = {"now": False}

    def sleeper(seconds: float) -> None:
        world.sleep(seconds)
        if world.t > 5:
            stop["now"] = True

    Supervisor(config, backend, clock=lambda: world.t, sleep=sleeper, now=world.now).run(
        lambda: stop["now"]
    )

    assert backend.processes[0].terminated


def test_chunk_names_are_utc_and_sort_chronologically(tmp_path: Path) -> None:
    a = chunk_path(tmp_path, datetime(2026, 10, 8, 9, 5, 1, tzinfo=UTC))
    b = chunk_path(tmp_path, datetime(2026, 10, 8, 10, 0, 0, tzinfo=UTC))

    assert a.name == "iphone_20261008-090501.pcap"
    assert sorted([b.name, a.name]) == [a.name, b.name]


def _launching(
    tmp_path: Path,
    script: list[tuple[bool, int, float | None]],
    results: list[bool],
    *,
    stop_after_devices: int,
    relaunch: float = 0.0,
) -> tuple[World, FakeBackend, list[str]]:
    world = World()
    backend = FakeBackend(world, script)
    events: list[str] = []
    original_start = backend.start

    def start(out: Path) -> FakeProcess:
        events.append("start")
        return original_start(out)

    backend.start = start  # type: ignore[method-assign]

    def launch() -> bool:
        events.append("launch")
        return results.pop(0) if results else True

    config = IphoneConfig(
        directory=tmp_path / "iphone",
        chunk_seconds=30.0,
        stall_seconds=10.0,
        poll_seconds=1.0,
        backoff_min_seconds=5.0,
        relaunch_seconds=relaunch,
    )
    Supervisor(
        config, backend, clock=lambda: world.t, sleep=world.sleep, now=world.now, launch=launch
    ).run(lambda: backend.checks >= stop_after_devices)
    return world, backend, events


def test_the_game_is_launched_only_after_the_capture_is_running(tmp_path: Path) -> None:
    _, _, events = _launching(tmp_path, [(True, 100, None)], [], stop_after_devices=2)

    assert events[:2] == ["start", "launch"]


def test_the_game_is_launched_once_while_the_phone_stays_connected(tmp_path: Path) -> None:
    _, _, events = _launching(tmp_path, [(True, 100, None)], [], stop_after_devices=4)

    assert events.count("launch") == 1


def test_a_failed_launch_is_retried_with_the_next_chunk(tmp_path: Path) -> None:
    _, _, events = _launching(tmp_path, [(True, 100, None)], [False], stop_after_devices=3)

    assert events.count("launch") == 2


def test_a_reconnect_launches_the_game_again(tmp_path: Path) -> None:
    script = [(True, 100, 8.0), (False, 0, None), (True, 100, None)]
    _, _, events = _launching(tmp_path, script, [], stop_after_devices=4)

    assert events.count("launch") == 2


def test_a_phone_left_plugged_in_is_relaunched_on_the_interval(tmp_path: Path) -> None:
    # 30 s chunks, relaunch every 50 s: the second launch lands on the chunk
    # after the interval has passed, never in the middle of one.
    _, _, events = _launching(
        tmp_path, [(True, 100, None)], [], stop_after_devices=6, relaunch=50.0
    )

    assert events.count("launch") >= 2
    assert events[0] == "start"
