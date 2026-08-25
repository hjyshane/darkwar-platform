"""Hold UI automation back while the operator is actually using the machine.

FR-COL-009 politeness, and the other half of the "본계정 방해 0건" success
metric (§2.3): `guard.py` stops automation reaching the main account's
emulator, this stops it stealing the mouse while someone is playing on it.

Not a straight port. legacy/v0.4.1 `idle_detection.py` returns
`is_idle=True` on every non-Windows platform, "so unit tests and offline
validation can execute without platform-specific mocking". For a mechanism
whose entire job is to *withhold* permission, defaulting to granted off the
supported platform is the wrong direction — the same shape of gap as that
file's `devices[0]` fallback. Here the probe is injected, so tests need no
mocking at all, and a platform that cannot measure idleness is a refusal
with a reason rather than a silent yes.

Two signals, because they fail differently. Time since last input catches
"someone is at the keyboard". Foreground window catches "someone is playing
the game right now" — which can look idle for a minute at a time while
they watch a march timer, so the game in the foreground demands a longer
quiet period before automation is allowed to touch anything.
"""

from __future__ import annotations

import ctypes
import os
from dataclasses import dataclass
from pathlib import PureWindowsPath
from typing import Any, Protocol

DEFAULT_PROTECTED_TERMS: tuple[str, ...] = (
    "bluestacks",
    "dark war",
    "darkwar",
    "hd-player",
)

# How much quieter it has to be when the game or emulator is in front.
PROTECTED_IDLE_MULTIPLIER = 2.0


class IdleUnavailableError(RuntimeError):
    """Idleness cannot be measured here. Never treated as "idle"."""


@dataclass(frozen=True)
class IdleState:
    idle_seconds: float
    foreground_title: str
    foreground_process: str
    is_idle: bool
    reason: str


class InputProbe(Protocol):
    """The two OS questions this module needs answered."""

    def idle_seconds(self) -> float: ...

    def foreground(self) -> tuple[str, str]:
        """(window title, process name); empty strings when unknown."""
        ...


def _windll() -> Any:
    """user32/kernel32, or a refusal.

    Reached through getattr rather than `sys.platform` narrowing so mypy
    type-checks this file identically on Linux CI and on the Windows box.
    """
    windll = getattr(ctypes, "windll", None)
    if windll is None:
        msg = "idle detection needs Windows (ctypes.windll is unavailable here)"
        raise IdleUnavailableError(msg)
    return windll


class _LastInputInfo(ctypes.Structure):
    # DWORD/UINT spelled as fixed-width types so this declaration is valid to
    # construct on any platform; ctypes.wintypes is not importable everywhere.
    _fields_ = (("cbSize", ctypes.c_uint32), ("dwTime", ctypes.c_uint32))


class WindowsInputProbe:
    """GetLastInputInfo + GetForegroundWindow."""

    def idle_seconds(self) -> float:  # pragma: no cover - Windows only
        windll = _windll()
        info = _LastInputInfo()
        info.cbSize = ctypes.sizeof(info)
        if not windll.user32.GetLastInputInfo(ctypes.byref(info)):
            # The call failing tells us nothing about the operator, so it
            # must not read as "quiet for a long time".
            msg = "GetLastInputInfo failed; treating idleness as unknown"
            raise IdleUnavailableError(msg)
        tick = int(windll.kernel32.GetTickCount())
        # GetTickCount wraps every ~49.7 days; the mask makes the subtraction
        # correct across that wrap instead of yielding a huge idle time.
        elapsed_ms = (tick - int(info.dwTime)) & 0xFFFFFFFF
        return elapsed_ms / 1000.0

    def foreground(self) -> tuple[str, str]:  # pragma: no cover - Windows only
        windll = _windll()
        user32 = windll.user32
        kernel32 = windll.kernel32

        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return "", ""

        length = int(user32.GetWindowTextLengthW(hwnd))
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        title = buffer.value

        pid = ctypes.c_uint32()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not pid.value:
            return title, ""

        process_query_limited_information = 0x1000
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid.value)
        if not handle:
            # Elevated processes refuse this; the title alone still decides.
            return title, ""
        try:
            size = ctypes.c_uint32(32768)
            path_buffer = ctypes.create_unicode_buffer(size.value)
            ok = kernel32.QueryFullProcessImageNameW(handle, 0, path_buffer, ctypes.byref(size))
            # PureWindowsPath, not Path: the string came from a Win32 API and
            # is backslash-separated regardless of what is interpreting it.
            process_name = PureWindowsPath(path_buffer.value).name if ok else ""
        finally:
            kernel32.CloseHandle(handle)
        return title, process_name


def default_probe() -> InputProbe | None:
    """A probe for this platform, or None where idleness is unmeasurable."""
    return WindowsInputProbe() if getattr(ctypes, "windll", None) is not None else None


@dataclass(frozen=True)
class IdlePolicy:
    """How quiet the machine must be before automation may tap anything."""

    minimum_idle_seconds: float
    probe: InputProbe | None = None
    protected_terms: tuple[str, ...] = DEFAULT_PROTECTED_TERMS

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> IdlePolicy | None:
        """None when the operator has not asked for an idle gate.

        Opting in is explicit. What is *not* optional is that opting in on a
        platform that cannot measure idleness refuses rather than proceeds —
        see `evaluate`.
        """
        source = env if env is not None else dict(os.environ)
        raw = (source.get("DW_UI_MIN_IDLE_SECONDS") or "").strip()
        if not raw:
            return None
        try:
            seconds = float(raw)
        except ValueError:
            msg = f"DW_UI_MIN_IDLE_SECONDS is not a number: {raw!r}"
            raise IdleUnavailableError(msg) from None
        if seconds <= 0:
            return None
        return cls(minimum_idle_seconds=seconds, probe=default_probe())

    def contends(self) -> IdleState:
        """Whether the operator is at the EMULATOR, not merely at the machine.

        `evaluate` gates on the whole machine going quiet, which is right for
        a routine: it runs for a minute, a mistimed tap opens the wrong
        screen, and waiting costs nothing.

        A SWEEP IS A DIFFERENT BARGAIN. It runs for half an hour and drives
        exactly one window, so a keystroke in a terminal or a browser does not
        contend with it — but under `evaluate` it stops the sweep dead. That
        made the sweep unrunnable in practice: the first full attempt waited
        for idle, measured both axes over six minutes, managed seven swipes,
        and quit on "idle 0s". The operator cannot both leave the machine
        untouched for half an hour and watch the run.

        So this asks the narrower question the sweep actually cares about: is
        the emulator in the foreground. If it is, the operator is playing and
        the sweep yields, because then they really are fighting over one
        screen.

        `is_idle` here means "the sweep may proceed", not "the machine is
        quiet". An unavailable measurement still refuses, exactly as in
        `evaluate`: not being able to look is not permission.
        """
        if self.probe is None:
            return IdleState(
                idle_seconds=0.0,
                foreground_title="",
                foreground_process="",
                is_idle=False,
                reason=(
                    "idle detection is configured but unavailable on this platform;"
                    " refusing rather than assuming the operator is away"
                ),
            )
        try:
            seconds = self.probe.idle_seconds()
            title, process = self.probe.foreground()
        except IdleUnavailableError as exc:
            return IdleState(
                idle_seconds=0.0,
                foreground_title="",
                foreground_process="",
                is_idle=False,
                reason=f"could not measure idleness ({exc})",
            )

        combined = f"{title} {process}".lower()
        protected = next((term for term in self.protected_terms if term in combined), None)
        if protected is not None and seconds < self.minimum_idle_seconds:
            return IdleState(
                idle_seconds=seconds,
                foreground_title=title,
                foreground_process=process,
                is_idle=False,
                reason=f"the emulator is in use ({protected}), idle {seconds:.0f}s",
            )
        return IdleState(
            idle_seconds=seconds,
            foreground_title=title,
            foreground_process=process,
            is_idle=True,
            reason=f"emulator not in the foreground (idle {seconds:.0f}s)",
        )

    def evaluate(self) -> IdleState:
        if self.probe is None:
            return IdleState(
                idle_seconds=0.0,
                foreground_title="",
                foreground_process="",
                is_idle=False,
                reason=(
                    "idle detection is configured but unavailable on this platform;"
                    " refusing rather than assuming the operator is away"
                ),
            )

        try:
            seconds = self.probe.idle_seconds()
            title, process = self.probe.foreground()
        except IdleUnavailableError as exc:
            return IdleState(
                idle_seconds=0.0,
                foreground_title="",
                foreground_process="",
                is_idle=False,
                reason=f"could not measure idleness ({exc})",
            )

        combined = f"{title} {process}".lower()
        protected = next((term for term in self.protected_terms if term in combined), None)
        protected_threshold = self.minimum_idle_seconds * PROTECTED_IDLE_MULTIPLIER
        if protected is not None and seconds < protected_threshold:
            return IdleState(
                idle_seconds=seconds,
                foreground_title=title,
                foreground_process=process,
                is_idle=False,
                reason=f"game/emulator in foreground ({protected}), idle {seconds:.0f}s",
            )

        if seconds < self.minimum_idle_seconds:
            return IdleState(
                idle_seconds=seconds,
                foreground_title=title,
                foreground_process=process,
                is_idle=False,
                reason=(
                    f"recent user input: idle {seconds:.0f}s < {self.minimum_idle_seconds:.0f}s"
                ),
            )

        return IdleState(
            idle_seconds=seconds,
            foreground_title=title,
            foreground_process=process,
            is_idle=True,
            reason=f"idle for {seconds:.0f}s",
        )
