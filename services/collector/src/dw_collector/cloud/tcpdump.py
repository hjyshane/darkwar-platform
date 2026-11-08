"""`tcpdump` as the capture backend for `iphone.supervisor.Supervisor`.

The supervisor was written for a phone but only asks its backend two things:
which devices are capturable, and how to start one capture into a file. On a
cloud VM the emulator's traffic crosses the VM's own interface, so the answer
to the first is "always" and the second is one `tcpdump`.

Measured on 2026-11-04 (GCE, Ubuntu 22.04): `tcpdump -i ens4 -U -s 0 -w f
'tcp and not port 22'` produced a classic pcap that `scan-capture` read as-is.
`-U` matters: the supervisor judges a capture alive by its file GROWING.
"""

from __future__ import annotations

import getpass
import os
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from dw_collector.iphone.device import PcapProcess

#: Everything TCP except the operator's own SSH session, which would otherwise
#: fill the chunks with the shell they were started from.
DEFAULT_FILTER = "tcp and not port 22"


def default_interface(
    run: Callable[[list[str]], str] = lambda argv: (
        subprocess.run(argv, capture_output=True, text=True, timeout=10, check=False).stdout
    ),
) -> str | None:
    """The interface of the default route, e.g. `ens4`; None if it cannot be read."""
    words = run(["ip", "-o", "-4", "route", "show", "default"]).split()
    if "dev" in words and words.index("dev") + 1 < len(words):
        return words[words.index("dev") + 1]
    return None


class TcpdumpBackend:
    def __init__(
        self,
        interface: str,
        *,
        executable: str = "tcpdump",
        bpf: str = DEFAULT_FILTER,
        run_as: str | None = None,
        sudo: bool | None = None,
    ) -> None:
        self._interface = interface
        self._exe = executable
        self._bpf = bpf
        # tcpdump drops to its own user after opening the interface, and a
        # file it owns cannot be deleted by `ingest-dir` running as us.
        self._run_as = run_as or getpass.getuser()
        self._sudo = (os.geteuid() != 0) if sudo is None else sudo

    def devices(self) -> list[str]:
        return ["cloud"]

    def argv(self, out: Path) -> list[str]:
        head = ["sudo", "-n"] if self._sudo else []
        return [
            *head,
            self._exe,
            "-i",
            self._interface,
            "-U",
            "-s",
            "0",
            "-Z",
            self._run_as,
            "-w",
            str(out),
            self._bpf,
        ]

    def start(self, out: Path) -> PcapProcess:
        # stderr to a file, not a pipe: an unread pipe fills and wedges the child.
        stderr = tempfile.TemporaryFile()  # noqa: SIM115
        process = subprocess.Popen(self.argv(out), stdout=subprocess.DEVNULL, stderr=stderr)
        return PcapProcess(process, stderr)
