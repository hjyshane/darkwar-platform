from __future__ import annotations

from dataclasses import dataclass
import ctypes
from ctypes import wintypes
import os
import sys
import time


@dataclass(frozen=True)
class IdleState:
    idle_seconds: float
    foreground_title: str
    foreground_process: str
    is_idle: bool
    reason: str


class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT),
        ("dwTime", wintypes.DWORD),
    ]


def _windows_idle_seconds() -> float:
    info = _LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    tick = ctypes.windll.kernel32.GetTickCount()
    elapsed_ms = (int(tick) - int(info.dwTime)) & 0xFFFFFFFF
    return elapsed_ms / 1000.0


def _windows_foreground() -> tuple[str, str]:
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return "", ""

    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    title = buffer.value

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value:
        return title, ""

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    handle = kernel32.OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION,
        False,
        pid.value,
    )
    if not handle:
        return title, ""

    try:
        size = wintypes.DWORD(32768)
        path_buffer = ctypes.create_unicode_buffer(size.value)
        query = kernel32.QueryFullProcessImageNameW
        query.argtypes = [
            wintypes.HANDLE,
            wintypes.DWORD,
            wintypes.LPWSTR,
            ctypes.POINTER(wintypes.DWORD),
        ]
        query.restype = wintypes.BOOL
        if query(handle, 0, path_buffer, ctypes.byref(size)):
            process_name = os.path.basename(path_buffer.value)
        else:
            process_name = ""
    finally:
        kernel32.CloseHandle(handle)

    return title, process_name


def get_idle_state(
    minimum_idle_seconds: float,
    *,
    protected_window_terms: tuple[str, ...] = (
        "bluestacks",
        "dark war",
        "darkwar",
        "hd-player",
    ),
) -> IdleState:
    """Return whether UI automation can run without interrupting the user.

    On Windows, both recent input and the current foreground application are
    considered. On non-Windows systems this returns idle so unit tests and
    offline validation can execute without platform-specific mocking.
    """
    if sys.platform != "win32":
        return IdleState(
            idle_seconds=float("inf"),
            foreground_title="",
            foreground_process="",
            is_idle=True,
            reason="non-Windows validation environment",
        )

    idle_seconds = _windows_idle_seconds()
    title, process_name = _windows_foreground()
    combined = f"{title} {process_name}".lower()

    protected = next(
        (term for term in protected_window_terms if term in combined),
        None,
    )
    if protected and idle_seconds < minimum_idle_seconds * 2:
        return IdleState(
            idle_seconds=idle_seconds,
            foreground_title=title,
            foreground_process=process_name,
            is_idle=False,
            reason=f"game/emulator foreground ({protected})",
        )

    if idle_seconds < minimum_idle_seconds:
        return IdleState(
            idle_seconds=idle_seconds,
            foreground_title=title,
            foreground_process=process_name,
            is_idle=False,
            reason=(
                f"recent user input: {idle_seconds:.0f}s < "
                f"{minimum_idle_seconds:.0f}s"
            ),
        )

    return IdleState(
        idle_seconds=idle_seconds,
        foreground_title=title,
        foreground_process=process_name,
        is_idle=True,
        reason=f"idle for {idle_seconds:.0f}s",
    )


def interruptible_sleep(
    seconds: float,
    minimum_idle_seconds: float,
    *,
    check_interval_seconds: float = 1.0,
) -> bool:
    """Sleep while checking for renewed user activity.

    Returns True when the full delay elapsed. Returns False immediately when
    the user becomes active.
    """
    deadline = time.monotonic() + max(0.0, seconds)
    while time.monotonic() < deadline:
        state = get_idle_state(minimum_idle_seconds)
        if not state.is_idle:
            return False
        remaining = deadline - time.monotonic()
        time.sleep(min(max(0.1, check_interval_seconds), remaining))
    return True
