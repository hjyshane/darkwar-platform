"""The cloud adapters, driven by fakes: no tcpdump, adb, emulator or clock."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dw_collector.cloud.feed import SignalFeed, last_packet_at
from dw_collector.cloud.game import AdbGameClient
from dw_collector.cloud.tcpdump import DEFAULT_FILTER, TcpdumpBackend, default_interface
from dw_collector.storage.journal import Journal
from dw_collector.ui_worker.adb import AdbClient
from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy
from dw_collector.watchdog.machine import Alert, State, Watchdog, WatchdogConfig
from dw_collector.watchdog.update_signal import UpdateObserver


def _insert(journal: Journal, command: str, payload: object, n: int) -> None:
    with journal.conn:
        journal.conn.execute(
            "insert into raw_observations values (?, ?, ?, ?, ?, ?, ?)",
            (
                f"o{n}",
                "c",
                command,
                "2026-11-04T00:00:00+00:00",
                580,
                json.dumps(payload),
                "2026-11-04T00:00:00+00:00",
            ),
        )


@pytest.fixture
def journal(tmp_path: Path) -> Journal:
    j = Journal(tmp_path / "j.db")
    j.init_db()
    return j


def test_tcpdump_argv_matches_what_was_measured(tmp_path: Path) -> None:
    backend = TcpdumpBackend("ens4", run_as="dw", sudo=True)
    out = tmp_path / "a.pcap.part"
    assert backend.argv(out) == [
        "sudo", "-n", "tcpdump", "-i", "ens4", "-U", "-s", "0", "-Z", "dw",
        "-w", str(out), DEFAULT_FILTER,
    ]  # fmt: skip
    assert TcpdumpBackend("ens4", run_as="dw", sudo=False).argv(out)[0] == "tcpdump"
    assert backend.devices() == ["cloud"]


def test_default_interface_reads_the_default_route() -> None:
    row = "default via 10.178.0.1 dev ens4 proto dhcp src 10.178.0.2 metric 100\n"
    assert default_interface(lambda _argv: row) == "ens4"
    assert default_interface(lambda _argv: "") is None


def test_force_stop_goes_through_the_guard() -> None:
    policy = AdbPolicy(collector_serial="emulator-5554", denylist=frozenset(), enumerated=True)
    client = AdbClient(policy, "emulator-5554", dry_run=True)
    client.force_stop("com.example")
    assert client.performed == [["shell", "am", "force-stop", "com.example"]]
    with pytest.raises(AdbGuardError):
        AdbClient(policy, "emulator-9999", dry_run=True).force_stop("com.example")


class World:
    def __init__(self) -> None:
        self.t = 0.0

    def sleep(self, seconds: float) -> None:
        self.t += seconds

    def clock(self) -> float:
        return self.t


def _game(journal: Journal, world: World, devices: list[str]) -> tuple[AdbGameClient, AdbClient]:
    policy = AdbPolicy(collector_serial="emulator-5554", denylist=frozenset(), enumerated=True)
    adb = AdbClient(policy, "emulator-5554", dry_run=True)
    game = AdbGameClient(
        adb,
        "com.example",
        journal,
        login_timeout_seconds=100,
        poll_seconds=10,
        devices=lambda: devices,
        sleep=world.sleep,
        clock=world.clock,
    )
    return game, adb


def test_relaunch_stops_then_starts(journal: Journal) -> None:
    game, adb = _game(journal, World(), ["emulator-5554"])
    assert game.relaunch() is True
    assert adb.performed[0] == ["shell", "am", "force-stop", "com.example"]
    assert adb.performed[1][:3] == ["shell", "monkey", "-p"]


def test_relaunch_refuses_when_another_device_is_visible(journal: Journal) -> None:
    game, adb = _game(journal, World(), ["emulator-5554", "emulator-5574"])
    with pytest.raises(AdbGuardError):
        game.relaunch()
    assert adb.performed == []


def test_relaunch_fails_softly_when_the_emulator_is_down(journal: Journal) -> None:
    game, adb = _game(journal, World(), [])
    assert game.relaunch() is False
    assert adb.performed == []


def test_relogin_needs_a_login_journalled_after_the_relaunch(journal: Journal) -> None:
    _insert(journal, "init", {}, 1)  # an old login must not count
    world = World()
    game, _ = _game(journal, world, ["emulator-5554"])
    game.relaunch()
    assert game.relogin() is False
    assert world.t >= 100

    game.relaunch()
    _insert(journal, "init", {}, 2)
    assert game.relogin() is True


def test_feed_starts_at_the_end_and_reports_only_new_signals(journal: Journal) -> None:
    _insert(journal, "push.kick.player", {}, 1)  # history
    feed = SignalFeed(journal, UpdateObserver())
    assert feed.poll() == []
    _insert(journal, "push.kick.player", {}, 2)
    _insert(journal, "get.x", {"a": {"client_version": "1"}}, 3)
    _insert(journal, "get.x", {"a": {"client_version": "2"}}, 4)
    kinds = [s.kind for s in feed.poll()]
    assert kinds == ["push_signal", "version_changed"]
    assert feed.poll() == []


def test_feed_survives_a_payload_that_is_not_json(journal: Journal) -> None:
    with journal.conn:
        journal.conn.execute(
            "insert into raw_observations values ('o1','c','x','t',580,'not json','t')"
        )
    assert SignalFeed(journal, UpdateObserver()).poll() == []


def test_last_packet_at_is_none_for_an_empty_journal(journal: Journal) -> None:
    assert last_packet_at(journal) is None
    _insert(journal, "init", {}, 1)
    assert last_packet_at(journal) is not None


def test_watchdog_does_not_swallow_a_guard_refusal() -> None:
    from datetime import UTC, datetime, timedelta

    class Refusing:
        def relaunch(self) -> bool:
            msg = "not alone"
            raise AdbGuardError(msg)

        def relogin(self) -> bool:
            return True

    t0 = datetime(2026, 11, 4, tzinfo=UTC)
    now = [t0]
    dog = Watchdog(
        WatchdogConfig(),
        Refusing(),
        last_packet_at=lambda: t0,
        signals=list,
        now=lambda: now[0],
        alert=lambda _a: None,
        fatal=(AdbGuardError,),
    )
    now[0] = t0 + timedelta(minutes=11)
    with pytest.raises(AdbGuardError):
        dog.tick()


def test_halt_now_stays_halted_until_resumed() -> None:
    from datetime import UTC, datetime

    alerts: list[Alert] = []

    class Never:
        def relaunch(self) -> bool:
            raise AssertionError

        def relogin(self) -> bool:
            raise AssertionError

    t0 = datetime(2026, 11, 4, tzinfo=UTC)
    dog = Watchdog(
        WatchdogConfig(),
        Never(),
        last_packet_at=lambda: None,
        signals=list,
        now=lambda: t0,
        alert=alerts.append,
    )
    dog.halt_now("marker")
    assert dog.tick() is State.HALTED
    dog.resume()
    assert dog.state is State.RUNNING


def test_tcpdump_terminate_ends_the_whole_group_not_just_the_parent() -> None:
    """`sudo tcpdump -Z` leaves a child that outlives a signal to its parent."""
    import os
    import subprocess
    import tempfile
    import time

    from dw_collector.cloud.tcpdump import TcpdumpProcess

    stderr = tempfile.TemporaryFile()  # noqa: SIM115
    # Killing only the parent handle would leave the grandchild running.
    process = subprocess.Popen(
        ["sh", "-c", "sleep 60 & echo $! ; wait"],
        stdout=subprocess.PIPE,
        start_new_session=True,
    )
    assert process.stdout is not None
    child = int(process.stdout.readline())
    TcpdumpProcess(process, stderr).terminate()
    time.sleep(0.2)
    try:
        os.kill(child, 0)
    except ProcessLookupError:
        return
    raise AssertionError("grandchild survived terminate()")
