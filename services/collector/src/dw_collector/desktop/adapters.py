"""What `dumpcap -D` can see, for the settings screen to show as a list.

Without this a player picking a capture adapter has to type
`\\Device\\NPF_{GUID}` by hand into `Settings.interface`, and a wrong one
fails the way `capture/live.py::check_interface` documents: scapy sniffs,
delivers no packets, and the process looks healthy forever. This module
exists to make the *right* value pickable instead of typed.

No wiring into the settings screen here — that is a later task. This module
only answers "what dumpcap is there" and "what can it see".
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

#: The only path this repo has ever actually used — hardcoded as the
#: `$Dumpcap` default in `scripts/windows/register-tasks.ps1:32`. The x86
#: Program Files variant is included because a 32-bit Wireshark install is
#: the one other place dumpcap has ever been observed to land; nothing here
#: has ever needed a third.
DUMPCAP_CANDIDATES: tuple[str, ...] = (
    r"C:\Program Files\Wireshark\dumpcap.exe",
    r"C:\Program Files (x86)\Wireshark\dumpcap.exe",
)

#: A device token always starts with this literal prefix; `\S+` is safe to
#: stop at the first space because neither a GUID (`{...}`) nor the literal
#: name `Loopback` ever contains one.
_DEVICE_RE = re.compile(r"(\\Device\\NPF_\S+)")

# CREATE_NO_WINDOW, matching apps/desktop/src-tauri/src/main.rs's
# `creation_flags(CREATE_NO_WINDOW)`. Any subprocess spawned from this GUI
# app must not flash a console window — and unlike Rust's `creation_flags`,
# `subprocess.Popen`'s `creationflags` argument is REJECTED on POSIX
# (`ValueError: creationflags is only supported on Windows platforms`), not
# merely ignored, so it is added to the call only on Windows. This keeps the
# module importable on Linux, where CI runs it.
_RUN_KWARGS: dict[str, int] = {"creationflags": 0x0800_0000} if sys.platform == "win32" else {}


def find_dumpcap(
    *,
    candidates: tuple[str, ...] = DUMPCAP_CANDIDATES,
    exists: Callable[[Path], bool] = Path.is_file,
    which: Callable[[str], str | None] = shutil.which,
) -> str | None:
    """The dumpcap this machine actually has, or `None`.

    Candidates first, `PATH` second: the hardcoded install path is what
    every machine this repo has run on actually has, so it is worth trying
    before spending a `PATH` search on it. Both checks are injected so this
    is testable without Wireshark installed and without depending on the
    real `PATH`.
    """
    for candidate in candidates:
        if exists(Path(candidate)):
            return candidate
    return which("dumpcap")


def parse_interfaces(raw: str) -> list[tuple[str, str]]:
    """`dumpcap -D` output, as `(device, label)` pairs. Pure — no subprocess.

    Each usable line looks like ``7. \\Device\\NPF_{GUID} (Wi-Fi)``: a
    device token, then a friendly label in parentheses. The label is
    everything inside the OUTERMOST parentheses, not the first matching
    pair — `vEthernet (WSL (Hyper-V firewall))` is real output on this
    machine, and a naive "first `(` to first `)`" scan truncates it to
    "vEthernet (WSL".

    A line this cannot make sense of is skipped, not raised on: dumpcap's
    output format is not a contract this module was ever given.
    """
    result: list[tuple[str, str]] = []
    for line in raw.splitlines():
        match = _DEVICE_RE.search(line)
        if match is None:
            continue
        device = match.group(1)
        remainder = line[match.end() :]
        paren_start = remainder.find("(")
        if paren_start == -1:
            continue
        label = _label_in_outer_parens(remainder, paren_start)
        if label is None:
            continue
        result.append((device, label))
    return result


def _label_in_outer_parens(text: str, open_index: int) -> str | None:
    """Text between `text[open_index]` (a `(`) and its matching `)`.

    Tracks nesting depth explicitly rather than searching for the next `)`,
    because the friendly name itself can contain parentheses.
    Returns `None` if `text` never closes what it opened at `open_index` —
    dumpcap's output is not a contract, so an unterminated label is a line
    to skip, not a `ValueError` to raise.
    """
    depth = 0
    for index in range(open_index, len(text)):
        char = text[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return text[open_index + 1 : index]
    return None


def list_interfaces(
    dumpcap: str,
    *,
    run: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> list[tuple[str, str]]:
    """Every adapter `dumpcap -D` reports, as `(device, label)` pairs.

    `run` is injected so this is testable without Npcap installed — tests
    feed it a fake `CompletedProcess` built from a fixture, never a real
    subprocess.
    """
    completed = run(
        [dumpcap, "-D"],
        capture_output=True,
        check=False,
        **_RUN_KWARGS,
    )
    # Decoded as UTF-8 with replacement, NOT the Windows console codepage
    # (cp949 for Korean, cp1252 otherwise). This call captures dumpcap's
    # stdout through a pipe rather than a real console, and Wireshark's CLI
    # tools write non-ASCII interface friendly names as UTF-8 on that path
    # regardless of the console's active code page (this is also why
    # register-tasks.ps1 needs `chcp 65001` only for the console-attached
    # logging case, not for this one). Decoding with a locale codepage
    # instead is exactly how this machine's real adapter names — Korean —
    # would come out as mojibake or raise `UnicodeDecodeError` outright.
    # `errors="replace"` means that if some future dumpcap build violates
    # this assumption, a label degrades to `?` characters in a dropdown
    # instead of taking the settings screen down.
    raw = completed.stdout.decode("utf-8", errors="replace")
    return parse_interfaces(raw)


def npcap_state(dumpcap: str | None, adapters: list[tuple[str, str]]) -> str:
    """One of `"ready"`, `"no-dumpcap"`, `"no-adapters"`.

    Nothing in this repo has ever checked for Npcap before now — this is
    the first thing that tells "not installed" apart from "installed but
    the adapter list came back empty" apart from "everything is fine".
    """
    if dumpcap is None:
        return "no-dumpcap"
    if not adapters:
        return "no-adapters"
    return "ready"
