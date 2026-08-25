"""Which emulator is the collector, resolved rather than written down.

`DW_ADB_COLLECTOR_SERIAL` and `DW_ADB_DENYLIST_SERIALS` were both stale, and
in a way that quietly disarmed the guard: the collector serial named
`emulator-5584`, which no longer exists, and the denylist named four more
`emulator-55xx` serials while every live instance answers as
`127.0.0.1:PORT`. Nothing on that denylist matched anything real, so the one
protection standing between automation and the main account was matching on
strings that could never appear.

BLUESTACKS REASSIGNS ADB PORTS. The collector moved 5586 -> 5585 across a
single reboot. Any file naming a port is a file that will be wrong later, and
wrong silently, which is the worst property a safety check can have.

So the instances are resolved the way the console resolves them (see
`console/state.py`, same failure, same fix): find HD-Player by the window
TITLE the operator sees, take its PID, take the ports that PID listens on,
and accept only one that answers a shell command. Everything else running is
derived as the denylist — no port is typed anywhere.

WHAT THIS DOES NOT DO is relax the guard. Resolution that is ambiguous or
fails returns nothing, and `AdbPolicy` refuses on nothing. The rule is still
"named explicitly, not denied, kill switch off"; this only changes where the
name comes from.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass

#: The window title BlueStacks puts on the collector's instance. Unlike a
#: port, this is chosen by the operator and does not move.
COLLECTOR_WINDOW = "collector"

#: Ports an emulator's adb may live on. Wide, because the point is not to
#: guess which one — it is to ask each candidate and believe the answer.
ADB_PORTS = range(5555, 5700)

_NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW


def _run(argv: list[str], timeout: float = 20.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        creationflags=_NO_WINDOW,
    )


@dataclass(frozen=True)
class Instance:
    """One running emulator, named by its window and proven by a handshake."""

    title: str
    pid: int
    endpoint: str


def _players() -> list[tuple[int, str]]:
    """(pid, window title) for every running HD-Player."""
    if shutil.which("tasklist") is None:  # pragma: no cover - Windows only
        return []
    result = _run(["tasklist", "/fi", "IMAGENAME eq HD-Player.exe", "/v", "/fo", "csv"])
    found: list[tuple[int, str]] = []
    for line in result.stdout.splitlines():
        parts = [p.strip('" ') for p in line.split('","')]
        if len(parts) < 2 or not parts[1].isdigit():
            continue
        # "Image Name","PID",...,"Window Title" — the title is last.
        found.append((int(parts[1]), parts[-1].strip('"')))
    return found


def _listening_ports(pid: int) -> list[int]:
    if shutil.which("netstat") is None:  # pragma: no cover - Windows only
        return []
    result = _run(["netstat", "-ano", "-p", "TCP"])
    ports: list[int] = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) < 5 or fields[-1] != str(pid) or "LISTENING" not in fields:
            continue
        _, _, port = fields[1].rpartition(":")
        if port.isdigit() and int(port) in ADB_PORTS:
            ports.append(int(port))
    return sorted(ports)


def _answers(adb: str, endpoint: str) -> bool:
    """Whether adb can actually talk to this endpoint.

    `adb connect` reports "connected" to a port that then says the device is
    offline forever, so connecting proves nothing. Only a completed shell
    command does.
    """
    _run([adb, "connect", endpoint], timeout=15.0)
    probe = _run([adb, "-s", endpoint, "shell", "echo", "ok"], timeout=15.0)
    return probe.returncode == 0 and "ok" in probe.stdout


def resolve(adb: str, *, collector_title: str = COLLECTOR_WINDOW) -> list[Instance]:
    """Every running emulator this machine can reach, in no order."""
    found: list[Instance] = []
    for pid, title in _players():
        for port in _listening_ports(pid):
            endpoint = f"127.0.0.1:{port}"
            if _answers(adb, endpoint):
                found.append(Instance(title=title, pid=pid, endpoint=endpoint))
                break
    return found


def _is_collector(title: str, collector_title: str) -> bool:
    return collector_title.strip().lower() in title.strip().lower()


def collector_and_others(
    instances: list[Instance], *, collector_title: str = COLLECTOR_WINDOW
) -> tuple[str | None, frozenset[str]]:
    """The collector's endpoint and every other instance's, for the denylist.

    AMBIGUITY IS A REFUSAL. Two windows matching the collector title returns
    no collector at all rather than picking one — this is the module whose
    entire job is to keep automation off the main account, and "probably that
    one" is how legacy/v0.4.1 ended up driving it.

    Everything not the collector is denied, so the denylist needs no file and
    cannot go stale: a new instance is on it the moment it is running.
    """
    mine = [i for i in instances if _is_collector(i.title, collector_title)]
    others = frozenset(i.endpoint for i in instances if not _is_collector(i.title, collector_title))
    if len(mine) != 1:
        return None, others
    return mine[0].endpoint, others


def describe(instances: list[Instance], *, collector_title: str = COLLECTOR_WINDOW) -> list[str]:
    """One line per instance, for a human deciding whether to trust this."""
    lines: list[str] = []
    for item in sorted(instances, key=lambda i: i.endpoint):
        role = "COLLECTOR" if _is_collector(item.title, collector_title) else "denied"
        lines.append(f"  {item.endpoint:20} pid {item.pid:<7} {role:10} {item.title!r}")
    return lines


def looks_like_a_port(serial: str) -> bool:
    """Whether a configured serial uses the notation live instances use.

    The old configuration named `emulator-5584` while everything real answers
    as `127.0.0.1:5585`. Both are valid adb serials, so nothing errored — the
    denylist simply never matched, and a guard that matches nothing protects
    nothing.
    """
    return re.fullmatch(r"127\.0\.0\.1:\d+", serial.strip()) is not None
