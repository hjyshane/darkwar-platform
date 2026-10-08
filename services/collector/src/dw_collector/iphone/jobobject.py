"""A Windows job object that kills its members when the parent goes away.

Its own module so the type checker, which runs on Linux in CI, never sees the
Windows-only `ctypes` names: everything that touches them is under one
`sys.platform == "win32"` branch, which mypy skips on other platforms. The
other branch is a stub with the same shape so callers need no platform test.
"""

from __future__ import annotations

import subprocess
import sys

import structlog

log = structlog.get_logger()

# JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
_KILL_ON_JOB_CLOSE = 0x2000
# JobObjectExtendedLimitInformation
_EXTENDED_LIMIT_INFORMATION = 9

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    class _Basic(ctypes.Structure):
        _fields_ = (
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        )

    class _Io(ctypes.Structure):
        _fields_ = tuple((name, ctypes.c_uint64) for name in "abcdef")

    class _Extended(ctypes.Structure):
        _fields_ = (
            ("BasicLimitInformation", _Basic),
            ("IoInfo", _Io),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        )

    class KillOnCloseJob:
        """Members die when the last handle to the job closes - including when
        the process holding it is killed, which is the case that matters."""

        supported = True

        def __init__(self) -> None:
            self._k32 = ctypes.WinDLL("kernel32", use_last_error=True)
            self._k32.CreateJobObjectW.restype = wintypes.HANDLE
            self._k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            self._job = self._k32.CreateJobObjectW(None, None)
            if not self._job:
                raise OSError(ctypes.get_last_error(), "CreateJobObject failed")
            info = _Extended()
            info.BasicLimitInformation.LimitFlags = _KILL_ON_JOB_CLOSE
            ok = self._k32.SetInformationJobObject(
                self._job, _EXTENDED_LIMIT_INFORMATION, ctypes.byref(info), ctypes.sizeof(info)
            )
            if not ok:
                raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")

        def add(self, process: subprocess.Popen[bytes]) -> None:
            handle = getattr(process, "_handle", None)
            if handle is None or not self._k32.AssignProcessToJobObject(self._job, int(handle)):
                log.warning("iphone.child_not_in_job", pid=process.pid)

else:

    class KillOnCloseJob:
        supported = False

        def __init__(self) -> None:
            raise OSError("job objects exist only on Windows")

        def add(self, process: subprocess.Popen[bytes]) -> None:
            raise OSError("job objects exist only on Windows")
