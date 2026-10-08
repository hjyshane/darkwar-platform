"""ChildGroup restarts a child that exits, after a pause, and stops them all."""

from __future__ import annotations

from typing import Any

from dw_collector.iphone.children import RESTART_PAUSE_SECONDS, ChildGroup, ChildSpec


class FakeProc:
    _next_pid = 100

    def __init__(self) -> None:
        FakeProc._next_pid += 1
        self.pid = FakeProc._next_pid
        self.returncode: int | None = None
        self.terminated = False

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = -15

    def wait(self, timeout: float | None = None) -> int | None:
        return self.returncode

    def kill(self) -> None:
        self.returncode = -9


class Rig:
    def __init__(self) -> None:
        self.procs: list[FakeProc] = []
        self.envs: list[dict[str, str]] = []
        self.t = 0.0
        self.group = ChildGroup(
            [ChildSpec("ingest", ["x"], {"DW_SQLITE_PATH": "J"}), ChildSpec("sync", ["y"])],
            popen=self._popen,
            clock=lambda: self.t,
            job=False,
        )

    def _popen(self, argv: list[str], env: dict[str, str]) -> Any:
        self.envs.append(env)
        proc = FakeProc()
        self.procs.append(proc)
        return proc


def test_children_get_their_own_journal_path_in_the_environment() -> None:
    rig = Rig()
    rig.group.start()

    assert rig.envs[0]["DW_SQLITE_PATH"] == "J"
    assert rig.envs[0]["PYTHONIOENCODING"] == "utf-8"


def test_a_child_that_exits_is_restarted_only_after_the_pause() -> None:
    rig = Rig()
    rig.group.start()
    rig.procs[0].returncode = 1

    rig.group.tick()
    assert len(rig.procs) == 2, "first tick only schedules the restart"

    rig.t = RESTART_PAUSE_SECONDS - 1
    rig.group.tick()
    assert len(rig.procs) == 2

    rig.t = RESTART_PAUSE_SECONDS + 1
    rig.group.tick()
    assert len(rig.procs) == 3, "restarted once the pause has passed"
    assert rig.procs[2].returncode is None


def test_a_healthy_child_is_left_alone() -> None:
    rig = Rig()
    rig.group.start()
    rig.t = 10_000
    rig.group.tick()

    assert len(rig.procs) == 2


def test_stop_terminates_every_running_child() -> None:
    rig = Rig()
    rig.group.start()
    rig.group.stop()

    assert all(p.terminated for p in rig.procs)
