"""Starting the game when nobody is at the keyboard.

The cold start exists for one situation: the power came back, Windows logged
itself in, and the machine is now sitting at a desktop with no game running. Every
other routine assumes a game that is already open and already on the field.

The risk it introduces is the one `guard.py` was written against — automation that
STARTS something is automation that can start it on the wrong emulator. So the
tests that matter here are not about launching. They are about the launch being
refused everywhere the taps would be refused.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from dw_collector.ui_worker import adb as adb_module
from dw_collector.ui_worker.adb import AdbClient, wait_for_serial
from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy
from dw_collector.ui_worker.routine import Routine

COLLECTOR = "127.0.0.1:5575"
MAIN_ACCOUNT = "127.0.0.1:5565"
PACKAGE = "com.example.game"


@pytest.fixture
def policy(tmp_path: Path) -> AdbPolicy:
    return AdbPolicy(
        collector_serial=COLLECTOR,
        denylist=frozenset({MAIN_ACCOUNT}),
        kill_switch_file=tmp_path / "STOP",
    )


def _client(policy: AdbPolicy, serial: str = COLLECTOR) -> AdbClient:
    return AdbClient(policy=policy, serial=serial, dry_run=True)


# ------------------------------------------------------------------- the guard


def test_a_launch_at_the_main_account_is_refused(policy: AdbPolicy) -> None:
    """THE TEST THIS FILE EXISTS FOR.

    A tap on the main account's emulator is a nuisance. A launch on it is the
    "본계정 오조작" row of the threat model: it wakes an account somebody is
    playing on, at 4am, from a machine that was supposed to be asleep.
    """
    with pytest.raises(AdbGuardError):
        _client(policy, MAIN_ACCOUNT).launch(PACKAGE)


def test_the_kill_switch_stops_a_launch_like_it_stops_a_tap(
    policy: AdbPolicy, tmp_path: Path
) -> None:
    """FR-OPS-006 is one file, and it has to mean everything.

    A kill switch that stops taps but not launches is worse than none: the
    operator believes automation is off and the game gets opened anyway.
    """
    (tmp_path / "STOP").write_text("stop")
    with pytest.raises(AdbGuardError):
        _client(policy).launch(PACKAGE)


def test_a_launch_names_the_package_and_nothing_else(policy: AdbPolicy) -> None:
    client = _client(policy)
    client.launch(PACKAGE)
    assert client.performed == [
        ["shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1"]
    ]


# ------------------------------------------------------------------ the schema


def test_a_launch_without_a_package_will_not_load() -> None:
    with pytest.raises(ValueError, match="needs a package"):
        Routine.model_validate({"name": "cold", "steps": [{"name": "open", "action": "launch"}]})


def test_a_package_on_a_tap_will_not_load() -> None:
    """Somebody meant to write a launch step.

    Ignored, this leaves a cold start whose first step taps a coordinate on
    whatever the emulator happened to have on screen — and the run reports ok,
    because a tap with no `expect` cannot fail.
    """
    with pytest.raises(ValueError, match="only a launch step"):
        Routine.model_validate(
            {
                "name": "cold",
                "steps": [{"name": "open", "action": "tap", "x": 1, "y": 2, "package": PACKAGE}],
            }
        )


def test_the_shipped_example_is_still_unusable_as_written() -> None:
    """The example must stay a template, not become a working routine.

    Its coordinates are zeros and its package is a placeholder on purpose. If
    somebody ever fills real values in here they leave one machine's layout in
    the repo, and the next machine runs it and taps the wrong things.
    """
    routine = Routine.load(Path(__file__).parents[1] / "routines" / "example-cold-start.json")
    launches = [step for step in routine.steps if step.action == "launch"]
    assert launches and all(step.package == "com.example.replace.me" for step in launches)
    assert all(step.x == 0 and step.y == 0 for step in routine.steps if step.action == "tap")


# --------------------------------------------------------------------- waiting


def test_waiting_gives_up_rather_than_hanging_forever(monkeypatch: pytest.MonkeyPatch) -> None:
    """A cold start that blocks forever is a collector that never reports.

    Which matters more than it looks: the sync-stall alert is keyed on the last
    heartbeat, so a wait that never returns produces exactly the silence the
    alert is for — and the alert is the only thing that would tell somebody.
    """
    monkeypatch.setattr(adb_module, "list_devices", lambda executable="adb": [])
    monkeypatch.setattr(adb_module.time, "sleep", lambda _seconds: None)
    assert wait_for_serial(COLLECTOR, timeout_seconds=0.0, sleep=0.0) is False


def test_waiting_returns_as_soon_as_the_named_serial_appears(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """By serial, not by "a device showed up".

    `adb wait-for-device` waits for any device at all, which on this machine
    could be the main account's emulator finishing its own start-up.
    """
    seen = iter([[], [MAIN_ACCOUNT], [MAIN_ACCOUNT, COLLECTOR]])
    monkeypatch.setattr(adb_module, "list_devices", lambda executable="adb": next(seen))
    monkeypatch.setattr(adb_module.time, "sleep", lambda _seconds: None)
    assert wait_for_serial(COLLECTOR, timeout_seconds=60.0, sleep=0.0) is True
