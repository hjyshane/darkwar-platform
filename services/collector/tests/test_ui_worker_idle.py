"""Idle detection decides when NOT to automate, so the tests are about refusals.

The probe is injected, which is the whole point of the rewrite: legacy
`idle_detection.py` short-circuited to `is_idle=True` off Windows so that
tests could run, meaning the safety check was inert exactly where nobody
would notice. Here a fake probe drives every branch on Linux CI, and the
unmeasurable case is asserted to refuse.
"""

from __future__ import annotations

import pytest

from dw_collector.ui_worker.idle import (
    IdlePolicy,
    IdleUnavailableError,
    default_probe,
)


class FakeProbe:
    def __init__(self, seconds: float, title: str = "", process: str = "") -> None:
        self._seconds = seconds
        self._title = title
        self._process = process

    def idle_seconds(self) -> float:
        return self._seconds

    def foreground(self) -> tuple[str, str]:
        return self._title, self._process


class BrokenProbe:
    def idle_seconds(self) -> float:
        msg = "GetLastInputInfo failed"
        raise IdleUnavailableError(msg)

    def foreground(self) -> tuple[str, str]:  # pragma: no cover - never reached
        return "", ""


def _policy(probe: object, minimum: float = 60.0) -> IdlePolicy:
    return IdlePolicy(minimum_idle_seconds=minimum, probe=probe)  # type: ignore[arg-type]


def test_quiet_machine_is_idle() -> None:
    state = _policy(FakeProbe(300.0, "Notepad", "notepad.exe")).evaluate()
    assert state.is_idle
    assert "300s" in state.reason


def test_recent_input_blocks() -> None:
    state = _policy(FakeProbe(5.0, "Notepad", "notepad.exe")).evaluate()
    assert not state.is_idle
    assert "recent user input" in state.reason


def test_game_in_foreground_demands_a_longer_quiet_period() -> None:
    """90s of quiet is enough in general, but not while the game is up: a
    player watching a march timer looks idle without having left."""
    assert _policy(FakeProbe(90.0, "Notepad", "notepad.exe")).evaluate().is_idle

    state = _policy(FakeProbe(90.0, "Dark War Survival", "HD-Player.exe")).evaluate()
    assert not state.is_idle
    assert "foreground" in state.reason


def test_game_foreground_still_yields_once_it_is_quiet_enough() -> None:
    state = _policy(FakeProbe(200.0, "Dark War Survival", "HD-Player.exe")).evaluate()
    assert state.is_idle


@pytest.mark.parametrize(
    ("title", "process"),
    [
        ("BlueStacks App Player", ""),
        ("", "HD-Player.exe"),
        ("darkwar", ""),
        ("DARK WAR SURVIVAL", ""),
    ],
)
def test_protected_terms_match_either_field_and_ignore_case(title: str, process: str) -> None:
    assert not _policy(FakeProbe(90.0, title, process)).evaluate().is_idle


def test_unmeasurable_platform_refuses_rather_than_assuming_absence() -> None:
    """The legacy behaviour inverted: no probe used to mean "go ahead"."""
    state = IdlePolicy(minimum_idle_seconds=60.0, probe=None).evaluate()
    assert not state.is_idle
    assert "refusing" in state.reason


def test_a_failing_probe_is_not_idleness() -> None:
    state = _policy(BrokenProbe()).evaluate()
    assert not state.is_idle
    assert "could not measure" in state.reason


def test_from_env_is_opt_in() -> None:
    assert IdlePolicy.from_env({}) is None
    assert IdlePolicy.from_env({"DW_UI_MIN_IDLE_SECONDS": ""}) is None
    assert IdlePolicy.from_env({"DW_UI_MIN_IDLE_SECONDS": "0"}) is None

    policy = IdlePolicy.from_env({"DW_UI_MIN_IDLE_SECONDS": "45"})
    assert policy is not None
    assert policy.minimum_idle_seconds == 45.0


def test_from_env_rejects_nonsense_instead_of_disabling_the_gate() -> None:
    """A typo must not silently turn the politeness gate off."""
    with pytest.raises(IdleUnavailableError):
        IdlePolicy.from_env({"DW_UI_MIN_IDLE_SECONDS": "soon"})


def test_default_probe_matches_the_platform() -> None:
    import ctypes

    expected = getattr(ctypes, "windll", None) is not None
    assert (default_probe() is not None) is expected
