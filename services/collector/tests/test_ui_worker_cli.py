"""The CLI's own wiring, separate from the runner's behaviour.

BlueStacks ships adb as HD-Adb.exe and does not put it on PATH, so the path
has to come from configuration. .env.example asks for DW_ADB_EXECUTABLE;
this pins that the CLI actually reads it, because a variable that is
documented and ignored fails at the worst moment — inside a scheduled run
nobody is watching.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from dw_collector.ui_worker import __main__ as ui_main

runner = CliRunner()

COLLECTOR = "emulator-5584"
MAIN_ACCOUNT = "emulator-5564"


@pytest.fixture(autouse=True)
def _guarded_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """A policy that permits something, so refusals in these tests are
    about the thing under test rather than an empty denylist.

    DW_ENV_FILE points at an empty file because every command loads .env
    first, and the developer's own .env is a real one two directories up —
    with DW_ADB_EXECUTABLE set in it. Without this the "falls back to PATH"
    case would pass in CI and fail on the machine that needs it.
    """
    empty = tmp_path / "empty.env"
    empty.write_text("", encoding="utf-8")
    monkeypatch.setenv("DW_ENV_FILE", str(empty))
    monkeypatch.setenv("DW_ADB_COLLECTOR_SERIAL", COLLECTOR)
    monkeypatch.setenv("DW_ADB_DENYLIST_SERIALS", MAIN_ACCOUNT)
    monkeypatch.delenv("DW_ADB_EXECUTABLE", raising=False)
    monkeypatch.delenv("DW_UI_KILL_SWITCH_FILE", raising=False)


def test_adb_path_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []
    monkeypatch.setattr(ui_main, "list_devices", lambda executable: seen.append(executable) or [])
    monkeypatch.setenv("DW_ADB_EXECUTABLE", r"C:\Program Files\BlueStacks_nxt\HD-Adb.exe")

    result = runner.invoke(ui_main.app, ["devices"])

    assert result.exit_code == 0
    assert seen == [r"C:\Program Files\BlueStacks_nxt\HD-Adb.exe"]


def test_the_flag_still_wins_over_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []
    monkeypatch.setattr(ui_main, "list_devices", lambda executable: seen.append(executable) or [])
    monkeypatch.setenv("DW_ADB_EXECUTABLE", r"C:\from-env\adb.exe")

    result = runner.invoke(ui_main.app, ["devices", "--adb", r"C:\explicit\adb.exe"])

    assert result.exit_code == 0
    assert seen == [r"C:\explicit\adb.exe"]


def test_without_configuration_it_falls_back_to_path(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []
    monkeypatch.setattr(ui_main, "list_devices", lambda executable: seen.append(executable) or [])

    result = runner.invoke(ui_main.app, ["devices"])

    assert result.exit_code == 0
    assert seen == ["adb"]


def test_devices_names_the_collector_and_refuses_the_rest(monkeypatch: pytest.MonkeyPatch) -> None:
    # The verdict column is the whole reason this command exists: it is how
    # the operator learns which serial automation will accept, rather than
    # guessing from a port number.
    monkeypatch.setattr(ui_main, "list_devices", lambda executable: [COLLECTOR, MAIN_ACCOUNT])

    result = runner.invoke(ui_main.app, ["devices"])

    assert result.exit_code == 0
    assert f"{COLLECTOR}  ALLOWED (collector)" in result.output
    assert MAIN_ACCOUNT in result.output
    assert "denylisted (main account)" in result.output
