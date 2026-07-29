"""The main account must be unreachable by automation (FR-COL-010)."""

from __future__ import annotations

from pathlib import Path

import pytest

from dw_collector.ui_worker.guard import AdbGuardError, AdbPolicy

COLLECTOR = "127.0.0.1:5555"
MAIN = "127.0.0.1:5565"

ENV = {
    "DW_ADB_COLLECTOR_SERIAL": COLLECTOR,
    "DW_ADB_DENYLIST_SERIALS": f"{MAIN}, 127.0.0.1:5575",
}


def policy(**overrides: str) -> AdbPolicy:
    return AdbPolicy.from_env({**ENV, **overrides})


def test_collector_serial_is_allowed() -> None:
    assert policy().check_target(COLLECTOR) == COLLECTOR


def test_denylisted_serial_is_refused() -> None:
    with pytest.raises(AdbGuardError, match="denylisted"):
        policy().check_target(MAIN)


def test_unknown_serial_is_refused() -> None:
    """Not on the denylist is not the same as allowed."""
    with pytest.raises(AdbGuardError, match="not the configured collector"):
        policy().check_target("127.0.0.1:5599")


def test_auto_detection_is_refused() -> None:
    """Legacy adb_control fell back to devices[0]; that is the bug."""
    with pytest.raises(AdbGuardError, match="explicitly"):
        policy().check_target(None)


def test_missing_configuration_refuses_everything() -> None:
    with pytest.raises(AdbGuardError, match="DW_ADB_COLLECTOR_SERIAL"):
        AdbPolicy.from_env({"DW_ADB_DENYLIST_SERIALS": MAIN}).check_target(COLLECTOR)

    with pytest.raises(AdbGuardError, match="DW_ADB_DENYLIST_SERIALS"):
        AdbPolicy.from_env({"DW_ADB_COLLECTOR_SERIAL": COLLECTOR}).check_target(COLLECTOR)


def test_collector_on_its_own_denylist_is_refused() -> None:
    with pytest.raises(AdbGuardError, match="ambiguous"):
        policy(DW_ADB_DENYLIST_SERIALS=f"{MAIN},{COLLECTOR}").check_target(COLLECTOR)


def test_kill_switch_stops_everything(tmp_path: Path) -> None:
    """FR-OPS-006: one file halts all UI automation."""
    switch = tmp_path / "STOP"
    guarded = policy(DW_UI_KILL_SWITCH_FILE=str(switch))
    assert guarded.check_target(COLLECTOR) == COLLECTOR

    switch.touch()
    assert guarded.kill_switch_engaged()
    with pytest.raises(AdbGuardError, match="kill switch"):
        guarded.check_target(COLLECTOR)


def test_disruptive_commands_still_require_the_collector_target() -> None:
    guarded = policy()
    assert guarded.check_command(COLLECTOR, ["shell", "am", "force-stop", "com.x"]) == COLLECTOR
    with pytest.raises(AdbGuardError):
        guarded.check_command(MAIN, ["shell", "am", "force-stop", "com.x"])
    with pytest.raises(AdbGuardError):
        guarded.check_command(None, ["reboot"])


def test_whitespace_in_denylist_is_tolerated() -> None:
    guarded = AdbPolicy.from_env(
        {"DW_ADB_COLLECTOR_SERIAL": COLLECTOR, "DW_ADB_DENYLIST_SERIALS": f"  {MAIN} , , "}
    )
    assert guarded.denylist == frozenset({MAIN})
    with pytest.raises(AdbGuardError):
        guarded.check_target(MAIN)
