"""The real backend: `pymobiledevice3` as a subprocess.

It is not a dependency of this package. It is installed as a tool
(`uv tool install pymobiledevice3`) so its large dependency tree stays out of
the collector's lockfile, and it is only ever spoken to through its CLI.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import IO

import structlog

log = structlog.get_logger()

_TAIL_BYTES = 600
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0


class ToolMissingError(RuntimeError):
    pass


def find_tool(name: str = "pymobiledevice3") -> str:
    found = shutil.which(name)
    if found is None:
        msg = f"{name} is not on PATH; install it with: uv tool install {name}"
        raise ToolMissingError(msg)
    return found


class PcapProcess:
    def __init__(self, process: subprocess.Popen[bytes], stderr: IO[bytes]) -> None:
        self._process = process
        self._stderr = stderr

    def poll(self) -> int | None:
        return self._process.poll()

    def terminate(self) -> None:
        self._process.terminate()
        try:
            self._process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._process.kill()
        self._stderr.close()

    def stderr_tail(self) -> str:
        # Read through the same handle the child writes to and release it
        # here: the file is anonymous, so closing it is also the cleanup.
        if self._stderr.closed:
            return ""
        try:
            end = self._stderr.seek(0, 2)
            self._stderr.seek(0)
            data = self._stderr.read()
            if end > 2 * _TAIL_BYTES:
                # The cause is at the top of a traceback and the trailer is
                # boilerplate; keep both ends.
                data = data[:_TAIL_BYTES] + b"\n...\n" + data[-_TAIL_BYTES:]
            return data.decode("utf-8", errors="replace").strip()
        finally:
            self._stderr.close()


class PmdBackend:
    def __init__(
        self,
        executable: str,
        *,
        udid: str | None = None,
        userspace: bool = False,
    ) -> None:
        self._exe = executable
        self._udid = udid
        self._userspace = userspace

    def devices(self) -> list[str]:
        """What usbmux reports, or [] on ANY failure.

        Windows lists the phone as a USB device long after usbmux has dropped
        it, so this asks usbmux and not the device manager. An error and an
        empty list mean the same thing to the caller: not capturable now.
        """
        try:
            done = subprocess.run(
                [self._exe, "usbmux", "list"],
                capture_output=True,
                timeout=30,
                check=False,
                creationflags=_NO_WINDOW,
            )
            rows = json.loads(done.stdout.decode("utf-8", errors="replace") or "[]")
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            log.warning("iphone.usbmux_failed", error=str(exc))
            return []
        found = [str(r["UniqueDeviceID"]) for r in rows if "UniqueDeviceID" in r]
        if self._udid:
            found = [u for u in found if u == self._udid]
        return found

    def is_running(self, bundle_id: str) -> bool:
        """Whether the app has a live process. False on ANY doubt.

        `process-id-for-bundle-id` only gives a valid pid while the app runs.
        If the answer cannot be had, the caller launches as before.
        """
        argv = [self._exe, "developer", "dvt", "process-id-for-bundle-id", bundle_id]
        if self._udid:
            argv += ["--udid", self._udid]
        try:
            done = subprocess.run(
                argv, capture_output=True, timeout=60, check=False, creationflags=_NO_WINDOW
            )
        except (OSError, subprocess.SubprocessError):
            return False
        if done.returncode != 0:
            return False
        pids = re.findall(r"\b\d+\b", done.stdout.decode("utf-8", errors="replace"))
        return any(int(p) > 0 for p in pids)

    def launch(self, bundle_id: str, *, force: bool = False) -> bool:
        """Start the app, or leave it alone if it is already running.

        `dvt launch` kills a running copy first, and a launch from here comes up
        black until the phone goes home and back, so a reconnect (the wifi or
        hotspot changing, a pcap that died) must not restart a healthy game.
        `force` is for the periodic restart that wants a fresh login.

        iOS 17+ wants a tunnel for developer commands; the tool falls back to
        a no-root userspace one on its own, which is why no admin rights are
        needed. Needs Developer Mode on and the developer image mounted.
        """
        if not force and self.is_running(bundle_id):
            log.info("iphone.launch_skipped", reason="already running")
            return True
        argv = [self._exe, "developer", "dvt", "launch", bundle_id]
        if self._udid:
            argv += ["--udid", self._udid]
        try:
            done = subprocess.run(
                argv, capture_output=True, timeout=120, check=False, creationflags=_NO_WINDOW
            )
        except (OSError, subprocess.SubprocessError) as exc:
            log.warning("iphone.launch_error", error=str(exc))
            return False
        text = (done.stdout + done.stderr).decode("utf-8", errors="replace")
        if done.returncode != 0 or "launched" not in text.lower():
            log.warning("iphone.launch_output", code=done.returncode, tail=text[-300:])
            return False
        return True

    def start(self, out: Path) -> PcapProcess:
        argv = [self._exe, "pcap", "--out", str(out)]
        if self._udid:
            argv += ["--udid", self._udid]
        if self._userspace:
            argv.append("--userspace")
        # stdout is a hex dump of every packet (11 MB a minute) and nothing
        # reads it. stderr goes to a file rather than a pipe: an unread pipe
        # fills and wedges the child, a file does not.
        stderr = tempfile.TemporaryFile()  # noqa: SIM115
        process = subprocess.Popen(
            argv,
            stdout=subprocess.DEVNULL,
            stderr=stderr,
            creationflags=_NO_WINDOW,
        )
        return PcapProcess(process, stderr)
