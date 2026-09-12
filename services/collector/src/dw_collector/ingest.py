"""The ingest core: turning a closed capture file into journal rows.

THIS USED TO LIVE IN `cli.py`. It moved because `cli.py` imports `typer` and
`httpx` at module level (line ~15-16) — the CLI framework and the sync HTTP
client — and the desktop app's packaged sidecar explicitly excludes both
(`dw-sidecar.spec`'s `excludes=["scapy", "tkinter", "httpx", "typer"]`): a
process that supervises `dumpcap` and reads a local SQLite journal has no
command line to parse and speaks to nothing over HTTP, so neither dependency
belongs in that binary. `desktop/capture.py` needs exactly the logic below to
ingest the ring it supervises, and `from dw_collector.cli import
_ingest_capture` would import all of `cli.py` first — pulling `typer` and
`httpx` into a process that PyInstaller was told to build without them, and
failing with `ModuleNotFoundError` on a player's machine the moment the
ingest loop first ran. Nothing in the dev test suite catches that, because
tests run with the full dependency set installed.

The other way out — a second decoder living under `desktop/` — was rejected
for the reason this repo always rejects it: two parsers drift, and a decoder
that disagrees with the pipeline produces a confident wrong answer, silently.
So the logic below is unchanged from its time in `cli.py` (down to the
comments explaining its own history) and both `cli.py` (`scan-capture`,
`ingest-dir`) and `desktop/capture.py`'s ingest loop import it from here.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from pydantic import ValidationError

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector import pipeline, registry
from dw_collector.models import Observation
from dw_collector.protocol.pcapng import iter_extension_events
from dw_collector.storage.journal import Journal


@dataclass(frozen=True)
class ScanResult:
    """What ingesting one capture file produced.

    Public (no leading underscore) because it stopped being cli.py's private
    business the moment `desktop/capture.py` needed to read it too.
    """

    ingested: int
    discovered: int
    rejected: int
    commands: dict[str, int]

    @property
    def events(self) -> int:
        return self.ingested + self.discovered


def _ingest_capture(
    journal: Journal,
    pcap: Path,
    *,
    collector_id: uuid.UUID,
    collected_from_server: int,
    port: int,
    discover_only: bool,
    fallback: datetime,
) -> ScanResult:
    """One capture file through the pipeline. Shared by scan-capture,
    ingest-dir, and the desktop app's ingest loop so none of the three can
    drift from the one path that has been used by hand all along."""
    ingested = discovered = rejected = 0
    commands: dict[str, int] = {}
    for index, event in enumerate(iter_extension_events(pcap, port=port)):
        if event.direction != "inbound":
            continue
        known = registry.get(event.command) is not None
        if discover_only and known:
            continue
        observation = Observation(
            # The file name is part of the id, and dumpcap's ring buffer gives
            # every file a distinct name, so two files never collide. Replays
            # of the SAME file are harmless anyway: idempotency_key hashes the
            # raw payload (§11.2), so re-ingesting updates rather than copies.
            observation_id=uuid.uuid5(
                uuid.NAMESPACE_URL, f"dw-scan:{pcap.name}:{index}:{event.command}"
            ),
            collector_id=collector_id,
            source_command=event.command,
            captured_at=event.captured_at or fallback,
            collected_from_server_id=collected_from_server,
            payload=dict(event.payload),
        )
        try:
            rows = pipeline.observe(observation)
        except ValidationError:
            rejected += 1
            continue
        journal.record(observation, rows)
        commands[event.command] = commands.get(event.command, 0) + 1
        if known:
            ingested += 1
        else:
            discovered += 1
    return ScanResult(ingested, discovered, rejected, commands)


def _ready_captures(directory: Path, minimum_age_seconds: float) -> list[Path]:
    """Capture files dumpcap has finished with, oldest first.

    The newest file in a ring buffer is the one being written, and reading
    it would ingest a truncated tail and then mark it done. Age is the test
    rather than "skip the newest", because a stopped dumpcap leaves its last
    file complete and that one should still be read.

    A file may vanish between the listing and the stat, and that is normal
    rather than exceptional: `-b files:1440` means dumpcap deletes its oldest
    file on every rotation once the ring is full, and this directory is
    rescanned every 30 seconds. The two collide by design.

    It used to raise FileNotFoundError out of the comprehension, and since
    this runs OUTSIDE the per-file `try` in the loop below, that killed the
    whole process — the collector going quiet with a full ring, which is the
    exact failure `ingest-dir` was written to avoid. It was found early by a
    manual cleanup deleting old captures; the ring would have reached it on
    its own about a day later.

    One stat per path rather than two, which also closes the second race: the
    old code stat'd once to filter and again to sort, so a file could survive
    the first call and be gone by the second.
    """
    now = time.time()
    aged: list[tuple[float, Path]] = []
    for path in directory.glob("*.pcapng"):
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if now - mtime >= minimum_age_seconds:
            aged.append((mtime, path))
    return [path for _, path in sorted(aged, key=lambda pair: pair[0])]
