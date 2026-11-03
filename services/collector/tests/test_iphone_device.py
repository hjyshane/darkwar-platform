"""PmdBackend.launch must not restart a game that is already running."""

from __future__ import annotations

import subprocess
from typing import Any

import pytest

from dw_collector.iphone.device import PmdBackend


def _backend(monkeypatch: pytest.MonkeyPatch, pid_output: str, pid_code: int = 0) -> list[str]:
    calls: list[str] = []

    def run(argv: list[str], **_: Any) -> subprocess.CompletedProcess[bytes]:
        verb = argv[argv.index("dvt") + 1]
        calls.append(verb)
        if verb == "process-id-for-bundle-id":
            return subprocess.CompletedProcess(argv, pid_code, pid_output.encode(), b"")
        return subprocess.CompletedProcess(argv, 0, b"launched", b"")

    monkeypatch.setattr(subprocess, "run", run)
    return calls


def test_a_running_game_is_left_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _backend(monkeypatch, "4242\n")

    assert PmdBackend("pmd").launch("com.x") is True
    assert calls == ["process-id-for-bundle-id"]


def test_a_stopped_game_is_launched(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _backend(monkeypatch, "None\n")

    assert PmdBackend("pmd").launch("com.x") is True
    assert calls == ["process-id-for-bundle-id", "launch"]


def test_a_failed_check_falls_back_to_launching(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _backend(monkeypatch, "", pid_code=1)

    assert PmdBackend("pmd").launch("com.x") is True
    assert calls == ["process-id-for-bundle-id", "launch"]


def test_force_restarts_even_a_running_game(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _backend(monkeypatch, "4242\n")

    assert PmdBackend("pmd").launch("com.x", force=True) is True
    assert calls == ["launch"]
